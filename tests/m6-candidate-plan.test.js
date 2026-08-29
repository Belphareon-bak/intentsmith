import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  M6_CANDIDATE_PHASE_IDS,
  M6_DIRECT_FRESH_CLONE_PROGRAMS,
  M6_PHYSICAL_GPU_PROGRAMS,
  M6_RUNNER_OWNED_SERVER_PROGRAMS,
} from '../contracts/m6/candidate-plan-v1.js';
import {
  buildM6CandidateExecutionPlan,
  validateM6CandidateExecutionPlan,
} from '../src/release/m6-candidate-plan.js';
import {
  candidateModelResidencyOnly,
  captureGpuCensus,
  loadReportItem,
  validateM6CompletedAuditPhase,
} from '../scripts/run-m6-candidate-evidence.js';
import { installOllamaLoopbackFetchBoundary } from './helpers/ollama-loopback-fetch-boundary.js';
import { suite, summary, test, testAsync } from './harness.js';
import registry from './registry.json' with { type: 'json' };

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

suite('M6 locked candidate execution plan');

test('plan is argument-free, serial and covers the exact ACTIVE required registry', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const validation = validateM6CandidateExecutionPlan(plan, registry);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(plan.acceptsArguments, false);
  assert.equal(plan.concurrency, 1);
  assert.deepEqual(plan.phases.map(phase => phase.id), M6_CANDIDATE_PHASE_IDS);
  const expected = registry.suites
    .filter(program => program.required === true && program.state === 'ACTIVE')
    .map(program => program.id)
    .sort();
  const selected = plan.phases.flatMap(phase => phase.programIds).sort();
  assert.deepEqual(selected, expected);
  assert.equal(selected.length, expected.length);
  assert.equal(new Set(selected).size, selected.length);
  assert.equal(Object.isFrozen(plan), true);
});

test('offline signed authority proofs are explicit required members of the locked plan', () => {
  const signedAuthorityPrograms = [
    'IS-T1-TESTS-SIGNED-AUTHORITY-BUNDLE-TEST',
    'IS-T1-TESTS-SIGNED-AUTHORITY-RECEIPT-TEST',
  ];
  const byId = new Map(registry.suites.map(program => [program.id, program]));
  const plan = buildM6CandidateExecutionPlan(registry);
  const deterministic = plan.phases.find(
    phase => phase.id === 'deterministic-offline-database',
  );
  for (const programId of signedAuthorityPrograms) {
    const program = byId.get(programId);
    assert.equal(program?.state, 'ACTIVE', programId);
    assert.equal(program?.required, true, programId);
    assert.equal(program?.profile, 'offline', programId);
    assert.equal(deterministic.programIds.includes(programId), true, programId);

    const missing = structuredClone(plan);
    missing.phases.find(
      phase => phase.id === 'deterministic-offline-database',
    ).programIds = deterministic.programIds.filter(id => id !== programId);
    const validation = validateM6CandidateExecutionPlan(missing, registry);
    assert.equal(validation.valid, false, programId);
    assert(validation.errors.includes(`plan:required-program-uncovered:${programId}`));
  }
});

test('M7 session authority is an explicit required member of the locked plan', () => {
  const programId = 'IS-T1-TESTS-M7-SESSION-AUTHORITY-TEST';
  const program = registry.suites.find(item => item.id === programId);
  const plan = buildM6CandidateExecutionPlan(registry);
  const deterministic = plan.phases.find(
    phase => phase.id === 'deterministic-offline-database',
  );
  assert.equal(program?.state, 'ACTIVE');
  assert.equal(program?.required, true);
  assert.equal(program?.profile, 'database');
  assert.equal(deterministic.programIds.includes(programId), true);

  const missing = structuredClone(plan);
  missing.phases.find(
    phase => phase.id === 'deterministic-offline-database',
  ).programIds = deterministic.programIds.filter(id => id !== programId);
  const validation = validateM6CandidateExecutionPlan(missing, registry);
  assert.equal(validation.valid, false);
  assert(validation.errors.includes(`plan:required-program-uncovered:${programId}`));
});

