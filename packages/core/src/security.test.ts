import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CapabilityEnvelopeSchema, ContractValidationError, parseWithSchema, type CapabilityEnvelope } from '@intentsmith/contracts';

import { assertPathInsideRoots, canonicalizeCapabilityEnvelope, canonicalizeExistingPath } from './path-policy.js';

/** Path confinement and capability envelope policy tests. */

/** Asserts a DomainError with the given code (the message is human text). */
function expectDomainError(fn: () => unknown, code: string): void {
  expect(fn).toThrowError(expect.objectContaining({ code }));
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempRoot(prefix = 'intentsmith-sec-'): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  // Resolve symlinked temp dirs (e.g. /tmp -> /private/tmp) up front.
  return canonicalizeExistingPath(root);
}

function envelope(overrides: Partial<CapabilityEnvelope> = {}): CapabilityEnvelope {
  const root = tempRoot();
  return {
    fsReadRoots: [root],
    fsWriteRoots: [root],
    allowedCommandFamilies: [],
    deniedCommandPatterns: [],
    network: { mode: 'disabled', allowlist: [] },
    envAllowlist: ['PATH'],
    secrets: 'none',
    processSpawning: 'disabled',
    timeoutMs: 1000,
    maxActions: 0,
    approvalRules: [],
    ...overrides,
  };
}

describe('path confinement', () => {
  it('rejects .. traversal out of the allowed root', () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    // Either the traversal resolves outside the root or the path does not exist.
    expect(() => assertPathInsideRoots(path.join(root, '..', path.basename(outside), 'secret.txt'), [root])).toThrow();
  });

  it('rejects an absolute path outside the write root', () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeFileSync(path.join(outside, 'file.txt'), 'x');
    expectDomainError(() => assertPathInsideRoots(path.join(outside, 'file.txt'), [root]), 'PATH_OUTSIDE_WORKSPACE');
  });

  it('rejects a sibling root sharing a textual prefix', () => {
    // `/workspace/project` must not authorise `/workspace/project2`.
    const parent = tempRoot();
    const project = path.join(parent, 'project');
    const sibling = path.join(parent, 'project2');
    mkdirSync(project);
    mkdirSync(sibling);
    writeFileSync(path.join(sibling, 'file.txt'), 'x');

    expectDomainError(() => assertPathInsideRoots(path.join(sibling, 'file.txt'), [project]), 'PATH_OUTSIDE_WORKSPACE');
    // The root itself and a real child stay allowed.
    expect(assertPathInsideRoots(project, [project])).toBe(project);
  });

  it('rejects a symlink that escapes the allowed root', () => {
    const root = tempRoot();
    const outside = tempRoot();
    const target = path.join(outside, 'secret.txt');
    writeFileSync(target, 'secret');
    const link = path.join(root, 'escape.txt');
    symlinkSync(target, link);

    // The link path is textually inside the root; only canonicalization catches it.
    expect(link.startsWith(root)).toBe(true);
    expectDomainError(() => assertPathInsideRoots(link, [root]), 'PATH_OUTSIDE_WORKSPACE');
  });

  it('rejects a symlinked directory that escapes the allowed root', () => {
    const root = tempRoot();
    const outside = tempRoot();
    mkdirSync(path.join(outside, 'data'));
    writeFileSync(path.join(outside, 'data', 'secret.txt'), 'secret');
    symlinkSync(path.join(outside, 'data'), path.join(root, 'data'));

    expectDomainError(() => assertPathInsideRoots(path.join(root, 'data', 'secret.txt'), [root]), 'PATH_OUTSIDE_WORKSPACE');
  });

  it('accepts a symlink that stays inside the allowed root', () => {
    const root = tempRoot();
    const target = path.join(root, 'real.txt');
    writeFileSync(target, 'ok');
    const link = path.join(root, 'link.txt');
    symlinkSync(target, link);
    expect(assertPathInsideRoots(link, [root])).toBe(target);
  });

  it('rejects a non-existent root', () => {
    expectDomainError(() => canonicalizeExistingPath(path.join(tempRoot(), 'does-not-exist')), 'INVALID_WORKSPACE_ROOT');
  });

  it('canonicalizes redundant path segments', () => {
    const root = tempRoot();
    mkdirSync(path.join(root, 'nested'));
    const messy = path.join(root, '.', 'nested', '..', 'nested', '.');
    expect(canonicalizeExistingPath(messy)).toBe(path.join(root, 'nested'));
  });
});

