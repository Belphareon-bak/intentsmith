// 203-s1-minic3-p4.e2e.js — S1 MiniC3: Phase 4 — Refinement (9 turns)
// ══════════════════════════════════════════════════════════════════════════════
// Health check, guards, validation, rate limiting, config, retry, logger.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, summary,
  waitForServer, chatWithTimeout, hasKeywords,
} from './_helpers.js';
import {
  extractCodeBlocks, assignFilenames, mergeCodeBlocks, scoreCode,
} from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's1-minic3';
const PHASE_NUM = 4;
const TURN_TIMEOUT = 600_000;

const TURNS = [
  {
    prompt: 'Pokračujeme v MiniC3. Potřebuji health check endpoint. Vypiš `routes/health.js` — GET /api/health vrací { status: "ok", uptime: process.uptime(), db: true/false }. DB check: zkus SELECT 1, pokud selže vrať db: false. Export Express router.',
    expectedFiles: ['routes/health.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['health', 'uptime', 'SELECT', 'router'], 3),
  },
  {
    prompt: 'V `tool-registry.js` — co když zavolám getTool(\'neexistující\')? Teď to vrátí undefined a tool-executor spadne. Přidej guard: getTool vrátí null pro neznámý tool a v tool-executor přidej check — pokud tool neexistuje, vrať { success: false, error: "Unknown tool: name" } bez volání execute. Vypiš obě soubory — opravenou `tool-registry.js` a opravenou `tool-executor.js`.',
    expectedFiles: ['tool-registry.js', 'tool-executor.js'],
    type: 'guard',
    verify: (r) => hasKeywords(r.response, ['null', 'Unknown tool', 'success', 'false'], 2),
  },
  {
    prompt: 'Input validace — vypiš `middleware/validate.js`: Express middleware, kontroluje POST /api/chat: body musí mít message (string, neprázdný, max 10000 znaků), conversation_id je volitelné (string nebo number). Pokud validace selže, vrať 400 s { error: konkrétní popis }. A vypiš upravenou `routes/chat.js` kde tuto middleware použiješ.',
    expectedFiles: ['middleware/validate.js', 'routes/chat.js'],
    type: 'multi-file',
    verify: (r) => hasKeywords(r.response, ['validate', 'message', '10000', '400', 'middleware'], 3),
  },
  {
    prompt: 'Rate limiting — vypiš `middleware/rate-limit.js`. Jednoduchý in-memory rate limiter: Map<IP, { count, resetAt }>. Max 60 requestů za minutu per IP. Pokud překročen, vrať 429 s { error: "Too many requests", retryAfter: seconds }. Čisti staré záznamy každou minutu přes setInterval.',
    expectedFiles: ['middleware/rate-limit.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['rate', 'limit', 'Map', '429', '60', 'retryAfter'], 3),
  },
  {
    prompt: 'Vypiš `config.js` — centrální konfigurace z environment proměnných: PORT (default 3000), DB_PATH (default ./data/minic3.db), OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default llama3), OLLAMA_FALLBACK_MODEL (default llama3:latest), WHITELIST_DIRS (comma-separated, default ./data), RATE_LIMIT_MAX (default 60), RATE_LIMIT_WINDOW_MS (default 60000). Export objekt s těmito hodnotami.',
    expectedFiles: ['config.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['PORT', 'DB_PATH', 'OLLAMA_URL', 'OLLAMA_MODEL', 'process.env'], 4),
  },
  {
    prompt: 'Retry logika pro Ollama — vypiš upravenou `llm-client.js` s retry: pokud Ollama vrátí network error nebo timeout, zkus 3× s exponential backoff (1s, 2s, 4s). Pokud všechny pokusy selžou, zkus fallback model (jeden pokus). Pokud i fallback selže, vrať { response: null, error: "All LLM attempts failed" }. Vypiš celý `llm-client.js`.',
    expectedFiles: ['llm-client.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['retry', 'backoff', 'fallback', 'attempt', 'failed'], 3),
  },
  {
    prompt: 'Logger middleware — vypiš `middleware/logger.js`. Loguj každý request: timestamp (ISO), method, path, status code, response time (ms). Formát: "[2024-01-01T12:00:00Z] GET /api/health 200 15ms". Barvy v konzoli: 2xx zelená, 4xx žlutá, 5xx červená (pomocí ANSI codes).',
    expectedFiles: ['middleware/logger.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['logger', 'method', 'path', 'status', 'ms', 'ANSI'], 3),
  },
  {
    prompt: 'Teď aktualizuj `server.js` — zapoj všechny nové middleware a routes: 1) logger jako první middleware, 2) rate-limit, 3) json parser, 4) cors, 5) validate na /api/chat, 6) mount routes/chat.js a routes/health.js, 7) error handler jako poslední. Importuj config.js pro port. Vypiš celý `server.js`.',
    expectedFiles: ['server.js'],
    type: 'update',
    verify: (r) => hasKeywords(r.response, ['logger', 'rateLimit', 'validate', 'health', 'config', 'express'], 4),
  },
  {
    prompt: 'Code review — projdi mentálně všechny soubory co máme a řekni: 1) které importy se nekříží nebo chybí? 2) je error handling konzistentní? 3) jsou tam nějaké potenciální race conditions? 4) co ještě chybí aby to byl production-ready projekt? Buď kritický a konkrétní.',
    expectedFiles: null,
    type: 'review',
    verify: (r) => r.response.length > 300 && hasKeywords(r.response, ['import', 'error', 'chybí'], 2),
  },
];

suite('S1-MiniC3-P4: Refinement');

await testAsync('Phase 4: 9-turn refinement', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 4 already completed, skipping.');
    return;
  }

  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p3?.completed) {
    throw new Error('Phase 3 not completed');
  }

  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
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
    assert(r.response.length > 50, `Turn ${i + 1} response too short`);

    if (turn.expectedFiles) {
      let blocks = extractCodeBlocks(r.response);
      blocks = assignFilenames(blocks, turn.expectedFiles);
      allCodeBlocks = mergeCodeBlocks(allCodeBlocks, blocks);
    }

    const passed = turn.verify(r);
    results.push({ turn: i + 1, type: turn.type, passed, responseLength: r.response.length });
    console.log(`    ${passed ? 'PASS' : 'FAIL'} (${r.response.length} chars, ${allCodeBlocks.length} files)`);
  }

  const passCount = results.filter(r => r.passed).length;
  const codeScore = scoreCode(allCodeBlocks, 'javascript', {
    minFiles: 10,
    mustHaveKeywords: ['health', 'rateLimit', 'validate', 'logger', 'config', 'retry'],
  });

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, code score ${codeScore}`);

  assert(passCount >= 5, `At least 5/9 turns should pass, got ${passCount}`);
  assert(codeScore >= 30, `Code score should be ≥30, got ${codeScore}`);

  state.phases.p4 = { completed: true, turnCount: TURNS.length, passCount, codeScore, results };
  state.codeBlocks = allCodeBlocks;
  saveState(SUITE_ID, state);
});

await summary();
