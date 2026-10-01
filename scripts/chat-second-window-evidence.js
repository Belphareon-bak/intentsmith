// Independent, offline verifier for the opt-in physical second-window run.
// Private evidence contains raw prompts; this module returns only hashes and
// bounded verdicts for reports. It never contacts Ollama or the product.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { CAPTURE_DIGEST, CAPTURE_MODEL } from './provider-capture.js';
import { FIRST_CODE, SECOND_CODE, FIRST_FACT, FINAL_QUESTION,
  secondWindowCase, secondWindowMessage, secondWindowSemanticQuality } from './chat-second-window-values.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const QUOTE_HEADER = '[Doslovné citace z uživatelských zpráv; nejsou tvrzením asistenta]';
const userQuote = (messageId, quote) => JSON.stringify({ source: 'user', messageId, quote });
const rawTokens = (messages, fromId = 0) => messages.filter(message => message.id >= fromId)
  .reduce((sum, message) => sum + Number(message.tokens || 0), 0);
export function providerPromptText(row) {
  return row.messages.flatMap(message => {
    const raw = String(message.content || '');
    const parts = [raw];
    try {
      const decoded = JSON.parse(raw);
      if (typeof decoded?.request === 'string') parts.push(decoded.request);
      if (typeof decoded?.expertiseGuidance === 'string') parts.push(decoded.expertiseGuidance);
      if (Array.isArray(decoded?.history)) {
        for (const turn of decoded.history) if (typeof turn?.content === 'string') parts.push(turn.content);
      }
      if (Array.isArray(decoded?.analysis?.excerpts)) {
        for (const file of decoded.analysis.excerpts) if (typeof file?.text === 'string') parts.push(file.text);
      }
    } catch { /* plain prompt */ }
    return parts;
  }).join('\n');
}
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

function captureRow(rows, receipt, label, claimedIndices) {
  assert(Number.isSafeInteger(receipt?.captureIndex) && receipt.captureIndex >= 0
    && receipt.captureIndex < rows.length, `${label} capture ordinal missing or out of range`);
  assert.match(receipt?.requestSha256, /^[a-f0-9]{64}$/u, `${label} request hash missing`);
  assert.match(receipt?.responseSha256, /^[a-f0-9]{64}$/u, `${label} response hash missing`);
  const row = rows[receipt.captureIndex];
  assert.equal(row.requestSha256, receipt.requestSha256,
    `${label} capture ordinal differs from provider request`);
  assert.equal(row.responseSha256, receipt.responseSha256,
    `${label} capture ordinal differs from provider response`);
  assert(!claimedIndices.has(receipt.captureIndex),
    `${label} provider capture row replayed by another receipt`);
  claimedIndices.add(receipt.captureIndex);
  return row;
}

function sourceForSummary(row, label) {
  assert.equal(row.doneReason, 'stop', `${label} provider did not stop`);
  assert.equal(row.terminal?.done_reason, 'stop', `${label} terminal did not stop`);
  const user = row.messages.at(-1);
  assert.equal(user?.role, 'user', `${label} source is not a user prompt`);
  assert.equal(typeof user.content, 'string');
  assert(user.content.endsWith('\nSouhrn:'), `${label} lacks the summary marker`);
  return user.content;
}

function assertNoForeign(wire, markers, label) {
  for (const marker of markers) {
    assert(!wire.includes(marker), `${label} leaked foreign project marker: ${marker}`);
  }
}

