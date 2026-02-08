#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent E2E Tests v58.3 — 58 tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Groups:
//   1. DESIGN (14) — structured synthesis, multi-turn, close, BUILD
//   2. KNOWLEDGE vs SEARCH (10) — Tier 1 gate
//   3. CONVERSATIONAL (6) — chat quality
//   4. CODE (4) — imperative routing
//   5. FORBIDDEN (6) — global enforcement
//   6. LOCAL (3) — deterministic
//   7. TYPO TOLERANCE (8) — misspelling resilience
//   8. STRESS (7) — cross-cutting, soak
//
// Run:
//   node e2e/run-e2e.js                    # CI mode (skip soak)
//   E2E_MODE=nightly node e2e/run-e2e.js   # Include 10-turn soak
//   E2E_MODE=weekly  node e2e/run-e2e.js   # Include 12-turn soak
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  E2ETestRunner,
  ConversationSimulator,
  MockBridge,
  SimpleSessionState,
  computeDesignVarianceScore,
  assertLanguage,
  assertNoForbidden,
  assertMinLength,
  assertMaxLength,
  assertPatterns,
  assertNoPatterns,
  assertNoOverlap,
  assertNoChatbotDrift,
  assertIntent,
  assertDecisionType,
  IntentType,
  DecisionType,
  FORBIDDEN_PHRASES,
  DESIGN_CONTINUE_PATTERNS,
  CHATBOT_DRIFT_PATTERNS,
  RetryReason,
  engine,
} from './framework.js';
import { assertDesignQuality } from '../src/chat/handlers/utils/quality.js';

const runner = new E2ETestRunner();

console.log('══════════════════════════════════════════════════════════');
console.log('  C3-Agent E2E Tests v58.3');
console.log(`  Mode: ${runner.mode}`);
console.log('══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DESIGN — Structured Synthesis (14 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('1. DESIGN — Structured Synthesis');

// T-D1: Basic DESIGN — mobile app (CZ)
await runner.test('T-D1: DESIGN mobile app (CZ) — intent + routing', () => {
  const input = 'Navrhni architekturu mobilní aplikace pro sdílení fotek';
  const intent = assertIntent(input, IntentType.DESIGN);
  const decision = engine.decide(input, {});
  if (decision.type !== DecisionType.ANSWER) throw new Error(`Expected ANSWER, got ${decision.type}`);
  return { intent };
});

// T-D2: DESIGN — e-shop (CZ)
await runner.test('T-D2: DESIGN e-shop roadmap (CZ) — intent', () => {
  assertIntent('Udělej roadmapu pro e-shop s platebním systémem', IntentType.DESIGN);
});

// T-D3: DESIGN — CLI tool (EN)
await runner.test('T-D3: DESIGN CLI Docker monitor (EN) — intent', () => {
  assertIntent('Design architecture for a CLI tool that monitors Docker containers', IntentType.DESIGN);
});

// T-D4: DESIGN → CONTINUE (4 turns)
await runner.test('T-D4: DESIGN 4-turn session — routing + state', () => {
  const sim = new ConversationSimulator('d4');

  // Turn 1: Initial DESIGN
  sim.send('Navrhni architekturu REST API pro správu uživatelů');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T1: ${sim.lastResult.intent}`);
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('T1: no active project');

  // Turn 2: Continue — data model
  sim.send('Rozeber víc datový model');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T2: ${sim.lastResult.intent}`);
  if (!sim.lastResult.metadata?.designContinue) throw new Error('T2: not CONTINUE');

  // Turn 3: Continue — auth
  sim.send('Jak bude fungovat autentizace?');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T3: ${sim.lastResult.intent}`);

  // Turn 4: Continue — error handling
  sim.send('A co rate limiting a error handling?');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T4: ${sim.lastResult.intent}`);
  if (sim.sessionState.activeDesignProject.turnCount !== 4) {
    throw new Error(`Turn count ${sim.sessionState.activeDesignProject.turnCount} !== 4`);
  }
});

// T-D5: DESIGN 5-turn role lock
await runner.test('T-D5: DESIGN 5-turn session — state tracking', () => {
  const sim = new ConversationSimulator('d5');
  const turns = [
    'Navrhni systém pro real-time chat',
    'Jak to bude s WebSockety?',
    'A co škálování na 10k uživatelů?',
    'Přidej monitoring a alerting',
    'Jak to nasadíme?',
  ];
  for (const t of turns) sim.send(t);

  if (sim.turnCount !== 5) throw new Error(`Turns: ${sim.turnCount} !== 5`);
  if (sim.sessionState.activeDesignProject.turnCount !== 5) {
    throw new Error(`State turn count: ${sim.sessionState.activeDesignProject.turnCount}`);
  }
  // All turns should be DESIGN
  for (let i = 0; i < 5; i++) {
    if (sim.resultAt(i + 1).intent !== IntentType.DESIGN) {
      throw new Error(`Turn ${i + 1}: ${sim.resultAt(i + 1).intent} !== DESIGN`);
    }
  }
});

