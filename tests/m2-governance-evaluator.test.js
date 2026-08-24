#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { suite, test, summary } from './harness.js';
import {
  M2_GOVERNANCE_CONTRACT_KIND,
  M2_GOVERNANCE_CONTRACT_VERSION,
  M2_GOVERNANCE_REQUIRED_CHECKS,
  computeM2GovernanceBaselineDigest,
  computeM2GovernanceDecisionDigest,
  validateM2GovernanceBaselineSnapshot,
  validateM2GovernanceDecision,
  validateM2GovernanceReceiptForDecision,
} from '../contracts/m2/governance-v1.js';
import {
  M2_EXECUTION_CONTRACT_KIND,
  M2_EXECUTION_CONTRACT_VERSION,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeAuthoritySetDigest,
  computeM2ProjectChangePatchSetDigest,
  computeM2ProjectChangeRequestDigest,
} from '../contracts/m2/execution-v1.js';
import {
  createM2GovernanceReceipt,
  evaluateM2Governance,
} from '../src/lifecycle/m2-governance-evaluator.js';

const BEFORE_REVISION = `wsr1:${'1'.repeat(64)}`;
const AFTER_REVISION = `wsr1:${'2'.repeat(64)}`;
const BEFORE_HEAD = '3'.repeat(40);
const AFTER_HEAD = '4'.repeat(40);
const EMPTY_DIGEST = sha(Buffer.alloc(0));

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function authority(effectId) {
  return { effectId, requestDigest: EMPTY_DIGEST };
}

function baselineFile(path, content) {
  const bytes = Buffer.from(content);
  return { path, contentBase64: b64(bytes), digest: sha(bytes), bytes: bytes.length };
}

function change(path, beforeContent, afterContent, suffix = path.replace(/[^A-Za-z0-9]/g, '-')) {
  const before = beforeContent === null ? null : Buffer.from(beforeContent);
  const after = Buffer.from(afterContent);
  return {
    path,
    before: before === null
      ? { exists: false, digest: null, bytes: 0, mode: null }
      : { exists: true, digest: sha(before), bytes: before.length, mode: 0o644 },
    after: { digest: sha(after), bytes: after.length, mode: 0o644 },
    forwardAuthority: authority(`effect-forward-${suffix}`),
    rollbackAuthority: authority(`effect-rollback-${suffix}`),
  };
}

