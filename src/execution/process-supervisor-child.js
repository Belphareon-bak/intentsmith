import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROCESS_SUPERVISOR_PROTOCOL = 'intentsmith-process-supervisor-v1';
export const LINUX_BWRAP_READ_ONLY_PROFILE = 'linux-bwrap-ro-v1';

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const MAX_ENVIRONMENT_VALUE_BYTES = 32_768;
const MAX_ARGUMENT_BYTES = 4_096;
const MAX_ARGUMENT_COUNT = 128;

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

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function validateEnvironment(environment) {
  if (
    environment === null
    || typeof environment !== 'object'
    || Array.isArray(environment)
    || Object.getPrototypeOf(environment) !== Object.prototype
  ) throw new TypeError('process-supervisor:invalid-environment');

  const entries = Object.entries(environment).sort(([left], [right]) => compareUtf8(left, right));
  for (const [key, value] of entries) {
    if (!ENVIRONMENT_KEY_PATTERN.test(key)) {
      throw new TypeError('process-supervisor:invalid-environment-key');
    }
    if (
      typeof value !== 'string'
      || value !== value.normalize('NFC')
      || value.includes('\0')
      || Buffer.byteLength(value, 'utf8') > MAX_ENVIRONMENT_VALUE_BYTES
    ) throw new TypeError('process-supervisor:invalid-environment-value');
  }
  return entries;
}

function validateArguments(argv) {
  if (!Array.isArray(argv) || argv.length > MAX_ARGUMENT_COUNT) {
    throw new TypeError('process-supervisor:invalid-argv');
  }
  for (const argument of argv) {
    if (
      typeof argument !== 'string'
      || argument !== argument.normalize('NFC')
      || argument.includes('\0')
      || Buffer.byteLength(argument, 'utf8') > MAX_ARGUMENT_BYTES
    ) throw new TypeError('process-supervisor:invalid-argv');
  }
}

export function buildLinuxBwrapArguments({
  projectRoot,
  canonicalCwd,
  binary,
  argv,
  environment,
  projectFd = 4,
  binaryFd = 5,
}) {
  for (const [name, value] of Object.entries({ projectRoot, canonicalCwd, binary })) {
    if (!isCanonicalAbsolute(value)) throw new TypeError(`process-supervisor:invalid-${name}`);
  }
  if (canonicalCwd !== projectRoot) throw new TypeError('process-supervisor:cwd-root-mismatch');
  if (!Number.isSafeInteger(projectFd) || projectFd < 3 || projectFd > 64) {
    throw new TypeError('process-supervisor:invalid-project-fd');
  }
  if (!Number.isSafeInteger(binaryFd) || binaryFd < 3 || binaryFd > 64 || binaryFd === projectFd) {
    throw new TypeError('process-supervisor:invalid-binary-fd');
  }
  validateArguments(argv);
  const environmentEntries = validateEnvironment(environment);

  const argumentsList = [
    '--die-with-parent',
    '--unshare-all',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    '/',
    '/',
    // Keep /tmp ephemeral. Re-binding the project afterwards also supports a
    // legitimate project root below /tmp while preserving its read-only mode.
    '--tmpfs',
    '/tmp',
    '--ro-bind-fd',
    String(projectFd),
    projectRoot,
    // Execute the exact inode opened and approved by the parent. This closes
    // the final path-resolution race between validation and bubblewrap exec.
    '--ro-bind-fd',
    String(binaryFd),
    binary,
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--chdir',
    canonicalCwd,
    '--clearenv',
  ];
  for (const [key, value] of environmentEntries) {
    argumentsList.push('--setenv', key, value);
  }
  argumentsList.push(binary, ...argv);
  return Object.freeze(argumentsList);
}

function sendAndExit(message, exitCode) {
  if (typeof process.send !== 'function' || !process.connected) {
    process.exit(exitCode);
    return;
  }
  process.send(message, error => {
    process.exit(error ? 74 : exitCode);
  });
}

function terminalMessage(token, payload) {
  return {
    protocol: PROCESS_SUPERVISOR_PROTOCOL,
    type: 'terminal',
    token,
    ...payload,
  };
}

export function runProcessSupervisorChild() {
  if (typeof process.send !== 'function') {
    process.exitCode = 70;
    return;
  }

  let started = false;
  let command = null;
  const prestartTimer = setTimeout(() => {
    if (!started) process.exit(75);
  }, 30_000);
  prestartTimer.unref();

  process.once('disconnect', () => {
    if (!started) {
      process.exit(0);
      return;
    }
    // The supervisor is the process-group leader. Signalling the group makes
    // parent loss terminate bubblewrap and every descendant, including a
    // command which ignores SIGTERM. SIGKILL escalation remains parent-owned.
    try {
      process.kill(-process.pid, 'SIGTERM');
    } catch {
      try { command?.kill('SIGTERM'); } catch { /* already gone */ }
      process.exit(76);
    }
  });

  process.on('message', message => {
    if (started) return;
    if (
      message?.protocol !== PROCESS_SUPERVISOR_PROTOCOL
      || message?.type !== 'start'
      || typeof message?.token !== 'string'
      || message.token.length < 16
    ) {
      sendAndExit(terminalMessage(null, {
        exitCode: null,
        signal: null,
        errorCode: 'INVALID_START_HANDSHAKE',
      }), 77);
      return;
    }

    started = true;
    clearTimeout(prestartTimer);
    const { token, spec } = message;
    let bwrapArguments;
    try {
      if (!isCanonicalAbsolute(spec?.bwrapPath)) {
        throw new TypeError('process-supervisor:invalid-bwrapPath');
      }
      bwrapArguments = buildLinuxBwrapArguments(spec);
    } catch (error) {
      sendAndExit(terminalMessage(token, {
        exitCode: null,
        signal: null,
        errorCode: 'INVALID_START_SPEC',
        detail: error?.message || String(error),
      }), 78);
      return;
    }

    try {
      command = spawn(spec.bwrapPath, bwrapArguments, {
        cwd: spec.projectRoot,
        env: {},
        detached: false,
        shell: false,
        // The parent passes the approved project and executable as fd 4/5 to
        // this supervisor. Preserve those exact descriptors into bubblewrap.
        // Write directly to the supervisor's pipe descriptors. Avoiding a JS
        // pipe hop means process exit cannot truncate buffered evidence.
        stdio: ['ignore', 1, 2, 'ignore', 4, 5],
      });
    } catch (error) {
      sendAndExit(terminalMessage(token, {
        exitCode: null,
        signal: null,
        errorCode: 'SANDBOX_SPAWN_FAILED',
        detail: error?.message || String(error),
      }), 79);
      return;
    }

    let settled = false;
    command.once('error', error => {
      if (settled) return;
      settled = true;
      sendAndExit(terminalMessage(token, {
        exitCode: null,
        signal: null,
        errorCode: 'SANDBOX_SPAWN_FAILED',
        detail: error?.message || String(error),
      }), 79);
    });
    command.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      sendAndExit(terminalMessage(token, {
        exitCode,
        signal,
        errorCode: null,
      }), 0);
    });
  });

  process.send({
    protocol: PROCESS_SUPERVISOR_PROTOCOL,
    type: 'ready',
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) runProcessSupervisorChild();

export const _testInternals = Object.freeze({
  isCanonicalAbsolute,
  validateArguments,
  validateEnvironment,
});
