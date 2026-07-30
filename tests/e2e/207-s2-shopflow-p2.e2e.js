// 207-s2-shopflow-p2.e2e.js — S2 ShopFlow: Phase 2 — Core + DB (9 turns)
import { suite, testAsync, assert, summary, waitForServer, chatWithTimeout, hasKeywords } from './_helpers.js';
import { extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreCode } from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's2-shopflow', PHASE_NUM = 2, TURN_TIMEOUT = 300_000;

const TURNS = [
  { prompt: 'Pokračujeme v ShopFlow. Vypiš `database.py` — SQLite init, CREATE TABLE pro users, products, orders, order_items s foreign keys a indexy. FTS5 virtual table products_fts pro fulltext search. Funkce init_db(), get_db().', expectedFiles: ['database.py'], verify: r => hasKeywords(r.response, ['CREATE TABLE', 'FTS5', 'VIRTUAL TABLE'], 3) },
  { prompt: 'V `database.py` chybí FTS5 sync trigger. Přidej AFTER INSERT, UPDATE, DELETE triggery na products → sync do products_fts. Vypiš celou opravenou `database.py`.', expectedFiles: ['database.py'], verify: r => hasKeywords(r.response, ['TRIGGER', 'INSERT', 'UPDATE', 'DELETE'], 3) },
  { prompt: 'Vypiš `models/user.py` — funkce: register(email, password) s werkzeug password hash, login(email, password) ověří hash, get_by_id(id), get_by_email(email). Export všech funkcí.', expectedFiles: ['models/user.py'], verify: r => hasKeywords(r.response, ['register', 'login', 'werkzeug', 'check_password_hash'], 3) },
  { prompt: 'Vypiš `models/product.py` — create, get_by_id, list(category=None, search_query=None, page=1, per_page=20), update_stock, delete. Search query používá FTS5 MATCH.', expectedFiles: ['models/product.py'], verify: r => hasKeywords(r.response, ['MATCH', 'FTS5', 'list', 'search'], 2) },
  { prompt: 'V `models/product.py` search nefunguje správně s FTS5. Musíš JOINovat products s products_fts přes rowid. Vypiš celou opravenou `models/product.py`.', expectedFiles: ['models/product.py'], verify: r => hasKeywords(r.response, ['JOIN', 'rowid', 'products_fts'], 2) },
  { prompt: 'Vypiš `models/order.py` — create_order(user_id, cart_items: list[dict]) vytvoří order + order_items, get_orders(user_id), get_order(id), update_status(id, status).', expectedFiles: ['models/order.py'], verify: r => hasKeywords(r.response, ['create_order', 'order_items', 'update_status'], 2) },
  { prompt: 'Vypiš `cart.py` — session-based cart: add_item(product_id, quantity), remove_item(product_id), update_quantity(product_id, quantity), get_cart(), clear_cart(), get_total(). Session struktura: { product_id: { quantity, price, name } }.', expectedFiles: ['cart.py'], verify: r => hasKeywords(r.response, ['session', 'add_item', 'get_cart', 'get_total'], 3) },
  { prompt: 'V `cart.py` co když přidám víc kusů než je na skladě? Přidej validaci — get current stock, pokud quantity > stock vrať error. Vypiš celou `cart.py`.', expectedFiles: ['cart.py'], verify: r => hasKeywords(r.response, ['stock', 'quantity', 'error', 'validate'], 2) },
  { prompt: 'Vypiš `requirements.txt` — Flask, Jinja2, Werkzeug, Flask-Login, Flask-WTF (konkrétní verze). A `config.py` — SECRET_KEY z env, DATABASE (default shopflow.db), ITEMS_PER_PAGE (20), UPLOAD_FOLDER.', expectedFiles: ['requirements.txt', 'config.py'], verify: r => hasKeywords(r.response, ['Flask', 'SECRET_KEY', 'DATABASE'], 3) },
];

suite('S2-ShopFlow-P2: Core + DB');
await testAsync('Phase 2: 9-turn core implementation', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) { console.log('  Phase 2 completed, skipping.'); return; }
  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p1?.completed) throw new Error('Phase 1 not completed');
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) clearPhase(SUITE_ID, PHASE_NUM);

  await waitForServer();
  const state = loadState(SUITE_ID), convId = state.convId;
  console.log(`  Continuing conv: ${convId}`);

  const results = []; let allCodeBlocks = state.codeBlocks || [];
  for (let i = 0; i < TURNS.length; i++) {
    const t = TURNS[i]; console.log(`  Turn ${i + 1}/${TURNS.length}...`);
    const r = await chatWithTimeout(convId, t.prompt, TURN_TIMEOUT);
    assert(r.status === 200); assert(r.response.length > 50);
    if (t.expectedFiles) { let b = extractCodeBlocks(r.response); b = assignFilenames(b, t.expectedFiles); allCodeBlocks = mergeCodeBlocks(allCodeBlocks, b); }
    const pass = t.verify(r); results.push({ turn: i + 1, pass }); console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
  }

  const passCount = results.filter(r => r.pass).length;
  const codeScore = scoreCode(allCodeBlocks, 'python', { minFiles: 4, mustHaveKeywords: ['FTS5', 'werkzeug', 'session', 'cart'] });
  console.log(`\n  ${passCount}/${TURNS.length} passed, code score ${codeScore}`);

  assert(passCount >= 5); assert(codeScore >= 30);
  state.phases.p2 = { completed: true, passCount, codeScore, results }; state.codeBlocks = allCodeBlocks; saveState(SUITE_ID, state);
});
await summary();
