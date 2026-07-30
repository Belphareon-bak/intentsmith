#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  buildGate0ExecutionPlan,
  environmentForExecution,
  gate0EvidenceLayout,
  makePortableInvocation,
  validGate0Toolchain,
} from './gate0-evidence-contract.js';
import {
  classifyDispositionValidatorExecution,
  classifyRegistryValidatorExecution,
} from './gate0-evidence-verdict.js';
import {
  buildGate0RiskEvidence,
  buildPrivacyIncidentEvidence,
  buildRegistryGateFacts,
  projectDispositionValidation,
  projectRegistryValidation,
  PRIVACY_INCIDENT_PATH,
  RISK_POLICY_PATH,
  RISK_REGISTER_PATH,
} from './gate0-evidence-projections.js';
import {
  runLogged,
  runWithOwnedProcessTerminationHandling,
} from './nightly-orchestrator.js';

export const GATE0_ATTESTATION_OUTPUTS = Object.freeze([
  'docs/convergence/EVIDENCE-INDEX.json',
  'docs/convergence/GATE0-BASELINE-REPORT.md',
  'docs/convergence/STATUS.md',
  'docs/convergence/reviews/GATE0-OPUS-REVIEW.md',
]);
export const GATE0_BOUND_OUTPUTS = Object.freeze(
  GATE0_ATTESTATION_OUTPUTS.filter(
    filePath => filePath !== 'docs/convergence/EVIDENCE-INDEX.json',
  ),
);

export function validateGate0Attestation({
  headSha,
  parentShas,
  changedEntries,
  evidenceIndex,
  outputArtifacts,
  outputModes,
  expectedRegistrySha256,
  expectedRegistryValidation,
  expectedRegistryFacts,
  expectedDispositionValidation,
  expectedRiskPolicy,
  expectedPrivacyIncident,
  worktreeClean,
}) {
  const errors = [];
  if (!/^[a-f0-9]{40}$/.test(headSha || '')) {
    errors.push('attestation HEAD must be a full lowercase SHA-1');
  }
  if (
    !Array.isArray(parentShas)
    || parentShas.length !== 1
    || !/^[a-f0-9]{40}$/.test(parentShas[0] || '')
  ) {
    errors.push('attestation commit must have exactly one full-SHA parent');
  }
  if (
    evidenceIndex?.schemaVersion !== 7
    || evidenceIndex?.product !== 'IntentSmith'
    || evidenceIndex?.gate !== 'Gate 0'
    || !/^[a-f0-9]{40}$/.test(evidenceIndex?.candidate?.sha || '')
  ) {
    errors.push('evidence index identity/schema is invalid');
  } else {
    errors.push(...validateEvidenceIndexShape(
      evidenceIndex,
      expectedRegistryFacts,
    ));
    if (parentShas?.[0] !== evidenceIndex.candidate.sha) {
      errors.push('attestation parent does not equal the indexed candidate SHA');
    }
    if (headSha === evidenceIndex.candidate.sha) {
      errors.push('attestation HEAD must differ from its candidate parent');
    }
    if (
      !/^[a-f0-9]{64}$/.test(evidenceIndex.candidate.registrySha256 || '')
      || evidenceIndex.candidate.registrySha256 !== expectedRegistrySha256
    ) {
      errors.push('indexed registry fingerprint differs from the candidate parent');
    }
    if (
      evidenceIndex.candidate.attestationRule
      !== 'the evidence-only commit must have this candidate as its first parent'
    ) {
      errors.push('evidence index attestation rule is missing or changed');
    }
    for (const [label, actual, expected] of [
      [
        'registry validation',
        evidenceIndex.validations?.registry,
        expectedRegistryValidation,
      ],
      [
        'disposition validation',
        evidenceIndex.validations?.disposition,
        expectedDispositionValidation,
      ],
      ['risk policy', evidenceIndex.riskPolicy, expectedRiskPolicy],
      ['privacy incident', evidenceIndex.privacyIncident, expectedPrivacyIncident],
    ]) {
      if (expected === undefined || !isDeepStrictEqual(actual, expected)) {
        errors.push(`${label} differs from candidate-parent revalidation`);
      }
    }
    if (
      expectedRiskPolicy === undefined
      || !isDeepStrictEqual(
        evidenceIndex.repositoryBlockers,
        expectedRiskPolicy.repositoryBlockers,
      )
    ) {
      errors.push('repository blockers differ from candidate-parent risk policy');
    }
  }
  const expectedEntries = GATE0_ATTESTATION_OUTPUTS
    .map(filePath => `M\t${filePath}`)
    .sort();
  const actualEntries = Array.isArray(changedEntries)
    ? [...changedEntries].sort()
    : [];
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    errors.push(
      'attestation commit must modify exactly the four generated evidence outputs',
    );
  }
  if (worktreeClean !== true) {
    errors.push('attestation validation requires a clean worktree');
  }
  for (const filePath of GATE0_ATTESTATION_OUTPUTS) {
    if (outputModes?.[filePath] !== '100644') {
      errors.push(`attestation output has an invalid Git mode: ${filePath}`);
    }
  }
  const expectedBindingPaths = [...GATE0_BOUND_OUTPUTS].sort();
  const actualBindingPaths = Object.keys(
    evidenceIndex?.generatedOutputs || {},
  ).sort();
  if (
    JSON.stringify(actualBindingPaths) !== JSON.stringify(expectedBindingPaths)
  ) {
    errors.push('evidence index must bind exactly the three Markdown outputs');
  } else {
    for (const filePath of expectedBindingPaths) {
      const contents = outputArtifacts?.[filePath];
      const bytes = Buffer.isBuffer(contents)
        ? contents
        : typeof contents === 'string' ? Buffer.from(contents) : null;
      const binding = evidenceIndex.generatedOutputs[filePath];
      if (
        bytes === null
        || !hasExactKeys(binding, ['bytes', 'sha256'])
        || binding?.bytes !== bytes.length
        || binding?.sha256 !== sha256(bytes)
      ) {
        errors.push(`generated output binding mismatch for ${filePath}`);
      }
    }
  }
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    errors,
    headSha,
    candidateSha: evidenceIndex?.candidate?.sha || null,
    changedEntries: actualEntries,
  };
}

