'use strict';

const { IntentSmithBus } = require('@intentsmith/chat-panel/lib/browser/event-bus');
const WorkActivity = require('@intentsmith/chat-panel/lib/browser/work-activity');
require('@intentsmith/chat-panel/lib/browser/ws-client');

class TransportAdapter {
  constructor(store) {
    this.store = store;
    this.connection = 'Připojování';
    this.serverVersion = null;
    this.subscriptions = [];
    // The pinned transport resolves session identity through these globals.
    // Keep the same array object so closing one tab never changes another's owner.
    window._sessions = store.state.sessions;
    window._sessionActive = store.state.sessions.indexOf(store.focusedSession());
    this.unlistenStore = store.subscribe(() => {
      window._sessionActive = store.state.sessions.indexOf(store.focusedSession());
    });
    this.on('ws:ready', event => { this.connection = 'Připojeno'; this.serverVersion = event.version || null; this.changed(); });
    this.on('ws:disconnected', () => { this.connection = 'Odpojeno'; this.changed(); });
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
    this.on('terminal:output', event => {
      const session = this.session(event.sessionIdx);
      if (!session) return;
      session.term.push({ ts: new Date().toISOString(), type: 'output', data: event.data });
      this.changed();
    });
    window.IntentSmithWS.connect();
  }
  session(index) { return Number.isInteger(index) ? this.store.state.sessions[index] || null : null; }
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
    if (!session || !content.trim()) return false;
    const index = this.store.state.sessions.indexOf(session);
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
    this.changed();
    return sent;
  }
  cancel(session) { return window.IntentSmithWS.sendCancel(session); }
  destroy() {
    for (const [name, fn] of this.subscriptions) IntentSmithBus.off(name, fn);
    this.unlistenStore();
    window.IntentSmithWS.destroy();
  }
}

module.exports = { TransportAdapter };
