#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ExactGitErrorCode,
  commitExactProjectChange,
  observeExactGitBaseline,
  recoverExactProjectChange,
} from '../src/execution/exact-git-provider.js';
import { suite, test, summary } from './harness.js';

function git(root, args, options = {}) {
  return execFileSync('/usr/bin/git', args, {
    cwd: root,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: '/nonexistent',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
    encoding: 'utf8',
    ...options,
  }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-exact-git-'));
  for (const [name, content] of [
    ['target.txt', 'target-before\n'],
    ['staged.txt', 'staged-before\n'],
    ['unstaged.txt', 'unstaged-before\n'],
  ]) fs.writeFileSync(path.join(root, name), content);
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '--', 'target.txt', 'staged.txt', 'unstaged.txt']);
  git(root, [
    '-c', 'user.name=IntentSmith Test',
    '-c', 'user.email=intentsmith@example.invalid',
    'commit', '-m', 'baseline',
  ]);
  fs.writeFileSync(path.join(root, 'staged.txt'), 'staged-foreign\n');
  git(root, ['add', '--', 'staged.txt']);
  fs.writeFileSync(path.join(root, 'unstaged.txt'), 'unstaged-foreign\n');
  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked-foreign\n');
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function identity() {
  return {
    authorName: 'IntentSmith Runtime',
    authorEmail: 'runtime@example.invalid',
    authorDate: '2026-08-24T06:00:00Z',
    committerName: 'IntentSmith Runtime',
    committerEmail: 'runtime@example.invalid',
    committerDate: '2026-08-24T06:00:00Z',
  };
}

suite('M2 exact Git provider preserves foreign dirt');

test('temporary index commit changes only target and preserves three foreign dirt layers', () => {
  const root = fixture();
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    assert.deepEqual(baseline.targetDirtyPaths, []);
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-after\n');
    const result = commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: 0o644 }],
      message: 'exact target commit',
      identity: identity(),
    });
    assert.equal(result.status, 'committed');
    assert.equal(git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']), 'target.txt');
    assert.equal(git(root, ['diff', '--cached', '--name-only']), 'staged.txt');
    assert.equal(git(root, ['diff', '--name-only']), 'unstaged.txt');
    assert.equal(fs.readFileSync(path.join(root, 'staged.txt'), 'utf8'), 'staged-foreign\n');
    assert.equal(fs.readFileSync(path.join(root, 'unstaged.txt'), 'utf8'), 'unstaged-foreign\n');
    assert.equal(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'), 'untracked-foreign\n');
    const after = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    assert.equal(after.foreignDirtDigest, baseline.foreignDirtDigest);
    assert.deepEqual(after.targetDirtyPaths, []);
  } finally {
    cleanup(root);
  }
});

test('baseline exposes a pre-existing dirty target instead of blessing it', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, 'target.txt'), 'already-dirty\n');
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    assert.deepEqual(baseline.targetDirtyPaths, ['target.txt']);
  } finally {
    cleanup(root);
  }
});

test('foreign dirt inventory batches 3000 untracked paths into one index read under one second', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-scale-'));
  const wrapperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-wrapper-'));
  try {
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-before\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['add', '--', 'target.txt']);
    git(root, [
      '-c', 'user.name=IntentSmith Test',
      '-c', 'user.email=intentsmith@example.invalid',
      'commit', '-m', 'baseline',
    ]);
    for (let index = 0; index < 3_000; index += 1) {
      fs.writeFileSync(path.join(root, `foreign-${String(index).padStart(4, '0')}.txt`), 'x');
    }
    const logPath = path.join(wrapperRoot, 'argv.log');
    const wrapperPath = path.join(wrapperRoot, 'git-wrapper.sh');
    fs.writeFileSync(wrapperPath, `#!/bin/sh\nprintf '%s\\0' "$@" >> ${JSON.stringify(logPath)}\nexec /usr/bin/git "$@"\n`);
    fs.chmodSync(wrapperPath, 0o755);
    const startedAt = performance.now();
    const baseline = observeExactGitBaseline(root, ['target.txt'], {
      projectId: 17,
      gitBinary: wrapperPath,
    });
    const durationMs = performance.now() - startedAt;
    const calls = fs.readFileSync(logPath).toString('utf8')
      .split('ls-files\0--stage\0-z\0--\0').length - 1;
    assert.equal(baseline.targetDirtyPaths.length, 0);
    assert.equal(calls, 1);
    assert(durationMs < 1_000, `batched foreign-dirt baseline took ${durationMs.toFixed(1)} ms`);
  } finally {
    cleanup(root);
    cleanup(wrapperRoot);
  }
});

