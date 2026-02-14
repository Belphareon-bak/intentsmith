"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

require("./styles/c3-theme.css");
require("./styles/c3-chat.css");

const inversify_1 = require("@theia/core/shared/inversify");
const browser_1 = require("@theia/core/lib/browser");
const react_widget_1 = require("@theia/core/lib/browser/widgets/react-widget");
const React = require("@theia/core/shared/react");

const C3_CHAT_PANEL_ID = 'c3-chat-panel';
const BACKEND_URL = 'http://localhost:3335';

/* ═══ SVG helper ═══ */
function ico(path, w) {
  return React.createElement('span', {
    className: 'c3-icon',
    dangerouslySetInnerHTML: {
      __html: '<svg width="' + (w||14) + '" height="' + (w||14) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
    }
  });
}

const ICO = {
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  split: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  attach: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  chevDown: '<polyline points="6 9 12 15 18 9"/>'
};

/* ═══ ChatPanelWidget ═══ */
class C3ChatPanelWidget extends react_widget_1.ReactWidget {
  constructor() {
    super();
    this.id = C3_CHAT_PANEL_ID;
    this.title.label = 'C3 Chat';
    this.title.caption = 'AI Chat';
    this.title.iconClass = 'codicon codicon-comment-discussion';
    this.title.closable = true;
    this.addClass('c3-chat-widget');
    this.node.tabIndex = 0;
    this._messages = [
      { role: 'system', text: 'C3 Studio připraven. Začni psát zprávu.' }
    ];
    this._inputValue = '';
    this._connected = false;
    this._contextPercent = 0;
    this._activeExpert = 'Výchozí';
    this._ws = null;
    console.log('[C3] ChatPanelWidget created');
    this._initWS();
  }

