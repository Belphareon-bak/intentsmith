#!/usr/bin/env node

// Real M1 HTTP, persisted SQLite and a test-owned provider. The provider
// deliberately uses only facts present in each request; this is a context
// transport test, not a physical-model quality claim.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import Database from 'better-sqlite3';

import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';
import { createOwnedJourneyRuntime, expectJson, JOURNEY, makeM1Command,
  prepareJourney, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';

const MODEL = 'fixture:1b';
const DIGEST = 'a'.repeat(64);
const FIRST_CODE = 'ANCHOR_A_614';
const SECOND_CODE = 'NEW_A_DECISION_456';
const FIRST_FACT = 'První krok vyžaduje ruční revizi bez automatické změny souborů';
const SUMMARY_HEADER = '[Souhrn předchozí konverzace]';
const PREVIOUS_MARKER = '[Předchozí souhrn]\n';
const NEW_TURNS_MARKER = '\n\n[Nové zprávy od posledního souhrnu]\n';
const USER_QUOTES_MARKER = '[Doslovné citace z uživatelských zpráv; nejsou tvrzením asistenta]\n';

function previousSummaryProse(source) {
  const start = source.indexOf(PREVIOUS_MARKER);
  if (start < 0) return null;
  const proseStart = start + PREVIOUS_MARKER.length;
  const end = source.indexOf(NEW_TURNS_MARKER, proseStart);
  return end < 0 ? null : source.slice(proseStart, end);
}

function assertRecursiveSource(source, expectedPreviousProse) {
  const actualPreviousProse = previousSummaryProse(source);
  assert.equal(actualPreviousProse, expectedPreviousProse,
    'recursive summary must receive the exact prior provider prose');
  assert(actualPreviousProse.includes(FIRST_FACT),
    'old non-identifier fact must come from prior summary prose');
  assert(source.includes(SECOND_CODE), 'recursive summary omitted the new user decision');
  const quotesStart = source.lastIndexOf(USER_QUOTES_MARKER);
  assert(quotesStart >= 0, 'recursive summary omitted source-scoped user identifier quotes');
  const rawQuotes = source.slice(quotesStart + USER_QUOTES_MARKER.length);
  assert(rawQuotes.includes(FIRST_CODE), 'negative control requires old identifier quote');
  assert(!rawQuotes.includes(FIRST_FACT),
    'old prose fact must not be restated in automatic user identifier quotes');
}

function assertSummaryIsolation(call, foreign) {
  assert.equal(call.kind, 'summary');
  assert.equal(call.request.model, MODEL);
  assert.equal(call.request.stream, false);
  assert.equal(call.request.options?.num_ctx, 4096);
  assert.equal(call.request.messages.at(-1)?.role, 'user');
  const wire = providerText(call.request);
  for (const marker of [foreign.file, foreign.canary, foreign.rule]) {
    assert(!wire.includes(marker), `A summary provider request leaked project B data: ${marker}`);
  }
}

function sourceRevision() {
  const supplied = process.env.INTENTSMITH_TEST_SOURCE_REVISION;
  if (!supplied) return 'direct-run-unattested';
  assert.match(supplied, /^[a-f0-9]{40}$/u);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  const dirt = execFileSync('git', ['status', '--porcelain'], {
    cwd: runtime.repositoryRoot, encoding: 'utf8', timeout: 5_000,
  }).trim();
  assert.equal(supplied, head);
  assert.equal(dirt, '', 'attested product evidence requires a clean source tree');
  return supplied;
}

function providerText(request) {
  return request.messages.map(message => String(message.content || '')).join('\n');
}

async function startProvider() {
  const calls = [];
  const server = http.createServer(async (incoming, outgoing) => {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 2_000_000) { outgoing.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    outgoing.setHeader('Content-Type', 'application/json');
    const route = `${incoming.method} ${incoming.url}`;
    if (route === 'GET /api/tags') {
      outgoing.end(JSON.stringify({ models: [{ name: MODEL, digest: DIGEST }] }));
      return;
    }
    if (route === 'POST /api/show') {
      outgoing.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
      return;
    }
    if (route !== 'POST /api/chat') {
      outgoing.writeHead(503).end(JSON.stringify({ error: `Unexpected fixture route: ${route}` }));
      return;
    }
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const last = String(request.messages?.at(-1)?.content || '');
    const isSummary = last.endsWith('\nSouhrn:');
    let projectPrompt;
    if (!isSummary) {
      try { projectPrompt = JSON.parse(last); }
      catch { projectPrompt = null; }
    }
    const isProject = Boolean(projectPrompt?.project && projectPrompt?.analysis
      && typeof projectPrompt?.request === 'string');
    let content;
    if (isSummary) {
      // Every fact in this summary must have arrived in the actual source
      // material, either as an original user turn or the previous summary.
      const codes = [FIRST_CODE, SECOND_CODE].filter(code => last.includes(code));
      const previousProse = previousSummaryProse(last);
      const factSource = previousProse === null ? last : previousProse;
      const fact = factSource.includes(FIRST_FACT) ? ` ${FIRST_FACT}.` : '';
      content = `Uživatel určil ${codes.join(' a ')} pro projekt A.${fact} Pokračovat jen v projektu A.`;
    } else if (isProject) {
      const fileText = projectPrompt?.analysis?.excerpts?.map(file => file.text).join('\n') || '';
      const ownFileCode = [JOURNEY.a.canary, JOURNEY.b.canary].find(code => fileText.includes(code)) || 'FILE_CODE_MISSING';
      const history = projectPrompt?.history || [];
      const summary = history.filter(turn => turn.role === 'summary').map(turn => turn.content).join('\n');
      const final = projectPrompt?.request?.includes('Závěrečná kontrola kontextu') || false;
      const answer = final
        ? `Souhrn obsahuje ${[FIRST_CODE, SECOND_CODE].filter(code => summary.includes(code)).join(' a ')}. ${summary.includes(FIRST_FACT) ? FIRST_FACT : 'PŮVODNÍ_FAKT_CHYBÍ'}. Soubor obsahuje ${ownFileCode}.`
        : `Soubor obsahuje ${ownFileCode}.`;
      content = JSON.stringify({ reply: answer, plan: null });
    } else {
      content = JSON.stringify({ intent: 'PROJECT', confidence: 0.99, fileTarget: null });
    }
    calls.push({ request, content, kind: isSummary ? 'summary' : isProject ? 'project' : 'other' });
    outgoing.end(JSON.stringify({ model: MODEL, digest: DIGEST, done: true,
      done_reason: 'stop', prompt_eval_count: 100, eval_count: 20,
      message: { role: 'assistant', content } }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return { calls, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function sqliteSnapshot(databasePath, conversationId) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return {
      conversation: db.prepare('SELECT id, project_id, summary, summary_up_to_msg_id FROM conversations WHERE id = ?')
        .get(conversationId),
      messages: db.prepare('SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY id ASC')
        .all(conversationId),
    };
  } finally { db.close(); }
}

async function snapshot(product, journeyRuntime, conversationId) {
  const route = `/api/conversations/${encodeURIComponent(conversationId)}`;
  const deadline = Date.now() + 3_000;
  let fromHttp;
  let history;
  let fromDb;
  do {
    fromHttp = await expectJson(product, 'GET', route, null, 200);
    history = await expectJson(product, 'GET', `${route}/messages`, null, 200);
    fromDb = sqliteSnapshot(journeyRuntime.database, conversationId);
    const httpMessages = history.messages.map(({ id, role, content }) => ({ id, role, content }));
    if (fromHttp.conversation.id === fromDb.conversation.id
        && fromHttp.conversation.project_id === fromDb.conversation.project_id
        && fromHttp.conversation.summary === fromDb.conversation.summary
        && fromHttp.conversation.summary_up_to_msg_id === fromDb.conversation.summary_up_to_msg_id
        && JSON.stringify(httpMessages) === JSON.stringify(fromDb.messages)) return fromDb;
    // Background compaction can commit between two distinct HTTP GETs. Read
    // both sides again; require exact parity only once the snapshot settles.
    await delay(10);
  } while (Date.now() < deadline);
  assert.deepEqual({ conversation: fromHttp.conversation, messages: history.messages }, fromDb,
    'HTTP and SQLite failed to reach the same persisted snapshot');
  return fromDb;
}

async function waitForSummary(product, journeyRuntime, conversationId, afterId = 0) {
  const deadline = Date.now() + 30_000;
  let current;
  do {
    current = await snapshot(product, journeyRuntime, conversationId);
    if (Number(current.conversation.summary_up_to_msg_id) > afterId) return current;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(`No durable summary beyond message ${afterId}; last=${current.conversation.summary_up_to_msg_id}`);
}

function longProjectQuestion(fixture, turn, prefix = '', detailCount = 10) {
  const detail = Array.from({ length: detailCount }, (_, index) =>
    `Bod ${turn}.${index + 1}: ověř soulad dokumentace, hranice projektu, původ důkazu a další malý krok bez změny souborů.`).join(' ');
  return `Jaký je stav projektu podle ${fixture.file}? ${prefix} ${detail} Odpověz stručně.`;
}

async function chat(product, provider, fixture, label, input, foreign) {
  const before = provider.calls.length;
  const result = await expectJson(product, 'POST', '/api/chat',
    makeM1Command(fixture.conversationId, label, input), 200);
  assert.equal(result.status, 'ok');
  assert.equal(result.response?.metadata?.handler, 'project.collaboration');
  assert.deepEqual(result.response.metadata.expertiseIds, [fixture.expertise],
    `${label}: ${JSON.stringify(result.response).slice(0, 600)}`);
  const projectCalls = provider.calls.slice(before).filter(call => call.kind === 'project');
  const seenCalls = provider.calls.slice(before).map(call => ({ kind: call.kind,
    last: call.request.messages?.at(-1)?.content?.slice(0, 180), content: call.content.slice(0, 150) }));
  assert.equal(projectCalls.length, 1,
    `${label}: expected one project provider request, saw ${JSON.stringify(seenCalls).slice(0, 1200)}`);
  const call = projectCalls[0];
  const prompt = JSON.parse(call.request.messages.at(-1).content);
  assert.equal(call.request.model, MODEL);
  assert.equal(call.request.options?.num_ctx, 4096);
  assert.equal(prompt.project.id, fixture.id);
  assert.equal(prompt.request, input);
  assert(prompt.analysis.excerpts.some(file => file.path === fixture.file && file.text === fixture.source),
    `${label}: project source file missing from final provider prompt`);
  assert(prompt.expertiseGuidance.includes(fixture.rule), `${label}: project expertise rule missing`);
  const wire = providerText(call.request);
  for (const marker of [foreign.canary, foreign.rule, foreign.file]) {
    assert(!wire.includes(marker), `${label}: foreign project data crossed into provider prompt: ${marker}`);
  }
  assert.equal(result.response.content, JSON.parse(call.content).reply,
    `${label}: HTTP answer differs from provider result`);
  return { result, call, prompt, wire };
}

function assertFinalContext(prompt, answer, { a, b, firstInput, secondInput }) {
  assert.equal(prompt.project.id, a.id);
  assert(prompt.analysis.excerpts.some(file => file.path === a.file && file.text === a.source),
    'final prompt lost exact project A file bytes');
  assert(prompt.expertiseGuidance.includes(a.rule), 'final prompt lost project A expertise rule');
  const summaries = prompt.history.filter(turn => turn.role === 'summary');
  assert.equal(summaries.length, 1, 'final provider body must contain one durable summary');
  assert(summaries[0].content.includes(SUMMARY_HEADER));
  assert(summaries[0].content.includes(FIRST_CODE));
  assert(summaries[0].content.includes(SECOND_CODE));
  assert(summaries[0].content.includes(FIRST_FACT));
  const wire = JSON.stringify(prompt);
  assert(!wire.includes(firstInput), 'final prompt replayed first raw user turn');
  assert(!wire.includes(secondInput), 'final prompt replayed archived post-restart user turn');
  for (const foreign of [b.canary, b.rule, b.file]) {
    assert(!wire.includes(foreign), `final prompt leaked project B data: ${foreign}`);
  }
  for (const expected of [FIRST_CODE, SECOND_CODE, FIRST_FACT, a.canary]) {
    assert(answer.includes(expected), `HTTP answer lost ${expected}`);
  }
  assert(!answer.includes(b.canary), 'HTTP answer leaked project B file code');
  return summaries[0].content;
}

test('second auto-context compaction survives restart and isolates A/B project context', {
  timeout: 240_000,
}, async t => {
  const revision = sourceRevision();
  const journeyRuntime = createOwnedJourneyRuntime(runtime);
  let provider = await startProvider();
  let product = null;
  const cleanup = async () => {
    const failures = [];
    if (product) {
      try { await stopProduct(product); product = null; } catch (error) { failures.push(error); }
    }
    if (provider) {
      try { await provider.close(); provider = null; } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'owned context journey cleanup failed');
  };
  t.after(cleanup);

  product = await startProduct(journeyRuntime, provider.url, MODEL);
  const { a, b } = await prepareJourney(product, journeyRuntime);
  const firstInput = longProjectQuestion(a, 1,
    `Původní auditní kód je ${FIRST_CODE}. ${FIRST_FACT}.`);
  await chat(product, provider, a, 'a-first', firstInput, b);
  const firstUser = (await snapshot(product, journeyRuntime, a.conversationId)).messages[0];
  assert.equal(firstUser.role, 'user');
  assert.equal(firstUser.content, firstInput);

  const bInput = `Jaký stav má projekt podle ${b.file}?`;
  const bBefore = await chat(product, provider, b, 'b-before-restart', bInput, a);
  assert(!bBefore.wire.includes(FIRST_CODE), 'project B received project A conversation anchor');

  let first = null;
  let aTurns = 1;
  while (!first && aTurns < 9) {
    aTurns += 1;
    await chat(product, provider, a, `a-${aTurns}`, longProjectQuestion(a, aTurns), b);
    const current = await snapshot(product, journeyRuntime, a.conversationId);
    if (current.conversation.summary) first = current;
  }
  if (!first) first = await waitForSummary(product, journeyRuntime, a.conversationId);
  const firstUpTo = Number(first.conversation.summary_up_to_msg_id);
  assert(firstUpTo >= firstUser.id, 'first summary failed to cover original user fact');
  assert(first.conversation.summary.includes(FIRST_CODE), 'first summary lost original user code');
  assert(first.conversation.summary.includes(FIRST_FACT), 'first summary lost original user fact');
  assert(first.messages.length > 6, 'first compaction did not follow a real multi-turn journey');
  const firstSummaryCall = provider.calls.find(call => call.kind === 'summary'
    && `${call.content}\n\n`.includes(FIRST_CODE));
  assert(firstSummaryCall, 'the persisted first summary has no completed provider source');
  assertSummaryIsolation(firstSummaryCall, b);
  assert(first.conversation.summary.startsWith(firstSummaryCall.content),
    'first stored summary differs from provider text');
  assert(providerText(firstSummaryCall.request).includes(firstInput),
    'first summary provider request omitted original user data');

  await stopProduct(product);
  product = null;
  product = await startProduct(journeyRuntime, provider.url, MODEL);
  const restored = await snapshot(product, journeyRuntime, a.conversationId);
  assert.equal(restored.conversation.summary, first.conversation.summary,
    'restart changed persisted summary bytes');
  assert.equal(restored.conversation.summary_up_to_msg_id, firstUpTo);

  const bAfter = await chat(product, provider, b, 'b-after-restart',
    `Zopakuj stav projektu podle ${b.file}.`, a);
  assert(!bAfter.wire.includes(FIRST_CODE), 'restored project A summary leaked into B');
  const secondInput = longProjectQuestion(a, aTurns + 1,
    `Nové uživatelské rozhodnutí má kód ${SECOND_CODE}.`, 2);
  const secondUserTurn = aTurns + 1;
  await chat(product, provider, a, `a-${secondUserTurn}`, secondInput, b);
  aTurns = secondUserTurn;
  const secondUserId = (await snapshot(product, journeyRuntime, a.conversationId)).messages
    .find(message => message.content === secondInput)?.id;
  assert(Number.isSafeInteger(secondUserId));

  let second = null;
  while (!second && aTurns < 18) {
    aTurns += 1;
    await chat(product, provider, a, `a-${aTurns}`, longProjectQuestion(a, aTurns, '', 2), b);
    const current = await snapshot(product, journeyRuntime, a.conversationId);
    if (Number(current.conversation.summary_up_to_msg_id) > firstUpTo
      && Number(current.conversation.summary_up_to_msg_id) >= secondUserId) second = current;
  }
  if (!second) second = await waitForSummary(product, journeyRuntime, a.conversationId, firstUpTo);
  const secondUpTo = Number(second.conversation.summary_up_to_msg_id);
  assert(secondUpTo > firstUpTo, 'second summary did not advance its durable message ID');
  assert(secondUpTo >= secondUserId, 'second summary did not cover the post-restart decision');
  assert(second.conversation.summary.includes(FIRST_CODE), 'recursive summary lost the first user code');
  assert(second.conversation.summary.includes(FIRST_FACT), 'recursive summary lost prior prose fact');
  assert(second.conversation.summary.includes(SECOND_CODE), 'recursive summary lost the new decision');
  assert(second.messages.length >= aTurns * 2, 'raw durable history was discarded by compaction');
  const secondSummaryCall = provider.calls.filter(call => call.kind === 'summary')
    .find(call => call.content.includes(SECOND_CODE));
  assert(secondSummaryCall, 'no completed second summary provider call');
  assertSummaryIsolation(secondSummaryCall, b);
  assert(second.conversation.summary.startsWith(secondSummaryCall.content),
    'second stored summary differs from provider text');
  const precedingCalls = provider.calls.slice(0, provider.calls.indexOf(secondSummaryCall))
    .filter(call => call.kind === 'summary');
  const precedingSummaryProse = precedingCalls.at(-1)?.content;
  assert.equal(typeof precedingSummaryProse, 'string',
    'recursive compaction had no prior completed summary prose');
  const secondSource = String(secondSummaryCall.request.messages.at(-1).content);
  assertRecursiveSource(secondSource, precedingSummaryProse);
  assert(!secondSource.includes(firstInput), 'second compaction replayed the original raw user message');
  const previousStart = secondSource.indexOf(PREVIOUS_MARKER) + PREVIOUS_MARKER.length;
  const previousEnd = secondSource.indexOf(NEW_TURNS_MARKER, previousStart);
  assert(previousEnd > previousStart, 'second summary previous-prose segment missing');
  const withoutPreviousProse = secondSource.slice(0, previousStart) + secondSource.slice(previousEnd);
  assert(withoutPreviousProse.includes(FIRST_CODE),
    'negative probe must retain the first code in the raw quote block');
  assert.throws(() => assertRecursiveSource(withoutPreviousProse, precedingSummaryProse),
    'oracle must reject lost prior summary prose despite a raw identifier quote');
  const foreignSummary = structuredClone(secondSummaryCall);
  foreignSummary.request.messages.at(-1).content += `\n${b.file} ${b.canary} ${b.rule}`;
  assert.throws(() => assertSummaryIsolation(foreignSummary, b),
    'oracle must reject project B data in an A summary provider request');
  const finalInput = `Závěrečná kontrola kontextu pro ${a.file}: uveď dřívější dva kódy a přesný kód ze souboru.`;
  const final = await chat(product, provider, a, 'a-final', finalInput, b);
  const oracleInput = { a, b, firstInput, secondInput };
  const answer = final.result.response.content;
  assertFinalContext(final.prompt, answer, oracleInput);
  const withoutSummary = structuredClone(final.prompt);
  withoutSummary.history = withoutSummary.history.filter(turn => turn.role !== 'summary');
  assert(!JSON.stringify(withoutSummary).includes(FIRST_CODE),
    'original user code reached final provider prompt outside the summary');
  assert.throws(() => assertFinalContext(withoutSummary, answer, oracleInput),
    'oracle must reject a missing durable summary');
  const missingOriginalFact = structuredClone(final.prompt);
  missingOriginalFact.history.find(turn => turn.role === 'summary').content =
    missingOriginalFact.history.find(turn => turn.role === 'summary').content.replaceAll(FIRST_CODE, '');
  assert.throws(() => assertFinalContext(missingOriginalFact, answer, oracleInput),
    'oracle must reject a summary without the original user code');
  const foreignLeak = structuredClone(final.prompt);
  foreignLeak.history.find(turn => turn.role === 'summary').content += ` ${b.canary}`;
  assert.throws(() => assertFinalContext(foreignLeak, answer, oracleInput),
    'oracle must reject foreign project data in the summary');

  const bFinal = await chat(product, provider, b, 'b-after-second-summary',
    `Jaký stav má projekt podle ${b.file}?`, a);
  assert(!bFinal.wire.includes(FIRST_CODE), 'second project A summary leaked into project B');
  assert(!bFinal.wire.includes(SECOND_CODE), 'post-restart project A decision leaked into project B');

  const durable = await snapshot(product, journeyRuntime, a.conversationId);
  assert.equal(durable.messages.length, (aTurns + 1) * 2);
  assert.equal(durable.messages[0].content, firstInput);
  assert(durable.messages.some(message => message.id === secondUserId && message.content === secondInput));
  assert.equal(durable.messages.at(-1).content, final.result.response.content);
  assert.equal(durable.conversation.project_id, a.id);
  const bDurable = await snapshot(product, journeyRuntime, b.conversationId);
  assert.equal(bDurable.conversation.project_id, b.id);
  assert.equal(bDurable.messages.length, 6);
  assert(!bDurable.messages.map(message => message.content).join('\n').includes(FIRST_CODE));
  const summaryCalls = provider.calls.filter(call => call.kind === 'summary');
  assert(summaryCalls.length >= 2, 'expected at least two project A summary provider requests');
  assert(summaryCalls.includes(firstSummaryCall) && summaryCalls.includes(secondSummaryCall));
  for (const call of summaryCalls) {
    assert(providerText(call.request).includes(FIRST_CODE),
      'unexpected summary request without the project A original user anchor');
    assertSummaryIsolation(call, b);
  }

  const report = { schemaVersion: 1, sourceRevision: revision,
    fixture: 'owned-isolated-server-and-loopback-provider', model: MODEL,
    projectIds: [a.id, b.id], firstSummaryUpToMsgId: firstUpTo,
    secondSummaryUpToMsgId: secondUpTo, firstUserId: firstUser.id,
    postRestartDecisionId: secondUserId, aTurns: aTurns + 1,
    rawMessagesA: durable.messages.length, rawMessagesB: bDurable.messages.length,
    secondSourceSha256: createHash('sha256').update(secondSource).digest('hex'),
    finalRequestSha256: createHash('sha256').update(JSON.stringify(final.call.request)).digest('hex'),
    providerSummaryCalls: summaryCalls.length,
    status: 'PASS' };
  await cleanup();
  writeFileSync(`${runtime.artifacts}/chat-second-compaction-http.json`,
    `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
});
