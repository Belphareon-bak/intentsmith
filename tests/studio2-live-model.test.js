import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiveModel } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model');
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store');
const { AppearanceStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store');
const { WorkspaceFiles } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/workspace-files');
const { CatalogStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/catalog-store');
const { IntentSmithBus } = require('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/event-bus');

function setup({ workspace, m2, catalog: catalogOverride, specialistFiles } = {}) {
  const memory = new Map();
  const storage = { getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, value) };
  const store = new SessionStore(storage);
  const appearance = new AppearanceStore(storage);
  const catalog = catalogOverride || { view: () => ({ status: 'idle', items: [] }), load: () => {}, subscribe: () => () => {} };
  const files = workspace || { entry: () => ({ tree: [], editor: null }), loadTree: async () => false,
    open: async () => false, save: async () => false, discard: () => {}, edit: () => {} };
  const controller = m2 || { entry: () => ({ view: null, presentedView: null, error: null }), run: async () => {}, report: () => {} };
  const calls = [];
  const widget = { store, appearance, catalog, workspace: files, m2: controller, specialistFiles,
    addSession: slot => store.addSession({}, { slot }),
    send: async (session, input) => { calls.push(['send', session.id, input.value]); input.value = ''; },
    sendTerminal: async (session, input) => { calls.push(['terminal', session.id, input.value]); input.value = ''; },
    completeTerminal: async (session, input) => { calls.push(['complete', session.id, input.value]); input.value += '/'; },
    pickAttachments: async session => { calls.push(['attach', session.id]); },
    closeSession: session => store.closeSession(session.id) };
  const model = new LiveModel(widget);
  return { model, widget, store, calls, storage };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('classic attachment metadata survives restart without becoming a project file or crashing the view', () => {
  const { model, store } = setup();
  const session = store.focusedSession();
  const legacy = [{ name: 'scan.heic', size: '6715 KB', addedAt: 123, type: 'attachment' },
    { name: 'report.pdf', size: '33 KB', type: 'attachment', path: 'private/report.pdf' },
    { name: 'notes.txt', path: 'docs/notes.txt' }, 'src/main.js', null, 42, { path: false }];
  session._focusFiles = legacy;
  store.changed();
  assert.deepEqual(new SessionStore(store.storage).focusedSession()._focusFiles, legacy);
  assert.doesNotThrow(() => model.renderVals());
  assert.deepEqual(model.sess(session.id).ctxFiles, [['scan.heic', 'Příloha · 6715 KB'],
    ['report.pdf', 'Příloha · 33 KB'], ['docs/notes.txt', ''], ['src/main.js', '']]);
  assert.deepEqual(model.filesVM(session.id, model.st()).opened.map(file => file.path),
    ['docs/notes.txt', 'src/main.js']);
});

test('conversation and specialist opening labels follow session state and an open session can be ended from its detail', () => {
  const catalog = { view: section => ({ status: 'ready', items: section === 'Konverzace'
    ? [{ id: 'saved', name: 'Uložená práce' }] : section === 'Specialisté'
      ? [{ id: 'alpha', name: 'Alpha', raw: { status: 'enabled' } }] : [] }),
    load: () => {}, subscribe: () => () => {} };
  const { model, store } = setup({ catalog });
  const first = store.focusedSession();
  first.chat.msgs = [{ role: 'user', text: 'Moje práce' }];
  let state = { ...model.st(), section: 'chats', detail: { chats: first.id } };
  const open = model.detailVM(state);
  assert.equal(open.primaryLabel, 'Přepnout na relaci');
  assert.equal(open.title, 'Moje práce');
  assert.equal(open.secondary[0].label, 'Ukončit relaci');
  state = { ...model.st(), section: 'chats', detail: { chats: 'saved' } };
  assert.equal(model.detailVM(state).primaryLabel, 'Otevřít v nové relaci');
  assert.equal(model.detailVM({ ...state, section: 'specialists', detail: { specialists: 'alpha' } }).primaryLabel,
    'Otevřít v nové relaci');
  first._convId = 'saved';
  assert.equal(model.detailVM(state).primaryLabel, 'Přepnout na relaci');
  open.secondary[0].go();
  assert.equal(store.state.sessions.length, 0);
  state = { ...model.st(), section: 'chats', detail: { chats: 'saved' } };
  assert.equal(model.detailVM(state).primaryLabel, 'Otevřít');
  assert.equal(model.detailVM({ ...state, section: 'specialists', detail: { specialists: 'alpha' } }).primaryLabel,
    'Otevřít');
  model.componentWillUnmount();
});

test('specialist workspace files stay local until explicitly attached and can be shared or removed', async () => {
  const rows = new Map([
    ['alpha', [{ id: 'a1', owner: 'alpha', name: 'notes.txt', size: 7, type: 'text/plain', blob: new Blob(['private']) }]],
    ['beta', [{ id: 'b1', owner: 'beta', name: 'guide.md', size: 5, type: 'text/plain', blob: new Blob(['guide']) }]],
  ]);
  const specialistFiles = {
    list: async owner => (rows.get(owner) || []).map(({ blob, ...row }) => row),
    get: async (owner, id) => {
      const row = (rows.get(owner) || []).find(entry => entry.id === id);
      if (!row) throw Error('Wrong owner');
      return row;
    },
    share: async (from, to, id) => {
      const row = await specialistFiles.get(from, id);
      rows.get(to).push({ ...row, owner: to, id: 'copy' });
    },
    remove: async (owner, id) => rows.set(owner, rows.get(owner).filter(row => row.id !== id)),
  };
  const catalog = { view: section => section === 'Specialisté'
    ? { status: 'ready', items: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }] }
    : { status: 'ready', items: [] }, load: async () => {}, subscribe: () => () => {} };
  const { model, widget, store } = setup({ catalog, specialistFiles });
  const session = store.focusedSession();
  session.chat.specialist = { id: 'alpha', name: 'Alpha' };
  widget.confirmAction = () => true;
  let vm = model.filesVM(session.id, model.st()).specialistFiles;
  assert.equal(vm.has, true);
  await tick();
  vm = model.filesVM(session.id, model.st()).specialistFiles;
  assert.deepEqual(vm.rows.map(row => row.name), ['notes.txt']);
  assert.equal(session.chat.attachments.length, 0);
  assert.equal(await vm.rows[0].preview(), true);
  assert.equal(model.filesVM(session.id, model.st()).specialistFiles.previewText, 'private');
  assert.equal(session.chat.attachments.length, 0, 'preview must not attach or send content');
  assert.equal(await model.attachSpecialistFile('beta', rows.get('beta')[0], session), false,
    'a session cannot attach another specialist owner directly');
  assert.equal(await vm.rows[0].attach(), true);
  assert.equal(session.chat.attachments[0].name, 'notes.txt');
  assert.equal(await vm.share(), true);
  vm = model.filesVM(session.id, model.st()).specialistFiles;
  assert.deepEqual(vm.shareChoices.map(choice => choice.label), ['guide.md · Beta']);
  assert.equal(await vm.shareChoices[0].go(), true);
  vm = model.filesVM(session.id, model.st()).specialistFiles;
  assert.deepEqual(vm.rows.map(row => row.name), ['notes.txt', 'guide.md']);
  assert.equal(await vm.rows[0].remove(), true);
  assert.deepEqual(model.filesVM(session.id, model.st()).specialistFiles.rows.map(row => row.name), ['guide.md']);
  model.componentWillUnmount();
});

test('specialist detail loads saved conversation history and opens the chosen identity', async () => {
  let invalid = false;
  const calls = [];
  const catalog = { view: section => section === 'Specialisté'
    ? { status: 'ready', items: [{ id: 'alpha', name: 'Alpha', description: '', raw: { status: 'enabled' } }] }
    : { status: 'ready', items: [] }, subscribe: () => () => {},
    get: async path => {
      calls.push(path);
      return { conversations: invalid ? [{ id: 'conv-a', state: 'deleted' }]
        : [{ id: 'conv-a', title: 'Uložená práce', state: 'active', updated_at: '2026-09-26' }] };
    } };
  const { model, widget } = setup({ catalog });
  widget.openSpecialistConversation = async (id, item) => { calls.push([id, item.id]); return true; };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: 'alpha' },
    dtab: { 'specialists:alpha': 'konverzace' } });
  await model.loadSpecialistConversations('alpha');
  let detail = model.detailVM(model.st());
  assert.deepEqual(detail.tabs.map(tab => tab.label), ['Přehled', 'Konverzace', 'Nástroje', 'Nastavení']);
  assert.equal(detail.blocks[0].rows[0].t, 'Uložená práce');
  detail.blocks[0].rows[0].go();
  await tick();
  assert.deepEqual(calls, ['/api/conversations?limit=100&specialistId=alpha', ['alpha', 'conv-a']]);
  assert.equal(model.st().mode, 'sessions');
  invalid = true;
  await model.loadSpecialistConversations('alpha');
  detail = model.detailVM({ ...model.st(), mode: 'section', section: 'specialists' });
  assert.match(detail.blocks[0].empty, /neplatnou konverzaci/);
  assert.equal(detail.blocks[0].rows.length, 0);
  model.componentWillUnmount();
});

test('model command in menu and palette opens live role assignments without a fixture model name', () => {
  const { model, store } = setup();
  const selected = [];
  model.modelWorkspace.select = tab => selected.push(tab);
  model.modelWorkspace.load = () => {};
  const sessionId = store.focusedSession().id;
  const menu = model.menusVM(model.st(), sessionId).flatMap(group => group.items)
    .find(item => item.t === 'Změnit model…');
  assert.notEqual(menu.cls, 'dis');
  menu.go();
  assert.equal(model.st().section, 'settings');
  assert.equal(model.st().detail.settings, 'modely');
  model.setState({ palette: true, pq: 'model' });
  const command = model.palVM(model.st(), sessionId).pal.flatMap(group => group.items)
    .find(item => item.t === 'Změnit model');
  assert.equal(command.s, 'Otevřít přiřazení modelových rolí');
  command.go();
  assert.deepEqual(selected, ['roles', 'roles']);
  model.componentWillUnmount();
});

test('composer reads the configured CHAT binding once without contacting the model provider', async () => {
  const paths = [];
  const catalog = { view: () => ({ status: 'idle', items: [] }), load: () => {},
    subscribe: () => () => {}, get: async path => {
      paths.push(path);
      assert.equal(path, '/api/system/upgrades/bindings');
      return { bindings: { CHAT: 'local-chat:27b' } };
    } };
  const { model } = setup({ catalog });
  model.renderVals();
  model.renderVals();
  assert.deepEqual(paths, [], 'rendering alone performs no network request');
  await model.loadChatModel();
  const columns = model.renderVals().columns;
  assert.equal(columns[0].model, 'local-chat:27b');
  assert.deepEqual(paths, ['/api/system/upgrades/bindings']);
  model.renderVals();
  assert.equal(paths.length, 1);
  model.componentWillUnmount();
});

test('project menu actions open the project wizard in the requested mode', () => {
  const { model, store } = setup();
  model.loadProjectDefaults = () => {};
  const choose = label => {
    const item = model.menusVM(model.st(), store.focusedSession().id)
      .flatMap(menu => menu.items).find(row => row.t === label);
    assert.ok(item);
    item.go();
    assert.equal(model.st().section, 'projects');
    assert.equal(model.st().detail.projects, '__new__');
  };
  choose('Otevřít projekt…');
  assert.equal(model.st().projectMode, 'open');
  choose('Nový projekt…');
  assert.equal(model.st().projectMode, 'create');
  let prevented = false;
  model.onKey({ key: 'o', ctrlKey: true, altKey: false, shiftKey: false,
    preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
  assert.equal(prevented, true);
  assert.equal(model.st().projectMode, 'open');
  assert.equal(model.st().detail.projects, '__new__');
  model.componentWillUnmount();
});

test('column close ends the real session and leaves other conversations available', () => {
  const dirty = new Set();
  const workspace = { entry: session => ({ editor: { dirty: dirty.has(session.id) } }) };
  const { model, store, storage, widget } = setup({ workspace });
  widget.closeSession = session => !dirty.has(session.id) && store.closeSession(session.id);
  const first = store.focusedSession();
  const second = store.addSession();
  const third = store.addSession();
  dirty.add(third.id);
  assert.equal(model.renderVals().columns[2].closeCol(), false);
  assert.equal(store.state.sessions.length, 3);
  dirty.clear();
  model.renderVals().columns[2].closeCol();
  assert.deepEqual(store.state.sessions.map(session => session.id), [first.id, second.id]);
  assert.deepEqual(new SessionStore(storage).state.sessions.map(session => session.id), [first.id, second.id]);
  model.componentWillUnmount();
});

test('left navigation Ctrl click shows a hidden session beside the focused column', () => {
  const { model, store, storage } = setup();
  const first = store.focusedSession();
  const second = store.addSession();
  const third = store.addSession();
  const fourth = store.addSession();
  assert.equal(store.state.columns.includes(first.id), false);
  model.pShowSession(model.st(), first.id, { ctrlKey: true });
  assert.equal(store.state.columns.includes(first.id), true);
  assert.equal(store.state.columns.length, 3);
  assert.equal(store.state.sessions.length, 4);
  assert.deepEqual(new SessionStore(storage).state.columns, store.state.columns);
  model.componentWillUnmount();
});

test('conversation context renames and archives only after backend readback', async () => {
  const record = { id: 'conv-context-1', title: 'Původní', state: 'active' };
  let calls = 0;
  const catalog = { backendUrl: () => 'http://127.0.0.1:3335',
    subscribe: () => () => {}, view: name => ({ status: 'ready', items: name === 'Konverzace' && record.state === 'active'
      ? [{ id: record.id, name: record.title, raw: { ...record } }] : [] }),
    get: async path => { assert.equal(path, '/api/conversations/' + record.id);
      return { conversation: { ...record } }; }, load: async () => {} };
  const { model, widget, store } = setup({ catalog });
  const session = store.focusedSession();
  session._convId = record.id;
  widget.promptAction = () => 'Nový název';
  widget.confirmAction = () => true;
  model.fetchImpl = async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/conversations/' + record.id
      + (options.method === 'PATCH' ? '/archive' : ''));
    if (options.method === 'PUT') record.title = JSON.parse(options.body).title;
    if (options.method === 'PATCH') record.state = 'archived';
    return { ok: true, json: async () => ({ success: true }) };
  };
  model.setState({ ctx: { sec: 'chats', id: record.id, x: 0, y: 0 } });
  const rename = model.ctxVM(model.st()).ctxItems.find(item => item.t === 'Přejmenovat…');
  assert.notEqual(rename.cls, 'dis');
  assert.equal(await model.conversationAction(record.id, 'rename'), true, widget.catalogActionError);
  assert.equal(session._label, 'Nový název');
  assert.equal(new SessionStore(store.storage).focusedSession()._label, 'Nový název');
  assert.equal(await model.conversationAction(record.id, 'archive'), true, widget.catalogActionError);
  assert.equal(calls, 2);
  assert.equal(store.find(session.id), null);
  assert.equal(record.state, 'archived');
  model.componentWillUnmount();
});