test('direct, runner-owned server and physical GPU programs cannot be silently omitted', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const selected = new Set(plan.phases.flatMap(phase => phase.programIds));
  for (const id of [
    ...M6_DIRECT_FRESH_CLONE_PROGRAMS,
    ...M6_RUNNER_OWNED_SERVER_PROGRAMS,
    ...M6_PHYSICAL_GPU_PROGRAMS,
  ]) {
    assert.equal(selected.has(id), true, id);
  }
  assert.equal(plan.phases.find(phase => phase.id === 'fresh-clone-install-build-studio')
    .requiresFreshClone, true);
  assert.equal(plan.phases.find(phase => phase.id === 'physical-ollama-gpu')
    .requiresGpuCensus, true);
});

test('model and runner-owned server phases cover every runnable required program', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const byId = new Map(registry.suites.map(program => [program.id, program]));
  const modelPhase = plan.phases.find(item => item.id === 'model-without-server');
  assert.equal(modelPhase.programIds.length, 44);
  assert.equal(modelPhase.programIds.filter(id => byId.get(id).profile === 'model').length, 43);
  assert.equal(modelPhase.programIds.filter(id => byId.get(id).profile === 'server').length, 1);
  assert(modelPhase.programIds.every(id => byId.get(id).requirements.server === false));
  assert(modelPhase.programIds.every(id => byId.get(id).requirements.network !== 'external'));

  const serverPhase = plan.phases.find(item => item.id === 'runner-owned-server-programs');
  assert.deepEqual(serverPhase.programIds, M6_RUNNER_OWNED_SERVER_PROGRAMS);
  assert.equal(serverPhase.programIds.length, 9);
  assert(serverPhase.programIds.every(id => byId.get(id).requirements.server === true));
  assert(serverPhase.programIds.every(id => byId.get(id).requirements.network === 'loopback'));
  assert.equal(serverPhase.runner, 'm6-runner-owned-server-programs');
  assert.equal(serverPhase.requiresOwnedServer, true);
  assert.equal(registry.suites.filter(program => (
    program.state === 'ACTIVE'
    && program.required === true
    && program.requirements.network === 'external'
  )).length, 0);
});

await testAsync('required model quality programs are transport-contained to exact Ollama endpoints', async () => {
  const calls = [];
  let redirectNext = false;
  const boundary = installOllamaLoopbackFetchBoundary({
    transport: async (input, init) => {
      calls.push({ input: String(input), init });
      if (redirectNext) {
        redirectNext = false;
        return { status: 302 };
      }
      return { status: 200 };
    },
  });
  try {
    await fetch('http://127.0.0.1:11434/api/tags');
    await fetch('http://localhost:11434/api/chat', { method: 'POST' });
    await fetch(new Request('http://[::1]:11434/api/show', { method: 'POST' }));
    assert.equal(calls.length, 3);
    assert(calls.every(call => call.init.redirect === 'manual'));

    redirectNext = true;
    await assert.rejects(
      fetch('http://127.0.0.1:11434/api/tags'),
      error => error.code === 'INTENTSMITH_TEST_OLLAMA_REDIRECT_BLOCKED',
    );

    for (const [target, init, code] of [
      ['https://127.0.0.1:11434/api/tags', undefined, 'INTENTSMITH_TEST_EXTERNAL_NETWORK_BLOCKED'],
      ['http://127.0.0.1:11435/api/tags', undefined, 'INTENTSMITH_TEST_EXTERNAL_NETWORK_BLOCKED'],
      ['https://example.com/', undefined, 'INTENTSMITH_TEST_EXTERNAL_NETWORK_BLOCKED'],
      ['http://user:secret@127.0.0.1:11434/api/tags', undefined, 'INTENTSMITH_TEST_EXTERNAL_NETWORK_BLOCKED'],
      ['http://127.0.0.1:11434/api/tags?forge=1', undefined, 'INTENTSMITH_TEST_EXTERNAL_NETWORK_BLOCKED'],
      ['http://127.0.0.1:11434/api/delete', { method: 'DELETE' }, 'INTENTSMITH_TEST_OLLAMA_ENDPOINT_BLOCKED'],
      ['http://127.0.0.1:11434/api/chat', { method: 'GET' }, 'INTENTSMITH_TEST_OLLAMA_ENDPOINT_BLOCKED'],
    ]) {
      await assert.rejects(fetch(target, init), error => error.code === code);
    }
    assert.deepEqual(boundary.snapshot(), {
      loopbackRequests: 4,
      blockedRequests: 7,
      blockedRedirects: 1,
    });
  } finally {
    assert.equal(boundary.restore(), true);
  }

  const requiredSources = [
    'chat-quality.test.js',
    'conv-czech-nodiacritics.test.js',
    'conv-czech.test.js',
    'conv-english.test.js',
    'expertise-comparison-e2e.test.js',
    'expertise-comparison-e2e-b.test.js',
    'expertise-comparison-e2e-c.test.js',
    'expertise-comparison-e2e-d.test.js',
    'expertise-comparison-e2e-e.test.js',
  ];
  for (const sourcePath of requiredSources) {
    const source = readFileSync(path.join(repositoryRoot, 'tests', sourcePath), 'utf8');
    assert.match(source, /installOllamaLoopbackFetchBoundary\(\{ reportOnExit: true \}\)/u);
  }
});

