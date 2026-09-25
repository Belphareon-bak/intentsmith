'use strict';

const { lineCounts } = require('@intentsmith/chat-panel/lib/browser/work-activity');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned', 'blocked']);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function sameOrigin(a, b) {
  return !!a && !!b && a.surface === b.surface && a.sessionId === b.sessionId
    && a.conversationId === b.conversationId && a.projectId === b.projectId;
}
function origin(session) {
  const projectId = Number(session?._projectId);
  const conversationId = session?._convId == null ? '' : String(session._convId).trim();
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !conversationId) {
    throw new Error('M2 vyžaduje aktivní projekt a uloženou konverzaci.');
  }
  return { surface: 'studio', sessionId: conversationId, conversationId, projectId };
}
function pendingBinding(value) {
  if (!record(value) || !value.lifecycleId || typeof value.lifecycleId !== 'string'
    || !DIGEST.test(value.planDigest) || !record(value.origin)
    || value.origin.surface !== 'studio' || typeof value.origin.sessionId !== 'string'
    || !value.origin.sessionId || value.origin.sessionId !== value.origin.conversationId
    || !Number.isSafeInteger(value.origin.projectId) || value.origin.projectId < 1) return null;
  return { lifecycleId: value.lifecycleId, planDigest: value.planDigest,
    origin: { surface: 'studio', sessionId: value.origin.sessionId,
      conversationId: value.origin.conversationId, projectId: value.origin.projectId } };
}
function validateView(view, lifecycleId, expectedOrigin, expectedDigest = null) {
  if (!record(view) || view.lifecycleId !== lifecycleId || !DIGEST.test(view.planDigest)
    || (expectedDigest && view.planDigest !== expectedDigest)
    || !record(view.plan) || !record(view.plan.identity)
    || view.plan.identity.lifecycleId !== lifecycleId || !sameOrigin(view.plan.origin, expectedOrigin)) {
    throw new Error('Server vrátil neúplný nebo cizí M2 status.');
  }
  if (view.state === 'awaiting_approval') {
    const changes = view.plan.changes;
    const diff = view.diff;
    const focused = view.plan.focusedTest;
    const decision = view.audit?.governanceDecision;
    if (view.plan.state !== 'awaiting_approval' || !Array.isArray(changes) || !changes.length
      || !Array.isArray(diff) || diff.length !== changes.length
      || changes.some(change => {
        const matches = diff.filter(file => file?.path === change.path);
        return matches.length !== 1 || !record(matches[0].before) || !record(matches[0].after)
          || (matches[0].before.content !== null && typeof matches[0].before.content !== 'string')
          || typeof matches[0].after.content !== 'string';
      })
      || !record(focused) || !Array.isArray(focused.argv) || !Number.isSafeInteger(focused.timeoutMs)
      || !record(decision) || decision.verdict !== 'allow') {
      throw new Error('Server nevrátil úplný schvalovatelný M2 plán.');
    }
  }
  if (TERMINAL.has(view.state)) {
    if (!record(view.terminal) || view.terminal.state !== view.state
      || view.terminal.identity?.lifecycleId !== lifecycleId
      || view.terminal.planDigest !== view.planDigest) {
      throw new Error('Server nevrátil kanonický M2 terminál.');
    }
    if (view.state === 'succeeded' && (!record(view.result)
      || view.result.terminalStatus !== 'succeeded'
      || !record(view.result.changes) || !record(view.result.focusedTest)
      || !record(view.result.git) || !record(view.audit)
      || !record(view.audit.governanceReceipt))) {
      throw new Error('Úspěch nemá úplné důkazy o změnách, testu, gitu a auditu.');
    }
  }
  return view;
}
function parseDraft(text) {
  const separator = text.indexOf(' :: ');
  if (separator < 1) throw new Error('Použití: /m2-draft src/app.js[, src/b.js] :: zadání');
  const paths = text.slice(0, separator).split(',').map(path => path.trim());
  const instruction = text.slice(separator + 4).trim();
  if (!instruction || paths.length > 3 || paths.some((path, index) => !path || paths.indexOf(path) !== index)) {
    throw new Error('Zadejte jeden až tři různé soubory a neprázdné zadání.');
  }
  return paths.length === 1 ? { path: paths[0], instruction } : { paths, instruction };
}
function parseObject(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${label} není platný JSON.`); }
  if (!record(value)) throw new Error(`${label} musí být JSON objekt.`);
  return value;
}

class M2Controller {
  constructor(store, { backendUrl, fetchImpl = fetch, onChange = () => {}, activeTurn = () => false } = {}) {
    this.store = store;
    this.backendUrl = backendUrl || (() => window.electronIntentSmith.getBackendUrl());
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.activeTurn = activeTurn;
    this.entries = new Map();
  }
  entry(session) {
    if (!this.entries.has(session.id)) this.entries.set(session.id, { view: null, presentedView: null, busy: false, error: null, operation: null });
    return this.entries.get(session.id);
  }
  changed() { this.store.changed(); this.onChange(); }
  report(session, error) {
    if (error.m2Reported) return;
    error.m2Reported = true;
    const entry = this.entry(session);
    entry.error = `M2 [${error.code || 'REQUEST_FAILED'}${error.status ? ' HTTP ' + error.status : ''}]: ${error.message}. Stav ověřte příkazem /m2-status; požadavek se automaticky neopakuje.`;
    if (!session._closed && this.store.find(session.id) === session) {
      session.chat.msgs.push({ role: 'system', tag: 'M2_ERROR', text: entry.error });
      this.changed();
    }
  }
  owns(session, capturedOrigin) {
    if (session._closed || this.store.find(session.id) !== session || !sameOrigin(origin(session), capturedOrigin)) {
      throw new Error('Kontext projektu nebo konverzace se změnil. Načtěte trvalý stav.');
    }
  }
  async request(path, options, timeoutMs) {
    const base = this.backendUrl();
    if (typeof base !== 'string' || !/^https?:\/\//.test(base)) throw new Error('Backend není dostupný.');
    const response = await this.fetchImpl(base + path, { credentials: 'same-origin', signal: AbortSignal.timeout(timeoutMs), ...options });
    let body = {};
    try { body = await response.json(); } catch { /* HTTP status remains authoritative. */ }
    if (!response.ok) {
      const error = new Error(typeof body.error === 'string' ? body.error : `M2 HTTP ${response.status}`);
      error.code = typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
      error.status = response.status;
      throw error;
    }
    return body;
  }
  accept(session, view, capturedOrigin, expectedId, expectedDigest) {
    this.owns(session, capturedOrigin);
    validateView(view, expectedId, capturedOrigin, expectedDigest);
    const entry = this.entry(session);
    if (entry.view && entry.view.lifecycleId === view.lifecycleId && TERMINAL.has(entry.view.state)) {
      if (!TERMINAL.has(view.state) || entry.view.state !== view.state) {
        throw new Error('M2 vrátil konfliktní výsledek. Obnovte trvalý stav.');
      }
    }
    entry.view = view;
    entry.presentedView = null;
    if (view.state === 'awaiting_approval') {
      session._m2Pending = pendingBinding({ lifecycleId: view.lifecycleId,
        planDigest: view.planDigest, origin: capturedOrigin });
      if (!session._m2Pending) throw new Error('Neplatná vazba M2 plánu.');
    } else if (TERMINAL.has(view.state)) {
      if (session._m2Pending?.lifecycleId === view.lifecycleId
        && session._m2Pending.planDigest === view.planDigest) session._m2Pending = null;
      if (view.state === 'succeeded') this.recordVerifiedFiles(session, view);
    }
    entry.error = null;
    this.changed();
    return view;
  }
  recordVerifiedFiles(session, view) {
    const paths = view.result.changes.paths;
    if (!Array.isArray(paths)) return;
    for (const path of paths) {
      const file = view.diff?.find(item => item?.path === path);
      if (!file || typeof file.after?.content !== 'string') continue;
      session._fileChanges[path] = lineCounts(file.before?.content || '', file.after.content);
      session._modifiedFiles = [path, ...session._modifiedFiles.filter(item => item !== path)].slice(0, 30);
    }
  }
  async run(session, command, argument = '', displayedView = null) {
    const entry = this.entry(session);
    const isCancel = command === '/m2-cancel';
    if (entry.busy && !(isCancel && entry.operation?.command === '/m2-approve' && !entry.operation.cancelIssued)) {
      throw new Error('M2 požadavek už běží. Vyčkejte na trvalý výsledek.');
    }
    const bound = pendingBinding(session._m2Pending);
    const capturedOrigin = origin(session);
    if (bound && !sameOrigin(bound.origin, capturedOrigin)) throw new Error('Uložený plán patří jiné konverzaci nebo projektu.');
    if (this.activeTurn(session) && !isCancel) throw new Error('Nejdřív dokončete běžící chatový tah.');
    let path, options = {};
    let expectedId = bound?.lifecycleId || null;
    let expectedDigest = bound?.planDigest || null;
    if (command === '/m2-draft' || command === '/m2-build' || command === '/m2-plan') {
      if (bound) throw new Error('Nejdřív schvalte nebo zrušte uložený plán.');
      if (session.chat.attachments.length) throw new Error('M2 plán nepřijímá přílohy.');
      const payload = command === '/m2-draft' ? { draft: parseDraft(argument) }
        : command === '/m2-build' ? { draft: parseObject(argument, 'Souborový plán') }
          : { proposal: parseObject(argument, 'Návrh') };
      path = command === '/m2-plan' ? '/api/m2/lifecycle/prepare' : '/api/m2/lifecycle/draft';
      options = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: capturedOrigin.projectId, origin: capturedOrigin, ...payload }) };
    } else if (command === '/m2-status') {
      expectedId = argument.trim() || expectedId;
      if (!expectedId || /\s/.test(expectedId)) throw new Error('Použití: /m2-status [lifecycleId]');
      if (bound && expectedId !== bound.lifecycleId) throw new Error('Nejdřív dokončete uložený plán této relace.');
      const query = new URLSearchParams({ id: expectedId, surface: capturedOrigin.surface,
        sessionId: capturedOrigin.sessionId, conversationId: capturedOrigin.conversationId,
        projectId: String(capturedOrigin.projectId) });
      path = '/api/m2/lifecycle/status?' + query;
      options = { method: 'GET' };
      if (expectedId !== bound?.lifecycleId) expectedDigest = null;
    } else if (command === '/m2-approve') {
      if (argument.trim()) throw new Error('Použití: /m2-approve');
      if (!bound) throw new Error('Není uložen žádný přesný M2 plán.');
      const visible = entry.view;
      if (entry.presentedView !== visible) throw new Error('Otevřete panel Změny a zkontrolujte přesný plán.');
      if (displayedView && displayedView !== visible) throw new Error('Zobrazený plán se změnil. Zkontrolujte ho znovu.');
      if (!visible || visible.state !== 'awaiting_approval'
        || visible.lifecycleId !== bound.lifecycleId || visible.planDigest !== bound.planDigest
        || !sameOrigin(visible.plan?.origin, bound.origin)) {
        throw new Error('Nejdřív načtěte a zkontrolujte přesný M2 plán.');
      }
      validateView(visible, bound.lifecycleId, bound.origin, bound.planDigest);
      path = '/api/m2/lifecycle/approve';
      options = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifecycleId: bound.lifecycleId, planDigest: bound.planDigest, origin: bound.origin }) };
    } else if (isCancel) {
      if (!bound) throw new Error('Není uložen žádný M2 plán ke zrušení.');
      path = '/api/m2/lifecycle/cancel';
      options = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lifecycleId: bound.lifecycleId, reason: argument.trim() || 'user_cancelled', origin: bound.origin }) };
      if (entry.busy) entry.operation.cancelIssued = true;
    } else throw new Error('Neznámý příkaz M2.');

    const operation = entry.busy ? entry.operation : { command, cancelIssued: false };
    if (!entry.busy) { entry.busy = true; entry.operation = operation; }
    entry.error = null;
    this.changed();
    try {
      const view = await this.request(path, options, command === '/m2-approve' ? 3600000
        : command === '/m2-status' ? 120000 : command === '/m2-cancel' ? 600000 : 990000);
      const id = expectedId || view.lifecycleId;
      const accepted = this.accept(session, view, capturedOrigin, id, expectedDigest);
      session.chat.msgs.push({ role: 'system', tag: 'M2', text: TERMINAL.has(accepted.state)
        ? `M2 ${accepted.state}: trvalý výsledek ${accepted.lifecycleId} byl ověřen. Podrobnosti jsou v panelu Změny.`
        : `M2 ${accepted.state}: plán ${accepted.lifecycleId}. Zkontrolujte přesný diff v panelu Změny.` });
      this.changed();
      return accepted;
    } catch (error) {
      this.report(session, error);
      throw error;
    } finally {
      if (entry.operation === operation && !isCancel) { entry.busy = false; entry.operation = null; }
      else if (entry.operation === operation && isCancel && operation.command !== '/m2-approve') {
        entry.busy = false; entry.operation = null;
      }
      this.changed();
    }
  }
  handleText(session, text) {
    const match = /^(\/m2-(?:draft|build|plan|status|approve|cancel))(?:\s+([\s\S]*))?$/.exec(text);
    const pending = pendingBinding(session._m2Pending);
    if (!match && pending && /^(?:ano|ok|spusť(?: to)?|spust(?: to)?|yes|approve)$/i.test(text.trim())) {
      session.chat.msgs.push({ role: 'system', tag: 'M2_ERROR',
        text: 'M2 approval nebyl proveden. Použijte pouze /m2-approve po kontrole plánu.' });
      this.changed();
      return true;
    }
    if (!match) return false;
    session.chat.msgs.push({ role: 'user', tag: 'M2', text });
    this.changed();
    this.run(session, match[1], match[2] || '').catch(error => this.report(session, error));
    return true;
  }
}

module.exports = { M2Controller, pendingBinding, validateView, origin, sameOrigin, parseDraft };
