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
