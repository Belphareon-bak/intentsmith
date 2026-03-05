// tests/drift-detector.test.js — Architectural Drift Detector unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { DriftDetector, formatDriftReport } from '../src/code-intel/drift-detector.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return name;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Layer Violation Detection ──────────────────────────────────────────────

suite('DriftDetector — Layer Violations');

await testAsync('detects UI importing from repository layer', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'components/UserList.jsx', `
import React from 'react';
import { userRepo } from '../repositories/userRepo';

export function UserList() {
  const users = userRepo.findAll();
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
`);
    writeFile(dir, 'repositories/userRepo.js', `
export const userRepo = { findAll: () => [] };
`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    assert(result.violations.length >= 1, `should detect violation, got ${result.violations.length}`);
    const v = result.violations[0];
    assertEqual(v.sourceLayer, 'ui');
    assertEqual(v.targetLayer, 'repository');
    assertEqual(v.type, 'LAYER_VIOLATION');
  } finally { cleanup(dir); }
});

await testAsync('allows controller importing from service layer', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'controllers/userController.js', `
import { userService } from '../services/userService';

export function getUsers(req, res) {
  return userService.findAll();
}
`);
    writeFile(dir, 'services/userService.js', `
export const userService = { findAll: () => [] };
`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    const layerViolations = result.violations.filter(v => v.type === 'LAYER_VIOLATION');
    assertEqual(layerViolations.length, 0);
  } finally { cleanup(dir); }
});

await testAsync('detects repository importing from controller', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'repositories/dataRepo.js', `
import { apiController } from '../controllers/apiController';

export function getData() {
  return apiController.handle();
}
`);
    writeFile(dir, 'controllers/apiController.js', `
export const apiController = { handle: () => ({}) };
`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    assert(result.violations.length >= 1, `should detect violation, got ${result.violations.length}`);
    assertEqual(result.violations[0].sourceLayer, 'repository');
    assertEqual(result.violations[0].targetLayer, 'controller');
  } finally { cleanup(dir); }
});

await testAsync('util layer can be imported by any layer', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'controllers/main.js', `
import { formatDate } from '../utils/format';
export function handler() { return formatDate(new Date()); }
`);
    writeFile(dir, 'services/main.js', `
import { validate } from '../utils/validate';
export function process() { return validate({}); }
`);
    writeFile(dir, 'utils/format.js', 'export function formatDate(d) { return d.toISOString(); }');
    writeFile(dir, 'utils/validate.js', 'export function validate(d) { return true; }');

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    const layerViolations = result.violations.filter(v => v.type === 'LAYER_VIOLATION');
    assertEqual(layerViolations.length, 0);
  } finally { cleanup(dir); }
});

// ─── Circular Dependency Detection ──────────────────────────────────────────

suite('DriftDetector — Circular Dependencies');

await testAsync('detects circular import chain', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/a.js', `import { b } from './b';`);
    writeFile(dir, 'src/b.js', `import { c } from './c';`);
    writeFile(dir, 'src/c.js', `import { a } from './a';`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    assert(result.circularDependencies.length >= 1, `should detect circular dep, got ${result.circularDependencies.length}`);
    const cycle = result.circularDependencies[0];
    assert(cycle.files.length >= 3, 'cycle should involve ≥3 files');
  } finally { cleanup(dir); }
});

await testAsync('no false circular on linear chain', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/a.js', `import { b } from './b';`);
    writeFile(dir, 'src/b.js', `import { c } from './c';`);
    writeFile(dir, 'src/c.js', `export const c = 42;`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    assertEqual(result.circularDependencies.length, 0);
  } finally { cleanup(dir); }
});

// ─── Naming Convention Detection ─────────────────────────────────────────────

suite('DriftDetector — Naming Conventions');

await testAsync('detects lowercase React component file', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/userCard.jsx', `
import React from 'react';
export function UserCard() { return <div/>; }
`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    assert(result.namingIssues.length >= 1, `should detect naming issue, got ${result.namingIssues.length}`);
    assert(result.namingIssues[0].message.includes('PascalCase'), 'should mention PascalCase');
  } finally { cleanup(dir); }
});

await testAsync('accepts index.jsx as exception', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/index.jsx', `export default function App() { return <div/>; }`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    const jsxNaming = result.namingIssues.filter(n => n.file.includes('index.jsx'));
    assertEqual(jsxNaming.length, 0);
  } finally { cleanup(dir); }
});

await testAsync('accepts useHook.jsx as exception', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/useAuth.jsx', `export function useAuth() { return {}; }`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    const hookNaming = result.namingIssues.filter(n => n.file.includes('useAuth'));
    assertEqual(hookNaming.length, 0);
  } finally { cleanup(dir); }
});

// ─── Full Analysis ──────────────────────────────────────────────────────────

suite('DriftDetector — Full Analysis');

await testAsync('returns complete analysis result', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/main.js', `export const main = () => {};`);

    const detector = new DriftDetector();
    const result = await detector.analyze(dir);

    assert(result.filesAnalyzed >= 1, 'should report files analyzed');
    assert(result.buildTime >= 0, 'should report build time');
    assert(Array.isArray(result.violations), 'should have violations array');
    assert(Array.isArray(result.circularDependencies), 'should have circularDeps array');
    assert(Array.isArray(result.namingIssues), 'should have namingIssues array');
  } finally { cleanup(dir); }
});

// ─── Formatting ──────────────────────────────────────────────────────────────

suite('DriftDetector — Formatting');

test('formatDriftReport produces markdown', () => {
  const report = formatDriftReport({
    violations: [{ sourceLayer: 'ui', targetLayer: 'repository', file: 'comp.jsx', import: '../repos/r' }],
    circularDependencies: [{ files: ['a.js', 'b.js', 'c.js'], key: 'a→b→c' }],
    namingIssues: [{ file: 'myComp.jsx', message: 'Should be PascalCase' }],
    filesAnalyzed: 10,
    buildTime: 42,
  });

  assert(report.includes('## Architectural Drift'), 'should have header');
  assert(report.includes('Layer Violations'), 'should have violations section');
  assert(report.includes('Circular Dependencies'), 'should have circular deps section');
  assert(report.includes('comp.jsx'), 'should mention violating file');
});

test('formatDriftReport handles clean project', () => {
  const report = formatDriftReport({
    violations: [],
    circularDependencies: [],
    namingIssues: [],
    filesAnalyzed: 10,
    buildTime: 5,
  });

  assert(report.includes('No layer violations'), 'should report clean');
  assert(report.includes('No circular dependencies'), 'should report no cycles');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
