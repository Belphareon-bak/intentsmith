// Chat Quality Harness v48.0 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for the chat quality testing framework itself:
// - MockLLM
// - ConversationRunner
// - Evaluators
// - Reporters
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  ChatTestHarness,
  ConversationRunner,
  MockLLM,
  Config,
} from './chat-harness/runner.js';

import {
  SemanticSimilarityEvaluator,
  FactualityEvaluator,
  ToolCallEvaluator,
  InstructionFollowingEvaluator,
} from './chat-harness/evaluators/index.js';

import {
  JSONReporter,
  ConsoleReporter,
} from './chat-harness/reporters/index.js';

import { PromptRewriteStrategy } from './chat-harness/repair/auto_rewrite_prompt.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Chat Quality Harness v48.0 Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// MockLLM Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 MockLLM');

test('MockLLM instantiation', () => {
  const llm = new MockLLM();
  assertTrue(llm instanceof MockLLM);
  assertEqual(llm.callHistory.length, 0, 'Empty call history');
});

await asyncTest('MockLLM.generate returns default response', async () => {
  const llm = new MockLLM();
  const response = await llm.generate([{ role: 'user', content: 'Hello' }]);
  assertTrue(response !== null, 'Returns a response');
  assertTrue(response.content === 'Mock response', 'Has default content');
});

await asyncTest('MockLLM.generate matches patterns', async () => {
  const llm = new MockLLM();
  llm.setResponse('hello', { content: 'Hi there!', tool_calls: [] });

  const response = await llm.generate([{ role: 'user', content: 'hello world' }]);
  assertEqual(response.content, 'Hi there!', 'Matches pattern');
});

test('MockLLM.reset clears history', () => {
  const llm = new MockLLM();
  llm.callHistory.push({ test: true });
  assertEqual(llm.callHistory.length, 1);
  llm.reset();
  assertEqual(llm.callHistory.length, 0);
});

// ────────────────────────────────────────────────────────────────────────────
// ConversationRunner Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 ConversationRunner');

await asyncTest('ConversationRunner runs multi-turn conversation', async () => {
  const llm = new MockLLM();
  llm.setResponse('hello', { content: 'Hi! How can I help?', tool_calls: [] });
  llm.setResponse('name', { content: 'Nice to meet you, Alice!', tool_calls: [] });

  const runner = new ConversationRunner(llm);

  const scenario = {
    id: 'test_001',
    name: 'Test Scenario',
    turns: [
      { user: 'hello' },
      { user: 'my name is Alice' },
    ],
  };

  const result = await runner.runConversation(scenario);

  assertEqual(result.scenario_id, 'test_001');
  assertEqual(result.turns.length, 2, 'Two turns');
  assertTrue(result.turns[0].assistant_response.includes('Hi'), 'First response');
});

await asyncTest('ConversationRunner handles timeout', async () => {
  const slowLLM = {
    generate: async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { content: 'Too slow', tool_calls: [] };
    },
  };

  const runner = new ConversationRunner(slowLLM, { timeout: 100 });

  const scenario = {
    id: 'timeout_test',
    name: 'Timeout Test',
    turns: [{ user: 'test' }],
  };

  const result = await runner.runConversation(scenario);

  assertTrue(!result.passed, 'Should fail');
  assertTrue(result.turns[0].error?.includes('Timeout'), 'Has timeout error');
});

// ────────────────────────────────────────────────────────────────────────────
// Evaluator Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Evaluators');

await asyncTest('SemanticSimilarityEvaluator calculates similarity', async () => {
  const evaluator = new SemanticSimilarityEvaluator({ threshold: 0.5 });

  const turn = { expected: 'Hello world how are you' };
  const response = 'Hello there world';

  const result = await evaluator.evaluate(turn, response, [], 0);

  assertTrue(result.score > 0, 'Has score');
  assertTrue(result.score <= 1, 'Score <= 1');
  assertEqual(result.evaluator, 'semantic_similarity');
});

