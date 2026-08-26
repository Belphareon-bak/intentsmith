import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, open, readFile, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { computeM2ExecutionValueDigest } from '../../contracts/m2/execution-v1.js';
import {
  LINUX_BWRAP_READ_ONLY_PROFILE,
  PROCESS_SUPERVISOR_PROTOCOL,
} from './process-supervisor-child.js';

const DEFAULT_BWRAP_PATH = '/usr/bin/bwrap';
const DEFAULT_PRLIMIT_PATH = '/usr/bin/prlimit';
const DEFAULT_OUTPUT_LIMIT_BYTES = 64 * 1024;
const MAX_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3_000;
const DEFAULT_RECORD_TIMEOUT_MS = 5_000;
const DEFAULT_TERM_GRACE_MS = 500;
const DEFAULT_KILL_GRACE_MS = 3_000;
const POLL_INTERVAL_MS = 20;
const BOOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const SUPERVISOR_PATH = fileURLToPath(new URL('./process-supervisor-child.js', import.meta.url));
const execFileAsync = promisify(execFile);

export const PROCESS_RESOURCE_LIMITS = Object.freeze({
  addressSpaceBytes: 4 * 1024 * 1024 * 1024,
  fileSizeBytes: 64 * 1024 * 1024,
  openFiles: 256,
  coreBytes: 0,
});

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isCanonicalAbsolute(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.normalize('NFC')
    && !value.includes('\\')
    && !value.includes('\0')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && (value === '/' || !value.endsWith('/'));
}

function safeError(error) {
  if (!error) return null;
  const code = typeof error.code === 'string' ? error.code : 'ERROR';
  const message = typeof error.message === 'string' ? error.message : String(error);
  return `${code}:${message}`.slice(0, 1024);
}

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(code);
          error.code = code;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function observeProcessGroup(pgid) {
  if (!Number.isSafeInteger(pgid) || pgid <= 0) return 'unknown';
  try {
    process.kill(-pgid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'ESRCH') return 'empty';
    return 'unknown';
  }
}

function signalProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return null;
  }
}

async function waitForEmptyProcessGroup(pgid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let observation = observeProcessGroup(pgid);
  while (observation === 'alive' && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    observation = observeProcessGroup(pgid);
  }
  return observation;
}

async function waitForChildClose(closePromise, timeoutMs) {
  const marker = Symbol('child-close-timeout');
  const value = await Promise.race([
    closePromise,
    delay(timeoutMs).then(() => marker),
  ]);
  return value === marker ? null : value;
}

async function terminateProcessGroup({ pgid, closePromise, termGraceMs, killGraceMs }) {
  const cleanup = {
    termSent: false,
    killSent: false,
    groupState: observeProcessGroup(pgid),
    childClosed: false,
  };

  if (cleanup.groupState !== 'empty') {
    cleanup.termSent = signalProcessGroup(pgid, 'SIGTERM') === true;
    cleanup.groupState = await waitForEmptyProcessGroup(pgid, termGraceMs);
  }
  if (cleanup.groupState !== 'empty') {
    cleanup.killSent = signalProcessGroup(pgid, 'SIGKILL') === true;
    cleanup.groupState = await waitForEmptyProcessGroup(pgid, killGraceMs);
  }
  cleanup.childClosed = (await waitForChildClose(closePromise, killGraceMs)) !== null;
  cleanup.groupState = observeProcessGroup(pgid);
  return Object.freeze(cleanup);
}

function createOutputCollector(stream, limitBytes) {
  const hash = createHash('sha256');
  const retained = [];
  let retainedBytes = 0;
  let totalBytes = 0;
  stream.on('data', chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    totalBytes += bytes.length;
    const remaining = limitBytes - retainedBytes;
    if (remaining > 0) {
      const slice = bytes.subarray(0, remaining);
      retained.push(slice);
      retainedBytes += slice.length;
    }
  });
  return {
    finish() {
      const captured = Buffer.concat(retained, retainedBytes);
      return Object.freeze({
        text: captured.toString('utf8'),
        digest: `sha256:${hash.digest('hex')}`,
        bytes: totalBytes,
        truncated: totalBytes > retainedBytes,
      });
    },
  };
}

