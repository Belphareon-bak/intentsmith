// Cross-process guard for GPU evaluation CLIs.
//
// Ollama can accept a new model between another process' drain and placement
// check. A process-local mutex cannot prevent that race, so hunts and CODE
// calibration share one small ownership directory in /tmp. A dead PID is a
// recoverable stale lease; a live PID is a fail-fast conflict.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DEFAULT_GPU_EVALUATION_LOCK = path.join(tmpdir(), 'intentsmith-gpu-evaluation.lock');
export const DEFAULT_MIN_AVAILABLE_MEMORY_BYTES = 8 * 2 ** 30;
export const DEFAULT_MIN_AVAILABLE_DISK_BYTES = 40 * 2 ** 30;

/**
 * Scheduled runs must never evict a model used by an interactive session or
 * compete with unrelated GPU work. Unknown host-memory state also fails
 * closed; a manual operator can still run the normal CLI after inspecting it.
 */
export function assessScheduledEvaluationReadiness(snapshot = {}, opts = {}) {
  const minimumMemoryBytes = opts.minimumMemoryBytes ?? DEFAULT_MIN_AVAILABLE_MEMORY_BYTES;
  const minimumDiskBytes = opts.minimumDiskBytes ?? DEFAULT_MIN_AVAILABLE_DISK_BYTES;
  const residentModels = (snapshot.residentModels || []).filter(Boolean);
  const computeProcesses = (snapshot.computeProcesses || []).filter(Boolean);
  const memoryAvailableBytes = Number(snapshot.memoryAvailableBytes);
  const diskAvailableBytes = Number(snapshot.diskAvailableBytes);
  const reasons = [];
  if (residentModels.length) reasons.push(`Ollama používá: ${residentModels.join(', ')}`);
  if (computeProcesses.length) reasons.push(`GPU používá: ${computeProcesses.join(', ')}`);
  if (!Number.isFinite(memoryAvailableBytes)) reasons.push('MemAvailable nelze zjistit');
  else if (memoryAvailableBytes < minimumMemoryBytes) {
    reasons.push(`volná RAM ${(memoryAvailableBytes / 2 ** 30).toFixed(1)} GiB < ${(minimumMemoryBytes / 2 ** 30).toFixed(1)} GiB`);
  }
  if (!Number.isFinite(diskAvailableBytes)) reasons.push('volné místo pro modely nelze zjistit');
  else if (diskAvailableBytes < minimumDiskBytes) {
    reasons.push(`volný disk ${(diskAvailableBytes / 2 ** 30).toFixed(1)} GiB < ${(minimumDiskBytes / 2 ** 30).toFixed(1)} GiB`);
  }
  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze(reasons),
    minimumMemoryBytes, minimumDiskBytes,
  });
}

function ownerAt(lockPath) {
  try { return JSON.parse(readFileSync(path.join(lockPath, 'owner.json'), 'utf8')); }
  catch { return null; }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function acquireGpuEvaluationLock(opts = {}) {
  const lockPath = path.resolve(opts.lockPath || DEFAULT_GPU_EVALUATION_LOCK);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = ownerAt(lockPath);
      if (processAlive(owner?.pid)) {
        throw new Error(`GPU evaluation is already active (pid ${owner.pid}, ${owner.command || 'unknown command'})`);
      }
      // Exact known lock path only; never expand this cleanup to a parent.
      rmSync(lockPath, { recursive: true, force: true });
      continue;
    }

    const owner = {
      token: randomUUID(),
      pid: process.pid,
      command: opts.command || process.argv.join(' '),
      startedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
    let released = false;
    return Object.freeze({
      lockPath,
      owner: Object.freeze({ ...owner }),
      release() {
        if (released) return false;
        released = true;
        // Do not remove a lease that was replaced after this process lost it.
        if (ownerAt(lockPath)?.token !== owner.token) return false;
        rmSync(lockPath, { recursive: true, force: true });
        return true;
      },
    });
  }
  throw new Error(`Unable to acquire GPU evaluation lock at ${lockPath}`);
}

export function holdGpuEvaluationLock(opts = {}) {
  const lease = acquireGpuEvaluationLock(opts);
  process.once('exit', () => lease.release());
  return lease;
}

export default {
  acquireGpuEvaluationLock, holdGpuEvaluationLock,
  assessScheduledEvaluationReadiness,
  DEFAULT_MIN_AVAILABLE_MEMORY_BYTES, DEFAULT_MIN_AVAILABLE_DISK_BYTES,
};
