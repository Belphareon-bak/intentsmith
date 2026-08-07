"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-agent-log.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");

const C3_AGENT_PANEL_ID = 'c3-agent-panel';

/* ═══ AgentLogWidget ═══ */
class C3AgentLogWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = C3_AGENT_PANEL_ID;
    this.title.label = 'Agent Log';
    this.title.caption = 'C3 Agent Activity';
    this.title.iconClass = 'codicon codicon-hubot';
    this.title.closable = true;
    this.addClass('c3-agent-widget');
    this.node.tabIndex = 0;
    this._activeTab = 'agent';
    this._log = [
      { time: '14:32:01', type: 'TURN', cls: 'turn', text: 'start — "Popiš historii Československa"', active: true },
      { time: '14:32:01', type: 'CRE',  cls: 'cre',  text: 'CONV conf=0.94' },
      { time: '14:32:02', type: 'LLM',  cls: 'llm',  text: 'qwen3.5:27b 847tok' },
      { time: '14:32:04', type: 'GATE', cls: 'gate', text: 'D6.1✓ D6.2✓ q=0.91' },
      { time: '14:32:04', type: 'TURN', cls: 'turn', text: 'end ok 2847ms' }
    ];
    console.log('[C3] AgentLogWidget created');
  }

  render() {
    const h = React.createElement;
    const tab = this._activeTab;
    const tabs = [
      { id: 'agent', label: 'Agent', count: this._log.length },
      { id: 'terminal', label: 'Terminal' },
      { id: 'problems', label: 'Problems', count: 0 }
    ];

    return h('div', { className: 'c3-al' },
      h('div', { className: 'c3-al-tabs' },
        tabs.map(function(t) {
          return h('div', {
            key: t.id,
            className: 'c3-al-tab' + (tab === t.id ? ' active' : ''),
            onClick: function() { this._activeTab = t.id; this.update(); }.bind(this)
          },
            t.label,
            t.count !== undefined ? h('span', { className: 'c3-al-cnt' }, t.count) : null
          );
        }.bind(this))
      ),
      tab === 'agent' && h('div', { className: 'c3-al-panel' },
        this._log.map(function(entry, i) {
          return h('div', { key: i, className: 'c3-al-entry' + (entry.active ? ' active' : '') },
            h('span', { className: 'c3-al-time' }, entry.time),
            h('span', { className: 'c3-al-type ' + entry.cls }, entry.type),
            h('span', { className: 'c3-al-text' }, entry.text)
          );
        })
      ),
      tab === 'terminal' && h('div', { className: 'c3-al-panel c3-al-term' },
        h('div', null, h('span', { className: 'c3-term-prompt' }, '~/c3 $ '), 'node src/server.js'),
        h('div', null, h('span', { className: 'c3-term-ok' }, '✓'), ' C3 on :3335'),
        h('div', null, h('span', { className: 'c3-term-ok' }, '✓'), ' Ollama connected'),
        h('div', null, h('span', { className: 'c3-term-prompt' }, '~/c3 $ '), h('span', { className: 'c3-term-cursor' }))
      ),
      tab === 'problems' && h('div', { className: 'c3-al-panel c3-al-empty' }, 'No problems detected.')
    );
  }
}

inversify_1.decorate(inversify_1.injectable(), C3AgentLogWidget);

/* ═══ ViewContribution ═══ */
class C3AgentLogContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: C3_AGENT_PANEL_ID,
      widgetName: 'Agent Log',
      defaultWidgetOptions: { area: 'bottom', rank: 100 },
      toggleCommandId: 'c3AgentLog:toggle',
      toggleKeybinding: 'ctrlcmd+shift+a'
    });
  }

  async initializeLayout(app) {
    await this.openView({ activate: true, reveal: true });
  }

  async onStart(app) {
    try {
      await this.openView({ activate: false, reveal: true });
      console.log('[C3] Agent log opened');
    } catch (e) {
      console.warn('[C3] Agent log open failed:', e.message);
    }
  }
}

inversify_1.decorate(inversify_1.injectable(), C3AgentLogContribution);

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(C3AgentLogWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: C3_AGENT_PANEL_ID,
    createWidget: () => ctx.container.get(C3AgentLogWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, C3AgentLogContribution);
  bind(browser_1.FrontendApplicationContribution).toService(C3AgentLogContribution);
});
