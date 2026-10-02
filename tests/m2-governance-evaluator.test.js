#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

import { suite, testAsync, summary } from './harness.js';
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
  prepareM2GovernanceSourceSet,
} from '../src/lifecycle/m2-governance-evaluator.js';

import { evaluateM2GovernanceWithAst } from '../src/lifecycle/m2-governance-ast-adapter.js';
import { observeM2Imports, readM2ImportObservation, IMPORT_SCANNER_LIMITS } from '../src/lifecycle/m2-import-scanner.js';

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
    policyPath: '.intentsmith/architecture-policy.json',
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

function boundArgs(inputs, overrides = {}) {
  return {
    lifecycleId: 'lifecycle-1',
    milestoneId: 'milestone-1',
    request: inputs.boundRequest,
    policySnapshot: inputs.policySnapshot,
    baselineSnapshot: inputs.baselineSnapshot,
    candidateFiles: inputs.candidateFiles,
    expectedAfterRevision: AFTER_REVISION,
    ...overrides,
  };
}

function evaluate(inputs, overrides = {}, options = {}) {
  return evaluateM2GovernanceWithAst(boundArgs(inputs, overrides), options);
}

function check(decision, checkId) {
  return decision.checks.find(item => item.checkId === checkId);
}

suite('M2 governance evaluator — deterministic allow/deny');

await testAsync('complete exact request under pinned policy produces all-pass allow', async () => {
  const inputs = setup();
  const decision = (await evaluate(inputs));
  assert.equal(validateM2GovernanceDecision(decision).valid, true);
  assert.equal(decision.verdict, 'allow');
  assert.equal(decision.findings.length, 0);
  assert(decision.checks.every(item => item.status === 'pass'));
  assert.equal(decision.requestDigest, computeM2ProjectChangeRequestDigest(inputs.boundRequest));
  assert.equal(decision.baselineDigest, computeM2GovernanceBaselineDigest(inputs.baselineSnapshot));
  assert.equal(decision.expectedAfterRevision, AFTER_REVISION);
});

await testAsync('explicit service-to-controller violation deterministically denies', async () => {
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
  const decision = (await evaluate(inputs));
  assert.equal(decision.verdict, 'deny');
  assert.equal(check(decision, 'imports.allowed').status, 'fail');
  assert(decision.findings.some(finding => finding.code === 'IMPORT_LAYER_VIOLATION'));
  assert.deepEqual(decision.blockingFindingIds, decision.findings.map(finding => finding.findingId));
});

await testAsync('project-root import that resolves to inventoried source is governed, not external', async () => {
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
  const decision = (await evaluate(inputs));
  assert.equal(decision.verdict, 'deny');
  assert(decision.findings.some(finding => finding.code === 'IMPORT_LAYER_VIOLATION'));
});

await testAsync('external imports require an explicit exact policy allowlist entry', async () => {
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
  const unavailable = (await evaluate(inputs));
  assert.equal(unavailable.verdict, 'unavailable');
  assert(unavailable.findings.some(finding => finding.code === 'EXTERNAL_IMPORT_UNDECLARED'));

  inputs.policySnapshot = policy({ externalImports: ['react'] });
  assert.equal((await evaluate(inputs)).verdict, 'allow');
});

await testAsync('same canonical inputs produce byte-identical decision and digest', async () => {
  const inputs = setup();
  const first = (await evaluate(inputs));
  const second = (await evaluate(structuredClone(inputs)));
  assert.deepEqual(second, first);
  assert.equal(computeM2GovernanceDecisionDigest(second), computeM2GovernanceDecisionDigest(first));
});

suite('M2 governance evaluator — fail-closed availability');

await testAsync('invalid or foreign policy is unavailable, never an empty success', async () => {
  const inputs = setup();
  const invalid = (await evaluate(inputs, {
    policySnapshot: { ...inputs.policySnapshot, requiredChecks: ['imports.allowed'] },
  }));
  const foreign = (await evaluate(inputs, {
    policySnapshot: { ...inputs.policySnapshot, projectId: 18 },
  }));
  for (const decision of [invalid, foreign]) {
    assert.equal(decision.verdict, 'unavailable');
    assert.equal(check(decision, 'input.bindings').status, 'unavailable');
    assert(decision.blockingFindingIds.length > 0);
  }
});

