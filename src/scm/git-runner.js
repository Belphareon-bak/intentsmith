import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const exec = promisify(execFile);
const baseEnv = () => ({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
  HOME: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', GIT_SSH_COMMAND: '/usr/bin/ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o ProxyCommand=none -o ProxyJump=none -o ConnectTimeout=10',
  ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) });
const options = (root, timeout) => ({ cwd: root, env: baseEnv(), timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', windowsHide: true });

export function scmError(code, message = code) { return Object.assign(new Error(message), { code }); }
export async function projectRoot(db, projectId) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw scmError('SCM_PROJECT_REQUIRED');
  const project = db.prepare('SELECT path,status FROM projects WHERE id=?').get(projectId);
  if (!project?.path || project.status !== 'active') throw scmError('SCM_PROJECT_NOT_FOUND');
  const root = await fs.realpath(project.path);
  if (!(await fs.stat(root)).isDirectory() || root === path.parse(root).root || root === os.homedir()) throw scmError('SCM_ROOT_DENIED');
  return root;
}
export async function git(root, args, { timeout = 10000, allowFailure = false } = {}) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw scmError('SCM_INPUT_INVALID');
  try {
    const result = await exec('/usr/bin/git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'commit.gpgSign=false', '-c', 'credential.helper=',
      '-c', 'protocol.allow=never', '-c', 'protocol.ssh.allow=always', '-c', 'protocol.https.allow=always',
      ...args,
    ], options(root, timeout));
    return result.stdout;
  } catch (error) {
    if (allowFailure) return null;
    if (error.killed || error.signal) throw scmError('SCM_GIT_TIMEOUT');
    throw scmError('SCM_GIT_FAILED', 'Git operation failed');
  }
}
export async function isRepo(root) {
  const top = await git(root, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (top === null) return false;
  if (path.resolve(top.trim()) !== root) throw scmError('SCM_REPO_ROOT_MISMATCH');
  return true;
}
export function relativeFile(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096 || value.startsWith('-')
      || value.startsWith('/') || value.includes('\\') || /[\x00-\x1f]/.test(value)
      || value.split('/').some(part => !part || part === '.' || part === '..' || part === '.git')) throw scmError('SCM_PATH_INVALID');
  return value;
}
export function branchName(value) {
  if (typeof value !== 'string' || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value)
      || value.endsWith('.') || value.endsWith('/') || value.includes('..') || value.includes('//')
      || value.includes('@{') || value.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) throw scmError('SCM_BRANCH_INVALID');
  return value;
}
export function remoteHost(url) {
  if (typeof url !== 'string' || url.length > 1024 || /[\x00-\x20]/.test(url)) throw scmError('SCM_REMOTE_DENIED');
  if (/^[^@:/]+@[^:/]+:[A-Za-z0-9._/-]+$/.test(url) && !url.includes('..')) return url.split('@')[1].split(':')[0].toLowerCase();
  let parsed;
  try { parsed = new URL(url); } catch { throw scmError('SCM_REMOTE_DENIED'); }
  if (!['ssh:', 'https:'].includes(parsed.protocol) || parsed.password || parsed.hash || parsed.search
      || !/^\/[A-Za-z0-9._/-]+$/.test(parsed.pathname) || parsed.pathname.includes('..')
      || (parsed.protocol === 'https:' && parsed.username)) throw scmError('SCM_REMOTE_DENIED');
  return parsed.hostname.toLowerCase();
}
export async function remoteInfo(root, branch) {
  const remote = (await git(root, ['config', '--local', '--get', `branch.${branch}.remote`], { allowFailure: true }))?.trim() || '';
  const merge = (await git(root, ['config', '--local', '--get', `branch.${branch}.merge`], { allowFailure: true }))?.trim() || '';
  if (!remote || !merge.startsWith('refs/heads/')) return null;
  const trackingBranch = branchName(merge.slice('refs/heads/'.length));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(remote)) throw scmError('SCM_REMOTE_DENIED');
  const url = (await git(root, ['config', '--local', '--get', `remote.${remote}.url`], { allowFailure: true }))?.trim() || '';
  const host = remoteHost(url);
  // URL rewrite can bypass a hostname comparison even when the displayed URL is safe.
  if (await git(root, ['config', '--local', '--get-regexp', '^url\\..*\\.(insteadof|pushinsteadof)$'], { allowFailure: true })) throw scmError('SCM_REMOTE_REWRITE_DENIED');
  return { name: remote, branch: trackingBranch, url, host };
}
export async function snapshot(root) {
  if (!await isRepo(root)) return { repo: false, head: '', branch: '', status: '' };
  const [head, branch, status] = await Promise.all([
    git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }),
    git(root, ['branch', '--show-current']),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ]);
  return { repo: true, head: head?.trim() || '', branch: branch.trim(), status };
}
