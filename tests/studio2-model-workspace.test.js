import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ModelWorkspace } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/model-workspace');
const ok = body => ({ ok: true, status: 200, json: async () => body });
const response = (status, body) => ({ ok: false, status, json: async () => body });

test('model workspace shows backend inventory and keeps candidate discovery separate from quality', async () => {
  let approved = false, downloaded = false;
  const requests = [];
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => approved,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      requests.push([method, path]);
      if (path === '/api/system/models/overview') return ok({ models: [{ name: 'installed:latest', sizeGB: '2.0',
        boundRoles: ['CHAT'], evaluatedRoleCount: 0, applicableRoleCount: 7 }] });
      if (path === '/api/system/models/candidates') return ok({ candidates: [{ name: 'new:latest',
        installed: false, fitsVram: null, vramMb: 8000 }] });
      if (path === '/api/system/models/downloads') return ok({ downloads: downloaded
        ? [{ model: 'new:latest', status: 'pulling', percent: 10 }] : [] });
      if (path === '/api/system/models/pull' && method === 'POST') {
        downloaded = true;
        assert.deepEqual(JSON.parse(options.body), { name: 'new:latest' });
        return ok({ ok: true, started: true });
      }
      throw Error('Unexpected ' + method + ' ' + path);
    } });
  assert.equal(await workspace.load(), true);
  assert.equal(workspace.vm().rows[0].title, 'installed:latest');
  workspace.select('candidates');
  assert.equal(await workspace.load('candidates'), true);
  assert.match(workspace.vm().rows[0].subtitle, /kvalita nezměřena/);
  assert.equal(await workspace.pull('new:latest'), false);
  assert.equal(requests.some(([method]) => method === 'POST'), false);
  approved = true;
  assert.equal(await workspace.pull('new:latest'), true);
  assert.equal(workspace.vm().rows[0].actions[0].disabled, true);
  assert.equal(requests.filter(([method]) => method === 'POST').length, 1);
  workspace.destroy();
});

test('role assignment reports asynchronous start while evaluation needs exact model and suite digests', async () => {
  const digest = 'a'.repeat(64), suite = 'b'.repeat(64), requests = [];
  const evals = { roles: { CHAT: { binding: 'current:latest', measurementReady: true,
    suiteContractSha256: suite, artifacts: [{ model: 'candidate:latest', digestSha256: digest,
      status: 'MISSING', applicable: true }] } }, history: [] };
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => true,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      requests.push([method, path, options.body]);
      if (path === '/api/system/upgrades/bindings') return ok({ bindings: { CHAT: 'current:latest' } });
      if (path === '/api/system/models/evaluations') return ok(evals);
      if (path === '/api/system/models') return ok({ models: [{ name: 'current:latest' }, { name: 'candidate:latest' }] });
      if (path === '/api/system/upgrades/apply' && method === 'POST') return ok({ ok: true, status: 'started' });
      if (path === '/api/system/models/evaluate' && method === 'POST') return ok({ accepted: true, model: 'candidate:latest', role: 'CHAT' });
      if (path === '/api/system/models/hunt') return ok({ state: 'WAITING', recent: [] });
      throw Error('Unexpected ' + method + ' ' + path);
    } });
  workspace.select('roles');
  await workspace.load('roles');
  workspace.selectedModel = 'candidate:latest';
  assert.equal(await workspace.assignRole(), true);
  assert.match(workspace.notice, /Dokončení je asynchronní/);
  assert.equal(workspace.resources.get('roles').data[0].bindings.CHAT, 'current:latest');
  workspace.select('evaluations');
  await workspace.load('evaluations');
  evals.roles.CHAT.artifacts[0].digestSha256 = 'wrong';
  assert.equal(await workspace.evaluate('CHAT', 'candidate:latest'), false);
  assert.equal(requests.filter(([, path]) => path === '/api/system/models/evaluate').length, 0);
  evals.roles.CHAT.artifacts[0].digestSha256 = digest;
  assert.equal(await workspace.evaluate('CHAT', 'candidate:latest'), true);
  const sent = requests.find(([method, path]) => method === 'POST' && path === '/api/system/models/evaluate');
  assert.deepEqual(JSON.parse(sent[2]), { model: 'candidate:latest', digestSha256: digest,
    role: 'CHAT', suiteContractSha256: suite });
  workspace.destroy();
});

