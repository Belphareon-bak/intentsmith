import { describe, expect, it } from 'vitest';

import {
  CapabilityEnvelopeSchema,
  ContractValidationError,
  CreateTaskInputSchema,
  WorkerEventSchema,
  parseWithSchema,
} from './index.js';

const validEnvelope = {
  fsReadRoots: ['/tmp/workspace'],
  fsWriteRoots: ['/tmp/workspace'],
  allowedCommandFamilies: [],
  deniedCommandPatterns: ['rm -rf'],
  network: { mode: 'disabled' as const, allowlist: [] },
  envAllowlist: ['PATH'],
  secrets: 'none' as const,
  processSpawning: 'disabled' as const,
  timeoutMs: 1000,
  maxActions: 0,
  approvalRules: [],
};

describe('runtime contracts', () => {
  it('accepts a valid task input', () => {
    const input = {
      projectId: 'project_1',
      type: 'code',
      goal: 'Run deterministic tests',
      scope: validEnvelope,
      expectedOutputs: ['test result'],
      acceptanceCriteria: ['tests pass'],
      workerScenario: 'success',
      timeoutMs: 1000,
    };

    expect(parseWithSchema(CreateTaskInputSchema, input)).toEqual(input);
  });

  it.each([
    ['missing required field', { ...validEnvelope, network: undefined }],
    ['unknown field', { ...validEnvelope, unexpected: true }],
    ['invalid enum', { ...validEnvelope, secrets: 'all' }],
    ['negative timeout', { ...validEnvelope, timeoutMs: -1 }],
    ['timeout over maximum', { ...validEnvelope, timeoutMs: 600_001 }],
    ['relative capability root', { ...validEnvelope, fsReadRoots: ['relative/path'] }],
  ])('rejects %s', (_name, payload) => {
    expect(() => parseWithSchema(CapabilityEnvelopeSchema, payload)).toThrow(ContractValidationError);
  });

  it('rejects schema-invalid worker events and unknown fields', () => {
    expect(() => parseWithSchema(WorkerEventSchema, {
      type: 'completed',
      claim: { status: 'success', summary: 'done' },
      unexpected: true,
    })).toThrow(ContractValidationError);
  });
});
