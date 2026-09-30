// Test-runner-only boundary for one pinned, local Ollama model. The provider
// request and terminal response are persisted before the client sees success.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, statfsSync, writeSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { assessScheduledEvaluationReadiness } from '../src/upgrade/gpu-evaluation-lock.js';

export const CAPTURE_SUITE_ID = 'IS-T3-E2E-85-LONG-SESSION-DEGRADATION';
export const CAPTURE_MODEL = 'qwen3.5:27b';
export const CAPTURE_DIGEST = '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e';
export const CAPTURE_UPSTREAM = 'http://127.0.0.1:11434';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const SHA256 = bytes => createHash('sha256').update(bytes).digest('hex');

function assertLoopbackOrigin(origin) {
  const url = new URL(origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(Number.isSafeInteger(Number(url.port)) && Number(url.port) > 0);
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  return Number(url.port);
}

async function boundedBody(stream, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > limit) throw new Error('provider capture body exceeds limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readProviderJson(endpoint, upstreamOrigin, fetchImpl) {
  const response = await fetchImpl(`${upstreamOrigin}${endpoint}`, {
    method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, `provider preflight ${endpoint} returned ${response.status}`);
  return response.json();
}

/** Pure provider/host preflight can be run against injected fake upstreams. */
export async function preflightProviderCapture({
  upstreamOrigin = CAPTURE_UPSTREAM,
  fetchImpl = globalThis.fetch,
  computeProcesses = () => execFileSync('nvidia-smi', [
    '--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader',
  ], { encoding: 'utf8', timeout: 5_000 }).trim(),
  memoryInfo = () => readFileSync('/proc/meminfo', 'utf8'),
  diskInfo = () => statfsSync(process.cwd()),
} = {}) {
  assertLoopbackOrigin(upstreamOrigin);
  const ps = await readProviderJson('/api/ps', upstreamOrigin, fetchImpl);
  assert.ok(Array.isArray(ps?.models), 'provider /api/ps models unavailable');
  const compute = computeProcesses().trim();
  const memory = /^MemAvailable:\s+(\d+) kB$/m.exec(memoryInfo());
  const disk = diskInfo();
  const readiness = assessScheduledEvaluationReadiness({
    residentModels: ps.models.map(item => item.name || item.model || 'unknown'),
    computeProcesses: compute ? compute.split('\n') : [],
    memoryAvailableBytes: memory ? Number(memory[1]) * 1024 : NaN,
    diskAvailableBytes: disk.bavail * disk.bsize,
  });
  assert.ok(readiness.ready, `provider capture blocked: ${readiness.reasons.join('; ')}`);
  const tags = await readProviderJson('/api/tags', upstreamOrigin, fetchImpl);
  assert.ok(Array.isArray(tags?.models), 'provider /api/tags models unavailable');
  const installed = tags.models.filter(item => (item.name || item.model) === CAPTURE_MODEL);
  assert.equal(installed.length, 1, 'pinned model must occur exactly once in provider inventory');
  assert.equal(installed[0].digest, CAPTURE_DIGEST, 'pinned model digest mismatch');
  const version = await readProviderJson('/api/version', upstreamOrigin, fetchImpl);
  assert.equal(typeof version?.version, 'string', 'provider version unavailable');
  return Object.freeze({ model: CAPTURE_MODEL, digest: CAPTURE_DIGEST, version: version.version,
    readiness: { ready: true, residentModels: 0, computeProcesses: 0 } });
}

function allowedRequest(method, url, body) {
  if (method === 'GET') {
    return ['/api/tags', '/api/ps', '/api/version'].includes(url) && body === null;
  }
  if (method !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (url === '/api/show') return (body.model || body.name) === CAPTURE_MODEL;
  if (url !== '/api/chat') return false;
  return body.model === CAPTURE_MODEL
    && body.stream === false
    && Array.isArray(body.messages)
    && Number.isSafeInteger(body.options?.num_ctx)
    && body.options.num_ctx >= 512 && body.options.num_ctx <= 4096
    && !Object.hasOwn(body, 'keep_alive');
}

function forward(upstreamPort, method, url, bytes) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port: upstreamPort, path: url, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length },
    }, async response => {
      try {
        const raw = await boundedBody(response, MAX_RESPONSE_BYTES);
        resolve({ status: response.statusCode, headers: response.headers, raw });
      } catch (error) { request.destroy(); reject(error); }
    });
    request.setTimeout(180_000, () => request.destroy(new Error('provider request timeout')));
    request.on('error', reject);
    request.end(bytes);
  });
}

