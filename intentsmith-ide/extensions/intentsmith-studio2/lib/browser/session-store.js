'use strict';

const V2_KEY = 'intentsmith-studio2-session-state';
const V1_KEY = 'intentsmith-session-state';
const MAX_COLUMNS = 3;

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}
function messages(value) {
  return Array.isArray(value) ? value.slice(-100).filter(item => item && typeof item === 'object')
    .map(item => ({ role: text(item.role, 'system'), text: text(item.text), tag: text(item.tag) })) : [];
}
function id() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function makeSession(number, source = {}) {
  const raw = safeObject(source);
  const chat = safeObject(raw.chat);
  return {
    id: text(raw.id) || id(), number,
    _uiId: text(raw._uiId) || id(), _convId: text(raw._convId || raw.convId) || null,
    _projectId: text(raw._projectId || raw.projectId) || null,
    _agentId: text(raw._agentId || raw.agentId) || null,
    _label: text(raw._label || raw.label) || `Relace ${number}`,
    _m2Pending: raw._m2Pending || raw.m2Pending || null,
    _closed: false, _editor: { active: false, tabs: [], activeTabId: null, scrollRaf: null },
    _focusFiles: Array.isArray(raw._focusFiles || raw.focusFiles) ? (raw._focusFiles || raw.focusFiles).slice(0, 100) : [],
    _openedFiles: Array.isArray(raw._openedFiles || raw.openedFiles) ? (raw._openedFiles || raw.openedFiles).filter(value => typeof value === 'string').slice(0, 30) : [],
    _modifiedFiles: Array.isArray(raw._modifiedFiles || raw.modifiedFiles) ? (raw._modifiedFiles || raw.modifiedFiles).filter(value => typeof value === 'string').slice(0, 30) : [],
    _fileChanges: safeObject(raw._fileChanges || raw.fileChanges),
    _conversationFocus: raw._conversationFocus === true,
    chat: {
      msgs: messages(chat.msgs || raw.recentMsgs),
      ctx: Number.isFinite(chat.ctx) ? chat.ctx : 0,
      expertise: text(chat.expertise || raw.expertiseName, 'Výchozí'),
      specialist: chat.specialist || raw.specialistData || null,
      editMode: chat.editMode === 'auto' || raw.editMode === 'auto' ? 'auto' : 'ask',
      attachments: [], _pendingAttachments: [],
      _thinking: null, _delivery: raw.delivery?.status === 'DELIVERY_UNKNOWN' ? {
        status: 'DELIVERY_UNKNOWN',
        text: 'Spojení skončilo po odeslání. Výsledek nelze bezpečně určit; požadavek se neopakuje automaticky.',
      } : null,
    },
    bottom: text(raw.bottom || raw.bottomMode, 'agent'),
    log: Array.isArray(raw.log) ? raw.log.slice(-300) : [],
    term: Array.isArray(raw.term) ? raw.term.slice(-300) : [],
  };
}
function snapshotSession(session) {
  return {
    id: session.id, number: session.number,
    convId: session._convId, projectId: session._projectId, agentId: session._agentId,
    label: session._label, m2Pending: session._m2Pending,
    focusFiles: session._focusFiles,
    openedFiles: session._openedFiles, modifiedFiles: session._modifiedFiles, fileChanges: session._fileChanges,
    recentMsgs: messages(session.chat.msgs).slice(-20),
    expertiseName: session.chat.expertise, specialistData: session.chat.specialist,
    editMode: session.chat.editMode, bottomMode: session.bottom,
    delivery: session.chat._delivery?.status === 'DELIVERY_UNKNOWN' ? { status: 'DELIVERY_UNKNOWN' } : null,
  };
}
function parse(storage, key) {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}
function restore(storage) {
  const saved = safeObject(parse(storage, V2_KEY));
  if (saved.version === 2 && Array.isArray(saved.sessions)) {
    const usedIds = new Set();
    const usedNumbers = new Set();
    const sessions = [];
    for (const raw of saved.sessions) {
      const item = safeObject(raw);
      if (!Number.isSafeInteger(item.number) || item.number < 1 || usedNumbers.has(item.number)) continue;
      const session = makeSession(item.number, item);
      if (usedIds.has(session.id)) continue;
      usedIds.add(session.id);
      usedNumbers.add(session.number);
      sessions.push(session);
    }
    if (sessions.length) {
      const valid = new Set(sessions.map(session => session.id));
      const columns = Array.isArray(saved.columns) ? [...new Set(saved.columns.filter(value => valid.has(value)))].slice(0, MAX_COLUMNS) : [];
      if (!columns.length) columns.push(sessions[0].id);
      const max = Math.max(...sessions.map(session => session.number));
      return {
        sessions, columns,
        focusedColumn: Number.isInteger(saved.focusedColumn) ? Math.max(0, Math.min(columns.length - 1, saved.focusedColumn)) : 0,
        nextNumber: Math.max(max + 1, Number.isSafeInteger(saved.nextNumber) ? saved.nextNumber : 1),
      };
    }
  }
  const legacy = safeObject(parse(storage, V1_KEY));
  const old = Array.isArray(legacy.sessions) ? legacy.sessions : [];
  const open = old.map((item, index) => ({ item, index })).filter(entry => safeObject(entry.item).closed !== true);
  if (open.length) {
    const sessions = open.map((entry, index) => makeSession(index + 1, entry.item));
    const wanted = Number.isInteger(legacy.sessionActive) ? legacy.sessionActive : 0;
    const activeIndex = open.findIndex(entry => entry.index === wanted);
    const active = activeIndex >= 0 ? activeIndex : 0;
    return { sessions, columns: [sessions[active].id], focusedColumn: 0, nextNumber: sessions.length + 1 };
  }
  const first = makeSession(1);
  return { sessions: [first], columns: [first.id], focusedColumn: 0, nextNumber: 2 };
}