function request(changes, overrides = {}) {
  const value = {
    contract: M2_EXECUTION_CONTRACT_KIND.REQUEST,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: 'execution-governance-1',
    runId: 'run-governance-1',
    actor: { type: 'user', id: 'operator-1' },
    origin: {
      surface: 'lifecycle',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    project: {
      projectId: 17,
      canonicalRoot: '/workspace/project',
      workspaceRevision: BEFORE_REVISION,
      gitHead: BEFORE_HEAD,
      gitBranchRef: 'refs/heads/codex/m2-governance',
      foreignDirtDigest: EMPTY_DIGEST,
    },
    patchSetDigest: EMPTY_DIGEST,
    changes,
    focusedTest: {
      authority: authority('effect-focused-test'),
      binary: '/usr/bin/node',
      argv: ['--test', 'tests/focused.test.js'],
      argvDigest: EMPTY_DIGEST,
      canonicalCwd: '/workspace/project',
      environmentDigest: EMPTY_DIGEST,
      timeoutMs: 120_000,
      expectedExitCode: 0,
      sandboxProfile: 'linux-bwrap-ro-v2',
    },
    gitCommit: {
      authority: authority('effect-git'),
      expectedHead: BEFORE_HEAD,
      branchRef: 'refs/heads/codex/m2-governance',
      paths: changes.map(item => item.path),
      messageDigest: EMPTY_DIGEST,
      identityDigest: EMPTY_DIGEST,
    },
    authoritySetDigest: EMPTY_DIGEST,
    createdAt: '2026-08-24T12:00:00.000Z',
    ...overrides,
  };
  value.patchSetDigest = computeM2ProjectChangePatchSetDigest(value.changes);
  value.focusedTest.argvDigest = computeM2ExecutionValueDigest(value.focusedTest.argv);
  value.authoritySetDigest = computeM2ProjectChangeAuthoritySetDigest(value);
  return value;
}

function result(boundRequest, overrides = {}) {
  return {
    contract: M2_EXECUTION_CONTRACT_KIND.RESULT,
    version: M2_EXECUTION_CONTRACT_VERSION,
    executionId: boundRequest.executionId,
    requestDigest: computeM2ProjectChangeRequestDigest(boundRequest),
    runId: boundRequest.runId,
    projectId: boundRequest.project.projectId,
    terminalStatus: 'succeeded',
    fencingGeneration: 1,
    startedAt: '2026-08-24T12:00:01.000Z',
    completedAt: '2026-08-24T12:00:02.000Z',
    changes: {
      paths: boundRequest.changes.map(item => item.path),
      beforeRevision: boundRequest.project.workspaceRevision,
      afterRevision: AFTER_REVISION,
      diffDigest: sha(Buffer.from('diff')),
    },
    focusedTest: {
      effectId: boundRequest.focusedTest.authority.effectId,
      terminalStatus: 'succeeded',
      exitCode: 0,
      signal: null,
      stdoutDigest: EMPTY_DIGEST,
      stderrDigest: EMPTY_DIGEST,
      outputTruncated: false,
    },
    git: {
      status: 'committed',
      beforeHead: BEFORE_HEAD,
      afterHead: AFTER_HEAD,
      commitId: AFTER_HEAD,
      foreignDirtPreserved: true,
    },
    rollback: { required: false, status: 'not_required', paths: [], evidenceRef: null },
    errorCode: null,
    evidenceRefs: ['artifact:diff', 'artifact:focused-test'],
    lateCompletionRejected: false,
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    contract: M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    policyId: 'policy-1',
    projectId: 17,
    workspaceRevision: BEFORE_REVISION,
    policyPath: '.c3/architecture-policy.json',
    layers: [
      { name: 'controller', roots: ['src/controllers'] },
      { name: 'service', roots: ['src/services'] },
    ],
    rules: [
      { from: 'controller', canImport: ['service'] },
      { from: 'service', canImport: [] },
    ],
    externalImports: [],
    sourceExtensions: ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'],
    requiredChecks: [...M2_GOVERNANCE_REQUIRED_CHECKS],
    unmappedFilePolicy: 'unavailable',
    ...overrides,
  };
}

function baseline(files, overrides = {}) {
  return {
    projectId: 17,
    workspaceRevision: BEFORE_REVISION,
    complete: true,
    files: [...files].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path))),
    ...overrides,
  };
}

function candidates(changes, afterByPath) {
  return changes.map(item => ({ path: item.path, contentBase64: b64(afterByPath.get(item.path)) }));
}

function setup({ appAfter = "import { service } from '../services/service.js';\nexport const app = service;\n" } = {}) {
  const appBefore = 'export const app = 1;\n';
  const service = 'export const service = 2;\n';
  const changes = [change('src/controllers/app.js', appBefore, appAfter, 'app')];
  const boundRequest = request(changes);
  const baselineSnapshot = baseline([
    baselineFile('src/controllers/app.js', appBefore),
    baselineFile('src/services/service.js', service),
  ]);
  const candidateFiles = candidates(changes, new Map([[changes[0].path, appAfter]]));
  return { boundRequest, baselineSnapshot, candidateFiles, policySnapshot: policy() };
}

function evaluate(inputs, overrides = {}) {
  return evaluateM2Governance({
    lifecycleId: 'lifecycle-1',
    milestoneId: 'milestone-1',
    request: inputs.boundRequest,
    policySnapshot: inputs.policySnapshot,
    baselineSnapshot: inputs.baselineSnapshot,
    candidateFiles: inputs.candidateFiles,
    expectedAfterRevision: AFTER_REVISION,
    ...overrides,
  });
}

function check(decision, checkId) {
  return decision.checks.find(item => item.checkId === checkId);
}

suite('M2 governance evaluator — deterministic allow/deny');

test('complete exact request under pinned policy produces all-pass allow', () => {
  const inputs = setup();
  const decision = evaluate(inputs);
  assert.equal(validateM2GovernanceDecision(decision).valid, true);
  assert.equal(decision.verdict, 'allow');
  assert.equal(decision.findings.length, 0);
  assert(decision.checks.every(item => item.status === 'pass'));
  assert.equal(decision.requestDigest, computeM2ProjectChangeRequestDigest(inputs.boundRequest));
  assert.equal(decision.baselineDigest, computeM2GovernanceBaselineDigest(inputs.baselineSnapshot));
  assert.equal(decision.expectedAfterRevision, AFTER_REVISION);
});

