import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CAPTURE_DIGEST, CAPTURE_MODEL,
  attestWindowFillEvidence, preflightProviderCapture, startProviderCaptureProxy,
} from '../scripts/provider-capture.js';
import { runSuite } from '../scripts/run-suites.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('provider proxy records the exact terminal chat before forwarding success', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-capture-selfcheck-'));
  const captureFile = path.join(root, 'capture.jsonl');
  const seen = [];
  const provider = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ method: request.method, path: request.url, body });
    const bad = body.toString('utf8').includes('fail: retry');
    response.writeHead(bad ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      model: CAPTURE_MODEL, digest: CAPTURE_DIGEST, done: !bad,
      done_reason: 'stop', prompt_eval_count: 3072, eval_count: 8,
      message: { role: 'assistant', content: 'RIGEL_KAPPA_731' },
    }));
  });
  await listen(provider);
  let proxy;
  try {
    proxy = await startProviderCaptureProxy({
      captureFile, upstreamOrigin: `http://127.0.0.1:${provider.address().port}`,
    });
    const messages = [
      { role: 'system', content: 'Souhrn: RIGEL_KAPPA_731' },
      { role: 'user', content: 'User: Jaký přesný auditní kód?' },
    ];
    const body = JSON.stringify({ model: CAPTURE_MODEL, messages, stream: false,
      options: { num_ctx: 4096, num_predict: 1200 } });
    const response = await fetch(`${proxy.url}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).message.content, 'RIGEL_KAPPA_731');
    // Response completion is the synchronization point: the test can read the
    // fully flushed row immediately, without sleeps or polling.
    const rows = readFileSync(captureFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 1);
    assert.equal(statSync(captureFile).mode & 0o777, 0o600);
    assert.equal(rows[0].schemaVersion, 1);
    assert.equal(rows[0].path, '/api/chat');
    assert.equal(rows[0].model, CAPTURE_MODEL);
    assert.equal(rows[0].numCtx, 4096);
    assert.equal(rows[0].numPredict, 1200);
    assert.deepEqual(rows[0].messages, messages);
    assert.equal(rows[0].requestSha256, sha256(Buffer.from(body)));
    assert.equal(rows[0].status, 200);
    assert.equal(rows[0].promptEvalCount, 3072);
    assert.equal(rows[0].terminal.digest, CAPTURE_DIGEST);
    assert.equal(rows[0].done, true);
    assert.equal(proxy.getCapturedCount(), 1);
    assert.equal(proxy.getFailure(), null);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].path, '/api/chat');

    const sourceRevision = 'a'.repeat(40);
    const evidenceFile = path.join(root, '85-window-fill-evidence.json');
    const captureBytes = readFileSync(captureFile);
    const windowEvidence = {
      status: 'PASS', sourceRevision,
      providerCaptureBytes: captureBytes.length,
      providerCaptureSha256: sha256(captureBytes),
      turns: [{ turn: 1, requestSha256: rows[0].requestSha256 }],
      observedWindow: 4096, summary: { text: 'RIGEL_KAPPA_731' },
      final: {
        requestSha256: rows[0].requestSha256,
        responseSha256: rows[0].responseSha256,
        numCtx: 4096, numPredict: 1200, promptEvalCount: 3072,
        question: 'Jaký přesný auditní kód?', answer: 'RIGEL_KAPPA_731',
        answerMatchesRequestedFormat: true,
        providerPrompt: messages.map(message => message.content).join('\n'),
        rawFirstMessagePresent: false, rawFirstMidLinePresent: false,
      },
    };
    const attest = () => attestWindowFillEvidence({ evidenceFile, captureFile, sourceRevision });
    // A legacy suite can return exit 0 with provider rows but without the
    // dedicated window-fill artifact. That must never become runner PASS.
    assert.throws(attest, /ENOENT/);
    const writeEvidence = value => writeFileSync(evidenceFile, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    writeEvidence(windowEvidence);
    assert.equal(attest().finalRequestSha256, rows[0].requestSha256);

    const trailingResponse = await fetch(`${proxy.url}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CAPTURE_MODEL, stream: false,
        messages: [{ role: 'user', content: 'User: later background request' }],
        options: { num_ctx: 4096, num_predict: 1200 } }),
    });
    assert.equal(trailingResponse.status, 200);
    await trailingResponse.text();
    const attested = attest();
    assert.equal(attested.observedProviderRows, 1);
    assert.equal(attested.providerRows, 2);
    writeEvidence({ ...windowEvidence, sourceRevision: 'b'.repeat(40) });
    assert.throws(attest, /source revision mismatch/);
    writeEvidence({ ...windowEvidence, providerCaptureSha256: '0'.repeat(64) });
    assert.throws(attest, /capture digest mismatch/);
    writeEvidence({ ...windowEvidence, providerCaptureBytes: captureBytes.length - 1 });
    assert.throws(attest, /not newline terminated/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, requestSha256: '0'.repeat(64) } });
    assert.throws(attest, /final provider call is missing/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, answer: 'forged' } });
    assert.throws(attest, /final answer mismatch/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, answerMatchesRequestedFormat: false } });
    assert.throws(attest, /code-only format/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, numPredict: 512 } });
    assert.throws(attest, /num_predict mismatch/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, rawFirstMessagePresent: true } });
    assert.throws(attest, /raw first message remains/);
    writeFileSync(evidenceFile, '{', { mode: 0o600 });
    assert.throws(attest, SyntaxError);
    writeEvidence(windowEvidence);
    const failedResponse = await fetch(`${proxy.url}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CAPTURE_MODEL, stream: false,
        messages: [{ role: 'user', content: 'fail: retry' }],
        options: { num_ctx: 4096, num_predict: 1200 } }),
    });
    assert.equal(failedResponse.status, 503);
    await failedResponse.text();
    assert.match(proxy.getFailure(), /provider returned HTTP 503/);
    assert.throws(attest, /failed provider call in capture/);
  } finally {
    if (proxy) await proxy.close();
    await close(provider);
    rmSync(root, { recursive: true, force: true });
  }
});

test('proxy rejects an effectful endpoint and a foreign model without forwarding', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-capture-deny-'));
  let forwarded = 0;
  const provider = http.createServer((_request, response) => { forwarded += 1; response.end('{}'); });
  await listen(provider);
  let proxy;
  try {
    proxy = await startProviderCaptureProxy({
      captureFile: path.join(root, 'capture.jsonl'),
      upstreamOrigin: `http://127.0.0.1:${provider.address().port}`,
    });
    const forbidden = await fetch(`${proxy.url}/api/pull`, {
      method: 'POST', body: JSON.stringify({ model: CAPTURE_MODEL }),
    });
    const foreign = await fetch(`${proxy.url}/api/chat`, {
      method: 'POST', body: JSON.stringify({ model: 'other:tag', stream: false,
        messages: [{ role: 'user', content: 'x' }],
        options: { num_ctx: 4096, num_predict: 1200 } }),
    });
    assert.equal(forbidden.status, 403);
    assert.equal(foreign.status, 403);
    assert.equal(forwarded, 0);
    assert.match(proxy.getFailure(), /outside pinned capture scope/);
    assert.equal(readFileSync(proxy.captureFile, 'utf8'), '');
  } finally {
    if (proxy) await proxy.close();
    await close(provider);
    rmSync(root, { recursive: true, force: true });
  }
});

