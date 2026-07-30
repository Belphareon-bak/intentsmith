// Production artifact validation contract.
// Run: node tests/artifact-validation.test.js

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  checkArtifactContent,
  isRequiredArtifactPath,
  validateArtifactFile,
} from '../src/planner/artifact-validation.js';
import {
  refreshManifestIntegrity,
  validateDiffManifest,
} from '../scripts/final-disposition-manifest.js';
import {
  validateDispositionActions,
} from '../scripts/validate-final-disposition.js';
import {
  classifyDispositionValidatorExecution,
  classifyRegistryValidatorExecution,
  deriveGateOutcome,
  findOpenGate0RepositoryBlockers,
  ReviewStatus,
} from '../scripts/gate0-evidence-verdict.js';
import {
  main as generateGate0Evidence,
  renderBaselineReport,
  renderStatus,
} from '../scripts/generate-gate0-evidence.js';
import {
  suite,
  test,
  testAsync,
  assert,
  assertEqual,
  assertThrows,
  summary,
} from './harness.js';

const testRoot = mkdtempSync(path.join(tmpdir(), 'intentsmith-artifact-validation-'));
chmodSync(testRoot, 0o700);
let fileCounter = 0;

function writeArtifact(relPath, content) {
  const fullPath = path.join(testRoot, `${fileCounter++}-${path.basename(relPath)}`);
  writeFileSync(fullPath, content, { encoding: 'utf8', mode: 0o600 });
  return fullPath;
}

function validateContent(relPath, content) {
  return validateArtifactFile(relPath, writeArtifact(relPath, content));
}

suite('artifact selection and file boundary');

test('all lifecycle plaintext extensions are selected', () => {
  for (const ext of ['.txt', '.sql', '.env', '.yaml', '.yml', '.toml', '.sh', '.ini', '.cfg', '.conf']) {
    assert(isRequiredArtifactPath(`nested/artifact${ext}`), `${ext} should be selected`);
  }
});

test('code and structured JSON artifacts are not selected', () => {
  assert(!isRequiredArtifactPath('src/index.js'), '.js should not be selected');
  assert(!isRequiredArtifactPath('package.json'), '.json should not be selected');
});

test('zero-byte plaintext artifact fails with the lifecycle reason', () => {
  const result = validateContent('notes.txt', '');
  assertEqual(result.ok, false);
  assertEqual(result.reason, '0 bytes');
  assertEqual(result.kind, 'zero-byte');
});

test('missing file is deferred to the downstream quality gate', () => {
  const missing = path.join(testRoot, 'does-not-exist.env');
  const result = validateArtifactFile('config.env', missing);
  assertEqual(result.ok, true);
});

test('content read error is deferred to the downstream quality gate', () => {
  const missing = path.join(testRoot, 'unreadable.sql');
  const result = checkArtifactContent('schema.sql', missing, '.sql');
  assertEqual(result.ok, true);
});

test('non-empty generic plaintext artifact passes', () => {
  assertEqual(validateContent('notes.txt', 'generated notes\n').ok, true);
});

suite('requirements artifact');

test('requirements.txt accepts a package line', () => {
  assertEqual(validateContent('requirements.txt', '# runtime\nfastify>=4\n').ok, true);
});

test('requirements-dev.txt accepts a package line', () => {
  assertEqual(validateContent('requirements-dev.txt', 'pytest==8.4.1\n').ok, true);
});

test('comments and requirement options alone are rejected', () => {
  const result = validateContent(
    'requirements.txt',
    '# no direct package\n-r base-requirements.txt\n--index-url https://example.invalid\n',
  );
  assertEqual(result.ok, false);
  assertEqual(result.reason, 'no package lines');
});

suite('environment artifact');

test('.env accepts at least one KEY=VALUE pair', () => {
  assertEqual(validateContent('config.env', '# local config\nDATABASE_URL=sqlite:///app.db\n').ok, true);
});

test('.env without a KEY=VALUE pair is rejected', () => {
  const result = validateContent('config.env', '# local config\nnot-an-assignment\n');
  assertEqual(result.ok, false);
  assertEqual(result.reason, 'no KEY=VALUE pairs');
});

suite('SQL artifact');

