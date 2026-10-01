// Frozen operator-owned acceptance for the six generated files in
// docs/PROJECT-BUILD.md. Neither the model nor its proposed files own this test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const LEDGER_FILES = Object.freeze([
  { path: 'src/app.js', instruction: "Re-export run from './cli.js' as the public entrypoint. Its input is an array of command tuples and its output is one result per command in order.", dependsOn: ['src/cli.js'] },
  { path: 'src/cli.js', instruction: "Export run(commands). Commands are tuples: ['add',amount,category], ['list'], ['total'], ['categories']. Return an array of one result per command in order; add may yield undefined/null. Create a fresh service per run; throw on unknown operations or invalid arguments. Do not use object commands or return only the last result.", dependsOn: ['src/service.js'] },
  { path: 'src/service.js', instruction: 'Export createService(): create one fresh ledger; expose add(amount,category), list(), total(), categories(). list returns ordered {amount,category} rows; total and categories use those rows and the totals module.', dependsOn: ['src/storage.js', 'src/totals.js'] },
  { path: 'src/storage.js', instruction: 'Export createLedger(): add(amount,category) calls validate, then stores one {amount,category} row from the arguments. Do not depend on the return value of validate. list() returns ordered independent copies of rows; mutating a result cannot change stored rows or another result.', dependsOn: ['src/validate.js'] },
  { path: 'src/totals.js', instruction: 'Export total(rows) as the numeric sum of row.amount (0 for no rows), and categories(rows) as a plain object mapping each row.category to its numeric sum ({} for no rows). Rows have {amount,category}; do not coerce invalid amounts.', dependsOn: [] },
  { path: 'src/validate.js', instruction: 'Export validate(amount,category): throw unless amount is a finite positive number without string coercion and category is a non-whitespace string. Storage calls it for rejection and creates the row itself; no return value is required.', dependsOn: [] },
]);

