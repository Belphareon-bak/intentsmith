// Operator-owned, fixed SQLite application contract. Frozen before inference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import { sha256, ORACLE_BINARY, ORACLE_PATH, ENTRY_PATH } from './project-app-acceptance.js';

export const SQLITE_FILES = Object.freeze([
  { path: 'src/app.js', instruction: "Re-export run from './cli.js' only. No work at import time.", dependsOn: ['src/cli.js'] },
  { path: 'src/cli.js', instruction: "Import createCatalog from './service.js'. Export run(dbPath,commands): array only; tuples: ['add',sku,name,quantity,priceCents],['get',id],['list'],['search',query],['update',id,patch],['delete',id]. Reject wrong arity/unknown op. Open one catalog; whole batch uses catalog.transaction(fn); synchronous fn() has NO arguments, CRUD via this catalog closure. Return one result per tuple: add/get/update row,list/search rows,delete true. Close in finally; any error rolls back whole batch and throws.", dependsOn: ['src/service.js'] },
  { path: 'src/service.js', instruction: "Import openStore from './store.js' and validators from './validate.js'. Export createCatalog(dbPath): add(sku,name,quantity,priceCents),get(id),list(),search(query),update(id,patch),remove(id),transaction(fn),close(). Validate before store calls; invalid input must not mutate DB. transaction(fn) forwards the same synchronous fn to store.transaction(fn), returns its result; fn() has NO arguments. CRUD inside fn uses validated catalog methods. Missing get=null; missing update/remove throw.", dependsOn: ['src/store.js', 'src/validate.js'] },
  { path: 'src/store.js', instruction: "Import DatabaseSync from node:sqlite, initialize from './schema.js', searchRows from './query.js'. Export openStore(dbPath): add/get/list/search/update/remove/transaction(fn)/close; initialize DB. Prepared bound SQL only; books row={id,sku,name,quantity,priceCents}. add/get/update plain rows; list/search id-ascending arrays; remove true. Missing get null; missing update/remove throw. Patch preserves other fields. transaction(fn): BEGIN, synchronous fn() no args, COMMIT+return result; error ROLLBACK+rethrow.", dependsOn: ['src/schema.js', 'src/query.js'] },
  { path: 'src/schema.js', instruction: "Export initialize(db). Create SQLite table books with id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0), priceCents INTEGER NOT NULL CHECK(priceCents>=0). Existing data survives reopen. No imports.", dependsOn: [] },
  { path: 'src/query.js', instruction: "Export searchRows(rows,query): filter rows whose sku or name includes query as a literal, case-sensitive substring. '%' and '_' are ordinary characters. Return id-ascending new plain {id,sku,name,quantity,priceCents} records; do not mutate inputs. No imports.", dependsOn: [] },
  { path: 'src/validate.js', instruction: "Export validateSku, validateName, validateQuantity, validatePriceCents, validateId, validateQuery, validatePatch. Each throws TypeError on invalid input; never coerce. sku/name/query are non-whitespace strings, stored/searched without trimming. quantity/priceCents are nonnegative safe integers; id positive safe integer. Patch is nonempty plain object with only name,quantity,priceCents; validate present fields. No imports.", dependsOn: [] },
]);

export const SQLITE_ORACLE_SOURCE = fs.readFileSync(new URL('./project-sqlite-catalog-oracle.mjs', import.meta.url), 'utf8');
export const SQLITE_ORACLE_SHA256 = sha256(SQLITE_ORACLE_SOURCE);
export const SQLITE_ORACLE_ARGV = Object.freeze(['--experimental-vm-modules', ORACLE_PATH]);
export const SQLITE_ENTRY_SOURCE = `import { run } from './app.js';\nconst [dbPath, raw] = process.argv.slice(2);\nif (!dbPath || !raw) throw new TypeError('dbPath and commands required');\nprocess.stdout.write(JSON.stringify(run(dbPath, JSON.parse(raw))) + '\\n');\n`;
export const SQLITE_ENTRY_SHA256 = sha256(SQLITE_ENTRY_SOURCE);
export const SQLITE_ORACLE_PATH = ORACLE_PATH;

export function sqliteCatalogBlueprint() {
  return {
    instruction: 'Build a seven-module Node SQLite book catalog. Public run(dbPath,commands) uses exact tuples, returns one result per command, and persists books across process restarts at dbPath. Each whole batch is atomic: any invalid command exits nonzero and leaves DB as before the batch. Use node:sqlite only in store.js; other modules use only declared relative imports and standard ECMAScript globals. Generate only the seven listed files.',
    files: SQLITE_FILES.map(file => ({ ...file, dependsOn: [...file.dependsOn] })),
    focusedTest: { binary: ORACLE_BINARY, argv: [...SQLITE_ORACLE_ARGV],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 60_000 },
    gitCommit: { message: 'Implement reviewed SQLite catalog', identity: {
      authorName: 'IntentSmith Qualification', authorEmail: 'qualification@example.invalid',
      authorDate: '2026-10-01T00:00:00Z', committerName: 'IntentSmith Qualification',
      committerEmail: 'qualification@example.invalid', committerDate: '2026-10-01T00:00:00Z',
    } },
  };
}

export function policyForSqliteCatalog(policy) {
  assert.equal(policy.policyId, 'intentsmith-local-project-v1');
  assert.ok(policy.layers?.some(layer => layer.roots?.includes('test')));
  const imports = new Set(policy.externalImports);
  imports.add('node:child_process');
  imports.add('node:sqlite');
  imports.add('node:vm');
  return { ...policy, externalImports: [...imports].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))) };
}

export function assertSqlitePreview(diff, projectRoot, readFile, exists) {
  assert.deepEqual(diff.map(file => file.path).sort(), SQLITE_FILES.map(file => file.path).sort());
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  for (const row of diff) {
    assert.equal(typeof row.after?.content, 'string');
    assert.ok(row.after.content.trim(), row.path + ' nonempty');
    assert.equal(exists(projectRoot, row.path), false, row.path + ' absent before approval');
    // Static dependencies are independently checked by the frozen oracle.
    // Reject dormant dynamic imports without executing code or matching words
    // inside comments, strings or regular expressions.
    const tree = parser.parse(row.after.content);
    assert.equal(tree.rootNode.hasError, false, row.path + ' valid JavaScript AST');
    const pending = [tree.rootNode];
    while (pending.length) {
      const node = pending.pop();
      assert.equal(node.type === 'call_expression'
        && node.childForFieldName('function')?.type === 'import', false,
      'SQLite dynamic imports forbidden: ' + row.path);
      pending.push(...node.namedChildren);
    }
  }
  assert.equal(sha256(readFile(projectRoot, ORACLE_PATH)), SQLITE_ORACLE_SHA256, 'frozen SQLite oracle');
  assert.equal(sha256(readFile(projectRoot, ENTRY_PATH)), SQLITE_ENTRY_SHA256, 'frozen SQLite entry');
}
