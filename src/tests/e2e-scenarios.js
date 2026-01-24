// C.3 v35.1 E2E Test Scenarios
// ══════════════════════════════════════════════════════════════════════════════
// 10 konkrétních testů pro P0 guardy
// Spuštění: node src/tests/e2e-scenarios.js
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, printSummary, runTests } from './e2e-runner.js';
import {
  createTestContext,
  simulateUserMessage,
  FIXTURES
} from './e2e-helpers.js';

// ════════════════════════════════════════════════════════════════════════════
// E2E-01: Fakta s časovým ukotvením
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-01: Fakta s časovým ukotvením', () => {
  test('kdy bude úplněk v únoru 2026 → problemType=factual', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'kdy bude úplněk v únoru 2026');
    
    // Must be classified as factual, NOT price_range
    expect(result.classification.problemType).toBe('factual');
    expect(result.classification.confidence).toBeGreaterThan(0.5);
    expect(result.classification.requiresEvidence).toBe(true);
  });

  test('kontext obsahuje rok a měsíc', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'kdy bude úplněk v únoru 2026');
    const context = ctx.contextManager.getContextLock();
    
    expect(context).toHaveProperty('year');
    expect(context.year).toBe(2026);
    expect(context).toHaveProperty('month');
    expect(context.month).toBe(2);
    expect(context.domain).toBe('astronomical');
  });

  test('nesmí generovat artefakt pro faktický dotaz', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'kdy bude úplněk v únoru 2026');
    
    expect(result.artifactEligible).toBe(false);
    expect(ctx.artifactPipeline.wasBlockedWith('ARTIFACT_BLOCKED_BY_CONTEXT')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-02: Follow-up zpřesnění (context carry)
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-02: Follow-up zpřesnění', () => {
  test('kontext se přenáší mezi zprávami', async () => {
    const ctx = createTestContext();
    
    // První zpráva
    simulateUserMessage(ctx, 'jaké jsou fáze měsíce v únoru');
    const context1 = ctx.contextManager.getContextLock();
    
    expect(context1.month).toBe(2);
    expect(context1.domain).toBe('astronomical');
    
    // Follow-up zpřesnění
    simulateUserMessage(ctx, 'myslím rok 2026');
    const context2 = ctx.contextManager.getContextLock();
    
    // Rok se přidal, měsíc zůstal
    expect(context2.year).toBe(2026);
    expect(context2.month).toBe(2);
    expect(context2.domain).toBe('astronomical');
  });

  test('zpřesnění nemění problemType', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'jaké jsou fáze měsíce v únoru');
    const class1 = ctx.decisionLayer.getLastClassification();
    
    simulateUserMessage(ctx, 'myslím rok 2026');
    const class2 = ctx.decisionLayer.getLastClassification();
    
    expect(class1.result.problemType).toBe(class2.result.problemType);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-03: Explicitní URL = autorita
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-03: Explicitní URL = autorita', () => {
  test('URL se extrahuje do kontextu', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'https://www.spaceweatherlive.com/cs/kalendar-fazi-mesice/2026/2.html');
    const context = ctx.contextManager.getContextLock();
    
    expect(context).toHaveProperty('source');
    expect(context.source).toContain('spaceweatherlive.com');
    expect(context.sourceType).toBe('explicit_url');
  });

  test('explicitní URL vyžaduje web fetch', async () => {
    const ctx = createTestContext();
    
    // Mock web search response
    ctx.webSearch.mockResponse('spaceweatherlive.com', JSON.stringify(FIXTURES.moonPhasesFeb2026.data));
    
    const result = simulateUserMessage(ctx, 'https://www.spaceweatherlive.com/cs/kalendar-fazi-mesice/2026/2.html');
    
    // URL přítomna → vyžaduje fetch
    expect(result.context.source).toBeTruthy();
    expect(result.context.sourceType).toBe('explicit_url');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-04: Oprava uživatelem ("jsi mimo")
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-04: Oprava uživatelem', () => {
  test('detekuje correction trigger fráze', async () => {
    const ctx = createTestContext();
    
    const triggers = [
      'jsi mimo',
      'jsi úplně mimo',
      'ne, myslel jsem',
      'tady je zdroj',
      'špatně'
    ];
    
    for (const trigger of triggers) {
      ctx.conversation.reset();
      const result = simulateUserMessage(ctx, `${trigger}, správná odpověď je jiná`);
      expect(result.correction.triggered).toBe(true);
    }
  });

  test('aktivuje correction mode', async () => {
    const ctx = createTestContext();
    
    // Předchozí odpověď
    simulateUserMessage(ctx, 'kdy je úplněk');
    expect(ctx.conversation.correctionMode).toBe(false);
    
    // Oprava
    simulateUserMessage(ctx, 'jsi úplně mimo, tady je správný zdroj');
    expect(ctx.conversation.correctionMode).toBe(true);
  });

  test('correction mode invaliduje předchozí odhad', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'kdy je úplněk');
    const classBefore = ctx.decisionLayer.getLastClassification();
    
    simulateUserMessage(ctx, 'jsi mimo');
    
    // V correction mode by se měla změnit strategie
    expect(ctx.conversation.correctionMode).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-05: Zákaz artefaktů u faktických dotazů
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-05: Zákaz artefaktů u faktů', () => {
  test('faktický dotaz blokuje artifact pipeline', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'kdy je úplněk v únoru 2026');
    
    expect(result.artifactEligible).toBe(false);
    expect(ctx.artifactPipeline.wasBlockedWith('ARTIFACT_BLOCKED_BY_CONTEXT')).toBe(true);
  });

  test('chat dotaz také blokuje artifact', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'ahoj, jak se máš');
    
    expect(result.classification.problemType).toBe('chat');
    expect(result.artifactEligible).toBe(false);
  });

  test('cenový dotaz povoluje artifact', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'kolik stojí RTX 4070');
    
    expect(result.classification.problemType).toBe('price_range');
    expect(result.artifactEligible).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-06: Chybný problemType guard
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-06: ProblemType Hard Guard', () => {
  test('fáze měsíce NESMÍ být price_range', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'fáze měsíce v únoru 2026');
    
    expect(result.classification.problemType).not.toBe('price_range');
    expect(result.classification.problemType).toBe('factual');
  });

  test('kdy bude úplněk NESMÍ být price_range', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'kdy bude úplněk');
    
    expect(result.classification.problemType).not.toBe('price_range');
  });

  test('price_range vyžaduje cenový indikátor', async () => {
    const ctx = createTestContext();
    
    // Bez cenového indikátoru
    const r1 = simulateUserMessage(ctx, 'info o RTX 4070');
    expect(r1.classification.problemType).not.toBe('price_range');
    
    ctx.conversation.reset();
    ctx.decisionLayer.reset();
    
    // S cenovým indikátorem
    const r2 = simulateUserMessage(ctx, 'kolik stojí RTX 4070');
    expect(r2.classification.problemType).toBe('price_range');
  });

  test('confidence threshold - nízká confidence = fallback', async () => {
    const ctx = createTestContext();
    
    // Faktický dotaz by měl mít vysokou confidence
    const result = simulateUserMessage(ctx, 'kdy bude úplněk v únoru 2026');
    
    expect(result.classification.confidence).toBeGreaterThan(0.5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-07: Domain contamination
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-07: Domain Contamination', () => {
  test('změna domény resetuje kontext', async () => {
    const ctx = createTestContext();
    
    // První doména: ceny/GPU
    simulateUserMessage(ctx, 'kolik stojí RTX 4070');
    ctx.dataLayer.activateSource('gpu_source');
    expect(ctx.contextManager.getContextLock().domain).toBe('prices');
    expect(ctx.dataLayer.isActive('gpu_source')).toBe(true);
    
    // Změna domény: astronomie
    const result = simulateUserMessage(ctx, 'fáze měsíce v únoru');
    
    // GPU source musí být deaktivován
    expect(result.contamination.contaminated).toBe(true);
    expect(ctx.dataLayer.isActive('gpu_source')).toBe(false);
    expect(ctx.contextManager.getContextLock().domain).toBe('astronomical');
  });

  test('stejná doména neprovádí reset', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'kdy bude úplněk v únoru');
    const context1 = ctx.contextManager.getContextLock();
    
    const result = simulateUserMessage(ctx, 'a kdy v březnu');
    
    expect(result.contamination.contaminated).toBe(false);
    // Doména zůstává
    expect(ctx.contextManager.getContextLock().domain).toBe('astronomical');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-08: Web search freshness
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-08: Web Search Freshness', () => {
  test('aktuální dotaz vyžaduje evidence', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'aktuální fáze měsíce');
    
    expect(result.classification.requiresEvidence).toBe(true);
  });

  test('dotaz s rokem vyžaduje evidence', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'úplněk v únoru 2026');
    
    expect(result.classification.requiresEvidence).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-09: User correction without URL
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-09: User Correction Without URL', () => {
  test('oprava měsíce zachová problemType', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'fáze měsíce v listopadu');
    const class1 = ctx.decisionLayer.getLastClassification();
    
    // Oprava bez URL
    simulateUserMessage(ctx, 'ne, myslím únor 2026, ne listopad');
    const class2 = ctx.decisionLayer.getLastClassification();
    
    // ProblemType zůstává stejný (factual)
    expect(class1.result.problemType).toBe('factual');
    expect(class2.result.problemType).toBe('factual');
  });

  test('oprava aktualizuje kontext', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'fáze měsíce v listopadu');
    expect(ctx.contextManager.getContextLock().month).toBe(11);
    
    // Oprava na únor
    simulateUserMessage(ctx, 'ne, myslím únor 2026');
    const context = ctx.contextManager.getContextLock();
    
    expect(context.month).toBe(2);
    expect(context.year).toBe(2026);
  });

  test('oprava blokuje artifact', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'fáze měsíce');
    const result = simulateUserMessage(ctx, 'ne, myslím únor 2026, ne listopad');
    
    expect(result.artifactEligible).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E2E-10: Artifact Hard Guard
