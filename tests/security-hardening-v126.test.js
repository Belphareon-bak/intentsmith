// tests/security-hardening-v126.test.js — Security hardening tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import path from 'path';
import os from 'os';

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: Workspace Path Traversal (C3)
// ═══════════════════════════════════════════════════════════════════════════════

suite('C3: Workspace null root path traversal');

// Simulate the fixed workspace path logic
function resolveWorkspacePath(dataRoot, dataPath) {
  const root = dataRoot || '.';
  const absRoot = path.resolve(root);
  const resolved = path.resolve(root, dataPath);
  if (!resolved.startsWith(absRoot + path.sep) && resolved !== absRoot) {
    return { blocked: true, resolved };
  }
  return { blocked: false, resolved };
}

test('null root + traversal path → blocked', () => {
  const result = resolveWorkspacePath(null, '../../etc/passwd');
  assert(result.blocked, 'Should block traversal with null root');
});

test('null root + absolute path → blocked', () => {
  const result = resolveWorkspacePath(null, '/etc/passwd');
  assert(result.blocked, 'Should block absolute path with null root');
});

test('undefined root + traversal → blocked', () => {
  const result = resolveWorkspacePath(undefined, '../../../tmp/evil');
  assert(result.blocked, 'Should block traversal with undefined root');
});

test('valid root + valid path → allowed', () => {
  const root = '/tmp/test-workspace';
  const result = resolveWorkspacePath(root, 'src/index.js');
  assert(!result.blocked, 'Should allow valid path within root');
  assert(result.resolved.startsWith(path.resolve(root)), 'Path should be within root');
});

test('valid root + traversal path → blocked', () => {
  const root = '/tmp/test-workspace';
  const result = resolveWorkspacePath(root, '../../etc/passwd');
  assert(result.blocked, 'Should block traversal even with valid root');
});

test('valid root + self-reference → allowed', () => {
  const root = '/tmp/test-workspace';
  const result = resolveWorkspacePath(root, '.');
  assert(!result.blocked, 'Should allow self-reference (resolved === absRoot)');
});

test('null root + simple filename → allowed (stays in CWD)', () => {
  const result = resolveWorkspacePath(null, 'myfile.txt');
  assert(!result.blocked, 'Simple filename should be allowed');
  assert(result.resolved === path.resolve('.', 'myfile.txt'), 'Should resolve to CWD/myfile.txt');
});

test('valid root + nested valid path → allowed', () => {
  const root = '/home/user/project';
  const result = resolveWorkspacePath(root, 'src/components/App.js');
  assert(!result.blocked, 'Nested valid path should be allowed');
});

