import type { AuditEvent } from '@intentsmith/contracts';
import type { AuditRepository, Clock, IdGenerator } from '@intentsmith/core';
import type { EffectiveInferenceSettings } from '@intentsmith/inference';
import type { SandboxStatus } from '@intentsmith/process-runtime';
import type { GrantAudit } from '@intentsmith/worker-sdk';

import type { ToolProtocolAttemptAudit } from '../gateway/protocol-retry.js';

/**
 * Durable Phase 3 lifecycle evidence.
 *
 * The grant lifecycle, the inference profile a turn actually ran with and the
 * bounded tool-protocol attempt ledger were all produced correctly and then
 * handed to a callback that production never installed. A fact that reaches
 * only a callback is not evidence: it dies with the process, and the audit trail
 * afterwards cannot answer what the run was permitted to do, which model
 * decided, or whether a retry was allowed.
 *
 * This is the sink that makes them durable. Three rules shape it:
 *
 *  - **Structured only.** Every record is a fixed set of named fields. Nothing
 *    here stringifies a callback argument, dumps an object, or copies a payload
 *    it did not name. Prompts, model responses, tool arguments, wire messages,
 *    authorization headers and gateway tokens have no field to land in, which is
 *    a stronger guarantee than redacting them would be.
 *  - **Ordered, and attributed.** Appends are serialized through one chain, so
 *    the audit order is the order things happened. Every record carries the run
 *    it belongs to and the task that run serves.
 *  - **Fail closed.** Security evidence that could not be written is not
 *    discarded quietly. The failure is remembered against the run, and the
 *    change-evidence collector turns it into a finding, so a run whose evidence
 *    is incomplete cannot pass.
 */

export type RunEvidenceOptions = {
  audit: AuditRepository;
  clock: Clock;
  ids: IdGenerator;
};

type RunFacts = {
  taskId: string;
  /** Reads the sandbox attestation of this run's own adapter instance. */
  sandbox: () => SandboxStatus | undefined;
  /** Audit ids of the records written for this run, newest last. */
  grantAuditIds: string[];
  inferenceProfileAuditIds: string[];
  protocolAttemptAuditIds: string[];
  /** Last effective settings a tool-calling turn actually ran with. */
  inference?: EffectiveInferenceSettings;
  processStartedPid?: number;
  /** Evidence that could not be persisted. Non-empty means the run cannot pass. */
  auditFailures: string[];
};

/** What a run's trusted provenance is built from, once the run has ended. */
export type RunProvenance = {
  runId: string;
  taskId: string;
  sandbox?: { kind: string; level: string; networkIsolated: boolean; attestationUri: string };
  inference?: EffectiveInferenceSettings;
  evidenceRefs: {
    grantAuditIds: string[];
    inferenceProfileAuditIds: string[];
    protocolAttemptAuditIds: string[];
  };
  auditFailures: string[];
};

export class RunEvidenceRecorder {
  private readonly runs = new Map<string, RunFacts>();
  /** Serializes appends so audit order is the order things happened. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RunEvidenceOptions) {}

  /**
   * Registers a run before it can produce any evidence.
   *
   * The task id comes from the execution context rather than from whatever
   * later reports a fact, so a record can never be attributed to a task the
   * caller merely claimed.
   */
  beginRun(runId: string, taskId: string, sandbox: () => SandboxStatus | undefined): void {
    this.runs.set(runId, {
      taskId,
      sandbox,
      grantAuditIds: [],
      inferenceProfileAuditIds: [],
      protocolAttemptAuditIds: [],
      auditFailures: [],
    });
  }

  /** The supervised process-group leader. A pid, and deliberately nothing else. */
  processStarted(runId: string, pid: number): void {
    const facts = this.runs.get(runId);
    if (!facts) return;
    facts.processStartedPid = pid;
    this.append(runId, 'worker.process_start', `Worker process ${pid} started.`, { pid });
  }

  /**
   * The run-scoped grant's issue and revocation.
   *
   * `GrantAudit` carries no secret by construction; the assertion below is kept
   * as a live guard rather than a comment, because this is the one record whose
   * whole point is a token's lifetime.
   */
  grantSettled(audit: GrantAudit): void {
    const facts = this.runs.get(audit.runId);
    if (!facts) return;
    const data = {
      outcome: audit.outcome,
      revoked: audit.revoked,
      issuedAt: audit.issuedAt,
      revokedAt: audit.revokedAt,
    };
    this.append(audit.runId, 'security.grant', `Run grant ${audit.outcome}; revoked=${audit.revoked}.`, data);
  }

