#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  runAudit,
  runAuditWithTerminationHandling,
} from '../scripts/nightly-audit.js';
import {
  MISSING_DATABASE_PATH_MESSAGE,
  requireConfiguredDatabasePath,
} from '../src/db/database-path.js';
import {
  evaluateModelFixturePreflight,
  probeModelFixture,
  validateModelFixtureRequirement,
} from '../scripts/model-fixture-preflight.js';
import { validateTestRegistry } from '../scripts/test-registry.js';

const tempRoots = new Set();
const activeSignalFixtures = new Set();
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalUmask = process.umask();
const originalStudioDisplay = process.env.INTENTSMITH_STUDIO_DISPLAY;
const originalStudioXauthority = process.env.INTENTSMITH_STUDIO_XAUTHORITY;
const originalDisplay = process.env.DISPLAY;
const originalXauthority = process.env.XAUTHORITY;
const EXECUTION_FIXTURE_TIMEOUT_MS = 1_000;
let permissiveUmaskActive = false;
const modelFixtureOnly = process.argv.slice(2).includes('--model-fixture-only');
const MIB = 1024 * 1024;
const modelFixtureRequirement = {
  provider: 'ollama',
  model: 'qwen3.5:27b',
  digestSha256: '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e',
  contextWindowTokens: 8_192,
  minimumFreeVramMiB: 20_128,
  parallelRequests: 1,
  minimumHeadroomMiB: 1_024,
  minimumGpuResidencyPercent: 100,
  fallbackPolicy: 'forbid',
};

function modelFixtureObservation(overrides = {}) {
  return {
    provider: 'ollama',
    installedModel: {
      model: modelFixtureRequirement.model,
      digestSha256: modelFixtureRequirement.digestSha256,
    },
    loadedModel: {
      model: modelFixtureRequirement.model,
      digestSha256: modelFixtureRequirement.digestSha256,
      allocatedContextTokens: 8_192,
      sizeBytes: 20_480 * MIB,
      sizeVramBytes: 20_480 * MIB,
    },
    gpu: {
      totalVramMiB: 24_576,
      freeVramMiB: 4_096,
    },
    ...overrides,
  };
}

try {
if (!modelFixtureOnly) {
assert.throws(
  () => requireConfiguredDatabasePath(undefined),
  new RegExp(MISSING_DATABASE_PATH_MESSAGE.replaceAll('.', '\\.')),
);
assert.throws(
  () => requireConfiguredDatabasePath('   '),
  new RegExp(MISSING_DATABASE_PATH_MESSAGE.replaceAll('.', '\\.')),
);
assert.equal(requireConfiguredDatabasePath('  /owned/test.sqlite  '), '/owned/test.sqlite');

const databaseImportUrl = pathToFileURL(path.join(sourceRoot, 'src', 'db', 'database.js')).href;
const databaseProbeEnvironment = { ...process.env };
delete databaseProbeEnvironment.C3_DB_PATH;
delete databaseProbeEnvironment.NODE_OPTIONS;
const rejectedDatabaseImport = spawnSync(
  process.execPath,
  ['--input-type=module', '--eval', `await import(${JSON.stringify(databaseImportUrl)});`],
  {
    cwd: sourceRoot,
    env: databaseProbeEnvironment,
    encoding: 'utf8',
  },
);
assert.ifError(rejectedDatabaseImport.error);
assert.equal(rejectedDatabaseImport.status, 1);
assert.match(
  `${rejectedDatabaseImport.stdout}\n${rejectedDatabaseImport.stderr}`,
  new RegExp(MISSING_DATABASE_PATH_MESSAGE.replaceAll('.', '\\.')),
);

const runtimeEnvironmentUrl = pathToFileURL(
  path.join(sourceRoot, 'src', 'runtime-environment.js'),
).href;
const runtimeBootstrapEnvironment = { ...databaseProbeEnvironment };
runtimeBootstrapEnvironment.DOTENV_CONFIG_PATH = path.join(
  sourceRoot,
  '.intentsmith-no-such-env-file',
);
runtimeBootstrapEnvironment.DOTENV_CONFIG_QUIET = 'true';
const runtimeBootstrapProbe = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `await import(${JSON.stringify(runtimeEnvironmentUrl)}); process.stdout.write(process.env.C3_DB_PATH);`,
  ],
  {
    cwd: sourceRoot,
    env: runtimeBootstrapEnvironment,
    encoding: 'utf8',
  },
);
assert.ifError(runtimeBootstrapProbe.error);
assert.equal(runtimeBootstrapProbe.status, 0, runtimeBootstrapProbe.stderr);
assert.equal(
  runtimeBootstrapProbe.stdout,
  path.join(sourceRoot, 'data', 'c3.db'),
  'the product runtime bootstrap must preserve the explicit project-local default',
);

const databaseProbeRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-database-import-probe-'),
);
const isolatedDatabasePath = path.join(databaseProbeRoot, 'probe.sqlite');
const acceptedDatabaseImport = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `const module = await import(${JSON.stringify(databaseImportUrl)}); module.close();`,
  ],
  {
    cwd: sourceRoot,
    env: {
      ...databaseProbeEnvironment,
      C3_DB_PATH: isolatedDatabasePath,
      C3_LOG_LEVEL: 'error',
    },
    encoding: 'utf8',
  },
);
assert.ifError(acceptedDatabaseImport.error);
assert.equal(acceptedDatabaseImport.status, 0, acceptedDatabaseImport.stderr);
assert.equal((await stat(isolatedDatabasePath)).isFile(), true);
}

assert.deepEqual(validateModelFixtureRequirement(modelFixtureRequirement), []);
assert.match(
  validateModelFixtureRequirement({
    ...modelFixtureRequirement,
    digestSha256: 'not-a-digest',
  }).join('\n'),
  /digestSha256/,
);
assert.match(
  validateModelFixtureRequirement({
    ...modelFixtureRequirement,
    parallelRequests: 0,
  }).join('\n'),
  /parallelRequests/,
);
assert.match(
  validateModelFixtureRequirement({
    ...modelFixtureRequirement,
    fallbackPolicy: 'smaller-model',
  }).join('\n'),
  /fallbackPolicy/,
);

const validModelPreflight = evaluateModelFixturePreflight(
  modelFixtureRequirement,
  modelFixtureObservation(),
);
assert.equal(validModelPreflight.ok, true);
assert.deepEqual(validModelPreflight.issues, []);

