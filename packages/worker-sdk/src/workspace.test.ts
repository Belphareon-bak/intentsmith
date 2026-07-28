import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { assertNoTokenLeak, withGrant, type GrantIssuer } from './run-grant.js';
import {
  DEFAULT_DIFF_POLICY,
  WorkspacePolicyError,
  assertInsideWorkspace,
  evaluateDiffPolicy,
  findGeneratedSecrets,
  isEscapingSymlink,
  type ChangedPath,
} from './workspace.js';

/** Workspace confinement, diff policy and grant lifecycle. */

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-wsp-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const changed = (p: string, extra: Partial<ChangedPath> = {}): ChangedPath => ({
  path: p,
  status: 'modified',
  bytes: 100,
  ...extra,
});

describe('workspace confinement', () => {
  it('accepts a path inside the workspace', () => {
    const root = tempWorkspace();
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'a.js'), 'x');
    expect(assertInsideWorkspace('src/a.js', root)).toBe(path.join(root, 'src', 'a.js'));
  });

  it('accepts a file that does not exist yet', () => {
    const root = tempWorkspace();
    mkdirSync(path.join(root, 'src'));
    expect(assertInsideWorkspace('src/new.js', root)).toBe(path.join(root, 'src', 'new.js'));
  });

  it('rejects .. traversal', () => {
    const root = tempWorkspace();
    expect(() => assertInsideWorkspace('../escape.txt', root)).toThrow(WorkspacePolicyError);
  });

  it('rejects an absolute path outside the workspace', () => {
    const root = tempWorkspace();
    const outside = tempWorkspace();
    writeFileSync(path.join(outside, 'secret.txt'), 'x');
    expect(() => assertInsideWorkspace(path.join(outside, 'secret.txt'), root)).toThrow(WorkspacePolicyError);
  });

  it('rejects a symlink that escapes, despite a matching textual prefix', () => {
    const root = tempWorkspace();
    const outside = tempWorkspace();
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const link = path.join(root, 'looks-inside.txt');
    symlinkSync(path.join(outside, 'secret.txt'), link);

    // The name is inside the workspace; only canonicalization catches it.
    expect(link.startsWith(root)).toBe(true);
    expect(() => assertInsideWorkspace(link, root)).toThrow(WorkspacePolicyError);
    expect(isEscapingSymlink(link, root)).toBe(true);
  });

  it('accepts a symlink that stays inside', () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, 'real.txt'), 'ok');
    const link = path.join(root, 'link.txt');
    symlinkSync(path.join(root, 'real.txt'), link);
    expect(isEscapingSymlink(link, root)).toBe(false);
  });

  it('rejects a sibling directory sharing a prefix', () => {
    const parent = tempWorkspace();
    const workspace = path.join(parent, 'project');
    const sibling = path.join(parent, 'project2');
    mkdirSync(workspace);
    mkdirSync(sibling);
    writeFileSync(path.join(sibling, 'f.txt'), 'x');
    expect(() => assertInsideWorkspace(path.join(sibling, 'f.txt'), workspace)).toThrow(WorkspacePolicyError);
  });
});

