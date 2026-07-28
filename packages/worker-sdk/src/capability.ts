import { assertInsideWorkspace, sha256 } from './workspace.js';

/**
 * Vendor-neutral capability vocabulary for worker actions.
 *
 * An adapter translates its own transport into these types; Core sees nothing
 * else. Nothing here mentions ACP, OpenCode or any other worker: the point is
 * that Core's policy and audit stay meaningful when the worker changes.
 *
 * The attribute set follows the C3 Capability & Lifecycle Ledger. Phase 3
 * classifies only the tools actually observed on the wire; the ledger's full
 * tool set is deliberately not ported.
 */

export type CapabilityCategory =
  | 'filesystem_read'
  | 'filesystem_write'
  | 'process_execution'
  | 'network'
  | 'workflow'
  | 'unknown';

/** How a request is allowed to proceed. */
export type ConfirmationRequirement =
  /** No per-call approval; safe only after IntentSmith validates the resource. */
  | 'validated_only'
  /** A human decision is required for this specific call. */
  | 'approval_required'
  /** Never permitted in this phase, regardless of any decision. */
  | 'denied';

export type CapabilityDescriptor = {
  /** Stable IntentSmith name, not the worker's tool name. */
  id: string;
  category: CapabilityCategory;
  /** True when the action changes state outside IntentSmith. */
  sideEffects: boolean;
  /** True when repeating the same call has the same result. */
  idempotent: boolean;
  /** True when the action can destroy work that cannot be recovered. */
  destructive: boolean;
  requiresConfirmation: ConfirmationRequirement;
  /** Where the action is permitted to reach. */
  resourceScope: 'workspace' | 'process' | 'network' | 'none';
  /** True when the action must not run without an enforced sandbox. */
  requiresSandbox: boolean;
  /** What must be recorded for this action to be auditable after the fact. */
  auditEvidence: string[];
  /** Why this classification, in one line. Shown in policy explanations. */
  rationale: string;
};

/**
 * Classification of the tools observed from OpenCode 1.18.8.
 *
 * A name is not evidence of safety: anything whose real behaviour has not been
 * observed is denied rather than guessed at.
 */
