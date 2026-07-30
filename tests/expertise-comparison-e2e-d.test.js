import './helpers/isolated-test-db.js';

// Expertise Comparison E2E Test — Group D: ai_expert, developer, technician
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests 3 technické expertises through the FULL pipeline
// using ChatController.handle() — NOT raw LLM calls.
//
// Run:
//   OLLAMA_URL=http://127.0.0.1:11434 node tests/expertise-comparison-e2e-d.test.js
// ═══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const CONVERSATIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1) AI_EXPERT — umělá inteligence
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'ai_expert',
    title: 'AI Expert — implementace RAG systému',
    turns: [
      'Ahoj, chci implementovat RAG systém pro firemní dokumenty. Poradíš mi?',
      'Jaký je rozdíl mezi RAG a fine-tuning? Kdy použít co?',
      'Jaké embedding modely doporučuješ pro český text?',
      'Jak funguje vector database? Porovnej Pinecone, Weaviate a Chroma.',
      'Jaký chunk size a overlap strategy je nejlepší pro technickou dokumentaci?',
      'Jak řešit hallucination v RAG pipeline?',
      'Co je to reranking a proč je důležitý?',
      'Jaký LLM použít pro generativní část — GPT-4, Claude, nebo open-source?',
      'Jak evaluovat kvalitu RAG odpovědí? Jaké metriky?',
      'Jaké jsou typické problémy při produkčním nasazení RAG?',
      'Co je to hybrid search — sparse + dense retrieval?',
      'Navrhni mi architekturu celého systému — od ingestion po odpověď.',
      'Díky! Shrň klíčová rozhodnutí, která musím udělat.',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) DEVELOPER — vývoj softwaru
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'developer',
    title: 'Vývojář — REST API v Node.js',
    turns: [
      'Ahoj, potřebuji navrhnout REST API pro správu úkolů (todo app).',
      'Jakou strukturu endpointů bys doporučil? CRUD operace + filtrace.',
      'Jak řešit autentizaci — JWT tokeny nebo sessions?',
      'Napiš mi middleware pro JWT verifikaci v Express.js.',
      'Jak správně validovat vstupy? Jakou knihovnu použít?',
      'Jaký je best practice pro error handling v REST API?',
      'Jak řešit paginaci — offset vs cursor-based?',
      'Potřebuji rate limiting. Jak ho implementovat?',
      'Jak psát testy pro API endpointy? Jest + Supertest?',
      'Jak řešit CORS pro frontend na jiné doméně?',
      'Jaká je dobrá struktura projektu pro Express API?',
      'Napiš mi kompletní endpoint pro GET /tasks s filtrací a paginací.',
      'Díky! Co bych měl ještě přidat před nasazením do produkce?',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) TECHNICIAN — troubleshooting
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'technician',
    title: 'Technik — pomalý počítač',
    turns: [
      'Ahoj, můj počítač je v poslední době hrozně pomalý. Pomůžeš mi?',
      'Je to notebook, Windows 11, asi 3 roky starý, 8 GB RAM.',
      'Jaké diagnostické kroky bych měl udělat jako první?',
      'Task Manager ukazuje 95% využití disku. Co to znamená?',
      'Jak zjistím, jestli je problém v HDD nebo v software?',
      'Vyplatí se upgradovat na SSD? Jak těžké to je?',
      'Jaký SSD bys doporučil pro notebook? SATA nebo NVMe?',
      'Jak přemigrovat systém z HDD na SSD bez reinstalace?',
      'Ještě mám jen 8 GB RAM — má smysl přidat?',
      'Jaké jsou další tipy na zrychlení Windows 11?',
      'Po upgrade na SSD — co udělat jako první? Optimalizace?',
      'Shrň mi celý postup krok za krokem.',
      'Díky! Kolik to celé bude stát odhadem?',
    ],
  },
];

// ─── Infrastructure ──────────────────────────────────────────────────────────

let totalTurns = 0;
let passedTurns = 0;
let failedTurns = 0;
const allResults = [];

function printTurn(convLabel, turnNum, input, response, meta = {}) {
  totalTurns++;
  passedTurns++;
  const mode = meta.mode || '?';
  const dur = meta.duration || 0;
  console.log(`  [${convLabel}.${String(turnNum).padStart(2, '0')}] \x1b[36m(${mode})\x1b[0m \x1b[90m${dur}ms\x1b[0m`);
  console.log(`    → \x1b[33m${input}\x1b[0m`);
  console.log(`    ← \x1b[0m${response}\x1b[0m`);
  console.log('');
}

