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
export const ENTRY_PATH = 'src/index.mjs';
export const ORACLE_SOURCE = `import assert from 'node:assert/strict';
import { run } from '../src/app.js';

const commands = [
  ['add', 12.5, 'food'], ['add', 7.25, 'travel'], ['add', 3.5, 'food'],
  ['total'], ['categories'], ['list'], ['list'],
];
const result = run(commands);
assert.ok(Array.isArray(result) && result.length === commands.length, 'one result per command');
assert.equal(result[3], 23.25, 'sum must use all three decimal amounts');
assert.deepEqual(result[4], { food: 16, travel: 7.25 }, 'category sums');
assert.ok(Array.isArray(result[5]) && result[5].length === 3, 'all rows listed');
assert.deepEqual(result[5].map(row => [row.amount, row.category]),
  [[12.5, 'food'], [7.25, 'travel'], [3.5, 'food']], 'rows preserve order and values');
result[5][0].amount = 999;
assert.equal(result[6][0].amount, 12.5, 'list returns independent row copies');
assert.deepEqual(run([['list'], ['total'], ['categories']]), [[], 0, {}], 'each run starts empty');
for (const amount of [0, -1, NaN, Infinity, -Infinity, '4']) {
  assert.throws(() => run([['add', amount, 'food']]), 'invalid amount: ' + String(amount));
}
for (const category of ['', '   ', 4, null]) {
  assert.throws(() => run([['add', 1, category]]), 'invalid category: ' + String(category));
}
assert.throws(() => run([['unknown']]), 'unknown operation is rejected');
console.log('PROJECT_APP_ORACLE_PASS');
`;

// The new project's package.json already executes this entrypoint via npm start.
// It is fixed before inference; the model writes only LEDGER_FILES.
export const ENTRY_SOURCE = `import { run } from './app.js';
const commands = JSON.parse(process.argv[2] ?? '[]');
if (!Array.isArray(commands)) throw new TypeError('commands must be an array');
process.stdout.write(JSON.stringify(run(commands)) + '\\n');
`;

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const ORACLE_SHA256 = sha256(ORACLE_SOURCE);
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
  assert.equal(sha256(readFile(projectRoot, ENTRY_PATH)), ENTRY_SHA256, 'frozen entrypoint bytes');
}

export function assertLedgerCLIResults(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 6, 'CLI command count');
  assert.equal(rows[3], 23.25, 'CLI total');
  assert.deepEqual(rows[4], { food: 16, travel: 7.25 }, 'CLI grouped totals');
  assert.deepEqual(rows[5].map(row => [row.amount, row.category]),
    [[12.5, 'food'], [7.25, 'travel'], [3.5, 'food']], 'CLI list values and order');
}
