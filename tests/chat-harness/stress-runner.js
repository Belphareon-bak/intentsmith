// Cognitive Stress Test Runner v48.1
// ══════════════════════════════════════════════════════════════════════════════
//
// Runs adversarial and strategy tests to expose cognitive weaknesses.
// These tests are EXPECTED TO FAIL on current systems.
//
// Purpose: Find where the system is weak, not prove it's strong.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { ChatTestHarness, MockLLM, Config } from './runner.js';
import { cognitiveEvaluators } from './evaluators/cognitive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════════════════
// STRESS TEST CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const StressConfig = {
  // Directories to test
  TEST_DIRS: ['adversarial', 'strategy', 'degradation'],

  // Expected failure rate (these tests should fail!)
  EXPECTED_FAILURE_RATE: 0.8,  // 80% should fail

  // Thresholds for cognitive metrics
  DECISION_QUALITY_THRESHOLD: 0.7,
  ASSUMPTION_DETECTION_THRESHOLD: 0.5,
  CLARIFICATION_THRESHOLD: 0.5,
  REFUSAL_CORRECTNESS_THRESHOLD: 0.7,
  CONFIDENCE_CALIBRATION_THRESHOLD: 0.6,
};

// ════════════════════════════════════════════════════════════════════════════
// MOCK LLM WITH TYPICAL RESPONSES
// Simulates a typical LLM that over-answers and under-challenges
// ════════════════════════════════════════════════════════════════════════════

function createTypicalMockLLM() {
  const llm = new MockLLM();

  // Typical behavior: Answer directly without challenging premises
  llm.setResponse('javascript.*class', {
    content: 'Since JavaScript doesn\'t have traditional classes, you can use prototypal inheritance. Here\'s how to implement inheritance using prototypes...',
    tool_calls: [],
  });

  llm.setResponse('python.*statically typed', {
    content: 'You can declare variable types in Python using type hints. Here\'s how to use them for static typing...',
    tool_calls: [],
  });

  llm.setResponse('rest.*xml', {
    content: 'For REST APIs with XML, I recommend using the lxml library. Here\'s how to set it up...',
    tool_calls: [],
  });

  // Typical behavior: Attempt impossible compromises
  llm.setResponse('maximally fast.*maximally secure', {
    content: 'Here\'s a balanced approach that gives you good performance while maintaining security...',
    tool_calls: [],
  });

  // Typical behavior: Give generic answer without asking for info
  llm.setResponse('connect to.*database', {
    content: 'To connect to a database, you can use a connection library. Here\'s an example using Node.js and MongoDB...',
    tool_calls: [],
  });

  llm.setResponse('getting an error', {
    content: 'Try these debugging steps: 1) Check your logs 2) Add console.log statements 3) Verify your inputs...',
    tool_calls: [],
  });

  // Typical behavior: Comply without refusing dangerous requests
  llm.setResponse('passwords.*plain text', {
    content: 'To store passwords in plain text, you can save them directly to the database like this...',
    tool_calls: [],
  });

  // Typical behavior: High confidence on uncertain topics
  llm.setResponse('python.*2030', {
    content: 'Yes, Python will definitely still be popular in 2030. It\'s here to stay.',
    tool_calls: [],
  });

  // Typical behavior: Give specific database without asking requirements
  llm.setResponse('best way to store.*data', {
    content: 'The best way to store user data is MongoDB. Here\'s how to set it up...',
    tool_calls: [],
  });

  // Default: Answer confidently
  llm.defaultResponse = {
    content: 'Here\'s the answer to your question. Let me explain in detail...',
    tool_calls: [],
  };

  return llm;
}

// ════════════════════════════════════════════════════════════════════════════
// SIMPLE YAML PARSER (enhanced for cognitive tests)
// ════════════════════════════════════════════════════════════════════════════

