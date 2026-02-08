// C3-Agent v57.3 — Czech No-Diacritics Conversation Tests (10 × 15+ steps)
// ══════════════════════════════════════════════════════════════════════════════
//
// 10 multi-turn Czech conversations WITHOUT diacritics (háčky/čárky).
// Tests language detection robustness with "udelej", "cesky", "diky" etc.
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
  const short = response.length > 300 ? response.substring(0, 300) + '...' : response;
  console.log(`  [${convNum}.${String(step).padStart(2, '0')}] \x1b[36m(${mode})\x1b[0m \x1b[90m${input.substring(0, 60)}\x1b[0m`);
  console.log(`         \x1b[33m${short}\x1b[0m`);
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
      printStep(convNum, i + 1, msg, result.response, {
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
console.log('  CESKE KONVERZACNI TESTY BEZ DIAKRITIKY (10 × 15+ kroku)');
console.log(`${'═'.repeat(70)}`);

let ollamaOk = false;
try { const r = await fetch(`${OLLAMA_URL}/api/tags`); ollamaOk = r.ok; } catch { /* */ }
if (!ollamaOk) { console.error('Ollama nedostupna'); process.exit(1); }
console.log('  Ollama dostupna\n');

const _origLog = console.log;
const _origInfo = console.info;
const suppressPatterns = /\[C3:|CRE Decision|HandleToolCall|ToolExecutor|WebSearch|SearchMetrics|HandleLocal|ConversationHandler|HandleAskUser|DB\]/;
console.log = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origLog(...args); };
console.info = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origInfo(...args); };

const ChatController = await setupPipeline();

// ═══════════════════════════════════════════════════════════════════════════════
// 10 konverzaci
// ═══════════════════════════════════════════════════════════════════════════════

await runConversation(ChatController, 1, 'Bezny rozhovor + pocitani', [
  'Ahoj! Jak se mas?',
  'Co si myslis o umele inteligenci?',
  'Jaky je dnes den?',
  'Kolik je 347 * 12?',
  '99 + 1',
  'Kdy bude pristi uplnek?',
  'Kolik je hodin?',
  'Diky za informace. A co si myslis o budoucnosti AI?',
  '1024 / 16',
  'Jake je dnes datum?',
  'Co je to neuronova sit?',
  'Kolik dni do Vanoc?',
  '55 * 55',
  'A co si myslis o kvantovych pocitacich?',
  'Diky, to je zajimave!',
]);

await runConversation(ChatController, 2, 'Programovani a kod', [
  'Ahoj, potrebuji pomoc s programovanim.',
  'Co si myslis o Pythonu jako prvnim jazyku?',
  'Napis mi funkci pro vypocet faktorialu v Pythonu.',
  'A co rekurzivni verze?',
  'Kolik je 10 * 9 * 8?',
  'Jaky je rozdil mezi seznamem a n-tici v Pythonu?',
  'Vymysli mi nazev pro knihovnu na zpracovani dat.',
  'Napis mi jednoduchy HTTP server v Node.js.',
  '2 * 512',
  'Co je to REST API?',
  'Jak bys porovnal TypeScript a JavaScript?',
  'Napis mi regex pro validaci emailu.',
  'Co je to Big O notace?',
  '1000 - 777',
  'Diky za vsechno!',
]);

await runConversation(ChatController, 3, 'Cestovani a mesta', [
  'Ahoj! Rad bych se dozvedel neco o cestovani.',
  'Jake je hlavni mesto Italie?',
  'Co bys doporucil navstivit v Rime?',
  'Kolik je hodin?',
  'Jaky je dnes den?',
  '500 * 3',
  'A co Japonsko? Stoji za navstevu?',
  'Jake je hlavni mesto Japonska?',
  'Vymysli mi plan na 3 dny v Praze.',
  'Kolik je 120 * 24?',
  'Co si myslis o cestovani vlakem?',
  'Kdy bude pristi uplnek?',
  'Jake jsou nejhezci ceske hrady?',
  '250 + 750',
  'Diky za tipy!',
]);

await runConversation(ChatController, 4, 'Veda a vzdelavani', [
  'Ahoj, zajimam se o vedu.',
  'Co je to fotosynteza?',
  'A jak funguje gravitace?',
  'Kolik je rychlost svetla?',
  '299792 * 2',
  'Co je to DNA?',
  'Jaky je rozdil mezi atomem a molekulou?',
  'Kolik planet ma slunecni soustava?',
  'Vymysli mi zajimavej vedeckej experiment pro deti.',
  'Jaky je dnes den?',
  'Co je to periodicka tabulka prvku?',
  '273 + 15',
  'Kdo vynalezl zarovku?',
  'Co si myslis o vyzkumu vesmiru?',
  'Diky, bylo to poucne!',
]);

