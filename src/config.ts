import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  /**
   * The single configured persistence root (SOW s10). Every persistence path
   * resolves from here; there is no second root and no per-feature override.
   */
  dataRoot: string;
  /** Providers are disabled for the first deployment; dispatch is deterministic. */
  providersEnabled: boolean;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 8080;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: readPort(env['PORT']),
    host: env['HOST'] ?? '0.0.0.0',
    dataRoot: resolve(env['DATA_ROOT'] ?? './data'),
    providersEnabled: env['PROVIDERS_ENABLED'] === 'true',
  };
}
