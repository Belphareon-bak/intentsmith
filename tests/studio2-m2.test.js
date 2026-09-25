import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store.js');
const { M2Controller, validateView } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-controller.js');
const { renderM2Changes, renderM2ApprovalCard } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-view.js');

const memory = new Map();
const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
const store = new SessionStore(storage);
const session = store.state.sessions[0];
session._projectId = 27;
session._convId = 'conversation-27';
store.changed();
const origin = { surface: 'studio', sessionId: 'conversation-27', conversationId: 'conversation-27', projectId: 27 };
const digest = 'sha256:' + 'a'.repeat(64);
const base = {
  lifecycleId: 'lifecycle-27', state: 'awaiting_approval', planDigest: digest,
  plan: { identity: { lifecycleId: 'lifecycle-27' }, state: 'awaiting_approval', origin,
    changes: [{ path: 'src/app.js', afterDigest: 'sha256:after', afterBytes: 24 }],
    focusedTest: { binary: '/usr/bin/node', argv: ['--check', 'src/app.js'], timeoutMs: 30000 }, gitCommit: null },
  audit: { governanceDecision: { verdict: 'allow' } },
  diff: [{ path: 'src/app.js', before: { content: 'export const n = 1;\n', digest: 'sha256:before' },
    after: { content: 'export const n = 2;\n', digest: 'sha256:after' } }],
};
const complete = {
  ...base, state: 'succeeded',
  terminal: { state: 'succeeded', identity: { lifecycleId: base.lifecycleId }, planDigest: digest, resultDigest: 'sha256:result' },
  result: { terminalStatus: 'succeeded', changes: { paths: ['src/app.js'] },
    focusedTest: { terminalStatus: 'succeeded' }, git: { status: 'not_requested' } },
  audit: { ...base.audit, governanceReceipt: { receiptId: 'receipt-27' } },
};
const requests = [];
let nextResponse = base;
const fakeFetch = async (url, options) => {
  requests.push({ url, options });
  return { ok: true, status: 200, json: async () => nextResponse };
};
const controller = new M2Controller(store, { backendUrl: () => 'http://fixture.invalid', fetchImpl: fakeFetch });
assert.equal(controller.handleText(session, '/m2-draft src/app.js :: Change value'), true);
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.length, 1);
assert.match(requests[0].url, /\/api\/m2\/lifecycle\/draft$/);
assert.deepEqual(JSON.parse(requests[0].options.body).draft, { path: 'src/app.js', instruction: 'Change value' });
assert.equal(session._m2Pending.planDigest, digest);
assert.equal(controller.entry(session).view.state, 'awaiting_approval');
assert.equal(requests.some(request => request.url.endsWith('/approve')), false);
assert.equal(controller.handleText(session, 'ano'), true);
assert.match(session.chat.msgs.at(-1).text, /approval nebyl proveden/);
await assert.rejects(controller.run(session, '/m2-approve'), /Otevřete panel Změny/);
assert.equal(requests.length, 1);
controller.entry(session).presentedView = controller.entry(session).view;
const stale = controller.entry(session).view;
controller.entry(session).view = { ...stale };
controller.entry(session).presentedView = controller.entry(session).view;
await assert.rejects(controller.run(session, '/m2-approve', '', stale), /Zobrazený plán se změnil/);
assert.equal(requests.length, 1);
controller.entry(session).view = stale;
const rebootStore = new SessionStore(storage);
const rebootSession = rebootStore.state.sessions[0];
assert.equal(rebootSession._m2Pending.planDigest, digest);
const reboot = new M2Controller(rebootStore, { backendUrl: () => 'http://fixture.invalid', fetchImpl: fakeFetch });
await assert.rejects(reboot.run(rebootSession, '/m2-approve'), /Nejdřív načtěte/);
assert.equal(requests.length, 1);
await reboot.run(rebootSession, '/m2-status');
assert.equal(reboot.entry(rebootSession).view.state, 'awaiting_approval');
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
const descendants = node => !node || typeof node !== 'object' ? []
  : [node, ...node.children.flatMap(descendants)];
const widget = { m2: reboot, sideMode: 'Soubory', update: () => {} };
let card = renderM2ApprovalCard(widget, rebootSession, h);
let button = label => descendants(card).find(node => node.type === 'button' && node.children.join('') === label);
assert.equal(button('Schválit').props.disabled, true);
assert.match(descendants(card).flatMap(node => node.children.filter(child => typeof child === 'string')).join(' '), /\+1 \/ −1/);
button('Zobrazit změny').props.onClick();
assert.equal(widget.sideMode, 'Změny');
renderM2Changes(widget, rebootSession, h);
card = renderM2ApprovalCard(widget, rebootSession, h);
assert.equal(button('Schválit').props.disabled, false);
nextResponse = { ...complete, planDigest: 'sha256:' + 'b'.repeat(64) };
await assert.rejects(reboot.run(rebootSession, '/m2-approve'), /cizí M2 status/);
assert.equal(rebootSession._m2Pending.planDigest, digest);
assert.equal(rebootSession._modifiedFiles.length, 0);
assert.equal(requests.filter(request => request.url.endsWith('/approve')).length, 1);
nextResponse = complete;
await reboot.run(rebootSession, '/m2-approve');
const approval = requests.filter(request => request.url.endsWith('/approve')).at(-1);
assert.deepEqual(JSON.parse(approval.options.body), {
  lifecycleId: base.lifecycleId, planDigest: digest, origin,
});
assert.equal(rebootSession._m2Pending, null);
await reboot.run(rebootSession, '/m2-status', base.lifecycleId);
assert.deepEqual(rebootSession._modifiedFiles, ['src/app.js']);
assert.equal(rebootSession._fileChanges['src/app.js'].added, 1);
assert.equal(rebootSession._fileChanges['src/app.js'].removed, 1);
assert.equal(reboot.entry(rebootSession).view.terminal.state, 'succeeded');
assert.equal(requests.filter(request => request.url.endsWith('/approve')).length, 2);
assert.throws(() => validateView({ ...complete, result: { ...complete.result, terminalStatus: 'failed' } },
  complete.lifecycleId, origin, digest), /Úspěch nemá úplné důkazy/);
const other = rebootStore.addSession({ convId: 'other-conversation', projectId: 27 });
other._m2Pending = { lifecycleId: base.lifecycleId, planDigest: digest, origin };
await assert.rejects(reboot.run(other, '/m2-approve'), /jiné konverzaci/);
assert.equal(requests.filter(request => request.url.endsWith('/approve')).length, 2);
console.log('PASS M2 exact review, restart recovery, wrong digest, canonical terminal and session isolation');