test('disabled specialist remains manageable and enables only after detail and catalog readback', async () => {
  const raw = { id: 'specialist-one', name: 'Specialista', status: 'disabled', version: '1.0.0',
    domain: 'analysis', tools: ['file.read'] };
  const catalog = { backendUrl: () => 'http://127.0.0.1:3335', subscribe: () => () => {},
    view: name => ({ status: 'ready', items: name === 'Specialisté' ? [{ id: raw.id, name: raw.name,
      description: 'Pomáhá s analýzou.', raw: { ...raw } }] : [] }),
    get: async path => { assert.equal(path, '/api/specialists/' + raw.id);
      return { ok: true, id: raw.id, status: raw.status, version: raw.version,
        manifest: { description: 'Ověřený manifest' }, tools: raw.tools,
        isRegistered: raw.status === 'enabled' }; }, load: async () => {} };
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  model.fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/specialists/' + raw.id + '/enable');
    assert.equal(options.method, 'POST');
    raw.status = 'enabled';
    return { ok: true, json: async () => ({ ok: true, status: 'enabled' }) };
  };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: raw.id } });
  await model.loadSpecialistDetail(raw.id);
  let detail = model.detailVM(model.st());
  assert.equal(detail.hasPrimary, false);
  assert.equal(detail.secondary[0].label, 'Zapnout');
  assert.equal(detail.hasTabs, true);
  assert.equal(await model.specialistAction(raw.id, 'enable'), true, widget.catalogActionError);
  detail = model.detailVM(model.st());
  assert.equal(detail.hasPrimary, true);
  assert.equal(detail.secondary[0].label, 'Vypnout');
  model.componentWillUnmount();
});

test('specialist update verifies exact installed version and uninstall disappears from catalog', async () => {
  const raw = { id: 'specialist-two', name: 'Specialista', status: 'enabled', version: '1.0.0' };
  let installed = true;
  const catalog = { backendUrl: () => 'http://127.0.0.1:3335', subscribe: () => () => {},
    view: name => ({ status: 'ready', items: name === 'Specialisté' && installed
      ? [{ id: raw.id, name: raw.name, raw: { ...raw } }] : [] }),
    get: async () => ({ ok: true, id: raw.id, status: raw.status, version: raw.version,
      manifest: { description: 'Ověřený manifest' }, tools: [], isRegistered: true }),
    load: async () => {} };
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: raw.id } });
  await model.loadSpecialistDetail(raw.id);
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/update')) {
      assert.equal(options.method, 'POST');
      raw.version = '1.1.0';
      return { ok: true, json: async () => ({ ok: true, newVersion: '1.1.0' }) };
    }
    assert.equal(path, '/api/specialists/' + raw.id);
    assert.equal(options.method, 'DELETE');
    installed = false;
    return { ok: true, json: async () => ({ ok: true, id: raw.id, removed: true }) };
  };
  assert.deepEqual(model.detailVM(model.st()).secondary.map(item => item.label),
    ['Vypnout', 'Zkontrolovat aktualizaci', 'Odinstalovat']);
  const verifiedFetch = model.fetchImpl;
  model.fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, newVersion: '9.9.9' }) });
  assert.equal(await model.specialistAction(raw.id, 'update'), false);
  assert.match(widget.catalogActionError, /nelze ověřit/);
  model.fetchImpl = verifiedFetch;
  assert.equal(await model.specialistAction(raw.id, 'update'), true, widget.catalogActionError);
  assert.equal(model._specialistDetails.get(raw.id).data.version, '1.1.0');
  assert.equal(await model.specialistAction(raw.id, 'uninstall'), true, widget.catalogActionError);
  assert.equal(model.st().detail.specialists, null);
  assert.equal(catalog.view('Specialisté').items.length, 0);
  model.componentWillUnmount();
});

test('M4 composer commands stay in the project and never reach the ordinary chat transport', async () => {
  const { model, store, calls } = setup();
  const session = store.focusedSession();
  session._projectId = '17'; session._convId = 'conversation-17';
  const paths = [];
  model.widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  model.fetchImpl = async url => {
    paths.push(new URL(url).pathname);
    return { ok: true, json: async () => ({ contract: 'LearningProposalReviewList', version: 1,
      projectId: 17, stateFilter: 'pending', reviews: [] }) };
  };
  model.setState({ drafts: { [session.id]: '/m4-learning pending' } });
  const patch = model.pSend(model.st(), session.id);
  model.setState(patch);
  await tick(); await tick();
  assert.deepEqual(paths, ['/api/projects/17/learning/proposals']);
  assert.equal(calls.length, 0);
  assert.equal(model.st().drafts[session.id], '');
  assert.deepEqual(session.chat.msgs.map(message => message.role), ['user', 'assistant']);
  assert.match(session.chat.msgs[1].text, /Count: 0/);
  session.chat._thinking = { text: 'M1 běží' };
  model.setState({ drafts: { [session.id]: '/m4-learning pending' } });
  assert.equal(model.pSend(model.st(), session.id), null);
  assert.equal(paths.length, 1);
  assert.equal(model.st().drafts[session.id], '/m4-learning pending');
});

test('M7 pairing in Security accepts only an exact short-lived local claim and keeps it out of storage', async () => {
  const { model, widget, storage } = setup();
  const calls = [];
  widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'zabezpeceni' },
    dtab: { 'settings:zabezpeceni': 'pristup' } });
  const vm = model.detailVM(model.st());
  assert.equal(vm.blocks[0].isPairing, true);
  assert.equal(vm.blocks[0].pairing.hasClaim, false);
  const selected = model._pairing.selectedScopes.slice();
  const code = 'A'.repeat(22);
  model.fetchImpl = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => ({ claimCode: code, claimId: 'pairing-claim:' + 'B'.repeat(24),
      contract: 'M7LocalPairingClaim', expiresAt: new Date(Date.now() + 120_000).toISOString(),
      pairingUri: 'intentsmith://pair?code=' + code, scopes: selected,
      subjectId: 'local-user', version: 1 }) };
  };
  try {
    assert.equal(await vm.blocks[0].pairing.issue(), true);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0][0]).pathname, '/api/m7/remote/pairing/claims');
    assert.equal(calls[0][1].credentials, 'same-origin');
    assert.deepEqual(JSON.parse(calls[0][1].body), { scopes: selected });
    assert.equal(model.pairingVM().code, code);
    assert.equal(model.pairingVM().disabled, true, 'a live claim cannot be replaced or broadened');
    assert.equal(model.togglePairingScope('write:chat'), false);
    assert.equal(await model.issuePairingClaim(), false);
    assert.equal(calls.length, 1);
    assert.equal(['intentsmith-studio2-session-state', 'intentsmith-studio2-layout']
      .some(key => storage.getItem(key)?.includes(code)), false);
  } finally { model.componentWillUnmount(); }
  const { model: malformed, widget: second } = setup();
  second.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  malformed.fetchImpl = async () => ({ ok: true, json: async () => ({ claimCode: code }) });
  assert.equal(await malformed.issuePairingClaim(), false);
  assert.equal(malformed.pairingVM().hasClaim, false);
  assert.match(malformed.pairingVM().error, /nepodařilo bezpečně/);
});

test('user preferences use the prototype form and verify saved backend values', async () => {
  let server = { 'intentsmith.account.displayName': 'Původní', 'intentsmith.language': 'cs', unrelated: 'zůstane' };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    assert.equal(new URL(url).pathname, '/api/settings');
    calls.push(method);
    if (method === 'POST') {
      server = JSON.parse(options.body);
      return { ok: true, json: async () => ({ success: true }) };
    }
    return { ok: true, json: async () => ({ ...server }) };
  };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl });
  const { model } = setup({ catalog });
  model.fetchImpl = fetchImpl;
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'ucet' } });
  await model.loadSettingsResource('ucet');
  let vm = model.detailVM(model.st());
  let form = vm.blocks.find(block => block.isPreferences).preferences;
  assert.equal(form.fields[0].value, 'Původní');
  form.fields[0].change({ target: { value: 'Nové jméno' } });
  vm = model.detailVM(model.st());
  assert.equal(vm.primaryLabel, 'Uložit změny');
  assert.equal(await vm.onPrimary(), true);
  assert.deepEqual(server, { 'intentsmith.account.displayName': 'Nové jméno',
    'intentsmith.language': 'cs', unrelated: 'zůstane' });
  assert.equal(model.detailVM(model.st()).hasPrimary, false);
  assert.deepEqual(calls, ['GET', 'GET', 'POST', 'GET']);
  model.detailVM(model.st()).blocks.find(block => block.isPreferences).preferences.fields[0]
    .change({ target: { value: 'Další jméno' } });
  server['intentsmith.language'] = 'en';
  assert.equal(await model.savePreferences('ucet'), false, 'external write requires refresh');
  assert.equal(calls.filter(method => method === 'POST').length, 1);
  assert.match(model._preferenceNotice.get('ucet'), /mezitím změnilo/);
});

test('notification settings read backend channels without claiming delivery or sending a test notification', async () => {
  const paths = [];
  let channels = { channels: [{ name: 'desktop', configured: true }, { name: 'email', configured: false }] };
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    paths.push([path, options.method || 'GET']);
    return { ok: true, json: async () => path === '/api/settings'
      ? { 'intentsmith.notif.desktopEnabled': true } : channels };
  };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl });
  const { model } = setup({ catalog });
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'oznameni' } });
  await Promise.all([model.loadSettingsResource('oznameni'), model.loadSettingsResource('oznameni:channels')]);
  let vm = model.detailVM(model.st());
  let rows = vm.blocks.find(block => block.title === 'Kanály backendu').rows;
  assert.deepEqual(rows.map(row => [row.t, row.m]), [
    ['desktop', 'zaregistrován'], ['email', 'nenastaven']]);
  assert.match(rows[0].s, /Doručení tím není ověřeno/);

  channels = { channels: [{ name: 'email', configured: 'yes' }] };
  await model.loadSettingsResource('oznameni:channels', true);
  vm = model.detailVM(model.st());
  assert.match(vm.blocks.find(block => block.isEmpty).empty, /neplatný seznam kanálů/);

  channels = { channels: [{ name: 'email', configured: true }] };
  vm.secondary.find(action => action.label === 'Obnovit').go();
  await tick();
  rows = model.detailVM(model.st()).blocks.find(block => block.title === 'Kanály backendu').rows;
  assert.deepEqual(rows.map(row => [row.t, row.m]), [['email', 'zaregistrován']]);
  assert.deepEqual(paths.map(([path]) => path), ['/api/settings', '/api/notifications/channels',
    '/api/notifications/channels', '/api/settings', '/api/notifications/channels']);
  assert.equal(paths.every(([, method]) => method === 'GET'), true);
});

test('storage and backup settings show backend data and verify a confirmed backup', async () => {
  let approve = false, backedUp = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname, method = options.method || 'GET';
    calls.push([method, path]);
    if (path === '/api/system/storage') return { ok: true, json: async () => ({
      db_size_mb: 21, messages_in_db: 42, history: { total_mb: 7 }, backups: { count: backedUp ? 1 : 0 } }) };
    if (path === '/api/system/backups' && method === 'GET') return { ok: true, json: async () => ({
      backups: backedUp ? [{ name: 'state-20260926', total_size_mb: 4, restorable: true }] : [] }) };
    if (path === '/api/system/backup' && method === 'POST') {
      backedUp = true; return { ok: true, json: async () => ({ ok: true, name: 'state-20260926' }) };
    }
    if (path === '/api/system/vacuum' && method === 'POST') return { ok: true,
      json: async () => ({ ok: true }) };
    throw Error('Unexpected ' + method + ' ' + path);
  };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => approve;
  model.fetchImpl = fetchImpl;
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'uloziste' } });
  await model.loadSettingsResource('uloziste:system');
  assert.equal(model.detailVM(model.st()).blocks[0].rows[0].m, '21 MiB');
  model.setState({ dtab: { 'settings:uloziste': 'udrzba' } });
  assert.equal(await model.detailVM(model.st()).onPrimary(), false);
  assert.equal(calls.some(([method]) => method === 'POST'), false);
  approve = true;
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 1);
  model.setState({ detail: { settings: 'zalohy' }, dtab: { 'settings:zalohy': 'prehled' } });
  await model.loadSettingsResource('zalohy');
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(model.detailVM(model.st()).blocks.find(block => block.isRows).rows[0].t, 'state-20260926');
  assert.deepEqual(calls.filter(([method]) => method === 'POST').map(([, path]) => path),
    ['/api/system/vacuum', '/api/system/backup']);
});