const wrongDigestPreflight = evaluateModelFixturePreflight(
  modelFixtureRequirement,
  modelFixtureObservation({
    loadedModel: {
      ...modelFixtureObservation().loadedModel,
      digestSha256: 'f'.repeat(64),
    },
  }),
);
assert.equal(wrongDigestPreflight.ok, false);
assert.ok(wrongDigestPreflight.issues.some(issue => issue.code === 'loaded-digest-mismatch'));

const wrongConcurrencyPreflight = evaluateModelFixturePreflight(
  {
    ...modelFixtureRequirement,
    minimumFreeVramMiB: 24_016,
    parallelRequests: 3,
  },
  modelFixtureObservation(),
);
assert.equal(wrongConcurrencyPreflight.ok, false);
assert.ok(
  wrongConcurrencyPreflight.issues.some(
    issue => issue.code === 'context-concurrency-mismatch',
  ),
);

const insufficientVramPreflight = evaluateModelFixturePreflight(
  modelFixtureRequirement,
  modelFixtureObservation({
    loadedModel: {
      ...modelFixtureObservation().loadedModel,
      sizeBytes: 17_000 * MIB,
      sizeVramBytes: 17_000 * MIB,
    },
    gpu: {
      totalVramMiB: 24_576,
      freeVramMiB: 512,
    },
  }),
);
assert.equal(insufficientVramPreflight.ok, false);
assert.ok(
  insufficientVramPreflight.issues.some(issue => issue.code === 'free-vram-insufficient'),
);
assert.ok(
  insufficientVramPreflight.issues.some(issue => issue.code === 'vram-headroom-insufficient'),
);

const partialGpuPreflight = evaluateModelFixturePreflight(
  modelFixtureRequirement,
  modelFixtureObservation({
    loadedModel: {
      ...modelFixtureObservation().loadedModel,
      sizeVramBytes: 17_000 * MIB,
    },
    gpu: {
      totalVramMiB: 24_576,
      freeVramMiB: 7_576,
    },
  }),
);
assert.equal(partialGpuPreflight.ok, false);
assert.ok(
  partialGpuPreflight.issues.some(issue => issue.code === 'gpu-residency-insufficient'),
);

const probedModelPreflight = await probeModelFixture(modelFixtureRequirement, {
  fetchImpl: async url => ({
    ok: true,
    json: async () => url.endsWith('/api/tags')
      ? {
          models: [{
            name: modelFixtureRequirement.model,
            digest: modelFixtureRequirement.digestSha256,
          }],
        }
      : {
          models: [{
            name: modelFixtureRequirement.model,
            digest: modelFixtureRequirement.digestSha256,
            context_length: 8_192,
            size: 20_480 * MIB,
            size_vram: 20_480 * MIB,
          }],
        },
  }),
  execFileImpl: async () => ({ stdout: '24576, 4096\n' }),
});
assert.equal(probedModelPreflight.ok, true);

const unavailableModelPreflight = await probeModelFixture(modelFixtureRequirement, {
  fetchImpl: async () => {
    throw new Error('fixture Ollama unavailable');
  },
  execFileImpl: async () => ({ stdout: '24576, 4096\n' }),
});
assert.equal(unavailableModelPreflight.ok, false);
assert.deepEqual(
  unavailableModelPreflight.issues.map(issue => issue.code),
  ['probe-failed'],
);

const registryFixture = JSON.parse(await readFile(
  path.join(sourceRoot, 'tests', 'registry.json'),
  'utf8',
));
const registryCandidates = [
  ...registryFixture.suites.map(suite => suite.path),
  ...registryFixture.exclusions.map(exclusion => exclusion.path),
];
assert.deepEqual(validateTestRegistry(registryFixture, registryCandidates), []);
const missingFixtureRegistry = structuredClone(registryFixture);
delete missingFixtureRegistry.suites.find(
  suite => suite.id === 'IS-T3-E2E-57-LIFECYCLE-FULL',
).requirements.modelFixture;
assert.match(
  validateTestRegistry(missingFixtureRegistry, registryCandidates).join('\n'),
  /modelFixture is required by G0-R020/,
);
const invalidFixtureRegistry = structuredClone(registryFixture);
invalidFixtureRegistry.suites.find(
  suite => suite.id === 'IS-T3-E2E-88-CONCURRENT-LOAD',
).requirements.modelFixture.parallelRequests = 0;
assert.match(
  validateTestRegistry(invalidFixtureRegistry, registryCandidates).join('\n'),
  /parallelRequests/,
);

const modelPreflightRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-audit-runner-model-preflight-'),
);
await mkdir(path.join(modelPreflightRoot, 'tests'), { recursive: true });
await writeFile(
  path.join(modelPreflightRoot, 'tests', 'model.test.js'),
  'console.log("model fixture child executed");\n',
);
await writeFixtureRegistry(modelPreflightRoot, ['tests/model.test.js'], {
  profile: 'model',
  tier: 'T3',
  requirements: {
    network: 'loopback',
    database: false,
    server: false,
    ollama: true,
    gpu: true,
    modelFixture: modelFixtureRequirement,
  },
});
const modelPreflightPassRun = await runAudit({
  root: modelPreflightRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'model-preflight-pass',
  timeoutMs: 5_000,
  deadlineMs: 10_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  modelFixtureProbe: async requirement => evaluateModelFixturePreflight(
    requirement,
    modelFixtureObservation(),
  ),
});
assert.equal(modelPreflightPassRun.verdict, 'PASS');
assert.equal(modelPreflightPassRun.results[0].status, 'PASS');
assert.equal(modelPreflightPassRun.results[0].modelFixturePreflight?.ok, true);

const modelPreflightBlockedRun = await runAudit({
  root: modelPreflightRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'model-preflight-blocked',
  timeoutMs: 5_000,
  deadlineMs: 10_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  modelFixtureProbe: async requirement => evaluateModelFixturePreflight(
    requirement,
    modelFixtureObservation({
      gpu: {
        totalVramMiB: 24_576,
        freeVramMiB: 512,
      },
    }),
  ),
});
assert.equal(modelPreflightBlockedRun.verdict, 'BLOCKED');
assert.equal(modelPreflightBlockedRun.results[0].status, 'BLOCKED');
assert.ok(
  modelPreflightBlockedRun.results[0].blockedBy.includes(
    'model-fixture:vram-headroom-insufficient',
  ),
);
assert.equal(modelPreflightBlockedRun.results[0].logPath, null);

