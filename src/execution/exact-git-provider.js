import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const ExactGitErrorCode = Object.freeze({
  INPUT_INVALID: 'EXACT_GIT_INPUT_INVALID',
  UNAVAILABLE: 'EXACT_GIT_UNAVAILABLE',
  ROOT_MISMATCH: 'EXACT_GIT_ROOT_MISMATCH',
  DETACHED_HEAD: 'EXACT_GIT_DETACHED_HEAD',
  UNBORN_HEAD: 'EXACT_GIT_UNBORN_HEAD',
  TARGET_DIRTY: 'EXACT_GIT_TARGET_DIRTY',
  BASELINE_CHANGED: 'EXACT_GIT_BASELINE_CHANGED',
  COMMAND_FAILED: 'EXACT_GIT_COMMAND_FAILED',
  REF_RACE: 'EXACT_GIT_REF_RACE',
  IN_DOUBT: 'EXACT_GIT_IN_DOUBT',
});

export class ExactGitError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ExactGitError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ExactGitError(code, message, details);
}

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sortedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0
    || paths.some(candidate => typeof candidate !== 'string' || candidate.includes('\0'))
    || new Set(paths).size !== paths.length) {
    fail(ExactGitErrorCode.INPUT_INVALID, 'A unique non-empty target path set is required');
  }
  const sorted = [...paths].sort(compareUtf8);
  if (sorted.some((candidate, index) => candidate !== paths[index])) {
    fail(ExactGitErrorCode.INPUT_INVALID, 'Target paths must be bytewise sorted');
  }
  return sorted;
}

function baseEnvironment(extra = {}) {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
    HOME: '/nonexistent',
    XDG_CONFIG_HOME: '/nonexistent',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...extra,
  };
}

function invoke(gitBinary, root, args, {
  input = null,
  environment = {},
  allowExit = [],
  timeoutMs = 30_000,
} = {}) {
  const result = spawnSync(gitBinary, [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgSign=false',
    ...args,
  ], {
    cwd: root,
    env: baseEnvironment(environment),
    input,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    fail(
      result.error.code === 'ENOENT' ? ExactGitErrorCode.UNAVAILABLE : ExactGitErrorCode.COMMAND_FAILED,
      'Exact Git command could not start',
      { args, cause: result.error.message },
    );
  }
  if (result.status !== 0 && !allowExit.includes(result.status)) {
    fail(ExactGitErrorCode.COMMAND_FAILED, 'Exact Git command failed', {
      args,
      exitCode: result.status,
      signal: result.signal,
      stderrDigest: sha(result.stderr ?? Buffer.alloc(0)),
    });
  }
  return result;
}

function outputText(result) {
  return (result.stdout ?? Buffer.alloc(0)).toString('utf8').trim();
}

function statusRecords(statusBytes) {
  if (statusBytes.length === 0) return [];
  return statusBytes.toString('utf8').split('\0').filter(Boolean).map(record => {
    if (record.length < 4 || record[2] !== ' ') {
      fail(ExactGitErrorCode.COMMAND_FAILED, 'Git returned an unknown porcelain record');
    }
    return { x: record[0], y: record[1], path: record.slice(3), raw: record };
  });
}

function status(gitBinary, root) {
  return invoke(gitBinary, root, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames',
  ]).stdout ?? Buffer.alloc(0);
}

