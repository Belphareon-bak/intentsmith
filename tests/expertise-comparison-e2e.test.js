import './helpers/isolated-test-db.js';
import { installOllamaLoopbackFetchBoundary } from './helpers/ollama-loopback-fetch-boundary.js';
import { inspectChatJourneyResult } from './helpers/chat-journey-response.js';

installOllamaLoopbackFetchBoundary({ reportOnExit: true });

// Expertise Comparison E2E Test — 3 expertises × 2 conversations (chat vs expert)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests 3 expertises (writer, dnd_master, songwriter) through the FULL pipeline
// using ChatController.handle() — NOT raw LLM calls.
//
// For each expertise:
//   A) General chat (no expertise) — same prompts
//   B) With expertise active — same prompts
//
// 6 total conversations, each 12+ turns.
// Full output printed for manual comparison.
// Automated analysis at the end.
//
// Run:
//   OLLAMA_URL=http://127.0.0.1:11434 node tests/expertise-comparison-e2e.test.js
//
// Requires: Ollama running + server NOT needed (uses ChatController directly)
// ═══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// ─── Conversation definitions ────────────────────────────────────────────────

const CONVERSATIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1) WRITER — creative writing
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'writer',
    title: 'Spisovatel — tvůrčí psaní',
    turns: [
      'Ahoj, chci napsat krátkou fantasy povídku. Pomůžeš mi?',
      'Hlavní postava bude starý mág, který žije v opuštěné věži na okraji lesa.',
      'Jednoho dne najde v knihovně zapomenutou knihu se zvláštními symboly. Napiš úvodní scénu.',
      'Super, teď potřebuji vedlejší postavu — mladou zlodějku, která se pokouší do věže vloupat.',
      'Jak by mohl vypadat první dialog mezi mágem a zlodějkou?',
      'Symboly v knize začnou svítit, když je zlodějka poblíž. Co by to mohlo znamenat?',
      'Napiš scénu, kde se rozhodnou vydat na cestu společně.',
      'Jaký by mohl být hlavní antagonista příběhu?',
      'Popiš prostředí temného lesa, kterým procházejí.',
      'Co kdyby potkali mysteriózní postavu u opuštěného mlýna?',
      'Jak by měla povídka skončit? Navrhni dvě varianty.',
      'Vyber lepší variantu a napiš poslední odstavec povídky.',
      'Díky! Ještě shrň celý příběh do 3 vět.',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) DND MASTER — tabletop RPG
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'dnd_master',
    title: 'DnD Master — tvorba kampaně',
    turns: [
      'Ahoj, chci vytvořit novou DnD kampaň pro 4 hráče. Pomůžeš mi?',
      'Téma bude námořní dobrodružství — piráti, ostrovy, mořské příšery.',
      'Vytvoř hlavní quest — hráči musí najít bájný poklad na Prokletém ostrově.',
      'Napiš popis přístavu, kde kampaň začíná. Jaké tam jsou obchody a NPC?',
      'Vytvoř zajímavého NPC kapitána lodi, která hráče poveze.',
      'Jaké náhodné encountery můžou potkat na moři? Navrhni 3.',
      'Prokletý ostrov — jak vypadá? Jaké jsou jeho zóny a nebezpečí?',
      'Vytvoř finálního bosse — guardiana pokladu. Jaké má schopnosti?',
      'Co je ten poklad? Navrhni 3 magické předměty jako odměnu.',
      'Hráči mají postavu paladina level 5 — jaký mu doporučíš equipment pro tento quest?',
      'Napiš box text pro první sezení — příjezd do přístavu.',
      'Jak by kampaň pokračovala po nalezení pokladu? Navrhni sequel hook.',
      'Díky! Shrň kampaň do přehledného one-pageru.',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) SONGWRITER — lyrics and music
  // ═══════════════════════════════════════════════════════════════════════════
  {
    expertiseId: 'songwriter',
    title: 'Textař — tvorba textu písně',
    turns: [
      'Ahoj, chci napsat text české popové písně o létě a lásce.',
      'Jaká by měla být struktura? Verse, chorus, bridge?',
      'Napiš první sloku — atmosféra teplé letní noci u moře.',
      'Teď refrén — chytlavý, s opakujícím se motivem.',
      'Napiš druhou sloku — ráno po noci, vzpomínky.',
      'A co bridge? Měl by být kontrastní k zytku.',
      'Uprav refrén tak, aby se lépe zpíval — kratší fráze.',
      'Jaký hudební styl bys doporučil? Pop, indie, folk?',
      'Změň téma — místo léta piš o podzimu a loučení. Přepiš první sloku.',
      'Přepiš refrén pro podzimní verzi.',
      'Přidej třetí sloku — naděje na jaro, nový začátek.',
      'Napiš finální verzi celého textu včetně značek (verse, chorus, bridge).',
      'Díky! Vymysli 3 návrhy na název písně.',
    ],
  },
];

