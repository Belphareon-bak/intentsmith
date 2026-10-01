// Frozen operator-owned acceptance for the six generated files in
// docs/PROJECT-BUILD.md. Neither the model nor its proposed files own this test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const LEDGER_FILES = Object.freeze([
  { path: 'src/app.js', instruction: 'Re-export run from cli as the public entrypoint.', dependsOn: ['src/cli.js'] },
  { path: 'src/cli.js', instruction: 'Export run(commands): add takes amount/category; list, total, categories return results; unknown operation throws. Each run has a fresh service.', dependsOn: ['src/service.js'] },
  { path: 'src/service.js', instruction: 'Export createService(): expose ledger add/list, total() and categories() using the totals module.', dependsOn: ['src/storage.js', 'src/totals.js'] },
  { path: 'src/storage.js', instruction: 'Export createLedger(): add(amount,category) validates and stores one item; list() returns copies.', dependsOn: ['src/validate.js'] },
  { path: 'src/totals.js', instruction: 'Export total(rows) and categories(rows), summing numeric amount, also grouped by category.', dependsOn: [] },
  { path: 'src/validate.js', instruction: 'Export validate(amount,category). Require a finite positive number (no string coercion) and a non-whitespace string category; throw otherwise.', dependsOn: [] },
]);

export const ORACLE_PATH = 'test/acceptance.test.mjs';
export const PROBE_PATH = 'test/subject-probe.mjs';
export const ENTRY_PATH = 'src/index.mjs';
export const ORACLE_SOURCE = `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';

// This trusted process never imports generated modules. The fixed entrypoint
// loads them in a separate, sandbox-contained child process only.
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
const extra = completeJSON(['test/subject-probe.mjs']);
assert.deepEqual(extra.failures, [true, true, true], 'nonfinite amounts throw');
assert.equal(extra.distinct, true, 'list returns independent row copies');
console.log('PROJECT_APP_ORACLE_PASS');
`;

// This child is untrusted as soon as it loads generated app.js. Its parent
// validates the complete JSON result; an early exit cannot claim success.
export const PROBE_SOURCE = `import { run } from '../src/app.js';
const failures = [NaN, Infinity, -Infinity].map(amount => {
  try { run([['add', amount, 'food']]); return false; }
  catch { return true; }
});
const rows = run([['add', 12.5, 'food'], ['list'], ['list']]);
const distinct = rows[1] !== rows[2] && rows[1][0] !== rows[2][0];
process.stdout.write(JSON.stringify({ failures, distinct }) + '\\n');
`;

export function policyForFrozenOracle(policy) {
  assert.equal(policy.policyId, 'intentsmith-local-project-v1');
  assert.ok(policy.layers?.some(layer => layer.roots?.includes('test')));
  const imports = new Set(policy.externalImports);
  imports.add('node:child_process');
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
export const ENTRY_SHA256 = sha256(ENTRY_SOURCE);

export function ledgerBlueprint() {
  return {
    instruction: 'Build a small in-memory expense ledger with a command entrypoint and no external dependencies.',
    files: LEDGER_FILES.map(file => ({ ...file, dependsOn: [...file.dependsOn] })),
    focusedTest: {
      binary: '/usr/bin/node', argv: [ORACLE_PATH],
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
  assert.equal(sha256(readFile(projectRoot, ENTRY_PATH)), ENTRY_SHA256, 'frozen entrypoint bytes');
}

export function assertLedgerCLIResults(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 6, 'CLI command count');
  assert.equal(rows[3], 23.25, 'CLI total');
  assert.deepEqual(rows[4], { food: 16, travel: 7.25 }, 'CLI grouped totals');
  assert.deepEqual(rows[5].map(row => [row.amount, row.category]),
    [[12.5, 'food'], [7.25, 'travel'], [3.5, 'food']], 'CLI list values and order');
}
