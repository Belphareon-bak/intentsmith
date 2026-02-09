/**
 * C3 Backend — Sprint 6 Integration
 * All in plain Node.js (no dependencies).
 */
'use strict';
const path = require('path');
const fs = require('fs');

async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }); }
async function pathExists(p) { try { await fs.promises.access(p); return true; } catch { return false; } }
async function readJson(p) { return JSON.parse(await fs.promises.readFile(p, 'utf-8')); }
async function atomicWriteJson(fp, data) {
  const tmp = fp + '.tmp';
  await ensureDir(path.dirname(fp));
  const h = await fs.promises.open(tmp, 'w');
  try { await h.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf-8'); await h.sync(); }
  finally { await h.close(); }
  await fs.promises.rename(tmp, fp);
}
function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'projekt';
}

// ─── MultiProjectService ─────────────────────────────────

class MultiProjectService {
  async scanWorkspace(wp) {
    const pd = path.join(wp, 'projects');
    await ensureDir(pd); await ensureDir(path.join(wp, '.c3'));
    const projects = [];
    let entries = []; try { entries = await fs.promises.readdir(pd); } catch {}
    for (const e of entries) {
      const dir = path.join(pd, e);
      const stat = await fs.promises.stat(dir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const pj = path.join(dir, 'project.json');
      if (!await pathExists(pj)) continue;
      try {
        const d = await readJson(pj);
        projects.push({ slug: e, name: d.name || e, phase: d.phase || 'idle', currentSprint: d.currentSprint || 0, currentStep: d.currentStep || d.designTurn || 0, lastModified: stat.mtime.toISOString(), path: dir });
      } catch {}
    }
    projects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    let activeProjectSlug = null;
    const sp = path.join(wp, '.c3', 'settings.json');
    if (await pathExists(sp)) { try { activeProjectSlug = (await readJson(sp)).activeProject || null; } catch {} }
    return { rootPath: wp, projects, activeProjectSlug, settingsPath: sp };
  }

  async createProject(wp, name) {
    const slug = slugify(name);
    const dir = path.join(wp, 'projects', slug);
    if (await pathExists(dir)) throw new Error('Projekt existuje');
    for (const sub of ['', 'design', 'src', 'chat', '.c3']) await ensureDir(path.join(dir, sub));
    const data = { name, phase: 'design', currentSprint: 0, designTurn: 0, createdAt: new Date().toISOString(), pending_changes: [] };
    await atomicWriteJson(path.join(dir, 'project.json'), data);
    return { slug, name, phase: 'design', currentSprint: 0, currentStep: 0, lastModified: data.createdAt, path: dir };
  }

  async switchProject(wp, slug) {
    const sp = path.join(wp, '.c3', 'settings.json');
    let settings = {}; if (await pathExists(sp)) { try { settings = await readJson(sp); } catch {} }
    settings.activeProject = slug;
    await atomicWriteJson(sp, settings);
    if (!slug) return null;
    const ws = await this.scanWorkspace(wp);
    return ws.projects.find(p => p.slug === slug) || null;
  }

  async getActiveProject(wp) {
    const ws = await this.scanWorkspace(wp);
    if (!ws.activeProjectSlug) return null;
    return ws.projects.find(p => p.slug === ws.activeProjectSlug) || null;
  }

  async deleteProject(wp, slug) {
    const dir = path.join(wp, 'projects', slug);
    if (!await pathExists(dir)) throw new Error('Neexistuje');
    const trash = path.join(wp, '.c3', 'trash');
    await ensureDir(trash);
    await fs.promises.rename(dir, path.join(trash, slug + '-' + Date.now()));
    const sp = path.join(wp, '.c3', 'settings.json');
    if (await pathExists(sp)) {
      try { const s = await readJson(sp); if (s.activeProject === slug) { s.activeProject = null; await atomicWriteJson(sp, s); } } catch {}
    }
  }
}

// ─── ChatSearchService ───────────────────────────────────

class ChatSearchService {
  constructor() { this.entries = new Map(); this.tokenMap = new Map(); this.projectIndex = new Map(); }

  async indexMessage(entry) {
    this.entries.set(entry.id, entry);
    if (!this.projectIndex.has(entry.projectSlug)) this.projectIndex.set(entry.projectSlug, new Set());
    this.projectIndex.get(entry.projectSlug).add(entry.id);
    for (const t of this._tokenize(entry.content)) {
      if (!this.tokenMap.has(t)) this.tokenMap.set(t, new Set());
      this.tokenMap.get(t).add(entry.id);
    }
  }

  async indexBulk(entries) { let c = 0; for (const e of entries) { await this.indexMessage(e); c++; } return c; }

