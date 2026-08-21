// tests/validation-suites.test.js — Validation Test Suites v123
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  SUITES, VALIDATION_VERSION, VALIDATION_TTL_DAYS, BLACKLIST_THRESHOLD,
  getSuiteForRole, getRolesForSuite, getRelevantSuites,
  ValidationRunner, generatePNG, getTestImages, countCzechDiacritics,
} from '../src/upgrade/validation-suites.js';
import { scoreModel, EVALUATION_VERSION } from '../src/upgrade/model-ranker.js';
import Database from 'better-sqlite3';

// ─── Suite: Definitions ────────────────────────────────────────────────────

suite('Suite Definitions');

test('has exactly 6 suites', () => {
  const names = Object.keys(SUITES);
  assertEqual(names.length, 6);
  assert(names.includes('reasoning'));
  assert(names.includes('code'));
  assert(names.includes('chat'));
  assert(names.includes('vision'));
  assert(names.includes('review'));
  // `code_patch` hodnotí spuštěním skrytého testu, ne klíčovými slovy.
  assert(names.includes('code_patch'));
});

test('each suite has name, description, roles, tests', () => {
  for (const [key, s] of Object.entries(SUITES)) {
    assertEqual(s.name, key, `${key}.name`);
    assert(s.description.length > 0, `${key}.description`);
    assert(Array.isArray(s.roles), `${key}.roles`);
    // `code_patch` je záměrně bez rolí: vazba role na sadu se nemění
    // automaticky, přepnutí potvrzuje operátor ručně (viz hlavička sady).
    if (key !== 'code_patch') assert(s.roles.length > 0, `${key}.roles.length`);
    assert(Array.isArray(s.tests), `${key}.tests`);
    // `code_patch` má velikost danou kalibrací, ne návrhem: běžně měří jen
    // úlohy, na kterých se modely liší, a ostatní drží v rezervě.  Pevný
    // spodní počet by nutil držet v sadě úlohy, které nic neměří — přesně to,
    // čím trpěla stará sada `code`.
    const minTests = key === 'code_patch' ? 1 : 6;
    assert(s.tests.length >= minTests, `${key} should have ≥${minTests} tests, got ${s.tests.length}`);
  }
});

test('each test has name, prompt (function), grade (function)', () => {
  for (const [suiteName, s] of Object.entries(SUITES)) {
    for (const t of s.tests) {
      assert(typeof t.name === 'string', `${suiteName}.${t.name} name`);
      assert(typeof t.prompt === 'function', `${suiteName}.${t.name} prompt`);
      assert(typeof t.grade === 'function', `${suiteName}.${t.name} grade`);
    }
  }
});

test('test names are unique within suites', () => {
  for (const [suiteName, s] of Object.entries(SUITES)) {
    const names = s.tests.map(t => t.name);
    const unique = new Set(names);
    assertEqual(names.length, unique.size, `${suiteName} has duplicate test names`);
  }
});

test('prompts return strings or objects with text', () => {
  for (const [suiteName, s] of Object.entries(SUITES)) {
    for (const t of s.tests) {
      const result = t.prompt();
      const valid = typeof result === 'string' ||
        (typeof result === 'object' && typeof result.text === 'string') ||
        (typeof result === 'object' && result._expected != null);
      assert(valid, `${suiteName}.${t.name} prompt() returned invalid type`);
    }
  }
});

test('grade returns { passed: boolean, score: number }', () => {
  for (const [suiteName, s] of Object.entries(SUITES)) {
    for (const t of s.tests) {
      const result = t.grade('test response');
      assert(typeof result.passed === 'boolean', `${suiteName}.${t.name} grade.passed`);
      assert(typeof result.score === 'number', `${suiteName}.${t.name} grade.score`);
      assert(result.score >= 0 && result.score <= 1, `${suiteName}.${t.name} score range`);
    }
  }
});

// ─── Suite: Role Mapping ───────────────────────────────────────────────────

suite('Role Mapping');

