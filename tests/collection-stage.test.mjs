import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStage, readStage, runStageWindow, stageHash, stageSummary, recordedStageAnswer } from '../src/eval/collection-stage.js';

const artifact={modelName:'test',digestSha256:'a'.repeat(64),providerVersion:'test-provider'};
const base={schemaVersion:1,decisionAuthority:false,notAHoldout:true,sourceContractSha256:'b'.repeat(64),
  models:[{name:'test',artifact}],repeats:1,resourceFloors:{freeRamGiB:6,freeEvidenceGiB:40,freeHomeGiB:40,freeTmpGiB:2},
  tasks:[{name:'cs_test',role:'CHAT',independenceGroup:'test',turns:[{role:'user',content:'first'},{role:'user',content:'follow up'}],
    options:{num_predict:10,num_ctx:100,timeout:100}}],budget:{calls:2,outputTokens:20}};
const reply=(text='reply')=>({content:text,doneReason:'stop',...artifact,evalCount:4,promptEvalCount:5});
function setup(t,plan=base){const parent=mkdtempSync(join(tmpdir(),'hunt-stage-test-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const directory=join(parent,'stage');createStage(directory,plan);return {directory,sourceContractSha256:plan.sourceContractSha256,guard:async()=>{},call:async()=>reply(),windowId:'one',budget:{calls:2,outputTokens:20,wallMs:10000}};}

test('real dialog is durable, ungraded, and resume never regenerates a completed turn',async t=>{
  const opts=setup(t), inputs=[];
  const call=async(_,m)=>{inputs.push(m);return reply('answer '+inputs.length);};
  const first=await runStageWindow({...opts,call,budget:{...opts.budget,calls:1}});
  assert.equal(first.summary.stopReason,'CALL_LIMIT');assert.equal(first.summary.calls,1);
  const partial=recordedStageAnswer(first.stage,'m1-r1-cs_test');
  assert.equal(partial.captureStatus,'PARTIAL');assert.equal(partial.conversation.receipts.length,1);
  assert.equal(partial.conversation.transcript[1].content,'answer 1');
  const original=readFileSync(join(opts.directory,'events.jsonl'),'utf8');
  const second=await runStageWindow({...opts,call,windowId:'two',budget:{calls:1,outputTokens:16,wallMs:10000}});
  assert.equal(second.summary.status,'CAPTURED');assert.equal(inputs.length,2);
  assert.deepEqual(inputs[1],[{role:'user',content:'first'},{role:'assistant',content:'answer 1'},{role:'user',content:'follow up'}]);
  assert(readFileSync(join(opts.directory,'events.jsonl'),'utf8').startsWith(original));
  assert.equal(second.summary.calls,2);assert.equal(second.summary.chargedOutputTokens,8);
  assert.equal(second.summary.score,null);assert.equal(second.summary.decisionAuthority,false);
  assert.equal(second.stage.events.find(e=>e.type==='ATTEMPT_FINISHED').answer.conversation.transcript.length,4);
});
test('token reservation prevents overshoot and a new window cannot reset total budget',async t=>{
  const opts=setup(t);
  const r=await runStageWindow({...opts,budget:{...opts.budget,outputTokens:9},call:()=>assert.fail('called')});
  assert.equal(r.summary.stopReason,'OUTPUT_TOKEN_LIMIT');assert.equal(r.summary.calls,0);
  await assert.rejects(runStageWindow({...opts,windowId:'two',budget:{...opts.budget,calls:3}}),/EXCEEDS_REMAINDER/);
});
test('a window too short for locked request timeout does not dispatch',async t=>{
  const opts=setup(t);
  const r=await runStageWindow({...opts,budget:{...opts.budget,wallMs:50},call:()=>assert.fail('called')});
  assert.equal(r.summary.stopReason,'WALL_CLOCK_LIMIT');assert.equal(r.summary.calls,0);
});
test('failed preflight preserves pending work and never grades shortage as zero',async t=>{
  const opts=setup(t);
  const r=await runStageWindow({...opts,guard:async()=>{throw Error('RAM_FLOOR');},call:()=>assert.fail('called')});
  assert.equal(r.summary.stopReason,'RAM_FLOOR');assert.equal(r.summary.unattemptedConversations,1);
  assert.equal(r.summary.score,null);assert.equal(r.summary.calls,0);
});
test('live resource pressure aborts a request and conservatively charges uncertain tokens',async t=>{
  const opts=setup(t);let aborted=false;
  const r=await runStageWindow({...opts,monitorMs:5,guard:async({phase})=>{if(phase==='during')throw Error('RAM_FLOOR');},
    call:(_,m,o)=>new Promise(resolve=>o.signal.addEventListener('abort',()=>{aborted=true;resolve({content:'partial',error:'aborted'});},{once:true}))});
  assert(aborted);assert.equal(r.summary.stopReason,'RAM_FLOOR');assert.equal(r.summary.calls,1);
  assert.equal(r.summary.unknownTokenCalls,1);assert.equal(r.summary.chargedOutputTokens,10);
  assert.equal(r.stage.events.find(e=>e.type==='ATTEMPT_FINISHED').answer.response,'partial');
});
test('cancellation during a call is preserved as an interrupted attempt',async t=>{
  const opts=setup(t),cancel=new AbortController();
  const r=await runStageWindow({...opts,signal:cancel.signal,call:async(_,m,o)=>{cancel.abort();assert(o.signal.aborted);return reply('partial');}});
  assert.equal(r.summary.stopReason,'CANCELLED');assert.equal(r.summary.capturedConversations,0);
});
test('identity drift stops the panel and preserves the actual provider response',async t=>{
  const opts=setup(t);
  const r=await runStageWindow({...opts,call:async()=>({...reply('wrong artifact'),digestSha256:'c'.repeat(64)})});
  assert.equal(r.summary.stopReason,'CONVERSATION_ARTIFACT_DRIFT');assert.equal(r.summary.calls,1);
  assert.equal(r.stage.events.find(e=>e.type==='CALL_OBSERVED').result.content,'wrong artifact');
});
test('length exhaustion remains visible and does not run the next conversational turn',async t=>{
  const opts=setup(t);
  const r=await runStageWindow({...opts,call:async()=>({...reply(),doneReason:'length',evalCount:10})});
  assert.equal(r.summary.status,'CAPTURE_COMPLETE_WITH_EXCEPTIONS');assert.equal(r.summary.calls,1);
  assert.equal(r.stage.events.find(e=>e.type==='ATTEMPT_FINISHED').answer.captureStatus,'OUTPUT_BUDGET_EXHAUSTED');
});
test('unknown or excessive token accounting stops without inventing zero usage',async t=>{
  for (const evalCount of [undefined,-1,11]) {
    const opts=setup(t);
    const r=await runStageWindow({...opts,call:async()=>({...reply(),evalCount})});
    assert.equal(r.summary.stopReason,'PROVIDER_TOKEN_ACCOUNTING_INVALID');assert.equal(r.summary.chargedOutputTokens,10);
  }
});
test('source change, duplicate window and journal tampering cannot resume',async t=>{
  const opts=setup(t);
  await assert.rejects(runStageWindow({...opts,sourceContractSha256:'c'.repeat(64)}),/SOURCE_CHANGED/);
  await runStageWindow({...opts,budget:{...opts.budget,calls:1}});
  await assert.rejects(runStageWindow(opts),/WINDOW_ALREADY_USED/);
  appendFileSync(join(opts.directory,'events.jsonl'),'broken');
  assert.throws(()=>readStage(opts.directory),/JOURNAL_TORN/);
});
test('crash after reservation is retained, charged, and never silently retried',async t=>{
  const opts=setup(t),stage=readStage(opts.directory);let previous=stage.sha256;
  const events=[{type:'WINDOW_OPENED',windowId:'crashed',budget:opts.budget},
    {type:'CALL_RESERVED',windowId:'crashed',callId:'m1-r1-cs_test-t1',attemptId:'m1-r1-cs_test',
      reservedOutputTokens:10,inputSha256:stageHash([{role:'user',content:'first'}])}];
  events.forEach((e,i)=>{const row={sequence:i+1,previous,at:new Date().toISOString(),...e};const hash=stageHash(row);
    appendFileSync(join(opts.directory,'events.jsonl'),JSON.stringify({...row,hash})+'\n');previous=hash;});
  const r=await runStageWindow({...opts,budget:{calls:1,outputTokens:10,wallMs:10000},call:()=>assert.fail('must not reissue')});
  assert.equal(r.summary.stopReason,'INTERRUPTED_RESPONSE_UNKNOWN');assert.equal(r.summary.calls,1);
  assert.equal(r.summary.chargedOutputTokens,10);assert.equal(r.summary.finishedConversations,1);
  assert(r.summary.activeDurationMs>=opts.budget.wallMs);
});
test('persistent totals agree after process-independent reload',async t=>{
  const opts=setup(t);const r=await runStageWindow(opts);
  assert.deepEqual(stageSummary(readStage(opts.directory)),r.summary);
});
test('second writer cannot enter a running stage',async t=>{
  const opts=setup(t);let release,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const hold=new Promise(resolve=>{release=resolve;});let calls=0;
  const first=runStageWindow({...opts,guard:async()=>{if(!calls++){entered();await hold;}}});
  await ready;
  await assert.rejects(runStageWindow({...opts,windowId:'second'}),/already active/);
  release();assert.equal((await first).summary.status,'CAPTURED');
});
test('CLI exports paused transcript, null grades and a separate identity key',async t=>{
  const opts=setup(t);
  await runStageWindow({...opts,budget:{...opts.budget,calls:1}});
  const out=join(opts.directory,'review');
  execFileSync(process.execPath,['scripts/manual/collect-chat-conversation.mjs','--export','--out='+opts.directory,'--review-out='+out]);
  const review=JSON.parse(readFileSync(join(out,'review.json'))),key=JSON.parse(readFileSync(join(out,'PRIVATE-identity-key.json')));
  assert.equal(review.items.length,1);assert.equal(review.items[0].captureStatus,'PARTIAL');
  assert.equal(review.items[0].conversation.transcript.length,2);assert.equal(review.items[0].score,null);
  assert(!JSON.stringify(review).includes(artifact.digestSha256));assert.equal(key.identities[0].digestSha256,artifact.digestSha256);
  assert.equal(JSON.parse(readFileSync(join(out,'coverage.json'))).calls,1);
});
