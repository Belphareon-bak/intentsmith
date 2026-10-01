#!/usr/bin/env node

// Opt-in physical Ollama M1 accountant journey. No model is touched until the
// exact-source check, shared GPU lease and pinned provider preflight succeed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import Database from 'better-sqlite3';

import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { CAPTURE_DIGEST, CAPTURE_MODEL, preflightProviderCapture,
  startProviderCaptureProxy } from '../scripts/provider-capture.js';
import { createOwnedJourneyRuntime, expectJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { assertVatCapturedTurn, VAT_INPUT } from
  './helpers/chat-accountant-vat-oracle.js';

// Import after the shared lock module fixes the host's global lock path.
const { isolatedTestRuntime: runtime } = await import('./helpers/isolated-test-db.js');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function exactSourceRevision() {
  const supplied = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  assert.match(supplied || '', /^[a-f0-9]{40}$/u, 'exact source revision required');
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
  const meta = statSync(file);
  assert(meta.isFile() && (meta.mode & 0o777) === 0o600,
    'provider capture must be a private regular file');
  const bytes = readFileSync(file);
  assert(bytes.length > 0 && bytes.at(-1) === 10, 'provider capture must be complete JSONL');
  return bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
}

async function accountantJourney(product) {
  const listed = await expectJson(product, 'GET', '/api/specialists', null, 200);
  assert(listed.specialists?.some(item => item.id === 'accountant-cz'),
    'accountant-cz must be installed and discoverable');
  const name = `accountant-vat-live-${randomBytes(5).toString('hex')}`;
  const project = await expectJson(product, 'POST', '/api/projects', {
    name, description: 'Owned VAT live test project',
  }, 201);
  const conversation = await expectJson(product, 'POST', '/api/conversations', {
    title: name, project_id: project.project.id, mode: 'chat',
  }, 201);
  const conversationId = conversation.conversation.id;
  const selected = await expectJson(product, 'POST', '/api/chat/specialist', {
    specialistId: 'accountant-cz', sessionId: conversationId,
  }, 200);
  assert.equal(selected.specialistId, 'accountant-cz');
  const command = { contract: 'ConversationCommand', version: 1,
    requestId: `accountant-live-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `accountant-live-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input: VAT_INPUT };
  const result = await expectJson(product, 'POST', '/api/chat', command, 200);
  const session = await expectJson(product, 'GET',
    `/api/chat/sessions/${conversationId}`, null, 200);
  assert.equal(session.state?.specialist?.id, 'accountant-cz');
  return { projectId: project.project.id, conversationId,
    requestId: command.requestId, result };
}

async function assertDurableAccountantTurn(product, databasePath, conversationId, answer) {
  const http = await expectJson(product, 'GET',
    `/api/conversations/${conversationId}/messages`, null, 200);
  const expected = [{ role: 'user', content: VAT_INPUT },
    { role: 'assistant', content: answer }];
  assert.deepEqual(http.messages?.map(({ role, content }) => ({ role, content })), expected,
    'M1 HTTP history differs from completed turn');
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  let sqlite;
  try {
    sqlite = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC')
      .all(conversationId);
  } finally { db.close(); }
  assert.deepEqual(sqlite, expected, 'durable SQLite history differs from M1 turn');
  return { httpMessages: http.messages.length, sqliteMessages: sqlite.length };
}

test('LIVE_NOT_RUN until opted in: selected accountant-cz VAT through captured Ollama M1', {
  timeout: 25 * 60_000,
}, async () => {
  assert.equal(process.env.INTENTSMITH_CHAT_ACCOUNTANT_LIVE, '1',
    'LIVE_NOT_RUN: set INTENTSMITH_CHAT_ACCOUNTANT_LIVE=1 only after GPU authorization');
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
  const captureFile = path.join(runtime.artifacts, 'chat-accountant-live-provider.jsonl');
  try {
    lease = holdGpuEvaluationLock({ command: 'chat accountant live M1' });
    preflight = await preflightProviderCapture();
    proxy = await startProviderCaptureProxy({ captureFile });
    const owned = createOwnedJourneyRuntime(runtime);
    product = await startProduct(owned, proxy.url, CAPTURE_MODEL);
    const journey = await accountantJourney(product);
    assert.equal(proxy.getCapturedCount(), 1, 'exactly one generative provider call required');
    const rows = captureRows(captureFile);
    assert.equal(rows.length, 1, 'one completed provider row required');
    const row = rows[0];
    const vat = assertVatCapturedTurn(row, journey.result,
      { model: CAPTURE_MODEL, digest: CAPTURE_DIGEST });
    const durable = await assertDurableAccountantTurn(product, owned.database,
      journey.conversationId, journey.result.response.content);
    assert.equal(proxy.getCapturedCount(), 1, 'history reads must not call provider');
    assert.equal(proxy.getFailure(), null);
    completed = { projectId: journey.projectId,
      conversationId: journey.conversationId, requestId: journey.requestId,
      requestSha256: row.requestSha256, responseSha256: row.responseSha256,
      numCtx: row.numCtx, numPredict: row.numPredict,
      promptEvalCount: row.promptEvalCount, doneReason: row.doneReason,
      vat, durable, finalAnswer: journey.result.response.content };
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
  assert.equal(captureRows(captureFile).length, 1,
    'closed provider capture must contain exactly one call');
  const captureBytes = readFileSync(captureFile);
  writeFileSync(path.join(runtime.artifacts, 'chat-accountant-live-evidence.json'),
    `${JSON.stringify({ schemaVersion: 1,
      status: 'AUTOMATED_CHECKS_PASS_REVIEW_PENDING', manualReviewStatus: 'PENDING',
      sourceRevision,
      specialist: 'accountant-cz', model: CAPTURE_MODEL,
      installedDigest: CAPTURE_DIGEST, providerVersion: preflight.version,
      captureBytes: captureBytes.length, captureSha256: sha256(captureBytes),
      ...completed,
      limits: 'One VAT input only; served digest may be absent, so installed digest is preflight-bound.',
    }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
