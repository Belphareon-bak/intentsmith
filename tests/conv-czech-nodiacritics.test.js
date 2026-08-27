import './helpers/isolated-test-db.js';
import { installOllamaLoopbackFetchBoundary } from './helpers/ollama-loopback-fetch-boundary.js';

installOllamaLoopbackFetchBoundary({ reportOnExit: true });

// C3-Agent v58.3 — Czech No-Diacritics Deep Conversation Tests (5 × 10 steps)
// ══════════════════════════════════════════════════════════════════════════════
//
// 5 deep multi-turn Czech conversations WITHOUT diacritics (háčky/čárky).
// Focus: context continuity, follow-ups, depth of explanation, consistency.
// Minimizes trivial questions (time, date, math) in favor of sustained topics.
//
// Run: OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

let totalSteps = 0;
let passedSteps = 0;
let failedSteps = 0;
const failures = [];

function printStep(convNum, step, input, response, meta = {}) {
  totalSteps++;
  const mode = meta.mode || '?';
  const model = meta.model || 'local';
  const dur = meta.duration || 0;
  console.log(`  [${convNum}.${String(step).padStart(2, '0')}] \x1b[36m(${mode})\x1b[0m \x1b[90m${input}\x1b[0m`);
  console.log(`         \x1b[33m${response}\x1b[0m`);
  if (model !== 'local') console.log(`         \x1b[90m[${model} ${dur}ms]\x1b[0m`);
  passedSteps++;
}

function failStep(convNum, step, input, error) {
  totalSteps++;
  failedSteps++;
  console.log(`  [${convNum}.${String(step).padStart(2, '0')}] \x1b[31m❌ ${input.substring(0, 60)}\x1b[0m`);
  console.log(`         \x1b[31m${error}\x1b[0m`);
  failures.push({ conv: convNum, step, input, error });
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

async function runConversation(ChatController, convNum, title, messages) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Konverzace ${convNum}: ${title}`);
  console.log(`${'═'.repeat(70)}`);

  const sessionId = `conv-nd-${convNum}-${Date.now()}`;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    try {
      const result = await ChatController.handle({ message: msg, sessionId });
      if (!result.response) throw new Error('Prazdna odpoved');
      // Detect graceful error messages that mask real failures
      const resp = result.response;
      if (/LLM failed|fetch failed|circuit breaker|Chyba zpracování|nemohl zpracovat|Nepodařilo se zpracovat|No search results|toJSON is not a function/i.test(resp)) {
        throw new Error(`Pipeline error: ${resp.substring(0, 150)}`);
      }
      printStep(convNum, i + 1, msg, resp, {
        mode: result.mode,
        model: result.metadata?.model,
        duration: result.metadata?.duration,
      });
    } catch (err) {
      failStep(convNum, i + 1, msg, err.message);
    }
  }

  ChatController.removeSession(sessionId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-check
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(70)}`);
console.log('  CESKE KONVERZACNI TESTY BEZ DIAKRITIKY – HLUBKOVE SCENARE (5 × 10)');
console.log(`${'═'.repeat(70)}`);

let ollamaOk = false;
try { const r = await fetch(`${OLLAMA_URL}/api/tags`); ollamaOk = r.ok; } catch { /* */ }
if (!ollamaOk) { console.error('Ollama nedostupna (HTTP check failed)'); process.exit(1); }

// Real LLM check — generate a single token to verify GPU/model is loaded
let llmOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3.5:27b', prompt: 'Say OK', stream: false, options: { num_predict: 5 } }),
  });
  llmOk = r.ok && (await r.json()).response?.length > 0;
} catch { /* */ }
if (!llmOk) { console.error('Ollama bezi, ale LLM model neodpovida (GPU neni ready?)'); process.exit(1); }
console.log('  Ollama + LLM OK\n');

const _origLog = console.log;
const _origInfo = console.info;
const suppressPatterns = /\[C3:|CRE Decision|HandleToolCall|ToolExecutor|WebSearch|SearchMetrics|HandleLocal|ConversationHandler|HandleAskUser|DB\]/;
console.log = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origLog(...args); };
console.info = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origInfo(...args); };

const ChatController = await setupPipeline();

// ═══════════════════════════════════════════════════════════════════════════════
// 5 hlubkovych konverzaci (10 kroku kazda)
// ═══════════════════════════════════════════════════════════════════════════════

