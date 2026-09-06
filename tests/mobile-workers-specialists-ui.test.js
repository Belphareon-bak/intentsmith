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
    remove() {},
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
  querySelector: () => null,
  createElement: tag => element(tag),
  addEventListener() {},
};
globalThis.window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
globalThis.location = { hash: '', pathname: '/', href: 'http://localhost/' };
globalThis.history = { replaceState() {} };
globalThis.fetch = async () => { throw new TypeError('network disabled'); };

const { __ms20 } = await import('../src/mobile/client/app.js');
const {
  state, store, K, cache, viewOverview, navItems, unknownScopes,
  viewWorkers, viewSpecialists, loadWorkers, loadSpecialists,
} = __ms20;

function reset(scopes = ['read:workers', 'read:specialists']) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.route = 'workers';
  state.conn = 'ok';
  state.data = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.pagination = {};
  nodes.app.innerHTML = '';
}

function worker(overrides = {}) {
  return {
    id: 'worker-1', name: 'Hlídač', description: 'Kontroluje ceny', icon: '🤖',
    kind: 'MONITOR', enabled: true,
    schedule: { intervalMs: 3600000, cronExpression: null, nextRunAt: '2026-09-06T12:00:00.000Z', lastRunAt: null },
    lastRun: { id: '4', status: 'success', startedAt: '2026-09-06T10:00:00.000Z', finishedAt: '2026-09-06T10:01:00.000Z', actionsExecuted: 2 },
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-06T10:01:00.000Z',
    version: 'v1:worker',
    ...overrides,
  };
}

function specialist(overrides = {}) {
  return {
    id: 'finance-cz', name: 'České finance', packageVersion: '2.1.0', domain: 'finance',
    type: 'domain', status: 'enabled', expertiseCount: 2,
    installedAt: '2026-09-01T10:00:00.000Z', enabledAt: '2026-09-02T10:00:00.000Z',
    disabledAt: null, updatedAt: '2026-09-02T10:00:00.000Z', version: 'v1:specialist',
    ...overrides,
  };
}

console.log('\n=== Mobile workers and specialists UI ===');

await test('scopes create real sections and remove the former coming-soon placeholders', () => {
  reset(['read:workers', 'read:specialists', 'read:future']);
  assert.ok(navItems().some(item => item.id === 'workers' && item.route === 'workers'));
  assert.ok(navItems().some(item => item.id === 'specialists' && item.route === 'specialists'));
  assert.deepEqual(unknownScopes(), ['read:future']);
  const overview = viewOverview();
  assert.match(overview, /data-route="workers"/);
  assert.match(overview, /data-route="specialists"/);
  assert.ok(!overview.includes('Připravujeme'));
});

await test('missing scopes lock both screens and hide remembered records', () => {
  reset([]);
  state.data.workers = [worker({ name: 'must-not-render-worker' })];
  state.data.specialists = [specialist({ name: 'must-not-render-specialist' })];
  assert.match(viewWorkers(), /read:workers/);
  assert.ok(!viewWorkers().includes('must-not-render-worker'));
  assert.match(viewSpecialists(), /read:specialists/);
  assert.ok(!viewSpecialists().includes('must-not-render-specialist'));
});

await test('loading, failure and confirmed empty remain distinct states', () => {
  reset();
  state.loading.workers = true;
  assert.ok(!viewWorkers().includes('Zatím žádní agenti'));
  state.loading.workers = false;
  state.error.workers = { kind: 'offline' };
  assert.match(viewWorkers(), /Nejsi online/);
  assert.ok(!viewWorkers().includes('Zatím žádní agenti'));
  state.error.workers = null;
  state.data.workers = [];
  assert.match(viewWorkers(), /Backend potvrdil prázdný seznam/);

  state.route = 'specialists';
  state.data.specialists = [];
  assert.match(viewSpecialists(), /Backend potvrdil prázdný seznam/);
});

