#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  parseArgs,
  runLogged,
  runNightly,
} from '../scripts/nightly-orchestrator.js';

const BRANCH = 'codex/intentsmith-1.0';
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_KEY = 'INTENTSMITH_ORCHESTRATOR_SELFTEST_SECRET';
const SECRET_VALUE = 'must-not-appear-in-evidence';
const tmp = await mkdtemp(path.join(os.tmpdir(), 'intentsmith-nightly-orchestrator-'));
const originalSecret = process.env[SECRET_KEY];
const originalUmask = process.umask();
let permissiveUmaskActive = false;

try {
  process.env[SECRET_KEY] = SECRET_VALUE;
  const remote = path.join(tmp, 'origin.git');
  const repo = path.join(tmp, 'repo');
  const artifactRoot = path.join(repo, '.intentsmith-artifacts', 'nightly');
  const worktreeRoot = path.join(artifactRoot, 'worktrees');

  git(['init', '--bare', remote], tmp);
  await mkdir(repo, { recursive: true });
  git(['init', '-b', BRANCH], repo);
  git(['config', 'user.email', 'selftest@example.invalid'], repo);
  git(['config', 'user.name', 'IntentSmith Self Test'], repo);
  git(['remote', 'add', 'origin', remote], repo);

  await writeFixtureRepo(repo);
  git(['add', '.'], repo);
  git(['commit', '-m', 'fixture: valid failing audit'], repo);
  git(['push', '-u', 'origin', BRANCH], repo);

  const dryRun = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-dry',
    dryRun: true,
    testMode: true,
  });
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.sourceRevision, gitOutput(['rev-parse', `origin/${BRANCH}`], repo));
  assert.equal(dryRun.blockerPolicy.noBlock, false);
  assert.equal(dryRun.blockerPolicy.allowDirty, false);
  assert.deepEqual(dryRun.blockerPolicy.allowBlockers, ['toolchain:python-pdf-runtime']);
  assert.deepEqual(argumentValue(dryRun.commands.audit, '--profile').split(','), ['offline', 'database']);
  assert.equal(argumentValue(dryRun.commands.audit, '--timeout-ms'), String(8 * 60 * 60 * 1000));
  assert.deepEqual(dryRun.commands.install, ['npm', 'ci']);
  assert.deepEqual(
    dryRun.commands.preflight[0],
    ['node', 'scripts/validate-test-registry.js'],
  );
  assert.deepEqual(
    dryRun.commands.pdfRuntime,
    [
      './scripts/install-pdf-runtime.sh',
      '--venv',
      dryRun.paths.pdfVenv,
    ],
  );
  assert.equal(dryRun.environment.isolated.pdfPython, dryRun.paths.pdfPython);
  assert.equal(dryRun.environment.isolated.pythonNoUserSite, true);
  assertNoUnsafeAuditFlags(dryRun.commands.audit);
  const serializedDryRun = JSON.stringify(dryRun);
  assert.equal(serializedDryRun.includes(SECRET_KEY), false);
  assert.equal(serializedDryRun.includes(SECRET_VALUE), false);
  assert.equal(dryRun.environment.secretValuesRecorded, false);
  await assertMissing(dryRun.paths.worktree);
  await assertMissing(dryRun.paths.worktreeOwnership);
  await assertMissing(dryRun.paths.runDir);
  await assertMissing(artifactRoot);

  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: 'wrong-branch',
      branch: 'main',
      dryRun: true,
      testMode: true,
    }),
    /source is locked/,
  );
  assert.throws(() => parseArgs(['--repo']), /Missing value/);
  assert.throws(() => parseArgs(['--repository=/tmp/nope']), /Unknown argument/);

  await mkdir(path.join(artifactRoot, 'intentsmith-nightly.lock'), { recursive: true });
  await writeJson(
    path.join(artifactRoot, 'intentsmith-nightly.lock', 'owner.json'),
    { owner: 'self-test' },
  );
  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: 'selftest-lock',
      testMode: true,
    }),
    /lock is already held/,
  );
  await rm(path.join(artifactRoot, 'intentsmith-nightly.lock'), { recursive: true, force: true });

  await seedCompletedRuns(artifactRoot, 8);
  process.umask(0o022);
  permissiveUmaskActive = true;
  const failingAudit = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-failing-audit',
    retain: 7,
    testMode: true,
  });
  assert.equal(process.umask(), 0o022, 'nightly orchestrator must restore its parent umask');
  assert.equal(failingAudit.exitCode, 1);
  assert.equal(failingAudit.runnerExitCode, 1);
  assert.equal(failingAudit.summaryExitCode, 0);
  assert.equal(failingAudit.auditContract.status, 'PASS');
  assert.equal(failingAudit.auditContract.expectedSuiteCount, 332);
  assert.deepEqual(failingAudit.auditContract.profileCounts, { offline: 268, database: 64 });
  assert.equal(failingAudit.auditContract.reportVerdict, 'FAIL');
  assert.equal(failingAudit.summaryContract.status, 'PASS');

  const runDir = path.join(artifactRoot, 'runs', 'selftest-failing-audit');
  const metadata = await readJson(path.join(runDir, 'metadata.json'));
  assert.equal(metadata.orchestrator, 'intentsmith-gate0-orchestrator');
  assert.equal(metadata.sourceBranch, BRANCH);
  assert.equal(metadata.candidateMode, false);
  assert.equal(metadata.blockerPolicy.noBlock, false);
  assert.equal(metadata.blockerPolicy.allowDirty, false);
  assert.deepEqual(metadata.blockerPolicy.allowBlockers, ['toolchain:python-pdf-runtime']);
  assert.equal(metadata.dependencyInstall.command, 'npm ci');
  assert.equal(metadata.dependencyInstall.lockfileOnly, true);
  assert.equal(metadata.dependencyInstall.node.status, 'PASS');
  assert.match(metadata.dependencyInstall.node.lockSha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.dependencyInstall.node.logSha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.dependencyInstall.pdfRuntime.status, 'PASS');
  assert.equal(
    metadata.dependencyInstall.pdfRuntime.lockSha256,
    createHash('sha256')
      .update(await readFile(path.join(SOURCE_ROOT, 'requirements', 'pdf-export.lock')))
      .digest('hex'),
  );
  assert.deepEqual(metadata.dependencyInstall.pdfRuntime.packages, {
    'charset-normalizer': '3.4.4',
    pillow: '12.3.0',
    reportlab: '5.0.0',
  });
  assert.match(metadata.dependencyInstall.pdfRuntime.python, /^3\.12\.\d+$/);
  assert.equal(metadata.dependencyInstall.pdfRuntime.policy.requireHashes, true);
  assert.equal(metadata.dependencyInstall.pdfRuntime.policy.onlyBinary, true);
  assert.equal(metadata.dependencyInstall.pdfRuntime.policy.noDependencies, true);
  assert.equal(metadata.dependencyInstall.pdfRuntime.policy.isolatedPip, true);
  assert.equal(metadata.dependencyInstall.pdfRuntime.policy.freshStagingVenv, true);
  assert.match(
    metadata.dependencyInstall.pdfRuntime.interpreter,
    /\.venv\/pdf\/bin\/python$/,
  );
  assert.match(metadata.dependencyInstall.pdfRuntime.logSha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.auditContract.status, 'PASS');
  assert.equal(metadata.summaryContract.status, 'PASS');

  const receivedEnvironment = await readJson(
    path.join(runDir, 'audit', 'product-audit', 'env.json'),
  );
  assert.equal(receivedEnvironment.keys.includes(SECRET_KEY), false);
  assert.match(receivedEnvironment.HOME, /runtime\/home$/);
  assert.match(receivedEnvironment.C3_DB_PATH, /runtime\/intentsmith-nightly\.sqlite$/);
  assert.match(receivedEnvironment.C3_PROJECTS_DIR, /runtime\/projects$/);
  assert.equal(receivedEnvironment.C3_LIFECYCLE_AUTO_COMMIT, 'false');
  assert.equal(receivedEnvironment.C3_ENABLE_AUTONOMY, 'false');
  assert.match(receivedEnvironment.INTENTSMITH_PDF_PYTHON, /\.venv\/pdf\/bin\/python$/);
  assert.equal(
    receivedEnvironment.C3_PDF_PYTHON,
    receivedEnvironment.INTENTSMITH_PDF_PYTHON,
  );
  assert.equal(receivedEnvironment.PYTHONNOUSERSITE, '1');
  assert.equal(receivedEnvironment.UMASK, 0o077);
  process.umask(originalUmask);
  permissiveUmaskActive = false;
  await assertMissing(failingAudit.paths.worktree);
  await assertMissing(failingAudit.paths.worktreeOwnership);

  await assertMode(artifactRoot, 0o700);
  await assertMode(runDir, 0o700);
  await assertMode(path.join(runDir, 'metadata.json'), 0o600);
  await assertMode(path.join(runDir, 'audit-runner.log'), 0o600);
  await assertMode(path.join(runDir, 'pdf-runtime-install.log'), 0o600);
  await assertMode(path.join(runDir, 'summary.json'), 0o600);
  await assertMode(path.join(runDir, 'audit-contract.json'), 0o600);

  const retained = await listRunDirs(path.join(artifactRoot, 'runs'));
  assert.ok(retained.length <= 7, `expected retention <= 7, got ${retained.length}`);

  const duplicateMetadataPath = path.join(runDir, 'metadata.json');
  const duplicateMetadataBefore = await readFile(duplicateMetadataPath, 'utf8');
  const duplicateMetadataModeBefore = (await stat(duplicateMetadataPath)).mode & 0o777;
  const duplicateFilesBefore = (await readdir(runDir)).sort();
  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: 'selftest-failing-audit',
      testMode: true,
    }),
    /Refusing to reuse existing artifact run directory/,
  );
  assert.equal(await readFile(duplicateMetadataPath, 'utf8'), duplicateMetadataBefore);
  assert.equal((await stat(duplicateMetadataPath)).mode & 0o777, duplicateMetadataModeBefore);
  assert.deepEqual((await readdir(runDir)).sort(), duplicateFilesBefore);

  const futureRunDir = path.join(artifactRoot, 'runs', 'future-clock-skew');
  await mkdir(futureRunDir, { recursive: true });
  await writeJson(path.join(futureRunDir, 'metadata.json'), {
    orchestrator: 'intentsmith-gate0-orchestrator',
    runId: 'future-clock-skew',
    endedAt: '2999-01-01T00:00:00.000Z',
  });
  await commitFixtureMode(repo, 'all-pass');
  const passingAudit = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-passing-audit',
    retain: 1,
    testMode: true,
  });
  assert.equal(passingAudit.ok, true);
  assert.equal(passingAudit.exitCode, 0);
  assert.equal(passingAudit.runnerExitCode, 0);
  assert.equal(passingAudit.summaryExitCode, 0);
  assert.equal(passingAudit.auditContract.reportVerdict, 'PASS');
  assert.equal(passingAudit.auditContract.expectedSuiteCount, 332);
  assert.equal(passingAudit.summaryContract.status, 'PASS');
  const passingMetadata = await readJson(
    path.join(artifactRoot, 'runs', 'selftest-passing-audit', 'metadata.json'),
  );
  assert.equal(passingMetadata.status, 'completed');
  assert.equal(passingMetadata.runnerExitCode, 0);
  assert.equal(passingMetadata.summaryExitCode, 0);
  assert.deepEqual(passingMetadata.cleanupEvidence, {
    worktreeRemoved: true,
    worktreeOwnershipMarkerRemoved: true,
    lockReleasePending: true,
    currentRunRetained: true,
  });
  await assertMissing(passingAudit.paths.worktree);
  await assertMissing(passingAudit.paths.worktreeOwnership);
  await assertMissing(path.join(artifactRoot, 'intentsmith-nightly.lock'));
  await assertMissing(futureRunDir);

  const cleanupFailureRunId = 'selftest-cleanup-failure';
  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: cleanupFailureRunId,
      testMode: true,
      testFailurePoint: 'after-validation-before-cleanup',
    }),
    /Injected test failure after validation before cleanup/,
  );
  const cleanupFailureMetadata = await readJson(
    path.join(artifactRoot, 'runs', cleanupFailureRunId, 'metadata.json'),
  );
  assert.equal(cleanupFailureMetadata.status, 'failed');
  assert.notEqual(cleanupFailureMetadata.status, 'completed');
  const cleanupFailureRevision = gitOutput(['rev-parse', `origin/${BRANCH}`], repo);
  const cleanupFailureWorktree = path.join(
    worktreeRoot,
    `${cleanupFailureRunId}-${cleanupFailureRevision.slice(0, 12)}`,
  );
  await assertMissing(cleanupFailureWorktree);
  await assertMissing(`${cleanupFailureWorktree}.ownership.json`);
  await assertMissing(path.join(artifactRoot, 'intentsmith-nightly.lock'));

  await commitFixtureMode(repo, 'source-mismatch');
  await assertRejectedRun({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-source-mismatch',
    pattern: /source revision mismatch/,
  });

  await commitFixtureMode(repo, 'bad-log-path');
  await assertRejectedRun({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-bad-log-path',
    pattern: /log path escapes audit run/,
  });

  await commitFixtureMode(repo, 'corrupt-report');
  await assertRejectedRun({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-corrupt-report',
    pattern: /JSON/,
  });

  await commitFixtureMode(repo, 'missing-report');
  await assertRejectedRun({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-missing-report',
    pattern: /ENOENT/,
  });

  await commitFixtureMode(repo, 'preflight-fail');
  const preflightFailure = await runNightly({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-preflight-fail',
    testMode: true,
  });
  assert.equal(preflightFailure.exitCode, 2);
  assert.equal(preflightFailure.preflight.ok, false);
  await assertMissing(preflightFailure.paths.worktree);
  await assertMissing(
    path.join(artifactRoot, 'runs', 'selftest-preflight-fail', 'audit', 'product-audit', 'report.json'),
  );

  await commitFixtureMode(repo, 'preflight-mutate');
  await assertRejectedRun({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-preflight-mutate',
    pattern: /Disposable source worktree is dirty/,
  });

  await commitFixtureMode(repo, 'pdf-runtime-mismatch');
  await assertRejectedRun({
    repo,
    artifactRoot,
    worktreeRoot,
    runId: 'selftest-pdf-runtime-mismatch',
    pattern: /PDF runtime package versions differ from policy/,
  });

  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: '../bad',
      dryRun: true,
      testMode: true,
    }),
    /Invalid run-id/,
  );

  process.umask(0o022);
  permissiveUmaskActive = true;
  await assert.rejects(
    () => runLogged([], { cwd: repo, timeoutMs: 100 }),
  );
  assert.equal(process.umask(), 0o022, 'synchronous spawn failure must restore the parent umask');
  process.umask(originalUmask);
  permissiveUmaskActive = false;

  await assert.rejects(
    () => runLogged(
      [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      { cwd: repo, timeoutMs: 100 },
    ),
    /timed out/,
  );
  await assert.rejects(
    () => runLogged(
      [process.execPath, '-e', "process.kill(process.pid, 'SIGTERM')"],
      { cwd: repo, timeoutMs: 1000, allowFailure: true },
    ),
    /terminated by signal/,
  );

  const leakPidPath = path.join(tmp, 'leak.pid');
  const leakScript = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    'child.unref();',
    `fs.writeFileSync(${JSON.stringify(leakPidPath)}, String(child.pid));`,
  ].join(' ');
  await assert.rejects(
    () => runLogged(
      [process.execPath, '-e', leakScript],
      { cwd: repo, timeoutMs: 2000 },
    ),
    /owned process group/,
  );
  const leakedPid = Number(await readFile(leakPidPath, 'utf8'));
  await waitForProcessExit(leakedPid);

  const logFailurePidPath = path.join(tmp, 'log-failure.pid');
  let logWriteCount = 0;
  const failingLogFactory = () => new Writable({
    write(_chunk, _encoding, callback) {
      logWriteCount += 1;
      if (logWriteCount >= 2) {
        const error = new Error('injected log write failure');
        error.code = 'EIO';
        callback(error);
      } else {
        callback();
      }
    },
  });
  const logFailureScript = [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(logFailurePidPath)}, String(process.pid));`,
    "console.log('trigger log failure');",
    'setInterval(() => {}, 1000);',
  ].join(' ');
  await assert.rejects(
    () => runLogged(
      [process.execPath, '-e', logFailureScript],
      {
        cwd: repo,
        logPath: path.join(tmp, 'injected-log-failure.log'),
        logStreamFactory: failingLogFactory,
        timeoutMs: 5_000,
      },
    ),
    /Command log failed.*EIO injected log write failure/,
  );
  const logFailurePid = Number(await readFile(logFailurePidPath, 'utf8'));
  await waitForProcessExit(logFailurePid);

  await commitFixtureMode(repo, 'interrupt');
  const orchestratorWrapper = path.join(tmp, 'run-orchestrator-with-signals.mjs');
  await writeFile(orchestratorWrapper, `
