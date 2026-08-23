import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';

function readText(filePath, fileSystem = fs) {
  try {
    return fileSystem.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function linuxProcessStartIdentity(pid, fileSystem = fs) {
  const stat = readText(`/proc/${pid}/stat`, fileSystem);
  if (!stat) return null;
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;
  const fieldsFromState = stat.slice(closeParen + 2).split(/\s+/);
  // /proc/<pid>/stat field 22 is starttime. The first split field is field 3.
  return fieldsFromState[19] || null;
}

function linuxBootId(fileSystem = fs) {
  return readText('/proc/sys/kernel/random/boot_id', fileSystem);
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
      if (!currentBootId || claim.ownerBootId.startsWith('unknown:')) return false;
      if (claim.ownerBootId !== currentBootId) return true;
      const currentStart = linuxProcessStartIdentity(claim.ownerPid, fileSystem);
      if (currentStart === null) return true;
      return currentStart !== claim.ownerStartIdentity;
    },
  });
}

export const processExecutionOwner = createProcessExecutionOwner();
export const processExecutionLiveness = createProcessExecutionLiveness();

export const _testInternals = Object.freeze({
  linuxBootId,
  linuxProcessStartIdentity,
  stableOwnerId,
});

export default processExecutionOwner;
