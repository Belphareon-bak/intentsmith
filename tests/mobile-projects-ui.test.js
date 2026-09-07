import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function makeStorage() {
  const data = {};
  const method = (name, value) => Object.defineProperty(data, name, { value, enumerable: false });
  method('getItem', key => (Object.hasOwn(data, key) ? data[key] : null));
  method('setItem', (key, value) => { data[key] = String(value); });
  method('removeItem', key => { delete data[key]; });
  method('clear', () => { for (const key of Object.keys(data)) delete data[key]; });
  return data;
}

const body = element('body');
function element(tag = 'div') {
  const classes = new Set();
  const node = {
    tagName: tag.toUpperCase(),
    className: '', innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, children: [],
    scrollTop: 0, scrollHeight: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    appendChild(child) { node.children.push(child); return child; },
    remove() {
      const index = body.children.indexOf(node);
      if (index >= 0) body.children.splice(index, 1);
    },
    addEventListener() {},
  };
  return node;
}

const nodes = { app: element(), toasts: element() };
globalThis.localStorage = makeStorage();
globalThis.document = {
  body,
  visibilityState: 'visible',
  getElementById: id => nodes[id] || null,
  querySelector: selector => {
    const wanted = selector.replace(/^\./, '');
    return body.children.find(child => String(child.className).split(/\s+/).includes(wanted)) || null;
  },
  createElement: tag => element(tag),
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState() {} };
globalThis.fetch = async () => { throw new TypeError('network disabled'); };

const { __ms20 } = await import('../src/mobile/client/app.js');
const {
  state, store, K, viewProjects, viewProject, loadProjects, loadProject,
  validProjectPage, validProjectConversationPage, loadProjectConversations,
  invalidateProjectConversationSurface,
  currentSection, screenLocks, trustBar,
} = __ms20;

function reset(scopes = ['read:projects']) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.route = 'projects';
  state.conn = 'ok';
  state.projectId = null;
  state.projectState = 'active';
  state.data = {};
  state.pagination = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.projectConversations = { cursor: null, end: false, loadingOlder: false };
  state.serverOffsetMs = 0;
  nodes.app.innerHTML = '';
  body.children.length = 0;
  globalThis.fetch = async () => { throw new TypeError('network disabled'); };
}

function conversation(overrides = {}) {
  return {
    id: 'chat-1',
    title: 'Mobilní návrh',
    messageCount: 3,
    state: 'active',
    createdAt: '2026-09-03T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    version: 'v1:def',
    ...overrides,
  };
}

function conversationPage(data, overrides = {}) {
  return {
    ok: true,
    scopes: ['read:projects', 'read:chat'],
    data,
    hasMore: false,
    nextCursor: null,
    end: true,
    ...overrides,
  };
}

function project(overrides = {}) {
  return {
    id: '17',
    name: 'IntentSmith',
    state: 'active',
    createdAt: '2026-05-02T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    conversationCount: 4,
    version: 'v1:abc',
    ...overrides,
  };
}

function projectPage(data, overrides = {}) {
  return {
    ok: true,
    scopes: ['read:projects'],
    state: 'active',
    data,
    hasMore: false,
    nextCursor: null,
    end: true,
    ...overrides,
  };
}

console.log('\n=== Mobile project UI ===');

await test('project list is a real navigation section and detail stays under it', () => {
  reset();
  assert.equal(currentSection(), 'projects');
  state.route = 'project';
  assert.equal(currentSection(), 'projects');
});

await test('missing scope renders a lock and no remembered project data', () => {
  reset([]);
  state.data.projects = [project({ name: 'Must not render' })];
  const markup = viewProjects();
  assert.match(markup, /Bez oprávnění/);
  assert.ok(!markup.includes('Must not render'));
  assert.deepEqual(screenLocks(), ['projekty']);
});

await test('loading and failed reads never claim the project list is empty', () => {
  reset();
  state.loading.projects = true;
  assert.ok(!viewProjects().includes('Zatím žádné aktivní projekty'));
  state.loading.projects = false;
  state.error.projects = { kind: 'offline' };
  const markup = viewProjects();
  assert.match(markup, /Nejsi online/);
  assert.ok(!markup.includes('Zatím žádné aktivní projekty'));
});

