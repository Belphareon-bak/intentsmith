#!/usr/bin/env node

// Actual M1 HTTP/SQLite journey. The owned product child sees captured public
// offer bytes through a preload and cannot reach external hosts.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from
  './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:1b';
const PRELOAD = fileURLToPath(new URL('./helpers/sazeni-http-fixture-preload.js', import.meta.url));
const PREFERENCES = Object.freeze({ leagues: ['E0'], horizonHours: 24,
  minOdds: '2', maxOdds: '4', minProbability: 0.2, minLegs: 2, maxLegs: 2,
  ticketCount: 2, stake: { currency: 'CZK', perTicketMinor: 5000,
    totalBudgetMinor: 10000 } });

async function startTripwireProvider() {
  let modelCalls = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: 'a'.repeat(64) }] }));
    } else if (request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else {
      modelCalls++;
      response.writeHead(503).end(JSON.stringify({ error: 'betting journey must not call a model' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address !== 'string' && address.address === '127.0.0.1');
  return { url: `http://127.0.0.1:${address.port}`,
    get modelCalls() { return modelCalls; },
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function providerCalls(runtimeRoot) {
  const log = path.join(runtimeRoot.artifacts, 'sazeni-provider-requests.jsonl');
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
}

function command(conversationId, input) {
  return { contract: 'ConversationCommand', version: 1,
    requestId: `sazeni-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `sazeni-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input };
}

async function createSelectedConversation(product, label) {
  const name = `sazeni-${label}-${randomBytes(4).toString('hex')}`;
  const project = await expectJson(product, 'POST', '/api/projects',
    { name, description: `Owned ${label} betting fixture` }, 201);
  const conversation = await expectJson(product, 'POST', '/api/conversations',
    { title: name, project_id: project.project.id, mode: 'chat' }, 201);
  const conversationId = conversation.conversation.id;
  const selected = await expectJson(product, 'POST', '/api/chat/specialist',
    { specialistId: 'sazeni', sessionId: conversationId }, 200);
  assert.equal(selected.specialistId, 'sazeni');
  return conversationId;
}

function bettingResult(response, status = 'READY') {
  assert.equal(response.status, 'ok');
  const metadata = response.response?.metadata;
  assert.equal(metadata?.mode, 'specialist');
  assert.equal(metadata?.specialist?.id, 'sazeni');
  assert.equal(metadata?.specialistTool, 'sazeni.ticket_builder');
  assert.equal(metadata?.executionStatus, 'SUCCESS');
  assert.equal(metadata?.deterministicPresentation, true);
  assert.equal(metadata?.toolResults?.length, 1);
  const result = metadata.toolResults[0].data;
  assert.equal(result.contract, 'BettingResult');
  assert.equal(result.status, status, JSON.stringify(result.errors));
  return result;
}

test('selected Sázení specialist uses observed Fortuna fixture and scopes followups to M1 session', {
  timeout: 180_000,
}, async t => {
  const provider = await startTripwireProvider();
  const owned = createOwnedJourneyRuntime(runtime);
  let product = null;
  t.after(async () => {
    const errors = [];
    if (product) try { await stopProduct(product); } catch (error) { errors.push(error); }
    try { await provider.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Sázení fixture cleanup failed');
  });
  product = await startProduct(owned, provider.url, MODEL,
    { testPreload: PRELOAD, testBettingBridgeRequired: true });
  const listed = await expectJson(product, 'GET', '/api/specialists', null, 200);
  assert(listed.specialists?.some(item => item.id === 'sazeni'));

  const ambiguousSession = await createSelectedConversation(product, 'ambiguous');
  const ambiguous = await expectJson(product, 'POST', '/api/chat',
    command(ambiguousSession, 'Sestav tiket dnes pro Fortunu.'), 200);
  const clarification = bettingResult(ambiguous, 'NEEDS_INPUT');
  assert.deepEqual(clarification.tickets, []);
  assert.match(ambiguous.response.content, /do 24 h.*do 3 dnů/s);
  assert.deepEqual(providerCalls(owned), [], 'ambiguous date must stop before every source fetch');

  const a = await createSelectedConversation(product, 'a');
  const b = await createSelectedConversation(product, 'b');
  const firstInput = JSON.stringify({ preferences: PREFERENCES });
  const before = Date.now();
  const first = await expectJson(product, 'POST', '/api/chat', command(a, firstInput), 200);
  const after = Date.now();
  const firstResult = bettingResult(first);
  assert.equal(firstResult.dataMode, 'observed');
  assert.equal(firstResult.verifiedObservation, true);
  assert.equal(firstResult.verifiedLive, false);
  assert.equal(firstResult.persistence?.status, 'SAVED');
  assert.equal(firstResult.effectivePreferences.ticketOdds.min, '2');
  assert.equal(firstResult.effectivePreferences.ticketOdds.max, '4');
  assert.equal(firstResult.effectivePreferences.probabilityFilter.min, 0.2);
  assert.deepEqual(firstResult.effectivePreferences.legs, { min: 2, max: 2 });
  assert.deepEqual(firstResult.effectivePreferences.stake, PREFERENCES.stake);
  assert.equal(firstResult.effectivePreferences.ticketCount, 2);
  assert(firstResult.tickets.length >= 1 && firstResult.tickets.length <= 2);
  assert.equal(firstResult.tickets[0].totalOdds, '2.8237');
  assert.deepEqual(firstResult.tickets[0].selections.map(selection => [
    selection.eventId, selection.outcomeId, selection.decimalOdds,
  ]), [
    ['ufo:mtch:1vy-0cg', 'home', '1.51'],
    ['ufo:mtch:1vy-0ch', 'home', '1.87'],
  ]);
  for (const ticket of firstResult.tickets) {
    assert.equal(ticket.bookmakerId, 'iFortuna CZ');
    assert.equal(ticket.selections.length, 2);
    assert(Number(ticket.totalOdds) >= 2 && Number(ticket.totalOdds) <= 4);
    assert.equal(ticket.money.stakeMinor, 5000);
    assert(ticket.selections.every(selection => selection.sourceUpdatedAt === null));
    assert(ticket.selections.every(selection => Date.parse(selection.observedAt) >= before
      && Date.parse(selection.observedAt) <= after));
    assert(Date.parse(ticket.expiresAt) > after
      && Date.parse(ticket.expiresAt) <= after + 120_000);
  }
  assert.match(first.response.content, /čas poslední změny kurzu neznámý/);
  assert.match(first.response.content, /2\.8237/);
  assert.match(first.response.content, /Vklad 50,00/);
  assert.match(first.response.content, /sázka nebyla podána/);
  assert.doesNotMatch(first.response.content, /ověřený živý snapshot/);
  assert(providerCalls(owned).some(call => call.kind === 'history'));
  assert(providerCalls(owned).some(call => call.kind === 'fortuna'));
  assert.equal(provider.modelCalls, 0);

  const callsBeforeAmbiguousFollowup = providerCalls(owned).length;
  const ambiguousFollowup = await expectJson(product, 'POST', '/api/chat',
    command(a, 'A co dnes?'), 200);
  assert.equal(bettingResult(ambiguousFollowup, 'NEEDS_INPUT').tickets.length, 0);
  assert.equal(providerCalls(owned).length, callsBeforeAmbiguousFollowup,
    'ambiguous followup must not fetch even with cached preferences');

  const followup = await expectJson(product, 'POST', '/api/chat',
    command(a, 'Teď do 3 dnů, rozestup max 48 h.'), 200);
  const followupResult = bettingResult(followup);
  assert.equal(Date.parse(followupResult.effectivePreferences.window.to)
    - Date.parse(followupResult.effectivePreferences.window.from), 72 * 3_600_000);
  assert.equal(followupResult.effectivePreferences.window.maxSpreadHours, 48);
  assert.equal(followupResult.effectivePreferences.ticketOdds.min, '2');
  assert.deepEqual(followupResult.effectivePreferences.stake, PREFERENCES.stake);

  const separate = await expectJson(product, 'POST', '/api/chat',
    command(b, JSON.stringify({ preferences: { leagues: ['E0'], horizonHours: 24 } })), 200);
  const separateResult = bettingResult(separate);
  assert.equal(separateResult.effectivePreferences.ticketOdds.min, '1.5');
  assert.equal(separateResult.effectivePreferences.stake, undefined);
  assert.equal(separateResult.effectivePreferences.window.maxSpreadHours, 24);

  const messages = await expectJson(product, 'GET',
    `/api/conversations/${a}/messages`, null, 200);
  assert.deepEqual(messages.messages.map(message => message.role),
    ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(messages.messages[1].content, first.response.content);
  assert.equal(messages.messages[3].content, ambiguousFollowup.response.content);
  assert.equal(messages.messages[5].content, followup.response.content);
  const session = await expectJson(product, 'GET', `/api/chat/sessions/${a}`, null, 200);
  assert.equal(session.state?.specialist?.id, 'sazeni');

  const bettingPath = path.join(owned.artifacts, 'sazeni-fixture.sqlite');
  const db = new Database(bettingPath, { readonly: true, fileMustExist: true });
  try {
    const record = JSON.parse(db.prepare('SELECT record_json FROM betting_runs WHERE id = ?')
      .get(firstResult.persistence.recordId).record_json);
    assert.equal(record.hostInvocation.extensionId, 'sazeni');
    assert.equal(record.hostInvocation.conversationId, a);
    assert(Number.isSafeInteger(record.hostInvocation.userMessageId));
    assert.equal(record.request.dataSource, 'public_web');
    assert.deepEqual(record.request.stake, PREFERENCES.stake);
    assert.equal(record.result.tickets[0].totalOdds, firstResult.tickets[0].totalOdds);
    assert.equal(record.hostInvocation.sourceObservationIds.length, 8);
    assert.equal(record.snapshot.source.id, 'fortuna-public-web');
    assert.deepEqual(record.snapshot.events.map(event => event.eventId),
      ['ufo:mtch:1vy-0cg', 'ufo:mtch:1vy-0ch']);
    assert.deepEqual(record.snapshot.events.map(event => event.markets[0].outcomes
      .find(outcome => outcome.outcomeId === 'home').decimalOdds), ['1.51', '1.87']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM betting_observations').get().n,
      providerCalls(owned).length);
  } finally {
    db.close();
  }
});

test('betting fixture hook rejects production and requires an owned preload', async () => {
  const source = [
    "import { createDefaultBettingBridge } from './src/betting/default-host.js';",
    "globalThis[Symbol.for('intentsmith.test.bettingBridge')] = { host: { openInvocation() {} }, capability: { get() {} } };",
    'try { createDefaultBettingBridge(process.cwd()); process.exitCode = 2; }',
    "catch (error) { if (error.message !== 'BETTING_TEST_BRIDGE_FORBIDDEN') process.exitCode = 3; }",
  ].join('\n');
  const forbidden = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: runtime.repositoryRoot, timeout: 10_000, encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: runtime.home,
      NODE_ENV: 'production', CI: '0' },
  });
  assert.equal(forbidden.status, 0, forbidden.stderr);
  await assert.rejects(startProduct(createOwnedJourneyRuntime(runtime),
    'http://127.0.0.1:1', MODEL, { testBettingBridgeRequired: true }),
  /requires an owned test preload/);
  await assert.rejects(startProduct(createOwnedJourneyRuntime(runtime),
    'http://127.0.0.1:1', MODEL,
    { testPreload: PRELOAD, productionAdminToken: 'owned-test-token' }),
  /cannot be used in production runtime/);
});
