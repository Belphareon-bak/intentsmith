#!/usr/bin/env node
// Review paired judge disagreements without running a model. The planning
// packet hides model and judge identities and does not show their grades.
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { ModelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { collectionEvidenceHash, persistAdjudicatedCollection,
  reconcileGraderReviews, storedGraderReviews } from '../src/eval/grade-answer-collection.js';

const fail = code => { throw new Error(code); };
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function buildBlindAdjudicationPacket(history, plan, collection) {
  const reviews = storedGraderReviews(history, plan, collection);
  const pending = reconcileGraderReviews(reviews, plan, collection);
  if (pending.status !== 'REVIEW_DISPUTED' || !pending.disputes.length)
    fail('EVALUATION_ADJUDICATION_NOT_DISPUTED');
  return {
    status: 'REVIEW_DISPUTED',
    instruction: 'Grade the captured answer against the public criteria before opening either judge review. Keep model and judge identities hidden. Every criterion needs a score, observed evidence and reason.',
    decision: {
      schemaVersion: 1, sourceRunId: collection.runId,
      sourceSha256: collectionEvidenceHash(collection),
      firstReviewId: reviews[0].id, secondReviewId: reviews[1].id,
      review: { reviewer: null, reference: null, reason: null,
        reviewedAt: null, blindToModel: true, independent: true },
      decisions: pending.disputes.map(row => ({ task: row.task, repeat: row.repeat,
        parts: row.firstParts.map((part, i) => ({ criterion: i + 1,
          score: null, evidence: null, reason: null })) }))
    },
    cases: pending.disputes.map(row => {
      const source = collection.tasks.find(task => task.name === row.task);
      const test = plan.suite.tests.find(task => task.name === row.task);
      if (!source || !test || !Array.isArray(row.firstParts)) fail('EVALUATION_ADJUDICATION_SOURCE_CHANGED');
      const criteria = test.semanticReference?.criteria || test.rubric;
      if (!Array.isArray(criteria) || criteria.length !== row.firstParts.length)
        fail('EVALUATION_ADJUDICATION_CRITERIA_MISMATCH');
      return { task: row.task, repeat: row.repeat, prompt: source.input,
        response: source.responses[row.repeat - 1], criteria };
    })
  };
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    console.log('Preview: node scripts/adjudicate-model-collection.mjs --plan --db=/absolute/c3.db --run-id=eval_ID > blind-packet.json\nRecord: node scripts/adjudicate-model-collection.mjs --run --db=/absolute/c3.db --run-id=eval_ID --decision=/absolute/decision.json --expected-source=SHA256 --backup=/absolute/backup.db\nThe preview omits model/judge identities and prior scores. A recorded human decision never changes a binding or enables a timer.');
    return;
  }
  const options = {};
  for (const arg of args) {
    const match = /^--(plan|run|db|run-id|decision|expected-source|backup)(?:=(.*))?$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) fail('INVALID_ADJUDICATION_ARGUMENTS');
    options[match[1]] = match[2] ?? true;
  }
  const running = options.run === true;
  if (running === (options.plan === true) || !isAbsolute(options.db || '')
    || !/^eval_[A-Za-z0-9_-]+$/.test(options['run-id'] || '')
    || (running && (!isAbsolute(options.decision || '') || !isAbsolute(options.backup || '')
      || !hash(options['expected-source']) || options.backup === options.db || existsSync(options.backup)))
    || (!running && (options.decision || options.backup || options['expected-source'])))
    fail('INVALID_ADJUDICATION_ARGUMENTS');
  const db = new Database(options.db, { fileMustExist: true, readonly: !running });
  try {
    const history = new ModelEvaluationHistory(db), collection = history.getRun(options['run-id']);
    if (!collection) fail('EVALUATION_COLLECTION_NOT_FOUND');
    const plan = createRoleEvaluationPlans({db})[collection.role];
    if (!plan?.collectionOnly) fail('EVALUATION_ADJUDICATION_ROLE_NOT_SEMANTIC');
    const packet = buildBlindAdjudicationPacket(history, plan, collection);
    if (!running) { console.log(JSON.stringify(packet, null, 2)); return packet; }
    if (packet.decision.sourceSha256 !== options['expected-source'])
      fail('EVALUATION_ADJUDICATION_SOURCE_CHANGED');
    const file = JSON.parse(readFileSync(options.decision, 'utf8'));
    const decision = file.decision || file;
    if (decision.sourceSha256 !== options['expected-source'])
      fail('EVALUATION_ADJUDICATION_SOURCE_CHANGED');
    await db.backup(options.backup);
    const saved = persistAdjudicatedCollection({history, plan, collection, decision});
    console.log(JSON.stringify({status: saved.status, runId: saved.runId,
      score: saved.score, adjudicationId: saved.metadata.grading.adjudication.id,
      backup: options.backup}));
    return saved;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