function emptyOutputEvidence() {
  return {
    stdout: '',
    stderr: '',
    stdoutDigest: null,
    stderrDigest: null,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    outputTruncated: false,
  };
}

function collectedOutputEvidence(stdoutCollector, stderrCollector) {
  const stdout = stdoutCollector.finish();
  const stderr = stderrCollector.finish();
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutDigest: stdout.digest,
    stderrDigest: stderr.digest,
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    outputTruncated: stdout.truncated || stderr.truncated,
  };
}

function terminalResult({
  state = 'terminal',
  terminalStatus,
  errorCode,
  errorDetail = null,
  exitCode = null,
  signal = null,
  supervisorIdentity = null,
  cleanup = null,
  output = emptyOutputEvidence(),
}) {
  return Object.freeze({
    state,
    terminalStatus,
    errorCode,
    errorDetail,
    exitCode,
    signal,
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
    supervisorIdentity,
    cleanup,
    ...output,
  });
}

async function exactExecutableObservation(candidate) {
  if (!isCanonicalAbsolute(candidate)) return { ok: false, reason: 'invalid-path' };
  try {
    const resolved = await realpath(candidate);
    if (resolved !== candidate) return { ok: false, reason: 'non-canonical-path' };
    const metadata = await stat(candidate);
    if (!metadata.isFile()) return { ok: false, reason: 'not-regular-file' };
    await access(candidate, fsConstants.X_OK);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: safeError(error) };
  }
}

async function exactDirectoryObservation(candidate) {
  if (!isCanonicalAbsolute(candidate)) return { ok: false, reason: 'invalid-path' };
  try {
    const resolved = await realpath(candidate);
    if (resolved !== candidate) return { ok: false, reason: 'non-canonical-path' };
    const metadata = await stat(candidate);
    return metadata.isDirectory()
      ? { ok: true }
      : { ok: false, reason: 'not-directory' };
  } catch (error) {
    return { ok: false, reason: safeError(error) };
  }
}

function validateEnvironment(environment, environmentDigest) {
  if (
    environment === null
    || typeof environment !== 'object'
    || Array.isArray(environment)
    || Object.getPrototypeOf(environment) !== Object.prototype
  ) return false;
  for (const [key, value] of Object.entries(environment)) {
    if (
      !ENVIRONMENT_KEY_PATTERN.test(key)
      || typeof value !== 'string'
      || value !== value.normalize('NFC')
      || value.includes('\0')
      || Buffer.byteLength(value, 'utf8') > 32_768
    ) return false;
  }
  try {
    return computeM2ExecutionValueDigest(environment) === environmentDigest;
  } catch {
    return false;
  }
}

function validateScalarSpec(spec) {
  if (spec?.sandboxProfile !== LINUX_BWRAP_READ_ONLY_PROFILE) return 'PROCESS_SANDBOX_PROFILE_INVALID';
  if (!isCanonicalAbsolute(spec?.projectRoot)) return 'PROCESS_PROJECT_ROOT_INVALID';
  if (!isCanonicalAbsolute(spec?.canonicalCwd) || spec.canonicalCwd !== spec.projectRoot) {
    return 'PROCESS_CWD_INVALID';
  }
  if (!isCanonicalAbsolute(spec?.binary)) return 'PROCESS_BINARY_INVALID';
  if (
    !Array.isArray(spec?.argv)
    || spec.argv.length > 128
    || spec.argv.some(argument => (
      typeof argument !== 'string'
      || argument !== argument.normalize('NFC')
      || argument.includes('\0')
      || Buffer.byteLength(argument, 'utf8') > 4_096
    ))
  ) return 'PROCESS_ARGV_INVALID';
  try {
    if (computeM2ExecutionValueDigest(spec.argv) !== spec.argvDigest) return 'PROCESS_ARGV_DIGEST_MISMATCH';
  } catch {
    return 'PROCESS_ARGV_INVALID';
  }
  if (!validateEnvironment(spec.environment, spec.environmentDigest)) {
    return 'PROCESS_ENVIRONMENT_DIGEST_MISMATCH';
  }
  if (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > 3_600_000) {
    return 'PROCESS_TIMEOUT_INVALID';
  }
  if (spec.expectedExitCode !== 0) return 'PROCESS_EXPECTED_EXIT_INVALID';
  return null;
}

