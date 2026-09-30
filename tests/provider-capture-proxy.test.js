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
import { WINDOW_FILL_CASES, WINDOW_FILL_RETRY_CASE,
  windowFillMessage, windowFillUserQuoteBlock } from '../scripts/chat85-window-values.js';
import { assertExactValueAnswer } from './helpers/chat-value-fidelity-journey.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('window-fill source and independent eight-turn arithmetic oracle stay aligned', () => {
  assert.equal(WINDOW_FILL_CASES.length, 8);
  for (const valueCase of WINDOW_FILL_CASES) {
    const lines = windowFillMessage(valueCase.turn).split('\n');
    const first = lines.find(line => line.startsWith(`Záznam ${valueCase.turn}.1:`));
    const last = lines.find(line => line.startsWith(`Záznam ${valueCase.turn}.24:`));
    assert.equal(Number(first.match(/kalibrace (\d+)/)?.[1]), valueCase.expected.a);
    assert.equal(Number(last.match(/kalibrace (\d+)/)?.[1]), valueCase.expected.b);
    assert.equal(valueCase.expected.delta, 11);
    assert.equal(valueCase.expected.higher, 'A');
    assertExactValueAnswer(JSON.stringify(valueCase.expected), valueCase);
  }
  const retryLines = windowFillMessage(9).split('\n');
  assert.equal(Number(retryLines.find(line => line.startsWith('Záznam 9.1:'))
    ?.match(/kalibrace (\d+)/)?.[1]), WINDOW_FILL_RETRY_CASE.expected.a);
  assert.equal(Number(retryLines.find(line => line.startsWith('Záznam 9.24:'))
    ?.match(/kalibrace (\d+)/)?.[1]), WINDOW_FILL_RETRY_CASE.expected.b);
  const firstUser = { id: 17, role: 'user', content: windowFillMessage(1) };
  const quoteBlock = windowFillUserQuoteBlock(firstUser, 17);
  assert.match(quoteBlock, /"source":"user","messageId":17/);
  assert.match(quoteBlock, /auditní kód RIGEL_KAPPA_731\./);
  assert.throws(() => windowFillUserQuoteBlock({ ...firstUser, role: 'assistant' }, 17),
    /original user message changed/);
  assert.throws(() => windowFillUserQuoteBlock(firstUser, 16),
    /does not cover the original user message/);
  assert.throws(() => assertExactValueAnswer('{"a":106,"b":23,"delta":83,"higher":"A"}',
    WINDOW_FILL_CASES[2]), /wrong values/);
  assert.throws(() => assertExactValueAnswer('{"a":66,"b":55,"delta":29,"higher":"A"}',
    WINDOW_FILL_CASES[3]), /wrong values/);
  assert.throws(() => assertExactValueAnswer('{"a":59,"b":48,"delta":11,"higher":"B"}',
    WINDOW_FILL_CASES[6]), /wrong values/);
});

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
    const valueTurn = Number(body.toString('utf8').match(/Záznam (\d+)\.1:/)?.[1]);
    const valueCase = valueTurn === 9 ? WINDOW_FILL_RETRY_CASE : WINDOW_FILL_CASES[valueTurn - 1];
    response.writeHead(bad ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      model: CAPTURE_MODEL, digest: CAPTURE_DIGEST, done: !bad,
      done_reason: 'stop', prompt_eval_count: 3072, eval_count: 8,
      message: { role: 'assistant', content: valueCase
        ? JSON.stringify(valueCase.expected) : 'RIGEL_KAPPA_731' },
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

    const valueTurns = [];
    for (const valueCase of [...WINDOW_FILL_CASES, WINDOW_FILL_RETRY_CASE]) {
      const question = windowFillMessage(valueCase.turn);
      const reply = await fetch(`${proxy.url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: CAPTURE_MODEL, stream: false,
          messages: [{ role: 'user', content: `User: ${question}` }],
          options: { num_ctx: 4096, num_predict: 1200 } }),
      });
      assert.equal(reply.status, 200);
      const answer = (await reply.json()).message.content;
      assertExactValueAnswer(answer, valueCase);
      const valueRow = readFileSync(captureFile, 'utf8').trim().split('\n').map(JSON.parse).at(-1);
      valueTurns.push({ turn: valueCase.turn, question, answer,
        expected: valueCase.expected, qualityStatus: 'PASS', qualityError: null,
        requestSha256: valueRow.requestSha256, responseSha256: valueRow.responseSha256,
        model: valueRow.model, numCtx: valueRow.numCtx,
        numPredict: valueRow.numPredict, promptEvalCount: valueRow.promptEvalCount });
    }
    const retry = valueTurns.pop();
    const firstUser = { id: 17, role: 'user', content: windowFillMessage(1) };
    const summaryText = `RIGEL_KAPPA_731${windowFillUserQuoteBlock(firstUser, 17)}`;
    const summaryReply = await fetch(`${proxy.url}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CAPTURE_MODEL, stream: false,
        messages: [{ role: 'user', content: 'Shrň podklady.\nSouhrn:' }],
        options: { num_ctx: 4096, num_predict: 1200 } }),
    });
    assert.equal(summaryReply.status, 200);
    assert.equal((await summaryReply.json()).message.content, 'RIGEL_KAPPA_731');
    const summaryRow = readFileSync(captureFile, 'utf8').trim().split('\n').map(JSON.parse).at(-1);
    const sourceRevision = 'a'.repeat(40);
    const evidenceFile = path.join(root, '85-window-fill-evidence.json');
    const captureBytes = readFileSync(captureFile);
    const windowEvidence = {
      status: 'PASS', mechanismStatus: 'PASS', sourceRevision,
      arithmeticQuality: { status: 'PASS', expectedTurns: 8, checkedTurns: 8, failedTurns: [] },
      providerCaptureBytes: captureBytes.length,
      providerCaptureSha256: sha256(captureBytes),
      turns: valueTurns, retry,
      observedWindow: 4096, summary: { text: summaryText, upToMsgId: 17,
        providerRequestSha256: summaryRow.requestSha256,
        providerResponseSha256: summaryRow.responseSha256 },
      finalSnapshot: { messages: [firstUser] },
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
    assert.equal(attested.observedProviderRows, 11);
    assert.equal(attested.providerRows, 12);
    writeEvidence({ ...windowEvidence, summary: { ...windowEvidence.summary,
      providerRequestSha256: '0'.repeat(64) } });
    assert.throws(attest, /summary provider call is missing/);
    writeEvidence({ ...windowEvidence, summary: { ...windowEvidence.summary,
      providerResponseSha256: '0'.repeat(64) } });
    assert.throws(attest, /summary provider call is missing/);
    writeEvidence({ ...windowEvidence, summary: { ...windowEvidence.summary,
      text: `${summaryText} neověřené tvrzení` } });
    assert.throws(attest, /persisted summary differs/);
    writeEvidence({ ...windowEvidence, summary: { ...windowEvidence.summary, text: '  ' } });
    assert.throws(attest, /summary evidence missing/);
    writeEvidence({ ...windowEvidence, finalSnapshot: { messages: [{ ...firstUser,
      content: 'forged raw source' }] } });
    assert.throws(attest, /original user message changed/);
    const completeRows = readFileSync(captureFile, 'utf8').trim().split('\n').map(JSON.parse);
    const prefixRowCount = captureBytes.toString('utf8').trim().split('\n').length;
    const mutateSummaryCapture = (change, pattern) => {
      const altered = completeRows.map(row => row.requestSha256 === summaryRow.requestSha256
        ? change(structuredClone(row)) : row);
      const prefix = Buffer.from(`${altered.slice(0, prefixRowCount).map(JSON.stringify).join('\n')}\n`);
      const mutatedCaptureFile = path.join(root, 'mutated-capture.jsonl');
      const mutatedEvidenceFile = path.join(root, 'mutated-85-window-fill-evidence.json');
      writeFileSync(mutatedCaptureFile, `${altered.map(JSON.stringify).join('\n')}\n`, { mode: 0o600 });
      writeFileSync(mutatedEvidenceFile, `${JSON.stringify({ ...windowEvidence,
        providerCaptureBytes: prefix.length, providerCaptureSha256: sha256(prefix) })}\n`,
      { mode: 0o600 });
      assert.throws(() => attestWindowFillEvidence({
        evidenceFile: mutatedEvidenceFile, captureFile: mutatedCaptureFile, sourceRevision,
      }), pattern);
    };
    mutateSummaryCapture(row => ({ ...row, doneReason: 'length',
      terminal: { ...row.terminal, done_reason: 'length' } }), /summary provider response did not stop/);
    mutateSummaryCapture(row => ({ ...row, messages: [{ role: 'user', content: 'No summary marker' }] }),
      /summary provider prompt marker missing/);
    writeEvidence({ ...windowEvidence, arithmeticQuality: { ...windowEvidence.arithmeticQuality, status: 'FAIL' } });
    assert.throws(attest, /arithmetic quality did not pass/);
    writeEvidence({ ...windowEvidence, turns: valueTurns.slice(0, 7) });
    assert.throws(attest, /eight quality-checked turns/);
    writeEvidence({ ...windowEvidence, turns: valueTurns.map((turn, index) => index === 2
      ? { ...turn, answer: '{"a":106,"b":23,"delta":83,"higher":"A"}' } : turn) });
    assert.throws(attest, /answered with wrong values/);
    writeEvidence({ ...windowEvidence, turns: valueTurns.map((turn, index) => index === 0
      ? { ...turn, answer: '{"a":0,"a":73,"b":62,"delta":11,"higher":"A"}' } : turn) });
    assert.throws(attest, /four unique members/);
    writeEvidence({ ...windowEvidence, turns: valueTurns.map((turn, index) => index === 0
      ? { ...turn, question: 'User: fabricated source' } : turn) });
    assert.throws(attest, /source question changed/);
    writeEvidence({ ...windowEvidence, retry: { ...retry, answer: '{"a":92,"b":81,"delta":0,"higher":"A"}' } });
    assert.throws(attest, /answered with wrong values/);
    writeEvidence({ ...windowEvidence, sourceRevision: 'b'.repeat(40) });
    assert.throws(attest, /source revision mismatch/);
    writeEvidence({ ...windowEvidence, providerCaptureSha256: '0'.repeat(64) });
    assert.throws(attest, /capture digest mismatch/);
    writeEvidence({ ...windowEvidence, providerCaptureBytes: captureBytes.length - 1 });
    assert.throws(attest, /not newline terminated/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, requestSha256: '0'.repeat(64) } });
    assert.throws(attest, /final provider call is missing/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final, answer: 'forged' } });
    assert.throws(attest, /not the code alone/);
    writeEvidence({ ...windowEvidence, final: { ...windowEvidence.final,
      answer: 'Auditní kód RIGEL_KAPPA_731.', answerMatchesRequestedFormat: true } });
    assert.throws(attest, /not the code alone/);
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
