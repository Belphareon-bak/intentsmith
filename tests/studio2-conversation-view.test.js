import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Konverzace ve Studiu 2 mají vypadat jako v prototypu: bez úvodní hlášky klasického
// chatu, se sbalenými interními kroky, kartou schválení M2 a čitelnými hlášeními.
const require = createRequire(import.meta.url);
const { LiveModel } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/view/live-model');
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store');
const { AppearanceStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/appearance-store');

const DIGEST = 'sha256:' + 'a'.repeat(64);

function setup(m2Entry = { view: null, presentedView: null, error: null, busy: false }) {
  const memory = new Map();
  const storage = { getItem: key => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, value) };
  const store = new SessionStore(storage);
  const widget = {
    store, appearance: new AppearanceStore(storage),
    catalog: { view: () => ({ status: 'idle', items: [] }), load: () => {}, subscribe: () => () => {}, backendUrl: () => '' },
    workspace: { entry: () => ({ tree: [], editor: null }), loadTree: async () => false },
    m2: { entry: () => m2Entry, run: async () => {}, report: () => {} },
    send: async () => {}, sendTerminal: async () => {}, completeTerminal: async () => {},
    pickAttachments: async () => {}, closeSession: session => store.closeSession(session.id),
  };
  return { model: new LiveModel(widget), store };
}

const column = model => model.renderVals().columns[0];

test('a new session shows the prototype empty state instead of the classic greeting', () => {
  const { model, store } = setup();
  store.focusedSession().chat.msgs = [{ role: 'system', text: 'IntentSmith připraven. Začni psát zprávu.' }];
  const col = column(model);
  assert.equal(col.isFresh, true);
  assert.equal(col.msgs.length, 0);
});

test('agent turn folds internal processing and keeps real work visible', () => {
  const { model, store } = setup();
  const session = store.focusedSession();
  const t0 = Date.parse('2026-09-26T10:00:00Z');
  session.chat.msgs = [
    { role: 'user', text: 'Uprav README a spusť testy', ts: '2026-09-26T10:00:00Z', _activity: { steps: [
      { kind: 'step', label: 'Volí postup', status: 'observed', startedAt: t0 },
      { kind: 'step', label: 'Volí postup', status: 'observed', startedAt: t0 + 10 },
      { kind: 'model', label: 'Generuje odpověď', input: 'Model / role: answer', status: 'done', startedAt: t0 + 20, endedAt: t0 + 8020, durationMs: 8000 },
      { kind: 'tool', label: 'run_tests', tool: 'run_tests', status: 'done', startedAt: t0 + 8100, endedAt: t0 + 9300, durationMs: 1200 },
    ] } },
    { role: 'assistant', text: 'Hotovo.', tag: 'conversation', ts: '2026-09-26T10:00:10Z' },
  ];
  const col = column(model);
  const answer = col.msgs.find(msg => msg.isAgent);
  assert.equal(answer.badge, 'CONVERSATION');
  assert.match(answer.time, /· 9,3 s$/);
  assert.deepEqual(answer.steps.map(step => step.t), ['run_tests'], 'only real work stays visible');
  assert.equal(answer.hasFold, true);
  assert.match(answer.foldText, /Zpracování · 2 fáze/, 'duplicate internal step is merged');
  assert.equal(col.model === 'answer', false, 'a role is not shown as a model');
  assert.equal(col.title.startsWith('Uprav README'), true, 'default label becomes the first request');
  assert.equal(col.ctxLabel, '—', 'unmeasured context is not shown as 0 %');
  answer.toggleFold();
  const open = column(model).msgs.find(msg => msg.isAgent);
  assert.equal(open.steps.length, 3);
  assert.equal(open.steps.every(step => step.cls === ''), true, 'completed phases use the green work style');
});

