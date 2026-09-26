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

const CATALOG = Object.freeze({
  chats: 'Konverzace', projects: 'Projekty', specialists: 'Specialisté',
  expertises: 'Expertýzy', workers: 'Workeři', market: 'Obchod', media: 'Multimédia'
});
const LAYOUT_KEY = 'intentsmith-studio2-layout';
const LAYOUT_FIELDS = Object.freeze(['mode', 'section', 'navOpen', 'navPin', 'navW', 'navExp',
  'rightOpen', 'rightPin', 'rightW', 'rightTab', 'bottomOpen', 'bottomH', 'btab',
  'detailW', 'view', 'size', 'colFr', 'treeClosed']);

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
    this._workerDetails = new Map();
    this._mediaNotices = new Map();
    this._mediaEnvironment = { status: 'idle', available: false, models: [], error: '' };
    this._mediaSubmitting = false;
    this._mediaSubmitNotice = '';
    this._mediaOutputUrls = new Map();
    this._mediaBusListeners = [];
    this._audit = new Map();
    this._auditRequest = new Map();
    this._catalogBusy = new Set();
    this._settingsResources = new Map();
    this._settingsBusy = false;
    this._settingsNotice = '';
    this.fetchImpl = widget.fetchImpl || fetch;
  }

  componentDidMount() {
    super.componentDidMount();
    for (const [name, kind] of [['comfyui:progress', 'progress'], ['comfyui:complete', 'complete'],
      ['comfyui:error', 'error']]) {
      const listener = event => this.onMediaEvent(kind, event);
      IntentSmithBus.on(name, listener);
      this._mediaBusListeners.push([name, listener]);
    }
    for (const source of [this.widget.store, this.widget.catalog, this.widget.appearance]) {
      this._unlisten.push(source.subscribe(() => { if (source === this.widget.store) this.syncTrees(); this.forceUpdate(); }));
    }
    this.syncTrees();
    this.statusClient.start();
    if (this.state.mode === 'section' && CATALOG[this.state.section]) this.widget.catalog.load(CATALOG[this.state.section]);
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
    for (const [name, listener] of this._mediaBusListeners.splice(0)) IntentSmithBus.off(name, listener);
    for (const output of this._mediaOutputUrls.values()) if (output.url) URL.revokeObjectURL(output.url);
    this._mediaOutputUrls.clear();
    for (const unlisten of this._unlisten.splice(0)) unlisten();
    this.development.destroy();
    this.scmClient.destroy();
    this.statusClient.destroy();
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
      vm.hasPrimary = ['chats', 'projects', 'media'].includes(s.section);
      vm.primary = s.section === 'media' ? 'Nové generování'
        : s.section === 'projects' ? 'Nový projekt' : 'Nová konverzace';
      vm.onPrimary = this.run(s2 => s.section === 'media'
        ? this.pSelect(s2, 'media', '__new__') : s.section === 'projects'
          ? this.pSelect(s2, 'projects', '__new__') : this.pNewSession(s2, {}));
    }
    return vm;
  }

  detailVM(s) {
    const id = s.detail[s.section];
    if (!id) return null;
    if (s.section === 'media' && id === '__new__') return super.detailVM(s);
    if (s.section === 'projects' && id === '__new__') return super.detailVM(s);
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
    return { icon: this.sec(s.section).icon, tone: this.sec(s.section).tone,
      icls: '', title: entry.name, type: this.sec(s.section).label,
      idText: item ? item.id : '', hasStatus: false, status: '', stCls: '',
      hasPrimary: s.section === 'chats' || s.section === 'specialists',
      primaryLabel: s.section === 'chats' ? 'Otevřít jako relaci'
        : s.section === 'specialists' ? 'Nová konverzace se specialistou' : '',
      onPrimary: s.section === 'chats' ? this.run(state => this.pOpenSession(state, id))
        : s.section === 'specialists' ? this.run(state => this.pNewSession(state, { specialist: id })) : () => {},
      secondary: [],
      more: () => {}, hasTabs: false, tabs: [], hasDesc: !!entry.description || !!entry.desc,
      desc: entry.description || entry.desc || '', showProps: !!item,
      props: item ? [['ID', item.id, true], ['Stav', item.state || '—']] .map(row => ({ k: row[0], v: row[1], cls: row[2] ? 'mono' : '' })) : [],
      blocks: [this.blockVM({ kind: 'empty', text: 'Další akce této obrazovky zatím nejsou připojené.' })],
      hasRelated: false, related: [], development: this.developmentVM(s), scmPolicy: this.scmPolicyVM(s, null) };
  }

  settingsDetailVM(s, id) {
    const vm = super.detailVM(s);
    if (!vm) return null;
    if (id === 'vzhled' || id === 'system') return vm;
    const tab = (s.dtab || {})['settings:' + id] || 'prehled';
    const resource = this._settingsResources.get(id);
    const state = resource?.status || 'idle';
    const connectedTab = (id === 'prepinace' && (tab === 'prehled' || tab === 'obnoveni')) ||
      ((id === 'modely' || id === 'uloziste') && tab === 'prehled');
    const unavailable = 'Tato část nastavení zatím nemá připojené ovládání.';
    vm.hasDesc = false; vm.desc = ''; vm.showProps = false; vm.props = [];
    vm.hasPrimary = false; vm.primaryLabel = ''; vm.secondary = [];
    vm.hasRelated = false; vm.related = [];
    vm.status = !connectedTab ? 'nepřipojeno' : state === 'loading' ? 'načítání' : state === 'error' ? 'chyba' : state === 'ready' ? 'živá data' : 'nenačteno';
    vm.stCls = connectedTab && state === 'error' ? 'warn' : connectedTab && state === 'ready' ? 'ok' : 'idle';
    vm.hasStatus = true;
    if (connectedTab && state !== 'loading') vm.secondary = [{ label: 'Obnovit', icon: this.data().I.refresh,
      go: () => this.loadSettingsResource(id, true) }];
    if (id === 'prepinace' && tab === 'prehled') {
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
      const models = resource?.data?.models;
      const rows = state === 'ready' && Array.isArray(models) ? models.map(model => ({
        t: model.name, s: model.digest || '', m: model.size ? (model.size / 1024 ** 3).toFixed(2) + ' GiB' : '',
        icon: this.data().I.cpu, mono: true })) : [];
      vm.blocks = state === 'ready' ? [this.blockVM({ kind: 'rows', title: 'Modely z Ollamy', rows,
        empty: 'Ollama nevrátila žádný nainstalovaný model.' })] :
        [this.blockVM({ kind: 'empty', text: state === 'error' ? resource.error : 'Načítám modely z backendu…' })];
      vm.props = state === 'ready' ? [{ k: 'Model CHAT', v: resource.data.current_model || '—', cls: 'mono' },
        { k: 'Adresa Ollamy', v: resource.data.ollama_url || '—', cls: 'mono' }] : [];
      vm.showProps = vm.props.length > 0;
    } else if (id === 'uloziste' && tab === 'prehled') {
      vm.blocks = state === 'ready' ? [this.blockVM({ kind: 'rows', title: 'Uložené přílohy', rows: [
        { t: 'Velikost příloh', m: (resource.data.totalSize / 1024 ** 2).toFixed(2) + ' MiB', icon: this.data().I.drive }] })]
        : [this.blockVM({ kind: 'empty', text: state === 'error' ? resource.error : 'Načítám stav úložiště…' })];
    } else {
      vm.blocks = [this.blockVM({ kind: 'empty', text: unavailable })];
    }
    if (this._settingsNotice && id === 'prepinace') vm.blocks.unshift(this.blockVM({ kind: 'text', items: [this._settingsNotice] }));
    return vm;
  }

  async loadSettingsResource(id, refresh = false) {
    const paths = { prepinace: '/api/features', modely: '/api/system/models', uloziste: '/api/storage/info' };
    const path = paths[id];
    if (!path || !refresh && this._settingsResources.get(id)?.status === 'ready') return;
    const request = Symbol(id);
    this._settingsResources.set(id, { status: 'loading', request });
    this.forceUpdate();
    try {
      const data = await this.widget.catalog.get(path);
      if (id === 'prepinace' && (!data?.features || typeof data.features !== 'object' || Array.isArray(data.features)
        || Object.values(data.features).some(value => typeof value !== 'boolean'))) throw Error('Backend vrátil neplatné přepínače.');
      if (id === 'modely' && (!Array.isArray(data?.models) || data.models.some(model => typeof model.name !== 'string'))) throw Error('Backend vrátil neplatný seznam modelů.');
      if (id === 'uloziste' && (!Number.isFinite(data?.totalSize) || data.totalSize < 0)) throw Error('Backend vrátil neplatnou velikost úložiště.');
      if (this._settingsResources.get(id)?.request === request) this._settingsResources.set(id, { status: 'ready', data });
    } catch (error) {
      if (this._settingsResources.get(id)?.request === request) this._settingsResources.set(id, {
        status: 'error', error: error?.message || 'Načtení nastavení selhalo.' });
    } finally { this.forceUpdate(); }
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
      error: this._mediaSubmitNotice || this._mediaEnvironment.error };
  }

  projectStatus() { return this._projectWizardStatus; }

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
        ...(s.projectPath.trim() ? { path: s.projectPath.trim() } : {}) }
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
    if (this._mediaSubmitting || form.disabled || !['txt2img', 'txt2vid'].includes(s.mediaType)) return false;
    this._mediaSubmitting = true;
    this._mediaSubmitNotice = '';
    this.widget.catalogActionError = null;
    this.forceUpdate();
    try {
      const params = { width: s.mediaWidth, height: s.mediaHeight, steps: s.mediaSteps,
        cfg_scale: s.mediaCfg, seed: s.mediaSeed, model: form.model };
      if (s.mediaType === 'txt2vid') params.frames = s.mediaFrames;
      const result = await this.widget.catalog.mutate('/api/media/generate', 'POST', {
        type: s.mediaType, prompt: s.mediaPrompt.trim(), negative_prompt: s.mediaNegative.trim(), params
      }, 30000);
      if (!MEDIA_ID.test(result.generationId || '')) throw Error('Backend nevrátil platné ID generování. Zkontroluj historii.');
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
    if (session) this.widget.closeSession(session);
    return {};
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
    if (sec === 'workers') this.loadWorkerDetail(id);
    if (sec === 'media') this.clearMediaOutputUrls(id === '__new__' ? '' : id);
    if (sec === 'media' && id === '__new__') this.loadMediaEnvironment();
    if (sec === 'media' && id !== '__new__') {
      const item = this.widget.catalog.view('Multimédia').items.find(row => row.id === id);
      if (item) this.loadMediaOutputs(item);
    }
    if (sec === 'settings' && id === 'system' && !this._developmentRequested) {
      this._developmentRequested = true; this.development.refresh();
    }
    if (sec === 'settings') this.loadSettingsResource(id);
    if (CATALOG[sec] && this.widget.catalog.view(CATALOG[sec]).status === 'idle') this.widget.catalog.load(CATALOG[sec]);
    return super.pSelect(s, sec, id);
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

  pSend(s, sid) {
    const session = this.widget.store.find(sid);
    if (!session) return null;
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
    const disabled = new Set(['Připnout', 'Přejmenovat…', 'Duplikovat', 'Archivovat',
      'Smazat…', 'Zavřít ostatní', 'Zavřít vpravo', 'Nová konverzace se specialistou']);
    for (const item of vm.ctxItems) if (disabled.has(item.t)) {
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
