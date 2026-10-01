// Own user/net/PID namespace CPU fixture. No backend, GUI, GPU, provider or DB.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {observeLoopbackOnlyNetwork} from './network-view.mjs';
const [mode,parentNamespace] = process.argv.slice(2);
assert.ok(['loopback-only','non-loopback-interface','non-loopback-route'].includes(mode));
const expectedNamespace = fs.readlinkSync('/proc/self/ns/net');
assert.notEqual(expectedNamespace,parentNamespace);
function ip(args) {
  const result=spawnSync('/usr/sbin/ip',args,{encoding:'utf8',timeout:3000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
}
ip(['link','set','lo','up']);
if(mode!=='loopback-only') {
  // Both veth ends exist only inside this exact owned namespace; no host peer.
  ip(['link','add','guard0','type','veth','peer','name','guard1']);
  if(mode==='non-loopback-route') {
    ip(['addr','add','192.0.2.1/24','dev','guard0']);ip(['link','set','guard0','up']);
  }
}
let observation,rejection;
try {observation=observeLoopbackOnlyNetwork({parentNamespace,expectedNamespace});}
catch(error) {rejection=error.message;observation=error.networkObservation;}
assert.ok(observation);
if(mode==='loopback-only') {
  assert.equal(rejection,undefined);assert.deepEqual(observation.kernelInterfaces,['lo']);
} else {
  const marker=mode==='non-loopback-route'?'HUNT_NETWORK_NON_LOOPBACK_ROUTE':'HUNT_NETWORK_NON_LOOPBACK_INTERFACE';
  assert.ok(rejection.includes(marker));
  assert.ok(observation.kernelInterfaces.includes('guard0')&&observation.kernelInterfaces.includes('guard1'));
  if(mode==='non-loopback-route') assert.ok(observation.routes4.some(route=>route.dev==='guard0'));
}
process.stdout.write(JSON.stringify({status:'PASS',mode,actualNamespace:expectedNamespace,
  pidNamespace:fs.readlinkSync('/proc/self/ns/pid'),
  namespacePid:process.pid,observation,rejection:rejection||null,providerRequests:0,DBOpens:0,Nvidia:'NOT_RUN',AppImage:'NOT_RUN'})+'\n');
