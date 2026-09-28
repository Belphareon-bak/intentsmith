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
assert.deepEqual(normalizeCatalog('Expertýzy', { experts: [
  { id: 'writer', name: 'Spisovatel', domain: 'CREATIVE_WRITING' },
  { id: 'analyst', name: 'Analytik', domain: 'DATA_ANALYSIS' },
  { id: 'mine', name: 'Vlastní', domain: 'custom', isCustom: true }],
  categories: [{ id: 'creative', experts: ['writer'] },
    { id: 'analytical', experts: ['analyst'] }, { id: 'custom', experts: ['mine'] }] }).map(item => item.group),
['creative', 'analytical', 'custom'], 'backend categories drive expertise filters, not raw domains');
assert.deepEqual(normalizeCatalog('Expertýzy', { experts: [
  { id: 'unknown', name: 'Bez skupiny', domain: 'NEW_DOMAIN' }], categories: [] }).map(item => item.group),
['uncategorized'], 'unmapped expertise remains filterable without exposing a raw domain as category');
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

const indexed = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:1234', fetchImpl: async url => {
  const body = url.includes('/api/projects?') ? { projects: [{ id: 7, name: 'Atlas', path: '/atlas' }] }
    : url.endsWith('/api/specialists') ? { specialists: [{ id: 'reviewer', name: 'Reviewer', type: 'domain' }] }
      : url.includes('/api/projects/7/conversations?') ? { conversations: [{ id: 'work', title: 'Project chat', project_id: 7, state: 'active' },
        { id: 'archived', title: 'Archived', state: 'archived' }] }
        : url.includes('specialistId=reviewer') ? { conversations: [{ id: 'work', title: 'Project chat', project_id: 7, state: 'active' }] }
          : { conversations: [{ id: 'plain', title: 'Plain chat', state: 'active' }] };
  return { ok: true, json: async () => body };
} });
await indexed.load('Konverzace');
assert.equal(indexed.view('Konverzace').warning, '');
assert.deepEqual(indexed.view('Konverzace').items.map(item => item.id), ['plain', 'work']);
const work = indexed.view('Konverzace').items[1].raw;
assert.equal(work.project_name, 'Atlas');
assert.equal(work.specialist_id, 'reviewer');
assert.equal(work.specialist_name, 'Reviewer');
console.log('PASS project and specialist history are merged through existing read connectors without duplicate conversations');

const incomplete = new CatalogStore({ backendUrl: () => 'http://127.0.0.1:1234', fetchImpl: async url => {
  const body = url.includes('/api/projects?') ? { projects: [{ id: 7, name: 'Atlas', path: '/atlas' }] }
    : url.endsWith('/api/specialists') ? { specialists: [] }
      : url.includes('/api/projects/7/conversations?') ? { conversations: [{ id: 'foreign', project_id: 8 }] }
        : { conversations: [{ id: 'plain', title: 'Safe chat', state: 'active' }] };
  return { ok: true, json: async () => body };
} });
await incomplete.load('Konverzace');
assert.equal(incomplete.view('Konverzace').status, 'ready');
assert.deepEqual(incomplete.view('Konverzace').items.map(item => item.id), ['plain']);
assert.match(incomplete.view('Konverzace').warning, /jiný projekt/);
console.log('PASS mismatched project history stays excluded and incomplete history is visibly reported');