function failTurn(convLabel, turnNum, input, error) {
  totalTurns++;
  failedTurns++;
  console.log(`  [${convLabel}.${String(turnNum).padStart(2, '0')}] \x1b[31m❌ ${input.substring(0, 80)}\x1b[0m`);
  console.log(`    \x1b[31m${error}\x1b[0m\n`);
}

async function setupPipeline() {
  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);
  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');
  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });
  return ChatController;
}

console.log(`\n${'═'.repeat(78)}`);
console.log('  EXPERTISE COMPARISON E2E — Group D: ai_expert, developer, technician');
console.log(`${'═'.repeat(78)}`);

let ollamaOk = false;
try { const r = await fetch(`${OLLAMA_URL}/api/tags`); ollamaOk = r.ok; } catch { /* */ }
if (!ollamaOk) { console.error('  ❌ Ollama nedostupná'); process.exit(1); }

let llmOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3.5:27b', prompt: 'Say OK', stream: false, options: { num_predict: 5 } }),
  });
  llmOk = r.ok && (await r.json()).response?.length > 0;
} catch { /* */ }
if (!llmOk) { console.error('  ❌ LLM neodpovídá'); process.exit(1); }
console.log('  ✓ Ollama + LLM OK\n');

const _origLog = console.log;
const _origWarn = console.warn;
const _origInfo = console.info;
const suppressPatterns = /\[C3:|CRE Decision|HandleToolCall|ToolExecutor|WebSearch|SearchMetrics|HandleLocal|ConversationHandler|HandleAskUser|DB\]|ModeDetect|Gatekeeper|ExpertiseHandler|MergeEngine|Pipeline|synthesis|followup|CapabilityEnforcer|CONTINUATION/;
console.log = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origLog(...args); };
console.warn = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origWarn(...args); };
console.info = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origInfo(...args); };

const { expertiseRegistry } = await import('../src/expertises/expertise-layer.js');
const ChatController = await setupPipeline();

for (const conv of CONVERSATIONS) {
  const expert = expertiseRegistry.get(conv.expertiseId);
  if (!expert) { _origLog(`  ⚠️  "${conv.expertiseId}" not found`); continue; }

  const labelA = `${conv.expertiseId.toUpperCase()}-CHAT`;
  _origLog(`\n${'═'.repeat(78)}`);
  _origLog(`  ${labelA}: ${conv.title} — OBECNÝ CHAT (bez expertízy)`);
  _origLog(`${'═'.repeat(78)}\n`);
  const sessionA = `comp-${conv.expertiseId}-chat-${Date.now()}`;

  for (let i = 0; i < conv.turns.length; i++) {
    const msg = conv.turns[i];
    const t0 = Date.now();
    try {
      const result = await ChatController.handle({ message: msg, sessionId: sessionA });
      const dur = Date.now() - t0;
      if (!result.response) throw new Error('Prázdná odpověď');
      const resp = result.response;
      if (/LLM failed|fetch failed|circuit breaker|Chyba zpracování|nemohl zpracovat|Nepodařilo se zpracovat|toJSON is not a function/i.test(resp)) throw new Error(`Pipeline error: ${resp.substring(0, 200)}`);
      printTurn(labelA, i + 1, msg, resp, { mode: result.mode, duration: dur });
      allResults.push({ expertiseId: conv.expertiseId, variant: 'chat', turn: i + 1, input: msg, response: resp, wordCount: resp.split(/\s+/).filter(w => w.length > 0).length, durationMs: dur, mode: result.mode });
    } catch (err) {
      failTurn(labelA, i + 1, msg, err.message);
      allResults.push({ expertiseId: conv.expertiseId, variant: 'chat', turn: i + 1, input: msg, response: null, wordCount: 0, durationMs: Date.now() - t0, mode: 'error', error: err.message });
    }
  }
  ChatController.removeSession(sessionA);

  const labelB = `${conv.expertiseId.toUpperCase()}-EXPERT`;
  _origLog(`\n${'═'.repeat(78)}`);
  _origLog(`  ${labelB}: ${conv.title} — S EXPERTÍZOU (${expert.name})`);
  _origLog(`${'═'.repeat(78)}\n`);
  const sessionB = `comp-${conv.expertiseId}-expert-${Date.now()}`;
  const expertObj = { id: expert.id, name: expert.name, domain: expert.domain };

  for (let i = 0; i < conv.turns.length; i++) {
    const msg = conv.turns[i];
    const t0 = Date.now();
    try {
      const result = await ChatController.handle({ message: msg, sessionId: sessionB, expertise: expertObj });
      const dur = Date.now() - t0;
      if (!result.response) throw new Error('Prázdná odpověď');
      const resp = result.response;
      if (/LLM failed|fetch failed|circuit breaker|Chyba zpracování|nemohl zpracovat|Nepodařilo se zpracovat|toJSON is not a function/i.test(resp)) throw new Error(`Pipeline error: ${resp.substring(0, 200)}`);
      printTurn(labelB, i + 1, msg, resp, { mode: result.mode, duration: dur });
      allResults.push({ expertiseId: conv.expertiseId, variant: 'expert', turn: i + 1, input: msg, response: resp, wordCount: resp.split(/\s+/).filter(w => w.length > 0).length, durationMs: dur, mode: result.mode });
    } catch (err) {
      failTurn(labelB, i + 1, msg, err.message);
      allResults.push({ expertiseId: conv.expertiseId, variant: 'expert', turn: i + 1, input: msg, response: null, wordCount: 0, durationMs: Date.now() - t0, mode: 'error', error: err.message });
    }
  }
  ChatController.removeSession(sessionB);
}

