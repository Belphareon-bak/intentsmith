#!/usr/bin/env node

// Opt-in physical-model acceptance: two real context-window fills, a product
// restart on the same SQLite DB, recursive compaction and A/B project isolation.
// The deterministic HTTP/SQLite regression is chat-second-compaction-http;
// this run measures physical provider and answer quality on one exact SHA.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import Database from 'better-sqlite3';

import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { CAPTURE_DIGEST, CAPTURE_MODEL, preflightProviderCapture,
  startProviderCaptureProxy } from '../scripts/provider-capture.js';
import { attestSecondWindowEvidence, providerPromptText } from '../scripts/chat-second-window-evidence.js';
import { FIRST_CODE, SECOND_CODE, FINAL_QUESTION, secondWindowCase,
  secondWindowMessage, secondWindowSemanticQuality } from '../scripts/chat-second-window-values.js';
import { assertExactValueAnswer } from './helpers/chat-value-fidelity-journey.js';
import { createOwnedJourneyRuntime, expectJson, JOURNEY, makeM1Command,
  prepareJourney, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';

// Keep the shared GPU lock import before the private test runtime bootstrap.
const { isolatedTestRuntime: runtime } = await import('./helpers/isolated-test-db.js');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const modelText = row => [row.terminal?.message?.content, row.terminal?.response]
  .find(value => typeof value === 'string' && value.trim());
const providerReply = row => {
  const raw = modelText(row);
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.reply === 'string') return parsed.reply;
  } catch { /* normal plain CHAT answer */ }
  return raw;
};

