#!/usr/bin/env node
// Executable rehearsal of production evaluation components, with fictional inputs.
// This program has no provider, production DB, binding writer or deletion adapter.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { fixture, operation, resign, provider, judgeArtifact, secondJudgeArtifact } from './hunt-simulation-support.mjs';
import { SemanticEvaluationJudge } from '../../src/eval/semantic-evaluation-judge.js';
import { conversationGradingSuite } from '../../src/eval/chat-conversation-suite.js';
import { gradeAnswerCollection, persistGradedCollection, gradeAcceptedCollection, persistAdjudicatedCollection } from '../../src/eval/grade-answer-collection.js';
import { buildBlindAdjudicationPacket } from '../adjudicate-model-collection.mjs';
import { ModelEvaluationHistory } from '../../src/upgrade/model-evaluation-history.js';
import { ModelEvaluationReadModel } from '../../src/upgrade/model-evaluation-read-model.js';
import { codePilotPlanHash } from '../../src/eval/code-pilot-decision.js';
import { decideRoleOperational } from '../../src/eval/role-operational-decision.js';
import { auditResponsibilitySegregation, selectResponsibilityPortfolio } from '../../src/upgrade/model-upgrade-prototype.js';
import { assessHuntRetention } from '../../src/upgrade/model-hunt-retention.js';

export const ROLES = ['D1','D2','CODE','R1','R2','CHAT','VISION'];
const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const save = (dir, name, value) => writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const evidence = 'SIMULATION: predetermined answer; no model generated or judged this text.';

function simulatedCall(counters, disagree = false, malformed = false) {
  return async (_model, messages, _options, artifact) => {
    counters.calls++;
    const data = JSON.parse(messages[1].content);
    const parts = value => data.criteria.map((_,i) => {
      const match = /^SIMULATION score=([\d.]+) case=(\d+) repeat=(\d+)/.exec(value);
      const score = match ? Number(match[1]) : 1;
      return {criterion:i+1,score:disagree && match?.[2]==='0' && match?.[3]==='0' && i===0 ? 0 : score,evidence};
    });
    const graded=data.transcript ? {criteria:data.criteria.map(c=>({criterion:c.criterion,
      score:Number(/^SIMULATION score=([\d.]+)/.exec(data.transcript.at(-1).content)?.[1]),evidence}))}
      : {a:parts(data.a),b:parts(data.b)};
    return {done:true,doneReason:'stop',digestSha256:artifact.digestSha256,providerVersion:provider,
      content:malformed ? 'SIMULATED BROKEN JUDGE RESPONSE' : JSON.stringify(graded)};
  };
}

function judge(f, id, artifact, call) {
  return new SemanticEvaluationJudge({artifact,call,isAccepted:()=>f.plan.acceptance.graderIds.includes(id)});
}

function operationalEnvelope(f, first, second, incumbent, candidate) {
  const e = operation(f,first,second), p = e.evidence.plan;
  p.incumbent={model:incumbent.name,digest:incumbent.digestSha256};
  p.candidate={model:candidate.name,digest:candidate.digestSha256};
  p.profile.providerVersion=provider;
  p.planSha256=codePilotPlanHash(p);
  for(const a of e.evidence.attempts) { a.planSha256=p.planSha256; a.digest=p[a.side].digest; }
  for(const side of ['candidate','incumbent']) Object.assign(e.evidence.qualifications[side],{
    planSha256:p.planSha256,digest:p[side].digest});
  return resign(e);
}

