// Actual CPU owned Linux namespace controls using the existing guarded launcher.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {CONFIG,ROOT,save,delay,inherited} from './common.mjs';
import {launchOwnedNamespace,processIdentity} from './pid-namespace-supervisor.mjs';
process.umask(0o077);assert.equal(process.argv[2],'--cpu-proc-controls');
const out=path.resolve(process.argv[3]);assert.equal(path.dirname(out),path.dirname(ROOT));assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{mode:0o700});
const sentinel=spawn(CONFIG.node,['-e','setInterval(()=>{},1000)'],{cwd:ROOT,env:inherited(),detached:true,stdio:'ignore'});
const sentinelDone=new Promise(resolve=>sentinel.once('close',resolve));const sentinelIdentity=processIdentity(sentinel.pid);assert.ok(sentinelIdentity);
let launched,timer;const stdout=[],stderr=[];
try{
  const nonce=randomUUID();launched=launchOwnedNamespace({out,nonce,isAborted:()=>false,mode:'fixture',fixtureKind:'proc-stat-scan'});
  assert.ok(launched.supervisor);const supervisor=launched.supervisor;let pollError;
  timer=setInterval(()=>{try{supervisor.poll();}catch(error){pollError=error;}},10);
  launched.child.stdout.on('data',chunk=>stdout.push(chunk));launched.child.stderr.on('data',chunk=>stderr.push(chunk));
  const deadline=Date.now()+12000;
  while(Date.now()<deadline&&!supervisor.closed&&!pollError)await delay(20);
  if(!supervisor.closed){supervisor.abort('CPU_PROC_DEADLINE');throw pollError||Error('CPU_PROC_DEADLINE');}
  assert.equal(pollError,undefined);assert.ok(supervisor.init);
  const fixture=JSON.parse(fs.readFileSync(path.join(out,'CPU-PROC-FIXTURE.json'))),ack=JSON.parse(fs.readFileSync(path.join(out,'CLEANUP-ACK.json')));
  assert.equal(ack.nonce,nonce);assert.equal(ack.pidNamespace,supervisor.namespace);assert.equal(fixture.namespace,supervisor.namespace);
  const completion=await supervisor.finish({interrupted:null,payloadStatus:fixture.status,cleanupAcknowledged:ack.status==='PASS'});
  assert.equal(completion.status,'PASS');assert.deepEqual(completion.cleanup.after,[]);assert.equal(supervisor.members().length,0);
  const current=processIdentity(sentinel.pid);assert.ok(current);assert.equal(current.startTime,sentinelIdentity.startTime);assert.equal(current.pidNamespace,sentinelIdentity.pidNamespace);
  const cases=[...fixture.cases,{case:'actual-parent-strict-namespace-zero-and-outside-sentinel-preserved',status:'PASS',completion,initIdentity:supervisor.init,outsideSentinelPreserved:true}];
  save(out,'CPU-PROC-CONTROLS.json',{status:'PASS',caseCount:cases.length,cases,outsideSentinel:sentinelIdentity,providerRequests:0,Nvidia:'NOT_RUN',DBOpens:0,AppImage:'NOT_RUN',browser:'NOT_RUN',actualOwnedNamespaces:1,foreignSignals:0});
  console.log(JSON.stringify({status:'PASS',caseCount:cases.length,out}));
}finally{
  clearInterval(timer);
  if(launched?.supervisor)await launched.supervisor.stop();
  fs.writeFileSync(path.join(out,'stdout.log'),Buffer.concat(stdout),{mode:0o600});fs.writeFileSync(path.join(out,'stderr.log'),Buffer.concat(stderr),{mode:0o600});
  const current=processIdentity(sentinel.pid);if(current){assert.equal(current.startTime,sentinelIdentity.startTime);sentinel.kill('SIGTERM');}await sentinelDone;
  save(out,'SENTINEL-CLEANUP.json',{ownSentinelAbsent:processIdentity(sentinel.pid)===null,foreignSignals:0});
}