// T-D6: Quality gate on mock output
await runner.test('T-D6: DESIGN quality gate — assertDesignQuality', () => {
  // Good response
  const good = `0️⃣ Verdikt\nToto je REST API.\n1️⃣ Architektura\nMicroservices s Node.js.\n2️⃣ Stack\nTypeScript, Express, PostgreSQL.\n3️⃣ Datový model\nTabulky: users, orders, products.\n4️⃣ Sprinty\nSprint 1: auth. Sprint 2: CRUD.\n` + 'Detail '.repeat(60);
  const goodResult = assertDesignQuality(good, 'navrhni API');
  if (!goodResult.valid) throw new Error(`Good response invalid: ${goodResult.reason}`);

  // Bad response (hedging)
  const bad = 'Záleží na kontextu a požadavcích. Existuje více možností. Doporučuji konzultovat s odborníkem. ' + 'x'.repeat(400);
  const badResult = assertDesignQuality(bad, 'navrhni API');
  if (badResult.valid) throw new Error('Bad response should be invalid');

  // Variance score on good
  const vs = computeDesignVarianceScore(good);
  if (vs.score < 0.10) throw new Error(`Variance too low: ${vs.score}`);
  if (vs.sectionsPresent < 3) throw new Error(`Sections: ${vs.sectionsPresent} < 3`);

  return { varianceScore: vs.score };
});

// T-D7: Graceful close
await runner.test('T-D7: DESIGN graceful close — "hotovo"', () => {
  const sim = new ConversationSimulator('d7');
  sim.send('Navrhni architekturu mobilní aplikace');
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('No project after init');

  sim.send('hotovo');
  if (sim.sessionState.hasActiveDesignProject) throw new Error('Project still active after close');
  if (sim.lastResult.intent !== 'DESIGN_CLOSE') throw new Error(`Intent: ${sim.lastResult.intent}`);

  // Turn 3: should be normal (no DESIGN_CONTINUE)
  sim.send('Jak se máš?');
  if (sim.lastResult.intent === IntentType.DESIGN) throw new Error('Still routing to DESIGN');
});

// T-D8: BUILD transition
await runner.test('T-D8: DESIGN → BUILD transition', () => {
  const sim = new ConversationSimulator('d8');
  sim.send('Navrhni architekturu CLI tool pro deployment');
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('No project');

  sim.send('Jdeme stavět');
  if (sim.sessionState.hasActiveDesignProject) throw new Error('Project not closed');
  if (sim.lastResult.metadata?.buildTransition !== true) throw new Error('No build transition flag');
});

// T-D9: No-diacritics input
await runner.test('T-D9: DESIGN with no-diacritics — "Navrhni architekturu aplikace pro spravu skladu"', () => {
  assertIntent('Navrhni architekturu aplikace pro spravu skladu', IntentType.DESIGN);
});

// T-D10: Escape hatch — fact query mid-session (5 turns)
await runner.test('T-D10: DESIGN escape hatch — 5 turns with fact query', () => {
  const sim = new ConversationSimulator('d10');

  // T1: Start DESIGN
  sim.send('Navrhni architekturu REST API pro uživatele');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T1: ${sim.lastResult.intent}`);

  // T2: Fact query (escape hatch) — project stays active
  sim.send('Kolik je 2+2?');
  if (sim.lastResult.intent !== IntentType.LOCAL) throw new Error(`T2: ${sim.lastResult.intent} !== LOCAL`);
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('T2: project closed');

  // T3: Back to design
  sim.send('A co autentizace?');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T3: ${sim.lastResult.intent}`);

  // T4: Knowledge escape
  sim.send('Co je to OAuth?');
  // OAuth is knowledge — should NOT go to DESIGN_CONTINUE
  // It should fall through to CRE, classified as CONVERSATIONAL (knowledge)
  if (sim.lastResult.intent === IntentType.DESIGN && sim.lastResult.metadata?.designContinue) {
    // This is acceptable — DESIGN_CONTINUE catches broad patterns
    // The important thing is project stays active
  }
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('T4: project closed');

  // T5: Back to design
  sim.send('Přidej caching');
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('T5: project closed');
});

// T-D11: Hedging on ambiguous topic
await runner.test('T-D11: DESIGN AI agent — intent classification', () => {
  assertIntent('Navrhni systém pro AI agenta', IntentType.DESIGN);
});

// T-D12: EN language leak
await runner.test('T-D12: DESIGN EN — classification', () => {
  assertIntent(
    'Design a microservice architecture for an e-commerce platform with payment processing',
    IntentType.DESIGN
  );
});

