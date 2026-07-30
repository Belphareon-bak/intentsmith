// 211-s2-shopflow-p6.e2e.js — S2 ShopFlow: Phase 6 — Finalization (7 turns)
import { suite, testAsync, assert, summary, waitForServer, chatWithTimeout, hasKeywords, cleanupConversation, cleanupProject } from './_helpers.js';
import { extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreConfigFile } from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's2-shopflow', PHASE_NUM = 6, TURN_TIMEOUT = 300_000;

const TURNS = [
  { prompt: 'Pokračujeme v ShopFlow — finalizace. Vypiš finální `requirements.txt` se všemi závislostmi + pinned verze (Flask==3.x, Jinja2, Werkzeug, Flask-Login, Flask-WTF, pytest).', expectedFiles: ['requirements.txt'], verify: r => hasKeywords(r.response, ['Flask', 'pytest', '==', 'Jinja2'], 3) },
  { prompt: 'Vypiš `README.md` — # ShopFlow, popis (2-3 věty), ## Features (bullet list), ## Instalace (pip install -r requirements.txt, init DB), ## Spuštění (flask run), ## Admin přístup (default email/heslo), ## Screenshoty (placeholder).', expectedFiles: ['README.md'], verify: r => hasKeywords(r.response, ['ShopFlow', 'Features', 'Instalace', 'Admin'], 3) },
  { prompt: 'V README chybí sekce o admin přístupu a defaultním hesle ze seed data. Doplň sekci ## Admin Login s emailem a heslem. Vypiš celý `README.md`.', expectedFiles: ['README.md'], verify: r => hasKeywords(r.response, ['Admin', 'email', 'heslo', 'admin@'], 2) },
  { prompt: 'Vypiš `.env.example` — SECRET_KEY (náhodný string), DATABASE (shopflow.db), FLASK_APP (app.py), FLASK_ENV (development), ITEMS_PER_PAGE (20). S komentáři.', expectedFiles: ['.env.example'], verify: r => hasKeywords(r.response, ['SECRET_KEY', 'FLASK_APP', 'DATABASE'], 3) },
  { prompt: 'Vypiš `seed_data.py` — skript na naplnění DB testovacími daty: admin user, 10 produktů (různé kategorie), 3 demo objednávky. Import models, volej funkce.', expectedFiles: ['seed_data.py'], verify: r => hasKeywords(r.response, ['admin', 'products', 'orders', 'seed'], 3) },
  { prompt: 'Final review — projdi celý ShopFlow projekt. 3 nejslabší místa? Co před production? Bezpečnostní rizika? Co bys změnil?', expectedFiles: null, verify: r => r.response.length > 300 && hasKeywords(r.response, ['bezpečnost', 'production', 'změnil'], 2) },
  { prompt: 'Kompletní strom souborů s odhady LOC. Pak ohodnoť 1-10: Architektura, Bezpečnost, UX, Test coverage, Dokumentace, Production ready. Celkové skóre + silné/slabé stránky.', expectedFiles: null, verify: r => (r.response.match(/\b([1-9]|10)\s*\/\s*10\b/g) || []).length >= 5 },
];

suite('S2-ShopFlow-P6: Finalization');
await testAsync('Phase 6: 7-turn finalization', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) { console.log('  Phase 6 completed, skipping.'); return; }
  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p5?.completed) throw new Error('Phase 5 not completed');
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) clearPhase(SUITE_ID, PHASE_NUM);

  await waitForServer();
  const state = loadState(SUITE_ID), convId = state.convId;
  const results = []; let configBlocks = [];
  for (let i = 0; i < TURNS.length; i++) {
    const t = TURNS[i]; console.log(`  Turn ${i + 1}/${TURNS.length}...`);
    const r = await chatWithTimeout(convId, t.prompt, TURN_TIMEOUT);
    assert(r.status === 200); assert(r.response.length > 50);
    if (t.expectedFiles) { let b = extractCodeBlocks(r.response); b = assignFilenames(b, t.expectedFiles); configBlocks = mergeCodeBlocks(configBlocks, b); }
    const pass = t.verify(r); results.push({ turn: i + 1, pass }); console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
  }

  const passCount = results.filter(r => r.pass).length;
  let configScore = 0;
  for (const b of configBlocks) {
    const fn = (b.filename || '').toLowerCase();
    if (fn === 'requirements.txt') configScore += scoreConfigFile(b.code, 'requirements.txt');
    else if (fn.startsWith('.env')) configScore += scoreConfigFile(b.code, '.env');
  }
  const avgConfigScore = configBlocks.length > 0 ? Math.round(configScore / configBlocks.length) : 0;

  console.log(`\n  ${passCount}/${TURNS.length} passed, avg config score ${avgConfigScore}`);

  const allCodeBlocks = mergeCodeBlocks(state.codeBlocks || [], configBlocks);
  state.phases.p6 = { completed: true, passCount, avgConfigScore, results }; state.codeBlocks = allCodeBlocks; saveState(SUITE_ID, state);

  console.log(`\n✓ S2 ShopFlow COMPLETE — ${allCodeBlocks.length} files total`);
  console.log(`  Phase scores: P1=${state.phases.p1.planScore} P2=${state.phases.p2.codeScore} P3=${state.phases.p3.codeScore} P4=${state.phases.p4.avgTemplateScore} P5=${state.phases.p5.testScore} P6=${avgConfigScore}`);

  await cleanupConversation(convId);
  await cleanupProject(state.projectId);

  assert(passCount >= 4);
});
await summary();