test('explicit service-to-controller violation deterministically denies', () => {
  const serviceBefore = 'export const service = 1;\n';
  const serviceAfter = "import { app } from '../controllers/app.js';\nexport const service = app;\n";
  const changes = [change('src/services/service.js', serviceBefore, serviceAfter, 'service')];
  const inputs = {
    boundRequest: request(changes),
    policySnapshot: policy(),
    baselineSnapshot: baseline([
      baselineFile('src/controllers/app.js', 'export const app = 1;\n'),
      baselineFile('src/services/service.js', serviceBefore),
    ]),
    candidateFiles: candidates(changes, new Map([[changes[0].path, serviceAfter]])),
  };
  const decision = evaluate(inputs);
  assert.equal(decision.verdict, 'deny');
  assert.equal(check(decision, 'imports.allowed').status, 'fail');
  assert(decision.findings.some(finding => finding.code === 'IMPORT_LAYER_VIOLATION'));
  assert.deepEqual(decision.blockingFindingIds, decision.findings.map(finding => finding.findingId));
});

test('project-root import that resolves to inventoried source is governed, not external', () => {
  const serviceBefore = 'export const service = 1;\n';
  const serviceAfter = "import { app } from 'src/controllers/app.js';\nexport const service = app;\n";
  const changes = [change('src/services/service.js', serviceBefore, serviceAfter, 'root-import')];
  const inputs = {
    boundRequest: request(changes),
    policySnapshot: policy(),
    baselineSnapshot: baseline([
      baselineFile('src/controllers/app.js', 'export const app = 1;\n'),
      baselineFile('src/services/service.js', serviceBefore),
    ]),
    candidateFiles: candidates(changes, new Map([[changes[0].path, serviceAfter]])),
  };
  const decision = evaluate(inputs);
  assert.equal(decision.verdict, 'deny');
  assert(decision.findings.some(finding => finding.code === 'IMPORT_LAYER_VIOLATION'));
});

test('external imports require an explicit exact policy allowlist entry', () => {
  const appBefore = 'export const app = 1;\n';
  const appAfter = "import React from 'react';\nexport const app = React;\n";
  const changes = [change('src/controllers/app.js', appBefore, appAfter, 'external-import')];
  const inputs = {
    boundRequest: request(changes),
    policySnapshot: policy(),
    baselineSnapshot: baseline([
      baselineFile('src/controllers/app.js', appBefore),
      baselineFile('src/services/service.js', 'export const service = 1;\n'),
    ]),
    candidateFiles: candidates(changes, new Map([[changes[0].path, appAfter]])),
  };
  const unavailable = evaluate(inputs);
  assert.equal(unavailable.verdict, 'unavailable');
  assert(unavailable.findings.some(finding => finding.code === 'EXTERNAL_IMPORT_UNDECLARED'));

  inputs.policySnapshot = policy({ externalImports: ['react'] });
  assert.equal(evaluate(inputs).verdict, 'allow');
});

test('same canonical inputs produce byte-identical decision and digest', () => {
  const inputs = setup();
  const first = evaluate(inputs);
  const second = evaluate(structuredClone(inputs));
  assert.deepEqual(second, first);
  assert.equal(computeM2GovernanceDecisionDigest(second), computeM2GovernanceDecisionDigest(first));
});

suite('M2 governance evaluator — fail-closed availability');

test('invalid or foreign policy is unavailable, never an empty success', () => {
  const inputs = setup();
  const invalid = evaluate(inputs, {
    policySnapshot: { ...inputs.policySnapshot, requiredChecks: ['imports.allowed'] },
  });
  const foreign = evaluate(inputs, {
    policySnapshot: { ...inputs.policySnapshot, projectId: 18 },
  });
  for (const decision of [invalid, foreign]) {
    assert.equal(decision.verdict, 'unavailable');
    assert.equal(check(decision, 'input.bindings').status, 'unavailable');
    assert(decision.blockingFindingIds.length > 0);
  }
});

test('explicitly truncated baseline is unavailable regardless of clean visible files', () => {
  const inputs = setup();
  const decision = evaluate(inputs, {
    baselineSnapshot: { ...inputs.baselineSnapshot, complete: false },
  });
  assert.equal(decision.verdict, 'unavailable');
  assert.equal(check(decision, 'inventory.complete').status, 'unavailable');
  assert(decision.findings.some(finding => finding.code === 'INVENTORY_TRUNCATED'));
});

