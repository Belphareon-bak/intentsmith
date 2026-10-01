#!/usr/bin/env node
// Offline, owned-code controls for the frozen app oracles. No model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { processSandboxProvider } from '../src/execution/process-sandbox-provider.js';
import { LINUX_BWRAP_READ_ONLY_PROFILE } from '../src/execution/process-supervisor-child.js';
import { computeM2ExecutionValueDigest } from '../contracts/m2/execution-v1.js';
import { compileCodeDraftInput } from '../src/lifecycle/m2-code-draft.js';
import { assessProviderGenerations, requireProviderVersion } from '../scripts/run-project-app-journey.js';
import { assessRevisionGenerations, assertRetainedRevision, assertSchemaFailure } from '../scripts/project-app-revision.js';
import { REFERENCE_LEDGER_OUTPUTS as GOOD } from './helpers/project-app-reference.js';
import { REFERENCE_TASKFLOW_OUTPUTS, taskflowMutant } from './helpers/project-taskflow-reference.js';
import { REFERENCE_SQLITE_OUTPUTS, sqliteCatalogMutant } from './helpers/project-sqlite-catalog-reference.js';
import {
  LEDGER_FILES, ORACLE_PATH, ORACLE_BINARY, ORACLE_ARGV, ORACLE_SOURCE, ORACLE_SHA256,
  PROBE_PATH, PROBE_SOURCE, PROBE_SHA256, VALIDATE_PATH, VALIDATE_SOURCE,
  VALIDATE_SHA256, ENTRY_PATH,
  ENTRY_SOURCE, ENTRY_SHA256, sha256, ledgerBlueprint, assertLedgerCLIResults,
} from '../scripts/project-app-acceptance.js';
import { TASKFLOW_FILES, TASKFLOW_ORACLE_ARGV, TASKFLOW_ORACLE_SOURCE, TASKFLOW_ORACLE_SHA256,
  TASKFLOW_PROBE_SOURCE, TASKFLOW_PROBE_SHA256, TASKFLOW_VALIDATE_SOURCE, TASKFLOW_VALIDATE_SHA256,
  taskflowBlueprint, TASKFLOW_COMMANDS, assertTaskFlowCLIResults,
} from '../scripts/project-taskflow-acceptance.js';
import { SQLITE_FILES, SQLITE_ORACLE_SOURCE, SQLITE_ORACLE_SHA256, SQLITE_ORACLE_ARGV,
  SQLITE_ENTRY_SOURCE, SQLITE_ENTRY_SHA256, sqliteCatalogBlueprint, assertSqlitePreview,
} from '../scripts/project-sqlite-catalog-acceptance.js';

function project(outputs = GOOD, frozen = null) {
  const root = fs.mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'app-oracle-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true,"type":"module"}\n');
  for (const [relative, content] of Object.entries({ ...outputs, [ORACLE_PATH]: frozen?.oracle ?? ORACLE_SOURCE,
    [PROBE_PATH]: frozen?.probe ?? PROBE_SOURCE, [VALIDATE_PATH]: frozen?.validate ?? VALIDATE_SOURCE,
    [ENTRY_PATH]: frozen?.entry ?? ENTRY_SOURCE })) {
    fs.writeFileSync(path.join(root, relative), content);
  }
  return root;
}

const taskflowFrozen = Object.freeze({ oracle: TASKFLOW_ORACLE_SOURCE,
  probe: TASKFLOW_PROBE_SOURCE, validate: TASKFLOW_VALIDATE_SOURCE });

