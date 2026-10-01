// Operator-owned focused test. Generated modules execute only in child
// processes; this parent independently reads the SQLite file after each turn.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';

const dbPath = '/tmp/is-catalog-' + randomBytes(16).toString('hex') + '.sqlite';
const entry = 'src/index.mjs';
const skuA = 'SKU-' + randomBytes(6).toString('hex').toUpperCase();
const skuB = 'SKU-' + randomBytes(6).toString('hex').toUpperCase();
const skuC = 'SKU-' + randomBytes(6).toString('hex').toUpperCase();
const skuBatch = 'SKU-' + randomBytes(6).toString('hex').toUpperCase();
const needle = randomBytes(7).toString('hex');
const nameA = 'Alpha ' + needle;
const nameB = 'Beta %_ ' + randomBytes(7).toString('hex');
const nameC = 'Gamma 雪 ' + randomBytes(7).toString('hex');
const quantityA = randomInt(2, 40), quantityB = randomInt(41, 80);
const centsA = randomInt(101, 9000), centsB = randomInt(9001, 20000);
const rowA = { id: 1, sku: skuA, name: nameA, quantity: quantityA, priceCents: centsA };
const rowB = { id: 2, sku: skuB, name: nameB, quantity: quantityB, priceCents: centsB };
const rowC = { id: 3, sku: skuC, name: nameC, quantity: 0, priceCents: 0 };

function call(commands) {
  const child = spawnSync(process.execPath, [entry, dbPath, JSON.stringify(commands)], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 6000, maxBuffer: 65536,
    env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, shell: false,
  });
  assert.equal(child.error, undefined, 'subject child starts and finishes');
  assert.equal(child.signal, null, 'subject child exits without a signal');
  return child;
}

function accepted(commands, expected, label) {
  const child = call(commands);
  assert.equal(child.status, 0, label + ': ' + child.stderr);
  const output = JSON.parse(child.stdout);
  assert.equal(child.stdout.trim(), JSON.stringify(output), label + ': exactly one complete JSON result');
  assert.ok(Array.isArray(output) && output.length === commands.length, label + ': one result per command');
  assert.deepEqual(output, expected, label + ': actual result');
}

function rejected(commands, label) {
  const child = call(commands);
  assert.notEqual(child.status, 0, label + ': invalid command exits nonzero');
}

function inspect(expected, label) {
  const stat = fs.lstatSync(dbPath, { bigint: true });
  assert.ok(stat.isFile() && stat.nlink === 1n, label + ': private regular DB inode');
  assert.equal(fs.realpathSync(dbPath), dbPath, label + ': no DB symlink');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok', label + ': SQLite integrity');
    const columns = db.prepare("PRAGMA table_info('books')").all();
    assert.deepEqual(columns.map(c => [c.name, c.type.toUpperCase(), c.notnull, c.pk]), [
      ['id', 'INTEGER', 0, 1], ['sku', 'TEXT', 1, 0], ['name', 'TEXT', 1, 0],
      ['quantity', 'INTEGER', 1, 0], ['priceCents', 'INTEGER', 1, 0],
    ], label + ': exact persisted schema');
    const actual = db.prepare('SELECT id,sku,name,quantity,priceCents FROM books ORDER BY id').all()
      .map(r => ({ id: r.id, sku: r.sku, name: r.name, quantity: r.quantity, priceCents: r.priceCents }));
    assert.deepEqual(actual, expected, label + ': trusted persisted rows');
  } finally { db.close(); }
}

function checkConstraints(expected) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN');
    const insert = db.prepare('INSERT INTO books(id,sku,name,quantity,priceCents) VALUES (?,?,?,?,?)');
    const challenge = (id, change, expectedError, label) => {
      const valid = [id, `${skuC}-${id}`, 'control', 1, 1];
      db.exec('SAVEPOINT challenge');
      insert.run(...valid);
      assert.equal(db.prepare('SELECT quantity FROM books WHERE id=?').get(id).quantity, 1,
        `${label}: otherwise identical positive control INSERT succeeds`);
      db.exec('ROLLBACK TO challenge');
      db.exec('RELEASE challenge');
      const invalid = [...valid];
      invalid[change.index] = change.value;
      assert.throws(() => insert.run(...invalid), expectedError,
        `${label}: only the tested field triggers its matching SQLite constraint`);
    };
    challenge(101, { index: 1, value: skuA }, /UNIQUE constraint failed: books.sku/,
      'duplicate SKU');
    challenge(102, { index: 3, value: -1 }, /CHECK constraint failed:/,
      'negative quantity');
    challenge(103, { index: 4, value: -1 }, /CHECK constraint failed:/,
      'negative cents');
    challenge(104, { index: 1, value: null }, /NOT NULL constraint failed: books.sku/,
      'null SKU');
    challenge(105, { index: 2, value: null }, /NOT NULL constraint failed: books.name/,
      'null name');
    challenge(106, { index: 3, value: null }, /NOT NULL constraint failed: books.quantity/,
      'null quantity');
    challenge(107, { index: 4, value: null }, /NOT NULL constraint failed: books.priceCents/,
      'null cents');
  } finally { db.exec('ROLLBACK'); db.close(); }
  inspect(expected, 'constraint rollback');
}

