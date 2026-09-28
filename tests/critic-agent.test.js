// tests/critic-agent.test.js — Critic/Repair Agent unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  FailureType,
  classifyFailure,
  analyzeFailure,
  generateRepairRequest,
} from '../src/planner/critic-agent.js';

// ─── Failure Classification ──────────────────────────────────────────────────

suite('Critic Agent — Classification');

test('classifies compile errors', () => {
  const result = classifyFailure({}, null, { passed: false });
  assertEqual(result, FailureType.COMPILE);
});

test('classifies security findings', () => {
  const result = classifyFailure({
    security_findings: ['hardcoded API key in config.js'],
  });
  assertEqual(result, FailureType.SECURITY);
});

test('classifies architecture regressions', () => {
  const result = classifyFailure({}, {
    regressions: { hasRegressions: true, items: [{ type: 'LAYER_VIOLATION_INCREASE' }] },
  });
  assertEqual(result, FailureType.ARCHITECTURE);
});

test('classifies scope violations', () => {
  const result = classifyFailure({
    scope_violations: ['package.json', 'README.md'],
  });
  assertEqual(result, FailureType.SCOPE);
});

test('classifies test failures', () => {
  const result = classifyFailure({
    test_summary: { total: 10, passed: 7, failed: 3 },
  });
  assertEqual(result, FailureType.TEST);
});

test('classifies missing deliverables as LOGIC', () => {
  const result = classifyFailure({
    deliverables_check: [
      { deliverable: 'User model', status: 'DONE' },
      { deliverable: 'Auth service', status: 'MISSING' },
    ],
  });
  assertEqual(result, FailureType.LOGIC);
});

test('defaults to LOGIC for unknown failures', () => {
  const result = classifyFailure({
    overall_assessment: 'Something went wrong',
  });
  assertEqual(result, FailureType.LOGIC);
});

test('compile errors take priority over security', () => {
  const result = classifyFailure(
    { security_findings: ['hardcoded secret'] },
    null,
    { passed: false }
  );
  assertEqual(result, FailureType.COMPILE);
});

test('fix_instructions clues: compile keywords', () => {
  const result = classifyFailure({
    fix_instructions: ['Fix import statement in server.js'],
  });
  assertEqual(result, FailureType.COMPILE);
});

test('fix_instructions clues: security keywords', () => {
  const result = classifyFailure({
    fix_instructions: ['Remove injection vulnerability in query builder'],
  });
  assertEqual(result, FailureType.SECURITY);
});

// ─── Failure Analysis ────────────────────────────────────────────────────────

suite('Critic Agent — Analysis');

test('analyzeFailure returns fix plan', () => {
  const plan = analyzeFailure(
    { fix_instructions: ['Fix auth service'] },
    null,
    { id: 'ms-1', title: 'Auth', scope_files: '["src/auth.js"]' }
  );

  assert(plan.failureType, 'should have failureType');
  assert(Array.isArray(plan.instructions), 'should have instructions array');
  assert(Array.isArray(plan.affectedFiles), 'should have affectedFiles');
  assert(plan.instructions.length > 0, 'should have at least 1 instruction');
});

test('analyzeFailure for compile includes compile errors', () => {
  const milestone = {
    id: 'ms-1',
    title: 'Setup',
    _lastCompileErrors: ['src/server.js:10:5 SyntaxError: unexpected token'],
  };
  const plan = analyzeFailure({}, null, milestone);
  // With compile errors on milestone, classification may detect via _lastCompileErrors
  assert(plan.instructions.length > 0, 'should have instructions');
});

test('analyzeFailure for architecture includes regression details', () => {
  const audit = {
    regressions: {
      hasRegressions: true,
      items: [{ type: 'LAYER_VIOLATION_INCREASE', message: '3 new violations' }],
    },
    acfViolations: [{ file: 'src/ctrl.js', fromLayer: 'controller', toLayer: 'repository', rule: 'skip service' }],
    duplicates: [],
  };
  const plan = analyzeFailure({}, audit, { id: 'ms-2', title: 'API' });
  assertEqual(plan.failureType, FailureType.ARCHITECTURE);
  const instText = plan.instructions.join('\n');
  assert(instText.includes('3 new violations'), 'should include regression detail');
});

test('analyzeFailure extracts affected files from scope_files', () => {
  const plan = analyzeFailure(
    {},
    null,
    { id: 'ms-1', title: 'Test', scope_files: '["src/a.js", "src/b.js"]' }
  );
  assert(plan.affectedFiles.length >= 2, `should have >=2 files, got: ${plan.affectedFiles.length}`);
});

test('analyzeFailure extracts affected files from compile errors', () => {
  const plan = analyzeFailure(
    {},
    null,
    { id: 'ms-1', title: 'Fix', _lastCompileErrors: ['src/foo.js:5 Error'] }
  );
  assert(plan.affectedFiles.includes('src/foo.js'), 'should extract file from compile error');
});

// ─── Repair Request Generation ───────────────────────────────────────────────

suite('Critic Agent — Repair Request');

test('generates repair request', () => {
  const fixPlan = {
    failureType: FailureType.COMPILE,
    instructions: ['Fix syntax error in server.js line 42'],
    affectedFiles: ['src/server.js'],
    priority: 'HIGH',
  };
  const request = generateRepairRequest(fixPlan, { id: 'ms-1', title: 'Setup' }, 'original request text');
  assert(request.includes('REPAIR'), 'should contain REPAIR');
  assert(request.includes('COMPILE'), 'should mention failure type');
  assert(request.includes('src/server.js'), 'should mention affected file');
  assert(request.includes('TARGETED REPAIR'), 'should emphasize targeted fix');
});

test('repair request includes guidance for SECURITY', () => {
  const fixPlan = {
    failureType: FailureType.SECURITY,
    instructions: ['Remove hardcoded API key'],
    affectedFiles: ['src/config.js'],
  };
  const request = generateRepairRequest(fixPlan, { id: 'ms-3', title: 'Auth' }, '');
  assert(request.includes('environment variables'), 'should mention env vars');
  assert(request.includes('input validation'), 'should mention validation');
});

test('repair request includes guidance for ARCHITECTURE', () => {
  const fixPlan = {
    failureType: FailureType.ARCHITECTURE,
    instructions: ['Fix layer violation'],
    affectedFiles: ['src/controller/api.js'],
  };
  const request = generateRepairRequest(fixPlan, { id: 'ms-2', title: 'API' }, '');
  assert(request.includes('layer violations'), 'should mention layer violations');
  assert(request.includes('circular dependencies'), 'should mention circular deps');
});

test('repair request truncates long original request', () => {
  const longOriginal = 'x'.repeat(5000);
  const fixPlan = {
    failureType: FailureType.LOGIC,
    instructions: ['Fix bug'],
    affectedFiles: [],
  };
  const request = generateRepairRequest(fixPlan, { id: 'ms-1', title: 'Fix' }, longOriginal);
  assert(request.includes('[truncated]'), 'should truncate long original');
  assert(request.length < longOriginal.length, 'repair request should be shorter than original');
});

test('repair request without original context', () => {
  const fixPlan = {
    failureType: FailureType.TEST,
    instructions: ['Fix failing test'],
    affectedFiles: ['tests/user.test.js'],
  };
  const request = generateRepairRequest(fixPlan, { id: 'ms-1', title: 'Test' }, '');
  assert(request.includes('REPAIR'), 'should still have REPAIR');
  assert(!request.includes('Original Milestone Context'), 'should not have context section');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();
