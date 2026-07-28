import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { captureProposedChanges, isAcceptable, relativePaths } from './change-capture.js';
import type { GateCommandRunner, GateResult } from './gate-runner.js';

/**
 * Git-backed change capture.
 *
 * These run against real repositories in temp directories: the whole point of
 * capture is that it reads what is actually on disk, so faking git would test
 * nothing worth testing.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function repository(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-cap-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const run = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
  };
  run('init', '--initial-branch=main');
  run('config', 'user.email', 'test@example.invalid');
  run('config', 'user.name', 'Test');
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1;\n');
  run('add', '.');
  run('commit', '-m', 'base');
  return root;
}

const gate = (status: GateResult['status']): GateResult => ({
  id: 'tests',
  description: 'deterministic tests',
  status,
  exitCode: status === 'pass' ? 0 : 1,
  signal: null,
  durationMs: 1,
  stdoutTail: '',
  stderrTail: '',
});

describe('capturing what a worker changed', () => {
  it('reports a clean workspace as no changes', async () => {
    const root = repository();
    const captured = await captureProposedChanges({ workspaceRoot: root });

    expect(captured.changedPaths).toEqual([]);
    expect(captured.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(captured.unavailableReason).toBeUndefined();
    expect(isAcceptable(captured)).toBe(true);
  });

  it('captures a modification with its digest and line counts', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 2;\nexport const b = 3;\n');

    const captured = await captureProposedChanges({ workspaceRoot: root, approvalIds: ['approval_1'] });

    expect(relativePaths(captured)).toEqual(['src/app.ts']);
    expect(captured.changedPaths[0]).toMatchObject({ status: 'modified', binary: false });
    expect(captured.changedPaths[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.additions).toBe(2);
    expect(captured.deletions).toBe(1);
    expect(captured.diffArtifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.approvalIds).toEqual(['approval_1']);
  });

  it('captures a new file the worker created', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'src', 'new.ts'), 'export const c = 3;\n');

    const captured = await captureProposedChanges({ workspaceRoot: root, approvalIds: ['approval_1'] });
    expect(captured.changedPaths).toHaveLength(1);
    expect(captured.changedPaths[0]).toMatchObject({ path: 'src/new.ts', status: 'untracked' });
  });

  it('captures a deletion without trying to hash a file that is gone', async () => {
    const root = repository();
    rmSync(path.join(root, 'src', 'app.ts'));

    const captured = await captureProposedChanges({ workspaceRoot: root, approvalIds: ['approval_1'] });
    expect(captured.changedPaths[0]).toEqual({ path: 'src/app.ts', status: 'deleted' });
  });

  it('does not stage or commit anything while looking', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'src', 'new.ts'), 'export const c = 3;\n');
    await captureProposedChanges({ workspaceRoot: root });

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' });
    const log = execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: root, encoding: 'utf8' });
    // Capturing evidence must not change the thing being measured.
    expect(staged.trim()).toBe('');
    expect(log.trim()).toBe('1');
  });
});

describe('what capture refuses to call acceptable', () => {
  it('flags a change outside the allowed paths', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'secrets.env'), 'TOKEN=1\n');

    const captured = await captureProposedChanges({ workspaceRoot: root, approvalIds: ['approval_1'] });
    expect(captured.policyFindings.join(' ')).toMatch(/outside the allowed paths/);
    expect(isAcceptable(captured)).toBe(false);
  });

  it('flags a binary file', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'src', 'blob.bin'), Buffer.from([0, 1, 2, 3, 0]));

    const captured = await captureProposedChanges({ workspaceRoot: root, approvalIds: ['approval_1'] });
    expect(captured.policyFindings.join(' ')).toMatch(/binary file/);
    expect(isAcceptable(captured)).toBe(false);
  });

  it('flags changes that were never approved', async () => {
    const root = repository();
    writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 9;\n');

    const captured = await captureProposedChanges({ workspaceRoot: root });
    // The two records disagree, and that is worth surfacing rather than
    // resolving in favour of the more convenient one.
    expect(captured.unresolvedRisks.join(' ')).toMatch(/no approval was recorded/);
  });

  it('refuses to call a run acceptable when a gate failed', async () => {
    const root = repository();
    const captured = await captureProposedChanges({ workspaceRoot: root, gates: [gate('fail')] });
    expect(isAcceptable(captured)).toBe(false);
    expect(captured.gateEvidence).toEqual([{ id: 'tests', status: 'fail' }]);
  });

  it('reports an unusable repository instead of an empty change set', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-nogit-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));

    const captured = await captureProposedChanges({ workspaceRoot: root });
    // "No diff" and "could not look" mean completely different things.
    expect(captured.unavailableReason).toMatch(/could not read the workspace repository/);
    expect(isAcceptable(captured)).toBe(false);
  });

  it('reports a failure to list changes rather than claiming there were none', async () => {
    const root = repository();
    const runner: GateCommandRunner = async (_executable, args) =>
      args[0] === 'status'
        ? { code: 128, signal: null, stdout: '', stderr: 'fatal' }
        : { code: 0, signal: null, stdout: 'a'.repeat(40), stderr: '' };

    const captured = await captureProposedChanges({ workspaceRoot: root, runner });
    expect(captured.unavailableReason).toMatch(/could not list workspace changes/);
  });

  it('records a path that escapes through a symlink instead of dropping it', async () => {
    const root = repository();
    const outside = mkdtempSync(path.join(tmpdir(), 'intentsmith-out-'));
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(path.join(outside, 'target.txt'), 'outside\n');
    symlinkSync(outside, path.join(root, 'src', 'escape'));

    const captured = await captureProposedChanges({ workspaceRoot: root, approvalIds: ['approval_1'] });
    // A change nobody can see is worse than one that is refused.
    expect(captured.policyFindings.join(' ')).toMatch(/outside the disposable workspace|outside the allowed paths/);
    expect(isAcceptable(captured)).toBe(false);
  });
});
