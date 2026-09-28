#!/usr/bin/env node
// Explicit import of a reviewed, content-bound acceptance envelope. No grading,
// inference, timer, model deletion, or role binding effects.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { ModelEvaluationAcceptanceStore } from '../src/upgrade/model-evaluation-acceptance.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
export function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: node scripts/model-evaluation-acceptance.js --db /absolute/c3.db [--record /absolute/reviewed-envelope.json]\nWithout --record: read-only current acceptance status. Imports require migration 116; no migration or approval is implicit.');
    return;
  }
  const options = {};
  for (let i=0;i<args.length;i+=2) {
    if (!['--db','--record'].includes(args[i]) || !isAbsolute(args[i+1] || '') || options[args[i]]) throw new Error('INVALID_ARGUMENTS');
    options[args[i]] = args[i+1];
  }
  if (!options['--db']) throw new Error('DATABASE_PATH_REQUIRED');
  const db = new Database(options['--db'], { fileMustExist:true, readonly:!options['--record'] });
  try {
    if (options['--record']) {
      const envelope = JSON.parse(readFileSync(options['--record'],'utf8'));
      console.log(JSON.stringify(new ModelEvaluationAcceptanceStore(db).record(envelope),null,2));
    }
    console.log(JSON.stringify(Object.fromEntries(Object.entries(createRoleEvaluationPlans({ db }))
      .map(([role,p]) => [role,{ contractSha256:p.suiteContractSha256, runtimeSha256:p.qualificationRuntimeSha256,
        decisionReady:p.decisionReady, acceptance:p.acceptance }])),null,2));
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