console.log = _origLog;
console.warn = _origWarn;
console.info = _origInfo;

console.log(`\n${'═'.repeat(78)}`);
console.log('  ANALÝZA VÝSLEDKŮ — Group D');
console.log(`${'═'.repeat(78)}\n`);

for (const conv of CONVERSATIONS) {
  const chatTurns = allResults.filter(r => r.expertiseId === conv.expertiseId && r.variant === 'chat');
  const expertTurns = allResults.filter(r => r.expertiseId === conv.expertiseId && r.variant === 'expert');
  const chatOk = chatTurns.filter(r => r.mode !== 'error');
  const expertOk = expertTurns.filter(r => r.mode !== 'error');
  const chatWords = chatOk.reduce((s, r) => s + r.wordCount, 0);
  const expertWords = expertOk.reduce((s, r) => s + r.wordCount, 0);
  const chatAvgWords = chatOk.length ? Math.round(chatWords / chatOk.length) : 0;
  const expertAvgWords = expertOk.length ? Math.round(expertWords / expertOk.length) : 0;
  const chatAvgDur = chatOk.length ? Math.round(chatOk.reduce((s, r) => s + r.durationMs, 0) / chatOk.length) : 0;
  const expertAvgDur = expertOk.length ? Math.round(expertOk.reduce((s, r) => s + r.durationMs, 0) / expertOk.length) : 0;

  const chatModes = {};
  for (const r of chatOk) chatModes[r.mode] = (chatModes[r.mode] || 0) + 1;
  const expertModes = {};
  for (const r of expertOk) expertModes[r.mode] = (expertModes[r.mode] || 0) + 1;

  const czechMarkers = /[ěščřžýáíéůúťďň]|že |je |ale |nebo |který |jako |pro |při /i;
  const chatCzech = chatOk.filter(r => czechMarkers.test(r.response || '')).length;
  const expertCzech = expertOk.filter(r => czechMarkers.test(r.response || '')).length;

  const domainKeywords = {
    ai_expert: /RAG|embedding|vector|LLM|transformer|retrieval|chunk|rerank|hallucin|inference|fine-tun|model/i,
    developer: /endpoint|API|middleware|JWT|auth|validac|pagina|CORS|test|Express|route|REST/i,
    technician: /SSD|HDD|RAM|diagnos|upgrade|disk|Task Manager|Windows|notebook|install|migra/i,
  };
  const kw = domainKeywords[conv.expertiseId];
  const chatKw = chatOk.filter(r => kw && kw.test(r.response || '')).length;
  const expertKw = expertOk.filter(r => kw && kw.test(r.response || '')).length;

  const zombiePattern = /spouštím|vyhledávám|tool_call|```json\s*\{/i;
  const deflectionPattern = /bohužel nemám|nemohu poskytnout|nemám přístup|neumím/i;
  const chatZombie = chatOk.filter(r => zombiePattern.test(r.response || '')).length;
  const expertZombie = expertOk.filter(r => zombiePattern.test(r.response || '')).length;
  const chatDeflect = chatOk.filter(r => deflectionPattern.test(r.response || '')).length;
  const expertDeflect = expertOk.filter(r => deflectionPattern.test(r.response || '')).length;

  // Code block check (technical expertises should produce code)
  const codeBlockPattern = /```[\w]*\n/;
  const expertCode = expertOk.filter(r => codeBlockPattern.test(r.response || '')).length;
  const chatCode = chatOk.filter(r => codeBlockPattern.test(r.response || '')).length;

  console.log(`── ${conv.title} (${conv.expertiseId}) ${'─'.repeat(Math.max(1, 50 - conv.title.length))}`);
  console.log('');
  console.log('  Metrika                    │  Chat (bez expertízy)  │  S expertízou');
  console.log('  ───────────────────────────┼────────────────────────┼──────────────────────');
  console.log(`  Úspěšných turnů            │  ${String(chatOk.length).padStart(3)} / ${chatTurns.length}              │  ${String(expertOk.length).padStart(3)} / ${expertTurns.length}`);
  console.log(`  Celkový počet slov         │  ${String(chatWords).padStart(6)}                 │  ${String(expertWords).padStart(6)}`);
  console.log(`  Průměr slov/odpověď        │  ${String(chatAvgWords).padStart(6)}                 │  ${String(expertAvgWords).padStart(6)}`);
  console.log(`  Průměrná doba (ms)         │  ${String(chatAvgDur).padStart(6)}                 │  ${String(expertAvgDur).padStart(6)}`);
  console.log(`  Česky (počet)              │  ${String(chatCzech).padStart(3)} / ${chatOk.length}              │  ${String(expertCzech).padStart(3)} / ${expertOk.length}`);
  console.log(`  Doménová klíč. slova       │  ${String(chatKw).padStart(3)} / ${chatOk.length}              │  ${String(expertKw).padStart(3)} / ${expertOk.length}`);
  console.log(`  Bloky kódu                 │  ${String(chatCode).padStart(3)} / ${chatOk.length}              │  ${String(expertCode).padStart(3)} / ${expertOk.length}`);
  console.log(`  Zombie odpovědi            │  ${String(chatZombie).padStart(3)}                    │  ${String(expertZombie).padStart(3)}`);
  console.log(`  Deflection odpovědi        │  ${String(chatDeflect).padStart(3)}                    │  ${String(expertDeflect).padStart(3)}`);
  console.log(`  Mode distribuce            │  ${JSON.stringify(chatModes).padEnd(22)} │  ${JSON.stringify(expertModes)}`);
  console.log('');

  console.log('  Per-turn srovnání (slova):');
  console.log('  Turn │  Chat  │ Expert │ Rozdíl │ Vítěz');
  console.log('  ─────┼────────┼────────┼────────┼──────');
  let chatWins = 0, expertWins = 0;
  for (let i = 0; i < conv.turns.length; i++) {
    const c = chatTurns[i]; const e = expertTurns[i];
    const cw = c?.wordCount || 0; const ew = e?.wordCount || 0;
    const diff = ew - cw;
    const winner = cw === 0 && ew === 0 ? '—' : diff > 0 ? 'EXPERT' : diff < 0 ? 'CHAT' : 'TIE';
    if (winner === 'EXPERT') expertWins++;
    if (winner === 'CHAT') chatWins++;
    console.log(`  ${String(i + 1).padStart(4)} │ ${String(cw).padStart(6)} │ ${String(ew).padStart(6)} │ ${(diff >= 0 ? '+' : '') + String(diff).padStart(5)} │ ${winner}`);
  }
  console.log(`  ─────┼────────┼────────┼────────┼──────`);
  console.log(`  SKÓRE: Chat ${chatWins} × Expert ${expertWins}  (${conv.turns.length - chatWins - expertWins} tie)\n`);
}