assert.equal(fs.existsSync(dbPath), false, 'new isolated DB path');
accepted([['add', skuA, nameA, quantityA, centsA]], [rowA], 'first create');
inspect([rowA], 'first process exit');
checkConstraints([rowA]);
accepted([['get', 1], ['add', skuB, nameB, quantityB, centsB], ['list']],
  [rowA, rowB, [rowA, rowB]], 'second process reopens existing DB');
inspect([rowA, rowB], 'second process exit');
accepted([['search', needle], ['search', '%'], ['search', '_'], ['search', skuB],
  ['search', 'alpha'], ['search', "%\' OR 1=1 --"], ['get', 9999]],
  [[rowA], [rowB], [rowB], [rowB], [], [], null],
  'literal case-sensitive SQL metacharacter search and missing get');
inspect([rowA, rowB], 'search has no effect');

const updatedB = { ...rowB, name: 'Updated ' + nameB, quantity: quantityB + 3 };
accepted([['update', 2, { name: updatedB.name, quantity: updatedB.quantity }], ['get', 2]],
  [updatedB, updatedB], 'update only named fields');
inspect([rowA, updatedB], 'update committed');
accepted([['delete', 2], ['list']], [true, [rowA]], 'delete persisted row');
inspect([rowA], 'delete committed');
accepted([['add', skuC, nameC, 0, 0], ['list']], [rowC, [rowA, rowC]],
  'database ID never reused after deleting latest row');
inspect([rowA, rowC], 'third create committed');
accepted([['search', '雪']], [[rowC]], 'Unicode search survives SQLite process reopen');
inspect([rowA, rowC], 'Unicode search has no effect');

for (const [commands, label] of [
  [[['add', skuA, 'duplicate', 1, 1]], 'duplicate SKU'],
  [[['add', '', 'book', 1, 1]], 'blank SKU'],
  [[['add', 'new', '  ', 1, 1]], 'blank name'],
  [[['add', 'new', 'book', -1, 1]], 'negative quantity'],
  [[['add', 'new', 'book', 1.5, 1]], 'fractional quantity'],
  [[['add', 'new', 'book', Number.MAX_SAFE_INTEGER + 1, 1]], 'unsafe quantity'],
  [[['add', 4, 'book', 1, 1]], 'numeric SKU'],
  [[['add', 'new', null, 1, 1]], 'null name'],
  [[['add', 'new', 'book', 1, '4']], 'string cents'],
  [[['add', 'new', 'book', 1, -1]], 'negative cents'],
  [[['add', 'new', 'book', 1, 1.5]], 'fractional cents'],
  [[['add', 'new', 'book', 1, Number.MAX_SAFE_INTEGER + 1]], 'unsafe cents'],
  [[['get', 0]], 'zero ID'],
  [[['get', -1]], 'negative ID'],
  [[['get', 1.5]], 'fractional ID'],
  [[['get', '1']], 'string ID'],
  [[['get', Number.MAX_SAFE_INTEGER + 1]], 'unsafe ID'],
  [[['search', '  ']], 'blank query'],
  [[['update', 1, {}]], 'empty patch'],
  [[['update', 1, { bad: 7 }]], 'unknown patch field'],
  [[['update', 9999, { quantity: 1 }]], 'missing update ID'],
  [[['delete', 9999]], 'missing delete ID'],
  [[['unknown']], 'unknown operation'],
]) {
  rejected(commands, label);
  inspect([rowA, rowC], label + ': DB unchanged');
}
for (const [commands, label] of [
  [[['add', skuBatch, 'batch', 1, 10], ['unknown']], 'valid add before unknown command'],
  [[['add', skuBatch, 'batch', 1, 10], ['add', skuA, 'duplicate', 1, 10]],
    'valid add before SQLite uniqueness error'],
  [[['add', skuBatch, 'batch', 1, 10], ['add', 'wrong-arity']],
    'valid add before malformed tuple'],
  [[['add', skuBatch, 'batch', 1, 10], null],
    'valid add before non-tuple command'],
]) {
  rejected(commands, label);
  inspect([rowA, rowC], label + ': entire batch rolled back');
}

