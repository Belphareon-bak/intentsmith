'use strict';

const { lineCounts } = require('@intentsmith/chat-panel/lib/browser/work-activity');

function safeName(name) {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..'
    && !/[\\/\x00-\x1f]/.test(name);
}
function flattenTree(nodes, prefix = '', depth = 0) {
  if (!Array.isArray(nodes) || depth > 20) return [];
  const result = [];
  for (const node of nodes) {
    if (!node || !safeName(node.n)) continue;
    const path = prefix ? `${prefix}/${node.n}` : node.n;
    const directory = node.d === true;
    result.push({ path, name: node.n, directory, depth });
    if (directory) result.push(...flattenTree(node.children, path, depth + 1));
  }
  return result;
}
class WorkspaceFiles {
  constructor({ backendUrl, fetchImpl = fetch, onChange = () => {} } = {}) {
    this.backendUrl = backendUrl || (() => window.electronIntentSmith.getBackendUrl());
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.entries = new Map();
  }
  entry(session) {
    if (!this.entries.has(session.id)) this.entries.set(session.id, { root: null, tree: [], editor: null, loading: false, error: null });
    return this.entries.get(session.id);
  }
  changed() { this.onChange(); }
  async request(path, options = {}) {
    const response = await this.fetchImpl(this.backendUrl() + path, { signal: AbortSignal.timeout(8000), ...options });
    let body = {};
    try { body = await response.json(); } catch { /* Keep HTTP status as the error. */ }
    if (!response.ok) throw Object.assign(new Error(body.error || `HTTP ${response.status}`), { status: response.status, body });
    return body;
  }
  async loadTree(session) {
    const state = this.entry(session);
    if (!session._projectId) { state.error = 'Tahle relace nemá projekt.'; this.changed(); return false; }
    state.loading = true; state.error = null; this.changed();
    try {
      const data = await this.request('/api/workspace/tree?project_id=' + encodeURIComponent(session._projectId));
      if (!Array.isArray(data.tree) || typeof data.root !== 'string' || !data.root.startsWith('/')) throw new Error('Neplatný strom projektu.');
      state.root = data.root;
      state.tree = flattenTree(data.tree);
      state.loading = false;
      this.changed();
      return true;
    } catch (error) {
      state.error = error.message || 'Strom souborů se nepodařilo načíst.';
      state.loading = false; this.changed(); return false;
    }
  }
  async open(session, path) {
    const state = this.entry(session);
    if (!state.root || !state.tree.some(item => item.path === path && !item.directory)) return false;
    if (state.editor?.dirty) { state.error = 'Nejprve uložte nebo zahoďte neuložené změny.'; this.changed(); return false; }
    try {
      const data = await this.request('/api/workspace/file?root=' + encodeURIComponent(state.root) + '&path=' + encodeURIComponent(path));
      if (typeof data.content !== 'string' || typeof data.hash !== 'string' || data.path !== path) throw new Error('Neplatná odpověď souboru.');
      state.editor = { path, original: data.content, draft: data.content, hash: data.hash, dirty: false };
      session._openedFiles = Array.isArray(session._openedFiles) ? session._openedFiles : [];
      session._openedFiles = [path, ...session._openedFiles.filter(value => value !== path)].slice(0, 30);
      state.error = null; this.changed(); return true;
    } catch (error) { state.error = error.message || 'Soubor nelze otevřít.'; this.changed(); return false; }
  }
  edit(session, draft) {
    const state = this.entry(session);
    if (!state.editor || typeof draft !== 'string') return;
    state.editor.draft = draft;
    state.editor.dirty = draft !== state.editor.original;
    this.changed();
  }
  discard(session) {
    const state = this.entry(session);
    if (!state.editor) return;
    state.editor.draft = state.editor.original;
    state.editor.dirty = false;
    state.error = null; this.changed();
  }
  async save(session) {
    const state = this.entry(session);
    const editor = state.editor;
    if (!editor?.dirty || !state.root || !state.tree.some(item => item.path === editor.path && !item.directory)) return false;
    try {
      const result = await this.request('/api/workspace/file', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: state.root, path: editor.path, content: editor.draft, expectedHash: editor.hash }) });
      if (result.ok !== true || result.path !== editor.path) throw new Error('Server nepotvrdil uložení souboru.');
      const saved = await this.request('/api/workspace/file?root=' + encodeURIComponent(state.root) + '&path=' + encodeURIComponent(editor.path));
      if (saved.content !== editor.draft || typeof saved.hash !== 'string') throw new Error('Uložený obsah nebyl ověřen.');
      const before = editor.original;
      editor.previous = before;
      editor.original = saved.content; editor.hash = saved.hash; editor.dirty = false;
      session._fileChanges = session._fileChanges && typeof session._fileChanges === 'object' ? session._fileChanges : {};
      session._fileChanges[editor.path] = lineCounts(before, saved.content);
      session._modifiedFiles = Array.isArray(session._modifiedFiles) ? session._modifiedFiles : [];
      session._modifiedFiles = [editor.path, ...session._modifiedFiles.filter(value => value !== editor.path)].slice(0, 30);
      state.error = null; this.changed(); return true;
    } catch (error) { state.error = error.status === 409 ? 'Soubor mezitím změnil jiný proces. Vaše úprava zůstává otevřená.' : error.message || 'Uložení selhalo.'; this.changed(); return false; }
  }
  anyDirty() { return [...this.entries.values()].some(state => state.editor?.dirty); }
}
module.exports = { WorkspaceFiles, flattenTree };
