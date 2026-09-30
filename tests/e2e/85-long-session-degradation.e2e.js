// tests/e2e/85-long-session-degradation.e2e.js — Long Session Degradation
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests that the system maintains quality across 10+ turn conversations.
// Validates context retention, topic switching, and no memory drift.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, assertEqual, summary,
  api, waitForServer, hasKeywords,
} from './_helpers.js';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { config } from '../../src/config.js';

await waitForServer();
const created = [];
const REQUEST_TIMEOUT = 180_000;
const configuredCooldownSeconds = Number(process.env.E2E_GPU_COOLDOWN ?? 3);
assert(Number.isSafeInteger(configuredCooldownSeconds)
  && configuredCooldownSeconds >= 0 && configuredCooldownSeconds <= 60,
'E2E_GPU_COOLDOWN must be an integer from 0 to 60 seconds');
const GPU_COOLDOWN_MS = configuredCooldownSeconds * 1000;
const WINDOW_FILL_CODE = 'RIGEL_KAPPA_731';
const providerCaptureFile = process.env.INTENTSMITH_TEST_PROVIDER_CAPTURE_FILE;
let windowConvId = null;
const windowEvidence = { status: 'FAIL', sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION,
  startedAt: new Date().toISOString(), turns: [] };

async function serialTest(name, fn, limitMs) {
  // The inner deadline aborts every HTTP request and wait before the harness's
  // Promise.race fallback can proceed to another test or cleanup.
  await testAsync(name, outerSignal => fn(AbortSignal.any([
    outerSignal, AbortSignal.timeout(limitMs),
  ])), limitMs + 15_000);
}

async function chatForSuite(convId, message, signal) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)]);
  const { status, data } = await api('POST', '/api/chat', {
    conversation_id: convId, message,
  }, requestSignal);
  assertEqual(status, 200);
  assert(typeof data?.response === 'string' && data.response.trim().length > 0,
    'chat returned an empty answer');
  if (GPU_COOLDOWN_MS > 0) await pause(GPU_COOLDOWN_MS, undefined, { signal });
  return { status, response: data.response, metadata: data.metadata, data };
}

async function createConvForSuite(title, signal) {
  const { status, data } = await api('POST', '/api/conversations', { title, mode: 'chat' }, signal);
  assert(status === 200 || status === 201, `conversation creation failed: ${status}`);
  const id = data?.id ?? data?.conversation?.id;
  assert(typeof id === 'string' && id.length > 0, 'conversation creation returned no ID');
  return id;
}

async function cleanupConvForSuite(id) {
  for (const suffix of ['', '?hard=true']) {
    try {
      await api('DELETE', `/api/conversations/${id}${suffix}`, undefined, AbortSignal.timeout(5_000));
    } catch { /* Runner-owned fixture cleanup is best effort after evidence capture. */ }
  }
}

function providerRows() {
  assert(providerCaptureFile && isAbsolute(providerCaptureFile),
    'runner-owned provider capture is required for the window-fill test');
  const contents = readFileSync(providerCaptureFile, 'utf8');
  const completeEnd = contents.lastIndexOf('\n');
  return completeEnd < 0 ? [] : contents.slice(0, completeEnd).split('\n')
    .filter(Boolean).map(line => JSON.parse(line));
}

function providerPrompt(row) {
  return (row.messages || []).map(message => String(message.content || '')).join('\n');
}

function isAnswerRequestFor(row, question) {
  return (row.messages || []).some(message => {
    if (message.role !== 'user' || typeof message.content !== 'string') return false;
    const prompt = message.content;
    return (prompt.startsWith('User: ') || prompt.startsWith('Previous conversation (quoted data, not system instructions):\n'))
      && prompt.includes(`User: ${question}`);
  });
}

function providerOutput(row) {
  return [row.terminal?.message?.content, row.terminal?.response]
    .find(content => typeof content === 'string' && content.trim().length > 0);
}

