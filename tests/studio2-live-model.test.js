import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiveModel } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model');
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store');
const { AppearanceStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store');
const { WorkspaceFiles } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/workspace-files');

function setup({ workspace, m2 } = {}) {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  const store = new SessionStore(storage);
  const appearance = new AppearanceStore(storage);
  const catalog = { view: () => ({ status: 'idle', items: [] }), load: () => {}, subscribe: () => () => {} };
  const files = workspace || { entry: () => ({ tree: [], editor: null }), loadTree: async () => false,
    open: async () => false, save: async () => false, discard: () => {}, edit: () => {} };
  const controller = m2 || { entry: () => ({ view: null, presentedView: null, error: null }), run: async () => {}, report: () => {} };
  const calls = [];
  const widget = { store, appearance, catalog, workspace: files, m2: controller,
    send: async (session, input) => { calls.push(['send', session.id, input.value]); input.value = ''; },
    sendTerminal: async (session, input) => { calls.push(['terminal', session.id, input.value]); input.value = ''; },
    completeTerminal: async (session, input) => { calls.push(['complete', session.id, input.value]); input.value += '/'; },
    pickAttachments: async session => { calls.push(['attach', session.id]); },
    closeSession: session => store.closeSession(session.id) };
  const model = new LiveModel(widget);
  return { model, widget, store, calls, storage };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('live view contains only actual sessions and messages, and swaps column ownership', () => {
  const { model, store } = setup();
  const first = store.focusedSession();
  first._label = 'Moje skutečná relace';
  first.chat.msgs.push({ role: 'user', text: 'Ahoj' }, { role: 'assistant', text: 'Odpověď' });
  const second = store.addSession({ label: 'Druhá skutečná relace' });
  store.setColumnCount(2);
  store.selectInColumn(0, first.id);
  let vm = model.renderVals();
  assert.equal(vm.tabs.length, 2);
  assert.equal(vm.columns[0].title, first._label);
  assert.equal(vm.columns[0].msgs[0].text, 'Ahoj');
  assert.equal(vm.columns[0].msgs[1].paras[0].t, 'Odpověď');
  assert.doesNotMatch(JSON.stringify(vm.columns.map(column => column.title)), /ShellSmith|SystemSmith/);
  model.pPickInCol(model.st(), 0, second.id);
  assert.deepEqual(store.state.columns, [second.id, first.id]);
  vm = model.renderVals();
  assert.equal(vm.columns[0].title, second._label);
  assert.equal(vm.columns[1].title, first._label);
  assert.equal(vm.ws.scm.unavailable, false);
});

test('composer, attachment picker and terminal use widget services without prototype replies', async () => {
  const { model, store, calls } = setup();
  const session = store.focusedSession();
  let column = model.renderVals().columns[0];
  column.setDraft({ target: { value: 'Živý dotaz' } });
  model.renderVals().columns[0].send();
  await tick();
  assert.deepEqual(calls[0], ['send', session.id, 'Živý dotaz']);
  assert.equal(model.st().drafts[session.id], '');
  assert.equal(model.renderVals().columns[0].msgs.length, 0);
  model.renderVals().columns[0].attach();
  await tick();
  assert.deepEqual(calls[1], ['attach', session.id]);
  column = model.renderVals().columns[0];
  column.setCmd({ target: { value: 'pwd' } });
  model.termKey({ key: 'Enter', preventDefault() {} }, session.id);
  await tick();
  assert.deepEqual(calls[2], ['terminal', session.id, 'pwd']);
  assert.equal(model.renderVals().columns[0].term.length, 0);
});

test('file editor opens through WorkspaceFiles and saves through its verified path', async () => {
  const requests = [];
  let current = 'původní';
  const response = body => ({ ok: true, json: async () => body });
  const workspace = new WorkspaceFiles({ backendUrl: () => 'http://studio.test', fetchImpl: async (url, options = {}) => {
    requests.push([url, options.method || 'GET']);
    if (url.includes('/api/workspace/tree')) return response({ root: '/safe/project', tree: [{ n: 'app.txt', d: false }] });
    if (options.method === 'POST') { current = JSON.parse(options.body).content; return response({ ok: true, path: 'app.txt' }); }
    return response({ path: 'app.txt', content: current, hash: 'hash-' + current });
  } });
  const { model, store } = setup({ workspace });
  const session = store.focusedSession();
  session._projectId = '17';
  assert.equal(await workspace.loadTree(session), true);
  model.pOpenFile(model.st(), session.id, { path: 'app.txt', from: 'soubory', mode: 'upravy' });
  await tick();
  let file = model.renderVals().ws.fvS;
  assert.equal(file.isOpen, true);
  assert.equal(file.draft, 'původní');
  file.setDraft({ target: { value: 'upravené' } });
  file = model.renderVals().ws.fvS;
  assert.equal(file.dirty, true);
  const guard = model.pOpenFile(model.st(), session.id, null);
  assert.equal(guard.fileGuard.sid, session.id);
  assert.equal(requests.filter(([, method]) => method === 'POST').length, 0);
  await file.save();
  assert.equal(requests.filter(([, method]) => method === 'POST').length, 1);
  assert.equal(workspace.entry(session).editor.dirty, false);
  assert.equal(model.renderVals().ws.fvS.draft, 'upravené');
});

test('M2 approval needs the bound digest and rendered changes panel', async () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  const calls = [];
  const entry = { view: null, presentedView: null, error: null, busy: false };
  const m2 = { entry: () => entry, run: async (session, command) => { calls.push(command); }, report: () => {} };
  const { model, store } = setup({ m2 });
  const session = store.focusedSession();
  session._projectId = '17'; session._convId = 'conv-17';
  session._m2Pending = { lifecycleId: 'life-17', planDigest: digest,
    origin: { surface: 'studio', sessionId: 'conv-17', conversationId: 'conv-17', projectId: 17 } };
  entry.view = { state: 'awaiting_approval', lifecycleId: 'life-17', planDigest: digest,
    plan: { focusedTest: { binary: 'node', argv: ['test.js'] }, gitCommit: false },
    diff: [{ path: 'app.txt', before: { content: 'a' }, after: { content: 'b' } }] };
  model.pApprove(model.st(), session.id, 'ok');
  assert.deepEqual(calls, []);
  model.setState({ rightTab: 'zmeny' });
  const vm = model.renderVals();
  assert.equal(vm.ws.m2Digest, digest);
  assert.equal(vm.ws.files[0].open, true);
  assert.equal(entry.presentedView, entry.view);
  vm.ws.approve();
  await tick();
  assert.deepEqual(calls, ['/m2-approve']);
  entry.view = { ...entry.view, planDigest: 'sha256:' + 'b'.repeat(64) };
  model.pApprove(model.st(), session.id, 'ok');
  assert.deepEqual(calls, ['/m2-approve']);
});

const { DevelopmentClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/development-client');

test('system settings use observed backend and exact installation approval', async () => {
  const calls = [];
  const reply = value => ({ ok: true, json: async () => value });
  const client = new DevelopmentClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    calls.push([path, options.method, body]);
    if (path === '/api/development/environment') return reply({ platform: 'linux', distribution: 'Test Linux', architecture: 'x64', runtime: { node: '24.0.0' }, tools: { git: '/usr/bin/git', npm: null }, observation: 'Observed executable presence.' });
    if (path === '/api/development/policy' && options.method === 'GET') return reply({ valid: true, revision: 7, projectMode: 'ask', sdkMode: 'ask' });
    if (path === '/api/development/policy') return reply({ valid: true, revision: 8, projectMode: body.projectMode, sdkMode: body.sdkMode });
    if (path === '/api/development/installations') return reply([]);
    if (path === '/api/projects') return reply({ projects: [{ id: 17, name: 'Projekt 17' }] });
    if (path === '/api/development/prepare') return reply({ id: 'plan-17', digest: 'sha256:exact', state: 'pending', plan: { projectId: 17, kind: 'npm', destination: '/safe/node_modules', command: 'npm ci --offline', artifacts: [] }, events: [] });
    if (path === '/api/development/execute') return reply({ id: 'plan-17', digest: body.digest, state: 'succeeded', plan: { projectId: 17, kind: 'npm', destination: '/safe/node_modules' }, events: [] });
    throw Error('Unexpected request ' + path);
  } });
  assert.equal(client.vm().policyDisabled, true, 'policy cannot be changed from unverified defaults');
  await client.refresh();
  assert.equal(client.vm().os, 'Test Linux');
  assert.equal(client.vm().tools, 'git');
  assert.equal(client.vm().projectMode, 'ask');
  client.vm().setProjectMode({ target: { value: 'automatic' } });
  await client.vm().savePolicy();
  assert.deepEqual(calls.find(([path, method]) => path === '/api/development/policy' && method === 'PUT')[2],
    { revision: 7, projectMode: 'automatic', sdkMode: 'ask' });
  client.vm().setProject({ target: { value: '17' } });
  await client.vm().prepare();
  assert.equal(client.vm().hasPlan, true);
  assert.equal(calls.filter(([path]) => path === '/api/development/execute').length, 0, 'ask plan waits for approval');
  await client.vm().execute();
  assert.deepEqual(calls.find(([path]) => path === '/api/development/execute')[2],
    { id: 'plan-17', digest: 'sha256:exact', approval: true });
  assert.equal(client.vm().planState, 'Instalace dokončena');
  client.destroy();
});