import { runNightlyWithTerminationHandling } from ${
  JSON.stringify(pathToFileURL(path.join(SOURCE_ROOT, 'scripts', 'nightly-orchestrator.js')).href)
};
try {
  const result = await runNightlyWithTerminationHandling(JSON.parse(process.argv[2]));
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.exitCode || 0;
} catch (error) {
  process.stderr.write(String(error.stack || error.message));
  process.exitCode = 2;
}
  `);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const runId = `selftest-${signal.toLowerCase()}`;
    const options = { repo, artifactRoot, worktreeRoot, runId, testMode: true };
    let interruptPids = {};
    const interrupted = spawn(
      process.execPath,
      [orchestratorWrapper, JSON.stringify(options)],
      { cwd: SOURCE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const observedClose = observeChildClose(interrupted);
    let interruptedStdout = '';
    let interruptedStderr = '';
    interrupted.stdout.on('data', chunk => { interruptedStdout += chunk; });
    interrupted.stderr.on('data', chunk => { interruptedStderr += chunk; });
    try {
      const interruptReady = path.join(
        artifactRoot,
        'runs',
        runId,
        'audit',
        'product-audit',
        'interrupt-ready.json',
      );
      interruptPids = await waitForJson(interruptReady, 20_000);
      assert.equal(interrupted.kill(signal), true);
      const interruptedExit = await waitForObservedClose(
        observedClose,
        interrupted,
        15_000,
      );
      assert.equal(
        interruptedExit.code,
        2,
        `orchestrator ${signal} exit mismatch\nstdout:\n${interruptedStdout}\nstderr:\n${interruptedStderr}`,
      );
      assert.equal(interruptedExit.signal, null);
      await waitForProcessExit(interruptPids.runnerPid);
      await waitForProcessExit(interruptPids.suitePid);
      const interruptedMetadata = await readJson(
        path.join(artifactRoot, 'runs', runId, 'metadata.json'),
      );
      assert.equal(interruptedMetadata.status, 'failed');
      assert.match(interruptedMetadata.error, new RegExp(`interrupted by ${signal}`));
      const interruptedRevision = gitOutput(['rev-parse', `origin/${BRANCH}`], repo);
      const interruptedWorktree = path.join(
        worktreeRoot,
        `${runId}-${interruptedRevision.slice(0, 12)}`,
      );
      await assertMissing(interruptedWorktree);
      await assertMissing(`${interruptedWorktree}.ownership.json`);
      await assertMissing(path.join(artifactRoot, 'intentsmith-nightly.lock'));
    } finally {
      await cleanupSignalFixture({ child: interrupted, observedClose, ...interruptPids });
    }
  }

  const tailReady = path.join(tmp, 'termination-tail-ready');
  const tailProvenance = path.join(tmp, 'termination-tail-provenance.json');
  const tailWrapper = path.join(tmp, 'run-protected-tail-with-signal.mjs');
  await writeFile(tailWrapper, `
