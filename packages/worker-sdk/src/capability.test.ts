import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CAPABILITY_CATALOG,
  UNKNOWN_CAPABILITY_DESCRIPTOR,
  capabilityPayloadHash,
  describeCapability,
  evaluateCapabilityRequest,
  type CapabilityRequest,
} from './capability.js';

/**
 * Capability ledger and the Phase 3B tool policy.
 *
 * The tests that matter here are the refusals: a policy is only worth having if
 * it says no to the things it claims to say no to.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-cap-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1;\n');
  return root;
}

const request = (overrides: Partial<CapabilityRequest> & { toolName: string }): CapabilityRequest => ({
  actionId: 'action-1',
  resourcePaths: [],
  payload: {},
  ...overrides,
});

describe('capability classification', () => {
  it('classifies an unobserved tool as the worst case rather than guessing', () => {
    const descriptor = describeCapability('definitely-not-a-real-tool');
    expect(descriptor).toBe(UNKNOWN_CAPABILITY_DESCRIPTOR);
    expect(descriptor.requiresConfirmation).toBe('denied');
    expect(descriptor.destructive).toBe(true);
    expect(descriptor.sideEffects).toBe(true);
  });

  it('gives every catalogued tool a complete ledger entry', () => {
    for (const [name, descriptor] of Object.entries(CAPABILITY_CATALOG)) {
      expect(descriptor.id, name).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(descriptor.auditEvidence.length, name).toBeGreaterThan(0);
      expect(descriptor.rationale.length, name).toBeGreaterThan(0);
      // A side-effecting tool is never waved through on validation alone.
      if (descriptor.sideEffects) {
        expect(descriptor.requiresConfirmation, name).not.toBe('validated_only');
      }
    }
  });

  it('denies bash and webfetch in this phase', () => {
    expect(describeCapability('bash').requiresConfirmation).toBe('denied');
    expect(describeCapability('webfetch').requiresConfirmation).toBe('denied');
  });

  it('denies workflow tools whose real behaviour has not been observed', () => {
    for (const name of ['skill', 'task', 'todowrite']) {
      expect(describeCapability(name).requiresConfirmation, name).toBe('denied');
    }
  });
});

describe('capability policy', () => {
  it('allows a validated read without per-call approval', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'read', resourcePaths: ['src/app.ts'] }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('allow_validated');
    if (decision.outcome === 'allow_validated') {
      expect(decision.resolvedPaths).toEqual([path.join(root, 'src', 'app.ts')]);
    }
  });

  it('requires approval for an edit inside the workspace', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'edit', resourcePaths: ['src/app.ts'], payload: { diff: '@@' } }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('requires_approval');
  });

  it('denies a read that escapes the workspace', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'read', resourcePaths: ['../../etc/passwd'] }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') expect(decision.reason).toMatch(/outside the disposable workspace/);
  });

  it('denies a path that only escapes through a symlink', () => {
    const root = tempWorkspace();
    symlinkSync(tmpdir(), path.join(root, 'escape'));
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'write', resourcePaths: ['escape/elsewhere.txt'] }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('deny');
  });

  it('denies a bash request even when its command looks harmless', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'bash', command: 'echo hello', payload: { command: 'echo hello' } }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('deny');
  });

  it('denies a workspace action whose payload smuggles a command', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'edit', resourcePaths: ['src/app.ts'], command: 'rm -rf /' }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') expect(decision.reason).toMatch(/command or URL/);
  });

  it('denies a workspace action that names no resource', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(request({ toolName: 'edit' }), { workspaceRoot: root });
    expect(decision.outcome).toBe('deny');
    if (decision.outcome === 'deny') expect(decision.reason).toMatch(/no resource path/);
  });

  it('denies every path when one of several escapes', () => {
    const root = tempWorkspace();
    const decision = evaluateCapabilityRequest(
      request({ toolName: 'read', resourcePaths: ['src/app.ts', '/etc/passwd'] }),
      { workspaceRoot: root },
    );
    expect(decision.outcome).toBe('deny');
  });
});

describe('payload hashing', () => {
  const base = request({
    toolName: 'edit',
    resourcePaths: ['/ws/src/app.ts'],
    payload: { filepath: '/ws/src/app.ts', diff: '@@ -1 +1 @@' },
  });

  it('ignores object key order', () => {
    const reordered = request({
      toolName: 'edit',
      resourcePaths: ['/ws/src/app.ts'],
      payload: { diff: '@@ -1 +1 @@', filepath: '/ws/src/app.ts' },
    });
    expect(capabilityPayloadHash(reordered)).toBe(capabilityPayloadHash(base));
  });

  it('ignores which occurrence asked', () => {
    expect(capabilityPayloadHash({ ...base, actionId: 'action-99' })).toBe(capabilityPayloadHash(base));
  });

  it('changes when the diff changes', () => {
    const tampered = request({
      toolName: 'edit',
      resourcePaths: ['/ws/src/app.ts'],
      payload: { filepath: '/ws/src/app.ts', diff: '@@ -1 +9 @@' },
    });
    expect(capabilityPayloadHash(tampered)).not.toBe(capabilityPayloadHash(base));
  });

  it('changes when the target path changes', () => {
    const moved = request({
      toolName: 'edit',
      resourcePaths: ['/ws/src/other.ts'],
      payload: { filepath: '/ws/src/app.ts', diff: '@@ -1 +1 @@' },
    });
    expect(capabilityPayloadHash(moved)).not.toBe(capabilityPayloadHash(base));
  });

  it('distinguishes array order, which carries meaning', () => {
    const a = request({ toolName: 'read', resourcePaths: ['/ws/a.ts', '/ws/b.ts'] });
    const b = request({ toolName: 'read', resourcePaths: ['/ws/b.ts', '/ws/a.ts'] });
    expect(capabilityPayloadHash(a)).not.toBe(capabilityPayloadHash(b));
  });

  it('refuses a payload it cannot represent honestly', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => capabilityPayloadHash(request({ toolName: 'edit', payload: cyclic }))).toThrow(/cycle/);
    expect(() =>
      capabilityPayloadHash(request({ toolName: 'edit', payload: { size: Number.NaN } })),
    ).toThrow(/non-finite/);
  });
});
