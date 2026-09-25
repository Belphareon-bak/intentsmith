'use strict';

const { IntentSmithBus } = require('@intentsmith/chat-panel/lib/browser/event-bus');
const WorkActivity = require('@intentsmith/chat-panel/lib/browser/work-activity');
const TerminalClient = require('@intentsmith/chat-panel/lib/browser/terminal-client');
require('@intentsmith/chat-panel/lib/browser/ws-client');

class TransportAdapter {
  constructor(store, workspace) {
    this.store = store;
    this.workspace = workspace;
    this.slots = [...store.state.sessions];
    this.connection = 'Připojování';
    this.serverVersion = null;
    this.subscriptions = [];
    // Pinned WS/terminal clients address sessions by numeric slot. A closed tab
    // remains a tombstone until renderer exit so another session never inherits
    // an in-flight reqId or M1 turn. The visible SessionStore may still splice.
    window._sessions = this.slots;
    window._sessionActive = this.slots.indexOf(store.focusedSession());
    window._intentsmith = {
      getSessionActive: () => this.slots.indexOf(store.focusedSession()),
      getSessionRoot: index => {
        const session = this.slots[index];
        return session && !session._closed ? this.workspace.entry(session).root || undefined : undefined;
      },
    };
    this.unlistenStore = store.subscribe(() => {
      for (const session of store.state.sessions) if (!this.slots.includes(session)) this.slots.push(session);
      window._sessionActive = this.slots.indexOf(store.focusedSession());
    });
    this.on('ws:ready', event => { this.connection = 'Připojeno'; this.serverVersion = event.version || null; this.changed(); });
    this.on('ws:disconnected', () => {
      this.connection = 'Odpojeno';
      for (let index = 0; index < this.slots.length; index++) {
        if (!TerminalClient.isTermExecuting(index)) continue;
        const session = this.slots[index];
        const length = session.term.length;
        // The pinned client's cancel only resets its local execution lock. Its
        // default ^C echo would imply that the server command was cancelled,
        // which cannot be established after a connection loss.
        TerminalClient.termCancel(index);
        session.term.splice(length);
        if (!session._closed) session.term.push({
          text: '[NEZNÁMÝ VÝSLEDEK] Spojení skončilo během příkazu. Příkaz se automaticky neopakuje.',
          ts: new Date().toISOString(), type: 'uncertain',
        });
      }
      for (const session of this.store.state.sessions) {
        if (session.chat._thinking) {
          session.chat._thinking = null;
          session.chat._delivery = { status: 'DELIVERY_UNKNOWN', text: 'Spojení skončilo po odeslání. Výsledek nelze bezpečně určit; požadavek se neopakuje automaticky.' };
        }
      }
      this.changed();
    });
    this.on('ws:reconnect_exhausted', () => { this.connection = 'Spojení se nezdařilo'; this.changed(); });
    this.on('ws:reconnected', () => this.changed());
    this.on('session:changed', () => this.changed());
    this.on('session:identity', () => this.changed());
    this.on('chat:system', event => this.append(event.sessionIdx, 'system', event.content));
    this.on('chat:message', event => {
      const session = this.session(event.sessionIdx);
      if (!session) return;
      if (event.metadata?.conversationId && !session._convId) session._convId = event.metadata.conversationId;
      if (Number.isFinite(event.metadata?.contextPercent)) session.chat.ctx = event.metadata.contextPercent;
      this.append(event.sessionIdx, 'assistant', event.content, event.tag);
    });
    this.on('chat:terminal', event => this.terminal(event));
    this.on('agent:event', event => this.activity(event));
    this.on('terminal:line', () => this.changed());
    TerminalClient.initTerminalClient();
    window.IntentSmithWS.connect();
  }
  session(index) {
    const session = Number.isInteger(index) ? this.slots[index] : null;
    return session && !session._closed ? session : null;
  }
  on(name, fn) { IntentSmithBus.on(name, fn); this.subscriptions.push([name, fn]); }
  changed() { this.store.changed(); }
  append(index, role, value, tag = '') {
    const session = this.session(index);
    if (!session) return;
    session.chat.msgs.push({ role, text: String(value || ''), tag, ts: new Date().toISOString() });
    this.changed();
  }
  activity({ sessionIdx, event }) {
    const session = this.session(sessionIdx);
    if (!session || event?.transport !== 'm1' || !event.turnId || session._convId !== event.conversationId) return;
    const owner = session.chat.msgs.find(msg => msg._activity?.id === event.turnId)
      || [...session.chat.msgs].reverse().find(msg => msg.role === 'user' && !msg._activity);
    if (!owner) return;
    if (!owner._activity) owner._activity = WorkActivity.createActivity(event.turnId, 'Zpracovává zadání');
    WorkActivity.applyEvent(owner._activity, event);
    this.changed();
  }
  terminal(event) {
    const session = this.session(event.sessionIdx);
    if (!session) return;
    const result = event.result || {};
    const owner = session.chat.msgs.find(msg => msg._activity?.id === event.turnId);
    if (owner) WorkActivity.finishActivity(owner._activity, event.status, result.response?.metadata || {});
    if (event.action === 'cancel') {
      if (event.status !== 'cancelled') this.append(event.sessionIdx, 'system', result.error?.message || 'Zrušení nebylo potvrzeno.', 'ERROR');
      else this.changed();
      return;
    }
    session.chat._thinking = null;
    const uncertain = event.status === 'error' && ['M1_CONNECTION_REPLACED', 'M1_CONNECTION_INTERRUPTED',
      'M1_CLIENT_DESTROYED', 'M1_PROTOCOL_ERROR'].includes(result.error?.code);
    if (uncertain) session.chat._delivery = { status: 'DELIVERY_UNKNOWN',
      text: 'Spojení skončilo po odeslání. Výsledek nelze bezpečně určit; požadavek se neopakuje automaticky.' };
    else if (event.status === 'ok') session.chat._delivery = null;
    if (event.status === 'ok' && event.renderAssistant === true && result.response) {
      const metadata = result.response.metadata || {};
      session.chat.msgs.push({ role: 'assistant', text: String(result.response.content || ''), tag: metadata.mode || 'LLM', ts: new Date().toISOString() });
      if (Number.isFinite(metadata.contextPercent)) session.chat.ctx = metadata.contextPercent;
    } else {
      const reason = result.error?.message || (event.status === 'cancelled' ? 'Zpracování zrušeno.' : event.status === 'timeout' ? 'Zpracování vypršelo.' : 'Zpracování selhalo.');
      session.chat.msgs.push({ role: 'system', text: reason, tag: String(event.status || 'error').toUpperCase() });
    }
    this.changed();
  }
  send(session, content) {
    if (!session || !content.trim() || session.chat._delivery?.status === 'DELIVERY_UNKNOWN') return false;
    const index = this.slots.indexOf(session);
    if (index < 0 || window.IntentSmithWS.hasActiveM1Turn(session)) return false;
    const message = { role: 'user', text: content, ts: new Date().toISOString() };
    session.chat.msgs.push(message);
    session.chat._thinking = { text: 'Zpracovává zadání' };
    let sent = false;
    try { sent = window.IntentSmithWS.isReady() && window.IntentSmithWS.sendChat(content, session, index); }
    catch { sent = false; }
    if (!sent) {
      message.tag = 'NOT_SENT';
      session.chat._thinking = null;
      session.chat._delivery = { status: 'NOT_SENT', text: 'Zpráva nebyla odeslána. Zkontrolujte připojení.' };
    }
    if (sent) session.chat._delivery = null;
    this.changed();
    return sent;
  }
  isTerminalExecuting(session) {
    const index = this.slots.indexOf(session);
    return index >= 0 && TerminalClient.isTermExecuting(index);
  }
  async sendTerminal(session, command) {
    const value = String(command || '').trim();
    const index = this.slots.indexOf(session);
    if (!value || index < 0 || session._closed || !window.IntentSmithWS.isReady()
      || TerminalClient.isTermExecuting(index)) return false;
    // A project-bound terminal may only use its verified project root. Never
    // silently run a project command in the backend process directory.
    if (session._projectId && !this.workspace.entry(session).root) {
      if (!await this.workspace.loadTree(session)) {
        session.term.push({ text: '[ERROR] Kořen projektu se nepodařilo ověřit.', type: 'error' });
        this.changed();
        return false;
      }
    }
    if (session._closed || this.slots[index] !== session || !window.IntentSmithWS.isReady()) return false;
    return TerminalClient.termSend(index, value);
  }
  acknowledgeUnknown(session) {
    if (session?.chat._delivery?.status !== 'DELIVERY_UNKNOWN') return false;
    session.chat._delivery = null;
    this.changed();
    return true;
  }
  cancel(session) { return window.IntentSmithWS.sendCancel(session); }
  destroy() {
    for (const [name, fn] of this.subscriptions) IntentSmithBus.off(name, fn);
    this.unlistenStore();
    if (window._sessions === this.slots) {
      delete window._sessions;
      delete window._sessionActive;
      delete window._intentsmith;
    }
    window.IntentSmithWS.destroy();
  }
}

module.exports = { TransportAdapter };