test('settings import previews a bounded JSON file and confirms backend readback', async () => {
  let settings = { old: true }, approved = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname, method = options.method || 'GET';
    calls.push([method, path]);
    if (path === '/api/system/backups') return { ok: true, json: async () => ({ backups: [] }) };
    if (path === '/api/settings' && method === 'GET') return { ok: true, json: async () => ({ ...settings }) };
    if (path === '/api/settings/import' && method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.version, 1);
      settings = body.settings;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw Error('Unexpected ' + method + ' ' + path);
  };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => approved;
  model.fetchImpl = fetchImpl;
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'zalohy' },
    dtab: { 'settings:zalohy': 'obnova' } });
  await model.loadSettingsResource('zalohy');
  const file = { name: 'settings.json', size: 25, text: async () => JSON.stringify({ language: 'cs' }) };
  assert.equal(await model.prepareSettingsImport({ target: { files: [file] } }), true);
  const form = model.detailVM(model.st()).blocks.find(block => block.isSettingsImport).settingsImport;
  assert.equal(form.disabled, false);
  assert.equal(await form.submit(), false);
  assert.equal(calls.some(([method]) => method === 'POST'), false);
  approved = true;
  assert.equal(await form.submit(), true);
  assert.deepEqual(settings, { language: 'cs' });
  assert.match(model.settingsImportVM().status, /ověřen/);
  assert.equal(await model.prepareSettingsImport({ target: { files: [{ name: 'bad.json', size: 10,
    text: async () => JSON.stringify({ models: { autoFailoverEnabled: true } }) }] } }), false);
  assert.equal(model.settingsImportVM().disabled, true);
});

test('expertise detail applies only a backend-confirmed catalog identity to the focused session', async () => {
  const item = { id: 'architect', name: 'Architekt', raw: { isCustom: false, domain: 'code' } };
  const catalog = { view: section => ({ status: 'ready', items: section === 'Expertýzy' ? [item] : [] }),
    load: () => {}, subscribe: () => () => {}, backendUrl: () => 'http://127.0.0.1:3335' };
  const { model, store, storage, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  const emptyRevision = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
  let saved = [], revision = emptyRevision, conversationId = null;
  model.fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    conversationId = decodeURIComponent(path.split('/')[3]);
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      assert.equal(body.expectedRevision, emptyRevision);
      saved = body.expertises; revision = 'a'.repeat(64);
    }
    return { ok: true, json: async () => ({ conversationId, expertises: saved, revision }) };
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: 'architect' } });
  const vm = model.detailVM(model.st());
  assert.equal(vm.primaryLabel, 'Použít samostatně v relaci');
  assert.equal(await vm.onPrimary(), true);
  assert.deepEqual(saved, [{ id: 'architect', weight: 0.5 }]);
  assert.equal(store.focusedSession()._convId, conversationId);
  assert.equal(store.focusedSession().chat.expertise, 'Architekt');
  assert.match(storage.getItem('intentsmith-studio2-session-state'), /Architekt/);
  assert.equal(model.st().mode, 'sessions');
  assert.equal(await model.useExpertise({ id: 'architect', name: 'Jiná' }), false);
  const session = store.focusedSession();
  session._projectId = 7;
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: 'architect' } });
  let blocked = model.detailVM(model.st());
  assert.equal(blocked.hasPrimary, true);
  assert.equal(blocked.secondary.some(action => action.label === 'Přidat ke kombinaci'), true);
  assert.equal(await model.useExpertise(item), true);
  session._projectId = null;
  session.chat.specialist = { id: 'some-specialist' };
  blocked = model.detailVM(model.st());
  assert.equal(blocked.hasPrimary, false);
  assert.match(blocked.blocks.find(block => block.isExpertiseSelection).expertiseSelection.status, /specialista/);
  assert.deepEqual(saved, [{ id: 'architect', weight: 0.5 }]);
});

test('expertise filters use backend categories while tiles show readable category names', async () => {
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async () => ({ ok: true, json: async () => ({ experts: [
      { id: 'writer', name: 'Spisovatel', domain: 'CREATIVE_WRITING' },
      { id: 'analyst', name: 'Analytik', domain: 'DATA_ANALYSIS' },
      ...['mine1', 'mine2', 'mine3', 'mine4'].map(id => ({ id, name: id, domain: 'custom', isCustom: true }))],
    categories: [{ id: 'creative', experts: ['writer'] },
      { id: 'analytical', experts: ['analyst'] },
      { id: 'custom', experts: ['mine1', 'mine2', 'mine3', 'mine4'] }] }) }) });
  await catalog.load('Expertýzy');
  const { model } = setup({ catalog });
  const rows = model.entities('expertises', model.st());
  assert.deepEqual(rows.map(row => row.group), ['Tvůrčí & Narativní', 'Analyticko-rozhodovací',
    'Vlastní', 'Vlastní', 'Vlastní', 'Vlastní']);
  assert.deepEqual(rows.map(row => row.sub), ['CREATIVE_WRITING', 'DATA_ANALYSIS',
    'custom', 'custom', 'custom', 'custom']);
  const chips = model.filtered('expertises', model.st()).chips;
  assert.equal(chips.find(chip => chip.label === 'Tvůrčí').n, 1);
  assert.equal(chips.find(chip => chip.label === 'Analytičtí').n, 1);
  assert.equal(chips.find(chip => chip.label === 'Vlastní').n, 4);
  assert.equal(chips.reduce((sum, chip) => sum + (chip.label === 'Vše' ? 0 : chip.n), 0), 6);
  model.setState({ mode: 'section', section: 'expertises' });
  assert.equal(model.catalogVM(model.st()).summary, '6 položek z backendu');
  catalog.views.set('Expertýzy', { status: 'ready', items: catalog.view('Expertýzy').items.slice(0, 1) });
  assert.equal(model.catalogVM(model.st()).summary, '1 položka z backendu');
  model.componentWillUnmount();
});

test('project tiles translate backend status and unknown expertises have a visible filter', async () => {
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => ({ ok: true, json: async () => new URL(url).pathname === '/api/projects'
      ? { projects: [{ id: 7, name: 'Atlas', path: '/tmp/atlas', status: 'active' }] }
      : { experts: [{ id: 'future', name: 'Nová expertýza', domain: 'FUTURE' }], categories: [] } }) });
  await catalog.load('Projekty');
  await catalog.load('Expertýzy');
  const { model } = setup({ catalog });
  const project = model.entities('projects', model.st())[0];
  assert.deepEqual([project.tag, project.catLabel, project.state, project.tagCls],
    ['aktivní', 'aktivní', 'aktivní', 'ok']);
  const chips = model.filtered('expertises', model.st()).chips;
  assert.equal(chips.find(chip => chip.label === 'Nezařazené').n, 1);
  model.setState({ chip: 'uncategorized' });
  assert.equal(model.filtered('expertises', model.st()).items.length, 1);
  model.componentWillUnmount();
});

test('preference fields reject out-of-range values before POST', async () => {
  const calls = [];
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => { calls.push(options.method || 'GET');
      return { ok: true, json: async () => ({}) }; } });
  const { model } = setup({ catalog });
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'vystup' },
    dtab: { 'settings:vystup': 'delka' } });
  await model.loadSettingsResource('vystup');
  const field = model.detailVM(model.st()).blocks.find(block => block.isPreferences).preferences.fields[0];
  field.change({ target: { value: '999999' } });
  assert.equal(await model.savePreferences('vystup'), false);
  assert.equal(calls.includes('POST'), false);
  assert.match(model._preferenceNotice.get('vystup'), /Neplatná hodnota/);
});

test('settings preserve twelve prototype categories and verify live feature changes against backend', async () => {
  let features = { skills: true, agents: false };
  let fail = false, approved = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname, method = options.method || 'GET';
    calls.push([method, path]);
    if (path === '/api/features' && method === 'GET') return { ok: true, json: async () => ({ features: { ...features } }) };
    if (path === '/api/system/models') return { ok: true, json: async () => ({
      models: [{ name: 'local-model:latest', size: 2 * 1024 ** 3, digest: 'sha256:abc' }],
      ollama_url: 'http://127.0.0.1:11434', current_model: 'local-model:latest' }) };
    if (path === '/api/system/storage') return { ok: true, json: async () => ({
      db_size_mb: 1, messages_in_db: 10, history: { total_mb: 0 }, backups: { count: 0 } }) };
    if (fail) return { ok: false, status: 503, json: async () => ({ error: 'Backend selhal' }) };
    if (path === '/api/features/reset') features = { skills: true, agents: true };
    else if (path === '/api/features/skills') features = { ...features, skills: JSON.parse(options.body).enabled };
    else throw Error('Unexpected request: ' + path);
    return { ok: true, json: async () => ({ ok: true, features: { ...features } }) };
  };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl });
  const { model, widget } = setup({ catalog });
  model.fetchImpl = fetchImpl;
  widget.confirmAction = () => approved;
  assert.deepEqual(model.data().SET.map(category => category.name), [
    'Účet', 'Modely a inference', 'Paměť', 'Oznámení', 'Výstup', 'Vzhled',
    'Systém', 'Úložiště', 'Zálohy', 'Funkční přepínače', 'Zabezpečení', 'O aplikaci']);
  assert.deepEqual(model.data().SET.map(category => category.tabs.length), [2, 4, 3, 2, 2, 5, 4, 2, 3, 2, 3, 2]);
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'prepinace' } });
  await model.loadSettingsResource('prepinace');
  assert.equal(model.detailVM(model.st()).blocks[0].rows[0].m, 'vypnuto');
  assert.equal(await model.toggleFeature('skills', false), false, 'rejected confirmation sends no mutation');
  assert.equal(calls.filter(([method]) => method === 'POST').length, 0);
  approved = true; fail = true;
  assert.equal(await model.toggleFeature('skills', false), false);
  assert.match(model._settingsNotice, /Backend selhal/);
  assert.equal(model.detailVM(model.st()).blocks.at(-1).rows.find(row => row.t === 'skills').m, 'zapnuto');
  fail = false;
  assert.equal(await model.toggleFeature('skills', false), true);
  assert.equal(model.detailVM(model.st()).blocks.at(-1).rows.find(row => row.t === 'skills').m, 'vypnuto');
  model.detailVM(model.st()).tabs.find(tab => tab.label === 'Obnovení').go();
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Obnovit přepínače');
  assert.equal(await model.resetFeatures(), true);
  assert.equal(features.skills, true);
  model.setState({ detail: { settings: 'modely' } });
  await model.loadSettingsResource('modely');
  assert.equal(model.detailVM(model.st()).blocks[0].isModelWorkspace, true);
  assert.equal(model.detailVM(model.st()).props.find(prop => prop.k === 'Model CHAT').v, 'local-model:latest');
  model.setState({ detail: { settings: 'uloziste' } });
  await model.loadSettingsResource('uloziste:system');
  assert.equal(model.detailVM(model.st()).blocks[0].rows[0].m, '1 MiB');
});