await asyncTest('FactualityEvaluator checks facts', async () => {
  const evaluator = new FactualityEvaluator();

  const turn = {
    required_facts: ['Paris is the capital', 'France is in Europe'],
  };
  const response = 'Paris is the capital of France, a country in Europe.';

  const result = await evaluator.evaluate(turn, response, [], 0);

  assertTrue(result.score > 0.5, 'Most facts present');
  assertEqual(result.evaluator, 'factuality');
});

await asyncTest('ToolCallEvaluator validates tool calls', async () => {
  const evaluator = new ToolCallEvaluator();

  const turn = {
    expected_tool: { name: 'fs.read' },
  };
  const response = {
    content: 'Reading file...',
    tool_calls: [{ name: 'fs.read', arguments: { path: '/test' } }],
  };

  const result = await evaluator.evaluate(turn, response, [], 0);

  assertTrue(result.passed, 'Tool was called');
  assertEqual(result.score, 1);
});

await asyncTest('InstructionFollowingEvaluator checks instructions', async () => {
  const evaluator = new InstructionFollowingEvaluator();

  const turn = {
    instructions: [
      { type: 'contains', value: 'hello' },
      { type: 'length_max', value: 100 },
    ],
  };
  const response = 'Hello world!';

  const result = await evaluator.evaluate(turn, response, [], 0);

  assertTrue(result.passed, 'Instructions followed');
  assertEqual(result.score, 1);
});

// ────────────────────────────────────────────────────────────────────────────
// Repair Strategy Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Repair Strategies');

await asyncTest('PromptRewriteStrategy proposes repairs', async () => {
  const strategy = new PromptRewriteStrategy();

  const scenario = {
    turns: [{ user: 'test input', expected_tool: { name: 'fs.read' } }],
  };

  const failedResult = {
    turns: [{
      user_input: 'test input',
      passed: false,
      evaluation: {
        results: [{ evaluator: 'tool_call', passed: false }],
      },
    }],
  };

  const repair = await strategy.propose(scenario, failedResult);

  assertTrue(repair !== null, 'Proposes a repair');
  assertTrue(repair.type !== undefined, 'Has repair type');
});

test('PromptRewriteStrategy.apply modifies scenario', () => {
  const strategy = new PromptRewriteStrategy();

  const scenario = {
    turns: [{ user: 'original input' }],
  };

  const repair = {
    original: 'original input',
    rewritten: 'modified input',
    type: 'test',
  };

  const modified = strategy.apply(scenario, repair);

  assertEqual(modified.turns[0].user, 'modified input');
  assertTrue(modified.turns[0]._repair !== undefined, 'Has repair marker');
});

// ────────────────────────────────────────────────────────────────────────────
// ChatTestHarness Tests
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 ChatTestHarness');

test('ChatTestHarness instantiation', () => {
  const harness = new ChatTestHarness();
  assertTrue(harness instanceof ChatTestHarness);
  assertEqual(harness.evaluators.length, 0);
});

test('ChatTestHarness.registerEvaluator chains', () => {
  const harness = new ChatTestHarness();
  const result = harness
    .registerEvaluator(new SemanticSimilarityEvaluator())
    .registerEvaluator(new FactualityEvaluator());

  assertEqual(harness.evaluators.length, 2);
  assertEqual(result, harness, 'Returns harness for chaining');
});

await asyncTest('ChatTestHarness.run executes with mock scenarios', async () => {
  const harness = new ChatTestHarness({ repair: false });

  harness.mockLLM.setResponse('hello', { content: 'Hi there!', tool_calls: [] });

  const scenarios = [{
    id: 'mock_test',
    name: 'Mock Test',
    turns: [{ user: 'hello' }],
  }];

  const report = await harness.run({ scenarios });

  assertEqual(report.summary.total, 1);
  assertTrue(report.timestamp !== undefined, 'Has timestamp');
  assertTrue(report.ci_pass !== undefined, 'Has CI status');
});

test('Config has required thresholds', () => {
  assertTrue(Config.COHERENCE_THRESHOLD !== undefined);
  assertTrue(Config.TOOL_SUCCESS_THRESHOLD !== undefined);
  assertTrue(Config.FACTUALITY_THRESHOLD !== undefined);
  assertTrue(Config.MAX_REPAIR_ATTEMPTS !== undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
