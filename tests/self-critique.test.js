// tests/self-critique.test.js — Self-Critique (F6) unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  shouldActivate,
  analyzeCause,
  generatePatchPlan,
  validatePlan,
  formatCritiqueForPrompt,
} from '../src/planner/self-critique.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkError(code, file, line, message) {
  return { code, file, line, message, severity: 'error', category: 'compile', recoverable: true };
}

function mockCallLLM(response) {
  return async (_role, _prompt) => ({ content: response });
}

function mockIterationMemory(patchesApplied = [], errorHistory = []) {
  return { iteration: 2, patchesApplied, errorHistory };
}

// ═══════════════════════════════════════════════════════════════════════════
// shouldActivate
// ═══════════════════════════════════════════════════════════════════════════

suite('shouldActivate');

test('inactive on iteration 1', () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  assertEqual(shouldActivate(1, errors), false, 'iteration 1 should not activate');
});

test('active on iteration 2', () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  assertEqual(shouldActivate(2, errors), true, 'iteration 2 should activate');
});

test('active on iteration 5', () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  assertEqual(shouldActivate(5, errors), true, 'iteration 5 should activate');
});

test('inactive with no errors', () => {
  assertEqual(shouldActivate(3, []), false, 'no errors → inactive');
  assertEqual(shouldActivate(3, null), false, 'null errors → inactive');
});

// ═══════════════════════════════════════════════════════════════════════════
// analyzeCause
// ═══════════════════════════════════════════════════════════════════════════

suite('analyzeCause');

await testAsync('parses root cause and reasoning', async () => {
  const response = `ROOT_CAUSE: Missing import of validateOrder function
REASONING: The function was removed in a previous patch but callers still reference it. This is a cascading failure from the initial refactoring.`;

  const errors = [mkError('UNDEFINED_VARIABLE', 'controller.js', 10, 'validateOrder is not defined')];
  const result = await analyzeCause(errors, '', mockIterationMemory(), mockCallLLM(response));

  assert(result.rootCause.includes('Missing import'), `should parse root cause, got: ${result.rootCause}`);
  assert(result.reasoning.includes('cascading'), `should parse reasoning, got: ${result.reasoning}`);
});

await testAsync('handles empty response', async () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await analyzeCause(errors, '', mockIterationMemory(), mockCallLLM(''));

  assertEqual(result.rootCause, '', 'empty response → empty root cause');
  assertEqual(result.reasoning, '', 'empty response → empty reasoning');
});

await testAsync('handles LLM failure gracefully', async () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const failingLLM = async () => { throw new Error('LLM timeout'); };

  const result = await analyzeCause(errors, '', mockIterationMemory(), failingLLM);
  assertEqual(result.rootCause, '', 'LLM failure → empty root cause');
  assertEqual(result.reasoning, '', 'LLM failure → empty reasoning');
});

await testAsync('includes signature context in prompt', async () => {
  let capturedPrompt = '';
  const capturingLLM = async (_role, prompt) => {
    capturedPrompt = prompt;
    return { content: 'ROOT_CAUSE: test\nREASONING: test' };
  };

  const errors = [mkError('MISSING_PROPERTY', 'a.js', 1, 'err')];
  const sigCtx = '### src/service.js\n- export function processOrder(id)';

  await analyzeCause(errors, sigCtx, mockIterationMemory(), capturingLLM);
  assert(capturedPrompt.includes('processOrder'), 'prompt should include signature context');
});

