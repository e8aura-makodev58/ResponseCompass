import { loadConfig } from './config.js';
import { createApp } from './http/server.js';
import { DEFAULT_ROOM_SPECS } from './seed/seed.js';
import { DataPaths } from './store/paths.js';
import { RoomRegistry } from './store/registry.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const paths = new DataPaths(config.dataRoot);

  const seeded = await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS);
  const registry = await RoomRegistry.open(paths);

  const server = createApp({ config, registry });
  server.listen(config.port, config.host, () => {
    process.stdout.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        message: 'response-compass listening',
        port: config.port,
        dataRoot: config.dataRoot,
        seeded,
        rooms: registry.size,
        providersEnabled: config.providersEnabled,
      })}\n`,
    );
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ts: new Date().toISOString(),
      level: 'fatal',
      message: error instanceof Error ? error.message : 'startup failed',
    })}\n`,
  );
  process.exit(1);
});