export const CAPABILITY_CATALOG: Readonly<Record<string, CapabilityDescriptor>> = Object.freeze({
  read: {
    id: 'filesystem.read',
    category: 'filesystem_read',
    sideEffects: false,
    idempotent: true,
    destructive: false,
    requiresConfirmation: 'validated_only',
    resourceScope: 'workspace',
    requiresSandbox: false,
    auditEvidence: ['resolved_path'],
    rationale: 'Reads a file. Harmless once the path is proven to stay inside the workspace.',
  },
  glob: {
    id: 'filesystem.list',
    category: 'filesystem_read',
    sideEffects: false,
    idempotent: true,
    destructive: false,
    requiresConfirmation: 'validated_only',
    resourceScope: 'workspace',
    requiresSandbox: false,
    auditEvidence: ['resolved_path'],
    rationale: 'Lists paths. Same reasoning as read.',
  },
  grep: {
    id: 'filesystem.search',
    category: 'filesystem_read',
    sideEffects: false,
    idempotent: true,
    destructive: false,
    requiresConfirmation: 'validated_only',
    resourceScope: 'workspace',
    requiresSandbox: false,
    auditEvidence: ['resolved_path'],
    rationale: 'Searches file contents. Same reasoning as read.',
  },
  edit: {
    id: 'filesystem.edit',
    category: 'filesystem_write',
    sideEffects: true,
    idempotent: false,
    destructive: true,
    requiresConfirmation: 'approval_required',
    resourceScope: 'workspace',
    requiresSandbox: false,
    auditEvidence: ['resolved_path', 'diff_digest', 'approval_id'],
    rationale: 'Modifies a file in place; an edit can destroy existing content.',
  },
  write: {
    id: 'filesystem.write',
    category: 'filesystem_write',
    sideEffects: true,
    idempotent: false,
    destructive: true,
    requiresConfirmation: 'approval_required',
    resourceScope: 'workspace',
    requiresSandbox: false,
    auditEvidence: ['resolved_path', 'diff_digest', 'approval_id'],
    rationale: 'Creates or overwrites a file; overwriting destroys existing content.',
  },
  bash: {
    id: 'process.execute',
    category: 'process_execution',
    sideEffects: true,
    idempotent: false,
    destructive: true,
    requiresConfirmation: 'denied',
    resourceScope: 'process',
    requiresSandbox: true,
    auditEvidence: ['command', 'approval_id', 'sandbox_status'],
    rationale:
      'Arbitrary shell. The observed permission payload carries a command string but no resource locations, so a command cannot be bound to a workspace scope. Approving it would mean approving prose. IntentSmith runs its own deterministic gates instead.',
  },
  webfetch: {
    id: 'network.fetch',
    category: 'network',
    sideEffects: true,
    idempotent: false,
    destructive: false,
    requiresConfirmation: 'denied',
    resourceScope: 'network',
    requiresSandbox: true,
    auditEvidence: ['url', 'approval_id'],
    rationale: 'Outbound network. Denied in strict-local mode; no egress control is enforced.',
  },
  skill: {
    id: 'workflow.skill',
    category: 'workflow',
    sideEffects: true,
    idempotent: false,
    destructive: false,
    requiresConfirmation: 'denied',
    resourceScope: 'none',
    requiresSandbox: false,
    auditEvidence: ['approval_id'],
    rationale: 'Real behaviour and side effects not yet observed. A familiar name is not evidence.',
  },
  task: {
    id: 'workflow.task',
    category: 'workflow',
    sideEffects: true,
    idempotent: false,
    destructive: false,
    requiresConfirmation: 'denied',
    resourceScope: 'none',
    requiresSandbox: false,
    auditEvidence: ['approval_id'],
    rationale: 'May spawn further work with its own side effects; unobserved, so denied.',
  },
  todowrite: {
    id: 'workflow.todo',
    category: 'workflow',
    sideEffects: true,
    idempotent: false,
    destructive: false,
    requiresConfirmation: 'denied',
    resourceScope: 'none',
    requiresSandbox: false,
    auditEvidence: ['approval_id'],
    rationale: 'Writes somewhere IntentSmith has not observed; denied until classified.',
  },
});

/** Fallback for a tool IntentSmith has never seen. Always denied. */
export const UNKNOWN_CAPABILITY_DESCRIPTOR: CapabilityDescriptor = Object.freeze({
  id: 'unknown',
  category: 'unknown',
  sideEffects: true,
  idempotent: false,
  destructive: true,
  requiresConfirmation: 'denied',
  resourceScope: 'none',
  requiresSandbox: true,
  auditEvidence: ['approval_id'],
  rationale: 'Unclassified tool. Deny by default: an unknown action is assumed to be the worst case.',
});

export function describeCapability(toolName: string): CapabilityDescriptor {
  return CAPABILITY_CATALOG[toolName] ?? UNKNOWN_CAPABILITY_DESCRIPTOR;
}

/**
 * Vendor-neutral request Core evaluates.
 *
 * An adapter fills this in from its own protocol. `resourcePaths` are absolute
 * and already extracted from structured fields, never parsed out of a title.
 */
export type CapabilityRequest = {
  /** Worker's own tool name, kept for audit only. */
  toolName: string;
  /** Adapter-supplied identity for this specific call. */
  actionId: string;
  /** Absolute paths the action declares it will touch. */
  resourcePaths: string[];
  /** Shell command, when the action is process execution. */
  command?: string;
  /** URL, when the action is network access. */
  url?: string;
  /** Structured payload the adapter received, already redacted. */
  payload: Record<string, unknown>;
};

/**
 * What Core is being asked to do about a request.
 *
 * `deny` carries a reason because a denial the user cannot understand is a bug
 * report waiting to happen; the other two carry the paths that were proven to
 * stay inside the workspace, so no later step has to resolve them again.
 */
export type CapabilityDecision =
  | { outcome: 'allow_validated'; descriptor: CapabilityDescriptor; resolvedPaths: string[] }
  | { outcome: 'requires_approval'; descriptor: CapabilityDescriptor; resolvedPaths: string[] }
  | { outcome: 'deny'; descriptor: CapabilityDescriptor; reason: string };

