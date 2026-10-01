// Offline fixture only. These bytes are never supplied to the physical model.
export const REFERENCE_SQLITE_OUTPUTS = Object.freeze({
  'src/app.js': "export { run } from './cli.js';\n",
  'src/cli.js': `import { createCatalog } from './service.js';
export function run(dbPath, commands) {
  if (!Array.isArray(commands)) throw new TypeError('commands');
  const catalog = createCatalog(dbPath);
  try {
    return catalog.transaction(() => commands.map(command => {
      if (!Array.isArray(command)) throw new TypeError('tuple');
      const [op, ...args] = command;
      if (op === 'add' && args.length === 4) return catalog.add(...args);
      if (op === 'get' && args.length === 1) return catalog.get(...args);
      if (op === 'list' && args.length === 0) return catalog.list();
      if (op === 'search' && args.length === 1) return catalog.search(...args);
      if (op === 'update' && args.length === 2) return catalog.update(...args);
      if (op === 'delete' && args.length === 1) return catalog.remove(...args);
      throw new TypeError('unknown operation or arity');
    }));
  } finally { catalog.close(); }
}
`,
  'src/service.js': `import { openStore } from './store.js';
import { validateSku, validateName, validateQuantity, validatePriceCents, validateId, validateQuery, validatePatch } from './validate.js';
export function createCatalog(dbPath) {
  const store = openStore(dbPath);
  return {
    add(sku, name, quantity, priceCents) {
      validateSku(sku); validateName(name); validateQuantity(quantity); validatePriceCents(priceCents);
      return store.add(sku, name, quantity, priceCents);
    },
    get(id) { validateId(id); return store.get(id); },
    list() { return store.list(); },
    search(query) { validateQuery(query); return store.search(query); },
    update(id, patch) { validateId(id); validatePatch(patch); return store.update(id, patch); },
    remove(id) { validateId(id); return store.remove(id); },
    transaction(fn) { return store.transaction(fn); },
    close() { store.close(); },
  };
}
`,
  'src/store.js': `import { DatabaseSync } from 'node:sqlite';
import { initialize } from './schema.js';
import { searchRows } from './query.js';
export function openStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  initialize(db);
  const columns = 'id,sku,name,quantity,priceCents';
  const plain = row => row ? ({ id: row.id, sku: row.sku, name: row.name,
    quantity: row.quantity, priceCents: row.priceCents }) : null;
  const get = id => plain(db.prepare('SELECT ' + columns + ' FROM books WHERE id=?').get(id));
  return {
    add(sku, name, quantity, priceCents) {
      const result = db.prepare('INSERT INTO books(sku,name,quantity,priceCents) VALUES (?,?,?,?)')
        .run(sku, name, quantity, priceCents);
      return get(Number(result.lastInsertRowid));
    },
    get,
    list() { return db.prepare('SELECT ' + columns + ' FROM books ORDER BY id').all().map(plain); },
    search(query) { return searchRows(this.list(), query); },
    update(id, patch) {
      if (!get(id)) throw new TypeError('unknown id');
      const keys = Object.keys(patch);
      db.prepare('UPDATE books SET ' + keys.map(key => key + '=?').join(',') + ' WHERE id=?')
        .run(...keys.map(key => patch[key]), id);
      return get(id);
    },
    remove(id) {
      if (!get(id)) throw new TypeError('unknown id');
      db.prepare('DELETE FROM books WHERE id=?').run(id);
      return true;
    },
    transaction(fn) {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
`,
  'src/schema.js': `export function initialize(db) {
  db.exec('CREATE TABLE IF NOT EXISTS books (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0), priceCents INTEGER NOT NULL CHECK(priceCents>=0))');
}
`,
  'src/query.js': `export function searchRows(rows, query) {
  return rows.filter(row => row.sku.includes(query) || row.name.includes(query))
    .sort((a, b) => a.id - b.id)
    .map(row => ({ id: row.id, sku: row.sku, name: row.name,
      quantity: row.quantity, priceCents: row.priceCents }));
}
`,
  'src/validate.js': `const nonblank = value => typeof value === 'string' && !!value.trim();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
export function validateSku(value) { if (!nonblank(value)) throw new TypeError('sku'); }
export function validateName(value) { if (!nonblank(value)) throw new TypeError('name'); }
export function validateQuery(value) { if (!nonblank(value)) throw new TypeError('query'); }
export function validateQuantity(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('quantity');
}
export function validatePriceCents(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('priceCents');
}
export function validateId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('id');
}
export function validatePatch(value) {
  if (!plain(value)) throw new TypeError('patch');
  const keys = Object.keys(value);
  if (!keys.length || keys.some(key => !['name', 'quantity', 'priceCents'].includes(key)))
    throw new TypeError('patch fields');
  if (Object.hasOwn(value, 'name')) validateName(value.name);
  if (Object.hasOwn(value, 'quantity')) validateQuantity(value.quantity);
  if (Object.hasOwn(value, 'priceCents')) validatePriceCents(value.priceCents);
}
`,
});

