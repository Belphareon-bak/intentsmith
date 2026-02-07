#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3 Agent — Smoke Test Suite v56.0
// ═══════════════════════════════════════════════════════════════════════════════
//
// Catches ALL wiring/import/export issues BEFORE runtime.
// Run: node src/test/smoke-test.js
//
// Tests:
//   1. Module imports (no ERR_MODULE_NOT_FOUND)
//   2. Named exports exist (no "X is not a function")
//   3. Cross-module contracts (API shapes match)
//   4. Handler chain integration (mock pipeline)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  ✅ ${name}`);
}

function fail(name, error) {
  failed++;
  const msg = error?.message || String(error);
  failures.push({ name, msg });
  console.log(`  ❌ ${name}: ${msg}`);
}

async function test(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertType(val, type, name) {
  assert(typeof val === type, `${name} should be ${type}, got ${typeof val}`);
}

function assertFunction(obj, method, context) {
  assert(typeof obj[method] === 'function', `${context}.${method} is not a function (got ${typeof obj[method]})`);
}

function assertExports(mod, names, context) {
  for (const name of names) {
    assert(name in mod, `${context} missing export: ${name}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Module Import Tests
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 1. MODULE IMPORTS ══════');

const modules = {};

async function loadModule(name, path) {
  await test(`import ${name}`, async () => {
    modules[name] = await import(join(SRC, path));
  });
}

// Core
await loadModule('logger', 'core/logger.js');
await loadModule('errorHandler', 'core/error-handler.js');
await loadModule('config', 'config.js');

// Database
await loadModule('database', 'db/database.js');

// Chat core
await loadModule('controller', 'chat/controller.js');
await loadModule('creDecision', 'chat/cre-decision.js');
await loadModule('contextBudget', 'chat/context-budget.js');
await loadModule('conversationStore', 'chat/conversation-store.js');
await loadModule('exportPipeline', 'chat/export-pipeline.js');
await loadModule('ltmContext', 'chat/ltm-context.js');

// Safety
await loadModule('safetyEngine', 'chat/safety/engine.js');
await loadModule('safetyIndex', 'chat/safety/index.js');
await loadModule('safetyIntegration', 'chat/safety/integration.js');
await loadModule('policyGeneral', 'chat/safety/policies/general.js');
await loadModule('policyFinance', 'chat/safety/policies/finance.js');
await loadModule('policyLaw', 'chat/safety/policies/law.js');
await loadModule('policyHealth', 'chat/safety/policies/health.js');

// Quality
await loadModule('qualityIndex', 'chat/quality/index.js');
await loadModule('relevanceFilter', 'chat/quality/relevance-filter.js');
await loadModule('sourceTrust', 'chat/quality/source-trust.js');
await loadModule('confidenceScaling', 'chat/quality/confidence-scaling.js');
await loadModule('creativeDepth', 'chat/quality/creative-depth.js');
await loadModule('driftGuard', 'chat/quality/drift-guard.js');

// Handler utils
await loadModule('utilsIndex', 'chat/handlers/utils/index.js');
await loadModule('intent', 'chat/handlers/utils/intent.js');
await loadModule('quality', 'chat/handlers/utils/quality.js');
await loadModule('synthesis', 'chat/handlers/utils/synthesis.js');
await loadModule('followup', 'chat/handlers/utils/followup.js');
await loadModule('outputGate', 'chat/handlers/utils/output-gate.js');
await loadModule('language', 'chat/handlers/utils/language.js');
await loadModule('searchMetrics', 'chat/handlers/utils/search-metrics.js');

// Handlers
await loadModule('handlersIndex', 'chat/handlers/index.js');
await loadModule('decisions', 'chat/handlers/decisions.js');
await loadModule('conversation', 'chat/handlers/conversation.js');
await loadModule('expert', 'chat/handlers/expert.js');
await loadModule('project', 'chat/handlers/project.js');
await loadModule('agent', 'chat/handlers/agent.js');
await loadModule('clarification', 'chat/handlers/clarification.js');
await loadModule('report', 'chat/handlers/report.js');
await loadModule('buildHandoff', 'chat/handlers/build-handoff.js');
await loadModule('local', 'chat/handlers/local.js');

// Executor
await loadModule('toolExecutor', 'executor/tool-executor.js');
await loadModule('circuitBreaker', 'executor/circuit-breaker.js');
await loadModule('healthMonitor', 'executor/health-monitor.js');
await loadModule('executorIndex', 'executor/index.js');

// LLM
await loadModule('gateway', 'llm/gateway.js');

// Tools
await loadModule('toolRegistry', 'tools/registry.js');

// Agents
await loadModule('agentsRepo', 'agents/repository.js');
await loadModule('agentsRunner', 'agents/runner.js');
await loadModule('agentsApi', 'agents/api.js');
await loadModule('agentsScheduler', 'agents/scheduler.js');

// Experts
await loadModule('expertStore', 'experts/expert-store.js');
await loadModule('expertEnforcement', 'experts/expert-enforcement.js');

// Planner
await loadModule('plannerIndex', 'planner/index.js');

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Named Export Verification
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 2. NAMED EXPORTS ══════');

// --- Handler utils/index.js barrel must re-export all these ---
if (modules.utilsIndex) {
  await test('utils/index.js barrel exports', () => {
    const m = modules.utilsIndex;
    assertExports(m, [
      // from intent.js
      'CLARIFICATION_KEYWORDS', 'isClarification', 'resolveClarificationIntent',
      'detectAffirmative', 'isVagueInput',
      // from quality.js
      'assertCreativeQuality', 'detectFluff', 'atomicAnswerGate',
      'countSentences', 'buildAtomicRetryPrompt', 'buildFluffRetryPrompt',
      'SYNTHESIS_THRESHOLDS',
      // from synthesis.js
      'synthesizeWithLLM', 'buildSynthesisPrompt', 'buildSynthesisSystemPrompt',
      'buildSynthesisFailureResponse', 'buildBasicSynthesis',
      'applyAdaptiveResultCount', 'isListQuery', 'isSpecificQuery',
      'calculateRelevanceScore',
      // from followup.js
      'FollowUpType', 'detectFollowUpType', 'getPreviousToolData',
      'tryResolveClarification',
    ], 'utils/index.js');
  });
}

// --- handlers/index.js barrel ---
if (modules.handlersIndex) {
  await test('handlers/index.js barrel exports', () => {
    const m = modules.handlersIndex;
    assertExports(m, [
      'conversationHandler', 'projectHandler', 'expertHandler', 'agentHandler',
      'handleToolCallDecision', 'buildFailureFallback',
      'handleAskUserDecision', 'formatClarificationRequest',
      'handleAnswerDecision', 'handleRefuseDecision',
      'handleLocalDecision',
      'buildReportFallback', 'synthesizeReport',
      'tryResolveClarification', 'buildResolvedDecision', 'assessGoalAlignment',
      'getDefaultHandlers', 'recordFeedback', 'getUserPreferences',
    ], 'handlers/index.js');
  });
}

// --- quality.js exports ---
if (modules.quality) {
  await test('quality.js exports all required functions', () => {
    const m = modules.quality;
    assertFunction(m, 'assertCreativeQuality', 'quality');
    assertFunction(m, 'detectFluff', 'quality');
    assertFunction(m, 'buildFluffRetryPrompt', 'quality');
    assertFunction(m, 'atomicAnswerGate', 'quality');
    assertFunction(m, 'countSentences', 'quality');
    assertFunction(m, 'buildAtomicRetryPrompt', 'quality');
    assert(m.SYNTHESIS_THRESHOLDS, 'quality missing SYNTHESIS_THRESHOLDS');
  });
}

// --- output-gate.js exports ---
if (modules.outputGate) {
  await test('output-gate.js exports', () => {
    const m = modules.outputGate;
    assertFunction(m, 'enforceOutputContract', 'output-gate');
    assertFunction(m, 'buildOutputGateRetryPrompt', 'output-gate');
  });
}

// --- followup.js exports ---
if (modules.followup) {
  await test('followup.js exports', () => {
    const m = modules.followup;
    assertFunction(m, 'detectFollowUpType', 'followup');
    assertFunction(m, 'getPreviousToolData', 'followup');
    assertFunction(m, 'tryResolveClarification', 'followup');
    assert(m.FollowUpType, 'followup missing FollowUpType enum');
  });
}

// --- CRE decision exports ---
if (modules.creDecision) {
  await test('cre-decision.js exports', () => {
    const m = modules.creDecision;
    assertExports(m, [
      'creDecisionEngine', 'DecisionType', 'IntentType',
      'FORBIDDEN_PHRASES', 'assertDecision', 'assertNoDirectAnswer',
      'ResponseIntent', 'detectResponseIntent',
    ], 'cre-decision.js');
  });
}

// --- Controller exports ---
if (modules.controller) {
  await test('controller.js exports', () => {
    const m = modules.controller;
    assertExports(m, [
      'ResponseTag', 'TaggedResponse', 'ResponseSpeaker', 'ChatMode',
    ], 'controller.js');
  });
}

// --- Executor exports ---
if (modules.toolExecutor) {
  await test('tool-executor.js exports', () => {
    const m = modules.toolExecutor;
    assert(m.toolExecutor || m.ToolExecutor, 'tool-executor missing toolExecutor/ToolExecutor');
    assert(m.ExecutionStatus, 'tool-executor missing ExecutionStatus');
    assert(m.ExecutionResult, 'tool-executor missing ExecutionResult');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Cross-Module Contract Tests
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 3. CROSS-MODULE CONTRACTS ══════');

// --- SafetyEngine.check() static API ---
if (modules.safetyEngine) {
  await test('SafetyEngine has static check() method', () => {
    const { SafetyEngine } = modules.safetyEngine;
    assert(SafetyEngine, 'SafetyEngine class not exported');
    assertFunction(SafetyEngine, 'check', 'SafetyEngine');
  });

  await test('SafetyEngine.check() returns correct shape for ALLOW', () => {
    const { SafetyEngine } = modules.safetyEngine;
    const result = SafetyEngine.check('Hello world', {});
    // ALLOW should return null
    assert(result === null, `Expected null for safe input, got ${JSON.stringify(result)}`);
  });

  await test('SafetyEngine.check() returns correct shape for block', () => {
    const { SafetyEngine } = modules.safetyEngine;
    // Test with something that MIGHT trigger a policy
    // Even if it doesn't block, verify the return is null or { action: 'block'|'restrict' }
    const result = SafetyEngine.check('test input', {});
    if (result !== null) {
      assert(result.action === 'block' || result.action === 'restrict',
        `Expected action 'block'|'restrict', got '${result.action}'`);
      assert(result.domain, 'Block result missing domain');
      assert(result.reason, 'Block result missing reason');
    }
  });

  await test('SafetyEngine has evaluate() instance method', () => {
    const { SafetyEngine } = modules.safetyEngine;
    const engine = new SafetyEngine();
    assertFunction(engine, 'evaluate', 'SafetyEngine instance');
  });
}

// --- ExecutionResult.toolResults is always an array ---
if (modules.toolExecutor) {
  await test('ExecutionResult always has toolResults array', () => {
    const { ExecutionResult, ExecutionStatus } = modules.toolExecutor;
    
    // Default constructor
    const r1 = new ExecutionResult({ status: ExecutionStatus.FAILED });
    assert(Array.isArray(r1.toolResults), 'Default toolResults should be array');
    
    // Explicit null
    const r2 = new ExecutionResult({ status: ExecutionStatus.FAILED, toolResults: null });
    // This might NOT be array - that's the bug!
    if (!Array.isArray(r2.toolResults)) {
      throw new Error('ExecutionResult accepts null toolResults — decisions.js will crash!');
    }
  });
}

// --- Quality functions return correct shapes ---
if (modules.quality) {
  await test('assertCreativeQuality returns { valid, reason? }', () => {
    const { assertCreativeQuality } = modules.quality;
    const r1 = assertCreativeQuality('', '');
    assert(r1.valid === false, 'Empty should be invalid');
    assert(r1.reason, 'Invalid should have reason');
    
    const r2 = assertCreativeQuality('x'.repeat(200), 'test');
    assert(r2.valid === true, 'Long content should be valid');
  });

  await test('detectFluff returns { isFluff, confidence }', () => {
    const { detectFluff } = modules.quality;
    const r = detectFluff('Based on the search results, let me summarize the findings.', [{}]);
    assert('isFluff' in r, 'Missing isFluff');
    assert('confidence' in r, 'Missing confidence');
  });

  await test('atomicAnswerGate returns { valid, sentences }', () => {
    const { atomicAnswerGate } = modules.quality;
    const r = atomicAnswerGate('Prague is the capital of Czechia.', { intent: 'FACTUAL' });
    assert('valid' in r, 'Missing valid');
  });

  await test('countSentences works', () => {
    const { countSentences } = modules.quality;
    assert(countSentences('One. Two. Three.') === 3, 'Should count 3 sentences');
    assert(countSentences('') === 0, 'Empty should be 0');
    assert(countSentences(null) === 0, 'Null should be 0');
  });
}

// --- Output gate returns correct shapes ---
if (modules.outputGate) {
  await test('enforceOutputContract returns { ok, failDimension?, reason? }', () => {
    const { enforceOutputContract } = modules.outputGate;
    const r = enforceOutputContract('Normal text content', { intent: 'SEARCH' });
    assert('ok' in r, 'Missing ok field');
  });
}

// --- Intent detection ---
if (modules.intent) {
  await test('isClarification returns boolean', () => {
    const { isClarification } = modules.intent;
    const r = isClarification('yes');
    assert(typeof r === 'boolean', `Expected boolean, got ${typeof r}`);
  });
}

// --- FollowUp detection ---
if (modules.followup) {
  await test('detectFollowUpType returns { type, confidence }', () => {
    const { detectFollowUpType } = modules.followup;
    const mockSession = { lastDecision: null, lastToolResults: null };
    const r = detectFollowUpType('hello', mockSession);
    assert(r.type, 'Missing type');
    assert('confidence' in r, 'Missing confidence');
  });
}

// --- Handler functions are callable ---
if (modules.handlersIndex) {
  await test('conversationHandler is async function', () => {
    assertType(modules.handlersIndex.conversationHandler, 'function', 'conversationHandler');
  });
  
  await test('handleToolCallDecision is async function', () => {
    assertType(modules.handlersIndex.handleToolCallDecision, 'function', 'handleToolCallDecision');
  });
  
  await test('handleAnswerDecision is async function', () => {
    assertType(modules.handlersIndex.handleAnswerDecision, 'function', 'handleAnswerDecision');
  });
}

// --- Controller class ---
if (modules.controller) {
  await test('ChatController constructor', () => {
    const { ChatController } = modules.controller;
    if (ChatController) {
      assert(typeof ChatController === 'function', 'ChatController should be a class/constructor');
    }
  });
  
  await test('ResponseTag constructor', () => {
    const { ResponseTag } = modules.controller;
    assert(typeof ResponseTag === 'function', 'ResponseTag should be a constructor');
  });
  
  await test('TaggedResponse constructor', () => {
    const { TaggedResponse } = modules.controller;
    assert(typeof TaggedResponse === 'function', 'TaggedResponse should be a constructor');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Integration — Mock Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 4. INTEGRATION CONTRACTS ══════');

// --- CRE → Decision → Handler chain types ---
if (modules.creDecision && modules.controller) {
  await test('CRE decision types are consistent with handler expectations', () => {
    const { DecisionType, IntentType } = modules.creDecision;
    
    // These are the types decisions.js switches on
    assert(DecisionType.TOOL_CALL, 'Missing TOOL_CALL');
    assert(DecisionType.ANSWER, 'Missing ANSWER');
    assert(DecisionType.ASK_USER, 'Missing ASK_USER');
    assert(DecisionType.REFUSE, 'Missing REFUSE');
    
    // Intent types used in decisions.js
    assert(IntentType.SEARCH, 'Missing SEARCH');
    assert(IntentType.REPORT, 'Missing REPORT');
    assert(IntentType.CREATIVE, 'Missing CREATIVE');
    assert(IntentType.FACTUAL, 'Missing FACTUAL');
  });
}

// --- Safety verdict → Controller expected shape ---
if (modules.safetyEngine && modules.controller) {
  await test('Safety verdict shape matches controller expectations', () => {
    const { SafetyEngine, SafetyAction } = modules.safetyEngine;
    
    // Controller checks: safetyVerdict.action === 'block'
    // Engine uses: SafetyAction.REFUSE = 'REFUSE'
    // Static check() should map REFUSE → 'block'
    assert(SafetyAction.REFUSE === 'REFUSE', 'SafetyAction.REFUSE should be "REFUSE"');
    assert(SafetyAction.ALLOW === 'ALLOW', 'SafetyAction.ALLOW should be "ALLOW"');
    
    // Verify the mapping happens in check()
    const result = SafetyEngine.check('normal question', {});
    // For a normal question, should be null (ALLOW)
    assert(result === null, 'Normal input should return null from check()');
  });
}

// --- Quality pipeline barrel ---
if (modules.qualityIndex) {
  await test('quality/index.js exports runQualityPipeline', () => {
    assertFunction(modules.qualityIndex, 'runQualityPipeline', 'quality/index');
  });
}

// --- decisions.js import chain complete ---
if (modules.decisions) {
  await test('decisions.js exports all expected functions', () => {
    const m = modules.decisions;
    assertExports(m, [
      'handleToolCallDecision',
      'buildFailureFallback',
      'handleAskUserDecision',
      'formatClarificationRequest',
      'handleAnswerDecision',
      'handleRefuseDecision',
    ], 'decisions.js');
  });
}

// --- conversation.js exports ---
if (modules.conversation) {
  await test('conversation.js exports conversationHandler', () => {
    assertFunction(modules.conversation, 'conversationHandler', 'conversation.js');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════');
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log('══════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\n🔴 FAILURES:');
  for (const f of failures) {
    console.log(`  ${f.name}`);
    console.log(`    → ${f.msg}`);
  }
  console.log('');
}

process.exit(failed > 0 ? 1 : 0);
