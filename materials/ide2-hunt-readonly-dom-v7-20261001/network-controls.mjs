// Actual shared network guard under the same private netns/root-sysfs bwrap view.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {CONFIG,ROOT,save,inherited} from './common.mjs';
import {processIdentity,namespaceMembers} from './pid-namespace-supervisor.mjs';
process.umask(0o077);
assert.equal(process.argv[2],'--cpu-network-controls');
const out=path.resolve(process.argv[3]);assert.equal(path.dirname(out),path.dirname(ROOT));
assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{mode:0o700});
const parentNamespace=fs.readlinkSync('/proc/self/ns/net');
const sentinel=spawn(CONFIG.node,['-e','setInterval(()=>{},1000)'],{cwd:ROOT,env:inherited(),stdio:'ignore'});
const sentinelDone=new Promise(resolve=>sentinel.once('close',resolve));
const sentinelIdentity=processIdentity(sentinel.pid);assert.ok(sentinelIdentity);
const cases=[];
try {
  for(const mode of ['loopback-only','non-loopback-interface','non-loopback-route']) {
    const child=spawnSync('/usr/bin/unshare',['--user','--map-root-user','--net','--pid','--fork','--mount-proc','--kill-child=SIGKILL','--',
      '/usr/bin/bwrap','--bind','/','/','--ro-bind',ROOT,ROOT,'--dev','/dev','--die-with-parent',
      CONFIG.node,path.join(ROOT,'network-control-fixture.mjs'),mode,parentNamespace],
      {cwd:ROOT,env:inherited(),encoding:'utf8',timeout:15000,maxBuffer:256_000});
    fs.writeFileSync(path.join(out,mode+'.stdout.log'),child.stdout||'',{mode:0o600});
    fs.writeFileSync(path.join(out,mode+'.stderr.log'),child.stderr||'',{mode:0o600});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
    const observed=JSON.parse(child.stdout);assert.equal(observed.status,'PASS');assert.equal(observed.mode,mode);
    assert.notEqual(observed.actualNamespace,parentNamespace);
    const remaining=namespaceMembers(observed.pidNamespace);assert.equal(remaining.length,0,'owned namespace members after child exit');
    const current=processIdentity(sentinel.pid);assert.ok(current);assert.equal(current.startTime,sentinelIdentity.startTime);
    assert.equal(current.pidNamespace,sentinelIdentity.pidNamespace);assert.equal(fs.readlinkSync('/proc/self/ns/net'),parentNamespace);
    cases.push({...observed,actualChildExit:child.status,remainingOwnNamespaceMembers:remaining,
      parentNamespaceUnchanged:true,outsideSentinelPreserved:true});
  }
  save(out,'CPU-NETWORK-CONTROLS.json',{status:'PASS',caseCount:cases.length,cases,outsideSentinel:sentinelIdentity,
    noHostInterfacesCreated:true,foreignSignals:0,providerRequests:0,DBOpens:0,Nvidia:'NOT_RUN',AppImage:'NOT_RUN'});
  process.stdout.write(JSON.stringify({status:'PASS',cases:cases.length,artifactRoot:out})+'\n');
} finally {
  const current=processIdentity(sentinel.pid);if(current){assert.equal(current.startTime,sentinelIdentity.startTime);sentinel.kill('SIGTERM');}
  await sentinelDone;
}