test('large foreign file is content-bound with bounded resident memory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-large-'));
  try {
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-before\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['add', '--', 'target.txt']);
    git(root, [
      '-c', 'user.name=IntentSmith Test',
      '-c', 'user.email=intentsmith@example.invalid',
      'commit', '-m', 'baseline',
    ]);
    const largePath = path.join(root, 'foreign-large.bin');
    fs.closeSync(fs.openSync(largePath, 'w'));
    fs.truncateSync(largePath, 200 * 1024 * 1024);
    const beforeRss = process.memoryUsage().rss;
    const before = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    const peakDelta = process.memoryUsage().rss - beforeRss;
    const descriptor = fs.openSync(largePath, 'r+');
    fs.writeSync(descriptor, Buffer.from([1]), 0, 1, 100 * 1024 * 1024);
    fs.closeSync(descriptor);
    const after = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    assert.notEqual(after.foreignDirtDigest, before.foreignDirtDigest);
    assert(peakDelta < 50 * 1024 * 1024, `foreign-dirt hashing grew RSS by ${peakDelta} bytes`);
  } finally {
    cleanup(root);
  }
});

test('branch race before CAS is rejected and the competing head is preserved', () => {
  const root = fixture();
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-after\n');
    let competingHead;
    assert.throws(() => commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: 0o644 }],
      message: 'losing exact commit',
      identity: identity(),
    }, {
      beforeRefUpdate({ root: repository, baseline: observed }) {
        const tree = git(repository, ['rev-parse', `${observed.head}^{tree}`]);
        competingHead = git(repository, ['commit-tree', tree, '-p', observed.head], {
          input: 'competing commit\n',
          env: {
            PATH: '/usr/bin:/bin',
            HOME: '/nonexistent',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 'Competitor',
            GIT_AUTHOR_EMAIL: 'competitor@example.invalid',
            GIT_AUTHOR_DATE: '2026-08-24T06:00:01Z',
            GIT_COMMITTER_NAME: 'Competitor',
            GIT_COMMITTER_EMAIL: 'competitor@example.invalid',
            GIT_COMMITTER_DATE: '2026-08-24T06:00:01Z',
          },
        });
        git(repository, ['update-ref', observed.branchRef, competingHead, observed.head]);
      },
    }), error => error.code === ExactGitErrorCode.REF_RACE);
    assert.equal(git(root, ['rev-parse', 'HEAD']), competingHead);
  } finally {
    cleanup(root);
  }
});

test('failure immediately after ref update is CAS-compensated to original head', () => {
  const root = fixture();
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-after\n');
    assert.throws(() => commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: 0o644 }],
      message: 'compensated exact commit',
      identity: identity(),
    }, {
      afterRefUpdate() {
        const error = new Error('fault after update-ref');
        error.code = 'FAULT_INJECTION';
        throw error;
      },
    }), error => (
      error?.code === ExactGitErrorCode.COMMAND_FAILED
      && error?.details?.effectApplied === true
      && error?.details?.rollbackStatus === 'succeeded'
      && typeof error?.details?.commitId === 'string'
      && error?.details?.causeCode === 'FAULT_INJECTION'
    ));
    assert.equal(git(root, ['rev-parse', 'HEAD']), baseline.head);
    assert.equal(git(root, ['diff', '--', 'target.txt']).includes('target-after'), true);
    const after = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    assert.equal(after.foreignDirtDigest, baseline.foreignDirtDigest);
  } finally {
    cleanup(root);
  }
});

test('failure after real-index update compensates both ref and exact target index entries', () => {
  const root = fixture();
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-after\n');
    assert.throws(() => commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: 0o644 }],
      message: 'compensate exact index',
      identity: identity(),
    }, {
      afterIndexUpdate() {
        const error = new Error('fault after real index update');
        error.code = 'FAULT_INJECTION';
        throw error;
      },
    }), error => (
      error?.code === ExactGitErrorCode.COMMAND_FAILED
      && error?.details?.effectApplied === true
      && error?.details?.rollbackStatus === 'succeeded'
      && error?.details?.causeCode === 'FAULT_INJECTION'
    ));
    assert.equal(git(root, ['rev-parse', 'HEAD']), baseline.head);
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--', 'target.txt']), '');
    assert.equal(git(root, ['diff', '--name-only', '--', 'target.txt']), 'target.txt');
    assert.equal(git(root, ['diff', '--cached', '--name-only']), 'staged.txt');
  } finally {
    cleanup(root);
  }
});

