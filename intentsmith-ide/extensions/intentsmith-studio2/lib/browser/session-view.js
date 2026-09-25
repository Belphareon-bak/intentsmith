'use strict';

const WorkActivity = require('@intentsmith/chat-panel/lib/browser/work-activity');
const { renderWorkspaceFiles } = require('./workspace-view');

function renderSessionView(widget, h) {
  const store = widget.store;
  const state = store.state;
  const focused = store.focusedSession();
  const connection = widget.transport?.connection || 'Připojování';
  function message(item, index) {
    const assistant = item.role === 'assistant';
    const Activity = WorkActivity.createComponents(h).Activity;
    return h('article', { key: index, className: `intentsmith-s2-message ${item.role}` },
      h('header', null, h('strong', null, assistant ? 'IntentSmith' : item.role === 'user' ? 'Ty' : 'Systém'),
        item.tag ? h('span', { className: 'intentsmith-s2-tag' }, item.tag) : null,
        assistant ? h('button', { type: 'button', onClick: () => navigator.clipboard.writeText(item.text || '') }, 'Kopírovat') : null),
      assistant ? h('div', { className: 'intentsmith-s2-markdown', dangerouslySetInnerHTML: { __html: WorkActivity.renderMarkdown(item.text || '') } })
        : h('p', null, item.text),
      item._activity ? h(Activity, { activity: item._activity }) : null);
  }
  function bottom(session) {
    const mode = widget.bottomMode || 'Průběh';
    const tabs = ['Terminál', 'Log agenta', 'Průběh', 'Audit', 'Problémy'];
    let content = 'Zatím žádné události.';
    if (mode === 'Terminál') content = session.term.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry.data || entry.text || entry)).join('\n');
    if (mode === 'Log agenta') content = session.log.map(entry => entry.text || JSON.stringify(entry)).join('\n');
    if (mode === 'Průběh') content = session.chat.msgs.flatMap(item => item._activity?.steps || []).map(step => `${step.label} · ${step.status}`).join('\n');
    return h('div', { className: 'intentsmith-s2-bottom' },
      h('div', { className: 'intentsmith-s2-bottom-tabs' }, tabs.map(tab => h('button', {
        key: tab, type: 'button', className: tab === mode ? 'active' : '', onClick: () => { widget.bottomMode = tab; widget.update(); },
      }, tab))),
      h('pre', { className: 'intentsmith-s2-bottom-content' }, content || 'Zatím žádné události.'));
  }
  function column(sessionId, index) {
    const session = store.find(sessionId);
    if (!session) return null;
    const focusedColumn = state.focusedColumn === index;
    return h('section', { key: sessionId, className: `intentsmith-s2-column${focusedColumn ? ' focused' : ''}`, onClick: () => store.focusColumn(index) },
      h('header', { className: 'intentsmith-s2-column-head' },
        h('span', { className: 'intentsmith-s2-number' }, session.number),
        h('select', { 'aria-label': `Relace ve sloupci ${index + 1}`, value: sessionId, onChange: event => {
          if (event.target.value === '__new') widget.addSession();
          else store.selectInColumn(index, event.target.value);
        } }, state.sessions.map(item => h('option', { key: item.id, value: item.id }, `${item.number} · ${item._label}`)),
        h('option', { value: '__new' }, 'Nová relace')),
        session._projectId ? h('span', { className: 'intentsmith-s2-chip' }, `Projekt ${session._projectId}`) : null,
        h('span', { className: 'intentsmith-s2-context' }, `${Math.round(session.chat.ctx || 0)} %`),
        h('button', { type: 'button', 'aria-label': 'Zavřít sloupec', disabled: state.columns.length === 1, onClick: event => { event.stopPropagation(); store.closeColumn(index); } }, '×')),
      h('div', { className: 'intentsmith-s2-messages' },
        session.chat.msgs.length ? session.chat.msgs.map(message) : h('p', null, 'Napište zprávu a začněte konverzaci.'),
        session.chat._thinking ? h('p', { className: 'intentsmith-s2-thinking' }, session.chat._thinking.text) : null,
        session.chat._delivery?.status === 'NOT_SENT' ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, session.chat._delivery.text) : null,
        session.chat._delivery?.status === 'DELIVERY_UNKNOWN' ? h('div', { role: 'alert', className: 'intentsmith-s2-error' },
          h('p', null, session.chat._delivery.text),
          h('button', { type: 'button', onClick: () => widget.transport.acknowledgeUnknown(session) }, 'Pokračovat bez opakování')) : null),
      h('div', { className: 'intentsmith-s2-composer' },
        h('textarea', { 'aria-label': `Zpráva v relaci ${session.number}`, placeholder: 'Napište zprávu…', onKeyDown: event => {
          if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); widget.send(session, event.currentTarget); }
        } }),
        h('div', { className: 'intentsmith-s2-composer-controls' },
          h('button', { type: 'button', onClick: () => { session.chat.editMode = session.chat.editMode === 'ask' ? 'auto' : 'ask'; store.changed(); } }, session.chat.editMode === 'ask' ? 'Kontrola' : 'Auto'),
          h('button', { type: 'button', onClick: event => widget.send(session, event.currentTarget.closest('.intentsmith-s2-composer').querySelector('textarea')) }, 'Odeslat'))),
      bottom(session));
  }
  function right(session) {
    const tabs = ['Změny', 'Soubory', 'Správa zdrojů', 'Kontext'];
    const side = widget.sideMode || 'Soubory';
    const content = side === 'Kontext' ? h('p', null, `Kontext relace: ${Math.round(session.chat.ctx || 0)} %`)
      : side === 'Změny' ? h('p', null, 'Žádné ověřené změny v této relaci.')
        : side === 'Správa zdrojů' ? h('p', null, 'Správa zdrojů se připravuje. Git efekty nejsou dostupné.')
          : renderWorkspaceFiles(widget, session, h);
    return h('aside', { className: 'intentsmith-studio2-right', 'aria-label': 'Pracovní plocha' },
      h('h2', null, `Relace ${session.number} · ${session._label}`),
      h('div', { className: 'intentsmith-s2-side-tabs' }, tabs.map(tab => h('button', {
        type: 'button', key: tab, className: tab === side ? 'active' : '', onClick: () => { widget.sideMode = tab; widget.update(); },
      }, tab))), h('div', { className: 'intentsmith-s2-side-content' }, content));
  }
  return {
    tabs: h('div', { className: 'intentsmith-studio2-tabs' },
      state.sessions.map(session => h('div', { key: session.id, className: `intentsmith-s2-tab${focused?.id === session.id ? ' active' : ''}` },
        h('button', { type: 'button', onClick: () => { widget.section = 'Relace'; store.focusTab(session.id); } }, `${session.number} · ${session._label}`),
        h('button', { type: 'button', 'aria-label': `Zavřít relaci ${session.number}`, onClick: () => widget.closeSession(session) }, '×'))),
      h('button', { type: 'button', 'aria-label': 'Nová relace', onClick: () => widget.addSession() }, '+')),
    columns: h('div', { className: 'intentsmith-s2-columns' }, state.columns.map(column)),
    right: focused ? right(focused) : null,
    connection,
  };
}

module.exports = { renderSessionView };