test('development policy remains fail closed after unavailable backend', async () => {
  const client = new DevelopmentClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => { throw Error('offline'); } });
  await client.refresh();
  assert.equal(client.vm().hasError, true);
  assert.equal(client.vm().policyDisabled, true);
  await client.vm().savePolicy();
  assert.equal(client.vm().error, 'Politika není načtená.');
  client.destroy();
});

const { ScmClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/scm-client');

test('live SCM panel maps backend files and prepares exact effects instead of changing local fixture', async () => {
  const { model, store } = setup();
  const session = store.focusedSession(); session._projectId = 17;
  const e = model.scmClient.entry(17);
  Object.assign(e, { status: 'ready', data: { projectId: 17, isRepo: true, branch: 'main',
    upstream: '', ahead: 0, behind: 0, fetchedAt: null, files: [{ path: 'src/app.js', staged: false,
      unstaged: true, untracked: false, conflicted: false, x: ' ', y: 'M', added: 3, removed: 1 }] },
    branches: { branches: [{ name: 'main', remote: false }] }, log: { commits: [] },
    policy: { projectId: 17, revision: 0, init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] } });
  const actions = [];
  model.scmClient.prepare = async (...args) => { actions.push(args); return true; };
  let vm = model.renderVals().ws.scm;
  assert.equal(vm.isRepo, true);
  assert.equal(vm.groups.find(group => group.label === 'Změny').rows[0].addText, '+3');
  vm.groups.find(group => group.label === 'Změny').rows[0].act();
  await tick();
  assert.deepEqual(actions[0], [17, 'stage', { paths: ['src/app.js'] }, null]);
  assert.equal(e.data.files[0].staged, false, 'stage waits for server plan and approval');
  vm.setMsg({ target: { value: 'Reviewed message' } });
  vm = model.renderVals().ws.scm;
  assert.equal(vm.msg, 'Reviewed message', 'commit draft survives render');
  vm.commit(); await tick();
  assert.equal(actions.length, 1, 'commit needs a staged file');
  e.data.files[0].staged = true; e.data.files[0].x = 'M'; e.data.files[0].y = ' ';
  model.renderVals().ws.scm.commit(); await tick();
  assert.deepEqual(actions[1], [17, 'commit', { message: 'Reviewed message', all: false }, null]);
});

