// tests/e2e/96-project-workflow-quality.e2e.js — Project Workflow Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that C3's project workflow produces high-quality output
// across the full lifecycle: analysis → planning → implementation.
//
// Unlike functional tests (does the API return 200?), these test the QUALITY
// of each step — do analyses find real issues, are plans actionable, is the
// generated code actually good?
//
// Quality dimensions:
//   1. Analysis accuracy — finds real issues, not just generic advice
//   2. Planning depth — milestones are specific and actionable
//   3. Code generation — consistent, complete, follows conventions
//   4. Cross-step coherence — plan references analysis, code implements plan
//   5. Context injection — project files are used in responses
//
// Expected duration: 10-15 minutes.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords, api,
  cleanupConversation, cleanupProject, LLM_TIMEOUT, makeOwnedTempDir,
  removeOwnedTempDir,
} from './_helpers.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

await waitForServer();

const createdConvs = [];
const createdProjects = [];
const createdProjectDirs = [];
const PROJECT_TIMEOUT = LLM_TIMEOUT * 5; // 300s

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreStructure(text) {
  let score = 0;
  if (/```\w*\n[\s\S]+?```/.test(text)) score += 2;
  if (/^\s*[\d]+[.)]\s/m.test(text) || /^\s*[-*•]\s/m.test(text)) score += 1;
  if (/^#{1,4}\s/m.test(text) || /\*\*[^*]+\*\*/m.test(text)) score += 1;
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 2) score += 1;
  return score;
}

async function createTestProject(name, files) {
  const dir = makeOwnedTempDir(`e2e-pq-${name}`);
  createdProjectDirs.push(dir);
  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(dir, filename);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  const { status, data } = await api('POST', '/api/projects', {
    name: `e2e-pq-${name}`,
    path: dir,
    description: `E2E quality test project: ${name}`,
  });

  if (status !== 200 && status !== 201) throw new Error(`createProject failed: ${status}`);
  const id = data.id || data.project?.id;
  createdProjects.push(id);
  return { id, dir };
}

