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

const tempRoots = new Set();
const activeSignalFixtures = new Set();
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalUmask = process.umask();
const EXECUTION_FIXTURE_TIMEOUT_MS = 1_000;
let permissiveUmaskActive = false;

try {
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
import { writeFileSync } from 'node:fs';
import path from 'node:path';
writeFileSync(path.join(process.env.TMPDIR, 'observed-env.json'), JSON.stringify({
  HOME: process.env.HOME,
  C3_DB_PATH: process.env.C3_DB_PATH,
  INTENTSMITH_PDF_PYTHON: process.env.INTENTSMITH_PDF_PYTHON,
  C3_PDF_PYTHON: process.env.C3_PDF_PYTHON,
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
assert.equal(observedEnv.C3_DB_PATH, byPath.get('tests/pass.test.js').environment.database);
assert.equal(observedEnv.INTENTSMITH_PDF_PYTHON, expectedPdfPython);
assert.equal(observedEnv.C3_PDF_PYTHON, expectedPdfPython);
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

console.log('nightly audit runner self-test: PASS');
} finally {
  delete process.env.TEST_SECRET_SENTINEL;
  delete process.env.INTENTSMITH_PDF_PYTHON;
  delete process.env.C3_PDF_PYTHON;
  if (permissiveUmaskActive) process.umask(originalUmask);
  for (const fixture of activeSignalFixtures) {
    await cleanupRunnerSignalFixture(fixture).catch(() => {});
  }
  for (const tempRoot of [...tempRoots].reverse()) {
    await rm(tempRoot, { recursive: true, force: true });
  }
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
    `${JSON.stringify({ schemaVersion: 2, exclusions: [], suites }, null, 2)}\n`,
  );
}
