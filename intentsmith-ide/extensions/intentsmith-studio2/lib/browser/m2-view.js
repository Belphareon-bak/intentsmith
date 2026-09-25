'use strict';

const { lineCounts } = require('@intentsmith/chat-panel/lib/browser/work-activity');
const { pendingBinding } = require('./m2-controller');

function renderM2Changes(widget, session, h) {
  const controller = widget.m2;
  const state = controller.entry(session);
  const pending = pendingBinding(session._m2Pending);
  const view = state.view;
  if (view?.state === 'awaiting_approval') state.presentedView = view;
  const plan = view?.plan;
  const exact = pending && view?.state === 'awaiting_approval'
    && view.lifecycleId === pending.lifecycleId && view.planDigest === pending.planDigest;
  const run = (command, argument = '') => controller.run(session, command, argument, view).catch(error => controller.report(session, error));
  const details = (Array.isArray(view?.diff) ? view.diff.filter(file => file && typeof file.path === 'string') : []).map(file => {
    const count = typeof file.before?.content === 'string' && typeof file.after?.content === 'string'
      ? lineCounts(file.before.content, file.after.content) : null;
    return h('details', { key: file.path, className: 'intentsmith-s2-m2-file', open: true },
      h('summary', null, file.path, count ? ` · +${count.added} / −${count.removed}` : ''),
      h('p', null, view.state === 'awaiting_approval' ? 'Navrženo, dosud nezapsáno' :
        view.state === 'succeeded' ? 'Zapsáno a ověřeno' : 'Návrh nebyl úspěšně proveden'),
      h('h4', null, 'Před změnou'), h('pre', null, file.before?.content === null ? '(nový soubor)' : file.before?.content || ''),
      h('h4', null, 'Navržený úplný obsah'), h('pre', null, file.after?.content || ''));
  }) || [];
  return h('div', { className: 'intentsmith-s2-m2', 'aria-label': 'Změny M2' },
    h('p', null, 'M2 návrh připravíte příkazem /m2-draft soubor :: zadání. Samotná příprava soubory nezapisuje.'),
    state.error ? h('p', { role: 'alert', className: 'intentsmith-s2-error' }, state.error) : null,
    pending ? h('button', { type: 'button', disabled: state.busy,
      onClick: () => run('/m2-status') }, 'Načíst trvalý stav a plán') : null,
    !view ? h('p', null, pending ? 'Uložený plán čeká na načtení a kontrolu.' : 'Žádné změny M2 v této relaci.') :
      h('section', null,
        h('h3', null, view.state === 'awaiting_approval' ? 'Připravený návrh' : 'Trvalý stav M2'),
        h('p', null, `Stav: ${view.state} · Lifecycle: ${view.lifecycleId}`),
        h('p', { className: 'intentsmith-s2-m2-digest' }, `Digest plánu: ${view.planDigest}`),
        plan ? h('div', null,
          h('p', null, `Test: ${plan.focusedTest?.binary || '—'} ${JSON.stringify(plan.focusedTest?.argv || [])}`),
          h('p', null, `Časový limit: ${plan.focusedTest?.timeoutMs || '—'} ms`),
          h('p', null, `Git: ${plan.gitCommit ? 'součást schvalovaného plánu' : 'bez commitu'}`),
          h('p', null, `Governance: ${view.audit?.governanceDecision?.verdict || '—'}`)) : null,
        details,
        view.terminal ? h('div', { className: 'intentsmith-s2-m2-terminal' },
          h('h4', null, 'Kanonický výsledek'),
          h('p', null, `Stav: ${view.terminal.state} · Test: ${view.result?.focusedTest?.terminalStatus || '—'} · Git: ${view.result?.git?.status || '—'}`),
          h('p', null, `Audit receipt: ${view.audit?.governanceReceipt?.receiptId || '—'}`),
          h('p', null, `Výsledek digest: ${view.terminal.resultDigest || '—'}`)) : null),
    exact ? h('div', { className: 'intentsmith-s2-m2-actions' },
      h('p', null, 'Schválení provede přesně zobrazený plán a jeho test.'),
      h('button', { type: 'button', disabled: state.busy, onClick: () => run('/m2-approve') }, 'Schválit zobrazené změny'),
      h('button', { type: 'button', disabled: state.busy && state.operation?.command !== '/m2-approve',
        onClick: () => run('/m2-cancel') }, 'Zrušit plán')) : null,
    pending && !exact ? h('button', { type: 'button', disabled: state.busy && state.operation?.command !== '/m2-approve',
      onClick: () => run('/m2-cancel') }, 'Zrušit uložený plán') : null);
}
module.exports = { renderM2Changes };