test('controlled soak contains only the two measured M6 runtimes with a 30-hour window', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const phase = plan.phases.find(item => item.id === 'controlled-soak');
  assert.equal(plan.phases.at(-1).id, 'controlled-soak');
  assert.deepEqual(phase.programIds, [
    'IS-T5-TESTS-M6-LONG-SOAK-E2E',
    'IS-T5-TESTS-M6-MAX-THROUGHPUT-E2E',
  ]);
  assert.equal(phase.timeoutMinutes, 1_500);
  assert.equal(phase.deadlineHours, 30);
  assert.equal(phase.requiresGpuCensus, false);
  assert.deepEqual(phase.allowedBlockers, [
    'toolchain:iproute2',
    'toolchain:linux-user-network-namespace',
    'server',
  ]);
});

test('candidate runner materializes only named toolchain bindings', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'run-m6-candidate-evidence.js'),
    'utf8',
  );
  assert.match(source, /resolvePdfPythonInterpreter\(process\.env\)/u);
  assert.match(source, /environment\.INTENTSMITH_PDF_PYTHON = pdfPython/u);
  assert.match(source, /environment\.C3_PDF_PYTHON = pdfPython/u);
  assert.match(source, /npm_config_devdir: nodeGypCache/u);
  assert.match(source, /electron_config_cache: electronCache/u);
  assert.match(source, /electronHeaders: await copyCacheIfPresent/u);
  assert.match(
    source,
    /programId === M6_PREVIOUS_VERSION_UPGRADE_PROGRAM[\s\S]*copyCacheIfPresent\([\s\S]*prepared\.environment\.npm_config_cache,[\s\S]*programNpmCache/u,
  );
  assert.match(source, /timeout-minutes=\$\{phase\.timeoutMinutes\}/u);
  assert.match(source, /deadline-hours=\$\{phase\.deadlineHours\}/u);
  assert.match(source, /'--fail-fast'/u);
  assert.match(source, /assertNoStaleDirectTestRuntime\(root\)/u);
  assert.match(
    source,
    /runFreshClonePhase\([\s\S]*waitForCandidateGpuQuiescence\([\s\S]*physical-ollama-gpu[\s\S]*controlled-soak/u,
  );
  assert.doesNotMatch(source, /\.\.\.process\.env/u);
});

test('deterministic phase opens only exact locally preflighted toolchains', () => {
  const plan = buildM6CandidateExecutionPlan(registry);
  const deterministic = plan.phases.find(
    phase => phase.id === 'deterministic-offline-database',
  );
  assert.deepEqual(deterministic.allowedBlockers, [
    'toolchain:python-pdf-runtime',
    'toolchain:bwrap',
    'toolchain:git',
    'toolchain:bubblewrap',
    'toolchain:prlimit',
  ]);
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'nightly-audit.js'),
    'utf8',
  );
  for (const executable of ['/usr/bin/bwrap', '/usr/bin/git', '/usr/bin/prlimit']) {
    assert(source.includes(executable), executable);
  }
  assert.match(source, /invalid-executable-authority/u);
});