test('SCM client requires server plan digest and explicit confirmation before execute', async () => {
  const calls = [];
  const client = new ScmClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    calls.push([path, body]);
    if (path === '/api/scm/prepare') return { ok: true, json: async () => ({ planId: 'p17', digest: 'sha256:exact', state: 'pending', plan: { projectId: 17, op: 'stage', args: { paths: ['app.js'] } } }) };
    if (path === '/api/scm/execute') return { ok: true, json: async () => ({ planId: 'p17', state: 'succeeded' }) };
    if (path === '/api/scm/status') return { ok: true, json: async () => ({ projectId: 17, isRepo: true, files: [] }) };
    if (path === '/api/scm/branches') return { ok: true, json: async () => ({ branches: [] }) };
    if (path === '/api/scm/log') return { ok: true, json: async () => ({ commits: [] }) };
    if (path === '/api/scm/policy') return { ok: true, json: async () => ({ projectId: 17, revision: 0 }) };
    if (path === '/api/scm/operations') return { ok: true, json: async () => [{ planId: 'p17', state: 'succeeded', plan: { projectId: 17, op: 'stage' }, events: [{ kind: 'succeeded', occurredAt: 123, detail: {} }] }] };
    throw Error('Unexpected ' + path);
  } });
  assert.equal(await client.execute(17), false);
  assert.equal(calls.length, 0);
  assert.equal(await client.prepare(17, 'stage', { paths: ['app.js'] }), true);
  assert.equal(calls.filter(([path]) => path === '/api/scm/execute').length, 0);
  assert.equal(await client.execute(17), true);
  assert.deepEqual(calls.find(([path]) => path === '/api/scm/execute')[1],
    { planId: 'p17', digest: 'sha256:exact', confirm: true });
  client.destroy();
});