if (!modelFixtureOnly) {
const nestedSourceRoot = await makeTempDirectory(
  path.join(sourceRoot, 'tests', '.nightly-nested-source-'),
);
await mkdir(path.join(nestedSourceRoot, 'tests'), { recursive: true });
await writeFile(path.join(nestedSourceRoot, 'tests', 'pass.test.js'), 'console.log("nested pass");\n');
await writeFixtureRegistry(nestedSourceRoot, ['tests/pass.test.js']);
const nestedSourceDryRun = await runAudit({
  root: nestedSourceRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'nested-source-root',
  dryRun: true,
  noBlock: true,
});
assert.equal(
  nestedSourceDryRun.sourceRevision,
  'unknown',
  'a nested fixture must not inherit an ancestor worktree revision',
);
await assert.rejects(
  () => runAudit({
    root: nestedSourceRoot,
    outDir: 'data/artifacts/audit-runs',
    runId: 'nested-source-clean-guard',
    noBlock: true,
  }),
  /audit root is not an exact Git worktree root/,
);

const root = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-'));
const testsDir = path.join(root, 'tests');
await mkdir(testsDir, { recursive: true });

await writeFile(path.join(testsDir, 'pass.test.js'), `
import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
writeFileSync(path.join(process.env.TMPDIR, 'observed-env.json'), JSON.stringify({
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  npm_config_cache: process.env.npm_config_cache,
  NPM_CACHE_MODE: statSync(process.env.npm_config_cache).mode & 0o777,
  C3_DB_PATH: process.env.C3_DB_PATH,
  INTENTSMITH_PDF_PYTHON: process.env.INTENTSMITH_PDF_PYTHON,
  C3_PDF_PYTHON: process.env.C3_PDF_PYTHON,
  DISPLAY: process.env.DISPLAY,
  XAUTHORITY: process.env.XAUTHORITY,
  INTENTSMITH_STUDIO_DISPLAY: process.env.INTENTSMITH_STUDIO_DISPLAY,
  INTENTSMITH_STUDIO_XAUTHORITY: process.env.INTENTSMITH_STUDIO_XAUTHORITY,
  INTENTSMITH_TEST_SOURCE_REVISION: process.env.INTENTSMITH_TEST_SOURCE_REVISION,
  PYTHONNOUSERSITE: process.env.PYTHONNOUSERSITE,
  TEST_SECRET_SENTINEL: process.env.TEST_SECRET_SENTINEL,
  UMASK: process.umask(),
}));
console.log("fixture pass");
`);
await writeFile(path.join(testsDir, 'fail.test.js'), 'console.error("fixture fail"); process.exit(7);\n');
await writeFile(path.join(testsDir, 'test_flush.py'), `
for i in range(2000):
    print(f"flush-line-{i}")
print("FLUSH_MARKER_END")
`);
await writeFile(path.join(testsDir, 'timeout.test.js'), 'setTimeout(() => {}, 5000);\n');
await writeFile(path.join(testsDir, 'ignore-term.test.js'), `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFile(path.join(testsDir, 'spawn-child.test.js'), `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000);'], { stdio: 'ignore' });
writeFileSync('child.pid', String(child.pid));
setInterval(() => {}, 1000);
`);
await writeFixtureRegistry(root, [
  'tests/fail.test.js',
  'tests/ignore-term.test.js',
  'tests/pass.test.js',
  'tests/spawn-child.test.js',
  'tests/test_flush.py',
  'tests/timeout.test.js',
]);

const dryRun = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-dry-run',
  dryRun: true,
  noBlock: true,
});

assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.inventory.total, 6);
assert.deepEqual(dryRun.statusCounts, {
  PASS: 0,
  FAIL: 0,
  TIMEOUT: 0,
  BLOCKED: 0,
  SKIPPED: 0,
});

const selectedDryRun = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-selected-dry-run',
  dryRun: true,
  ids: new Set(['IS-T1-SELF-003']),
});
assert.equal(selectedDryRun.inventory.total, 1);
assert.equal(selectedDryRun.results.length, 0);

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-unknown-id',
    dryRun: true,
    ids: new Set(['IS-T1-NOT-REGISTERED']),
  }),
  /Unknown test suite id/,
);

process.env.TEST_SECRET_SENTINEL = 'must-not-reach-child';
const expectedPdfPython = path.join(root, 'private-pdf-runtime', 'bin', 'python');
process.env.INTENTSMITH_PDF_PYTHON = expectedPdfPython;
process.env.C3_PDF_PYTHON = expectedPdfPython;
process.umask(0o022);
permissiveUmaskActive = true;
const run = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-execution',
  timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
  deadlineMs: 15_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
});
delete process.env.TEST_SECRET_SENTINEL;
delete process.env.INTENTSMITH_PDF_PYTHON;
delete process.env.C3_PDF_PYTHON;
assert.equal(process.umask(), 0o022, 'audit runner must restore its parent umask');

assert.equal(run.inventory.total, 6);
assert.equal(run.statusCounts.PASS, 2);
assert.equal(run.statusCounts.FAIL, 2);
assert.equal(run.statusCounts.TIMEOUT, 2);
assert.equal(run.requiredFailureCount, 4);
assert.equal(run.verdict, 'FAIL');
assert.equal(run.exitCode, 1);

const byPath = new Map(run.results.map(result => [result.path, result]));
assert.equal(byPath.get('tests/pass.test.js')?.status, 'PASS');
assert.equal(byPath.get('tests/test_flush.py')?.status, 'PASS');
assert.equal(byPath.get('tests/fail.test.js')?.status, 'FAIL');
assert.equal(byPath.get('tests/fail.test.js')?.exitCode, 7);
assert.equal(byPath.get('tests/timeout.test.js')?.status, 'TIMEOUT');
assert.equal(byPath.get('tests/ignore-term.test.js')?.status, 'TIMEOUT');
assert.equal(byPath.get('tests/spawn-child.test.js')?.status, 'FAIL');
assert.equal(byPath.get('tests/spawn-child.test.js')?.cleanup.leakDetected, true);
assert.equal(byPath.get('tests/spawn-child.test.js')?.cleanup.terminated, true);

for (const result of run.results) {
  assert.equal(result.retryCount, 0);
  assert.ok(result.start);
  assert.ok(result.end);
  assert.ok(result.durationMs >= 0);
  assert.equal(result.sourceRevision, 'unknown');
  assert.ok(result.logPath);
  await readFile(path.join(root, result.logPath), 'utf8');
}
const flushLog = await readFile(path.join(root, byPath.get('tests/test_flush.py').logPath), 'utf8');
assert.match(flushLog, /FLUSH_MARKER_END/);
const observedEnv = JSON.parse(await readFile(
  path.join(byPath.get('tests/pass.test.js').environment.temp, 'observed-env.json'),
  'utf8',
));
assert.equal(observedEnv.HOME, byPath.get('tests/pass.test.js').environment.home);
assert.equal(
  observedEnv.XDG_CONFIG_HOME,
  byPath.get('tests/pass.test.js').environment.xdg.config,
);
assert.equal(
  observedEnv.XDG_CACHE_HOME,
  byPath.get('tests/pass.test.js').environment.xdg.cache,
);
assert.equal(
  observedEnv.XDG_DATA_HOME,
  byPath.get('tests/pass.test.js').environment.xdg.data,
);
assert.equal(
  observedEnv.XDG_STATE_HOME,
  byPath.get('tests/pass.test.js').environment.xdg.state,
);
assert.equal(
  observedEnv.npm_config_cache,
  byPath.get('tests/pass.test.js').environment.npmCache,
);
assert.equal(observedEnv.NPM_CACHE_MODE, 0o700);
assert.equal(
  path.dirname(byPath.get('tests/pass.test.js').environment.npmCache),
  byPath.get('tests/pass.test.js').environment.artifacts,
);
assert.equal(observedEnv.C3_DB_PATH, byPath.get('tests/pass.test.js').environment.database);
assert.equal(observedEnv.INTENTSMITH_PDF_PYTHON, expectedPdfPython);
assert.equal(observedEnv.C3_PDF_PYTHON, expectedPdfPython);
assert.equal(observedEnv.DISPLAY, undefined);
assert.equal(observedEnv.XAUTHORITY, undefined);
assert.equal(observedEnv.INTENTSMITH_STUDIO_DISPLAY, undefined);
assert.equal(observedEnv.INTENTSMITH_STUDIO_XAUTHORITY, undefined);
assert.equal(observedEnv.INTENTSMITH_TEST_SOURCE_REVISION, 'unknown');
assert.equal(observedEnv.PYTHONNOUSERSITE, '1');
assert.equal(observedEnv.TEST_SECRET_SENTINEL, undefined);
assert.equal(observedEnv.UMASK, 0o077);
assert.deepEqual(
  byPath.get('tests/pass.test.js').environment.forwardedRuntimeKeys,
  ['INTENTSMITH_PDF_PYTHON', 'C3_PDF_PYTHON'],
);
assert.equal(byPath.get('tests/pass.test.js').environment.pdfPython, expectedPdfPython);
assert.equal(byPath.get('tests/pass.test.js').environment.sourceRevision, 'unknown');
assert.equal(byPath.get('tests/pass.test.js').environment.pythonNoUserSite, true);
process.umask(originalUmask);
permissiveUmaskActive = false;
assert.equal(new Set(run.results.map(result => result.environment?.database).filter(Boolean)).size, 6);
assert.equal(new Set(run.results.map(result => result.environment?.npmCache).filter(Boolean)).size, 6);
for (const result of run.results) {
  assert.equal((await stat(result.environment.npmCache)).mode & 0o777, 0o700);
}
assert.equal((await stat(path.join(root, run.paths.report))).mode & 0o777, 0o600);

await readFile(path.join(root, dryRun.paths.report), 'utf8');
await readFile(path.join(root, run.paths.report), 'utf8');
await readFile(path.join(root, run.paths.checkpoint), 'utf8');

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
  }),
  /Run id already exists/
);

const resumed = await runAudit({
  root,
  outDir: 'data/artifacts/audit-runs',
  runId: 'self-test-execution',
  timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
  deadlineMs: 15_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  resume: true,
});
assert.equal(resumed.results.length, 6);

const passResult = byPath.get('tests/pass.test.js');
const passLogPath = path.join(root, passResult.logPath);
const originalPassLog = await readFile(passLogPath, 'utf8');
assert.match(originalPassLog, /fixture pass/);
await writeFile(passLogPath, `${originalPassLog}\ntampered\n`);
await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    resume: true,
  }),
  /log evidence hash mismatch/,
);
await writeFile(passLogPath, originalPassLog);

const externalResumeLog = path.join(root, 'outside-resume.log');
await writeFile(externalResumeLog, originalPassLog, { mode: 0o644 });
const externalResumeLogMode = (await stat(externalResumeLog)).mode & 0o777;
await rm(passLogPath);
await symlink(externalResumeLog, passLogPath);
await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    resume: true,
  }),
  /resume log .* is not a regular contained file/,
);
assert.equal(await readFile(externalResumeLog, 'utf8'), originalPassLog);
assert.equal((await stat(externalResumeLog)).mode & 0o777, externalResumeLogMode);
await rm(passLogPath);
await writeFile(passLogPath, originalPassLog, { mode: 0o600 });

const executionRunDir = path.join(root, 'data', 'artifacts', 'audit-runs', 'self-test-execution');
const executionLogsDir = path.join(executionRunDir, 'logs');
const ownedLogsBackup = path.join(executionRunDir, 'logs-owned-backup');
const externalLogsDir = path.join(root, 'outside-resume-logs');
await mkdir(externalLogsDir, { mode: 0o755 });
const externalLogsMode = (await stat(externalLogsDir)).mode & 0o777;
await rename(executionLogsDir, ownedLogsBackup);
await symlink(externalLogsDir, executionLogsDir, 'dir');
await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    resume: true,
  }),
  /unsafe resume logs directory boundary/,
);
assert.equal((await stat(externalLogsDir)).mode & 0o777, externalLogsMode);
await rm(executionLogsDir);
await rename(ownedLogsBackup, executionLogsDir);

for (const evidenceName of ['inventory.json', 'checkpoint.json']) {
  const evidencePath = path.join(executionRunDir, evidenceName);
  const evidenceBackup = `${evidencePath}.owned-backup`;
  const evidenceContents = await readFile(evidencePath, 'utf8');
  const externalEvidence = path.join(root, `outside-${evidenceName}`);
  await writeFile(externalEvidence, evidenceContents, { mode: 0o644 });
  const externalEvidenceMode = (await stat(externalEvidence)).mode & 0o777;
  await rename(evidencePath, evidenceBackup);
  await symlink(externalEvidence, evidencePath);
  await assert.rejects(
    () => runAudit({
      root,
      outDir: 'data/artifacts/audit-runs',
      runId: 'self-test-execution',
      timeoutMs: EXECUTION_FIXTURE_TIMEOUT_MS,
      deadlineMs: 15_000,
      concurrency: 1,
      noBlock: true,
      allowDirty: true,
      resume: true,
    }),
    /is not a regular contained file/,
  );
  assert.equal(await readFile(externalEvidence, 'utf8'), evidenceContents);
  assert.equal((await stat(externalEvidence)).mode & 0o777, externalEvidenceMode);
  await rm(evidencePath);
  await rename(evidenceBackup, evidencePath);
}

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: 'self-test-execution',
    timeoutMs: 251,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    resume: true,
  }),
  /option fingerprint mismatch/
);

await assert.rejects(
  () => runAudit({
    root,
    outDir: 'data/artifacts/audit-runs',
    runId: '../unsafe',
    dryRun: true,
    noBlock: true,
  }),
  /Invalid run-id/
);

const dirtyGuardRoot = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-dirty-'));
await mkdir(path.join(dirtyGuardRoot, 'tests'), { recursive: true });
await writeFile(path.join(dirtyGuardRoot, 'tests', 'pass.test.js'), 'console.log("dirty fixture");\n');
await writeFixtureRegistry(dirtyGuardRoot, ['tests/pass.test.js']);
const gitInit = spawnSync('git', ['init'], { cwd: dirtyGuardRoot, encoding: 'utf8' });
assert.equal(gitInit.status, 0, gitInit.stderr);
await assert.rejects(
  () => runAudit({
    root: dirtyGuardRoot,
    outDir: 'data/artifacts/audit-runs',
    runId: 'dirty-default-reject',
    noBlock: true,
  }),
  /clean git worktree/
);

await writeFile(path.join(dirtyGuardRoot, '.gitignore'), 'data/\n');
for (const args of [
  ['config', 'user.email', 'runner-self-test@example.invalid'],
  ['config', 'user.name', 'IntentSmith Runner Self Test'],
  ['add', '.'],
  ['commit', '-m', 'fixture: clean runner source'],
]) {
  const result = spawnSync('git', args, { cwd: dirtyGuardRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
const cleanGuardRun = await runAudit({
  root: dirtyGuardRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'clean-source-evidence',
  noBlock: true,
});
assert.equal(cleanGuardRun.verdict, 'PASS');
assert.equal(cleanGuardRun.results[0].sourceTree.checked, true);
assert.equal(cleanGuardRun.results[0].sourceTree.clean, true);
assert.equal(cleanGuardRun.results[0].cleanup.checked, true);
assert.equal(cleanGuardRun.results[0].cleanup.terminated, true);

const failFastRoot = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-failfast-'));
await mkdir(path.join(failFastRoot, 'tests'), { recursive: true });
await writeFile(path.join(failFastRoot, 'tests', 'a-fail.test.js'), 'process.exit(9);\n');
const failFastLatePidPath = path.join(failFastRoot, 'late-pass.pid');
await writeFile(path.join(failFastRoot, 'tests', 'z-pass.test.js'), `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(failFastLatePidPath)}, String(process.pid));
console.log("late pass");
`);
await writeFixtureRegistry(failFastRoot, ['tests/a-fail.test.js', 'tests/z-pass.test.js']);
const failFastRun = await runAudit({
  root: failFastRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'failfast-resume',
  timeoutMs: 250,
  deadlineMs: 10_000,
  concurrency: 1,
  failFast: true,
  noBlock: true,
  allowDirty: true,
});
assert.equal(failFastRun.statusCounts.FAIL, 1);
assert.equal(failFastRun.statusCounts.SKIPPED, 1);
const staleLateLog = path.join(
  failFastRoot,
  failFastRun.paths.runDir,
  'logs',
  `${testSafeLogName('tests/z-pass.test.js')}.log`,
);
await writeFile(staleLateLog, 'stale partial log\n', { mode: 0o600 });
const failFastResumed = await runAudit({
  root: failFastRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'failfast-resume',
  timeoutMs: 250,
  deadlineMs: 10_000,
  concurrency: 1,
  failFast: true,
  noBlock: true,
  allowDirty: true,
  resume: true,
});
assert.equal(failFastResumed.statusCounts.FAIL, 1);
assert.equal(failFastResumed.statusCounts.PASS, 1);
assert.equal(failFastResumed.statusCounts.SKIPPED, 0);
const resumedLateResult = failFastResumed.results.find(
  result => result.path === 'tests/z-pass.test.js',
);
assert.equal(resumedLateResult.retryCount, 1);
assert.notEqual(path.join(failFastRoot, resumedLateResult.logPath), staleLateLog);
assert.equal(await readFile(staleLateLog, 'utf8'), 'stale partial log\n');
assert.ok(Number(await readFile(failFastLatePidPath, 'utf8')) > 0);

const deadlineResumeRoot = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-deadline-resume-'));
await mkdir(path.join(deadlineResumeRoot, 'tests'), { recursive: true });
await writeFile(path.join(deadlineResumeRoot, 'tests', 'a-timeout.test.js'), `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFile(path.join(deadlineResumeRoot, 'tests', 'z-pass.test.js'), 'console.log("late pass");\n');
await writeFixtureRegistry(deadlineResumeRoot, [
  'tests/a-timeout.test.js',
  'tests/z-pass.test.js',
]);
const deadlineResumeRun = await runAudit({
  root: deadlineResumeRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'deadline-resume',
  timeoutMs: 5_000,
  deadlineMs: 500,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
});
assert.equal(deadlineResumeRun.statusCounts.TIMEOUT, 1);
assert.equal(deadlineResumeRun.statusCounts.SKIPPED, 1);
const deadlineResumed = await runAudit({
  root: deadlineResumeRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'deadline-resume',
  timeoutMs: 5_000,
  deadlineMs: 500,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  resume: true,
});
assert.equal(deadlineResumed.statusCounts.TIMEOUT, 1);
assert.equal(deadlineResumed.statusCounts.PASS, 1);
assert.equal(deadlineResumed.statusCounts.SKIPPED, 0);