test('server-program runner owns exact serial loopback fixtures and records cleanup', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'run-m6-server-program-evidence.js'),
    'utf8',
  );
  assert.match(source, /const SERVER_PORT = 3335/u);
  assert.match(source, /INTENTSMITH_TEST_SERVER_PID/u);
  assert.match(source, /INTENTSMITH_TEST_SERVER_NONCE/u);
  assert.match(source, /value\?\.pid !== expectedPid/u);
  assert.match(source, /value\?\.testRunNonce !== expectedNonce/u);
  assert.match(source, /C3_ENABLE_ONLINE_DISCOVERY: 'false'/u);
  assert.match(source, /suite\.requirements\.ollama[\s\S]*127\.0\.0\.1:9/u);
  assert.match(source, /for \(let index = 0; index < suites\.length; index \+= 1\)/u);
  assert.match(source, /status: 'SKIPPED'/u);
  assert.match(source, /serverCleanup\.clean === true/u);
  assert.match(source, /assertServerPortAvailable\(\)/u);
  assert.doesNotMatch(source, /\.\.\.process\.env/u);
});

test('candidate runner stops after any completed red audit phase', () => {
  const candidateSha = 'a'.repeat(40);
  const phase = { id: 'focused', programIds: ['program-a'] };
  const base = {
    verdict: 'PASS',
    exitCode: 0,
    sourceRevision: candidateSha,
    interruptionSignal: null,
    requiredFailureCount: 0,
    requiredBlockedCount: 0,
    results: [{
      id: 'program-a',
      status: 'PASS',
      exitCode: 0,
      signal: null,
      timedOut: false,
      sourceRevision: candidateSha,
      cleanup: { checked: true, leakDetected: false, terminated: true },
      sourceTree: { checked: true, clean: true, head: candidateSha },
    }],
  };
  assert.equal(validateM6CompletedAuditPhase(base, phase, candidateSha).valid, true);
  for (const mutate of [
    report => { report.verdict = 'FAIL'; },
    report => { report.exitCode = 1; },
    report => { report.results[0].status = 'BLOCKED'; },
    report => { report.results[0].timedOut = true; },
    report => { report.results[0].cleanup.leakDetected = true; },
    report => { report.results[0].sourceTree.clean = false; },
    report => { report.results.push(structuredClone(report.results[0])); },
    report => { report.results = []; },
  ]) {
    const report = structuredClone(base);
    mutate(report);
    assert.equal(validateM6CompletedAuditPhase(report, phase, candidateSha).valid, false);
  }
});

test('release artifact capture occurs only after every runtime journey', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'run-m6-candidate-evidence.js'),
    'utf8',
  );
  const soakCompletion = source.indexOf(
    'reportPaths.push(await runAuditPhase({ root, candidateSha, evidenceRoot, phase: controlledSoak }))',
  );
  const postJourneyCapture = source.indexOf(
    'const releaseManifestPath = await finalizeFreshCloneRelease({',
  );
  const technicalEvaluation = source.indexOf('const technical = evaluateM6TechnicalEvidence({');
  assert(soakCompletion > 0);
  assert(postJourneyCapture > soakCompletion);
  assert(technicalEvaluation > postJourneyCapture);
});

test('nightly runner opens the hard server blocker only for the two exact owned M6 programs', () => {
  const source = readFileSync(
    path.join(repositoryRoot, 'scripts', 'nightly-audit.js'),
    'utf8',
  );
  assert.match(source, /IS-T5-TESTS-M6-LONG-SOAK-E2E/u);
  assert.match(source, /IS-T5-TESTS-M6-MAX-THROUGHPUT-E2E/u);
  assert.match(source, /owned-production-server-loopback-network-namespace/u);
  assert.match(
    source,
    /blocker === 'server'[\s\S]*SELF_STARTING_OWNED_SERVER_PROGRAMS\.has\(suite\?\.id\)[\s\S]*suite\?\.fixture === SELF_STARTING_OWNED_SERVER_FIXTURE/u,
  );
});