test('project detail saves only per-project SCM policy with CAS revision', async () => {
  const { model, store } = setup();
  const session = store.focusedSession(); session._projectId = 17;
  const e = model.scmClient.entry(17);
  e.status = 'ready'; e.policy = { projectId: 17, revision: 4, init: 'automatic', commit: 'ask', branch: 'ask',
    fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] };
  let sent;
  model.scmClient.setPolicy = async (id, patch) => { sent = [id, patch]; return true; };
  let policy = model.scmPolicyVM(model.st(), 17);
  policy.fields.find(item => item.key === 'pull').change({ target: { value: 'automatic' } });
  policy = model.scmPolicyVM(model.st(), 17);
  policy.setRemoteName({ target: { value: 'origin' } });
  policy.setRemoteHost({ target: { value: 'github.com' } });
  policy = model.scmPolicyVM(model.st(), 17);
  policy.addRemote();
  policy = model.scmPolicyVM(model.st(), 17);
  assert.deepEqual(policy.remotes.map(item => [item.name, item.host]), [['origin', 'github.com']]);
  await policy.save();
  assert.deepEqual(sent, [17, { init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled',
    pull: 'automatic', push: 'ask', remotes: [{ name: 'origin', host: 'github.com' }] }]);
  assert.equal(model.st().scm[17], undefined, 'policy is not stored in generic prototype settings');
});

test('SCM execute never retries a lost response and reads durable terminal audit', async () => {
  const calls = [];
  const reply = value => ({ ok: true, json: async () => value });
  const client = new ScmClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options = {}) => {
    const endpoint = new URL(url).pathname;
    calls.push(endpoint);
    if (endpoint === '/api/scm/prepare') return reply({ planId: 'p17', digest: 'sha256:exact', state: 'pending', plan: { projectId: 17, op: 'commit' } });
    if (endpoint === '/api/scm/execute') throw Error('connection lost');
    if (endpoint === '/api/scm/status') return reply({ projectId: 17, isRepo: true, files: [] });
    if (endpoint === '/api/scm/branches') return reply({ branches: [] });
    if (endpoint === '/api/scm/log') return reply({ commits: [] });
    if (endpoint === '/api/scm/policy') return reply({ projectId: 17, revision: 0 });
    if (endpoint === '/api/scm/operations') return reply([{ planId: 'p17', state: 'interrupted',
      plan: { projectId: 17, op: 'commit' }, events: [{ kind: 'interrupted', occurredAt: 123, detail: { retried: false } }] }]);
    throw Error('Unexpected ' + endpoint);
  } });
  await client.prepare(17, 'commit', { message: 'Reviewed' });
  assert.equal(await client.execute(17), false);
  assert.equal(client.entry(17).plan, null);
  assert.equal(client.entry(17).operations[0].state, 'interrupted');
  assert.match(client.entry(17).error, /Výsledek operace není potvrzen/);
  assert.equal(await client.execute(17), false);
  assert.equal(calls.filter(endpoint => endpoint === '/api/scm/execute').length, 1);
  client.destroy();
});

test('prototype appearance controls persist every visible choice including 125 percent scale', () => {
  const { model, widget, storage } = setup();
  model.setState({ ff: 'inter', bright: 115, col: false, cacc: 'custom', caccHex: '#123456',
    cbg: 'custom', cbgHex: '#112233', scale: '125' });
  const saved = JSON.parse(storage.getItem('intentsmith-studio2-appearance'));
  assert.equal(saved.fontIdx, 1);
  assert.equal(saved.brightness, 115);
  assert.equal(saved.autoCollapse, false);
  assert.equal(saved.accentHex, '#123456');
  assert.equal(saved.bgHex, '#112233');
  assert.equal(saved.uiScale, '1.25');
  const reopened = new AppearanceStore(storage);
  assert.equal(reopened.values.uiScale, '1.25');
  assert.equal(model.st().scale, '125');
  assert.equal(model.st().ff, 'inter');
  assert.equal(widget.appearance.values.accentIdx, 'custom');
});


