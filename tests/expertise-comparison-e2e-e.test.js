// Expertise Comparison E2E Test — Group E: car_enthusiast, biker, political_analyst
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests 3 doménové expertises through the FULL pipeline
// using ChatController.handle() — NOT raw LLM calls.
//
// Run:
//   OLLAMA_URL=http://127.0.0.1:11434 node tests/expertise-comparison-e2e-e.test.js
// ═══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const CONVERSATIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1) CAR_ENTHUSIAST — výběr auta
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'car_enthusiast',
    title: 'Autíčkář — výběr ojetiny',
    turns: [
      'Ahoj, hledám ojeté auto do 300 000 Kč. Pomůžeš mi s výběrem?',
      'Chci něco spolehlivého pro rodinu — 2 děti, občas delší cesty.',
      'Co říkáš na Škodu Octavia III kombi? Ročníky kolem 2017-2019.',
      'Jaký motor doporučuješ — 1.6 TDI, 2.0 TDI, nebo benzín 1.4 TSI?',
      'Jaké jsou typické problémy u Octavie III? Na co si dát pozor?',
      'Co Toyota Corolla kombi jako alternativa? Srovnej s Octavií.',
      'A co Hyundai i30 kombi? Má 5letou záruku na ojetiny?',
      'Kde hledat — bazar, autobazar, nebo import z Německa?',
      'Jaké jsou typické podvody při nákupu ojetiny?',
      'Co ověřit při prohlídce auta? Check-list prosím.',
      'Má smysl platit si nezávislou prověrku před koupí?',
      'Jaké jsou provozní náklady — pojištění, servis, spotřeba?',
      'Díky! Shrň mi top 3 doporučení a proč.',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) BIKER — výběr motorky pro začátečníka
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'biker',
    title: 'Motorkář — první motorka',
    turns: [
      'Ahoj, chci si pořídit první motorku. Nemám žádné zkušenosti.',
      'Jaký řidičák potřebuji? A1 nebo A2?',
      'Rozpočet mám kolem 80 000 Kč na ojetinu. Co se dá sehnat?',
      'Co říkáš na Yamahu MT-07? Není moc silná pro začátečníka?',
      'Jaké jsou dobré motorky pro začátečníky s A2 oprávněním?',
      'Jaké ochranné vybavení musím mít? Co je povinné a co doporučené?',
      'Kolik stojí základní vybavení — helma, bunda, kalhoty, boty, rukavice?',
      'Jak vypadá první sezóna na motorce? Co bych měl cvičit?',
      'Jaká je údržba motorky? Co dělat sám, co nechat na servisu?',
      'Jak je to s pojištěním motorek? Co pokryje a za kolik?',
      'Jaké jsou nejčastější chyby začátečníků a jak se jim vyhnout?',
      'Co zimní uskladnění motorky? Jak ji připravit?',
      'Díky! Shrň mi nákupní plán — motorka, vybavení, pojištění, kurz.',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) POLITICAL_ANALYST — analýza situace
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'political_analyst',
    title: 'Politický analytik — české volby',
    turns: [
      'Ahoj, můžeš mi vysvětlit současnou politickou situaci v ČR?',
      'Jaké jsou hlavní politické strany a jejich pozice?',
      'Jak funguje český volební systém do Poslanecké sněmovny?',
      'Co je to koalice a jak se typicky formuje po volbách?',
      'Jaké jsou hlavní témata, která hýbou českou politikou?',
      'Jak se liší pozice stran v otázce Evropské unie?',
      'Jaký je vliv prezidenta na politický systém po přímé volbě?',
      'Jak funguje Senát a proč je důležitý?',
      'Jaká je role médií v české politice?',
      'Jak ovlivňují sociální sítě politické názory?',
      'Porovnej český politický systém s německým nebo slovenským.',
      'Jaké jsou hlavní výzvy pro českou demokracii?',
      'Díky! Shrň mi 3 klíčové věci, na které se soustředit při sledování politiky.',
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
console.log('  EXPERTISE COMPARISON E2E — Group E: car_enthusiast, biker, political_analyst');
console.log(`${'═'.repeat(78)}`);

let ollamaOk = false;
try { const r = await fetch(`${OLLAMA_URL}/api/tags`); ollamaOk = r.ok; } catch { /* */ }
if (!ollamaOk) { console.error('  ❌ Ollama nedostupná'); process.exit(1); }

let llmOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen2.5:32b', prompt: 'Say OK', stream: false, options: { num_predict: 5 } }),
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
console.log('  ANALÝZA VÝSLEDKŮ — Group E');
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
    car_enthusiast: /motor|spotřeb|převodovk|servis|ojetin|km|TDI|TSI|Octavi|Toyot|Hyundai|bazar|prohlídk/i,
    biker: /motorka|helma|ochran|vybaven|kubatur|A2|řidičák|sezón|jízd|údržb|pojištěn|začátečn/i,
    political_analyst: /stran[ay]|volb|koalic|sněmovn|senát|prezident|politick|demokraci|média|EU|systém/i,
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

  // Safety check (biker should mention safety)
  const safetyPattern = /bezpečnost|ochran|helma|vybavení|rizik|opatrn|pravidla silničního provozu/i;
  const expertSafety = expertOk.filter(r => safetyPattern.test(r.response || '')).length;
  const chatSafety = chatOk.filter(r => safetyPattern.test(r.response || '')).length;

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
  console.log(`  Bezpečnost zmíněna         │  ${String(chatSafety).padStart(3)} / ${chatOk.length}              │  ${String(expertSafety).padStart(3)} / ${expertOk.length}`);
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
console.log('  CELKOVÉ SHRNUTÍ — Group E');
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
