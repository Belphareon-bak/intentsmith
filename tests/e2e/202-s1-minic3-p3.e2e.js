// 202-s1-minic3-p3.e2e.js — S1 MiniC3: Phase 3 — Chat Pipeline + LLM (10 turns)
// ══════════════════════════════════════════════════════════════════════════════
// chat-handler, llm-client, routes, server, ws-server.
// ══════════════════════════════════════════════════════════════════════════════

import {
  suite, test, testAsync, assert, assertEqual, summary,
  waitForServer, chatWithTimeout, hasKeywords,
} from './_helpers.js';
import {
  extractCodeBlocks, assignFilenames, mergeCodeBlocks,
  scoreCode, checkJsSyntax,
} from './_quality-evaluator.js';
import { loadState, saveState, isPhaseComplete, clearPhase } from './_e2e-state.js';

const SUITE_ID = 's1-minic3';
const PHASE_NUM = 3;
const TURN_TIMEOUT = 600_000;

const TURNS = [
  {
    prompt: 'Pokračujeme v MiniC3. Teď potřebuji hlavní chat pipeline. Vypiš `chat-handler.js` — funkce handleMessage(conversationId, userMessage): 1) uloží user zprávu do DB přes conversation model, 2) klasifikuje intent, 3) pokud je SEARCH nebo CODE, spustí příslušný tool přes tool-executor, 4) zavolá LLM s kontextem (historie + tool výsledek), 5) uloží assistant odpověď do DB, 6) vrátí response objekt.',
    expectedFiles: ['chat-handler.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['handleMessage', 'classify', 'execute', 'addMessage'], 3),
  },
  {
    prompt: 'V tom `chat-handler.js` — kontext pro LLM by měl obsahovat maximálně posledních 10 zpráv, ne celou historii. System prompt nastaví na: \'Jsi helpfulný asistent. Odpovídej stručně a přesně. Pokud nevíš, řekni to.\' A přidej ošetření chyby — pokud LLM selže, vrať fallback odpověď "Omlouvám se, nedokážu nyní odpovědět." Vypiš upravenou verzi celého `chat-handler.js`.',
    expectedFiles: ['chat-handler.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['10', 'system', 'Jsi helpfulný', 'fallback', 'Omlouvám'], 3),
  },
  {
    prompt: 'Vypiš `llm-client.js` — Ollama HTTP klient. Funkce chat(messages, options) → { response, model, duration }. POST na localhost:11434/api/chat. Streaming NDJSON parsing — čti řádek po řádku, concatenuj message.content. Poslední objekt má done:true. Defaultní model z config.',
    expectedFiles: ['llm-client.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['11434', '/api/chat', 'stream', 'done', 'NDJSON'], 3),
  },
  {
    prompt: 'Ten `llm-client.js` má problém se streaming parsováním. Response body je readable stream, ne string. Musíš ho číst přes reader/async iterator, splitovat po newline, a každý řádek parsovat jako JSON. Také ošetři případ kdy Ollama vrátí error JSON s "error" fieldem. Oprav celý `llm-client.js`.',
    expectedFiles: ['llm-client.js'],
    type: 'debugging',
    verify: (r) => hasKeywords(r.response, ['reader', 'split', 'newline', 'JSON.parse', 'error'], 3),
  },
  {
    prompt: 'Přidej do `llm-client.js` i non-streaming mode. Pokud options.stream === false, pošli request s stream:false a vrať přímo response.message.content. Také přidej timeout — pokud Ollama neodpoví do options.timeout (default 60s), abortni request a zkus fallback model. Vypiš celý `llm-client.js`.',
    expectedFiles: ['llm-client.js'],
    type: 'feature-change',
    verify: (r) => hasKeywords(r.response, ['stream', 'false', 'AbortController', 'timeout', 'fallback'], 3),
  },
  {
    prompt: 'Vypiš `routes/chat.js` — Express router: POST /api/chat (tělo: { conversation_id, message }), GET /api/conversations (list s pagination), GET /api/conversations/:id (detail s messages), DELETE /api/conversations/:id. Každý endpoint v try/catch s 500 error response.',
    expectedFiles: ['routes/chat.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['router', 'POST', 'GET', 'DELETE', '/api/chat', '/api/conversations'], 4),
  },
  {
    prompt: 'V `routes/chat.js` POST /api/chat — co když klient pošle request bez conversation_id? Měla by se automaticky vytvořit nová konverzace s title z prvních 50 znaků zprávy. Pokud zpráva je prázdná nebo jen whitespace, vrať 400. Vypiš opravenou `routes/chat.js`.',
    expectedFiles: ['routes/chat.js'],
    type: 'correction',
    verify: (r) => hasKeywords(r.response, ['conversation_id', 'create', 'title', 'substring', '400', 'prázdná'], 3),
  },
  {
    prompt: 'Vypiš `server.js` — Express app init: json middleware (limit 1MB), cors, mount routes z routes/chat.js na /api, error handler middleware (loguj do konzole, vrať { error: message }), port z process.env.PORT (default 3000), graceful shutdown (SIGTERM/SIGINT zavře DB).',
    expectedFiles: ['server.js'],
    type: 'implementation',
    verify: (r) => hasKeywords(r.response, ['express', 'json', 'cors', 'PORT', 'SIGTERM', 'graceful'], 3),
  },
  {
    prompt: 'Přidej WebSocket — vypiš `ws-server.js`: inicializace WS serveru připojeného na HTTP server, při připojení klienta loguj, broadcast funkce. Eventy: \'tool_started\' (toolName, params), \'tool_completed\' (toolName, success, duration), \'llm_token\' (token string pro streaming). Export setupWebSocket(httpServer).',
    expectedFiles: ['ws-server.js'],
    type: 'late-addition',
    verify: (r) => hasKeywords(r.response, ['WebSocket', 'tool_started', 'tool_completed', 'broadcast', 'setupWebSocket'], 3),
  },
  {
    prompt: 'Vypiš kompletní finální verzi `chat-handler.js` se vším co jsme probírali — intent klasifikace → tool execution s WS notifikací → LLM call se streaming → response → DB uložení. Žádné TODO, žádné placeholder komentáře, kompletní funkční kód.',
    expectedFiles: ['chat-handler.js'],
    type: 'final',
    verify: (r) => {
      const kws = ['classify', 'execute', 'broadcast', 'chat', 'addMessage', 'handleMessage'];
      return hasKeywords(r.response, kws, 4) && !(/TODO|FIXME|placeholder/i.test(r.response));
    },
  },
];

suite('S1-MiniC3-P3: Chat Pipeline + LLM');

await testAsync('Phase 3: 10-turn pipeline implementation', async () => {
  if (isPhaseComplete(SUITE_ID, PHASE_NUM)) {
    console.log('  Phase 3 already completed, skipping.');
    return;
  }

  const rawState = loadState(SUITE_ID);
  if (!rawState?.phases?.p2?.completed) {
    throw new Error('Phase 2 not completed — run 201-s1-minic3-p2.e2e.js first');
  }

  if (rawState?.phases?.[`p${PHASE_NUM}`] && !rawState.phases[`p${PHASE_NUM}`].completed) {
    console.log('  Cleaning partial phase 3 state...');
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
    minFiles: 7,
    mustHaveKeywords: ['handleMessage', 'classify', 'execute', 'chat', 'WebSocket', 'express', 'router'],
  });

  console.log(`\n  Results: ${passCount}/${TURNS.length} passed, code score ${codeScore}`);
  console.log(`  Files: ${allCodeBlocks.map(b => b.filename || 'unnamed').join(', ')}`);

  assert(passCount >= 6, `At least 6/10 turns should pass, got ${passCount}`);
  assert(codeScore >= 30, `Code score should be ≥30, got ${codeScore}`);

  state.phases.p3 = {
    completed: true,
    turnCount: TURNS.length,
    passCount,
    codeScore,
    results,
  };
  state.codeBlocks = allCodeBlocks;
  saveState(SUITE_ID, state);

});

await summary();