// ─── Infrastructure ──────────────────────────────────────────────────────────

let totalTurns = 0;
let passedTurns = 0;
let failedTurns = 0;
let expectedAuthorityTerminals = 0;
const allResults = []; // { expertiseId, variant, turn, input, response, wordCount, durationMs, mode }

function inspectComparisonTurn({ convLabel, expertiseId, variant, turn, input, result, durationMs }) {
  const outcome = inspectChatJourneyResult(input, result);
  if (outcome.kind === 'answer') return outcome.response;

  totalTurns++;
  passedTurns++;
  expectedAuthorityTerminals++;
  console.log(`  [${convLabel}.${String(turn).padStart(2, '0')}] \x1b[36m(expected authority terminal)\x1b[0m \x1b[90m${durationMs}ms\x1b[0m`);
  console.log(`    → \x1b[33m${input}\x1b[0m`);
  console.log(`    ← \x1b[0m${outcome.errorCode}: fallback suppressed\x1b[0m\n`);
  allResults.push({
    expertiseId,
    variant,
    turn,
    input,
    response: null,
    wordCount: 0,
    durationMs,
    mode: 'expected_authority_terminal',
    errorCode: outcome.errorCode,
  });
  return null;
}

function formatResponse(text, maxLen = 500) {
  if (!text) return '(prázdná odpověď)';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

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
console.log('  EXPERTISE COMPARISON E2E — 3 expertises × 2 conversations (chat vs expert)');
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

  // ═══════════════════════════════════════════════════════════════════════════
  // A) General chat (no expertise)
  // ═══════════════════════════════════════════════════════════════════════════
  const labelA = `${conv.expertiseId.toUpperCase()}-CHAT`;
  _origLog(`\n${'═'.repeat(78)}`);
  _origLog(`  ${labelA}: ${conv.title} — OBECNÝ CHAT (bez expertízy)`);
  _origLog(`${'═'.repeat(78)}\n`);

  const sessionA = `comp-${conv.expertiseId}-chat-${Date.now()}`;

  for (let i = 0; i < conv.turns.length; i++) {
    const msg = conv.turns[i];
    const t0 = Date.now();
    try {
      const result = await ChatController.handle({
        message: msg,
        sessionId: sessionA,
        authenticatedSubject: { actorType: 'user', actorId: 'm6-model-journey' },
      });
      const dur = Date.now() - t0;
      const resp = inspectComparisonTurn({ convLabel: labelA, expertiseId: conv.expertiseId, variant: 'chat', turn: i + 1, input: msg, result, durationMs: dur });
      if (resp === null) continue;
      printTurn(labelA, i + 1, msg, resp, {
        mode: result.mode,
        duration: dur,
      });
      allResults.push({
        expertiseId: conv.expertiseId,
        variant: 'chat',
        turn: i + 1,
        input: msg,
        response: resp,
        wordCount: resp.split(/\s+/).filter(w => w.length > 0).length,
        durationMs: dur,
        mode: result.mode,
      });
    } catch (err) {
      failTurn(labelA, i + 1, msg, err.message);
      allResults.push({
        expertiseId: conv.expertiseId,
        variant: 'chat',
        turn: i + 1,
        input: msg,
        response: null,
        wordCount: 0,
        durationMs: Date.now() - t0,
        mode: 'error',
        error: err.message,
      });
    }
  }
  ChatController.removeSession(sessionA);

  // ═══════════════════════════════════════════════════════════════════════════
  // B) With expertise active
  // ═══════════════════════════════════════════════════════════════════════════
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
      const result = await ChatController.handle({
        message: msg,
        sessionId: sessionB,
        expertise: expertObj,
        authenticatedSubject: { actorType: 'user', actorId: 'm6-model-journey' },
      });
      const dur = Date.now() - t0;
      const resp = inspectComparisonTurn({ convLabel: labelB, expertiseId: conv.expertiseId, variant: 'expert', turn: i + 1, input: msg, result, durationMs: dur });
      if (resp === null) continue;
      printTurn(labelB, i + 1, msg, resp, {
        mode: result.mode,
        duration: dur,
      });
      allResults.push({
        expertiseId: conv.expertiseId,
        variant: 'expert',
        turn: i + 1,
        input: msg,
        response: resp,
        wordCount: resp.split(/\s+/).filter(w => w.length > 0).length,
        durationMs: dur,
        mode: result.mode,
      });
    } catch (err) {
      failTurn(labelB, i + 1, msg, err.message);
      allResults.push({
        expertiseId: conv.expertiseId,
        variant: 'expert',
        turn: i + 1,
        input: msg,
        response: null,
        wordCount: 0,
        durationMs: Date.now() - t0,
        mode: 'error',
        error: err.message,
      });
    }
  }
  ChatController.removeSession(sessionB);
}