await test('confirmed empty state is explicit for active and archived filters', () => {
  reset();
  state.data.projects = [];
  assert.match(viewProjects(), /Zatím žádné aktivní projekty/);
  state.projectState = 'archived';
  assert.match(viewProjects(), /Archiv je prázdný/);
});

await test('project rows escape names and expose the server count', () => {
  reset();
  state.data.projects = [project({ name: '<script>alert(1)</script>' })];
  const markup = viewProjects();
  assert.ok(!markup.includes('<script>'));
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /4 konverzace/);
  assert.match(markup, /data-act="open-project" data-id="17"/);
});

await test('project detail is labelled read-only and exposes no mutation control', () => {
  reset();
  state.route = 'project';
  state.projectId = '17';
  state.data.project = project();
  const markup = viewProject();
  assert.match(markup, /Mobilní projekce je zatím pouze pro čtení/);
  assert.match(markup, /4/);
  assert.ok(!/data-act="(?:archive|delete|edit|save)-project"/.test(markup));
});

await test('project detail keeps metadata visible while chat scope is explicitly locked', () => {
  reset(['read:projects']);
  state.route = 'project';
  state.projectId = '17';
  state.data.project = project();
  state.data.projectConversations = [conversation({ title: 'Must not render' })];
  const markup = viewProject();
  assert.match(markup, /Konverzace jsou zamčené/);
  assert.match(markup, /read:chat/);
  assert.ok(!markup.includes('Must not render'));
  assert.deepEqual(screenLocks(), ['konverzace projektu']);
});

await test('confirmed project conversations escape content and open the existing chat surface', () => {
  reset(['read:projects', 'read:chat']);
  state.route = 'project';
  state.projectId = '17';
  state.data.project = project();
  state.data.projectConversations = [conversation({ title: '<script>bad()</script>' })];
  state.projectConversations.end = true;
  const markup = viewProject();
  assert.match(markup, /Konverzace projektu/);
  assert.match(markup, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.ok(!markup.includes('<script>'));
  assert.match(markup, /data-act="open-chat" data-id="chat-1"/);
  assert.match(markup, /telefon ho neukládá do trvalé cache/);
  assert.ok(!/data-act="new-chat"/.test(markup));
});

await test('project conversations distinguish loading, failure and confirmed empty', () => {
  reset(['read:projects', 'read:chat']);
  state.route = 'project';
  state.projectId = '17';
  state.data.project = project();
  state.loading.projectConversations = true;
  assert.ok(!viewProject().includes('Projekt nemá žádné konverzace'));
  state.loading.projectConversations = false;
  state.error.projectConversations = { kind: 'offline' };
  const failed = viewProject();
  assert.match(failed, /Nejsi online/);
  assert.match(failed, /data-act="load-project-conversations"/);
  state.error.projectConversations = null;
  state.data.projectConversations = [];
  assert.match(viewProject(), /Projekt nemá žádné konverzace/);
});

await test('project conversation page validation is exact and rejects overlaps in one page', () => {
  assert.equal(validProjectConversationPage(conversationPage([conversation()])), true);
  assert.equal(validProjectConversationPage(conversationPage([
    conversation(), conversation({ title: 'Duplicate' }),
  ])), false);
  assert.equal(validProjectConversationPage(conversationPage([
    { ...conversation(), projectId: '17' },
  ])), false);
  assert.equal(validProjectConversationPage(conversationPage([], {
    hasMore: true, nextCursor: null, end: false,
  })), false);
});

await test('project detail automatically loads its live conversation drill-down', async () => {
  reset(['read:projects', 'read:chat']);
  state.route = 'project';
  state.projectId = '17';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const payload = url === '/m1/projects/17'
      ? { ok: true, scopes: ['read:projects', 'read:chat'], data: project() }
      : conversationPage([conversation()]);
    return { ok: true, status: 200, async json() { return payload; } };
  };

  await loadProject();

  assert.deepEqual(calls.map(call => call.url), [
    '/m1/projects/17',
    '/m1/conversations?projectId=17&limit=20',
  ]);
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(state.data.project.id, '17');
  assert.deepEqual(state.data.projectConversations.map(item => item.id), ['chat-1']);
  assert.ok(store.get(K.cache + 'project.17'));
  assert.equal(store.get(K.cache + 'projectConversations.17'), null);
});

