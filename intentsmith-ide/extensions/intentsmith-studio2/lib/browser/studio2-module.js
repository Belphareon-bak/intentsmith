'use strict';

require('./view/view.css');
require('./view/generated/proto.css');

const { ContainerModule, decorate, injectable } = require('@theia/core/shared/inversify');
const browser = require('@theia/core/lib/browser');
const { ReactWidget } = require('@theia/core/lib/browser/widgets/react-widget');
const React = require('@theia/core/shared/react');
const FRAME_KEY = 'intentsmith-studio2-frame';
const { SessionStore, sessionCloseBlock } = require('./session-store');
const { TransportAdapter } = require('./transport-adapter');
const { CatalogStore } = require('./catalog-store');
const { AppearanceStore } = require('./appearance-store');
const { WorkspaceFiles } = require('./workspace-files');
const { M2Controller } = require('./m2-controller');
const Attachments = require('./attachments');
const { StudioRoot, createModel } = require('./view/studio-root');

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
    const refreshVerifiedProject = session => {
      if (!session?._projectId || !this.model) return;
      this.model.scmClient.entry(session._projectId).diffs.clear();
      void this.model.scmClient.load(session._projectId, { refresh: true });
    };
    this.workspace = new WorkspaceFiles({ onChange: () => { this.model?.forceUpdate(); this.update(); },
      onRestored: () => this.store.changed(),
      onVerifiedChange: refreshVerifiedProject });
    this.m2 = new M2Controller(this.store, { onChange: () => { this.model?.forceUpdate(); this.update(); },
      onVerifiedChange: refreshVerifiedProject,
      onOpenComposer: session => this.model?.pM2Open(this.model.st(), session.id),
      activeTurn: session => !!session.chat._thinking || !!session.chat._preparing || !!session.chat._picking || !!session.chat._selectingExpertise || !!this.transport?.hasActiveM1Turn(session) });
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
    this.sideMode = 'Soubory';
    this.bottomMode = 'Průběh';
    this.unlistenStore = this.store.subscribe(() => this.update());
    this.model = createModel(this);
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

  closeBlockReason(session) {
    return sessionCloseBlock(session, {
      activeTurn: this.transport?.hasActiveM1Turn(session), m2Busy: this.m2.entry(session).busy,
      terminalExecuting: this.transport?.isTerminalExecuting(session),
      editorDirty: this.workspace.entry(session).editor?.dirty, state: this.model?.st() || {},
    });
  }
  capacityAvailable() {
    if (this.store.canAddSession(session => !this.closeBlockReason(session))) return true;
    this.catalogActionError = `Je otevřeno ${this.store.state.sessions.length} relací. Skryté relace pracují, čekají na schválení nebo mají neuloženou práci; nejprve některou bezpečně ukonči.`;
    const toast = { id: 'cap-' + Date.now(), tone: 'warn', t: this.catalogActionError };
    this.model?.setState({ toast }); this.model?.armToast({ toast });
    this.update();
    return false;
  }
  createSession(source = {}, slot) {
    if (!this.capacityAvailable()) return null;
    const previous = this.store.state.sessions.slice();
    const names = new Map(previous.map(item => [item.id, this.model?.sess(item.id)?.short || item._label]));
    const session = this.store.addSession(source, { slot, canClose: item => !this.closeBlockReason(item) });
    if (!session) return null;
    const evicted = previous.find(item => !this.store.find(item.id));
    if (evicted) {
      const toast = { id: 'closed-' + Date.now(), tone: 'info',
        t: `Relace „${names.get(evicted.id)}“ se zavřela; její konverzace zůstává v historii.` };
      this.model?.setState({ toast }); this.model?.armToast({ toast });
      void this.catalog.load('Konverzace');
    }
    this.section = 'Relace'; this.update();
    return session;
  }
  addSession(slot) { return this.createSession({}, slot); }
  closeSession(session) {
    const reason = this.closeBlockReason(session);
    if (reason) { window.alert(reason); return false; }
    const closed = this.store.closeSession(session.id);
    if (closed) void this.catalog.load('Konverzace');
    return closed;
  }
  selectSection(name) {
    this.section = name; this.catalogSearch = ''; this.catalogSelection = null; this.catalogActionError = null;
    if (NAV.includes(name)) this.catalog.load(name);
    this.update();
  }
  async openCatalogItem(section, item, slot) {
    if (section !== 'Konverzace' && section !== 'Projekty') return;
    this.catalogActionError = null;
    try {
      if (section === 'Konverzace') {
        const existing = this.store.state.sessions.find(session => session._convId === item.id);
        if (existing) { this.store.focusTab(existing.id); this.section = 'Relace'; this.update(); return true; }
        if (!this.capacityAvailable()) return false;
        const route = '/api/conversations/' + encodeURIComponent(item.id);
        const metadataBody = await this.catalog.get(route);
        const metadata = metadataBody.conversation || metadataBody;
        if (String(metadata.id) !== item.id) throw new Error('Server vrátil jinou konverzaci.');
        const body = await this.catalog.get(route + '/messages');
        const rows = Array.isArray(body) ? body : body.messages;
        if (!Array.isArray(rows)) throw new Error('Server nevrátil platnou historii.');
        if (!this.createSession({ convId: item.id, projectId: metadata.project_id, label: metadata.title || item.name,
          recentMsgs: rows.map(row => ({ role: row.role, text: row.content || row.text || '' })) }, slot)) return false;
      } else {
        if (!this.capacityAvailable()) return false;
        const response = await fetch(this.catalog.backendUrl() + '/api/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: item.raw.id, title: item.name }), signal: AbortSignal.timeout(8000),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `Vytvoření relace selhalo (HTTP ${response.status}).`);
        const conversation = body.conversation || body;
        if (!conversation.id || String(conversation.project_id) !== String(item.raw.id)) throw new Error('Server nepotvrdil správný projekt konverzace.');
        const session = this.createSession({ convId: conversation.id, projectId: item.raw.id, label: item.name }, slot);
        if (!session) throw Error('Relaci nelze bezpečně otevřít. Konverzace je uložená v historii.');
        this.workspace.loadTree(session);
      }
      this.section = 'Relace'; this.update();
      return true;
    } catch (error) { this.catalogActionError = error.message || 'Relaci se nepodařilo otevřít.'; this.update(); return false; }
  }
  async openSpecialist(item, slot) {
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
    if (!this.capacityAvailable()) return false;
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
      if (!this.createSession({ convId: sessionId, label: item.name, specialistData: specialist, expertiseName: item.name,
        focusFiles: this.store.specialistFiles(id) }, slot))
        throw Error('Relaci nelze bezpečně otevřít.');
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
    if (!this.store.state.sessions.some(session => session._convId === item.id) && !this.capacityAvailable()) return false;
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

  render() { return h(StudioRoot, { model: this.model }); }

}
decorate(injectable(), Studio2Widget);

class Studio2Contribution extends browser.AbstractViewContribution {
  constructor() {
    super({ widgetId: WIDGET_ID, widgetName: 'Studio 2', defaultWidgetOptions: { area: 'main' } });
  }
  async initializeLayout(app) {
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
    // A saved classic layout skips initializeLayout; attach the selected UI
    // after restoration without ever registering the classic widget factory.
    await this.openView({ activate: true, reveal: true });
    // Studio 2 owns its tabs and status line. Keep Theia as the host without
    // displaying a second tab strip and status bar around its workbench.
    const widget = this.tryGetWidget();
    app.shell.mainPanel.findTabBar(widget?.title)?.hide();
    app.shell.statusBar.hide();
    // The host may restore built-in side views; they are not part of Studio 2.
    for (const area of ['left', 'right', 'bottom']) await app.shell.collapsePanel(area);
    for (const side of ['leftPanelHandler', 'rightPanelHandler']) {
      app.shell[side]?.container?.hide();
    }
    // Lumino keeps the hidden tab bar's height reserved until the dock layout refits.
    app.shell.mainPanel.fit();
    this.adoptWindowChrome(app);
  }

  // Studio 2 draws its own title bar with the menu and window controls. The native
  // Theia menu (File, Edit, Selection…) and the system frame would duplicate them.
  async adoptWindowChrome(app) {
    const core = window.electronTheiaCore;
    if (!core) return;
    // Hiding the menu resizes the web contents; the dock layout must refit to the new height.
    // With the custom title style Theia shows its own top panel (menu, window controls);
    // Studio 2 has both in its title bar, so the panel stays hidden.
    const refit = () => setTimeout(() => { app.shell.topPanel.hide(); app.shell.mainPanel.fit(); app.shell.update(); }, 60);
    window.addEventListener('resize', refit);
    const hideMenu = () => { try { core.setMenuBarVisible(false); } catch { /* host without native menu */ } refit(); };
    hideMenu();
    // Theia shows the native menu again once its preferences settle; hide it after that too.
    setTimeout(hideMenu, 1500);
    try {
      if (await core.getTitleBarStyleAtStartup() !== 'custom') {
        core.setTitleBarStyle('custom');
        window.localStorage.setItem(FRAME_KEY, 'managed');
      }
    } catch { /* keeps the native frame; the menu stays hidden */ }
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
