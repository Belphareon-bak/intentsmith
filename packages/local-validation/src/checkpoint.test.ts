import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { eligibleForResume, readCheckpoint, recordAttempt, writeCheckpoint } from './checkpoint.js';
import type { RunCheckpoint, RunFingerprints, ScenarioAttempt, ScenarioRecord } from './types.js';

const roots: string[] = [];
const fingerprints: RunFingerprints = {
  sourceCommit: 'a'.repeat(40),
  runnerVersion: '1.0.0',
  scenarioManifest: 'manifest',
  modelProfile: 'profile',
  options: 'options',
};

async function root(): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), 'intentsmith-lv-checkpoint-'));
  roots.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function checkpoint(): RunCheckpoint {
  return {
    schemaVersion: 1,
    runId: 'night-1',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    fingerprints,
    scenarios: [],
  };
}

function attempt(verdict: ScenarioAttempt['verdict'], attemptNumber: number): ScenarioAttempt {
  return {
    attempt: attemptNumber,
    scenarioId: 'scenario',
    scenarioVersion: '1',
    testedCommit: fingerprints.sourceCommit,
    verdict,
    behavioralObservations: [],
    startedAt: '2026-07-29T00:00:00.000Z',
    endedAt: '2026-07-29T00:00:01.000Z',
    durationMs: 1_000,
    exitCode: verdict === 'PASS' ? 0 : null,
    signal: null,
    runtimeVersions: { node: process.version, runner: '1.0.0' },
    artifactPaths: [],
    logPaths: [],
    retryCount: attemptNumber - 1,
    leakCheck: {
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
    },
    redaction: { passed: true, checkedLocations: [], findings: [] },
  };
}

describe('checkpoint compatibility and history', () => {
  it('atomically writes and reads a compatible checkpoint', async () => {
    const path = resolve(await root(), 'checkpoint.json');
    await writeCheckpoint(path, checkpoint());
    await expect(readCheckpoint(path, fingerprints)).resolves.toEqual(checkpoint());
  });

  it('refuses corrupt and incompatible checkpoints', async () => {
    const base = await root();
    const corrupt = resolve(base, 'corrupt.json');
    await writeFile(corrupt, '{');
    await expect(readCheckpoint(corrupt, fingerprints)).rejects.toMatchObject({ code: 'CHECKPOINT_CORRUPT' });

    const incompatible = resolve(base, 'incompatible.json');
    await writeCheckpoint(incompatible, checkpoint());
    await expect(readCheckpoint(incompatible, { ...fingerprints, runnerVersion: '2.0.0' })).rejects.toMatchObject({
      code: 'CHECKPOINT_INCOMPATIBLE',
    });
    await expect(readCheckpoint(incompatible, fingerprints, { runId: 'different-run' })).rejects.toMatchObject({
      code: 'CHECKPOINT_INCOMPATIBLE',
    });

    const malformed = resolve(base, 'malformed.json');
    await writeFile(malformed, JSON.stringify({ ...checkpoint(), scenarios: [{ id: 'missing-fields' }] }));
    await expect(readCheckpoint(malformed, fingerprints)).rejects.toMatchObject({ code: 'CHECKPOINT_CORRUPT' });
  });

  it('refuses a stale checkpoint', async () => {
    const path = resolve(await root(), 'stale.json');
    await writeCheckpoint(path, checkpoint());
    await utimes(path, new Date(0), new Date(0));
    await expect(readCheckpoint(path, fingerprints, { nowMs: 10_000, maxAgeMs: 100 })).rejects.toMatchObject({
      code: 'CHECKPOINT_STALE',
    });
  });

  it('retries blocked and scheduler-skipped records but keeps FAIL sticky', () => {
    const blocked: ScenarioRecord = {
      id: 'scenario',
      version: '1',
      schedulerState: 'COMPLETED',
      attempts: [attempt('BLOCKED', 1)],
      deterministicVerdict: 'BLOCKED',
    };
    expect(eligibleForResume(blocked)).toBe(true);
    expect(eligibleForResume({ ...blocked, schedulerState: 'SKIPPED' })).toBe(true);

    const failed = recordAttempt({ id: 'scenario', version: '1', schedulerState: 'PENDING', attempts: [] }, attempt('FAIL', 1));
    const laterPass = recordAttempt(failed, attempt('PASS', 2));
    expect(laterPass.deterministicVerdict).toBe('FAIL');
    expect(laterPass.attempts.map(item => item.verdict)).toEqual(['FAIL', 'PASS']);
    expect(eligibleForResume(failed)).toBe(false);
  });
});
