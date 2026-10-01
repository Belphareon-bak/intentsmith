// The final resilience corpus is immutable within a three-run acceptance
// series. Local provider cases also exercise the post-inference verdict without
// loading a model or using the GPU.
import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessChatResilienceTransport, chatResilienceRunStatus } from '../scripts/chat-resilience-transport.js';
import { createChatResilienceProviderRelay } from '../scripts/chat-resilience-provider-relay.js';
import { assertFiveDistinctFrameworks } from './helpers/chat-framework-list-oracle.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = path.join(root, 'scripts/measure-m1-l3.js');
const original = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/chat-resilience-final.json'), 'utf8'));
const rubric = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/chat-quality-rubric.json'), 'utf8'));
assert.equal(rubric.cases.length, original.cases.length);
assert.deepEqual(rubric.cases.map(row => row.id), original.cases.map(row => row.id));
for (const [index, row] of rubric.cases.entries()) {
  assert(row.required.length && row.forbidden.length && row.verification.length);
  assert.equal(row.clarification, original.cases[index].question);
  assert.equal(row.heldOut, original.heldOutFamilies.includes(row.family));
}
const scratch = mkdtempSync(path.join(tmpdir(), 'intentsmith-resilience-contract-'));
const MODEL = 'qwen3.5:27b';
const DIGEST = '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
let providerOrdinal = 0;