// Only the two declared pure leaf modules enter a VM realm. Native SQLite,
// service, store, CLI and app remain in separate subject processes. All input
// objects are created inside the realm; no host callback or object is exposed.
async function checkPureLeaves() {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });
  context.console = undefined;
  const modules = new Map();
  for (const name of ['query', 'validate']) {
    const identifier = `src/${name}.js`;
    const module = new vm.SourceTextModule(fs.readFileSync(identifier, 'utf8'), {
      context, identifier,
      importModuleDynamically: () => { throw new Error('dynamic imports denied'); },
    });
    await module.link(() => { throw new Error(`${identifier}: undeclared dependency denied`); });
    await module.evaluate({ timeout: 1000 });
    modules.set(name, module);
  }
  const evaluate = source => vm.runInContext(source, context, { timeout: 1000 });
  for (const name of ['process', 'console', 'Buffer', 'requ' + 'ire', 'structuredClone'])
    assert.equal(evaluate(`typeof ${name}`), 'undefined', `${name} absent from pure leaf realm`);
  context.searchRows = modules.get('query').namespace.searchRows;
  context.validateId = modules.get('validate').namespace.validateId;
  context.validatePatch = modules.get('validate').namespace.validatePatch;
  const token = 'pure_' + randomBytes(8).toString('hex');
  evaluate(`globalThis.rows = [
    {id:3,sku:'SKU-3',name:'third ${token}',quantity:3,priceCents:300},
    {id:1,sku:'${token}',name:'first',quantity:1,priceCents:100},
    {id:2,sku:'SKU-2',name:'other',quantity:2,priceCents:200}];
    globalThis.first=searchRows(rows,'${token}');
    globalThis.second=searchRows(rows,'${token}');`);
  const rows = evaluate('rows'), first = evaluate('first'), second = evaluate('second');
  const values = records => Array.from(records, row =>
    [row.id, row.sku, row.name, row.quantity, row.priceCents]);
  assert.deepEqual(values(rows), [
    [3, 'SKU-3', `third ${token}`, 3, 300],
    [1, token, 'first', 1, 100],
    [2, 'SKU-2', 'other', 2, 200],
  ], 'pure query did not mutate input fields or order');
  assert.deepEqual(values(first).map(row => row[0]), [1, 3], 'pure query filters and sorts real rows');
  assert.deepEqual(values(second), values(first), 'second query has exact rows');
  assert.notEqual(first, rows, 'query returns a new array');
  assert.notEqual(first, second, 'each query returns a new array');
  const realmPlainPrototype = evaluate('Object.prototype');
  for (const [index, id] of [1, 3].entries()) {
    const source = Array.from(rows).find(row => row.id === id);
    assert.notEqual(first[index], source, 'query returns a new row object');
    assert.notEqual(first[index], second[index], 'query calls return independent rows');
    assert.ok([realmPlainPrototype, null].includes(Object.getPrototypeOf(first[index])),
      'query returns plain realm object');
    assert.deepEqual(Object.keys(first[index]).sort(),
      ['id', 'sku', 'name', 'quantity', 'priceCents'].sort(), 'exact row fields');
  }
  evaluate("first[0].name='tampered'");
  assert.equal(second[0].name, 'first', 'second result is independent after mutation');
  assert.equal(Array.from(rows).find(row => row.id === 1).name, 'first', 'input row is independent');
  evaluate('validateId(1); validatePatch({name:"valid"})');
  for (const source of [
    'validateId(0)', 'validateId(-1)', 'validateId(1.5)', 'validateId("1")',
    'validateId(Number.MAX_SAFE_INTEGER+1)', 'validateId(NaN)', 'validateId(Infinity)',
    'validatePatch(new Date())', 'validatePatch(new (class Patch {})())',
  ]) assert.throws(() => evaluate(source), error => error?.name === 'TypeError',
    `${source}: pure validator rejects invalid input`);
}
await checkPureLeaves();
console.log('SQLITE_CATALOG_ORACLE_PASS');
