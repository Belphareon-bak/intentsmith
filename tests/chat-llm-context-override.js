// C.3 v35.1 Chat LLM E2E Tests - Context Override
// ══════════════════════════════════════════════════════════════════════════════
// T5: Context Override Test
// T6: Partial Context Test
//
// Tyto testy ověřují:
// - LLM správně pracuje s poskytnutým kontextem
// - LLM preferuje kontext nad world-knowledge
// - LLM správně odvozuje z částečných dat
//
// ⚠️ Critical for RAG / agents / simulations
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import { chatLLM, chatLLMSequence, fuzzy, LLM_CONFIG } from './chat-llm-infra.js';

const SKIP_LLM = process.env.SKIP_LLM === '1';

// ════════════════════════════════════════════════════════════════════════════
// T5: CONTEXT OVERRIDE TEST
// Kontext má přednost před world-knowledge
// ════════════════════════════════════════════════════════════════════════════

describe('🟡 T5: Context Override Test', () => {
  
  test('T5.1: Alternativní realita - Slunce modré', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'V tomto světě má Slunce modrou barvu. Zapamatuj si to pro další otázky.',
      'Jakou barvu má Slunce v tomto světě?'
    ]);
    
    const answer = results[1];
    
    if (!answer.success) throw new Error(`LLM failed: ${answer.error}`);
    
    // Must say "blue" based on context
    expect(fuzzy.containsAny(answer.rawText, ['modr', 'blue'])).toBe(true);
    
    // Should NOT contradict with "ve skutečnosti..."
    expect(fuzzy.containsNone(answer.rawText, ['ve skutečnosti', 'ale opravdu', 'reálně'])).toBe(true);
  });

  test('T5.2: Fiktivní entita', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'V naší hře existuje postava jménem Zorkul, která má 3 oči a 5 rukou.',
      'Kolik očí má Zorkul?'
    ]);
    
    const answer = results[1];
    
    if (!answer.success) throw new Error(`LLM failed: ${answer.error}`);
    
    // Must remember from context
    expect(fuzzy.containsAny(answer.rawText, ['3', 'tři'])).toBe(true);
  });

  test('T5.3: Přepsaná fyzika', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'V tomto vesmíru platí, že gravitace odpuzuje místo přitahuje.',
      'Co se stane, když pustím kámen v tomto vesmíru?'
    ]);
    
    const answer = results[1];
    
    if (!answer.success) throw new Error(`LLM failed: ${answer.error}`);
    
    // Must follow alternate physics
    expect(fuzzy.containsAny(answer.rawText, ['vzlétn', 'nahoru', 'odpuz', 'vznesl'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// T6: PARTIAL CONTEXT TEST
// Odvozování z neúplných dat
// ════════════════════════════════════════════════════════════════════════════

describe('🟡 T6: Partial Context Test', () => {
  
  test('T6.1: Výpočet z částečných dat', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'Planeta X má průměr 10 000 km.',
      'Jaký je poloměr planety X?'
    ]);
    
    const answer = results[1];
    
    if (!answer.success) throw new Error(`LLM failed: ${answer.error}`);
    
    // Must compute correctly OR show uncertainty
    // 10000 / 2 = 5000
    const hasCorrectAnswer = fuzzy.containsAny(answer.rawText, ['5000', '5 000']);
    const hasUncertainty = fuzzy.showsUncertainty(answer.rawText);
    
    expect(hasCorrectAnswer || hasUncertainty).toBe(true);
    
    // Must NOT invent random number
    expect(fuzzy.containsNone(answer.rawText, ['6000', '4000', '7000', '3000'])).toBe(true);
  });

  test('T6.2: Chybějící údaj - nedomýšlet', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'Auto značky Y má maximální rychlost 200 km/h.',
      'Kolik váží auto značky Y?'
    ]);
    
    const answer = results[1];
    
    if (!answer.success) throw new Error(`LLM failed: ${answer.error}`);
    
    // Must NOT invent weight
    // Should indicate missing info or uncertainty
    expect(fuzzy.containsAny(answer.rawText, [
      'nevím', 'není uvedeno', 'nemám informaci', 'nezn', 'nelze určit'
    ])).toBe(true);
  });

  test('T6.3: Logické odvození', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'V místnosti je 5 židlí a 3 stoly. Na každé židli sedí jeden člověk.',
      'Kolik lidí je v místnosti?'
    ]);
    
    const answer = results[1];
    
    if (!answer.success) throw new Error(`LLM failed: ${answer.error}`);
    
    // Must derive: 5 people (one per chair)
    expect(fuzzy.containsAny(answer.rawText, ['5', 'pět'])).toBe(true);
  });

  test('T6.4: Matematická operace', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Pokud mám 3 jablka a sním 2, kolik mi zůstane?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must compute: 3 - 2 = 1
    expect(fuzzy.containsAny(result.rawText, ['1', 'jedno'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Context Override Tests');
console.log('━'.repeat(60));
console.log(`📡 LLM: ${LLM_CONFIG.baseUrl}`);
console.log(`🤖 Model: ${LLM_CONFIG.model}`);
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
