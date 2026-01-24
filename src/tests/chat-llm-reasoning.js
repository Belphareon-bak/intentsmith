// C.3 v35.1 Chat LLM E2E Tests - Basic Reasoning
// ══════════════════════════════════════════════════════════════════════════════
// T9: Multi-step Reasoning with Check
//
// Tyto testy ověřují:
// - LLM zvládá základní matematiku
// - LLM zvládá logické odvozování
// - LLM nedělá základní reasoning chyby
//
// ⚠️ Sanity check - should always pass
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import { chatLLM, fuzzy, LLM_CONFIG } from './chat-llm-infra.js';

const SKIP_LLM = process.env.SKIP_LLM === '1';

// ════════════════════════════════════════════════════════════════════════════
// T9: BASIC REASONING
// Jednoduchá matematika a logika
// ════════════════════════════════════════════════════════════════════════════

describe('🧠 T9: Basic Reasoning', () => {
  
  test('T9.1: Jednoduchý odčítání', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Pokud mám 3 jablka a sním 2, kolik mi zůstane?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // 3 - 2 = 1
    expect(fuzzy.containsAny(result.rawText, ['1', 'jedno'])).toBe(true);
    expect(fuzzy.containsNone(result.rawText, ['2', '3', '0', 'dva', 'tři', 'nula'])).toBe(true);
  });

  test('T9.2: Rychlost a čas', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Pokud auto jede rychlostí 60 km/h, kolik km ujede za 30 minut?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // 60 km/h * 0.5h = 30 km
    expect(fuzzy.containsAny(result.rawText, ['30', 'třicet'])).toBe(true);
  });

  test('T9.3: Procenta', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik je 50 % z 200?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // 50% of 200 = 100
    expect(fuzzy.containsAny(result.rawText, ['100', 'sto'])).toBe(true);
  });

  test('T9.4: Logický sylogismus', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Všichni psi jsou savci. Rex je pes. Je Rex savec?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Logical conclusion: Yes
    expect(fuzzy.containsAny(result.rawText, ['ano', 'yes', 'je savec', 'je savc'])).toBe(true);
  });

  test('T9.5: Negace', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Pokud platí, že všechny kočky mají čtyři nohy, a Micka nemá čtyři nohy, je Micka kočka?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Logical conclusion: No (modus tollens)
    expect(fuzzy.containsAny(result.rawText, ['ne', 'není', 'no', 'nemůže být'])).toBe(true);
  });

  test('T9.6: Porovnání', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Anna je starší než Berta. Berta je starší než Cecílie. Kdo je nejmladší?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Transitive: Anna > Berta > Cecílie, so Cecílie is youngest
    expect(fuzzy.containsAny(result.rawText, ['Cecílie', 'Cecilie'])).toBe(true);
  });

  test('T9.7: Množiny', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'V třídě je 20 studentů. 12 hraje fotbal, 8 hraje tenis, 4 hrají obojí. Kolik nehraje ani jedno?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Inclusion-exclusion: 12 + 8 - 4 = 16 playing something
    // 20 - 16 = 4 playing nothing
    expect(fuzzy.containsAny(result.rawText, ['4', 'čtyři'])).toBe(true);
  });

  test('T9.8: Jednoduchá algebra', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Pokud x + 5 = 12, kolik je x?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // x = 12 - 5 = 7
    expect(fuzzy.containsAny(result.rawText, ['7', 'sedm'])).toBe(true);
  });

  test('T9.9: Časové pásmo (základní)', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM(
      'Pokud je v Praze 15:00 a Londýn je o 1 hodinu pozadu, kolik je v Londýně?'
    );
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // Prague 15:00 - 1h = London 14:00
    expect(fuzzy.containsAny(result.rawText, ['14:00', '14 hodin', 'čtrnáct'])).toBe(true);
  });

  test('T9.10: Dělení', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('Kolik je 144 děleno 12?');
    
    if (!result.success) throw new Error(`LLM failed: ${result.error}`);
    
    // 144 / 12 = 12
    expect(fuzzy.containsAny(result.rawText, ['12', 'dvanáct'])).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Basic Reasoning Tests');
console.log('━'.repeat(60));
console.log(`📡 LLM: ${LLM_CONFIG.baseUrl}`);
console.log(`🤖 Model: ${LLM_CONFIG.model}`);
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