/** Start a private loopback proxy; capture only completed /api/chat requests. */
export async function startProviderCaptureProxy({ captureFile, upstreamOrigin = CAPTURE_UPSTREAM } = {}) {
  assert.ok(path.isAbsolute(captureFile), 'capture file must be absolute');
  const upstreamPort = assertLoopbackOrigin(upstreamOrigin);
  const descriptor = openSync(captureFile, 'wx', 0o600);
  let failure = null;
  let captured = 0;
  let closed = false;
  const recordFailure = error => { failure ??= error?.message || String(error); };
  const append = row => {
    const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset);
    fsyncSync(descriptor);
    captured += 1;
  };
  const proxy = http.createServer(async (incoming, outgoing) => {
    let row = null;
    let rowRecorded = false;
    try {
      const bytes = await boundedBody(incoming, MAX_REQUEST_BYTES);
      const body = bytes.length ? JSON.parse(bytes.toString('utf8')) : null;
      if (!allowedRequest(incoming.method, incoming.url, body)) {
        throw new Error(`provider request outside pinned capture scope: ${incoming.method} ${incoming.url}`);
      }
      const isChat = incoming.method === 'POST' && incoming.url === '/api/chat';
      if (isChat) row = {
        schemaVersion: 1, at: new Date().toISOString(), path: incoming.url,
        method: incoming.method, model: body.model, numCtx: body.options.num_ctx,
        requestSha256: SHA256(bytes), messages: body.messages,
      };
      const result = await forward(upstreamPort, incoming.method, incoming.url, bytes);
      if (isChat) {
        let terminal = null;
        try { terminal = JSON.parse(result.raw.toString('utf8')); }
        catch { row.error = 'provider response is not terminal JSON'; recordFailure(row.error); }
        Object.assign(row, {
          status: result.status, responseSha256: SHA256(result.raw), terminal,
          promptEvalCount: Number.isSafeInteger(terminal?.prompt_eval_count) ? terminal.prompt_eval_count : null,
          done: terminal?.done ?? null, doneReason: terminal?.done_reason ?? null,
        });
        append(row); // Synchronous before the test can observe the HTTP response.
        rowRecorded = true;
        if (result.status === 200 && (terminal?.done !== true
          || !Number.isSafeInteger(terminal?.prompt_eval_count)
          || terminal.prompt_eval_count <= 0
          || terminal.model !== CAPTURE_MODEL
          || (terminal.digest && terminal.digest !== CAPTURE_DIGEST)
          || (terminal.model_digest_sha256 && terminal.model_digest_sha256 !== CAPTURE_DIGEST))) {
          recordFailure('provider terminal lacks exact model identity or positive prompt usage');
        }
      }
      outgoing.writeHead(result.status, result.headers);
      outgoing.end(result.raw);
    } catch (error) {
      recordFailure(error);
      if (row && !rowRecorded) {
        try { append({ ...row, status: 502, responseSha256: null, terminal: null,
          promptEvalCount: null, done: null, doneReason: null, error: error.message }); }
        catch (appendError) { recordFailure(appendError); }
      }
      if (!outgoing.headersSent) outgoing.writeHead(/outside pinned capture scope/.test(error.message) ? 403 : 502);
      outgoing.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) { closeSync(descriptor); throw error; }
  return Object.freeze({
    url: `http://127.0.0.1:${proxy.address().port}`,
    captureFile,
    getFailure: () => failure,
    getCapturedCount: () => captured,
    async close() {
      if (closed) return;
      closed = true;
      proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
      closeSync(descriptor);
    },
  });
}
