#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
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

const OUTPUTS = {
  status: 'docs/convergence/STATUS.md',
  index: 'docs/convergence/EVIDENCE-INDEX.json',
  report: 'docs/convergence/GATE0-BASELINE-REPORT.md',
  review: 'docs/convergence/reviews/GATE0-OPUS-REVIEW.md',
};
const GATE0_OFFLINE_COUNT = 173;
const GATE0_DATABASE_COUNT = 26;
const GATE0_DETERMINISTIC_COUNT = GATE0_OFFLINE_COUNT + GATE0_DATABASE_COUNT;
const MODEL_BACKED_SOAK_IDS = new Set([
  'IS-T5-TESTS-SOAK-ATTACHMENT-HEAVY-TEST',
  'IS-T5-TESTS-SOAK-BREAK-PATTERN-PROBE-TEST',
  'IS-T5-TESTS-SOAK-FOLLOWUP-LOAD-TEST',
  'IS-T5-TESTS-SOAK-MIXED-SESSION-SIMULATION-TEST',
  'IS-T5-TESTS-SOAK-SHORT-INPUT-STRESS-TEST',
]);

const opts = parseArgs(process.argv.slice(2));
const root = process.cwd();

try {
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

  const registryValidation = runChecked(
    ['node', 'scripts/validate-test-registry.js'],
    'registry validation',
  );
  requireEvidence(
    registryValidation.stdout.includes(registryHash),
    'registry validator output does not contain the candidate fingerprint',
  );
  const dispositionValidation = runChecked(
    ['node', 'scripts/validate-final-disposition.js'],
    'disposition validation',
  );

  const knownDefectiveInDeterministic = deterministicReport.results.filter(result => (
    suiteById.get(result.id)?.state === 'KNOWN_DEFECTIVE'
  ));
  requireEvidence(
    knownDefectiveInDeterministic.length === 0,
    'KNOWN_DEFECTIVE result was counted in deterministic evidence',
  );

  const blockedWithoutPrerequisite = registry.suites.filter(suite => (
    suite.state === 'BLOCKED'
      && suite.requirements.network !== 'external'
      && !suite.requirements.server
      && !suite.requirements.ollama
      && !suite.requirements.gpu
  ));
  requireEvidence(
    blockedWithoutPrerequisite.length === 0,
    `BLOCKED registry rows lack a concrete prerequisite: ${
      blockedWithoutPrerequisite.map(suite => suite.id).join(', ')
    }`,
  );

  requireEvidence(
    git(['status', '--porcelain=v1', '--untracked-files=all']) === '',
    'validators changed the candidate worktree',
  );

  const privacy = await readJson(path.join(root, 'docs/convergence/PRIVACY-INCIDENT.json'));
  requireEvidence(
    privacy.status === 'CONFIRMED_COMPROMISE',
    'privacy incident must remain classified as CONFIRMED_COMPROMISE',
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
  const verdict = opts.verdict || 'CONDITIONAL PASS';
  if (!['PASS', 'CONDITIONAL PASS', 'FAIL'].includes(verdict)) {
    throw new Error(`Unsupported --verdict=${verdict}`);
  }
  requireEvidence(
    verdict !== 'PASS',
    'PASS is unavailable while the generated review status is PENDING',
  );

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
    schemaVersion: 2,
    product: 'IntentSmith',
    gate: 'Gate 0',
    verdict,
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
      localValidationCandidate: 'b0d28bbfd9d4ed55e19a72719ad5e9b776b96c12',
    },
    inventory: {
      runnablePrograms: registry.suites.length,
      explicitSupportExclusions: registry.exclusions.length,
      profileCounts,
      stateCounts,
      deterministicRequired: deterministicSuites.length,
      dispositionRecords: 225,
    },
    validations: {
      registry: {
        command: 'node scripts/validate-test-registry.js',
        exitCode: registryValidation.exitCode,
        outputSha256: sha256(registryValidation.output),
      },
      disposition: {
        command: 'node scripts/validate-final-disposition.js',
        exitCode: dispositionValidation.exitCode,
        outputSha256: sha256(dispositionValidation.output),
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
      independentReviewStatus: 'PENDING',
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
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
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

function runChecked(argv, label) {
  try {
    const stdout = execFileSync(argv[0], argv.slice(1), {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '', output: stdout };
  } catch (error) {
    const stdout = String(error.stdout || '');
    const stderr = String(error.stderr || '');
    throw new Error(`${label} failed with exit ${error.status}\n${stdout}${stderr}`);
  }
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

function renderStatus({
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
| G0-C1 clean candidate | PASS | all ${deterministicEvidence.statusCounts.PASS} suite records carry clean source-tree evidence at the candidate SHA |
| G0-C2 disposition | PASS | 225 records; validator exit 0 |
| G0-C3 registry | PASS | ${runnablePrograms} runnable programs and ${explicitSupportExclusions} explicit support exclusions; validator exit 0 |
| G0-C4 clean install | PASS | two consecutive minimal installs, both exit 0; second idempotent |
| G0-C5 deterministic T1/T2 | PASS | ${deterministicEvidence.statusCounts.PASS} PASS, 0 FAIL/TIMEOUT/BLOCKED/SKIPPED |
| G0-C6 defective suites excluded | PASS | ${stateCounts.KNOWN_DEFECTIVE} rows remain \`KNOWN_DEFECTIVE\`; none appears in green deterministic evidence |
| G0-C7 blockers specific | PASS | every registry \`BLOCKED\` row names server, external-network, Ollama, or GPU |
| G0-C8 generated evidence | PASS | this file, the index, baseline report, and review packet were generated from the candidate |

## Registry

- Profiles: ${formatCounts(profileCounts)}
- States: ${formatCounts(stateCounts)}
- Deterministic required scope: ${GATE0_DETERMINISTIC_COUNT} (offline=${GATE0_OFFLINE_COUNT}, database=${GATE0_DATABASE_COUNT})

## Remaining boundaries

- Independent Opus review: **PENDING**. This is why the verdict is conditional.
- Confirmed privacy compromise: **${privacy.status}**.
- Current-tree private material is contained; affected history remains reachable.
- Credential rotation and history remediation require operator action.
- ${stateCounts.KNOWN_DEFECTIVE} recovered E2E suites remain
  \`KNOWN_DEFECTIVE\`; ${stateCounts.BLOCKED} rows remain registry-\`BLOCKED\`.
- Supported program-language files are discovered regardless of filename;
  ${explicitSupportExclusions} support/aggregate files are explicit reasoned
  exclusions.
- The operator-owned ignored \`data/c3.db\` remains untouched (\`D-022\`).

## Next action

Give \`docs/convergence/reviews/GATE0-OPUS-REVIEW.md\` and the referenced
artifacts to Opus 5 for read-only review. Do not enter the next gate until the
review is evaluated and the operator confirms continuation.
`;
}

function renderBaselineReport({
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
- Independent review: PENDING

The code/test baseline satisfies the local deterministic Gate 0 clauses.
Acceptance remains conditional until the bounded Opus review is evaluated.
The confirmed privacy compromise remains a separate operator-owned incident
and is not presented as nearly green.

## Validators

| Command | Exit | Output SHA-256 |
|---|---:|---|
| \`node scripts/validate-test-registry.js\` | ${registryValidation.exitCode} | \`${sha256(registryValidation.output)}\` |
| \`node scripts/validate-final-disposition.js\` | ${dispositionValidation.exitCode} | \`${sha256(dispositionValidation.output)}\` |

Registry output: \`${oneLine(registryValidation.stdout)}\`

Disposition output: \`${oneLine(dispositionValidation.stdout)}\`

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

- 225 records total
- \`EXCLUDE\`: 91
- \`KEEP\`: 42
- \`REBUILD\`: 92
- Resolutions: \`ABSENT\` 91, \`EXACT\` 87, \`MAPPED_REPAIR\` 3, \`MODIFIED\` 44
- Unresolved path records: 0

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

- Independent review has not yet reproduced the result.
- Public-history remediation, repository visibility, and credential rotation
  remain operator decisions.
- ${stateCounts.KNOWN_DEFECTIVE} recovered E2E suites retain known false-green
  assertions and are not counted green.
- ${stateCounts.BLOCKED} registry rows remain explicitly \`BLOCKED\` on named
  prerequisites.
- Registry discovery covers every supported program-language file independent
  of its filename; ${explicitSupportExclusions} support/aggregate files are
  explicit reasoned exclusions.
- Product DB initialization remains an import side effect; all authoritative
  registry runs set an isolated \`C3_DB_PATH\` (\`G0-R012\`).
- The T1 shared-\`/tmp\` convention remains a documented scope decision
  (\`G0-R014\`).

## Recommended next step

Perform the bounded Opus 5 read-only review, evaluate every finding against the
candidate and evidence, then ask the operator whether Gate 0 may be accepted.
Do not begin the next gate from this conditional checkpoint.
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
}) {
  return `# Gate 0 — Opus 5 Read-only Review Packet

## Review boundary

- Candidate: \`${candidateSha}\`
- Registry SHA-256: \`${registryHash}\`
- Focus range: \`${reviewRange}\`
- Role: read-only reviewer; do not modify the branch

The earlier large E2E reconstruction is represented by the validated 225-row
disposition and registry evidence. This bounded packet focuses on the final
test-trust repairs and verdict machinery.

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
- Registry and disposition validators: exit 0.
- Clean install: two consecutive exit-0 runs from the candidate.

## Known risks

- Registry discovery is extension-based and every support/aggregate file is an
  explicit reasoned exclusion.
- Product DB opening remains an import side effect (\`G0-R012\`), although the
  authoritative runner supplies isolated DB paths.
- ${stateCounts.KNOWN_DEFECTIVE} recovered E2E suites remain
  \`KNOWN_DEFECTIVE\`; ${stateCounts.BLOCKED} remain registry-\`BLOCKED\`.
- Privacy history remains reachable and credential rotation is pending.

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

function oneLine(value) {
  return value.trim().replace(/\s+/g, ' ');
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
