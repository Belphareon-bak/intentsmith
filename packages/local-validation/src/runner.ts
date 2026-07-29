import type { CommandResult } from './process.js';
import { eligibleForResume, recordAttempt, writeCheckpoint } from './checkpoint.js';
import type {
  LeakCheckResult,
  RedactionResult,
  RunCheckpoint,
  RunFingerprints,
  RuntimeVersions,
  ScenarioAttempt,
  ScenarioDefinition,
  ScenarioRecord,
  StructuredReason,
} from './types.js';

export type ScenarioExecutor = (scenario: ScenarioDefinition, attempt: number) => Promise<{
  command: CommandResult;
  behavioralObservations?: unknown[];
  runtimeVersions: RuntimeVersions;
  artifactPaths: string[];
  logPaths: string[];
  leakCheck: LeakCheckResult;
  redaction: RedactionResult;
}>;

export type PreconditionCheck = (scenario: ScenarioDefinition) => Promise<StructuredReason | undefined>;

function initialRecord(scenario: ScenarioDefinition): ScenarioRecord {
  return { id: scenario.id, version: scenario.version, schedulerState: 'PENDING', attempts: [] };
}

function classify(
  result: Awaited<ReturnType<ScenarioExecutor>>,
): Pick<ScenarioAttempt, 'verdict' | 'reason'> {
  if (result.command.timedOut) {
    return {
      verdict: 'FAIL',
      reason: {
        code: 'SCENARIO_TIMEOUT',
        message: 'The scenario exceeded its hard upper bound.',
        kind: 'failure',
        timeoutMs: result.command.durationMs,
      },
    };
  }
  if (result.command.exitCode !== 0 || result.command.signal !== null) {
    return {
      verdict: 'FAIL',
      reason: {
        code: result.command.signal ? 'SCENARIO_CRASH' : 'SCENARIO_NONZERO_EXIT',
        message: result.command.signal
          ? `The scenario ended on ${result.command.signal}.`
          : `The scenario exited ${result.command.exitCode}.`,
        kind: 'failure',
      },
    };
  }
  if (!result.leakCheck.passed) {
    return { verdict: 'FAIL', reason: { code: 'SESSION_LEAK', message: 'Session leak checks failed.', kind: 'failure' } };
  }
  if (!result.redaction.passed) {
    return {
      verdict: 'FAIL',
      reason: { code: 'SECRET_REDACTION_FAILED', message: 'A run-scoped or operator secret remained.', kind: 'failure' },
    };
  }
  return { verdict: 'PASS' };
}

export async function runScenarioManifest(options: {
  runId: string;
  fingerprints: RunFingerprints;
  scenarios: ScenarioDefinition[];
  checkpointPath: string;
  execute: ScenarioExecutor;
  checkPreconditions: PreconditionCheck;
  resume?: RunCheckpoint;
  now?: () => Date;
}): Promise<RunCheckpoint> {
  const now = options.now ?? (() => new Date());
  const createdAt = options.resume?.createdAt ?? now().toISOString();
  const records = new Map(
    (options.resume?.scenarios ?? options.scenarios.map(initialRecord)).map(record => [record.id, record]),
  );
  let checkpoint: RunCheckpoint = {
    schemaVersion: 1,
    runId: options.runId,
    createdAt,
    updatedAt: now().toISOString(),
    fingerprints: options.fingerprints,
    scenarios: options.scenarios.map(scenario => records.get(scenario.id) ?? initialRecord(scenario)),
  };

  for (const scenario of options.scenarios) {
    let record = records.get(scenario.id) ?? initialRecord(scenario);
    if (record.schedulerState === 'COMPLETED' && !eligibleForResume(record)) continue;
    const attemptNumber = record.attempts.length + 1;
    const blocked = await options.checkPreconditions(scenario);
    if (blocked) {
      const at = now().toISOString();
      record = recordAttempt(record, {
        attempt: attemptNumber,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        testedCommit: options.fingerprints.sourceCommit,
        verdict: 'BLOCKED',
        behavioralObservations: [],
        startedAt: at,
        endedAt: at,
        durationMs: 0,
        exitCode: null,
        signal: null,
        reason: { ...blocked, kind: 'blocked' },
        runtimeVersions: { node: process.version, runner: options.fingerprints.runnerVersion },
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
      });
    } else {
      const startedAt = now().toISOString();
      const result = await options.execute(scenario, attemptNumber);
      const endedAt = now().toISOString();
      const classification = classify(result);
      record = recordAttempt(record, {
        attempt: attemptNumber,
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        testedCommit: options.fingerprints.sourceCommit,
        ...classification,
        behavioralObservations: result.behavioralObservations ?? [],
        startedAt,
        endedAt,
        durationMs: result.command.durationMs,
        exitCode: result.command.exitCode,
        signal: result.command.signal,
        runtimeVersions: result.runtimeVersions,
        artifactPaths: result.artifactPaths,
        logPaths: result.logPaths,
        retryCount: attemptNumber - 1,
        leakCheck: result.leakCheck,
        redaction: result.redaction,
      });
    }
    records.set(scenario.id, record);
    checkpoint = {
      ...checkpoint,
      updatedAt: now().toISOString(),
      scenarios: options.scenarios.map(definition => records.get(definition.id) ?? initialRecord(definition)),
    };
    await writeCheckpoint(options.checkpointPath, checkpoint);
  }
  return checkpoint;
}
