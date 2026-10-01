#!/usr/bin/env node
// Explicit physical qualification. The default and --preflight never infer.
// Generated code runs only in the canonical M2 read-only process sandbox.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { acquireGpuEvaluationLock, assessScheduledEvaluationReadiness } from '../src/upgrade/gpu-evaluation-lock.js';
import { processSandboxProvider } from '../src/execution/process-sandbox-provider.js';
import { LINUX_BWRAP_READ_ONLY_PROFILE } from '../src/execution/process-supervisor-child.js';
import { computeM2ExecutionValueDigest } from '../contracts/m2/execution-v1.js';
import { compileCodeDraftInput } from '../src/lifecycle/m2-code-draft.js';
import { makeRuntime, startServer, stopServer, requestJson } from './run-project-build-journey.js';
import {
  LEDGER_FILES, ORACLE_PATH, ORACLE_BINARY, ORACLE_ARGV, ORACLE_SOURCE, ORACLE_SHA256, PROBE_PATH, PROBE_SOURCE,
  PROBE_SHA256, VALIDATE_PATH, VALIDATE_SOURCE, VALIDATE_SHA256, ENTRY_PATH,
  ENTRY_SOURCE, ENTRY_SHA256, sha256, ledgerBlueprint, assertLedgerPreview,
  assertLedgerCLIResults, policyForFrozenOracle,
} from './project-app-acceptance.js';

const SELF = fileURLToPath(import.meta.url);
const SOURCE_ROOT = path.resolve(path.dirname(SELF), '..');
const ARTIFACT_ROOT = path.join(SOURCE_ROOT, '.intentsmith-artifacts');
const MODEL_PATTERN = /^[A-Za-z0-9_.:/-]{1,128}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const EXPECTED_PATHS = LEDGER_FILES.map(file => file.path).sort();
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const save = (out, name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });

function git(cwd, args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', env: {
    PATH: '/usr/bin:/bin', HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  } }).trim();
}

function sourceObservation() {
  return { head: git(SOURCE_ROOT, ['rev-parse', 'HEAD']), dirty: git(SOURCE_ROOT, ['status', '--porcelain=v1']),
    oracleSha256: ORACLE_SHA256, oracleBinary: ORACLE_BINARY, probeSha256: PROBE_SHA256,
    validatorProbeSha256: VALIDATE_SHA256,
    entrySha256: ENTRY_SHA256, generatedPaths: EXPECTED_PATHS };
}

function nativeRuntimeObservation() {
  try {
    const database = new Database(':memory:');
    try { assert.equal(database.prepare('SELECT 1 AS n').get().n, 1); }
    finally { database.close(); }
    return { available: true, node: process.execPath, version: process.version, modulesAbi: process.versions.modules };
  } catch (error) {
    return { available: false, node: process.execPath, version: process.version,
      modulesAbi: process.versions.modules, error: String(error.message).slice(0, 600) };
  }
}

function parseOptions(argv) {
  if (!argv.length || argv[0] === '--preflight') return { mode: 'preflight' };
  if (argv[0] !== '--live' || argv.length !== 9) throw new Error('Usage: --live --out <new path> --source-sha <40 hex> --model <name> --digest <64 hex>');
  const entries = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    if (!['--out', '--source-sha', '--model', '--digest'].includes(argv[index]) || entries.has(argv[index])) throw new Error('invalid live arguments');
    entries.set(argv[index], argv[index + 1]);
  }
  if (entries.size !== 4) throw new Error('all live pins are required');
  const options = { mode: 'live', out: entries.get('--out'), sourceSha: entries.get('--source-sha'),
    model: entries.get('--model'), digest: entries.get('--digest') };
  if (!SHA_PATTERN.test(options.sourceSha) || !DIGEST_PATTERN.test(options.digest) || !MODEL_PATTERN.test(options.model)) {
    throw new Error('invalid source/model/digest pin');
  }
  return options;
}

