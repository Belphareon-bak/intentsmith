// Actual Linux /proc scanner qualification in the existing owned init namespace.
// No AppImage/backend/provider/GPU/database or project module is executed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {CONFIG,ROOT,save,delay,inherited,fileSha} from './common.mjs';
import {classifyInnerOwnedGroups} from './cleanup-boundary.mjs';
const out=process.argv[2], namespace=fs.readlinkSync('/proc/self/ns/pid');
const ack=JSON.parse(fs.readFileSync(path.join(out,'NAMESPACE-ACK.json')));
assert.equal(ack.pidNamespace,namespace);
const child=spawn(CONFIG.node,['-e','setInterval(()=>{},1000)'],{cwd:out,env:inherited(),detached:true,stdio:'ignore'});
const done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
const rows=[];
function actualStat(pid){
  const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8'),c=raw.slice(raw.lastIndexOf(')')+1).trim().split(/\s+/);
  return {pid,group:Number(c[2]),state:c[0],startTime:c[19],namespace:fs.readlinkSync('/proc/'+pid+'/ns/pid')};
}
function scan(root){
  const source=fs.readFileSync(path.join(root,'probe.mjs'),'utf8');
  const scanner=source.slice(source.indexOf('function ownedGroups() {'),source.indexOf('\nasync function start('));
  // This is the real scanner and real namespace /proc FS, not mocked output.
  return JSON.parse(JSON.stringify(vm.runInNewContext(scanner+'\nownedGroups();',{fs,children:[{pid:child.pid}]},{timeout:1000})));
}
try{
  assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0);
  await delay(50);
  const init=actualStat(1),controller=actualStat(process.pid),tracked=actualStat(child.pid);
  assert.equal(init.group,0);assert.equal(controller.group,0);
  assert.equal(tracked.group,child.pid);assert.equal(tracked.namespace,namespace);
  rows.push({case:'actual-init-and-controller-PGID0-valid',status:'PASS',init,controller,tracked});
  const current=scan(ROOT),oldRoot=path.join(path.dirname(ROOT),'ide2-hunt-readonly-dom-34cfc198-v6-20261001-1820'),old=scan(oldRoot);
  assert.ok(old.some(row=>row.pid===1&&row.error==='MALFORMED_PROC_STAT'));
  assert.ok(old.some(row=>row.pid===process.pid&&row.error==='MALFORMED_PROC_STAT'));
  assert.ok(current.length>0);assert.ok(current.every(row=>row.group===child.pid&&!row.error));
  assert.ok(current.some(row=>row.pid===child.pid));
  const live=classifyInnerOwnedGroups(current,[child.pid]);assert.equal(live.readyForNamespaceTeardown,false);
  rows.push({case:'actual-V6-red-control-zero/V7-filtered-positive-live-still-FAIL',status:'PASS',oldV6Rows:old,currentRows:current,currentBoundary:live,oldProbeSha256:fileSha(path.join(oldRoot,'probe.mjs')),newProbeSha256:fileSha(path.join(ROOT,'probe.mjs'))});
  child.kill('SIGTERM');const terminal=await done;
  const final=scan(ROOT),boundary=classifyInnerOwnedGroups(final,[child.pid]);
  assert.equal(boundary.readyForNamespaceTeardown,true);assert.equal(boundary.unknown.length,0);assert.equal(boundary.live.length,0);
  rows.push({case:'actual-inner-post-child-stop-ready-for-mandatory-init-teardown',status:'PASS',terminal,finalRows:final,boundary});
  save(out,'CPU-PROC-FIXTURE.json',{status:'PASS',caseCount:rows.length,cases:rows,namespace,namespacePid:process.pid,providerRequests:0,GPU:'NOT_RUN',DBOpens:0});
  save(out,'CLEANUP-ACK.json',{nonce:ack.nonce,pidNamespace:namespace,status:'PASS',innerGroupBoundary:boundary});
}finally{
  try{child.kill('SIGTERM');}catch{}
  await done;
}