// ── Tests ────────────────────────────────────────────────────────────────────

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Project Quality — Chat-Based Code Discussion');
  // ═══════════════════════════════════════════════════════════════════════════

  // Test: When discussing a code topic in project context, responses should be
  // specific to the project, not generic advice.

  await testAsync('discusses architecture with specific technology recommendations', async () => {
    const convId = await createConv('pq-arch');
    createdConvs.push(convId);

    const r = await chatInConv(convId,
      `Potřebuji navrhnout backend pro e-shop. Jakou architekturu bys doporučil?
Požadavky:
- REST API v Node.js
- PostgreSQL databáze
- Autentizace přes JWT
- Platební brána (Stripe)
- Emailové notifikace
- 1000 objednávek denně

Poraď mi s organizací kódu a adresářovou strukturou.`
    );

    assert(r.response.length > 500,
      `architecture advice too short: ${r.response.length}`);

    // Should mention specific directory structure
    assert(hasKeywords(r.response, ['src/', 'routes', 'controllers', 'models', 'middleware', 'services', 'utils', 'adresář', 'složk'], 2),
      'should propose specific directory structure');

    // Should address each requirement
    const addressed = [];
    if (hasKeywords(r.response, ['Express', 'Fastify', 'Koa', 'Nest'], 1)) addressed.push('framework');
    if (hasKeywords(r.response, ['PostgreSQL', 'Prisma', 'Sequelize', 'TypeORM', 'Knex', 'pg'], 1)) addressed.push('database');
    if (hasKeywords(r.response, ['JWT', 'jwt', 'token', 'autentiz'], 1)) addressed.push('auth');
    if (hasKeywords(r.response, ['Stripe', 'platb', 'payment'], 1)) addressed.push('payments');
    if (hasKeywords(r.response, ['email', 'notifik', 'Nodemailer', 'SendGrid', 'SMTP'], 1)) addressed.push('email');
    if (hasKeywords(r.response, ['škálov', 'scale', 'výkon', 'performance', '1000', 'cache', 'Redis'], 1)) addressed.push('scaling');

    assert(addressed.length >= 4,
      `should address ≥4 requirements, covered: ${addressed.join(', ')}`);

    // Should be well-structured
    assert(scoreStructure(r.response) >= 3,
      'architecture advice should be well-structured');
  }, PROJECT_TIMEOUT);

  await testAsync('follow-up produces consistent detailed code', async () => {
    // Reuse last conversation's context
    const convId = await createConv('pq-arch-code');
    createdConvs.push(convId);

    // First establish context
    await chatInConv(convId,
      'Navrhuji Node.js e-shop backend s Express, PostgreSQL a JWT autentizací. Odpověz přímo v chatu.'
    );

    // Then ask for implementation
    const r = await chatInConv(convId,
      `Vypiš mi kód pro autentizační middleware a login/register endpointy.
Vypiš kompletní soubory:
1. middleware/auth.js — JWT verify middleware
2. routes/auth.js — POST /register, POST /login

Kompletní kód, žádné TODO.`
    );

    const blocks = [...r.response.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
    assert(blocks.length >= 2, `expected ≥2 code blocks, got ${blocks.length}`);

    // Check for completeness
    const allCode = blocks.map(b => b[2]).join('\n');
    assert(!/\bTODO\b/.test(allCode), 'no TODO in code');
    assert(!/^\s*pass\s*$/m.test(allCode), 'no bare pass');

    // JWT verify middleware should exist
    assert(hasKeywords(allCode, ['verify', 'jwt', 'token', 'decoded', 'Bearer', 'header', 'authorization'], 3),
      'auth middleware should verify JWT tokens');

    // Register should hash password
    assert(hasKeywords(allCode, ['hash', 'bcrypt', 'argon', 'salt', 'password'], 1),
      'register should hash passwords');

    // Login should generate token
    assert(hasKeywords(allCode, ['sign', 'jwt.sign', 'token', 'generate'], 1),
      'login should generate JWT token');
  }, PROJECT_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Project Quality — Code Review Depth');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('code review finds specific issues, not just generic advice', async () => {
    const convId = await createConv('pq-review');
    createdConvs.push(convId);

    const r = await chatInConv(convId,
      `Podívej se na tento kód a najdi všechny problémy:

\`\`\`javascript
const express = require('express');
const mysql = require('mysql');
const app = express();

app.get('/user', (req, res) => {
  const id = req.query.id;
  const db = mysql.createConnection({host: 'localhost', user: 'root', password: 'admin123', database: 'app'});
  db.query('SELECT * FROM users WHERE id = ' + id, (err, results) => {
    if (err) console.log(err);
    res.json(results[0]);
  });
});

app.post('/login', (req, res) => {
  const {username, password} = req.body;
  const db = mysql.createConnection({host: 'localhost', user: 'root', password: 'admin123', database: 'app'});
  db.query("SELECT * FROM users WHERE username='" + username + "' AND password='" + password + "'", (err, rows) => {
    if (rows.length > 0) res.json({token: username + '_' + Date.now()});
    else res.status(401).send('nope');
  });
});

app.listen(3000);
\`\`\`

Najdi bezpečnostní problémy, chyby v kvalitě kódu, a navrhni opravu pro každý.`
    );

    // Must identify SQL injection
    assert(hasKeywords(r.response, ['SQL injection', 'sql injection', 'injekc', 'inject'], 1),
      'should identify SQL injection vulnerability');

    // Must identify hardcoded credentials
    assert(hasKeywords(r.response, ['hardcod', 'admin123', 'root', 'přihlašovac', 'credential', 'heslo v kódu', 'env'], 1),
      'should identify hardcoded credentials');

    // Must identify plaintext password storage
    assert(hasKeywords(r.response, ['plain', 'hash', 'bcrypt', 'nešifrov', 'password'], 1),
      'should identify plaintext password comparison');

    // Must identify weak token generation
    assert(hasKeywords(r.response, ['token', 'JWT', 'bezpeč', 'slabý', 'weak', 'predictable', 'Date.now'], 1),
      'should identify weak token generation');

    // Must identify connection pooling issue
    assert(hasKeywords(r.response, ['pool', 'connect', 'připojení', 'createConnection', 'každ'], 1),
      'should identify creating new DB connection per request');

    // Must identify missing body parser
    assert(hasKeywords(r.response, ['body', 'parser', 'express.json', 'bodyParser', 'req.body', 'undefined'], 1),
      'should identify missing body parser middleware');

    // Should provide fixes, not just list problems
    assert(r.response.includes('```'),
      'review should include code fixes, not just text');
  }, PROJECT_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Project Quality — Analysis Accuracy');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('technical analysis is specific and actionable', async () => {
    const convId = await createConv('pq-analysis');
    createdConvs.push(convId);

    const r = await chatInConv(convId,
      `Analyzuj tento design a řekni mi co je špatně a jak to opravit:

Mám React aplikaci kde:
- Globální stav je v jednom velkém Context (AppContext) se ~50 properties
- Každá změna jedné property re-renderuje celou aplikaci
- API volání jsou ve useEffect hoocích přímo v komponentách
- Formuláře používají nekontrolované inputy s ref
- Routing je custom implementace (ne React Router) přes window.location
- Styly jsou inline objekty definované přímo v JSX

Poraď mi s refactoringem.`
    );

    assert(r.response.length > 400,
      `analysis too short: ${r.response.length}`);

    // Should identify specific problems
    const issues = [];
    if (hasKeywords(r.response, ['Context', 'context split', 'rozdělení', 'useMemo', 'memo', 're-render', 'performance'], 1)) issues.push('context-splitting');
    if (hasKeywords(r.response, ['custom hook', 'useApi', 'service', 'abstrakc', 'separate', 'odděl'], 1)) issues.push('api-abstraction');
    if (hasKeywords(r.response, ['controlled', 'kontrolovan', 'useState', 'form', 'řízené'], 1)) issues.push('form-pattern');
    if (hasKeywords(r.response, ['React Router', 'router', 'routing', 'navigac'], 1)) issues.push('routing');
    if (hasKeywords(r.response, ['CSS module', 'styled', 'Tailwind', 'className', 'styl', 'css-in-js'], 1)) issues.push('styling');
    if (hasKeywords(r.response, ['Redux', 'Zustand', 'Jotai', 'Recoil', 'state manag'], 1)) issues.push('state-management');

    assert(issues.length >= 4,
      `should address ≥4 issues, found: ${issues.join(', ')}`);

    // Should give specific advice, not just "this is bad"
    assert(scoreStructure(r.response) >= 3,
      'analysis should be well-structured with specific recommendations');

    // Should include code examples OR very specific inline code references
    assert(r.response.includes('```') || /`[^`]{5,}`/.test(r.response),
      'should include code examples for recommended changes');
  }, PROJECT_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Project Quality — Implementation Planning');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('creates detailed implementation plan', async () => {
    const convId = await createConv('pq-plan');
    createdConvs.push(convId);

    const r = await chatInConv(convId,
      `Potřebuji naplánovat implementaci notifikačního systému pro webovou aplikaci. Požadavky:
- Real-time notifikace přes WebSocket
- Perzistence v databázi (nepřečtené notifikace)
- Typy: info, warning, error, success
- Grouping podobných notifikací
- Mark as read / mark all as read
- Push notifikace (volitelně)

Vytvoř mi detailní implementační plán s konkrétními kroky, technologiemi a odhadem složitosti.`
    );

    assert(r.response.length > 500,
      `plan too short: ${r.response.length}`);

    // Should have structured steps
    const hasSteps = /\d+[.)]\s/.test(r.response) || /#{2,3}\s/.test(r.response);
    assert(hasSteps, 'plan should have numbered/structured steps');

    // Should mention specific technologies
    assert(hasKeywords(r.response, ['WebSocket', 'Socket.io', 'ws', 'SSE'], 1),
      'should specify real-time technology');
    assert(hasKeywords(r.response, ['databáz', 'database', 'tabulk', 'table', 'model', 'schéma', 'schema', 'SQL', 'migration'], 1),
      'should specify database approach');

    // Should address complexity
    assert(hasKeywords(r.response, ['složit', 'complex', 'priorit', 'fáz', 'phase', 'krok', 'step', 'den', 'day', 'hodin', 'hour'], 1),
      'should estimate complexity or phases');

    // Should mention at least 4 of the 6 requirements
    const reqCovered = [];
    if (hasKeywords(r.response, ['real-time', 'WebSocket', 'ws', 'Socket', 'SSE'], 1)) reqCovered.push('realtime');
    if (hasKeywords(r.response, ['databáz', 'perzist', 'uložení', 'store', 'persist'], 1)) reqCovered.push('persistence');
    if (hasKeywords(r.response, ['typ', 'type', 'info', 'warning', 'error', 'success'], 2)) reqCovered.push('types');
    if (hasKeywords(r.response, ['group', 'skupin', 'seskup', 'aggreg'], 1)) reqCovered.push('grouping');
    if (hasKeywords(r.response, ['přečten', 'read', 'mark', 'označ'], 1)) reqCovered.push('mark-read');
    if (hasKeywords(r.response, ['push', 'Push', 'FCM', 'APNs', 'notifik'], 1)) reqCovered.push('push');

    assert(reqCovered.length >= 4,
      `should cover ≥4 requirements, found: ${reqCovered.join(', ')}`);
  }, PROJECT_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Project Quality — End-to-End Coherence');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('multi-turn project discussion maintains coherence', async () => {
    const convId = await createConv('pq-coherence');
    createdConvs.push(convId);

    // Turn 1: Define project
    const r1 = await chatInConv(convId,
      'Chci vytvořit API pro správu úkolů (task manager). Tech stack: Fastify, SQLite, TypeScript. Jaké endpointy a modely potřebuji? Odpověz v chatu.'
    );
    assert(r1.response.length > 200, 'T1 should describe endpoints and models');

    // Turn 2: Ask for schema
    const r2 = await chatInConv(convId,
      'Vypiš mi SQL schéma pro databázi toho task manageru. Chci tabulky tasks, users a categories.'
    );
    assert(hasKeywords(r2.response, ['CREATE TABLE', 'tasks', 'users', 'categories'], 2),
      'T2 should have SQL CREATE TABLE statements');

    // Turn 3: Ask for endpoint implementation
    const r3 = await chatInConv(convId,
      'Vypiš mi implementaci GET /tasks endpointu ve Fastify. Má podporovat filtrování podle kategorie a stavu, paginaci, a řazení. Odpověz přímo v chatu kódem.'
    );

    const code = r3.response.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/)?.[1] || '';

    // Should use Fastify (preferred) or at least a proper Node.js framework
    assert(hasKeywords(code, ['fastify', 'Fastify', 'reply', 'schema', 'express', 'Express', 'app.get', 'router', 'get('], 1),
      'T3 code should use a web framework');

    // Should use SQLite (not MySQL/Postgres)
    assert(hasKeywords(r3.response, ['sqlite', 'SQLite', 'better-sqlite', 'sql.js'], 1)
      || hasKeywords(code, ['db.', 'prepare', 'SELECT', 'query'], 2),
      'T3 should reference SQLite');

    // Should have filtering, pagination, sorting
    assert(hasKeywords(code, ['category', 'kategori', 'status', 'stav', 'WHERE', 'filter'], 1),
      'T3 should filter by category/status');
    assert(hasKeywords(code, ['page', 'limit', 'offset', 'LIMIT', 'paginac'], 1),
      'T3 should have pagination');
    assert(hasKeywords(code, ['sort', 'ORDER BY', 'řazen', 'order'], 1),
      'T3 should have sorting');

    // Turn 4: Summary test
    const r4 = await chatInConv(convId,
      'Shrň mi celý návrh toho task manageru — jaké máme endpointy, jakou databázi, jaké tabulky.'
    );

    // Should accurately reference tables or data model (may use Czech)
    assert(hasKeywords(r4.response, ['tasks', 'users', 'categories', 'úkol', 'uživatel', 'kategori', 'tabulk', 'table', 'schéma', 'schema', 'model', 'databáz', 'SQL', 'CREATE'], 2),
      `T4 summary should mention tables/schema: ${r4.response.substring(0, 300)}`);
    // Should reference Fastify and SQLite
    assert(hasKeywords(r4.response, ['Fastify', 'SQLite', 'fastify', 'sqlite'], 1),
      'T4 summary should reference the tech stack');
  }, PROJECT_TIMEOUT * 1.5);

} finally {
  for (const id of createdConvs) await cleanupConversation(id);
  for (const id of createdProjects) await cleanupProject(id);
  for (const dir of createdProjectDirs) {
    try { removeOwnedTempDir(dir); } catch {}
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