const totalChat = allResults.filter(r => r.variant === 'chat');
const totalExpert = allResults.filter(r => r.variant === 'expert');
const totalChatOk = totalChat.filter(r => r.mode !== 'error');
const totalExpertOk = totalExpert.filter(r => r.mode !== 'error');

console.log(`${'═'.repeat(78)}`);
console.log('  CELKOVÉ SHRNUTÍ — Group D');
console.log(`${'═'.repeat(78)}\n`);
console.log(`  Celkem turnů:      ${totalTurns}`);
console.log(`  Úspěšných:         ${passedTurns}`);
console.log(`  Selhání:           ${failedTurns}`);
console.log('');
console.log(`  Chat   — úspěšných: ${totalChatOk.length}/${totalChat.length}, celkem slov: ${totalChatOk.reduce((s, r) => s + r.wordCount, 0)}, prům. slov: ${totalChatOk.length ? Math.round(totalChatOk.reduce((s, r) => s + r.wordCount, 0) / totalChatOk.length) : 0}`);
console.log(`  Expert — úspěšných: ${totalExpertOk.length}/${totalExpert.length}, celkem slov: ${totalExpertOk.reduce((s, r) => s + r.wordCount, 0)}, prům. slov: ${totalExpertOk.length ? Math.round(totalExpertOk.reduce((s, r) => s + r.wordCount, 0) / totalExpertOk.length) : 0}`);

console.log(`\n${'═'.repeat(78)}`);
console.log(`  TEST DOKONČEN — ${failedTurns === 0 ? '✓ PASS' : `${failedTurns} FAILURES`}`);
console.log(`${'═'.repeat(78)}\n`);

process.exit(failedTurns > 0 ? 1 : 0);