test('failure after ref update is in doubt only when exact compensation loses its CAS', () => {
  const root = fixture();
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    fs.writeFileSync(path.join(root, 'target.txt'), 'target-after\n');
    let competingHead = null;
    assert.throws(() => commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: 0o644 }],
      message: 'uncompensated exact commit',
      identity: identity(),
    }, {
      afterRefUpdate({ root: repository, commitId }) {
        const tree = git(repository, ['rev-parse', `${commitId}^{tree}`]);
        competingHead = git(repository, ['commit-tree', tree, '-p', commitId], {
          input: 'competing post-effect commit\n',
          env: {
            PATH: '/usr/bin:/bin', HOME: '/nonexistent',
            GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 'Competitor', GIT_AUTHOR_EMAIL: 'competitor@example.invalid',
            GIT_AUTHOR_DATE: '2026-08-24T06:00:02Z',
            GIT_COMMITTER_NAME: 'Competitor', GIT_COMMITTER_EMAIL: 'competitor@example.invalid',
            GIT_COMMITTER_DATE: '2026-08-24T06:00:02Z',
          },
        });
        git(repository, ['update-ref', baseline.branchRef, competingHead, commitId]);
        const error = new Error('fault after competing ref update');
        error.code = 'FAULT_INJECTION';
        throw error;
      },
    }), error => (
      error?.code === ExactGitErrorCode.IN_DOUBT
      && error?.details?.effectApplied === true
      && error?.details?.rollbackStatus === 'failed'
      && typeof error?.details?.commitId === 'string'
      && error?.details?.causeCode === 'FAULT_INJECTION'
    ));
    assert.equal(git(root, ['rev-parse', 'HEAD']), competingHead);
  } finally {
    cleanup(root);
  }
});

test('baseline ref with an after-image index is repaired before worktree rollback', () => {
  const root = fixture();
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    const targetMode = fs.statSync(path.join(root, 'target.txt')).mode & 0o777;
    const files = [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: targetMode }];
    fs.writeFileSync(path.join(root, 'target.txt'), files[0].bytes);
    git(root, ['add', '--', 'target.txt']);
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--', 'target.txt']), 'target.txt');
    const recovered = recoverExactProjectChange({
      projectRoot: root,
      baseline,
      files,
      message: 'repair compensated index',
      identity: identity(),
    });
    assert.equal(recovered.status, 'not_committed');
    assert.equal(git(root, ['rev-parse', 'HEAD']), baseline.head);
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--', 'target.txt']), '');
    assert.equal(git(root, ['diff', '--name-only', '--', 'target.txt']), 'target.txt');
    assert.equal(git(root, ['diff', '--cached', '--name-only']), 'staged.txt');
  } finally {
    cleanup(root);
  }
});

