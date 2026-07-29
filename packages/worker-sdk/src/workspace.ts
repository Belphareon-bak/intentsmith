import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Disposable workspace policy and proposed-change capture.
 *
 * A worker proposes; it does not commit. Everything it produced is collected,
 * bounded and checked against policy before Core will even consider it, and the
 * original project is never the thing being edited.
 */

export type ChangedPath = {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
  /** Absent for deletions. */
  sha256?: string;
  bytes?: number;
  binary?: boolean;
};

export type ApprovalEvidenceReference = {
  approvalId: string;
  actionId: string;
  payloadHash: string;
  resourcePaths: string[];
  /** Only a consumed single-use approval can corroborate a completed write. */
  state: 'consumed' | 'approved' | 'pending' | 'denied' | 'expired' | 'revoked';
};

export type GateEvidenceReference = {
  id: string;
  status: 'pass' | 'fail' | 'blocked';
  /** Stable link retained in the final audit event. */
  evidenceUri: string;
};

/**
 * Where a change set came from, in terms only IntentSmith can supply.
 *
 * Every field here is read out of IntentSmith's own state — the run record, the
 * adapter's sandbox probe, the profile the gateway applied, the audit rows it
 * wrote. None of it passes through the worker, so none of it can be shaped by
 * what the worker claims about itself.
 *
 * The purpose is to make a change set answerable after the fact. "This diff was
 * approved" is not reviewable unless one can also say which run produced it,
 * what confinement it ran under, which model was driving, and where the
 * structured evidence for each of those lives.
 */
export type ChangeProvenance = {
  runId: string;
  taskId: string;
  /**
   * Confinement the worker actually ran under, from the adapter's own probe.
   *
   * `level` is `degraded` or `unavailable` when the machine could not enforce a
   * sandbox. That is recorded rather than hidden: a change produced without
   * enforcement is still a fact a reviewer needs.
   */
  sandbox?: {
    kind: string;
    level: string;
    networkIsolated: boolean;
    attestationUri: string;
  };
  /** Settings a tool-calling turn actually ran with, not the ones requested. */
  inference?: {
    modelId: string;
    /** Phase 3 profiles stay PROVISIONAL; promotion is a separate decision. */
    profileStatus: string;
    role: string;
    maxOutputTokens: number;
    temperature: number;
    think?: boolean;
    toolProtocol: string;
    overruled: string[];
  };
  /** Audit ids of the structured lifecycle records this change set rests on. */
  evidenceRefs: {
    grantAuditIds: string[];
    inferenceProfileAuditIds: string[];
    protocolAttemptAuditIds: string[];
  };
};

export type ProposedChangeSet = {
  /** Workers never supply this value; Git capture is the only producer. */
  authoritativeSource: 'git';
  /** Trusted run facts. Absent means nobody can say which run produced this. */
  provenance?: ChangeProvenance;
  baseCommit: string;
  workspaceRoot: string;
  changedPaths: ChangedPath[];
  additions: number;
  deletions: number;
  /** Reference to the stored diff artifact. */
  diffArtifact?: { id: string; sha256: string; bytes: number };
  /** Digest of the Git-derived diff evidence, repeated for direct comparison. */
  diffDigest?: string;
  /** Untrusted digest the worker claimed, retained only to detect disagreement. */
  workerProposedDiffDigest?: string;
  approvalReferences: ApprovalEvidenceReference[];
  gateEvidence: GateEvidenceReference[];
  requiredGateIds: string[];
  changeRequired: boolean;
  policyFindings: string[];
  workerClaim?: { status: 'success' | 'failure'; summary: string };
  unresolvedRisks: string[];
};

export type DiffPolicy = {
  /** Paths a worker may change, as repo-relative prefixes. */
  allowedPathPrefixes: string[];
  maxChangedFiles: number;
  maxTotalBytes: number;
  allowBinary: boolean;
};

export const DEFAULT_DIFF_POLICY: DiffPolicy = {
  allowedPathPrefixes: ['src/', 'tests/', 'test/'],
  maxChangedFiles: 25,
  maxTotalBytes: 512 * 1024,
  allowBinary: false,
};

