// Production artifact validation contract.
// Run: node tests/artifact-validation.test.js

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
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
  EXPECTED_RECORDS_SHA256,
  refreshManifestIntegrity,
  validateDiffManifest,
} from '../scripts/final-disposition-manifest.js';
import {
  buildRepairedSubjectManifest,
  EXPECTED_REPAIRED_SUBJECT_COUNT,
  REPAIRED_SUBJECTS_PATH,
  validateHeadBinding,
  validateRepairedSubjectManifest,
  validateDispositionDocument,
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
  buildGate0RiskEvidence,
  buildPrivacyIncidentEvidence,
  buildRegistryGateFacts,
} from '../scripts/gate0-evidence-projections.js';
import { validateTestRegistry } from '../scripts/test-registry.js';
import { registryBlockersFor } from '../scripts/nightly-orchestrator.js';
import {
  auditResultLogIdentityErrors,
  buildGate0Clauses,
  formatPortableInvocation,
  loadAndValidateAuditEvidence,
  main as generateGate0Evidence,
  renderBaselineReport,
  renderStatus,
  runWithGate0OutputRollback,
} from '../scripts/generate-gate0-evidence.js';
import {
  buildGate0ExecutionPlan,
  buildSanitizedExecutionEvidence,
  gate0EvidenceLayout,
  makePortableInvocation,
  resolveOwnedEvidenceFile,
  validateGate0Provenance,
} from '../scripts/gate0-evidence-contract.js';
import {
  assertAllowedIgnoredState,
  assertOwnedDependencyRoots,
  assertOwnedExecutionBoundary,
  assertOwnedArtifactRoot,
  assertPristineIgnoredState,
  captureToolchain,
  main as runGate0CandidateEvidence,
} from '../scripts/run-gate0-candidate-evidence.js';
import {
  buildGate0RevalidationInputScopes,
  GATE0_ATTESTATION_OUTPUTS,
  GATE0_BOUND_OUTPUTS,
  resolveGate0AttestationChain,
  validateGate0ApprovedAttestation,
  validateGate0Attestation,
  validateGate0RevalidationDisjointness,
} from '../scripts/validate-gate0-attestation.js';
import {
  GATE0_PENDING_ATTESTATION_RULE,
  GATE0_REGISTRY_FINGERPRINT_ALGORITHM,
  GATE0_REVIEW_METHOD,
  GATE0_REVIEW_PACKET_PATH,
  GATE0_REVIEW_RESULT_PATH,
  GATE0_REVIEWER_ROLE,
  parseGate0ReviewResult,
  validateGate0ReviewResult,
} from '../scripts/gate0-review-contract.js';
import {
  buildApprovedGate0Promotion,
} from '../scripts/gate0-promotion-contract.js';
import {
  normalizeGitOutput,
  validateReviewResultCommitBoundary,
  writeGate0PromotionFiles,
} from '../scripts/promote-gate0-review.js';
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
const rootReadme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const rootAgents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
const rootClaude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
const rootSystemMap = readFileSync(new URL('../SYSTEM-MAP.md', import.meta.url), 'utf8');
const installScript = readFileSync(
  new URL('../scripts/install.sh', import.meta.url),
  'utf8',
);
const committedRegistry = JSON.parse(readFileSync(
  new URL('../tests/registry.json', import.meta.url),
  'utf8',
));
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

function rootReadmeMatchesRegistry(markdown, registry) {
  const counts = registry.suites.reduce((result, suite) => {
    result[suite.state] = (result[suite.state] || 0) + 1;
    return result;
  }, {});
  return markdown.includes(`**${registry.suites.length} registrovaných testovacích programů**`)
    && markdown.includes(
      `(\`${counts.ACTIVE || 0} ACTIVE\`, \`${counts.BLOCKED || 0} BLOCKED\`, `
      + `\`${counts.KNOWN_DEFECTIVE || 0} KNOWN_DEFECTIVE\`, `
      + `\`${counts.HISTORICAL || 0} HISTORICAL\`)`,
    );
}

function currentToolInventory() {
  const toolDirectory = new URL('../src/tools/', import.meta.url);
  const files = readdirSync(toolDirectory)
    .filter(name => name.endsWith('.js'))
    .sort();
  const lines = files.reduce((total, name) => {
    const source = readFileSync(new URL(name, toolDirectory), 'utf8');
    return total + (source.match(/\n/g) || []).length;
  }, 0);
  const declarations = (readFileSync(new URL('../src/tools/registry.js', import.meta.url), 'utf8')
    .match(/^  name: '/gm) || []).length;
  return { files: files.length, lines, declarations };
}

function systemMapMatchesToolInventory(markdown, inventory) {
  const formattedLines = String(inventory.lines).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return markdown.includes(
    `**${inventory.files} JavaScript soubory, ${formattedLines.replace(',', ' ')} řádků, `
    + `${inventory.declarations} top-level\nnástrojových deklarací**`,
  );
}

function entrypointDocumentsAreValid(agentsMarkdown, claudeMarkdown) {
  if (agentsMarkdown !== claudeMarkdown || agentsMarkdown.length > 5000) return false;
  if (/INTENTSMITH-1\.0-START-HERE|Execute Gate 0/.test(agentsMarkdown)) return false;

  const requiredTargets = [
    'PRODUCT.md',
    'DIRECTION.md',
    'CONTRACT.md',
    'ROADMAP.md',
    'SYSTEM-MAP.md',
    'docs/inventory/',
  ];
  const targets = [...agentsMarkdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map(match => match[1].split('#')[0]);

  return requiredTargets.every(target => targets.includes(target))
    && targets.every(target => existsSync(new URL(`../${target}`, import.meta.url)));
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

test('root README state counts derive from the committed registry', () => {
  assert(rootReadmeMatchesRegistry(rootReadme, committedRegistry));
});

test('root README rejects drift from the committed registry', () => {
  assert(!rootReadmeMatchesRegistry(
    rootReadme.replace('`264 ACTIVE`', '`263 ACTIVE`'),
    committedRegistry,
  ));
});

test('minimal install keeps the projects directory inside the configured boundary', () => {
  assert(installScript.includes(
    'PROJECTS_DIR="${C3_PROJECTS_DIR:-$PROJECT_ROOT/projects}"',
  ));
  assert(installScript.includes(
    'mkdir -p "$PROJECT_ROOT/data" "$PROJECTS_DIR"',
  ));
  assert(!installScript.includes('mkdir -p data projects'));
});

test('BLOCKED registry rows require a concrete parent-verifiable prerequisite', () => {
  const registry = JSON.parse(JSON.stringify(committedRegistry));
  const suiteRecord = registry.suites.find(
    suite => suite.id === 'IS-T5-E2E-220-E2E-SUITE-RUNNER',
  );
  suiteRecord.requirements = {
    network: 'none',
    database: false,
    server: false,
    ollama: false,
    gpu: false,
  };
  const candidates = [
    ...registry.suites.map(suite => suite.path),
    ...registry.exclusions.map(exclusion => exclusion.path),
  ];
  const errors = validateTestRegistry(registry, candidates);
  assert(errors.some(error => error.includes(
    'BLOCKED state requires external network, server, ollama, gpu, or a named toolchain',
  )));
  assert(buildRegistryGateFacts(registry).blockedWithoutPrerequisite.includes(
    suiteRecord.id,
  ));
});

test('registry toolchain prerequisites use unique canonical names', () => {
  const candidates = [
    ...committedRegistry.suites.map(suite => suite.path),
    ...committedRegistry.exclusions.map(exclusion => exclusion.path),
  ];
  const invalid = JSON.parse(JSON.stringify(committedRegistry));
  invalid.suites[0].requirements.toolchain = ['x11-display', 'X11 display'];
  assert(validateTestRegistry(invalid, candidates).some(error => (
    error.includes('non-empty array of canonical names')
  )));

  const duplicate = JSON.parse(JSON.stringify(committedRegistry));
  duplicate.suites[0].requirements.toolchain = ['x11-display', 'x11-display'];
  assert(validateTestRegistry(duplicate, candidates).some(error => (
    error.includes('must not contain duplicates')
  )));
});

test('release orchestrator mirrors exact registry toolchain blockers', () => {
  assertEqual(
    JSON.stringify(registryBlockersFor({
      state: 'ACTIVE',
      requirements: {
        network: 'none',
        server: false,
        ollama: false,
        gpu: false,
        toolchain: ['x11-display', 'iproute2'],
      },
    })),
    JSON.stringify(['toolchain:iproute2', 'toolchain:x11-display']),
  );
});

test('agent entrypoints are identical pointers to existing authorities', () => {
  assert(entrypointDocumentsAreValid(rootAgents, rootClaude));
});

test('agent entrypoint rejects a missing authority target', () => {
  const drifted = rootAgents.replace('(PRODUCT.md)', '(MISSING-PRODUCT.md)');
  assert(!entrypointDocumentsAreValid(drifted, drifted));
});

test('SYSTEM-MAP tool census derives from current JavaScript sources', () => {
  assert(systemMapMatchesToolInventory(rootSystemMap, currentToolInventory()));
});

test('SYSTEM-MAP tool census rejects source-count drift', () => {
  assert(!systemMapMatchesToolInventory(
    rootSystemMap.replace('153 top-level', '154 top-level'),
    currentToolInventory(),
  ));
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

const committedDispositionMarkdown = readFileSync(
  new URL('../docs/convergence/FINAL-COMMIT-DISPOSITION.md', import.meta.url),
  'utf8',
);

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

test('committed disposition has no unenforced mutable identity claims', () => {
  assertEqual(validateDispositionDocument(committedDispositionMarkdown).length, 0);
});

test('missing disposition document is rejected', () => {
  const errors = validateDispositionDocument('');
  assert(includesError(errors, 'document markdown is required'));
});

test('stale unchanged candidate prose is rejected', () => {
  const errors = validateDispositionDocument(
    'The file is unchanged from attested candidate `0123456789012345678901234567890123456789`.',
  );
  assert(includesError(errors, 'unenforced mutable identity claim'));
});

test('stale byte-identical candidate prose is rejected', () => {
  const errors = validateDispositionDocument(
    'The current files are byte-identical to the earlier candidate.',
  );
  assert(includesError(errors, 'unenforced mutable identity claim'));
});

suite('REBUILD/REPAIRED subject evidence');

function repairedResolutions() {
  return Array.from({ length: EXPECTED_REPAIRED_SUBJECT_COUNT }, (_, index) => ({
    sourceSequence: index + 1,
    displayPath: `tests/repaired-${String(index).padStart(2, '0')}.js`,
    candidatePath: `tests/repaired-${String(index).padStart(2, '0')}.js`,
    disposition: 'REBUILD',
    action: 'REPAIRED',
    rationale: `focused repair evidence ${index}`,
    candidateBlob: (index + 1).toString(16).padStart(40, '0'),
    candidateMode: index === 0 ? '100755' : '100644',
    resolution: 'MODIFIED',
  }));
}

function refreshSubjectDigest(subjectManifest) {
  subjectManifest.recordCount = subjectManifest.records.length;
  subjectManifest.recordsSha256 = createHash('sha256')
    .update(JSON.stringify(subjectManifest.records.map(record => ([
      record.sourceSequence,
      record.displayPath,
      record.candidatePath,
      record.candidateBlob,
      record.candidateMode,
      record.rationaleSha256,
    ]))))
    .digest('hex');
  return subjectManifest;
}

function buildSubjectManifest(resolutions = repairedResolutions()) {
  return buildRepairedSubjectManifest(resolutions, EXPECTED_RECORDS_SHA256);
}

function validateSubjectManifest(manifest, resolutions) {
  return validateRepairedSubjectManifest(
    manifest,
    resolutions,
    { recordsSha256: EXPECTED_RECORDS_SHA256 },
  );
}

test('complete repaired-subject manifest validates all 60 current subjects', () => {
  const resolutions = repairedResolutions();
  const result = validateRepairedSubjectManifest(
    buildSubjectManifest(resolutions),
    resolutions,
    { recordsSha256: EXPECTED_RECORDS_SHA256 },
  );
  assertEqual(result.errors.length, 0);
  assertEqual(result.summary.path, REPAIRED_SUBJECTS_PATH);
  assertEqual(result.summary.validatedCount, EXPECTED_REPAIRED_SUBJECT_COUNT);
});

test('missing repaired-subject record is rejected after digest refresh', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  manifest.records.pop();
  refreshSubjectDigest(manifest);
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'cover exactly 60'));
  assert(includesError(errors, 'record 60 is missing'));
});

test('duplicate repaired-subject record is rejected after digest refresh', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  manifest.records[1] = structuredClone(manifest.records[0]);
  refreshSubjectDigest(manifest);
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'record 2 is duplicated'));
  assert(includesError(errors, 'displayPath does not match'));
});

