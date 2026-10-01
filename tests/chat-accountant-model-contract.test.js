#!/usr/bin/env node

// Actual M1 HTTP accountant journey with an owned SQLite DB and a loopback
// provider sentinel. VAT calculation must complete without model generation.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import Database from 'better-sqlite3';

import { createOwnedJourneyRuntime, expectJson, requestJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { assertVatDeterministicTurn,
  VAT_INPUT as INPUT, VAT_PARAMS, VAT_RESULT } from
  './helpers/chat-accountant-vat-oracle.js';
import { publicSpecialistToolResults, publicSpecialistVatParams } from
  '../src/chat/handlers/specialist-public.js';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:unused';

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

async function startCreClassificationProvider() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push({ method: request.method, path: request.url,
      body: raw ? JSON.parse(raw) : null });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.writeHead(200).end(JSON.stringify({ models: [
        { name: MODEL, digest: 'a'.repeat(64) },
      ] }));
    } else if (request.method === 'POST' && request.url === '/api/show') {
      response.writeHead(200).end(JSON.stringify({ model_info: {
        'fixture.context_length': 4096,
      } }));
    } else if (request.method === 'POST' && request.url === '/api/chat') {
      response.writeHead(200).end(JSON.stringify({ model: MODEL,
        message: { role: 'assistant', content: JSON.stringify({
          intent: 'CONVERSATIONAL', confidence: 0.99, fileTarget: null,
        }) }, done: true, done_reason: 'stop',
        prompt_eval_count: 80, eval_count: 20 }));
    } else {
      response.writeHead(503).end(JSON.stringify({ error: 'unexpected fixture endpoint' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error =>
      error ? reject(error) : resolve())) };
}

function assertNoProviderGeneration(provider, label) {
  const generated = provider.requests.filter(request =>
    request.method === 'POST' && request.path === '/api/chat');
  assert.deepEqual(generated, [], `${label}: VAT/document tool must not generate through provider`);
}

function assertNoTurnProviderRequests(provider, baseline, label) {
  assert.deepEqual(provider.requests.slice(baseline), [],
    `${label}: the tool turn must not contact provider`);
  assertNoProviderGeneration(provider, label);
}

function assertDurableTurn(databasePath, conversationId, expected) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId), expected);
  } finally { db.close(); }
}

