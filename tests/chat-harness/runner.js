// Chat Quality Test Harness — Runner v48.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Orchestrates conversational quality tests with support for:
// - Mock LLM (deterministic, fast)
// - Live LLM (real model, for validation)
// - Multi-turn conversation scenarios
// - Automatic metric collection
// - Auto-repair protocol
//
// Usage:
//   node tests/chat-harness/runner.js [--live] [--repair] [--spec=path]
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

export const Config = {
  // Thresholds
  COHERENCE_THRESHOLD: 0.95,      // 95% multi-turn coherence
  TOOL_SUCCESS_THRESHOLD: 1.0,    // 100% tool-use success for golden path
  FACTUALITY_THRESHOLD: 0.90,     // 90% factuality
  INSTRUCTION_THRESHOLD: 1.0,     // 100% instruction following

  // Auto-repair
  MAX_REPAIR_ATTEMPTS: 3,
  REPAIR_ENABLED: true,

  // Timeouts
  TURN_TIMEOUT_MS: 30000,
  SCENARIO_TIMEOUT_MS: 120000,
};

// ════════════════════════════════════════════════════════════════════════════
// TEST RESULT TYPES
// ════════════════════════════════════════════════════════════════════════════

export const TestStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  REPAIRED: 'repaired',
};

export const MetricType = {
  COHERENCE: 'coherence',
  TOOL_USE: 'tool_use',
  FACTUALITY: 'factuality',
  INSTRUCTION_FOLLOWING: 'instruction_following',
};

// ════════════════════════════════════════════════════════════════════════════
// MOCK LLM (for deterministic testing)
// ════════════════════════════════════════════════════════════════════════════

export class MockLLM {
  constructor(responses = {}) {
    this.responses = responses;
    this.callHistory = [];
    this.defaultResponse = {
      content: 'Mock response',
      tool_calls: [],
    };
  }

  /**
   * Set a mock response for a specific input pattern
   */
  setResponse(pattern, response) {
    this.responses[pattern] = response;
  }

  /**
   * Load responses from scenario
   */
  loadFromScenario(scenario) {
    if (scenario.mock_responses) {
      for (const [pattern, response] of Object.entries(scenario.mock_responses)) {
        this.setResponse(pattern, response);
      }
    }
  }