describe('capability envelope policy', () => {
  it('allows read access without granting write access', () => {
    const root = tempRoot();
    const canonical = canonicalizeCapabilityEnvelope(envelope({ fsReadRoots: [root], fsWriteRoots: [] }));
    expect(canonical.fsReadRoots).toEqual([root]);
    expect(canonical.fsWriteRoots).toEqual([]);
  });

  it('rejects a write root outside every read root', () => {
    const readRoot = tempRoot();
    const writeRoot = tempRoot();
    expectDomainError(
      () => canonicalizeCapabilityEnvelope(envelope({ fsReadRoots: [readRoot], fsWriteRoots: [writeRoot] })),
      'WRITE_ROOT_OUTSIDE_READ_ROOT',
    );
  });

  it('rejects a write root that only shares a textual prefix with a read root', () => {
    const parent = tempRoot();
    const readRoot = path.join(parent, 'project');
    const writeRoot = path.join(parent, 'project2');
    mkdirSync(readRoot);
    mkdirSync(writeRoot);
    expectDomainError(
      () => canonicalizeCapabilityEnvelope(envelope({ fsReadRoots: [readRoot], fsWriteRoots: [writeRoot] })),
      'WRITE_ROOT_OUTSIDE_READ_ROOT',
    );
  });

  it('rejects a write root reachable only through an escaping symlink', () => {
    const readRoot = tempRoot();
    const outside = tempRoot();
    mkdirSync(path.join(outside, 'writable'));
    symlinkSync(path.join(outside, 'writable'), path.join(readRoot, 'writable'));
    expectDomainError(
      () =>
        canonicalizeCapabilityEnvelope(
          envelope({ fsReadRoots: [readRoot], fsWriteRoots: [path.join(readRoot, 'writable')] }),
        ),
      'WRITE_ROOT_OUTSIDE_READ_ROOT',
    );
  });

  it('rejects a timeout below the minimum', () => {
    expect(() => parseWithSchema(CapabilityEnvelopeSchema, envelope({ timeoutMs: 9 }))).toThrow(
      ContractValidationError,
    );
  });

  it('rejects a timeout above the maximum', () => {
    expect(() => parseWithSchema(CapabilityEnvelopeSchema, envelope({ timeoutMs: 600_001 }))).toThrow(
      ContractValidationError,
    );
  });

  it.each([
    ['below', -1, false],
    ['at zero', 0, true],
    ['at the limit', 100, true],
    ['above the limit', 101, false],
  ])('validates maxActions %s', (_label, maxActions, valid) => {
    const check = () => parseWithSchema(CapabilityEnvelopeSchema, envelope({ maxActions }));
    if (valid) expect(check()).toBeDefined();
    else expect(check).toThrow(ContractValidationError);
  });

  it('rejects an unknown field in the capability envelope', () => {
    const withUnknown = { ...envelope(), shellAccess: true };
    expect(() => parseWithSchema(CapabilityEnvelopeSchema, withUnknown)).toThrow(ContractValidationError);
  });

  it('rejects a relative filesystem root', () => {
    expect(() => parseWithSchema(CapabilityEnvelopeSchema, envelope({ fsReadRoots: ['relative/path'] }))).toThrow(
      ContractValidationError,
    );
  });

  it('keeps the environment allowlist explicit', () => {
    const allowed = envelope({ envAllowlist: ['PATH', 'HOME'] });
    const parsed = parseWithSchema(CapabilityEnvelopeSchema, allowed);
    expect(parsed.envAllowlist).toEqual(['PATH', 'HOME']);
    // Keys outside the allowlist are simply absent; there is no wildcard form.
    expect(parsed.envAllowlist).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(parsed.envAllowlist).not.toContain('*');
  });

  it('defaults network access to disabled and requires an explicit allowlist mode', () => {
    const parsed = parseWithSchema(CapabilityEnvelopeSchema, envelope());
    expect(parsed.network.mode).toBe('disabled');
    expect(parsed.network.allowlist).toEqual([]);
    expect(() =>
      parseWithSchema(
        CapabilityEnvelopeSchema,
        envelope({ network: { mode: 'everything', allowlist: [] } as unknown as CapabilityEnvelope['network'] }),
      ),
    ).toThrow(ContractValidationError);
  });

  it('keeps secrets and process spawning closed by default', () => {
    const parsed = parseWithSchema(CapabilityEnvelopeSchema, envelope());
    expect(parsed.secrets).toBe('none');
    expect(parsed.processSpawning).toBe('disabled');
  });
});
