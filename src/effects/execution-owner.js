import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';

const LINUX_BOOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readTextObservation(filePath, fileSystem = fs) {
  try {
    return Object.freeze({
      state: 'read',
      value: fileSystem.readFileSync(filePath, 'utf8').trim(),
    });
  } catch (error) {
    return Object.freeze({
      state: error?.code === 'ENOENT' || error?.code === 'ESRCH'
        ? 'missing'
        : 'unavailable',
      value: null,
    });
  }
}

function linuxProcessStartObservation(pid, fileSystem = fs) {
  const observation = readTextObservation(`/proc/${pid}/stat`, fileSystem);
  if (observation.state !== 'read') return observation;
  const stat = observation.value;
  if (!stat) return Object.freeze({ state: 'unavailable', value: null });
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return Object.freeze({ state: 'unavailable', value: null });
  const fieldsFromState = stat.slice(closeParen + 2).split(/\s+/);
  // /proc/<pid>/stat field 22 is starttime. The first split field is field 3.
  const value = fieldsFromState[19];
  return typeof value === 'string' && /^\d+$/.test(value)
    ? Object.freeze({ state: 'read', value })
    : Object.freeze({ state: 'unavailable', value: null });
}

function linuxProcessStartIdentity(pid, fileSystem = fs) {
  return linuxProcessStartObservation(pid, fileSystem).value;
}

function linuxBootId(fileSystem = fs) {
  const observation = readTextObservation('/proc/sys/kernel/random/boot_id', fileSystem);
  return observation.state === 'read' && LINUX_BOOT_ID_PATTERN.test(observation.value)
    ? observation.value
    : null;
}

function stableOwnerId({ bootId, pid, startIdentity, fallback }) {
  const digest = createHash('sha256')
    .update(JSON.stringify({ bootId, pid, startIdentity, fallback }), 'utf8')
    .digest('hex');
  return `owner:${digest}`;
}

export function createProcessExecutionOwner({
  fileSystem = fs,
  pid = process.pid,
  fallback = randomUUID(),
} = {}) {
  const bootId = linuxBootId(fileSystem) || `unknown:${fallback}`;
  const startIdentity = linuxProcessStartIdentity(pid, fileSystem) || `unknown:${fallback}`;
  return Object.freeze({
    ownerId: stableOwnerId({ bootId, pid, startIdentity, fallback }),
    pid,
    bootId,
    startIdentity,
  });
}

export function createProcessExecutionLiveness({ fileSystem = fs } = {}) {
  return Object.freeze({
    isProvablyDead(claim) {
      if (!claim || !Number.isSafeInteger(claim.ownerPid) || claim.ownerPid <= 0) return false;
      if (
        typeof claim.ownerBootId !== 'string'
        || claim.ownerBootId.length === 0
        || typeof claim.ownerStartIdentity !== 'string'
        || claim.ownerStartIdentity.length === 0
      ) return false;
      const currentBootId = linuxBootId(fileSystem);
      // Unknown platform/boot identity is fail-closed: absence is not proof.
      if (
        !currentBootId
        || claim.ownerBootId.startsWith('unknown:')
        || claim.ownerStartIdentity.startsWith('unknown:')
      ) return false;
      if (claim.ownerBootId !== currentBootId) return true;
      const currentStart = linuxProcessStartObservation(claim.ownerPid, fileSystem);
      // Only the kernel's explicit absence signal is proof of death. Permission,
      // I/O and parse failures are unknown and therefore fail closed.
      if (currentStart.state === 'missing') return true;
      if (currentStart.state !== 'read') return false;
      return currentStart.value !== claim.ownerStartIdentity;
    },
  });
}

export const processExecutionOwner = createProcessExecutionOwner();
export const processExecutionLiveness = createProcessExecutionLiveness();

export const _testInternals = Object.freeze({
  linuxBootId,
  linuxProcessStartIdentity,
  linuxProcessStartObservation,
  readTextObservation,
  stableOwnerId,
});

export default processExecutionOwner;
