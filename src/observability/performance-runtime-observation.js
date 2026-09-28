import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  M5_GPU_CENSUS_CONTRACT,
  M5_GPU_CENSUS_VERSION,
} from '../../contracts/m5/performance-v3.js';

const NVIDIA_SMI_PATH = '/usr/bin/nvidia-smi';

function observationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function readLinuxProcessRssMiB(pid, opts = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw observationError('PERFORMANCE_RSS_MEASUREMENT_INVALID_PID', 'RSS PID must be positive');
  }
  const read = opts.readFileSync || readFileSync;
  let status;
  try {
    status = read(path.join(opts.procRoot || '/proc', String(pid), 'status'), 'utf8');
  } catch {
    throw observationError(
      'PERFORMANCE_RSS_MEASUREMENT_UNREADABLE',
      'Process RSS source could not be read',
    );
  }
  const match = String(status).match(/^VmRSS:\s+(\d+)\s+kB$/m);
  if (!match) {
    throw observationError(
      'PERFORMANCE_RSS_MEASUREMENT_UNREADABLE',
      'Process RSS source did not contain VmRSS',
    );
  }
  const rssMiB = Number((Number(match[1]) / 1024).toFixed(3));
  if (!Number.isFinite(rssMiB) || rssMiB <= 0) {
    throw observationError(
      'PERFORMANCE_RSS_MEASUREMENT_UNREADABLE',
      'Process RSS observation was not positive',
    );
  }
  return rssMiB;
}

function unavailableCensus(observedAtIso, toolExitCode, errorCode) {
  return Object.freeze({
    contract: M5_GPU_CENSUS_CONTRACT,
    version: M5_GPU_CENSUS_VERSION,
    state: 'unavailable',
    observedAtIso,
    tool: 'nvidia-smi',
    toolExitCode,
    computeProcessCount: null,
    processIdentitySha256: null,
    errorCode,
  });
}

export function observeGpuPerformanceCensus(opts = {}) {
  const observedAtIso = (opts.now || new Date()).toISOString();
  const run = opts.runNvidiaSmi || spawnSync;
  const result = run(NVIDIA_SMI_PATH, [
    '--query-compute-apps=pid',
    '--format=csv,noheader,nounits',
  ], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  if (result.error) return unavailableCensus(observedAtIso, null, 'spawn_error');
  if (result.signal) return unavailableCensus(observedAtIso, null, 'signal');
  if (result.status !== 0) {
    return unavailableCensus(
      observedAtIso,
      Number.isSafeInteger(result.status) && result.status >= 0 ? result.status : null,
      'nonzero_exit',
    );
  }
  const rows = String(result.stdout || '')
    .split(/\r?\n/u)
    .map(value => value.trim())
    .filter(Boolean);
  if (rows.some(value => !/^[1-9]\d*$/.test(value))) {
    return unavailableCensus(observedAtIso, 0, 'malformed_output');
  }
  const pids = [...new Set(rows.map(Number))].sort((left, right) => left - right);
  return Object.freeze({
    contract: M5_GPU_CENSUS_CONTRACT,
    version: M5_GPU_CENSUS_VERSION,
    state: 'available',
    observedAtIso,
    tool: 'nvidia-smi',
    toolExitCode: 0,
    computeProcessCount: pids.length,
    processIdentitySha256: createHash('sha256').update(pids.join('\n')).digest('hex'),
    errorCode: null,
  });
}

export function nonMeasuredGpuObservation(census) {
  const state = census?.state !== 'available'
    ? 'not_run_census_unavailable'
    : census.computeProcessCount > 0
      ? 'not_run_foreign_activity'
      : 'not_run_not_requested';
  return Object.freeze({ state, census, measurement: null });
}
