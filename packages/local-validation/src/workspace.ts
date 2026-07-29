import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildIsolatedEnv } from '@intentsmith/process-runtime';

import { assertExactCommit, assertPathInside, managedRunPaths, ValidationSafetyError } from './safety.js';

const exec = promisify(execFile);
const MARKER = '.intentsmith-local-validation-workspace.json';

export type ManagedWorkspace = {
  sourceRoot: string;
  sourceCommit: string;
  sessionId: string;
  root: string;
  environment: Record<string, string>;
};

export async function assertCleanSource(sourceRoot: string): Promise<void> {
  const { stdout } = await exec('git', ['-C', sourceRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
    encoding: 'utf8',
  });
  if (stdout.trim().length > 0) {
    throw new ValidationSafetyError('DIRTY_SOURCE', 'Refusing local validation from a dirty source worktree.');
  }
}

export async function resolveSourceCommit(sourceRoot: string, revision: string): Promise<string> {
  const { stdout } = await exec('git', ['-C', sourceRoot, 'rev-parse', `${revision}^{commit}`], { encoding: 'utf8' });
  const commit = stdout.trim();
  assertExactCommit(commit);
  return commit;
}

export async function createManagedWorkspace(options: {
  sourceRoot: string;
  sourceCommit: string;
  runsRoot: string;
  runId: string;
  parentEnv?: NodeJS.ProcessEnv;
}): Promise<ManagedWorkspace> {
  await assertCleanSource(options.sourceRoot);
  assertExactCommit(options.sourceCommit);
  const paths = managedRunPaths(options.runsRoot, options.runId);
  await mkdir(dirname(paths.workspace), { recursive: true });
  await exec('git', ['-C', options.sourceRoot, 'worktree', 'add', '--detach', paths.workspace, options.sourceCommit], {
    encoding: 'utf8',
  });
  const sessionId = randomUUID();
  await writeFile(
    resolve(paths.workspace, MARKER),
    `${JSON.stringify({ sessionId, sourceCommit: options.sourceCommit }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  await mkdir(paths.isolatedHome, { recursive: true, mode: 0o700 });
  for (const path of Object.values(paths.xdg)) await mkdir(path, { recursive: true, mode: 0o700 });
  return {
    sourceRoot: options.sourceRoot,
    sourceCommit: options.sourceCommit,
    sessionId,
    root: paths.workspace,
    environment: buildIsolatedEnv({ runtimeRoot: paths.isolatedHome, parentEnv: options.parentEnv }),
  };
}

export async function destroyManagedWorkspace(workspace: ManagedWorkspace, runsRoot: string): Promise<void> {
  assertPathInside(runsRoot, workspace.root);
  let marker: { sessionId?: string; sourceCommit?: string };
  try {
    marker = JSON.parse(await readFile(resolve(workspace.root, MARKER), 'utf8')) as {
      sessionId?: string;
      sourceCommit?: string;
    };
  } catch {
    throw new ValidationSafetyError('WORKSPACE_NOT_OWNED', 'Managed workspace marker is missing or corrupt.');
  }
  if (marker.sessionId !== workspace.sessionId || marker.sourceCommit !== workspace.sourceCommit) {
    throw new ValidationSafetyError('WORKSPACE_NOT_OWNED', 'Managed workspace marker does not match this session.');
  }
  await exec('git', ['-C', workspace.sourceRoot, 'worktree', 'remove', '--force', workspace.root], { encoding: 'utf8' });
  const runRoot = dirname(workspace.root);
  assertPathInside(runsRoot, runRoot);
  await rm(resolve(runRoot, 'environment'), { recursive: true, force: true });
}
