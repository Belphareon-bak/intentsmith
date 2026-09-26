'use strict';

// The generated Component is the prototype's visual and interaction contract.
// This adapter supplies real state and effects without changing its template.
const { Component } = require('./generated/model');
const { lineCounts, renderMarkdown } = require('@intentsmith/chat-panel/lib/browser/work-activity');
const { pendingBinding } = require('../m2-controller');
const { DevelopmentClient } = require('../development-client');
const { ScmClient } = require('../scm-client');
const { StatusClient } = require('../status-client');
const { MEDIA_ID } = require('../catalog-store');
const { IntentSmithBus } = require('@intentsmith/chat-panel/lib/browser/event-bus');
const { COMMANDS: LEARNING_COMMANDS, runCommand: runLearningCommand } = require('../learning-commands');
const { SETTINGS_FIELDS, fieldsFor, validateValue } = require('../settings-preferences');
const { ModelWorkspace } = require('../model-workspace');
const { FeedbackWorkspace } = require('../feedback-workspace');
const { SecurityWorkspace } = require('../security-workspace');
const { ExpertiseSelectionClient } = require('../expertise-selection-client');

const CATALOG = Object.freeze({
  chats: 'Konverzace', projects: 'Projekty', specialists: 'Specialisté',
  expertises: 'Expertýzy', workers: 'Workeři', market: 'Obchod', media: 'Multimédia'
});
const LAYOUT_KEY = 'intentsmith-studio2-layout';
const PROJECTS_DIR_KEY = 'intentsmith-studio2-projects-dir';
const LAYOUT_FIELDS = Object.freeze(['mode', 'section', 'navOpen', 'navPin', 'navW', 'navExp',
  'rightOpen', 'rightPin', 'rightW', 'rightTab', 'bottomOpen', 'bottomH', 'btab',
  'detailW', 'view', 'size', 'colFr', 'treeClosed']);
const PAIRING_SCOPES = Object.freeze(['read:approvals', 'read:chat', 'read:events', 'read:notifications',
  'read:operations', 'read:projects', 'read:settings', 'read:stored_information',
  'write:approvals', 'write:chat', 'write:notifications', 'write:operations',
  'write:settings', 'write:stored_information']);

function clock(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function mediaOutputNames(raw) {
  let paths;
  try { paths = typeof raw?.outputs === 'string' ? JSON.parse(raw.outputs) : raw?.outputs; } catch { return []; }
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map(path => typeof path === 'string' ? path.split(/[\\/]/).pop() : '')
    .filter(name => name && !name.includes('..') && /^[A-Za-z0-9_][A-Za-z0-9_. -]*\.(?:png|jpe?g|gif|webp|mp4|webm)$/i.test(name)))].slice(0, 8);
}