test('.sql accepts a recognizable statement', () => {
  assertEqual(validateContent('query.sql', 'SELECT id FROM users;\n').ok, true);
});

test('.sql without a recognizable statement is rejected', () => {
  const result = validateContent('schema.sql', '-- generated later\nVACUUM;\n');
  assertEqual(result.ok, false);
  assertEqual(result.reason, 'no SQL statements found');
});

suite('YAML artifact');

test('.yaml and .yml accept a key-value line', () => {
  assertEqual(validateContent('config.yaml', 'service:\n  enabled: true\n').ok, true);
  assertEqual(validateContent('config.yml', 'name: intentsmith\n').ok, true);
});

test('.yaml without a key-value line is rejected', () => {
  const result = validateContent('config.yaml', '# placeholder\n- list-only\n');
  assertEqual(result.ok, false);
  assertEqual(result.reason, 'no key: value pairs');
});

suite('TOML artifact');

test('.toml accepts a section or assignment', () => {
  assertEqual(validateContent('config.toml', '[server]\n').ok, true);
  assertEqual(validateContent('config.toml', 'port = 47831\n').ok, true);
});

test('.toml without a section or assignment is rejected', () => {
  const result = validateContent('config.toml', '# placeholder\nserver configuration\n');
  assertEqual(result.ok, false);
  assertEqual(result.reason, 'no TOML content');
});

suite('shell artifact');

test('.sh accepts a non-comment command', () => {
  assertEqual(validateContent('run.sh', '#!/bin/sh\nexec node src/server.js\n').ok, true);
});

test('.sh containing only comments is rejected', () => {
  const result = validateContent('run.sh', '#!/bin/sh\n# TODO\n');
  assertEqual(result.ok, false);
  assertEqual(result.reason, 'no shell commands');
});

suite('generic configured artifact');

test('non-empty .ini remains subject only to the zero-byte check', () => {
  assertEqual(validateContent('settings.ini', '# content interpreted downstream\n').ok, true);
});

suite('sanitized final-commit diff manifest');

const committedManifest = JSON.parse(readFileSync(
  new URL('../docs/convergence/FINAL-COMMIT-DIFF-MANIFEST.json', import.meta.url),
  'utf8',
));

function manifestCopy() {
  return structuredClone(committedManifest);
}

function includesError(errors, fragment) {
  return errors.some(error => error.includes(fragment));
}

test('complete committed source manifest is valid offline', () => {
  assertEqual(validateDiffManifest(manifestCopy()).length, 0);
});

test('missing source record is rejected after self-declared integrity is recomputed', () => {
  const manifest = manifestCopy();
  manifest.records.pop();
  refreshManifestIntegrity(manifest);
  const errors = validateDiffManifest(manifest);
  assert(includesError(errors, 'recordCount must equal 225'));
  assert(includesError(errors, 'validator-pinned source diff'));
});

test('duplicate source record is rejected', () => {
  const manifest = manifestCopy();
  manifest.records[1] = structuredClone(manifest.records[0]);
  refreshManifestIntegrity(manifest);
  const errors = validateDiffManifest(manifest);
  assert(includesError(errors, 'duplicates another diff record'));
});

test('changed full blob SHA is rejected even with a recomputed manifest digest', () => {
  const manifest = manifestCopy();
  manifest.records[0].newBlob = 'f'.repeat(40);
  refreshManifestIntegrity(manifest);
  const errors = validateDiffManifest(manifest);
  assert(includesError(errors, 'validator-pinned source diff'));
});

test('missing source base metadata is rejected', () => {
  const manifest = manifestCopy();
  delete manifest.sourceRange.base;
  const errors = validateDiffManifest(manifest);
  assert(includesError(errors, 'sourceRange fields'));
  assert(includesError(errors, 'sourceRange.base'));
});

test('missing source head metadata is rejected', () => {
  const manifest = manifestCopy();
  delete manifest.sourceRange.head;
  const errors = validateDiffManifest(manifest);
  assert(includesError(errors, 'sourceRange fields'));
  assert(includesError(errors, 'sourceRange.head'));
});

suite('D-018 terminal disposition states');

function rebuildRow(action) {
  return [{
    status: 'M',
    displayPath: 'fixture.js',
    disposition: 'REBUILD',
    action,
    rationale: 'fixture',
  }];
}

