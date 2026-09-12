import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/server.js';
import type { ProviderSettingsStore } from '../src/providers/settingsStore.js';
import type { InferenceClient } from '../src/providers/inference.js';
import { DEFAULT_ROOM_SPECS } from '../src/seed/seed.js';
import { DataPaths } from '../src/store/paths.js';
import { RoomRegistry } from '../src/store/registry.js';

/** Tests are hermetic (SOW s11): a throwaway data root, no network, no provider. */
export async function makeDataRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'response-compass-test-'));
}

export async function removeDataRoot(dataRoot: string): Promise<void> {
  await rm(dataRoot, { recursive: true, force: true });
}

export interface TestApp {
  baseUrl: string;
  registry: RoomRegistry;
  close(): Promise<void>;
}

export async function startApp(
  dataRoot: string,
  providerSettings?: ProviderSettingsStore,
  log: (line: Record<string, string | number>) => void = () => undefined,
  options: { providersEnabled?: boolean; inferenceClient?: InferenceClient; automaticSimulation?: boolean } = {},
): Promise<TestApp> {
  const config = { ...loadConfig({}), dataRoot, port: 0, providersEnabled: options.providersEnabled ?? false };
  const paths = new DataPaths(dataRoot);
  await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS);
  const registry = await RoomRegistry.open(paths);

  const server: Server = createApp({
    config,
    registry,
    log,
    automaticSimulation: options.automaticSimulation ?? false,
    ...(providerSettings === undefined ? {} : { providerSettings }),
    ...(options.inferenceClient === undefined ? {} : { inferenceClient: options.inferenceClient }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    registry,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function getJson(
  url: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

export async function postJson(
  url: string,
  body: unknown,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
  return { status: response.status, body: await response.json() };
}