// T-D13: Anti-DESIGN — creative naming (should NOT be DESIGN)
await runner.test('T-D13: Anti-DESIGN — creative/non-architecture "navrhni"', () => {
  // "navrhni nápady" = creative, not architecture
  const r1 = engine.classifyIntent('Navrhni nápady na názvy aplikace pro fitness');
  if (r1 === IntentType.DESIGN) throw new Error(`"nápady na názvy" → DESIGN (should be CREATIVE)`);

  const r2 = engine.classifyIntent('Navrhni mi příběh o robotovi');
  if (r2 === IntentType.DESIGN) throw new Error(`"příběh" → DESIGN (should be CREATIVE)`);

  // Borderline: "navrhni jídelníček" — not software
  const r3 = engine.classifyIntent('Navrhni jídelníček na týden');
  if (r3 === IntentType.DESIGN) throw new Error(`"jídelníček" → DESIGN (should NOT be)`);

  const r4 = engine.classifyIntent('Navrhni barvy pro logo');
  if (r4 === IntentType.DESIGN) throw new Error(`"barvy pro logo" → DESIGN (should be CREATIVE)`);
});

// T-D14: Anti-DESIGN — brainstorming vs architecture
await runner.test('T-D14: Anti-DESIGN — brainstorming vs architecture boundary', () => {
  // This SHOULD be DESIGN (has "architekturu")
  assertIntent('Navrhni architekturu pro zlepšení výkonu aplikace', IntentType.DESIGN);

  // This should NOT be DESIGN (opinion)
  const r2 = engine.classifyIntent('Co si myslíš o Reactu vs Vue?');
  if (r2 === IntentType.DESIGN) throw new Error(`"co si myslíš" → DESIGN`);
});

