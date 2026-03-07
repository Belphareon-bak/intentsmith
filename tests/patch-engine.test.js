// tests/patch-engine.test.js — F1 Patch Engine Tests (v104)
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, assertThrows, summary } from './harness.js';
import { AnchorType, PatchType, normalizeNewlines, parsePatchFromDiff, parsePatchFromFullFile } from '../src/patch/patch-parser.js';
import { PATCH_LIMITS, findAnchor, validatePatch, validatePatchSet } from '../src/patch/patch-validator.js';
import {
  applyPatch, saveBackup, revertPatch, hasBackup, clearBackups,
  composePatchSet, computeMetrics, formatPatch,
} from '../src/patch/patch-applier.js';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const SAMPLE_JS = `import { db } from './db.js';

function login(user, password) {
  return db.find(user);
}

function logout(session) {
  session.destroy();
}

export { login, logout };
`;

const SAMPLE_PYTHON = `import os

def login(user, password):
    return db.find(user)

def logout(session):
    session.destroy()
`;

// ═══ Suite 1: Parser Constants ═════════════════════════════════════════════

suite('Parser Constants');

test('AnchorType has all expected types', () => {
  assertEqual(AnchorType.FUNCTION, 'function');
  assertEqual(AnchorType.CLASS, 'class');
  assertEqual(AnchorType.METHOD, 'method');
  assertEqual(AnchorType.IMPORT, 'import');
  assertEqual(AnchorType.LINE, 'line');
  assertEqual(AnchorType.INSERT_AFTER, 'insert_after');
});

test('AnchorType is frozen', () => {
  assertThrows(() => { AnchorType.NEW_TYPE = 'new'; });
});

test('PatchType has all expected types', () => {
  assertEqual(PatchType.FIX, 'fix');
  assertEqual(PatchType.FEATURE, 'feature');
  assertEqual(PatchType.REFACTOR, 'refactor');
});

// ═══ Suite 2: parsePatchFromDiff ═══════════════════════════════════════════

suite('parsePatchFromDiff');

test('parses simple single-file diff with one region', () => {
  const input = '```diff\n--- a/src/auth/login.js\n@@ function login(user, password)\n- return db.find(user)\n+ if (!user) throw new Error("Missing user")\n+ return db.find(user)\n```';

  const patches = parsePatchFromDiff(input);
  assertEqual(patches.length, 1);
  assertEqual(patches[0].file, 'src/auth/login.js');
  assertEqual(patches[0].regions.length, 1);
  assertEqual(patches[0].regions[0].anchor, 'login(user, password)');
  assertEqual(patches[0].regions[0].anchorType, 'function');
  assertEqual(patches[0].regions[0].old.length, 1);
  assertEqual(patches[0].regions[0].new.length, 2);
});

test('parses multi-region diff for same file', () => {
  const input = '```diff\n--- a/src/auth.js\n@@ function login()\n- old1\n+ new1\n@@ function logout()\n- old2\n+ new2\n```';

  const patches = parsePatchFromDiff(input);
  assertEqual(patches.length, 1);
  assertEqual(patches[0].regions.length, 2);
  assertEqual(patches[0].regions[0].anchor, 'login()');
  assertEqual(patches[0].regions[1].anchor, 'logout()');
});

test('parses diff with explicit anchorType in @@ line', () => {
  const input = '```diff\n--- a/src/models.js\n@@ class UserService\n- old line\n+ new line\n```';

  const patches = parsePatchFromDiff(input);
  assertEqual(patches[0].regions[0].anchorType, 'class');
  assertEqual(patches[0].regions[0].anchor, 'UserService');
});

test('infers function anchorType from anchor text', () => {
  const input = '```diff\n--- a/src/auth.js\n@@ async function processOrder(id)\n- old\n+ new\n```';

  const patches = parsePatchFromDiff(input);
  assertEqual(patches[0].regions[0].anchorType, 'function');
});

