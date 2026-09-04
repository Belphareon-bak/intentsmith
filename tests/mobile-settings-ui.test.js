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
  state, store, K, serverSettingsCard, publicSettingRows, loadSettings, unknownScopes,
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

console.log(`\nMobile settings UI: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
