'use strict';

class ScmClient {
  constructor({ backendUrl, fetchImpl = fetch, onChange = () => {} } = {}) {
    this.backendUrl = backendUrl || (() => window.electronIntentSmith.getBackendUrl());
    this.fetchImpl = fetchImpl; this.onChange = onChange;
    this.entries = new Map(); this.requests = new Map();
  }
  changed() { this.onChange(); }
  entry(id) {
    const key = String(id);
    if (!this.entries.has(key)) this.entries.set(key, { status: 'idle', data: null, branches: null, log: null,
      policy: null, operations: [], diffs: new Map(), plan: null, error: '', busy: false, next: null });
    return this.entries.get(key);
  }
  async request(path, body, method) {
    const base = this.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === '/api/scm/execute' ? 90000 : 10000) });
    let value = {};
    try { value = await response.json(); } catch { /* HTTP status remains visible. */ }
    if (!response.ok) throw Error(value.error || value.code || `HTTP ${response.status}`);
    return value;
  }
  async load(projectId, { refresh = false } = {}) {
    const key = String(projectId), e = this.entry(key);
    if (!/^[1-9][0-9]*$/.test(key)) return;
    if (!refresh && (e.status === 'loading' || e.status === 'ready')) return;
    const token = (this.requests.get(key) || 0) + 1;
    this.requests.set(key, token); e.status = 'loading'; e.error = ''; this.changed();
    const q = '?projectId=' + encodeURIComponent(key);
    try {
      const [data, branches, log, policy, operations] = await Promise.all([
        this.request('/api/scm/status' + q), this.request('/api/scm/branches' + q),
        this.request('/api/scm/log' + q + '&limit=40'), this.request('/api/scm/policy' + q),
        this.request('/api/scm/operations' + q),
      ]);
      if (this.requests.get(key) !== token) return;
      if (String(data.projectId) !== key || String(policy.projectId) !== key || !Array.isArray(operations)
        || operations.some(item => String(item.plan?.projectId) !== key)) throw Error('Backend vrátil jiný projekt SCM.');
      e.data = data; e.branches = branches; e.log = log; e.policy = policy;
      e.operations = operations; e.diffs.clear(); e.status = 'ready'; e.error = '';
      if (e.plan && operations.some(item => item.planId === e.plan.planId && item.state !== 'pending')) {
        e.plan = null; e.next = null;
      }
    } catch (error) { if (this.requests.get(key) === token) { e.status = 'error'; e.error = error.message || 'Stav gitu nelze načíst.'; } }
    this.changed();
    return this.requests.get(key) === token && e.status === 'ready';
  }
  async diff(projectId, file, staged = false) {
    const e = this.entry(projectId);
    const key = `${staged ? 'staged' : 'unstaged'}|${file}`;
    try {
      const query = new URLSearchParams({ projectId: String(projectId), path: file, staged: String(staged) });
      const value = await this.request('/api/scm/diff?' + query);
      if (value.projectId !== Number(projectId) || value.path !== file || value.staged !== staged
        || typeof value.diff !== 'string') throw Error('Backend vrátil jiný diff.');
      e.diffs.set(key, value.diff); e.error = ''; this.changed();
      return true;
    } catch (error) { e.error = error.message || 'Diff nelze načíst.'; this.changed(); return false; }
  }
  async action(projectId, run) {
    const e = this.entry(projectId);
    if (e.busy) return false;
    e.busy = true; e.error = ''; this.changed();
    try { await run(e); return true; }
    catch (error) { e.error = error.message || 'Git operace selhala.'; return false; }
    finally { e.busy = false; this.changed(); }
  }
  async prepare(projectId, op, args = {}, next = null) {
    return this.action(projectId, async e => {
      const result = await this.request('/api/scm/prepare', { projectId: Number(projectId), op, args });
      if (String(result.plan?.projectId) !== String(projectId) || !result.planId || !result.digest) throw Error('Backend nevrátil přesný plán pro projekt.');
      e.plan = result; e.next = next;
    });
  }
  async execute(projectId) {
    return this.action(projectId, async e => {
      const plan = e.plan;
      if (!plan || plan.state !== 'pending' || String(plan.plan?.projectId) !== String(projectId)) throw Error('Chybí schválený plán projektu.');
      let result;
      try { result = await this.request('/api/scm/execute', { planId: plan.planId, digest: plan.digest, confirm: true }); }
      catch (error) {
        // A failed response can follow a successful Git effect. Never retry it.
        await this.load(projectId, { refresh: true });
        throw Error('Výsledek operace není potvrzen. Zkontroluj audit a stav projektu: ' + (error.message || 'spojení selhalo'));
      }
      if (result.planId !== plan.planId || result.state !== 'succeeded') throw Error('Backend nepotvrdil dokončení git operace.');
      const next = e.next; e.plan = null; e.next = null;
      if (!await this.load(projectId, { refresh: true })) throw Error('Git operace byla provedena, ale obnovení stavu selhalo. Zkontroluj audit před další akcí.');
      if (next) {
        const second = await this.request('/api/scm/prepare', { projectId: Number(projectId), op: next.op, args: next.args || {} });
        if (String(second.plan?.projectId) !== String(projectId) || !second.digest) throw Error('Backend nevrátil druhý plán.');
        e.plan = second;
      }
    });
  }
  async cancel(projectId) {
    return this.action(projectId, async e => {
      if (e.plan?.planId && e.plan.state === 'pending') await this.request('/api/scm/cancel', { planId: e.plan.planId });
      e.plan = null; e.next = null;
    });
  }
  async setPolicy(projectId, patch) {
    return this.action(projectId, async e => {
      if (!e.policy || String(e.policy.projectId) !== String(projectId)) throw Error('Nejdřív načti politiku projektu.');
      const policy = await this.request('/api/scm/policy', { ...e.policy, ...patch, projectId: Number(projectId), revision: e.policy.revision }, 'PUT');
      if (String(policy.projectId) !== String(projectId)) throw Error('Backend vrátil jinou politiku.');
      e.policy = policy; e.plan = null;
    });
  }
  destroy() { for (const key of this.entries.keys()) this.requests.set(key, (this.requests.get(key) || 0) + 1); }
}
module.exports = { ScmClient };
