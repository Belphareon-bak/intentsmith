import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { M2_PRIVATE_HTTP_PROFILE, computeM2PrivateHttpNetworkPolicyDigest,
  validateM2PrivateHttpNetworkPolicy } from '../../contracts/m2/execution-v2.js';

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

// Node/libuv's UV_CREATE_PIPE is an AF_UNIX socketpair. Keep those channels
// outside the sandbox: this fixed trusted /usr relay creates real anonymous
// pipes before bubblewrap. It neither interprets project data nor changes argv.
export const PRIVATE_HTTP_STDIO_RELAY_PATH = '/usr/bin/python3';
export const PRIVATE_HTTP_STDIO_RELAY_SOURCE = String.raw`import os, selectors, subprocess, sys
child = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
    stderr=subprocess.PIPE, close_fds=True, pass_fds=(4,5,6,7,8,9), env={})
streams = selectors.DefaultSelector()
streams.register(child.stdout, selectors.EVENT_READ, 1)
streams.register(child.stderr, selectors.EVENT_READ, 2)
while streams.get_map():
    for key, events in streams.select():
        data = os.read(key.fd, 65536)
        if not data:
            streams.unregister(key.fileobj)
            key.fileobj.close()
            continue
        view = memoryview(data)
        while view:
            written = os.write(key.data, view)
            if written <= 0: raise RuntimeError('stdio-relay-short-write')
            view = view[written:]
streams.close()
status = child.wait()
sys.exit(status if status >= 0 else 128 - status)
`;

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

