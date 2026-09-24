// End-to-end planner script over an isolated synthetic evaluation DB: exact
// suite identities, separate results per suite, one locked tolerance, and no
// dependence on run recency. Read-only for the script; no models, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/hunt-decision-feasibility.mjs', import.meta.url));
const HIST = 'a'.repeat(64), CONV = 'c'.repeat(64), DECOY = 'd'.repeat(64);
const DIGEST = { inc: '1'.repeat(64), cand: '2'.repeat(64), other: '3'.repeat(64) };
const dir = mkdtempSync(join(tmpdir(), 'hunt-feasibility-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const bindings = join(dir, 'bindings.json');
writeFileSync(bindings, JSON.stringify({ bindingResponse: { bindings: { CHAT: 'inc' } } }));

// Historical suite: 12 groups only derivable from task names (cs_/en_ pairs);
// the candidate loses one group by 0.5. Conversation suite: 10 explicit groups,
// candidate +0.3 everywhere. Decoy: same conversation name, another contract.
const hist = score => ['cs', 'en'].flatMap(l => Array.from({ length: 12 }, (_, i) =>
  ({ name: `${l}_t${String(i).padStart(2, '0')}`, mean: score(i) })));
const conv = score => ['cs', 'en'].flatMap(l => Array.from({ length: 10 }, (_, i) =>
  ({ name: `${l}_c${i}`, independenceGroup: `c${i}`, mean: score })));
function makeDb(name, { swapRecency = false } = {}) {
  const path = join(dir, name), db = new Database(path);
  db.exec(`CREATE TABLE model_evaluation_runs (role TEXT, status TEXT, suite_name TEXT, suite_contract_sha256 TEXT,
    model_name TEXT, model_digest_sha256 TEXT, task_results_json TEXT, completed_at TEXT)`);
  const at = { inc: swapRecency ? '2026-09-02' : '2026-09-01', cand: swapRecency ? '2026-09-01' : '2026-09-02', other: '2026-09-03' };
  const rows = [
    ['chat_v3', HIST, 'inc', hist(() => 0.8), at.inc], ['chat_v3', HIST, 'cand', hist(i => (i === 0 ? 0.3 : 0.8)), at.cand],
    ['chat_v3', HIST, 'other', hist(() => 0.5), at.other],
    ['conversation', CONV, 'inc', conv(0.6), '2026-09-10'], ['conversation', CONV, 'cand', conv(0.9), '2026-09-10'],
    ['conversation', DECOY, 'inc', conv(0.6), '2026-09-20'], ['conversation', DECOY, 'cand', conv(0), '2026-09-20'],
  ];
  const insert = db.prepare('INSERT INTO model_evaluation_runs VALUES (?,?,?,?,?,?,?,?)');
  for (const [suite, contract, model, tasks, completed] of swapRecency ? [...rows].reverse() : rows)
    insert.run('CHAT', 'COMPLETE', suite, contract, model, DIGEST[model], JSON.stringify(tasks), completed);
  db.close();
  return path;
}
const first = makeDb('first.sqlite'), swapped = makeDb('swapped.sqlite', { swapRecency: true });

function plan(db, ...extra) {
  const out = join(dir, `out-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [SCRIPT, `--db=${db}`, `--bindings=${bindings}`, '--role=CHAT', '--sims=20', `--out=${out}`, ...extra],
    { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, report: r.status === 0 ? JSON.parse(readFileSync(out, 'utf8')) : null };
}
const candidate = demo => demo.rows.find(r => r.candidate === 'cand');

test('an added suite needs its exact contract; a same-named suite is never picked up', () => {
  const byName = plan(first, '--extra-suite=CHAT:conversation');
  assert.notEqual(byName.status, 0);
  assert.match(byName.stderr, /EXTRA_SUITE_CONTRACT_REQUIRED/);
  const { report } = plan(first, `--extra-suite=CHAT:conversation@${CONV}`);
  const chat = report.roles.CHAT;
  assert.deepEqual(chat.components.map(c => [c.kind, c.suite, c.contract, c.selection]),
    [['main', 'chat_v3', HIST, 'WIDEST_COVERAGE'], ['extra', 'conversation', CONV, 'PINNED']]);
  // The newer decoy contract (candidate 0 everywhere) would make this negative.
  assert.equal(candidate(chat.components[1].demo).meanDelta, 0.3);
  const pinned = plan(first, `--suite=CHAT:conversation@${DECOY}`).report.roles.CHAT;
  assert.deepEqual([pinned.contract, pinned.components[0].selection, candidate(pinned.demo).meanDelta], [DECOY, 'PINNED', -0.6]);
});

test('a union of suites is labelled exploratory and each suite is reported on its own', () => {
  const chat = plan(first, `--extra-suite=CHAT:conversation@${CONV}`).report.roles.CHAT;
  assert.equal(chat.combination, 'EXPLORATORY_UNION_NOT_AN_ACCEPTED_SUITE');
  assert.deepEqual(chat.components.map(c => [c.groups, c.groupSource]), [[12, 'ASSUMED_NAME_GROUPS'], [10, 'EXPLICIT']]);
  assert.deepEqual(chat.components.map(c => [candidate(c.demo).groups, candidate(c.demo).meanDelta]), [[12, -0.042], [10, 0.3]]);
  assert.deepEqual([candidate(chat.demo).groups, candidate(chat.demo).meanDelta], [22, 0.114]);
  for (const c of chat.components) assert.equal(c.incumbentPairs.orientation, 'candidate-minus-incumbent');
  assert.equal(plan(first).report.roles.CHAT.combination, 'SINGLE_SUITE');
});

test('one non-inferiority tolerance, 0.02 unless changed explicitly', () => {
  const margins = r => [r.nonInferiorityMargin, r.roles.CHAT.nonInferiorityMargin,
    r.roles.CHAT.incumbentPairs.pairedT.nonInferiorityMargin, r.roles.CHAT.pairedTCalibrated.nonInferiorityMargin,
    r.roles.CHAT.demo.margin];
  assert.deepEqual(margins(plan(first).report), [0.02, 0.02, 0.02, 0.02, 0.02]);
  assert.deepEqual(margins(plan(first, '--ni-margin=0.05').report), [0.05, 0.05, 0.05, 0.05, 0.05]);
  assert.equal(plan(first).report.roles.CHAT.pairedTMargin005.nonInferiorityMargin, 0.05, 'R2 proposal stays a named diagnostic');
});

test('swapping run recency and row order leaves every role result unchanged', () => {
  const args = [`--extra-suite=CHAT:conversation@${CONV}`, '--also-groups=15'];
  const a = plan(first, ...args).report.roles, b = plan(swapped, ...args).report.roles;
  assert.deepEqual(b, a);
  assert.ok(candidate(a.CHAT.components[0].demo).pairedT.lower < 0, 'the historical loss stays a loss');
});
