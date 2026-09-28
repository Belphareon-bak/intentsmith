"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/intentsmith-center.css");
require("./styles/intentsmith-pro-theme.css");
require("./styles/intentsmith-multimedia.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");
const {
  createLegacyLocalObjectUrlCache,
} = require("../../../../shared/legacy-local-object-url-cache");

// v63.0: Wizard modules
const { fetchSchema, fetchExpertises, fetchPreview, sendTestPrompt, saveExpertise, debounce } = require('./wizard/wizard-helpers');
const { renderBasicInfo } = require('./wizard/wizard-basic');
const { renderCapabilities } = require('./wizard/wizard-capabilities');
const { renderModules } = require('./wizard/wizard-modules');
const { renderPreview } = require('./wizard/wizard-preview');

const INTENTSMITH_CENTER_ID = 'intentsmith-center-views';

/* ═══ SVG ═══ */
function ico(path, w = 13) {
  return React.createElement('span', {
    className: 'intentsmith-icon',
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
  { id: 'remote', icon: '📱', title: 'Remote Companion' },
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
class IntentSmithCenterViewsWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = INTENTSMITH_CENTER_ID;
    this.title.label = 'IntentSmith Views';
    this.title.caption = 'IntentSmith Center Views';
    this.title.iconClass = 'codicon codicon-layout';
    this.title.closable = false;
    this.addClass('intentsmith-center-widget');
    this.node.tabIndex = 0;
    this._view = 'chats';
    this._zoom = 1;
    this._openSections = { user: true };
    this._selectedItem = null;
    this._m7Pairing = {
      status: 'idle',
      claim: null,
      error: null,
      selectedScopes: [
        'read:approvals', 'read:chat', 'read:events', 'read:notifications',
        'read:operations', 'read:projects', 'read:settings', 'read:stored_information',
      ],
    };
    this._m7PairingTimer = null;

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
    this._mmOutputCache = createLegacyLocalObjectUrlCache({
      fetchImpl: (target, options) => fetch(target, options),
      createObjectURL: blob => URL.createObjectURL(blob),
      revokeObjectURL: objectUrl => URL.revokeObjectURL(objectUrl),
      maxEntries: 24,
    });

    // Pro theme: restore from localStorage
    try {
      if (localStorage.getItem('intentsmith-theme-mode') === 'pro') {
        document.body.classList.add('theme-pro');
        if (!document.querySelector('.intentsmith-pro-badge')) {
          var badge = document.createElement('div');
          badge.className = 'intentsmith-pro-badge';
          badge.textContent = 'PRO';
          document.body.appendChild(badge);
        }
      }
    } catch(e) {}

    // Listen for sidebar navigation events
    document.addEventListener('intentsmith-view-change', (e) => {
      this._view = e.detail.view;
      this._selectedItem = null;
      this._wizardMode = null;
      this.update();
    });

    // v63.0: Listen for wizard-open events from detail panel
    document.addEventListener('intentsmith-wizard-open', (e) => {
      this._openWizard(e.detail.mode, e.detail.expertiseData);
    });

    // v130: ComfyUI WS event listeners
    const self = this;
    const _mmBusInit = setInterval(() => {
      if (typeof window.IntentSmithBus === 'undefined') return;
      clearInterval(_mmBusInit);
      window.IntentSmithBus.on('comfyui:progress', function(d) {
        self._mm.progress = { percent: d.percent || 0, text: d.text || '', step: d.step || 0, totalSteps: d.totalSteps || 0 };
        self._mm.status = 'generating';
        if (d.generationId) self._mm.currentGenId = d.generationId;
        self.update();
      });
      window.IntentSmithBus.on('comfyui:complete', function(d) {
        self._mm.status = 'idle';
        self._mm.error = null;
        self._mm.queueLength = 0;
        self._mm.currentGenId = null;
        if (d.generationId) self._mmRevokeOutputUrls(d.generationId);
        self._mmFetchHistory();
        self.update();
      });
      window.IntentSmithBus.on('comfyui:error', function(d) {
        self._mm.status = 'idle';
        self._mm.error = d.error || 'Neznámá chyba';
        self._mm.currentGenId = null;
        self.update();
        setTimeout(() => { self._mm.error = null; self.update(); }, 10000);
      });
      window.IntentSmithBus.on('vram:state', function(d) {
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
    return h('div', { className: 'intentsmith-cv' },
      this._renderBar(h, v),
      this._renderGrid(h, v)
    );
  }

  _renderBar(h, view) {
    const titles = { chats: 'Konverzace', projects: 'Projekty', specialists: 'Specialisté', expertises: 'Expertyzy', workers: 'Workeri', multimedia: 'Multimedia' };
    return h('div', { className: 'intentsmith-view-bar' },
      h('h2', null, titles[view] || view),
      // v63.0: New expertise button
      view === 'expertises' && h('button', {
        className: 'intentsmith-btn-new',
        onClick: () => this._openWizard('create', null),
      }, '+ Nová expertyza'),
      h('div', { style: { flex: 1 } }),
      h('div', { className: 'intentsmith-zoom' },
        ico(ZOOM_OUT),
        h('input', { type: 'range', min: 0, max: 2, value: this._zoom,
          onChange: (e) => { this._zoom = parseInt(e.target.value); this.update(); }
        }),
        ico(ZOOM_IN)
      ),
      h('div', { className: 'intentsmith-view-toggle' },
        h('button', { className: 'active' }, ico(GRID_ICO)),
        h('button', null, ico(LIST_ICO))
      )
    );
  }

  _renderGrid(h, view) {
    const items = DATA[view] || [];
    return h('div', { className: 'intentsmith-grid', 'data-zoom': this._zoom },
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
      className: 'intentsmith-card intentsmith-card-conv' + (this._selectedItem === item.id ? ' selected' : ''),
      onClick: () => this._selectItem(item.id, 'chat', item)
    },
      h('div', { className: 'intentsmith-conv-ava' }, item.icon),
      h('div', { className: 'intentsmith-conv-body' },
        h('h4', null, item.title),
        h('p', null, item.preview)
      ),
      h('span', { className: 'intentsmith-conv-time' }, item.time)
    );
  }

  _renderProjectCard(h, item) {
    return h('div', {
      key: item.id,
      className: 'intentsmith-card' + (this._selectedItem === item.id ? ' selected' : ''),
      onClick: () => this._selectItem(item.id, 'project', item)
    },
      h('h4', null, item.title),
      h('p', null, item.desc),
      h('div', { className: 'intentsmith-card-foot' },
        h('span', { className: 'intentsmith-pill intentsmith-pill-' + item.pill }, item.status),
        h('span', { className: 'intentsmith-card-date' }, item.date)
      )
    );
  }

  _renderExpertiseCard(h, item) {
    return h('div', {
      key: item.id,
      className: 'intentsmith-card intentsmith-card-expertise' + (item.fav ? ' favorite' : '') + (this._selectedItem === item.id ? ' selected' : ''),
      onClick: () => this._selectItem(item.id, 'expertise', item)
    },
      h('span', { className: 'intentsmith-expertise-emo' }, item.emoji),
      h('div', null,
        h('h4', null, item.title),
        h('p', { style: { margin: 0 } }, item.desc)
      ),
      h('span', { className: 'star' }, item.fav ? '★' : '☆')
    );
  }

  _renderSettings(h) {
    return h('div', { className: 'intentsmith-cv' },
      h('div', { className: 'intentsmith-settings-scroll' },
        h('div', { className: 'intentsmith-settings-page' },
          h('h1', null, '⚙️ Nastavení'),
          h('p', { className: 'intentsmith-settings-sub' }, 'Konfigurace IntentSmith Studia'),
          SETTINGS.map(sec =>
            h('div', { key: sec.id, className: 'intentsmith-sec' + (this._openSections[sec.id] ? ' open' : '') },
              h('div', { className: 'intentsmith-sec-head', onClick: () => {
                this._openSections[sec.id] = !this._openSections[sec.id];
                this.update();
              }},
                h('span', { className: 'intentsmith-sec-icon' }, sec.icon),
                h('span', { className: 'intentsmith-sec-title' }, sec.title),
                ico(CHEV)
              ),
              this._openSections[sec.id] && h('div', { className: 'intentsmith-sec-body' },
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
        const ws = window.IntentSmithWS;
        if (ws && typeof ws.syncSettings === 'function' && ws.isReady()) {
          ws.syncSettings({ [key]: val });
        }
      } catch (_) {}
    };
    const _tog = (key, label, def = true) => h('div', { key, className: 'intentsmith-toggle-row' },
      h('input', { type: 'checkbox', defaultChecked: def, className: 'intentsmith-toggle',
        onChange: (e) => _sync(key, e.target.checked)
      }),
      h('span', { className: 'intentsmith-toggle-label' }, label)
    );
    const _inp = (key, label, def, type = 'text', extra = {}) => [
      h('label', { key: key + '-l', className: 'intentsmith-label' }, label),
      h('input', { key: key + '-i', className: 'intentsmith-input', type, defaultValue: def,
        onBlur: (e) => _sync(key, type === 'number' ? Number(e.target.value) : e.target.value), ...extra })
    ];
    const _sel = (key, label, options, def) => [
      h('label', { key: key + '-l', className: 'intentsmith-label' }, label),
      h('select', { key: key + '-s', className: 'intentsmith-select', defaultValue: def,
        onChange: (e) => _sync(key, e.target.value) },
        options.map(o => h('option', { key: o.value || o, value: o.value || o }, o.label || o))
      )
    ];
    const _range = (key, label, def, min, max, step = 1, unit = '') => [
      h('label', { key: key + '-l', className: 'intentsmith-label' }, label),
      h('div', { key: key + '-r', className: 'intentsmith-range-row' },
        h('input', { type: 'range', className: 'intentsmith-range', min, max, step, defaultValue: def,
          onInput: (e) => {
            const span = e.target.parentElement.querySelector('.intentsmith-range-val');
            if (span) span.textContent = e.target.value + unit;
          },
          onChange: (e) => _sync(key, Number(e.target.value))
        }),
        h('span', { className: 'intentsmith-range-val' }, def + unit)
      )
    ];

    switch (secId) {
      // ═══ Account / Identity ═══
      case 'user': return [
        ..._inp('intentsmith.account.displayName', 'Jméno', 'Belfik'),
        ..._inp('intentsmith.account.description', 'Popis', '', 'text', { placeholder: 'Krátký popis pro personalizaci...' }),
        ..._sel('intentsmith.account.timezone', 'Časové pásmo', [
          { value: 'Europe/Prague', label: 'Europe/Prague (CET)' },
          { value: 'Europe/London', label: 'Europe/London (GMT)' },
          { value: 'America/New_York', label: 'America/New_York (EST)' },
          { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
        ], 'Europe/Prague'),
        ..._sel('intentsmith.account.currency', 'Měna', [
          { value: 'CZK', label: 'CZK (Kč)' },
          { value: 'EUR', label: 'EUR (€)' },
          { value: 'USD', label: 'USD ($)' },
          { value: 'GBP', label: 'GBP (£)' },
        ], 'CZK'),
        ..._sel('intentsmith.language', 'Jazyk rozhraní', [
          { value: 'cs', label: 'Čeština' },
          { value: 'en', label: 'English' },
        ], 'cs'),
      ];

      // ═══ Remote Companion / local-only pairing authority ═══
      case 'remote': {
        const pairing = this._m7Pairing;
        const scopes = [
          'read:approvals', 'read:chat', 'read:events', 'read:notifications',
          'read:operations', 'read:projects', 'read:settings', 'read:stored_information',
          'write:approvals', 'write:chat', 'write:notifications', 'write:operations',
          'write:settings', 'write:stored_information',
        ];
        const claim = pairing.claim;
        return [
          h('p', { key: 'remote-boundary', className: 'intentsmith-hint' },
            'Telefon se připojuje pouze přes vaši VPN. IntentSmith nevystavuje veřejný internetový endpoint.'),
          h('h4', { key: 'remote-pair-title', className: 'intentsmith-settings-h4' }, 'Jednorázové párování'),
          h('p', { key: 'remote-pair-hint', className: 'intentsmith-hint' },
            'Vyberte oprávnění a vytvořte kód platný pět minut. Kód se neukládá do nastavení ani do historie Studia.'),
          h('div', { key: 'remote-scopes', className: 'intentsmith-m7-scope-list' },
            scopes.map(scope => h('label', { key: scope, className: 'intentsmith-toggle-row' },
              h('input', {
                type: 'checkbox',
                className: 'intentsmith-toggle',
                checked: pairing.selectedScopes.includes(scope),
                disabled: pairing.status === 'loading' || claim !== null,
                onChange: () => this._m7TogglePairingScope(scope),
              }),
              h('span', { className: 'intentsmith-toggle-label' }, scope)
            ))
          ),
          h('button', {
            key: 'remote-issue',
            className: 'intentsmith-btn-sm intentsmith-mt-8',
            disabled: pairing.status === 'loading' || pairing.selectedScopes.length === 0 || claim !== null,
            onClick: () => this._m7IssuePairingClaim(),
          }, pairing.status === 'loading' ? 'Vytvářím…' : 'Vytvořit 5min kód'),
          pairing.error && h('p', {
            key: 'remote-error', className: 'intentsmith-gpu-err', role: 'alert',
          }, pairing.error),
          claim && h('div', { key: 'remote-claim', className: 'intentsmith-sys-info intentsmith-m7-pairing-claim' },
            h('div', { className: 'intentsmith-gpu-row' },
              h('span', null, 'Párovací kód'),
              h('strong', { className: 'intentsmith-m7-pairing-code' }, claim.claimCode)
            ),
            h('div', { className: 'intentsmith-gpu-row' },
              h('span', null, 'Platí do'),
              h('strong', null, new Date(claim.expiresAt).toLocaleTimeString())
            ),
            h('p', { className: 'intentsmith-hint' },
              'Kód opište do telefonu. Po prvním použití nebo po vypršení už nefunguje.'),
            h('code', { className: 'intentsmith-m7-pairing-uri' }, claim.pairingUri)
          ),
        ];
      }

      // ═══ LLM Settings ═══
      case 'llm': {
        // GPU info card — fetched dynamically
        const gpuCard = h('div', { key: 'gpu-card', className: 'intentsmith-gpu-card' },
          h('div', { className: 'intentsmith-gpu-card-head' },
            h('span', { className: 'intentsmith-gpu-icon' }, '🎮'),
            h('span', null, 'GPU Detection')
          ),
          h('div', { className: 'intentsmith-gpu-card-body', id: 'intentsmith-gpu-info' },
            h('p', { className: 'intentsmith-gpu-loading' }, 'Detecting GPU...')
          ),
          h('button', { className: 'intentsmith-btn-sm', onClick: () => this._fetchGpuInfo() }, 'Refresh')
        );
        // Trigger initial GPU fetch
        setTimeout(() => this._fetchGpuInfo(), 100);

        return [
          gpuCard,
          h('h4', { key: 'llm-models', className: 'intentsmith-settings-h4' }, 'Models'),
          ..._inp('intentsmith.llm.ollamaUrl', 'Ollama URL', 'http://127.0.0.1:11434'),
          h('label', { key: 'chat-m-l', className: 'intentsmith-label' }, 'Chat model'),
          h('select', { key: 'chat-m-s', className: 'intentsmith-select', id: 'intentsmith-llm-chat-model', defaultValue: 'qwen3.5:27b',
            onChange: (e) => _sync('intentsmith.llm.chatModel', e.target.value)
          },
            h('option', { value: 'qwen3.5:27b' }, 'qwen3.5:27b'),
            h('option', { value: 'qwen3.5:14b' }, 'qwen3.5:14b'),
            h('option', { value: 'qwen3.5:7b' }, 'qwen3.5:7b'),
            h('option', { value: 'qwen3.5:3b' }, 'qwen3.5:3b')
          ),
          h('label', { key: 'code-m-l', className: 'intentsmith-label' }, 'Code model'),
          h('select', { key: 'code-m-s', className: 'intentsmith-select', defaultValue: 'qwen3.5:27b',
            onChange: (e) => _sync('intentsmith.llm.codeModel', e.target.value)
          },
            h('option', { value: 'qwen3.5:27b' }, 'qwen3.5:27b'),
            h('option', { value: 'qwen3.5:14b' }, 'qwen3.5:14b'),
            h('option', { value: 'qwen3.5:7b' }, 'qwen3.5:7b')
          ),
          h('button', { key: 'load-models', className: 'intentsmith-btn-sm intentsmith-mt-8', onClick: () => this._loadOllamaModels() }, 'Load from Ollama'),

          h('h4', { key: 'llm-params', className: 'intentsmith-settings-h4' }, 'Parameters'),
          ..._range('intentsmith.llm.temperature', 'Temperature', 0.7, 0, 2, 0.1),
          ..._inp('intentsmith.llm.contextWindow', 'Context window (tokens)', '32768', 'number', { min: 2048, max: 131072, step: 1024 }),
          ..._inp('intentsmith.llm.timeoutChat', 'Chat timeout (ms)', '90000', 'number', { min: 10000, max: 300000, step: 5000 }),
          ..._inp('intentsmith.llm.timeoutCode', 'Code timeout (ms)', '90000', 'number', { min: 10000, max: 300000, step: 5000 }),
          ..._range('intentsmith.llm.numGpu', 'GPU layers', -1, -1, 8, 1, ''),
          h('p', { key: 'gpu-hint', className: 'intentsmith-hint' }, '-1 = auto · 0 = CPU only'),
        ];
      }

      // ═══ Memory & Context ═══
      case 'memory': return [
        h('h4', { key: 'mem-conv', className: 'intentsmith-settings-h4' }, 'Conversation Memory'),
        ..._inp('intentsmith.memory.conversationMaxTurns', 'Max turns', '500', 'number', { min: 50, max: 5000 }),
        ..._range('intentsmith.memory.compactThreshold', 'Compact threshold', 0.75, 0.3, 0.95, 0.05, ''),
        ..._inp('intentsmith.memory.compactKeepTurns', 'Keep turns (after compact)', '6', 'number', { min: 2, max: 20 }),

        h('h4', { key: 'mem-ltm', className: 'intentsmith-settings-h4' }, 'Long-Term Memory (LTM)'),
        _tog('intentsmith.memory.ltmEnabled', 'Povolit dlouhodobou paměť', true),
        ..._inp('intentsmith.memory.ltmMaxEntries', 'Max entries', '1000', 'number', { min: 100, max: 10000 }),
        ..._inp('intentsmith.memory.ltmDecayHalfLife', 'Decay half-life (days)', '69', 'number', { min: 7, max: 365 }),

        h('h4', { key: 'mem-ctx', className: 'intentsmith-settings-h4' }, 'Context Budget'),
        ..._range('intentsmith.memory.contextBudgetChat', 'Chat budget', 60, 10, 90, 5, '%'),
        ..._range('intentsmith.memory.contextBudgetCode', 'Code budget', 40, 10, 90, 5, '%'),
        ..._inp('intentsmith.memory.contextBudgetMaxTokens', 'Hard cap (tokens)', '24576', 'number', { min: 2048, max: 65536, step: 1024 }),
        h('p', { key: 'cap-hint', className: 'intentsmith-hint' }, 'Absolutní limit — ani vysoké procento nepřekročí tento cap.'),

        h('h4', { key: 'mem-learn', className: 'intentsmith-settings-h4' }, 'Learning & Adaptation'),
        _tog('intentsmith.memory.learningEnabled', 'Učení z preferencí', true),
        _tog('intentsmith.memory.feedbackDetection', 'Detekce zpětné vazby', true),
        _tog('intentsmith.memory.patternTracking', 'Sledování vzorců', true),

        h('h4', { key: 'mem-feat', className: 'intentsmith-settings-h4' }, 'Feature Toggles'),
        _tog('intentsmith.features.skills', 'Systém skillů (automatické opakující se postupy)', true),
        h('label', { key: 'al', className: 'intentsmith-label' }, 'Agent Log verbosity'),
        h('div', { key: 'ald', className: 'intentsmith-radios' },
          [{ v: 'minimal', l: 'Minimální' }, { v: 'normal', l: 'Normální' }, { v: 'verbose', l: 'Podrobný' }].map(r =>
            h('label', { key: r.v, className: 'intentsmith-radio' },
              h('input', { type: 'radio', name: 'agentVerbosity', defaultChecked: r.v === 'normal',
                onChange: () => _sync('intentsmith.agent.verbosity', r.v)
              }), ' ', r.l
            )
          )
        ),
      ];

      // ═══ Output & Formats ═══
      case 'output': return [
        _tog('intentsmith.output.codeBlocks', 'Code blocks ve výstupu', true),
        _tog('intentsmith.output.syntaxHighlight', 'Zvýrazňování syntaxe', true),
        _tog('intentsmith.output.markdownRendering', 'Markdown rendering', true),
        ..._inp('intentsmith.output.maxResponseLength', 'Max response length (tokens)', '8192', 'number', { min: 1024, max: 65536 }),
      ];

      // ═══ System ═══
      case 'system':
        setTimeout(() => this._fetchSystemInfo(), 100);
        return [
        ..._sel('intentsmith.system.logLevel', 'Log level', [
          { value: 'debug', label: 'Debug' },
          { value: 'info', label: 'Info' },
          { value: 'warn', label: 'Warning' },
          { value: 'error', label: 'Error' },
        ], 'info'),
        ..._inp('intentsmith.system.logRetentionDays', 'Retence logů (dny)', '30', 'number', { min: 7, max: 365 }),
        ..._inp('intentsmith.system.maxFileSize', 'Max file size (bytes)', '1048576', 'number', { min: 102400, max: 10485760 }),
        ..._inp('intentsmith.system.rateLimit', 'Rate limit (req/min)', '120', 'number', { min: 10, max: 1000 }),

        h('h4', { key: 'sys-diag', className: 'intentsmith-settings-h4' }, 'Diagnostics'),
        h('div', { key: 'sys-info', className: 'intentsmith-sys-info', id: 'intentsmith-sys-info' },
          h('p', { className: 'intentsmith-gpu-loading' }, 'Loading system info...')
        ),
        h('div', { key: 'sys-actions', className: 'intentsmith-sys-actions' },
          h('button', { className: 'intentsmith-btn-sm', onClick: () => this._fetchSystemInfo() }, 'Refresh'),
          h('button', { className: 'intentsmith-btn-sm intentsmith-btn-danger', onClick: () => this._vacuumDb() }, 'Vacuum DB'),
        ),
      ];

      // ═══ Appearance ═══
      case 'appearance': return [
        ..._sel('intentsmith.theme', 'Barevné schéma', [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ], 'dark'),
        ..._range('intentsmith.chat.fontSize', 'Velikost písma (chat)', 14, 10, 24, 1, 'px'),
        ..._sel('intentsmith.appearance.density', 'Density', [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
          { value: 'minimal', label: 'Minimal' },
        ], 'comfortable'),
        ..._sel('intentsmith.appearance.uiScale', 'UI Scale', [
          { value: '1.0', label: '100%' },
          { value: '1.1', label: '110%' },
          { value: '1.25', label: '125%' },
        ], '1.0'),

        h('h4', { key: 'app-vis', className: 'intentsmith-settings-h4' }, 'Viditelnost'),
        _tog('intentsmith.chat.showTimestamps', 'Časové značky u zpráv', false),
        _tog('intentsmith.chat.showIntentBadges', 'Intent badges (DESIGN, BUILD, ...)', true),
        _tog('intentsmith.agent.showTokenCounts', 'Token counts u LLM volání', false),
        _tog('intentsmith.agent.autoScroll', 'Auto-scroll Agent Log', true),
      ];

      // ═══ Notifications ═══
      case 'notif':
        setTimeout(() => this._fetchNotifChannels(), 100);
        return [
          h('p', { key: 'nd', className: 'intentsmith-hint' }, 'Kanály pro doručování notifikací z workerů a agentů.'),
          h('div', { key: 'notif-channels', className: 'intentsmith-notif-channels', id: 'intentsmith-notif-channels' },
            h('p', { className: 'intentsmith-gpu-loading' }, 'Loading channels...')
          ),

          h('h4', { key: 'notif-email', className: 'intentsmith-settings-h4' }, 'Email'),
          ..._inp('intentsmith.notif.emailSmtp', 'SMTP server', '', 'text', { placeholder: 'smtp.gmail.com' }),
          ..._inp('intentsmith.notif.emailFrom', 'From address', '', 'text', { placeholder: 'intentsmith@example.com' }),
          ..._inp('intentsmith.notif.emailTo', 'Recipient', '', 'text', { placeholder: 'user@example.com' }),
          h('button', { key: 'test-email', className: 'intentsmith-btn-sm intentsmith-mt-8', onClick: () => this._testNotifChannel('email') }, 'Test Email'),

          h('h4', { key: 'notif-tg', className: 'intentsmith-settings-h4' }, 'Telegram'),
          h('p', { key: 'tg-env', className: 'intentsmith-hint' }, 'External notifications are unsupported in M5; credentials are never stored in Studio settings.'),
          h('button', { key: 'test-tg', className: 'intentsmith-btn-sm intentsmith-mt-8', onClick: () => this._testNotifChannel('telegram') }, 'Test Telegram'),

          h('h4', { key: 'notif-wh', className: 'intentsmith-settings-h4' }, 'Webhook (HMAC)'),
          h('p', { key: 'wh-hint', className: 'intentsmith-hint' }, 'External notifications are unsupported in M5; HMAC authority is environment-only.'),
          h('button', { key: 'test-wh', className: 'intentsmith-btn-sm intentsmith-mt-8', onClick: () => this._testNotifChannel('webhook') }, 'Test Webhook'),

          h('h4', { key: 'notif-ntfy', className: 'intentsmith-settings-h4' }, 'ntfy.sh'),
          ..._inp('intentsmith.notif.ntfyUrl', 'Server URL', 'https://ntfy.sh'),
          ..._inp('intentsmith.notif.ntfyTopic', 'Topic', '', 'text', { placeholder: 'intentsmith-notifications' }),
          h('button', { key: 'test-ntfy', className: 'intentsmith-btn-sm intentsmith-mt-8', onClick: () => this._testNotifChannel('ntfy') }, 'Test ntfy'),

          h('h4', { key: 'notif-desktop', className: 'intentsmith-settings-h4' }, 'Desktop'),
          _tog('intentsmith.notif.desktopEnabled', 'Systémové notifikace (Electron)', true),

          h('h4', { key: 'notif-quiet', className: 'intentsmith-settings-h4' }, 'Tichý režim'),
          _tog('intentsmith.notif.quietEnabled', 'Povolit tichý režim', false),
          ..._inp('intentsmith.notif.quietFrom', 'Od', '22:00', 'time'),
          ..._inp('intentsmith.notif.quietTo', 'Do', '07:00', 'time'),
          h('p', { key: 'quiet-hint', className: 'intentsmith-hint' }, 'ERROR notifikace projdou i v tichém režimu.'),
        ];

      // ═══ Storage ═══
      case 'storage':
        setTimeout(() => this._fetchStorageInfo(), 100);
        return [
          h('div', { key: 'stor-info', className: 'intentsmith-sys-info', id: 'intentsmith-storage-info' },
            h('p', { className: 'intentsmith-gpu-loading' }, 'Loading storage info...')
          ),
          h('h4', { key: 'stor-clean', className: 'intentsmith-settings-h4' }, 'Cleanup'),
          h('div', { key: 'stor-actions', className: 'intentsmith-sys-actions' },
            h('button', { className: 'intentsmith-btn-sm', onClick: () => this._vacuumDb().then(() => this._fetchStorageInfo()) }, 'Vacuum DB'),
            h('button', { className: 'intentsmith-btn-sm', onClick: () => this._pruneOldData() }, 'Prune Old Data'),
          ),
          h('p', { key: 'stor-hint', className: 'intentsmith-hint' }, 'Vacuum komprimuje databázi. Prune smaže archivované konverzace starší 180 dní.'),
        ];

      // ═══ Backup & Sync ═══
      case 'backup': return [
        h('p', { key: 'bk-desc', className: 'intentsmith-hint' }, 'Export a import nastavení, konverzací a LTM dat.'),
        h('h4', { key: 'bk-export', className: 'intentsmith-settings-h4' }, 'Export'),
        h('div', { key: 'bk-exp-btns', className: 'intentsmith-sys-actions' },
          h('button', { className: 'intentsmith-btn-sm', onClick: () => this._exportSettings() }, 'Export Settings (JSON)'),
          h('button', { className: 'intentsmith-btn-sm', onClick: () => this._exportAll() }, 'Export All (ZIP)'),
        ),
        h('h4', { key: 'bk-import', className: 'intentsmith-settings-h4' }, 'Import'),
        h('div', { key: 'bk-imp-btns', className: 'intentsmith-sys-actions' },
          h('button', { className: 'intentsmith-btn-sm', onClick: () => this._importSettings() }, 'Import Settings'),
        ),
        h('p', { key: 'bk-warn', className: 'intentsmith-hint' }, 'Import přepíše aktuální nastavení. Doporučujeme nejdříve exportovat zálohu.'),
      ];

      // ═══ About ═══
      case 'about': return [
        h('div', { key: 'a', className: 'intentsmith-about' },
          h('div', { className: 'intentsmith-about-logo' }, 'IntentSmith'),
          h('p', { className: 'intentsmith-about-ver' }, 'v87.2.0'),
          h('p', { className: 'intentsmith-about-sub' }, 'p(AI)assistant · Local LLM Runtime'),
          h('p', { className: 'intentsmith-about-cr' }, 'Made with care by Belfik')
        )
      ];

      // ═══ Multimedia (ComfyUI) ═══
      case 'multimedia':
        setTimeout(() => this._mmFetchSettingsHealth(), 100);
        return [
          // Connection
          h('h4', { key: 'mm-conn', className: 'intentsmith-settings-h4' }, 'Připojení'),
          ..._inp('intentsmith.comfyui.baseUrl', 'ComfyUI URL', 'http://127.0.0.1:8188'),
          h('div', { key: 'mm-health', className: 'intentsmith-sys-info', id: 'intentsmith-mm-settings-health' },
            h('p', { className: 'intentsmith-gpu-loading' }, 'Zjišťuji stav ComfyUI...')
          ),
          h('button', { key: 'mm-test', className: 'intentsmith-btn-sm intentsmith-mt-8', onClick: () => this._mmFetchSettingsHealth() }, 'Test připojení'),

          // Generation defaults
          h('h4', { key: 'mm-defaults', className: 'intentsmith-settings-h4' }, 'Výchozí parametry'),
          ..._inp('intentsmith.comfyui.defaultWidth', 'Šířka (px)', '1024', 'number', { min: 64, max: 4096, step: 8 }),
          ..._inp('intentsmith.comfyui.defaultHeight', 'Výška (px)', '1024', 'number', { min: 64, max: 4096, step: 8 }),
          ..._range('intentsmith.comfyui.defaultSteps', 'Kroky', 20, 1, 150, 1, ''),
          ..._range('intentsmith.comfyui.defaultCfg', 'CFG Scale', 7.0, 0, 30, 0.5, ''),
          ..._sel('intentsmith.comfyui.defaultSampler', 'Sampler', [
            { value: 'euler', label: 'Euler' },
            { value: 'euler_ancestral', label: 'Euler Ancestral' },
            { value: 'dpmpp_2m', label: 'DPM++ 2M' },
            { value: 'dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
            { value: 'dpmpp_sde', label: 'DPM++ SDE' },
            { value: 'uni_pc', label: 'UniPC' },
          ], 'euler'),

          // Timeouts
          h('h4', { key: 'mm-timeouts', className: 'intentsmith-settings-h4' }, 'Timeouty'),
          ..._inp('intentsmith.comfyui.timeout', 'Timeout generace (ms)', '300000', 'number', { min: 30000, max: 1800000, step: 30000 }),
          h('p', { key: 'mm-to-hint', className: 'intentsmith-hint' }, '300000 ms = 5 minut. Pro video zvyšte na 600000+.'),

          // Storage
          h('h4', { key: 'mm-storage', className: 'intentsmith-settings-h4' }, 'Úložiště'),
          ..._inp('intentsmith.comfyui.maxStorageGB', 'Max úložiště (GB)', '10', 'number', { min: 1, max: 100 }),
          ..._inp('intentsmith.comfyui.maxOutputMB', 'Max velikost výstupu (MB)', '100', 'number', { min: 10, max: 2000 }),
          h('p', { key: 'mm-stor-hint', className: 'intentsmith-hint' }, 'Při překročení kvóty se automaticky smažou nejstarší neoblíbené generace.'),

          // VRAM management
          h('h4', { key: 'mm-vram', className: 'intentsmith-settings-h4' }, 'VRAM management'),
          _tog('intentsmith.comfyui.autoUnloadOllama', 'Automaticky uvolnit Ollama před generací', true),
          ..._inp('intentsmith.comfyui.vramCooldownMs', 'VRAM cooldown (ms)', '3000', 'number', { min: 0, max: 10000, step: 500 }),
          h('p', { key: 'mm-vram-hint', className: 'intentsmith-hint' }, 'Čas na uvolnění VRAM po unloadu Ollama. 3000ms je bezpečné pro RTX 30xx/40xx.'),

          // Feature toggle
          h('h4', { key: 'mm-feat', className: 'intentsmith-settings-h4' }, 'Funkce'),
          _tog('intentsmith.comfyui.enabled', 'Multimedia modul zapnutý', true),
          _tog('intentsmith.comfyui.wsProgress', 'WebSocket progress (real-time)', true),
          _tog('intentsmith.comfyui.autoRefreshModels', 'Automaticky obnovovat seznam modelů', true),
        ];

      default: return h('p', { style: { fontSize: 11, color: 'var(--intentsmith-tx-4)', padding: '4px 0' } }, 'Konfigurace bude doplněna.');
    }
  }

  // ── v87: Settings helper methods ──────────────────────────────────────────

  _m7TogglePairingScope(scope) {
    if (this._m7Pairing.status === 'loading' || this._m7Pairing.claim !== null) return;
    const selected = new Set(this._m7Pairing.selectedScopes);
    if (selected.has(scope)) selected.delete(scope);
    else selected.add(scope);
    this._m7Pairing.selectedScopes = [...selected].sort();
    this._m7Pairing.claim = null;
    this._m7Pairing.error = null;
    if (this._m7PairingTimer) clearTimeout(this._m7PairingTimer);
    this._m7PairingTimer = null;
    this.update();
  }

  async _m7IssuePairingClaim() {
    if (this._m7Pairing.status === 'loading' || this._m7Pairing.selectedScopes.length === 0) return;
    this._m7Pairing.status = 'loading';
    this._m7Pairing.claim = null;
    this._m7Pairing.error = null;
    if (this._m7PairingTimer) clearTimeout(this._m7PairingTimer);
    this._m7PairingTimer = null;
    this.update();
    try {
      const requestedScopes = [...this._m7Pairing.selectedScopes].sort();
      const response = await fetch('/api/m7/remote/pairing/claims', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes: requestedScopes }),
        signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error('pairing-request-denied');
        error.code = payload && payload.code;
        error.status = response.status;
        throw error;
      }
      const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? Object.keys(payload).sort()
        : [];
      const expectedKeys = [
        'claimCode', 'claimId', 'contract', 'expiresAt', 'pairingUri',
        'scopes', 'subjectId', 'version',
      ].sort();
      const expiresAtMs = Date.parse(payload && payload.expiresAt);
      if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)
        || payload.contract !== 'M7LocalPairingClaim'
        || payload.version !== 1
        || !/^[A-Za-z0-9_-]{22}$/.test(payload.claimCode || '')
        || !/^pairing-claim:[A-Za-z0-9_-]{24}$/.test(payload.claimId || '')
        || payload.pairingUri !== 'intentsmith://pair?code=' + payload.claimCode
        || JSON.stringify(payload.scopes) !== JSON.stringify(requestedScopes)
        || typeof payload.subjectId !== 'string' || payload.subjectId.length < 1
        || !Number.isFinite(expiresAtMs)
        || expiresAtMs <= Date.now() || expiresAtMs - Date.now() > 300000) {
        throw new Error('pairing-response-invalid');
      }
      this._m7Pairing.claim = Object.freeze({ ...payload, scopes: Object.freeze([...payload.scopes]) });
      this._m7Pairing.status = 'ready';
      this._m7PairingTimer = setTimeout(() => {
        this._m7Pairing.claim = null;
        this._m7Pairing.status = 'expired';
        this._m7Pairing.error = 'Platnost párovacího kódu vypršela. Vytvořte nový.';
        this._m7PairingTimer = null;
        this.update();
      }, Math.max(1, expiresAtMs - Date.now()));
    } catch (error) {
      this._m7Pairing.status = 'error';
      this._m7Pairing.error = error && error.code === 'M7_LOCAL_PAIRING_NOT_ACTIVE'
        ? 'VPN runtime zatím není aktivní. Připojte VPN a spusťte M7 službu.'
        : error && error.code === 'M7_LOCAL_PAIRING_AUTH_REQUIRED'
          ? 'Párování lze vydat pouze z autentizovaného lokálního Studia.'
          : 'Párovací kód se nepodařilo bezpečně vytvořit.';
    }
    this.update();
  }

  async _fetchGpuInfo() {
    const el = document.getElementById('intentsmith-gpu-info');
    if (!el) return;
    try {
      const resp = await fetch('/api/system/gpu');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const gpu = data.profile?.gpus?.[0] || {};
      const rec = data.recommendation || {};
      el.innerHTML = `
        <div class="intentsmith-gpu-row"><span>GPU</span><strong>${gpu.gpu_model || 'N/A'}</strong></div>
        <div class="intentsmith-gpu-row"><span>VRAM</span><strong>${gpu.vram_mb ? (gpu.vram_mb / 1024).toFixed(1) + ' GB' : 'N/A'}</strong></div>
        ${gpu.driver ? `<div class="intentsmith-gpu-row"><span>Driver</span><strong>${gpu.driver}</strong></div>` : ''}
        ${gpu.cuda_version ? `<div class="intentsmith-gpu-row"><span>CUDA</span><strong>${gpu.cuda_version}</strong></div>` : ''}
        <div class="intentsmith-gpu-row intentsmith-gpu-rec"><span>Recommended</span><strong>${rec.model || 'N/A'} (${rec.params || ''})</strong></div>
        ${rec.warnings?.length ? `<div class="intentsmith-gpu-warn">${rec.warnings.join('<br>')}</div>` : ''}
      `;
    } catch (err) {
      el.innerHTML = '<p class="intentsmith-gpu-err">GPU detection unavailable (backend offline?)</p>';
    }
  }

  async _loadOllamaModels() {
    try {
      const resp = await fetch('/api/system/models');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const models = data.models || [];
      const chatSel = document.getElementById('intentsmith-llm-chat-model');
      if (chatSel && models.length > 0) {
        chatSel.innerHTML = models.map(m => `<option value="${m.name}">${m.name} (${(m.size / 1e9).toFixed(1)} GB)</option>`).join('');
      }
    } catch (_) {}
  }

  async _fetchSystemInfo() {
    const el = document.getElementById('intentsmith-sys-info');
    if (!el) return;
    try {
      const resp = await fetch('/api/system/info');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      el.innerHTML = `
        <div class="intentsmith-gpu-row"><span>Version</span><strong>${data.version}</strong></div>
        <div class="intentsmith-gpu-row"><span>Platform</span><strong>${data.platform} ${data.arch}</strong></div>
        <div class="intentsmith-gpu-row"><span>Node</span><strong>${data.node_version}</strong></div>
        <div class="intentsmith-gpu-row"><span>Uptime</span><strong>${Math.round(data.uptime_seconds / 60)} min</strong></div>
        <div class="intentsmith-gpu-row"><span>RAM</span><strong>${data.memory?.process_mb} / ${data.memory?.total_mb} MB</strong></div>
        <div class="intentsmith-gpu-row"><span>DB size</span><strong>${data.db?.size_mb} MB</strong></div>
        <div class="intentsmith-gpu-row"><span>Messages</span><strong>${data.db?.tables?.messages || 0}</strong></div>
        <div class="intentsmith-gpu-row"><span>Sessions</span><strong>${data.db?.tables?.sessions || 0}</strong></div>
        <div class="intentsmith-gpu-row"><span>LTM entries</span><strong>${data.db?.tables?.memory || 0}</strong></div>
        <div class="intentsmith-gpu-row"><span>Chat model</span><strong>${data.config?.chat_model}</strong></div>
      `;
    } catch (err) {
      el.innerHTML = '<p class="intentsmith-gpu-err">System info unavailable (backend offline?)</p>';
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
    const el = document.getElementById('intentsmith-notif-channels');
    if (!el) return;
    try {
      const resp = await fetch('/api/notifications/channels');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      const channels = data.channels || [];
      el.innerHTML = channels.map(ch =>
        `<div class="intentsmith-gpu-row"><span>${ch.name}</span><strong class="${ch.configured ? 'intentsmith-notif-on' : 'intentsmith-notif-off'}">${ch.configured ? 'Active' : 'Not configured'}</strong></div>`
      ).join('');
    } catch (_) {
      el.innerHTML = '<p class="intentsmith-gpu-err">Notification service unavailable</p>';
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
    const el = document.getElementById('intentsmith-storage-info');
    if (!el) return;
    try {
      const resp = await fetch('/api/system/storage');
      if (!resp.ok) throw new Error('API error');
      const data = await resp.json();
      el.innerHTML = `
        <div class="intentsmith-gpu-row"><span>Database</span><strong>${data.db_size_mb} MB</strong></div>
        <div class="intentsmith-gpu-row"><span>Messages</span><strong>${data.messages}</strong></div>
        <div class="intentsmith-gpu-row"><span>Sessions</span><strong>${data.sessions}</strong></div>
        <div class="intentsmith-gpu-row"><span>LTM entries</span><strong>${data.ltm_entries}</strong></div>
      `;
    } catch (_) {
      el.innerHTML = '<p class="intentsmith-gpu-err">Storage info unavailable</p>';
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
    const el = document.getElementById('intentsmith-mm-settings-health');
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
          <div class="intentsmith-gpu-row"><span>Stav</span><strong class="intentsmith-notif-on">Online</strong></div>
          <div class="intentsmith-gpu-row"><span>GPU</span><strong>${gpu.name || 'N/A'}</strong></div>
          <div class="intentsmith-gpu-row"><span>VRAM</span><strong>${vramFree} / ${vramTotal} GB volné</strong></div>
          <div class="intentsmith-gpu-row"><span>Fronta</span><strong>${data.queueSize || 0} úloh</strong></div>
        `;
      } else {
        el.innerHTML = `
          <div class="intentsmith-gpu-row"><span>Stav</span><strong class="intentsmith-notif-off">Offline</strong></div>
          <div class="intentsmith-gpu-row"><span>Chyba</span><strong>${data.error || 'ComfyUI nedostupné'}</strong></div>
        `;
      }
    } catch (err) {
      el.innerHTML = '<p class="intentsmith-gpu-err">Multimedia health check selhalo (backend offline?)</p>';
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
      a.download = `intentsmith-settings-${new Date().toISOString().split('T')[0]}.json`;
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
        const ws = window.IntentSmithWS;
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

    return h('div', { className: 'intentsmith-cv' },
      // Toolbar
      h('div', { className: 'intentsmith-wiz-toolbar' },
        h('h3', null, isCreate ? '+ Nová expertyza' : `Editace: ${data.name || '?'}`),
        h('button', { className: 'intentsmith-btn-new', onClick: () => this._closeWizard() }, 'Zrušit'),
        h('button', {
          className: 'intentsmith-btn-primary',
          disabled: !data.name,
          onClick: () => this._saveWizard(),
        }, 'Uložit'),
      ),

      // Scrollable form
      h('div', { className: 'intentsmith-wizard-scroll' },
        ...sections.map(sec =>
          h('div', {
            key: sec.id,
            className: 'intentsmith-wiz-sec' + (this._wizardOpenSections[sec.id] ? ' open' : ''),
          },
            h('div', {
              className: 'intentsmith-wiz-sec-head',
              onClick: () => {
                this._wizardOpenSections[sec.id] = !this._wizardOpenSections[sec.id];
                this.update();
              },
            },
              h('span', null, sec.icon),
              h('span', null, sec.title),
              ico(CHEV),
            ),
            h('div', { className: 'intentsmith-wiz-sec-body' }, sec.render()),
          )
        ),
      ),
    );
  }

  // ═══ v130: Multimedia Generator ═════════════════════════════════════════════

  _renderMultimedia(h) {
    const mm = this._mm;
    const statusDot = mm.comfyAvailable
      ? h('span', { className: 'intentsmith-mm-status intentsmith-mm-status--on', title: 'ComfyUI dostupné' }, '\u25CF Online')
      : h('span', { className: 'intentsmith-mm-status intentsmith-mm-status--off', title: 'ComfyUI nedostupné' }, '\u25CF Offline');

    // Start health polling on first render
    if (!mm.healthTimer) {
      this._mmFetchHealth();
      mm.healthTimer = setInterval(() => this._mmFetchHealth(), 30000);
    }

    return h('div', { className: 'intentsmith-mm', key: 'multimedia' },
      // Header
      h('div', { className: 'intentsmith-mm-header' },
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
      mm.error && h('div', { className: 'intentsmith-mm-error' }, mm.error),

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
    return h('div', { className: 'intentsmith-mm-types' },
      types.map(t => h('button', {
        key: t.id,
        className: 'intentsmith-mm-type-btn' + (mm.type === t.id ? ' active' : ''),
        onClick: () => { mm.type = t.id; this.update(); },
      }, t.label))
    );
  }

  _renderMmPromptArea(h) {
    const mm = this._mm;
    return h('div', { className: 'intentsmith-mm-prompt-area' },
      h('label', null, 'Prompt'),
      h('textarea', {
        className: 'intentsmith-mm-textarea',
        rows: 4,
        placeholder: 'Popi\u0161te, co chcete vygenerovat...',
        value: mm.prompt,
        onChange: (e) => { mm.prompt = e.target.value; },
      }),
      // Collapsible negative prompt
      h('div', { className: 'intentsmith-mm-collapse-header', onClick: () => { mm.negExpanded = !mm.negExpanded; this.update(); } },
        h('span', null, (mm.negExpanded ? '\u25BE' : '\u25B8') + ' Negativn\u00ed prompt'),
      ),
      mm.negExpanded && h('textarea', {
        className: 'intentsmith-mm-textarea intentsmith-mm-textarea--neg',
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

    return h('div', { className: 'intentsmith-mm-params-section' },
      h('div', { className: 'intentsmith-mm-collapse-header', onClick: () => { mm.paramsExpanded = !mm.paramsExpanded; this.update(); } },
        h('span', null, (mm.paramsExpanded ? '\u25BE' : '\u25B8') + ' Parametry'),
      ),
      mm.paramsExpanded && h('div', { className: 'intentsmith-mm-params' },
        // Model selector
        h('div', { className: 'intentsmith-mm-param-row' },
          h('label', null, 'Model'),
          h('select', {
            className: 'intentsmith-mm-select',
            value: mm.selectedModel,
            onChange: (e) => { mm.selectedModel = e.target.value; this.update(); },
          },
            h('option', { value: '' }, '(v\u00fdchoz\u00ed)'),
            mm.models.map(m => h('option', { key: m, value: m }, m)),
          ),
          h('button', { className: 'intentsmith-mm-refresh-btn', onClick: () => this._mmRefreshModels(), title: 'Obnovit seznam' }, '\u21BB'),
        ),

        // Resolution
        h('div', { className: 'intentsmith-mm-param-row' },
          h('label', null, 'Rozli\u0161en\u00ed'),
          h('input', { type: 'number', className: 'intentsmith-mm-input-sm', value: p.width, min: 64, max: 4096, step: 8,
            onChange: (e) => { p.width = parseInt(e.target.value) || 1024; },
          }),
          h('span', { className: 'intentsmith-mm-x' }, '\u00d7'),
          h('input', { type: 'number', className: 'intentsmith-mm-input-sm', value: p.height, min: 64, max: 4096, step: 8,
            onChange: (e) => { p.height = parseInt(e.target.value) || 1024; },
          }),
        ),

        // Steps slider
        h('div', { className: 'intentsmith-mm-param-row' },
          h('label', null, 'Kroky'),
          h('input', { type: 'range', min: 1, max: 150, value: p.steps,
            onChange: (e) => { p.steps = parseInt(e.target.value); this.update(); },
          }),
          h('span', { className: 'intentsmith-mm-val' }, p.steps),
        ),

        // CFG slider
        h('div', { className: 'intentsmith-mm-param-row' },
          h('label', null, 'CFG'),
          h('input', { type: 'range', min: 0, max: 30, step: 0.5, value: p.cfg_scale,
            onChange: (e) => { p.cfg_scale = parseFloat(e.target.value); this.update(); },
          }),
          h('span', { className: 'intentsmith-mm-val' }, p.cfg_scale),
        ),

        // Seed
        h('div', { className: 'intentsmith-mm-param-row' },
          h('label', null, 'Seed'),
          h('input', { type: 'number', className: 'intentsmith-mm-input-sm', value: p.seed, min: -1,
            onChange: (e) => { p.seed = parseInt(e.target.value); },
          }),
          h('span', { className: 'intentsmith-mm-hint' }, p.seed === -1 ? '(n\u00e1hodn\u00fd)' : ''),
        ),

        // Frames (video only)
        mm.type === 'txt2vid' && h('div', { className: 'intentsmith-mm-param-row' },
          h('label', null, 'Sn\u00edmky'),
          h('input', { type: 'number', className: 'intentsmith-mm-input-sm', value: p.frames || 49, min: 1, max: 300,
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
        h('button', { className: 'intentsmith-mm-btn intentsmith-mm-btn--cancel', onClick: () => this._mmCancel() }, 'Zru\u0161it'),
      );
    } else {
      parts.push(
        h('button', {
          className: 'intentsmith-mm-btn intentsmith-mm-btn--gen' + (canGenerate ? '' : ' disabled'),
          onClick: canGenerate ? () => this._mmGenerate() : null,
          disabled: !canGenerate,
        }, 'Generovat'),
      );
    }

    // Progress bar
    if (isWorking) {
      const prog = mm.progress;
      parts.push(
        h('div', { className: 'intentsmith-mm-progress' },
          h('div', { className: 'intentsmith-mm-progress-bar' },
            h('div', { className: 'intentsmith-mm-progress-fill', style: { width: (prog.percent || 0) + '%' } }),
          ),
          h('span', { className: 'intentsmith-mm-progress-text' }, prog.text || (mm.status === 'preparing' ? 'P\u0159ipravuji GPU...' : 'Generuji...')),
        ),
      );
    }

    // Queue info
    if (mm.queueLength > 0) {
      parts.push(
        h('div', { className: 'intentsmith-mm-queue-info' }, '\u010cek\u00e1 ' + mm.queueLength + ' \u00faloh ve front\u011b'),
      );
    }

    return h('div', { className: 'intentsmith-mm-actions' }, ...parts);
  }

  _mmOutputPath(id, filename) {
    return '/api/media/output?id=' + encodeURIComponent(id)
      + '&filename=' + encodeURIComponent(filename);
  }

  _mmEnsureOutputUrl(id, filename) {
    const target = this._mmOutputPath(id, filename);
    return this._mmOutputCache.load(target)
      .then(objectUrl => {
        if (objectUrl) {
          this.update();
        }
        return objectUrl;
      });
  }

  _mmRevokeOutputUrls(id) {
    const prefix = '/api/media/output?id=' + encodeURIComponent(id) + '&';
    this._mmOutputCache.invalidateWhere(target => target.startsWith(prefix));
  }

  _mmPruneOutputUrls(generations) {
    const activeTargets = [];
    for (const generation of generations) {
      let outputs = [];
      try {
        outputs = generation.outputs ? JSON.parse(generation.outputs) : [];
      } catch (_) {}
      for (const filename of outputs) {
        activeTargets.push(this._mmOutputPath(generation.id, filename));
      }
    }
    this._mmOutputCache.retain(activeTargets);
  }

  _renderMmGallery(h) {
    const mm = this._mm;
    if (mm.history.length === 0 && mm.status === 'idle') {
      return h('div', { className: 'intentsmith-mm-empty' }, 'Zat\u00edm \u017e\u00e1dn\u00e9 generace. Zadejte prompt a klikn\u011bte Generovat.');
    }

    const items = mm.history.map(gen => {
      const outputs = gen.outputs ? JSON.parse(gen.outputs) : [];
      const firstFile = outputs[0];
      const thumbUrl = firstFile
        ? this._mmOutputCache.peek(this._mmOutputPath(gen.id, firstFile))
        : null;
      if (firstFile && !thumbUrl) {
        this._mmEnsureOutputUrl(gen.id, firstFile);
      }

      return h('div', {
        key: gen.id,
        className: 'intentsmith-mm-thumb' + (gen.status === 'failed' ? ' intentsmith-mm-thumb--failed' : '') + (gen.favorite ? ' intentsmith-mm-thumb--fav' : ''),
        title: gen.prompt,
      },
        thumbUrl
          ? h('img', { src: thumbUrl, loading: 'lazy', onClick: () => this._mmOpenFull(gen) })
          : h('div', { className: 'intentsmith-mm-thumb-placeholder' },
              gen.status === 'failed' ? '\u2716' : gen.status === 'running' ? '\u23F3' : '\u25A1'),
        h('div', { className: 'intentsmith-mm-thumb-actions' },
          h('button', {
            className: 'intentsmith-mm-fav-btn' + (gen.favorite ? ' active' : ''),
            onClick: (e) => { e.stopPropagation(); this._mmToggleFavorite(gen); },
            title: gen.favorite ? 'Odebrat z obl\u00edben\u00fdch' : 'P\u0159idat do obl\u00edben\u00fdch',
          }, gen.favorite ? '\u2605' : '\u2606'),
          h('button', {
            className: 'intentsmith-mm-del-btn',
            onClick: (e) => { e.stopPropagation(); this._mmDelete(gen); },
            title: 'Smazat',
          }, '\u2716'),
        ),
      );
    });

    return h('div', { className: 'intentsmith-mm-gallery-section' },
      h('h3', null, 'Historie'),
      h('div', { className: 'intentsmith-mm-gallery' }, ...items),
      mm.history.length >= (mm.historyPage + 1) * 20 && h('button', {
        className: 'intentsmith-mm-load-more',
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
          this._mmPruneOutputUrls(mm.history);
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
    if (!outputs[0]) return;
    const target = this._mmOutputPath(gen.id, outputs[0]);
    const existing = this._mmOutputCache.peek(target);
    if (existing) {
      window.open(existing, '_blank', 'noopener,noreferrer');
      return;
    }

    const pendingWindow = window.open('about:blank', '_blank');
    if (pendingWindow) pendingWindow.opener = null;
    this._mmEnsureOutputUrl(gen.id, outputs[0]).then(objectUrl => {
      if (!objectUrl) {
        if (pendingWindow) pendingWindow.close();
        return;
      }
      if (pendingWindow) {
        pendingWindow.location.replace(objectUrl);
      } else {
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
      }
    });
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
      this._mmRevokeOutputUrls(gen.id);
      this.update();
    } catch (_) {}
  }

  dispose() {
    this._mmOutputCache.clear();
    super.dispose();
  }

  _selectItem(id, type, item) {
    this._selectedItem = id;
    this.update();
    // Emit event for detail panel
    const event = new CustomEvent('intentsmith-item-selected', {
      detail: { id, type, item },
      bubbles: true
    });
    this.node.dispatchEvent(event);
  }
}

/* ═══ ViewContribution ═══ */
class IntentSmithCenterViewsContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: INTENTSMITH_CENTER_ID,
      widgetName: 'IntentSmith Views',
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: 'intentsmithCenterViews:toggle'
    });
  }

  async initializeLayout(app) {
    await this.openView({ activate: true, reveal: true });
  }
}

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(IntentSmithCenterViewsWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: INTENTSMITH_CENTER_ID,
    createWidget: () => ctx.container.get(IntentSmithCenterViewsWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, IntentSmithCenterViewsContribution);
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithCenterViewsContribution);
});
