import { readFile } from 'node:fs/promises';

const POLL_INTERVAL_MS = 20;
const BOOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function safeError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'ERROR';
  const message = typeof error?.message === 'string' ? error.message : String(error);
  return `${code}:${message}`.slice(0, 512);
}

function requireProcessRecord(value) {
  const valid = value
    && typeof value === 'object'
    && typeof value.executionId === 'string'
    && Number.isSafeInteger(value.generation)
    && value.generation > 0
    && typeof value.effectId === 'string'
    && Number.isSafeInteger(value.supervisorPid)
    && value.supervisorPid > 0
    && Number.isSafeInteger(value.processGroupId)
    && value.processGroupId > 0
    && typeof value.ownerBootId === 'string'
    && typeof value.ownerStartIdentity === 'string'
    && /^\d+$/.test(value.ownerStartIdentity);
  if (!valid) throw new TypeError('process-recovery:invalid-record');
  return value;
}

function parseLinuxProcStat(statText) {
  if (typeof statText !== 'string') throw new TypeError('process-recovery:invalid-proc-stat');
  const closeParen = statText.lastIndexOf(')');
  if (closeParen < 0) throw new TypeError('process-recovery:invalid-proc-stat');
  const fieldsFromState = statText.slice(closeParen + 2).trim().split(/\s+/);
  const processGroupId = Number(fieldsFromState[2]);
  const startIdentity = fieldsFromState[19];
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0
    || !/^\d+$/.test(startIdentity || '')) {
    throw new TypeError('process-recovery:invalid-proc-stat');
  }
  return Object.freeze({ processGroupId, startIdentity });
}

function observeProcessGroup(processGroupId, kill = process.kill) {
  try {
    kill(-processGroupId, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'empty';
    return 'unknown';
  }
}

function signalProcessGroup(processGroupId, signal, kill = process.kill) {
  try {
    kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return null;
  }
}

async function waitForEmptyProcessGroup(processGroupId, timeoutMs, dependencies) {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.delay ?? delay;
  const deadline = now() + timeoutMs;
  let state = observeProcessGroup(processGroupId, dependencies.kill);
  while (state === 'alive' && now() < deadline) {
    await wait(POLL_INTERVAL_MS);
    state = observeProcessGroup(processGroupId, dependencies.kill);
  }
  return state;
}

function outcome(status, reason, values = {}) {
  return Object.freeze({
    status,
    reason,
    identityMatched: false,
    termSent: false,
    killSent: false,
    groupState: 'unknown',
    ...values,
  });
}

/**
 * Reconcile one process previously persisted by the M2 sandbox provider.
 * Never signal from PID/PGID alone: boot ID, /proc start time and the exact
 * leader/group identity must all match first.
 */
export async function reconcileOwnedProcess(recordValue, {
  readFile: read = readFile,
  kill = process.kill,
  now = Date.now,
  delay: wait = delay,
  termGraceMs = 500,
  killGraceMs = 3_000,
} = {}) {
  const record = requireProcessRecord(recordValue);
  for (const [name, value] of Object.entries({ termGraceMs, killGraceMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
      throw new TypeError(`process-recovery:invalid-${name}`);
    }
  }

  let bootId;
  try {
    bootId = (await read('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  } catch (error) {
    return outcome('unresolved', 'boot_id_unavailable', { error: safeError(error) });
  }
  if (!BOOT_ID_PATTERN.test(bootId)) return outcome('unresolved', 'boot_id_invalid');
  if (bootId !== record.ownerBootId) {
    return outcome('already_terminated', 'boot_changed', { groupState: 'not_observed' });
  }

  let observed;
  try {
    observed = parseLinuxProcStat(await read(`/proc/${record.supervisorPid}/stat`, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return outcome('unresolved', 'proc_identity_unavailable', { error: safeError(error) });
    }
    const groupState = observeProcessGroup(record.processGroupId, kill);
    return groupState === 'empty'
      ? outcome('already_terminated', 'process_group_empty', { groupState })
      : outcome('unresolved', 'leader_missing_group_not_empty', { groupState });
  }

  if (observed.startIdentity !== record.ownerStartIdentity) {
    // Linux cannot reuse this PID while the old process group ID still exists.
    // The observed PID is different authority and must not be signalled.
    return outcome('already_terminated', 'pid_identity_replaced', { groupState: 'not_observed' });
  }
  if (record.supervisorPid !== record.processGroupId
    || observed.processGroupId !== record.processGroupId) {
    return outcome('unresolved', 'process_group_identity_mismatch', {
      identityMatched: true,
      groupState: 'not_observed',
    });
  }

  const dependencies = { kill, now, delay: wait };
  let groupState = observeProcessGroup(record.processGroupId, kill);
  if (groupState === 'empty') {
    return outcome('already_terminated', 'process_group_empty', {
      identityMatched: true,
      groupState,
    });
  }
  if (groupState !== 'alive') {
    return outcome('unresolved', 'process_group_unobservable', {
      identityMatched: true,
      groupState,
    });
  }

  const termSent = signalProcessGroup(record.processGroupId, 'SIGTERM', kill) === true;
  groupState = await waitForEmptyProcessGroup(record.processGroupId, termGraceMs, dependencies);
  let killSent = false;
  if (groupState !== 'empty') {
    killSent = signalProcessGroup(record.processGroupId, 'SIGKILL', kill) === true;
    groupState = await waitForEmptyProcessGroup(record.processGroupId, killGraceMs, dependencies);
  }
  return groupState === 'empty'
    ? outcome('terminated', 'owned_group_reaped', {
      identityMatched: true,
      termSent,
      killSent,
      groupState,
    })
    : outcome('unresolved', 'owned_group_not_reaped', {
      identityMatched: true,
      termSent,
      killSent,
      groupState,
    });
}

export const _testInternals = Object.freeze({
  observeProcessGroup,
  parseLinuxProcStat,
  signalProcessGroup,
  waitForEmptyProcessGroup,
});

export default reconcileOwnedProcess;
