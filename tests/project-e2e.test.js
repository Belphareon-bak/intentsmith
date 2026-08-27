// E2E Project Tests — v84
// ══════════════════════════════════════════════════════════════════════════════
//
// Two real-world E2E scenarios testing C3 project mode:
//
// TEST 1: NEW PROJECT — "Klíčenka" (credentials/secrets manager)
//   Creates a brand-new project, asks C3 to spec it out, verifies
//   the system can handle project creation + initial design conversation.
//
// TEST 2: EXISTING PROJECT — ai-log-analyzer
//   Points C3 at an existing codebase, asks about architecture, bugs,
//   regular phase, output analysis, and improvement recommendations.
//   Verifies C3 can read real files and provide meaningful analysis.
//
// REQUIRES: C3 server running on port 3335
//   node --watch src/server.js
//
// RUN:
//   node tests/project-e2e.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.C3_URL || 'http://127.0.0.1:3335';
const TIMEOUT = 300_000; // bounded by the registered 15-minute program timeout

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    const ms = Date.now() - t0;
    console.log(`  ✅ ${name} (${ms}ms)`);
  } catch (e) {
    failed++;
    const ms = Date.now() - t0;
    const msg = e.message || String(e);
    console.log(`  ❌ ${name} (${ms}ms): ${msg}`);
    failures.push({ name, error: msg });
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

async function chat(conversationId, projectId, message) {
  return api('POST', '/api/chat', {
    conversation_id: conversationId,
    project_id: projectId,
    message,
  });
}

function summary() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    ❌ ${f.name}: ${f.error.substring(0, 200)}`);
    }
  }
  console.log(`${'═'.repeat(70)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ─── Preflight ────────────────────────────────────────────────────────────────

async function preflight() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch {
    console.error('\n  ⚠️  C3 server not running on port 3335.');
    console.error('  Start it with: node --watch src/server.js\n');
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 1: NEW PROJECT — Klíčenka (credentials manager)
// ══════════════════════════════════════════════════════════════════════════════

async function test1_NewProject() {
  console.log('\n═══ TEST 1: New Project — Klíčenka (credentials manager) ═══════════');

  let projectId = null;
  const convId = `e2e-klicenka-${Date.now()}`;

  // ── 1.1 Create the project ──

  await check('1.1 POST /api/projects creates klíčenka project', async () => {
    const { status, data } = await api('POST', '/api/projects', {
      name: 'Klíčenka',
      description: 'Správce credentials a citlivých údajů — šifrování, bezpečné ukládání, CLI i API přístup',
      type: 'api',
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.project?.id, 'Project should have an ID');
    assert(data.path, 'Project should have a path');
    assert(data.lifecycle === 'SPEC', `Lifecycle should be SPEC, got ${data.lifecycle}`);
    projectId = data.project.id;
  });

  if (!projectId) {
    console.log('  ⏭️  Skipping remaining test 1 — project creation failed');
    return;
  }

  // ── 1.2 First message: ask C3 to design the project ──

  await check('1.2 Chat: C3 responds to project spec request', async () => {
    const { status, data } = await chat(convId, projectId,
      'Navrhni specifikaci pro klíčenku — systém na bezpečné ukládání credentials (API klíče, hesla, tokeny). ' +
      'Potřebuju: šifrování AES-256, master heslo, CLI rozhraní pro přidání/čtení/smazání, ' +
      'a REST API pro programový přístup. Jaká bude architektura a co budeš potřebovat?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 100, `Response too short (${data.response.length} chars) — expected substantive analysis`);
    assert(data.mode, 'Should have a mode');
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 1.3 Follow-up: ask about security considerations ──

  await check('1.3 Chat: security considerations follow-up', async () => {
    const { status, data } = await chat(convId, projectId,
      'Jaké bezpečnostní aspekty musíme řešit? ' +
      'Co key derivation, memory safety, file permissions na vault souboru?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 80, 'Response should be substantive');
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 1.4 File listing: show project structure ──

  await check('1.4 Chat: list project files', async () => {
    const { status, data } = await chat(convId, projectId,
      'Ukaž mi co je v projektu za soubory'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    // Should contain file/project indicators — new project shows dashboard or file listing
    const r = data.response.toLowerCase();
    const hasFiles = data.response.includes('📁') || data.response.includes('📄') || data.response.includes('📂') ||
                     r.includes('project.json') || r.includes('.c3') ||
                     r.includes('package.json') || r.includes('src') ||
                     r.includes('soubor') || r.includes('adresář') || r.includes('složk') ||
                     r.includes('cesta') || r.includes('projekt');
    assert(hasFiles, `Response should contain file/project info (got: ${data.response.substring(0, 200)})`);
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 1.5 Check project exists in API ──

  await check('1.5 GET /api/projects/:id returns project', async () => {
    const { status, data } = await api('GET', `/api/projects/${projectId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.project, 'Should have project data');
    assert(data.project.name === 'Klíčenka', `Name should be Klíčenka, got ${data.project.name}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 2: EXISTING PROJECT — ai-log-analyzer
// ══════════════════════════════════════════════════════════════════════════════

async function test2_ExistingProject() {
  console.log('\n═══ TEST 2: Existing Project — ai-log-analyzer ═════════════════════');

  const fixtureRoot = path.join(process.env.HOME, 'project-e2e-fixtures');
  await fs.mkdir(fixtureRoot, { recursive: true });
  const existingPath = await fs.mkdtemp(path.join(fixtureRoot, 'ai-log-analyzer-'));
  await fs.mkdir(path.join(existingPath, 'src'), { recursive: true });
  await fs.mkdir(path.join(existingPath, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(existingPath, 'output'), { recursive: true });
  await fs.writeFile(
    path.join(existingPath, 'README.md'),
    '# AI Log Analyzer\n\nDeterministic fixture with regular and backfill phases.\n',
  );
  await fs.writeFile(
    path.join(existingPath, 'config.json'),
    '{"regular":{"input":"logs/*.jsonl","output":"output/regular-summary.json"}}\n',
  );
  await fs.writeFile(
    path.join(existingPath, 'src', 'core.js'),
    'export function analyzeLog(line) { return { level: line.level || "unknown" }; }\n',
  );
  await fs.writeFile(
    path.join(existingPath, 'scripts', 'run_regular.js'),
    'import { analyzeLog } from "../src/core.js";\nconsole.log(analyzeLog({ level: "info" }));\n',
  );
  await fs.writeFile(
    path.join(existingPath, 'output', 'regular-summary.json'),
    '{"phase":"regular","records":1,"levels":{"info":1}}\n',
  );
  let projectId = null;
  const convId = `e2e-analyzer-${Date.now()}`;

  // ── 2.1 Register existing project ──

  await check('2.1 POST /api/projects registers existing path', async () => {
    const { status, data } = await api('POST', '/api/projects', {
      name: 'AI Log Analyzer (E2E)',
      description: 'Existing log analysis project for E2E testing',
      type: 'general',
      path: existingPath,
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data).substring(0, 200)}`);
    assert(data.project?.id, 'Project should have an ID');
    projectId = data.project.id;
  });

  if (!projectId) {
    console.log('  ⏭️  Skipping remaining test 2 — project registration failed');
    await fs.rm(existingPath, { recursive: true, force: true });
    return;
  }

  // ── 2.2 Warmup: list project files (establishes context) ──

  await check('2.2 Chat: list files in existing project', async () => {
    const { status, data } = await chat(convId, projectId,
      'Jaké soubory jsou v tomto projektu?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    const hasReal = ['README', 'config', 'core', 'scripts', 'run_regular', '.py', 'src']
      .some(f => data.response.includes(f));
    assert(hasReal, `Should list real files (got: ${data.response.substring(0, 200)})`);
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 2.3 Architecture analysis ──

  await check('2.3 Chat: architecture analysis of existing project', async () => {
    const { status, data } = await chat(convId, projectId,
      'Jaká je architektura tohoto projektu? Jaké jsou hlavní komponenty a jak spolu komunikují?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 100, `Response too short (${data.response.length} chars, got: ${data.response.substring(0, 200)})`);
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
    // Should mention some real files/components from the project
    const r = data.response.toLowerCase();
    const mentions = ['script', 'log', 'analy', 'config', 'core', 'export', 'pipeline', 'regular', 'backfill', 'modul', 'fáz', 'faz', 'soubor', 'architektur']
      .filter(kw => r.includes(kw));
    assert(mentions.length >= 1, `Should mention real project components (found: ${mentions.join(', ') || 'none'}, response: ${data.response.substring(0, 300)})`);
    console.log(`       Mentions: ${mentions.join(', ')}`);
  });

  // ── 2.4 Bug/issue detection ──

  await check('2.4 Chat: bug detection', async () => {
    const { status, data } = await chat(convId, projectId,
      'Vidíš v projektu nějaké potenciální bugy, chyby nebo problémy v kódu?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 80, `Response should be substantive (got: ${data.response.substring(0, 200)})`);
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 2.5 Regular phase analysis ──

  await check('2.5 Chat: regular phase functionality', async () => {
    const { status, data } = await chat(convId, projectId,
      'Jak funguje regular fáze v tomto projektu? Co dělá, jaký je její vstup a výstup?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 100, 'Should provide detailed analysis');
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 2.6 Output analysis ──

  await check('2.6 Chat: regular phase output analysis', async () => {
    const { status, data } = await chat(convId, projectId,
      'Jaký je output regular fáze? Jak vypadají výstupní data a co by se dalo vylepšit na formátu výstupu?'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 100, 'Should analyze output format');
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 2.7 Improvement recommendations ──

  await check('2.7 Chat: improvement recommendations', async () => {
    const { status, data } = await chat(convId, projectId,
      'Dej mi konkrétní doporučení pro vylepšení outputu regular fáze. ' +
      'Co přidat, co změnit, jak zlepšit čitelnost a užitečnost výstupu.'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    assert(data.response.length > 100, 'Should provide specific recommendations');
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  // ── 2.8 Summary to .md ──

  await check('2.8 Chat: request summary in .md file', async () => {
    const { status, data } = await chat(convId, projectId,
      'Shrň všechno co jsi zjistil — architekturu, bugy, regular fázi, její output a doporučení ' +
      'pro vylepšení. Výsledek dej do souboru project-analysis.md v projektu.'
    );
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.response, 'Should have a response');
    console.log(`       Mode: ${data.mode}, Response: ${data.response.length} chars`);
  });

  await fs.rm(existingPath, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  C3 Project E2E Tests — v84                                        ║');
  console.log('║  Tests run against live C3 server (port 3335)                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  await preflight();

  await test1_NewProject();
  await test2_ExistingProject();

  summary();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
