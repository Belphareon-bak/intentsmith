// Operator request 2026-09-19: derive decisionReady from exact-contract §3/§8
// acceptance, never from a hand-edited boolean. Isolated SQLite, no GPU/DB effects.
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite,test,testAsync,summary } from './harness.js';
import { up } from '../src/db/migrations/2026_09_19_116_model_evaluation_acceptance.js';
import { acceptanceHash,ModelEvaluationAcceptanceStore,qualificationRuntimeSha256 } from '../src/upgrade/model-evaluation-acceptance.js';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { codePilotPlanHash } from '../src/eval/code-pilot-decision.js';
import { ModelEvaluationReadModel } from '../src/upgrade/model-evaluation-read-model.js';
import { ModelEvaluationDecisionStore } from '../src/upgrade/model-evaluation-decision-store.js';
import { trialRole } from '../src/upgrade/pairwise-trial.js';
const H = 'a'.repeat(64), A = 'b'.repeat(64), B = 'c'.repeat(64);
function fixture(path=':memory:') {
  const db=new Database(path); up(db);
  db.exec(`CREATE TABLE model_evaluation_runs (run_id TEXT PRIMARY KEY,role TEXT,status TEXT,
    suite_contract_sha256 TEXT,model_digest_sha256 TEXT,metadata_json TEXT,hardware_json TEXT,
    suite_name TEXT,suite_version TEXT,model_name TEXT,model_canonical_name TEXT,score REAL,
    passed INTEGER DEFAULT 0,total INTEGER DEFAULT 0,repeats INTEGER DEFAULT 3,duration_ms INTEGER DEFAULT 100,
    task_results_json TEXT DEFAULT '[]',error_code TEXT,error_message TEXT,
    started_at TEXT DEFAULT '2026-09-19T00:00:00Z',completed_at TEXT DEFAULT '2026-09-19T00:00:00.100Z');
    CREATE TABLE model_evaluation_decisions (decision_id TEXT PRIMARY KEY,role TEXT,
    incumbent_run_id TEXT,candidate_run_id TEXT,policy_version TEXT,policy_contract_sha256 TEXT,
    outcome TEXT,basis TEXT,details_json TEXT,created_at TEXT DEFAULT '2026-09-19T00:00:01Z')`);
  const plan=createRoleEvaluationPlans({db,codeRuntimeAvailability:{ready:true}}).CODE;
  const store=new ModelEvaluationAcceptanceStore(db);
  const envelope=(kind,evidence)=>({schemaVersion:1,kind,role:'CODE',contractSha256:plan.suiteContractSha256,evidence,
    review:{reviewer:'independent test reviewer',reference:'fixture://review',reason:'synthetic gate exercise, not model evidence',
      reviewedAt:'2026-09-19T00:01:00Z',decision:'ACCEPTED',evidenceSha256:acceptanceHash(evidence)}});
  const base={role:'CODE',contractSha256:plan.suiteContractSha256,runtimeSha256:plan.qualificationRuntimeSha256,
    status:'PASS',archiveSha256:H,completedAt:'2026-09-19T00:00:30Z'};
  const grader=()=>envelope('GRADER',{...base,tasks:plan.suite.tests.map(task=>({name:task.name,tier:'T1',floor:0,
    probes:Object.fromEntries(['empty','prompt-echo','keyword-stuffing','negated-facts','confident-wrong','gold','alternative']
      .map(name=>[name,{score:['gold','alternative'].includes(name)?1:0,responseSha256:H}]))}))});
  const operation=graderId=>{
    const p={schemaVersion:1,role:'CODE',workflow:'intentsmith',evaluationContractSha256:plan.suiteContractSha256,runtimeSha256:base.runtimeSha256,
      developmentOnly:false,notAHoldout:false,holdoutSha256:H,metric:'completed_without_repair_help',lockedAt:'2026-09-18T00:00:00Z',
      repeats:1,budget:{attemptMs:1000,totalMs:100000},incumbent:{model:'old',digest:A},candidate:{model:'new',digest:B},
      profile:{numCtx:16384,numPredict:4096,temperature:0.1,topP:0.9,maxVramBytes:22000000000,providerVersion:'0.34.0-intentsmith.2'},
      decision:{method:'hoeffding-kl-bounded-groups',alpha:0.05,minimumBenefit:0.05,nonInferiorityMargin:0.05,minimumSpeedup:1.25,allowSpeedDecision:false},
      scenarios:Array.from({length:30},(_,i)=>({id:`s${i}`,independenceGroup:`g${i}`,groupRationale:'distinct synthetic fixture',contentSha256:H}))};
    p.planSha256=codePilotPlanHash(p);
    const attempts=p.scenarios.flatMap(s=>['incumbent','candidate'].map(side=>({scenario:s.id,repeat:1,side,planSha256:p.planSha256,
      digest:p[side].digest,startedAt:'2026-09-19T00:00:00Z',durationMs:100,valid:true,repairHelp:0,
      score:side==='candidate'?1:0,outcome:side==='candidate'?'SUCCESS':'INCORRECT'})));
    return envelope('OPERATIONAL',{...base,graderAcceptanceId:graderId,plan:p,attempts,
      hardware:{model:'Test GPU',vramMb:24576},holdout:{independent:true,usedForDevelopment:false,manifestSha256:H},
      qualifications:Object.fromEntries(['incumbent','candidate'].map(side=>[side,{planSha256:p.planSha256,digest:p[side].digest,status:'QUALIFIED'}]))});
  };
  const resign=r=>{r.review.evidenceSha256=acceptanceHash(r.evidence);return r;};
  const revoke=id=>{const r=envelope('REVOKE',{targetId:id});r.targetId=id;r.review.decision='REVOKED';return store.record(r);};
  const accept=()=>{const g=store.record(grader()).id;return {g,q:store.record(operation(g)).id};};
  const runs=()=>{for(const [id,digest]of [['old',A],['new',B]]) db.prepare('INSERT INTO model_evaluation_runs (run_id,role,status,suite_contract_sha256,model_digest_sha256,metadata_json,hardware_json,suite_name,suite_version,model_name,model_canonical_name,score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'CODE','COMPLETE',plan.suiteContractSha256,digest,JSON.stringify({provider:{version:'0.34.0-intentsmith.2',proof:'RESPONSE_BOUND'}}),JSON.stringify({model:'Test GPU',vramMb:24576,numCtx:16384}),plan.suiteName,plan.suiteVersion,id,id,0);};
  return {db,plan,store,grader,operation,accept,revoke,resign,runs};
}
suite('durable exact-contract evaluation acceptance');
test('a transitive prompt builder edit invalidates the operational runtime fingerprint',()=>{
  const original=qualificationRuntimeSha256();
  const changed=qualificationRuntimeSha256(url=>url.pathname.endsWith('/context/prompt-builder.js')
    ? Buffer.concat([readFileSync(url),Buffer.from('\n// changed workflow prompt')]) : readFileSync(url));
  assert.notEqual(original,changed);
});
test('missing DB or migration stays closed, with an explicit reason',()=>{
  assert.equal(createRoleEvaluationPlans().CODE.decisionReady,false);
  const db=new Database(':memory:');const p=createRoleEvaluationPlans({db}).CODE;
  assert.equal(p.acceptance.code,'EVALUATION_ACCEPTANCE_UNVERIFIABLE');db.close();
});
test('grader alone cannot open the gate; accepted pair opens the same live plan',()=>{
  const f=fixture();assert.equal(f.plan.decisionReady,false);
  const g=f.store.record(f.grader()).id;assert.equal(f.plan.decisionReady,false);
  assert.equal(f.plan.acceptance.code,'EVALUATION_OPERATIONAL_ACCEPTANCE_MISSING');
  const q=f.store.record(f.operation(g)).id;assert.equal(f.plan.decisionReady,true);
  assert.equal(f.plan.acceptance.qualifications[0].id,q);f.db.close();
});
test('revocation immediately closes an existing plan and keeps historical rows',()=>{
  const f=fixture(),ids=f.accept();f.revoke(ids.g);assert.equal(f.plan.decisionReady,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM model_evaluation_acceptances').get().n,3);f.db.close();
});
test('qualification revocation does not fall back to a grader-only approval',()=>{
  const f=fixture(),ids=f.accept();f.revoke(ids.q);assert.equal(f.plan.decisionReady,false);f.db.close();
});
test('acceptance survives close and reopen with content identity intact',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hunt-acceptance-'));try{
    const path=join(dir,'evidence.db'),f=fixture(path),ids=f.accept();f.db.close();
    const db=new Database(path,{readonly:true}),p=createRoleEvaluationPlans({db,codeRuntimeAvailability:{ready:true}}).CODE;
    assert.equal(p.decisionReady,true);assert.equal(p.acceptance.qualifications[0].id,ids.q);db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('different contract, role, repetitions and runtime cannot borrow approval',()=>{
  const f=fixture();f.accept();const plans=createRoleEvaluationPlans({db:f.db,repeats:1,codeRuntimeAvailability:{ready:true}});
  assert.equal(plans.CODE.decisionReady,false);assert.equal(plans.D1.decisionReady,false);
  const identity={role:'CODE',suiteContractSha256:f.plan.suiteContractSha256,taskNames:f.plan.suite.tests.map(t=>t.name),runtimeSha256:H};
  assert.equal(f.store.resolve(identity).ready,false);f.db.close();
});
test('bad alternative, missing negative probe, unknown tier and incomplete task coverage are rejected',()=>{
  const f=fixture();
  for(const change of [r=>r.evidence.tasks[0].probes.alternative.score=0,r=>delete r.evidence.tasks[0].probes['prompt-echo'],r=>r.evidence.tasks[0].tier='T4']){
    const r=f.grader();change(r);assert.throws(()=>f.store.record(f.resign(r)),/ACCEPTANCE_INVALID/);
  }
  const r=f.grader();r.evidence.tasks.pop();const g=f.store.record(f.resign(r)).id;f.store.record(f.operation(g));
  assert.equal(f.plan.decisionReady,false);f.db.close();
});
test('development, unpaired, invalid-environment and unsealed operational evidence cannot open the gate',()=>{
  const f=fixture(),g=f.store.record(f.grader()).id;
  for(const change of [r=>r.evidence.plan.developmentOnly=true,r=>r.evidence.holdout.usedForDevelopment=true,
    r=>r.evidence.attempts.pop(),r=>r.evidence.attempts[0].valid=false,r=>r.evidence.plan.decision.alpha=0.1]){
    const r=f.operation(g);change(r);assert.throws(()=>f.store.record(f.resign(r)),/INVALID/);
  }f.db.close();
});
test('unreviewed, altered or missing referenced grader evidence fails closed',()=>{
  const f=fixture();const r=f.grader();r.evidence.archiveSha256=A;assert.throws(()=>f.store.record(r),/review/);
  assert.throws(()=>f.store.record(f.operation('nonexistent')),/grader reference/);f.db.close();
});
test('append-only database rejects update/delete and cross-contract revocation',()=>{
  const f=fixture(),ids=f.accept();assert.throws(()=>f.db.exec('DELETE FROM model_evaluation_acceptances'),/append-only/);
  assert.throws(()=>f.db.exec("UPDATE model_evaluation_acceptances SET payload_sha256='a'"),/append-only/);
  assert.throws(()=>f.revoke('missing'),/revocation target/);assert.equal(f.plan.decisionReady,true);f.db.close();
});
test('INSERT OR REPLACE cannot overwrite an acceptance or erase a revocation',()=>{
  const f=fixture(),ids=f.accept();f.revoke(ids.q);
  for (const id of [ids.g,ids.q]) assert.throws(()=>f.db.prepare(`INSERT OR REPLACE INTO model_evaluation_acceptances
    SELECT * FROM model_evaluation_acceptances WHERE acceptance_id=?`).run(id),/append-only/);
  const revokeId=f.db.prepare("SELECT acceptance_id FROM model_evaluation_acceptances WHERE kind='REVOKE'").get().acceptance_id;
  assert.throws(()=>f.db.prepare(`INSERT OR REPLACE INTO model_evaluation_acceptances
    SELECT * FROM model_evaluation_acceptances WHERE acceptance_id=?`).run(revokeId),/append-only/);
  assert.equal(f.plan.decisionReady,false);f.db.close();
});
test('corrupt stored content never becomes an approval',()=>{
  const f=fixture();f.accept();f.db.exec('DROP TRIGGER trg_evaluation_acceptances_no_update');
  f.db.exec("UPDATE model_evaluation_acceptances SET payload_json='{}' WHERE kind='GRADER'");
  assert.equal(f.plan.decisionReady,false);assert.equal(f.plan.acceptance.code,'EVALUATION_ACCEPTANCE_UNVERIFIABLE');f.db.close();
});
test('exact pair and profile are required, ambiguity and reversed pairs are closed',()=>{
  const f=fixture(),ids=f.accept();f.runs();const runIds={candidateRunId:'new',incumbentRunId:'old'};
  assert.equal(f.plan.qualificationForRuns(runIds).id,ids.q);
  assert.equal(f.plan.qualificationForRuns({candidateRunId:'old',incumbentRunId:'new'}),null);
  f.db.prepare('UPDATE model_evaluation_runs SET hardware_json=? WHERE run_id=?').run(JSON.stringify({model:'Test GPU',vramMb:24576,numCtx:4096}),'new');
  assert.equal(f.plan.qualificationForRuns(runIds),null);
  f.db.prepare('UPDATE model_evaluation_runs SET hardware_json=? WHERE run_id=?').run(JSON.stringify({model:'Test GPU',vramMb:24576,numCtx:16384}),'new');
  f.store.record(f.operation(ids.g));assert.equal(f.plan.qualificationForRuns(runIds),null);f.db.close();
});
await testAsync('trial uses accepted operational verdict, and rechecks revocation after async measurement',async()=>{
  const f=fixture(),ids=f.accept();f.runs();const opts={evaluationPlan:f.plan,repeats:3,
    loadHistoricalSummary:async({model})=>({historyRunId:model,tasks:[{name:'t',mean:0,spread:0}],runs:3,score:0,unstableTasks:[]})};
  const runner={runSuite:()=>{throw new Error('must not infer');}};
  const accepted=await trialRole(runner,'CODE','new','old',opts);
  assert.equal(accepted.decision.winner,'candidate');assert.equal(accepted.decision.acceptanceId,ids.q);
  const revoked=await trialRole(runner,'CODE','new','old',{...opts,between:async()=>f.revoke(ids.q)});
  assert.equal(revoked.decision.winner,'inconclusive');assert.equal(revoked.decision.reasonCode,'EVALUATION_PROFILE_NOT_ACCEPTED');f.db.close();
});
await testAsync('accepted decision is durable/actionable; existing reader and writer reject revoked authority',async()=>{
  const f=fixture(),ids=f.accept();f.runs();
  const opts={evaluationPlan:f.plan,repeats:3,loadHistoricalSummary:async({model})=>({historyRunId:model,
    tasks:[{name:'t',mean:0,spread:0}],runs:3,score:0,unstableTasks:[]})};
  const trial=await trialRole({},'CODE','new','old',opts), writer=new ModelEvaluationDecisionStore(f.db);
  const row=writer.recordTrial(trial,{activationEligible:true});
  const reader=new ModelEvaluationReadModel(f.db,{plans:{CODE:f.plan}}),input={
    inventory:[{name:'old',digest:A},{name:'new',digest:B}],bindings:{CODE:'old'},
    providerVersion:'0.34.0-intentsmith.2',bindingAuthority:{status:'DURABLE'}};
  assert.equal(reader.read(input).roles.CODE.latestDecision.actionable,true);
  f.revoke(ids.q);
  assert.equal(reader.read(input).roles.CODE.latestDecision.actionability,'EVALUATION_PROFILE_NOT_ACCEPTED');
  assert.throws(()=>writer.recordTrial(trial),/EVALUATION_ACCEPTANCE_CHANGED/);
  assert.equal(writer.get(row.decisionId).outcome,'CANDIDATE');f.db.close();
});
await testAsync('an accepted inconclusive operational run cannot be turned into a benchmark win',async()=>{
  const f=fixture(),g=f.store.record(f.grader()).id,r=f.operation(g);
  r.evidence.attempts.forEach(a=>{a.score=0;a.outcome='INCORRECT';});
  f.store.record(f.resign(r));f.runs();assert.equal(f.plan.decisionReady,true);
  const trial=await trialRole({},'CODE','new','old',{evaluationPlan:f.plan,repeats:3,
    loadHistoricalSummary:async({model})=>({historyRunId:model,tasks:[{name:'t',mean:model==='new'?1:0,spread:0}],runs:3,score:0,unstableTasks:[]})});
  assert.equal(trial.decision.winner,'inconclusive');assert.equal(trial.decision.operationalReason,'INSUFFICIENT_EVIDENCE');f.db.close();
});
summary();
