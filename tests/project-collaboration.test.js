import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { initializeNewProject, inspectProject, importedProjectWelcome, newProjectPolicy } from '../src/planner/project-onboarding.js';
import { discussProject, collectProjectWorkEvidence, fitProjectDiscussionPrompt, PROJECT_DISCUSSION_SYSTEM } from '../src/chat/handlers/project-collaboration.js';
import { createProjectRoutes } from '../src/routes/projects.js';
import { detectFileIntent } from '../src/chat/handlers/project.js';
import { validateM2GovernancePolicySnapshot } from '../contracts/m2/governance-v1.js';

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'is-project-flow-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'new-project');
  await initializeNewProject(root, { name: 'Fan monitor', description: 'RPM s historií' });
  return { id: 20260918, path: root, name: 'Fan monitor', description: 'RPM s historií', is_external: 0 };
}
function plan() {
  return { instruction: 'Read RPM and retain bounded history.', files: [
    { path: 'src/index.mjs', instruction: 'Export readRpm(reader) and retainHistory(samples, limit). Missing readings are null.', dependsOn: [] },
    { path: 'test/acceptance.test.mjs', instruction: 'Assert RPM parsing, missing values and bounded history.', dependsOn: ['src/index.mjs'] },
  ] };
}
function generated(value) { return { content: JSON.stringify(value), finishReason: 'stop' }; }

test('incremental project plans run both a new test file and the preserved acceptance suite', async t => {
  const project = await fixture(t);
  const previous = 'import test from "node:test"; test("existing behavior", () => {});\n';
  await fs.writeFile(path.join(project.path, 'test/acceptance.test.mjs'), previous);
  const next = { instruction: 'Add separately tested I/O support.', files: [
    { path: 'test/io.test.mjs', instruction: 'Assert the new I/O behavior.', dependsOn: [] },
  ] };
  const response = await discussProject('Add I/O with its own tests; preserve the existing suite.', { project }, {
    generate: async () => generated({ reply: 'A separate tested increment.', plan: next }),
  });
  const profile = response.metadata.projectWorkProposal.draft.focusedTest;
  const run = () => execFileSync(profile.binary, profile.argv, { cwd: project.path, encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) });
  await fs.writeFile(path.join(project.path, 'test/io.test.mjs'), 'import test from "node:test"; test("new behavior", () => { throw Error("new regression"); });\n');
  assert.throws(run, error => error.status === 1 && error.stdout.includes('new regression'));
  await fs.writeFile(path.join(project.path, 'test/io.test.mjs'), 'import test from "node:test"; test("new behavior", () => {});\n');
  assert.match(run(), /# pass 2/);
  assert.equal(await fs.readFile(path.join(project.path, 'test/acceptance.test.mjs'), 'utf8'), previous);
  await fs.writeFile(path.join(project.path, 'test/acceptance.test.mjs'), 'import test from "node:test"; test("existing behavior", () => { throw Error("old regression"); });\n');
  assert.throws(run, error => error.status === 1 && error.stdout.includes('old regression'));
});