test('infers class anchorType from anchor text', () => {
  const input = '```diff\n--- a/src/models.js\n@@ export class UserModel extends Base\n- old\n+ new\n```';

  const patches = parsePatchFromDiff(input);
  assertEqual(patches[0].regions[0].anchorType, 'class');
});

test('infers import anchorType from anchor text', () => {
  const input = '```diff\n--- a/src/app.js\n@@ import { db } from \'./db.js\'\n- import { db } from \'./db.js\'\n+ import { db, cache } from \'./db.js\'\n```';

  const patches = parsePatchFromDiff(input);
  assertEqual(patches[0].regions[0].anchorType, 'import');
});

test('handles empty/malformed input gracefully', () => {
  assertEqual(parsePatchFromDiff('').length, 0);
  assertEqual(parsePatchFromDiff(null).length, 0);
  assertEqual(parsePatchFromDiff('just some text').length, 0);
  assertEqual(parsePatchFromDiff('```\nno diff content\n```').length, 0);
});

test('handles CRLF normalization', () => {
  const input = '```diff\r\n--- a/src/app.js\r\n@@ function foo()\r\n- old\r\n+ new\r\n```';
  const patches = parsePatchFromDiff(input);
  assertEqual(patches.length, 1);
  assertEqual(patches[0].regions[0].old[0], ' old');
});

test('handles fence with title attribute', () => {
  const input = '```diff title="patch"\n--- a/src/app.js\n@@ function foo()\n- old\n+ new\n```';
  const patches = parsePatchFromDiff(input);
  assertEqual(patches.length, 1);
});

// ═══ Suite 3: parsePatchFromFullFile ══════════════════════════════════════

suite('parsePatchFromFullFile');

test('computes diff from original and new content', () => {
  const original = 'function foo() {\n  return 1;\n}\n';
  const modified = 'function foo() {\n  return 2;\n}\n';

  const patch = parsePatchFromFullFile(original, modified, 'src/foo.js');
  assert(patch !== null, 'Expected non-null patch');
  assertEqual(patch.file, 'src/foo.js');
  assert(patch.regions.length > 0, 'Expected at least one region');
});

test('returns null for identical files', () => {
  const content = 'function foo() { return 1; }\n';
  const patch = parsePatchFromFullFile(content, content, 'src/foo.js');
  assertEqual(patch, null);
});

test('handles pure insertion (empty original)', () => {
  const patch = parsePatchFromFullFile('', 'function foo() {\n  return 1;\n}\n', 'src/new.js');
  assert(patch !== null, 'Expected non-null patch for new file');
  assert(patch.regions.length > 0);
});

test('returns null when diff exceeds size limit', () => {
  const original = '';
  const modified = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
  const patch = parsePatchFromFullFile(original, modified, 'src/big.js');
  assertEqual(patch, null);
});

// ═══ Suite 4: findAnchor ══════════════════════════════════════════════════

suite('findAnchor');

test('tier 1: exact match', () => {
  const result = findAnchor(SAMPLE_JS, 'function login(user, password)', 'function');
  assert(result !== null, 'Expected match');
  assertEqual(result.tier, 'exact');
  assertEqual(result.line, 2); // 0-indexed
  assertEqual(result.matches, 1);
});

test('tier 1: exact match with contextBefore disambiguation', () => {
  const content = 'function foo() { }\nfunction bar() { }\nfunction foo() { }\n';
  // Two "foo" matches — contextBefore disambiguates
  const result = findAnchor(content, 'function foo()', 'function', 'function bar()');
  assert(result !== null);
  assertEqual(result.line, 2); // The second foo (after bar)
  assertEqual(result.tier, 'exact');
});

test('tier 1: ambiguous anchor returns matches > 1', () => {
  const content = 'function foo() { }\nfunction foo() { }\n';
  const result = findAnchor(content, 'function foo()', 'function');
  assert(result !== null);
  assertEqual(result.matches, 2);
  assertEqual(result.line, 0); // Takes first match
});