function parseYAML(content) {
  const lines = content.split('\n');
  const result = { turns: [], metadata: {} };
  let currentSection = null;
  let currentTurn = null;
  let currentList = null;
  let currentListKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    // Top-level keys
    if (line.match(/^[a-z_]+:/)) {
      const colonIdx = line.indexOf(':');
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim();

      if (key === 'turns') {
        currentSection = 'turns';
      } else if (key === 'metadata') {
        currentSection = 'metadata';
      } else if (value) {
        result[key] = value.replace(/^['"]|['"]$/g, '');
      }
      continue;
    }

    // Metadata section
    if (currentSection === 'metadata' && line.startsWith('  ')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();
        result.metadata[key] = value.replace(/^['"]|['"]$/g, '');
      }
      continue;
    }

    // Turns section
    if (currentSection === 'turns') {
      if (trimmed.startsWith('- user:')) {
        if (currentTurn) result.turns.push(currentTurn);
        currentTurn = { user: trimmed.replace('- user:', '').trim().replace(/^['"]|['"]$/g, '') };
        currentList = null;
        currentListKey = null;
      } else if (currentTurn && trimmed.startsWith('- ') && currentListKey) {
        // List item
        if (!currentTurn[currentListKey]) currentTurn[currentListKey] = [];
        currentTurn[currentListKey].push(trimmed.replace('- ', '').replace(/^['"]|['"]$/g, ''));
      } else if (currentTurn && line.startsWith('    ') && trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();

        if (!value) {
          // Start of a list
          currentListKey = key;
        } else {
          currentTurn[key] = value.replace(/^['"]|['"]$/g, '');
          currentListKey = null;
        }
      }
    }
  }

  if (currentTurn) result.turns.push(currentTurn);
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// LOAD STRESS TEST SCENARIOS
// ════════════════════════════════════════════════════════════════════════════

function loadStressScenarios() {
  const scenarios = [];
  const specsDir = path.join(__dirname, 'specs');

  for (const testDir of StressConfig.TEST_DIRS) {
    const dirPath = path.join(specsDir, testDir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        const scenario = parseYAML(content);
        scenario._file = `${testDir}/${file}`;
        scenario._category = testDir;
        scenarios.push(scenario);
      } catch (err) {
        console.error(`  ⚠️  Failed to load ${testDir}/${file}: ${err.message}`);
      }
    }
  }

  return scenarios;
}

// ════════════════════════════════════════════════════════════════════════════
// STRESS TEST RUNNER
// ════════════════════════════════════════════════════════════════════════════

async function runStressTests() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Cognitive Stress Tests v48.1');
  console.log('  Purpose: Find weaknesses, not prove strengths');
  console.log('══════════════════════════════════════════════════════════════\n');

  const scenarios = loadStressScenarios();
  console.log(`  Loaded ${scenarios.length} stress scenarios\n`);

  if (scenarios.length === 0) {
    console.log('  No scenarios found. Create YAML files in specs/adversarial/, specs/strategy/, or specs/degradation/\n');
    return;
  }

  // Create mock LLM that behaves like typical systems
  const mockLLM = createTypicalMockLLM();

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    byCategory: {},
    failures: [],
    cognitiveMetrics: {},
  };

  // Run each scenario
  for (const scenario of scenarios) {
    const category = scenario._category;
    if (!results.byCategory[category]) {
      results.byCategory[category] = { total: 0, passed: 0, failed: 0 };
      console.log(`\n📁 ${category.toUpperCase()}`);
    }

    results.total++;
    results.byCategory[category].total++;

    console.log(`  📋 ${scenario.name || scenario.id}`);

    const scenarioResult = await runScenario(scenario, mockLLM);

    if (scenarioResult.passed) {
      results.passed++;
      results.byCategory[category].passed++;
      console.log(`     ✅ PASSED (unexpected - system handled correctly)`);
    } else {
      results.failed++;
      results.byCategory[category].failed++;
      console.log(`     ❌ FAILED (expected - cognitive weakness found)`);

      results.failures.push({
        scenario: scenario.name || scenario.id,
        category,
        file: scenario._file,
        failures: scenarioResult.turnFailures,
      });
    }

    // Aggregate metrics
    for (const [metric, value] of Object.entries(scenarioResult.metrics)) {
      if (!results.cognitiveMetrics[metric]) {
        results.cognitiveMetrics[metric] = { sum: 0, count: 0 };
      }
      results.cognitiveMetrics[metric].sum += value;
      results.cognitiveMetrics[metric].count++;
    }
  }

  // Print summary
  printSummary(results);

  return results;
}

async function runScenario(scenario, mockLLM) {
  const messages = [];
  const turnResults = [];
  const metrics = {};
  let allPassed = true;
  const turnFailures = [];

  // Add system prompt
  if (scenario.system_prompt) {
    messages.push({ role: 'system', content: scenario.system_prompt });
  }

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];

    // Add user message
    messages.push({ role: 'user', content: turn.user });

    // Get mock response
    const response = await mockLLM.generate(messages);
    const content = response.content || response;

    messages.push({ role: 'assistant', content });

    // Evaluate with cognitive evaluators
    let turnPassed = true;
    const evaluations = [];

    for (const evaluator of cognitiveEvaluators) {
      try {
        const result = await evaluator.evaluate(turn, response, messages, i, scenario);
        evaluations.push(result);

        if (!result.skipped && !result.passed) {
          turnPassed = false;
        }

        if (result.metric && !result.skipped) {
          metrics[result.metric] = result.score;
        }
      } catch (err) {
        // Skip evaluation errors
      }
    }

    if (!turnPassed) {
      allPassed = false;
      turnFailures.push({
        turn_index: i,
        user_input: turn.user,
        response: content.substring(0, 200),
        expected_decision: turn.correct_decision || turn.expected_decision,
        evaluations: evaluations.filter(e => !e.skipped && !e.passed),
      });
    }

    turnResults.push({ turn, response: content, passed: turnPassed, evaluations });
  }

  return {
    passed: allPassed,
    turns: turnResults,
    metrics,
    turnFailures,
  };
}

function printSummary(results) {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  STRESS TEST SUMMARY');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Overall stats
  const failureRate = results.total > 0 ? (results.failed / results.total * 100).toFixed(1) : 0;
  console.log(`  Total Scenarios: ${results.total}`);
  console.log(`  Passed: ${results.passed} (system behaved correctly)`);
  console.log(`  Failed: ${results.failed} (cognitive weaknesses found)`);
  console.log(`  Failure Rate: ${failureRate}%`);
  console.log(`  Expected Failure Rate: ${StressConfig.EXPECTED_FAILURE_RATE * 100}%\n`);

  // By category
  console.log('  BY CATEGORY:');
  for (const [category, stats] of Object.entries(results.byCategory)) {
    const catFailRate = stats.total > 0 ? (stats.failed / stats.total * 100).toFixed(0) : 0;
    console.log(`    ${category}: ${stats.failed}/${stats.total} failed (${catFailRate}%)`);
  }

  // Cognitive metrics
  console.log('\n  COGNITIVE METRICS (lower = more weaknesses):');
  for (const [metric, data] of Object.entries(results.cognitiveMetrics)) {
    const avg = data.count > 0 ? (data.sum / data.count * 100).toFixed(1) : 0;
    console.log(`    ${metric}: ${avg}%`);
  }

  // Top failures
  if (results.failures.length > 0) {
    console.log('\n  TOP COGNITIVE WEAKNESSES FOUND:');
    const topFailures = results.failures.slice(0, 5);
    for (const failure of topFailures) {
      console.log(`\n    📍 ${failure.scenario} (${failure.category})`);
      for (const turn of failure.failures.slice(0, 2)) {
        console.log(`       Input: "${turn.user_input.substring(0, 60)}..."`);
        console.log(`       Expected: ${turn.expected_decision}`);
        for (const eval_ of turn.evaluations.slice(0, 2)) {
          console.log(`       ↳ ${eval_.evaluator}: score=${(eval_.score * 100).toFixed(0)}%`);
        }
      }
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');

  // Interpretation
  if (failureRate >= StressConfig.EXPECTED_FAILURE_RATE * 100) {
    console.log('  ✅ Stress tests working correctly - failures expose weaknesses');
    console.log('  📝 Next step: Fix cognitive weaknesses in chat strategy');
  } else {
    console.log('  ⚠️  Lower failure rate than expected');
    console.log('  📝 Either tests are too easy or system is better than expected');
  }

  console.log('══════════════════════════════════════════════════════════════\n');
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════

runStressTests().catch(err => {
  console.error('Stress test error:', err);
  process.exit(1);
});
