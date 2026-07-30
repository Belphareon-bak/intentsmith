// 204-s1-minic3-p5.e2e.js — S1 MiniC3: Phase 5 — Tests (9 turns)
// ══════════════════════════════════════════════════════════════════════════════
// Test files for intent classifier, tool executor, chat handler, API, rate limit.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, summary,
  waitForServer, chatWithTimeout, hasKeywords,
} from './_helpers.js';
import {
  extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreTests,
} from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's1-minic3';
const PHASE_NUM = 5;
const TURN_TIMEOUT = 600_000;

const TURNS = [
  {
    prompt: 'Pokračujeme v MiniC3 — teď napíšeme testy. Vypiš `tests/setup.js` — testovací helper: createTestDb() (in-memory SQLite s inicializovaným schématem), mockLlmClient (vrací pevnou odpověď "Testovací odpověď"), mockToolRegistry (tools co vracejí { success: true, result: "mock" }), clearDb(db). Export všech helperů.',
    expectedFiles: ['tests/setup.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['createTestDb', 'mock', 'clearDb', 'export'], 3),
  },
  {
    prompt: 'Vypiš `tests/intent-classifier.test.js` — testy pro intent classifier: 1) SEARCH pro "vyhledej python tutorialy", 2) CODE pro "napiš funkci pro třídění", 3) EXPLAIN pro "vysvětli co je rekurze", 4) CHAT pro "ahoj jak se máš", 5) priorita — "vysvětli jak napsat search" = SEARCH ne EXPLAIN, 6) confidence ≥ 0.6 pro hard match. Použij assert z Node.js.',
    expectedFiles: ['tests/intent-classifier.test.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['SEARCH', 'CODE', 'EXPLAIN', 'CHAT', 'assert', 'classify'], 4),
  },
  {
    prompt: 'V testech intent classifieru chybí edge cases: co pro prázdný string? co pro samé čísla "12345"? co pro emoji "😀👍"? co pro mix jazyků "search vysvětli"? Doplň tyto edge cases do `tests/intent-classifier.test.js` a vypiš celý soubor.',
    expectedFiles: ['tests/intent-classifier.test.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['prázdný', 'empty', 'edge', 'emoji', 'mix'], 2),
  },
  {
    prompt: 'Vypiš `tests/tool-executor.test.js` — testy: 1) happy path — web_search s mock fetch vrátí úspěch, 2) happy path — file_read z whitelistovaného adresáře, 3) sandbox violation — file_read mimo whitelist vrátí error, 4) neexistující tool vrátí { success: false }, 5) timeout — tool co trvá >30s vrátí timeout error, 6) duration_ms je kladné číslo.',
    expectedFiles: ['tests/tool-executor.test.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['web_search', 'file_read', 'sandbox', 'timeout', 'duration'], 3),
  },
  {
    prompt: 'Vypiš `tests/chat-handler.test.js` — integration test s mock LLM a mock tools: 1) jednoduchý chat vrátí response, 2) SEARCH intent spustí web_search tool, 3) kontext obsahuje max 10 zpráv, 4) zprávy se ukládají do DB, 5) prázdný message vyhodí error. Použij createTestDb() z setup.js.',
    expectedFiles: ['tests/chat-handler.test.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['handleMessage', 'mock', 'SEARCH', 'web_search', 'createTestDb'], 3),
  },
  {
    prompt: 'Vypiš `tests/api.test.js` — HTTP testy: 1) POST /api/chat s validním message vrátí 200 + response, 2) POST /api/chat bez message vrátí 400, 3) GET /api/conversations vrátí pole, 4) GET /api/conversations/:id pro neexistující vrátí 404, 5) DELETE /api/conversations/:id smaže konverzaci, 6) GET /api/health vrátí { status: "ok" }. Nastartuj server na random portu pro testy.',
    expectedFiles: ['tests/api.test.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['POST', 'GET', 'DELETE', '200', '400', '404', 'health'], 4),
  },
  {
    prompt: 'Vypiš `tests/rate-limit.test.js` — test že 61. request za minutu ze stejné IP vrátí 429 s retryAfter. Simuluj IP přes X-Forwarded-For header. Ověř že po uplynutí window se counter resetuje. Ověř že různé IP mají nezávislé countery.',
    expectedFiles: ['tests/rate-limit.test.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['429', '61', 'retryAfter', 'X-Forwarded-For', 'reset'], 3),
  },
  {
    prompt: 'V `tests/chat-handler.test.js` nemáš test pro případ kdy tool throwne exception. Přidej test: mock tool co throwne Error("Tool crashed"), ověř že handleMessage necrashne a vrátí fallback response. Vypiš celý aktualizovaný `tests/chat-handler.test.js`.',
    expectedFiles: ['tests/chat-handler.test.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['throw', 'crash', 'Error', 'fallback', 'catch'], 3),
  },
  {
    prompt: 'Spočítej test coverage — kolik funkcí z celého projektu je pokryto testy, kolik chybí? Vypiš tabulku: modul | funkce | pokryto testů (ano/ne). Co bys ještě otestoval kdybys měl čas? Seřaď chybějící testy podle priority.',
    expectedFiles: null,
    type: 'review',
    verify: (r) => r.response.length > 300 && hasKeywords(r.response, ['pokryt', 'chybí', 'priorit'], 2),
  },
];

suite('S1-MiniC3-P5: Tests');

await testAsync('Phase 5: 9-turn test creation', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 5 already completed, skipping.');
    return;
  }

  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p4?.completed) {
    throw new Error('Phase 4 not completed');
  }

  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
    clearPhase(SUITE_ID, PHASE_NUM);
  }

  await waitForServer();
  const state = loadState(SUITE_ID);
  const convId = state.convId;
  console.log(`  Continuing conv: ${convId}`);

  const results = [];
  let testBlocks = [];
  // Source blocks from previous phases (for scoreTests cross-check)
  const sourceBlocks = (state.codeBlocks || []).filter(b => !(b.filename || '').includes('test'));

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`  Turn ${i + 1}/${TURNS.length}: ${turn.type}...`);

    const r = await chatWithTimeout(convId, turn.prompt, TURN_TIMEOUT);
    assert(r.status === 200, `Turn ${i + 1} status ${r.status}`);
    assert(r.response.length > 50, `Turn ${i + 1} response too short`);

    if (turn.expectedFiles) {
      let blocks = extractCodeBlocks(r.response);
      blocks = assignFilenames(blocks, turn.expectedFiles);
      testBlocks = mergeCodeBlocks(testBlocks, blocks);
    }

    const passed = turn.verify(r);
    results.push({ turn: i + 1, type: turn.type, passed, responseLength: r.response.length });
    console.log(`    ${passed ? 'PASS' : 'FAIL'} (${r.response.length} chars, ${testBlocks.length} test files)`);
  }

  const passCount = results.filter(r => r.passed).length;
  const testScore = scoreTests(testBlocks, sourceBlocks);

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, test score ${testScore}`);
  console.log(`  Test files: ${testBlocks.map(b => b.filename || 'unnamed').join(', ')}`);

  // Merge test blocks into main code blocks for final phase
  const allCodeBlocks = mergeCodeBlocks(state.codeBlocks || [], testBlocks);

  state.phases.p5 = { completed: true, turnCount: TURNS.length, passCount, testScore, results };
  state.codeBlocks = allCodeBlocks;
  saveState(SUITE_ID, state);

  assert(passCount >= 5, `At least 5/9 turns should pass, got ${passCount}`);
  assert(testScore >= 30, `Test score should be ≥30, got ${testScore}`);
});

await summary();
