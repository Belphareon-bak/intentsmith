// tests/architecture-policy.test.js — Architecture Policy Engine v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  loadPolicy,
  generatePolicy,
  validatePolicy,
  policyToLayers,
  policyToACF,
  acfToPolicy,
  savePolicy,
} from '../src/planner/architecture-policy.js';
import { DriftDetector } from '../src/code-intel/drift-detector.js';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP = join(tmpdir(), `c3-policy-test-${Date.now()}`);

// ─── Setup ───────────────────────────────────────────────────────────────────

async function setup() {
  await mkdir(TMP, { recursive: true });
  await mkdir(join(TMP, '.c3'), { recursive: true });
}

async function cleanup() {
  try { await rm(TMP, { recursive: true, force: true }); } catch {}
}

// ─── Validation ──────────────────────────────────────────────────────────────

suite('Architecture Policy — Validation');

test('validates correct policy', () => {
  const policy = {
    layers: ['controller', 'service', 'model'],
    rules: [
      { from: 'controller', canImport: ['service', 'model'] },
      { from: 'service', canImport: ['model'] },
      { from: 'model', canImport: [] },
    ],
  };
  const result = validatePolicy(policy);
  assert(result.valid, `should be valid, errors: ${result.errors.join(', ')}`);
  assertEqual(result.errors.length, 0);
});

test('rejects null policy', () => {
  const result = validatePolicy(null);
  assert(!result.valid, 'null should be invalid');
});

test('rejects empty layers', () => {
  const result = validatePolicy({ layers: [], rules: [] });
  assert(!result.valid, 'empty layers should be invalid');
});

test('rejects duplicate layers', () => {
  const result = validatePolicy({
    layers: ['service', 'service'],
    rules: [{ from: 'service', canImport: [] }],
  });
  assert(!result.valid, 'duplicate layers should be invalid');
  assert(result.errors.some(e => e.includes('Duplicate')), 'should mention duplicates');
});

test('rejects unknown layer in rules', () => {
  const result = validatePolicy({
    layers: ['controller', 'service'],
    rules: [{ from: 'nonexistent', canImport: ['service'] }],
  });
  assert(!result.valid, 'unknown layer should be invalid');
  assert(result.errors.some(e => e.includes('nonexistent')), 'should mention unknown layer');
});

test('rejects unknown canImport target', () => {
  const result = validatePolicy({
    layers: ['controller', 'service'],
    rules: [{ from: 'controller', canImport: ['ghost'] }],
  });
  assert(!result.valid, 'unknown target should be invalid');
});

test('rejects canImport/cannotImport overlap', () => {
  const result = validatePolicy({
    layers: ['controller', 'service'],
    rules: [{ from: 'controller', canImport: ['service'], cannotImport: ['service'] }],
  });
  assert(!result.valid, 'overlap should be invalid');
  assert(result.errors.some(e => e.includes('overlap')), 'should mention overlap');
});

test('validates boundaries', () => {
  const result = validatePolicy({
    layers: ['controller', 'service'],
    rules: [{ from: 'controller', canImport: ['service'] }],
    boundaries: [{ module: 'src/auth', canImportFrom: ['src/db'] }],
  });
  assert(result.valid, 'policy with boundaries should be valid');
});

test('rejects invalid boundaries', () => {
  const result = validatePolicy({
    layers: ['controller'],
    rules: [{ from: 'controller', canImport: [] }],
    boundaries: [{ module: null }],
  });
  assert(!result.valid, 'boundary without module should be invalid');
});

// ─── Generation ──────────────────────────────────────────────────────────────

suite('Architecture Policy — Generation');

test('generates policy from architecture detection', () => {
  const archResult = {
    layers: {
      controller: ['src/controllers/user.js', 'src/controllers/auth.js'],
      service: ['src/services/userService.js'],
      model: ['src/models/user.js'],
    },
    patterns: ['REST API', 'middleware pipeline'],
  };
  const policy = generatePolicy(archResult);
  assert(policy.layers.length >= 3, `should have >= 3 layers, got ${policy.layers.length}`);
  assert(policy.rules.length >= 3, `should have >= 3 rules, got ${policy.rules.length}`);
  assert(policy.fileStructure, 'should have fileStructure');
});