export const ORACLE_PATH = 'test/acceptance.test.mjs';
export const ORACLE_BINARY = process.execPath;
export const ORACLE_ARGV = Object.freeze(['--experimental-vm-modules', ORACLE_PATH]);
export const PROBE_PATH = 'test/subject-probe.mjs';
export const VALIDATE_PATH = 'test/validate-invalid.mjs';
export const ENTRY_PATH = 'src/index.mjs';
export const ORACLE_SOURCE = `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';

// Generated modules run only in child processes or a restricted VM context.
// The outer M2 process sandbox remains the OS isolation boundary.
const entry = 'src/index.mjs';
function child(argv) {
  const result = spawnSync(process.execPath, argv, {
    cwd: process.cwd(), encoding: 'utf8', timeout: 6000, maxBuffer: 65536,
    env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, shell: false,
  });
  assert.equal(result.error, undefined, 'subject process must start and finish');
  assert.equal(result.signal, null, 'subject process must not die by signal');
  return result;
}
function completeJSON(argv) {
  const result = child(argv);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(result.stdout.trim(), JSON.stringify(parsed), 'one complete JSON result and no forged marker');
  return parsed;
}
const run = commands => completeJSON([entry, JSON.stringify(commands)]);

const commands = [
  ['add', 12.5, 'food'], ['add', 7.25, 'travel'], ['add', 3.5, 'food'],
  ['total'], ['categories'], ['list'],
];
const result = run(commands);
assert.ok(Array.isArray(result) && result.length === commands.length, 'one result per command');
assert.equal(result[3], 23.25, 'sum must use all three decimal amounts');
assert.deepEqual(result[4], { food: 16, travel: 7.25 }, 'category sums');
assert.ok(Array.isArray(result[5]) && result[5].length === 3, 'all rows listed');
assert.deepEqual(result[5].map(row => [row.amount, row.category]),
  [[12.5, 'food'], [7.25, 'travel'], [3.5, 'food']], 'rows preserve order and values');
assert.deepEqual(run([['list'], ['total'], ['categories']]), [[], 0, {}], 'fresh process starts empty');

const amountA = randomInt(31, 100), amountB = randomInt(101, 300);
const category = 'category_' + randomBytes(8).toString('hex');
const varied = run([['add', amountA, category], ['add', amountB, category], ['total'], ['categories'], ['list']]);
assert.equal(varied[2], amountA + amountB, 'new values are summed');
assert.deepEqual(varied[3], { [category]: amountA + amountB }, 'new category is grouped');
assert.deepEqual(varied[4].map(row => [row.amount, row.category]),
  [[amountA, category], [amountB, category]], 'new rows remain ordered');

for (const commands of [
  [['add', 0, 'food']], [['add', -1, 'food']], [['add', '4', 'food']],
  [['add', 1, '']], [['add', 1, '   ']], [['add', 1, 4]], [['add', 1, null]], [['unknown']],
]) {
  assert.notEqual(child([entry, JSON.stringify(commands)]).status, 0, 'invalid command must fail');
}
assert.equal(child(['test/validate-invalid.mjs', 'finite']).status, 0,
  'validate directly accepts a finite positive amount');
for (const value of ['NaN', 'Infinity', '-Infinity']) {
  assert.notEqual(child(['test/validate-invalid.mjs', value]).status, 0,
    'validate directly rejects nonfinite ' + value);
}
await checkDirectAPI();
const probeAmount = randomInt(400, 1000);
const probeCategory = 'probe_' + randomBytes(8).toString('hex');
const extra = completeJSON(['test/subject-probe.mjs',
  JSON.stringify({ amount: probeAmount, category: probeCategory })]);
assert.deepEqual(extra.before, { amount: probeAmount, category: probeCategory }, 'list snapshot before mutation');
assert.deepEqual(extra.after, { amount: probeAmount, category: probeCategory }, 'list snapshot after mutation');

// Observe storage object identity and effects in this trusted process. Child
// stdout and exit status alone can be forged by generated storage.js.
async function checkDirectAPI() {
  const globals = Object.create(null);
  globals.console = undefined;
  const context = vm.createContext(globals, {
    codeGeneration: { strings: false, wasm: false },
  });
  const modules = new Map();
  function load(relative) {
    assert.ok(relative === 'src/storage.js' || relative === 'src/validate.js', 'exact local module graph');
    if (!modules.has(relative)) modules.set(relative, new vm.SourceTextModule(
      fs.readFileSync(relative, 'utf8'), {
        context, identifier: relative,
        importModuleDynamically: () => { throw new Error('dynamic imports denied'); },
      }));
    return modules.get(relative);
  }
  const storage = load('src/storage.js');
  await storage.link((specifier, importing) => {
    assert.equal(importing.identifier, 'src/storage.js', 'only storage may depend on validate');
    assert.equal(specifier, './validate.js', 'only the declared pure dependency');
    return load(path.posix.join(path.posix.dirname(importing.identifier), specifier));
  });
  await storage.evaluate({ timeout: 1000 });
  const validator = modules.get('src/validate.js');
  assert.ok(validator, 'storage imports the validator');
  context.createLedger = storage.namespace.createLedger;
  context.validate = validator.namespace.validate;
  const evaluate = source => vm.runInContext(source, context, { timeout: 1000 });
  for (const name of ['process', 'console', 'requ' + 'ire']) {
    assert.equal(evaluate('typeof ' + name), 'undefined', name + ' absent from VM context');
  }
  evaluate('validate(17.5, "food")');
  for (const value of ['NaN', 'Infinity', '-Infinity']) {
    assert.throws(() => evaluate('validate(' + value + ', "food")'),
      'direct validator rejects nonfinite ' + value);
  }
  evaluate('globalThis.ledger=createLedger(); ledger.add(12.5, "food")');
  const first = evaluate('ledger.list()'), second = evaluate('ledger.list()');
  assert.notEqual(first, second, 'list returns a new array');
  assert.notEqual(first[0], second[0], 'list returns independent row objects');
  assert.equal(first[0].amount, 12.5, 'first direct row amount');
  assert.equal(second[0].amount, 12.5, 'second direct row amount');
  try { first[0].amount = 999; } catch { /* immutable copy is safe */ }
  assert.equal(second[0].amount, 12.5, 'second snapshot remains unchanged');
  assert.equal(evaluate('ledger.list()[0].amount'), 12.5, 'stored amount remains unchanged');
  const amount = randomInt(400, 1000), category = 'api_' + randomBytes(8).toString('hex');
  evaluate('ledger.add(' + amount + ', ' + JSON.stringify(category) + ')');
  const rows = evaluate('ledger.list()');
  assert.equal(rows.length, 2, 'direct storage row count');
  assert.equal(rows[1].amount, amount, 'direct random row amount');
  assert.equal(rows[1].category, category, 'direct random row category');
}
console.log('PROJECT_APP_ORACLE_PASS');
`;

