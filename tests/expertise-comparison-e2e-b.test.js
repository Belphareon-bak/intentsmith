import './helpers/isolated-test-db.js';
import { installOllamaLoopbackFetchBoundary } from './helpers/ollama-loopback-fetch-boundary.js';

installOllamaLoopbackFetchBoundary({ reportOnExit: true });

// Expertise Comparison E2E Test — Group B: analyst, trader, accountant
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests 3 analytické expertises through the FULL pipeline
// using ChatController.handle() — NOT raw LLM calls.
//
// For each expertise:
//   A) General chat (no expertise) — same prompts
//   B) With expertise active — same prompts
//
// 6 total conversations, each 13 turns.
// Full output printed for manual comparison.
//
// Run:
//   OLLAMA_URL=http://127.0.0.1:11434 node tests/expertise-comparison-e2e-b.test.js
//
// Requires: Ollama running + server NOT needed (uses ChatController directly)
// ═══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// ─── Conversation definitions ────────────────────────────────────────────────

const CONVERSATIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1) ANALYST — srovnání a rozbory
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'analyst',
    title: 'Analytik — srovnání technologií',
    turns: [
      'Ahoj, potřebuji porovnat React, Vue a Svelte pro nový projekt.',
      'Jaké jsou hlavní výhody a nevýhody každého frameworku?',
      'Projekt bude e-shop s ~50 stránkami a dynamickým košíkem. Který se hodí nejlíp?',
      'Jaký je aktuální ekosystém knihoven pro každý framework?',
      'Porovnej výkon — bundle size, render speed, memory footprint.',
      'Jak vypadá hiring market? Kde najdu nejvíc vývojářů?',
      'Jaké jsou typické problémy při škálování u každého frameworku?',
      'Kdyby to byl startup s 3 vývojáři, co bys doporučil?',
      'A co kdyby to byla velká firma s 20 vývojáři?',
      'Udělej mi rozhodovací matici — kritéria vs frameworky, skóre 1-5.',
      'Jaké jsou trendy pro rok 2026? Který framework roste nejrychleji?',
      'Shrň to do executive summary pro management — 5 vět max.',
      'Díky! Jaký je tvůj finální verdikt s odůvodněním?',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) TRADER — nákup/prodej a trh
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'trader',
    title: 'Překupník — nákup grafické karty',
    turns: [
      'Ahoj, chci koupit grafickou kartu pro gaming. Jaký je teď trh?',
      'Rozpočet mám kolem 15 000 Kč. Co se dá sehnat?',
      'Má smysl čekat na novou generaci, nebo koupit teď?',
      'Co ojeté karty? Vyplatí se kupovat z bazaru?',
      'Jaké jsou typické podvody při prodeji GPU na bazaru?',
      'Porovnej RTX 4060 vs RX 7600 — cena/výkon, dostupnost v ČR.',
      'Kde se dá sehnat nejlevněji? CZC, Alza, nebo bazar?',
      'Kdyby mi někdo nabídl ojetou RTX 3070 za 6000 Kč, je to dobrý deal?',
      'Jaké jsou vedlejší náklady? PSU, chlazení, kompatibilita?',
      'Kdy je nejlepší čas na nákup hardware? Sezónnost, sales?',
      'Co kdyby se mi za rok nevyplatila a chtěl bych ji prodat?',
      'Shrň mi nákupní strategii do 5 bodů.',
      'Díky! Takže tvůj finální doporučení — co koupit a kde?',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) ACCOUNTANT — daně a finance
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'accountant',
    title: 'Účetní — OSVČ daňový přehled',
    turns: [
      'Ahoj, jsem OSVČ a potřebuji spočítat daně za rok 2025.',
      'Můj příjem za rok byl 1 200 000 Kč. Jaké mám možnosti uplatnění výdajů?',
      'Používám paušální výdaje 60%. Jaký bude základ daně?',
      'Kolik budu platit na sociálním a zdravotním pojištění?',
      'Mám slevu na poplatníka a dvě děti. Jaké další slevy můžu uplatnit?',
      'Jaký je celkový daňový odvod a kolik mi zůstane čistého?',
      'Vyplatilo by se mi přejít na s.r.o.? Jaké jsou výhody a nevýhody?',
      'Jaké jsou lhůty pro podání daňového přiznání v roce 2026?',
      'Co kdybych si pořídil auto na firmu? Jak se to promítne do daní?',
      'Mám příjem i ze zahraničí — 200 000 Kč z Německa. Jak se to daní?',
      'Jaké jsou nejčastější chyby OSVČ při podání přiznání?',
      'Udělej mi přehlednou tabulku — příjmy, výdaje, základ, daň, odvody, čistý příjem.',
      'Díky! Shrň klíčové body, na co si dát pozor.',
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

// ─── Pre-checks ──────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(78)}`);
console.log('  EXPERTISE COMPARISON E2E — Group B: analyst, trader, accountant');
console.log(`${'═'.repeat(78)}`);

let ollamaOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/tags`);
  ollamaOk = r.ok;
} catch { /* */ }
if (!ollamaOk) {
  console.error('  ❌ Ollama nedostupná');
  process.exit(1);
}

let llmOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3.5:27b',
      prompt: 'Reply with only OK.',
      stream: false,
      think: false,
      options: { num_predict: 8 },
    }),
  });
  llmOk = r.ok && (await r.json()).response?.length > 0;
} catch { /* */ }
if (!llmOk) {
  console.error('  ❌ Ollama běží, ale LLM model neodpovídá (GPU není ready?)');
  process.exit(1);
}
console.log('  ✓ Ollama + LLM OK\n');

// Suppress noisy pipeline logs
const _origLog = console.log;
const _origWarn = console.warn;
const _origInfo = console.info;
const suppressPatterns = /\[C3:|CRE Decision|HandleToolCall|ToolExecutor|WebSearch|SearchMetrics|HandleLocal|ConversationHandler|HandleAskUser|DB\]|ModeDetect|Gatekeeper|ExpertiseHandler|MergeEngine|Pipeline|synthesis|followup|CapabilityEnforcer|CONTINUATION/;
console.log = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origLog(...args); };
console.warn = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origWarn(...args); };
console.info = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origInfo(...args); };

// ─── Load expertise objects ──────────────────────────────────────────────────

const { expertiseRegistry } = await import('../src/expertises/expertise-layer.js');

const ChatController = await setupPipeline();

// ─── Run conversations ───────────────────────────────────────────────────────

for (const conv of CONVERSATIONS) {
  const expert = expertiseRegistry.get(conv.expertiseId);
  if (!expert) {
    _origLog(`  ⚠️  Expertise "${conv.expertiseId}" not found — skipping`);
    continue;
  }

  // A) General chat (no expertise)
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
      if (/LLM failed|fetch failed|circuit breaker|Chyba zpracování|nemohl zpracovat|Nepodařilo se zpracovat|toJSON is not a function/i.test(resp)) {
        throw new Error(`Pipeline error: ${resp.substring(0, 200)}`);
      }
      printTurn(labelA, i + 1, msg, resp, { mode: result.mode, duration: dur });
      allResults.push({ expertiseId: conv.expertiseId, variant: 'chat', turn: i + 1, input: msg, response: resp, wordCount: resp.split(/\s+/).filter(w => w.length > 0).length, durationMs: dur, mode: result.mode });
    } catch (err) {
      failTurn(labelA, i + 1, msg, err.message);
      allResults.push({ expertiseId: conv.expertiseId, variant: 'chat', turn: i + 1, input: msg, response: null, wordCount: 0, durationMs: Date.now() - t0, mode: 'error', error: err.message });
    }
  }
  ChatController.removeSession(sessionA);

  // B) With expertise active
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
      if (/LLM failed|fetch failed|circuit breaker|Chyba zpracování|nemohl zpracovat|Nepodařilo se zpracovat|toJSON is not a function/i.test(resp)) {
        throw new Error(`Pipeline error: ${resp.substring(0, 200)}`);
      }
      printTurn(labelB, i + 1, msg, resp, { mode: result.mode, duration: dur });
      allResults.push({ expertiseId: conv.expertiseId, variant: 'expert', turn: i + 1, input: msg, response: resp, wordCount: resp.split(/\s+/).filter(w => w.length > 0).length, durationMs: dur, mode: result.mode });
    } catch (err) {
      failTurn(labelB, i + 1, msg, err.message);
      allResults.push({ expertiseId: conv.expertiseId, variant: 'expert', turn: i + 1, input: msg, response: null, wordCount: 0, durationMs: Date.now() - t0, mode: 'error', error: err.message });
    }
  }
  ChatController.removeSession(sessionB);
}

// ─── Analysis ────────────────────────────────────────────────────────────────

console.log = _origLog;
console.warn = _origWarn;
console.info = _origInfo;

console.log(`\n${'═'.repeat(78)}`);
console.log('  ANALÝZA VÝSLEDKŮ — Group B');
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
    analyst: /srovnán|analýz|výhod|nevýhod|kritéri|skóre|metrik|doporučen|framework|ekosystém|výkon|trend/i,
    trader: /cen[aouy]|trh|bazar|deal|nákup|prodej|sezón|marže|vedlejší náklad|strategi|retail/i,
    accountant: /daň|OSVČ|základ|slev|pojištěn|odvod|paušál|příjem|výdaj|přiznán|lhůt|DPH|Kč/i,
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
  console.log(`  Zombie odpovědi            │  ${String(chatZombie).padStart(3)}                    │  ${String(expertZombie).padStart(3)}`);
  console.log(`  Deflection odpovědi        │  ${String(chatDeflect).padStart(3)}                    │  ${String(expertDeflect).padStart(3)}`);
  console.log(`  Mode distribuce            │  ${JSON.stringify(chatModes).padEnd(22)} │  ${JSON.stringify(expertModes)}`);
  console.log('');

  console.log('  Per-turn srovnání (slova):');
  console.log('  Turn │  Chat  │ Expert │ Rozdíl │ Vítěz');
  console.log('  ─────┼────────┼────────┼────────┼──────');
  let chatWins = 0, expertWins = 0;
  for (let i = 0; i < conv.turns.length; i++) {
    const c = chatTurns[i];
    const e = expertTurns[i];
    const cw = c?.wordCount || 0;
    const ew = e?.wordCount || 0;
    const diff = ew - cw;
    const winner = cw === 0 && ew === 0 ? '—' : diff > 0 ? 'EXPERT' : diff < 0 ? 'CHAT' : 'TIE';
    if (winner === 'EXPERT') expertWins++;
    if (winner === 'CHAT') chatWins++;
    console.log(`  ${String(i + 1).padStart(4)} │ ${String(cw).padStart(6)} │ ${String(ew).padStart(6)} │ ${(diff >= 0 ? '+' : '') + String(diff).padStart(5)} │ ${winner}`);
  }
  console.log(`  ─────┼────────┼────────┼────────┼──────`);
  console.log(`  SKÓRE: Chat ${chatWins} × Expert ${expertWins}  (${conv.turns.length - chatWins - expertWins} tie)\n`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

const totalChat = allResults.filter(r => r.variant === 'chat');
const totalExpert = allResults.filter(r => r.variant === 'expert');
const totalChatOk = totalChat.filter(r => r.mode !== 'error');
const totalExpertOk = totalExpert.filter(r => r.mode !== 'error');

console.log(`${'═'.repeat(78)}`);
console.log('  CELKOVÉ SHRNUTÍ — Group B');
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
