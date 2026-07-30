// 200-s1-minic3-p1.e2e.js — S1 MiniC3: Phase 1 — Architecture Discussion (10 turns)
// ══════════════════════════════════════════════════════════════════════════════
// Realistic multi-turn architecture planning for a C3-like chat agent.
// Creates project + conversation, saves state for subsequent phases.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, assertEqual, summary,
  waitForServer, chatWithTimeout, createProject, createProjectConv,
  hasKeywords, cleanupConversation, cleanupProject,
} from './_helpers.js';
import { extractCodeBlocks, scorePlan } from './_quality-evaluator.js';
import { loadState, saveState, initState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's1-minic3';
const PHASE_NUM = 1;
const TURN_TIMEOUT = 600_000;

const TURNS = [
  {
    prompt: 'Chci postavit zjednodušeného chatovacího agenta podobného C3. Musí mít REST API pro chat, konverzační historii v SQLite, jednoduchý intent classifier (deterministický, ne přes LLM), a tool executor. Co bys navrhl za architekturu? Jaké moduly a soubory? Jakým způsobem bude fungovat pipeline od přijetí zprávy po odpověď?',
    expectedFiles: null,
    type: 'planning',
    verify: (r) => hasKeywords(r.response, ['sqlite', 'intent', 'tool', 'api', 'pipeline'], 3),
  },
  {
    prompt: 'To zní rozumně, ale nemyslím to jako wrapper nad OpenAI. Chci lokální Ollama integraci. Agent musí umět volat lokální model přes HTTP, parsovat JSON odpovědi, a fallbackovat na jednodušší model pokud hlavní neodpoví do 30 sekund. Uprav architekturu.',
    expectedFiles: null,
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['ollama', 'http', 'fallback', 'timeout'], 2),
  },
  {
    prompt: 'K tomu intent classifieru — nechci žádný LLM-based. Udělej to čistě přes regex pattern matching: SEARCH intent když zpráva obsahuje \'vyhledej/najdi/search\', CODE intent pro \'napiš kód/implementuj/vytvoř\', EXPLAIN pro \'vysvětli/co je/jak funguje\'. Zbytek bude CHAT. Napiš mi návrh těch patterns.',
    expectedFiles: null,
    type: 'specification',
    verify: (r) => hasKeywords(r.response, ['search', 'code', 'explain', 'chat', 'regex'], 3),
  },
  {
    prompt: 'Dobře, a co tool executor? Chci aby měl registry toolů, každý tool má name, description, execute(params) funkci. Zatím dva tooly: web_search (fetch přes HTTP) a file_read (čtení souboru z disku). Jak to propojíš s intent classifierem? Jaký bude flow když uživatel napíše "najdi informace o Pythonu"?',
    expectedFiles: null,
    type: 'architecture',
    verify: (r) => hasKeywords(r.response, ['registry', 'execute', 'web_search', 'file_read'], 2),
  },
  {
    prompt: 'Ještě jsem zapomněl — potřebuju WebSocket server pro real-time notifikace. Když přijde odpověď od LLM, pošle se přes WS klientovi token po tokenu (streaming). A taky notifikace při dokončení tool executionu. Přidej to do architektury a uprav file strukturu. Jak to změní flow zprávy?',
    expectedFiles: null,
    type: 'late-addition',
    verify: (r) => hasKeywords(r.response, ['websocket', 'ws', 'streaming', 'token', 'notifik'], 2),
  },
  {
    prompt: 'Počkej, teď si uvědomuju že ten file_read tool je bezpečnostní riziko. Musíme přidat sandbox — tool může číst jen z whitelistovaného adresáře. Přidej to do návrhu a napiš jaké security kontroly budou potřeba celkově. Myslím input sanitizaci, rate limiting, a ošetření chyb z LLM.',
    expectedFiles: null,
    type: 'security-review',
    verify: (r) => hasKeywords(r.response, ['whitelist', 'sandbox', 'sanitiz', 'rate limit', 'security'], 2),
  },
  {
    prompt: 'OK shrň mi teď celou architekturu v strukturovaném formátu: moduly, soubory, zodpovědnosti, datový tok zprávy od requestu po response. Buď konkrétní, žádné vágní popisy. Chci vidět přesné názvy souborů a funkcí.',
    expectedFiles: null,
    type: 'summary',
    verify: (r) => {
      const plan = scorePlan(r.response, {
        mustHaveKeywords: ['database', 'intent', 'tool', 'chat', 'server', 'websocket', 'route'],
        minFiles: 6,
        errorHandling: true,
      });
      return plan >= 50;
    },
  },
  {
    prompt: 'V tom shrnutí mi chybí error handling strategie. Co se stane když Ollama neodpovídá? Když tool selže uprostřed executionu? Když je nevalidní JSON od modelu? Když klient pošle prázdnou zprávu? Přidej error handling flow pro každý modul — konkrétní chybové stavy a jak se na ně reaguje.',
    expectedFiles: null,
    type: 'refinement',
    verify: (r) => hasKeywords(r.response, ['error', 'chyb', 'timeout', 'json', 'prázdný', 'fallback'], 3),
  },
  {
    prompt: 'A databázové schéma? Potřebuji tabulky: conversations (id, title, created_at, updated_at), messages (id, conversation_id, role, content, metadata JSON, created_at), tools_log (id, tool_name, input, output, success, duration_ms, created_at). Navrhni CREATE TABLE s indexy — minimálně index na conversation_id v messages a composite index na (conversation_id, created_at).',
    expectedFiles: null,
    type: 'db-spec',
    verify: (r) => {
      const upper = r.response.toUpperCase();
      const tables = (upper.match(/CREATE\s+TABLE/g) || []).length;
      return tables >= 3 && hasKeywords(r.response, ['index', 'conversation_id', 'created_at'], 2);
    },
  },
  {
    prompt: 'Finální otázka před kódem — kolik souborů odhaduješ celkem? Vypiš kompletní strom souborů s jednovětným popisem co bude v každém. Chci vidět i testy, config, a package.json. Na základě tohoto stromu začneme postupně implementovat.',
    expectedFiles: null,
    type: 'preparation',
    verify: (r) => {
      const fileRefs = (r.response.match(/\.\w{1,5}\b/g) || []).length;
      return fileRefs >= 8;
    },
  },
];

