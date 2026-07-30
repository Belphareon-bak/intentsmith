// 206-s2-shopflow-p1.e2e.js — S2 ShopFlow: Phase 1 — Research + Architecture (10 turns)
// ══════════════════════════════════════════════════════════════════════════════
// E-commerce platform planning with WEB SEARCH for best practices.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, summary,
  waitForServer, chatWithTimeout, createProject, createProjectConv,
  hasKeywords, cleanupConversation, cleanupProject,
} from './_helpers.js';
import { extractCodeBlocks, scorePlan } from './_quality-evaluator.js';
import { loadState, saveState, initState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's2-shopflow';
const PHASE_NUM = 1;
const TURN_TIMEOUT = 600_000;

function verifySearchUsed(r) {
  if (r.intent === 'SEARCH') return true;
  if (r.data?.metadata?.pipeline === 'SEARCH') return true;
  if (/https?:\/\/\S+/.test(r.response)) return true;
  if (/podle (vyhledávání|výsledků)|nalezl jsem|hledání|webové zdroje/i.test(r.response)) return true;
  return false;
}

const TURNS = [
  {
    prompt: 'Chci postavit e-commerce platformu v Pythonu. Flask + SQLite + Jinja2 šablony. Musí mít produkt katalog s vyhledáváním, košík (shopping cart), objednávky, platební flow, a admin panel pro správu produktů a objednávek. Co bys navrhl za architekturu? Jaké moduly, blueprinty, databázové schéma?',
    expectedFiles: null,
    type: 'planning',
    verify: (r) => hasKeywords(r.response, ['flask', 'sqlite', 'blueprint', 'košík', 'admin'], 3),
  },
  {
    prompt: '**Vyhledej na webu** jaké best practices se doporučují pro Flask e-commerce aplikace v roce 2026. Jaká je doporučená struktura souborů? Jak řešit session management pro košík? Které Flask extensions jsou standardní (Flask-Login, Flask-WTF, atd.)?',
    expectedFiles: null,
    type: 'web-search',
    verify: (r) => verifySearchUsed(r) && hasKeywords(r.response, ['flask', 'extension', 'struktur'], 2),
  },
  {
    prompt: 'Na základě těch doporučení z webu — uprav architekturu. Přidej Flask-Login pro autentizaci (user roles: customer, admin), Flask-WTF pro CSRF ochranu na formulářích, blueprinty pro modularitu (auth, products, cart, orders, admin), a Jinja2 template inheritance s base.html. Jaké budou hlavní routes?',
    expectedFiles: null,
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['Flask-Login', 'Flask-WTF', 'blueprint', 'base.html', 'CSRF'], 3),
  },
  {
    prompt: 'Databázové schéma — navrhni CREATE TABLE pro: users (id, email, password_hash, role, created_at), products (id, name, description, price DECIMAL, stock INTEGER, category, image_url, created_at), orders (id, user_id, status TEXT, total DECIMAL, created_at), order_items (id, order_id, product_id, quantity, price DECIMAL). Foreign keys, indexy na user_id, category, status.',
    expectedFiles: null,
    type: 'db-spec',
    verify: (r) => {
      const tables = (r.response.toUpperCase().match(/CREATE\s+TABLE/g) || []).length;
      return tables >= 4 && hasKeywords(r.response, ['FOREIGN KEY', 'INDEX', 'user_id'], 2);
    },
  },
  {
    prompt: '**Najdi na internetu** příklady implementace shopping cart ve Flask session. Jak se to typicky ukládá? JSON struktura v session? Separátní DB tabulka? Co je výhodnější z hlediska performance a persistence?',
    expectedFiles: null,
    type: 'web-search',
    verify: (r) => verifySearchUsed(r) && hasKeywords(r.response, ['session', 'cart', 'košík'], 2),
  },
  {
    prompt: 'Přidej fulltext search přes produkty — chci hledat v name i description. SQLite má FTS5 (Full-Text Search). Navrhni jak to integrovat: virtual table produkty_fts, trigger pro sync, search funkce. Ukázku CREATE VIRTUAL TABLE a jak vyhledávat.',
    expectedFiles: null,
    type: 'feature-request',
    verify: (r) => hasKeywords(r.response, ['FTS5', 'VIRTUAL TABLE', 'trigger', 'search', 'MATCH'], 3),
  },
  {
    prompt: 'Security checklist — jaké ochrany potřebujeme? CSRF (Flask-WTF), password hashing (werkzeug.security), SQL injection prevence (parametrizované queries), XSS (Jinja2 auto-escape), session security (secret key, httponly cookies). Navrhni konkrétní implementaci každé ochrany.',
    expectedFiles: null,
    type: 'security',
    verify: (r) => hasKeywords(r.response, ['CSRF', 'hash', 'werkzeug', 'parametr', 'secret', 'XSS'], 4),
  },
  {
    prompt: 'Shrň architekturu v strukturovaném formátu: 1) Moduly a blueprinty (auth, products, cart, orders, admin), 2) Routes (endpoint, method, popis, auth required?), 3) DB schéma (tabulky, vztahy), 4) Security controls, 5) Session management. Konkrétní, ne vágní.',
    expectedFiles: null,
    type: 'summary',
    verify: (r) => {
      const plan = scorePlan(r.response, {
        mustHaveKeywords: ['blueprint', 'products', 'cart', 'orders', 'admin', 'auth'],
        minFiles: 8,
        authRequired: true,
        errorHandling: true,
      });
      return plan >= 50;
    },
  },
  {
    prompt: 'Chybí platební flow. Nechci reálnou platební bránu — udělej mock payment. Workflow: 1) user klikne "Dokončit objednávku" v košíku, 2) vytvoří se order se statusem \'pending\', 3) redirect na mock payment page, 4) simuluj 2s delay + 90% success rate, 5) na success nastaví status \'paid\' a vyprázdní košík, 6) na failure status \'failed\'. Přidej do architektury.',
    expectedFiles: null,
    type: 'late-addition',
    verify: (r) => hasKeywords(r.response, ['pending', 'paid', 'failed', 'mock', 'delay', 'success'], 3),
  },
  {
    prompt: 'Kompletní strom souborů — vypiš strukturu celého ShopFlow projektu s jednovětným popisem: app.py, config.py, blueprinty (auth.py, products.py, cart.py, orders.py, admin.py), models/, templates/, static/, tests/, requirements.txt. Na základě toho začneme kódovat.',
    expectedFiles: null,
    type: 'preparation',
    verify: (r) => {
      const fileRefs = (r.response.match(/\.py\b/g) || []).length;
      return fileRefs >= 8;
    },
  },
];