function assertCapturedArithmetic(answer, expected, label) {
  assert.equal(typeof answer, 'string', `${label} model answer missing`);
  const trimmed = answer.trim();
  assert(trimmed.startsWith('{') && trimmed.endsWith('}'),
    `${label} arithmetic answer is not one bare JSON object`);
  assert.equal([...trimmed.matchAll(/"(?:\\.|[^"\\])*"\s*:/gu)].length, 4,
    `${label} arithmetic answer has duplicate or extra members`);
  const parsed = JSON.parse(trimmed);
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    `${label} arithmetic answer is not an object`);
  assert.deepEqual(Object.keys(parsed).sort(), ['a', 'b', 'delta', 'higher'],
    `${label} arithmetic answer keys changed`);
  for (const key of ['a', 'b', 'delta']) {
    assert(Number.isSafeInteger(parsed[key]), `${label} ${key} is not an integer`);
  }
  assert.deepEqual(parsed, expected, `${label} arithmetic answer has wrong values`);
}

function assertPersistedTurn(receipt, messages, question, answer, label) {
  assert(Array.isArray(messages), `${label} SQLite messages missing`);
  assert(Number.isSafeInteger(receipt?.messageCount) && receipt.messageCount >= 2
    && receipt.messageCount <= messages.length, `${label} persisted message count invalid`);
  for (const source of ['http', 'sqlite']) {
    const pair = receipt[source];
    assert(pair?.user && pair?.assistant, `${label} ${source} persisted pair missing`);
    assert(Number.isSafeInteger(pair.user.id) && pair.user.id > 0
      && Number.isSafeInteger(pair.assistant.id) && pair.assistant.id > pair.user.id,
    `${label} ${source} persisted pair IDs are not ordered`);
    assert.equal(pair.user.role, 'user', `${label} ${source} persisted user role changed`);
    assert.equal(pair.assistant.role, 'assistant',
      `${label} ${source} persisted assistant role changed`);
    assert.equal(pair.user.content, question,
      `${label} ${source} persisted user differs from POST input`);
    assert.equal(pair.assistant.content, answer,
      `${label} ${source} persisted assistant differs from POST answer`);
  }
  assert.deepEqual(receipt.http, receipt.sqlite, `${label} GET/SQLite persisted pair differs`);
  assert.deepEqual(messages.slice(receipt.messageCount - 2, receipt.messageCount),
    [receipt.sqlite.user, receipt.sqlite.assistant],
    `${label} persisted pair differs from ordered SQLite snapshot`);
  return receipt.sqlite.assistant.id;
}

