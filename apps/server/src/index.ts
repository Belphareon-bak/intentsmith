import { buildServer } from './app.js';
import { createRuntime } from './runtime.js';

export { buildServer, type ServerRuntime } from './app.js';
export { createRuntime, defaultDbPath } from './runtime.js';
export const DEFAULT_HOST = '127.0.0.1';

if (import.meta.url === `file://${process.argv[1]}`) {
  const runtime = createRuntime();
  const app = buildServer(runtime);
  const host = process.env.INTENTSMITH_HOST ?? DEFAULT_HOST;
  const port = Number(process.env.INTENTSMITH_PORT ?? 47831);
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await app.close();
    } catch (error) {
      console.error('IntentSmith server shutdown failed', error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  try {
    await app.listen({ host, port });
    console.log(`IntentSmith server listening on http://${host}:${port}`);
  } catch (error) {
    app.log.error(error);
    await shutdown();
    process.exitCode = 1;
  }
}