test('selected accountant-cz presents verified VAT through M1 and SQLite without provider', {
  timeout: 180_000,
}, async t => {
  const provider = await startForbiddenProvider();
  let product = null;
  t.after(async () => {
    const errors = [];
    if (product) {
      try { await stopProduct(product); } catch (error) { errors.push(error); }
    }
    try { await provider.close(); } catch (error) { errors.push(error); }
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
  const providerBaseline = provider.requests.length;

  const command = { contract: 'ConversationCommand', version: 1,
    requestId: `accountant-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input: INPUT };
  const result = await expectJson(product, 'POST', '/api/chat', command, 200);
  assertNoTurnProviderRequests(provider, providerBaseline, 'VAT calculation');
  assertVatDeterministicTurn(result);
  const session = await expectJson(product, 'GET',
    `/api/chat/sessions/${conversationId}`, null, 200);
  assert.equal(session.state?.specialist?.id, 'accountant-cz');
  const messages = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  const expected = [{ role: 'user', content: INPUT },
    { role: 'assistant', content: result.response.content }];
  assert.deepEqual(messages.messages.map(({ role, content }) => ({ role, content })), expected);
  assertDurableTurn(journeyRuntime.database, conversationId, expected);
  assertNoTurnProviderRequests(provider, providerBaseline, 'history reads');

  const wrongVat = structuredClone(result);
  wrongVat.response.metadata.toolResults[0].data.vat = 2000;
  assert.throws(() => assertVatDeterministicTurn(wrongVat));
  const wrongParams = structuredClone(result);
  wrongParams.response.metadata.extractedParams.rate = '12';
  assert.throws(() => assertVatDeterministicTurn(wrongParams));
  const missingStatus = structuredClone(result);
  delete missingStatus.response.metadata.executionStatus;
  assert.throws(() => assertVatDeterministicTurn(missingStatus));
});

test('direct accountant expertise publishes only verified VAT scalars and clarifies without a wrapper', {
  timeout: 180_000,
}, async t => {
  const provider = await startCreClassificationProvider();
  const owned = createOwnedJourneyRuntime(runtime);
  let product = null;
  t.after(async () => {
    if (product) await stopProduct(product);
    await provider.close();
  });
  product = await startProduct(owned, provider.url, MODEL);
  const selectAccountant = async () => {
    const conversation = await expectJson(product, 'POST', '/api/conversations',
      { title: `accountant-direct-${randomBytes(5).toString('hex')}`, mode: 'chat' }, 201);
    const conversationId = conversation.conversation.id;
    const route = `/api/conversations/${conversationId}/expertises`;
    const current = await expectJson(product, 'GET', route, null, 200);
    const selected = await expectJson(product, 'PUT', route, {
      projectId: null, expectedRevision: current.revision,
      expertises: [{ id: 'accountant', weight: 1 }],
    }, 200);
    assert.deepEqual(selected.expertises, [{ id: 'accountant', weight: 1 }]);
    return conversationId;
  };
  const send = async (conversationId, input, label) => {
    const providerBaseline = provider.requests.length;
    const result = await expectJson(product, 'POST', '/api/chat', {
      contract: 'ConversationCommand', version: 1,
      requestId: `accountant-direct-${randomBytes(8).toString('hex')}`,
      conversationId, turnId: `accountant-direct-turn-${randomBytes(8).toString('hex')}`,
      action: 'send', input,
    }, 200);
    const requests = provider.requests.slice(providerBaseline);
    const chatRequests = requests.filter(request => request.method === 'POST'
      && request.path === '/api/chat');
    assert.equal(chatRequests.length, 1,
      `${label}: only CRE classification may call the provider; requests=${JSON.stringify(requests)}`);
    assert.equal(chatRequests[0].body?.format, 'json',
      `${label}: the sole provider request must be CRE classification`);
    assert.match(JSON.stringify(chatRequests[0].body?.messages), /DPH/u,
      `${label}: classifier must have seen the VAT input`);
    const expected = [{ role: 'user', content: input },
      { role: 'assistant', content: result.response.content }];
    const history = await expectJson(product, 'GET',
      `/api/conversations/${conversationId}/messages`, null, 200);
    assert.deepEqual(history.messages.map(({ role, content }) => ({ role, content })),
      expected, label);
    assertDurableTurn(owned.database, conversationId, expected);
    return result;
  };

  const vatConversation = await selectAccountant();
  const success = await send(vatConversation, INPUT, 'direct VAT');
  const session = await expectJson(product, 'GET',
    `/api/chat/sessions/${vatConversation}`, null, 200);
  assert.equal(session.state?.specialist?.id, undefined,
    'this journey must use the direct expertise path, not selected specialist');
  assertVatDeterministicTurn(success);
  assert.deepEqual(Object.keys(success.response.metadata.extractedParams).sort(),
    ['amount', 'direction', 'rate', 'year']);
  assert.deepEqual(Object.keys(success.response.metadata.toolResults[0].data).sort(),
    ['base', 'direction', 'rate_percent', 'total', 'vat', 'year']);
  const privateMarker = 'PRIVATE_VAT_FIELD_MUST_NOT_LEAK';
  assert.deepEqual(publicSpecialistVatParams('accountant.vat_calculator',
    { ...VAT_PARAMS, input: privateMarker, privateMarker }), VAT_PARAMS,
  'public parameter projector must discard injected input and private fields');
  assert.deepEqual(publicSpecialistToolResults('accountant.vat_calculator',
    { ...VAT_RESULT, assumptions: [privateMarker], privateMarker }),
  [{ type: 'accountant.vat_calculator', data: VAT_RESULT }],
  'public result projector must discard assumptions and injected private fields');
  assert.doesNotMatch(JSON.stringify(success.response.metadata), /assumptions|PRIVATE_VAT_FIELD/u);

  const clarifyConversation = await selectAccountant();
  const clarify = await send(clarifyConversation,
    'K základu daně 10 000 Kč nebo 12 000 Kč přidej DPH 21 % za rok 2025 pro ČR.',
    'direct VAT clarification');
  const metadata = clarify.response?.metadata;
  assert.equal(metadata?.expertise?.id, 'accountant');
  assert.equal(metadata?.specialistTool, 'accountant.vat_calculator');
  assert.equal(metadata?.executionStatus, 'NEEDS_INPUT');
  assert.equal(metadata?.fallbackSuppressed, true);
  assert.equal(metadata?.deterministicPresentation, undefined);
  assert.equal(metadata?.toolResults, undefined);
  assert.equal(metadata?.extractedParams, undefined);
  assert.match(clarify.response.content, /částk|Kč/iu,
    'CRE-routed clarification must ask for one amount');
});

test('invalid VAT amount and explicit unsupported year fail closed without a model fallback', {
  timeout: 180_000,
}, async t => {
  const provider = await startForbiddenProvider();
  const owned = createOwnedJourneyRuntime(runtime);
  const product = await startProduct(owned, provider.url, MODEL);
  t.after(async () => {
    await stopProduct(product);
    await provider.close();
  });
  const conversation = await expectJson(product, 'POST', '/api/conversations',
    { title: 'accountant-vat-fail-closed', mode: 'chat' }, 201);
  const conversationId = conversation.conversation.id;
  await expectJson(product, 'POST', '/api/chat/specialist',
    { specialistId: 'accountant-cz', sessionId: conversationId }, 200);
  const providerBaseline = provider.requests.length;
  const expected = [];
  for (const [label, input, executionStatus] of [
    ['unrealistic amount', 'K základu daně 9 999 999 999 Kč přidej DPH 21 % za rok 2025 pro ČR.', 'NEEDS_INPUT'],
    ['unsupported year', 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2030 pro ČR.', 'FAILED'],
  ]) {
    const { status, data: result } = await requestJson(product, 'POST', '/api/chat', {
      contract: 'ConversationCommand', version: 1,
      requestId: `accountant-invalid-${randomBytes(8).toString('hex')}`,
      conversationId, turnId: `accountant-invalid-turn-${randomBytes(8).toString('hex')}`,
      action: 'send', input,
    });
    assert.equal(status, 200, `${label}: ${JSON.stringify(result)}`);
    assertNoTurnProviderRequests(provider, providerBaseline, label);
    assert.equal(result.response?.metadata?.specialistTool, 'accountant.vat_calculator', label);
    assert.equal(result.response.metadata.executionStatus, executionStatus, label);
    assert.equal(result.response.metadata.fallbackSuppressed, true, label);
    if (executionStatus === 'FAILED') {
      assert.match(result.response.metadata.errorCode, /^M3_/u, label);
      assert.match(result.response.content, /^Nástroj specialisty nebyl úspěšně dokončen/u, label);
    } else {
      assert.match(result.response.content, /částk|Kč/iu,
        `${label}: clarification must ask for a valid amount`);
    }
    assert.equal(result.response.metadata.deterministicPresentation, undefined, label);
    assert.equal(result.response.metadata.toolResults, undefined, label);
    expected.push({ role: 'user', content: input },
      { role: 'assistant', content: result.response.content });
  }
  const history = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  assert.deepEqual(history.messages.map(({ role, content }) => ({ role, content })), expected);
  assertDurableTurn(owned.database, conversationId, expected);
});

test('selected VAT extraction preserves cents, explicit period, rate and calculation direction', {
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
  const fmt = value => new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value).replace(/[\u00a0\u202f]/gu, ' ');
  const cases = [
    { label: 'missing amount must not treat 2025 as money',
      input: 'Kolik je DPH 21 % za rok 2025?', needsInput: 'amount' },
    { label: 'decimal CZK amount keeps cents',
      input: 'K základu daně 10 000,50 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      params: { amount: 10000.5, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10000.5, vat: 2100.11, total: 12100.61,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'decimal million suffix preserves the decimal separator',
      input: 'K základu daně 1,5M Kč přidej DPH 21 % za rok 2025 pro ČR.',
      params: { amount: 1500000, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 1500000, vat: 315000, total: 1815000,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'decimal thousand suffix preserves the decimal separator',
      input: 'K základu daně 850,5k Kč přidej DPH 21 % za rok 2025 pro ČR.',
      params: { amount: 850500, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 850500, vat: 178605, total: 1029105,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'small decimal amount is not replaced by a year',
      input: 'K základu daně 10,50 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      params: { amount: 10.5, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10.5, vat: 2.21, total: 12.71,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'three decimal places must not become a different amount',
      input: 'K základu daně 0.005 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'ambiguous scaled decimal must not become a different amount',
      input: 'K základu daně 1.234M Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'negative amount must not become a positive amount',
      input: 'K základu daně -10 000 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'amount above calculator range must not become a substring',
      input: 'K základu daně 1 000 000 001 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'two explicit amounts require clarification',
      input: 'K základu daně 10 000 Kč nebo 12 000 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'three explicit amounts require clarification',
      input: 'K základu daně 10 000 Kč, 12 000 Kč a 14 000 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'bare amount before currency amount requires clarification',
      input: 'K základu daně 500 a 100 Kč přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'bare amount after currency amount requires clarification',
      input: 'K základu daně 500 Kč a 100 přidej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'amount' },
    { label: 'two explicit rates require clarification',
      input: 'K základu daně 10 000 Kč přidej DPH 12 % nebo 21 % za rok 2025 pro ČR.',
      needsInput: 'rate' },
    { label: 'two explicit years require clarification',
      input: 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2024 nebo 2025 pro ČR.',
      needsInput: 'year' },
    { label: 'including an unspecified tax requires clarification',
      input: 'Kolik je DPH z 10 000 Kč včetně daně za rok 2025 pro ČR?',
      needsInput: 'direction' },
    { label: 'a calendar date does not replace the explicit VAT year or amount',
      input: 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2025 pro ČR k datu 1. 5. 2025.',
      params: { amount: 10000, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'explicit future year must not silently fall back',
      input: 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2036 pro ČR.', failure: true },
    { label: 'explicit past year must not silently fall back',
      input: 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2022 pro ČR.', failure: true },
    { label: 'explicit unsupported rate must not default to 21 percent',
      input: 'K základu daně 10 000 Kč přidej DPH 15 % za rok 2025 pro ČR.', failure: true },
    { label: 'without VAT plus add means input is base',
      input: '10 000 Kč bez DPH přidej DPH 21 % za rok 2025 pro ČR.',
      params: { amount: 10000, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'negated VAT addition must not execute',
      input: 'K základu daně 10 000 Kč nepřidávej DPH 21 % za rok 2025 pro ČR.',
      needsInput: 'direction' },
    { label: 'explicit refusal to add VAT must not execute',
      input: 'Nechci přidat DPH 21 % k základu daně 10 000 Kč za rok 2025 pro ČR.',
      needsInput: 'direction' },
    { label: 'negated VAT removal must not execute',
      input: 'Z ceny 12 100 Kč včetně DPH 21 % neodečítej DPH za rok 2025 pro ČR.',
      needsInput: 'direction' },
    { label: 'negated VAT calculation must not execute',
      input: 'Neprováděj výpočet DPH z 10 000 Kč při sazbě 21 % za rok 2025 pro ČR.',
      needsInput: 'direction' },
    { label: 'negated VAT computing must not execute',
      input: 'Nespočítej DPH z 10 000 Kč při sazbě 21 % za rok 2025 pro ČR.',
      needsInput: 'direction' },
    { label: 'English do not must not become VAT addition',
      input: 'Do not add DPH 21 % z 10 000 Kč za rok 2025 pro ČR.',
      needsInput: 'direction' },
    { label: 'without calculation explanation must not calculate VAT',
      input: 'Bez výpočtu DPH z 10 000 Kč mi pouze vysvětli sazbu 21 % za rok 2025 pro ČR.',
      needsInput: 'calculationIntent' },
    { label: 'only explain VAT rate must not calculate VAT',
      input: 'Jen vysvětli sazbu DPH 21 % z 10 000 Kč za rok 2025 pro ČR.',
      needsInput: 'calculationIntent' },
    { label: 'explain VAT rate without calculation request must not calculate VAT',
      input: 'Vysvětli sazbu DPH 21 % z 10 000 Kč za rok 2025 pro ČR.',
      needsInput: 'calculationIntent' },
    { label: 'first compute VAT is not a negation',
      input: 'Nejdřív vypočti DPH 21 % k základu daně 10 000 Kč za rok 2025 pro ČR.',
      params: { amount: 10000, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'real estate noun is not a VAT negation',
      input: 'Vypočti DPH 21 % z 10 000 Kč za rok 2025 pro nemovitost v ČR.',
      params: { amount: 10000, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'not only is not a VAT negation',
      input: 'Vypočti DPH 21 % z 10 000 Kč za rok 2025 pro ČR, nejen pro kontrolu.',
      params: { amount: 10000, year: 2025, rate: '21', direction: 'add' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'add', year: 2025 } },
    { label: 'including VAT and calculate base means remove',
      input: '12 100 Kč včetně DPH vypočti základ při sazbě 21 % za rok 2025 pro ČR.',
      params: { amount: 12100, year: 2025, rate: '21', direction: 'remove' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'remove', year: 2025 } },
    { label: 'price without VAT from gross asks for removal',
      input: 'Vypočti cenu bez DPH z 12 100 Kč při sazbě 21 % za rok 2025 pro ČR.',
      params: { amount: 12100, year: 2025, rate: '21', direction: 'remove' },
      vat: { base: 10000, vat: 2100, total: 12100,
        rate_percent: 21, direction: 'remove', year: 2025 } },
  ];
  for (const scenario of cases) {
    await t.test(scenario.label, async () => {
      const conversation = await expectJson(product, 'POST', '/api/conversations',
        { title: `vat-extraction-${randomBytes(5).toString('hex')}`, mode: 'chat' }, 201);
      const conversationId = conversation.conversation.id;
      await expectJson(product, 'POST', '/api/chat/specialist',
        { specialistId: 'accountant-cz', sessionId: conversationId }, 200);
      const providerBaseline = provider.requests.length;
      const { status, data: result } = await requestJson(product, 'POST', '/api/chat', {
        contract: 'ConversationCommand', version: 1,
        requestId: `vat-extract-${randomBytes(8).toString('hex')}`,
        conversationId, turnId: `vat-extract-turn-${randomBytes(8).toString('hex')}`,
        action: 'send', input: scenario.input,
      });
      assert.equal(status, 200, `${scenario.label}: ${JSON.stringify(result)}`);
      assert.deepEqual(provider.requests.slice(providerBaseline), [],
        `${scenario.label}: no provider request may be caused by this VAT turn`);
      const metadata = result.response?.metadata;
      assert.equal(metadata?.specialistTool, 'accountant.vat_calculator', scenario.label);
      if (scenario.failure || scenario.needsInput) {
        assert((scenario.needsInput ? ['FAILED', 'NEEDS_INPUT'] : ['FAILED'])
          .includes(metadata.executionStatus),
        `${scenario.label}: unexpected executionStatus=${metadata.executionStatus}`);
        assert.equal(metadata.fallbackSuppressed, true, scenario.label);
        if (metadata.executionStatus === 'FAILED') {
          assert.match(metadata.errorCode, /^M3_/u, scenario.label);
        } else {
          const fieldPattern = {
            amount: /částk|Kč/iu,
            rate: /sazb|procent|%/iu,
            year: /rok|obdob|let/iu,
            direction: /základ|cena|včetně|bez DPH/iu,
            calculationIntent: /vypo[čc]|vysv[eě]tl|chce[šs]/iu,
          }[scenario.needsInput];
          assert.match(result.response.content, fieldPattern,
            `${scenario.label}: clarification must ask for ${scenario.needsInput}`);
        }
        assert.equal(metadata.deterministicPresentation, undefined, scenario.label);
        assert.equal(metadata.toolResults, undefined, scenario.label);
      } else {
        assert.equal(metadata.executionStatus, 'SUCCESS', scenario.label);
        assert.equal(metadata.deterministicPresentation, true, scenario.label);
        assert.deepEqual(metadata.extractedParams, scenario.params, scenario.label);
        assert.deepEqual(metadata.toolResults, [{ type: 'accountant.vat_calculator',
          data: scenario.vat }], scenario.label);
        const answer = result.response.content.replace(/[\u00a0\u202f]/gu, ' ');
        assert(answer.includes(`| Základ daně | ${fmt(scenario.vat.base)} Kč |`), scenario.label);
        assert(answer.includes(`| DPH (${scenario.vat.rate_percent} %) | ${fmt(scenario.vat.vat)} Kč |`), scenario.label);
        assert(answer.includes(`| Cena s DPH celkem | ${fmt(scenario.vat.total)} Kč |`), scenario.label);
      }
      const expected = [{ role: 'user', content: scenario.input },
        { role: 'assistant', content: result.response.content }];
      const history = await expectJson(product, 'GET',
        `/api/conversations/${conversationId}/messages`, null, 200);
      assert.deepEqual(history.messages.map(({ role, content }) => ({ role, content })),
        expected, scenario.label);
      assertDurableTurn(owned.database, conversationId, expected);
    });
  }
});

test('failed accountant document tool cannot become a successful generative answer', {
  timeout: 180_000,
}, async t => {
  const provider = await startForbiddenProvider();
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
  const providerBaseline = provider.requests.length;
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
  assertNoTurnProviderRequests(provider, providerBaseline, 'deterministic document setup');
  const input = 'doklad d-0000000000000000 = {invalid; vysvětli kontrolní hlášení za květen 2026';
  const command = { contract: 'ConversationCommand', version: 1,
    requestId: `accountant-error-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-error-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input };
  const { status, data: result } = await requestJson(product, 'POST', '/api/chat', command);
  assert.equal(status, 200, `providerRequests=${JSON.stringify(provider.requests)} ${JSON.stringify(result)}\n${product.output}`);
  assertNoTurnProviderRequests(provider, providerBaseline, 'fail-closed document error');
  assert.equal(result.response?.metadata?.specialistTool, 'accountant.document_workflow');
  assert.equal(result.response.metadata.executionStatus, 'FAILED');
  assert.equal(result.response.metadata.fallbackSuppressed, true);
  assert.equal(result.response.metadata.errorCode, 'M3_SPECIALIST_TOOL_PREPARATION_FAILED');
  assert.match(result.response.content, /^Nástroj specialisty nebyl úspěšně dokončen/u);
  assert.equal(result.response.metadata.deterministicPresentation, undefined,
    'failed document result must not claim a successful presentation');
  const messages = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  assert.deepEqual(messages.messages.map(message => [message.role, message.content]),
    [['user', setupInput], ['assistant', setup.response.content],
      ['user', input], ['assistant', result.response.content]]);
});
