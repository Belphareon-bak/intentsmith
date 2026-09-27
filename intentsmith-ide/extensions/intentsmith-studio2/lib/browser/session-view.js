'use strict';

const WorkActivity = require('@intentsmith/chat-panel/lib/browser/work-activity');
const { renderWorkspaceFiles } = require('./workspace-view');
const { renderM2Changes, renderM2ApprovalCard } = require('./m2-view');
const { icon } = require('./icon');

function renderSessionView(widget, h) {
  const store = widget.store;
  const state = store.state;
  const focused = store.focusedSession();
  const connection = widget.transport?.connection || 'Připojování';
  function timeline(activity) {
    if (!activity) return null;
    return h('div', { className: 'intentsmith-s2-timeline', 'data-activity-status': activity.status },
      activity.steps.map(step => h('details', { key: step.id, className: `intentsmith-s2-timeline-step ${step.status}` },
        h('summary', null,
          h('span', { className: `intentsmith-s2-state-dot ${step.status === 'running' ? 'running' : step.status === 'error' ? 'waiting' : ''}` }),
          h('span', null, step.label),
          h('small', null, step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)} s` : step.status === 'running' ? 'probíhá' : step.status === 'error' ? 'chyba' : '')),
        step.input ? h('pre', null, step.input) : null,
        step.output ? h('pre', null, step.output) : null)),
      h('p', { className: 'intentsmith-s2-activity-status' }, activity.label,
        activity.omitted ? ` · ${activity.omitted} starších kroků v logu` : ''));
  }
  function message(session, item, index) {
    const assistant = item.role === 'assistant';
    const who = assistant ? session.chat.specialist?.name || 'IntentSmith' : item.role === 'user' ? 'Ty' : 'Systém';
    const time = item.ts ? new Date(item.ts).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : '';
    return h('article', { key: index, className: `intentsmith-s2-message ${item.role}` },
      h('header', null,
        assistant ? h('span', { className: 'intentsmith-s2-author-icon' }, icon(h, 'anvil', 14)) : null,
        h('strong', null, who),
        item.tag ? h('span', { className: 'intentsmith-s2-tag' }, item.tag) : null,
        time ? h('time', null, time) : null,
        assistant ? h('button', { type: 'button', 'aria-label': 'Kopírovat odpověď',
          onClick: () => navigator.clipboard.writeText(item.text || '') }, 'Kopírovat') : null),
      timeline(item._activity),
      assistant ? h('div', { className: 'intentsmith-s2-markdown', dangerouslySetInnerHTML: { __html: WorkActivity.renderMarkdown(item.text || '') } })
        : h('p', null, item.text));
  }
  function bottom(session) {
    const tabs = ['Terminál', 'Log agenta', 'Průběh', 'Audit', 'Problémy'];
    const mode = tabs.includes(session.bottom) ? session.bottom : 'Průběh';
    let content = 'Zatím žádné události.';
    if (mode === 'Terminál') content = session.term.map(entry => typeof entry === 'string' ? entry : entry.text || '').join('\n');
    if (mode === 'Log agenta') content = session.log.map(entry => entry.text || JSON.stringify(entry)).join('\n');
    const progress = session.chat.msgs.flatMap(item => item._activity?.steps || []);
    if (mode === 'Průběh') content = null;
    return h('div', { className: 'intentsmith-s2-bottom' },
      h('div', { className: 'intentsmith-s2-bottom-tabs' }, tabs.map(tab => h('button', {
        key: tab, type: 'button', className: tab === mode ? 'active' : '', onClick: () => { session.bottom = tab; store.changed(); },
      }, tab))),
      mode === 'Průběh' ? h('div', { className: 'intentsmith-s2-progress' },
        progress.length ? h('table', null,
          h('thead', null, h('tr', null, ['Čas', 'Krok', 'Nástroj', 'Cíl', 'Trvání', 'Stav'].map(label => h('th', { key: label }, label)))),
          h('tbody', null, progress.map((step, index) => h('tr', { key: step.id || index },
            h('td', null, step.startedAt ? new Date(step.startedAt).toLocaleTimeString('cs-CZ') : '—'),
            h('td', null, step.label), h('td', null, step.tool || (step.kind === 'model' ? 'model' : '—')),
            h('td', null, step.input || '—'), h('td', null, step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)} s` : '—'),
            h('td', null, step.status))))) : h('p', null, 'Zatím žádné kroky.'))
        : h('pre', { className: 'intentsmith-s2-bottom-content' }, content || 'Zatím žádné události.'),
      mode === 'Terminál' ? h('div', { className: 'intentsmith-s2-terminal-input' },
        h('span', null, '$'),
        h('input', { type: 'text', 'aria-label': `Příkaz terminálu relace ${session.number}`,
          disabled: connection !== 'Připojeno' || widget.transport?.isTerminalExecuting(session),
          onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); widget.sendTerminal(session, event.currentTarget); }
            if (event.key === 'Tab') { event.preventDefault(); widget.completeTerminal(session, event.currentTarget); }
          } }),
        h('button', { type: 'button', disabled: connection !== 'Připojeno' || widget.transport?.isTerminalExecuting(session),
          onClick: event => widget.sendTerminal(session, event.currentTarget.closest('.intentsmith-s2-terminal-input').querySelector('input')) }, 'Spustit')) : null);
  }
  function column(sessionId, index) {
    const session = store.find(sessionId);
    if (!session) return null;
    const focusedColumn = state.focusedColumn === index;
    return h('section', { key: sessionId, className: `intentsmith-s2-column${focusedColumn ? ' focused' : ''}`, onClick: () => store.focusColumn(index) },
      h('header', { className: 'intentsmith-s2-column-head' },
        h('span', { className: 'intentsmith-s2-number' }, session.number),
        icon(h, session._projectId ? 'folder' : session.chat.specialist ? 'users' : 'chat', 13),
        h('span', { className: `intentsmith-s2-state-dot${session.chat._thinking ? ' running' : session._m2Pending ? ' waiting' : ''}` }),
        h('select', { 'aria-label': `Relace ve sloupci ${index + 1}`, value: sessionId, onChange: event => {
          if (event.target.value === '__new') widget.addSession();
          else store.selectInColumn(index, event.target.value);
        } }, state.sessions.map(item => h('option', { key: item.id, value: item.id }, `${item.number} · ${item._label}`)),
        h('option', { value: '__new' }, 'Nová relace')),
        session._projectId ? h('span', { className: 'intentsmith-s2-chip' }, `Projekt ${session._projectId}`)
          : session.chat.specialist ? h('span', { className: 'intentsmith-s2-chip' }, session.chat.specialist.name) : null,
        h('span', { className: 'intentsmith-s2-context' },
          h('span', { className: 'intentsmith-s2-context-meter' },
            h('i', { style: { width: `${Math.max(0, Math.min(100, session.chat.ctx || 0))}%` } })),
          ` ${Math.round(session.chat.ctx || 0)} %`),
        h('button', { type: 'button', 'aria-label': 'Zavřít sloupec', disabled: state.columns.length === 1, onClick: event => { event.stopPropagation(); store.closeColumn(index); } }, '×')),
      h('div', { className: 'intentsmith-s2-messages' },
        session.chat.msgs.length ? session.chat.msgs.map((item, index) => message(session, item, index)) : h('p', null, 'Napište zprávu a začněte konverzaci.'),
        session.chat._thinking ? h('p', { className: 'intentsmith-s2-thinking' }, session.chat._thinking.text) : null,
        session.chat._delivery?.status === 'NOT_SENT' ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, session.chat._delivery.text) : null,
        session.chat._delivery?.status === 'DELIVERY_UNKNOWN' ? h('div', { role: 'alert', className: 'intentsmith-s2-error' },
          h('p', null, session.chat._delivery.text),
          h('button', { type: 'button', onClick: () => widget.transport.acknowledgeUnknown(session) }, 'Pokračovat bez opakování')) : null,
        renderM2ApprovalCard(widget, session, h)),
      h('div', { className: 'intentsmith-s2-composer' },
        session.chat._attachmentError ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, session.chat._attachmentError) : null,
        session.chat.attachments.length ? h('div', { className: 'intentsmith-s2-attachments' },
          session.chat.attachments.map((item, attachmentIndex) => h('span', { key: attachmentIndex },
            `${item.name} · ${Math.ceil(item.size / 1024)} KiB`,
            h('button', { type: 'button', 'aria-label': `Odebrat ${item.name}`, onClick: () => {
              session.chat.attachments.splice(attachmentIndex, 1); store.changed();
            } }, '×')))) : null,
        h('textarea', { 'aria-label': `Zpráva v relaci ${session.number}`, placeholder: 'Napište zprávu…', onKeyDown: event => {
          if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); widget.send(session, event.currentTarget); }
        } }),
        h('div', { className: 'intentsmith-s2-composer-controls' },
          h('button', { type: 'button', disabled: session.chat._preparing || session.chat._picking, onClick: () => widget.pickAttachments(session) },
            icon(h, 'clip', 14), 'Připojit soubor'),
          ['auto', 'ask'].map(mode => h('button', { key: mode, type: 'button', className: session.chat.editMode === mode ? 'active' : '',
            onClick: () => { session.chat.editMode = mode; store.changed(); } }, mode === 'auto' ? 'Auto' : 'Kontrola')),
          h('button', { type: 'button', className: 'intentsmith-s2-send', disabled: session.chat._preparing || session.chat._picking,
            'aria-label': 'Odeslat zprávu', title: 'Odeslat · Ctrl+Enter',
            onClick: event => widget.send(session, event.currentTarget.closest('.intentsmith-s2-composer').querySelector('textarea')) },
            session.chat._preparing ? 'Připravuji…' : icon(h, 'send', 15)))),
      widget.bottomVisible ? bottom(session) : null);
  }
  function right(session) {
    const tabs = ['Změny', 'Kontext', 'Soubory', 'Správa zdrojů'];
    const side = widget.sideMode || 'Soubory';
    const content = side === 'Kontext' ? h('p', null, `Kontext relace: ${Math.round(session.chat.ctx || 0)} %`)
      : side === 'Změny' ? renderM2Changes(widget, session, h)
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
        h('button', { type: 'button', onClick: () => { widget.section = 'Relace'; store.focusTab(session.id); } },
          h('span', { className: 'intentsmith-s2-tab-number' }, session.number),
          icon(h, session._projectId ? 'folder' : session.chat.specialist ? 'users' : 'chat', 12),
          h('span', { className: 'intentsmith-s2-tab-name' }, session._label),
          h('span', { className: `intentsmith-s2-state-dot${session.chat._thinking ? ' running' : session._m2Pending ? ' waiting' : ''}` })),
        h('button', { type: 'button', 'aria-label': `Zavřít relaci ${session.number}`, onClick: () => widget.closeSession(session) }, '×'))),
      h('button', { type: 'button', 'aria-label': 'Nová relace', onClick: () => widget.addSession() }, '+')),
    columns: h('div', { className: 'intentsmith-s2-columns' }, state.columns.map(column)),
    right: focused ? right(focused) : null,
    connection,
  };
}

module.exports = { renderSessionView };
