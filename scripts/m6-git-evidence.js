import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const GIT_ENV_OVERRIDES = Object.freeze([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_REPLACE_REF_BASE',
  'GIT_WORK_TREE',
]);

function gitEnvironment() {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  for (const name of GIT_ENV_OVERRIDES) delete env[name];
  return env;
}

function gitArgs(args) {
  return ['--no-replace-objects', ...args];
}

export function gitText(root, args) {
  return execFileSync('git', gitArgs(args), {
    cwd: root,
    env: gitEnvironment(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function gitBytes(root, args) {
  return execFileSync('git', gitArgs(args), {
    cwd: root,
    env: gitEnvironment(),
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function gitStatus(root, args) {
  return spawnSync('git', gitArgs(args), {
    cwd: root,
    env: gitEnvironment(),
    stdio: 'ignore',
  }).status;
}

export function gitObjectExists(root, revision, artifactPath) {
  return gitStatus(root, ['cat-file', '-e', `${revision}:${artifactPath}`]) === 0;
}

export function gitIsAncestor(root, ancestor, descendant) {
  return gitStatus(root, ['merge-base', '--is-ancestor', ancestor, descendant]) === 0;
}

export function parseNameStatus(output) {
  return String(output).split('\n').filter(Boolean).map(line => {
    const separator = line.indexOf('\t');
    return separator === -1
      ? { status: null, path: line }
      : { status: line.slice(0, separator), path: line.slice(separator + 1) };
  });
}

export function readM6EvidenceCommitHistory(root, candidateSha, evidenceHeadSha) {
  const commitShas = gitText(root, [
    'rev-list', '--reverse', '--topo-order', `${candidateSha}..${evidenceHeadSha}`,
  ]).split('\n').filter(Boolean);
  return commitShas.map(commitSha => {
    const parentShas = gitText(root, ['show', '-s', '--format=%P', commitSha])
      .split(' ').filter(Boolean);
    const changesByParent = parentShas.map(parentSha => ({
      parentSha,
      changedEntries: parseNameStatus(gitText(root, [
        'diff', '--name-status', '--no-renames', parentSha, commitSha,
      ])),
    }));
    return Object.freeze({
      commitSha,
      parentShas: Object.freeze(parentShas),
      changesByParent: Object.freeze(changesByParent),
    });
  });
}

export function assertM6GitMetadataSafe(root) {
  const replaceRefs = gitText(root, [
    'for-each-ref', '--format=%(refname)', 'refs/replace',
  ]).split('\n').filter(Boolean);
  if (replaceRefs.length > 0) throw new Error('m6-git:replace-refs');

  const commonDirectory = gitText(root, [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]);
  if (existsSync(path.join(commonDirectory, 'info', 'grafts'))) {
    throw new Error('m6-git:grafts');
  }

  const indexed = gitBytes(root, ['ls-files', '-v', '-z']).toString('utf8')
    .split('\0').filter(Boolean);
  for (const entry of indexed) {
    const marker = entry[0];
    if (marker === 'S' || /^[a-z]$/u.test(marker)) {
      throw new Error(`m6-git:index-flag:${marker}:${entry.slice(2)}`);
    }
  }
}

export function m6WorktreeClean(root) {
  assertM6GitMetadataSafe(root);
  return gitText(root, ['status', '--porcelain=v1', '--untracked-files=all']) === '';
}
