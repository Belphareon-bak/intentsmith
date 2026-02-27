"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-detail.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");

const C3_DETAIL_ID = 'c3-detail-panel';

/* ═══ DetailPanelWidget ═══ */
class C3DetailPanelWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = C3_DETAIL_ID;
    this.title.label = 'Detail';
    this.title.caption = 'C3 Detail';
    this.title.iconClass = 'codicon codicon-info';
    this.title.closable = true;
    this.addClass('c3-detail-widget');
    this.node.tabIndex = 0;
    this.node.style.minWidth = '280px';
    this._item = null;
    this._type = null;

    // Listen for item selection events
    document.addEventListener('c3-item-selected', (e) => {
      this._item = e.detail.item;
      this._type = e.detail.type;
      this.update();
    });
  }

  render() {
    const h = React.createElement;
    if (!this._item) {
      return h('div', { className: 'c3-det c3-det-empty' },
        h('p', null, 'Vyberte položku pro zobrazení detailu')
      );
    }

    return h('div', { className: 'c3-det' },
      h('div', { className: 'c3-det-head' },
        h('h3', null, this._item.title || this._item.name || 'Detail'),
        h('button', { className: 'c3-btn c3-det-close', onClick: () => { this._item = null; this.update(); } },
          React.createElement('span', {
            dangerouslySetInnerHTML: { __html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' }
          })
        )
      ),
      h('div', { className: 'c3-det-body' },
        this._renderDetails(h)
      )
    );
  }

  _renderDetails(h) {
    const item = this._item;
    const rows = [];

    if (item.status) rows.push({ label: 'Status', value: item.status, accent: true });
    if (item.desc) rows.push({ label: 'Popis', value: item.desc });
    if (item.date) rows.push({ label: 'Datum', value: item.date });
    if (item.time) rows.push({ label: 'Čas', value: item.time });
    if (item.preview) rows.push({ label: 'Preview', value: item.preview });
    if (item.pill) rows.push({ label: 'Stav', value: item.status });
    if (item.emoji) rows.push({ label: 'Ikona', value: item.emoji });
    if (item.fav !== undefined) rows.push({ label: 'Oblíbený', value: item.fav ? 'Ano ★' : 'Ne' });

    const elements = [
      ...rows.map((r, i) =>
        h('div', { key: i, className: 'c3-det-row' },
          h('span', null, r.label),
          h('span', { style: r.accent ? { color: 'var(--c3-accent-text)' } : undefined }, r.value)
        )
      ),
    ];

    // v63.0: Capability bars for expertises
    if (this._type === 'expertise' && item.capabilities) {
      const dims = ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'];
      const dimLabels = { reasoning: 'Reasoning', creativity: 'Kreativita', determinism: 'Determinismus', riskTolerance: 'Risk Tolerance', verbosity: 'Verbozita' };
      elements.push(
        h('div', { key: 'caps', className: 'c3-det-section' },
          h('h4', null, 'Capabilities'),
          ...dims.map(dim => {
            const val = item.capabilities[dim] ?? 50;
            return h('div', { key: dim, className: 'c3-det-cap-bar' },
              h('label', null, dimLabels[dim] || dim),
              h('div', { className: 'bar' },
                h('div', { className: 'bar-fill', style: { width: `${val}%` } })
              ),
              h('span', { className: 'bar-val' }, String(val)),
            );
          })
        )
      );
    }

    // v63.0: Modules summary for expertises
    if (this._type === 'expertise' && item.modules) {
      const mod = item.modules;
      const counts = ['domain_rules', 'emphasis', 'constraints', 'vocabulary', 'antipatterns']
        .filter(s => mod[s] && mod[s].length > 0)
        .map(s => `${s}: ${mod[s].length}`);
      if (mod.disclaimer) counts.push('disclaimer: 1');
      if (counts.length > 0) {
        elements.push(
          h('div', { key: 'mods', className: 'c3-det-section' },
            h('h4', null, 'Modules'),
            h('div', { className: 'c3-det-tags' },
              ...counts.map(c => h('span', { key: c, className: 'c3-det-tag' }, c))
            )
          )
        );
      }
    }

    // v63.0: Tone + temperature for expertises
    if (this._type === 'expertise') {
      const extraRows = [];
      if (item.tone) extraRows.push({ label: 'Tón', value: item.tone });
      if (item.temperature !== undefined) extraRows.push({ label: 'Teplota', value: String(item.temperature) });
      extraRows.forEach((r, i) => {
        elements.push(
          h('div', { key: `extra-${i}`, className: 'c3-det-row' },
            h('span', null, r.label),
            h('span', null, r.value)
          )
        );
      });
    }

    elements.push(
      h('div', { key: 'tags', className: 'c3-det-section' },
        h('h4', null, 'Tagy'),
        h('div', { className: 'c3-det-tags' },
          h('span', { className: 'c3-det-tag' }, this._type || 'item'),
          item.status && h('span', { className: 'c3-det-tag' }, item.status)
        )
      ),
      h('div', { key: 'actions', className: 'c3-det-section' },
        h('h4', null, 'Akce'),
        h('div', { className: 'c3-det-actions' },
          h('button', { className: 'c3-det-btn primary' }, 'Otevřít'),
          h('button', {
            className: 'c3-det-btn',
            onClick: () => {
              // v63.0: Emit wizard-open event for expertises
              if (this._type === 'expertise') {
                document.dispatchEvent(new CustomEvent('c3-wizard-open', {
                  detail: { mode: 'edit', expertiseData: item },
                  bubbles: true,
                }));
              }
            },
          }, 'Editovat'),
          h('button', { className: 'c3-det-btn' }, 'Archivovat')
        )
      )
    );

    return elements;
  }
}

/* ═══ ViewContribution ═══ */
class C3DetailPanelContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: C3_DETAIL_ID,
      widgetName: 'Detail',
      defaultWidgetOptions: { area: 'right', rank: 200 },
      toggleCommandId: 'c3Detail:toggle'
    });
  }
}

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(C3DetailPanelWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: C3_DETAIL_ID,
    createWidget: () => ctx.container.get(C3DetailPanelWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, C3DetailPanelContribution);
  bind(browser_1.FrontendApplicationContribution).toService(C3DetailPanelContribution);
});