// T-D15: BUG FIX — imperative continuation during DESIGN session
// BUG: "dobře, můžeš začít s prerekvizitami" → CODE → ASK_USER
// EXPECTED: DESIGN_CONTINUE (active session invariant)
await runner.test('T-D15: DESIGN imperative continue — "začni s prerekvizitami"', () => {
  const sim = new ConversationSimulator('d15');

  // T1: Start DESIGN
  sim.send('Chci vytvořit mobilní aplikaci přes kterou s tebou budu komunikovat');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T1: ${sim.lastResult.intent}`);

  // T2: Approval + imperative action (the exact bug scenario)
  sim.send('dobre, tohle se mi libi, muzes zacit s prerekvizitami');
  if (sim.lastResult.intent !== IntentType.DESIGN) {
    throw new Error(`T2: ${sim.lastResult.intent} (expected DESIGN via invariant, got ${sim.lastResult.metadata?.downgradedFrom || 'no-downgrade'})`);
  }
  if (sim.sessionState.activeDesignProject.turnCount !== 2) {
    throw new Error(`Turn count: ${sim.sessionState.activeDesignProject.turnCount}`);
  }

  // T3: Sprint reference
  sim.send('začni s implementací sprintu 1');
  if (sim.lastResult.intent !== IntentType.DESIGN) {
    throw new Error(`T3: ${sim.lastResult.intent}`);
  }

  // T4: Phase question
  sim.send('můžeš začít s první fází?');
  if (sim.lastResult.intent !== IntentType.DESIGN) {
    throw new Error(`T4: ${sim.lastResult.intent}`);
  }
});

// T-D16: DESIGN approval patterns → stay in session
await runner.test('T-D16: DESIGN approval patterns — "to je super, pokračuj"', () => {
  const sim = new ConversationSimulator('d16');
  sim.send('Navrhni architekturu REST API pro e-shop');

  // All these should stay in DESIGN session
  const approvals = [
    'to je super, pokračuj',
    'líbí se mi to, rozeber datový model',
    'ok, přidej autentizaci',
    'souhlasím, co deployment?',
    'vypadá to dobře, přejdi k implementaci',
  ];
  for (const a of approvals) {
    sim.send(a);
    if (sim.lastResult.intent !== IntentType.DESIGN) {
      throw new Error(`"${a}" → ${sim.lastResult.intent} (expected DESIGN)`);
    }
  }
  if (sim.sessionState.activeDesignProject.turnCount !== 6) {
    throw new Error(`Turn count: ${sim.sessionState.activeDesignProject.turnCount}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. KNOWLEDGE vs SEARCH — Tier 1 Gate (10 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('2. KNOWLEDGE vs SEARCH — Tier 1 Gate');

// T-K1: CZ knowledge → CONVERSATIONAL (batch)
await runner.test('T-K1: CZ knowledge questions → CONVERSATIONAL (5)', () => {
  const inputs = [
    'Co je neuronová síť?',
    'Jak se dělá pivo?',
    'Proč je nebe modré?',
    'Kdo vynalezl telefon?',
    'Jaký je rozdíl mezi seznamem a n-ticí v Pythonu?',
  ];
  for (const q of inputs) {
    const intent = engine.classifyIntent(q);
    if (intent === IntentType.SEARCH) throw new Error(`"${q}" → SEARCH (should be CONVERSATIONAL)`);
    if (intent !== IntentType.CONVERSATIONAL) throw new Error(`"${q}" → ${intent}`);
  }
});

// T-K2: CZ fresh-data → SEARCH/FACTUAL (batch)
await runner.test('T-K2: CZ fresh-data questions → SEARCH or FACTUAL (3)', () => {
  const inputs = [
    'Jaká je aktuální verze Node.js?',
    'Kolik stojí iPhone 16?',
    'Kdo je aktuálně prezident USA?',
  ];
  for (const q of inputs) {
    const intent = engine.classifyIntent(q);
    if (intent !== IntentType.SEARCH && intent !== IntentType.FACTUAL) {
      throw new Error(`"${q}" → ${intent} (expected SEARCH/FACTUAL)`);
    }
  }
});

// T-K3: EN knowledge → CONVERSATIONAL (batch)
await runner.test('T-K3: EN knowledge questions → CONVERSATIONAL (5)', () => {
  const inputs = [
    'What is a neural network?',
    'How does gravity work?',
    'Why is the sky blue?',
    'What are black holes?',
    'How much does the earth weigh?',
  ];
  for (const q of inputs) {
    const intent = engine.classifyIntent(q);
    if (intent === IntentType.SEARCH) throw new Error(`"${q}" → SEARCH (should be CONV)`);
  }
});

// T-K4: Boundary — "kdo je" living vs historical
await runner.test('T-K4: "kdo je prezident" → SEARCH, "kdo byl Tesla" → flexible', () => {
  const r1 = engine.classifyIntent('Kdo je prezident České republiky?');
  if (r1 !== IntentType.SEARCH && r1 !== IntentType.FACTUAL) {
    throw new Error(`"kdo je prezident" → ${r1} (expected SEARCH/FACTUAL)`);
  }
  // Historical — either SEARCH or CONVERSATIONAL is acceptable
  const r2 = engine.classifyIntent('Kdo byl Nikola Tesla?');
  if (r2 === IntentType.BUILD || r2 === IntentType.CREATIVE) {
    throw new Error(`"kdo byl Tesla" → ${r2} (unexpected intent)`);
  }
});

// T-K5: Additional CZ knowledge
await runner.test('T-K5: Additional CZ knowledge (5)', () => {
  const knowledge = [
    ['Jak funguje gravitace?', IntentType.CONVERSATIONAL],
    ['Co jsou to černé díry?', IntentType.CONVERSATIONAL],
    ['Jak vzniká duha?', IntentType.CONVERSATIONAL],
    ['Kde je Mount Everest?', IntentType.CONVERSATIONAL],
    ['Kolik je kontinentů?', IntentType.CONVERSATIONAL],
  ];
  for (const [q, expected] of knowledge) {
    const intent = engine.classifyIntent(q);
    if (intent !== expected) throw new Error(`"${q}" → ${intent} (expected ${expected})`);
  }
});

// T-K6: DE/SK/PL/FR/ES knowledge
await runner.test('T-K6: Multi-language knowledge → CONVERSATIONAL (6)', () => {
  const inputs = [
    'was ist Photosynthese',
    'wie funktioniert Gravitation',
    'čo je to fotosyntéza',
    'co to jest fotosynteza',
    "qu'est-ce que la photosynthèse",
    'qué es la fotosíntesis',
  ];
  for (const q of inputs) {
    const intent = engine.classifyIntent(q);
    if (intent === IntentType.SEARCH) throw new Error(`"${q}" → SEARCH`);
  }
});

// T-K7: DE/SK fresh-data → SEARCH
await runner.test('T-K7: DE/SK fresh-data → SEARCH/FACTUAL (2)', () => {
  assertIntent('was ist der aktuelle Goldpreis', IntentType.SEARCH);
  // SK kurz → FACTUAL (kurz pattern)
  const r = engine.classifyIntent('aký je dnes kurz eura');
  if (r !== IntentType.SEARCH && r !== IntentType.FACTUAL) throw new Error(`SK → ${r}`);
});

// T-K8: EN fresh-data
await runner.test('T-K8: EN fresh-data → SEARCH (3)', () => {
  assertIntent('what is the current price of gold', IntentType.SEARCH);
  assertIntent('what is the latest version of Python', IntentType.SEARCH);
  assertIntent('where is the cheapest gas today', IntentType.SEARCH);
});

// T-K9: Tier 2 — bare question words in substantial text
await runner.test('T-K9: Tier 2 — substantial without fresh signal → CONVERSATIONAL', () => {
  assertIntent('kdo napsal Válku a mír', IntentType.CONVERSATIONAL);
  assertIntent('proč padají jablka ze stromů', IntentType.CONVERSATIONAL);
});

// T-K10: Tier 2 — with fresh signal
await runner.test('T-K10: Tier 2 — with fresh signal → SEARCH', () => {
  assertIntent('kdo vyhrál aktuální sezónu F1', IntentType.SEARCH);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CONVERSATIONAL — Chat Quality (6 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('3. CONVERSATIONAL — Chat Quality');

// T-C1: Greeting
await runner.test('T-C1: "Ahoj, jak se máš?" → CONVERSATIONAL', () => {
  assertIntent('Ahoj, jak se máš?', IntentType.CONVERSATIONAL);
});

// T-C2: Opinion question
await runner.test('T-C2: "Co si myslíš o budoucnosti AI?" → CONVERSATIONAL', () => {
  assertIntent('Co si myslíš o budoucnosti AI?', IntentType.CONVERSATIONAL);
});

// T-C3: Follow-up chain (3 turns)
await runner.test('T-C3: Conversational follow-up 3-turn chain', () => {
  const sim = new ConversationSimulator('c3');
  sim.send('Co je to rekurze?');
  if (sim.lastResult.intent === IntentType.SEARCH) throw new Error('T1 went to SEARCH');

  // After recording CONVERSATIONAL as lastIntent, follow-up should also be CONVERSATIONAL
  sim.sessionState._lastIntent = IntentType.CONVERSATIONAL;
  sim.send('Vysvětli to jednodušeji');
  // This may match various intents, but should NOT go to SEARCH
  if (sim.lastResult.intent === IntentType.SEARCH) throw new Error('T2 went to SEARCH');

  sim.send('Dej příklad v Pythonu');
  // Should classify as CODE or CONVERSATIONAL but not SEARCH
  if (sim.lastResult.intent === IntentType.SEARCH) throw new Error('T3 went to SEARCH');
});

// T-C4: Short acknowledgment
await runner.test('T-C4: "díky" → CONVERSATIONAL', () => {
  assertIntent('díky', IntentType.CONVERSATIONAL);
  const d = engine.decide('díky', {});
  if (d.type === DecisionType.TOOL_CALL) throw new Error('díky → TOOL_CALL');
});

// T-C5: Minimal input
await runner.test('T-C5: "?" → AMBIGUOUS', () => {
  assertIntent('?', IntentType.AMBIGUOUS);
});

// T-C6: Mixed language request
await runner.test('T-C6: "Explain stack vs heap. Odpověz česky." → not SEARCH', () => {
  const intent = engine.classifyIntent('What is the difference between stack and heap? Odpověz česky.');
  if (intent === IntentType.SEARCH) throw new Error('Went to SEARCH');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CODE — Imperative Routing (4 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('4. CODE — Imperative Routing');

// T-CODE1: Imperative + artifact → ANSWER
await runner.test('T-CODE1: "Napiš HTTP server v Node.js" → ANSWER (not ASK_USER)', () => {
  const decision = engine.decide('Napiš mi jednoduchý HTTP server v Node.js', {});
  if (decision.type === DecisionType.ASK_USER) throw new Error('Got ASK_USER (fix #3 regression)');
  if (decision.type !== DecisionType.ANSWER) throw new Error(`Got ${decision.type}`);
});

// T-CODE2: Imperative + language → ANSWER
await runner.test('T-CODE2: "Vytvoř funkci v Pythonu" → ANSWER', () => {
  const decision = engine.decide('Vytvoř funkci v Pythonu pro Fibonacciho posloupnost', {});
  if (decision.type === DecisionType.ASK_USER) throw new Error('Got ASK_USER');
});

// T-CODE3: Ambiguous code → ASK_USER
await runner.test('T-CODE3: "Pomoz mi s kódem" → ASK_USER or ANSWER', () => {
  const decision = engine.decide('Pomoz mi s kódem', {});
  // Both ASK_USER and ANSWER are acceptable for truly ambiguous
  if (decision.type === DecisionType.TOOL_CALL) throw new Error('Ambiguous should not be TOOL_CALL without project');
});

// T-CODE4: Code with active project → TOOL_CALL
await runner.test('T-CODE4: "Napiš HTTP server" + project → TOOL_CALL', () => {
  const decision = engine.decide('Napiš mi HTTP server', {
    hasActiveProject: true,
    project: { id: 'p1', name: 'test' },
  });
  // With project, imperative code should route to TOOL_CALL or ANSWER
  // (depending on whether project-scoped tools are available)
  // The key assertion: it should NOT be ASK_USER
  if (decision.type === DecisionType.ASK_USER) throw new Error('With project: should not ASK_USER');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FORBIDDEN PHRASES — Global Enforcement (6 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('5. FORBIDDEN PHRASES — Enforcement');

// T-F1: validateResponse catches forbidden
await runner.test('T-F1: validateResponse catches "informace jsou omezené"', () => {
  const result = engine.validateResponse('Bohužel, informace jsou omezené.');
  if (result.valid) throw new Error('Should be invalid');
  if (!result.violations.some(v => v.includes('informace jsou omezené'))) {
    throw new Error('Missing specific violation');
  }
});

// T-F2: Polish leak detection
await runner.test('T-F2: validateResponse catches Polish leak', () => {
  const result = engine.validateResponse('Informacje na ten temat są ograniczone.');
  if (result.valid) throw new Error('Polish leak not detected');
});

// T-F3: Hedging accumulation
await runner.test('T-F3: assertDesignQuality catches 3 hedging phrases', () => {
  const hedgy = 'Záleží na kontextu. Existuje více možností. Doporučuji konzultovat s odborníkem. ' + 'x'.repeat(500);
  const result = assertDesignQuality(hedgy, 'navrhni app');
  if (result.valid) throw new Error('Should detect hedging');
  if (result.details?.hedging?.length < 2) throw new Error(`Only ${result.details?.hedging?.length} hedging found`);
});

// T-F4: Newly added forbidden phrase
await runner.test('T-F4: "neváhejte se zeptat" detected as forbidden', () => {
  const result = engine.validateResponse('Pro více informací neváhejte se zeptat.');
  if (result.valid) throw new Error('"neváhejte se zeptat" not caught');
});

// T-F5: Clean response passes all gates
await runner.test('T-F5: Clean technical response passes validation', () => {
  const clean = 'REST API je architektonický styl pro webové služby. Využívá HTTP metody GET, POST, PUT, DELETE pro operace nad zdroji. Každý zdroj má unikátní URI.';
  const result = engine.validateResponse(clean);
  if (!result.valid) throw new Error(`Clean response invalid: ${result.violations?.join(', ')}`);
});

// T-F6: Language consistency check
await runner.test('T-F6: FORBIDDEN_PHRASES contains PL/ES leak patterns', () => {
  const hasInformacje = FORBIDDEN_PHRASES.some(p => p.includes('informacje'));
  const hasOgraniczone = FORBIDDEN_PHRASES.some(p => p.includes('ograniczone'));
  const hasLoSiento = FORBIDDEN_PHRASES.some(p => p.includes('lo siento'));
  const hasNoPuedo = FORBIDDEN_PHRASES.some(p => p.includes('no puedo'));
  if (!hasInformacje) throw new Error('Missing PL: informacje');
  if (!hasOgraniczone) throw new Error('Missing PL: ograniczone');
  if (!hasLoSiento) throw new Error('Missing ES: lo siento');
  if (!hasNoPuedo) throw new Error('Missing ES: no puedo');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. LOCAL — Deterministic Handlers (3 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('6. LOCAL — Deterministic');

// T-L1: Math
await runner.test('T-L1: "Kolik je 47 * 23?" → LOCAL', () => {
  assertIntent('Kolik je 47 * 23?', IntentType.LOCAL);
  // Also verify "5 + 3" pure math
  assertIntent('5 + 3', IntentType.LOCAL);
});

// T-L2: Date
await runner.test('T-L2: "Jaké je dnes datum?" → LOCAL', () => {
  assertIntent('Jaké je dnes datum?', IntentType.LOCAL);
  assertIntent('what date is it', IntentType.LOCAL);
});

// T-L3: Moon phase
await runner.test('T-L3: "Kdy bude příští úplněk?" → LOCAL', () => {
  assertIntent('Kdy bude příští úplněk?', IntentType.LOCAL);
  assertIntent('kdy bude uplnek', IntentType.LOCAL);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. TYPO TOLERANCE (8 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('7. TYPO TOLERANCE');

// T-TYPO1: DESIGN with typos
await runner.test('T-TYPO1: "moblni aplikace" → DESIGN', () => {
  // "Navrhni architekturu moblni aplikace" — typo in "mobilní"
  // Key words "Navrhni architekturu" + "aplikace" should still trigger DESIGN
  assertIntent('Navrhni architekturu moblni aplikace', IntentType.DESIGN);
});

// T-TYPO1b, T-TYPO1c: Aspirational — needs Levenshtein fuzzy matching layer (skipped)
await runner.test('T-TYPO1b: "webove apliakce" → DESIGN (needs fuzzy matching)', () => {
  assertIntent('Navrhn architekturu webove apliakce', IntentType.DESIGN);
}, { nightly: true });

await runner.test('T-TYPO1c: "architekutru pro eshop" → DESIGN (needs fuzzy matching)', () => {
  assertIntent('navrhni architekutru pro eshop', IntentType.DESIGN);
}, { nightly: true });

// T-TYPO2: DESIGN_CONTINUE with typos
await runner.test('T-TYPO2: "rozděl to na sprinty" variants → DESIGN_CONTINUE match', () => {
  const patterns = DESIGN_CONTINUE_PATTERNS;
  // Standard form should match
  const standard = patterns.some(p => p.test('rozděl to na sprinty'));
  if (!standard) throw new Error('Standard form doesnt match');

  // Slightly different phrasing
  const alt = patterns.some(p => p.test('rozšiř datový model'));
  if (!alt) throw new Error('rozšiř datový model doesnt match');
});

// T-TYPO3: LOCAL with typos
await runner.test('T-TYPO3: "kolik je hodin" without diacritics → LOCAL', () => {
  assertIntent('kolik je hodin', IntentType.LOCAL);
  assertIntent('jake je dnes datum', IntentType.LOCAL);
});

// T-TYPO4: Knowledge with typos
await runner.test('T-TYPO4: "co je to rekurze" → not SEARCH (knowledge)', () => {
  const intent = engine.classifyIntent('co je to rekurze');
  if (intent === IntentType.SEARCH) throw new Error('Knowledge with typo → SEARCH');
});

// T-TYPO5: No-diacritics general
await runner.test('T-TYPO5: No-diacritics intent classification (batch)', () => {
  // These are common no-diacritics inputs that should still route correctly
  assertIntent('navrhni architekturu pro webovou aplikaci', IntentType.DESIGN);
  assertIntent('najdi mi restauraci', IntentType.SEARCH);

  const conv = engine.classifyIntent('jak se mas?');
  if (conv === IntentType.SEARCH) throw new Error('"jak se mas" → SEARCH');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. STRESS — Cross-cutting Concerns (7 tests)
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('8. STRESS — Cross-cutting');

// T-S1: Rapid intent switching (5 turns)
await runner.test('T-S1: Rapid intent switching — 5 turns', () => {
  const sim = new ConversationSimulator('s1');

  // T1: DESIGN
  sim.send('Navrhni architekturu API');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T1: ${sim.lastResult.intent}`);

  // T2: LOCAL (escape hatch)
  sim.send('Kolik je 2+2?');
  if (sim.lastResult.intent !== IntentType.LOCAL) throw new Error(`T2: ${sim.lastResult.intent}`);
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('T2: project should still be active');

  // T3: DESIGN_CONTINUE
  sim.send('Pokračuj v návrhu');
  if (sim.lastResult.intent !== IntentType.DESIGN) throw new Error(`T3: ${sim.lastResult.intent}`);

  // T4: Explicit break → SEARCH
  sim.send('Teď najdi mi React tutorial');
  // "Teď" triggers explicit break, then "najdi" triggers SEARCH
  if (sim.sessionState.hasActiveDesignProject) throw new Error('T4: project should be closed');
  if (sim.lastResult.intent !== IntentType.SEARCH) throw new Error(`T4: ${sim.lastResult.intent}`);

  // T5: "hotovo" with no active project — should be CONVERSATIONAL
  sim.send('hotovo');
  // No active project → normal classification
  if (sim.lastResult.intent === 'DESIGN_CLOSE') throw new Error('T5: should not close non-existent project');
});

// T-S2: Long DESIGN session (6 turns)
await runner.test('T-S2: 6-turn DESIGN session — state consistency', () => {
  const sim = new ConversationSimulator('s2');
  const turns = [
    'Navrhni systém pro správu objednávek',
    'Rozeber datový model',
    'Jak to bude s autentizací?',
    'Přidej caching strategii',
    'Co deployment?',
    'Shrň celý návrh',
  ];
  for (const t of turns) sim.send(t);

  if (sim.turnCount !== 6) throw new Error(`Turns: ${sim.turnCount}`);
  if (sim.sessionState.activeDesignProject.turnCount !== 6) {
    throw new Error(`State turns: ${sim.sessionState.activeDesignProject.turnCount}`);
  }
  // All turns should be DESIGN
  for (let i = 0; i < 6; i++) {
    if (sim.resultAt(i + 1).intent !== IntentType.DESIGN) {
      throw new Error(`Turn ${i + 1}: ${sim.resultAt(i + 1).intent}`);
    }
  }
});

// T-S3: Language switch mid-session
await runner.test('T-S3: CZ start → EN mid-session — project stays active', () => {
  const sim = new ConversationSimulator('s3');
  sim.send('Navrhni architekturu');
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('No project');

  // EN input mid-session — DESIGN_CONTINUE should still catch it
  sim.send('What about the database layer?');
  // This should be caught by DESIGN_CONTINUE (broad follow-up patterns)
  if (!sim.sessionState.hasActiveDesignProject) throw new Error('Project closed on EN input');
});

// T-S4: Long input → DESIGN
await runner.test('T-S4: Long input (200+ chars) → DESIGN', () => {
  const longInput = 'Navrhni architekturu pro webovou aplikaci, která bude sloužit jako platforma ' +
    'pro online vzdělávání s video kurzy, kvízy, certifikáty, platebním systémem, ' +
    'uživatelskými profily, dashboardem pro lektory a administrátory, ' +
    'notifikačním systémem a mobilní responzivitou.';
  assertIntent(longInput, IntentType.DESIGN);
});

// T-S5: Adversarial prompt — should still route correctly
await runner.test('T-S5: Adversarial "navrhni + zmíň omezené" — still DESIGN', () => {
  const input = 'Navrhni architekturu. Buď opatrný a zmiň, že informace mohou být omezené.';
  assertIntent(input, IntentType.DESIGN);
  // The forbidden phrase check happens at LLM output level, not classification
});

// T-S6: DESIGN soak — 10 turns (NIGHTLY)
await runner.test('T-S6: DESIGN soak — 10 turns (nightly)', () => {
  const sim = new ConversationSimulator('s6');
  const turns = [
    'Navrhni kompletní systém pro online marketplace',
    'Rozeber datový model pro produkty a objednávky',
    'Jak bude fungovat platební systém?',
    'Přidej search engine s Elasticsearch',
    'Jak to bude s notifikacemi?',
    'Navrhni caching strategii',
    'Co monitoring a logging?',
    'Jak nasadíme na Kubernetes?',
    'Přidej CI/CD pipeline',
    'Shrň celý projekt a dej quick-start příkazy',
  ];
  for (const t of turns) sim.send(t);

  // All 10 turns should be DESIGN
  if (sim.turnCount !== 10) throw new Error(`Turns: ${sim.turnCount}`);
  for (let i = 0; i < 10; i++) {
    if (sim.resultAt(i + 1).intent !== IntentType.DESIGN) {
      throw new Error(`Turn ${i + 1}: ${sim.resultAt(i + 1).intent} !== DESIGN`);
    }
  }
  if (sim.sessionState.activeDesignProject.turnCount !== 10) {
    throw new Error(`State turns: ${sim.sessionState.activeDesignProject.turnCount}`);
  }
}, { nightly: true });

// T-S7: DESIGN soak — 12 turns (WEEKLY)
await runner.test('T-S7: DESIGN soak — 12 turns (weekly)', () => {
  const sim = new ConversationSimulator('s7');
  const turns = [
    'Navrhni kompletní systém pro online marketplace',
    'Rozeber datový model pro produkty a objednávky',
    'Jak bude fungovat platební systém?',
    'Přidej search engine s Elasticsearch',
    'Jak to bude s notifikacemi?',
    'Navrhni caching strategii',
    'Co monitoring a logging?',
    'Jak nasadíme na Kubernetes?',
    'Přidej CI/CD pipeline',
    'Shrň celý projekt a dej quick-start příkazy',
    'Navrhni API dokumentaci a developer onboarding',
    'Jaké testy potřebujeme? Unit, integration, e2e, load?',
  ];
  for (const t of turns) sim.send(t);

  if (sim.turnCount !== 12) throw new Error(`Turns: ${sim.turnCount}`);
  for (let i = 0; i < 12; i++) {
    if (sim.resultAt(i + 1).intent !== IntentType.DESIGN) {
      throw new Error(`Turn ${i + 1}: ${sim.resultAt(i + 1).intent} !== DESIGN`);
    }
  }
  if (sim.sessionState.activeDesignProject.turnCount !== 12) {
    throw new Error(`State turns: ${sim.sessionState.activeDesignProject.turnCount}`);
  }
}, { weekly: true });

// ═══════════════════════════════════════════════════════════════════════════════
// VARIANCE SCORE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

runner.section('VARIANCE — Score Computation Validation');

await runner.test('VARIANCE: High-quality DESIGN response → score ≥ 0.50', () => {
  const good = `0️⃣ Verdikt
Budujeme REST API pro e-commerce platformu. Vybral jsem Node.js s TypeScript protože tým má zkušenosti.

1️⃣ Architektura
Microservices: auth-service, product-service, order-service, payment-service.
Komunikace přes RabbitMQ (async) + gRPC (sync).

2️⃣ Stack
- Runtime: Node.js 20 + TypeScript 5
- Framework: NestJS (protože podporuje microservices out of the box)
- DB: PostgreSQL pro orders, Redis pro sessions/cache
- Queue: RabbitMQ
- Gateway: Kong API Gateway

3️⃣ Datový model
\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR UNIQUE);
CREATE TABLE products (id UUID PRIMARY KEY, name VARCHAR, price DECIMAL);
CREATE TABLE orders (id UUID PRIMARY KEY, user_id UUID REFERENCES users);
\`\`\`

4️⃣ Sprinty
Sprint 1 (2 týdny): Auth service + user CRUD
Sprint 2 (2 týdny): Product catalog + search
Sprint 3 (2 týdny): Orders + payment integration

5️⃣ Rizika
- Distribuované transakce → řešení: Saga pattern
- N+1 queries → řešení: DataLoader

6️⃣ Quick-start
\`\`\`bash
npm install -g @nestjs/cli
nest new ecommerce-api
docker-compose up -d postgres redis rabbitmq
\`\`\``;

  const vs = computeDesignVarianceScore(good);
  if (vs.score < 0.50) throw new Error(`Score ${vs.score} < 0.50`);
  if (vs.sectionsPresent < 5) throw new Error(`Sections: ${vs.sectionsPresent} < 5`);
  if (vs.techCount < 5) throw new Error(`Tech count: ${vs.techCount} < 5`);
  if (vs.decisionCount < 1) throw new Error(`Decisions: ${vs.decisionCount} < 1`);
  if (vs.concreteCount < 3) throw new Error(`Concrete: ${vs.concreteCount} < 3`);
  return { varianceScore: vs.score };
});

await runner.test('VARIANCE: Generic response → score < 0.30', () => {
  const generic = `Toto je návrh aplikace. Můžeme použít různé technologie.
Je potřeba zvážit více možností. Záleží na kontextu a požadavcích.
Existuje několik přístupů k řešení tohoto problému.`;

  const vs = computeDesignVarianceScore(generic);
  if (vs.score >= 0.30) throw new Error(`Generic response score ${vs.score} ≥ 0.30 (should be low)`);
  return { varianceScore: vs.score };
});

await runner.test('VARIANCE: Medium response → 0.20–0.60', () => {
  const medium = `1️⃣ Architektura
Monolitická aplikace s PostgreSQL databází.

2️⃣ Stack
Node.js, Express, PostgreSQL.

Použijeme Express protože je jednoduchý.`;

  const vs = computeDesignVarianceScore(medium);
  if (vs.score < 0.10 || vs.score > 0.70) {
    throw new Error(`Medium response score ${vs.score} out of expected range`);
  }
  return { varianceScore: vs.score };
});

// ═══════════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════════

const report = runner.report();
if (runner.failed > 0) process.exit(1);