test('new project has a clean Git baseline, canonical policy and a genuinely failing initial test', async t => {
  const project = await fixture(t);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
  assert.match(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project.path, encoding: 'utf8' }), /^[0-9a-f]{40}/);
  const analysis = await inspectProject(project);
  assert.equal(analysis.setup['.intentsmith/m2-governance-policy.json'], true);
  assert.ok(analysis.files.includes('test/acceptance.test.mjs'));
  assert.throws(() => execFileSync(process.execPath, ['--test', 'test/acceptance.test.mjs'], { cwd: project.path, stdio: 'pipe', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')) }), { status: 1 });
  await assert.rejects(initializeNewProject(project.path, { name: 'overwrite' }), { code: 'EEXIST' });
  assert.equal(JSON.parse(await fs.readFile(path.join(project.path, '.intentsmith/project.json'), 'utf8')).name, 'Fan monitor');
});

test('desktop is an explicit scaffold with no dependency install or GUI execution', async t => {
  const project = await fixture(t); const root = path.join(path.dirname(project.path), 'desktop');
  await initializeNewProject(root, { name: 'Monitor', description: 'Real hardware monitor', type: 'desktop' });
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const policy = JSON.parse(await fs.readFile(path.join(root, '.intentsmith/m2-governance-policy.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'electron src/index.mjs');
  assert.equal(pkg.devDependencies.electron, '42.11.3');
  assert.ok(policy.externalImports.includes('electron'));
  assert.ok(policy.externalImports.includes('node:child_process'));
  assert.ok(policy.layers[0].roots.includes('README.md'));
  assert.ok(!policy.layers[0].roots.includes('.intentsmith'));
  await assert.rejects(fs.stat(path.join(root, 'node_modules')), { code: 'ENOENT' });
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
});

test('both created project types satisfy the actual M2 governance policy contract', async t => {
  const project = await fixture(t);
  for (const type of ['general', 'desktop']) {
    const root = path.join(path.dirname(project.path), `policy-${type}`);
    await initializeNewProject(root, { name: type, type });
    const analysis = await inspectProject({ ...project, path: root });
    const policy = JSON.parse(await fs.readFile(path.join(root, '.intentsmith/m2-governance-policy.json'), 'utf8'));
    const result = validateM2GovernancePolicySnapshot({ ...policy,
      contract: 'GovernancePolicySnapshot', version: 1, projectId: project.id,
      workspaceRevision: analysis.revision, policyPath: '.intentsmith/m2-governance-policy.json',
    });
    assert.equal(result.valid, true, `${type}: ${result.errors.join(', ')}`);
  }
});

test('foreign repository inspection preserves files and presents scope and goal questions', async t => {
  const project = await fixture(t);
  const foreign = path.join(path.dirname(project.path), 'foreign');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'app.py'), 'def add(a, b): return a - b\n');
  const imported = { ...project, path: foreign, name: 'External', is_external: 1 };
  const before = await fs.readdir(foreign);
  const analysis = await inspectProject(imported);
  assert.deepEqual(await fs.readdir(foreign), before);
  assert.equal(await fs.readFile(path.join(foreign, 'app.py'), 'utf8'), 'def add(a, b): return a - b\n');
  assert.equal(analysis.excerpts[0].path, 'app.py');
  const welcome = importedProjectWelcome(imported, analysis);
  assert.match(welcome, /bez změn/); assert.match(welcome, /cíl projektu/);
  assert.match(welcome, /Chybí README/); assert.match(welcome, /nebyly nalezené testovací/);
  assert.doesNotMatch(welcome, /všechny fáze dokončené/);
  const response = await discussProject('Navrhni opravu', { project: imported }, {
    generate: async () => generated({ reply: 'Funkce add odčítá, místo aby sčítala. Chybí test.', plan: plan() }),
  });
  assert.equal(response.metadata.projectWorkProposal, null);
  assert.equal(response.metadata.projectSetupRequired, true);
  assert.match(response.content, /Git základ/);
  assert.deepEqual(await fs.readdir(foreign), before);
  await fs.writeFile(path.join(foreign, 'test_app.py'), 'def test_add(): assert 1 + 1 == 2\n');
  const withPythonTest = await inspectProject(imported);
  assert.ok(withPythonTest.facts.some(fact => fact.includes('testovací soubory')));
  assert.ok(!withPythonTest.gaps.some(gap => gap.includes('testovací soubory')));
});

test('inspection refuses escaped links and hard-linked contents', async t => {
  const project = await fixture(t);
  const outside = path.join(path.dirname(project.path), 'private.txt');
  await fs.writeFile(outside, 'UNTRUSTED_OUTSIDE_CANARY');
  await fs.symlink(outside, path.join(project.path, 'leak.txt'));
  await assert.rejects(inspectProject(project));
  await fs.unlink(path.join(project.path, 'leak.txt'));
  await fs.link(outside, path.join(project.path, 'leak.txt'));
  await assert.rejects(inspectProject(project));
});

test('a short continuation receives the same project, history and real evidence; proposal grants no effects', async t => {
  const project = await fixture(t);
  const before = await fs.readFile(path.join(project.path, 'src/index.mjs'), 'utf8');
  const response = await discussProject('a jak?', { project, conversationId: 'fan-conversation',
    dbHistory: [{ response: { tag: { speaker: 'user' }, content: 'Widget pro RPM, historie 1 hodinu.' } }] }, {
    generate: async ({ prompt }) => {
      const request = JSON.parse(prompt);
      assert.equal(request.project.id, project.id);
      assert.equal(request.host.platform, process.platform);
      assert.equal(request.host.sensors, 'not_probed');
      assert.ok(request.analysis.setup.policy.externalImports.includes('node:fs/promises'));
      assert.ok(!request.analysis.setup.policy.externalImports.includes('electron'));
      assert.equal(request.history[0].content, 'Widget pro RPM, historie 1 hodinu.');
      assert.equal(request.analysis.excerpts.some(file => file.path === 'README.md'), true);
      return generated({ reply: 'Nejdřív ověříme čtení a historii, pak graf. Chybějící senzor zobrazíme jako nedostupný.', plan: plan() });
    },
  });
  assert.equal(response.metadata.canExecute, false);
  assert.equal(response.metadata.inspection.testsExecuted, false);
  assert.equal(response.metadata.projectWorkProposal.draft.focusedTest.binary, process.execPath);
  assert.equal(await fs.readFile(path.join(project.path, 'src/index.mjs'), 'utf8'), before);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
});

for (const scenario of ['path-escape', 'model-command', 'cycle', 'no-test', 'missing-parent', 'truncated']) {
  test(`invalid ${scenario} cannot become an executable proposal`, async t => {
    const project = await fixture(t);
    const draft = plan();
    if (scenario === 'path-escape') draft.files[0].path = '../escape.mjs';
    if (scenario === 'model-command') draft.focusedTest = { binary: '/bin/sh', argv: ['-c', 'echo bad'] };
    if (scenario === 'cycle') draft.files[0].dependsOn = ['test/acceptance.test.mjs'];
    if (scenario === 'no-test') draft.files.pop();
    if (scenario === 'missing-parent') { draft.files[0].path = 'nested/a.mjs'; draft.files[1].dependsOn = ['nested/a.mjs']; }
    await assert.rejects(discussProject('build', { project }, { generate: async () => ({
      ...generated({ reply: 'Ready', plan: draft }), ...(scenario === 'truncated' ? { finishReason: 'length' } : {}),
    }) }));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
  });
}

test('separate new projects do not inherit the first project request', async t => {
  const project = await fixture(t);
  const weatherPath = path.join(path.dirname(project.path), 'weather');
  await initializeNewProject(weatherPath, { name: 'Weather', description: 'Weather widget' });
  const weather = { ...project, path: weatherPath, id: project.id + 1, name: 'Weather', description: 'Weather widget' };
  const response = await discussProject('Kde začít?', { project: weather }, { generate: async ({ prompt }) => {
    const input = JSON.parse(prompt);
    assert.deepEqual(input.history, []); assert.equal(input.project.id, weather.id);
    assert.doesNotMatch(prompt, /Fan monitor|RPM s historií/);
    return generated({ reply: 'Pro které město a odkud budou povolená data?', plan: null });
  } });
  assert.equal(response.metadata.projectWorkProposal, null);
});

test('planning phrases do not turn a clarification into a directory-list approval', () => {
  for (const input of ['Rozděl čtení a historii a pak navrhni soubory.',
    'Navrhni strukturu tohoto projektu.', 'Chci vytvořit widget a soubory projektu.', 'a jak?']) {
    assert.equal(detectFileIntent(input).detected, false, input);
  }
  assert.equal(detectFileIntent('Ukaž soubory v tomto projektu').filePath, '.');
  assert.equal(detectFileIntent('přečti src/index.mjs').filePath, 'src/index.mjs');
});

test('a missing directory is repaired once with observed directories and the same complete goal', async t => {
  const project = await fixture(t); let calls = 0;
  const response = await discussProject('Build my monitor', { project }, { generate: async ({ prompt }) => {
    const input = JSON.parse(prompt); calls++;
    assert.equal(input.request, 'Build my monitor');
    assert.equal(input.project.description, project.description);
    assert.ok(input.analysis.directories.includes('public'));
    if (calls === 1) {
      const bad = plan(); bad.files[0].path = 'src/config/index.mjs';
      bad.files[1].dependsOn = ['src/config/index.mjs'];
      return generated({ reply: 'Initial plan', plan: bad });
    }
    assert.equal(input.planFeedback.code, 'PROJECT_PLAN_PARENT_UNAVAILABLE');
    assert.match(input.planFeedback.message, /src\/config/);
    assert.doesNotMatch(input.planFeedback.message, /\/tmp\//);
    return generated({ reply: 'Use the existing src directory.', plan: plan() });
  } });
  assert.equal(calls, 2); assert.equal(response.metadata.inspection.planningAttempts, 2);
  assert.equal(response.metadata.projectWorkProposal.draft.files[0].path, 'src/index.mjs');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
  await assert.rejects(fs.stat(path.join(project.path, 'src/config')), { code: 'ENOENT' });
});

test('structural repair stops after two invalid model plans without effects', async t => {
  const project = await fixture(t); let calls = 0;
  await assert.rejects(discussProject('Build', { project }, { generate: async () => {
    calls++; const bad = plan(); bad.files.pop(); return generated({ reply: 'Missing test', plan: bad });
  } }), { code: 'PROJECT_PLAN_INVALID' });
  assert.equal(calls, 2);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
});

test('provider errors and incomplete generation never trigger structural retries', async t => {
  const project = await fixture(t);
  for (const failure of ['provider', 'length']) {
    let calls = 0;
    await assert.rejects(discussProject('Build', { project }, { generate: async () => {
      calls++; if (failure === 'provider') throw new Error('provider down');
      return { ...generated({ reply: 'Partial', plan: plan() }), finishReason: 'length' };
    } }));
    assert.equal(calls, 1);
  }
});

test('workspace changes during planning invalidate the suggestion before it reaches the composer', async t => {
  const project = await fixture(t);
  await assert.rejects(discussProject('build', { project }, { generate: async () => {
    await fs.writeFile(path.join(project.path, 'README.md'), 'Concurrent user change\n');
    return generated({ reply: 'Proposed', plan: plan() });
  } }), /během plánování změnil/);
  assert.equal(await fs.readFile(path.join(project.path, 'README.md'), 'utf8'), 'Concurrent user change\n');
});

test('project continuation takes only canonical evidence for the same actor, project and conversation', () => {
  let material = Buffer.from('export const readFan = () => null;');
  const digest = `sha256:${createHash('sha256').update(material).digest('hex')}`;
  const rows = [
    { lifecycleId: 'mine', project: 1, conversation: 'fan', actor: 'operator' },
    { lifecycleId: 'foreign-project', project: 2, conversation: 'fan', actor: 'operator' },
    { lifecycleId: 'foreign-conversation', project: 1, conversation: 'weather', actor: 'operator' },
    { lifecycleId: 'foreign-owner', project: 1, conversation: 'fan', actor: 'phone' },
  ];
  const reads = [];
  const dependencies = { projectId: 1, conversationId: 'fan', actorId: 'operator',
    lifecycleRepository: {
      listOwnedOperations: ({ actorId }) => { assert.equal(actorId, 'operator'); return rows; },
      getPlan: id => { const row = rows.find(item => item.lifecycleId === id); return {
        actor: { id: row.actor }, project: { projectId: row.project }, origin: { conversationId: row.conversation },
        identity: { executionId: id }, intent: 'Read RPM', changes: [{ path: 'src/index.mjs', afterDigest: digest }],
      }; },
      getTerminal: id => { reads.push(id); return { state: 'failed', errorCode: 'FOCUSED_TEST_FAILED', resultDigest: 'digest' }; },
    },
    executionRepository: { getResult: () => ({ focusedTest: { terminalStatus: 'failed', exitCode: 1 } }),
      listEvents: () => [{ type: 'process_terminated', details: { testOutput: { stdout: 'Assertion failed', stderr: '', truncated: false } } }],
      getFileMaterial: () => [{ path: 'src/index.mjs', afterBytes: material }],
    },
  };
  const result = collectProjectWorkEvidence(dependencies);
  assert.deepEqual(reads, ['mine']); assert.equal(result.length, 1);
  assert.equal(result[0].state, 'failed'); assert.equal(result[0].focusedTest.exitCode, 1);
  assert.equal(result[0].failedCandidate[0].state, 'failed_candidate_not_current_file');
  assert.equal(result[0].testOutput.stdout, 'Assertion failed');
  material = Buffer.from('tampered');
  assert.throws(() => collectProjectWorkEvidence(dependencies), /neodpovídá schválenému plánu/);
});

test('planning selects context for the real model window and never truncates the current request', () => {
  const request = 'Cílem je widget; tentokrát přidej historii a zachovej současné čtení.';
  const input = { request, project: { id: 1, name: 'Fan', description: 'Project' },
    history: Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(2200) })),
    analysis: { revision: 'wsr1:fixture', fileCount: 4000, files: ['src/index.mjs', 'test/acceptance.test.mjs'], setup: {},
      excerpts: Array.from({ length: 10 }, (_, i) => ({ path: `src/file${i}.mjs`, text: 'x'.repeat(4000) })) },
    projectWorkEvidence: [] };
  for (const numCtx of [4096, 8192]) {
    const result = fitProjectDiscussionPrompt(JSON.stringify(input), numCtx);
    assert.equal(result.numCtx, numCtx);
    assert.equal(JSON.parse(result.prompt).request, request);
    assert.ok(Buffer.byteLength(result.systemPrompt + result.prompt) <= result.maxBytes);
    assert.ok(result.systemPrompt.includes(PROJECT_DISCUSSION_SYSTEM));
    assert.match(result.systemPrompt, /Today \/ dnes: \d{4}-\d{2}-\d{2}/);
    assert.match(result.systemPrompt, /Yesterday \/ včera:/);
    assert.match(result.systemPrompt, /Tomorrow \/ zítra:/);
    assert.ok(result.maxTokens + result.maxBytes / 2 + 384 <= numCtx);
  }
  const goal = 'Desktop monitor with real CPU RAM GPU FAN NETWORK DISK. '.repeat(18) + 'PERSISTENT_HISTORY_LAST_REQUIREMENT';
  const continuation = fitProjectDiscussionPrompt(JSON.stringify({ ...input,
    project: { ...input.project, description: goal }, history: input.history.slice(2) }), 4096);
  assert.equal(JSON.parse(continuation.prompt).project.description, goal, 'keep the whole original goal after older chat leaves the history window');
  assert.throws(() => fitProjectDiscussionPrompt(JSON.stringify({ ...input, request: 'q'.repeat(50_000) }), 4096), /Rozděl/);
  const repairRequest = 'Oprav čtení souborů i neúspěšný test. '.repeat(14);
  const repaired = fitProjectDiscussionPrompt(JSON.stringify({ ...input, request: repairRequest,
    projectWorkEvidence: [{ lifecycleId: 'lifecycle:failed', state: 'failed', errorCode: 'PROJECT_CHANGE_TEST_FAILED',
      focusedTest: { status: 'failed', exitCode: 1 }, testOutput: { stdout: 'AssertionError\n'.repeat(250), stderr: '' },
      failedCandidate: [{ path: 'src/index.mjs', text: 'code'.repeat(400) }] }],
  }), 4096);
  assert.equal(JSON.parse(repaired.prompt).request, repairRequest);
  assert.equal(JSON.parse(repaired.prompt).projectWorkEvidence[0].errorCode, 'PROJECT_CHANGE_TEST_FAILED');
  assert.ok(Buffer.byteLength(repaired.systemPrompt + repaired.prompt) <= repaired.maxBytes);
});

