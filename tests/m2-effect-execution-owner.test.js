import assert from 'node:assert/strict';
import {
  createProcessExecutionLiveness,
  createProcessExecutionOwner,
} from '../src/effects/execution-owner.js';
import { suite, test, summary } from './harness.js';

const BOOT_A = '11111111-1111-4111-8111-111111111111';
const BOOT_B = '22222222-2222-4222-8222-222222222222';

function procStat(startIdentity) {
  const fields = Array.from({ length: 20 }, (_, index) => String(index + 3));
  fields[19] = String(startIdentity);
  return `1234 (worker with spaces) ${fields.join(' ')}`;
}

function fakeProc({
  bootId = BOOT_A,
  pid = 1234,
  startIdentity = '9191',
  missing = false,
  statErrorCode = null,
  malformed = false,
} = {}) {
  return {
    readFileSync(filePath) {
      if (filePath === '/proc/sys/kernel/random/boot_id') {
        if (bootId === null) throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
        return `${bootId}\n`;
      }
      if (filePath === `/proc/${pid}/stat`) {
        if (missing) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        if (statErrorCode) throw Object.assign(new Error('unavailable'), { code: statErrorCode });
        if (malformed) return 'not a proc stat record\n';
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
    ownerBootId: BOOT_A,
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
  assert.equal(owner.bootId, BOOT_A);
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
    createProcessExecutionLiveness({ fileSystem: fakeProc({ startIdentity: '9292' }) })
      .isProvablyDead(claim()),
    true,
  );
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ bootId: BOOT_B }) })
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
  assert.equal(liveness.isProvablyDead(claim({ ownerStartIdentity: 'unknown:fallback' })), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerStartIdentity: '' })), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerBootId: 'persisted-malformed' })), false);
  assert.equal(liveness.isProvablyDead(claim({ ownerStartIdentity: 'persisted-malformed' })), false);
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ statErrorCode: 'EACCES' }) })
      .isProvablyDead(claim()),
    false,
  );
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ statErrorCode: 'EIO' }) })
      .isProvablyDead(claim()),
    false,
  );
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ malformed: true }) })
      .isProvablyDead(claim()),
    false,
  );
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc({ bootId: 'malformed-boot-id' }) })
      .isProvablyDead(claim()),
    false,
  );
  const partiallyUnknownOwner = createProcessExecutionOwner({
    fileSystem: fakeProc({ statErrorCode: 'EACCES' }),
    pid: 1234,
    fallback: 'fixed-fallback',
  });
  assert.equal(partiallyUnknownOwner.startIdentity, 'unknown:fixed-fallback');
  assert.equal(
    createProcessExecutionLiveness({ fileSystem: fakeProc() }).isProvablyDead({
      ownerId: partiallyUnknownOwner.ownerId,
      ownerPid: partiallyUnknownOwner.pid,
      ownerBootId: partiallyUnknownOwner.bootId,
      ownerStartIdentity: partiallyUnknownOwner.startIdentity,
    }),
    false,
  );
});

summary();
