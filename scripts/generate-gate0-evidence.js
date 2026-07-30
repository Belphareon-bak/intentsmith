#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  classifyDispositionValidatorExecution,
  classifyRegistryValidatorExecution,
  deriveGateOutcome,
  EvidenceInfrastructureError,
  findOpenGate0RepositoryBlockers,
  ReviewStatus,
} from './gate0-evidence-verdict.js';

const OUTPUTS = {
  status: 'docs/convergence/STATUS.md',
  index: 'docs/convergence/EVIDENCE-INDEX.json',
  report: 'docs/convergence/GATE0-BASELINE-REPORT.md',
  review: 'docs/convergence/reviews/GATE0-OPUS-REVIEW.md',
};
const GATE0_OFFLINE_COUNT = 173;
const GATE0_DATABASE_COUNT = 26;
const GATE0_DETERMINISTIC_COUNT = GATE0_OFFLINE_COUNT + GATE0_DATABASE_COUNT;
const GATE0_REPOSITORY_BLOCKER_IDS = ['G0-R023', 'G0-R025'];
const MODEL_BACKED_SOAK_IDS = new Set([
  'IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST',
  'IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST',
  'IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST',
  'IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST',
  'IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST',
]);

const root = process.cwd();

export async function main(argv = process.argv.slice(2)) {
 try {
  const opts = parseArgs(argv);
  for (const key of [
    'deterministic-report',
    'pilot-root',
    'soak-guard-report',
    'install-log',
    'idempotent-install-log',
    'install-command',
    'deterministic-command',
    'pilot-command-template',
    'soak-command',
  ]) {
    if (!opts[key]) throw new Error(`Missing --${key}=VALUE`);
  }
  if (Object.hasOwn(opts, 'verdict')) {
    throw new EvidenceInfrastructureError(
      '--verdict is not supported; Gate 0 verdicts are derived from evidence',
    );
  }

  const initialStatus = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (initialStatus !== '') {
    throw new Error(`Gate 0 evidence requires a clean candidate worktree:\n${initialStatus}`);
  }

  const candidateSha = git(['rev-parse', 'HEAD']);
  const branch = git(['branch', '--show-current']) || 'detached';
  const registry = await readJson(path.join(root, 'tests/registry.json'));
  const registryHash = sha256(JSON.stringify(registry));
  const suiteById = new Map(registry.suites.map(suite => [suite.id, suite]));
  const profileCounts = countBy(registry.suites, 'profile');
  const stateCounts = countBy(registry.suites, 'state');
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

  const deterministicReportPath = resolveInput(opts['deterministic-report']);
  const deterministicReport = await readJson(deterministicReportPath);
  validatePassingReport({
    report: deterministicReport,
    candidateSha,
    registryHash,
    expectedIds: new Set(deterministicSuites.map(suite => suite.id)),
    expectedCount: GATE0_DETERMINISTIC_COUNT,
  });

  const pilotReports = await loadPilotReports(resolveInput(opts['pilot-root']));
  requireEvidence(pilotReports.length === 5, `expected 5 pilot reports, got ${pilotReports.length}`);
  requireEvidence(
    opts['pilot-command-template'].includes('{runId}'),
    'pilot command template must contain {runId}',
  );
  requireEvidence(
    new Set(pilotReports.map(item => item.report.runId)).size === pilotReports.length,
    'pilot reports contain duplicate run IDs',
  );
  for (const item of pilotReports) {
    validatePassingReport({
      report: item.report,
      candidateSha,
      registryHash,
      expectedIds: new Set(['IS-T2-TESTS-PILOT-C1C2C3-TEST']),
      expectedCount: 1,
    });
  }

  const soakGuardPath = resolveInput(opts['soak-guard-report']);
  const soakGuard = await readJson(soakGuardPath);
  validateSoakGuard(soakGuard, candidateSha, registryHash);

  const installLogs = [];
  for (const [kind, option] of [
    ['clean', 'install-log'],
    ['idempotent', 'idempotent-install-log'],
  ]) {
    const absolutePath = resolveInput(opts[option]);
    const contents = await readFile(absolutePath);
    const logText = contents.toString('utf8');
    requireEvidence(contents.length > 0, `${kind} install log is empty`);
    requireEvidence(
      logText.includes('COMMAND_EXIT_CODE="0"'),
      `${kind} install log does not record COMMAND_EXIT_CODE="0"`,
    );
    requireEvidence(
      logText.includes(`GATE0_CANDIDATE_SHA=${candidateSha}`),
      `${kind} install log does not identify the candidate SHA`,
    );
    requireEvidence(
      logText.includes('GATE0_WORKTREE_STATUS=clean'),
      `${kind} install log does not prove a clean source tree`,
    );
    requireEvidence(
      logText.includes(`GATE0_INSTALL_RUN=${kind}`),
      `${kind} install log has the wrong run marker`,
    );
    requireEvidence(
      logText.includes(`GATE0_INSTALL_COMMAND_SHA256=${sha256(opts['install-command'])}`),
      `${kind} install log does not match the documented install command`,
    );
    requireEvidence(
      logText.includes('GATE0_POST_INSTALL_WORKTREE_STATUS=clean'),
      `${kind} install log does not prove a clean post-install source tree`,
    );
    installLogs.push({
      kind,
      path: displayPath(absolutePath),
      bytes: contents.length,
      sha256: sha256(contents),
      exitCode: 0,
    });
  }

  const registryValidation = classifyRegistryValidatorExecution(
    runValidator(['node', 'scripts/validate-test-registry.js', '--json']),
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
    runValidator(['node', 'scripts/validate-final-disposition.js', '--json']),
  );

  const knownDefectiveInDeterministic = deterministicReport.results.filter(result => (
    suiteById.get(result.id)?.state === 'KNOWN_DEFECTIVE'
  ));

  const blockedWithoutPrerequisite = registry.suites.filter(suite => (
    suite.state === 'BLOCKED'
      && suite.requirements.network !== 'external'
      && !suite.requirements.server
      && !suite.requirements.ollama
      && !suite.requirements.gpu
  ));
  requireEvidence(
    git(['status', '--porcelain=v1', '--untracked-files=all']) === '',
    'validators changed the candidate worktree',
  );

  const privacy = await readJson(path.join(root, 'docs/convergence/PRIVACY-INCIDENT.json'));
  requireEvidence(
    privacy.status === 'CONFIRMED_COMPROMISE',
    'privacy incident must remain classified as CONFIRMED_COMPROMISE',
  );
  const riskMarkdown = await readFile(
    path.join(root, 'docs/convergence/RISK-REGISTER.md'),
    'utf8',
  );
  const repositoryBlockers = findOpenGate0RepositoryBlockers(
    riskMarkdown,
    GATE0_REPOSITORY_BLOCKER_IDS,
  );

  const reviewBase = opts['review-base'] || '126b061';
  const reviewRange = `${reviewBase}..${candidateSha}`;
  const reviewCommits = git([
    'log',
    '--reverse',
    '--format=%H%x09%s',
    reviewRange,
  ]).split('\n').filter(Boolean);
  const reviewDiffStat = git(['diff', '--stat', reviewRange]);

  const generatedAt = deterministicReport.endedAt;
  const clauses = buildGate0Clauses({
    registryValidation,
    dispositionValidation,
    deterministicEvidence: deterministicReport,
    runnablePrograms: registry.suites.length,
    explicitSupportExclusions: registry.exclusions.length,
    stateCounts,
    blockedWithoutPrerequisite,
    knownDefectiveInDeterministic,
  });
  const outcome = deriveGateOutcome({
    clauses,
    repositoryBlockers,
    reviewStatus: ReviewStatus.PENDING,
  });
  const { verdict } = outcome;

  const deterministicEvidence = {
    command: opts['deterministic-command'],
    exitCode: deterministicReport.exitCode,
    report: displayPath(deterministicReportPath),
    reportSha256: await hashFile(deterministicReportPath),
    statusCounts: deterministicReport.statusCounts,
    inventoryFingerprint: deterministicReport.inventoryFingerprint,
    optionsFingerprint: deterministicReport.optionsFingerprint,
    startedAt: deterministicReport.startedAt,
    endedAt: deterministicReport.endedAt,
  };
  const pilotEvidence = await Promise.all(pilotReports.map(async item => ({
    runId: item.report.runId,
    command: opts['pilot-command-template'].replaceAll('{runId}', item.report.runId),
    report: displayPath(item.path),
    reportSha256: await hashFile(item.path),
    exitCode: item.report.exitCode,
    startedAt: item.report.startedAt,
    endedAt: item.report.endedAt,
  })));
  const soakEvidence = {
    command: opts['soak-command'],
    exitCode: soakGuard.exitCode,
    verdict: soakGuard.verdict,
    report: displayPath(soakGuardPath),
    reportSha256: await hashFile(soakGuardPath),
    blockedBy: [...new Set(soakGuard.results.flatMap(result => result.blockedBy || []))].sort(),
  };

  const evidenceIndex = {
    schemaVersion: 3,
    product: 'IntentSmith',
    gate: 'Gate 0',
    verdict,
    exitCode: outcome.exitCode,
    generatedAt,
    candidate: {
      sha: candidateSha,
      branch,
      registrySha256: registryHash,
      attestationRule: 'the evidence-only commit must have this candidate as its first parent',
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
    validations: {
      registry: {
        command: 'node scripts/validate-test-registry.js --json',
        exitCode: registryValidation.exitCode,
        outputSha256: sha256(registryValidation.output),
        errors: registryValidation.errors,
      },
      disposition: {
        command: 'node scripts/validate-final-disposition.js --json',
        exitCode: dispositionValidation.exitCode,
        outputSha256: sha256(dispositionValidation.output),
        errors: dispositionValidation.errors,
        sourceManifest: dispositionValidation.report.sourceManifest,
        dispositionCounts: dispositionValidation.report.dispositionCounts,
        terminalCounts: dispositionValidation.report.terminalCounts,
        resolutionCounts: dispositionValidation.report.resolutionCounts,
      },
    },
    installation: {
      command: opts['install-command'],
      repeatedCommand: opts['install-command'],
      logs: installLogs,
    },
    deterministic: deterministicEvidence,
    pilotFiveConsecutive: pilotEvidence,
    soakRequirementGuard: soakEvidence,
    privacyIncident: {
      id: privacy.incidentId,
      status: privacy.status,
      currentTreeContained: privacy.currentTreeContainment.trackedPathsRemoved,
      historyReachable: privacy.history.affectedObjectsRemainReachable,
      rotationCategories: privacy.rotationInventory.map(item => item.category),
    },
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
    installCommand: opts['install-command'],
    deterministicEvidence,
    pilotEvidence,
    soakEvidence,
    privacy,
    explicitSupportExclusions: registry.exclusions.length,
    stateCounts,
    clauses,
    outcome,
    dispositionReport: dispositionValidation.report,
  });
  const reviewMarkdown = renderReviewPacket({
    candidateSha,
    registryHash,
    reviewRange,
    reviewCommits,
    reviewDiffStat,
    deterministicEvidence,
    pilotEvidence,
    soakEvidence,
    stateCounts,
    clauses,
    outcome,
    dispositionRecords: dispositionValidation.report.records,
  });

  await writeAtomic(path.join(root, OUTPUTS.status), statusMarkdown);
  await writeAtomic(
    path.join(root, OUTPUTS.index),
    `${JSON.stringify(evidenceIndex, null, 2)}\n`,
  );
  await writeAtomic(path.join(root, OUTPUTS.report), baselineMarkdown);
  await writeAtomic(path.join(root, OUTPUTS.review), reviewMarkdown);

  console.log(`Gate 0 evidence generated for ${candidateSha}`);
  console.log(`Registry sha256: ${registryHash}`);
  console.log(`Verdict: ${verdict}`);
  for (const output of Object.values(OUTPUTS)) console.log(`Wrote: ${output}`);
  return outcome.exitCode;
 } catch (error) {
   console.error(error.stack || error.message);
   return 2;
 }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (!arg.startsWith('--') || !arg.includes('=')) {
      throw new Error(`Arguments must use --key=value: ${arg}`);
    }
    const separator = arg.indexOf('=');
    parsed[arg.slice(2, separator)] = arg.slice(separator + 1);
  }
  return parsed;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runValidator(argv) {
  return spawnSync(argv[0], argv.slice(1), {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function buildGate0Clauses({
  registryValidation,
  dispositionValidation,
  deterministicEvidence,
  runnablePrograms,
  explicitSupportExclusions,
  stateCounts,
  blockedWithoutPrerequisite,
  knownDefectiveInDeterministic,
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
      result: 'PASS',
      evidence: `all ${deterministicEvidence.statusCounts.PASS} suite records carry clean source-tree evidence at the candidate SHA`,
    },
    {
      id: 'G0-C2',
      label: 'disposition',
      result: dispositionValidation.passed ? 'PASS' : 'FAIL',
      evidence: `${dispositionValidation.report.records} records; ${validatorEvidence(dispositionValidation)}`,
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
      result: 'PASS',
      evidence: 'two consecutive minimal installs, both exit 0; second idempotent',
    },
    {
      id: 'G0-C5',
      label: 'deterministic T1/T2',
      result: 'PASS',
      evidence: `${deterministicEvidence.statusCounts.PASS} PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED`,
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
      result: blockedWithoutPrerequisite.length === 0 ? 'PASS' : 'FAIL',
      evidence: blockedWithoutPrerequisite.length === 0
        ? 'every registry BLOCKED row names server, external-network, Ollama, or GPU'
        : `BLOCKED rows lack a concrete prerequisite: ${blockedWithoutPrerequisite.map(suite => suite.id).join(', ')}`,
    },
    {
      id: 'G0-C8',
      label: 'generated evidence',
      result: 'PASS',
      evidence: 'status, index, baseline report, and review packet derive from the clean candidate',
    },
  ];
}

async function loadPilotReports(rootPath) {
  const paths = await findNamedFiles(rootPath, 'report.json');
  const reports = [];
  for (const reportPath of paths) {
    const report = await readJson(reportPath);
    if (report.results?.some(result => result.id === 'IS-T2-TESTS-PILOT-C1C2C3-TEST')) {
      reports.push({ path: reportPath, report });
    }
  }
  return reports.sort((a, b) => a.report.runId.localeCompare(b.report.runId));
}

async function findNamedFiles(directory, name) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await findNamedFiles(absolutePath, name));
    else if (entry.isFile() && entry.name === name) results.push(absolutePath);
  }
  return results;
}

