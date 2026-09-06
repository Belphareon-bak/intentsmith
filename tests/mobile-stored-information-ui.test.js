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

await test('load publishes only the displayed window and caches that window', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, scopes: ['read:memory'], data: [record()] }; },
    };
  };
  await loadStoredInformation();
  assert.equal(calls[0].url, '/m1/memory?kind=all&limit=50');
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(state.data.memory[0].id, 'ltm:1');
  assert.equal(state.memoryLive, true);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.deepEqual(store.get(K.cache + 'memory').data, state.data.memory);
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
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          scopes: ['read:memory', 'write:memory'],
          data: [record({
            id: 'ltm:mem_default_project_repository-root',
            category: 'project', key: 'repository-root', value: 'C:\\work\\intentsmith',
          })],
        };
      },
    };
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
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          scopes: ['read:memory', 'write:memory'],
          data: [record({ category: 'project', key: 'repository-root', value: 'old value' })],
        };
      },
    };
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
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, scopes: [], data: [record()] }; },
  });
  await loadStoredInformation();
  assert.equal(state.data.memory, undefined);
  assert.equal(state.loading.memory, false);
  assert.equal(state.cacheAge.memory, null);
  assert.equal(state.memoryLive, false);
  assert.equal(store.get(K.cache + 'memory'), null);
});

console.log(`\nMobile stored-information UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
