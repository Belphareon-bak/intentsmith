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
    this.section = 'Konverzace';
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
    super.dispose();
  }

  addSession() { this.store.addSession(); this.section = 'Konverzace'; this.update(); }
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
            onClick: () => { this.section = name; this.update(); } }, name)),
          h('div', { className: 'intentsmith-studio2-nav-bottom' },
            h('button', { type: 'button', onClick: () => { this.section = 'Nastavení'; this.update(); } }, 'Nastavení'))),
        h('main', { className: 'intentsmith-studio2-center' },
          view.tabs,
          this.section === 'Konverzace' ? view.columns : h('div', { className: 'intentsmith-studio2-empty' },
            h('strong', null, this.section), h('p', null, 'Katalog této sekce ještě není připojený.'))),
        this.section === 'Konverzace' ? view.right : null),
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
