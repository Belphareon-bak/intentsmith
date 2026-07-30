#!/usr/bin/env node
// tests/harness-exit-code.test.js — Meta-test for custom harness process status
// ══════════════════════════════════════════════════════════════════════════════

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute as pathIsAbsolute,
  join,
  relative as pathRelative,
  resolve as pathResolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  discoverRunnablePrograms,
  validateTestRegistry,
} from '../scripts/test-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const harnessUrl = pathToFileURL(join(__dirname, 'harness.js')).href;
const e2eHarnessUrl = pathToFileURL(join(__dirname, 'e2e-harness.js')).href;
const isolationHelperUrl = pathToFileURL(
  join(__dirname, 'helpers', 'isolated-test-db.js'),
).href;
const repositoryRoot = pathResolve(__dirname, '..');
const databaseModulePath = realpathSync(
  join(repositoryRoot, 'src', 'db', 'database.js'),
);
const isolationHelperPath = realpathSync(
  join(__dirname, 'helpers', 'isolated-test-db.js'),
);
const fixtureDir = mkdtempSync(join(tmpdir(), 'c3-harness-meta-'));
const isolationKeys = [
  'C3_AUDIT_RUN',
  'HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'npm_config_cache',
  'C3_DB_PATH',
  'C3_PROJECTS_DIR',
  'C3_URL',
  'INTENTSMITH_TEST_PROJECTS_DIR',
  'INTENTSMITH_TEST_ARTIFACT_DIR',
  'INTENTSMITH_TEST_SERVER_PID',
  'INTENTSMITH_TEST_SERVER_NONCE',
  'C3_PORT_FILE',
  'INTENTSMITH_DIRECT_TEST_RUN',
  'KEEP_TEST_RUNTIME',
  'KEEP_TEST_DB',
];

function writeFixture(name, body) {
  const filePath = join(fixtureDir, name);
  writeFileSync(filePath, body, 'utf8');
  return filePath;
}

function runFixture(filePath, { raw = false, env = {}, timeout = 5_000 } = {}) {
  const childEnvironment = { ...process.env, ...env, NODE_NO_WARNINGS: '1' };
  if (raw) {
    for (const key of isolationKeys) delete childEnvironment[key];
  } else {
    delete childEnvironment.INTENTSMITH_DIRECT_TEST_RUN;
    childEnvironment.C3_AUDIT_RUN = '1';
  }
  return spawnSync(process.execPath, [filePath], {
    encoding: 'utf8',
    env: childEnvironment,
    timeout,
  });
}

function parseRuntimeProbe(result) {
  const marker = result.stdout
    .split('\n')
    .find(line => line.startsWith('ISOLATION_PROBE:'));
  assert.ok(marker, result.stderr || result.stdout);
  return JSON.parse(marker.slice('ISOLATION_PROBE:'.length));
}

function assertDirectRuntimeProbe(probe, label) {
  const directRoot = join(__dirname, '..', '.intentsmith-artifacts', 'direct-tests');
  const relativeRoot = pathRelative(directRoot, probe.root);
  assert.equal(probe.mode, 'direct', `${label}: mode`);
  assert.ok(
    relativeRoot && !relativeRoot.startsWith('..') && !pathIsAbsolute(relativeRoot),
    `${label}: root escaped ignored direct-tests root: ${probe.root}`,
  );
  assert.equal(probe.rootMode, 0o700, `${label}: root mode`);
  assert.equal(probe.tempMode, 0o700, `${label}: temp mode`);
  assert.equal(probe.artifactsMode, 0o700, `${label}: artifacts mode`);
  assert.equal(probe.homeMode, 0o700, `${label}: home mode`);
  assert.equal(probe.xdgConfigMode, 0o700, `${label}: XDG config mode`);
  assert.equal(probe.xdgCacheMode, 0o700, `${label}: XDG cache mode`);
  assert.equal(probe.xdgDataMode, 0o700, `${label}: XDG data mode`);
  assert.equal(probe.xdgStateMode, 0o700, `${label}: XDG state mode`);
  assert.equal(probe.npmCacheMode, 0o700, `${label}: npm cache mode`);
  for (const [key, candidate] of Object.entries({
    temp: probe.temp,
    database: probe.database,
    projects: probe.projects,
    artifacts: probe.artifacts,
    home: probe.home,
    xdgConfig: probe.xdgConfig,
    xdgCache: probe.xdgCache,
    xdgData: probe.xdgData,
    xdgState: probe.xdgState,
    portFile: probe.portFile,
  })) {
    const relative = pathRelative(probe.root, candidate);
    assert.ok(
      relative && !relative.startsWith('..') && !pathIsAbsolute(relative),
      `${label}: ${key} escaped direct runtime: ${candidate}`,
    );
  }
  const relativeNpmCache = pathRelative(probe.artifacts, probe.npmCache);
  assert.ok(
    relativeNpmCache
      && !relativeNpmCache.startsWith('..')
      && !pathIsAbsolute(relativeNpmCache),
    `${label}: npm cache escaped artifact root: ${probe.npmCache}`,
  );
}

function extractModuleReferences(source) {
  const references = [];
  const patterns = [
    {
      kind: 'static',
      expression: /(?:^|\n)\s*import\s*['"]([^'"\n]+)['"]\s*;?/g,
    },
    {
      kind: 'static',
      expression: /(?:^|\n)\s*import\s+(?!['"])[\s\S]*?\s+from\s+['"]([^'"\n]+)['"]\s*;?/g,
    },
    {
      kind: 'static',
      expression: /(?:^|\n)\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"\n]+)['"]\s*;?/g,
    },
    {
      kind: 'runtime',
      expression: /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    },
    {
      kind: 'runtime',
      expression: /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    },
  ];

  for (const { kind, expression } of patterns) {
    for (const match of source.matchAll(expression)) {
      references.push({
        kind,
        specifier: match[1],
        offset: match.index,
      });
    }
  }

  return references.sort((left, right) => left.offset - right.offset);
}