export class WorkspacePolicyError extends Error {
  readonly code = 'WORKSPACE_POLICY_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePolicyError';
  }
}

/**
 * Resolves a path and proves it stays inside the workspace.
 *
 * Canonicalizes first, so a symlink pointing outside is caught by where it
 * actually leads rather than by how its name reads. A textual prefix check
 * alone would accept `workspace/link -> /etc`.
 */
export function assertInsideWorkspace(candidate: string, workspaceRoot: string): string {
  const root = realpathSync(workspaceRoot);
  const resolved = path.resolve(root, candidate);

  let canonical: string;
  try {
    canonical = realpathSync(resolved);
  } catch {
    // A path that does not exist yet is judged by its canonical parent, so a
    // new file inside the workspace is still allowed.
    const parent = path.dirname(resolved);
    let canonicalParent: string;
    try {
      canonicalParent = realpathSync(parent);
    } catch {
      throw new WorkspacePolicyError(`Path "${candidate}" is not inside the workspace.`);
    }
    canonical = path.join(canonicalParent, path.basename(resolved));
  }

  const relative = path.relative(root, canonical);
  if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new WorkspacePolicyError(`Path "${candidate}" resolves outside the disposable workspace.`);
  }
  return canonical;
}

/** True when a workspace entry is a symlink that escapes the workspace. */
export function isEscapingSymlink(entryPath: string, workspaceRoot: string): boolean {
  try {
    if (!lstatSync(entryPath).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  try {
    assertInsideWorkspace(entryPath, workspaceRoot);
    return false;
  } catch {
    return true;
  }
}

export function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Applies diff policy to a change set.
 *
 * Returns findings rather than throwing, so Core sees the complete picture and
 * decides. A single violation should not hide the rest.
 */
export function evaluateDiffPolicy(
  changeSet: Pick<ProposedChangeSet, 'changedPaths'>,
  policy: DiffPolicy = DEFAULT_DIFF_POLICY,
): string[] {
  const findings: string[] = [];
  const changed = changeSet.changedPaths;

  if (changed.length > policy.maxChangedFiles) {
    findings.push(`Worker changed ${changed.length} files, above the limit of ${policy.maxChangedFiles}.`);
  }

  const totalBytes = changed.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  if (totalBytes > policy.maxTotalBytes) {
    findings.push(`Proposed change is ${totalBytes} bytes, above the limit of ${policy.maxTotalBytes}.`);
  }

  for (const entry of changed) {
    const normalized = entry.path.replace(/\\/g, '/');

    // `.git` is never a legitimate target: rewriting history or hooks would
    // let a worker escape review entirely.
    if (normalized === '.git' || normalized.startsWith('.git/')) {
      findings.push(`Worker attempted to modify "${entry.path}" inside .git.`);
      continue;
    }
    if (normalized.includes('/.git/') || normalized.endsWith('/.git')) {
      findings.push(`Worker attempted to modify a nested repository at "${entry.path}".`);
      continue;
    }
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      findings.push(`Worker proposed a path outside the workspace: "${entry.path}".`);
      continue;
    }
    if (entry.binary && !policy.allowBinary) {
      findings.push(`Worker proposed a binary file, which is not allowed: "${entry.path}".`);
      continue;
    }
    if (/\.gitmodules$/.test(normalized)) {
      findings.push(`Worker proposed a submodule change at "${entry.path}", which is unsupported.`);
      continue;
    }
    if (!policy.allowedPathPrefixes.some(prefix => normalized.startsWith(prefix))) {
      findings.push(
        `Worker changed "${entry.path}", which is outside the allowed paths (${policy.allowedPathPrefixes.join(', ')}).`,
      );
    }
  }

  return findings;
}

/** Looks for anything secret-shaped a worker may have written into the diff. */
export function findGeneratedSecrets(contents: Iterable<{ path: string; text: string }>): string[] {
  const patterns: Array<{ label: string; pattern: RegExp }> = [
    { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    { label: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { label: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { label: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  ];
  const findings: string[] = [];
  for (const file of contents) {
    for (const { label, pattern } of patterns) {
      if (pattern.test(file.text)) {
        findings.push(`Proposed change contains what looks like a ${label} in "${file.path}".`);
      }
    }
  }
  return findings;
}
