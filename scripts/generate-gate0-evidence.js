#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  classifyDispositionValidatorExecution,
  classifyRegistryValidatorExecution,
  deriveGateOutcome,
  EvidenceInfrastructureError,
  ReviewStatus,
} from './gate0-evidence-verdict.js';
import {
  buildGate0RiskEvidence,
  buildPrivacyIncidentEvidence,
  buildRegistryGateFacts,
  PRIVACY_INCIDENT_PATH,
  projectDispositionValidation,
  projectRegistryValidation,
  RISK_POLICY_PATH,
  RISK_REGISTER_PATH,
} from './gate0-evidence-projections.js';
import {
  buildSanitizedExecutionEvidence,
  buildSanitizedToolchainEvidence,
  environmentForExecution,
  GATE0_DATABASE_COUNT,
  GATE0_DETERMINISTIC_COUNT,
  GATE0_MODEL_SOAK_IDS,
  GATE0_OFFLINE_COUNT,
  GATE0_PILOT_SUITE_ID,
  gate0EvidenceLayout,
  resolveOwnedEvidenceFile,
  sha256,
  validateGate0Provenance,
} from './gate0-evidence-contract.js';
import {
  runLogged,
  runWithOwnedProcessTerminationHandling,
} from './nightly-orchestrator.js';
import {
  GATE0_BASELINE_REPORT_PATH,
  GATE0_EVIDENCE_INDEX_PATH,
  GATE0_STATUS_PATH,
} from './gate0-attestation-paths.js';
import {
  GATE0_PENDING_ATTESTATION_RULE,
  GATE0_REVIEW_PACKET_PATH,
} from './gate0-review-contract.js';

const OUTPUTS = {
  status: GATE0_STATUS_PATH,
  index: GATE0_EVIDENCE_INDEX_PATH,
  report: GATE0_BASELINE_REPORT_PATH,
  review: GATE0_REVIEW_PACKET_PATH,
};
const REVIEW_BASE = 'f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab';

const root = process.cwd();

