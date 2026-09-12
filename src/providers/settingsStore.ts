import { readFile, rm } from 'node:fs/promises';

import { ApiError } from '../http/errors.js';
import { writeJsonAtomic, writePrivateJsonAtomic } from '../store/atomic.js';
import type { DataPaths } from '../store/paths.js';
import {
  discoverModels,
  displayProvider,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderModel,
} from './catalog.js';

export type CredentialSource = 'SETTINGS' | 'ENVIRONMENT' | 'NONE';

interface ProviderCatalog {
  models: ProviderModel[];
  refreshedAt: string;
}

interface ProviderSettingsFile {
  schemaVersion: 1;
  selected: { provider: ProviderId; model: string } | null;
  catalogs: Partial<Record<ProviderId, ProviderCatalog>>;
}

interface ProviderCredentialsFile {
  schemaVersion: 1;
  keys: Partial<Record<ProviderId, string>>;
}

interface ProviderTransaction {
  schemaVersion: 1;
  phase: 'PREPARED' | 'COMMITTED';
  before: { settings: ProviderSettingsFile; credentials: ProviderCredentialsFile };
  after: { settings: ProviderSettingsFile; credentials: ProviderCredentialsFile };
}

export interface PublicProviderSettings {
  id: ProviderId;
  name: string;
  configured: boolean;
  credentialSource: CredentialSource;
  maskedEnding: string | null;
  models: ProviderModel[];
  refreshedAt: string | null;
  selected: boolean;
}

export interface PublicSettings {
  providers: PublicProviderSettings[];
  compass: { provider: ProviderId; model: string } | null;
}

/** Server-only runtime material. Never return or log this object. */
export interface RuntimeSelection {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

const EMPTY_SETTINGS: ProviderSettingsFile = {
  schemaVersion: 1,
  selected: null,
  catalogs: {},
};
const EMPTY_CREDENTIALS: ProviderCredentialsFile = {
  schemaVersion: 1,
  keys: {},
};

export class ProviderSettingsStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly paths: DataPaths,
    private readonly bootstrapKeys: Partial<Record<ProviderId, string>> = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publicSettings(): Promise<PublicSettings> {
    return this.enqueue(async () => {
      const snapshot = await this.readSnapshot();
      return this.project(snapshot.settings, snapshot.credentials);
    });
  }

  async runtimeSelection(): Promise<RuntimeSelection | null> {
    return this.enqueue(async () => {
      const snapshot = await this.readSnapshot();
      const selected = snapshot.settings.selected;
      if (selected === null) return null;
      const credential = this.effectiveCredential(selected.provider, snapshot.credentials);
      return credential === null ? null : { ...selected, apiKey: credential.key };
    });
  }

  async saveCredential(provider: ProviderId, apiKey: string): Promise<PublicSettings> {
    return this.enqueue(async () => {
      validateApiKey(apiKey);
      const models = await discoverModels(provider, apiKey, this.fetchImpl);
      const before = await this.readSnapshot();
      const after = structuredClone(before);
      after.credentials.keys[provider] = apiKey;
      after.settings.catalogs[provider] = {
        models,
        refreshedAt: new Date().toISOString(),
      };
      if (
        after.settings.selected?.provider === provider &&
        !models.some((model) => model.id === after.settings.selected?.model)
      ) {
        after.settings.selected = null;
      }
      await this.commit(before, after);
      return this.project(after.settings, after.credentials);
    });
  }

  async removeCredential(provider: ProviderId): Promise<PublicSettings> {
    return this.enqueue(async () => {
      const before = await this.readSnapshot();
      const after = structuredClone(before);
      delete after.credentials.keys[provider];
      if (this.bootstrapKeys[provider] === undefined) {
        delete after.settings.catalogs[provider];
        if (after.settings.selected?.provider === provider) after.settings.selected = null;
      }
      await this.commit(before, after);
      return this.project(after.settings, after.credentials);
    });
  }

  async refreshModels(provider: ProviderId): Promise<PublicSettings> {
    return this.enqueue(async () => {
      const before = await this.readSnapshot();
      const credential = this.effectiveCredential(provider, before.credentials);
      if (credential === null) {
        throw new ApiError('VALIDATION_FAILED', `${displayProvider(provider)} has no configured API key.`);
      }
      const models = await discoverModels(provider, credential.key, this.fetchImpl);
      const after = structuredClone(before);
      after.settings.catalogs[provider] = {
        models,
        refreshedAt: new Date().toISOString(),
      };
      if (
        after.settings.selected?.provider === provider &&
        !models.some((model) => model.id === after.settings.selected?.model)
      ) {
        after.settings.selected = null;
      }
      await this.commit(before, after);
      return this.project(after.settings, after.credentials);
    });
  }

  async selectCompass(provider: ProviderId, model: string): Promise<PublicSettings> {
    return this.enqueue(async () => {
      const before = await this.readSnapshot();
      if (this.effectiveCredential(provider, before.credentials) === null) {
        throw new ApiError('VALIDATION_FAILED', `${displayProvider(provider)} has no configured API key.`);
      }
      const catalog = before.settings.catalogs[provider];
      if (catalog === undefined || !catalog.models.some((candidate) => candidate.id === model)) {
        throw new ApiError('VALIDATION_FAILED', 'Select a model from the latest validated provider catalog.');
      }
      const after = structuredClone(before);
      after.settings.selected = { provider, model };
      await this.commit(before, after);
      return this.project(after.settings, after.credentials);
    });
  }

