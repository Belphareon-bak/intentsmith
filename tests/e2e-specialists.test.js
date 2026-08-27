// e2e-specialists.test.js — E2E Tests for Specialist Platform (D4-D8)
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests D8 REST API, D7 dependency guards, D4 specialist memory,
// and full specialist tool execution through LLM pipeline.
//
// 8 tests:
//   S1: List specialists (REST API)
//   S2: Get specialist detail (REST API)
//   S3: Check integrity (REST API)
//   S4: Discover — idempotent (REST API)
//   S5: Disable + Re-enable cycle (REST API)
//   S6: Specialist tool execution through LLM (/chat with expertise)
//   S7: Conversational follow-up — session context + memory
//   S8: 404 for unknown specialist
//
// Usage:
//   node tests/e2e-specialists.test.js                   # Run all
//   node tests/e2e-specialists.test.js --test S1         # Run single test
//   node tests/e2e-specialists.test.js --verbose         # Show responses
//   node tests/e2e-specialists.test.js --skip-llm        # Skip LLM tests
//
// ══════════════════════════════════════════════════════════════════════════════

import http from 'http';

// ─── Config ──────────────────────────────────────────────────────────────────

const C3_URL = process.env.C3_URL || 'http://127.0.0.1:3335';
const TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT || '120000');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const SKIP_LLM = process.argv.includes('--skip-llm');
const TEST_FILTER = process.argv.find((a, i, arr) => arr[i - 1] === '--test') || null;

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function request(method, endpoint, data = null, { timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, C3_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: body });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout ${timeout}ms`)); });

    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function chat(message, sessionId = null, expertise = null) {
  const sid = sessionId || `e2e-spec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const payload = { message, session_id: sid };
  if (expertise) payload.expertise = expertise;

  return request('POST', '/chat', payload).then(r => ({
    ...r,
    sessionId: sid,
    text: r.body?.response || r.body?.content || '',
  }));
}

// ─── Test runner ─────────────────────────────────────────────────────────────

const results = [];
let passed = 0;
let failed = 0;
let skipped = 0;

async function runTest(id, name, fn, { requiresLLM = false } = {}) {
  if (TEST_FILTER && TEST_FILTER !== id) return;

  if (requiresLLM && SKIP_LLM) {
    console.log(`  [${id}] ${name}... \x1b[33m⏭ SKIPPED (--skip-llm)\x1b[0m`);
    skipped++;
    results.push({ id, name, skipped: true });
    return;
  }

  const start = Date.now();
  process.stdout.write(`  [${id}] ${name}... `);

  try {
    const checks = await fn();
    const duration = Date.now() - start;
    const failedChecks = checks.filter(c => !c.pass);

    if (failedChecks.length === 0) {
      console.log(`\x1b[32mOK ${checks.length}/${checks.length}\x1b[0m (${formatDuration(duration)})`);
      passed++;
    } else {
      console.log(`\x1b[31mFAIL ${checks.length - failedChecks.length}/${checks.length}\x1b[0m (${formatDuration(duration)})`);
      for (const c of failedChecks) {
        console.log(`    \x1b[31m- ${c.name}: ${c.detail}\x1b[0m`);
      }
      failed++;
    }

    results.push({ id, name, checks, duration, passed: failedChecks.length === 0 });
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`\x1b[31mERROR\x1b[0m (${formatDuration(duration)})`);
    console.log(`    ${err.message}`);
    results.push({ id, name, error: err.message, duration, passed: false });
    failed++;
  }
}

function formatDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function check(name, pass, detail = '') {
  return { name, pass, detail: detail || (pass ? 'OK' : 'FAILED') };
}

// ══════════════════════════════════════════════════════════════════════════════
// S1: List all specialists
// ══════════════════════════════════════════════════════════════════════════════

