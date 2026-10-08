/**
 * server.mjs
 * Node24 CLI entrypoint for the item service.
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createStore } from './store.mjs';
import { createRouter } from './router.mjs';

/**
 * Parses command-line arguments into a configuration object.
 * @param {string[]} args - The process argv slice after the script path.
 * @returns {{db: string, host: string, port: number}} Parsed configuration.
 */
function parseArgs(args) {
  const config = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--db') {
      if ('db' in config) throw new Error('Duplicate flag: --db');
      if (i + 1 >= args.length || typeof args[i + 1] !== 'string' || args[i + 1].length === 0) {
        throw new Error('Missing value for --db');
      }
      config.db = args[++i];
    } else if (arg === '--host') {
      if ('host' in config) throw new Error('Duplicate flag: --host');
      if (i + 1 >= args.length || typeof args[i + 1] !== 'string' || args[i + 1].length === 0) {
        throw new Error('Missing value for --host');
      }
      config.host = args[++i];
    } else if (arg === '--port') {
      if ('port' in config) throw new Error('Duplicate flag: --port');
      if (i + 1 >= args.length || typeof args[i + 1] !== 'string' || args[i + 1].length === 0) {
        throw new Error('Missing value for --port');
      }
      const portStr = args[++i];
      const portNum = Number(portStr);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error('Invalid port value');
      }
      config.port = portNum;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!config.db || !config.host || !config.port) {
    throw new Error('Missing required flags: --db, --host, --port');
  }

  return config;
}

/**
 * Main entrypoint function.
 */
function main() {
  const args = process.argv.slice(2);
  let config;
  try {
    config = parseArgs(args);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Enforce binding to 127.0.0.1:18080 as per API.md
  if (config.host !== '127.0.0.1' || config.port !== 18080) {
    console.error('Invalid host/port configuration. Must be 127.0.0.1:18080');
    process.exit(1);
  }

  let store;
  try {
    store = createStore(config.db);
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    process.exit(1);
  }

  const handler = createRouter(store);
  const server = createServer(handler);

  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      store.close();
    } catch (_) {}

    server.close(() => {
      process.exit(0);
    });

    // Force exit after a timeout in case connections hang
    setTimeout(() => {
      process.exit(0);
    }, 5000).unref();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(config.port, config.host, () => {
    // Server is ready
  });

  server.on('error', (err) => {
    console.error('Server error:', err.message);
    try {
      store.close();
    } catch (_) {}
    process.exit(1);
  });
}

// Explicit CLI entry guard: only run main when executed directly as a script.
if (process.argv[1]) {
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
  }
}
