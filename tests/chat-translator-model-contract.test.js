#!/usr/bin/env node

// Real isolated product/M1 HTTP and SQLite with an owned loopback provider.
// The provider body oracle is shared with the opt-in physical-model suite.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { TRANSLATOR_CASE, assertTranslationMeaning, assertTranslatorDurabilityAndProject,
  assertTranslatorM1Result, assertTranslatorProviderRequest, clearTranslator,
  createTranslatorJourney, makeTranslatorCommand, selectTranslator,
  assertTranslatorSelectedSession } from './helpers/chat-translator-journey.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);

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
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(payload);
      response.end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true,
        done_reason: 'stop', prompt_eval_count: 125, eval_count: 31,
        message: { role: 'assistant',
          content: TRANSLATOR_CASE.fixtureTranslation } }));
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

test('translator selection reaches one generative M1 provider call and preserves meaning and project', {
  timeout: 180_000,
}, async t => {
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
    if (errors.length) throw new AggregateError(errors, 'translator fixture cleanup failed');
  };
  t.after(closeOwned);
  const journeyRuntime = createOwnedJourneyRuntime(runtime);
  product = await startProduct(journeyRuntime, provider.url, MODEL);
  const journey = await createTranslatorJourney(product, journeyRuntime);
  await selectTranslator(product, journey.conversationId);
  const command = makeTranslatorCommand(journey.conversationId);
  const before = provider.requests.length;
  const result = await expectJson(product, 'POST', '/api/chat', command, 200);
  assert.equal(provider.requests.length, before + 1,
    'one completed generative provider call is required');
  const request = provider.requests.at(-1);
  assertTranslatorProviderRequest(request, MODEL);
  await assertTranslatorSelectedSession(product, journey.conversationId);
  assertTranslatorM1Result(result);
  await clearTranslator(product, journey.conversationId, journey.projectId);
  const durable = await assertTranslatorDurabilityAndProject(product, journey, result.response.content);
  assert.equal(provider.requests.length, before + 1,
    'selection and cancellation must not create another model call');

  // These deliberately wrong contracts must fail the same oracle used live.
  const noTool = structuredClone(request);
  noTool.messages.at(-1).content = TRANSLATOR_CASE.input;
  assert.throws(() => assertTranslatorProviderRequest(noTool, MODEL));
  const leakedProject = structuredClone(request);
  leakedProject.messages.at(-1).content += TRANSLATOR_CASE.projectMarker;
  assert.throws(() => assertTranslatorProviderRequest(leakedProject, MODEL));
  assert.throws(() => assertTranslationMeaning(
    'Nora Vela sent the shipment to the RIGEL_731 archive.'));
  assert.throws(() => assertTranslationMeaning(
    'Nora Vega did not send the shipment to the RIGEL_731 archive.'));
  assert.throws(() => assertTranslationMeaning(
    'Nora Vela did not send the shipment to the RIGEL_732 archive.'));

  await closeOwned();
  assert.equal(durable.messages, 2);
});
