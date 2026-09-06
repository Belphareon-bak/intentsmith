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
  state, store, journal, K, serverSettingsCard, publicSettingRows, loadSettings, unknownScopes,
  saveSetting, settingInputId, settingsMutationFresh, replaceScopes,
} = __ms20;

function reset(scopes = ['read:settings']) {
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
  state.settingsSaving = null;
  state.settingsNote = null;
  for (const key of Object.keys(nodes)) {
    if (!['app', 'toasts'].includes(key)) delete nodes[key];
  }
  nodes.app.innerHTML = '';
}

function settings(overrides = {}) {
  return {
    revision: 7,
    settings: {
      'c3.language': 'cs',
      appearance: { theme: 'dark', density: 'comfortable' },
    },
    version: 'v1:abc',
    ...overrides,
  };
}

console.log('\n=== Mobile settings UI ===');

await test('missing scope locks the card and hides remembered settings', () => {
  reset([]);
  state.data.settings = settings({ settings: { 'c3.language': 'must-not-render' } });
  const markup = serverSettingsCard();
  assert.match(markup, /read:settings/);
  assert.match(markup, /zamčeno/);
  assert.ok(!markup.includes('must-not-render'));
});

await test('loading and failed reads are not rendered as empty settings', () => {
  reset();
  state.loading.settings = true;
  assert.ok(!serverSettingsCard().includes('prázdné veřejné nastavení'));
  state.loading.settings = false;
  state.error.settings = { kind: 'offline' };
  const markup = serverSettingsCard();
  assert.match(markup, /Nejsi online/);
  assert.ok(!markup.includes('prázdné veřejné nastavení'));
});

await test('a confirmed empty public document has an explicit empty state', () => {
  reset();
  state.data.settings = settings({ settings: {} });
  assert.match(serverSettingsCard(), /Backend potvrdil prázdné veřejné nastavení/);
});

await test('public rows are stable, escaped and read-only', () => {
  reset();
  state.data.settings = settings({
    settings: {
      appearance: { theme: '<script>alert(1)</script>' },
      'c3.language': 'cs',
      'c3.output.codeBlocks': true,
    },
  });
  const rows = publicSettingRows(state.data.settings.settings);
  assert.deepEqual(rows.map(row => row.key), [
    '/appearance/theme', 'c3.language', 'c3.output.codeBlocks',
  ]);
  const markup = serverSettingsCard();
  assert.ok(!markup.includes('<script>'));
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /zapnuto/);
  assert.match(markup, /Revize/);
  assert.match(markup, /jen ke čtení/);
  assert.ok(!/data-act="(?:save|edit|write)-settings"/.test(markup));
});

await test('settings scope is recognized by this client version', () => {
  reset(['read:settings', 'read:future']);
  assert.deepEqual(unknownScopes(), ['read:future']);
});

await test('live load uses the scoped route and never writes a settings cache', async () => {
  reset();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return { ok: true, scopes: ['read:settings'], data: settings() }; },
    };
  };
  await loadSettings();
  assert.equal(calls[0].url, '/m1/settings');
  assert.equal(calls[0].options.headers.authorization, 'Bearer token');
  assert.equal(state.data.settings.revision, 7);
  assert.equal(store.get(K.cache + 'settings'), null);
});

await test('scope withdrawal clears the published settings surface', async () => {
  reset();
  state.data.settings = settings();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() { return { ok: true, scopes: [], data: settings() }; },
  });
  await loadSettings();
  assert.equal(state.data.settings, undefined);
  assert.equal(state.loading.settings, false);
});

await test('write controls require the separate scope and a live current revision', () => {
  reset(['read:settings', 'write:settings']);
  state.data.settings = settings();
  assert.equal(settingsMutationFresh(), true);
  let markup = serverSettingsCard();
  assert.match(markup, /revizní zápis/);
  assert.match(markup, /data-act="setting-save"/);
  assert.ok(!/data-act="setting-save"[^>]*disabled/.test(markup));

  state.conn = 'offline';
  assert.equal(settingsMutationFresh(), false);
  markup = serverSettingsCard();
  assert.match(markup, /data-act="setting-save"[^>]*disabled/);

  replaceScopes(['read:settings']);
  assert.ok(!serverSettingsCard().includes('data-act="setting-save"'));
});

