// tests/e2e/13-security.e2e.js — Security API: audit, tokens, webhook, sessions
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

const createdTokenIds = [];

try {
  // ── Audit Logs ────────────────────────────────────────────────────────────
  suite('GET /api/security/audit');

  await testAsync('returns audit structure (all types)', async () => {
    const { status, data } = await api('GET', '/api/security/audit');
    assertEqual(status, 200);
    assert(data.results, 'results object required');
    assert(data.type === 'all', `expected type=all, got ${data.type}`);
    assert(typeof data.limit === 'number', 'limit must be number');
  });

  await testAsync('audit with type=cre returns cre only', async () => {
    const { status, data } = await api('GET', '/api/security/audit?type=cre');
    assertEqual(status, 200);
    assert(data.results.cre !== undefined, 'cre results expected');
    assert(Array.isArray(data.results.cre), 'cre must be array');
  });

  await testAsync('audit with limit=5 respects limit', async () => {
    const { status, data } = await api('GET', '/api/security/audit?limit=5');
    assertEqual(status, 200);
    assertEqual(data.limit, 5);
  });

  await testAsync('audit with since filter works', async () => {
    const since = new Date(Date.now() - 86400000).toISOString();
    const { status, data } = await api('GET', `/api/security/audit?since=${encodeURIComponent(since)}`);
    assertEqual(status, 200);
    assert(data.since, 'since should be echoed back');
  });

  // ── API Tokens: CRUD ──────────────────────────────────────────────────────
  suite('API Token CRUD');

  await testAsync('create token returns c3_ prefixed token', async () => {
    const { status, data } = await api('POST', '/api/security/tokens', {
      name: 'e2e-test-token',
      scopes: ['read:chat'],
      expiresIn: 3600
    });
    assertEqual(status, 201);
    assert(data.token, 'plaintext token required');
    assert(data.token.startsWith('c3_'), `token must start with c3_, got ${data.token.substring(0, 5)}`);
    assert(data.id, 'token id required');
    assert(data.name === 'e2e-test-token', 'name should match');
    assert(data.expires_at, 'expires_at required when expiresIn set');
    createdTokenIds.push(data.id);
  });

  await testAsync('list tokens includes created token', async () => {
    const { status, data } = await api('GET', '/api/security/tokens');
    assertEqual(status, 200);
    assert(Array.isArray(data.tokens), 'tokens must be array');
    const found = data.tokens.find(t => t.id === createdTokenIds[0]);
    assert(found, 'created token should be in list');
    assert(!found.token_hash, 'token_hash should not be exposed');
  });

  await testAsync('create token without name returns 400', async () => {
    const { status } = await api('POST', '/api/security/tokens', { name: '' });
    assertEqual(status, 400);
  });

  await testAsync('delete token returns success', async () => {
    const { status, data } = await api('DELETE', `/api/security/tokens/${createdTokenIds[0]}`);
    assertEqual(status, 200);
    assert(data.ok === true, 'ok flag required');
    createdTokenIds.shift();
  });

  await testAsync('delete nonexistent token returns 404', async () => {
    const { status } = await api('DELETE', '/api/security/tokens/nonexistent-id-xyz');
    assertEqual(status, 404);
  });

  // ── Webhook Secret ────────────────────────────────────────────────────────
  suite('Webhook Secret');

  await testAsync('GET webhook-secret returns shape', async () => {
    const { status, data } = await api('GET', '/api/security/webhook-secret');
    assertEqual(status, 200);
    assert(typeof data.configured === 'boolean', 'configured must be boolean');
  });

  await testAsync('POST webhook-secret generates new secret', async () => {
    const { status, data } = await api('POST', '/api/security/webhook-secret');
    assertEqual(status, 200);
    assert(data.ok === true, 'ok flag required');
    assert(data.masked, 'masked secret required');
    assert(data.masked.startsWith('c3_'), 'masked should start with c3_');
  });

  // ── Sessions ──────────────────────────────────────────────────────────────
  suite('Security Sessions');

  await testAsync('GET sessions returns shape', async () => {
    const { status, data } = await api('GET', '/api/security/sessions');
    assertEqual(status, 200);
    assert(typeof data.count === 'number', 'count must be number');
    assert(typeof data.uptime_seconds === 'number', 'uptime_seconds must be number');
    assert(data.uptime_seconds > 0, 'uptime should be positive');
  });

} finally {
  for (const id of createdTokenIds) {
    try { await api('DELETE', `/api/security/tokens/${id}`); } catch {}
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
