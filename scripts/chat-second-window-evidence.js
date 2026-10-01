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

function captureRow(rows, receipt, label) {
  assert.match(receipt?.requestSha256, /^[a-f0-9]{64}$/u, `${label} request hash missing`);
  assert.match(receipt?.responseSha256, /^[a-f0-9]{64}$/u, `${label} response hash missing`);
  const matches = rows.filter(row => row.requestSha256 === receipt.requestSha256
    && row.responseSha256 === receipt.responseSha256);
  assert.equal(matches.length, 1, `${label} provider call absent or ambiguous`);
  return matches[0];
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
    && Array.isArray(second.messages), 'raw SQLite snapshots missing');
  assert.deepEqual(restart.messages, first.messages, 'restart changed persisted raw messages');
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages,
    'second compaction discarded or changed old raw messages');
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
  const firstRow = captureRow(rows, first, 'first summary');
  const secondRow = captureRow(rows, second, 'second summary');
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
  for (const receipt of [evidence.projectB?.before, evidence.projectB?.afterRestart,
    evidence.projectB?.afterSecond]) {
    const row = captureRow(rows, receipt, 'project B');
    assertNoForeign(providerPromptText(row), [FIRST_CODE, SECOND_CODE, ownA.file, ownA.canary, ownA.rule],
      'project B provider request');
    assert(providerPromptText(row).includes(foreignB.canary), 'project B prompt lacks its own file');
  }
  assert.ok(Array.isArray(evidence.turns) && evidence.turns.length >= 10,
    'insufficient physical long turns');
  const seen = new Set();
  for (const turn of evidence.turns) {
    const key = `${turn.stage}.${turn.turn}`;
    assert(!seen.has(key), 'duplicate physical turn'); seen.add(key);
    const valueCase = secondWindowCase(turn.stage, turn.turn);
    assert.deepEqual(turn.expected, valueCase.expected, `${key} oracle changed`);
    assert.equal(turn.question, secondWindowMessage(turn.stage, turn.turn), `${key} question changed`);
    const row = captureRow(rows, turn, key);
    assert(providerPromptText(row).includes(turn.question), `${key} question absent from provider request`);
    const output = providerReply(row);
    assert.equal(turn.answer, output, `${key} HTTP answer differs from captured provider answer`);
    assert.equal(turn.qualityStatus, 'PASS', `${key} model answer quality failed`);
  }
  const semantic = secondWindowSemanticQuality(evidence.turns, evidence.final?.answer,
    [first.text, second.text]);
  assert.deepEqual(evidence.semanticQuality, semantic,
    'semantic quality receipt differs from recomputed verdict');
  const finalRow = captureRow(rows, evidence.final, 'final recall');
  const finalWire = providerPromptText(finalRow);
  assert(finalWire.includes(FINAL_QUESTION), 'final question absent from provider request');
  assert(finalWire.includes(second.text), 'final prompt lacks persisted recursive summary');
  assert(!finalWire.includes(firstRaw), 'final prompt replayed original raw user message');
  assertNoForeign(finalWire, [foreignB.file, foreignB.canary, foreignB.rule], 'final project A prompt');
  assert.equal(evidence.final.answer, providerReply(finalRow),
    'final HTTP answer differs from captured provider output');
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
