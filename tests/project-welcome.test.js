// tests/project-welcome.test.js — v89: Project State Reader + Welcome Generator
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, assertIncludes, summary } from './harness.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Import modules under test ─────────────────────────────────────────────

import { readProjectState, PhaseStatus, StateType } from '../src/chat/handlers/utils/project-state-reader.js';
import { generateNewProjectWelcome, generateExistingProjectWelcome } from '../src/chat/handlers/utils/welcome-generator.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TMP = path.join(os.tmpdir(), 'c3-test-welcome-' + Date.now());

function mkProject(name, files = {}) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const fp = path.join(dir, file);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
  }
  return dir;
}

function cleanup() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}

// ─── C3 markers ─────────────────────────────────────────────────────────────

const C3_README = `# TestProject

Popis projektu.

---
> Automaticky vygenerováno C3 Studio (v67.0)
`;

const C3_ROADMAP_IN_PROGRESS = `# ROADMAP — TestProject

> Automaticky vygenerováno C3 Studio.

## Fáze projektu

| # | Fáze | Status | Popis |
|---|------|--------|-------|
| 1 | Specifikace | ✅ Hotovo | Definice požadavků |
| 2 | Plánování | ⏳ Probíhá | Generování roadmapy |
| 3 | Implementace | ⬜ Čeká | Psaní kódu |
| 4 | Review | ⬜ Čeká | Kontrola kvality |
`;

const C3_ROADMAP_ALL_DONE = `# ROADMAP — Done

> Automaticky vygenerováno C3 Studio.

| # | Fáze | Status | Popis |
|---|------|--------|-------|
| 1 | Specifikace | ✅ Hotovo | Done |
| 2 | Plánování | ✅ Hotovo | Done |
| 3 | Implementace | ✅ Hotovo | Done |
| 4 | Review | ✅ Hotovo | Done |
`;

const C3_ROADMAP_ALL_PENDING = `# ROADMAP — Pending

> Automaticky vygenerováno C3 Studio.

| # | Fáze | Status | Popis |
|---|------|--------|-------|
| 1 | Specifikace | ⬜ Čeká | TBD |
| 2 | Plánování | ⬜ Čeká | TBD |
`;

const C3_ROADMAP_MULTI_IP = `# ROADMAP

> Automaticky vygenerováno C3 Studio.

| # | Fáze | Status | Popis |
|---|------|--------|-------|
| 1 | Spec | ✅ Hotovo | Done |
| 2 | Plan | ⏳ Probíhá | Active |
| 3 | Impl | ⏳ Probíhá | Also active |
| 4 | Review | ⬜ Čeká | Waiting |
`;

const FOREIGN_README = `# Some Project

A project not created by C3.
`;

const FOREIGN_ROADMAP = `# Roadmap

- [ ] Task 1
- [ ] Task 2
`;

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1: Phase parsing
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 1: ROADMAP phase parsing');

test('1.1 Single ⏳ → correct currentPhase, IN_PROGRESS', () => {
  const dir = mkProject('s1-single-ip', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_IN_PROGRESS,
  });
  const state = readProjectState(dir);
  assertEqual(state.currentPhase, 'Plánování');
  assertEqual(state.phaseStatus, PhaseStatus.IN_PROGRESS);
  assert(state.hasPhases, 'hasPhases should be true');
});

test('1.2 All ⬜ → first pending is current, PENDING', () => {
  const dir = mkProject('s1-all-pending', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_ALL_PENDING,
  });
  const state = readProjectState(dir);
  assertEqual(state.currentPhase, 'Specifikace');
  assertEqual(state.phaseStatus, PhaseStatus.PENDING);
});

test('1.3 Multiple ⏳ → first used, IN_PROGRESS', () => {
  const dir = mkProject('s1-multi-ip', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_MULTI_IP,
  });
  const state = readProjectState(dir);
  assertEqual(state.currentPhase, 'Plan');
  assertEqual(state.phaseStatus, PhaseStatus.IN_PROGRESS);
});

test('1.4 All ✅ → COMPLETED, currentPhase null', () => {
  const dir = mkProject('s1-all-done', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_ALL_DONE,
  });
  const state = readProjectState(dir);
  assertEqual(state.currentPhase, null);
  assertEqual(state.phaseStatus, PhaseStatus.COMPLETED);
  assertEqual(state.completedPhases.length, 4);
});

