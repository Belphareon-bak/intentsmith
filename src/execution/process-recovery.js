import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const PYTHON_PATH = '/usr/bin/python3';
const PIDFD_HELPER_PATH = fileURLToPath(
  new URL('../../scripts/process-recovery-pidfd.py', import.meta.url),
);
const PIDFD_HELPER_CONTRACT = 'IntentSmithProcessRecoveryPidfdV1';
const PIDFD_AUTHORITY = 'linux-pidfd-v1';
const execFileAsync = promisify(execFile);
const OUTCOME_KEYS = Object.freeze([
  'authority',
  'groupState',
  'identityMatched',
  'killSent',
  'reason',
  'status',
  'termSent',
]);

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

function unresolved(reason) {
  return Object.freeze({
    authority: PIDFD_AUTHORITY,
    status: 'unresolved',
    reason,
    identityMatched: false,
    termSent: false,
    killSent: false,
    groupState: 'unknown',
  });
}

function validatePidfdOutcome(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(OUTCOME_KEYS)) return null;
  if (value.authority !== PIDFD_AUTHORITY) return null;
  if (!['terminated', 'already_terminated', 'unresolved'].includes(value.status)) return null;
  if (typeof value.reason !== 'string' || !/^[a-z0-9_]{1,96}$/.test(value.reason)) return null;
  if (typeof value.identityMatched !== 'boolean'
    || typeof value.termSent !== 'boolean'
    || typeof value.killSent !== 'boolean') return null;
  if (!['alive', 'empty', 'unknown', 'not_observed'].includes(value.groupState)) return null;
  if (value.status === 'terminated' && (
    value.identityMatched !== true
    || value.groupState !== 'empty'
    || (!value.termSent && !value.killSent)
  )) return null;
  if (value.status === 'already_terminated' && (value.termSent || value.killSent)) return null;
  return Object.freeze({ ...value });
}

async function runPidfdRecovery(record, { termGraceMs, killGraceMs } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(PYTHON_PATH, [
      PIDFD_HELPER_PATH,
      String(record.supervisorPid),
      String(record.processGroupId),
      record.ownerBootId,
      record.ownerStartIdentity,
      String(termGraceMs),
      String(killGraceMs),
      PIDFD_HELPER_CONTRACT,
    ], {
      encoding: 'utf8',
      timeout: termGraceMs + killGraceMs + 5_000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
      env: {},
    });
    if (stderr !== '') return unresolved('pidfd_helper_stderr');
    const lines = stdout.trim().split('\n');
    if (lines.length !== 1) return unresolved('pidfd_helper_output_invalid');
    const parsed = validatePidfdOutcome(JSON.parse(lines[0]));
    return parsed || unresolved('pidfd_helper_output_invalid');
  } catch {
    return unresolved('pidfd_helper_unavailable');
  }
}

/**
 * Reconcile one durable supervisor through a helper that keeps a Linux pidfd
 * open from identity verification through group signalling and final census.
 * No production path signals a numeric PID or PGID after a detached /proc
 * check.
 */
export async function reconcileOwnedProcess(recordValue, {
  termGraceMs = 500,
  killGraceMs = 3_000,
  pidfdReaper = runPidfdRecovery,
} = {}) {
  const record = requireProcessRecord(recordValue);
  for (const [name, value] of Object.entries({ termGraceMs, killGraceMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
      throw new TypeError(`process-recovery:invalid-${name}`);
    }
  }
  if (typeof pidfdReaper !== 'function') {
    throw new TypeError('process-recovery:invalid-pidfd-reaper');
  }
  let candidate;
  try {
    candidate = await pidfdReaper(record, { termGraceMs, killGraceMs });
  } catch {
    return unresolved('pidfd_helper_unavailable');
  }
  return validatePidfdOutcome(candidate) || unresolved('pidfd_helper_output_invalid');
}

export const _testInternals = Object.freeze({
  PIDFD_HELPER_PATH,
  runPidfdRecovery,
  validatePidfdOutcome,
});

export default reconcileOwnedProcess;
