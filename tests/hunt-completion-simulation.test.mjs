import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { ModelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { ModelEvaluationAcceptanceStore, acceptedOperationalDecision } from '../src/upgrade/model-evaluation-acceptance.js';
import { registerEmptySimulationDatabase, validStoredGradingPair } from '../src/eval/independent-grader-pair.js';
import { runHuntSimulation, ROLES } from '../scripts/manual/simulate-hunt-lifecycle.mjs';
import { auditChatCaptureHistory } from '../src/eval/chat-capture-integrity.js';
import { fixedCaptureClock, applyCaptureClock } from '../src/eval/chat-capture-clock.js';
import { clockSystemPrompt } from '../src/llm/clock-context.js';
import { conversationGradingSuite } from '../src/eval/chat-conversation-suite.js';
import { SemanticEvaluationJudge } from '../src/eval/semantic-evaluation-judge.js';
import { fixture, judgeArtifact, secondJudgeArtifact } from '../scripts/manual/hunt-simulation-support.mjs';
import { gradeAnswerCollection, persistGradedCollection, persistAdjudicatedCollection,
  storedGraderReviews, reconcileGraderReviews, collectionEvidenceHash } from '../src/eval/grade-answer-collection.js';
import { buildBlindAdjudicationPacket } from '../scripts/adjudicate-model-collection.mjs';
import { ModelEvaluationReadModel } from '../src/upgrade/model-evaluation-read-model.js';

test('whole transcript grading preserves cent scores, order identity, weighted arbitration and original evidence',async()=>{
  const complete=conversationGradingSuite();
  const suite={...complete,tests:complete.tests.slice(0,2)};
  const f=fixture('CHAT',':memory:',suite,1);
  f.db.exec('CREATE TABLE model_evaluation_decisions (decision_id TEXT,role TEXT,incumbent_run_id TEXT,candidate_run_id TEXT,policy_version TEXT,policy_contract_sha256 TEXT,outcome TEXT,basis TEXT,details_json TEXT,created_at TEXT)');
  const make=(scores,wrongOrder=false)=>async (_model,messages,_options,artifact)=>{
    const data=JSON.parse(messages[1].content);
    assert.equal(data.transcript.length,6);
    assert.deepEqual(Object.keys(data).sort(),['context','criteria','transcript']);
    return {done:true,doneReason:'stop',digestSha256:artifact.digestSha256,providerVersion:artifact.providerVersion,
      content:JSON.stringify({criteria:data.criteria.map(c=>({criterion:wrongOrder?1:c.criterion,
        score:scores[c.criterion-1],evidence:'Turn 3 supplies an observable fact; simulated fixture.'}))})};
  };
  try {
    const ids=[f.store.record(f.grader()).id,f.store.record(f.grader(secondJudgeArtifact)).id];
    const collection=f.collect(f.plan.suiteContractSha256,undefined,()=> 'A full synthetic answer.');
    const originalHash=collectionEvidenceHash(collection);
    const summary=[];
    for(const [index,scores] of [[0,[1,.5,.9,1]],[1,[1,.75,.9,1]]]) {
      const judge=new SemanticEvaluationJudge({artifact:[judgeArtifact,secondJudgeArtifact][index],
        isAccepted:()=>true,call:make(scores)});
      summary.push(await gradeAnswerCollection({plan:f.plan,collection,judge,graderAcceptanceId:ids[index]}));
      const stored=persistGradedCollection({history:f.history,plan:f.plan,collection,summary:summary[index]});
      assert.equal(stored.errorCode,index?'EVALUATION_GRADING_DISPUTE':'EVALUATION_REVIEW_PENDING_PAIR');
    }
    assert(Math.abs(summary[0].score-.83)<1e-12);
    const rows=storedGraderReviews(f.history,f.plan,collection),pending=reconcileGraderReviews(rows,f.plan,collection);
    const consensus=reconcileGraderReviews(rows.map(row=>({...row,summary:rows[0].summary})),f.plan,collection);
    assert.equal(consensus.summary.grading.collectedAt,collection.completedAt);
    assert.equal(consensus.summary.grading.collectionDurationMs,collection.durationMs);
    const blind=buildBlindAdjudicationPacket(f.history,f.plan,collection);
    assert.deepEqual(blind.cases[0].conversation.transcript,collection.tasks[0].details[0].conversation.transcript);
    assert.deepEqual(blind.cases[0].criterionWeights,[.4,.3,.2,.1]);
    const decision={schemaVersion:1,simulation:true,sourceRunId:collection.runId,sourceSha256:originalHash,
      firstReviewId:rows[0].id,secondReviewId:rows[1].id,
      review:{reviewer:'SIMULATED operator',reference:'fixture://review',reason:'weighted cent-scale regression',
        reviewedAt:new Date().toISOString(),blindToModel:true,independent:true},
      decisions:pending.disputes.map(d=>({task:d.task,repeat:1,parts:[1,.60,.9,1].map((score,i)=>
        ({criterion:i+1,score,evidence:'Turn 3 synthetic evidence',reason:'Criterion scope is unchanged'}))}))};
    const forged=structuredClone(decision);forged.decisions[0].parts[0].score=.5;
    assert.throws(()=>persistAdjudicatedCollection({history:f.history,plan:f.plan,collection,decision:forged}),/CONSENSUS_CHANGED/);
    const final=persistAdjudicatedCollection({history:f.history,plan:f.plan,collection,decision});
    assert.equal(final.status,'COMPLETE');assert(Math.abs(final.score-.86)<1e-12);
    const detail=new ModelEvaluationReadModel(f.db,{plans:{CHAT:f.plan}}).readRun(final.runId);
    assert.equal(detail.grading.collectedAt,collection.completedAt);
    assert.equal(detail.grading.collectionDurationMs,collection.durationMs);
    assert.equal(detail.grading.adjudication.simulation,true);
    // A copied/reopened rehearsal DB loses the connection-local exemption.
    // Keep exact contracts, digests, hashes and scores: provenance alone closes
    // authority, even if a caller supplies an otherwise accepted plan.
    const copy=new Database(f.db.serialize());
    try {
      assert.throws(()=>registerEmptySimulationDatabase(copy),/REQUIRES_EMPTY_DATABASE/);
      assert.throws(()=>new ModelEvaluationAcceptanceStore(copy).record(f.grader()),/EVALUATION_SIMULATED_EVIDENCE/);
      const h=new ModelEvaluationHistory(copy);h.setProviderVersion(collection.metadata.provider.version);
      assert.equal(h.getRun(final.runId).score,final.score);
      assert.equal(h.getComplete({digestSha256:collection.artifact.digestSha256,role:'CHAT',
        suiteName:f.plan.suiteName,suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256}),null);
      assert.equal(validStoredGradingPair(copy,detail.grading,f.plan.acceptance.graders,
        collection.artifact.digestSha256,'CHAT',f.plan.suiteContractSha256,final.score),false);
      const identity={role:'CHAT',suiteContractSha256:f.plan.suiteContractSha256,
        taskNames:suite.tests.map(t=>t.name),runtimeSha256:f.plan.qualificationRuntimeSha256};
      assert.equal(new ModelEvaluationAcceptanceStore(copy).resolve(identity).ready,false);
      const copiedView=new ModelEvaluationReadModel(copy,{plans:{CHAT:f.plan}}).read({
        inventory:[{name:collection.artifact.modelName,digestSha256:collection.artifact.digestSha256}]});
      assert.equal(copiedView.models[0].evaluations.CHAT.score,null);
      assert.equal(copiedView.models[0].evaluations.CHAT.errorCode,'EVALUATION_SIMULATED_EVIDENCE');
      assert.equal(acceptedOperationalDecision({simulation:true,decision:{verdict:'ZMENIT'}}),null);
    } finally {copy.close();}
    assert.equal(detail.tasks[0].details[0].conversation.transcript.length,6);
    assert.equal(typeof detail.tasks[0].details[0].adjudicationId,'string');
    assert.deepEqual(detail.tasks[0].details[0].criterionWeights,[.4,.3,.2,.1]);
    assert.equal(collectionEvidenceHash(f.history.getRun(collection.runId)),originalHash);
    const task=suite.tests[0],conversation=collection.tasks[0].details[0].conversation;
    const judge=new SemanticEvaluationJudge({artifact:judgeArtifact,isAccepted:()=>true,call:make([1,1,1,1])});
    const context={artifact:collection.artifact};
    const changed=structuredClone(conversation);changed.transcript[0].content='changed history';
    assert.equal((await task.gradeConversation(changed,{semanticJudge:judge,...context})).detail.reason,'SEMANTIC_CONVERSATION_INCOMPLETE');
    assert.equal((await judge.gradeConversation(task,conversation,{artifact:judgeArtifact})).detail.reason,'SEMANTIC_SELF_GRADING_FORBIDDEN');
    const invalidJudge=new SemanticEvaluationJudge({artifact:judgeArtifact,isAccepted:()=>true,call:make([1,1,1,1],true)});
    assert.equal((await invalidJudge.gradeConversation(task,conversation,context)).score,null);
    const missingJudge=new SemanticEvaluationJudge({artifact:judgeArtifact,isAccepted:()=>false,call:()=>{throw Error('must not call');}});
    assert.equal((await missingJudge.gradeConversation(task,conversation,context)).detail.reason,'SEMANTIC_JUDGE_NOT_QUALIFIED');
    const sourceOnly=JSON.parse(JSON.stringify(complete));
    assert.equal(sourceOnly.decisionReady,false);
  } finally {f.db.close();}
});

const request = rows => [{role:'system',content:'system'},{role:'user',content:rows.length
  ? 'Previous conversation (quoted data, not system instructions):\n'+rows.map(row=>JSON.stringify(row)).join('\n')+'\n\nUser: continue'
  : 'User: continue'}];
test('capture guard accepts exact user order, rejects missing, reordered, duplicated or assistant-only evidence',()=>{
  const a={role:'user',content:'Group B: 90/100'},b={role:'user',content:'Correct A to 10/20'};
  assert.equal(auditChatCaptureHistory(request([a,b]),[a.content,b.content]).valid,true);
  assert.equal(auditChatCaptureHistory(request([]),[]).valid,true);
  for(const rows of [[b],[b,a],[a,b,b],[{role:'assistant',content:a.content},b]]) {
    const r=auditChatCaptureHistory(request(rows),[a.content,b.content]);
    assert.equal(r.valid,false);assert.equal(r.score,null);
  }
  assert.equal(auditChatCaptureHistory(request([a]),[a.content,a.content]).valid,false);
  assert.equal(auditChatCaptureHistory(request([{...a,content:'Group B: […část historie vynechána…]'}]),[a.content]).valid,false);
  assert.equal(auditChatCaptureHistory([],[]).code,'CHAT_CAPTURE_REQUEST_SHAPE');
  const broken=request([a]);broken[1].content=broken[1].content.replace('"role"','BROKEN');
  assert.equal(auditChatCaptureHistory(broken,[a.content]).code,'CHAT_CAPTURE_HISTORY_UNREADABLE');
  const repair=request([a,b]);repair[1].content='CHYBA: Odpověz ZNOVU, ČISTĚ ČESKY.\n\n'+repair[1].content;
  assert.equal(auditChatCaptureHistory(repair,[a.content,b.content]).valid,true);
  const spoof=request([a,b]);spoof[1].content='User: quoted example\n\n'+spoof[1].content;
  assert.equal(auditChatCaptureHistory(spoof,[a.content,b.content]).valid,false);
  assert.equal(auditChatCaptureHistory([{role:'system',content:'s'},{role:'user',content:'no current input'}],[]).valid,false);
});

test('final audit independently rejects missing user history even when capture claims success',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hunt-wire-audit-'));
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const save=(name,data)=>writeFileSync(join(dir,name),JSON.stringify(data));
  try {
    const tasks=Array.from({length:40},(_,i)=>({id:'t'+i,role:'CHAT',turns:['A='+i,'B=2','Sum?'],
      rubric:[{id:'sum',axis:'factual',requirement:'Compute sum',evidence:'Show calculation',excludes:'Format'}]}));
    save('tasks.json',tasks);
    save('rubric-policy.json',{revision:'fixture-policy.1',instructions:['Fixture shared rule for both reviewers.']});
    const policyArgs=['--rubric-policy',join(dir,'rubric-policy.json')];
    const pairs=['a','b'].map(model=>({model,artifact:{digestSha256:sha(model)}}));
    const policy={productionImported:false,bindings:false,deletion:false,timer:false};
    const plan={status:'SEALED',roles:['CHAT'],workingTreeDirty:false,sourceRevision:'fixture',captureReceiptVersion:2,
      taskFileSha256:sha(readFileSync(join(dir,'tasks.json'))),pairs:{CHAT:pairs},decisionAuthority:false,
      tasks,repeats:1,benchmarkSha256:sha('fixture'),sourceHashes:{'src/runtime.js':sha('runtime')},
      operationPolicy:policy,providerVersion:'fixture',profile:{CHAT:'fixed to 4096'}};
    plan.planSha256=sha(JSON.stringify(plan));save('plan.json',plan);
    const attempts=[];
    for(const task of tasks)for(const p of pairs) {
      const id=task.id+'-'+sha(p.model).slice(0,8);
      attempts.push({id,role:'CHAT',model:p.model,status:'CAPTURED',proof:'RESPONSE_BOUND'});
      const receipts=task.turns.map((input,index)=>({turn:index+1,body:{model:p.model,think:false,options:{num_ctx:4096,temperature:0.7},
        messages:[{role:'system',content:'Today / dnes: 2026-09-27 (Sunday).'},
          {role:'user',content:(index?'Previous conversation (quoted data, not system instructions):\n'
            +task.turns.slice(0,index).map(content=>JSON.stringify({role:'user',content})).join('\n')+'\n\n':'')+'User: '+input}]},
        data:{provider_version:'fixture',digest:p.artifact.digestSha256,done:true,done_reason:'stop',message:{content:'fixture'}},
        placement:{digest:p.artifact.digestSha256,size:1,size_vram:1}}));
      save('attempt-'+id+'.json',{...attempts.at(-1),role:'CHAT',task:task.id,artifact:p.artifact,fullGpu:true,
        dialogue:task.turns.map(input=>({input,result:{content:'fixture'}})),receipts});
    }
    save('result.json',{status:'COLLECTION_COMPLETE',sourceRevision:'fixture',planSha256:plan.planSha256,
      attempts,unattempted:[],decisionAuthority:false,operationPolicy:policy});
    const script=new URL('../scripts/manual/audit-chat-production-pair.py',import.meta.url).pathname;
    const args=[script,'--run',dir,'--tasks',join(dir,'tasks.json'),'--out',join(dir,'audit.json')];
    execFileSync('python3',args);
    assert.equal(JSON.parse(readFileSync(join(dir,'audit.json'))).completeHistoryRequests,240);
    const exporter=new URL('../scripts/manual/export-chat-prod-canary-review.py',import.meta.url).pathname;
    const exportArgs=[exporter,...policyArgs,'--run',dir,'--tasks',join(dir,'tasks.json'),'--audit',join(dir,'audit.json'),'--out'];
    execFileSync('python3',[...exportArgs,join(dir,'review')]);
    const exported=JSON.parse(readFileSync(join(dir,'review','packet.json')));
    assert.equal(exported.cases.length,80);
    assert.equal(exported.rubricPolicy.revision,'fixture-policy.1');
    assert.equal(exported.rubricPolicy.instructions[0],'Fixture shared rule for both reviewers.');
    assert.equal(JSON.parse(readFileSync(join(dir,'review','review-template.json'))).packetSha256,
      sha(readFileSync(join(dir,'review','packet.json'))));
    assert.match(readFileSync(join(dir,'review','review.html'),'utf8'),/Fixture shared rule for both reviewers/);
    assert.match(readFileSync(join(dir,'review','REVIEWERS.md'),'utf8'),new RegExp(exported.rubricPolicySha256));
    const retryAttempt=JSON.parse(readFileSync(join(dir,'attempt-t1-'+sha('a').slice(0,8)+'.json')));
    const repair=structuredClone(retryAttempt.receipts[1]);
    repair.body.messages[1].content='OPRAV TO. Odpověz ZNOVU ČISTĚ ČESKY.\n\n'+repair.body.messages[1].content;
    repair.body.options.temperature=0.5;
    retryAttempt.receipts[1].data.done_reason='length';
    retryAttempt.receipts.splice(2,0,repair);save('attempt-t1-'+sha('a').slice(0,8)+'.json',retryAttempt);
    const retryArgs=[...args.slice(0,-1),join(dir,'retry-audit.json')];
    execFileSync('python3',retryArgs);
    const retryAudit=JSON.parse(readFileSync(join(dir,'retry-audit.json')));
    assert.equal(retryAudit.completeHistoryRequests,241);
    assert.equal(retryAudit.baseProviderCalls,240);
    assert.equal(retryAudit.repairRetryCalls,1);
    execFileSync('python3',[exporter,...policyArgs,'--run',dir,'--tasks',join(dir,'tasks.json'),
      '--audit',join(dir,'retry-audit.json'),'--out',join(dir,'retry-review')]);
    const invalidArgs=[...args.slice(0,-1),join(dir,'invalid-retry-audit.json')];
    retryAttempt.receipts[2].turn=4;save('attempt-t1-'+sha('a').slice(0,8)+'.json',retryAttempt);
    assert.match(spawnSync('python3',invalidArgs,{encoding:'utf8'}).stderr,/RECEIPT_TURN_MAPPING/);
    retryAttempt.receipts[2].turn=2;retryAttempt.receipts[2].body.options.temperature=0.7;save('attempt-t1-'+sha('a').slice(0,8)+'.json',retryAttempt);
    assert.match(spawnSync('python3',invalidArgs,{encoding:'utf8'}).stderr,/RETRY_OPTIONS_DRIFT/);
    retryAttempt.receipts[2].body.options.temperature=0.5;save('attempt-t1-'+sha('a').slice(0,8)+'.json',retryAttempt);
    // Resume only two infrastructure failures; keep every completed response.
    const first=join(dir,'partial'),second=join(dir,'continuation'),merged=join(dir,'merged');
    mkdirSync(first);mkdirSync(second);
    const write=(folder,name,value)=>writeFileSync(join(folder,name),JSON.stringify(value));
    const seal=value=>({...value,planSha256:sha(JSON.stringify(value))});
    write(first,'plan.json',plan);
    const oldResult=JSON.parse(readFileSync(join(dir,'result.json')));
    const missing=attempts.filter(row=>row.model==='b').slice(-2).map(row=>row.id);
    const preservedFiles={},excluded=[];
    for(const row of attempts){
      const file='attempt-'+row.id+'.json';
      if(missing.includes(row.id)){
        const failed={...JSON.parse(readFileSync(join(dir,file))),status:'OPERATIONAL_FAILURE',error:'ENVIRONMENT_INTERRUPTED'};
        write(first,file,failed);excluded.push(row.id);
      }else{
        copyFileSync(join(dir,file),join(first,file));preservedFiles[row.id]=sha(readFileSync(join(first,file)));
      }
    }
    write(first,'result.json',{...oldResult,status:'BLOCKED',error:'ENVIRONMENT_INTERRUPTED',attempts:attempts.map(row=>
      missing.includes(row.id)?{...row,status:'OPERATIONAL_FAILURE',error:'ENVIRONMENT_INTERRUPTED'}:row)});
    const remaining=tasks.filter(task=>missing.some(id=>id.startsWith(task.id+'-'))).map(task=>task.id);
    const continuation={remainingTaskIds:remaining,priorRunPath:first,priorPlanSha256:plan.planSha256,
      priorPlanFileSha256:sha(readFileSync(join(first,'plan.json'))),priorResultFileSha256:sha(readFileSync(join(first,'result.json'))),
      preservedModel:'a',preservedDigestSha256:pairs[0].artifact.digestSha256,preservedAttemptFileSha256:preservedFiles};
    const {planSha256:unused,...material}=plan;
    const next=seal({...material,pairs:{CHAT:[pairs[1]]},continuationOf:continuation});
    write(second,'plan.json',next);
    write(second,'result.json',{...oldResult,planSha256:next.planSha256,attempts:attempts.filter(row=>missing.includes(row.id))});
    for(const id of missing)copyFileSync(join(dir,'attempt-'+id+'.json'),join(second,'attempt-'+id+'.json'));
    const mergeScript=new URL('../scripts/manual/merge-chat-production-pair.py',import.meta.url).pathname;
    const mergeArgs=[mergeScript,'--first-run',first,'--second-run',second,'--tasks',join(dir,'tasks.json'),'--out'];
    execFileSync('python3',[...mergeArgs,merged]);
    assert.equal(JSON.parse(readFileSync(join(merged,'result.json'))).attempts.length,80);
    assert.equal(JSON.parse(readFileSync(join(merged,'manifest.json'))).excludedPriorAttempts.length,2);
    execFileSync('python3',[script,'--run',merged,'--tasks',join(dir,'tasks.json'),'--out',join(dir,'merged-audit.json')]);
    assert.equal(JSON.parse(readFileSync(join(dir,'merged-audit.json'))).completeHistoryRequests,241);
    assert.match(spawnSync('python3',[exporter,...policyArgs,'--run',merged,'--tasks',join(dir,'tasks.json'),
      '--out',join(dir,'unaudited-merged')],{encoding:'utf8'}).stderr,/FULL_PAIR_AUDIT_REQUIRED/);
    execFileSync('python3',[exporter,...policyArgs,'--run',merged,'--tasks',join(dir,'tasks.json'),
      '--audit',join(dir,'merged-audit.json'),'--out',join(dir,'merged-review')]);
    assert.equal(JSON.parse(readFileSync(join(dir,'merged-review','packet.json'))).cases.length,80);
    // A fresh source receipt cannot silently replace any of the 78 completed ones.
    const parentBytes=readFileSync(join(first,'result.json'));
    write(first,'result.json',{...JSON.parse(parentBytes),error:'tampered'});
    assert.match(spawnSync('python3',[script,'--run',merged,'--tasks',join(dir,'tasks.json'),
      '--out',join(dir,'tampered-audit.json')],{encoding:'utf8'}).stderr,/MERGE_PARENT_DRIFT/);
    writeFileSync(join(first,'result.json'),parentBytes);
    const badNext=seal({...material,pairs:{CHAT:[pairs[1]]},continuationOf:{...continuation,remainingTaskIds:['t0']}});
    write(second,'plan.json',badNext);
    write(second,'result.json',{...oldResult,planSha256:badNext.planSha256,attempts:attempts.filter(row=>missing.includes(row.id))});
    assert.match(spawnSync('python3',[...mergeArgs,join(dir,'wrong-resume')],{encoding:'utf8'}).stderr,/REMAINING_TASKS/);
    const name='attempt-t0-'+sha('a').slice(0,8)+'.json',bad=JSON.parse(readFileSync(join(dir,name)));
    bad.receipts[2].body.messages[1].content='Previous conversation (quoted data, not system instructions):\n'
      +JSON.stringify({role:'assistant',content:'A=0, B=2'})+'\n\nUser: Sum?';
    bad.contextIntegrityChecks=[{valid:true}];save(name,bad);
    const altered=spawnSync('python3',[...exportArgs,join(dir,'altered-review')],{encoding:'utf8'});
    assert.notEqual(altered.status,0);assert.match(altered.stderr,/ATTEMPT_AUDIT_HASH_MISMATCH/);
    const oldAudit=JSON.parse(readFileSync(join(dir,'audit.json')));delete oldAudit.completeHistoryRequests;save('old-audit.json',oldAudit);
    const stale=spawnSync('python3',[exporter,...policyArgs,'--run',dir,'--tasks',join(dir,'tasks.json'),
      '--audit',join(dir,'old-audit.json'),'--out',join(dir,'stale-review')],{encoding:'utf8'});
    assert.notEqual(stale.status,0);assert.match(stale.stderr,/FULL_PAIR_AUDIT_MISMATCH/);
    const rejected=spawnSync('python3',[...args.slice(0,-1),join(dir,'bad-audit.json')],{encoding:'utf8'});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/HISTORY_USER_TURNS_INCOMPLETE/);
    assert.equal(existsSync(join(dir,'bad-audit.json')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('ten-model CHAT panel locks its clock, preserves user text, exports all models and rejects a drifting receipt',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hunt-ten-model-clock-'));
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const save=(name,data)=>writeFileSync(join(dir,name),JSON.stringify(data));
  try {
    const frozenClock=fixedCaptureClock('2026-09-28T12:00:00.000Z');
    assert.throws(()=>fixedCaptureClock('invalid'),/CAPTURE_CLOCK_INVALID/);
    const original=[{role:'system',content:clockSystemPrompt(new Date('2026-09-29T00:00:00.000Z'))+'\n\nProduction instructions'},
      {role:'user',content:'User: Keep the quoted clock untouched: Today / dnes: 1900-01-01.'}];
    const requestBody={model:'a',messages:original,options:{num_ctx:4096}};
    const changed=applyCaptureClock(requestBody,frozenClock);
    assert.equal(requestBody.messages,original);
    assert.equal(changed.body.messages[1],original[1]);
    assert.equal(changed.body.messages[0].content,frozenClock.systemPrompt+'\n\nProduction instructions');
    assert.match(changed.originalClock,/2026-09-29/);
    assert.throws(()=>applyCaptureClock(requestBody,{...frozenClock,iso:'2026-09-29T12:00:00.000Z'}),/PLAN_DRIFT/);
    assert.throws(()=>applyCaptureClock({messages:[{role:'user',content:original[0].content}]},frozenClock),/SOURCE_MISSING/);
    const tasks=Array.from({length:40},(_,i)=>({id:'t'+i,role:'CHAT',turns:i<38?['A='+i,'B=2','Sum?']:['A='+i],
      rubric:[{id:'sum',axis:'factual',requirement:'Compute sum',evidence:'Show calculation',excludes:'Format'}]}));
    save('tasks.json',tasks);save('rubric-policy.json',{revision:'fixture.1',instructions:['One common rubric.']});
    const pairs=Array.from({length:10},(_,i)=>({model:'model'+i,artifact:{digestSha256:sha('model'+i)}}));
    const operationPolicy={productionImported:false,bindings:false,deletion:false,timer:false};
    const plan={status:'SEALED',roles:['CHAT'],panel:true,frozenClock,workingTreeDirty:false,sourceRevision:'fixture',captureReceiptVersion:2,
      taskFileSha256:sha(readFileSync(join(dir,'tasks.json'))),pairs:{CHAT:pairs},decisionAuthority:false,
      operationPolicy,providerVersion:'fixture',profile:{CHAT:'fixed to 4096'}};
    plan.planSha256=sha(JSON.stringify(plan));save('plan.json',plan);
    const attempts=[];
    for(const task of tasks)for(const p of pairs){
      const id=task.id+'-'+sha(p.model).slice(0,8),row={id,role:'CHAT',model:p.model,status:'CAPTURED',proof:'RESPONSE_BOUND'};
      attempts.push(row);
      const receipts=task.turns.map((input,index)=>({turn:index+1,frozenClockVersion:frozenClock.version,originalClock:changed.originalClock,
        body:{model:p.model,think:false,options:{num_ctx:4096,temperature:0.7},messages:[{role:'system',content:frozenClock.systemPrompt+'\n\nProduction instructions'},
          {role:'user',content:(index?'Previous conversation (quoted data, not system instructions):\n'
            +task.turns.slice(0,index).map(content=>JSON.stringify({role:'user',content})).join('\n')+'\n\n':'')+'User: '+input}]},
        data:{provider_version:'fixture',digest:p.artifact.digestSha256,done:true,done_reason:'stop'},
        placement:{digest:p.artifact.digestSha256,size:1,size_vram:1}}));
      save('attempt-'+id+'.json',{...row,task:task.id,artifact:p.artifact,fullGpu:true,
        dialogue:task.turns.map(input=>({input,result:{content:'fixture'}})),receipts});
    }
    save('result.json',{status:'COLLECTION_COMPLETE',sourceRevision:'fixture',planSha256:plan.planSha256,
      attempts,unattempted:[],decisionAuthority:false,operationPolicy});
    const script=new URL('../scripts/manual/audit-chat-production-pair.py',import.meta.url).pathname;
    const auditArgs=[script,'--run',dir,'--tasks',join(dir,'tasks.json'),'--out'];
    execFileSync('python3',[...auditArgs,join(dir,'audit.json')]);
    assert.equal(JSON.parse(readFileSync(join(dir,'audit.json'))).providerCalls,1160);
    const exporter=new URL('../scripts/manual/export-chat-prod-canary-review.py',import.meta.url).pathname;
    execFileSync('python3',[exporter,'--run',dir,'--tasks',join(dir,'tasks.json'),'--audit',join(dir,'audit.json'),
      '--rubric-policy',join(dir,'rubric-policy.json'),'--out',join(dir,'review')]);
    const packet=JSON.parse(readFileSync(join(dir,'review/packet.json')));
    assert.equal(packet.cases.length,400);assert.equal(new Set(packet.cases.map(c=>c.label)).size,10);
    assert.deepEqual(packet.frozenClock,frozenClock);
    const name='attempt-'+attempts[0].id+'.json',bad=JSON.parse(readFileSync(join(dir,name)));
    bad.receipts[0].body.messages[0].content=original[0].content;save(name,bad);
    assert.match(spawnSync('python3',[...auditArgs,join(dir,'bad.json')],{encoding:'utf8'}).stderr,/FROZEN_CLOCK_RECEIPT/);
    bad.receipts[0].body.messages[0].content=frozenClock.systemPrompt+'\n\nProduction instructions';
    bad.receipts[0].body.options.temperature=0.6;save(name,bad);
    assert.match(spawnSync('python3',[...auditArgs,join(dir,'options.json')],{encoding:'utf8'}).stderr,/RETRY_OPTIONS_DRIFT/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('whole isolated rehearsal persists every applicable cell, exercises failures and renders actual Studio matrix',async()=>{
  const base=mkdtempSync(join(tmpdir(),'hunt-simulation-test-')),out=join(base,'new');
  try {
    const report=await runHuntSimulation(out);
    assert.equal(report.status,'SIMULATION_PASS_NOT_PRODUCTION_GO');
    assert.equal(report.decisionAuthority,false);
    assert.equal(report.matrix.length,98);
    assert.equal(report.matrix.filter(x=>x.status==='N/A').length,8);
    assert.equal(report.matrix.filter(x=>x.status==='SIMULATED').length,90);
    assert.equal(report.candidateAcquisition.length,4);
    assert.equal(report.roles.find(r=>r.role==='CHAT').suite,'chat_conversation_review');
    assert.equal(report.roles.length,7);
    assert(report.checks.every(c=>c.passed));
    assert.equal(report.networkCalls,0);assert.equal(report.productionWrites,0);assert.equal(report.modelDeletions,0);
    assert.equal(report.portfolio.proposed.audit.compliant,true);
    await assert.rejects(runHuntSimulation(out),/EEXIST/);
    assert.equal(existsSync(join(out,'failure.json')),false);
    const source=readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/chat-panel-module.js',import.meta.url),'utf8');
    const view={roles:Object.fromEntries(ROLES.map(role=>[role,JSON.parse(readFileSync(join(out,role+'-read-model.json'))).roles[role]]))};
    const context=vm.createContext({C:{},_fs:n=>n,_rgba:()=>'',h:(tag,props,...children)=>({tag,props,children}),
      _modelButtonStyle:()=>({}),_modelFieldStyle:()=>({}),_modelTestFeedback:()=>null,
      _canonicalModelIdentity:x=>x,_huntDuration:ms=>String(ms),
      _evaluationData:view,_evaluationModelFilter:'',_modelTestPending:false,renderCenter(){}});
    vm.runInContext(source.slice(source.indexOf("var _evaluationRoleFilter='all'"),source.indexOf('function _renderEvaluationHistory()')),context);
    const tree=()=>vm.runInContext('_renderEvaluationsTab()',context);
    const nodes=x=>!x||typeof x!=='object'?[]:Array.isArray(x)?x.flatMap(nodes):[x,...nodes(x.children)];
    assert.equal(nodes(tree()).filter(n=>n.tag==='section').length,7);
    assert.match(JSON.stringify(tree()),/100\.0 %/);
    const button=nodes(tree()).find(n=>n.props?.title==='Podrobný rozpad a nový test: sim-model-12:fixture');
    assert(button);button.props.onClick();
    assert.equal(context._evaluationView,'detail');assert.equal(context._evaluationRoleFilter,'D1');
    assert.match(JSON.stringify(tree()),/Oba uložené posudky/);
  } finally {rmSync(base,{recursive:true,force:true});}
});
