// Production artifact validation contract.
// Run: node tests/artifact-validation.test.js

import {
  chmodSync,
  existsSync,
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
  evaluateGate0RiskPolicy,
  GateImpact,
  ReviewStatus,
} from '../scripts/gate0-evidence-verdict.js';
import {
  buildGate0Clauses,
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

suite('documentation integrity');

const docsReadmeUrl = new URL('../docs/README.md', import.meta.url);
const docsReadme = readFileSync(docsReadmeUrl, 'utf8');
const strippedCzechTokenPattern = /\b(?:Spusteni|Nastroje|Bezpecnost|Planovani|Vyvoj|Dalsi|Konverzacni|Kanonicky|zavislosti|nativnich|Rucni|promenlive|auditni|skutecny|Vsechny|promenne|nacitaji|Kompletni|instalacni|prirucka|Projektovy|kazdy|uzivatelsky|spravny|zadny|Pocet|vypsanych|sobe|dukaz|zeleneho|validovana|navratovy|vystavi|zpravy|stejnem|Posledni)\b/g;

function markdownProse(markdown) {
  let inFence = false;
  return String(markdown)
    .split('\n')
    .filter((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join('\n')
    .replace(/`[^`\n]*`/g, '')
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');
}

function strippedCzechTokens(markdown) {
  return markdownProse(markdown).match(strippedCzechTokenPattern) || [];
}

test('current README keeps restored Czech headings and prose', () => {
  assert(!docsReadme.includes('**Známé poškození:**'));
  for (const heading of [
    '## Spuštění',
    '### Nástroje & Bezpečnost',
    '### Plánování & Vývoj',
    '### Další',
    '### Konverzační testy (vyžadují Ollama + GPU)',
  ]) {
    assert(docsReadme.includes(heading), `missing restored heading: ${heading}`);
  }
  const strippedTokens = strippedCzechTokens(docsReadme);
  assertEqual(
    strippedTokens.join(','),
    '',
    `stripped Czech prose tokens: ${strippedTokens.join(', ')}`,
  );
});

test('diacritics scan ignores intentional fenced, inline, and path examples', () => {
  const intentionalNoDiacritics = [
    '```text',
    'Spusteni a Konverzacni testy',
    '```',
    '`conv-czech-nodiacritics.test.js`',
    '[fixture](examples/Spusteni-bez-diakritiky.md)',
  ].join('\n');
  assertEqual(strippedCzechTokens(intentionalNoDiacritics).length, 0);
});

test('every local README Markdown link resolves from docs/', () => {
  const targets = [...docsReadme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map(match => match[1].split('#')[0])
    .filter(target => target !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(target));
  assert(targets.length > 0, 'README must contain local Markdown links');
  for (const target of targets) {
    assert(existsSync(new URL(target, docsReadmeUrl)), `missing README link target: ${target}`);
  }
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

suite('Gate 0 risk-impact policy');

const committedRiskMarkdown = readFileSync(
  new URL('../docs/convergence/RISK-REGISTER.md', import.meta.url),
  'utf8',
);
const committedRiskPolicy = JSON.parse(readFileSync(
  new URL('../docs/convergence/GATE0-RISK-IMPACT.json', import.meta.url),
  'utf8',
));
const gate0GeneratorSource = readFileSync(
  new URL('../scripts/generate-gate0-evidence.js', import.meta.url),
  'utf8',
);

function riskPolicyCopy() {
  return structuredClone(committedRiskPolicy);
}

function riskAssessmentCopy(overrides = {}) {
  return {
    schemaVersion: 1,
    valid: true,
    errors: [],
    riskCount: 26,
    policyCount: 26,
    impactCounts: {
      G0_FAIL: 20,
      G0_REVIEW_REQUIRED: 1,
      LATER_GATE: 2,
      SEPARATE_INCIDENT: 3,
    },
    openImpactCounts: {
      G0_FAIL: 2,
      G0_REVIEW_REQUIRED: 1,
      LATER_GATE: 2,
      SEPARATE_INCIDENT: 3,
    },
    repositoryBlockers: [],
    reviewRequiredRisks: ['G0-R015: OPEN'],
    laterGateRisks: ['G0-R009: OPEN', 'G0-R018: OPEN'],
    separateIncidents: [
      'G0-R001: CONTAINED_CURRENT_TREE / OPEN_HISTORY',
      'G0-R002: CONTAINED_CURRENT_TREE / OPEN_HISTORY',
      'G0-R010: OPEN',
    ],
    ...overrides,
  };
}

test('committed policy classifies every risk and derives current blockers', () => {
  const result = evaluateGate0RiskPolicy(
    committedRiskMarkdown,
    riskPolicyCopy(),
  );
  assertEqual(result.valid, true);
  assertEqual(result.riskCount, 26);
  assertEqual(result.policyCount, 26);
  assertEqual(result.repositoryBlockers.join(','), [
    'G0-R014: OPEN',
    'G0-R020: OPEN',
  ].join(','));
  assertEqual(result.reviewRequiredRisks.join(','), 'G0-R015: OPEN');
  assertEqual(result.laterGateRisks.join(','), 'G0-R009: OPEN,G0-R018: OPEN');
  assertEqual(
    result.separateIncidents.join(','),
    'G0-R001: CONTAINED_CURRENT_TREE / OPEN_HISTORY,'
      + 'G0-R002: CONTAINED_CURRENT_TREE / OPEN_HISTORY,G0-R010: OPEN',
  );
});

test('policy pins Gate 0 failure classes and the loopback condition', () => {
  const byId = new Map(committedRiskPolicy.risks.map(entry => [entry.riskId, entry]));
  for (const riskId of [
    'G0-R012',
    'G0-R014',
    'G0-R017',
    'G0-R019',
    'G0-R020',
    'G0-R026',
  ]) {
    assertEqual(byId.get(riskId)?.gateImpact, GateImpact.G0_FAIL);
  }
  assertEqual(byId.get('G0-R018')?.gateImpact, GateImpact.LATER_GATE);
  assert(byId.get('G0-R018')?.condition.includes('loopback-only'));
  for (const riskId of ['G0-R001', 'G0-R002', 'G0-R010']) {
    assertEqual(byId.get(riskId)?.gateImpact, GateImpact.SEPARATE_INCIDENT);
  }
});

test('a newly added unknown OPEN risk fails closed without a code allowlist', () => {
  const riskMarkdown = `${committedRiskMarkdown.trim()}\n`
    + '| G0-R999 | P1 | confirmed | new local finding | repair | primary implementer | OPEN |\n';
  const result = evaluateGate0RiskPolicy(riskMarkdown, riskPolicyCopy());
  assertEqual(result.valid, false);
  assert(includesError(result.errors, 'G0-R999: missing valid gateImpact policy'));
  assert(includesError(result.repositoryBlockers, 'G0-R999: OPEN'));
});

test('removing an OPEN risk policy entry fails closed', () => {
  const policy = riskPolicyCopy();
  policy.risks = policy.risks.filter(entry => entry.riskId !== 'G0-R020');
  const result = evaluateGate0RiskPolicy(committedRiskMarkdown, policy);
  assertEqual(result.valid, false);
  assert(includesError(result.errors, 'G0-R020: missing valid gateImpact policy'));
  assert(includesError(result.repositoryBlockers, 'G0-R020: OPEN'));
});

test('duplicate and unknown gateImpact entries are rejected', () => {
  const duplicate = riskPolicyCopy();
  duplicate.risks.push(structuredClone(
    duplicate.risks.find(entry => entry.riskId === 'G0-R020'),
  ));
  const duplicateResult = evaluateGate0RiskPolicy(committedRiskMarkdown, duplicate);
  assertEqual(duplicateResult.valid, false);
  assert(includesError(duplicateResult.errors, 'G0-R020: duplicate gateImpact'));
  assert(includesError(duplicateResult.repositoryBlockers, 'G0-R020: OPEN'));

  const unknown = riskPolicyCopy();
  unknown.risks.find(entry => entry.riskId === 'G0-R014').gateImpact = 'IGNORE';
  const unknownResult = evaluateGate0RiskPolicy(committedRiskMarkdown, unknown);
  assertEqual(unknownResult.valid, false);
  assert(includesError(unknownResult.errors, 'G0-R014: unknown gateImpact'));
  assert(includesError(unknownResult.repositoryBlockers, 'G0-R014: OPEN'));
});

test('a malformed policy entry is rejected instead of being silently skipped', () => {
  const policy = riskPolicyCopy();
  policy.risks[0] = null;
  const result = evaluateGate0RiskPolicy(committedRiskMarkdown, policy);
  assertEqual(result.valid, false);
  assert(includesError(result.errors, 'risk policy risks[0] must be an object'));
  assert(includesError(result.errors, 'G0-R001: missing valid gateImpact policy'));
  assert(includesError(result.repositoryBlockers, 'G0-R001'));
});

test('an open later-gate risk without its concrete condition fails closed', () => {
  const policy = riskPolicyCopy();
  delete policy.risks.find(entry => entry.riskId === 'G0-R018').condition;
  const result = evaluateGate0RiskPolicy(committedRiskMarkdown, policy);
  assertEqual(result.valid, false);
  assert(includesError(result.errors, 'G0-R018: LATER_GATE requires a concrete condition'));
  assert(includesError(result.repositoryBlockers, 'G0-R018: OPEN'));
});

test('a mitigated G0_FAIL risk does not block, but reopening it does', () => {
  const current = evaluateGate0RiskPolicy(committedRiskMarkdown, riskPolicyCopy());
  assert(!includesError(current.repositoryBlockers, 'G0-R025'));
  const reopenedMarkdown = committedRiskMarkdown.replace(
    /(\| G0-R025 \|.*\| )MITIGATED \|/,
    '$1OPEN |',
  );
  const reopened = evaluateGate0RiskPolicy(reopenedMarkdown, riskPolicyCopy());
  assert(includesError(reopened.repositoryBlockers, 'G0-R025: OPEN'));
});

test('the evidence generator consumes the policy evaluator without a risk-ID allowlist', () => {
  assert(gate0GeneratorSource.includes('evaluateGate0RiskPolicy('));
  assert(!gate0GeneratorSource.includes('GATE0_REPOSITORY_BLOCKER_IDS'));
  assert(!gate0GeneratorSource.includes('findOpenGate0RepositoryBlockers'));
});

test('risk policy validity is a generated Gate 0 clause', () => {
  const clauses = buildGate0Clauses({
    registryValidation: { passed: true, report: { records: 350 }, errors: [] },
    dispositionValidation: { passed: true, report: { records: 225 }, errors: [] },
    deterministicEvidence: { statusCounts: { PASS: 199 } },
    runnablePrograms: 350,
    explicitSupportExclusions: 8,
    stateCounts: { ACTIVE: 271 },
    blockedWithoutPrerequisite: [],
    knownDefectiveInDeterministic: [],
    riskAssessment: riskAssessmentCopy({
      valid: false,
      errors: ['G0-R999: missing valid gateImpact policy'],
    }),
  });
  const riskClause = clauses.find(clause => clause.id === 'G0-C9');
  assertEqual(riskClause.result, 'FAIL');
  assert(riskClause.evidence.includes('G0-R999'));
});

suite('Gate 0 verdict derivation');

function dispositionReport(errors = []) {
  const dispositions = [
    ...Array(91).fill('EXCLUDE'),
    ...Array(42).fill('KEEP'),
    ...Array(92).fill('REBUILD'),
  ];
  const resolutions = [
    ...Array(91).fill('ABSENT'),
    ...Array(32).fill('EXACT'),
    ...Array(3).fill('MAPPED_REPAIR'),
    ...Array(99).fill('MODIFIED'),
  ];
  let rebuildIndex = 0;
  const paths = dispositions.map((disposition, index) => {
    let action = disposition === 'EXCLUDE' ? 'REMOVE_FOLLOWUP' : 'REPLAY';
    if (disposition === 'REBUILD') {
      action = rebuildIndex++ < 60
        ? 'REPAIRED'
        : 'DEFERRED(owned-server)';
    }
    return { disposition, action, resolution: resolutions[index] };
  });
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
    paths,
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

test('green disposition report rejects unknown count and terminal vocabularies', () => {
  const malformed = dispositionReport();
  malformed.sourceManifest.changeCounts = { SURPRISE: 225 };
  malformed.dispositionCounts = { REBUILD: 92, SURPRISE: 133 };
  malformed.terminalCounts = { DONE: 92 };
  malformed.resolutionCounts = { MAGIC: 225 };
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

test('a policy-derived repository blocker forces FAIL', () => {
  const assessment = evaluateGate0RiskPolicy(
    '| G0-R777 | P1 | confirmed | finding | action | owner | OPEN |\n',
    {
      schemaVersion: 1,
      gate: 'Gate 0',
      source: 'docs/convergence/RISK-REGISTER.md',
      risks: [{
        riskId: 'G0-R777',
        gateImpact: GateImpact.G0_FAIL,
        rationale: 'Synthetic local blocker.',
      }],
    },
  );
  assertEqual(assessment.valid, true);
  assertEqual(assessment.repositoryBlockers.length, 1);
  assertEqual(
    deriveGateOutcome({
      clauses: passingClauses(),
      repositoryBlockers: assessment.repositoryBlockers,
    }).verdict,
    'FAIL',
  );
});

test('G0_REVIEW_REQUIRED remains conditional until review approval', () => {
  const reviewRequiredRisks = ['G0-R015: OPEN'];
  const pending = deriveGateOutcome({
    clauses: passingClauses(),
    reviewRequiredRisks,
    reviewStatus: ReviewStatus.PENDING,
  });
  assertEqual(pending.verdict, 'CONDITIONAL PASS');
  assertEqual(pending.reviewRequiredRisks[0], 'G0-R015: OPEN');
  const approved = deriveGateOutcome({
    clauses: passingClauses(),
    reviewRequiredRisks,
    reviewStatus: ReviewStatus.APPROVED,
  });
  assertEqual(approved.verdict, 'PASS');
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
    riskAssessment: riskAssessmentCopy(),
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
    riskAssessment: riskAssessmentCopy(),
    dispositionReport: disposition,
  });
  assert(markdown.includes('`EXACT` 32'));
  assert(markdown.includes('`MODIFIED` 99'));
  assert(!markdown.includes('`EXACT` 87'));
  assert(!markdown.includes('undefined'));
});

await testAsync('even an empty manual verdict override is rejected before evidence writes', async () => {
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
      '--verdict=',
    ]);
  } finally {
    console.error = originalError;
  }
  assertEqual(exitCode, 2);
  assert(errorText.includes('--verdict is not supported'));
});

rmSync(testRoot, { recursive: true, force: true });
summary();