await testAsync('explicitly truncated baseline is unavailable regardless of clean visible files', async () => {
  const inputs = setup();
  const decision = (await evaluate(inputs, {
    baselineSnapshot: { ...inputs.baselineSnapshot, complete: false },
  }));
  assert.equal(decision.verdict, 'unavailable');
  assert.equal(check(decision, 'inventory.complete').status, 'unavailable');
  assert(decision.findings.some(finding => finding.code === 'INVENTORY_TRUNCATED'));
});

await testAsync('unmapped source and policy-declared unsupported required language are unavailable', async () => {
  const unmapped = setup();
  unmapped.baselineSnapshot = baseline([
    ...unmapped.baselineSnapshot.files,
    baselineFile('src/other/foreign.js', 'export const foreign = true;\n'),
  ]);
  const unmappedDecision = (await evaluate(unmapped));

  const unsupported = setup();
  unsupported.policySnapshot = policy({
    sourceExtensions: ['.cjs', '.js', '.jsx', '.mjs', '.py', '.ts', '.tsx'],
  });
  unsupported.baselineSnapshot = baseline([
    ...unsupported.baselineSnapshot.files,
    baselineFile('src/services/worker.py', 'def work():\n    return 1\n'),
  ]);
  const unsupportedDecision = (await evaluate(unsupported));
  assert.equal(unmappedDecision.verdict, 'unavailable');
  assert(unmappedDecision.findings.some(finding => finding.code === 'SOURCE_FILE_UNMAPPED'));
  assert.equal(unsupportedDecision.verdict, 'unavailable');
  assert(unsupportedDecision.findings.some(finding => finding.code === 'SOURCE_LANGUAGE_UNSUPPORTED'));
});

await testAsync('policy-declared source kinds fail closed in baseline and candidate while undeclared kinds are data', async () => {
  const baselineUnsupported = setup();
  baselineUnsupported.policySnapshot = policy({
    sourceExtensions: ['.c', '.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'],
  });
  baselineUnsupported.baselineSnapshot = baseline([
    ...baselineUnsupported.baselineSnapshot.files,
    baselineFile('src/services/native.c', 'int work(void) { return 1; }\n'),
  ]);
  const baselineDecision = (await evaluate(baselineUnsupported));
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
  const candidateDecision = (await evaluate(candidateUnsupported));
  assert.equal(candidateDecision.verdict, 'unavailable');
  assert(candidateDecision.findings.some(finding => (
    finding.code === 'SOURCE_LANGUAGE_UNSUPPORTED' && finding.path === nativeChange.path
  )));

  const declaredData = setup();
  declaredData.baselineSnapshot = baseline([
    ...declaredData.baselineSnapshot.files,
    baselineFile('src/services/worker.py', 'from src.controllers.app import app\n'),
  ]);
  const dataDecision = (await evaluate(declaredData));
  assert.equal(dataDecision.verdict, 'allow');
  assert.equal(dataDecision.findings.length, 0);
});

await testAsync('missing, extra, reordered or digest-mismatched candidate material is unavailable', async () => {
  const inputs = setup();
  const missing = (await evaluate(inputs, { candidateFiles: [] }));
  const extra = (await evaluate(inputs, {
    candidateFiles: [...inputs.candidateFiles, { path: 'src/services/extra.js', contentBase64: b64('') }],
  }));
  const mismatched = (await evaluate(inputs, {
    candidateFiles: [{ ...inputs.candidateFiles[0], contentBase64: b64('tampered') }],
  }));
  for (const decision of [missing, extra, mismatched]) {
    assert.equal(decision.verdict, 'unavailable');
    assert(decision.findings.some(finding => finding.code === 'CANDIDATE_MATERIAL_INVALID'));
  }
});