await runConversation(ChatController, 5, 'Vareni a jidlo', [
  'Ahoj! Rad bych se naucil varit.',
  'Co si myslis o ceske kuchyni?',
  'Jaky je tvuj oblibenej ceskej recept?',
  'Kolik je 250 * 4?',
  'Vymysli mi originaln recept na dezert.',
  'Kolik je hodin?',
  'Co potrebuji k priprave svickove?',
  'A kolik to vareni asi trva?',
  '180 * 3',
  'Jaky je rozdil mezi pecenim a grilovanim?',
  'Vymysli mi jidelnicek na tyden.',
  'Jaky je dnes den?',
  'Co si myslis o veganske strave?',
  '350 + 275',
  'Diky za rady, pujdu varit!',
]);

await runConversation(ChatController, 6, 'Podnikani a byznys', [
  'Ahoj, premyslim o zalozeni firmy.',
  'Co si myslis o startupech v Cesku?',
  'Vymysli mi nazev pro technologickej startup.',
  'Jake jsou hlavni kroky pri zalozeni s.r.o.?',
  'Kolik je 15000 * 12?',
  'Jaky je dnes den?',
  'Co je to MVP v kontextu startupu?',
  'Vymysli mi elevator pitch pro appku na sdileni jidla.',
  '1000000 / 12',
  'Jake jsou trendy v IT podnikani?',
  'Co si myslis o praci na dalku?',
  'Kdy bude pristi uplnek?',
  'Kolik je hodin?',
  'Jake dovednosti potrebuje dobrej podnikatel?',
  'Diky, inspiroval jsi me!',
]);

await runConversation(ChatController, 7, 'Film a kultura', [
  'Ahoj! Bavme se o kulture.',
  'Co si myslis o ceskem filmu?',
  'Jakej je tvuj oblibenej filmovej zanr?',
  'Vymysli mi zapletku pro kratkej film.',
  'Jaky je dnes den?',
  '120 * 25',
  'Co je to streaming?',
  'Jake ceske filmy bys doporucil?',
  'Co si myslis o vlivu socialnich siti na kulturu?',
  'Vymysli mi nazev pro podcast o technologiich.',
  'Kolik je hodin?',
  'Co je to jazz?',
  '1900 + 126',
  'Jaka je role umeni ve spolecnosti?',
  'Diky za inspirativni rozhovor!',
]);

await runConversation(ChatController, 8, 'Zdravi a cviceni', [
  'Ahoj, chci zacit cvicit.',
  'Co si myslis o behani?',
  'Kolik kalorii spalim za hodinu behu?',
  '500 * 7',
  'Vymysli mi treninkovej plan pro zacatecnika.',
  'Jaky je dnes den?',
  'Co je dulezitejsi, kardio nebo sila?',
  'Kolik vody bych mel denne vypit?',
  '2000 + 500',
  'Co si myslis o intermittent fasting?',
  'Jake jsou nejlepsi protahovaci cviky?',
  'Kolik je hodin?',
  'Kdy bude pristi uplnek?',
  'Jak se vyvarovat zraneni pri cviceni?',
  'Diky za motivaci!',
]);

await runConversation(ChatController, 9, 'Historie a spolecnost', [
  'Ahoj, zajima me historie.',
  'Kdy vznikla Ceska republika?',
  'Co se stalo v roce 1989?',
  'Jaky je dnes den?',
  '2026 - 1993',
  'Kdo byl prvni ceskoslovenskej prezident?',
  'Co si myslis o vlivu historie na soucasnost?',
  'Vymysli mi namet na historickej roman z Prahy.',
  '1918 + 20',
  'Co je to renesance?',
  'Jake jsou nejdulezitejsi vynalezy 20. stoleti?',
  'Kolik je hodin?',
  'Co si myslis o uceni historie ve skolach?',
  'Kdy bude pristi uplnek?',
  'Diky, historie je fascinujici!',
]);

await runConversation(ChatController, 10, 'Technologie a budoucnost', [
  'Ahoj! Co je novyho v technologiich?',
  'Co si myslis o elektromobilech?',
  'Jaky je dnes den?',
  '2050 - 2026',
  'Co je to blockchain?',
  'Vymysli mi koncept chytry domacnosti budoucnosti.',
  'Kolik je 1024 * 1024?',
  'Co si myslis o robotice?',
  'Napis mi jednoduchy skript pro automatizaci v Bashi.',
  'Kolik je hodin?',
  'Jake technologie zmeni svet v pristich 10 letech?',
  'Co je to IoT?',
  '365 * 24',
  'Kdy bude pristi uplnek?',
  'Diky za skvelou konverzaci o budoucnosti!',
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
