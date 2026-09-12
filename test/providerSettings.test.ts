import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { afterEach, describe, it } from 'node:test';

import { ProviderSettingsStore } from '../src/providers/settingsStore.js';
import { DataPaths } from '../src/store/paths.js';
import { getJson, makeDataRoot, postJson, removeDataRoot, startApp, type TestApp } from './helpers.js';

interface Harness {
  app: TestApp;
  dataRoot: string;
  paths: DataPaths;
  calls: Array<{ url: string; authorization: string | null }>;
  logs: Array<Record<string, string | number>>;
}

const active: Harness[] = [];

afterEach(async () => {
  await Promise.all(active.splice(0).map(async ({ app, dataRoot }) => {
    await app.close();
    await removeDataRoot(dataRoot);
  }));
});

async function harness(
  bootstrapKeys: ConstructorParameters<typeof ProviderSettingsStore>[1] = {},
): Promise<Harness> {
  const dataRoot = await makeDataRoot();
  const paths = new DataPaths(dataRoot);
  const calls: Harness['calls'] = [];
  const logs: Harness['logs'] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization');
    calls.push({ url, authorization });
    const key = authorization?.replace(/^Bearer /, '') ?? '';
    if (key.startsWith('invalid-')) {
      return Response.json({ error: { message: `rejected ${key}` } }, { status: 401 });
    }
    if (url.startsWith('https://api.openai.com/')) {
      return Response.json({ data: [{ id: 'gpt-z' }, { id: 'gpt-a' }, { id: 'gpt-a' }] });
    }
    if (url.startsWith('https://openrouter.ai/')) {
      return Response.json({
        data: [
          { id: 'vendor/zeta', name: 'Zeta' },
          { id: 'vendor/alpha', name: 'Alpha' },
        ],
      });
    }
    throw new Error('Unexpected provider URL');
  };
  const settings = new ProviderSettingsStore(paths, bootstrapKeys, fakeFetch);
  const app = await startApp(dataRoot, settings, (line) => logs.push(line));
  const result = { app, dataRoot, paths, calls, logs };
  active.push(result);
  return result;
}

describe('provider settings API', () => {
  it('starts without exposing credentials', async () => {
    const { app } = await harness();
    const response = await getJson(`${app.baseUrl}/api/settings/providers`);

    assert.equal(response.status, 200);
    assert.equal(response.body.compass, null);
    assert.deepEqual(
      response.body.providers.map((provider: { id: string; configured: boolean }) => [provider.id, provider.configured]),
      [['openai', false], ['openrouter', false]],
    );
    assert.doesNotMatch(JSON.stringify(response.body), /apiKey|credential-value|Bearer/i);
  });

  it('validates and saves an OpenAI key with an owner-only credential file', async () => {
    const { app, paths, calls, logs } = await harness();
    const secret = 'openai-secret-1234';
    const response = await postJson(
      `${app.baseUrl}/api/settings/providers/openai/credential`,
      { apiKey: secret },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.providers[0].models, [
      { id: 'gpt-a', name: 'gpt-a' },
      { id: 'gpt-z', name: 'gpt-z' },
    ]);
    assert.equal(response.body.providers[0].credentialSource, 'SETTINGS');
    assert.equal(response.body.providers[0].maskedEnding, '••••1234');
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(secret));
    assert.equal(calls[0]?.authorization, `Bearer ${secret}`);

    const credentials = await readFile(paths.providerCredentialsFile, 'utf8');
    const settings = await readFile(paths.providerSettingsFile, 'utf8');
    assert.match(credentials, new RegExp(secret));
    assert.doesNotMatch(settings, new RegExp(secret));
    assert.equal((await stat(paths.providerCredentialsFile)).mode & 0o777, 0o600);
    const publicRoom = await getJson(`${app.baseUrl}/api/rooms/plant-1`);
    assert.doesNotMatch(JSON.stringify(publicRoom.body), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(secret));
  });

  it('does not replace a working key when replacement validation fails', async () => {
    const { app, paths } = await harness();
    const original = 'working-key-5678';
    await postJson(`${app.baseUrl}/api/settings/providers/openai/credential`, { apiKey: original });

    const rejected = 'invalid-replacement-9999';
    const response = await postJson(
      `${app.baseUrl}/api/settings/providers/openai/credential`,
      { apiKey: rejected },
    );
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'INVALID_CREDENTIAL');
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(rejected));

    const credentials = await readFile(paths.providerCredentialsFile, 'utf8');
    assert.match(credentials, new RegExp(original));
    assert.doesNotMatch(credentials, new RegExp(rejected));
  });

  it('loads OpenRouter text models and persists the selected Compass model', async () => {
    const { app, dataRoot, calls } = await harness();
    await postJson(
      `${app.baseUrl}/api/settings/providers/openrouter/credential`,
      { apiKey: 'openrouter-secret-4321' },
    );
    assert.match(calls[0]?.url ?? '', /openrouter\.ai\/api\/v1\/models\?output_modalities=text$/);

    const selected = await postJson(`${app.baseUrl}/api/settings/compass`, {
      provider: 'openrouter',
      model: 'vendor/alpha',
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(selected.body.compass, { provider: 'openrouter', model: 'vendor/alpha' });

    await app.close();
    active.splice(active.findIndex((entry) => entry.app === app), 1);
    const reopened = await startApp(
      dataRoot,
      new ProviderSettingsStore(new DataPaths(dataRoot), {}, async () => {
        throw new Error('Persistence read must not call a provider.');
      }),
    );
    active.push({ app: reopened, dataRoot, paths: new DataPaths(dataRoot), calls: [], logs: [] });
    const response = await getJson(`${reopened.baseUrl}/api/settings/providers`);
    assert.deepEqual(response.body.compass, { provider: 'openrouter', model: 'vendor/alpha' });
  });

  it('rejects unvalidated model selection and supports environment fallback after removal', async () => {
    const { app, calls } = await harness({ openai: 'environment-key-2468' });
    const initial = await getJson(`${app.baseUrl}/api/settings/providers`);
    assert.equal(initial.body.providers[0].credentialSource, 'ENVIRONMENT');
    assert.equal(initial.body.providers[0].maskedEnding, '••••2468');

    const invalidSelection = await postJson(`${app.baseUrl}/api/settings/compass`, {
      provider: 'openai',
      model: 'unvalidated-model',
    });
    assert.equal(invalidSelection.status, 400);

    await postJson(`${app.baseUrl}/api/settings/providers/openai/credential`, {
      apiKey: 'settings-key-1357',
    });
    const removed = await fetch(`${app.baseUrl}/api/settings/providers/openai/credential`, {
      method: 'DELETE',
    });
    const body = await removed.json() as any;
    assert.equal(body.providers[0].credentialSource, 'ENVIRONMENT');
    assert.equal(body.providers[0].maskedEnding, '••••2468');

    const refreshed = await postJson(
      `${app.baseUrl}/api/settings/providers/openai/models/refresh`,
      {},
    );
    assert.equal(refreshed.status, 200);
    assert.equal(calls.at(-1)?.authorization, 'Bearer environment-key-2468');
  });
});