test('legacy bare REBUILD/REPAIR is rejected', () => {
  const errors = validateDispositionActions(rebuildRow('REPAIR'));
  assert(includesError(errors, 'not a terminal D-018 state'));
});

test('unknown REBUILD terminal state is rejected', () => {
  const errors = validateDispositionActions(rebuildRow('DONE'));
  assert(includesError(errors, 'not a terminal D-018 state'));
});

test('DEFERRED without a prerequisite is rejected', () => {
  const errors = validateDispositionActions(rebuildRow('DEFERRED()'));
  assert(includesError(errors, 'canonical concrete prerequisites'));
});

test('DEFERRED with a placeholder prerequisite is rejected', () => {
  const errors = validateDispositionActions(rebuildRow('DEFERRED(TBD)'));
  assert(includesError(errors, 'canonical concrete prerequisites'));
});

test('DEFERRED with concrete canonical prerequisites is accepted', () => {
  assertEqual(
    validateDispositionActions(
      rebuildRow('DEFERRED(owned-server+ollama+sufficient-gpu-vram)'),
    ).length,
    0,
  );
});

suite('Gate 0 verdict derivation');

function dispositionReport(errors = []) {
  return {
    schemaVersion: 2,
    sourceRepository: {
      identity: 'github.com/Belphareon-bak/C3-agent',
    },
    sourceRange: {
      base: 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f',
      head: 'ffd21cf119865259ea1847af989acb24916bebe3',
    },
    records: 225,
    sourceManifest: {
      path: 'docs/convergence/FINAL-COMMIT-DIFF-MANIFEST.json',
      schemaVersion: 1,
      recordsSha256: 'aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e',
      recordCount: 225,
      changeCounts: { ADD: 185, DELETE: 0, MODIFY: 24, RENAME: 16 },
    },
    dispositionCounts: { EXCLUDE: 91, KEEP: 42, REBUILD: 92 },
    terminalCounts: { REPAIRED: 60, 'DEFERRED(owned-server)': 32 },
    resolutionCounts: { ABSENT: 91, EXACT: 32, MAPPED_REPAIR: 3, MODIFIED: 99 },
    errors,
    paths: Array.from({ length: 225 }, () => ({})),
  };
}

function registryReport(errors = []) {
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    runnablePrograms: errors.length === 0 ? 350 : null,
    explicitSupportExclusions: errors.length === 0 ? 8 : null,
    fingerprint: errors.length === 0 ? 'a'.repeat(64) : null,
    document: {
      path: 'docs/convergence/TEST-REGISTRY.md',
      mode: 'check',
    },
    errors,
  };
}

function validatorExecution(status, report) {
  return {
    status,
    signal: null,
    error: null,
    stdout: JSON.stringify(report),
    stderr: '',
  };
}

function passingClauses() {
  return [
    { id: 'G0-C1', result: 'PASS', evidence: 'clean candidate' },
    { id: 'G0-C2', result: 'PASS', evidence: 'validator exit 0' },
  ];
}

test('complete valid registry report is accepted as green', () => {
  const result = classifyRegistryValidatorExecution(
    validatorExecution(0, registryReport()),
  );
  assertEqual(result.passed, true);
  assertEqual(result.exitCode, 0);
});

test('structured registry failure remains valid red evidence', () => {
  const result = classifyRegistryValidatorExecution(
    validatorExecution(1, registryReport(['registry document is stale'])),
  );
  assertEqual(result.passed, false);
  assertEqual(result.exitCode, 1);
});

test('registry syntax failure without structured output is infrastructure error', () => {
  assertThrows(() => classifyRegistryValidatorExecution({
    status: 1,
    signal: null,
    error: null,
    stdout: '',
    stderr: 'SyntaxError: broken validator',
  }));
});

test('registry exit/report disagreement is an infrastructure error', () => {
  assertThrows(() => classifyRegistryValidatorExecution(
    validatorExecution(0, registryReport(['reported red'])),
  ));
});

test('green registry report requires counts and a full fingerprint', () => {
  const malformed = registryReport();
  malformed.runnablePrograms = null;
  malformed.fingerprint = 'short';
  assertThrows(() => classifyRegistryValidatorExecution(
    validatorExecution(0, malformed),
  ));
});

