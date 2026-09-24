#!/usr/bin/env node
// Import externally graded CHAT conversation scores (per task, one repeat) as
// ordinary COMPLETE runs of a separate pilot suite, via ModelEvaluationHistory.
// The suite name/contract never matches a role plan, so these rows cannot become
// decision authority for the running hunt; they feed planning and paired pilots.
//
// Dry run (default): backs up the DB, imports into the backup copy and verifies
// the copy with the live release's read model. --commit repeats on the live DB.
//
// node scripts/manual/import-chat-conversation-grades.mjs --grades=... --review-dir=...
//   --db=... --backup-dir=... --release=... [--commit]
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelEvaluationHistory } from '../../src/upgrade/model-evaluation-history.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const need = k => { if (!args[k]) throw new Error(`missing --${k}`); return args[k]; };
const gradesPath = need('grades'), reviewDir = need('review-dir'), dbPath = need('db');
const backupDir = need('backup-dir'), releaseDir = need('release');
const providerVersion = args['provider-version'] || '0.34.2-intentsmith.1';
const sha = b => createHash('sha256').update(b).digest('hex');

export const SUITE_NAME = 'chat_conversation_pilot';
export const WEIGHTS = Object.freeze([0.4, 0.3, 0.2, 0.1]); // factual, usefulness, conversation, communication

const review = JSON.parse(readFileSync(join(reviewDir, 'review.json'), 'utf8'));
const identities = new Map(JSON.parse(readFileSync(join(reviewDir, 'PRIVATE-identity-key.json'), 'utf8'))
  .identities.map(x => [x.id, x]));
const gradesRaw = readFileSync(gradesPath);
const grades = gradesRaw.toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const itemsByPrefix = new Map(review.items.map(i => [i.id.slice(0, 8), i]));

const contract = sha(JSON.stringify({ suite: SUITE_NAME, reviewSha256: sha(readFileSync(join(reviewDir, 'review.json'))),
  gradesSha256: sha(gradesRaw), weights: WEIGHTS, grader: 'claude-opus-5.5/external-interim/rubric.2-draft' }));

const perModel = new Map();
for (const g of grades) {
  const item = itemsByPrefix.get(g.id);
  if (!item || item.task !== g.task || g.g.length !== 4 || g.g.some(x => ![0, 0.25, 0.5, 0.75, 1].includes(x)))
    throw new Error(`INVALID_GRADE:${g.id}`);
  const id = identities.get(item.id);
  const key = id.digestSha256;
  if (!perModel.has(key)) perModel.set(key, { modelName: id.model, digestSha256: key, tasks: [] });
  const score = WEIGHTS.reduce((s, w, i) => s + w * g.g[i], 0);
  perModel.get(key).tasks.push({ name: item.task, language: item.task.slice(0, 2), independenceGroup: item.independenceGroup,
    mean: score, spread: 0, scores: [score], rubric: item.criteria.map(c => c.id),
    details: [{ conversationId: item.id, repeat: id.repeat, captureStatus: item.captureStatus,
      criterionGrades: item.criteria.map((c, i) => ({ id: c.id, axis: c.axis, score: g.g[i] })),
      note: g.n || null, formatStrict: g.fmt ?? null }] });
}
if (perModel.size !== 10) throw new Error(`EXPECTED_10_MODELS:${perModel.size}`);
for (const m of perModel.values()) {
  if (m.tasks.length !== 40 || new Set(m.tasks.map(t => t.name)).size !== 40
    || new Set(m.tasks.map(t => t.independenceGroup)).size !== 20) throw new Error(`INCOMPLETE_MODEL:${m.modelName}`);
  m.tasks.sort((a, b) => a.name.localeCompare(b.name));
}

function importInto(path) {
  const db = new Database(path, { fileMustExist: true });
  const history = new ModelEvaluationHistory(db);
  history.setProviderVersion(providerVersion);
  const now = new Date().toISOString(), out = [];
  const tx = db.transaction(() => {
    for (const m of perModel.values()) {
      const score = m.tasks.reduce((s, t) => s + t.mean, 0) / m.tasks.length;
      out.push(history.recordComplete({
        artifact: { modelName: m.modelName, digestSha256: m.digestSha256 },
        role: 'CHAT', suiteName: SUITE_NAME, suiteVersion: 'chat-conversation.2-draft+opus-interim.1',
        contractSha256: contract, hardware: {}, fresh: false, startedAt: now, completedAt: now, durationMs: 0,
        metadata: { source: 'external-interim-grading-pilot', decisionAuthority: false,
          externalGrading: { status: 'EXTERNAL_INTERIM_NOT_ACCEPTED', grader: 'claude-opus-5.5', blind: true,
            exposure: 'grader analysed the same panel with identities earlier in the session',
            weights: WEIGHTS, gradesFile: gradesPath, gradesSha256: sha(gradesRaw), repeatUsed: 1,
            infraSubstitution: 'repeat 2 used where repeat 1 was a TRANSPORT_ERROR at a window boundary' },
          collection: { reviewDir, reviewSha256: sha(readFileSync(join(reviewDir, 'review.json'))) } },
        summary: { score, runs: 1, tasks: m.tasks, durationMs: 0, startedAt: now, completedAt: now },
      }));
    }
  });
  tx.immediate();
  db.close();
  return out;
}

async function verify(path, runIds) {
  const { ModelEvaluationReadModel } = await import(join(releaseDir, 'src/upgrade/model-evaluation-read-model.js'));
  const db = new Database(path, { readonly: true, fileMustExist: true });
  const rm = new ModelEvaluationReadModel(db);
  const snapshot = rm.read({});
  for (const id of runIds) {
    const run = rm.readRun(id);
    if (run.status !== 'COMPLETE' || run.tasks.length !== 40) throw new Error(`VERIFY_FAILED:${id}`);
  }
  db.close();
  return { historyRows: snapshot.history.length, verifiedRuns: runIds.length };
}

mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(backupDir, `c3-before-chat-pilot-${stamp}.db`);
const live = new Database(dbPath, { fileMustExist: true });
await live.backup(backup);
live.close();
console.error(`backup: ${backup}`);

// The backup stays pristine for restore; the dry run writes into a separate copy.
const dryCopy = `${backup}.dryrun.db`;
copyFileSync(backup, dryCopy);
const dry = importInto(dryCopy);
console.error(`dry run on copy: ${dry.map(r => `${r.runId || r.run_id}${r.reused ? '(reused)' : ''}`).join(', ')}`);
console.error('dry verify:', JSON.stringify(await verify(dryCopy, dry.map(r => r.runId || r.run_id))));

if (args.commit) {
  if (!existsSync(backup)) throw new Error('BACKUP_MISSING');
  const done = importInto(dbPath);
  console.error('live verify:', JSON.stringify(await verify(dbPath, done.map(r => r.runId || r.run_id))));
  console.log(JSON.stringify({ status: 'IMPORTED', suite: SUITE_NAME, contract, backup,
    runs: done.map(r => ({ runId: r.runId || r.run_id, reused: !!r.reused })) }, null, 1));
} else {
  console.log(JSON.stringify({ status: 'DRY_RUN_ONLY', suite: SUITE_NAME, contract, backup }, null, 1));
}
