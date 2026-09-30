#!/usr/bin/env node

// Actual M1 HTTP and durable SQLite, with a provider that echoes only file data
// present in the final request. The same oracle is used by the opt-in live run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';
import { assertDurableJourney, assertFinalTurn, expectJson, journeySteps,
  makeM1Command, prepareJourney, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);

function verifiedSourceRevision() {
  const supplied = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  if (!supplied) return 'direct-run-unattested';
  assert.match(supplied, /^[a-f0-9]{40}$/, 'source revision must be a full commit SHA');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(supplied, head, 'source revision must match the test checkout');
  const dirt = execFileSync('git', ['status', '--porcelain'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(dirt, '', 'attested source revision requires a clean checkout');
  return supplied;
}

async function startProvider() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2_000_000) { response.writeHead(413).end(); return; }
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
    } else if (request.method === 'POST' && request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.method === 'POST' && request.url === '/api/chat') {
      const payload = JSON.parse(body);
      requests.push(payload);
      let prompt;
      try { prompt = JSON.parse(payload.messages.at(-1).content); }
      catch { prompt = {}; }
      const fileText = prompt.analysis?.excerpts?.map(item => item.text).join('\n') || '';
      const code = /(?:ORION_A_FILE_391|LYRA_B_FILE_752)/u.exec(fileText)?.[0] || 'FILE_CODE_MISSING';
      response.end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify({ reply: `V souboru je ${code}.`, plan: null }) },
        prompt_eval_count: 100, eval_count: 20 }));
    } else {
      response.writeHead(503).end(JSON.stringify({ error: 'Unexpected fixture endpoint' }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test('A→B→A M1 project expertise uses exact file data in the final provider request', {
  timeout: 180_000,
}, async t => {
  const sourceRevision = verifiedSourceRevision();
  const provider = await startProvider();
  let product = null;
  t.after(async () => {
    try { if (product) await stopProduct(product); }
    finally { await provider.close(); }
  });
  product = await startProduct(runtime, provider.url, MODEL);
  const { a, b } = await prepareJourney(product, runtime);
  const steps = journeySteps(a, b);
  const ids = new Set();
  const turns = [];
  let first = null;
  for (const step of steps) {
    const command = makeM1Command(step.own.conversationId, step.label, step.input);
    assert(!ids.has(command.requestId)); ids.add(command.requestId);
    const before = provider.requests.length;
    const result = await expectJson(product, 'POST', '/api/chat', command, 200);
    assert.equal(provider.requests.length, before + 1,
      `${step.label}: expected exactly one final model request`);
    const request = provider.requests.at(-1);
    assertFinalTurn(request, result, step);
    if (first === null) first = { request, result, step };
    turns.push({ label: step.label, requestId: command.requestId,
      conversationId: step.own.conversationId,
      requestSha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
      sourceSha256: step.own.sourceSha256 });
  }
  assert.equal(ids.size, 3);
  await assertDurableJourney(product, a, b);

  // Prove that the oracle itself rejects a relabeled foreign project, missing
  // file bytes, wrong expertise, and a reply contaminated by project B.
  const changed = structuredClone(first.request);
  const prompt = JSON.parse(changed.messages.at(-1).content);
  prompt.analysis.excerpts.find(item => item.path === a.file).text = b.source;
  changed.messages.at(-1).content = JSON.stringify(prompt);
  assert.throws(() => assertFinalTurn(changed, first.result, first.step));
  const wrongRule = structuredClone(first.request);
  const wrongPrompt = JSON.parse(wrongRule.messages.at(-1).content);
  wrongPrompt.expertiseGuidance = b.rule;
  wrongRule.messages.at(-1).content = JSON.stringify(wrongPrompt);
  assert.throws(() => assertFinalTurn(wrongRule, first.result, first.step));
  const wrongReply = structuredClone(first.result);
  wrongReply.response.content += ` ${b.canary}`;
  assert.throws(() => assertFinalTurn(first.request, wrongReply, first.step));

  writeFileSync(`${runtime.artifacts}/chat-project-expertise-model-contract.json`,
    `${JSON.stringify({ schemaVersion: 1,
      sourceRevision,
      fixture: 'owned-fake-provider', projectIds: [a.id, b.id],
      m1Turns: turns, providerCalls: provider.requests.length,
      status: 'PASS' }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
