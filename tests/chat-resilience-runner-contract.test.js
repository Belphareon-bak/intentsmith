// The final resilience corpus is immutable within a three-run acceptance
// series. These negative cases exercise the runner's pre-inference guard only.
import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = path.join(root, 'scripts/measure-m1-l3.js');
const original = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/chat-resilience-final.json'), 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'intentsmith-resilience-contract-'));

function run(corpus, options = {}) {
  const file = path.join(scratch, `corpus-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(corpus));
  return spawnSync(process.execPath, [runner, '--isolated-chat', '--offline',
    '--phase', options.phase || 'pilot-contract', '--corpus', file,
    '--record', path.join(scratch, 'unused.json')], {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function rejected(corpus, expected, options) {
  const result = run(corpus, options);
  assert.notEqual(result.status, 0, 'invalid final corpus must fail before inference');
  assert.match(result.stderr, expected);
}

try {
  const accepted = run(original);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /"status":"OFFLINE_CORPUS_VALIDATED","cases":53,"modelCalls":0/u);

  const incomplete = structuredClone(original);
  incomplete.cases.pop();
  rejected(incomplete, /53 declared cases/u);

  const contaminatedHoldout = structuredClone(original);
  contaminatedHoldout.cases.find(entry => entry.family === 'F13').usedForTuning = true;
  rejected(contaminatedHoldout, /eight untouched holdout families/u);

  const wrongApprovalSource = structuredClone(original);
  wrongApprovalSource.cases.find(entry => entry.id === 'save-next').approve.fromCase = 'http';
  rejected(wrongApprovalSource, /Invalid previous-answer source/u);

  rejected(original, /Unknown or duplicate selected case/u, {
    env: { CHAT_PROBE_CASES: 'missing-case' },
  });
  rejected(original, /Final phase cannot filter cases/u, {
    phase: 'final-1', env: { CHAT_PROBE_CASES: 'http-plain' },
  });
  rejected(original, /Final phase requires direct A\/B baseline/u, {
    phase: 'final-1', env: { CHAT_PROBE_NO_DIRECT: 'true' },
  });

  console.log('chat resilience runner contract: 7/7 PASS (offline, 0 model calls)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
