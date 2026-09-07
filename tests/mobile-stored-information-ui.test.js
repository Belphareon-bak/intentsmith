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
  state, store, journal, K, cache, storedInformationCard, loadStoredInformation, unknownScopes,
  manualMemoryInput, memoryMutationFresh, memoryWriteOutcome, createManualMemory, replaceScopes,
  validStoredInformationRecord, validStoredInformationPage,
} = __ms20;

function reset(scopes = ['read:memory']) {
  localStorage.clear();
  store.set(K.token, 'token');
  store.set(K.device, 'device-1');
  store.set(K.scopes, scopes);
  state.session = 'active';
  state.route = 'diagnostics';
  state.conn = 'ok';
  state.data = {};
  state.pagination = {};
  state.loading = {};
  state.error = {};
  state.cacheAge = {};
  state.cacheAt = {};
  state.memoryLive = false;
  state.memorySaving = false;
  state.memoryNote = null;
  for (const key of Object.keys(nodes)) {
    if (!['app', 'toasts'].includes(key)) delete nodes[key];
  }
  nodes.app.innerHTML = '';
}

function record(overrides = {}) {
  return {
    id: 'ltm:1',
    kind: 'ltm',
    category: 'preference',
    key: 'language',
    value: 'cs',
    strength: 0.87,
    storedConfidence: 0.9,
    source: 'explicit',
    projectId: null,
    milestoneId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    lastUsedAt: '2026-09-04T10:00:00.000Z',
    accessCount: 3,
    version: 'v1:abc',
    ...overrides,
  };
}

function taskRecord(overrides = {}) {
  return record({
    id: 'task:2',
    kind: 'task',
    category: 'fix',
    key: 'sqlite-lock',
    value: 'serialize writes',
    source: 'execution_loop',
    projectId: '17',
    milestoneId: '4',
    ...overrides,
  });
}

function page(data, overrides = {}) {
  return {
    ok: true,
    scopes: ['read:memory'],
    kind: 'all',
    hasMore: false,
    nextCursor: null,
    end: true,
    data,
    ...overrides,
  };
}

