#!/usr/bin/env node
// Offline replay of a sealed raw collection. No model calls, DB or activation.
// Operator 2026-09-20: evaluation must use the production JSON extraction chain.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extractJSON } from '../../src/llm/client.js';
import { readRuntimeJson, RUNTIME_JSON_CONTRACT } from '../../src/eval/runtime-json.js';
import { SEMANTIC_ROLE_SUITES } from '../../src/eval/semantic-role-suites.js';
import { visionV2Suite } from '../../src/eval/role-quality-suites.js';

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log('Usage: node scripts/manual/replay-structured-grades.mjs --input /absolute/answers-for-review.json --previous /absolute/deterministic-assessment-final.json --out /absolute/new-directory');
  process.exit(0);
}
if (args.length !== 6 || args[0] !== '--input' || args[2] !== '--previous' || args[4] !== '--out'
  || ![args[1], args[3], args[5]].every(isAbsolute)) throw Error('INVALID_ARGUMENTS');
const [input, previous, out] = [args[1], args[3], args[5]];
if (existsSync(out)) throw Error('OUTPUT_ALREADY_EXISTS');
const hash = data => createHash('sha256').update(data).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceBytes = readFileSync(input), oldBytes = readFileSync(previous);
const data = JSON.parse(sourceBytes), old = JSON.parse(oldBytes);
assert.equal(old.inputSha256, hash(sourceBytes), 'Previous report belongs to another raw collection');
const before = new Map(old.items.map(row => [row.id, row]));
const tasks = new Map([...visionV2Suite.tests.map(task => ['VISION/'+task.name, task]),
  ...SEMANTIC_ROLE_SUITES.CHAT.tests.map(task => ['CHAT/'+task.name, task])]);
const manifest = {
  status: 'REPLAY_COMPLETE_REVIEW_PENDING', startedAt: new Date().toISOString(),
  sourceRevision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: !!execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
  inputSha256: hash(sourceBytes), previousReportSha256: hash(oldBytes), parser: RUNTIME_JSON_CONTRACT,
  inferenceCalls: 0, productionImported: false, decisionAuthority: false,
  limitations: ['Scores are extracted-field accuracy, not Direction rubric grades or semantic acceptance.',
    'Surrounding prose is treated exactly as production: it may be contradictory. No semantic claim follows from parsing.',
    'Unparseable content and open T4 answers still need review; output-budget exhaustion remains visible.'],
  shapes: {}, byRole: {}, items: [],
};
const bump = (obj, key) => obj[key] = (obj[key] || 0) + 1;
// Shape labels are diagnostics only. They NEVER select the evaluation value.
function shape(response) {
  try { JSON.parse(response); return 'DIRECT'; } catch {}
  const fence = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { JSON.parse(fence[1].trim()); return fence[0] === response.trim() ? 'WHOLE_FENCE' : 'FENCE_WITH_PROSE'; } catch {} }
  const a = response.indexOf('{'), b = response.lastIndexOf('}');
  if (a >= 0 && b > a) { try { JSON.parse(response.slice(a, b+1)); return 'OBJECT_BOUNDARIES'; } catch {} }
  return extractJSON(response) === null ? 'UNPARSEABLE' : 'OTHER_PRODUCTION_RECOVERY';
}
for (const row of data.items) {
  const task = tasks.get(row.inputKey);
  const messages = data.inputs[row.inputKey]?.messages;
  if (!task || !messages?.some(m => m.role === 'user' && /JSON/i.test(m.content))) continue;
  assert.equal(hash(row.response), row.responseSha256, row.id);
  assert.equal(before.get(row.id)?.responseSha256, row.responseSha256, row.id);
  // A replay cannot silently use a newly changed public question.
  assert.ok(messages.some(m => m.role === 'user' && m.content === task.promptText), row.inputKey);
  const { value, ...parsing } = readRuntimeJson(row.response);
  assert.deepEqual(value, extractJSON(row.response), row.id);
  const record = { id: row.id, role: row.role, task: row.task, responseSha256: row.responseSha256,
    collectionStatus: row.status, shape: shape(row.response), ...parsing, parsed: value,
    previous: { score: before.get(row.id).score, passed: before.get(row.id).passed, detail: before.get(row.id).detail },
    current: null, contentAccuracy: null };
  if (row.status === 'CAPTURED' && (row.role === 'VISION' || task.tier === 'T2')) {
    record.current = task.grade(row.response);
    assert.equal(record.current.detail.runtimeParsed, parsing.runtimeParsed, row.id);
    if (value && typeof value === 'object' && !Array.isArray(value))
      assert.deepEqual(record.current.detail.observed, value, row.id);
    record.contentAccuracy = record.current.detail.contentScore;
  }
  bump(manifest.shapes, record.shape);
  const stats = manifest.byRole[row.role] ||= { attempts: 0, runtimeParsed: 0, graded: 0, contentScoreChanged: 0, passChanged: 0, unparseable: 0, outputBudgetExhausted: 0 };
  stats.attempts++; stats.runtimeParsed += Number(parsing.runtimeParsed);
  stats.unparseable += Number(!parsing.runtimeParsed);
  stats.outputBudgetExhausted += Number(row.status === 'OUTPUT_BUDGET_EXHAUSTED');
  if (record.current) {
    stats.graded++;
    stats.contentScoreChanged += Number(record.current.score !== record.previous.score);
    stats.passChanged += Number(record.current.passed !== record.previous.passed);
  }
  manifest.items.push(record);
}
assert.equal(new Set(manifest.items.map(row => row.id)).size, manifest.items.length);
assert.equal(hash(readFileSync(input)), manifest.inputSha256, 'Raw data mutated');
assert.equal(hash(readFileSync(previous)), manifest.previousReportSha256, 'Previous report mutated');
manifest.finishedAt = new Date().toISOString();
manifest.total = manifest.items.length;
manifest.runtimeParityChecks = manifest.items.length;
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'replay.json'), JSON.stringify(manifest, null, 2)+'\n', { flag: 'wx' });
const {items, ...summary} = manifest;
summary.changedItems = items.filter(r => r.current && (r.current.score !== r.previous.score || r.current.passed !== r.previous.passed))
  .map(r => ({id:r.id, role:r.role, task:r.task, before:r.previous.score, after:r.current.score, contentAccuracy:r.contentAccuracy, shape:r.shape}));
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2)+'\n', { flag: 'wx' });
console.log(JSON.stringify({total:manifest.total, shapes:manifest.shapes, byRole:manifest.byRole}, null, 2));
