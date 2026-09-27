import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CatalogStore, normalizeCatalog } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/catalog-store.js');

const payloads = {
  Konverzace: { conversations: [{ id: 'c1', title: 'Nápad', preview: 'První zpráva' }] },
  Projekty: { projects: [{ id: 1, name: 'Projekt', path: '/tmp/p' }, { id: 2, name: 'Bez cesty' }] },
  Specialisté: { specialists: [{ id: 's1', name: 'Účetní', status: 'enabled' }, { id: 's2', status: 'disabled' }] },
  Expertýzy: { experts: [{ id: 'e1', name: 'Výchozí' }] },
  Workeři: { agents: [{ id: 5, name: 'Denní', enabled: true }] },
  Obchod: { items: [{ id: 'p1', name: 'Balíček', type: 'skill' }] },
  Multimédia: { generations: [{ id: 'g1', prompt: 'Krajina' }] },
};
for (const [section, body] of Object.entries(payloads)) {
  assert.equal(normalizeCatalog(section, body).length, section === 'Specialisté' ? 2 : 1, section);
}
assert.equal(normalizeCatalog('Specialisté', payloads.Specialisté)[1].raw.status, 'disabled',
  'a disabled specialist stays visible so it can be enabled from its detail');
assert.equal(normalizeCatalog('Konverzace', {}).length, 0);
assert.equal(normalizeCatalog('Expertýzy', { expertises: [{ id: 'wrong-shape' }] }).length, 0,
  'the current backend emits experts, not expertises');
assert.deepEqual(normalizeCatalog('Obchod', { items: [
  { id: 'same', type: 'skill' }, { id: 'same', type: 'specialist' }] }).map(item => item.id),
['skill:same', 'specialist:same']);
console.log('PASS all seven catalog payloads normalize without ghost rows');

const requests = [];
const store = new CatalogStore({
  backendUrl: () => 'http://127.0.0.1:1234',
  fetchImpl: async (url, options) => {
    requests.push(url);
    assert.ok(options.signal);
    return { ok: true, json: async () => payloads.Projekty };
  },
});
await store.load('Projekty');
assert.equal(store.view('Projekty').status, 'ready');
assert.equal(store.view('Projekty').items[0].name, 'Projekt');
assert.equal(requests[0], 'http://127.0.0.1:1234/api/projects?limit=50&status=active');
console.log('PASS catalog fetch uses current backend origin and visible state');

const failing = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:1234', fetchImpl: async () => ({ ok: false, status: 503 }) });
await failing.load('Konverzace');
assert.equal(failing.view('Konverzace').status, 'error');
assert.match(failing.view('Konverzace').error, /503/);
console.log('PASS API error remains visible');
