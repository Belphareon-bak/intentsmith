// tests/concept-registry.test.js — Concept Registry v102b tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  ConceptRegistry,
  CONCEPT_SIGNATURES,
  conceptRegistry,
} from '../src/code-intel/concept-registry.js';

// ─── Helper: build file entries ────────────────────────────────────────────

function file(path, opts = {}) {
  return {
    file: path,
    content: opts.content || '',
    symbols: opts.symbols || [],
    imports: opts.imports || [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 1: Concept Signatures
// ═══════════════════════════════════════════════════════════════════════════

suite('CONCEPT_SIGNATURES structure');

test('signatures is a non-empty array', () => {
  assert(Array.isArray(CONCEPT_SIGNATURES), 'should be array');
  assert(CONCEPT_SIGNATURES.length >= 10, `expected at least 10, got ${CONCEPT_SIGNATURES.length}`);
});

test('each signature has required fields', () => {
  for (const sig of CONCEPT_SIGNATURES) {
    assert(typeof sig.name === 'string' && sig.name.length > 0, `missing name`);
    assert(Array.isArray(sig.pathPatterns), `${sig.name}: missing pathPatterns`);
    assert(Array.isArray(sig.symbolPatterns), `${sig.name}: missing symbolPatterns`);
    assert(Array.isArray(sig.contentPatterns), `${sig.name}: missing contentPatterns`);
    assert(Array.isArray(sig.importPatterns), `${sig.name}: missing importPatterns`);
  }
});

test('concept names are unique', () => {
  const names = CONCEPT_SIGNATURES.map(s => s.name);
  const unique = new Set(names);
  assertEqual(unique.size, names.length, 'duplicate concept names detected');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 2: Path-based classification
// ═══════════════════════════════════════════════════════════════════════════

suite('Path-based concept detection');

test('auth directory → authentication', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/login.js')]);
  const concepts = reg.getConceptsForFile('src/auth/login.js');
  assert(concepts.includes('authentication'), `expected authentication, got ${concepts}`);
});

test('controllers directory → routing', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/routes/users.js')]);
  const concepts = reg.getConceptsForFile('src/routes/users.js');
  assert(concepts.includes('routing'), `expected routing, got ${concepts}`);
});

test('models directory → database', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/models/user.js')]);
  const concepts = reg.getConceptsForFile('src/models/user.js');
  assert(concepts.includes('database'), `expected database, got ${concepts}`);
});

test('test file → testing', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('tests/auth.test.js')]);
  const concepts = reg.getConceptsForFile('tests/auth.test.js');
  assert(concepts.includes('testing'), `expected testing, got ${concepts}`);
});

test('config directory → configuration', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/config/database.js')]);
  const concepts = reg.getConceptsForFile('src/config/database.js');
  assert(concepts.includes('configuration'), `expected configuration, got ${concepts}`);
});

test('file with no matching path → empty concepts', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/index.js')]);
  const concepts = reg.getConceptsForFile('src/index.js');
  assertEqual(concepts.length, 0, 'should have no concepts');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 3: Symbol-based classification
// ═══════════════════════════════════════════════════════════════════════════

suite('Symbol-based concept detection');

test('authenticate symbol → authentication', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/middleware/verify.js', { symbols: ['authenticate', 'verifyToken'] })]);
  const concepts = reg.getConceptsForFile('src/middleware/verify.js');
  assert(concepts.includes('authentication'), `expected authentication, got ${concepts}`);
});

test('validate symbol → validation', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/utils/input.js', { symbols: ['validate', 'sanitize'] })]);
  const concepts = reg.getConceptsForFile('src/utils/input.js');
  assert(concepts.includes('validation'), `expected validation, got ${concepts}`);
});

test('logger symbol → logging', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/core/setup.js', { symbols: ['createLogger', 'logInfo'] })]);
  const concepts = reg.getConceptsForFile('src/core/setup.js');
  assert(concepts.includes('logging'), `expected logging, got ${concepts}`);
});

