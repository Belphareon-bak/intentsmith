import { createCatalog } from './service.js';

const OPS = new Set(['add', 'get', 'list', 'search', 'update', 'delete']);

function assertTuple(cmd) {
  if (!Array.isArray(cmd)) throw new TypeError('command must be an array');
  const op = cmd[0];
  if (typeof op !== 'string' || !OPS.has(op)) {
    throw new Error(`unknown op: ${String(op)}`);
  }
  switch (op) {
    case 'add':
      if (cmd.length !== 5) throw new Error('add requires [sku, name, quantity, priceCents]');
      break;
    case 'get':
      if (cmd.length !== 2) throw new Error('get requires [id]');
      break;
    case 'list':
      if (cmd.length !== 1) throw new Error('list takes no arguments');
      break;
    case 'search':
      if (cmd.length !== 2) throw new Error('search requires [query]');
      break;
    case 'update':
      if (cmd.length !== 3) throw new Error('update requires [id, patch]');
      break;
    case 'delete':
      if (cmd.length !== 2) throw new Error('delete requires [id]');
      break;
  }
}

function execute(catalog, cmd) {
  const op = cmd[0];
  switch (op) {
    case 'add':
      return catalog.add(cmd[1], cmd[2], cmd[3], cmd[4]);
    case 'get':
      return catalog.get(cmd[1]);
    case 'list':
      return catalog.list();
    case 'search':
      return catalog.search(cmd[1]);
    case 'update':
      return catalog.update(cmd[1], cmd[2]);
    case 'delete': {
      const result = catalog.remove(cmd[1]);
      return result === undefined ? true : result;
    }
  }
}

export function run(dbPath, commands) {
  if (!Array.isArray(commands)) throw new TypeError('commands must be an array');
  for (const cmd of commands) assertTuple(cmd);

  const catalog = createCatalog(dbPath);
  try {
    return catalog.transaction(() => {
      const results = [];
      for (const cmd of commands) {
        results.push(execute(catalog, cmd));
      }
      return results;
    });
  } finally {
    catalog.close();
  }
}
