// C3-Agent v55.2 — T6: Output Quality Gate Tests
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
// Spuštění: node --experimental-vm-modules tests/chat-output-quality.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function describe(name, fn) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(70)}`);
  fn();
}

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

function summary() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length > 0) {
    console.log(`\n  FAILURES:`);
    for (const f of failures) {
      console.log(`    ❌ ${f.name}: ${f.error}`);
    }
  }
  console.log(`${'═'.repeat(70)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.1: ZOMBIE / META RESPONSE REJECTION
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_1_ZombieDetection() {
  const { checkZombie } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.1: Zombie / Meta Response Detection', () => {

    // ─── Process narration ──────────────────────────────────────────────

    it('ZOMBIE: "Zde je moje odpověď na tvůj dotaz." → FAIL', async () => {
      const r = checkZombie('Zde je moje odpověď na tvůj dotaz.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'PROCESS_NARRATION');
    });

    it('ZOMBIE: "Here is my response to your question." → FAIL', async () => {
      const r = checkZombie('Here is my response to your question.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'PROCESS_NARRATION');
    });

    it('ZOMBIE: "Připravil jsem pro vás následující přehled." → FAIL', async () => {
      const r = checkZombie('Připravil jsem pro vás následující přehled.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'PROCESS_NARRATION');
    });

    // ─── Self-referential ───────────────────────────────────────────────

    it('ZOMBIE: "Jako jazykový model nemohu..." → FAIL', async () => {
      const r = checkZombie('Jako jazykový model nemohu poskytnout přesné informace.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'SELF_REFERENTIAL');
    });

    it('ZOMBIE: "As a language model, I..." → FAIL', async () => {
      const r = checkZombie('As a language model, I cannot browse the internet.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'SELF_REFERENTIAL');
    });

    // ─── Hollow filler ──────────────────────────────────────────────────

    it('ZOMBIE: "Rád ti pomůžu." (alone) → FAIL', async () => {
      const r = checkZombie('Rád ti pomůžu.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'HOLLOW_FILLER');
    });

    it('ZOMBIE: "Samozřejmě, rád pomohu." (alone) → FAIL', async () => {
      const r = checkZombie('Samozřejmě, rád pomohu.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'HOLLOW_FILLER');
    });

    // ─── Capability denial ──────────────────────────────────────────────

    it('ZOMBIE: "Nemám přístup k internetu." → FAIL', async () => {
      const r = checkZombie('Nemám přístup k internetu, ale mohu ti říct obecné informace.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'CAPABILITY_DENIAL');
    });

    it('ZOMBIE: "Nemohu vyhledávat na webu." → FAIL', async () => {
      const r = checkZombie('Nemohu vyhledávat na webu, ale...');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'CAPABILITY_DENIAL');
    });

    // ─── Echo ───────────────────────────────────────────────────────────

    it('ZOMBIE: "Ptáte se na..." → FAIL', async () => {
      const r = checkZombie('Ptáte se na zajímavou otázku o DPH.');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'ECHO');
    });

    // ─── Empty content ──────────────────────────────────────────────────

    it('ZOMBIE: empty string → FAIL', async () => {
      const r = checkZombie('');
      assert.equal(r.pass, false);
      assert.equal(r.violation.category, 'EMPTY_RESPONSE');
    });

    it('ZOMBIE: null → FAIL', async () => {
      const r = checkZombie(null);
      assert.equal(r.pass, false);
    });

    // ─── Meta opener with short tail ────────────────────────────────────

    it('ZOMBIE: "Zde je moje odpověď. DPH je daň." → FAIL (meta opener + short tail)', async () => {
      const r = checkZombie('Zde je moje odpověď. DPH je daň.');
      assert.equal(r.pass, false);
    });

    // ─── VALID responses ────────────────────────────────────────────────

    it('PASS: "DPH v ČR je 21%, snížená sazba je 15% a 10%." → OK', async () => {
      const r = checkZombie('DPH v ČR je 21%, snížená sazba je 15% a 10%. Vztahuje se na většinu zboží a služeb.');
      assert.equal(r.pass, true);
    });

    it('PASS: factual response with data → OK', async () => {
      const r = checkZombie(
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. ' +
        'Při elektronickém podání se lhůta prodlužuje do 1. května. ' +
        'Pokud využijete daňového poradce, máte čas do 1. července.'
      );
      assert.equal(r.pass, true);
    });

    it('PASS: comparison response → OK', async () => {
      const r = checkZombie(
        'Bitcoin je decentralizovaná kryptoměna zaměřená na uchovávání hodnoty, ' +
        'zatímco Ethereum je platforma pro smart kontrakty. ' +
        'BTC má limit 21 milionů coinů, ETH nemá pevný limit.'
      );
      assert.equal(r.pass, true);
    });

    it('PASS: "Rád ti pomůžu s daněmi. Deadline je..." → OK (filler + real content)', async () => {
      // Meta opener BUT followed by substantial content (>100 chars)
      const r = checkZombie(
        'Rád ti pomůžu s daněmi. ' +
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. Při elektronickém podání se prodlužuje do 1. května. ' +
        'Pokud využijete daňového poradce, máte čas do 1. července 2025.'
      );
      // This should PASS because the tail is substantial
      assert.equal(r.pass, true);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.2: CONTENT DENSITY ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_2_ContentDensity() {
  const {
    checkContentDensity,
    countContentTokens,
    CONTENT_THRESHOLDS,
  } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.2: Content Density Enforcement', () => {

    // ─── countContentTokens ─────────────────────────────────────────────

    it('countContentTokens: filters out filler words', async () => {
      const tokens = countContentTokens('To je a ten na se v z do pro');
      assert.equal(tokens, 0, 'All filler words should produce 0 content tokens');
    });

    it('countContentTokens: counts substantive words', async () => {
      const tokens = countContentTokens(
        'DPH v České republice činí 21 procent. Snížená sazba je 15 procent pro potraviny.'
      );
      assert.ok(tokens >= 5, `Expected >= 5 content tokens, got ${tokens}`);
    });

    it('countContentTokens: ignores URLs', async () => {
      const withUrl = countContentTokens(
        'Více informací najdete na https://www.financnisprava.cz/cs/dane/dan-z-pridane-hodnoty'
      );
      const justText = countContentTokens('Více informací najdete');
      // URL should not add content tokens
      assert.equal(withUrl, justText, 'URLs should not add content tokens');
    });

    it('countContentTokens: ignores markdown formatting', async () => {
      const withMd = countContentTokens('## Nadpis\n**tučný text** a *kurzíva*');
      const justText = countContentTokens('Nadpis tučný text a kurzíva');
      assert.equal(withMd, justText, 'Markdown should not affect token count');
    });

    // ─── checkContentDensity per intent ─────────────────────────────────

    it('FAIL: FACTUAL with no real content → LOW_CONTENT', async () => {
      const r = checkContentDensity(
        'Daňové přiznání má několik částí.',
        'FACTUAL'
      );
      assert.equal(r.pass, false, 'Vague factual response should fail');
      assert.ok(r.reason.includes('INSUFFICIENT_CONTENT'));
    });

    it('PASS: FACTUAL with concrete data → OK', async () => {
      const r = checkContentDensity(
        'Deadline pro podání DPFO v ČR je 1. dubna 2025. ' +
        'Při elektronickém podání přes datovou schránku se lhůta prodlužuje do 1. května. ' +
        'S daňovým poradcem máte čas do 1. července 2025. ' +
        'Pokuta za pozdní podání činí 0,05% dlužné částky za každý den prodlení.',
        'FACTUAL'
      );
      assert.equal(r.pass, true, `Should pass FACTUAL threshold, tokens: ${r.tokens}`);
    });

    it('FAIL: REPORT with minimal text → LOW_CONTENT', async () => {
      const r = checkContentDensity(
        'AI se vyvíjí rychle. Spousta firem investuje.',
        'REPORT'
      );
      assert.equal(r.pass, false, 'Short report should fail');
    });

    it('PASS: REPORT with synthesis → OK', async () => {
      const r = checkContentDensity(
        'V roce 2024 dominovaly AI průmyslu tři hlavní trendy. Zaprvé, velké jazykové modely ' +
        'dosáhly nových schopností v oblasti rozumování díky technikám jako Chain-of-Thought. ' +
        'Zadruhé, open-source modely jako Llama a Mistral výrazně zmenšily propast oproti ' +
        'komerčním řešením od OpenAI a Anthropic. Zatřetí, multimodální modely kombinující ' +
        'text, obraz a zvuk se staly standardem. Investice do AI sektoru přesáhly 100 miliard USD.',
        'REPORT'
      );
      assert.equal(r.pass, true, `Should pass REPORT threshold, tokens: ${r.tokens}`);
    });

    it('PASS: MINIMAL with just the answer → OK', async () => {
      const r = checkContentDensity(
        '1. dubna 2025.',
        'MINIMAL'
      );
      // MINIMAL threshold is 5 — this is borderline but should pass
      assert.equal(r.pass, true, `MINIMAL should accept short answers, tokens: ${r.tokens}`);
    });

    // ─── responseIntent overrides intent threshold ──────────────────────

    it('responseIntent DETAILED overrides FACTUAL threshold', async () => {
      const thresholdFactual = CONTENT_THRESHOLDS.FACTUAL;
      const thresholdDetailed = CONTENT_THRESHOLDS.DETAILED;
      assert.ok(thresholdDetailed > thresholdFactual,
        'DETAILED threshold should be higher than FACTUAL');

      // Pass for FACTUAL but fail for DETAILED
      const shortish = 'DPH v ČR je 21%. Snížená sazba je 15% pro potraviny a 10% pro léky. To je základ.';
      const r1 = checkContentDensity(shortish, 'FACTUAL');
      const r2 = checkContentDensity(shortish, 'FACTUAL', 'DETAILED');

      // At least verify the threshold logic works
      assert.ok(r2.threshold > r1.threshold,
        'DETAILED response intent should use higher threshold');
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.3: RESPONSE INTENT ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_3_ResponseIntentEnforcement() {
  const { checkResponseIntent } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.3: Response Intent Enforcement', () => {

    // ─── COMPARISON ─────────────────────────────────────────────────────

    it('FAIL: COMPARISON without comparison structure', async () => {
      const r = checkResponseIntent(
        'Bitcoin a Ethereum jsou kryptoměny. Obě používají blockchain technologii.',
        'COMPARISON'
      );
      assert.equal(r.pass, false, 'Missing comparison markers should fail');
      assert.ok(r.reason.includes('NO_COMPARISON_STRUCTURE'));
    });

    it('PASS: COMPARISON with "zatímco" marker', async () => {
      const r = checkResponseIntent(
        'Bitcoin je zaměřen na uchovávání hodnoty, zatímco Ethereum slouží jako platforma pro smart kontrakty.',
        'COMPARISON'
      );
      assert.equal(r.pass, true);
    });

    it('PASS: COMPARISON with "vs" marker', async () => {
      const r = checkResponseIntent(
        'BTC vs ETH: Bitcoin má limit 21M coinů, Ethereum nemá pevný strop.',
        'COMPARISON'
      );
      assert.equal(r.pass, true);
    });

    it('PASS: COMPARISON with table structure', async () => {
      const r = checkResponseIntent(
        '| Vlastnost | BTC | ETH |\n|---|---|---|\n| Limit | 21M | Žádný |',
        'COMPARISON'
      );
      assert.equal(r.pass, true);
    });

    // ─── STEP_BY_STEP ───────────────────────────────────────────────────

    it('FAIL: STEP_BY_STEP without numbered steps', async () => {
      const r = checkResponseIntent(
        'Nejprve si stáhněte formulář. Pak ho vyplňte. Nakonec odešlete.',
        'STEP_BY_STEP'
      );
      assert.equal(r.pass, false, 'Missing numbered steps should fail');
      assert.ok(r.reason.includes('NO_STEPS'));
    });

    it('PASS: STEP_BY_STEP with numbered steps', async () => {
      const r = checkResponseIntent(
        '1. Stáhněte formulář DPFO z portálu finanční správy.\n' +
        '2. Vyplňte osobní údaje a příjmy za uplynulý rok.\n' +
        '3. Odešlete elektronicky přes datovou schránku.',
        'STEP_BY_STEP'
      );
      assert.equal(r.pass, true);
    });

    // ─── BULLETS ────────────────────────────────────────────────────────

    it('FAIL: BULLETS without bullet points', async () => {
      const r = checkResponseIntent(
        'Praha má mnoho zajímavostí. Karlův most je nejznámější. Pražský hrad je také populární.',
        'BULLETS'
      );
      assert.equal(r.pass, false);
      assert.ok(r.reason.includes('NO_BULLETS'));
    });

    it('PASS: BULLETS with bullet points', async () => {
      const r = checkResponseIntent(
        '- Karlův most — nejstarší most přes Vltavu\n' +
        '- Pražský hrad — největší hradní komplex na světě\n' +
        '- Staroměstské náměstí — historické centrum',
        'BULLETS'
      );
      assert.equal(r.pass, true);
    });

    // ─── SUMMARY ────────────────────────────────────────────────────────

    it('FAIL: SUMMARY that is too long (>5 paragraphs)', async () => {
      const longText = Array(7).fill(
        'Toto je odstavec s dostatečným množstvím textu pro testování.'
      ).join('\n\n');
      const r = checkResponseIntent(longText, 'SUMMARY');
      assert.equal(r.pass, false);
      assert.ok(r.reason.includes('TOO_LONG_FOR_SUMMARY'));
    });

    it('PASS: SUMMARY with 2 paragraphs', async () => {
      const r = checkResponseIntent(
        'AI se v roce 2024 výrazně posunula díky open-source modelům a multimodálním systémům.\n\n' +
        'Klíčovým trendem byla demokratizace přístupu k velkým jazykovým modelům.',
        'SUMMARY'
      );
      assert.equal(r.pass, true);
    });

    // ─── MINIMAL ────────────────────────────────────────────────────────

    it('FAIL: MINIMAL that is too verbose', async () => {
      const r = checkResponseIntent(
        'To je zajímavá otázka. Odpověď závisí na mnoha faktorech. ' +
        'Za prvé, musíme zvážit kontext. Za druhé, historické okolnosti. ' +
        'Za třetí, ekonomické dopady. A konečně, politické implikace.',
        'MINIMAL'
      );
      assert.equal(r.pass, false);
      assert.ok(r.reason.includes('TOO_LONG_FOR_MINIMAL'));
    });

    it('PASS: MINIMAL with short answer', async () => {
      const r = checkResponseIntent('1. dubna 2025.', 'MINIMAL');
      assert.equal(r.pass, true);
    });

    // ─── No intent → always pass ────────────────────────────────────────

    it('No responseIntent → always PASS', async () => {
      const r = checkResponseIntent('Jakýkoliv text.', null);
      assert.equal(r.pass, true);
    });

    it('Unknown responseIntent → PASS (forward compatible)', async () => {
      const r = checkResponseIntent('Jakýkoliv text.', 'FUTURE_INTENT');
      assert.equal(r.pass, true);
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// T6.4: COMPOSITE GATE (enforceOutputContract)
// ══════════════════════════════════════════════════════════════════════════════

async function testT6_4_CompositeGate() {
  const { enforceOutputContract } = await import('../src/chat/handlers/utils/output-gate.js');

  describe('T6.4: Composite Gate (enforceOutputContract)', () => {

    // ─── Priority: Zombie > Density > Format ────────────────────────────

    it('Zombie detected first (even if other checks would also fail)', async () => {
      const v = enforceOutputContract('Zde je moje odpověď.', {
        intent: 'REPORT',
        responseIntent: 'COMPARISON',
      });
      assert.equal(v.ok, false);
      assert.equal(v.failDimension, 'ZOMBIE',
        'Zombie should be caught first, before density or format');
    });

    it('Low content detected when no zombie', async () => {
      const v = enforceOutputContract('Dobré. Hm.', {
        intent: 'REPORT',
      });
      assert.equal(v.ok, false);
      assert.equal(v.failDimension, 'LOW_CONTENT');
    });

    it('Format failure when content is sufficient but structure wrong', async () => {
      // Enough content tokens for COMPARISON, but no comparison structure
      const v = enforceOutputContract(
        'Bitcoin je digitální měna založená na blockchain technologii. ' +
        'Ethereum je také blockchain platforma s vlastní kryptoměnou Ether. ' +
        'Obě kryptoměny jsou populární mezi investory a technologickými nadšenci po celém světě.',
        { intent: 'SEARCH', responseIntent: 'COMPARISON' }
      );
      assert.equal(v.ok, false);
      assert.equal(v.failDimension, 'WRONG_FORMAT');
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

    it('All checks pass for good COMPARISON response', async () => {
      const v = enforceOutputContract(
        'Bitcoin je zaměřen na uchovávání hodnoty, zatímco Ethereum slouží jako platforma ' +
        'pro smart kontrakty. BTC má limit 21 milionů coinů, oproti tomu ETH nemá pevný strop. ' +
        'Z hlediska rychlosti transakcí je Ethereum výrazně rychlejší.',
        { intent: 'SEARCH', responseIntent: 'COMPARISON' }
      );
      assert.equal(v.ok, true, `Expected pass, got: ${v.reason}`);
    });

    // ─── Details present in verdict ─────────────────────────────────────

    it('Verdict contains details for all checked dimensions', async () => {
      const v = enforceOutputContract(
        'Normální odpověď s dostatečným množstvím textu pro základní test kontroly kvality výstupu systému.',
        { intent: 'SEARCH' }
      );
      assert.ok(v.details, 'Verdict should have details');
      assert.ok(v.details.zombie, 'Should have zombie result');
      assert.ok(v.details.density, 'Should have density result');
      // format is null when no responseIntent is set (no enforcement needed)
      assert.ok(v.details.format !== undefined, 'Should have format key');
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

    it('ZOMBIE retry prompt contains anti-meta instruction', async () => {
      const verdict = enforceOutputContract('Zde je moje odpověď na tvůj dotaz.', {
        intent: 'FACTUAL',
      });
      const retryPrompt = buildOutputGateRetryPrompt('Original prompt', verdict);
      assert.ok(retryPrompt.includes('REJECTED'), 'Should mention rejection');
      assert.ok(
        retryPrompt.includes('meta-commentary') || retryPrompt.includes('ACTUAL CONTENT'),
        'Should instruct to provide actual content'
      );
    });

    it('LOW_CONTENT retry prompt asks for concrete data', async () => {
      const verdict = enforceOutputContract('Dobré ráno. Jak se máte dnes.', {
        intent: 'REPORT',
      });
      const retryPrompt = buildOutputGateRetryPrompt('Original prompt', verdict);
      assert.ok(retryPrompt.includes('REJECTED'), 'Should mention rejection');
      assert.ok(
        retryPrompt.includes('CONCRETE') || retryPrompt.includes('facts'),
        'Should ask for concrete facts'
      );
    });

    it('WRONG_FORMAT retry prompt specifies expected format', async () => {
      const verdict = enforceOutputContract(
        'Bitcoin je kryptoměna. Ethereum je také kryptoměna. Obě jsou na blockchainu ' +
        'a mají velkou komunitu uživatelů po celém světě.',
        { intent: 'SEARCH', responseIntent: 'COMPARISON' }
      );
      const retryPrompt = buildOutputGateRetryPrompt('Original prompt', verdict);
      assert.ok(retryPrompt.includes('REJECTED'), 'Should mention rejection');
      assert.ok(
        retryPrompt.includes('COMPARISON') || retryPrompt.includes('side-by-side'),
        'Should specify comparison format'
      );
    });

    it('Retry prompt preserves original prompt', async () => {
      const originalPrompt = 'User query: "Srovnej BTC a ETH"';
      const verdict = {
        ok: false,
        failDimension: 'ZOMBIE',
        reason: 'test',
        details: {},
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

console.log('\n🧪 C3-Agent v55.2 — T6: Output Quality Gate Tests\n');
console.log(`Running from: ${process.cwd()}`);
console.log(`Time: ${new Date().toISOString()}\n`);

try {
  await testT6_1_ZombieDetection();
  await testT6_2_ContentDensity();
  await testT6_3_ResponseIntentEnforcement();
  await testT6_4_CompositeGate();
  await testT6_5_RetryPrompt();
} catch (err) {
  console.error(`\n💥 FATAL: Test suite crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
}

summary();
