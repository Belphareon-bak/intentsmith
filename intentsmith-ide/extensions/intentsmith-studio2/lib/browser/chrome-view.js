'use strict';

const { icon, SECTIONS } = require('./icon');

const SECTION_TONES = Object.freeze({
  Konverzace: 'amber', Projekty: 'rose', Specialisté: 'violet', Expertýzy: 'cyan',
  Workeři: 'mint', Obchod: 'blue', Multimédia: 'violet',
});
const { selectMode } = require('./studio-mode-module');

function renderChrome(widget, h, sections) {
  const state = widget.store.state;
  const appearance = widget.appearance;
  const active = widget.store.focusedSession();
  const menuActions = {
    Soubor: [
      ['Nová relace', () => widget.addSession()],
      ['Projekty', () => widget.selectSection('Projekty')],
      ['Nastavení', () => widget.selectSection('Nastavení')],
    ],
    Úpravy: [
      ['Kopírovat poslední odpověď', () => {
        const latest = [...(active?.chat.msgs || [])].reverse().find(item => item.role === 'assistant');
        if (latest) navigator.clipboard.writeText(latest.text || '');
      }, !active?.chat.msgs.some(item => item.role === 'assistant')],
    ],
    Zobrazení: [
      [widget.navVisible ? 'Skrýt navigaci' : 'Zobrazit navigaci', () => { widget.navVisible = !widget.navVisible; widget.update(); }],
      [widget.bottomVisible ? 'Skrýt spodní panel' : 'Zobrazit spodní panel', () => { widget.bottomVisible = !widget.bottomVisible; widget.update(); }],
      [widget.rightVisible ? 'Skrýt pracovní plochu' : 'Zobrazit pracovní plochu', () => { widget.rightVisible = !widget.rightVisible; widget.update(); }],
      ['Dlaždice', () => { widget.catalogLayout = 'tiles'; widget.update(); }],
      ['Seznam', () => { widget.catalogLayout = 'list'; widget.update(); }],
      ['Nastavení vzhledu', () => { widget.settingsCategory = 'Vzhled'; widget.settingsTab = 'Obecné'; widget.selectSection('Nastavení'); }],
    ],
    Relace: [
      ['Nová relace', () => widget.addSession()],
      ...state.sessions.map(session => [`${session.number} · ${session._label}`, () => { widget.section = 'Relace'; widget.store.focusTab(session.id); }]),
    ],
    Agent: [
      ['Zastavit odpověď', () => widget.transport?.cancel(active), !active || !widget.transport?.hasActiveM1Turn(active)],
      ['Zobrazit změny', () => { widget.section = 'Relace'; widget.sideMode = 'Změny'; widget.update(); }],
    ],
    Nápověda: [
      ['Prostředí a závislosti', () => { widget.settingsCategory = 'Systém'; widget.settingsTab = 'Prostředí a závislosti'; widget.selectSection('Nastavení'); }],
      ['O aplikaci', () => { widget.settingsCategory = 'O aplikaci'; widget.settingsTab = 'Aplikace'; widget.selectSection('Nastavení'); }],
      ['Klasické Studio', () => selectMode('classic')],
    ],
  };
  return h('header', { className: 'intentsmith-studio2-top' },
    h('div', { className: 'intentsmith-s2-brand-mark', 'aria-label': 'IntentSmith' }, icon(h, 'anvil', 19)),
    h('div', { className: 'intentsmith-s2-menu-bar' }, Object.entries(menuActions).map(([name, actions]) =>
      h('div', { key: name, className: 'intentsmith-s2-menu-item' },
        h('button', { type: 'button', className: widget.menuOpen === name ? 'active' : '',
          'aria-expanded': widget.menuOpen === name,
          onMouseEnter: () => { if (widget.menuOpen && widget.menuOpen !== name) { widget.menuOpen = name; widget.update(); } },
          onClick: () => { widget.menuOpen = widget.menuOpen === name ? null : name; widget.update(); } }, name),
        widget.menuOpen === name ? h('div', { className: 'intentsmith-s2-menu-popover' }, actions.map(([label, run, disabled]) =>
          h('button', { key: label, type: 'button', disabled: Boolean(disabled), onClick: () => { widget.menuOpen = null; run(); widget.update(); } }, label))) : null))),
    h('button', { type: 'button', className: 'intentsmith-s2-search',
      onClick: () => { widget.menuOpen = null; widget.paletteOpen = true; widget.paletteQuery = ''; widget.update(); } },
      icon(h, 'search', 14), h('span', null, 'Hledat, přepnout relaci, spustit příkaz…'), h('kbd', null, 'Ctrl K')),
    h('div', { className: 'intentsmith-s2-top-controls' },
      h('button', { type: 'button', 'aria-label': 'Dlaždice', className: widget.catalogLayout === 'tiles' ? 'active' : '',
        onClick: () => { widget.catalogLayout = 'tiles'; widget.update(); } }, icon(h, 'grid', 15)),
      h('button', { type: 'button', 'aria-label': 'Seznam', className: widget.catalogLayout === 'list' ? 'active' : '',
        onClick: () => { widget.catalogLayout = 'list'; widget.update(); } }, icon(h, 'list', 15)),
      h('span', { className: 'intentsmith-s2-control-separator' }),
      [1, 2, 3].map(count => h('button', { key: count, type: 'button', disabled: count > state.sessions.length,
        className: count === state.columns.length ? 'active' : '', onClick: () => widget.store.setColumnCount(count),
        'aria-label': `${count} sloupce` }, count)),
      h('span', { className: 'intentsmith-s2-control-separator' }),
      [['nav', 'Navigace', 'navVisible'], ['bottom', 'Terminály relací', 'bottomVisible'], ['side', 'Pracovní plocha', 'rightVisible']]
        .map(([symbol, title, key]) => h('button', { key, type: 'button', title, 'aria-label': title,
          className: widget[key] ? 'active' : '', onClick: () => { widget[key] = !widget[key]; widget.update(); } }, icon(h, symbol, 15))),
      h('select', { 'aria-label': 'Styl Studia 2', value: appearance.values.style,
        onChange: event => appearance.set('style', event.target.value) },
        require('./appearance-store').STYLES.map(style => h('option', { key: style, value: style }, style))),
      h('button', { type: 'button', 'aria-label': 'Přepnout světlý a tmavý motiv', title: 'Světlý / tmavý motiv',
        disabled: ['matrix', 'japanese', 'midnight'].includes(appearance.values.style),
        onClick: () => appearance.set('theme', appearance.effectiveTheme() === 'dark' ? 'light' : 'dark') },
        appearance.effectiveTheme() === 'dark' ? '☾' : '☼')));
}
function renderNavigation(widget, h, sections) {
  return h('nav', { className: `intentsmith-studio2-nav${widget.navVisible ? '' : ' collapsed'}`, 'aria-label': 'Hlavní navigace' },
    sections.map(name => {
      const view = widget.catalog.view(name);
      return h('button', { key: name, type: 'button', title: name, className: name === widget.section ? 'active' : '',
        onClick: () => widget.selectSection(name) },
        h('span', { className: `intentsmith-s2-nav-icon tone-${SECTION_TONES[name]}` }, icon(h, SECTIONS[name], 16)),
        h('span', { className: 'intentsmith-s2-nav-name' }, name),
        view.status === 'ready' ? h('small', { className: 'intentsmith-s2-nav-count' }, view.items.length) : null,
        h('span', { className: 'intentsmith-s2-nav-arrow' }, icon(h, 'right', 12)));
    }),
    h('div', { className: 'intentsmith-studio2-nav-bottom' },
      h('button', { type: 'button', title: 'Nastavení', className: widget.section === 'Nastavení' ? 'active' : '',
        onClick: () => widget.selectSection('Nastavení') },
        h('span', { className: 'intentsmith-s2-nav-icon tone-none' }, icon(h, 'gear', 16)),
        h('span', { className: 'intentsmith-s2-nav-name' }, 'Nastavení'))));
}
module.exports = { renderChrome, renderNavigation };