test('governor check is available without prior report and proposal decision requires readback', async () => {
  let report = false, status = 'pending';
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => true,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      if (path === '/api/system/governor/report') return report
        ? ok({ dimensions: { models: { status: 'OBSERVED', score: 0.5 } } })
        : response(404, { error: 'No reports yet' });
      if (path === '/api/system/governor/proposals') return ok({ proposals: [{ id: 7, title: 'Návrh', status }] });
      if (path === '/api/system/governor/check' && method === 'POST') { report = true; return ok({ ok: true }); }
      if (path === '/api/system/governor/proposals/7/approve' && method === 'POST') {
        status = 'approved'; return ok({ success: true });
      }
      throw Error('Unexpected ' + method + ' ' + path);
    } });
  workspace.select('governor');
  assert.equal(await workspace.load('governor'), true);
  assert.equal(workspace.vm().rows[0].title, 'Návrh');
  assert.equal(await workspace.checkGovernor(), true);
  assert.equal(workspace.vm().rows[0].title, 'models');
  assert.equal(await workspace.decideGovernor(7, 'approve'), true);
  assert.match(workspace.notice, /potřeba provést ručně/);
  assert.equal(workspace.vm().rows.find(row => row.title === 'Návrh').actions.length, 0);
  workspace.destroy();
});

test('GPU hunt reads status without triggering work and controls only a confirmed action', async () => {
  let approved = false, state = 'WAITING';
  const calls = [];
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => approved,
    fetchImpl: async (url, options) => {
      const method = options.method || 'GET', path = new URL(url).pathname;
      calls.push([method, path]);
      if (path === '/api/system/models/hunt' && method === 'GET') return ok({ state, recent: [] });
      if (path === '/api/system/models/hunt/control' && method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), { action: 'start' });
        state = 'RUNNING'; return ok({ accepted: true, action: 'start' });
      }
      throw Error('Unexpected ' + method + ' ' + path);
    } });
  workspace.select('hunt');
  await workspace.load('hunt');
  assert.deepEqual(calls, [['GET', '/api/system/models/hunt']]);
  assert.equal(await workspace.hunt('start'), false);
  assert.equal(calls.length, 1);
  approved = true;
  assert.equal(await workspace.hunt('start'), true);
  assert.equal(workspace.vm().rows[0].title, 'Stav: RUNNING');
  assert.deepEqual(calls.map(([method]) => method), ['GET', 'POST', 'GET']);
  workspace.destroy();
});

test('invalid model read response remains an error without prototype models', async () => {
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async () => ok({ models: 'not-a-list' }) });
  assert.equal(await workspace.load(), false);
  assert.deepEqual(workspace.vm().rows, []);
  assert.match(workspace.vm().status, /Načtení selhalo/);
  workspace.destroy();
});