export async function main(argv = process.argv.slice(2)) {
 try {
  return await runWithGate0OutputRollback({
    repositoryRoot: root,
    outputPaths: Object.values(OUTPUTS),
    operation: async ({ armRollback }) => {
  if (argv.some(arg => arg === '--verdict' || arg.startsWith('--verdict='))) {
    throw new EvidenceInfrastructureError(
      '--verdict is not supported; Gate 0 verdicts are derived from evidence',
    );
  }
  if (argv.length > 0) {
    throw new EvidenceInfrastructureError(
      'Gate 0 evidence generation uses the locked candidate layout and accepts no arguments',
    );
  }
  await requireCanonicalRepositoryRoot(root);

  const initialStatus = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (initialStatus !== '') {
    throw new Error(`Gate 0 evidence requires a clean candidate worktree:\n${initialStatus}`);
  }

  const candidateSha = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']) || 'detached';
  const registry = await readJson(path.join(root, 'tests/registry.json'));
  const registryHash = sha256(JSON.stringify(registry));
  const suiteById = new Map(registry.suites.map(suite => [suite.id, suite]));
  const registryFacts = buildRegistryGateFacts(registry);
  const { profileCounts, stateCounts } = registryFacts;
  const deterministicSuites = registry.suites.filter(
    suite => suite.profile === 'offline' || suite.profile === 'database',
  );
  requireEvidence(
    deterministicSuites.length === GATE0_DETERMINISTIC_COUNT
      && deterministicSuites.every(suite => suite.required && suite.state === 'ACTIVE'),
    `reviewed deterministic scope must be ${GATE0_DETERMINISTIC_COUNT} `
      + 'required ACTIVE offline/database suites',
  );
  requireEvidence(
    profileCounts.offline === GATE0_OFFLINE_COUNT
      && profileCounts.database === GATE0_DATABASE_COUNT,
    'reviewed deterministic profile counts changed',
  );

  const layout = gate0EvidenceLayout(candidateSha);
  const provenanceFile = await resolveOwnedEvidenceFile({
    root,
    evidenceRoot: layout.evidenceRoot,
    relativePath: layout.provenance,
    label: 'Gate 0 provenance',
  });
  const provenance = JSON.parse(provenanceFile.contents.toString('utf8'));
  const provenanceValidation = validateGate0Provenance({
    provenance,
    root,
    candidateSha,
    registrySha256: registryHash,
  });
  requireEvidence(
    provenanceValidation.valid,
    `Gate 0 provenance is invalid: ${provenanceValidation.errors.join('; ')}`,
  );
  requireEvidence(
    provenanceFile.sha256 === await hashFile(provenanceFile.absolutePath),
    'Gate 0 provenance changed while it was being read',
  );
  const executionById = new Map(
    provenance.executions.map(execution => [execution.id, execution]),
  );
  const producerLogById = new Map();
  for (const execution of provenance.executions) {
    const log = await resolveOwnedEvidenceFile({
      root,
      evidenceRoot: layout.evidenceRoot,
      relativePath: execution.logPath,
      label: `${execution.id} producer log`,
    });
    requireEvidence(
      log.bytes === execution.logBytes && log.sha256 === execution.logSha256,
      `${execution.id} producer log disagrees with provenance`,
    );
    producerLogById.set(execution.id, log);
  }

  const installLogs = [];
  for (const [kind, executionId] of [
    ['clean', 'install-clean'],
    ['repeat', 'install-repeat'],
  ]) {
    const execution = executionById.get(executionId);
    const log = producerLogById.get(executionId);
    installLogs.push({
      kind,
      path: log.relativePath,
      bytes: log.bytes,
      sha256: log.sha256,
      exitCode: execution.exitCode,
      execution: buildSanitizedExecutionEvidence(execution, root),
    });
  }
  for (const log of installLogs) {
    const contents = producerLogById.get(`install-${log.kind}`).contents
      .toString('utf8');
    for (const marker of [
      `Node.js ${provenance.toolchain.nodeVersion}`,
      `npm ${provenance.toolchain.npmVersion}`,
      `yarn ${provenance.toolchain.yarnVersion}`,
    ]) {
      requireEvidence(
        contents.includes(marker),
        `${log.kind} install log does not prove toolchain marker ${marker}`,
      );
    }
  }

  const deterministicAudit = await loadAndValidateAuditEvidence({
    root,
    evidenceRoot: layout.evidenceRoot,
    execution: executionById.get('deterministic'),
    candidateSha,
    registryHash,
    expectedSuites: deterministicSuites,
    expectedOptions: auditOptions({
      profiles: ['offline', 'database'],
      timeoutMs: 10 * 60 * 1000,
      deadlineMs: 8 * 60 * 60 * 1000,
    }),
  });
  const pilotAudits = [];
  for (let index = 0; index < 5; index++) {
    pilotAudits.push(await loadAndValidateAuditEvidence({
      root,
      evidenceRoot: layout.evidenceRoot,
      execution: executionById.get(`pilot-${String(index + 1).padStart(2, '0')}`),
      candidateSha,
      registryHash,
      expectedSuites: [suiteById.get(GATE0_PILOT_SUITE_ID)],
      expectedOptions: auditOptions({
        ids: [GATE0_PILOT_SUITE_ID],
        timeoutMs: 5 * 60 * 1000,
        deadlineMs: 60 * 60 * 1000,
      }),
    }));
  }
  const soakSuites = GATE0_MODEL_SOAK_IDS.map(id => suiteById.get(id));
  requireEvidence(
    soakSuites.every(Boolean),
    'reviewed model-backed soak suites are missing from the registry',
  );
  const soakAudit = await loadAndValidateAuditEvidence({
    root,
    evidenceRoot: layout.evidenceRoot,
    execution: executionById.get('soak-guard'),
    candidateSha,
    registryHash,
    expectedSuites: soakSuites,
    expectedOptions: auditOptions({
      ids: [...GATE0_MODEL_SOAK_IDS],
      timeoutMs: 60 * 60 * 1000,
      deadlineMs: 60 * 60 * 1000,
    }),
  });

  const validatorEnvironment = environmentForExecution(
    provenanceValidation.expectedPlan[2],
  );
  const registryValidation = classifyRegistryValidatorExecution(
    await runValidator(
      ['node', 'scripts/validate-test-registry.js', '--json'],
      validatorEnvironment,
    ),
  );
  if (
    registryValidation.passed
    && (
      registryValidation.report.fingerprint !== registryHash
      || registryValidation.report.runnablePrograms !== registry.suites.length
      || registryValidation.report.explicitSupportExclusions
        !== registry.exclusions.length
    )
  ) {
    throw new EvidenceInfrastructureError(
      'registry validator report disagrees with the candidate inventory',
    );
  }
  const dispositionValidation = classifyDispositionValidatorExecution(
    await runValidator(
      ['node', 'scripts/validate-final-disposition.js', '--json'],
      validatorEnvironment,
    ),
  );

  const knownDefectiveInDeterministic = deterministicAudit.report.results.filter(result => (
    suiteById.get(result.id)?.state === 'KNOWN_DEFECTIVE'
  ));

  const blockedWithoutPrerequisite =
    registryFacts.blockedWithoutPrerequisite;
  requireEvidence(
    git(['status', '--porcelain=v1', '--untracked-files=all']) === '',
    'validators changed the candidate worktree',
  );

  const privacyBytes = await readFile(path.join(root, PRIVACY_INCIDENT_PATH));
  const privacy = JSON.parse(privacyBytes.toString('utf8'));
  requireEvidence(
    privacy.status === 'CONFIRMED_COMPROMISE',
    'privacy incident must remain classified as CONFIRMED_COMPROMISE',
  );
  const privacyIncident = buildPrivacyIncidentEvidence(privacyBytes);
  const riskMarkdownBytes = await readFile(path.join(root, RISK_REGISTER_PATH));
  const riskPolicyBytes = await readFile(path.join(root, RISK_POLICY_PATH));
  const riskAssessment = buildGate0RiskEvidence({
    riskMarkdownBytes,
    policyBytes: riskPolicyBytes,
  });
  const repositoryBlockers = riskAssessment.repositoryBlockers;

  const reviewRange = `${REVIEW_BASE}..${candidateSha}`;
  const reviewCommits = git([
    'log',
    '--reverse',
    '--format=%H%x09%s',
    reviewRange,
  ]).split('\n').filter(Boolean);
  const reviewDiffStat = git(['diff', '--stat', reviewRange]);

  const sourceEvidence = {
    passed: provenance.executions.every(execution => (
      execution.preSourceState.sha === candidateSha
      && execution.preSourceState.statusPorcelain === ''
      && execution.postSourceState.sha === candidateSha
      && execution.postSourceState.statusPorcelain === ''
      && execution.preIgnoredState.unexpectedPathCount === 0
      && execution.postIgnoredState.unexpectedPathCount === 0
    )),
    executionCount: provenance.executions.length,
  };
  const installationEvidence = {
    passed: installLogs.every(log => log.exitCode === 0),
    logs: installLogs,
  };
  const deterministicEvidence = makeAuditEvidence(
    deterministicAudit,
    executionById.get('deterministic'),
    root,
  );
  const pilotEvidence = pilotAudits.map((audit, index) => ({
    ...makeAuditEvidence(
      audit,
      executionById.get(`pilot-${String(index + 1).padStart(2, '0')}`),
      root,
    ),
  }));
  const soakEvidence = {
    ...makeAuditEvidence(soakAudit, executionById.get('soak-guard'), root),
    blockedBy: [...new Set(
      soakAudit.report.results.flatMap(result => result.blockedBy || []),
    )].sort(),
    guardPassed: soakAudit.report.verdict === 'BLOCKED'
      && soakAudit.report.exitCode === 2
      && soakAudit.report.results.every(result => (
        result.status === 'BLOCKED'
        && result.blockedBy?.includes('gpu')
        && result.blockedBy?.includes('ollama')
      )),
  };
  const evidenceContract = {
    passed: provenanceValidation.valid,
    path: provenanceFile.relativePath,
    sha256: provenanceFile.sha256,
  };
  const generatedAt = provenance.endedAt;
  const clauses = buildGate0Clauses({
    registryValidation,
    dispositionValidation,
    sourceEvidence,
    installationEvidence,
    deterministicEvidence,
    pilotEvidence,
    soakEvidence,
    evidenceContract,
    runnablePrograms: registry.suites.length,
    explicitSupportExclusions: registry.exclusions.length,
    stateCounts,
    blockedWithoutPrerequisite,
    knownDefectiveInDeterministic,
    riskAssessment,
  });
  const outcome = deriveGateOutcome({
    clauses,
    repositoryBlockers,
    reviewRequiredRisks: riskAssessment.reviewRequiredRisks,
    reviewStatus: ReviewStatus.PENDING,
  });
  const { verdict } = outcome;

  const evidenceIndex = {
    schemaVersion: 7,
    product: 'IntentSmith',
    gate: 'Gate 0',
    verdict,
    exitCode: outcome.exitCode,
    generatedAt,
    candidate: {
      sha: candidateSha,
      branch,
      registrySha256: registryHash,
      attestationRule: GATE0_PENDING_ATTESTATION_RULE,
    },
    sourceRefs: {
      c3Input: 'ffd21cf119865259ea1847af989acb24916bebe3',
      c3Parent: 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f',
      intentSmithDonor: '6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4',
      localValidationCandidate: candidateSha,
    },
    inventory: {
      runnablePrograms: registry.suites.length,
      explicitSupportExclusions: registry.exclusions.length,
      profileCounts,
      stateCounts,
      deterministicRequired: deterministicSuites.length,
      dispositionRecords: dispositionValidation.report.records,
    },
    clauses,
    repositoryBlockers,
    provenance: {
      schemaVersion: provenance.schemaVersion,
      path: provenanceFile.relativePath,
      sha256: provenanceFile.sha256,
      bytes: provenanceFile.bytes,
      executionCount: provenance.executions.length,
      secretValuesRecorded: provenance.secretValuesRecorded,
      initialIgnoredState: provenance.initialIgnoredState,
      startedAt: provenance.startedAt,
      endedAt: provenance.endedAt,
      toolchain: buildSanitizedToolchainEvidence(provenance.toolchain),
    },
    riskPolicy: riskAssessment,
    validations: {
      registry: projectRegistryValidation(registryValidation),
      disposition: projectDispositionValidation(dispositionValidation),
    },
    installation: {
      passed: installationEvidence.passed,
      logs: installLogs,
    },
    deterministic: deterministicEvidence,
    pilotFiveConsecutive: pilotEvidence,
    soakRequirementGuard: soakEvidence,
    privacyIncident,
    review: {
      range: reviewRange,
      commitCount: reviewCommits.length,
      packet: OUTPUTS.review,
      independentReviewStatus: outcome.reviewStatus,
    },
  };

  const statusMarkdown = renderStatus({
    candidateSha,
    branch,
    registryHash,
    verdict,
    generatedAt,
    profileCounts,
    stateCounts,
    runnablePrograms: registry.suites.length,
    explicitSupportExclusions: registry.exclusions.length,
    deterministicEvidence,
    privacy,
    clauses,
    outcome,
    riskAssessment,
  });
  const baselineMarkdown = renderBaselineReport({
    candidateSha,
    branch,
    registryHash,
    verdict,
    generatedAt,
    registryValidation,
    dispositionValidation,
    installLogs,
    deterministicEvidence,
    pilotEvidence,
    soakEvidence,
    privacy,
    explicitSupportExclusions: registry.exclusions.length,
    stateCounts,
    clauses,
    outcome,
    riskAssessment,
    dispositionReport: dispositionValidation.report,
  });
  const reviewMarkdown = renderReviewPacket({
    candidateSha,
    registryHash,
    reviewRange,
    reviewCommits,
    reviewDiffStat,
    installLogs,
    deterministicEvidence,
    pilotEvidence,
    soakEvidence,
    stateCounts,
    clauses,
    outcome,
    riskAssessment,
    dispositionReport: dispositionValidation.report,
  });
  evidenceIndex.generatedOutputs = Object.fromEntries([
    [OUTPUTS.status, statusMarkdown],
    [OUTPUTS.report, baselineMarkdown],
    [OUTPUTS.review, reviewMarkdown],
  ].map(([filePath, contents]) => [
    filePath,
    {
      bytes: Buffer.byteLength(contents),
      sha256: sha256(contents),
    },
  ]));

  requireEvidence(
    git(['rev-parse', 'HEAD']) === candidateSha
      && git(['status', '--porcelain=v1', '--untracked-files=all']) === '',
    'candidate identity or worktree changed before evidence output',
  );
  await armRollback();
  await writeGate0OutputAtomic(path.join(root, OUTPUTS.status), statusMarkdown);
  await writeGate0OutputAtomic(
    path.join(root, OUTPUTS.index),
    `${JSON.stringify(evidenceIndex, null, 2)}\n`,
  );
  await writeGate0OutputAtomic(path.join(root, OUTPUTS.report), baselineMarkdown);
  await writeGate0OutputAtomic(path.join(root, OUTPUTS.review), reviewMarkdown);
  requireEvidence(
    git(['rev-parse', 'HEAD']) === candidateSha,
    'candidate HEAD changed while evidence was generated',
  );

  console.log(`Gate 0 evidence generated for ${candidateSha}`);
  console.log(`Registry sha256: ${registryHash}`);
  console.log(`Verdict: ${verdict}`);
  for (const output of Object.values(OUTPUTS)) console.log(`Wrote: ${output}`);
  return outcome.exitCode;
    },
  });
 } catch (error) {
   console.error(error.stack || error.message);
   return 2;
 }
}

