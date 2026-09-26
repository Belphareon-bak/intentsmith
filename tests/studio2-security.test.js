import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SecurityWorkspace } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/security-workspace');
const ok = body => ({ ok: true, status: 200, json: async () => body });

test('security reads audit, tokens, sessions and webhook without showing a secret', async () => {
  const calls = [];
  const workspace = new SecurityWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname; calls.push([options.method || 'GET', path]);
      if (path === '/api/security/audit') return ok({ results: { llm: [{ created_at: '2026-09-26T10:00:00Z', model: 'm' }] } });
      if (path === '/api/security/tokens') return ok({ tokens: [] });
      if (path === '/api/security/sessions') return ok({ count: 0, uptime_seconds: 120 });
      if (path === '/api/security/webhook-secret') return ok({ configured: true, persistence: 'environment_only' });
      throw Error('Unexpected ' + path);
    } });
  await workspace.load();
  assert.equal(workspace.vm('prehled').auditRows[0].title.startsWith('LLM'), true);
  assert.match(workspace.vm('relace').sessions, /Počet WS spojení backend zatím nepotvrzuje/);
  assert.match(workspace.vm('pristup').webhook, /nezobrazuje/);
  assert.deepEqual(calls.map(([method]) => method), ['GET', 'GET', 'GET', 'GET']);
  workspace.destroy();
});

test('token creation and revocation require confirmation and exact readback', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const secret = 'intentsmith_' + 'a'.repeat(64);
  let approved = false, exists = false;
  const calls = [];
  const workspace = new SecurityWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    confirmAction: () => approved,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname, method = options.method || 'GET';
      calls.push([method, path, options.body]);
      if (path === '/api/security/tokens' && method === 'GET') return ok({ tokens: exists ? [{ id,
        name: 'lokální test', scopes: '["read:chat","read:projects"]' }] : [] });
      if (path === '/api/security/tokens' && method === 'POST') {
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload, { name: 'lokální test', scopes: ['read:chat', 'read:projects'] });
        exists = true; return ok({ id, name: payload.name, scopes: payload.scopes, token: secret });
      }
      if (path === '/api/security/tokens/' + id && method === 'DELETE') {
        exists = false; return ok({ ok: true, deleted: id });
      }
      throw Error('Unexpected ' + method + ' ' + path);
    } });
  await workspace.load('tokens');
  workspace.setName('lokální test');
  assert.equal(await workspace.createToken(), false);
  assert.equal(calls.filter(([method]) => method === 'POST').length, 0);
  approved = true;
  assert.equal(await workspace.createToken(), true);
  assert.equal(workspace.vm('pristup').oneTimeToken, secret);
  assert.equal(await workspace.createToken(), false, 'another token cannot be created while the secret is visible');
  workspace.hideToken();
  assert.equal(workspace.vm('pristup').oneTimeToken, '');
  assert.equal(await workspace.revokeToken(id), true);
  assert.equal(workspace.vm('pristup').tokens.length, 0);
  workspace.destroy();
});

test('security rejects malformed token inventory instead of showing a false empty list', async () => {
  const workspace = new SecurityWorkspace({ backendUrl: () => 'http://127.0.0.1:3335',
    fetchImpl: async () => ok({ tokens: 'none' }) });
  await workspace.load('tokens');
  assert.equal(workspace.tokens.status, 'error');
  assert.match(workspace.vm('pristup').status, /neplatný seznam/);
  workspace.destroy();
});
