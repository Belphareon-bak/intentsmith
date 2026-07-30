// 210-s2-shopflow-p5.e2e.js — S2 ShopFlow: Phase 5 — Export + Tests (9 turns)
import { suite, testAsync, assert, summary, waitForServer, chatWithTimeout, hasKeywords } from './_helpers.js';
import { extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreTests } from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's2-shopflow', PHASE_NUM = 5, TURN_TIMEOUT = 300_000;

const TURNS = [
  { prompt: 'Pokračujeme v ShopFlow. Vypiš `utils/export.py` — CSV export objednávek: export_orders_csv(start_date, end_date) → CSV string s headers (id, user_email, total, status, created_at). Použij csv.writer.', expectedFiles: ['utils/export.py'], verify: r => hasKeywords(r.response, ['csv', 'export_orders_csv', 'writer', 'start_date'], 3) },
  { prompt: 'Vypiš `utils/reports.py` — monthly_report(month, year) → dict { total_orders, revenue, top_products: [(name, count)], new_users }. SQL agregace z DB.', expectedFiles: ['utils/reports.py'], verify: r => hasKeywords(r.response, ['monthly_report', 'total_orders', 'revenue', 'top_products', 'GROUP BY'], 3) },
  { prompt: 'Přidej route pro CSV download do `blueprints/admin.py` — GET /admin/export?start=YYYY-MM-DD&end=YYYY-MM-DD vrátí CSV s Content-Disposition attachment. Vypiš opravenou `blueprints/admin.py`.', expectedFiles: ['blueprints/admin.py'], verify: r => hasKeywords(r.response, ['/admin/export', 'Content-Disposition', 'attachment', 'csv'], 3) },
  { prompt: 'Vypiš `tests/test_models.py` — pytest testy: test_user_register (hash check), test_user_login (valid/invalid), test_product_create, test_product_search (FTS5), test_order_create. Použij tmp SQLite DB.', expectedFiles: ['tests/test_models.py'], verify: r => hasKeywords(r.response, ['pytest', 'test_user', 'test_product', 'test_order', 'assert'], 3) },
  { prompt: 'Vypiš `tests/test_auth.py` — pytest testy: test_register_success, test_register_invalid_email, test_login_success, test_login_wrong_password, test_logout. Flask test client.', expectedFiles: ['tests/test_auth.py'], verify: r => hasKeywords(r.response, ['test_register', 'test_login', 'test_logout', 'client', 'post'], 3) },
  { prompt: 'Vypiš `tests/test_cart.py` — testy košíku: test_add_item, test_remove_item, test_stock_validation (qty > stock), test_clear_cart, test_get_total. Mock session.', expectedFiles: ['tests/test_cart.py'], verify: r => hasKeywords(r.response, ['test_add_item', 'test_stock', 'session', 'assert'], 3) },
  { prompt: 'Vypiš `tests/test_orders.py` — testy: test_checkout_flow (košík → order → payment mock), test_payment_success, test_payment_failure, test_order_history. Mock random pro payment.', expectedFiles: ['tests/test_orders.py'], verify: r => hasKeywords(r.response, ['test_checkout', 'test_payment', 'mock', 'random'], 3) },
  { prompt: 'V `tests/test_models.py` chybí test pro FTS5 search s diakritikou (vařit vs varit). Doplň test_product_search_diacritics. Vypiš celou opravenou `tests/test_models.py`.', expectedFiles: ['tests/test_models.py'], verify: r => hasKeywords(r.response, ['diacritics', 'FTS5', 'search', 'vař'], 2) },
  { prompt: 'Kolik testů máme celkem? Spočítej test coverage — které moduly/funkce jsou pokryty, které chybí? Co ještě není otestováno?', expectedFiles: null, verify: r => hasKeywords(r.response, ['coverage', 'pokryt', 'chybí'], 2) },
];

suite('S2-ShopFlow-P5: Export + Tests');
await testAsync('Phase 5: 9-turn export + tests', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) { console.log('  Phase 5 completed, skipping.'); return; }
  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p4?.completed) throw new Error('Phase 4 not completed');
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) clearPhase(SUITE_ID, PHASE_NUM);

  await waitForServer();
  const state = loadState(SUITE_ID), convId = state.convId;
  const results = []; let testBlocks = [];
  const sourceBlocks = (state.codeBlocks || []).filter(b => !(b.filename || '').includes('test'));
  for (let i = 0; i < TURNS.length; i++) {
    const t = TURNS[i]; console.log(`  Turn ${i + 1}/${TURNS.length}...`);
    const r = await chatWithTimeout(convId, t.prompt, TURN_TIMEOUT);
    assert(r.status === 200); assert(r.response.length > 50);
    if (t.expectedFiles) { let b = extractCodeBlocks(r.response); b = assignFilenames(b, t.expectedFiles); testBlocks = mergeCodeBlocks(testBlocks, b); }
    const pass = t.verify(r); results.push({ turn: i + 1, pass }); console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
  }

  const passCount = results.filter(r => r.pass).length;
  const testScore = scoreTests(testBlocks, sourceBlocks);

  console.log(`\n  ${passCount}/${TURNS.length} passed, test score ${testScore}`);

  const allCodeBlocks = mergeCodeBlocks(state.codeBlocks || [], testBlocks);
  assert(passCount >= 5); assert(testScore >= 30);
  state.phases.p5 = { completed: true, passCount, testScore, results }; state.codeBlocks = allCodeBlocks; saveState(SUITE_ID, state);
});
await summary();