const deadlineRoot = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-deadline-'));
await mkdir(path.join(deadlineRoot, 'tests'), { recursive: true });
await writeFile(path.join(deadlineRoot, 'tests', 'deadline.test.js'), `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFixtureRegistry(deadlineRoot, ['tests/deadline.test.js']);
const deadlineRun = await runAudit({
  root: deadlineRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'deadline-bound',
  timeoutMs: 5_000,
  deadlineMs: 300,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
});
const deadlineResult = deadlineRun.results[0];
assert.equal(deadlineResult.status, 'TIMEOUT');
const deadlineLog = await readFile(path.join(deadlineRoot, deadlineResult.logPath), 'utf8');
const deadlineTimeoutMatch = deadlineLog.match(/suite_timeout_ms=(\d+)/);
assert.ok(deadlineTimeoutMatch, 'deadline log must record the effective suite timeout');
const deadlineSuiteTimeoutMs = Number(deadlineTimeoutMatch[1]);
assert.ok(
  deadlineSuiteTimeoutMs > 0 && deadlineSuiteTimeoutMs <= 300,
  `expected an effective timeout in (0, 300], got ${deadlineSuiteTimeoutMs}`,
);

const childPid = Number(await readFile(path.join(root, 'child.pid'), 'utf8'));
assert.ok(Number.isInteger(childPid) && childPid > 0);
await waitForProcessExit(childPid);

const blockedRoot = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-blocked-'));
await mkdir(path.join(blockedRoot, 'tests'), { recursive: true });
await writeFile(path.join(blockedRoot, 'tests', 'model.test.js'), 'console.log("must not run");\n');
await writeFixtureRegistry(blockedRoot, ['tests/model.test.js'], {
  profile: 'model',
  tier: 'T3',
  requirements: {
    network: 'loopback',
    database: true,
    server: true,
    ollama: true,
    gpu: true,
  },
});
const blockedRun = await runAudit({
  root: blockedRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'blocked-required',
  timeoutMs: 250,
  deadlineMs: 10_000,
  concurrency: 1,
  allowDirty: true,
  allowBlockers: new Set(['server', 'ollama', 'gpu']),
});
assert.equal(blockedRun.statusCounts.BLOCKED, 1);
assert.equal(blockedRun.requiredFailureCount, 1);
assert.equal(blockedRun.requiredBlockedCount, 1);
assert.equal(blockedRun.verdict, 'BLOCKED');
assert.equal(blockedRun.exitCode, 2);
assert.deepEqual(blockedRun.results[0].blockedBy, ['server']);

const toolchainRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-audit-runner-toolchain-'),
);
await mkdir(path.join(toolchainRoot, 'tests'), { recursive: true });
await writeFile(path.join(toolchainRoot, 'tests', 'toolchain.test.js'), `
import { writeFileSync } from 'node:fs';
import path from 'node:path';
writeFileSync(
  path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'toolchain-env.json'),
  JSON.stringify({
    scopedDisplay: process.env.INTENTSMITH_STUDIO_DISPLAY,
    scopedXauthorityPresent: Boolean(process.env.INTENTSMITH_STUDIO_XAUTHORITY),
    rawDisplay: process.env.DISPLAY,
    rawXauthority: process.env.XAUTHORITY,
  }),
);
`);
const toolchainNames = [
  'linux-user-network-namespace',
  'iproute2',
  'x11-display',
];
await writeFixtureRegistry(toolchainRoot, ['tests/toolchain.test.js'], {
  requirements: {
    network: 'none',
    database: false,
    server: false,
    ollama: false,
    gpu: false,
    toolchain: toolchainNames,
  },
});
const runToolchainFixture = (runId, options = {}) => runAudit({
  root: toolchainRoot,
  outDir: 'data/artifacts/audit-runs',
  runId,
  timeoutMs: 5_000,
  deadlineMs: 10_000,
  concurrency: 1,
  allowDirty: true,
  ...options,
});
const expectedToolchainBlockers = toolchainNames
  .map(name => `toolchain:${name}`)
  .sort();

const toolchainDefault = await runToolchainFixture('toolchain-default');
assert.deepEqual(toolchainDefault.results[0].blockedBy, expectedToolchainBlockers);
assert.equal(toolchainDefault.verdict, 'BLOCKED');

const toolchainNoBlock = await runToolchainFixture('toolchain-no-block', {
  noBlock: true,
});
assert.deepEqual(toolchainNoBlock.results[0].blockedBy, expectedToolchainBlockers);

const toolchainPartial = await runToolchainFixture('toolchain-partial', {
  allowBlockers: new Set([
    'toolchain:linux-user-network-namespace',
    'toolchain:iproute2',
  ]),
});
assert.deepEqual(toolchainPartial.results[0].blockedBy, ['toolchain:x11-display']);

const toolchainGeneric = await runToolchainFixture('toolchain-generic', {
  noBlock: true,
  allowBlockers: new Set(['toolchain']),
});
assert.deepEqual(toolchainGeneric.results[0].blockedBy, expectedToolchainBlockers);

const allToolchainAllows = new Set(expectedToolchainBlockers);
const xauthorityPath = path.join(toolchainRoot, 'xauthority');
await writeFile(xauthorityPath, 'owned-xauthority', { mode: 0o600 });
delete process.env.INTENTSMITH_STUDIO_DISPLAY;
delete process.env.DISPLAY;
delete process.env.INTENTSMITH_STUDIO_XAUTHORITY;
delete process.env.XAUTHORITY;
const missingDisplay = await runToolchainFixture('toolchain-missing-display', {
  allowBlockers: allToolchainAllows,
});
assert.deepEqual(
  missingDisplay.results[0].blockedBy,
  ['toolchain:x11-display:missing-display'],
);

process.env.INTENTSMITH_STUDIO_DISPLAY = ':77';
const missingXauthority = await runToolchainFixture('toolchain-missing-xauthority', {
  allowBlockers: allToolchainAllows,
});
assert.deepEqual(
  missingXauthority.results[0].blockedBy,
  ['toolchain:x11-display:missing-xauthority'],
);

process.env.INTENTSMITH_STUDIO_DISPLAY = ':77';
process.env.INTENTSMITH_STUDIO_XAUTHORITY = xauthorityPath;
const toolchainAllowed = await runToolchainFixture('toolchain-allowed', {
  allowBlockers: allToolchainAllows,
});
assert.equal(toolchainAllowed.results[0].status, 'PASS');
assert.deepEqual(
  toolchainAllowed.results[0].environment.forwardedToolchainKeys,
  ['INTENTSMITH_STUDIO_DISPLAY', 'INTENTSMITH_STUDIO_XAUTHORITY'],
);
const toolchainChildEnvironment = JSON.parse(await readFile(
  path.join(
    toolchainAllowed.results[0].environment.artifacts,
    'toolchain-env.json',
  ),
  'utf8',
));
assert.deepEqual(toolchainChildEnvironment, {
  scopedDisplay: ':77',
  scopedXauthorityPresent: true,
});

process.env.INTENTSMITH_STUDIO_DISPLAY = 'remote.example:77';
const invalidDisplay = await runToolchainFixture('toolchain-invalid-display', {
  allowBlockers: allToolchainAllows,
});
assert.deepEqual(
  invalidDisplay.results[0].blockedBy,
  ['toolchain:x11-display:invalid-display'],
);

process.env.INTENTSMITH_STUDIO_DISPLAY = ':77';
const xauthoritySymlink = path.join(toolchainRoot, 'xauthority-link');
await symlink(xauthorityPath, xauthoritySymlink);
process.env.INTENTSMITH_STUDIO_XAUTHORITY = xauthoritySymlink;
const symlinkedXauthority = await runToolchainFixture('toolchain-symlink-xauthority', {
  allowBlockers: allToolchainAllows,
});
assert.deepEqual(
  symlinkedXauthority.results[0].blockedBy,
  ['toolchain:x11-display:invalid-xauthority'],
);

const permissiveXauthority = path.join(toolchainRoot, 'xauthority-permissive');
await writeFile(permissiveXauthority, 'permissive-xauthority', { mode: 0o644 });
process.env.INTENTSMITH_STUDIO_XAUTHORITY = permissiveXauthority;
const permissiveXauthorityRun = await runToolchainFixture(
  'toolchain-permissive-xauthority',
  { allowBlockers: allToolchainAllows },
);
assert.deepEqual(
  permissiveXauthorityRun.results[0].blockedBy,
  ['toolchain:x11-display:invalid-xauthority'],
);

const logOpenFailureRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-audit-runner-log-open-failure-'),
);
const logOpenFailurePidPath = path.join(logOpenFailureRoot, 'must-not-start.pid');
const occupiedLogPath = path.join(logOpenFailureRoot, 'occupied.log');
await mkdir(path.join(logOpenFailureRoot, 'tests'), { recursive: true });
await writeFile(path.join(logOpenFailureRoot, 'tests', 'must-not-start.test.js'), `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(logOpenFailurePidPath)}, String(process.pid));
setInterval(() => {}, 1000);
`);
await writeFile(occupiedLogPath, 'occupied\n', { mode: 0o600 });
await writeFixtureRegistry(logOpenFailureRoot, ['tests/must-not-start.test.js']);
await assert.rejects(
  () => runAudit({
    root: logOpenFailureRoot,
    outDir: 'data/artifacts/audit-runs',
    runId: 'log-open-failure',
    timeoutMs: 10_000,
    deadlineMs: 15_000,
    concurrency: 1,
    noBlock: true,
    allowDirty: true,
    logStreamFactory: (_requestedPath, options) => createWriteStream(
      occupiedLogPath,
      { ...options, flags: 'wx' },
    ),
  }),
  /Suite log could not open.*EEXIST/,
);
await assert.rejects(() => stat(logOpenFailurePidPath), /ENOENT/);

const logFailureRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-audit-runner-log-failure-'),
);
const logFailurePidPath = path.join(logFailureRoot, 'active-suite.pid');
await mkdir(path.join(logFailureRoot, 'tests'), { recursive: true });
await writeFile(path.join(logFailureRoot, 'tests', 'log-failure.test.js'), `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(logFailurePidPath)}, String(process.pid));
console.log('INJECT_LOG_EIO');
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFixtureRegistry(logFailureRoot, ['tests/log-failure.test.js']);
let injectedRunnerLogWrites = 0;
const logFailureRun = await runAudit({
  root: logFailureRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'log-write-failure',
  timeoutMs: 10_000,
  deadlineMs: 15_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  logStreamFactory: () => new Writable({
    write(_chunk, _encoding, callback) {
      injectedRunnerLogWrites += 1;
      if (injectedRunnerLogWrites >= 5) {
        const error = new Error('injected runner log failure');
        error.code = 'EIO';
        callback(error);
      } else {
        callback();
      }
    },
  }),
});
assert.equal(logFailureRun.verdict, 'FAIL');
assert.equal(logFailureRun.exitCode, 1);
assert.equal(logFailureRun.results[0].status, 'FAIL');
assert.equal(logFailureRun.results[0].logError?.code, 'EIO');
assert.equal(logFailureRun.results[0].logSha256, null);
const logFailureSuitePid = Number(await readFile(logFailurePidPath, 'utf8'));
await waitForProcessExit(logFailureSuitePid);

const logReadFailureRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-audit-runner-log-read-failure-'),
);
await mkdir(path.join(logReadFailureRoot, 'tests'), { recursive: true });
await writeFile(
  path.join(logReadFailureRoot, 'tests', 'pass.test.js'),
  'console.log("pass without a filesystem-backed log");\n',
);
await writeFixtureRegistry(logReadFailureRoot, ['tests/pass.test.js']);
const logReadFailureRun = await runAudit({
  root: logReadFailureRoot,
  outDir: 'data/artifacts/audit-runs',
  runId: 'log-read-failure',
  timeoutMs: 5_000,
  deadlineMs: 10_000,
  concurrency: 1,
  noBlock: true,
  allowDirty: true,
  logStreamFactory: () => new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }),
});
assert.equal(logReadFailureRun.verdict, 'FAIL');
assert.equal(logReadFailureRun.exitCode, 1);
assert.equal(logReadFailureRun.results[0].status, 'FAIL');
assert.equal(logReadFailureRun.results[0].logReadError?.code, 'ENOENT');
assert.equal(logReadFailureRun.results[0].logSha256, null);

const interruptedDryRoot = await makeTempDirectory(
  path.join(os.tmpdir(), 'c3-audit-runner-interrupted-dry-'),
);
await mkdir(path.join(interruptedDryRoot, 'tests'), { recursive: true });
await writeFile(
  path.join(interruptedDryRoot, 'tests', 'pass.test.js'),
  'console.log("dry-run fixture");\n',
);
await writeFixtureRegistry(interruptedDryRoot, ['tests/pass.test.js']);
const selfSignalTimer = setTimeout(() => process.kill(process.pid, 'SIGTERM'), 0);
let interruptedDryRun;
try {
  interruptedDryRun = await runAuditWithTerminationHandling({
    root: interruptedDryRoot,
    outDir: 'data/artifacts/audit-runs',
    runId: 'interrupted-dry-run',
    dryRun: true,
  });
} finally {
  clearTimeout(selfSignalTimer);
}
assert.equal(interruptedDryRun.interruptionSignal, 'SIGTERM');
assert.equal(interruptedDryRun.runnerFailure?.kind, 'interrupted');
assert.equal(interruptedDryRun.verdict, 'FAIL');
assert.equal(interruptedDryRun.exitCode, 1);
const interruptedDryReport = JSON.parse(await readFile(
  path.join(
    interruptedDryRoot,
    'data',
    'artifacts',
    'audit-runs',
    'interrupted-dry-run',
    'report.json',
  ),
  'utf8',
));
assert.equal(interruptedDryReport.interruptionSignal, 'SIGTERM');
assert.equal(interruptedDryReport.verdict, 'FAIL');
assert.equal(interruptedDryReport.exitCode, 1);