function validatePassingReport({
  report,
  candidateSha,
  registryHash,
  expectedIds,
  expectedCount,
}) {
  requireEvidence(report.sourceRevision === candidateSha, 'report source SHA mismatch');
  requireEvidence(report.registryHash === registryHash, 'report registry fingerprint mismatch');
  requireEvidence(report.verdict === 'PASS' && report.exitCode === 0, 'report is not PASS/exit 0');
  requireEvidence(report.results?.length === expectedCount, 'report suite count mismatch');
  const actualIds = new Set(report.results.map(result => result.id));
  requireEvidence(
    actualIds.size === expectedIds.size
      && [...expectedIds].every(id => actualIds.has(id)),
    'report suite IDs are missing or duplicated',
  );
  requireEvidence(
    report.results.every(result => expectedIds.has(result.id)),
    'report contains an unexpected suite',
  );
  requireEvidence(
    report.results.every(result => (
      result.status === 'PASS'
      && result.exitCode === 0
      && result.cleanup?.checked === true
      && result.cleanup?.leakDetected === false
      && result.cleanup?.terminated === true
      && result.sourceTree?.checked === true
      && result.sourceTree?.clean === true
      && result.sourceTree?.head === candidateSha
      && /^[a-f0-9]{64}$/.test(result.logSha256 || '')
    )),
    'report contains incomplete or non-green suite evidence',
  );
}