  _initWS() {
    try {
      this._ws = new WebSocket('ws://localhost:3335/ws');
      this._ws.onopen = () => { this._connected = true; this.update(); };
      this._ws.onclose = () => { this._connected = false; this.update(); };
      this._ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'chat_response') {
            this._messages.push({ role: 'assistant', text: data.text, tag: data.tag || 'LLM' });
            if (data.contextPercent) this._contextPercent = data.contextPercent;
            this.update();
            this._scrollBottom();
          }
        } catch (err) { /* ignore */ }
      };
    } catch (err) { /* WS not available */ }
  }

  render() {
    const h = React.createElement;
    const ctx = this._contextPercent || 0;

    return h('div', { className: 'c3-chat' },
      // Header
      h('div', { className: 'c3-ch-head' },
        h('button', { className: 'c3-btn c3-ch-btn', onClick: () => this._newChat(), title: 'Nový chat' }, ico(ICO.plus)),
        h('button', { className: 'c3-btn c3-ch-btn', title: 'Split' }, ico(ICO.split)),
        h('div', { className: 'c3-ch-spacer' }),
        h('div', { className: 'c3-ch-ctx' },
          h('div', { className: 'c3-ch-ctx-bar' },
            h('div', { className: 'c3-ch-ctx-fill', style: { width: ctx + '%' } })
          ),
          h('span', null, ctx + '%')
        ),
        h('button', { className: 'c3-btn c3-ch-btn', title: 'Zavřít' }, ico(ICO.close))
      ),

      // Messages
      h('div', { className: 'c3-ch-feed', ref: (el) => { this._feedEl = el; } },
        this._messages.map((msg, i) =>
          h('div', { key: i, className: 'c3-ch-msg' },
            h('div', { className: 'c3-ch-msg-who' },
              h('div', { className: 'c3-ch-ava ' + (msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'ai' : 'sys') },
                msg.role === 'user' ? '👤' : msg.role === 'assistant' ? 'C3' : '⚡'
              ),
              h('span', { className: 'c3-ch-msg-name' },
                msg.role === 'user' ? 'Ty' : msg.role === 'assistant' ? 'C3' : 'System'
              ),
              msg.tag && h('span', { className: 'c3-ch-tag' }, msg.tag)
            ),
            h('div', { className: 'c3-ch-msg-text' }, msg.text)
          )
        )
      ),

      // Input
      h('div', { className: 'c3-ch-input-wrap' },
        h('div', { className: 'c3-ch-input-box' },
          h('div', { className: 'c3-ch-input-top' },
            h('textarea', {
              className: 'c3-ch-textarea',
              placeholder: 'Napiš zprávu...',
              rows: 1,
              value: this._inputValue,
              onChange: (e) => { this._inputValue = e.target.value; this.update(); },
              onKeyDown: (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
              }
            }),
            h('button', {
              className: 'c3-btn-send c3-ch-send',
              onClick: () => this._send()
            }, ico(ICO.send))
          ),
          h('div', { className: 'c3-ch-bar' },
            h('button', { className: 'c3-btn c3-ch-attach', title: 'Přiložit' }, ico(ICO.attach, 13)),
            h('span', { className: 'c3-ch-autocomplete' }, 'Tab pro autocomplete'),
            h('div', { className: 'c3-ch-expert' },
              h('span', { className: 'c3-ch-expert-dot' }),
              this._activeExpert,
              ico(ICO.chevDown, 9)
            )
          )
        )
      )
    );
  }

  _send() {
    const text = (this._inputValue || '').trim();
    if (!text) return;
    this._messages.push({ role: 'user', text: text });
    this._inputValue = '';
    this.update();
    this._scrollBottom();

    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'chat', message: text, expert: this._activeExpert }));
    } else {
      this._sendHTTP(text);
    }
  }

  async _sendHTTP(text) {
    try {
      const res = await fetch(BACKEND_URL + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, expert: this._activeExpert })
      });
      const data = await res.json();
      this._messages.push({
        role: 'assistant',
        text: data.response || data.text || JSON.stringify(data),
        tag: 'LLM'
      });
      if (data.contextPercent) this._contextPercent = data.contextPercent;
    } catch (err) {
      this._messages.push({
        role: 'assistant',
        text: 'Backend nedostupný. Spusťte: node src/server.js',
        tag: 'ERROR'
      });
    }
    this.update();
    this._scrollBottom();
  }

  _newChat() {
    this._messages = [{ role: 'system', text: 'Nový chat zahájen.' }];
    this._contextPercent = 0;
    this.update();
  }

  _scrollBottom() {
    setTimeout(() => {
      if (this._feedEl) this._feedEl.scrollTop = this._feedEl.scrollHeight;
    }, 50);
  }
}

inversify_1.decorate(inversify_1.injectable(), C3ChatPanelWidget);

/* ═══ ViewContribution ═══ */
class C3ChatPanelContribution extends browser_1.AbstractViewContribution {
  constructor() {
    super({
      widgetId: C3_CHAT_PANEL_ID,
      widgetName: 'C3 Chat',
      defaultWidgetOptions: { area: 'right', rank: 100 },
      toggleCommandId: 'c3ChatPanel:toggle',
      toggleKeybinding: 'ctrlcmd+shift+l'
    });
  }

  async initializeLayout(app) {
    await this.openView({ activate: true, reveal: true });
  }

  async onStart(app) {
    try {
      await this.openView({ activate: false, reveal: true });
      console.log('[C3] Chat panel opened');
    } catch (e) {
      console.warn('[C3] Chat panel open failed:', e.message);
    }
  }
}

inversify_1.decorate(inversify_1.injectable(), C3ChatPanelContribution);

/* ═══ DI Module ═══ */
exports.default = new inversify_1.ContainerModule((bind) => {
  bind(C3ChatPanelWidget).toSelf();
  bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
    id: C3_CHAT_PANEL_ID,
    createWidget: () => ctx.container.get(C3ChatPanelWidget)
  })).inSingletonScope();

  browser_1.bindViewContribution(bind, C3ChatPanelContribution);
  bind(browser_1.FrontendApplicationContribution).toService(C3ChatPanelContribution);
});