function sourceRevision() {
  const supplied = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  assert.match(supplied || '', /^[a-f0-9]{40}$/u, 'exact clean source SHA required');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(supplied, head, 'test source SHA differs from checkout HEAD');
  const dirt = execFileSync('git', ['status', '--porcelain'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(dirt, '', 'physical evidence requires a clean committed checkout');
  return head;
}

function captureRows(file) {
  const bytes = readFileSync(file);
  if (bytes.length === 0) return [];
  assert.equal(bytes.at(-1), 10, 'provider capture has an incomplete JSONL row');
  return bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
}

function indexedMatches(rows, before, predicate) {
  return rows.flatMap((row, captureIndex) =>
    captureIndex >= before && predicate(row) ? [{ ...row, captureIndex }] : []);
}

function capturedResponse(rows, before, question, answer, label) {
  const candidates = indexedMatches(rows, before, row => row.path === '/api/chat'
    && row.status === 200 && row.done === true && row.doneReason === 'stop'
    && providerPromptText(row).includes(question) && providerReply(row) === answer);
  assert.equal(candidates.length, 1,
    `${label}: HTTP answer lacks one exact completed physical provider source`);
  const row = candidates[0];
  assert.equal(row.model, CAPTURE_MODEL);
  assert.equal(row.numCtx, 4096);
  assert(Number.isSafeInteger(row.promptEvalCount) && row.promptEvalCount > 0);
  return row;
}

function projectReply(row) {
  try { return JSON.parse(modelText(row))?.reply; }
  catch { return null; }
}

async function projectBChat(product, proxy, captureFile, journeyRuntime, fixtureB, label,
  previousMessages = null) {
  const question = `Jaký stav má projekt podle ${fixtureB.file}? Uveď přesný projektový kód.`;
  const before = proxy.getCapturedCount();
  const response = await expectJson(product, 'POST', '/api/chat',
    makeM1Command(fixtureB.conversationId, label, question), 200);
  assert.equal(response.status, 'ok');
  const candidates = indexedMatches(captureRows(captureFile), before, row =>
    row.status === 200 && row.done === true && row.doneReason === 'stop'
      && providerPromptText(row).includes(question)
      && projectReply(row) === response.response?.content);
  assert.equal(candidates.length, 1, `${label}: project B answer lacks one provider source`);
  const row = candidates[0];
  assert(providerPromptText(row).includes(fixtureB.canary), `${label}: own project B file absent`);
  assert(!providerPromptText(row).includes(FIRST_CODE) && !providerPromptText(row).includes(SECOND_CODE),
    `${label}: project A anchor leaked to project B`);
  assert(response.response.content.includes(fixtureB.canary),
    `${label}: physical model did not return project B file code`);
  for (const foreign of [FIRST_CODE, SECOND_CODE, JOURNEY.a.file,
    JOURNEY.a.canary, JOURNEY.a.rule]) {
    assert(!response.response.content.includes(foreign),
      `${label}: project A data leaked into project B answer: ${foreign}`);
  }
  const state = await snapshot(product, journeyRuntime, fixtureB.conversationId);
  if (previousMessages) {
    assert.deepEqual(state.messages.slice(0, previousMessages.length), previousMessages,
      `${label}: project B history changed between turns`);
    assert.equal(state.messages.length, previousMessages.length + 2,
      `${label}: project B did not persist a new user/assistant pair`);
  } else {
    assert.equal(state.messages.length, 2,
      `${label}: new project B conversation contains unreceipted initial messages`);
  }
  const persistence = durableTurnReceipt(state, question, response.response.content, label);
  return { captureIndex: row.captureIndex,
    requestSha256: row.requestSha256, responseSha256: row.responseSha256,
    question, answer: response.response.content, persistence, messages: state.messages };
}

function sqliteSnapshot(database, conversationId) {
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    return {
      conversation: db.prepare('SELECT id, project_id, summary, summary_up_to_msg_id FROM conversations WHERE id = ?')
        .get(conversationId),
      messages: db.prepare('SELECT id, role, content, tokens FROM messages WHERE conversation_id = ? ORDER BY id')
        .all(conversationId),
    };
  } finally { db.close(); }
}

async function snapshot(product, journeyRuntime, conversationId) {
  const route = `/api/conversations/${encodeURIComponent(conversationId)}`;
  const deadline = Date.now() + 5_000;
  let dbState;
  do {
    const [httpConv, httpMessages] = await Promise.all([
      expectJson(product, 'GET', route, null, 200),
      expectJson(product, 'GET', `${route}/messages`, null, 200),
    ]);
    dbState = sqliteSnapshot(journeyRuntime.database, conversationId);
    const httpTurns = httpMessages.messages?.map(({ id, role, content, tokens }) =>
      ({ id, role, content, tokens }));
    if (httpConv.conversation?.id === dbState.conversation?.id
      && httpConv.conversation.summary === dbState.conversation.summary
      && httpConv.conversation.summary_up_to_msg_id === dbState.conversation.summary_up_to_msg_id
      && JSON.stringify(httpTurns) === JSON.stringify(dbState.messages)) {
      return { ...dbState, httpMessages: httpTurns };
    }
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error(`HTTP/SQLite snapshot did not converge for ${conversationId}`);
}

function durableTurnReceipt(state, question, answer, label) {
  const pair = messages => {
    assert(Array.isArray(messages) && messages.length >= 2,
      `${label}: durable turn missing`);
    const [user, assistant] = messages.slice(-2);
    assert.equal(user.role, 'user', `${label}: last persisted pair lacks user turn`);
    assert.equal(assistant.role, 'assistant', `${label}: last persisted pair lacks assistant turn`);
    assert.equal(user.content, question, `${label}: persisted user differs from POST input`);
    assert.equal(assistant.content, answer, `${label}: persisted assistant differs from POST answer`);
    assert(Number.isSafeInteger(user.id) && user.id > 0
      && Number.isSafeInteger(assistant.id) && assistant.id > user.id,
    `${label}: persisted turn IDs are not ordered`);
    return { user, assistant };
  };
  const http = pair(state.httpMessages);
  const sqlite = pair(state.messages);
  assert.deepEqual(http, sqlite, `${label}: GET/SQLite persisted turn differs`);
  return { http, sqlite, messageCount: state.messages.length };
}

function rawTokens(messages, fromId = 0) {
  return messages.filter(message => message.id >= fromId)
    .reduce((sum, message) => sum + Number(message.tokens || 0), 0);
}

async function longTurn(product, proxy, captureFile, fixtureA, stage, turn, evidence) {
  const question = secondWindowMessage(stage, turn);
  const before = proxy.getCapturedCount();
  const response = await expectJson(product, 'POST', '/api/chat', {
    conversation_id: fixtureA.conversationId, project_id: fixtureA.id,
    message: question,
  }, 200);
  assert.equal(typeof response.response, 'string');
  const row = capturedResponse(captureRows(captureFile), before, question,
    response.response, `${stage}.${turn}`);
  const valueCase = secondWindowCase(stage, turn);
  let qualityError = null;
  try { assertExactValueAnswer(response.response, { label: `${stage}.${turn}`,
    expected: valueCase.expected }); }
  catch (error) { qualityError = String(error?.message || error); }
  const state = await snapshot(product, evidence.journeyRuntime, fixtureA.conversationId);
  if (stage === 1 && turn === 1) assert.equal(state.messages.length, 2,
    'new project A conversation contains unreceipted initial messages');
  const persistence = durableTurnReceipt(state, question, response.response, `${stage}.${turn}`);
  evidence.turns.push({ stage, turn, question, expected: valueCase.expected,
    answer: response.response, qualityStatus: qualityError ? 'FAIL' : 'PASS', qualityError,
    persistence, captureIndex: row.captureIndex,
    requestSha256: row.requestSha256, responseSha256: row.responseSha256,
    numCtx: row.numCtx, numPredict: row.numPredict, promptEvalCount: row.promptEvalCount });
  return state;
}

function matchingSummary(rows, storedText, requiredCode) {
  const matches = indexedMatches(rows, 0, row => row.path === '/api/chat' && row.status === 200
    && row.done === true && row.doneReason === 'stop'
    && row.messages.at(-1)?.role === 'user'
    && String(row.messages.at(-1)?.content || '').endsWith('\nSouhrn:')
    && typeof modelText(row) === 'string'
    && storedText.startsWith(modelText(row).trim())
    && storedText.includes(requiredCode));
  assert.equal(matches.length, 1, 'durable summary lacks one exact physical provider source');
  return matches[0];
}

function assertSummaryCaptureChronology(summary, turns, anchorUserId, label) {
  const anchor = turns.find(turn => turn.persistence?.sqlite?.user?.id === anchorUserId);
  assert(anchor && anchor.captureIndex < summary.captureIndex,
    `${label}: user anchor provider answer did not precede summary capture`);
  for (const turn of turns) {
    if (turn.persistence.sqlite.assistant.id <= summary.upToMsgId) {
      assert(turn.captureIndex < summary.captureIndex,
        `${label}: summary capture preceded a covered assistant answer`);
    }
  }
}

async function waitForSummary(product, journeyRuntime, conversationId, afterId, coveredId) {
  const deadline = Date.now() + 90_000;
  let state;
  do {
    state = await snapshot(product, journeyRuntime, conversationId);
    if (typeof state.conversation.summary === 'string'
      && Number(state.conversation.summary_up_to_msg_id) > afterId
      && Number(state.conversation.summary_up_to_msg_id) >= coveredId) return state;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`No durable summary covering message ${coveredId} after ${afterId}`);
}

async function stopVerifiedProduct(product, phase) {
  assert(product?.child, `${phase}: owned product process missing`);
  assert.equal(product.code, null, `${phase}: product exited before planned shutdown`);
  assert.equal(product.signal, null, `${phase}: product received a signal before planned shutdown`);
  await stopProduct(product);
  assert.equal(product.code, 0, `${phase}: product did not exit cleanly`);
  assert.equal(product.signal, null, `${phase}: product required a terminating signal`);
}

test('physical second window: two compactions, restart, A/B isolation and anchor recall', {
  timeout: 65 * 60_000,
}, async () => {
  assert.equal(process.env.INTENTSMITH_CHAT_SECOND_WINDOW_LIVE, '1',
    'LIVE_NOT_RUN: set INTENTSMITH_CHAT_SECOND_WINDOW_LIVE=1 after the GPU slot is free');
  if (runtime.mode === 'direct') assert.equal(process.env.KEEP_TEST_RUNTIME, '1',
    'KEEP_TEST_RUNTIME=1 is required for direct physical evidence');
  const revision = sourceRevision();
  const captureFile = path.join(runtime.artifacts, 'chat-second-window-provider.jsonl');
  const evidenceFile = path.join(runtime.artifacts, 'chat-second-window-live-evidence.json');
  const evidence = { schemaVersion: 1, sourceRevision: revision, physicalProvider: true,
    model: CAPTURE_MODEL, installedDigest: CAPTURE_DIGEST,
    status: 'FAIL', mechanismStatus: 'FAIL', turns: [] };
  let lease = null;
  let proxy = null;
  let product = null;
  let primaryError = null;
  const cleanupErrors = [];
  try {
    lease = holdGpuEvaluationLock({ command: 'chat physical second-window restart' });
    const preflight = await preflightProviderCapture();
    evidence.providerVersion = preflight.version;
    proxy = await startProviderCaptureProxy({ captureFile });
    const journeyRuntime = createOwnedJourneyRuntime(runtime);
    evidence.journeyRuntime = journeyRuntime;
    product = await startProduct(journeyRuntime, proxy.url, CAPTURE_MODEL);
    const { a, b } = await prepareJourney(product, journeyRuntime);
    evidence.projects = { a: { id: a.id, file: a.file, canary: a.canary, rule: a.rule },
      b: { id: b.id, file: b.file, canary: b.canary, rule: b.rule } };
    evidence.projectB = { before: await projectBChat(product, proxy, captureFile,
      journeyRuntime, b, 'before-restart') };
    let state;
    let firstUser;
    for (let turn = 1; turn <= 8; turn += 1) {
      state = await longTurn(product, proxy, captureFile, a, 1, turn, evidence);
      if (turn === 1) firstUser = state.messages.find(message => message.role === 'user'
        && message.content === secondWindowMessage(1, 1));
      if (rawTokens(state.messages) >= 4096 && state.conversation.summary) break;
    }
    assert(firstUser?.id > 0, 'first user anchor missing from SQLite');
    state = await waitForSummary(product, journeyRuntime, a.conversationId, 0, firstUser.id);
    assert(rawTokens(state.messages) >= 4096, 'first raw history did not fill num_ctx');
    const firstRow = matchingSummary(captureRows(captureFile), state.conversation.summary, FIRST_CODE);
    evidence.first = { firstUserId: firstUser.id,
      upToMsgId: Number(state.conversation.summary_up_to_msg_id),
      rawTokens: rawTokens(state.messages), messages: state.messages,
      text: state.conversation.summary, captureIndex: firstRow.captureIndex,
      requestSha256: firstRow.requestSha256, responseSha256: firstRow.responseSha256 };
    assertSummaryCaptureChronology(evidence.first, evidence.turns, firstUser.id, 'first summary');
    const beforePid = product.child.pid;
    await stopVerifiedProduct(product, 'restart');
    product = null;
    product = await startProduct(journeyRuntime, proxy.url, CAPTURE_MODEL);
    state = await snapshot(product, journeyRuntime, a.conversationId);
    assert(state.messages.some(message => message.id === firstUser.id
      && message.content === secondWindowMessage(1, 1)),
    'restart lost the original raw user turn');
    evidence.restart = { beforePid, afterPid: product.child.pid,
      firstSummary: state.conversation.summary,
      firstUpToMsgId: Number(state.conversation.summary_up_to_msg_id),
      rawFirstUserRetained: true, messages: state.messages };
    assert.equal(evidence.restart.firstSummary, evidence.first.text);
    assert.equal(evidence.restart.firstUpToMsgId, evidence.first.upToMsgId);
    evidence.projectB.afterRestart = await projectBChat(product, proxy, captureFile,
      journeyRuntime, b, 'after-restart', evidence.projectB.before.messages);
    let secondUser;
    for (let turn = 1; turn <= 12; turn += 1) {
      state = await longTurn(product, proxy, captureFile, a, 2, turn, evidence);
      if (turn === 1) secondUser = state.messages.find(message => message.role === 'user'
        && message.content === secondWindowMessage(2, 1));
      const covered = secondUser && Number(state.conversation.summary_up_to_msg_id) >= secondUser.id;
      if (covered && rawTokens(state.messages, secondUser.id) >= 4096) break;
    }
    assert(secondUser?.id > firstUser.id, 'post-restart user anchor missing from SQLite');
    state = await waitForSummary(product, journeyRuntime, a.conversationId,
      evidence.first.upToMsgId, secondUser.id);
    const secondRawTokens = rawTokens(state.messages, secondUser.id);
    assert(secondRawTokens >= 4096, 'post-restart history did not fill num_ctx');
    const secondRow = matchingSummary(captureRows(captureFile), state.conversation.summary, SECOND_CODE);
    evidence.second = { secondUserId: secondUser.id,
      upToMsgId: Number(state.conversation.summary_up_to_msg_id),
      postRestartRawTokens: secondRawTokens, messages: state.messages,
      text: state.conversation.summary, captureIndex: secondRow.captureIndex,
      requestSha256: secondRow.requestSha256, responseSha256: secondRow.responseSha256 };
    assert(evidence.first.captureIndex < evidence.second.captureIndex,
      'recursive summary capture preceded its source summary');
    assertSummaryCaptureChronology(evidence.second, evidence.turns, secondUser.id, 'second summary');
    assert(state.messages.some(message => message.id === firstUser.id
      && message.content === secondWindowMessage(1, 1)),
    'second compaction deleted the original raw user turn');
    evidence.projectB.afterSecond = await projectBChat(product, proxy, captureFile,
      journeyRuntime, b, 'after-second-summary', evidence.projectB.afterRestart.messages);
    const beforeRecall = proxy.getCapturedCount();
    const recall = await expectJson(product, 'POST', '/api/chat', {
      conversation_id: a.conversationId, project_id: a.id,
      message: FINAL_QUESTION,
    }, 200);
    assert.equal(typeof recall.response, 'string');
    const finalRow = capturedResponse(captureRows(captureFile), beforeRecall,
      FINAL_QUESTION, recall.response, 'final recall');
    const finalState = await snapshot(product, journeyRuntime, a.conversationId);
    const persistence = durableTurnReceipt(finalState, FINAL_QUESTION, recall.response,
      'final recall');
    evidence.final = { question: FINAL_QUESTION, answer: recall.response,
      persistence, messages: finalState.messages, captureIndex: finalRow.captureIndex,
      requestSha256: finalRow.requestSha256, responseSha256: finalRow.responseSha256,
      numCtx: finalRow.numCtx, promptEvalCount: finalRow.promptEvalCount };
    evidence.semanticQuality = secondWindowSemanticQuality(evidence.turns, recall.response,
      [evidence.first.text, evidence.second.text]);
    evidence.mechanismStatus = 'PASS';
    evidence.status = evidence.semanticQuality.status;
  } catch (error) {
    primaryError = error;
    evidence.error = String(error?.stack || error);
  } finally {
    delete evidence.journeyRuntime;
    if (product) try { await stopVerifiedProduct(product, 'final cleanup'); }
    catch (error) { cleanupErrors.push(error); }
    if (proxy) {
      try { await proxy.close(); } catch (error) { cleanupErrors.push(error); }
      if (proxy.getFailure()) cleanupErrors.push(new Error(proxy.getFailure()));
    }
    if (lease) {
      try { assert.equal(lease.release(), true, 'GPU lease ownership changed'); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      evidence.status = 'FAIL';
      evidence.cleanupErrors = cleanupErrors.map(error => String(error?.message || error));
    }
    if (proxy) {
      const bytes = readFileSync(captureFile);
      evidence.captureBytes = bytes.length;
      evidence.captureSha256 = sha256(bytes);
    }
    writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 });
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'physical journey cleanup failed');
  assert.equal(evidence.mechanismStatus, 'PASS');
  assert.equal(evidence.semanticQuality.status, 'PASS',
    `physical model semantic quality ${JSON.stringify(evidence.semanticQuality)}`);
  const receipt = attestSecondWindowEvidence({ captureFile, evidenceFile, sourceRevision: revision });
  assert.equal(receipt.secondUpToMsgId > receipt.firstUpToMsgId, true);
});
