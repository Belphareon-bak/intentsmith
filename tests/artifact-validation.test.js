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
import { suite, test, assert, assertEqual, summary } from './harness.js';

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

rmSync(testRoot, { recursive: true, force: true });
summary();
