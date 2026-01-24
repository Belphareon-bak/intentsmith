// C.3 v35.1 Chat E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
// P0.0 - CHAT CORRECTNESS MODE
// 8 uživatelských scénářů pro testování chat behavior
// Spuštění: node src/tests/chat-e2e.js
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import {
  ChatContext,
  detectFactualQuery,
  extractContext,
  checkDomainContamination,
  detectAmbiguousQuery,
  detectCorrectionTrigger,
  detectArtifactRequest,
  canGenerateArtifact,
  runChatGuards,
  postProcessResponse
} from '../chat/chat-guards.js';

// ════════════════════════════════════════════════════════════════════════════
// HELPER: Simulace chat sekvence
// ════════════════════════════════════════════════════════════════════════════

function simulateChatSequence(messages) {
  const context = new ChatContext();
  const results = [];
  
  for (const msg of messages) {
    const guardResult = runChatGuards(msg, context);
    results.push({
      message: msg,
      guardResult,
      contextLock: context.get(),
      correctionMode: context.correctionMode,
      evidenceRequired: context.evidenceRequired,
      artifactAllowed: context.artifactAllowed
    });
  }
  
  return { context, results };
}

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 1: FACT DRIFT
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-01: Fact Drift Prevention', () => {
  test('kontext roku se zachová přes zprávy', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk',
      'v únoru',
      'v roce 2026'
    ]);
    
    // Po třetí zprávě musí být rok uzamčen
    expect(results[2].contextLock.year).toBe(2026);
    expect(results[2].contextLock.month).toBe(2);
  });

  test('rok se NESMÍ ztratit při follow-up dotazu', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'a kdy v březnu'  // Follow-up BEZ roku
    ]);
    
    // Rok musí zůstat 2026
    expect(results[1].contextLock.year).toBe(2026);
    expect(results[1].contextLock.month).toBe(3);  // Měsíc se změnil
  });

  test('měsíc se NESMÍ ztratit při upřesnění roku', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru',
      'myslím rok 2026'
    ]);
    
    // Měsíc musí zůstat únor
    expect(results[1].contextLock.month).toBe(2);
    expect(results[1].contextLock.year).toBe(2026);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 2: CORRECTION
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-02: Correction Mode', () => {
  test('oprava NESMÍ resetovat téma', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'ne, myslím březen'
    ]);
    
    // Correction mode musí být aktivní
    expect(results[1].correctionMode).toBe(true);
    // Rok zůstává, mění se jen měsíc
    expect(results[1].contextLock.year).toBe(2026);
    expect(results[1].contextLock.month).toBe(3);
  });

  test('všechny correction triggery fungují', async () => {
    const triggers = [
      'jsi mimo',
      'jsi úplně mimo',
      'ne, myslel jsem něco jiného',
      'tady je zdroj',
      'špatně'
    ];
    
    for (const trigger of triggers) {
      const result = detectCorrectionTrigger(trigger);
      expect(result.triggered).toBe(true);
    }
  });

  test('běžná zpráva NEAKTIVUJE correction mode', async () => {
    const result = detectCorrectionTrigger('kdy je úplněk');
    expect(result.triggered).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 3: EXPLICITNÍ ZDROJ
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-03: Explicit Source Handling', () => {
  test('URL se extrahuje do kontextu', async () => {
    const { results } = simulateChatSequence([
      'tady je zdroj: https://www.spaceweatherlive.com/cs/kalendar-fazi-mesice/2026/2.html'
    ]);
    
    expect(results[0].contextLock.source).toContain('spaceweatherlive.com');
    expect(results[0].contextLock.sourceType).toBe('explicit_url');
  });

  test('URL přepíše potřebu evidence', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',  // Evidence required
      'https://www.spaceweatherlive.com/cs/kalendar-fazi-mesice/2026/2.html'  // Zdroj dodán
    ]);
    
    // Po dodání zdroje máme source
    expect(results[1].contextLock.source).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 4: NEJISTOTA
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-04: Uncertainty Handling', () => {
  test('faktický dotaz vyžaduje evidence', async () => {
    const result = detectFactualQuery('kdy přesně bude úplněk v únoru 2026');
    
    expect(result.isFactual).toBe(true);
    expect(result.requiresEvidence).toBe(true);
  });

  test('obecný dotaz NEVYžaduje evidence', async () => {
    const result = detectFactualQuery('jak se máš');
    
    expect(result.isFactual).toBe(false);
    expect(result.requiresEvidence).toBe(false);
  });

  test('cenový dotaz vyžaduje evidence', async () => {
    const result = detectFactualQuery('kolik stojí RTX 4070');
    
    expect(result.isFactual).toBe(true);
    expect(result.requiresEvidence).toBe(true);
  });

  test('datum dotaz vyžaduje evidence', async () => {
    const result = detectFactualQuery('jaké je datum Velikonoc 2026');
    
    expect(result.isFactual).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 5: MULTI-TOPIC
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-05: Multi-Topic / Domain Contamination', () => {
  test('změna tématu resetuje kontext', async () => {
    const { context, results } = simulateChatSequence([
      'kolik stojí RTX 4070',  // prices domain
      'kdy je úplněk v únoru'  // astronomical domain
    ]);
    
    // Domain se změnil
    expect(results[0].contextLock.domain).toBe('prices');
    expect(results[1].contextLock.domain).toBe('astronomical');
    
    // Contamination warning
    expect(results[1].guardResult.warnings.some(w => w.includes('Domain change'))).toBe(true);
  });

  test('stejné téma NERESETUJE kontext', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'a kdy bude nov'
    ]);
    
    // Zůstáváme v astronomical domain
    expect(results[1].contextLock.domain).toBe('astronomical');
    expect(results[1].contextLock.year).toBe(2026);
  });

  test('prices a astronomical jsou různé domény', async () => {
    const contamination = checkDomainContamination('astronomical', { domain: 'prices' });
    
    expect(contamination.contaminated).toBe(true);
    expect(contamination.action).toBe('RESET_CONTEXT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 6: USER FRUSTRATION
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-06: User Frustration / Correction', () => {
  test('"jsi úplně mimo" aktivuje correction mode', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk',
      'jsi úplně mimo, správně je to 9. února'
    ]);
    
    expect(results[1].correctionMode).toBe(true);
  });

  test('correction mode se reflektuje v post-processingu', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const processed = postProcessResponse(
      'Úplněk je 9. února 2026.',
      'oprav to',
      context,
      { addDisclaimer: false }
    );
    
    expect(processed).toContain('Opravuji');
  });

  test('po correction odpovědi se mode vypne', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    postProcessResponse('Odpověď', 'query', context, {});
    
    expect(context.correctionMode).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 7: AMBIGUOUS QUESTION
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-07: Ambiguous Question Handling', () => {
  test('časový dotaz BEZ roku vyžaduje upřesnění (první dotaz)', async () => {
    const context = new ChatContext();
    const ambiguity = detectAmbiguousQuery('kdy bude úplněk', context);
    
    expect(ambiguity.isAmbiguous).toBe(true);
    expect(ambiguity.issues.some(i => i.type === 'MISSING_YEAR')).toBe(true);
  });

  test('časový dotaz S rokem v kontextu je OK', async () => {
    const context = new ChatContext();
    context.update({ year: 2026 });
    
    const ambiguity = detectAmbiguousQuery('kdy bude úplněk', context);
    
    // Máme rok v kontextu, není ambiguous
    expect(ambiguity.issues.some(i => i.type === 'MISSING_YEAR')).toBe(false);
  });

  test('guard vrací ASK_CLARIFICATION pro první ambiguous dotaz', async () => {
    const context = new ChatContext();
    const result = runChatGuards('kdy bude úplněk', context);
    
    // Pro první dotaz bez kontextu by měl požádat o upřesnění
    // (pokud není žádná doména locked)
    expect(result.action).toBe('ASK_CLARIFICATION');
    expect(result.response).toContain('Který rok');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SCÉNÁŘ 8: ARTIFACT BAIT
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-08: Artifact Bait Prevention', () => {
  test('artifact vyžaduje EXPLICITNÍ příkaz', async () => {
    const context = new ChatContext();
    
    // Implicitní "tabulka" bez příkazu
    const result1 = canGenerateArtifact('tady jsou data v tabulce', context);
    expect(result1.allowed).toBe(false);
    expect(result1.reason).toBe('NO_EXPLICIT_REQUEST');
    
    // Explicitní příkaz
    const request = detectArtifactRequest('vygeneruj PDF s těmito daty');
    expect(request.requested).toBe(true);
  });

  test('"udělej z toho tabulku" BEZ dat je zablokováno', async () => {
    const { results } = simulateChatSequence([
      'udělej z toho tabulku'  // Žádný kontext, žádná data
    ]);
    
    // Artifact není povolen (nemáme explicitní formát a evidence)
    expect(results[0].artifactAllowed).toBe(false);
  });

  test('faktický dotaz + artifact request je zablokován bez evidence', async () => {
    const context = new ChatContext();
    context.setEvidenceRequired(true);  // Faktický dotaz
    
    const result = canGenerateArtifact('vygeneruj PDF s fázemi měsíce', context);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('FACTUAL_WITHOUT_EVIDENCE');
  });

  test('artifact S evidencí je povolen', async () => {
    const context = new ChatContext();
    context.update({ source: 'https://example.com/data' });
    context.setEvidenceRequired(false);
    
    const result = canGenerateArtifact('vygeneruj PDF s těmito daty', context);
    
    expect(result.allowed).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BONUS: EDGE CASES
// ════════════════════════════════════════════════════════════════════════════

describe('CHAT-EDGE: Edge Cases', () => {
  test('prázdná zpráva nepadá', async () => {
    const context = new ChatContext();
    const result = runChatGuards('', context);
    
    expect(result.proceed).toBe(true);
  });

  test('velmi dlouhá zpráva nepadá', async () => {
    const context = new ChatContext();
    const longMessage = 'test '.repeat(1000);
    const result = runChatGuards(longMessage, context);
    
    expect(result.proceed).toBe(true);
  });

  test('speciální znaky nepadají', async () => {
    const context = new ChatContext();
    const result = runChatGuards('test <script>alert(1)</script> {{template}}', context);
    
    expect(result.proceed).toBe(true);
  });

  test('kontext se dá resetovat', async () => {
    const context = new ChatContext();
    context.update({ year: 2026, month: 2, domain: 'astronomical' });
    
    context.reset();
    
    expect(context.get().year).toBe(null);
    expect(context.get().month).toBe(null);
    expect(context.get().domain).toBe(null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Chat E2E Tests - P0.0 CHAT CORRECTNESS');
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
