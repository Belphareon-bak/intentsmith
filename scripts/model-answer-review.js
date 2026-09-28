#!/usr/bin/env node
// Explicit, read-only export from the product history. Never writes a grade.
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ModelEvaluationReadModel } from '../src/upgrade/model-evaluation-read-model.js';
import { createBlindAnswerReview } from '../src/eval/model-answer-review.js';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('model-answer-review.js --db=/absolute/database --out=/absolute/new-directory --run-id=eval_ID [--run-id=eval_ID ...]');
  process.exit(0);
}
if (args.some(a => !/^--(?:db|out|run-id)=.+$/.test(a))) throw new Error('Invalid review export argument');
const option = name => args.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3));
const [database] = option('db'), [out] = option('out'), ids = option('run-id');
if (option('db').length !== 1 || option('out').length !== 1 || !isAbsolute(database) || !isAbsolute(out)
  || !ids.length || new Set(ids).size !== ids.length) throw new Error('Exact database, fresh absolute output directory and unique run IDs are required');
const db = new Database(database, { readonly: true, fileMustExist: true });
let bundle;
try { const reader = new ModelEvaluationReadModel(db); bundle = createBlindAnswerReview(ids.map(id => reader.readRun(id))); }
finally { db.close(); }
mkdirSync(out, { mode: 0o700 });
for (const [name,value] of [['answers-for-review.json',bundle.review],['identity-key.private.json',bundle.identityKey]]) {
  writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({out,items:bundle.review.items.length,gradesWritten:0,decisionAuthority:false}));