test('getSuiteForRole returns correct suite', () => {
  assertEqual(getSuiteForRole('D1'), 'reasoning');
  assertEqual(getSuiteForRole('D2'), 'reasoning');
  assertEqual(getSuiteForRole('CODE'), 'code');
  assertEqual(getSuiteForRole('R1'), 'reasoning');
  assertEqual(getSuiteForRole('R2'), 'review');
  assertEqual(getSuiteForRole('CHAT'), 'chat');
  assertEqual(getSuiteForRole('VISION'), 'vision');
});

test('getSuiteForRole returns null for unknown role', () => {
  assertEqual(getSuiteForRole('UNKNOWN'), null);
});

test('getRolesForSuite returns correct roles', () => {
  const reasoningRoles = getRolesForSuite('reasoning');
  assert(reasoningRoles.includes('D1'));
  assert(reasoningRoles.includes('D2'));
  assert(reasoningRoles.includes('R1'));
  assertEqual(reasoningRoles.length, 3);
});

test('getRolesForSuite code returns CODE', () => {
  const roles = getRolesForSuite('code');
  assert(roles.includes('CODE'));
  assertEqual(roles.length, 1);
});

test('getRelevantSuites returns all unique suites', () => {
  const suites = getRelevantSuites('any-model');
  assert(suites.includes('reasoning'));
  assert(suites.includes('code'));
  assert(suites.includes('chat'));
  assert(suites.includes('vision'));
  assert(suites.includes('review'));
});

// ─── Suite: Reasoning Grading ──────────────────────────────────────────────

suite('Reasoning Suite Grading');

test('json_compliance: valid JSON with all keys → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'json_compliance');
  const result = t.grade('{"name":"Karel","age":35,"hobbies":["čtení","běh"]}');
  assert(result.passed, 'should pass');
  assert(result.score >= 0.7, `score ${result.score} >= 0.7`);
});

test('json_compliance: invalid JSON → fail', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'json_compliance');
  const result = t.grade('Not valid JSON at all');
  assert(!result.passed, 'should fail');
  assertEqual(result.score, 0);
});

test('json_compliance: JSON in code block → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'json_compliance');
  const result = t.grade('```json\n{"name":"Karel","age":35,"hobbies":["a","b"]}\n```');
  assert(result.passed, 'should pass with code block');
});

test('logic_puzzle: Cynthia → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'logic_puzzle');
  assert(t.grade('Cynthia je nejvyšší.').passed);
  assert(t.grade('cynthia').passed);
  assert(!t.grade('Alice').passed);
});

test('math_basic: correct answer → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'math_basic');
  // math_basic generates random numbers, so we test with explicit context
  const result = t.grade('Výsledek je 391.', { _expected: '391' });
  assert(result.passed);
});

test('math_basic: wrong answer → fail', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'math_basic');
  const result = t.grade('Výsledek je 392.', { _expected: '391' });
  assert(!result.passed);
});

test('multi_step_plan: 5-element array → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'multi_step_plan');
  const result = t.grade('["krok1","krok2","krok3","krok4","krok5"]');
  assert(result.passed);
  assertEqual(result.score, 1);
});

test('multi_step_plan: 3-element array → partial', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'multi_step_plan');
  const result = t.grade('["a","b","c"]');
  assert(!result.passed);
  assert(result.score > 0, 'partial score');
});

test('cause_effect: boiling keywords → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'cause_effect');
  assert(t.grade('Voda se začne vařit a přeměňovat na páru.').passed, 'vařit matches vař');
  assert(t.grade('Water will boil.').passed, 'boil matches');
  assert(t.grade('Voda se vypaří.').passed, 'vypaří matches vypař');
  assert(!t.grade('Nic se nestane.').passed, 'no keywords');
});

test('categorization: valid JSON with categories → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'categorization');
  const result = t.grade('{"zvířata":["pes","kočka"],"ovoce":["jablko","hruška"],"doprava":["auto","kolo"]}');
  assert(result.passed);
});

test('instruction_follow: exactly 3 sentences → pass', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'instruction_follow');
  const result = t.grade('Kosmonautika je fascinující obor. Lidé poprvé přistáli na Měsíci v roce 1969. Dnes se plánují mise na Mars.');
  assert(result.passed);
  assertEqual(result.score, 1);
});