test('changed repaired-subject blob is rejected after digest refresh', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  manifest.records[0].candidateBlob = 'f'.repeat(40);
  refreshSubjectDigest(manifest);
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'candidateBlob does not match'));
});

test('changed repaired-subject mode is rejected after digest refresh', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  manifest.records[0].candidateMode = '100644';
  refreshSubjectDigest(manifest);
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'candidateMode does not match'));
});

test('changed disposition rationale is rejected by its subject digest', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  resolutions[0].rationale = 'forged replacement rationale';
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'rationaleSha256 does not match'));
});

test('changed repaired-subject candidate path is rejected after digest refresh', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  manifest.records[0].candidatePath = 'tests/other.js';
  refreshSubjectDigest(manifest);
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'candidatePath does not match'));
});

test('unknown repaired-subject field is rejected after digest refresh', () => {
  const resolutions = repairedResolutions();
  const manifest = buildSubjectManifest(resolutions);
  manifest.records[0].evidenceSha = '0'.repeat(40);
  refreshSubjectDigest(manifest);
  const errors = validateSubjectManifest(manifest, resolutions).errors;
  assert(includesError(errors, 'fields must be exactly'));
});

test('missing repaired-subject manifest fails closed', () => {
  const result = validateSubjectManifest(null, repairedResolutions());
  assert(includesError(result.errors, 'manifest is required'));
  assertEqual(result.summary.validatedCount, 0);
});

test('repaired-subject source manifest and source sequence are pinned', () => {
  const resolutions = repairedResolutions();
  const wrongSource = buildSubjectManifest(resolutions);
  wrongSource.sourceManifestRecordsSha256 = 'f'.repeat(64);
  assert(includesError(
    validateSubjectManifest(wrongSource, resolutions).errors,
    'source manifest digest does not match',
  ));

  const wrongSequence = buildSubjectManifest(resolutions);
  wrongSequence.records[0].sourceSequence = 99;
  refreshSubjectDigest(wrongSequence);
  assert(includesError(
    validateSubjectManifest(wrongSequence, resolutions).errors,
    'sourceSequence does not match',
  ));
});

test('repaired-subject files must be tracked and worktree-identical to HEAD', () => {
  const cleanErrors = [];
  validateHeadBinding(
    { blob: 'a'.repeat(40), mode: '100644' },
    { blob: 'a'.repeat(40), mode: '100644' },
    'tracked subject',
    cleanErrors,
  );
  assertEqual(cleanErrors.length, 0);

  const changedErrors = [];
  validateHeadBinding(
    { blob: 'b'.repeat(40), mode: '100644' },
    { blob: 'a'.repeat(40), mode: '100644' },
    'tracked subject',
    changedErrors,
  );
  assert(includesError(changedErrors, 'worktree differs from HEAD'));

  const untrackedErrors = [];
  validateHeadBinding(
    { blob: 'a'.repeat(40), mode: '100644' },
    null,
    'untracked subject',
    untrackedErrors,
  );
  assert(includesError(untrackedErrors, 'is not tracked at HEAD'));
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
    riskCount: 31,
    policyCount: 31,
    impactCounts: {
      G0_FAIL: 24,
      G0_REVIEW_REQUIRED: 1,
      LATER_GATE: 3,
      SEPARATE_INCIDENT: 3,
    },
    openImpactCounts: {
      G0_FAIL: 0,
      G0_REVIEW_REQUIRED: 1,
      LATER_GATE: 3,
      SEPARATE_INCIDENT: 3,
    },
    repositoryBlockers: [],
    reviewRequiredRisks: ['G0-R015: OPEN'],
    laterGateRisks: ['G0-R009: OPEN', 'G0-R018: OPEN', 'G0-R030: OPEN'],
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
  assertEqual(result.riskCount, 31);
  assertEqual(result.policyCount, 31);
  assertEqual(result.repositoryBlockers.join(','), '');
  assertEqual(result.reviewRequiredRisks.join(','), 'G0-R015: OPEN');
  assertEqual(
    result.laterGateRisks.join(','),
    'G0-R009: OPEN,G0-R018: OPEN,G0-R030: OPEN',
  );
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
    'G0-R027',
    'G0-R028',
    'G0-R029',
    'G0-R031',
  ]) {
    assertEqual(byId.get(riskId)?.gateImpact, GateImpact.G0_FAIL);
  }
  assertEqual(byId.get('G0-R018')?.gateImpact, GateImpact.LATER_GATE);
  assert(byId.get('G0-R018')?.condition.includes('loopback-only'));
  assertEqual(byId.get('G0-R030')?.gateImpact, GateImpact.LATER_GATE);
  assert(byId.get('G0-R030')?.condition.includes('C3-001 cannot pass Gate 1'));
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

test('removing a policy entry for a reopened risk fails closed', () => {
  const policy = riskPolicyCopy();
  policy.risks = policy.risks.filter(entry => entry.riskId !== 'G0-R014');
  const reopenedMarkdown = committedRiskMarkdown.replace(
    /(\| G0-R014 \|.*\| )MITIGATED \|/,
    '$1OPEN |',
  );
  const result = evaluateGate0RiskPolicy(reopenedMarkdown, policy);
  assertEqual(result.valid, false);
  assert(includesError(result.errors, 'G0-R014: missing valid gateImpact policy'));
  assert(includesError(result.repositoryBlockers, 'G0-R014: OPEN'));
});

test('duplicate and unknown gateImpact entries are rejected', () => {
  const reopenedMarkdown = committedRiskMarkdown.replace(
    /(\| G0-R014 \|.*\| )MITIGATED \|/,
    '$1OPEN |',
  );
  const duplicate = riskPolicyCopy();
  duplicate.risks.push(structuredClone(
    duplicate.risks.find(entry => entry.riskId === 'G0-R014'),
  ));
  const duplicateResult = evaluateGate0RiskPolicy(reopenedMarkdown, duplicate);
  assertEqual(duplicateResult.valid, false);
  assert(includesError(duplicateResult.errors, 'G0-R014: duplicate gateImpact'));
  assert(includesError(duplicateResult.repositoryBlockers, 'G0-R014: OPEN'));

  const unknown = riskPolicyCopy();
  unknown.risks.find(entry => entry.riskId === 'G0-R014').gateImpact = 'IGNORE';
  const unknownResult = evaluateGate0RiskPolicy(reopenedMarkdown, unknown);
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
  assert(!includesError(current.repositoryBlockers, 'G0-R014'));
  const reopenedMarkdown = committedRiskMarkdown.replace(
    /(\| G0-R014 \|.*\| )MITIGATED \|/,
    '$1OPEN |',
  );
  const reopened = evaluateGate0RiskPolicy(reopenedMarkdown, riskPolicyCopy());
  assert(includesError(reopened.repositoryBlockers, 'G0-R014: OPEN'));
});

test('the evidence generator consumes the policy evaluator without a risk-ID allowlist', () => {
  assert(gate0GeneratorSource.includes('buildGate0RiskEvidence({'));
  assert(!gate0GeneratorSource.includes('GATE0_REPOSITORY_BLOCKER_IDS'));
  assert(!gate0GeneratorSource.includes('findOpenGate0RepositoryBlockers'));
});

test('committed risk projection binds both parent blobs and rejects unknown fields', () => {
  const evidence = buildGate0RiskEvidence({
    riskMarkdownBytes: Buffer.from(committedRiskMarkdown),
    policyBytes: Buffer.from(JSON.stringify(committedRiskPolicy)),
  });
  assertEqual(evidence.repositoryBlockers.length, 0);
  assert(/^[a-f0-9]{64}$/.test(evidence.sha256));
  assert(/^[a-f0-9]{64}$/.test(evidence.registerSha256));

  const unknown = riskPolicyCopy();
  unknown.unreviewedOverride = true;
  assertThrows(() => buildGate0RiskEvidence({
    riskMarkdownBytes: Buffer.from(committedRiskMarkdown),
    policyBytes: Buffer.from(JSON.stringify(unknown)),
  }));
});

test('privacy projection binds the incident without republishing private paths', () => {
  const privacyBytes = readFileSync(
    new URL('../docs/convergence/PRIVACY-INCIDENT.json', import.meta.url),
  );
  const evidence = buildPrivacyIncidentEvidence(privacyBytes);
  assertEqual(evidence.status, 'CONFIRMED_COMPROMISE');
  assertEqual(evidence.trackedPathsRemoved, 13);
  assertEqual(evidence.historyReachable, true);
  assert(!JSON.stringify(evidence).includes('trackedObjectManifest'));
  assert(!JSON.stringify(evidence).includes('attachments/'));

  const invalid = JSON.parse(privacyBytes.toString('utf8'));
  invalid.currentTreeContainment.trackedBytesRemoved += 1;
  assertThrows(() => buildPrivacyIncidentEvidence(
    Buffer.from(JSON.stringify(invalid)),
  ));

  const unknown = JSON.parse(privacyBytes.toString('utf8'));
  unknown.privateOverride = true;
  assertThrows(() => buildPrivacyIncidentEvidence(
    Buffer.from(JSON.stringify(unknown)),
  ));
});

