// 208-s2-shopflow-p3.e2e.js — S2 ShopFlow: Phase 3 — Routes + Auth (10 turns)
import { suite, testAsync, assert, summary, waitForServer, chatWithTimeout, hasKeywords } from './_helpers.js';
import { extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreCode } from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's2-shopflow', PHASE_NUM = 3, TURN_TIMEOUT = 300_000;

const TURNS = [
  { prompt: 'Pokračujeme v ShopFlow. Vypiš `app.py` — Flask app factory: create_app() init app, registrace blueprintů (auth, products, cart, orders, admin), Flask-Login init, error handlers (404, 500), secret key z config.', expectedFiles: ['app.py'], verify: r => hasKeywords(r.response, ['create_app', 'blueprint', 'Flask-Login', 'register_blueprint'], 3) },
  { prompt: 'Vypiš `blueprints/auth.py` — routes: GET/POST /register (formulář + validace email/heslo), GET/POST /login (login_user), /logout (logout_user). Flask-WTF forms s CSRF.', expectedFiles: ['blueprints/auth.py'], verify: r => hasKeywords(r.response, ['register', 'login', 'logout', 'Flask-WTF', 'CSRF'], 3) },
  { prompt: 'V `blueprints/auth.py` chybí CSRF token v šablonách a email validace. Přidej validaci (email musí obsahovat @), hasPlaceholder pro heslo min 8 znaků. Vypiš celou `blueprints/auth.py`.', expectedFiles: ['blueprints/auth.py'], verify: r => hasKeywords(r.response, ['@', 'len(', 'csrf_token', 'validate'], 3) },
  { prompt: 'Vypiš `blueprints/products.py` — GET /products (list s paginací + search query), GET /products/<id> (detail), GET /products/category/<cat> (filter). Použij models/product.py.', expectedFiles: ['blueprints/products.py'], verify: r => hasKeywords(r.response, ['/products', 'pagination', 'search', 'category'], 3) },
  { prompt: 'Vypiš `blueprints/cart.py` — POST /cart/add, POST /cart/remove, POST /cart/update, GET /cart (view košíku), POST /cart/clear. Všechny routes používají cart.py funkce.', expectedFiles: ['blueprints/cart.py'], verify: r => hasKeywords(r.response, ['/cart/add', '/cart/remove', 'POST', 'session'], 3) },
  { prompt: 'Vypiš `blueprints/orders.py` — GET /checkout (zobrazí košík + form), POST /checkout (vytvoří order, redirect na payment), GET /orders (historie), GET /orders/<id> (detail), GET /payment/<order_id> (mock payment page).', expectedFiles: ['blueprints/orders.py'], verify: r => hasKeywords(r.response, ['checkout', 'payment', 'create_order', 'redirect'], 3) },
  { prompt: 'V `blueprints/orders.py` mock payment by měl simulovat 2s delay (time.sleep) a 10% šanci na failure (random). Na success update_status("paid"), na failure update_status("failed"). Vypiš celou `blueprints/orders.py`.', expectedFiles: ['blueprints/orders.py'], verify: r => hasKeywords(r.response, ['sleep', 'random', 'paid', 'failed'], 3) },
  { prompt: 'Vypiš `blueprints/admin.py` — @admin_required dekorátor (check user.role=="admin"), GET /admin (dashboard stats), GET/POST /admin/products (CRUD tabulka), POST /admin/products/<id>/delete, GET /admin/orders (list + update status).', expectedFiles: ['blueprints/admin.py'], verify: r => hasKeywords(r.response, ['admin_required', 'role', 'dashboard', 'CRUD'], 3) },
  { prompt: 'V `blueprints/admin.py` admin_required by měl kontrolovat user.role=="admin" a pokud ne vrátit 403 Forbidden. A v database.py přidej seed data — vytvořit defaultního admin usera. Vypiš `blueprints/admin.py` a `database.py`.', expectedFiles: ['blueprints/admin.py', 'database.py'], verify: r => hasKeywords(r.response, ['403', 'Forbidden', 'seed', 'admin@'], 3) },
  { prompt: 'Rekapituluj routes — vypiš tabulku: Endpoint | Method | Popis | Auth required (ano/ne). Všechny routes z auth, products, cart, orders, admin.', expectedFiles: null, verify: r => hasKeywords(r.response, ['/register', '/products', '/cart', '/checkout', '/admin'], 4) },
];

suite('S2-ShopFlow-P3: Routes + Auth');
await testAsync('Phase 3: 10-turn routes + auth', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) { console.log('  Phase 3 completed, skipping.'); return; }
  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p2?.completed) throw new Error('Phase 2 not completed');
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) clearPhase(SUITE_ID, PHASE_NUM);

  await waitForServer();
  const state = loadState(SUITE_ID), convId = state.convId;
  const results = []; let allCodeBlocks = state.codeBlocks || [];
  for (let i = 0; i < TURNS.length; i++) {
    const t = TURNS[i]; console.log(`  Turn ${i + 1}/${TURNS.length}...`);
    const r = await chatWithTimeout(convId, t.prompt, TURN_TIMEOUT);
    assert(r.status === 200); assert(r.response.length > 50);
    if (t.expectedFiles) { let b = extractCodeBlocks(r.response); b = assignFilenames(b, t.expectedFiles); allCodeBlocks = mergeCodeBlocks(allCodeBlocks, b); }
    const pass = t.verify(r); results.push({ turn: i + 1, pass }); console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
  }

  const passCount = results.filter(r => r.pass).length;
  const codeScore = scoreCode(allCodeBlocks, 'python', { minFiles: 7, mustHaveKeywords: ['blueprint', 'login_user', 'CSRF', 'admin_required', 'random'] });
  console.log(`\n  ${passCount}/${TURNS.length} passed, code score ${codeScore}`);

  state.phases.p3 = { completed: true, passCount, codeScore, results }; state.codeBlocks = allCodeBlocks; saveState(SUITE_ID, state);
  assert(passCount >= 6); assert(codeScore >= 30);
});
await summary();
