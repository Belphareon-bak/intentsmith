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
import { assessChatResilienceTransport } from '../scripts/chat-resilience-transport.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const runner = path.join(root, 'scripts/measure-m1-l3.js');
const original = JSON.parse(readFileSync(path.join(root, 'tests/fixtures/chat-resilience-final.json'), 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'intentsmith-resilience-contract-'));
const MODEL = 'qwen3.5:27b';
const DIGEST = '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
let providerOrdinal = 0;

function run(corpus, options = {}) {
  const file = path.join(scratch, `corpus-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(corpus));
  return spawnSync(process.execPath, [runner, '--isolated-chat', '--offline',
    '--phase', options.phase || 'pilot-contract', '--corpus', file,
    '--record', path.join(scratch, 'unused.json')], {
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

try {
  const accepted = run(original);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /"status":"OFFLINE_CORPUS_VALIDATED","cases":53,"modelCalls":0/u);

  const incomplete = structuredClone(original);
  incomplete.cases.pop();
  rejected(incomplete, /53 declared cases/u);

  const contaminatedHoldout = structuredClone(original);
  contaminatedHoldout.cases.find(entry => entry.family === 'F13').usedForTuning = true;
  rejected(contaminatedHoldout, /eight untouched holdout families/u);

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

  const valid = { path: '/api/chat', scenario: 'valid' };
  const clean = transport(await controlledProviderWire([valid]));
  assert.equal(clean.transportComplete, true);
  assert.equal(clean.inferenceWire.length, 1);
  assert.equal(clean.invalidInferenceCallCount, 0);
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

  console.log('chat resilience runner contract: 13/13 PASS (offline, 0 model calls)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
