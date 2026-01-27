/**
 * Golden Conversation Tests v44.10
 *
 * These are REFERENCE conversations that MUST NEVER break.
 * They represent the core user scenarios that define CRE behavior.
 *
 * If any of these tests fail, it indicates a REGRESSION in core behavior.
 *
 * Golden Scenarios:
 * 1. STRAHD - Multi-turn CREATIVE campaign ideation
 * 2. PHYSICS EDUCATION - Educational flow with explanations
 * 3. CREATIVE WRITING - Single-turn creative content
 * 4. CAR SEARCH - Practical SEARCH flow with refinements
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChatController,
  SessionState,
} from '../src/unification/chat-controller.js';
import {
  DecisionType,
  IntentType,
} from '../src/unification/cre-decision.js';
import {
  getDefaultHandlers,
} from '../src/unification/handlers.js';

// Configure ChatController
ChatController.configure({
  handlers: getDefaultHandlers(),
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ════════════════════════════════════════════════════════════════════════════════

async function chat(sessionId, message, sessionState = null) {
  const state = sessionState || new SessionState(sessionId);

  const result = await ChatController.handle({
    message,
    sessionId,
    sessionState: state,
    context: {},
  });

  return {
    intent: result.metadata?.decision?.intent,
    type: result.metadata?.decision?.type,
    tools: result.metadata?.decision?.tools || [],
    response: result.response,
    sessionState: state,
  };
}

function assertIntent(result, expectedIntent, message = '') {
  assert.strictEqual(
    result.intent,
    expectedIntent,
    `Expected intent ${expectedIntent}, got ${result.intent}. ${message}`
  );
}

function assertType(result, expectedType, message = '') {
  assert.strictEqual(
    result.type,
    expectedType,
    `Expected type ${expectedType}, got ${result.type}. ${message}`
  );
}

function assertNoTools(result, message = '') {
  assert.strictEqual(
    result.tools.length,
    0,
    `Expected no tools, got [${result.tools.join(', ')}]. ${message}`
  );
}

function assertHasTools(result, expectedTools, message = '') {
  for (const tool of expectedTools) {
    assert.ok(
      result.tools.includes(tool),
      `Expected tool ${tool} in [${result.tools.join(', ')}]. ${message}`
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GOLDEN TEST 1: STRAHD SCENARIO
// ════════════════════════════════════════════════════════════════════════════════
// Multi-turn CREATIVE flow for DnD campaign ideation
// CRITICAL: All turns MUST stay in CREATIVE, NEVER switch to SEARCH
// ════════════════════════════════════════════════════════════════════════════════

describe('GOLDEN 1: STRAHD Campaign Ideation', () => {
  test('All turns stay in CREATIVE mode without web search', async () => {
    const sessionId = `golden-strahd-${Date.now()}`;
    const state = new SessionState(sessionId);

    // Turn 1: Initial creative request
    const turn1 = await chat(sessionId, 'chci vymyslet podobnou kampaň jako Curse of Strahd', state);
    assertIntent(turn1, IntentType.CREATIVE, 'Turn 1 should be CREATIVE');
    assertType(turn1, DecisionType.ANSWER, 'Turn 1 should be ANSWER (not TOOL_CALL)');
    assertNoTools(turn1, 'Turn 1 should have no tools');

    // Turn 2: Follow-up exploring the creative work (v44.9 FIX A)
    const turn2 = await chat(sessionId, 'jaký to může mít vliv na hráče?', state);
    assertIntent(turn2, IntentType.CREATIVE, 'Turn 2 MUST stay CREATIVE (follow-up lock)');
    assertType(turn2, DecisionType.ANSWER, 'Turn 2 should be ANSWER');
    assertNoTools(turn2, 'Turn 2 should have no tools');

    // Turn 3: Style/direction discussion
    const turn3 = await chat(sessionId, 'trochu hororové, ale primárně mi jde o styl kampaně, dej mi pár návrhů', state);
    assertIntent(turn3, IntentType.CREATIVE, 'Turn 3 should be CREATIVE');
    assertType(turn3, DecisionType.ANSWER, 'Turn 3 should be ANSWER');
    assertNoTools(turn3, 'Turn 3 should have no tools');

    console.log(`\n✅ GOLDEN 1: STRAHD - All ${3} turns correctly stayed in CREATIVE mode\n`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GOLDEN TEST 2: PHYSICS EDUCATION
// ════════════════════════════════════════════════════════════════════════════════
// Educational flow explaining concepts with follow-up questions
// CRITICAL: All turns MUST be CONVERSATIONAL, never SEARCH
// ════════════════════════════════════════════════════════════════════════════════

describe('GOLDEN 2: Physics Education Flow', () => {
  test('Educational conversation stays CONVERSATIONAL without web search', async () => {
    const sessionId = `golden-physics-${Date.now()}`;
    const state = new SessionState(sessionId);

    // Turn 1: Initial question
    const turn1 = await chat(sessionId, 'Nechápu Newtonovy zákony', state);
    assertIntent(turn1, IntentType.CONVERSATIONAL, 'Turn 1 should be CONVERSATIONAL');
    assertType(turn1, DecisionType.ANSWER, 'Turn 1 should be ANSWER');
    assertNoTools(turn1, 'Turn 1 should have no tools');

    // Turn 2: Ask for simpler explanation
    const turn2 = await chat(sessionId, 'Můžeš mi to vysvětlit jednodušeji?', state);
    assertIntent(turn2, IntentType.CONVERSATIONAL, 'Turn 2 should be CONVERSATIONAL');
    assertNoTools(turn2, 'Turn 2 should have no tools');

    // Turn 3: Ask for practical example
    const turn3 = await chat(sessionId, 'Zkus to vysvětlit na příkladu z běžného života', state);
    assertIntent(turn3, IntentType.CONVERSATIONAL, 'Turn 3 should be CONVERSATIONAL');
    assertNoTools(turn3, 'Turn 3 should have no tools');

    // Turn 4: Clarification about specific law
    const turn4 = await chat(sessionId, 'Pořád mi není jasný třetí zákon', state);
    assertIntent(turn4, IntentType.CONVERSATIONAL, 'Turn 4 should be CONVERSATIONAL');
    assertNoTools(turn4, 'Turn 4 should have no tools');

    console.log(`\n✅ GOLDEN 2: PHYSICS - All ${4} turns correctly stayed in CONVERSATIONAL mode\n`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GOLDEN TEST 3: CREATIVE WRITING
// ════════════════════════════════════════════════════════════════════════════════
// Single-turn creative content generation
// CRITICAL: MUST be CREATIVE, NEVER search for existing content
// ════════════════════════════════════════════════════════════════════════════════

describe('GOLDEN 3: Creative Writing', () => {
  test('Creative writing requests use CREATIVE intent without web search', async () => {
    const sessionId = `golden-creative-${Date.now()}`;

    // Poem request
    const poem = await chat(sessionId, 'Napiš báseň o zimě');
    assertIntent(poem, IntentType.CREATIVE, 'Poem should be CREATIVE');
    assertType(poem, DecisionType.ANSWER, 'Poem should be ANSWER');
    assertNoTools(poem, 'Poem should have no tools');

    // Story request
    const story = await chat(`${sessionId}-story`, 'Vymysli mi příběh o drakovi');
    assertIntent(story, IntentType.CREATIVE, 'Story should be CREATIVE');
    assertNoTools(story, 'Story should have no tools');

    // Ideas request
    const ideas = await chat(`${sessionId}-ideas`, 'Dej mi nápady na dovolenou');
    // Note: "dej mi nápady" is CREATIVE ideation
    assert.ok(
      [IntentType.CREATIVE, IntentType.CONVERSATIONAL].includes(ideas.intent),
      `Ideas should be CREATIVE or CONVERSATIONAL, got ${ideas.intent}`
    );
    assertNoTools(ideas, 'Ideas should have no tools');

    // Joke request
    const joke = await chat(`${sessionId}-joke`, 'Řekni mi vtip');
    assertIntent(joke, IntentType.CREATIVE, 'Joke should be CREATIVE');
    assertNoTools(joke, 'Joke should have no tools');

    console.log(`\n✅ GOLDEN 3: CREATIVE WRITING - All requests correctly used CREATIVE intent\n`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GOLDEN TEST 4: CAR SEARCH FLOW
// ════════════════════════════════════════════════════════════════════════════════
// Practical search with refinements, then transition to LOCAL
// CRITICAL: SEARCH must persist through refinements, LOCAL must break sticky
// ════════════════════════════════════════════════════════════════════════════════

describe('GOLDEN 4: Car Search Flow', () => {
  test('Search flow maintains sticky intent, LOCAL breaks it', async () => {
    const sessionId = `golden-car-${Date.now()}`;
    const state = new SessionState(sessionId);

    // Turn 1: Initial search
    const turn1 = await chat(sessionId, 'Najdi auta s pohonem 4x4 do 200 tisíc', state);
    assertIntent(turn1, IntentType.SEARCH, 'Turn 1 should be SEARCH');
    assertType(turn1, DecisionType.TOOL_CALL, 'Turn 1 should be TOOL_CALL');
    assertHasTools(turn1, ['web.search'], 'Turn 1 should use web.search');

    // Turn 2: Refinement (sticky SEARCH)
    const turn2 = await chat(sessionId, 'Jen benzínová', state);
    assertIntent(turn2, IntentType.SEARCH, 'Turn 2 should maintain SEARCH (sticky)');
    assertHasTools(turn2, ['web.search'], 'Turn 2 should use web.search');

    // Turn 3: Another refinement
    const turn3 = await chat(sessionId, 'Musí mít uzávěrku diferenciálu', state);
    assertIntent(turn3, IntentType.SEARCH, 'Turn 3 should maintain SEARCH');
    assertHasTools(turn3, ['web.search'], 'Turn 3 should use web.search');

    // Turn 4: Request selection
    const turn4 = await chat(sessionId, 'Vyber tři nejlepší možnosti', state);
    assertIntent(turn4, IntentType.SEARCH, 'Turn 4 should maintain SEARCH');

    // Turn 5: LOCAL breaks sticky SEARCH
    const turn5 = await chat(sessionId, 'Kdy bude úplněk?', state);
    assertIntent(turn5, IntentType.LOCAL, 'Turn 5 should be LOCAL (breaks sticky)');
    assertType(turn5, DecisionType.LOCAL, 'Turn 5 should be LOCAL decision');
    assertNoTools(turn5, 'Turn 5 should have no tools');

    console.log(`\n✅ GOLDEN 4: CAR SEARCH - Sticky SEARCH maintained, LOCAL correctly broke it\n`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GOLDEN TEST 5: FIRST TURN BLOCKING
// ════════════════════════════════════════════════════════════════════════════════
// First turn vague inputs must NOT trigger SEARCH or ASK_USER
// ════════════════════════════════════════════════════════════════════════════════

describe('GOLDEN 5: First Turn Blocking', () => {
  test('Vague first-turn inputs do not trigger SEARCH', async () => {
    // "něco" on first turn (v44.9 FIX B)
    const neco = await chat(`golden-first-${Date.now()}-1`, 'něco');
    assert.notStrictEqual(neco.type, DecisionType.TOOL_CALL, '"něco" should not trigger TOOL_CALL');
    assert.notStrictEqual(neco.intent, IntentType.SEARCH, '"něco" should not be SEARCH on first turn');

    // "hmm" on first turn
    const hmm = await chat(`golden-first-${Date.now()}-2`, 'hmm');
    assert.notStrictEqual(hmm.type, DecisionType.TOOL_CALL, '"hmm" should not trigger TOOL_CALL');

    // First turn should not be ASK_USER
    const vague = await chat(`golden-first-${Date.now()}-3`, 'xyz nejasné');
    assert.notStrictEqual(vague.type, DecisionType.ASK_USER, 'First turn should not be ASK_USER');

    console.log(`\n✅ GOLDEN 5: FIRST TURN BLOCKING - All vague inputs handled correctly\n`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// RUN INFO
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Golden Conversation Tests v44.10                                            ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║  These tests define CORE CRE behavior that MUST NEVER break.                 ║
║                                                                              ║
║  Golden Scenarios:                                                           ║
║    1: STRAHD - Multi-turn CREATIVE campaign ideation                         ║
║    2: PHYSICS - Educational conversation flow                                ║
║    3: CREATIVE WRITING - Single-turn creative content                        ║
║    4: CAR SEARCH - Practical search with LOCAL transition                    ║
║    5: FIRST TURN - Vague input blocking                                      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