await test('records are escaped, read-only and honest about absent live runtime', () => {
  reset();
  state.data.workers = [worker({ name: '<script>worker</script>', description: '<img src=x>' })];
  state.data.specialists = [specialist({ name: '<script>specialist</script>', domain: '<svg>' })];
  const workers = viewWorkers();
  const specialists = viewSpecialists();
  assert.ok(!workers.includes('<script>'));
  assert.ok(!workers.includes('<img'));
  assert.match(workers, /poslední běh uspěl/);
  assert.match(workers, /Živý stav se nezobrazuje/);
  assert.ok(!/data-act="(?:run|toggle|enable|disable|dry-run)-worker/.test(workers));
  assert.ok(!specialists.includes('<script>'));
  assert.ok(!specialists.includes('<svg>'));
  assert.match(specialists, /2 expertizy/);
  assert.match(specialists, /Registrace v právě běžícím procesu není/);
  assert.ok(!/data-act="(?:toggle|enable|disable)-specialist/.test(specialists));
});

await test('worker and specialist caches use their documented freshness windows', () => {
  reset();
  const realNow = Date.now;
  try {
    Date.now = () => 10 * 24 * 60 * 60_000;
    store.set(K.cache + 'workers', { at: Date.now() - 4 * 60_000, data: { items: [worker()], page: {} } });
    assert.equal(cache.read('workers').status, 'FRESH');
    store.set(K.cache + 'workers', { at: Date.now() - 6 * 60_000, data: { items: [worker()], page: {} } });
    assert.equal(cache.read('workers').status, 'STALE');
    store.set(K.cache + 'specialists', { at: Date.now() - 59 * 60_000, data: { items: [specialist()], page: {} } });
    assert.equal(cache.read('specialists').status, 'FRESH');
    store.set(K.cache + 'specialists', { at: Date.now() - 2 * 60 * 60_000, data: { items: [specialist()], page: {} } });
    assert.equal(cache.read('specialists').status, 'STALE');
    for (const name of ['workers', 'specialists']) {
      store.set(K.cache + name, { at: Date.now() - 8 * 24 * 60 * 60_000, data: { items: [], page: {} } });
      assert.equal(cache.read(name).status, 'EXPIRED');
    }
  } finally {
    Date.now = realNow;
  }
});

await test('loads cache the displayed window and append only with a server cursor', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const pageTwo = String(url).includes('cursor=next-worker');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          scopes: ['read:workers', 'read:specialists'],
          data: [worker({ id: pageTwo ? 'worker-2' : 'worker-1' })],
          hasMore: !pageTwo,
          nextCursor: pageTwo ? null : 'next-worker',
          end: pageTwo,
        };
      },
    };
  };
  await loadWorkers();
  assert.equal(calls[0].url, '/m1/workers?limit=50');
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(state.pagination.workers.nextCursor, 'next-worker');
  assert.match(viewWorkers(), /Načíst další/);
  await loadWorkers({ append: true });
  assert.equal(calls[1].url, '/m1/workers?limit=50&cursor=next-worker');
  assert.deepEqual(state.data.workers.map(item => item.id), ['worker-1', 'worker-2']);
  assert.deepEqual(store.get(K.cache + 'workers').data.items, state.data.workers);
});

await test('expired cache is deleted and server scope withdrawal clears both domains', async () => {
  reset();
  for (const name of ['workers', 'specialists']) {
    store.set(K.cache + name, {
      at: Date.now() - 8 * 24 * 60 * 60_000,
      data: { items: name === 'workers' ? [worker()] : [specialist()], page: {} },
    });
  }
  globalThis.fetch = async url => ({
    ok: true,
    status: 200,
    async json() {
      return {
        ok: true,
        scopes: String(url).includes('/workers') ? ['read:specialists'] : [],
        data: [], hasMore: false, nextCursor: null, end: true,
      };
    },
  });
  await loadWorkers();
  assert.equal(state.data.workers, undefined);
  assert.equal(store.get(K.cache + 'workers'), null);
  await loadSpecialists();
  assert.equal(state.data.specialists, undefined);
  assert.equal(store.get(K.cache + 'specialists'), null);
});

console.log(`\nMobile workers/specialists UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
