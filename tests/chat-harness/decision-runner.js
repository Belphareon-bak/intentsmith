// Decision-First Test Runner v48.2
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests the DECISION LAYER, not text output.
//
// Philosophy:
//   - Test: Did the system make the RIGHT DECISION?
//   - Ignore: How well is the text written?
//
// This is the correct approach to testing cognitive quality.
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  DecisionAnalyzer,
  DecisionType,
  DecisionValidator,
} from '../../src/chat/decision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const Config = {
  TEST_DIRS: ['adversarial', 'strategy', 'degradation'],
  DECISION_CORRECT_THRESHOLD: 0.8,  // 80% decisions must be correct
};

// ════════════════════════════════════════════════════════════════════════════
// YAML PARSER
// ════════════════════════════════════════════════════════════════════════════

function parseYAML(content) {
  const lines = content.split('\n');
  const result = { turns: [], metadata: {} };
  let currentSection = null;
  let currentTurn = null;
  let currentListKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

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

    if (currentSection === 'metadata' && line.startsWith('  ')) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();
        result.metadata[key] = value.replace(/^['"]|['"]$/g, '');
      }
      continue;
    }

    if (currentSection === 'turns') {
      if (trimmed.startsWith('- user:')) {
        if (currentTurn) result.turns.push(currentTurn);
        currentTurn = { user: trimmed.replace('- user:', '').trim().replace(/^['"]|['"]$/g, '') };
        currentListKey = null;
      } else if (trimmed.startsWith('- ') && currentListKey && currentTurn) {
        if (!currentTurn[currentListKey]) currentTurn[currentListKey] = [];
        currentTurn[currentListKey].push(trimmed.replace('- ', '').replace(/^['"]|['"]$/g, ''));
      } else if (currentTurn && line.startsWith('    ') && trimmed.includes(':')) {
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIdx).trim();
        const value = trimmed.substring(colonIdx + 1).trim();

        if (!value) {
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
// DECISION MAPPER
// Maps YAML expected_decision to DecisionType
// ════════════════════════════════════════════════════════════════════════════

const decisionMap = {
  // ASK variants
  'ask': DecisionType.ASK,
  'ask_for_info': DecisionType.ASK,
  'surface_conflict': DecisionType.ASK,
  'surface_assumptions': DecisionType.ASK,

  // ANSWER variants
  'answer': DecisionType.ANSWER,
  'answer_directly': DecisionType.ANSWER,
  'comply': DecisionType.ANSWER,

  // REFUSE variants
  'refuse': DecisionType.REFUSE,
  'pushback': DecisionType.REFUSE,

  // CHALLENGE variants
  'challenge': DecisionType.CHALLENGE,
  'challenge_premise': DecisionType.CHALLENGE,

  // DELEGATE variants
  'delegate': DecisionType.DELEGATE,
  'switch_to_legal_disclaimer': DecisionType.DELEGATE,
  'switch_to_medical_urgency': DecisionType.DELEGATE,
  'switch_to_financial_disclaimer': DecisionType.DELEGATE,
  'acknowledge_limits': DecisionType.DELEGATE,
};

function mapExpectedDecision(expected) {
  return decisionMap[expected] || expected;
}

// ════════════════════════════════════════════════════════════════════════════
// LOAD SCENARIOS
// ════════════════════════════════════════════════════════════════════════════

function loadScenarios() {
  const scenarios = [];
  const specsDir = path.join(__dirname, 'specs');

  for (const testDir of Config.TEST_DIRS) {
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
// RUN DECISION TESTS
// ════════════════════════════════════════════════════════════════════════════

async function runDecisionTests() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Decision-First Tests v48.2');
  console.log('  Testing DECISIONS, not text output');
  console.log('══════════════════════════════════════════════════════════════\n');

  const scenarios = loadScenarios();
  console.log(`  Loaded ${scenarios.length} scenarios\n`);

  const analyzer = new DecisionAnalyzer({ audit: false });

  const results = {
    total: { decisions: 0, correct: 0, incorrect: 0 },
    byCategory: {},
    byDecisionType: {},
    failures: [],
  };

  for (const scenario of scenarios) {
    const category = scenario._category;
    if (!results.byCategory[category]) {
      results.byCategory[category] = { total: 0, correct: 0, incorrect: 0 };
      console.log(`\n📁 ${category.toUpperCase()}`);
    }

    console.log(`  📋 ${scenario.name || scenario.id}`);

    for (const turn of scenario.turns) {
      // Skip turns without expected decision
      const expectedDecision = turn.expected_decision || turn.correct_decision;
      if (!expectedDecision) continue;

      results.total.decisions++;
      results.byCategory[category].total++;

      // Get decision from analyzer
      const decision = await analyzer.analyze(turn.user, {});
      const expectedType = mapExpectedDecision(expectedDecision);

      // Track by decision type
      if (!results.byDecisionType[expectedType]) {
        results.byDecisionType[expectedType] = { total: 0, correct: 0 };
      }
      results.byDecisionType[expectedType].total++;

      // Check correctness
      const isCorrect = decision.type === expectedType;

      if (isCorrect) {
        results.total.correct++;
        results.byCategory[category].correct++;
        results.byDecisionType[expectedType].correct++;
        console.log(`     ✅ "${turn.user.substring(0, 40)}..." → ${decision.type}`);
      } else {
        results.total.incorrect++;
        results.byCategory[category].incorrect++;
        results.failures.push({
          scenario: scenario.name || scenario.id,
          category,
          input: turn.user,
          expected: expectedType,
          actual: decision.type,
          reason: decision.reason,
        });
        console.log(`     ❌ "${turn.user.substring(0, 40)}..."`);
        console.log(`        Expected: ${expectedType}, Got: ${decision.type}`);
      }
    }
  }

  // Print summary
  printSummary(results);

  return results;
}

function printSummary(results) {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  DECISION TEST SUMMARY');
  console.log('══════════════════════════════════════════════════════════════\n');

  const accuracy = results.total.decisions > 0
    ? (results.total.correct / results.total.decisions * 100).toFixed(1)
    : 0;

  console.log(`  Total Decisions Tested: ${results.total.decisions}`);
  console.log(`  Correct: ${results.total.correct}`);
  console.log(`  Incorrect: ${results.total.incorrect}`);
  console.log(`  Accuracy: ${accuracy}%`);
  console.log(`  Target: ${Config.DECISION_CORRECT_THRESHOLD * 100}%\n`);

  // By category
  console.log('  BY CATEGORY:');
  for (const [category, stats] of Object.entries(results.byCategory)) {
    const catAcc = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(0) : 0;
    console.log(`    ${category}: ${stats.correct}/${stats.total} correct (${catAcc}%)`);
  }

  // By decision type
  console.log('\n  BY DECISION TYPE:');
  for (const [type, stats] of Object.entries(results.byDecisionType)) {
    const typeAcc = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(0) : 0;
    console.log(`    ${type}: ${stats.correct}/${stats.total} correct (${typeAcc}%)`);
  }

  // Top failures
  if (results.failures.length > 0) {
    console.log('\n  TOP DECISION FAILURES:');
    for (const failure of results.failures.slice(0, 5)) {
      console.log(`\n    📍 ${failure.scenario}`);
      console.log(`       Input: "${failure.input.substring(0, 50)}..."`);
      console.log(`       Expected: ${failure.expected}`);
      console.log(`       Actual: ${failure.actual}`);
      console.log(`       Reason: ${failure.reason}`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');

  const passed = accuracy >= Config.DECISION_CORRECT_THRESHOLD * 100;
  if (passed) {
    console.log(`  ✅ PASSED: Decision accuracy ${accuracy}% >= ${Config.DECISION_CORRECT_THRESHOLD * 100}%`);
  } else {
    console.log(`  ❌ FAILED: Decision accuracy ${accuracy}% < ${Config.DECISION_CORRECT_THRESHOLD * 100}%`);
    console.log(`  📝 Action: Improve DecisionAnalyzer patterns`);
  }

  console.log('══════════════════════════════════════════════════════════════\n');
}

// ════════════════════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════════════════════

runDecisionTests().catch(err => {
  console.error('Decision test error:', err);
  process.exit(1);
});