function http(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

console.log('\n=== Mobile stored-information UI ===');

await test('missing scope locks the card and hides remembered records', () => {
  reset([]);
  state.data.memory = [record({ value: 'must-not-render' })];
  const markup = storedInformationCard();
  assert.match(markup, /read:memory/);
  assert.match(markup, /zamčeno/);
  assert.ok(!markup.includes('must-not-render'));
});

await test('loading and failed reads are never rendered as an empty memory', () => {
  reset();
  state.loading.memory = true;
  assert.ok(!storedInformationCard().includes('zatím není nic uloženo'));
  state.loading.memory = false;
  state.error.memory = { kind: 'offline' };
  const markup = storedInformationCard();
  assert.match(markup, /Nejsi online/);
  assert.ok(!markup.includes('zatím není nic uloženo'));
});

await test('a confirmed empty response has an explicit empty state', () => {
  reset();
  state.data.memory = [];
  state.pagination.memory = { hasMore: false, nextCursor: null, end: true };
  assert.match(storedInformationCard(), /Backend potvrdil, že zatím není nic uloženo/);
});

await test('records are escaped, labelled and expose no write or delete action', () => {
  reset();
  state.data.memory = [
    record({ key: '<script>key</script>', value: { note: '<img src=x>' } }),
    record({ id: 'task:2', kind: 'task', category: 'fix', key: 'lock', projectId: '17' }),
  ];
  const markup = storedInformationCard();
  assert.ok(!markup.includes('<script>'));
  assert.ok(!markup.includes('<img'));
  assert.match(markup, /&lt;script&gt;key&lt;\/script&gt;/);
  assert.match(markup, /dlouhodobá/);
  assert.match(markup, /úkolová/);
  assert.match(markup, /Síla 87%/);
  assert.match(markup, /Projekt 17/);
  assert.match(markup, /jen ke čtení/);
  assert.ok(!/data-act="(?:save|edit|write|delete)-memory"/.test(markup));
});

await test('memory scope is recognized by this client version', () => {
  reset(['read:memory', 'write:memory', 'read:future']);
  assert.deepEqual(unknownScopes(), ['read:future']);
});

await test('manual create requires both scopes and a successful live read', () => {
  reset(['read:memory', 'write:memory']);
  state.data.memory = [];
  let markup = storedInformationCard();
  assert.match(markup, /create-only zápis/);
  assert.match(markup, /data-act="memory-create"[^>]*disabled/);
  assert.equal(memoryMutationFresh(), false);

  state.memoryLive = true;
  assert.equal(memoryMutationFresh(), true);
  markup = storedInformationCard();
  assert.match(markup, /data-act="memory-create"/);
  assert.ok(!/data-act="memory-create"[^>]*disabled/.test(markup));

  state.conn = 'offline';
  assert.equal(memoryMutationFresh(), false);
  assert.match(storedInformationCard(), /data-act="memory-create"[^>]*disabled/);

  replaceScopes(['read:memory']);
  assert.ok(!storedInformationCard().includes('data-act="memory-create"'));
  assert.match(storedInformationCard(), /write:memory/);
});

await test('manual input validation is byte-bounded and never normalizes a key', () => {
  reset(['read:memory', 'write:memory']);
  nodes['memory-category'] = element('select');
  nodes['memory-key'] = element('input');
  nodes['memory-value'] = element('textarea');
  nodes['memory-category'].value = 'project';
  nodes['memory-key'].value = 'repository-root';
  nodes['memory-value'].value = 'C:\\work\\intentsmith';
  assert.equal(manualMemoryInput().ok, true);

  nodes['memory-key'].value = ' repository-root ';
  assert.equal(manualMemoryInput().ok, false);
  nodes['memory-key'].value = 'repository-root';
  nodes['memory-value'].value = 'ž'.repeat(4097);
  assert.equal(manualMemoryInput().ok, false);
  nodes['memory-category'].value = 'agent_internal';
  assert.equal(manualMemoryInput().ok, false);
});

await test('write result validator binds the content-free receipt to the attempted key', () => {
  const valid = {
    ok: true,
    data: {
      operationId: 'memory-op-1',
      state: 'CONFIRMED',
      result: {
        id: 'ltm:mem_default_project_repository-root',
        kind: 'ltm',
        category: 'project',
        key: 'repository-root',
      },
    },
  };
  assert.equal(memoryWriteOutcome(valid, 'memory-op-1', 'project', 'repository-root').valid, true);
  assert.equal(memoryWriteOutcome(valid, 'memory-op-1', 'project', 'other-key').valid, false);
  assert.equal(memoryWriteOutcome({
    ...valid,
    data: { ...valid.data, result: { ...valid.data.result, value: 'must not be accepted' } },
  }, 'memory-op-1', 'project', 'repository-root').valid, false);
});

await test('read validators accept only the exact LTM/task DTO and page boundary', () => {
  const ltm = record();
  const task = taskRecord();
  assert.equal(validStoredInformationRecord(ltm), true);
  assert.equal(validStoredInformationRecord(task), true);
  assert.equal(validStoredInformationPage(page([ltm, task])), true);
  assert.equal(validStoredInformationRecord({ ...ltm, extra: true }), false);
  assert.equal(validStoredInformationRecord({ ...ltm, projectId: 'must-not-exist' }), false);
  assert.equal(validStoredInformationRecord({ ...task, source: 'invented' }), false);
  assert.equal(validStoredInformationRecord({ ...ltm, strength: Infinity }), false);
  assert.equal(validStoredInformationPage(page([ltm, ltm])), false);
  assert.equal(validStoredInformationPage(page([ltm], {
    hasMore: true, nextCursor: null, end: false,
  })), false);
  assert.equal(validStoredInformationPage(page([ltm], { kind: 'ltm' })), false);
  assert.equal(validStoredInformationPage(page([ltm], { scopes: ['read:memory', 'read:memory'] })), false);
});

await test('memory cache uses one-hour fresh and seven-day hard limits', () => {
  reset();
  const realNow = Date.now;
  try {
    Date.now = () => 10 * 24 * 60 * 60_000;
    store.set(K.cache + 'memory', { at: Date.now() - 30 * 60_000, data: [record()] });
    assert.equal(cache.read('memory').status, 'FRESH');
    store.set(K.cache + 'memory', { at: Date.now() - 2 * 60 * 60_000, data: [record()] });
    assert.equal(cache.read('memory').status, 'STALE');
    store.set(K.cache + 'memory', { at: Date.now() - 8 * 24 * 60 * 60_000, data: [record()] });
    assert.equal(cache.read('memory').status, 'EXPIRED');
  } finally {
    Date.now = realNow;
  }
});

await test('legacy cache is validated but never presented as a complete list', async () => {
  reset();
  store.set(K.cache + 'memory', { at: Date.now(), data: [record()] });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await loadStoredInformation();
  assert.equal(state.data.memory[0].id, 'ltm:1');
  assert.deepEqual(state.pagination.memory, { hasMore: false, nextCursor: null, end: false });
  assert.match(storedInformationCard(), /Úplnost starší uložené kopie nelze potvrdit/);
  assert.equal(state.memoryLive, false);
});

await test('corrupt cache is deleted before an offline read can publish it', async () => {
  reset();
  store.set(K.cache + 'memory', {
    at: Date.now(),
    data: { items: [{ ...record(), extra: true }], page: { hasMore: false, nextCursor: null, end: true } },
  });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await loadStoredInformation();
  assert.equal(state.data.memory, undefined);
  assert.equal(store.get(K.cache + 'memory'), null);
  assert.equal(state.memoryLive, false);
});

await test('load publishes only the displayed window and caches that window', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return http(page([record()]));
  };
  await loadStoredInformation();
  assert.equal(calls[0].url, '/m1/memory?kind=all&limit=50');
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(state.data.memory[0].id, 'ltm:1');
  assert.equal(state.memoryLive, true);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.deepEqual(store.get(K.cache + 'memory').data, {
    items: state.data.memory,
    page: { hasMore: false, nextCursor: null, end: true },
  });
});

