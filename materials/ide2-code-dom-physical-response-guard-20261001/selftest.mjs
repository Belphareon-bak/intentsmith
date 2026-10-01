import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { OwnedRelayRequests } from './relay-owned.mjs';
import { verifyPackageMembers } from './package-members.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fake = () => {
  const incoming = new EventEmitter(), outgoing = new EventEmitter();
  outgoing.writableFinished = false; outgoing.destroyed = false;
  outgoing.destroyCalls = 0;
  outgoing.destroy = () => { outgoing.destroyed = true; outgoing.destroyCalls++;
    queueMicrotask(() => outgoing.emit('close')); };
  const request = new EventEmitter();
  request.destroyCalls = 0;
  request.destroy = () => { request.destroyCalls++; queueMicrotask(() => request.emit('close')); };
  return { incoming, outgoing, request };
};

const abort = new OwnedRelayRequests();
const a = fake(), aTicket = abort.track(a.incoming,a.outgoing,a.request);
a.incoming.emit('aborted'); await aTicket.settled;
assert.equal(a.request.destroyCalls,1); assert.equal(abort.pending.size,0);

const disconnect = new OwnedRelayRequests();
const d = fake(), dTicket = disconnect.track(d.incoming,d.outgoing,d.request);
d.outgoing.emit('close'); await dTicket.settled;
assert.equal(d.request.destroyCalls,1); assert.equal(disconnect.pending.size,0);

const streaming = new OwnedRelayRequests();
const s = fake(), sTicket = streaming.track(s.incoming,s.outgoing,s.request);
const response = new EventEmitter(); response.destroyCalls=0;
response.destroy = () => { response.destroyCalls++; queueMicrotask(() => response.emit('close')); };
sTicket.attachResponse(response);
s.request.emit('close'); assert.equal(streaming.pending.size,1,'response remains owned after request close');
s.outgoing.emit('close'); await sTicket.settled;
assert.equal(response.destroyCalls,1); assert.equal(streaming.pending.size,0);

const normal = new OwnedRelayRequests();
const n = fake(), nTicket = normal.track(n.incoming,n.outgoing,n.request);
n.outgoing.writableFinished=true; n.outgoing.emit('close'); n.request.emit('close');
await nTicket.settled; assert.equal(n.request.destroyCalls,0);

const cleanup = new OwnedRelayRequests();
cleanup.track(...Object.values(fake())); cleanup.track(...Object.values(fake()));
const drained = await cleanup.cancelAndSettle();
assert.deepEqual(drained,{settled:true,cancelled:2,pending:0});
assert.throws(()=>cleanup.track(...Object.values(fake())),/relay is draining/);

const partial = () => {
  const f = fake(), response = new EventEmitter();
  response.complete = false; response.destroyCalls = 0;
  response.destroy = () => { response.destroyCalls++;
    queueMicrotask(() => response.emit('close')); };
  return { ...f, response };
};
const broken = new OwnedRelayRequests(), b = partial(), failure = [];
const bTicket = broken.track(b.incoming,b.outgoing,b.request,error=>failure.push(error.message));
bTicket.attachResponse(b.response); b.request.emit('close');
b.response.emit('error',new Error('synthetic upstream ECONNRESET'));
await bTicket.settled;
assert.deepEqual(failure,['synthetic upstream ECONNRESET']);
assert.equal(b.outgoing.destroyCalls,1); assert.equal(broken.pending.size,0);

const aborted = new OwnedRelayRequests(), u = partial(), abortFailure = [];
const uTicket = aborted.track(u.incoming,u.outgoing,u.request,error=>abortFailure.push(error.message));
uTicket.attachResponse(u.response); u.request.emit('close'); u.response.emit('aborted');
await uTicket.settled;
assert.deepEqual(abortFailure,['upstream provider response aborted']);
assert.equal(u.outgoing.destroyCalls,1); assert.equal(aborted.pending.size,0);

const incomplete = new OwnedRelayRequests(), c = partial(), closeFailure = [];
const cTicket = incomplete.track(c.incoming,c.outgoing,c.request,error=>closeFailure.push(error.message));
cTicket.attachResponse(c.response); c.request.emit('close'); c.response.emit('close');
await cTicket.settled;
assert.deepEqual(closeFailure,['upstream provider response closed incomplete']);
assert.equal(c.outgoing.destroyCalls,1); assert.equal(incomplete.pending.size,0);

const mini = fs.mkdtempSync(path.join(os.tmpdir(),'is-ide-package-selftest-'));
let manifestTamperRejected=false, memberTamperRejected=false, extraMemberRejected=false;
try {
  const member=path.join(mini,'member.txt'), manifest=path.join(mini,'SHA256SUMS');
  fs.writeFileSync(member,'exact bytes\n');
  fs.writeFileSync(manifest,`${sha(fs.readFileSync(member))}  member.txt\n`);
  const manifestSha=sha(fs.readFileSync(manifest));
  assert.equal(verifyPackageMembers(mini,manifestSha).memberCount,1);
  fs.writeFileSync(member,'tampered bytes\n');
  assert.throws(()=>verifyPackageMembers(mini,manifestSha)); memberTamperRejected=true;
  fs.writeFileSync(member,'exact bytes\n');
  fs.writeFileSync(path.join(mini,'extra.txt'),'undeclared');
  assert.throws(()=>verifyPackageMembers(mini,manifestSha)); extraMemberRejected=true;
  fs.rmSync(path.join(mini,'extra.txt'));
  fs.writeFileSync(manifest,'0'.repeat(64)+'  member.txt\n');
  assert.throws(()=>verifyPackageMembers(mini,manifestSha)); manifestTamperRejected=true;
} finally { fs.rmSync(mini,{recursive:true,force:true}); }

console.log(JSON.stringify({status:'PASS',upstreamAbortDestroy:true,
  downstreamCloseDestroy:true,responseStreamCloseWait:true,normalResponseNoDestroy:true,
  cleanupSettledBeforeRelease:true,lateTrackRejected:true,
  upstreamErrorClosesDownstream:true,upstreamAbortClosesDownstream:true,
  incompleteCloseClosesDownstream:true,
  memberTamperRejected,extraMemberRejected,manifestTamperRejected}));
