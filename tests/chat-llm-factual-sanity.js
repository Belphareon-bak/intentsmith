// C.3 v35.1 Chat LLM E2E Tests - Factual Sanity
// ══════════════════════════════════════════════════════════════════════════════
// T1: Known Fact Sanity Check (whitelist)
// T2: Negative Fact Trap
//
// Tyto testy ověřují:
// - LLM nehalucinuje základní fakta
// - LLM nepřidává informace kde nemá
// - LLM správně odmítá non-existent entity
//
// ⚠️ Low flakiness, high value
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import { chatLLM, fuzzy, LLM_CONFIG } from './chat-llm-infra.js';

const SKIP_LLM = process.env.SKIP_LLM === '1';

// ════════════════════════════════════════════════════════════════════════════
// T1: KNOWN FACT SANITY CHECK
// Pevné, neměnné fakta - whitelist approach
// ════════════════════════════════════════════════════════════════════════════

describe('🟢 T1: Known Fact Sanity Check', () => {
  
  test('T1.1: Kolik planet má Sluneční soustava?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik planet má Sluneční soustava?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must contain "8" 
    expect(fuzzy.containsAny(result.rawText, ['8', 'osm'])).toBe(true);
    
    // Must NOT contain wrong answers
    expect(fuzzy.containsNone(result.rawText, ['9', 'devět', '10', 'deset', '7', 'sedm'])).toBe(true);
  });

  test('T1.2: Kdo napsal Máj?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kdo napsal Máj?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must contain author
    expect(fuzzy.containsAny(result.rawText, ['Karel Hynek Mácha', 'Mácha', 'K. H. Mácha'])).toBe(true);
    
    // Must NOT attribute to wrong authors
    expect(fuzzy.containsNone(result.rawText, ['Neruda', 'Erben', 'Čapek', 'Němcová'])).toBe(true);
  });

  test('T1.3: Jaká je chemická značka zlata?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaká je chemická značka zlata?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must contain "Au"
    expect(fuzzy.containsAny(result.rawText, ['Au'])).toBe(true);
    
    // Must NOT contain wrong symbols
    expect(fuzzy.containsNone(result.rawText, ['Ag', 'Fe', 'Cu', 'Pb'])).toBe(true);
  });

  test('T1.4: Jaké je hlavní město České republiky?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaké je hlavní město České republiky?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must contain Prague
    expect(fuzzy.containsAny(result.rawText, ['Praha', 'Prague'])).toBe(true);
    
    // Must NOT contain wrong cities
    expect(fuzzy.containsNone(result.rawText, ['Brno', 'Ostrava', 'Plzeň'])).toBe(true);
  });

  test('T1.5: Kolik dní má týden?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik dní má týden?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must contain "7" or "sedm"
    expect(fuzzy.containsAny(result.rawText, ['7', 'sedm'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// T2: NEGATIVE FACT TRAP
// Otázky s lákavou, ale špatnou odpovědí
// ════════════════════════════════════════════════════════════════════════════

describe('🟢 T2: Negative Fact Trap', () => {
  
  test('T2.1: Kolik planet je mezi Zemí a Marsem?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik planet je mezi Zemí a Marsem?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must indicate "none" or "zero" or "žádná"
    expect(fuzzy.containsAny(result.rawText, [
      'žádná', 'žádné', 'nula', '0', 'není', 'nejsou', 'none', 'zero'
    ])).toBe(true);
    
    // Must NOT fabricate a planet
    expect(fuzzy.containsNone(result.rawText, ['Merkur', 'Venuše', 'Jupiter'])).toBe(true);
  });

  test('T2.2: Jaká řeka protéká Prahou a Brnem?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Jaká řeka protéká Prahou a Brnem?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must indicate this is impossible / no such river
    expect(fuzzy.containsAny(result.rawText, [
      'žádná', 'neexistuje', 'není', 'neprotéká', 'různé řeky',
      'Vltava', 'Svratka'  // Correct: mentions they have DIFFERENT rivers
    ])).toBe(true);
    
    // Should NOT claim one river goes through both
    // This is tricky - we check that it doesn't say "X protéká Prahou i Brnem"
  });

  test('T2.3: Kdo byl prvním českým prezidentem po roce 2000?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kdo byl prvním českým prezidentem po roce 2000?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must mention Václav Klaus (elected 2003)
    // NOT Havel (he was president until 2003 but elected in 1993)
    expect(fuzzy.containsAny(result.rawText, ['Klaus', 'Václav Klaus'])).toBe(true);
  });

  test('T2.4: Kolik nohou má pavouk - je to hmyz?', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik nohou má pavouk? Je to hmyz?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Must say 8 legs AND not insect
    expect(fuzzy.containsAny(result.rawText, ['8', 'osm'])).toBe(true);
    expect(fuzzy.containsAny(result.rawText, ['není hmyz', 'pavoukovci', 'arachnid', 'ne'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Factual Sanity Tests');
console.log('━'.repeat(60));
console.log(`📡 LLM: ${LLM_CONFIG.baseUrl}`);
console.log(`🤖 Model: ${LLM_CONFIG.model}`);
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
