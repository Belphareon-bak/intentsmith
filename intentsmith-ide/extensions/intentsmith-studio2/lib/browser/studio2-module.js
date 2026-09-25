'use strict';

require('./styles/tokens.css');
require('./styles/studio2.css');

const { ContainerModule, decorate, injectable } = require('@theia/core/shared/inversify');
const browser = require('@theia/core/lib/browser');
const { ReactWidget } = require('@theia/core/lib/browser/widgets/react-widget');
const React = require('@theia/core/shared/react');
const { currentMode, selectMode } = require('./studio-mode-module');
const { SessionStore } = require('./session-store');
const { TransportAdapter } = require('./transport-adapter');
const { renderSessionView } = require('./session-view');
const { CatalogStore } = require('./catalog-store');
const { renderCatalog } = require('./catalog-view');
const { AppearanceStore, STYLES } = require('./appearance-store');
const { renderSettings } = require('./settings-view');
const { WorkspaceFiles } = require('./workspace-files');
const { M2Controller } = require('./m2-controller');

const WIDGET_ID = 'intentsmith-studio2';
const h = React.createElement;
const NAV = ['Konverzace', 'Projekty', 'Specialisté', 'Expertýzy', 'Workeři', 'Obchod', 'Multimédia'];

class Studio2Widget extends ReactWidget {
  constructor() {
    super();
    this.id = WIDGET_ID;
    this.title.label = 'Studio 2';
    this.title.closable = false;
    this.node.tabIndex = 0;
    this.addClass('intentsmith-studio2-widget');
    this.store = new SessionStore(window.localStorage);
    this.transport = null;
    this.section = 'Relace';
    this.catalog = new CatalogStore();
    this.workspace = new WorkspaceFiles({ onChange: () => this.update() });
    this.m2 = new M2Controller(this.store, { onChange: () => this.update(),
      activeTurn: session => !!session.chat._thinking || !!this.transport?.hasActiveM1Turn(session) });
    this.appearance = new AppearanceStore(window.localStorage, () => window.matchMedia('(prefers-color-scheme: light)').matches);
    this.unlistenAppearance = this.appearance.subscribe(() => this.update());
    this.systemTheme = window.matchMedia('(prefers-color-scheme: light)');
    this.onSystemTheme = () => this.update();
    this.systemTheme.addEventListener('change', this.onSystemTheme);
    this.catalogSearch = '';
    this.catalogLayout = 'tiles';
    this.catalogSelection = null;
    this.catalogActionError = null;
    this.unlistenCatalog = this.catalog.subscribe(() => this.update());
    this.sideMode = 'Soubory';
    this.bottomMode = 'Průběh';
    this.unlistenStore = this.store.subscribe(() => this.update());
  }

  onAfterAttach(message) {
    super.onAfterAttach(message);
    if (!this.transport) this.transport = new TransportAdapter(this.store, this.workspace);
    this.update();
  }

  dispose() {
    if (this.transport) { this.transport.destroy(); this.transport = null; }
    if (this.unlistenStore) { this.unlistenStore(); this.unlistenStore = null; }
    if (this.unlistenCatalog) { this.unlistenCatalog(); this.unlistenCatalog = null; }
    if (this.unlistenAppearance) { this.unlistenAppearance(); this.unlistenAppearance = null; }
    if (this.systemTheme) this.systemTheme.removeEventListener('change', this.onSystemTheme);
    super.dispose();
  }