function foreignDirt(gitBinary, root, targetPaths) {
  const targets = new Set(targetPaths);
  const records = statusRecords(status(gitBinary, root));
  const targetDirtyPaths = records.filter(record => targets.has(record.path)).map(record => record.path);
  const projection = [];
  for (const record of records.filter(candidate => !targets.has(candidate.path)).sort((a, b) => compareUtf8(a.path, b.path))) {
    const absolute = path.join(root, record.path);
    let worktreeDigest = null;
    try {
      const stat = fs.lstatSync(absolute);
      worktreeDigest = stat.isFile() ? sha(fs.readFileSync(absolute)) : `type:${stat.mode & 0o170000}`;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const index = invoke(gitBinary, root, ['ls-files', '--stage', '-z', '--', record.path]).stdout ?? Buffer.alloc(0);
    projection.push({
      path: record.path,
      x: record.x,
      y: record.y,
      worktreeDigest,
      indexDigest: sha(index),
    });
  }
  const encoded = Buffer.from(JSON.stringify(projection), 'utf8');
  return Object.freeze({
    digest: sha(encoded),
    targetDirtyPaths: Object.freeze(targetDirtyPaths.sort(compareUtf8)),
    records: Object.freeze(projection),
  });
}

function canonicalRoot(projectRoot) {
  try { return fs.realpathSync(projectRoot); } catch (error) {
    fail(ExactGitErrorCode.ROOT_MISMATCH, 'Project root is unavailable', { cause: error.message });
  }
}

export function observeExactGitBaseline(projectRoot, targetPaths, {
  gitBinary = '/usr/bin/git',
  projectId,
} = {}) {
  const paths = sortedPaths(targetPaths);
  const root = canonicalRoot(projectRoot);
  const topLevel = outputText(invoke(gitBinary, root, ['rev-parse', '--show-toplevel']));
  let canonicalTop;
  try { canonicalTop = fs.realpathSync(topLevel); } catch {
    fail(ExactGitErrorCode.ROOT_MISMATCH, 'Git top-level is unavailable');
  }
  if (canonicalTop !== root) {
    fail(ExactGitErrorCode.ROOT_MISMATCH, 'Git top-level is not the canonical project root', {
      root,
      topLevel: canonicalTop,
    });
  }
  const branch = invoke(gitBinary, root, ['symbolic-ref', '-q', 'HEAD'], { allowExit: [1] });
  if (branch.status !== 0) fail(ExactGitErrorCode.DETACHED_HEAD, 'Detached HEAD is unavailable');
  const branchRef = outputText(branch);
  if (!branchRef.startsWith('refs/heads/')) {
    fail(ExactGitErrorCode.DETACHED_HEAD, 'HEAD is not attached to a local branch');
  }
  const headResult = invoke(gitBinary, root, ['rev-parse', '--verify', 'HEAD'], { allowExit: [128] });
  if (headResult.status !== 0) fail(ExactGitErrorCode.UNBORN_HEAD, 'Unborn HEAD is unavailable');
  const head = outputText(headResult);
  const dirt = foreignDirt(gitBinary, root, paths);
  return Object.freeze({
    projectId,
    canonicalRoot: root,
    head,
    branchRef,
    foreignDirtDigest: dirt.digest,
    targetDirtyPaths: dirt.targetDirtyPaths,
  });
}

function requireIdentity(identity) {
  const keys = [
    'authorName', 'authorEmail', 'authorDate',
    'committerName', 'committerEmail', 'committerDate',
  ];
  if (!identity || typeof identity !== 'object'
    || Object.keys(identity).sort().join(',') !== [...keys].sort().join(',')
    || keys.some(key => typeof identity[key] !== 'string' || identity[key].length === 0)) {
    fail(ExactGitErrorCode.INPUT_INVALID, 'Exact author and committer identity is required');
  }
  return identity;
}

function assertForeignBaseline(gitBinary, root, baseline, paths) {
  const currentHead = outputText(invoke(gitBinary, root, ['rev-parse', '--verify', 'HEAD']));
  const currentBranch = outputText(invoke(gitBinary, root, ['symbolic-ref', '-q', 'HEAD']));
  const dirt = foreignDirt(gitBinary, root, paths);
  if (currentHead !== baseline.head
    || currentBranch !== baseline.branchRef
    || dirt.digest !== baseline.foreignDirtDigest) {
    fail(ExactGitErrorCode.BASELINE_CHANGED, 'Git baseline or foreign dirt changed', {
      expectedHead: baseline.head,
      currentHead,
      expectedForeignDirtDigest: baseline.foreignDirtDigest,
      currentForeignDirtDigest: dirt.digest,
    });
  }
  return dirt;
}

function restoreReferenceAndIndex(gitBinary, root, branchRef, originalHead, commitId, paths) {
  const restore = invoke(gitBinary, root, [
    'update-ref', branchRef, originalHead, commitId,
  ], { allowExit: [1, 128] });
  if (restore.status !== 0) return false;
  const restoreIndex = invoke(gitBinary, root, [
    'reset', '--quiet', originalHead, '--', ...paths,
  ], { allowExit: [1, 128] });
  return restoreIndex.status === 0;
}

function requireCommitMaterial(files, message, identityValue) {
  const identity = requireIdentity(identityValue);
  if (typeof message !== 'string' || message.trim().length === 0 || Buffer.byteLength(message) > 4096) {
    fail(ExactGitErrorCode.INPUT_INVALID, 'A bounded non-empty commit message is required');
  }
  if (!Array.isArray(files) || files.length === 0) {
    fail(ExactGitErrorCode.INPUT_INVALID, 'Exact commit files are required');
  }
  const paths = sortedPaths(files.map(file => file.path));
  if (files.some(file => !Buffer.isBuffer(file.bytes)
    || !Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777)) {
    fail(ExactGitErrorCode.INPUT_INVALID, 'Commit file bytes or mode are invalid');
  }
  return Object.freeze({ identity, paths });
}

function buildExactCommitObject({
  gitBinary,
  root,
  baseline,
  files,
  message,
  identity,
  paths,
}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-'));
  const indexPath = path.join(temporary, 'index');
  const indexEnvironment = { GIT_INDEX_FILE: indexPath };
  try {
    invoke(gitBinary, root, ['read-tree', baseline.head], { environment: indexEnvironment });
    const entries = [];
    for (const file of files) {
      const blob = outputText(invoke(gitBinary, root, ['hash-object', '-w', '--stdin'], { input: file.bytes }));
      const mode = (file.mode & 0o111) === 0 ? '100644' : '100755';
      entries.push({ path: file.path, blob, mode });
    }
    const indexInfo = Buffer.from(entries.map(entry => (
      `${entry.mode} ${entry.blob}\t${entry.path}\n`
    )).join(''), 'utf8');
    invoke(gitBinary, root, ['update-index', '--index-info'], {
      input: indexInfo,
      environment: indexEnvironment,
    });
    const tree = outputText(invoke(gitBinary, root, ['write-tree'], { environment: indexEnvironment }));
    const commitId = outputText(invoke(gitBinary, root, ['commit-tree', tree, '-p', baseline.head], {
      input: Buffer.from(`${message}\n`, 'utf8'),
      environment: {
        ...indexEnvironment,
        GIT_AUTHOR_NAME: identity.authorName,
        GIT_AUTHOR_EMAIL: identity.authorEmail,
        GIT_AUTHOR_DATE: identity.authorDate,
        GIT_COMMITTER_NAME: identity.committerName,
        GIT_COMMITTER_EMAIL: identity.committerEmail,
        GIT_COMMITTER_DATE: identity.committerDate,
      },
    }));
    return Object.freeze({ temporary, indexInfo, commitId, paths });
  } catch (error) {
    rmExactTemporary(temporary);
    throw error;
  }
}

function verifyExactWorkingTree(root, files) {
  for (const file of files) {
    const absolute = path.join(root, file.path);
    try {
      const canonical = fs.realpathSync(absolute);
      const stat = fs.lstatSync(absolute);
      const actualBytes = fs.readFileSync(absolute);
      const reasons = [];
      if (canonical !== absolute) reasons.push('canonical-path');
      if (!stat.isFile() || stat.isSymbolicLink()) reasons.push('file-type');
      if (stat.nlink !== 1) reasons.push('link-count');
      if ((stat.mode & 0o777) !== file.mode) reasons.push('mode');
      if (Buffer.compare(actualBytes, file.bytes) !== 0) reasons.push('bytes');
      if (reasons.length > 0) {
        fail(ExactGitErrorCode.IN_DOUBT, `Recovery target differs from its exact after-image: ${reasons.join(',')}`, {
          path: file.path,
          reasons,
        });
      }
    } catch (error) {
      if (error instanceof ExactGitError) throw error;
      fail(ExactGitErrorCode.IN_DOUBT, 'Recovery target is unavailable', {
        path: file.path,
        cause: error.message,
      });
    }
  }
}

export function commitExactProjectChange({
  projectRoot,
  baseline,
  files,
  message,
  identity: identityValue,
}, {
  gitBinary = '/usr/bin/git',
  beforeRefUpdate = null,
  afterRefUpdate = null,
  afterIndexUpdate = null,
} = {}) {
  const root = canonicalRoot(projectRoot);
  if (root !== baseline?.canonicalRoot) {
    fail(ExactGitErrorCode.ROOT_MISMATCH, 'Commit root differs from its baseline');
  }
  const { identity, paths } = requireCommitMaterial(files, message, identityValue);
  const dirt = assertForeignBaseline(gitBinary, root, baseline, paths);
  if (dirt.targetDirtyPaths.length === 0) {
    fail(ExactGitErrorCode.TARGET_DIRTY, 'Expected project-change targets are not visible to Git');
  }
  if (dirt.targetDirtyPaths.length !== paths.length
    || dirt.targetDirtyPaths.some((candidate, index) => candidate !== paths[index])) {
    fail(ExactGitErrorCode.TARGET_DIRTY, 'Git target dirt differs from the exact change set');
  }

  const prepared = buildExactCommitObject({
    gitBinary, root, baseline, files, message, identity, paths,
  });
  let commitId = null;
  let refUpdated = false;
  try {
    commitId = prepared.commitId;
    if (beforeRefUpdate) beforeRefUpdate({ root, commitId, baseline });
    const update = invoke(gitBinary, root, [
      'update-ref', baseline.branchRef, commitId, baseline.head,
    ], { allowExit: [1, 128] });
    if (update.status !== 0) fail(ExactGitErrorCode.REF_RACE, 'Branch compare-and-swap lost its race');
    refUpdated = true;
    if (afterRefUpdate) afterRefUpdate({ root, commitId, baseline });

    // One real-index lock updates all and only the authorized paths. Foreign
    // staged entries are loaded and retained by Git; there is never `add -A`.
    invoke(gitBinary, root, ['update-index', '--index-info'], { input: prepared.indexInfo });
    if (afterIndexUpdate) afterIndexUpdate({ root, commitId, baseline });
    const afterDirt = foreignDirt(gitBinary, root, paths);
    const currentHead = outputText(invoke(gitBinary, root, ['rev-parse', '--verify', 'HEAD']));
    if (currentHead !== commitId || afterDirt.digest !== baseline.foreignDirtDigest
      || afterDirt.targetDirtyPaths.length !== 0) {
      fail(ExactGitErrorCode.IN_DOUBT, 'Post-commit Git preservation proof failed');
    }
    return Object.freeze({
      status: 'committed',
      beforeHead: baseline.head,
      afterHead: commitId,
      commitId,
      foreignDirtPreserved: true,
    });
  } catch (error) {
    if (refUpdated) {
      const restored = restoreReferenceAndIndex(
        gitBinary,
        root,
        baseline.branchRef,
        baseline.head,
        commitId,
        paths,
      );
      if (!restored) {
        fail(ExactGitErrorCode.IN_DOUBT, 'Commit failed after ref update and exact compensation failed', {
          commitId,
          cause: error.message,
        });
      }
    }
    throw error;
  } finally {
    rmExactTemporary(prepared.temporary);
  }
}

export function recoverExactProjectChange({
  projectRoot,
  baseline,
  files,
  message,
  identity: identityValue,
}, {
  gitBinary = '/usr/bin/git',
} = {}) {
  const root = canonicalRoot(projectRoot);
  if (root !== baseline?.canonicalRoot) {
    fail(ExactGitErrorCode.ROOT_MISMATCH, 'Recovery root differs from its baseline');
  }
  const { identity, paths } = requireCommitMaterial(files, message, identityValue);
  verifyExactWorkingTree(root, files);
  const prepared = buildExactCommitObject({
    gitBinary, root, baseline, files, message, identity, paths,
  });
  try {
    const currentBranch = outputText(invoke(gitBinary, root, ['symbolic-ref', '-q', 'HEAD']));
    const currentHead = outputText(invoke(gitBinary, root, ['rev-parse', '--verify', 'HEAD']));
    const dirt = foreignDirt(gitBinary, root, paths);
    if (currentBranch !== baseline.branchRef || dirt.digest !== baseline.foreignDirtDigest) {
      fail(ExactGitErrorCode.IN_DOUBT, 'Recovery Git branch or foreign dirt changed', {
        currentBranch,
        currentHead,
        expectedForeignDirtDigest: baseline.foreignDirtDigest,
        currentForeignDirtDigest: dirt.digest,
      });
    }
    if (currentHead === baseline.head) {
      invoke(gitBinary, root, ['reset', '--quiet', baseline.head, '--', ...paths]);
      const repairedDirt = foreignDirt(gitBinary, root, paths);
      if (repairedDirt.digest !== baseline.foreignDirtDigest
        || repairedDirt.targetDirtyPaths.length !== paths.length
        || repairedDirt.targetDirtyPaths.some((candidate, index) => candidate !== paths[index])) {
        fail(ExactGitErrorCode.IN_DOUBT, 'Uncommitted recovery targets differ from the exact change set');
      }
      return Object.freeze({
        status: 'not_committed',
        beforeHead: baseline.head,
        afterHead: baseline.head,
        commitId: prepared.commitId,
        foreignDirtPreserved: true,
      });
    }
    if (currentHead !== prepared.commitId) {
      fail(ExactGitErrorCode.IN_DOUBT, 'Recovery found an unrelated branch head', {
        currentHead,
        expectedHead: prepared.commitId,
      });
    }

    // A process crash can leave the ref advanced while the real index still
    // describes the parent. Reapply all and only the authorized paths, then
    // prove the same foreign dirt and a clean target projection.
    invoke(gitBinary, root, ['update-index', '--index-info'], { input: prepared.indexInfo });
    const afterDirt = foreignDirt(gitBinary, root, paths);
    const provenHead = outputText(invoke(gitBinary, root, ['rev-parse', '--verify', 'HEAD']));
    if (provenHead !== prepared.commitId
      || afterDirt.digest !== baseline.foreignDirtDigest
      || afterDirt.targetDirtyPaths.length !== 0) {
      fail(ExactGitErrorCode.IN_DOUBT, 'Recovered Git preservation proof failed');
    }
    return Object.freeze({
      status: 'committed',
      beforeHead: baseline.head,
      afterHead: prepared.commitId,
      commitId: prepared.commitId,
      foreignDirtPreserved: true,
    });
  } finally {
    rmExactTemporary(prepared.temporary);
  }
}

function rmExactTemporary(temporary) {
  // The path is returned directly by mkdtempSync with a fixed IntentSmith
  // prefix; no glob or caller-controlled parent participates in cleanup.
  try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* evidence is already durable */ }
}

export const _testInternals = Object.freeze({ foreignDirt, invoke, statusRecords });

export const exactGitProvider = Object.freeze({
  observe: observeExactGitBaseline,
  commit: commitExactProjectChange,
  recover: recoverExactProjectChange,
});

export default exactGitProvider;