await test('opaque cursors append a validated page and persist the complete window', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? http(page([record()], { hasMore: true, nextCursor: 'c1.a+/=', end: false }))
      : http(page([taskRecord()]));
  };
  await loadStoredInformation();
  assert.match(storedInformationCard(), /data-act="load-more-memory"/);
  await loadStoredInformation({ append: true });
  assert.equal(calls[1].url, '/m1/memory?kind=all&limit=50&cursor=c1.a%2B%2F%3D');
  assert.deepEqual(state.data.memory.map(item => item.id), ['ltm:1', 'task:2']);
  assert.deepEqual(state.pagination.memory, { hasMore: false, nextCursor: null, end: true });
  assert.ok(!storedInformationCard().includes('data-act="load-more-memory"'));
  assert.deepEqual(store.get(K.cache + 'memory').data.items, state.data.memory);
  assert.equal(state.memoryLive, true);
});

await test('overlapping append is rejected without changing the confirmed window', async () => {
  reset(['read:memory', 'write:memory']);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? http(page([record()], { scopes: ['read:memory', 'write:memory'], hasMore: true, nextCursor: 'opaque', end: false }))
      : http(page([record()], { scopes: ['read:memory', 'write:memory'] }));
  };
  await loadStoredInformation();
  const cached = store.get(K.cache + 'memory');
  await loadStoredInformation({ append: true });
  assert.deepEqual(state.data.memory.map(item => item.id), ['ltm:1']);
  assert.deepEqual(store.get(K.cache + 'memory'), cached);
  assert.equal(state.error.memory.kind, 'protocol');
  assert.equal(state.memoryLive, false);
  assert.equal(memoryMutationFresh(), false);
  assert.match(storedInformationCard(), /neplatnou stránku/);
});

await test('strict HTTP and DTO failures preserve valid cache and relock create', async () => {
  reset(['read:memory', 'write:memory']);
  const snapshot = {
    items: [record()],
    page: { hasMore: false, nextCursor: null, end: true },
  };
  store.set(K.cache + 'memory', { at: Date.now(), data: snapshot });
  globalThis.fetch = async () => http(page([record({ extra: true })]), { status: 201 });
  await loadStoredInformation();
  assert.deepEqual(state.data.memory, snapshot.items);
  assert.deepEqual(store.get(K.cache + 'memory').data, snapshot);
  assert.equal(state.error.memory.kind, 'protocol');
  assert.equal(state.memoryLive, false);
  assert.equal(memoryMutationFresh(), false);
});

await test('a late older read cannot replace the newest generation', async () => {
  reset();
  const pending = [];
  globalThis.fetch = async () => new Promise(resolve => pending.push(resolve));
  const older = loadStoredInformation();
  const newest = loadStoredInformation();
  pending[1](http(page([record({ id: 'ltm:newest', key: 'newest' })])));
  await newest;
  pending[0](http(page([record({ id: 'ltm:older', key: 'older' })])));
  await older;
  assert.equal(state.data.memory[0].id, 'ltm:newest');
  assert.equal(store.get(K.cache + 'memory').data.items[0].id, 'ltm:newest');
});