await test('project conversation pagination appends one server-issued page', async () => {
  reset(['read:projects', 'read:chat']);
  state.route = 'project';
  state.projectId = '17';
  state.data.project = project();
  const calls = [];
  const responses = [
    conversationPage([conversation()], { hasMore: true, nextCursor: 'c1.opaque', end: false }),
    conversationPage([conversation({ id: 'chat-2', title: 'Starší' })]),
  ];
  globalThis.fetch = async url => ({
    ok: true,
    status: 200,
    async json() { calls.push(url); return responses.shift(); },
  });

  await loadProjectConversations();
  await loadProjectConversations({ append: true });

  assert.deepEqual(calls, [
    '/m1/conversations?projectId=17&limit=20',
    '/m1/conversations?projectId=17&limit=20&cursor=c1.opaque',
  ]);
  assert.deepEqual(state.data.projectConversations.map(item => item.id), ['chat-1', 'chat-2']);
  assert.equal(state.projectConversations.end, true);
});

await test('overlapping project pages fail as protocol errors without duplicating rows', async () => {
  reset(['read:projects', 'read:chat']);
  state.route = 'project';
  state.projectId = '17';
  state.data.project = project();
  state.data.projectConversations = [conversation()];
  state.projectConversations = { cursor: 'c1.next', end: false, loadingOlder: false };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return conversationPage([conversation()]); },
  });

  await loadProjectConversations({ append: true });

  assert.deepEqual(state.data.projectConversations.map(item => item.id), ['chat-1']);
  assert.equal(state.error.projectConversations.code, 'protocol_invalid_response');
  assert.equal(state.conn, 'server');
});

await test('project conversation surface is withdrawn without touching project metadata', () => {
  reset(['read:projects', 'read:chat']);
  state.data.project = project();
  state.data.projectConversations = [conversation()];
  state.error.projectConversations = { kind: 'offline' };
  state.projectConversations = { cursor: 'c1.next', end: false, loadingOlder: true };

  invalidateProjectConversationSurface();

  assert.equal(state.data.project.id, '17');
  assert.equal(state.data.projectConversations, undefined);
  assert.equal(state.error.projectConversations, null);
  assert.deepEqual(state.projectConversations, { cursor: null, end: false, loadingOlder: false });
});

await test('a stale project list is called stale in the trust bar', () => {
  reset();
  state.data.projects = [project()];
  state.cacheAge.projects = 'STALE';
  state.cacheAt.projects = Date.now() - 120_000;
  assert.match(trustBar(), /Data z|Starší data/);
});

await test('load uses the scoped project route and persists an offline copy', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return projectPage([project()]);
      },
    };
  };
  await loadProjects('active');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/m1/projects?state=active&limit=100');
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(state.data.projects[0].id, '17');
  assert.ok(store.get(K.cache + 'projects.active'));
});

await test('scope withdrawal clears every project cache and published surface', async () => {
  reset();
  store.set(K.cache + 'project.17', { at: Date.now(), data: project() });
  store.set(K.cache + 'project.18', { at: Date.now(), data: project({ id: '18' }) });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return projectPage([project()], { scopes: [] });
    },
  });

  await loadProjects('active');

  assert.equal(state.data.projects, undefined);
  assert.equal(store.get(K.cache + 'projects.active'), null);
  assert.equal(store.get(K.cache + 'project.17'), null);
  assert.equal(store.get(K.cache + 'project.18'), null);
});

await test('MM3-E a partial project filter exposes one disabled-safe continuation control', () => {
  reset();
  state.data.projects = [project()];
  state.pagination.projects = { hasMore: true, nextCursor: 'c1.active', end: false };
  let markup = viewProjects();
  assert.match(markup, /data-act="load-more-projects"/);
  assert.match(markup, /Backend potvrdil další aktivní projekty/);
  assert.equal((markup.match(/load-more-projects/g) || []).length, 1);

  state.loading.projects = true;
  markup = viewProjects();
  assert.match(markup, /data-act="load-more-projects" disabled/);
  assert.match(markup, /Načítám…/);
});

