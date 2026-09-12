import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioPath = path.join(
  root,
  'c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js',
);
const source = await readFile(studioPath, 'utf8');

function count(needle) {
  return source.split(needle).length - 1;
}

function functionSlice(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('Studio has exactly one explicit M2 transport surface and no mutating legacy lifecycle calls', () => {
  for (const endpoint of [
    '/api/m2/lifecycle/draft',
    '/api/m2/lifecycle/prepare',
    '/api/m2/lifecycle/approve',
    '/api/m2/lifecycle/cancel',
    '/api/m2/lifecycle/status',
  ]) {
    assert.equal(count(endpoint), 1, endpoint);
  }

  assert.doesNotMatch(source, /api\/projects\/lifecycle\/start/);
  assert.doesNotMatch(source, /lifecycle\/bind/);
  assert.doesNotMatch(source, /Lifecycle aktivovan|Lifecycle obnoven|Lifecycle: SPEC|Lifecycle: faze/);
  assert.match(source, /M2 lifecycle je neaktivní; plán připravíte explicitním \/m2-plan <JSON>\./);
});

test('all Studio lifecycle HTTP success is gated by Response.ok and typed errors retain status/code', () => {
  const transport = functionSlice('_m2FetchJSON', '_m2RequireStatusView');
  assert.match(transport, /if\(!r\.ok\)/);
  assert.match(transport, /payload\.code/);
  assert.match(transport, /status:r\.status/);
  assert.match(transport, /credentials:'same-origin'/);
  assert.doesNotMatch(transport, /ok:true/);

  const handler = functionSlice('_m2HandleStudioCommand', '_m4LearningProject');
  assert.equal((handler.match(/_m2FetchJSON\(/g) || []).length, 4);
  assert.equal((handler.match(/_m2RequireStatusView\(/g) || []).length, 4);
});

test('prepare is strict JSON over numeric project and stable string Studio origin', () => {
  const origin = functionSlice('_m2StudioOrigin', '_m2SameOrigin');
  assert.match(origin, /Number\.isSafeInteger\(projectId\)/);
  assert.match(origin, /String\(s\._convId\)\.trim\(\)/);
  assert.match(origin, /surface:'studio',sessionId:conversationId,conversationId:conversationId,projectId:projectId/);

  const handler = functionSlice('_m2HandleStudioCommand', '_m4LearningProject');
  assert.match(handler, /proposal=JSON\.parse\(arg\)/);
  assert.match(handler, /if\(!_m2IsRecord\(proposal\)\)/);
  assert.match(handler, /projectId:origin\.projectId,origin:origin,proposal:proposal/);
  assert.doesNotMatch(handler, /projectPath|actor:/);
  assert.match(handler, /M2_STUDIO_ATTACHMENTS_NOT_ALLOWED/);
});

test('approval forwards only the stored exact lifecycle, plan digest and origin with a long timeout', () => {
  const handler = functionSlice('_m2HandleStudioCommand', '_m4LearningProject');
  assert.match(
    handler,
    /JSON\.stringify\(\{lifecycleId:pending\.lifecycleId,planDigest:pending\.planDigest,origin:pending\.origin\}\)\},3600000/,
  );
  assert.match(handler, /if\(arg\).*M2_STUDIO_APPROVAL_ARGUMENTS_FORBIDDEN/);
  assert.match(handler, /_m2AssertCurrentContext\(idx,s,pending\.origin\)/);
  assert.match(handler, /view\.planDigest,origin:view\.plan\.origin/);
  assert.match(handler, /s\._m2Pending=null/);
});

test('status and cancel preserve the durable origin binding', () => {
  const handler = functionSlice('_m2HandleStudioCommand', '_m4LearningProject');
  assert.match(handler, /lifecycleId:pending\.lifecycleId,reason:arg\|\|'user_cancelled',origin:pending\.origin/);
  for (const field of ['surface', 'sessionId', 'conversationId', 'projectId']) {
    assert.match(handler, new RegExp(`encodeURIComponent\\(origin\\.${field}\\)`));
  }
  assert.match(handler, /pending&&pending\.lifecycleId===lifecycleId\?pending\.origin:_m2StudioOrigin\(s\)/);
});

test('pending approval persists and restores only its exact normalized binding', () => {
  const normalizer = functionSlice('_m2NormalizePending', '_m2StudioOrigin');
  for (const field of ['lifecycleId', 'planDigest', 'sessionId', 'conversationId', 'projectId']) {
    assert.match(normalizer, new RegExp(field));
  }
  assert.match(normalizer, /origin\.surface!=='studio'/);
  assert.equal(count('m2Pending: _m2NormalizePending(s._m2Pending)'), 2);
  assert.equal(count('_sessions[i]._m2Pending=_m2NormalizePending(ss.m2Pending)'), 1);
});

test('plan renderer exposes exact change/test/Git/governance evidence and exact approval command', () => {
  const renderer = functionSlice('_m2RenderPlan', '_m2RenderTerminal');
  for (const label of [
    'Plan digest:',
    'Request digest:',
    'Patch-set digest:',
    'Authority-set digest:',
    'beforeDigest:',
    'afterDigest:',
    'Focused test argv:',
    'Focused test timeoutMs:',
    'Git intent:',
    'Governance verdict:',
    'Governance decision digest:',
    'Schválení přesně tohoto plánu: /m2-approve',
  ]) {
    assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(renderer, /Před approval nebyl spuštěn žádný M2 efekt\./);
});

test('terminal renderer exposes canonical terminal/result/test/Git/diff/audit evidence', () => {
  const renderer = functionSlice('_m2RenderTerminal', '_m2RenderStatus');
  for (const label of [
    'M2 CANONICAL TERMINAL',
    'Terminal state:',
    'Terminal result digest:',
    'Result terminal status:',
    'Diff paths:',
    'Diff digest:',
    'Focused test terminal status:',
    'Focused test stdout digest:',
    'Git status:',
    'Git foreign dirt preserved:',
    'Audit governance verdict:',
    'Audit governance receipt ID:',
    'Audit lifecycle event count:',
    'Audit evidence refs:',
    'Exact diff material:',
  ]) {
    assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('generic acknowledgement is guarded before edit or ordinary chat send', () => {
  const send = functionSlice('_chatSendPane', '_chatGapChoice');
  const guard = send.indexOf('_m2IsGenericApproval(t)');
  const edit = send.indexOf('Edit mode — replace message');
  const ordinarySend = send.indexOf('_chatTryWsSend(txt,s,idx)');
  assert.ok(guard >= 0 && guard < edit && guard < ordinarySend);
  assert.match(send, /M2 approval nebyl proveden\./);
  assert.match(send, /použijte pouze \/m2-approve/);

  const generic = functionSlice('_m2IsGenericApproval', '_m2HandleStudioCommand');
  for (const acknowledgement of ['ano', 'ok', 'spusť']) {
    assert.match(generic, new RegExp(acknowledgement));
  }
});


test('Studio draft command renders complete bytes and never auto-approves the model output', async () => {
  const session = { _projectId: 27, _convId: 'conversation-27' };
  const pane = { msgs: [], attachments: [] };
  const calls = [];
  const origin = { surface: 'studio', sessionId: 'conversation-27', conversationId: 'conversation-27', projectId: 27 };
  const view = {
    lifecycleId: 'draft-27', state: 'awaiting_approval', planDigest: 'sha256:' + 'a'.repeat(64),
    plan: { identity: { lifecycleId: 'draft-27' }, state: 'awaiting_approval', origin,
      changes: [{ path: 'src/app.js', afterDigest: 'sha256:after', afterBytes: 23 }],
      focusedTest: { binary: '/usr/bin/node', argv: ['--check', 'src/app.js'], timeoutMs: 30000 }, gitCommit: null },
    audit: { governanceDecision: { verdict: 'allow' } },
    diff: [{ path: 'src/app.js', before: { content: 'export const value=1;', digest: 'sha256:before' },
      after: { content: 'export const value=42;', digest: 'sha256:after' } }],
  };
  const sandbox = vm.createContext({
    _sessions: [session], _backendBase: 'http://fixture.invalid',
    _M2_TERMINAL_STATES: { succeeded: true, failed: true, cancelled: true },
    _sessionActive: 0, _persistSessionState() {}, renderChat() {}, _chatScrollPane() {},
    AbortSignal, AbortController,
    async fetch(url, options) { calls.push({ url, options }); return { ok: true, json: async () => view }; },
  });
  vm.runInContext(source.slice(source.indexOf('function _m2IsRecord'), source.indexOf('/* ── M4 learning')), sandbox);
  assert.equal(sandbox._m2HandleStudioCommand(0, session, pane, null,
    '/m2-draft src/app.js :: Change value to 42', '/m2-draft', 'src/app.js :: Change value to 42'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, 'only draft request; no prepare/approval side request');
  assert.equal(calls[0].url, 'http://fixture.invalid/api/m2/lifecycle/draft');
  assert.deepEqual(JSON.parse(calls[0].options.body).draft, { path: 'src/app.js', instruction: 'Change value to 42' });
  assert.equal(session._m2Pending.planDigest, view.planDigest);
  assert.match(pane.msgs.at(-1).text, /export const value=1;/);
  assert.match(pane.msgs.at(-1).text, /export const value=42;/);
  assert.match(pane.msgs.at(-1).text, /pouze syntaxi/);
  assert.match(pane.msgs.at(-1).text, /\/m2-approve/);
  assert.equal(pane._m2Busy, false);
});


test('Studio can cancel an active draft without sending approval or a legacy mutation', async () => {
  const session = { _projectId: 27, _convId: 'conversation-27' };
  const pane = { msgs: [], attachments: [] };
  const calls = [];
  const sandbox = vm.createContext({
    _sessions: [session], _backendBase: 'http://fixture.invalid', _M2_TERMINAL_STATES: {},
    _sessionActive: 0, _persistSessionState() {}, renderChat() {}, _chatScrollPane() {}, AbortSignal, AbortController,
    fetch(url, options) {
      calls.push({ url, options });
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort',
        () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    },
  });
  vm.runInContext(source.slice(source.indexOf('function _m2IsRecord'), source.indexOf('/* ── M4 learning')), sandbox);
  sandbox._m2HandleStudioCommand(0, session, pane, null, '/m2-draft', '/m2-draft', 'src/app.js :: Change value');
  assert.equal(pane._m2Busy, true);
  sandbox._m2HandleStudioCommand(0, session, pane, null, '/m2-cancel', '/m2-cancel', '');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(pane._m2Busy, false);
  assert.equal(session._m2Pending, null);
  assert.match(pane.msgs.at(-1).text, /M2_STUDIO_DRAFT_CANCELLED/);
});

function controlledStudio({ pending = true, paths = ['src/app.js'], activeM1 = true } = {}) {
  const origin = { surface: 'studio', sessionId: 'conversation-27', conversationId: 'conversation-27', projectId: 27 };
  const planDigest = 'sha256:' + 'a'.repeat(64);
  const session = { _projectId: 27, _convId: origin.conversationId,
    _m2Pending: pending ? { lifecycleId: 'draft-27', planDigest, origin } : null };
  const pane = { msgs: [], attachments: [] };
  session.chat = pane;
  const textarea = { value: '', style: {} };
  const calls = [];
  const view = {
    lifecycleId: 'draft-27', state: 'awaiting_approval', planDigest,
    plan: { identity: { lifecycleId: 'draft-27' }, state: 'awaiting_approval', origin,
      changes: paths.map(file => ({ path: file, afterDigest: 'sha256:after', afterBytes: 23 })),
      focusedTest: { binary: '/usr/bin/node', argv: ['--check', paths[0]], timeoutMs: 30000 }, gitCommit: null },
    audit: { governanceDecision: { verdict: 'allow' } },
    diff: paths.map(file => ({ path: file, before: { content: 'export const value=1;', digest: 'sha256:before' },
      after: { content: 'export const value=42;', digest: 'sha256:after' } })),
  };
  const sandbox = vm.createContext({
    _sessions: [session], _backendBase: 'http://fixture.invalid',
    _M2_TERMINAL_STATES: { succeeded: true, failed: true, cancelled: true },
    _sessionActive: 0, _persistSessionState() {}, renderChat() {}, _chatScrollPane() {}, AbortSignal, AbortController,
    document: { getElementById() { return textarea; } }, C3WS: { hasActiveM1Turn() { return activeM1; } },
    fetch(url, options) {
      return new Promise((resolve, reject) => calls.push({ url, options, reject,
        resolve(payload, status = 200) { resolve({ ok: status === 200, status, json: async () => payload }); } }));
    },
  });
  vm.runInContext(source.slice(source.indexOf('function _m2IsRecord'), source.indexOf('/* ── M4 learning')), sandbox);
  vm.runInContext(functionSlice('_chatSendPane', '_chatGapChoice'), sandbox);
  return { session, pane, calls, view,
    command(cmd, arg = '') { sandbox._m2HandleStudioCommand(0, session, pane, null, cmd + ' ' + arg, cmd, arg); },
    chatSend(text) { textarea.value = text; sandbox._chatSendPane(0); },
    terminal(state = 'cancelled') { return { ...view, state,
      terminal: { state, identity: { lifecycleId: view.lifecycleId }, planDigest } }; },
  };
}

const flushStudio = () => new Promise(resolve => setImmediate(resolve));

test('actual chat entry dispatches M2 cancel despite an active M1 turn and prepared send', async () => {
  const studio = controlledStudio();
  studio.command('/m2-approve');
  studio.pane._preparedSend = { unrelated: true };
  studio.chatSend('/m2-cancel stop_from_chat_entry');
  assert.equal(studio.calls.length, 2);
  assert.equal(studio.calls[1].url, 'http://fixture.invalid/api/m2/lifecycle/cancel');
  assert.equal(JSON.parse(studio.calls[1].options.body).reason, 'stop_from_chat_entry');
  assert.equal(studio.pane._preparedSend.unrelated, true, 'M2 cancel does not alter unrelated M1 ownership');
  studio.calls[0].resolve(studio.terminal());
  studio.calls[1].resolve(studio.terminal());
  await flushStudio();
  assert.equal(studio.pane._m2Busy, false);
  assert.equal(studio.session._m2Pending, null);
});

for (const first of ['approve', 'cancel']) {
  test(`Studio durable cancel during approval keeps both requests owned (${first} response first)`, async () => {
    const studio = controlledStudio();
    studio.command('/m2-approve');
    studio.command('/m2-cancel', 'operator_stop');
    studio.command('/m2-cancel', 'duplicate');
    assert.equal(studio.calls.length, 2, 'one approval and one durable cancellation; no duplicate cancel');
    assert.equal(studio.calls[1].url, 'http://fixture.invalid/api/m2/lifecycle/cancel');
    assert.deepEqual(JSON.parse(studio.calls[1].options.body), {
      lifecycleId: studio.view.lifecycleId, reason: 'operator_stop', origin: studio.view.plan.origin,
    });
    assert.equal(studio.calls[0].options.signal.aborted, false, 'durable cancel must not abort approval transport');
    const firstIndex = first === 'approve' ? 0 : 1;
    studio.calls[firstIndex].resolve(studio.terminal());
    await flushStudio();
    assert.equal(studio.pane._m2Busy, true, 'remaining request still owns the busy state');
    assert.equal(studio.session._m2Pending, null);
    studio.command('/m2-draft', 'src/next.js :: New request');
    assert.equal(studio.calls.length, 2, 'late completion cannot race a newly accepted command');
    studio.calls[1 - firstIndex].resolve(studio.terminal());
    await flushStudio();
    assert.equal(studio.pane._m2Busy, false);
    assert.equal(studio.pane._m2Operation, null);
    assert.equal(studio.session._m2Pending, null);
    assert.match(studio.pane.msgs.at(-1).text, /Terminal state: cancelled/);
  });
}

test('Studio late older approval view cannot reopen a cancelled plan', async () => {
  const studio = controlledStudio();
  studio.command('/m2-approve');
  studio.command('/m2-cancel');
  studio.calls[1].resolve(studio.terminal());
  await flushStudio();
  studio.calls[0].resolve(studio.view);
  await flushStudio();
  assert.equal(studio.session._m2Pending, null);
  assert.equal(studio.pane._m2Busy, false);
  assert.match(studio.pane.msgs.at(-1).text, /Terminal state: cancelled/);
});

test('Studio cancel transport failure preserves the running approval and pending binding', async () => {
  const studio = controlledStudio();
  studio.command('/m2-approve');
  studio.command('/m2-cancel');
  studio.calls[1].reject(new Error('controlled transport failure'));
  await flushStudio();
  assert.equal(studio.pane._m2Busy, true);
  assert.equal(studio.session._m2Pending.planDigest, studio.view.planDigest);
  assert.match(studio.pane.msgs.at(-1).text, /controlled transport failure/);
  studio.calls[0].resolve(studio.terminal('failed'));
  await flushStudio();
  assert.equal(studio.pane._m2Busy, false);
  assert.equal(studio.session._m2Pending, null);
  assert.match(studio.pane.msgs.at(-1).text, /Terminal state: failed/);
});

test('Studio concurrent cancellation cannot use a changed origin', async () => {
  const studio = controlledStudio();
  studio.command('/m2-approve');
  studio.session._convId = 'different-conversation';
  studio.command('/m2-cancel');
  assert.equal(studio.calls.length, 1);
  assert.match(studio.pane.msgs.at(-1).text, /M2_STUDIO_CONTEXT_CHANGED/);
  assert.equal(studio.pane._m2Operation.cancelIssued, false);
  studio.calls[0].resolve(studio.terminal());
  await flushStudio();
  assert.equal(studio.pane._m2Busy, false);
  assert.match(studio.pane.msgs.at(-1).text, /M2_STUDIO_CONTEXT_CHANGED/);
});

test('Studio conflicting canonical responses fail visibly without restoring pending approval', async () => {
  const studio = controlledStudio();
  studio.command('/m2-approve');
  studio.command('/m2-cancel');
  studio.calls[1].resolve(studio.terminal());
  await flushStudio();
  studio.calls[0].resolve(studio.terminal('failed'));
  await flushStudio();
  assert.equal(studio.session._m2Pending, null);
  assert.equal(studio.pane._m2Busy, false);
  assert.match(studio.pane.msgs.at(-1).text, /M2_STUDIO_CONFLICTING_TERMINAL/);
});

for (const paths of [['src/app.js', 'src/other.js'], ['src/app.js', 'src/other.js', 'src/third.cjs']]) {
  test(`Studio serializes ${paths.length} explicit draft paths and previews every result`, async () => {
    const studio = controlledStudio({ pending: false, paths });
    studio.command('/m2-draft', paths.join(', ') + ' :: Change values together');
    assert.equal(studio.calls.length, 1);
    assert.deepEqual(JSON.parse(studio.calls[0].options.body).draft,
      { paths, instruction: 'Change values together' });
    studio.calls[0].resolve(studio.view);
    await flushStudio();
    for (const file of paths) assert.ok(studio.pane.msgs.at(-1).text.includes('Navržený úplný obsah ' + file));
    assert.equal(studio.session._m2Pending.planDigest, studio.view.planDigest);
  });
}

test('Studio rejects empty, duplicate and over-limit draft path lists before HTTP', () => {
  for (const paths of ['src/app.js,', 'src/app.js, src/app.js', 'a.js,b.js,c.js,d.js']) {
    const studio = controlledStudio({ pending: false });
    studio.command('/m2-draft', paths + ' :: Change values together');
    assert.equal(studio.calls.length, 0);
    assert.match(studio.pane.msgs.at(-1).text, /M2_STUDIO_DRAFT_INPUT_INVALID/);
  }
});


for (const command of ['/m2-build', '/m2-plan']) {
  test(`actual chat entry preserves JSON whitespace for ${command} and awaits exact approval`, async () => {
    const paths = ['src/app.js', 'src/cli.js', 'src/domain.js', 'src/store.js'];
    const studio = controlledStudio({ pending: false, paths, activeM1: false });
    const focusedTest = { binary: '/usr/bin/node', argv: ['-e', "assert.equal(value, 'a  b');\tassert.equal(tab, '\\t');"],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30000 };
    const payload = command === '/m2-build'
      ? { instruction: 'Preserve  two spaces.', files: paths.map(path => ({ path, instruction: 'Return the exact text.', dependsOn: [] })), focusedTest }
      : { intent: 'Preserve  two spaces.', changes: paths.map(path => ({ path, afterContent: 'a  b\t\n' })), focusedTest };
    studio.view.plan.focusedTest = focusedTest;
    studio.chatSend(command.toUpperCase() + '   ' + JSON.stringify(payload, null, 2));
    assert.equal(studio.calls.length, 1);
    const sent = JSON.parse(studio.calls[0].options.body);
    assert.deepEqual(sent[command === '/m2-build' ? 'draft' : 'proposal'], payload);
    assert.deepEqual(sent.origin, studio.view.plan.origin);
    assert.equal(studio.calls[0].url, 'http://fixture.invalid/api/m2/lifecycle/' + (command === '/m2-build' ? 'draft' : 'prepare'));
    assert.equal(studio.session._m2Pending, null, 'no approval authority before response');
    studio.calls[0].resolve(studio.view);
    await flushStudio();
    assert.equal(studio.session._m2Pending.planDigest, studio.view.planDigest);
    for (const path of paths) assert.ok(studio.pane.msgs.at(-1).text.includes(path));
    assert.ok(studio.pane.msgs.at(-1).text.includes(JSON.stringify(focusedTest.argv)));
    assert.equal(studio.calls.length, 1, 'neither generation nor preview auto-approves');
    studio.chatSend('/m2-approve');
    assert.deepEqual(JSON.parse(studio.calls[1].options.body), { lifecycleId: studio.view.lifecycleId,
      planDigest: studio.view.planDigest, origin: studio.view.plan.origin });
    studio.calls[1].resolve(studio.terminal('failed'));
    await flushStudio();
    assert.equal(studio.session._m2Pending, null);
    assert.equal(studio.pane._m2Busy, false);
  });
}

test('Studio rejects malformed blueprint locally and can cancel a running build', async () => {
  const studio = controlledStudio({ pending: false });
  for (const input of ['{', '[]', '{"path":"src/app.js"}']) {
    studio.command('/m2-build', input);
    assert.equal(studio.calls.length, 0);
    assert.match(studio.pane.msgs.at(-1).text, /M2_STUDIO_DRAFT_INPUT_INVALID/);
  }
  studio.command('/m2-build', JSON.stringify({ instruction: 'Build.', files: [], focusedTest: {} }));
  assert.equal(studio.calls.length, 1, 'strict field validation remains server-owned');
  studio.command('/m2-cancel');
  assert.equal(studio.calls[0].options.signal.aborted, true);
  studio.calls[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await flushStudio();
  assert.match(studio.pane.msgs.at(-1).text, /M2_STUDIO_DRAFT_CANCELLED/);
  assert.equal(studio.session._m2Pending, null);
  assert.equal(studio.calls.length, 1);
});
