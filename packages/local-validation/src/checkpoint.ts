import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  RunCheckpoint,
  RunFingerprints,
  ScenarioAttempt,
  ScenarioRecord,
  ScenarioVerdict,
} from './types.js';
import { ValidationSafetyError } from './safety.js';

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isCheckpoint(value: unknown): value is RunCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RunCheckpoint>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.runId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    !!candidate.fingerprints &&
    typeof candidate.fingerprints.sourceCommit === 'string' &&
    typeof candidate.fingerprints.runnerVersion === 'string' &&
    typeof candidate.fingerprints.scenarioManifest === 'string' &&
    typeof candidate.fingerprints.modelProfile === 'string' &&
    typeof candidate.fingerprints.options === 'string' &&
    Array.isArray(candidate.scenarios) &&
    candidate.scenarios.every(
      scenario =>
        !!scenario &&
        typeof scenario === 'object' &&
        typeof (scenario as ScenarioRecord).id === 'string' &&
        typeof (scenario as ScenarioRecord).version === 'string' &&
        ['PENDING', 'COMPLETED', 'SKIPPED'].includes((scenario as ScenarioRecord).schedulerState) &&
        Array.isArray((scenario as ScenarioRecord).attempts) &&
        ((scenario as ScenarioRecord).deterministicVerdict === undefined ||
          ['PASS', 'FAIL', 'BLOCKED'].includes((scenario as ScenarioRecord).deterministicVerdict as string)),
    )
  );
}

export async function writeCheckpoint(path: string, checkpoint: RunCheckpoint): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function readCheckpoint(
  path: string,
  expected: RunFingerprints,
  options: { nowMs?: number; maxAgeMs?: number; runId?: string } = {},
): Promise<RunCheckpoint> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new ValidationSafetyError(
      'CHECKPOINT_CORRUPT',
      `Checkpoint cannot be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isCheckpoint(parsed)) {
    throw new ValidationSafetyError('CHECKPOINT_CORRUPT', 'Checkpoint does not match schema version 1.');
  }
  if (options.runId !== undefined && parsed.runId !== options.runId) {
    throw new ValidationSafetyError('CHECKPOINT_INCOMPATIBLE', 'Checkpoint run ID does not match.');
  }

  for (const key of Object.keys(expected) as Array<keyof RunFingerprints>) {
    if (parsed.fingerprints[key] !== expected[key]) {
      throw new ValidationSafetyError('CHECKPOINT_INCOMPATIBLE', `Checkpoint ${key} fingerprint does not match.`);
    }
  }

  const modified = (await stat(path)).mtimeMs;
  const now = options.nowMs ?? Date.now();
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (now - modified > maxAge) {
    throw new ValidationSafetyError('CHECKPOINT_STALE', `Checkpoint is older than the ${maxAge}ms resume window.`);
  }
  return parsed;
}

function aggregateVerdict(attempts: readonly ScenarioAttempt[]): ScenarioVerdict | undefined {
  if (attempts.some(attempt => attempt.verdict === 'FAIL')) return 'FAIL';
  const latest = attempts.at(-1);
  return latest?.verdict;
}

export function recordAttempt(record: ScenarioRecord, attempt: ScenarioAttempt): ScenarioRecord {
  if (attempt.scenarioId !== record.id || attempt.scenarioVersion !== record.version) {
    throw new ValidationSafetyError('SCENARIO_IDENTITY_MISMATCH', 'Attempt identity does not match its scenario.');
  }
  const attempts = [...record.attempts, attempt];
  return {
    ...record,
    schedulerState: 'COMPLETED',
    attempts,
    deterministicVerdict: aggregateVerdict(attempts),
  };
}

export function eligibleForResume(record: ScenarioRecord): boolean {
  if (record.schedulerState === 'SKIPPED') return true;
  return record.attempts.at(-1)?.verdict === 'BLOCKED';
}
