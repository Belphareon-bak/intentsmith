import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDryRunPlan } from './dry-run.js';
import { LOCAL_GPU_SMOKE_MANIFEST } from './manifest.js';
import { executeOwnedCommand, OwnedProcessGroups } from './process.js';
import { probeLocalGpuProfile, RTX_3090_QWEN3_PROFILE, type ProbeCommand } from './profile.js';
import { buildLeakCheck, scanRedaction, snapshotResources } from './resources.js';
import { canonicalJson, assertPathInside, assertSafeRunId, managedRunPaths } from './safety.js';
import { renderUserSystemdUnits } from './systemd.js';
import {
  assertCleanSource,
  createManagedWorkspace,
  destroyManagedWorkspace,
  resolveSourceCommit,
} from './workspace.js';

const exec = promisify(execFile);
const roots: string[] = [];

async function root(label: string): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), `intentsmith-lv-${label}-`));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function gitRepository(): Promise<{ path: string; commit: string }> {
  const path = await root('git');
  await exec('git', ['init', '--initial-branch=main', path]);
  await exec('git', ['-C', path, 'config', 'user.email', 'test@example.invalid']);
  await exec('git', ['-C', path, 'config', 'user.name', 'IntentSmith Test']);
  await writeFile(resolve(path, 'file.txt'), 'base\n');
  await exec('git', ['-C', path, 'add', 'file.txt']);
  await exec('git', ['-C', path, 'commit', '-m', 'base']);
  return { path, commit: await resolveSourceCommit(path, 'HEAD') };
}

describe('immutable workspace and dry-run safety', () => {
  it('refuses unsafe run IDs and keeps all paths under the managed root', () => {
    for (const unsafe of ['../escape', '/absolute', 'Upper', 'has space', '', 'a'.repeat(65)]) {
      expect(() => assertSafeRunId(unsafe)).toThrow(expect.objectContaining({ code: 'UNSAFE_RUN_ID' }));
    }
    expect(managedRunPaths('/tmp/managed', 'night-01').workspace).toBe('/tmp/managed/night-01/workspace');
    expect(() => assertPathInside('/tmp/managed', '/tmp/escape')).toThrow(
      expect.objectContaining({ code: 'PATH_OUTSIDE_MANAGED_ROOT' }),
    );
    expect(canonicalJson({ z: [true, null], a: 'value' })).toBe('{"a":"value","z":[true,null]}');
  });

  it('refuses a dirty source and creates an isolated disposable Git worktree', async () => {
    const repository = await gitRepository();
    await writeFile(resolve(repository.path, 'dirty.txt'), 'dirty\n');
    await expect(assertCleanSource(repository.path)).rejects.toMatchObject({ code: 'DIRTY_SOURCE' });
    await rm(resolve(repository.path, 'dirty.txt'));

    const runsRoot = await root('runs');
    const workspace = await createManagedWorkspace({
      sourceRoot: repository.path,
      sourceCommit: repository.commit,
      runsRoot,
      runId: 'managed-1',
      parentEnv: { PATH: process.env.PATH, GITHUB_TOKEN: 'must-not-leak' },
    });
    expect(workspace.root).not.toBe(repository.path);
    expect(workspace.environment.HOME).toContain('/environment/home');
    expect(workspace.environment.XDG_CONFIG_HOME).toContain('/environment/home/config');
    expect(workspace.environment.GITHUB_TOKEN).toBeUndefined();
    expect(await readFile(resolve(workspace.root, 'file.txt'), 'utf8')).toBe('base\n');

    await destroyManagedWorkspace(workspace, runsRoot);
    await expect(access(workspace.root)).rejects.toThrow();
    await expect(access(workspace.environment.HOME as string)).rejects.toThrow();
  });

  it('dry-run emits the complete plan without creating a path', async () => {
    const runsRoot = resolve(await root('dry-parent'), 'not-created');
    const plan = buildDryRunPlan({
      sourceCommit: 'c'.repeat(40),
      runsRoot,
      runId: 'dry-1',
      scenarios: LOCAL_GPU_SMOKE_MANIFEST,
      profile: RTX_3090_QWEN3_PROFILE,
      runnerOptions: { resume: true },
    });
    expect(plan).toMatchObject({
      createsWorktree: false,
      startsExternalTools: false,
      modifiesDatabase: false,
      executesScenarios: false,
      expectedVersions: { worker: 'opencode-ai@1.18.8', model: 'ollama/qwen3:14b' },
    });
    expect(plan.scenarios.map(item => item.id)).toEqual(['approved-edit', 'deny-while-pending']);
    await expect(access(runsRoot)).rejects.toThrow();
  });

  it('exposes dry-run through a black-box CLI without writing the run root', async () => {
    const repository = await gitRepository();
    const runsRoot = resolve(await root('cli-parent'), 'not-created');
    const cli = resolve(process.cwd(), 'packages/local-validation/src/cli.ts');
    const { stdout } = await exec(
      process.execPath,
      [
        '--import',
        'tsx',
        cli,
        '--',
        '--source',
        repository.path,
        '--revision',
        repository.commit,
        '--runs-root',
        runsRoot,
        '--run-id',
        'cli-dry-1',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'dry-run',
      exactSourceRevision: repository.commit,
      createsWorktree: false,
      executesScenarios: false,
    });
    await expect(access(runsRoot)).rejects.toThrow();
  });
});