export async function runWithGate0OutputRollback({
  repositoryRoot,
  outputPaths,
  operation,
}) {
  let rollbackSnapshot = null;
  const armRollback = async () => {
    if (rollbackSnapshot !== null) {
      throw new Error('Gate 0 output rollback was armed more than once');
    }
    rollbackSnapshot = new Map();
    for (const relativePath of outputPaths) {
      rollbackSnapshot.set(
        relativePath,
        await readFile(path.join(repositoryRoot, relativePath)),
      );
    }
  };
  try {
    const result = await runWithOwnedProcessTerminationHandling(
      () => operation({ armRollback }),
    );
    rollbackSnapshot = null;
    return result;
  } catch (error) {
    if (rollbackSnapshot !== null) {
      const restoreErrors = [];
      for (const [relativePath, contents] of rollbackSnapshot) {
        try {
          await writeGate0OutputAtomic(
            path.join(repositoryRoot, relativePath),
            contents,
          );
        } catch (restoreError) {
          restoreErrors.push(`${relativePath}: ${restoreError.message}`);
        }
      }
      if (restoreErrors.length > 0) {
        throw new AggregateError(
          [error],
          `Gate 0 output rollback failed: ${restoreErrors.join('; ')}`,
        );
      }
    }
    throw error;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function runValidator(argv, environment) {
  const result = await runLogged(argv, {
    cwd: process.cwd(),
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

export function buildGate0Clauses({
  registryValidation,
  dispositionValidation,
  sourceEvidence,
  installationEvidence,
  deterministicEvidence,
  pilotEvidence,
  soakEvidence,
  evidenceContract,
  runnablePrograms,
  explicitSupportExclusions,
  stateCounts,
  blockedWithoutPrerequisite,
  knownDefectiveInDeterministic,
  riskAssessment,
}) {
  const validatorEvidence = (validation) => (
    validation.passed
      ? `validator exit 0`
      : `validator exit ${validation.exitCode}: ${validation.errors.join('; ')}`
  );
  return [
    {
      id: 'G0-C1',
      label: 'clean candidate',
      result: sourceEvidence.passed ? 'PASS' : 'FAIL',
      evidence: sourceEvidence.passed
        ? `all ${sourceEvidence.executionCount} locked executions started and ended at a clean candidate SHA`
        : 'at least one locked execution started or ended at a dirty or different candidate',
    },
    {
      id: 'G0-C2',
      label: 'disposition',
      result: dispositionValidation.passed ? 'PASS' : 'FAIL',
      evidence: `${dispositionValidation.report.records} records; `
        + `${dispositionValidation.report.repairedSubjectEvidence?.validatedCount || 0}/60 repaired subjects; `
        + `${validatorEvidence(dispositionValidation)}`,
    },
    {
      id: 'G0-C3',
      label: 'registry',
      result: registryValidation.passed ? 'PASS' : 'FAIL',
      evidence: `${runnablePrograms} runnable programs and ${explicitSupportExclusions} explicit support exclusions; ${validatorEvidence(registryValidation)}`,
    },
    {
      id: 'G0-C4',
      label: 'clean install',
      result: installationEvidence.passed ? 'PASS' : 'FAIL',
      evidence: installationEvidence.passed
        ? 'two consecutive locked minimal installs, both exit 0 against the same isolated cache'
        : `locked install exits: ${installationEvidence.logs.map(log => (
          `${log.kind}=${log.exitCode}`
        )).join(', ')}`,
    },
    {
      id: 'G0-C5',
      label: 'deterministic T1/T2',
      result: deterministicEvidence.passed
        && pilotEvidence.every(item => item.passed) ? 'PASS' : 'FAIL',
      evidence: `${deterministicEvidence.statusCounts.PASS || 0} deterministic PASS; `
        + `${pilotEvidence.filter(item => item.passed).length}/5 pilot PASS; `
        + `deterministic verdict ${deterministicEvidence.verdict}/exit ${deterministicEvidence.exitCode}`,
    },
    {
      id: 'G0-C6',
      label: 'defective suites excluded',
      result: knownDefectiveInDeterministic.length === 0 ? 'PASS' : 'FAIL',
      evidence: knownDefectiveInDeterministic.length === 0
        ? `${stateCounts.KNOWN_DEFECTIVE || 0} registry rows are KNOWN_DEFECTIVE; none appears in green deterministic evidence`
        : `green deterministic evidence includes ${knownDefectiveInDeterministic.length} KNOWN_DEFECTIVE rows`,
    },
    {
      id: 'G0-C7',
      label: 'blockers specific',
      result: blockedWithoutPrerequisite.length === 0 && soakEvidence.guardPassed
        ? 'PASS' : 'FAIL',
      evidence: blockedWithoutPrerequisite.length === 0 && soakEvidence.guardPassed
        ? 'every registry BLOCKED row names a concrete prerequisite; all five soak guards name gpu and ollama'
        : [
          blockedWithoutPrerequisite.length > 0
            ? `BLOCKED rows lack a concrete prerequisite: ${blockedWithoutPrerequisite.join(', ')}`
            : null,
          !soakEvidence.guardPassed
            ? `soak guard was ${soakEvidence.verdict}/exit ${soakEvidence.exitCode}`
            : null,
        ].filter(Boolean).join('; '),
    },
    {
      id: 'G0-C8',
      label: 'generated evidence',
      result: evidenceContract.passed ? 'PASS' : 'FAIL',
      evidence: evidenceContract.passed
        ? `typed producer provenance ${evidenceContract.path} is bound by SHA-256 ${evidenceContract.sha256}`
        : 'typed producer provenance failed validation',
    },
    {
      id: 'G0-C9',
      label: 'risk impact policy',
      result: riskAssessment.valid ? 'PASS' : 'FAIL',
      evidence: riskAssessment.valid
        ? `${riskAssessment.riskCount} risk rows have validated machine-readable gateImpact entries`
        : `risk policy invalid: ${riskAssessment.errors.join('; ')}`,
    },
  ];
}

function auditOptions({
  profiles = [],
  ids = [],
  timeoutMs,
  deadlineMs,
}) {
  return {
    concurrency: 1,
    failFast: false,
    timeoutMs,
    deadlineMs,
    profiles: [...profiles].sort(),
    ids: [...ids].sort(),
    exclude: [],
    allowBlockers: [],
    noBlock: false,
    allowDirty: false,
  };
}

export async function loadAndValidateAuditEvidence({
  root: sourceRoot,
  evidenceRoot,
  execution,
  candidateSha,
  registryHash,
  expectedSuites,
  expectedOptions,
}) {
  requireEvidence(execution, 'audit execution is missing from provenance');
  requireEvidence(
    Array.isArray(expectedSuites) && expectedSuites.length > 0
      && expectedSuites.every(Boolean),
    `${execution.id} expected registry suites are missing`,
  );
  const [reportFile, inventoryFile] = await Promise.all([
    resolveOwnedEvidenceFile({
      root: sourceRoot,
      evidenceRoot,
      relativePath: execution.reportPath,
      label: `${execution.id} report`,
    }),
    resolveOwnedEvidenceFile({
      root: sourceRoot,
      evidenceRoot,
      relativePath: execution.inventoryPath,
      label: `${execution.id} inventory`,
    }),
  ]);
  const [report, inventory] = [
    JSON.parse(reportFile.contents.toString('utf8')),
    JSON.parse(inventoryFile.contents.toString('utf8')),
  ];
  requireEvidence(
    reportFile.bytes === execution.reportBytes
      && reportFile.sha256 === execution.reportSha256
      && inventoryFile.bytes === execution.inventoryBytes
      && inventoryFile.sha256 === execution.inventorySha256,
    `${execution.id} report/inventory changed after producer capture`,
  );
  requireEvidence(
    report.schemaVersion === 1
      && report.manifestType === 'intentsmith.audit-report',
    `${execution.id} report schema is unsupported`,
  );
  requireEvidence(
    inventory.schemaVersion === 1
      && inventory.manifestType === 'intentsmith.audit-inventory',
    `${execution.id} inventory schema is unsupported`,
  );
  const expectedRunId = execution.argv
    .find(value => value.startsWith('--run-id='))
    ?.slice('--run-id='.length);
  requireEvidence(
    typeof expectedRunId === 'string'
      && report.runId === expectedRunId
      && inventory.runId === expectedRunId
      && report.sourceRevision === candidateSha
      && inventory.sourceRevision === candidateSha,
    `${execution.id} report/inventory candidate identity mismatch`,
  );
  requireEvidence(
    report.registryHash === registryHash && inventory.registryHash === registryHash,
    `${execution.id} report/inventory registry fingerprint mismatch`,
  );
  requireEvidence(
    report.paths?.sourceRoot === sourceRoot
      && report.paths?.report === execution.reportPath
      && report.paths?.inventory === execution.inventoryPath,
    `${execution.id} report path identity mismatch`,
  );
  const expectedRunDir = path.dirname(execution.reportPath).split(path.sep).join('/');
  requireEvidence(
    report.paths?.runDir === expectedRunDir
      && report.paths?.checkpoint === `${expectedRunDir}/checkpoint.json`,
    `${execution.id} report layout differs from the locked plan`,
  );
  requireEvidence(
    isDeepStrictEqual(inventory.options, expectedOptions),
    `${execution.id} inventory options differ from the locked plan`,
  );
  const expectedReportOptions = { ...expectedOptions };
  delete expectedReportOptions.allowDirty;
  requireEvidence(
    isDeepStrictEqual(report.options, expectedReportOptions),
    `${execution.id} report options differ from the locked plan`,
  );
  const expectedOptionsFingerprint = stableHash(expectedOptions);
  requireEvidence(
    inventory.optionsFingerprint === expectedOptionsFingerprint
      && report.optionsFingerprint === expectedOptionsFingerprint,
    `${execution.id} options fingerprint mismatch`,
  );

  const expectedInventorySuites = [...expectedSuites]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(suite => ({
      ...suite,
      category: suite.profile,
      command: suite.argv,
      blockers: registryBlockersFor(suite),
    }));
  requireEvidence(
    isDeepStrictEqual(inventory.suites, expectedInventorySuites),
    `${execution.id} inventory payload differs from the reviewed registry`,
  );
  const expectedInventoryFingerprint = stableHash(
    expectedInventorySuites.map(suite => ({
      id: suite.id,
      path: suite.path,
      profile: suite.profile,
      tier: suite.tier,
      command: suite.command,
      blockers: suite.blockers,
      required: suite.required,
      state: suite.state,
      requirements: suite.requirements,
      timeoutMs: suite.timeoutMs,
      expectedDurationMs: suite.expectedDurationMs,
    })),
  );
  requireEvidence(
    inventory.inventoryFingerprint === expectedInventoryFingerprint
      && report.inventoryFingerprint === expectedInventoryFingerprint,
    `${execution.id} inventory fingerprint mismatch`,
  );
  const expectedIds = expectedInventorySuites.map(suite => suite.id);
  const expectedById = new Map(
    expectedInventorySuites.map(suite => [suite.id, suite]),
  );
  const expectedProfileCounts = Object.fromEntries(
    ['offline', 'database', 'server', 'model', 'soak', 'manual']
      .map(profile => [profile, 0]),
  );
  for (const suite of expectedInventorySuites) {
    expectedProfileCounts[suite.profile] += 1;
  }
  const expectedBlockerCounts = expectedInventorySuites
    .flatMap(suite => suite.blockers)
    .reduce((counts, blocker) => {
      counts[blocker] = (counts[blocker] || 0) + 1;
      return counts;
    }, {});
  requireEvidence(
    inventory.generatedAt === report.startedAt
      && inventory.counts
      && isDeepStrictEqual(inventory.counts, expectedProfileCounts)
      && isDeepStrictEqual(inventory.blockerCounts, expectedBlockerCounts)
      && report.inventory?.total === expectedIds.length
      && isDeepStrictEqual(report.inventory?.counts, expectedProfileCounts)
      && isDeepStrictEqual(report.inventory?.blockerCounts, expectedBlockerCounts)
      && report.interruptionSignal === null,
    `${execution.id} inventory counters or interruption evidence mismatch`,
  );
  requireEvidence(
    isOrderedInterval(
      execution.startedAt,
      report.startedAt,
      report.endedAt,
      execution.endedAt,
    ),
    `${execution.id} report chronology is outside its producer execution`,
  );
  requireEvidence(
    Array.isArray(report.results)
      && report.results.length === expectedIds.length
      && isDeepStrictEqual(
        report.results.map(result => result.id),
        expectedIds,
      ),
    `${execution.id} report suite identity/order mismatch`,
  );
  const statuses = ['PASS', 'FAIL', 'TIMEOUT', 'BLOCKED', 'SKIPPED'];
  const statusCounts = Object.fromEntries(statuses.map(status => [status, 0]));
  const logIdentityErrors = auditResultLogIdentityErrors({
    results: report.results,
    expectedSuites,
    expectedRunDir,
  });
  requireEvidence(
    logIdentityErrors.length === 0,
    `${execution.id} suite log identity is invalid: ${logIdentityErrors.join('; ')}`,
  );
  for (const result of report.results) {
    const expected = expectedById.get(result.id);
    requireEvidence(
      result.path === expected.path
        && result.profile === expected.profile
        && result.category === expected.profile
        && result.required === expected.required
        && result.sourceRevision === candidateSha
        && isDeepStrictEqual(result.command, expected.argv)
        && isDeepStrictEqual(result.blockers, registryBlockersFor(expected))
        && result.retryCount === 0
        && Number.isInteger(result.durationMs)
        && result.durationMs >= 0
        && isOrderedInterval(
          report.startedAt,
          result.start,
          result.end,
          report.endedAt,
        )
        && Date.parse(result.end) - Date.parse(result.start) === result.durationMs
        && statuses.includes(result.status),
      `${execution.id} result contract mismatch for ${result.id}`,
    );
    statusCounts[result.status] += 1;
    if (result.status === 'PASS') {
      requireEvidence(
        result.exitCode === 0 && result.signal === null && result.timedOut === false,
        `${execution.id} PASS has inconsistent process evidence for ${result.id}`,
      );
    }
    if (result.status === 'TIMEOUT') {
      requireEvidence(
        result.timedOut === true,
        `${execution.id} TIMEOUT lacks timeout evidence for ${result.id}`,
      );
    }
    if (!['BLOCKED', 'SKIPPED'].includes(result.status)) {
      requireEvidence(
        result.cleanup?.checked === true
          && result.cleanup?.leakDetected === false
          && result.cleanup?.terminated === true
          && result.sourceTree?.checked === true
          && result.sourceTree?.clean === true
          && result.sourceTree?.head === candidateSha
          && result.logError === null
          && result.outputError === null
          && result.logReadError === undefined
          && typeof result.logPath === 'string'
          && /^[a-f0-9]{64}$/.test(result.logSha256 || ''),
        `${execution.id} result lacks cleanup/source/log evidence for ${result.id}`,
      );
      const logFile = await resolveOwnedEvidenceFile({
        root: sourceRoot,
        evidenceRoot,
        relativePath: result.logPath,
        label: `${execution.id} suite log ${result.id}`,
      });
      requireEvidence(
        logFile.sha256 === result.logSha256
          && isPathWithin(
            path.join(sourceRoot, expectedRunDir, 'logs'),
            logFile.absolutePath,
          ),
        `${execution.id} suite log identity mismatch for ${result.id}`,
      );
    } else {
      requireEvidence(
        result.exitCode === null && result.signal === null && result.logPath === null,
        `${execution.id} ${result.status} has inconsistent process evidence for ${result.id}`,
      );
      if (result.status === 'BLOCKED') {
        requireEvidence(
          Array.isArray(result.blockedBy) && result.blockedBy.length > 0,
          `${execution.id} BLOCKED lacks named prerequisites for ${result.id}`,
        );
      } else {
        requireEvidence(
          typeof result.skipReason === 'string' && result.skipReason !== '',
          `${execution.id} SKIPPED lacks a reason for ${result.id}`,
        );
      }
    }
  }
  requireEvidence(
    isDeepStrictEqual(report.statusCounts, statusCounts),
    `${execution.id} status counts disagree with result rows`,
  );
  const requiredProblems = report.results.filter(result => (
    result.required !== false && result.status !== 'PASS'
  ));
  const requiredBlocked = requiredProblems.filter(result => result.status === 'BLOCKED');
  const requiredFailures = requiredProblems.filter(result => result.status !== 'BLOCKED');
  const expectedVerdict = requiredFailures.length > 0
    ? 'FAIL'
    : requiredBlocked.length > 0 ? 'BLOCKED' : 'PASS';
  const expectedExitCode = expectedVerdict === 'PASS'
    ? 0
    : expectedVerdict === 'BLOCKED' ? 2 : 1;
  requireEvidence(
    report.verdict === expectedVerdict
      && report.exitCode === expectedExitCode
      && execution.exitCode === expectedExitCode
      && report.requiredFailureCount === requiredProblems.length
      && report.requiredBlockedCount === requiredBlocked.length
      && report.dryRun === false,
    `${execution.id} verdict/exit/counter evidence is contradictory`,
  );
  return {
    report,
    inventory,
    reportFile,
    inventoryFile,
    passed: expectedVerdict === 'PASS',
  };
}

export function auditResultLogIdentityErrors({
  results,
  expectedSuites,
  expectedRunDir,
}) {
  const errors = [];
  const expectedById = new Map(
    (expectedSuites || []).map(suite => [suite.id, suite]),
  );
  const seen = new Set();
  for (const result of results || []) {
    if (['BLOCKED', 'SKIPPED'].includes(result.status)) continue;
    const expected = expectedById.get(result.id);
    if (!expected) {
      errors.push(`unknown executed suite ${result.id || '(missing)'}`);
      continue;
    }
    const expectedLogPath =
      `${expectedRunDir}/logs/${safeAuditLogName(expected.path)}.log`;
    if (result.logPath !== expectedLogPath) {
      errors.push(`${result.id} log path differs from the deterministic path`);
    }
    if (seen.has(result.logPath)) {
      errors.push(`${result.id} reuses another result log path`);
    }
    seen.add(result.logPath);
  }
  return errors;
}

function makeAuditEvidence(audit, execution, sourceRoot) {
  return {
    runId: audit.report.runId,
    passed: audit.passed,
    verdict: audit.report.verdict,
    exitCode: audit.report.exitCode,
    statusCounts: audit.report.statusCounts,
    report: audit.reportFile.relativePath,
    reportSha256: audit.reportFile.sha256,
    reportBytes: audit.reportFile.bytes,
    inventory: audit.inventoryFile.relativePath,
    inventorySha256: audit.inventoryFile.sha256,
    inventoryBytes: audit.inventoryFile.bytes,
    inventoryFingerprint: audit.report.inventoryFingerprint,
    optionsFingerprint: audit.report.optionsFingerprint,
    startedAt: audit.report.startedAt,
    endedAt: audit.report.endedAt,
    execution: buildSanitizedExecutionEvidence(execution, sourceRoot),
  };
}

function registryBlockersFor(suite) {
  const blockers = new Set();
  if (suite.state !== 'ACTIVE') blockers.add(`state-${suite.state.toLowerCase()}`);
  if (suite.requirements.server) blockers.add('server');
  if (suite.requirements.ollama) blockers.add('ollama');
  if (suite.requirements.gpu) blockers.add('gpu');
  if (suite.requirements.modelFixture) blockers.add('model-fixture');
  if (suite.requirements.network === 'external') blockers.add('external-network');
  return [...blockers].sort();
}

function stableHash(value) {
  return sha256(JSON.stringify(value));
}

function safeAuditLogName(relativePath) {
  const hash = createHash('sha1')
    .update(relativePath)
    .digest('hex')
    .slice(0, 8);
  return `${relativePath.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.${hash}`;
}

function isOrderedInterval(outerStart, innerStart, innerEnd, outerEnd) {
  const values = [outerStart, innerStart, innerEnd, outerEnd]
    .map(value => Date.parse(value));
  return values.every(Number.isFinite)
    && values[0] <= values[1]
    && values[1] <= values[2]
    && values[2] <= values[3];
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function requireCanonicalRepositoryRoot(requestedRoot) {
  const [requestedReal, discoveredReal] = await Promise.all([
    realpath(requestedRoot),
    realpath(git(['rev-parse', '--show-toplevel'])),
  ]);
  requireEvidence(
    requestedRoot === requestedReal && requestedReal === discoveredReal,
    'Gate 0 evidence must run from the canonical Git worktree root',
  );
}

export function renderStatus({
  candidateSha,
  branch,
  registryHash,
  verdict,
  generatedAt,
  profileCounts,
  stateCounts,
  runnablePrograms,
  explicitSupportExclusions,
  deterministicEvidence,
  privacy,
  clauses,
  outcome,
  riskAssessment,
}) {
  return `# IntentSmith Convergence Status

> Generated by \`scripts/generate-gate0-evidence.js\` from a clean candidate.
> Do not hand-edit. The evidence-only attestation commit must have the candidate
> below as its first parent.

- Generated: ${generatedAt}
- Candidate: \`${candidateSha}\`
- Branch: \`${branch}\`
- Registry SHA-256: \`${registryHash}\`
- Gate: **Gate 0 — trustworthy baseline**
- Verdict: **${verdict}**

## Gate 0 clauses

| Clause | Result | Evidence |
|---|---|---|
${renderClauseRows(clauses)}

## Registry

- Profiles: ${formatCounts(profileCounts)}
- States: ${formatCounts(stateCounts)}
- Deterministic required scope: ${GATE0_DETERMINISTIC_COUNT} (offline=${GATE0_OFFLINE_COUNT}, database=${GATE0_DATABASE_COUNT})

## Remaining boundaries

- Independent Opus review: **${outcome.reviewStatus}**.
${outcome.repositoryBlockers.length > 0
    ? `- Repository-local Gate 0 blockers: **${outcome.repositoryBlockers.join(', ')}**.`
    : '- Repository-local Gate 0 blockers: none.'}
- Review-required risks: ${riskAssessment.reviewRequiredRisks.join(', ') || 'none'}.
- Later-gate risks: ${riskAssessment.laterGateRisks.join(', ') || 'none'}.
- Separate incidents: ${riskAssessment.separateIncidents.join(', ') || 'none'}.
- Confirmed privacy compromise: **${privacy.status}**.
- Current-tree private material is contained; affected history remains reachable.
- Credential rotation and history remediation require operator action.
- ${stateCounts.KNOWN_DEFECTIVE || 0} recovered E2E suites remain
  \`KNOWN_DEFECTIVE\`; ${stateCounts.BLOCKED || 0} rows remain registry-\`BLOCKED\`.
- Supported program-language files are discovered regardless of filename;
  ${explicitSupportExclusions} support/aggregate files are explicit reasoned
  exclusions.
- The operator-owned ignored \`data/c3.db\` remains untouched (\`D-022\`).

## Next action

${verdict === 'FAIL'
    ? 'Repair every failed clause and repository-local blocker, then regenerate evidence from a new clean candidate.'
    : 'Give `docs/convergence/reviews/GATE0-OPUS-REVIEW.md` and the referenced artifacts to Opus 5 for read-only review. Do not enter the next gate until the review is evaluated and the operator confirms continuation.'}
`;
}

export function renderBaselineReport({
  candidateSha,
  branch,
  registryHash,
  verdict,
  generatedAt,
  registryValidation,
  dispositionValidation,
  installLogs,
  deterministicEvidence,
  pilotEvidence,
  soakEvidence,
  privacy,
  explicitSupportExclusions,
  stateCounts,
  clauses,
  outcome,
  riskAssessment,
  dispositionReport,
}) {
  const pilotRows = pilotEvidence.map(item => (
    `| \`${item.runId}\` | ${item.exitCode} | ${item.verdict} | \`${item.reportSha256}\` |`
  )).join('\n');
  const pilotCommands = pilotEvidence.map(item => (
    `- \`${item.runId}\`: \`${formatPortableInvocation(item.execution.portableReplay)}\``
  )).join('\n');
  const rotationRows = privacy.rotationInventory
    .map(item => `- ${item.category}: ${item.action}`)
    .join('\n');
  const pilotsPassed = pilotEvidence.length === 5
    && pilotEvidence.every(item => (
      item.passed === true
      && item.verdict === 'PASS'
      && item.exitCode === 0
    ));
  const pilotNarrative = pilotsPassed
    ? 'The unchanged A9 assertion passed in every run. The repair changed the low-\n'
      + 'ceremony C2 fixture, not production score weights or thresholds.'
    : 'The pilot evidence did not establish five consecutive A9 passes; the Gate 0\n'
      + 'pilot clause remains failed.';
  const soakNarrative = soakEvidence.guardPassed === true
    ? 'Five soak programs previously misdeclared as model-free are now blocked before\n'
      + 'execution unless Ollama and GPU are explicitly authorized.'
    : 'The model-backed soak prerequisite guard was not established; the Gate 0 soak\n'
      + 'clause remains failed.';
  return `# IntentSmith Gate 0 Baseline Report

## Verdict

**${verdict}**

- Candidate: \`${candidateSha}\`
- Branch: \`${branch}\`
- Registry SHA-256: \`${registryHash}\`
- Evidence generated: ${generatedAt}
- Independent review: ${outcome.reviewStatus}

${verdict === 'FAIL'
    ? `The candidate does not satisfy Gate 0. Failed clauses: ${outcome.failedClauses.map(clause => clause.id).join(', ') || 'none'}. Repository-local blockers: ${outcome.repositoryBlockers.join(', ') || 'none'}.`
    : 'The code/test baseline satisfies the local deterministic Gate 0 clauses. Acceptance remains conditional until the bounded Opus review is evaluated.'}
The confirmed privacy compromise remains a separate operator-owned incident
and is not presented as nearly green.

## Gate clauses

| Clause | Result | Evidence |
|---|---|---|
${renderClauseRows(clauses)}

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| \`node scripts/validate-test-registry.js --json\` | ${registryValidation.exitCode} | \`${sha256(registryValidation.output)}\` |
| \`node scripts/validate-final-disposition.js --json\` | ${dispositionValidation.exitCode} | \`${sha256(dispositionValidation.output)}\` |

Registry report: ${registryValidation.report.runnablePrograms} programs,
${registryValidation.report.explicitSupportExclusions} exclusions, fingerprint
\`${registryValidation.report.fingerprint}\`, ${registryValidation.report.errors.length} errors.

Disposition report: ${dispositionReport.records} records,
${dispositionReport.errors.length} errors; dispositions
${formatCodeCounts(dispositionReport.dispositionCounts)}.

## Clean installation

Locked tokenized recipe, run twice with the same fresh isolated cache:

\`\`\`bash
${formatPortableInvocation(installLogs[0].execution.portableReplay)}
\`\`\`

| Run | Exit | Bytes | Log SHA-256 | Artifact |
|---|---:|---:|---|---|
${installLogs.map(log => `| ${log.kind} | ${log.exitCode} | ${log.bytes} | \`${log.sha256}\` | \`${log.path}\` |`).join('\n')}

The producer spawned both recipes without a shell and recorded exact argv,
allowlisted inherited environment keys, explicit isolated overrides, source
state before/after, exit status and log digest in its ignored provenance file.

## Deterministic registry

\`\`\`bash
${formatPortableInvocation(deterministicEvidence.execution.portableReplay)}
\`\`\`

- Exit: **${deterministicEvidence.exitCode}**
- Verdict: **${deterministicEvidence.verdict}**
- Status: \`${JSON.stringify(deterministicEvidence.statusCounts)}\`
- Report: \`${deterministicEvidence.report}\`
- Report SHA-256: \`${deterministicEvidence.reportSha256}\`
- Inventory: \`${deterministicEvidence.inventory}\`
- Inventory SHA-256: \`${deterministicEvidence.inventorySha256}\`
- Inventory fingerprint: \`${deterministicEvidence.inventoryFingerprint}\`
- Options fingerprint: \`${deterministicEvidence.optionsFingerprint}\`

The verdict is recomputed from all ${GATE0_DETERMINISTIC_COUNT} required T1/T2
result rows. Printed assertion totals cannot override suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
${pilotRows}

Exact orchestration commands:

${pilotCommands}

${pilotNarrative}

## Model-backed soak guard

- Locked replay: \`${formatPortableInvocation(soakEvidence.execution.portableReplay)}\`
- Exit: **${soakEvidence.exitCode}**
- Verdict: **${soakEvidence.verdict}**
- Named prerequisites: \`${soakEvidence.blockedBy.join(', ')}\`
- Report SHA-256: \`${soakEvidence.reportSha256}\`
- Inventory SHA-256: \`${soakEvidence.inventorySha256}\`

${soakNarrative}

## \`a7b90e3..ffd21cf\` disposition

- ${dispositionReport.records} records total
- Dispositions: ${formatCodeCounts(dispositionReport.dispositionCounts)}
- Terminals: ${formatCodeCounts(dispositionReport.terminalCounts)}
- Resolutions: ${formatCodeCounts(dispositionReport.resolutionCounts)}
- Repaired subjects: ${dispositionReport.repairedSubjectEvidence.validatedCount}/
  ${dispositionReport.repairedSubjectEvidence.recordCount}, digest
  \`${dispositionReport.repairedSubjectEvidence.recordsSha256}\`
- Validator errors: ${dispositionReport.errors.length}

The disputed commit was neither accepted wholesale nor reverted wholesale.

## Privacy incident and rotation inventory

- Incident: \`${privacy.incidentId}\`
- Status: **${privacy.status}**
- Current-tree tracked private paths removed: ${privacy.currentTreeContainment.trackedPathsRemoved}
- Affected Git objects remain reachable: ${privacy.history.affectedObjectsRemainReachable}
- History rewritten: ${privacy.history.historyRewritten}
- Personal content inspected: ${privacy.assessment.personalContentInspected}

Potentially compromised categories to rotate, without values:

${rotationRows}

## Remaining risks and blockers

- Independent review status: ${outcome.reviewStatus}.
- Repository-local Gate 0 blockers: ${outcome.repositoryBlockers.join(', ') || 'none'}.
- Review-required risks: ${riskAssessment.reviewRequiredRisks.join(', ') || 'none'}.
- Later-gate risks: ${riskAssessment.laterGateRisks.join(', ') || 'none'}.
- Separate incidents: ${riskAssessment.separateIncidents.join(', ') || 'none'}.
- Public-history remediation, repository visibility, and credential rotation
  remain operator decisions.
- ${stateCounts.KNOWN_DEFECTIVE || 0} recovered E2E suites retain known false-green
  assertions and are not counted green.
- ${stateCounts.BLOCKED || 0} registry rows remain explicitly \`BLOCKED\` on named
  prerequisites.
- Registry discovery covers every supported program-language file independent
  of its filename; ${explicitSupportExclusions} support/aggregate files are
  explicit reasoned exclusions.
- Runtime database access now requires an explicit non-empty \`C3_DB_PATH\`;
  authoritative registry runs bind a distinct isolated path (\`G0-R012\`).
- All current direct-run temp creators use the private bootstrap-owned runtime
  boundary; the former shared-\`/tmp\` convention is closed (\`G0-R014\`).

## Recommended next step

${verdict === 'FAIL'
    ? 'Repair the failed local evidence or repository blocker, then repeat the clean candidate run and regenerate this report.'
    : 'Perform the bounded Opus 5 read-only review, evaluate every finding against the candidate and evidence, then ask the operator whether Gate 0 may be accepted. Do not begin the next gate from this conditional checkpoint.'}
`;
}

function renderReviewPacket({
  candidateSha,
  registryHash,
  reviewRange,
  reviewCommits,
  reviewDiffStat,
  installLogs,
  deterministicEvidence,
  pilotEvidence,
  soakEvidence,
  stateCounts,
  clauses,
  outcome,
  riskAssessment,
  dispositionReport,
}) {
  return `# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: \`${candidateSha}\`
- Registry SHA-256: \`${registryHash}\`
- Focus range: \`${reviewRange}\`
- Role: read-only reviewer; do not modify the branch

The earlier large E2E reconstruction is represented by the current
${dispositionReport.records}-row
disposition report (clause
${clauses.find(clause => clause.id === 'G0-C2')?.result || 'FAIL'}) and registry
evidence. This bounded packet focuses on the final test-trust repairs and
verdict machinery.

- Derived verdict: **${outcome.verdict}**
- Independent review status: **${outcome.reviewStatus}**
- Repository-local blockers: ${outcome.repositoryBlockers.join(', ') || 'none'}
- Review-required risks: ${riskAssessment.reviewRequiredRisks.join(', ') || 'none'}
- Later-gate risks: ${riskAssessment.laterGateRisks.join(', ') || 'none'}
- Separate incidents: ${riskAssessment.separateIncidents.join(', ') || 'none'}

| Clause | Result | Evidence |
|---|---|---|
${renderClauseRows(clauses)}

## Commits

${reviewCommits.map(line => {
    const [sha, ...subject] = line.split('\t');
    return `- \`${sha}\` ${subject.join('\t')}`;
  }).join('\n')}

## Diffstat

\`\`\`text
${reviewDiffStat}
\`\`\`

## Invariants

- Do not weaken A9 or production score thresholds.
- No source/test run may touch operator \`data/c3.db\`.
- \`KNOWN_DEFECTIVE\` and \`BLOCKED\` suites never count green.
- Audit child exits, log hashes, source SHA, cleanup, and clean-tree evidence
  determine the verdict; printed assertion totals do not.
- PDF tests use the isolated locked interpreter.
- No history rewrite, force push, merge, tag, release, credential rotation, or
  user-data deletion occurred.

## Verification

- Deterministic registry: ${deterministicEvidence.verdict}, exit
  ${deterministicEvidence.exitCode}, status
  \`${JSON.stringify(deterministicEvidence.statusCounts)}\`, report SHA
  \`${deterministicEvidence.reportSha256}\`; locked replay
  \`${formatPortableInvocation(deterministicEvidence.execution.portableReplay)}\`.
- Pilot A9: five consecutive structured reports:
${pilotEvidence.map(item => (
    `  - \`${item.runId}\`: ${item.verdict}/exit ${item.exitCode}; report \`${item.reportSha256}\`; replay \`${formatPortableInvocation(item.execution.portableReplay)}\``
  )).join('\n')}