test('proxy marks a successful-looking response without usage as a capture failure', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-capture-usage-'));
  const provider = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ model: CAPTURE_MODEL, done: true, message: { role: 'assistant', content: 'x' } }));
  });
  await listen(provider);
  let proxy;
  try {
    proxy = await startProviderCaptureProxy({
      captureFile: path.join(root, 'capture.jsonl'),
      upstreamOrigin: `http://127.0.0.1:${provider.address().port}`,
    });
    const response = await fetch(`${proxy.url}/api/chat`, {
      method: 'POST', body: JSON.stringify({ model: CAPTURE_MODEL, stream: false,
        messages: [{ role: 'user', content: 'x' }],
        options: { num_ctx: 4096, num_predict: 1200 } }),
    });
    assert.equal(response.status, 200);
    await response.text();
    const row = JSON.parse(readFileSync(proxy.captureFile, 'utf8').trim());
    assert.equal(row.promptEvalCount, null);
    assert.match(proxy.getFailure(), /positive prompt usage/);
  } finally {
    if (proxy) await proxy.close();
    await close(provider);
    rmSync(root, { recursive: true, force: true });
  }
});

test('preflight requires idle provider and GPU plus an exact installed digest', async () => {
  const requested = [];
  const fakeFetch = async url => {
    const endpoint = new URL(url).pathname;
    requested.push(endpoint);
    const value = endpoint === '/api/ps' ? { models: [] }
      : endpoint === '/api/tags' ? { models: [{ name: CAPTURE_MODEL, digest: CAPTURE_DIGEST }] }
        : { version: 'fake-provider' };
    return { status: 200, json: async () => value };
  };
  const options = {
    upstreamOrigin: 'http://127.0.0.1:11434', fetchImpl: fakeFetch,
    computeProcesses: () => '',
    memoryInfo: () => 'MemAvailable: 67108864 kB\n',
    diskInfo: () => ({ bavail: 100 * 2 ** 20, bsize: 1024 }),
  };
  const ready = await preflightProviderCapture(options);
  assert.equal(ready.digest, CAPTURE_DIGEST);
  assert.deepEqual(requested, ['/api/ps', '/api/tags', '/api/version']);
  await assert.rejects(preflightProviderCapture({ ...options, computeProcesses: () => '999,foreign,1024' }), /provider capture blocked/);
  await assert.rejects(preflightProviderCapture({ ...options, fetchImpl: async url => {
    const response = await fakeFetch(url);
    return new URL(url).pathname === '/api/ps' ? { status: 200, json: async () => ({ models: [{ name: CAPTURE_MODEL }] }) } : response;
  } }), /provider capture blocked/);
  await assert.rejects(preflightProviderCapture({ ...options, fetchImpl: async url => {
    const response = await fakeFetch(url);
    return new URL(url).pathname === '/api/tags' ? { status: 200, json: async () => ({ models: [{ name: CAPTURE_MODEL, digest: 'wrong' }] }) } : response;
  } }), /pinned model digest mismatch/);
});

test('capture CLI rejects other suites before touching provider or GPU', () => {
  const result = spawnSync(process.execPath, [
    'scripts/run-suites.js', '--suite=IS-T1-TESTS-NIGHTLY-AUDIT-RUNNER-SELF-TEST', '--capture-provider',
  ], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /vyžaduje pouze/);
});

test('suite spawn error resolves as FAIL for runner cleanup', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'intentsmith-suite-spawn-'));
  try {
    const result = await runSuite({ argv: [path.join(root, 'missing-node'), 'unused'] },
      process.env, 1_000, path.join(root, 'suite.out'));
    assert.equal(result.status, 'FAIL');
    assert.match(result.detail, /spawn failed: spawn/);
    assert.equal(readFileSync(path.join(root, 'suite.out'), 'utf8'), '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
