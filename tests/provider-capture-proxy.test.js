import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CAPTURE_DIGEST, CAPTURE_MODEL,
  preflightProviderCapture, startProviderCaptureProxy,
} from '../scripts/provider-capture.js';

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
    seen.push({ method: request.method, path: request.url, body: Buffer.concat(chunks) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      model: CAPTURE_MODEL, digest: CAPTURE_DIGEST, done: true,
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
      { role: 'user', content: 'Jaký přesný auditní kód?' },
    ];
    const body = JSON.stringify({ model: CAPTURE_MODEL, messages, stream: false, options: { num_ctx: 4096 } });
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
        messages: [{ role: 'user', content: 'x' }], options: { num_ctx: 4096 } }),
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
        messages: [{ role: 'user', content: 'x' }], options: { num_ctx: 4096 } }),
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