test('concept tracks symbols that matched', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/login.js', { symbols: ['authenticate', 'hashPassword', 'renderForm'] })]);
  const concept = reg.getConcept('authentication');
  assert(concept !== null, 'should have authentication concept');
  assert(concept.symbols.has('authenticate'), 'should track authenticate');
  assert(concept.symbols.has('hashPassword'), 'should track hashPassword');
  assert(!concept.symbols.has('renderForm'), 'should not track renderForm');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 4: Content-based classification
// ═══════════════════════════════════════════════════════════════════════════

suite('Content-based concept detection');

test('jwt + bcrypt content → authentication', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/utils/crypto.js', {
    content: 'const token = jwt.sign(payload, secret);\nconst hash = bcrypt.hash(password, 10);',
  })]);
  const concepts = reg.getConceptsForFile('src/utils/crypto.js');
  assert(concepts.includes('authentication'), `expected authentication, got ${concepts}`);
});

test('SQL content → database', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/helpers/data.js', {
    content: 'db.query("SELECT * FROM users WHERE id = ?", [id]);\nconst schema = mongoose.model("User", schema);',
  })]);
  const concepts = reg.getConceptsForFile('src/helpers/data.js');
  assert(concepts.includes('database'), `expected database, got ${concepts}`);
});

test('single content match is not enough (needs score >= 2)', () => {
  const reg = new ConceptRegistry();
  // Only one content match for logging (console.log), no path/symbol/import match
  reg.scan([file('src/index.js', { content: 'console.log("hello");' })]);
  const concepts = reg.getConceptsForFile('src/index.js');
  // Score: 1 (one content match) < 2 threshold
  assert(!concepts.includes('logging'), 'single content match should not trigger concept');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 5: Import-based classification
// ═══════════════════════════════════════════════════════════════════════════

suite('Import-based concept detection');

test('bcrypt + jsonwebtoken imports → authentication', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/utils/token.js', { imports: ['jsonwebtoken', 'bcrypt'] })]);
  const concepts = reg.getConceptsForFile('src/utils/token.js');
  assert(concepts.includes('authentication'), `expected authentication, got ${concepts}`);
});

test('zod + joi imports → validation', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/shared/check.js', { imports: ['zod', 'joi'] })]);
  const concepts = reg.getConceptsForFile('src/shared/check.js');
  assert(concepts.includes('validation'), `expected validation, got ${concepts}`);
});

test('single import not enough without other signals', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/utils/helper.js', { imports: ['bcrypt'] })]);
  const concepts = reg.getConceptsForFile('src/utils/helper.js');
  // Score: 1 (one import) < 2 threshold
  assert(!concepts.includes('authentication'), 'single import should not trigger');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 6: Multi-signal classification
// ═══════════════════════════════════════════════════════════════════════════

suite('Multi-signal classification');

test('path + symbol → detected (score 4)', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/service.js', { symbols: ['authenticate'] })]);
  const concepts = reg.getConceptsForFile('src/auth/service.js');
  assert(concepts.includes('authentication'), 'path + symbol should detect');
});

test('import + content → detected (score 2)', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/utils/helper.js', {
    imports: ['bcrypt'],
    content: 'const hash = bcrypt.hash(password, 10);',
  })]);
  const concepts = reg.getConceptsForFile('src/utils/helper.js');
  assert(concepts.includes('authentication'), 'import + content should detect');
});

test('file can belong to multiple concepts', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/validate-token.js', {
    symbols: ['validateToken', 'validate'],
    content: 'jwt.verify(token, secret);',
  })]);
  const concepts = reg.getConceptsForFile('src/auth/validate-token.js');
  assert(concepts.includes('authentication'), 'should detect authentication');
  assert(concepts.includes('validation'), 'should detect validation');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 7: Query API
// ═══════════════════════════════════════════════════════════════════════════

suite('Query API');

test('getConceptNames returns all detected concepts', () => {
  const reg = new ConceptRegistry();
  reg.scan([
    file('src/auth/login.js'),
    file('src/db/connection.js', { content: 'SELECT * FROM users' }),
    file('src/db/schema.js', { content: 'CREATE TABLE users' }),
  ]);
  const names = reg.getConceptNames();
  assert(names.includes('authentication'), 'should have authentication');
  assert(names.includes('database'), 'should have database');
});