// Explicit new profile. The V1 network-free filter cannot precede privileged
// trusted setup: the pinned static initializer installs its final restrictions.
export function buildLinuxPrivateHttpBwrapArguments(spec) {
  if (process.arch !== 'x64' || spec?.sandboxProfile !== M2_PRIVATE_HTTP_PROFILE) {
    throw new TypeError('process-supervisor:private-http-profile-unavailable');
  }
  const policy = spec.networkPolicy;
  if (!validateM2PrivateHttpNetworkPolicy(policy).valid
    || computeM2PrivateHttpNetworkPolicyDigest(policy) !== spec.networkPolicyDigest) {
    throw new TypeError('process-supervisor:invalid-private-http-policy');
  }
  if (!isCanonicalAbsolute(spec.projectRoot) || spec.projectRoot === '/' || spec.canonicalCwd !== spec.projectRoot
    || spec.binary !== policy.artifacts.runtimeExecutable.canonicalPath
    || spec.argv?.[0] !== policy.artifacts.oracle.canonicalPath || !spec.argv[0].endsWith('.mjs')) {
    throw new TypeError('process-supervisor:private-http-entry-mismatch');
  }
  validateArguments(spec.argv);
  if (spec.argv.length + 1 > 64
    || [spec.binary, ...spec.argv].reduce((sum, arg) => sum + Buffer.byteLength(arg, 'utf8') + 1, 0) > 65536) {
    throw new TypeError('process-supervisor:private-http-argv-limit');
  }
  if (validateEnvironment(spec.environment).length !== 0 || Reflect.ownKeys(spec.environment).length !== 0) {
    throw new TypeError('process-supervisor:private-http-environment-unsupported');
  }
  if (!/^user:\[[1-9][0-9]{0,19}\]$/.test(spec.hostNamespaces?.user)
    || !/^net:\[[1-9][0-9]{0,19}\]$/.test(spec.hostNamespaces?.net)) {
    throw new TypeError('process-supervisor:invalid-host-namespace-observation');
  }
  const keys = ['launcher', 'ip', 'nft', 'runtimeExecutable', 'oracle'];
  const fds = spec.artifactFds;
  const expectedFds = { launcher: 6, ip: 7, nft: 8, runtimeExecutable: 5, oracle: 9 };
  const allFds = [spec.projectFd, ...keys.map(key => fds?.[key])];
  if (!fds || Object.getPrototypeOf(fds) !== Object.prototype
    || Reflect.ownKeys(fds).length !== keys.length || !keys.every(key => Object.hasOwn(fds, key))
    || allFds.some(fd => !Number.isSafeInteger(fd) || fd < 4 || fd > 64)
    || new Set(allFds).size !== allFds.length || spec.projectFd !== 4 || spec.binaryFd !== 5
    || keys.some(key => fds[key] !== expectedFds[key])) {
    throw new TypeError('process-supervisor:invalid-private-http-artifact-fds');
  }
  for (const key of keys) {
    const candidate = policy.artifacts[key].canonicalPath;
    if (!isCanonicalAbsolute(candidate)) throw new TypeError('process-supervisor:private-http-artifact-path-invalid');
    if (candidate === spec.projectRoot || candidate.startsWith(`${spec.projectRoot}/`)) {
      throw new TypeError('process-supervisor:private-http-artifact-in-project');
    }
  }
  if (spec.stdioRelayFd !== 10 || allFds.includes(10)
    || !/^\/usr\/bin\/python3\.[1-9][0-9]?$/.test(spec.stdioRelay?.canonicalPath)) {
    throw new TypeError('process-supervisor:private-http-stdio-relay-unavailable');
  }
  const args = ['--die-with-parent', '--unshare-all', '--unshare-user', '--disable-userns',
    '--uid', '0', '--gid', '0', '--cap-drop', 'ALL', '--cap-add', 'CAP_SETPCAP',
    '--cap-add', 'CAP_NET_ADMIN', '--cap-add', 'CAP_SYS_ADMIN'];
  for (const runtimeRoot of REQUIRED_RUNTIME_ROOTS) args.push('--ro-bind', runtimeRoot, runtimeRoot);
  for (const runtimeRoot of OPTIONAL_RUNTIME_ROOTS) args.push('--ro-bind-try', runtimeRoot, runtimeRoot);
  for (const runtimeFile of OPTIONAL_RUNTIME_FILES) args.push('--ro-bind-try', runtimeFile, runtimeFile);
  args.push('--tmpfs', '/tmp', '--dir', spec.projectRoot, '--ro-bind-fd', String(spec.projectFd), spec.projectRoot);
  for (const key of keys) {
    const candidate = policy.artifacts[key].canonicalPath;
    args.push('--dir', path.posix.dirname(candidate), '--ro-bind-fd', String(fds[key]), candidate);
  }
  args.push('--proc', '/proc', '--dev', '/dev', '--remount-ro', '/', '--chdir', spec.canonicalCwd, '--clearenv',
    policy.artifacts.launcher.canonicalPath, '--profile', M2_PRIVATE_HTTP_PROFILE,
    '--host-user-namespace', spec.hostNamespaces.user, '--host-net-namespace', spec.hostNamespaces.net,
    '--port', String(policy.endpoint.port), '--', spec.binary, ...spec.argv);
  return Object.freeze(args);
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
    const privateHttp = spec?.sandboxProfile === M2_PRIVATE_HTTP_PROFILE;
    try {
      if (!isCanonicalAbsolute(spec?.bwrapPath)) {
        throw new TypeError('process-supervisor:invalid-bwrapPath');
      }
      if (spec?.sandboxProfile !== undefined && ![LINUX_BWRAP_READ_ONLY_PROFILE, M2_PRIVATE_HTTP_PROFILE].includes(spec.sandboxProfile)) {
        throw new TypeError('process-supervisor:invalid-profile');
      }
      bwrapArguments = privateHttp ? buildLinuxPrivateHttpBwrapArguments(spec) : buildLinuxBwrapArguments(spec);
      seccompProgram = privateHttp ? null : buildLinuxFocusedTestSeccompProgram();
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
      command = spawn(privateHttp ? `/proc/self/fd/${spec.stdioRelayFd}` : spec.bwrapPath,
        privateHttp ? ['-I', '-S', '-c', PRIVATE_HTTP_STDIO_RELAY_SOURCE, spec.bwrapPath, ...bwrapArguments] : bwrapArguments, {
        cwd: spec.projectRoot,
        env: {},
        detached: false,
        shell: false,
        // The parent passes the approved project and executable as fd 4/5 to
        // this supervisor. Preserve those exact descriptors into bubblewrap;
        // fd 6 is a private pipe carrying the compiled seccomp program.
        // Write directly to the supervisor's pipe descriptors. Avoiding a JS
        // pipe hop means process exit cannot truncate buffered evidence.
        stdio: privateHttp ? ['ignore', 1, 2, 'ignore', 4, 5, 6, 7, 8, 9, 10]
          : ['ignore', 1, 2, 'ignore', 4, 5, 'pipe'],
      });
      if (!privateHttp) {
        command.stdio[6].on('error', () => {
        // Bubblewrap reports a missing/truncated filter through its own
        // terminal status. Keep this listener solely to prevent an unhandled
        // stream error if it exits before consuming the complete program.
      });
        command.stdio[6].end(seccompProgram);
      }
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