test('marketplace detail uses confirmed backend mutations and never claims success after failure', async () => {
  let installed = false, fail = false, approved = false;
  const calls = [];
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push([options.method || 'GET', path]);
      if (path === '/api/marketplace/catalog') return { ok: true, json: async () => ({
        items: [{ id: 'pkg-a', name: 'Balíček A', type: 'skill', version: '1.2.3', installed }] }) };
      if (path === '/api/marketplace/install/skill/pkg-a') {
        if (fail) return { ok: false, status: 503, json: async () => ({ error: 'Instalace selhala' }) };
        installed = true;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (path === '/api/marketplace/installed/skill/pkg-a') {
        installed = false;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => approved;
  await catalog.load('Obchod');
  model.setState({ mode: 'section', section: 'market', detail: { market: 'skill:pkg-a' } });
  let vm = model.detailVM(model.st());
  assert.deepEqual(vm.tabs.map(tab => tab.label), ['Přehled', 'Verze']);
  assert.match(vm.blocks[0].items[0].t, /Balíček z katalogu backendu/);
  vm.tabs[1].go();
  vm = model.detailVM(model.st());
  assert.equal(vm.blocks[0].rows.find(row => row.t === 'Dostupná verze').m, '1.2.3');
  assert.equal(vm.blocks[0].rows.find(row => row.t === 'Nainstalovaná verze').m, 'není nainstalovaná');
  vm.tabs[0].go();
  vm = model.detailVM(model.st());
  assert.equal(vm.primaryLabel, 'Nainstalovat');
  assert.equal(await vm.onPrimary(), false, 'rejected confirmation has no effect');
  assert.equal(calls.filter(([method]) => method !== 'GET').length, 0);
  approved = true; fail = true;
  assert.equal(await vm.onPrimary(), false, 'failed backend response remains failed');
  assert.match(widget.catalogActionError, /Instalace selhala/);
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Nainstalovat');
  fail = false;
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(widget.catalogActionError, null);
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Odinstalovat');
  model.detailVM(model.st()).tabs[1].go();
  assert.equal(model.detailVM(model.st()).blocks[0].rows.find(row => row.t === 'Nainstalovaná verze').m, '1.2.3');
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  assert.equal(model.detailVM(model.st()).primaryLabel, 'Nainstalovat');
  assert.deepEqual(calls.filter(([method]) => method !== 'GET'), [
    ['POST', '/api/marketplace/install/skill/pkg-a'],
    ['POST', '/api/marketplace/install/skill/pkg-a'],
    ['DELETE', '/api/marketplace/installed/skill/pkg-a']]);
});

test('project wizard confirms create or open only after backend response and catalog readback', async () => {
  const posts = [];
  let conflict = true, honorOpenName = true, projects = [];
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/projects/defaults') return { ok: true, json: async () => ({ defaultDir: '/home/user/projects' }) };
      if (path === '/api/projects') return { ok: true, json: async () => ({ projects }) };
      throw Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  model.scmClient.load = () => {};
  model.loadProjectConversations = () => {};
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = JSON.parse(options.body);
    posts.push([path, body]);
    if (path === '/api/projects' && conflict) return { ok: false, status: 409,
      json: async () => ({ error: 'Projekt už existuje' }) };
    const existing = path === '/api/projects/open-folder'
      ? projects.find(item => item.path === body.folderPath) : null;
    if (existing && body.name && body.name !== existing.name && !body.renameConfirmation)
      return { ok: false, status: 409, json: async () => ({
        code: 'PROJECT_RENAME_CONFIRMATION_REQUIRED', existingProject: existing,
        proposedName: body.name }) };
    if (body.renameConfirmation && (body.renameConfirmation.projectId !== existing?.id
      || body.renameConfirmation.currentName !== existing?.name))
      return { ok: false, status: 409, json: async () => ({
        code: 'PROJECT_RENAME_PLAN_STALE', error: 'Projekt se mezitím změnil.' }) };
    const project = path === '/api/projects' ? { id: 41, name: body.name, path: '/home/user/projects/novy' }
      : { id: 42, name: body.name && honorOpenName ? body.name : 'Import', path: '/home/user/existing' };
    projects = [...projects.filter(item => item.id !== project.id), project];
    return { ok: true, json: async () => ({ project }) };
  };
  await model.loadProjectDefaults();
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '__new__' }, projectStep: 1,
    projectName: 'Nový', projectDescription: 'Popis', projectType: 'general' });
  let form = model.projectWizardVM(model.st());
  assert.equal(form.reviewTarget, '/home/user/projects/Novy'.toLowerCase());
  assert.equal(form.submitDisabled, false);
  assert.equal(await model.submitProject(model.st()), false);
  assert.match(widget.catalogActionError, /Projekt už existuje/);
  assert.equal(model.projectStatus().uncertain, false, 'explicit HTTP conflict may be corrected');
  conflict = false;
  assert.equal(await model.submitProject(model.st()), true);
  assert.equal(model.st().detail.projects, '41');
  assert.equal(model.detailVM(model.st()).title, 'Nový');
  assert.deepEqual(posts[1], ['/api/projects', { name: 'Nový', description: 'Popis', type: 'general' }]);
  model.setState({ detail: { projects: '__new__' }, projectStep: 1, projectMode: 'open',
    projectName: '', projectPath: '/home/user/existing' });
  assert.equal(await model.submitProject(model.st()), true);
  assert.equal(model.st().detail.projects, '42');
  assert.deepEqual(posts[2], ['/api/projects/open-folder', { folderPath: '/home/user/existing' }]);
  model.setState({ detail: { projects: '__new__' }, projectStep: 1, projectMode: 'open',
    projectName: 'Demo', projectPath: '/home/user/existing' });
  assert.equal(await model.submitProject(model.st()), false);
  assert.deepEqual(posts[3], ['/api/projects/open-folder', { folderPath: '/home/user/existing', name: 'Demo' }]);
  assert.equal(projects.find(item => item.id === 42).name, 'Import', 'first request must not rename');
  assert.match(model.projectWizardVM(model.st()).renameNotice, /Import.*Demo/);
  assert.equal(model.projectWizardVM(model.st()).submitLabel, 'Potvrdit přejmenování');
  model.projectWizardVM(model.st()).setName({ target: { value: 'Jiný záměr' } });
  assert.equal(model.projectWizardVM(model.st()).hasRenamePlan, false,
    'changing the proposed name removes the approval plan');
  model.projectWizardVM(model.st()).setName({ target: { value: 'Demo' } });
  assert.equal(await model.submitProject(model.st()), false, 'the changed form requires a fresh plan');
  assert.equal(await model.submitProject(model.st()), true);
  assert.deepEqual(posts[5], ['/api/projects/open-folder', { folderPath: '/home/user/existing', name: 'Demo',
    renameConfirmation: { projectId: 42, currentName: 'Import' } }]);
  assert.equal(model.detailVM(model.st()).title, 'Demo');
  honorOpenName = false;
  model.setState({ detail: { projects: '__new__' }, projectStep: 1, projectMode: 'open',
    projectName: 'Jiný', projectPath: '/home/user/existing' });
  assert.equal(await model.submitProject(model.st()), false);
  assert.equal(await model.submitProject(model.st()), false);
  assert.match(widget.catalogActionError, /požadovaný název/);
  assert.equal(model.projectStatus().uncertain, true);
});

test('account project directory migrates locally, can be cleared, and shapes the reviewed create path', async () => {
  const { model, widget, storage } = setup();
  widget.catalog.backendUrl = () => 'http://127.0.0.1:3335';
  model.setState({ mode: 'section', section: 'settings', detail: { settings: 'ucet' },
    dtab: { 'settings:ucet': 'projekty' } });
  const field = model.detailVM(model.st()).blocks.find(block => block.isProjectDirectory).projectDirectory;
  assert.equal(field.change({ target: { value: '/home/user/work' } }), true);
  assert.equal(storage.getItem('intentsmith-studio2-projects-dir'), '/home/user/work');
  model.setState({ section: 'projects', detail: { projects: '__new__' },
    projectStep: 1, projectName: 'Projekt', projectPath: '' });
  assert.equal(model.projectWizardVM(model.st()).reviewTarget, '/home/user/work/projekt');
  let body = null;
  model.fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: false, status: 409, json: async () => ({ error: 'Kolize' }) };
  };
  assert.equal(await model.submitProject(model.st()), false);
  assert.equal(body.path, '/home/user/work/projekt');
  assert.equal(model.setProjectsDir(''), true);
  assert.equal(storage.getItem('intentsmith-studio2-projects-dir'), '');
  assert.equal(model.projectWizardVM(model.st()).reviewTarget, 'výchozí složka backendu');
});

test('specialist wizard creates reviewed package and verifies manifest before opening catalog detail', async () => {
  let conflict = true, installed = false, postCount = 0;
  const name = "Překladatelův 'asistent'";
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/specialists') return { ok: true, json: async () => ({
        specialists: installed ? [{ id: 'pekladatelv-asistent', name, status: 'enabled', domain: 'language' }] : [] }) };
      if (path === '/api/specialists/pekladatelv-asistent') return { ok: true,
        json: async () => ({ ok: true, id: 'pekladatelv-asistent', manifest: { name, domain: 'language' } }) };
      throw Error('Unexpected request: ' + path);
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/specialists');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).description, "Řádek 'jeden'\nDruhý řádek");
    postCount++;
    if (conflict) return { ok: false, status: 409, json: async () => ({ error: 'Již existuje' }) };
    installed = true;
    return { ok: true, json: async () => ({ ok: true, specialist: { id: 'pekladatelv-asistent' } }) };
  };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: '__new__' },
    specialistStep: 1, specialistName: name, specialistDomain: 'language',
    specialistDescription: "Řádek 'jeden'\nDruhý řádek", specialistIcon: '🧠' });
  assert.equal(model.specialistWizardVM(model.st()).reviewId, 'pekladatelv-asistent');
  assert.equal(await model.submitSpecialist(model.st()), false);
  assert.equal(model.specialistStatus().uncertain, false, 'explicit 409 permits correction');
  conflict = false;
  assert.equal(await model.submitSpecialist(model.st()), true);
  assert.equal(model.st().detail.specialists, 'pekladatelv-asistent');
  assert.equal(model.detailVM(model.st()).title, name);
  assert.equal(postCount, 2);
});

test('specialist wizard never retries an uncertain package creation', async () => {
  let postCount = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => {
    throw Error('No readback expected after lost response');
  } });
  const { model } = setup({ catalog });
  model.fetchImpl = async () => { postCount++; throw Error('Connection lost'); };
  model.setState({ mode: 'section', section: 'specialists', detail: { specialists: '__new__' },
    specialistStep: 1, specialistName: 'Analyst', specialistDomain: 'general' });
  assert.equal(await model.submitSpecialist(model.st()), false);
  assert.equal(model.specialistStatus().uncertain, true);
  assert.equal(await model.submitSpecialist(model.st()), false);
  assert.equal(postCount, 1);
});

test('worker wizard installs only a disabled M3 project-health instance with exact readback', async () => {
  let installed = false, postCount = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/agent-extensions') return { ok: true, json: async () => ({ extensions: [
        { id: 'project-health', name: 'Project Health', requiredCapabilities: ['code-intel.project-context.v1'] },
        { id: 'unknown', name: 'Unknown', requiredCapabilities: [] }] }) };
      if (path === '/api/projects') return { ok: true, json: async () => ({ projects: [{ id: 41, name: 'Repo' }] }) };
      if (path === '/api/agent-extensions/project-health') return { ok: true, json: async () => ({ id: 'project-health',
        definition: { params: [{ name: 'project_id', type: 'number', label: 'Projekt' }], sources: [], actions: [] } }) };
      if (path === '/api/agents') return { ok: true, json: async () => ({ agents: installed ? [
        { id: 'health-repo', name: 'Project Health', enabled: false }] : [] }) };
      if (path === '/api/agents/health-repo') return { ok: true, json: async () => ({
        id: 'health-repo', enabled: false, params: { project_id: 41 },
        definition: { m3_extension: { id: 'project-health', definitionDigest: 'sha256:' + 'a'.repeat(64) }, schedule: { type: 'manual' } }, recentRuns: [] }) };
      throw Error('Unexpected request: ' + path);
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    if (new URL(url).pathname.endsWith('/preview')) {
      const draft = JSON.parse(options.body);
      return { ok: true, json: async () => ({ ...draft, id: 'project-health', effectsExecuted: false,
        definitionDigest: 'sha256:' + 'a'.repeat(64), validation: { valid: true } }) };
    }
    postCount++;
    assert.equal(new URL(url).pathname, '/api/agent-extensions/project-health/install');
    assert.deepEqual(JSON.parse(options.body), { instanceId: 'health-repo', params: { project_id: 41 }, enabled: false,
      expectedDefinitionDigest: 'sha256:' + 'a'.repeat(64) });
    installed = true;
    return { ok: true, json: async () => ({ id: 'health-repo', enabled: false,
      definition: { m3_extension: { id: 'project-health' } } }) };
  };
  model.setState({ mode: 'section', section: 'workers', detail: { workers: '__new__' },
    workerStep: 1, workerExtension: 'project-health', workerProject: '41', workerInstanceId: 'health-repo' });
  assert.equal(model.workerWizardVM(model.st()).submitDisabled, true, 'unloaded extension cannot be installed');
  await model.loadWorkerWizard();
  assert.deepEqual(model.workerStatus().extensions.map(item => item.id), ['project-health']);
  assert.equal(model.workerWizardVM(model.st()).submitDisabled, true, 'preview is required before install');
  assert.equal(await model.previewWorker(model.st()), true);
  assert.equal(model.workerWizardVM(model.st()).submitDisabled, false);
  model.setState({ workerInstanceId: 'changed' });
  assert.equal(model.workerWizardVM(model.st()).submitDisabled, true, 'changing a reviewed field invalidates preview');
  model.setState({ workerInstanceId: 'health-repo' });
  assert.equal(await model.submitWorker(model.st()), true);
  assert.equal(model.st().detail.workers, 'health-repo');
  assert.equal(postCount, 1);
});

test('worker wizard never repeats installation after uncertain response', async () => {
  let posts = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => ({
    ok: true, json: async () => ({ extensions: [], projects: [] }) }) });
  const { model } = setup({ catalog });
  model._workerWizardStatus = { loading: false, busy: false, error: '', uncertain: false,
    extensions: [{ id: 'project-health', name: 'Project Health', definition: {
      params: [{ name: 'project_id', type: 'number' }] } }], projects: [{ id: 41, name: 'Repo' }],
    preview: { validation: { valid: true }, definitionDigest: 'sha256:' + 'a'.repeat(64), params: { project_id: 41 } },
    previewKey: JSON.stringify(['project-health', { instanceId: 'health-repo', params: { project_id: 41 } }]) };
  model.fetchImpl = async () => { posts++; throw Error('Response lost'); };
  model.setState({ mode: 'section', section: 'workers', detail: { workers: '__new__' },
    workerStep: 1, workerExtension: 'project-health', workerProject: '41', workerInstanceId: 'health-repo' });
  assert.equal(await model.submitWorker(model.st()), false);
  assert.equal(model.workerStatus().uncertain, true);
  assert.equal(await model.submitWorker(model.st()), false);
  assert.equal(posts, 1);
});

test('expertise wizard previews the exact configuration and verifies saved identity', async () => {
  let installed = false, previews = 0, saves = 0, savedConfig;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path === '/api/expertises') return { ok: true, json: async () => ({ experts: installed ? [
        { id: 'custom_expert', name: 'Custom Expert', isCustom: true }] : [] }) };
      if (path === '/api/expertises/custom_expert') return { ok: true,
        json: async () => savedConfig };
      throw Error('Unexpected request: ' + path);
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, body = JSON.parse(options.body);
    if (path === '/api/merge-preview') {
      previews++;
      assert.equal(body.expertises[0].capabilities.reasoning, 70);
      return { ok: true, json: async () => ({ promptPreview: 'Ověřený náhled', tokenCount: 22,
        requiresConfirmation: false }) };
    }
    if (path === '/api/expertises') {
      saves++;
      assert.equal(body.id, 'custom_expert');
      assert.equal(body.temperature, 0.4);
      savedConfig = body;
      installed = true;
      return { ok: true, json: async () => ({ id: body.id, name: body.name }) };
    }
    throw Error('Unexpected mutation: ' + path);
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
    expertiseStep: 1, expertiseName: 'Custom Expert', expertiseDomain: 'technology',
    expertiseReasoning: 70, expertiseTemperature: 0.4 });
  assert.equal(await model.previewExpertise(model.st()), true);
  assert.equal(model.expertiseWizardVM(model.st()).previewText, 'Ověřený náhled');
  assert.equal(await model.submitExpertise(model.st()), true);
  assert.equal(previews, 1, 'unchanged preview is reused for this exact configuration');
  assert.equal(saves, 1);
  assert.equal(model.st().detail.expertises, 'custom_expert');
});

