#!/usr/bin/env node

// Actual M1 HTTP accountant journey with an owned SQLite DB and loopback provider.
// The fixture answer is accepted only after the exact tool parameters and
// structured VAT result are observed on the product boundary.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';

import { createOwnedJourneyRuntime, expectJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const DIGEST = 'b'.repeat(64);
const INPUT = 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2025. Uveď přesně základ, DPH a cenu s DPH pro ČR.';
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
const PARAMS = Object.freeze({ amount: 10000, year: 2025, rate: '21', direction: 'add' });

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
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true,
        done_reason: 'stop', prompt_eval_count: 125, eval_count: 45,
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
  assert.equal(result.status, 'ok');
  const metadata = result.response?.metadata;
  assert.equal(metadata?.expertise?.id, 'accountant');
  assert.equal(metadata?.specialistTool, 'accountant.vat_calculator');
  assert.deepEqual(metadata?.extractedParams, PARAMS);
  assert.equal(metadata?.toolResults?.length, 1);
  assert.equal(metadata.toolResults[0].type, 'accountant.vat_calculator');
  const vat = metadata.toolResults[0].data;
  assert.deepEqual({ base: vat.base, vat: vat.vat, total: vat.total,
    rate_percent: vat.rate_percent, direction: vat.direction, year: vat.year },
  { base: 10000, vat: 2100, total: 12100,
    rate_percent: 21, direction: 'add', year: 2025 });
  assert.equal(result.response.content, ANSWER);
  assert.equal(metadata.finishReason, 'stop');

  assert.equal(providerBody.model, MODEL);
  assert.equal(providerBody.stream, false);
  assert.equal(providerBody.think, false);
  const finalUser = providerBody.messages.at(-1);
  assert.equal(finalUser.role, 'user');
  assert(finalUser.content.includes(INPUT));
  const match = /Tool execution results:\n(\{[\s\S]*?\})\n\nBased on these results/u.exec(finalUser.content);
  assert(match, 'structured tool result must reach the final provider body');
  const providerResult = JSON.parse(match[1]);
  assert.deepEqual(providerResult, vat, 'provider must see the exact M1 tool result');
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
  const missingTool = structuredClone(provider.requests[0]);
  missingTool.messages.at(-1).content = INPUT;
  assert.throws(() => assertVatJourney(result, missingTool));
});