function safeLayout(storage) {
  let raw;
  try { raw = JSON.parse(storage.getItem(LAYOUT_KEY) || '{}'); } catch { raw = {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of LAYOUT_FIELDS) if (Object.hasOwn(raw, key)) out[key] = raw[key];
  if (out.mode !== 'sessions' && out.mode !== 'section') delete out.mode;
  if (!Object.hasOwn(CATALOG, out.section) && out.section !== 'settings') delete out.section;
  for (const key of ['navW', 'rightW', 'bottomH', 'detailW']) {
    if (!Number.isFinite(out[key]) || out[key] < 50 || out[key] > 1500) delete out[key];
  }
  if (!Array.isArray(out.colFr) || out.colFr.length !== 3 || out.colFr.some(x => !Number.isFinite(x) || x < 0.2 || x > 5)) delete out.colFr;
  return out;
}

function savedProjectsDir(storage) {
  let value = '';
  try {
    const stored = storage.getItem(PROJECTS_DIR_KEY);
    value = stored === null ? JSON.parse(storage.getItem('intentsmith-settings') || '{}').projectsDir || '' : stored;
  } catch { return ''; }
  return typeof value === 'string' && value.length <= 1024 && (value === '' || value.startsWith('/'))
    && !/[\x00-\x1f]/.test(value) ? value : '';
}

class LiveModel extends Component {
  constructor(widget) {
    super();
    this.widget = widget;
    this.state = safeLayout(widget.store.storage);
    this._unlisten = [];
    this._treeRequested = new Set();
    this.development = new DevelopmentClient({ backendUrl: () => widget.catalog.backendUrl(),
      onChange: () => this.forceUpdate() });
    this._developmentRequested = false;
    this.scmClient = new ScmClient({ backendUrl: () => widget.catalog.backendUrl(),
      onChange: () => this.forceUpdate() });
    this.statusClient = new StatusClient({ backendUrl: () => widget.catalog.backendUrl(),
      onChange: () => this.forceUpdate() });
    this._policyDrafts = new Map();
    this._projectConversations = new Map();
    this._projectWizardStatus = { busy: false, error: '', defaultDir: '', uncertain: false };
    this._specialistWizardStatus = { busy: false, error: '', uncertain: false };
    this._workerWizardStatus = { busy: false, loading: false, error: '', uncertain: false,
      extensions: [], projects: [] };
    this._expertiseWizardStatus = { busy: false, error: '', uncertain: false,
      preview: null, previewKey: '', testResult: null, testKey: '' };
    this._workerDetails = new Map();
    this._specialistDetails = new Map();
    this._mediaNotices = new Map();
    this._mediaEnvironment = { status: 'idle', available: false, models: [], error: '' };
    this._mediaSubmitting = false;
    this._mediaSubmitNotice = '';
    this._mediaInputFile = null;
    this._mediaInputError = '';
    this._mediaOutputUrls = new Map();
    this._mediaBusListeners = [];
    this._audit = new Map();
    this._auditRequest = new Map();
    this._catalogBusy = new Set();
    this._settingsResources = new Map();
    this._settingsBusy = false;
    this._settingsNotice = '';
    this._maintenanceBusy = false;
    this._maintenanceNotice = '';
    this._settingsImport = { fileName: '', settings: null, status: 'Vyber soubor JSON s nastavením.', busy: false };
    this._projectsDir = savedProjectsDir(widget.store.storage);
    this._projectsDirNotice = '';
    this._preferenceDrafts = new Map();
    this._preferenceNotice = new Map();
    this._pairing = { status: 'idle', error: '', claim: null, selectedScopes: PAIRING_SCOPES.filter(scope => scope.startsWith('read:')) };
    this._pairingTimer = null;
    this._pairingAlive = true;
    this.fetchImpl = widget.fetchImpl || fetch;
    this.modelWorkspace = new ModelWorkspace({ backendUrl: () => widget.catalog.backendUrl(),
      fetchImpl: (...args) => this.fetchImpl(...args),
      confirmAction: message => (widget.confirmAction || globalThis.confirm)?.(message) === true,
      onChange: () => this.forceUpdate() });
    this.feedbackWorkspace = new FeedbackWorkspace({ backendUrl: () => widget.catalog.backendUrl(),
      fetchImpl: (...args) => this.fetchImpl(...args), onChange: () => this.forceUpdate(),
      version: () => this.statusClient.health?.version || null,
      lastResponse: () => this.widget.store.focusedSession()?.chat?.msgs?.slice().reverse()
        .find(message => message.role === 'assistant')?.text || '' });
    this.securityWorkspace = new SecurityWorkspace({ backendUrl: () => widget.catalog.backendUrl(),
      fetchImpl: (...args) => this.fetchImpl(...args),
      confirmAction: message => (widget.confirmAction || globalThis.confirm)?.(message) === true,
      onChange: () => this.forceUpdate() });
    this.expertiseSelection = new ExpertiseSelectionClient({ store: widget.store, catalog: widget.catalog,
      fetchImpl: (...args) => this.fetchImpl(...args),
      confirmAction: message => (widget.confirmAction || globalThis.confirm)?.(message) === true,
      onChange: () => this.forceUpdate() });
  }

  componentDidMount() {
    super.componentDidMount();
    for (const [name, kind] of [['comfyui:progress', 'progress'], ['comfyui:complete', 'complete'],
      ['comfyui:error', 'error']]) {
      const listener = event => this.onMediaEvent(kind, event);
      IntentSmithBus.on(name, listener);
      this._mediaBusListeners.push([name, listener]);
    }
    for (const [name, callback] of [
      ['upgrade:verify_failed', event => this.modelWorkspace.onVerifyFailure(event)],
      ['upgrade:verify_cleared', event => this.modelWorkspace.onVerifyCleared(event)],
      ['model:changed', () => { this.modelWorkspace.load('roles', true); this.modelWorkspace.load('overview', true); }],
      ['upgrade:error', event => { this.modelWorkspace.notice = 'Změna modelu selhala: ' + (event?.error || 'neznámá chyba'); this.forceUpdate(); }],
    ]) {
      IntentSmithBus.on(name, callback);
      this._mediaBusListeners.push([name, callback]);
    }
    for (const source of [this.widget.store, this.widget.catalog, this.widget.appearance]) {
      this._unlisten.push(source.subscribe(() => {
        if (source === this.widget.store) {
          this.syncTrees();
          const focused = this.widget.store.focusedSession();
          if (focused?._convId && this.expertiseSelection.entry(focused).status === 'idle')
            this.expertiseSelection.load(focused);
        }
        this.forceUpdate();
      }));
    }
    this.syncTrees();
    this.statusClient.start();
    if (this.state.mode === 'section' && CATALOG[this.state.section]) this.widget.catalog.load(CATALOG[this.state.section]);
    const focused = this.widget.store.focusedSession();
    if (focused?._convId) this.expertiseSelection.load(focused);
  }

  syncTrees() {
    for (const session of this.widget.store.state.sessions) {
      if (!session._projectId) continue;
      const key = session.id + '|' + session._projectId;
      if (this._treeRequested.has(key)) continue;
      this._treeRequested.add(key);
      this.widget.workspace.loadTree(session).catch(error => this.error(session, error));
      this.scmClient.load(session._projectId);
    }
  }

  componentWillUnmount() {
    this._pairingAlive = false;
    if (this._pairingTimer) clearTimeout(this._pairingTimer);
    this._pairing.claim = null;
    for (const [name, listener] of this._mediaBusListeners.splice(0)) IntentSmithBus.off(name, listener);
    for (const output of this._mediaOutputUrls.values()) if (output.url) URL.revokeObjectURL(output.url);
    this._mediaOutputUrls.clear();
    for (const unlisten of this._unlisten.splice(0)) unlisten();
    this.development.destroy();
    this.scmClient.destroy();
    this.statusClient.destroy();
    this.modelWorkspace.destroy();
    this.feedbackWorkspace.files = [];
    this.feedbackWorkspace.message = '';
    this.securityWorkspace.destroy();
    super.componentWillUnmount();
  }

  setState(patch) {
    super.setState(patch);
    if (patch && typeof patch === 'object') {
      const map = { style: 'style', tmode: 'theme', fs: 'fontSizeVal', ti: 'textIntensity',
        ai: 'activeInt', ta: 'tileOpacity', pa: 'sidebarOpacity', bd: 'bgDim', css: 'customCSS',
        bright: 'brightness', cacc: 'accentIdx', caccHex: 'accentHex', cbg: 'bgIdx', cbgHex: 'bgHex', col: 'autoCollapse' };
      for (const [local, remote] of Object.entries(map)) {
        if (Object.hasOwn(patch, local)) this.widget.appearance.set(remote, patch[local]);
      }
      if (Object.hasOwn(patch, 'sep')) this.widget.appearance.set('visualMode', patch.sep === 'linky' ? 'lines' : 'borders');
      if (Object.hasOwn(patch, 'density')) this.widget.appearance.set('density',
        ({ komfortni: 'comfortable', kompaktni: 'compact', minimalni: 'minimal' })[patch.density]);
      if (Object.hasOwn(patch, 'ff')) this.widget.appearance.set('fontIdx',
        ({ brand: 0, inter: 1, system: 2 })[patch.ff]);
      if (Object.hasOwn(patch, 'scale')) this.widget.appearance.set('uiScale',
        ({ '80': '0.8', '90': '0.9', '100': '1.0', '110': '1.1', '120': '1.2', '125': '1.25' })[String(patch.scale)]);
    }
    const layout = {};
    const state = this.state || {};
    for (const key of LAYOUT_FIELDS) if (Object.hasOwn(state, key)) layout[key] = state[key];
    try { this.widget.store.storage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* UI remains usable. */ }
  }

  st() {
    const s = super.st();
    const real = this.widget.store.state;
    const ap = this.widget.appearance.values;
    return Object.assign(s, {
      tabs: real.sessions.map(session => session.id), cols: real.columns.length,
      colSids: real.columns.slice(), focusCol: real.focusedColumn,
      sessions: {}, extra: {}, approved: {}, stopped: {}, modes: {},
      fileText: {}, fileDraft: {}, termX: {}, auditX: s.auditX || {}, scm: s.scm || {}, scmPlan: null,
      style: ap.style, tmode: ap.theme, fs: ap.fontSizeVal, ff: ['brand', 'inter', 'system'][ap.fontIdx],
      ti: ap.textIntensity, ai: ap.activeInt, ta: ap.tileOpacity, bright: ap.brightness,
      pa: ap.sidebarOpacity, bd: ap.bgDim, cacc: ap.accentIdx, caccHex: ap.accentHex,
      cbg: ap.bgIdx, cbgHex: ap.bgHex, col: ap.autoCollapse,
      sep: ap.visualMode === 'lines' ? 'linky' : 'ramecky',
      density: ({ comfortable: 'komfortni', compact: 'kompaktni', minimal: 'minimalni' })[ap.density] || 'komfortni',
      scale: String(Math.round(Number(ap.uiScale) * 100)), css: ap.customCSS
    });
  }

  // Strip all prototype content. Catalog rows are built from responses only.
  data() {
    if (!this._liveData) {
      const base = super.data();
      this._liveData = Object.assign({}, base, { S: {}, H: [], P: [], SP: [], EX: [], WK: [], MK: [],
        MODELS: [], FILES: {}, DIFFS: {}, GIT: {}, SET: base.SET });
    }
    return this._liveData;
  }

  m2View(session) {
    const binding = pendingBinding(session._m2Pending);
    const view = this.widget.m2.entry(session).view;
    return binding && view?.state === 'awaiting_approval'
      && view.lifecycleId === binding.lifecycleId && view.planDigest === binding.planDigest
      && Array.isArray(view.diff) ? view : null;
  }

  async loadAudit(session) {
    const conversationId = session?._convId;
    if (!conversationId) return;
    const key = String(conversationId);
    const cached = this._audit.get(key);
    if (this._auditRequest.has(key) || (cached?.status === 'ready' && Date.now() - cached.time < 30_000)) return;
    const request = Promise.resolve().then(async () => {
      this._audit.set(key, { status: 'loading', rows: cached?.rows || [], time: cached?.time || 0 });
      this.forceUpdate();
      try {
        const base = this.widget.catalog.backendUrl();
        if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
        const url = base + '/api/audit?limit=100&conversation_id=' + encodeURIComponent(key);
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw Error('Načtení auditu selhalo (HTTP ' + response.status + ').');
        const data = await response.json();
        if (!data || !Array.isArray(data.audit) || !Array.isArray(data.drift)) throw Error('Backend vrátil neplatný audit.');
        const rows = data.audit.map(item => ({ ts: item.created_at || '', kind: 'MERGE',
          detail: (item.expertise_name || '') + ' → ' + (item.verdict || item.result || '') }))
          .concat(data.drift.map(item => ({ ts: item.created_at || '', kind: 'DRIFT',
            detail: (item.capability || '') + ': ' + (item.drift_score ?? item.value ?? '') })))
          .sort((a, b) => b.ts.localeCompare(a.ts))
          .map(item => [clock(item.ts), item.kind, item.detail]);
        this._audit.set(key, { status: 'ready', rows, time: Date.now() });
      } catch (error) {
        this._audit.set(key, { status: 'error', rows: cached?.rows || [],
          error: error?.message || 'Načtení auditu selhalo.', time: Date.now() });
      } finally {
        this._auditRequest.delete(key);
        this.forceUpdate();
      }
    });
    this._auditRequest.set(key, request);
    return request;
  }

  m2Change(file) {
    const before = file.before?.content || '';
    const after = file.after?.content || '';
    const count = lineCounts(before, after);
    const lines = [{ k: 'hunk', o: '', n: '', t: '@@ Přesný obsah před a po změně @@' }]
      .concat(before.split('\n').map((text, index) => ({ k: 'del', o: String(index + 1), n: '', t: text })))
      .concat(after.split('\n').map((text, index) => ({ k: 'add', o: '', n: String(index + 1), t: text })));
    return { path: file.path, add: count.added, del: count.removed,
      isNew: file.before?.content === null, lines };
  }

  sess(sid) {
    const session = this.widget.store.find(sid);
    if (!session) return null;
    const chat = session.chat;
    const workspace = this.widget.workspace.entry(session);
    const steps = chat.msgs.flatMap(msg => msg._activity?.steps || []);
    let pendingActivity = null;
    const mapSteps = activity => (activity?.steps || []).map(step => [step.label || step.tool || 'Krok',
      step.durationMs == null ? (step.status === 'running' ? 'probíhá' : '') : (step.durationMs / 1000).toFixed(1) + ' s',
      step.status === 'running' ? 'run' : '']);
    const msgs = chat.msgs.map(msg => {
      if (msg.role === 'user') pendingActivity = msg._activity || null;
      const activity = msg.role === 'assistant' ? pendingActivity : msg.role === 'user' ? null : msg._activity;
      if (msg.role === 'assistant') pendingActivity = null;
      return { k: msg.role === 'user' ? 'user' : 'agent', time: clock(msg.ts),
        text: msg.role === 'user' ? msg.text : '',
        paras: msg.role === 'user' ? [] : [msg.text || ''], rawText: msg.text || '',
        liveMarkdown: msg.role === 'assistant',
        badge: msg.tag || (msg.role === 'system' ? 'SYSTÉM' : ''),
        expert: msg.role === 'assistant' ? chat.expertise : '',
        author: msg.role === 'system' ? 'Systém' : chat.specialist?.name || 'IntentSmith',
        steps: mapSteps(activity), atts: [], running: false };
    });
    if (chat._thinking) msgs.push({ k: 'agent', time: 'teď', badge: 'PRACUJE',
      expert: chat.expertise, paras: [], running: true,
      runText: chat._thinking.text || 'Zpracovává zadání…', rid: session.id + ':active',
      steps: mapSteps(pendingActivity) });
    const term = session.term.map(line => [typeof line === 'string' ? line : line.text || '',
      line?.type === 'error' || line?.type === 'uncertain' ? 'err' : '']);
    const log = session.log.map(line => [clock(line.ts), line.level || 'INFO', 'var(--info)',
      line.type || line.event || '', line.text || '']);
    const runs = steps.map(step => [clock(step.startedAt), step.label || '', step.tool || step.kind || '',
      step.input || '', step.durationMs == null ? '—' : (step.durationMs / 1000).toFixed(1) + ' s',
      step.status === 'running' ? 'RUN' : step.status === 'error' ? 'selhalo' : 'hotovo']);
    const tree = workspace.projectId === String(session._projectId)
      ? workspace.tree.map(node => [node.depth, node.name, node.directory ? 1 : 0]) : [];
    const m2 = this.m2View(session);
    const changes = m2 ? m2.diff.map(file => this.m2Change(file)) : [];
    const edited = (session._modifiedFiles || []).map(path => {
      const count = session._fileChanges?.[path] || {};
      return [path, count.added || count.add || 0, count.removed || count.del || 0, 'zapsáno'];
    });
    return {
      title: session._label, short: session._label, kind: session._projectId ? 'project' : chat.specialist ? 'specialist' : 'chat',
      project: session._projectId, specialist: chat.specialist?.id || null,
      state: session._m2Pending ? 'wait' : chat._thinking ? 'run' : 'idle',
      fresh: chat.msgs.length === 0, expert: chat.expertise || 'Výchozí', model: '',
      mode: chat.editMode === 'auto' ? 'auto' : 'kontrola', intent: '',
      ctx: Math.max(0, Math.min(100, Number(chat.ctx) || 0)), tokens: '',
      turns: chat.msgs.filter(msg => msg.role === 'user').length, parts: [],
      msgs, changes, edited, ctxFiles: (session._focusFiles || []).map(path => [path, '']),
      attach: [], memory: [], tree, term, log, runs, audit: [
        ...(this._audit.get(String(session._convId))?.rows || []),
        ...(this._audit.get(String(session._convId))?.status === 'error'
          ? [['', 'CHYBA AUDITU', this._audit.get(String(session._convId)).error]] : []),
        ...(session._projectId ? this.scmClient.entry(session._projectId).operations.flatMap(operation =>
          (operation.events || []).slice().reverse().map(event => [clock(event.occurredAt),
            'git ' + operation.plan.op, event.kind + (event.detail?.code ? ' · ' + event.detail.code : '')])) : [])
      ],
      problems: this.widget.m2.entry(session).error ? [['teď', 'M2', this.widget.m2.entry(session).error]] : [],
    };
  }

  proj(id) {
    const item = this.widget.catalog.view('Projekty').items.find(row => row.id === String(id));
    return item ? { id: item.id, name: item.name, path: item.raw.path || '',
      desc: item.description, status: item.state || 'active', convs: [], tree: [], recent: [], memory: [], last: '' } : null;
  }

  spec(id) {
    const item = this.widget.catalog.view('Specialisté').items.find(row => row.id === String(id));
    return item ? { id: item.id, name: item.name, desc: item.description, tools: item.raw.tools || [] } : null;
  }

  entities(sec, s) {
    const I = this.data().I;
    if (sec === 'settings') return super.entities(sec, s);
    const section = CATALOG[sec];
    if (!section) return [];
    const list = this.widget.catalog.view(section).items;
    const rows = list.map(item => ({ id: item.id, name: item.name,
      sub: sec === 'projects' ? item.raw.path || '' : item.group,
      desc: item.description, icon: ({ chats: I.chat, projects: I.folder,
        specialists: I.users, expertises: I.cap, workers: I.bot, market: I.bag, media: I.image })[sec],
      tone: ({ chats: 'amber', projects: 'rose', specialists: 'violet', expertises: 'cyan',
        workers: 'mint', market: 'blue', media: 'blue' })[sec],
      groups: [sec === 'chats' ? (item.raw.project_id ? 'project' : 'free') : item.state || item.group],
      group: item.group || section, catLabel: item.state || item.group,
      meta: '', tag: item.state || '', state: item.state || '' }));
    if (sec !== 'chats') return rows;
    const open = s.tabs.map((sid, index) => {
      const session = this.widget.store.find(sid);
      const b = this.sess(sid, s);
      const state = this.sstate(sid, s);
      return { id: sid, name: b.title, sub: session._projectId ? 'projekt ' + session._projectId : 'bez projektu',
        desc: b.msgs.find(msg => msg.k === 'user')?.text || 'Zatím bez zpráv.',
        icon: I.chat, tone: 'amber', dot: state, num: session.number || index + 1,
        groups: ['open', session._projectId ? 'project' : 'free'], group: 'Otevřené relace',
        catLabel: 'Relace ' + session.number, meta: this.stLabel(state), state: this.stLabel(state) };
    });
    return open.concat(rows.filter(row => !this.widget.store.state.sessions.some(session => session._convId === row.id)));
  }

  navVM(s, lay, fsid) {
    const I = this.data().I;
    return this.sections().filter(section => section.id !== 'settings').map(section => {
      const id = section.id;
      const items = id === 'chats' ? this.widget.store.state.sessions.map(session => ({
        id: session.id, name: session._label, meta: this.stLabel(this.sstate(session.id, s)),
        state: this.sstate(session.id, s), number: session.number,
        go: this.run(s2 => this.pFocusSession(s2, session.id)), ctx: this.showCtx('chats', session.id)
      })) : this.entities(id, s).slice(0, id === 'projects' ? 4 : 3).map(row => ({
        id: row.id, name: row.name, meta: row.meta || '', state: '', number: 0,
        go: this.run(s2 => this.pSelect(s2, id, row.id)), ctx: this.showCtx(id, row.id)
      }));
      const children = items.map(item => ({ isHead: false, isItem: true, t: item.name,
        m: item.meta, mc: 'var(--faint)', hasNum: id === 'chats', num: item.number,
        numCls: item.id === fsid && s.mode === 'sessions' ? 'focus' : lay.includes(item.id) ? 'vis' : '',
        hasDot: id === 'chats', dot: item.state, hasIcon: id !== 'chats',
        icon: section.icon, cls: item.id === fsid && s.mode === 'sessions' ? 'on' : '',
        go: item.go, ctx: item.ctx }));
      const count = id === 'chats' ? items.length : this.widget.catalog.view(CATALOG[id]).items.length;
      const open = children.length > 0 && !!s.navExp[id];
      return { label: section.label, short: section.short, icon: section.icon, tone: section.tone,
        cls: s.mode === 'section' && s.section === id ? 'on' : '',
        go: this.run(s2 => this.pGo(s2, id)), hasBadge: count > 0, badge: String(count),
        badgeCls: '', hasAlert: id === 'chats' && items.some(item => item.state === 'wait'),
        hasKids: children.length > 0, open, kids: children,
        toggle: () => this.setState({ navExp: this.merge(this.st(), 'navExp', { [id]: !this.st().navExp[id] }) }),
        expLabel: open ? 'Sbalit' : 'Rozbalit', chev: open ? I.down : I.right,
        hasMore: false, moreLabel: '' };
    });
  }

  catalogVM(s) {
    const vm = super.catalogVM(s);
    if (s.section !== 'settings') {
      const view = this.widget.catalog.view(CATALOG[s.section]);
      vm.summary = view.status === 'loading' ? 'Načítání z backendu…' : view.status === 'error'
        ? 'Načtení selhalo' : view.status === 'ready' ? view.items.length + ' položek z backendu' : 'Zatím nenačteno';
      if (vm.isEmpty) {
        vm.emptyTitle = view.status === 'loading' ? 'Načítání…' : view.status === 'error'
          ? 'Katalog se nepodařilo načíst' : 'Žádné položky';
        vm.emptyText = view.error || (view.status === 'ready' ? 'Backend nevrátil žádné položky.' : 'Otevři katalog pro načtení.');
      }
      vm.catalogError = this.widget.catalogActionError || view.error || '';
      vm.hasCatalogError = !!vm.catalogError;
      vm.hasPrimary = ['chats', 'projects', 'specialists', 'expertises', 'workers', 'media'].includes(s.section);
      vm.primary = s.section === 'media' ? 'Nové generování'
        : s.section === 'projects' ? 'Nový projekt'
          : s.section === 'specialists' ? 'Nový specialista'
            : s.section === 'expertises' ? 'Nová expertýza'
              : s.section === 'workers' ? 'Nový worker' : 'Nová konverzace';
      vm.onPrimary = this.run(s2 => s.section === 'media'
        ? this.pSelect(s2, 'media', '__new__') : s.section === 'projects'
          ? this.pSelect(s2, 'projects', '__new__') : s.section === 'specialists'
            ? this.pSelect(s2, 'specialists', '__new__') : s.section === 'expertises'
              ? this.pSelect(s2, 'expertises', '__new__') : s.section === 'workers'
                ? this.pSelect(s2, 'workers', '__new__') : this.pNewSession(s2, {}));
    }
    return vm;
  }

  detailVM(s) {
    const id = s.detail[s.section];
    if (!id) return null;
    if (s.section === 'media' && id === '__new__') return super.detailVM(s);
    if (s.section === 'projects' && id === '__new__') return super.detailVM(s);
    if (s.section === 'specialists' && id === '__new__') return super.detailVM(s);
    if (s.section === 'workers' && id === '__new__') return super.detailVM(s);
    if (s.section === 'expertises' && id === '__new__') return super.detailVM(s);
    if (s.section === 'expertises' && id === '__edit__') return super.detailVM(s);
    if (s.section === 'settings') return this.settingsDetailVM(s, id);
    if (s.section === 'projects') {
      const vm = super.detailVM(s);
      if (!vm) return null;
      vm.secondary = []; vm.hasRelated = false; vm.related = [];
      const conversations = this._projectConversations.get(String(id)) || { status: 'idle', items: [], error: '' };
      const tab = s.dtab['projects:' + id] || 'prehled';
      const count = conversations.status === 'ready' ? String(conversations.items.length) : '—';
      vm.props = vm.props.map(prop => prop.k === 'Konverzací' ? { ...prop, v: count } : prop);
      vm.tabs = vm.tabs.map(item => item.label === 'Konverzace'
        ? { ...item, n: conversations.status === 'ready' ? conversations.items.length : '',
          hasN: conversations.status === 'ready' && conversations.items.length > 0 } : item);
      if (tab === 'prehled' || tab === 'konverzace') {
        const rows = conversations.items.map(item => ({ t: item.name, s: 'uložená konverzace',
          icon: this.data().I.chat, go: () => this.pOpenProjectConversation(item) }));
        const text = conversations.status === 'error' ? conversations.error
          : conversations.status === 'ready' ? 'Projekt zatím nemá žádnou konverzaci.'
          : 'Načítám konverzace projektu…';
        vm.blocks = [this.blockVM({ kind: 'rows', title: 'Konverzace projektu', rows, empty: text })];
      }
      if (this.scmClient.entry(id).status !== 'ready' && tab === 'scm') {
        vm.blocks = [this.blockVM({ kind: 'empty', text: this.scmClient.entry(id).error || 'Načítám stav a politiku projektu…' })];
      }
      return vm;
    }
    const item = this.widget.catalog.view(CATALOG[s.section]).items.find(row => row.id === id);
    const entry = s.section === 'settings' ? this.data().SET.find(row => row.id === id) : item;
    if (!entry) return null;
    const I = this.data().I;
    if (s.section === 'specialists') {
      const detail = this._specialistDetails.get(id) || { status: 'idle' };
      const raw = item.raw || {};
      const enabled = raw.status === 'enabled';
      const busy = this._catalogBusy.has('specialist:' + id);
      const tab = s.dtab['specialists:' + id] || 'prehled';
      const tabs = [['prehled', 'Přehled'], ['nastroje', 'Nástroje'], ['nastaveni', 'Nastavení']];
      const tools = Array.isArray(detail.data?.tools) ? detail.data.tools :
        Array.isArray(raw.tools) ? raw.tools : [];
      const blocks = tab === 'nastroje' ? [this.blockVM({ kind: 'rows', title: 'Nástroje specialisty',
        rows: tools.map(tool => ({ t: typeof tool === 'string' ? tool : String(tool?.name || tool?.id || 'neznámý'),
          s: typeof tool === 'object' ? String(tool?.description || '') : '' })),
        empty: 'Specialista nemá zveřejněné nástroje.' })]
        : tab === 'nastaveni' ? [this.blockVM({ kind: 'rows', title: 'Konfigurace balíčku', rows: [
          { t: 'Verze', m: String(detail.data?.version || raw.version || '—') },
          { t: 'Stav', m: String(detail.data?.status || raw.status || '—') },
          { t: 'Registrace', m: detail.data?.isRegistered === true ? 'aktivní' : 'neaktivní' }] })]
          : [this.blockVM({ kind: 'text', items: [detail.status === 'error' ? detail.error
            : detail.status !== 'ready' ? 'Načítám manifest specialisty…'
              : String(detail.data.manifest?.description || item.description || '')] })];
      return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
        icls: '', title: item.name, type: 'Specialista', idText: id,
        hasStatus: true, status: busy ? 'probíhá' : raw.status || 'nezjištěno',
        stCls: enabled ? 'ok' : 'idle', hasPrimary: enabled && !busy,
        primaryLabel: 'Nová konverzace se specialistou',
        onPrimary: () => this.pNewSession(s, { specialist: id }),
        secondary: ['enabled','disabled'].includes(raw.status) && !busy
          ? [{ label: enabled ? 'Vypnout' : 'Zapnout', icon: enabled ? I.pause : I.play,
            go: () => this.specialistAction(id, enabled ? 'disable' : 'enable') },
          { label: 'Zkontrolovat aktualizaci', icon: I.refresh,
            go: () => this.specialistAction(id, 'update') },
          { label: 'Odinstalovat', icon: I.trash,
            go: () => this.specialistAction(id, 'uninstall') }] : [],
        more: this.showCtx('specialists', id), hasTabs: true,
        tabs: tabs.map(([key,label]) => ({ label, n: '', hasN: false, cls: key === tab ? 'on' : '',
          go: () => this.setState({ dtab: this.merge(this.st(), 'dtab', { ['specialists:' + id]: key }) }) })),
        hasDesc: tab === 'prehled' && !!item.description, desc: item.description,
        showProps: tab === 'prehled', props: [['ID', id, true], ['Doména', raw.domain || '—'],
          ['Verze', raw.version || '—']].map(([k,v,mono]) => ({ k, v, cls: mono ? 'mono' : '' })),
        blocks, hasRelated: false, related: [],
        development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
    }
    if (s.section === 'market') {
      const raw = item.raw || {}, installed = raw.installed === true;
      const busy = this._catalogBusy.has(raw.type + ':' + id);
      const actionable = ['skill', 'expertise', 'specialist'].includes(raw.type);
      return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
        icls: '', title: item.name, type: 'Balíček · ' + (raw.type || 'neznámý typ'),
        idText: String(raw.id), hasStatus: true,
        status: busy ? 'probíhá' : installed ? 'nainstalováno' : 'k instalaci',
        stCls: busy ? 'warn' : installed ? 'ok' : 'idle',
        hasPrimary: actionable && !busy, primaryLabel: installed ? 'Odinstalovat' : 'Nainstalovat',
        onPrimary: () => this.pMarketplaceAction(item, installed ? 'uninstall' : 'install'),
        secondary: actionable && raw.updateAvailable && !busy ? [{ label: 'Aktualizovat', icon: I.zap,
          go: () => this.pMarketplaceAction(item, 'update') }] : [],
        more: () => {}, hasTabs: false, tabs: [], hasDesc: !!item.description,
        desc: item.description, showProps: true,
        props: [['ID', raw.id, true], ['Typ', raw.type || '—'], ['Verze', raw.version || '—'],
          ['Instalovaná verze', raw.installedVersion || '—']].map(([k, v, mono]) => ({ k, v, cls: mono ? 'mono' : '' })),
        blocks: [this.blockVM({ kind: 'empty', text: busy ? 'Čekám na výsledek operace…'
          : actionable ? 'Instalace, aktualizace a odebrání používají skutečný katalog backendu.'
            : 'Backend vrátil nepodporovaný typ balíčku.' })],
        hasRelated: false, related: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
    }
    if (s.section === 'workers') {
      const detail = this._workerDetails.get(id) || { status: 'idle' };
      const worker = detail.data, extension = !!worker?.definition?.m3_extension;
      const enabled = worker?.enabled === true || worker?.enabled === 1;
      const busy = this._catalogBusy.has('worker:' + id);
      const runs = Array.isArray(worker?.recentRuns) ? worker.recentRuns : [];
      return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
        icls: '', title: item.name, type: 'Worker', idText: item.id, hasStatus: true,
        status: busy ? 'probíhá' : detail.status !== 'ready' ? 'nezjištěno' : enabled ? 'zapnutý' : 'pozastavený',
        stCls: busy ? 'warn' : enabled ? 'ok' : 'idle',
        hasPrimary: extension && enabled && !busy, primaryLabel: 'Spustit teď',
        onPrimary: () => this.pWorkerAction(item, 'run'),
        secondary: extension && !busy ? [{ label: enabled ? 'Pozastavit' : 'Obnovit',
          icon: enabled ? I.pause : I.play, go: () => this.pWorkerAction(item, enabled ? 'disable' : 'enable') }] : [],
        more: () => {}, hasTabs: false, tabs: [], hasDesc: !!item.description,
        desc: item.description, showProps: !!worker,
        props: worker ? [['ID', item.id, true], ['Zdroj', extension ? worker.definition.m3_extension.id : 'legacy'],
          ['Plán', worker.definition?.schedule?.type || '—'], ['Poslední běh', runs[0]?.started_at || '—']]
          .map(([k, v, mono]) => ({ k, v: String(v), cls: mono ? 'mono' : '' })) : [],
        blocks: [this.blockVM({ kind: 'empty', text: busy ? 'Čekám na výsledek operace…'
          : detail.status === 'loading' || detail.status === 'idle' ? 'Načítám definici workeru…'
            : detail.status === 'error' ? detail.error
              : extension ? runs.length ? `Běhů v historii: ${runs.length}.` : 'Zatím žádný běh.'
                : 'Tento legacy worker má vypnuté operace. Použij rozšíření agentů M3.' })],
        hasRelated: false, related: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
    }
    if (s.section === 'media') {
      const raw = item.raw || {}, active = raw.status === 'pending' || raw.status === 'running';
      const busy = this._catalogBusy.has('media:' + id), favorite = raw.favorite === true || raw.favorite === 1;
      const outputs = mediaOutputNames(raw).map(name => {
        const cached = this._mediaOutputUrls.get(id + '|' + name) || { status: 'idle' };
        const isImage = /\.(?:png|jpe?g|gif|webp)$/i.test(name);
        return { name, ready: cached.status === 'ready', url: cached.url || '', isImage, isVideo: !isImage,
          hasStatus: cached.status !== 'ready', status: cached.status === 'error' ? cached.error
            : cached.status === 'loading' ? 'Načítám náhled…' : 'Náhled ještě není načtený.' };
      });
      return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
        icls: '', title: item.name, type: 'Médium · ' + (raw.type || 'generování'), idText: id,
        hasStatus: true, status: busy ? 'probíhá' : raw.status || 'nezjištěno',
        stCls: active ? 'warn' : raw.status === 'completed' ? 'ok' : 'idle',
        hasPrimary: active && !busy, primaryLabel: 'Zrušit generování',
        onPrimary: () => this.pMediaAction(item, 'cancel'),
        secondary: busy ? [] : [
          { label: favorite ? 'Odebrat z oblíbených' : 'Přidat do oblíbených', icon: I.star,
            go: () => this.pMediaAction(item, 'favorite') },
          ...(!active ? [{ label: 'Smazat', icon: I.trash, go: () => this.pMediaAction(item, 'delete') }] : [])],
        more: () => {}, hasTabs: false, tabs: [], hasDesc: !!raw.prompt, desc: raw.prompt || '',
        showProps: true, props: [['ID', id, true], ['Typ', raw.type || '—'],
          ['Vytvořeno', raw.created_at || '—'], ['Stav', raw.status || '—']]
          .map(([k, v, mono]) => ({ k, v, cls: mono ? 'mono' : '' })),
        blocks: [this.blockVM({ kind: 'empty', text: busy ? 'Čekám na výsledek operace…'
          : this._mediaNotices.get(id) || raw.error || 'Historie a stav se načítají z backendu.' }),
        ...(outputs.length ? [this.blockVM({ kind: 'mediaOutputs', outputs })] : [])],
        hasRelated: false, related: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
    }
    if (s.section === 'expertises') {
      const raw = item.raw || {};
      const editable = raw.isCustom === true;
      return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
        icls: '', title: item.name, type: editable ? 'Vlastní expertýza' : 'Vestavěná expertýza',
        idText: id, hasStatus: false, status: '', stCls: '', hasPrimary: true,
        primaryLabel: 'Použít samostatně v relaci', onPrimary: () => this.useExpertise(item, 'single'),
        secondary: [{ label: 'Přidat ke kombinaci', icon: this.data().I.cap,
          go: () => this.useExpertise(item, 'add') },
        ...(editable ? [{ label: 'Upravit', icon: this.data().I.pen,
          go: () => this.openExpertiseEdit(item) }] : [])],
        more: () => {}, hasTabs: false, tabs: [], hasDesc: !!item.description,
        desc: item.description, showProps: true,
        props: [['ID', id, true], ['Doména', raw.domain || '—'], ['Teplota', String(raw.temperature ?? '—')]]
          .map(([k, v, mono]) => ({ k, v, cls: mono ? 'mono' : '' })),
        blocks: [this.blockVM({ kind: 'expertiseSelection' }), this.blockVM({ kind: 'text', items: [editable
          ? 'Úprava načte aktuální konfiguraci z backendu a před uložením ověří její revizi.'
          : 'Vestavěnou expertýzu můžeš použít v aktivní relaci.'] })],
        hasRelated: false, related: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
    }
    return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
      icls: '', title: entry.name, type: this.sec(s.section).label,
      idText: item ? item.id : '', hasStatus: false, status: '', stCls: '',
      hasPrimary: s.section === 'chats' || s.section === 'specialists',
      primaryLabel: s.section === 'chats' ? 'Otevřít jako relaci'
        : s.section === 'specialists' ? 'Nová konverzace se specialistou' : '',
      onPrimary: s.section === 'chats' ? this.run(state => this.pOpenSession(state, id))
        : s.section === 'specialists' ? this.run(state => this.pNewSession(state, { specialist: id })) : () => {},
      secondary: [],
      more: this.showCtx(s.section, id), hasTabs: false, tabs: [], hasDesc: !!entry.description || !!entry.desc,
      desc: entry.description || entry.desc || '', showProps: !!item,
      props: item ? [['ID', item.id, true], ['Stav', item.state || '—']] .map(row => ({ k: row[0], v: row[1], cls: row[2] ? 'mono' : '' })) : [],
      blocks: [this.blockVM({ kind: 'empty', text: 'Další akce této obrazovky zatím nejsou připojené.' })],
      hasRelated: false, related: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
  }

  settingsDetailVM(s, id) {
    const vm = super.detailVM(s);
    if (!vm) return null;
    if (id === 'vzhled') return vm;
    const tab = (s.dtab || {})['settings:' + id] || (id === 'system' ? 'prostredi' : 'prehled');
    if (id === 'system' && tab === 'prostredi') return vm;
    const resourceKey = id === 'modely' && fieldsFor(id, tab).length ? 'modely:prefs'
      : id === 'uloziste' ? 'uloziste:system' : id;
    const resource = this._settingsResources.get(resourceKey);
    const state = resource?.status || 'idle';
    const preferenceFields = fieldsFor(id, tab);
    const connectedTab = preferenceFields.length > 0 || id === 'zabezpeceni'
      || (id === 'ucet' && tab === 'projekty') ||
      (id === 'prepinace' && (tab === 'prehled' || tab === 'obnoveni')) ||
      ((id === 'modely' || id === 'uloziste') && tab === 'prehled')
      || (id === 'uloziste' && tab === 'udrzba') || id === 'zalohy'
      || id === 'about';
    const unavailable = 'Tato část nastavení zatím nemá připojené ovládání.';
    vm.hasDesc = false; vm.desc = ''; vm.showProps = false; vm.props = [];
    vm.hasPrimary = false; vm.primaryLabel = ''; vm.secondary = [];
    vm.hasRelated = false; vm.related = [];
    vm.status = !connectedTab ? 'nepřipojeno' : id === 'about' ? 'lokální aplikace'
      : id === 'zabezpeceni' ? 'lokální párování'
      : state === 'loading' ? 'načítání' : state === 'error' ? 'chyba' : state === 'ready' ? 'živá data' : 'nenačteno';
    vm.stCls = connectedTab && state === 'error' ? 'warn' : connectedTab && state === 'ready' ? 'ok' : 'idle';
    vm.hasStatus = true;
    if (connectedTab && id !== 'zabezpeceni' && state !== 'loading') vm.secondary = [{ label: 'Obnovit', icon: this.data().I.refresh,
      go: () => this.loadSettingsResource(resourceKey, true) }];
    if (preferenceFields.length) {
      const draft = this._preferenceDrafts.get(id) || {};
      vm.blocks = [this.blockVM({ kind: 'preferences' })];
      vm.hasPrimary = state === 'ready' && !this._settingsBusy && Object.keys(draft).length > 0;
      vm.primaryLabel = 'Uložit změny';
      vm.onPrimary = () => this.savePreferences(id);
      const notice = this._preferenceNotice.get(id);
      if (notice) vm.blocks.unshift(this.blockVM({ kind: 'text', items: [notice] }));
    } else if (id === 'zabezpeceni') {
      vm.blocks = [...(tab === 'pristup' ? [this.blockVM({ kind: 'pairing' })] : []),
        this.blockVM({ kind: 'security' })];
    } else if (id === 'ucet' && tab === 'projekty') {
      vm.blocks = [this.blockVM({ kind: 'projectDirectory' })];
    } else if (id === 'prepinace' && tab === 'prehled') {
      const features = resource?.data?.features;
      const rows = state === 'ready' && features ? Object.entries(features).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, enabled]) => ({ t: name, s: 'Klikni pro změnu po potvrzení. Změna platí do restartu backendu.',
          m: enabled ? 'zapnuto' : 'vypnuto', icon: this.data().I.toggle,
          go: () => { this.toggleFeature(name, !enabled); return null; } })) : [];
      vm.blocks = state === 'ready' ? [this.blockVM({ kind: 'rows', title: 'Běhové přepínače', rows })]
        : [this.blockVM({ kind: 'empty', text: state === 'error' ? resource.error : 'Načítám běhové přepínače…' })];
    } else if (id === 'prepinace' && tab === 'obnoveni') {
      vm.blocks = [this.blockVM({ kind: 'text', items: ['Obnovení vrátí běhové přepínače na výchozí hodnoty backendu.'] })];
      vm.hasPrimary = state === 'ready' && !this._settingsBusy;
      vm.primaryLabel = 'Obnovit přepínače';
      vm.onPrimary = () => this.resetFeatures();
    } else if (id === 'modely' && tab === 'prehled') {
      vm.blocks = [this.blockVM({ kind: 'modelWorkspace' })];
      vm.props = state === 'ready' ? [{ k: 'Model CHAT', v: resource.data.current_model || '—', cls: 'mono' },
        { k: 'Adresa Ollamy', v: resource.data.ollama_url || '—', cls: 'mono' }] : [];
      vm.showProps = vm.props.length > 0;
    } else if (id === 'uloziste' && tab === 'prehled') {
      const storage = resource?.data;
      vm.blocks = state === 'ready' ? [this.blockVM({ kind: 'rows', title: 'Databáze a historie', rows: [
        { t: 'Databáze', m: storage.db_size_mb + ' MiB' },
        { t: 'Zprávy v DB', m: String(storage.messages_in_db) },
        { t: 'Historie', m: storage.history.total_mb + ' MiB' },
        { t: 'Zálohy', m: String(storage.backups?.count ?? '—') }] })]
        : [this.blockVM({ kind: 'empty', text: state === 'error' ? resource.error : 'Načítám stav úložiště…' })];
    } else if (id === 'uloziste' && tab === 'udrzba') {
      vm.blocks = [this.blockVM({ kind: 'text', items: [
        'Optimalizace SQLite odstraní fragmentaci. Během operace mohou ostatní požadavky čekat.',
        this._maintenanceNotice || 'Operace začne až po výslovném potvrzení.'] })];
      vm.hasPrimary = state === 'ready' && !this._maintenanceBusy;
      vm.primaryLabel = 'Optimalizovat databázi';
      vm.onPrimary = () => this.performMaintenance('vacuum');
    } else if (id === 'zalohy') {
      const backups = resource?.data?.backups || [];
      vm.blocks = [this.blockVM({ kind: 'text', items: [this._maintenanceNotice ||
        (tab === 'obnova' ? 'Obnova databáze probíhá mimo běžící aplikaci. Nejprve ji zastav, pak použij ověřený příkaz restore-state-backup.js.'
          : tab === 'vychozi' ? 'Obnovení výchozích hodnot smaže uživatelská nastavení a vypne modelovou automatizaci.'
            : 'Zálohy jsou uloženy v datovém adresáři backendu.')] }),
      ...(state === 'ready' && tab !== 'vychozi' ? [this.blockVM({ kind: 'rows', title: 'Dostupné zálohy',
        rows: backups.slice(0, 30).map(item => ({ t: item.name, s: item.created_at || '',
          m: item.restorable ? item.total_size_mb + ' MiB' : 'nelze obnovit' })) })] : [])];
      if (tab === 'prehled') {
        vm.hasPrimary = state === 'ready' && !this._maintenanceBusy;
        vm.primaryLabel = 'Vytvořit zálohu stavu';
        vm.onPrimary = () => this.performMaintenance('backup');
        vm.secondary.push({ label: 'Exportovat nastavení JSON', icon: this.data().I.download,
          go: () => this.exportSettings() });
      } else if (tab === 'obnova') {
        vm.blocks.unshift(this.blockVM({ kind: 'settingsImport' }));
      } else if (tab === 'vychozi') {
        vm.hasPrimary = state === 'ready' && !this._maintenanceBusy;
        vm.primaryLabel = 'Obnovit výchozí nastavení';
        vm.onPrimary = () => this.performMaintenance('reset');
      }
    } else if (id === 'about' && tab === 'zpetna_vazba') {
      vm.blocks = [this.blockVM({ kind: 'feedback' })];
    } else if (id === 'about' && tab === 'prehled') {
      const health = this.statusClient.health;
      vm.blocks = [this.blockVM({ kind: 'rows', title: 'Aplikace', rows: [
        { t: 'Backend', m: health?.version ? String(health.version) : 'nepotvrzený' },
        { t: 'Stav', m: health?.ready === true ? 'připravený' : 'neověřený' },
        { t: 'Rozhraní', m: 'Studio 2' }] })];
    } else {
      vm.blocks = [this.blockVM({ kind: 'empty', text: unavailable })];
    }
    if (this._settingsNotice && id === 'prepinace') vm.blocks.unshift(this.blockVM({ kind: 'text', items: [this._settingsNotice] }));
    return vm;
  }

  async loadSettingsResource(id, refresh = false) {
    const paths = { prepinace: '/api/features', modely: '/api/system/models',
      'uloziste:system': '/api/system/storage', zalohy: '/api/system/backups' };
    const preferenceCategory = id === 'modely:prefs' ? 'modely' : id;
    const path = SETTINGS_FIELDS[preferenceCategory] && id !== 'modely' ? '/api/settings' : paths[id];
    if (!path || !refresh && this._settingsResources.get(id)?.status === 'ready') return;
    const request = Symbol(id);
    this._settingsResources.set(id, { status: 'loading', request });
    this.forceUpdate();
    try {
      const data = await this.widget.catalog.get(path);
      if (id === 'prepinace' && (!data?.features || typeof data.features !== 'object' || Array.isArray(data.features)
        || Object.values(data.features).some(value => typeof value !== 'boolean'))) throw Error('Backend vrátil neplatné přepínače.');
      if (id === 'modely' && (!Array.isArray(data?.models) || data.models.some(model => typeof model.name !== 'string'))) throw Error('Backend vrátil neplatný seznam modelů.');
      if (id === 'uloziste:system' && (!Number.isFinite(data?.db_size_mb) || !Number.isSafeInteger(data?.messages_in_db)
        || !Number.isFinite(data?.history?.total_mb))) throw Error('Backend vrátil neplatný stav úložiště.');
      if (id === 'zalohy' && !Array.isArray(data?.backups)) throw Error('Backend vrátil neplatný seznam záloh.');
      if (SETTINGS_FIELDS[preferenceCategory] && id !== 'modely'
        && (!data || typeof data !== 'object' || Array.isArray(data))) throw Error('Backend vrátil neplatné uživatelské nastavení.');
      if (this._settingsResources.get(id)?.request === request) this._settingsResources.set(id, { status: 'ready', data });
    } catch (error) {
      if (this._settingsResources.get(id)?.request === request) this._settingsResources.set(id, {
        status: 'error', error: error?.message || 'Načtení nastavení selhalo.' });
    } finally { this.forceUpdate(); }
  }

  async performMaintenance(operation) {
    const paths = { vacuum: '/api/system/vacuum', backup: '/api/system/backup', reset: '/api/reset' };
    if (!paths[operation] || this._maintenanceBusy) return false;
    const confirmation = { vacuum: 'Optimalizovat databázi? Během operace mohou ostatní požadavky čekat.',
      backup: 'Vytvořit novou zálohu stavu backendu?',
      reset: 'Smazat všechna uživatelská nastavení a vypnout modelovou automatizaci? Tuto akci nelze vrátit.' };
    if (!(this.widget.confirmAction || globalThis.confirm)?.(confirmation[operation])) return false;
    this._maintenanceBusy = true; this._maintenanceNotice = 'Čekám na potvrzení backendu…'; this.forceUpdate();
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + paths[operation], { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30_000) });
      let result = {};
      try { result = await response.json(); } catch { /* Response may be lost after the effect. */ }
      if (!response.ok || (operation === 'reset' ? result.success !== true : result.ok !== true))
        throw Error(result.error || `Operace nebyla potvrzena (HTTP ${response.status}).`);
      if (operation === 'backup') {
        if (typeof result.name !== 'string' || !result.name) throw Error('Záloha mohla vzniknout, ale backend nevrátil její jméno.');
        await this.loadSettingsResource('zalohy', true);
        if (this._settingsResources.get('zalohy')?.status !== 'ready'
          || !this._settingsResources.get('zalohy').data.backups.some(item => item.name === result.name))
          throw Error('Záloha mohla vzniknout, ale není ověřená v seznamu. Obnov stav před opakováním.');
        this._maintenanceNotice = 'Záloha ' + result.name + ' je ověřená v backendu.';
      } else if (operation === 'reset') {
        const settings = await this.widget.catalog.get('/api/settings');
        const policy = await this.widget.catalog.get('/api/system/models/policy');
        if (Object.keys(settings || {}).length || !policy.valid || policy.policy.autoFailoverEnabled
          || policy.policy.autoCleanupEnabled) throw Error('Reset mohl proběhnout, ale výsledek nelze ověřit. Obnov stav.');
        this._preferenceDrafts.clear();
        this._settingsResources.clear();
        await this.loadSettingsResource('zalohy', true);
        this._maintenanceNotice = 'Uživatelská nastavení jsou prázdná a modelová automatizace vypnutá.';
      } else {
        await this.loadSettingsResource('uloziste:system', true);
        if (this._settingsResources.get('uloziste:system')?.status !== 'ready')
          throw Error('Optimalizace mohla proběhnout, ale stav úložiště nelze ověřit.');
        this._maintenanceNotice = 'Databáze byla optimalizována; nový stav byl načten.';
      }
      return true;
    } catch (error) {
      this._maintenanceNotice = error?.message || 'Výsledek operace není jistý. Obnov stav před opakováním.';
      return false;
    } finally { this._maintenanceBusy = false; this.forceUpdate(); }
  }

  settingsImportVM() {
    return { fileName: this._settingsImport.fileName, status: this._settingsImport.status,
      busy: this._settingsImport.busy, disabled: !this._settingsImport.settings || this._settingsImport.busy,
      choose: event => this.prepareSettingsImport(event), submit: () => this.importSettings() };
  }

  async prepareSettingsImport(event) {
    const file = event?.target?.files?.[0];
    this._settingsImport = { fileName: file?.name || '', settings: null,
      status: 'Kontroluji soubor…', busy: true }; this.forceUpdate();
    try {
      if (!file || file.size > 1024 * 1024) throw Error('Vyber JSON soubor do 1 MiB.');
      const raw = await file.text();
      const settings = JSON.parse(raw);
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)
        || Object.keys(settings).length > 5000
        || Object.keys(settings).some(key => key.length > 256)) throw Error('Soubor neobsahuje platný dokument nastavení.');
      if (settings.models && typeof settings.models === 'object'
        && ['autoFailoverEnabled', 'autoCleanupEnabled', 'autoCleanupDays']
          .some(key => Object.hasOwn(settings.models, key)))
        throw Error('Modelová automatizace se importuje samostatně. Odeber její klíče ze souboru.');
      this._settingsImport = { fileName: file.name, settings,
        status: `Připraveno ${Object.keys(settings).length} položek. Import nahradí uživatelská nastavení po potvrzení.`,
        busy: false };
      return true;
    } catch (error) {
      this._settingsImport = { fileName: file?.name || '', settings: null,
        status: error?.message || 'Soubor nelze přečíst.', busy: false };
      return false;
    } finally { this.forceUpdate(); }
  }

  async importSettings() {
    const settings = this._settingsImport.settings;
    if (!settings || this._settingsImport.busy) return false;
    const confirmAction = this.widget.confirmAction || globalThis.confirm;
    if (typeof confirmAction !== 'function' || !confirmAction(`Importovat nastavení z ${this._settingsImport.fileName}? Aktuální uživatelské volby budou nahrazeny.`))
      return false;
    this._settingsImport.busy = true;
    this._settingsImport.status = 'Čekám na potvrzení backendu…'; this.forceUpdate();
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + '/api/settings/import', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, settings }),
        signal: AbortSignal.timeout(30_000) });
      let result = {};
      try { result = await response.json(); } catch { /* Effect may have committed despite a lost response. */ }
      if (!response.ok || result.ok !== true) throw Error(result.error || `Import nebyl potvrzen (HTTP ${response.status}).`);
      const after = await this.widget.catalog.get('/api/settings');
      if (JSON.stringify(after) !== JSON.stringify(settings))
        throw Error('Import mohl proběhnout, ale nastavení se nepodařilo ověřit. Obnov stav před opakováním.');
      this._preferenceDrafts.clear();
      this._settingsResources.clear();
      await this.loadSettingsResource('zalohy', true);
      this._settingsImport = { fileName: '', settings: null,
        status: 'Import byl ověřen zpětným čtením backendu.', busy: false };
      return true;
    } catch (error) {
      this._settingsImport.status = error?.message || 'Výsledek importu není jistý. Před opakováním obnov stav.';
      this._settingsImport.settings = null;
      return false;
    } finally { this._settingsImport.busy = false; this.forceUpdate(); }
  }

  async exportSettings() {
    try {
      const settings = await this.widget.catalog.get('/api/settings');
      if (!settings || typeof settings !== 'object' || Array.isArray(settings))
        throw Error('Backend nevrátil platný dokument nastavení.');
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'intentsmith-settings-' + new Date().toISOString().slice(0, 10) + '.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      this._maintenanceNotice = 'Soubor nastavení byl připraven ke stažení.';
      this.forceUpdate();
      return true;
    } catch (error) {
      this._maintenanceNotice = error?.message || 'Export nastavení selhal.';
      this.forceUpdate();
      return false;
    }
  }

  async changeFeatures(path, message, verify) {
    if (this._settingsBusy) return false;
    const confirmAction = this.widget.confirmAction || globalThis.confirm;
    if (typeof confirmAction !== 'function' || !confirmAction(message)) return false;
    this._settingsBusy = true;
    this._settingsNotice = '';
    this.forceUpdate();
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + path.route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(path.body), signal: AbortSignal.timeout(10_000) });
      let body = {};
      try { body = await response.json(); } catch { /* HTTP status remains authoritative. */ }
      if (!response.ok || body.ok !== true) throw Error(body.error || 'Změna přepínačů selhala (HTTP ' + response.status + ').');
      await this.loadSettingsResource('prepinace', true);
      const current = this._settingsResources.get('prepinace');
      if (current?.status !== 'ready' || !body.features ||
        Object.keys(current.data.features).length !== Object.keys(body.features).length ||
        !Object.entries(body.features).every(([key, value]) => current.data.features[key] === value) ||
        !verify(current.data.features, body.features))
        throw Error('Požadavek byl přijat, ale výsledek se nepodařilo ověřit. Obnov stav před dalším pokusem.');
      this._settingsNotice = 'Změna byla ověřena v backendu. Platí do jeho restartu.';
      return true;
    } catch (error) {
      this._settingsNotice = error?.message || 'Změna selhala.';
      return false;
    } finally { this._settingsBusy = false; this.forceUpdate(); }
  }

  toggleFeature(name, enabled) {
    const features = this._settingsResources.get('prepinace')?.data?.features;
    if (!features || !Object.hasOwn(features, name) || typeof enabled !== 'boolean' || !/^[A-Za-z][A-Za-z0-9]*$/.test(name)) return false;
    return this.changeFeatures({ route: '/api/features/' + encodeURIComponent(name), body: { enabled } },
      (enabled ? 'Zapnout ' : 'Vypnout ') + name + '? Změna platí do restartu backendu.',
      current => current[name] === enabled);
  }

  resetFeatures() {
    if (this._settingsResources.get('prepinace')?.status !== 'ready') return false;
    return this.changeFeatures({ route: '/api/features/reset', body: {} },
      'Obnovit výchozí běhové přepínače backendu?', (current, expected) => expected &&
        Object.keys(current).length === Object.keys(expected).length &&
        Object.entries(expected).every(([key, value]) => current[key] === value));
  }

  async pMarketplaceAction(item, operation) {
    const type = item?.raw?.type, id = item?.raw?.id;
    const key = type + ':' + id;
    if (!['skill', 'expertise', 'specialist'].includes(type) || typeof id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !['install', 'uninstall', 'update'].includes(operation)
      || this._catalogBusy.has(key)) return false;
    const verb = { install: 'Nainstalovat', uninstall: 'Odinstalovat', update: 'Aktualizovat' }[operation];
    const confirmAction = this.widget.confirmAction || globalThis.confirm;
    if (typeof confirmAction !== 'function' || !confirmAction(`${verb} balíček ${type}/${id} (${item.raw.version || 'verze neuvedena'})?`)) return false;
    this._catalogBusy.add(key);
    this.widget.catalogActionError = null;
    this.forceUpdate();
    try {
      const route = operation === 'uninstall' ? '/api/marketplace/installed/'
        : '/api/marketplace/' + operation + '/';
      await this.widget.catalog.mutate(route + encodeURIComponent(type) + '/' + encodeURIComponent(id),
        operation === 'uninstall' ? 'DELETE' : 'POST');
      await this.widget.catalog.load('Obchod');
      const current = this.widget.catalog.view('Obchod');
      const updated = current.items.find(row => row.raw.id === id && row.raw.type === type);
      if (current.status !== 'ready' || !updated || updated.raw.installed !== (operation !== 'uninstall')) {
        throw Error('Akce byla odeslána, ale aktuální stav balíčku nelze ověřit. Obnov katalog před dalším pokusem.');
      }
      return true;
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Akce s balíčkem selhala.';
      return false;
    } finally {
      this._catalogBusy.delete(key);
      this.forceUpdate();
    }
  }

  async loadWorkerDetail(id) {
    const key = String(id), previous = this._workerDetails.get(key);
    if (previous?.status === 'loading') return;
    const request = Symbol(key);
    this._workerDetails.set(key, { status: 'loading', data: previous?.data, request });
    this.forceUpdate();
    try {
      const data = await this.widget.catalog.get('/api/agents/' + encodeURIComponent(key));
      if (!data || String(data.id) !== key || !data.definition || typeof data.definition !== 'object')
        throw Error('Backend vrátil neplatnou definici workeru.');
      if (this._workerDetails.get(key)?.request === request)
        this._workerDetails.set(key, { status: 'ready', data });
    } catch (error) {
      if (this._workerDetails.get(key)?.request === request)
        this._workerDetails.set(key, { status: 'error', error: error?.message || 'Načtení workeru selhalo.' });
    }
    this.forceUpdate();
  }

  async loadSpecialistDetail(id) {
    const key = String(id), previous = this._specialistDetails.get(key);
    if (previous?.status === 'loading') return;
    const request = Symbol(key);
    this._specialistDetails.set(key, { status: 'loading', data: previous?.data, request });
    this.forceUpdate();
    try {
      const data = await this.widget.catalog.get('/api/specialists/' + encodeURIComponent(key));
      if (data?.ok !== true || data.id !== key || !data.manifest
        || !Array.isArray(data.tools) || typeof data.status !== 'string')
        throw Error('Backend vrátil neplatný detail specialisty.');
      if (this._specialistDetails.get(key)?.request === request)
        this._specialistDetails.set(key, { status: 'ready', data });
    } catch (error) {
      if (this._specialistDetails.get(key)?.request === request)
        this._specialistDetails.set(key, { status: 'error', error: error?.message || 'Detail nelze načíst.' });
    }
    this.forceUpdate();
  }

  async specialistAction(id, operation) {
    if (!['enable','disable','update','uninstall'].includes(operation)) return false;
    const item = this.widget.catalog.view('Specialisté').items.find(row => row.id === id);
    if (!item || this._catalogBusy.has('specialist:' + id)
      || !['enabled','disabled'].includes(item.raw.status)
      || operation === 'enable' && item.raw.status !== 'disabled'
      || operation === 'disable' && item.raw.status !== 'enabled') return false;
    const confirmAction = this.widget.confirmAction || globalThis.confirm;
    const question = { enable: `Zapnout specialistu ${item.name}?`,
      disable: `Vypnout specialistu ${item.name}?`,
      update: `Zkontrolovat a případně aktualizovat specialistu ${item.name}?`,
      uninstall: `Odinstalovat specialistu ${item.name}? Balíček přestane být dostupný v relacích.` };
    if (typeof confirmAction !== 'function' || !confirmAction(question[operation])) return false;
    const busyKey = 'specialist:' + id;
    this._catalogBusy.add(busyKey); this.forceUpdate();
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + '/api/specialists/' + encodeURIComponent(id)
        + (operation === 'uninstall' ? '' : '/' + operation), {
        method: operation === 'uninstall' ? 'DELETE' : 'POST', credentials: 'same-origin',
        signal: AbortSignal.timeout(30_000) });
      let receipt = {};
      try { receipt = await response.json(); } catch { /* Readback decides the result. */ }
      if (!response.ok || receipt.ok !== true
        || ['enable','disable'].includes(operation) && receipt.status !== (operation === 'enable' ? 'enabled' : 'disabled')
        || operation === 'uninstall' && (receipt.removed !== true || receipt.id !== id))
        throw Error(receipt.error || 'Backend nepotvrdil změnu stavu specialisty.');
      if (operation !== 'uninstall') await this.loadSpecialistDetail(id);
      await this.widget.catalog.load('Specialisté');
      const detail = this._specialistDetails.get(id);
      const updated = this.widget.catalog.view('Specialisté').items.find(row => row.id === id);
      const expectedVersion = operation === 'update' ? receipt.newVersion || receipt.version : null;
      const verified = operation === 'uninstall' ? !updated
        : detail?.status === 'ready' && !!updated &&
          (operation === 'update' ? typeof expectedVersion === 'string' && !!expectedVersion
            && detail.data.version === expectedVersion && updated.raw.version === expectedVersion
            : detail.data.status === receipt.status && updated.raw.status === receipt.status);
      if (this.widget.catalog.view('Specialisté').status !== 'ready' || !verified)
        throw Error('Změnu stavu specialisty nelze ověřit. Obnov katalog.');
      if (operation === 'uninstall') {
        this._specialistDetails.delete(id);
        this.setState({ detail: this.merge(this.st(), 'detail', { specialists: null }) });
      }
      return true;
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Akce specialisty selhala.';
      return false;
    } finally {
      this._catalogBusy.delete(busyKey); this.forceUpdate();
    }
  }

  async pWorkerAction(item, operation) {
    const id = item?.id, key = 'worker:' + id;
    const detail = this._workerDetails.get(id);
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
      || !['run', 'enable', 'disable'].includes(operation) || !detail?.data?.definition?.m3_extension
      || this._catalogBusy.has(key)) return false;
    const verb = { run: 'Spustit', enable: 'Obnovit', disable: 'Pozastavit' }[operation];
    const confirmAction = this.widget.confirmAction || globalThis.confirm;
    if (typeof confirmAction !== 'function' || !confirmAction(`${verb} worker ${item.name} (${id})?`)) return false;
    this._catalogBusy.add(key);
    this.widget.catalogActionError = null;
    this.forceUpdate();
    try {
      await this.widget.catalog.mutate('/api/agent-extensions/instances/' + encodeURIComponent(id) + '/' + operation, 'POST');
      await Promise.all([this.loadWorkerDetail(id), this.widget.catalog.load('Workeři')]);
      return this._workerDetails.get(id)?.status === 'ready';
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Akce workeru selhala.';
      return false;
    } finally {
      this._catalogBusy.delete(key);
      this.forceUpdate();
    }
  }

  async pMediaAction(item, operation) {
    const id = item?.id, raw = item?.raw || {}, key = 'media:' + id;
    const active = raw.status === 'pending' || raw.status === 'running';
    if (typeof id !== 'string' || !MEDIA_ID.test(id)
      || !['cancel', 'favorite', 'delete'].includes(operation)
      || (operation === 'cancel' && !active) || (operation === 'delete' && active)
      || this._catalogBusy.has(key)) return false;
    if (operation !== 'favorite') {
      const confirmAction = this.widget.confirmAction || globalThis.confirm;
      const verb = operation === 'cancel' ? 'Zrušit generování' : 'Smazat generování';
      if (typeof confirmAction !== 'function' || !confirmAction(`${verb} ${id}?`)) return false;
    }
    this._catalogBusy.add(key);
    this.widget.catalogActionError = null;
    this.forceUpdate();
    try {
      const nextFavorite = !(raw.favorite === true || raw.favorite === 1);
      const route = operation === 'favorite' ? '/api/media/favorite'
        : operation === 'cancel' ? '/api/media/cancel?id=' + encodeURIComponent(id)
          : '/api/media?id=' + encodeURIComponent(id);
      const result = await this.widget.catalog.mutate(route,
        operation === 'favorite' ? 'PUT' : operation === 'cancel' ? 'POST' : 'DELETE',
        operation === 'favorite' ? { id, favorite: nextFavorite } : null);
      await this.widget.catalog.load('Multimédia');
      const current = this.widget.catalog.view('Multimédia');
      const updated = current.items.find(row => row.id === id);
      if (current.status !== 'ready' || (operation === 'delete' ? !!updated : !updated)
        || (operation === 'favorite' && !!updated.raw.favorite !== nextFavorite)
        || (operation === 'cancel' && raw.status === 'pending' && updated.raw.status !== 'cancelled'))
        throw Error('Akce byla odeslána, ale aktuální stav média nelze ověřit. Obnov historii před dalším pokusem.');
      if (operation === 'cancel') this._mediaNotices.set(id, result.message || 'Požadavek na zrušení přijat.');
      if (operation === 'delete') {
        this._mediaNotices.delete(id);
        for (const [key, output] of this._mediaOutputUrls) if (key.startsWith(id + '|')) {
          if (output.url) URL.revokeObjectURL(output.url);
          this._mediaOutputUrls.delete(key);
        }
      }
      return true;
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Akce s médiem selhala.';
      return false;
    } finally {
      this._catalogBusy.delete(key);
      this.forceUpdate();
    }
  }

  async loadMediaOutputs(item) {
    const id = item?.id;
    if (!MEDIA_ID.test(id || '') || item.raw?.status !== 'completed') return false;
    const names = mediaOutputNames(item.raw);
    if (!names.length) return false;
    await Promise.all(names.map(async name => {
      const key = id + '|' + name;
      if (this._mediaOutputUrls.has(key)) return;
      this._mediaOutputUrls.set(key, { status: 'loading' });
      this.forceUpdate();
      try {
        const base = this.widget.catalog.backendUrl();
        if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
        const response = await this.fetchImpl(base + '/api/media/output?id=' + encodeURIComponent(id)
          + '&filename=' + encodeURIComponent(name), { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error('Výstup nelze načíst (HTTP ' + response.status + ').');
        const blob = await response.blob();
        if (!/^(image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm))$/.test(blob.type))
          throw Error('Backend vrátil nepodporovaný formát výstupu.');
        this._mediaOutputUrls.set(key, { status: 'ready', url: URL.createObjectURL(blob) });
      } catch (error) {
        this._mediaOutputUrls.set(key, { status: 'error', error: error?.message || 'Výstup nelze načíst.' });
      }
      this.forceUpdate();
    }));
    return true;
  }

  async onMediaEvent(kind, event) {
    const id = event?.generationId;
    if (typeof id !== 'string' || !MEDIA_ID.test(id)) return false;
    if (kind === 'progress') {
      const percent = Number.isFinite(event.percent) && event.percent >= 0 && event.percent <= 100
        ? ` · ${Math.round(event.percent)} %` : '';
      const label = typeof event.text === 'string' ? event.text.slice(0, 200) : 'Generování probíhá';
      this._mediaNotices.set(id, label + percent);
      this.forceUpdate();
      return true;
    }
    if (kind !== 'complete' && kind !== 'error') return false;
    const error = typeof event.error === 'string' ? event.error.slice(0, 200) : '';
    this._mediaNotices.set(id, kind === 'error' ? 'Generování selhalo: ' + (error || 'neznámá chyba')
      : 'Dokončeno; ověřuji historii a výstupy…');
    this.forceUpdate();
    if (this.st().section !== 'media') return true;
    await this.widget.catalog.load('Multimédia');
    const view = this.widget.catalog.view('Multimédia');
    const item = view.items.find(row => row.id === id);
    if (view.status !== 'ready' || !item || (kind === 'complete' && item.raw.status !== 'completed')
      || (kind === 'error' && item.raw.status !== 'failed')) {
      this._mediaNotices.set(id, 'Událost generování dorazila, ale historie zatím stav nepotvrdila. Obnov historii.');
    } else if (kind === 'complete') {
      this._mediaNotices.set(id, 'Generování dokončeno.');
      if (this.st().detail?.media === id) await this.loadMediaOutputs(item);
    }
    this.forceUpdate();
    return true;
  }

  clearMediaOutputUrls(exceptId = '') {
    for (const [key, output] of this._mediaOutputUrls) if (!exceptId || !key.startsWith(exceptId + '|')) {
      if (output.url) URL.revokeObjectURL(output.url);
      this._mediaOutputUrls.delete(key);
    }
  }

  mediaStatus() {
    return { ...this._mediaEnvironment,
      status: this._mediaSubmitting ? 'loading' : this._mediaEnvironment.status,
      error: this._mediaInputError || this._mediaSubmitNotice || this._mediaEnvironment.error };
  }

  pickMediaInput(event) {
    const file = event?.target?.files?.[0] || null;
    if (event?.target) event.target.value = '';
    this._mediaInputFile = null;
    this._mediaInputError = '';
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      || file.size < 24 || file.size > 3 * 1024 * 1024)) {
      this._mediaInputError = 'Vyber PNG, JPEG nebo WebP o velikosti nejvýše 3 MiB.';
      this.setState({ mediaInputName: '' }); return;
    }
    this._mediaInputFile = file;
    this.setState({ mediaInputName: file?.name || '' });
  }

  projectStatus() { return { ...this._projectWizardStatus,
    defaultDir: this._projectsDir || this._projectWizardStatus.defaultDir }; }

  projectDirectoryVM() {
    return { value: this._projectsDir, status: this._projectsDirNotice ||
      (this._projectsDir ? 'Složka je uložená lokálně. Nový projekt ji použije po kontrole backendem.'
        : 'Nové projekty použijí výchozí složku backendu.'),
      change: event => this.setProjectsDir(event.target.value) };
  }

  setProjectsDir(value) {
    if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x1f]/.test(value)
      || value && !value.startsWith('/')) {
      this._projectsDirNotice = 'Zadej absolutní cestu bez řídicích znaků.';
      this.forceUpdate(); return false;
    }
    try { this.widget.store.storage.setItem(PROJECTS_DIR_KEY, value); this._projectsDir = value;
      this._projectsDirNotice = '';
      this.forceUpdate(); return true; }
    catch { this._projectsDirNotice = 'Složku se nepodařilo uložit; při dalším spuštění nemusí být dostupná.';
      this.forceUpdate(); return false; }
  }

  specialistStatus() { return this._specialistWizardStatus; }

  workerStatus() { return this._workerWizardStatus; }

  expertiseConfig(s) {
    const name = s.expertiseName.trim();
    const id = s.expertiseEditingId || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      .replace(/^_+|_+$/g, '').slice(0, 32);
    const lines = value => String(value || '').split('\n').map(line => line.trim()).filter(Boolean);
    let originalRules = {};
    if (s.expertiseEditingId && this._expertiseWizardStatus.source) {
      const source = JSON.parse(this._expertiseWizardStatus.source);
      if (source.id === id && source.styleRules && typeof source.styleRules === 'object'
        && !Array.isArray(source.styleRules)) originalRules = source.styleRules;
    }
    return { id, name, description: s.expertiseDescription.trim(), domain: s.expertiseDomain || 'custom',
      icon: s.expertiseIcon || '👤', tone: s.expertiseTone, temperature: s.expertiseTemperature,
      systemPrompt: s.expertiseSystemPrompt,
      capabilities: { reasoning: s.expertiseReasoning, creativity: s.expertiseCreativity,
        determinism: s.expertiseDeterminism, riskTolerance: s.expertiseRiskTolerance,
        verbosity: s.expertiseVerbosity },
      modules: { domain_rules: lines(s.expertiseDomainRules), emphasis: lines(s.expertiseEmphasis),
        constraints: lines(s.expertiseConstraints), vocabulary: lines(s.expertiseVocabulary),
        antipatterns: lines(s.expertiseAntipatterns), disclaimer: s.expertiseDisclaimer.trim() || null },
      inheritance: JSON.parse(s.expertiseInheritance || '{}'),
      styleRules: { ...originalRules, forbiddenPhrases: lines(s.expertiseForbiddenPhrases) } };
  }

  expertiseStatus() {
    const status = this._expertiseWizardStatus;
    let key = '';
    try { key = JSON.stringify(this.expertiseConfig(this.st())); } catch { /* invalid draft */ }
    return { ...status, busy: status.busy || status.loading,
      preview: status.previewKey === key ? status.preview : null,
      testResult: status.testKey === JSON.stringify({ key, question: this.st().expertiseTestQuestion.trim() })
        ? status.testResult : null };
  }

  async openExpertiseEdit(item) {
    if (item?.raw?.isCustom !== true || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(item.id)) return false;
    this._expertiseWizardStatus = { busy: true, loading: true, error: '', uncertain: false,
      preview: null, previewKey: '', testResult: null, testKey: '', source: null };
    this.forceUpdate();
    try {
      const source = await this.widget.catalog.get('/api/expertises/' + encodeURIComponent(item.id));
      if (source?.id !== item.id || source.isCustom !== true) throw Error('Backend nevrátil vlastní expertýzu se stejným ID.');
      const lines = value => Array.isArray(value) ? value.join('\n') : '';
      const caps = source.capabilities || {}, modules = source.modules || {};
      const number = value => Number.isInteger(value) && value >= 0 && value <= 100 ? value : 50;
      this._expertiseWizardStatus.source = JSON.stringify(source);
      this.setState({ ...this.pSelect(this.st(), 'expertises', '__edit__'),
        expertiseEditingId: source.id, expertiseStep: 0, expertiseName: source.name || '',
        expertiseDomain: source.domain || '', expertiseDescription: source.description || '',
        expertiseIcon: source.icon || '👤', expertiseTone: source.tone || 'professional',
        expertiseTemperature: Number.isFinite(source.temperature) ? source.temperature : 0.5,
        expertiseSystemPrompt: source.systemPrompt || '', expertiseCreativity: number(caps.creativity),
        expertiseReasoning: number(caps.reasoning), expertiseDeterminism: number(caps.determinism),
        expertiseRiskTolerance: number(caps.riskTolerance), expertiseVerbosity: number(caps.verbosity),
        expertiseDomainRules: lines(modules.domain_rules), expertiseEmphasis: lines(modules.emphasis),
        expertiseConstraints: lines(modules.constraints), expertiseVocabulary: lines(modules.vocabulary),
        expertiseAntipatterns: lines(modules.antipatterns), expertiseDisclaimer: modules.disclaimer || '',
        expertiseForbiddenPhrases: lines(source.styleRules?.forbiddenPhrases),
        expertiseInheritance: JSON.stringify(source.inheritance || {}), expertiseTestQuestion: '', expertiseAdvanced: false });
      return true;
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Expertýzu nelze načíst pro úpravu.';
      return false;
    } finally { this._expertiseWizardStatus.busy = false; this._expertiseWizardStatus.loading = false; this.forceUpdate(); }
  }

  async testExpertise(s) {
    const form = this.expertiseWizardVM(s);
    const question = s.expertiseTestQuestion.trim();
    if (form.testDisabled || s.expertiseStep !== 1 || !question || question.length > 2000) return false;
    const confirmAction = this.widget.confirmAction || globalThis.confirm;
    if (typeof confirmAction !== 'function' || !confirmAction('Spustit test expertýzy na modelu? Použije inference backendu.')) return false;
    const config = this.expertiseConfig(s), key = JSON.stringify({ key: JSON.stringify(config), question });
    this._expertiseWizardStatus = { ...this._expertiseWizardStatus, busy: true, error: '',
      testResult: null, testKey: '' };
    this.forceUpdate();
    try {
      const result = await this.postExpertise('/api/expertise-wizard/test-prompt',
        { expertiseConfig: config, question }, 65000);
      if (typeof result.response !== 'string') throw Error('Backend nevrátil výsledek modelového testu.');
      this._expertiseWizardStatus = { ...this._expertiseWizardStatus, testResult: result, testKey: key };
      return true;
    } catch (error) {
      this._expertiseWizardStatus.error = error?.message || 'Modelový test expertýzy selhal.';
      return false;
    } finally { this._expertiseWizardStatus.busy = false; this.forceUpdate(); }
  }

  async postExpertise(path, body, timeoutMs = 15000, method = 'POST', revision = '') {
    const base = this.widget.catalog.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(revision ? { 'If-Match': revision } : {}) }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs) });
    let result = {};
    try { result = await response.json(); } catch { /* A lost response leaves a mutation uncertain. */ }
    if (!response.ok) throw Object.assign(Error(result.error || `Operace expertýzy selhala (HTTP ${response.status}).`),
      { status: response.status });
    return result;
  }

  async previewExpertise(s) {
    const form = this.expertiseWizardVM(s);
    if (s.expertiseStep !== 1 || form.submitDisabled) return false;
    const config = this.expertiseConfig(s), key = JSON.stringify(config);
    this._expertiseWizardStatus = { ...this._expertiseWizardStatus, busy: true, error: '', preview: null, previewKey: '' };
    this.forceUpdate();
    try {
      const preview = await this.postExpertise('/api/merge-preview', { expertises: [{ ...config, weight: 1 }] });
      if (typeof preview.promptPreview !== 'string' || !Number.isFinite(preview.tokenCount))
        throw Error('Backend nevrátil platný náhled pravidel.');
      this._expertiseWizardStatus = { ...this._expertiseWizardStatus, preview, previewKey: key };
      return true;
    } catch (error) {
      this._expertiseWizardStatus.error = error?.message || 'Náhled expertýzy selhal.';
      return false;
    } finally { this._expertiseWizardStatus.busy = false; this.forceUpdate(); }
  }

  async submitExpertise(s) {
    const form = this.expertiseWizardVM(s);
    if (s.expertiseStep !== 1 || form.submitDisabled || this._expertiseWizardStatus.uncertain) return false;
    const config = this.expertiseConfig(s), key = JSON.stringify(config);
    const editing = !!s.expertiseEditingId;
    if (editing && (s.detail.expertises !== '__edit__' || !this._expertiseWizardStatus.source)) return false;
    this._expertiseWizardStatus = { ...this._expertiseWizardStatus, busy: true, error: '' };
    this.widget.catalogActionError = null;
    this.forceUpdate();
    let attempted = false, accepted = null;
    try {
      let preview = this._expertiseWizardStatus.previewKey === key ? this._expertiseWizardStatus.preview : null;
      if (!preview) {
        preview = await this.postExpertise('/api/merge-preview', { expertises: [{ ...config, weight: 1 }] });
        if (typeof preview.promptPreview !== 'string') throw Error('Backend nevrátil platný náhled pravidel.');
        this._expertiseWizardStatus = { ...this._expertiseWizardStatus, preview, previewKey: key };
      }
      if (preview.requiresConfirmation) {
        const confirmAction = this.widget.confirmAction || globalThis.confirm;
        if (typeof confirmAction !== 'function' || !confirmAction('Backend žádá potvrzení kombinace expertýz. Pokračovat?')) return false;
      }
      let revision = '';
      if (editing) {
        const current = await this.widget.catalog.get('/api/expertises/' + encodeURIComponent(config.id));
        if (JSON.stringify(current) !== this._expertiseWizardStatus.source)
          throw Error('Expertýza se na backendu změnila. Obnov ji před uložením.');
        const bytes = new TextEncoder().encode(this._expertiseWizardStatus.source);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        revision = '"sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') + '"';
      }
      attempted = true;
      const result = await this.postExpertise('/api/expertises' + (editing ? '/' + encodeURIComponent(config.id) : ''),
        config, 15000, editing ? 'PUT' : 'POST', revision);
      if (result.id !== config.id || result.name !== config.name)
        throw Error('Backend nevrátil ověřitelnou expertýzu. Zkontroluj katalog.');
      accepted = result;
      const detail = await this.widget.catalog.get('/api/expertises/' + encodeURIComponent(config.id));
      if (detail.id !== config.id || detail.name !== config.name || detail.domain !== config.domain
        || detail.description !== config.description || detail.icon !== config.icon
        || detail.tone !== config.tone || detail.temperature !== config.temperature
        || detail.systemPrompt !== config.systemPrompt
        || JSON.stringify(detail.modules) !== JSON.stringify(config.modules)
        || JSON.stringify(detail.capabilities) !== JSON.stringify(config.capabilities)
        || JSON.stringify(detail.inheritance) !== JSON.stringify(config.inheritance)
        || JSON.stringify(detail.styleRules) !== JSON.stringify(config.styleRules))
        throw Error('Detail expertýzy neodpovídá potvrzenému plánu.');
      await this.widget.catalog.load('Expertýzy');
      const view = this.widget.catalog.view('Expertýzy');
      if (view.status !== 'ready' || !view.items.some(item => item.id === config.id)) {
        this._expertiseWizardStatus.error = `Backend uložil expertýzu ${config.id}, ale katalog ji ještě neukazuje. Obnov seznam.`;
        return true;
      }
      this.setState({ ...this.pSelect(this.st(), 'expertises', config.id),
        expertiseStep: 0, expertiseEditingId: '', expertiseName: '', expertiseDescription: '', expertiseSystemPrompt: '' });
      return true;
    } catch (error) {
      this._expertiseWizardStatus = { ...this._expertiseWizardStatus,
        uncertain: attempted && !accepted && !error?.status,
        error: accepted ? `Backend uložil expertýzu ${config.id}, ale další ověření selhalo. Obnov katalog.`
          : (error?.message || 'Výsledek vytvoření není jistý. Zkontroluj katalog před dalším pokusem.') };
      this.widget.catalogActionError = this._expertiseWizardStatus.error;
      return false;
    } finally { this._expertiseWizardStatus.busy = false; this.forceUpdate(); }
  }

  async loadWorkerWizard() {
    this._workerWizardStatus = { ...this._workerWizardStatus, loading: true, error: '' };
    this.forceUpdate();
    try {
      const [available, list] = await Promise.all([
        this.widget.catalog.get('/api/agent-extensions'),
        this.widget.catalog.get('/api/projects?limit=100&status=active')
      ]);
      if (!Array.isArray(available?.extensions) || !Array.isArray(list?.projects))
        throw Error('Backend nevrátil rozšíření M3 nebo projekty.');
      // This is the only extension whose required project parameter is known
      // by the current public API. Future extensions need a parameter schema.
      const extensions = available.extensions.filter(item => item.id === 'project-health'
        && Array.isArray(item.requiredCapabilities)
        && item.requiredCapabilities.includes('code-intel.project-context.v1'));
      if (!extensions.length) throw Error('Rozšíření Project Health není v backendu dostupné.');
      const projects = list.projects.filter(item => Number.isSafeInteger(item.id) && item.id > 0
        && typeof item.name === 'string');
      this._workerWizardStatus = { ...this._workerWizardStatus, loading: false, extensions, projects,
        error: projects.length ? '' : 'Nejdřív založ nebo otevři projekt.' };
    } catch (error) {
      this._workerWizardStatus = { ...this._workerWizardStatus, loading: false,
        error: error?.message || 'Průvodce workerem nelze načíst.' };
    }
    this.forceUpdate();
  }

  async submitWorker(s) {
    const form = this.workerWizardVM(s);
    if (s.workerStep !== 1 || form.submitDisabled || this._workerWizardStatus.uncertain) return false;
    const extensionId = s.workerExtension, instanceId = s.workerInstanceId.trim();
    const projectId = Number(s.workerProject);
    if (extensionId !== 'project-health' || !Number.isSafeInteger(projectId) || projectId <= 0) return false;
    this._workerWizardStatus = { ...this._workerWizardStatus, busy: true, error: '' };
    this.widget.catalogActionError = null;
    this.forceUpdate();
    let accepted = null;
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + '/api/agent-extensions/' + extensionId + '/install', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, projectId, enabled: false }), signal: AbortSignal.timeout(30000) });
      let result = {};
      try { result = await response.json(); } catch { /* A lost response leaves the effect uncertain. */ }
      if (!response.ok) throw Object.assign(Error(result.error || `Worker nelze vytvořit (HTTP ${response.status}).`),
        { status: response.status });
      if (result.id !== instanceId || result.enabled !== false
        || result.definition?.m3_extension?.id !== extensionId)
        throw Error('Backend nevrátil ověřitelnou instanci workeru. Zkontroluj katalog.');
      accepted = result;
      const detail = await this.widget.catalog.get('/api/agents/' + encodeURIComponent(instanceId));
      if (detail.id !== instanceId || detail.enabled !== false
        || detail.definition?.m3_extension?.id !== extensionId
        || Number(detail.params?.project_id) !== projectId)
        throw Error('Detail workeru neodpovídá potvrzenému projektu a rozšíření.');
      await this.widget.catalog.load('Workeři');
      const view = this.widget.catalog.view('Workeři');
      if (view.status !== 'ready' || !view.items.some(item => item.id === instanceId)) {
        this._workerWizardStatus.error = `Backend vytvořil worker ${instanceId}, ale katalog jej ještě neukazuje. Obnov seznam.`;
        return true;
      }
      this.setState({ ...this.pSelect(this.st(), 'workers', instanceId),
        workerStep: 0, workerProject: '', workerInstanceId: '' });
      return true;
    } catch (error) {
      this._workerWizardStatus = { ...this._workerWizardStatus,
        uncertain: !accepted && !error?.status,
        error: accepted ? `Backend vytvořil worker ${instanceId}, ale další ověření selhalo. Obnov katalog.`
          : (error?.message || 'Výsledek vytvoření není jistý. Zkontroluj katalog před dalším pokusem.') };
      this.widget.catalogActionError = this._workerWizardStatus.error;
      return false;
    } finally {
      this._workerWizardStatus.busy = false;
      this.forceUpdate();
    }
  }

  async submitSpecialist(s) {
    const form = this.specialistWizardVM(s);
    if (s.specialistStep !== 1 || form.submitDisabled || this._specialistWizardStatus.uncertain) return false;
    const body = { name: s.specialistName.trim(), domain: s.specialistDomain,
      description: s.specialistDescription.trim(), icon: s.specialistIcon || null };
    this._specialistWizardStatus = { busy: true, error: '', uncertain: false };
    this.widget.catalogActionError = null;
    this.forceUpdate();
    let accepted = null;
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + '/api/specialists', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      let result = {};
      try { result = await response.json(); } catch { /* A lost response leaves the effect uncertain. */ }
      if (!response.ok) throw Object.assign(Error(result.error || `Specialistu nelze vytvořit (HTTP ${response.status}).`),
        { status: response.status });
      const specialist = result.specialist;
      if (result.ok !== true || typeof specialist?.id !== 'string'
        || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(specialist.id))
        throw Error('Backend nevrátil ověřitelného specialistu. Zkontroluj katalog.');
      accepted = specialist;
      const detail = await this.widget.catalog.get('/api/specialists/' + encodeURIComponent(specialist.id));
      if (detail.ok !== true || detail.id !== specialist.id || detail.manifest?.name !== body.name
        || detail.manifest?.domain !== body.domain)
        throw Error('Detail nového specialisty neodpovídá potvrzenému plánu.');
      await this.widget.catalog.load('Specialisté');
      const view = this.widget.catalog.view('Specialisté');
      const row = view.items.find(item => item.id === specialist.id);
      if (view.status !== 'ready' || !row) {
        this._specialistWizardStatus.error = `Backend vytvořil specialistu ${specialist.id}, ale katalog jej ještě neukazuje. Obnov seznam.`;
        return true;
      }
      this.setState({ ...this.pSelect(this.st(), 'specialists', specialist.id),
        specialistStep: 0, specialistName: '', specialistDescription: '', specialistIcon: '' });
      return true;
    } catch (error) {
      this._specialistWizardStatus = { ...this._specialistWizardStatus,
        uncertain: !accepted && !error?.status,
        error: accepted ? `Backend vytvořil specialistu ${accepted.id}, ale další ověření selhalo. Obnov katalog.`
          : (error?.message || 'Výsledek vytvoření není jistý. Zkontroluj katalog před dalším pokusem.') };
      this.widget.catalogActionError = this._specialistWizardStatus.error;
      return false;
    } finally {
      this._specialistWizardStatus.busy = false;
      this.forceUpdate();
    }
  }

  async loadProjectDefaults() {
    try {
      const result = await this.widget.catalog.get('/api/projects/defaults');
      if (typeof result.defaultDir !== 'string' || !result.defaultDir.startsWith('/'))
        throw Error('Backend nevrátil platnou výchozí složku.');
      this._projectWizardStatus = { ...this._projectWizardStatus, defaultDir: result.defaultDir, error: '' };
    } catch (error) {
      this._projectWizardStatus = { ...this._projectWizardStatus,
        error: error?.message || 'Výchozí složku projektu nelze načíst.' };
    }
    this.forceUpdate();
  }

  async submitProject(s) {
    const form = this.projectWizardVM(s);
    if (s.projectStep !== 1 || form.submitDisabled || this._projectWizardStatus.uncertain) return false;
    const mode = form.mode, route = mode === 'create' ? '/api/projects' : '/api/projects/open-folder';
    const body = mode === 'create'
      ? { name: s.projectName.trim(), description: s.projectDescription, type: s.projectType,
        ...(s.projectPath.trim() || this._projectsDir ? { path: form.reviewTarget } : {}) }
      : { folderPath: s.projectPath.trim(), ...(s.projectName.trim() ? { name: s.projectName.trim() } : {}) };
    this._projectWizardStatus = { ...this._projectWizardStatus, busy: true, error: '' };
    this.widget.catalogActionError = null;
    this.forceUpdate();
    let accepted = null;
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + route, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (!response.ok) throw Object.assign(Error(result.error || `Projekt nelze připravit (HTTP ${response.status}).`),
        { status: response.status });
      const project = result.project;
      if (!project || !Number.isSafeInteger(project.id) || typeof project.path !== 'string'
        || !project.path.startsWith('/')) throw Error('Backend nevrátil ověřitelný projekt. Zkontroluj katalog.');
      accepted = project;
      await this.widget.catalog.load('Projekty');
      const view = this.widget.catalog.view('Projekty');
      const row = view.items.find(item => item.id === String(project.id) && item.raw.path === project.path);
      if (view.status !== 'ready' || !row) {
        this._projectWizardStatus = { ...this._projectWizardStatus,
          error: `Backend potvrdil projekt ${project.id}, ale katalog jej zatím neověřil. Obnov seznam projektů.` };
        return true;
      }
      this.setState({ ...this.pSelect(this.st(), 'projects', String(project.id)),
        projectStep: 0, projectName: '', projectPath: '', projectDescription: '' });
      return true;
    } catch (error) {
      this._projectWizardStatus = { ...this._projectWizardStatus,
        uncertain: !accepted && !error?.status,
        error: accepted ? `Backend potvrdil projekt ${accepted.id}, ale další ověření selhalo. Obnov katalog.`
          : (error?.message || 'Výsledek založení projektu není jistý. Zkontroluj katalog před dalším pokusem.') };
      this.widget.catalogActionError = this._projectWizardStatus.error;
      return false;
    } finally {
      this._projectWizardStatus.busy = false;
      this.forceUpdate();
    }
  }

  async loadMediaEnvironment() {
    this._mediaEnvironment = { status: 'loading', available: false, models: [], error: '' };
    this._mediaSubmitNotice = '';
    this.forceUpdate();
    try {
      const [health, data] = await Promise.all([
        this.widget.catalog.get('/api/media/health'),
        this.widget.catalog.get('/api/media/models', 15000)
      ]);
      const models = Array.isArray(data.checkpoints) ? data.checkpoints.filter(name => typeof name === 'string' && name) : [];
      const available = health.available === true && models.length > 0;
      this._mediaEnvironment = { status: 'ready', available, models,
        error: !health.available ? 'ComfyUI není dostupné.' : models.length === 0 ? 'ComfyUI nemá dostupný checkpoint.' : '' };
    } catch (error) {
      this._mediaEnvironment = { status: 'error', available: false, models: [],
        error: error?.message || 'Nelze ověřit ComfyUI a modely.' };
    }
    this.forceUpdate();
    return this._mediaEnvironment.available;
  }

  async submitMedia(s) {
    const form = this.mediaFormVM(s);
    if (this._mediaSubmitting || form.disabled || !['txt2img', 'img2img', 'txt2vid'].includes(s.mediaType)
      || s.mediaType === 'img2img' && !this._mediaInputFile) return false;
    this._mediaSubmitting = true;
    this._mediaSubmitNotice = '';
    this.widget.catalogActionError = null;
    this.forceUpdate();
    try {
      const params = { width: s.mediaWidth, height: s.mediaHeight, steps: s.mediaSteps,
        cfg_scale: s.mediaCfg, seed: s.mediaSeed, model: form.model };
      if (s.mediaType === 'txt2vid') params.frames = s.mediaFrames;
      let inputId = null;
      if (s.mediaType === 'img2img') {
        const file = this._mediaInputFile;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (file !== this._mediaInputFile || bytes.length !== file.size || bytes.length > 3 * 1024 * 1024
          || this.st().mediaType !== 'img2img') throw Error('Zdrojový obraz se při čtení změnil. Zkus to znovu.');
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const base = this.widget.catalog.backendUrl();
        if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
        const upload = await this.fetchImpl(base + '/api/media/input-image', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl: `data:${file.type};base64,${btoa(binary)}` }),
          signal: AbortSignal.timeout(30_000) });
        let receipt = {};
        try { receipt = await upload.json(); } catch { /* A lost upload receipt cannot authorize generation. */ }
        if (!upload.ok || !/^input-[0-9a-f-]{36}$/i.test(receipt.inputId || ''))
          throw Error(receipt.error || 'Zdrojový obraz nebyl potvrzen backendem.');
        if (file !== this._mediaInputFile || this.st().mediaType !== s.mediaType
          || this.st().mediaPrompt !== s.mediaPrompt || this.st().mediaModel !== s.mediaModel)
          throw Error('Zadání se během nahrávání změnilo. Generování nebylo odesláno.');
        inputId = receipt.inputId;
        params.denoise = s.mediaDenoise;
      }
      const result = await this.widget.catalog.mutate('/api/media/generate', 'POST', {
        type: s.mediaType, prompt: s.mediaPrompt.trim(), negative_prompt: s.mediaNegative.trim(),
        params, ...(inputId ? { inputId } : {})
      }, 30000);
      if (!MEDIA_ID.test(result.generationId || '')) throw Error('Backend nevrátil platné ID generování. Zkontroluj historii.');
      if (inputId) { this._mediaInputFile = null; this.setState({ mediaInputName: '' }); }
      await this.widget.catalog.load('Multimédia');
      const current = this.widget.catalog.view('Multimédia');
      if (current.status === 'ready' && current.items.some(item => item.id === result.generationId)) {
        const created = current.items.find(item => item.id === result.generationId);
        this.clearMediaOutputUrls(result.generationId);
        this.setState({ detail: this.merge(this.st(), 'detail', { media: result.generationId }),
          mediaPrompt: '', mediaNegative: '' });
        this.loadMediaOutputs(created);
      } else {
        this._mediaSubmitNotice = `Generování ${result.generationId} bylo přijato; historii zatím nelze ověřit.`;
      }
      return true;
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Generování se nepodařilo zahájit.';
      return false;
    } finally {
      this._mediaSubmitting = false;
      this.forceUpdate();
    }
  }

  pFocusSession(s, sid) {
    this.widget.store.focusTab(sid);
    return { mode: 'sessions' };
  }

  pPickInCol(s, index, sid) {
    this.widget.store.selectInColumn(index, sid);
    return { mode: 'sessions' };
  }

  pSetCols(s, count) {
    this.widget.store.setColumnCount(count);
    return { mode: 'sessions', colFr: [1, 1, 1] };
  }

  pNewSession(s, opts = {}) {
    if (opts.specialist || opts.project) {
      const section = opts.specialist ? 'Specialisté' : 'Projekty';
      const id = String(opts.specialist || opts.project);
      const item = this.widget.catalog.view(section).items.find(row => row.id === id);
      if (!item) return null;
      const action = opts.specialist ? this.widget.openSpecialist(item) : this.widget.openCatalogItem(section, item);
      Promise.resolve(action).then(ok => { if (ok) this.setState({ mode: 'sessions' }); else this.forceUpdate(); })
        .catch(error => { this.widget.catalogActionError = error.message || 'Relaci nelze otevřít.'; this.forceUpdate(); });
      return null;
    }
    if (Number.isInteger(s.focusCol)) this.widget.store.focusColumn(s.focusCol);
    this.widget.store.addSession();
    return { mode: 'sessions' };
  }

  expertiseSelectionVM() {
    const session = this.widget.store.focusedSession();
    const entry = this.expertiseSelection.entry(session);
    const blocked = !session || session.chat._thinking || session.chat.specialist || session._projectId
      || entry.busy || entry.uncertain;
    const names = this.widget.catalog.view('Expertýzy').items || [];
    return { status: !session ? 'Otevři relaci, pro kterou chceš expertýzu vybrat.'
      : session.chat.specialist ? 'Relaci řídí specialista; pro vlastní kombinaci otevři běžnou relaci.'
        : session._projectId ? 'Projektová relace používá projektový režim. Pro vlastní kombinaci otevři volnou relaci.'
        : entry.error || (entry.busy ? 'Ověřuji výběr na backendu…'
          : entry.uncertain ? 'Výsledek je nejistý. Obnov stav před další změnou.'
            : entry.status === 'loading' ? 'Načítám vybrané expertýzy…'
              : entry.expertises.length ? this.expertiseSelection.label(entry.expertises)
                : 'Aktivní relace používá výchozí expertýzu.'),
    rows: entry.expertises.map(row => ({ name: names.find(item => item.id === row.id)?.name || row.id,
      weight: row.weight, disabled: blocked,
      remove: () => this.expertiseSelection.change(session, 'remove', row.id) })),
    clearDisabled: blocked || entry.expertises.length === 0,
    clear: () => this.expertiseSelection.change(session, 'clear'),
    refresh: () => session && this.expertiseSelection.load(session, true) };
  }

  async useExpertise(item, action = 'single') {
    const current = this.widget.catalog.view('Expertýzy').items.find(row => row.id === item?.id);
    const session = this.widget.store.focusedSession();
    if (!current || current.name !== item.name || !session || session.chat._thinking) return false;
    if (!await this.expertiseSelection.change(session, action, current.id)) return false;
    this.setState({ mode: 'sessions' });
    return true;
  }

  pOpenSession(s, id) {
    if (this.widget.store.find(id)) return this.pFocusSession(s, id);
    const item = this.widget.catalog.view('Konverzace').items.find(row => row.id === String(id));
    if (item) this.widget.openCatalogItem('Konverzace', item).then(ok => {
      if (ok) this.setState({ mode: 'sessions' }); else this.forceUpdate();
    }).catch(error => { this.widget.catalogActionError = error.message || 'Konverzaci nelze otevřít.'; this.forceUpdate(); });
    return null;
  }

  pOpenBeside(s, id) {
    const session = this.widget.store.find(id);
    if (!session) return this.pOpenSession(s, id);
    const store = this.widget.store;
    if (store.state.columns.includes(id)) store.focusTab(id);
    else if (store.state.columns.length < 3) {
      store.setColumnCount(store.state.columns.length + 1);
      store.selectInColumn(store.state.columns.length - 1, id);
    } else store.selectInColumn((store.state.focusedColumn + 1) % 3, id);
    return { mode: 'sessions' };
  }

  pCloseTab(s, sid) {
    const session = this.widget.store.find(sid);
    return session && this.widget.closeSession(session) ? {} : null;
  }

  closeTabsBeside(sid, direction) {
    const sessions = this.widget.store.state.sessions;
    const index = sessions.findIndex(session => session.id === sid);
    if (index < 0) return null;
    const targets = sessions.filter((session, position) => direction === 'others'
      ? session.id !== sid : position > index);
    // Check every target before closing any of them. An unsaved editor or an
    // in-flight M2 decision must not leave a half-closed group of tabs.
    const blocked = targets.find(session => this.widget.m2.entry(session).busy
      || this.widget.workspace.entry(session).editor?.dirty);
    if (blocked) {
      this.widget.catalogActionError = `Relaci ${blocked.number} nelze zavřít: probíhá změna nebo obsahuje neuložený soubor.`;
      this.forceUpdate();
      return null;
    }
    for (const session of targets) {
      if (!this.widget.closeSession(session)) return null;
    }
    this.widget.store.focusTab(sid);
    return {};
  }

  async conversationAction(id, action) {
    if (!['rename', 'archive', 'delete'].includes(action)) return false;
    const catalog = this.widget.catalog;
    const item = catalog.view('Konverzace').items.find(row => row.id === String(id));
    if (!item) return false;
    const session = this.widget.store.state.sessions.find(row => row._convId === id || row.id === id);
    if (session && (session.chat._thinking || this.widget.m2.entry(session).busy
      || this.widget.workspace.entry(session).editor?.dirty)) {
      this.widget.catalogActionError = 'Relace právě pracuje nebo obsahuje neuložený soubor.';
      this.forceUpdate();
      return false;
    }
    let title = null;
    if (action === 'rename') {
      const promptAction = this.widget.promptAction || globalThis.prompt;
      title = typeof promptAction === 'function' ? promptAction('Nový název konverzace:', item.name) : null;
      if (title === null) return false;
      title = String(title).trim();
      if (!title || title.length > 200) {
        this.widget.catalogActionError = 'Název musí mít 1 až 200 znaků.';
        this.forceUpdate();
        return false;
      }
    } else {
      const confirmAction = this.widget.confirmAction || globalThis.confirm;
      if (typeof confirmAction !== 'function' || !confirmAction(
        `${action === 'archive' ? 'Archivovat' : 'Přesunout do koše'} konverzaci ${item.name}?`)) return false;
    }
    this.widget.catalogActionError = null;
    try {
      const before = await catalog.get('/api/conversations/' + encodeURIComponent(id));
      if (before?.conversation?.id !== id || before.conversation.state !== 'active')
        throw Error('Konverzace se mezitím změnila. Obnov seznam.');
      const route = '/api/conversations/' + encodeURIComponent(id);
      const method = action === 'rename' ? 'PUT' : action === 'archive' ? 'PATCH' : 'DELETE';
      const path = action === 'archive' ? route + '/archive' : route;
      const base = catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + path, { method, credentials: 'same-origin',
        signal: AbortSignal.timeout(10_000), ...(title === null ? {} : {
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) }) });
      let result = {};
      try { result = await response.json(); } catch { /* Readback decides the result. */ }
      if (!response.ok) throw Error(result.error || `Akce selhala (HTTP ${response.status}).`);
      const observed = await catalog.get(route);
      const expected = action === 'archive' ? 'archived' : action === 'delete' ? 'deleted' : 'active';
      if (observed?.conversation?.id !== id || observed.conversation.state !== expected
        || action === 'rename' && observed.conversation.title !== title)
        throw Error('Výsledek operace nelze ověřit. Obnov seznam před opakováním.');
      await catalog.load('Konverzace');
      const refreshed = catalog.view('Konverzace');
      const current = refreshed.items.find(row => row.id === id);
      if (refreshed.status !== 'ready' || (action === 'rename' ? current?.name !== title : !!current))
        throw Error('Katalog neodpovídá potvrzenému stavu. Obnov seznam.');
      if (session && action === 'rename') {
        session._label = title;
        this.widget.store.changed();
      } else if (session) this.widget.closeSession(session);
      if (action !== 'rename') this.setState({ detail: this.merge(this.st(), 'detail', { chats: null }) });
      return true;
    } catch (error) {
      this.widget.catalogActionError = error?.message || 'Akce konverzace selhala.';
      this.forceUpdate();
      return false;
    }
  }

  pGo(s, sec) {
    this.widget.catalogActionError = null;
    if (CATALOG[sec]) this.widget.catalog.load(CATALOG[sec]);
    return super.pGo(s, sec);
  }

  async loadProjectConversations(id) {
    const key = String(id);
    const previous = this._projectConversations.get(key);
    if (previous?.status === 'loading') return;
    const request = Symbol(key);
    this._projectConversations.set(key, { status: 'loading', items: previous?.items || [], error: '', request });
    this.forceUpdate();
    try {
      const body = await this.widget.catalog.get('/api/projects/' + encodeURIComponent(key) + '/conversations?limit=50&status=all');
      if (!Array.isArray(body.conversations)) throw Error('Backend nevrátil seznam konverzací projektu.');
      const items = body.conversations.map(row => {
        if (!row || row.id == null || (row.project_id != null && String(row.project_id) !== key))
          throw Error('Backend vrátil konverzaci jiného projektu.');
        return { id: String(row.id), name: row.title || String(row.id), raw: row };
      });
      if (this._projectConversations.get(key)?.request === request)
        this._projectConversations.set(key, { status: 'ready', items, error: '' });
    } catch (error) {
      if (this._projectConversations.get(key)?.request === request)
        this._projectConversations.set(key, { status: 'error', items: [], error: error.message || 'Načtení selhalo.' });
    }
    this.forceUpdate();
  }

  pOpenProjectConversation(item) {
    Promise.resolve(this.widget.openCatalogItem('Konverzace', item)).then(ok => {
      if (ok) this.setState({ mode: 'sessions' }); else this.forceUpdate();
    }).catch(error => { this.widget.catalogActionError = error.message || 'Konverzaci nelze otevřít.'; this.forceUpdate(); });
    return null;
  }

  pSelect(s, sec, id) {
    if (sec === 'projects' && id === '__new__') {
      this._projectWizardStatus = { busy: false, error: '', defaultDir: '', uncertain: false };
      this.loadProjectDefaults();
    } else if (sec === 'projects') { this.scmClient.load(id); this.loadProjectConversations(id); }
    if (sec === 'specialists' && id === '__new__') this._specialistWizardStatus = { busy: false, error: '', uncertain: false };
    else if (sec === 'specialists') this.loadSpecialistDetail(id);
    if (sec === 'expertises' && id === '__new__') this._expertiseWizardStatus = {
      busy: false, error: '', uncertain: false, preview: null, previewKey: '', testResult: null, testKey: '' };
    if (sec === 'workers' && id === '__new__') {
      this._workerWizardStatus = { busy: false, loading: false, error: '', uncertain: false,
        extensions: [], projects: [] };
      this.loadWorkerWizard();
    }
    if (sec === 'workers') this.loadWorkerDetail(id);
    if (sec === 'expertises') {
      const focused = this.widget.store.focusedSession();
      if (focused?._convId) this.expertiseSelection.load(focused);
    }
    if (sec === 'media') this.clearMediaOutputUrls(id === '__new__' ? '' : id);
    if (sec === 'media' && id === '__new__') this.loadMediaEnvironment();
    if (sec === 'media' && id !== '__new__') {
      const item = this.widget.catalog.view('Multimédia').items.find(row => row.id === id);
      if (item) this.loadMediaOutputs(item);
    }
    if (sec === 'settings' && id === 'system' && !this._developmentRequested) {
      this._developmentRequested = true; this.development.refresh();
    }
    if (sec === 'settings') {
      this.loadSettingsResource(id);
      if (id === 'uloziste') this.loadSettingsResource('uloziste:system');
      if (id === 'modely') this.loadSettingsResource('modely:prefs');
      if (id === 'modely') this.modelWorkspace.load();
      if (id === 'zabezpeceni') this.securityWorkspace.load();
    }
    if (CATALOG[sec] && this.widget.catalog.view(CATALOG[sec]).status === 'idle') this.widget.catalog.load(CATALOG[sec]);
    const patch = super.pSelect(s, sec, id);
    if (sec === 'expertises' && id === '__new__') return { ...patch,
      ...Object.fromEntries(Object.entries(this.defaults()).filter(([key]) => key.startsWith('expertise'))) };
    return patch;
  }

  scmPolicyVM(s, projectId) {
    const empty = { fields: [], remotes: [], remoteName: '', remoteHost: '', setRemoteName: () => {},
      setRemoteHost: () => {}, addRemote: () => {}, save: () => {}, hasError: false, error: '', disabled: true };
    if (!projectId) return empty;
    const entry = this.scmClient.entry(projectId);
    if (entry.status !== 'ready' || !entry.policy) return empty;
    let draft = this._policyDrafts.get(String(projectId));
    if (!draft || draft.revision !== entry.policy.revision) {
      draft = { ...entry.policy, remotes: entry.policy.remotes.map(item => ({ ...item })),
        remoteName: '', remoteHost: '', error: '' };
      this._policyDrafts.set(String(projectId), draft);
    }
    const labels = [['init', 'Inicializace'], ['commit', 'Commit'], ['branch', 'Větve'],
      ['fetch', 'Fetch'], ['pull', 'Pull (--ff-only)'], ['push', 'Push']];
    const update = patch => { Object.assign(draft, patch); this.forceUpdate(); };
    return { fields: labels.map(([key, label]) => ({ key, label, value: draft[key],
      options: (key === 'branch' || key === 'push' ? ['ask', 'disabled'] : ['ask', 'automatic', 'disabled'])
        .map(value => ({ value, label: this.polLabel(value) })),
      change: event => update({ [key]: event.target.value }) })),
      remotes: draft.remotes.map(item => ({ ...item, remove: () => update({ remotes: draft.remotes.filter(row => row.name !== item.name) }) })),
      remoteName: draft.remoteName, remoteHost: draft.remoteHost,
      setRemoteName: event => update({ remoteName: event.target.value }),
      setRemoteHost: event => update({ remoteHost: event.target.value }),
      addRemote: () => {
        const name = draft.remoteName.trim(), host = draft.remoteHost.trim().toLowerCase();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(name) || !/^[a-z0-9][a-z0-9.-]{0,252}$/.test(host)
          || draft.remotes.some(item => item.name === name)) return update({ error: 'Zadej jedinečný název remote a platný hostitel.' });
        update({ remotes: draft.remotes.concat([{ name, host }]), remoteName: '', remoteHost: '', error: '' });
      },
      save: async () => {
        const patch = Object.fromEntries(['init','commit','branch','fetch','pull','push','remotes'].map(key => [key, draft[key]]));
        const ok = await this.scmClient.setPolicy(projectId, patch);
        if (ok) this._policyDrafts.delete(String(projectId));
      },
      hasError: !!(draft.error || entry.error), error: draft.error || entry.error,
      disabled: entry.busy };
  }

  developmentVM() { return this.development.vm(); }

  modelWorkspaceVM() { return this.modelWorkspace.vm(); }

  feedbackVM() { return this.feedbackWorkspace.vm(); }

  securityVM(s) {
    const tab = s.dtab?.['settings:zabezpeceni'] || 'prehled';
    return { ...this.securityWorkspace.vm(tab), isAudit: tab === 'prehled',
      isAccess: tab === 'pristup', isSessions: tab === 'relace' };
  }

  preferencesVM(s) {
    const id = s.detail?.settings;
    const tab = (s.dtab || {})['settings:' + id] || 'prehled';
    const resource = this._settingsResources.get(id === 'modely' ? 'modely:prefs' : id), draft = this._preferenceDrafts.get(id) || {};
    const ready = resource?.status === 'ready';
    return { fields: fieldsFor(id, tab).map(definition => {
      const current = Object.hasOwn(draft, definition.key) ? draft[definition.key]
        : ready && resource.data[definition.key] !== undefined ? resource.data[definition.key] : definition.defaultValue;
      return { label: definition.label, value: String(current), checked: current === true,
        disabled: !ready || this._settingsBusy,
        isText: definition.type === 'text', isTextarea: definition.type === 'textarea',
        isNumber: definition.type === 'number', isToggle: definition.type === 'toggle',
        isTime: definition.type === 'time', isSelect: definition.type === 'select',
        min: definition.min || 0, max: definition.max || 0, step: definition.step || 1,
        options: (definition.options || []).map(value => ({ value, label: value })),
        change: event => this.changePreference(id, definition, definition.type === 'toggle'
          ? event.target.checked : event.target.value) };
    }), status: !ready ? resource?.status === 'error' ? resource.error : 'Načítám hodnoty z backendu…'
      : Object.keys(draft).length ? 'Změny nejsou uložené. Použij tlačítko Uložit změny.'
        : 'Hodnoty jsou načtené z backendu.' };
  }

  changePreference(id, definition, raw) {
    const resource = this._settingsResources.get(id === 'modely' ? 'modely:prefs' : id);
    if (resource?.status !== 'ready' || this._settingsBusy || !Object.values(SETTINGS_FIELDS[id] || {}).flat().includes(definition)) return false;
    const draft = { ...(this._preferenceDrafts.get(id) || {}) };
    const value = raw;
    const original = resource.data[definition.key] === undefined ? definition.defaultValue : resource.data[definition.key];
    if (String(value) === String(original)) delete draft[definition.key]; else draft[definition.key] = value;
    this._preferenceDrafts.set(id, draft);
    this._preferenceNotice.delete(id);
    this.forceUpdate();
    return true;
  }

  async savePreferences(id) {
    const key = id === 'modely' ? 'modely:prefs' : id;
    const resource = this._settingsResources.get(key), draft = this._preferenceDrafts.get(id) || {};
    if (resource?.status !== 'ready' || this._settingsBusy || !Object.keys(draft).length) return false;
    const definitions = Object.values(SETTINGS_FIELDS[id] || {}).flat();
    const patch = {};
    for (const [key, raw] of Object.entries(draft)) {
      const definition = definitions.find(item => item.key === key);
      const value = definition?.type === 'number' ? Number(raw) : raw;
      if (!definition || !validateValue(definition, value)) {
        this._preferenceNotice.set(id, 'Neplatná hodnota: ' + (definition?.label || key));
        this.forceUpdate(); return false;
      }
      patch[key] = value;
    }
    this._settingsBusy = true; this._preferenceNotice.delete(id); this.forceUpdate();
    try {
      const current = await this.widget.catalog.get('/api/settings');
      if (!current || typeof current !== 'object' || Array.isArray(current)
        || JSON.stringify(current) !== JSON.stringify(resource.data)) {
        throw Error('Nastavení se mezitím změnilo. Obnov stránku a zkontroluj změny.');
      }
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('Backend není dostupný.');
      const response = await this.fetchImpl(base + '/api/settings', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, ...patch }),
        signal: AbortSignal.timeout(10_000) });
      let result = {};
      try { result = await response.json(); } catch { /* HTTP status remains authoritative. */ }
      if (!response.ok || result.success !== true) throw Error(result.error || 'Uložení selhalo (HTTP ' + response.status + ').');
      await this.loadSettingsResource(key, true);
      const verified = this._settingsResources.get(key);
      if (verified?.status !== 'ready' || !Object.entries(patch).every(([key, value]) => verified.data[key] === value)) {
        throw Error('Zápis mohl proběhnout, ale čtením se nepodařilo ověřit. Před opakováním obnov stav.');
      }
      this._preferenceDrafts.delete(id);
      this._preferenceNotice.set(id, 'Změny byly ověřeny v backendu.');
      return true;
    } catch (error) {
      this._preferenceNotice.set(id, error?.message || 'Uložení nastavení selhalo.');
      return false;
    } finally { this._settingsBusy = false; this.forceUpdate(); }
  }

  pairingVM() {
    const pairing = this._pairing, claim = pairing.claim;
    return { scopes: PAIRING_SCOPES.map(name => ({ name, checked: pairing.selectedScopes.includes(name),
      disabled: pairing.status === 'loading' || !!claim, toggle: () => this.togglePairingScope(name) })),
      busy: pairing.status === 'loading', disabled: pairing.status === 'loading' || !!claim || !pairing.selectedScopes.length,
      issue: () => this.issuePairingClaim(), hasError: !!pairing.error, error: pairing.error,
      hasClaim: !!claim, code: claim?.claimCode || '',
      expiry: claim ? new Date(claim.expiresAt).toLocaleTimeString('cs-CZ') : '',
      uri: claim?.pairingUri || '', status: pairing.status === 'loading' ? 'Vytvářím jednorázový kód…'
        : claim ? 'Kód opiš do telefonu. Zůstává pouze v paměti tohoto okna.'
          : 'Kód se vydá jen z lokálně autentizovaného Studia; telefon se připojuje přes VPN.' };
  }

  togglePairingScope(name) {
    const pairing = this._pairing;
    if (!PAIRING_SCOPES.includes(name) || pairing.status === 'loading' || pairing.claim) return false;
    const scopes = new Set(pairing.selectedScopes);
    if (scopes.has(name)) scopes.delete(name); else scopes.add(name);
    pairing.selectedScopes = [...scopes].sort();
    pairing.error = '';
    this.forceUpdate();
    return true;
  }

  async issuePairingClaim() {
    const pairing = this._pairing;
    if (pairing.status === 'loading' || pairing.claim || !pairing.selectedScopes.length) return false;
    const requestedScopes = [...pairing.selectedScopes].sort();
    pairing.status = 'loading'; pairing.error = '';
    this.forceUpdate();
    try {
      const base = this.widget.catalog.backendUrl();
      if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw Error('backend-unavailable');
      const response = await this.fetchImpl(base + '/api/m7/remote/pairing/claims', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: requestedScopes }), signal: AbortSignal.timeout(10_000) });
      const payload = await response.json();
      if (!response.ok) throw Object.assign(Error('pairing-denied'), { code: payload?.code });
      const expected = ['claimCode', 'claimId', 'contract', 'expiresAt', 'pairingUri', 'scopes', 'subjectId', 'version'].sort();
      const expiresAtMs = Date.parse(payload?.expiresAt);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || JSON.stringify(Object.keys(payload).sort()) !== JSON.stringify(expected)
        || payload.contract !== 'M7LocalPairingClaim' || payload.version !== 1
        || !/^[A-Za-z0-9_-]{22}$/.test(payload.claimCode || '')
        || !/^pairing-claim:[A-Za-z0-9_-]{24}$/.test(payload.claimId || '')
        || payload.pairingUri !== 'intentsmith://pair?code=' + payload.claimCode
        || JSON.stringify(payload.scopes) !== JSON.stringify(requestedScopes)
        || typeof payload.subjectId !== 'string' || !payload.subjectId
        || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()
        || expiresAtMs - Date.now() > 300_000) throw Error('pairing-response-invalid');
      if (!this._pairingAlive) return false;
      pairing.claim = Object.freeze({ ...payload, scopes: Object.freeze([...payload.scopes]) });
      pairing.status = 'ready';
      this._pairingTimer = setTimeout(() => {
        pairing.claim = null; pairing.status = 'expired';
        pairing.error = 'Platnost párovacího kódu vypršela. Vytvoř nový.';
        this._pairingTimer = null; this.forceUpdate();
      }, Math.max(1, expiresAtMs - Date.now()));
      return true;
    } catch (error) {
      if (!this._pairingAlive) return false;
      pairing.status = 'error';
      pairing.error = error?.code === 'M7_LOCAL_PAIRING_NOT_ACTIVE'
        ? 'VPN runtime zatím není aktivní. Připoj VPN a spusť M7 službu.'
        : error?.code === 'M7_LOCAL_PAIRING_AUTH_REQUIRED'
          ? 'Párování lze vydat pouze z autentizovaného lokálního Studia.'
          : 'Párovací kód se nepodařilo bezpečně vytvořit.';
      return false;
    } finally { if (this._pairingAlive) this.forceUpdate(); }
  }

  runLearningCommand(session, text) {
    const chat = session.chat;
    const notify = (role, message, tag) => {
      if (this.widget.store.find(session.id) !== session) return;
      chat.msgs.push({ role, text: message, tag, ts: new Date().toISOString() });
      this.widget.store.changed();
    };
    if (chat._m4Busy) { notify('system', 'M4 learning požadavek už běží.', 'M4_ERROR'); return; }
    if (chat.attachments.length) {
      notify('system', 'M4 learning příkazy nepřijímají přílohy. Odeber je před pokračováním.', 'M4_ERROR');
      return;
    }
    const projectId = Number(session._projectId), conversationId = session._convId;
    if (!Number.isSafeInteger(projectId) || projectId < 1) {
      notify('system', 'M4 learning vyžaduje aktivní projekt s číselným ID.', 'M4_ERROR');
      return;
    }
    chat._m4Busy = true;
    chat._thinking = { text: 'M4 learning…', ts: Date.now() };
    notify('user', text, 'M4');
    Promise.resolve().then(() => runLearningCommand({ text, projectId,
      backendUrl: () => this.widget.catalog.backendUrl(), fetchImpl: this.fetchImpl,
      assertContext: () => {
        if (this.widget.store.find(session.id) !== session || session._projectId !== String(projectId)
          || session._convId !== conversationId) {
          throw Object.assign(new Error('Studio projekt nebo konverzace se během M4 požadavku změnily.'),
            { code: 'M4_STUDIO_CONTEXT_CHANGED' });
        }
      } })).then(result => { notify('assistant', result, 'M4'); }).catch(error => {
      notify('system', 'M4 chyba [' + (error?.code || 'M4_STUDIO_REQUEST_FAILED')
        + (error?.status ? ' HTTP ' + error.status : '') + ']: ' + (error?.message || String(error)), 'M4_ERROR');
    }).finally(() => {
      chat._m4Busy = false;
      chat._thinking = null;
      if (this.widget.store.find(session.id) === session) this.widget.store.changed();
    });
  }

  pSend(s, sid) {
    const session = this.widget.store.find(sid);
    if (!session) return null;
    const text = (s.drafts[sid] || '').trim();
    if (LEARNING_COMMANDS.has(text.split(/\s/, 1)[0])) {
      if (session.chat._m4Busy || session.chat._thinking || this.widget.transport?.hasActiveM1Turn?.(session)) return null;
      this.runLearningCommand(session, text);
      return { drafts: this.merge(s, 'drafts', { [sid]: '' }) };
    }
    const input = { value: s.drafts[sid] || '' };
    this.widget.send(session, input).then(() => {
      if (!input.value && this.widget.store.find(sid) === session && this.st().drafts[sid] === s.drafts[sid]) {
        this.setState({ drafts: this.merge(this.st(), 'drafts', { [sid]: '' }) });
      }
    }).catch(error => this.error(session, error));
    return null;
  }

  termKey(e, sid) {
    const session = this.widget.store.find(sid);
    if (!session || (e.key !== 'Tab' && e.key !== 'Enter')) return;
    e.preventDefault();
    const input = { value: this.st().cmds[sid] || '' };
    const action = e.key === 'Tab' ? this.widget.completeTerminal(session, input) : this.widget.sendTerminal(session, input);
    Promise.resolve(action).then(() => {
      if (this.widget.store.find(sid) === session) this.setState({ cmds: this.merge(this.st(), 'cmds', { [sid]: input.value }) });
    }).catch(error => this.error(session, error));
  }

  error(session, error) {
    session.chat._delivery = { status: 'ERROR', text: error?.message || 'Akce selhala.' };
    this.widget.store.changed();
  }

  sessFiles(sid, s) {
    const session = this.widget.store.find(sid);
    if (!session) return { edited: [], opened: [] };
    const seen = new Set();
    const edited = [];
    const pending = this.m2View(session);
    if (pending) for (const file of pending.diff) {
      const change = this.m2Change(file);
      edited.push({ path: change.path, add: change.add, del: change.del, st: 'navrženo',
        diff: change.lines, isNew: change.isNew });
      seen.add(change.path);
    }
    for (const path of session._modifiedFiles || []) {
      if (seen.has(path)) continue;
      seen.add(path);
      const count = session._fileChanges?.[path] || {};
      edited.push({ path, add: count.added || count.add || 0, del: count.removed || count.del || 0,
        st: 'zapsáno', diff: null, isNew: false });
    }
    const opened = [];
    for (const path of session._openedFiles || []) {
      if (!seen.has(path)) opened.push({ path, src: 'otevřel jsi', meta: '' });
      seen.add(path);
    }
    for (const path of session._focusFiles || []) {
      if (!seen.has(path)) opened.push({ path, src: 'četl agent', meta: '' });
      seen.add(path);
    }
    return { edited, opened };
  }

  fileContent(sid, s, path) {
    const session = this.widget.store.find(sid);
    const editor = session && this.widget.workspace.entry(session).editor;
    return editor?.path === path ? editor.original : '';
  }

  dirtyOf(sid) {
    const session = this.widget.store.find(sid);
    return !!(session && this.widget.workspace.entry(session).editor?.dirty);
  }

  async startFileAction(sid, op, path = '', directory = false) {
    const session = this.widget.store.find(sid);
    if (!session?._projectId) return;
    const workspace = this.widget.workspace.entry(session);
    const projectSessions = this.widget.store.state.sessions.filter(item => item._projectId === session._projectId);
    if (projectSessions.some(item => this.widget.workspace.entry(item).editor?.dirty)
      || workspace.saving || workspace.operationBusy || workspace.mutationUncertain) {
      workspace.error = workspace.mutationUncertain
        ? 'Nejprve obnov strom a ověř skutečný stav souborů.'
        : 'Nejprve ulož nebo zahoď neuložené změny v projektu.';
      this.forceUpdate(); return;
    }
    const action = { sid, op, path, to: op === 'rename' ? path : '', revision: '', directory,
      busy: ['rename', 'delete'].includes(op) };
    this.setState({ fileAction: action, fileActionNotice: '' });
    if (!action.busy) return;
    const entry = await this.widget.workspace.inspect(session, path);
    if (this.st().fileAction !== action) return;
    if (!entry) { this.setState({ fileAction: null }); return; }
    if (op === 'delete' && entry.protectedDescendants) {
      workspace.error = 'Složka obsahuje chráněné položky, odkazy nebo jiný disk. Odstraň je nejprve samostatně.';
      this.setState({ fileAction: null }); return;
    }
    this.setState({ fileAction: { ...action, revision: entry.revision,
      directory: entry.type === 'directory', entries: entry.entries, busy: false } });
  }

  async submitFileAction(sid) {
    const action = this.st().fileAction;
    const session = this.widget.store.find(sid);
    if (!session || !action || action.sid !== sid || action.busy) return;
    const { op, path, to, revision } = action;
    const valid = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/')
      && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\'));
    if (!valid(path) || op === 'rename' && (!valid(to) || to === path)) {
      this.setState({ fileActionNotice: 'Zadej platnou relativní cestu projektu.' }); return;
    }
    if (['rename', 'delete'].includes(op) && !revision) return;
    const pending = { ...action, busy: true };
    this.setState({ fileAction: pending, fileActionNotice: '' });
    const projectSessions = this.widget.store.state.sessions.filter(item => item._projectId === session._projectId);
    if (projectSessions.some(item => this.widget.workspace.entry(item).editor?.dirty)) {
      this.setState({ fileAction: { ...action, busy: false },
        fileActionNotice: 'Nejprve ulož nebo zahoď neuložené změny v projektu.' }); return;
    }
    const ok = await this.widget.workspace.operate(session, { op, path, to, expectedRevision: revision });
    if (this.widget.store.find(sid) !== session || this.st().fileAction !== pending) return;
    if (!ok) { this.setState({ fileAction: { ...action, busy: false } }); return; }
    const affects = value => value === path || value.startsWith(path + '/');
    const rewrite = value => op === 'rename' && affects(value) ? to + value.slice(path.length) : value;
    if (op === 'rename' || op === 'delete') {
      const views = { ...this.st().fileView };
      for (const item of projectSessions) {
        for (const key of ['_openedFiles', '_modifiedFiles', '_focusFiles']) {
          if (Array.isArray(item[key])) item[key] = item[key].filter(value => op !== 'delete' || !affects(value)).map(rewrite);
        }
        if (item._fileChanges && typeof item._fileChanges === 'object') {
          item._fileChanges = Object.fromEntries(Object.entries(item._fileChanges)
            .filter(([value]) => op !== 'delete' || !affects(value))
            .map(([value, count]) => [rewrite(value), count]));
        }
        const workspace = this.widget.workspace.entry(item);
        if (workspace.editor && affects(workspace.editor.path)) workspace.editor = null;
        if (views[item.id] && affects(views[item.id].path)) views[item.id] = null;
      }
      this.setState({ fileView: views });
    }
    await Promise.all(projectSessions.filter(item => item !== session).map(item => this.widget.workspace.loadTree(item)));
    const scm = this.scmClient.entry(session._projectId);
    const cancelled = scm.plan?.state === 'pending' ? await this.scmClient.cancel(session._projectId) : true;
    scm.plan = null; scm.next = null; scm.diffs.clear();
    const scmLoaded = await this.scmClient.load(session._projectId, { refresh: true });
    this.widget.store.changed();
    this.setState({ fileAction: null, fileActionNotice: scmLoaded && cancelled
      ? 'Operace provedena a ověřena.'
      : 'Souborová operace byla ověřena, ale stav gitu nebo jeho plán se nepodařilo obnovit. Před další git akcí obnov stav projektu.' });
  }

  filesVM(sid, s) {
    const vm = super.filesVM(sid, s);
    const session = sid && this.widget.store.find(sid);
    if (!session) return vm;
    const workspace = this.widget.workspace.entry(session);
    vm.canManage = vm.canManage && workspace.projectId === String(session._projectId) && !!workspace.root;
    vm.hasUncertain = !!workspace.mutationUncertain;
    vm.refresh = () => this.widget.workspace.refreshAfterUncertain(session)
      .catch(error => this.error(session, error));
    return vm;
  }

  pOpenFile(s, sid, next) {
    const session = this.widget.store.find(sid);
    if (!session) return null;
    const current = s.fileView[sid];
    const editor = this.widget.workspace.entry(session).editor;
    if (editor?.dirty && (!next || next.path !== editor.path)) return { fileGuard: { sid, next: next || null } };
    if (!next) return { fileView: this.merge(s, 'fileView', { [sid]: null }), fileGuard: null };
    if (editor?.path === next.path) return { fileView: this.merge(s, 'fileView', { [sid]: { path: next.path, from: next.from, staged: !!next.staged } }),
      fileMode: this.merge(s, 'fileMode', { [sid]: next.mode || 'nahled' }), rightTab: next.from, rightOpen: true, fileGuard: null };
    this.widget.workspace.open(session, next.path).then(ok => {
      // A deleted tracked file has no workspace contents, but its Git diff is still reviewable.
      if ((!ok && next.from !== 'scm') || this.widget.store.find(sid) !== session) return;
      this.setState({ fileView: this.merge(this.st(), 'fileView', { [sid]: { path: next.path, from: next.from, staged: !!next.staged } }),
        fileMode: this.merge(this.st(), 'fileMode', { [sid]: next.mode || 'nahled' }), rightTab: next.from, rightOpen: true, fileGuard: null });
    }).catch(error => this.error(session, error));
    return null;
  }

  pSaveFile(s, sid) {
    const session = this.widget.store.find(sid);
    if (session) this.widget.workspace.save(session).catch(error => this.error(session, error));
    return null;
  }

  pDiscardFile(s, sid) {
    const session = this.widget.store.find(sid);
    if (session) this.widget.workspace.discard(session);
    return null;
  }

  pResolveGuard(s, how) {
    const guard = s.fileGuard;
    if (!guard) return null;
    if (how === 'stay') return { fileGuard: null, fileMode: this.merge(s, 'fileMode', { [guard.sid]: 'upravy' }) };
    const session = this.widget.store.find(guard.sid);
    if (!session) return { fileGuard: null };
    if (how === 'discard') {
      this.widget.workspace.discard(session);
      return Object.assign({ fileGuard: null }, this.pOpenFile(Object.assign({}, s, { fileGuard: null }), guard.sid, guard.next));
    }
    this.widget.workspace.save(session).then(ok => {
      if (!ok || this.widget.store.find(guard.sid) !== session) return;
      const next = this.pOpenFile(this.st(), guard.sid, guard.next);
      this.setState(Object.assign({ fileGuard: null }, next || {}));
    }).catch(error => this.error(session, error));
    return null;
  }

  fileViewVM(sid, s, from) {
    const vm = super.fileViewVM(sid, s, from);
    const session = sid && this.widget.store.find(sid);
    const editor = session && this.widget.workspace.entry(session).editor;
    if (!vm.isOpen) return vm;
    if (!editor || vm.path !== editor.path) {
      if (from === 'scm') {
        vm.modes = vm.modes.map(mode => mode.label === 'Upravit'
          ? { ...mode, cls: 'off', pick: () => {} } : mode);
        vm.isEdit = false;
        vm.lines = [];
        vm.meta = 'Diff z gitu · pracovní soubor není otevřený';
      }
      return vm;
    }
    vm.draft = editor.draft;
    vm.dirty = editor.dirty;
    vm.setDraft = event => this.widget.workspace.edit(session, event.target.value);
    vm.save = () => this.widget.workspace.save(session).catch(error => this.error(session, error));
    vm.discard = () => this.widget.workspace.discard(session);
    vm.editKey = event => {
      if (event.key?.toLowerCase() === 's' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault(); vm.save();
      }
    };
    return vm;
  }

  m2Action(session, command) {
    const entry = this.widget.m2.entry(session);
    this.widget.m2.run(session, command, '', entry.view)
      .catch(error => this.widget.m2.report(session, error));
  }

  pApprove(s, sid, decision) {
    const session = this.widget.store.find(sid);
    if (!session || !pendingBinding(session._m2Pending)) return null;
    const entry = this.widget.m2.entry(session);
    if (decision === 'ok' && (!this.m2View(session) || entry.presentedView !== entry.view || entry.busy)) return null;
    this.m2Action(session, decision === 'ok' ? '/m2-approve' : '/m2-cancel');
    return null;
  }
  scmPrepare(projectId, op, args = {}, next = null) {
    this.scmClient.prepare(projectId, op, args, next);
    this.setState({ ctx: null, menu: null });
  }

  pScmCommit(s, projectId, options = {}) {
    const g = this.gitVM(s, projectId);
    if (!g?.repo) return null;
    const msg = (s.scm[projectId]?.msg || '').trim();
    if (!msg) return { scm: this.merge(s, 'scm', { [projectId]: { ...s.scm[projectId], hint: 'Napiš zprávu commitu.' } }) };
    if (!g.staged.length && !options.all) return { scm: this.merge(s, 'scm', { [projectId]: { ...s.scm[projectId], hint: 'Nejdřív připrav soubory nebo zvol Potvrdit vše.' } }) };
    this.scmPrepare(projectId, 'commit', { message: msg, all: !!options.all }, options.push ? { op: 'push' } : null);
    return null;
  }

  pScmRun(s, sid) {
    const session = sid && this.widget.store.find(sid);
    const projectId = session?._projectId;
    if (!projectId) return null;
    const entry = this.scmClient.entry(projectId);
    const op = entry.plan?.plan?.op;
    this.scmClient.execute(projectId).then(ok => {
      if (!ok) return;
      if (op === 'commit') {
        const state = this.st(), old = state.scm[projectId] || {};
        this.setState({ scm: this.merge(state, 'scm', { [projectId]: { ...old, msg: '', hint: '' } }) });
      }
      if (session && this.widget.store.find(session.id) === session) this.forceUpdate();
    });
    return null;
  }

  planVM(s, g, sid) {
    const off = { has: false, title: '', rows: [], blocked: false, reason: '', run: () => {}, cancel: () => {}, runLabel: '', canRun: false };
    if (!g) return off;
    const entry = this.scmClient.entry(g.pid), bound = entry.plan;
    if (!bound || bound.state !== 'pending' || String(bound.plan?.projectId) !== String(g.pid)) return off;
    const plan = bound.plan, args = plan.args || {};
    const details = [['Projekt', plan.root, true], ['Operace', plan.op, true],
      ['Digest plánu', bound.digest, true], ['Platí do', new Date(bound.expiresAt).toLocaleString('cs-CZ')]];
    if (args.message) details.push(['Zpráva', args.message]);
    if (args.paths) details.push(['Soubory', args.paths.join(', '), true]);
    if (args.name) details.push(['Větev', args.name, true]);
    if (plan.remote) details.push(['Remote a hostitel', plan.remote.name + ' · ' + plan.remote.host, true]);
    if (plan.op === 'pull') details.push(['Sloučení historie', 'jen --ff-only']);
    if (plan.op === 'push') details.push(['Force', 'nikdy']);
    details.push(['Hooky', 'vypnuté']);
    return { has: true, title: plan.op, rows: details.map(([k,v,mono]) => ({ k, v, cls: mono ? 'mono' : '' })),
      blocked: entry.busy, reason: entry.busy ? 'Operace právě probíhá.' : '',
      runLabel: 'Provést potvrzený plán', canRun: !entry.busy,
      run: () => this.pScmRun(this.st(), sid), cancel: () => this.scmClient.cancel(g.pid) };
  }

  fileDiff(sid, s, path) {
    if (s.fileView[sid]?.from === 'scm') {
      const projectId = this.widget.store.find(sid)?._projectId;
      if (!projectId) return null;
      const key = `${s.fileView[sid].staged ? 'staged' : 'unstaged'}|${path}`;
      const raw = this.scmClient.entry(projectId).diffs.get(key);
      if (typeof raw !== 'string' || !raw.trim()) return null;
      return raw.split('\n').filter(line => line.startsWith('@@') || /^[ +\-]/.test(line) && !/^(---|\+\+)/.test(line))
        .map(line => ({ k: line.startsWith('@@') ? 'hunk' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx',
          o: '', n: '', t: line.startsWith('@@') ? line : line.slice(1) }));
    }
    return this.sessFiles(sid, s).edited.find(item => item.path === path)?.diff || null;
  }

  wsVM(s, fsid) {
    const vm = super.wsVM(s, fsid);
    const session = fsid && this.widget.store.find(fsid);
    if (!session) return vm;
    const pending = pendingBinding(session._m2Pending);
    const entry = this.widget.m2.entry(session);
    const exact = this.m2View(session);
    vm.m2Pending = !!pending;
    vm.m2Digest = exact?.planDigest || pending?.planDigest || '';
    vm.m2Lifecycle = exact?.lifecycleId || pending?.lifecycleId || '';
    vm.m2Governance = exact?.audit?.governanceDecision?.verdict || '';
    vm.m2Error = entry.error || '';
    vm.m2HasError = !!entry.error;
    vm.m2Refresh = () => this.m2Action(session, '/m2-status');
    vm.approve = () => this.pApprove(this.st(), fsid, 'ok');
    vm.reject = () => this.pApprove(this.st(), fsid, 'no');
    if (pending && !exact) {
      vm.emptyTitle = 'Plán čeká na načtení';
      vm.emptyText = 'Načti trvalý stav a zkontroluj přesný plán před schválením.';
    }
    if (exact) {
      vm.m2Test = (exact.plan.focusedTest?.binary || '') + ' ' + JSON.stringify(exact.plan.focusedTest?.argv || []);
      vm.m2Git = exact.plan.gitCommit ? 'Git commit je součástí plánu' : 'Bez commitu';
      const width = (typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1600) / (Number(s.scale) / 100 || 1);
      const nav = s.navOpen ? s.navW : 62;
      const visible = s.rightPin || !s.col || width - nav - s.rightW - 12 >= this.colLayout(s).length * 360;
      if (s.rightTab === 'zmeny' && s.rightOpen && visible && vm.files.length === exact.diff.length) {
        vm.files.forEach(file => { file.open = true; });
        entry.presentedView = exact;
      }
    }
    return vm;
  }
  gitVM(s, projectId) {
    const entry = this.scmClient.entry(projectId);
    if (entry.status !== 'ready' || !entry.data || !entry.policy) return null;
    const source = entry.data;
    const project = this.proj(projectId);
    const out = { pid: projectId, projectName: project?.name || 'Projekt ' + projectId,
      repo: source.isRepo, policy: entry.policy, branch: source.branch || '',
      branches: (entry.branches?.branches || []).filter(item => !item.remote).map(item => item.name),
      remoteBranches: (entry.branches?.branches || []).filter(item => item.remote).map(item => item.name),
      upstream: source.upstream || '', ahead: source.ahead || 0, behind: source.behind || 0,
      fetched: source.fetchedAt ? new Date(source.fetchedAt).toLocaleString('cs-CZ') : '',
      remote: source.remote?.name || '', host: source.remote?.host || '', log: [],
      all: [], staged: [], changes: [], untracked: [], conflicts: [], laneBranch: '', baseBranch: source.branch || '' };
    for (const item of source.files || []) {
      const file = { path: item.path, staged: !!item.staged, isNew: !!item.untracked || item.x === 'A',
        add: item.added ?? 0, del: item.removed ?? 0 };
      out.all.push(file);
      if (item.conflicted) out.conflicts.push(file);
      else if (item.untracked) out.untracked.push(file);
      else {
        if (item.staged) out.staged.push({ ...file, add: item.stagedAdded ?? file.add, del: item.stagedRemoved ?? file.del });
        if (item.unstaged) out.changes.push({ ...file, staged: false, add: item.unstagedAdded ?? file.add, del: item.unstagedRemoved ?? file.del });
      }
    }
    out.log = (entry.log?.commits || []).map(item => [item.parents?.length > 1 ? 'm' : 'o',
      item.hash.slice(0, 7), item.subject, item.author, clock(item.time), item.refs || []]);
    return out;
  }

  scmVM(s, sid) {
    const session = sid && this.widget.store.find(sid);
    if (!session?._projectId) return super.scmVM(s, sid);
    const projectId = session._projectId, entry = this.scmClient.entry(projectId);
    if (entry.status !== 'ready') {
      const vm = super.scmVM(s, sid);
      vm.noProject = false; vm.unavailable = true;
      vm.unavailableText = entry.status === 'error' ? entry.error : 'Načítám skutečný stav projektu a politiku gitu…';
      return vm;
    }
    const vm = super.scmVM(s, sid);
    vm.unavailable = false;
    if (!vm.isRepo) {
      vm.init = () => this.scmPrepare(projectId, 'init');
      vm.plan = this.planVM(s, this.gitVM(s, projectId), sid);
      return vm;
    }
    const groups = { Konflikty: 'stage', Připravené: 'unstage', Změny: 'stage', Nesledované: 'stage' };
    for (const group of vm.groups) {
      const op = groups[group.label];
      group.rows.forEach(row => {
        row.act = () => this.scmPrepare(projectId, op, { paths: [row.path] });
        row.open = () => {
          const staged = group.label === 'Připravené';
          const next = { path: row.path, from: 'scm', mode: 'diff', staged };
          const change = this.pOpenFile(this.st(), sid, next);
          if (change) this.setState(change);
          if (group.label !== 'Nesledované') this.scmClient.diff(projectId, row.path, staged);
        };
      });
      group.all = () => this.scmPrepare(projectId, op, { paths: group.rows.map(row => row.path) });
    }
    vm.sync = () => this.scmPrepare(projectId, vm.behind ? 'pull' : 'push');
    vm.fetch = () => this.scmPrepare(projectId, 'fetch');
    vm.plan = this.planVM(s, this.gitVM(s, projectId), sid);
    vm.hasHint = !!(entry.error || vm.hint); vm.hint = entry.error || vm.hint;
    return vm;
  }

  msgVM(message, sid, state, session) {
    const vm = super.msgVM(message, sid, state, session);
    if (message.liveMarkdown) {
      try {
        const html = renderMarkdown(message.rawText);
        if (typeof html === 'string') { vm.hasMarkdown = true; vm.noMarkdown = false; vm.html = html; }
      } catch { /* Node and disconnected renderer fall back to escaped text. */ }
      vm.hasCopy = true;
      vm.copy = () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText)
          navigator.clipboard.writeText(message.rawText).catch(() => {});
      };
    }
    return vm;
  }

  menusVM(s, fsid) {
    const menus = super.menusVM(s, fsid);
    const disabled = new Set(['Importovat konverzaci…', 'Exportovat projekt…', 'Ukončit',
      'Znovu vygenerovat', 'Změnit model…', 'Dokumentace']);
    const session = fsid && this.widget.store.find(fsid);
    for (const menu of menus) for (const item of menu.items) {
      if (disabled.has(item.t)) { item.cls = 'dis'; item.go = () => {}; }
      if (item.t === 'Zastavit odpověď' && session) item.go = () => this.widget.transport?.cancel(session);
      if (item.t === 'Auto – změny se zapíšou hned' && session) item.go = () => {
        session.chat.editMode = 'auto'; this.widget.store.changed(); this.setState({ menu: null });
      };
      if (item.t === 'Kontrola – změny čekají na schválení' && session) item.go = () => {
        session.chat.editMode = 'ask'; this.widget.store.changed(); this.setState({ menu: null });
      };
      if (item.t === 'Vložit jako přílohu' && session) item.go = () => this.widget.pickAttachments(session).catch(error => this.error(session, error));
      if (item.t === 'Kopírovat poslední odpověď' && session) item.go = () => {
        const answer = [...session.chat.msgs].reverse().find(msg => msg.role === 'assistant');
        if (answer) navigator.clipboard.writeText(answer.text || '').catch(error => this.error(session, error));
      };
    }
    return menus;
  }

  ctxVM(s) {
    const vm = super.ctxVM(s);
    if (s.ctx?.sec === 'tab') {
      const sid = s.ctx.id;
      for (const item of vm.ctxItems) {
        if (item.t === 'Zavřít ostatní') item.go = this.run(() => this.closeTabsBeside(sid, 'others'));
        if (item.t === 'Zavřít vpravo') item.go = this.run(() => this.closeTabsBeside(sid, 'right'));
      }
    }
    if (s.ctx?.sec === 'branch') {
      const projectId = s.ctx.id;
      for (const item of vm.ctxItems) {
        if (!item.isItem) continue;
        if (item.t.startsWith('Nová větev')) {
          const name = (s.ctxQ || '').trim().replace(/\s+/g, '-') || 'work/nova-vetev';
          item.go = () => this.scmPrepare(projectId, 'branch.create', { name });
        } else if (this.gitVM(s, projectId)?.remoteBranches.includes(item.t)) {
          item.cls = 'dis'; item.go = () => {};
        } else if (item.t !== 'Žádná shoda' && item.t !== this.gitVM(s, projectId)?.branch) {
          const name = item.t; item.go = () => this.scmPrepare(projectId, 'checkout', { name });
        }
      }
    }
    if (s.ctx?.sec === 'chats') for (const item of vm.ctxItems) {
      const action = ({ 'Přejmenovat…': 'rename', 'Archivovat': 'archive', 'Smazat…': 'delete' })[item.t];
      if (action) item.go = () => { this.setState({ ctx: null }); this.conversationAction(s.ctx.id, action); };
    }
    const disabled = new Set(['Připnout', 'Duplikovat']);
    for (const item of vm.ctxItems) if (disabled.has(item.t)
      || s.ctx?.sec !== 'chats' && ['Přejmenovat…', 'Archivovat', 'Smazat…'].includes(item.t)) {
      item.cls = 'dis'; item.go = () => {};
    }
    return vm;
  }

  palVM(s, fsid) {
    const vm = super.palVM(s, fsid);
    for (const group of vm.pal) group.items = group.items.filter(item => item.t !== 'Změnit model');
    vm.palEmpty = vm.pal.every(group => group.items.length === 0);
    vm.palKey = event => {
      if (event.key === 'Escape') this.setState({ palette: false });
      if (event.key === 'Enter') {
        const first = vm.pal.flatMap(group => group.items)[0];
        if (first) { event.preventDefault(); first.go(); this.setState({ palette: false }); }
      }
    };
    return vm;
  }

  renderVals() {
    const vm = super.renderVals();
    const s = this.st();
    const lay = s.colSids;
    vm.columns.forEach((column, index) => {
      const session = this.widget.store.find(lay[index]);
      if (!session) return;
      const sid = session.id;
      column.n = session.number;
      column.focus = () => this.widget.store.focusColumn(index);
      column.closeCol = () => this.widget.store.closeColumn(index);
      column.setAuto = () => { session.chat.editMode = 'auto'; this.widget.store.changed(); };
      column.setRev = () => { session.chat.editMode = 'ask'; this.widget.store.changed(); };
      column.attach = () => this.widget.pickAttachments(session).catch(error => this.error(session, error));
      column.atts = session.chat.attachments.map((item, i) => ({ t: item.name, s: '', remove: () => {
        if (session.chat._preparing) return;
        session.chat.attachments.splice(i, 1); this.widget.store.changed();
      } }));
      column.hasAtts = column.atts.length > 0;
      column.hasAttachmentError = !!session.chat._attachmentError;
      column.attachmentError = session.chat._attachmentError || '';
      column.hasDelivery = !!session.chat._delivery;
      column.deliveryText = session.chat._delivery?.text || '';
      column.deliveryUnknown = session.chat._delivery?.status === 'DELIVERY_UNKNOWN';
      column.acknowledge = () => this.widget.transport?.acknowledgeUnknown(session);
      const auditTab = column.btabs.find(tab => tab.label === 'Audit');
      if (auditTab) {
        const openAudit = auditTab.go;
        auditTab.go = () => { openAudit(); this.loadAudit(session); };
      }
      column.hasModel = false; column.hasExpertPicker = false;
      column.msgs.forEach(message => {
        message.stop = () => this.widget.transport?.cancel(session);
        message.approve = () => {};
        message.reject = () => {};
      });
    });
    vm.tabs.forEach((tab, index) => { tab.n = this.widget.store.state.sessions[index]?.number || index + 1; });
    const focused = this.widget.store.focusedSession();
    vm.ws.fileError = focused ? this.widget.workspace.entry(focused).error || '' : '';
    vm.ws.hasFileError = !!vm.ws.fileError;
    Object.assign(vm.sb, this.statusClient.vm(this.widget.transport));
    return vm;
  }
}

module.exports = { LiveModel, LAYOUT_KEY };