  async search(query) {
    const start = Date.now(); const limit = query.limit || 50;
    const qt = this._tokenize(query.text);
    if (qt.length === 0) return { results: [], total: 0, queryTimeMs: Date.now() - start };
    let cands = null;
    for (const q of qt) {
      const m = new Set();
      for (const [it, ids] of this.tokenMap) { if (it.startsWith(q) || q.startsWith(it)) for (const id of ids) m.add(id); }
      if (cands === null) cands = m; else cands = new Set([...cands].filter(id => m.has(id)));
      if (cands.size === 0) break;
    }
    if (!cands || cands.size === 0) return { results: [], total: 0, queryTimeMs: Date.now() - start };
    let filtered = [...cands].map(id => this.entries.get(id)).filter(Boolean);
    if (query.projectSlug) filtered = filtered.filter(e => e.projectSlug === query.projectSlug);
    if (query.role) filtered = filtered.filter(e => e.role === query.role);
    if (query.after) { const t = new Date(query.after).getTime(); filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= t); }
    if (query.before) { const t = new Date(query.before).getTime(); filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= t); }
    const scored = filtered.map(e => ({ entry: e, score: this._score(e, qt), snippets: this._snippets(e.content, qt) })).sort((a, b) => b.score - a.score);
    return { results: scored.slice(0, limit), total: scored.length, queryTimeMs: Date.now() - start };
  }

  async clearProject(slug) {
    const ids = this.projectIndex.get(slug); if (!ids) return;
    for (const id of ids) { const e = this.entries.get(id); if (e) for (const t of this._tokenize(e.content)) { const s = this.tokenMap.get(t); if (s) { s.delete(id); if (s.size === 0) this.tokenMap.delete(t); } } this.entries.delete(id); }
    this.projectIndex.delete(slug);
  }

  async getStats() { return { totalMessages: this.entries.size, projects: [...this.projectIndex.keys()] }; }

  _tokenize(text) { return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2); }

  _score(entry, qt) {
    const cl = entry.content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let score = 0;
    for (const t of qt) { let tf = 0, pos = cl.indexOf(t), first = -1; while (pos !== -1) { tf++; if (first === -1) first = pos; pos = cl.indexOf(t, pos + 1); } score += tf; if (first >= 0) score += Math.max(0, 1 - first / cl.length); }
    return score;
  }

  _snippets(content, qt) {
    const cl = content.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const snippets = [], seen = new Set();
    for (const t of qt) { const pos = cl.indexOf(t); if (pos === -1) continue; const bk = Math.floor(pos / 60); if (seen.has(bk)) continue; seen.add(bk); const s = Math.max(0, pos - 40), e = Math.min(content.length, pos + t.length + 40); let sn = ''; if (s > 0) sn += '...'; sn += content.slice(s, pos) + '\u00ab' + content.slice(pos, pos + t.length) + '\u00bb' + content.slice(pos + t.length, e); if (e < content.length) sn += '...'; snippets.push(sn); if (snippets.length >= 3) break; }
    return snippets;
  }
}

// ─── TokenDashboardService ───────────────────────────────

class TokenDashboardService {
  constructor() { this.records = []; }
  async recordUsage(r) { if (r.estimatedCostUsd === undefined) r.estimatedCostUsd = 0; this.records.push(r); }

  async getStats(projectSlug) {
    let f = this.records; if (projectSlug) f = f.filter(r => r.projectSlug === projectSlug);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - (now.getDay() * 86400000);
    const today = f.filter(r => new Date(r.timestamp).getTime() >= todayStart).reduce((s, r) => s + r.totalTokens, 0);
    const thisWeek = f.filter(r => new Date(r.timestamp).getTime() >= weekStart).reduce((s, r) => s + r.totalTokens, 0);
    const project = f.reduce((s, r) => s + r.totalTokens, 0);
    const allTime = this.records.reduce((s, r) => s + r.totalTokens, 0);

    const im = new Map();
    for (const r of f) { const k = r.intent || 'UNKNOWN'; const p = im.get(k) || { tokens: 0, count: 0 }; im.set(k, { tokens: p.tokens + r.totalTokens, count: p.count + 1 }); }
    const byIntent = [...im.entries()].map(([intent, d]) => ({ intent, tokens: d.tokens, percentage: project > 0 ? (d.tokens / project) * 100 : 0, count: d.count })).sort((a, b) => b.tokens - a.tokens);

    const mm = new Map();
    for (const r of f) mm.set(r.model, (mm.get(r.model) || 0) + r.totalTokens);
    const byModel = [...mm.entries()].map(([model, tokens]) => ({ model, tokens, percentage: project > 0 ? (tokens / project) * 100 : 0 })).sort((a, b) => b.tokens - a.tokens);

    const dm = new Map(); const thirtyAgo = todayStart - 30 * 86400000;
    for (const r of f) { const ts = new Date(r.timestamp).getTime(); if (ts < thirtyAgo) continue; const date = new Date(r.timestamp).toISOString().slice(0, 10); const p = dm.get(date) || { tokens: 0, turns: 0 }; dm.set(date, { tokens: p.tokens + r.totalTokens, turns: p.turns + 1 }); }
    const dailyUsage = [...dm.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date));
    const estimatedCostUsd = f.reduce((s, r) => s + (r.estimatedCostUsd || 0), 0);
    return { today, thisWeek, project, allTime, byIntent, byModel, dailyUsage, estimatedCostUsd };
  }

  async getRecords(ps, after, before) {
    let f = this.records; if (ps) f = f.filter(r => r.projectSlug === ps);
    if (after) { const t = new Date(after).getTime(); f = f.filter(r => new Date(r.timestamp).getTime() >= t); }
    if (before) { const t = new Date(before).getTime(); f = f.filter(r => new Date(r.timestamp).getTime() <= t); }
    return f;
  }

  async clearProject(slug) { this.records = this.records.filter(r => r.projectSlug !== slug); }
}

module.exports = { MultiProjectService, ChatSearchService, TokenDashboardService, slugify, ensureDir, pathExists, atomicWriteJson };
