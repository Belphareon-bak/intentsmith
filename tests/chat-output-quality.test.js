// C3-Agent v60 — T6: Output Quality Gate Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for D6 enforcement module (handlers/utils/output-gate.js)
//
// T6.1: Zombie/meta response rejection (D6.1)
// T6.2: Content density enforcement (D6.2)
// T6.3: Response intent enforcement (D6.3)
// T6.4: Composite gate (enforceOutputContract)
// T6.5: Retry prompt generation
//
// Spuštění: node tests/chat-output-quality.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const pendingSuites = [];
let registeringSuite = null;

function describe(name, fn) {
  const suite = { name, tests: [] };
  const parent = registeringSuite;
  registeringSuite = suite;
  try {
    fn();
  } finally {
    registeringSuite = parent;
  }
  pendingSuites.push(suite);
}

function it(name, fn) {
  if (!registeringSuite) throw new Error(`Test declared outside a suite: ${name}`);
  registeringSuite.tests.push({ name, fn });
}

async function runSuites() {
  for (const suite of pendingSuites) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${suite.name}`);
    console.log(`${'═'.repeat(70)}`);
    for (const { name, fn } of suite.tests) {
      await runTest(name, fn);
    }
  }
}

async function runTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2705 ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  \u274C ${name}`);
    console.log(`     ${err.message}`);
  }
}