test('expertise wizard does not repeat uncertain save and discards stale preview', async () => {
  let previews = 0, saves = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => ({
    ok: true, json: async () => ({ experts: [] }) }) });
  const { model } = setup({ catalog });
  model.fetchImpl = async url => {
    const path = new URL(url).pathname;
    if (path === '/api/merge-preview') {
      previews++;
      return { ok: true, json: async () => ({ promptPreview: 'náhled', tokenCount: 12 }) };
    }
    saves++;
    throw Error('Lost response');
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
    expertiseStep: 1, expertiseName: 'Test Expert' });
  assert.equal(await model.previewExpertise(model.st()), true);
  model.setState({ expertiseTemperature: 0.6 });
  assert.equal(model.expertiseWizardVM(model.st()).hasPreview, false);
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(previews, 2);
  assert.equal(model.expertiseStatus().uncertain, true);
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(saves, 1);
});

test('advanced expertise rules are bounded and model test needs explicit approval', async () => {
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async () => ({
    ok: true, json: async () => ({ experts: [] }) }) });
  const { model, widget } = setup({ catalog });
  let approved = false, calls = 0;
  widget.confirmAction = () => approved;
  model.fetchImpl = async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, '/api/expertise-wizard/test-prompt');
    const body = JSON.parse(options.body);
    assert.equal(body.question, 'Jaký je stav?');
    assert.deepEqual(body.expertiseConfig.modules.domain_rules, ['Pravidlo A', 'Pravidlo B']);
    assert.deepEqual(body.expertiseConfig.inheritance, { vocabulary: 'extend' });
    assert.equal(body.expertiseConfig.capabilities.riskTolerance, 15);
    return { ok: true, json: async () => ({ response: 'Ověřená odpověď', model: 'local', duration: 10 }) };
  };
  model.setState({ mode: 'section', section: 'expertises', detail: { expertises: '__new__' },
    expertiseStep: 1, expertiseName: 'Test Expert', expertiseAdvanced: true,
    expertiseDomainRules: 'Pravidlo A\nPravidlo B', expertiseInheritance: '{"vocabulary":"extend"}',
    expertiseRiskTolerance: 15, expertiseTestQuestion: 'Jaký je stav?' });
  assert.equal(model.expertiseWizardVM(model.st()).testDisabled, false);
  assert.equal(await model.testExpertise(model.st()), false);
  assert.equal(calls, 0);
  approved = true;
  assert.equal(await model.testExpertise(model.st()), true);
  assert.equal(model.expertiseWizardVM(model.st()).testResult, 'Ověřená odpověď');
  model.setState({ expertiseTestQuestion: 'Jiný dotaz' });
  assert.equal(model.expertiseWizardVM(model.st()).hasTestResult, false, 'answer belongs to exact question');
  model.setState({ expertiseInheritance: '{' });
  assert.equal(model.expertiseWizardVM(model.st()).submitDisabled, true);
  assert.equal(model.expertiseWizardVM(model.st()).hasTestResult, false);
  model.setState({ expertiseInheritance: '{"__proto__":"extend"}' });
  assert.equal(model.expertiseWizardVM(model.st()).submitDisabled, true);
  model.setState({ expertiseInheritance: '{}', expertiseTestQuestion: 'x'.repeat(2001) });
  assert.equal(model.expertiseWizardVM(model.st()).testDisabled, true);
});

test('custom expertise edit keeps its identity and refuses stale or uncertain updates', async () => {
  const original = { id: 'writer', name: 'Writer', description: 'První verze', domain: 'custom',
    icon: '✍', tone: 'professional', temperature: 0.5, systemPrompt: '', isCustom: true,
    capabilities: { reasoning: 50, creativity: 60, determinism: 50, riskTolerance: 50, verbosity: 50 },
    modules: { domain_rules: [], emphasis: [], constraints: [], vocabulary: [], antipatterns: [], disclaimer: null },
    inheritance: {}, styleRules: { forbiddenPhrases: [], minResponseLength: 50 } };
  let current = { ...original }, puts = 0, loseResponse = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async url => {
    const path = new URL(url).pathname;
    if (path === '/api/expertises/writer') return { ok: true, json: async () => ({ ...current }) };
    if (path === '/api/expertises') return { ok: true, json: async () => ({ experts: [{ ...current }] }) };
    throw Error(path);
  } });
  const { model } = setup({ catalog });
  model.fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/merge-preview') return { ok: true, json: async () => ({ promptPreview: 'náhled', tokenCount: 5 }) };
    assert.equal(path, '/api/expertises/writer');
    assert.equal(options.method, 'PUT');
    assert.match(options.headers['If-Match'], /^"sha256:[0-9a-f]{64}"$/);
    puts++;
    if (loseResponse) throw Error('Lost response');
    current = { ...current, ...JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ...current }) };
  };
  await catalog.load('Expertýzy');
  const item = catalog.view('Expertýzy').items[0];
  assert.equal(await model.openExpertiseEdit(item), true);
  assert.equal(model.st().detail.expertises, '__edit__');
  assert.equal(model.st().expertiseEditingId, 'writer');
  assert.equal(model.expertiseConfig(model.st()).styleRules.minResponseLength, 50);
  model.setState({ expertiseStep: 1, expertiseName: 'Writer revised' });
  assert.equal(model.expertiseConfig(model.st()).id, 'writer');
  current = { ...current, description: 'cizí změna' };
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(puts, 0);
  assert.match(model.expertiseStatus().error, /změnila/);
  current = { ...original };
  assert.equal(await model.submitExpertise(model.st()), true);
  assert.equal(puts, 1);
  assert.equal(current.name, 'Writer revised');
  assert.equal(model.st().detail.expertises, 'writer');
  assert.equal(await model.openExpertiseEdit(catalog.view('Expertýzy').items[0]), true);
  model.setState({ expertiseStep: 1, expertiseName: 'Writer revised again' });
  loseResponse = true;
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(model.expertiseStatus().uncertain, true);
  assert.equal(await model.submitExpertise(model.st()), false);
  assert.equal(puts, 2);
  assert.equal(await model.openExpertiseEdit({ id: 'developer', raw: { isCustom: false } }), false);
});

test('expertise update route requires matching revision, keeps ID and rolls back failed persistence', async () => {
  const { createExpertiseRoutes } = await import('../src/routes/expertises.js');
  const { createHash } = await import('node:crypto');
  const path = await import('node:path');
  const data = { id: 'writer', name: 'Writer', domain: 'custom', isCustom: true };
  const asExpert = value => ({ ...value, toJSON() { return { id: this.id, name: this.name,
    domain: this.domain, isCustom: this.isCustom }; } });
  const registry = new Map([['writer', asExpert(data)]]);
  let failSave = false, result;
  const routes = createExpertiseRoutes({ expertiseLayer: { expertiseRegistry: {
    get: id => registry.get(id), getCustom: () => [...registry.values()],
    updateCustom: (id, body) => { const next = asExpert({ ...registry.get(id).toJSON(), ...body }); registry.set(id, next); return next; },
    register: expert => registry.set(expert.id, expert), removeCustom: id => registry.delete(id)
  } }, parseBody: async req => req.body, sendJSON: (_res, status, body) => { result = { status, body }; },
  safeError: error => ({ error: error.message }), logger: { debug() {} }, path,
  db: { db: { transaction: fn => fn, exec() {}, prepare: () => ({ run() { if (failSave) throw Error('db failed'); } }) } } });
  const revision = '"sha256:' + createHash('sha256').update(JSON.stringify(registry.get('writer').toJSON())).digest('hex') + '"';
  await routes['PUT /api/expertises/:id']({ headers: { 'if-match': '"sha256:stale"' },
    body: { name: 'Updated' } }, {}, { id: 'writer' });
  assert.equal(result.status, 412);
  assert.equal(registry.get('writer').name, 'Writer');
  failSave = true;
  await routes['PUT /api/expertises/:id']({ headers: { 'if-match': revision },
    body: { id: 'spoofed', name: 'Updated' } }, {}, { id: 'writer' });
  assert.equal(result.status, 500);
  assert.equal(registry.get('writer').name, 'Writer');
  failSave = false;
  await routes['PUT /api/expertises/:id']({ headers: { 'if-match': revision },
    body: { id: 'spoofed', name: 'Updated' } }, {}, { id: 'writer' });
  assert.equal(result.status, 200);
  assert.equal(registry.get('writer').id, 'writer');
  assert.equal(registry.get('writer').name, 'Updated');
});

test('project wizard treats lost mutation response as uncertain and never retries automatically', async () => {
  let posts = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async () => ({ ok: true, json: async () => ({ projects: [] }) }) });
  const { model } = setup({ catalog });
  model.fetchImpl = async () => { posts++; throw Error('socket closed'); };
  model.setState({ mode: 'section', section: 'projects', detail: { projects: '__new__' },
    projectStep: 1, projectName: 'Nový' });
  assert.equal(await model.submitProject(model.st()), false);
  assert.equal(model.projectStatus().uncertain, true);
  assert.equal(model.projectWizardVM(model.st()).submitDisabled, true);
  assert.equal(await model.submitProject(model.st()), false);
  assert.equal(posts, 1);
});

test('worker detail runs only a verified M3 extension through its active route', async () => {
  const calls = [];
  let enabled = true, rejectRun = false, installed = true, runStatus = 'success', runId = 0;
  let recentRuns = [];
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      calls.push([options.method || 'GET', path]);
      if (path === '/api/agents') return { ok: true, json: async () => ({ agents: [
        ...(installed ? [{ id: 'worker-m3', name: 'Nový worker', enabled }] : []),
        { id: 'legacy', name: 'Starý worker', enabled: true }] }) };
      if (path === '/api/agents/worker-m3') return { ok: true, json: async () => ({
        id: 'worker-m3', enabled, definition: { m3_extension: { id: 'approved-extension' }, schedule: { type: 'manual' },
          sources: [{ id: 'health', type: 'project_context' }],
          conditions: [{ id: 'changed', type: 'changed' }],
          triggers: [{ id: 'on-change', condition_id: 'changed', cooldown: 60 }],
          actions: [{ type: 'notify', trigger_id: 'on-change', config: { channel: 'in_app' } }] }, recentRuns }) };
      if (path === '/api/agents/legacy') return { ok: true, json: async () => ({
        id: 'legacy', enabled: true, definition: { schedule: { type: 'manual' } }, recentRuns: [] }) };
      if (path === '/api/agent-extensions/instances/worker-m3/run') return rejectRun
        ? { ok: false, status: 409, json: async () => ({ error: 'Worker je zaneprázdněný.' }) }
        : { ok: true, json: async () => { runId++;
          recentRuns = [{ id: runId, status: runStatus }, ...recentRuns];
          return { runId, status: runStatus, ...(runStatus === 'error' ? { error: 'Zdroj selhal.' } : {}) }; } };
      if (path === '/api/agent-extensions/instances/worker-m3/disable') {
        enabled = false;
        return { ok: true, json: async () => ({ id: 'worker-m3', enabled: false }) };
      }
      if (path === '/api/agent-extensions/approved-extension/instances/worker-m3') {
        assert.equal(options.method, 'DELETE');
        installed = false;
        return { ok: true, json: async () => ({ removed: true, agentId: 'worker-m3' }) };
      }
      throw new Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  await catalog.load('Workeři');
  await model.loadWorkerDetail('worker-m3');
  model.setState({ mode: 'section', section: 'workers', detail: { workers: 'worker-m3' } });
  let vm = model.detailVM(model.st());
  assert.equal(vm.hasPrimary, true);
  assert.deepEqual(vm.tabs.map(tab => tab.label), ['Přehled', 'Zdroje', 'Běhy']);
  vm.tabs.find(tab => tab.label === 'Zdroje').go();
  vm = model.detailVM(model.st());
  assert.deepEqual(vm.blocks.map(block => block.title), ['Zdroje', 'Podmínky', 'Spouštěče', 'Akce']);
  assert.equal(vm.blocks[0].rows[0].t, 'health');
  assert.equal(vm.blocks[3].rows[0].t, 'notify');
  vm.tabs.find(tab => tab.label === 'Přehled').go();
  rejectRun = true;
  assert.equal(await vm.onPrimary(), false);
  assert.match(widget.catalogActionError, /zaneprázdněný/);
  rejectRun = false;
  runStatus = 'error';
  assert.equal(await model.detailVM(model.st()).onPrimary(), false);
  assert.match(widget.catalogActionError, /Zdroj selhal/);
  runStatus = 'success';
  assert.equal(await model.detailVM(model.st()).onPrimary(), true);
  model.detailVM(model.st()).tabs.find(tab => tab.label === 'Běhy').go();
  vm = model.detailVM(model.st());
  assert.equal(vm.blocks[0].rows[0].t, '#2 · success');
  vm.tabs.find(tab => tab.label === 'Přehled').go();
  assert.equal(await model.detailVM(model.st()).secondary[0].go(), true);
  assert.equal(model.detailVM(model.st()).hasPrimary, false);
  assert.equal(await model.detailVM(model.st()).secondary[1].go(), true, widget.catalogActionError);
  assert.equal(model.st().detail.workers, null);
  await model.loadWorkerDetail('legacy');
  model.setState({ detail: { workers: 'legacy' } });
  vm = model.detailVM(model.st());
  assert.equal(vm.hasPrimary, false);
  assert.deepEqual(vm.secondary, []);
  assert.match(JSON.stringify(vm.blocks), /legacy worker/);
  assert.equal(calls.some(([, path]) => path.startsWith('/api/agents/worker-m3/run')), false);
  assert.equal(calls.filter(([method, path]) => method === 'POST' && path.includes('/worker-m3/run')).length, 3);
});