test('instruction_follow: 5 sentences → partial', () => {
  const t = SUITES.reasoning.tests.find(t => t.name === 'instruction_follow');
  const result = t.grade('A. B. C. D. E.');
  assert(!result.passed);
});

// ─── Suite: Code Grading ───────────────────────────────────────────────────

suite('Code Suite Grading');

test('function_gen: proper function → pass', () => {
  const t = SUITES.code.tests.find(t => t.name === 'function_gen');
  const result = t.grade('function isPrime(n) {\n  for (let i = 2; i * i <= n; i++) {\n    if (n % i === 0) return false;\n  }\n  return n > 1;\n}');
  assert(result.passed);
  assert(result.score >= 0.7);
});

test('function_gen: no function keyword → fail', () => {
  const t = SUITES.code.tests.find(t => t.name === 'function_gen');
  const result = t.grade('Just check if n is prime by dividing.');
  assert(!result.passed);
});

test('bug_fix: both fixes → pass', () => {
  const t = SUITES.code.tests.find(t => t.name === 'bug_fix');
  const result = t.grade('function sum(arr) {\n  let total = 0;\n  for (let i = 0; i < arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}');
  assert(result.passed);
  assertEqual(result.score, 1.0);
});

test('bug_fix: only one fix → partial', () => {
  const t = SUITES.code.tests.find(t => t.name === 'bug_fix');
  const result = t.grade('let total = 0; // fixed initialization\nfor (let i = 0; i <= arr.length; i++)');
  assert(!result.passed);
  assertEqual(result.score, 0.5);
});

test('code_review: multiple issues found → pass with partial scoring', () => {
  const t = SUITES.code.tests.find(t => t.name === 'code_review');
  const r3 = t.grade('eval je nebezpečný, SQL injection risk, command execution');
  assert(r3.passed);
  assertEqual(r3.score, 1.0);

  const r2 = t.grade('eval is dangerous and SQL injection');
  assert(r2.passed);
  assert(r2.score >= 0.6);

  const r1 = t.grade('eval is bad');
  assert(!r1.passed);
  assertEqual(r1.score, 0.3);

  const r0 = t.grade('Code looks fine to me.');
  assert(!r0.passed);
  assertEqual(r0.score, 0);
});

test('refactor: 2 arrow functions → pass', () => {
  const t = SUITES.code.tests.find(t => t.name === 'refactor');
  const result = t.grade('const add = (a, b) => a + b;\nconst multiply = (a, b) => a * b;');
  assert(result.passed);
  assertEqual(result.score, 1.0);
});

test('refactor: 1 arrow function → partial', () => {
  const t = SUITES.code.tests.find(t => t.name === 'refactor');
  const result = t.grade('const add = (a, b) => a + b;\nfunction multiply(a, b) { return a * b; }');
  assert(!result.passed);
  assertEqual(result.score, 0.5);
});

test('test_gen: test keyword + add → pass', () => {
  const t = SUITES.code.tests.find(t => t.name === 'test_gen');
  const result = t.grade('test("add returns sum", () => {\n  expect(add(1, 2)).toBe(3);\n});');
  assert(result.passed);
});

// ─── Suite: Chat Grading ───────────────────────────────────────────────────

suite('Chat Suite Grading');

test('czech_quality: diacritics → pass', () => {
  const t = SUITES.chat.tests.find(t => t.name === 'czech_quality');
  // "příšerně žluťoučký" has 7+ diacritics
  const r5 = t.grade('Praha má příšerně krásné náměstí a historické pamětihodnosti.');
  assert(r5.passed, '≥5 diacritics');
  assertEqual(r5.score, 1.0);

  // "á, ě, ý" = 3 diacritics
  const r3 = t.grade('Město má hezký hrad.');
  assert(r3.passed, '≥3 diacritics');
  assertEqual(r3.score, 0.7);
});