test('tier 2: normalized match (extra whitespace)', () => {
  const content = 'function   login(  user,  password  ) {\n';
  const result = findAnchor(content, 'function login( user, password )', 'function');
  assert(result !== null);
  assertEqual(result.tier, 'normalized');
});

test('tier 2: normalized match with tabs', () => {
  const content = '\tfunction\tlogin(user) {\n';
  const result = findAnchor(content, 'function login(user)', 'function');
  assert(result !== null);
  assertEqual(result.tier, 'normalized');
});

test('returns null when anchor not found', () => {
  const result = findAnchor(SAMPLE_JS, 'function nonexistent()', 'function');
  assertEqual(result, null);
});

test('handles empty content', () => {
  const result = findAnchor('', 'function foo()', 'function');
  assertEqual(result, null);
});

test('handles empty anchor', () => {
  const result = findAnchor(SAMPLE_JS, '', 'function');
  assertEqual(result, null);
});

test('tier 3: AST-assisted via symbols parameter', () => {
  // Simulate pre-extracted symbols from ast-analyzer
  const symbols = [
    { name: 'login', type: 'function', line: 3, endLine: 5, exported: true },
    { name: 'logout', type: 'function', line: 7, endLine: 9, exported: true },
  ];
  const result = findAnchor('no match here', 'function login(user)', 'function', null, symbols);
  assert(result !== null);
  assertEqual(result.tier, 'ast');
  assertEqual(result.line, 2); // symbol line 3 → 0-indexed = 2
});

// ═══ Suite 5: validatePatch ═══════════════════════════════════════════════

suite('validatePatch');

test('valid patch passes', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: 'function login(user, password)',
      anchorType: 'function',
      contextBefore: '',
      old: ['  return db.find(user);'],
      new: ['  if (!user) throw new Error("Missing");', '  return db.find(user);'],
    }],
    metadata: { type: 'fix', confidence: 0.8 },
  };
  const fileContents = new Map([['src/auth.js', SAMPLE_JS]]);
  const result = validatePatch(patch, fileContents);
  assertEqual(result.valid, true);
});

test('rejects patch for missing file with non-empty old lines', () => {
  const patch = {
    file: 'nonexistent.js',
    regions: [{ anchor: 'function foo()', anchorType: 'function', old: ['old'], new: ['new'] }],
  };
  const result = validatePatch(patch, new Map());
  assertEqual(result.valid, false);
  assert(result.errors.some(e => e.includes('not found')));
});

test('allows pure insert on missing file', () => {
  const patch = {
    file: 'new-file.js',
    regions: [{ anchor: 'line 1', anchorType: 'line', old: [], new: ['console.log("hello");'] }],
  };
  const result = validatePatch(patch, new Map());
  assertEqual(result.valid, true);
});

test('rejects oversized patch', () => {
  const regions = [{ anchor: 'function foo()', anchorType: 'function', old: Array(200).fill('x'), new: Array(200).fill('y') }];
  const patch = { file: 'src/auth.js', regions };
  const fileContents = new Map([['src/auth.js', SAMPLE_JS]]);
  const result = validatePatch(patch, fileContents);
  assertEqual(result.valid, false);
  assert(result.errors.some(e => e.includes('lines')));
});

test('rejects too many regions', () => {
  const regions = Array.from({ length: 25 }, (_, i) => ({
    anchor: `anchor_${i}`, anchorType: 'line', old: ['x'], new: ['y'],
  }));
  const patch = { file: 'src/auth.js', regions };
  const fileContents = new Map([['src/auth.js', SAMPLE_JS]]);
  const result = validatePatch(patch, fileContents);
  assertEqual(result.valid, false);
  assert(result.errors.some(e => e.includes('regions')));
});

