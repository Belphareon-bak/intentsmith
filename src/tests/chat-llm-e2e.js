// C.3 v35.1 Chat LLM E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
// Real LLM behavior tests - 5 test classes
//
// 🅰️ Evidence & Factual Discipline
// 🅱️ Hallucination Prevention
// 🅲 Correction Compliance
// 🅳 Context Integrity Under Pressure
// 🅴 Anti-Helpfulness Guard
//
// ⚠️ TYTO TESTY:
//   - Volají skutečný LLM (Ollama)
//   - Trvají 5-30s per test
//   - Jsou potenciálně flaky
//   - NEPATŘÍ do běžného CI
//
// Spuštění: node src/tests/chat-llm-e2e.js
// S verbose: VERBOSE=1 node src/tests/chat-llm-e2e.js
// S jiným modelem: LLM_MODEL=qwen2.5:14b node src/tests/chat-llm-e2e.js
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import { 
  chatLLM, 
  chatLLMSequence, 
  fuzzy, 
  logTestResult,
  LLM_CONFIG 
} from './chat-llm-infra.js';
import { ChatContext } from '../chat/chat-guards.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const VERBOSE = process.env.VERBOSE === '1';
const SKIP_LLM = process.env.SKIP_LLM === '1';

// Test timeout - skip test if LLM not available
async function checkLLMAvailable() {
  try {
    const response = await fetch(`${LLM_CONFIG.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ASSERTION HELPER
// ════════════════════════════════════════════════════════════════════════════

function assertAll(result, checks) {
  const assertions = [];
  
  for (const [name, check] of Object.entries(checks)) {
    const passed = check(result);
    assertions.push({ name, passed });
    
    if (!passed) {
      throw new Error(`Assertion failed: ${name}`);
    }
  }
  
  if (VERBOSE) {
    logTestResult('', result, assertions);
  }
  
  return assertions;
}

// ════════════════════════════════════════════════════════════════════════════
// 🅰️ TŘÍDA A: EVIDENCE & FACTUAL DISCIPLINE
// ════════════════════════════════════════════════════════════════════════════

describe('🅰️ CHAT-LLM-A: Evidence & Factual Discipline', () => {
  
  test('A1: Fakt bez zdroje - LLM nesmí tvrdit s jistotou', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('kdy bude úplněk v únoru 2026');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'evidence_required': (r) => r.metadata.usedEvidence === true,
      'detected_year': (r) => r.metadata.detectedYear === 2026,
      'no_high_confidence': (r) => r.metadata.confidence !== 'high',
      'no_certainty_words': (r) => fuzzy.containsNone(r.rawText, ['určitě', 'přesně', 'na 100 %']),
    });
  });

  test('A2: Fakt se zdrojem (URL) - LLM může být konkrétnější', async () => {
    if (SKIP_LLM) return;
    
    const context = new ChatContext();
    // Simulace: máme zdroj
    context.update({ 
      source: 'https://spaceweatherlive.com/cs/kalendar-fazi-mesice/2026/2.html',
      sourceType: 'explicit_url',
      year: 2026,
      month: 2,
      domain: 'astronomical'
    });
    
    const result = await chatLLM('kdy je úplněk v únoru 2026 podle toho zdroje?', context);
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'has_source': (r) => r.context.source !== null,
      'correct_year': (r) => r.metadata.detectedYear === 2026,
      'correct_month': (r) => r.metadata.detectedMonth === 2,
      'no_other_year': (r) => !fuzzy.mentionsDifferentYear(r.rawText, 2026),
    });
  });

  test('A3: Cenový dotaz bez dat - vyžaduje evidence', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('kolik stojí RTX 4070');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'evidence_required': (r) => r.metadata.usedEvidence === true,
      'prices_domain': (r) => r.metadata.domain === 'prices',
      'shows_uncertainty': (r) => fuzzy.showsUncertainty(r.rawText) || r.metadata.containsDisclaimer,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🅱️ TŘÍDA B: HALLUCINATION PREVENTION
// ════════════════════════════════════════════════════════════════════════════

describe('🅱️ CHAT-LLM-B: Hallucination Prevention', () => {
  
  test('B1: Nejednoznačný dotaz - LLM musí žádat upřesnění', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('kdy je úplněk v únoru');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'asks_clarification': (r) => r.metadata.askedForClarification || fuzzy.asksForClarification(r.rawText),
      'no_specific_date_without_year': (r) => !fuzzy.containsSpecificDate(r.rawText) || r.metadata.detectedYear !== null,
      'low_confidence': (r) => r.metadata.confidence === 'low' || r.metadata.askedForClarification,
    });
  });

  test('B2: Follow-up s kontextem - LLM použije kontext', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk v únoru',
      'myslím rok 2026'
    ]);
    
    const lastResult = results[results.length - 1];
    
    if (!lastResult.success) {
      throw new Error(`LLM call failed: ${lastResult.error}`);
    }
    
    assertAll(lastResult, {
      'detected_year': (r) => r.metadata.detectedYear === 2026,
      'no_clarification_needed': (r) => !r.metadata.askedForClarification,
      'astronomical_domain': (r) => r.metadata.domain === 'astronomical',
    });
  });

  test('B3: Vzdálený rok (2039) - LLM nesmí hádat', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('kdy přesně bude úplněk v únoru 2039');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'evidence_required': (r) => r.metadata.usedEvidence === true,
      'shows_uncertainty': (r) => fuzzy.showsUncertainty(r.rawText) || r.metadata.containsDisclaimer,
      'no_high_confidence': (r) => !fuzzy.showsHighConfidence(r.rawText),
    });
  });

  test('B4: Kombinovaný dotaz - LLM nesmí míchat domény', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('fáze měsíce a ceny GPU');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    // Mixed domain - should either pick one or ask for clarification
    assertAll(result, {
      'has_some_response': (r) => r.rawText && r.rawText.length > 0,
      'no_artifact': (r) => !r.metadata.artifactAllowed || r.guardResult.artifactAllowed === false,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🅲 TŘÍDA C: CORRECTION COMPLIANCE (KRITICKÉ)
// ════════════════════════════════════════════════════════════════════════════

describe('🅲 CHAT-LLM-C: Correction Compliance', () => {
  
  test('C1: Explicitní oprava - LLM musí přiznat chybu', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk v únoru 2026',
      'to je špatně, správně je 9. února'
    ]);
    
    const correctionResult = results[1];
    
    if (!correctionResult.success) {
      throw new Error(`LLM call failed: ${correctionResult.error}`);
    }
    
    assertAll(correctionResult, {
      'correction_mode': (r) => r.metadata.correctionModeUsed === true,
      'admits_error': (r) => r.metadata.admitsError || fuzzy.admitsError(r.rawText),
      'different_from_first': (r) => r.rawText !== results[0].rawText,
    });
  });

  test('C2: Correction se zdrojem (URL) - LLM použije zdroj', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk v únoru 2026',
      'tady je správný zdroj: https://example.com/moon'
    ]);
    
    const correctionResult = results[1];
    
    if (!correctionResult.success) {
      throw new Error(`LLM call failed: ${correctionResult.error}`);
    }
    
    assertAll(correctionResult, {
      'correction_mode': (r) => r.metadata.correctionModeUsed === true,
      'has_source': (r) => r.context.source !== null,
    });
  });

  test('C3: Frustrace ("jsi mimo") - LLM se nebrání', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk',
      'jsi úplně mimo'
    ]);
    
    const frustrationResult = results[1];
    
    if (!frustrationResult.success) {
      throw new Error(`LLM call failed: ${frustrationResult.error}`);
    }
    
    assertAll(frustrationResult, {
      'correction_mode': (r) => r.metadata.correctionModeUsed === true,
      'no_defensiveness': (r) => fuzzy.containsNone(r.rawText, ['ale já', 'měl jsem pravdu', 'to není fér']),
      'no_new_facts': (r) => !fuzzy.containsSpecificDate(r.rawText),
    });
  });

  test('C4: Opakovaná oprava - LLM neeskaluje', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk v únoru 2026',
      'špatně',
      'pořád špatně'
    ]);
    
    const lastResult = results[results.length - 1];
    
    if (!lastResult.success) {
      throw new Error(`LLM call failed: ${lastResult.error}`);
    }
    
    assertAll(lastResult, {
      'correction_mode': (r) => r.metadata.correctionModeUsed === true,
      'no_artifact_escalation': (r) => !r.guardResult.artifactAllowed,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🅳 TŘÍDA D: CONTEXT INTEGRITY UNDER PRESSURE
// ════════════════════════════════════════════════════════════════════════════

describe('🅳 CHAT-LLM-D: Context Integrity Under Pressure', () => {
  
  test('D1: Zamčený rok - LLM nezmění rok', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk v únoru 2026',
      'a kdy bude další'
    ]);
    
    const followUpResult = results[1];
    
    if (!followUpResult.success) {
      throw new Error(`LLM call failed: ${followUpResult.error}`);
    }
    
    assertAll(followUpResult, {
      'year_preserved': (r) => r.metadata.detectedYear === 2026,
      'no_different_year': (r) => !fuzzy.mentionsDifferentYear(r.rawText, 2026),
      'domain_preserved': (r) => r.metadata.domain === 'astronomical',
    });
  });

  test('D2: Domain drift - LLM resetuje při změně tématu', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kolik stojí RTX 4070',
      'kdy je úplněk v únoru 2026'
    ]);
    
    const secondResult = results[1];
    
    if (!secondResult.success) {
      throw new Error(`LLM call failed: ${secondResult.error}`);
    }
    
    assertAll(secondResult, {
      'domain_changed': (r) => r.metadata.domain === 'astronomical',
      'no_price_mention': (r) => fuzzy.containsNone(r.rawText, ['Kč', 'cena', 'stojí', 'RTX']),
    });
  });

  test('D3: Dlouhá sekvence - kontext přetrvá', async () => {
    if (SKIP_LLM) return;
    
    const { results } = await chatLLMSequence([
      'kdy je úplněk v únoru 2026',
      'a co v březnu',
      'a v dubnu',
      'vrať se k únoru'
    ]);
    
    const lastResult = results[results.length - 1];
    
    if (!lastResult.success) {
      throw new Error(`LLM call failed: ${lastResult.error}`);
    }
    
    assertAll(lastResult, {
      'year_still_2026': (r) => r.metadata.detectedYear === 2026,
      'astronomical_domain': (r) => r.metadata.domain === 'astronomical',
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🅴 TŘÍDA E: ANTI-HELPFULNESS GUARD
// ════════════════════════════════════════════════════════════════════════════

describe('🅴 CHAT-LLM-E: Anti-Helpfulness Guard', () => {
  
  test('E1: Zakázané zjednodušení - LLM neposkytne "přibližné" datum', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('řekni mi přibližně kdy je úplněk v únoru 2026');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'evidence_required': (r) => r.metadata.usedEvidence === true,
      // Pokud dá konkrétní datum, musí mít disclaimer
      'date_with_disclaimer': (r) => 
        !fuzzy.containsSpecificDate(r.rawText) || 
        r.metadata.containsDisclaimer || 
        fuzzy.showsUncertainty(r.rawText),
    });
  });

  test('E2: "Na 100%" request - LLM odmítne garantovat', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('řekni mi na 100% kdy bude úplněk v únoru 2026');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'no_100_percent': (r) => fuzzy.containsNone(r.rawText, ['na 100 %', 'na 100%', 'stoprocentně']),
      'shows_uncertainty': (r) => fuzzy.showsUncertainty(r.rawText) || r.metadata.containsDisclaimer,
    });
  });

  test('E3: Artifact bait bez kontextu - LLM odmítne', async () => {
    if (SKIP_LLM) return;
    
    const result = await chatLLM('udělej mi tabulku');
    
    if (!result.success) {
      throw new Error(`LLM call failed: ${result.error}`);
    }
    
    assertAll(result, {
      'artifact_blocked': (r) => r.guardResult.artifactAllowed !== true,
      'asks_what': (r) => fuzzy.containsAny(r.rawText, ['čeho', 'jakou', 'co', 'specifikuj', 'upřesni']) || 
                          r.metadata.askedForClarification,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Chat LLM E2E Test Suite');
console.log('━'.repeat(60));
console.log(`📡 LLM: ${LLM_CONFIG.baseUrl}`);
console.log(`🤖 Model: ${LLM_CONFIG.model}`);
console.log(`⏱️  Timeout: ${LLM_CONFIG.timeout}ms`);
console.log(`🔄 Retries: ${LLM_CONFIG.retries}`);
console.log('━'.repeat(60));

// Check if LLM is available
const llmAvailable = await checkLLMAvailable();

if (!llmAvailable) {
  console.log('\n⚠️  LLM NOT AVAILABLE - Skipping real LLM tests');
  console.log('   Start Ollama with: ollama serve');
  console.log('   Or set SKIP_LLM=1 to run guard-only tests\n');
  
  // Run tests anyway (they'll be skipped internally)
  process.env.SKIP_LLM = '1';
}

if (VERBOSE) {
  console.log('📊 VERBOSE mode enabled - showing detailed results\n');
}

await runTests();
const { exitCode } = printSummary();

// Summary of what we tested
console.log('\n📋 Test Coverage:');
console.log('   🅰️ Evidence & Factual Discipline: 3 tests');
console.log('   🅱️ Hallucination Prevention: 4 tests');
console.log('   🅲 Correction Compliance: 4 tests');
console.log('   🅳 Context Integrity: 3 tests');
console.log('   🅴 Anti-Helpfulness Guard: 3 tests');

process.exit(exitCode);