test('czech_quality: no diacritics → fail', () => {
  const t = SUITES.chat.tests.find(t => t.name === 'czech_quality');
  const result = t.grade('Prague is a nice city.');
  assert(!result.passed);
});

test('instruction_follow: "ne" → pass', () => {
  const t = SUITES.chat.tests.find(t => t.name === 'instruction_follow');
  assert(t.grade('ne').passed);
  assert(t.grade('Ne.').passed);
  assert(t.grade('Není.').passed);
  assert(!t.grade('ano').passed);
  assert(!t.grade('Země je kulatá').passed);
});

test('summarization: short + relevant → pass', () => {
  const t = SUITES.chat.tests.find(t => t.name === 'summarization');
  const result = t.grade('AI je obor informatiky zabývající se tvorbou inteligentních systémů.');
  assert(result.passed);
});

test('factual: Shakespeare → pass', () => {
  const t = SUITES.chat.tests.find(t => t.name === 'factual');
  assert(t.grade('William Shakespeare napsal Romeo a Julii.').passed);
  assert(!t.grade('Dostojevskij napsal toto dílo.').passed);
});

test('multilingual: translation → pass', () => {
  const t = SUITES.chat.tests.find(t => t.name === 'multilingual');
  assert(t.grade('Hello, how are you?').passed);
  assert(t.grade('Good day, how do you do?').passed);
  assert(!t.grade('Hola, como estas?').passed);
});

// ─── Suite: Vision Grading ─────────────────────────────────────────────────

suite('Vision Suite Grading');

test('capability_check: any response > 10 chars → pass', () => {
  const t = SUITES.vision.tests.find(t => t.name === 'capability_check');
  assert(t.grade('This is a red pixel image.').passed);
  assert(!t.grade('short').passed);
});

test('color_detect: red keywords → pass', () => {
  const t = SUITES.vision.tests.find(t => t.name === 'color_detect');
  assert(t.grade('červená').passed);
  assert(t.grade('The image shows red color.').passed);
  assert(!t.grade('modrá').passed);
});

test('count_objects: 3 → pass', () => {
  const t = SUITES.vision.tests.find(t => t.name === 'count_objects');
  assert(t.grade('Na obrázku jsou 3 barevné body.').passed);
  assert(t.grade('three dots').passed);
  assert(!t.grade('four dots').passed);
});

test('no_image_guard: acknowledges missing image → pass', () => {
  const t = SUITES.vision.tests.find(t => t.name === 'no_image_guard');
  assert(t.grade('Nevidím žádný obrázek.').passed);
  assert(t.grade('No image was provided.').passed);
  assert(!t.grade('The image shows a beautiful landscape.').passed);
});

test('color_names: partial scoring', () => {
  const t = SUITES.vision.tests.find(t => t.name === 'color_names');
  const r3 = t.grade('Červená, zelená a modrá.');
  assert(r3.passed);
  assertEqual(r3.score, 1.0);

  const r2 = t.grade('Red and green dots.');
  assert(r2.passed);
  assertEqual(r2.score, 0.6);

  const r1 = t.grade('One red dot.');
  assert(!r1.passed);
  assertEqual(r1.score, 0.3);
});

// ─── Suite: Review Grading ─────────────────────────────────────────────────

suite('Review Suite Grading');

test('json_review: valid JSON with issues + severity → pass', () => {
  const t = SUITES.review.tests.find(t => t.name === 'json_review');
  const result = t.grade('{"issues":["eval is dangerous"],"severity":"high"}');
  assert(result.passed);
  assertEqual(result.score, 1.0);
});

test('json_review: missing severity → partial', () => {
  const t = SUITES.review.tests.find(t => t.name === 'json_review');
  const result = t.grade('{"issues":["eval"]}');
  assert(!result.passed);
  assertEqual(result.score, 0.5);
});

test('complexity_assess: O(n²) → pass', () => {
  const t = SUITES.review.tests.find(t => t.name === 'complexity_assess');
  assert(t.grade('Časová složitost je O(n²).').passed);
  assert(t.grade('O(n^2) quadratic').passed);
  assert(!t.grade('O(n) linear').passed);
});