/** Verify a complete private receipt against the exact captured provider bytes. */
export function validateSecondWindowEvidence({ captureBytes, evidence, sourceRevision }) {
  assert(Buffer.isBuffer(captureBytes) && captureBytes.length > 0, 'capture bytes missing');
  assert.match(sourceRevision, /^[a-f0-9]{40}$/u, 'source SHA invalid');
  assert.equal(evidence?.schemaVersion, 1);
  assert.equal(evidence.sourceRevision, sourceRevision, 'source SHA mismatch');
  assert.equal(evidence.model, CAPTURE_MODEL);
  assert.equal(evidence.installedDigest, CAPTURE_DIGEST);
  assert.equal(evidence.physicalProvider, true, 'physical provider not attested');
  assert.equal(evidence.status, 'PASS', 'live journey did not pass');
  assert.equal(evidence.mechanismStatus, 'PASS', 'second compaction mechanism failed');
  assert.equal(evidence.semanticQuality?.status, 'PASS', 'model answer quality failed');
  assert.equal(evidence.captureBytes, captureBytes.length, 'capture length mismatch');
  assert.equal(evidence.captureSha256, sha256(captureBytes), 'capture digest mismatch');
  assert.equal(captureBytes.at(-1), 10, 'capture JSONL incomplete');
  const rows = captureBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  assert(rows.length >= 4, 'too few physical provider calls');
  const claimedIndices = new Set();
  const capture = (receipt, label) => captureRow(rows, receipt, label, claimedIndices);
  for (const row of rows) {
    assert.equal(row.schemaVersion, 1);
    assert.equal(row.method, 'POST');
    assert.equal(row.path, '/api/chat');
    assert.equal(row.model, CAPTURE_MODEL);
    assert.equal(row.terminal?.model, CAPTURE_MODEL);
    if (row.terminal?.digest) assert.equal(row.terminal.digest, CAPTURE_DIGEST);
    if (row.terminal?.model_digest_sha256) {
      assert.equal(row.terminal.model_digest_sha256, CAPTURE_DIGEST);
    }
    assert.equal(row.status, 200, 'provider returned non-200');
    assert.equal(row.done, true, 'provider call not terminal');
    assert.equal(row.doneReason, 'stop', 'provider call truncated');
    assert.ok(Number.isSafeInteger(row.numCtx) && row.numCtx === 4096,
      'CHAT context window drift');
    assert.ok(Number.isSafeInteger(row.numPredict) && row.numPredict > 0
      && row.numPredict <= row.numCtx, 'provider output budget invalid');
    assert.ok(Number.isSafeInteger(row.promptEvalCount) && row.promptEvalCount > 0,
      'prompt usage missing');
    assert.ok(Array.isArray(row.messages), 'provider messages missing');
    assert.match(row.requestSha256, /^[a-f0-9]{64}$/u);
    assert.match(row.responseSha256, /^[a-f0-9]{64}$/u);
  }
  const first = evidence.first;
  const second = evidence.second;
  const restart = evidence.restart;
  assert.ok(Number.isSafeInteger(first?.firstUserId) && first.firstUserId > 0);
  assert.ok(Number.isSafeInteger(second?.secondUserId) && second.secondUserId > first.firstUserId);
  assert.ok(Number.isSafeInteger(first?.upToMsgId) && first.upToMsgId >= first.firstUserId);
  assert.ok(Number.isSafeInteger(second?.upToMsgId)
    && second.upToMsgId > first.upToMsgId
    && second.upToMsgId >= second.secondUserId, 'second summary boundary did not advance');
  assert.equal(restart?.firstSummary, first.text, 'summary changed over restart');
  assert.equal(restart?.firstUpToMsgId, first.upToMsgId, 'summary boundary changed over restart');
  assert.equal(restart?.rawFirstUserRetained, true, 'restart lost the original raw turn');
  assert(Array.isArray(first.messages) && Array.isArray(restart.messages)
    && Array.isArray(second.messages) && Array.isArray(evidence.final?.messages),
  'raw SQLite snapshots missing');
  assert.deepEqual(restart.messages, first.messages, 'restart changed persisted raw messages');
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages,
    'second compaction discarded or changed old raw messages');
  assert.deepEqual(evidence.final.messages.slice(0, second.messages.length), second.messages,
    'final recall discarded or changed old raw messages');
  assert.ok(Number.isSafeInteger(restart?.beforePid) && restart.beforePid > 0);
  assert.ok(Number.isSafeInteger(restart?.afterPid) && restart.afterPid > 0
    && restart.afterPid !== restart.beforePid, 'product process did not restart');
  assert.equal(first.rawTokens, rawTokens(first.messages), 'first raw token count differs from SQLite');
  assert.equal(second.postRestartRawTokens, rawTokens(second.messages, second.secondUserId),
    'second raw token count differs from SQLite');
  assert.ok(first.rawTokens >= 4096, 'first raw history never filled the provider window');
  assert.ok(second.postRestartRawTokens >= 4096,
    'post-restart raw history never filled a second provider window');
  assert.ok(first.text?.includes(FIRST_CODE), 'first durable summary lost original anchor');
  assert.ok(second.text?.includes(FIRST_CODE) && second.text?.includes(SECOND_CODE),
    'recursive durable summary lost an anchor');
  const firstRow = capture(first, 'first summary');
  const secondRow = capture(second, 'second summary');
  const firstSource = sourceForSummary(firstRow, 'first summary');
  const secondSource = sourceForSummary(secondRow, 'second summary');
  const firstRaw = secondWindowMessage(1, 1);
  const secondRaw = secondWindowMessage(2, 1);
  assert(first.messages.some(message => message.id === first.firstUserId
    && message.role === 'user' && message.content === firstRaw),
  'first SQLite snapshot lost exact original user input');
  assert(second.messages.some(message => message.id === second.secondUserId
    && message.role === 'user' && message.content === secondRaw),
  'second SQLite snapshot lost exact post-restart user input');
  assert(firstSource.includes(firstRaw), 'first summary source lacks original user input');
  assert(firstSource.includes(FIRST_FACT), 'first summary source lacks original user policy');
  assert(secondSource.includes(secondRaw), 'second summary source lacks post-restart decision');
  assert(!secondSource.includes(firstRaw), 'recursive summary replayed raw first input');
  const priorProse = modelText(firstRow)?.trim();
  const secondProse = modelText(secondRow)?.trim();
  assert(priorProse && secondProse, 'summary provider text missing');
  const firstQuote = userQuote(first.firstUserId, `Auditní kód je ${FIRST_CODE}.`);
  const secondQuote = userQuote(second.secondUserId, `Nový auditní kód je ${SECOND_CODE}.`);
  assert.equal(first.text, `${priorProse}\n\n${QUOTE_HEADER}\n${firstQuote}`,
    'first persisted summary differs from provider text plus source-scoped user quote');
  assert.equal(second.text, `${secondProse}\n\n${QUOTE_HEADER}\n${firstQuote}\n${secondQuote}`,
    'second persisted summary differs from provider text plus both source-scoped user quotes');
  const priorSegment = secondSource.split('[Předchozí souhrn]\n')[1]?.split('\n\n[Nové zprávy od posledního souhrnu]')[0];
  assert.equal(priorSegment, priorProse,
    'recursive provider request did not receive the exact previous summary prose');
  const foreignB = evidence.projects?.b;
  const ownA = evidence.projects?.a;
  for (const value of [foreignB?.file, foreignB?.canary, foreignB?.rule,
    ownA?.file, ownA?.canary, ownA?.rule]) assert.equal(typeof value, 'string');
  for (const row of [firstRow, secondRow]) {
    assertNoForeign(providerPromptText(row), [foreignB.file, foreignB.canary, foreignB.rule],
      'project A summary');
  }
  const bReceipts = [evidence.projectB?.before, evidence.projectB?.afterRestart,
    evidence.projectB?.afterSecond];
  let priorBMessages = [];
  let priorBAssistantId = 0;
  for (const receipt of bReceipts) {
    const row = capture(receipt, 'project B');
    assertNoForeign(providerPromptText(row), [FIRST_CODE, SECOND_CODE, ownA.file, ownA.canary, ownA.rule],
      'project B provider request');
    assert(providerPromptText(row).includes(foreignB.canary), 'project B prompt lacks its own file');
    const answer = providerReply(row);
    assert.equal(receipt.answer, answer, 'project B HTTP answer differs from captured provider reply');
    assert(answer.includes(foreignB.canary), 'project B answer lost its own file code');
    assertNoForeign(answer, [FIRST_CODE, SECOND_CODE, ownA.file, ownA.canary, ownA.rule],
      'project B answer');
    const question = `Jaký stav má projekt podle ${foreignB.file}? Uveď přesný projektový kód.`;
    assert.equal(receipt.question, question, 'project B POST question changed');
    assert(Array.isArray(receipt.messages), 'project B SQLite snapshot missing');
    if (priorBMessages.length === 0) assert.equal(receipt.messages.length, 2,
      'new project B conversation contains unreceipted initial messages');
    assert.deepEqual(receipt.messages.slice(0, priorBMessages.length), priorBMessages,
      'project B persisted history changed between turns');
    if (priorBMessages.length) assert.equal(receipt.messages.length, priorBMessages.length + 2,
      'project B did not persist exactly one new user/assistant pair');
    const assistantId = assertPersistedTurn(receipt.persistence, receipt.messages,
      question, receipt.answer, 'project B');
    assert(assistantId > priorBAssistantId, 'project B persisted turns are not ordered');
    assert.equal(receipt.persistence.messageCount, receipt.messages.length,
      'project B persisted turn was not latest');
    priorBAssistantId = assistantId;
    priorBMessages = receipt.messages;
  }
  const [beforeB, afterRestartB, afterSecondB] = bReceipts;
  assert(beforeB.captureIndex < first.captureIndex
    && first.captureIndex < afterRestartB.captureIndex
    && afterRestartB.captureIndex < second.captureIndex
    && second.captureIndex < afterSecondB.captureIndex
    && afterSecondB.captureIndex < evidence.final.captureIndex,
  'project B capture order crossed a compaction or restart stage boundary');
  assert.ok(Array.isArray(evidence.turns) && evidence.turns.length >= 10,
    'insufficient physical long turns');
  const seen = new Set();
  let priorAStage = 1;
  let priorATurn = 0;
  let priorAAssistantId = 0;
  let priorAMessageCount = 0;
  let priorACaptureIndex = beforeB.captureIndex;
  for (const turn of evidence.turns) {
    const key = `${turn.stage}.${turn.turn}`;
    assert(!seen.has(key), 'duplicate physical turn'); seen.add(key);
    if (turn.stage !== priorAStage) {
      assert.equal(turn.stage, 2, 'physical turns have an invalid stage order');
      assert.equal(priorAStage, 1, 'physical turns returned to the first stage');
      priorAStage = 2;
      priorATurn = 0;
    }
    assert.equal(turn.turn, priorATurn + 1, `${key} physical turn order changed`);
    priorATurn = turn.turn;
    if (turn.stage === 1 && turn.turn === 1) {
      assert.equal(turn.persistence?.messageCount, 2,
        'new project A conversation contains unreceipted initial messages');
    }
    const valueCase = secondWindowCase(turn.stage, turn.turn);
    assert.deepEqual(turn.expected, valueCase.expected, `${key} oracle changed`);
    assert.equal(turn.question, secondWindowMessage(turn.stage, turn.turn), `${key} question changed`);
    const row = capture(turn, key);
    const lower = turn.stage === 1 ? beforeB.captureIndex : afterRestartB.captureIndex;
    const upper = turn.stage === 1 ? afterRestartB.captureIndex : afterSecondB.captureIndex;
    assert(turn.captureIndex > lower && turn.captureIndex < upper
      && turn.captureIndex > priorACaptureIndex,
    `${key} provider capture order crossed a project B stage boundary`);
    priorACaptureIndex = turn.captureIndex;
    assert(providerPromptText(row).includes(turn.question), `${key} question absent from provider request`);
    const output = providerReply(row);
    assert.equal(turn.answer, output, `${key} HTTP answer differs from captured provider answer`);
    assertCapturedArithmetic(output, valueCase.expected, key);
    assert.equal(turn.qualityStatus, 'PASS', `${key} model answer quality failed`);
    const assistantId = assertPersistedTurn(turn.persistence,
      turn.stage === 1 ? first.messages : second.messages,
      turn.question, turn.answer, key);
    for (const [summary, label] of [[first, 'first'], [second, 'second']]) {
      if (assistantId <= summary.upToMsgId) {
        assert(turn.captureIndex < summary.captureIndex,
          `${label} summary capture preceded covered assistant ${key}`);
      }
    }
    if (turn.persistence.sqlite.user.id === first.firstUserId) {
      assert(turn.captureIndex < first.captureIndex,
        'first summary capture preceded its user anchor answer');
    }
    if (turn.persistence.sqlite.user.id === second.secondUserId) {
      assert(turn.captureIndex < second.captureIndex,
        'second summary capture preceded its user anchor answer');
    }
    assert(assistantId > priorAAssistantId, `${key} persisted turns are not ordered`);
    if (priorAMessageCount) assert.equal(turn.persistence.messageCount, priorAMessageCount + 2,
      `${key} did not persist exactly one new user/assistant pair`);
    priorAAssistantId = assistantId;
    priorAMessageCount = turn.persistence.messageCount;
    assertPersistedTurn(turn.persistence, evidence.final.messages, turn.question, turn.answer,
      `${key} final history`);
  }
  assert.equal(priorAStage, 2, 'no post-restart physical turns');
  const pairMessages = stage => evidence.turns.filter(turn => turn.stage === stage)
    .flatMap(turn => [turn.persistence.sqlite.user, turn.persistence.sqlite.assistant]);
  assert.deepEqual(first.messages.filter(message => message.id >= first.firstUserId),
    pairMessages(1), 'first SQLite snapshot contains an unreceipted A turn');
  assert.deepEqual(second.messages.filter(message => message.id >= second.secondUserId),
    pairMessages(2), 'second SQLite snapshot contains an unreceipted A turn');
  const semantic = secondWindowSemanticQuality(evidence.turns, evidence.final?.answer,
    [first.text, second.text]);
  assert.deepEqual(evidence.semanticQuality, semantic,
    'semantic quality receipt differs from recomputed verdict');
  const finalRow = capture(evidence.final, 'final recall');
  const finalWire = providerPromptText(finalRow);
  assert(finalWire.includes(FINAL_QUESTION), 'final question absent from provider request');
  assert(finalWire.includes(second.text), 'final prompt lacks persisted recursive summary');
  assert(!finalWire.includes(firstRaw), 'final prompt replayed original raw user message');
  assertNoForeign(finalWire, [foreignB.file, foreignB.canary, foreignB.rule], 'final project A prompt');
  assert.equal(evidence.final.answer, providerReply(finalRow),
    'final HTTP answer differs from captured provider output');
  assert.equal(evidence.final.question, FINAL_QUESTION, 'final POST question changed');
  const finalAssistantId = assertPersistedTurn(evidence.final.persistence,
    evidence.final.messages, FINAL_QUESTION, evidence.final.answer, 'final recall');
  assert(finalAssistantId > priorAAssistantId, 'final persisted turn is not after long turns');
  assert.equal(evidence.final.persistence.messageCount, priorAMessageCount + 2,
    'final recall did not persist exactly one new user/assistant pair');
  assert.equal(evidence.final.persistence.messageCount, evidence.final.messages.length,
    'final persisted turn was not latest');
  assert.deepEqual(evidence.final.messages.filter(message => message.id >= first.firstUserId),
    [...pairMessages(1), ...pairMessages(2), evidence.final.persistence.sqlite.user,
      evidence.final.persistence.sqlite.assistant],
  'final SQLite snapshot contains an unreceipted A turn');
  assert.equal(semantic.recall, true, 'physical model did not recall both anchors and old policy');
  return Object.freeze({ sourceRevision, captureSha256: sha256(captureBytes),
    providerRows: rows.length, firstUpToMsgId: first.upToMsgId,
    secondUpToMsgId: second.upToMsgId, semanticQuality: semantic.status,
    mechanismStatus: evidence.mechanismStatus });
}

export function attestSecondWindowEvidence({ captureFile, evidenceFile, sourceRevision }) {
  assert(path.isAbsolute(captureFile) && path.isAbsolute(evidenceFile));
  assert.equal(path.dirname(captureFile), path.dirname(evidenceFile),
    'capture and evidence must share a private directory');
  const dir = lstatSync(path.dirname(captureFile));
  assert(dir.isDirectory() && !dir.isSymbolicLink() && (dir.mode & 0o777) === 0o700);
  for (const file of [captureFile, evidenceFile]) {
    const stat = lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600);
  }
  return validateSecondWindowEvidence({ captureBytes: readFileSync(captureFile),
    evidence: JSON.parse(readFileSync(evidenceFile, 'utf8')), sourceRevision });
}
