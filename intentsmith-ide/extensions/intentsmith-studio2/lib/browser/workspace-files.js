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
    if (!this.entries.has(session.id)) this.entries.set(session.id, { root: null, projectId: null, tree: [], editor: null, loading: false, error: null });
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
    const projectId = String(session._projectId);
    state.loading = true; state.error = null; this.changed();
    try {
      const data = await this.request('/api/workspace/tree?project_id=' + encodeURIComponent(session._projectId));
      if (!Array.isArray(data.tree) || typeof data.root !== 'string' || !data.root.startsWith('/')) throw new Error('Neplatný strom projektu.');
      if (String(session._projectId) !== projectId) throw new Error('Projekt relace se během načítání změnil.');
      state.projectId = projectId;
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
  async inspect(session, path) {
    const state = this.entry(session);
    if (!state.root || state.projectId !== String(session._projectId) || typeof path !== 'string'
      || !state.tree.some(item => item.path === path)) return null;
    try {
      const result = await this.request('/api/studio2/workspace/entry?project_id='
        + encodeURIComponent(state.projectId) + '&path=' + encodeURIComponent(path));
      if (result.projectId !== Number(state.projectId) || result.path !== path
        || !['file', 'directory'].includes(result.type) || !/^[0-9a-f]{64}$/.test(result.revision)
        || result.type === 'directory' && (!Number.isSafeInteger(result.entries) || result.entries < 0
          || typeof result.protectedDescendants !== 'boolean'))
        throw Error('Backend vrátil neplatnou revizi souboru.');
      return result;
    } catch (error) {
      state.error = error.message || 'Stav souboru nelze načíst.';
      this.changed(); return null;
    }
  }
  async operate(session, { op, path, to = '', expectedRevision = '' }) {
    const state = this.entry(session);
    if (!state.root || state.projectId !== String(session._projectId) || state.operationBusy
      || state.mutationUncertain || state.editor?.dirty || state.saving
      || !['create_file', 'create_directory', 'rename', 'delete'].includes(op)
      || typeof path !== 'string' || !path || typeof to !== 'string'
      || (['rename', 'delete'].includes(op) && !/^[0-9a-f]{64}$/.test(expectedRevision))) return false;
    state.operationBusy = true;
    state.mutationUncertain = true;
    state.error = null; this.changed();
    try {
      const result = await this.request('/api/studio2/workspace/operation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: Number(state.projectId), op, path,
          ...(op === 'rename' ? { to } : {}),
          ...(['rename', 'delete'].includes(op) ? { expectedRevision } : {}) }) });
      if (result.ok !== true || result.projectId !== Number(state.projectId)
        || result.op !== op || result.path !== path || op === 'rename' && result.to !== to)
        throw Error('Backend nepotvrdil přesnou operaci se souborem.');
      const afterPath = op === 'rename' ? to : path;
      const original = state.tree.find(item => item.path === path);
      try {
        const check = await this.request('/api/studio2/workspace/entry?project_id='
          + encodeURIComponent(state.projectId) + '&path=' + encodeURIComponent(afterPath));
        if (op === 'delete' || check.projectId !== Number(state.projectId) || check.path !== afterPath
          || check.type !== (op === 'create_directory' ? 'directory' : op === 'create_file' ? 'file'
            : original?.directory ? 'directory' : 'file'))
          throw Error('Stav po operaci neodpovídá plánu.');
      } catch (error) {
        if (op !== 'delete' || error.status !== 404) throw error;
      }
      if (op === 'rename') {
        try {
          await this.request('/api/studio2/workspace/entry?project_id='
            + encodeURIComponent(state.projectId) + '&path=' + encodeURIComponent(path));
          throw Error('Původní položka po přejmenování stále existuje.');
        } catch (error) { if (error.status !== 404) throw error; }
      }
      state.mutationUncertain = false;
      const refreshed = await this.loadTree(session);
      if (!refreshed) { state.error = 'Operace byla potvrzena, ale strom se nepodařilo načíst. Obnov seznam.'; this.changed(); }
      return true;
    } catch (error) {
      if ([400, 403, 404, 409, 413].includes(error.status)) state.mutationUncertain = false;
      state.error = state.mutationUncertain
        ? 'Výsledek operace není jistý. Obnov strom a ověř soubor před dalším pokusem.'
        : error.message || 'Operace se souborem selhala.';
      this.changed(); return false;
    } finally { state.operationBusy = false; this.changed(); }
  }
  async refreshAfterUncertain(session) {
    const state = this.entry(session);
    if (!state.mutationUncertain || state.operationBusy) return false;
    if (!await this.loadTree(session)) return false;
    state.mutationUncertain = false;
    state.error = 'Strom obnoven. Před další akcí zkontroluj skutečný stav souborů.';
    this.changed(); return true;
  }
  async open(session, path) {
    const state = this.entry(session);
    if (!state.root || state.projectId !== String(session._projectId)
      || !state.tree.some(item => item.path === path && !item.directory)) return false;
    if (state.editor?.dirty) { state.error = 'Nejprve uložte nebo zahoďte neuložené změny.'; this.changed(); return false; }
    try {
      const data = await this.request('/api/workspace/file?root=' + encodeURIComponent(state.root) + '&path=' + encodeURIComponent(path));
      if (typeof data.content !== 'string' || typeof data.hash !== 'string' || data.path !== path) throw new Error('Neplatná odpověď souboru.');
      state.editor = { path, original: data.content, draft: data.content, hash: data.hash, dirty: false };
      state.saveUncertain = false; state.pendingSaveDraft = null;
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
    if (state.saving) {
      state.error = 'Počkejte na odpověď o uložení.'; this.changed(); return;
    }
    if (state.saveUncertain) {
      state.editor = null; state.saveUncertain = false; state.pendingSaveDraft = null;
      state.error = 'Úpravy byly zahozeny. Otevřete soubor znovu pro skutečný obsah.';
      this.changed(); return;
    }
    state.editor.draft = state.editor.original;
    state.editor.dirty = false;
    state.error = null; this.changed();
  }
  async verifySave(session, { internal = false } = {}) {
    const state = this.entry(session);
    const editor = state.editor;
    const sent = state.pendingSaveDraft;
    if ((state.saving && !internal) || !state.saveUncertain || !editor || typeof sent !== 'string' || !state.root
      || state.projectId !== String(session._projectId)) return false;
    try {
      const saved = await this.request('/api/workspace/file?root=' + encodeURIComponent(state.root)
        + '&path=' + encodeURIComponent(editor.path));
      if (saved.path !== editor.path || typeof saved.content !== 'string' || typeof saved.hash !== 'string') {
        throw new Error('Server nevrátil ověřitelný obsah souboru.');
      }
      if (saved.content === editor.original) {
        state.saveUncertain = false; state.pendingSaveDraft = null;
        state.error = 'Zápis se neprojevil. Můžete jej odeslat znovu.';
        this.changed(); return false;
      }
      if (saved.content !== sent) {
        state.error = 'Soubor má jiný obsah. Vaše úprava zůstává otevřená; před další akcí ji porovnejte se souborem na disku.';
        this.changed(); return false;
      }
      const before = editor.original;
      editor.previous = before;
      editor.original = saved.content; editor.hash = saved.hash;
      editor.dirty = editor.draft !== saved.content;
      session._fileChanges = session._fileChanges && typeof session._fileChanges === 'object' ? session._fileChanges : {};
      session._fileChanges[editor.path] = lineCounts(before, saved.content);
      session._modifiedFiles = Array.isArray(session._modifiedFiles) ? session._modifiedFiles : [];
      session._modifiedFiles = [editor.path, ...session._modifiedFiles.filter(value => value !== editor.path)].slice(0, 30);
      state.saveUncertain = false; state.pendingSaveDraft = null;
      state.error = null; this.changed(); return true;
    } catch (error) {
      state.error = error.message || 'Stav zápisu nelze ověřit.';
      this.changed(); return false;
    }
  }
  async save(session) {
    const state = this.entry(session);
    const editor = state.editor;
    if (!editor?.dirty || state.saveUncertain || state.saving || !state.root || state.projectId !== String(session._projectId)
      || !state.tree.some(item => item.path === editor.path && !item.directory)) return false;
    const draft = editor.draft;
    state.saveUncertain = true; state.saving = true;
    state.pendingSaveDraft = draft;
    this.changed();
    try {
      const result = await this.request('/api/workspace/file', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: state.root, path: editor.path, content: draft, expectedHash: editor.hash }) });
      if (result.ok !== true || result.path !== editor.path) throw new Error('Server nepotvrdil uložení souboru.');
      return await this.verifySave(session, { internal: true });
    } catch (error) {
      state.error = error.status === 409
        ? 'Soubor mezitím změnil jiný proces. Ověřte stav před dalším pokusem; vaše úprava zůstává otevřená.'
        : 'Výsledek zápisu je neznámý. Ověřte skutečný obsah souboru před dalším pokusem.';
      this.changed(); return false;
    } finally {
      state.saving = false; this.changed();
    }
  }
  async completePath(session, command) {
    const state = this.entry(session);
    if (!state.root || state.projectId !== String(session._projectId) || typeof command !== 'string') return null;
    const split = command.search(/[^\s]*$/);
    const token = command.slice(split);
    if (!token || token.startsWith('/') || token.includes('\\')) return null;
    const slash = token.lastIndexOf('/');
    const directory = slash < 0 ? '' : token.slice(0, slash + 1);
    const prefix = slash < 0 ? token : token.slice(slash + 1);
    if (directory.split('/').some(part => part === '..')) return null;
    const absolute = state.root + (directory ? '/' + directory.slice(0, -1) : '');
    const data = await this.request('/api/workspace/ls?path=' + encodeURIComponent(absolute)
      + '&prefix=' + encodeURIComponent(prefix));
    const matches = Array.isArray(data.entries) ? data.entries.filter(item => safeName(item?.name)
      && item.name.startsWith(prefix) && typeof item.isDir === 'boolean') : [];
    if (matches.length !== 1) return null;
    return command.slice(0, split) + directory + matches[0].name + (matches[0].isDir ? '/' : '');
  }
  anyDirty() { return [...this.entries.values()].some(state => state.editor?.dirty); }
}
module.exports = { WorkspaceFiles, flattenTree };