await test('confirmed create sends once, stores no payload in the journal and refreshes by read', async () => {
  reset(['read:memory', 'write:memory']);
  state.data.memory = [];
  state.memoryLive = true;
  nodes['memory-category'] = element('select');
  nodes['memory-key'] = element('input');
  nodes['memory-value'] = element('textarea');
  nodes['memory-category'].value = 'project';
  nodes['memory-key'].value = 'repository-root';
  nodes['memory-value'].value = 'C:\\work\\intentsmith';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      const sent = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            scopes: ['read:memory', 'write:memory'],
            data: {
              operationId: sent.operationId,
              state: 'CONFIRMED',
              result: {
                id: 'ltm:mem_default_project_repository-root',
                kind: 'ltm', category: sent.category, key: sent.key,
              },
            },
          };
        },
      };
    }
    return http(page([record({
      id: 'ltm:mem_default_project_repository-root',
      category: 'project', key: 'repository-root', value: 'C:\\work\\intentsmith',
    })], { scopes: ['read:memory', 'write:memory'] }));
  };

  await createManualMemory();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/m1/memory');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[1].url, '/m1/memory?kind=all&limit=50');
  assert.equal(calls[1].options.method, 'GET');
  const sent = JSON.parse(calls[0].options.body);
  const entry = journal.find(sent.operationId);
  assert.equal(entry.lastKnownState, 'CONFIRMED');
  assert.equal(entry.operationType, 'memory.create');
  assert.equal(entry.displaySummary, 'Přidání informace do paměti');
  assert.ok(!JSON.stringify(entry).includes('repository-root'));
  assert.ok(!JSON.stringify(entry).includes('C:\\work\\intentsmith'));
  assert.equal(state.data.memory[0].key, 'repository-root');
  assert.match(state.memoryNote.text, /potvrzena serverem/);
});

await test('ambiguous create becomes UNKNOWN and is never retried or refreshed', async () => {
  reset(['read:memory', 'write:memory']);
  state.data.memory = [];
  state.memoryLive = true;
  nodes['memory-category'] = element('select');
  nodes['memory-key'] = element('input');
  nodes['memory-value'] = element('textarea');
  nodes['memory-category'].value = 'style';
  nodes['memory-key'].value = 'answer-tone';
  nodes['memory-value'].value = 'stručně';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError('connection lost');
  };

  await createManualMemory();
  assert.equal(calls, 1);
  assert.equal(journal.all().at(-1).lastKnownState, 'UNKNOWN');
  assert.equal(state.memoryLive, false);
  assert.match(state.memoryNote.text, /Není jisté/);
  assert.match(state.memoryNote.text, /Nic se neopakuje/);
});

await test('duplicate key is rejected, refreshed by read and never sent again', async () => {
  reset(['read:memory', 'write:memory']);
  state.data.memory = [record({ category: 'project', key: 'repository-root' })];
  state.memoryLive = true;
  nodes['memory-category'] = element('select');
  nodes['memory-key'] = element('input');
  nodes['memory-value'] = element('textarea');
  nodes['memory-category'].value = 'project';
  nodes['memory-key'].value = 'repository-root';
  nodes['memory-value'].value = 'new value';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      return {
        ok: false,
        status: 409,
        async json() {
          return {
            ok: false,
            error: { code: 'state_conflict', reason: 'memory_key_conflict', state: 'REJECTED' },
          };
        },
      };
    }
    return http(page([
      record({ category: 'project', key: 'repository-root', value: 'old value' }),
    ], { scopes: ['read:memory', 'write:memory'] }));
  };

  await createManualMemory();
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(journal.all().at(-1).lastKnownState, 'REJECTED');
  assert.equal(state.data.memory[0].value, 'old value');
  assert.match(state.memoryNote.text, /nepřepsal/);
});

await test('expired cache is deleted and scope withdrawal clears all memory state', async () => {
  reset();
  store.set(K.cache + 'memory', { at: Date.now() - 8 * 24 * 60 * 60_000, data: [record()] });
  globalThis.fetch = async () => http(page([record()], { scopes: [] }));
  await loadStoredInformation();
  assert.equal(state.data.memory, undefined);
  assert.equal(state.loading.memory, false);
  assert.equal(state.cacheAge.memory, null);
  assert.equal(state.memoryLive, false);
  assert.equal(store.get(K.cache + 'memory'), null);
});

console.log(`\nMobile stored-information UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