function summary() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    \u274C ${f.name}: ${f.error}`);
    }
  }
  console.log(`${'═'.repeat(70)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.1: ZOMBIE / META RESPONSE REJECTION
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_1_ZombieDetection() {
  const { detectZombie } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.1: Zombie / Meta Response Detection', () => {

    // ─── Process narration ──────────────────────────────────────────────

    it('ZOMBIE: "Zde je moje odpověď na tvůj dotaz." \u2192 detected', async () => {
      const r = detectZombie('Zde je moje odpověď na tvůj dotaz.');
      assert.equal(r.isZombie, true);
    });

    it('ZOMBIE: "Here is my response to your question." \u2192 detected', async () => {
      const r = detectZombie('Here is my response to your question.');
      assert.equal(r.isZombie, true);
    });

    it('ZOMBIE: "Připravil jsem pro vás následující přehled." \u2192 detected', async () => {
      const r = detectZombie('Připravil jsem pro vás následující přehled.');
      assert.equal(r.isZombie, true);
    });

    // ─── Self-referential ───────────────────────────────────────────────

    it('ZOMBIE: "Jako jazykový model nemohu..." \u2192 detected', async () => {
      const r = detectZombie('Jako jazykový model nemohu poskytnout přesné informace.');
      assert.equal(r.isZombie, true);
    });

    it('ZOMBIE: "As a language model, I..." \u2192 detected', async () => {
      const r = detectZombie('As a language model, I cannot browse the internet.');
      assert.equal(r.isZombie, true);
    });

    // ─── Hollow filler ──────────────────────────────────────────────────

    it('ZOMBIE: "Rád ti pomůžu." (alone) \u2192 detected', async () => {
      const r = detectZombie('Rád ti pomůžu.');
      assert.equal(r.isZombie, true);
    });

    it('ZOMBIE: "Samozřejmě, rád pomohu." (alone) \u2192 detected', async () => {
      const r = detectZombie('Samozřejmě, rád pomohu.');
      assert.equal(r.isZombie, true);
    });

    // ─── Capability denial ──────────────────────────────────────────────

    it('ZOMBIE: "Nemám přístup k internetu." \u2192 detected', async () => {
      const r = detectZombie('Nemám přístup k internetu, ale mohu ti říct obecné informace.');
      assert.equal(r.isZombie, true);
    });

    it('ZOMBIE: "Nemohu vyhledávat na webu." \u2192 detected', async () => {
      const r = detectZombie('Nemohu vyhledávat na webu, ale...');
      assert.equal(r.isZombie, true);
    });

    // ─── Echo ───────────────────────────────────────────────────────────

    it('ZOMBIE: "Ptáte se na..." \u2192 detected', async () => {
      const r = detectZombie('Ptáte se na zajímavou otázku o DPH.');
      assert.equal(r.isZombie, true);
    });

    // ─── Empty content ──────────────────────────────────────────────────

    it('ZOMBIE: empty string \u2192 detected', async () => {
      const r = detectZombie('');
      assert.equal(r.isZombie, true);
    });

    it('ZOMBIE: null \u2192 detected', async () => {
      const r = detectZombie(null);
      assert.equal(r.isZombie, true);
    });

    // ─── Meta opener with short tail ────────────────────────────────────

    it('ZOMBIE: "Zde je moje odpověď. DPH je daň." \u2192 detected (meta opener + short tail)', async () => {
      const r = detectZombie('Zde je moje odpověď. DPH je daň.');
      assert.equal(r.isZombie, true);
    });

    // ─── VALID responses ────────────────────────────────────────────────

    it('PASS: "DPH v ČR je 21%, snížená sazba je 15% a 10%." \u2192 OK', async () => {
      const r = detectZombie('DPH v ČR je 21%, snížená sazba je 15% a 10%. Vztahuje se na většinu zboží a služeb.');
      assert.equal(r.isZombie, false);
    });

    it('PASS: factual response with data \u2192 OK', async () => {
      const r = detectZombie(
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. ' +
        'Při elektronickém podání se lhůta prodlužuje do 1. května. ' +
        'Pokud využijete daňového poradce, máte čas do 1. července.'
      );
      assert.equal(r.isZombie, false);
    });

    it('PASS: comparison response \u2192 OK', async () => {
      const r = detectZombie(
        'Bitcoin je decentralizovaná kryptoměna zaměřená na uchovávání hodnoty, ' +
        'zatímco Ethereum je platforma pro smart kontrakty. ' +
        'BTC má limit 21 milionů coinů, ETH nemá pevný limit.'
      );
      assert.equal(r.isZombie, false);
    });

    it('PASS: "Rád ti pomůžu s daněmi. Deadline je..." \u2192 OK (filler + real content)', async () => {
      // Meta opener BUT followed by substantial content (>100 chars)
      const r = detectZombie(
        'Rád ti pomůžu s daněmi. ' +
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. Při elektronickém podání se prodlužuje do 1. května. ' +
        'Pokud využijete daňového poradce, máte čas do 1. července 2025.'
      );
      // Should pass because the response is >100 chars and contains real content
      assert.equal(r.isZombie, false);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.2: CONTENT DENSITY ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_2_ContentDensity() {
  const { checkDensity, DENSITY_THRESHOLDS } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.2: Content Density Enforcement', () => {

    // ─── Threshold existence ──────────────────────────────────────────

    it('DENSITY_THRESHOLDS has all intent types', async () => {
      assert.ok(DENSITY_THRESHOLDS.CONVERSATIONAL, 'CONVERSATIONAL');
      assert.ok(DENSITY_THRESHOLDS.SEARCH, 'SEARCH');
      assert.ok(DENSITY_THRESHOLDS.REPORT, 'REPORT');
      assert.ok(DENSITY_THRESHOLDS.FACTUAL, 'FACTUAL');
      assert.ok(DENSITY_THRESHOLDS.CREATIVE, 'CREATIVE');
      assert.ok(DENSITY_THRESHOLDS.CODE, 'CODE');
    });

    it('REPORT threshold is higher than CONVERSATIONAL', async () => {
      assert.ok(DENSITY_THRESHOLDS.REPORT > DENSITY_THRESHOLDS.CONVERSATIONAL);
    });

    // ─── checkDensity per intent ─────────────────────────────────────

    it('FAIL: FACTUAL with vague short content \u2192 not dense', async () => {
      const r = checkDensity('Daňové přiznání.', 'FACTUAL');
      assert.equal(r.dense, false, `Only ${r.actualLength} chars, need ${r.threshold}`);
    });

    it('PASS: FACTUAL with concrete data \u2192 dense', async () => {
      const r = checkDensity(
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. ' +
        'Při elektronickém podání přes datovou schránku se lhůta prodlužuje do 1. května. ' +
        'S daňovým poradcem máte čas do 1. července 2025. ' +
        'Pokuta za pozdní podání činí 0,05% dlužné částky za každý den prodlení.',
        'FACTUAL'
      );
      assert.equal(r.dense, true, `${r.actualLength} chars >= ${r.threshold}`);
    });

    it('FAIL: REPORT with minimal text \u2192 not dense', async () => {
      const r = checkDensity('AI se vyvíjí rychle.', 'REPORT');
      assert.equal(r.dense, false);
    });

    it('PASS: REPORT with synthesis \u2192 dense', async () => {
      const r = checkDensity(
        'V roce 2024 dominovaly AI průmyslu tři hlavní trendy. Zaprvé, velké jazykové modely ' +
        'dosáhly nových schopností v oblasti rozumování díky technikám jako Chain-of-Thought. ' +
        'Zadruhé, open-source modely jako Llama a Mistral výrazně zmenšily propast oproti ' +
        'komerčním řešením od OpenAI a Anthropic. Zatřetí, multimodální modely kombinující ' +
        'text, obraz a zvuk se staly standardem. Investice do AI sektoru přesáhly 100 miliard USD.',
        'REPORT'
      );
      assert.equal(r.dense, true);
    });

    it('PASS: CONVERSATIONAL with short greeting \u2192 dense', async () => {
      const r = checkDensity('Ahoj! Jak se máš?', 'CONVERSATIONAL');
      assert.equal(r.dense, true, `${r.actualLength} chars >= ${r.threshold} (CONVERSATIONAL = 10)`);
    });

    it('checkDensity returns actualLength and threshold', async () => {
      const r = checkDensity('Test.', 'SEARCH');
      assert.equal(typeof r.actualLength, 'number');
      assert.equal(typeof r.threshold, 'number');
      assert.equal(typeof r.dense, 'boolean');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.3: RESPONSE INTENT ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_3_ResponseIntentEnforcement() {
  const { checkIntentAlignment } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.3: Response Intent Enforcement', () => {

    // ─── Echo pattern detection ──────────────────────────────────────

    it('FAIL: Echo "Rozumím, že chcete..." \u2192 not aligned', async () => {
      const r = checkIntentAlignment(
        'Rozumím, že chcete vědět o DPH. Pokusím se vám pomoci.',
        'SEARCH', null
      );
      assert.equal(r.aligned, false);
      assert.ok(r.reason.includes('echo'));
    });

    it('FAIL: Echo "I understand you are asking..." \u2192 not aligned', async () => {
      const r = checkIntentAlignment(
        'I understand you are asking about tax deadlines. Let me help.',
        'SEARCH', null
      );
      assert.equal(r.aligned, false);
    });

    // ─── Creative skeleton detection ──────────────────────────────────

    it('FAIL: Creative with placeholder "[sem vložte]" \u2192 not aligned', async () => {
      const r = checkIntentAlignment(
        'Zde je váš příběh:\n[sem vložte obsah]\nKonec.',
        'CREATIVE', null
      );
      assert.equal(r.aligned, false);
      assert.ok(r.reason.includes('creative_skeleton'));
    });

    it('FAIL: Creative with "[TODO]" placeholder \u2192 not aligned', async () => {
      const r = checkIntentAlignment(
        'Marketingová kampaň:\n1. [TODO] Definovat cílovou skupinu\n2. [TODO] Vybrat kanály',
        'CREATIVE', null
      );
      assert.equal(r.aligned, false);
    });

    // ─── Design hedging detection ─────────────────────────────────────

    it('FAIL: Design with hedging "záleží na kontextu" \u2192 not aligned', async () => {
      const r = checkIntentAlignment(
        'Záleží na kontextu vašeho projektu, ale obecně existuje více možností jak to řešit.',
        'DESIGN', null
      );
      assert.equal(r.aligned, false);
      assert.ok(r.reason.includes('design_hedging'));
    });

    it('FAIL: Design with language leak (Polish) \u2192 not aligned', async () => {
      const r = checkIntentAlignment(
        'Informacje o architektuře systému jsou omezené.',
        'DESIGN', null
      );
      assert.equal(r.aligned, false);
      assert.ok(r.reason.includes('language_leak'));
    });

    // ─── Valid responses ──────────────────────────────────────────────

    it('PASS: Normal factual response \u2192 aligned', async () => {
      const r = checkIntentAlignment(
        'DPH v ČR je 21%, snížená sazba je 15% pro potraviny.',
        'FACTUAL', null
      );
      assert.equal(r.aligned, true);
    });

    it('PASS: Normal search response \u2192 aligned', async () => {
      const r = checkIntentAlignment(
        'Bitcoin je decentralizovaná kryptoměna zaměřená na uchovávání hodnoty.',
        'SEARCH', null
      );
      assert.equal(r.aligned, true);
    });

    it('PASS: No intent \u2192 always aligned', async () => {
      const r = checkIntentAlignment('Jakýkoliv text.', null, null);
      assert.equal(r.aligned, true);
    });

    it('PASS: Empty content \u2192 not aligned', async () => {
      const r = checkIntentAlignment('', 'SEARCH', null);
      assert.equal(r.aligned, false);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.4: COMPOSITE GATE (enforceOutputContract)
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_4_CompositeGate() {
  const { enforceOutputContract } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.4: Composite Gate (enforceOutputContract)', () => {

    // ─── Priority: Zombie > Density > Intent ──────────────────────────

    it('Zombie detected first', async () => {
      const v = enforceOutputContract('Zde je moje odpověď.', {
        intent: 'REPORT',
      });
      assert.equal(v.ok, false);
      assert.equal(v.failDimension, 'D6.1_ZOMBIE',
        'Zombie should be caught first');
    });

    it('Low density detected when no zombie', async () => {
      const v = enforceOutputContract('Dobré. Hm.', {
        intent: 'REPORT',
      });
      assert.equal(v.ok, false);
      assert.equal(v.failDimension, 'D6.2_DENSITY');
    });

    it('MINIMAL creative form accepts a compact substantive result', async () => {
      const v = enforceOutputContract('Káva tiše voní\nRáno kreslí do páry\nDen se probouzí', {
        intent: 'CREATIVE',
        responseIntent: 'MINIMAL',
      });
      assert.equal(v.ok, true);
    });

    it('Intent misalignment detected when content is sufficient', async () => {
      const v = enforceOutputContract(
        'Rozumím, že chcete informace o DPH v České republice, pojďme se na to podívat podrobněji a zjistit co je potřeba vědět.',
        { intent: 'SEARCH' }
      );
      assert.equal(v.ok, false);
      assert.equal(v.failDimension, 'D6.3_INTENT');
    });

    // ─── Full pass ──────────────────────────────────────────────────────

    it('All checks pass for good FACTUAL response', async () => {
      const v = enforceOutputContract(
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. ' +
        'Při elektronickém podání se lhůta prodlužuje do 1. května. ' +
        'S daňovým poradcem máte čas do 1. července 2025.',
        { intent: 'FACTUAL' }
      );
      assert.equal(v.ok, true, `Expected pass, got: ${v.reason}`);
    });

    it('All checks pass for good SEARCH response', async () => {
      const v = enforceOutputContract(
        'Bitcoin je zaměřen na uchovávání hodnoty, zatímco Ethereum slouží jako platforma ' +
        'pro smart kontrakty. BTC má limit 21 milionů coinů, oproti tomu ETH nemá pevný strop.',
        { intent: 'SEARCH' }
      );
      assert.equal(v.ok, true, `Expected pass, got: ${v.reason}`);
    });

    it('All checks pass for good CONVERSATIONAL response', async () => {
      const v = enforceOutputContract(
        'Ahoj! Rád ti pomohu s čímkoliv ohledně programování nebo technologií.',
        { intent: 'CONVERSATIONAL' }
      );
      assert.equal(v.ok, true, `Expected pass, got: ${v.reason}`);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.5: RETRY PROMPT GENERATION
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_5_RetryPrompt() {
  const {
    enforceOutputContract,
    buildOutputGateRetryPrompt,
  } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.5: Retry Prompt Generation', () => {

    it('ZOMBIE retry prompt contains rejection notice', async () => {
      const verdict = enforceOutputContract('Zde je moje odpověď na tvůj dotaz.', {
        intent: 'FACTUAL',
      });
      const retryPrompt = buildOutputGateRetryPrompt('Original prompt', verdict);
      assert.ok(retryPrompt.includes('ODMÍTNUTA'), 'Should mention rejection');
    });

    it('DENSITY retry prompt asks for concrete content', async () => {
      const verdict = enforceOutputContract('Dobré.', {
        intent: 'REPORT',
      });
      const retryPrompt = buildOutputGateRetryPrompt('Original prompt', verdict);
      assert.ok(retryPrompt.includes('ODMÍTNUTA'), 'Should mention rejection');
      assert.ok(
        retryPrompt.includes('KONKRÉTNÍM') || retryPrompt.includes('fakta'),
        'Should ask for concrete facts'
      );
    });

    it('INTENT retry prompt specifies fix needed', async () => {
      const verdict = enforceOutputContract(
        'Rozumím, že chcete informace o DPH v České republice a já vám rád pomohu najít ty správné odpovědi na vaše otázky.',
        { intent: 'SEARCH' }
      );
      const retryPrompt = buildOutputGateRetryPrompt('Original prompt', verdict);
      assert.ok(retryPrompt.includes('ODMÍTNUTA'), 'Should mention rejection');
    });

    it('Retry prompt preserves original prompt', async () => {
      const originalPrompt = 'User query: "Srovnej BTC a ETH"';
      const verdict = {
        ok: false,
        failDimension: 'D6.1_ZOMBIE',
        reason: 'test',
      };
      const retryPrompt = buildOutputGateRetryPrompt(originalPrompt, verdict);
      assert.ok(retryPrompt.startsWith(originalPrompt),
        'Retry prompt should start with original prompt');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ══════════════════════════════════════════════════════════════════════════════

console.log('\n\uD83E\uDDEA C3-Agent v60 \u2014 T6: Output Quality Gate Tests\n');
console.log(`Running from: ${process.cwd()}`);
console.log(`Time: ${new Date().toISOString()}\n`);

try {
  await testT6_1_ZombieDetection();
  await testT6_2_ContentDensity();
  await testT6_3_ResponseIntentEnforcement();
  await testT6_4_CompositeGate();
  await testT6_5_RetryPrompt();
  await runSuites();
} catch (err) {
  console.error(`\n\uD83D\uDCA5 FATAL: Test suite crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
}

summary();