  addSession() { this.store.addSession(); this.section = 'Relace'; this.update(); }
  closeSession(session) {
    if (this.m2.entry(session).busy) {
      window.alert('Počkejte na výsledek M2 nebo načtěte trvalý stav před zavřením relace.');
      return false;
    }
    if (this.workspace.entry(session).editor?.dirty) {
      this.sideMode = 'Soubory'; this.update();
      window.alert('Nejprve uložte nebo zahoďte neuložené změny souboru.');
      return false;
    }
    return this.store.closeSession(session.id);
  }
  selectSection(name) {
    this.section = name; this.catalogSearch = ''; this.catalogSelection = null; this.catalogActionError = null;
    if (NAV.includes(name)) this.catalog.load(name);
    this.update();
  }
  async openCatalogItem(section, item) {
    if (section !== 'Konverzace' && section !== 'Projekty') return;
    this.catalogActionError = null;
    try {
      if (section === 'Konverzace') {
        const existing = this.store.state.sessions.find(session => session._convId === item.id);
        if (existing) { this.store.focusTab(existing.id); this.section = 'Relace'; this.update(); return; }
        const route = '/api/conversations/' + encodeURIComponent(item.id);
        const metadataBody = await this.catalog.get(route);
        const metadata = metadataBody.conversation || metadataBody;
        if (metadata.id !== item.id) throw new Error('Server vrátil jinou konverzaci.');
        const body = await this.catalog.get(route + '/messages');
        const rows = Array.isArray(body) ? body : body.messages;
        if (!Array.isArray(rows)) throw new Error('Server nevrátil platnou historii.');
        this.store.addSession({ convId: item.id, projectId: metadata.project_id, label: metadata.title || item.name,
          recentMsgs: rows.map(row => ({ role: row.role, text: row.content || row.text || '' })) });
      } else {
        const response = await fetch(this.catalog.backendUrl() + '/api/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: item.raw.id, title: item.name }), signal: AbortSignal.timeout(8000),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Vytvoření relace selhalo (HTTP ${response.status}).`);
        const conversation = body.conversation || body;
        if (!conversation.id || String(conversation.project_id) !== String(item.raw.id)) throw new Error('Server nepotvrdil správný projekt konverzace.');
        const session = this.store.addSession({ convId: conversation.id, projectId: item.raw.id, label: item.name });
        this.workspace.loadTree(session);
      }
      this.section = 'Relace'; this.update();
    } catch (error) { this.catalogActionError = error.message || 'Relaci se nepodařilo otevřít.'; this.update(); }
  }
  async completeTerminal(session, input) {
    try {
      const result = await this.workspace.completePath(session, input.value);
      if (result !== null) input.value = result;
    } catch { /* Completion is optional; keep the user's command intact. */ }
  }
  async sendTerminal(session, input) {
    if (await this.transport?.sendTerminal(session, input.value)) input.value = '';
  }
  send(session, textarea) {
    const value = textarea.value.trim();
    if (value && this.m2.handleText(session, value)) { textarea.value = ''; return; }
    if (value && this.transport?.send(session, value)) textarea.value = '';
  }

  render() {
    const state = this.store.state;
    const view = renderSessionView(this, h);
    const appearance = this.appearance.values;
    const font = appearance.style === 'matrix' ? 'Share Tech Mono, JetBrains Mono, monospace'
      : appearance.style === 'japanese' ? 'Zen Kaku Gothic Antique, system-ui, sans-serif'
      : appearance.style === 'midnight' ? 'Inter, system-ui, sans-serif'
      : appearance.fontIdx === 1 ? 'Inter, system-ui, sans-serif'
      : appearance.fontIdx === 2 ? 'system-ui, sans-serif' : 'Plus Jakarta Sans, system-ui, sans-serif';
    return h('div', { className: `intentsmith-studio2-root intentsmith-root ide ${this.appearance.classes()}`,
      style: { fontSize: `${appearance.fontSizeVal * Number(appearance.uiScale)}px`, fontFamily: font }, 'data-studio-ui': 'studio2' },
      h('header', { className: 'intentsmith-studio2-top' },
        h('span', { className: 'intentsmith-studio2-brand' }, 'IntentSmith'),
        h('span', null, 'Studio 2'),
        h('span', { className: 'intentsmith-studio2-top-spacer' }),
        h('select', { 'aria-label': 'Styl Studia 2', value: appearance.style, onChange: event => this.appearance.set('style', event.target.value) },
          STYLES.map(style => h('option', { key: style, value: style }, style))),
        h('button', { type: 'button', 'aria-label': 'Přepnout světlý a tmavý motiv',
          disabled: ['matrix','japanese','midnight'].includes(appearance.style),
          onClick: () => this.appearance.set('theme', this.appearance.effectiveTheme() === 'dark' ? 'light' : 'dark') },
          this.appearance.effectiveTheme() === 'dark' ? 'Tmavý' : 'Světlý'),
        [1, 2, 3].map(count => h('button', { key: count, type: 'button', disabled: count > state.sessions.length,
          className: count === state.columns.length ? 'active' : '', onClick: () => this.store.setColumnCount(count),
          'aria-label': `${count} sloupce` }, count)),
        h('button', { type: 'button', onClick: () => selectMode('classic') }, 'Klasické Studio')),
      h('div', { className: 'intentsmith-studio2-main' },
        h('nav', { className: 'intentsmith-studio2-nav', 'aria-label': 'Hlavní navigace' },
          h('span', { className: 'intentsmith-studio2-nav-label' }, 'Pracovní prostor'),
          NAV.map(name => h('button', { key: name, type: 'button', className: name === this.section ? 'active' : '',
            onClick: () => this.selectSection(name) }, name)),
          h('div', { className: 'intentsmith-studio2-nav-bottom' },
            h('button', { type: 'button', onClick: () => this.selectSection('Nastavení') }, 'Nastavení'))),
        h('main', { className: 'intentsmith-studio2-center' },
          view.tabs,
          this.section === 'Relace' ? view.columns : NAV.includes(this.section) ? renderCatalog(this, h)
            : renderSettings(this, h)),
        this.section === 'Relace' ? view.right : null),
      h('footer', { className: 'intentsmith-studio2-foot' },
        h('span', null, view.connection),
        h('span', null, this.transport?.serverVersion ? `Backend ${this.transport.serverVersion}` : 'Backend není potvrzený'),
        h('span', null, `${state.sessions.length} relací`)));
  }
}
decorate(injectable(), Studio2Widget);

class Studio2Contribution extends browser.AbstractViewContribution {
  constructor() {
    super({ widgetId: WIDGET_ID, widgetName: 'Studio 2', defaultWidgetOptions: { area: 'main' } });
  }
  async initializeLayout(app) {
    if (currentMode() !== 'studio2') throw new Error('Studio 2 widget loaded in classic mode');
    await this.openView({ activate: true, reveal: true });
  }
  onWillStop() {
    const widget = this.tryGetWidget();
    if (!widget?.workspace?.anyDirty()) return undefined;
    return { reason: 'Studio 2 has unsaved file edits', action: () => {
      widget.sideMode = 'Soubory'; widget.update();
      window.alert('Nejprve uložte nebo zahoďte neuložené změny souboru.');
      return false;
    } };
  }
  async onDidInitializeLayout(app) {
    if (currentMode() !== 'studio2') throw new Error('Studio 2 widget restored in classic mode');
    // A saved classic layout skips initializeLayout; attach the selected UI
    // after restoration without ever registering the classic widget factory.
    await this.openView({ activate: true, reveal: true });
    // The host may restore built-in side views; they are not part of Studio 2.
    for (const side of ['leftPanelHandler', 'rightPanelHandler', 'bottomPanelHandler']) {
      app.shell[side]?.container?.hide();
    }
  }
}
decorate(injectable(), Studio2Contribution);

module.exports = {
  default: new ContainerModule(bind => {
    bind(Studio2Widget).toSelf();
    bind(browser.WidgetFactory).toDynamicValue(ctx => ({
      id: WIDGET_ID,
      createWidget: () => ctx.container.get(Studio2Widget),
    })).inSingletonScope();
    browser.bindViewContribution(bind, Studio2Contribution);
    bind(browser.FrontendApplicationContribution).toService(Studio2Contribution);
  }),
};
