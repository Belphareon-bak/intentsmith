#!/usr/bin/env node

// Opt-in physical-model M1 translator journey. The private capture proxy
// persists the final provider request and terminal response before product
// success. This is a single-specialist acceptance probe, not a general one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { CAPTURE_DIGEST, CAPTURE_MODEL, preflightProviderCapture,
  startProviderCaptureProxy } from '../scripts/provider-capture.js';
import { createOwnedJourneyRuntime, expectJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { assertTranslatorDurabilityAndProject, assertTranslatorM1Result,
  assertTranslatorProviderRequest, clearTranslator, createTranslatorJourney,
  makeTranslatorCommand, selectTranslator,
  assertTranslatorSelectedSession } from './helpers/chat-translator-journey.js';

// Import after the shared lock module fixes the host's global lock path.
const { isolatedTestRuntime: runtime } = await import('./helpers/isolated-test-db.js');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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
  assert.equal(dirt, '', 'live evidence requires a clean committed checkout');
  return head;
}

function captureRows(file) {
  const bytes = readFileSync(file);
  assert(bytes.length > 0 && bytes.at(-1) === 10, 'provider capture must be complete JSONL');
  return bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
}

function assertCapturedTranslatorTurn(row, result) {
  assert.equal(row.schemaVersion, 1);
  assert.equal(row.method, 'POST');
  assert.equal(row.path, '/api/chat');
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
  assert.match(row.requestSha256, /^[a-f0-9]{64}$/);
  assert.match(row.responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(row.terminal?.message?.content, result.response.content,
    'M1 translation must equal the terminal provider bytes');
  assertTranslatorProviderRequest({ model: row.model, stream: row.stream,
    think: row.think, options: { num_ctx: row.numCtx,
      num_predict: row.numPredict }, messages: row.messages }, CAPTURE_MODEL);
}

test('LIVE_NOT_RUN until explicitly opted in: selected translator via captured local M1 model', {
  timeout: 20 * 60_000,
}, async () => {
  assert.equal(process.env.INTENTSMITH_CHAT_TRANSLATOR_LIVE, '1',
    'LIVE_NOT_RUN: set INTENTSMITH_CHAT_TRANSLATOR_LIVE=1 only after the GPU slot is free');
  if (runtime.mode === 'direct') {
    assert.equal(process.env.KEEP_TEST_RUNTIME, '1',
      'live artifacts require KEEP_TEST_RUNTIME=1 in a direct run');
  }
  const sourceRevision = exactSourceRevision();
  let lease = null;
  let proxy = null;
  let product = null;
  let preflight = null;
  let completed = null;
  let primaryError = null;
  const cleanupErrors = [];
  const captureFile = path.join(runtime.artifacts, 'chat-translator-live-provider.jsonl');
  try {
    lease = holdGpuEvaluationLock({ command: 'chat translator live M1' });
    preflight = await preflightProviderCapture();
    proxy = await startProviderCaptureProxy({ captureFile });
    const journeyRuntime = createOwnedJourneyRuntime(runtime);
    product = await startProduct(journeyRuntime, proxy.url, CAPTURE_MODEL);
    const journey = await createTranslatorJourney(product, journeyRuntime);
    await selectTranslator(product, journey.conversationId);
    const command = makeTranslatorCommand(journey.conversationId);
    const result = await expectJson(product, 'POST', '/api/chat', command, 200);
    assert.equal(proxy.getCapturedCount(), 1, 'exactly one generative provider call required');
    const row = captureRows(captureFile).at(-1);
    assertCapturedTranslatorTurn(row, result);
    assertTranslatorM1Result(result);
    await assertTranslatorSelectedSession(product, journey.conversationId);
    await clearTranslator(product, journey.conversationId, journey.projectId);
    const durable = await assertTranslatorDurabilityAndProject(product, journey,
      result.response.content);
    assert.equal(proxy.getCapturedCount(), 1,
      'specialist selection and clearing must not call the model');
    assert.equal(proxy.getFailure(), null);
    completed = { projectId: journey.projectId,
      conversationId: journey.conversationId,
      requestId: command.requestId,
      requestSha256: row.requestSha256,
      responseSha256: row.responseSha256,
      numCtx: row.numCtx,
      promptEvalCount: row.promptEvalCount,
      doneReason: row.doneReason,
      durableMessages: durable.messages,
      projectFiles: durable.files };
  } catch (error) {
    primaryError = error;
  } finally {
    if (product) {
      try { await stopProduct(product); } catch (error) { cleanupErrors.push(error); }
    }
    if (proxy) {
      try { await proxy.close(); } catch (error) { cleanupErrors.push(error); }
      if (proxy.getFailure()) {
        cleanupErrors.push(new Error(`Provider capture failed: ${proxy.getFailure()}`));
      }
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
  writeFileSync(path.join(runtime.artifacts, 'chat-translator-live-evidence.json'),
    `${JSON.stringify({ schemaVersion: 1, status: 'PASS', sourceRevision,
      specialist: 'translator', model: CAPTURE_MODEL,
      installedDigest: CAPTURE_DIGEST, providerVersion: preflight.version,
      captureBytes: captureBytes.length, captureSha256: sha256(captureBytes),
      ...completed,
      limits: 'One selected translator journey only; served digest may be absent, so installed digest is preflight-bound.'
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
