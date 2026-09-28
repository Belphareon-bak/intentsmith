"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/intentsmith-detail.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");

const INTENTSMITH_DETAIL_ID = 'intentsmith-detail-panel';

/* ═══ DetailPanelWidget ═══ */
class IntentSmithDetailPanelWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = INTENTSMITH_DETAIL_ID;
    this.title.label = 'Detail';
    this.title.caption = 'IntentSmith Detail';
    this.title.iconClass = 'codicon codicon-info';
    this.title.closable = true;
    this.addClass('intentsmith-detail-widget');
    this.node.tabIndex = 0;
    this.node.style.minWidth = '280px';
    this._item = null;
    this._type = null;

    // Listen for item selection events
    document.addEventListener('intentsmith-item-selected', (e) => {
      this._item = e.detail.item;
      this._type = e.detail.type;
      this.update();
    });
  }

  render() {
    const h = React.createElement;
    if (!this._item) {
      return h('div', { className: 'intentsmith-det intentsmith-det-empty' },
        h('p', null, 'Vyberte položku pro zobrazení detailu')
      );
    }

    return h('div', { className: 'intentsmith-det' },
      h('div', { className: 'intentsmith-det-head' },
        h('h3', null, this._item.title || this._item.name || 'Detail'),
        h('button', { className: 'intentsmith-btn intentsmith-det-close', onClick: () => { this._item = null; this.update(); } },
          React.createElement('span', {
            dangerouslySetInnerHTML: { __html: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' }
          })
        )
      ),
      h('div', { className: 'intentsmith-det-body' },
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
        h('div', { key: i, className: 'intentsmith-det-row' },
          h('span', null, r.label),
          h('span', { style: r.accent ? { color: 'var(--intentsmith-accent-text)' } : undefined }, r.value)
        )
      ),
    ];

    // v63.0: Capability bars for expertises
    if (this._type === 'expertise' && item.capabilities) {
      const dims = ['reasoning', 'creativity', 'determinism', 'riskTolerance', 'verbosity'];
      const dimLabels = { reasoning: 'Reasoning', creativity: 'Kreativita', determinism: 'Determinismus', riskTolerance: 'Risk Tolerance', verbosity: 'Verbozita' };
      elements.push(
        h('div', { key: 'caps', className: 'intentsmith-det-section' },
          h('h4', null, 'Capabilities'),
          ...dims.map(dim => {
            const val = item.capabilities[dim] ?? 50;
            return h('div', { key: dim, className: 'intentsmith-det-cap-bar' },
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
          h('div', { key: 'mods', className: 'intentsmith-det-section' },
            h('h4', null, 'Modules'),
            h('div', { className: 'intentsmith-det-tags' },
              ...counts.map(c => h('span', { key: c, className: 'intentsmith-det-tag' }, c))
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
          h('div', { key: `extra-${i}`, className: 'intentsmith-det-row' },
            h('span', null, r.label),
            h('span', null, r.value)
          )
        );
      });
    }

    elements.push(
      h('div', { key: 'tags', className: 'intentsmith-det-section' },
        h('h4', null, 'Tagy'),
        h('div', { className: 'intentsmith-det-tags' },
          h('span', { className: 'intentsmith-det-tag' }, this._type || 'item'),
          item.status && h('span', { className: 'intentsmith-det-tag' }, item.status)
        )
      ),
      h('div', { key: 'actions', className: 'intentsmith-det-section' },
        h('h4', null, 'Akce'),
        h('div', { className: 'intentsmith-det-actions' },
          h('button', { className: 'intentsmith-det-btn primary' }, 'Otevřít'),
          h('button', {
            className: 'intentsmith-det-btn',
            onClick: () => {
              // v63.0: Emit wizard-open event for expertises
              if (this._type === 'expertise') {
                document.dispatchEvent(new CustomEvent('intentsmith-wizard-open', {
                  detail: { mode: 'edit', expertiseData: item },
                  bubbles: true,
                }));
              }
            },
          }, 'Editovat'),
          h('button', { className: 'intentsmith-det-btn' }, 'Archivovat')
        )
      )
    );

    return elements;
  }
}

/* ═══ ViewContribution ═══ */
class IntentSmithDetailPanelContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: INTENTSMITH_DETAIL_ID,
      widgetName: 'Detail',
      defaultWidgetOptions: { area: 'right', rank: 200 },
      toggleCommandId: 'intentsmithDetail:toggle'
    });
  }
}

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(IntentSmithDetailPanelWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: INTENTSMITH_DETAIL_ID,
    createWidget: () => ctx.container.get(IntentSmithDetailPanelWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, IntentSmithDetailPanelContribution);
  bind(browser_1.FrontendApplicationContribution).toService(IntentSmithDetailPanelContribution);
});