const signalRoot = await makeTempDirectory(path.join(os.tmpdir(), 'c3-audit-runner-signal-'));
const signalReadyPath = path.join(signalRoot, 'suite-ready.pid');
await mkdir(path.join(signalRoot, 'tests'), { recursive: true });
await writeFile(path.join(signalRoot, 'tests', 'a-ignore-signal.test.js'), `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(signalReadyPath)}, String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`);
await writeFile(
  path.join(signalRoot, 'tests', 'z-must-skip.test.js'),
  'console.error("interrupted runner scheduled a late suite"); process.exit(9);\n',
);
await writeFixtureRegistry(signalRoot, [
  'tests/a-ignore-signal.test.js',
  'tests/z-must-skip.test.js',
]);
for (const signal of ['SIGTERM', 'SIGINT']) {
  await rm(signalReadyPath, { force: true });
  const runId = `interrupted-${signal.toLowerCase()}`;
  const interrupted = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('../scripts/nightly-audit.js', import.meta.url)),
      '--root', signalRoot,
      '--out-dir', 'data/artifacts/audit-runs',
      '--run-id', runId,
      '--timeout-ms', '30000',
      '--deadline-ms', '30000',
      '--concurrency', '1',
      '--no-block',
      '--allow-dirty',
    ],
    { cwd: signalRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const observedClose = observeChildClose(interrupted);
  const signalFixture = {
    child: interrupted,
    observedClose,
    suitePid: null,
  };
  activeSignalFixtures.add(signalFixture);
  let interruptedStdout = '';
  let interruptedStderr = '';
  interrupted.stdout.on('data', chunk => { interruptedStdout += chunk; });
  interrupted.stderr.on('data', chunk => { interruptedStderr += chunk; });
  try {
    await waitForFile(signalReadyPath, 5_000);
    signalFixture.suitePid = Number(await readFile(signalReadyPath, 'utf8'));
    assert.equal(interrupted.kill(signal), true);
    const interruptedExit = await waitForObservedClose(observedClose, interrupted, 8_000);
    assert.equal(
      interruptedExit.code,
      1,
      `runner ${signal} exit mismatch\nstdout:\n${interruptedStdout}\nstderr:\n${interruptedStderr}`,
    );
    assert.equal(interruptedExit.signal, null);
    await waitForProcessExit(signalFixture.suitePid);
    const interruptedReport = JSON.parse(await readFile(
      path.join(signalRoot, 'data', 'artifacts', 'audit-runs', runId, 'report.json'),
      'utf8',
    ));
    assert.equal(interruptedReport.interruptionSignal, signal);
    assert.equal(interruptedReport.statusCounts.FAIL, 1);
    assert.equal(interruptedReport.statusCounts.SKIPPED, 1);
    assert.equal(interruptedReport.results[1].skipReason, `interrupted-${signal}`);
  } finally {
    await cleanupRunnerSignalFixture(signalFixture);
    activeSignalFixtures.delete(signalFixture);
  }
}
}