function resolveLocalModule(importer, specifier) {
  if (!specifier.startsWith('.')) return null;

  const base = pathResolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (lstatSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      // Try the next deterministic local-module candidate.
    }
  }
  return null;
}

function analyzeDatabaseBootstraps(sourceOverrides = new Map()) {
  const referenceCache = new Map();
  const moduleReferences = filePath => {
    const canonical = realpathSync(filePath);
    if (referenceCache.has(canonical)) return referenceCache.get(canonical);
    const source = sourceOverrides.has(canonical)
      ? sourceOverrides.get(canonical)
      : readFileSync(canonical, 'utf8');
    const references = extractModuleReferences(source)
      .map(reference => ({
        ...reference,
        resolved: resolveLocalModule(canonical, reference.specifier),
      }))
      .filter(reference => reference.resolved !== null);
    referenceCache.set(canonical, references);
    return references;
  };

  const reachesDatabase = (filePath, ancestors = new Set()) => {
    const canonical = realpathSync(filePath);
    if (canonical === databaseModulePath) return true;
    if (ancestors.has(canonical)) return false;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonical);
    return moduleReferences(canonical).some(reference => (
      reachesDatabase(reference.resolved, nextAncestors)
    ));
  };

  const firstStaticBoundary = (filePath, ancestors = new Set()) => {
    const canonical = realpathSync(filePath);
    if (canonical === isolationHelperPath) return 'isolation';
    if (canonical === databaseModulePath) return 'database';
    if (ancestors.has(canonical)) return null;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(canonical);
    for (const reference of moduleReferences(canonical)) {
      if (reference.kind !== 'static') continue;
      const boundary = firstStaticBoundary(reference.resolved, nextAncestors);
      if (boundary !== null) return boundary;
    }
    return null;
  };

  const rootPrograms = readdirSync(__dirname, {
    encoding: 'utf8',
    withFileTypes: true,
  })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => realpathSync(join(__dirname, entry.name)))
    .sort();
  const databaseReachable = rootPrograms.filter(program => (
    reachesDatabase(program)
  ));
  const unprotected = databaseReachable.filter(program => (
    firstStaticBoundary(program) !== 'isolation'
  ));

  return {
    databaseReachable,
    unprotected,
  };
}

function validRegistrySuite(path, argv) {
  return {
    id: 'IS-T1-VALIDATOR-FIXTURE',
    path,
    capabilityId: 'C3-027',
    tier: 'T1',
    profile: 'offline',
    state: 'ACTIVE',
    required: true,
    fixture: 'validator self-test fixture',
    owner: 'primary implementer',
    timeoutMs: 2_000,
    expectedDurationMs: 1_000,
    argv,
    requirements: {
      network: 'none',
      database: false,
      server: false,
      ollama: false,
      gpu: false,
    },
    lastGreen: { commit: null, artifact: null },
    flakeCount: 0,
    quarantineExpiry: null,
  };
}

