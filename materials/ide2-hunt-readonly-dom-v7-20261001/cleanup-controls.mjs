// Pure CPU controls over the real shared classifier/finish/inner scanner code.
// No namespaces/processes/browser/backend/GPU/provider/DB are launched.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {CONFIG,ROOT,save,fileSha} from './common.mjs';
import {classifyInnerOwnedGroups} from './cleanup-boundary.mjs';
import {OwnedPidNamespace} from './pid-namespace-supervisor.mjs';
process.umask(0o077);
assert.equal(process.argv[2],'--cpu-cleanup-controls');
const out=path.resolve(process.argv[3]);assert.equal(path.dirname(out),path.dirname(ROOT));assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{mode:0o700});
const cases=[],z=[{pid:78,group:75,state:'Z'},{pid:79,group:75,state:'Z'}];
for(const [name,rows,groups,ready]of [
 ['exact-owned-Z-only-deferred',z,[75],true],['empty-inner-groups',[],[75],true],
 ['live-child',[{pid:78,group:75,state:'S'}],[75],false],['mixed-Z-live',[...z,{pid:80,group:75,state:'R'}],[75],false],
 ['unknown-state',[{pid:78,group:75,state:'?'}],[75],false],['unreadable-row',[{pid:78,group:null,state:'UNKNOWN',error:'EACCES'}],[75],false],
 ['foreign-group-Z',[{pid:78,group:76,state:'Z'}],[75],false],['invalid-pid-Z',[{pid:0,group:75,state:'Z'}],[75],false],
 ['duplicate-pid',[...z,z[0]],[75],false],['malformed-null',[null],[75],false],['malformed-primitive',[42],[75],false],
 ['malformed-observation',null,[75],false],['malformed-ownership',z,[75,75],false]]){
 const got=classifyInnerOwnedGroups(rows,groups);assert.equal(got.readyForNamespaceTeardown,ready,name);if(Array.isArray(rows))assert.deepEqual(got.allRows,rows);
 if(name==='exact-owned-Z-only-deferred'){assert.equal(got.zombies.length,2);assert.equal(got.status,'ZOMBIES_DEFERRED_TO_INIT_TEARDOWN');}
 cases.push({case:name,status:'PASS',observed:got});
}
const probe=fs.readFileSync(path.join(ROOT,'probe.mjs'),'utf8');const scanner=probe.slice(probe.indexOf('function ownedGroups() {'),probe.indexOf('\nasync function start('));
for(const [name,raw,code,expected]of [['actual-scanner-zombie','78 (owned) Z 1 75 0',null,true],['actual-scanner-live','78 (owned) S 1 75 0',null,false],['actual-scanner-malformed','invalid',null,false],['actual-scanner-unreadable',null,'EACCES',false],['actual-scanner-disappeared',null,'ENOENT',true],['actual-scanner-valid-control-PGID0','78 (control) S 0 0 0',null,true],['actual-scanner-unknown-control-PGID0','78 (bad) ? 0 0 0',null,false],['actual-scanner-negative-PGID','78 (bad) S 0 -1 0',null,false],['actual-scanner-foreign-positive-PGID','78 (other) S 0 76 0',null,true]]){
 const fakeFs={readdirSync:()=>['78'],readFileSync:()=>{if(code){const e=Error(code);e.code=code;throw e;}return raw;}};
 const rows=vm.runInNewContext(scanner+'\nownedGroups();',{fs:fakeFs,children:[{pid:75}]},{timeout:1000});
 const got=classifyInnerOwnedGroups(JSON.parse(JSON.stringify(rows)),[75]);assert.equal(got.readyForNamespaceTeardown,expected,name);cases.push({case:name,status:'PASS',observed:got});
}
// Call the actual shared supervisor.finish method with injected cleanup seam.
// It cannot spawn/kill/read processes because only stop() result is controlled.
const valid={settled:true,after:[],remainingOwnLiveProcesses:0};
for(const [name,cleanup,args,exit,expected]of [
 ['parent-empty-ack-uninterrupted',valid,{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true},{code:0,signal:null},'PASS'],
 ['parent-Z-nonempty',{...valid,after:z},{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true},{code:0,signal:null},'FAIL'],
 ['parent-live-nonempty',{...valid,after:[{pid:1,state:'S'}]},{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true},{code:0,signal:null},'FAIL'],
 ['parent-unreadable-after',{...valid,after:null},{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true},{code:0,signal:null},'FAIL'],
 ['parent-missing-ACK',valid,{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:false},{code:0,signal:null},'FAIL'],
 ['parent-interrupted',valid,{interrupted:'CPU_DEADLINE',payloadStatus:'PASS',cleanupAcknowledged:true},{code:0,signal:null},'FAIL'],
 ['parent-payload-failed',valid,{interrupted:null,payloadStatus:'FAIL',cleanupAcknowledged:true},{code:0,signal:null},'FAIL'],
 ['parent-exit-failed',valid,{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true},{code:1,signal:null},'FAIL'],
 ['parent-unsettled',{...valid,settled:false},{interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true},{code:0,signal:null},'FAIL']]){
 const got=await OwnedPidNamespace.prototype.finish.call({stop:async()=>cleanup,exit},args);assert.equal(got.status,expected,name);cases.push({case:name,status:'PASS',observed:got});
}
await assert.rejects(()=>OwnedPidNamespace.prototype.finish.call({stop:async()=>{throw Error('own namespace read denied');},exit:{code:0,signal:null}},
 {interrupted:null,payloadStatus:'PASS',cleanupAcknowledged:true}),/read denied/);cases.push({case:'parent-namespace-read-error-cannot-PASS',status:'PASS'});
const host=fs.readFileSync(path.join(ROOT,'host.mjs'),'utf8');assert.ok(host.includes(').nonce === nonce'));
assert.ok(host.includes('!result.upstreamDrain.settled || result.upstreamDrain.pending || !result.relayClosed'));
const prior=path.join(path.dirname(ROOT),'ide2-hunt-readonly-dom-34cfc198-v5-20261001-1800');assert.equal(fileSha(path.join(ROOT,'host.mjs')),fileSha(path.join(prior,'host.mjs')));
save(out,'CPU-CLEANUP-CONTROLS.json',{status:'PASS',caseCount:cases.length,cases,sourceHashes:{classifier:fileSha(path.join(ROOT,'cleanup-boundary.mjs')),probe:fileSha(path.join(ROOT,'probe.mjs')),supervisor:fileSha(path.join(ROOT,'pid-namespace-supervisor.mjs')),host:fileSha(path.join(ROOT,'host.mjs'))},
 qualification:'Pure controlled observation and actual method seams only; does not execute namespace teardown. Prior actual namespace controls remain unchanged-source historical evidence. Fresh physical run requires independent GO.',AppImage:'NOT_RUN',browser:'NOT_RUN',providerRequests:0,Nvidia:'NOT_RUN',DBOpens:0,namespacesLaunched:0});
console.log(JSON.stringify({status:'PASS',caseCount:cases.length,out}));
