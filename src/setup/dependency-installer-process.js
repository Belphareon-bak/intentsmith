import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Inspection precedes extraction. A bounded child avoids buffering attacker
// controlled PAX headers in the server. Links/sparse/special files are refused.
export function archiveInspectionArgs(archive) {
  return ['--as=268435456', '--cpu=60', '--', '/usr/bin/python3', '-I', '-c', String.raw`
import tarfile,sys,json,posixpath
count=total=0
with tarfile.open(sys.argv[1],mode='r|gz') as archive:
 for member in archive:
  count+=1
  name=member.name
  parts=name.split('/')
  if name.startswith('/') or '..' in parts or '\\' in name or '\x00' in name or len(name)>2048: raise ValueError('INSTALL_ARCHIVE_PATH_DENIED')
  if not (member.isfile() or member.isdir()) or member.issparse(): raise ValueError('INSTALL_ARCHIVE_TYPE_DENIED')
  if member.size<0 or (member.isdir() and member.size): raise ValueError('INSTALL_ARCHIVE_SIZE_DENIED')
  total+=member.size
  if count>100000 or total>2000000000: raise ValueError('INSTALL_ARCHIVE_LIMIT')
print(json.dumps({'bytes':total,'files':count}))
`, archive];
}

export async function publishInstallation(source, destination) {
  // Atomic no-replace publication, including an empty directory created by
  // another process after preflight. Never emulate it using check + rename.
  const code = `import ctypes,os,sys\nlib=ctypes.CDLL(None,use_errno=True)\nlib.renameat2.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]\nresult=lib.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)\nif result: raise OSError(ctypes.get_errno(), 'INSTALL_PUBLICATION_FAILED')\n`;
  await promisify(execFile)('/usr/bin/python3', ['-I', '-c', code, source, destination], {
    timeout: 5000, maxBuffer: 4096, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
}

// Install only into an owned staging directory. No network, user home, project
// source, credential files or privileged fallback is visible to the child.
export function installationSandboxArgs(stage, binary, argv) {
  const nodePrefix = path.dirname(path.dirname(process.execPath));
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind-try', '/sbin', '/sbin',
    '--ro-bind', '/lib', '/lib', '--ro-bind-try', '/lib64', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/etc',
    '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache'];
  if (nodePrefix !== '/usr' && !nodePrefix.startsWith('/usr/')) args.push('--ro-bind', nodePrefix, nodePrefix);
  args.push('--bind', stage, '/work', '--chdir', '/work/project', '--clearenv',
    '--setenv', 'PATH', `${path.dirname(process.execPath)}:/usr/bin:/bin`,
    '--setenv', 'HOME', '/work/home', '--setenv', 'LANG', 'C.UTF-8',
    '--setenv', 'npm_config_cache', '/work/cache', '--setenv', 'npm_config_userconfig', '/dev/null',
    '--setenv', 'npm_config_globalconfig', '/work/home/empty-global-npmrc', '--setenv', 'npm_config_ignore_scripts', 'true',
    '--setenv', 'npm_config_audit', 'false', '--setenv', 'npm_config_fund', 'false',
    '--setenv', 'DOTNET_CLI_TELEMETRY_OPTOUT', '1', '--setenv', 'DOTNET_SKIP_FIRST_TIME_EXPERIENCE', '1',
    '--', binary, ...argv);
  return args;
}

export async function runInstallationProcess({ stage, binary, argv, signal, audit, timeoutMs = 180_000 }) {
  signal?.throwIfAborted();
  if (process.platform !== 'linux') throw Error('INSTALL_SANDBOX_PLATFORM_UNAVAILABLE');
  const args = installationSandboxArgs(stage, binary, argv);
  audit('process_started', { binary, argv, network: false, writableRoot: 'isolated installation staging' });
  return new Promise((accept, reject) => {
    const child = spawn('/usr/bin/bwrap', args, { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', outputBytes = 0, stopped = false, killTimer;
    const stop = () => {
      stopped = true;
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
      killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500);
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    const capture = bytes => {
      outputBytes += bytes.length;
      if (output.length < 16384) output += bytes.toString().slice(0, 16384 - output.length);
      if (outputBytes > 2_000_000) stop();
    };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const cleanup = () => { clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort', stop); };
    child.once('error', error => { cleanup();reject(error); });
    child.once('close', (exitCode, terminatedBy) => {
      cleanup();
      const receipt = { exitCode, signal: terminatedBy, cancelled: stopped, output, truncated: outputBytes > Buffer.byteLength(output) };
      try { audit('process_terminated', receipt); } catch (error) { reject(error);return; }
      if (stopped || signal?.aborted || exitCode !== 0) {
        reject(Object.assign(Error(stopped ? 'INSTALL_PROCESS_INTERRUPTED' : 'INSTALL_PROCESS_FAILED'), { receipt }));
      } else accept(receipt);
    });
  });
}

export async function verifyInstalledTree(root, { maxBytes = 2_000_000_000, maxFiles = 100_000 } = {}) {
  let bytes = 0, files = 0;
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++files > maxFiles) throw Error('INSTALL_FILE_LIMIT');
      const target = path.join(directory, entry.name), stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) {
        const actual = await fs.realpath(target), relative = path.relative(root, actual);
        if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw Error('INSTALL_LINK_ESCAPE');
      } else if (stat.isDirectory()) await walk(target);
      else if (stat.isFile()) { bytes += stat.size;if (bytes > maxBytes) throw Error('INSTALL_DISK_LIMIT'); }
      else throw Error('INSTALL_SPECIAL_FILE_DENIED');
    }
  }
  await walk(root);return { bytes, files };
}