test('media history actions refresh real state and report deferred cancellation honestly', async () => {
  const id = 'gen-1790400000000-30e4aab2';
  const calls = [];
  let status = 'running', favorite = 0, deleted = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      const method = options.method || 'GET';
      calls.push([method, path, options.body && JSON.parse(options.body)]);
      if (path.startsWith('/api/media/history')) return { ok: true, json: async () => ({
        generations: deleted ? [] : [{ id, type: 'txt2img', prompt: 'Krajina', status, favorite }] }) };
      if (path === '/api/media/cancel?id=' + id) return { ok: true,
        json: async () => ({ ok: true, message: 'Zrušení se projeví po dokončení aktuální úlohy' }) };
      if (path === '/api/media/favorite') {
        favorite = options.body && JSON.parse(options.body).favorite ? 1 : 0;
        return { ok: true, json: async () => ({ ok: true, favorite }) };
      }
      if (path === '/api/media?id=' + id) {
        deleted = true;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      throw new Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  widget.confirmAction = () => true;
  await catalog.load('Multimédia');
  model.setState({ mode: 'section', section: 'media', detail: { media: id } });
  let vm = model.detailVM(model.st());
  assert.equal(vm.primaryLabel, 'Zrušit generování');
  assert.equal(await vm.onPrimary(), true);
  vm = model.detailVM(model.st());
  assert.equal(vm.status, 'running', 'deferred cancellation must not appear complete');
  assert.match(JSON.stringify(vm.blocks), /po dokončení aktuální úlohy/);
  assert.equal(await vm.secondary[0].go(), true);
  assert.match(model.detailVM(model.st()).secondary[0].label, /Odebrat/);
  assert.deepEqual(calls.find(([method]) => method === 'PUT')[2], { id, favorite: true });
  status = 'completed';
  await catalog.load('Multimédia');
  vm = model.detailVM(model.st());
  assert.equal(vm.hasPrimary, false);
  assert.equal(await vm.secondary[1].go(), true);
  assert.equal(model.detailVM(model.st()), null);
  assert.deepEqual(calls.filter(([method]) => method !== 'GET').map(([method, path]) => [method, path]), [
    ['POST', '/api/media/cancel?id=' + id], ['PUT', '/api/media/favorite'], ['DELETE', '/api/media?id=' + id]]);
});

test('media form verifies ComfyUI and checkpoint, validates inputs, and observes accepted generation in history', async () => {
  const id = 'gen-1790400000001-4bcbd01a', requests = [];
  let available = false, started = false, rejectGenerate = false;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      requests.push([method, path, options.body && JSON.parse(options.body)]);
      if (path === '/api/media/health') return { ok: true, json: async () => ({ available }) };
      if (path === '/api/media/models') return { ok: true, json: async () => ({ checkpoints: ['real-checkpoint.safetensors'] }) };
      if (path === '/api/media/history') return { ok: true, json: async () => ({
        generations: started ? [{ id, type: 'txt2img', prompt: 'Krajina', status: 'pending' }] : [] }) };
      if (path === '/api/media/generate') {
        if (rejectGenerate) return { ok: false, status: 502, json: async () => ({ error: 'ComfyUI odmítlo plán' }) };
        started = true;
        return { ok: true, json: async () => ({ ok: true, generationId: id }) };
      }
      throw Error('Unexpected request: ' + path);
    } });
  const { model, widget } = setup({ catalog });
  await catalog.load('Multimédia');
  model.setState(model.pSelect(model.st(), 'media', '__new__'));
  await tick();
  assert.equal(model.mediaFormVM(model.st()).disabled, true, 'offline ComfyUI blocks generation');
  assert.equal(await model.submitMedia(model.st()), false);
  available = true;
  assert.equal(await model.loadMediaEnvironment(), true);
  model.setState({ mediaPrompt: 'Krajina', mediaWidth: 63 });
  assert.equal(model.mediaFormVM(model.st()).disabled, true, 'invalid dimensions block generation');
  model.setState({ mediaWidth: 1024 });
  const form = model.mediaFormVM(model.st());
  assert.equal(form.model, 'real-checkpoint.safetensors');
  assert.equal(form.disabled, false);
  rejectGenerate = true;
  assert.equal(await form.submit(), false);
  assert.match(widget.catalogActionError, /ComfyUI odmítlo plán/);
  assert.equal(model.st().detail.media, '__new__');
  rejectGenerate = false;
  assert.equal(await model.mediaFormVM(model.st()).submit(), true);
  assert.equal(model.st().detail.media, id);
  assert.equal(model.detailVM(model.st()).status, 'pending');
  assert.deepEqual(requests.filter(([method]) => method === 'POST').at(-1)[2], {
    type: 'txt2img', prompt: 'Krajina', negative_prompt: '',
    params: { width: 1024, height: 1024, steps: 20, cfg_scale: 7, seed: -1, model: 'real-checkpoint.safetensors' }
  });
});

test('completed media loads only safe output names as local object URLs', async () => {
  const id = 'gen-1790400000002-c48a8dc7', requests = [];
  const raw = { id, type: 'txt2img', prompt: 'Krajina', status: 'completed',
    outputs: JSON.stringify([`/home/user/.intentsmith/media/images/${id}/result.png`,
      `/home/user/.intentsmith/media/images/${id}/bad.html`,
      `/home/user/.intentsmith/media/images/${id}/error.webp`]) };
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      assert.equal(new URL(url).pathname, '/api/media/history');
      return { ok: true, json: async () => ({ generations: [raw] }) };
    } });
  const { model } = setup({ catalog });
  model.fetchImpl = async url => {
    requests.push(url);
    return { ok: true, blob: async () => new Blob(['fake'], { type: url.includes('error.webp') ? 'text/html' : 'image/png' }) };
  };
  await catalog.load('Multimédia');
  const item = catalog.view('Multimédia').items[0];
  await model.loadMediaOutputs(item);
  model.setState({ mode: 'section', section: 'media', detail: { media: id } });
  const outputs = model.detailVM(model.st()).blocks.find(block => block.isMediaOutputs).mediaOutputs;
  assert.deepEqual(outputs.map(output => output.name), ['result.png', 'error.webp']);
  assert.equal(outputs[0].ready, true);
  assert.match(outputs[0].url, /^blob:/);
  assert.equal(outputs[1].ready, false);
  assert.match(outputs[1].status, /nepodporovaný formát/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => url.includes('/api/media/output?id=' + id)));
  model.componentWillUnmount();
});

test('media WS events update progress and verify terminal state from history without a second transport', async () => {
  const id = 'gen-1790400000003-784bc072';
  let status = 'running', loads = 0;
  const catalog = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async url => {
      assert.equal(new URL(url).pathname, '/api/media/history');
      loads++;
      return { ok: true, json: async () => ({ generations: [{ id, type: 'txt2img',
        prompt: 'Krajina', status, outputs: '[]' }] }) };
    } });
  const { model } = setup({ catalog });
  model.statusClient.start = () => {};
  await catalog.load('Multimédia');
  model.componentDidMount();
  await tick();
  const initialLoads = loads;
  model.setState({ mode: 'section', section: 'media', detail: { media: id } });
  IntentSmithBus.emit('comfyui:progress', { generationId: id, percent: 42, text: 'Generuji' });
  assert.match(JSON.stringify(model.detailVM(model.st()).blocks), /Generuji · 42 %/);
  IntentSmithBus.emit('comfyui:complete', { generationId: 'other-id' });
  assert.equal(loads, initialLoads, 'invalid ID does not trigger refresh');
  status = 'completed';
  IntentSmithBus.emit('comfyui:complete', { generationId: id });
  await tick(); await tick();
  assert.equal(loads, initialLoads + 1);
  assert.equal(model.detailVM(model.st()).status, 'completed');
  assert.match(JSON.stringify(model.detailVM(model.st()).blocks), /Generování dokončeno/);
  model.componentWillUnmount();
  IntentSmithBus.emit('comfyui:progress', { generationId: id, percent: 99, text: 'Pozdě' });
  assert.doesNotMatch(JSON.stringify(model.detailVM(model.st()).blocks), /Pozdě/);
});