test('complete valid disposition report is accepted as green', () => {
  const result = classifyDispositionValidatorExecution(
    validatorExecution(0, dispositionReport()),
  );
  assertEqual(result.passed, true);
  assertEqual(result.exitCode, 0);
});

test('structured disposition failure remains valid red evidence', () => {
  const result = classifyDispositionValidatorExecution(
    validatorExecution(1, dispositionReport(['missing source record'])),
  );
  assertEqual(result.passed, false);
  assertEqual(result.exitCode, 1);
  assertEqual(result.errors[0], 'missing source record');
});

test('malformed disposition output is an infrastructure error', () => {
  assertThrows(() => classifyDispositionValidatorExecution({
    status: 1,
    signal: null,
    error: null,
    stdout: 'not json',
    stderr: '',
  }));
});

test('disposition exit/report disagreement is an infrastructure error', () => {
  assertThrows(() => classifyDispositionValidatorExecution(
    validatorExecution(0, dispositionReport(['reported red'])),
  ));
});

test('green disposition report must satisfy pinned source and count invariants', () => {
  const malformed = dispositionReport();
  malformed.records = 0;
  malformed.sourceManifest = {};
  malformed.dispositionCounts = {};
  malformed.terminalCounts = {};
  malformed.resolutionCounts = {};
  malformed.paths = [];
  assertThrows(() => classifyDispositionValidatorExecution(
    validatorExecution(0, malformed),
  ));
});

test('unexecutable disposition validator is an infrastructure error', () => {
  assertThrows(() => classifyDispositionValidatorExecution({
    status: null,
    signal: null,
    error: new Error('spawn ENOENT'),
    stdout: '',
    stderr: '',
  }));
});

test('a failed local clause forces FAIL and exit 1', () => {
  const clauses = passingClauses();
  clauses[1] = { id: 'G0-C2', result: 'FAIL', evidence: 'validator exit 1' };
  const outcome = deriveGateOutcome({ clauses });
  assertEqual(outcome.verdict, 'FAIL');
  assertEqual(outcome.exitCode, 1);
});

test('all local clauses yield only CONDITIONAL PASS while review is pending', () => {
  const outcome = deriveGateOutcome({
    clauses: passingClauses(),
    reviewStatus: ReviewStatus.PENDING,
  });
  assertEqual(outcome.verdict, 'CONDITIONAL PASS');
  assertEqual(outcome.exitCode, 0);
});

test('PASS requires all local clauses and approved review', () => {
  const outcome = deriveGateOutcome({
    clauses: passingClauses(),
    reviewStatus: ReviewStatus.APPROVED,
  });
  assertEqual(outcome.verdict, 'PASS');
  assertEqual(outcome.exitCode, 0);
});

test('an open repository blocker forces FAIL until its status is mitigated', () => {
  const open = findOpenGate0RepositoryBlockers(
    '| G0-R023 | P1 | confirmed | finding | action | owner | MITIGATED |\n'
      + '| G0-R025 | P1 | confirmed | finding | action | owner | OPEN |',
  );
  assertEqual(open.length, 1);
  assertEqual(
    deriveGateOutcome({
      clauses: passingClauses(),
      repositoryBlockers: open,
    }).verdict,
    'FAIL',
  );
  assertEqual(
    findOpenGate0RepositoryBlockers(
      '| G0-R023 | P1 | confirmed | finding | action | owner | MITIGATED |\n'
        + '| G0-R025 | P1 | confirmed | finding | action | owner | MITIGATED |',
    ).length,
    0,
  );
});