function newOutputDirectory(candidate) {
  assert.ok(path.isAbsolute(candidate), 'evidence path must be absolute');
  assert.equal(path.dirname(candidate), ARTIFACT_ROOT, 'evidence must be a direct child of repository private artifacts');
  assert.equal(fs.realpathSync(ARTIFACT_ROOT), ARTIFACT_ROOT, 'artifact root must be canonical');
  assert.ok(fs.statSync(ARTIFACT_ROOT).isDirectory(), 'artifact root must be a directory');
  fs.mkdirSync(candidate, { mode: 0o700 }); // exclusive; never reuse an evidence directory
  assert.equal(fs.realpathSync(candidate), candidate);
  fs.chmodSync(candidate, 0o700);
  return candidate;
}

function assertResponse(response, status, label) {
  assert.equal(response.statusCode, status, `${label}: ${response.raw?.slice(0, 1_000)}`);
  return response.json;
}

function assertFrozenProject(project, policySha256) {
  assert.equal(sha256(fs.readFileSync(path.join(project, ORACLE_PATH))), ORACLE_SHA256, 'operator oracle preserved');
  assert.equal(sha256(fs.readFileSync(path.join(project, PROBE_PATH))), PROBE_SHA256, 'operator subject probe preserved');
  assert.equal(sha256(fs.readFileSync(path.join(project, VALIDATE_PATH))), VALIDATE_SHA256,
    'operator validator probe preserved');
  assert.equal(sha256(fs.readFileSync(path.join(project, ENTRY_PATH))), ENTRY_SHA256, 'operator CLI adapter preserved');
  assert.equal(sha256(fs.readFileSync(path.join(project, '.intentsmith/m2-governance-policy.json'))),
    policySha256, 'operator policy preserved');
}