test('risk policy validity is a generated Gate 0 clause', () => {
  const clauses = buildGate0Clauses({
    registryValidation: { passed: true, report: { records: 350 }, errors: [] },
    dispositionValidation: { passed: true, report: { records: 225 }, errors: [] },
    sourceEvidence: { passed: true, executionCount: 9 },
    installationEvidence: {
      passed: true,
      logs: [
        { kind: 'clean', exitCode: 0 },
        { kind: 'repeat', exitCode: 0 },
      ],
    },
    deterministicEvidence: {
      passed: true,
      verdict: 'PASS',
      exitCode: 0,
      statusCounts: { PASS: 199 },
    },
    pilotEvidence: Array.from({ length: 5 }, () => ({ passed: true })),
    soakEvidence: { guardPassed: true, verdict: 'BLOCKED', exitCode: 2 },
    evidenceContract: {
      passed: true,
      path: '.intentsmith-artifacts/gate0/provenance.json',
      sha256: 'a'.repeat(64),
    },
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

const provenanceCandidate = 'a'.repeat(40);
const provenanceRegistry = 'b'.repeat(64);
const provenanceEnvironment = { PATH: '/bin', LANG: 'C' };

function validProvenanceFixture(rootPath = '/work/repository') {
  const plan = buildGate0ExecutionPlan({
    root: rootPath,
    candidateSha: provenanceCandidate,
    inheritedEnvironment: provenanceEnvironment,
  });
  const timestamp = '2026-07-30T00:00:00.000Z';
  return {
    schemaVersion: 1,
    manifestType: 'intentsmith.gate0-candidate-evidence',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
    sourceRoot: rootPath,
    evidenceRoot: gate0EvidenceLayout(provenanceCandidate).evidenceRoot,
    startedAt: timestamp,
    endedAt: timestamp,
    secretValuesRecorded: false,
    initialIgnoredState: { clean: true },
    toolchain: {
      schemaVersion: 1,
      platform: 'linux',
      architecture: 'x64',
      nodeVersion: 'v22.18.0',
      nodeExecutableSha256: '1'.repeat(64),
      npmVersion: '10.9.4',
      yarnVersion: '1.22.22',
      pythonVersion: '3.12.3',
      gitVersion: 'git version 2.43.0',
      bashVersion: 'GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)',
      pathSha256: '2'.repeat(64),
    },
    executions: plan.map(execution => ({
      ...execution,
      startedAt: timestamp,
      endedAt: timestamp,
      exitCode: execution.id === 'soak-guard' ? 2 : 0,
      signal: null,
      timedOut: false,
      leakDetected: false,
      cleanupTerminated: true,
      preSourceState: {
        sha: provenanceCandidate,
        statusPorcelain: '',
      },
      postSourceState: {
        sha: provenanceCandidate,
        statusPorcelain: '',
      },
      preIgnoredState: {
        policy: 'gate0-ignored-path-boundary-v1',
        observedAllowedCount: 1,
        unexpectedPathCount: 0,
      },
      postIgnoredState: {
        policy: 'gate0-ignored-path-boundary-v1',
        observedAllowedCount: 1,
        unexpectedPathCount: 0,
      },
      logBytes: 1,
      logSha256: 'c'.repeat(64),
      reportBytes: execution.reportPath === null ? null : 1,
      reportSha256: execution.reportPath === null ? null : 'd'.repeat(64),
      inventoryBytes: execution.inventoryPath === null ? null : 1,
      inventorySha256: execution.inventoryPath === null ? null : 'e'.repeat(64),
    })),
  };
}

test('complete typed Gate 0 provenance matches the locked nine-phase plan', () => {
  const result = validateGate0Provenance({
    provenance: validProvenanceFixture(),
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
    inheritedEnvironment: provenanceEnvironment,
  });
  assertEqual(result.valid, true);
  assertEqual(result.errors.length, 0);
  assertEqual(result.expectedPlan.length, 9);
});

test('typed provenance validation is independent of reviewer environment presence', () => {
  const provenance = validProvenanceFixture();
  for (const inheritedEnvironment of [
    { PATH: '/bin' },
    { PATH: '/bin', LANG: 'C.UTF-8', TZ: 'UTC', EXTRA_REVIEWER_KEY: 'ignored' },
  ]) {
    const result = validateGate0Provenance({
      provenance,
      root: '/work/repository',
      candidateSha: provenanceCandidate,
      registrySha256: provenanceRegistry,
      inheritedEnvironment,
    });
    assertEqual(result.valid, true);
  }
});

test('typed provenance fixes locale and timezone instead of inheriting the host', () => {
  const plan = buildGate0ExecutionPlan({
    root: '/work/repository',
    candidateSha: provenanceCandidate,
  });
  for (const execution of plan) {
    assert(!execution.inheritedEnvironmentKeys.includes('LANG'));
    assert(!execution.inheritedEnvironmentKeys.includes('LC_ALL'));
    assert(!execution.inheritedEnvironmentKeys.includes('TZ'));
    assertEqual(execution.environmentOverrides.LANG, 'C.UTF-8');
    assertEqual(execution.environmentOverrides.LC_ALL, 'C.UTF-8');
    assertEqual(execution.environmentOverrides.TZ, 'UTC');
  }
});

test('typed provenance rejects missing or unknown toolchain identity fields', () => {
  const missing = validProvenanceFixture();
  delete missing.toolchain.pathSha256;
  assertEqual(validateGate0Provenance({
    provenance: missing,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
  }).valid, false);

  const unknown = validProvenanceFixture();
  unknown.toolchain.privateHostPath = '/private/reviewer';
  assertEqual(validateGate0Provenance({
    provenance: unknown,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
  }).valid, false);
});

await testAsync('toolchain capture does not execute npm, Yarn, or Corepack', async () => {
  const fakeBin = path.join(testRoot, 'toolchain-fake-bin');
  const sentinel = path.join(testRoot, 'package-manager-was-executed');
  mkdirSync(fakeBin, { mode: 0o700 });
  for (const command of ['npm', 'yarn', 'corepack']) {
    const executable = path.join(fakeBin, command);
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf called > ${JSON.stringify(sentinel)}\nexit 99\n`,
      { mode: 0o700 },
    );
  }
  const toolchain = await captureToolchain(process.cwd(), {
    PATH: `${fakeBin}:${process.env.PATH}`,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TZ: 'UTC',
  });
  assertEqual(existsSync(sentinel), false);
  assertEqual(toolchain.npmVersion, '10.9.4');
  assertEqual(toolchain.yarnVersion, '1.22.22');
  assert(/^[a-f0-9]{64}$/.test(toolchain.nodeExecutableSha256));
  assert(/^[a-f0-9]{64}$/.test(toolchain.pathSha256));
});

test('typed provenance rejects a no-op install and arbitrary argv', () => {
  const provenance = validProvenanceFixture();
  provenance.executions[0].executable = 'true';
  provenance.executions[0].argv = ['/work/repository'];
  const result = validateGate0Provenance({
    provenance,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
    inheritedEnvironment: provenanceEnvironment,
  });
  assertEqual(result.valid, false);
  assert(result.errors.some(error => error.includes('executable differs')));
  assert(result.errors.some(error => error.includes('argv differs')));
});

test('typed provenance rejects missing, duplicate, and unknown execution fields', () => {
  const missing = validProvenanceFixture();
  missing.executions.pop();
  assertEqual(validateGate0Provenance({
    provenance: missing,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
    inheritedEnvironment: provenanceEnvironment,
  }).valid, false);

  const duplicate = validProvenanceFixture();
  duplicate.executions[1].id = duplicate.executions[0].id;
  assertEqual(validateGate0Provenance({
    provenance: duplicate,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
    inheritedEnvironment: provenanceEnvironment,
  }).valid, false);

  const unknown = validProvenanceFixture();
  unknown.executions[0].freeFormCommand = 'true';
  assertEqual(validateGate0Provenance({
    provenance: unknown,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
    inheritedEnvironment: provenanceEnvironment,
  }).valid, false);
});

test('typed provenance rejects reversed and overlapping serial chronology', () => {
  const reversed = validProvenanceFixture();
  reversed.endedAt = '2026-07-29T23:59:59.000Z';
  assertEqual(validateGate0Provenance({
    provenance: reversed,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
  }).valid, false);

  const overlapping = validProvenanceFixture();
  overlapping.executions[1].startedAt = '2026-07-29T23:59:59.000Z';
  assertEqual(validateGate0Provenance({
    provenance: overlapping,
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    registrySha256: provenanceRegistry,
  }).valid, false);
});

test('portable typed argv preserves a repository path containing spaces', () => {
  const rootPath = '/work/repository with spaces';
  const execution = buildGate0ExecutionPlan({
    root: rootPath,
    candidateSha: provenanceCandidate,
    inheritedEnvironment: provenanceEnvironment,
  })[2];
  const replay = makePortableInvocation(execution, rootPath);
  const rendered = formatPortableInvocation(replay);
  assertEqual(replay.cwd, '$PWD');
  assert(!JSON.stringify(replay).includes(rootPath));
  assert(rendered.startsWith('env -i '));
  assert(rendered.includes('"${PWD}/.intentsmith-artifacts/'));
  assert(rendered.includes('--profile=offline,database'));
});

test('portable replay clears caller secrets and non-allowlisted Node options', () => {
  const rendered = formatPortableInvocation({
    cwd: '$PWD',
    executable: 'node',
    argv: [
      '-e',
      'process.stdout.write(JSON.stringify({aws:process.env.AWS_SECRET_ACCESS_KEY??null,nodeOptions:process.env.NODE_OPTIONS??null}))',
    ],
    inheritedEnvironmentKeys: ['PATH'],
    environmentOverrides: {},
  });
  const child = spawnSync('/bin/sh', ['-c', rendered], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      AWS_SECRET_ACCESS_KEY: 'private-fixture-value',
      NODE_OPTIONS: '--trace-warnings',
    },
  });
  assertEqual(child.error, undefined);
  assertEqual(child.status, 0);
  assertEqual(
    child.stdout,
    JSON.stringify({ aws: null, nodeOptions: null }),
  );
  assert(!rendered.includes('private-fixture-value'));
});

test('sanitized execution evidence never commits porcelain path names', () => {
  const execution = validProvenanceFixture().executions[0];
  execution.preSourceState.statusPorcelain = '?? private-client-name.txt';
  const sanitized = buildSanitizedExecutionEvidence(
    execution,
    '/work/repository',
  );
  assertEqual(sanitized.preSourceState.clean, false);
  assertEqual(sanitized.preSourceState.sha, provenanceCandidate);
  assertEqual(sanitized.postSourceState.clean, true);
  assert(!JSON.stringify(sanitized).includes('private-client-name.txt'));
  assert(!JSON.stringify(sanitized).includes('statusPorcelain'));
});

test('portable typed replay rejects host-absolute and embedded-root values', () => {
  const execution = buildGate0ExecutionPlan({
    root: '/work/repository',
    candidateSha: provenanceCandidate,
    inheritedEnvironment: provenanceEnvironment,
  })[2];
  execution.environmentOverrides.TOOL = '/opt/private/tool';
  assertThrows(() => makePortableInvocation(execution, '/work/repository'));
  delete execution.environmentOverrides.TOOL;
  execution.argv.push('/work/repository-evil/script.js');
  assertThrows(() => makePortableInvocation(execution, '/work/repository'));
});

await testAsync('owned evidence files reject traversal and final symlinks', async () => {
  const repository = path.join(testRoot, 'repository with spaces');
  const layout = gate0EvidenceLayout(provenanceCandidate);
  const evidenceRoot = path.join(repository, layout.evidenceRoot);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  const regular = path.join(evidenceRoot, 'report.json');
  writeFileSync(regular, '{}\n', { mode: 0o600 });
  const accepted = await resolveOwnedEvidenceFile({
    root: repository,
    evidenceRoot: layout.evidenceRoot,
    relativePath: `${layout.evidenceRoot}/report.json`,
    label: 'fixture report',
  });
  assertEqual(accepted.bytes, 3);

  chmodSync(evidenceRoot, 0o777);
  let publicRootRejected = false;
  try {
    await resolveOwnedEvidenceFile({
      root: repository,
      evidenceRoot: layout.evidenceRoot,
      relativePath: `${layout.evidenceRoot}/report.json`,
      label: 'public-root report',
    });
  } catch {
    publicRootRejected = true;
  }
  assertEqual(publicRootRejected, true);
  chmodSync(evidenceRoot, 0o700);

  chmodSync(regular, 0o644);
  let publicFileRejected = false;
  try {
    await resolveOwnedEvidenceFile({
      root: repository,
      evidenceRoot: layout.evidenceRoot,
      relativePath: `${layout.evidenceRoot}/report.json`,
      label: 'public-file report',
    });
  } catch {
    publicFileRejected = true;
  }
  assertEqual(publicFileRejected, true);
  chmodSync(regular, 0o600);

  let traversalRejected = false;
  try {
    await resolveOwnedEvidenceFile({
      root: repository,
      evidenceRoot: layout.evidenceRoot,
      relativePath: '../report.json',
      label: 'traversal report',
    });
  } catch {
    traversalRejected = true;
  }
  assertEqual(traversalRejected, true);

  const outside = path.join(repository, 'outside.json');
  writeFileSync(outside, '{}\n', { mode: 0o600 });
  symlinkSync(outside, path.join(evidenceRoot, 'linked.json'));
  let symlinkRejected = false;
  try {
    await resolveOwnedEvidenceFile({
      root: repository,
      evidenceRoot: layout.evidenceRoot,
      relativePath: `${layout.evidenceRoot}/linked.json`,
      label: 'linked report',
    });
  } catch {
    symlinkRejected = true;
  }
  assertEqual(symlinkRejected, true);

  const outsideDirectory = path.join(repository, 'outside-directory');
  mkdirSync(outsideDirectory, { mode: 0o700 });
  writeFileSync(path.join(outsideDirectory, 'nested.json'), '{}\n', { mode: 0o600 });
  symlinkSync(outsideDirectory, path.join(evidenceRoot, 'linked-directory'));
  let ancestorSymlinkRejected = false;
  try {
    await resolveOwnedEvidenceFile({
      root: repository,
      evidenceRoot: layout.evidenceRoot,
      relativePath: `${layout.evidenceRoot}/linked-directory/nested.json`,
      label: 'ancestor-linked report',
    });
  } catch {
    ancestorSymlinkRejected = true;
  }
  assertEqual(ancestorSymlinkRejected, true);

  const redirectedRepository = path.join(testRoot, 'inside-root-redirect');
  const redirectedTarget = path.join(redirectedRepository, 'redirect');
  const redirectedEvidence = path.join(
    redirectedTarget,
    'gate0',
    `candidate-${provenanceCandidate}`,
  );
  mkdirSync(redirectedEvidence, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(redirectedEvidence, 'report.json'),
    '{}\n',
    { mode: 0o600 },
  );
  symlinkSync(
    redirectedTarget,
    path.join(redirectedRepository, '.intentsmith-artifacts'),
  );
  let insideRootAncestorSymlinkRejected = false;
  try {
    await resolveOwnedEvidenceFile({
      root: redirectedRepository,
      evidenceRoot: layout.evidenceRoot,
      relativePath: `${layout.evidenceRoot}/report.json`,
      label: 'inside-root ancestor-linked report',
    });
  } catch {
    insideRootAncestorSymlinkRejected = true;
  }
  assertEqual(insideRootAncestorSymlinkRejected, true);
});

function buildAuditContractFixture(label) {
  const repository = path.join(testRoot, `audit-contract-${label}`);
  mkdirSync(repository, { recursive: true, mode: 0o700 });
  const plan = buildGate0ExecutionPlan({
    root: repository,
    candidateSha: provenanceCandidate,
    inheritedEnvironment: provenanceEnvironment,
  });
  const execution = { ...plan[3] };
  execution.exitCode = 0;
  const suiteRecord = committedRegistry.suites.find(
    suiteRecord => suiteRecord.id === 'IS-T2-TESTS-PILOT-C1C2C3-TEST',
  );
  const inventorySuite = {
    ...suiteRecord,
    category: suiteRecord.profile,
    command: suiteRecord.argv,
    blockers: [],
  };
  const options = {
    concurrency: 1,
    failFast: false,
    timeoutMs: 5 * 60 * 1000,
    deadlineMs: 60 * 60 * 1000,
    profiles: [],
    ids: [suiteRecord.id],
    exclude: [],
    allowBlockers: [],
    noBlock: false,
    allowDirty: false,
  };
  const reportOptions = { ...options };
  delete reportOptions.allowDirty;
  const optionsFingerprint = createHash('sha256')
    .update(JSON.stringify(options))
    .digest('hex');
  const inventoryFingerprint = createHash('sha256').update(JSON.stringify([{
    id: inventorySuite.id,
    path: inventorySuite.path,
    profile: inventorySuite.profile,
    tier: inventorySuite.tier,
    command: inventorySuite.command,
    blockers: inventorySuite.blockers,
    required: inventorySuite.required,
    state: inventorySuite.state,
    requirements: inventorySuite.requirements,
    timeoutMs: inventorySuite.timeoutMs,
    expectedDurationMs: inventorySuite.expectedDurationMs,
  }])).digest('hex');
  const timestamp = '2026-07-30T00:00:00.000Z';
  execution.startedAt = timestamp;
  execution.endedAt = timestamp;
  const runDir = path.dirname(execution.reportPath).split(path.sep).join('/');
  const safeLogName = `${suiteRecord.path.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.${createHash('sha1')
    .update(suiteRecord.path)
    .digest('hex')
    .slice(0, 8)}`;
  const suiteLogPath = `${runDir}/logs/${safeLogName}.log`;
  const suiteLogContents = 'pilot pass\n';
  const suiteLogSha256 = createHash('sha256')
    .update(suiteLogContents)
    .digest('hex');
  const counts = {
    offline: 0,
    database: 1,
    server: 0,
    model: 0,
    soak: 0,
    manual: 0,
  };
  const inventory = {
    schemaVersion: 1,
    manifestType: 'intentsmith.audit-inventory',
    runId: execution.argv.find(value => value.startsWith('--run-id='))
      .slice('--run-id='.length),
    sourceRevision: provenanceCandidate,
    generatedAt: timestamp,
    counts,
    blockerCounts: {},
    inventoryFingerprint,
    optionsFingerprint,
    registryHash: provenanceRegistry,
    options,
    suites: [inventorySuite],
  };
  const result = {
    id: suiteRecord.id,
    path: suiteRecord.path,
    profile: suiteRecord.profile,
    category: suiteRecord.profile,
    command: suiteRecord.argv,
    blockers: [],
    required: true,
    start: timestamp,
    end: timestamp,
    durationMs: 0,
    exitCode: 0,
    signal: null,
    timedOut: false,
    status: 'PASS',
    retryCount: 0,
    logPath: suiteLogPath,
    sourceRevision: provenanceCandidate,
    cleanup: {
      checked: true,
      leakDetected: false,
      terminated: true,
    },
    sourceTree: {
      checked: true,
      clean: true,
      porcelain: null,
      head: provenanceCandidate,
    },
    logSha256: suiteLogSha256,
    logError: null,
    outputError: null,
  };
  const report = {
    schemaVersion: 1,
    manifestType: 'intentsmith.audit-report',
    runId: inventory.runId,
    sourceRevision: provenanceCandidate,
    startedAt: timestamp,
    endedAt: timestamp,
    dryRun: false,
    options: reportOptions,
    paths: {
      sourceRoot: repository,
      runDir,
      report: execution.reportPath,
      checkpoint: `${runDir}/checkpoint.json`,
      inventory: execution.inventoryPath,
    },
    inventoryFingerprint,
    optionsFingerprint,
    registryHash: provenanceRegistry,
    interruptionSignal: null,
    inventory: {
      total: 1,
      counts,
      blockerCounts: {},
    },
    statusCounts: {
      PASS: 1,
      FAIL: 0,
      TIMEOUT: 0,
      BLOCKED: 0,
      SKIPPED: 0,
    },
    verdict: 'PASS',
    exitCode: 0,
    requiredFailureCount: 0,
    requiredBlockedCount: 0,
    results: [result],
  };
  const writeJson = (relativePath, value) => {
    const absolutePath = path.join(repository, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(absolutePath, contents, { mode: 0o600 });
    return {
      bytes: Buffer.byteLength(contents),
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  };
  mkdirSync(path.dirname(path.join(repository, suiteLogPath)), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(path.join(repository, suiteLogPath), suiteLogContents, { mode: 0o600 });
  const refreshBindings = () => {
    const reportBinding = writeJson(execution.reportPath, report);
    const inventoryBinding = writeJson(execution.inventoryPath, inventory);
    execution.reportBytes = reportBinding.bytes;
    execution.reportSha256 = reportBinding.sha256;
    execution.inventoryBytes = inventoryBinding.bytes;
    execution.inventorySha256 = inventoryBinding.sha256;
  };
  refreshBindings();
  return {
    repository,
    execution,
    suiteRecord,
    report,
    inventory,
    suiteLogPath,
    refreshBindings,
  };
}

await testAsync('audit evidence binds report, inventory, options, counters, and suite log', async () => {
  const fixture = buildAuditContractFixture('positive');
  const result = await loadAndValidateAuditEvidence({
    root: fixture.repository,
    evidenceRoot: gate0EvidenceLayout(provenanceCandidate).evidenceRoot,
    execution: fixture.execution,
    candidateSha: provenanceCandidate,
    registryHash: provenanceRegistry,
    expectedSuites: [fixture.suiteRecord],
    expectedOptions: fixture.inventory.options,
  });
  assertEqual(result.passed, true);
  assertEqual(result.report.verdict, 'PASS');
});

await testAsync('audit evidence rejects allowDirty and recomputed forged counters', async () => {
  const fixture = buildAuditContractFixture('mutated');
  fixture.inventory.options.allowDirty = true;
  fixture.report.statusCounts = {
    PASS: 0,
    FAIL: 1,
    TIMEOUT: 0,
    BLOCKED: 0,
    SKIPPED: 0,
  };
  fixture.refreshBindings();
  let rejected = false;
  try {
    await loadAndValidateAuditEvidence({
      root: fixture.repository,
      evidenceRoot: gate0EvidenceLayout(provenanceCandidate).evidenceRoot,
      execution: fixture.execution,
      candidateSha: provenanceCandidate,
      registryHash: provenanceRegistry,
      expectedSuites: [fixture.suiteRecord],
      expectedOptions: {
        ...fixture.inventory.options,
        allowDirty: false,
      },
    });
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true);
});

await testAsync('audit evidence rejects changed suite-log bytes', async () => {
  const fixture = buildAuditContractFixture('log-mutation');
  writeFileSync(
    path.join(fixture.repository, fixture.suiteLogPath),
    'tampered\n',
    { mode: 0o600 },
  );
  let rejected = false;
  try {
    await loadAndValidateAuditEvidence({
      root: fixture.repository,
      evidenceRoot: gate0EvidenceLayout(provenanceCandidate).evidenceRoot,
      execution: fixture.execution,
      candidateSha: provenanceCandidate,
      registryHash: provenanceRegistry,
      expectedSuites: [fixture.suiteRecord],
      expectedOptions: fixture.inventory.options,
    });
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true);
});

test('audit evidence rejects duplicate or non-deterministic result log paths', () => {
  const suites = [
    { id: 'suite-a', path: 'tests/a.test.js' },
    { id: 'suite-b', path: 'tests/b.test.js' },
  ];
  const results = [
    {
      id: 'suite-a',
      status: 'PASS',
      logPath: 'audit/run/logs/shared.log',
    },
    {
      id: 'suite-b',
      status: 'PASS',
      logPath: 'audit/run/logs/shared.log',
    },
  ];
  const errors = auditResultLogIdentityErrors({
    results,
    expectedSuites: suites,
    expectedRunDir: 'audit/run',
  });
  assert(errors.some(error => error.includes('reuses another result log path')));
  assert(errors.some(error => error.includes('deterministic path')));
});

test('valid red producer outcomes become failed clauses instead of false green', () => {
  const clauses = buildGate0Clauses({
    registryValidation: { passed: true, report: { records: 350 }, errors: [] },
    dispositionValidation: { passed: true, report: { records: 225 }, errors: [] },
    sourceEvidence: { passed: false, executionCount: 9 },
    installationEvidence: {
      passed: false,
      logs: [
        { kind: 'clean', exitCode: 1 },
        { kind: 'repeat', exitCode: 0 },
      ],
    },
    deterministicEvidence: {
      passed: false,
      verdict: 'FAIL',
      exitCode: 1,
      statusCounts: { PASS: 198, FAIL: 1 },
    },
    pilotEvidence: [
      { passed: true },
      { passed: true },
      { passed: false },
      { passed: true },
      { passed: true },
    ],
    soakEvidence: { guardPassed: false, verdict: 'PASS', exitCode: 0 },
    evidenceContract: {
      passed: true,
      path: '.intentsmith-artifacts/gate0/provenance.json',
      sha256: 'a'.repeat(64),
    },
    runnablePrograms: 350,
    explicitSupportExclusions: 8,
    stateCounts: { ACTIVE: 271 },
    blockedWithoutPrerequisite: [],
    knownDefectiveInDeterministic: [],
    riskAssessment: riskAssessmentCopy(),
  });
  for (const clauseId of ['G0-C1', 'G0-C4', 'G0-C5', 'G0-C7']) {
    assertEqual(clauses.find(clause => clause.id === clauseId).result, 'FAIL');
  }
  assertEqual(
    deriveGateOutcome({ clauses }).verdict,
    'FAIL',
  );
});

suite('Gate 0 independent review result contract');

function validReviewResultFixture() {
  const candidateSha = 'a'.repeat(40);
  const pendingAttestationSha = 'b'.repeat(40);
  const registryFingerprint = 'c'.repeat(64);
  const reviewRange =
    `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab..${candidateSha}`;
  const packetSha256 = 'd'.repeat(64);
  const reviewRequiredRisks = ['G0-R015: OPEN'];
  return {
    expected: {
      candidateSha,
      pendingAttestationSha,
      registryFingerprint,
      reviewRange,
      packetSha256,
      reviewRequiredRisks,
    },
    result: {
      schemaVersion: 1,
      gate: 'Gate 0',
      candidateSha,
      pendingAttestationSha,
      registryFingerprintAlgorithm:
        GATE0_REGISTRY_FINGERPRINT_ALGORITHM,
      registryFingerprint,
      reviewRange,
      packetPath: GATE0_REVIEW_PACKET_PATH,
      packetSha256,
      reviewRequiredRisks,
      reviewerRole: GATE0_REVIEWER_ROLE,
      reviewMethod: GATE0_REVIEW_METHOD,
      completedAt: '2026-07-31T00:00:00.000Z',
      decision: 'APPROVED',
      findings: [{
        id: 'G0-REV-001',
        severity: 'LOW',
        blocking: false,
        summary: 'Non-blocking fixture finding.',
      }],
    },
  };
}

test('complete exact independent review result is accepted', () => {
  const fixture = validReviewResultFixture();
  const report = validateGate0ReviewResult(fixture.result, fixture.expected);
  assertEqual(report.valid, true);
  assertEqual(report.approved, true);
  assertEqual(report.errors.length, 0);
});

test('independent review result binds candidate, pending evidence, and packet', () => {
  for (const field of [
    'candidateSha',
    'pendingAttestationSha',
    'registryFingerprint',
    'reviewRange',
    'packetSha256',
  ]) {
    const fixture = validReviewResultFixture();
    fixture.result[field] = field.endsWith('Sha')
      ? 'e'.repeat(40)
      : field.includes('Fingerprint') || field.includes('Sha256')
        ? 'e'.repeat(64)
        : `${fixture.result[field]}-changed`;
    assertEqual(
      validateGate0ReviewResult(fixture.result, fixture.expected).valid,
      false,
      `${field} drift must be rejected`,
    );
  }
});

test('independent review result rejects unknown fields and unsafe decisions', () => {
  const unknown = validReviewResultFixture();
  unknown.result.manualOverride = true;
  assertEqual(
    validateGate0ReviewResult(unknown.result, unknown.expected).valid,
    false,
  );

  const decision = validReviewResultFixture();
  decision.result.decision = 'CHANGES_REQUIRED';
  assertEqual(
    validateGate0ReviewResult(decision.result, decision.expected).valid,
    false,
  );

  const blocking = validReviewResultFixture();
  blocking.result.findings[0].blocking = true;
  assertEqual(
    validateGate0ReviewResult(blocking.result, blocking.expected).valid,
    false,
  );
});

test('independent review result binds the exact review-required risk set', () => {
  const missing = validReviewResultFixture();
  missing.result.reviewRequiredRisks = [];
  assertEqual(
    validateGate0ReviewResult(missing.result, missing.expected).valid,
    false,
  );

  const duplicate = validReviewResultFixture();
  duplicate.result.reviewRequiredRisks = [
    'G0-R015: OPEN',
    'G0-R015: OPEN',
  ];
  assertEqual(
    validateGate0ReviewResult(duplicate.result, duplicate.expected).valid,
    false,
  );

  const unsorted = validReviewResultFixture();
  unsorted.expected.reviewRequiredRisks = [
    'G0-R015: OPEN',
    'G0-R014: OPEN',
  ];
  assertEqual(
    validateGate0ReviewResult(unsorted.result, unsorted.expected).valid,
    false,
  );
});

test('independent review result parser fails closed on invalid JSON', () => {
  const fixture = validReviewResultFixture();
  const report = parseGate0ReviewResult(
    Buffer.from('{"schemaVersion":'),
    fixture.expected,
  );
  assertEqual(report.valid, false);
  assertEqual(report.approved, false);
  assertEqual(report.result, null);
  assertEqual(report.sha256.length, 64);
});

function validAttestationFixture() {
  const candidateSha = 'a'.repeat(40);
  const expectedRegistrySha256 = 'c'.repeat(64);
  const timestamp = '2026-07-30T00:00:00.000Z';
  const syntheticRoot = '/intentsmith-gate0-candidate';
  const plan = buildGate0ExecutionPlan({
    root: syntheticRoot,
    candidateSha,
  });
  const executionEvidence = (execution, index) => ({
    id: execution.id,
    portableReplay: makePortableInvocation(execution, syntheticRoot),
    startedAt: timestamp,
    endedAt: timestamp,
    exitCode: execution.id === 'soak-guard' ? 2 : 0,
    signal: null,
    timedOut: false,
    leakDetected: false,
    cleanupTerminated: true,
    log: execution.logPath,
    logBytes: index + 1,
    logSha256: index.toString(16).padStart(64, '0'),
    report: execution.reportPath,
    reportBytes: execution.reportPath === null ? null : index + 10,
    reportSha256: execution.reportPath === null
      ? null : (index + 10).toString(16).padStart(64, '0'),
    inventory: execution.inventoryPath,
    inventoryBytes: execution.inventoryPath === null ? null : index + 20,
    inventorySha256: execution.inventoryPath === null
      ? null : (index + 20).toString(16).padStart(64, '0'),
    preSourceState: { sha: candidateSha, clean: true },
    postSourceState: { sha: candidateSha, clean: true },
    preIgnoredState: {
      policy: 'gate0-ignored-path-boundary-v1',
      observedAllowedCount: 1,
      unexpectedPathCount: 0,
    },
    postIgnoredState: {
      policy: 'gate0-ignored-path-boundary-v1',
      observedAllowedCount: 1,
      unexpectedPathCount: 0,
    },
  });
  const executions = plan.map(executionEvidence);
  const auditEvidence = (executionIndex, statusCounts, overrides = {}) => {
    const execution = executions[executionIndex];
    const recipe = plan[executionIndex];
    return {
      runId: recipe.argv.find(value => value.startsWith('--run-id='))
        .slice('--run-id='.length),
      passed: true,
      verdict: 'PASS',
      exitCode: 0,
      statusCounts,
      report: execution.report,
      reportSha256: execution.reportSha256,
      reportBytes: execution.reportBytes,
      inventory: execution.inventory,
      inventorySha256: execution.inventorySha256,
      inventoryBytes: execution.inventoryBytes,
      inventoryFingerprint: (executionIndex + 30)
        .toString(16).padStart(64, '0'),
      optionsFingerprint: (executionIndex + 40)
        .toString(16).padStart(64, '0'),
      startedAt: timestamp,
      endedAt: timestamp,
      execution,
      ...overrides,
    };
  };
  const registryValidation = {
    command: 'node scripts/validate-test-registry.js --json',
    exitCode: 0,
    outputSha256: '3'.repeat(64),
    reportSha256: '4'.repeat(64),
    errors: [],
    report: {
      schemaVersion: 1,
      valid: true,
      runnablePrograms: 350,
      explicitSupportExclusions: 8,
      fingerprint: expectedRegistrySha256,
      document: {
        path: 'docs/convergence/TEST-REGISTRY.md',
        mode: 'check',
      },
    },
  };
  const dispositionValidation = {
    command: 'node scripts/validate-final-disposition.js --json',
    exitCode: 0,
    outputSha256: '5'.repeat(64),
    reportSha256: '6'.repeat(64),
    errors: [],
    report: {
      schemaVersion: 3,
      sourceRepository: {
        identity: 'github.com/Belphareon-bak/C3-agent',
      },
      sourceRange: {
        base: 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f',
        head: 'ffd21cf119865259ea1847af989acb24916bebe3',
      },
      sourceManifest: { recordCount: 225 },
      repairedSubjectEvidence: { validatedCount: 60 },
      records: 225,
      dispositionCounts: { EXCLUDE: 91, KEEP: 42, REBUILD: 92 },
      terminalCounts: { REPAIRED: 60, 'DEFERRED(owned-server)': 32 },
      resolutionCounts: { ABSENT: 91, EXACT: 32, MODIFIED: 102 },
      pathsCount: 225,
      pathsSha256: '7'.repeat(64),
    },
  };
  const riskPolicy = {
    path: 'docs/convergence/GATE0-RISK-IMPACT.json',
    schemaVersion: 1,
    sha256: '8'.repeat(64),
    registerPath: 'docs/convergence/RISK-REGISTER.md',
    registerSha256: '9'.repeat(64),
    valid: true,
    errors: [],
    riskCount: 28,
    policyCount: 28,
    impactCounts: {
      G0_FAIL: 22,
      G0_REVIEW_REQUIRED: 1,
      LATER_GATE: 2,
      SEPARATE_INCIDENT: 3,
    },
    openImpactCounts: {
      G0_FAIL: 0,
      G0_REVIEW_REQUIRED: 1,
      LATER_GATE: 2,
      SEPARATE_INCIDENT: 3,
    },
    repositoryBlockers: [],
    reviewRequiredRisks: ['G0-R015: OPEN'],
    laterGateRisks: ['G0-R019: OPEN', 'G0-R020: OPEN'],
    separateIncidents: [
      'G0-R017: OPEN',
      'G0-R018: OPEN',
      'G0-R028: OPEN',
    ],
  };
  const privacyIncident = {
    path: 'docs/convergence/PRIVACY-INCIDENT.json',
    schemaVersion: 1,
    sha256: 'a'.repeat(64),
    incidentId: 'G0-PRIVACY-001',
    status: 'CONFIRMED_COMPROMISE',
    trackedPathsRemoved: 13,
    trackedBytesRemoved: 7617363,
    historyReachable: true,
    historyRewritten: false,
    personalContentInspected: false,
    rotationCategories: ['credential category'],
  };
  const outputArtifacts = Object.fromEntries(
    GATE0_BOUND_OUTPUTS.map(filePath => [
      filePath,
      `generated fixture for ${filePath}\n`,
    ]),
  );
  const evidenceIndex = {
      schemaVersion: 7,
      product: 'IntentSmith',
      gate: 'Gate 0',
      verdict: 'CONDITIONAL PASS',
      exitCode: 0,
      generatedAt: timestamp,
      candidate: {
        sha: candidateSha,
        branch: 'codex/intentsmith-1.0',
        registrySha256: expectedRegistrySha256,
        attestationRule: GATE0_PENDING_ATTESTATION_RULE,
      },
      sourceRefs: {
        c3Input: 'ffd21cf119865259ea1847af989acb24916bebe3',
        c3Parent: 'a7b90e36aa80310305703f54f2332e1c0e7f9e8f',
        intentSmithDonor: '6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4',
        localValidationCandidate: candidateSha,
      },
      inventory: {
        runnablePrograms: 350,
        explicitSupportExclusions: 8,
        deterministicRequired: 199,
        dispositionRecords: 225,
        profileCounts: {
          offline: 173,
          database: 26,
          server: 36,
          model: 82,
          soak: 18,
          manual: 15,
        },
        stateCounts: {
          ACTIVE: 256,
          BLOCKED: 79,
          HISTORICAL: 15,
        },
      },
      clauses: Array.from({ length: 9 }, (_, index) => ({
        id: `G0-C${index + 1}`,
        label: `clause ${index + 1}`,
        result: 'PASS',
        evidence: 'fixture evidence',
      })),
      repositoryBlockers: [],
      provenance: {
        schemaVersion: 1,
        path: gate0EvidenceLayout(candidateSha).provenance,
        sha256: '1'.repeat(64),
        bytes: 1,
        executionCount: 9,
        secretValuesRecorded: false,
        initialIgnoredState: { clean: true },
        startedAt: timestamp,
        endedAt: timestamp,
        toolchain: {
          schemaVersion: 1,
          platform: 'linux',
          architecture: 'x64',
          nodeVersion: 'v22.18.0',
          nodeExecutableSha256: '2'.repeat(64),
          npmVersion: '10.9.4',
          yarnVersion: '1.22.22',
          pythonVersion: '3.12.3',
          gitVersion: 'git version 2.43.0',
          bashVersion:
            'GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)',
          pathSha256: '3'.repeat(64),
        },
      },
      riskPolicy,
      validations: {
        registry: registryValidation,
        disposition: dispositionValidation,
      },
      installation: {
        passed: true,
        logs: [
          {
            kind: 'clean',
            path: executions[0].log,
            bytes: executions[0].logBytes,
            sha256: executions[0].logSha256,
            exitCode: executions[0].exitCode,
            execution: executions[0],
          },
          {
            kind: 'repeat',
            path: executions[1].log,
            bytes: executions[1].logBytes,
            sha256: executions[1].logSha256,
            exitCode: executions[1].exitCode,
            execution: executions[1],
          },
        ],
      },
      deterministic: auditEvidence(2, {
        PASS: 199,
        FAIL: 0,
        TIMEOUT: 0,
        BLOCKED: 0,
        SKIPPED: 0,
      }),
      pilotFiveConsecutive: Array.from(
        { length: 5 },
        (_, index) => auditEvidence(index + 3, {
          PASS: 1,
          FAIL: 0,
          TIMEOUT: 0,
          BLOCKED: 0,
          SKIPPED: 0,
        }),
      ),
      soakRequirementGuard: auditEvidence(8, {
        PASS: 0,
        FAIL: 0,
        TIMEOUT: 0,
        BLOCKED: 5,
        SKIPPED: 0,
      }, {
        passed: false,
        verdict: 'BLOCKED',
        exitCode: 2,
        guardPassed: true,
        blockedBy: ['gpu', 'ollama'],
      }),
      privacyIncident,
      review: {
        range:
          `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab..${candidateSha}`,
        commitCount: 1,
        packet: 'docs/convergence/reviews/GATE0-OPUS-REVIEW.md',
        independentReviewStatus: 'PENDING',
      },
      generatedOutputs: Object.fromEntries(
        Object.entries(outputArtifacts).map(([filePath, contents]) => [
          filePath,
          {
            bytes: Buffer.byteLength(contents),
            sha256: createHash('sha256').update(contents).digest('hex'),
          },
        ]),
      ),
    };
  return {
    headSha: 'b'.repeat(40),
    parentShas: [candidateSha],
    changedEntries: GATE0_ATTESTATION_OUTPUTS.map(
      filePath => `M\t${filePath}`,
    ),
    evidenceIndex,
    outputArtifacts,
    outputModes: Object.fromEntries(
      GATE0_ATTESTATION_OUTPUTS.map(filePath => [filePath, '100644']),
    ),
    expectedRegistrySha256,
    expectedRegistryFacts: {
      runnablePrograms: 350,
      explicitSupportExclusions: 8,
      profileCounts: {
        offline: 173,
        database: 26,
        server: 36,
        model: 82,
        soak: 18,
        manual: 15,
      },
      stateCounts: {
        ACTIVE: 256,
        BLOCKED: 79,
        HISTORICAL: 15,
      },
      deterministicRequired: 199,
      deterministicScopeValid: true,
      knownDefectiveInDeterministic: [],
      blockedWithoutPrerequisite: [],
    },
    expectedRegistryValidation: JSON.parse(JSON.stringify(registryValidation)),
    expectedDispositionValidation:
      JSON.parse(JSON.stringify(dispositionValidation)),
    expectedRiskPolicy: JSON.parse(JSON.stringify(riskPolicy)),
    expectedPrivacyIncident: JSON.parse(JSON.stringify(privacyIncident)),
    revalidationInputScopes:
      buildGate0RevalidationInputScopes(committedManifest),
    worktreeClean: true,
  };
}

function validApprovedAttestationFixture() {
  const pendingAttestation = validAttestationFixture();
  const pendingIndex = pendingAttestation.evidenceIndex;
  const reviewResultSha = 'd'.repeat(40);
  const reviewFixture = validReviewResultFixture();
  const packetBytes = Buffer.from(
    pendingAttestation.outputArtifacts[GATE0_REVIEW_PACKET_PATH],
  );
  reviewFixture.result.candidateSha = pendingIndex.candidate.sha;
  reviewFixture.result.pendingAttestationSha = pendingAttestation.headSha;
  reviewFixture.result.registryFingerprint =
    pendingIndex.candidate.registrySha256;
  reviewFixture.result.reviewRange = pendingIndex.review.range;
  reviewFixture.result.packetSha256 =
    createHash('sha256').update(packetBytes).digest('hex');
  reviewFixture.result.reviewRequiredRisks =
    [...pendingIndex.riskPolicy.reviewRequiredRisks];
  const resultBytes = Buffer.from(
    `${JSON.stringify(reviewFixture.result, null, 2)}\n`,
  );
  const promotion = buildApprovedGate0Promotion({
    pendingAttestationSha: pendingAttestation.headSha,
    reviewResultSha,
    pendingIndex,
    pendingArtifacts: pendingAttestation.outputArtifacts,
    reviewResultBytes: resultBytes,
  });
  assertEqual(promotion.valid, true);
  const { evidenceIndex, outputArtifacts } = promotion;

  return {
    headSha: 'e'.repeat(40),
    parentShas: [reviewResultSha],
    changedEntries: GATE0_ATTESTATION_OUTPUTS.map(
      filePath => `M\t${filePath}`,
    ),
    evidenceIndex,
    outputArtifacts,
    outputModes: Object.fromEntries(
      GATE0_ATTESTATION_OUTPUTS.map(filePath => [filePath, '100644']),
    ),
    pendingAttestation,
    reviewResultCommit: {
      headSha: reviewResultSha,
      parentShas: [pendingAttestation.headSha],
      changedEntries: [`A\t${GATE0_REVIEW_RESULT_PATH}`],
      resultBytes,
      resultMode: '100644',
    },
    expectedRegistrySha256:
      pendingAttestation.expectedRegistrySha256,
    expectedRegistryValidation:
      pendingAttestation.expectedRegistryValidation,
    expectedRegistryFacts:
      pendingAttestation.expectedRegistryFacts,
    expectedDispositionValidation:
      pendingAttestation.expectedDispositionValidation,
    expectedRiskPolicy:
      pendingAttestation.expectedRiskPolicy,
    expectedPrivacyIncident:
      pendingAttestation.expectedPrivacyIncident,
    revalidationInputScopes:
      pendingAttestation.revalidationInputScopes,
    worktreeClean: true,
  };
}

test('approved attestation validates the complete candidate-review chain', () => {
  const fixture = validApprovedAttestationFixture();
  const report = validateGate0ApprovedAttestation(fixture);
  assertEqual(report.valid, true);
  assertEqual(report.errors.length, 0);
  assertEqual(fixture.evidenceIndex.schemaVersion, 8);
  assertEqual(fixture.evidenceIndex.verdict, 'PASS');
  assertEqual(
    fixture.evidenceIndex.review.independentReviewStatus,
    ReviewStatus.APPROVED,
  );
  for (const filePath of GATE0_BOUND_OUTPUTS) {
    const approved = fixture.outputArtifacts[filePath];
    const pending = Buffer.from(
      fixture.pendingAttestation.outputArtifacts[filePath],
    );
    assert(
      approved.includes(Buffer.from('- Verdict: **PASS**\n')),
      `${filePath} must carry the PASS approval envelope`,
    );
    assert(
      approved.includes(Buffer.from('- Independent review: **APPROVED**\n')),
      `${filePath} must carry the APPROVED review envelope`,
    );
    assert(
      approved.subarray(approved.length - pending.length).equals(pending),
      `${filePath} must preserve the reviewed pending bytes as its suffix`,
    );
    assert(
      !approved.equals(pending),
      `${filePath} must differ from the pending artifact`,
    );
  }
});

test('approved promotion is byte-deterministic for identical E and R', () => {
  const fixture = validApprovedAttestationFixture();
  const repeated = buildApprovedGate0Promotion({
    pendingAttestationSha: fixture.pendingAttestation.headSha,
    reviewResultSha: fixture.reviewResultCommit.headSha,
    pendingIndex: fixture.pendingAttestation.evidenceIndex,
    pendingArtifacts: fixture.pendingAttestation.outputArtifacts,
    reviewResultBytes: fixture.reviewResultCommit.resultBytes,
  });
  assertEqual(repeated.valid, true);
  assertEqual(
    JSON.stringify(repeated.evidenceIndex),
    JSON.stringify(fixture.evidenceIndex),
  );
  for (const filePath of GATE0_BOUND_OUTPUTS) {
    assert(repeated.outputArtifacts[filePath].equals(
      fixture.outputArtifacts[filePath],
    ));
  }
});

test('approved attestation rejects manually rebound Markdown', () => {
  const fixture = validApprovedAttestationFixture();
  const forged = Buffer.from('# forged Gate 0 PASS\n');
  fixture.outputArtifacts['docs/convergence/STATUS.md'] = forged;
  fixture.evidenceIndex.generatedOutputs[
    'docs/convergence/STATUS.md'
  ] = {
    bytes: forged.length,
    sha256: createHash('sha256').update(forged).digest('hex'),
  };
  assertEqual(validateGate0ApprovedAttestation(fixture).valid, false);
});

test('attestation topology resolves physical schema-7 and schema-8 parents', () => {
  const candidateSha = 'a'.repeat(40);
  const pendingAttestationSha = 'b'.repeat(40);
  const reviewResultSha = 'd'.repeat(40);
  const approvedAttestationSha = 'e'.repeat(40);
  const pending = resolveGate0AttestationChain({
    headSha: pendingAttestationSha,
    parentShas: [candidateSha],
    schemaVersion: 7,
  });
  assertEqual(pending.valid, true);
  assertEqual(pending.candidateSha, candidateSha);
  assertEqual(pending.pendingAttestationSha, pendingAttestationSha);

  const approved = resolveGate0AttestationChain({
    headSha: approvedAttestationSha,
    parentShas: [reviewResultSha],
    schemaVersion: 8,
    reviewRevision: {
      headSha: reviewResultSha,
      parentShas: [pendingAttestationSha],
    },
    pendingRevision: {
      headSha: pendingAttestationSha,
      parentShas: [candidateSha],
    },
  });
  assertEqual(approved.valid, true);
  assertEqual(approved.candidateSha, candidateSha);
  assertEqual(approved.pendingAttestationSha, pendingAttestationSha);
  assertEqual(approved.reviewResultSha, reviewResultSha);
  assertEqual(approved.approvedAttestationSha, approvedAttestationSha);
});

test('attestation topology rejects unknown schemas and broken lineage', () => {
  const base = {
    headSha: 'e'.repeat(40),
    parentShas: ['d'.repeat(40)],
    schemaVersion: 8,
    reviewRevision: {
      headSha: 'd'.repeat(40),
      parentShas: ['b'.repeat(40)],
    },
    pendingRevision: {
      headSha: 'b'.repeat(40),
      parentShas: ['a'.repeat(40)],
    },
  };
  assertEqual(resolveGate0AttestationChain({
    ...base,
    schemaVersion: 9,
  }).valid, false);
  assertEqual(resolveGate0AttestationChain({
    ...base,
    parentShas: [...base.parentShas, 'c'.repeat(40)],
  }).valid, false);
  assertEqual(resolveGate0AttestationChain({
    ...base,
    reviewRevision: {
      ...base.reviewRevision,
      parentShas: ['b'.repeat(40), 'c'.repeat(40)],
    },
  }).valid, false);
  assertEqual(resolveGate0AttestationChain({
    ...base,
    pendingRevision: {
      ...base.pendingRevision,
      parentShas: ['a'.repeat(40), 'c'.repeat(40)],
    },
  }).valid, false);
  assertEqual(resolveGate0AttestationChain({
    ...base,
    reviewRevision: {
      ...base.reviewRevision,
      headSha: 'f'.repeat(40),
    },
  }).valid, false);
});

test('approved attestation rejects a broken review commit chain', () => {
  const wrongApprovedParent = validApprovedAttestationFixture();
  wrongApprovedParent.parentShas = ['f'.repeat(40)];
  assertEqual(
    validateGate0ApprovedAttestation(wrongApprovedParent).valid,
    false,
  );

  const wrongReviewParent = validApprovedAttestationFixture();
  wrongReviewParent.reviewResultCommit.parentShas = ['f'.repeat(40)];
  assertEqual(
    validateGate0ApprovedAttestation(wrongReviewParent).valid,
    false,
  );
});

test('approved attestation rejects a mixed or executable review commit', () => {
  const mixed = validApprovedAttestationFixture();
  mixed.reviewResultCommit.changedEntries.push('M\tsrc/server.js');
  assertEqual(validateGate0ApprovedAttestation(mixed).valid, false);

  const executable = validApprovedAttestationFixture();
  executable.reviewResultCommit.resultMode = '100755';
  assertEqual(validateGate0ApprovedAttestation(executable).valid, false);
});

test('promotion writer boundary accepts only the one-file review commit', () => {
  const fixture = validApprovedAttestationFixture();
  assertEqual(
    validateReviewResultCommitBoundary(
      fixture.reviewResultCommit,
    ).length,
    0,
  );
  const mixed = validApprovedAttestationFixture();
  mixed.reviewResultCommit.changedEntries.push('M\tsrc/server.js');
  assert(
    validateReviewResultCommitBoundary(
      mixed.reviewResultCommit,
    ).length > 0,
  );
  const executable = validApprovedAttestationFixture();
  executable.reviewResultCommit.resultMode = '100755';
  assert(
    validateReviewResultCommitBoundary(
      executable.reviewResultCommit,
    ).length > 0,
  );
});

test('promotion writer preserves the leading porcelain status column', () => {
  assertEqual(
    normalizeGitOutput(' M docs/convergence/EVIDENCE-INDEX.json\n'),
    ' M docs/convergence/EVIDENCE-INDEX.json',
  );
  assertEqual(normalizeGitOutput('abc123\n'), 'abc123');
  assertEqual(normalizeGitOutput('\n'), '');
});

test('approved attestation rejects changed review evidence', () => {
  const fixture = validApprovedAttestationFixture();
  const changedResult = JSON.parse(
    fixture.reviewResultCommit.resultBytes.toString('utf8'),
  );
  changedResult.packetSha256 = 'f'.repeat(64);
  fixture.reviewResultCommit.resultBytes = Buffer.from(
    `${JSON.stringify(changedResult, null, 2)}\n`,
  );
  assertEqual(validateGate0ApprovedAttestation(fixture).valid, false);
});

test('approved attestation rejects inherited evidence drift', () => {
  const fixture = validApprovedAttestationFixture();
  fixture.evidenceIndex.validations.registry.outputSha256 = 'f'.repeat(64);
  assertEqual(validateGate0ApprovedAttestation(fixture).valid, false);
});

test('approved review cannot promote a red pending attestation', () => {
  const fixture = validApprovedAttestationFixture();
  fixture.pendingAttestation.evidenceIndex.clauses[0].result = 'FAIL';
  fixture.pendingAttestation.evidenceIndex.verdict = 'FAIL';
  fixture.pendingAttestation.evidenceIndex.exitCode = 1;
  fixture.evidenceIndex.clauses[0].result = 'FAIL';
  fixture.evidenceIndex.verdict = 'FAIL';
  fixture.evidenceIndex.exitCode = 1;
  assertEqual(validateGate0ApprovedAttestation(fixture).valid, false);
});

test('post-commit attestation binds the candidate parent and four outputs', () => {
  const report = validateGate0Attestation(validAttestationFixture());
  assertEqual(report.valid, true);
  assertEqual(report.errors.length, 0);
});

test('post-commit attestation requires disjoint revalidation inputs', () => {
  const missingBoundary = validAttestationFixture();
  delete missingBoundary.revalidationInputScopes;
  assertEqual(validateGate0Attestation(missingBoundary).valid, false);

  for (const outputPath of [
    ...GATE0_ATTESTATION_OUTPUTS,
    GATE0_REVIEW_RESULT_PATH,
  ]) {
    const overlapping = validAttestationFixture();
    overlapping.revalidationInputScopes.push({
      kind: 'exact',
      path: outputPath,
      source: 'mutated-validator-input',
    });
    assertEqual(
      validateGate0Attestation(overlapping).valid,
      false,
      `${outputPath} validator overlap must be rejected`,
    );
  }
});

test('revalidation disjointness is segment-aware and fails closed', () => {
  const current = validateGate0RevalidationDisjointness(
    GATE0_ATTESTATION_OUTPUTS,
    buildGate0RevalidationInputScopes(committedManifest),
  );
  assertEqual(current.valid, true);

  const treeOverlap = validateGate0RevalidationDisjointness(
    GATE0_ATTESTATION_OUTPUTS,
    [{
      kind: 'tree',
      path: 'docs/convergence',
      source: 'mutated-tree-input',
    }],
  );
  assertEqual(treeOverlap.valid, false);

  const siblingPrefix = validateGate0RevalidationDisjointness(
    GATE0_ATTESTATION_OUTPUTS,
    [{
      kind: 'tree',
      path: 'docs/convergence-old',
      source: 'sibling-tree-input',
    }],
  );
  assertEqual(siblingPrefix.valid, true);

  const unsafe = validateGate0RevalidationDisjointness(
    GATE0_ATTESTATION_OUTPUTS,
    [{
      kind: 'exact',
      path: '../docs/convergence/STATUS.md',
      source: 'unsafe-input',
    }],
  );
  assertEqual(unsafe.valid, false);
});

test('manifest-derived disposition input cannot overlap an attested output', () => {
  const manifest = manifestCopy();
  manifest.records[0].newPath = 'docs/convergence/STATUS.md';
  const report = validateGate0RevalidationDisjointness(
    GATE0_ATTESTATION_OUTPUTS,
    buildGate0RevalidationInputScopes(manifest),
  );
  assertEqual(report.valid, false);
});

test('post-commit attestation preserves a revalidated structured red result', () => {
  const fixture = validAttestationFixture();
  const red = fixture.evidenceIndex.validations.disposition;
  red.exitCode = 1;
  red.errors = ['fixture disposition failure'];
  fixture.expectedDispositionValidation =
    JSON.parse(JSON.stringify(red));
  fixture.evidenceIndex.clauses.find(clause => clause.id === 'G0-C2').result =
    'FAIL';
  fixture.evidenceIndex.verdict = 'FAIL';
  fixture.evidenceIndex.exitCode = 1;
  const report = validateGate0Attestation(fixture);
  assertEqual(report.valid, true);
  assertEqual(report.errors.length, 0);
});

test('post-commit attestation rejects wrong parents and product changes', () => {
  const wrongParent = validAttestationFixture();
  wrongParent.parentShas = ['c'.repeat(40)];
  assertEqual(validateGate0Attestation(wrongParent).valid, false);

  const merge = validAttestationFixture();
  merge.parentShas.push('c'.repeat(40));
  assertEqual(validateGate0Attestation(merge).valid, false);

  const extraPath = validAttestationFixture();
  extraPath.changedEntries.push('M\tsrc/server.js');
  assertEqual(validateGate0Attestation(extraPath).valid, false);

  const missingPath = validAttestationFixture();
  missingPath.changedEntries.pop();
  assertEqual(validateGate0Attestation(missingPath).valid, false);
});

test('post-commit attestation rejects stale schema and dirty review state', () => {
  const stale = validAttestationFixture();
  stale.evidenceIndex.schemaVersion = 6;
  assertEqual(validateGate0Attestation(stale).valid, false);

  const dirty = validAttestationFixture();
  dirty.worktreeClean = false;
  assertEqual(validateGate0Attestation(dirty).valid, false);

  const changedMarkdown = validAttestationFixture();
  changedMarkdown.outputArtifacts['docs/convergence/STATUS.md'] =
    '# forged PASS\n';
  assertEqual(validateGate0Attestation(changedMarkdown).valid, false);

  const changedRegistry = validAttestationFixture();
  changedRegistry.evidenceIndex.candidate.registrySha256 = 'd'.repeat(64);
  assertEqual(validateGate0Attestation(changedRegistry).valid, false);

  const missingRegistry = validAttestationFixture();
  delete missingRegistry.evidenceIndex.candidate.registrySha256;
  assertEqual(validateGate0Attestation(missingRegistry).valid, false);

  const executableOutput = validAttestationFixture();
  executableOutput.outputModes['docs/convergence/STATUS.md'] = '100755';
  assertEqual(validateGate0Attestation(executableOutput).valid, false);

  const approvedWithoutContract = validAttestationFixture();
  approvedWithoutContract.evidenceIndex.review.independentReviewStatus =
    'APPROVED';
  approvedWithoutContract.evidenceIndex.verdict = 'PASS';
  assertEqual(validateGate0Attestation(approvedWithoutContract).valid, false);

  const contradictory = validAttestationFixture();
  contradictory.evidenceIndex.inventory = null;
  contradictory.evidenceIndex.riskPolicy = [];
  contradictory.evidenceIndex.installation = [];
  contradictory.evidenceIndex.deterministic = [];
  contradictory.evidenceIndex.pilotFiveConsecutive = [];
  contradictory.evidenceIndex.soakRequirementGuard = [];
  contradictory.evidenceIndex.privacyIncident = [];
  contradictory.evidenceIndex.validations = {
    registry: {},
    disposition: {},
  };
  assertEqual(validateGate0Attestation(contradictory).valid, false);

  const lineageDrift = validAttestationFixture();
  lineageDrift.evidenceIndex.sourceRefs.c3Parent = '9'.repeat(40);
  assertEqual(validateGate0Attestation(lineageDrift).valid, false);
});

test('post-commit attestation rejects unknown fields in every nested summary', () => {
  const mutations = [
    fixture => {
      fixture.evidenceIndex.candidate.privateHostPath = '/secret/home';
    },
    fixture => {
      fixture.evidenceIndex.review.unreviewed = 'yes';
    },
    fixture => {
      fixture.evidenceIndex.clauses[0].manualOverride = true;
    },
    fixture => {
      fixture.evidenceIndex.inventory.undocumented = 1;
    },
    fixture => {
      fixture.evidenceIndex.installation.privateHostPath = '/secret/cache';
    },
    fixture => {
      fixture.evidenceIndex.validations.privateHostPath = '/secret/validator';
    },
    fixture => {
      fixture.evidenceIndex.generatedOutputs[
        'docs/convergence/STATUS.md'
      ].unbound = true;
    },
  ];
  for (const mutate of mutations) {
    const fixture = validAttestationFixture();
    mutate(fixture);
    assertEqual(validateGate0Attestation(fixture).valid, false);
  }
});

test('post-commit attestation derives audit verdict from exact status counts', () => {
  const fixture = validAttestationFixture();
  fixture.evidenceIndex.deterministic.statusCounts.PASS = 198;
  fixture.evidenceIndex.deterministic.statusCounts.FAIL = 1;
  assertEqual(validateGate0Attestation(fixture).valid, false);

  const incompleteGuard = validAttestationFixture();
  incompleteGuard.evidenceIndex.soakRequirementGuard.statusCounts.BLOCKED = 4;
  incompleteGuard.evidenceIndex.soakRequirementGuard.statusCounts.SKIPPED = 1;
  assertEqual(validateGate0Attestation(incompleteGuard).valid, false);

  const mixedGuard = validAttestationFixture();
  mixedGuard.evidenceIndex.soakRequirementGuard.statusCounts.PASS = 4;
  mixedGuard.evidenceIndex.soakRequirementGuard.statusCounts.BLOCKED = 1;
  assertEqual(validateGate0Attestation(mixedGuard).valid, false);

  const truthfulSkipped = validAttestationFixture();
  truthfulSkipped.evidenceIndex.deterministic.statusCounts.PASS = 198;
  truthfulSkipped.evidenceIndex.deterministic.statusCounts.SKIPPED = 1;
  truthfulSkipped.evidenceIndex.deterministic.passed = false;
  truthfulSkipped.evidenceIndex.deterministic.verdict = 'FAIL';
  truthfulSkipped.evidenceIndex.deterministic.exitCode = 1;
  truthfulSkipped.evidenceIndex.deterministic.execution.exitCode = 1;
  truthfulSkipped.evidenceIndex.clauses.find(
    clause => clause.id === 'G0-C5',
  ).result = 'FAIL';
  truthfulSkipped.evidenceIndex.verdict = 'FAIL';
  truthfulSkipped.evidenceIndex.exitCode = 1;
  assertEqual(validateGate0Attestation(truthfulSkipped).valid, true);
});

test('post-commit attestation derives G0-C6 and G0-C7 from parent registry facts', () => {
  const blockerGap = validAttestationFixture();
  blockerGap.expectedRegistryFacts.blockedWithoutPrerequisite = [
    'IS-T5-E2E-220-E2E-SUITE-RUNNER',
  ];
  assertEqual(validateGate0Attestation(blockerGap).valid, false);

  const defectiveDeterministic = validAttestationFixture();
  defectiveDeterministic.expectedRegistryFacts.deterministicScopeValid = false;
  defectiveDeterministic.expectedRegistryFacts.knownDefectiveInDeterministic = [
    'IS-T1-FORGED-KNOWN-DEFECTIVE',
  ];
  assertEqual(validateGate0Attestation(defectiveDeterministic).valid, false);

  const inventoryDrift = validAttestationFixture();
  inventoryDrift.expectedRegistryFacts.profileCounts.offline = 172;
  inventoryDrift.expectedRegistryFacts.profileCounts.server = 37;
  assertEqual(validateGate0Attestation(inventoryDrift).valid, false);
});

test('post-commit attestation rejects self-asserted validators, risks, and privacy', () => {
  const registry = validAttestationFixture();
  registry.evidenceIndex.validations.registry.outputSha256 = 'f'.repeat(64);
  assertEqual(validateGate0Attestation(registry).valid, false);

  const disposition = validAttestationFixture();
  disposition.evidenceIndex.validations.disposition.report.pathsSha256 =
    'f'.repeat(64);
  assertEqual(validateGate0Attestation(disposition).valid, false);

  const risk = validAttestationFixture();
  risk.evidenceIndex.riskPolicy.sha256 = 'f'.repeat(64);
  assertEqual(validateGate0Attestation(risk).valid, false);

  const hiddenBlocker = validAttestationFixture();
  hiddenBlocker.expectedRiskPolicy.repositoryBlockers = ['G0-R999: OPEN'];
  assertEqual(validateGate0Attestation(hiddenBlocker).valid, false);

  const privacy = validAttestationFixture();
  privacy.evidenceIndex.privacyIncident.rotationCategories.push(
    'unverified category',
  );
  assertEqual(validateGate0Attestation(privacy).valid, false);
});

test('post-commit attestation rejects incomplete D-021 execution bindings', () => {
  const missingExecution = validAttestationFixture();
  missingExecution.evidenceIndex.deterministic.execution = {};
  assertEqual(validateGate0Attestation(missingExecution).valid, false);

  const changedReplay = validAttestationFixture();
  changedReplay.evidenceIndex.pilotFiveConsecutive[0]
    .execution.portableReplay.argv.push('--unlocked');
  assertEqual(validateGate0Attestation(changedReplay).valid, false);

  const changedLog = validAttestationFixture();
  changedLog.evidenceIndex.installation.logs[0].sha256 = 'f'.repeat(64);
  assertEqual(validateGate0Attestation(changedLog).valid, false);

  const cleanupMissing = validAttestationFixture();
  cleanupMissing.evidenceIndex.soakRequirementGuard
    .execution.cleanupTerminated = false;
  assertEqual(validateGate0Attestation(cleanupMissing).valid, false);
});

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
    return {
      sourceSequence: index + 1,
      displayPath: `path-${index}`,
      candidatePath: `path-${index}`,
      candidateBlob: (index + 1).toString(16).padStart(40, '0'),
      candidateMode: '100644',
      rationale: `rationale ${index}`,
      disposition,
      action,
      resolution: resolutions[index],
    };
  });
  const repairedDigest = createHash('sha256').update(JSON.stringify(
    paths
      .filter(item => item.disposition === 'REBUILD' && item.action === 'REPAIRED')
      .map(item => ([
        item.sourceSequence,
        item.displayPath,
        item.candidatePath,
        item.candidateBlob,
        item.candidateMode,
        createHash('sha256').update(item.rationale).digest('hex'),
      ])),
  )).digest('hex');
  return {
    schemaVersion: 3,
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
    repairedSubjectEvidence: {
      path: REPAIRED_SUBJECTS_PATH,
      schemaVersion: 1,
      sourceManifestRecordsSha256: EXPECTED_RECORDS_SHA256,
      terminalState: 'REBUILD/REPAIRED',
      recordCount: EXPECTED_REPAIRED_SUBJECT_COUNT,
      recordsDigestAlgorithm: 'sha256-repaired-subject-tuples-v1',
      recordsSha256: repairedDigest,
      validatedCount: EXPECTED_REPAIRED_SUBJECT_COUNT,
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

test('green disposition report requires all 60 repaired subjects to validate', () => {
  const malformed = dispositionReport();
  malformed.repairedSubjectEvidence.validatedCount = 59;
  assertThrows(() => classifyDispositionValidatorExecution(
    validatorExecution(0, malformed),
  ));
});

test('green disposition report binds repaired subject digest to report paths', () => {
  const malformed = dispositionReport();
  const repaired = malformed.paths.find(
    item => item.disposition === 'REBUILD' && item.action === 'REPAIRED',
  );
  repaired.candidateBlob = '0'.repeat(40);
  repaired.candidateMode = '100755';
  repaired.rationale = 'forged evidence text';
  malformed.repairedSubjectEvidence.recordsSha256 = 'f'.repeat(64);
  assertThrows(() => classifyDispositionValidatorExecution(
    validatorExecution(0, malformed),
  ));
});

test('green disposition report pins repaired subjects to source manifest', () => {
  const malformed = dispositionReport();
  malformed.repairedSubjectEvidence.sourceManifestRecordsSha256 = 'f'.repeat(64);
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
  assert(markdown.includes('Parsed-registry serialization fingerprint'));
  assert(markdown.includes('`sha256-json-stringify-v1`'));
  assert(markdown.includes('`ATTESTED_CANDIDATE_RUN` at `$PWD`'));
  assert(!markdown.includes('- Registry SHA-256:'));
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
  const provenanceExecutions = validProvenanceFixture().executions;
  const executionEvidence = (execution) => ({
    portableReplay: makePortableInvocation(execution, '/work/repository'),
  });
  const baselineArguments = {
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
      {
        kind: 'clean',
        bytes: 1,
        sha256: 'c'.repeat(64),
        path: 'clean.log',
        exitCode: 0,
        execution: executionEvidence(provenanceExecutions[0]),
      },
      {
        kind: 'repeat',
        bytes: 1,
        sha256: 'd'.repeat(64),
        path: 'again.log',
        exitCode: 0,
        execution: executionEvidence(provenanceExecutions[1]),
      },
    ],
    deterministicEvidence: {
      exitCode: 0,
      verdict: 'PASS',
      statusCounts: { PASS: 199 },
      report: 'report.json',
      reportSha256: 'e'.repeat(64),
      inventory: 'inventory.json',
      inventorySha256: 'a'.repeat(64),
      inventoryFingerprint: 'f'.repeat(64),
      optionsFingerprint: '1'.repeat(64),
      execution: executionEvidence(provenanceExecutions[2]),
    },
    pilotEvidence: [],
    soakEvidence: {
      exitCode: 2,
      verdict: 'BLOCKED',
      guardPassed: true,
      blockedBy: ['gpu', 'ollama'],
      reportSha256: '2'.repeat(64),
      inventorySha256: '3'.repeat(64),
      execution: executionEvidence(provenanceExecutions[8]),
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
  };
  const markdown = renderBaselineReport(baselineArguments);
  assert(markdown.includes('`EXACT` 32'));
  assert(markdown.includes('`MODIFIED` 99'));
  assert(!markdown.includes('`EXACT` 87'));
  assert(markdown.includes('did not establish five consecutive A9 passes'));
  assert(!markdown.includes('A9 assertion passed in every run'));
  assert(markdown.includes('Five soak programs previously misdeclared'));
  assert(markdown.includes('Runtime database access now requires'));
  assert(markdown.includes('former shared-`/tmp` convention is closed'));
  assert(markdown.includes('Parsed-registry serialization fingerprint'));
  assert(markdown.includes('`sha256-json-stringify-v1`'));
  assert(markdown.includes('`ATTESTED_CANDIDATE_RUN` at `$PWD`'));
  assert(!markdown.includes('- Registry SHA-256:'));
  assert(!markdown.includes('Product DB initialization remains an import side effect'));
  assert(!markdown.includes('undefined'));

  baselineArguments.soakEvidence = {
    ...baselineArguments.soakEvidence,
    exitCode: 1,
    verdict: 'FAIL',
    guardPassed: false,
    blockedBy: [],
  };
  const redMarkdown = renderBaselineReport(baselineArguments);
  assert(redMarkdown.includes('soak prerequisite guard was not established'));
  assert(!redMarkdown.includes('are now blocked before'));
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
      '--verdict=',
    ]);
  } finally {
    console.error = originalError;
  }
  assertEqual(exitCode, 2);
  assert(errorText.includes('--verdict is not supported'));
});

await testAsync('signal during evidence finalization restores every tracked output', async () => {
  const repository = path.join(testRoot, 'generator-signal-rollback');
  const outputPaths = [
    'status.md',
    'index.json',
    'report.md',
    'review.md',
  ];
  mkdirSync(repository, { mode: 0o700 });
  for (const relativePath of outputPaths) {
    writeFileSync(
      path.join(repository, relativePath),
      `original ${relativePath}\n`,
      { mode: 0o600 },
    );
  }
  let interrupted = false;
  try {
    await runWithGate0OutputRollback({
      repositoryRoot: repository,
      outputPaths,
      operation: async ({ armRollback }) => {
        await armRollback();
        for (const relativePath of outputPaths) {
          writeFileSync(
            path.join(repository, relativePath),
            `generated ${relativePath}\n`,
            { mode: 0o600 },
          );
        }
        process.kill(process.pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 25));
        return 0;
      },
    });
  } catch (error) {
    interrupted = error.message.includes('interrupted by SIGTERM');
  }
  assertEqual(interrupted, true);
  for (const relativePath of outputPaths) {
    assertEqual(
      readFileSync(path.join(repository, relativePath), 'utf8'),
      `original ${relativePath}\n`,
    );
  }
});

await testAsync('promotion writer rollback restores all four outputs', async () => {
  for (const failAfter of [2, 4]) {
    const repository = path.join(
      testRoot,
      `promotion-rollback-${failAfter}`,
    );
    const originals = new Map();
    for (const relativePath of GATE0_ATTESTATION_OUTPUTS) {
      const original = Buffer.from(`original ${relativePath}\n`);
      originals.set(relativePath, original);
      mkdirSync(path.dirname(path.join(repository, relativePath)), {
        recursive: true,
        mode: 0o700,
      });
      writeFileSync(path.join(repository, relativePath), original, {
        mode: 0o600,
      });
    }
    const fixture = validApprovedAttestationFixture();
    let writes = 0;
    let failed = false;
    try {
      await runWithGate0OutputRollback({
        repositoryRoot: repository,
        outputPaths: GATE0_ATTESTATION_OUTPUTS,
        operation: async ({ armRollback }) => {
          await armRollback();
          await writeGate0PromotionFiles({
            repositoryRoot: repository,
            evidenceIndex: fixture.evidenceIndex,
            outputArtifacts: fixture.outputArtifacts,
            writeOutput: async (absolutePath, contents) => {
              writeFileSync(absolutePath, contents, { mode: 0o600 });
              writes += 1;
              if (writes === failAfter) {
                throw new Error(`injected write failure ${failAfter}`);
              }
            },
          });
        },
      });
    } catch (error) {
      failed = error.message.includes('injected write failure');
    }
    assertEqual(failed, true);
    for (const [relativePath, original] of originals) {
      assert(
        readFileSync(path.join(repository, relativePath)).equals(original),
        `${relativePath} must be restored after write ${failAfter}`,
      );
    }
    assert(
      readdirSync(repository, { recursive: true })
        .every(entry => !String(entry).includes('.tmp-')),
      'promotion rollback must not leave temporary files',
    );
  }
});

await testAsync('the candidate evidence producer rejects every caller argument', async () => {
  const originalError = console.error;
  let errorText = '';
  console.error = (...values) => {
    errorText += values.join(' ');
  };
  let exitCode;
  try {
    exitCode = await runGate0CandidateEvidence(['--command=true']);
  } finally {
    console.error = originalError;
  }
  assertEqual(exitCode, 2);
  assert(errorText.includes('accepts no arguments'));
});

test('the candidate producer installs owned-process termination handling', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'scripts/run-gate0-candidate-evidence.js'),
    'utf8',
  );
  assert(source.includes(
    'return await runWithOwnedProcessTerminationHandling(async () => {',
  ));
  assert(source.includes('await unlink(completedProvenancePath)'));
});

test('the candidate evidence producer rejects seeded ignored install outputs', () => {
  assertThrows(() => assertPristineIgnoredState(
    '!! c3-ide/node_modules/seeded-package/index.js',
  ));
  assertEqual(assertPristineIgnoredState('').clean, true);
});

test('every producer phase rejects ignored runtime paths outside its allowlist', () => {
  const evidenceRoot =
    `.intentsmith-artifacts/gate0/candidate-${provenanceCandidate}`;
  const allowed = [
    '!! .intentsmith-artifacts/',
    '!! node_modules/',
    '!! c3-ide/extensions/example/node_modules/',
    '!! c3-ide/applications/electron/lib/',
  ].join('\n');
  assertEqual(
    assertAllowedIgnoredState(allowed, evidenceRoot).unexpectedPathCount,
    0,
  );
  assertThrows(() => assertAllowedIgnoredState(
    `${allowed}\n!! data/c3.db`,
    evidenceRoot,
  ));
  assertThrows(() => assertAllowedIgnoredState(
    `${allowed}\n!! logs/private-runtime.log`,
    evidenceRoot,
  ));
  assertThrows(() => assertAllowedIgnoredState(
    `${allowed}\n!! data/node_modules/c3.db`,
    evidenceRoot,
  ));
  assertThrows(() => assertAllowedIgnoredState(
    `${allowed}\n!! data/private.tsbuildinfo`,
    evidenceRoot,
  ));
});

await testAsync('producer artifact ownership rejects ignored sibling paths', async () => {
  const repository = path.join(testRoot, 'artifact-root-ownership');
  const evidenceRoot =
    `.intentsmith-artifacts/gate0/candidate-${provenanceCandidate}`;
  mkdirSync(path.join(repository, evidenceRoot), {
    recursive: true,
    mode: 0o700,
  });
  await assertOwnedArtifactRoot(repository, evidenceRoot);
  mkdirSync(
    path.join(repository, '.intentsmith-artifacts', 'unowned'),
    { mode: 0o700 },
  );
  let rejected = false;
  try {
    await assertOwnedArtifactRoot(repository, evidenceRoot);
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true);
});

await testAsync('producer rejects a symlink inside its writable install boundary', async () => {
  const repository = path.join(testRoot, 'nested-install-symlink');
  const evidenceRoot =
    `.intentsmith-artifacts/gate0/candidate-${provenanceCandidate}`;
  const candidateRoot = path.join(repository, evidenceRoot);
  const installRoot = path.join(candidateRoot, 'install-root');
  const logRoot = path.join(candidateRoot, 'logs');
  mkdirSync(installRoot, { recursive: true, mode: 0o700 });
  mkdirSync(logRoot, { recursive: true, mode: 0o700 });
  symlinkSync(tmpdir(), path.join(installRoot, 'tmp'), 'dir');
  let rejected = false;
  try {
    await assertOwnedExecutionBoundary(repository, evidenceRoot, {
      id: 'fixture',
      environmentOverrides: {
        TMPDIR: path.join(installRoot, 'tmp'),
      },
      logPath: `${evidenceRoot}/logs/fixture.log`,
      reportPath: null,
      inventoryPath: null,
    });
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true);
});

await testAsync('producer rejects a world-writable dependency root', async () => {
  const repository = path.join(testRoot, 'world-writable-dependency');
  const dependencyRoot = path.join(repository, 'node_modules');
  mkdirSync(dependencyRoot, { recursive: true, mode: 0o777 });
  chmodSync(dependencyRoot, 0o777);
  let rejected = false;
  try {
    await assertOwnedDependencyRoots(repository);
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true);
});

await testAsync('producer makes safe package-manager root modes private before reuse', async () => {
  const repository = path.join(testRoot, 'group-writable-dependency');
  const dependencyRoot = path.join(repository, 'node_modules');
  mkdirSync(dependencyRoot, { recursive: true, mode: 0o775 });
  chmodSync(dependencyRoot, 0o775);
  await assertOwnedDependencyRoots(repository);
  assertEqual(statSync(dependencyRoot).mode & 0o777, 0o700);
});

rmSync(testRoot, { recursive: true, force: true });
summary();