describe('process, leak and credential safety', () => {
  it('flushes and redacts logs before finalizing the result', async () => {
    const base = await root('logs');
    const secret = 'operator-secret-12345';
    const stdoutPath = resolve(base, 'stdout.log');
    const stderrPath = resolve(base, 'stderr.log');
    const result = await executeOwnedCommand({
      command: [
        process.execPath,
        '-e',
        `process.stdout.write("start "); setTimeout(() => { console.log(${JSON.stringify(secret)}); console.error("done"); }, 20)`,
      ],
      cwd: base,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 2_000,
      stdoutPath,
      stderrPath,
      sessionId: 'live',
      secrets: [secret],
    });
    expect(result).toMatchObject({ exitCode: 0, logsFlushed: true, processGroupMembersAfterCleanup: [] });
    expect(await readFile(stdoutPath, 'utf8')).toBe('start [redacted:gateway-token]\n');
    expect(await readFile(stderrPath, 'utf8')).toBe('done\n');
    await expect(scanRedaction([stdoutPath, stderrPath], [secret])).resolves.toMatchObject({ passed: true });
  });

  it('times out and cleans only its live owned process group', async () => {
    const base = await root('process');
    const result = await executeOwnedCommand({
      command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      cwd: base,
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 30,
      terminationGraceMs: 20,
      stdoutPath: resolve(base, 'stdout.log'),
      stderrPath: resolve(base, 'stderr.log'),
      sessionId: 'live',
    });
    expect(result.timedOut).toBe(true);
    expect(result.processGroupMembersAfterCleanup).toEqual([]);

    const calls: Array<[number, NodeJS.Signals | 0]> = [];
    const groups = new OwnedProcessGroups((pid, signal) => {
      calls.push([pid, signal]);
    });
    expect(groups.signalRecoveredGroup(result.pid, 'SIGKILL')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('signals only registered live groups and handles process lookup errors explicitly', () => {
    const calls: Array<[number, NodeJS.Signals | 0]> = [];
    const groups = new OwnedProcessGroups((pid, signal) => calls.push([pid, signal]));
    expect(groups.signal(123, 'session', 'SIGTERM')).toBe(false);
    groups.register(123, 'session');
    expect(groups.signal(123, 'session', 'SIGTERM')).toBe(true);
    groups.release(123, 'other');
    expect(groups.signal(123, 'session', 'SIGKILL')).toBe(true);
    groups.release(123, 'session');
    expect(groups.signal(123, 'session', 'SIGKILL')).toBe(false);
    expect(calls).toEqual([
      [-123, 'SIGTERM'],
      [-123, 'SIGKILL'],
    ]);

    const absent = new OwnedProcessGroups(() => {
      const error = new Error('gone') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });
    expect(absent.members(123)).toEqual([]);
    const forbidden = new OwnedProcessGroups(() => {
      const error = new Error('forbidden') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    expect(forbidden.members(123)).toEqual([123]);
  });

  it('records all resource and authority leak dimensions', () => {
    const clean = buildLeakCheck({
      before: { fileDescriptors: 4, diskBytes: 100 },
      after: { fileDescriptors: 5, diskBytes: 120 },
    });
    expect(clean).toMatchObject({ passed: true, fileDescriptorDelta: 1, diskBytesDelta: 20 });
    expect(
      buildLeakCheck({
        before: { fileDescriptors: 4, diskBytes: 100 },
        after: { fileDescriptors: 4, diskBytes: 100 },
        approvalWaiters: 1,
      }).passed,
    ).toBe(false);
  });

  it('records file-descriptor and recursive disk snapshots', async () => {
    const base = await root('snapshot');
    await mkdir(resolve(base, 'nested'));
    await writeFile(resolve(base, 'nested', 'bytes.txt'), '12345');
    await expect(snapshotResources(base)).resolves.toEqual(
      expect.objectContaining({ fileDescriptors: expect.any(Number), diskBytes: 5 }),
    );
  });
});

describe('profile and scheduling policy', () => {
  it('refuses the wrong pinned OpenCode version and reports missing prerequisites as BLOCKED', async () => {
    const wrong: ProbeCommand = async program => (program === 'opencode' ? 'opencode 1.19.0' : undefined);
    await expect(probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, { runCommand: wrong })).resolves.toMatchObject({
      available: false,
      reason: { code: 'OPENCODE_VERSION_MISMATCH', kind: 'blocked' },
    });
    const missing: ProbeCommand = async () => undefined;
    await expect(probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, { runCommand: missing })).resolves.toMatchObject({
      available: false,
      reason: { code: 'OPENCODE_MISSING', kind: 'blocked' },
    });
    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, { opencodeBin: process.execPath }),
    ).resolves.toMatchObject({
      available: false,
      reason: { code: 'OPENCODE_VERSION_MISMATCH' },
    });
  });

  it('records the pinned profile without promoting strict offline and detects a busy GPU', async () => {
    const probe: ProbeCommand = async (program, args) => {
      if (program === 'opencode') return 'opencode version 1.18.8';
      if (args[0]?.startsWith('--query-gpu')) return 'NVIDIA GeForce RTX 3090, 575.64, 2, 500';
      return '991, another-worker, 12000';
    };
    const fetchFn: typeof fetch = async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen3:14b' }] }), {
        status: 200,
        headers: { server: 'ollama' },
      });
    const result = await probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, { runCommand: probe, fetchFn });
    expect(result).toMatchObject({ available: false, reason: { code: 'GPU_BUSY' } });
    expect(result.observed.gpuProcesses).toHaveLength(1);
    expect(RTX_3090_QWEN3_PROFILE).toMatchObject({ concurrency: 1, strictOfflineProven: false });
  });

  it('classifies GPU, Ollama and model prerequisites without installing anything', async () => {
    const fetchWith = (models: string[], status = 200): typeof fetch =>
      async () =>
        new Response(JSON.stringify({ models: models.map(name => ({ name })) }), {
          status,
          headers: { server: 'ollama' },
        });
    const commands = (gpu: string | undefined, processes = ''): ProbeCommand => async (program, args) => {
      if (program === 'opencode') return '1.18.8';
      if (args[0]?.startsWith('--query-gpu')) return gpu;
      return processes;
    };

    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, { runCommand: commands(undefined) }),
    ).resolves.toMatchObject({ reason: { code: 'GPU_MISSING' } });
    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, {
        runCommand: commands('Different GPU, 1, 0, 0'),
      }),
    ).resolves.toMatchObject({ reason: { code: 'GPU_MISMATCH' } });
    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, {
        runCommand: commands('NVIDIA GeForce RTX 3090, 575, 0, 100'),
        fetchFn: async () => {
          throw new Error('offline');
        },
      }),
    ).resolves.toMatchObject({ reason: { code: 'OLLAMA_MISSING' } });
    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, {
        runCommand: commands('NVIDIA GeForce RTX 3090, 575, 0, 100'),
        fetchFn: fetchWith([], 503),
      }),
    ).resolves.toMatchObject({ reason: { code: 'OLLAMA_MISSING' } });
    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, {
        runCommand: commands('NVIDIA GeForce RTX 3090, 575, 0, 100'),
        fetchFn: fetchWith(['other:model']),
      }),
    ).resolves.toMatchObject({ reason: { code: 'MODEL_MISSING' } });
    await expect(
      probeLocalGpuProfile(RTX_3090_QWEN3_PROFILE, {
        runCommand: commands('NVIDIA GeForce RTX 3090, 575, 0, 100'),
        fetchFn: fetchWith(['qwen3:14b']),
      }),
    ).resolves.toMatchObject({ available: true, idle: true });
  });

  it('renders but never installs a user timer with absolute paths, lock and Prague defaults', () => {
    const units = renderUserSystemdUnits({
      nodePath: '/usr/bin/node',
      cliPath: '/opt/intentsmith/local-validation.js',
      sourceRoot: '/srv/intentsmith',
      runsRoot: '/srv/intentsmith-runs',
      lockPath: '/srv/intentsmith-runs/.lock',
    });
    expect(units.installRequired).toBe(true);
    expect(units.service).toContain('/usr/bin/flock -n /srv/intentsmith-runs/.lock');
    expect(units.timer).toContain('00:30:00 Europe/Prague');
    expect(units.timer).toContain('Persistent=false');
    expect(() =>
      renderUserSystemdUnits({
        nodePath: 'node',
        cliPath: '/cli.js',
        sourceRoot: '/source',
        runsRoot: '/runs',
        lockPath: '/runs/.lock',
      }),
    ).toThrow(expect.objectContaining({ code: 'SYSTEMD_PATH_NOT_ABSOLUTE' }));
  });
});
