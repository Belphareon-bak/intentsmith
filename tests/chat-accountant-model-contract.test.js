#!/usr/bin/env node

// Actual M1 HTTP accountant journey with an owned SQLite DB and loopback provider.
// The fixture answer is accepted only after the exact tool parameters and
// structured VAT result are observed on the product boundary.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';

import { createOwnedJourneyRuntime, expectJson, requestJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { assertVatAnswer, assertVatToolAndPrompt,
  VAT_INPUT as INPUT } from
  './helpers/chat-accountant-vat-oracle.js';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const DIGEST = 'b'.repeat(64);
const ANSWER = [
  'ČR, rok 2025: základ 10 000 Kč, DPH 21 % je 2 100 Kč, cena s DPH je 12 100 Kč.',
  '',
  '### Předpoklady',
  '- Vstupní částka je základ daně; sazba je 21 %.',
  '',
  '### Nezahrnuje',
  '- Individuální daňové posouzení.',
  '',
  '*Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.*',
].join('\n');

async function startFixtureProvider() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 2_000_000) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
    } else if (request.method === 'POST' && request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.method === 'POST' && request.url === '/api/chat') {
      const providerRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(providerRequest);
      // Physical qwen3.5:27b hit done_reason=length at num_predict=256
      // before finishing the mandatory disclaimer. Keep this M1 fixture red
      // when the selected accountant still has that measured output budget.
      const completed = providerRequest.options?.num_predict >= 512;
      response.end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true,
        done_reason: completed ? 'stop' : 'length',
        prompt_eval_count: 125, eval_count: completed ? 300 : 256,
        message: { role: 'assistant', content: ANSWER } }));
    } else {
      response.writeHead(503).end(JSON.stringify({ error: 'unexpected fixture endpoint' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function assertVatJourney(result, providerBody) {
  assertVatToolAndPrompt(result, providerBody, MODEL);
  assert.equal(result.response.content, ANSWER);
  assertVatAnswer(result.response.content);
}

test('selected accountant-cz calculates 2025 VAT through actual M1 HTTP and persists exact answer', {
  timeout: 180_000,
}, async t => {
  let provider = await startFixtureProvider();
  let product = null;
  t.after(async () => {
    const errors = [];
    if (product) {
      try { await stopProduct(product); } catch (error) { errors.push(error); }
    }
    if (provider) {
      try { await provider.close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'accountant fixture cleanup failed');
  });
  const journeyRuntime = createOwnedJourneyRuntime(runtime);
  product = await startProduct(journeyRuntime, provider.url, MODEL);
  const listed = await expectJson(product, 'GET', '/api/specialists', null, 200);
  assert(listed.specialists?.some(item => item.id === 'accountant-cz'),
    'accountant-cz must be installed and discoverable');
  const projectName = `accountant-vat-${randomBytes(5).toString('hex')}`;
  const project = await expectJson(product, 'POST', '/api/projects',
    { name: projectName, description: 'Owned VAT fixture project' }, 201);
  const conversation = await expectJson(product, 'POST', '/api/conversations',
    { title: projectName, project_id: project.project.id, mode: 'chat' }, 201);
  const conversationId = conversation.conversation.id;
  const selected = await expectJson(product, 'POST', '/api/chat/specialist',
    { specialistId: 'accountant-cz', sessionId: conversationId }, 200);
  assert.equal(selected.specialistId, 'accountant-cz');

  const command = { contract: 'ConversationCommand', version: 1,
    requestId: `accountant-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input: INPUT };
  const result = await expectJson(product, 'POST', '/api/chat', command, 200);
  assert.equal(provider.requests.length, 1, 'tool wrapper requires one provider call');
  assertVatJourney(result, provider.requests[0]);
  const session = await expectJson(product, 'GET',
    `/api/chat/sessions/${conversationId}`, null, 200);
  assert.equal(session.state?.specialist?.id, 'accountant-cz');
  const messages = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  assert.deepEqual(messages.messages.map(message => [message.role, message.content]),
    [['user', INPUT], ['assistant', ANSWER]]);

  const wrongVat = structuredClone(result);
  wrongVat.response.metadata.toolResults[0].data.vat = 2000;
  assert.throws(() => assertVatJourney(wrongVat, provider.requests[0]));
  const wrongParams = structuredClone(result);
  wrongParams.response.metadata.extractedParams.rate = '12';
  assert.throws(() => assertVatJourney(wrongParams, provider.requests[0]));
  const missingStatus = structuredClone(result);
  delete missingStatus.response.metadata.executionStatus;
  assert.throws(() => assertVatJourney(missingStatus, provider.requests[0]));
  const missingTool = structuredClone(provider.requests[0]);
  missingTool.messages.at(-1).content = INPUT;
  assert.throws(() => assertVatJourney(result, missingTool));
});

test('failed accountant document tool cannot become a successful generative answer', {
  timeout: 180_000,
}, async t => {
  const provider = await startFixtureProvider();
  let product = null;
  t.after(async () => {
    if (product) await stopProduct(product);
    await provider.close();
  });
  const journeyRuntime = createOwnedJourneyRuntime(runtime);
  product = await startProduct(journeyRuntime, provider.url, MODEL);
  const conversation = await expectJson(product, 'POST', '/api/conversations',
    { title: 'accountant-fail-closed', mode: 'chat' }, 201);
  const conversationId = conversation.conversation.id;
  const route = `/api/conversations/${conversationId}/expertises`;
  const current = await expectJson(product, 'GET', route, null, 200);
  const selected = await expectJson(product, 'PUT', route, {
    projectId: null, expectedRevision: current.revision,
    expertises: [{ id: 'accountant', weight: 1 }],
  }, 200);
  assert.deepEqual(selected.expertises, [{ id: 'accountant', weight: 1 }]);
  const setupInput = 'Vysvětli kontrolní hlášení za květen 2026.';
  const setup = await expectJson(product, 'POST', '/api/chat', {
    contract: 'ConversationCommand', version: 1,
    requestId: `accountant-setup-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-setup-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input: setupInput,
  }, 200);
  assert.equal(setup.response?.metadata?.specialistTool, 'accountant.document_workflow', JSON.stringify(setup));
  assert.equal(setup.response.metadata.executionStatus, 'SUCCESS');
  assert.equal(setup.response.metadata.extractedParams, undefined,
    'public metadata must not repeat document input');
  assert.equal(provider.requests.length, 0, 'deterministic document tool must not call the model');
  const input = 'doklad d-0000000000000000 = {invalid; vysvětli kontrolní hlášení za květen 2026';
  const command = { contract: 'ConversationCommand', version: 1,
    requestId: `accountant-error-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-error-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input };
  const { status, data: result } = await requestJson(product, 'POST', '/api/chat', command);
  assert.equal(status, 200, `providerCalls=${provider.requests.length} ${JSON.stringify(result)}\n${product.output}`);
  assert.equal(provider.requests.length, 0,
    'fail-closed tool error must not invoke the generative wrapper');
  assert.equal(result.response?.metadata?.specialistTool, 'accountant.document_workflow');
  assert.equal(result.response.metadata.executionStatus, 'FAILED');
  assert.equal(result.response.metadata.fallbackSuppressed, true);
  assert.equal(result.response.metadata.errorCode, 'M3_SPECIALIST_TOOL_PREPARATION_FAILED');
  assert.match(result.response.content, /^Nástroj specialisty nebyl úspěšně dokončen/u);
  assert.notEqual(result.response.content, ANSWER, 'fixture model must not invent a success');
  const messages = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  assert.deepEqual(messages.messages.map(message => [message.role, message.content]),
    [['user', setupInput], ['assistant', setup.response.content],
      ['user', input], ['assistant', result.response.content]]);
});