- Soak requirement guard: ${soakEvidence.verdict}, exit
  ${soakEvidence.exitCode}, prerequisites \`${soakEvidence.blockedBy.join(', ')}\`;
  replay \`${formatPortableInvocation(soakEvidence.execution.portableReplay)}\`.
- Registry and disposition validator exits: ${clauses.find(clause => clause.id === 'G0-C3')?.result === 'PASS' ? 0 : 1} and ${clauses.find(clause => clause.id === 'G0-C2')?.result === 'PASS' ? 0 : 1}.
- Clean install exits: ${installLogs.map(log => `${log.kind}=${log.exitCode}`).join(', ')};
  replay \`${formatPortableInvocation(installLogs[0].execution.portableReplay)}\`.
- Disposition: ${dispositionReport.records} rows; terminals
  ${formatCodeCounts(dispositionReport.terminalCounts)}; repaired subjects
  ${dispositionReport.repairedSubjectEvidence.validatedCount}/
  ${dispositionReport.repairedSubjectEvidence.recordCount}, digest
  \`${dispositionReport.repairedSubjectEvidence.recordsSha256}\`.

## Known risks

- Registry discovery is extension-based and every support/aggregate file is an
  explicit reasoned exclusion.
- Runtime DB access fails closed without an explicit \`C3_DB_PATH\`, and the
  authoritative runner supplies isolated DB paths (\`G0-R012\`).
- ${stateCounts.KNOWN_DEFECTIVE || 0} recovered E2E suites remain
  \`KNOWN_DEFECTIVE\`; ${stateCounts.BLOCKED || 0} remain registry-\`BLOCKED\`.
- Privacy history remains reachable and credential rotation is pending.
- Repository-local Gate 0 blockers: ${outcome.repositoryBlockers.join(', ') || 'none'}.
- Gate-impact policy: ${riskAssessment.valid ? 'valid' : 'invalid'}; ${riskAssessment.riskCount}
  risk rows and ${riskAssessment.policyCount} policy entries.

## Questions

1. Did any final repair weaken a mandatory assertion or conceal a failure?
2. Can a suite escape the isolated HOME/temp/DB/artifact boundaries?
3. Is the registry fingerprint/count pin updated everywhere it is enforced?
4. Does the A9 fixture repair reflect the documented low-ceremony case without
   changing production scoring behavior?
5. Are any blocked/model/soak programs still misclassified as deterministic?
6. Is the candidate/attestation split sufficient to make the evidence
   reproducible without a self-referential commit claim?
7. Should the remaining \`G0-R012\` database import side effect prevent
   operator acceptance of Gate 0 despite runner-level isolation?

Report security gaps, regressions, false-green behavior, missing evidence, or
scope expansion. Do not approve based on narrative alone; follow the hashes and
commands in \`GATE0-BASELINE-REPORT.md\`.
`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function hashFile(filePath) {
  return sha256(await readFile(filePath));
}

