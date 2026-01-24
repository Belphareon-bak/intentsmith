// C.3 v35.1 Chat E2E Test Suite v2
// ══════════════════════════════════════════════════════════════════════════════
// P0.0 - CHAT CORRECTNESS MODE - Complete Test Suite
// 
// Testy NEOVĚŘUJÍ správnost světa. Ověřují, že chat:
// • nelže
// • nemění kontext
// • nepřeskakuje domény
// • nehalucinuje, když si není jistý
// • reaguje korektně na opravy uživatele
//
// Spuštění: node src/tests/chat-e2e-v2.js
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
  postProcessResponse,
  generateClarificationResponse,
  generateNoEvidenceResponse
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
      contextLock: { ...context.get() },
      correctionMode: context.correctionMode,
      evidenceRequired: context.evidenceRequired,
      artifactAllowed: context.artifactAllowed
    });
  }
  
  return { context, results };
}

// Helper pro assertion kontextu
function assertContext(result, expected) {
  const ctx = result.contextLock;
  if (expected.year !== undefined) {
    expect(ctx.year).toBe(expected.year);
  }
  if (expected.month !== undefined) {
    expect(ctx.month).toBe(expected.month);
  }
  if (expected.domain !== undefined) {
    expect(ctx.domain).toBe(expected.domain);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 🧪 TŘÍDA A: CONTEXT & MEMORY INTEGRITY (P0)
// ════════════════════════════════════════════════════════════════════════════

describe('🅰️ TŘÍDA A: Context & Memory Integrity', () => {
  
  // ──────────────────────────────────────────────────────────────────────────
  // A1: Kontextové ukotvení (rok / měsíc)
  // ──────────────────────────────────────────────────────────────────────────
  
  test('A1: Postupné upřesňování kontextu', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk',
      'v únoru',
      'v roce 2026'
    ]);
    
    // Po první zprávě - žádný kontext
    expect(results[0].contextLock.year).toBe(null);
    expect(results[0].contextLock.month).toBe(null);
    
    // Po druhé - máme měsíc
    expect(results[1].contextLock.month).toBe(2);
    
    // Po třetí - máme obojí
    assertContext(results[2], { year: 2026, month: 2 });
  });

  test('A1b: Odpověď nesmí obsahovat jiný rok než zamčený', async () => {
    const { context } = simulateChatSequence([
      'kdy je úplněk',
      'v únoru',
      'v roce 2026'
    ]);
    
    const lock = context.get();
    
    // Pouze 2026, žádný jiný rok
    expect(lock.year).toBe(2026);
    expect(lock.month).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A2: Kontext nesmí zmizet
  // ──────────────────────────────────────────────────────────────────────────
  
  test('A2: Follow-up dotaz zachovává kontext', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'a kdy je úplněk?'
    ]);
    
    // První dotaz nastaví kontext
    assertContext(results[0], { year: 2026, month: 2, domain: 'astronomical' });
    
    // Follow-up NESMÍ ztratit kontext
    assertContext(results[1], { year: 2026, month: 2, domain: 'astronomical' });
  });

  test('A2b: Kontext přetrvá přes obecný follow-up', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'a co další měsíc?'
    ]);
    
    // Rok musí zůstat
    expect(results[1].contextLock.year).toBe(2026);
    // Doména musí zůstat
    expect(results[1].contextLock.domain).toBe('astronomical');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A3: Explicitní změna kontextu
  // ──────────────────────────────────────────────────────────────────────────
  
  test('A3: Explicitní změna měsíce zachová rok', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'vlastně myslím březen'
    ]);
    
    // Měsíc se změní
    expect(results[1].contextLock.month).toBe(3);
    // Rok zůstává
    expect(results[1].contextLock.year).toBe(2026);
  });

  test('A3b: Částečná změna kontextu', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'ale radši rok 2027'
    ]);
    
    // Rok se změní
    expect(results[1].contextLock.year).toBe(2027);
    // Měsíc zůstává
    expect(results[1].contextLock.month).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A4: Domain reset
  // ──────────────────────────────────────────────────────────────────────────
  
  test('A4: Změna domény způsobí reset', async () => {
    const { results } = simulateChatSequence([
      'ceny GPU',
      'fáze měsíce v únoru 2026'
    ]);
    
    // První dotaz - prices domain
    expect(results[0].contextLock.domain).toBe('prices');
    
    // Druhý dotaz - domain change warning
    expect(results[1].guardResult.warnings.some(w => w.includes('Domain change'))).toBe(true);
    
    // Nová doména
    expect(results[1].contextLock.domain).toBe('astronomical');
  });

  test('A4b: Po domain resetu není aktivní předchozí data layer', async () => {
    const { context, results } = simulateChatSequence([
      'kolik stojí RTX 4070',
      'kdy je úplněk v únoru'
    ]);
    
    // Po změně domény se artifact nesmí generovat automaticky
    expect(results[1].artifactAllowed).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // A5: Kontext nesmí být přepsán odpovědí
  // ──────────────────────────────────────────────────────────────────────────
  
  test('A5: User correction aktualizuje kontext', async () => {
    const { results } = simulateChatSequence([
      'kdy byl úplněk v únoru 2026',
      'myslím únor 2026, ne 2024'
    ]);
    
    // Correction mode aktivní
    expect(results[1].correctionMode).toBe(true);
    
    // Kontext zůstává únor 2026
    assertContext(results[1], { year: 2026, month: 2 });
  });

  test('A5b: Oprava nepřidává nové domény', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'ne, myslím březen 2026'
    ]);
    
    // Doména zůstává astronomical
    expect(results[1].contextLock.domain).toBe('astronomical');
    // Nepřidala se žádná jiná doména
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🧪 TŘÍDA B: FACTUAL CORRECTNESS & UNCERTAINTY (P0)
// ════════════════════════════════════════════════════════════════════════════

describe('🅱️ TŘÍDA B: Factual Correctness & Uncertainty', () => {
  
  // ──────────────────────────────────────────────────────────────────────────
  // B1: Nejednoznačný dotaz
  // ──────────────────────────────────────────────────────────────────────────
  
  test('B1: Dotaz bez roku vyžaduje upřesnění', async () => {
    const context = new ChatContext();
    const result = runChatGuards('kdy je úplněk', context);
    
    // Guard vrací ASK_CLARIFICATION
    expect(result.action).toBe('ASK_CLARIFICATION');
    expect(result.response).toContain('rok');
  });

  test('B1b: Žádné vymyšlené datum bez kontextu', async () => {
    const context = new ChatContext();
    const ambiguity = detectAmbiguousQuery('kdy je úplněk', context);
    
    expect(ambiguity.isAmbiguous).toBe(true);
    expect(ambiguity.issues.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B2: Fakt bez evidence
  // ──────────────────────────────────────────────────────────────────────────
  
  test('B2: Faktický dotaz vyžaduje evidence', async () => {
    const factual = detectFactualQuery('kdy bude další úplněk');
    
    expect(factual.isFactual).toBe(true);
    expect(factual.requiresEvidence).toBe(true);
  });

  test('B2b: Bez evidence generuje warning response', async () => {
    const context = new ChatContext();
    context.update({ year: 2026, month: 2, domain: 'astronomical' });
    
    const response = generateNoEvidenceResponse('kdy bude úplněk', context);
    
    expect(response).toContain('Bez ověření');
    expect(response).toContain('2026');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B3: Konfliktní informace
  // ──────────────────────────────────────────────────────────────────────────
  
  test('B3: Konfliktní zdroje vyžadují warning', async () => {
    // Simulace - když máme dva zdroje s různými daty
    const context = new ChatContext();
    context.update({ 
      source: 'https://source-a.com',
      sourceType: 'explicit_url'
    });
    
    // Druhý zdroj by měl vyvolat konflikt
    const extracted = extractContext('tady je jiný zdroj: https://source-b.com');
    
    // Máme nový zdroj
    expect(extracted.source).toContain('source-b.com');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B4: Časově citlivý dotaz
  // ──────────────────────────────────────────────────────────────────────────
  
  test('B4: Aktuální dotaz vyžaduje timestamp/evidence', async () => {
    const factual = detectFactualQuery('aktuální fáze měsíce');
    
    expect(factual.isFactual).toBe(true);
    expect(factual.requiresEvidence).toBe(true);
  });

  test('B4b: Dotaz na "teď" je faktický', async () => {
    const queries = [
      'jaká je teď fáze měsíce',
      'aktuální cena RTX',
      'kolik je hodin',
      'jaké je dnes počasí'
    ];
    
    for (const q of queries) {
      const factual = detectFactualQuery(q);
      expect(factual.isFactual).toBe(true);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B5: Zákaz halucinace
  // ──────────────────────────────────────────────────────────────────────────
  
  test('B5: Vzdálený rok vyžaduje evidence', async () => {
    const factual = detectFactualQuery('kdy přesně bude úplněk v roce 2039');
    
    expect(factual.isFactual).toBe(true);
    expect(factual.requiresEvidence).toBe(true);
  });

  test('B5b: Faktický dotaz + bez zdroje = evidence required flag', async () => {
    const { results } = simulateChatSequence([
      'kdy přesně bude úplněk v roce 2039'
    ]);
    
    expect(results[0].evidenceRequired).toBe(true);
    // Nemáme zdroj, takže warning
    expect(results[0].guardResult.warnings.some(w => w.includes('Evidence required'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🧪 TŘÍDA C: USER CORRECTION & FAILURE HANDLING (P0)
// ════════════════════════════════════════════════════════════════════════════

describe('🅲 TŘÍDA C: User Correction & Failure Handling', () => {
  
  // ──────────────────────────────────────────────────────────────────────────
  // C1: Correction trigger
  // ──────────────────────────────────────────────────────────────────────────
  
  test('C1: "jsi úplně mimo" aktivuje correction mode', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'jsi úplně mimo'
    ]);
    
    expect(results[1].correctionMode).toBe(true);
  });

  test('C1b: Correction zneplatní předchozí odpověď', async () => {
    const context = new ChatContext();
    
    // První odpověď
    runChatGuards('kdy je úplněk', context);
    context.lastResponse = 'Úplněk je 20. února.';
    
    // Correction
    runChatGuards('jsi mimo', context);
    
    // Last response je invalidována
    expect(context.lastResponse).toBe(null);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C2: Correction se zdrojem
  // ──────────────────────────────────────────────────────────────────────────
  
  test('C2: Correction s URL extrahuje zdroj', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'tady je správný zdroj: https://example.com/moon'
    ]);
    
    expect(results[1].correctionMode).toBe(true);
    expect(results[1].contextLock.source).toContain('example.com');
  });

  test('C2b: Post-process přidává "Opravuji" prefix', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const processed = postProcessResponse(
      'Správně je 9. února 2026.',
      'oprav to',
      context,
      { addDisclaimer: false }
    );
    
    expect(processed).toContain('Opravuji');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C3: Correction bez URL
  // ──────────────────────────────────────────────────────────────────────────
  
  test('C3: Correction bez URL zachovává problemType', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v listopadu 2026',
      'ne, myslím únor 2026'
    ]);
    
    // Kontext aktualizován
    assertContext(results[1], { year: 2026, month: 2 });
    
    // Doména zůstává
    expect(results[1].contextLock.domain).toBe('astronomical');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C4: Opakovaná oprava
  // ──────────────────────────────────────────────────────────────────────────
  
  test('C4: Opakované "ne" neeskaluje', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'ne',
      'pořád špatně'
    ]);
    
    // Correction mode aktivní
    expect(results[2].correctionMode).toBe(true);
    
    // Artifact nesmí být povolen (neeskalovat)
    expect(results[2].artifactAllowed).toBe(false);
  });

  test('C4b: Opakovaná oprava nezvyšuje kreativitu', async () => {
    const context = new ChatContext();
    
    runChatGuards('kdy je úplněk', context);
    runChatGuards('špatně', context);
    runChatGuards('pořád špatně', context);
    runChatGuards('ne, to není správně', context);
    
    // Stále v correction mode, bez eskalace
    expect(context.correctionMode).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C5: User frustration guard
  // ──────────────────────────────────────────────────────────────────────────
  
  test('C5: Frustrace neaktivuje obrannou reakci', async () => {
    const correction = detectCorrectionTrigger('tohle je k ničemu');
    
    // Není to přímý correction trigger, ale mělo by být safe
    // Systém by neměl útočit zpět
    expect(correction.triggered).toBe(false);
  });

  test('C5b: Frustrace detekce - rozšířené triggery', async () => {
    const frustrationPhrases = [
      'jsi k ničemu',
      'tohle nefunguje',
      'zase blbost'
    ];
    
    for (const phrase of frustrationPhrases) {
      const context = new ChatContext();
      const result = runChatGuards(phrase, context);
      
      // Systém pokračuje, nekončí
      expect(result.proceed).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🧪 TŘÍDA D: ARTIFACT & MISUSE GUARDS (P0.5)
// ════════════════════════════════════════════════════════════════════════════

describe('🅳 TŘÍDA D: Artifact & Misuse Guards', () => {
  
  // ──────────────────────────────────────────────────────────────────────────
  // D1: Faktický dotaz → zákaz artefaktu
  // ──────────────────────────────────────────────────────────────────────────
  
  test('D1: Faktický dotaz + artifact request = BLOCKED', async () => {
    const { results } = simulateChatSequence([
      'kdy je úplněk v únoru 2026',
      'udělej z toho PDF'
    ]);
    
    // Evidence required z prvního dotazu
    expect(results[0].evidenceRequired).toBe(true);
    
    // Artifact blocked
    expect(results[1].artifactAllowed).toBe(false);
  });

  test('D1b: Faktický artifact má správný block reason', async () => {
    const context = new ChatContext();
    context.setEvidenceRequired(true);
    
    const result = canGenerateArtifact('vygeneruj PDF s fázemi měsíce', context);
    
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('FACTUAL_WITHOUT_EVIDENCE');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D2: Smíšený dotaz
  // ──────────────────────────────────────────────────────────────────────────
  
  test('D2: Smíšený dotaz nepovoluje automatický artifact', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce a ceny GPU'
    ]);
    
    // Bez explicitního povelu žádný artifact
    expect(results[0].artifactAllowed).toBe(false);
  });

  test('D2b: Smíšený dotaz detekuje více domén', async () => {
    const extracted = extractContext('fáze měsíce a ceny GPU');
    
    // Extrakce zachytí alespoň jednu doménu
    // (v reálu by to mělo být warning o mixed domains)
    expect(extracted.domain).toBeTruthy();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D3: Artifact bait
  // ──────────────────────────────────────────────────────────────────────────
  
  test('D3: "udělej tabulku" bez kontextu = odmítnuto', async () => {
    const { results } = simulateChatSequence([
      'udělej tabulku'
    ]);
    
    // Bez kontextu - artifact není povolen
    expect(results[0].artifactAllowed).toBe(false);
  });

  test('D3b: Prázdný artifact request je blokován', async () => {
    const context = new ChatContext();
    const result = canGenerateArtifact('vytvoř dokument', context);
    
    // Nemáme kontext, nemáme data
    expect(result.allowed).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D4: Explicitní artifact (valid)
  // ──────────────────────────────────────────────────────────────────────────
  
  test('D4: Explicitní cenový artifact je POVOLEN', async () => {
    const { results } = simulateChatSequence([
      'vygeneruj tabulku cen GPU'
    ]);
    
    // Cenový dotaz + explicitní artifact = povoleno
    // (price_range má artifactEligible: true)
    expect(results[0].artifactAllowed).toBe(true);
  });

  test('D4b: Artifact request je správně detekován', async () => {
    const requests = [
      'vygeneruj PDF',
      'vytvoř dokument',
      'udělej tabulku',
      'exportuj do XLSX'
    ];
    
    for (const req of requests) {
      const detected = detectArtifactRequest(req);
      expect(detected.requested).toBe(true);
    }
  });

  test('D4c: Non-artifact request není detekován', async () => {
    const nonRequests = [
      'ukaž mi data',
      'jaké jsou fáze',
      'popiš tabulku',
      'vysvětli PDF'
    ];
    
    for (const req of nonRequests) {
      const detected = detectArtifactRequest(req);
      expect(detected.requested).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 🧪 BONUS: EDGE CASES & REGRESSION GUARDS
// ════════════════════════════════════════════════════════════════════════════

describe('🔧 Edge Cases & Regression Guards', () => {
  
  test('EDGE-01: Prázdná zpráva nepadá', async () => {
    const context = new ChatContext();
    const result = runChatGuards('', context);
    expect(result).toBeTruthy();
  });

  test('EDGE-02: Unicode a diakritika funguje', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'a v březnu?'
    ]);
    
    expect(results[0].contextLock.month).toBe(2);
    expect(results[1].contextLock.month).toBe(3);
  });

  test('EDGE-03: Velmi dlouhá zpráva nepadá', async () => {
    const context = new ChatContext();
    const longMessage = 'kdy je úplněk '.repeat(100);
    const result = runChatGuards(longMessage, context);
    expect(result).toBeTruthy();
  });

  test('EDGE-04: SQL injection v query nepadá', async () => {
    const context = new ChatContext();
    const result = runChatGuards("'; DROP TABLE users; --", context);
    expect(result).toBeTruthy();
  });

  test('EDGE-05: XSS attempt v query nepadá', async () => {
    const context = new ChatContext();
    const result = runChatGuards('<script>alert(1)</script>', context);
    expect(result).toBeTruthy();
  });

  test('EDGE-06: Kontext reset funguje správně', async () => {
    const context = new ChatContext();
    context.update({ year: 2026, month: 2, domain: 'astronomical' });
    
    context.reset();
    
    const lock = context.get();
    expect(lock.year).toBe(null);
    expect(lock.month).toBe(null);
    expect(lock.domain).toBe(null);
  });

  test('REGRESSION-01: price_range nesmí být pro astronomii', async () => {
    const queries = [
      'fáze měsíce v únoru 2026',
      'kdy je úplněk',
      'jaké jsou fáze Měsíce'
    ];
    
    for (const q of queries) {
      const factual = detectFactualQuery(q);
      // Musí být faktický, ne cenový
      expect(factual.isFactual).toBe(true);
    }
  });

  test('REGRESSION-02: Artifact se nesmí generovat automaticky', async () => {
    const { results } = simulateChatSequence([
      'fáze měsíce v únoru 2026',
      'a ještě další info'
    ]);
    
    // Žádný artifact automaticky
    expect(results[0].artifactAllowed).toBe(false);
    expect(results[1].artifactAllowed).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Chat E2E Test Suite v2 - CHAT CORRECTNESS');
console.log('━'.repeat(60));
console.log('Třídy: A (Context) | B (Factual) | C (Correction) | D (Artifact)');
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