test('unmapped source and policy-declared unsupported required language are unavailable', () => {
  const unmapped = setup();
  unmapped.baselineSnapshot = baseline([
    ...unmapped.baselineSnapshot.files,
    baselineFile('src/other/foreign.js', 'export const foreign = true;\n'),
  ]);
  const unmappedDecision = evaluate(unmapped);

  const unsupported = setup();
  unsupported.policySnapshot = policy({
    sourceExtensions: ['.cjs', '.js', '.jsx', '.mjs', '.py', '.ts', '.tsx'],
  });
  unsupported.baselineSnapshot = baseline([
    ...unsupported.baselineSnapshot.files,
    baselineFile('src/services/worker.py', 'def work():\n    return 1\n'),
  ]);
  const unsupportedDecision = evaluate(unsupported);
  assert.equal(unmappedDecision.verdict, 'unavailable');
  assert(unmappedDecision.findings.some(finding => finding.code === 'SOURCE_FILE_UNMAPPED'));
  assert.equal(unsupportedDecision.verdict, 'unavailable');
  assert(unsupportedDecision.findings.some(finding => finding.code === 'SOURCE_LANGUAGE_UNSUPPORTED'));
});

test('policy-declared source kinds fail closed in baseline and candidate while undeclared kinds are data', () => {
  const baselineUnsupported = setup();
  baselineUnsupported.policySnapshot = policy({
    sourceExtensions: ['.c', '.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'],
  });
  baselineUnsupported.baselineSnapshot = baseline([
    ...baselineUnsupported.baselineSnapshot.files,
    baselineFile('src/services/native.c', 'int work(void) { return 1; }\n'),
  ]);
  const baselineDecision = evaluate(baselineUnsupported);
  assert.equal(baselineDecision.verdict, 'unavailable');
  assert(baselineDecision.findings.some(finding => (
    finding.code === 'SOURCE_LANGUAGE_UNSUPPORTED' && finding.path === 'src/services/native.c'
  )));

  const before = 'int work(void) { return 1; }\n';
  const after = 'int work(void) { return 2; }\n';
  const nativeChange = change('src/services/native.c', before, after, 'native-c');
  const candidateUnsupported = {
    boundRequest: request([nativeChange]),
    policySnapshot: baselineUnsupported.policySnapshot,
    baselineSnapshot: baseline([
      baselineFile('src/controllers/app.js', 'export const app = 1;\n'),
      baselineFile('src/services/native.c', before),
    ]),
    candidateFiles: candidates([nativeChange], new Map([[nativeChange.path, after]])),
  };
  const candidateDecision = evaluate(candidateUnsupported);
  assert.equal(candidateDecision.verdict, 'unavailable');
  assert(candidateDecision.findings.some(finding => (
    finding.code === 'SOURCE_LANGUAGE_UNSUPPORTED' && finding.path === nativeChange.path
  )));

  const declaredData = setup();
  declaredData.baselineSnapshot = baseline([
    ...declaredData.baselineSnapshot.files,
    baselineFile('src/services/worker.py', 'from src.controllers.app import app\n'),
  ]);
  const dataDecision = evaluate(declaredData);
  assert.equal(dataDecision.verdict, 'allow');
  assert.equal(dataDecision.findings.length, 0);
});

test('missing, extra, reordered or digest-mismatched candidate material is unavailable', () => {
  const inputs = setup();
  const missing = evaluate(inputs, { candidateFiles: [] });
  const extra = evaluate(inputs, {
    candidateFiles: [...inputs.candidateFiles, { path: 'src/services/extra.js', contentBase64: b64('') }],
  });
  const mismatched = evaluate(inputs, {
    candidateFiles: [{ ...inputs.candidateFiles[0], contentBase64: b64('tampered') }],
  });
  for (const decision of [missing, extra, mismatched]) {
    assert.equal(decision.verdict, 'unavailable');
    assert(decision.findings.some(finding => finding.code === 'CANDIDATE_MATERIAL_INVALID'));
  }
});

test('baseline-before mismatch and malformed expected revision are unavailable', () => {
  const inputs = setup();
  const mismatchedBaseline = structuredClone(inputs.baselineSnapshot);
  mismatchedBaseline.files[0] = baselineFile(
    'src/controllers/app.js',
    'export const app = 999;\n',
  );
  const baselineDecision = evaluate(inputs, { baselineSnapshot: mismatchedBaseline });
  const revisionDecision = evaluate(inputs, { expectedAfterRevision: 'not-a-revision' });
  assert.equal(baselineDecision.verdict, 'unavailable');
  assert(baselineDecision.findings.some(finding => finding.code === 'BASELINE_BEFORE_IMAGE_MISMATCH'));
  assert.equal(revisionDecision.verdict, 'unavailable');
  assert(revisionDecision.findings.some(finding => finding.code === 'EXPECTED_AFTER_REVISION_INVALID'));
});

