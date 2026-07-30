// 201-s1-minic3-p2.e2e.js — S1 MiniC3: Phase 2 — Core Implementation (10 turns)
// ══════════════════════════════════════════════════════════════════════════════
// Database, models, intent classifier, tool registry, tool executor.
// Loads state from P1, accumulates code blocks.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, assertEqual, summary,
  waitForServer, chatWithTimeout, hasKeywords,
} from './_helpers.js';
import {
  extractCodeBlocks, assignFilenames, mergeCodeBlocks,
  scoreCode, checkJsSyntax, hasPlaceholder,
} from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's1-minic3';
const PHASE_NUM = 2;
const TURN_TIMEOUT = 600_000;

const TURNS = [
  {
    prompt: 'Pokračujeme v MiniC3. Začneme s databází. Vypiš `database.js` — SQLite init přes better-sqlite3, CREATE TABLE pro conversations, messages, tools_log. Synchronní API, WAL mode, foreign keys. Exportuj funkce initDb(), getDb().',
    expectedFiles: ['database.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['CREATE TABLE', 'better-sqlite3', 'conversations', 'messages'], 3),
  },
  {
    prompt: 'V tom `database.js` jsi nepoužil WAL mode. Přidej `PRAGMA journal_mode=WAL` a `PRAGMA foreign_keys=ON` hned po otevření DB. A ten index na messages — přidej ještě composite index na (conversation_id, created_at) pro rychlé řazení. Vypiš opravenou verzi celého `database.js`.',
    expectedFiles: ['database.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['WAL', 'foreign_keys', 'conversation_id', 'created_at'], 3),
  },
  {
    prompt: 'Vypiš `models/conversation.js` — funkce: create(title), getById(id), list(limit, offset), delete(id), addMessage(convId, role, content, metadata). Každá funkce vrací plain objekt, ne raw SQLite row. Metadata ukládej jako JSON.stringify, parsuj při čtení.',
    expectedFiles: ['models/conversation.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['create', 'getById', 'addMessage', 'JSON.stringify', 'JSON.parse'], 3),
  },
  {
    prompt: 'V té funkci addMessage — chybí ti validace. Role musí být \'user\', \'assistant\', nebo \'system\'. Content nesmí být prázdný string. Pokud je metadata null nebo undefined, ulož prázdný objekt {}. Přidej tyhle validace s jasným error message a vypiš opravenou verzi celého souboru `models/conversation.js`.',
    expectedFiles: ['models/conversation.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['user', 'assistant', 'system', 'throw', 'Error', 'prázdný'], 3),
  },
  {
    prompt: 'Vypiš `intent-classifier.js`. Struktura: classify(message) vrací { intent, confidence, patterns }. Intenty: SEARCH (vyhledej, najdi, search, find), CODE (napiš kód, implementuj, vytvoř, code, implement), EXPLAIN (vysvětli, co je, jak funguje, explain), CHAT (default). Confidence: hard match = 0.9, partial = 0.6, default = 0.3.',
    expectedFiles: ['intent-classifier.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['SEARCH', 'CODE', 'EXPLAIN', 'CHAT', 'classify', 'confidence'], 4),
  },
  {
    prompt: 'Ten intent classifier má problém — co když zpráva obsahuje \'vysvětli jak napsat kód pro vyhledávání\'? To matchne EXPLAIN i CODE i SEARCH. Potřebuješ prioritní řazení: SEARCH > CODE > EXPLAIN > CHAT. Kdo matchne první, ten vyhraje. Vypiš opravenou verzi celého `intent-classifier.js` s komentáři proč je to řazení takové.',
    expectedFiles: ['intent-classifier.js'],
    type: 'architecture-fix',
    verify: (r) => hasKeywords(r.response, ['priorit', 'SEARCH', 'CODE', 'EXPLAIN'], 3),
  },
  {
    prompt: 'Vypiš `tool-registry.js`. Registry pattern: registerTool(name, { description, execute }), getTool(name), listTools(). Dva vestavěné tooly zaregistrované automaticky: web_search (fetch url přes http, vrátí text) a file_read (přečte soubor z disku, vrátí obsah). Execute funkce jsou async.',
    expectedFiles: ['tool-registry.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['registerTool', 'getTool', 'listTools', 'web_search', 'file_read'], 3),
  },
  {
    prompt: 'V tom `tool-registry.js` — file_read tool nemá sandbox. Přidej whitelist paths jako config parametr (pole povolených adresářů). Před čtením zkontroluj že path.resolve(requestedPath) začíná jedním z whitelistovaných adresářů. Tím se nedá obejít přes \'../\'. Vypiš opravenou verzi celého `tool-registry.js`.',
    expectedFiles: ['tool-registry.js'],
    type: 'security-fix',
    verify: (r) => hasKeywords(r.response, ['path.resolve', 'whitelist', 'startsWith', 'sandbox'], 2),
  },
  {
    prompt: 'Vypiš `tool-executor.js`. Funkce: execute(toolName, params, context) → { success, result, error, duration_ms }. Loguj každé volání do tools_log tabulky přes conversation model. Timeout 30s přes AbortController. Pokud tool hodí error, chyť ho a vrať { success: false, error: message }. Nikdy nepropaguj exception ven.',
    expectedFiles: ['tool-executor.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['execute', 'success', 'duration_ms', 'AbortController', 'catch'], 3),
  },
  {
    prompt: 'Rekapituluj — vypiš seznam všech souborů co jsme napsali, s hlavními exporty z každého. Zkontroluj konzistenci importů — odkazují všechny require/import na správné cesty? Používáme ESM nebo CJS? Je to konzistentní? Jsou tam nějaké chybějící závislosti?',
    expectedFiles: null,
    type: 'review',
    verify: (r) => hasKeywords(r.response, ['database.js', 'intent-classifier', 'tool-registry', 'tool-executor', 'import'], 3),
  },
];

suite('S1-MiniC3-P2: Core Implementation');

await testAsync('Phase 2: 10-turn core implementation', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 2 already completed, skipping.');
    return;
  }

  // Require P1
  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p1?.completed) {
    throw new Error('Phase 1 not completed — run 200-s1-minic3-p1.e2e.js first');
  }

  // Clean partial state
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
    console.log('  Cleaning partial phase 2 state...');
    clearPhase(SUITE_ID, PHASE_NUM);
  }

  await waitForServer();
  const state = loadState(SUITE_ID);
  const convId = state.convId;
  console.log(`  Continuing conv: ${convId}`);

  const results = [];
  let allCodeBlocks = state.codeBlocks || [];

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`  Turn ${i + 1}/${TURNS.length}: ${turn.type}...`);

    const r = await chatWithTimeout(convId, turn.prompt, TURN_TIMEOUT);
    assert(r.status === 200, `Turn ${i + 1} status ${r.status}`);
    assert(r.response.length > 50, `Turn ${i + 1} response too short (${r.response.length} chars)`);

    // Extract and accumulate code blocks
    if (turn.expectedFiles) {
      let blocks = extractCodeBlocks(r.response);
      blocks = assignFilenames(blocks, turn.expectedFiles);
      allCodeBlocks = mergeCodeBlocks(allCodeBlocks, blocks);
    }

    const passed = turn.verify(r);
    results.push({ turn: i + 1, type: turn.type, passed, responseLength: r.response.length });
    console.log(`    ${passed ? 'PASS' : 'FAIL'} (${r.response.length} chars, ${allCodeBlocks.length} files accumulated)`);
  }

  // Score
  const passCount = results.filter(r => r.passed).length;
  const codeScore = scoreCode(allCodeBlocks, 'javascript', {
    minFiles: 4,
    mustHaveKeywords: ['sqlite', 'classify', 'registerTool', 'execute', 'AbortController'],
  });

  // Check syntax on JS blocks
  let syntaxOk = 0;
  let syntaxTotal = 0;
  for (const block of allCodeBlocks) {
    if (block.code.length > 20) {
      syntaxTotal++;
      const r = checkJsSyntax(block.code);
      if (r.ok) syntaxOk++;
    }
  }
  const syntaxRate = syntaxTotal > 0 ? Math.round(100 * syntaxOk / syntaxTotal) : 0;

  // Placeholder check
  const placeholderFree = allCodeBlocks.filter(b => !hasPlaceholder(b.code)).length;
  const placeholderRate = allCodeBlocks.length > 0 ? Math.round(100 * placeholderFree / allCodeBlocks.length) : 100;

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, code score ${codeScore}, syntax ${syntaxRate}%, placeholder-free ${placeholderRate}%`);
  console.log(`  Files: ${allCodeBlocks.map(b => b.filename || 'unnamed').join(', ')}`);

  // Save state
  state.phases.p2 = {
    completed: true,
    turnCount: TURNS.length,
    passCount,
    codeScore,
    syntaxRate,
    placeholderRate,
    results,
  };
  state.codeBlocks = allCodeBlocks;
  saveState(SUITE_ID, state);

  // Assertions
  assert(passCount >= 6, `At least 6/10 turns should pass, got ${passCount}`);
  assert(codeScore >= 30, `Code score should be ≥30, got ${codeScore}`);
});

await summary();