async function inSandbox(root, argv) {
  const environment = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' };
  return processSandboxProvider.run({
    sandboxProfile: LINUX_BWRAP_READ_ONLY_PROFILE,
    projectRoot: root, canonicalCwd: root, binary: ORACLE_BINARY, argv,
    argvDigest: computeM2ExecutionValueDigest(argv),
    environment, environmentDigest: computeM2ExecutionValueDigest(environment),
    timeoutMs: 30_000, expectedExitCode: 0,
  }, {
    recordSupervisorIdentity: identity => {
      const file = path.join(isolatedTestRuntime.artifacts, `app-sandbox-${randomUUID()}.json`);
      const handle = fs.openSync(file, 'wx', 0o600);
      try { fs.writeSync(handle, JSON.stringify(identity) + '\n'); fs.fsyncSync(handle); }
      finally { fs.closeSync(handle); }
      const directory = fs.openSync(isolatedTestRuntime.artifacts, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      return { durable: true };
    },
  });
}

test('frozen independent acceptance has exact six-file scope and model cannot replace its path', () => {
  const blueprint = ledgerBlueprint();
  assert.deepEqual(blueprint.files.map(file => file.path), LEDGER_FILES.map(file => file.path));
  assert.deepEqual(blueprint.focusedTest.argv, ORACLE_ARGV);
  assert.equal(blueprint.focusedTest.binary, ORACLE_BINARY);
  assert.equal(blueprint.files.some(file => [ORACLE_PATH, PROBE_PATH, VALIDATE_PATH, ENTRY_PATH].includes(file.path)), false);
  assert.equal(sha256(ORACLE_SOURCE), ORACLE_SHA256);
  assert.equal(sha256(PROBE_SOURCE), PROBE_SHA256);
  assert.equal(sha256(VALIDATE_SOURCE), VALIDATE_SHA256);
  assert.equal(sha256(ENTRY_SOURCE), ENTRY_SHA256);
});

test('manual runner defaults to no-inference preflight and requires all live pins', () => {
  const runner = path.join(isolatedTestRuntime.repositoryRoot, 'scripts/run-project-app-journey.js');
  const preflight = spawnSync(process.execPath, [runner], {
    cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(preflight.status, 0, preflight.stderr);
  const result = JSON.parse(preflight.stdout);
  assert.equal(result.status, 'LIVE_NOT_RUN');
  assert.equal(result.source.oracleSha256, ORACLE_SHA256);
  const incomplete = spawnSync(process.execPath, [runner, '--live'], {
    cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /Usage: --live/);
});

test('actual inside source guard accepts JSON transport for three fixed scenarios and rejects changed hashes', () => {
  const runner = path.join(isolatedTestRuntime.repositoryRoot, 'scripts/run-project-app-journey.js');
  for (const scenarioId of ['ledger', 'taskflow', 'sqlite-catalog']) {
    const argv = scenarioId === 'ledger' ? ['--preflight'] : ['--scenario', scenarioId, '--preflight'];
    const preflight = spawnSync(process.execPath, [runner, ...argv], {
      cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(preflight.status, 0, `${scenarioId}: ${preflight.stderr}`);
    const { source } = JSON.parse(preflight.stdout);
    assert.equal(Object.hasOwn(source, 'probeSha256'), scenarioId !== 'sqlite-catalog');
    assert.equal(Object.hasOwn(source, 'validatorProbeSha256'), scenarioId !== 'sqlite-catalog');
    if (scenarioId === 'ledger') {
      assert.equal(source.probeSha256, PROBE_SHA256);
      assert.equal(source.validatorProbeSha256, VALIDATE_SHA256);
    } else if (scenarioId === 'taskflow') {
      assert.equal(source.probeSha256, TASKFLOW_PROBE_SHA256);
      assert.equal(source.validatorProbeSha256, TASKFLOW_VALIDATE_SHA256);
    }
    const root = fs.mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'app-source-guard-'));
    const config = path.join(root, 'inside-configuration.json');
    const check = candidate => {
      fs.writeFileSync(config, JSON.stringify({ scenarioId, source: candidate }) + '\n');
      return spawnSync(process.execPath, [runner, '--inside-source-check', config], {
        cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000,
      });
    };
    const accepted = check(source);
    assert.equal(accepted.status, 0, `${scenarioId}: ${accepted.stderr}`);
    assert.deepEqual(JSON.parse(accepted.stdout), { status: 'SOURCE_CHECK_PASS', scenarioId, source });
    for (const field of ['probeSha256', 'validatorProbeSha256']) {
      const rejected = check({ ...source, [field]: '0'.repeat(64) });
      assert.equal(rejected.status, 1, `${scenarioId}: changed ${field} must fail closed`);
      assert.match(rejected.stderr, /exact clean source and frozen oracle after namespace entry/);
    }
    assert.deepEqual(fs.readdirSync(root), ['inside-configuration.json'],
      'source guard must finish before any runtime or DB allocation');
  }
});

test('real separate sandbox process accepts correct six-file app and CLI output', async () => {
  const root = project();
  const oracle = await inSandbox(root, ORACLE_ARGV);
  assert.equal(oracle.terminalStatus, 'succeeded', JSON.stringify(oracle));
  assert.match(oracle.stdout, /PROJECT_APP_ORACLE_PASS/);
  const argv = [ENTRY_PATH, JSON.stringify([
    ['add', 12.5, 'food'], ['add', 7.25, 'travel'], ['add', 3.5, 'food'],
    ['total'], ['categories'], ['list'],
  ])];
  const cli = await inSandbox(root, argv);
  assert.equal(cli.terminalStatus, 'succeeded', JSON.stringify(cli));
  assertLedgerCLIResults(JSON.parse(cli.stdout.trim()));
  const fresh = await inSandbox(root, [ENTRY_PATH, JSON.stringify([['list'], ['total'], ['categories']])]);
  assert.equal(fresh.terminalStatus, 'succeeded', JSON.stringify(fresh));
  assert.deepEqual(JSON.parse(fresh.stdout.trim()), [[], 0, {}]);
});

test('wrong total and grouped totals independently fail the frozen oracle', async () => {
  for (const [name, replacement, expected] of [
    ['total', GOOD['src/totals.js'].replace('sum + row.amount', 'sum + 1'), /sum must use all three decimal amounts/],
    ['categories', GOOD['src/totals.js'].replace('(result[row.category] ?? 0) + row.amount', '(result[row.category] ?? 0) + 1'), /category sums/],
  ]) {
    const root = project({ ...GOOD, 'src/totals.js': replacement });
    const result = await inSandbox(root, ORACLE_ARGV);
    assert.equal(result.terminalStatus, 'failed', `${name}: ${JSON.stringify(result)}`);
    assert.match(result.stderr, expected, name);
  }
});

test('fixed TaskFlow compiler scope and preflight freeze a separate operator oracle', () => {
  const blueprint = taskflowBlueprint();
  assert.deepEqual(blueprint.files.map(file => file.path), TASKFLOW_FILES.map(file => file.path));
  assert.deepEqual(blueprint.focusedTest.argv, TASKFLOW_ORACLE_ARGV);
  assert.equal(blueprint.focusedTest.binary, ORACLE_BINARY);
  assert.equal(blueprint.files.some(file => [ORACLE_PATH, PROBE_PATH, VALIDATE_PATH, ENTRY_PATH].includes(file.path)), false);
  assert.equal(sha256(TASKFLOW_ORACLE_SOURCE), TASKFLOW_ORACLE_SHA256);
  assert.equal(sha256(TASKFLOW_PROBE_SOURCE), TASKFLOW_PROBE_SHA256);
  assert.equal(sha256(TASKFLOW_VALIDATE_SOURCE), TASKFLOW_VALIDATE_SHA256);
  const runner = path.join(isolatedTestRuntime.repositoryRoot, 'scripts/run-project-app-journey.js');
  const result = spawnSync(process.execPath, [runner, '--scenario', 'taskflow', '--preflight'],
    { cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  const preflight = JSON.parse(result.stdout);
  assert.equal(preflight.status, 'LIVE_NOT_RUN');
  assert.equal(preflight.scenarioId, 'taskflow');
  assert.equal(preflight.source.oracleSha256, TASKFLOW_ORACLE_SHA256);
  assert.deepEqual(preflight.source.generatedPaths, TASKFLOW_FILES.map(file => file.path).sort());
});

test('TaskFlow reference runs in actual separate M2 sandbox with functional CLI and fresh process', async () => {
  const root = project(REFERENCE_TASKFLOW_OUTPUTS, taskflowFrozen);
  const oracle = await inSandbox(root, TASKFLOW_ORACLE_ARGV);
  assert.equal(oracle.terminalStatus, 'succeeded', JSON.stringify(oracle));
  assert.match(oracle.stdout, /TASKFLOW_APP_ORACLE_PASS/);
  const cli = await inSandbox(root, [ENTRY_PATH, JSON.stringify(TASKFLOW_COMMANDS)]);
  assert.equal(cli.terminalStatus, 'succeeded', JSON.stringify(cli));
  assertTaskFlowCLIResults(JSON.parse(cli.stdout.trim()));
  const fresh = await inSandbox(root, [ENTRY_PATH, JSON.stringify([['list'], ['list', { status: 'done' }]])]);
  assert.equal(fresh.terminalStatus, 'succeeded', JSON.stringify(fresh));
  assert.deepEqual(JSON.parse(fresh.stdout.trim()), [[], []]);
});

test('TaskFlow behavior mutants fail trusted oracle in actual separate sandbox', async () => {
  for (const defect of ['shared-board', 'accept-nonplain', 'accept-nonplain-options',
    'ignore-status', 'wrong-priority', 'recycle-id', 'skip-transition',
    'alias-rows', 'no-op-remove', 'ignore-update', 'last-result']) {
    const root = project(taskflowMutant(defect), taskflowFrozen);
    const result = await inSandbox(root, TASKFLOW_ORACLE_ARGV);
    assert.equal(result.terminalStatus, 'failed', `${defect}: ${JSON.stringify(result)}`);
    assert.doesNotMatch(result.stdout, /TASKFLOW_APP_ORACLE_PASS/, defect);
  }
});

test('SQLite catalog is a fixed seven-target compiler contract with pre-model frozen oracle', () => {
  const blueprint = sqliteCatalogBlueprint();
  assert.deepEqual(blueprint.files.map(file => file.path), SQLITE_FILES.map(file => file.path));
  assert.deepEqual(blueprint.focusedTest.argv, SQLITE_ORACLE_ARGV);
  assert.equal(blueprint.focusedTest.binary, ORACLE_BINARY);
  assert.ok(blueprint.files.every(file => Buffer.byteLength(file.instruction) <= 512));
  assert.ok(Buffer.byteLength(blueprint.instruction) <= 512);
  assert.equal(sha256(SQLITE_ORACLE_SOURCE), SQLITE_ORACLE_SHA256);
  assert.equal(sha256(SQLITE_ENTRY_SOURCE), SQLITE_ENTRY_SHA256);
  assert.ok(!blueprint.files.some(file => [ORACLE_PATH, ENTRY_PATH].includes(file.path)));
  const compiled = compileCodeDraftInput(blueprint);
  assert.deepEqual(compiled.buildSteps.map(step => compiled.changes[step.index].path).sort(),
    SQLITE_FILES.map(file => file.path).sort());
  const runner = path.join(isolatedTestRuntime.repositoryRoot, 'scripts/run-project-app-journey.js');
  const preflight = spawnSync(process.execPath, [runner, '--scenario', 'sqlite-catalog', '--preflight'],
    { cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000 });
  assert.equal(preflight.status, 0, preflight.stderr);
  const receipt = JSON.parse(preflight.stdout);
  assert.equal(receipt.status, 'LIVE_NOT_RUN');
  assert.equal(receipt.scenarioId, 'sqlite-catalog');
  assert.equal(receipt.source.oracleSha256, SQLITE_ORACLE_SHA256);
});

test('SQLite catalog reference passes trusted actual sandbox with fresh generated processes and direct DB reads', async () => {
  const root = project(REFERENCE_SQLITE_OUTPUTS, { oracle: SQLITE_ORACLE_SOURCE, entry: SQLITE_ENTRY_SOURCE });
  const result = await inSandbox(root, SQLITE_ORACLE_ARGV);
  assert.equal(result.terminalStatus, 'succeeded', JSON.stringify(result));
  assert.match(result.stdout, /SQLITE_CATALOG_ORACLE_PASS/);
});

for (const defect of ['schema-extra-import', 'schema-extra-reexport', 'cli-extra-import', 'store-extra-builtin']) {
  test('SQLite import graph rejects ' + defect, async () => {
    const root = project(sqliteCatalogMutant(defect), { oracle: SQLITE_ORACLE_SOURCE, entry: SQLITE_ENTRY_SOURCE });
    const result = await inSandbox(root, SQLITE_ORACLE_ARGV);
    assert.equal(result.terminalStatus, 'failed', defect + ': ' + JSON.stringify(result));
    assert.match(result.stderr, /SQLite declared dependencies/, defect);
    assert.doesNotMatch(result.stdout, /SQLITE_CATALOG_ORACLE_PASS/, defect);
  });
}

test('SQLite preview AST rejects dormant dynamic imports and accepts inert import text', () => {
  const read = (_root, relative) => relative === ORACLE_PATH ? SQLITE_ORACLE_SOURCE : SQLITE_ENTRY_SOURCE;
  const preview = outputs => Object.entries(outputs).map(([file, content]) => ({ path: file, after: { content } }));
  const inert = { ...REFERENCE_SQLITE_OUTPUTS,
    'src/schema.js': "// import('node:sqlite')\nconst text = \"import('node:sqlite')\";\nconst pattern = /import\\('node:sqlite'\\)/;\n" + REFERENCE_SQLITE_OUTPUTS['src/schema.js'] };
  assert.doesNotThrow(() => assertSqlitePreview(preview(inert), '/unused', read, () => false));
  for (const file of Object.keys(REFERENCE_SQLITE_OUTPUTS)) {
    const dynamic = { ...REFERENCE_SQLITE_OUTPUTS,
      [file]: REFERENCE_SQLITE_OUTPUTS[file] + "\nexport function dormant() { return import('node:sqlite'); }\n" };
    assert.throws(() => assertSqlitePreview(preview(dynamic), '/unused', read, () => false),
      /SQLite dynamic imports forbidden/);
  }
});

test('SQLite catalog behavioral mutants fail trusted actual sandbox', async () => {
  for (const defect of ['wrong-schema', 'masked-quantity-check', 'no-db', 'forged-stdout', 'early-exit',
    'wrong-update', 'wrong-delete', 'wrong-search', 'alias-query-rows',
    'invalid-mutation', 'coerce-id', 'nonpersistence']) {
    const root = project(sqliteCatalogMutant(defect), { oracle: SQLITE_ORACLE_SOURCE, entry: SQLITE_ENTRY_SOURCE });
    const result = await inSandbox(root, SQLITE_ORACLE_ARGV);
    assert.equal(result.terminalStatus, 'failed', `${defect}: ${JSON.stringify(result)}`);
    assert.doesNotMatch(result.stdout, /SQLITE_CATALOG_ORACLE_PASS/, defect);
  }
});

test('TaskFlow provider proof binds each generation to its canonical compiler target', () => {
  const compiled = compileCodeDraftInput(taskflowBlueprint());
  const paths = compiled.buildSteps.map(step => compiled.changes[step.index].path);
  assert.deepEqual(paths, ['src/query.js', 'src/validate.js', 'src/store.js', 'src/cli.js', 'src/app.js']);
  const model = 'qualification-model', digest = 'a'.repeat(64), version = '0.34.0';
  const requests = paths.map((target, index) => ({
    path: '/api/chat', method: 'POST', model, status: 200, responseTruncated: false,
    requestSha256: sha256(`request-${index}`), terminal: {
      done: true, done_reason: 'stop', model, model_digest_sha256: digest,
      provider_version: version, message: { content: JSON.stringify({ afterContent: REFERENCE_TASKFLOW_OUTPUTS[target] }) },
    },
  }));
  const previewHashes = Object.entries(REFERENCE_TASKFLOW_OUTPUTS)
    .map(([target, content]) => ({ path: target, sha256: sha256(content) }));
  const pins = { model, digest, version, previewHashes, scenarioId: 'taskflow' };
  const good = assessProviderGenerations(requests, pins);
  assert.equal(good.valid, true, JSON.stringify(good.failures));
  assert.equal(good.expected, 5);
  assert.ok(good.perFile.every(row => row.outputPreviewMatch));
  const swapped = previewHashes.map(row => ({ ...row }));
  const cli = swapped.find(row => row.path === 'src/cli.js');
  const app = swapped.find(row => row.path === 'src/app.js');
  [cli.sha256, app.sha256] = [app.sha256, cli.sha256];
  const wrong = assessProviderGenerations(requests, { ...pins, previewHashes: swapped });
  assert.equal(wrong.valid, false);
  assert.deepEqual(wrong.perFile.filter(row => !row.outputPreviewMatch).map(row => row.targetPath),
    ['src/cli.js', 'src/app.js']);
});

test('SQLite catalog provider proof binds seven compiler targets to preview bytes', () => {
  const compiled = compileCodeDraftInput(sqliteCatalogBlueprint());
  const paths = compiled.buildSteps.map(step => compiled.changes[step.index].path);
  assert.deepEqual(paths, ['src/query.js', 'src/schema.js', 'src/store.js',
    'src/validate.js', 'src/service.js', 'src/cli.js', 'src/app.js']);
  const model = 'qualification-model', digest = 'a'.repeat(64), version = '0.34.0';
  const requests = paths.map((target, index) => ({
    path: '/api/chat', method: 'POST', model, status: 200, responseTruncated: false,
    requestSha256: sha256(`sqlite-request-${index}`), terminal: {
      done: true, done_reason: 'stop', model, model_digest_sha256: digest,
      provider_version: version, message: { content: JSON.stringify({ afterContent: REFERENCE_SQLITE_OUTPUTS[target] }) },
    },
  }));
  const previewHashes = paths.map(target => ({ path: target, sha256: sha256(REFERENCE_SQLITE_OUTPUTS[target]) }));
  const pins = { model, digest, version, previewHashes, scenarioId: 'sqlite-catalog' };
  const good = assessProviderGenerations(requests, pins);
  assert.equal(good.valid, true, JSON.stringify(good.failures));
  assert.equal(good.expected, 7);
  assert.ok(good.perFile.every(row => row.outputPreviewMatch));
  const swapped = previewHashes.map(row => ({ ...row }));
  const cli = swapped.find(row => row.path === 'src/cli.js');
  const app = swapped.find(row => row.path === 'src/app.js');
  [cli.sha256, app.sha256] = [app.sha256, cli.sha256];
  const wrong = assessProviderGenerations(requests, { ...pins, previewHashes: swapped });
  assert.equal(wrong.valid, false);
  assert.deepEqual(wrong.perFile.filter(row => !row.outputPreviewMatch).map(row => row.targetPath),
    ['src/cli.js', 'src/app.js']);
});

test('provider proof rejects missing or invalid expected and terminal versions for all fixed apps', () => {
  for (const [scenarioId, blueprint, outputs] of [
    ['ledger', ledgerBlueprint, GOOD], ['taskflow', taskflowBlueprint, REFERENCE_TASKFLOW_OUTPUTS],
    ['sqlite-catalog', sqliteCatalogBlueprint, REFERENCE_SQLITE_OUTPUTS],
  ]) {
    const compiled = compileCodeDraftInput(blueprint());
    const paths = compiled.buildSteps.map(step => compiled.changes[step.index].path);
    const model = 'qualification-model', digest = 'a'.repeat(64);
    const rows = version => paths.map(target => ({ path: '/api/chat', method: 'POST', model,
      status: 200, responseTruncated: false, terminal: {
        done: true, done_reason: 'stop', model, model_digest_sha256: digest,
        provider_version: version, message: { content: JSON.stringify({ afterContent: outputs[target] }) },
      } }));
    const previewHashes = paths.map(target => ({ path: target, sha256: sha256(outputs[target]) }));
    for (const version of [undefined, null, '', ' ', 'unrecorded', '0.34', '0.34.0\n', ' 0.34.0']) {
      assert.throws(() => requireProviderVersion(version), /provider version/);
      assert.equal(assessProviderGenerations(rows(version), { model, digest, version, previewHashes, scenarioId }).valid,
        false, `${scenarioId}: invalid equal versions ${String(version)} must not attest`);
      assert.equal(assessProviderGenerations(rows(version), { model, digest, version: '0.34.0', previewHashes, scenarioId }).valid,
        false, `${scenarioId}: invalid terminal version ${String(version)}`);
    }
    assert.equal(assessProviderGenerations(rows('0.34.0'), { model, digest, version: '0.34.1', previewHashes, scenarioId }).valid,
      false, `${scenarioId}: exact provider version mismatch`);
    assert.equal(assessProviderGenerations(rows('0.34.0'), { model, digest, version: '0.34.0', previewHashes, scenarioId }).valid,
      true, `${scenarioId}: complete valid exact metadata`);
    assert.equal(requireProviderVersion('0.34.0'), '0.34.0');
  }
});

test('revision provider proof reconstructs the eighth replacement and rejects false provenance', () => {
  const original = sqliteCatalogMutant('schema-extra-import');
  const compiled = compileCodeDraftInput(sqliteCatalogBlueprint());
  const order = compiled.buildSteps.map(step => compiled.changes[step.index].path);
  const model = 'qualification-model', digest = 'a'.repeat(64), version = '0.34.0';
  const response = content => ({ method: 'POST', path: '/api/chat', model, status: 200,
    responseTruncated: false, terminal: { model, digest, provider_version: version, done: true,
      done_reason: 'stop', message: { content: JSON.stringify(content) } } });
  const requests = order.map(target => response({ afterContent: original[target] }));
  requests.push(response({ replacements: [{ before: "import { DatabaseSync } from 'node:sqlite';\n", after: '' }] }));
  const pins = { model, digest, version, scenarioId: 'sqlite-catalog',
    initialPreviewHashes: Object.entries(original).map(([path, content]) => ({ path, sha256: sha256(content) })),
    previewHashes: Object.entries(REFERENCE_SQLITE_OUTPUTS).map(([path, content]) => ({ path, sha256: sha256(content) })) };
  const proof = assessRevisionGenerations(requests, pins, assessProviderGenerations);
  assert.equal(proof.valid, true, JSON.stringify(proof.failures));
  assert.equal(proof.observed, 8); assert.equal(proof.perFile[7].outputPreviewMatch, true);
  for (const corrupt of ['retained', 'schema', 'digest', 'truncated', 'missing', 'extra']) {
    const changedRows = structuredClone(requests), changedPins = structuredClone(pins);
    if (corrupt === 'retained' || corrupt === 'schema') changedPins.previewHashes.find(row => row.path ===
      (corrupt === 'schema' ? 'src/schema.js' : 'src/query.js')).sha256 = 'b'.repeat(64);
    if (corrupt === 'digest') changedRows[7].terminal.digest = 'b'.repeat(64);
    if (corrupt === 'truncated') changedRows[7].terminal.done_reason = 'length';
    if (corrupt === 'missing') changedRows.pop();
    if (corrupt === 'extra') changedRows.push(changedRows[7]);
    assert.equal(assessRevisionGenerations(changedRows, changedPins, assessProviderGenerations).valid, false, corrupt);
  }
});

test('revision preserves all six unrelated module bytes', () => {
  const initial = Object.entries(sqliteCatalogMutant('schema-extra-import')).sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({ path, after: { content } }));
  const revised = Object.entries(REFERENCE_SQLITE_OUTPUTS).sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({ path, after: { content } }));
  assertRetainedRevision(initial, revised);
  const forged = structuredClone(revised); forged.find(row => row.path === 'src/cli.js').after.content += '// changed\n';
  assert.throws(() => assertRetainedRevision(initial, forged), /retained module bytes/);
  assert.throws(() => assertRetainedRevision(initial, initial), /Expected.*unequal|not.*equal/i);
});

test('schema revision requires a real AST dependency and cannot trust forged stderr', () => {
  const paths = Object.keys(REFERENCE_SQLITE_OUTPUTS).sort();
  const terminal = { state: 'failed', result: { errorCode: 'PROJECT_CHANGE_TEST_FAILED',
    focusedTest: { terminalStatus: 'failed' }, rollback: { status: 'succeeded', paths } },
    audit: { executionEvents: [{ type: 'process_terminated', details: { testOutput: {
      stderr: 'SQLite declared dependencies: src/schema.js',
    } } }] } };
  const diff = content => paths.map(path => ({ path, after: { content: path === 'src/schema.js'
    ? content : REFERENCE_SQLITE_OUTPUTS[path] } }));
  for (const inert of [REFERENCE_SQLITE_OUTPUTS['src/schema.js'],
    "// import './missing.js';\nexport const SCHEMA_SQL = 'import';\n",
    "export const pattern = /import/;\nexport const text = \"export * from './missing.js'\";\n",
  ]) assert.throws(() => assertSchemaFailure(terminal, paths, diff(inert)), /stderr is insufficient/);
  assertSchemaFailure(terminal, paths, diff("import './missing.js';\nexport const x = 1;\n"));
  assertSchemaFailure(terminal, paths, diff("export { x } from './missing.js';\n"));
});