test('valid expected revision may equal the before revision', () => {
  const inputs = setup();
  const decision = evaluate(inputs, { expectedAfterRevision: BEFORE_REVISION });
  assert.equal(decision.verdict, 'allow');
  assert.equal(decision.expectedAfterRevision, BEFORE_REVISION);
  assert.equal(decision.findings.length, 0);
});

test('unresolved relative import and invalid UTF-8 source are unavailable', () => {
  const unresolved = setup({ appAfter: "import './missing.js';\nexport const app = 1;\n" });
  const unresolvedDecision = evaluate(unresolved);

  const inputs = setup();
  const invalidBytes = Buffer.from([0xff, 0xfe, 0xfd]);
  const before = 'export const app = 1;\n';
  const changes = [change('src/controllers/app.js', before, invalidBytes, 'invalid-utf8')];
  const invalidUtf8 = {
    boundRequest: request(changes),
    policySnapshot: policy(),
    baselineSnapshot: baseline([
      baselineFile('src/controllers/app.js', before),
      baselineFile('src/services/service.js', 'export const service = 2;\n'),
    ]),
    candidateFiles: [{ path: changes[0].path, contentBase64: b64(invalidBytes) }],
  };
  const utf8Decision = evaluate(invalidUtf8);
  assert.equal(unresolvedDecision.verdict, 'unavailable');
  assert(unresolvedDecision.findings.some(finding => finding.code === 'RELATIVE_IMPORT_UNRESOLVED'));
  assert.equal(utf8Decision.verdict, 'unavailable');
  assert(utf8Decision.findings.some(finding => finding.code === 'SOURCE_NOT_UTF8'));
  assert.equal(inputs.boundRequest.changes.length, 1);
});

test('unrecognized import forms are unavailable instead of silently omitted', () => {
  for (const appAfter of [
    "const target = '../services/service.js';\nexport const app = import(target);\n",
    "const target = '../services/service.js';\nexport const app = require(target);\n",
    "export { service } from /* indirection */ '../services/service.js';\n",
  ]) {
    const decision = evaluate(setup({ appAfter }));
    assert.equal(decision.verdict, 'unavailable');
    assert(decision.findings.some(finding => finding.code === 'IMPORT_SYNTAX_UNSUPPORTED'));
  }
});

test('scan has no 200-file false-pass limit', () => {
  const files = [];
  for (let index = 0; index < 201; index += 1) {
    files.push(baselineFile(
      `src/controllers/c${String(index).padStart(3, '0')}.js`,
      `export const c${index} = ${index};\n`,
    ));
  }
  const servicePath = 'src/services/zz.js';
  const serviceBefore = 'export const zz = 1;\n';
  const serviceAfter = "import { c200 } from '../controllers/c200.js';\nexport const zz = c200;\n";
  files.push(baselineFile(servicePath, serviceBefore));
  const changes = [change(servicePath, serviceBefore, serviceAfter, 'late-file')];
  const inputs = {
    boundRequest: request(changes),
    policySnapshot: policy(),
    baselineSnapshot: baseline(files),
    candidateFiles: candidates(changes, new Map([[servicePath, serviceAfter]])),
  };
  assert.equal(inputs.baselineSnapshot.files.length, 202);
  const decision = evaluate(inputs);
  assert.equal(decision.verdict, 'deny');
  assert(decision.findings.some(finding => finding.code === 'IMPORT_LAYER_VIOLATION'));
});

test('policy changed in same request is terminally denied under the old snapshot', () => {
  const policyPath = '.c3/architecture-policy.json';
  const oldPolicyBytes = '{"serviceCanImport":[]}\n';
  const relaxedPolicyBytes = '{"serviceCanImport":["controller"]}\n';
  const changes = [change(policyPath, oldPolicyBytes, relaxedPolicyBytes, 'policy')];
  const inputs = {
    boundRequest: request(changes),
    policySnapshot: policy(),
    baselineSnapshot: baseline([
      baselineFile(policyPath, oldPolicyBytes),
      baselineFile('src/controllers/app.js', 'export const app = 1;\n'),
      baselineFile('src/services/service.js', 'export const service = 1;\n'),
    ]),
    candidateFiles: candidates(changes, new Map([[policyPath, relaxedPolicyBytes]])),
  };
  const decision = evaluate(inputs);
  assert.equal(decision.verdict, 'deny');
  assert.equal(check(decision, 'input.bindings').status, 'fail');
  assert(decision.findings.some(finding => (
    finding.code === 'POLICY_SELF_CHANGE_FORBIDDEN' && finding.path === policyPath
  )));
  assert.equal(check(decision, 'imports.allowed').status, 'pass');
});

