// 205-s1-minic3-p6.e2e.js — S1 MiniC3: Phase 6 — Finalization (7 turns)
// ══════════════════════════════════════════════════════════════════════════════
// package.json, README.md, .env.example, final review, evaluation.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, summary,
  waitForServer, chatWithTimeout, hasKeywords, cleanupConversation, cleanupProject,
} from './_helpers.js';
import {
  extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreConfigFile,
} from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's1-minic3';
const PHASE_NUM = 6;
const TURN_TIMEOUT = 600_000;

const TURNS = [
  {
    prompt: 'Pokračujeme v MiniC3 — finalizace. Vypiš `package.json` — name: "minic3", version: "1.0.0", description, main: "src/server.js", scripts: { start: "node src/server.js", dev: "node --watch src/server.js", test: "node tests/*.test.js" }, dependencies: express, better-sqlite3, ws, cors. Uveď konkrétní verze (latest stable).',
    expectedFiles: ['package.json'],
    type: 'config',
    verify: (r) => hasKeywords(r.response, ['package.json', 'express', 'better-sqlite3', 'ws', 'scripts'], 3),
  },
  {
    prompt: 'Vypiš `README.md` — # MiniC3, popis projektu (2-3 věty), ## Instalace (npm install), ## Spuštění (npm start), ## API Endpoints (tabulka: endpoint, method, popis), ## Architektura (krátký přehled modulů), ## Konfigurace (ENV proměnné). Markdown formátování.',
    expectedFiles: ['README.md'],
    type: 'docs',
    verify: (r) => hasKeywords(r.response, ['MiniC3', 'npm install', 'API', 'Architektura', 'Konfigurace'], 4),
  },
  {
    prompt: 'V README chybí sekce o konfiguraci ENV proměnných — jaké jsou povinné, jaké volitelné, výchozí hodnoty. A taky příklad použití — jak poslat zprávu přes API curl. Doplň obě sekce a vypiš celý aktualizovaný `README.md`.',
    expectedFiles: ['README.md'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['PORT', 'OLLAMA', 'curl', 'výchozí', 'povinné'], 3),
  },
  {
    prompt: 'Vypiš `.env.example` s komentáři pro všechny konfigurovatelné proměnné: PORT, DB_PATH, OLLAMA_URL, OLLAMA_MODEL, OLLAMA_FALLBACK_MODEL, WHITELIST_DIRS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS. Každá s jednořádkovým komentářem co dělá a výchozí hodnotou.',
    expectedFiles: ['.env.example'],
    type: 'config',
    verify: (r) => hasKeywords(r.response, ['PORT', 'OLLAMA_URL', 'WHITELIST_DIRS', 'RATE_LIMIT'], 3),
  },
  {
    prompt: 'Final review — projdi celý MiniC3 projekt mentálně a řekni: 1) Jaké jsou 3 nejslabší místa (konkrétní moduly/funkce)? 2) Co by bylo potřeba před production deploy? 3) Jaké jsou největší bezpečnostní rizika? 4) Co bys změnil kdybys to psal znovu? Buď kritický a konkrétní, ne obecný.',
    expectedFiles: null,
    type: 'review',
    verify: (r) => r.response.length > 400 && hasKeywords(r.response, ['bezpečnost', 'production', 'rizik', 'změnil'], 2),
  },
  {
    prompt: 'Vypiš kompletní finální strom souborů celého MiniC3 projektu s odhadem počtu řádků u každého souboru. Struktura: adresář/soubor — ~LOC — jednovětvý popis. Chci vidět src/, tests/, config soubory, vše.',
    expectedFiles: null,
    type: 'summary',
    verify: (r) => {
      const fileRefs = (r.response.match(/\.\w{1,5}\b/g) || []).length;
      const locRefs = (r.response.match(/~\d+/g) || []).length;
      return fileRefs >= 12 && locRefs >= 10;
    },
  },
  {
    prompt: 'Ohodnoť kvalitu celého MiniC3 projektu na škále 1-10 z hlediska: 1) Architektura a modularita, 2) Bezpečnost, 3) Error handling, 4) Test coverage, 5) Dokumentace, 6) Production readiness. Pro každé kritérium uveď skóre a zdůvodnění (1-2 věty). Pak celkové zprůměrované skóre a hlavní silné/slabé stránky.',
    expectedFiles: null,
    type: 'evaluation',
    verify: (r) => {
      const scores = (r.response.match(/\b([1-9]|10)\s*\/\s*10\b/g) || []).length;
      return scores >= 5 && hasKeywords(r.response, ['Architektura', 'Bezpečnost', 'Test', 'silné', 'slabé'], 3);
    },
  },
];