test('live view contains only actual sessions and messages, and swaps column ownership', () => {
  const { model, store } = setup();
  const first = store.focusedSession();
  first._label = 'Moje skutečná relace';
  first.chat.msgs.push({ role: 'user', text: 'Ahoj' }, { role: 'assistant', text: 'Odpověď' });
  const second = store.addSession({ label: 'Druhá skutečná relace' });
  store.setColumnCount(2);
  store.selectInColumn(0, first.id);
  let vm = model.renderVals();
  assert.equal(vm.columns.length, 2);
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

test('first message names a default session and live work collapses into timed phases', () => {
  const { model, store } = setup();
  const session = store.focusedSession();
  session._label = 'Nová relace';
  const activity = { startedAt: 1000, endedAt: 5100, status: 'done', steps: [
    { kind: 'step', label: 'Zpracovává zadání', startedAt: 1000, status: 'observed' },
    { kind: 'step', label: 'Volí postup', startedAt: 1200, status: 'observed' },
    { kind: 'step', label: 'Připravuje kontext', startedAt: 2000, status: 'observed' },
    { kind: 'tool', label: 'read_file', startedAt: 2300, durationMs: 100, status: 'done' },
    { kind: 'model', label: 'Generuje odpověď', input: 'Model / role: test:1', startedAt: 2500, status: 'done' },
    { kind: 'step', label: 'Odpověď vygenerována', startedAt: 4700, status: 'observed' },
    { kind: 'step', label: 'Kontroluje jazyk', startedAt: 4900, status: 'observed' },
  ] };
  session.chat.msgs.push({ role: 'user', text: 'Oprav chybu v projektu', _activity: activity },
    { role: 'assistant', text: 'Hotovo.' });
  const vm = model.renderVals();
  assert.equal(vm.columns[0].title, 'Oprav chybu v projektu');
  assert.equal(vm.nav[0].kids.find(item => item.hasNum).t, 'Oprav chybu v projektu');
  const reply = vm.columns[0].msgs[1];
  assert.equal(reply.hasFold, true);
  assert.match(reply.foldText, /4 fáze/);
  assert.equal(reply.hasSteps, true);
  assert.deepEqual(reply.steps.map(step => step.t), ['read_file']);
  reply.toggleFold();
  const expanded = model.renderVals().columns[0].msgs[1];
  assert.deepEqual(expanded.steps.map(step => step.t), [
    'Porozumění zadání', 'Příprava kontextu', 'read_file', 'Generování odpovědi · test:1', 'Kontroly výstupu']);
  assert.deepEqual(expanded.steps.map(step => step.m), ['1,0 s', '0,3 s', '0,1 s', '2,4 s', '0,2 s']);
  model.componentWillUnmount();
});

test('answer copy uses full Markdown and reports success or failure below the reply', async () => {
  const { model, store } = setup();
  store.focusedSession().chat.msgs.push({ role: 'assistant', text: '## Nadpis\n\n`kód`' });
  const previous = globalThis.navigator.clipboard;
  const copied = [];
  try {
    globalThis.navigator.clipboard = { writeText: async value => { copied.push(value); } };
    model.renderVals().columns[0].msgs[0].copy();
    await tick();
    assert.deepEqual(copied, ['## Nadpis\n\n`kód`']);
    assert.equal(model.renderVals().columns[0].msgs[0].copyNote, 'Zkopírováno');
    globalThis.navigator.clipboard = { writeText: async () => { throw Error('denied'); } };
    model.renderVals().columns[0].msgs[0].copy();
    await tick();
    assert.equal(model.renderVals().columns[0].msgs[0].copyNote, 'Kopírování se nepovedlo');
  } finally {
    globalThis.navigator.clipboard = previous;
    model.componentWillUnmount();
  }
});

test('attachment guard is context preparation and a completed phase never grows without an activity end', () => {
  const { model, store } = setup();
  const session = store.focusedSession();
  session.chat.msgs.push({ role: 'user', text: 'Přečti přílohu', _activity: { status: 'done', steps: [
    { kind: 'step', label: 'Kontroluje přílohy', startedAt: 1000, status: 'observed' },
    { kind: 'step', label: 'Volí postup', startedAt: 1200, status: 'observed' },
    { kind: 'step', label: 'Připravuje kontext', startedAt: 1500, status: 'observed' },
    { kind: 'model', label: 'Generuje odpověď', startedAt: 2000, status: 'done' },
  ] } }, { role: 'assistant', text: 'Přečteno.', ts: '1970-01-01T00:00:04.000Z' });
  model.renderVals().columns[0].msgs[1].toggleFold();
  const first = model.renderVals().columns[0].msgs[1].steps;
  assert.equal(first[0].t, 'Příprava kontextu');
  assert.equal(first.filter(step => step.t === 'Příprava kontextu').length, 1);
  assert.equal(first.at(-1).m, '2,0 s');
  const now = Date.now;
  try {
    Date.now = () => 999_999;
    assert.deepEqual(model.renderVals().columns[0].msgs[1].steps, first);
  } finally { Date.now = now; model.componentWillUnmount(); }
});

test('closed backend conversation appears first in Recent and can be reopened with its identity', async () => {
  const catalog = { view: section => ({ status: 'ready', items: section === 'Konverzace' ? [
    { id: 'older', name: 'Jiná konverzace' }, { id: 'closed-conv', name: 'Moje práce' },
  ] : [] }), load: () => {}, subscribe: () => () => {} };
  const { model, store, widget, storage } = setup({ catalog });
  const session = store.focusedSession();
  session._convId = 'closed-conv';
  store.closeSession(session.id);
  assert.deepEqual(new SessionStore(storage).state.closed, ['closed-conv']);
  const recent = model.renderVals().nav[0].kids.filter(item => item.isItem);
  assert.equal(recent[0].t, 'Moje práce');
  const opened = [];
  widget.openCatalogItem = async (section, item) => { opened.push([section, item.id]); return true; };
  recent[0].go();
  await tick();
  assert.deepEqual(opened, [['Konverzace', 'closed-conv']]);
  model.componentWillUnmount();
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

test('file tree actions bind the prototype form to project-scoped verified operations', async () => {
  const revision = 'a'.repeat(64), operations = [];
  const state = { root: '/safe/project', projectId: '17', tree: [
    { path: 'src', name: 'src', depth: 0, directory: true },
    { path: 'src/main.js', name: 'main.js', depth: 1, directory: false }], editor: null };
  const workspace = { entry: () => state, inspect: async (_session, path) => ({ projectId: 17, path,
    type: path === 'src' ? 'directory' : 'file', revision,
    ...(path === 'src' ? { entries: 1, protectedDescendants: false } : {}) }),
    operate: async (_session, operation) => { operations.push(operation); return true; },
    loadTree: async () => true, open: async () => false, save: async () => false, discard: () => {}, edit: () => {} };
  const { model, store } = setup({ workspace });
  const session = store.focusedSession(); session._projectId = '17';
  session._modifiedFiles = ['src/main.js'];
  const attachment = { name: 'scan.heic', type: 'attachment', size: '6715 KB' };
  session._focusFiles = [attachment, { name: 'main.js', path: 'src/main.js' }];
  session._fileChanges = { 'src/main.js': { added: 2, removed: 1 } };
  const scmEntry = model.scmClient.entry('17');
  scmEntry.diffs.set('unstaged|src/main.js', 'old diff');
  let scmLoads = 0;
  model.scmClient.load = async (_projectId, { refresh }) => { assert.equal(refresh, true); scmLoads++; return true; };
  model.setState({ rightTab: 'soubory' });
  let vm = model.renderVals().ws.fl;
  assert.equal(vm.canManage, true);
  await vm.tree.find(row => row.path === 'src/main.js').rename();
  vm = model.renderVals().ws.fl;
  assert.equal(vm.action.title, 'Přejmenovat');
  vm.action.setTarget({ target: { value: 'src/renamed.js' } });
  await model.renderVals().ws.fl.action.submit();
  assert.deepEqual(operations, [{ op: 'rename', path: 'src/main.js', to: 'src/renamed.js', expectedRevision: revision }]);
  assert.equal(model.st().fileAction, null);
  assert.deepEqual(session._modifiedFiles, ['src/renamed.js']);
  assert.deepEqual(session._focusFiles, [attachment, { name: 'main.js', path: 'src/renamed.js' }]);
  assert.deepEqual(session._fileChanges, { 'src/renamed.js': { added: 2, removed: 1 } });
  assert.equal(scmEntry.diffs.size, 0);
  state.editor = { path: 'src/main.js', dirty: true };
  await model.renderVals().ws.fl.tree.find(row => row.path === 'src/main.js').remove();
  assert.equal(model.st().fileAction, null, 'dirty edit prevents destructive action');
  assert.equal(operations.length, 1);
  state.editor = null;
  scmEntry.plan = { state: 'pending', planId: 'old-plan' };
  scmEntry.next = { op: 'push' };
  let scmCancels = 0;
  model.scmClient.cancel = async projectId => { assert.equal(projectId, '17'); scmCancels++; return true; };
  await model.renderVals().ws.fl.tree.find(row => row.path === 'src').remove();
  assert.match(model.renderVals().ws.fl.action.impact, /včetně obsahu\. Položek: 1\./);
  await model.renderVals().ws.fl.action.submit();
  assert.deepEqual(operations[1], { op: 'delete', path: 'src', to: '', expectedRevision: revision });
  assert.deepEqual(session._modifiedFiles, []);
  assert.deepEqual(session._focusFiles, [attachment]);
  assert.deepEqual(session._fileChanges, {});
  assert.equal(scmLoads, 2);
  assert.equal(scmCancels, 1);
  assert.equal(scmEntry.plan, null);
  assert.equal(scmEntry.next, null);
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
    plan: { version: 1, identity: { lifecycleId: 'life-17' }, state: 'awaiting_approval', origin: session._m2Pending.origin,
      changes: [{ path: 'app.txt' }], focusedTest: { binary: '/usr/bin/node', argv: ['test.js'], timeoutMs: 30000 }, gitCommit: false },
    audit: { governanceDecision: { verdict: 'allow' } },
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

test('lost SCM policy response reloads the committed policy without repeating automatic init', async () => {
  let writes = 0;
  let policy = { projectId: 17, revision: 0, init: 'ask', commit: 'ask', branch: 'ask',
    fetch: 'disabled', pull: 'ask', push: 'ask', remotes: [] };
  const reply = value => ({ ok: true, json: async () => value });
  const client = new ScmClient({ backendUrl: () => 'http://127.0.0.1:3335', fetchImpl: async (url, options = {}) => {
    const endpoint = new URL(url).pathname;
    if (endpoint === '/api/scm/policy' && options.method === 'PUT') {
      writes++;
      policy = { ...policy, init: 'automatic', revision: 1 };
      throw Error('response lost after effect');
    }
    if (endpoint === '/api/scm/policy') return reply(policy);
    if (endpoint === '/api/scm/status') return reply({ projectId: 17, isRepo: true, files: [] });
    if (endpoint === '/api/scm/branches') return reply({ branches: [] });
    if (endpoint === '/api/scm/log') return reply({ commits: [] });
    if (endpoint === '/api/scm/operations') return reply([]);
    throw Error('Unexpected ' + endpoint);
  } });
  const entry = client.entry(17);
  entry.status = 'ready'; entry.policy = policy;
  assert.equal(await client.setPolicy(17, { init: 'automatic' }), false);
  assert.equal(writes, 1);
  assert.equal(entry.policy.revision, 1);
  assert.equal(entry.data.isRepo, true);
  assert.match(entry.error, /není jistý/);
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
    ? [{ id: 'specialist-9', name: 'Testovací specialista', description: 'Popis',
      raw: { id: 'specialist-9', status: 'enabled' } }] : [] });
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

test('chat Tab completes only on explicit input, scopes its request, and second Tab accepts without another model call', async () => {
  const { fixture } = await import('./helpers/studio2-live-harness.js');
  const f = fixture(), sid = f.session.id;
  f.model.setState({ drafts: { [sid]: 'Napiš test' } });
  f.model.fetchImpl = async (url, options) => { f.calls.push({ url, options }); return { ok: true, json: async () => ({ suggestion: ' pro součet' }) }; };
  assert.equal(f.calls.length, 0);
  assert.equal(await f.model.completeChat(sid, 'Napiš test'), true);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /\/api\/autocomplete$/);
  assert.equal(JSON.parse(f.calls[0].options.body).partial, 'Napiš test');
  assert.equal(f.model.st().drafts[sid], 'Napiš test');
  assert.equal(await f.model.completeChat(sid, 'Napiš test'), true);
  assert.equal(f.model.st().drafts[sid], 'Napiš test pro součet'); assert.equal(f.calls.length, 1);
  assert.equal(f.session.chat._autocomplete, null);
});

test('late autocomplete cannot attach to a changed conversation, input or project, and failed HTTP does not supply text', async () => {
  const { fixture } = await import('./helpers/studio2-live-harness.js');
  for (const change of [f => { f.session._projectId = '28'; }, f => { f.session._convId = 'different'; },
    f => { f.model.setState({ drafts: { [f.session.id]: 'new text' } }); }]) {
    const f = fixture(); f.model.setState({ drafts: { [f.session.id]: 'Napiš test' } }); let resolve;
    f.model.fetchImpl = () => new Promise(done => { resolve = done; });
    const pending = f.model.completeChat(f.session.id, 'Napiš test'); change(f);
    resolve({ ok: true, json: async () => ({ suggestion: 'FOREIGN CANARY' }) });
    assert.equal(await pending, false); assert.equal(f.session.chat._autocomplete?.suggestion, undefined);
    assert.equal(JSON.stringify(f.model.renderVals()).includes('FOREIGN CANARY'), false);
  }
  const f = fixture(); f.model.setState({ drafts: { [f.session.id]: 'Napiš test' } });
  f.model.fetchImpl = async () => ({ ok: false, status: 503 });
  assert.equal(await f.model.completeChat(f.session.id, 'Napiš test'), false);
  assert.match(f.session.chat._autocomplete.notice, /HTTP 503/); assert.equal(f.model.st().drafts[f.session.id], 'Napiš test');
});

test('regenerate asks once, sends the last user request as a new turn and refuses busy, dirty or changed owners', async () => {
  const { fixture } = await import('./helpers/studio2-live-harness.js');
  const f = fixture(); f.session.chat.msgs = [{ role: 'user', text: 'Spočítej součet' }, { role: 'assistant', text: 'Výsledek' }];
  assert.equal(await f.model.regenerateAnswer(f.session), true); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].send, 'Spočítej součet'); assert.equal(f.control.confirmations.length, 1);
  f.control.active = true; assert.equal(await f.model.regenerateAnswer(f.session), false); assert.equal(f.calls.length, 1);
  f.control.active = false; f.model.setState({ drafts: { [f.session.id]: 'rozepsáno' } });
  assert.equal(await f.model.regenerateAnswer(f.session), false); assert.equal(f.calls.length, 1);
  f.model.setState({ drafts: {} }); f.widget.confirmAction = () => { f.store.closeSession(f.session.id); return true; };
  assert.equal(await f.model.regenerateAnswer(f.session), false); assert.equal(f.calls.length, 1);
});

test('generic conversation history does not activate a specialist from descriptive membership', async () => {
  const item = { id: 'history', name: 'Historie', raw: { specialist_id: 'reviewer', specialist_name: 'Reviewer' } };
  const catalog = { view: () => ({ status: 'ready', items: [item] }), load() {}, subscribe: () => () => {} };
  const { model, widget } = setup({ catalog });
  const opened = [];
  widget.openCatalogItem = async (section, row) => { opened.push([section, row.id]); return true; };
  widget.openSpecialistConversation = () => { throw Error('Display metadata must not select a backend role'); };
  model.pOpenSession(model.st(), item.id);
  await tick();
  assert.deepEqual(opened, [['Konverzace', 'history']]);
  assert.equal(widget.store.focusedSession().chat.specialist, null);
  model.componentWillUnmount();
});

test('all session controls show contiguous MRU ranks and Alt+5 selects the same stable owner', () => {
  const { model, store } = setup();
  for (let i = 1; i < 5; i++) store.addSession({ label: 'Práce ' + i });
  const ids = store.state.sessions.map(session => session.id), recent = store.recent();
  model.setState({ ctx: { sec: 'colpick', id: '0', x: 10, y: 10 } });
  const menu = model.ctxVM(model.st()).ctxItems.filter(item => item.hasNum);
  assert.deepEqual(menu.map(item => item.num), [1, 2, 3, 4, 5]);
  assert.deepEqual(menu.map(item => item.t), recent.map(id => store.find(id)._label));
  const fifth = recent[4];
  model.onKey({ key: '5', altKey: true, preventDefault() {}, stopPropagation() {} });
  assert.equal(store.focusedSession().id, fifth);
  assert.deepEqual(store.recent(), [fifth, ...recent.slice(0, 4)]);
  assert.deepEqual(store.state.sessions.map(session => session.id), ids);
  const vm = model.renderVals();
  const kids = vm.nav[0].kids.filter(row => row.hasNum);
  assert.deepEqual(kids.map(row => row.num), [1, 2, 3, 4, 5]);
  assert.equal(kids[0].t, store.find(fifth)._label);
  assert.equal(vm.columns.find(column => column.numCls === 'focus').n, 1);
  model.componentWillUnmount();
});

test('conversation tiles, list and details use real context, newest use and UTC backend dates', () => {
  const catalog = { view: section => ({ status: 'ready', items: section === 'Konverzace' ? [
    { id: 'old', name: 'Starší chat', raw: { created_at: '2026-09-20 10:00:00', updated_at: '2026-09-22 10:00:00', state: 'active' } },
    { id: 'work', name: 'Projekt se specialistou', raw: { project_id: 7, project_name: 'Atlas', specialist_id: 'reviewer',
      specialist_name: 'Reviewer', created_at: '2026-09-23 10:00:00', updated_at: '2026-09-28 10:00:00' } },
    { id: 'invalid', name: 'Bez času', raw: { created_at: 'invalid', updated_at: null } },
  ] : section === 'Projekty' ? [{ id: '7', name: 'Atlas', raw: { path: '/atlas' } }]
    : section === 'Specialisté' ? [{ id: 'reviewer', name: 'Reviewer', raw: {} }] : [] }),
    load: () => {}, subscribe: () => () => {} };
  const { model, store } = setup({ catalog });
  store.closeSession(store.focusedSession().id);
  let s = { ...model.st(), mode: 'section', section: 'chats', detail: { chats: 'work' } };
  assert.match(model.catalogVM(s).summary, /0 otevřených relací/);
  const rows = model.entities('chats', s);
  assert.deepEqual(rows.map(row => row.id), ['work', 'old', 'invalid']);
  assert.deepEqual(rows[0].badges.map(row => [row.label, row.tone]), [['Projekt', 'red'], ['Specialista', 'violet']]);
  assert.ok(rows.every(row => row.tone === 'neutral' && row.icls === 'neutral'));
  assert.equal(rows[0].sub, 'Atlas · Reviewer');
  assert.equal(rows[1].badges[0].label, 'Chat');
  assert.equal(rows[2].usedText, '—');
  assert.equal(model.timestamp('2026-09-28 10:00:00'), Date.parse('2026-09-28T10:00:00Z'));
  const when = Date.parse('2026-09-28T12:00:00Z');
  assert.equal(model.ageText('2026-09-28T11:57:00Z', when), '3m');
  assert.equal(model.ageText('2026-09-28T07:00:00Z', when), '5h');
  assert.equal(model.ageText('2026-09-22T12:00:00Z', when), '6d');
  assert.equal(model.ageText('invalid', when), '—');
  let detail = model.detailVM(s);
  assert.deepEqual(detail.badges.map(row => row.label), ['Projekt', 'Specialista']);
  assert.equal(detail.tone, 'neutral');
  assert.equal(detail.icls, 'neutral');
  assert.equal(detail.props.find(prop => prop.k === 'Vytvořeno').v, model.dateText('2026-09-23T10:00:00Z'));
  assert.equal(detail.props.find(prop => prop.k === 'Poslední aktivita').v, model.dateText('2026-09-28T10:00:00Z'));
  store.conversationActivity.old = '2026-09-28T12:00:00Z';
  assert.equal(model.entities('chats', s)[0].id, 'old', 'opening time promotes saved conversations');
  const session = store.addSession({ convId: 'work', projectId: 7, specialistData: { id: 'reviewer', name: 'Reviewer' } });
  s = { ...s, ...model.st(), section: 'chats', detail: { chats: session.id } };
  assert.match(model.catalogVM(s).summary, /1 otevřená relace/);
  detail = model.detailVM(s);
  assert.deepEqual(detail.badges.map(row => row.label), ['Projekt', 'Specialista']);
  assert.ok(detail.props.some(prop => prop.k === 'Vytvořeno'));
  assert.equal(model.entities('chats', s).filter(row => row.name === 'Projekt se specialistou').length, 0);
  assert.equal(model.entities('chats', s).filter(row => row.id === session.id).length, 1);
  model.componentWillUnmount();
});

test('project detail carries real creation and activity dates and keeps unknown times unknown', () => {
  const projects = [{ id: '7', name: 'Atlas', state: 'active', raw: { path: '/atlas',
    created_at: '2026-09-20 08:30:00', last_active: '2026-09-28 09:00:00' } },
    { id: '8', name: 'Bez času', state: 'active', raw: { path: '/unknown', created_at: 'invalid' } }];
  const catalog = { view: section => ({ status: 'ready', items: section === 'Projekty' ? projects : [] }),
    load() {}, subscribe: () => () => {} };
  const { model, store } = setup({ catalog });
  const state = { ...model.st(), mode: 'section', section: 'projects', detail: { projects: '7' } };
  const detail = model.detailVM(state);
  assert.equal(detail.props.find(p => p.k === 'Vytvořeno').v, model.dateText('2026-09-20T08:30:00Z'));
  assert.equal(detail.props.find(p => p.k === 'Poslední aktivita').v, model.dateText('2026-09-28T09:00:00Z'));
  store.projectActivity['7'] = '2026-09-28T12:00:00Z';
  assert.equal(model.detailVM(state).props.find(p => p.k === 'Poslední aktivita').v,
    model.dateText('2026-09-28T12:00:00Z'));
  const unknown = model.detailVM({ ...state, detail: { projects: '8' } });
  assert.equal(unknown.props.find(p => p.k === 'Vytvořeno').v, '—');
  assert.equal(unknown.props.find(p => p.k === 'Poslední aktivita').v, '—');
  model.componentWillUnmount();
});

// C24: DOM is synthetic; the real catalog request logic uses in-memory Responses.
function c24ExportFixture(t, { response, handler, project = null, clickThrows = false } = {}) {
  const calls = [], clicked = [], blobs = [], revoked = [];
  const text = '# Český rozhovor\n\nPříliš žluťoučký kůň.\n';
  const payload = { filename: 'český-rozhovor-123.md', download_url: '/api/artifacts/český-rozhovor-123.md',
    format: 'md', scope: 'conversation', turn_count: 1, size: Buffer.byteLength(text), ...response };
  let base = 'http://127.0.0.1:33117';
  const catalog = new CatalogStore({ backendUrl: () => base, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (handler) return handler(url, options, payload, text);
    return options.method === 'POST' ? Response.json(payload) : new Response(text);
  } });
  const { model, store } = setup({ catalog });
  const session = store.focusedSession(); session._convId = 'chat-one'; session._projectId = project;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: type => {
    assert.equal(type, 'a'); return { click() { if (clickThrows) throw Error('download denied'); clicked.push({href:this.href,download:this.download}); } };
  } } });
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:c24-' + blobs.length; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  t.after(() => { model.componentWillUnmount(); if (previous) Object.defineProperty(globalThis,'document',previous); else delete globalThis.document; });
  const item = () => model.menusVM(model.st(),session.id).find(menu=>menu.label==='Soubor').items
    .find(row=>row.t==='Exportovat otevřenou konverzaci (Markdown)' || row.t==='Připravuji export konverzace…');
  return { model,store,session,catalog,calls,clicked,blobs,revoked,text,payload,item,setBase:value=>{base=value;} };
}