async function readLinuxSupervisorIdentity(pid) {
  const [bootIdText, statText] = await Promise.all([
    readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    readFile(`/proc/${pid}/stat`, 'utf8'),
  ]);
  const bootId = bootIdText.trim();
  if (!BOOT_ID_PATTERN.test(bootId)) throw new Error('PROCESS_BOOT_ID_UNAVAILABLE');
  const closeParen = statText.lastIndexOf(')');
  if (closeParen < 0) throw new Error('PROCESS_START_IDENTITY_UNAVAILABLE');
  const fieldsFromState = statText.slice(closeParen + 2).trim().split(/\s+/);
  const pgid = Number(fieldsFromState[2]); // proc field 5; first split field is field 3.
  const startIdentity = fieldsFromState[19]; // proc field 22.
  if (!Number.isSafeInteger(pgid) || pgid <= 0 || !/^\d+$/.test(startIdentity || '')) {
    throw new Error('PROCESS_START_IDENTITY_UNAVAILABLE');
  }
  if (pgid !== pid) throw new Error('PROCESS_SUPERVISOR_GROUP_MISMATCH');
  return Object.freeze({
    supervisorPid: pid,
    supervisorPgid: pgid,
    supervisorBootId: bootId,
    supervisorStartIdentity: startIdentity,
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
  });
}

async function acknowledgeDurableIdentity(callback, identity, timeoutMs) {
  if (typeof callback !== 'function') throw new Error('PROCESS_SUPERVISOR_RECORDER_REQUIRED');
  const acknowledgement = await withTimeout(
    Promise.resolve().then(() => callback(identity)),
    timeoutMs,
    'PROCESS_SUPERVISOR_RECORD_TIMEOUT',
  );
  if (!(acknowledgement === true || acknowledgement?.durable === true)) {
    throw new Error('PROCESS_SUPERVISOR_RECORD_NOT_DURABLE');
  }
}

async function applyLinuxResourceLimits(pid, timeoutMs, prlimitPath) {
  const cpuSeconds = Math.max(2, Math.ceil(timeoutMs / 1_000) + 1);
  await execFileAsync(prlimitPath, [
    '--pid', String(pid),
    `--as=${PROCESS_RESOURCE_LIMITS.addressSpaceBytes}:${PROCESS_RESOURCE_LIMITS.addressSpaceBytes}`,
    `--cpu=${cpuSeconds}:${cpuSeconds}`,
    `--fsize=${PROCESS_RESOURCE_LIMITS.fileSizeBytes}:${PROCESS_RESOURCE_LIMITS.fileSizeBytes}`,
    `--nofile=${PROCESS_RESOURCE_LIMITS.openFiles}:${PROCESS_RESOURCE_LIMITS.openFiles}`,
    `--core=${PROCESS_RESOURCE_LIMITS.coreBytes}:${PROCESS_RESOURCE_LIMITS.coreBytes}`,
  ], {
    encoding: 'utf8',
    timeout: DEFAULT_RECORD_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 16 * 1024,
  });
  return Object.freeze({ ...PROCESS_RESOURCE_LIMITS, cpuSeconds });
}

function unavailable(errorCode, errorDetail) {
  return terminalResult({
    state: 'unavailable',
    terminalStatus: 'not_started',
    errorCode,
    errorDetail,
  });
}

