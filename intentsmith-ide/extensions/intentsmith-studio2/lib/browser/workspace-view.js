'use strict';

const { lineCounts } = require('@intentsmith/chat-panel/lib/browser/work-activity');

function renderWorkspaceFiles(widget, session, h) {
  const files = widget.workspace;
  const state = files.entry(session);
  const editor = state.editor;
  const mode = widget.fileViewMode || 'Náhled';
  function link(path, label, suffix = '') {
    return h('button', { key: path, type: 'button', className: 'intentsmith-s2-file-link',
      onClick: () => { files.open(session, path).then(ok => { if (ok) { widget.fileViewMode = 'Náhled'; widget.store.changed(); } }); } },
      h('span', null, label), h('small', null, suffix));
  }
  function section(title, rows, empty) {
    return h('section', { className: 'intentsmith-s2-file-group' }, h('h3', null, title),
      rows.length ? rows : h('p', null, empty));
  }
  const changed = Array.isArray(session._modifiedFiles) ? session._modifiedFiles : [];
  const opened = Array.isArray(session._openedFiles) ? session._openedFiles : [];
  const modified = changed.map(path => {
    const counts = session._fileChanges?.[path];
    const suffix = counts ? `Zapsáno · +${counts.added} / −${counts.removed}` : 'Zapsáno';
    return link(path, path, suffix);
  });
  const active = opened.map(path => link(path, path));
  const tree = state.tree.map(item => item.directory
    ? h('div', { key: item.path, className: 'intentsmith-s2-file-directory', style: { paddingLeft: `${item.depth * 12}px` } }, item.name)
    : h('div', { key: item.path, style: { paddingLeft: `${item.depth * 12}px` } }, link(item.path, item.name)));
  return h('div', { className: 'intentsmith-s2-files' },
    session._projectId ? h('button', { type: 'button', onClick: () => files.loadTree(session) }, 'Obnovit strom projektu')
      : h('p', null, 'Tahle relace nemá projekt.'),
    state.loading ? h('p', { role: 'status' }, 'Načítání souborů…') : null,
    state.error ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, state.error) : null,
    section('Upravené v relaci', modified, 'Žádné ověřené zápisy v této relaci.'),
    section('Otevřené', active, 'Zatím žádné otevřené soubory.'),
    section('Projekt', tree, session._projectId ? 'Načtěte strom projektu.' : 'Žádný projekt.'),
    editor ? h('section', { className: 'intentsmith-s2-file-editor' },
      h('h3', null, editor.path),
      editor.dirty ? h('p', null, 'Neuložené změny') : h('p', null, 'Uloženo'),
      h('div', { className: 'intentsmith-s2-file-tabs' }, ['Náhled','Diff','Upravit'].map(tab => h('button', {
        key: tab, type: 'button', className: tab === mode ? 'active' : '', onClick: () => { widget.fileViewMode = tab; widget.update(); },
      }, tab))),
      mode === 'Upravit' ? h('textarea', { value: editor.draft, 'aria-label': `Upravit ${editor.path}`,
        onChange: event => files.edit(session, event.target.value) })
        : mode === 'Diff' ? h('div', { className: 'intentsmith-s2-file-diff' },
          h('pre', null, editor.previous ?? editor.original), h('pre', null, editor.draft),
          (() => { const counts = lineCounts(editor.previous ?? editor.original, editor.draft);
            return counts ? h('p', null, `+${counts.added} / −${counts.removed}`) : h('p', null, 'Počty řádků nejsou dostupné.'); })())
          : h('pre', null, editor.draft),
      editor.dirty ? h('div', { className: 'intentsmith-s2-file-actions' },
        h('button', { type: 'button', onClick: () => files.discard(session) }, 'Zahodit úpravy'),
        h('button', { type: 'button', onClick: () => files.save(session).then(() => widget.store.changed()) }, 'Uložit')) : null) : null);
}
module.exports = { renderWorkspaceFiles };