test('C24 menu exports the explicitly clicked chat after focus moves, with exact UTF-8 bytes and URL cleanup',async t=>{
  const f=c24ExportFixture(t); const menu=f.item(); assert.ok(menu,'actual Soubor menu contains conversation export'); assert.equal(menu.cls,'');
  const other=f.store.addSession({});other._convId='project-two';other._projectId='7';f.store.focusTab(other.id);
  assert.equal(await menu.go(),true);
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{conversation_id:'chat-one',format:'md',scope:'conversation'});
  assert.equal(f.calls[1].url,'http://127.0.0.1:33117/api/artifacts/%C4%8Desk%C3%BD-rozhovor-123.md');
  assert.ok(f.calls.every(row=>row.options.credentials==='same-origin' && row.options.redirect==='error' && row.options.signal));
  assert.equal(await f.blobs[0].text(),f.text);assert.deepEqual(f.clicked,[{href:'blob:c24-1',download:f.payload.filename}]);
  assert.match(f.model.st().toast.t,/připravena ke stažení/);assert.equal(f.model.st().toast.t.includes('uložena na disk'),false);
  assert.equal(f.session.chat._delivery,null);assert.equal(other.chat._delivery,null);
  f.model.componentWillUnmount();assert.deepEqual(f.revoked,['blob:c24-1']);
});

test('C24 project-scoped session exports its conversation, never the project ID',async t=>{
  const f=c24ExportFixture(t,{project:'27'});f.session._convId='project-conversation';
  assert.equal(await f.item().go(),true);assert.equal(JSON.parse(f.calls[0].options.body).conversation_id,'project-conversation');assert.equal(f.calls.length,2);
});

for(const boundary of ['unsaved','closed','catalog','thinking','preparing','unknown-delivery'])test('C24 disabled menu boundary '+boundary,async t=>{
  const f=c24ExportFixture(t);
  if(boundary==='unsaved')f.session._convId=null;
  if(boundary==='closed')f.session._closed=true;
  if(boundary==='catalog')f.model.setState({mode:'section',section:'chats'});
  if(boundary==='thinking')f.session.chat._thinking=true;
  if(boundary==='preparing')f.session.chat._preparing=true;
  if(boundary==='unknown-delivery')f.session.chat._delivery={status:'DELIVERY_UNKNOWN'};
  const menu=f.item();assert.equal(menu.cls,'dis');assert.equal(await menu.go(),false);assert.equal(f.calls.length,0);
});

for(const boundary of ['conversation','project','closed'])test('C24 stale menu identity stops before request: '+boundary,async t=>{
  const f=c24ExportFixture(t),menu=f.item();
  if(boundary==='conversation')f.session._convId='replacement';
  if(boundary==='project')f.session._projectId='other-project';
  if(boundary==='closed')f.session._closed=true;
  assert.equal(await menu.go(),false);assert.equal(f.calls.length,0);assert.equal(f.clicked.length,0);
});

test('C24 pending export disables duplicate submission; changed project cancels before GET',async t=>{
  let resolve;const f=c24ExportFixture(t,{handler:()=>new Promise(r=>{resolve=r;})});
  const first=f.item().go();assert.equal(f.item().cls,'dis');assert.equal(await f.item().go(),false);assert.equal(f.calls.length,1);
  f.session._projectId='changed';f.store.changed();resolve(Response.json(f.payload));
  assert.equal(await first,false);assert.equal(f.calls.length,1);assert.equal(f.clicked.length,0);assert.equal(f.model._conversationExport,null);
  assert.equal(f.model.st().toast.tone,'warn');
});

test('C24 unmount cancels pending response without a DOM download or success notice',async t=>{
  let resolve;const f=c24ExportFixture(t,{handler:()=>new Promise(r=>{resolve=r;})});const pending=f.item().go();
  f.model.componentWillUnmount();resolve(Response.json(f.payload));assert.equal(await pending,false);assert.equal(f.calls.length,1);assert.equal(f.clicked.length,0);
});

for(const status of [400,404,409])test('C24 HTTP '+status+' is an honest error with no GET/download',async t=>{
  const f=c24ExportFixture(t,{handler:()=>Response.json({error:'Original API error '+status},{status})});
  assert.equal(await f.item().go(),false);assert.equal(f.calls.length,1);assert.equal(f.clicked.length,0);
  assert.match(f.model.st().toast.t,new RegExp('Original API error '+status));assert.equal(f.model.st().toast.tone,'warn');
});

for(const [label,response] of [
  ['external URL',{download_url:'https://example.com/x.md'}],['protocol-relative URL',{download_url:'//example.com/x.md'}],
  ['wrong artifact',{download_url:'/api/artifacts/another.md'}],['path traversal',{filename:'../x.md',download_url:'/api/artifacts/../x.md'}],
  ['encoded slash',{filename:'a%2fb.md',download_url:'/api/artifacts/a%2fb.md'}],['wrong scope',{scope:'summary'}],
  ['wrong format',{format:'html'}],['unknown size',{size:null}],
])test('C24 malformed export rejected before GET: '+label,async t=>{
  const f=c24ExportFixture(t,{response});assert.equal(await f.item().go(),false);assert.equal(f.calls.length,1);assert.equal(f.clicked.length,0);
});

test('C24 changed backend between POST and GET stops rather than redirecting identity',async t=>{
  let resolve;const f=c24ExportFixture(t,{handler:()=>new Promise(r=>{resolve=r;})});const pending=f.item().go();
  f.setBase('http://127.0.0.1:33118');resolve(Response.json(f.payload));assert.equal(await pending,false);assert.equal(f.calls.length,1);
});

test('C24 unsuccessful artifact GET does not claim successful export',async t=>{
  const f=c24ExportFixture(t,{handler:(url,options,payload)=>options.method==='POST'?Response.json(payload):new Response('missing',{status:404})});
  assert.equal(await f.item().go(),false);assert.equal(f.calls.length,2);assert.equal(f.clicked.length,0);assert.match(f.model.st().toast.t,/HTTP 404/);
});

test('C24 mismatched downloaded byte length cannot become a browser download',async t=>{
  const f=c24ExportFixture(t,{handler:(url,options,payload)=>options.method==='POST'?Response.json(payload):new Response('partial')});
  assert.equal(await f.item().go(),false);assert.equal(f.clicked.length,0);assert.match(f.model.st().toast.t,/velikost/);
});

test('C24 DOM download error releases the object URL and reports failure',async t=>{
  const f=c24ExportFixture(t,{clickThrows:true});assert.equal(await f.item().go(),false);assert.deepEqual(f.revoked,['blob:c24-1']);assert.equal(f.clicked.length,0);assert.match(f.model.st().toast.t,/download denied/);
});

test('C24 catalog reuses the actual local capability bootstrap on POST and GET',async()=>{
  const {installLegacyLocalFetch}=require('../intentsmith-ide/applications/electron/intentsmith-local-http-bootstrap.js');
  const calls=[],text='known bytes',access={backendUrl:'http://127.0.0.1:33117',localCapability:'a'.repeat(43)};
  const scope={Request,Headers,electronIntentSmith:{getLocalAccess:()=>access},fetch:async request=>{
    calls.push(request);assert.equal(request.headers.get('X-IntentSmith-Local-Capability'),access.localCapability);assert.equal(request.redirect,'error');
    return request.method==='POST'?Response.json({filename:'known.md',download_url:'/api/artifacts/known.md',format:'md',scope:'conversation',turn_count:1,size:Buffer.byteLength(text)}):new Response(text);
  }};
  installLegacyLocalFetch(scope);
  const catalog=new CatalogStore({backendUrl:()=>access.backendUrl,fetchImpl:scope.fetch});
  const result=await catalog.exportConversation('exact-conversation');assert.equal(await result.blob.text(),text);assert.equal(calls.length,2);
  assert.deepEqual(await calls[0].json(),{conversation_id:'exact-conversation',format:'md',scope:'conversation'});
});

test('C24 download URL is revoked by the existing bounded delay and not twice on unmount',async t=>{
  const f=c24ExportFixture(t),timers=[];
  t.mock.method(globalThis,'setTimeout',(fn,ms)=>{timers.push({fn,ms});return {unref(){}};});
  assert.equal(await f.item().go(),true);assert.equal(f.revoked.length,0);
  const timer=timers.find(row=>row.ms===30000);assert.ok(timer);timer.fn();assert.deepEqual(f.revoked,['blob:c24-1']);
  f.model.componentWillUnmount();assert.deepEqual(f.revoked,['blob:c24-1']);
});

test('C24 already cancelled export never calls the catalog transport',async()=>{
  let calls=0;const controller=new AbortController();controller.abort();
  const catalog=new CatalogStore({backendUrl:()=> 'http://127.0.0.1:33117',fetchImpl:()=>{calls++;throw Error('must not call');}});
  await assert.rejects(catalog.exportConversation('chat-one',{signal:controller.signal}));assert.equal(calls,0);
});

test('C24 malformed successful response is reported as invalid export without leaking implementation error',async t=>{
  const f=c24ExportFixture(t,{handler:()=>Response.json(null)});assert.equal(await f.item().go(),false);assert.equal(f.calls.length,1);
  assert.match(f.model.st().toast.t,/platný Markdown export/);assert.equal(f.clicked.length,0);
});

test('C24 changed conversation while artifact body is pending suppresses the stale browser download',async t=>{
  let resolveDownload;const f=c24ExportFixture(t,{handler:(url,options,payload)=> options.method==='POST'
    ? Response.json(payload) : new Promise(resolve=>{resolveDownload=resolve;})});
  const pending=f.item().go();await tick();assert.equal(f.calls.length,2);
  f.session._convId='new-conversation';f.store.changed();resolveDownload(new Response(f.text));
  assert.equal(await pending,false);assert.equal(f.blobs.length,0);assert.equal(f.clicked.length,0);
});