await testAsync('baseline-before mismatch and malformed expected revision are unavailable', async () => {
  const inputs = setup();
  const mismatchedBaseline = structuredClone(inputs.baselineSnapshot);
  mismatchedBaseline.files[0] = baselineFile(
    'src/controllers/app.js',
    'export const app = 999;\n',
  );
  const baselineDecision = (await evaluate(inputs, { baselineSnapshot: mismatchedBaseline }));
  const revisionDecision = (await evaluate(inputs, { expectedAfterRevision: 'not-a-revision' }));
  assert.equal(baselineDecision.verdict, 'unavailable');
  assert(baselineDecision.findings.some(finding => finding.code === 'BASELINE_BEFORE_IMAGE_MISMATCH'));
  assert.equal(revisionDecision.verdict, 'unavailable');
  assert(revisionDecision.findings.some(finding => finding.code === 'EXPECTED_AFTER_REVISION_INVALID'));
});

await testAsync('valid expected revision may equal the before revision', async () => {
  const inputs = setup();
  const decision = (await evaluate(inputs, { expectedAfterRevision: BEFORE_REVISION }));
  assert.equal(decision.verdict, 'allow');
  assert.equal(decision.expectedAfterRevision, BEFORE_REVISION);
  assert.equal(decision.findings.length, 0);
});

await testAsync('unresolved relative import and invalid UTF-8 source are unavailable', async () => {
  const unresolved = setup({ appAfter: "import './missing.js';\nexport const app = 1;\n" });
  const unresolvedDecision = (await evaluate(unresolved));

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
  const utf8Decision = (await evaluate(invalidUtf8));
  assert.equal(unresolvedDecision.verdict, 'unavailable');
  assert(unresolvedDecision.findings.some(finding => finding.code === 'RELATIVE_IMPORT_UNRESOLVED'));
  assert.equal(utf8Decision.verdict, 'unavailable');
  assert(utf8Decision.findings.some(finding => finding.code === 'SOURCE_NOT_UTF8'));
  assert.equal(inputs.boundRequest.changes.length, 1);
});

await testAsync('unrecognized import forms are unavailable instead of silently omitted', async () => {
  for (const appAfter of [
    "const target = '../services/service.js';\nexport const app = import(target);\n",
    "const target = '../services/service.js';\nexport const app = require(target);\n",
  ]) {
    const decision = (await evaluate(setup({ appAfter })));
    assert.equal(decision.verdict, 'unavailable');
    assert(decision.findings.some(finding => finding.code === 'IMPORT_ARGUMENT_UNSUPPORTED'));
  }
});

await testAsync('exported declarations containing from are not re-export statements', async () => {
  for (const appAfter of [
    "export function app() { return Array.from([]); }\n",
    "export \n  function app() { return Array.from([]); }\n",
    "export const app = Array.from([]);\n",
    "export default function app() { // copied from './missing.js'\n return []; }\n",
    "export async function app() { // derived from './missing.js'\n return []; }\n",
    "export class App { values() { return Array.from([]); } }\n",
  ]) {
    assert.equal((await evaluate(setup({ appAfter }))).verdict, 'allow', appAfter);
  }
});

await testAsync('imports within exported declarations and actual re-exports remain checked', async () => {
  for (const appAfter of [
    "export const app = import('./missing.js');\n",
    "export default function app() { return require('./missing.js'); }\n",
    "export * as app from './missing.js';\n",
    "export { app } from './missing.js';\n",
    "export /* annotation */ * from './missing.js';\n",
  ]) {
    const decision = (await evaluate(setup({ appAfter })));
    assert.notEqual(decision.verdict, 'allow', appAfter);
    assert(decision.findings.some(finding => finding.code === 'RELATIVE_IMPORT_UNRESOLVED'), appAfter);
  }
});

await testAsync('scan has no 200-file false-pass limit', async () => {
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
  const decision = (await evaluate(inputs));
  assert.equal(decision.verdict, 'deny');
  assert(decision.findings.some(finding => finding.code === 'IMPORT_LAYER_VIOLATION'));
});

await testAsync('policy changed in same request is terminally denied under the old snapshot', async () => {
  const policyPath = '.intentsmith/architecture-policy.json';
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
  const decision = (await evaluate(inputs));
  assert.equal(decision.verdict, 'deny');
  assert.equal(check(decision, 'input.bindings').status, 'fail');
  assert(decision.findings.some(finding => (
    finding.code === 'POLICY_SELF_CHANGE_FORBIDDEN' && finding.path === policyPath
  )));
  assert.equal(check(decision, 'imports.allowed').status, 'pass');
});