test('returns default policy for null input', () => {
  const policy = generatePolicy(null);
  assert(policy.layers.length > 0, 'should have default layers');
  assert(policy.rules.length > 0, 'should have default rules');
});

test('returns default policy for empty layers', () => {
  const policy = generatePolicy({ layers: {} });
  assert(policy.layers.length > 0, 'should fall back to defaults');
});

test('generates top-down rules', () => {
  const archResult = {
    layers: {
      controller: ['src/ctrl/a.js'],
      service: ['src/svc/b.js'],
      model: ['src/model/c.js'],
    },
  };
  const policy = generatePolicy(archResult);
  const ctrlRule = policy.rules.find(r => r.from === 'controller');
  assert(ctrlRule, 'should have controller rule');
  assert(ctrlRule.canImport.includes('service'), 'controller should import service');
  assert(ctrlRule.canImport.includes('model'), 'controller should import model');
});

test('util layer can import nothing', () => {
  const archResult = {
    layers: {
      service: ['src/svc/a.js'],
      util: ['src/utils/b.js'],
    },
  };
  const policy = generatePolicy(archResult);
  const utilRule = policy.rules.find(r => r.from === 'util');
  assert(utilRule, 'should have util rule');
  assertEqual(utilRule.canImport.length, 0);
});

test('extracts patterns from detection', () => {
  const archResult = {
    layers: { controller: ['src/ctrl.js'] },
    patterns: ['REST API'],
  };
  const policy = generatePolicy(archResult);
  assert(policy.patterns?.controller === 'REST', 'should extract REST pattern');
});

// ─── Conversion ──────────────────────────────────────────────────────────────

suite('Architecture Policy — Conversion');

test('policyToLayers converts correctly', () => {
  const policy = {
    layers: ['controller', 'service', 'model'],
    rules: [
      { from: 'controller', canImport: ['service', 'model'] },
      { from: 'service', canImport: ['model'] },
      { from: 'model', canImport: [] },
    ],
  };
  const { layers, allowed } = policyToLayers(policy);
  assertEqual(layers.length, 3);
  assert(layers[0].name === 'controller', 'first layer should be controller');
  assert(layers[0].dirs.includes('controllers'), 'should include known dirs');
  assert(allowed.controller.includes('service'), 'controller allowed to import service');
  assertEqual(allowed.model.length, 0);
});

test('policyToLayers uses fileStructure', () => {
  const policy = {
    layers: ['api'],
    rules: [{ from: 'api', canImport: [] }],
    fileStructure: { api: 'src/api-endpoints' },
  };
  const { layers } = policyToLayers(policy);
  assert(layers[0].dirs.includes('api-endpoints'), 'should include fileStructure dir');
});

test('policyToLayers handles null policy', () => {
  const { layers, allowed } = policyToLayers(null);
  assertEqual(layers.length, 0);
  assertEqual(Object.keys(allowed).length, 0);
});

test('policyToACF converts correctly', () => {
  const policy = {
    layers: ['controller', 'service'],
    rules: [{ from: 'controller', canImport: ['service'] }],
    fileStructure: { controller: 'src/ctrl' },
  };
  const acf = policyToACF(policy);
  assertEqual(acf.layers.length, 2);
  assertEqual(acf.rules.length, 1);
  assertEqual(acf.fileStructure.controller, 'src/ctrl');
});

test('policyToACF returns null for null policy', () => {
  assertEqual(policyToACF(null), null);
});

test('acfToPolicy converts correctly', () => {
  const acf = {
    layers: ['ui', 'service', 'model'],
    rules: [
      { from: 'ui', canImport: ['service'], cannotImport: ['model'] },
    ],
    fileStructure: { ui: 'src/components' },
  };
  const policy = acfToPolicy(acf);
  assertEqual(policy.layers.length, 3);
  assertEqual(policy.rules[0].from, 'ui');
  assertEqual(policy.rules[0].canImport[0], 'service');
  assertEqual(policy.fileStructure.ui, 'src/components');
});

