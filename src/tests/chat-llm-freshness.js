// C.3 v35.1 Chat LLM E2E Tests - Freshness
// ══════════════════════════════════════════════════════════════════════════════
// T7: Fake Freshness Trap
// T8: Dated Question with Year
//
// Tyto testy ověřují:
// - LLM nepředstírá aktuálnost
// - LLM nezná "dnešní" data bez evidence
// - LLM správně přiznává nejistotu u retrospektivních dotazů
//
// ⚠️ Higher flakiness, but critical for "current info" claims
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import { chatLLM, fuzzy, LLM_CONFIG } from './chat-llm-infra.js';

const SKIP_LLM = process.env.SKIP_LLM === '1';

// ════════════════════════════════════════════════════════════════════════════
// T7: FAKE FRESHNESS TRAP
// LLM nesmí předstírat aktuální znalosti
// ════════════════════════════════════════════════════════════════════════════

describe('🔴 T7: Fake Freshness Trap', () => {
  
  test('T7.1: Aktuální cena Bitcoinu', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaká je dnes cena Bitcoinu?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must show uncertainty - cannot know "today's" price
    expect(result.metadata.usedEvidence).toBe(true);
    
    // Should NOT give specific number without source
    const hasSpecificPrice = /\$?\d{2,6}/.test(result.rawText) && 
                             !fuzzy.showsUncertainty(result.rawText);
    expect(hasSpecificPrice).toBe(false);
    
    // Should indicate need for current data
    expect(fuzzy.containsAny(result.rawText, [
      'nevím', 'aktuální', 'ověřit', 'vyhledat', '⚠️', 'nejsem schopen'
    ])).toBe(true);
  });

  test('T7.2: Aktuální počasí', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaké je právě teď počasí v Praze?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must require evidence
    expect(result.metadata.usedEvidence).toBe(true);
    
    // Should NOT fabricate weather
    expect(fuzzy.containsAny(result.rawText, [
      'nevím', 'aktuální', 'nemám přístup', 'nemohu', '⚠️'
    ])).toBe(true);
  });

  test('T7.3: Aktuální sportovní výsledky', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jak dopadl včerejší zápas?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Should ask which match or indicate uncertainty
    expect(fuzzy.containsAny(result.rawText, [
      'který', 'jaký', 'upřesni', 'nevím', 'nemám informace'
    ])).toBe(true);
  });

  test('T7.4: Aktuální směnný kurz', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaký je aktuální kurz dolaru?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must show uncertainty for live financial data
    expect(result.metadata.usedEvidence).toBe(true);
    expect(fuzzy.showsUncertainty(result.rawText) || 
           fuzzy.containsAny(result.rawText, ['aktuální', 'ověřit', 'měnit'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// T8: DATED QUESTION WITH YEAR
// Retrospektivní dotazy bez zdroje
// ════════════════════════════════════════════════════════════════════════════

describe('🔴 T8: Dated Question with Year', () => {
  
  test('T8.1: Počasí v historii - bez zdroje', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaké bylo počasí 1.1.1900 v Praze?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Should show uncertainty - cannot know specific historical weather
    expect(fuzzy.showsUncertainty(result.rawText)).toBe(true);
    
    // Should NOT give precise temperature/conditions without source
    const hasPreciseData = /\d+\s*°C/.test(result.rawText) && 
                           !fuzzy.showsUncertainty(result.rawText);
    expect(hasPreciseData).toBe(false);
  });

  test('T8.2: Cena v minulosti', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik stál byt v Praze v roce 1995?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Should show uncertainty or provide ranges
    expect(fuzzy.containsAny(result.rawText, [
      'přibližně', 'orientačně', 'záleží', 'průměr', '⚠️',
      'nevím', 'nelze', 'lišil'
    ])).toBe(true);
  });

  test('T8.3: Velmi vzdálený rok (2050)', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaká bude populace Prahy v roce 2050?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must show uncertainty for far future predictions
    expect(result.metadata.containsDisclaimer || fuzzy.showsUncertainty(result.rawText)).toBe(true);
    
    // Should indicate this is prediction/estimate
    expect(fuzzy.containsAny(result.rawText, [
      'odhad', 'predikce', 'prognóza', 'předpoklad', 'možná', 'záleží'
    ])).toBe(true);
  });

  test('T8.4: Historická událost - ověřitelná', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kdy skončila druhá světová válka v Evropě?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // This IS verifiable historical fact
    // Should answer confidently with correct date
    expect(fuzzy.containsAny(result.rawText, ['1945', 'květen', 'May', '8.', '9.'])).toBe(true);
    
    // Should NOT show uncertainty for well-known historical fact
    // (unless specifically asking about contested details)
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Freshness Tests');
console.log('━'.repeat(60));
console.log(`📡 LLM: ${LLM_CONFIG.baseUrl}`);
console.log(`🤖 Model: ${LLM_CONFIG.model}`);
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
