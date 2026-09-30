#!/usr/bin/env node

// Real M1 HTTP and SQLite with a controlled loopback provider. This verifies
// the value oracle and persistence path, never the physical model's accuracy.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';

import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { VALUE_CASES, assertDurableValueHistory, assertExactValueAnswer,
  assertFinalValueRequest, createValueConversation, isAnswerRequest,
  makeValueCommand } from './helpers/chat-value-fidelity-journey.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);

function sourceRevision() {
  const supplied = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  if (!supplied) return 'direct-run-unattested';
  assert.match(supplied, /^[a-f0-9]{40}$/);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(supplied, head);
  const dirt = execFileSync('git', ['status', '--porcelain'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(dirt, '', 'attested fixture evidence requires clean source');
  return supplied;
}

async function startFixtureProvider() {
  const requests = [];
  const server = http.createServer(async (incoming, outgoing) => {
    const chunks = [];
    let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 2_000_000) { outgoing.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const route = `${incoming.method} ${incoming.url}`;
    outgoing.setHeader('Content-Type', 'application/json');
    if (route === 'GET /api/tags') {
      outgoing.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
      return;
    }
    if (route === 'POST /api/show') {
      outgoing.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
      return;
    }
    if (route !== 'POST /api/chat') {
      outgoing.writeHead(503).end(JSON.stringify({ error: `Unexpected fixture route: ${route}` }));
      return;
    }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(request);
    assert.equal(request.model, MODEL);
    const valueCase = VALUE_CASES.find(item => isAnswerRequest(request, item));
    const content = valueCase
      ? JSON.stringify(valueCase.expected)
      : JSON.stringify({ intent: 'CONVERSATIONAL', confidence: 0.99, fileTarget: null });
    outgoing.end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true,
      done_reason: 'stop', prompt_eval_count: 100, eval_count: 20,
      message: { role: 'assistant', content } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('M1 value answers preserve exact signed arithmetic and durable history', {
  timeout: 180_000,
}, async t => {
  const revision = sourceRevision();
  let provider = await startFixtureProvider();
  let product = null;
  const closeOwned = async () => {
    const errors = [];
    if (product) {
      try { await stopProduct(product); product = null; } catch (error) { errors.push(error); }
    }
    if (provider) {
      try { await provider.close(); provider = null; } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'owned fixture cleanup failed');
  };
  t.after(closeOwned);
  const journeyRuntime = createOwnedJourneyRuntime(runtime);
  product = await startProduct(journeyRuntime, provider.url, MODEL);
  const conversationId = await createValueConversation(product);
  const answers = [];
  const turns = [];
  const requestIds = new Set();
  for (const valueCase of VALUE_CASES) {
    const command = makeValueCommand(conversationId, valueCase);
    assert(!requestIds.has(command.requestId)); requestIds.add(command.requestId);
    const before = provider.requests.length;
    const result = await expectJson(product, 'POST', '/api/chat', command, 200);
    assert.equal(result.status, 'ok');
    const newRequests = provider.requests.slice(before);
    const answerRequests = newRequests.filter(request => isAnswerRequest(request, valueCase));
    assert.equal(answerRequests.length, 1,
      `${valueCase.label}: expected exactly one final provider ANSWER request`);
    const answerRequest = answerRequests[0];
    assertFinalValueRequest(answerRequest, valueCase, MODEL);
    const content = result.response?.content;
    assertExactValueAnswer(content, valueCase);
    answers.push(content);
    turns.push({ label: valueCase.label, requestId: command.requestId,
      providerCalls: newRequests.length,
      requestSha256: createHash('sha256').update(JSON.stringify(answerRequest)).digest('hex') });
  }
  assert.equal(requestIds.size, VALUE_CASES.length);
  const durable = await assertDurableValueHistory(product, journeyRuntime.database, conversationId, answers);

  // These negative controls ensure a future model error cannot turn green by
  // merely returning valid JSON or including the expected numbers somewhere.
  const positive = VALUE_CASES[0];
  assert.throws(() => assertExactValueAnswer('{"a":73,"b":62,"delta":-11,"higher":"A"}', positive));
  assert.throws(() => assertExactValueAnswer('{"a":73,"b":62,"delta":11,"higher":"B"}', positive));
  assert.throws(() => assertExactValueAnswer('{"a":"73","b":62,"delta":11,"higher":"A"}', positive));
  assert.throws(() => assertExactValueAnswer('{"a":0,"a":73,"b":62,"delta":11,"higher":"A"}', positive));
  assert.throws(() => assertExactValueAnswer('```json\n{"a":73,"b":62,"delta":11,"higher":"A"}\n```', positive));
  const missingInput = structuredClone(provider.requests.find(request => isAnswerRequest(request, positive)));
  missingInput.messages = [{ role: 'user', content: 'User: no source values' }];
  assert.throws(() => assertFinalValueRequest(missingInput, positive, MODEL));
  const staleInput = structuredClone(provider.requests.find(request => isAnswerRequest(request, positive)));
  staleInput.messages.push({ role: 'user', content: 'User: unrelated current request' });
  assert.throws(() => assertFinalValueRequest(staleInput, positive, MODEL));
  const trailingAssistant = structuredClone(provider.requests.find(request => isAnswerRequest(request, positive)));
  trailingAssistant.messages.push({ role: 'assistant', content: 'This is now the trailing provider message' });
  assert.throws(() => assertFinalValueRequest(trailingAssistant, positive, MODEL));

  const totalProviderCalls = provider.requests.length;
  await closeOwned();
  writeFileSync(path.join(runtime.artifacts, 'chat-value-fidelity-contract.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'PASS', sourceRevision: revision,
      fixture: 'owned-loopback-provider', conversationId,
      cases: turns, durable, totalProviderCalls,
      limits: 'Controlled responses prove the M1 path and oracle, not physical-model quality.'
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
