// C.3 v35.1 Chat LLM E2E Tests - Evidence Usage
// ══════════════════════════════════════════════════════════════════════════════
// T3: Source-locked Answer
// T4: Conflicting Evidence Awareness
//
// Tyto testy ověřují:
// - LLM používá poskytnutou evidenci
// - LLM nepřepisuje zdroj "lepším odhadem"
// - LLM správně reportuje konflikty ve zdrojích
//
// ⚠️ Medium flakiness, high value
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import { chatLLM, chatLLMSequence, fuzzy, LLM_CONFIG } from './chat-llm-infra.js';
import { ChatContext } from '../chat/chat-guards.js';

const SKIP_LLM = process.env.SKIP_LLM === '1';

// ════════════════════════════════════════════════════════════════════════════
// T3: SOURCE-LOCKED ANSWER
// Pokud je evidence poskytnuta, LLM ji musí respektovat
// ════════════════════════════════════════════════════════════════════════════

describe('🟡 T3: Source-Locked Answer', () => {
  
  test('T3.1: Odpověď podle poskytnutého zdroje', async () => {
    if (SKIP_LLM) return;
    
    const context = new ChatContext();
    context.update({
      source: 'https://example.com/data',
      sourceType: 'explicit_url',
      domain: 'factual'
    });
    
    const result = await chatLLM(
      'Podle zdroje example.com je hodnota X rovna 42. Kolik je X?',
      context
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must contain 42
    expect(fuzzy.containsAny(result.rawText, ['42'])).toBe(true);
    
    // Must NOT contain alternative values
    expect(fuzzy.containsNone(result.rawText, ['41', '43', '40', '50'])).toBe(true);
  });

  test('T3.2: Neignoruje explicitní URL', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Podle https://example.com/moon je úplněk 9. února 2026. Kdy je úplněk?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must reference the date from source
    expect(fuzzy.containsAny(result.rawText, ['9', 'devátého', '9.'])).toBe(true);
    expect(fuzzy.containsAny(result.rawText, ['únor', 'února'])).toBe(true);
  });

  test('T3.3: Kontext z předchozí zprávy', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'Řeknu ti důležitou informaci: Heslo je "modrý slon". Zapamatuj si to.',
      'Jaké je heslo?'
    ]);
    
    const secondResult = results[1];
    
    if (!secondResult.success) throw new Error(`LLM failed: ${secondResult.error}`);
    
    // Must remember the password
    expect(fuzzy.containsAny(secondResult.rawText, ['modrý slon', 'modry slon'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// T4: CONFLICTING EVIDENCE AWARENESS
// Pokud jsou konfliktní zdroje, LLM musí uvést rozpor
// ════════════════════════════════════════════════════════════════════════════

describe('🟡 T4: Conflicting Evidence Awareness', () => {
  
  test('T4.1: Dva konfliktní zdroje', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Zdroj A říká, že X je 10. Zdroj B říká, že X je 20. Kolik je X?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must acknowledge conflict - NOT give single answer
    expect(fuzzy.containsAny(result.rawText, [
      'rozpo', 'konflikt', 'nesouhlasí', 'liší', 'různé', 'nejednoznačn',
      '10', '20'  // Should mention both values
    ])).toBe(true);
    
    // Should show uncertainty
    expect(result.metadata.confidence !== 'high').toBe(true);
  });

  test('T4.2: Neslučuje konfliktní data', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Web A uvádí cenu 1000 Kč. Web B uvádí cenu 2000 Kč. Jaká je správná cena?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must NOT average (1500) or pick randomly
    // Should indicate uncertainty or ask for clarification
    expect(fuzzy.containsAny(result.rawText, [
      'rozpo', 'konflikt', 'liší', 'nelze určit', 'záleží', 'ověřit',
      '1000', '2000'
    ])).toBe(true);
    
    // Should NOT claim false precision
    expect(fuzzy.containsNone(result.rawText, ['1500', 'průměr'])).toBe(true);
  });

  test('T4.3: Starý vs nový zdroj', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Článek z roku 2020 uvádí cenu 500 Kč. Článek z roku 2024 uvádí cenu 800 Kč. Jaká je aktuální cena?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Should prefer newer source OR acknowledge time difference
    expect(fuzzy.containsAny(result.rawText, [
      '800', '2024', 'novější', 'aktuální', 'změnil'
    ])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Evidence Usage Tests');
console.log('━'.repeat(60));
console.log(`📡 LLM: ${LLM_CONFIG.baseUrl}`);
console.log(`🤖 Model: ${LLM_CONFIG.model}`);
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