test('rejects stale patch (old lines mismatch)', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: 'function login(user, password)',
      anchorType: 'function',
      old: ['  return WRONG_LINE;'],
      new: ['  return correct;'],
    }],
  };
  const fileContents = new Map([['src/auth.js', SAMPLE_JS]]);
  const result = validatePatch(patch, fileContents);
  assertEqual(result.valid, false);
  assert(result.errors.some(e => e.includes('stale')));
});

test('rejects ambiguous anchor without contextBefore', () => {
  const content = 'function foo() { }\nfunction foo() { }\n';
  const patch = {
    file: 'dup.js',
    regions: [{ anchor: 'function foo()', anchorType: 'function', old: [], new: ['// added'] }],
  };
  const fileContents = new Map([['dup.js', content]]);
  const result = validatePatch(patch, fileContents);
  assertEqual(result.valid, false);
  assert(result.errors.some(e => e.includes('ambiguous')));
});

test('detects overlapping regions', () => {
  // Two regions that resolve to the same line
  const patch = {
    file: 'src/auth.js',
    regions: [
      { anchor: 'function login(user, password)', anchorType: 'function', contextBefore: "import { db } from './db.js';", old: ['  return db.find(user);'], new: ['  return 1;'] },
      { anchor: 'function login(user, password)', anchorType: 'function', contextBefore: "import { db } from './db.js';", old: ['  return db.find(user);'], new: ['  return 2;'] },
    ],
  };
  const fileContents = new Map([['src/auth.js', SAMPLE_JS]]);
  const result = validatePatch(patch, fileContents);
  assertEqual(result.valid, false);
  assert(result.errors.some(e => e.includes('overlap')));
});

// ═══ Suite 6: applyPatch (applier) ════════════════════════════════════════

suite('applyPatch (applier)');

test('applies simple replacement', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: 'function login(user, password)',
      anchorType: 'function',
      old: ['  return db.find(user);'],
      new: ['  if (!user) throw new Error("Missing");', '  return db.find(user);'],
    }],
  };
  const result = applyPatch(patch, SAMPLE_JS);
  assertEqual(result.applied, 1);
  assertEqual(result.skipped, 0);
  assertIncludes(result.content, 'throw new Error("Missing")');
  assertIncludes(result.content, 'return db.find(user)');
});

test('applies insert_after', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: "import { db } from './db.js';",
      anchorType: 'insert_after',
      old: [],
      new: ["import { cache } from './cache.js';"],
    }],
  };
  const result = applyPatch(patch, SAMPLE_JS);
  assertEqual(result.applied, 1);
  assertIncludes(result.content, "import { cache } from './cache.js';");
  // Verify it's after the db import
  const lines = result.content.split('\n');
  const dbIdx = lines.findIndex(l => l.includes("import { db }"));
  const cacheIdx = lines.findIndex(l => l.includes("import { cache }"));
  assert(cacheIdx === dbIdx + 1, 'cache import should be right after db import');
});

test('applies deletion (empty new[])', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: "import { db } from './db.js';",
      anchorType: 'import',
      old: ["import { db } from './db.js';"],
      new: [],
    }],
  };
  const result = applyPatch(patch, SAMPLE_JS);
  assertEqual(result.applied, 1);
  assert(!result.content.includes("import { db }"), 'Import should be removed');
});

test('applies multiple regions bottom-up', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [
      {
        anchor: 'function login(user, password)',
        anchorType: 'function',
        old: ['  return db.find(user);'],
        new: ['  return db.findOne(user);'],
      },
      {
        anchor: 'function logout(session)',
        anchorType: 'function',
        old: ['  session.destroy();'],
        new: ['  session.invalidate();'],
      },
    ],
  };
  const result = applyPatch(patch, SAMPLE_JS);
  assertEqual(result.applied, 2);
  assertIncludes(result.content, 'db.findOne(user)');
  assertIncludes(result.content, 'session.invalidate()');
});