test('1.5 No phases found → UNKNOWN', () => {
  const dir = mkProject('s1-no-phases', {
    'README.md': C3_README,
    'ROADMAP.md': '# ROADMAP\n\n> Automaticky vygenerováno C3 Studio.\n\nNo table here.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.phaseStatus, PhaseStatus.UNKNOWN);
  assert(!state.hasPhases, 'hasPhases should be false');
});

test('1.6 Completed + pending phases listed correctly', () => {
  const dir = mkProject('s1-mixed', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_IN_PROGRESS,
  });
  const state = readProjectState(dir);
  assertEqual(state.completedPhases.length, 1);
  assertEqual(state.completedPhases[0], 'Specifikace');
  assertEqual(state.pendingPhases.length, 2);
  assertIncludes(state.pendingPhases.join(','), 'Implementace');
  assertIncludes(state.pendingPhases.join(','), 'Review');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2: State type derivation
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 2: State type derivation');

test('2.1 C3 README + C3 ROADMAP → FULL', () => {
  const dir = mkProject('s2-full', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_IN_PROGRESS,
  });
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.FULL);
  assert(state.hasC3Structure, 'hasC3Structure should be true');
});

test('2.2 Foreign README + C3 ROADMAP → HYBRID', () => {
  const dir = mkProject('s2-hybrid', {
    'README.md': FOREIGN_README,
    'ROADMAP.md': C3_ROADMAP_IN_PROGRESS,
  });
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.HYBRID);
  assert(state.hasC3Structure, 'hasC3Structure should be true (ROADMAP is C3)');
});

test('2.3 C3 README + foreign ROADMAP → HYBRID', () => {
  const dir = mkProject('s2-hybrid2', {
    'README.md': C3_README,
    'ROADMAP.md': FOREIGN_ROADMAP,
  });
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.HYBRID);
  assert(state.hasC3Structure, 'hasC3Structure should be true (README is C3)');
});

test('2.4 Foreign + foreign → FOREIGN', () => {
  const dir = mkProject('s2-foreign', {
    'README.md': FOREIGN_README,
    'ROADMAP.md': FOREIGN_ROADMAP,
  });
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.FOREIGN);
  assert(!state.hasC3Structure, 'hasC3Structure should be false');
});

test('2.5 No README + no ROADMAP → EMPTY', () => {
  const dir = mkProject('s2-empty', {});
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.EMPTY);
  assert(!state.hasReadme, 'hasReadme should be false');
  assert(!state.hasRoadmap, 'hasRoadmap should be false');
});

