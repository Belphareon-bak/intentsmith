'use strict';

const MODES = new Set(['ask', 'automatic', 'disabled']);
const STATES = Object.freeze({ pending: 'Čeká na potvrzení', running: 'Instaluje se', succeeded: 'Instalace dokončena',
  failed: 'Instalace selhala', cancelled: 'Instalace zrušena', interrupted: 'Přerušeno — výsledek není potvrzen' });

class DevelopmentClient {
  constructor({ backendUrl, fetchImpl = fetch, onChange = () => {} } = {}) {
    this.backendUrl = backendUrl || (() => window.electronIntentSmith.getBackendUrl());
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.environment = null; this.policy = null; this.projects = []; this.history = [];
    this.plan = null; this.error = ''; this.loading = false; this.busy = false;
    this.projectId = ''; this.kind = 'npm'; this.version = '';
    this.projectMode = 'ask'; this.sdkMode = 'ask';
    this.generation = 0; this.pollTimer = null;
  }
  changed() { this.onChange(); }
  async request(path, body, method) {
    const base = this.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === '/api/development/execute' ? 600000 : 10000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || data.code || `HTTP ${response.status}`);
    return data;
  }
  async refresh() {
    const generation = ++this.generation;
    this.loading = true; this.error = ''; this.changed();
    try {
      const [environment, policy, history, projects] = await Promise.all([
        this.request('/api/development/environment'), this.request('/api/development/policy'),
        this.request('/api/development/installations'), this.request('/api/projects?limit=50&status=active'),
      ]);
      if (generation !== this.generation) return;
      if (!policy.valid || !MODES.has(policy.projectMode) || !MODES.has(policy.sdkMode)) throw Error('Politika instalací není ověřená.');
      this.environment = environment; this.policy = policy;
      this.projectMode = policy.projectMode; this.sdkMode = policy.sdkMode;
      this.history = Array.isArray(history) ? history : [];
      this.projects = Array.isArray(projects.projects) ? projects.projects.filter(item => Number.isSafeInteger(item.id)) : [];
      if (!this.plan) this.plan = this.history.find(item => item.state === 'running') || null;
      if (this.plan?.state === 'running') this.schedulePoll();
    } catch (error) { if (generation === this.generation) this.error = error.message || 'Prostředí se nepodařilo načíst.'; }
    finally { if (generation === this.generation) { this.loading = false; this.changed(); } }
  }
  async action(run) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.changed();
    try { await run(); } catch (error) { this.error = error.message || 'Operace selhala.'; }
    finally { this.busy = false; this.changed(); }
  }
  async savePolicy() {
    return this.action(async () => {
      if (!this.policy?.valid || !MODES.has(this.projectMode) || !MODES.has(this.sdkMode)) throw Error('Politika není načtená.');
      this.policy = await this.request('/api/development/policy', {
        revision: this.policy.revision, projectMode: this.projectMode, sdkMode: this.sdkMode,
      }, 'PUT');
      this.projectMode = this.policy.projectMode; this.sdkMode = this.policy.sdkMode;
    });
  }
  async prepare() {
    return this.action(async () => {
      const projectId = Number(this.projectId);
      if (!this.projects.some(item => item.id === projectId)) throw Error('Vyber registrovaný projekt.');
      const plan = await this.request('/api/development/prepare', {
        kind: this.kind, projectId, ...(this.kind === 'dotnet' ? { version: this.version.trim() } : {}),
      });
      this.plan = plan; this.changed();
      if (plan.plan?.automatic && plan.plan?.autoEligible) await this.executePlan(plan, false);
    });
  }
  async executePlan(plan, approval) {
    if (plan.state !== 'pending' || !plan.id || !plan.digest) throw Error('Chybí přesný instalační plán.');
    const pending = this.request('/api/development/execute', { id: plan.id, digest: plan.digest, approval });
    this.plan = { ...plan, state: 'running' }; this.changed(); this.schedulePoll();
    try { this.plan = await pending; this.error = ''; }
    finally { this.changed(); if (this.plan?.state !== 'running') this.stopPoll(); }
  }
  async execute() { return this.action(() => this.executePlan(this.plan, true)); }
  async cancel() { return this.action(async () => {
    if (!this.plan?.id || !['pending', 'running'].includes(this.plan.state)) return;
    this.plan = await this.request('/api/development/cancel', { id: this.plan.id });
    this.changed();
  }); }
  async chooseHistory(id) { return this.action(async () => { this.plan = await this.request('/api/development/status?id=' + encodeURIComponent(id));
    if (this.plan.state === 'running') this.schedulePoll(); this.changed(); }); }
  schedulePoll() {
    this.stopPoll();
    if (this.plan?.state !== 'running') return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      const id = this.plan?.id;
      if (!id) return;
      try { this.plan = await this.request('/api/development/status?id=' + encodeURIComponent(id)); this.error = ''; }
      catch (error) { this.error = 'Průběh nelze načíst; dokončení není potvrzené. ' + error.message; }
      this.changed();
      if (this.plan?.state === 'running') this.schedulePoll();
    }, 1500);
  }
  stopPoll() { if (this.pollTimer) clearTimeout(this.pollTimer); this.pollTimer = null; }
  destroy() { ++this.generation; this.stopPoll(); }
  vm() {
    const e = this.environment, p = this.plan;
    return { loading: this.loading, hasError: !!this.error, error: this.error,
      os: e ? e.distribution || e.platform || 'nezjištěno' : 'Zatím nenačteno',
      arch: e?.architecture || '—', node: e?.runtime?.node || '—',
      tools: e?.tools ? Object.entries(e.tools).filter(([, value]) => !!value).map(([name]) => name).join(', ') || 'žádné nezjištěny' : 'Zatím nenačteno',
      observation: e?.observation || 'Přítomnost nástroje se ověřuje na backendu. Cílové prostředí projektu může být jiné.',
      projectMode: this.projectMode, sdkMode: this.sdkMode,
      modes: [{ value: 'ask', label: 'Vyžadovat potvrzení' }, { value: 'automatic', label: 'Automaticky v povoleném rozsahu' }, { value: 'disabled', label: 'Zakázáno' }],
      policyDisabled: this.busy || !this.policy?.valid,
      setProjectMode: event => { if (MODES.has(event.target.value)) { this.projectMode = event.target.value; this.changed(); } },
      setSdkMode: event => { if (MODES.has(event.target.value)) { this.sdkMode = event.target.value; this.changed(); } },
      savePolicy: () => this.savePolicy(),
      projects: this.projects.map(item => ({ id: String(item.id), name: item.name })), projectId: this.projectId,
      setProject: event => { this.projectId = event.target.value; this.plan = null; this.changed(); },
      kind: this.kind, setKind: event => { this.kind = event.target.value === 'dotnet' ? 'dotnet' : 'npm'; this.plan = null; this.changed(); },
      version: this.version, setVersion: event => { this.version = event.target.value; this.changed(); }, isDotnet: this.kind === 'dotnet',
      prepareDisabled: this.busy || !this.projects.some(item => String(item.id) === this.projectId), prepare: () => this.prepare(),
      hasPlan: !!p, planState: p ? STATES[p.state] || p.state : '',
      planTarget: p?.plan?.destination || '—', planCommand: p?.plan?.command || '—', planLimitations: p?.plan?.limitations || '',
      planSources: (p?.plan?.artifacts || [p?.plan?.metadataUrl, p?.plan?.archiveUrl].filter(Boolean).map(url => ({ url }))).map(item => ({ text: item.name ? `${item.name}@${item.version} — ${item.url}` : item.url })),
      planEvents: (p?.events || []).map(item => ({ text: `${item.kind} · ${new Date(item.occurredAt).toLocaleString('cs-CZ')}` })),
      canExecute: p?.state === 'pending' && !this.busy,
      canCancel: !!p && ['pending', 'running'].includes(p.state), execute: () => this.execute(), cancel: () => this.cancel(),
      history: this.history.map(item => ({ name: (this.projects.find(project => project.id === item.plan?.projectId)?.name || item.plan?.projectId || 'Projekt') + ' · ' + item.plan?.kind,
        state: STATES[item.state] || item.state, open: () => this.chooseHistory(item.id) })),
      refresh: () => this.refresh(),
    };
  }
}
module.exports = { DevelopmentClient, STATES };