test('stored-answer grading pins reviewed source and never starts without a valid accepted grader', async () => {
  const runId = 'eval_1234', sourceSha256 = 'a'.repeat(64), calls = [];
  let available = false, approve = false;
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => approve,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      calls.push([method, path, options.body]);
      if (path === '/api/system/models/evaluations') return ok({ roles: {}, history: [{ runId,
        model: 'candidate:latest', role: 'CHAT', status: 'AWAITING_REVIEW' }] });
      if (path.endsWith('/grading/' + runId)) return ok({ runId, model: 'candidate:latest', role: 'CHAT',
        sourceSha256, graders: available ? [{ id: 'accept_1' }] : [], reviewed: [] });
      if (path === '/api/system/models/grade' && method === 'POST') return ok({ accepted: true,
        runId, model: 'candidate:latest', role: 'CHAT' });
      if (path === '/api/system/models/hunt') return ok({ state: 'WAITING', recent: [] });
      throw Error('Unexpected request: ' + path);
    } });
  workspace.select('history'); await workspace.load('history');
  assert.equal(await workspace.grade(runId), false);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 0);
  available = true;
  assert.equal(await workspace.grade(runId), false);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 0);
  approve = true;
  assert.equal(await workspace.grade(runId), true);
  const sent = calls.find(([method]) => method === 'POST');
  assert.deepEqual(JSON.parse(sent[2]), { runId, graderAcceptanceId: 'accept_1', sourceSha256 });
  workspace.destroy();
});

test('automation policy fails closed, saves with revision CAS, and confirms readback', async () => {
  let valid = false, revision = 0, approve = true;
  const calls = [];
  const policy = { autoFailoverEnabled: false, autoCleanupEnabled: false, autoCleanupDays: 14 };
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => approve,
    fetchImpl: async (url, options) => {
      const method = options.method || 'GET'; calls.push([method, options.body]);
      if (method === 'GET') return ok({ valid, revision, status: valid ? 'VALID' : 'DB_ERROR',
        reason: valid ? null : 'MODEL_POLICY_DB_INVALID', policy: { ...policy } });
      assert.equal(method, 'PUT');
      const body = JSON.parse(options.body);
      assert.equal(body.expectedRevision, revision);
      revision++;
      Object.assign(policy, body);
      return ok({ ok: true, revision, policy: { ...policy } });
    } });
  workspace.select('policy'); await workspace.load('policy');
  assert.equal(workspace.vm().hasPolicyForm, false);
  assert.equal(await workspace.savePolicy(), false);
  assert.equal(calls.filter(([method]) => method === 'PUT').length, 0);
  valid = true; revision = 7;
  await workspace.load('policy', true);
  workspace.setPolicy('autoFailoverEnabled', true);
  approve = false;
  assert.equal(await workspace.savePolicy(), false);
  assert.equal(calls.filter(([method]) => method === 'PUT').length, 0);
  approve = true;
  assert.equal(await workspace.savePolicy(), true);
  assert.equal(workspace.vm().policyFailover, true);
  assert.equal(workspace.resources.get('policy').data[0].revision, 8);
  assert.equal(calls.filter(([method]) => method === 'PUT').length, 1);
  workspace.destroy();
});

test('verification failure permits rollback only for complete exact operation identity', async () => {
  const requests = [];
  const workspace = new ModelWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => true,
    fetchImpl: async (url, options) => {
      requests.push([new URL(url).pathname, options.body]);
      if (url.endsWith('/rollback')) return ok({ ok: true });
      if (url.endsWith('/bindings')) return ok({ bindings: { CHAT: 'old:latest' } });
      if (url.endsWith('/evaluations')) return ok({ roles: {}, history: [] });
      if (url.endsWith('/models')) return ok({ models: [] });
      throw Error('Unexpected ' + url);
    } });
  workspace.onVerifyFailure({ role: 'CHAT', operationId: 'short', text: 'Selhalo' });
  assert.equal(workspace.vm().hasRollback, false);
  assert.equal(await workspace.rollback(), false);
  const identity = { role: 'CHAT', operationId: '1234567890abcdef',
    committedBindingRevision: 4, failedAttemptRevision: 5 };
  workspace.onVerifyFailure({ ...identity, text: 'Selhalo' });
  assert.equal(workspace.vm().hasRollback, true);
  workspace.onVerifyCleared({ operationId: 'unrelated-operation' });
  assert.equal(workspace.vm().hasRollback, true);
  assert.equal(await workspace.rollback(), true);
  assert.deepEqual(JSON.parse(requests[0][1]), identity);
  assert.equal(workspace.vm().hasRollback, false);
  workspace.destroy();
});
