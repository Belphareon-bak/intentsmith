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
    if (!this.transport) this.transport = new TransportAdapter(this.store);
    this.update();
  }

  dispose() {
    if (this.transport) { this.transport.destroy(); this.transport = null; }
    if (this.unlistenStore) { this.unlistenStore(); this.unlistenStore = null; }
    if (this.unlistenCatalog) { this.unlistenCatalog(); this.unlistenCatalog = null; }
    super.dispose();
  }

  addSession() { this.store.addSession(); this.section = 'Relace'; this.update(); }
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
        this.store.addSession({ convId: conversation.id, projectId: item.raw.id, label: item.name });
      }
      this.section = 'Relace'; this.update();
    } catch (error) { this.catalogActionError = error.message || 'Relaci se nepodařilo otevřít.'; this.update(); }
  }
  send(session, textarea) {
    const value = textarea.value.trim();
    if (value && this.transport?.send(session, value)) textarea.value = '';
  }

  render() {
    const state = this.store.state;
    const view = renderSessionView(this, h);
    return h('div', { className: 'intentsmith-studio2-root intentsmith-root ide th-intentsmith-dark', 'data-studio-ui': 'studio2' },
      h('header', { className: 'intentsmith-studio2-top' },
        h('span', { className: 'intentsmith-studio2-brand' }, 'IntentSmith'),
        h('span', null, 'Studio 2'),
        h('span', { className: 'intentsmith-studio2-top-spacer' }),
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
            : h('div', { className: 'intentsmith-studio2-empty' }, h('strong', null, this.section),
              h('p', null, 'Nastavení této sekce ještě není připojené.'))),
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