await testAsync('candidate producer loads exact regular report log bytes before evaluation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm6-report-loader-'));
  try {
    await mkdir(path.join(root, 'logs'));
    const logPath = path.join(root, 'logs', 'program-a.log');
    const reportPath = path.join(root, 'report.json');
    await writeFile(logPath, 'exact log bytes\n');
    await writeFile(reportPath, JSON.stringify({
      results: [{ id: 'program-a', logPath: 'logs/program-a.log' }],
    }));
    const item = await loadReportItem(root, reportPath, {
      id: 'deterministic-offline-database',
      runner: 'nightly-audit',
    });
    assert.equal(item.phaseId, 'deterministic-offline-database');
    assert.equal(item.runner, 'nightly-audit');
    assert.equal(item.logs.length, 1);
    assert.equal(item.logs[0].programId, 'program-a');
    assert.equal(item.logs[0].bytes.toString('utf8'), 'exact log bytes\n');

    await rm(logPath);
    await symlink('/etc/hosts', logPath);
    await assert.rejects(
      loadReportItem(root, reportPath, { id: 'phase', runner: 'nightly-audit' }),
      /not a regular file/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pre-physical wait recognizes only the candidate-owned Ollama residency', () => {
  const candidateIdentity = {
    state: 'observed',
    uid: 997,
    executable: '/usr/local/lib/ollama/llama-server',
    executableState: 'observed',
    executableErrorCode: null,
    candidateWorkerBound: true,
    candidateWorkerUid: true,
    candidateModelArgument: true,
    candidateMmprojArgument: true,
    loopbackHost: true,
    offline: true,
  };
  const owned = {
    compute: [{
      pid: 101,
      processName: '/usr/local/lib/ollama/llama-server',
      usedMemoryMiB: 16_000,
      identity: candidateIdentity,
    }],
    ollama: {
      runningRows: ['qwen3.5:27b  7653528ba5cb  16 GB  100% GPU  4096  4 minutes'],
    },
  };
  assert.equal(candidateModelResidencyOnly(owned), true);
  // Ollama registers and unregisters its public row after/before the exact worker
  // becomes visible to the NVIDIA driver. Both transition directions must wait.
  assert.equal(candidateModelResidencyOnly({
    ...owned,
    ollama: { runningRows: [] },
  }), true);
  assert.equal(candidateModelResidencyOnly({
    ...owned,
    compute: [{
      ...owned.compute[0],
      identity: {
        ...candidateIdentity,
        executable: null,
        executableState: 'unreadable',
        executableErrorCode: 'EACCES',
      },
    }],
  }), true);
  assert.equal(candidateModelResidencyOnly({
    ...owned,
    compute: [],
  }), true);
  assert.equal(candidateModelResidencyOnly({
    compute: [{ ...owned.compute[0], identity: { state: 'gone', errorCode: 'ENOENT' } }],
    ollama: { runningRows: [] },
  }), true);
  for (const mutation of [
    { compute: [], ollama: { runningRows: [] } },
    { ...owned, compute: [{ ...owned.compute[0], processName: '/usr/bin/python' }] },
    { ...owned, compute: [{ ...owned.compute[0], processName: '/foreign/llama-server' }] },
    { ...owned, compute: [{ ...owned.compute[0], identity: { state: 'unreadable', errorCode: 'EACCES' } }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateWorkerBound: false },
    }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateWorkerUid: false },
    }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateModelArgument: false },
    }] },
    { ...owned, compute: [{
      ...owned.compute[0],
      identity: { ...candidateIdentity, candidateMmprojArgument: false },
    }] },
    { ...owned, ollama: { runningRows: ['qwen3.5:27b wrongdigest 16 GB 100% GPU 4096 4 minutes'] } },
    { ...owned, ollama: { runningRows: ['foreign:latest id 16 GB 100% GPU 4096 4 minutes'] } },
    { ...owned, ollama: { runningRows: [...owned.ollama.runningRows, owned.ollama.runningRows[0]] } },
  ]) assert.equal(candidateModelResidencyOnly(mutation), false);
});

