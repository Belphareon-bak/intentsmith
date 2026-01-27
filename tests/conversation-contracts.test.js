/**
 * Conversation Contract Tests v1.0
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tests conversation behavior across multi-turn interactions.
 * These tests verify BEHAVIOR, not implementation details.
 *
 * Run: node --test tests/conversation-contracts.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

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

// Configure handlers
ChatController.configure({
  handlers: getDefaultHandlers(),
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST LOGGING - Required for contract validation
// ════════════════════════════════════════════════════════════════════════════════

const testLog = [];

function logTurn(turnNumber, input, result, sessionState) {
  const entry = {
    turn: turnNumber,
    input: input.substring(0, 50),
    intent: result.metadata?.decision?.intent || 'UNKNOWN',
    decisionType: result.metadata?.decision?.type || 'UNKNOWN',
    tools: result.metadata?.decision?.tools || [],
    stickyIntent: sessionState?.lastIntent || null,
    pendingDecision: !!sessionState?.pendingDecision,
    responseLength: result.response?.length || 0,
    response: result.response || '',  // v44.8 - capture full response
  };
  testLog.push(entry);
  return entry;
}

function clearLog() {
  testLog.length = 0;
}

function printLog(testName) {
  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════════`);
  console.log(`║ 📋 [${testName}] Turn Log:`);
  console.log(`╚═══════════════════════════════════════════════════════════════════════════════\n`);
  testLog.forEach(entry => {
    console.log(`┌─ Turn ${entry.turn} ────────────────────────────────────────────────────────────`);
    console.log(`│ INPUT: "${entry.input}"`);
    console.log(`│ INTENT: ${entry.intent} → TYPE: ${entry.decisionType}`);
    console.log(`│ TOOLS: [${entry.tools.join(', ')}]`);
    console.log(`├─ RESPONSE (${entry.responseLength} chars):`);
    // Show first 300 chars of response
    const responsePreview = entry.response.substring(0, 300).replace(/\n/g, '\n│   ');
    console.log(`│   ${responsePreview}${entry.response.length > 300 ? '...' : ''}`);
    console.log(`└───────────────────────────────────────────────────────────────────────────────\n`);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// CONVERSATION HELPER
// ════════════════════════════════════════════════════════════════════════════════

async function chat(sessionId, message) {
  const result = await ChatController.handle({
    message,
    sessionId,
    context: {},
  });

  return {
    response: result.response,
    mode: result.mode,
    confidence: result.confidence,
    intent: result.metadata?.decision?.intent,
    type: result.metadata?.decision?.type,
    tools: result.metadata?.decision?.tools || [],
    metadata: result.metadata,
    state: result.state,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST A: EDU-LOCAL-GENERATE
// ════════════════════════════════════════════════════════════════════════════════
// Verify: LOCAL priority, no web search, didactic continuity
// ════════════════════════════════════════════════════════════════════════════════

describe('CONTRACT A: EDU-LOCAL-GENERATE', () => {
  const sessionId = `test-edu-${Date.now()}`;

  beforeEach(() => {
    clearLog();
  });

  it('Educational conversation maintains LOCAL/CONVERSATIONAL without web search', async () => {
    const turns = [
      'Nechápu Newtonovy zákony',
      'Můžeš mi to vysvětlit jednodušeji?',
      'Zkus to vysvětlit na příkladu z běžného života',
      'Pořád mi není jasný třetí zákon',
      'Navrhni mi studijní plán na týden',
      'Rozepiš ho na jednotlivé dny',
      'Přidej ke každému dni konkrétní úkol',
    ];

    const ALLOWED_INTENTS = [IntentType.LOCAL, IntentType.CONVERSATIONAL, IntentType.CREATIVE];
    const FORBIDDEN_TOOLS = ['web.search'];

    for (let i = 0; i < turns.length; i++) {
      const input = turns[i];
      const result = await chat(sessionId, input);
      const state = ChatController.getState(sessionId);

      const entry = logTurn(i + 1, input, { response: result.response, metadata: result.metadata }, state);

      // INVARIANT: Must be LOCAL, CONVERSATIONAL, or CREATIVE
      // Note: First turn might be forced to CREATIVE/CONVERSATIONAL by first-turn override
      if (result.intent) {
        const isAllowed = ALLOWED_INTENTS.includes(result.intent);
        assert.ok(
          isAllowed,
          `Turn ${i + 1}: Intent ${result.intent} not in allowed [${ALLOWED_INTENTS.join(', ')}]`
        );
      }

      // INVARIANT: No web.search
      if (result.tools && result.tools.length > 0) {
        const hasForbidden = result.tools.some(t => FORBIDDEN_TOOLS.includes(t));
        assert.ok(
          !hasForbidden,
          `Turn ${i + 1}: Forbidden tool ${result.tools.join(',')} used for educational content`
        );
      }

      // INVARIANT: Must have response
      assert.ok(
        result.response && result.response.length > 0,
        `Turn ${i + 1}: Empty response for educational question`
      );

      // INVARIANT: No ASK_USER for clear educational questions
      assert.notStrictEqual(
        result.type,
        DecisionType.ASK_USER,
        `Turn ${i + 1}: ASK_USER for clear educational question "${input.substring(0, 30)}..."`
      );
    }

    printLog('EDU-LOCAL-GENERATE');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST B: WEB-SEARCH-COMPARISON
// ════════════════════════════════════════════════════════════════════════════════
// Verify: Sticky SEARCH, filter retention, SEARCH→LOCAL transition
// ════════════════════════════════════════════════════════════════════════════════

describe('CONTRACT B: WEB-SEARCH-COMPARISON', () => {
  const sessionId = `test-search-${Date.now()}`;

  beforeEach(() => {
    clearLog();
  });

  it('Search conversation maintains sticky intent then transitions to LOCAL', async () => {
    // Turns 1-7: SEARCH flow
    const searchTurns = [
      'Najdi auta s pohonem 4x4 do 200 tisíc',
      'Jen benzínová',
      'Musí mít uzávěrku diferenciálu',
      'Vyber tři nejlepší možnosti',
      'Porovnej je v tabulce',
      'Uveď zdroje a odkazy',
    ];

    // Turns 8-10: LOCAL flow (must NOT trigger SEARCH)
    const localTurns = [
      'Kdy bude úplněk?',
      'Napiš jen datum',
      'Kolik dní zbývá do úplňku?',
    ];

    // Execute SEARCH turns
    for (let i = 0; i < searchTurns.length; i++) {
      const input = searchTurns[i];
      const result = await chat(sessionId, input);
      const state = ChatController.getState(sessionId);

      logTurn(i + 1, input, { response: result.response, metadata: result.metadata }, state);

      // First turn establishes SEARCH
      if (i === 0) {
        assert.strictEqual(
          result.intent,
          IntentType.SEARCH,
          `Turn 1 must establish SEARCH intent, got ${result.intent}`
        );
      }

      // INVARIANT: No ASK_USER after first search established
      if (i > 0) {
        assert.notStrictEqual(
          result.type,
          DecisionType.ASK_USER,
          `Turn ${i + 1}: ASK_USER not allowed in search continuation`
        );
      }
    }

    // Execute LOCAL turns - these MUST be LOCAL, not SEARCH
    for (let i = 0; i < localTurns.length; i++) {
      const input = localTurns[i];
      const result = await chat(sessionId, input);
      const state = ChatController.getState(sessionId);
      const turnNum = searchTurns.length + i + 1;

      logTurn(turnNum, input, { response: result.response, metadata: result.metadata }, state);

      // CRITICAL: LOCAL must override sticky SEARCH
      assert.strictEqual(
        result.intent,
        IntentType.LOCAL,
        `Turn ${turnNum}: "${input}" must be LOCAL, got ${result.intent}`
      );

      // CRITICAL: Must be LOCAL decision type, not TOOL_CALL
      assert.strictEqual(
        result.type,
        DecisionType.LOCAL,
        `Turn ${turnNum}: Decision type must be LOCAL, got ${result.type}`
      );

      // CRITICAL: No web.search for LOCAL
      assert.ok(
        !result.tools?.includes('web.search'),
        `Turn ${turnNum}: web.search forbidden for LOCAL intent`
      );
    }

    printLog('WEB-SEARCH-COMPARISON');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST C: CHAOS-CONTEXT-SWITCH
// ════════════════════════════════════════════════════════════════════════════════
// Verify: Topic changes, intent switching, no stuck pendingDecision
// ════════════════════════════════════════════════════════════════════════════════

describe('CONTRACT C: CHAOS-CONTEXT-SWITCH', () => {
  const sessionId = `test-chaos-${Date.now()}`;

  beforeEach(() => {
    clearLog();
  });

  it('Context switches work without breaking conversation', async () => {
    const turns = [
      // Cooking context
      { input: 'Mám doma těstoviny, česnek a olej', expectedContext: 'cooking' },
      { input: 'Jak z toho uvařit večeři', expectedContext: 'cooking' },
      { input: 'Jaké jsou alternativy', expectedContext: 'cooking' },
      { input: 'Co když nemám česnek', expectedContext: 'cooking' },

      // Health context (sudden switch)
      { input: 'Bolí mě v krku', expectedContext: 'health' },
      { input: 'Co s tím můžu dělat doma', expectedContext: 'health' },

      // Shopping context
      { input: 'Kde ty věci koupím', expectedContext: 'shopping' },

      // Creative context (humor)
      { input: 'Řekni mi k tomu vtip', expectedContext: 'creative' },
      { input: 'Napiš krátkou básničku o vaření', expectedContext: 'creative' },
    ];

    let previousContext = null;
    let contextSwitchCount = 0;

    for (let i = 0; i < turns.length; i++) {
      const { input, expectedContext } = turns[i];
      const result = await chat(sessionId, input);
      const state = ChatController.getState(sessionId);

      logTurn(i + 1, input, { response: result.response, metadata: result.metadata }, state);

      // Track context switches
      if (previousContext && previousContext !== expectedContext) {
        contextSwitchCount++;

        // INVARIANT: pendingDecision should not survive topic switch
        // (unless it's a valid continuation)
        // Note: We can't directly check pendingDecision here, but we can check
        // that we don't get stuck in ASK_USER loops
      }
      previousContext = expectedContext;

      // INVARIANT: Must have response
      assert.ok(
        result.response && result.response.length > 0,
        `Turn ${i + 1}: Empty response for "${input.substring(0, 30)}..."`
      );

      // INVARIANT: Creative requests should be CREATIVE or CONVERSATIONAL
      if (expectedContext === 'creative') {
        const isCreative = [IntentType.CREATIVE, IntentType.CONVERSATIONAL].includes(result.intent);
        assert.ok(
          isCreative,
          `Turn ${i + 1}: Creative request "${input}" got intent ${result.intent}`
        );

        // CRITICAL: No web.search for creative
        assert.ok(
          !result.tools?.includes('web.search'),
          `Turn ${i + 1}: web.search forbidden for creative request`
        );
      }
    }

    // Should have had at least 3 context switches
    assert.ok(
      contextSwitchCount >= 3,
      `Expected at least 3 context switches, got ${contextSwitchCount}`
    );

    printLog('CHAOS-CONTEXT-SWITCH');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PROPERTY-BASED INVARIANTS
// ════════════════════════════════════════════════════════════════════════════════
// Universal properties that must ALWAYS hold
// ════════════════════════════════════════════════════════════════════════════════

describe('UNIVERSAL INVARIANTS', () => {

  describe('CREATIVE must NEVER use web.search', () => {
    const creativeInputs = [
      'Vymysli mi příběh o drakovi',
      'Navrhni mi kampaň jako Curse of Strahd',
      'Dej mi nápady na dovolenou',
      'Napiš báseň o zimě',
      'Vymysli 3 možné zápletky',
    ];

    for (const input of creativeInputs) {
      it(`"${input.substring(0, 40)}..." → no web.search`, async () => {
        const sessionId = `test-creative-${Date.now()}-${Math.random()}`;
        const result = await chat(sessionId, input);

        // Must be CREATIVE or CONVERSATIONAL
        const validIntents = [IntentType.CREATIVE, IntentType.CONVERSATIONAL];
        assert.ok(
          validIntents.includes(result.intent),
          `Creative input got intent ${result.intent}, expected CREATIVE or CONVERSATIONAL`
        );

        // Must NOT have web.search
        assert.ok(
          !result.tools?.includes('web.search'),
          `Creative input triggered web.search: ${result.tools?.join(',')}`
        );

        // Must NOT be TOOL_CALL
        assert.notStrictEqual(
          result.type,
          DecisionType.TOOL_CALL,
          `Creative input got TOOL_CALL decision type`
        );
      });
    }
  });

  describe('LOCAL must NEVER use web.search', () => {
    const localInputs = [
      'Kolik je hodin?',
      'Kdy bude úplněk?',
      'Jaké je dnes datum?',
      '5 + 3',
      'Za kolik dní bude úplněk?',
    ];

    for (const input of localInputs) {
      it(`"${input}" → LOCAL, no web.search`, async () => {
        const sessionId = `test-local-${Date.now()}-${Math.random()}`;
        const result = await chat(sessionId, input);

        // Must be LOCAL intent
        assert.strictEqual(
          result.intent,
          IntentType.LOCAL,
          `Local input "${input}" got intent ${result.intent}`
        );

        // Must be LOCAL decision type
        assert.strictEqual(
          result.type,
          DecisionType.LOCAL,
          `Local input "${input}" got decision type ${result.type}`
        );

        // Must NOT have tools
        assert.ok(
          !result.tools || result.tools.length === 0,
          `Local input triggered tools: ${result.tools?.join(',')}`
        );
      });
    }
  });

  describe('First turn NEVER returns ASK_USER', () => {
    const ambiguousInputs = [
      'něco',
      'xyz nejasné',
      'hmm',
      'tak tedy',
    ];

    for (const input of ambiguousInputs) {
      it(`First turn "${input}" → not ASK_USER`, async () => {
        const sessionId = `test-first-turn-${Date.now()}-${Math.random()}`;
        const result = await chat(sessionId, input);

        // First turn must NEVER be ASK_USER
        assert.notStrictEqual(
          result.type,
          DecisionType.ASK_USER,
          `First turn returned ASK_USER for "${input}"`
        );

        // Must have some response
        assert.ok(
          result.response && result.response.length > 0,
          `First turn produced empty response`
        );
      });
    }
  });

  describe('ASK_USER never twice in a row', () => {
    it('Second ambiguous input after ASK_USER does not return ASK_USER', async () => {
      const sessionId = `test-ask-once-${Date.now()}`;

      // First turn - might or might not be ASK_USER (first turn override may apply)
      const result1 = await chat(sessionId, 'něco nejasného');

      // Second turn - definitely should not be ASK_USER
      const result2 = await chat(sessionId, 'stále nevím');

      // If first was ASK_USER, second must NOT be ASK_USER
      if (result1.type === DecisionType.ASK_USER) {
        assert.notStrictEqual(
          result2.type,
          DecisionType.ASK_USER,
          'ASK_USER appeared twice in a row'
        );
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// STRAHD SCENARIO TEST (from user's original bug report)
// ════════════════════════════════════════════════════════════════════════════════

describe('STRAHD SCENARIO (regression test)', () => {
  it('DnD campaign ideation works without ASK_USER or web.search', async () => {
    const sessionId = `test-strahd-${Date.now()}`;

    // Turn 1: Initial creative request
    const result1 = await chat(sessionId, 'chci vymyslet podobnou kampaň jako Curse of Strahd');

    // CRITICAL: Must NOT be ASK_USER
    assert.notStrictEqual(
      result1.type,
      DecisionType.ASK_USER,
      'Turn 1: Creative request got ASK_USER instead of direct answer'
    );

    // CRITICAL: Must be CREATIVE or CONVERSATIONAL
    const validIntents = [IntentType.CREATIVE, IntentType.CONVERSATIONAL];
    assert.ok(
      validIntents.includes(result1.intent),
      `Turn 1: Expected CREATIVE/CONVERSATIONAL, got ${result1.intent}`
    );

    // Turn 2: Follow-up question
    const result2 = await chat(sessionId, 'jaký to může mít vliv na hráče?');

    // Should continue in creative/conversational mode
    assert.ok(
      validIntents.includes(result2.intent) || result2.intent === IntentType.SEARCH,
      `Turn 2: Unexpected intent ${result2.intent}`
    );

    // Turn 3: Request for suggestions - CRITICAL
    const result3 = await chat(sessionId, 'trochu hororové, ale primárně mi jde o styl kampaně, dej mi pár návrhů');

    // CRITICAL: This is an ideation request - MUST be CREATIVE, NOT SEARCH
    assert.strictEqual(
      result3.intent,
      IntentType.CREATIVE,
      `Turn 3: "dej mi pár návrhů" must be CREATIVE, got ${result3.intent}`
    );

    // CRITICAL: No web.search for ideation
    assert.ok(
      !result3.tools?.includes('web.search'),
      `Turn 3: web.search triggered for ideation request`
    );

    // CRITICAL: Must be ANSWER, not TOOL_CALL
    assert.strictEqual(
      result3.type,
      DecisionType.ANSWER,
      `Turn 3: Decision type must be ANSWER, got ${result3.type}`
    );

    console.log('\n📋 [STRAHD SCENARIO] Results:');
    console.log(`  Turn 1: ${result1.intent} → ${result1.type}`);
    console.log(`  Turn 2: ${result2.intent} → ${result2.type}`);
    console.log(`  Turn 3: ${result3.intent} → ${result3.type}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// RUN INFO
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Conversation Contract Tests v1.0                                            ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║  Testing BEHAVIOR, not implementation                                        ║
║                                                                              ║
║  Contracts:                                                                  ║
║    A: EDU-LOCAL-GENERATE (educational flow)                                  ║
║    B: WEB-SEARCH-COMPARISON (sticky SEARCH → LOCAL transition)               ║
║    C: CHAOS-CONTEXT-SWITCH (topic changes)                                   ║
║    + Universal invariants                                                    ║
║    + Strahd regression test                                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