await runConversation(ChatController, 1, 'AI a spolecnost (hloubkovy kontext)', [
  'Ahoj, rad bych se bavil o umele inteligenci v beznem zivote.',
  'Jak dnes AI realne pomaha lidem, ne teoreticky?',
  'Kde jsou podle tebe nejvetsi limity soucasne AI?',
  'Jaky dopad muze mit AI na pracovni trh v CR?',
  'Ktera povolani budou ovlivnena driv a proc?',
  'Myslis, ze by stat mel regulovat pouziti AI? Proc ano/ne.',
  'Jak by mela vypadat rozumna regulace, aby nezabila inovace?',
  'Co bys doporucil jednotlivci, ktery se nechce stat "zbytecnym"?',
  'Jakou roli v tom hraje vzdelavani?',
  'Shrni hlavni rizika a prilezitosti AI pro bezneho cloveka.',
]);

await runConversation(ChatController, 2, 'Programovani – od konceptu k praxi', [
  'Chci se naucit programovat systematicky, ne nahodne.',
  'Jak bys vysvetlil rozdil mezi programovanim a softwarovym inzenyrstvim?',
  'Proc je dulezite rozumet algoritmum a datovym strukturam?',
  'Vysvetli Big O notaci na jednoduchem, realnem prikladu.',
  'Jak se to projevi v praxi u bezne webove aplikace?',
  'Kdy ma smysl optimalizovat kod a kdy je to zbytecne?',
  'Jak by mel vypadat prvni mensi projekt pro juniora?',
  'Jake chyby zacatecnici delaji nejcasteji?',
  'Jak poznat, ze se jako programator realne zlepsuju?',
  'Shrni, co je nejdulezitejsi pro dlouhodoby rust.',
]);

await runConversation(ChatController, 3, 'Zdravi, pohyb a dlouhodoba udrzitelnost', [
  'Chci zacit cvicit, ale dlouhodobe, ne jen na mesic.',
  'Proc vetsina lidi se cvicenim prestane?',
  'Jaky je rozdil mezi motivaci a disciplinou?',
  'Jak by mel vypadat realisticky plan pro uplneho zacatecnika?',
  'Jakou roli hraje regenerace a spanek?',
  'Je lepsi zacit silou nebo kondici? Proc?',
  'Jak poznat, ze uz trenink skodi misto pomaha?',
  'Jake jsou nejcastejsi chyby pri cviceni doma?',
  'Jak si udrzet konzistenci i pri stresu a praci?',
  'Shrni zakladni principy dlouhodobeho zdraveho pohybu.',
]);

await runConversation(ChatController, 4, 'Historie jako zdroj porozumeni', [
  'Zajima me, proc je dulezite ucit se historii.',
  'Jak muze historie pomoct pri rozhodovani dnes?',
  'Uved konkretni priklad z ceskych dejin.',
  'Jak se historicke udalosti casto zkresluji?',
  'Proc maji ruzne generace odlisny pohled na stejnou udalost?',
  'Jaky vliv ma propaganda na vyklad historie?',
  'Jak se da poznat kvalitni historicky zdroj?',
  'Proc se nektere chyby v dejinach opakuji?',
  'Co by se podle tebe melo ucit jinak nez dnes?',
  'Shrni hlavni lekce historie pro soucasnost.',
]);

await runConversation(ChatController, 5, 'Technologie a budoucnost (strategicky pohled)', [
  'Jak se bude podle tebe menit role cloveka v technologickem svete?',
  'Ktere technologie budou mit nejvetsi dopad na kazdodenni zivot?',
  'Proc nejsou technologicke zmeny rozlozene rovnomerne?',
  'Jaky vliv bude mit automatizace na male firmy?',
  'Co je vetsi riziko: pomaly pokrok nebo prilis rychly?',
  'Jak se mohou jednotlivci pripravit na nejistou budoucnost?',
  'Jakou roli v tom hraje kriticke mysleni?',
  'Jak se zmeni vzdelavani v pristich 10–20 letech?',
  'Co bys doporucil mladym lidem dnes?',
  'Strucne shrn hlavni trendy a dopady.',
]);

// ═══════════════════════════════════════════════════════════════════════════════

console.log = _origLog;
console.info = _origInfo;

console.log(`\n${'═'.repeat(70)}`);
console.log(`  VYSLEDKY: ${passedSteps} OK, ${failedSteps} FAIL, ${totalSteps} celkem`);
if (failures.length > 0) {
  console.log(`\n  CHYBY:`);
  for (const f of failures) {
    console.log(`    [${f.conv}.${f.step}] ${f.input}: ${f.error}`);
  }
}
console.log(`${'═'.repeat(70)}\n`);
process.exit(failedSteps > 0 ? 1 : 0);
