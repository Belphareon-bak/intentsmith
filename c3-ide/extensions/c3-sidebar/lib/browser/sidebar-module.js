"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-sidebar.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");

const C3_SIDEBAR_ID = 'c3-sidebar';

/* ═══ SVG Icons ═══ */
const ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  expert: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 10 3 12 0v-5"/>',
  worker: '<circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chevDown: '<polyline points="6 9 12 15 18 9"/>',
  collapse: '<polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>',
  expand: '<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>',
  multimedia: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'
};

function mksvg(icon, w) {
  return '<svg width="' + (w||20) + '" height="' + (w||20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>';
}

/* ═══ Navigation Items Config ═══ */
const NAV_ITEMS = [
  { id: 'chats', label: 'Konverzace', icon: 'chat', badge: 12,
    recent: [
      { label: 'Pomoz s server.js', color: 'g' },
      { label: 'Historie Československa', color: 'b' },
      { label: 'Flutter build debug', color: 'b' }
    ]},
  { id: 'projects', label: 'Projekty', icon: 'folder', badge: 4,
    recent: [
      { label: 'Security Hardening', color: 'g' },
      { label: 'Worker System v2', color: 'a' },
      { label: 'E2E Validation', color: 'b' }
    ]},
  { id: 'specialists', label: 'Specialisté', icon: 'users',
    recent: [
      { label: 'Účetní', color: 'g' }
    ]},
  { id: 'expertises', label: 'Expertyzy', icon: 'expert', badge: 9,
    recent: [
      { label: 'Výchozí', color: 'g' },
      { label: 'Developer', color: 'g' },
      { label: 'Účetní', color: 'g' }
    ]},
  { id: 'workers', label: 'Workeri', icon: 'worker', badge: 3,
    recent: [
      { label: 'Weather Monitor', color: 'g' },
      { label: 'Realty Watcher', color: 'g' },
      { label: 'News Digest', color: 'a' }
    ]},
  { id: 'multimedia', label: 'Multimedia', icon: 'multimedia', badge: 0, recent: [] }
];

const FILE_TREE = [
  { name: 'src', type: 'folder', indent: 0 },
  { name: 'server.js', type: 'file', indent: 1, active: true },
  { name: 'router.js', type: 'file', indent: 1 },
  { name: 'chat', type: 'folder', indent: 1 },
  { name: 'planner', type: 'folder', indent: 1 },
  { name: 'tests', type: 'folder', indent: 0 },
  { name: 'design', type: 'folder', indent: 0 },
  { name: 'package.json', type: 'file', indent: 0 }
];

/* ═══ SidebarWidget ═══ */
class C3SidebarWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = C3_SIDEBAR_ID;
    this.title.label = 'C3 Navigation';
    this.title.caption = 'C3 Studio Navigation';
    this.title.iconClass = 'codicon codicon-layout-sidebar-left';
    this.title.closable = false;
    this.addClass('c3-sidebar-widget');
    this.node.tabIndex = 0;
    this._collapsed = false;
    this._activeView = 'chats';
    this._openDropdowns = {};
    console.log('[C3] SidebarWidget created');
  }

  render() {
    const h = React.createElement;
    const col = this._collapsed;

    return h('div', { className: 'c3-sb' + (col ? ' collapsed' : '') },
      // Brand
      this._renderBrand(h, col),
      // Nav items
      h('div', { className: 'c3-sb-nav' },
        NAV_ITEMS.map(item => this._renderNavItem(h, item, col)),
        // Divider + Working tree (only when expanded)
        !col && h('div', { key: 'div', className: 'c3-sb-divider' }),
        !col && h('div', { key: 'th', className: 'c3-sb-tree-header' }, 'Working Tree'),
        !col && h('div', { key: 'tree', className: 'c3-sb-tree' },
          FILE_TREE.map((f, i) =>
            h('div', {
              key: i,
              className: 'c3-tree-item' +
                (f.type === 'folder' ? ' folder' : '') +
                (f.active ? ' active' : ''),
              style: f.indent ? { paddingLeft: (10 + f.indent * 14) + 'px' } : undefined
            },
              (f.type === 'folder' ? '📁 ' : '📄 ') + f.name
            )
          )
        )
      ),
      // Footer: settings
      h('div', { className: 'c3-sb-footer' },
        this._renderNavItem(h, { id: 'settings', label: 'Nastavení', icon: 'settings' }, col),
        h('div', { key: 'dot', className: 'c3-sb-status-dot' })
      )
    );
  }

  _renderBrand(h, col) {
    if (col) {
      return h('div', { className: 'c3-sb-brand' },
        h('button', {
          className: 'c3-sb-expand-btn',
          onClick: () => this._toggleCollapse(),
          title: 'Rozbalit',
          dangerouslySetInnerHTML: { __html: mksvg(ICONS.expand, 15) }
        })
      );
    }
    return h('div', { className: 'c3-sb-brand' },
      h('div', { className: 'c3-sb-logo' }, 'C3'),
      h('span', { className: 'c3-sb-brand-text' }, 'C3 Studio'),
      h('button', {
        className: 'c3-sb-collapse-btn',
        onClick: () => this._toggleCollapse(),
        title: 'Sbalit',
        dangerouslySetInnerHTML: { __html: mksvg(ICONS.collapse, 16) }
      })
    );
  }

  _renderNavItem(h, item, col) {
    const isActive = this._activeView === item.id;
    const isOpen = this._openDropdowns[item.id];
    const hasRecent = item.recent && item.recent.length > 0;

    const elements = [];

    elements.push(
      h('div', {
        key: item.id,
        className: 'c3-sb-item' + (isActive ? ' active' : '') + (isOpen ? ' dd-open' : ''),
        onClick: (e) => {
          if (e.target.closest && e.target.closest('.c3-sb-chev')) {
            this._openDropdowns[item.id] = !this._openDropdowns[item.id];
          } else {
            this._activeView = item.id;
            Object.keys(this._openDropdowns).forEach(k => { this._openDropdowns[k] = false; });
            this._emitViewChange(item.id);
          }
          this.update();
        },
        title: item.label
      },
        h('span', { className: 'c3-sb-icon', dangerouslySetInnerHTML: { __html: mksvg(ICONS[item.icon], 20) } }),
        !col && h('span', { className: 'c3-sb-label' }, item.label),
        !col && item.badge && h('span', { className: 'c3-sb-badge' }, item.badge),
        !col && hasRecent && h('span', {
          className: 'c3-sb-chev',
          dangerouslySetInnerHTML: { __html: mksvg(ICONS.chevDown, 14) }
        })
      )
    );

    // Dropdown
    if (!col && isOpen && hasRecent) {
      elements.push(
        h('div', { key: item.id + '-dd', className: 'c3-sb-dropdown' },
          item.recent.map((r, i) =>
            h('div', { key: i, className: 'c3-sb-dd-item' },
              h('span', { className: 'c3-sb-dd-dot ' + r.color }),
              r.label
            )
          )
        )
      );
    }

    return elements;
  }

  _toggleCollapse() {
    this._collapsed = !this._collapsed;
    this.update();
  }

  _emitViewChange(viewId) {
    const event = new CustomEvent('c3-view-change', { detail: { view: viewId }, bubbles: true });
    this.node.dispatchEvent(event);
  }
}

// Apply @injectable() decorator
inversify_1.decorate(inversify_1.injectable(), C3SidebarWidget);

/* ═══ ViewContribution ═══ */
class C3SidebarContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: C3_SIDEBAR_ID,
      widgetName: 'C3 Navigation',
      defaultWidgetOptions: { area: 'left', rank: 0 },
      toggleCommandId: 'c3Sidebar:toggle',
      toggleKeybinding: 'ctrlcmd+b'
    });
  }

  // initializeLayout only runs on FIRST launch
  async initializeLayout(app) {
    await this.openView({ activate: true, reveal: true });
  }

  // onStart runs EVERY launch — ensures widget is open
  async onStart(app) {
    try {
      await this.openView({ activate: false, reveal: true });
      console.log('[C3] Sidebar opened');
    } catch (e) {
      console.warn('[C3] Sidebar open failed:', e.message);
    }
  }
}

// Apply @injectable() decorator
inversify_1.decorate(inversify_1.injectable(), C3SidebarContribution);

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(C3SidebarWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: C3_SIDEBAR_ID,
    createWidget: () => ctx.container.get(C3SidebarWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, C3SidebarContribution);
  bind(browser_1.FrontendApplicationContribution).toService(C3SidebarContribution);
});
