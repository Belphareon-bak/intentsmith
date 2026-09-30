#!/usr/bin/env node
// Read-only inventory of stored answer captures. Capture reuse is checked by
// the exact validator used immediately before grading; it is not grade approval.
import Database from 'better-sqlite3';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { ModelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { validateCollectionCapture } from '../src/eval/grade-answer-collection.js';

export function auditHuntCollections(db, {providerVersion=null}={}) {
  const plans = createRoleEvaluationPlans({db});
  const history = new ModelEvaluationHistory(db);
  const rows = db.prepare(`SELECT run_id FROM model_evaluation_runs
    WHERE status='BLOCKED' AND error_code IN ('EVALUATION_AWAITING_REVIEW','EVALUATION_COLLECTION_PARTIAL')
    ORDER BY completed_at DESC, run_id DESC`).all();
  const collections = rows.map(({run_id}) => {
    const collection = history.getRun(run_id), plan = plans[collection.role];
    let captureReusable = false, blockCode = null, sourceSha256 = null;
    try {
      const valid = validateCollectionCapture(plan, collection);
      captureReusable = true;
      sourceSha256 = valid.sourceSha256;
    } catch (error) { blockCode = collection.errorCode === 'EVALUATION_COLLECTION_PARTIAL'
      ? 'PARTIAL_CHECKPOINT' : error.code || error.message; }
    return {
      runId:collection.runId, role:collection.role, model:collection.artifact.modelName,
      digestSha256:collection.artifact.digestSha256, providerVersion:collection.providerVersion,
      completedAt:collection.completedAt, sourceContractSha256:collection.contractSha256,
      currentContractSha256:plan?.suiteContractSha256 || null,
      currentContractMatches:collection.contractSha256 === plan?.suiteContractSha256,
      observed:collection.metadata?.collection?.observed ?? null,
      planned:collection.metadata?.collection?.planned ?? null,
      captureReusable, blockCode, sourceSha256,
      automaticReuse: captureReusable && providerVersion !== null && providerVersion === collection.providerVersion,
    };
  });
  const roles = Object.fromEntries(Object.entries(plans).map(([role,plan]) => {
    const eligible = collections.filter(row => row.role === role && row.captureReusable);
    const digests = [...new Set(eligible.map(row => row.digestSha256))];
    return [role,{
      suiteName:plan.suiteName, collectionOnly:plan.collectionOnly,
      compatibleRuns:eligible.length, compatibleDistinctArtifacts:digests.length,
      automaticReusableRuns:eligible.filter(row => row.automaticReuse).length,
      automaticReusableDistinctArtifacts:new Set(eligible.filter(row => row.automaticReuse).map(row => row.digestSha256)).size,
      exploratoryTwoArtifactTargetMet:plan.collectionOnly ? digests.length >= 2 : null,
      acceptedGraderCount:plan.collectionOnly ? plan.acceptance.graders?.length || 0 : null,
      decisionReady:plan.decisionReady,
    }];
  }));
  const excludedSnapshots = {};
  for (const row of collections.filter(item => !item.captureReusable)) {
    const key = `${row.role}:${row.blockCode}`;
    excludedSnapshots[key] = (excludedSnapshots[key] || 0) + 1;
  }
  return {
    scope:'READ_ONLY_CAPTURE_REUSE_AUDIT', generatedAt:new Date().toISOString(),
    providerVersionFilter:providerVersion,
    decisionAuthority:false, noInference:true, noDatabaseWrites:true,
    note:'Capture compatibility checks stored prompts/options/responses; automatic reuse also requires the current provider version. Neither qualifies a model or its role.',
    collections:collections.filter(row => row.captureReusable),excludedSnapshots,roles,
  };
}

function parseArgs(args) {
  if (args.length < 1 || args.length > 2 || !args[0].startsWith('--db=')
    || (args.length === 2 && !args[1].startsWith('--provider-version=')))
    throw new Error('Usage: node scripts/audit-hunt-collections.mjs --db=/absolute/c3.db [--provider-version=x.y.z]');
  const dbPath = args[0].slice(5), providerVersion = args[1]?.slice(19) || null;
  if (!isAbsolute(dbPath)) throw new Error('DATABASE_PATH_MUST_BE_ABSOLUTE');
  if (args.length === 2 && !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(providerVersion))
    throw new Error('PROVIDER_VERSION_INVALID');
  return {dbPath,providerVersion};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let db;
  try {
    const {dbPath,providerVersion}=parseArgs(process.argv.slice(2));
    db = new Database(dbPath,{readonly:true,fileMustExist:true});
    process.stdout.write(JSON.stringify(auditHuntCollections(db,{providerVersion}),null,2)+'\n');
  } catch (error) {
    console.error(`HUNT_COLLECTION_AUDIT_FAILED: ${error.message}`);
    process.exitCode = 1;
  } finally { db?.close(); }
}