// ════════════════════════════════════════════════════════════════════════════

describe('E2E-10: Artifact Hard Guard', () => {
  test('faktický dotaz s pokusem o PDF = BLOCKED', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'kdy je úplněk v únoru 2026');
    
    // Pokus o generování artefaktu
    const artifactResult = ctx.artifactPipeline.generate('pdf', { title: 'Fáze měsíce' });
    
    // Pipeline byla zablokována dříve
    expect(ctx.artifactPipeline.wasBlockedWith('ARTIFACT_BLOCKED_BY_CONTEXT')).toBe(true);
  });

  test('blocked log obsahuje správný důvod', async () => {
    const ctx = createTestContext();
    
    simulateUserMessage(ctx, 'kdy je úplněk');
    
    const blocked = ctx.artifactPipeline.getBlocked();
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].reason).toBe('ARTIFACT_BLOCKED_BY_CONTEXT');
  });

  test('cenový dotaz NEBLOKUJE artifact', async () => {
    const ctx = createTestContext();
    
    const result = simulateUserMessage(ctx, 'vytvoř tabulku cen GPU od 10000 do 30000 Kč');
    
    expect(result.artifactEligible).toBe(true);
    expect(ctx.artifactPipeline.wasBlockedWith('ARTIFACT_BLOCKED_BY_CONTEXT')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 E2E Test Suite v35.1');
console.log('━'.repeat(60));

// Execute tests and print summary
await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