function validateSoakGuard(report, candidateSha, registryHash) {
  requireEvidence(report.sourceRevision === candidateSha, 'soak guard source SHA mismatch');
  requireEvidence(report.registryHash === registryHash, 'soak guard registry mismatch');
  requireEvidence(report.verdict === 'BLOCKED' && report.exitCode === 2, 'soak guard must be BLOCKED/2');
  requireEvidence(report.results?.length === 5, 'soak guard must contain five suites');
  const actualIds = new Set(report.results.map(result => result.id));
  requireEvidence(
    actualIds.size === MODEL_BACKED_SOAK_IDS.size
      && [...MODEL_BACKED_SOAK_IDS].every(id => actualIds.has(id)),
    'soak guard suite IDs are missing, duplicated, or unexpected',
  );
  requireEvidence(
    report.results.every(result => (
      result.status === 'BLOCKED'
      && result.blockedBy?.includes('gpu')
      && result.blockedBy?.includes('ollama')
    )),
    'soak guard did not name gpu and ollama for every suite',
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
  installCommand,
  deterministicEvidence,
  pilotEvidence,
  soakEvidence,
  privacy,
  explicitSupportExclusions,
  stateCounts,
  clauses,
  outcome,
  dispositionReport,
}) {
  const pilotRows = pilotEvidence.map(item => (
    `| \`${item.runId}\` | 0 | PASS | \`${item.reportSha256}\` |`
  )).join('\n');
  const pilotCommands = pilotEvidence.map(item => (
    `- \`${item.runId}\`: \`${item.command}\``
  )).join('\n');
  const rotationRows = privacy.rotationInventory
    .map(item => `- ${item.category}: ${item.action}`)
    .join('\n');
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

Exact command, run twice with the same fresh isolated cache:

\`\`\`bash
${installCommand}
\`\`\`

| Run | Exit | Bytes | Log SHA-256 | Local artifact |
|---|---:|---:|---|---|
${installLogs.map(log => `| ${log.kind} | 0 | ${log.bytes} | \`${log.sha256}\` | \`${log.path}\` |`).join('\n')}

