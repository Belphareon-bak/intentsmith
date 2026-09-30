#!/usr/bin/env node

// Opt-in physical-model journey. Never run this while another GPU/Ollama owner
// is active. The loopback proxy records the exact terminal provider request
// before the product receives the answer; the suite never talks to Ollama.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { CAPTURE_DIGEST, CAPTURE_MODEL, preflightProviderCapture,
  startProviderCaptureProxy } from '../scripts/provider-capture.js';
import { assertDurableJourney, assertFinalTurn, createOwnedJourneyRuntime, expectJson, journeySteps,
  makeM1Command, prepareJourney, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';

// Import after the shared lock module has fixed the host's global /tmp lock.
const { isolatedTestRuntime: runtime } = await import('./helpers/isolated-test-db.js');

function exactSourceRevision() {
  const supplied = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  assert.match(supplied || '', /^[a-f0-9]{40}$/, 'exact source revision required');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(supplied, head, 'source revision must equal this checkout HEAD');
  const dirt = execFileSync('git', ['status', '--porcelain'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(dirt, '', 'live provider evidence requires a clean committed checkout');
  return head;
}

function captureRows(file) {
  const bytes = readFileSync(file);
  assert(bytes.length > 0 && bytes.at(-1) === 10, 'provider capture must be complete JSONL');
  return bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
}

function assertCapturedProviderTurn(row, result, step) {
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.path, '/api/chat');
  assert.equal(row.method, 'POST');
  assert.equal(row.status, 200);
  assert.equal(row.model, CAPTURE_MODEL);
  assert.equal(row.terminal?.model, CAPTURE_MODEL);
  if (row.terminal?.digest) assert.equal(row.terminal.digest, CAPTURE_DIGEST);
  if (row.terminal?.model_digest_sha256) {
    assert.equal(row.terminal.model_digest_sha256, CAPTURE_DIGEST);
  }
  assert.equal(row.done, true);
  assert.equal(row.doneReason, 'stop');
  assert(Number.isSafeInteger(row.promptEvalCount) && row.promptEvalCount > 0);
  assert(Number.isSafeInteger(row.numCtx) && row.numCtx >= 512 && row.numCtx <= 4096);
  assert.match(row.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(row.responseSha256, /^[a-f0-9]{64}$/);
  const content = row.terminal.message?.content;
  assert.equal(typeof content, 'string');
  assert.equal(JSON.parse(content).reply, result.response.content,
    `${step.label}: M1 reply must come from the captured final provider result`);
  assertFinalTurn({ model: row.model, stream: false, messages: row.messages,
    options: { num_ctx: row.numCtx } }, result, step);
}

test('LIVE_NOT_RUN until explicitly opted in: A→B→A M1 with captured local model', {
  timeout: 20 * 60_000,
}, async () => {
  assert.equal(process.env.INTENTSMITH_CHAT_EXPERTISE_LIVE, '1',
    'LIVE_NOT_RUN: set INTENTSMITH_CHAT_EXPERTISE_LIVE=1 only after the GPU slot is free');
  if (runtime.mode === 'direct') {
    assert.equal(process.env.KEEP_TEST_RUNTIME, '1',
      'live artifacts require KEEP_TEST_RUNTIME=1 in a direct test run');
  }
  const sourceRevision = exactSourceRevision();
  let lease = null;
  let proxy = null;
  let product = null;
  let preflight = null;
  let completed = null;
  let primaryError = null;
  const cleanupErrors = [];
  const captureFile = path.join(runtime.artifacts, 'chat-project-expertise-live-provider.jsonl');
  try {
    lease = holdGpuEvaluationLock({ command: 'chat project expertise live M1 A-B-A' });
    preflight = await preflightProviderCapture();
    proxy = await startProviderCaptureProxy({ captureFile });
    const journeyRuntime = createOwnedJourneyRuntime(runtime);
    product = await startProduct(journeyRuntime, proxy.url, CAPTURE_MODEL);
    const { a, b } = await prepareJourney(product, journeyRuntime);
    const steps = journeySteps(a, b);
    const requestIds = new Set();
    const turnEvidence = [];
    for (const step of steps) {
      const command = makeM1Command(step.own.conversationId, step.label, step.input);
      assert(!requestIds.has(command.requestId)); requestIds.add(command.requestId);
      const before = proxy.getCapturedCount();
      const result = await expectJson(product, 'POST', '/api/chat', command, 200);
      assert.equal(proxy.getCapturedCount(), before + 1,
        `${step.label}: exactly one completed provider call is required`);
      const row = captureRows(captureFile).at(-1);
      assertCapturedProviderTurn(row, result, step);
      turnEvidence.push({ label: step.label, projectId: step.own.id,
        conversationId: step.own.conversationId, requestId: command.requestId,
        sourceSha256: step.own.sourceSha256, requestSha256: row.requestSha256,
        responseSha256: row.responseSha256, numCtx: row.numCtx,
        promptEvalCount: row.promptEvalCount, doneReason: row.doneReason });
    }
    assert.equal(requestIds.size, 3);
    assert.equal(proxy.getCapturedCount(), 3);
    assert.equal(proxy.getFailure(), null);
    await assertDurableJourney(product, a, b);
    completed = { projectIds: [a.id, b.id], turns: turnEvidence };
  } catch (error) {
    primaryError = error;
  } finally {
    if (product) {
      try { await stopProduct(product); } catch (error) { cleanupErrors.push(error); }
    }
    if (proxy) {
      try { await proxy.close(); } catch (error) { cleanupErrors.push(error); }
      if (proxy.getFailure()) cleanupErrors.push(new Error(`Provider capture failed: ${proxy.getFailure()}`));
    }
    if (lease) {
      try {
        assert.equal(lease.release(), true, 'GPU lease ownership changed during cleanup');
      } catch (error) { cleanupErrors.push(error); }
    }
  }
  if (primaryError) {
    if (cleanupErrors.length) primaryError.cause = new AggregateError(cleanupErrors, 'cleanup also failed');
    throw primaryError;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'live journey cleanup failed');
  const captureBytes = readFileSync(captureFile);
  writeFileSync(path.join(runtime.artifacts, 'chat-project-expertise-live-evidence.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'PASS', sourceRevision,
      model: CAPTURE_MODEL, installedDigest: CAPTURE_DIGEST,
      providerVersion: preflight.version,
      captureBytes: captureBytes.length,
      captureSha256: createHash('sha256').update(captureBytes).digest('hex'),
      ...completed,
      limits: 'Provider terminal may omit a served digest; preflight binds the installed digest.'
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