test('SCM lists partly staged file twice and renders backend diff in right panel', () => {
  const { model, store } = setup();
  const session = store.focusedSession(); session._projectId = 17;
  const e = model.scmClient.entry(17);
  Object.assign(e, { status: 'ready', data: { projectId: 17, isRepo: true, branch: 'main', files: [{
    path: 'app.txt', staged: true, unstaged: true, untracked: false, conflicted: false, x: 'M', y: 'M',
    stagedAdded: 1, stagedRemoved: 0, unstagedAdded: 2, unstagedRemoved: 1 }] },
    branches: { branches: [] }, log: { commits: [] }, policy: { projectId: 17, revision: 0,
      init: 'automatic', commit: 'ask', branch: 'ask', fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] } });
  let groups = model.renderVals().ws.scm.groups;
  assert.equal(groups.find(group => group.label === 'Připravené').rows[0].addText, '+1');
  assert.equal(groups.find(group => group.label === 'Změny').rows[0].addText, '+2');
  e.diffs.set('unstaged|app.txt', 'diff --git a/app.txt b/app.txt\n@@ -1 +1,2 @@\n-old\n+new');
  model.setState({ rightTab: 'scm', fileView: { [session.id]: { path: 'app.txt', from: 'scm', staged: false } },
    fileMode: { [session.id]: 'diff' } });
  const vm = model.renderVals().ws.fvG;
  assert.equal(vm.isDiff, true);
  assert.ok(vm.diff.some(line => line.sign === '+' && line.code === 'new'));
  groups = model.renderVals().ws.scm.groups;
  assert.equal(groups.length, 2);
});


test('specialist detail activates backend identity before showing a new session', async () => {
  const { model, widget, store } = setup();
  widget.catalog.view = section => ({ status: 'ready', items: section === 'Specialisté'
    ? [{ id: 'specialist-9', name: 'Testovací specialista', description: 'Popis', raw: { id: 'specialist-9' } }] : [] });
  const calls = [];
  widget.openSpecialist = async item => { calls.push(item.id); store.addSession({ label: item.name,
    convId: 'studio-specialist-verified', specialistData: { id: item.id, name: item.name } }); return true; };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: 'specialist-9' } });
  const detail = model.renderVals().dt;
  assert.equal(detail.hasPrimary, true);
  detail.onPrimary();
  await tick();
  assert.deepEqual(calls, ['specialist-9']);
  assert.equal(model.st().mode, 'sessions');
  assert.equal(store.focusedSession().chat.specialist.id, 'specialist-9');
});

test('project detail waits for real conversations, validates scope, and opens selected saved chat', async () => {
  const { model, widget, store } = setup();
  widget.catalog.view = section => ({ status: 'ready', items: section === 'Projekty'
    ? [{ id: '17', name: 'Projekt 17', description: 'Skutečný projekt', state: 'active', raw: { id: 17, path: '/safe/project' } }] : [] });
  let resolveList;
  widget.catalog.get = async path => {
    assert.equal(path, '/api/projects/17/conversations?limit=50&status=all');
    return new Promise(resolve => { resolveList = resolve; });
  };
  const opened = [];
  widget.openCatalogItem = async (section, item) => { opened.push([section, item.id]);
    store.addSession({ convId: item.id, projectId: 17, label: item.name }); return true; };
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '17' } });
  model.pSelect(model.st(), 'projects', '17');
  let vm = model.renderVals().dt;
  assert.equal(vm.props.find(prop => prop.k === 'Konverzací').v, '—');
  assert.match(vm.blocks[0].empty, /Načítám/);
  resolveList({ conversations: [{ id: 88, project_id: 17, title: 'Opravdová konverzace' }] });
  await tick();
  vm = model.renderVals().dt;
  assert.equal(vm.props.find(prop => prop.k === 'Konverzací').v, '1');
  assert.equal(vm.blocks[0].rows[0].t, 'Opravdová konverzace');
  vm.blocks[0].rows[0].go();
  await tick();
  assert.deepEqual(opened, [['Konverzace', '88']]);
  assert.equal(model.st().mode, 'sessions');
  assert.equal(store.focusedSession()._convId, '88');
  const bad = model.loadProjectConversations('17');
  resolveList({ conversations: [{ id: 99, project_id: 18, title: 'Cizí' }] });
  await bad;
  model.setState({ mode: 'section' });
  assert.match(model.renderVals().dt.blocks[0].empty, /jiného projektu/);
  assert.equal(model.renderVals().dt.props.find(prop => prop.k === 'Konverzací').v, '—');
});

const { StatusClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/status-client');

test('status line reports observed backend, DB, GPU capacity and failure independently', async () => {
  const calls = [];
  let dbAvailable = true;
  const client = new StatusClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    if (path === '/api/health') return { ok: true, json: async () => ({ ready: true, version: '136.2.0' }) };
    if (path === '/api/system/info' && !dbAvailable) throw Error('offline');
    if (path === '/api/system/info') return { ok: true, json: async () => ({ db: { size_mb: 23.5 } }) };
    if (path === '/api/system/gpu') return { ok: true, json: async () => ({ profile: { capacityOnly: true,
      gpus: [{ gpu_model: 'Example GPU', vram_mb: 24576 }] } }) };
    throw Error('unexpected request');
  } });
  assert.equal(client.vm({ connection: 'Připojeno' }).db, 'DB nedostupné');
  await client.refresh();
  const status = client.vm({ connection: 'Připojeno' });
  assert.equal(status.dot, 'ok');
  assert.equal(status.backend, 'backend 136.2.0');
  assert.equal(status.ws, 'ws :3335');
  assert.equal(status.db, 'DB 23,5 MiB');
  assert.equal(status.gpu, 'GPU kapacita 24 GiB');
  assert.equal(client.vm({ connection: 'Odpojeno' }).dot, 'err');
  dbAvailable = false;
  await client.refresh();
  assert.equal(client.vm({ connection: 'Připojeno' }).db, 'DB nedostupné');
  assert.equal(client.vm({ connection: 'Připojeno' }).gpu, 'GPU kapacita 24 GiB');
  assert.equal(calls.length, 6);
  client.destroy();
});

test('rendered status line does not expose prototype DB or GPU numbers', () => {
  const { model, widget } = setup();
  widget.transport = { connection: 'Odpojeno', serverVersion: null };
  const status = model.renderVals().sb;
  assert.equal(status.connection, 'Odpojeno');
  assert.equal(status.dot, 'err');
  assert.equal(status.db, 'DB nedostupné');
  assert.equal(status.gpu, 'GPU nezjištěno');
  assert.doesNotMatch(JSON.stringify(status), /134 MiB|18,3 \/ 24,0|57 °C|136\.1\.0/);
});

test('conversation audit loads only when opened and shows backend records without fixture data', async () => {
  const { model, store, widget } = setup();
  const session = store.focusedSession();
  session._convId = 'conversation/17';
  widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  const urls = [];
  model.fetchImpl = async url => {
    urls.push(url);
    return { ok: true, json: async () => ({
      audit: [{ created_at: '2026-09-25T14:02:45Z', expertise_name: 'Vývojář', verdict: 'ok' }],
      drift: [{ created_at: '2026-09-25T14:03:00Z', capability: 'fs.write', drift_score: 0.25 }],
    }) };
  };
  assert.equal(urls.length, 0, 'render must not read audit or cause effects');
  let column = model.renderVals().columns[0];
  assert.equal(urls.length, 0);
  column.btabs.find(tab => tab.label === 'Audit').go();
  await tick();
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).searchParams.get('conversation_id'), session._convId);
  column = model.renderVals().columns[0];
  assert.deepEqual(column.audit.map(row => row.e), ['DRIFT', 'MERGE']);
  assert.match(column.audit[0].m, /fs\.write/);
  column.btabs.find(tab => tab.label === 'Audit').go();
  await tick();
  assert.equal(urls.length, 1, 'recent audit is cached');
  model._audit.get(session._convId).time = 0;
  model.fetchImpl = async () => { throw Error('backend offline'); };
  model.renderVals().columns[0].btabs.find(tab => tab.label === 'Audit').go();
  await tick();
  assert.equal(model.renderVals().columns[0].audit.at(-1).e, 'CHYBA AUDITU');
});

test('deleted tracked file opens its Git diff without presenting an empty editable file', async () => {
  const { model, store } = setup();
  const session = store.focusedSession();
  session._projectId = 17;
  const e = model.scmClient.entry(17);
  e.diffs.set('unstaged|deleted.txt', 'diff --git a/deleted.txt b/deleted.txt\n@@ -1 +0,0 @@\n-old');
  model.pOpenFile(model.st(), session.id, { path: 'deleted.txt', from: 'scm', mode: 'diff', staged: false });
  await tick();
  const file = model.renderVals().ws.fvG;
  assert.equal(file.isOpen, true);
  assert.equal(file.isDiff, true);
  assert.equal(file.diff[1].code, 'old');
  assert.equal(file.modes.find(mode => mode.label === 'Upravit').cls, 'off');
  assert.equal(model.renderVals().ws.fvS.isOpen, false);
});