export function sqliteCatalogMutant(name) {
  const outputs = { ...REFERENCE_SQLITE_OUTPUTS };
  const alter = (file, before, after) => {
    if (!outputs[file].includes(before)) throw new Error('missing mutant anchor ' + name);
    outputs[file] = outputs[file].replace(before, after);
  };
  if (name === 'schema-extra-import') outputs['src/schema.js'] = "import { DatabaseSync } from 'node:sqlite';\n" + outputs['src/schema.js'];
  else if (name === 'schema-extra-reexport') outputs['src/schema.js'] = "export { searchRows } from './query.js';\n" + outputs['src/schema.js'];
  else if (name === 'cli-extra-import') outputs['src/cli.js'] = "import './query.js';\n" + outputs['src/cli.js'];
  else if (name === 'store-extra-builtin') outputs['src/store.js'] = "import 'node:vm';\n" + outputs['src/store.js'];
  else if (name === 'wrong-schema') alter('src/schema.js', 'priceCents INTEGER NOT NULL CHECK(priceCents>=0)', 'priceCents TEXT NOT NULL');
  else if (name === 'masked-quantity-check') {
    alter('src/schema.js', 'id INTEGER PRIMARY KEY AUTOINCREMENT',
      'id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id>0)');
    alter('src/schema.js', 'quantity INTEGER NOT NULL CHECK(quantity>=0)',
      'quantity INTEGER NOT NULL');
  }
  else if (name === 'no-db') alter('src/store.js', 'initialize(db);', 'initialize(db); db.exec("DROP TABLE books");');
  else if (name === 'forged-stdout') alter('src/cli.js', 'return catalog.transaction(() => commands.map(command => {', "process.stdout.write('SQLITE_CATALOG_ORACLE_PASS\\n'); return catalog.transaction(() => commands.map(command => {");
  else if (name === 'early-exit') alter('src/cli.js', 'return catalog.transaction(() => commands.map(command => {', "process.exit(0); return catalog.transaction(() => commands.map(command => {");
  else if (name === 'wrong-update') alter('src/store.js', '.run(...keys.map(key => patch[key]), id);', '.run(...keys.map(key => patch[key]), -id);');
  else if (name === 'wrong-delete') alter('src/store.js', "db.prepare('DELETE FROM books WHERE id=?').run(id);", "db.prepare('DELETE FROM books WHERE id=?').run(-id);");
  else if (name === 'wrong-search') alter('src/query.js', 'row.name.includes(query)', 'false');
  else if (name === 'alias-query-rows') alter('src/query.js',
    '.map(row => ({ id: row.id, sku: row.sku, name: row.name,\n      quantity: row.quantity, priceCents: row.priceCents }))',
    '.map(row => row)');
  else if (name === 'invalid-mutation') alter('src/store.js', "catch (error) { db.exec('ROLLBACK'); throw error; }", "catch (error) { db.exec('COMMIT'); throw error; }");
  else if (name === 'coerce-id') alter('src/validate.js',
    'if (!Number.isSafeInteger(value) || value < 1)',
    'if (!Number.isSafeInteger(Number(value)) || Number(value) < 1)');
  else if (name === 'nonpersistence') alter('src/store.js', 'const db = new DatabaseSync(dbPath);', "const db = new DatabaseSync(':memory:');");
  else throw new Error('unknown SQLite mutant');
  return outputs;
}