test('security_review: partial scoring', () => {
  const t = SUITES.review.tests.find(t => t.name === 'security_review');
  const r2 = t.grade('Toto je command injection, velmi nebezpečné.');
  assert(r2.passed);
  assertEqual(r2.score, 1.0);

  const r1 = t.grade('Toto je injection.');
  assert(r1.passed);
  assertEqual(r1.score, 0.6);

  const r0 = t.grade('Kód je v pořádku.');
  assert(!r0.passed);
});

test('style_review: partial scoring', () => {
  const t = SUITES.review.tests.find(t => t.name === 'style_review');
  const r3 = t.grade('Použijte const místo var, přidejte mezery a středníky.');
  assert(r3.passed);
  assertEqual(r3.score, 1.0);

  // "formát" + "mezery" = 2 keywords
  const r2 = t.grade('Opravte formát kódu, přidejte mezery.');
  assert(r2.passed);
  assertEqual(r2.score, 0.6);
});

test('refactor_suggest: switch/map/object → pass', () => {
  const t = SUITES.review.tests.find(t => t.name === 'refactor_suggest');
  assert(t.grade('Použijte switch statement.').passed);
  assert(t.grade('Vytvořte lookup objekt.').passed);
  assert(!t.grade('Přidejte else větve.').passed);
});

// ─── Suite: PNG Generation ─────────────────────────────────────────────────

suite('PNG Generation');

test('generatePNG produces valid base64', () => {
  const png = generatePNG(1, 1, [[255, 0, 0]]);
  assert(typeof png === 'string', 'is string');
  assert(png.length > 0, 'non-empty');
  // Decode base64 and check PNG signature
  const buf = Buffer.from(png, 'base64');
  assertEqual(buf[0], 137, 'PNG signature byte 0');
  assertEqual(buf[1], 80, 'PNG signature byte 1 (P)');
  assertEqual(buf[2], 78, 'PNG signature byte 2 (N)');
  assertEqual(buf[3], 71, 'PNG signature byte 3 (G)');
});

test('generatePNG 8x8 has correct dimensions in IHDR', () => {
  const png = generatePNG(8, 8, Array(64).fill([0, 255, 0]));
  const buf = Buffer.from(png, 'base64');
  // IHDR chunk starts at byte 8 (after signature) + 4 (length) + 4 (type) = 16
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assertEqual(w, 8, 'width');
  assertEqual(h, 8, 'height');
});

test('getTestImages returns all required images', () => {
  const images = getTestImages();
  assert(images.redPixel, 'redPixel');
  assert(images.red8x8, 'red8x8');
  assert(images.circleImg, 'circleImg');
  assert(images.dotsImg, 'dotsImg');
  // All should be valid base64
  for (const [name, img] of Object.entries(images)) {
    assert(Buffer.from(img, 'base64')[0] === 137, `${name} is valid PNG`);
  }
});

test('getTestImages is cached (returns same object)', () => {
  const a = getTestImages();
  const b = getTestImages();
  assert(a === b, 'should return cached instance');
});

// ─── Suite: Czech Diacritics ───────────────────────────────────────────────

suite('Czech Diacritics');

test('countCzechDiacritics counts correctly', () => {
  assertEqual(countCzechDiacritics('Hello world'), 0);
  assertEqual(countCzechDiacritics('čeština'), 2); // č, š
  assertEqual(countCzechDiacritics('příšerně žluťoučký kůň'), 10); // ř,í,š,ě,ž,ť,č,ý,ů,ň
  assertEqual(countCzechDiacritics('PŘÍŠERNĚ'), 4); // Ř,Í,Š,Ě
});

// ─── Suite: Constants ──────────────────────────────────────────────────────

suite('Constants');

test('VALIDATION_VERSION is v123.1', () => {
  assertEqual(VALIDATION_VERSION, 'v123.1');
});

test('VALIDATION_TTL_DAYS is 14', () => {
  assertEqual(VALIDATION_TTL_DAYS, 14);
});

test('BLACKLIST_THRESHOLD is 0.2', () => {
  assertEqual(BLACKLIST_THRESHOLD, 0.2);
});