test('a short correction and full goal outrank old snippets when lifecycle evidence consumes the window', () => {
  const policy = newProjectPolicy('desktop');
  const input = {
    request: 'Fix RAM keys, use UTF8. Validate CPU counters and guest time; malformed samples and counter regressions must not produce invented percentages. Test positive values and failures independently.',
    project: { id: 1, name: 'Monitor', description: 'CPU RAM GPU fans, network, disks, readable charts and persistent history. '.repeat(28) },
    history: [{ role: 'user', content: 'old goal '.repeat(30) }, { role: 'user', content: 'old correction '.repeat(30) }],
    analysis: { fileCount: 6, files: ['README.md', 'ROADMAP.md', 'package.json', 'src/index.mjs', 'test/acceptance.test.mjs'],
      setup: { policy: { roots: policy.layers[0].roots, externalImports: policy.externalImports } },
      directories: ['.', 'public', 'scripts', 'src', 'test'], excerpts: [] },
    projectWorkEvidence: [{ lifecycleId: 'lifecycle:cancelled', state: 'cancelled', errorCode: null, focusedTest: null }],
  };
  const budget = fitProjectDiscussionPrompt(JSON.stringify(input), 4096);
  const selected = JSON.parse(budget.prompt);
  assert.equal(selected.project.description, input.project.description);
  assert.equal(selected.request, input.request);
  assert.equal(selected.history.length, 0);
  assert.equal(input.history.length, 2, 'selection must not erase stored history');
  assert.equal(selected.projectWorkEvidence[0].state, 'cancelled');
  assert.deepEqual(selected.analysis.setup.policy, input.analysis.setup.policy);
  assert.equal(budget.numCtx, 4096);
  assert.ok(Buffer.byteLength(budget.systemPrompt + budget.prompt) <= budget.maxBytes);
});

