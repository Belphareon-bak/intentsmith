// 209-s2-shopflow-p4.e2e.js — S2 ShopFlow: Phase 4 — Frontend Templates (8 turns)
import { suite, testAsync, assert, summary, waitForServer, chatWithTimeout, hasKeywords } from './_helpers.js';
import { extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreTemplate } from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's2-shopflow', PHASE_NUM = 4, TURN_TIMEOUT = 300_000;

const TURNS = [
  { prompt: 'Pokračujeme v ShopFlow — frontend šablony. Vypiš `templates/base.html` — Jinja2 base: <!DOCTYPE>, <nav> s odkazy (Home, Products, Cart, Login/Logout), {% block content %}, flash messages, Bootstrap 5 CDN, footer.', expectedFiles: ['templates/base.html'], verify: r => hasKeywords(r.response, ['extends', 'block content', 'nav', 'flash', 'Bootstrap'], 3) },
  { prompt: 'Vypiš `templates/products/list.html` — extends base, grid karet produktů (obrázek, název, cena, "Do košíku" button), search form nahoře, pagination dole. Jinja2 for loop přes products.', expectedFiles: ['templates/products/list.html'], verify: r => hasKeywords(r.response, ['{% extends', '{% for', 'pagination', 'card'], 3) },
  { prompt: 'Vypiš `templates/products/detail.html` — detail produktu: velký obrázek, název, popis, cena, skladem (stock), quantity input, "Přidat do košíku" form s CSRF token.', expectedFiles: ['templates/products/detail.html'], verify: r => hasKeywords(r.response, ['detail', 'stock', 'quantity', 'csrf_token'], 3) },
  { prompt: 'Vypiš `templates/cart.html` — tabulka položek v košíku: produkt | cena | množství (update input) | subtotal | akce (remove button). Dole total, "Pokračovat na pokladnu" button.', expectedFiles: ['templates/cart.html'], verify: r => hasKeywords(r.response, ['table', 'quantity', 'total', 'checkout', 'remove'], 3) },
  { prompt: 'Vypiš `templates/auth/login.html` a `templates/auth/register.html` — oba extends base, form s email, password inputy, CSRF token, submit button, odkaz na druhý formulář.', expectedFiles: ['templates/auth/login.html', 'templates/auth/register.html'], verify: r => hasKeywords(r.response, ['login', 'register', 'email', 'password', 'csrf'], 4) },
  { prompt: 'Vypiš `templates/admin/dashboard.html` — admin panel: statistiky (celkem objednávek, tržby dnes, produktů na skladě), tabulka posledních objednávek (id, user, total, status), odkazy na Products a Orders management.', expectedFiles: ['templates/admin/dashboard.html'], verify: r => hasKeywords(r.response, ['dashboard', 'statist', 'tržb', 'objednávek', 'admin'], 3) },
  { prompt: 'V `templates/base.html` chybí responsive meta tag a navbar collapse pro mobil. Přidej <meta name="viewport">, navbar-toggler button, collapse div. Vypiš celou `templates/base.html`.', expectedFiles: ['templates/base.html'], verify: r => hasKeywords(r.response, ['viewport', 'navbar-toggler', 'collapse'], 2) },
  { prompt: 'Vypiš `static/style.css` — custom styly: .product-card (shadow, hover efekt), .flash-message (barvy podle category), .admin-table (striped rows), .cart-total (bold, větší font).', expectedFiles: ['static/style.css'], verify: r => hasKeywords(r.response, ['.product-card', '.flash-message', '.admin-table', 'hover'], 3) },
];

suite('S2-ShopFlow-P4: Frontend Templates');
await testAsync('Phase 4: 8-turn template creation', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) { console.log('  Phase 4 completed, skipping.'); return; }
  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p3?.completed) throw new Error('Phase 3 not completed');
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) clearPhase(SUITE_ID, PHASE_NUM);

  await waitForServer();
  const state = loadState(SUITE_ID), convId = state.convId;
  const results = []; let templateBlocks = [];
  for (let i = 0; i < TURNS.length; i++) {
    const t = TURNS[i]; console.log(`  Turn ${i + 1}/${TURNS.length}...`);
    const r = await chatWithTimeout(convId, t.prompt, TURN_TIMEOUT);
    assert(r.status === 200); assert(r.response.length > 50);
    if (t.expectedFiles) { let b = extractCodeBlocks(r.response); b = assignFilenames(b, t.expectedFiles); templateBlocks = mergeCodeBlocks(templateBlocks, b); }
    const pass = t.verify(r); results.push({ turn: i + 1, pass }); console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
  }

  const passCount = results.filter(r => r.pass).length;
  let templateScore = 0;
  for (const b of templateBlocks) {
    const fn = (b.filename || '').toLowerCase();
    if (fn.endsWith('.html') || fn.endsWith('.jinja2')) templateScore += scoreTemplate(b.code);
  }
  const avgTemplateScore = templateBlocks.length > 0 ? Math.round(templateScore / templateBlocks.length) : 0;

  console.log(`\n  ${passCount}/${TURNS.length} passed, avg template score ${avgTemplateScore}`);

  const allCodeBlocks = mergeCodeBlocks(state.codeBlocks || [], templateBlocks);
  assert(passCount >= 5); assert(avgTemplateScore >= 30);
  state.phases.p4 = { completed: true, passCount, avgTemplateScore, results }; state.codeBlocks = allCodeBlocks; saveState(SUITE_ID, state);
});
await summary();
