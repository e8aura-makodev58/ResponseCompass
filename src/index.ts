import { loadConfig } from './config.js';
import { createApp } from './http/server.js';
import { DEFAULT_ROOM_SPECS } from './seed/seed.js';
import { DataPaths } from './store/paths.js';
import { RoomRegistry } from './store/registry.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const paths = new DataPaths(config.dataRoot);

  const seeded = await RoomRegistry.seedIfEmpty(paths, DEFAULT_ROOM_SPECS, config.plant1SimulationSeedPath);
  const registry = await RoomRegistry.open(paths);

  const server = createApp({ config, registry });
  // Bind failures are operational configuration errors, not uncaught process
  // crashes. The default port may already host another local application.
  server.once('error', (error: NodeJS.ErrnoException) => {
    const message = error.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Stop that service or start Response Compass with PORT=<unused-port> npm start.`
      : `Unable to listen on ${config.host}:${config.port}.`;
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: 'fatal',
        code: error.code ?? 'LISTEN_FAILED',
        message,
      })}\n`,
    );
    process.exit(1);
  });
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