  /** The profile a tool-calling turn actually ran with, not the one requested. */
  inferenceProfile(runId: string, settings: EffectiveInferenceSettings): void {
    const facts = this.runs.get(runId);
    if (!facts) return;
    facts.inference = settings;
    this.append(runId, 'inference.profile', `Inference ran under profile for ${settings.modelId}.`, {
      modelId: settings.modelId,
      profileStatus: settings.profileStatus,
      role: settings.role,
      maxOutputTokens: settings.maxOutputTokens,
      temperature: settings.temperature,
      ...(settings.think === undefined ? {} : { think: settings.think }),
      toolProtocol: settings.toolProtocol,
      overruled: settings.overruled,
    });
  }

  /** One entry of the bounded MODEL_TOOL_PROTOCOL_ERROR attempt ledger. */
  protocolAttempt(attempt: ToolProtocolAttemptAudit): void {
    const facts = this.runs.get(attempt.runId);
    if (!facts) return;
    this.append(
      attempt.runId,
      'inference.protocol_attempt',
      `Tool protocol attempt ${attempt.attempt}: ${attempt.outcome}, retry ${attempt.retryDecision}.`,
      {
        attempt: attempt.attempt,
        outcome: attempt.outcome,
        ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
        sideEffectEvidence: attempt.sideEffectEvidence,
        retryDecision: attempt.retryDecision,
        // The decision's own reason, produced by `decideToolProtocolRetry`.
        // It is IntentSmith's text about IntentSmith's rule; no model output
        // and no request content reaches it.
        reason: attempt.reason,
      },
    );
  }

  /** Waits for everything queued for a run to have been written. */
  async flush(): Promise<void> {
    await this.queue;
  }

  /** The trusted facts a change set may cite. Undefined for an unknown run. */
  provenanceFor(runId: string): RunProvenance | undefined {
    const facts = this.runs.get(runId);
    if (!facts) return undefined;
    const sandbox = facts.sandbox();
    return {
      runId,
      taskId: facts.taskId,
      ...(sandbox
        ? {
            sandbox: {
              kind: sandbox.kind,
              level: sandbox.level,
              networkIsolated: sandbox.networkIsolated,
              attestationUri: `intentsmith://sandbox/${sandbox.kind}/${sandbox.level}`,
            },
          }
        : {}),
      ...(facts.inference ? { inference: facts.inference } : {}),
      evidenceRefs: {
        grantAuditIds: [...facts.grantAuditIds],
        inferenceProfileAuditIds: [...facts.inferenceProfileAuditIds],
        protocolAttemptAuditIds: [...facts.protocolAttemptAuditIds],
      },
      auditFailures: [...facts.auditFailures],
    };
  }

  /** Drops a finished run's facts once its evidence has been collected. */
  endRun(runId: string): void {
    this.runs.delete(runId);
  }

  private append(runId: string, type: AuditEvent['type'], message: string, data: Record<string, unknown>): void {
    const facts = this.runs.get(runId);
    if (!facts) return;
    const event: AuditEvent = {
      id: this.options.ids.next('audit'),
      taskId: facts.taskId,
      runId,
      type,
      message,
      data,
      createdAt: this.options.clock.now(),
    };
    referenceList(facts, type)?.push(event.id);

    this.queue = this.queue.then(async () => {
      try {
        assertStructuredMetadata(event.data);
        await this.options.audit.append(event);
      } catch (error) {
        // Never swallowed. A run whose security evidence is incomplete is a run
        // nobody can review, and the collector refuses to let it pass.
        facts.auditFailures.push(
          `${type} evidence could not be persisted: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    });
  }
}

/** Longest a single structured field may be. Well under any transcript. */
const MAX_FIELD_CHARS = 500;

/**
 * Refuses anything that is not bounded structured metadata.
 *
 * This is the enforcement behind "no generic dumping". A nested object, a
 * function, or an oversized string is exactly what an accidental
 * `JSON.stringify(callbackArgument)` looks like, and each is refused at the
 * write rather than reviewed later — by which time it is already persisted.
 */
export function assertStructuredMetadata(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number' || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > MAX_FIELD_CHARS) {
        throw new Error(`Audit field "${key}" is longer than ${MAX_FIELD_CHARS} characters.`);
      }
      continue;
    }
    if (
      Array.isArray(value) &&
      value.every(entry => typeof entry === 'string' && entry.length <= MAX_FIELD_CHARS)
    ) {
      continue;
    }
    throw new Error(`Audit field "${key}" is not bounded structured metadata.`);
  }
}

function referenceList(facts: RunFacts, type: AuditEvent['type']): string[] | undefined {
  if (type === 'security.grant') return facts.grantAuditIds;
  if (type === 'inference.profile') return facts.inferenceProfileAuditIds;
  if (type === 'inference.protocol_attempt') return facts.protocolAttemptAuditIds;
  return undefined;
}