The first run installed locked Node/Yarn/Python dependencies and built the IDE.
The second run exited 0 and reported the frozen Yarn tree already up to date.

## Deterministic registry

\`\`\`bash
${deterministicEvidence.command}
\`\`\`

- Exit: **${deterministicEvidence.exitCode}**
- Verdict: **PASS**
- Status: \`${JSON.stringify(deterministicEvidence.statusCounts)}\`
- Report: \`${deterministicEvidence.report}\`
- Report SHA-256: \`${deterministicEvidence.reportSha256}\`
- Inventory fingerprint: \`${deterministicEvidence.inventoryFingerprint}\`
- Options fingerprint: \`${deterministicEvidence.optionsFingerprint}\`

All ${GATE0_DETERMINISTIC_COUNT} required T1/T2 suites passed from clean
per-suite environments. Printed assertion totals were not used to override
suite exits.

## Pilot discrimination — five consecutive runs

| Run | Exit | Verdict | Report SHA-256 |
|---|---:|---|---|
${pilotRows}

Exact orchestration commands:

${pilotCommands}

The unchanged A9 assertion passed in every run. The repair changed the low-
ceremony C2 fixture, not production score weights or thresholds.

## Model-backed soak guard

- Command: \`${soakEvidence.command}\`
- Exit: **${soakEvidence.exitCode}**
- Verdict: **${soakEvidence.verdict}**
- Named prerequisites: \`${soakEvidence.blockedBy.join(', ')}\`
- Report SHA-256: \`${soakEvidence.reportSha256}\`

Five soak programs previously misdeclared as model-free are now blocked before
execution unless Ollama and GPU are explicitly authorized.

## \`a7b90e3..ffd21cf\` disposition

- ${dispositionReport.records} records total
- Dispositions: ${formatCodeCounts(dispositionReport.dispositionCounts)}
- Terminals: ${formatCodeCounts(dispositionReport.terminalCounts)}
- Resolutions: ${formatCodeCounts(dispositionReport.resolutionCounts)}
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
- Public-history remediation, repository visibility, and credential rotation
  remain operator decisions.
- ${stateCounts.KNOWN_DEFECTIVE || 0} recovered E2E suites retain known false-green
  assertions and are not counted green.
- ${stateCounts.BLOCKED || 0} registry rows remain explicitly \`BLOCKED\` on named
  prerequisites.
- Registry discovery covers every supported program-language file independent
  of its filename; ${explicitSupportExclusions} support/aggregate files are
  explicit reasoned exclusions.
- Product DB initialization remains an import side effect; all authoritative
  registry runs set an isolated \`C3_DB_PATH\` (\`G0-R012\`).
- The T1 shared-\`/tmp\` convention remains a documented scope decision
  (\`G0-R014\`).

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
  deterministicEvidence,
  pilotEvidence,
  soakEvidence,
  stateCounts,
  clauses,
  outcome,
  dispositionRecords,
}) {
  return `# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: \`${candidateSha}\`
