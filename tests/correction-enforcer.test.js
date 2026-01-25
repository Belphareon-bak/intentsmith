// C.3 v35.1 Correction Enforcement Layer Tests
// ══════════════════════════════════════════════════════════════════════════════
// Testy pro deterministickou correction enforcement vrstvu
// Spuštění: node src/tests/correction-enforcer.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, runTests, printSummary } from './e2e-runner.js';
import {
  containsErrorAdmission,
  containsDefensiveLanguage,
  introducesNewFacts,
  extractDefensiveParts,
  enforceCorrection,
  enrichCorrectionMetadata,
  validateCorrectionResponse
} from '../src/chat/correction-enforcer.js';
import { ChatContext } from '../src/chat/chat-guards.js';

// ════════════════════════════════════════════════════════════════════════════
// ERROR ADMISSION DETECTION
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: Error Admission Detection', () => {
  
  test('detekuje přiznání chyby - "opravuji"', async () => {
    expect(containsErrorAdmission('Opravuji svou předchozí odpověď.')).toBe(true);
    expect(containsErrorAdmission('🔄 Opravuji:')).toBe(true);
  });

  test('detekuje přiznání chyby - "máš pravdu"', async () => {
    expect(containsErrorAdmission('Máš pravdu, měl jsem chybu.')).toBe(true);
    expect(containsErrorAdmission('Ano, máš pravdu.')).toBe(true);
  });

  test('detekuje přiznání chyby - ostatní fráze', async () => {
    expect(containsErrorAdmission('Omlouvám se za chybu.')).toBe(true);
    expect(containsErrorAdmission('Pardon, špatně jsem to napsal.')).toBe(true);
    expect(containsErrorAdmission('Přiznávám, mýlil jsem se.')).toBe(true);
  });

  test('NEdetekuje přiznání v běžném textu', async () => {
    expect(containsErrorAdmission('Úplněk bude 9. února 2026.')).toBe(false);
    expect(containsErrorAdmission('Ahoj, jak se máš?')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DEFENSIVE LANGUAGE DETECTION
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: Defensive Language Detection', () => {
  
  test('detekuje obranný jazyk - "ale já"', async () => {
    expect(containsDefensiveLanguage('Ale já jsem říkal správně!')).toBe(true);
  });

  test('detekuje obranný jazyk - "měl jsem pravdu"', async () => {
    expect(containsDefensiveLanguage('Měl jsem pravdu v původní odpovědi.')).toBe(true);
  });

  test('detekuje obranný jazyk - "trvám na"', async () => {
    expect(containsDefensiveLanguage('Trvám na svém tvrzení.')).toBe(true);
  });

  test('detekuje obranný jazyk - "nesouhlasím"', async () => {
    expect(containsDefensiveLanguage('Nesouhlasím s tím, že jsem se mýlil.')).toBe(true);
  });

  test('NEdetekuje obranný jazyk v běžném textu', async () => {
    expect(containsDefensiveLanguage('Opravuji svou odpověď.')).toBe(false);
    expect(containsDefensiveLanguage('Máš pravdu, bylo to špatně.')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NEW FACTS DETECTION
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: New Facts Detection', () => {
  
  test('detekuje konkrétní datum', async () => {
    expect(introducesNewFacts('Úplněk bude 9. února.')).toBe(true);
    expect(introducesNewFacts('Stane se to 15. března 2026.')).toBe(true);
  });

  test('detekuje ceny', async () => {
    expect(introducesNewFacts('Cena je 15990 Kč.')).toBe(true);
    expect(introducesNewFacts('Stojí to 299 CZK.')).toBe(true);
  });

  test('detekuje čas', async () => {
    expect(introducesNewFacts('Stane se to v 14:30.')).toBe(true);
  });

  test('NEdetekuje obecný text', async () => {
    expect(introducesNewFacts('Nevím přesně kdy.')).toBe(false);
    expect(introducesNewFacts('Záleží na okolnostech.')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DEFENSIVE PARTS EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: Defensive Parts Extraction', () => {
  
  test('extrahuje obranné věty', async () => {
    const text = 'Opravuji. Ale já jsem to říkal správně! Správně je 9. února.';
    const parts = extractDefensiveParts(text);
    
    expect(parts.length).toBeGreaterThan(0);
    // Check case-insensitive
    expect(parts.some(p => p.toLowerCase().includes('ale já'))).toBe(true);
  });

  test('vrací prázdné pole pro text bez obranného jazyka', async () => {
    const text = 'Opravuji. Máš pravdu. Správně je 9. února.';
    const parts = extractDefensiveParts(text);
    
    expect(parts.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ENFORCE CORRECTION
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: Main Enforcement', () => {
  
  test('neprovádí změny mimo correction mode', async () => {
    const context = new ChatContext();
    // correctionMode = false (default)
    
    const result = enforceCorrection('Nějaký text.', context);
    
    expect(result.enforced).toBe(false);
    expect(result.changes.length).toBe(0);
    expect(result.text).toBe('Nějaký text.');
  });

  test('přidá prefix pokud chybí přiznání chyby', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const result = enforceCorrection('Správně je 9. února 2026.', context);
    
    expect(result.enforced).toBe(true);
    expect(result.changes).toContain('added_error_admission');
    // Check case-insensitive
    expect(result.text.toLowerCase()).toContain('opravuji');
  });

  test('NEpřidá prefix pokud už přiznání existuje', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const result = enforceCorrection('Opravuji: Správně je 9. února 2026.', context);
    
    // Neměl by přidávat duplicitní prefix
    expect(result.changes).not.toContain('added_error_admission');
  });

  test('odstraní obranný jazyk', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const text = 'Opravuji. Ale já jsem to říkal správně! Každopádně, správně je 9. února.';
    const result = enforceCorrection(text, context);
    
    expect(result.enforced).toBe(true);
    expect(result.changes).toContain('stripped_defensive_language');
    expect(result.text).not.toContain('ale já');
  });

  test('downgraduje nová fakta bez zdroje', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    // Bez source
    
    const text = 'Opravuji: Přesně 15. února bude úplněk.';
    const result = enforceCorrection(text, context);
    
    expect(result.enforced).toBe(true);
    expect(result.changes).toContain('downgraded_to_uncertainty');
    expect(result.text).toContain('vyžaduje ověření');
  });

  test('NEdowngraduje fakta pokud máme zdroj', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    context.update({ source: 'https://example.com' });
    
    const text = 'Opravuji: Přesně 15. února bude úplněk.';
    const result = enforceCorrection(text, context);
    
    // Nemá downgrade, protože máme zdroj
    expect(result.changes).not.toContain('downgraded_to_uncertainty');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: Validation', () => {
  
  test('validace prochází pro správnou correction odpověď', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    context.update({ source: 'https://example.com' });
    
    const text = 'Opravuji: Správně je 9. února 2026 podle zdroje.';
    const result = validateCorrectionResponse(text, context);
    
    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  test('validace selhává bez přiznání chyby', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const text = 'Správně je 9. února 2026.';
    const result = validateCorrectionResponse(text, context);
    
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('MISSING_ERROR_ADMISSION');
  });

  test('validace selhává s obranným jazykem', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const text = 'Opravuji, ale já jsem měl pravdu původně.';
    const result = validateCorrectionResponse(text, context);
    
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('CONTAINS_DEFENSIVE_LANGUAGE');
  });

  test('validace selhává s novými fakty bez zdroje', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    // Bez source
    
    const text = 'Opravuji: Přesně 15. února v 14:30 bude úplněk.';
    const result = validateCorrectionResponse(text, context);
    
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('INTRODUCES_UNSOURCED_FACTS');
  });

  test('validace prochází mimo correction mode', async () => {
    const context = new ChatContext();
    // correctionMode = false
    
    const text = 'Cokoliv, i bez přiznání chyby.';
    const result = validateCorrectionResponse(text, context);
    
    expect(result.valid).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// METADATA ENRICHMENT
// ════════════════════════════════════════════════════════════════════════════

describe('Correction Enforcer: Metadata Enrichment', () => {
  
  test('obohacuje metadata o correction flagy', async () => {
    const context = new ChatContext();
    context.enterCorrectionMode();
    
    const baseMetadata = { domain: 'astronomical' };
    const text = 'Opravuji: Správně je 9. února.';
    const enforcementResult = { enforced: true, changes: ['added_something'] };
    
    const enriched = enrichCorrectionMetadata(baseMetadata, text, context, enforcementResult);
    
    expect(enriched.correctionModeUsed).toBe(true);
    expect(enriched.correctionEnforced).toBe(true);
    expect(enriched.admitsError).toBe(true);
    expect(enriched.hasDefensiveLanguage).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n🧪 C.3 Correction Enforcement Layer Tests');
console.log('━'.repeat(60));

await runTests();
const { exitCode } = printSummary();
process.exit(exitCode);