function formatCounts(counts) {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name}=${count}`)
    .join(', ');
}

function formatCodeCounts(counts) {
  const entries = Object.entries(counts || {});
  return entries.length === 0
    ? 'none'
    : entries.map(([name, count]) => `\`${name}\` ${count}`).join(', ');
}

function renderClauseRows(clauses) {
  return clauses
    .map(clause => (
      `| ${tableCell(`${clause.id} ${clause.label}`)} | ${clause.result} | ${tableCell(clause.evidence)} |`
    ))
    .join('\n');
}

function tableCell(value) {
  return String(value).replace(/\r?\n/g, ' ').replaceAll('|', '\\|');
}

export function formatPortableInvocation(invocation) {
  if (
    invocation?.cwd !== '$PWD'
    || typeof invocation.executable !== 'string'
    || !Array.isArray(invocation.argv)
    || !Array.isArray(invocation.inheritedEnvironmentKeys)
    || invocation.environmentOverrides === null
    || typeof invocation.environmentOverrides !== 'object'
  ) {
    throw new Error('portable invocation has an invalid shape');
  }
  const inheritedEnvironment = invocation.inheritedEnvironmentKeys
    .map(key => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        throw new Error('portable invocation contains an unsafe environment key');
      }
      return `${key}="\${${key}-}"`;
    });
  const environment = Object.entries(invocation.environmentOverrides)
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error('portable invocation contains an unsafe environment override key');
      }
      return `${key}=${shellToken(value)}`;
    });
  return [
    'env',
    '-i',
    ...inheritedEnvironment,
    ...environment,
    shellToken(invocation.executable),
    ...invocation.argv.map(shellToken),
  ].join(' ');
}

function shellToken(value) {
  const text = String(value);
  if (text === '$PWD' || text.startsWith('$PWD/')) {
    return `"\${PWD}${text.slice(4).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
  if (/^[A-Za-z0-9_./,:=@%+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\"'\"'")}'`;
}

export async function writeGate0OutputAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o644 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw new AggregateError(
          [error, cleanupError],
          `generated output cleanup failed: ${filePath}`,
        );
      }
    }
    throw error;
  }
  const metadata = await stat(filePath);
  requireEvidence(metadata.isFile(), `generated output is not a file: ${filePath}`);
}

function requireEvidence(condition, message) {
  if (!condition) throw new Error(`Gate 0 evidence validation failed: ${message}`);
}
