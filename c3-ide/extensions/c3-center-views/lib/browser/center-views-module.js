"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-center.css");
require("./styles/c3-pro-theme.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");
const URI = require("@theia/core/lib/common/uri").default;
const opener_service_1 = require("@theia/core/lib/browser/opener-service");

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
  { id: 'user', icon: '👤', title: 'User / Identity' },
  { id: 'notif', icon: '🔔', title: 'Notifications' },
  { id: 'appearance', icon: '🎨', title: 'Appearance' },
  { id: 'memory', icon: '🧠', title: 'Memory & Context' },
  { id: 'location', icon: '📍', title: 'Location' },
  { id: 'output', icon: '📄', title: 'Output & Formats' },
  { id: 'system', icon: '🖥️', title: 'System' },
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
  }

  render() {
    const h = React.createElement;
    const v = this._view;

    // v63.0: Wizard mode intercepts rendering
    if (this._wizardMode) return this._renderWizard(h);

    if (v === 'settings') return this._renderSettings(h);
    return h('div', { className: 'c3-cv' },
      this._renderBar(h, v),
      this._renderGrid(h, v)
    );
  }

  _renderBar(h, view) {
    const titles = { chats: 'Konverzace', projects: 'Projekty', specialists: 'Specialisté', expertises: 'Expertyzy', workers: 'Workeri' };
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
    switch (secId) {
      case 'user': return [
        h('label', { key: 'n', className: 'c3-label' }, 'Jméno'),
        h('input', { key: 'ni', className: 'c3-input', defaultValue: 'Belfik' }),
        h('label', { key: 's', className: 'c3-label' }, 'Session scope'),
        h('div', { key: 'sr', className: 'c3-radios' },
          ['Osobní', 'Pracovní', 'Anonymní'].map(r =>
            h('label', { key: r, className: 'c3-radio' },
              h('input', { type: 'radio', name: 'scope', defaultChecked: r === 'Osobní' }), ' ', r
            )
          )
        )
      ];
      case 'system': return [
        h('label', { key: 'm', className: 'c3-label' }, 'Model'),
        h('select', { key: 'ms', className: 'c3-select' },
          h('option', null, 'qwen2.5:32b')
        ),
        h('label', { key: 'o', className: 'c3-label' }, 'Ollama URL'),
        h('input', { key: 'oi', className: 'c3-input', defaultValue: 'http://localhost:11434' })
      ];
      case 'appearance': return [
        h('p', { key: 'td', style: { fontSize: 11, color: 'var(--c3-tx-4)' } },
          'Nastavení vzhledu je v hlavním Appearance panelu.')
      ];
      case 'about': return [
        h('div', { key: 'a', style: { textAlign: 'center', padding: '8px 0' } },
          h('div', { style: { width: 32, height: 32, background: 'linear-gradient(135deg,#22c55e,#16a34a)', borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#fff' } }, 'C3'),
          h('p', { style: { fontSize: 12, color: 'var(--c3-tx-3)', marginTop: 6 } }, 'v0.1.0 · Made with ❤️ by Belfik')
        )
      ];
      default: return h('p', { style: { fontSize: 11, color: 'var(--c3-tx-4)', padding: '4px 0' } }, 'Konfigurace bude doplněna.');
    }
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
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => {
    // Expose OpenerService for vanilla JS (file editing via Monaco)
    try {
      var openerService = ctx.container.get(opener_service_1.OpenerService);
      window._c3OpenFileInEditor = function(filePath) {
        try {
          var uri = new URI(filePath);
          openerService.getOpener(uri).then(function(opener) {
            return opener.open(uri, { mode: 'activate' });
          });
        } catch(err) {
          console.warn('[C3] Editor open failed:', err);
        }
      };
    } catch(e) {
      console.warn('[C3] OpenerService not available:', e);
    }

    return {
      id: C3_CENTER_ID,
      createWidget: () => ctx.container.get(C3CenterViewsWidget)
    };
  }).inSingletonScope();

  browser_1.bindViewContribution(bind, C3CenterViewsContribution);
  bind(browser_1.FrontendApplicationContribution).toService(C3CenterViewsContribution);
});