test('pending M2 plan becomes an approval card that requires the plan to be seen first', () => {
  const view = { state: 'awaiting_approval', lifecycleId: 'lc-1', planDigest: DIGEST, plan: { identity: { lifecycleId: 'lc-1' }, state: 'awaiting_approval', origin: { surface: 'studio', sessionId: 'c-1', conversationId: 'c-1', projectId: 1 },
      changes: [{ path: 'src/a.js' }], focusedTest: { binary: '/usr/bin/node', argv: ['test.js'], timeoutMs: 30000 }, gitCommit: null }, audit: { governanceDecision: { verdict: 'allow' } },
    diff: [{ path: 'src/a.js', before: { content: 'a\n' }, after: { content: 'a\nb\n' } }] };
  const entry = { view, presentedView: null, error: null, busy: false };
  const { model, store } = setup(entry);
  const session = store.focusedSession();
  session._convId = 'c-1'; session._projectId = '1';
  session._m2Pending = { lifecycleId: 'lc-1', planDigest: DIGEST,
    origin: { surface: 'studio', sessionId: 'c-1', conversationId: 'c-1', projectId: 1 } };
  session.chat.msgs = [
    { role: 'user', tag: 'M2', text: '/m2-draft src/a.js :: přidej b' },
    { role: 'system', tag: 'M2', text: 'M2 awaiting_approval: plán lc-1. Zkontrolujte přesný diff v panelu Změny.' },
  ];
  let card = column(model).msgs.find(msg => msg.hasApproval);
  assert.ok(card, 'approval card is rendered');
  assert.match(card.apprSub, /^1 soubor · \+\d+ −\d+ · režim Kontrola$/);
  assert.equal(card.approveCls, 'soft');
  assert.match(card.apprHint, /zkontroluj změny/);
  entry.presentedView = view;
  card = column(model).msgs.find(msg => msg.hasApproval);
  assert.equal(card.approveCls, '');
  assert.equal(card.hasApprHint, false);
});

test('M2 results and errors are readable notes, not raw lifecycle text', () => {
  const { model, store } = setup();
  store.focusedSession().chat.msgs = [
    { role: 'system', tag: 'M2', text: 'M2 succeeded: trvalý výsledek lc-2 byl ověřen. Podrobnosti jsou v panelu Změny.' },
    { role: 'system', tag: 'M2_ERROR', text: 'Uložený plán patří jiné konverzaci.' },
  ];
  const notes = column(model).msgs.filter(msg => msg.isNote);
  assert.deepEqual(notes.map(note => note.noteCls), ['n-ok', 'n-err']);
  assert.equal(notes[0].text, 'Změny jsou schválené a zapsané do projektu.');
  assert.equal(notes.some(note => /lc-2|lifecycle/.test(note.text)), false);
});

test('a pending plan restored without its chat message still shows the approval card', () => {
  const view = { state: 'awaiting_approval', lifecycleId: 'lc-3', planDigest: DIGEST, plan: { identity: { lifecycleId: 'lc-1' }, state: 'awaiting_approval', origin: { surface: 'studio', sessionId: 'c-1', conversationId: 'c-1', projectId: 1 },
      changes: [{ path: 'src/a.js' }], focusedTest: { binary: '/usr/bin/node', argv: ['test.js'], timeoutMs: 30000 }, gitCommit: null }, audit: { governanceDecision: { verdict: 'allow' } },
    diff: [{ path: 'src/b.js', before: { content: '' }, after: { content: 'x\n' } }] };
  const { model, store } = setup({ view, presentedView: null, error: null, busy: false });
  const session = store.focusedSession();
  session._m2Pending = { lifecycleId: 'lc-3', planDigest: DIGEST,
    origin: { surface: 'studio', sessionId: 'c-3', conversationId: 'c-3', projectId: 2 } };
  session.chat.msgs = [{ role: 'user', text: 'Předchozí zadání' }];
  const msgs = column(model).msgs;
  assert.equal(msgs[msgs.length - 1].hasApproval, true);
});