  /**
   * Generate response (mock)
   */
  async generate(messages, options = {}) {
    const lastMessage = messages[messages.length - 1];
    const input = lastMessage?.content || '';

    this.callHistory.push({ messages, options, timestamp: Date.now() });

    // Find matching response
    for (const [pattern, response] of Object.entries(this.responses)) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(input)) {
        return typeof response === 'function' ? response(input, messages) : response;
      }
    }

    return this.defaultResponse;
  }

  /**
   * Reset call history
   */
  reset() {
    this.callHistory = [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE LLM ADAPTER
// ════════════════════════════════════════════════════════════════════════════

export class LiveLLM {
  constructor(options = {}) {
    this.gateway = options.gateway || null;
    this.model = options.model || 'qwen2.5:32b';
    this.callHistory = [];
  }

  /**
   * Generate response (live)
   */
  async generate(messages, options = {}) {
    if (!this.gateway) {
      throw new Error('LLM Gateway not configured');
    }

    const start = Date.now();

    try {
      const response = await this.gateway.call({
        model: this.model,
        messages,
        ...options,
      });

      this.callHistory.push({
        messages,
        response,
        duration_ms: Date.now() - start,
        timestamp: Date.now(),
      });

      return response;
    } catch (error) {
      this.callHistory.push({
        messages,
        error: error.message,
        duration_ms: Date.now() - start,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  reset() {
    this.callHistory = [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONVERSATION RUNNER
// ════════════════════════════════════════════════════════════════════════════

export class ConversationRunner {
  constructor(llm, options = {}) {
    this.llm = llm;
    this.evaluators = options.evaluators || [];
    this.timeout = options.timeout || Config.TURN_TIMEOUT_MS;
  }

  /**
   * Run a multi-turn conversation
   */
  async runConversation(scenario) {
    const messages = [];
    const turnResults = [];
    const metrics = {};

    // Add system prompt if specified
    if (scenario.system_prompt) {
      messages.push({ role: 'system', content: scenario.system_prompt });
    }

    // Execute each turn
    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      const turnStart = Date.now();

      try {
        // Add user message
        messages.push({ role: 'user', content: turn.user });

        // Get LLM response
        const response = await this.withTimeout(
          this.llm.generate(messages, turn.options || {}),
          this.timeout
        );

        // Add assistant message
        const assistantContent = response.content || response;
        messages.push({ role: 'assistant', content: assistantContent });

        // Evaluate turn
        const turnEvaluation = await this.evaluateTurn(turn, response, messages, i);

        turnResults.push({
          turn_index: i,
          user_input: turn.user,
          assistant_response: assistantContent,
          expected: turn.expected,
          evaluation: turnEvaluation,
          duration_ms: Date.now() - turnStart,
          passed: turnEvaluation.passed,
        });

        // Aggregate metrics
        this.aggregateMetrics(metrics, turnEvaluation.metrics);

      } catch (error) {
        turnResults.push({
          turn_index: i,
          user_input: turn.user,
          error: error.message,
          duration_ms: Date.now() - turnStart,
          passed: false,
        });
      }
    }

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      turns: turnResults,
      metrics,
      passed: turnResults.every(t => t.passed),
      transcript: messages,
    };
  }

  /**
   * Evaluate a single turn
   */
  async evaluateTurn(turn, response, messages, turnIndex) {
    const results = [];
    const metrics = {};

    for (const evaluator of this.evaluators) {
      try {
        const result = await evaluator.evaluate(turn, response, messages, turnIndex);
        results.push(result);

        if (result.metric) {
          metrics[result.metric] = result.score;
        }
      } catch (error) {
        results.push({
          evaluator: evaluator.name,
          error: error.message,
          passed: false,
        });
      }
    }

    return {
      results,
      metrics,
      passed: results.every(r => r.passed !== false),
    };
  }

  /**
   * Aggregate metrics across turns
   */
  aggregateMetrics(aggregate, turnMetrics) {
    for (const [key, value] of Object.entries(turnMetrics)) {
      if (!aggregate[key]) {
        aggregate[key] = { sum: 0, count: 0 };
      }
      aggregate[key].sum += value;
      aggregate[key].count += 1;
    }
  }

  /**
   * Timeout wrapper
   */
  withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      ),
    ]);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST HARNESS
// ════════════════════════════════════════════════════════════════════════════

export class ChatTestHarness extends EventEmitter {
  constructor(options = {}) {
    super();

    this.useLive = options.live || false;
    this.enableRepair = options.repair ?? Config.REPAIR_ENABLED;
    this.specsDir = options.specsDir || path.join(__dirname, 'specs');
    this.evaluators = [];
    this.reporters = [];
    this.repairStrategies = [];

    // LLM setup
    this.mockLLM = new MockLLM();
    this.liveLLM = options.liveLLM || null;

    // Results
    this.results = [];
    this.repairAttempts = [];
  }

  /**
   * Register an evaluator
   */
  registerEvaluator(evaluator) {
    this.evaluators.push(evaluator);
    return this;
  }

  /**
   * Register a reporter
   */
  registerReporter(reporter) {
    this.reporters.push(reporter);
    return this;
  }

  /**
   * Register a repair strategy
   */
  registerRepairStrategy(strategy) {
    this.repairStrategies.push(strategy);
    return this;
  }

  /**
   * Load scenarios from YAML files
   */
  async loadScenarios(pattern = '*.yaml') {
    const scenarios = [];

    // Dynamic import for yaml parsing
    const files = fs.readdirSync(this.specsDir)
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.specsDir, file), 'utf-8');
      const scenario = this.parseYAML(content);
      scenario._file = file;
      scenarios.push(scenario);
    }

    return scenarios;
  }

  /**
   * Simple YAML parser (basic support)
   */
  parseYAML(content) {
    // Basic YAML parsing - in production use js-yaml
    const lines = content.split('\n');
    const result = { turns: [], mock_responses: {} };
    let currentSection = null;
    let currentTurn = null;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('#') || !trimmed) continue;

      // Top-level keys
      if (line.match(/^[a-z_]+:/)) {
        const [key, ...valueParts] = trimmed.split(':');
        const value = valueParts.join(':').trim();

        if (key === 'turns') {
          currentSection = 'turns';
        } else if (key === 'mock_responses') {
          currentSection = 'mock_responses';
        } else if (value) {
          result[key] = value.replace(/^['"]|['"]$/g, '');
        }
        continue;
      }

      // Turn items
      if (currentSection === 'turns' && trimmed.startsWith('- user:')) {
        if (currentTurn) result.turns.push(currentTurn);
        currentTurn = { user: trimmed.replace('- user:', '').trim().replace(/^['"]|['"]$/g, '') };
      } else if (currentTurn && trimmed.startsWith('expected:')) {
        currentTurn.expected = trimmed.replace('expected:', '').trim().replace(/^['"]|['"]$/g, '');
      } else if (currentTurn && trimmed.startsWith('intent:')) {
        currentTurn.intent = trimmed.replace('intent:', '').trim();
      }
    }

    if (currentTurn) result.turns.push(currentTurn);

    return result;
  }

  /**
   * Run all tests
   */
  async run(options = {}) {
    const scenarios = options.scenarios || await this.loadScenarios();
    const llm = this.useLive ? this.liveLLM : this.mockLLM;

    if (!llm) {
      throw new Error('No LLM configured');
    }

    const runner = new ConversationRunner(llm, {
      evaluators: this.evaluators,
    });

    this.emit('start', { totalScenarios: scenarios.length });

    const results = [];

    for (const scenario of scenarios) {
      this.emit('scenarioStart', scenario);

      // Load mock responses for this scenario
      if (!this.useLive) {
        this.mockLLM.loadFromScenario(scenario);
      }

      let result = await runner.runConversation(scenario);

      // Auto-repair if failed and enabled
      if (!result.passed && this.enableRepair) {
        result = await this.attemptRepair(scenario, result, runner);
      }

      results.push(result);
      this.emit('scenarioComplete', result);
    }

    this.results = results;

    // Generate reports
    const report = this.generateReport(results);

    for (const reporter of this.reporters) {
      await reporter.report(report);
    }

    this.emit('complete', report);

    return report;
  }

  /**
   * Attempt auto-repair
   */
  async attemptRepair(scenario, failedResult, runner) {
    let attempts = 0;
    let currentResult = failedResult;

    while (attempts < Config.MAX_REPAIR_ATTEMPTS && !currentResult.passed) {
      attempts++;

      this.emit('repairAttempt', { scenario, attempt: attempts });

      for (const strategy of this.repairStrategies) {
        const repair = await strategy.propose(scenario, currentResult);

        if (repair) {
          this.repairAttempts.push({
            scenario_id: scenario.id,
            attempt: attempts,
            strategy: strategy.name,
            repair,
          });

          // Apply repair and rerun
          const repairedScenario = strategy.apply(scenario, repair);
          currentResult = await runner.runConversation(repairedScenario);

          if (currentResult.passed) {
            currentResult.status = TestStatus.REPAIRED;
            currentResult.repair = repair;
            break;
          }
        }
      }
    }

    return currentResult;
  }

  /**
   * Generate comprehensive report
   */
  generateReport(results) {
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const repaired = results.filter(r => r.status === TestStatus.REPAIRED).length;

    // Calculate aggregate metrics
    const metrics = this.calculateAggregateMetrics(results);

    return {
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        passed,
        failed,
        repaired,
        pass_rate: results.length > 0 ? (passed / results.length * 100).toFixed(2) : 0,
      },
      metrics,
      thresholds: {
        coherence: { threshold: Config.COHERENCE_THRESHOLD, met: metrics.coherence >= Config.COHERENCE_THRESHOLD },
        tool_use: { threshold: Config.TOOL_SUCCESS_THRESHOLD, met: metrics.tool_use >= Config.TOOL_SUCCESS_THRESHOLD },
        factuality: { threshold: Config.FACTUALITY_THRESHOLD, met: metrics.factuality >= Config.FACTUALITY_THRESHOLD },
        instruction_following: { threshold: Config.INSTRUCTION_THRESHOLD, met: metrics.instruction_following >= Config.INSTRUCTION_THRESHOLD },
      },
      results,
      repair_attempts: this.repairAttempts,
      ci_pass: this.checkCIPass(metrics),
    };
  }

  /**
   * Calculate aggregate metrics across all results
   */
  calculateAggregateMetrics(results) {
    const metrics = {
      coherence: 0,
      tool_use: 0,
      factuality: 0,
      instruction_following: 0,
    };

    let counts = {
      coherence: 0,
      tool_use: 0,
      factuality: 0,
      instruction_following: 0,
    };

    for (const result of results) {
      if (result.metrics) {
        for (const [key, data] of Object.entries(result.metrics)) {
          if (metrics.hasOwnProperty(key) && data.count > 0) {
            metrics[key] += data.sum;
            counts[key] += data.count;
          }
        }
      }
    }

    // Calculate averages
    for (const key of Object.keys(metrics)) {
      if (counts[key] > 0) {
        metrics[key] = metrics[key] / counts[key];
      }
    }

    return metrics;
  }

  /**
   * Check if CI should pass
   */
  checkCIPass(metrics) {
    return (
      metrics.coherence >= Config.COHERENCE_THRESHOLD &&
      metrics.tool_use >= Config.TOOL_SUCCESS_THRESHOLD &&
      metrics.factuality >= Config.FACTUALITY_THRESHOLD &&
      metrics.instruction_following >= Config.INSTRUCTION_THRESHOLD
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CLI ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const useLive = args.includes('--live');
  const enableRepair = args.includes('--repair');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Chat Quality Test Harness v48.0');
  console.log(`  Mode: ${useLive ? 'LIVE' : 'MOCK'} | Repair: ${enableRepair ? 'ON' : 'OFF'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Import evaluators
  const evaluators = await import('./evaluators/index.js').catch(() => ({ default: [] }));
  const reporters = await import('./reporters/index.js').catch(() => ({ default: [] }));

  const harness = new ChatTestHarness({
    live: useLive,
    repair: enableRepair,
  });

  // Register evaluators
  if (evaluators.default) {
    for (const evaluator of evaluators.default) {
      harness.registerEvaluator(evaluator);
    }
  }

  // Register reporters
  if (reporters.default) {
    for (const reporter of reporters.default) {
      harness.registerReporter(reporter);
    }
  }

  // Event handlers
  harness.on('scenarioStart', (scenario) => {
    console.log(`  📋 Running: ${scenario.name || scenario.id || 'unnamed'}`);
  });

  harness.on('scenarioComplete', (result) => {
    const status = result.passed ? '✅' : '❌';
    console.log(`     ${status} ${result.passed ? 'PASSED' : 'FAILED'}`);
  });

  harness.on('repairAttempt', ({ scenario, attempt }) => {
    console.log(`     🔧 Repair attempt ${attempt}...`);
  });

  try {
    const report = await harness.run();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`  Results: ${report.summary.passed}/${report.summary.total} passed`);
    if (report.summary.repaired > 0) {
      console.log(`  Repaired: ${report.summary.repaired}`);
    }
    console.log(`  CI Status: ${report.ci_pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    process.exit(report.ci_pass ? 0 : 1);

  } catch (error) {
    console.error('Error running tests:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default ChatTestHarness;
