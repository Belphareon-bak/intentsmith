import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const base = '../../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/';
export const { LiveModel } = require(base + 'view/live-model');
export const { SessionStore } = require(base + 'session-store');
export const { M2Controller, origin, sameOrigin, validateView, pendingBinding, parseDraft } = require(base + 'm2-controller');
export const { createForm, composerDraft, normalizeProposal, validateBlueprint } = require(base + 'm2-composer');
const { AppearanceStore } = require(base + 'appearance-store');
export const digest = 'sha256:' + 'a'.repeat(64);
export function plan(captured) {
  return { lifecycleId: 'fixture-plan', state: 'awaiting_approval', planDigest: digest,
    plan: { identity: { lifecycleId: 'fixture-plan' }, state: 'awaiting_approval', origin: captured,
      changes: [{ path: 'src/a.js' }], focusedTest: { binary: '/usr/bin/node', argv: ['--check', 'src/a.js'], timeoutMs: 30000 }, gitCommit: null },
    audit: { governanceDecision: { verdict: 'allow' }, executionEvents: [] },
    diff: [{ path: 'src/a.js', before: { content: 'before\n' }, after: { content: 'after\n' } }] };
}
export function terminal(view, state = 'cancelled') {
  return { ...view, state, terminal: { state, identity: view.plan.identity, planDigest: view.planDigest },
    ...(state === 'succeeded' ? { result: { terminalStatus: state, changes: { paths: view.diff.map(file => file.path) }, focusedTest: {}, git: {} },
      audit: { ...view.audit, governanceReceipt: { receiptId: 'fixture-receipt' } } } : {}) };
}
export function fixture() {
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const store = new SessionStore(storage), session = store.focusedSession();
  session._convId = 'fixture-conversation'; session._projectId = '27';
  const captured = origin(session), view = plan(captured), calls = [], timers = [];
  const control = { response: view, status: 200, active: false, handler: null, confirmations: [] };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (control.handler) return control.handler(url, options);
    return { ok: control.status >= 200 && control.status < 300, status: control.status, json: async () => control.response };
  };
  const m2 = new M2Controller(store, { backendUrl: () => 'http://fixture.invalid', fetchImpl,
    activeTurn: () => control.active, schedule: fn => { timers.push(fn); return fn; }, unschedule: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); } });
  const widget = { store, m2, appearance: new AppearanceStore(storage), fetchImpl,
    workspace: { entry: () => ({ tree: [], editor: null }), loadTree: async () => false },
    catalog: { view: () => ({ status: 'ready', items: [] }), subscribe: () => () => {}, load: async () => {}, backendUrl: () => 'http://fixture.invalid', get: async () => ({}) },
    transport: { hasActiveM1Turn: () => control.active },
    confirmAction: text => { control.confirmations.push(text); return true; },
    send: async (owner, input) => { calls.push({ send: input.value, owner }); input.value = ''; } };
  const model = new LiveModel(widget);
  model.forceUpdate = () => {};
  model.setState = patch => { model.state = { ...model.state, ...patch }; };
  return { store, session, captured, view, calls, control, m2, model, widget, storage, saved, timers };
}
export const tick = () => new Promise(resolve => setImmediate(resolve));
