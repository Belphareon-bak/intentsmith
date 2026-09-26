'use strict';

require('./styles/tokens.css');
require('./styles/studio2.css');
require('./view/view.css');
require('./view/generated/proto.css');

const { ContainerModule, decorate, injectable } = require('@theia/core/shared/inversify');
const browser = require('@theia/core/lib/browser');
const { ReactWidget } = require('@theia/core/lib/browser/widgets/react-widget');
const React = require('@theia/core/shared/react');
const { currentMode } = require('./studio-mode-module');
const { SessionStore } = require('./session-store');
const { TransportAdapter } = require('./transport-adapter');
const { renderSessionView } = require('./session-view');
const { CatalogStore } = require('./catalog-store');
const { renderCatalog } = require('./catalog-view');
const { AppearanceStore } = require('./appearance-store');
const { renderSettings } = require('./settings-view');
const { WorkspaceFiles } = require('./workspace-files');
const { M2Controller } = require('./m2-controller');
const { renderPalette } = require('./command-palette');
const { renderChrome, renderNavigation } = require('./chrome-view');
const Attachments = require('./attachments');
const { StudioRoot, createModel } = require('./view/studio-root');

const WIDGET_ID = 'intentsmith-studio2';
const h = React.createElement;
const NAV = ['Konverzace', 'Projekty', 'Specialisté', 'Expertýzy', 'Workeři', 'Obchod', 'Multimédia'];
// Vizuální vrstva z prototypu (view/) je výchozí. Původní ruční render zůstává jen
// po dobu integrace pro porovnání: localStorage 'intentsmith-studio2-view' = 'legacy'.
const VIEW_KEY = 'intentsmith-studio2-view';

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
    this.workspace = new WorkspaceFiles({ onChange: () => { this.model?.forceUpdate(); this.update(); } });
    this.m2 = new M2Controller(this.store, { onChange: () => { this.model?.forceUpdate(); this.update(); },
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
    this.paletteOpen = false; this.paletteQuery = ''; this.menuOpen = null;
    this.navVisible = true; this.bottomVisible = true; this.rightVisible = true;
    this.onPaletteKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); event.stopPropagation(); this.paletteOpen = true; this.paletteQuery = ''; this.update();
      } else if (event.key === 'Escape' && (this.paletteOpen || this.menuOpen)) {
        event.preventDefault(); this.paletteOpen = false; this.menuOpen = null; this.update();
      }
    };
    this.sideMode = 'Soubory';
    this.bottomMode = 'Průběh';
    this.unlistenStore = this.store.subscribe(() => this.update());
    this.legacyView = window.localStorage.getItem(VIEW_KEY) === 'legacy';
    this.model = this.legacyView ? null : createModel(this);
  }

  onAfterAttach(message) {
    super.onAfterAttach(message);
    if (!this.transport) this.transport = new TransportAdapter(this.store, this.workspace);
    if (this.legacyView) window.addEventListener('keydown', this.onPaletteKey, true);
    this.update();
  }

  dispose() {
    window.removeEventListener('keydown', this.onPaletteKey, true);
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
        if (existing) { this.store.focusTab(existing.id); this.section = 'Relace'; this.update(); return true; }
        const route = '/api/conversations/' + encodeURIComponent(item.id);
        const metadataBody = await this.catalog.get(route);
        const metadata = metadataBody.conversation || metadataBody;
        if (String(metadata.id) !== item.id) throw new Error('Server vrátil jinou konverzaci.');
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
      return true;
    } catch (error) { this.catalogActionError = error.message || 'Relaci se nepodařilo otevřít.'; this.update(); return false; }
  }
  async openSpecialist(item) {
    this.catalogActionError = null;
    const id = item?.id === 'accountant' ? 'accountant-cz' : item?.id;
    if (!id) return false;
    if (item.raw?.status && item.raw.status !== 'enabled') {
      this.catalogActionError = 'Specialista je vypnutý. Zapni ho v detailu katalogu.';
      this.update();
      return false;
    }
    const existing = this.store.state.sessions.find(session => session.chat.specialist?.id === id);
    if (existing) { this.store.focusTab(existing.id); this.update(); return true; }
    const sessionId = 'studio-specialist-' + crypto.randomUUID();
    try {
      const response = await fetch(this.catalog.backendUrl() + '/api/chat/specialist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialistId: id, sessionId }), signal: AbortSignal.timeout(8000),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true || body.specialistId !== id)
        throw new Error(body.error || 'Backend nepotvrdil specialistu.');
      const specialist = { ...item.raw, id, name: item.name };
      this.store.addSession({ convId: sessionId, label: item.name, specialistData: specialist, expertiseName: item.name });
      this.section = 'Relace'; this.update(); return true;
    } catch (error) { this.catalogActionError = error.message || 'Specialistu nelze aktivovat.'; this.update(); return false; }
  }
  async openSpecialistConversation(specialistId, item) {
    const specialist = this.catalog.view('Specialisté').items.find(row => row.id === specialistId);
    if (!specialist || !item || typeof item.id !== 'string' || !item.id) {
      this.catalogActionError = 'Specialistu nebo konverzaci nelze ověřit.';
      this.update(); return false;
    }
    if (specialist.raw?.status !== 'enabled') {
      this.catalogActionError = 'Specialista je vypnutý. Zapni ho před obnovením konverzace.';
      this.update(); return false;
    }
    try {
      const response = await fetch(this.catalog.backendUrl() + '/api/chat/specialist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ specialistId, sessionId: item.id }), signal: AbortSignal.timeout(8000),
      });
      const body = await response.json();
      if (!response.ok || body.ok !== true || body.specialistId !== specialistId)
        throw Error(body.error || 'Backend nepotvrdil specialistu konverzace.');
      if (!await this.openCatalogItem('Konverzace', item)) return false;
      const session = this.store.state.sessions.find(row => row._convId === item.id);
      if (!session) throw Error('Konverzace se neotevřela jako relace.');
      session.chat.specialist = { ...specialist.raw, id: specialistId, name: specialist.name };
      session.chat.expertise = specialist.name;
      this.store.changed();
      return true;
    } catch (error) {
      this.catalogActionError = error?.message || 'Konverzaci specialisty nelze obnovit.';
      this.update(); return false;
    }
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
  async pickAttachments(session) {
    if (session.chat._picking || session.chat._preparing) return;
    const origin = { projectId: session._projectId, convId: session._convId, chat: session.chat };
    session.chat._picking = true; this.store.changed();
    try {
      const result = await Attachments.selectFiles(session, window.electronIntentSmith,
        () => !session._closed && this.store.find(session.id) === session
          && session.chat === origin.chat && session._projectId === origin.projectId
          && session._convId === origin.convId);
      session.chat._attachmentError = result.refused.join('; ');
    } finally { session.chat._picking = false; this.store.changed(); }
  }
  async send(session, textarea) {
    if (session.chat._selectingExpertise) {
      session.chat._attachmentError = 'Čekám na potvrzení výběru expertýz; zpráva nebyla odeslána.';
      this.store.changed(); return;
    }
    const value = textarea.value.trim();
    if (session.chat.attachments.length && /^\/m2-(?:draft|build|plan|status|approve|cancel)(?:\s|$)/i.test(value)) {
      session.chat._attachmentError = 'M2 příkazy nepřijímají přílohy. Odeberte je před pokračováním.';
      this.store.changed(); return;
    }
    if (value && this.m2.handleText(session, value)) { textarea.value = ''; return; }
    const selected = session.chat.attachments.slice();
    if ((!value && !selected.length) || session.chat._preparing || session.chat._picking) return;
    const identity = { convId: session._convId, projectId: session._projectId, agentId: session._agentId,
      editMode: session.chat.editMode, messages: session.chat.msgs, messageCount: session.chat.msgs.length };
    session.chat._preparing = true; this.store.changed();
    try {
      const prepared = await Attachments.prepare(selected);
      if (session._closed || this.store.find(session.id) !== session || textarea.value.trim() !== value
        || session.chat.attachments.length !== selected.length
        || selected.some((item, index) => session.chat.attachments[index] !== item)
        || session._convId !== identity.convId || session._projectId !== identity.projectId
        || session._agentId !== identity.agentId || session.chat.editMode !== identity.editMode
        || session.chat.msgs !== identity.messages || session.chat.msgs.length !== identity.messageCount) {
        session.chat._attachmentError = 'Relace nebo rozepsaná zpráva se během čtení změnila. Nic se neodeslalo.';
        return;
      }
      const content = selected.length ? `${value ? value + '\n' : ''}📎 ${selected.map(item => item.name).join(', ')}` : value;
      if (this.transport?.send(session, content, prepared)) {
        textarea.value = ''; session.chat.attachments = []; session.chat._attachmentError = '';
      }
    } catch (error) {
      session.chat._attachmentError = error?.message || 'Přílohu nelze přečíst. Nic se neodeslalo.';
    } finally { session.chat._preparing = false; this.store.changed(); }
  }

  render() {
    if (!this.legacyView) return h(StudioRoot, { model: this.model });
    return this.renderLegacy();
  }

  renderLegacy() {
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
      renderChrome(this, h, NAV),
      h('div', { className: 'intentsmith-studio2-main' },
        renderNavigation(this, h, NAV),
        h('main', { className: 'intentsmith-studio2-center' },
          view.tabs,
          this.section === 'Relace' ? view.columns : NAV.includes(this.section) ? renderCatalog(this, h)
            : renderSettings(this, h)),
        this.section === 'Relace' && this.rightVisible ? view.right : null),
      renderPalette(this, h),
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
    // Studio 2 owns its tabs and status line. Keep Theia as the host without
    // displaying a second tab strip and status bar around its workbench.
    const widget = this.tryGetWidget();
    app.shell.mainPanel.findTabBar(widget?.title)?.hide();
    app.shell.statusBar.hide();
    // The host may restore built-in side views; they are not part of Studio 2.
    for (const side of ['leftPanelHandler', 'rightPanelHandler', 'bottomPanelHandler']) {
      app.shell[side]?.container?.hide();
    }
    // Lumino keeps the hidden tab bar's height reserved until the dock layout refits.
    app.shell.mainPanel.fit();
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