test('returns skipped count for unresolvable anchors', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: 'function nonexistent()',
      anchorType: 'function',
      old: ['old'],
      new: ['new'],
    }],
  };
  const result = applyPatch(patch, SAMPLE_JS);
  assertEqual(result.applied, 0);
  assertEqual(result.skipped, 1);
});

test('handles empty regions array', () => {
  const patch = { file: 'src/auth.js', regions: [] };
  const result = applyPatch(patch, SAMPLE_JS);
  assertEqual(result.applied, 0);
  assertEqual(result.skipped, 0);
});

test('preserves unmodified lines', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: 'function login(user, password)',
      anchorType: 'function',
      old: ['  return db.find(user);'],
      new: ['  return db.findOne(user);'],
    }],
  };
  const result = applyPatch(patch, SAMPLE_JS);
  // logout function should be unchanged
  assertIncludes(result.content, 'function logout(session)');
  assertIncludes(result.content, 'session.destroy()');
});

test('ensures trailing newline', () => {
  const content = 'function foo() { return 1; }'; // no trailing newline
  const patch = {
    file: 'test.js',
    regions: [{
      anchor: 'function foo()',
      anchorType: 'function',
      old: ['function foo() { return 1; }'],
      new: ['function foo() { return 2; }'],
    }],
  };
  const result = applyPatch(patch, content);
  assert(result.content.endsWith('\n'), 'Content should end with newline');
});

// ═══ Suite 7: Backup/Revert ═══════════════════════════════════════════════

suite('Backup/Revert');

// Clean state before each suite
clearBackups();

test('saveBackup + revertPatch returns original', () => {
  clearBackups();
  saveBackup('test.js', 'original content');
  const restored = revertPatch('test.js');
  assertEqual(restored, 'original content');
  // Backup consumed after revert
  assertEqual(hasBackup('test.js'), false);
});

test('revertPatch returns null without backup', () => {
  clearBackups();
  const restored = revertPatch('nonexistent.js');
  assertEqual(restored, null);
});

test('hasBackup returns correct state', () => {
  clearBackups();
  assertEqual(hasBackup('test.js'), false);
  saveBackup('test.js', 'content');
  assertEqual(hasBackup('test.js'), true);
});

test('clearBackups removes all entries', () => {
  saveBackup('a.js', 'a');
  saveBackup('b.js', 'b');
  clearBackups();
  assertEqual(hasBackup('a.js'), false);
  assertEqual(hasBackup('b.js'), false);
});

// ═══ Suite 8: composePatchSet ═════════════════════════════════════════════

suite('composePatchSet');

test('passes through single-file patches', () => {
  const patches = [
    { file: 'a.js', regions: [{ anchor: 'foo', anchorType: 'function', old: [], new: ['x'] }], metadata: {} },
    { file: 'b.js', regions: [{ anchor: 'bar', anchorType: 'function', old: [], new: ['y'] }], metadata: {} },
  ];
  const { composed, conflicts } = composePatchSet(patches);
  assertEqual(composed.length, 2);
  assertEqual(conflicts.length, 0);
});

test('merges regions for same file', () => {
  const patches = [
    { file: 'a.js', regions: [{ anchor: 'foo', anchorType: 'function', old: [], new: ['x'] }], metadata: { confidence: 0.5 } },
    { file: 'a.js', regions: [{ anchor: 'bar', anchorType: 'function', old: [], new: ['y'] }], metadata: { confidence: 0.8 } },
  ];
  const { composed, conflicts } = composePatchSet(patches);
  assertEqual(composed.length, 1);
  assertEqual(composed[0].regions.length, 2);
  assertEqual(conflicts.length, 0);
});

test('detects conflicts (same anchor targeted twice)', () => {
  const patches = [
    { file: 'a.js', regions: [{ anchor: 'foo', anchorType: 'function', old: [], new: ['x'] }], metadata: {} },
    { file: 'a.js', regions: [{ anchor: 'foo', anchorType: 'function', old: [], new: ['y'] }], metadata: {} },
  ];
  const { conflicts } = composePatchSet(patches);
  assertEqual(conflicts.length, 1);
  assertEqual(conflicts[0].anchor, 'foo');
});

