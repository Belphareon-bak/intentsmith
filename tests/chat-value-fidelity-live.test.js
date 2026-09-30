#!/usr/bin/env node

// Opt-in local-model value journey. It never contacts the provider until a
// clean source SHA, the shared GPU lease and pinned-model preflight succeed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { CAPTURE_DIGEST, CAPTURE_MODEL, preflightProviderCapture,
  startProviderCaptureProxy } from '../scripts/provider-capture.js';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { VALUE_CASES, assertDurableValueHistory, assertExactValueAnswer,
  assertFinalValueRequest, createValueConversation, isAnswerRequest,
  makeValueCommand } from './helpers/chat-value-fidelity-journey.js';

// Import after the shared lock module has fixed the host's global lock path.
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
  assert.equal(dirt, '', 'live model evidence requires a clean committed checkout');
  return head;
}

function captureRows(file) {
  const bytes = readFileSync(file);
  assert(bytes.length > 0 && bytes.at(-1) === 10, 'provider capture must be complete JSONL');
  return bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
}

function assertCapturedAnswer(row, response, valueCase) {
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
  assert.equal(row.numCtx, response.metadata?.answerBudget?.numCtx);
  assert.equal(row.numPredict, response.metadata?.answerBudget?.maxTokens);
  const providerText = row.terminal?.message?.content ?? row.terminal?.response;
  assert.equal(providerText, response.content,
    `${valueCase.label}: M1 response differs from the captured terminal answer`);
  const prompt = assertFinalValueRequest({ model: row.model, stream: false,
    messages: row.messages, options: { num_ctx: row.numCtx, num_predict: row.numPredict } },
  valueCase, CAPTURE_MODEL);
  return { providerText, promptSha256: createHash('sha256').update(prompt).digest('hex') };
}

test('LIVE_NOT_RUN until opted in: pinned CHAT model returns three exact signed values', {
  timeout: 20 * 60_000,
}, async () => {
  assert.equal(process.env.INTENTSMITH_CHAT_VALUE_FIDELITY_LIVE, '1',
    'LIVE_NOT_RUN: set INTENTSMITH_CHAT_VALUE_FIDELITY_LIVE=1 only when GPU is free');
  if (runtime.mode === 'direct') {
    assert.equal(process.env.KEEP_TEST_RUNTIME, '1',
      'live evidence requires KEEP_TEST_RUNTIME=1 in a direct run');
  }
  const sourceRevision = exactSourceRevision();
  const captureFile = path.join(runtime.artifacts, 'chat-value-fidelity-provider.jsonl');
  const evidenceFile = path.join(runtime.artifacts, 'chat-value-fidelity-live-evidence.json');
  let lease = null;
  let proxy = null;
  let product = null;
  let preflight = null;
  let completed = null;
  let primaryError = null;
  const cleanupErrors = [];
  const qualityFailures = [];
  try {
    lease = holdGpuEvaluationLock({ command: 'chat value fidelity live three signed cases' });
    preflight = await preflightProviderCapture();
    proxy = await startProviderCaptureProxy({ captureFile });
    const journeyRuntime = createOwnedJourneyRuntime(runtime);
    product = await startProduct(journeyRuntime, proxy.url, CAPTURE_MODEL);
    const conversationId = await createValueConversation(product);
    const answers = [];
    const turns = [];
    const requestIds = new Set();
    for (const valueCase of VALUE_CASES) {
      const command = makeValueCommand(conversationId, valueCase);
      assert(!requestIds.has(command.requestId)); requestIds.add(command.requestId);
      const before = proxy.getCapturedCount();
      const result = await expectJson(product, 'POST', '/api/chat', command, 200);
      assert.equal(result.status, 'ok');
      const newRows = captureRows(captureFile).slice(before);
      const answerRows = newRows.filter(row => isAnswerRequest({ messages: row.messages }, valueCase));
      assert.equal(answerRows.length, 1,
        `${valueCase.label}: expected exactly one completed ANSWER provider call`);
      const row = answerRows[0];
      const { providerText, promptSha256 } = assertCapturedAnswer(row, result.response, valueCase);
      let valueStatus = 'PASS';
      try { assertExactValueAnswer(providerText, valueCase); }
      catch (error) {
        valueStatus = 'FAIL';
        qualityFailures.push(`${valueCase.label}: ${error.message}`);
      }
      answers.push(result.response.content);
      turns.push({ label: valueCase.label, expected: valueCase.expected,
        answer: providerText, valueStatus, requestId: command.requestId,
        providerCalls: newRows.length, requestSha256: row.requestSha256,
        responseSha256: row.responseSha256, promptSha256,
        numCtx: row.numCtx, numPredict: row.numPredict,
        promptEvalCount: row.promptEvalCount, doneReason: row.doneReason });
    }
    assert.equal(requestIds.size, VALUE_CASES.length);
    assert.equal(proxy.getFailure(), null, 'provider capture reported a failure');
    const durable = await assertDurableValueHistory(product, journeyRuntime.database, conversationId, answers);
    completed = { conversationId, turns, durable };
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
      try { assert.equal(lease.release(), true, 'GPU lease ownership changed during cleanup'); }
      catch (error) { cleanupErrors.push(error); }
    }
  }
  if (proxy && existsSync(captureFile)) {
    const bytes = readFileSync(captureFile);
    writeFileSync(evidenceFile, `${JSON.stringify({ schemaVersion: 1,
      status: primaryError || cleanupErrors.length || qualityFailures.length ? 'FAIL' : 'PASS',
      sourceRevision, model: CAPTURE_MODEL, installedDigest: CAPTURE_DIGEST,
      providerVersion: preflight?.version ?? null,
      captureBytes: bytes.length,
      captureSha256: createHash('sha256').update(bytes).digest('hex'),
      ...completed,
      qualityFailures,
      ...(primaryError ? { executionError: primaryError.message } : {}),
      cleanupErrors: cleanupErrors.map(error => error.message),
      limits: 'Installed digest is pinned at preflight; a terminal without digest does not independently attest served bytes.'
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (primaryError) {
    if (cleanupErrors.length) primaryError.cause = new AggregateError(cleanupErrors, 'cleanup also failed');
    throw primaryError;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'live journey cleanup failed');
  assert.deepEqual(qualityFailures, [], 'physical CHAT value fidelity failed');
});