try {
  const tempCreatingPrograms = readdirSync(__dirname, {
    encoding: 'utf8',
    withFileTypes: true,
  })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => entry.name)
    .filter(name => {
      const source = readFileSync(join(__dirname, name), 'utf8');
      return /\b(?:fs\.)?mkdtemp(?:Sync)?\s*\(/.test(source);
    })
    .sort();
  assert.ok(
    tempCreatingPrograms.length >= 40,
    `temp bootstrap inventory unexpectedly shrank: ${tempCreatingPrograms.length}`,
  );
  const staticBootstrapImport = /(?:\bfrom\s+|(?:^|\n)\s*import\s*)['"]\.\/(?:helpers\/isolated-test-db|harness|e2e-harness)\.js['"]\s*;?/m;
  const missingTempBootstraps = tempCreatingPrograms.filter(name => (
    !staticBootstrapImport.test(readFileSync(join(__dirname, name), 'utf8'))
  ));
  assert.deepEqual(
    missingTempBootstraps,
    [],
    `temp-creating root tests lack a static isolation bootstrap: ${missingTempBootstraps.join(', ')}`,
  );
  console.log(
    `Temp bootstrap coverage: ${tempCreatingPrograms.length} root tests covered`,
  );

  const databaseBootstrapAnalysis = analyzeDatabaseBootstraps();
  assert.equal(
    databaseBootstrapAnalysis.databaseReachable.length,
    92,
    'database-reachable root-test inventory changed; review the import graph',
  );
  assert.deepEqual(
    databaseBootstrapAnalysis.unprotected.map(program => (
      pathRelative(repositoryRoot, program)
    )),
    [],
    'a database-reachable root test can evaluate the database before isolation',
  );
  console.log(
    'Database bootstrap coverage: 92 database-reachable root tests protected',
  );

  const mutationTarget = realpathSync(join(__dirname, 'adversarial-cre.test.js'));
  const mutationAnchor = "import './helpers/isolated-test-db.js';\n";
  const mutationSource = readFileSync(mutationTarget, 'utf8');
  assert.ok(
    mutationSource.includes(mutationAnchor),
    'database bootstrap mutation target is stale',
  );
  const mutatedAnalysis = analyzeDatabaseBootstraps(new Map([
    [mutationTarget, mutationSource.replace(mutationAnchor, '')],
  ]));
  assert.equal(
    mutatedAnalysis.databaseReachable.length,
    92,
    'removing an isolation anchor must not hide database reachability',
  );
  assert.deepEqual(
    mutatedAnalysis.unprotected.map(program => (
      pathRelative(repositoryRoot, program)
    )),
    ['tests/adversarial-cre.test.js'],
    'removing one bootstrap anchor must expose that database-reachable program',
  );
  console.log(
    'Database bootstrap mutation check: removed anchor is rejected',
  );

  const ownedWriterPrograms = new Map([
    ['chat-export-budget.test.js', 'artifacts'],
    ['export-pdf-docx.test.js', 'artifacts'],
    ['lifecycle-e2e.test.js', 'projects'],
    ['lifecycle-human-friction.test.js', 'projects'],
  ]);
  for (const [name, ownedRoot] of ownedWriterPrograms) {
    const source = readFileSync(join(__dirname, name), 'utf8');
    assert.ok(
      !source.includes('/tmp'),
      `${name} must not use the shared /tmp namespace`,
    );
    assert.match(
      source,
      new RegExp(`isolatedTestRuntime\\.${ownedRoot}`),
      `${name} must allocate below the owned ${ownedRoot} root`,
    );
    const bootstrapIndex = source.indexOf(
      "from './helpers/isolated-test-db.js'",
    );
    const productDependencyIndex = source.search(
      /\bfrom\s+['"]\.\.\/src\//,
    );
    assert.ok(
      bootstrapIndex >= 0
        && productDependencyIndex >= 0
        && bootstrapIndex < productDependencyIndex,
      `${name} must bootstrap isolation before product dependencies`,
    );
  }

  const invocationBoundTmpdirPrograms = [
    'multimedia.test.js',
    'project-welcome.test.js',
    'tool-registry-e2e.test.js',
    'upgrade-ux-v125.test.js',
  ];
  for (const name of invocationBoundTmpdirPrograms) {
    const source = readFileSync(join(__dirname, name), 'utf8');
    assert.ok(
      !source.includes('/tmp'),
      `${name} must not bypass the invocation-owned TMPDIR`,
    );
    assert.match(
      source,
      /\bos\.tmpdir\(\)/,
      `${name} must resolve temporary paths through os.tmpdir()`,
    );
    const bootstrapIndex = source.search(
      /\bfrom\s+['"]\.\/(?:helpers\/isolated-test-db|harness|e2e-harness)\.js['"]/,
    );
    const productDependencyIndex = source.search(
      /\bfrom\s+['"]\.\.\/src\//,
    );
    assert.ok(
      bootstrapIndex >= 0
        && productDependencyIndex >= 0
        && bootstrapIndex < productDependencyIndex,
      `${name} must bind TMPDIR before product dependencies`,
    );
  }

  const attachmentBoundaryEnvironment = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
  };
  for (const key of isolationKeys) delete attachmentBoundaryEnvironment[key];
  attachmentBoundaryEnvironment.C3_URL = 'http://127.0.0.1:1';
  const attachmentBoundary = spawnSync(
    process.execPath,
    [
      '--import',
      'data:text/javascript,globalThis.fetch%20%3D%20()%20%3D%3E%20%7B%20throw%20new%20Error(%22FETCH_CALLED%22)%3B%20%7D%3B',
      join(__dirname, 'attachments-projects.test.js'),
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: attachmentBoundaryEnvironment,
      timeout: 5_000,
    },
  );
  assert.equal(
    attachmentBoundary.error,
    undefined,
    String(attachmentBoundary.error),
  );
  assert.equal(
    attachmentBoundary.status,
    1,
    attachmentBoundary.stderr || attachmentBoundary.stdout,
  );
  assert.match(
    attachmentBoundary.stderr,
    /The full attachment suite requires a runner-owned audit server/,
  );
  assert.doesNotMatch(
    `${attachmentBoundary.stdout}\n${attachmentBoundary.stderr}`,
    /FETCH_CALLED/,
    'raw attachment run reached fetch without an owned server',
  );
  const preservedAttachmentRoot = attachmentBoundary.stderr.match(
    /Isolated test runtime preserved: ([^\r\n]+)/,
  )?.[1];
  assert.ok(
    preservedAttachmentRoot,
    'raw attachment boundary did not preserve its diagnostic runtime',
  );
  const directParent = realpathSync(
    join(repositoryRoot, '.intentsmith-artifacts', 'direct-tests'),
  );
  const attachmentRoot = pathResolve(preservedAttachmentRoot);
  const attachmentRootRelative = pathRelative(directParent, attachmentRoot);
  assert.ok(
    attachmentRootRelative
      && !attachmentRootRelative.startsWith('..')
      && !pathIsAbsolute(attachmentRootRelative),
    'raw attachment diagnostic runtime escaped the ignored direct root',
  );
  const attachmentRootMetadata = lstatSync(attachmentRoot);
  assert.ok(
    attachmentRootMetadata.isDirectory()
      && !attachmentRootMetadata.isSymbolicLink(),
    'raw attachment diagnostic runtime is not a real directory',
  );
  assert.equal(attachmentRootMetadata.mode & 0o777, 0o700);
  if (typeof process.getuid === 'function') {
    assert.equal(attachmentRootMetadata.uid, process.getuid());
  }
  assert.equal(realpathSync(attachmentRoot), attachmentRoot);
  assert.equal(
    readdirSync(attachmentRoot, {
      recursive: true,
      withFileTypes: true,
    }).filter(entry => !entry.isDirectory()).length,
    0,
    'raw attachment guard wrote files before rejecting the server boundary',
  );
  rmSync(attachmentRoot, { recursive: true, force: false });
  console.log('Attachment raw server boundary: pre-fetch rejection verified');

  const frictionSource = readFileSync(
    join(__dirname, 'lifecycle-human-friction.test.js'),
    'utf8',
  );
  assert.match(
    frictionSource,
    /DELETE FROM projects WHERE id = \? AND path = \?/,
    'friction cleanup must bind the exact owned project id and path',
  );
  assert.doesNotMatch(
    frictionSource,
    /DELETE FROM projects WHERE path LIKE/,
    'friction cleanup must not use a broad project path prefix',
  );

  const directHarnessProbeFixture = writeFixture('direct-harness-probe.mjs', `
import ${JSON.stringify(harnessUrl)};
import { lstatSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';

const root = dirname(process.env.INTENTSMITH_TEST_ARTIFACT_DIR || '');
const probe = {
  mode: process.env.INTENTSMITH_DIRECT_TEST_RUN === '1' ? 'direct' : 'missing',
  root,
  realRoot: realpathSync(root),
  rootMode: lstatSync(root).mode & 0o777,
  temp: process.env.TMPDIR,
  tempMode: lstatSync(process.env.TMPDIR).mode & 0o777,
  tmpAlias: process.env.TMP,
  tempAlias: process.env.TEMP,
  database: process.env.C3_DB_PATH,
  projects: process.env.C3_PROJECTS_DIR,
  artifacts: process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
  artifactsMode: lstatSync(process.env.INTENTSMITH_TEST_ARTIFACT_DIR).mode & 0o777,
  home: process.env.HOME,
  homeMode: lstatSync(process.env.HOME).mode & 0o777,
  xdgConfig: process.env.XDG_CONFIG_HOME,
  xdgConfigMode: lstatSync(process.env.XDG_CONFIG_HOME).mode & 0o777,
  xdgCache: process.env.XDG_CACHE_HOME,
  xdgCacheMode: lstatSync(process.env.XDG_CACHE_HOME).mode & 0o777,
  xdgData: process.env.XDG_DATA_HOME,
  xdgDataMode: lstatSync(process.env.XDG_DATA_HOME).mode & 0o777,
  xdgState: process.env.XDG_STATE_HOME,
  xdgStateMode: lstatSync(process.env.XDG_STATE_HOME).mode & 0o777,
  npmCache: process.env.npm_config_cache,
  npmCacheMode: lstatSync(process.env.npm_config_cache).mode & 0o777,
  portFile: process.env.C3_PORT_FILE,
};
console.log('ISOLATION_PROBE:' + JSON.stringify(probe));
`);
  const directHarnessProbe = runFixture(
    directHarnessProbeFixture,
    { raw: true },
  );
  assert.equal(
    directHarnessProbe.error,
    undefined,
    String(directHarnessProbe.error),
  );
  assert.equal(
    directHarnessProbe.status,
    0,
    directHarnessProbe.stderr || directHarnessProbe.stdout,
  );
  const harnessProbe = parseRuntimeProbe(directHarnessProbe);
  assertDirectRuntimeProbe(harnessProbe, 'harness anchor');
  assert.equal(harnessProbe.realRoot, harnessProbe.root);
  assert.equal(harnessProbe.tmpAlias, harnessProbe.temp);
  assert.equal(harnessProbe.tempAlias, harnessProbe.temp);
  assert.equal(
    existsSync(harnessProbe.root),
    false,
    'exit 0 must remove the direct harness runtime',
  );

  const databaseUrl = pathToFileURL(
    join(__dirname, '..', 'src', 'db', 'database.js'),
  ).href;
  const directE2eHarnessProbeFixture = writeFixture('direct-e2e-harness-probe.mjs', `
import ${JSON.stringify(e2eHarnessUrl)};
import { lstatSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { close } from ${JSON.stringify(databaseUrl)};

const root = dirname(process.env.INTENTSMITH_TEST_ARTIFACT_DIR || '');
const probe = {
  mode: process.env.INTENTSMITH_DIRECT_TEST_RUN === '1' ? 'direct' : 'missing',
  root,
  realRoot: realpathSync(root),
  rootMode: lstatSync(root).mode & 0o777,
  temp: process.env.TMPDIR,
  tempMode: lstatSync(process.env.TMPDIR).mode & 0o777,
  tmpAlias: process.env.TMP,
  tempAlias: process.env.TEMP,
  database: process.env.C3_DB_PATH,
  projects: process.env.C3_PROJECTS_DIR,
  artifacts: process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
  artifactsMode: lstatSync(process.env.INTENTSMITH_TEST_ARTIFACT_DIR).mode & 0o777,
  home: process.env.HOME,
  homeMode: lstatSync(process.env.HOME).mode & 0o777,
  xdgConfig: process.env.XDG_CONFIG_HOME,
  xdgConfigMode: lstatSync(process.env.XDG_CONFIG_HOME).mode & 0o777,
  xdgCache: process.env.XDG_CACHE_HOME,
  xdgCacheMode: lstatSync(process.env.XDG_CACHE_HOME).mode & 0o777,
  xdgData: process.env.XDG_DATA_HOME,
  xdgDataMode: lstatSync(process.env.XDG_DATA_HOME).mode & 0o777,
  xdgState: process.env.XDG_STATE_HOME,
  xdgStateMode: lstatSync(process.env.XDG_STATE_HOME).mode & 0o777,
  npmCache: process.env.npm_config_cache,
  npmCacheMode: lstatSync(process.env.npm_config_cache).mode & 0o777,
  portFile: process.env.C3_PORT_FILE,
};
close();
console.log('ISOLATION_PROBE:' + JSON.stringify(probe));
`);
  const directE2eHarnessProbe = runFixture(
    directE2eHarnessProbeFixture,
    { raw: true, timeout: 20_000 },
  );
  assert.equal(
    directE2eHarnessProbe.error,
    undefined,
    String(directE2eHarnessProbe.error),
  );
  assert.equal(
    directE2eHarnessProbe.status,
    0,
    directE2eHarnessProbe.stderr || directE2eHarnessProbe.stdout,
  );
  const e2eHarnessProbe = parseRuntimeProbe(directE2eHarnessProbe);
  assertDirectRuntimeProbe(e2eHarnessProbe, 'E2E harness anchor');
  assert.equal(e2eHarnessProbe.realRoot, e2eHarnessProbe.root);
  assert.equal(e2eHarnessProbe.tmpAlias, e2eHarnessProbe.temp);
  assert.equal(e2eHarnessProbe.tempAlias, e2eHarnessProbe.temp);
  assert.equal(
    existsSync(e2eHarnessProbe.root),
    false,
    'exit 0 must remove the direct E2E harness runtime',
  );

  const failingRuntimeFixture = writeFixture('direct-runtime-failure.mjs', `
import { isolatedTestRuntime } from ${JSON.stringify(isolationHelperUrl)};
const { lstatSync } = await import('node:fs');
console.log('ISOLATION_PROBE:' + JSON.stringify({
  ...isolatedTestRuntime,
  rootMode: lstatSync(isolatedTestRuntime.root).mode & 0o777,
  tempMode: lstatSync(isolatedTestRuntime.temp).mode & 0o777,
  artifactsMode: lstatSync(isolatedTestRuntime.artifacts).mode & 0o777,
  homeMode: lstatSync(isolatedTestRuntime.home).mode & 0o777,
  xdgConfigMode: lstatSync(isolatedTestRuntime.xdgConfig).mode & 0o777,
  xdgCacheMode: lstatSync(isolatedTestRuntime.xdgCache).mode & 0o777,
  xdgDataMode: lstatSync(isolatedTestRuntime.xdgData).mode & 0o777,
  xdgStateMode: lstatSync(isolatedTestRuntime.xdgState).mode & 0o777,
  npmCacheMode: lstatSync(isolatedTestRuntime.npmCache).mode & 0o777,
}));
process.exitCode = 9;
`);
  const failingRuntime = runFixture(failingRuntimeFixture, { raw: true });
  assert.equal(failingRuntime.error, undefined, String(failingRuntime.error));
  assert.equal(
    failingRuntime.status,
    9,
    failingRuntime.stderr || failingRuntime.stdout,
  );
  const preservedProbe = parseRuntimeProbe(failingRuntime);
  assertDirectRuntimeProbe(preservedProbe, 'failed direct run');
  assert.equal(existsSync(preservedProbe.root), true);
  assert.equal(realpathSync(preservedProbe.root), preservedProbe.root);
  assert.match(failingRuntime.stderr, /Isolated test runtime preserved:/);
  rmSync(preservedProbe.root, { recursive: true, force: true });

  const cleanupFailureFixture = writeFixture('direct-runtime-cleanup-failure.mjs', `
import { isolatedTestRuntime } from ${JSON.stringify(isolationHelperUrl)};
import {
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

const replacementTarget = join(
  dirname(isolatedTestRuntime.root),
  basename(isolatedTestRuntime.root) + '-replacement',
);
mkdirSync(replacementTarget, { mode: 0o700 });
console.log('ISOLATION_PROBE:' + JSON.stringify({
  ...isolatedTestRuntime,
  replacementTarget,
  rootMode: lstatSync(isolatedTestRuntime.root).mode & 0o777,
  tempMode: lstatSync(isolatedTestRuntime.temp).mode & 0o777,
  artifactsMode: lstatSync(isolatedTestRuntime.artifacts).mode & 0o777,
  homeMode: lstatSync(isolatedTestRuntime.home).mode & 0o777,
  xdgConfigMode: lstatSync(isolatedTestRuntime.xdgConfig).mode & 0o777,
  xdgCacheMode: lstatSync(isolatedTestRuntime.xdgCache).mode & 0o777,
  xdgDataMode: lstatSync(isolatedTestRuntime.xdgData).mode & 0o777,
  xdgStateMode: lstatSync(isolatedTestRuntime.xdgState).mode & 0o777,
  npmCacheMode: lstatSync(isolatedTestRuntime.npmCache).mode & 0o777,
}));
rmSync(isolatedTestRuntime.root, { recursive: true, force: true });
symlinkSync(replacementTarget, isolatedTestRuntime.root);
`);
  const cleanupFailure = runFixture(cleanupFailureFixture, { raw: true });
  assert.equal(cleanupFailure.error, undefined, String(cleanupFailure.error));
  assert.equal(
    cleanupFailure.status,
    1,
    cleanupFailure.stderr || cleanupFailure.stdout,
  );
  const cleanupFailureProbe = parseRuntimeProbe(cleanupFailure);
  assertDirectRuntimeProbe(cleanupFailureProbe, 'cleanup failure');
  assert.match(
    cleanupFailure.stderr,
    /Failed to remove isolated test runtime .*Refusing to remove a non-directory or symlink/,
  );
  assert.equal(lstatSync(cleanupFailureProbe.root).isSymbolicLink(), true);
  assert.equal(
    realpathSync(cleanupFailureProbe.root),
    cleanupFailureProbe.replacementTarget,
  );
  unlinkSync(cleanupFailureProbe.root);
  rmSync(cleanupFailureProbe.replacementTarget, {
    recursive: true,
    force: true,
  });

  const unsafeRepository = join(fixtureDir, 'unsafe-existing-root-repository');
  const unsafeHelperDirectory = join(unsafeRepository, 'tests', 'helpers');
  const unsafeHelperPath = join(unsafeHelperDirectory, 'isolated-test-db.js');
  const unsafeArtifactRoot = join(unsafeRepository, '.intentsmith-artifacts');
  mkdirSync(unsafeHelperDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(unsafeArtifactRoot, { mode: 0o755 });
  chmodSync(unsafeArtifactRoot, 0o755);
  writeFileSync(
    unsafeHelperPath,
    readFileSync(join(__dirname, 'helpers', 'isolated-test-db.js'), 'utf8'),
    'utf8',
  );
  const unsafeExistingRootFixture = writeFixture(
    'unsafe-existing-root-probe.mjs',
    `import ${JSON.stringify(pathToFileURL(unsafeHelperPath).href)};\n`,
  );
  const unsafeExistingRoot = runFixture(
    unsafeExistingRootFixture,
    { raw: true },
  );
  assert.equal(
    unsafeExistingRoot.error,
    undefined,
    String(unsafeExistingRoot.error),
  );
  assert.equal(unsafeExistingRoot.status, 1, unsafeExistingRoot.stdout);
  assert.match(
    unsafeExistingRoot.stderr,
    /repository artifact root must not be accessible by group or other users/,
  );
  assert.equal(lstatSync(unsafeArtifactRoot).mode & 0o777, 0o755);

  const auditRoot = join(fixtureDir, 'audit-owned');
  const auditTemp = join(auditRoot, 'tmp');
  const auditRuntime = join(auditRoot, 'runtime');
  const auditProjects = join(auditRoot, 'projects');
  const auditArtifacts = join(auditRoot, 'artifacts');
  const auditHome = join(auditRoot, 'home');
  const auditXdgConfig = join(auditRoot, 'xdg-config');
  const auditXdgCache = join(auditRoot, 'xdg-cache');
  const auditXdgData = join(auditRoot, 'xdg-data');
  const auditXdgState = join(auditRoot, 'xdg-state');
  const auditNpmCache = join(auditArtifacts, 'npm-cache');
  for (const directory of [
    auditRoot,
    auditTemp,
    auditRuntime,
    auditProjects,
    auditArtifacts,
    auditHome,
    auditXdgConfig,
    auditXdgCache,
    auditXdgData,
    auditXdgState,
    auditNpmCache,
  ]) {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
  }
  const auditEnvironment = {
    HOME: auditHome,
    XDG_CONFIG_HOME: auditXdgConfig,
    XDG_CACHE_HOME: auditXdgCache,
    XDG_DATA_HOME: auditXdgData,
    XDG_STATE_HOME: auditXdgState,
    TMPDIR: auditTemp,
    TMP: auditTemp,
    TEMP: auditTemp,
    npm_config_cache: auditNpmCache,
    C3_DB_PATH: join(auditRuntime, 'audit.sqlite'),
    C3_PROJECTS_DIR: auditProjects,
    INTENTSMITH_TEST_PROJECTS_DIR: auditProjects,
    INTENTSMITH_TEST_ARTIFACT_DIR: auditArtifacts,
    C3_PORT_FILE: join(auditRuntime, 'audit.port'),
  };
  const auditProbeFixture = writeFixture('audit-runtime-probe.mjs', `
import { isolatedTestRuntime } from ${JSON.stringify(isolationHelperUrl)};
console.log('ISOLATION_PROBE:' + JSON.stringify(isolatedTestRuntime));
`);
  const auditProbeResult = runFixture(
    auditProbeFixture,
    { env: auditEnvironment },
  );
  assert.equal(
    auditProbeResult.error,
    undefined,
    String(auditProbeResult.error),
  );
  assert.equal(
    auditProbeResult.status,
    0,
    auditProbeResult.stderr || auditProbeResult.stdout,
  );
  const auditProbe = parseRuntimeProbe(auditProbeResult);
  assert.equal(auditProbe.mode, 'audit');
  assert.equal(auditProbe.root, null);
  assert.equal(auditProbe.temp, auditTemp);
  assert.equal(auditProbe.database, auditEnvironment.C3_DB_PATH);
  assert.equal(auditProbe.projects, auditProjects);
  assert.equal(auditProbe.artifacts, auditArtifacts);
  assert.equal(auditProbe.home, auditHome);
  assert.equal(auditProbe.xdgConfig, auditXdgConfig);
  assert.equal(auditProbe.xdgCache, auditXdgCache);
  assert.equal(auditProbe.xdgData, auditXdgData);
  assert.equal(auditProbe.xdgState, auditXdgState);
  assert.equal(auditProbe.npmCache, auditNpmCache);
  assert.equal(auditProbe.portFile, auditEnvironment.C3_PORT_FILE);
  assert.equal(existsSync(auditRoot), true, 'helper must not remove audit-owned roots');

  const auditArtifactsLink = join(auditRoot, 'artifacts-link');
  symlinkSync(auditArtifacts, auditArtifactsLink);
  const unsafeAuditResult = runFixture(auditProbeFixture, {
    env: {
      ...auditEnvironment,
      INTENTSMITH_TEST_ARTIFACT_DIR: auditArtifactsLink,
    },
  });
  assert.equal(unsafeAuditResult.error, undefined, String(unsafeAuditResult.error));
  assert.equal(unsafeAuditResult.status, 1, unsafeAuditResult.stdout);
  assert.match(
    unsafeAuditResult.stderr,
    /INTENTSMITH_TEST_ARTIFACT_DIR must name an existing non-symlink directory/,
  );
  assert.equal(realpathSync(auditArtifactsLink), auditArtifacts);

  const auditHomeLink = join(auditRoot, 'home-link');
  symlinkSync(auditHome, auditHomeLink);
  const unsafeAuditHomeResult = runFixture(auditProbeFixture, {
    env: {
      ...auditEnvironment,
      HOME: auditHomeLink,
    },
  });
  assert.equal(
    unsafeAuditHomeResult.error,
    undefined,
    String(unsafeAuditHomeResult.error),
  );
  assert.equal(unsafeAuditHomeResult.status, 1, unsafeAuditHomeResult.stdout);
  assert.match(
    unsafeAuditHomeResult.stderr,
    /HOME must name an existing non-symlink directory/,
  );

  const auditCacheOutsideArtifacts = join(auditRoot, 'npm-cache-outside-artifacts');
  mkdirSync(auditCacheOutsideArtifacts, { mode: 0o700 });
  const unsafeAuditCacheResult = runFixture(auditProbeFixture, {
    env: {
      ...auditEnvironment,
      npm_config_cache: auditCacheOutsideArtifacts,
    },
  });
  assert.equal(
    unsafeAuditCacheResult.error,
    undefined,
    String(unsafeAuditCacheResult.error),
  );
  assert.equal(unsafeAuditCacheResult.status, 1, unsafeAuditCacheResult.stdout);
  assert.match(
    unsafeAuditCacheResult.stderr,
    /npm_config_cache must be inside INTENTSMITH_TEST_ARTIFACT_DIR/,
  );

  const failingFixture = writeFixture('failing-fixture.mjs', `
import { suite, test, assert, summary } from ${JSON.stringify(harnessUrl)};

suite('meta failing fixture');
test('intentional failure', () => assert(false, 'intentional failure'));
summary();
`);

  const failing = runFixture(failingFixture);
  assert.equal(failing.error, undefined, String(failing.error));
  assert.equal(failing.status, 1, failing.stderr || failing.stdout);
  assert.match(failing.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const passingFixture = writeFixture('passing-fixture.mjs', `
import { suite, test, assert, summary } from ${JSON.stringify(harnessUrl)};

suite('meta passing fixture');
test('intentional pass', () => assert(true, 'intentional pass'));
summary();
`);

  const passing = runFixture(passingFixture);
  assert.equal(passing.error, undefined, String(passing.error));
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /RESULTS:\s*1 passed,\s*0 failed/);

  const timeoutFixture = writeFixture('timeout-fixture.mjs', `
import { suite, testAsync, summary } from ${JSON.stringify(harnessUrl)};

suite('meta timeout fixture');
await testAsync('intentional timeout', () => new Promise(() => {}), 25);
summary();
`);

  const timedOut = runFixture(timeoutFixture);
  assert.equal(timedOut.error, undefined, String(timedOut.error));
  assert.equal(timedOut.status, 1, timedOut.stderr || timedOut.stdout);
  assert.match(timedOut.stdout, /Test timed out after 25ms/);
  assert.match(timedOut.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const defaultTimeoutFixture = writeFixture('default-timeout-fixture.mjs', `
import {
  DEFAULT_ASYNC_TEST_TIMEOUT_MS,
  suite,
  testAsync,
  summary,
} from ${JSON.stringify(harnessUrl)};

suite('meta default timeout fixture');
const nativeSetTimeout = globalThis.setTimeout;
let requestedTimeoutMs = null;
globalThis.setTimeout = (callback, timeoutMs, ...args) => {
  requestedTimeoutMs = timeoutMs;
  return nativeSetTimeout(callback, 5, ...args);
};
try {
  await testAsync('missing timeout is still bounded', () => new Promise(() => {}));
} finally {
  globalThis.setTimeout = nativeSetTimeout;
}
if (requestedTimeoutMs !== DEFAULT_ASYNC_TEST_TIMEOUT_MS) {
  throw new Error(
    \`Expected default timeout \${DEFAULT_ASYNC_TEST_TIMEOUT_MS}, got \${requestedTimeoutMs}\`,
  );
}
summary();
`);

  const defaultTimedOut = runFixture(defaultTimeoutFixture);
  assert.equal(defaultTimedOut.error, undefined, String(defaultTimedOut.error));
  assert.equal(defaultTimedOut.status, 1, defaultTimedOut.stderr || defaultTimedOut.stdout);
  assert.match(defaultTimedOut.stdout, /Test timed out after 600000ms/);
  assert.match(defaultTimedOut.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const asyncCallbackFixture = writeFixture('async-callback-fixture.mjs', `
import { suite, test, summary } from ${JSON.stringify(harnessUrl)};

suite('meta async callback fixture');
const neverSettles = async () => new Promise(() => {});
test('never settles', neverSettles);
summary();
`);

  const asyncCallback = runFixture(asyncCallbackFixture);
  assert.equal(asyncCallback.error, undefined, String(asyncCallback.error));
  assert.equal(asyncCallback.status, 1, asyncCallback.stderr || asyncCallback.stdout);
  assert.match(
    asyncCallback.stdout,
    /test\(\) does not accept async callbacks or returned thenables/,
  );
  assert.match(asyncCallback.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const specialistRuntimeTestPath = join(__dirname, 'specialist-runtime.test.js');
  const specialistRuntimeUrl = pathToFileURL(
    join(__dirname, '../src/expertises/specialist-runtime.js'),
  ).href;
  const accountantPackageUrl = pathToFileURL(
    join(__dirname, '../specialists/accountant-cz/index.js'),
  ).href;
  const specialistRuntimeSource = readFileSync(specialistRuntimeTestPath, 'utf8');
  const passingAssertion = "assert(specialistRuntime.isSpecialist('accountant'));";
  assert.match(specialistRuntimeSource, /process\.exitCode = failed > 0 \? 1 : 0/);
  assert.ok(
    specialistRuntimeSource.includes(passingAssertion),
    'specialist runtime failure-injection target is stale',
  );

  const failingSpecialistRuntimeSource = specialistRuntimeSource
    .replace(
      "'../src/expertises/specialist-runtime.js'",
      JSON.stringify(specialistRuntimeUrl),
    )
    .replace(
      "'../specialists/accountant-cz/index.js'",
      JSON.stringify(accountantPackageUrl),
    )
    .replace(
      passingAssertion,
      "assert.fail('meta injected specialist runtime failure');",
    );
  const failingSpecialistRuntimeFixture = writeFixture(
    'specialist-runtime-failing-fixture.mjs',
    failingSpecialistRuntimeSource,
  );
  const failingSpecialistRuntime = runFixture(failingSpecialistRuntimeFixture);
  assert.equal(
    failingSpecialistRuntime.error,
    undefined,
    String(failingSpecialistRuntime.error),
  );
  assert.equal(
    failingSpecialistRuntime.status,
    1,
    failingSpecialistRuntime.stderr || failingSpecialistRuntime.stdout,
  );
  assert.match(
    failingSpecialistRuntime.stdout,
    /Specialist Runtime:\s*22\/23 PASS,\s*1 FAIL/,
  );
  assert.match(
    failingSpecialistRuntime.stdout,
    /meta injected specialist runtime failure/,
  );

  const returnedThenableFixture = writeFixture('returned-thenable-fixture.mjs', `
import { suite, test, summary } from ${JSON.stringify(harnessUrl)};

suite('meta returned thenable fixture');
test('returns a promise', () => Promise.resolve('not awaited'));
summary();
`);

  const returnedThenable = runFixture(returnedThenableFixture);
  assert.equal(returnedThenable.error, undefined, String(returnedThenable.error));
  assert.equal(returnedThenable.status, 1, returnedThenable.stderr || returnedThenable.stdout);
  assert.match(
    returnedThenable.stdout,
    /test\(\) does not accept async callbacks or returned thenables/,
  );
  assert.match(returnedThenable.stdout, /RESULTS:\s*0 passed,\s*1 failed/);

  const executorCases = [
    ['tests/example.js', ['node', 'tests/example.js']],
    ['tests/example.cjs', ['node', 'tests/example.cjs']],
    ['tests/test_example.py', ['python3', 'tests/test_example.py']],
    ['tests/_legacy/example.sh', ['bash', 'tests/_legacy/example.sh']],
  ];
  for (const [path, argv] of executorCases) {
    const registry = {
      schemaVersion: 3,
      exclusions: [],
      suites: [validRegistrySuite(path, argv)],
    };
    assert.deepEqual(validateTestRegistry(registry, [path]), []);
  }

  const wrongExecutor = {
    schemaVersion: 3,
    exclusions: [],
    suites: [
      validRegistrySuite('tests/example.js', ['/bin/true', 'tests/example.js']),
    ],
  };
  assert.ok(
    validateTestRegistry(wrongExecutor, ['tests/example.js'])
      .some(error => error.includes('argv[0] must equal node')),
  );

  const extraArgument = {
    schemaVersion: 3,
    exclusions: [],
    suites: [
      validRegistrySuite(
        'tests/example.js',
        ['node', 'tests/example.js', '--unreviewed'],
      ),
    ],
  };
  assert.ok(
    validateTestRegistry(extraArgument, ['tests/example.js'])
      .some(error => error.includes('must contain exactly executable and path')),
  );

  const missingPath = {
    schemaVersion: 3,
    exclusions: [],
    suites: [validRegistrySuite(undefined, ['node', 'tests/example.js'])],
  };
  assert.ok(
    validateTestRegistry(missingPath, [])
      .some(error => error.includes('path is unsafe')),
  );

  const requiredT4 = {
    schemaVersion: 3,
    exclusions: [],
    suites: [validRegistrySuite('tests/example.js', ['node', 'tests/example.js'])],
  };
  requiredT4.suites[0].tier = 'T4';
  assert.ok(
    validateTestRegistry(requiredT4, ['tests/example.js'])
      .some(error => error.includes('T4 replacement benchmarks must not be required')),
  );

  const deferredT4 = structuredClone(requiredT4);
  deferredT4.suites[0].required = false;
  assert.deepEqual(
    validateTestRegistry(deferredT4, ['tests/example.js']),
    [],
  );

  const discoveryRoot = join(fixtureDir, 'discovery-root');
  mkdirSync(join(discoveryRoot, 'tests'), { recursive: true });
  writeFileSync(join(discoveryRoot, 'tests', 'unconventional.runner.mjs'), 'export {};\n');
  writeFileSync(join(discoveryRoot, 'tests', 'fixture-helper.js'), 'export {};\n');
  assert.deepEqual(
    await discoverRunnablePrograms(discoveryRoot),
    [
      'tests/fixture-helper.js',
      'tests/unconventional.runner.mjs',
    ],
    'program discovery must not depend on test filename conventions',
  );

  const explicitExclusion = {
    schemaVersion: 3,
    exclusions: [{
      path: 'tests/fixture-helper.js',
      reason: 'Imported support fixture with no top-level test entry point.',
    }],
    suites: [
      validRegistrySuite(
        'tests/unconventional.runner.mjs',
        ['node', 'tests/unconventional.runner.mjs'],
      ),
    ],
  };
  assert.deepEqual(
    validateTestRegistry(
      explicitExclusion,
      ['tests/fixture-helper.js', 'tests/unconventional.runner.mjs'],
    ),
    [],
  );

  const unexplainedProgram = structuredClone(explicitExclusion);
  unexplainedProgram.exclusions = [];
  assert.ok(
    validateTestRegistry(
      unexplainedProgram,
      ['tests/fixture-helper.js', 'tests/unconventional.runner.mjs'],
    ).some(error => error.includes('unregistered or unexplained test program')),
  );

  const overlap = structuredClone(explicitExclusion);
  overlap.exclusions[0].path = 'tests/unconventional.runner.mjs';
  assert.ok(
    validateTestRegistry(overlap, ['tests/unconventional.runner.mjs'])
      .some(error => error.includes('both registered and excluded')),
  );

  const symlinkRoot = join(fixtureDir, 'symlink-root');
  mkdirSync(join(symlinkRoot, 'tests'), { recursive: true });
  writeFileSync(join(symlinkRoot, 'tests', 'target.js'), 'export {};\n');
  symlinkSync('target.js', join(symlinkRoot, 'tests', 'alias.js'));
  await assert.rejects(
    discoverRunnablePrograms(symlinkRoot),
    /Test inventory rejects symbolic links/,
  );

  console.log('Harness exit-code meta-test passed');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