import { unlink, writeFile } from 'node:fs/promises';
import { runWithOwnedProcessTerminationHandling } from ${
  JSON.stringify(pathToFileURL(path.join(SOURCE_ROOT, 'scripts', 'nightly-orchestrator.js')).href)
};
const ready = process.argv[2];
const provenance = process.argv[3];
let provenanceWritten = false;
try {
  await runWithOwnedProcessTerminationHandling(async () => {
    await writeFile(ready, 'ready');
    await new Promise(resolve => setTimeout(resolve, 250));
    await writeFile(provenance, 'must not remain usable');
    provenanceWritten = true;
  });
  process.exitCode = 0;
} catch (error) {
  if (provenanceWritten) await unlink(provenance).catch(() => {});
  process.stderr.write(String(error.message));
  process.exitCode = 2;
}
  `);
  const tailOwner = spawn(
    process.execPath,
    [tailWrapper, tailReady, tailProvenance],
    { cwd: SOURCE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const tailClose = observeChildClose(tailOwner);
  await waitForFile(tailReady, 5_000);
  assert.equal(tailOwner.kill('SIGTERM'), true);
  const tailExit = await waitForObservedClose(tailClose, tailOwner, 5_000);
  assert.equal(tailExit.code, 2);
  assert.equal(tailExit.signal, null);
  await assertMissing(tailProvenance);

  git(['config', 'core.sshCommand', 'sh -c "exit 99" ignored'], repo);
  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: 'selftest-transport-override',
      testMode: true,
    }),
    /forbids repository-local transport overrides/,
  );
  git(['config', '--unset', 'core.sshCommand'], repo);

  const systemdConfigHome = path.join(tmp, 'systemd-config-home');
  const installerPath = path.join(SOURCE_ROOT, 'scripts', 'install-nightly-audit-systemd.js');
  const installerEnv = { ...process.env, XDG_CONFIG_HOME: systemdConfigHome };
  const installerDryRun = spawnSync(
    process.execPath,
    [installerPath, '--dry-run'],
    { cwd: SOURCE_ROOT, encoding: 'utf8', env: installerEnv },
  );
  assert.equal(installerDryRun.error, undefined);
  assert.equal(installerDryRun.status, 0, installerDryRun.stderr);
  assert.equal(JSON.parse(installerDryRun.stdout).status, 'DISABLED_GATE0');
  await assertMissing(systemdConfigHome);
  const installerEnable = spawnSync(
    process.execPath,
    [installerPath, '--enable'],
    { cwd: SOURCE_ROOT, encoding: 'utf8', env: installerEnv },
  );
  assert.equal(installerEnable.error, undefined);
  assert.notEqual(installerEnable.status, 0);
  assert.match(installerEnable.stderr, /Systemd installation is disabled during Gate 0/);
  await assertMissing(systemdConfigHome);

  const outsideRuns = path.join(tmp, 'outside-runs');
  await mkdir(outsideRuns, { mode: 0o755 });
  const outsideModeBefore = (await stat(outsideRuns)).mode & 0o777;
  await rm(path.join(artifactRoot, 'runs'), { recursive: true, force: true });
  await symlink(outsideRuns, path.join(artifactRoot, 'runs'), 'dir');
  await assert.rejects(
    () => runNightly({
      repo,
      artifactRoot,
      worktreeRoot,
      runId: 'selftest-runs-symlink',
      dryRun: true,
      testMode: true,
    }),
    /Unsafe artifact boundary component/,
  );
  assert.deepEqual(await listRunDirs(outsideRuns), []);
  assert.equal((await stat(outsideRuns)).mode & 0o777, outsideModeBefore);

  console.log('nightly orchestrator self-test passed');
} finally {
  if (originalSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = originalSecret;
  if (permissiveUmaskActive) process.umask(originalUmask);
  await rm(tmp, { recursive: true, force: true });
}

async function writeFixtureRepo(repo) {
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await mkdir(path.join(repo, 'tests'), { recursive: true });
  await mkdir(path.join(repo, 'requirements'), { recursive: true });

  await writeFile(path.join(repo, 'package.json'), `${JSON.stringify({
    name: 'intentsmith-nightly-orchestrator-fixture',
    version: '1.0.0',
    type: 'module',
  }, null, 2)}\n`);
  await writeFile(path.join(repo, '.gitignore'), '/.intentsmith-artifacts/\n/.venv/\n');
  await writeFile(path.join(repo, 'package-lock.json'), `${JSON.stringify({
    name: 'intentsmith-nightly-orchestrator-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'intentsmith-nightly-orchestrator-fixture',
        version: '1.0.0',
      },
    },
  }, null, 2)}\n`);
  await writeJson(path.join(repo, 'fixture-mode.json'), { mode: 'valid' });
  await writeFile(
    path.join(repo, 'requirements', 'pdf-export.lock'),
    await readFile(path.join(SOURCE_ROOT, 'requirements', 'pdf-export.lock')),
  );
  const fakePdfInstaller = path.join(repo, 'scripts', 'install-pdf-runtime.sh');
  await writeFile(fakePdfInstaller, fakePdfInstallerSource(), { mode: 0o755 });
  await chmod(fakePdfInstaller, 0o755);

  const registry = JSON.parse(
    await readFile(path.join(SOURCE_ROOT, 'tests', 'registry.json'), 'utf8'),
  );
  await writeJson(path.join(repo, 'tests', 'registry.json'), registry);
  await writeFile(
    path.join(repo, 'scripts', 'validate-test-registry.js'),
    "console.log('fixture registry valid');\n",
  );
  await writeFile(path.join(repo, 'tests', 'harness-exit-code.test.js'), "console.log('harness ok');\n");
  await writeFile(
    path.join(repo, 'tests', 'nightly-audit-runner-self-test.js'),
    "console.log('runner ok');\n",
  );
  await writeFile(
    path.join(repo, 'tests', 'nightly-orchestrator-self-test.js'),
    "console.log('orchestrator ok');\n",
  );
  await writeFile(
    path.join(repo, 'tests', 'audit-summary-self-test.js'),
    `import { readFile, writeFile } from 'node:fs/promises';