console.log(
  modelFixtureOnly
    ? 'nightly audit model fixture self-test: PASS'
    : 'nightly audit runner self-test: PASS',
);
} finally {
  delete process.env.TEST_SECRET_SENTINEL;
  delete process.env.INTENTSMITH_PDF_PYTHON;
  delete process.env.C3_PDF_PYTHON;
  restoreEnvironmentValue('INTENTSMITH_STUDIO_DISPLAY', originalStudioDisplay);
  restoreEnvironmentValue('INTENTSMITH_STUDIO_XAUTHORITY', originalStudioXauthority);
  restoreEnvironmentValue('DISPLAY', originalDisplay);
  restoreEnvironmentValue('XAUTHORITY', originalXauthority);
  if (permissiveUmaskActive) process.umask(originalUmask);
  for (const fixture of activeSignalFixtures) {
    await cleanupRunnerSignalFixture(fixture).catch(() => {});
  }
  for (const tempRoot of [...tempRoots].reverse()) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnvironmentValue(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`spawned child process still exists: ${pid}`);
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${filePath}`);
}

function observeChildClose(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForObservedClose(observedClose, child, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      observedClose,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`timed out waiting for child ${child.pid}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cleanupRunnerSignalFixture({ child, observedClose, suitePid }) {
  signalOwnedGroupForTest(suitePid, 'SIGTERM');
  if (processAlive(child.pid)) child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 250));
  signalOwnedGroupForTest(suitePid, 'SIGKILL');
  if (processAlive(child.pid)) child.kill('SIGKILL');
  await Promise.race([
    observedClose.catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 1_000)),
  ]);
}