export function createProcessSandboxProvider({
  bwrapPath = DEFAULT_BWRAP_PATH,
  prlimitPath = DEFAULT_PRLIMIT_PATH,
  nodePath = process.execPath,
  supervisorPath = SUPERVISOR_PATH,
  outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
  handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
  recordTimeoutMs = DEFAULT_RECORD_TIMEOUT_MS,
  termGraceMs = DEFAULT_TERM_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
} = {}) {
  if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 0 || outputLimitBytes > MAX_OUTPUT_LIMIT_BYTES) {
    throw new TypeError('process-sandbox-provider:invalid-output-limit');
  }
  for (const [name, value] of Object.entries({ handshakeTimeoutMs, recordTimeoutMs, termGraceMs, killGraceMs })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
      throw new TypeError(`process-sandbox-provider:invalid-${name}`);
    }
  }

  return Object.freeze({
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,

    async run(spec, { recordSupervisorIdentity, signal: abortSignal } = {}) {
      if (process.platform !== 'linux') {
        return unavailable('PROCESS_SANDBOX_UNAVAILABLE', 'linux-required');
      }
      const scalarError = validateScalarSpec(spec);
      if (scalarError) return unavailable(scalarError, null);
      if (abortSignal?.aborted) {
        return terminalResult({
          terminalStatus: 'cancelled',
          errorCode: 'PROCESS_CANCELLED_BEFORE_START',
        });
      }

      const [bwrapObservation, prlimitObservation, nodeObservation, binaryObservation, rootObservation] = await Promise.all([
        exactExecutableObservation(bwrapPath),
        exactExecutableObservation(prlimitPath),
        exactExecutableObservation(nodePath),
        exactExecutableObservation(spec.binary),
        exactDirectoryObservation(spec.projectRoot),
      ]);
      if (!bwrapObservation.ok) {
        return unavailable('PROCESS_SANDBOX_UNAVAILABLE', bwrapObservation.reason);
      }
      if (!prlimitObservation.ok) {
        return unavailable('PROCESS_RESOURCE_LIMITER_UNAVAILABLE', prlimitObservation.reason);
      }
      if (!nodeObservation.ok) return unavailable('PROCESS_SUPERVISOR_RUNTIME_UNAVAILABLE', nodeObservation.reason);
      if (!binaryObservation.ok) return unavailable('PROCESS_BINARY_UNAVAILABLE', binaryObservation.reason);
      if (!rootObservation.ok) return unavailable('PROCESS_PROJECT_ROOT_UNAVAILABLE', rootObservation.reason);

      let child;
      let projectHandle;
      let binaryHandle;
      try {
        projectHandle = await open(spec.projectRoot, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
        binaryHandle = await open(spec.binary, fsConstants.O_RDONLY);
        const [openedProject, openedBinary, currentProject, currentBinary] = await Promise.all([
          projectHandle.stat(),
          binaryHandle.stat(),
          stat(spec.projectRoot),
          stat(spec.binary),
        ]);
        if (
          !openedProject.isDirectory()
          || !openedBinary.isFile()
          || openedProject.dev !== currentProject.dev
          || openedProject.ino !== currentProject.ino
          || openedBinary.dev !== currentBinary.dev
          || openedBinary.ino !== currentBinary.ino
        ) throw new Error('PROCESS_APPROVED_PATH_CHANGED');
        child = spawn(nodePath, [supervisorPath], {
          cwd: spec.projectRoot,
          env: {},
          detached: true,
          shell: false,
          // fd 4 and 5 are the exact project directory and executable inodes.
          // The child gives them to bubblewrap's --ro-bind-fd operations.
          stdio: ['ignore', 'pipe', 'pipe', 'ipc', projectHandle.fd, binaryHandle.fd],
        });
      } catch (error) {
        return unavailable('PROCESS_SUPERVISOR_SPAWN_FAILED', safeError(error));
      } finally {
        await Promise.allSettled([projectHandle?.close(), binaryHandle?.close()]);
      }
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) {
        try { child.kill('SIGKILL'); } catch { /* no owned pid */ }
        return unavailable('PROCESS_SUPERVISOR_SPAWN_FAILED', 'missing-pid');
      }

      let childSpawnError = null;
      child.once('error', error => { childSpawnError = safeError(error); });
      const closePromise = new Promise(resolve => {
        child.once('close', (code, signal) => resolve({
          code,
          signal,
          error: childSpawnError,
        }));
      });
      let readyResolve;
      let terminalResolve;
      const readyPromise = new Promise(resolve => { readyResolve = resolve; });
      const commandTerminalPromise = new Promise(resolve => { terminalResolve = resolve; });
      const token = randomUUID();
      child.on('message', message => {
        if (message?.protocol !== PROCESS_SUPERVISOR_PROTOCOL) return;
        if (message.type === 'ready') readyResolve(message);
        if (message.type === 'terminal' && message.token === token) terminalResolve(message);
      });

      const stdoutCollector = createOutputCollector(child.stdout, outputLimitBytes);
      const stderrCollector = createOutputCollector(child.stderr, outputLimitBytes);
      let supervisorIdentity = null;
      try {
        await withTimeout(Promise.race([
          readyPromise,
          closePromise.then(() => { throw new Error('PROCESS_SUPERVISOR_CLOSED_BEFORE_READY'); }),
        ]), handshakeTimeoutMs, 'PROCESS_SUPERVISOR_READY_TIMEOUT');
        supervisorIdentity = await readLinuxSupervisorIdentity(child.pid);
        await applyLinuxResourceLimits(child.pid, spec.timeoutMs, prlimitPath);
        await acknowledgeDurableIdentity(recordSupervisorIdentity, supervisorIdentity, recordTimeoutMs);
      } catch (error) {
        const cleanup = await terminateProcessGroup({
          pgid: child.pid,
          closePromise,
          termGraceMs,
          killGraceMs,
        });
        if (cleanup.groupState !== 'empty' || cleanup.childClosed !== true) {
          return terminalResult({
            terminalStatus: 'orphaned',
            errorCode: 'PROCESS_SUPERVISOR_PRESTART_ORPHANED',
            errorDetail: safeError(error),
            supervisorIdentity,
            cleanup,
          });
        }
        return terminalResult({
          terminalStatus: abortSignal?.aborted ? 'cancelled' : 'not_started',
          errorCode: abortSignal?.aborted
            ? 'PROCESS_CANCELLED_BEFORE_START'
            : 'PROCESS_SUPERVISOR_RECORD_FAILED',
          errorDetail: safeError(error),
          supervisorIdentity,
          cleanup,
        });
      }

      if (abortSignal?.aborted) {
        const cleanup = await terminateProcessGroup({
          pgid: child.pid,
          closePromise,
          termGraceMs,
          killGraceMs,
        });
        return terminalResult({
          terminalStatus: cleanup.groupState === 'empty' && cleanup.childClosed ? 'cancelled' : 'orphaned',
          errorCode: cleanup.groupState === 'empty' && cleanup.childClosed
            ? 'PROCESS_CANCELLED_BEFORE_START'
            : 'PROCESS_CANCEL_PRESTART_ORPHANED',
          supervisorIdentity,
          cleanup,
        });
      }

      try {
        await new Promise((resolve, reject) => {
          child.send({
            protocol: PROCESS_SUPERVISOR_PROTOCOL,
            type: 'start',
            token,
            spec: {
              bwrapPath,
              projectRoot: spec.projectRoot,
              canonicalCwd: spec.canonicalCwd,
              binary: spec.binary,
              argv: spec.argv,
              environment: spec.environment,
              projectFd: 4,
              binaryFd: 5,
            },
          }, error => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        const cleanup = await terminateProcessGroup({
          pgid: child.pid,
          closePromise,
          termGraceMs,
          killGraceMs,
        });
        const output = collectedOutputEvidence(stdoutCollector, stderrCollector);
        return terminalResult({
          terminalStatus: cleanup.groupState === 'empty' && cleanup.childClosed ? 'failed' : 'orphaned',
          errorCode: cleanup.groupState === 'empty' && cleanup.childClosed
            ? 'PROCESS_START_HANDSHAKE_FAILED'
            : 'PROCESS_START_HANDSHAKE_ORPHANED',
          errorDetail: safeError(error),
          supervisorIdentity,
          cleanup,
          output,
        });
      }

      let timer;
      let abortListener;
      const timeoutPromise = new Promise(resolve => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), spec.timeoutMs);
      });
      const abortPromise = new Promise(resolve => {
        if (!abortSignal) return;
        abortListener = () => resolve({ kind: 'cancel' });
        abortSignal.addEventListener('abort', abortListener, { once: true });
      });
      const naturalPromise = commandTerminalPromise.then(message => ({ kind: 'terminal', message }));
      const earlyClosePromise = closePromise.then(async close => {
        // IPC delivery normally precedes close. Give the message queue one turn
        // before classifying a close as unknown/orphaned.
        await delay(POLL_INTERVAL_MS);
        return { kind: 'close', close };
      });
      const outcome = await Promise.race([
        naturalPromise,
        earlyClosePromise,
        timeoutPromise,
        abortPromise,
      ]);
      clearTimeout(timer);
      if (abortSignal && abortListener) abortSignal.removeEventListener('abort', abortListener);

      if (outcome.kind === 'timeout' || outcome.kind === 'cancel') {
        const cleanup = await terminateProcessGroup({
          pgid: child.pid,
          closePromise,
          termGraceMs,
          killGraceMs,
        });
        const output = collectedOutputEvidence(stdoutCollector, stderrCollector);
        const clean = cleanup.groupState === 'empty' && cleanup.childClosed === true;
        return terminalResult({
          terminalStatus: clean ? (outcome.kind === 'timeout' ? 'timed_out' : 'cancelled') : 'orphaned',
          errorCode: clean
            ? (outcome.kind === 'timeout' ? 'PROCESS_TIMED_OUT' : 'PROCESS_CANCELLED')
            : 'PROCESS_TERMINATION_ORPHANED',
          supervisorIdentity,
          cleanup,
          output,
        });
      }

      if (outcome.kind === 'close') {
        const cleanup = await terminateProcessGroup({
          pgid: child.pid,
          closePromise,
          termGraceMs,
          killGraceMs,
        });
        return terminalResult({
          terminalStatus: 'orphaned',
          errorCode: 'PROCESS_TERMINAL_UNKNOWN',
          errorDetail: safeError(outcome.close?.error),
          supervisorIdentity,
          cleanup,
          output: collectedOutputEvidence(stdoutCollector, stderrCollector),
        });
      }

      const closed = await waitForChildClose(closePromise, killGraceMs);
      let groupState = observeProcessGroup(child.pid);
      let cleanup = null;
      if (closed === null || groupState !== 'empty') {
        cleanup = await terminateProcessGroup({
          pgid: child.pid,
          closePromise,
          termGraceMs,
          killGraceMs,
        });
        groupState = cleanup.groupState;
      }
      const output = collectedOutputEvidence(stdoutCollector, stderrCollector);
      if (closed === null || groupState !== 'empty') {
        return terminalResult({
          terminalStatus: 'orphaned',
          errorCode: 'PROCESS_GROUP_NOT_EMPTY',
          supervisorIdentity,
          cleanup,
          output,
        });
      }

      const message = outcome.message;
      if (message.errorCode !== null) {
        return terminalResult({
          terminalStatus: 'failed',
          errorCode: message.errorCode,
          errorDetail: typeof message.detail === 'string' ? message.detail.slice(0, 1024) : null,
          exitCode: message.exitCode,
          signal: message.signal,
          supervisorIdentity,
          cleanup,
          output,
        });
      }
      if (message.signal !== null || message.exitCode === null) {
        return terminalResult({
          terminalStatus: 'killed',
          errorCode: 'PROCESS_KILLED',
          exitCode: message.exitCode,
          signal: message.signal,
          supervisorIdentity,
          cleanup,
          output,
        });
      }
      const succeeded = message.exitCode === spec.expectedExitCode;
      return terminalResult({
        terminalStatus: succeeded ? 'succeeded' : 'failed',
        errorCode: succeeded ? null : 'PROCESS_EXIT_NONZERO',
        exitCode: message.exitCode,
        signal: null,
        supervisorIdentity,
        cleanup,
        output,
      });
    },
  });
}

export const processSandboxProvider = createProcessSandboxProvider();

export const _testInternals = Object.freeze({
  applyLinuxResourceLimits,
  collectedOutputEvidence,
  exactDirectoryObservation,
  exactExecutableObservation,
  isCanonicalAbsolute,
  observeProcessGroup,
  readLinuxSupervisorIdentity,
  signalProcessGroup,
  terminateProcessGroup,
  validateEnvironment,
  validateScalarSpec,
});
