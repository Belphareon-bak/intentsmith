// v121: Manifest v2 Validation + Boot Order — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';

const { _testLoaderInternals, SpecialistLoader } = await import('../src/specialists/specialist-loader.js');
const { validateManifest, checkEngineCompat } = _testLoaderInternals;

// ─── Manifest v2 Validation ──────────────────────────────────────────────────

suite('manifest v2: validation');

const VALID_BASE = {
  id: 'test-specialist',
  version: '1.0.0',
  name: 'Test',
  domain: 'test',
  type: 'domain',
  engine: '>=65.0.0',
  entry: './index.js',
};

test('v1 manifest validates (backwards compat)', () => {
  const result = validateManifest({ ...VALID_BASE });
  assert(result.valid, `should be valid: ${result.errors?.join(', ')}`);
});

test('v2 manifest with manifestVersion 2 validates', () => {
  const result = validateManifest({ ...VALID_BASE, manifestVersion: 2 });
  assert(result.valid, `should be valid: ${result.errors?.join(', ')}`);
});

test('invalid manifestVersion rejects', () => {
  const result = validateManifest({ ...VALID_BASE, manifestVersion: 3 });
  assert(!result.valid, 'manifestVersion 3 should be invalid');
  assert(result.errors.some(e => e.includes('manifestVersion')));
});

test('manifestVersion defaults to 1 (no field)', () => {
  const manifest = { ...VALID_BASE };
  delete manifest.manifestVersion;
  const result = validateManifest(manifest);
  assert(result.valid, `should be valid with default v1: ${result.errors?.join(', ')}`);
});

// ─── Capabilities Validation ─────────────────────────────────────────────────

suite('manifest v2: capabilities');

test('valid capabilities pass', () => {
  const result = validateManifest({
    ...VALID_BASE,
    manifestVersion: 2,
    capabilities: ['tax.calculate', 'vat.compute', 'salary.compute'],
  });
  assert(result.valid, `should be valid: ${result.errors?.join(', ')}`);
});

test('empty capabilities array is valid', () => {
  const result = validateManifest({
    ...VALID_BASE,
    capabilities: [],
  });
  assert(result.valid, `empty capabilities should be valid: ${result.errors?.join(', ')}`);
});

test('no capabilities field is valid (v1 compat)', () => {
  const result = validateManifest(VALID_BASE);
  assert(result.valid);
});

test('invalid capability notation rejects', () => {
  const result = validateManifest({
    ...VALID_BASE,
    capabilities: ['INVALID'],
  });
  assert(!result.valid, 'uppercase should be invalid');
  assert(result.errors.some(e => e.includes('dotted notation')));
});

test('capability without dot rejects', () => {
  const result = validateManifest({
    ...VALID_BASE,
    capabilities: ['taxcalculate'],
  });
  assert(!result.valid, 'no dot should be invalid');
});

test('capability starting with number rejects', () => {
  const result = validateManifest({
    ...VALID_BASE,
    capabilities: ['1tax.calc'],
  });
  assert(!result.valid, 'starting with number should be invalid');
});

test('capabilities as non-array rejects', () => {
  const result = validateManifest({
    ...VALID_BASE,
    capabilities: 'tax.calculate',
  });
  assert(!result.valid, 'string should be invalid');
  assert(result.errors.some(e => e.includes('array')));
});

// ─── Engine Compatibility ────────────────────────────────────────────────────

suite('manifest v2: engine compatibility');

test('compatible version passes', () => {
  const r = checkEngineCompat('>=121.0.0', '121.0.0');
  assert(r.compatible);
});

test('higher version passes', () => {
  const r = checkEngineCompat('>=121.0.0', '122.0.0');
  assert(r.compatible);
});

test('lower version fails', () => {
  const r = checkEngineCompat('>=121.0.0', '120.0.0');
  assert(!r.compatible);
  assert(r.error.includes('121'));
});

test('unparseable engine passes with warning', () => {
  const r = checkEngineCompat('~121.0.0', '121.0.0');
  assert(r.compatible);
  assert(r.warning);
});

// ─── defaultExpertise Validation ─────────────────────────────────────────────

suite('manifest v2: defaultExpertise');

test('string defaultExpertise is valid', () => {
  const result = validateManifest({
    ...VALID_BASE,
    defaultExpertise: './expertise.json',
  });
  assert(result.valid, `should be valid: ${result.errors?.join(', ')}`);
});

test('non-string defaultExpertise rejects', () => {
  const result = validateManifest({
    ...VALID_BASE,
    defaultExpertise: 123,
  });
  assert(!result.valid);
  assert(result.errors.some(e => e.includes('defaultExpertise')));
});

// ─── Deterministic Boot Order ────────────────────────────────────────────────

suite('manifest v2: deterministic boot order');

test('topological sort produces alphabetical order for same-depth', () => {
  // Use SpecialistLoader's _topologicalSort via a mock instance
  const mockDb = {
    prepare: () => ({
      run: () => {},
      get: () => null,
      all: () => [],
    }),
    exec: () => {},
  };
  const mockRuntime = {
    registerSpecialist: () => {},
    unregisterSpecialist: () => {},
    isSpecialist: () => false,
  };

  const loader = new SpecialistLoader(mockDb, mockRuntime, {
    baseDir: '/tmp/test-specialists',
    engineVersion: '121.0.0',
  });

  // No dependencies — all same depth, should be alphabetical
  const rows = [
    { id: 'charlie' },
    { id: 'alpha' },
    { id: 'bravo' },
  ];

  // Mock _getManifestFromDiscovered to return no dependencies
  loader._getManifestFromDiscovered = () => ({});

  const sorted = loader._topologicalSort(rows);
  assertEqual(sorted[0].id, 'alpha');
  assertEqual(sorted[1].id, 'bravo');
  assertEqual(sorted[2].id, 'charlie');
});

test('topological sort respects dependencies before alphabetical', () => {
  const mockDb = {
    prepare: () => ({
      run: () => {},
      get: () => null,
      all: () => [],
    }),
    exec: () => {},
  };
  const mockRuntime = {};
  const loader = new SpecialistLoader(mockDb, mockRuntime, {
    baseDir: '/tmp/test-specialists',
    engineVersion: '121.0.0',
  });

  const rows = [
    { id: 'charlie' },
    { id: 'alpha' },
    { id: 'bravo' },
  ];

  // bravo depends on charlie → charlie must come before bravo
  const manifests = {
    charlie: {},
    alpha: {},
    bravo: { dependencies: { charlie: '>=1.0.0' } },
  };
  loader._getManifestFromDiscovered = (id) => manifests[id] || {};

  const sorted = loader._topologicalSort(rows);

  // alpha and charlie have no deps (same depth), should be alphabetical
  assertEqual(sorted[0].id, 'alpha');
  assertEqual(sorted[1].id, 'charlie');
  // bravo depends on charlie, comes last
  assertEqual(sorted[2].id, 'bravo');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