await testAsync('includes error trend in prompt', async () => {
  let capturedPrompt = '';
  const capturingLLM = async (_role, prompt) => {
    capturedPrompt = prompt;
    return { content: 'ROOT_CAUSE: x\nREASONING: y' };
  };

  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const prevErrors = [mkError('A', 'b.js', 1, ''), mkError('B', 'c.js', 2, '')];
  const mem = mockIterationMemory([], [prevErrors, errors]);

  await analyzeCause(errors, '', mem, capturingLLM);
  assert(capturedPrompt.includes('Previous iteration: 2'), `prompt should include error trend, got: ${capturedPrompt.slice(0, 500)}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// generatePatchPlan
// ═══════════════════════════════════════════════════════════════════════════

suite('generatePatchPlan');

await testAsync('parses plan steps', async () => {
  const response = `MODIFY src/service.js processOrder add null check for orderId parameter
ADD src/service.js validateOrder new validation function for order data
DELETE src/legacy.js oldHandler remove deprecated handler`;

  const errors = [mkError('NULL_REFERENCE', 'service.js', 10, 'null ref')];
  const cause = { rootCause: 'Missing null check', reasoning: 'orderId can be null' };
  const result = await generatePatchPlan(errors, cause, '', mockCallLLM(response));

  assertEqual(result.steps.length, 3, 'should parse 3 steps');
  assertEqual(result.steps[0].action, 'MODIFY', 'first step action');
  assertEqual(result.steps[0].file, 'src/service.js', 'first step file');
  assertEqual(result.steps[0].symbol, 'processOrder', 'first step symbol');
  assert(result.steps[0].reason.includes('null check'), 'first step reason');
  assertEqual(result.steps[1].action, 'ADD', 'second step action');
  assertEqual(result.steps[2].action, 'DELETE', 'third step action');
});

await testAsync('handles mixed case actions', async () => {
  const response = `modify src/a.js foo fix bug
Add src/b.js bar new function
DELETE src/c.js baz cleanup`;

  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await generatePatchPlan(errors, { rootCause: '' }, '', mockCallLLM(response));

  assertEqual(result.steps.length, 3, 'should parse case-insensitive');
  assertEqual(result.steps[0].action, 'MODIFY', 'normalized to uppercase');
});

await testAsync('caps at MAX_PLAN_STEPS', async () => {
  const lines = [];
  for (let i = 0; i < 15; i++) {
    lines.push(`MODIFY src/f${i}.js fn${i} fix issue ${i}`);
  }
  const response = lines.join('\n');

  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await generatePatchPlan(errors, { rootCause: '' }, '', mockCallLLM(response));

  assertEqual(result.steps.length, 10, `should cap at 10, got ${result.steps.length}`);
});

await testAsync('handles empty response', async () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await generatePatchPlan(errors, { rootCause: '' }, '', mockCallLLM(''));

  assertEqual(result.steps.length, 0, 'empty response → no steps');
  assertEqual(result.raw, '', 'raw preserved');
});

await testAsync('handles LLM failure', async () => {
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await generatePatchPlan(errors, { rootCause: '' }, '', async () => { throw new Error('fail'); });

  assertEqual(result.steps.length, 0, 'LLM failure → no steps');
});

await testAsync('ignores non-plan lines', async () => {
  const response = `Here is the fix plan:

MODIFY src/service.js processOrder fix the null check

Some extra explanation text.
This line is not a plan step.
ADD src/util.js validate add helper`;

  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await generatePatchPlan(errors, { rootCause: '' }, '', mockCallLLM(response));

  assertEqual(result.steps.length, 2, 'should skip non-plan lines');
});

await testAsync('preserves raw response', async () => {
  const response = 'MODIFY src/a.js foo bar baz';
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];
  const result = await generatePatchPlan(errors, { rootCause: '' }, '', mockCallLLM(response));

  assertEqual(result.raw, response, 'raw should be preserved');
});

// ═══════════════════════════════════════════════════════════════════════════
// validatePlan
// ═══════════════════════════════════════════════════════════════════════════

suite('validatePlan');

test('valid plan — no KG available', () => {
  const steps = [
    { action: 'MODIFY', file: 'src/a.js', symbol: 'foo', reason: 'fix' },
    { action: 'ADD', file: 'src/b.js', symbol: 'bar', reason: 'new' },
  ];
  const result = validatePlan(steps);
  assertEqual(result.valid, true, 'should be valid without KG');
  assertEqual(result.issues.length, 0, 'no issues');
  assertEqual(result.validSteps.length, 2, 'all steps valid');
});

test('rejects empty plan', () => {
  const result = validatePlan([]);
  assertEqual(result.valid, false, 'empty plan should fail');
  assert(result.issues[0].includes('Empty'), `issue should mention empty, got: ${result.issues[0]}`);
});

test('rejects null plan', () => {
  const result = validatePlan(null);
  assertEqual(result.valid, false, 'null plan should fail');
});

test('rejects oversized plan', () => {
  const steps = [];
  for (let i = 0; i < 12; i++) {
    steps.push({ action: 'MODIFY', file: `f${i}.js`, symbol: `s${i}`, reason: 'x' });
  }
  const result = validatePlan(steps);
  assertEqual(result.valid, false, 'oversized plan should fail');
  assert(result.issues[0].includes('too large'), 'issue should mention too large');
});

test('flags invalid action', () => {
  const steps = [
    { action: 'RENAME', file: 'a.js', symbol: 'foo', reason: 'x' },
    { action: 'MODIFY', file: 'b.js', symbol: 'bar', reason: 'y' },
  ];
  const result = validatePlan(steps);
  assertEqual(result.valid, false, 'invalid action should cause issues');
  assertEqual(result.validSteps.length, 1, 'only valid step retained');
  assert(result.issues[0].includes('RENAME'), 'issue should mention RENAME');
});

test('validates symbol against index', () => {
  const mockIndex = {
    findSymbol: (name) => name === 'processOrder' ? [{ name: 'processOrder' }] : null,
  };
  const steps = [
    { action: 'MODIFY', file: 'service.js', symbol: 'processOrder', reason: 'fix' },
    { action: 'MODIFY', file: 'service.js', symbol: 'nonExistent', reason: 'fix' },
  ];
  const result = validatePlan(steps, { symbolIndex: mockIndex });
  assertEqual(result.valid, false, 'missing symbol should flag issue');
  assertEqual(result.validSteps.length, 2, 'still includes all steps (soft warning)');
  assert(result.issues[0].includes('nonExistent'), 'issue should mention missing symbol');
});

test('validates file against graph', () => {
  const mockGraph = {
    getNode: (id) => id === 'file:src/known.js' ? { id, type: 'file' } : null,
  };
  const mockFileNodeId = (f) => `file:${f}`;

  const steps = [
    { action: 'MODIFY', file: 'src/known.js', symbol: 'foo', reason: 'x' },
    { action: 'MODIFY', file: 'src/unknown.js', symbol: 'bar', reason: 'y' },
    { action: 'ADD', file: 'src/new.js', symbol: 'baz', reason: 'z' }, // ADD skips file check
  ];
  const result = validatePlan(steps, { graph: mockGraph, fileNodeId: mockFileNodeId });
  assertEqual(result.valid, false, 'unknown file should flag issue');
  assert(result.issues.some(i => i.includes('src/unknown.js')), 'should mention unknown file');
  assertEqual(result.validSteps.length, 3, 'all steps included (soft warnings)');
});

test('ADD action skips file existence check', () => {
  const mockGraph = {
    getNode: () => null, // no files exist
  };
  const mockFileNodeId = (f) => `file:${f}`;

  const steps = [
    { action: 'ADD', file: 'src/brand-new.js', symbol: 'newFn', reason: 'create new file' },
  ];
  const result = validatePlan(steps, { graph: mockGraph, fileNodeId: mockFileNodeId });
  assertEqual(result.valid, true, 'ADD should not check file existence');
  assertEqual(result.issues.length, 0, 'no issues for ADD');
});

// ═══════════════════════════════════════════════════════════════════════════
// formatCritiqueForPrompt
// ═══════════════════════════════════════════════════════════════════════════

suite('formatCritiqueForPrompt');

test('full format with cause + plan + validation', () => {
  const cause = { rootCause: 'Missing import', reasoning: 'The function was removed.' };
  const plan = {
    steps: [
      { action: 'MODIFY', file: 'a.js', symbol: 'foo', reason: 'fix import' },
      { action: 'ADD', file: 'b.js', symbol: 'bar', reason: 'new helper' },
    ],
    raw: '',
  };
  const validation = { valid: false, issues: ['Symbol "baz" not found'] };

  const result = formatCritiqueForPrompt(cause, plan, validation);
  assert(result.includes('Root cause: Missing import'), 'should include root cause');
  assert(result.includes('Analysis: The function was removed'), 'should include reasoning');
  assert(result.includes('MODIFY a.js foo'), 'should include plan step');
  assert(result.includes('ADD b.js bar'), 'should include second step');
  assert(result.includes('Symbol "baz" not found'), 'should include validation warning');
});

test('format with cause only', () => {
  const cause = { rootCause: 'Missing null check', reasoning: '' };
  const plan = { steps: [], raw: '' };
  const validation = { valid: true, issues: [] };

  const result = formatCritiqueForPrompt(cause, plan, validation);
  assert(result.includes('Root cause: Missing null check'), 'should include root cause');
  assert(!result.includes('Patch plan:'), 'no plan section with empty steps');
  assert(!result.includes('Validation'), 'no validation section with no issues');
});

test('format with empty cause', () => {
  const cause = { rootCause: '', reasoning: '' };
  const plan = { steps: [{ action: 'MODIFY', file: 'a.js', symbol: 'foo', reason: 'fix' }], raw: '' };
  const validation = { valid: true, issues: [] };

  const result = formatCritiqueForPrompt(cause, plan, validation);
  assert(!result.includes('Root cause:'), 'no root cause line');
  assert(result.includes('Patch plan:'), 'should have plan section');
});

test('format fully empty', () => {
  const cause = { rootCause: '', reasoning: '' };
  const plan = { steps: [], raw: '' };
  const validation = { valid: true, issues: [] };

  const result = formatCritiqueForPrompt(cause, plan, validation);
  assertEqual(result, '', 'fully empty → empty string');
});

// ═══════════════════════════════════════════════════════════════════════════
// parseCauseResponse edge cases
// ═══════════════════════════════════════════════════════════════════════════

suite('parseCauseResponse edge cases');

await testAsync('multiline reasoning collapsed', async () => {
  const response = `ROOT_CAUSE: Import cycle between modules
REASONING: The service module imports from controller
which in turn imports from service.
This creates a circular dependency.`;

  const errors = [mkError('IMPORT_NOT_FOUND', 'a.js', 1, 'err')];
  const result = await analyzeCause(errors, '', mockIterationMemory(), mockCallLLM(response));

  assert(result.rootCause === 'Import cycle between modules', 'root cause extracted');
  assert(result.reasoning.includes('circular dependency'), 'multiline reasoning included');
  assert(!result.reasoning.includes('\n'), 'newlines collapsed');
});

await testAsync('extra text before ROOT_CAUSE ignored', async () => {
  const response = `Let me analyze this...

ROOT_CAUSE: Wrong parameter type
REASONING: Expected number but got string.`;

  const errors = [mkError('TYPE_MISMATCH', 'a.js', 1, 'err')];
  const result = await analyzeCause(errors, '', mockIterationMemory(), mockCallLLM(response));

  assertEqual(result.rootCause, 'Wrong parameter type', 'root cause found despite preamble');
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration scenarios
// ═══════════════════════════════════════════════════════════════════════════

suite('integration — full pipeline');

await testAsync('analyze + plan + validate + format', async () => {
  const causeResponse = `ROOT_CAUSE: Missing validate method on OrderService
REASONING: The method was referenced in controller but never added to service class.`;

  const planResponse = `MODIFY src/service.js OrderService add validate method
MODIFY src/controller.js handleOrder use service.validate instead of inline check`;

  let callCount = 0;
  const sequentialLLM = async (_role, _prompt) => {
    callCount++;
    if (callCount === 1) return { content: causeResponse };
    return { content: planResponse };
  };

  const errors = [mkError('MISSING_PROPERTY', 'src/controller.js', 45, 'validate does not exist')];
  const sigCtx = '### src/service.js\n- export class OrderService { processOrder(id) }';
  const mem = mockIterationMemory();

  // Phase 1: Analyze cause
  const cause = await analyzeCause(errors, sigCtx, mem, sequentialLLM);
  assert(cause.rootCause.includes('validate'), 'cause found');

  // Phase 2: Generate plan
  const plan = await generatePatchPlan(errors, cause, sigCtx, sequentialLLM);
  assertEqual(plan.steps.length, 2, 'plan has 2 steps');

  // Phase 3: Validate plan
  const mockIndex = { findSymbol: (name) => name === 'OrderService' ? [{}] : null };
  const validation = validatePlan(plan.steps, { symbolIndex: mockIndex });
  assert(validation.issues.some(i => i.includes('handleOrder')), 'should flag handleOrder as not in index');

  // Phase 4: Format for prompt
  const formatted = formatCritiqueForPrompt(cause, plan, validation);
  assert(formatted.includes('Root cause:'), 'has root cause');
  assert(formatted.includes('Patch plan:'), 'has plan');
  assert(formatted.includes('Validation warnings:'), 'has warnings');
});

await testAsync('graceful degradation — all LLM calls fail', async () => {
  const failLLM = async () => { throw new Error('timeout'); };
  const errors = [mkError('SYNTAX_ERROR', 'a.js', 1, 'err')];

  const cause = await analyzeCause(errors, '', mockIterationMemory(), failLLM);
  const plan = await generatePatchPlan(errors, cause, '', failLLM);
  const validation = validatePlan(plan.steps);
  const formatted = formatCritiqueForPrompt(cause, plan, validation);

  assertEqual(cause.rootCause, '', 'no cause');
  assertEqual(plan.steps.length, 0, 'no plan');
  assertEqual(validation.valid, false, 'empty plan invalid');
  // Empty cause + empty plan → only validation warnings remain
  assert(formatted.includes('Empty plan'), 'validation warning included');
});

// ═══════════════════════════════════════════════════════════════════════════

summary();