const { mode } = JSON.parse(await readFile('fixture-mode.json', 'utf8'));
if (mode === 'preflight-fail') {
  console.error('summary preflight fail');
  process.exitCode = 5;
} else if (mode === 'preflight-mutate') {
  await writeFile('fixture-mode.json', JSON.stringify({ mode: 'mutated' }));
  console.log('summary mutated source');
} else {
  console.log('summary ok');
}
`,
  );
  await writeFile(path.join(repo, 'scripts', 'nightly-audit.js'), fakeAuditRunnerSource());
  await writeFile(path.join(repo, 'scripts', 'audit-summary.js'), fakeSummarySource());
}

function fakePdfInstallerSource() {
  return `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" != "--venv" ] || [ -z "$2" ]; then
  exit 2
fi
target="$2"
case "$target" in /*) ;; *) exit 2 ;; esac
lock_sha="$(sha256sum requirements/pdf-export.lock | cut -d ' ' -f1)"
reportlab_version='5.0.0'
if grep -q '"pdf-runtime-mismatch"' fixture-mode.json; then
  reportlab_version='0.0.0'
fi
mkdir -p "$target/bin"
chmod 700 "$target"
printf '#!/bin/sh\\nexit 0\\n' > "$target/bin/python"
chmod 755 "$target/bin/python"
printf '%s\\n' \\
  'format=1' \\
  'status=ready' \\
  "lock_sha256=$lock_sha" \\
  'target=CPython 3.12 / Linux x86_64 / glibc 2.27+' \\
  "versions={\\"packages\\":{\\"charset-normalizer\\":\\"3.4.4\\",\\"pillow\\":\\"12.3.0\\",\\"reportlab\\":\\"$reportlab_version\\"},\\"python\\":\\"3.12.3\\"}" \\
  > "$target/.intentsmith-pdf-runtime"
chmod 600 "$target/.intentsmith-pdf-runtime"
echo 'fixture PDF runtime ready'
`;
}

function fakeAuditRunnerSource() {
  return `#!/usr/bin/env node
  import { createHash } from 'node:crypto';
  import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const outDir = value('--out-dir');
const runId = value('--run-id');
const profiles = value('--profile').split(',');
const allowBlockers = value('--allow-blocker').split(',');
const runDir = path.join(outDir, runId);
const logsDir = path.join(runDir, 'logs');
await mkdir(logsDir, { recursive: true, mode: 0o700 });
await chmod(runDir, 0o700);
await chmod(logsDir, 0o700);
const mode = JSON.parse(await readFile('fixture-mode.json', 'utf8')).mode;
if (mode === 'interrupt') {
  const suite = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { detached: true, stdio: 'ignore' },
  );
  await writeFile(
    path.join(runDir, 'interrupt-ready.json'),
    JSON.stringify({ runnerPid: process.pid, suitePid: suite.pid }),
    { mode: 0o600 },
  );
  let terminating = false;
  const terminate = () => {
    if (terminating) return;
    terminating = true;
    try { process.kill(-suite.pid, 'SIGTERM'); } catch {}
    setTimeout(() => {
      try { process.kill(-suite.pid, 'SIGKILL'); } catch {}
    }, 200).unref();
  };
  process.on('SIGTERM', terminate);
  process.on('SIGINT', terminate);
  await new Promise(resolve => suite.once('close', resolve));
  process.exit(1);
}
const registry = JSON.parse(await readFile('tests/registry.json', 'utf8'));
const suites = registry.suites
  .filter(suite => profiles.includes(suite.profile))
  .sort((a, b) => a.path.localeCompare(b.path))
  .map(suite => {
    const blockers = new Set();
    if (suite.state !== 'ACTIVE') blockers.add('state-' + String(suite.state).toLowerCase());
    if (suite.requirements.server) blockers.add('server');
    if (suite.requirements.ollama) blockers.add('ollama');
    if (suite.requirements.gpu) blockers.add('gpu');
    if (suite.requirements.modelFixture) blockers.add('model-fixture');
    if (suite.requirements.network === 'external') blockers.add('external-network');
    for (const toolchain of suite.requirements.toolchain || []) {
      blockers.add('toolchain:' + toolchain);
    }
    return {
      ...suite,
      category: suite.profile,
      command: suite.argv,
      blockers: [...blockers].sort()
    };
  });
const actualSource = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const sourceRevision = mode === 'source-mismatch' ? '0000000000000000000000000000000000000000' : actualSource;
const registryHash = createHash('sha256').update(JSON.stringify(registry)).digest('hex');
const options = {
  concurrency: 1,
  failFast: false,
  timeoutMs: Number(value('--timeout-ms')),
  deadlineMs: Number(value('--deadline-ms')),
  profiles: [...profiles].sort(),
  ids: [],
  exclude: [],
  allowBlockers,
  noBlock: false,
  allowDirty: false
};
const inventoryFingerprint = createHash('sha256').update(JSON.stringify(
  suites.map(suite => ({
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
    expectedDurationMs: suite.expectedDurationMs
  }))
)).digest('hex');
const optionsFingerprint = createHash('sha256').update(JSON.stringify(options)).digest('hex');
const results = [];
for (const [index, suite] of suites.entries()) {
  const logPath = path.join(logsDir, suite.id + '.log');
  const failed = mode !== 'all-pass' && index === 1;
  const contents = failed ? 'AssertionError: fixture failure\\n' : 'fixture pass\\n';
  await writeFile(logPath, contents, { mode: 0o600 });
  const relativeLog = mode === 'bad-log-path' && index === 0
    ? '/etc/passwd'
    : path.relative(process.cwd(), logPath).split(path.sep).join('/');
  results.push({
    id: suite.id,
    path: suite.path,
    profile: suite.profile,
    category: suite.profile,
    command: suite.command,
    blockers: suite.blockers,
    required: suite.required,
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    durationMs: 1,
    exitCode: failed ? 1 : 0,
    signal: null,
    timedOut: false,
    status: failed ? 'FAIL' : 'PASS',
    retryCount: 0,
    logPath: relativeLog,
    logSha256: createHash('sha256').update(contents).digest('hex'),
    sourceRevision,
    cleanup: { checked: true, leakDetected: false, terminated: true },
    sourceTree: { checked: true, clean: true, porcelain: '', head: sourceRevision }
  });
}
const counts = Object.fromEntries(profiles.map(profile => [
  profile,
  suites.filter(suite => suite.profile === profile).length
]));
const inventory = {
  runId,
  sourceRevision,
  generatedAt: new Date().toISOString(),
  counts,
  blockerCounts: {},
  inventoryFingerprint,
  optionsFingerprint,
  registryHash,
  options,
  suites
};
const statusCounts = {
  PASS: results.filter(result => result.status === 'PASS').length,
  FAIL: results.filter(result => result.status === 'FAIL').length,
  TIMEOUT: 0,
  BLOCKED: 0,
  SKIPPED: 0
};
const report = {
  runId,
  sourceRevision,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  dryRun: false,
  options: {
    concurrency: 1,
    failFast: false,
    timeoutMs: Number(value('--timeout-ms')),
    deadlineMs: Number(value('--deadline-ms')),
    profiles: [...profiles].sort(),
    ids: [],
    exclude: [],
    allowBlockers,
    noBlock: false
  },
  paths: {
    sourceRoot: process.cwd(),
    runDir: path.relative(process.cwd(), runDir).split(path.sep).join('/'),
    report: path.relative(process.cwd(), path.join(runDir, 'report.json')).split(path.sep).join('/'),
    checkpoint: path.relative(process.cwd(), path.join(runDir, 'checkpoint.json')).split(path.sep).join('/'),
    inventory: path.relative(process.cwd(), path.join(runDir, 'inventory.json')).split(path.sep).join('/')
  },
  inventoryFingerprint,
  optionsFingerprint,
  registryHash,
  inventory: { total: suites.length, counts, blockerCounts: {} },
  statusCounts,
  verdict: results.some(result => result.status !== 'PASS') ? 'FAIL' : 'PASS',
  exitCode: results.some(result => result.status !== 'PASS') ? 1 : 0,
  requiredFailureCount: results.filter(result => result.status !== 'PASS').length,
  requiredBlockedCount: 0,
  results
};
await writeFile(path.join(runDir, 'env.json'), JSON.stringify({
  keys: Object.keys(process.env).sort(),
  HOME: process.env.HOME,
  C3_DB_PATH: process.env.C3_DB_PATH,
  C3_PROJECTS_DIR: process.env.C3_PROJECTS_DIR,
  C3_LIFECYCLE_AUTO_COMMIT: process.env.C3_LIFECYCLE_AUTO_COMMIT,
  C3_ENABLE_AUTONOMY: process.env.C3_ENABLE_AUTONOMY,
  INTENTSMITH_PDF_PYTHON: process.env.INTENTSMITH_PDF_PYTHON,
  C3_PDF_PYTHON: process.env.C3_PDF_PYTHON,
  PYTHONNOUSERSITE: process.env.PYTHONNOUSERSITE,
  UMASK: process.umask()
}, null, 2), { mode: 0o600 });
await writeFile(path.join(runDir, 'inventory.json'), JSON.stringify(inventory, null, 2), { mode: 0o600 });
if (mode === 'corrupt-report') {
  await writeFile(path.join(runDir, 'report.json'), '{', { mode: 0o600 });
} else if (mode !== 'missing-report') {
  await writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
process.exitCode = report.exitCode;
`;
}

function fakeSummarySource() {
  return `#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args[0];
const out = args[args.indexOf('--out') + 1];
const report = JSON.parse(await readFile(path.join(input, 'report.json'), 'utf8'));
const failureResults = report.results.filter(result => ['FAIL', 'TIMEOUT'].includes(result.status));
const timeoutResults = report.results.filter(result => result.status === 'TIMEOUT');
const blockedResults = report.results.filter(result => result.status === 'BLOCKED');
const summary = {
  runId: report.runId,
  sourceRevision: report.sourceRevision,
  startedAt: report.startedAt,
  endedAt: report.endedAt,
  input: path.join(input, 'report.json'),
  mode: 'report',
  inventory: report.inventory,
  statusCounts: report.statusCounts,
  requiredFailureCount: report.requiredFailureCount,
  failures: {
    total: failureResults.length,
    clusters: failureResults.map(result => ({
      id: 'fixture-failure',
      status: result.status,
      signature: 'fixture failure',
      count: 1,
      paths: [result.path],
      logPaths: [result.logPath]
    }))
  },
  timeouts: { total: timeoutResults.length, paths: timeoutResults.map(result => result.path) },
  blocked: {
    total: blockedResults.length,
    counts: {},
    suites: blockedResults.map(result => ({ path: result.path }))
  },
  preflightBlockers: { total: 0, counts: {}, suites: [] },
  environmentErrors: { total: 0, items: [] },
  newVsRepeated: {
    baseline: null,
    newFailures: report.requiredFailureCount,
    repeatedFailures: 0
  },
  recommendedRerun: null
};
await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
await chmod(path.dirname(out), 0o700);
await writeFile(out, JSON.stringify(summary, null, 2), { mode: 0o600 });
`;
}

async function commitFixtureMode(repo, mode) {
  await writeJson(path.join(repo, 'fixture-mode.json'), { mode });
  git(['add', 'fixture-mode.json'], repo);
  git(['commit', '-m', `fixture: ${mode}`], repo);
  git(['push', 'origin', BRANCH], repo);
}

async function assertRejectedRun({
  repo,
  artifactRoot,
  worktreeRoot,
  runId,
  pattern,
}) {
  await assert.rejects(
    () => runNightly({ repo, artifactRoot, worktreeRoot, runId, testMode: true }),
    pattern,
  );
  const sourceRevision = gitOutput(['rev-parse', `origin/${BRANCH}`], repo);
  const worktree = path.join(worktreeRoot, `${runId}-${sourceRevision.slice(0, 12)}`);
  await assertMissing(worktree);
  await assertMissing(`${worktree}.ownership.json`);
  const metadata = await readJson(path.join(artifactRoot, 'runs', runId, 'metadata.json'));
  assert.equal(metadata.status, 'failed');
}

async function seedCompletedRuns(artifactRoot, count) {
  for (let i = 0; i < count; i++) {
    const runDir = path.join(artifactRoot, 'runs', `old-${i}`);
    await mkdir(runDir, { recursive: true });
    await writeJson(path.join(runDir, 'metadata.json'), {
      orchestrator: 'intentsmith-gate0-orchestrator',
      runId: `old-${i}`,
      endedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
  }
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
}

function gitOutput(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function assertMissing(targetPath) {
  await assert.rejects(() => stat(targetPath), /ENOENT/);
}

async function assertMode(targetPath, expectedMode) {
  const actualMode = (await stat(targetPath)).mode & 0o777;
  assert.equal(
    actualMode,
    expectedMode,
    `${targetPath} mode ${actualMode.toString(8)} !== ${expectedMode.toString(8)}`,
  );
}

async function listRunDirs(root) {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  assert.notEqual(index, -1, `${name} missing from ${argv.join(' ')}`);
  return argv[index + 1];
}

function assertNoUnsafeAuditFlags(values) {
  const argv = Array.isArray(values) ? values : String(values).split(/\s+/u);
  const text = argv.join(' ');
  assert.equal(text.includes('--no-block'), false);
  assert.equal(text.includes('--allow-dirty'), false);
  const blockerIndex = argv.indexOf('--allow-blocker');
  assert.notEqual(blockerIndex, -1);
  assert.equal(argv[blockerIndex + 1], 'toolchain:python-pdf-runtime');
  assert.equal(argv.lastIndexOf('--allow-blocker'), blockerIndex);
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`owned descendant ${pid} survived cleanup`);
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

async function waitForJson(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for valid JSON in ${filePath}`);
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

async function cleanupSignalFixture({ child, observedClose, runnerPid, suitePid }) {
  signalOwnedGroupForTest(suitePid, 'SIGTERM');
  signalOwnedGroupForTest(runnerPid, 'SIGTERM');
  if (processAlive(child.pid)) child.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 250));
  signalOwnedGroupForTest(suitePid, 'SIGKILL');
  signalOwnedGroupForTest(runnerPid, 'SIGKILL');
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