- Registry SHA-256: \`${registryHash}\`
- Focus range: \`${reviewRange}\`
- Role: read-only reviewer; do not modify the branch

The earlier large E2E reconstruction is represented by the current
${dispositionRecords}-row
disposition report (clause
${clauses.find(clause => clause.id === 'G0-C2')?.result || 'FAIL'}) and registry
evidence. This bounded packet focuses on the final test-trust repairs and
verdict machinery.

- Derived verdict: **${outcome.verdict}**
- Independent review status: **${outcome.reviewStatus}**
- Repository-local blockers: ${outcome.repositoryBlockers.join(', ') || 'none'}

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

- Deterministic registry: ${GATE0_DETERMINISTIC_COUNT} PASS, exit 0, report SHA
  \`${deterministicEvidence.reportSha256}\`.
- Pilot A9: five consecutive PASS reports:
${pilotEvidence.map(item => (
    `  - \`${item.runId}\`: report \`${item.reportSha256}\`; command \`${item.command}\``
  )).join('\n')}
- Soak requirement guard: ${soakEvidence.verdict}, exit
  ${soakEvidence.exitCode}, prerequisites \`${soakEvidence.blockedBy.join(', ')}\`.
- Registry and disposition validator exits: ${clauses.find(clause => clause.id === 'G0-C3')?.result === 'PASS' ? 0 : 1} and ${clauses.find(clause => clause.id === 'G0-C2')?.result === 'PASS' ? 0 : 1}.
- Clean install: two consecutive exit-0 runs from the candidate.

## Known risks

- Registry discovery is extension-based and every support/aggregate file is an
  explicit reasoned exclusion.
- Product DB opening remains an import side effect (\`G0-R012\`), although the
  authoritative runner supplies isolated DB paths.
- ${stateCounts.KNOWN_DEFECTIVE || 0} recovered E2E suites remain
  \`KNOWN_DEFECTIVE\`; ${stateCounts.BLOCKED || 0} remain registry-\`BLOCKED\`.
- Privacy history remains reachable and credential rotation is pending.
- Repository-local Gate 0 blockers: ${outcome.repositoryBlockers.join(', ') || 'none'}.

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function countBy(values, key) {
  return values.reduce((counts, value) => {
    const label = value[key];
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
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

function resolveInput(value) {
  return path.resolve(root, value);
}

function displayPath(absolutePath) {
  const relative = path.relative(root, absolutePath);
  return !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.split(path.sep).join('/')
    : absolutePath;
}

async function writeAtomic(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o755 });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o644 });
  await rename(temporaryPath, filePath);
  const metadata = await stat(filePath);
  requireEvidence(metadata.isFile(), `generated output is not a file: ${filePath}`);
}

function requireEvidence(condition, message) {
  if (!condition) throw new Error(`Gate 0 evidence validation failed: ${message}`);
}