test('FAIL status renders derived clauses, zero counts, and repository blockers', () => {
  const clauses = passingClauses();
  clauses[1] = { id: 'G0-C2', label: 'disposition', result: 'FAIL', evidence: 'exit 1' };
  clauses[0].label = 'clean candidate';
  const outcome = deriveGateOutcome({
    clauses,
    repositoryBlockers: ['G0-R025: OPEN'],
  });
  const markdown = renderStatus({
    candidateSha: 'a'.repeat(40),
    branch: 'codex/intentsmith-1.0',
    registryHash: 'b'.repeat(64),
    verdict: outcome.verdict,
    generatedAt: '2026-07-30T00:00:00.000Z',
    profileCounts: { offline: 173, database: 26 },
    stateCounts: { ACTIVE: 256, BLOCKED: 79 },
    runnablePrograms: 350,
    explicitSupportExclusions: 8,
    deterministicEvidence: { statusCounts: { PASS: 199 } },
    privacy: { status: 'CONFIRMED_COMPROMISE' },
    clauses,
    outcome,
  });
  assert(markdown.includes('Verdict: **FAIL**'));
  assert(markdown.includes('| G0-C2 disposition | FAIL | exit 1 |'));
  assert(markdown.includes('Repository-local Gate 0 blockers: **G0-R025: OPEN**'));
  assert(markdown.includes('0 recovered E2E suites'));
  assert(!markdown.includes('undefined'));
});

test('baseline renders disposition counts from the structured report', () => {
  const clauses = [
    { id: 'G0-C1', label: 'clean candidate', result: 'PASS', evidence: 'clean' },
  ];
  const outcome = deriveGateOutcome({
    clauses,
    repositoryBlockers: ['G0-R023: OPEN'],
  });
  const disposition = dispositionReport();
  const markdown = renderBaselineReport({
    candidateSha: 'a'.repeat(40),
    branch: 'codex/intentsmith-1.0',
    registryHash: 'b'.repeat(64),
    verdict: outcome.verdict,
    generatedAt: '2026-07-30T00:00:00.000Z',
    registryValidation: {
      exitCode: 0,
      output: 'registry',
      stdout: 'registry',
      report: registryReport(),
    },
    dispositionValidation: { exitCode: 0, output: JSON.stringify(disposition) },
    installLogs: [
      { kind: 'clean', bytes: 1, sha256: 'c'.repeat(64), path: 'clean.log' },
      { kind: 'idempotent', bytes: 1, sha256: 'd'.repeat(64), path: 'again.log' },
    ],
    installCommand: './scripts/install.sh --minimal',
    deterministicEvidence: {
      command: 'node scripts/nightly-audit.js',
      exitCode: 0,
      statusCounts: { PASS: 199 },
      report: 'report.json',
      reportSha256: 'e'.repeat(64),
      inventoryFingerprint: 'f'.repeat(64),
      optionsFingerprint: '1'.repeat(64),
    },
    pilotEvidence: [],
    soakEvidence: {
      command: 'node scripts/nightly-audit.js --profile=soak',
      exitCode: 2,
      verdict: 'BLOCKED',
      blockedBy: ['gpu', 'ollama'],
      reportSha256: '2'.repeat(64),
    },
    privacy: {
      incidentId: 'G0-PRIVACY-001',
      status: 'CONFIRMED_COMPROMISE',
      currentTreeContainment: { trackedPathsRemoved: 13 },
      history: { affectedObjectsRemainReachable: true, historyRewritten: false },
      assessment: { personalContentInspected: false },
      rotationInventory: [],
    },
    explicitSupportExclusions: 8,
    stateCounts: { ACTIVE: 256, BLOCKED: 79 },
    clauses,
    outcome,
    dispositionReport: disposition,
  });
  assert(markdown.includes('`EXACT` 32'));
  assert(markdown.includes('`MODIFIED` 99'));
  assert(!markdown.includes('`EXACT` 87'));
  assert(!markdown.includes('undefined'));
});

await testAsync('manual verdict override is rejected before any evidence write', async () => {
  const originalError = console.error;
  let errorText = '';
  console.error = (...values) => {
    errorText += values.join(' ');
  };
  let exitCode;
  try {
    exitCode = await generateGate0Evidence([
      '--deterministic-report=unused',
      '--pilot-root=unused',
      '--soak-guard-report=unused',
      '--install-log=unused',
      '--idempotent-install-log=unused',
      '--install-command=unused',
      '--deterministic-command=unused',
      '--pilot-command-template=unused-{runId}',
      '--soak-command=unused',
      '--verdict=PASS',
    ]);
  } finally {
    console.error = originalError;
  }
  assertEqual(exitCode, 2);
  assert(errorText.includes('--verdict is not supported'));
});

rmSync(testRoot, { recursive: true, force: true });
summary();