class SessionStore {
  constructor(storage) {
    this.storage = storage;
    this.state = restore(storage);
    this.listeners = new Set();
    this.persist();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  changed() {
    this.persist();
    for (const listener of this.listeners) listener(this.state);
  }
  persist() {
    const { sessions, columns, focusedColumn, nextNumber } = this.state;
    try {
      this.storage.setItem(V2_KEY, JSON.stringify({
        version: 2, sessions: sessions.map(snapshotSession), columns, focusedColumn, nextNumber,
      }));
    } catch { /* Storage quota must not stop a running session. */ }
  }
  find(sessionId) { return this.state.sessions.find(session => session.id === sessionId) || null; }
  focusedSession() { return this.find(this.state.columns[this.state.focusedColumn]); }
  addSession(source = {}) {
    const session = makeSession(this.state.nextNumber++, source);
    this.state.sessions.push(session);
    this.state.columns[this.state.focusedColumn] = session.id;
    this.changed();
    return session;
  }
  focusColumn(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.state.columns.length) return false;
    this.state.focusedColumn = index;
    this.changed();
    return true;
  }
  selectInColumn(index, sessionId) {
    if (!Number.isInteger(index) || index < 0 || index >= this.state.columns.length || !this.find(sessionId)) return false;
    const other = this.state.columns.indexOf(sessionId);
    if (other >= 0 && other !== index) this.state.columns[other] = this.state.columns[index];
    this.state.columns[index] = sessionId;
    this.state.focusedColumn = index;
    this.changed();
    return true;
  }
  focusTab(sessionId) {
    const visible = this.state.columns.indexOf(sessionId);
    return this.selectInColumn(visible < 0 ? this.state.focusedColumn : visible, sessionId);
  }
  setColumnCount(count) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_COLUMNS) return false;
    const wanted = Math.min(count, this.state.sessions.length);
    while (this.state.columns.length > wanted) this.state.columns.pop();
    while (this.state.columns.length < wanted) {
      const spare = this.state.sessions.find(session => !this.state.columns.includes(session.id));
      if (!spare) break;
      this.state.columns.push(spare.id);
    }
    this.state.focusedColumn = Math.min(this.state.focusedColumn, this.state.columns.length - 1);
    this.changed();
    return true;
  }
  closeColumn(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.state.columns.length || this.state.columns.length === 1) return false;
    this.state.columns.splice(index, 1);
    this.state.focusedColumn = Math.min(this.state.focusedColumn, this.state.columns.length - 1);
    this.changed();
    return true;
  }
  closeSession(sessionId) {
    const index = this.state.sessions.findIndex(session => session.id === sessionId);
    if (index < 0) return false;
    this.state.sessions[index]._closed = true;
    this.state.sessions.splice(index, 1);
    if (!this.state.sessions.length) this.state.sessions.push(makeSession(this.state.nextNumber++));
    this.state.columns = this.state.columns.filter(id => id !== sessionId);
    if (!this.state.columns.length) this.state.columns.push(this.state.sessions[0].id);
    this.state.focusedColumn = Math.min(this.state.focusedColumn, this.state.columns.length - 1);
    this.changed();
    return true;
  }
}

module.exports = { SessionStore, makeSession, restore, V1_KEY, V2_KEY };
