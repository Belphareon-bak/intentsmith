'use strict';

const SECTIONS = ['Konverzace', 'Projekty', 'Specialisté', 'Expertýzy', 'Workeři', 'Obchod', 'Multimédia', 'Nastavení'];

function entries(widget) {
  const commands = [
    ...widget.store.state.sessions.map(session => ({
      id: 'session:' + session.id, label: `${session.number} · ${session._label}`, group: 'Relace',
      run: () => { widget.section = 'Relace'; widget.store.focusTab(session.id); },
    })),
    { id: 'new-session', label: 'Nová relace', group: 'Příkaz', run: () => widget.addSession() },
    ...[1, 2, 3].filter(count => count <= widget.store.state.sessions.length).map(count => ({
      id: 'columns:' + count, label: `${count} ${count === 1 ? 'sloupec' : 'sloupce'}`, group: 'Rozvržení',
      run: () => widget.store.setColumnCount(count),
    })),
    ...SECTIONS.map(name => ({
      id: 'section:' + name, label: name, group: 'Sekce', run: () => widget.selectSection(name),
    })),
    { id: 'appearance', label: 'Nastavení vzhledu', group: 'Příkaz',
      run: () => { widget.settingsCategory = 'Vzhled'; widget.settingsTab = 'Obecné'; widget.selectSection('Nastavení'); } },
    { id: 'environment', label: 'Prostředí a závislosti', group: 'Příkaz',
      run: () => { widget.settingsCategory = 'Systém'; widget.settingsTab = 'Prostředí a závislosti'; widget.selectSection('Nastavení'); } },
  ];
  return commands;
}
function filteredEntries(widget) {
  const query = (widget.paletteQuery || '').trim().toLocaleLowerCase('cs-CZ');
  return entries(widget).filter(entry => !query
    || (`${entry.label} ${entry.group}`).toLocaleLowerCase('cs-CZ').includes(query)).slice(0, 40);
}
function execute(widget, entry) {
  if (!entry) return false;
  widget.paletteOpen = false;
  widget.paletteQuery = '';
  entry.run();
  widget.update();
  return true;
}
function renderPalette(widget, h) {
  if (!widget.paletteOpen) return null;
  const results = filteredEntries(widget);
  return h('div', { className: 'intentsmith-s2-palette-backdrop', onMouseDown: event => {
    if (event.target === event.currentTarget) { widget.paletteOpen = false; widget.update(); }
  } }, h('section', { className: 'intentsmith-s2-palette', role: 'dialog', 'aria-modal': 'true',
    'aria-label': 'Paleta příkazů' },
  h('input', { type: 'search', autoFocus: true, 'aria-label': 'Hledat příkaz nebo relaci',
    placeholder: 'Relace, sekce nebo příkaz…', value: widget.paletteQuery || '',
    onChange: event => { widget.paletteQuery = event.target.value; widget.update(); },
    onKeyDown: event => {
      if (event.key === 'Escape') { event.preventDefault(); widget.paletteOpen = false; widget.update(); }
      if (event.key === 'Enter') { event.preventDefault(); execute(widget, results[0]); }
    } }),
  h('div', { className: 'intentsmith-s2-palette-results' },
    results.length ? results.map(entry => h('button', { key: entry.id, type: 'button', onClick: () => execute(widget, entry) },
      h('small', null, entry.group), h('span', null, entry.label)))
      : h('p', null, 'Žádný odpovídající příkaz.'))));
}
module.exports = { entries, filteredEntries, execute, renderPalette };