await testAsync('malformed baseline and candidates fail closed without validator exceptions', async () => {
  const inputs = setup();
  for (const malformedBaseline of [
    { ...inputs.baselineSnapshot, files: [{ path: null }] },
    { ...inputs.baselineSnapshot, files: [null, null] },
  ]) {
    assert.doesNotThrow(() => validateM2GovernanceBaselineSnapshot(malformedBaseline));
    assert.equal(validateM2GovernanceBaselineSnapshot(malformedBaseline).valid, false);
    assert.equal((await evaluate(inputs, { baselineSnapshot: malformedBaseline })).verdict, 'unavailable');
  }
  for (const malformedCandidates of [[null, null], [{ path: null }]]) {
    await assert.doesNotReject(async () => (await evaluate(inputs, { candidateFiles: malformedCandidates })));
    assert.equal((await evaluate(inputs, { candidateFiles: malformedCandidates })).verdict, 'unavailable');
  }
});

suite('M2 governance evaluator — exact succeeded receipt');

await testAsync('allow plus exact succeeded ProjectChangeResult creates a bound receipt', async () => {
  const inputs = setup();
  const decision = (await evaluate(inputs));
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

await testAsync('deny decision, non-succeeded result and mismatched after revision cannot receipt', async () => {
  const deniedInputs = setup({
    appAfter: "import { service } from '../services/service.js';\nexport const app = service;\n",
  });
  deniedInputs.policySnapshot = policy({
    rules: [
      { from: 'controller', canImport: [] },
      { from: 'service', canImport: [] },
    ],
  });
  const denied = (await evaluate(deniedInputs));
  const deniedResult = result(deniedInputs.boundRequest);
  assert.equal(denied.verdict, 'deny');
  assert.throws(() => createM2GovernanceReceipt({
    request: deniedInputs.boundRequest,
    result: deniedResult,
    decision: denied,
    recordedAt: '2026-08-24T12:00:03.000Z',
  }), /allow-decision-required/);

  const inputs = setup();
  const allowed = (await evaluate(inputs));
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

await testAsync('baseline validator itself rejects unsorted, duplicate and forged bytes', async () => {
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


suite('M2 governance AST — exact edges and trusted bounded adapter');

function sourceSetup(appAfter, extension = '.js') {
  if (extension === '.js') return setup({ appAfter });
  const sourcePath = `src/controllers/app${extension}`;
  const before = 'export const app = 1;\n';
  const changes = [change(sourcePath, before, appAfter, 'source-language')];
  return { boundRequest: request(changes), policySnapshot: policy(),
    baselineSnapshot: baseline([baselineFile(sourcePath, before), baselineFile('src/services/service.js', 'export const service = 2;\n')]),
    candidateFiles: candidates(changes, new Map([[sourcePath, appAfter]])) };
}

await testAsync('inert comments, strings, regex and JSX text are data in all six supported languages', async () => {
  for (const extension of ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']) {
    const source = "// import require from './missing.js'\nconst text='require(\"missing\") import'; const regex=/import|require/; export const app=1;\n";
    assert.equal((await evaluate(sourceSetup(source, extension))).verdict, 'allow', extension);
  }
  for (const extension of ['.jsx', '.tsx']) {
    assert.equal((await evaluate(sourceSetup('export const app=<p>require import</p>;', extension))).verdict, 'allow');
  }
});

await testAsync('real commented reexports and escaped literal/identifier imports retain exact dependency checks', async () => {
  for (const source of [
    "export { service } from /* import require are data */ '../services/service.js';",
    String.raw`require('../services/serv\u0069ce.js');`,
    String.raw`r\u{0000000065}quire('../services/service.js');`,
  ]) assert.equal((await evaluate(setup({ appAfter: source }))).verdict, 'allow', source);
  const missing = await evaluate(setup({ appAfter: String.raw`r\u{0000000065}quire('./miss\u0069ng.js');` }));
  assert(missing.findings.some(item => item.code === 'RELATIVE_IMPORT_UNRESOLVED'));
});

await testAsync('typed imports and TS import-equals use observed grammar, including runtime JSX expressions', async () => {
  for (const [source, extension] of [
    ["import type { service } from '../services/service.js'; type T=typeof service; export const app: number=1;", '.ts'],
    ["import service = require('../services/service.js'); export const app=service;", '.ts'],
    ["type T=import('../services/service.js').service; export const app: number=1;", '.ts'],
    ["import type { require as NodeRequire } from '../services/service.js'; type T=typeof module.require; export const app=1;", '.ts'],
    ["declare const module: any; export const app=1;", '.ts'],
    ["export const app=<p>{import('../services/service.js')}</p>;", '.tsx'],
  ]) assert.equal((await evaluate(sourceSetup(source, extension))).verdict, 'allow', source);
  const invalid = await evaluate(sourceSetup('export const app: number = ;', '.ts'));
  assert(invalid.findings.some(item => item.code === 'SOURCE_SYNTAX_ERROR'));
});

await testAsync('node:module named utilities are supported while factory, alias and computed loaders fail concretely', async () => {
  const utility = setup({ appAfter: "import { isBuiltin as check } from 'node:module'; export const app=check('node:fs');" });
  utility.policySnapshot = policy({ externalImports: ['node:module'] });
  assert.equal((await evaluate(utility)).verdict, 'allow');
  for (const [source, code] of [
    ["import { createRequire as make } from 'node:module'; const r=make(import.meta.url); r('fs');", 'IMPORT_FACTORY_MODULE_UNSUPPORTED'],
    ["const { createRequire: make }=await import('node:module'); make(import.meta.url)('fs');", 'IMPORT_FACTORY_MODULE_UNSUPPORTED'],
    ["const r=require; r('fs');", 'IMPORT_LOADER_ALIAS_UNSUPPORTED'],
    ["function f(require){return require('fs');}", 'IMPORT_SHADOWED_REQUIRE_UNSUPPORTED'],
    ["module['requ'+'ire']('fs');", 'IMPORT_MEMBER_LOADER_UNSUPPORTED'],
    ["require(`fs`);", 'IMPORT_ARGUMENT_UNSUPPORTED'],
  ]) {
    const inputs = setup({ appAfter: source });
    inputs.policySnapshot = policy({ externalImports: ['fs', 'node:module'] });
    const decision = await evaluate(inputs);
    assert.equal(decision.verdict, 'unavailable', source);
    assert(decision.findings.some(item => item.code === code), JSON.stringify(decision.findings));
  }
  for (const source of [
    "import type module from '../services/service.js'; module['requ'+'ire']('fs');",
    "import { type process } from '../services/service.js'; process['get'+'BuiltinModule']('fs');",
    "declare const module: any; module['requ'+'ire']('fs');",
  ]) {
    const decision = await evaluate(sourceSetup(source, '.ts'));
    assert(decision.findings.some(item => item.code === 'IMPORT_MEMBER_LOADER_UNSUPPORTED'), source);
  }
  const typedClass = await evaluate(sourceSetup("class require {}; require('fs');", '.ts'));
  assert(typedClass.findings.some(item => item.code === 'IMPORT_SHADOWED_REQUIRE_UNSUPPORTED'));
});

await testAsync('ambient active code generation fails closed while inert strings and local utilities remain data', async () => {
  for (const source of [
    `eval('requ'+'ire')('node:fs');`,
    `eval("import('node:fs')");`,
    `new Function("return import('node:fs')")();`,
    `const run=eval; run("import('node:fs')");`,
    `globalThis['Function']("return import('node:fs')")();`,
  ]) {
    const decision = await evaluate(setup({ appAfter: source }));
    assert.equal(decision.verdict, 'unavailable', source);
    assert(decision.findings.some(item => item.code === 'IMPORT_CODE_GENERATION_UNSUPPORTED'), source);
  }
  assert.equal((await evaluate(setup({ appAfter: `const text="import('node:fs')"; export const app=text;` }))).verdict, 'allow');
  assert.equal((await evaluate(setup({ appAfter: `const Function=(value)=>value; export const app=Function("import('node:fs')");` }))).verdict, 'allow');
});

await testAsync('bounded callback preserves long UTF-8 source and surrogate pair boundaries without truncation', async () => {
  for (const padding of [4085, 4086, 4093, 4094, 8190]) {
    const source = "const text='" + 'a'.repeat(padding) + "🚀';\n" + '//ž'.repeat(20000) + "\nrequire('./missing.js');";
    const decision = await evaluate(setup({ appAfter: source }));
    assert(decision.findings.some(item => item.code === 'RELATIVE_IMPORT_UNRESOLVED'), padding.toString());
    assert(!decision.findings.some(item => item.code === 'SOURCE_PARSER_UNAVAILABLE'));
  }
});

await testAsync('pure evaluation requires private observation even for source without imports', async () => {
  const args = boundArgs(setup({ appAfter: 'export const app=1;' }));
  const prepared = prepareM2GovernanceSourceSet(args);
  const token = await observeM2Imports(prepared);
  const observed = readM2ImportObservation(token, prepared);
  assert(Object.isFrozen(observed) && Object.isFrozen(observed.files) && Object.isFrozen(observed.files[0]));
  assert.throws(() => { observed.files[0].digest = EMPTY_DIGEST; }, TypeError);
  for (const value of [undefined, {}, structuredClone(token), JSON.parse(JSON.stringify(token)), observed]) {
    const decision = evaluateM2Governance({ ...args, importObservation: value });
    assert.equal(decision.verdict, 'unavailable');
    assert(decision.findings.some(item => item.code === 'IMPORT_OBSERVATION_UNAVAILABLE'));
  }
  const originalSpawn = childProcess.spawn, originalRead = fs.readFileSync, originalNow = Date.now;
  try {
    childProcess.spawn = () => { throw Error('pure evaluator spawned'); };
    fs.readFileSync = () => { throw Error('pure evaluator read filesystem'); };
    Date.now = () => { throw Error('pure evaluator consulted clock'); };
    syncBuiltinESMExports();
    assert.equal(evaluateM2Governance({ ...args, importObservation: token }).verdict, 'allow');
  } finally {
    childProcess.spawn = originalSpawn; fs.readFileSync = originalRead; Date.now = originalNow;
    syncBuiltinESMExports();
  }
});

await testAsync('observations reject lifecycle, milestone, request, policy, baseline, candidate and revision changes', async () => {
  const args = boundArgs(setup());
  const token = await observeM2Imports(prepareM2GovernanceSourceSet(args));
  const staleCases = [
    { ...args, lifecycleId: 'lifecycle-other' },
    { ...args, milestoneId: 'milestone-other' },
    { ...args, request: { ...args.request, runId: 'run-other' } },
    { ...args, policySnapshot: { ...args.policySnapshot, externalImports: ['node:fs'] } },
    { ...args, baselineSnapshot: baseline([
      args.baselineSnapshot.files[0], baselineFile('src/services/service.js', 'export const service=3;')]) },
    { ...args, expectedAfterRevision: `wsr1:${'a'.repeat(64)}` },
    boundArgs(setup({ appAfter: 'export const app=5;' })),
  ];
  for (const stale of staleCases) {
    const decision = evaluateM2Governance({ ...stale, importObservation: token });
    assert.equal(decision.verdict, 'unavailable');
    assert(decision.findings.some(item => item.code === 'IMPORT_OBSERVATION_UNAVAILABLE'));
  }
});

await testAsync('trusted adapter snapshots all inputs before await and ignores caller observation', async () => {
  const inputs = setup();
  const expectedDigest = computeM2ProjectChangeRequestDigest(inputs.boundRequest);
  const args = boundArgs(inputs, { importObservation: { files: [] } });
  const pending = evaluateM2GovernanceWithAst(args);
  args.policySnapshot.rules[0].canImport.length = 0;
  args.candidateFiles[0].contentBase64 = b64("require('undeclared');");
  args.request.runId = 'mutated-after-snapshot';
  const decision = await pending;
  assert.equal(decision.verdict, 'allow');
  assert.equal(decision.requestDigest, expectedDigest);
});

await testAsync('invalid request, policy, baseline, UTF-8 and baseline budget never spawn a parser', async () => {
  const original = childProcess.spawn;
  let spawned = 0;
  try {
    childProcess.spawn = (...args) => { spawned += 1; return original(...args); };
    syncBuiltinESMExports();
    const inputs = setup();
    await assert.rejects(() => evaluate(inputs, { request: null }), /invalid-request/);
    assert.equal((await evaluate(inputs, { policySnapshot: null })).verdict, 'unavailable');
    assert.equal((await evaluate(inputs, { baselineSnapshot: null })).verdict, 'unavailable');
    const bytes = Buffer.from([0xff]);
    const changes = [change('src/controllers/new.js', null, bytes, 'utf8')];
    assert.equal((await evaluate({ ...inputs, boundRequest: request(changes),
      candidateFiles: [{ path: changes[0].path, contentBase64: b64(bytes) }] })).verdict, 'unavailable');
    const oversized = baseline([...inputs.baselineSnapshot.files,
      baselineFile('docs/data.bin', Buffer.alloc(8 * 1024 * 1024, 0))]);
    const decision = await evaluate(inputs, { baselineSnapshot: oversized });
    assert(decision.findings.some(item => item.code === 'SOURCE_PARSER_BASELINE_BYTES_LIMIT'));
    assert.equal(spawned, 0);
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
});

await testAsync('one-child admission, pre-abort and in-flight abort release slot only after own child closes', async () => {
  const args = boundArgs(setup());
  const prepared = prepareM2GovernanceSourceSet(args);
  const controller = new AbortController();
  const original = childProcess.spawn;
  let spawned = 0, pid;
  try {
    childProcess.spawn = (...call) => { spawned += 1; const child = original(...call); pid = child.pid; return child; };
    syncBuiltinESMExports();
    const already = new AbortController(); already.abort();
    const aborted = await observeM2Imports(prepared, { signal: already.signal });
    assert.equal(readM2ImportObservation(aborted, prepared).error, 'SOURCE_PARSER_CANCELLED');
    assert.equal(spawned, 0);
    const first = observeM2Imports(prepared, { signal: controller.signal });
    const second = await observeM2Imports(prepared);
    assert.equal(readM2ImportObservation(second, prepared).error, 'SOURCE_PARSER_RESOURCE_BUSY');
    assert.equal(spawned, 1);
    const ownPid = pid;
    controller.abort();
    const cancelled = await first;
    assert.equal(readM2ImportObservation(cancelled, prepared).error, 'SOURCE_PARSER_CANCELLED');
    assert.throws(() => process.kill(ownPid, 0), error => error.code === 'ESRCH');
    assert.equal((await evaluate(setup())).verdict, 'allow');
  } finally { controller.abort(); childProcess.spawn = original; syncBuiltinESMExports(); }
});

await testAsync('crash, malformed reply and excessive output fail closed and free child admission', async () => {
  const args = boundArgs(setup());
  const prepared = prepareM2GovernanceSourceSet(args);
  const original = childProcess.spawn;
  for (const [code, expected] of [
    ["process.kill(process.pid,'SIGSEGV')", 'SOURCE_PARSER_PROCESS_UNAVAILABLE'],
    ["process.stdout.write('{}')", 'SOURCE_PARSER_PROTOCOL_INVALID'],
    [`process.stdout.write('x'.repeat(${IMPORT_SCANNER_LIMITS.outputBytes + 1}))`, 'SOURCE_PARSER_OUTPUT_BYTES_LIMIT'],
  ]) {
    try {
      childProcess.spawn = (command, args, options) => original(command, [...args.slice(0, -2), '--eval', code], options);
      syncBuiltinESMExports();
      const token = await observeM2Imports(prepared);
      assert.equal(readM2ImportObservation(token, prepared).error, expected);
      assert.equal(evaluateM2Governance({ ...boundArgs(setup()), importObservation: token }).verdict, 'unavailable');
    } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
    assert.equal((await evaluate(setup())).verdict, 'allow');
  }
});

summary();