suite('S1-MiniC3-P6: Finalization');

await testAsync('Phase 6: 7-turn finalization', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 6 already completed, skipping.');
    return;
  }

  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p5?.completed) {
    throw new Error('Phase 5 not completed');
  }

  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
    clearPhase(SUITE_ID, PHASE_NUM);
  }

  await waitForServer();
  const state = loadState(SUITE_ID);
  const convId = state.convId;
  console.log(`  Continuing conv: ${convId}`);

  const results = [];
  let configBlocks = [];

  for (let i = 0; i < TURNS.length; i++) {
    const turn = TURNS[i];
    console.log(`  Turn ${i + 1}/${TURNS.length}: ${turn.type}...`);

    const r = await chatWithTimeout(convId, turn.prompt, TURN_TIMEOUT);
    assert(r.status === 200, `Turn ${i + 1} status ${r.status}`);
    assert(r.response.length > 50, `Turn ${i + 1} response too short`);

    if (turn.expectedFiles) {
      let blocks = extractCodeBlocks(r.response);
      blocks = assignFilenames(blocks, turn.expectedFiles);
      configBlocks = mergeCodeBlocks(configBlocks, blocks);
    }

    const passed = turn.verify(r);
    results.push({ turn: i + 1, type: turn.type, passed, responseLength: r.response.length });
    console.log(`    ${passed ? 'PASS' : 'FAIL'} (${r.response.length} chars)`);
  }

  const passCount = results.filter(r => r.passed).length;

  // Score config files
  let configScore = 0;
  for (const block of configBlocks) {
    const fn = (block.filename || '').toLowerCase();
    if (fn === 'package.json') configScore += scoreConfigFile(block.code, 'package.json');
    else if (fn.startsWith('.env')) configScore += scoreConfigFile(block.code, '.env');
    else if (fn === 'readme.md') configScore += 50; // README scored separately
  }
  const avgConfigScore = configBlocks.length > 0 ? Math.round(configScore / configBlocks.length) : 0;

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, avg config score ${avgConfigScore}`);
  console.log(`  Config files: ${configBlocks.map(b => b.filename || 'unnamed').join(', ')}`);

  // Merge config into main code blocks
  const allCodeBlocks = mergeCodeBlocks(state.codeBlocks || [], configBlocks);

  try {
    assert(passCount >= 4, `At least 4/7 turns should pass, got ${passCount}`);
  } finally {
    await cleanupConversation(convId);
    await cleanupProject(state.projectId);
  }

  state.phases.p6 = { completed: true, turnCount: TURNS.length, passCount, avgConfigScore, results };
  state.codeBlocks = allCodeBlocks;
  saveState(SUITE_ID, state);

  console.log(`\n✓ S1 MiniC3 COMPLETE — ${allCodeBlocks.length} files total`);
  console.log(`  Phase scores: P1=${state.phases.p1.planScore} P2=${state.phases.p2.codeScore} P3=${state.phases.p3.codeScore} P4=${state.phases.p4.codeScore} P5=${state.phases.p5.testScore} P6=${avgConfigScore}`);
});

await summary();
