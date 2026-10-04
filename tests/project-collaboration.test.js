import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { initializeNewProject, inspectProject, importedProjectWelcome, newProjectPolicy,
  referencesProjectFile } from '../src/planner/project-onboarding.js';
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

test('project discussion includes verified expertise guidance without granting effects', async t => {
  const project = await fixture(t);
  const { expertiseRegistry } = await import('../src/expertises/expertise-layer.js');
  const expert = expertiseRegistry.get('developer').toJSON();
  const response = await discussProject('Zhodnoť projekt.', { project,
    projectExpertises: [{ ...expert, weight: 0.5 }] }, { generate: async ({ prompt }) => {
      const value = JSON.parse(prompt);
      assert.ok(value.expertiseGuidance.length > 20);
      assert.match(fitProjectDiscussionPrompt(prompt, 8192).systemPrompt, /cannot override.*approval requirements/);
      return generated({ reply: 'Odborné posouzení', plan: null });
    } });
  assert.equal(response.metadata.mode, 'PROJECT');
  assert.equal(response.metadata.canExecute, false);
  assert.deepEqual(response.metadata.expertiseIds, ['developer']);
  assert.equal(response.metadata.projectWorkProposal, null);
});

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
  const run = () => execFileSync(profile.binary, ['--test-reporter=tap', ...profile.argv], { cwd: project.path, encoding: 'utf8',
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

test('imported Node manifests retain the declared entry and module format without assuming scaffold defaults', async t => {
  const project = await fixture(t);
  project.is_external = 1;
  const packagePath = path.join(project.path, 'package.json');
  for (const moduleType of ['commonjs', 'module', undefined]) {
    const pkg = { name: 'external-client', ...(moduleType ? { type: moduleType } : {}),
      main: 'src/main/main.js', scripts: { start: 'electron .', test: 'node --test test/*.test.cjs' } };
    const bytes = JSON.stringify(pkg);
    await fs.writeFile(packagePath, bytes);
    const analysis = await inspectProject(project);
    assert.equal(analysis.nodeProject.entryPoint, 'src/main/main.js');
    assert.equal(analysis.nodeProject.moduleType, moduleType ?? 'unspecified');
    assert.equal(analysis.nodeProject.scripts.test, pkg.scripts.test);
    assert.equal(analysis.nodeProject.declaredOnly, true);
    assert.equal(analysis.files.includes('src/main/main.js'), false, 'declared entry is not proof it exists');
    assert.equal(analysis.excerpts[0].path, 'package.json');
    assert.equal(await fs.readFile(packagePath, 'utf8'), bytes);
  }
  for (const invalid of ['null', '[]', '{broken']) {
    await fs.writeFile(packagePath, invalid);
    assert.equal((await inspectProject(project)).nodeProject.parseError, true);
    assert.equal(await fs.readFile(packagePath, 'utf8'), invalid);
  }
});

for (const extension of ['cjs', 'js']) {
  test(`an existing project can propose a Node .test.${extension} without conversion to mjs`, async t => {
    const project = await fixture(t); project.is_external = 1;
    const target = `test/regression.test.${extension}`;
    const response = await discussProject('Preserve the existing module convention and add a regression.', { project }, {
      generate: async () => generated({ reply: 'A bounded regression.', plan: {
        instruction: 'Test the existing behavior.', files: [{ path: target, instruction: 'Use node:test with functional assertions.', dependsOn: [] }],
      } }),
    });
    const draft = response.metadata.projectWorkProposal.draft;
    assert.equal(draft.files[0].path, target);
    assert.deepEqual(draft.focusedTest.argv, ['--disable-wasm-trap-handler', '--test']);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
  });
}

test('a short continuation receives the same project, history and real evidence; proposal grants no effects', async t => {
  const project = await fixture(t);
  const before = await fs.readFile(path.join(project.path, 'src/index.mjs'), 'utf8');
  const response = await discussProject('a jak?', { project, conversationId: 'fan-conversation',
    dbHistory: [{ response: { tag: { speaker: 'user' }, content: 'Widget pro RPM, historie 1 hodinu.' } }] }, {
    generate: async ({ prompt }) => {
      const request = JSON.parse(prompt);
      assert.equal(request.project.id, project.id);
      assert.equal(request.host.platform, process.platform);
      assert.equal(request.host.node, process.versions.node);
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

test('project discussion keeps the durable summary in the final bounded provider prompt after ten new messages', async t => {
  const project = await fixture(t);
  const summary = '[Souhrn předchozí konverzace]\nPrior decision ALTAIR_229: keep RPM history for one hour.';
  const dbHistory = [{ isSummary: true, response: { tag: { speaker: 'system' }, content: summary } },
    ...Array.from({ length: 10 }, (_, index) => ({ response: { tag: { speaker: index % 2 ? 'system' : 'user' },
      content: `Short later message ${index}` } }))];
  await discussProject('What should we do next?', { project, dbHistory }, {
    generate: async ({ prompt }) => {
      const raw = JSON.parse(prompt);
      assert.equal(raw.history.length, 11);
      assert.equal(raw.history[0].role, 'summary');
      assert.match(raw.history[0].content, /ALTAIR_229/);
      assert.equal(raw.history.some(turn => turn.content === 'Short later message 0'), true);
      const bounded = JSON.parse(fitProjectDiscussionPrompt(prompt, 4096).prompt);
      assert.ok(bounded.history.some(turn => turn.role === 'summary' && turn.content.includes('ALTAIR_229')),
        'the final model prompt must retain the synthetic summary');
      return generated({ reply: 'Keep the previous one-hour RPM requirement.', plan: null });
    },
  });
});

test('project discussion does not shorten a durable summary before budgeting', async t => {
  const project = await fixture(t);
  const summary = '[Souhrn předchozí konverzace]\n' + 'Earlier decision. '.repeat(155) + ' LATE_DURABLE_DECISION';
  const dbHistory = [{ isSummary: true, response: { tag: { speaker: 'system' }, content: summary } },
    ...Array.from({ length: 10 }, (_, index) => ({ response: { tag: { speaker: 'user' },
      content: `New turn ${index}` } }))];
  await discussProject('Continue the project.', { project, dbHistory }, {
    generate: async ({ prompt }) => {
      assert.equal(JSON.parse(prompt).history[0].content, summary);
      const bounded = JSON.parse(fitProjectDiscussionPrompt(prompt, 8192).prompt);
      assert.equal(bounded.history.find(turn => turn.role === 'summary')?.content, summary);
      return generated({ reply: 'Continue with the earlier decision.', plan: null });
    },
  });
});

test('tight 4K project budget keeps a complete summary or fails before a provider call', () => {
  const summary = '[Souhrn předchozí konverzace]\n' + 'Earlier facts. '.repeat(75)
    + ' LATE_SUMMARY_CANARY';
  const input = { request: 'Continue with the prior decision.',
    project: { id: 1, name: 'Demo', description: 'G'.repeat(1600) },
    history: [{ role: 'summary', content: summary },
      ...Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user',
        content: `Old history ${index} ` + 'x'.repeat(600) }))],
    analysis: { fileCount: 0, files: [], setup: {}, directories: [], excerpts: [] },
    projectWorkEvidence: [] };
  const bounded = fitProjectDiscussionPrompt(JSON.stringify(input), 4096);
  const selected = JSON.parse(bounded.prompt);
  assert.equal(selected.history.find(turn => turn.role === 'summary')?.content, summary);
  assert.ok(selected.history.length < input.history.length, 'optional history should yield before the summary');
  assert.ok(Buffer.byteLength(bounded.systemPrompt + bounded.prompt) <= bounded.maxBytes);
  assert.throws(() => fitProjectDiscussionPrompt(JSON.stringify({ ...input,
    history: [{ role: 'summary', content: summary + 'LONG'.repeat(400) }, ...input.history.slice(1)] }), 4096), /Rozděl/);
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

test('alternating projects keep only their own current README in the packed model prompt', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'is-project-prompt-isolation-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const firstPath = path.join(parent, 'orion');
  const secondPath = path.join(parent, 'lyra');
  await fs.mkdir(firstPath);
  await fs.mkdir(secondPath);
  const firstCode = 'ORION_PROMPT_A27';
  const updatedFirstCode = 'ORION_PROMPT_C63';
  const secondCode = 'LYRA_PROMPT_B42';
  await fs.writeFile(path.join(firstPath, 'README.md'), `Current project code: ${firstCode}\n`);
  await fs.writeFile(path.join(secondPath, 'README.md'), `Current project code: ${secondCode}\n`);
  const first = { id: 7001, path: firstPath, name: 'Orion', description: 'Orion notes', is_external: 1 };
  const second = { id: 7002, path: secondPath, name: 'Lyra', description: 'Lyra notes', is_external: 1 };

  async function packedPrompt(project, ownCode, otherCodes) {
    let packed;
    const response = await discussProject('What is the current README code?', { project }, {
      generate: async ({ prompt }) => {
        packed = fitProjectDiscussionPrompt(prompt, 4096).prompt;
        return generated({ reply: ownCode, plan: null });
      },
    });
    assert.equal(response.metadata.projectId, project.id);
    assert.ok(packed.includes(ownCode), `project ${project.id} lost its README in the packed prompt`);
    for (const otherCode of otherCodes) {
      assert.ok(!packed.includes(otherCode), `project ${project.id} packed stale or foreign README content`);
    }
    return response.metadata.inspection.workspaceRevision;
  }

  const oldRevision = await packedPrompt(first, firstCode, [secondCode, updatedFirstCode]);
  await packedPrompt(second, secondCode, [firstCode, updatedFirstCode]);
  await fs.writeFile(path.join(firstPath, 'README.md'), `Current project code: ${updatedFirstCode}\n`);
  const newRevision = await packedPrompt(first, updatedFirstCode, [firstCode, secondCode]);
  assert.notEqual(newRevision, oldRevision, 'a changed README must change the observed workspace revision');
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

test('context selection keeps observed manifest facts and refills excerpts after reducing optional history', () => {
  const nodeProject = { manifest: 'package.json', declaredOnly: true, moduleType: 'commonjs',
    entryPoint: 'src/main/main.js', scripts: { test: 'node --test test/*.test.cjs' } };
  const input = { request: 'Analyze this existing client without changing its architecture.',
    project: { id: 1, name: 'External', imported: true, description: 'Preserve SSH and SFTP. '.repeat(45) },
    history: Array.from({ length: 10 }, () => ({ role: 'user', content: 'Old conversation. '.repeat(150) })),
    analysis: { fileCount: 43, files: ['package.json', 'src/main/main.js'], directories: ['.', 'src', 'test'],
      setup: { policy: newProjectPolicy('desktop') }, nodeProject,
      excerpts: [{ path: 'package.json', text: JSON.stringify({ main: nodeProject.entryPoint }) },
        { path: 'README.md', text: 'Existing client documentation. '.repeat(120) }] }, projectWorkEvidence: [] };
  const before = JSON.stringify(input);
  const result = fitProjectDiscussionPrompt(before, 4096);
  const selected = JSON.parse(result.prompt);
  assert.deepEqual(selected.analysis.nodeProject, nodeProject);
  assert.ok(selected.analysis.excerpts.some(file => file.path === 'package.json'));
  assert.equal(selected.request, input.request);
  assert.equal(selected.project.description, input.project.description);
  assert.equal(JSON.stringify(input), before, 'selection cannot modify stored data');
  assert.ok(Buffer.byteLength(result.systemPrompt + result.prompt) <= result.maxBytes);
});

test('4K project return keeps freshly inspected README requested by name', () => {
  const source = '# README-A\nProjektový kód ORION_A_FILE_391.\n';
  const request = 'Zopakuj kontrolní kód z README-A.md';
  const input = { request,
    host: { platform: 'linux', architecture: 'x64', observation: 'O'.repeat(1050) },
    project: { id: 1, name: 'A', description: '' },
    history: [{ role: 'user', content: 'Dřívější otázka' },
      { role: 'assistant', content: 'Dřívější odpověď' }, { role: 'user', content: request }],
    analysis: { fileCount: 1, files: ['README-A.md'], setup: {}, directories: ['.'],
      nodeProject: null, excerpts: [{ path: 'README-A.md', text: source, truncated: false }] },
    expertiseGuidance: 'E'.repeat(600), projectWorkEvidence: [] };
  const result = fitProjectDiscussionPrompt(JSON.stringify(input), 4096, 'S'.repeat(2190));
  const selected = JSON.parse(result.prompt);
  assert.equal(selected.request, request);
  assert.equal(selected.expertiseGuidance, input.expertiseGuidance);
  assert.equal(selected.analysis.excerpts.find(file => file.path === 'README-A.md')?.text, source);
  assert(result.maxTokens >= 1024, 'model still needs a useful reply budget');
  assert(Buffer.byteLength(result.systemPrompt + result.prompt) <= result.maxBytes);
});

test('requested source is complete or rejected before the model; short natural words are not paths', () => {
  const request = 'Zopakuj kód ze souboru README-A.md';
  const source = 'X'.repeat(500) + 'FACT_AFTER_300' + 'Y'.repeat(500);
  const input = { request, host: { observation: 'O'.repeat(1500) },
    project: { id: 1, name: 'A', description: '' }, history: [{ role: 'user', content: request }],
    analysis: { fileCount: 1, files: ['README-A.md'], setup: {}, directories: ['.'],
      excerpts: [{ path: 'README-A.md', text: source, truncated: false }] },
    expertiseGuidance: 'E'.repeat(600), projectWorkEvidence: [] };
  assert.throws(() => fitProjectDiscussionPrompt(JSON.stringify(input), 4096, 'S'.repeat(2190)),
    { code: 'PROJECT_CONTEXT_SOURCE_UNAVAILABLE' });
  const shortPath = { ...input, request: 'Jaký je stav projektu?', host: { observation: 'O'.repeat(2000) },
    history: [{ role: 'user', content: 'Jaký je stav projektu?' }],
    analysis: { ...input.analysis, files: ['a'], excerpts: [{ path: 'a', text: 'X'.repeat(1000), truncated: false }] } };
  assert.equal(referencesProjectFile(shortPath.request, 'a'), false);
  assert.equal(referencesProjectFile('Otevři `a`.', 'a'), true);
  assert.equal(referencesProjectFile('Otevři ./abc.', 'a'), false);
  assert.equal(referencesProjectFile('Zkontroluj README-A.md.', 'README-A.md'), true);
  assert.doesNotThrow(() => fitProjectDiscussionPrompt(JSON.stringify(shortPath), 4096, 'S'.repeat(2190)));
});

test('named README displaces optional package excerpt and older turns before capacity refusal', () => {
  const request = 'Přečti přesný kód v README-A.md';
  const system = 'S'.repeat(2190);
  const base = { request, host: { observation: '' },
    project: { id: 1, name: 'A', description: '' },
    history: [{ role: 'user', content: request }],
    analysis: { fileCount: 2, files: ['package.json', 'README-A.md'], setup: {}, directories: ['.'],
      nodeProject: { manifest: 'package.json', declaredOnly: true },
      excerpts: [{ path: 'package.json', text: 'P'.repeat(300), truncated: false },
        { path: 'README-A.md', text: 'R'.repeat(1800), truncated: false }] },
    expertiseGuidance: 'E'.repeat(600), projectWorkEvidence: [] };
  const withPackage = fitProjectDiscussionPrompt(JSON.stringify(base), 4096, system);
  const selectedPackageCase = JSON.parse(withPackage.prompt);
  assert.equal(selectedPackageCase.analysis.excerpts.find(file => file.path === 'README-A.md')?.text,
    'R'.repeat(1800));
  assert.deepEqual(selectedPackageCase.analysis.nodeProject, base.analysis.nodeProject);
  assert(withPackage.maxTokens >= 1024);
  const withHistory = { ...base, host: { observation: 'O'.repeat(1000) },
    history: [{ role: 'user', content: 'Q'.repeat(100) },
      { role: 'assistant', content: 'A'.repeat(100) }, { role: 'user', content: request }],
    analysis: { ...base.analysis, files: ['README-A.md'],
      excerpts: [{ path: 'README-A.md', text: 'R'.repeat(900), truncated: false }] } };
  const bounded = fitProjectDiscussionPrompt(JSON.stringify(withHistory), 4096, system);
  const selectedHistoryCase = JSON.parse(bounded.prompt);
  assert.equal(selectedHistoryCase.request, request);
  assert.equal(selectedHistoryCase.analysis.excerpts[0].text, 'R'.repeat(900));
  assert(bounded.maxTokens >= 1024);
  assert(Buffer.byteLength(bounded.systemPrompt + bounded.prompt) <= bounded.maxBytes);
});

test('project inspection puts a named file ahead of the ten generic excerpts', async t => {
  const project = await fixture(t);
  for (let index = 0; index < 12; index++) {
    await fs.writeFile(path.join(project.path, 'src', `section-${String(index).padStart(2, '0')}.js`),
      `export const marker = 'SECTION_${index}';\n`);
  }
  const target = 'src/section-11.js';
  const ordinary = await inspectProject(project);
  assert.equal(ordinary.excerpts.some(file => file.path === target), false);
  const request = `Přečti přesný marker ze souboru ${target}`;
  const targeted = await inspectProject(project, { request });
  assert.equal(targeted.excerpts.find(file => file.path === target)?.text,
    "export const marker = 'SECTION_11';\n");
  await discussProject(request, { project }, { generate: async ({ prompt }) => {
    assert(JSON.parse(prompt).analysis.excerpts.some(file => file.path === target));
    return generated({ reply: 'Soubor obsahuje SECTION_11.', plan: null });
  } });
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
  const deps = { db: { projects: { findByPath: { get: () => project },
    registerExternal: () => ({ project, wasExisting: true }) },
    db: { prepare: () => ({ get: () => ({ value: 'false' }) }) } },
    parseBody: async () => ({ folderPath: project.path }), sendJSON: (_res, status, value) => calls.push({ status, value }),
    safeError: e => ({ error: e.message }), logger: { warn() {}, error() {} } };
  const routes = createProjectRoutes(deps);
  await routes['POST /api/projects/open-folder']({}, {});
  assert.equal(calls[0].status, 200);
  assert.ok(calls[0].value.analysis);
  assert.equal(calls[0].value.metadata.bootstrapped, false);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: project.path, encoding: 'utf8' }), '');
});


// These are classification-boundary fixtures, not model-quality evidence.
// Public requests are independent examples; historical private prompts stay private.
import { CREDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';

const projectScopeRequests = [
  'Navrhni další přírůstek monitoru: parser, paměťová historie a test. Připrav návrh bez zápisu.',
  'Vytvoř další přírůstek monitoru ve zdrojích a testech. Existující závislost uveď pouze jako contextFiles.',
];
const projectScopeContext = {
  m2LifecycleOnly: true, hasActiveProject: true,
  project: { id: 7304, name: 'Scoped project fixture' }, sessionId: 'project-scope-fixture',
};
function scopedClassifierFixture(result, context = projectScopeContext) {
  const engine = new CREDecisionEngine();
  const calls = [];
  engine._llmClassifyIntent = async (input, actualContext) => {
    calls.push({ input, context: actualContext });
    return typeof result === 'function' ? result(input, actualContext) : result;
  };
  return { engine, calls, context };
}
function interpretedScope(intent, responseScope, extra = {}) {
  return { intent, confidence: 0.9, contextualInterpretation: true,
    responseScope, continuesPending: false, requestedOperation: 'none',
    briefResponse: false, responseWordCount: null, question: null, ...extra };
}

test('M2 project requests use semantic project scope despite creative words and contextFiles', async () => {
  for (const request of projectScopeRequests) {
    const { engine, calls, context } = scopedClassifierFixture(interpretedScope(IntentType.CREATIVE, 'project'));
    const decision = await engine.decide(request, context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, request);
    assert.equal(calls[0].context.project.id, context.project.id);
    assert.equal(decision.type, DecisionType.ANSWER);
    assert.equal(decision.metadata.responseScope, 'project');
    assert.equal(decision.metadata.classifiedBy, 'llm');
    assert.deepEqual(decision.tools, []);
  }
});

test('M2 inline code keeps semantic project scope through the later CODE branch', async () => {
  const request = 'Napiš funkci pro součet dvou čísel v připojeném projektu.';
  for (const scope of ['project', 'conversation']) {
    const { engine, calls, context } = scopedClassifierFixture(interpretedScope(IntentType.CODE, scope));
    const decision = await engine.decide(request, context);
    assert.equal(calls.length, 1);
    assert.equal(decision.metadata.responseScope, scope);
    if (scope === 'conversation') {
      assert.equal(decision.type, DecisionType.ANSWER);
      assert.equal(decision.metadata.inlineCode, true);
    } else {
      assert.notEqual(decision.metadata.inlineCode, true);
      assert.equal(decision.intent, IntentType.CODE);
    }
  }
});

test('M2 creative conversation and project status retain their distinct semantic scopes', async () => {
  for (const [request, scope] of [
    ['Napiš báseň o podzimu.', 'conversation'],
    ['Navrhni stručný popis současného stavu, žádné změny.', 'project_status'],
  ]) {
    const { engine, calls, context } = scopedClassifierFixture(interpretedScope(IntentType.CREATIVE, scope));
    const decision = await engine.decide(request, context);
    assert.equal(calls.length, 1);
    assert.equal(decision.type, DecisionType.ANSWER);
    assert.equal(decision.metadata.responseScope, scope);
    assert.deepEqual(decision.tools, []);
  }
});

test('unresolved M2 project scope cannot fall back to a plan or lose a concrete question', async () => {
  const question = 'Kterou existující část projektu chceš změnit?';
  const cases = [
    null,
    interpretedScope(IntentType.BUILD, 'project', { confidence: 0.4 }),
    interpretedScope(IntentType.CREATIVE, null),
    interpretedScope(IntentType.CREATIVE, 'unknown'),
    interpretedScope(IntentType.CREATIVE, 'project', { contextualInterpretation: false }),
    interpretedScope(IntentType.AMBIGUOUS, 'project', { question }),
  ];
  for (const result of cases) {
    const fixture = scopedClassifierFixture(result, { ...projectScopeContext,
      hasActiveExpertise: true, expertise: { id: 'writer', creativeLock: true } });
    const decision = await fixture.engine.decide(projectScopeRequests[1], fixture.context);
    assert.equal(fixture.calls.length, 1);
    assert.equal(decision.type, DecisionType.ASK_USER);
    assert.equal(decision.intent, IntentType.AMBIGUOUS);
    assert.deepEqual(decision.tools, []);
    assert.deepEqual(decision.slots, ['intent_clarification']);
    assert.equal(typeof decision.metadata.clarificationQuestion, 'string');
    if (result?.question) assert.equal(decision.metadata.clarificationQuestion, question);
  }
});

test('M2 project classification cancellation prevents admission or interpretation after abort', async () => {
  for (const beforeCall of [true, false]) {
    const controller = new AbortController();
    if (beforeCall) controller.abort();
    const fixture = scopedClassifierFixture(() => {
      controller.abort();
      return interpretedScope(IntentType.CREATIVE, 'project');
    }, { ...projectScopeContext, signal: controller.signal });
    await assert.rejects(fixture.engine.decide(projectScopeRequests[0], fixture.context),
      { name: 'AbortError', code: 'ABORT_ERR' });
    assert.equal(fixture.calls.length, beforeCall ? 0 : 1);
  }
});

test('ordinary creative and inline shortcuts stay deterministic outside the M2 project path', async () => {
  for (const context of [
    { m2LifecycleOnly: true },
    { hasActiveProject: true, project: projectScopeContext.project },
  ]) {
    for (const request of ['Napiš báseň o podzimu.', 'Napiš funkci pro součet dvou čísel.']) {
      const fixture = scopedClassifierFixture(() => { throw new Error('Unexpected classification call'); }, context);
      const decision = await fixture.engine.decide(request, context);
      assert.equal(fixture.calls.length, 0);
      assert.equal(decision.type, DecisionType.ANSWER);
      assert.equal(decision.metadata.classifiedBy, 'deterministic');
    }
  }
});


test('natural project request crosses the actual semantic classifier and default D1 without effects', async t => {
  // Controlled provider responses prove routing and contracts, not model quality.
  // The classifier, ProjectHandler, D1 generator and gateway remain unmodified.
  const [{ projectHandler }, { creDecisionEngine }, { config }, { llmGateway },
    { modelUniverseStore }, { db }, { resolveNumCtx }, { PROJECT_DISCUSSION_SCHEMA }] = await Promise.all([
    import('../src/chat/handlers/project.js'), import('../src/chat/cre-decision.js'),
    import('../src/config.js'), import('../src/llm/gateway.js'),
    import('../src/upgrade/model-universe-store.js'), import('../src/db/database.js'),
    import('../src/llm/model-ctx.js'), import('../src/chat/handlers/project-collaboration.js'),
  ]);
  assert.equal(db.name, isolatedTestRuntime.database);
  assert.equal(llmGateway._concurrency.active, 0);
  assert.equal(llmGateway._concurrency.queue.length, 0);
  const project = await fixture(t);
  const request = projectScopeRequests[1];
  const priorRequest = 'První krok má připravit parser a jeho funkční test.';
  const priorReply = 'Připravíme návrh bez spuštění nebo změny souborů.';
  const goal = 'Monitor s paměťovou historií a samostatnými testy.';
  const history = [
    { projectId: project.id, response: { content: priorRequest, tag: { speaker: 'user' } } },
    { projectId: project.id, response: { content: priorReply, tag: { speaker: 'system' } } },
  ];
  const git = argv => execFileSync('git', argv, { cwd: project.path, encoding: 'utf8' });
  const projectSnapshot = async () => ({
    head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain', '--untracked-files=all']),
    bytes: Object.fromEntries(await Promise.all(git(['ls-files', '-z']).split('\0').filter(Boolean)
      .map(async relative => [relative, (await fs.readFile(path.join(project.path, relative))).toString('base64')]))),
  });
  const authorityCounts = () => [
    'm2_lifecycle_operations', 'm2_execution_requests', 'm2_effect_requests',
  ].map(table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  const before = await projectSnapshot();
  const beforeAuthority = authorityCounts();
  const analysis = await inspectProject(project);
  const classifierModel = 'fixture-d1-natural-classifier:1b';
  const plannerModel = 'fixture-d1-natural-planner:1b';
  const baseUrl = 'http://d1-natural-boundary.invalid';
  const artifacts = {
    [classifierModel]: { modelName: classifierModel, digestSha256: 'a'.repeat(64) },
    [plannerModel]: { modelName: plannerModel, digestSha256: 'b'.repeat(64) },
  };
  const providerPlan = plan();
  providerPlan.files[0].contextFiles = ['README.md'];
  const providerReply = 'Návrh dalšího přírůstku je připraven ke kontrole; soubory zůstaly beze změny.';
  const originalFetch = globalThis.fetch;
  const originalModels = { FAST: config.models.FAST, CHAT: config.models.CHAT, D1: config.models.D1 };
  const originalBaseUrl = config.ollama.baseUrl;
  const originalSignalRecorder = modelUniverseStore.recordSignalEvent;
  const gatewayState = {
    _bindingStartupAuthority: llmGateway._bindingStartupAuthority,
    _bindingArtifactResolver: llmGateway._bindingArtifactResolver,
    _vramFitProfiles: llmGateway._vramFitProfiles,
    currentAuth: llmGateway.currentAuth, callCount: llmGateway.callCount,
    rateLimits: llmGateway.rateLimits,
  };
  const originalAuditLogs = llmGateway.audit.logs;
  const engineState = {
    _overrideCount: creDecisionEngine._overrideCount, _interceptCount: creDecisionEngine._interceptCount,
    _overrideLog: creDecisionEngine._overrideLog, _interceptLog: creDecisionEngine._interceptLog,
  };
  const requests = [];
  const resolvedBindings = [];
  try {
    // A shared FAST/CHAT artifact uses its registered default window. No cache
    // mutation, footprint or GPU observation is needed for these CPU fixtures.
    Object.assign(config.models, { FAST: classifierModel, CHAT: classifierModel, D1: plannerModel });
    config.ollama.baseUrl = baseUrl;
    llmGateway._vramFitProfiles = Object.freeze({}); // preserve documented UNKNOWN handling
    llmGateway.rateLimits = { ...llmGateway.rateLimits, currentMinuteCalls: 0, currentMinuteStart: Date.now() };
    llmGateway.audit.logs = [];
    creDecisionEngine._overrideLog = [];
    creDecisionEngine._interceptLog = [];
    modelUniverseStore.recordSignalEvent = () => ({ ok: true });
    llmGateway.setBindingStartupAuthority({ status: 'DURABLE' }, { resolveArtifact: async value => {
      resolvedBindings.push(value);
      assert.ok(Object.hasOwn(artifacts, value.modelName), 'only the two configured fixture artifacts are eligible');
      return artifacts[value.modelName];
    } });
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      assert.equal(url.origin, baseUrl, 'no actual network or other provider is allowed');
      assert.equal(url.search, '');
      if (url.pathname === '/api/tags') {
        assert.equal(options.method || 'GET', 'GET');
        return Response.json({ models: Object.values(artifacts).map(value => ({ name: value.modelName, digest: value.digestSha256 })) });
      }
      assert.equal(url.pathname, '/api/chat');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body);
      assert.ok(Object.hasOwn(artifacts, body.model), 'CODE and fallback models cannot be requested');
      assert.ok(requests.length < 2, 'only classifier and D1 provider requests are permitted');
      requests.push(body);
      const value = body.model === classifierModel
        ? { intent: 'CREATIVE', confidence: 0.95, fileTarget: null, question: null, continuesPending: false,
          responseScope: 'project', briefResponse: false, responseWordCount: null, requestedOperation: 'none' }
        : { reply: providerReply, plan: providerPlan };
      return Response.json({ model: body.model, digest: artifacts[body.model].digestSha256,
        message: { content: JSON.stringify(value) }, done: true, done_reason: 'stop', prompt_eval_count: 100, eval_count: 40 });
    };

    const response = await projectHandler(request, { project, m2LifecycleOnly: true,
      sessionId: 'natural-d1-boundary', conversationId: 'natural-d1-boundary',
      authenticatedSubject: { actorType: 'user', actorId: 'natural-d1-boundary' },
      history, dbHistory: history, projectWorkingMemory: { goal } });
    assert.deepEqual(requests.map(value => value.model), [classifierModel, plannerModel]);
    assert.equal(requests[0].format, 'json');
    const interpreted = JSON.parse(requests[0].messages.find(message => message.role === 'user').content);
    assert.equal(interpreted.request, request);
    assert.equal(interpreted.goal, goal);
    assert.deepEqual(interpreted.history, [{ role: 'user', content: priorRequest }, { role: 'assistant', content: priorReply }]);
    assert.match(requests[0].messages.find(message => message.role === 'system').content, /responseScope/);
    assert.deepEqual(requests[1].format, PROJECT_DISCUSSION_SCHEMA);
    const planned = JSON.parse(requests[1].messages.find(message => message.role === 'user').content);
    assert.equal(planned.request, request);
    assert.equal(planned.project.id, project.id);
    assert.deepEqual(planned.history, interpreted.history);
    assert.ok(planned.analysis.files.includes('README.md'));
    assert.equal(planned.analysis.fileCount, analysis.fileCount);
    assert.deepEqual(planned.projectWorkEvidence, []);
    assert.equal(requests[0].options.num_ctx, resolveNumCtx(classifierModel));
    assert.equal(requests[0].options.num_predict, 256);
    assert.equal(requests[1].options.num_ctx, resolveNumCtx(plannerModel));
    assert.ok(requests[1].options.num_predict > 0 && requests[1].options.num_predict <= 4000);
    const completed = llmGateway.audit.logs.filter(entry => entry.event === 'LLM_CALL_COMPLETE');
    assert.deepEqual(completed.map(entry => entry.role), ['WORKFLOW_CLASSIFIER', 'WORKFLOW_PLANNER']);
    assert.equal(completed[1].modelRole, 'D1');
    assert.equal(completed[1].purpose, 'answer');
    assert.deepEqual(resolvedBindings.map(value => value.modelName), [classifierModel, plannerModel]);
    assert.equal(response.content, providerReply);
    assert.equal(response.tag.canExecute, false);
    assert.equal(response.tag.metadata.handler, 'project.collaboration');
    const proposal = response.tag.metadata.projectWorkProposal;
    assert.equal(proposal.kind, 'ProjectWorkProposal@1');
    assert.equal(proposal.projectId, project.id);
    assert.equal(proposal.workspaceRevision, analysis.revision);
    assert.deepEqual(proposal.draft.files, providerPlan.files);
    assert.equal(proposal.draft.instruction, providerPlan.instruction);
    assert.equal(proposal.draft.focusedTest.binary, process.execPath);
    assert.equal(response.tag.metadata.inspection.testsExecuted, false);
    assert.deepEqual(authorityCounts(), beforeAuthority);
    assert.deepEqual(await projectSnapshot(), before);
    assert.equal(llmGateway._concurrency.active, 0);
    assert.equal(llmGateway._concurrency.queue.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config.models, originalModels);
    config.ollama.baseUrl = originalBaseUrl;
    modelUniverseStore.recordSignalEvent = originalSignalRecorder;
    Object.assign(llmGateway, gatewayState);
    llmGateway.audit.logs = originalAuditLogs;
    Object.assign(creDecisionEngine, engineState);
  }
});