test('handles empty input', () => {
  const { composed, conflicts } = composePatchSet([]);
  assertEqual(composed.length, 0);
  assertEqual(conflicts.length, 0);
});

// ═══ Suite 9: formatPatch ═════════════════════════════════════════════════

suite('formatPatch');

test('formats single region patch', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [{
      anchor: 'function login()',
      anchorType: 'function',
      old: ['  return 1;'],
      new: ['  return 2;'],
    }],
  };
  const formatted = formatPatch(patch);
  assertIncludes(formatted, '--- src/auth.js');
  assertIncludes(formatted, '@@ function function login()');
  assertIncludes(formatted, '-   return 1;');
  assertIncludes(formatted, '+   return 2;');
});

test('formats multi-region patch', () => {
  const patch = {
    file: 'src/auth.js',
    regions: [
      { anchor: 'function foo()', anchorType: 'function', old: ['a'], new: ['b'] },
      { anchor: 'function bar()', anchorType: 'function', old: ['c'], new: ['d'] },
    ],
  };
  const formatted = formatPatch(patch);
  assertIncludes(formatted, '@@ function function foo()');
  assertIncludes(formatted, '@@ function function bar()');
});

// ═══ Suite 10: computeMetrics ═════════════════════════════════════════════

suite('computeMetrics');

test('computes correct metrics for replacement', () => {
  const patch = {
    file: 'test.js',
    regions: [{ anchor: 'fn', anchorType: 'function', old: ['a', 'b'], new: ['c', 'd', 'e'] }],
  };
  const applyResult = { applied: 1, skipped: 0, details: [{ tier: 'exact' }] };
  const metrics = computeMetrics(patch, applyResult);
  assertEqual(metrics.linesModified, 3); // max(2, 3)
  assertEqual(metrics.linesAdded, 0);
  assertEqual(metrics.linesRemoved, 0);
  assertEqual(metrics.anchorsResolved.exact, 1);
  assertEqual(metrics.applied, 1);
});

test('computes correct metrics for insertion', () => {
  const patch = {
    file: 'test.js',
    regions: [{ anchor: 'fn', anchorType: 'insert_after', old: [], new: ['a', 'b', 'c'] }],
  };
  const applyResult = { applied: 1, skipped: 0, details: [{ tier: 'normalized' }] };
  const metrics = computeMetrics(patch, applyResult);
  assertEqual(metrics.linesAdded, 3);
  assertEqual(metrics.linesRemoved, 0);
  assertEqual(metrics.linesModified, 0);
  assertEqual(metrics.anchorsResolved.normalized, 1);
});

test('computes correct metrics for deletion', () => {
  const patch = {
    file: 'test.js',
    regions: [{ anchor: 'fn', anchorType: 'function', old: ['a', 'b'], new: [] }],
  };
  const applyResult = { applied: 1, skipped: 0, details: [{ tier: 'ast' }] };
  const metrics = computeMetrics(patch, applyResult);
  assertEqual(metrics.linesRemoved, 2);
  assertEqual(metrics.linesAdded, 0);
  assertEqual(metrics.anchorsResolved.ast, 1);
});

// ═══ Suite 11: normalizeNewlines ══════════════════════════════════════════

suite('normalizeNewlines');

test('converts CRLF to LF', () => {
  assertEqual(normalizeNewlines('a\r\nb\r\nc'), 'a\nb\nc');
});

test('handles null/empty', () => {
  assertEqual(normalizeNewlines(''), '');
  assertEqual(normalizeNewlines(null), '');
});

test('preserves pure LF', () => {
  assertEqual(normalizeNewlines('a\nb\nc'), 'a\nb\nc');
});

// ═══════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
