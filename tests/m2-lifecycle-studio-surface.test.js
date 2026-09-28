import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture, tick, terminal, digest, SessionStore, createForm, composerDraft, normalizeProposal, validateBlueprint, validateView, parseDraft } from './helpers/studio2-live-harness.js';
const blueprint = () => ({ instruction: 'Uprav výpočet.', files: [{ path: 'src/a.js', instruction: 'Oprav výpočet.', dependsOn: [], contextFiles: ['README.md'] }], focusedTest: { binary: '/usr/bin/node', argv: ['--check', 'src/a.js', 'literal value', '$(no-shell)'], timeoutMs: 30000 } });
async function pending(f) { await f.m2.run(f.session, '/m2-draft', 'src/a.js :: změna'); return f.m2.entry(f.session); }

test('one explicit M2 surface preserves strict payloads, literal JSON and numeric stable origin', async () => {
  const f = fixture(); await f.m2.run(f.session, '/m2-build', JSON.stringify(blueprint()));
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /\/api\/m2\/lifecycle\/draft$/);
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { projectId: 27, origin: f.captured, draft: blueprint() });
  assert.equal(f.calls.some(call => call.url.includes('approve')), false); assert.equal(f.session._m2Pending.planDigest, digest);
  const source = readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/m2-controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/api\/(?:lifecycle|execute|fs\/write)/);
  const invalid = fixture(); invalid.session._projectId = 'not-numeric';
  await assert.rejects(invalid.m2.run(invalid.session, '/m2-plan', '{}'), /aktivní projekt/); assert.equal(invalid.calls.length, 0);
});
for (const status of [400, 500]) test(`HTTP ${status} preserves typed failure, form and pending state`, async () => {
  const f = fixture(); f.session.chat._m2Composer = createForm(f.captured, blueprint());
  f.control.status = status; f.control.response = { code: 'CONTROLLED_FAILURE', error: 'rejected' };
  f.model.pM2Submit(f.model.st(), f.session.id); await tick();
  assert.equal(f.session._m2Pending, null); assert.equal(f.m2.entry(f.session).busy, false);
  assert.match(f.m2.entry(f.session).error, new RegExp('CONTROLLED_FAILURE.*HTTP ' + status));
  assert.match(f.session.chat._m2Composer.error, /rejected/); assert.equal(f.calls.length, 1);
});
test('approval requires loading and displaying the exact digest and forwards only the durable binding', async () => {
  const f = fixture(), entry = await pending(f); await assert.rejects(f.m2.run(f.session, '/m2-approve'), /Otevřete panel/);
  entry.presentedView = entry.view; const original = entry.view;
  entry.view = { ...entry.view, planDigest: 'sha256:' + 'b'.repeat(64) };
  await assert.rejects(f.m2.run(f.session, '/m2-approve'), /Otevřete panel|přesný/);
  entry.view = original; entry.presentedView = original; f.control.response = terminal(f.view, 'succeeded');
  await f.m2.run(f.session, '/m2-approve', '', original);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { lifecycleId: f.view.lifecycleId, planDigest: digest, origin: f.captured });
  assert.equal(f.session._m2Pending, null); assert.deepEqual(f.session._modifiedFiles, ['src/a.js']);
});
test('status, cancellation and restart preserve durable origin without inherited display approval', async () => {
  const f = fixture(); await pending(f); f.store.changed();
  const reboot = new SessionStore(f.storage); assert.deepEqual(reboot.focusedSession()._m2Pending, f.session._m2Pending);
  await f.m2.run(f.session, '/m2-status'); const url = new URL(f.calls.at(-1).url);
  for (const [key, value] of Object.entries(f.captured)) assert.equal(url.searchParams.get(key), String(value));
  f.control.response = terminal(f.view); await f.m2.run(f.session, '/m2-cancel', 'user reason');
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { lifecycleId: f.view.lifecycleId, reason: 'user reason', origin: f.captured });
  assert.equal(f.session._m2Pending, null);
});
test('generic acknowledgement and active chat cannot approve; cancellation stays available', async () => {
  const f = fixture(), entry = await pending(f); entry.presentedView = entry.view;
  assert.equal(f.m2.handleText(f.session, 'ano'), true); assert.equal(f.calls.length, 1);
  f.control.active = true; await assert.rejects(f.m2.run(f.session, '/m2-approve'), /běžící/);
  f.control.response = terminal(f.view); await f.m2.run(f.session, '/m2-cancel'); assert.match(f.calls.at(-1).url, /\/cancel$/);
});
test('project proposal opens editable composer without HTTP or consuming chat draft; preparation is explicit', async () => {
  const f = fixture(), draft = blueprint(); f.model.state.drafts = { [f.session.id]: 'Ordinary draft stays' };
  f.session.chat._projectWorkProposal = normalizeProposal({ origin: f.captured, proposal: { kind: 'ProjectWorkProposal@1', projectId: 27, draft } });
  f.model.pM2Open(f.model.st(), f.session.id); assert.equal(f.calls.length, 0); assert.equal(f.session.chat._m2Composer.instruction, draft.instruction);
  f.model.m2Field(f.session.id, 'instruction', 'Upravené zadání'); f.model.pM2Submit(f.model.st(), f.session.id); await tick();
  assert.equal(f.calls.length, 1); assert.equal(JSON.parse(f.calls[0].options.body).draft.instruction, 'Upravené zadání');
  assert.deepEqual(JSON.parse(f.calls[0].options.body).draft.focusedTest.argv, draft.focusedTest.argv);
  assert.equal(f.model.st().drafts[f.session.id], 'Ordinary draft stays'); assert.equal(f.session.chat._m2Composer.open, false);
});
test('composer survives restart and rejects stale project or conversation without HTTP', () => {
  const f = fixture(); f.session.chat._m2Composer = createForm(f.captured, blueprint()); f.store.changed();
  assert.deepEqual(new SessionStore(f.storage).focusedSession().chat._m2Composer, f.session.chat._m2Composer);
  f.session._convId = 'another'; f.model.pM2Submit(f.model.st(), f.session.id);
  assert.equal(f.calls.length, 0); assert.match(f.session.chat._m2Composer.error, /kontextu/);
  assert.equal(normalizeProposal({ origin: { ...f.captured, projectId: 28 }, proposal: { kind: 'ProjectWorkProposal@1', projectId: 27, draft: blueprint() } }), null);
});
for (const [label, mutate] of [
  ['empty', d => { d.files = []; }], ['duplicate', d => { d.files.push({ ...d.files[0] }); }], ['cyclic', d => { d.files[0].dependsOn = ['src/a.js']; }],
  ['oversized', d => { d.instruction = 'ě'.repeat(257); }], ['foreign dependency', d => { d.files[0].dependsOn = ['outside.js']; }],
  ['traversal', d => { d.files[0].path = '../outside.js'; }], ['shell arguments', d => { d.focusedTest.argv = 'node --check'; }],
  ['context collision', d => { d.files[0].contextFiles = ['src/a.js']; }],
]) test(`composer rejects ${label} before generation`, async () => {
  const f = fixture(), draft = blueprint(); mutate(draft); assert.throws(() => validateBlueprint(draft));
  await assert.rejects(f.m2.run(f.session, '/m2-build', JSON.stringify(draft))); assert.equal(f.calls.length, 0);
});
test('draft shorthand rejects empty, repeated and over-limit paths before HTTP', () => {
  for (const value of ['', 'a :: ', 'a,a :: change', 'a,b,c,d :: change']) assert.throws(() => parseDraft(value));
  assert.deepEqual(parseDraft('a,b,c :: change'), { paths: ['a', 'b', 'c'], instruction: 'change' });
});
test('composer cancellation preserves form; errors cannot alter a newer form or the normal chat draft', async () => {
  const f = fixture(), form = createForm(f.captured, blueprint()); f.session.chat._m2Composer = form;
  f.model.state.drafts = { [f.session.id]: 'keep me' };
  f.control.handler = (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  f.model.pM2Submit(f.model.st(), f.session.id); assert.equal(f.m2.entry(f.session).busy, true);
  assert.equal(f.m2.abortGeneration(f.session), true); const newer = createForm(f.captured, blueprint()); f.session.chat._m2Composer = newer;
  await tick(); assert.equal(f.session.chat._m2Composer, newer); assert.equal(newer.error, null); assert.equal(f.session._m2Pending, null);
  assert.equal(f.calls.length, 1); assert.equal(f.model.st().drafts[f.session.id], 'keep me');
});
test('composer respects pending plan, attachments and active/preparing send boundaries', () => {
  for (const mutate of [f => { f.session._m2Pending = { lifecycleId: f.view.lifecycleId, planDigest: digest, origin: f.captured }; },
    f => { f.session.chat.attachments.push({ name: 'a' }); }, f => { f.control.active = true; }, f => { f.session.chat._preparing = true; }]) {
    const f = fixture(); mutate(f); f.model.pM2Open(f.model.st(), f.session.id); assert.equal(f.session.chat._m2Composer, null); assert.equal(f.calls.length, 0);
  }
});
test('cancelled proposal offers revision with exact retained file/test inputs and fresh approval', async () => {
  const f = fixture(); f.session.chat._m2Composer = createForm(f.captured, blueprint()); await pending(f);
  f.control.response = terminal(f.view); await f.m2.run(f.session, '/m2-cancel'); assert.equal(f.session._m2Pending, null);
  f.model.pM2Open(f.model.st(), f.session.id, true); const form = f.session.chat._m2Composer;
  assert.deepEqual(form.revisionOf, { lifecycleId: f.view.lifecycleId, planDigest: digest }); assert.deepEqual(form.files.map(file => file.path), ['src/a.js']);
  form.files[0].reusePrevious = true; assert.equal(composerDraft(form).files[0].reusePrevious, true);
  assert.equal(f.calls.filter(call => call.url.endsWith('/approve')).length, 0);
  f.session._convId = 'foreign'; f.model.pM2Open(f.model.st(), f.session.id, true); assert.equal(f.session.chat._m2Composer, form);
});
test('observations are bound, read-only and deduplicated; only owning response settles the turn', async () => {
  const f = fixture(), entry = await pending(f); entry.presentedView = entry.view; let settle;
  const observed = { ...f.view, state: 'running', audit: { ...f.view.audit, executionEvents: [{ eventId: 'e1', type: 'phase_intent', path: 'src/a.js' }] } };
  f.control.handler = async url => url.includes('/status?') ? { ok: true, json: async () => observed } : new Promise(resolve => { settle = resolve; });
  const run = f.m2.run(f.session, '/m2-approve'), activity = entry.operation.activity;
  await f.timers.shift()(); await f.timers.shift()(); assert.equal(activity.steps.filter(step => step.id === 'e1').length, 1);
  assert.equal(activity.status, 'running'); assert.equal(entry.view.state, 'awaiting_approval'); assert.equal(entry.busy, true);
  observed.planDigest = 'sha256:' + 'b'.repeat(64); observed.audit.executionEvents.push({ eventId: 'foreign', type: 'phase_applied' });
  await f.timers.shift()(); assert.equal(activity.steps.some(step => step.id === 'foreign'), false);
  settle({ ok: true, json: async () => terminal(f.view, 'succeeded') }); await run;
  assert.equal(activity.status, 'done'); assert.equal(entry.busy, false); assert.equal(f.timers.length, 0);
});
for (const order of ['cancel-first', 'approve-first']) test(`concurrent cancellation preserves canonical ownership: ${order}`, async () => {
  const f = fixture(), entry = await pending(f); entry.presentedView = entry.view; let approve, cancel;
  f.control.handler = url => new Promise(resolve => { if (url.endsWith('/approve')) approve = resolve; else cancel = resolve; });
  const approval = f.m2.run(f.session, '/m2-approve'), cancellation = f.m2.run(f.session, '/m2-cancel'), cancelled = terminal(f.view);
  if (order === 'cancel-first') { cancel({ ok: true, json: async () => cancelled }); await cancellation; assert.equal(entry.busy, true); approve({ ok: true, json: async () => cancelled }); }
  else { approve({ ok: true, json: async () => cancelled }); await approval; cancel({ ok: true, json: async () => cancelled }); }
  await Promise.all([approval, cancellation]); assert.equal(entry.busy, false); assert.equal(f.session._m2Pending, null); assert.equal(entry.view.state, 'cancelled');
});
test('cancel failure preserves approval; conflicting late canonical response fails visibly', async () => {
  const f = fixture(), entry = await pending(f); entry.presentedView = entry.view; let complete;
  f.control.handler = url => url.endsWith('/cancel') ? Promise.reject(new Error('network uncertain')) : new Promise(resolve => { complete = resolve; });
  const approval = f.m2.run(f.session, '/m2-approve'); await assert.rejects(f.m2.run(f.session, '/m2-cancel'), /network uncertain/);
  assert.equal(entry.busy, true); assert.equal(f.session._m2Pending.planDigest, digest);
  complete({ ok: true, json: async () => terminal(f.view) }); await approval;
  f.control.handler = async () => ({ ok: true, json: async () => terminal(f.view, 'succeeded') });
  await assert.rejects(f.m2.run(f.session, '/m2-status', f.view.lifecycleId), /konfliktní/); assert.equal(entry.view.state, 'cancelled'); assert.match(entry.error, /konfliktní/);
});
test('malformed plan and false success cannot pass canonical evidence verification', () => {
  const f = fixture(); for (const view of [{ ...f.view, diff: [] }, { ...f.view, audit: {} }, { ...terminal(f.view, 'succeeded'), result: {} },
    { ...terminal(f.view), terminal: { state: 'cancelled' } }, { ...f.view, plan: { ...f.view.plan, origin: { ...f.captured, conversationId: 'foreign' } } }])
    assert.throws(() => validateView(view, f.view.lifecycleId, f.captured, digest));
});

test('canonical terminal survives restart through a bound durable read and exposes result, test, exact diff and audit', async () => {
  const f = fixture(), entry = await pending(f); entry.presentedView = entry.view;
  f.control.response = terminal(f.view, 'succeeded'); await f.m2.run(f.session, '/m2-approve');
  let vm = f.model.wsVM(f.model.st(), f.session.id);
  assert.equal(vm.m2State, 'succeeded'); assert.equal(vm.m2HasEvidence, true);
  for (const field of ['terminal', 'result', 'focusedTest', 'git', 'governanceReceipt', 'src/a.js', 'before', 'after']) assert.ok(vm.m2Evidence.includes(field));
  assert.deepEqual(new SessionStore(f.storage).focusedSession()._m2Last, f.session._m2Last);
  entry.view = null; await f.m2.run(f.session, '/m2-status');
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get('id'), f.view.lifecycleId);
  vm = f.model.wsVM(f.model.st(), f.session.id); assert.equal(vm.m2State, 'succeeded'); assert.equal(f.session._m2Pending, null);
});
