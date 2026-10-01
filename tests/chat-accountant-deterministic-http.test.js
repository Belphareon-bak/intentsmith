#!/usr/bin/env node

// Selected accountant-cz VAT through real M1 HTTP and an owned SQLite file.
// The loopback provider rejects every request: a calculation needs no model.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';

import Database from 'better-sqlite3';

import { createOwnedJourneyRuntime, expectJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { assertVatDeterministicTurn } from
  './helpers/chat-accountant-vat-oracle.js';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:unused';
// Whole calculator expression: this path intentionally needs no interpreter.
const VAT_INPUT = 'DPH 21 % z 10 000 Kč za rok 2025 pro ČR.';

async function startForbiddenProvider() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.writeHead(503).end(JSON.stringify({ error: 'VAT must not call a provider' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function assertNoProviderGeneration(provider, label) {
  assert.deepEqual(provider.requests.filter(request =>
    request.method === 'POST' && request.path === '/api/chat'), [],
  `${label}: deterministic VAT must not generate through provider`);
}

function assertNoTurnProviderRequests(provider, baseline, label) {
  // Startup inventory can finish asynchronously while history is read. It is
  // distinct from a generative turn and may use /api/show or /api/tags.
  assert.deepEqual(provider.requests.slice(baseline).filter(request =>
    !((request.method === 'POST' && request.path === '/api/show')
      || (request.method === 'GET' && request.path === '/api/tags'))), [],
  `${label}: the VAT turn must not make a provider inference request`);
  assertNoProviderGeneration(provider, label);
}

async function assertHistory(product, databasePath, conversationId, answer) {
  const expected = [{ role: 'user', content: VAT_INPUT },
    { role: 'assistant', content: answer }];
  const httpHistory = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  assert.deepEqual(httpHistory.messages?.map(({ role, content }) => ({ role, content })),
    expected, 'M1 history differs from the completed VAT turn');
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId), expected, 'durable SQLite history differs from M1');
  } finally { db.close(); }
}

test('selected accountant-cz VAT remains durable after restart without provider calls', {
  timeout: 180_000,
}, async t => {
  const provider = await startForbiddenProvider();
  const owned = createOwnedJourneyRuntime(runtime);
  let product = null;
  t.after(async () => {
    if (product) await stopProduct(product);
    await provider.close();
  });
  product = await startProduct(owned, provider.url, MODEL);
  const listed = await expectJson(product, 'GET', '/api/specialists', null, 200);
  assert(listed.specialists?.some(item => item.id === 'accountant-cz'));
  const title = `accountant-vat-deterministic-${randomBytes(5).toString('hex')}`;
  const project = await expectJson(product, 'POST', '/api/projects',
    { name: title, description: 'Owned deterministic VAT test project' }, 201);
  const conversation = await expectJson(product, 'POST', '/api/conversations',
    { title, project_id: project.project.id, mode: 'chat' }, 201);
  const conversationId = conversation.conversation.id;
  const selected = await expectJson(product, 'POST', '/api/chat/specialist',
    { specialistId: 'accountant-cz', sessionId: conversationId }, 200);
  assert.equal(selected.specialistId, 'accountant-cz');
  const providerBaseline = provider.requests.length;
  const result = await expectJson(product, 'POST', '/api/chat', {
    contract: 'ConversationCommand', version: 1,
    requestId: `accountant-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input: VAT_INPUT,
  }, 200);
  assertVatDeterministicTurn(result);
  assertNoTurnProviderRequests(provider, providerBaseline, 'VAT turn');
  await assertHistory(product, owned.database, conversationId, result.response.content);

  await stopProduct(product);
  product = null;
  product = await startProduct(owned, provider.url, MODEL);
  const restartProviderBaseline = provider.requests.length;
  await assertHistory(product, owned.database, conversationId, result.response.content);
  assertNoTurnProviderRequests(provider, restartProviderBaseline, 'restart and history read');
});
