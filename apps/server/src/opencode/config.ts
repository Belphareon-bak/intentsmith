import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { GateDefinition } from '@intentsmith/process-runtime';

/**
 * Explicit worker selection and OpenCode configuration.
 *
 * Two properties matter here and both are about refusing to guess.
 *
 * The first is that selecting a worker is an operator decision, never an
 * inference from what happens to be installed. `INTENTSMITH_WORKER` names the
 * path; an unrecognized value is an error rather than a quiet fall back to the
 * fake, because a deployment that believes it is running OpenCode while a fake
 * decides its verdicts is worse than one that will not start.
 *
 * The second is that OpenCode is only usable when everything its authority
 * depends on is present: the binary, the pinned version, the Git workspace the
 * evidence is read from, the gates that decide the verdict and the model the
 * worker is allowed to reach. Any one of them missing means IntentSmith could
 * not tell an approved change from an unapproved one, so the configuration is
 * rejected as a whole instead of being partially honoured.
 */

export type WorkerSelection = 'fake' | 'opencode';

export const WORKER_SELECTION_ENV = 'INTENTSMITH_WORKER';

export class WorkerConfigError extends Error {
  readonly code = 'WORKER_CONFIG_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'WorkerConfigError';
  }
}

/**
 * Reads the selected worker.
 *
 * Unset means `fake`: the deterministic development path stays the default, and
 * an operator who wants a real agent has to say so.
 */
export function readWorkerSelection(env: NodeJS.ProcessEnv = process.env): WorkerSelection {
  const raw = env[WORKER_SELECTION_ENV];
  if (raw === undefined || raw === '') return 'fake';
  if (raw === 'fake' || raw === 'opencode') return raw;
  throw new WorkerConfigError(
    `${WORKER_SELECTION_ENV}="${raw}" is not a supported worker. Use "fake" or "opencode".`,
  );
}

export type OpenCodeConfig = {
  /** Resolved executable. Never a command string. */
  executable: string;
  /** Fixed arguments placed before the adapter's own `acp`. */
  args: string[];
  /** Version the operator pinned, for the mismatch check. */
  expectedVersion: string;
  /** Git repository the worker edits and the evidence is read from. */
  workspaceRoot: string;
  /** Model the worker may reach, through the gateway and nowhere else. */
  modelId: string;
  /** Gates Core runs to decide the verdict. The worker cannot influence them. */
  gates: GateDefinition[];
  /** Gate ids whose passing evidence a code change requires. */
  requiredGateIds: string[];
};

export const OPENCODE_ENV = {
  executable: 'INTENTSMITH_OPENCODE_EXECUTABLE',
  args: 'INTENTSMITH_OPENCODE_ARGS',
  version: 'INTENTSMITH_OPENCODE_VERSION',
  workspaceRoot: 'INTENTSMITH_WORKSPACE_ROOT',
  model: 'INTENTSMITH_OPENCODE_MODEL',
  gates: 'INTENTSMITH_OPENCODE_GATES',
} as const;

/**
 * Reads and validates everything the OpenCode path needs.
 *
 * Every problem is collected before anything is reported, so an operator fixes
 * the configuration once rather than discovering the next missing variable on
 * the next start.
 */
export function readOpenCodeConfig(env: NodeJS.ProcessEnv = process.env): OpenCodeConfig {
  const problems: string[] = [];

  const executable = requiredValue(env, OPENCODE_ENV.executable, problems);
  if (executable !== undefined) {
    if (!path.isAbsolute(executable)) {
      problems.push(`${OPENCODE_ENV.executable} must be an absolute path, not "${executable}".`);
    } else if (!isExecutableFile(executable)) {
      problems.push(
        `${OPENCODE_ENV.executable}="${executable}" is not an executable file. IntentSmith never installs OpenCode for you.`,
      );
    }
  }

  const expectedVersion = requiredValue(env, OPENCODE_ENV.version, problems);
  const modelId = requiredValue(env, OPENCODE_ENV.model, problems);

  const workspaceRoot = requiredValue(env, OPENCODE_ENV.workspaceRoot, problems);
  if (workspaceRoot !== undefined) {
    if (!path.isAbsolute(workspaceRoot)) {
      problems.push(`${OPENCODE_ENV.workspaceRoot} must be an absolute path, not "${workspaceRoot}".`);
    } else if (!isDirectory(workspaceRoot)) {
      problems.push(`${OPENCODE_ENV.workspaceRoot}="${workspaceRoot}" is not a directory.`);
    } else if (!isDirectory(path.join(workspaceRoot, '.git'))) {
      // Git is the only authoritative source of change evidence. Without a
      // repository there is nothing to compare a worker's claim against, so a
      // code task could only ever pass on the worker's own word.
      problems.push(
        `${OPENCODE_ENV.workspaceRoot}="${workspaceRoot}" is not a Git repository, so no authoritative change evidence can be collected.`,
      );
    }
  }

  const args = readArgs(env[OPENCODE_ENV.args], problems);
  const gates = readGates(env[OPENCODE_ENV.gates], problems);

  if (problems.length > 0) {
    throw new WorkerConfigError(
      `${WORKER_SELECTION_ENV}=opencode was selected but its configuration is unusable:\n- ${problems.join('\n- ')}`,
    );
  }

  return {
    executable: executable as string,
    args,
    expectedVersion: expectedVersion as string,
    workspaceRoot: workspaceRoot as string,
    modelId: modelId as string,
    gates,
    requiredGateIds: gates.map(gate => gate.id),
  };
}

