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
  return arrayFrom(section, data).map(item => normalize(section, item)).filter(Boolean);
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
      const data = await this.get(route);
      if (token !== this.requestIds.get(section)) return;
      this.views.set(section, { status: 'ready', items: normalizeCatalog(section, data), error: null });
    } catch (error) {
      if (token !== this.requestIds.get(section)) return;
      this.views.set(section, { ...this.view(section), status: 'error', error: error.message || 'Načtení selhalo.' });
    }
    this.changed();
  }
}
module.exports = { CatalogStore, normalizeCatalog, ROUTES, MEDIA_ID };
