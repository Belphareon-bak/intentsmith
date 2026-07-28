import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_DIFF_POLICY,
  assertInsideWorkspace,
  evaluateDiffPolicy,
  sha256,
  type ChangedPath,
  type DiffPolicy,
  type ProposedChangeSet,
} from '@intentsmith/worker-sdk';

import type { GateCommandRunner, GateResult } from './gate-runner.js';
import { execFileGateRunner } from './gate-runner.js';

/**
 * Git-backed capture of what a worker actually changed.
 *
 * A worker's account of its own work is not evidence. This reads the truth out
 * of the disposable workspace's repository afterwards, with fixed `git`
 * argument vectors and no shell, so nothing a worker wrote can influence the
 * command that inspects it.
 *
 * Everything here is read-only. The index is never staged and no commit is
 * made: capturing evidence must not itself change the thing being measured.
 */

export type CaptureOptions = {
  workspaceRoot: string;
  policy?: DiffPolicy;
  /** Approval ids that authorized the writes, for the audit trail. */
  approvalIds?: string[];
  /** Results of the deterministic gates Core ran. */
  gates?: readonly GateResult[];
  runner?: GateCommandRunner;
  timeoutMs?: number;
  maxDiffBytes?: number;
};

export type CapturedChangeSet = ProposedChangeSet & {
  /** Approvals that authorized these writes. */
  approvalIds: string[];
  gateEvidence: Array<{ id: string; status: GateResult['status'] }>;
  /** Set when the capture itself could not run; never silently empty. */
  unavailableReason?: string;
};

const STATUS_BY_CODE: Record<string, ChangedPath['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'modified',
  C: 'added',
  '?': 'untracked',
};

async function git(
  runner: GateCommandRunner,
  workspaceRoot: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const result = await runner('git', args, {
    cwd: workspaceRoot,
    // A fixed, minimal environment: no worker-supplied variable can change how
    // git behaves, and no user configuration leaks into the evidence.
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    timeoutMs,
    maxOutputBytes,
  });
  return { code: result.code, stdout: result.stdout, stderr: result.stderr };
}

/** Splits `git status -z` output into (code, path) pairs. */
function parseStatus(output: string): Array<{ code: string; relativePath: string }> {
  const entries: Array<{ code: string; relativePath: string }> = [];
  const records = output.split('\0').filter(record => record.length > 0);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] as string;
    const code = record.slice(0, 2);
    const relativePath = record.slice(3);
    if (relativePath.length === 0) continue;
    entries.push({ code, relativePath });
    // A rename record is followed by its source path in the next NUL field.
    if (code.startsWith('R') || code.startsWith('C')) index += 1;
  }
  return entries;
}

function describeFile(absolutePath: string): { sha256?: string; bytes?: number; binary?: boolean } {
  try {
    const stats = statSync(absolutePath);
    if (!stats.isFile()) return {};
    const content = readFileSync(absolutePath);
    return {
      sha256: sha256(content),
      bytes: stats.size,
      // A NUL byte in the first block is the same heuristic git uses. It is a
      // heuristic, and it errs towards calling a file binary, which is the safe
      // direction: a binary blob is refused rather than reviewed as text.
      binary: content.subarray(0, 8000).includes(0),
    };
  } catch {
    return {};
  }
}

/**
 * Reads the workspace's current state as a proposed change set.
 *
 * Paths are canonicalized against the workspace root, so a symlink that leads
 * outside is caught by where it actually goes rather than by how its name
 * reads. Anything that escapes is recorded as a policy finding rather than
 * quietly dropped: a change nobody can see is worse than one that is refused.
 */
