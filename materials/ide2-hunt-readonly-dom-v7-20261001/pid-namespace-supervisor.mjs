// Own namespace lifecycle, independent of detached-child publication. Init exit
// invokes kernel PID namespace teardown; only exact verified own init is killed.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {CONFIG, ROOT, save, delay, inherited} from './common.mjs';
export function processIdentity(pid) {
  try {
    const raw = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const c = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
    return {pid: Number(pid), state: c[0], parent: Number(c[1]), pgid: Number(c[2]), startTime: c[19],
      uid: Number(/^Uid:\s+(\d+)/m.exec(status)[1]),
      namespacePids: /^NSpid:\s+(.+)$/m.exec(status)?.[1].trim().split(/\s+/).map(Number) || [],
      pidNamespace: fs.readlinkSync('/proc/' + pid + '/ns/pid')};
  } catch (error) {if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error;}
}
export function namespaceMembers(pidNamespace) {
  const rows = [];
  for (const name of fs.readdirSync('/proc')) if (/^\d+$/.test(name)) {
    let ns; try {ns = fs.readlinkSync('/proc/' + name + '/ns/pid');} catch {continue;}
    if (ns !== pidNamespace) continue;
    const row = processIdentity(Number(name)); if (row) rows.push(row);
  }
  return rows;
}
export function launchOwnedNamespace({out, nonce, isAborted, mode = 'dom', fixtureKind}) {
  // Called immediately after host async waits. No await between check and spawn.
  assert.equal(isAborted(), false, 'READONLY_NAMESPACE_ABORTED_BEFORE_SPAWN');
  assert.ok(['dom', 'fixture'].includes(mode));
  const child = spawn('/usr/bin/unshare', ['--user', '--map-root-user', '--net', '--pid', '--fork',
    '--mount-proc', '--kill-child=SIGKILL', '--', CONFIG.node, path.join(ROOT, 'namespace-init.mjs'), out, nonce, mode, fixtureKind || ''],
    {cwd: ROOT, env: inherited(), stdio: ['ignore', 'pipe', 'pipe']});
  const result = {child, supervisor: null};
  // An ENOENT launcher creates no payload. Attach the error listener immediately.
  child.on('error', error => {result.spawnError = error;});
  if (child.pid) result.supervisor = new OwnedPidNamespace({out, nonce, child});
  return result;
}
export class OwnedPidNamespace {
  constructor({out, nonce, child}) {
    this.out = out; this.nonce = nonce; this.child = child; this.init = null; this.namespace = null;
    this.outer = processIdentity(child.pid); assert.ok(this.outer);
    assert.equal(this.outer.uid, process.getuid()); assert.equal(this.outer.parent, process.pid);
    this.closed = false; this.exit = null;
    this.completion = new Promise(resolve => child.once('close', (code, signal) => {
      this.closed = true; this.exit = {code, signal}; resolve(this.exit);
    }));
  }
  poll() {
    if (this.init || this.closed) return;
    const file = path.join(this.out, 'NAMESPACE-HELLO.json'); if (!fs.existsSync(file)) return;
    const hello = JSON.parse(fs.readFileSync(file)); assert.equal(hello.nonce, this.nonce);
    assert.equal(hello.namespacePid, 1); assert.equal(hello.namespaceUid, 0);
    const children = fs.readFileSync('/proc/' + this.outer.pid + '/task/' + this.outer.pid + '/children', 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
    const matches = children.map(processIdentity).filter(row => row && row.pidNamespace === hello.pidNamespace && row.namespacePids.at(-1) === 1);
    assert.equal(matches.length, 1, 'exact direct init child required');
    const init = matches[0]; assert.equal(init.uid, process.getuid()); assert.equal(init.parent, this.outer.pid);
    assert.equal(init.startTime, hello.startTime);
    assert.notEqual(init.pidNamespace, fs.readlinkSync('/proc/self/ns/pid'));
    assert.notEqual(hello.netNamespace, fs.readlinkSync('/proc/self/ns/net'));
    this.init = init; this.namespace = init.pidNamespace;
    save(this.out, 'NAMESPACE-ACK.json', {nonce: this.nonce, initHostPid: init.pid,
      initStartTime: init.startTime, pidNamespace: init.pidNamespace, namespacePid: 1, at: new Date().toISOString()});
    save(this.out, 'NAMESPACE-HOST-IDENTITY.json', {outer: this.outer, init, hello,
      namespaceMembers: this.members(), exactOwnUID: true});
  }
  members() {return this.namespace ? namespaceMembers(this.namespace) : [];}
  abort(reason) {save(this.out, 'ABORT.json', {nonce: this.nonce, reason, at: new Date().toISOString()});}
  async stop() {
    this.poll();
    const before = this.members();
    let signalled = null;
    if (this.init) {
      const current = processIdentity(this.init.pid);
      if (current) {
        assert.equal(current.startTime, this.init.startTime, 'PID reuse: refuse kill');
        assert.equal(current.uid, process.getuid()); assert.equal(current.pidNamespace, this.namespace);
        assert.equal(current.namespacePids.at(-1), 1);
        process.kill(current.pid, 'SIGKILL'); signalled = {hostPid: current.pid, signal: 'SIGKILL', namespaceInitOnly: true};
      }
    } else if (!this.closed) {
      // Before ACK no payload can start. --kill-child kills the unshare init on
      // launcher death even when HELLO was never written (early init failure).
      const outer = processIdentity(this.outer.pid);
      if (outer) {assert.equal(outer.startTime, this.outer.startTime); assert.equal(outer.uid, process.getuid());
        process.kill(outer.pid, 'SIGKILL'); signalled = {hostPid: outer.pid, signal: 'SIGKILL', ownedUnshareOnly: true};}
    }
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && (!this.closed || this.members().some(row => row.state !== 'Z'))) await delay(25);
    const after = this.members();
    const result = {settled: this.closed && after.filter(row => row.state !== 'Z').length === 0,
      before, after, remainingOwnLiveProcesses: after.filter(row => row.state !== 'Z').length,
      signalled, exit: this.exit, foreignSignals: 0};
    save(this.out, 'NAMESPACE-CLEANUP.json', result); return result;
  }
  async finish({interrupted, payloadStatus, cleanupAcknowledged}) {
    const cleanup = await this.stop();
    const status = !interrupted && payloadStatus === 'PASS' && cleanupAcknowledged
      && this.exit?.code === 0 && this.exit?.signal === null && cleanup.settled
      && Array.isArray(cleanup.after) && cleanup.after.length === 0 ? 'PASS' : 'FAIL';
    return {status, cleanup, interrupted: interrupted || null, cleanupAcknowledged};
  }
}