await test('write scope exposes unset allow-listed fields without inventing defaults', () => {
  reset(['read:settings', 'write:settings']);
  state.data.settings = settings({ settings: {} });
  const markup = serverSettingsCard();
  assert.match(markup, /data-setting-path="\/appearance\/accentColor"/);
  assert.match(markup, /data-setting-path="\/c3\.output\.syntaxHighlight"/);
  assert.match(markup, /data-setting-path="\/output\/namingConvention"/);
  assert.match(markup, /nenastaveno/);
  assert.ok(!markup.includes('Backend potvrdil prázdné veřejné nastavení'));
});

await test('confirmed save sends one revision-bound operation and updates the live snapshot', async () => {
  reset(['read:settings', 'write:settings']);
  state.data.settings = settings();
  const input = element('select');
  input.value = 'light';
  nodes[settingInputId('/appearance/theme')] = input;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const sent = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          scopes: ['read:settings', 'write:settings'],
          data: {
            operationId: sent.operationId,
            state: 'CONFIRMED',
            result: { revision: 8, path: sent.path, value: sent.value },
          },
        };
      },
    };
  };

  await saveSetting('/appearance/theme');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/m1/settings');
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.cache, 'no-store');
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.expectedRevision, 7);
  assert.equal(sent.path, '/appearance/theme');
  assert.equal(sent.value, 'light');
  assert.equal(journal.find(sent.operationId).lastKnownState, 'CONFIRMED');
  assert.equal(journal.find(sent.operationId).displaySummary, 'Změna nastavení backendu');
  assert.equal(state.data.settings.revision, 8);
  assert.equal(state.data.settings.settings.appearance.theme, 'light');
  assert.equal(Object.hasOwn(state.data.settings, 'version'), false);
});

await test('revision conflict is rejected, then refreshed by a read without overwrite retry', async () => {
  reset(['read:settings', 'write:settings']);
  state.data.settings = settings();
  const input = element('select');
  input.value = 'light';
  nodes[settingInputId('/appearance/theme')] = input;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'PUT') {
      return {
        ok: false,
        status: 409,
        async json() {
          return {
            ok: false,
            error: {
              code: 'state_conflict', state: 'REJECTED', currentRevision: 8,
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
          scopes: ['read:settings', 'write:settings'],
          data: settings({ revision: 8, settings: { appearance: { theme: 'system' } } }),
        };
      },
    };
  };

  await saveSetting('/appearance/theme');
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
  assert.equal(calls[1].url, '/m1/settings');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(journal.all().at(-1).lastKnownState, 'REJECTED');
  assert.equal(state.data.settings.revision, 8);
  assert.equal(state.data.settings.settings.appearance.theme, 'system');
  assert.match(state.settingsNote.text, /mezitím změnil jiný klient/);
  assert.match(state.settingsNote.text, /Pokus: light; server: system/);
});

await test('unreadable success remains UNKNOWN and is never retried', async () => {
  reset(['read:settings', 'write:settings']);
  state.data.settings = settings();
  const input = element('select');
  input.value = 'light';
  nodes[settingInputId('/appearance/theme')] = input;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const sent = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          data: {
            operationId: sent.operationId,
            state: 'CONFIRMED',
            result: { revision: 8, path: '/output/defaultFormat', value: 'light' },
          },
        };
      },
    };
  };

  await saveSetting('/appearance/theme');
  assert.equal(calls, 1);
  assert.equal(journal.open().length, 1);
  assert.equal(journal.open()[0].lastKnownState, 'UNKNOWN');
  assert.match(state.settingsNote.text, /Nic se neopakuje/);
});

await test('unchanged value performs no network request and consumes no operation key', async () => {
  reset(['read:settings', 'write:settings']);
  state.data.settings = settings();
  const input = element('select');
  input.value = 'dark';
  nodes[settingInputId('/appearance/theme')] = input;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not dispatch'); };
  await saveSetting('/appearance/theme');
  assert.equal(calls, 0);
  assert.equal(journal.all().length, 0);
  assert.match(state.settingsNote.text, /nic neposlalo/);
});

console.log(`\nMobile settings UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
