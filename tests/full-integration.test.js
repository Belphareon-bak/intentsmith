// CRE v36.4.4 Full Integration Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Test the ACTUAL process() function end-to-end
//
// These tests verify that:
// • The real process() function integrates execution authority
// • Real user sentences produce correct responses (not crashes)
// • Execution fallbacks work in the real pipeline
// • No undefined.length errors
//
// ══════════════════════════════════════════════════════════════════════════════

import { 
  DialogState, SystemAction, SpeechAct, 
  WorkflowIntent, DataRequirement, Domain 
} from '../src/chat/dialog-state-v2.js';
import { process } from '../src/chat/cre-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  ✅ ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
      console.log(`  ❌ ${name}`);
      console.log(`     └─ ${error.message}`);
    }
  })();
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) {
    throw new Error(`${msg}: expected true, got false`);
  }
}

function assertFalse(condition, msg = '') {
  if (condition) {
    throw new Error(`${msg}: expected false, got true`);
  }
}

function assertContains(text, substring, msg = '') {
  if (!text || !text.includes(substring)) {
    throw new Error(`${msg}: expected "${substring}" in "${text?.substring(0, 100)}..."`);
  }
}

function assertNotContains(text, substring, msg = '') {
  if (text && text.includes(substring)) {
    throw new Error(`${msg}: did not expect "${substring}" in text`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REAL USER SENTENCES
// ════════════════════════════════════════════════════════════════════════════

const REAL_SENTENCES = {
  NEWS_TRUMP: 'dej mi souhrn zpráv za poslední týden ohledně Trumpovi politiky',
  CAR_SEARCH: 'najdi mi inzerát na auto, které má 4x4 a uzávěrku diferenciálu, benzínový motor a je do 200 tisíc',
  FLAT_SEARCH: 'hledám byt 3+1 v Praze do 25 tisíc měsíčně',
  NEWS_AI: 'co je nového v oblasti umělé inteligence?',
  ADVICE_CAR: 'jak najít auto s pohonem 4x4?',
  SIMPLE_CHAT: 'ahoj, jak se máš?',
  FUEL_2032: 'kolik bude stát benzín v roce 2032?',
  QUANTUM_HOROSCOPE: 'jaký je můj kvantový horoskop na tento týden?'
};

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('🧪 CRE v36.4.4 FULL INTEGRATION TESTS');
  console.log('════════════════════════════════════════════════════════════');
  console.log('Testing the ACTUAL process() function\n');

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 1: NEWS AGGREGATION
  // ════════════════════════════════════════════════════════════════════════════

  console.log('────────────────────────────────────────────────────────────');
  console.log('📰 NEWS AGGREGATION (without sources)');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-1: NEWS_TRUMP - does not crash', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.NEWS_TRUMP, state, {});
    assertTrue(result.success !== false, 'Should not fail');
    assertTrue(result.text !== undefined, 'Should have text response');
  });

  await test('INT-2: NEWS_TRUMP - asks for sources', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.NEWS_TRUMP, state, {});
    
    // Should ask about sources, not generate artifact
    assertTrue(
      result.text.includes('zdroj') || 
      result.text.includes('Reuters') || 
      result.text.includes('zpravodajství'),
      'Response should ask about sources'
    );
  });

  await test('INT-3: NEWS_TRUMP - correct speechAct', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.NEWS_TRUMP, state, {});
    assertEqual(result.speechAct, SpeechAct.QUESTION, 'Should be QUESTION speechAct');
  });

  await test('INT-4: NEWS_AI - same behavior', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.NEWS_AI, state, {});
    assertTrue(result.success !== false, 'Should not fail');
    assertTrue(
      result.text.includes('zdroj') || 
      result.text.includes('Reuters') ||
      result.text.includes('zpravodajství') ||
      result.decision.action === SystemAction.ASK_DATA_SOURCE,
      'Should handle news query properly'
    );
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 2: MARKET SEARCH
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('🔍 MARKET SEARCH (without backend)');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-5: CAR_SEARCH - does not crash', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.CAR_SEARCH, state, {});
    assertTrue(result.success !== false, 'Should not fail');
  });

  await test('INT-6: CAR_SEARCH - offers alternatives', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.CAR_SEARCH, state, {});
    
    // Should offer truthful capability-based alternatives, not "nemohu"
    assertTrue(
      result.text.includes('Mohu') || 
      result.text.includes('inzeráty') ||
      result.text.includes('vyhledávání') ||
      result.text.includes('Sauto'),
      'Response should offer truthful capabilities'
    );
  });

  await test('INT-7: CAR_SEARCH - not generic advice', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.CAR_SEARCH, state, {});
    
    // Should NOT be generic "nemohu" or "jako AI"
    assertFalse(
      result.text.includes('Vyberte si webové stránky') ||
      result.text.includes('jako AI') ||
      result.text.includes('nemohu v reálném čase') ||
      result.text.includes('nemohu prohledávat'),
      'Response should not contain capability lies'
    );
  });

  await test('INT-8: FLAT_SEARCH - same behavior', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.FLAT_SEARCH, state, {});
    assertTrue(result.success !== false, 'Should not fail');
    assertTrue(
      result.text.includes('Mohu') ||
      result.text.includes('nemovitosti') ||
      result.text.includes('vyhled') ||
      result.text.includes('Sreality'),
      'Should handle flat search with truthful capabilities'
    );
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 3: ADVICE (should work normally)
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('💡 ADVICE (should proceed normally)');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-9: ADVICE_CAR - not blocked', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.ADVICE_CAR, state, {});
    assertTrue(result.success !== false, 'Should not fail');
    
    // Should NOT be blocked by execution authority
    assertFalse(
      result.decision.action === SystemAction.BLOCK_NO_DATA ||
      result.decision.action === SystemAction.ASK_DATA_SOURCE,
      'ADVICE should not be blocked'
    );
  });

  await test('INT-10: SIMPLE_CHAT - not blocked', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.SIMPLE_CHAT, state, {});
    assertTrue(result.success !== false, 'Should not fail');
    
    // Should proceed to answer (any answer type)
    const validActions = [
      SystemAction.ANSWER,
      SystemAction.ANSWER_PROVISIONAL,
      SystemAction.ANSWER_WITH_DISCLAIMER,
      SystemAction.ASK_CLARIFICATION
    ];
    assertTrue(
      validActions.includes(result.decision.action),
      `CHAT should proceed normally, got ${result.decision.action}`
    );
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 4: EPISTEMIC REFUSALS
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('🚫 EPISTEMIC REFUSALS');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-11: FUEL_2032 - refuses impossible prediction', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.FUEL_2032, state, {});
    assertEqual(result.decision.action, SystemAction.REFUSE, 'Should REFUSE');
  });

  await test('INT-12: QUANTUM_HOROSCOPE - refuses non-existent concept', async () => {
    const state = new DialogState();
    const result = await process(REAL_SENTENCES.QUANTUM_HOROSCOPE, state, {});
    assertEqual(result.decision.action, SystemAction.REFUSE, 'Should REFUSE');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 5: WITH VALID CONTEXT
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('✅ WITH VALID CONTEXT (should proceed)');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-13: NEWS with sources - proceeds', async () => {
    const state = new DialogState();
    const context = {
      newsSources: ['reuters', 'ap'],
      corpus: [{ title: 'Test article', content: 'Test content' }]
    };
    const result = await process(REAL_SENTENCES.NEWS_TRUMP, state, context);
    
    // With valid context, should not ask for sources
    assertTrue(
      result.decision.action !== SystemAction.ASK_DATA_SOURCE ||
      result.state.workflow.dataAvailable,
      'With sources, should proceed'
    );
  });

  await test('INT-14: SEARCH with backend - proceeds', async () => {
    const state = new DialogState();
    const context = {
      searchBackend: 'sauto',
      marketplace: 'cars'
    };
    const result = await process(REAL_SENTENCES.CAR_SEARCH, state, context);
    
    // With valid context, should not offer setup
    assertTrue(
      result.decision.action !== SystemAction.OFFER_SEARCH_SETUP ||
      result.state.workflow.dataAvailable,
      'With backend, should proceed'
    );
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 6: NO CRASHES
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('💥 NO CRASHES (all sentences)');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-15: All sentences - no crashes', async () => {
    for (const [name, sentence] of Object.entries(REAL_SENTENCES)) {
      const state = new DialogState();
      let crashed = false;
      let error = null;
      
      try {
        const result = await process(sentence, state, {});
        if (!result || result.success === false && !result.text) {
          crashed = true;
          error = 'No response';
        }
      } catch (e) {
        crashed = true;
        error = e.message;
      }
      
      if (crashed) {
        throw new Error(`${name} crashed: ${error}`);
      }
    }
  });

  await test('INT-16: Empty context - no undefined errors', async () => {
    const state = new DialogState();
    // This was the exact error: "Cannot read properties of undefined (reading 'length')"
    const result = await process('vytvoř report o prodeji', state, {});
    assertTrue(result.success !== false, 'Should not crash with empty context');
  });

  await test('INT-17: Null context - no undefined errors', async () => {
    const state = new DialogState();
    // Pass undefined as context
    const result = await process('souhrn zpráv', state, undefined);
    assertTrue(result.success !== false, 'Should not crash with undefined context');
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST SUITE 7: CALENDAR QUERIES (v36.5)
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n────────────────────────────────────────────────────────────');
  console.log('📅 CALENDAR QUERIES (auto-computed, no LLM needed)');
  console.log('────────────────────────────────────────────────────────────');

  await test('INT-18: Moon phase query - auto-answered', async () => {
    const state = new DialogState();
    const result = await process('za kolik dní bude úplněk?', state, {});
    assertTrue(result.success !== false, 'Should not fail');
    assertTrue(
      result.text.includes('úplněk') && result.text.includes('dní'),
      'Should answer with moon phase info'
    );
    // Should NOT ask for date
    assertFalse(
      result.text.includes('potřeboval bych') || 
      result.text.includes('aktuální datum'),
      'Should not ask for current date'
    );
  });

  await test('INT-19: Date query - auto-answered', async () => {
    const state = new DialogState();
    const result = await process('jaký je dnes den?', state, {});
    assertTrue(result.success !== false, 'Should not fail');
    assertTrue(
      result.text.includes('20') && (
        result.text.includes('pondělí') || 
        result.text.includes('úterý') ||
        result.text.includes('středa') ||
        result.text.includes('čtvrtek') ||
        result.text.includes('pátek') ||
        result.text.includes('sobota') ||
        result.text.includes('neděle')
      ),
      'Should answer with current date and day of week'
    );
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('📊 FULL INTEGRATION TEST SUMMARY');
  console.log('════════════════════════════════════════════════════════════');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`  ✅ Passed:  ${passed}`);
  console.log(`  ❌ Failed:  ${failed}`);

  if (failed > 0) {
    console.log('\n❌ FAILURES:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  ${r.name}: ${r.error}`);
    });
    
    throw new Error('Full integration tests failed');
  } else {
    console.log('\n✅ ALL FULL INTEGRATION TESTS PASSED');
  }
}

// Run
runTests().catch(console.error);
