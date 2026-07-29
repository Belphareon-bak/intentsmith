import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readCheckpoint } from './checkpoint.js';
import type { CommandResult } from './process.js';
import { runScenarioManifest, type ScenarioExecutor } from './runner.js';
import type { LeakCheckResult, RunFingerprints, ScenarioDefinition } from './types.js';

const roots: string[] = [];
const fingerprints: RunFingerprints = {
  sourceCommit: 'b'.repeat(40),
  runnerVersion: '0.1.0',
  scenarioManifest: 'manifest',
  modelProfile: 'profile',
  options: 'options',
};
const cleanLeak: LeakCheckResult = {
  passed: true,
  processGroupMembers: [],
  ownedListeners: [],
  ownedSockets: [],
  ownedTemporaryPaths: [],
  isolatedEnvironmentPaths: [],
  fileDescriptorDelta: 0,
  diskBytesDelta: 0,
  approvalWaiters: 0,
  liveApprovalGrants: 0,
  liveGatewayTokens: 0,
  operatorCredentialLeaks: [],
};

async function root(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), 'intentsmith-lv-runner-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function scenario(id = 'scenario'): ScenarioDefinition {
  return { id, version: '1', command: ['fixture'], timeoutMs: 100, requiredPreconditions: [] };
}

function command(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 1,
    pid: 123,
    processGroupMembersAfterCleanup: [],
    logsFlushed: true,
    ...overrides,
  };
}

function executor(result: CommandResult, leakCheck = cleanLeak): ScenarioExecutor {
  return async () => ({
    command: result,
    runtimeVersions: { node: process.version, runner: '0.1.0' },
    artifactPaths: [],
    logPaths: [],
    leakCheck,
    redaction: { passed: true, checkedLocations: [], findings: [] },
  });
}

describe('scenario result model and resume', () => {
  it('classifies PASS, FAIL and BLOCKED without using final SKIPPED', async () => {
    const base = await root();
    const pass = await runScenarioManifest({
      runId: 'pass',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'pass.json'),
      execute: executor(command()),
      checkPreconditions: async () => undefined,
    });
    expect(pass.scenarios[0]?.deterministicVerdict).toBe('PASS');

    const failed = await runScenarioManifest({
      runId: 'fail',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'fail.json'),
      execute: executor(command({ exitCode: 9 })),
      checkPreconditions: async () => undefined,
    });
    expect(failed.scenarios[0]?.deterministicVerdict).toBe('FAIL');
    expect(failed.scenarios[0]?.attempts[0]?.reason?.code).toBe('SCENARIO_NONZERO_EXIT');

    const blocked = await runScenarioManifest({
      runId: 'blocked',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'blocked.json'),
      execute: executor(command()),
      checkPreconditions: async () => ({ code: 'MODEL_MISSING', message: 'model absent', kind: 'blocked' }),
    });
    expect(blocked.scenarios[0]?.deterministicVerdict).toBe('BLOCKED');
    expect(blocked.scenarios[0]?.schedulerState).toBe('COMPLETED');
  });

  it('makes timeout and signal crashes deterministic FAIL results', async () => {
    const base = await root();
    const timedOut = await runScenarioManifest({
      runId: 'timeout',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'timeout.json'),
      execute: executor(command({ timedOut: true, exitCode: null, signal: 'SIGKILL', durationMs: 100 })),
      checkPreconditions: async () => undefined,
    });
    expect(timedOut.scenarios[0]?.attempts[0]).toMatchObject({
      verdict: 'FAIL',
      reason: { code: 'SCENARIO_TIMEOUT', kind: 'failure' },
    });

    const crashed = await runScenarioManifest({
      runId: 'crash',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'crash.json'),
      execute: executor(command({ exitCode: null, signal: 'SIGSEGV' })),
      checkPreconditions: async () => undefined,
    });
    expect(crashed.scenarios[0]?.attempts[0]?.reason?.code).toBe('SCENARIO_CRASH');
  });

  it('persists after each scenario and resumes after a runner crash', async () => {
    const base = await root();
    const path = resolve(base, 'checkpoint.json');
    let calls = 0;
    await expect(
      runScenarioManifest({
        runId: 'resume',
        fingerprints,
        scenarios: [scenario('first'), scenario('second')],
        checkpointPath: path,
        execute: async definition => {
          calls += 1;
          if (definition.id === 'second') throw new Error('simulated runner crash');
          return await executor(command())(definition, 1);
        },
        checkPreconditions: async () => undefined,
      }),
    ).rejects.toThrow('simulated runner crash');
    expect(calls).toBe(2);

    const saved = await readCheckpoint(path, fingerprints);
    expect(saved.scenarios.map(item => item.deterministicVerdict)).toEqual(['PASS', undefined]);
    const resumed = await runScenarioManifest({
      runId: 'resume',
      fingerprints,
      scenarios: [scenario('first'), scenario('second')],
      checkpointPath: path,
      resume: saved,
      execute: executor(command()),
      checkPreconditions: async () => undefined,
    });
    expect(resumed.scenarios.map(item => item.deterministicVerdict)).toEqual(['PASS', 'PASS']);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ runId: 'resume' });
  });

  it('fails a clean command when leak or redaction evidence fails', async () => {
    const base = await root();
    const leaked = await runScenarioManifest({
      runId: 'leak',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'leak.json'),
      execute: executor(command(), { ...cleanLeak, passed: false, approvalWaiters: 1 }),
      checkPreconditions: async () => undefined,
    });
    expect(leaked.scenarios[0]?.attempts[0]?.reason?.code).toBe('SESSION_LEAK');

    const redaction = await runScenarioManifest({
      runId: 'redaction',
      fingerprints,
      scenarios: [scenario()],
      checkpointPath: resolve(base, 'redaction.json'),
      execute: async () => ({
        ...(await executor(command())(scenario(), 1)),
        redaction: { passed: false, checkedLocations: ['log'], findings: ['log'] },
      }),
      checkPreconditions: async () => undefined,
    });
    expect(redaction.scenarios[0]?.attempts[0]?.reason?.code).toBe('SECRET_REDACTION_FAILED');
  });
});