// ─── Suite: Runner with Mock DB ────────────────────────────────────────────

suite('Runner — DB Persistence');

test('runner persists and retrieves results', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);

  const runner = new ValidationRunner('http://localhost:11434');
  runner.setDb(db);

  // Simulate persisting results
  runner._persistResults('test-model', 'code', [
    { name: 't1', passed: true, score: 1.0, response: 'ok', durationMs: 100, evalTokens: 50 },
    { name: 't2', passed: false, score: 0.3, response: 'partial', durationMs: 200, evalTokens: 80 },
    { name: 't3', passed: true, score: 1.0, response: 'good', durationMs: 150, evalTokens: 60 },
  ], 0.767, 2, 3, 450);

  // Retrieve
  const results = runner.getResults('test-model');
  assert(results != null, 'results not null');
  assert(results.suites.code, 'has code suite');
  assertEqual(results.suites.code.passed, 2);
  assertEqual(results.suites.code.total, 3);
  assert(Math.abs(results.suites.code.score - 0.767) < 0.001, 'score');
  assertEqual(results.suites.code.tests.length, 3);

  db.close();
});

test('runner overwrites on re-run', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);

  const runner = new ValidationRunner('http://localhost:11434');
  runner.setDb(db);

  // First run
  runner._persistResults('m1', 'chat', [
    { name: 't1', passed: false, score: 0, response: '', durationMs: 100 },
  ], 0.0, 0, 1, 100);

  // Second run (improved)
  runner._persistResults('m1', 'chat', [
    { name: 't1', passed: true, score: 1.0, response: 'ok', durationMs: 80 },
  ], 1.0, 1, 1, 80);

  const results = runner.getResults('m1');
  assertEqual(results.suites.chat.score, 1.0);
  assertEqual(results.suites.chat.passed, 1);

  // Only one row in DB (not two)
  const count = db.prepare('SELECT COUNT(*) as c FROM validation_results WHERE model = ?').get('m1');
  assertEqual(count.c, 1, 'should overwrite, not duplicate');

  db.close();
});

test('getScore returns score for model+suite', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);

  const runner = new ValidationRunner();
  runner.setDb(db);

  assertEqual(runner.getScore('m1', 'code'), null, 'no data → null');

  runner._persistResults('m1', 'code', [{ name: 't1', passed: true, score: 1 }], 0.85, 1, 1, 100);
  assertEqual(runner.getScore('m1', 'code'), 0.85);
  assertEqual(runner.getScore('m1', 'chat'), null, 'different suite → null');

  db.close();
});

test('getAllScores returns map of model → suites', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);

  const runner = new ValidationRunner();
  runner.setDb(db);

  runner._persistResults('m1', 'code', [{ name: 't1', passed: true, score: 1 }], 0.9, 1, 1, 100);
  runner._persistResults('m1', 'chat', [{ name: 't1', passed: true, score: 1 }], 0.8, 1, 1, 100);
  runner._persistResults('m2', 'code', [{ name: 't1', passed: false, score: 0 }], 0.3, 0, 1, 100);

  const all = runner.getAllScores();
  assert(all.has('m1'));
  assert(all.has('m2'));
  assertEqual(all.get('m1').code.score, 0.9);
  assertEqual(all.get('m1').chat.score, 0.8);
  assertEqual(all.get('m2').code.score, 0.3);

  db.close();
});

test('isBlacklistedForRole: score < 0.2 → blacklisted', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);

  const runner = new ValidationRunner();
  runner.setDb(db);

  runner._persistResults('bad-model', 'code', [{ name: 't1', passed: false, score: 0 }], 0.1, 0, 1, 100);
  runner._persistResults('good-model', 'code', [{ name: 't1', passed: true, score: 1 }], 0.8, 1, 1, 100);

  assert(runner.isBlacklistedForRole('bad-model', 'CODE'), 'bad model blacklisted');
  assert(!runner.isBlacklistedForRole('good-model', 'CODE'), 'good model not blacklisted');
  assert(!runner.isBlacklistedForRole('unknown', 'CODE'), 'unknown not blacklisted');

  db.close();
});