await test('MM3-E validates exact project pages and binds every row to the selected state', () => {
  assert.equal(validProjectPage(projectPage([project()]), 'active'), true);
  assert.equal(validProjectPage(projectPage([
    project(), project({ name: 'Duplicitní id' }),
  ]), 'active'), false);
  assert.equal(validProjectPage(projectPage([project({ path: 'C:/secret' })]), 'active'), false);
  assert.equal(validProjectPage(projectPage([project({ state: 'archived' })]), 'active'), false);
  assert.equal(validProjectPage(projectPage([project()], { state: 'archived' }), 'active'), false);
  assert.equal(validProjectPage(projectPage([], {
    hasMore: false, nextCursor: null, end: false,
  }), 'active'), false);
});

await test('MM3-E appends only with the active filter cursor and caches its page boundary', async () => {
  reset();
  const calls = [];
  const responses = [
    projectPage([project()], { hasMore: true, nextCursor: 'c1.active', end: false }),
    projectPage([project({ id: '16', name: 'Starší' })]),
  ];
  globalThis.fetch = async url => ({
    ok: true,
    status: 200,
    async json() { calls.push(url); return responses.shift(); },
  });

  await loadProjects('active');
  await loadProjects('active', { append: true });

  assert.deepEqual(calls, [
    '/m1/projects?state=active&limit=100',
    '/m1/projects?state=active&limit=100&cursor=c1.active',
  ]);
  assert.deepEqual(state.data.projects.map(item => item.id), ['17', '16']);
  assert.deepEqual(state.pagination.projects, { hasMore: false, nextCursor: null, end: true });
  const saved = store.get(K.cache + 'projects.active');
  assert.deepEqual(saved.data.items.map(item => item.id), ['17', '16']);
  assert.deepEqual(saved.data.page, { hasMore: false, nextCursor: null, end: true });
});

await test('MM3-E rejects overlapping project pages without changing the confirmed filter', async () => {
  reset();
  state.data.projects = [project()];
  state.pagination.projects = { hasMore: true, nextCursor: 'c1.active', end: false };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return projectPage([project()]); },
  });

  await loadProjects('active', { append: true });

  assert.deepEqual(state.data.projects.map(item => item.id), ['17']);
  assert.equal(state.error.projects.kind, 'protocol');
  assert.match(viewProjects(), /Zobrazený seznam se nezměnil/);
  assert.match(viewProjects(), /Načíst filtr od začátku/);
});

await test('MM3-E an archived response wins over a late active-filter response', async () => {
  reset();
  const releases = [];
  globalThis.fetch = () => new Promise(resolve => releases.push(payload => resolve({
    ok: true,
    status: 200,
    async json() { return payload; },
  })));

  const active = loadProjects('active');
  await Promise.resolve();
  const archived = loadProjects('archived');
  await Promise.resolve();
  releases[1](projectPage([
    project({ id: '30', name: 'Archiv', state: 'archived' }),
  ], { state: 'archived' }));
  await archived;
  releases[0](projectPage([project({ id: '20', name: 'Pozdní aktivní' })]));
  await active;

  assert.equal(state.projectState, 'archived');
  assert.deepEqual(state.data.projects.map(item => item.id), ['30']);
});

await test('MM3-E keeps active and archived cache snapshots separate', async () => {
  reset();
  store.set(K.cache + 'projects.active', { at: Date.now(), data: [project()] });
  store.set(K.cache + 'projects.archived', {
    at: Date.now(),
    data: [project({ id: '30', name: 'Archiv', state: 'archived' })],
  });
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });

  const pending = loadProjects('archived');
  assert.equal(state.projectState, 'archived');
  assert.deepEqual(state.data.projects.map(item => item.id), ['30']);
  assert.deepEqual(state.pagination.projects, { hasMore: false, nextCursor: null, end: false });
  assert.ok(!viewProjects().includes('load-more-projects'));

  release({
    ok: true,
    status: 200,
    async json() {
      return projectPage([project({ id: '30', name: 'Archiv', state: 'archived' })], {
        state: 'archived',
      });
    },
  });
  await pending;
  assert.ok(store.get(K.cache + 'projects.active'));
});

console.log(`\nMobile project UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
