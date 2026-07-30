// tests/e2e/91-multi-turn-project-build.e2e.js — Multi-Turn Iterative Project Building
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests C3's ability to iteratively build a complex project across
// multiple conversation turns — simulating how a real user would work.
//
// Scenario: Build a Python Flask todo-app in 5 phases:
//   Phase 1: Initial project (app.py, models.py, requirements.txt)
//   Phase 2: Add database migration + config
//   Phase 3: Add authentication middleware
//   Phase 4: Add tests
//   Phase 5: Code review + refactor
//
// Each phase builds on the previous, testing context retention and consistency.
// Expected duration: 8-15 minutes.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatWithTimeout, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const PHASE_TIMEOUT = LLM_TIMEOUT * 4; // 240s per phase
const PHASE_REQUEST_TIMEOUT = PHASE_TIMEOUT;
const PHASE_TEST_TIMEOUT = PHASE_REQUEST_TIMEOUT + 5_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractCodeBlocks(response) {
  const blocks = [];
  const re = /```(\w*)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(response)) !== null) {
    blocks.push({ lang: m[1] || '', code: m[2], lines: m[2].split('\n').length });
  }
  return blocks;
}

function hasCompleteCode(response) {
  const blocks = extractCodeBlocks(response);
  if (blocks.length === 0) return false;
  // No lazy placeholders; bare pass is handled separately below.
  const lazyRe = /\b(?:TODO|FIXME|HACK|placeholder)\b|\bnot\s*implemented\b|\bimplement\s*here\b/i;
  if (blocks.some(b => lazyRe.test(b.code))) return false;
  return !blocks.some(block => /^\s*pass\s*$/m.test(block.code));
}

function totalCodeLines(response) {
  return extractCodeBlocks(response).reduce((s, b) => s + b.lines, 0);
}

function assertNonEmptyResponse(response, label) {
  assert(typeof response === 'string' && response.trim().length > 0,
    `${label} must produce a non-empty response`);
}

// ── Tests ────────────────────────────────────────────────────────────────────

let convId;
const allResponses = [];

function assertCompleteTranscript() {
  assert(allResponses.length === 6,
    `expected exactly 6 phase responses before aggregate checks, got ${allResponses.length}`);
  for (let index = 0; index < allResponses.length; index++) {
    assertNonEmptyResponse(allResponses[index], `phase response ${index + 1}`);
  }
}

try {
  suite('Multi-Turn Build — Phase 1: Initial Project');

  await testAsync('create Flask project with models', async () => {
    convId = await createConv('mt-build');
    created.push(convId);

    const r = await chatWithTimeout(convId,
      `Ukaž mi příklad tří Python souborů pro Flask REST API (todo správce). Odpověz přímo v chatu, nepoužívej planner:

1. app.py — Flask server s CRUD endpointy (GET /todos, POST /todos, PUT /todos/<id>, DELETE /todos/<id>)
2. models.py — SQLAlchemy model Todo (id, title, description, done, created_at)
3. requirements.txt — seznam závislostí

Vypiš kompletní funkční kód každého souboru v code bloku. Žádné TODO, žádné placeholdery.`,
      PHASE_REQUEST_TIMEOUT,
    );

    assertNonEmptyResponse(r.response, 'Phase 1');
    allResponses.push(r.response);
    assert(r.response.length > 300, `Phase 1 response too short: ${r.response.length}`);
    assert(extractCodeBlocks(r.response).length >= 3, 'Phase 1 should have ≥3 code blocks for 3-file request');

    // Check for Flask patterns
    assert(hasKeywords(r.response, ['flask', 'Flask', 'app', 'route', '@app'], 2),
      'Phase 1 should contain Flask patterns');
    // Check for SQLAlchemy patterns
    assert(hasKeywords(r.response, ['sqlalchemy', 'SQLAlchemy', 'Column', 'Integer', 'String', 'db', 'Model'], 2),
      'Phase 1 should contain SQLAlchemy patterns');
    // Check for requirements
    assert(hasKeywords(r.response, ['flask', 'sqlalchemy'], 1),
      'Phase 1 should list dependencies');
  }, PHASE_TEST_TIMEOUT);

  await testAsync('Phase 1 code is complete (no placeholders)', async () => {
    assert(allResponses.length === 1,
      `Phase 1 completeness requires exactly one response, got ${allResponses.length}`);
    assert(hasCompleteCode(allResponses[0]),
      'Phase 1 code should not have TODO/pass/placeholder');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Multi-Turn Build — Phase 2: Database + Config');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('add database migration and config', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'Phase 2 requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Přidej k tomu soubor config.py s konfigurací (development/production, SECRET_KEY, SQLALCHEMY_DATABASE_URI). Ukaž taky aktualizovaný app.py který importuje z config.py a obsahuje init_db() funkci. Odpověz přímo kódem, vypiš kompletní soubory.',
      PHASE_REQUEST_TIMEOUT,
    );

    assertNonEmptyResponse(r.response, 'Phase 2');
    allResponses.push(r.response);
    assert(r.response.length > 200, `Phase 2 response too short: ${r.response.length}`);
    assert(extractCodeBlocks(r.response).length >= 2,
      'Phase 2 should have ≥2 code blocks for config.py and app.py');
    assert(hasCompleteCode(r.response), 'Phase 2 code should not have TODO/pass/placeholder');

    // Should reference config
    assert(hasKeywords(r.response, ['config', 'Config', 'SECRET_KEY', 'DATABASE', 'SQLALCHEMY'], 2),
      'Phase 2 should contain config patterns');
    // Should reference import from config
    assert(hasKeywords(r.response, ['import', 'from config', 'from_object', 'config.py'], 1),
      'Phase 2 should import from config');
  }, PHASE_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Multi-Turn Build — Phase 3: Authentication');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('add authentication middleware', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'Phase 3 requires the project conversation');
    const r = await chatWithTimeout(convId,
      `Rozšiř ten kód o JWT autentizaci. Vypiš mi:
1. auth.py — login endpoint (POST /login), token generování, @login_required dekorátor
2. Aktualizovaný models.py s User modelem (username, password_hash, created_at)
3. Aktualizovaný app.py s @login_required na POST/PUT/DELETE endpointech

Vypiš kompletní kód všech tří souborů přímo v chatu. Importy musí být konzistentní.`,
      PHASE_REQUEST_TIMEOUT,
    );

    assertNonEmptyResponse(r.response, 'Phase 3');
    allResponses.push(r.response);
    assert(r.response.length > 300, `Phase 3 response too short: ${r.response.length}`);
    assert(extractCodeBlocks(r.response).length >= 3,
      'Phase 3 should have ≥3 code blocks for auth.py, models.py, and app.py');
    assert(hasCompleteCode(r.response), 'Phase 3 code should not have TODO/pass/placeholder');

    // Should have auth patterns
    assert(hasKeywords(r.response, ['jwt', 'token', 'login', 'autentiz', 'authenticat', 'login_required', 'decorator', 'dekorát'], 2),
      'Phase 3 should contain auth patterns');
    // Should reference User model
    assert(hasKeywords(r.response, ['user', 'User', 'password', 'hash', 'username'], 2),
      'Phase 3 should contain User model');
    // Should have decorator pattern
    assert(hasKeywords(r.response, ['@login_required', 'functools', 'wraps', 'decorator', 'dekorát'], 1),
      'Phase 3 should have decorator pattern');
  }, PHASE_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Multi-Turn Build — Phase 4: Tests');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('add test suite', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'Phase 4 requires the project conversation');
    const r = await chatWithTimeout(convId,
      `Vypiš mi pytest testy pro tu aplikaci:
1. tests/test_todos.py — testy CRUD (test_create_todo, test_list_todos, test_update_todo, test_delete_todo)
2. tests/test_auth.py — testy autentizace (test_login, test_protected_endpoint_without_token, test_protected_endpoint_with_token)
3. tests/conftest.py — fixtures (test client, test database, auth headers)

Vypiš kompletní kód. Importy musí odkazovat na app a models.`,
      PHASE_REQUEST_TIMEOUT,
    );

    assertNonEmptyResponse(r.response, 'Phase 4');
    allResponses.push(r.response);
    assert(r.response.length > 300, `Phase 4 response too short: ${r.response.length}`);
    assert(extractCodeBlocks(r.response).length >= 3,
      'Phase 4 should have ≥3 code blocks for the requested test files');
    assert(hasCompleteCode(r.response), 'Phase 4 code should not have TODO/pass/placeholder');

    // Should have test patterns
    assert(hasKeywords(r.response, ['def test_', 'pytest', 'assert', 'fixture', 'client', 'conftest'], 2),
      'Phase 4 should contain pytest patterns');
    // Should import from the app
    assert(hasKeywords(r.response, ['from app', 'import app', 'from models', 'import create_app'], 1),
      'Phase 4 tests should import from the application');
  }, PHASE_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Multi-Turn Build — Phase 5: Code Review');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('comprehensive code review', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'Phase 5 requires the project conversation');
    const r = await chatWithTimeout(convId,
      `Podívej se na ten kód co jsi napsal a udělej code review. Zkontroluj:
1. Bezpečnost — SQL injection, hesla v plaintextu, chybějící validace
2. Kvalita — naming conventions, duplicity, error handling
3. Architektura — oddělení zodpovědností, testovatelnost
4. Co ještě chybí

Pro každý bod uveď konkrétní problémy v kódu a navrhni opravu.`,
      PHASE_REQUEST_TIMEOUT,
    );

    assertNonEmptyResponse(r.response, 'Phase 5');
    allResponses.push(r.response);
    assert(r.response.length > 400, `code review too short: ${r.response.length}`);

    // Should mention specific security concerns
    assert(hasKeywords(r.response, ['bezpeč', 'security', 'sql', 'validac', 'hesl', 'password', 'hash', 'inject'], 1),
      'review should address security');
    // Should mention code quality
    assert(hasKeywords(r.response, ['kvalit', 'quality', 'naming', 'error', 'handling', 'chyb', 'exception'], 1),
      'review should address code quality');
    // Should be structured (numbered list, sections, etc.)
    const hasStructure = /\d+[.)]\s/.test(r.response) || /^#{1,3}\s/m.test(r.response) || /^[-*•]\s/m.test(r.response);
    assert(hasStructure, 'code review should be structured (numbered/bulleted/headed)');
  }, PHASE_TEST_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Multi-Turn Build — Cross-Phase Consistency');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('remembers all project files after 5 phases', async () => {
    assert(typeof convId === 'string' && convId.length > 0,
      'cross-phase recall requires the project conversation');
    const r = await chatWithTimeout(
      convId,
      'Shrň mi co jsme tu vytvořili — vyjmenuj všechny soubory z naší konverzace a ke každému napiš krátký popis (1 věta).',
      PHASE_REQUEST_TIMEOUT,
    );
    assertNonEmptyResponse(r.response, 'cross-phase summary');
    allResponses.push(r.response);
    assertCompleteTranscript();
    // Should remember files from all phases
    assert(hasKeywords(r.response, ['app', 'model', 'config', 'auth'], 3),
      `should remember files from phases 1-3: ${r.response.substring(0, 300)}`);
    assert(hasKeywords(r.response, ['test', 'conftest'], 1),
      `should remember test files from phase 4: ${r.response.substring(0, 300)}`);
  }, PHASE_TEST_TIMEOUT);

  await testAsync('total generated code is substantial', async () => {
    assertCompleteTranscript();
    let totalLines = 0;
    for (const resp of allResponses) {
      totalLines += totalCodeLines(resp);
    }
    assert(totalLines > 80,
      `total generated code across all phases should be >80 lines, got ${totalLines}`);
  });

  await testAsync('no JSON/metadata leak after 6+ turns', async () => {
    assertCompleteTranscript();
    const lastResp = allResponses[allResponses.length - 1] || '';
    assert(!lastResp.includes('"decision_type"'), 'no JSON decision_type leak');
    assert(!lastResp.includes('"intent_type"'), 'no intent_type leak');
  });

  await testAsync('language consistency (Czech throughout)', async () => {
    assertCompleteTranscript();
    // Check last 3 responses are in Czech
    const recent = allResponses.slice(-3);
    let czechCount = 0;
    for (const resp of recent) {
      if (/[ěščřžýáíéůúďťň]/i.test(resp)) czechCount++;
    }
    assert(czechCount >= 2,
      `at least 2/3 of recent responses should be in Czech, got ${czechCount}/3`);
  });

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
