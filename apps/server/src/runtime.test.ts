import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRuntime, defaultDbPath } from './runtime.js';

/**
 * Process composition tests.
 *
 * Every case uses an explicit temporary database path so no test ever writes
 * into the repository or a real user project.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  delete process.env.INTENTSMITH_DB_PATH;
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intentsmith-runtime-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('server runtime composition', () => {
  it('builds a working core against an explicit database path', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'nested', 'state.db');
    const runtime = createRuntime(dbPath);

    const project = await runtime.core.createProject({ name: 'runtime', rootPath: dir });
    expect(project.rootPath).toBe(dir);
    expect(existsSync(dbPath)).toBe(true);

    await runtime.close();
  });

  it('cancels active work when the runtime closes', async () => {
    const dir = tempDir();
    const runtime = createRuntime(path.join(dir, 'state.db'));
    const project = await runtime.core.createProject({ name: 'runtime', rootPath: dir });
    const task = await runtime.core.createTask({
      projectId: project.id,
      type: 'code',
      goal: 'stay running',
      scope: {
        fsReadRoots: [dir],
        fsWriteRoots: [dir],
        allowedCommandFamilies: [],
        deniedCommandPatterns: [],
        network: { mode: 'disabled', allowlist: [] },
        envAllowlist: ['PATH'],
        secrets: 'none',
        processSpawning: 'disabled',
        timeoutMs: 60_000,
        maxActions: 0,
        approvalRules: [],
      },
      expectedOutputs: ['out'],
      acceptanceCriteria: ['ok'],
      workerScenario: 'pauseable-success',
      timeoutMs: 60_000,
    });
    await runtime.core.startTask(task.id);

    await runtime.close();
    // The store is closed by now, so assert through a fresh runtime.
    const reopened = createRuntime(path.join(dir, 'state.db'));
    expect((await reopened.core.getTask(task.id)).status).toBe('cancelled');
    await reopened.close();
  });

  it('honours INTENTSMITH_DB_PATH without creating a stray directory', () => {
    const dir = tempDir();
    const override = path.join(dir, 'custom.db');
    const strayDir = path.join(process.cwd(), '.intentsmith');
    // An override must have no filesystem side effect at all. Compare before
    // and after rather than asserting absence, since an earlier run of the
    // server may legitimately have left the default directory behind.
    const existedBefore = existsSync(strayDir);

    process.env.INTENTSMITH_DB_PATH = override;
    expect(defaultDbPath()).toBe(override);

    expect(existsSync(strayDir)).toBe(existedBefore);
  });
});
