import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { TaskStatus } from '@intentsmith/contracts';
import { ContractValidationError } from '@intentsmith/contracts';

import { DomainError, normalizeError } from './errors.js';
import { ALLOWED_TRANSITIONS, assertTransition, canTransition } from './lifecycle.js';
import { assertPathInsideRoots, canonicalizeCapabilityEnvelope } from './path-policy.js';
import { decideVerdict } from './verdict.js';

describe('task lifecycle', () => {
  it('allows every declared transition', () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) {
        expect(canTransition(from as TaskStatus, to)).toBe(true);
        expect(() => assertTransition(from as TaskStatus, to)).not.toThrow();
      }
    }
  });

  it.each([
    ['pending', 'paused'],
    ['paused', 'passed'],
    ['cancelled', 'running'],
    ['passed', 'running'],
    ['failed', 'running'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TASK_TRANSITION' }),
    );
  });
});

describe('core verdict', () => {
  const base = {
    id: 'result_1',
    taskId: 'task_1',
    runId: 'run_1',
    now: '2026-07-27T00:00:00.000Z',
  };
  const evidence = {
    id: 'evidence_1',
    kind: 'test' as const,
    status: 'pass' as const,
    summary: 'deterministic test passed',
    producedAt: base.now,
  };

  it('passes only a successful claim backed by passing deterministic evidence', () => {
    const result = decideVerdict({
      ...base,
      workerClaim: { status: 'success', summary: 'done' },
      deterministicEvidence: [evidence],
    });
    expect(result.coreVerdict).toBe('pass');
  });

  it.each([
    ['success without evidence', { workerClaim: { status: 'success' as const, summary: 'done' }, deterministicEvidence: [] }],
    ['worker failure', { workerError: { code: 'WORKER_FAILED', message: 'failed', retryable: false }, deterministicEvidence: [] }],
    ['timeout', { timedOut: true, deterministicEvidence: [] }],
    ['invalid event', { invalidWorkerEvent: true, deterministicEvidence: [] }],
    ['failing evidence', { workerClaim: { status: 'success' as const, summary: 'done' }, deterministicEvidence: [{ ...evidence, status: 'fail' as const }] }],
  ])('fails on %s', (_name, input) => {
    expect(decideVerdict({ ...base, ...input }).coreVerdict).toBe('fail');
  });

  it('returns cancelled when core cancels the run', () => {
    expect(decideVerdict({ ...base, deterministicEvidence: [], cancelled: true }).coreVerdict).toBe('cancelled');
  });
});

describe('security and errors', () => {
  it('canonicalizes roots and rejects paths outside them', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-core-'));
    const child = path.join(root, 'child');
    mkdirSync(child);
    try {
      const envelope = canonicalizeCapabilityEnvelope({
        fsReadRoots: [child],
        fsWriteRoots: [child],
        allowedCommandFamilies: [],
        deniedCommandPatterns: [],
        network: { mode: 'disabled', allowlist: [] },
        envAllowlist: [],
        secrets: 'none',
        processSpawning: 'disabled',
        timeoutMs: 1000,
        maxActions: 0,
        approvalRules: [],
      });
      expect(envelope.fsReadRoots).toEqual([child]);
      expect(() => assertPathInsideRoots(root, envelope.fsReadRoots)).toThrowError(
        expect.objectContaining({ code: 'PATH_OUTSIDE_WORKSPACE' }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes unknown errors without exposing a stack', () => {
    expect(normalizeError(new Error('internal detail'))).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
      retryable: false,
    });
    expect(new DomainError('KNOWN', 'safe').toNormalizedError()).toEqual({
      code: 'KNOWN',
      message: 'safe',
      retryable: false,
      details: {},
    });
    expect(normalizeError(new ContractValidationError(['/ unknown field']))).toMatchObject({
      code: 'CONTRACT_VALIDATION_FAILED',
      retryable: false,
    });
  });
});