export async function runHuntSimulation(outputDirectory, onProgress = () => {}) {
  if(!isAbsolute(outputDirectory)) throw Error('SIMULATION_REQUIRES_NEW_ABSOLUTE_DIRECTORY');
  // Refuse existing directories, including symlinks. Never open an operator DB.
  mkdirSync(outputDirectory,{mode:0o700});
  const startedAt=new Date().toISOString(), counters={calls:0};
  const report={schemaVersion:1,status:'RUNNING',simulation:true,decisionAuthority:false,
    startedAt,provider,networkCalls:0,modelDownloads:0,modelDeletions:0,productionWrites:0,
    scope:'Production grading, persistence, read model, qualification and portfolio solver; fabricated model/judge/holdout evidence.',
    notProved:['Model quality','Independent grader acceptance','Operational predictive validity',
      'Physical model download, GPU inference or live binding activation/rollback',
      'Default scheduled hunt activation of the reviewed multi-turn profile'],
    checks:[],roles:[],matrix:[],events:[]};
  const check=(name,condition,detail=null)=>{
    report.checks.push({name,passed:Boolean(condition),detail});
    assert.ok(condition,name);return condition;
  };
  const event=(phase,details={})=>{const row={at:new Date().toISOString(),phase,...details};report.events.push(row);onProgress(row);};
  const models=Array.from({length:14},(_,i)=>({name:`sim-model-${String(i+1).padStart(2,'0')}:fixture`,
    digestSha256:hash(['SIMULATED MODEL',i]),digest:hash(['SIMULATED MODEL',i]),capabilities:(i>=6&&i<10)||i>=12?['completion','vision']:['completion'],size:18000000000,
    details:{parameter_size:'27B',family:'llama'}}));
  const before=Object.fromEntries(ROLES.map((r,i)=>[r,models[i].name]));
  const proposedByRole={},contexts=[];
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>{report.networkCalls++;throw Error('SIMULATION_NETWORK_FORBIDDEN');};
  try {
    // Four new candidates enter a fictional catalogue/pull queue. Only progress
    // receipts are simulated here; this is not a physical download test.
    report.candidateAcquisition=models.slice(10).map(model=>({model:model.name,digestSha256:model.digestSha256,
      simulation:true,transport:'NONE',states:['DISCOVERED','MANIFEST','DOWNLOADING','VERIFIED','AVAILABLE'],
      progress:[0,25,75,100],physicalBytesDownloaded:0}));
    for(const candidate of report.candidateAcquisition)event('simulated-candidate-available',candidate);
    for(let ri=0;ri<ROLES.length;ri++) {
      const role=ROLES[ri], dbPath=join(outputDirectory,`${role}.sqlite`),
        f=fixture(role,dbPath,role==='CHAT'?conversationGradingSuite():null,3);
      contexts.push(f); chmodSync(dbPath,0o600);
      // Read-model SQL uses this production-shaped table; the rehearsal emits no decisions into it.
      f.db.exec(`CREATE TABLE model_evaluation_decisions (decision_id TEXT,role TEXT,incumbent_run_id TEXT,
        candidate_run_id TEXT,policy_version TEXT,policy_contract_sha256 TEXT,outcome TEXT,basis TEXT,
        details_json TEXT,created_at TEXT);`);
      event('role-start',{role,suite:f.plan.suiteName});
      check(`${role}: decision closed without acceptance`,!f.plan.decisionReady);
      const first=f.store.record(f.grader()).id;
      const second=f.plan.collectionOnly?f.store.record(f.grader(secondJudgeArtifact)).id:null;
      check(`${role}: graders alone cannot qualify a role`,!f.plan.decisionReady);
      const roleRows=[],roleRuns=[];
      const preferred=({D1:11,CODE:10,R1:12,CHAT:13})[role] ?? (role==='VISION'?9:(ri+1)%7);
      for(let mi=0;mi<models.length;mi++) {
        const model=models[mi];
        if(role==='VISION'&&!model.capabilities.includes('vision')) {
          report.matrix.push({model:model.name,role,status:'N/A',percent:null,reason:'No simulated vision capability'});continue;
        }
        const score=mi===preferred?1:[.25,.5,.75][(mi+ri)%3];
        const artifact={modelName:model.name,digestSha256:model.digestSha256};
        let final;
        if(f.plan.collectionOnly) {
          const source=f.collect(f.plan.suiteContractSha256,artifact,(t,i)=>
            `SIMULATION score=${score} case=${f.plan.suite.tests.indexOf(t)} repeat=${i}`);
          const sourceHash=hash(source);
          const options={history:f.history,plan:f.plan,runId:source.runId,call:simulatedCall(counters),
            prepareJudge:async()=>{},finishJudge:async()=>{}};
          if(role==='D1'&&mi===preferred) {
            const one=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:first,
              judge:judge(f,first,judgeArtifact,simulatedCall(counters))});
            const pending=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:one});
            check('One judge cannot emit a complete grade',pending.errorCode==='EVALUATION_REVIEW_PENDING_PAIR');
            const two=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:second,
              judge:judge(f,second,secondJudgeArtifact,simulatedCall(counters,true))});
            const disputed=persistGradedCollection({history:f.history,plan:f.plan,collection:source,summary:two});
            check('Disagreement blocks aggregate',disputed.errorCode==='EVALUATION_GRADING_DISPUTE');
            const blind=buildBlindAdjudicationPacket(f.history,f.plan,source);
            save(outputDirectory,'simulated-dispute-packet.json',blind);
            const rows=f.db.prepare('SELECT * FROM model_evaluation_grader_reviews WHERE source_run_id=? ORDER BY recorded_at,review_id').all(source.runId);
            const decision={schemaVersion:1,sourceRunId:source.runId,sourceSha256:one.grading.sourceCollectionSha256,
              firstReviewId:rows[0].review_id,secondReviewId:rows[1].review_id,
              review:{reviewer:'SIMULATED operator; not the user or Opus',reference:'simulation://fixed-ground-truth',
                reason:'Exercise exact criterion adjudication against predetermined simulation labels',
                reviewedAt:new Date().toISOString(),blindToModel:true,independent:true},
              decisions:disputed.metadata.disputes.map(d=>({task:d.task,repeat:d.repeat,
                parts:d.firstParts.map((part,i)=>({criterion:i+1,score,evidence,
                  reason:'SIMULATED arbitration chooses the fixed fixture score; no real judgement'}))}))};
            final=persistAdjudicatedCollection({history:f.history,plan:f.plan,collection:source,decision});
            save(outputDirectory,'simulated-adjudication.json',decision);
            check('Adjudication retains two reviews',f.db.prepare('SELECT count(*) n FROM model_evaluation_grader_reviews WHERE source_run_id=?').get(source.runId).n===2);
          } else final=await gradeAcceptedCollection(options);
          if(role==='D1'&&mi===0) {
            const j=judge(f,first,judgeArtifact,simulatedCall(counters));
            const calls=counters.calls;
            check('Self-grading rejected before calling judge',
              (await j.grade(f.plan.suite.tests[0],'x',{artifact:judgeArtifact})).detail.reason==='SEMANTIC_SELF_GRADING_FORBIDDEN'&&counters.calls===calls);
            const malformed=await gradeAnswerCollection({plan:f.plan,collection:source,graderAcceptanceId:first,
              judge:judge(f,first,judgeArtifact,simulatedCall(counters,false,true))});
            check('Unreadable judge output is missing evidence, not zero',malformed.score===null&&malformed.grading.invalid>0);
            const changed=structuredClone(source);changed.tasks[0].input={text:'SIMULATED changed prompt'};
            await assert.rejects(gradeAnswerCollection({plan:f.plan,collection:changed,graderAcceptanceId:first,judge:j}),/EVALUATION_COLLECTION/);
            check('Changed prompt refuses evidence reuse',counters.calls===calls+malformed.grading.invalid*2);
          }
          check(`${role}/${mi}: complete pair persisted`,final?.status==='COMPLETE');
          const priorCalls=counters.calls;
          check(`${role}/${mi}: cache reuses exact accepted evidence`,(await gradeAcceptedCollection(options)).reused===true&&counters.calls===priorCalls);
          check(`${role}/${mi}: original answers remain unchanged`,hash(f.history.getRun(source.runId))===sourceHash);
        } else {
          // Task execution is NOT simulated as a real oracle. Only the storage boundary is exercised.
          final=f.history.recordComplete({artifact,role,suiteName:f.plan.suiteName,suiteVersion:f.plan.suiteVersion,
            contractSha256:f.plan.suiteContractSha256,metadata:{simulation:true,oracle:'STUB_NOT_EXECUTED'},
            summary:{score,runs:f.plan.repeats,tasks:f.plan.suite.tests.map(t=>({name:t.name,mean:score,spread:0,
              scores:Array(f.plan.repeats).fill(score),responses:Array(f.plan.repeats).fill(evidence),
              details:Array.from({length:f.plan.repeats},()=>({reason:'SIMULATED_ORACLE_RESULT'}))}))}});
          check(`${role}/${mi}: deterministic-result storage`,final.status==='COMPLETE');
        }
        const expectedScore=score;
        check(`${role}/${mi}: persisted expected grade`,Math.abs(final.score-expectedScore)<1e-10,
          role==='CHAT'?'Full multi-turn transcript and draft axis weights; simulated judges, no model inference.':null);
        report.matrix.push({model:model.name,role,status:'SIMULATED',percent:final.score*100,
          runId:final.runId,suite:f.plan.suiteName,contractSha256:f.plan.suiteContractSha256,
          grading:f.plan.collectionOnly?'Production dual-judge path with stub judgements':'Stub oracle result; no oracle executed'});
        roleRows.push({model:model.name,digestSha256:model.digestSha256,score:final.score,
          eligibleForChange:false,source:'simulation'});roleRuns.push(final.runId);
        event('cell-complete',{model:model.name,role});
      }
      proposedByRole[role]=roleRows;
      // Before explicit pair qualification, even a full high score cannot change a role.
      const envelope=operationalEnvelope(f,first,second,models[ri],models[preferred]);
      const incomplete=structuredClone(envelope.evidence.attempts);incomplete.pop();
      check(`${role}: incomplete operating pair cannot decide`,decideRoleOperational(envelope.evidence.plan,incomplete,
        envelope.evidence.qualifications).verdict!=='ZMENIT');
      const acceptanceId=f.store.record(envelope).id;
      check(`${role}: exact simulated operating qualification opens decision`,f.plan.decisionReady);
      const qualification=f.plan.acceptance.qualifications.find(q=>q.id===acceptanceId);
      check(`${role}: operational result is change`,qualification?.decision?.verdict==='ZMENIT');
      roleRows.find(r=>r.model===models[preferred].name).eligibleForChange=true;
      const read=new ModelEvaluationReadModel(f.db,{plans:{[role]:f.plan}});
      const view=read.read({inventory:models,bindings:before,providerVersion:provider});
      check(`${role}: displayed applicability matches simulated coverage`,view.models.filter(m=>m.evaluations[role].applicable).length===roleRows.length);
      check(`${role}: production read model displays measured cells`,view.models.filter(m=>m.evaluations[role].status==='COMPLETE').length===roleRows.length);
      save(outputDirectory,`${role}-read-model.json`,view);
      save(outputDirectory,`${role}-detail.json`,read.readRun(roleRuns[preferred<roleRuns.length?preferred:0]));
      save(outputDirectory,`${role}-qualification.json`,envelope);
      // A new connection proves the result did not live only in memory.
      const reopened=new Database(dbPath,{readonly:true});
      try {const h=new ModelEvaluationHistory(reopened);h.setProviderVersion(provider);
        check(`${role}: restart retains results`,h.getRun(roleRuns[0])?.status==='COMPLETE');
      } finally {reopened.close();}
      report.roles.push({role,taskCount:f.plan.taskCount,repeats:f.plan.repeats,contractSha256:f.plan.suiteContractSha256,
        gradingMode:f.plan.collectionOnly?'TWO_STUB_JUDGES':'ORACLE_STUB',acceptanceId,
        simulatedOperational:qualification.decision,suite:f.plan.suiteName});
      f.simulatedAcceptanceId=acceptanceId;f.simulatedSecondJudge=second;
    }
    const unqualified=Object.fromEntries(ROLES.map(r=>[r,proposedByRole[r].map(x=>({...x,eligibleForChange:false}))]));
    const held=selectResponsibilityPortfolio({before,roles:ROLES,inventory:models,evidenceByRole:unqualified});
    check('Unqualified scores never replace a role',held.changedRoles.length===0);
    const portfolio=selectResponsibilityPortfolio({before,roles:ROLES,inventory:models,evidenceByRole:proposedByRole});
    check('Qualified portfolio exists',portfolio.feasible&&portfolio.audit.compliant);
    check('Author cannot review own code',portfolio.bindings.CODE!==portfolio.bindings.R1&&portfolio.bindings.CODE!==portfolio.bindings.R2);
    check('One role per model in default portfolio',new Set(Object.values(portfolio.bindings)).size===ROLES.length);
    const conflict={...portfolio.bindings,R1:portfolio.bindings.CODE};
    check('Forbidden review assignment rejected',!auditResponsibilitySegregation(conflict,undefined,{inventory:models}).compliant);
    // Exercise only a virtual transaction. These are not live binding writer guarantees.
    let virtualBindings={...before};
    const virtualApply=(expected,proposed,probe)=>{
      if(hash(expected)!==hash(virtualBindings))return {status:'BASELINE_CHANGED'};
      if(!auditResponsibilitySegregation(proposed,undefined,{inventory:models}).compliant)return {status:'ROLE_CONFLICT'};
      const prior={...virtualBindings};virtualBindings={...proposed};
      if(!probe()){virtualBindings=prior;return {status:'ROLLED_BACK',bindings:{...virtualBindings}};}
      return {status:'APPLIED_IN_SIMULATION',bindings:{...virtualBindings}};
    };
    check('Virtual stale baseline refuses apply',virtualApply({},portfolio.bindings,()=>true).status==='BASELINE_CHANGED');
    check('Virtual failed smoke restores baseline',virtualApply(before,portfolio.bindings,()=>false).status==='ROLLED_BACK'&&hash(virtualBindings)===hash(before));
    check('Virtual approved apply succeeds',virtualApply(before,portfolio.bindings,()=>true).status==='APPLIED_IN_SIMULATION');
    const retained=await assessHuntRetention({modelName:portfolio.bindings.D1,inventory:models,bindings:portfolio.bindings,history:{providerVersion:provider}});
    check('Bound simulated model retained',retained.reason==='RETENTION_BOUND');
    report.portfolio={before,proposed:portfolio,activation:'VIRTUAL_ONLY',realActivationAllowed:false,
      liveAuthorityStillBlocked:'The proposal was computed with accepted synthetic pairs, then all operational acceptances were revoked. No live authority exists.',
      deletionPolicy:'DISABLED_BY_OPERATOR; no deletion adapter exists in this program'};
    for(const f of contexts) {
      const role=f.plan.role;f.revoke(f.simulatedAcceptanceId);
      check(`${role}: revocation closes decision`,!f.plan.decisionReady);
      if(f.simulatedSecondJudge) {f.revoke(f.simulatedSecondJudge);check(`${role}: revoked judge prevents cache consumption`,
        f.history.getComplete({digestSha256:models[0].digestSha256,role,suiteName:f.plan.suiteName,
          suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256})===null);}
      f.db.close();
    }
    event('simulation-complete');
    report.status='SIMULATION_PASS_NOT_PRODUCTION_GO';report.completedAt=new Date().toISOString();
    report.stubJudgeCalls=counters.calls;report.passCount=report.checks.length;
    check('No provider or network used',report.networkCalls===0);
    report.passCount=report.checks.length;
    save(outputDirectory,'simulation.json',report);
    return report;
  } catch(error) {
    report.status='SIMULATION_FAILED';report.error=error.stack;
    save(outputDirectory,'failure.json',report);throw error;
  } finally {for(const f of contexts)if(f.db.open)f.db.close();globalThis.fetch=oldFetch;}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--out')throw Error('Usage: node scripts/manual/simulate-hunt-lifecycle.mjs --out /NEW/private/directory');
  const r=await runHuntSimulation(args[1],e=>{if(e.phase!=='cell-complete')console.log(JSON.stringify(e));});
  console.log(JSON.stringify({status:r.status,checks:r.passCount,cells:r.matrix.length,stubJudgeCalls:r.stubJudgeCalls}));
}