function recordSupervisorIdentity(root) {
  return identity => {
    const file = path.join(root, `sandbox-supervisor-${randomUUID()}.json`);
    const handle = fs.openSync(file, 'wx', 0o600);
    try { fs.writeSync(handle, JSON.stringify(identity) + '\n'); fs.fsyncSync(handle); }
    finally { fs.closeSync(handle); }
    const directory = fs.openSync(root, 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    return { durable: true };
  };
}

async function sandboxNode(project, argv, artifactRoot) {
  const environment = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' };
  return processSandboxProvider.run({
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
    projectRoot: project, canonicalCwd: project, binary: ORACLE_BINARY, argv,
    argvDigest: computeM2ExecutionValueDigest(argv), environment,
    environmentDigest: computeM2ExecutionValueDigest(environment), timeoutMs: 30_000,
    expectedExitCode: 0,
  }, { recordSupervisorIdentity: recordSupervisorIdentity(artifactRoot) });
}

async function verifyApplication(project, artifacts) {
  const accepted = await sandboxNode(project, ORACLE_ARGV, artifacts);
  assert.equal(accepted.terminalStatus, 'succeeded', JSON.stringify(accepted));
  assert.match(accepted.stdout, /PROJECT_APP_ORACLE_PASS/);
  const commands = [['add', 12.5, 'food'], ['add', 7.25, 'travel'], ['add', 3.5, 'food'],
    ['total'], ['categories'], ['list']];
  const cli = await sandboxNode(project, [ENTRY_PATH, JSON.stringify(commands)], artifacts);
  assert.equal(cli.terminalStatus, 'succeeded', JSON.stringify(cli));
  assertLedgerCLIResults(JSON.parse(cli.stdout.trim()));
  const fresh = await sandboxNode(project, [ENTRY_PATH, JSON.stringify([['list'], ['total'], ['categories']])], artifacts);
  assert.equal(fresh.terminalStatus, 'succeeded', JSON.stringify(fresh));
  assert.deepEqual(JSON.parse(fresh.stdout.trim()), [[], 0, {}]);
  for (const commands of [[['add', -1, 'food']], [['add', 1, '']], [['unknown']]]) {
    const rejected = await sandboxNode(project, [ENTRY_PATH, JSON.stringify(commands)], artifacts);
    assert.equal(rejected.terminalStatus, 'failed', 'CLI invalid command must exit nonzero');
  }
  return { oracle: accepted, cli, fresh, invalidCases: 3 };
}

function fileSnapshot(project, diff) {
  return diff.map(row => {
    const relative = row.path;
    const file = path.join(project, relative);
    const bytes = fs.readFileSync(file);
    assert.deepEqual(bytes, Buffer.from(row.after.content), relative + ' exact preview bytes');
    const stat = fs.statSync(file, { bigint: true });
    assert.ok(stat.isFile() && stat.nlink === 1n, relative + ' regular unshared file');
    return { path: relative, sha256: sha256(bytes), size: bytes.length, inode: String(stat.ino), mtimeNs: String(stat.mtimeNs) };
  });
}

function observedBinding(databasePath, model, digest) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(database.pragma('quick_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    const binding = database.prepare("SELECT * FROM model_desired_bindings WHERE role = 'CODE'").get();
    assert.equal(binding?.model_name, model, 'private CODE model binding name');
    assert.equal(binding?.digest_sha256, digest, 'private CODE model binding digest');
    return binding;
  } finally { database.close(); }
}

// Qualification evidence is computed even when the private child reports a
// functional failure. A failed app must not hide otherwise complete provider
// identity, and complete provider calls must not turn that app failure green.
export function assessProviderGenerations(requests, { model, digest, version, previewHashes = null }) {
  const generations = requests.filter(row => row && ['/api/chat', '/api/generate'].includes(row.path));
  const failures = [];
  if (generations.length !== EXPECTED_PATHS.length) failures.push(`expected ${EXPECTED_PATHS.length} generations, observed ${generations.length}`);
  if (requests.some(row => row?.error)) failures.push('one or more provider relay requests failed');
  let generationPaths = [];
  try {
    const compiled = compileCodeDraftInput(ledgerBlueprint());
    generationPaths = compiled.buildSteps.map(step => compiled.changes[step.index].path);
    if (generationPaths.length !== EXPECTED_PATHS.length
      || JSON.stringify([...generationPaths].sort()) !== JSON.stringify(EXPECTED_PATHS)) {
      failures.push('canonical build order does not cover the six expected paths');
    }
  } catch { failures.push('canonical build order unavailable'); }
  const completePreview = Array.isArray(previewHashes) && previewHashes.length === EXPECTED_PATHS.length
    && previewHashes.every(row => row && EXPECTED_PATHS.includes(row.path) && DIGEST_PATTERN.test(row.sha256))
    && new Set(previewHashes.map(row => row.path)).size === EXPECTED_PATHS.length;
  if (!completePreview) failures.push('complete six-file preview is unavailable');
  const previewByPath = new Map(completePreview ? previewHashes.map(row => [row.path, row.sha256]) : []);
  const perFile = [];
  for (const [index, row] of generations.entries()) {
    const terminal = row.terminal;
    const targetPath = generationPaths[index] ?? null;
    const complete = row.method === 'POST' && row.model === model && row.status === 200
      && row.responseTruncated === false && terminal?.done === true
      && terminal?.done_reason === 'stop';
    if (!complete) failures.push(`generation ${index + 1} incomplete`);
    const identityMatched = terminal?.model === model
      && (terminal?.model_digest_sha256 || terminal?.digest) === digest
      && terminal?.provider_version === version;
    if (!identityMatched) failures.push(`generation ${index + 1} identity mismatch`);
    let outputSha256 = null;
    try {
      const content = JSON.parse(terminal?.message?.content);
      if (typeof content.afterContent !== 'string') throw new Error('missing afterContent');
      outputSha256 = sha256(content.afterContent);
    } catch { failures.push(`generation ${index + 1} has no complete afterContent`); }
    const previewSha256 = targetPath === null ? null : previewByPath.get(targetPath) ?? null;
    const outputPreviewMatch = outputSha256 !== null && previewSha256 !== null && outputSha256 === previewSha256;
    if (completePreview && !outputPreviewMatch) failures.push(`generation ${index + 1} ${targetPath ?? '(unknown path)'} differs from its preview`);
    perFile.push({ generation: index + 1, targetPath, requestSha256: row.requestSha256 ?? null,
      outputSha256, previewSha256, complete, identityMatched, outputPreviewMatch });
  }
  return { valid: failures.length === 0, observed: generations.length, expected: EXPECTED_PATHS.length,
    previewCompared: completePreview, generationPaths, perFile, failures };
}

function providerRelay(socketPath) {
  return http.createServer((incoming, outgoing) => {
    const forwarded = http.request({ socketPath, path: incoming.url, method: incoming.method,
      headers: JSON_HEADERS }, response => {
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    forwarded.on('error', error => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(error.message); });
    incoming.pipe(forwarded);
  });
}

async function runInside(configurationPath) {
  const cfg = JSON.parse(fs.readFileSync(configurationPath, 'utf8'));
  const out = path.dirname(configurationPath);
  assert.deepEqual(sourceObservation(), cfg.source, 'exact clean source and frozen oracle after namespace entry');
  execFileSync('/usr/sbin/ip', ['link', 'set', 'lo', 'up']);
  const interfaces = JSON.parse(execFileSync('/usr/sbin/ip', ['-j', 'address'], { encoding: 'utf8' }));
  assert.deepEqual(interfaces.map(item => item.ifname), ['lo'], 'namespace has loopback only');
  const relay = providerRelay(cfg.socketPath);
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${relay.address().port}`;
  const runtime = makeRuntime(out);
  const project = path.join(runtime.projects, 'expense-ledger');
  const evidence = { status: 'RUNNING', source: cfg.source, model: cfg.model, digest: cfg.digest,
    startedAt: new Date().toISOString(), networkInterfaces: interfaces.map(item => item.ifname),
    project, databasePath: runtime.database, generatedPaths: EXPECTED_PATHS,
    acceptanceOracleSha256: ORACLE_SHA256, subjectProbeSha256: PROBE_SHA256,
    validatorProbeSha256: VALIDATE_SHA256,
    entrypointSha256: ENTRY_SHA256,
    scope: 'actual backend project and conversation registration, physical CODE draft, exact M2 approval, sandboxed functional app and restart' };
  let server = null;
  const start = async () => {
    server = await startServer(runtime, randomBytes(20).toString('hex'), providerUrl,
      { CHAT: cfg.model, CODE: cfg.model, D1: cfg.model });
    (evidence.serverPids ||= []).push(server.child.pid);
  };
  const stop = async () => {
    if (!server) return;
    const stopped = server;
    await stopServer(stopped);
    assert.equal(stopped.exitCode, 0, 'owned backend must exit cleanly');
    assert.equal(stopped.signal, null, 'owned backend must not die by signal');
    server = null;
  };
  const ask = (method, url, body, timeout) => requestJson(server, method, url, body, timeout);
  try {
    await start();
    const created = assertResponse(await ask('POST', '/api/projects', {
      name: 'Expense Ledger Qualification', description: 'Six-file dependency-free Node ledger',
      type: 'general', path: project,
    }), 201, 'create private project');
    const projectId = created.project?.id;
    assert.ok(Number.isSafeInteger(projectId), 'project id');
    assert.equal(fs.realpathSync(created.path), project, 'created project stays in private runtime');
    const policyPath = path.join(project, '.intentsmith/m2-governance-policy.json');
    const policy = policyForFrozenOracle(JSON.parse(fs.readFileSync(policyPath, 'utf8')));
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
    const policySha256 = sha256(fs.readFileSync(policyPath));
    fs.writeFileSync(path.join(project, ORACLE_PATH), ORACLE_SOURCE);
    fs.writeFileSync(path.join(project, PROBE_PATH), PROBE_SOURCE);
    fs.writeFileSync(path.join(project, VALIDATE_PATH), VALIDATE_SOURCE);
    fs.writeFileSync(path.join(project, ENTRY_PATH), ENTRY_SOURCE);
    assertFrozenProject(project, policySha256);
    git(project, ['add', '--', ORACLE_PATH, PROBE_PATH, VALIDATE_PATH,
      ENTRY_PATH, '.intentsmith/m2-governance-policy.json']);
    git(project, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
      '-c', 'user.name=IntentSmith Qualification', '-c', 'user.email=qualification@example.invalid',
      'commit', '-m', 'Freeze independent ledger acceptance before inference']);
    const baselineHead = git(project, ['rev-parse', 'HEAD']);
    assert.equal(git(project, ['status', '--porcelain=v1']), '');
    evidence.baselineHead = baselineHead;
    evidence.oracleFrozenAt = new Date().toISOString();
    save(out, 'before-model.json', { source: cfg.source, projectId, baselineHead,
      oracleSha256: ORACLE_SHA256, probeSha256: PROBE_SHA256,
      validatorProbeSha256: VALIDATE_SHA256,
      entrySha256: ENTRY_SHA256, policySha256,
      generatedPaths: EXPECTED_PATHS });

    const conversation = assertResponse(await ask('POST', '/api/conversations', {
      title: 'Six-file expense ledger', project_id: projectId,
    }), 201, 'create project conversation').conversation;
    assert.ok(typeof conversation.id === 'string' && conversation.id.startsWith('conv-')
      && conversation.id.length <= 128, 'durable string conversation id');
    assert.equal(conversation.project_id, projectId, 'M1 conversation stays bound to project');
    const origin = { surface: 'http', sessionId: `app-${randomUUID()}`,
      conversationId: conversation.id, projectId };
    evidence.origin = origin;
    const blueprint = ledgerBlueprint();
    const drafted = assertResponse(await ask('POST', '/api/m2/lifecycle/draft', {
      projectId, origin, draft: blueprint,
    }, 900_000), 200, 'six-file physical CODE draft');
    assert.equal(drafted.state, 'awaiting_approval');
    assert.match(drafted.planDigest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(drafted.plan.focusedTest.argv, ORACLE_ARGV);
    assert.equal(drafted.plan.focusedTest.binary, ORACLE_BINARY);
    assertLedgerPreview(drafted.diff, project,
      (root, relative) => fs.readFileSync(path.join(root, relative)),
      (root, relative) => fs.existsSync(path.join(root, relative)));
    assertFrozenProject(project, policySha256);
    assert.equal(git(project, ['rev-parse', 'HEAD']), baselineHead);
    assert.equal(git(project, ['status', '--porcelain=v1']), '');
    save(out, 'draft.json', drafted);
    evidence.lifecycleId = drafted.lifecycleId;
    evidence.planDigest = drafted.planDigest;
    evidence.previewHashes = drafted.diff.map(row => ({ path: row.path, sha256: sha256(row.after.content) }));

    const wrong = await ask('POST', '/api/m2/lifecycle/approve', {
      lifecycleId: drafted.lifecycleId, planDigest: `sha256:${'0'.repeat(64)}`, origin,
    });
    assert.equal(wrong.statusCode, 409, 'wrong digest rejects before effect');
    assert.equal(git(project, ['status', '--porcelain=v1']), '');
    assertFrozenProject(project, policySha256);
    const statusPath = `/api/m2/lifecycle/status?${new URLSearchParams({ id: drafted.lifecycleId,
      surface: origin.surface, sessionId: origin.sessionId, conversationId: origin.conversationId,
      projectId: String(projectId) })}`;
    await stop();
    await start();
    const restoredPending = assertResponse(await ask('GET', statusPath), 200, 'pending status after restart');
    assert.equal(restoredPending.state, 'awaiting_approval');
    assert.equal(restoredPending.planDigest, drafted.planDigest);
    assertFrozenProject(project, policySha256);
    const approval = { lifecycleId: drafted.lifecycleId, planDigest: drafted.planDigest, origin };
    const terminal = assertResponse(await ask('POST', '/api/m2/lifecycle/approve', approval, 180_000),
      200, 'exact approval');
    evidence.terminal = terminal;
    save(out, 'terminal.json', terminal);
    assert.equal(terminal.state, 'succeeded', JSON.stringify(terminal.result));
    assert.equal(terminal.result?.focusedTest?.terminalStatus, 'succeeded', 'frozen app oracle passed within M2 sandbox');
    const testOutput = terminal.audit?.executionEvents?.find(event => event.type === 'process_terminated')?.details?.testOutput;
    assert.match(testOutput?.stdout || '', /PROJECT_APP_ORACLE_PASS/, 'M2 ran the exact frozen oracle process');
    assert.equal(terminal.result?.git?.status, 'committed', 'all six approved files committed');
    assertFrozenProject(project, policySha256);
    const snapshot = fileSnapshot(project, drafted.diff);
    const committedHead = git(project, ['rev-parse', 'HEAD']);
    assert.notEqual(committedHead, baselineHead);
    assert.equal(git(project, ['status', '--porcelain=v1']), '');
    evidence.committedHead = committedHead;
    evidence.files = snapshot;
    evidence.binding = observedBinding(runtime.database, cfg.model, cfg.digest);

    await stop();
    await start();
    const durable = assertResponse(await ask('GET', statusPath), 200, 'terminal after restart');
    assert.deepEqual(durable.terminal, terminal.terminal, 'durable terminal after restart');
    assert.deepEqual(durable.result, terminal.result, 'durable result after restart');
    const repeat = assertResponse(await ask('POST', '/api/m2/lifecycle/approve', approval), 200,
      'repeat exact approval');
    assert.deepEqual(repeat, durable, 'approval replay has same durable result');
    assert.deepEqual(fileSnapshot(project, drafted.diff), snapshot, 'files unchanged across restart/replay');
    assert.equal(git(project, ['rev-parse', 'HEAD']), committedHead);
    assert.equal(git(project, ['status', '--porcelain=v1']), '');
    assertFrozenProject(project, policySha256);
    evidence.postRestartApp = await verifyApplication(project, runtime.artifacts);
    evidence.bindingAfterRestart = observedBinding(runtime.database, cfg.model, cfg.digest);
    assert.deepEqual(evidence.bindingAfterRestart, evidence.binding);
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL';
    evidence.error = { message: error.message, stack: error.stack };
  } finally {
    try { await stop(); } catch (error) { evidence.status = 'FAIL'; evidence.stopError = error.message; }
    relay.closeAllConnections();
    await new Promise(resolve => relay.close(resolve));
    evidence.completedAt = new Date().toISOString();
    save(out, 'app-journey.json', evidence);
  }
  assert.equal(evidence.status, 'PASS', evidence.error?.message || evidence.stopError);
}

function safeBaseEnvironment() {
  return Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ'].filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]));
}

async function runParent(options) {
  const source = sourceObservation();
  assert.equal(source.head, options.sourceSha, 'live source SHA differs from explicit pin');
  assert.equal(source.dirty, '', 'source must be clean before physical evaluation');
  const runtime = nativeRuntimeObservation();
  assert.equal(runtime.available, true, `native SQLite is unavailable for ${runtime.node}: ${runtime.error}`);
  const out = newOutputDirectory(options.out);
  const evidence = { status: 'RUNNING', startedAt: new Date().toISOString(), source,
    runtime, model: options.model, digest: options.digest, oracleSha256: ORACLE_SHA256,
    scope: 'physical six-file app; no installed IDE renderer acceptance claim' };
  let lease = null, proxy = null, socketRoot = null, child = null, loaded = false;
  const requests = [];
  const upstreamOrigin = 'http://127.0.0.1:11434';
  const upstream = async endpoint => {
    const response = await fetch(upstreamOrigin + endpoint, { signal: AbortSignal.timeout(5_000) });
    assert.ok(response.ok, `provider ${endpoint}: ${response.status}`);
    return response.json();
  };
  try {
    lease = acquireGpuEvaluationLock({ command: 'six-file functional project acceptance' });
    const ps = await upstream('/api/ps');
    const compute = execFileSync('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader'],
      { encoding: 'utf8' }).trim();
    const mem = /^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    const disk = fs.statfsSync(SOURCE_ROOT);
    const ready = assessScheduledEvaluationReadiness({ residentModels: ps.models.map(item => item.name),
      computeProcesses: compute ? compute.split('\n') : [], memoryAvailableBytes: Number(mem?.[1]) * 1024,
      diskAvailableBytes: disk.bavail * disk.bsize });
    evidence.providerPreflight = ready;
    assert.ok(ready.ready, JSON.stringify(ready.reasons));
    const inventory = await upstream('/api/tags');
    assert.equal(inventory.models.find(item => item.name === options.model)?.digest, options.digest,
      'installed exact model digest');
    const version = await upstream('/api/version');
    evidence.providerVersion = version.version;
    socketRoot = fs.mkdtempSync('/tmp/is-project-app-');
    fs.chmodSync(socketRoot, 0o700);
    const socketPath = path.join(socketRoot, 'provider.sock');
    proxy = http.createServer(async (incoming, outgoing) => {
      let row;
      try {
        const chunks = []; let bytes = 0;
        for await (const chunk of incoming) { bytes += chunk.length; assert.ok(bytes <= 1_000_000); chunks.push(chunk); }
        const payload = Buffer.concat(chunks);
        const body = payload.length ? JSON.parse(payload) : null;
        row = { at: new Date().toISOString(), method: incoming.method, path: incoming.url,
          requestSha256: sha256(payload), model: body?.model ?? body?.name ?? null,
          numCtx: body?.options?.num_ctx ?? body?.num_ctx ?? null,
          maxTokens: body?.options?.num_predict ?? body?.num_predict ?? null,
          stream: body?.stream ?? null };
        requests.push(row);
        const read = incoming.method === 'GET' && ['/api/tags', '/api/ps', '/api/version'].includes(incoming.url);
        const modelCall = incoming.method === 'POST' && ['/api/chat', '/api/generate'].includes(incoming.url)
          && body?.model === options.model;
        const show = incoming.method === 'POST' && incoming.url === '/api/show'
          && (body?.model || body?.name) === options.model;
        assert.ok(read || modelCall || show, 'provider request outside exact model scope');
        if (modelCall) loaded = true;
        const request = http.request({ hostname: '127.0.0.1', port: 11434,
          path: incoming.url, method: incoming.method,
          headers: { ...JSON_HEADERS, 'Content-Length': payload.length } }, response => {
          row.status = response.statusCode;
          outgoing.writeHead(response.statusCode, response.headers);
          const received = []; let total = 0;
          response.on('data', chunk => { total += chunk.length; if (total <= 16_000_000) received.push(chunk); });
          response.on('end', () => {
            row.responseBytes = total;
            row.responseTruncated = total > 16_000_000;
            const raw = Buffer.concat(received);
            row.responseSha256 = row.responseTruncated ? null : sha256(raw);
            try { row.terminal = JSON.parse(raw); }
            catch { row.terminal = raw.toString().trim().split('\n').map(line => {
              try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean).at(-1) ?? null; }
          });
          response.pipe(outgoing);
        });
        request.setTimeout(180_000, () => request.destroy(new Error('bounded provider timeout')));
        request.on('error', error => { row.error = error.message;
          if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
        request.end(payload);
      } catch (error) {
        if (row) row.error = error.message;
        if (!outgoing.headersSent) outgoing.writeHead(403);
        outgoing.end();
      }
    });
    await new Promise(resolve => proxy.listen(socketPath, resolve));
    fs.chmodSync(socketPath, 0o600);
    save(out, 'inside-configuration.json', { source, model: options.model, digest: options.digest, socketPath });
    child = spawn('unshare', ['--user', '--map-root-user', '--net', '--', 'bwrap', '--bind', '/', '/',
      '--dev', '/dev', '--die-with-parent', process.execPath, SELF, '--inside', path.join(out, 'inside-configuration.json')],
    { cwd: SOURCE_ROOT, env: safeBaseEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    child.stdout.on('data', chunk => { output.stdout = (output.stdout + chunk).slice(-100_000); });
    child.stderr.on('data', chunk => { output.stderr = (output.stderr + chunk).slice(-100_000); });
    const exit = await new Promise((resolve, reject) => { child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal })); });
    evidence.child = { ...exit, ...output };
    const insidePath = path.join(out, 'app-journey.json');
    const inside = fs.existsSync(insidePath) ? JSON.parse(fs.readFileSync(insidePath, 'utf8')) : null;
    evidence.insideStatus = inside?.status ?? 'MISSING';
    evidence.providerAttestation = assessProviderGenerations(requests, {
      model: options.model, digest: options.digest, version: evidence.providerVersion,
      previewHashes: inside?.previewHashes ?? null,
    });
    evidence.physicalGenerationsObserved = evidence.providerAttestation.observed;
    assert.equal(exit.code, 0, output.stderr);
    assert.equal(exit.signal, null);
    assert.equal(evidence.providerAttestation.valid, true, JSON.stringify(evidence.providerAttestation.failures));
    evidence.physicalGenerations = evidence.providerAttestation.observed;
    assert.ok(inside, 'private child journey evidence missing');
    assert.equal(inside.status, 'PASS', inside.error?.message);
    evidence.insideStatus = inside.status;
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = { message: error.message, stack: error.stack };
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    if (!evidence.providerAttestation) {
      let previewHashes = null;
      try { previewHashes = JSON.parse(fs.readFileSync(path.join(out, 'app-journey.json'), 'utf8')).previewHashes ?? null; }
      catch { /* no completed child journey */ }
      evidence.providerAttestation = assessProviderGenerations(requests, {
        model: options.model, digest: options.digest, version: evidence.providerVersion,
        previewHashes,
      });
      evidence.physicalGenerationsObserved = evidence.providerAttestation.observed;
    }
    if (!evidence.providerAttestation.valid) evidence.status = 'FAIL';
    if (loaded) {
      try {
        const ps = await upstream('/api/ps');
        assert.ok(ps.models.every(item => item.name === options.model && item.digest === options.digest),
          'no foreign resident model before unloading owned model');
        const response = await fetch(upstreamOrigin + '/api/generate', { method: 'POST', headers: JSON_HEADERS,
          body: JSON.stringify({ model: options.model, keep_alive: 0 }), signal: AbortSignal.timeout(30_000) });
        assert.ok(response.ok); await response.text(); evidence.ownedModelUnloaded = true;
      } catch (error) { evidence.status = 'FAIL'; evidence.cleanupError = error.message; }
    }
    if (socketRoot) fs.rmSync(socketRoot, { recursive: true, force: true });
    if (lease) {
      evidence.gpuLeaseReleased = lease.release();
      if (!evidence.gpuLeaseReleased) evidence.status = 'FAIL';
    }
    const afterSource = sourceObservation();
    evidence.sourceCleanAfter = afterSource.dirty === ''
      && JSON.stringify(afterSource) === JSON.stringify(source);
    if (!evidence.sourceCleanAfter) evidence.status = 'FAIL';
    evidence.completedAt = new Date().toISOString();
    save(out, 'provider-requests.json', requests);
    save(out, 'result.json', evidence);
  }
  console.log(JSON.stringify({ status: evidence.status, evidence: path.join(out, 'result.json') }));
  if (evidence.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try {
    if (process.argv[2] === '--inside' && process.argv.length === 4) {
      await runInside(process.argv[3]);
    } else {
      const options = parseOptions(process.argv.slice(2));
      if (options.mode === 'preflight') {
        console.log(JSON.stringify({ status: 'LIVE_NOT_RUN', source: sourceObservation(),
          runtime: nativeRuntimeObservation(),
          liveRequires: ['clean exact source SHA', 'new private artifact directory', 'exact installed CODE tag and digest',
            'idle provider/GPU and evaluation lock', 'unshare/bwrap/prlimit', 'owned private project and DB'] }, null, 2));
      } else {
        await runParent(options);
      }
    }
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