suite('S1-MiniC3-P1: Architecture Discussion');

await testAsync('Phase 1: 10-turn architecture planning', async () => {
  // Skip if already done
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 1 already completed, skipping.');
    return;
  }

  // Clean partial state from previous crashed run
  const rawState = loadState(SUITE_ID);
  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
    console.log('  Cleaning partial phase 1 state...');
    clearPhase(SUITE_ID, PHASE_NUM);
  }

  await waitForServer();

  // Initialize fresh state
  const state = initState(SUITE_ID);

  // Create project + conversation
  const project = await createProject('minic3', 'MiniC3 — simplified C3 chat agent replica');
  state.projectId = project.id;
  state.projectPath = project.path;

  const convId = await createProjectConv(project.id, 'MiniC3 Architecture');
  state.convId = convId;

  console.log(`  Project: ${project.id}, Conv: ${convId}`);

  const results = [];
  let planText = '';

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`  Turn ${i + 1}/${TURNS.length}: ${turn.type}...`);

    const r = await chatWithTimeout(convId, turn.prompt, TURN_TIMEOUT);
    assert(r.status === 200, `Turn ${i + 1} status ${r.status}`);
    assert(r.response.length > 50, `Turn ${i + 1} response too short (${r.response.length} chars)`);

    const passed = turn.verify(r);
    results.push({ turn: i + 1, type: turn.type, passed, responseLength: r.response.length });
    console.log(`    ${passed ? 'PASS' : 'FAIL'} (${r.response.length} chars)`);

    // Accumulate plan from summary turn
    if (turn.type === 'summary') {
      planText = r.response;
    }
  }

  // Score
  const passCount = results.filter(r => r.passed).length;
  const avgResponseLength = Math.round(results.reduce((s, r) => s + r.responseLength, 0) / results.length);
  const planScore = scorePlan(planText, {
    mustHaveKeywords: ['database', 'intent', 'tool', 'chat', 'server', 'websocket'],
    minFiles: 6,
    errorHandling: true,
  });

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, avg response ${avgResponseLength} chars, plan score ${planScore}`);

  // Save state
  state.phases.p1 = {
    completed: true,
    turnCount: TURNS.length,
    passCount,
    avgResponseLength,
    planScore,
    results,
  };
  state.planText = planText;
  state.context = `MiniC3 — Express+SQLite+Ollama chat agent. ${TURNS.length} architecture turns completed. Plan score: ${planScore}.`;
  saveState(SUITE_ID, state);

  // Assertions
  assert(passCount >= 6, `At least 6/10 turns should pass, got ${passCount}`);
  assert(planScore >= 40, `Plan score should be ≥40, got ${planScore}`);
  assert(avgResponseLength > 200, `Avg response should be >200 chars, got ${avgResponseLength}`);
});

await summary();
