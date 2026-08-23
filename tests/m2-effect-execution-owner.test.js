import assert from 'node:assert/strict';
import {
  createProcessExecutionLiveness,
  createProcessExecutionOwner,
} from '../src/effects/execution-owner.js';
import { suite, test, summary } from './harness.js';

function procStat(startIdentity) {
  const fields = Array.from({ length: 20 }, (_, index) => String(index + 3));
  fields[19] = String(startIdentity);
  return `1234 (worker with spaces) ${fields.join(' ')}`;
}

function fakeProc({ bootId = 'boot-a', pid = 1234, startIdentity = '9191', missing = false } = {}) {
  return {
    readFileSync(filePath) {
      if (filePath === '/proc/sys/kernel/random/boot_id') {
        if (bootId === null) throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
        return `${bootId}\n`;
      }
      if (filePath === `/proc/${pid}/stat`) {
        if (missing) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        return `${procStat(startIdentity)}\n`;
      }
      throw Object.assign(new Error('unexpected path'), { code: 'ENOENT' });
    },
  };
}

function claim(overrides = {}) {
  return {
    ownerId: 'owner:test',
    ownerPid: 1234,
    ownerBootId: 'boot-a',
    ownerStartIdentity: '9191',
    ...overrides,
  };
}

suite('M2 durable execution owner liveness');

test('captured owner binds PID, boot identity, and proc start identity', () => {
  const owner = createProcessExecutionOwner({
    fileSystem: fakeProc(),
    pid: 1234,
    fallback: 'fixed-fallback',
  });
  assert.equal(owner.pid, 1234);
  assert.equal(owner.bootId, 'boot-a');
  assert.equal(owner.startIdentity, '9191');
  assert.match(owner.ownerId, /^owner:[a-f0-9]{64}$/);
});

test('same boot, PID, and start identity is not proof of death', () => {
  const liveness = createProcessExecutionLiveness({ fileSystem: fakeProc() });
  assert.equal(liveness.isProvablyDead(claim()), false);
});

test('missing PID is proof of death only when boot identity is known', () => {
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ missing: true }) })
      .isProvablyDead(claim()),
    true,
  );
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ bootId: null, missing: true }) })
      .isProvablyDead(claim()),
    false,
  );
});

test('PID reuse and boot replacement are independent proof of death', () => {
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ startIdentity: 'different' }) })
      .isProvablyDead(claim()),
    true,
  );
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ bootId: 'boot-b' }) })
      .isProvablyDead(claim()),
    true,
  );
});

test('malformed or previously unknown identity fails closed', () => {
  const liveness = createProcessExecutionLiveness({ fileSystem: fakeProc({ missing: true }) });
  assert.equal(liveness.isProvablyDead(null), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerPid: 0 })), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerBootId: undefined })), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerBootId: 'unknown:fallback' })), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerStartIdentity: '' })), false);
});

summary();
