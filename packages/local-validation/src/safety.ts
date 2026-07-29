import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

const SAFE_RUN_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;

export class ValidationSafetyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ValidationSafetyError';
  }
}

export function assertSafeRunId(runId: string): void {
  if (!SAFE_RUN_ID.test(runId)) {
    throw new ValidationSafetyError(
      'UNSAFE_RUN_ID',
      'Run IDs must be 1-64 lowercase alphanumeric, underscore or hyphen characters and start alphanumeric.',
    );
  }
}

export function assertExactCommit(commit: string): void {
  if (!COMMIT.test(commit)) {
    throw new ValidationSafetyError('SOURCE_NOT_IMMUTABLE', 'The source revision must be an exact 40-character SHA.');
  }
}

export function assertPathInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new ValidationSafetyError('PATH_OUTSIDE_MANAGED_ROOT', `${resolvedCandidate} is outside ${resolvedRoot}.`);
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function managedRunPaths(root: string, runId: string): {
  runRoot: string;
  workspace: string;
  isolatedHome: string;
  xdg: Record<'config' | 'data' | 'cache' | 'state', string>;
  checkpoint: string;
  artifact: string;
  markdown: string;
  lock: string;
} {
  assertSafeRunId(runId);
  const runRoot = resolve(root, runId);
  assertPathInside(root, runRoot);
  const isolatedHome = resolve(runRoot, 'environment', 'home');
  return {
    runRoot,
    workspace: resolve(runRoot, 'workspace'),
    isolatedHome,
    xdg: {
      config: resolve(isolatedHome, 'config'),
      data: resolve(isolatedHome, 'data'),
      cache: resolve(isolatedHome, 'cache'),
      state: resolve(isolatedHome, 'state'),
    },
    checkpoint: resolve(runRoot, 'checkpoint.json'),
    artifact: resolve(runRoot, 'result.json'),
    markdown: resolve(runRoot, 'result.md'),
    lock: resolve(root, '.runner.lock'),
  };
}