suite('S2-ShopFlow-P1: Research + Architecture');

await testAsync('Phase 1: 10-turn architecture planning with web search', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 1 already completed, skipping.');
    return;
  }

  const rawState = loadState(SUITE_ID);
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
    clearPhase(SUITE_ID, PHASE_NUM);
  }

  await waitForServer();
  const state = initState(SUITE_ID);

  const project = await createProject('shopflow', 'ShopFlow — Flask e-commerce platform');
  state.projectId = project.id;
  state.projectPath = project.path;

  const convId = await createProjectConv(project.id, 'ShopFlow Architecture');
  state.convId = convId;

  console.log(`  Project: ${project.id}, Conv: ${convId}`);

  const results = [];
  let planText = '';
  let searchUsedCount = 0;

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`  Turn ${i + 1}/${TURNS.length}: ${turn.type}...`);

    const r = await chatWithTimeout(convId, turn.prompt, TURN_TIMEOUT);
    assert(r.status === 200, `Turn ${i + 1} status ${r.status}`);
    assert(r.response.length > 50, `Turn ${i + 1} response too short`);

    const passed = turn.verify(r);
    if (turn.type === 'web-search' && verifySearchUsed(r)) searchUsedCount++;
    results.push({ turn: i + 1, type: turn.type, passed, responseLength: r.response.length });
    console.log(`    ${passed ? 'PASS' : 'FAIL'} (${r.response.length} chars)${turn.type === 'web-search' ? ` [search: ${verifySearchUsed(r)}]` : ''}`);

    if (turn.type === 'summary') planText = r.response;
  }

  const passCount = results.filter(r => r.passed).length;
  const planScore = scorePlan(planText, {
    mustHaveKeywords: ['blueprint', 'products', 'cart', 'orders', 'admin', 'FTS5'],
    minFiles: 8,
    authRequired: true,
  });

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, plan score ${planScore}, web search used ${searchUsedCount}/2 times`);

  state.phases.p1 = { completed: true, turnCount: TURNS.length, passCount, planScore, searchUsedCount, results };
  state.planText = planText;
  state.context = `ShopFlow — Flask+SQLite e-commerce. ${TURNS.length} architecture turns, ${searchUsedCount} web searches. Plan score: ${planScore}.`;
  saveState(SUITE_ID, state);

  assert(passCount >= 6, `At least 6/10 turns should pass, got ${passCount}`);
  assert(planScore >= 40, `Plan score should be ≥40, got ${planScore}`);
  assert(searchUsedCount >= 1, `At least 1 web search should be used, got ${searchUsedCount}`);
});

await summary();