export function validateEvidenceIndexShape(index, expectedRegistryFacts) {
  const errors = [];
  const expectedTopLevelKeys = [
    'schemaVersion',
    'product',
    'gate',
    'verdict',
    'exitCode',
    'generatedAt',
    'candidate',
    'sourceRefs',
    'inventory',
    'clauses',
    'repositoryBlockers',
    'provenance',
    'riskPolicy',
    'validations',
    'installation',
    'deterministic',
    'pilotFiveConsecutive',
    'soakRequirementGuard',
    'privacyIncident',
    'review',
    'generatedOutputs',
  ].sort();
  if (
    index === null
    || typeof index !== 'object'
    || Array.isArray(index)
    || JSON.stringify(Object.keys(index).sort()) !== JSON.stringify(expectedTopLevelKeys)
  ) {
    return ['schema-7 evidence index top-level fields differ from the locked contract'];
  }
  if (
    !validIsoTimestamp(index.generatedAt)
    || !hasExactKeys(index.candidate, [
      'sha',
      'branch',
      'registrySha256',
      'attestationRule',
    ])
    || !/^(?:detached|[A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/
      .test(index.candidate.branch)
    || index.candidate.branch.includes('..')
    || !Array.isArray(index.repositoryBlockers)
    || !isDeepStrictEqual(index.sourceRefs, {
      c3Input: 'ffd21cf119865259ea1847af989acb24916bebe3',
      c3Parent: 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f',
      intentSmithDonor: '6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4',
      localValidationCandidate: index.candidate?.sha,
    })
  ) {
    errors.push('evidence index candidate/source/outcome metadata is invalid');
  }
  const provenance = index.provenance;
  const expectedProvenancePath = /^[a-f0-9]{40}$/.test(index.candidate?.sha || '')
    ? gate0EvidenceLayout(index.candidate.sha).provenance
    : null;
  if (
    !hasExactKeys(provenance, [
      'schemaVersion',
      'path',
      'sha256',
      'bytes',
      'executionCount',
      'secretValuesRecorded',
      'initialIgnoredState',
      'startedAt',
      'endedAt',
      'toolchain',
    ])
    || provenance?.schemaVersion !== 1
    || provenance?.path !== expectedProvenancePath
    || !/^[a-f0-9]{64}$/.test(provenance?.sha256 || '')
    || !Number.isInteger(provenance?.bytes)
    || provenance.bytes < 1
    || provenance.executionCount !== 9
    || provenance.secretValuesRecorded !== false
    || JSON.stringify(provenance.initialIgnoredState) !== '{"clean":true}'
    || !validIsoTimestamp(provenance.startedAt)
    || !validIsoTimestamp(provenance.endedAt)
    || Date.parse(provenance.startedAt) > Date.parse(provenance.endedAt)
    || provenance.endedAt !== index.generatedAt
    || !validGate0Toolchain(provenance.toolchain)
  ) {
    errors.push('evidence index does not carry the locked producer provenance');
  }
  const expectedClauseIds = Array.from(
    { length: 9 },
    (_, index) => `G0-C${index + 1}`,
  );
  const clauses = Array.isArray(index.clauses) ? index.clauses : [];
  if (
    clauses.length !== expectedClauseIds.length
    || JSON.stringify(clauses.map(clause => clause?.id).sort())
      !== JSON.stringify(expectedClauseIds)
    || clauses.some(clause => (
      !hasExactKeys(clause, ['id', 'label', 'result', 'evidence'])
      || !['PASS', 'FAIL'].includes(clause?.result)
      || typeof clause?.label !== 'string'
      || typeof clause?.evidence !== 'string'
    ))
  ) {
    errors.push('evidence index must contain exact unique G0-C1..G0-C9 outcomes');
  }
  const reviewStatus = index.review?.independentReviewStatus;
  const hasFailure = clauses.some(clause => clause.result === 'FAIL')
    || index.repositoryBlockers.length > 0;
  const expectedVerdict = hasFailure
    ? 'FAIL'
    : reviewStatus === 'PENDING' ? 'CONDITIONAL PASS' : null;
  const expectedExitCode = expectedVerdict === 'FAIL' ? 1 : 0;
  if (
    expectedVerdict === null
    || index.verdict !== expectedVerdict
    || index.exitCode !== expectedExitCode
  ) {
    errors.push('evidence index verdict/exit disagrees with clauses and review');
  }
  if (
    !hasExactKeys(index.review, [
      'range',
      'commitCount',
      'packet',
      'independentReviewStatus',
    ])
    || index.review?.packet !== 'docs/convergence/reviews/GATE0-OPUS-REVIEW.md'
    || index.review?.range
      !== `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab..${index.candidate?.sha}`
    || !Number.isInteger(index.review?.commitCount)
    || index.review.commitCount < 1
  ) {
    errors.push('evidence index review packet/range is invalid');
  }
  const clauseById = new Map(clauses.map(clause => [clause.id, clause]));
  const registryValidation = index.validations?.registry;
  const dispositionValidation = index.validations?.disposition;
  if (
    !hasExactKeys(index.validations, ['registry', 'disposition'])
    || !validValidatorEvidence(
      registryValidation,
      'node scripts/validate-test-registry.js --json',
    )
    || !validValidatorEvidence(
      dispositionValidation,
      'node scripts/validate-final-disposition.js --json',
    )
    || (registryValidation?.exitCode === 0)
      !== (clauseById.get('G0-C3')?.result === 'PASS')
    || (dispositionValidation?.exitCode === 0)
      !== (clauseById.get('G0-C2')?.result === 'PASS')
  ) {
    errors.push('evidence index validator outcomes are missing or contradictory');
  }
  const registryFactsValid = hasExactKeys(expectedRegistryFacts, [
    'runnablePrograms',
    'explicitSupportExclusions',
    'profileCounts',
    'stateCounts',
    'deterministicRequired',
    'deterministicScopeValid',
    'knownDefectiveInDeterministic',
    'blockedWithoutPrerequisite',
  ])
    && isRecord(expectedRegistryFacts.profileCounts)
    && isRecord(expectedRegistryFacts.stateCounts)
    && typeof expectedRegistryFacts.deterministicScopeValid === 'boolean'
    && Array.isArray(expectedRegistryFacts.knownDefectiveInDeterministic)
    && Array.isArray(expectedRegistryFacts.blockedWithoutPrerequisite);
  if (
    !hasExactKeys(index.inventory, [
      'runnablePrograms',
      'explicitSupportExclusions',
      'profileCounts',
      'stateCounts',
      'deterministicRequired',
      'dispositionRecords',
    ])
    || !registryFactsValid
    || index.inventory.runnablePrograms
      !== expectedRegistryFacts?.runnablePrograms
    || index.inventory.explicitSupportExclusions
      !== expectedRegistryFacts?.explicitSupportExclusions
    || index.inventory.deterministicRequired
      !== expectedRegistryFacts?.deterministicRequired
    || index.inventory.dispositionRecords !== 225
    || !isDeepStrictEqual(
      index.inventory.profileCounts,
      expectedRegistryFacts?.profileCounts,
    )
    || !isDeepStrictEqual(
      index.inventory.stateCounts,
      expectedRegistryFacts?.stateCounts,
    )
  ) {
    errors.push('evidence index inventory differs from the candidate-parent registry');
  }
  if (
    !hasExactKeys(index.riskPolicy, [
      'path',
      'schemaVersion',
      'sha256',
      'registerPath',
      'registerSha256',
      'valid',
      'errors',
      'riskCount',
      'policyCount',
      'impactCounts',
      'openImpactCounts',
      'repositoryBlockers',
      'reviewRequiredRisks',
      'laterGateRisks',
      'separateIncidents',
    ])
    || index.riskPolicy.path !== RISK_POLICY_PATH
    || index.riskPolicy.registerPath !== RISK_REGISTER_PATH
    || index.riskPolicy.schemaVersion !== 1
    || typeof index.riskPolicy.valid !== 'boolean'
    || !Array.isArray(index.riskPolicy.errors)
    || !/^[a-f0-9]{64}$/.test(index.riskPolicy.sha256 || '')
    || !/^[a-f0-9]{64}$/.test(index.riskPolicy.registerSha256 || '')
    || !Array.isArray(index.riskPolicy.repositoryBlockers)
    || !isDeepStrictEqual(
      index.repositoryBlockers,
      index.riskPolicy.repositoryBlockers,
    )
    || (index.riskPolicy.valid && index.riskPolicy.errors.length !== 0)
    || (
      index.riskPolicy.valid
      !== (clauseById.get('G0-C9')?.result === 'PASS')
    )
  ) {
    errors.push('evidence index risk-policy outcome is missing or contradictory');
  }
  const installLogs = index.installation?.logs;
  if (
    !hasExactKeys(index.installation, ['passed', 'logs'])
    || typeof index.installation.passed !== 'boolean'
    || !Array.isArray(installLogs)
    || installLogs.length !== 2
    || JSON.stringify(installLogs.map(log => log?.kind))
      !== JSON.stringify(['clean', 'repeat'])
    || installLogs.some(log => !Number.isInteger(log?.exitCode))
    || (
      index.installation.passed
      !== installLogs.every(log => log.exitCode === 0)
    )
    || (
      index.installation.passed
      !== (clauseById.get('G0-C4')?.result === 'PASS')
    )
  ) {
    errors.push('evidence index installation outcome is missing or contradictory');
  }
  const pilots = index.pilotFiveConsecutive;
  if (
    !validAuditOutcome(index.deterministic)
    || !Array.isArray(pilots)
    || pilots.length !== 5
    || pilots.some(item => !validAuditOutcome(item))
    || new Set(pilots.map(item => item.runId)).size !== 5
    || !validAuditOutcome(index.soakRequirementGuard)
    || !Array.isArray(index.soakRequirementGuard.blockedBy)
    || index.soakRequirementGuard.guardPassed !== (
      index.soakRequirementGuard.passed === false
      && index.soakRequirementGuard.verdict === 'BLOCKED'
      && index.soakRequirementGuard.exitCode === 2
      && isDeepStrictEqual(index.soakRequirementGuard.statusCounts, {
        PASS: 0,
        FAIL: 0,
        TIMEOUT: 0,
        BLOCKED: 5,
        SKIPPED: 0,
      })
      && index.soakRequirementGuard.blockedBy.includes('gpu')
      && index.soakRequirementGuard.blockedBy.includes('ollama')
    )
  ) {
    errors.push('evidence index audit/pilot/soak outcomes are incomplete');
  }
  const pilotsPassed = Array.isArray(pilots)
    && pilots.length === 5
    && pilots.every(item => item.passed === true);
  if (
    isRecord(index.deterministic)
    && typeof index.deterministic.passed === 'boolean'
    && (index.deterministic.passed && pilotsPassed)
      !== (clauseById.get('G0-C5')?.result === 'PASS')
  ) {
    errors.push('evidence index deterministic/pilot outcome contradicts G0-C5');
  }
  const expectedC6Pass = registryFactsValid
    && expectedRegistryFacts.deterministicScopeValid
    && expectedRegistryFacts.knownDefectiveInDeterministic.length === 0;
  const expectedC7Pass = registryFactsValid
    && expectedRegistryFacts.blockedWithoutPrerequisite.length === 0
    && index.soakRequirementGuard?.guardPassed === true;
  if (
    clauseById.get('G0-C6')?.result
      !== (expectedC6Pass ? 'PASS' : 'FAIL')
    || clauseById.get('G0-C7')?.result
      !== (expectedC7Pass ? 'PASS' : 'FAIL')
    || clauseById.get('G0-C8')?.result !== 'PASS'
  ) {
    errors.push(
      'evidence index G0-C6/G0-C7/G0-C8 outcome contradicts parent-derived facts',
    );
  }
  errors.push(...validateD021Evidence(index, clauseById));
  if (
    !hasExactKeys(index.privacyIncident, [
      'path',
      'schemaVersion',
      'sha256',
      'incidentId',
      'status',
      'trackedPathsRemoved',
      'trackedBytesRemoved',
      'historyReachable',
      'historyRewritten',
      'personalContentInspected',
      'rotationCategories',
    ])
    || index.privacyIncident.path !== PRIVACY_INCIDENT_PATH
    || index.privacyIncident.schemaVersion !== 1
    || !/^[a-f0-9]{64}$/.test(index.privacyIncident.sha256 || '')
    || index.privacyIncident.status !== 'CONFIRMED_COMPROMISE'
    || !Number.isInteger(index.privacyIncident.trackedPathsRemoved)
    || index.privacyIncident.trackedPathsRemoved < 1
    || !Number.isInteger(index.privacyIncident.trackedBytesRemoved)
    || index.privacyIncident.trackedBytesRemoved < 1
    || typeof index.privacyIncident.historyReachable !== 'boolean'
    || typeof index.privacyIncident.historyRewritten !== 'boolean'
    || index.privacyIncident.personalContentInspected !== false
    || !Array.isArray(index.privacyIncident.rotationCategories)
  ) {
    errors.push('evidence index privacy incident section is invalid');
  }
  if (
    !isRecord(index.deterministic)
    || !Array.isArray(index.pilotFiveConsecutive)
    || !isRecord(index.soakRequirementGuard)
  ) {
    errors.push('evidence index is missing required evidence sections');
  }
  return errors;
}

function validateD021Evidence(index, clauseById) {
  const errors = [];
  const candidateSha = index.candidate?.sha;
  if (!/^[a-f0-9]{40}$/.test(candidateSha || '')) return errors;
  const syntheticRoot = '/intentsmith-gate0-candidate';
  const plan = buildGate0ExecutionPlan({
    root: syntheticRoot,
    candidateSha,
  });
  const installLogs = Array.isArray(index.installation?.logs)
    ? index.installation.logs
    : [];
  const audits = [
    index.deterministic,
    ...(Array.isArray(index.pilotFiveConsecutive)
      ? index.pilotFiveConsecutive
      : []),
    index.soakRequirementGuard,
  ];
  const executionBindings = [
    ...installLogs.map((log, offset) => ({
      execution: log?.execution,
      expected: plan[offset],
      outer: log,
      kind: 'install',
    })),
    ...audits.map((audit, offset) => ({
      execution: audit?.execution,
      expected: plan[offset + 2],
      outer: audit,
      kind: 'audit',
    })),
  ];
  if (executionBindings.length !== plan.length) {
    errors.push('D-021 evidence does not contain the locked nine executions');
    return errors;
  }
  let previousEnd = Date.parse(index.provenance?.startedAt);
  const provenanceEnd = Date.parse(index.provenance?.endedAt);
  const logPaths = new Set();
  for (const [offset, binding] of executionBindings.entries()) {
    const label = `D-021 execution ${offset + 1}`;
    errors.push(...sanitizedExecutionErrors({
      value: binding.execution,
      expected: binding.expected,
      candidateSha,
      syntheticRoot,
      label,
    }));
    if (!isRecord(binding.execution)) continue;
    const executionStart = Date.parse(binding.execution.startedAt);
    const executionEnd = Date.parse(binding.execution.endedAt);
    if (
      !Number.isFinite(previousEnd)
      || !Number.isFinite(provenanceEnd)
      || !Number.isFinite(executionStart)
      || !Number.isFinite(executionEnd)
      || executionStart < previousEnd
      || executionEnd > provenanceEnd
    ) {
      errors.push(`${label} chronology is not serially bound to provenance`);
    }
    previousEnd = executionEnd;
    if (logPaths.has(binding.execution.log)) {
      errors.push(`${label} reuses another producer log`);
    }
    logPaths.add(binding.execution.log);
    if (binding.kind === 'install') {
      if (
        !hasExactKeys(binding.outer, [
          'kind',
          'path',
          'bytes',
          'sha256',
          'exitCode',
          'execution',
        ])
        || binding.outer.path !== binding.execution.log
        || binding.outer.bytes !== binding.execution.logBytes
        || binding.outer.sha256 !== binding.execution.logSha256
        || binding.outer.exitCode !== binding.execution.exitCode
      ) {
        errors.push(`${label} install log binding is incomplete`);
      }
    } else {
      errors.push(...auditBindingErrors(
        binding.outer,
        binding.execution,
        binding.expected,
        label,
      ));
    }
  }
  const installsPassed = installLogs.length === 2
    && installLogs.every(log => log.exitCode === 0);
  const pilotsPassed = Array.isArray(index.pilotFiveConsecutive)
    && index.pilotFiveConsecutive.length === 5
    && index.pilotFiveConsecutive.every(audit => audit.passed === true);
  const deterministicPassed = index.deterministic?.passed === true;
  if (
    index.installation?.passed !== installsPassed
    || (clauseById.get('G0-C4')?.result === 'PASS') !== installsPassed
    || (clauseById.get('G0-C5')?.result === 'PASS')
      !== (deterministicPassed && pilotsPassed)
    || clauseById.get('G0-C1')?.result !== 'PASS'
    || clauseById.get('G0-C8')?.result !== 'PASS'
  ) {
    errors.push('D-021 evidence contradicts its Gate 0 clauses');
  }
  return errors;
}

function sanitizedExecutionErrors({
  value,
  expected,
  candidateSha,
  syntheticRoot,
  label,
}) {
  const errors = [];
  const expectedKeys = [
    'id',
    'portableReplay',
    'startedAt',
    'endedAt',
    'exitCode',
    'signal',
    'timedOut',
    'leakDetected',
    'cleanupTerminated',
    'log',
    'logBytes',
    'logSha256',
    'report',
    'reportBytes',
    'reportSha256',
    'inventory',
    'inventoryBytes',
    'inventorySha256',
    'preSourceState',
    'postSourceState',
    'preIgnoredState',
    'postIgnoredState',
  ];
  if (!hasExactKeys(value, expectedKeys)) {
    return [`${label} fields differ from the sanitized execution contract`];
  }
  if (
    value.id !== expected.id
    || !isDeepStrictEqual(
      value.portableReplay,
      makePortableInvocation(expected, syntheticRoot),
    )
    || !validIsoTimestamp(value.startedAt)
    || !validIsoTimestamp(value.endedAt)
    || Date.parse(value.startedAt) > Date.parse(value.endedAt)
    || !Number.isInteger(value.exitCode)
    || value.exitCode < 0
    || value.signal !== null
    || value.timedOut !== false
    || value.leakDetected !== false
    || value.cleanupTerminated !== true
    || value.log !== expected.logPath
    || !Number.isInteger(value.logBytes)
    || value.logBytes < 1
    || !/^[a-f0-9]{64}$/.test(value.logSha256 || '')
    || value.report !== expected.reportPath
    || value.inventory !== expected.inventoryPath
    || !isDeepStrictEqual(value.preSourceState, {
      sha: candidateSha,
      clean: true,
    })
    || !isDeepStrictEqual(value.postSourceState, {
      sha: candidateSha,
      clean: true,
    })
    || !validIgnoredState(value.preIgnoredState)
    || !validIgnoredState(value.postIgnoredState)
  ) {
    errors.push(`${label} identity, replay, process, or source state is invalid`);
  }
  for (const [pathKey, bytesKey, digestKey] of [
    ['report', 'reportBytes', 'reportSha256'],
    ['inventory', 'inventoryBytes', 'inventorySha256'],
  ]) {
    if (value[pathKey] === null) {
      if (value[bytesKey] !== null || value[digestKey] !== null) {
        errors.push(`${label} ${pathKey} null binding is contradictory`);
      }
    } else if (
      !Number.isInteger(value[bytesKey])
      || value[bytesKey] < 1
      || !/^[a-f0-9]{64}$/.test(value[digestKey] || '')
    ) {
      errors.push(`${label} ${pathKey} bytes/digest is invalid`);
    }
  }
  return errors;
}

function auditBindingErrors(audit, execution, expected, label) {
  const errors = [];
  const expectedKeys = [
    'runId',
    'passed',
    'verdict',
    'exitCode',
    'statusCounts',
    'report',
    'reportSha256',
    'reportBytes',
    'inventory',
    'inventorySha256',
    'inventoryBytes',
    'inventoryFingerprint',
    'optionsFingerprint',
    'startedAt',
    'endedAt',
    'execution',
  ];
  if (expected.id === 'soak-guard') {
    expectedKeys.push('blockedBy', 'guardPassed');
  }
  if (!hasExactKeys(audit, expectedKeys)) {
    return [`${label} audit fields differ from the locked contract`];
  }
  const expectedRunId = expected.argv
    .find(value => value.startsWith('--run-id='))
    ?.slice('--run-id='.length);
  const expectedSuiteCount = expected.id === 'deterministic'
    ? 199
    : expected.id === 'soak-guard' ? 5 : 1;
  const statusCounts = audit.statusCounts;
  const statusTotal = isRecord(statusCounts)
    && hasExactKeys(statusCounts, [
      'PASS',
      'FAIL',
      'TIMEOUT',
      'BLOCKED',
      'SKIPPED',
    ])
    && Object.values(statusCounts).every(
      count => Number.isInteger(count) && count >= 0,
    )
    ? Object.values(statusCounts).reduce((sum, count) => sum + count, 0)
    : -1;
  const derivedVerdict = statusTotal < 0
    ? null
    : statusCounts.FAIL + statusCounts.TIMEOUT + statusCounts.SKIPPED > 0
      ? 'FAIL'
      : statusCounts.BLOCKED > 0
        ? 'BLOCKED'
        : 'PASS';
  if (
    !validAuditOutcome(audit)
    || audit.runId !== expectedRunId
    || audit.exitCode !== execution.exitCode
    || audit.report !== execution.report
    || audit.reportSha256 !== execution.reportSha256
    || audit.reportBytes !== execution.reportBytes
    || audit.inventory !== execution.inventory
    || audit.inventorySha256 !== execution.inventorySha256
    || audit.inventoryBytes !== execution.inventoryBytes
    || !/^[a-f0-9]{64}$/.test(audit.inventoryFingerprint || '')
    || !/^[a-f0-9]{64}$/.test(audit.optionsFingerprint || '')
    || !validIsoTimestamp(audit.startedAt)
    || !validIsoTimestamp(audit.endedAt)
    || Date.parse(audit.startedAt) < Date.parse(execution.startedAt)
    || Date.parse(audit.endedAt) > Date.parse(execution.endedAt)
    || statusTotal !== expectedSuiteCount
    || audit.verdict !== derivedVerdict
  ) {
    errors.push(`${label} report/inventory/outcome binding is invalid`);
  }
  return errors;
}

function validIgnoredState(value) {
  return hasExactKeys(value, [
    'policy',
    'observedAllowedCount',
    'unexpectedPathCount',
  ])
    && value.policy === 'gate0-ignored-path-boundary-v1'
    && Number.isInteger(value.observedAllowedCount)
    && value.observedAllowedCount >= 1
    && value.unexpectedPathCount === 0;
}

export async function validateCurrentAttestation(root = process.cwd()) {
  const revision = git(
    ['rev-list', '--parents', '-n', '1', 'HEAD'],
    root,
  ).split(' ');
  const headSha = revision.shift();
  const parentShas = revision;
  const changedEntries = git(
    [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      headSha,
    ],
    root,
  ).split('\n').filter(Boolean);
  const evidenceIndex = JSON.parse(
    git(
      ['show', `${headSha}:docs/convergence/EVIDENCE-INDEX.json`],
      root,
    ),
  );
  const outputArtifacts = Object.fromEntries(
    GATE0_BOUND_OUTPUTS.map(filePath => [
      filePath,
      gitBuffer(['show', `${headSha}:${filePath}`], root),
    ]),
  );
  const outputModes = Object.fromEntries(
    GATE0_ATTESTATION_OUTPUTS.map(filePath => [
      filePath,
      git(['ls-tree', headSha, '--', filePath], root).split(' ')[0],
    ]),
  );
  const candidateRegistry = JSON.parse(
    git(
      ['show', `${parentShas[0]}:tests/registry.json`],
      root,
    ),
  );
  const expectedRegistrySha256 = sha256(
    Buffer.from(JSON.stringify(candidateRegistry)),
  );
  const expectedRegistryFacts = buildRegistryGateFacts(candidateRegistry);
  const initialWorktreeClean = git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    root,
  ) === '' && git(['rev-parse', 'HEAD'], root) === headSha;
  const common = {
    headSha,
    parentShas,
    changedEntries,
    evidenceIndex,
    outputArtifacts,
    outputModes,
    expectedRegistrySha256,
    expectedRegistryFacts,
  };
  const preflight = validateGate0Attestation({
    ...common,
    expectedRegistryValidation: evidenceIndex.validations?.registry,
    expectedDispositionValidation: evidenceIndex.validations?.disposition,
    expectedRiskPolicy: evidenceIndex.riskPolicy,
    expectedPrivacyIncident: evidenceIndex.privacyIncident,
    worktreeClean: initialWorktreeClean,
  });
  if (!preflight.valid) return preflight;

  const candidateSha = parentShas[0];
  const validatorEnvironment = environmentForExecution(
    buildGate0ExecutionPlan({
      root,
      candidateSha,
    })[2],
  );
  const [registryValidation, dispositionValidation] =
    await runWithOwnedProcessTerminationHandling(async () => {
      const registry = classifyRegistryValidatorExecution(
        await runValidator(
          ['node', 'scripts/validate-test-registry.js', '--json'],
          root,
          validatorEnvironment,
        ),
      );
      const disposition = classifyDispositionValidatorExecution(
        await runValidator(
          ['node', 'scripts/validate-final-disposition.js', '--json'],
          root,
          validatorEnvironment,
        ),
      );
      return [registry, disposition];
    });
  const expectedRegistryValidation =
    projectRegistryValidation(registryValidation);
  const expectedDispositionValidation =
    projectDispositionValidation(dispositionValidation);
  const expectedRiskPolicy = buildGate0RiskEvidence({
    riskMarkdownBytes: gitBuffer(
      ['show', `${candidateSha}:${RISK_REGISTER_PATH}`],
      root,
    ),
    policyBytes: gitBuffer(
      ['show', `${candidateSha}:${RISK_POLICY_PATH}`],
      root,
    ),
  });
  const expectedPrivacyIncident = buildPrivacyIncidentEvidence(
    gitBuffer(
      ['show', `${candidateSha}:${PRIVACY_INCIDENT_PATH}`],
      root,
    ),
  );
  const finalWorktreeClean = initialWorktreeClean
    && git(['rev-parse', 'HEAD'], root) === headSha
    && git(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      root,
    ) === '';
  return validateGate0Attestation({
    ...common,
    expectedRegistryValidation,
    expectedDispositionValidation,
    expectedRiskPolicy,
    expectedPrivacyIncident,
    worktreeClean: finalWorktreeClean,
  });
}

async function runValidator(argv, cwd, environment) {
  const result = await runLogged(argv, {
    cwd,
    env: environment,
    capture: true,
    allowFailure: true,
    timeoutMs: 5 * 60 * 1000,
  });
  return {
    status: result.exitCode,
    signal: result.signal,
    error: result.spawnError,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitBuffer(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  return isRecord(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function validValidatorEvidence(value, expectedCommand) {
  if (
    !hasExactKeys(value, [
      'command',
      'exitCode',
      'outputSha256',
      'reportSha256',
      'errors',
      'report',
    ])
    || !isRecord(value.report)
  ) {
    return false;
  }
  const reportShapeValid = expectedCommand.includes('test-registry')
    ? hasExactKeys(value.report, [
      'schemaVersion',
      'valid',
      'runnablePrograms',
      'explicitSupportExclusions',
      'fingerprint',
      'document',
    ])
    : hasExactKeys(value.report, [
      'schemaVersion',
      'sourceRepository',
      'sourceRange',
      'sourceManifest',
      'repairedSubjectEvidence',
      'records',
      'dispositionCounts',
      'terminalCounts',
      'resolutionCounts',
      'pathsCount',
      'pathsSha256',
    ]);
  return reportShapeValid
    && value.command === expectedCommand
    && [0, 1].includes(value.exitCode)
    && /^[a-f0-9]{64}$/.test(value.outputSha256 || '')
    && /^[a-f0-9]{64}$/.test(value.reportSha256 || '')
    && Array.isArray(value.errors)
    && (value.exitCode === 0) === (value.errors.length === 0);
}

function validAuditOutcome(value) {
  if (!isRecord(value)) return false;
  const exitForVerdict = {
    PASS: 0,
    FAIL: 1,
    BLOCKED: 2,
  }[value.verdict];
  return typeof value.passed === 'boolean'
    && exitForVerdict !== undefined
    && value.exitCode === exitForVerdict
    && value.passed === (value.verdict === 'PASS')
    && /^[a-f0-9]{64}$/.test(value.reportSha256 || '')
    && /^[a-f0-9]{64}$/.test(value.inventorySha256 || '')
    && isRecord(value.execution);
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--json')) {
    console.error('Usage: node scripts/validate-gate0-attestation.js [--json]');
    return 2;
  }
  const report = await validateCurrentAttestation();
  if (argv[0] === '--json') {
    console.log(JSON.stringify(report));
  } else if (report.valid) {
    console.log(
      `Gate 0 attestation valid: ${report.headSha} attests ${report.candidateSha}; `
      + `${report.changedEntries.length} generated files only`,
    );
  } else {
    for (const error of report.errors) console.error(`ERROR: ${error}`);
  }
  return report.valid ? 0 : 1;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}
