// Own PID namespace init. Its exit lets the kernel kill EVERY namespace child,
// including detached payloads for which no owner record or finally ever ran.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {CONFIG, ROOT, save, delay, inherited} from './common.mjs';
import {processIdentity} from './pid-namespace-supervisor.mjs';
process.umask(0o077);
const [out, nonce, mode, fixtureKind] = process.argv.slice(2);
assert.equal(process.pid, 1); assert.equal(process.getuid(), 0);
assert.ok(['dom', 'fixture'].includes(mode));
const self = processIdentity(process.pid); assert.ok(self);
const hello = {nonce, namespacePid: 1, namespaceUid: process.getuid(), startTime: self.startTime,
  pidNamespace: fs.readlinkSync('/proc/self/ns/pid'), netNamespace: fs.readlinkSync('/proc/self/ns/net')};
save(out, 'NAMESPACE-HELLO.json', hello);
let child, interrupted = null;
const abort = reason => {interrupted ||= reason; child?.kill('SIGTERM');};
const onTerm = () => abort('INIT_SIGTERM'), onInt = () => abort('INIT_SIGINT');
process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
function checkAbort() {
  const file = path.join(out, 'ABORT.json');
  if (fs.existsSync(file)) {const value = JSON.parse(fs.readFileSync(file)); if (value.nonce === nonce) abort(value.reason);}
  return interrupted;
}
const deadline = Date.now() + 10_000;
let ack;
while (Date.now() < deadline && !checkAbort()) {
  const file = path.join(out, 'NAMESPACE-ACK.json');
  if (fs.existsSync(file)) {
    ack = JSON.parse(fs.readFileSync(file));
    assert.equal(ack.nonce, nonce); assert.equal(ack.pidNamespace, hello.pidNamespace);
    assert.equal(ack.initStartTime, hello.startTime); assert.equal(ack.namespacePid, 1); break;
  }
  await delay(25);
}
if (!ack || checkAbort()) {save(out, 'INIT-RESULT.json', {status: 'FAIL', payloadSpawned: false, reason: interrupted || 'HOST_ACK_TIMEOUT'}); process.exit(1);}
const command = mode === 'dom' ? '/usr/bin/bwrap' : CONFIG.node;
const args = mode === 'dom'
  ? ['--bind', '/', '/', '--ro-bind', CONFIG.backend, CONFIG.backend, '--ro-bind', CONFIG.package, CONFIG.package,
    '--dev', '/dev', '--die-with-parent', CONFIG.node, path.join(ROOT, 'probe.mjs'), '--inner', out]
  : [path.join(ROOT, 'namespace-fixture.mjs'), out, fixtureKind];
// No await between the last abort check and spawn. The init lifetime itself is
// the ownership boundary; there is no detached-publication prerequisite.
if (checkAbort()) process.exit(1);
child = spawn(command, args, {cwd: ROOT, env: inherited(), stdio: 'inherit'});
let abortTimer;
const watch = setInterval(() => {if (checkAbort() && !abortTimer) abortTimer = setTimeout(() => process.exit(1), 3_000);}, 25);
const terminal = await new Promise(resolve => {child.once('error', error => resolve({code: 1, error: error.message})); child.once('close', (code, signal) => resolve({code, signal}));});
clearInterval(watch); clearTimeout(abortTimer);
save(out, 'INIT-RESULT.json', {status: !interrupted && terminal.code === 0 && terminal.signal === null ? 'PASS' : 'FAIL', payloadSpawned: true, interrupted, terminal});
// Do not wait for unregistered detached children: exiting init is the kernel
// teardown and cannot preserve a leaked group in this PID namespace.
process.exit(!interrupted && terminal.code === 0 && terminal.signal === null ? 0 : 1);