// ─── Analysis ────────────────────────────────────────────────────────────────

// Restore console
console.log = _origLog;
console.warn = _origWarn;
console.info = _origInfo;

console.log(`\n${'═'.repeat(78)}`);
console.log('  ANALÝZA VÝSLEDKŮ');
console.log(`${'═'.repeat(78)}\n`);

// Per-expertise comparison
for (const conv of CONVERSATIONS) {
  const chatTurns = allResults.filter(r => r.expertiseId === conv.expertiseId && r.variant === 'chat');
  const expertTurns = allResults.filter(r => r.expertiseId === conv.expertiseId && r.variant === 'expert');

  const chatOk = chatTurns.filter(r => r.mode !== 'error' && r.mode !== 'expected_authority_terminal');
  const expertOk = expertTurns.filter(r => r.mode !== 'error' && r.mode !== 'expected_authority_terminal');

  const chatWords = chatOk.reduce((s, r) => s + r.wordCount, 0);
  const expertWords = expertOk.reduce((s, r) => s + r.wordCount, 0);
  const chatAvgWords = chatOk.length ? Math.round(chatWords / chatOk.length) : 0;
  const expertAvgWords = expertOk.length ? Math.round(expertWords / expertOk.length) : 0;

  const chatAvgDur = chatOk.length ? Math.round(chatOk.reduce((s, r) => s + r.durationMs, 0) / chatOk.length) : 0;
  const expertAvgDur = expertOk.length ? Math.round(expertOk.reduce((s, r) => s + r.durationMs, 0) / expertOk.length) : 0;

  // Mode distribution
  const chatModes = {};
  for (const r of chatOk) chatModes[r.mode] = (chatModes[r.mode] || 0) + 1;
  const expertModes = {};
  for (const r of expertOk) expertModes[r.mode] = (expertModes[r.mode] || 0) + 1;

  // Czech language check
  const czechMarkers = /[ěščřžýáíéůúťďň]|že |je |ale |nebo |který |jako |pro |při /i;
  const chatCzech = chatOk.filter(r => czechMarkers.test(r.response || '')).length;
  const expertCzech = expertOk.filter(r => czechMarkers.test(r.response || '')).length;

  // Domain-specific keyword check
  const domainKeywords = {
    writer: /příběh|povídka|postav|kapitol|scén|dialog|narativ|atmosfér|mág|věž|kniha|forest|les/i,
    dnd_master: /quest|encounter|NPC|kampaň|level|boss|poklad|loot|session|sezení|hráč|DnD|D&D|dungeon|ostrov/i,
    songwriter: /sloka|refrén|bridge|chorus|verse|text|píseň|melodie|rytmus|rým|zpív/i,
  };
  const kw = domainKeywords[conv.expertiseId];
  const chatKw = chatOk.filter(r => kw && kw.test(r.response || '')).length;
  const expertKw = expertOk.filter(r => kw && kw.test(r.response || '')).length;

  // Zombie/deflection check
  const zombiePattern = /spouštím|vyhledávám|tool_call|```json\s*\{/i;
  const deflectionPattern = /bohužel nemám|nemohu poskytnout|nemám přístup|neumím/i;
  const chatZombie = chatOk.filter(r => zombiePattern.test(r.response || '')).length;
  const expertZombie = expertOk.filter(r => zombiePattern.test(r.response || '')).length;
  const chatDeflect = chatOk.filter(r => deflectionPattern.test(r.response || '')).length;
  const expertDeflect = expertOk.filter(r => deflectionPattern.test(r.response || '')).length;

  console.log(`── ${conv.title} (${conv.expertiseId}) ${'─'.repeat(50 - conv.title.length)}`);
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

  // Per-turn word count comparison
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
    const winner = cw === 0 && ew === 0 ? '—' :
                   diff > 0 ? 'EXPERT' :
                   diff < 0 ? 'CHAT' : 'TIE';
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
const totalChatOk = totalChat.filter(r => r.mode !== 'error' && r.mode !== 'expected_authority_terminal');
const totalExpertOk = totalExpert.filter(r => r.mode !== 'error' && r.mode !== 'expected_authority_terminal');

console.log(`${'═'.repeat(78)}`);
console.log('  CELKOVÉ SHRNUTÍ');
console.log(`${'═'.repeat(78)}\n`);
console.log(`  Celkem turnů:      ${totalTurns}`);
console.log(`  Úspěšných:         ${passedTurns}`);
console.log(`  Selhání:           ${failedTurns}`);
console.log(`  Authority terminaly:${String(expectedAuthorityTerminals).padStart(7)}`);
console.log('');
console.log(`  Chat   — úspěšných: ${totalChatOk.length}/${totalChat.length}, celkem slov: ${totalChatOk.reduce((s, r) => s + r.wordCount, 0)}, prům. slov: ${totalChatOk.length ? Math.round(totalChatOk.reduce((s, r) => s + r.wordCount, 0) / totalChatOk.length) : 0}`);
console.log(`  Expert — úspěšných: ${totalExpertOk.length}/${totalExpert.length}, celkem slov: ${totalExpertOk.reduce((s, r) => s + r.wordCount, 0)}, prům. slov: ${totalExpertOk.length ? Math.round(totalExpertOk.reduce((s, r) => s + r.wordCount, 0) / totalExpertOk.length) : 0}`);

const chatModesTotal = {};
for (const r of totalChatOk) chatModesTotal[r.mode] = (chatModesTotal[r.mode] || 0) + 1;
const expertModesTotal = {};
for (const r of totalExpertOk) expertModesTotal[r.mode] = (expertModesTotal[r.mode] || 0) + 1;
console.log(`  Chat modes:   ${JSON.stringify(chatModesTotal)}`);
console.log(`  Expert modes: ${JSON.stringify(expertModesTotal)}`);

console.log(`\n${'═'.repeat(78)}`);
console.log(`  TEST DOKONČEN — ${failedTurns === 0 ? '✓ PASS' : `${failedTurns} FAILURES`}`);
console.log(`${'═'.repeat(78)}\n`);

process.exit(failedTurns > 0 ? 1 : 0);