test('getFilesForConcept returns all files', () => {
  const reg = new ConceptRegistry();
  reg.scan([
    file('src/auth/login.js'),
    file('src/auth/register.js'),
    file('src/auth/verify.js'),
  ]);
  const files = reg.getFilesForConcept('authentication');
  assertEqual(files.length, 3, 'should have 3 files');
});

test('getConcept returns null for unknown', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/login.js')]);
  assertEqual(reg.getConcept('nonexistent'), null);
});

test('milestoneId is tracked', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/login.js')], { milestoneId: 'ms-1' });
  const concept = reg.getConcept('authentication');
  assert(concept.milestoneIds.has('ms-1'), 'should track milestoneId');
});

test('clear resets all state', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/login.js')]);
  reg.clear();
  assertEqual(reg.getConceptNames().length, 0, 'should be empty');
  assertEqual(reg.getConceptsForFile('src/auth/login.js').length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 8: Fragmentation Analysis
// ═══════════════════════════════════════════════════════════════════════════

suite('Fragmentation analysis');

test('single-module concept → no fragmentation', () => {
  const reg = new ConceptRegistry();
  reg.scan([
    file('src/auth/login.js'),
    file('src/auth/register.js'),
    file('src/auth/verify.js'),
  ]);
  const frag = reg.getFragmentation();
  // All files in src/auth → 1 module → not fragmented (excluded)
  assertEqual(frag.length, 0, 'should report no fragmentation');
});

test('multi-module concept → fragmentation detected', () => {
  const reg = new ConceptRegistry();
  reg.scan([
    file('src/auth/login.js'),
    file('src/middleware/verify.js', { symbols: ['verifyToken'] }),
    file('src/utils/token.js', { imports: ['jsonwebtoken', 'bcrypt'] }),
  ]);
  const frag = reg.getFragmentation();
  assert(frag.length > 0, 'should detect fragmentation');
  const authFrag = frag.find(f => f.concept === 'authentication');
  assert(authFrag !== undefined, 'should have auth fragmentation');
  assert(authFrag.modules >= 2, `expected >= 2 modules, got ${authFrag.modules}`);
  assert(authFrag.fragmentation >= 0.5, `expected frag >= 0.5, got ${authFrag.fragmentation}`);
});

test('fragmentation formula: 2 modules → 0.5, 3 modules → 0.67', () => {
  // Manually check formula: 1 - 1/N
  const frag2 = Math.round((1 - 1 / 2) * 100) / 100;
  assertEqual(frag2, 0.5, '2 modules should give 0.5');
  const frag3 = Math.round((1 - 1 / 3) * 100) / 100;
  assertEqual(frag3, 0.67, '3 modules should give 0.67');
});

test('fragmentation sorted by score descending', () => {
  const reg = new ConceptRegistry();
  reg.scan([
    // Auth in 3 modules
    file('src/auth/login.js'),
    file('src/middleware/auth.js', { symbols: ['authenticate'] }),
    file('src/utils/token.js', { imports: ['jsonwebtoken', 'bcrypt'] }),
    // DB in 2 modules
    file('src/db/connection.js', { content: 'db.query("SELECT * FROM users");\nconst s = mongoose.model();' }),
    file('src/models/user.js'),
  ]);
  const frag = reg.getFragmentation();
  if (frag.length >= 2) {
    assert(frag[0].fragmentation >= frag[1].fragmentation, 'should be sorted descending');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 9: Drift Detection
// ═══════════════════════════════════════════════════════════════════════════

suite('Drift detection');

test('new concept detected', () => {
  const prev = new ConceptRegistry();
  prev.scan([file('src/auth/login.js')]);

  const curr = new ConceptRegistry();
  curr.scan([
    file('src/auth/login.js'),
    file('src/db/connection.js', { content: 'db.query("SELECT * FROM users");\nmongoose.model("User");' }),
    file('src/models/user.js'),
  ]);

  const drifts = curr.detectDrift(prev);
  const newConcept = drifts.find(d => d.type === 'NEW_CONCEPT' && d.concept === 'database');
  assert(newConcept !== undefined, 'should detect new database concept');
});

test('concept spread to new module', () => {
  const prev = new ConceptRegistry();
  prev.scan([
    file('src/auth/login.js'),
    file('src/auth/register.js'),
  ]);

  const curr = new ConceptRegistry();
  curr.scan([
    file('src/auth/login.js'),
    file('src/auth/register.js'),
    file('src/middleware/verify.js', { symbols: ['verifyToken'] }),
  ]);

  const drifts = curr.detectDrift(prev);
  const spread = drifts.find(d => d.type === 'CONCEPT_SPREAD' && d.concept === 'authentication');
  assert(spread !== undefined, `should detect concept spread, got types: ${drifts.map(d => d.type)}`);
  assert(spread.details.newModules.includes('src/middleware'), `should include src/middleware`);
});

test('concept removed', () => {
  const prev = new ConceptRegistry();
  prev.scan([
    file('src/cache/store.js'),
    file('src/cache/redis.js'),
  ]);

  const curr = new ConceptRegistry();
  curr.scan([file('src/auth/login.js')]);

  const drifts = curr.detectDrift(prev);
  const removed = drifts.find(d => d.type === 'CONCEPT_REMOVED' && d.concept === 'caching');
  assert(removed !== undefined, 'should detect concept removal');
});

test('no drift when nothing changed', () => {
  const files = [
    file('src/auth/login.js'),
    file('src/auth/register.js'),
  ];

  const prev = new ConceptRegistry();
  prev.scan(files);

  const curr = new ConceptRegistry();
  curr.scan(files);

  const drifts = curr.detectDrift(prev);
  assertEqual(drifts.length, 0, 'should detect no drift');
});

test('drift against null/empty previous returns empty', () => {
  const curr = new ConceptRegistry();
  curr.scan([file('src/auth/login.js')]);

  assertEqual(curr.detectDrift(null).length, 0, 'null previous');
  assertEqual(curr.detectDrift(new ConceptRegistry()).length, 0, 'empty previous');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 10: Prompt Formatting
// ═══════════════════════════════════════════════════════════════════════════

suite('Prompt formatting');

test('formatForPrompt with fragmented concepts', () => {
  const reg = new ConceptRegistry();
  reg.scan([
    file('src/auth/login.js'),
    file('src/middleware/auth.js', { symbols: ['authenticate'] }),
    file('src/utils/token.js', { imports: ['jsonwebtoken', 'bcrypt'] }),
  ]);
  const text = reg.formatForPrompt(0.5);
  assert(text.includes('Concept Fragmentation'), 'should have header');
  assert(text.includes('authentication'), 'should mention authentication');
});

test('formatForPrompt empty when no fragmentation', () => {
  const reg = new ConceptRegistry();
  reg.scan([file('src/auth/login.js')]);
  assertEqual(reg.formatForPrompt(0.5), '', 'should be empty');
});

test('static formatDriftForCheckpoint', () => {
  const drifts = [
    { concept: 'auth', type: 'CONCEPT_SPREAD', message: 'auth spread to src/utils' },
  ];
  const text = ConceptRegistry.formatDriftForCheckpoint(drifts);
  assert(text.includes('Concept Drift'), 'should have header');
  assert(text.includes('CONCEPT_SPREAD'), 'should include type');
});

test('static formatDriftForCheckpoint empty for no drifts', () => {
  assertEqual(ConceptRegistry.formatDriftForCheckpoint([]), '');
  assertEqual(ConceptRegistry.formatDriftForCheckpoint(null), '');
});

// ═══════════════════════════════════════════════════════════════════════════
//  Suite 11: Singleton
// ═══════════════════════════════════════════════════════════════════════════

suite('Singleton');

test('conceptRegistry is a ConceptRegistry instance', () => {
  assert(conceptRegistry instanceof ConceptRegistry, 'should be ConceptRegistry');
});

test('singleton can scan and clear independently', () => {
  conceptRegistry.scan([file('src/auth/login.js')]);
  assert(conceptRegistry.getConceptNames().length > 0, 'should have concepts');
  conceptRegistry.clear();
  assertEqual(conceptRegistry.getConceptNames().length, 0, 'should be clear');
});

// ═══════════════════════════════════════════════════════════════════════════

const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);