function signalOwnedGroupForTest(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function makeTempDirectory(prefix) {
  const directory = await mkdtemp(prefix);
  tempRoots.add(directory);
  return directory;
}

function testSafeLogName(relativePath) {
  const hash = createHash('sha1').update(relativePath).digest('hex').slice(0, 8);
  return `${relativePath.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.${hash}`;
}

async function writeFixtureRegistry(rootDir, paths, overrides = {}) {
  const requirements = overrides.requirements || {
    network: 'none',
    database: false,
    server: false,
    ollama: false,
    gpu: false,
  };
  const suites = paths.map((testPath, index) => ({
    id: `IS-${overrides.tier || 'T1'}-SELF-${String(index + 1).padStart(3, '0')}`,
    path: testPath,
    argv: [testPath.endsWith('.py') ? 'python3' : 'node', testPath],
    capabilityId: 'C3-027',
    tier: overrides.tier || 'T1',
    fixture: 'self-test',
    profile: overrides.profile || 'offline',
    expectedDurationMs: 1_000,
    timeoutMs: 5_000,
    requirements,
    required: true,
    owner: 'self-test',
    state: 'ACTIVE',
    lastGreen: { commit: null, artifact: null },
    flakeCount: 0,
    quarantineExpiry: null,
  }));
  await writeFile(
    path.join(rootDir, 'tests', 'registry.json'),
    `${JSON.stringify({ schemaVersion: 3, exclusions: [], suites }, null, 2)}\n`,
  );
}