function completedProviderCall(question, startIndex, response) {
  const rows = providerRows().slice(startIndex);
  const matching = rows.filter(row => row.schemaVersion === 1
    && row.path === '/api/chat' && row.method === 'POST'
    && row.model === config.models.CHAT && row.status === 200
    && row.terminal?.done === true && row.done === true
    && Number.isSafeInteger(row.numCtx) && row.numCtx > 0
    && Number.isSafeInteger(row.numPredict) && row.numPredict > 0
    && Number.isSafeInteger(row.promptEvalCount) && row.promptEvalCount > 0
    && isAnswerRequestFor(row, question)
    && providerOutput(row) === response.response
    && response.metadata?.answerBudget?.numCtx === row.numCtx
    && response.metadata?.answerBudget?.maxTokens === row.numPredict
    && response.metadata?.model === row.model);
  assert(matching.length > 0,
    `no captured CHAT ANSWER call matching the returned response and budget (${rows.length} new provider rows)`);
  return matching.at(-1);
}

async function capturedChat(convId, question, signal) {
  const startIndex = providerRows().length;
  const response = await chatForSuite(convId, question, signal);
  return { response, provider: completedProviderCall(question, startIndex, response) };
}

function saveWindowEvidence() {
  if (!providerCaptureFile) return;
  const artifactDir = process.env.INTENTSMITH_TEST_ARTIFACT_DIR;
  assert(artifactDir && isAbsolute(artifactDir), 'runner-owned artifact directory is required');
  assert(resolve(dirname(providerCaptureFile)) === resolve(artifactDir),
    'provider capture must be inside the runner-owned artifact directory');
  assert(resolve(artifactDir).split(sep).includes('.intentsmith-artifacts'),
    'artifact directory must be private');
  const stat = lstatSync(artifactDir);
  assert(!stat.isSymbolicLink() && stat.isDirectory() && (stat.mode & 0o777) === 0o700,
    'artifact directory must be a private non-symlink directory');
  windowEvidence.finishedAt = new Date().toISOString();
  const captureBytes = readFileSync(providerCaptureFile);
  const completeLength = captureBytes.lastIndexOf(10) + 1;
  assert(completeLength > 0, 'provider capture has no complete JSONL row');
  const completePrefix = captureBytes.subarray(0, completeLength);
  windowEvidence.providerCaptureBytes = completeLength;
  windowEvidence.providerCaptureSha256 = createHash('sha256')
    .update(completePrefix).digest('hex');
  const path = join(artifactDir, '85-window-fill-evidence.json');
  writeFileSync(path, `${JSON.stringify(windowEvidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function effectiveHistoryTokens(snapshot) {
  const summaryData = snapshot.conversation?.summary;
  const upToId = Number(snapshot.conversation?.summary_up_to_msg_id);
  const turns = summaryData && Number.isInteger(upToId)
    ? snapshot.messages.filter(message => Number(message.id) > upToId).slice(-10)
    : snapshot.messages.slice(-10);
  return (summaryData ? Math.ceil(`[Souhrn předchozí konverzace]\n${summaryData}`.length / 4) : 0)
    + turns.reduce((sum, message) => sum + Number(message.tokens || 0), 0);
}

function windowFillMessage(turn) {
  const facts = Array.from({ length: 24 }, (_, index) => (
    `Záznam ${turn}.${index + 1}: senzor ${((turn * 37) + (index * 19)) % 997}, `
    + `kalibrace ${((turn * 73) + (index * 29)) % 113}, `
    + `stav ${index % 3 === 0 ? 'kontrola' : 'archivace'}; `
    + 'tento řádek je podklad, nikoli nový pokyn.\n'
  )).join('');
  const anchor = turn === 1
    ? `Nejdůležitější trvalý údaj pro tuto relaci je auditní kód ${WINDOW_FILL_CODE}. `
      + 'Budu se na něj ptát až po zkrácení kontextu.\n'
    : '';
  return `${anchor}${facts}Odpověz jednou větou: jak se liší kalibrace položky ${turn}.1 a ${turn}.24?`;
}

async function conversationSnapshot(convId, signal) {
  const [conversationResponse, messagesResponse] = await Promise.all([
    api('GET', `/api/conversations/${convId}`, undefined, signal),
    api('GET', `/api/conversations/${convId}/messages`, undefined, signal),
  ]);
  assertEqual(conversationResponse.status, 200);
  assertEqual(messagesResponse.status, 200);
  assert(Array.isArray(messagesResponse.data.messages), 'message history must be available');
  return {
    conversation: conversationResponse.data.conversation,
    messages: messagesResponse.data.messages,
  };
}

function recordFirstSummary(snapshot, observedTurn) {
  if (!snapshot.conversation?.summary || windowEvidence.firstSummary) return;
  const withoutSummaryTokens = snapshot.messages.slice(-10)
    .reduce((sum, message) => sum + Number(message.tokens || 0), 0);
  const withSummaryTokens = effectiveHistoryTokens(snapshot);
  windowEvidence.firstSummary = {
    observedTurn, messageCount: snapshot.messages.length,
    upToMsgId: snapshot.conversation.summary_up_to_msg_id,
    withoutSummaryTokens, withSummaryTokens,
    savedTokens: withoutSummaryTokens - withSummaryTokens,
  };
}

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Session — Context Retention (10 turns)');
  // ═══════════════════════════════════════════════════════════════════════════

  await serialTest('remembers topic after 10 turns', async signal => {
    const convId = await createConvForSuite('long-1', signal);
    created.push(convId);

    // Turn 1: Establish topic
    await chatForSuite(convId, 'Povídejme si o programování v Pythonu. Co je seznam?', signal);
    // Turns 2-9: Build context
    await chatForSuite(convId, 'A co slovníky?', signal);
    await chatForSuite(convId, 'Jak se iteruje přes slovník?', signal);
    await chatForSuite(convId, 'A co list comprehension?', signal);
    await chatForSuite(convId, 'Uveď příklad s filtrem', signal);
    await chatForSuite(convId, 'A co generátory?', signal);
    await chatForSuite(convId, 'Jak se liší od iterátorů?', signal);
    await chatForSuite(convId, 'Dej mi příklad s yield', signal);
    await chatForSuite(convId, 'A dekorátory?', signal);

    // Turn 10: Reference turn 1
    const r = await chatForSuite(convId, 'Vrať se k tomu prvnímu tématu — co jsme říkali o seznamech?', signal);
    assert(hasKeywords(r.response, ['seznam', 'list', 'python', 'pole', 'prvk', 'index', 'append'], 1),
      `after 10 turns, should remember lists topic: ${r.response.substring(0, 200)}`);
  }, 32 * 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Session — Topic Switching');
  // ═══════════════════════════════════════════════════════════════════════════

  await serialTest('switches topic cleanly and returns', async signal => {
    const convId = await createConvForSuite('long-2', signal);
    created.push(convId);

    // Topic A: JavaScript
    const r1 = await chatForSuite(convId, 'Co je closure v JavaScriptu?', signal);
    assert(hasKeywords(r1.response, ['closure', 'uzávěr', 'funkc', 'scope', 'proměn'], 1), 'T1: JS closure');

    // Topic B: Cooking (complete switch)
    const r2 = await chatForSuite(convId, 'A teď úplně jiné téma — jak se vaří risotto?', signal);
    assert(hasKeywords(r2.response, ['risotto', 'rýž', 'vař', 'bujon', 'míchá', 'jídlo'], 1), 'T2: cooking');
    // Should NOT mention JavaScript
    assert(!hasKeywords(r2.response, ['javascript', 'closure', 'funkce', 'scope'], 1),
      `cooking answer should not mention JS: ${r2.response.substring(0, 200)}`);

    // Topic A return: JavaScript
    const r3 = await chatForSuite(convId, 'Zpět k JavaScriptu — dej mi příklad closure', signal);
    assert(hasKeywords(r3.response, ['closure', 'function', 'const', 'return', 'uzávěr'], 1),
      `should return to JS with example: ${r3.response.substring(0, 200)}`);
  }, 10 * 60_000);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Long Session — Quality Maintenance');
  // ═══════════════════════════════════════════════════════════════════════════

  await serialTest('no JSON leak after many turns', async signal => {
    const convId = await createConvForSuite('long-3', signal);
    created.push(convId);

    // 5 turns of normal conversation
    await chatForSuite(convId, 'Co je REST API?', signal);
    await chatForSuite(convId, 'A jaké jsou HTTP metody?', signal);
    await chatForSuite(convId, 'Vysvětli mi GET vs POST', signal);
    await chatForSuite(convId, 'A co PUT a DELETE?', signal);
    const r5 = await chatForSuite(convId, 'Shrň mi to celé v bodech', signal);

    // After 5 turns: no JSON leak, no metadata leak
    assert(!r5.response.includes('"decision_type"'), 'no JSON metadata leak');
    assert(!r5.response.includes('"intent_type"'), 'no intent type leak');
    assert(!r5.response.includes('"confidence":'), 'no confidence leak');
    assert(r5.response.length > 50, 'summary should be substantive');
  }, 16 * 60_000);

  suite('Long Session — Actual Window Fill and Auto Context');

  await serialTest('crosses context capacity, compacts, and recalls the anchor', async signal => {
    providerRows(); // Missing opt-in capture is an explicit failure, never a false PASS.
    const convId = await createConvForSuite('window-fill-auto-context', signal);
    windowConvId = convId;
    created.push(convId);
    let snapshot;
    let rawTokens = 0;
    let observedWindow = 0;
    let peakProviderTokens = 0;
    let peakPreSummaryEffectiveTokens = 0;
    let firstSummaryTurn = null;

    for (let turn = 1; turn <= 8; turn++) {
      const question = windowFillMessage(turn);
      const { provider } = await capturedChat(convId, question, signal);
      if (observedWindow) {
        assertEqual(provider.numCtx, observedWindow,
          'CHAT provider context window changed during one test conversation');
      }
      observedWindow = provider.numCtx;
      peakProviderTokens = Math.max(peakProviderTokens, provider.promptEvalCount);
      snapshot = await conversationSnapshot(convId, signal);
      rawTokens = snapshot.messages.reduce((sum, message) => sum + Number(message.tokens || 0), 0);
      const preSummaryEffectiveTokens = snapshot.messages.slice(-10)
        .reduce((sum, message) => sum + Number(message.tokens || 0), 0);
      if (firstSummaryTurn === null) {
        peakPreSummaryEffectiveTokens = Math.max(peakPreSummaryEffectiveTokens, preSummaryEffectiveTokens);
      }
      if (snapshot.conversation?.summary && firstSummaryTurn === null) firstSummaryTurn = turn;
      recordFirstSummary(snapshot, turn);
      windowEvidence.turns.push({ turn, requestSha256: provider.requestSha256,
        responseSha256: provider.responseSha256, model: provider.model,
        numCtx: provider.numCtx, numPredict: provider.numPredict,
        promptEvalCount: provider.promptEvalCount,
        rawTokens, preSummaryEffectiveTokens,
        effectiveHistoryTokens: effectiveHistoryTokens(snapshot),
        messageCount: snapshot.messages.length,
        summaryUpToMsgId: snapshot.conversation?.summary_up_to_msg_id ?? null });
      if (rawTokens >= observedWindow && snapshot.conversation?.summary
        && snapshot.messages.length > config.compact.keepTurns) {
        break;
      }
    }

    windowEvidence.observedWindow = observedWindow;
    windowEvidence.peakProviderTokens = peakProviderTokens;
    windowEvidence.peakPreSummaryEffectiveTokens = peakPreSummaryEffectiveTokens;
    windowEvidence.firstSummaryTurn = firstSummaryTurn;
    assert(rawTokens >= observedWindow,
      `raw history did not exceed captured CHAT num_ctx: ${rawTokens}/${observedWindow}`);
    assert(peakPreSummaryEffectiveTokens + 1500
      >= Math.floor(observedWindow * config.compact.threshold),
    `effective pre-summary history did not cross compaction trigger: ${peakPreSummaryEffectiveTokens}+1500/${observedWindow}`);
    assert(snapshot.messages.length > config.compact.keepTurns,
      'history must contain turns old enough to summarize');

    // An earlier threshold crossing with <= keepTurns messages may have
    // started a no-op compaction and its 30 s cooldown. A fresh turn after
    // that cooldown is required because the background check has no timer.
    if (!snapshot.conversation?.summary) {
      await pause(31_000, undefined, { signal });
      snapshot = await conversationSnapshot(convId, signal);
      recordFirstSummary(snapshot, 'cooldown');
      if (!snapshot.conversation?.summary) {
        const { provider } = await capturedChat(convId, windowFillMessage(9), signal);
        snapshot = await conversationSnapshot(convId, signal);
        recordFirstSummary(snapshot, 9);
        windowEvidence.retry = { requestSha256: provider.requestSha256,
          numCtx: provider.numCtx, numPredict: provider.numPredict,
          promptEvalCount: provider.promptEvalCount };
      }
    }

    const deadline = Date.now() + 90_000;
    while (!snapshot.conversation?.summary && Date.now() < deadline) {
      await pause(1000, undefined, { signal });
      snapshot = await conversationSnapshot(convId, signal);
      recordFirstSummary(snapshot, 'poll');
    }
    const { conversation, messages } = snapshot;
    assert(typeof conversation?.summary === 'string' && conversation.summary.length > 0,
      'background auto-context compaction did not persist a summary');
    assert(conversation.summary.includes(WINDOW_FILL_CODE),
      `compacted summary lost the anchor: ${conversation.summary.substring(0, 300)}`);
    const firstUser = messages.find(message => message.role === 'user');
    assert(typeof firstUser?.content === 'string' && firstUser.content.includes(WINDOW_FILL_CODE),
      'the first raw user message is missing its anchor');
    assert(Number(conversation.summary_up_to_msg_id) >= Number(firstUser.id),
      'the first user message was not covered by the persisted summary');
    const rawOnlyLine = firstUser.content.split('\n').find(line => line.startsWith('Záznam 1.12:'));
    assert(rawOnlyLine, 'the raw-only first-turn probe is missing');
    const effectiveTokens = effectiveHistoryTokens(snapshot);
    const persistedTokens = messages.reduce((sum, message) => sum + Number(message.tokens || 0), 0);
    windowEvidence.summary = { text: conversation.summary,
      upToMsgId: conversation.summary_up_to_msg_id,
      persistedTokens, effectiveHistoryTokens: effectiveTokens };
    assert(windowEvidence.firstSummary?.savedTokens > 0,
      `first compaction did not reduce handler history relative to the same messages: ${JSON.stringify(windowEvidence.firstSummary)}`);

    const recallQuestion = 'Jaký přesný auditní kód jsem určil na začátku této konverzace? Odpověz pouze kódem.';
    const { response: recall, provider: finalProvider } = await capturedChat(convId, recallQuestion, signal);
    const finalPrompt = providerPrompt(finalProvider);
    windowEvidence.final = { requestSha256: finalProvider.requestSha256,
      responseSha256: finalProvider.responseSha256, numCtx: finalProvider.numCtx,
      numPredict: finalProvider.numPredict,
      promptEvalCount: finalProvider.promptEvalCount, question: recallQuestion,
      answer: recall.response, providerPrompt: finalPrompt,
      answerMatchesRequestedFormat: recall.response.trim() === WINDOW_FILL_CODE,
      rawFirstMessagePresent: finalPrompt.includes(firstUser.content),
      rawFirstMidLinePresent: finalPrompt.includes(rawOnlyLine) };
    assert(finalPrompt.includes('[Souhrn předchozí konverzace]'),
      'the captured final provider prompt omitted the persisted summary');
    assert(finalPrompt.includes(WINDOW_FILL_CODE),
      'the captured final provider prompt lost the anchor');
    assert(!windowEvidence.final.rawFirstMessagePresent && !windowEvidence.final.rawFirstMidLinePresent,
      'the captured final provider prompt still contains raw first-turn history');
    assert(recall.response.includes(WINDOW_FILL_CODE),
      `final model response lost the compacted anchor: ${recall.response.substring(0, 200)}`);
    assert(windowEvidence.final.answerMatchesRequestedFormat,
      `final model response did not follow the requested code-only format: ${recall.response.substring(0, 200)}`);
    windowEvidence.status = 'PASS';
  }, 35 * 60_000);

} finally {
  if (windowConvId) {
    try {
      const snapshot = await conversationSnapshot(windowConvId, AbortSignal.timeout(5_000));
      windowEvidence.finalSnapshot = snapshot;
    } catch (error) {
      windowEvidence.snapshotError = String(error?.message || error);
    }
  }
  try {
    saveWindowEvidence();
  } finally {
    for (const id of created) await cleanupConvForSuite(id);
  }
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