export async function captureProposedChanges(options: CaptureOptions): Promise<CapturedChangeSet> {
  const runner = options.runner ?? execFileGateRunner;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxDiffBytes = options.maxDiffBytes ?? 512 * 1024;
  const approvalIds = options.approvalIds ?? [];
  const gateEvidence = (options.gates ?? []).map(gate => ({ id: gate.id, status: gate.status }));

  const empty = (unavailableReason: string): CapturedChangeSet => ({
    baseCommit: 'unknown',
    workspaceRoot: options.workspaceRoot,
    changedPaths: [],
    additions: 0,
    deletions: 0,
    policyFindings: [],
    unresolvedRisks: [unavailableReason],
    approvalIds,
    gateEvidence,
    unavailableReason,
  });

  const head = await git(runner, options.workspaceRoot, ['rev-parse', 'HEAD'], timeoutMs, 4096);
  if (head.code !== 0) {
    // Without a base commit there is nothing to diff against, and reporting an
    // empty change set would read as "the worker changed nothing".
    return empty('Change capture could not read the workspace repository, so no diff evidence exists.');
  }
  const baseCommit = head.stdout.trim();

  const status = await git(
    runner,
    options.workspaceRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    timeoutMs,
    maxDiffBytes,
  );
  if (status.code !== 0) {
    return empty('Change capture could not list workspace changes, so no diff evidence exists.');
  }

  const policyFindings: string[] = [];
  const changedPaths: ChangedPath[] = [];

  for (const entry of parseStatus(status.stdout)) {
    const code = entry.code.trim().charAt(0) || entry.code.charAt(1);
    const changeStatus = STATUS_BY_CODE[code] ?? 'modified';

    let absolutePath: string;
    try {
      absolutePath = assertInsideWorkspace(entry.relativePath, options.workspaceRoot);
    } catch {
      policyFindings.push(`Worker changed "${entry.relativePath}", which resolves outside the disposable workspace.`);
      continue;
    }

    changedPaths.push({
      path: entry.relativePath,
      status: changeStatus,
      ...(changeStatus === 'deleted' ? {} : describeFile(absolutePath)),
    });
  }

  // Tracked modifications only. Untracked files are listed above with their own
  // digests; rendering their whole contents as a diff would let one large new
  // file blow the evidence budget.
  const diff = await git(
    runner,
    options.workspaceRoot,
    ['diff', '--no-color', '--numstat', 'HEAD', '--'],
    timeoutMs,
    maxDiffBytes,
  );
  let additions = 0;
  let deletions = 0;
  if (diff.code === 0) {
    for (const line of diff.stdout.split('\n')) {
      const [added, removed] = line.split('\t');
      if (added === undefined || removed === undefined) continue;
      // `-` marks a binary file, where line counts have no meaning.
      additions += Number.parseInt(added, 10) || 0;
      deletions += Number.parseInt(removed, 10) || 0;
    }
  }

  const patch = await git(
    runner,
    options.workspaceRoot,
    ['diff', '--no-color', 'HEAD', '--'],
    timeoutMs,
    maxDiffBytes,
  );

  policyFindings.push(...evaluateDiffPolicy({ changedPaths }, options.policy ?? DEFAULT_DIFF_POLICY));

  const unresolvedRisks: string[] = [];
  if (approvalIds.length === 0 && changedPaths.length > 0) {
    // Writes happen only after an approval, so files changed with no approval
    // recorded means the two records disagree. That is worth surfacing rather
    // than resolving in favour of whichever one is more convenient.
    unresolvedRisks.push('The workspace changed but no approval was recorded for the writes.');
  }

  return {
    baseCommit,
    workspaceRoot: options.workspaceRoot,
    changedPaths,
    additions,
    deletions,
    ...(patch.code === 0 && patch.stdout.length > 0
      ? {
          diffArtifact: {
            id: `diff-${baseCommit.slice(0, 12)}`,
            sha256: sha256(patch.stdout),
            bytes: Buffer.byteLength(patch.stdout, 'utf8'),
          },
        }
      : {}),
    policyFindings,
    unresolvedRisks,
    approvalIds,
    gateEvidence,
  };
}

/**
 * Whether a change set is good enough for a run to pass.
 *
 * A worker claiming success is not the question; this is. A policy violation, a
 * failed gate or a capture that could not run all mean the same thing — nobody
 * can show that what happened was acceptable — and that must not pass.
 */
export function isAcceptable(changeSet: CapturedChangeSet): boolean {
  return (
    changeSet.unavailableReason === undefined &&
    changeSet.policyFindings.length === 0 &&
    changeSet.gateEvidence.every(gate => gate.status === 'pass')
  );
}

/** Repo-relative paths, for evidence that does not leak absolute locations. */
export function relativePaths(changeSet: CapturedChangeSet): string[] {
  return changeSet.changedPaths.map(entry => entry.path.split(path.sep).join('/'));
}
