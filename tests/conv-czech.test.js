// C3-Agent v57.3 — Czech Conversation Tests (10 × 15+ steps)
// ══════════════════════════════════════════════════════════════════════════════
//
// 10 multi-turn Czech conversations through full ChatController.handle() pipeline.
// Each conversation has 15+ steps mixing CONVERSATIONAL, LOCAL, SEARCH, CREATIVE, CODE.
//
// Run: OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// ═══════════════════════════════════════════════════════════════════════════════
// Test infrastructure
// ═══════════════════════════════════════════════════════════════════════════════

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

  const sessionId = `conv-cz-${convNum}-${Date.now()}`;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    try {
      const result = await ChatController.handle({ message: msg, sessionId });
      if (!result.response) throw new Error('Prázdná odpověď');
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
console.log('  ČESKÉ KONVERZAČNÍ TESTY (10 × 15+ kroků)');
console.log(`${'═'.repeat(70)}`);

let ollamaOk = false;
try {
  const r = await fetch(`${OLLAMA_URL}/api/tags`);
  ollamaOk = r.ok;
} catch { /* */ }
if (!ollamaOk) { console.error('❌ Ollama nedostupná'); process.exit(1); }
console.log('  ✅ Ollama dostupná\n');

// Suppress noisy pipeline logs
const _origLog = console.log;
const _origInfo = console.info;
const suppressPatterns = /\[C3:|CRE Decision|HandleToolCall|ToolExecutor|WebSearch|SearchMetrics|HandleLocal|ConversationHandler|HandleAskUser|DB\]/;
console.log = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origLog(...args); };
console.info = (...args) => { if (!suppressPatterns.test(String(args[0]))) _origInfo(...args); };

const ChatController = await setupPipeline();

// ═══════════════════════════════════════════════════════════════════════════════
// 10 konverzací
// ═══════════════════════════════════════════════════════════════════════════════

await runConversation(ChatController, 1, 'Smalltalk + matematika + datum', [
  'Ahoj! Jak se máš?',
  'Co si myslíš o umělé inteligenci?',
  'Jaký je dnes den?',
  'Kolik je 347 * 12?',
  '99 + 1',
  'Kdy bude příští úplněk?',
  'Kolik je hodin?',
  'Díky za informace. A co si myslíš o budoucnosti AI?',
  '1024 / 16',
  'Jaké je dnes datum?',
  'Co je to neuronová síť?',
  'Kolik dní do Vánoc?',
  '55 * 55',
  'A co si myslíš o kvantových počítačích?',
  'Díky, to je zajímavé!',
]);

await runConversation(ChatController, 2, 'Programování a kód', [
  'Ahoj, potřebuji pomoc s programováním.',
  'Co si myslíš o Pythonu jako prvním jazyku?',
  'Napiš mi funkci pro výpočet faktoriálu v Pythonu.',
  'A co rekurzivní verze?',
  'Kolik je 10! (10 faktoriál)?',
  'Jaký je rozdíl mezi seznamem a n-ticí v Pythonu?',
  'Vymysli mi název pro knihovnu na zpracování dat.',
  'Napiš mi jednoduchý HTTP server v Node.js.',
  '2 ** 10',
  'Co je to REST API?',
  'Jak bys porovnal TypeScript a JavaScript?',
  'Napiš mi regex pro validaci emailu.',
  'Co je to Big O notace?',
  '1000 - 777',
  'Díky za všechno, naučil jsem se hodně!',
]);

await runConversation(ChatController, 3, 'Cestování a geografie', [
  'Ahoj! Rád bych se dozvěděl něco o cestování.',
  'Jaké je hlavní město Itálie?',
  'Kolik tam žije lidí?',
  'Co bys doporučil navštívit v Římě?',
  'Kolik je hodin?',
  'Jaký je dnes den?',
  '500 * 3',
  'A co Japonsko? Stojí za návštěvu?',
  'Jaké je hlavní město Japonska?',
  'Vymysli mi itinerář na 3 dny v Praze.',
  'Kolik je 120 * 24?',
  'Co si myslíš o cestování vlakem vs. letadlem?',
  'Kdy bude příští úplněk?',
  'Jaké jsou nejhezčí české hrady?',
  'Díky za tipy!',
]);

await runConversation(ChatController, 4, 'Věda a vzdělávání', [
  'Ahoj, zajímám se o vědu.',
  'Co je to fotosyntéza?',
  'A jak funguje gravitace?',
  'Kolik je rychlost světla?',
  '299792 * 2',
  'Co je to DNA?',
  'Jaký je rozdíl mezi atomem a molekulou?',
  'Kolik planet má sluneční soustava?',
  'Vymysli mi zajímavý vědecký experiment pro děti.',
  'Jaký je dnes den?',
  'Co je to periodická tabulka prvků?',
  '273 + 15',
  'Kdo vynalezl žárovku?',
  'Co si myslíš o výzkumu vesmíru?',
  'Díky, bylo to poučné!',
]);