test('roundtrip: policy → ACF → policy', () => {
  const original = {
    layers: ['controller', 'service', 'model'],
    rules: [
      { from: 'controller', canImport: ['service', 'model'] },
      { from: 'service', canImport: ['model'] },
      { from: 'model', canImport: [] },
    ],
    fileStructure: { controller: 'src/ctrl' },
  };
  const acf = policyToACF(original);
  const restored = acfToPolicy(acf);
  assertEqual(restored.layers.length, original.layers.length);
  assertEqual(restored.rules.length, original.rules.length);
});

// ─── DriftDetector.fromPolicy ────────────────────────────────────────────────

suite('Architecture Policy — DriftDetector.fromPolicy');

test('creates detector from valid policy', () => {
  const policy = {
    layers: ['controller', 'service', 'model'],
    rules: [
      { from: 'controller', canImport: ['service', 'model'] },
      { from: 'service', canImport: ['model'] },
      { from: 'model', canImport: [] },
    ],
  };
  const detector = DriftDetector.fromPolicy(policy);
  assert(detector instanceof DriftDetector, 'should be DriftDetector instance');
  assertEqual(detector._layers.length, 3);
  assert(detector._allowed.controller.includes('service'), 'should have correct rules');
});

test('falls back to defaults on null policy', () => {
  const detector = DriftDetector.fromPolicy(null);
  assert(detector instanceof DriftDetector, 'should return DriftDetector');
  assert(detector._layers.length > 0, 'should have default layers');
});

test('falls back to defaults on missing rules', () => {
  const detector = DriftDetector.fromPolicy({ layers: ['a'] });
  assert(detector instanceof DriftDetector, 'should return DriftDetector');
});

test('includes fileStructure dirs', () => {
  const policy = {
    layers: ['api'],
    rules: [{ from: 'api', canImport: [] }],
    fileStructure: { api: 'src/my-api' },
  };
  const detector = DriftDetector.fromPolicy(policy);
  assert(detector._layers[0].dirs.includes('my-api'), 'should include fileStructure dir');
});

test('includes known dirs for standard layers', () => {
  const policy = {
    layers: ['controller'],
    rules: [{ from: 'controller', canImport: [] }],
  };
  const detector = DriftDetector.fromPolicy(policy);
  assert(detector._layers[0].dirs.includes('controllers'), 'should include known dirs');
  assert(detector._layers[0].dirs.includes('handlers'), 'should include known dirs');
});

// ─── Load/Save Policy ────────────────────────────────────────────────────────

suite('Architecture Policy — Load/Save');

await testAsync('saves and loads policy from .c3/', async () => {
  await setup();
  const policy = {
    layers: ['controller', 'service'],
    rules: [{ from: 'controller', canImport: ['service'] }],
  };
  await savePolicy(TMP, policy);

  const loaded = await loadPolicy(TMP);
  assertEqual(loaded.layers.length, 2);
  assertEqual(loaded.rules[0].from, 'controller');
  await cleanup();
});

await testAsync('loads policy from ARCHITECTURE.json fallback', async () => {
  await setup();
  // No .c3/architecture-policy.json — but ARCHITECTURE.json exists
  const acf = {
    layers: ['ui', 'model'],
    rules: [{ from: 'ui', canImport: ['model'] }],
    fileStructure: {},
  };
  await writeFile(join(TMP, 'ARCHITECTURE.json'), JSON.stringify(acf), 'utf-8');

  const loaded = await loadPolicy(TMP);
  assertEqual(loaded.layers.length, 2);
  assertEqual(loaded.rules[0].from, 'ui');
  await cleanup();
});

await testAsync('returns null when no policy source exists', async () => {
  await setup();
  const loaded = await loadPolicy(TMP);
  assertEqual(loaded, null);
  await cleanup();
});

await testAsync('rejects invalid policy file', async () => {
  await setup();
  // Write an invalid policy
  await writeFile(join(TMP, '.c3', 'architecture-policy.json'), JSON.stringify({
    layers: [],  // empty — invalid
    rules: [],
  }), 'utf-8');
  // Should fall through to null (no ARCHITECTURE.json either)
  const loaded = await loadPolicy(TMP);
  assertEqual(loaded, null);
  await cleanup();
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