describe('diff policy', () => {
  it('accepts a small change inside the allowed paths', () => {
    expect(evaluateDiffPolicy({ changedPaths: [changed('src/a.js'), changed('tests/a.test.js')] })).toEqual([]);
  });

  it('rejects a path outside the allowed prefixes', () => {
    const findings = evaluateDiffPolicy({ changedPaths: [changed('package.json')] });
    expect(findings.join(' ')).toContain('outside the allowed paths');
  });

  it('rejects any change under .git', () => {
    const findings = evaluateDiffPolicy({ changedPaths: [changed('.git/config'), changed('.git/hooks/pre-commit')] });
    expect(findings).toHaveLength(2);
    expect(findings.join(' ')).toContain('.git');
  });

  it('rejects a nested repository', () => {
    const findings = evaluateDiffPolicy({ changedPaths: [changed('src/vendor/.git/HEAD')] });
    expect(findings.join(' ')).toContain('nested repository');
  });

  it('rejects a submodule change', () => {
    const findings = evaluateDiffPolicy({ changedPaths: [changed('src/.gitmodules')] });
    expect(findings.join(' ')).toContain('submodule');
  });

  it('rejects a binary file unless explicitly allowed', () => {
    const entry = [changed('src/logo.png', { binary: true })];
    expect(evaluateDiffPolicy({ changedPaths: entry }).join(' ')).toContain('binary');
    expect(
      evaluateDiffPolicy({ changedPaths: entry }, { ...DEFAULT_DIFF_POLICY, allowBinary: true }),
    ).toEqual([]);
  });

  it('rejects too many files', () => {
    const many = Array.from({ length: 40 }, (_, index) => changed(`src/f${index}.js`));
    expect(evaluateDiffPolicy({ changedPaths: many }).join(' ')).toContain('above the limit');
  });

  it('rejects an oversized change', () => {
    const big = [changed('src/huge.js', { bytes: 10 * 1024 * 1024 })];
    expect(evaluateDiffPolicy({ changedPaths: big }).join(' ')).toContain('bytes, above the limit');
  });

  it('reports every violation rather than stopping at the first', () => {
    const findings = evaluateDiffPolicy({
      changedPaths: [changed('.git/config'), changed('package.json'), changed('src/x.png', { binary: true })],
    });
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });

  it('flags secret-shaped content a worker generated', () => {
    const findings = findGeneratedSecrets([
      { path: 'src/a.js', text: 'const k = "AKIAIOSFODNN7EXAMPLE";' },
      { path: 'src/b.js', text: '-----BEGIN RSA PRIVATE KEY-----' },
      { path: 'src/c.js', text: 'const clean = 1;' },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.join(' ')).toContain('AWS access key id');
    expect(findings.join(' ')).toContain('private key block');
  });
});

describe('grant lifecycle', () => {
  function tracker(): { issuer: GrantIssuer; live: Set<string> } {
    const live = new Set<string>();
    return {
      live,
      issuer: {
        issue: runId => {
          live.add(runId);
          return { baseUrl: 'http://127.0.0.1:1', token: `token-${runId}`, modelId: 'm' };
        },
        revoke: runId => live.delete(runId),
      },
    };
  }

  it('revokes on success', async () => {
    const { issuer, live } = tracker();
    await withGrant(issuer, 'r1', 't1', async () => undefined);
    expect(live.size).toBe(0);
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['timeout', 'timeout'],
    ['spawn_failed', 'spawn_failed'],
    ['plain failure', 'boom'],
  ])('revokes on %s', async (_label, reason) => {
    const { issuer, live } = tracker();
    await expect(
      withGrant(issuer, 'r1', 't1', async () => {
        throw Object.assign(new Error('failed'), { reason });
      }),
    ).rejects.toThrow('failed');
    expect(live.size).toBe(0);
  });

  it('classifies the outcome without swallowing the error', async () => {
    const { issuer } = tracker();
    const audits: string[] = [];
    await expect(
      withGrant(
        issuer,
        'r1',
        't1',
        async () => {
          throw Object.assign(new Error('original message'), { reason: 'timeout' });
        },
        { onAudit: audit => audits.push(audit.outcome) },
      ),
    ).rejects.toThrow('original message');
    expect(audits).toEqual(['timeout']);
  });

  it('classifies from an error code when no reason is present', async () => {
    const { issuer } = tracker();
    const audits: string[] = [];
    await expect(
      withGrant(
        issuer,
        'r1',
        't1',
        async () => {
          throw Object.assign(new Error('gone'), { code: 'REQUEST_CANCELLED' });
        },
        { onAudit: audit => audits.push(audit.outcome) },
      ),
    ).rejects.toThrow('gone');
    expect(audits).toEqual(['cancelled']);
  });

  it('falls back to a plain failure for an unrecognised error', async () => {
    const { issuer } = tracker();
    const audits: string[] = [];
    await expect(
      withGrant(issuer, 'r1', 't1', async () => {
        throw 'a bare string';
      }, { onAudit: audit => audits.push(audit.outcome) }),
    ).rejects.toBeDefined();
    expect(audits).toEqual(['failure']);
  });

  it('detects a token that leaked into a serializable value', () => {
    expect(() => assertNoTokenLeak({ note: 'contains secret-abc here' }, 'secret-abc')).toThrow(/leaked/);
    expect(() => assertNoTokenLeak('plain string with secret-abc', 'secret-abc')).toThrow(/leaked/);
    expect(() => assertNoTokenLeak({ note: 'clean' }, 'secret-abc')).not.toThrow();
    // An empty token cannot leak and must not produce a false positive.
    expect(() => assertNoTokenLeak({ note: 'anything' }, '')).not.toThrow();
    expect(() => assertNoTokenLeak(undefined, 'secret-abc')).not.toThrow();
  });

  it('never returns the grant to the caller', async () => {
    const { issuer } = tracker();
    // The callback receives it; the return value is whatever the work produced.
    const result = await withGrant(issuer, 'r1', 't1', async grant => grant.modelId);
    expect(result).toBe('m');
  });
});
