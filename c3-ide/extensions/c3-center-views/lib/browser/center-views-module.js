"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-center.css");
require("./styles/c3-pro-theme.css");
require("./styles/c3-multimedia.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");

// v63.0: Wizard modules
const { fetchSchema, fetchExpertises, fetchPreview, sendTestPrompt, saveExpertise, debounce } = require('./wizard/wizard-helpers');
const { renderBasicInfo } = require('./wizard/wizard-basic');
const { renderCapabilities } = require('./wizard/wizard-capabilities');
const { renderModules } = require('./wizard/wizard-modules');
const { renderPreview } = require('./wizard/wizard-preview');

const C3_CENTER_ID = 'c3-center-views';

/* ═══ SVG ═══ */
function ico(path, w = 13) {
  return React.createElement('span', {
    className: 'c3-icon',
    dangerouslySetInnerHTML: { __html: `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>` }
  });
}
const GRID_ICO = '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>';
const LIST_ICO = '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>';
const ZOOM_OUT = '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6"/>';
const ZOOM_IN = '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M8 11h6M11 8v6"/>';
const CHEV = '<path d="M6 9l6 6 6-6"/>';

/* ═══ Data (demo — will be replaced by backend) ═══ */
const DATA = {
  chats: [
    { id: 1, title: 'Pomoz s server.js', preview: 'Routing a CRE process...', time: 'dnes 14:32', icon: '💬' },
    { id: 2, title: 'Historie Československa', preview: '3 odstavce o vzniku ČSR', time: 'dnes 13:10', icon: '💬' },
    { id: 3, title: 'Flutter build debug', preview: 'APK gradle selhává', time: 'včera', icon: '💬' },
    { id: 4, title: 'DPH výpočet leden', preview: 'Faktury Q4, reverse charge', time: '9.2.', icon: '📊' },
    { id: 5, title: 'E2E test suite design', preview: '26 testů Q/A/B/C', time: '10.2.', icon: '💬' }
  ],
  projects: [
    { id: 1, title: 'Security Hardening', desc: '7-layer defense, shell security.', status: 'Active', pill: 'green', date: '10.2.' },
    { id: 2, title: 'E2E LLM Validation', desc: '26 testů, 23/26.', status: 'Done', pill: 'blue', date: '9.2.' },
    { id: 3, title: 'Účetní integrace', desc: 'Faktury, DPH.', status: 'Done', pill: 'blue', date: '7.2.' },
    { id: 4, title: 'Worker System v2', desc: 'Weather, reality, RSS.', status: 'WIP', pill: 'amber', date: '8.2.' }
  ],
  specialists: [
    { id: 1, title: 'Účetní specialista', desc: 'Faktury, DPH, účetnictví', emoji: '📊', fav: true }
  ],
  expertises: [
    { id: 1, title: 'Výchozí', desc: 'Univerzální AI', emoji: '🤖', fav: true },
    { id: 2, title: 'Účetní', desc: 'Faktury, DPH', emoji: '📊', fav: true },
    { id: 3, title: 'Developer', desc: 'Kód, debugging', emoji: '💻', fav: true },
    { id: 4, title: 'Copywriter', desc: 'Texty', emoji: '✍️' },
    { id: 5, title: 'Architekt', desc: 'Design', emoji: '📐' },
    { id: 6, title: 'Researcher', desc: 'Analýza', emoji: '🔍' },
    { id: 7, title: 'PM', desc: 'Projekty', emoji: '📋' },
    { id: 8, title: 'Designer', desc: 'UI/UX', emoji: '🎨' },
    { id: 9, title: 'Security', desc: 'Audit', emoji: '🛡️' }
  ],
  workers: [
    { id: 1, title: 'Weather Monitor', desc: 'Praha, Brno · */30 * * * *', status: 'Running', pill: 'green', date: '5min' },
    { id: 2, title: 'Realty Watcher', desc: 'Sreality · 0 */6 * * *', status: 'Running', pill: 'green', date: '2h' },
    { id: 3, title: 'News Digest', desc: 'iDNES, Aktuálně · 0 8 * * 1', status: 'Paused', pill: 'amber', date: '3d' }
  ]
};

/* ═══ Settings sections ═══ */
const SETTINGS = [
  { id: 'user', icon: '👤', title: 'Account / Identity' },
  { id: 'llm', icon: '🤖', title: 'LLM Settings' },
  { id: 'memory', icon: '🧠', title: 'Memory & Context' },
  { id: 'notif', icon: '🔔', title: 'Notifications' },
  { id: 'output', icon: '📄', title: 'Output & Formats' },
  { id: 'storage', icon: '💾', title: 'Storage' },
  { id: 'system', icon: '🖥️', title: 'System' },
  { id: 'appearance', icon: '🎨', title: 'Appearance' },
  { id: 'backup', icon: '📦', title: 'Backup & Sync' },
  { id: 'multimedia', icon: '🖼️', title: 'Multimedia (ComfyUI)' },
  { id: 'about', icon: 'ℹ️', title: 'About' }
];

