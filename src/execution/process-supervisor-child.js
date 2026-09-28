import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROCESS_SUPERVISOR_PROTOCOL = 'intentsmith-process-supervisor-v1';
export const LINUX_BWRAP_READ_ONLY_PROFILE = 'linux-bwrap-ro-v2';

const REQUIRED_RUNTIME_ROOTS = Object.freeze(['/usr']);
const OPTIONAL_RUNTIME_ROOTS = Object.freeze([
  '/bin',
  '/lib',
  '/lib64',
  '/sbin',
  '/nix/store',
  '/gnu/store',
]);
const OPTIONAL_RUNTIME_FILES = Object.freeze([
  '/etc/ld.so.cache',
  '/etc/localtime',
]);

const SECCOMP_DATA_NR_OFFSET = 0;
const SECCOMP_DATA_ARCH_OFFSET = 4;
const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_JMP_JGE_K = 0x35;
const BPF_RET_K = 0x06;
const SECCOMP_RET_KILL_PROCESS = 0x80000000;
const SECCOMP_RET_ERRNO_EACCES = 0x0005000d;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const X32_SYSCALL_BIT = 0x40000000;
const LINUX_SECCOMP_ARCHITECTURES = Object.freeze({
  x64: Object.freeze({
    auditArchitecture: 0xc000003e,
    rejectX32Abi: true,
    // Filesystem-path Unix sockets cross mount namespaces. keyctl is not
    // namespaced, and io_uring can issue operations without their ordinary
    // syscall being observed by seccomp. None is required by an argv-only,
    // network-free focused test.
    blockedSyscalls: Object.freeze([41, 42, 248, 249, 250, 425]),
  }),
  arm64: Object.freeze({
    auditArchitecture: 0xc00000b7,
    rejectX32Abi: false,
    blockedSyscalls: Object.freeze([198, 203, 217, 218, 219, 425]),
  }),
});

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

function encodeClassicBpf(instructions) {
  const program = Buffer.alloc(instructions.length * 8);
  for (const [index, instruction] of instructions.entries()) {
    const [code, jumpTrue, jumpFalse, value] = instruction;
    program.writeUInt16LE(code, index * 8);
    program.writeUInt8(jumpTrue, index * 8 + 2);
    program.writeUInt8(jumpFalse, index * 8 + 3);
    program.writeUInt32LE(value >>> 0, index * 8 + 4);
  }
  return program;
}

export function buildLinuxFocusedTestSeccompProgram(architecture = process.arch) {
  const profile = LINUX_SECCOMP_ARCHITECTURES[architecture];
  if (!profile) throw new TypeError('process-supervisor:unsupported-seccomp-architecture');

  const instructions = [
    [BPF_LD_W_ABS, 0, 0, SECCOMP_DATA_ARCH_OFFSET],
    [BPF_JMP_JEQ_K, 1, 0, profile.auditArchitecture],
    [BPF_RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS],
    [BPF_LD_W_ABS, 0, 0, SECCOMP_DATA_NR_OFFSET],
  ];
  if (profile.rejectX32Abi) {
    instructions.push(
      [BPF_JMP_JGE_K, 0, 1, X32_SYSCALL_BIT],
      [BPF_RET_K, 0, 0, SECCOMP_RET_KILL_PROCESS],
    );
  }
  for (const syscallNumber of profile.blockedSyscalls) {
    instructions.push(
      [BPF_JMP_JEQ_K, 0, 1, syscallNumber],
      [BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO_EACCES],
    );
  }
  instructions.push([BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW]);
  return encodeClassicBpf(instructions);
}

export function buildLinuxBwrapArguments({
  projectRoot,
  canonicalCwd,
  binary,
  argv,
  environment,
  projectFd = 4,
  binaryFd = 5,
  seccompFd = 6,
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
  if (
    !Number.isSafeInteger(seccompFd)
    || seccompFd < 3
    || seccompFd > 64
    || seccompFd === projectFd
    || seccompFd === binaryFd
  ) throw new TypeError('process-supervisor:invalid-seccomp-fd');
  validateArguments(argv);
  const environmentEntries = validateEnvironment(environment);

  const argumentsList = [
    '--die-with-parent',
    '--unshare-all',
    // --unshare-all implies a user namespace at execution time, while
    // bubblewrap requires the explicit option when --disable-userns is used.
    '--unshare-user',
    '--disable-userns',
    '--cap-drop',
    'ALL',
  ];
  // Bubblewrap starts from an empty mount namespace. Binding the complete host
  // root read-only is not containment: pathname Unix sockets remain effectful
  // and every caller-readable host file remains observable. Expose only the
  // system runtime, the exact project inode and the exact executable inode.
  for (const runtimeRoot of REQUIRED_RUNTIME_ROOTS) {
    argumentsList.push('--ro-bind', runtimeRoot, runtimeRoot);
  }
  for (const runtimeRoot of OPTIONAL_RUNTIME_ROOTS) {
    argumentsList.push('--ro-bind-try', runtimeRoot, runtimeRoot);
  }
  for (const runtimeFile of OPTIONAL_RUNTIME_FILES) {
    argumentsList.push('--ro-bind-try', runtimeFile, runtimeFile);
  }
  argumentsList.push(
    '--tmpfs',
    '/tmp',
    // --dir creates missing parents in the otherwise empty namespace. The
    // following FD binds replace only these exact targets, including projects
    // or executables legitimately located below /tmp.
    '--dir',
    projectRoot,
    '--dir',
    path.posix.dirname(binary),
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
    // The path scaffolding created by --dir lives on bubblewrap's otherwise
    // private root tmpfs. Remount that root read-only so an absolute path
    // outside the explicit mounts is neither host-visible nor writable even
    // as disposable sandbox-local state. Child mounts keep their own modes.
    '--remount-ro',
    '/',
    '--seccomp',
    String(seccompFd),
    '--chdir',
    canonicalCwd,
    '--clearenv',
  );
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
    let seccompProgram;
    try {
      if (!isCanonicalAbsolute(spec?.bwrapPath)) {
        throw new TypeError('process-supervisor:invalid-bwrapPath');
      }
      bwrapArguments = buildLinuxBwrapArguments(spec);
      seccompProgram = buildLinuxFocusedTestSeccompProgram();
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
        // this supervisor. Preserve those exact descriptors into bubblewrap;
        // fd 6 is a private pipe carrying the compiled seccomp program.
        // Write directly to the supervisor's pipe descriptors. Avoiding a JS
        // pipe hop means process exit cannot truncate buffered evidence.
        stdio: ['ignore', 1, 2, 'ignore', 4, 5, 'pipe'],
      });
      command.stdio[6].on('error', () => {
        // Bubblewrap reports a missing/truncated filter through its own
        // terminal status. Keep this listener solely to prevent an unhandled
        // stream error if it exits before consuming the complete program.
      });
      command.stdio[6].end(seccompProgram);
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
