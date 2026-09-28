'use strict';

const ROUTES = Object.freeze({
  Konverzace: '/api/conversations?limit=50&status=active',
  Projekty: '/api/projects?limit=50&status=active',
  Specialisté: '/api/specialists',
  Expertýzy: '/api/expertises',
  Workeři: '/api/agents?all=true',
  Obchod: '/api/marketplace/catalog?page=1&limit=50',
  Multimédia: '/api/media/history?page=1&limit=20',
});
const MEDIA_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|gen-[0-9]{13}-[0-9a-f]{8})$/i;
const EXPERTISE_CATEGORIES = new Set(['creative', 'analytical', 'normative', 'technical', 'domain', 'custom']);
function str(value, fallback = '') { return typeof value === 'string' ? value : fallback; }
function arrayFrom(section, data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const key = ({ Konverzace: 'conversations', Projekty: 'projects', Specialisté: 'specialists',
    Expertýzy: 'experts', Workeři: 'agents', Obchod: 'items', Multimédia: 'generations' })[section];
  return Array.isArray(data[key]) ? data[key] : [];
}
function normalize(section, raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  if (section === 'Projekty' && (!item.path || !item.name)) return null;
  if (section === 'Specialisté' && item.type === 'utility') return null;
  const backendId = item.id == null ? '' : String(item.id);
  if (!backendId) return null;
  const id = section === 'Obchod' ? `${item.type || 'unknown'}:${backendId}` : backendId;
  const name = str(item.name || item.title || item.label || item.prompt, section === 'Multimédia' ? `Generování ${id}` : id);
  const description = str(item.description || item.desc || item.preview || item.summary || item.domain);
  const group = str(item.type || item.domain || item.expertise || item.status || item.state, section);
  const state = str(item.state || item.status, '');
  return { id, name, description, group, state, raw: item };
}
function normalizeCatalog(section, data) {
  if (!Object.hasOwn(ROUTES, section)) throw new Error('Neznámá sekce katalogu.');
  const items = arrayFrom(section, data).map(item => normalize(section, item)).filter(Boolean);
  if (section !== 'Expertýzy') return items;
  // The backend owns expertise categories separately from each manifest's
  // domain. A domain such as CREATIVE_WRITING is not a catalog filter key.
  const byExpertise = new Map();
  for (const category of Array.isArray(data?.categories) ? data.categories : []) {
    if (!category || typeof category.id !== 'string' || !Array.isArray(category.experts)) continue;
    for (const id of category.experts) {
      if (typeof id === 'string' && !byExpertise.has(id)) byExpertise.set(id, category.id);
    }
  }
  return items.map(item => ({ ...item,
    group: EXPERTISE_CATEGORIES.has(byExpertise.get(item.id)) ? byExpertise.get(item.id) : 'uncategorized' }));
}