function requiredValue(env: NodeJS.ProcessEnv, key: string, problems: string[]): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    problems.push(`${key} is required.`);
    return undefined;
  }
  return raw;
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function readArgs(raw: string | undefined, problems: string[]): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    problems.push(`${OPENCODE_ENV.args} must be a JSON array of strings.`);
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every(entry => typeof entry === 'string')) {
    problems.push(`${OPENCODE_ENV.args} must be a JSON array of strings.`);
    return [];
  }
  return parsed as string[];
}

/**
 * Loads the gate definitions from a file the operator controls.
 *
 * Gates come from IntentSmith's own configuration and are read once at startup,
 * so nothing a worker writes into the workspace during a run can add, remove or
 * rewrite the commands that judge it.
 */
function readGates(rawPath: string | undefined, problems: string[]): GateDefinition[] {
  if (rawPath === undefined || rawPath.trim() === '') {
    problems.push(`${OPENCODE_ENV.gates} is required: a code task cannot pass without gate evidence.`);
    return [];
  }
  if (!path.isAbsolute(rawPath)) {
    problems.push(`${OPENCODE_ENV.gates} must be an absolute path, not "${rawPath}".`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(rawPath, 'utf8'));
  } catch {
    problems.push(`${OPENCODE_ENV.gates}="${rawPath}" could not be read as JSON.`);
    return [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    problems.push(`${OPENCODE_ENV.gates}="${rawPath}" must contain a non-empty array of gate definitions.`);
    return [];
  }

  const gates: GateDefinition[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of parsed.entries()) {
    const gate = parseGate(entry, index, problems);
    if (!gate) continue;
    if (seen.has(gate.id)) {
      problems.push(`Gate id "${gate.id}" is defined more than once; gate evidence must be unambiguous.`);
      continue;
    }
    seen.add(gate.id);
    gates.push(gate);
  }
  return gates;
}

function parseGate(entry: unknown, index: number, problems: string[]): GateDefinition | undefined {
  const where = `Gate #${index}`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    problems.push(`${where} is not an object.`);
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const id = record.id;
  const description = record.description;
  const executable = record.executable;
  const args = record.args ?? [];
  const passExitCodes = record.passExitCodes;

  if (typeof id !== 'string' || id.trim() === '') {
    problems.push(`${where} needs a non-empty "id".`);
    return undefined;
  }
  if (typeof description !== 'string' || description.trim() === '') {
    problems.push(`Gate "${id}" needs a non-empty "description".`);
    return undefined;
  }
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) {
    // A bare name would be resolved through PATH, and a gate that can be
    // shadowed by something on the PATH is not a gate.
    problems.push(`Gate "${id}" needs an absolute "executable".`);
    return undefined;
  }
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) {
    problems.push(`Gate "${id}" needs "args" to be an array of strings.`);
    return undefined;
  }
  if (
    passExitCodes !== undefined &&
    (!Array.isArray(passExitCodes) || !passExitCodes.every(value => Number.isInteger(value)))
  ) {
    problems.push(`Gate "${id}" needs "passExitCodes" to be an array of integers.`);
    return undefined;
  }

  return {
    id,
    description,
    executable,
    args: args as string[],
    ...(passExitCodes === undefined ? {} : { passExitCodes: passExitCodes as number[] }),
  };
}