async function testS1_ListSpecialists() {
  const checks = [];

  const res = await request('GET', '/api/specialists');

  if (VERBOSE) console.log(`\n    Response: ${JSON.stringify(res.body).substring(0, 300)}`);

  checks.push(check('status_200', res.status === 200, `HTTP ${res.status}`));
  checks.push(check('ok_true', res.body?.ok === true, `ok: ${res.body?.ok}`));
  checks.push(check('has_specialists', Array.isArray(res.body?.specialists), 'specialists is array'));
  checks.push(check('has_accountant',
    res.body?.specialists?.some(s => s.id === 'accountant-cz'),
    'accountant-cz found'));

  const accountant = res.body?.specialists?.find(s => s.id === 'accountant-cz');
  if (accountant) {
    checks.push(check('accountant_enabled', accountant.status === 'enabled',
      `status: ${accountant.status}`));
    checks.push(check('accountant_has_tools', accountant.tools?.length >= 4,
      `tools: ${accountant.tools?.length || 0}`));
    checks.push(check('accountant_domain', accountant.domain === 'finance',
      `domain: ${accountant.domain}`));
  }

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S2: Get specialist detail
// ══════════════════════════════════════════════════════════════════════════════

async function testS2_SpecialistDetail() {
  const checks = [];

  const res = await request('GET', '/api/specialists/accountant-cz');

  if (VERBOSE) console.log(`\n    Response: ${JSON.stringify(res.body).substring(0, 400)}`);

  checks.push(check('status_200', res.status === 200, `HTTP ${res.status}`));
  checks.push(check('ok_true', res.body?.ok === true, `ok: ${res.body?.ok}`));
  checks.push(check('has_manifest', !!res.body?.manifest, 'manifest exists'));
  checks.push(check('has_version', !!res.body?.version, `version: ${res.body?.version}`));
  checks.push(check('is_registered', res.body?.isRegistered === true,
    `isRegistered: ${res.body?.isRegistered}`));

  // Manifest content
  const m = res.body?.manifest;
  if (m) {
    checks.push(check('manifest_tools', m.tools?.length >= 4,
      `manifest.tools: ${m.tools?.length || 0}`));
    checks.push(check('manifest_expertises', m.expertises?.includes('accountant'),
      `expertises: ${JSON.stringify(m.expertises)}`));
    checks.push(check('manifest_domain', m.domain === 'finance',
      `domain: ${m.domain}`));
  }

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S3: Check integrity
// ══════════════════════════════════════════════════════════════════════════════

async function testS3_IntegrityCheck() {
  const checks = [];

  const res = await request('GET', '/api/specialists/accountant-cz/integrity');

  if (VERBOSE) console.log(`\n    Response: ${JSON.stringify(res.body)}`);

  checks.push(check('status_200', res.status === 200, `HTTP ${res.status}`));
  checks.push(check('ok_true', res.body?.ok === true, `ok: ${res.body?.ok}`));
  checks.push(check('no_issues', res.body?.issues?.length === 0,
    `issues: ${JSON.stringify(res.body?.issues || [])}`));

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S4: Discover (idempotent)
// ══════════════════════════════════════════════════════════════════════════════

async function testS4_Discover() {
  const checks = [];

  // Call discover — should be idempotent
  const res = await request('POST', '/api/specialists/discover');

  if (VERBOSE) console.log(`\n    Response: ${JSON.stringify(res.body)}`);

  checks.push(check('status_200', res.status === 200, `HTTP ${res.status}`));
  checks.push(check('ok_true', res.body?.ok === true, `ok: ${res.body?.ok}`));
  checks.push(check('has_total', (res.body?.total || 0) >= 2,
    `total: ${res.body?.total} (need >= 2: accountant-cz + dummy-logger)`));
  checks.push(check('discovered_array', Array.isArray(res.body?.discovered),
    'discovered is array'));

  // Idempotent: calling again should not install new ones
  const res2 = await request('POST', '/api/specialists/discover');
  checks.push(check('idempotent', (res2.body?.newlyInstalled?.length || 0) === 0,
    `newlyInstalled on 2nd call: ${res2.body?.newlyInstalled?.length || 0}`));

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S5: Disable + Re-enable cycle
// ══════════════════════════════════════════════════════════════════════════════

async function testS5_DisableEnableCycle() {
  const checks = [];

  // Disable dummy-logger (safe — nothing depends on it)
  const disRes = await request('POST', '/api/specialists/dummy-logger/disable');

  if (VERBOSE) console.log(`\n    Disable: ${JSON.stringify(disRes.body)}`);

  checks.push(check('disable_200', disRes.status === 200, `Disable HTTP ${disRes.status}`));
  checks.push(check('disable_ok', disRes.body?.ok === true, `ok: ${disRes.body?.ok}`));

  // Verify it's disabled in the list
  const listRes = await request('GET', '/api/specialists');
  const dummy = listRes.body?.specialists?.find(s => s.id === 'dummy-logger');
  checks.push(check('is_disabled', dummy?.status === 'disabled',
    `status after disable: ${dummy?.status}`));

  // Re-enable
  const enRes = await request('POST', '/api/specialists/dummy-logger/enable');

  if (VERBOSE) console.log(`\n    Enable: ${JSON.stringify(enRes.body)}`);

  checks.push(check('enable_200', enRes.status === 200, `Enable HTTP ${enRes.status}`));
  checks.push(check('enable_ok', enRes.body?.ok === true, `ok: ${enRes.body?.ok}`));

  // Verify it's enabled again
  const listRes2 = await request('GET', '/api/specialists');
  const dummy2 = listRes2.body?.specialists?.find(s => s.id === 'dummy-logger');
  checks.push(check('re_enabled', dummy2?.status === 'enabled',
    `status after re-enable: ${dummy2?.status}`));

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S6: Specialist Tool Execution through LLM
// ══════════════════════════════════════════════════════════════════════════════
// Sends a tax calculation query with accountant expertise active.
// Verifies: specialist tool was used, response contains numbers, Czech language.

async function testS6_SpecialistToolExecution() {
  const checks = [];

  const sid = `e2e-s6-${Date.now()}`;

  // Send chat with accountant expertise and a tax question
  const res = await chat(
    'Kolik zaplatim dani z prijmu 850000 Kc jako OSVC?',
    sid,
    { id: 'accountant', name: 'Ucetni', domain: 'finance' }
  );

  if (VERBOSE) console.log(`\n    Response: ${res.text.substring(0, 400)}...`);

  checks.push(check('status_200', res.status === 200, `HTTP ${res.status}`));
  checks.push(check('has_content', (res.text?.length || 0) > 50,
    `Response length: ${res.text?.length || 0}`));

  // Should contain numeric results (tax amounts, percentages, etc.)
  const hasNumbers = /\d{3,}/.test(res.text);
  checks.push(check('has_numbers', hasNumbers,
    hasNumbers ? 'Contains numeric results' : 'No numbers found in response'));

  // Should reference tax-related terms
  const hasTaxTerms = /dan|odvod|pojist|základ|čist|sazba|příjem|sleva|tax|insurance/i.test(res.text);
  checks.push(check('has_tax_terms', hasTaxTerms,
    hasTaxTerms ? 'Contains tax terminology' : 'No tax terms found'));

  // Mode should be 'expert' (ChatMode.EXPERTISE = 'expert')
  // CRE may route via SEARCH or ANSWER — both go through expertise handler
  const mode = res.body?.mode;
  checks.push(check('mode_expert', mode === 'expert',
    `mode: ${mode} (expected: expert)`));

  // No error in response (should not contain error indicators)
  const noError = !/chyba|error|nemohu|nemohl/i.test(res.text.substring(0, 100));
  checks.push(check('no_error', noError,
    noError ? 'No error in response' : `Possible error: "${res.text.substring(0, 100)}"`));

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S7: Conversational Follow-up — Session Context + Memory
// ══════════════════════════════════════════════════════════════════════════════
// Multi-turn: Same session, follow-up question referencing previous context.
// Tests session param cache and/or specialist memory persistence.

async function testS7_ConversationalFollowUp() {
  const checks = [];

  const sid = `e2e-s7-${Date.now()}`;
  const expertise = { id: 'accountant', name: 'Ucetni', domain: 'finance' };

  // Turn 1: Tax question (simpler phrasing to avoid LOCAL classification)
  const res1 = await chat(
    'Jakou celkovou dan z prijmu zaplatim pri primu milion korun jako zivnostnik?',
    sid,
    expertise
  );

  if (VERBOSE) console.log(`\n    Turn 1: ${res1.text.substring(0, 200)}...`);

  checks.push(check('turn1_status', res1.status === 200, `Turn 1 HTTP ${res1.status}`));
  checks.push(check('turn1_has_content', (res1.text?.length || 0) > 50,
    `Turn 1 length: ${res1.text?.length || 0}`));
  // Turn 1 should not be an error response
  const t1noError = !/chyba|error|nemohu zpracovat|autoritativn[ií].*efekt|termin[aá]ln[ií]m v[yý]sledkem/i
    .test(res1.text.substring(0, 180));
  checks.push(check('turn1_no_error', t1noError,
    t1noError ? 'No error' : `Possible error: "${res1.text.substring(0, 100)}"`));
  checks.push(check('turn1_mode_expert', res1.body?.mode === 'expert',
    `Turn 1 mode: ${res1.body?.mode} (expected: expert)`));

  // Turn 2: Follow-up — "A co jako s.r.o.?"
  const res2 = await chat(
    'A co kdybych to mel jako s.r.o.?',
    sid,
    expertise
  );

  if (VERBOSE) console.log(`\n    Turn 2: ${res2.text.substring(0, 200)}...`);

  checks.push(check('turn2_status', res2.status === 200, `Turn 2 HTTP ${res2.status}`));
  checks.push(check('turn2_has_content', (res2.text?.length || 0) > 50,
    `Turn 2 length: ${res2.text?.length || 0}`));
  // Turn 2 should not be an error response
  const t2noError = !/chyba|error|nemohu zpracovat|autoritativn[ií].*efekt|termin[aá]ln[ií]m v[yý]sledkem/i
    .test(res2.text.substring(0, 180));
  checks.push(check('turn2_no_error', t2noError,
    t2noError ? 'No error' : `Possible error: "${res2.text.substring(0, 100)}"`));

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// S8: 404 for unknown specialist
// ══════════════════════════════════════════════════════════════════════════════

async function testS8_UnknownSpecialist() {
  const checks = [];

  const res = await request('GET', '/api/specialists/nonexistent-specialist');

  if (VERBOSE) console.log(`\n    Response: ${JSON.stringify(res.body)}`);

  checks.push(check('status_404', res.status === 404, `HTTP ${res.status}`));
  checks.push(check('ok_false', res.body?.ok === false, `ok: ${res.body?.ok}`));
  checks.push(check('has_error', !!res.body?.error, `error: ${res.body?.error}`));

  // Integrity check for unknown should also be 404
  const intRes = await request('GET', '/api/specialists/nonexistent-specialist/integrity');
  checks.push(check('integrity_404', intRes.status === 404, `Integrity HTTP ${intRes.status}`));

  return checks;
}

// ══════════════════════════════════════════════════════════════════════════════
// RUNNER
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log('  C3 SPECIALIST E2E TEST SUITE (D4-D8)');
  console.log('  =====================================');
  console.log();
  console.log(`  Server:   ${C3_URL}`);
  console.log(`  LLM:      ${SKIP_LLM ? 'SKIPPED' : 'enabled'}`);
  if (TEST_FILTER) console.log(`  Filter:   ${TEST_FILTER}`);
  console.log();

  // Check server availability
  try {
    const health = await request('GET', '/api/health', null, { timeout: 5000 });
    if (health.status !== 200) throw new Error(`Health check: HTTP ${health.status}`);
    console.log('  Server:   OK');
  } catch (err) {
    console.error(`  Server unreachable: ${err.message}`);
    console.error(`  Start the server first: node src/server.js`);
    process.exit(1);
  }

  console.log();

  // ─── REST API tests ─────────────────────────────────────────────────────
  console.log('--- D8: REST API -----------------------------------------------');
  console.log();
  await runTest('S1', 'List specialists', testS1_ListSpecialists);
  await runTest('S2', 'Specialist detail (accountant-cz)', testS2_SpecialistDetail);
  await runTest('S3', 'Integrity check', testS3_IntegrityCheck);
  await runTest('S4', 'Discover (idempotent)', testS4_Discover);
  await runTest('S5', 'Disable + Re-enable cycle (dummy-logger)', testS5_DisableEnableCycle);
  await runTest('S8', '404 for unknown specialist', testS8_UnknownSpecialist);
  console.log();

  // ─── LLM pipeline tests ────────────────────────────────────────────────
  console.log('--- D4/D6: Specialist Tools + Memory (LLM) ---------------------');
  console.log();
  await runTest('S6', 'Tax calculation through LLM pipeline', testS6_SpecialistToolExecution, { requiresLLM: true });
  await runTest('S7', 'Conversational follow-up (session context)', testS7_ConversationalFollowUp, { requiresLLM: true });
  console.log();

  // ─── Summary ────────────────────────────────────────────────────────────
  const totalChecks = results.reduce((sum, r) => sum + (r.checks?.length || 0), 0);
  const passedChecks = results.reduce((sum, r) => sum + (r.checks?.filter(c => c.pass)?.length || 0), 0);

  console.log('  =============================================');
  console.log(`  Tests:   ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`  Checks:  ${passedChecks}/${totalChecks} passed`);
  console.log('  =============================================');
  console.log();

  if (failed > 0) {
    console.log('  Failed:');
    for (const r of results.filter(r => !r.passed && !r.skipped)) {
      const failedNames = r.checks
        ? r.checks.filter(c => !c.pass).map(c => c.name).join(', ')
        : r.error || 'unknown';
      console.log(`    [${r.id}] ${r.name}: ${failedNames}`);
    }
    console.log();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