// The fixed probe loads storage directly, so app.js cannot intercept it.
// The parent checks concrete row values after an attempted mutation.
export const PROBE_SOURCE = `import { createLedger } from '../src/storage.js';
const { amount, category } = JSON.parse(process.argv[2]);
const ledger = createLedger();
ledger.add(amount, category);
const first = ledger.list(), second = ledger.list();
if (first === second || first[0] === second[0]) throw new Error('list did not return copies');
try { first[0].amount = 999; } catch { /* immutable copy is safe */ }
const after = ledger.list();
process.stdout.write(JSON.stringify({ before: second[0], after: after[0] }) + '\\n');
`;

// The parent expects a nonzero process exit. A generated validator that merely
// reports true while accepting NaN/Infinity cannot satisfy this observation.
export const VALIDATE_SOURCE = `import { validate } from '../src/validate.js';
const values = { finite: 17.5, NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };
if (!Object.hasOwn(values, process.argv[2])) throw new Error('invalid probe selector');
validate(values[process.argv[2]], 'food');
`;

export function policyForFrozenOracle(policy) {
  assert.equal(policy.policyId, 'intentsmith-local-project-v1');
  assert.ok(policy.layers?.some(layer => layer.roots?.includes('test')));
  const imports = new Set(policy.externalImports);
  imports.add('node:child_process');
  imports.add('node:vm');
  return { ...policy, externalImports: [...imports].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))) };
}

// The new project's package.json already executes this entrypoint via npm start.
// It is fixed before inference; the model writes only LEDGER_FILES.
export const ENTRY_SOURCE = `import { run } from './app.js';
const commands = JSON.parse(process.argv[2] ?? '[]');
if (!Array.isArray(commands)) throw new TypeError('commands must be an array');
process.stdout.write(JSON.stringify(run(commands)) + '\\n');
`;

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const ORACLE_SHA256 = sha256(ORACLE_SOURCE);
export const PROBE_SHA256 = sha256(PROBE_SOURCE);
export const VALIDATE_SHA256 = sha256(VALIDATE_SOURCE);
export const ENTRY_SHA256 = sha256(ENTRY_SOURCE);

export function ledgerBlueprint() {
  return {
    instruction: 'Build a dependency-free in-memory expense ledger. Public run(commands) takes an array of command tuples and returns one result per tuple in order. Each run starts with empty state. Generate the six listed modules only.',
    files: LEDGER_FILES.map(file => ({ ...file, dependsOn: [...file.dependsOn] })),
    focusedTest: {
      binary: ORACLE_BINARY, argv: [...ORACLE_ARGV],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000,
    },
    gitCommit: {
      message: 'Implement reviewed expense ledger',
      identity: {
        authorName: 'IntentSmith Qualification', authorEmail: 'qualification@example.invalid',
        authorDate: '2026-10-01T00:00:00Z', committerName: 'IntentSmith Qualification',
        committerEmail: 'qualification@example.invalid', committerDate: '2026-10-01T00:00:00Z',
      },
    },
  };
}

export function assertLedgerPreview(diff, projectRoot, readFile, exists) {
  const expected = LEDGER_FILES.map(file => file.path).sort();
  assert.deepEqual(diff.map(file => file.path).sort(), expected, 'preview covers exactly six generated targets');
  for (const row of diff) {
    assert.equal(typeof row.after?.content, 'string', row.path + ' complete after bytes');
    assert.ok(row.after.content.trim(), row.path + ' nonempty after bytes');
    assert.equal(exists(projectRoot, row.path), false, row.path + ' absent before approval');
  }
  assert.equal(sha256(readFile(projectRoot, ORACLE_PATH)), ORACLE_SHA256, 'frozen oracle bytes');
  assert.equal(sha256(readFile(projectRoot, PROBE_PATH)), PROBE_SHA256, 'frozen subject probe bytes');
  assert.equal(sha256(readFile(projectRoot, VALIDATE_PATH)), VALIDATE_SHA256, 'frozen validator probe bytes');
  assert.equal(sha256(readFile(projectRoot, ENTRY_PATH)), ENTRY_SHA256, 'frozen entrypoint bytes');
}

export function assertLedgerCLIResults(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 6, 'CLI command count');
  assert.equal(rows[3], 23.25, 'CLI total');
  assert.deepEqual(rows[4], { food: 16, travel: 7.25 }, 'CLI grouped totals');
  assert.deepEqual(rows[5].map(row => [row.amount, row.category]),
    [[12.5, 'food'], [7.25, 'travel'], [3.5, 'food']], 'CLI list values and order');
}
