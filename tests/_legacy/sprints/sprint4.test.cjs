/**
 * Sprint 4 Tests — Diff, ChangeSet, Review Pipeline, Git
 * No external dependencies.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DiffService, GitService, parseDiffStats, calculateSetStatus, applyUnifiedDiff, atomicWrite, atomicWriteJson } = require('../packages/c3-backend/sprint4-integration.cjs');

let testCount = 0, passCount = 0;
function test(name, fn) { testCount++; try { fn(); passCount++; console.log('  ✅ ' + name); } catch (e) { console.log('  ❌ ' + name + ': ' + e.message); } }
async function asyncTest(name, fn) { testCount++; try { await fn(); passCount++; console.log('  ✅ ' + name); } catch (e) { console.log('  ❌ ' + name + ': ' + e.message); } }

// ── 1. Diff Parsing ──────────────────────────────────────
console.log('\n--- 1. Diff Parsing ---');

test('parse additions', () => {
  const s = parseDiffStats('--- a/f\n+++ b/f\n@@ -1,3 +1,5 @@\n a\n+b\n+c\n d');
  assert.strictEqual(s.additions, 2);
  assert.strictEqual(s.deletions, 0);
  assert.strictEqual(s.isNew, false);
});

test('parse mixed', () => {
  const s = parseDiffStats('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new\n+extra');
  assert.strictEqual(s.additions, 2);
  assert.strictEqual(s.deletions, 1);
});

test('parse new file', () => {
  const s = parseDiffStats('--- /dev/null\n+++ b/f\n@@ -0,0 +1,2 @@\n+a\n+b');
  assert.strictEqual(s.isNew, true);
  assert.strictEqual(s.additions, 2);
});

test('parse deleted file', () => {
  const s = parseDiffStats('--- a/f\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b');
  assert.strictEqual(s.isDelete, true);
  assert.strictEqual(s.deletions, 2);
});

test('parse empty diff', () => {
  const s = parseDiffStats('');
  assert.strictEqual(s.additions, 0);
  assert.strictEqual(s.deletions, 0);
});

// ── 2. Diff Application ─────────────────────────────────
console.log('\n--- 2. Diff Application ---');

test('apply addition', () => {
  const r = applyUnifiedDiff('line1\nline2\nline3',
    '--- a/f\n+++ b/f\n@@ -1,3 +1,4 @@\n line1\n+inserted\n line2\n line3');
  assert.strictEqual(r, 'line1\ninserted\nline2\nline3');
});

test('apply deletion', () => {
  const r = applyUnifiedDiff('line1\nline2\nline3',
    '--- a/f\n+++ b/f\n@@ -1,3 +1,2 @@\n line1\n-line2\n line3');
  assert.strictEqual(r, 'line1\nline3');
});

test('apply replacement', () => {
  const r = applyUnifiedDiff('a\nb\nc',
    '--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c');
  assert.strictEqual(r, 'a\nB\nc');
});

test('apply to empty (new file)', () => {
  const r = applyUnifiedDiff('',
    '--- /dev/null\n+++ b/f\n@@ -0,0 +1,2 @@\n+hello\n+world');
  assert.ok(r.startsWith('hello\nworld'));
});

// ── 3. ChangeSet Status ──────────────────────────────────
console.log('\n--- 3. ChangeSet Status ---');

test('all pending → pending', () => {
  assert.strictEqual(calculateSetStatus([{status:'pending'},{status:'pending'}]), 'pending');
});
test('mixed pending → pending', () => {
  assert.strictEqual(calculateSetStatus([{status:'accepted'},{status:'pending'}]), 'pending');
});
test('all rejected → all_rejected', () => {
  assert.strictEqual(calculateSetStatus([{status:'rejected'},{status:'rejected'}]), 'all_rejected');
});
test('all accepted → all_accepted', () => {
  assert.strictEqual(calculateSetStatus([{status:'accepted'},{status:'edited'}]), 'all_accepted');
});
test('mixed results → reviewed', () => {
  assert.strictEqual(calculateSetStatus([{status:'accepted'},{status:'rejected'}]), 'reviewed');
});

// ── 4. Commit Message ────────────────────────────────────
console.log('\n--- 4. Commit Messages ---');

test('standard message format', () => {
  const subject = 'feat(vpn): Add WireGuard tunnel';
  const body = '\nC3 Agent — Sprint 1, Step 3\n\n- Added VPN\n- Added tests\n\nIntent: BUILD\nProject: App';
  assert.ok(subject.startsWith('feat('));
  assert.ok(body.includes('Sprint 1'));
  assert.ok(body.includes('Intent: BUILD'));
});

test('fallback subject', () => {
  const ctx = { sprintNumber: 2 };
  const subject = ctx.subject || 'feat: C3 Sprint ' + ctx.sprintNumber + ' changes';
  assert.strictEqual(subject, 'feat: C3 Sprint 2 changes');
});

// ── 5. DiffService Lifecycle (async) ─────────────────────
async function runAsync() {
  console.log('\n--- 5. DiffService Lifecycle ---');
  const testDir = path.join(os.tmpdir(), 'c3-s4-test-' + Date.now());
  await fs.promises.mkdir(path.join(testDir, 'lib'), { recursive: true });
  await fs.promises.writeFile(path.join(testDir, 'lib', 'main.dart'), 'void main() {\n  print("hello");\n}\n');
  const ds = new DiffService(testDir);

  await asyncTest('create change set', async () => {
    const cs = await ds.createChangeSet('Sprint 1', [
      { filePath: 'lib/main.dart', description: 'Add greeting',
        diff: '--- a/lib/main.dart\n+++ b/lib/main.dart\n@@ -1,3 +1,4 @@\n void main() {\n+  print("greetings");\n   print("hello");\n }',
        modifiedContent: 'void main() {\n  print("greetings");\n  print("hello");\n}\n' },
      { filePath: 'lib/vpn.dart', description: 'New VPN', diff: '+class Vpn {}',
        modifiedContent: 'class Vpn {}\n',
        stats: { additions: 1, deletions: 0, isNew: true, isDelete: false } },
    ], { sprintNumber: 1, stepNumber: 1, intent: 'BUILD', summary: '', details: [] });
    assert.strictEqual(cs.proposals.length, 2);
    assert.strictEqual(cs.status, 'pending');
  });

  await asyncTest('load change set', async () => {
    const cs = await ds.loadChangeSet();
    assert.ok(cs);
    assert.strictEqual(cs.proposals.length, 2);
  });

  await asyncTest('accept first proposal', async () => {
    const cs = await ds.loadChangeSet();
    const updated = await ds.updateProposalStatus(cs.proposals[0].id, 'accepted');
    assert.strictEqual(updated.proposals[0].status, 'accepted');
    assert.strictEqual(updated.status, 'pending');
  });

  await asyncTest('accept second → all_accepted', async () => {
    const cs = await ds.loadChangeSet();
    const updated = await ds.updateProposalStatus(cs.proposals[1].id, 'accepted');
    assert.strictEqual(updated.status, 'all_accepted');
  });

  await asyncTest('apply accepted', async () => {
    const r = await ds.applyAccepted();
    assert.strictEqual(r.applied, 2);
    assert.strictEqual(r.writtenFiles.length, 2);
    const main = await fs.promises.readFile(path.join(testDir, 'lib', 'main.dart'), 'utf-8');
    assert.ok(main.includes('greetings'));
    const vpn = await fs.promises.readFile(path.join(testDir, 'lib', 'vpn.dart'), 'utf-8');
    assert.ok(vpn.includes('Vpn'));
  });

  await asyncTest('status is applied', async () => {
    const cs = await ds.loadChangeSet();
    assert.strictEqual(cs.status, 'applied');
  });

  // ── Reject flow ──
  console.log('\n--- 6. Reject Flow ---');
  const ds2 = new DiffService(testDir);
  await asyncTest('reject all', async () => {
    await ds2.createChangeSet('S2', [
      { filePath: 'lib/bad.dart', description: 'Bad', diff: '+bad', modifiedContent: 'bad\n',
        stats: { additions: 1, deletions: 0, isNew: true, isDelete: false } },
    ], { sprintNumber: 2, stepNumber: 1, intent: 'BUILD', summary: '', details: [] });
    await ds2.rejectAll();
    const cs = await ds2.loadChangeSet();
    assert.strictEqual(cs.status, 'all_rejected');
  });

  // ── Edit flow ──
  console.log('\n--- 7. Edit Flow ---');
  const ds3 = new DiffService(testDir);
  await asyncTest('edit proposal', async () => {
    const cs = await ds3.createChangeSet('S3', [
      { filePath: 'lib/edit.dart', description: 'Edit me', diff: '+orig', modifiedContent: 'orig\n',
        stats: { additions: 1, deletions: 0, isNew: true, isDelete: false } },
    ], { sprintNumber: 3, stepNumber: 1, intent: 'BUILD', summary: '', details: [] });
    const updated = await ds3.updateProposalStatus(cs.proposals[0].id, 'edited', 'user edited\n');
    assert.strictEqual(updated.proposals[0].status, 'edited');
    assert.strictEqual(updated.status, 'all_accepted');
    const r = await ds3.applyAccepted();
    assert.strictEqual(r.edited, 1);
    const content = await fs.promises.readFile(path.join(testDir, 'lib', 'edit.dart'), 'utf-8');
    assert.strictEqual(content, 'user edited\n');
  });

  // ── Atomic Write ──
  console.log('\n--- 8. Atomic Write ---');
  await asyncTest('atomic write', async () => {
    const f = path.join(testDir, 'atomic.txt');
    await atomicWrite(f, 'atomic content');
    assert.strictEqual(await fs.promises.readFile(f, 'utf-8'), 'atomic content');
  });
  await asyncTest('atomic write JSON', async () => {
    const f = path.join(testDir, 'atomic.json');
    await atomicWriteJson(f, { k: 'v' });
    assert.strictEqual(JSON.parse(await fs.promises.readFile(f, 'utf-8')).k, 'v');
  });
  await asyncTest('no leftover tmp', async () => {
    const f = path.join(testDir, 'notmp.txt');
    await atomicWrite(f, 'x');
    let exists = true;
    try { await fs.promises.access(f + '.tmp'); } catch { exists = false; }
    assert.strictEqual(exists, false);
  });

  // ── Rehydration ──
  console.log('\n--- 9. Rehydration ---');
  await asyncTest('rehydrate pending change set', async () => {
    const freshDir = path.join(os.tmpdir(), 'c3-rehydrate-' + Date.now());
    await fs.promises.mkdir(freshDir, { recursive: true });
    const dsA = new DiffService(freshDir);
    await dsA.createChangeSet('Pending', [
      { filePath: 'lib/p.dart', description: 'P', diff: '+p', modifiedContent: 'p\n',
        stats: { additions: 1, deletions: 0, isNew: true, isDelete: false } },
    ], { sprintNumber: 1, stepNumber: 1, intent: 'BUILD', summary: '', details: [] });
    const dsB = new DiffService(freshDir);
    const cs = await dsB.loadChangeSet();
    assert.ok(cs);
    assert.strictEqual(cs.status, 'pending');
    await fs.promises.rm(freshDir, { recursive: true, force: true });
  });

  // ── Git Integration ──
  console.log('\n--- 10. Git Integration ---');
  await asyncTest('git service on non-repo returns false', async () => {
    const noGitDir = path.join(os.tmpdir(), 'c3-nogit-' + Date.now());
    await fs.promises.mkdir(noGitDir, { recursive: true });
    const gs = new GitService(noGitDir);
    assert.strictEqual(await gs.isGitRepo(), false);
    assert.strictEqual(await gs.isClean(), true);
    await fs.promises.rm(noGitDir, { recursive: true, force: true });
  });

  await asyncTest('git service on real repo', async () => {
    const gitDir = path.join(os.tmpdir(), 'c3-gitrepo-' + Date.now());
    await fs.promises.mkdir(gitDir, { recursive: true });
    const gs = new GitService(gitDir);
    // Init repo
    await gs.git(['init']);
    await gs.git(['config', 'user.email', 'test@test.com']);
    await gs.git(['config', 'user.name', 'Test']);
    assert.strictEqual(await gs.isGitRepo(), true);
    // Create a file and commit
    await fs.promises.writeFile(path.join(gitDir, 'init.txt'), 'init\n');
    await gs.git(['add', '.']);
    await gs.git(['commit', '-m', 'initial']);
    assert.strictEqual(await gs.isClean(), true);
    // Create sprint branch
    const branch = await gs.createSprintBranch(1);
    assert.strictEqual(branch, 'c3/sprint-1');
    const cur = await gs.getCurrentBranch();
    assert.strictEqual(cur, 'c3/sprint-1');
    // Auto-commit
    await fs.promises.writeFile(path.join(gitDir, 'feature.dart'), 'class Feature {}\n');
    const result = await gs.autoCommit(['feature.dart'], {
      sprintNumber: 1, stepNumber: 1, intent: 'BUILD',
      projectName: 'Test', subject: 'feat: add feature', details: ['Added Feature class'],
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.hash);
    assert.strictEqual(await gs.isClean(), true);
    await fs.promises.rm(gitDir, { recursive: true, force: true });
  });

  await fs.promises.rm(testDir, { recursive: true, force: true });
}

runAsync().then(() => {
  console.log('\n=== Sprint 4 Tests: ' + passCount + '/' + testCount + ' passed ===');
  if (passCount < testCount) process.exit(1);
}).catch(err => { console.error('Test runner error:', err); process.exit(1); });