test('real process crash after update-ref is deterministically recovered with exact index repair', () => {
  const root = fixture();
  const scriptRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-crash-'));
  try {
    const baseline = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    const targetMode = fs.statSync(path.join(root, 'target.txt')).mode & 0o777;
    const files = [{ path: 'target.txt', bytes: Buffer.from('target-after\n'), mode: targetMode }];
    const message = 'recover exact crashed commit';
    const exactIdentity = identity();
    fs.writeFileSync(path.join(root, 'target.txt'), files[0].bytes);
    const providerUrl = new URL('../src/execution/exact-git-provider.js', import.meta.url).href;
    const crashScript = path.join(scriptRoot, 'crash-after-ref.mjs');
    fs.writeFileSync(crashScript, `
      import { commitExactProjectChange } from ${JSON.stringify(providerUrl)};
      commitExactProjectChange({
        projectRoot: ${JSON.stringify(root)},
        baseline: ${JSON.stringify(baseline)},
        files: [{ path: 'target.txt', bytes: Buffer.from('target-after\\n'), mode: ${targetMode} }],
        message: ${JSON.stringify(message)},
        identity: ${JSON.stringify(exactIdentity)},
      }, { afterRefUpdate() { process.kill(process.pid, 'SIGKILL'); } });
    `);
    const crashed = spawnSync('/usr/bin/node', [crashScript], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    assert.equal(crashed.status, null);
    assert.equal(crashed.signal, 'SIGKILL');
    assert.notEqual(git(root, ['rev-parse', 'HEAD']), baseline.head);
    assert.equal(git(root, ['status', '--porcelain=v1', '--', 'target.txt']).length > 0, true);

    const recovered = recoverExactProjectChange({
      projectRoot: root,
      baseline,
      files,
      message,
      identity: exactIdentity,
    });
    assert.equal(recovered.status, 'committed');
    assert.equal(git(root, ['rev-parse', 'HEAD']), recovered.commitId);
    assert.equal(git(root, ['status', '--porcelain=v1', '--', 'target.txt']), '');
    assert.equal(git(root, ['diff', '--cached', '--name-only']), 'staged.txt');
    assert.equal(fs.readFileSync(path.join(root, 'unstaged.txt'), 'utf8'), 'unstaged-foreign\n');
    assert.equal(fs.readFileSync(path.join(root, 'untracked.txt'), 'utf8'), 'untracked-foreign\n');
    const after = observeExactGitBaseline(root, ['target.txt'], { projectId: 17 });
    assert.equal(after.foreignDirtDigest, baseline.foreignDirtDigest);
  } finally {
    cleanup(root);
    cleanup(scriptRoot);
  }
});

test('pathspec-magic target remains literal and cannot reset foreign staged entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-literal-'));
  const target = ':(glob)*';
  try {
    fs.writeFileSync(path.join(root, target), 'target-before\n');
    fs.writeFileSync(path.join(root, 'foreign.txt'), 'foreign-before\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['--literal-pathspecs', 'add', '--', target, 'foreign.txt']);
    git(root, [
      '-c', 'user.name=IntentSmith Test',
      '-c', 'user.email=intentsmith@example.invalid',
      'commit', '-m', 'literal baseline',
    ]);
    fs.writeFileSync(path.join(root, 'foreign.txt'), 'foreign-staged\n');
    git(root, ['--literal-pathspecs', 'add', '--', 'foreign.txt']);
    const baseline = observeExactGitBaseline(root, [target], { projectId: 17 });
    const mode = fs.statSync(path.join(root, target)).mode & 0o777;
    fs.writeFileSync(path.join(root, target), 'target-after\n');
    const result = commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: target, bytes: Buffer.from('target-after\n'), mode }],
      message: 'literal magic target',
      identity: identity(),
    });
    assert.equal(result.status, 'committed');
    assert.equal(git(root, ['diff', '--cached', '--name-only']), 'foreign.txt');
    assert.equal(fs.readFileSync(path.join(root, 'foreign.txt'), 'utf8'), 'foreign-staged\n');
    const changed = git(root, ['diff-tree', '-z', '--no-commit-id', '--name-only', '-r', 'HEAD'])
      .split('\0').filter(Boolean);
    assert.deepEqual(changed, [target]);
  } finally {
    cleanup(root);
  }
});

test('newline filename is committed byte-exact through NUL-delimited index input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-git-newline-'));
  const target = 'line\nbreak.txt';
  try {
    fs.writeFileSync(path.join(root, target), 'before\n');
    git(root, ['init', '-b', 'main']);
    git(root, ['--literal-pathspecs', 'add', '--', target]);
    git(root, [
      '-c', 'user.name=IntentSmith Test',
      '-c', 'user.email=intentsmith@example.invalid',
      'commit', '-m', 'newline baseline',
    ]);
    const baseline = observeExactGitBaseline(root, [target], { projectId: 17 });
    const mode = fs.statSync(path.join(root, target)).mode & 0o777;
    fs.writeFileSync(path.join(root, target), 'after\n');
    const result = commitExactProjectChange({
      projectRoot: root,
      baseline,
      files: [{ path: target, bytes: Buffer.from('after\n'), mode }],
      message: 'newline exact target',
      identity: identity(),
    });
    assert.equal(result.status, 'committed');
    assert.equal(git(root, ['show', `HEAD:${target}`]), 'after');
    const names = git(root, ['ls-tree', '-rz', '--name-only', 'HEAD']).split('\0').filter(Boolean);
    assert.deepEqual(names, [target]);
  } finally {
    cleanup(root);
  }
});

test('provider source contains no add-all staging path', () => {
  const source = fs.readFileSync(new URL('../src/execution/exact-git-provider.js', import.meta.url), 'utf8');
  assert.equal(source.includes("'add', '-A'"), false);
  assert.equal(source.includes('git add -A'), false);
  assert.equal(source.includes("'update-index', '-z', '--index-info'"), true);
  assert.equal(source.includes("GIT_LITERAL_PATHSPECS: '1'"), true);
});

summary();
