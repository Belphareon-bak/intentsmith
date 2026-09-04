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
  state, store, K, viewProjects, viewProject, loadProjects,
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
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.serverOffsetMs = 0;
  nodes.app.innerHTML = '';
  body.children.length = 0;
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
        return { ok: true, scopes: ['read:projects'], data: [project()] };
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
      return { ok: true, scopes: [], data: [project()] };
    },
  });

  await loadProjects('active');

  assert.equal(state.data.projects, undefined);
  assert.equal(store.get(K.cache + 'projects.active'), null);
  assert.equal(store.get(K.cache + 'project.17'), null);
  assert.equal(store.get(K.cache + 'project.18'), null);
});

console.log(`\nMobile project UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