await testAsync('GPU preflight passively waits for two clean samples and records the transient', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'm6-gpu-preflight-wait-'));
  let clockMs = 0;
  const clean = Object.freeze({
    contract: 'M6GpuCensus',
    version: 1,
    capturedAt: '2026-08-27T00:00:10.000Z',
    compute: [],
    gpus: [{ index: 0, freeMiB: 23_000 }],
    ollama: { header: '', runningRows: [] },
    minimumFreeMiB: 20_000,
    available: true,
    foreignActivity: false,
    sufficientFreeMemory: true,
  });
  const transient = Object.freeze({
    ...clean,
    capturedAt: '2026-08-27T00:00:00.000Z',
    compute: [{ pid: 101, processName: '/usr/local/lib/ollama/llama-server' }],
    ollama: { header: 'NAME', runningRows: ['qwen3.5:27b 7653528ba5cb'] },
    foreignActivity: true,
    sufficientFreeMemory: false,
  });
  const snapshots = [transient, clean, clean];
  try {
    const censusPath = await captureGpuCensus(temporary, {
      snapshot: () => snapshots.shift(),
      sleep: async ms => { clockMs += ms; },
      now: () => clockMs,
      timeoutMs: 20,
      pollMs: 5,
    });
    const finalCensus = JSON.parse(await readFile(censusPath, 'utf8'));
    const receipt = JSON.parse(await readFile(
      path.join(temporary, 'gpu', 'preflight-wait.json'),
      'utf8',
    ));
    assert.equal(finalCensus.foreignActivity, false);
    assert.equal(receipt.verdict, 'PASS');
    assert.equal(receipt.intervention, 'none-read-only-wait');
    assert.equal(receipt.requiredStableSamples, 2);
    assert.equal(receipt.observations.length, 3);
    assert.equal(receipt.observations[0].foreignActivity, true);
    assert.equal(receipt.observations[1].foreignActivity, false);
    assert.equal(receipt.observations[2].foreignActivity, false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

await testAsync('GPU preflight remains blocked when activity does not quiesce', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'm6-gpu-preflight-blocked-'));
  let clockMs = 0;
  const busy = Object.freeze({
    contract: 'M6GpuCensus',
    version: 1,
    capturedAt: '2026-08-27T00:00:00.000Z',
    compute: [{ pid: 202, processName: '/foreign/gpu-worker' }],
    gpus: [{ index: 0, freeMiB: 6_000 }],
    ollama: { header: '', runningRows: [] },
    minimumFreeMiB: 20_000,
    available: true,
    foreignActivity: true,
    sufficientFreeMemory: false,
  });
  try {
    await assert.rejects(
      captureGpuCensus(temporary, {
        snapshot: () => busy,
        sleep: async ms => { clockMs += ms; },
        now: () => clockMs,
        timeoutMs: 10,
        pollMs: 5,
      }),
      error => error?.code === 'M6_GPU_CENSUS_BLOCKED',
    );
    const receipt = JSON.parse(await readFile(
      path.join(temporary, 'gpu', 'preflight-wait.json'),
      'utf8',
    ));
    assert.equal(receipt.verdict, 'BLOCKED');
    assert.equal(receipt.reasonCode, 'M6_GPU_CENSUS_BLOCKED');
    assert.equal(receipt.intervention, 'none-read-only-wait');
    assert.equal(receipt.observations.length, 3);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('duplicate, reordered, concurrent, uncovered or unexpected plans fail closed', () => {
  const base = buildM6CandidateExecutionPlan(registry);
  for (const mutate of [
    plan => { plan.concurrency = 2; },
    plan => { plan.phases.reverse(); },
    plan => { plan.phases[1].programIds.push(plan.phases[0].programIds[0]); },
    plan => { plan.phases[0].programIds.push('IS-T3-TESTS-CHAT-QUALITY-TEST'); },
    plan => { plan.phases[2].programIds.pop(); },
    plan => { plan.phases.at(-1).timeoutMinutes = 60; },
    plan => { plan.phases.at(-1).allowedBlockers.push('gpu'); },
  ]) {
    const plan = structuredClone(base);
    mutate(plan);
    assert.equal(validateM6CandidateExecutionPlan(plan, registry).valid, false);
  }
});

summary();