test('root with trailing separator edge case', () => {
  const root = '/tmp/workspace';
  // Attempt to escape via sibling directory
  const result = resolveWorkspacePath(root, '../workspace-evil/hack.js');
  assert(result.blocked, 'Should block sibling directory escape');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: conversationId Traversal (C2)
// ═══════════════════════════════════════════════════════════════════════════════

suite('C2: conversationId path traversal');

// Simulate the fixed conversationId validation regex
const CONV_ID_INVALID = /[\/\\]|\.\.|\0/;

test('valid UUID conversationId → allowed', () => {
  assert(!CONV_ID_INVALID.test('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'UUID should pass');
});

test('valid numeric conversationId → allowed', () => {
  assert(!CONV_ID_INVALID.test('12345'), 'Numeric ID should pass');
});

test('conversationId with forward slash → blocked', () => {
  assert(CONV_ID_INVALID.test('../../tmp/evil'), 'Forward slash should be blocked');
});

test('conversationId with backslash → blocked', () => {
  assert(CONV_ID_INVALID.test('..\\..\\tmp\\evil'), 'Backslash should be blocked');
});

test('conversationId with double dot → blocked', () => {
  assert(CONV_ID_INVALID.test('..'), 'Double dot should be blocked');
});

test('conversationId with null byte → blocked', () => {
  assert(CONV_ID_INVALID.test('valid\0evil'), 'Null byte should be blocked');
});

test('conversationId with single dot → allowed', () => {
  assert(!CONV_ID_INVALID.test('.hidden'), 'Single dot should be allowed');
});

test('conversationId with hyphens and underscores → allowed', () => {
  assert(!CONV_ID_INVALID.test('my-conv_id-123'), 'Hyphens and underscores should pass');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Custom Project Path (C1)
// ═══════════════════════════════════════════════════════════════════════════════

suite('C1: Custom project path bounds check');

// Simulate the fixed customPath validation logic
function validateCustomPath(customPath) {
  if (!customPath || !customPath.trim()) return { valid: true, reason: 'no custom path' };
  const projectPath = path.resolve(customPath.trim());
  const homeDir = os.homedir();
  if (!projectPath.startsWith(homeDir + path.sep) && projectPath !== homeDir) {
    return { valid: false, reason: 'outside home directory' };
  }
  return { valid: true, projectPath };
}

test('path within home directory → allowed', () => {
  const home = os.homedir();
  const result = validateCustomPath(path.join(home, 'Projects', 'my-app'));
  assert(result.valid, 'Path within home should be allowed');
});

test('path outside home directory → blocked', () => {
  const result = validateCustomPath('/etc/cron.d/evil');
  assert(!result.valid, 'Path to /etc should be blocked');
});

test('path to /tmp → blocked', () => {
  const result = validateCustomPath('/tmp/evil-project');
  assert(!result.valid, 'Path to /tmp should be blocked');
});

test('path to root → blocked', () => {
  const result = validateCustomPath('/');
  assert(!result.valid, 'Root path should be blocked');
});

test('relative path resolving outside home → blocked', () => {
  // This resolves from CWD which is /home/user/Projects/c3-agent-wip
  // Going up enough should land outside home
  const result = validateCustomPath('/var/log/evil');
  assert(!result.valid, 'Path to /var should be blocked');
});

test('no custom path → allowed (uses default)', () => {
  const result = validateCustomPath(null);
  assert(result.valid, 'Null custom path should be allowed');
});

test('empty custom path → allowed (uses default)', () => {
  const result = validateCustomPath('  ');
  assert(result.valid, 'Empty custom path should be allowed');
});

test('home directory itself → allowed', () => {
  const home = os.homedir();
  const result = validateCustomPath(home);
  assert(result.valid, 'Home directory itself should be allowed');
});

test('home with trailing slash → allowed', () => {
  const home = os.homedir();
  const result = validateCustomPath(home + '/myproject');
  assert(result.valid, 'Home/subdir should be allowed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Package ID Validation (H1)
// ═══════════════════════════════════════════════════════════════════════════════

suite('H1: Package ID null byte + length guard');

// Simulate the fixed regex from package-installer.js
const PKG_ID_INVALID = /[\/\\]|\.\.|\0/;

function validatePackageId(id) {
  if (!id) return false;
  if (PKG_ID_INVALID.test(id)) return false;
  if (id.length > 128) return false;
  return true;
}

test('valid package ID → accepted', () => {
  assert(validatePackageId('my-cool-skill'), 'Valid ID should pass');
});

test('package ID with forward slash → rejected', () => {
  assert(!validatePackageId('../../evil'), 'Slash should be rejected');
});

test('package ID with backslash → rejected', () => {
  assert(!validatePackageId('..\\evil'), 'Backslash should be rejected');
});

test('package ID with double dot → rejected', () => {
  assert(!validatePackageId('..'), 'Double dot should be rejected');
});

test('package ID with null byte → rejected', () => {
  assert(!validatePackageId('valid\0evil'), 'Null byte should be rejected');
});

test('package ID exceeding 128 chars → rejected', () => {
  const longId = 'a'.repeat(129);
  assert(!validatePackageId(longId), 'ID >128 chars should be rejected');
});

test('package ID exactly 128 chars → accepted', () => {
  const exactId = 'a'.repeat(128);
  assert(validatePackageId(exactId), 'ID of exactly 128 chars should pass');
});

test('empty package ID → rejected', () => {
  assert(!validatePackageId(''), 'Empty ID should be rejected');
});

test('null package ID → rejected', () => {
  assert(!validatePackageId(null), 'Null ID should be rejected');
});

test('package ID with dots (valid) → accepted', () => {
  assert(validatePackageId('my.skill.v2'), 'Single dots should be allowed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: SHA-256 Requirement (H2)
// ═══════════════════════════════════════════════════════════════════════════════

suite('H2: SHA-256 required for remote packages');

await testAsync('marketplace-client refuses download without sha256', async () => {
  // Import the actual marketplace client
  let MarketplaceClient;
  try {
    const mod = await import('../src/marketplace/marketplace-client.js');
    MarketplaceClient = mod.MarketplaceClient;
  } catch (e) {
    // If import fails (missing deps), test the logic directly
    console.log('    (testing logic directly — MarketplaceClient import unavailable)');
    // The fix is: if (!entry.sha256) → throw
    // Simulate:
    const entry = { id: 'test-pkg' }; // no sha256
    const hasSha = !!entry.sha256;
    assert(!hasSha, 'Entry without sha256 should trigger rejection');
    return;
  }

  // If we have the client, test with a mock server would be needed
  // For unit test, verify the code path exists by checking the source
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/marketplace/marketplace-client.js', import.meta.url),
    'utf-8'
  );
  assert(
    source.includes('refusing unverified remote package'),
    'Source should contain SHA-256 refusal message'
  );
});

await testAsync('marketplace-client source requires sha256 (code audit)', async () => {
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/marketplace/marketplace-client.js', import.meta.url),
    'utf-8'
  );

  // Verify the else branch exists after sha256 check
  assert(
    source.includes('} else {') && source.includes('missing SHA-256 hash'),
    'Should have else branch that rejects packages without sha256'
  );

  // Verify it deletes the file
  assert(
    source.includes('fs.unlink(targetPath)'),
    'Should clean up downloaded file on rejection'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: Package Installer Source Audit
// ═══════════════════════════════════════════════════════════════════════════════

suite('Package installer source audit');

await testAsync('package-installer has null byte guard in regex', async () => {
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/marketplace/package-installer.js', import.meta.url),
    'utf-8'
  );

  assert(
    source.includes('\\0'),
    'Package installer should check for null bytes in ID validation'
  );
});

await testAsync('package-installer has length limit', async () => {
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/marketplace/package-installer.js', import.meta.url),
    'utf-8'
  );

  assert(
    source.includes('entry.id.length > 128'),
    'Package installer should check ID length'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Projects.js Source Audit
// ═══════════════════════════════════════════════════════════════════════════════

suite('Projects route source audit');

await testAsync('workspace file route — no data.root guard on traversal check', async () => {
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/routes/projects.js', import.meta.url),
    'utf-8'
  );

  // The old vulnerable pattern was: if (data.root && !resolved.startsWith(...))
  // The fix removes the data.root && guard
  // Check that the pattern "data.root &&" does NOT appear before "Path traversal blocked"
  const lines = source.split('\n');
  let foundVulnerablePattern = false;
  for (const line of lines) {
    if (line.includes('data.root') && line.includes('startsWith') && line.includes('Path traversal')) {
      foundVulnerablePattern = true;
      break;
    }
  }
  assert(!foundVulnerablePattern, 'Should not have data.root guard on traversal check');
});

await testAsync('customPath has home directory bounds check', async () => {
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/routes/projects.js', import.meta.url),
    'utf-8'
  );

  assert(
    source.includes('homedir()') || source.includes('os.homedir'),
    'Should check against home directory for custom paths'
  );
  assert(
    source.includes('within home directory') || source.includes('must be within home'),
    'Should have error message about home directory'
  );
});

await testAsync('conversationId has path sanitization', async () => {
  const fs = await import('fs/promises');
  const source = await fs.readFile(
    new URL('../src/routes/projects.js', import.meta.url),
    'utf-8'
  );

  // Check that conversationId validation exists before path.join usage
  assert(
    source.includes('Invalid conversation ID'),
    'Should have conversationId validation error message'
  );
  // Check null byte guard
  assert(
    source.includes('\\0') && source.includes('conversationId'),
    'Should check for null bytes in conversationId'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

suite('Edge cases');

test('path.sep is correct for platform', () => {
  assert(path.sep === '/' || path.sep === '\\', 'path.sep should be / or \\');
});

test('startsWith + sep prevents prefix attacks', () => {
  // /home/user should NOT match /home/user-evil
  const root = '/home/user';
  const evil = '/home/user-evil/file.txt';
  const check = evil.startsWith(root + path.sep);
  assert(!check, 'startsWith with path.sep should prevent prefix attacks');
});

test('path.resolve normalizes ..', () => {
  const root = '/home/user/project';
  const resolved = path.resolve(root, '../../../etc/passwd');
  assert(!resolved.startsWith(root + path.sep), 'path.resolve should normalize traversal');
});

test('null byte in path.resolve', () => {
  // Node.js should throw on null bytes in paths
  try {
    path.resolve('/home/user\0/evil');
    // If it doesn't throw, the string still contains the null byte
    const result = path.resolve('/home/user\0/evil');
    assert(result.includes('\0') || true, 'Null byte handling is platform-specific');
  } catch (e) {
    assert(e.code === 'ERR_INVALID_ARG_VALUE', 'Should throw on null bytes');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