/* ═══ CenterViewsWidget ═══ */
class C3CenterViewsWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = C3_CENTER_ID;
    this.title.label = 'C3 Views';
    this.title.caption = 'C3 Center Views';
    this.title.iconClass = 'codicon codicon-layout';
    this.title.closable = false;
    this.addClass('c3-center-widget');
    this.node.tabIndex = 0;
    this._view = 'chats';
    this._zoom = 1;
    this._openSections = { user: true };
    this._selectedItem = null;

    // v63.0: Wizard state
    this._wizardMode = null;      // null | 'create' | 'edit'
    this._wizardData = null;      // form data object
    this._wizardSchema = null;    // from GET /api/expertise-schema
    this._wizardPreview = null;   // cached preview from API
    this._wizardPreviewTimer = null;
    this._wizardTestResult = null;
    this._wizardTestLoading = false;
    this._wizardTestError = null;
    this._wizardExpertises = [];     // for parent picker
    this._wizardOpenSections = { basic: true };
    this._wizardEditId = null;    // original ID when editing

    this._debouncedPreview = debounce(() => this._fetchWizardPreview(), 500);

    // v130: Multimedia state
    this._mm = {
      status: 'idle',          // idle | preparing | generating | error
      comfyAvailable: false,
      type: 'txt2img',
      prompt: '',
      negativePrompt: '',
      params: { width: 1024, height: 1024, steps: 20, cfg_scale: 7.0, seed: -1 },
      models: [],
      selectedModel: '',
      progress: { percent: 0, text: '', step: 0, totalSteps: 0 },
      history: [],
      historyPage: 0,
      currentGenId: null,
      error: null,
      paramsExpanded: false,
      negExpanded: false,
      healthTimer: null,
      queueLength: 0,
    };

    // Pro theme: restore from localStorage
    try {
      if (localStorage.getItem('c3-theme-mode') === 'pro') {
        document.body.classList.add('theme-pro');
        if (!document.querySelector('.c3-pro-badge')) {
          var badge = document.createElement('div');
          badge.className = 'c3-pro-badge';
          badge.textContent = 'PRO';
          document.body.appendChild(badge);
        }
      }
    } catch(e) {}

    // Listen for sidebar navigation events
    document.addEventListener('c3-view-change', (e) => {
      this._view = e.detail.view;
      this._selectedItem = null;
      this._wizardMode = null;
      this.update();
    });

    // v63.0: Listen for wizard-open events from detail panel
    document.addEventListener('c3-wizard-open', (e) => {
      this._openWizard(e.detail.mode, e.detail.expertiseData);
    });

    // v130: ComfyUI WS event listeners
    const self = this;
    const _mmBusInit = setInterval(() => {
      if (typeof window.C3Bus === 'undefined') return;
      clearInterval(_mmBusInit);
      window.C3Bus.on('comfyui:progress', function(d) {
        self._mm.progress = { percent: d.percent || 0, text: d.text || '', step: d.step || 0, totalSteps: d.totalSteps || 0 };
        self._mm.status = 'generating';
        if (d.generationId) self._mm.currentGenId = d.generationId;
        self.update();
      });
      window.C3Bus.on('comfyui:complete', function(d) {
        self._mm.status = 'idle';
        self._mm.error = null;
        self._mm.queueLength = 0;
        self._mm.currentGenId = null;
        self._mmFetchHistory();
        self.update();
      });
      window.C3Bus.on('comfyui:error', function(d) {
        self._mm.status = 'idle';
        self._mm.error = d.error || 'Neznámá chyba';
        self._mm.currentGenId = null;
        self.update();
        setTimeout(() => { self._mm.error = null; self.update(); }, 10000);
      });
      window.C3Bus.on('vram:state', function(d) {
        self._mm.queueLength = d.queueLength || 0;
        if (d.busy && self._mm.status === 'idle') self._mm.status = 'preparing';
        if (!d.busy && self._mm.status === 'preparing') self._mm.status = 'idle';
        self.update();
      });
    }, 200);
  }

  render() {
    const h = React.createElement;
    const v = this._view;

    // v63.0: Wizard mode intercepts rendering
    if (this._wizardMode) return this._renderWizard(h);

    if (v === 'settings') return this._renderSettings(h);
    if (v === 'multimedia') return this._renderMultimedia(h);
    return h('div', { className: 'c3-cv' },
      this._renderBar(h, v),
      this._renderGrid(h, v)
    );
  }

  _renderBar(h, view) {
    const titles = { chats: 'Konverzace', projects: 'Projekty', specialists: 'Specialisté', expertises: 'Expertyzy', workers: 'Workeri', multimedia: 'Multimedia' };
    return h('div', { className: 'c3-view-bar' },
      h('h2', null, titles[view] || view),
      // v63.0: New expertise button
      view === 'expertises' && h('button', {
        className: 'c3-btn-new',
        onClick: () => this._openWizard('create', null),
      }, '+ Nová expertyza'),
      h('div', { style: { flex: 1 } }),
      h('div', { className: 'c3-zoom' },
        ico(ZOOM_OUT),
        h('input', { type: 'range', min: 0, max: 2, value: this._zoom,
          onChange: (e) => { this._zoom = parseInt(e.target.value); this.update(); }
        }),
        ico(ZOOM_IN)
      ),
      h('div', { className: 'c3-view-toggle' },
        h('button', { className: 'active' }, ico(GRID_ICO)),
        h('button', null, ico(LIST_ICO))
      )
    );
  }

  _renderGrid(h, view) {
    const items = DATA[view] || [];
    return h('div', { className: 'c3-grid', 'data-zoom': this._zoom },
      items.map(item => {
        if (view === 'chats') return this._renderChatCard(h, item);
        if (view === 'expertises' || view === 'specialists') return this._renderExpertiseCard(h, item);
        return this._renderProjectCard(h, item);
      })
    );
  }

  _renderChatCard(h, item) {
    return h('div', {
      key: item.id,
      className: 'c3-card c3-card-conv' + (this._selectedItem === item.id ? ' selected' : ''),
      onClick: () => this._selectItem(item.id, 'chat', item)
    },
      h('div', { className: 'c3-conv-ava' }, item.icon),
      h('div', { className: 'c3-conv-body' },
        h('h4', null, item.title),
        h('p', null, item.preview)
      ),
      h('span', { className: 'c3-conv-time' }, item.time)
    );
  }

  _renderProjectCard(h, item) {
    return h('div', {
      key: item.id,
      className: 'c3-card' + (this._selectedItem === item.id ? ' selected' : ''),
      onClick: () => this._selectItem(item.id, 'project', item)
    },
      h('h4', null, item.title),
      h('p', null, item.desc),
      h('div', { className: 'c3-card-foot' },
        h('span', { className: 'c3-pill c3-pill-' + item.pill }, item.status),
        h('span', { className: 'c3-card-date' }, item.date)
      )
    );
  }

  _renderExpertiseCard(h, item) {
    return h('div', {
      key: item.id,
      className: 'c3-card c3-card-expertise' + (item.fav ? ' favorite' : '') + (this._selectedItem === item.id ? ' selected' : ''),
      onClick: () => this._selectItem(item.id, 'expertise', item)
    },
      h('span', { className: 'c3-expertise-emo' }, item.emoji),
      h('div', null,
        h('h4', null, item.title),
        h('p', { style: { margin: 0 } }, item.desc)
      ),
      h('span', { className: 'star' }, item.fav ? '★' : '☆')
    );
  }

  _renderSettings(h) {
    return h('div', { className: 'c3-cv' },
      h('div', { className: 'c3-settings-scroll' },
        h('div', { className: 'c3-settings-page' },
          h('h1', null, '⚙️ Nastavení'),
          h('p', { className: 'c3-settings-sub' }, 'Konfigurace C3 Studia'),
          SETTINGS.map(sec =>
            h('div', { key: sec.id, className: 'c3-sec' + (this._openSections[sec.id] ? ' open' : '') },
              h('div', { className: 'c3-sec-head', onClick: () => {
                this._openSections[sec.id] = !this._openSections[sec.id];
                this.update();
              }},
                h('span', { className: 'c3-sec-icon' }, sec.icon),
                h('span', { className: 'c3-sec-title' }, sec.title),
                ico(CHEV)
              ),
              this._openSections[sec.id] && h('div', { className: 'c3-sec-body' },
                this._renderSettingsContent(h, sec.id)
              )
            )
          )
        )
      )
    );
  }

  _renderSettingsContent(h, secId) {
    const _sync = (key, val) => {
      try {
        const ws = window.C3WS;
        if (ws && typeof ws.syncSettings === 'function' && ws.isReady()) {
          ws.syncSettings({ [key]: val });
        }
      } catch (_) {}
    };
    const _tog = (key, label, def = true) => h('div', { key, className: 'c3-toggle-row' },
      h('input', { type: 'checkbox', defaultChecked: def, className: 'c3-toggle',
        onChange: (e) => _sync(key, e.target.checked)
      }),
      h('span', { className: 'c3-toggle-label' }, label)
    );
    const _inp = (key, label, def, type = 'text', extra = {}) => [
      h('label', { key: key + '-l', className: 'c3-label' }, label),
      h('input', { key: key + '-i', className: 'c3-input', type, defaultValue: def,
        onBlur: (e) => _sync(key, type === 'number' ? Number(e.target.value) : e.target.value), ...extra })
    ];
    const _sel = (key, label, options, def) => [
      h('label', { key: key + '-l', className: 'c3-label' }, label),
      h('select', { key: key + '-s', className: 'c3-select', defaultValue: def,
        onChange: (e) => _sync(key, e.target.value) },
        options.map(o => h('option', { key: o.value || o, value: o.value || o }, o.label || o))
      )
    ];
    const _range = (key, label, def, min, max, step = 1, unit = '') => [
      h('label', { key: key + '-l', className: 'c3-label' }, label),
      h('div', { key: key + '-r', className: 'c3-range-row' },
        h('input', { type: 'range', className: 'c3-range', min, max, step, defaultValue: def,
          onInput: (e) => {
            const span = e.target.parentElement.querySelector('.c3-range-val');
            if (span) span.textContent = e.target.value + unit;
          },
          onChange: (e) => _sync(key, Number(e.target.value))
        }),
        h('span', { className: 'c3-range-val' }, def + unit)
      )
    ];

    switch (secId) {
      // ═══ Account / Identity ═══
      case 'user': return [
        ..._inp('c3.account.displayName', 'Jméno', 'Belfik'),
        ..._inp('c3.account.description', 'Popis', '', 'text', { placeholder: 'Krátký popis pro personalizaci...' }),
        ..._sel('c3.account.timezone', 'Časové pásmo', [
          { value: 'Europe/Prague', label: 'Europe/Prague (CET)' },
          { value: 'Europe/London', label: 'Europe/London (GMT)' },
          { value: 'America/New_York', label: 'America/New_York (EST)' },
          { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
        ], 'Europe/Prague'),
        ..._sel('c3.account.currency', 'Měna', [
          { value: 'CZK', label: 'CZK (Kč)' },
          { value: 'EUR', label: 'EUR (€)' },
          { value: 'USD', label: 'USD ($)' },
          { value: 'GBP', label: 'GBP (£)' },
        ], 'CZK'),
        ..._sel('c3.language', 'Jazyk rozhraní', [
          { value: 'cs', label: 'Čeština' },
          { value: 'en', label: 'English' },
        ], 'cs'),
      ];

      // ═══ LLM Settings ═══
      case 'llm': {
        // GPU info card — fetched dynamically
        const gpuCard = h('div', { key: 'gpu-card', className: 'c3-gpu-card' },
          h('div', { className: 'c3-gpu-card-head' },
            h('span', { className: 'c3-gpu-icon' }, '🎮'),
            h('span', null, 'GPU Detection')
          ),
          h('div', { className: 'c3-gpu-card-body', id: 'c3-gpu-info' },
            h('p', { className: 'c3-gpu-loading' }, 'Detecting GPU...')
          ),
          h('button', { className: 'c3-btn-sm', onClick: () => this._fetchGpuInfo() }, 'Refresh')
        );
        // Trigger initial GPU fetch
        setTimeout(() => this._fetchGpuInfo(), 100);

        return [
          gpuCard,
          h('h4', { key: 'llm-models', className: 'c3-settings-h4' }, 'Models'),
          ..._inp('c3.llm.ollamaUrl', 'Ollama URL', 'http://127.0.0.1:11434'),
          h('label', { key: 'chat-m-l', className: 'c3-label' }, 'Chat model'),
          h('select', { key: 'chat-m-s', className: 'c3-select', id: 'c3-llm-chat-model', defaultValue: 'qwen3.5:27b',
            onChange: (e) => _sync('c3.llm.chatModel', e.target.value)
          },
            h('option', { value: 'qwen3.5:27b' }, 'qwen3.5:27b'),
            h('option', { value: 'qwen3.5:14b' }, 'qwen3.5:14b'),
            h('option', { value: 'qwen3.5:7b' }, 'qwen3.5:7b'),
            h('option', { value: 'qwen3.5:3b' }, 'qwen3.5:3b')
          ),
          h('label', { key: 'code-m-l', className: 'c3-label' }, 'Code model'),
          h('select', { key: 'code-m-s', className: 'c3-select', defaultValue: 'qwen3.5:27b',
            onChange: (e) => _sync('c3.llm.codeModel', e.target.value)
          },
            h('option', { value: 'qwen3.5:27b' }, 'qwen3.5:27b'),
            h('option', { value: 'qwen3.5:14b' }, 'qwen3.5:14b'),
            h('option', { value: 'qwen3.5:7b' }, 'qwen3.5:7b')
          ),
          h('button', { key: 'load-models', className: 'c3-btn-sm c3-mt-8', onClick: () => this._loadOllamaModels() }, 'Load from Ollama'),

          h('h4', { key: 'llm-params', className: 'c3-settings-h4' }, 'Parameters'),
          ..._range('c3.llm.temperature', 'Temperature', 0.7, 0, 2, 0.1),
          ..._inp('c3.llm.contextWindow', 'Context window (tokens)', '32768', 'number', { min: 2048, max: 131072, step: 1024 }),
          ..._inp('c3.llm.timeoutChat', 'Chat timeout (ms)', '90000', 'number', { min: 10000, max: 300000, step: 5000 }),
          ..._inp('c3.llm.timeoutCode', 'Code timeout (ms)', '90000', 'number', { min: 10000, max: 300000, step: 5000 }),
          ..._range('c3.llm.numGpu', 'GPU layers', -1, -1, 8, 1, ''),
          h('p', { key: 'gpu-hint', className: 'c3-hint' }, '-1 = auto · 0 = CPU only'),
        ];
      }

      // ═══ Memory & Context ═══
      case 'memory': return [
        h('h4', { key: 'mem-conv', className: 'c3-settings-h4' }, 'Conversation Memory'),
        ..._inp('c3.memory.conversationMaxTurns', 'Max turns', '500', 'number', { min: 50, max: 5000 }),
        ..._range('c3.memory.compactThreshold', 'Compact threshold', 0.75, 0.3, 0.95, 0.05, ''),
        ..._inp('c3.memory.compactKeepTurns', 'Keep turns (after compact)', '6', 'number', { min: 2, max: 20 }),

        h('h4', { key: 'mem-ltm', className: 'c3-settings-h4' }, 'Long-Term Memory (LTM)'),
        _tog('c3.memory.ltmEnabled', 'Povolit dlouhodobou paměť', true),
        ..._inp('c3.memory.ltmMaxEntries', 'Max entries', '1000', 'number', { min: 100, max: 10000 }),
        ..._inp('c3.memory.ltmDecayHalfLife', 'Decay half-life (days)', '69', 'number', { min: 7, max: 365 }),

        h('h4', { key: 'mem-ctx', className: 'c3-settings-h4' }, 'Context Budget'),
        ..._range('c3.memory.contextBudgetChat', 'Chat budget', 60, 10, 90, 5, '%'),
        ..._range('c3.memory.contextBudgetCode', 'Code budget', 40, 10, 90, 5, '%'),
        ..._inp('c3.memory.contextBudgetMaxTokens', 'Hard cap (tokens)', '24576', 'number', { min: 2048, max: 65536, step: 1024 }),
        h('p', { key: 'cap-hint', className: 'c3-hint' }, 'Absolutní limit — ani vysoké procento nepřekročí tento cap.'),

        h('h4', { key: 'mem-learn', className: 'c3-settings-h4' }, 'Learning & Adaptation'),
        _tog('c3.memory.learningEnabled', 'Učení z preferencí', true),
        _tog('c3.memory.feedbackDetection', 'Detekce zpětné vazby', true),
        _tog('c3.memory.patternTracking', 'Sledování vzorců', true),

        h('h4', { key: 'mem-feat', className: 'c3-settings-h4' }, 'Feature Toggles'),
        _tog('c3.features.skills', 'Systém skillů (automatické opakující se postupy)', true),
        h('label', { key: 'al', className: 'c3-label' }, 'Agent Log verbosity'),
        h('div', { key: 'ald', className: 'c3-radios' },
          [{ v: 'minimal', l: 'Minimální' }, { v: 'normal', l: 'Normální' }, { v: 'verbose', l: 'Podrobný' }].map(r =>
            h('label', { key: r.v, className: 'c3-radio' },
              h('input', { type: 'radio', name: 'agentVerbosity', defaultChecked: r.v === 'normal',
                onChange: () => _sync('c3.agent.verbosity', r.v)
              }), ' ', r.l
            )
          )
        ),
      ];

      // ═══ Output & Formats ═══
      case 'output': return [
        _tog('c3.output.codeBlocks', 'Code blocks ve výstupu', true),
        _tog('c3.output.syntaxHighlight', 'Zvýrazňování syntaxe', true),
        _tog('c3.output.markdownRendering', 'Markdown rendering', true),
        ..._inp('c3.output.maxResponseLength', 'Max response length (tokens)', '8192', 'number', { min: 1024, max: 65536 }),
      ];

      // ═══ System ═══
      case 'system':
        setTimeout(() => this._fetchSystemInfo(), 100);
        return [
        ..._sel('c3.system.logLevel', 'Log level', [
          { value: 'debug', label: 'Debug' },
          { value: 'info', label: 'Info' },
          { value: 'warn', label: 'Warning' },
          { value: 'error', label: 'Error' },
        ], 'info'),
        ..._inp('c3.system.logRetentionDays', 'Retence logů (dny)', '30', 'number', { min: 7, max: 365 }),
        ..._inp('c3.system.maxFileSize', 'Max file size (bytes)', '1048576', 'number', { min: 102400, max: 10485760 }),
        ..._inp('c3.system.rateLimit', 'Rate limit (req/min)', '120', 'number', { min: 10, max: 1000 }),

        h('h4', { key: 'sys-diag', className: 'c3-settings-h4' }, 'Diagnostics'),
        h('div', { key: 'sys-info', className: 'c3-sys-info', id: 'c3-sys-info' },
          h('p', { className: 'c3-gpu-loading' }, 'Loading system info...')
        ),
        h('div', { key: 'sys-actions', className: 'c3-sys-actions' },
          h('button', { className: 'c3-btn-sm', onClick: () => this._fetchSystemInfo() }, 'Refresh'),
          h('button', { className: 'c3-btn-sm c3-btn-danger', onClick: () => this._vacuumDb() }, 'Vacuum DB'),
        ),
      ];

      // ═══ Appearance ═══
      case 'appearance': return [
        ..._sel('c3.theme', 'Barevné schéma', [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ], 'dark'),
        ..._range('c3.chat.fontSize', 'Velikost písma (chat)', 14, 10, 24, 1, 'px'),
        ..._sel('c3.appearance.density', 'Density', [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
          { value: 'minimal', label: 'Minimal' },
        ], 'comfortable'),
        ..._sel('c3.appearance.uiScale', 'UI Scale', [
          { value: '1.0', label: '100%' },
          { value: '1.1', label: '110%' },
          { value: '1.25', label: '125%' },
        ], '1.0'),

        h('h4', { key: 'app-vis', className: 'c3-settings-h4' }, 'Viditelnost'),
        _tog('c3.chat.showTimestamps', 'Časové značky u zpráv', false),
        _tog('c3.chat.showIntentBadges', 'Intent badges (DESIGN, BUILD, ...)', true),
        _tog('c3.agent.showTokenCounts', 'Token counts u LLM volání', false),
        _tog('c3.agent.autoScroll', 'Auto-scroll Agent Log', true),
      ];

      // ═══ Notifications ═══
      case 'notif':
        setTimeout(() => this._fetchNotifChannels(), 100);
        return [
          h('p', { key: 'nd', className: 'c3-hint' }, 'Kanály pro doručování notifikací z workerů a agentů.'),
          h('div', { key: 'notif-channels', className: 'c3-notif-channels', id: 'c3-notif-channels' },
            h('p', { className: 'c3-gpu-loading' }, 'Loading channels...')
          ),

          h('h4', { key: 'notif-email', className: 'c3-settings-h4' }, 'Email'),
          ..._inp('c3.notif.emailSmtp', 'SMTP server', '', 'text', { placeholder: 'smtp.gmail.com' }),
          ..._inp('c3.notif.emailFrom', 'From address', '', 'text', { placeholder: 'c3@example.com' }),
          ..._inp('c3.notif.emailTo', 'Recipient', '', 'text', { placeholder: 'user@example.com' }),
          h('button', { key: 'test-email', className: 'c3-btn-sm c3-mt-8', onClick: () => this._testNotifChannel('email') }, 'Test Email'),

          h('h4', { key: 'notif-tg', className: 'c3-settings-h4' }, 'Telegram'),
          ..._inp('c3.notif.telegramToken', 'Bot token', '', 'text', { placeholder: 'bot123:ABC...' }),
          ..._inp('c3.notif.telegramChatId', 'Chat ID', '', 'text', { placeholder: '-100123456789' }),
          h('button', { key: 'test-tg', className: 'c3-btn-sm c3-mt-8', onClick: () => this._testNotifChannel('telegram') }, 'Test Telegram'),

          h('h4', { key: 'notif-wh', className: 'c3-settings-h4' }, 'Webhook (HMAC)'),
          ..._inp('c3.notif.webhookUrl', 'URL', '', 'text', { placeholder: 'https://hooks.example.com/c3' }),
          ..._inp('c3.notif.webhookSecret', 'HMAC secret', '', 'password', { placeholder: 'your-secret-key' }),
          h('p', { key: 'wh-hint', className: 'c3-hint' }, 'Header: X-C3-Signature: sha256=<hmac>'),
          h('button', { key: 'test-wh', className: 'c3-btn-sm c3-mt-8', onClick: () => this._testNotifChannel('webhook') }, 'Test Webhook'),

          h('h4', { key: 'notif-ntfy', className: 'c3-settings-h4' }, 'ntfy.sh'),
          ..._inp('c3.notif.ntfyUrl', 'Server URL', 'https://ntfy.sh'),
          ..._inp('c3.notif.ntfyTopic', 'Topic', '', 'text', { placeholder: 'c3-notifications' }),
          h('button', { key: 'test-ntfy', className: 'c3-btn-sm c3-mt-8', onClick: () => this._testNotifChannel('ntfy') }, 'Test ntfy'),

          h('h4', { key: 'notif-desktop', className: 'c3-settings-h4' }, 'Desktop'),
          _tog('c3.notif.desktopEnabled', 'Systémové notifikace (Electron)', true),

          h('h4', { key: 'notif-quiet', className: 'c3-settings-h4' }, 'Tichý režim'),
          _tog('c3.notif.quietEnabled', 'Povolit tichý režim', false),
          ..._inp('c3.notif.quietFrom', 'Od', '22:00', 'time'),
          ..._inp('c3.notif.quietTo', 'Do', '07:00', 'time'),
          h('p', { key: 'quiet-hint', className: 'c3-hint' }, 'ERROR notifikace projdou i v tichém režimu.'),
        ];

      // ═══ Storage ═══
      case 'storage':
        setTimeout(() => this._fetchStorageInfo(), 100);
        return [
          h('div', { key: 'stor-info', className: 'c3-sys-info', id: 'c3-storage-info' },
            h('p', { className: 'c3-gpu-loading' }, 'Loading storage info...')
          ),
          h('h4', { key: 'stor-clean', className: 'c3-settings-h4' }, 'Cleanup'),
          h('div', { key: 'stor-actions', className: 'c3-sys-actions' },
            h('button', { className: 'c3-btn-sm', onClick: () => this._vacuumDb().then(() => this._fetchStorageInfo()) }, 'Vacuum DB'),
            h('button', { className: 'c3-btn-sm', onClick: () => this._pruneOldData() }, 'Prune Old Data'),
          ),
          h('p', { key: 'stor-hint', className: 'c3-hint' }, 'Vacuum komprimuje databázi. Prune smaže archivované konverzace starší 180 dní.'),
        ];

      // ═══ Backup & Sync ═══
      case 'backup': return [
        h('p', { key: 'bk-desc', className: 'c3-hint' }, 'Export a import nastavení, konverzací a LTM dat.'),
        h('h4', { key: 'bk-export', className: 'c3-settings-h4' }, 'Export'),
        h('div', { key: 'bk-exp-btns', className: 'c3-sys-actions' },
          h('button', { className: 'c3-btn-sm', onClick: () => this._exportSettings() }, 'Export Settings (JSON)'),
          h('button', { className: 'c3-btn-sm', onClick: () => this._exportAll() }, 'Export All (ZIP)'),
        ),
        h('h4', { key: 'bk-import', className: 'c3-settings-h4' }, 'Import'),
        h('div', { key: 'bk-imp-btns', className: 'c3-sys-actions' },
          h('button', { className: 'c3-btn-sm', onClick: () => this._importSettings() }, 'Import Settings'),
        ),
        h('p', { key: 'bk-warn', className: 'c3-hint' }, 'Import přepíše aktuální nastavení. Doporučujeme nejdříve exportovat zálohu.'),
      ];

      // ═══ About ═══
      case 'about': return [
        h('div', { key: 'a', className: 'c3-about' },
          h('div', { className: 'c3-about-logo' }, 'C3'),
          h('p', { className: 'c3-about-ver' }, 'v87.2.0'),
          h('p', { className: 'c3-about-sub' }, 'p(AI)assistant · Local LLM Runtime'),
          h('p', { className: 'c3-about-cr' }, 'Made with care by Belfik')
        )
      ];

      // ═══ Multimedia (ComfyUI) ═══
      case 'multimedia':
        setTimeout(() => this._mmFetchSettingsHealth(), 100);
        return [
          // Connection
          h('h4', { key: 'mm-conn', className: 'c3-settings-h4' }, 'Připojení'),
          ..._inp('c3.comfyui.baseUrl', 'ComfyUI URL', 'http://127.0.0.1:8188'),
          h('div', { key: 'mm-health', className: 'c3-sys-info', id: 'c3-mm-settings-health' },
            h('p', { className: 'c3-gpu-loading' }, 'Zjišťuji stav ComfyUI...')
          ),
          h('button', { key: 'mm-test', className: 'c3-btn-sm c3-mt-8', onClick: () => this._mmFetchSettingsHealth() }, 'Test připojení'),

          // Generation defaults
          h('h4', { key: 'mm-defaults', className: 'c3-settings-h4' }, 'Výchozí parametry'),
          ..._inp('c3.comfyui.defaultWidth', 'Šířka (px)', '1024', 'number', { min: 64, max: 4096, step: 8 }),
          ..._inp('c3.comfyui.defaultHeight', 'Výška (px)', '1024', 'number', { min: 64, max: 4096, step: 8 }),
          ..._range('c3.comfyui.defaultSteps', 'Kroky', 20, 1, 150, 1, ''),
          ..._range('c3.comfyui.defaultCfg', 'CFG Scale', 7.0, 0, 30, 0.5, ''),
          ..._sel('c3.comfyui.defaultSampler', 'Sampler', [
            { value: 'euler', label: 'Euler' },
            { value: 'euler_ancestral', label: 'Euler Ancestral' },
            { value: 'dpmpp_2m', label: 'DPM++ 2M' },
            { value: 'dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
            { value: 'dpmpp_sde', label: 'DPM++ SDE' },
            { value: 'uni_pc', label: 'UniPC' },
          ], 'euler'),

          // Timeouts
          h('h4', { key: 'mm-timeouts', className: 'c3-settings-h4' }, 'Timeouty'),
          ..._inp('c3.comfyui.timeout', 'Timeout generace (ms)', '300000', 'number', { min: 30000, max: 1800000, step: 30000 }),
          h('p', { key: 'mm-to-hint', className: 'c3-hint' }, '300000 ms = 5 minut. Pro video zvyšte na 600000+.'),

          // Storage
          h('h4', { key: 'mm-storage', className: 'c3-settings-h4' }, 'Úložiště'),
          ..._inp('c3.comfyui.maxStorageGB', 'Max úložiště (GB)', '10', 'number', { min: 1, max: 100 }),
          ..._inp('c3.comfyui.maxOutputMB', 'Max velikost výstupu (MB)', '100', 'number', { min: 10, max: 2000 }),
          h('p', { key: 'mm-stor-hint', className: 'c3-hint' }, 'Při překročení kvóty se automaticky smažou nejstarší neoblíbené generace.'),

          // VRAM management
          h('h4', { key: 'mm-vram', className: 'c3-settings-h4' }, 'VRAM management'),
          _tog('c3.comfyui.autoUnloadOllama', 'Automaticky uvolnit Ollama před generací', true),
          ..._inp('c3.comfyui.vramCooldownMs', 'VRAM cooldown (ms)', '3000', 'number', { min: 0, max: 10000, step: 500 }),
          h('p', { key: 'mm-vram-hint', className: 'c3-hint' }, 'Čas na uvolnění VRAM po unloadu Ollama. 3000ms je bezpečné pro RTX 30xx/40xx.'),

          // Feature toggle
          h('h4', { key: 'mm-feat', className: 'c3-settings-h4' }, 'Funkce'),
          _tog('c3.comfyui.enabled', 'Multimedia modul zapnutý', true),
          _tog('c3.comfyui.wsProgress', 'WebSocket progress (real-time)', true),
          _tog('c3.comfyui.autoRefreshModels', 'Automaticky obnovovat seznam modelů', true),
        ];

      default: return h('p', { style: { fontSize: 11, color: 'var(--c3-tx-4)', padding: '4px 0' } }, 'Konfigurace bude doplněna.');
    }
  }

  // ── v87: Settings helper methods ──────────────────────────────────────────

  async _fetchGpuInfo() {
    const el = document.getElementById('c3-gpu-info');
    if (!el) return;
    try {
      const resp = await fetch('/api/system/gpu');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const gpu = data.profile?.gpus?.[0] || {};
      const rec = data.recommendation || {};
      el.innerHTML = `
        <div class="c3-gpu-row"><span>GPU</span><strong>${gpu.gpu_model || 'N/A'}</strong></div>
        <div class="c3-gpu-row"><span>VRAM</span><strong>${gpu.vram_mb ? (gpu.vram_mb / 1024).toFixed(1) + ' GB' : 'N/A'}</strong></div>
        ${gpu.driver ? `<div class="c3-gpu-row"><span>Driver</span><strong>${gpu.driver}</strong></div>` : ''}
        ${gpu.cuda_version ? `<div class="c3-gpu-row"><span>CUDA</span><strong>${gpu.cuda_version}</strong></div>` : ''}
        <div class="c3-gpu-row c3-gpu-rec"><span>Recommended</span><strong>${rec.model || 'N/A'} (${rec.params || ''})</strong></div>
        ${rec.warnings?.length ? `<div class="c3-gpu-warn">${rec.warnings.join('<br>')}</div>` : ''}
      `;
    } catch (err) {
      el.innerHTML = '<p class="c3-gpu-err">GPU detection unavailable (backend offline?)</p>';
    }
  }

  async _loadOllamaModels() {
    try {
      const resp = await fetch('/api/system/models');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const models = data.models || [];
      const chatSel = document.getElementById('c3-llm-chat-model');
      if (chatSel && models.length > 0) {
        chatSel.innerHTML = models.map(m => `<option value="${m.name}">${m.name} (${(m.size / 1e9).toFixed(1)} GB)</option>`).join('');
      }
    } catch (_) {}
  }

  async _fetchSystemInfo() {
    const el = document.getElementById('c3-sys-info');
    if (!el) return;
    try {
      const resp = await fetch('/api/system/info');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      el.innerHTML = `
        <div class="c3-gpu-row"><span>Version</span><strong>${data.version}</strong></div>
        <div class="c3-gpu-row"><span>Platform</span><strong>${data.platform} ${data.arch}</strong></div>
        <div class="c3-gpu-row"><span>Node</span><strong>${data.node_version}</strong></div>
        <div class="c3-gpu-row"><span>Uptime</span><strong>${Math.round(data.uptime_seconds / 60)} min</strong></div>
        <div class="c3-gpu-row"><span>RAM</span><strong>${data.memory?.process_mb} / ${data.memory?.total_mb} MB</strong></div>
        <div class="c3-gpu-row"><span>DB size</span><strong>${data.db?.size_mb} MB</strong></div>
        <div class="c3-gpu-row"><span>Messages</span><strong>${data.db?.tables?.messages || 0}</strong></div>
        <div class="c3-gpu-row"><span>Sessions</span><strong>${data.db?.tables?.sessions || 0}</strong></div>
        <div class="c3-gpu-row"><span>LTM entries</span><strong>${data.db?.tables?.memory || 0}</strong></div>
        <div class="c3-gpu-row"><span>Chat model</span><strong>${data.config?.chat_model}</strong></div>
      `;
    } catch (err) {
      el.innerHTML = '<p class="c3-gpu-err">System info unavailable (backend offline?)</p>';
    }
  }

  async _vacuumDb() {
    try {
      const resp = await fetch('/api/system/vacuum', { method: 'POST' });
      if (!resp.ok) throw new Error('Vacuum failed');
      this._fetchSystemInfo();
    } catch (_) {}
  }

  // ── v87 Phase 2: Notification helpers ─────────────────────────────────

  async _fetchNotifChannels() {
    const el = document.getElementById('c3-notif-channels');
    if (!el) return;
    try {
      const resp = await fetch('/api/notifications/channels');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const channels = data.channels || [];
      el.innerHTML = channels.map(ch =>
        `<div class="c3-gpu-row"><span>${ch.name}</span><strong class="${ch.configured ? 'c3-notif-on' : 'c3-notif-off'}">${ch.configured ? 'Active' : 'Not configured'}</strong></div>`
      ).join('');
    } catch (_) {
      el.innerHTML = '<p class="c3-gpu-err">Notification service unavailable</p>';
    }
  }

  async _testNotifChannel(channel) {
    try {
      const resp = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await resp.json();
      if (data.ok) {
        alert(`${channel}: Test sent successfully`);
      } else {
        alert(`${channel}: ${data.error || 'Test failed'}`);
      }
    } catch (err) {
      alert(`${channel}: Error — ${err.message}`);
    }
  }

  // ── v87 Phase 2: Storage helpers ──────────────────────────────────────

  async _fetchStorageInfo() {
    const el = document.getElementById('c3-storage-info');
    if (!el) return;
    try {
      const resp = await fetch('/api/system/storage');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      el.innerHTML = `
        <div class="c3-gpu-row"><span>Database</span><strong>${data.db_size_mb} MB</strong></div>
        <div class="c3-gpu-row"><span>Messages</span><strong>${data.messages}</strong></div>
        <div class="c3-gpu-row"><span>Sessions</span><strong>${data.sessions}</strong></div>
        <div class="c3-gpu-row"><span>LTM entries</span><strong>${data.ltm_entries}</strong></div>
      `;
    } catch (_) {
      el.innerHTML = '<p class="c3-gpu-err">Storage info unavailable</p>';
    }
  }

  async _pruneOldData() {
    try {
      const resp = await fetch('/api/system/vacuum', { method: 'POST' });
      if (resp.ok) {
        this._fetchStorageInfo();
      }
    } catch (_) {}
  }

  // ── v130: Multimedia settings health check ─────────────────────────────

  async _mmFetchSettingsHealth() {
    const el = document.getElementById('c3-mm-settings-health');
    if (!el) return;
    try {
      const resp = await fetch('/api/media/health');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      if (data.available) {
        const gpu = data.gpuInfo || {};
        const vramFree = gpu.vramFree ? (gpu.vramFree / 1024 / 1024 / 1024).toFixed(1) : '?';
        const vramTotal = gpu.vramTotal ? (gpu.vramTotal / 1024 / 1024 / 1024).toFixed(1) : '?';
        el.innerHTML = `
          <div class="c3-gpu-row"><span>Stav</span><strong class="c3-notif-on">Online</strong></div>
          <div class="c3-gpu-row"><span>GPU</span><strong>${gpu.name || 'N/A'}</strong></div>
          <div class="c3-gpu-row"><span>VRAM</span><strong>${vramFree} / ${vramTotal} GB volné</strong></div>
          <div class="c3-gpu-row"><span>Fronta</span><strong>${data.queueSize || 0} úloh</strong></div>
        `;
      } else {
        el.innerHTML = `
          <div class="c3-gpu-row"><span>Stav</span><strong class="c3-notif-off">Offline</strong></div>
          <div class="c3-gpu-row"><span>Chyba</span><strong>${data.error || 'ComfyUI nedostupné'}</strong></div>
        `;
      }
    } catch (err) {
      el.innerHTML = '<p class="c3-gpu-err">Multimedia health check selhalo (backend offline?)</p>';
    }
  }

  // ── v87 Phase 2: Backup helpers ───────────────────────────────────────

  async _exportSettings() {
    try {
      const resp = await fetch('/api/system/info');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data.config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `c3-settings-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (_) {}
  }

  async _exportAll() {
    // Full export requires backend support — for now export what we can
    await this._exportSettings();
  }

  async _importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const settings = JSON.parse(text);
        const ws = window.C3WS;
        if (ws && typeof ws.syncSettings === 'function' && ws.isReady()) {
          // Sync each key individually
          for (const [key, value] of Object.entries(settings)) {
            ws.syncSettings({ [key]: value });
          }
          alert('Settings imported successfully');
        }
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    };
    input.click();
  }

  // ─── v63.0: Wizard Methods ──────────────────────────────────────────────

  _openWizard(mode, data) {
    this._wizardMode = mode;
    this._wizardEditId = (mode === 'edit' && data) ? data.id : null;
    this._wizardData = data ? { ...data } : {
      name: '', description: '', domain: '', icon: '👤',
      systemPrompt: '', tone: 'professional', temperature: 0.5,
      capabilities: { reasoning: 50, creativity: 50, determinism: 50, riskTolerance: 50, verbosity: 50 },
      modules: { domain_rules: [], emphasis: [], constraints: [], vocabulary: [], antipatterns: [], disclaimer: null },
      parent: null, inheritance: {},
      styleRules: { forbiddenPhrases: [] },
    };
    this._wizardPreview = null;
    this._wizardTestResult = null;
    this._wizardTestLoading = false;
    this._wizardTestError = null;
    this._wizardOpenSections = { basic: true };
    this.update();

    // Fetch schema and expertises from backend (🔴1 — anti-drift)
    fetchSchema().then(schema => { this._wizardSchema = schema; this.update(); }).catch(() => {});
    fetchExpertises().then(expertises => { this._wizardExpertises = expertises; this.update(); }).catch(() => {});
  }

  _closeWizard() {
    this._wizardMode = null;
    this._wizardData = null;
    this._wizardEditId = null;
    this.update();
  }

  async _saveWizard() {
    if (!this._wizardData || !this._wizardData.name) return;
    try {
      await saveExpertise(this._wizardData, this._wizardEditId);
      this._closeWizard();
    } catch (err) {
      this._wizardTestError = `Uložení selhalo: ${err.message}`;
      this.update();
    }
  }

  _onWizardFieldChange(field, value) {
    if (!this._wizardData) return;
    this._wizardData[field] = value;
    this.update();
    this._debouncedPreview();
  }

  _onWizardCapabilityChange(dimension, value) {
    if (!this._wizardData) return;
    if (!this._wizardData.capabilities) this._wizardData.capabilities = {};
    this._wizardData.capabilities[dimension] = value;
    this.update();
    this._debouncedPreview();
  }

  _onWizardModuleChange(section, value) {
    if (!this._wizardData) return;
    if (!this._wizardData.modules) this._wizardData.modules = {};
    this._wizardData.modules[section] = value;
    this.update();
    this._debouncedPreview();
  }

  _onWizardInheritanceChange(section, mode) {
    if (!this._wizardData) return;
    if (!this._wizardData.inheritance) this._wizardData.inheritance = {};
    this._wizardData.inheritance[section] = mode;
    this.update();
  }

  async _fetchWizardPreview() {
    if (!this._wizardData || !this._wizardData.name) return;
    try {
      const preview = await fetchPreview([{ ...this._wizardData, weight: 1.0 }]);
      this._wizardPreview = preview;
      this.update();
    } catch (err) {
      // Rate limited or error — ignore silently
    }
  }

  async _onWizardTest(question) {
    if (!this._wizardData) return;
    this._wizardTestLoading = true;
    this._wizardTestError = null;
    this._wizardTestResult = null;
    this.update();
    try {
      const result = await sendTestPrompt(this._wizardData, question);
      this._wizardTestResult = result;
    } catch (err) {
      this._wizardTestError = err.message;
    }
    this._wizardTestLoading = false;
    this.update();
  }

  _renderWizard(h) {
    const data = this._wizardData || {};
    const schema = this._wizardSchema;
    const isCreate = this._wizardMode === 'create';

    const sections = [
      { id: 'basic', icon: '📝', title: 'Základní údaje',
        render: () => renderBasicInfo(h, data, schema, (f, v) => this._onWizardFieldChange(f, v)) },
      { id: 'capabilities', icon: '📊', title: 'Capabilities (5D)',
        render: () => renderCapabilities(h, data.capabilities, schema, (d, v) => this._onWizardCapabilityChange(d, v)) },
      { id: 'modules', icon: '📦', title: 'Modules',
        render: () => renderModules(h, data.modules, schema, data.inheritance,
          null, // parentModules — TODO: resolve from parent picker
          (s, v) => this._onWizardModuleChange(s, v),
          (s, m) => this._onWizardInheritanceChange(s, m)) },
      { id: 'preview', icon: '👁️', title: 'Preview & Test',
        render: () => renderPreview(h, this._wizardPreview, this._wizardTestResult,
          this._wizardTestLoading, this._wizardTestError, (q) => this._onWizardTest(q)) },
    ];

    return h('div', { className: 'c3-cv' },
      // Toolbar
      h('div', { className: 'c3-wiz-toolbar' },
        h('h3', null, isCreate ? '+ Nová expertyza' : `Editace: ${data.name || '?'}`),
        h('button', { className: 'c3-btn-new', onClick: () => this._closeWizard() }, 'Zrušit'),
        h('button', {
          className: 'c3-btn-primary',
          disabled: !data.name,
          onClick: () => this._saveWizard(),
        }, 'Uložit'),
      ),

      // Scrollable form
      h('div', { className: 'c3-wizard-scroll' },
        ...sections.map(sec =>
          h('div', {
            key: sec.id,
            className: 'c3-wiz-sec' + (this._wizardOpenSections[sec.id] ? ' open' : ''),
          },
            h('div', {
              className: 'c3-wiz-sec-head',
              onClick: () => {
                this._wizardOpenSections[sec.id] = !this._wizardOpenSections[sec.id];
                this.update();
              },
            },
              h('span', null, sec.icon),
              h('span', null, sec.title),
              ico(CHEV),
            ),
            h('div', { className: 'c3-wiz-sec-body' }, sec.render()),
          )
        ),
      ),
    );
  }

  // ═══ v130: Multimedia Generator ═════════════════════════════════════════════

  _renderMultimedia(h) {
    const mm = this._mm;
    const statusDot = mm.comfyAvailable
      ? h('span', { className: 'c3-mm-status c3-mm-status--on', title: 'ComfyUI dostupné' }, '\u25CF Online')
      : h('span', { className: 'c3-mm-status c3-mm-status--off', title: 'ComfyUI nedostupné' }, '\u25CF Offline');

    // Start health polling on first render
    if (!mm.healthTimer) {
      this._mmFetchHealth();
      mm.healthTimer = setInterval(() => this._mmFetchHealth(), 30000);
    }

    return h('div', { className: 'c3-mm', key: 'multimedia' },
      // Header
      h('div', { className: 'c3-mm-header' },
        h('h2', null, 'Multimedia'),
        statusDot,
      ),

      // Type selector
      this._renderMmTypeSelector(h),

      // Prompt area
      this._renderMmPromptArea(h),

      // Parameters (collapsible)
      this._renderMmParams(h),

      // Generate button + progress
      this._renderMmActions(h),

      // Error toast
      mm.error && h('div', { className: 'c3-mm-error' }, mm.error),

      // Gallery
      this._renderMmGallery(h),
    );
  }

  _renderMmTypeSelector(h) {
    const mm = this._mm;
    const types = [
      { id: 'txt2img', label: 'Text \u2192 Obr\u00e1zek' },
      { id: 'img2img', label: 'Obr\u00e1zek \u2192 Obr\u00e1zek' },
      { id: 'txt2vid', label: 'Text \u2192 Video' },
    ];
    return h('div', { className: 'c3-mm-types' },
      types.map(t => h('button', {
        key: t.id,
        className: 'c3-mm-type-btn' + (mm.type === t.id ? ' active' : ''),
        onClick: () => { mm.type = t.id; this.update(); },
      }, t.label))
    );
  }

  _renderMmPromptArea(h) {
    const mm = this._mm;
    return h('div', { className: 'c3-mm-prompt-area' },
      h('label', null, 'Prompt'),
      h('textarea', {
        className: 'c3-mm-textarea',
        rows: 4,
        placeholder: 'Popi\u0161te, co chcete vygenerovat...',
        value: mm.prompt,
        onChange: (e) => { mm.prompt = e.target.value; },
      }),
      // Collapsible negative prompt
      h('div', { className: 'c3-mm-collapse-header', onClick: () => { mm.negExpanded = !mm.negExpanded; this.update(); } },
        h('span', null, (mm.negExpanded ? '\u25BE' : '\u25B8') + ' Negativn\u00ed prompt'),
      ),
      mm.negExpanded && h('textarea', {
        className: 'c3-mm-textarea c3-mm-textarea--neg',
        rows: 2,
        placeholder: 'Co nechcete vid\u011bt...',
        value: mm.negativePrompt,
        onChange: (e) => { mm.negativePrompt = e.target.value; },
      }),
    );
  }

  _renderMmParams(h) {
    const mm = this._mm;
    const p = mm.params;

    return h('div', { className: 'c3-mm-params-section' },
      h('div', { className: 'c3-mm-collapse-header', onClick: () => { mm.paramsExpanded = !mm.paramsExpanded; this.update(); } },
        h('span', null, (mm.paramsExpanded ? '\u25BE' : '\u25B8') + ' Parametry'),
      ),
      mm.paramsExpanded && h('div', { className: 'c3-mm-params' },
        // Model selector
        h('div', { className: 'c3-mm-param-row' },
          h('label', null, 'Model'),
          h('select', {
            className: 'c3-mm-select',
            value: mm.selectedModel,
            onChange: (e) => { mm.selectedModel = e.target.value; this.update(); },
          },
            h('option', { value: '' }, '(v\u00fdchoz\u00ed)'),
            mm.models.map(m => h('option', { key: m, value: m }, m)),
          ),
          h('button', { className: 'c3-mm-refresh-btn', onClick: () => this._mmRefreshModels(), title: 'Obnovit seznam' }, '\u21BB'),
        ),

        // Resolution
        h('div', { className: 'c3-mm-param-row' },
          h('label', null, 'Rozli\u0161en\u00ed'),
          h('input', { type: 'number', className: 'c3-mm-input-sm', value: p.width, min: 64, max: 4096, step: 8,
            onChange: (e) => { p.width = parseInt(e.target.value) || 1024; },
          }),
          h('span', { className: 'c3-mm-x' }, '\u00d7'),
          h('input', { type: 'number', className: 'c3-mm-input-sm', value: p.height, min: 64, max: 4096, step: 8,
            onChange: (e) => { p.height = parseInt(e.target.value) || 1024; },
          }),
        ),

        // Steps slider
        h('div', { className: 'c3-mm-param-row' },
          h('label', null, 'Kroky'),
          h('input', { type: 'range', min: 1, max: 150, value: p.steps,
            onChange: (e) => { p.steps = parseInt(e.target.value); this.update(); },
          }),
          h('span', { className: 'c3-mm-val' }, p.steps),
        ),

        // CFG slider
        h('div', { className: 'c3-mm-param-row' },
          h('label', null, 'CFG'),
          h('input', { type: 'range', min: 0, max: 30, step: 0.5, value: p.cfg_scale,
            onChange: (e) => { p.cfg_scale = parseFloat(e.target.value); this.update(); },
          }),
          h('span', { className: 'c3-mm-val' }, p.cfg_scale),
        ),

        // Seed
        h('div', { className: 'c3-mm-param-row' },
          h('label', null, 'Seed'),
          h('input', { type: 'number', className: 'c3-mm-input-sm', value: p.seed, min: -1,
            onChange: (e) => { p.seed = parseInt(e.target.value); },
          }),
          h('span', { className: 'c3-mm-hint' }, p.seed === -1 ? '(n\u00e1hodn\u00fd)' : ''),
        ),

        // Frames (video only)
        mm.type === 'txt2vid' && h('div', { className: 'c3-mm-param-row' },
          h('label', null, 'Sn\u00edmky'),
          h('input', { type: 'number', className: 'c3-mm-input-sm', value: p.frames || 49, min: 1, max: 300,
            onChange: (e) => { p.frames = parseInt(e.target.value) || 49; },
          }),
        ),
      ),
    );
  }

  _renderMmActions(h) {
    const mm = this._mm;
    const isWorking = mm.status === 'preparing' || mm.status === 'generating';
    const canGenerate = mm.comfyAvailable && mm.prompt.trim() && !isWorking;

    const parts = [];

    // Generate / Cancel button
    if (isWorking) {
      parts.push(
        h('button', { className: 'c3-mm-btn c3-mm-btn--cancel', onClick: () => this._mmCancel() }, 'Zru\u0161it'),
      );
    } else {
      parts.push(
        h('button', {
          className: 'c3-mm-btn c3-mm-btn--gen' + (canGenerate ? '' : ' disabled'),
          onClick: canGenerate ? () => this._mmGenerate() : null,
          disabled: !canGenerate,
        }, 'Generovat'),
      );
    }

    // Progress bar
    if (isWorking) {
      const prog = mm.progress;
      parts.push(
        h('div', { className: 'c3-mm-progress' },
          h('div', { className: 'c3-mm-progress-bar' },
            h('div', { className: 'c3-mm-progress-fill', style: { width: (prog.percent || 0) + '%' } }),
          ),
          h('span', { className: 'c3-mm-progress-text' }, prog.text || (mm.status === 'preparing' ? 'P\u0159ipravuji GPU...' : 'Generuji...')),
        ),
      );
    }

    // Queue info
    if (mm.queueLength > 0) {
      parts.push(
        h('div', { className: 'c3-mm-queue-info' }, '\u010cek\u00e1 ' + mm.queueLength + ' \u00faloh ve front\u011b'),
      );
    }

    return h('div', { className: 'c3-mm-actions' }, ...parts);
  }

  _renderMmGallery(h) {
    const mm = this._mm;
    if (mm.history.length === 0 && mm.status === 'idle') {
      return h('div', { className: 'c3-mm-empty' }, 'Zat\u00edm \u017e\u00e1dn\u00e9 generace. Zadejte prompt a klikn\u011bte Generovat.');
    }

    const items = mm.history.map(gen => {
      const outputs = gen.outputs ? JSON.parse(gen.outputs) : [];
      const firstFile = outputs[0];
      const thumbUrl = firstFile ? '/api/media/output?id=' + encodeURIComponent(gen.id) + '&filename=' + encodeURIComponent(firstFile) : null;

      return h('div', {
        key: gen.id,
        className: 'c3-mm-thumb' + (gen.status === 'failed' ? ' c3-mm-thumb--failed' : '') + (gen.favorite ? ' c3-mm-thumb--fav' : ''),
        title: gen.prompt,
      },
        thumbUrl
          ? h('img', { src: thumbUrl, loading: 'lazy', onClick: () => this._mmOpenFull(gen) })
          : h('div', { className: 'c3-mm-thumb-placeholder' },
              gen.status === 'failed' ? '\u2716' : gen.status === 'running' ? '\u23F3' : '\u25A1'),
        h('div', { className: 'c3-mm-thumb-actions' },
          h('button', {
            className: 'c3-mm-fav-btn' + (gen.favorite ? ' active' : ''),
            onClick: (e) => { e.stopPropagation(); this._mmToggleFavorite(gen); },
            title: gen.favorite ? 'Odebrat z obl\u00edben\u00fdch' : 'P\u0159idat do obl\u00edben\u00fdch',
          }, gen.favorite ? '\u2605' : '\u2606'),
          h('button', {
            className: 'c3-mm-del-btn',
            onClick: (e) => { e.stopPropagation(); this._mmDelete(gen); },
            title: 'Smazat',
          }, '\u2716'),
        ),
      );
    });

    return h('div', { className: 'c3-mm-gallery-section' },
      h('h3', null, 'Historie'),
      h('div', { className: 'c3-mm-gallery' }, ...items),
      mm.history.length >= (mm.historyPage + 1) * 20 && h('button', {
        className: 'c3-mm-load-more',
        onClick: () => this._mmFetchHistory(true),
      }, 'Na\u010d\u00edst dal\u0161\u00ed...'),
    );
  }

  // ── Multimedia API methods ─────────────────────────────────────────────────

  async _mmFetchHealth() {
    try {
      const resp = await fetch('/api/media/health');
      if (resp.ok) {
        const data = await resp.json();
        this._mm.comfyAvailable = data.available === true;
      } else {
        this._mm.comfyAvailable = false;
      }
      this.update();
    } catch (_) {
      this._mm.comfyAvailable = false;
      this.update();
    }
  }

  async _mmFetchModels() {
    try {
      const resp = await fetch('/api/media/models');
      if (resp.ok) {
        const data = await resp.json();
        this._mm.models = data.checkpoints || [];
        this.update();
      }
    } catch (_) {}
  }

  async _mmRefreshModels() {
    try {
      await fetch('/api/media/models/refresh', { method: 'POST' });
      await this._mmFetchModels();
    } catch (_) {}
  }

  async _mmFetchHistory(append) {
    try {
      const mm = this._mm;
      const page = append ? mm.historyPage + 1 : 0;
      const resp = await fetch('/api/media/history?page=' + page + '&limit=20');
      if (resp.ok) {
        const data = await resp.json();
        if (append) {
          mm.history = mm.history.concat(data.generations || []);
        } else {
          mm.history = data.generations || [];
        }
        mm.historyPage = page;
        this.update();
      }
    } catch (_) {}
  }

  async _mmGenerate() {
    const mm = this._mm;
    if (!mm.prompt.trim()) return;

    mm.status = 'preparing';
    mm.error = null;
    this.update();

    try {
      const body = {
        type: mm.type,
        prompt: mm.prompt,
        negative_prompt: mm.negativePrompt || undefined,
        params: {
          ...mm.params,
          model: mm.selectedModel || undefined,
        },
      };

      const resp = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await resp.json();

      if (!resp.ok) {
        mm.status = 'idle';
        mm.error = data.error || 'Generov\u00e1n\u00ed selhalo';
        this.update();
        return;
      }

      mm.currentGenId = data.generationId;
      if (data.dedup) {
        mm.status = 'generating';
      }
      this.update();
    } catch (err) {
      mm.status = 'idle';
      mm.error = err.message;
      this.update();
    }
  }

  async _mmCancel() {
    const mm = this._mm;
    if (!mm.currentGenId) return;

    try {
      await fetch('/api/media/cancel?id=' + encodeURIComponent(mm.currentGenId), { method: 'POST' });
    } catch (_) {}
  }

  _mmOpenFull(gen) {
    const outputs = gen.outputs ? JSON.parse(gen.outputs) : [];
    if (outputs[0]) {
      window.open('/api/media/output?id=' + encodeURIComponent(gen.id) + '&filename=' + encodeURIComponent(outputs[0]), '_blank');
    }
  }

  async _mmToggleFavorite(gen) {
    try {
      await fetch('/api/media/favorite', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gen.id, favorite: !gen.favorite }),
      });
      gen.favorite = gen.favorite ? 0 : 1;
      this.update();
    } catch (_) {}
  }

  async _mmDelete(gen) {
    try {
      await fetch('/api/media?id=' + encodeURIComponent(gen.id), { method: 'DELETE' });
      this._mm.history = this._mm.history.filter(g => g.id !== gen.id);
      this.update();
    } catch (_) {}
  }

  _selectItem(id, type, item) {
    this._selectedItem = id;
    this.update();
    // Emit event for detail panel
    const event = new CustomEvent('c3-item-selected', {
      detail: { id, type, item },
      bubbles: true
    });
    this.node.dispatchEvent(event);
  }
}

/* ═══ ViewContribution ═══ */
class C3CenterViewsContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: C3_CENTER_ID,
      widgetName: 'C3 Views',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'c3CenterViews:toggle'
    });
  }

  async initializeLayout(app) {
    await this.openView({ activate: true, reveal: true });
  }
}

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(C3CenterViewsWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: C3_CENTER_ID,
    createWidget: () => ctx.container.get(C3CenterViewsWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, C3CenterViewsContribution);
  bind(browser_1.FrontendApplicationContribution).toService(C3CenterViewsContribution);
});