class CatalogStore {
  constructor({ backendUrl, fetchImpl = fetch } = {}) {
    this.backendUrl = backendUrl || (() => window.electronIntentSmith.getBackendUrl());
    this.fetchImpl = fetchImpl;
    this.views = new Map();
    this.listeners = new Set();
    this.requestIds = new Map();
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed() { for (const listener of this.listeners) listener(); }
  view(section) { return this.views.get(section) || { status: 'idle', items: [], error: null }; }
  async get(path, timeoutMs = 8000) {
    const base = this.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw new Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Načtení selhalo (HTTP ${response.status}).`);
    return response.json();
  }
  async mutate(path, method, body = null, timeoutMs = 30000) {
    const workerPath = method === 'POST'
      && /^\/api\/agent-extensions\/instances\/[A-Za-z0-9._-]+\/(run|enable|disable)$/.test(path);
    const workerRemovalPath = method === 'DELETE'
      && /^\/api\/agent-extensions\/[a-z0-9-]+\/instances\/[A-Za-z0-9._-]+$/.test(path);
    const mediaId = path.startsWith('/api/media/cancel?id=') ? path.slice('/api/media/cancel?id='.length)
      : path.startsWith('/api/media?id=') ? path.slice('/api/media?id='.length) : '';
    const mediaPath = (method === 'POST' && path.startsWith('/api/media/cancel?id=') && MEDIA_ID.test(mediaId))
      || (method === 'POST' && path === '/api/media/generate')
      || (method === 'PUT' && path === '/api/media/favorite')
      || (method === 'DELETE' && path.startsWith('/api/media?id=') && MEDIA_ID.test(mediaId));
    if (!['POST', 'PUT', 'DELETE'].includes(method) || typeof path !== 'string'
      || (!path.startsWith('/api/marketplace/') && !workerPath && !workerRemovalPath
        && !mediaPath)) {
      throw new Error('Nepovolená akce katalogu.');
    }
    const base = this.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw new Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { method, signal: AbortSignal.timeout(timeoutMs),
      ...(body == null ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    let result = {};
    try { result = await response.json(); } catch { /* HTTP status remains authoritative. */ }
    if (!response.ok || result.ok === false || (!workerPath && !workerRemovalPath && result.ok !== true))
      throw new Error(result.error || `Akce selhala (HTTP ${response.status}).`);
    return result;
  }
  async load(section) {
    const route = ROUTES[section];
    if (!route) throw new Error('Neznámá sekce katalogu.');
    const token = (this.requestIds.get(section) || 0) + 1;
    this.requestIds.set(section, token);
    this.views.set(section, { ...this.view(section), status: 'loading', error: null });
    this.changed();
    try {
      let data = await this.get(route);
      let warning = '';
      if (section === 'Konverzace') {
        const combined = await this.conversationIndex(data);
        data = combined.data; warning = combined.warning;
      }
      if (token !== this.requestIds.get(section)) return;
      this.views.set(section, { status: 'ready', items: normalizeCatalog(section, data), error: null, warning });
    } catch (error) {
      if (token !== this.requestIds.get(section)) return;
      this.views.set(section, { ...this.view(section), status: 'error', error: error.message || 'Načtení selhalo.' });
    }
    this.changed();
  }

  // Classic's global list excludes project conversations. Read the existing
  // project and specialist history connectors to build a unified UI index.
  // Specialist membership is descriptive; activation still uses its own API.
  async conversationIndex(data) {
    const rows = new Map(arrayFrom('Konverzace', data).filter(row => row?.id != null)
      .map(row => [String(row.id), { ...row }]));
    const warnings = [];
    const catalogs = await Promise.allSettled(['Projekty', 'Specialisté'].map(section =>
      this.view(section).status === 'ready' ? this.view(section).items :
        this.get(ROUTES[section]).then(body => normalizeCatalog(section, body))));
    const projects = catalogs[0].status === 'fulfilled' ? catalogs[0].value : [];
    const specialists = catalogs[1].status === 'fulfilled' ? catalogs[1].value : [];
    catalogs.forEach((result, index) => { if (result.status === 'rejected')
      warnings.push(index ? 'Nelze načíst vazby specialistů.' : 'Nelze načíst projektové konverzace.'); });
    const tasks = [
      ...projects.map(project => ({ project, route: '/api/projects/' + encodeURIComponent(project.id) + '/conversations?limit=50&status=active' })),
      ...specialists.map(specialist => ({ specialist, route: '/api/conversations?limit=100&specialistId=' + encodeURIComponent(specialist.id) })),
    ];
    // Bound concurrent reads; catalog expansion must not flood the live server.
    for (let offset = 0; offset < tasks.length; offset += 4) {
      const batch = tasks.slice(offset, offset + 4);
      const responses = await Promise.allSettled(batch.map(task => this.get(task.route)));
      responses.forEach((response, index) => {
        const task = batch[index];
        if (response.status === 'rejected') { warnings.push('Část historie se nepodařila načíst.'); return; }
        const history = Array.isArray(response.value) ? response.value : response.value?.conversations;
        if (!Array.isArray(history)) { warnings.push('Část historie má neplatnou odpověď.'); return; }
        for (const row of history) {
          if (row?.id == null || (row.state && row.state !== 'active')) continue;
          if (task.project && String(row.project_id) !== task.project.id) {
            warnings.push('Projektová historie vrátila jiný projekt.'); continue;
          }
          const id = String(row.id), previous = rows.get(id);
          const next = { ...previous, ...row };
          if (task.project) { next.project_id = task.project.id; next.project_name = task.project.name; }
          if (task.specialist) {
            next.specialist_id = previous?.specialist_id || task.specialist.id;
            next.specialist_name = previous?.specialist_name || task.specialist.name;
          }
          rows.set(id, next);
        }
      });
    }
    return { data: { conversations: [...rows.values()] }, warning: [...new Set(warnings)].join(' ') };
  }
}
module.exports = { CatalogStore, normalizeCatalog, ROUTES, MEDIA_ID };
