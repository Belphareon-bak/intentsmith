// Runs only in the disposable, network-isolated CODE oracle process.
// The input is the exact extracted replacement, never a reference solution.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const {name,source,codes,oracleProfile}=JSON.parse(fs.readFileSync('.code-contract-input.json','utf8'));
const checks=[];
const observations=[];
const check=async(name,fn)=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,reason:e.message});}};
const load=()=>import(pathToFileURL(path.resolve(source)));
if(['0fe346cc820c','6fc5e4eb7dce'].includes(name)) {
 const m=await load(), owners=m.MODEL_ACTIVITY_OWNER;
 const readers=['LLM_GATEWAY','MODEL_VALIDATION','BINDING_VERIFICATION','BINDING_CUTOVER',...(name==='6fc5e4eb7dce'?['VRAM_ARTIFACT_USE']:[])];
 for(const owner of [...readers,'MODEL_PULL','MODEL_DELETE']) await check('owner retained: '+owner,()=>assert.equal(owners[owner],owner));
 for(const owner of readers) await check('shared coexistence and writer exclusion: '+owner,()=>{
  const a=new m.ModelUseAuthority(), r=a.acquireShared({modelName:'X:latest',owner}),other=a.acquireShared({modelName:'x',owner:'LLM_GATEWAY'});
  for(const w of ['MODEL_PULL','MODEL_DELETE'])assert.throws(()=>a.acquireExclusive({modelName:'x',owner:w}),e=>e.code==='MODEL_MUTATION_ACTIVE_USE');
  r.release();other.release();
  for(const w of ['MODEL_PULL','MODEL_DELETE']){
   const lease=a.acquireExclusive({modelName:'x',owner:w});
   assert.throws(()=>a.acquireShared({modelName:'X:latest',owner}),e=>e.code==='MODEL_USE_EXCLUSIVE_ACTIVE');lease.release();
  }
 });
 await check('unknown owner rejected',()=>assert.throws(()=>new m.ModelUseAuthority().acquireShared({modelName:'x',owner:'UNKNOWN'})));
} else if(name==='8cae1b583963') {
 const canonicalModelName=x=>typeof x==='string'?(x.trim().toLowerCase().replace(/:latest$/,'' )||null):null;
 const config={models:{CODE:'Bound:latest'}};
 const fn=vm.runInNewContext('({'+codes[0]+'}).getUnusedOldModels',{config,canonicalModelName,canonicalModelNameSet:xs=>new Set(xs.map(canonicalModelName).filter(Boolean))},{timeout:1000});
 const row=(previous_model,applied_at)=>({previous_model,applied_at,model:'new',role:'CODE'});
 await check('invalid, bound, duplicate names; newest metadata retained',()=>{
  const rows=[row(null,9),row('  ',8),row('ORPHAN:latest',7),row('orphan',6),row(' bound ',5),row('Other:3b',4),row('other:3b',3)];
  const actual=JSON.parse(JSON.stringify(fn.call({_db:{prepare:()=>({all:()=>rows})}})));
  assert.deepEqual(actual,[{model:'ORPHAN:latest',replacedBy:'new',role:'CODE',appliedAt:7},{model:'Other:3b',replacedBy:'new',role:'CODE',appliedAt:4}]);
 });
 await check('absent DB',()=>assert.equal(fn.call({_db:null}).length,0));
 await check('DB exception',()=>assert.equal(fn.call({_db:{prepare(){throw Error('offline')}}}).length,0));
} else if(name==='f63d14d5eb61') {
 const {decideRole}=await load();
 for(const side of ['candidate','incumbent'])for(const n of [1,2,3,7])await check('confidence '+side+'/'+n,()=>{
  const r=decideRole({margin:side==='candidate'?.2:-.2,candidateWins:side==='candidate'?n:0,incumbentWins:side==='incumbent'?n:0,inconclusive:false,discriminating:n});
  observations.push({case:'confidence',side,discriminating:n,result:r});
  assert.equal(r.winner,side);assert.equal(r.confidence,n===1?'nízká (jediná úloha)':n===2?'střední':'vysoká');
  if (oracleProfile !== 'code-executable-component.1') assert.match(r.detail,n===1?/nízk/i:n===2?/střední/i:/vysok/i);
  else assert.equal(typeof r.detail, 'string'); // Presence/type only; meaning is explicitly ungraded.
 });
 if (oracleProfile === 'code-executable-component.1') {
  for (const [label,comparison,speeds] of [
   ['below-quality-threshold',{margin:.03,candidateWins:3,incumbentWins:1,discriminating:4,inconclusive:false},{}],
   ['speed-candidate',{margin:0,discriminating:0,inconclusive:true},{candidate:20,incumbent:10}],
   ['speed-insufficient',{margin:0,discriminating:0,inconclusive:true},{candidate:11,incumbent:10}],
   ['speed-unmeasured',{margin:0,discriminating:0,inconclusive:true},{}],
  ]) {
   try { observations.push({case:label,comparison,speeds,result:decideRole(comparison,speeds,.05)}); }
   catch(error) { observations.push({case:label,error:error.message}); }
  }
 }
} else if(name==='75b5539f8cf5') {
 const m=await load();
 await check('typed persistence failure',()=>{const cause=Error('store failed');const e=new m.ChatPersistenceError(cause);assert.ok(e instanceof m.ChatTurnError);assert.equal(e.code,'CHAT_PERSISTENCE_FAILED');assert.equal(e.statusCode,500);assert.equal(e.recoverable,false);assert.equal(e.cause,cause);assert.equal(e.sourceErrorType,'ASSISTANT_TURN_PERSIST_FAILED');});
 await check('old errors retained',()=>{assert.equal(new m.LLMProviderUnavailableError().statusCode,503);assert.equal(new m.ChatProcessingError().recoverable,false);assert.doesNotThrow(()=>new m.ChatPersistenceError());});
} else throw Error('UNKNOWN_PUBLIC_CONTRACT:'+name);
const passed=checks.length>0&&checks.every(c=>c.passed);
console.log('CODE_CONTRACT_RECEIPT '+JSON.stringify({name,checks,passed,observations}));
if(!passed)process.exitCode=1;