test('2.6 C3 README only → HYBRID', () => {
  const dir = mkProject('s2-readme-only', {
    'README.md': C3_README,
  });
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.HYBRID);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3: Summary + description extraction
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 3: Summary + description extraction');

test('3.1 .c3/project.json description takes priority', () => {
  const dir = mkProject('s3-meta', {
    'README.md': C3_README,
    '.c3/project.json': JSON.stringify({ name: 'MetaProject', description: 'From meta' }),
  });
  const state = readProjectState(dir);
  assertEqual(state.description, 'From meta');
  assertEqual(state.name, 'MetaProject');
});

test('3.2 README paragraph as fallback', () => {
  const dir = mkProject('s3-readme-para', {
    'README.md': '# MyApp\n\nThis is my application.\n\n## Section\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'This is my application.');
});

test('3.3 README with badges only → skips to paragraph', () => {
  const dir = mkProject('s3-badges', {
    'README.md': '# BadgeApp\n\n![build](badge.svg)\n![cov](cov.svg)\n\nActual description here.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'Actual description here.');
});

test('3.4 README with no paragraph → fallback', () => {
  const dir = mkProject('s3-no-para', {
    'README.md': '# Empty\n\n![badge](x)\n\n## Section\n\nContent under section.\n',
  });
  const state = readProjectState(dir);
  // H1 is "Empty", next is badge (skipped), next is "## Section" (stops at heading)
  assertEqual(state.summary, 'Projekt bez popisu');
});

test('3.5 README summary ignores blockquotes', () => {
  const dir = mkProject('s3-blockquote', {
    'README.md': '# Quoted\n\n> This is a quote\n\nActual text.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'Actual text.');
});

test('3.6 README summary truncates at 200 chars', () => {
  const longText = 'A'.repeat(250);
  const dir = mkProject('s3-long', {
    'README.md': `# Long\n\n${longText}\n`,
  });
  const state = readProjectState(dir);
  assert(state.summary.length <= 203, 'Summary should be ≤203 chars (200 + ...)');
  assert(state.summary.endsWith('...'), 'Should end with ...');
});

test('3.7 Invalid .c3/project.json → no crash', () => {
  const dir = mkProject('s3-bad-json', {
    'README.md': C3_README,
    '.c3/project.json': '{invalid json!!!',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'Popis projektu.');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4: Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 4: Edge cases');

test('4.1 BOM in README → stripped correctly', () => {
  const dir = mkProject('s4-bom', {
    'README.md': '\uFEFF# BOMProject\n\nBOM description.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.name, 's4-bom'); // no .c3/project.json, uses dirname
  assertEqual(state.summary, 'BOM description.');
});

test('4.2 CRLF line endings → phases still parsed', () => {
  const crlf = C3_ROADMAP_IN_PROGRESS.replace(/\n/g, '\r\n');
  const dir = mkProject('s4-crlf', {
    'ROADMAP.md': crlf,
    'README.md': C3_README,
  });
  const state = readProjectState(dir);
  assertEqual(state.phaseStatus, PhaseStatus.IN_PROGRESS);
  assertEqual(state.currentPhase, 'Plánování');
});

test('4.3 Extra spaces in table → tolerant parse', () => {
  const messy = `# ROADMAP

> Automaticky vygenerováno C3 Studio.

|  #  |   Fáze   |   Status   |  Popis  |
|-----|----------|------------|---------|
|  1  |   Spec   |  ✅ Hotovo  |  Done   |
|  2  |   Plan   |  ⏳ Probíhá |  Active |
`;
  const dir = mkProject('s4-spaces', {
    'ROADMAP.md': messy,
    'README.md': C3_README,
  });
  const state = readProjectState(dir);
  // Spec is ✅ (completed), Plan is ⏳ (in progress) → currentPhase = Plan
  assertEqual(state.currentPhase, 'Plan');
  assertEqual(state.phaseStatus, PhaseStatus.IN_PROGRESS);
  assertEqual(state.completedPhases[0], 'Spec');
  assert(state.hasPhases, 'Phases should be parsed despite extra spaces');
});

test('4.4 Large README (>50k) → truncated, no crash', () => {
  const bigContent = '# Big\n\n' + 'x'.repeat(60000) + '\n';
  const dir = mkProject('s4-large', {
    'README.md': bigContent,
  });
  const state = readProjectState(dir);
  // Should not crash, state type should be derived
  assert(state.hasReadme, 'hasReadme should be true');
  assertEqual(state.stateType, StateType.HYBRID); // Foreign README, no ROADMAP → actually HYBRID (has README, missing ROADMAP)
});

test('4.5 Invalid path → safe fallback', () => {
  const state = readProjectState(null);
  assertEqual(state.stateType, StateType.EMPTY);
  assertEqual(state.phaseStatus, PhaseStatus.UNKNOWN);
});

test('4.6 Relative path → safe fallback', () => {
  const state = readProjectState('relative/path');
  assertEqual(state.stateType, StateType.EMPTY);
});

test('4.7 Stack detection — package.json → Node.js', () => {
  const dir = mkProject('s4-stack', {
    'package.json': '{"name":"test"}',
  });
  const state = readProjectState(dir);
  assertIncludes(state.stack.join(','), 'Node.js');
});

test('4.8 Large README + no table → FOREIGN + valid welcome', () => {
  const big = '# BigProject\n\nDescription of big project.\n\n' + 'Content. '.repeat(5000) + '\n';
  const dir = mkProject('s4-large-no-table', {
    'README.md': big,
    'ROADMAP.md': '# Roadmap\n\nJust text, no table.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.stateType, StateType.FOREIGN);
  assertEqual(state.phaseStatus, PhaseStatus.UNKNOWN);
  assert(!state.hasPhases, 'hasPhases should be false');
  // Welcome should still work
  const welcome = generateExistingProjectWelcome(state);
  assert(welcome.length > 0, 'Welcome should not be empty');
  assertIncludes(welcome, 's4-large-no-table');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5: Welcome generator — new project
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 5: Welcome generator — new project');

test('5.1 New project with description', () => {
  const welcome = generateNewProjectWelcome({ name: 'TestApp', description: 'An app for testing.', type: 'webapp' });
  assertIncludes(welcome, '**TestApp**');
  assertIncludes(welcome, 'webapp');
  assertIncludes(welcome, 'An app for testing.');
  assertIncludes(welcome, 'Specifikace');
  assert(welcome.length <= 600, 'Welcome should be ≤600 chars');
});

test('5.2 New project without description', () => {
  const welcome = generateNewProjectWelcome({ name: 'Bare' });
  assertIncludes(welcome, '**Bare**');
  assert(!welcome.includes('undefined'), 'Should not contain "undefined"');
});

test('5.3 New project with long description → truncated', () => {
  const longDesc = 'A'.repeat(200);
  const welcome = generateNewProjectWelcome({ name: 'Long', description: longDesc });
  assertIncludes(welcome, '...');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 6: Welcome generator — existing project
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 6: Welcome generator — existing project');

test('6.1 FULL IN_PROGRESS — phases + next action', () => {
  const dir = mkProject('s6-full-ip', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_IN_PROGRESS,
  });
  const state = readProjectState(dir);
  const welcome = generateExistingProjectWelcome(state);
  assertIncludes(welcome, 'Plánování');
  assertIncludes(welcome, 'Navázat');
  assert(welcome.length <= 600, `Welcome too long: ${welcome.length}`);
});

test('6.2 FULL COMPLETED — new cycle + audit', () => {
  const dir = mkProject('s6-full-done', {
    'README.md': C3_README,
    'ROADMAP.md': C3_ROADMAP_ALL_DONE,
  });
  const state = readProjectState(dir);
  const welcome = generateExistingProjectWelcome(state);
  assertIncludes(welcome, 'dokončené');
  assertIncludes(welcome, 'nový cyklus');
});

test('6.3 HYBRID — suggests fixing structure', () => {
  const dir = mkProject('s6-hybrid', {
    'README.md': FOREIGN_README,
    'ROADMAP.md': C3_ROADMAP_IN_PROGRESS,
  });
  const state = readProjectState(dir);
  const welcome = generateExistingProjectWelcome(state);
  assertIncludes(welcome, 'aktualizovat');
});

test('6.4 FOREIGN — offers C3 structure', () => {
  const dir = mkProject('s6-foreign', {
    'README.md': FOREIGN_README,
    'ROADMAP.md': FOREIGN_ROADMAP,
  });
  const state = readProjectState(dir);
  const welcome = generateExistingProjectWelcome(state);
  assertIncludes(welcome, 'C3 strukturu');
});

test('6.5 EMPTY — offers scaffold', () => {
  const dir = mkProject('s6-empty', {});
  const state = readProjectState(dir);
  const welcome = generateExistingProjectWelcome(state);
  assertIncludes(welcome, 'README');
  assertIncludes(welcome, 'ROADMAP');
});

test('6.6 No empty sections in any welcome variant', () => {
  // Check that no welcome has consecutive empty lines (= empty section)
  const variants = [
    generateNewProjectWelcome({ name: 'T1' }),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-no-empty-1', { 'README.md': C3_README, 'ROADMAP.md': C3_ROADMAP_IN_PROGRESS }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-no-empty-2', { 'README.md': C3_README, 'ROADMAP.md': C3_ROADMAP_ALL_DONE }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-no-empty-3', { 'README.md': FOREIGN_README, 'ROADMAP.md': FOREIGN_ROADMAP }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-no-empty-4', {}))),
  ];
  for (let i = 0; i < variants.length; i++) {
    assert(!variants[i].includes('\n\n\n'), `Variant ${i} has triple newline (empty section)`);
  }
});

test('6.7 All welcome variants ≤ 600 chars', () => {
  const variants = [
    generateNewProjectWelcome({ name: 'T1', description: 'Desc', type: 'webapp' }),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-len-1', { 'README.md': C3_README, 'ROADMAP.md': C3_ROADMAP_IN_PROGRESS }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-len-2', { 'README.md': C3_README, 'ROADMAP.md': C3_ROADMAP_ALL_DONE }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-len-3', { 'README.md': FOREIGN_README, 'ROADMAP.md': C3_ROADMAP_IN_PROGRESS }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-len-4', { 'README.md': FOREIGN_README, 'ROADMAP.md': FOREIGN_ROADMAP }))),
    generateExistingProjectWelcome(readProjectState(mkProject('s6-len-5', {}))),
  ];
  for (let i = 0; i < variants.length; i++) {
    assert(variants[i].length <= 600, `Variant ${i} too long: ${variants[i].length} chars`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 7: README summary edge cases
// ═══════════════════════════════════════════════════════════════════════════════

suite('Suite 7: README summary edge cases');

test('7.1 README ignores bare list items', () => {
  const dir = mkProject('s7-list', {
    'README.md': '# ListApp\n\n- item 1\n- item 2\n\nActual paragraph.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'Actual paragraph.');
});

test('7.2 README ignores HTML tags', () => {
  const dir = mkProject('s7-html', {
    'README.md': '# HtmlApp\n\n<div>something</div>\n\nReal text.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'Real text.');
});

test('7.3 README ignores table rows', () => {
  const dir = mkProject('s7-table', {
    'README.md': '# TableApp\n\n| Col1 | Col2 |\n|------|------|\n| a | b |\n\nAfter table.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'After table.');
});

test('7.4 README ignores horizontal rules', () => {
  const dir = mkProject('s7-hr', {
    'README.md': '# HrApp\n\n---\n\nContent after hr.\n',
  });
  const state = readProjectState(dir);
  assertEqual(state.summary, 'Content after hr.');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cleanup + Summary
// ═══════════════════════════════════════════════════════════════════════════════

cleanup();
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