  private effectiveCredential(
    provider: ProviderId,
    credentials: ProviderCredentialsFile,
  ): { key: string; source: Exclude<CredentialSource, 'NONE'> } | null {
    const settingsKey = credentials.keys[provider];
    if (settingsKey !== undefined) return { key: settingsKey, source: 'SETTINGS' };
    const environmentKey = this.bootstrapKeys[provider];
    if (environmentKey !== undefined && environmentKey !== '') {
      return { key: environmentKey, source: 'ENVIRONMENT' };
    }
    return null;
  }

  private project(
    settings: ProviderSettingsFile,
    credentials: ProviderCredentialsFile,
  ): PublicSettings {
    return {
      providers: PROVIDER_IDS.map((provider) => {
        const credential = this.effectiveCredential(provider, credentials);
        const catalog = settings.catalogs[provider];
        return {
          id: provider,
          name: displayProvider(provider),
          configured: credential !== null,
          credentialSource: credential?.source ?? 'NONE',
          maskedEnding: credential === null ? null : maskCredential(credential.key),
          models: catalog?.models ?? [],
          refreshedAt: catalog?.refreshedAt ?? null,
          selected: settings.selected?.provider === provider,
        };
      }),
      compass: settings.selected,
    };
  }

  private async readSnapshot(): Promise<{
    settings: ProviderSettingsFile;
    credentials: ProviderCredentialsFile;
  }> {
    await this.recoverTransaction();
    const settings = await readOrDefault(
      this.paths.providerSettingsFile,
      EMPTY_SETTINGS,
    );
    const credentials = await readOrDefault(
      this.paths.providerCredentialsFile,
      EMPTY_CREDENTIALS,
    );
    assertSettings(settings);
    assertCredentials(credentials);
    return { settings, credentials };
  }

  private async commit(
    before: { settings: ProviderSettingsFile; credentials: ProviderCredentialsFile },
    after: { settings: ProviderSettingsFile; credentials: ProviderCredentialsFile },
  ): Promise<void> {
    const transaction: ProviderTransaction = {
      schemaVersion: 1,
      phase: 'PREPARED',
      before,
      after,
    };
    await writePrivateJsonAtomic(this.paths.providerTransactionFile, transaction);
    try {
      await writePrivateJsonAtomic(this.paths.providerCredentialsFile, after.credentials);
      await writeJsonAtomic(this.paths.providerSettingsFile, after.settings);
      await writePrivateJsonAtomic(
        this.paths.providerTransactionFile,
        { ...transaction, phase: 'COMMITTED' },
      );
    } catch (error) {
      try {
        await this.recoverTransaction();
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          'Provider settings transaction failed and could not be recovered.',
        );
      }
      throw error;
    }
    await rm(this.paths.providerTransactionFile, { force: true }).catch(() => undefined);
  }

  private async recoverTransaction(): Promise<void> {
    let transaction: ProviderTransaction;
    try {
      transaction = JSON.parse(
        await readFile(this.paths.providerTransactionFile, 'utf8'),
      ) as ProviderTransaction;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('Provider settings transaction journal is unreadable.');
    }
    assertTransaction(transaction);
    const snapshot = transaction.phase === 'COMMITTED'
      ? transaction.after
      : transaction.before;
    await writePrivateJsonAtomic(
      this.paths.providerCredentialsFile,
      snapshot.credentials,
    );
    await writeJsonAtomic(this.paths.providerSettingsFile, snapshot.settings);
    await rm(this.paths.providerTransactionFile, { force: true });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

async function readOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(fallback);
    }
    throw new Error('Provider configuration is unreadable.');
  }
}

function validateApiKey(apiKey: string): void {
  if (
    apiKey.length < 8 ||
    apiKey.length > 4_096 ||
    apiKey.trim() !== apiKey ||
    /[\u0000-\u001f\u007f]/.test(apiKey)
  ) {
    throw new ApiError('INVALID_CREDENTIAL', 'API key format is invalid.');
  }
}

function maskCredential(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}

function assertSettings(settings: ProviderSettingsFile): void {
  if (
    settings?.schemaVersion !== 1 ||
    (settings.selected !== null &&
      (!isProvider(settings.selected?.provider) ||
        typeof settings.selected?.model !== 'string')) ||
    settings.catalogs === null ||
    typeof settings.catalogs !== 'object'
  ) {
    throw new Error('Provider settings file is invalid.');
  }
}

function assertCredentials(credentials: ProviderCredentialsFile): void {
  if (
    credentials?.schemaVersion !== 1 ||
    credentials.keys === null ||
    typeof credentials.keys !== 'object' ||
    Object.keys(credentials.keys).some((key) => !isProvider(key))
  ) {
    throw new Error('Provider credential file is invalid.');
  }
}

function assertTransaction(transaction: ProviderTransaction): void {
  if (
    transaction?.schemaVersion !== 1 ||
    !['PREPARED', 'COMMITTED'].includes(transaction.phase) ||
    transaction.before === undefined ||
    transaction.after === undefined
  ) {
    throw new Error('Provider settings transaction journal is invalid.');
  }
  assertSettings(transaction.before.settings);
  assertCredentials(transaction.before.credentials);
  assertSettings(transaction.after.settings);
  assertCredentials(transaction.after.credentials);
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}