export type CapabilityEvaluationOptions = {
  /** Absolute root the worker is confined to. */
  workspaceRoot: string;
};

/**
 * Applies the Phase 3B tool policy to one request.
 *
 * Deliberately total and deliberately boring: the decision depends on the
 * declared classification and on paths that have been canonicalized, never on
 * a title, a summary or any other prose the model produced. A tool whose
 * payload does not match its classification is denied rather than reinterpreted
 * — a mismatch means IntentSmith's model of the worker is wrong, and guessing
 * at that point is how a mediation layer becomes decorative.
 */
export function evaluateCapabilityRequest(
  request: CapabilityRequest,
  options: CapabilityEvaluationOptions,
): CapabilityDecision {
  const descriptor = describeCapability(request.toolName);

  if (descriptor.requiresConfirmation === 'denied') {
    return { outcome: 'deny', descriptor, reason: descriptor.rationale };
  }

  if (descriptor.resourceScope !== 'workspace') {
    // Every non-denied capability in this phase is workspace-scoped. Reaching
    // here means the catalog and this function disagree, so refuse instead of
    // inventing a policy for a scope nobody has written one for.
    return {
      outcome: 'deny',
      descriptor,
      reason: `Capability "${descriptor.id}" is not workspace-scoped and has no approval path in this phase.`,
    };
  }

  if (request.command !== undefined || request.url !== undefined) {
    return {
      outcome: 'deny',
      descriptor,
      reason: `Capability "${descriptor.id}" is classified as a workspace action but the request carries a command or URL.`,
    };
  }

  if (request.resourcePaths.length === 0) {
    // Without a resource there is nothing to confine and nothing meaningful to
    // approve: an approval that names no target cannot be checked afterwards.
    return {
      outcome: 'deny',
      descriptor,
      reason: `Capability "${descriptor.id}" declared no resource path, so it cannot be bound to the workspace.`,
    };
  }

  const resolvedPaths: string[] = [];
  for (const candidate of request.resourcePaths) {
    try {
      resolvedPaths.push(assertInsideWorkspace(candidate, options.workspaceRoot));
    } catch {
      return {
        outcome: 'deny',
        descriptor,
        reason: `Capability "${descriptor.id}" targets a path outside the disposable workspace.`,
      };
    }
  }

  return descriptor.requiresConfirmation === 'validated_only'
    ? { outcome: 'allow_validated', descriptor, resolvedPaths }
    : { outcome: 'requires_approval', descriptor, resolvedPaths };
}

/**
 * Canonical JSON with deterministically ordered object keys.
 *
 * Two payloads that differ only in key order are the same request, and an
 * approval must survive that. Array order is preserved because it carries
 * meaning. Anything not representable in JSON is rejected rather than coerced,
 * so a hash never silently stands for something other than what was approved.
 */
function canonicalize(value: unknown, seen: Set<object> = new Set()): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Capability payload contains a non-finite number.');
    }
    return value;
  }
  if (value === undefined) return undefined;
  if (typeof value !== 'object') {
    throw new TypeError(`Capability payload contains an unsupported ${typeof value} value.`);
  }
  if (seen.has(value as object)) {
    throw new TypeError('Capability payload contains a cycle.');
  }
  seen.add(value as object);
  try {
    if (Array.isArray(value)) return value.map(entry => canonicalize(entry, seen) ?? null);
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const canonical = canonicalize(source[key], seen);
      if (canonical !== undefined) result[key] = canonical;
    }
    return result;
  } finally {
    seen.delete(value as object);
  }
}

/**
 * Stable identity of *what* is being requested.
 *
 * An approval is bound to this hash, so approving one edit cannot silently
 * authorize a different one. `actionId` is intentionally excluded: it identifies
 * the occurrence, not the content, and Core scopes an approval by both.
 */
export function capabilityPayloadHash(request: CapabilityRequest): string {
  return sha256(
    JSON.stringify(
      canonicalize({
        toolName: request.toolName,
        resourcePaths: request.resourcePaths,
        command: request.command,
        url: request.url,
        payload: request.payload,
      }),
    ),
  );
}
