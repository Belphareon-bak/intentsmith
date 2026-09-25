import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStageProvider, stageResources, installedStageModels } from '../src/eval/collection-stage-provider.js';
import { createStage, runStageWindow } from '../src/eval/collection-stage.js';
import { ModelEvaluationRunner } from '../src/eval/model-evaluation-runner.js';
import { chatConversationDraft as suite } from '../src/eval/chat-conversation-suite.js';

const artifact={modelName:'test',digestSha256:'a'.repeat(64),providerVersion:'test-provider'};
const floors={freeRamGiB:6,freeEvidenceGiB:40,freeHomeGiB:40,freeTmpGiB:2};
const ok=x=>({ok:true,json:async()=>x});
const model={name:'test',artifact};
function fakeProvider(overrides={}) {
  let resident=false;const requests=[];
  return {requests,adapter:createStageProvider({plan:{resourceFloors:floors},directory:'/example',endpoint:'http://127.0.0.1:11435',pid:1,
    ownership:async()=>{},resources:()=>({ready:true}),
    runner:{_callModel:async()=>{resident=true;return {content:'answer',...artifact,evalCount:1,doneReason:'stop'};}},
    request:async(url,options)=>{requests.push({url,options});
      if(url.endsWith('/api/version'))return ok({version:artifact.providerVersion});
      if(url.endsWith('/api/tags'))return ok({models:[{name:'test',digest:artifact.digestSha256}]});
      if(url.endsWith('/api/ps'))return ok({models:resident?[{name:'test',digest:artifact.digestSha256,size:10,size_vram:10,context_length:16384}]:[]});
      if(url.endsWith('/api/generate')){resident=false;return ok({done:true});}
      assert.fail(url);
    },...overrides})};
}
test('resource floors fail closed on unknown RAM and all three filesystem paths',()=>{
  const read=()=> 'MemAvailable: 8388608 kB\n',stat=()=>({bavail:50,bsize:2**30});
  assert.equal(stageResources('/evidence',floors,{read,stat}).disks.length,3);
  assert.throws(()=>stageResources('/e',floors,{read:()=>'',stat}),/MEMORY_UNKNOWN/);
  assert.throws(()=>stageResources('/e',floors,{read:()=> 'MemAvailable: 1048576 kB',stat}),/RAM_FLOOR/);
  for(const failPath of ['/e','/tmp']) assert.throws(()=>stageResources('/e',floors,{read,
    stat:p=>p===failPath?{bavail:0,bsize:1}:stat()}),/DISK_FLOOR/);
});
test('inventory is read-only and refuses missing or duplicate artifacts',async()=>{
  const request=async()=>ok({models:[{name:'test',digest:'sha256:'+artifact.digestSha256}]});
  assert.deepEqual(await installedStageModels(['test'],undefined,artifact.providerVersion,request),[model]);
  await assert.rejects(installedStageModels(['absent'],undefined,'v',request),/NOT_INSTALLED/);
  await assert.rejects(installedStageModels(['test'],'https://example.org','v',request),/LOCAL_PROVIDER/);
});
test('adapter checks placement and unloads only the model dispatched by this stage',async()=>{
  const {adapter,requests}=fakeProvider(),task={options:{num_ctx:16384}};
  await adapter.guard({model,task,phase:'before'});await adapter.call('test',[],{},artifact);
  await adapter.guard({model,task,phase:'after'});await adapter.close();
  assert.equal(requests.filter(r=>r.url.endsWith('/api/generate')).length,1);
});
test('foreign residency, GPU ownership and partial CPU placement prevent capture',async()=>{
  const task={options:{num_ctx:16384}};
  const foreign=fakeProvider({ownership:async()=>{throw Error('GPU_FOREIGN_WORK_PRESENT');}}).adapter;
  await assert.rejects(foreign.guard({model,task,phase:'before'}),/FOREIGN_WORK/);
  for(const resident of [{name:'foreign'}, {name:'test',size:100,size_vram:50,context_length:16384,digest:artifact.digestSha256}]) {
    const adapter=fakeProvider({request:async url=>url.endsWith('/api/version')?ok({version:artifact.providerVersion}):url.endsWith('/api/tags')?ok({models:[{name:'test',digest:artifact.digestSha256}]}):ok({models:[resident]})}).adapter;
    if(resident.name==='foreign')await assert.rejects(adapter.guard({model,task,phase:'before'}),/UNOWNED/);
    else {await adapter.call('test',[],{},artifact);await assert.rejects(adapter.guard({model,task,phase:'after'}),/PLACEMENT/);}
  }
});
test('pilot-shaped 64 calls use actual HTTP transport, preserve history, and respect content-only prompt boundary',async t=>{
  const received=[];
  const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;
    const input=JSON.parse(body);received.push(input);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({model:input.model,digest:artifact.digestSha256,
      provider_version:artifact.providerVersion,done:true,done_reason:'stop',message:{content:'response '+received.length},eval_count:4,prompt_eval_count:8}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const parent=mkdtempSync(join(tmpdir(),'hunt-http-test-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const groups=['corrected_project','offline_diagnosis','time_explanation','quoted_injection','tone_rewrite','strict_json'];
  const tasks=suite.tests.filter(t=>groups.includes(t.independenceGroup)).map(t=>({name:t.name,role:'CHAT',independenceGroup:t.independenceGroup,
    turns:t.prompt().conversationTurns,options:t.options}));
  // One synthetic artifact, two repetitions = same 64-turn transport workload.
  const plan={schemaVersion:1,decisionAuthority:false,notAHoldout:true,sourceContractSha256:'b'.repeat(64),models:[model],tasks,repeats:2,
    resourceFloors:floors,budget:{calls:64,outputTokens:64*2048}};
  const directory=join(parent,'stage');createStage(directory,plan);
  const runner=new ModelEvaluationRunner('http://127.0.0.1:'+server.address().port);
  const r=await runStageWindow({directory,sourceContractSha256:plan.sourceContractSha256,windowId:'pilot-http',
    budget:{calls:64,outputTokens:64*2048,wallMs:4*3600000},guard:async()=>{},call:runner._callModel.bind(runner)});
  assert.equal(received.length,64);assert.equal(r.summary.capturedConversations,24);
  for(const input of received){assert.equal(input.think,false);assert.equal(input.stream,false);
    assert(!JSON.stringify(input).includes('referenceChecks'));assert(!JSON.stringify(input).includes('positiveExample'));
    assert.equal(input.messages.at(-1).role,'user');
    if(input.messages.length>1)assert.match(input.messages[1].content,/^response \d+$/);
  }
});
test('external cancellation reaches the actual HTTP model request',async t=>{
  const server=createServer(()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const runner=new ModelEvaluationRunner('http://127.0.0.1:'+server.address().port),c=new AbortController();
  const timer=setTimeout(()=>c.abort(),20);
  const r=await runner._callModel('test',[{role:'user',content:'hello'}],{signal:c.signal,timeout:30000},artifact);
  clearTimeout(timer);assert(r.error);assert(r.durationMs<5000);
});