await runConversation(ChatController, 5, 'Vaření a recepty', [
  'Ahoj! Rád bych se naučil vařit.',
  'Co si myslíš o české kuchyni?',
  'Jaký je tvůj oblíbený český recept?',
  'Kolik je 250 * 4?',
  'Vymysli mi originální recept na dezert.',
  'Kolik je hodin?',
  'Co potřebuji k přípravě svíčkové?',
  'A kolik to vaření asi trvá?',
  '180 * 3',
  'Jaký je rozdíl mezi pečením a grilováním?',
  'Vymysli mi jídelníček na týden.',
  'Jaký je dnes den?',
  'Co si myslíš o veganské stravě?',
  '350 + 275',
  'Díky za rady, půjdu vařit!',
]);

await runConversation(ChatController, 6, 'Podnikání a startupy', [
  'Ahoj, přemýšlím o založení firmy.',
  'Co si myslíš o startupech v Česku?',
  'Vymysli mi název pro technologický startup.',
  'Jaké jsou hlavní kroky při založení s.r.o.?',
  'Kolik je 15000 * 12?',
  'Jaký je dnes den?',
  'Co je to MVP v kontextu startupů?',
  'Vymysli mi elevator pitch pro aplikaci na sdílení jídla.',
  '1000000 / 12',
  'Jaké jsou trendy v IT podnikání?',
  'Co si myslíš o práci na dálku?',
  'Kdy bude příští úplněk?',
  'Kolik je hodin?',
  'Jaké dovednosti potřebuje dobrý podnikatel?',
  'Díky, inspiroval jsi mě!',
]);

await runConversation(ChatController, 7, 'Film, hudba a kultura', [
  'Ahoj! Bavme se o kultuře.',
  'Co si myslíš o českém filmu?',
  'Jaký je tvůj oblíbený filmový žánr?',
  'Vymysli mi zápletku pro krátký film.',
  'Jaký je dnes den?',
  '120 * 25',
  'Co je to streaming?',
  'Jaké české filmy bys doporučil?',
  'Co si myslíš o vlivu sociálních sítí na kulturu?',
  'Vymysli mi název pro podcast o technologiích.',
  'Kolik je hodin?',
  'Co je to jazz?',
  '1900 + 126',
  'Jaká je role umění ve společnosti?',
  'Díky za inspirativní rozhovor!',
]);

await runConversation(ChatController, 8, 'Zdraví a fitness', [
  'Ahoj, chci začít cvičit.',
  'Co si myslíš o běhání?',
  'Kolik kalorií spálím za hodinu běhu?',
  '500 * 7',
  'Vymysli mi tréninkový plán pro začátečníka.',
  'Jaký je dnes den?',
  'Co je důležitější, kardio nebo síla?',
  'Kolik vody bych měl denně vypít?',
  '2000 + 500',
  'Co si myslíš o intermittent fasting?',
  'Jaké jsou nejlepší protahovací cviky?',
  'Kolik je hodin?',
  'Kdy bude příští úplněk?',
  'Jak se vyvarovat zranění při cvičení?',
  'Díky za motivaci!',
]);

await runConversation(ChatController, 9, 'Historie a společnost', [
  'Ahoj, zajímá mě historie.',
  'Kdy vznikla Česká republika?',
  'Co se stalo v roce 1989?',
  'Jaký je dnes den?',
  '2026 - 1993',
  'Kdo byl první československý prezident?',
  'Co si myslíš o vlivu historie na současnost?',
  'Vymysli mi námět na historický román z Prahy.',
  '1918 + 20',
  'Co je to renesance?',
  'Jaké jsou nejdůležitější vynálezy 20. století?',
  'Kolik je hodin?',
  'Co si myslíš o učení historie ve školách?',
  'Kdy bude příští úplněk?',
  'Díky, historie je fascinující!',
]);

await runConversation(ChatController, 10, 'Technologie a budoucnost', [
  'Ahoj! Co je nového v technologiích?',
  'Co si myslíš o elektromobilech?',
  'Jaký je dnes den?',
  '2050 - 2026',
  'Co je to blockchain?',
  'Vymysli mi koncept chytré domácnosti budoucnosti.',
  'Kolik je 1024 * 1024?',
  'Co si myslíš o robotice?',
  'Napiš mi jednoduchý skript pro automatizaci v Bashe.',
  'Kolik je hodin?',
  'Jaké technologie změní svět v příštích 10 letech?',
  'Co je to IoT?',
  '365 * 24',
  'Kdy bude příští úplněk?',
  'Díky za skvělou konverzaci o budoucnosti!',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log = _origLog;
console.info = _origInfo;

console.log(`\n${'═'.repeat(70)}`);
console.log(`  VÝSLEDKY: ${passedSteps} OK, ${failedSteps} FAIL, ${totalSteps} celkem`);
if (failures.length > 0) {
  console.log(`\n  CHYBY:`);
  for (const f of failures) {
    console.log(`    ❌ [${f.conv}.${f.step}] ${f.input}: ${f.error}`);
  }
}
console.log(`${'═'.repeat(70)}\n`);
process.exit(failedSteps > 0 ? 1 : 0);