test('malformed baseline and candidates fail closed without validator exceptions', () => {
  const inputs = setup();
  for (const malformedBaseline of [
    { ...inputs.baselineSnapshot, files: [{ path: null }] },
    { ...inputs.baselineSnapshot, files: [null, null] },
  ]) {
    assert.doesNotThrow(() => validateM2GovernanceBaselineSnapshot(malformedBaseline));
    assert.equal(validateM2GovernanceBaselineSnapshot(malformedBaseline).valid, false);
    assert.equal(evaluate(inputs, { baselineSnapshot: malformedBaseline }).verdict, 'unavailable');
  }
  for (const malformedCandidates of [[null, null], [{ path: null }]]) {
    assert.doesNotThrow(() => evaluate(inputs, { candidateFiles: malformedCandidates }));
    assert.equal(evaluate(inputs, { candidateFiles: malformedCandidates }).verdict, 'unavailable');
  }
});

suite('M2 governance evaluator — exact succeeded receipt');

test('allow plus exact succeeded ProjectChangeResult creates a bound receipt', () => {
  const inputs = setup();
  const decision = evaluate(inputs);
  const boundResult = result(inputs.boundRequest);
  const receipt = createM2GovernanceReceipt({
    request: inputs.boundRequest,
    result: boundResult,
    decision,
    recordedAt: '2026-08-24T12:00:03.000Z',
  });
  const checked = validateM2GovernanceReceiptForDecision(
    inputs.boundRequest,
    boundResult,
    decision,
    receipt,
  );
  assert.equal(checked.valid, true, checked.errors.join(', '));
  assert.equal(receipt.resultDigest, computeM2ExecutionValueDigest(boundResult));
  assert.equal(receipt.actualAfterRevision, decision.expectedAfterRevision);
});

test('deny decision, non-succeeded result and mismatched after revision cannot receipt', () => {
  const deniedInputs = setup({
    appAfter: "import { service } from '../services/service.js';\nexport const app = service;\n",
  });
  deniedInputs.policySnapshot = policy({
    rules: [
      { from: 'controller', canImport: [] },
      { from: 'service', canImport: [] },
    ],
  });
  const denied = evaluate(deniedInputs);
  const deniedResult = result(deniedInputs.boundRequest);
  assert.equal(denied.verdict, 'deny');
  assert.throws(() => createM2GovernanceReceipt({
    request: deniedInputs.boundRequest,
    result: deniedResult,
    decision: denied,
    recordedAt: '2026-08-24T12:00:03.000Z',
  }), /allow-decision-required/);

  const inputs = setup();
  const allowed = evaluate(inputs);
  const failed = result(inputs.boundRequest, { terminalStatus: 'failed', errorCode: 'TEST_FAILED' });
  assert.throws(() => createM2GovernanceReceipt({
    request: inputs.boundRequest,
    result: failed,
    decision: allowed,
    recordedAt: '2026-08-24T12:00:03.000Z',
  }), /not-bound/);
  const changedRevision = result(inputs.boundRequest, {
    changes: {
      ...result(inputs.boundRequest).changes,
      afterRevision: `wsr1:${'9'.repeat(64)}`,
    },
  });
  assert.throws(() => createM2GovernanceReceipt({
    request: inputs.boundRequest,
    result: changedRevision,
    decision: allowed,
    recordedAt: '2026-08-24T12:00:03.000Z',
  }), /invalid|not-bound/);
});

test('baseline validator itself rejects unsorted, duplicate and forged bytes', () => {
  const valid = setup().baselineSnapshot;
  assert.equal(validateM2GovernanceBaselineSnapshot(valid).valid, true);
  const unsorted = { ...valid, files: [...valid.files].reverse() };
  const duplicate = { ...valid, files: [valid.files[0], valid.files[0]] };
  const forged = structuredClone(valid);
  forged.files[0].digest = EMPTY_DIGEST;
  for (const malformed of [unsorted, duplicate, forged]) {
    assert.equal(validateM2GovernanceBaselineSnapshot(malformed).valid, false);
  }
});

summary();
