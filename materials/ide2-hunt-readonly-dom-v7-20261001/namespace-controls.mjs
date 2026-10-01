// Actual launch seam and own PID namespaces. No GPU/UI/provider/DB execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {CONFIG, ROOT, save, delay, inherited} from './common.mjs';
import {launchOwnedNamespace, processIdentity} from './pid-namespace-supervisor.mjs';
process.umask(0o077);
assert.equal(process.argv[2], '--cpu-controls');
const out = path.resolve(process.argv[3]); assert.equal(path.dirname(out), path.dirname(ROOT));
assert.equal(fs.existsSync(out), false); fs.mkdirSync(out, {mode: 0o700});
const sentinel = spawn(CONFIG.node, ['-e', 'setInterval(()=>{},1000)'], {cwd: ROOT, env: inherited(), detached: true, stdio: 'ignore'});
const sentinelDone = new Promise(resolve => sentinel.once('close', resolve));
const sentinelIdentity = processIdentity(sentinel.pid); assert.ok(sentinelIdentity);
const results = [];
async function until(label, fn) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {const v = fn(); if (v) return v; await delay(20);}
  throw Error(label + ' timeout');
}
try {
  // Reproduce the async metadata-listener yield: accepted abort exists when the
  // actual shared launcher is called. It must create no namespace or payload.
  const pre = path.join(out, 'abort-before-launch'); fs.mkdirSync(pre, {mode: 0o700});
  let interrupted = false; await new Promise(resolve => setImmediate(() => {interrupted = true; resolve();}));
  assert.throws(() => launchOwnedNamespace({out: pre, nonce: randomUUID(), isAborted: () => interrupted, mode: 'fixture', fixtureKind: 'deadline'}), /READONLY_NAMESPACE_ABORTED_BEFORE_SPAWN/);
  assert.equal(fs.existsSync(path.join(pre, 'NAMESPACE-HELLO.json')), false); assert.deepEqual(fs.readdirSync(pre), []);
  results.push({mode: 'abort-before-launch', actualGuardRejected: true, spawnedNamespace: false, outputMembers: 0});
  for (const kind of ['postspawn-fatal', 'deadline']) {
    const caseOut = path.join(out, kind); fs.mkdirSync(caseOut, {mode: 0o700});
    const launched = launchOwnedNamespace({out: caseOut, nonce: randomUUID(), isAborted: () => false, mode: 'fixture', fixtureKind: kind});
    const supervisor = launched.supervisor; assert.ok(supervisor);
    let pollError; const timer = setInterval(() => {try {supervisor.poll();} catch (error) {pollError = error;}}, 10);
    const stdout = [], stderr = []; launched.child.stdout.on('data', chunk => stdout.push(chunk)); launched.child.stderr.on('data', chunk => stderr.push(chunk));
    try {
      await until('running unpublished detached process', () => fs.existsSync(path.join(caseOut, 'FIXTURE-READY.json')));
      assert.equal(pollError, undefined); assert.ok(supervisor.init);
      const child = JSON.parse(fs.readFileSync(path.join(caseOut, 'DETACHED-STARTED.json')));
      assert.equal(child.pidNamespace, supervisor.namespace); assert.equal(child.namespacePid, child.pgid);
      const before = supervisor.members();
      assert.ok(before.find(p => p.namespacePids.at(-1) === child.namespacePid && p.state !== 'Z'));
      assert.ok(before.find(p => p.namespacePids.at(-1) === child.grandchildNamespacePid && p.state !== 'Z'));
      assert.equal(before.some(p => p.pid === sentinel.pid), false);
      save(caseOut, 'MEMBERS-BEFORE-FAULT.json', {before, child, ownershipPublished: fs.existsSync(path.join(caseOut, 'OWNERSHIP.json'))});
      assert.equal(fs.existsSync(path.join(caseOut, 'OWNERSHIP.json')), false);
      if (kind === 'postspawn-fatal') save(caseOut, 'INJECT-FATAL.json', {at: new Date().toISOString()});
      else supervisor.abort('CPU_HOST_DEADLINE');
      await Promise.race([supervisor.completion, delay(6_000)]);
      const completion = await supervisor.finish({interrupted: kind === 'deadline' ? 'CPU_HOST_DEADLINE' : null,
        payloadStatus: 'FAIL', cleanupAcknowledged: fs.existsSync(path.join(caseOut, 'CLEANUP-ACK.json'))});
      assert.equal(completion.status, 'FAIL'); assert.equal(completion.cleanup.settled, true);
      assert.equal(completion.cleanup.remainingOwnLiveProcesses, 0);
      assert.equal(supervisor.members().length, 0, 'all own namespace members disappeared, including unpublished detached groups');
      const currentSentinel = processIdentity(sentinel.pid); assert.ok(currentSentinel);
      assert.equal(currentSentinel.startTime, sentinelIdentity.startTime); assert.equal(currentSentinel.pidNamespace, sentinelIdentity.pidNamespace);
      results.push({mode: kind, actualCompletionStatus: completion.status, namespace: supervisor.namespace,
        initIdentity: supervisor.init, beforeMembers: before, completion, outsideSentinelPreserved: true});
    } finally {
      clearInterval(timer); await supervisor.stop();
      fs.writeFileSync(path.join(caseOut, 'stdout.log'), Buffer.concat(stdout), {mode: 0o600});
      fs.writeFileSync(path.join(caseOut, 'stderr.log'), Buffer.concat(stderr), {mode: 0o600});
    }
  }
  save(out, 'CPU-CONTROLS.json', {status: 'PASS', cases: results, caseCount: results.length,
    outsideSentinel: sentinelIdentity, providerRequests: 0, Nvidia: 'NOT_RUN', DBOpens: 0, AppImage: 'NOT_RUN'});
  process.stdout.write(JSON.stringify({status: 'PASS', cases: results.length, artifactRoot: out}) + '\n');
} finally {
  const current = processIdentity(sentinel.pid); if (current) {assert.equal(current.startTime, sentinelIdentity.startTime); sentinel.kill('SIGTERM');}
  await sentinelDone;
}