test('actual HTTP creation/import preserves foreign files, rejects collisions and survives restart', { timeout: 60_000 }, async () => {
  const { makeRuntime, startServer, stopServer, requestJson } = await import('../scripts/run-project-build-journey.js');
  const runtime = makeRuntime(isolatedTestRuntime.artifacts);
  let server;
  try {
    server = await startServer(runtime, 'project-flow-deterministic-http-20260918', 'invalid://no-inference-in-this-test');
    const api = (method, endpoint, body) => requestJson(server, method, endpoint, body);
    const created = await api('POST', '/api/projects', { name: 'Fan HTTP', description: 'RPM widget', type: 'general' });
    assert.equal(created.statusCode, 201, created.raw);
    const project = created.json.project;
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
    const other = path.join(runtime.home, 'must-not-exist');
    const conflict = await api('POST', '/api/projects', { name: 'Fan HTTP', path: other });
    assert.equal(conflict.statusCode, 409); await assert.rejects(fs.stat(other), { code: 'ENOENT' });
    const weather = await api('POST', '/api/projects', { name: 'Desktop HTTP', type: 'desktop' });
    assert.equal(weather.statusCode, 201);
    assert.equal(JSON.parse(await fs.readFile(path.join(weather.json.path, 'package.json'), 'utf8')).scripts.start, 'electron src/index.mjs'); assert.notEqual(weather.json.project.id, project.id);
    assert.notEqual(weather.json.path, project.path);
    const foreign = path.join(runtime.home, 'outside-created'); await fs.mkdir(foreign);
    await fs.writeFile(path.join(foreign, 'app.py'), 'def add(a, b): return a - b\n');
    const reused = await api('POST', '/api/projects', { name: 'Must not overwrite', path: foreign });
    assert.equal(reused.statusCode, 409);
    await fs.chmod(foreign, 0o555);
    const imported = await api('POST', '/api/projects/open-folder', { folderPath: foreign });
    assert.equal(imported.statusCode, 201, imported.raw);
    assert.equal(imported.json.project.is_external, 1);
    assert.match(imported.json.welcomeMessage, /cíl projektu/);
    assert.equal(imported.json.analysis.excerpts[0].path, 'app.py');
    assert.deepEqual(await fs.readdir(foreign), ['app.py']);
    const firstPid = server.child.pid; await stopServer(server);
    server = await startServer(runtime, 'project-flow-deterministic-http-restart-20260918', 'invalid://no-inference-in-this-test');
    assert.notEqual(server.child.pid, firstPid);
    const reopened = await api('POST', '/api/projects/open-folder', { folderPath: foreign });
    assert.equal(reopened.statusCode, 200); assert.equal(reopened.json.project.id, imported.json.project.id);
    assert.deepEqual(await fs.readdir(foreign), ['app.py']);
    assert.equal(await fs.readFile(path.join(foreign, 'app.py'), 'utf8'), 'def add(a, b): return a - b\n');
    await fs.chmod(foreign, 0o755);
  } finally { if (server) await stopServer(server); }
});

test('open-folder route works read-only and refreshes an already registered repository', async t => {
  const project = await fixture(t);
  const calls = [];
  const deps = { db: { projects: { registerExternal: () => ({ project, wasExisting: true }) } },
    parseBody: async () => ({ folderPath: project.path }), sendJSON: (_res, status, value) => calls.push({ status, value }),
    safeError: e => ({ error: e.message }), logger: { warn() {}, error() {} } };
  const routes = createProjectRoutes(deps);
  await routes['POST /api/projects/open-folder']({}, {});
  assert.equal(calls[0].status, 200);
  assert.ok(calls[0].value.analysis);
  assert.equal(calls[0].value.metadata.bootstrapped, false);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
});