test('isStale: fresh → false, old → true', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);

  const runner = new ValidationRunner();
  runner.setDb(db);

  assert(runner.isStale('m1', 'code'), 'no data → stale');

  runner._persistResults('m1', 'code', [{ name: 't1', passed: true, score: 1 }], 0.9, 1, 1, 100);
  assert(!runner.isStale('m1', 'code'), 'fresh → not stale');

  // Manually set old date
  db.prepare("UPDATE validation_suite_scores SET validated_at = datetime('now', '-15 days') WHERE model = ?").run('m1');
  assert(runner.isStale('m1', 'code'), '15d old → stale');

  db.close();
});

// ─── Suite: Runner with Mock Fetch ─────────────────────────────────────────

suite('Runner — Mock Fetch');

await testAsync('_callModel returns content and metrics', async () => {
  const runner = new ValidationRunner('http://127.0.0.1:11434');

  // Mock global fetch
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        message: { content: `Response to: ${body.messages[0].content}` },
        eval_count: 42,
        prompt_eval_count: 10,
      }),
    };
  };

  try {
    const result = await runner._callModel('test-model', [{ role: 'user', content: 'ping' }]);
    assert(result.content.includes('Response to: ping'), 'content');
    assertEqual(result.evalCount, 42);
    assertEqual(result.promptEvalCount, 10);
    assert(result.durationMs >= 0, 'durationMs');
    assert(!result.error, 'no error');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('_callModel handles timeout gracefully', async () => {
  const runner = new ValidationRunner('http://127.0.0.1:11434');

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    await new Promise(r => setTimeout(r, 5000));
  };

  try {
    const result = await runner._callModel('test-model', [{ role: 'user', content: 'ping' }], { timeout: 100 });
    assertEqual(result.content, '');
    assert(result.error != null, 'has error');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('_runTest executes prompt and grades response', async () => {
  const runner = new ValidationRunner('http://127.0.0.1:11434');

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      message: { content: 'Cynthia je nejvyšší.' },
      eval_count: 15,
    }),
  });

  try {
    const testDef = SUITES.reasoning.tests.find(t => t.name === 'logic_puzzle');
    assert(testDef, 'logic_puzzle testDef found');
    const result = await runner._runTest(testDef, 'test-model');
    assert(result, 'result not null');
    assertEqual(result.name, 'logic_puzzle');
    assert(!result.error, 'no error: ' + (result.error || ''));
    assert(result.passed, 'should pass, content=' + result.response);
    assertEqual(result.score, 1);
    assert(result.durationMs >= 0, 'durationMs');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await testAsync('runSuite executes all tests sequentially', async () => {
  const runner = new ValidationRunner('http://127.0.0.1:11434');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE validation_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL, test_name TEXT NOT NULL,
      passed INTEGER NOT NULL, score REAL NOT NULL DEFAULT 0.0,
      response_preview TEXT, duration_ms INTEGER DEFAULT 0,
      eval_tokens INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vr_unique ON validation_results(model, suite, test_name);
    CREATE TABLE validation_suite_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL, suite TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0.0, passed INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER DEFAULT 0,
      validated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_vss_model_suite ON validation_suite_scores(model, suite);
  `);
  runner.setDb(db);

  const origFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return {
      ok: true,
      json: async () => ({
        message: { content: '{"name":"Karel","age":35,"hobbies":["x"]}' },
        eval_count: 20,
      }),
    };
  };

  try {
    const progressCalls = [];
    const result = await runner.runSuite('reasoning', 'test-model', (p) => progressCalls.push(p));

    assertEqual(result.suite, 'reasoning');
    assertEqual(result.model, 'test-model');
    assertEqual(result.total, SUITES.reasoning.tests.length);
    assert(result.tests.length === result.total, 'all tests executed');
    assert(result.durationMs >= 0, 'duration tracked');
    assert(result.score >= 0 && result.score <= 1, 'score in range');
    assertEqual(callCount, SUITES.reasoning.tests.length, 'one fetch per test');

    // Progress callbacks: should have 'running' for each test + 'complete' at end
    const runningCalls = progressCalls.filter(p => p.status === 'running');
    assertEqual(runningCalls.length, SUITES.reasoning.tests.length);
    const completeCalls = progressCalls.filter(p => p.status === 'complete');
    assertEqual(completeCalls.length, 1);

    // DB should have results
    const dbResult = runner.getResults('test-model');
    assert(dbResult != null);
    assert(dbResult.suites.reasoning != null);
  } finally {
    globalThis.fetch = origFetch;
    db.close();
  }
});

await testAsync('runSuite with unknown suite throws', async () => {
  const runner = new ValidationRunner();
  try {
    await runner.runSuite('nonexistent', 'model');
    assert(false, 'should have thrown');
  } catch (e) {
    assert(e.message.includes('Unknown suite'));
  }
});

await testAsync('cancel stops execution', async () => {
  const runner = new ValidationRunner('http://127.0.0.1:11434');

  const origFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    if (callCount === 2) runner.cancel(); // Cancel after 2nd test
    return {
      ok: true,
      json: async () => ({ message: { content: 'ok' }, eval_count: 5 }),
    };
  };

  try {
    const result = await runner.runSuite('reasoning', 'test-model');
    // Should have stopped early (2 tests instead of 8)
    assert(result.tests.length <= 3, `stopped early: ${result.tests.length} tests`);
    assert(callCount <= 3, `fetch count: ${callCount}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ─── Suite: Model Ranker Validation Integration ────────────────────────────

suite('Model Ranker — Validation Integration');

test('scoreModel without validation score → no bonus', () => {
  const model = { name: 'test', benchmarks: { mmlu: 0.8, reasoning: 0.7 }, params: 27, category: 'general' };
  const r1 = scoreModel(model, 'D1', { gpuVramMb: 24000, referenceParams: 27 });
  const r2 = scoreModel(model, 'D1', { gpuVramMb: 24000, referenceParams: 27, validationScore: null });
  assertEqual(r1.totalScore, r2.totalScore, 'null validation = no bonus');
  assertEqual(r1.breakdown.validation, null);
});

test('scoreModel with validation score → adds bonus', () => {
  const model = { name: 'test', benchmarks: { mmlu: 0.8, reasoning: 0.7 }, params: 27, category: 'general' };
  const rBase = scoreModel(model, 'D1', { gpuVramMb: 24000, referenceParams: 27 });
  const rVal = scoreModel(model, 'D1', { gpuVramMb: 24000, referenceParams: 27, validationScore: 1.0 });
  assert(rVal.totalScore > rBase.totalScore, 'validation bonus increases score');
  const diff = rVal.totalScore - rBase.totalScore;
  assert(diff <= 0.05 + 0.001, `bonus max 0.05, got ${diff}`);
  assertEqual(rVal.breakdown.validation, 1.0);
});

test('scoreModel validation bonus scales with score', () => {
  const model = { name: 'test', benchmarks: { mmlu: 0.5 }, params: 14, category: 'general' };
  const r50 = scoreModel(model, 'CHAT', { gpuVramMb: 12000, referenceParams: 14, validationScore: 0.5 });
  const r100 = scoreModel(model, 'CHAT', { gpuVramMb: 12000, referenceParams: 14, validationScore: 1.0 });
  assert(r100.totalScore > r50.totalScore, '100% validation > 50%');
});

// ─── Suite: Vision Test Images ─────────────────────────────────────────────

suite('Vision Test Images');

test('vision prompts include images array', () => {
  const visionTests = SUITES.vision.tests.filter(t => {
    const p = t.prompt();
    return typeof p === 'object' && p.images;
  });
  assert(visionTests.length >= 4, `at least 4 vision tests with images, got ${visionTests.length}`);
});

test('no_image_guard has no images', () => {
  const t = SUITES.vision.tests.find(t => t.name === 'no_image_guard');
  const p = t.prompt();
  assert(typeof p === 'string', 'no_image_guard returns plain string');
});

// ─── Summary ───────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