function run(corpus, options = {}) {
  const file = path.join(scratch, `corpus-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(corpus));
  return spawnSync(process.execPath, [runner, '--isolated-chat', '--offline',
    '--phase', options.phase || 'pilot-contract', '--corpus', file,
    '--record', path.join(scratch, 'unused.json'), ...(options.args || [])], {
    cwd: root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: 10000,
  });
}

function rejected(corpus, expected, options) {
  const result = run(corpus, options);
  assert.notEqual(result.status, 0, 'invalid final corpus must fail before inference');
  assert.match(result.stderr, expected);
}

// A local provider can fail once and then succeed. The successful B/A answer
// must not erase the failed inference request from the transport verdict.
async function controlledProviderWire(scenarios) {
  // Abstract Unix socket avoids IP networking and filesystem socket paths.
  const socketPath = `\0is-resilience-${process.pid}-${++providerOrdinal}`;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const { scenario } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const status = scenario === 'failed' ? 502 : 200;
    const body = scenario === 'failed' ? { error: 'controlled upstream failure' }
      : { model: MODEL, digest: DIGEST, done: scenario !== 'nonterminal',
        message: { content: 'controlled answer' } };
    if (scenario === 'both-valid') body.model_digest_sha256 = DIGEST;
    if (scenario === 'conflicting-digest') body.model_digest_sha256 = 'b'.repeat(64);
    if (scenario === 'alternate-only') { delete body.digest; body.model_digest_sha256 = DIGEST; }
    if (scenario === 'missing-digest') delete body.digest;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  try {
    const wire = [];
    for (const { path: endpoint, scenario } of scenarios) {
      wire.push(await new Promise((resolve, reject) => {
        const request = http.request({ socketPath, path: endpoint, method: 'POST',
          headers: { 'content-type': 'application/json' } }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve({ caseId: 'http-plain', path: endpoint,
            status: response.statusCode,
            response: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
          response.on('error', reject);
        });
        request.on('error', reject);
        request.end(JSON.stringify({ scenario }));
      }));
    }
    return wire;
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function transport(wire) {
  return assessChatResilienceTransport({
    wire, model: MODEL, modelDigest: DIGEST, postflightDigest: DIGEST,
    exit: { code: 0 }, isFinal: true, selected: [{ id: 'http-plain' }],
    recorded: [{ case: { id: 'http-plain' },
      B: { status: 200, result: { status: 'ok', response: { content: 'B answer' } } },
      A: { status: 200, result: { message: { content: 'A answer' } } } }],
  });
}

async function interruptedRelay(scenario) {
  const ordinal = ++providerOrdinal;
  const providerPath = `\0is-provider-abort-${process.pid}-${ordinal}`;
  const relayPath = `\0is-relay-abort-${process.pid}-${ordinal}`;
  let forwarded;
  const sawForward = new Promise(resolve => { forwarded = resolve; });
  let closedUpstream;
  const upstreamClosed = new Promise(resolve => { closedUpstream = resolve; });
  const provider = http.createServer(async (request, response) => {
    for await (const _ of request) { /* consume the request */ }
    forwarded();
    if (scenario === 'upstream-abort') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"model":"qwen3.5:27b","digest":"');
      setTimeout(() => response.destroy(), 20);
    } else if (scenario === 'downstream-abort') {
      setTimeout(() => response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true,
          message: { content: 'valid upstream answer after child disconnect' } })), 50);
    }
  });
  provider.on('connection', socket => socket.once('close', closedUpstream));
  await new Promise(resolve => provider.listen(providerPath, resolve));
  const out = mkdtempSync(path.join(tmpdir(), 'is-resilience-relay-'));
  const wire = [];
  const relay = createChatResilienceProviderRelay({out, upstream:{socketPath:providerPath},
    model:MODEL,wire,persistWire:rows=>writeFileSync(path.join(out,'initial-provider-wire.json'),JSON.stringify(rows))});
  try {
    let relayResponse;
    relay.once('request', (_request, response) => { relayResponse = response; });
    await new Promise(resolve => relay.listen(relayPath, resolve));
    let client;
    const clientDone = new Promise(resolve => {
      client = http.request({socketPath:relayPath,path:'/api/chat',method:'POST',
        headers:{'content-type':'application/json'}},response=>{
        response.resume();
        response.on('end',resolve);
        response.on('error',resolve);
        response.on('close',resolve);
      });
      client.on('error',resolve);
      client.on('close',resolve);
      client.end(JSON.stringify({model:MODEL,messages:[],stream:false}));
    });
    await sawForward;
    if (scenario === 'child-exit') relay.sealPending('CHILD_EXIT_WITH_PENDING_PROVIDER_REQUEST');
    if (scenario === 'downstream-abort') client.destroy();
    if (scenario === 'response-error') {
      relayResponse.emit('error', new Error('controlled child response write failure'));
      assert.equal(await Promise.race([upstreamClosed.then(() => true),
        new Promise(resolve => setTimeout(() => resolve(false), 120))]), true,
      'response error left a hanging upstream socket after the row left the active set');
    }
    await clientDone;
    if (scenario === 'downstream-abort') {
      // The upstream valid terminal must never upgrade a disconnected child.
      await new Promise(resolve => setTimeout(resolve, 90));
    }
    const persisted = JSON.parse(readFileSync(path.join(out,'initial-provider-wire.json'),'utf8'));
    const events = readFileSync(path.join(out,'initial-provider-raw.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(wire.length,1);
    assert.equal(persisted.length,1);
    assert.equal(persisted[0].captureComplete,false);
    assert.match(persisted[0].error,
      /UPSTREAM_RESPONSE_|CHILD_EXIT_WITH_PENDING_PROVIDER_REQUEST|CHILD_RESPONSE_/u);
    assert.equal(events.some(event=>event.event==='request_chunk'),true);
    assert.equal(events.some(event=>event.event==='incomplete'),true);
    if (scenario === 'upstream-abort') {
      assert.equal(events.some(event=>event.event==='response_start'),true);
      assert.equal(events.some(event=>event.event==='response_chunk'),true);
      assert.equal(events.some(event=>event.event==='response_end'),false);
    }
    const verdict=transport(wire);
    assert.equal(verdict.transportComplete,false);
    assert.equal(chatResilienceRunStatus({code:0,transportComplete:verdict.transportComplete}),
      'LIVE_INCOMPLETE');
    if (scenario === 'downstream-abort') {
      const validRetry = await controlledProviderWire([{ path: '/api/chat', scenario: 'valid' }]);
      assert.equal(transport([...wire, ...validRetry]).transportComplete, false,
        'successful retry hid a provider response lost after child disconnect');
    }
  } finally {
    relay.sealPending('TEST_SHUTDOWN');
    relay.closeAllConnections();
    await new Promise(resolve=>relay.close(resolve));
    relay.closeJournal();
    provider.closeAllConnections();
    await new Promise(resolve=>provider.close(resolve));
    rmSync(out,{recursive:true,force:true});
  }
}

try {
  const accepted = run(original);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /"status":"OFFLINE_CORPUS_VALIDATED","cases":53,"modelCalls":0/u);
  const namedArtifact = run(original, { args: ['--model', 'gemma4:26b', '--model-digest', '08ae7ec1744bd7f451c4a530afb39d2673ad9d07a8369b8a33a3613b41212a68'] });
  assert.equal(namedArtifact.status, 0, namedArtifact.stderr);
  rejected(original, /--model-digest is required/u, { args: ['--model', 'gemma4:26b'] });
  rejected(original, /tag and exact SHA-256 digest/u, { args: ['--model', 'gemma4:26b', '--model-digest', 'unknown'] });

  const incomplete = structuredClone(original);
  incomplete.cases.pop();
  rejected(incomplete, /53 declared cases/u);

  const contaminatedHoldout = structuredClone(original);
  contaminatedHoldout.cases.find(entry => entry.family === 'F14').usedForTuning = true;
  rejected(contaminatedHoldout, /exact F14-F20 untouched holdout/u);

  const relabeledExposure = structuredClone(original);
  relabeledExposure.heldOutFamilies = ['F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19'];
  for (const entry of relabeledExposure.cases) {
    if (entry.family === 'F13') entry.usedForTuning = false;
    if (entry.family === 'F20') entry.usedForTuning = true;
  }
  rejected(relabeledExposure, /exact F14-F20 untouched holdout/u);

  const wrongApprovalSource = structuredClone(original);
  wrongApprovalSource.cases.find(entry => entry.id === 'save-next').approve.fromCase = 'http';
  rejected(wrongApprovalSource, /Invalid previous-answer source/u);

  rejected(original, /Unknown or duplicate selected case/u, {
    env: { CHAT_PROBE_CASES: 'missing-case' },
  });
  rejected(original, /Final phase cannot filter cases/u, {
    phase: 'final-1', env: { CHAT_PROBE_CASES: 'http-plain' },
  });
  rejected(original, /Final phase requires direct A\/B baseline/u, {
    phase: 'final-1', env: { CHAT_PROBE_NO_DIRECT: 'true' },
  });
  const dialogProbe = run(original, { phase: 'quality-dialogs' });
  assert.equal(dialogProbe.status, 0, dialogProbe.stderr);
  assert.equal(JSON.parse(dialogProbe.stdout).cases, 12);
  rejected(original, /Quality dialogs cannot filter/u, {
    phase: 'quality-dialogs', env: { CHAT_PROBE_CASES: 'http-plain' },
  });
  const capabilityProbe = run(original, { phase: 'quality-capabilities' });
  assert.equal(capabilityProbe.status, 0, capabilityProbe.stderr);
  assert.match(capabilityProbe.stdout, /"cases":13,"modelCalls":0/u);
  rejected(original, /Capability dialogs cannot filter/u, {
    phase: 'quality-capabilities', env: { CHAT_PROBE_CASES: 'http-plain' },
  });

  const valid = { path: '/api/chat', scenario: 'valid' };
  const clean = transport(await controlledProviderWire([valid]));
  assert.equal(clean.transportComplete, true);
  assert.equal(clean.inferenceWire.length, 1);
  assert.equal(clean.invalidInferenceCallCount, 0);
  assert.equal(transport(await controlledProviderWire([
    { path: '/api/chat', scenario: 'both-valid' },
  ])).transportComplete, true);
  assert.equal(transport(await controlledProviderWire([
    { path: '/api/chat', scenario: 'alternate-only' },
  ])).transportComplete, true);
  assert.equal(transport(await controlledProviderWire([
    { path: '/api/chat', scenario: 'missing-digest' },
  ])).transportComplete, false);
  assert.equal(transport(await controlledProviderWire([
    { path: '/api/chat', scenario: 'conflicting-digest' },
  ])).transportComplete, false,
  'expected digest hid a conflicting model_digest_sha256');
  const failedChat = await controlledProviderWire([
    { path: '/api/chat', scenario: 'failed' }, valid,
  ]);
  const failedChatVerdict = transport(failedChat);
  assert.equal(failedChatVerdict.inferenceWire.length, 2);
  assert.equal(failedChatVerdict.invalidInferenceCallCount, 1);
  assert.equal(failedChatVerdict.transportComplete, false,
    'successful retry hid the failed /api/chat request');
  const failedGenerate = await controlledProviderWire([
    { path: '/api/generate', scenario: 'failed' }, valid,
  ]);
  assert.equal(transport(failedGenerate).transportComplete, false,
    'successful chat hid the failed /api/generate request');
  const nonterminalChat = await controlledProviderWire([
    { path: '/api/chat', scenario: 'nonterminal' }, valid,
  ]);
  assert.equal(transport(nonterminalChat).transportComplete, false,
    'successful retry hid the nonterminal /api/chat request');
  const nonterminalGenerate = await controlledProviderWire([
    { path: '/api/generate', scenario: 'nonterminal' }, valid,
  ]);
  assert.equal(transport(nonterminalGenerate).transportComplete, false,
    'successful chat hid the nonterminal /api/generate request');
  assert.equal(transport([...await controlledProviderWire([valid]),
    { caseId: 'http-plain', path: '/api/chat', error: 'socket closed' }]).transportComplete,
  false, 'captured request without an HTTP terminal was ignored');

  await interruptedRelay('upstream-abort');
  await interruptedRelay('child-exit');
  await interruptedRelay('downstream-abort');
  await interruptedRelay('response-error');

  assertFiveDistinctFrameworks('1. React\n2. Vue\n3. Angular\n4. Svelte\n5. Next.js');
  for (const incomplete of [
    '1. React\n2. Vue\n3. Angular',
    'React, Vue, Angular, Svelte a Next.js. '.repeat(50),
    '1. React\n2. Vue\n3. Next.js\n4. Next\n5. Angular',
    '1. React\n2. Vue\n3. Angular\n4. Svelte\n5. Next.js\n6. Nuxt',
    '1. React\n2. Vue\n3. Angular\n4. Svelte\n5. neexistující příklad',
  ]) assert.throws(() => assertFiveDistinctFrameworks(incomplete));
  console.log('chat resilience runner contract: 23 transport checks, complete 53-case rubric and 6 list-oracle calibration cases PASS (offline, 0 model calls)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
