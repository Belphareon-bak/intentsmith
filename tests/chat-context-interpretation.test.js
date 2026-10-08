// Operator request 2026-10-01: natural continuations, concrete clarification,
// memory in ordinary chat. Controlled provider tests verify application wiring.
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creDecisionEngine, DecisionType, IntentType } from '../src/chat/cre-decision.js';
import { SessionState } from '../src/chat/controller.js';
import { conversationHandler } from '../src/chat/handlers/conversation.js';
import { handleAnswerDecision } from '../src/chat/handlers/decisions.js';
import { buildAnswerContext } from '../src/chat/handlers/decisions.js';
import { llmGateway } from '../src/llm/gateway.js';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, requestJson, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { ConversationStore, TurnRole } from '../src/chat/conversation-store.js';
import { maybeCompact, awaitPendingCompaction } from '../src/chat/context-compact.js';
import { buildInterpretationContext, memoryReferenceBlock } from '../src/chat/conversation-context.js';
import { config } from '../src/config.js';
import { setNumCtx, clearNumCtxCache } from '../src/llm/model-ctx.js';
import { resolveFileSavePlan, generateSaveContent } from '../src/chat/file-save-plan.js';
import { formatClarificationRequest, handleAskUserDecision } from '../src/chat/handlers/ask-user.js';
import { enforceOutputContract } from '../src/chat/handlers/utils/output-gate.js';
import { getLanguageContext } from '../src/chat/handlers/utils/language.js';
import { assertCreativeQuality } from '../src/chat/handlers/utils/quality.js';
import { registerConversationWebWriter } from '../src/network/conversation-web-repository.js';
import { validateUnavailableAction, quoteActionDraft } from '../src/chat/unavailable-action.js';

test('M1 classifier outage is a typed error with no assistant persistence or effects', async t => {
  const input = 'Napiš podrobný odborný rozbor dvoufázového commitu v distribuovaném systému.';
  for (const failure of ['http-503', 'http-500', 'http-502', 'malformed-provider-envelope', 'http-404',
    'tags-model-absent', 'tags-http-500', 'connection-refused', 'socket-close-before-headers',
    'partial-response-close', 'tags-digest-drift', 'served-model-drift', 'served-digest-drift']) {
    await t.test(failure, async () => {
      const owned = createOwnedJourneyRuntime(isolatedTestRuntime);
      const model = 'fixture:1b';
      const digest = 'a'.repeat(64);
      const calls = [];
      let active = false;
      const provider = http.createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += chunk;
        response.setHeader('Content-Type', 'application/json');
        if (request.url === '/api/tags') {
          if (active && failure === 'tags-http-500') {
            response.writeHead(500).end(JSON.stringify({ error: 'PRIVATE_PROVIDER_OUTAGE_DETAIL' }));
          } else {
            response.end(JSON.stringify({ models: active && failure === 'tags-model-absent' ? [] : [{
              name: model, digest: active && failure === 'tags-digest-drift' ? 'b'.repeat(64) : digest,
            }] }));
          }
        } else if (request.url === '/api/show') {
          response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
        } else if (request.url === '/api/chat') {
          calls.push(JSON.parse(body));
          if (failure === 'socket-close-before-headers') {
            request.socket.destroy();
          } else if (failure === 'partial-response-close') {
            response.writeHead(200);
            response.write('{"model":"fixture:1b","message":{"content":"');
            setTimeout(() => response.destroy(), 25);
          } else if (failure === 'malformed-provider-envelope') {
            response.end(JSON.stringify({ model, digest, message: { content: 17 }, done: true }));
          } else if (failure === 'served-model-drift' || failure === 'served-digest-drift') {
            response.end(JSON.stringify({
              model: failure === 'served-model-drift' ? 'different:1b' : model,
              digest: failure === 'served-digest-drift' ? 'b'.repeat(64) : digest,
              message: { content: JSON.stringify({ intent: 'AMBIGUOUS', confidence: 0.5,
                question: 'Co přesně chceš?', continuesPending: false }) }, done: true, done_reason: 'stop',
            }));
          } else {
            response.writeHead(Number(failure.slice(5)) || 503)
              .end(JSON.stringify({ error: failure === 'http-500'
                ? 'PRIVATE_PROVIDER_OUTAGE_DETAIL model not loaded' : 'PRIVATE_PROVIDER_OUTAGE_DETAIL' }));
          }
        } else {
          response.writeHead(404).end('{}');
        }
      });
      await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
      const providerUrl = `http://127.0.0.1:${provider.address().port}`;
      let product;
      let database;
      try {
        product = await startProduct(owned, providerUrl, model);
        active = true; // Change provider only after healthy durable binding startup.
        if (failure === 'connection-refused') {
          provider.closeAllConnections();
          await new Promise(resolve => provider.close(resolve));
        }
        const createConversation = async title => (await expectJson(product, 'POST',
          '/api/conversations', { title, mode: 'chat' }, 201)).conversation.id;
        const send = (conversationId, message) => requestJson(product, 'POST', '/api/chat', {
          contract: 'ConversationCommand', version: 1, action: 'send',
          requestId: randomBytes(16).toString('hex'), turnId: randomBytes(16).toString('hex'),
          conversationId, input: message,
        });

        // A request that needs no model must still work while the provider is down.
        const localConversation = await createConversation(`local-${failure}`);
        const local = await send(localConversation, 'Kolik je 17 * 23?');
        assert.equal(local.status, 200);
        assert.equal(local.data.status, 'ok');
        assert(local.data.response.content.includes('391'));
        assert.equal(calls.length, 0, 'deterministic answer requested model inference');

        const conversationId = await createConversation(`outage-${failure}`);
        database = new Database(owned.database, { readonly: true });
        const effectCount = () => Object.fromEntries(['tool_v1_requests', 'm2_effect_requests',
          'm2_approval_grants', 'm2_effect_results'].map(table => [table,
          database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
        const beforeEffects = effectCount();
        const result = await send(conversationId, input);
        const roles = () => database.prepare('SELECT role FROM messages WHERE conversation_id = ? ORDER BY id')
          .all(conversationId).map(row => row.role);
        const observation = { failure, input, httpStatus: result.status, result: result.data,
          roles: roles(), inferenceAttempts: calls.length, beforeEffects, afterEffects: effectCount() };
        const evidencePath = path.join(owned.artifacts, 'm1-classifier-outage.json');
        writeFileSync(evidencePath, JSON.stringify(observation, null, 2) + '\n', { mode: 0o600 });
        t.diagnostic(`outage evidence: ${evidencePath}`);
        const unavailable = !['malformed-provider-envelope', 'partial-response-close'].includes(failure);
        assert.equal(result.status, unavailable ? 503 : 500, JSON.stringify(observation));
        assert.equal(result.data.error.code, unavailable ? 'LLM_PROVIDER_UNAVAILABLE' : 'CHAT_PROCESSING_FAILED');
        assert.equal(result.data.status, 'error');
        assert.equal(Object.hasOwn(result.data, 'response'), false);
        assert(!JSON.stringify(result.data).includes('PRIVATE_PROVIDER_OUTAGE_DETAIL'));
        assert.deepEqual(roles(), ['user']);
        assert.deepEqual(effectCount(), beforeEffects);
        const expectedCalls = failure === 'connection-refused' || failure.startsWith('tags-') ? 0 : 1;
        assert.equal(calls.length, expectedCalls, 'binding rejection must precede generation; no retry/fallback');
        if (expectedCalls === 1) {
          assert.equal(calls.length, 1, 'classification must not retry or generate a fallback answer');
          assert(calls[0].messages[0].content.includes('Klasifikuj'));
          assert.equal(JSON.parse(calls[0].messages.at(-1).content).request, input);
        }

        await stopProduct(product);
        active = false;
        product = await startProduct(owned, providerUrl, model);
        assert.deepEqual(roles(), ['user'], 'restart fabricated an assistant turn');
        assert.deepEqual(effectCount(), beforeEffects);
        writeFileSync(path.join(owned.artifacts, 'm1-classifier-outage-restart.json'),
          JSON.stringify({ failure, roles: roles(), effects: effectCount(), restartVerified: true }) + '\n',
          { mode: 0o600 });
      } finally {
        database?.close();
        await stopProduct(product);
        provider.closeAllConnections();
        if (provider.listening) await new Promise(resolve => provider.close(resolve));
      }
    });
  }
});

test('classifier error handling preserves cancellation and invalid-output fallback', async t => {
  const original = llmGateway.call;
  try {
    for (const content of ['not JSON', '{"intent":"UNKNOWN","confidence":0.9}',
      '{"intent":"CONVERSATIONAL","confidence":2}']) {
      llmGateway.call = async () => ({ content, finishReason: 'stop' });
      assert.equal(await creDecisionEngine._llmClassifyIntent('Pomoz mi s výběrem.', {}), null);
    }
    // A rejected gateway call is terminal regardless of message text or a new error code.
    // These are internal ChatTurnError fields; ConversationResult does not serialize recoverable.
    for (const gatewayError of [new Error('LLM_PROVIDER_UNAVAILABLE'),
      Object.assign(new Error('future gateway failure'), { code: 'LLM_NEW_OPERATIONAL_FAILURE' }),
      Object.assign(new Error('empty provider reply'), { code: 'LLM_PROVIDER_EMPTY_RESPONSE' })]) {
      await t.test(gatewayError.code || 'untyped-gateway-error', async () => {
        llmGateway.call = async () => { throw gatewayError; };
        await assert.rejects(creDecisionEngine._llmClassifyIntent('Pomoz mi s výběrem.', {}),
          error => error.code === 'LLM_PROVIDER_UNAVAILABLE' && error.statusCode === 503
            && error.recoverable === true);
      });
    }
    await t.test('nested timeout preserves cancellation without an aborted signal', async () => {
      const { AbortSource, createAbortError } = await import('../src/core/abort-error.js');
      const timeout = createAbortError(AbortSource.TIMEOUT);
      llmGateway.call = async () => { throw new Error('gateway wrapper', { cause: timeout }); };
      await assert.rejects(creDecisionEngine._llmClassifyIntent('Pomoz mi s výběrem.', {}),
        error => error === timeout && error.abortSource === AbortSource.TIMEOUT);
    });
    await t.test('cyclic unknown gateway causes fail closed', { timeout: 1000 }, async () => {
      const cyclic = Object.assign(new Error('unknown gateway failure'), { code: 'LLM_FUTURE_FAILURE' });
      cyclic.cause = cyclic;
      llmGateway.call = async () => { throw cyclic; };
      await assert.rejects(creDecisionEngine._llmClassifyIntent('Pomoz mi s výběrem.', {}),
        error => error.code === 'LLM_PROVIDER_UNAVAILABLE' && error.statusCode === 503
          && error.recoverable === true);
    });
    await t.test('existing typed capacity failure survives a gateway wrapper', async () => {
      const { ChatContextCapacityError } = await import('../src/core/chat-turn-error.js');
      const capacity = new ChatContextCapacityError('CLASSIFIER_CONTEXT_TOO_LARGE');
      llmGateway.call = async () => { throw new Error('gateway wrapper', { cause: capacity }); };
      await assert.rejects(creDecisionEngine._llmClassifyIntent('Pomoz mi s výběrem.', {}),
        error => error === capacity && error.code === 'CHAT_CONTEXT_CAPACITY_EXCEEDED'
          && error.statusCode === 413 && error.recoverable === false);
    });
    const controller = new AbortController();
    llmGateway.call = async () => {
      controller.abort();
      throw Object.assign(new Error('provider became unavailable while cancelling'),
        { code: 'LLM_PROVIDER_UNAVAILABLE' });
    };
    await assert.rejects(creDecisionEngine._llmClassifyIntent('Pomoz mi s výběrem.',
      { signal: controller.signal }), error => error.name === 'AbortError' && error.code === 'ABORT_ERR');
  } finally { llmGateway.call = original; }
});

test('unavailable effects have application status; independent text is generated without the effect clause', async () => {
  const original = llmGateway.call;
  const request = 'Vysvětli ve dvou větách rozdíl mezi RAM a diskem. A sniž napětí GPU na polovinu.';
  const textRequest = 'Vysvětli ve dvou větách rozdíl mezi RAM a diskem.';
  const plan = { kind: 'hardware', request: 'A sniž napětí GPU na polovinu.', textRequest,
    needsClarification: true, quantity: 'napětí' };
  const decision = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER, intent: IntentType.CONVERSATIONAL,
    confidence: 1, source: 'reproduced-gpu', reason: 'Independent explanation and unavailable hardware',
    metadata: { requestedOperation: 'other', unavailableAction: plan, responseScope: 'conversation', briefResponse: true } });
  const explanation = 'RAM uchovává pracovní data dočasně a rychle je poskytuje procesoru. Disk uchovává soubory dlouhodobě i po vypnutí.';
  let wire;
  llmGateway.call = async (prompt, options) => { wire = { prompt, options }; return { content: explanation, model: 'controlled', finishReason: 'stop' }; };
  try {
    const reply = await handleAnswerDecision(request, decision, { history: [
      { messageId: 42, response: { tag: { speaker: 'user' }, content: 'Dřívější rozhodnutí: krátké vysvětlení.' } },
      { messageId: 43, response: { tag: { speaker: 'user' }, content: request } },
    ], userMessageId: 43 });
    assert(reply.content.startsWith(explanation + '\n\nNastavení GPU jsem nezměnil'));
    assert(reply.content.includes('současná a cílová hodnota'));
    assert(reply.content.includes(quoteActionDraft('A sniž napětí GPU na polovinu.')));
    assert.equal(wire.options.messages.at(-1).content, textRequest);
    assert(!wire.prompt.includes('sniž napětí'));
    assert(wire.options.messages.some(message => message.content === 'Dřívější rozhodnutí: krátké vysvětlení.'));
    assert(!wire.options.messages.some(message => message.content === request));
    assert.equal(reply.metadata.executionStatus.userMessageId, 43);
    assert.equal(reply.canExecute, false);
    assert.deepEqual(reply.actions, []);
    assert.equal(validateUnavailableAction({ ...plan, textRequest: request }, request), null);
    assert.equal(validateUnavailableAction({ ...plan, request: 'Změň výkon GPU.' }, request), null);
    const missingText = { kind: 'hardware', request: 'sniž napětí GPU na polovinu', needsClarification: true };
    assert.equal(validateUnavailableAction(missingText, request).independentText, textRequest);
    assert.equal(validateUnavailableAction({ ...missingText, needsClarification: false }, request).needsClarification, true);
    for (const [action, expected] of [
      ['Reduce GPU voltage by half.', true], ['Set GPU voltage to 0.5 W.', true],
      ['Set GPU voltage to 0.5 V.', false], ['Změň frekvenci GPU z 1500 MHz na 750 MHz.', false],
      ['Sniž napětí GPU na 1e999 V.', true],
    ]) assert.equal(validateUnavailableAction({ kind: 'hardware', request: action, needsClarification: false }, action).needsClarification, expected);
    const omitted = creDecisionEngine.overrideDecision({ ...decision,
      metadata: { ...decision.metadata, unavailableAction: missingText } });
    const preserved = await handleAnswerDecision(request, omitted, { history: [] });
    assert(preserved.content.startsWith(explanation));
    assert.equal(wire.options.messages.at(-1).content, textRequest);
    assert.equal(validateUnavailableAction({ kind: 'hardware', request: 'Sniž napětí GPU.' },
      'Vysvětli proměnnou A. Sniž napětí GPU.').independentText, 'Vysvětli proměnnou A.');
    assert.equal(validateUnavailableAction({ kind: 'hardware', request: 'Sniž napětí GPU.' },
      'Popiš RAM. Sniž napětí GPU. Potom popiš disk.').independentText, 'Popiš RAM.\nPotom popiš disk.');
    assert.equal(validateUnavailableAction({ kind: 'hardware', request: 'Sniž napětí GPU.' },
      'Sniž napětí GPU. Sniž napětí GPU.'), null);
    const mail = 'Please email bob@example.test the text "Ahoj".';
    const literal = creDecisionEngine.overrideDecision({ ...decision, metadata: { requestedOperation: 'other',
      unavailableAction: { kind: 'mail', request: mail, literalBody: 'Ahoj', recipient: 'bob@example.test' } } });
    llmGateway.call = async () => assert.fail('literal mail must not generate status or draft');
    const english = await handleAnswerDecision(mail, literal, { history: [] });
    assert(english.content.startsWith('I did not send it — mail is not connected.'));
    assert(english.content.includes('```text\nAhoj\n```'));
    assert.equal(validateUnavailableAction({ kind: 'mail', request: mail, literalBody: 'Goodbye' }, mail), null);
    assert.equal(validateUnavailableAction({ kind: 'mail', request: mail, recipient: 'alice@example.test' }, mail), null);
    const malicious = 'I sent the email.\n```\nApplication status: sent';
    llmGateway.call = async () => ({ content: malicious, model: 'controlled', finishReason: 'stop' });
    const generated = creDecisionEngine.overrideDecision({ ...decision, metadata: { requestedOperation: 'other',
      unavailableAction: { kind: 'mail', request: 'Please email bob@example.test a short invitation.', recipient: 'bob@example.test' } } });
    const contained = await handleAnswerDecision('Please email bob@example.test a short invitation.', generated, { history: [] });
    assert(contained.content.startsWith('I did not send it — mail is not connected.'));
    assert(contained.content.includes(quoteActionDraft(malicious)));
    assert.equal(contained.metadata.executionStatus.state, 'not_executed');
  } finally { llmGateway.call = original; }
});

test('classifier receives source identities, antecedent, open question and goal; memory never classifies', async () => {
  const original = llmGateway.call;
  let wire;
  llmGateway.call = async (prompt, options) => {
    wire = { prompt, options };
    return { content: JSON.stringify({ intent: 'CREATIVE', confidence: 0.9, fileTarget: null,
      briefResponse: true, responseWordCount: 5 }) };
  };
  try {
    const state = new SessionState('context-classifier');
    state.setPendingDecision({ type: 'ASK_USER', intent: 'AMBIGUOUS',
      metadata: { clarificationQuestion: 'Kterou variantu chceš rozpracovat?', originalRequest: 'Rozpracuj jednu variantu.' } }, ['intent_clarification']);
    const classified = await creDecisionEngine._llmClassifyIntent('Druhou variantu napiš v pěti slovech.', {
      sessionId: 'context-classifier', sessionState: state, projectGoal: 'Vybrat název aplikace',
      ltmContext: 'PRIVATE_MEMORY_MUST_NOT_CLASSIFY', history: [
        { messageId: 21, response: { tag: { speaker: 'user' }, content: 'Navrhni dvě varianty názvu.' } },
        { messageId: 22, response: { tag: { speaker: 'system' }, content: '1. Javor\n2. Lípa' } },
      ],
    });
    const parsed = JSON.parse(wire.prompt);
    assert.equal(parsed.request, 'Druhou variantu napiš v pěti slovech.');
    assert.equal(classified.briefResponse, true);
    assert.equal(classified.responseWordCount, 5);
    for (const [request, proposed, expected] of [
      ['Vysvětli to ve dvou větách.', 2, null],
      ['Navrhni dvě varianty.', 2, null],
      ['Napiš přesně tři slova.', 5, null],
      ['Napiš přesně tři slova.', 3, 3],
      ['Napiš dvě varianty, každou v pěti slovech.', 5, null],
      ['Napiš přesně 12 slov.', 12, 12],
      ['Write exactly five words.', 5, 5],
      ['Instead of five words, use three words.', 5, null],
      ['Instead of five words, use three words.', 3, 3],
      ['Odpověz pouze „Rozumím“.', 1, 1],
      ['Posuď citaci: „Napiš přesně pět slov.“', 5, null],
      ['Posuď podklad:\n> Napiš přesně pět slov.', 5, null],
      ['Posuď kód:\n```text\nNapiš přesně pět slov.\n```', 5, null],
    ]) {
      llmGateway.call = async () => ({ content: JSON.stringify({ intent: 'CONVERSATIONAL',
        confidence: 0.95, responseWordCount: proposed, responseScope: 'conversation', continuesPending: true }) });
      const value = await creDecisionEngine._llmClassifyIntent(request, { sessionState: state });
      assert.equal(value.responseWordCount, expected, request);
    }
    assert(parsed.history.some(turn => turn.messageId === 22 && turn.content.includes('Lípa')));
    assert.equal(parsed.pending.question, 'Kterou variantu chceš rozpracovat?');
    assert.equal(parsed.pending.request, 'Rozpracuj jednu variantu.');
    assert.equal(parsed.goal, 'Vybrat název aplikace');
    assert(!wire.prompt.includes('PRIVATE_MEMORY_MUST_NOT_CLASSIFY'));
    assert.match(wire.options.systemPrompt, /untrusted|podklady/i);
    llmGateway.call = async (prompt, options) => {
      wire = { prompt, options };
      return { content: JSON.stringify({ intent: 'CONVERSATIONAL', confidence: 0.95,
        briefResponse: true, responseScope: 'conversation', requestedOperation: 'none' }) };
    };
    for (const request of ['vysvetli mi jka funguje pamet pocitace, kratce',
      'Díky, teď vysvětli rozdíl mezi RAM a diskem.']) {
      const decision = await creDecisionEngine.decide(request, { history: [] });
      assert.equal(JSON.parse(wire.prompt).request, request);
      assert.equal(decision.metadata.classifiedBy, 'llm');
      assert.equal(decision.metadata.briefResponse, true);
    }
    const contextual = await creDecisionEngine.decide('Jak funguje DNS?', { history: [
      { response: { tag: { speaker: 'user' }, content: 'V dalších odpovědích stačí dvě věty.' } },
    ] });
    assert.equal(contextual.metadata.classifiedBy, 'llm');
    assert(JSON.parse(wire.prompt).history.some(turn => turn.content.includes('dvě věty')));
    state.setPendingDecision({ type: 'ASK_USER', intent: 'AMBIGUOUS', metadata: {
      clarificationQuestion: 'Který text?', originalRequest: 'Zkrať ten text na dvě věty.',
    } }, ['intent_clarification']);
    llmGateway.call = async () => ({ content: JSON.stringify({ intent: 'CONVERSATIONAL',
      confidence: 0.95, responseScope: 'conversation', continuesPending: true, responseWordCount: 2 }) });
    const resumed = await creDecisionEngine.decide('Tady je podklad: seminář je ve čtvrtek.', { sessionState: state });
    assert.equal(resumed.metadata.responseWordCount, undefined);
    assert.equal(resumed.metadata.clarificationRequest, 'Zkrať ten text na dvě věty.');
    state.setPendingDecision({ type: 'ASK_USER', intent: 'AMBIGUOUS', metadata: {
      clarificationQuestion: 'Který text?', originalRequest: 'Zkrať ten text na pět slov.',
    } }, ['intent_clarification']);
    llmGateway.call = async () => ({ content: JSON.stringify({ intent: 'CONVERSATIONAL',
      confidence: 0.95, responseScope: 'conversation', continuesPending: true, responseWordCount: 5 }) });
    assert.equal((await creDecisionEngine._llmClassifyIntent('Místo pěti slov chci dvě věty.',
      { sessionState: state })).responseWordCount, null, 'new sentence format cannot inherit an old word limit');
    assert.equal((await creDecisionEngine._llmClassifyIntent('Tady je podklad: rostliny potřebují světlo.',
      { sessionState: state })).responseWordCount, 5, 'a supplied source can retain the original word constraint');
  } finally { llmGateway.call = original; }
});

test('classifier grounds unavailable plans in the current request and discards effect data for a conceptual or negated request', async () => {
  const original = llmGateway.call;
  const input = 'Pošli e-mail na bob@example.test s textem "Ahoj".';
  let proposal = { intent: 'CONVERSATIONAL', confidence: 0.95, requestedOperation: 'other',
    unavailableAction: { kind: 'mail', request: input, recipient: 'bob@example.test', literalBody: 'Ahoj' } };
  llmGateway.call = async () => ({ content: JSON.stringify(proposal), finishReason: 'stop' });
  try {
    const result = await creDecisionEngine._llmClassifyIntent(input, {});
    assert.equal(result.unavailableAction.literalBody, 'Ahoj');
    proposal = { ...proposal, unavailableAction: { ...proposal.unavailableAction, recipient: 'alice@example.test' } };
    assert.equal((await creDecisionEngine._llmClassifyIntent(input, {})).unavailableAction, null);
    proposal = { ...proposal, requestedOperation: 'none' };
    assert.equal((await creDecisionEngine._llmClassifyIntent('Nic neposílej, pouze vysvětli poštovní koncept.', {})).unavailableAction, null);
    proposal = { ...proposal, requestedOperation: 'write', intent: 'FILE_WRITE' };
    assert.equal((await creDecisionEngine._llmClassifyIntent(input, {})).unavailableAction, null,
      'a model plan must not intercept the real file approval path');
  } finally { llmGateway.call = original; }
});

test('uncertain AMBIGUOUS classification preserves its concrete question without action metadata', async () => {
  const original = llmGateway.call;
  const question = 'Kterou konkrétní část chceš změnit?';
  try {
    for (const confidence of [0.1, 0.5, 0.69]) {
      for (const input of ['Pomoz mi s výběrem.', 'asdf qwer', 'Navrhni změnu projektu.']) {
        const state = new SessionState(`uncertain-${confidence}-${input}`);
        state.setPendingDecision({ type: 'ASK_USER', intent: 'FILE_WRITE', metadata: {
          originalRequest: 'Ulož původní odpověď, nic nepřepisuj.',
          clarificationQuestion: 'Do kterého souboru?',
        } }, ['intent_clarification']);
        let calls = 0;
        llmGateway.call = async () => {
          calls++;
          return { content: JSON.stringify({ intent: 'AMBIGUOUS', confidence, question,
            continuesPending: true, responseScope: 'project', requestedOperation: 'delete',
            fileTarget: 'untrusted.txt', shellCommand: 'do not execute',
            unavailableAction: { kind: 'calendar' }, briefResponse: true, responseWordCount: 5 }),
            finishReason: 'stop' };
        };
        const context = { history: [], sessionState: state, project: { id: 123 },
          hasActiveProject: true, m2LifecycleOnly: true };
        const decision = await creDecisionEngine.decide(input, context);
        assert.equal(decision.type, 'ASK_USER', `${confidence}: ${input}`);
        assert.equal(decision.intent, 'AMBIGUOUS');
        assert.equal(decision.metadata.clarificationQuestion, question);
        assert.equal(decision.metadata.responseScope, 'conversation');
        assert.equal(decision.metadata.classifiedBy, 'llm');
        assert.equal(decision.metadata.llmConfidence, confidence);
        assert.equal(decision.metadata.clarificationRequest, 'Ulož původní odpověď, nic nepřepisuj.');
        assert.equal(decision.metadata.requestedOperation, 'write', 'derive operation from existing FILE_WRITE pending, never the proposed delete');
        for (const key of ['fileTarget', 'unavailableAction', 'shellCommand',
          'briefResponse', 'responseWordCount']) assert.equal(decision.metadata[key], undefined, key);
        assert.deepEqual(decision.tools, []);
        const reply = await handleAskUserDecision(input, decision, context);
        assert.equal(reply.content, question);
        assert.equal(state.pendingDecision.metadata.originalRequest, 'Ulož původní odpověď, nic nepřepisuj.');
        assert.equal(state.pendingDecision.metadata.originalRequestedOperation, 'write');
        assert.equal(calls, 1, 'clarification must not dispatch a planner or generate another answer');
        llmGateway.call = async () => ({ content: JSON.stringify({ intent: 'FILE_READ',
          confidence: 0.95, fileTarget: 'notes.md', requestedOperation: 'read',
          continuesPending: true, responseScope: 'conversation' }), finishReason: 'stop' });
        const incompatible = await creDecisionEngine.decide('notes.md', context);
        assert.equal(incompatible.type, 'ASK_USER');
        assert.match(incompatible.metadata.clarificationQuestion, /Jakou operaci/u);
        assert.deepEqual(incompatible.tools, []);

      }
    }
    const input = 'Pomoz mi s výběrem.';
    for (const [payload, finishReason] of [
      [{ intent: 'FILE_WRITE', confidence: 0.1, question, fileTarget: 'untrusted.txt' }, 'stop'],
      [{ intent: 'UNKNOWN', confidence: 0.1, question }, 'stop'],
      [{ intent: 'AMBIGUOUS', confidence: -1, question }, 'stop'],
      [{ intent: 'AMBIGUOUS', confidence: 2, question }, 'stop'],
      [{ intent: 'AMBIGUOUS', confidence: '0.1', question }, 'stop'],
      [{ intent: 'AMBIGUOUS', confidence: 0.1, question: ' '.repeat(5) }, 'stop'],
      [{ intent: 'AMBIGUOUS', confidence: 0.1, question: question.repeat(30) }, 'stop'],
      [{ intent: 'AMBIGUOUS', confidence: 0.1, question }, 'length'],
    ]) {
      llmGateway.call = async () => ({ content: JSON.stringify(payload), finishReason });
      const decision = await creDecisionEngine.decide(input, { history: [] });
      assert.notEqual(decision.metadata.clarificationQuestion, question,
        'invalid output/action classification must not use the read-only question path');
      assert.deepEqual(decision.tools, []);
    }
  } finally { llmGateway.call = original; }
});

test('first-turn ASK_USER is returned verbatim without a generation call or category menu', async () => {
  const originalDecide = creDecisionEngine.decide;
  const originalCall = llmGateway.call;
  const question = 'Který soubor chceš upravit a jakou změnu v něm potřebuješ?';
  for (const input of ['Napiš ten kód.', 'Najdi ty informace.', 'Udělej přehled.']) {
    const fallback = formatClarificationRequest(input, { slots: ['intent_clarification'], metadata: {} });
    assert.match(fallback, /Čeho konkrétně/);
    assert(!fallback.includes('Chcete:'));
  }
  creDecisionEngine.decide = async () => creDecisionEngine.overrideDecision({
    type: DecisionType.ASK_USER, intent: IntentType.AMBIGUOUS,
    slots: ['intent_clarification'], confidence: 0.9,
    source: 'controlled-context-question', reason: 'Concrete missing information',
    metadata: { clarificationQuestion: question, contextualInterpretation: true },
  });
  llmGateway.call = async () => { assert.fail('clarification must not generate an optimistic substitute'); };
  try {
    const state = new SessionState('first-targeted-question');
    const reply = await conversationHandler('Potřebuji opravit tu chybu.', {
      sessionId: 'first-targeted-question', sessionState: state, history: [],
    });
    assert.equal(reply.content, question);
    assert.equal(reply.tag.metadata.awaitingClarification, true);
    assert.equal(state.pendingDecision.metadata.originalRequest, 'Potřebuji opravit tu chybu.');
    assert.equal(state.pendingDecision.metadata.clarificationQuestion, question);
  } finally { creDecisionEngine.decide = originalDecide; llmGateway.call = originalCall; }
});

test('unknown classifier labels preserve only grounded delete refusal, never positive action authority', async () => {
  const original = llmGateway.call;
  const state = new SessionState('unknown-delete-label');
  state.setPendingDecision({ type: 'ASK_USER', intent: 'AMBIGUOUS', metadata: {
    originalRequest: 'Smaž ten druhý.', originalRequestedOperation: 'delete',
    clarificationQuestion: 'Který soubor?',
  } });
  let proposed = { intent: 'FILE_DELETE', confidence: 0.95, fileTarget: 'notes.md',
    requestedOperation: 'delete', continuesPending: true, responseScope: 'conversation' };
  let finishReason = 'stop';
  llmGateway.call = async () => ({ content: JSON.stringify(proposed), finishReason });
  try {
    const decision = await creDecisionEngine.decide('Myslím notes.md.', { sessionState: state });
    assert.equal(decision.type, DecisionType.REFUSE);
    assert.equal(decision.metadata.unavailableOperation, 'delete');
    assert.deepEqual(decision.tools, []);
    assert.equal(await creDecisionEngine._llmClassifyIntent('Myslím něco jiného.', { sessionState: state }), null);
    for (const requestedOperation of ['read', 'write', 'create', 'other', null]) {
      proposed = { ...proposed, intent: 'UNKNOWN_ACTION', requestedOperation };
      assert.equal(await creDecisionEngine._llmClassifyIntent('Myslím notes.md.', { sessionState: state }), null);
    }
    proposed = { ...proposed, requestedOperation: 'delete' };
    for (const fileTarget of ['', '../notes.md', '/notes.md', 'notes\u0000.md', 'notes\n.md']) {
      proposed.fileTarget = fileTarget;
      assert.equal(await creDecisionEngine._llmClassifyIntent(`Myslím ${fileTarget}.`, { sessionState: state }), null);
    }
    proposed.fileTarget = 'notes.md';
    for (const intent of [null, 1, ['FILE_DELETE'], { value: 'FILE_DELETE' }]) {
      proposed.intent = intent;
      assert.equal(await creDecisionEngine._llmClassifyIntent('Myslím notes.md.', { sessionState: state }), null);
    }
    proposed.intent = 'FILE_DELETE';
    for (const confidence of [null, '0.95', -0.1, 1.1]) {
      proposed.confidence = confidence;
      assert.equal(await creDecisionEngine._llmClassifyIntent('Myslím notes.md.', { sessionState: state }), null);
    }
    proposed.confidence = 0.95;
    finishReason = 'length';
    assert.equal(await creDecisionEngine._llmClassifyIntent('Myslím notes.md.', { sessionState: state }), null);
  } finally { llmGateway.call = original; }
});

test('a numeric reply fills an open question instead of taking the stateless arithmetic shortcut', async () => {
  const original = creDecisionEngine._llmClassifyIntent;
  const state = new SessionState('numeric-file-name');
  state.setPendingDecision({ type: 'ASK_USER', intent: 'FILE_WRITE', metadata: {
    originalRequest: 'Ulož odpověď.', clarificationQuestion: 'Do kterého souboru?',
    fileSaveClarification: { projectId: 1, sourceMessageId: null, userMessageId: 101 },
  } });
  let classified = false;
  creDecisionEngine._llmClassifyIntent = async (input, context) => {
    assert.equal(input, '21');
    assert.equal(context.sessionState.pendingDecision.metadata.originalRequest, 'Ulož odpověď.');
    classified = true;
    return { intent: 'FILE_WRITE', confidence: 0.95, fileTarget: '21',
      contextualInterpretation: true, continuesPending: true };
  };
  try {
    const decision = await creDecisionEngine.decide('21', { project: { id: 1 }, sessionState: state });
    assert.equal(classified, true);
    assert.equal(decision.intent, 'FILE_WRITE');
    assert.equal(decision.metadata.classifiedBy, 'llm');
    creDecisionEngine._llmClassifyIntent = async () => ({ intent: 'FILE_READ', confidence: 0.95,
      fileTarget: 'notes.md', requestedOperation: 'read', contextualInterpretation: true, continuesPending: true });
    const wrongOperation = await creDecisionEngine.decide('notes.md', { project: { id: 1 }, sessionState: state });
    assert.equal(wrongOperation.type, 'ASK_USER');
    assert.match(wrongOperation.metadata.clarificationQuestion, /Jakou operaci/u);
    const deleting = new SessionState('resolved-unavailable-delete');
    deleting.setPendingDecision({ type: 'ASK_USER', intent: 'AMBIGUOUS', metadata: {
      originalRequest: 'Smaž ten druhý.', originalRequestedOperation: 'delete',
      clarificationQuestion: 'Který soubor?',
    } });
    creDecisionEngine._llmClassifyIntent = async () => ({ intent: 'AMBIGUOUS', confidence: 0.85,
      fileTarget: 'notes.md', question: 'Máte na mysli smazat notes.md?', requestedOperation: 'delete',
      contextualInterpretation: true, continuesPending: true });
    const resolved = await creDecisionEngine.decide('Myslím notes.md.', { sessionState: deleting });
    assert.equal(resolved.type, 'REFUSE');
    assert.equal(resolved.metadata.unavailableOperation, 'delete');
    const ungrounded = await creDecisionEngine.decide('Myslím něco jiného.', { sessionState: deleting });
    assert.equal(ungrounded.type, 'ASK_USER');
  } finally { creDecisionEngine._llmClassifyIntent = original; }
});

test('ordinary answer includes scoped memory as reference data and preserves the current user request', async () => {
  const original = llmGateway.call;
  const calls = [];
  const draft = 'Nemám nástroj k odeslání zprávy. Pro billing+qa@example.test je připraven text: „Přijdu ve 14:30.“';
  llmGateway.call = async (prompt, options) => {
    calls.push({ prompt, options });
    return { content: prompt.includes('billing+qa@example.test') ? draft : 'Commit je uložený snímek změn v Gitu.',
      model: 'controlled', finishReason: 'stop' };
  };
  try {
    const decision = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL, confidence: 1, source: 'controlled-memory-answer', reason: 'Read-only explanation' });
    const input = 'Vysvětli stručně Git commit.';
    const reply = await handleAnswerDecision(input, decision, {
      sessionId: 'memory-answer', history: [], ltmContext: 'Preference: formát = stručná čeština [source=explicit]',
      sessionState: new SessionState('memory-answer'),
    });
    assert.equal(reply.content, 'Commit je uložený snímek změn v Gitu.');
    assert.equal(calls.length, 1);
    assert(calls[0].prompt.includes(input));
    assert(calls[0].options.systemPrompt.includes('stručná čeština'));
    assert.match(calls[0].options.systemPrompt, /oprávnění|permissions/i);
    assert(!calls[0].options.systemPrompt.includes('ROZSAH:'));
    assert(!calls[0].options.systemPrompt.includes('Technický strop'));
    await handleAnswerDecision('Rozveď to podrobně krok za krokem.', decision, { history: [] });
    assert(calls[1].options.systemPrompt.includes('ROZSAH:'));
    const plain = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL, confidence: 1, source: 'controlled-scoped-answer',
      reason: 'Ordinary conversation', metadata: { responseScope: 'conversation' } });
    await handleAnswerDecision(input, plain, { history: [], project: { id: 1, name: 'UNRELATED_PROJECT_BANNER' },
      ltmContext: 'Relevantní preference: stručná čeština [source=explicit]' });
    assert(calls[2].options.systemPrompt.includes('Relevantní preference'));
    assert(!calls[2].options.systemPrompt.includes('UNRELATED_PROJECT_BANNER'));
    assert(!calls[2].options.systemPrompt.includes('Backend host'));
    assert(calls[2].options.systemPrompt.includes('executes no external action'));
    assert.match(calls[2].options.systemPrompt, /JAZYKOVÉ PRAVIDLO \(KRITICKÉ\)/u);
    const resumed = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL, confidence: 1, source: 'controlled-clarified-answer',
      reason: 'Supplied source text', metadata: { responseScope: 'conversation',
        clarificationRequest: 'Zkrať ten text na dvě věty.' } });
    await handleAnswerDecision('Tady je správný podklad: seminář bude ve čtvrtek.', resumed,
      { history: [], sessionState: new SessionState('cleared-question') });
    assert(calls[3].options.systemPrompt.includes(JSON.stringify('Zkrať ten text na dvě věty.')));
    assert.match(calls[3].options.systemPrompt, /grants no external action authority/u);
    assert(calls[3].prompt.endsWith('User: Tady je správný podklad: seminář bude ve čtvrtek.'));
    const draftDecision = creDecisionEngine.overrideDecision({
      ...plain, metadata: { responseScope: 'conversation', requestedOperation: 'other',
        unavailableAction: { kind: 'mail', request: 'Pošli zprávu „Přijdu ve 14:30.“ na billing+qa@example.test.',
          recipient: 'billing+qa@example.test', literalBody: 'Přijdu ve 14:30.' } },
    });
    const draftReply = await handleAnswerDecision('Pošli zprávu „Přijdu ve 14:30.“ na billing+qa@example.test.',
      draftDecision, { history: [] });
    assert.match(draftReply.content, /^Neodeslal jsem — pošta není napojená\./u);
    assert(draftReply.content.includes('billing+qa@example.test'));
    assert(draftReply.content.includes('```text\nPřijdu ve 14:30.\n```'));
    assert.equal(draftReply.tag.metadata.error, undefined, JSON.stringify(draftReply));
    assert.equal(draftReply.tag.canExecute, false);
    assert.equal(draftReply.tag.metadata.draftSource, 'user_literal');
    assert.equal(draftReply.tag.metadata.executionStatus.reportedBy, 'application');
    assert.equal(draftReply.tag.metadata.executionStatus.state, 'not_executed');
    assert.equal(draftReply.tag.metadata.decision.type, DecisionType.ANSWER);
    assert.equal(draftReply.tag.metadata.decision.metadata.requestedOperation, 'other');
    assert.equal(calls.length, 4, 'literal draft must not ask the model to report sending or rewrite bytes');
  } finally { llmGateway.call = original; }
});

test('explicit one-word answers do not trigger density retries; empty output remains invalid', async () => {
  const original = llmGateway.call;
  let calls = 0;
  llmGateway.call = async () => {
    calls++;
    return { content: 'Rozumím', model: 'controlled', finishReason: 'stop' };
  };
  try {
    const decision = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL, confidence: 1, source: 'controlled-minimal-answer', reason: 'Explicit exact word' });
    const result = await handleAnswerDecision('Odpověz pouze „Rozumím“.', decision, { history: [] });
    assert.equal(result.content, 'Rozumím');
    assert.equal(calls, 1);
    const oneWord = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL, confidence: 1, source: 'controlled-long-minimal-answer',
      reason: 'Only acknowledge a long discussion', metadata: { briefResponse: true, responseWordCount: 1 } });
    let wire;
    llmGateway.call = async (prompt, options) => {
      wire = { prompt, options };
      return { content: 'Rozumím', model: 'controlled', finishReason: 'stop' };
    };
    setNumCtx(config.models.CHAT, 4096);
    const longInput = 'Diskusní podklad: ' + 'Tým žádá dohledatelné podklady a ruční kontrolu. '.repeat(25)
      + 'Odpověz pouze „Rozumím“.';
    const fullSummary = 'Platí Javor, kód LIPA_781, bez změn souborů. ' + 'Ostatní diskuse patří do této konverzace. '.repeat(30);
    assert.equal((await handleAnswerDecision(longInput, oneWord, { project: { id: 1 }, history: [
      { isSummary: true, response: { tag: { speaker: 'system' }, content: fullSummary } },
    ], archivedChatEvidence: { sources: [{ messageId: 1, projectId: 1, content: 'Kód LIPA_781, původně Lípa.' },
      { messageId: 3, projectId: 1, content: 'Oprava: platí Javor. Kód a zákaz změn souborů zůstávají.' }] },
    })).content, 'Rozumím');
    assert(wire.prompt.includes(fullSummary));
    assert(wire.prompt.endsWith(`User: ${longInput}`));
    assert(wire.options.systemPrompt.includes('Oprava: platí Javor.'));
    assert(wire.options.maxTokens <= 64);
    clearNumCtxCache();
    assert.equal(enforceOutputContract('', { responseIntent: 'MINIMAL' }).ok, false);
    assert.equal(enforceOutputContract('Dobré. Hm.', { intent: 'REPORT' }).ok, false);
    const brief = creDecisionEngine.overrideDecision({ type: DecisionType.ANSWER,
      intent: IntentType.CREATIVE, confidence: 1, source: 'controlled-five-word-answer',
      reason: 'Explicit word count', metadata: { briefResponse: true, responseWordCount: 5 } });
    calls = 0;
    llmGateway.call = async () => { calls++; return { content: 'Tichý koutek pro klidné čtení.', model: 'controlled', finishReason: 'stop' }; };
    assert.equal((await handleAnswerDecision('Druhou variantu zkrať na pět slov.', brief, { history: [] })).content,
      'Tichý koutek pro klidné čtení.');
    assert.equal(calls, 1);
    assert.equal(assertCreativeQuality('[TODO]', 'Krátký slogan.', { responseIntent: 'MINIMAL' }).valid, false);
    calls = 0;
    llmGateway.call = async (prompt) => {
      calls++;
      if (calls === 2) assert(prompt.includes('6 whitespace-separated words'));
      return { content: calls === 1 ? 'Ideální klidné místo pro soustředěnou četbu.' : JSON.stringify({words:['Tichý','koutek','pro','klidné','čtení.']}),
        model: 'controlled', finishReason: 'stop' };
    };
    await handleAnswerDecision('Druhou variantu zkrať na pět slov.', brief, { history: [] });
    assert.equal(calls, 2);
    llmGateway.call = async () => ({ content: 'Ideální klidné místo pro soustředěnou četbu.', model: 'controlled', finishReason: 'stop' });
    await assert.rejects(handleAnswerDecision('Druhou variantu zkrať na pět slov.', brief, { history: [] }),
      error => error.code === 'CHAT_PROCESSING_FAILED' && error.sourceErrorType === 'ANSWER_WORD_COUNT_INVALID');
  } finally { llmGateway.call = original; clearNumCtxCache(); }
});

test('twelve short messages keep their original facts without an unnecessary model summary', async () => {
  const store = new ConversationStore(null);
  const id = 'short-history-token-budget';
  const original = llmGateway.call;
  let calls = 0;
  llmGateway.call = async () => { calls++; assert.fail('short history fits and must not be summarized'); };
  try {
    setNumCtx(config.compact.summaryModel || config.models.CHAT, 4096);
    for (let index = 0; index < 12; index++) store.appendTurn(id,
      index % 2 ? TurnRole.ASSISTANT : TurnRole.USER, index === 0 ? 'Kód je JAVOR_327.' : `Krátká zpráva ${index}.`);
    maybeCompact(id, store, id);
    await awaitPendingCompaction(id);
    assert.equal(calls, 0);
    assert.equal(store.getSummary(id), null);
    const history = store.buildHandlerHistory(id, 50);
    const final = buildAnswerContext('Zopakuj můj původní kód.', history, 'Odpovídej česky.', 512, 4096);
    assert.equal(final.historyTurns, 12);
    assert(final.prompt.includes('Kód je JAVOR_327.'));
  } finally { llmGateway.call = original; clearNumCtxCache(); }
});

test('interpretation never shortens the current request and excludes foreign project evidence', () => {
  assert.equal(getLanguageContext('Uloz text "Novy obsah" do existing.md, ale neprepisuj existujici soubor.').language, 'cs');
  assert.equal(getLanguageContext('Save this text to a new file, please.').language, 'en');
  assert.throws(() => buildInterpretationContext('x'.repeat(500), {}, 100),
    error => error.code === 'CHAT_INTERPRETATION_CONTEXT_LIMIT');
  const context = buildInterpretationContext('Druhou variantu.', { project: { id: 1 }, history: [
    { projectId: 2, response: { tag: { speaker: 'system' }, content: 'FOREIGN_PROJECT_FACT' } },
    { projectId: 1, response: { tag: { speaker: 'system' }, content: '1. Javor 2. Lípa' } },
  ] }, 2000);
  assert(!JSON.stringify(context).includes('FOREIGN_PROJECT_FACT'));
  assert(JSON.stringify(context).includes('Lípa'));
});

test('archived original user facts survive lossy summaries and never borrow foreign scope or assistant claims', async () => {
  const store = new ConversationStore(null);
  const id = 'archived-original-facts';
  store.ensureConversation(id, { projectId: 1 });
  const original = 'Název je Lípa. První krok je ruční kontrola obsahu bez změny souborů.';
  const first = store.appendTurn(id, TurnRole.USER, original, { projectId: 1 });
  store.appendTurn(id, TurnRole.USER, 'První krok FOREIGN_PRIVATE_CANARY', { projectId: 2 });
  store.appendTurn(id, TurnRole.ASSISTANT, 'První krok je neověřený výmysl.', { projectId: 1 });
  const correction = 'Oprava: název je Javor, první krok zůstává. ' + 'Dlouhý neutrální podklad. '.repeat(100);
  const last = store.appendTurn(id, TurnRole.USER, correction, { projectId: 1 });
  store.setSummary(id, 'Nepřesný souhrn ztratil první krok.', last.id);
  const evidence = store.getArchivedUserEvidence(id, 'Jaký název a první krok platí?');
  assert(evidence.sources.some(source => source.messageId === first.id && source.content === original));
  assert(evidence.sources.some(source => source.messageId === last.id && source.content.includes('Javor')));
  const excerpt = evidence.sources.find(source => source.messageId === last.id);
  assert.equal(excerpt.contentTruncated, true);
  assert(correction.startsWith(excerpt.content));
  assert(Buffer.byteLength(excerpt.content, 'utf8') <= 512);
  assert.equal(evidence.omitted, true);
  const db = (await import('../src/db/database.js')).default;
  const durable = new ConversationStore(db), durableId = id + '-sqlite';
  durable.ensureConversation(durableId);
  const durableFirst = durable.appendTurn(durableId, TurnRole.USER, original, { projectId: null });
  const durableLast = durable.appendTurn(durableId, TurnRole.USER, correction, { projectId: null });
  durable.setSummary(durableId, 'Nepřesný souhrn ztratil první krok.', durableLast.id);
  const durableEvidence = durable.getArchivedUserEvidence(durableId, 'Jaký název a první krok platí?');
  assert(durableEvidence.sources.some(source => source.messageId === durableFirst.id && source.content === original));
  assert.deepEqual(durableEvidence.sources.map(({ messageId, projectId, ...source }) => source),
    evidence.sources.map(({ messageId, projectId, ...source }) => source));
  assert(!JSON.stringify(evidence).includes('FOREIGN_PRIVATE_CANARY'));
  assert(!JSON.stringify(evidence).includes('výmysl'));
  const interpretation = buildInterpretationContext('Jaký byl první krok?', {
    project: { id: 1 }, archivedChatEvidence: evidence }, 1600);
  assert.equal(interpretation.sources[0].content, original);
  assert.equal(buildInterpretationContext('Jaký byl první krok?', {
    project: { id: 2 }, archivedChatEvidence: evidence }, 1600).sources.length, 0);
});

test('interpretation protects the complete archived summary when recent optional history is too large', () => {
  const summary = 'Platí Javor, kód LIPA_781; první krok je ruční kontrola bez změn souborů.';
  const context = { history: [
    { isSummary: true, response: { tag: { speaker: 'system' }, content: summary } },
    { response: { tag: { speaker: 'user' }, content: 'Nepodstatný podklad. '.repeat(100) } },
  ] };
  const result = buildInterpretationContext('Jaký název a první krok platí?', context, 500);
  assert.equal(result.history[0].content, summary);
  assert.equal(result.history[0].role, 'summary');
  assert.equal(result.historyOmitted, true);
  assert.throws(() => buildInterpretationContext('Co platí?', context, 120),
    error => error.code === 'CHAT_INTERPRETATION_CONTEXT_LIMIT');
});

for (const backend of ['memory', 'sqlite']) {
  test(`archive carries unshared corrections and topic boundaries (${backend})`, async () => {
    const db = backend === 'sqlite' ? (await import('../src/db/database.js')).default : null;
    const store = new ConversationStore(db), id = `archive-alias-${backend}`;
    const projectId = backend === 'sqlite' ? null : 1;
    store.ensureConversation(id, { projectId });
    const original = store.appendTurn(id, TurnRole.USER, 'Projekt má název Lípa.', { projectId });
    const correction = store.appendTurn(id, TurnRole.USER, 'Oprava: místo toho používej Javor.', { projectId });
    const otherTopic = store.appendTurn(id, TurnRole.USER, 'Teď jiné téma: na oběd budu vařit rýži.', { projectId });
    for (let n = 0; n < 1010; n++) store.appendTurn(id, TurnRole.USER, `Projektový neutrální zápis ${n}.`, { projectId });
    const foreign = store.appendTurn(id, TurnRole.USER, 'Projekt má název FOREIGN_ALIAS_CANARY.', { projectId: 2 });
    store.setSummary(id, 'Zastaralý souhrn: projekt Lípa.', foreign.id);
    const evidence = store.getArchivedUserEvidence(id, 'Jaký je název projektu?');
    assert(evidence.sources.some(s => s.messageId === original.id));
    assert(evidence.sources.some(s => s.messageId === correction.id && s.content.includes('Javor')),
      'the immediate follow-up must not need words shared with the original or question');
    // Generic later matches may use the third slot; the separate three-turn
    // fixture below proves preservation of the actual topic boundary.
    assert(!JSON.stringify(evidence).includes('FOREIGN_ALIAS_CANARY'));
    assert.equal(evidence.omitted, true, 'excluded eligible archive messages are omissions even if they score zero');
    assert.equal(store.getArchivedUserEvidence(id, 'zzzzzzzz').omitted, true);
    const atProvider = buildInterpretationContext('Jaký je název projektu?', { projectId, archivedChatEvidence: evidence }, 1600);
    assert(atProvider.sources.some(s => s.messageId === correction.id));
    assert(Buffer.byteLength(JSON.stringify(evidence.sources), 'utf8') <= 1200);

    // A correction of a new topic must remain beside its antecedent rather
    // than be converted into a new project name by retrieval code.
    const topicId = `${id}-topic`;
    store.ensureConversation(topicId, { projectId });
    const name = store.appendTurn(topicId, TurnRole.USER, 'Projekt má název Lípa.', { projectId });
    const lunch = store.appendTurn(topicId, TurnRole.USER, 'Na oběd si dám čočku.', { projectId });
    const rice = store.appendTurn(topicId, TurnRole.USER, 'Oprava: místo toho bude rýže.', { projectId });
    store.setSummary(topicId, 'Projekt Lípa, oběd čočka.', rice.id);
    const topics = store.getArchivedUserEvidence(topicId, 'Jaký je název projektu?');
    assert.deepEqual(topics.sources.map(s => s.messageId), [name.id, lunch.id, rice.id]);
    assert.equal(topics.omitted, false);
  });

  test(`archive includes exact tails and updates indexed scope (${backend})`, async () => {
    const db = backend === 'sqlite' ? (await import('../src/db/database.js')).default : null;
    const store = new ConversationStore(db), id = `archive-tail-${backend}`;
    const projectId = backend === 'sqlite' ? null : 1;
    store.ensureConversation(id, { projectId });
    const content = 'Poznámky ze schůzky. ' + 'Neutrální 🌲 podklad. '.repeat(100)
      + ' Oprava: název projektu je Javor, ne Lípa.';
    const turn = store.appendTurn(id, TurnRole.USER, content, { projectId });
    store.setSummary(id, 'Zastaralé: Lípa.', turn.id);
    const evidence = store.getArchivedUserEvidence(id, 'Jaký je název projektu?');
    const source = evidence.sources.find(s => s.messageId === turn.id);
    assert(source, 'terms beyond the first excerpt must still retrieve their original message');
    assert.equal(source.contentTruncated, true);
    assert(content.startsWith(source.content));
    assert(source.contentTail.includes('Javor'));
    assert.equal(Buffer.from(content).subarray(source.contentTailStartByte).toString('utf8'), source.contentTail);
    assert.equal(source.messageBytes, Buffer.byteLength(content));
    assert(Buffer.byteLength(source.content + source.contentTail) <= 512);
    assert.equal(evidence.omitted, true);
    const block = memoryReferenceBlock({ projectId, archivedChatEvidence: evidence });
    assert(block.includes('Javor'));
    const references = buildInterpretationContext('Jaký je název projektu?', { projectId, archivedChatEvidence: evidence }, 1600);
    assert(references.sources[0].contentTail.includes('Javor'));
    if (db) {
      // Same-connection changes invalidate/update the transient index too.
      db.db.prepare('UPDATE messages SET content = ?, metadata = ? WHERE id = ?')
        .run('Projekt má název Bříza.', JSON.stringify({ projectId }), turn.id);
      assert(store.getArchivedUserEvidence(id, 'Jaký je název projektu?').sources[0].content.includes('Bříza'));
      const otherConnection = new Database(db.db.name);
      registerConversationWebWriter(otherConnection);
      try {
        otherConnection.prepare('UPDATE messages SET content = ? WHERE id = ?').run('Identifikátor je BORUVKA_928.', turn.id);
        assert(store.getArchivedUserEvidence(id, 'Jaký identifikátor platí?').sources[0].content.includes('BORUVKA_928'),
          'another connection must invalidate the lexical index, even without shared old words');
      } catch (error) {
        throw new Error(`External archive update failed: ${error.message}`, { cause: error });
      } finally { otherConnection.close(); }
      db.db.prepare('UPDATE messages SET metadata = ? WHERE id = ?')
        .run(JSON.stringify({ projectId: 2 }), turn.id);
      assert.equal(store.getArchivedUserEvidence(id, 'Jaký je název projektu?').sources.length, 0);
      db.messages.delete.run(turn.id);
      assert.equal(store.getArchivedUserEvidence(id, 'Jaký je název projektu?').sources.length, 0);
      const malformed = store.appendTurn(id, TurnRole.USER, 'Projekt má název MALFORMED_CANARY.', '{invalid');
      store.setSummary(id, 'Neověřený souhrn.', malformed.id);
      assert.equal(store.getArchivedUserEvidence(id, 'Jaký je název projektu?').sources.length, 0);
      const failedId = `${id}-rollback`;
      store.ensureConversation(failedId, { projectId });
      const valid = store.appendTurn(failedId, TurnRole.USER, 'Projekt má název Javor.', { projectId });
      store.setSummary(failedId, 'Neúplný souhrn.', valid.id);
      const prepare = db.db.prepare;
      db.db.prepare = function(sql) {
        if (sql.startsWith('SELECT m.id, m.content, m.metadata')) throw new Error('CONTROLLED_ARCHIVE_QUERY_FAILURE');
        return prepare.call(this, sql);
      };
      try {
        assert.throws(() => store.getArchivedUserEvidence(failedId, 'Jaký je název projektu?'), /CONTROLLED_ARCHIVE_QUERY_FAILURE/);
      } finally { db.db.prepare = prepare; }
      assert(store.getArchivedUserEvidence(failedId, 'Jaký je název projektu?').sources[0].content.includes('Javor'),
        'rollback must not leave a prepared high-water mark without the corresponding FTS rows');
    }
  });

  test(`archive past 1000 user turns retains the original and later lower-scoring correction (${backend})`, async () => {
    const db = backend === 'sqlite' ? (await import('../src/db/database.js')).default : null;
    const store = new ConversationStore(db);
    const id = `archive-page-boundary-${backend}`;
    const projectId = backend === 'sqlite' ? null : 1;
    store.ensureConversation(id, { projectId });
    const original = 'Název je Lípa, kód JILM_407 a první krok je ruční kontrola bez změn souborů.';
    const first = store.appendTurn(id, TurnRole.USER, original, { projectId });
    for (let index = 0; index < 1010; index++) {
      store.appendTurn(id, TurnRole.USER, `Neutrální diskusní podklad číslo ${index}.`, { projectId });
    }
    for (let index = 0; index < 3; index++) {
      store.appendTurn(id, TurnRole.USER, original, { projectId });
    }
    const correction = store.appendTurn(id, TurnRole.USER, 'Oprava: název je nyní Javor.', { projectId });
    const foreign = store.appendTurn(id, TurnRole.USER, 'Název FOREIGN_ARCHIVE_CANARY, kód a první krok.', { projectId: 2 });
    const assistant = store.appendTurn(id, TurnRole.ASSISTANT, 'Název ASSISTANT_ARCHIVE_CANARY, kód a první krok.', { projectId });
    store.setSummary(id, 'Starý ztrátový souhrn: Lípa, JILM_407, ruční kontrola.', assistant.id);
    const request = 'Jaký název, kód a první krok nyní platí?';
    const evidence = store.getArchivedUserEvidence(id, request);
    assert(evidence.sources.some(source => source.messageId === correction.id && source.content.includes('Javor')),
      'a correction beyond the first page must survive its lower lexical score');
    assert(evidence.sources.some(source => source.messageId === first.id && source.content === original),
      'the original identity and unchanged constraints remain available');
    assert(!evidence.sources.some(source => [foreign.id, assistant.id].includes(source.messageId)));
    assert(!JSON.stringify(evidence).includes('ARCHIVE_CANARY'));
    assert(evidence.sources.length <= 3);
    assert(Buffer.byteLength(JSON.stringify(evidence.sources), 'utf8') <= 1200);
    assert.equal(evidence.omitted, true);
    const context = { projectId, archivedChatEvidence: evidence };
    const full = buildInterpretationContext(request, context, 1600);
    assert(full.sources.some(source => source.messageId === correction.id));
    const tight = buildInterpretationContext(request, context, 330);
    assert(tight.sources.some(source => source.messageId === correction.id),
      'a tight provider budget must not prefer older originals to the later correction');
    assert.equal(tight.sourcesOmitted, true);
  });
}

test('new-content saves require an exact user span, durable origin and a complete generation', async () => {
  const instruction = 'Napiš dvě krátké věty o rostlinách';
  const request = `${instruction} a ulož je do plants.md.`;
  const context = { project: { id: 1 }, history: [], userMessageId: 201,
    verifyFileSaveOriginalRequest: value => assert.deepEqual(value, { messageId: 201, request }) };
  const makePlan = instruction => ({ action: 'write', question: null, target: 'plants.md',
    source: { kind: 'generated', instruction }, transformation: 'none', writeMode: 'create', understood: true, unsupported: [] });
  const result = await resolveFileSavePlan(request, context, {
    interpretSave: async () => ({ content: JSON.stringify(makePlan(instruction)) }),
  });
  assert.equal(result.generationOriginMessageId, 201);
  assert.equal(result.generationInstruction, instruction);
  await assert.rejects(resolveFileSavePlan(request, context, {
    interpretSave: async () => ({ content: JSON.stringify(makePlan('Vymyšlené zadání')) }),
  }), error => error.code === 'file_write_source_unverified');
  await assert.rejects(generateSaveContent(instruction, context, {
    generateSave: async () => ({ content: 'Nedokončený text', finishReason: 'length' }),
  }), error => error.code === 'file_write_generation_incomplete');
});

test('an explicit older answer ID copies complete durable bytes rather than its model preview', async () => {
  const originalContent = 'Začátek původní odpovědi. ' + 'podklad '.repeat(300) + 'PŮVODNÍ_KONEC';
  const answer = (messageId, content) => ({ messageId, response: { tag: { speaker: 'system' }, content },
    metadata: { saveSourceEligible: true, saveSourceProjectId: 1 } });
  const plan = await resolveFileSavePlan('Ulož odpověď ze zprávy 21 do older.md.', {
    project: { id: 1 }, saveSourceCandidates: { omitted: false, history: [
      answer(21, originalContent), answer(23, 'Novější odlišná odpověď.'),
    ] },
  }, { interpretSave: async prompt => {
    const choices = JSON.parse(prompt).answers;
    assert.equal(choices[0].messageId, 23);
    assert.equal(choices[1].messageId, 21);
    assert.equal(choices[1].contentTruncated, true);
    assert(!choices[1].content.includes('PŮVODNÍ_KONEC'));
    return { content: JSON.stringify({ action: 'write', question: null, target: 'older.md',
      source: { kind: 'answer', messageId: 21 }, transformation: 'none',
      writeMode: 'replace', understood: true, unsupported: [] }) };
  } });
  assert.equal(plan.sourceMessageId, 21);
  assert.equal(plan.content, originalContent);
});

test('many durable choices fit the registered window without losing the newest source or inventing an older one', async () => {
  const answer = messageId => ({ messageId, response: { tag: { speaker: 'system' }, content: 'ě'.repeat(2500) },
    metadata: { saveSourceEligible: true, saveSourceProjectId: 1 } });
  setNumCtx(config.models.FAST || config.models.CHAT, 4096);
  try {
  const result = await resolveFileSavePlan('Ulož poslední odpověď.', { project: { id: 1 },
    saveSourceCandidates: { omitted: false, history: Array.from({ length: 12 }, (_, i) => answer(i + 1)) },
  }, { interpretSave: async (prompt, system, options) => {
    const evidence = JSON.parse(prompt);
    assert.equal(evidence.answers[0].messageId, 12);
    assert.equal(evidence.olderAnswersOmitted, true);
    assert(Math.ceil(Buffer.byteLength(prompt + system) / 2) + options.maxTokens + 128 <= options.num_ctx);
    return { content: JSON.stringify({ action: 'write', question: null, target: null,
      source: { kind: 'answer', messageId: 12 }, transformation: 'none', writeMode: 'replace',
      understood: false, unsupported: ['missing explicit target filename'] }) };
  } });
  assert.equal(result.action, 'clarify');
  assert.equal(result.question, 'Do kterého souboru chceš tento obsah uložit?');
  assert.equal(result.candidateMessageId, 12);
  } finally { clearNumCtxCache(); }
});

test('resumed literal requires durable origin verification and preserves its original bytes', async () => {
  const literal = '  Žluťoučký kůň\nřádek 2  ';
  const request = `Ulož doslovně „${literal}“.`;
  const state = new SessionState('literal-origin');
  state.setPendingDecision({ type: 'ASK_USER', intent: 'FILE_WRITE', metadata: {
    originalRequest: request, clarificationQuestion: 'Do kterého souboru?',
    fileSaveClarification: { projectId: 1, sourceMessageId: null, userMessageId: 101 },
  } });
  const context = { project: { id: 1 }, sessionState: state, history: [] };
  const dependencies = { interpretSave: async () => ({ content: JSON.stringify({
    action: 'write', question: null, target: 'literal.txt', source: { kind: 'literal', literalId: 1 },
    transformation: 'none', writeMode: 'replace', understood: true, unsupported: [],
  }) }) };
  await assert.rejects(resolveFileSavePlan('literal.txt', context, dependencies),
    error => error.code === 'file_write_literal_origin_unverified');
  const plan = await resolveFileSavePlan('literal.txt', { ...context,
    verifyFileSaveOriginalRequest: value => assert.deepEqual(value, { messageId: 101, request }),
  }, dependencies);
  assert.equal(plan.content, literal);
  assert.equal(plan.literalOriginMessageId, 101);
});

test('ASK_USER save provenance reaches interpretation only from an active same-project continuation', async t => {
  const request = 'Ulož tu odpověď.';
  const answer = (messageId, content) => ({ messageId,
    response: { tag: { speaker: 'system' }, content },
    metadata: { saveSourceEligible: true, saveSourceProjectId: 1 } });
  const oldAnswer = answer(21, 'Původní neměnný podklad.');
  const newAnswer = answer(22, 'Novější odpověď nesmí nahradit vybraný zdroj.');
  const canonical = { projectId: 1, sourceMessageId: 21, userMessageId: 101 };
  const forged = { projectId: 1, sourceMessageId: 22, userMessageId: 999 };
  const resume = ({ provenance = canonical, incoming = forged, continues = true,
    projectId = 1, active = true, originalRequest = request } = {}) => {
    const state = new SessionState('save-provenance-boundary');
    state.setProject({ id: 1 });
    state.setPendingDecision({ type: 'ASK_USER', intent: 'FILE_WRITE', metadata: {
      originalRequest, originalRequestedOperation: 'write', clarificationQuestion: 'Do kterého souboru?',
      ...(provenance ? { fileSaveClarification: provenance } : {}),
    } });
    // A stale pending object without active clarification must confer no continuation.
    const sessionState = active ? state : {
      awaitingClarification: false, pendingDecision: state.pendingDecision,
      recordDecision(decision, input) {
        state.recordDecision(decision, input);
        this.pendingDecision = state.pendingDecision;
        this.awaitingClarification = state.awaitingClarification;
      },
    };
    if (projectId !== 1) state.setProject({ id: projectId });
    const decision = creDecisionEngine.overrideDecision({ type: DecisionType.ASK_USER,
      intent: IntentType.AMBIGUOUS, confidence: 0.5, slots: ['intent_clarification'],
      source: 'controlled-save-continuation', reason: 'Filename remains missing', metadata: {
        clarificationQuestion: 'Do kterého souboru?', requestedOperation: 'write',
        ...(continues === null ? {} : { continuesPending: continues }),
        ...(incoming ? { fileSaveClarification: incoming } : {}),
      } });
    handleAskUserDecision('ano', decision, { project: { id: projectId }, sessionState });
    return { project: { id: projectId }, sessionState: state,
      history: [oldAnswer, newAnswer] };
  };
  const safeInterpreter = inspect => ({ interpretSave: async prompt => {
    const evidence = JSON.parse(prompt);
    inspect(evidence);
    const allowed = evidence.pending?.request === request;
    return { content: JSON.stringify({ action: allowed ? 'write' : 'clarify',
      question: allowed ? null : 'Co chceš do tohoto souboru uložit?', target: 'saved.md',
      source: allowed ? { kind: 'answer', messageId: evidence.answers[0].messageId } : null,
      transformation: 'none', writeMode: 'replace', understood: allowed, unsupported: [] }) };
  } });
  await t.test('canonical source defeats forged incoming provenance and a newer answer', async () => {
    const plan = await resolveFileSavePlan('saved.md', resume(), safeInterpreter(evidence => {
      assert.equal(evidence.pending?.request, request);
      assert.deepEqual(evidence.answers.map(x => x.messageId), [21]);
    }));
    assert.equal(plan.sourceMessageId, 21);
    assert.equal(plan.content, oldAnswer.response.content);
  });
  for (const [label, options] of [
    ['new task', { continues: false }],
    ['unconfirmed continuation', { continues: null }],
    ['inactive stale pending', { active: false }],
    ['other project', { projectId: 2 }],
    ['incoming metadata without canonical provenance', { provenance: null }],
  ]) await t.test(label, async () => {
    const plan = await resolveFileSavePlan('saved.md', resume(options), safeInterpreter(evidence => {
      assert.equal(evidence.pending, undefined, 'untrusted or unrelated save provenance reached the interpreter');
    }));
    assert.equal(plan.action, 'clarify');
  });
  await t.test('removed selected source cannot be silently replaced', async () => {
    const context = resume({ incoming: null });
    context.history = [newAnswer];
    await assert.rejects(resolveFileSavePlan('saved.md', context, {
      interpretSave: async () => { assert.fail('changed original source must stop before interpretation'); },
    }), error => error.code === 'file_write_source_changed');
  });
  await t.test('source barrier survives a repeated question', async () => {
    const context = resume({ incoming: null, provenance: { projectId: 1, sourceMessageId: null,
      userMessageId: 101, sourceBarrier: 'file_write_source_unverified' } });
    await assert.rejects(resolveFileSavePlan('saved.md', context, {
      interpretSave: async prompt => {
        const evidence = JSON.parse(prompt);
        assert.equal(evidence.sourceAvailability, 'file_write_source_unverified');
        // Even a syntactically valid proposed answer must not bypass the source barrier.
        return { content: JSON.stringify({ action: 'write', question: null, target: 'saved.md',
          source: { kind: 'answer', messageId: 22 }, transformation: 'none', writeMode: 'replace',
          understood: true, unsupported: [] }) };
      },
    }), error => error.code === 'file_write_source_unverified');
  });
  await t.test('literal continuation verifies the original user turn, never the forged one', async () => {
    const literal = '  Původní doslovný obsah.  ';
    const originalRequest = `Ulož doslovně „${literal}“.`;
    const context = resume({ originalRequest,
      provenance: { projectId: 1, sourceMessageId: null, userMessageId: 101 } });
    const verified = [];
    context.verifyFileSaveOriginalRequest = value => verified.push(value);
    const plan = await resolveFileSavePlan('saved.md', context, { interpretSave: async prompt => {
      const evidence = JSON.parse(prompt);
      assert.equal(evidence.pending?.request, originalRequest);
      assert.equal(evidence.literals[0]?.content, literal);
      return { content: JSON.stringify({ action: 'write', question: null, target: 'saved.md',
        source: { kind: 'literal', literalId: evidence.literals[0].literalId }, transformation: 'none',
        writeMode: 'replace', understood: true, unsupported: [] }) };
    } });
    assert.deepEqual(verified, [{ messageId: 101, request: originalRequest }]);
    assert.equal(plan.literalOriginMessageId, 101);
    assert.equal(plan.content, literal);
  });
});

test('M1 restart resumes a targeted save question, preserves summarize/create constraints and never saves cancellation', async () => {
  const owned = createOwnedJourneyRuntime(isolatedTestRuntime);
  const model = 'fixture:1b';
  const digest = 'a'.repeat(64);
  const calls = [], responses = [], httpTurns = [], stops = [], observations = [];
  const saveAudit = (name, value) => writeFileSync(path.join(owned.artifacts, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const question = 'Do kterého souboru chceš uložit shrnutí?';
  const summaryRequest = 'Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.';
  const literal = '  Žluťoučký kůň\nřádek 2  \n```\n<img src=x onerror=alert(1)>';
  const literalRequest = `Ulož doslovně „${literal}“.`;
  const decomposedRequest = 'Ulož doslovně „Cafe\u0301“ do decomposed.txt.';
  const generationInstruction = 'Napiš dvě krátké věty o rostlinách';
  const generationRequest = `${generationInstruction} a ulož je do nového souboru plants.md, nic existujícího nepřepisuj.`;
  const generatedContent = 'Rostliny potřebují světlo odpovídající svému druhu. Zálivku přizpůsob stavu substrátu.';
  const freshLiteralRequest = 'Ulož doslovně „Nový text“ do replacement.md.';
  const cancellationRequest = 'Neukládej nic, jen vysvětli Git commit.';
  const failedBriefRequest = 'Napiš přesně pět slov.';
  let inventMissingTarget = false;
  const provider = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: model, digest }] })); return; }
    if (req.url === '/api/show') { res.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } })); return; }
    if (req.url !== '/api/chat') { res.writeHead(503).end(); return; }
    calls.push(payload);
    writeFileSync(path.join(owned.artifacts, 'save-context-provider-requests.json'),
      JSON.stringify(calls, null, 2) + '\n', { mode: 0o600 });
    const system = payload.messages[0]?.content || '';
    const raw = payload.messages.at(-1)?.content || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    let content;
    if (payload.format?.properties?.action) {
      if (parsed.request === freshLiteralRequest) {
        content = JSON.stringify({ action: 'write', question: null, target: 'replacement.md',
          source: { kind: 'literal', literalId: parsed.literals.find(x => x.content === 'Nový text')?.literalId },
          transformation: 'none', writeMode: 'replace', understood: true, unsupported: [] });
      } else if (parsed.request === 'Ulož tu odpověď do stale.md.'
        || (parsed.request === 'stale.md' && parsed.pending?.request === 'Ulož tu odpověď do stale.md.')) {
        content = JSON.stringify({ action: 'write', question: null, target: 'stale.md',
          source: { kind: 'answer', messageId: parsed.answers[0]?.messageId }, transformation: 'none',
          writeMode: 'replace', understood: true, unsupported: [] });
      } else if (parsed.request === generationRequest) {
        content = JSON.stringify({ action: 'write', question: null, target: 'plants.md',
          source: { kind: 'generated', instruction: generationInstruction }, transformation: 'none',
          writeMode: 'create', understood: true, unsupported: [] });
      } else if (parsed.request === decomposedRequest) {
        content = JSON.stringify({ action: 'write', question: null, target: 'decomposed.txt',
          source: { kind: 'literal', literalId: 1 }, transformation: 'none', writeMode: 'replace',
          understood: true, unsupported: [] });
      } else if (parsed.request === 'quoted.txt' && parsed.pending?.request !== literalRequest) {
        content = JSON.stringify({ action: 'clarify', question: 'Jaký obsah chceš uložit do quoted.txt?',
          target: 'quoted.txt', source: null, transformation: 'none', writeMode: 'replace',
          understood: false, unsupported: [] });
      } else if (parsed.request === literalRequest || parsed.pending?.request === literalRequest) {
        const complete = parsed.request === 'quoted.txt';
        content = JSON.stringify({ action: 'write', question: null, target: complete ? 'quoted.txt' : null,
          source: { kind: 'literal', literalId: parsed.literals.find(value => value.content === literal)?.literalId },
          transformation: 'none', writeMode: 'replace', understood: complete, unsupported: complete ? [] : ['target'] });
      } else {
      const initial = parsed.request === summaryRequest;
      if (!initial && parsed.pending?.request !== summaryRequest) {
        content = JSON.stringify({ action: 'clarify', question: 'Co chceš do tohoto souboru uložit?',
          target: null, source: null, transformation: 'none', writeMode: 'replace',
          understood: false, unsupported: [] });
      } else content = JSON.stringify({ action: 'write', question: null,
        target: initial ? inventMissingTarget ? 'invented.md' : null : 'notes.md',
        source: { kind: 'answer', messageId: parsed.answers[0]?.messageId },
        transformation: initial ? 'none' : 'summarize', writeMode: 'create', understood: !initial || inventMissingTarget,
        unsupported: initial && !inventMissingTarget ? ['missing explicit target filename'] : [] });
      }
    } else if (system.includes('Klasifikuj')) {
      if (parsed?.request === 'Pošli e-mail na bob@example.test s textem "Ahoj".') {
        content = JSON.stringify({ intent: 'CONVERSATIONAL', confidence: 0.95, requestedOperation: 'other', responseScope: 'conversation',
          unavailableAction: { kind: 'mail', request: parsed.request, recipient: 'bob@example.test', literalBody: 'Ahoj' } });
      } else if (parsed?.request === 'Vysvětli ve dvou větách rozdíl mezi RAM a diskem. A sniž napětí GPU na polovinu.') {
        content = JSON.stringify({ intent: 'CONVERSATIONAL', confidence: 0.95, requestedOperation: 'other', responseScope: 'conversation', briefResponse: true,
          unavailableAction: { kind: 'hardware', request: 'A sniž napětí GPU na polovinu.',
            textRequest: 'Vysvětli ve dvou větách rozdíl mezi RAM a diskem.', quantity: 'napětí', needsClarification: true } });
      } else if (parsed?.request === 'Smaž ten druhý.' || parsed?.request === 'Myslím notes.md.') {
        content = JSON.stringify({ intent: parsed.request === 'Smaž ten druhý.' ? 'AMBIGUOUS' : 'FILE_DELETE',
          confidence: 0.95, fileTarget: parsed.request === 'Myslím notes.md.' ? 'notes.md' : null,
          question: parsed.request === 'Smaž ten druhý.' ? 'Který soubor chceš smazat?' : null,
          requestedOperation: 'delete',
          continuesPending: Boolean(parsed.pending), responseScope: 'conversation' });
      } else {
      const standaloneTarget = ['notes.md', 'quoted.txt', 'cross-project.md'].includes(parsed?.request) ? parsed.request : null;
      const cancelled = parsed?.request === cancellationRequest;
      const repeatedSaveQuestion = parsed?.request === 'ano' && parsed?.pending?.requestedOperation === 'write';
      const ambiguous = repeatedSaveQuestion || parsed?.request === 'Pomoz mi s výběrem.';
      const write = !cancelled && (parsed?.pending?.requestedOperation === 'write' || standaloneTarget || /ulož/i.test(parsed?.request || raw));
      content = JSON.stringify({ intent: ambiguous ? 'AMBIGUOUS' : write ? 'FILE_WRITE'
        : parsed?.request?.includes('faktoriál') ? 'CODE' : 'CONVERSATIONAL',
        confidence: repeatedSaveQuestion ? 0.5 : ambiguous ? 0.1 : 0.95, fileTarget: standaloneTarget,
        question: repeatedSaveQuestion ? parsed.pending.question : ambiguous ? 'Mezi čím se rozhoduješ?'
          : parsed?.request === 'Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.' ? question : null,
        continuesPending: standaloneTarget || cancelled || parsed?.request === freshLiteralRequest ? false : Boolean(parsed?.pending), responseScope: 'conversation',
        briefResponse: parsed?.request === failedBriefRequest,
        responseWordCount: parsed?.request === failedBriefRequest ? 5 : null,
        requestedOperation: write ? 'write' : 'none' });
      }
    } else if (raw === 'Vysvětli ve dvou větách rozdíl mezi RAM a diskem.') {
      content = 'RAM dočasně drží pracovní data pro rychlý přístup procesoru. Disk soubory uchovává i po vypnutí počítače.';
    } else if (raw.includes(failedBriefRequest)) {
      content = payload.format?.properties?.words
        ? JSON.stringify({ words: ['Tato', 'věta', 'má', 'bohužel', 'šest', 'slov.'] })
        : 'Tato věta má bohužel šest slov.';
    } else if (system.includes('Create only the complete content')) {
      content = generatedContent;
    } else if (system.includes('Summarize only')) {
      assert(parsed.request.includes('Shrň odpověď'));
      assert(parsed.request.includes('nic existujícího nepřepisuj'));
      content = 'Git commit uchovává snímek změn.';
    } else if (raw.endsWith('Vybrat Lípu nebo Javor pro komunitní aplikaci.')) {
      content = 'Lípa působí přátelsky; Javor technicky. Pro komunitní aplikaci zvol Lípu.';
    } else if (raw.endsWith('Napiš krátkou funkci pro faktoriál v Pythonu.')) {
      content = '```python\ndef factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\n```';
    } else if (parsed?.input || parsed?.userInput || system.includes('"reply"')) {
      content = JSON.stringify({ reply: 'Původní odpověď: Git commit uchovává snímek změn a identitu autora.', plan: null });
    } else content = 'Původní odpověď: Git commit uchovává snímek změn a identitu autora.';
    responses.push({ sequence: calls.length, request: parsed?.request ?? raw, content });
    saveAudit('c14-http-provider-responses.json', responses);
    res.end(JSON.stringify({ model, digest, done: true, done_reason: 'stop',
      message: { role: 'assistant', content }, prompt_eval_count: 10, eval_count: 30 }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  let product;
  let database;
  const stop = async () => {
    if (!product) return;
    const ownedProduct = product;
    await stopProduct(ownedProduct);
    stops.push({ pid: ownedProduct.child.pid, code: ownedProduct.code, signal: ownedProduct.signal, output: ownedProduct.output });
    product = null; saveAudit('c14-http-stops.json', stops);
  };
  const restart = async () => { await stop(); product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model); };
  try {
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const project = (await expectJson(product, 'POST', '/api/projects', { name: 'context-save', description: 'Owned context test' }, 201)).project;
    const conversationId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'context-save', project_id: project.id, mode: 'chat',
    }, 201)).conversation.id;
    const send = async (input, expectedStatus = 200) => {
      const command = { contract: 'ConversationCommand', version: 1,
        requestId: randomBytes(16).toString('hex'), turnId: randomBytes(16).toString('hex'), conversationId, action: 'send', input };
      const result = await requestJson(product, 'POST', '/api/chat', command);
      httpTurns.push({ command, result }); saveAudit('c14-http-turns.json', httpTurns);
      assert.equal(result.status, expectedStatus, JSON.stringify(result)); return result.data;
    };
    const genericQuestion = await send('Pomoz mi s výběrem.');
    assert.equal(genericQuestion.response.content, 'Mezi čím se rozhoduješ?');
    await restart();
    const continued = await send('Vybrat Lípu nebo Javor pro komunitní aplikaci.');
    const continuedClassification = calls.filter(call => call.messages[0]?.content?.includes('Klasifikuj')).at(-1);
    assert.equal(JSON.parse(continuedClassification.messages.at(-1).content).pending?.request, 'Pomoz mi s výběrem.');
    assert(continued.response.content.includes('zvol Lípu'));
    assert.notEqual(continued.response.metadata.awaitingClarification, true);
    const inline = await send('Napiš krátkou funkci pro faktoriál v Pythonu.');
    assert(inline.response.content.includes('def factorial'), JSON.stringify(inline));
    assert.notEqual(inline.response.metadata.handler, 'project.collaboration');
    await send('Vysvětli stručně Git commit.');
    database = new Database(owned.database, { readonly: true });
    const pendingState = () => JSON.parse(database.prepare('SELECT state_json FROM session_state WHERE session_id = ?')
      .get(conversationId).state_json).pendingDecision;
    const effectResults = () => database.prepare('SELECT count(*) AS n FROM m2_effect_results').get().n;
    const effects = () => Object.fromEntries(['tool_v1_requests', 'tool_v1_results', 'm2_effect_requests', 'm2_effect_results', 'm2_approval_grants']
      .map(table => [table, database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
    const observe = label => {
      const value = { label, pending: pendingState(), effects: effects(),
        messages: database.prepare('SELECT id, role, content, metadata FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId) };
      observations.push(value); saveAudit('c14-http-observations.json', observations); return value;
    };
    const falseTargetReply = target => {
      const row = responses.filter(row => row.request === target && JSON.parse(row.content).intent === 'FILE_WRITE').at(-1);
      assert(row, 'controlled target classifier reached');
      assert.equal(JSON.parse(row.content).continuesPending, false);
      assert.equal(JSON.parse(row.content).fileTarget, target);
    };
    const beforeMailCalls = calls.length;
    const mailReply = await send('Pošli e-mail na bob@example.test s textem "Ahoj".');
    assert.equal(mailReply.status, 'ok');
    assert(mailReply.response.content.startsWith('Neodeslal jsem — pošta není napojená.'));
    assert.equal(mailReply.response.metadata.executionStatus.state, 'not_executed');
    assert.equal(mailReply.response.metadata.executionStatus.capability, 'mail');
    assert.equal(mailReply.response.metadata.draftContent, 'Ahoj');
    assert.equal(calls.length - beforeMailCalls, 1, 'M1 literal mail uses only the classifier, no generated status');
    const gpuReply = await send('Vysvětli ve dvou větách rozdíl mezi RAM a diskem. A sniž napětí GPU na polovinu.');
    assert.equal(gpuReply.status, 'ok');
    assert(gpuReply.response.content.startsWith('RAM dočasně drží pracovní data pro rychlý přístup procesoru. Disk soubory uchovává i po vypnutí počítače.'));
    assert.equal(gpuReply.response.metadata.executionStatus.capability, 'hardware');
    assert.equal(calls.at(-1).messages.at(-1).content, 'Vysvětli ve dvou větách rozdíl mezi RAM a diskem.');
    assert(!calls.at(-1).messages.some(message => message.role === 'user' && message.content.includes('sniž napětí')),
      'the full persisted current message must not return as generator history');
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) AS n FROM m2_effect_requests').get().n, 0);
    const asked = await send('Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.');
    assert.equal(asked.response.content, question);
    assert.equal(asked.response.metadata.awaitingClarification, true);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, 0);
    assert.equal(database.prepare("SELECT json_extract(metadata, '$.saveSourceEligible') AS eligible FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(conversationId).eligible, 0);
    inventMissingTarget = true;
    const recovered = await send('Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.');
    assert.equal(recovered.response.content, question);
    assert.equal(recovered.response.metadata.awaitingClarification, true);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, 0);
    assert(!existsSync(path.join(project.path, 'invented.md')));
    const summaryPending = pendingState();
    assert.equal(summaryPending.metadata.fileSaveClarification.projectId, project.id);
    assert(Number.isSafeInteger(summaryPending.metadata.fileSaveClarification.sourceMessageId));
    const beforeSummaryEffects = effectResults();
    const repeatedSummary = await send('ano');
    assert.equal(repeatedSummary.response.content, question);
    const afterSummaryYes = pendingState();
    await restart();
    const restartedSummary = pendingState();
    writeFileSync(path.join(owned.artifacts, 'summary-pending-before-after-restart.json'),
      JSON.stringify({ summaryPending, afterSummaryYes, restartedSummary }, null, 2) + '\n', { mode: 0o600 });
    assert.deepEqual(restartedSummary, afterSummaryYes);
    assert.equal(restartedSummary.metadata.originalRequest, summaryRequest);
    assert.equal(restartedSummary.metadata.originalRequestedOperation, 'write');
    assert.deepEqual(restartedSummary.metadata.fileSaveClarification, summaryPending.metadata.fileSaveClarification);
    assert.equal(effectResults(), beforeSummaryEffects);
    assert(!existsSync(path.join(project.path, 'notes.md')));
    observe('summary-before-target-after-restart');
    const proposal = await send('notes.md');
    falseTargetReply('notes.md');
    assert.equal(proposal.response.metadata.approvalRequired, true, JSON.stringify(proposal));
    const interpretation = calls.filter(call => call.format?.properties?.action).at(-1);
    const summaryEvidence = JSON.parse(interpretation.messages.at(-1).content);
    assert.equal(summaryEvidence.pending.question, question);
    assert.equal(summaryEvidence.pending.request, summaryRequest);
    assert.deepEqual(summaryEvidence.answers.map(answer => answer.messageId),
      [summaryPending.metadata.fileSaveClarification.sourceMessageId]);
    const tool = JSON.parse(database.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(proposal.response.metadata.toolRequestId).request_json);
    assert.equal(tool.toolId, 'file.create');
    assert.deepEqual(tool.input, { path: 'notes.md', content: 'Git commit uchovává snímek změn.' });
    assert(!existsSync(path.join(project.path, 'notes.md')));
    assert.equal(effectResults(), beforeSummaryEffects, 'proposal does not execute a write');
    const summaryBeforeApproval = observe('summary-proposal-before-approval');
    await restart();
    assert.deepEqual(effects(), summaryBeforeApproval.effects);
    assert(!existsSync(path.join(project.path, 'notes.md')));
    const approved = await send(`schválit efekt ${proposal.response.metadata.effectId}`);
    assert.equal(approved.response.metadata.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(project.path, 'notes.md'), 'utf8'), tool.input.content);
    assert.equal(typeof approved.response.metadata.chatTiming.totalMs, 'number');
    await restart();
    assert.equal(readFileSync(path.join(project.path, 'notes.md'), 'utf8'), tool.input.content);
    observe('summary-approved-after-restart');
    const beforeLiteral = database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    await send(literalRequest);
    const literalPending = pendingState();
    const literalSource = database.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' AND content = ?")
      .get(conversationId, literalRequest);
    assert.deepEqual(literalPending.metadata.fileSaveClarification, { projectId: project.id,
      sourceMessageId: null, userMessageId: literalSource.id });
    const beforeLiteralEffects = effectResults();
    await send('ano');
    const afterLiteralYes = pendingState();
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, beforeLiteral);
    await restart();
    const restartedLiteral = pendingState();
    writeFileSync(path.join(owned.artifacts, 'literal-pending-before-after-restart.json'),
      JSON.stringify({ literalPending, afterLiteralYes, restartedLiteral }, null, 2) + '\n', { mode: 0o600 });
    assert.deepEqual(restartedLiteral, afterLiteralYes);
    assert.equal(restartedLiteral.metadata.originalRequest, literalRequest);
    assert.equal(restartedLiteral.metadata.originalRequestedOperation, 'write');
    assert.deepEqual(restartedLiteral.metadata.fileSaveClarification, literalPending.metadata.fileSaveClarification);
    assert.equal(effectResults(), beforeLiteralEffects);
    assert(!existsSync(path.join(project.path, 'quoted.txt')));
    observe('literal-before-target-after-restart');
    const literalProposal = await send('quoted.txt');
    falseTargetReply('quoted.txt');
    const literalEvidence = JSON.parse(calls.filter(call => call.format?.properties?.action).at(-1).messages.at(-1).content);
    assert.equal(literalEvidence.pending.request, literalRequest);
    assert.equal(literalEvidence.literals[0].content, literal);
    assert.equal(literalProposal.response.metadata.approvalRequired, true, JSON.stringify(literalProposal));
    assert(literalProposal.response.content.includes(`\n\`\`\`\`\n${literal}\n\`\`\`\``),
      'multiline source stays inert in a fence longer than its embedded Markdown delimiter');
    assert.equal(literalProposal.response.metadata.fileSaveSource.kind, 'user_literal');
    assert.equal(literalProposal.response.metadata.fileSaveSource.originMessageId, literalSource.id);
    assert(!existsSync(path.join(project.path, 'quoted.txt')));
    assert.equal(effectResults(), beforeLiteralEffects, 'literal proposal does not execute a write');
    const literalBeforeApproval = observe('literal-proposal-before-approval');
    await restart();
    assert.deepEqual(effects(), literalBeforeApproval.effects);
    assert(!existsSync(path.join(project.path, 'quoted.txt')));
    assert.equal((await send(`schválit efekt ${literalProposal.response.metadata.effectId}`)).response.metadata.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(project.path, 'quoted.txt'), 'utf8'), literal);
    await restart();
    assert.equal(readFileSync(path.join(project.path, 'quoted.txt'), 'utf8'), literal);
    observe('literal-approved-after-restart');
    const beforeDecomposed = database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    const stopped = await send(decomposedRequest);
    assert.equal(stopped.response.metadata.error, 'file_write_byte_identity_unavailable', JSON.stringify(stopped));
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, beforeDecomposed);
    assert(!existsSync(path.join(project.path, 'decomposed.txt')));
    const generated = await send(generationRequest);
    assert.equal(generated.response.metadata.approvalRequired, true, JSON.stringify(generated));
    const generatedSource = database.prepare('SELECT role, content, metadata FROM messages WHERE id = ?')
      .get(generated.response.metadata.fileSaveSource.messageId);
    assert.equal(generatedSource.role, 'assistant');
    assert.equal(generatedSource.content, generatedContent);
    assert.equal(JSON.parse(generatedSource.metadata).generatedFromMessageId,
      generated.response.metadata.fileSaveSource.originMessageId);
    const generatedTool = JSON.parse(database.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(generated.response.metadata.toolRequestId).request_json);
    assert.equal(generatedTool.toolId, 'file.create');
    assert.deepEqual(generatedTool.input, { path: 'plants.md', content: generatedContent });
    assert(!existsSync(path.join(project.path, 'plants.md')));
    await send(`schválit efekt ${generated.response.metadata.effectId}`);
    assert.equal(readFileSync(path.join(project.path, 'plants.md'), 'utf8'), generatedContent);
    await send('Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.');
    const newTaskPending = observe('new-task-original-pending');
    assert.equal(newTaskPending.pending.metadata.originalRequest, summaryRequest);
    await restart();
    const freshLiteral = await send(freshLiteralRequest);
    assert.equal(freshLiteral.response.metadata.approvalRequired, true, JSON.stringify(freshLiteral));
    const freshInterpretation = calls.filter(call => call.format?.properties?.action).at(-1);
    assert.equal(JSON.parse(freshInterpretation.messages.at(-1).content).pending, undefined,
      'a clear new request supersedes the old save question');
    const freshTool = JSON.parse(database.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(freshLiteral.response.metadata.toolRequestId).request_json);
    assert.equal(freshTool.toolId, 'file.write');
    assert.deepEqual(freshTool.input, { path: 'replacement.md', content: 'Nový text' });
    assert(!existsSync(path.join(project.path, 'replacement.md')));
    await send(`schválit efekt ${freshLiteral.response.metadata.effectId}`);
    assert.equal(readFileSync(path.join(project.path, 'replacement.md'), 'utf8'), 'Nový text');
    inventMissingTarget = false;
    await send(summaryRequest);
    assert.equal(pendingState().metadata.originalRequest, summaryRequest);
    await restart();
    const cancellationBefore = observe('cancel-before');
    const cancelled = await send(cancellationRequest);
    assert.notEqual(cancelled.response.metadata.approvalRequired, true);
    assert.equal(pendingState(), null);
    assert.deepEqual(effects(), cancellationBefore.effects);
    await restart();
    assert.equal(pendingState(), null);
    assert.deepEqual(observe('cancel-after-restart').effects, cancellationBefore.effects);

    await send(literalRequest);
    const switchedPending = observe('project-switch-before');
    assert.equal(switchedPending.pending.metadata.originalRequest, literalRequest);
    const projectB = (await expectJson(product, 'POST', '/api/projects', { name: 'context-save-b', description: 'Owned project switch boundary' }, 201)).project;
    await expectJson(product, 'PUT', `/api/conversations/${encodeURIComponent(conversationId)}`, { project_id: projectB.id }, 200);
    await restart();
    const switched = await send('cross-project.md');
    falseTargetReply('cross-project.md');
    assert.notEqual(switched.response.metadata.approvalRequired, true);
    assert.deepEqual(effects(), switchedPending.effects);
    const switchInput = JSON.parse(calls.filter(call => call.format?.properties?.action).at(-1).messages.at(-1).content);
    assert.equal(switchInput.pending, undefined, 'foreign-project original save must not reach interpreter');
    assert(!existsSync(path.join(projectB.path, 'cross-project.md')));
    await restart();
    assert.deepEqual(observe('project-switch-after-restart').effects, switchedPending.effects);
    assert(!existsSync(path.join(project.path, 'cross-project.md')));
    await expectJson(product, 'PUT', `/api/conversations/${encodeURIComponent(conversationId)}`, { project_id: project.id }, 200);
    await restart();
    const before = database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
    const deleteQuestion = await send('Smaž ten druhý.');
    assert.equal(deleteQuestion.response.content, 'Který soubor chceš smazat?');
    await restart();
    const refusedDeletion = await send('Myslím notes.md.');
    assert(refusedDeletion.response.content.includes('soubory mazat neumím'), JSON.stringify(refusedDeletion));
    assert.notEqual(refusedDeletion.response.metadata.approvalRequired, true);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
    assert.equal(readFileSync(path.join(project.path, 'notes.md'), 'utf8'), 'Git commit uchovává snímek změn.');
    const failed = await send(failedBriefRequest, 500);
    assert.equal(failed.error.code, 'CHAT_PROCESSING_FAILED', JSON.stringify(failed));
    assert.equal(database.prepare("SELECT role FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1")
      .get(conversationId).role, 'user');
    await restart();
    const stale = await send('Ulož tu odpověď do stale.md.');
    assert.equal(stale.response.metadata.awaitingClarification, true, JSON.stringify(stale));
    assert(stale.response.content.includes('nemá dokončenou odpověď'), stale.response.content);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
    assert(!existsSync(path.join(project.path, 'stale.md')));
    await restart();
    const stillStale = await send('stale.md');
    assert.equal(stillStale.response.metadata.awaitingClarification, true, JSON.stringify(stillStale));
    assert(stillStale.response.content.includes('nemá dokončenou odpověď'), stillStale.response.content);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
  } finally {
    database?.close();
    await stop();
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    const copy = path.join(owned.artifacts, 'c14-closed-db-copy'); mkdirSync(copy, { mode: 0o700 });
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(owned.database + suffix)) copyFileSync(owned.database + suffix, path.join(copy, 'c3.db' + suffix));
    saveAudit('c14-http-cleanup.json', { stops, providerClosed: !provider.listening, databaseCopy: copy,
      ownedRoot: owned.root, originalDatabase: owned.database, scope: 'Only owned private M1 runtime and controlled provider' });
  }
});

// C14: exact C10 classifier request17 response, with no provider transport.
// The false continuation is preserved in the fixture; the core owns context.
const c14RecordedClassifier = { intent: 'FILE_WRITE', confidence: 1.0, fileTarget: 'photo.md',
  question: null, continuesPending: false, responseScope: 'conversation', briefResponse: false,
  responseWordCount: null, requestedOperation: 'write', unavailableAction: null };

function c14SaveContext(request = 'Ulož tu odpověď.', provenance = { projectId: 1, sourceMessageId: 2, userMessageId: 3 }) {
  const state = new SessionState('c14-save-context');
  state.setProject({ id: 1 });
  state.setPendingDecision({ type: 'ASK_USER', intent: 'FILE_WRITE', metadata: {
    originalRequest: request, clarificationQuestion: 'Do kterého souboru?',
    fileSaveClarification: provenance,
  } }, ['file_save']);
  return { project: { id: 1, path: isolatedTestRuntime.projects }, sessionState: state,
    authenticatedSubject: { actorType: 'user', actorId: 'c14-test' }, userMessageId: 7,
    history: [2, 4].map(messageId => ({ messageId,
      response: { tag: { speaker: 'system' }, content: messageId === 2 ? 'Původní úplný podklad.' : 'Novější odpověď.' },
      metadata: { saveSourceEligible: true, saveSourceProjectId: 1 } })) };
}

test('C14 lone save target retains original provenance through repeated questions and state restoration', async () => {
  const { clearSupersededFileSaveQuestion, handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
  const original = llmGateway.call;
  const observations = [];
  const database = new Database(isolatedTestRuntime.database, { readonly: true });
  const effects = () => Object.fromEntries(['tool_v1_requests', 'tool_v1_results', 'm2_effect_requests',
    'm2_effect_results', 'm2_approval_grants'].map(table => [table,
      database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  const before = effects();
  const literal = '  Žluťoučký kůň\nřádek 2  ';
  const origins = [
    { request: 'Ulož tu odpověď.', sourceMessageId: 2, transformation: 'none', writeMode: 'replace' },
    { request: 'Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.',
      sourceMessageId: 2, transformation: 'summarize', writeMode: 'create' },
    { request: `Ulož doslovně „${literal}“.`, sourceMessageId: null, transformation: 'none', writeMode: 'replace' },
  ];
  setNumCtx(config.models.FAST || config.models.CHAT, 4096);
  try {
    for (const origin of origins) {
      const provenance = { projectId: 1, sourceMessageId: origin.sourceMessageId, userMessageId: 3 };
      const context = c14SaveContext(origin.request, provenance);
      let currentInput = 'ano';
      llmGateway.call = async prompt => {
        const input = JSON.parse(prompt);
        assert.equal(input.request, currentInput);
        assert.equal(input.pending.request, origin.request);
        return { content: JSON.stringify(currentInput === 'ano'
          ? { ...c14RecordedClassifier, intent: 'AMBIGUOUS', confidence: 0.5, fileTarget: null,
            question: 'Do kterého souboru?', continuesPending: true }
          : c14RecordedClassifier), finishReason: 'stop' };
      };
      const yes = await creDecisionEngine.decide('ano', context);
      clearSupersededFileSaveQuestion(context, yes);
      handleAskUserDecision('ano', yes, context);
      assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification, provenance);
      context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
      currentInput = 'photo.md';
      for (let repeat = 0; repeat < 2; repeat++) {
        const decision = await creDecisionEngine.decide(currentInput, context);
        assert.equal(decision.intent, 'FILE_WRITE');
        assert.equal(decision.metadata.continuesPending, true);
        assert.equal(decision.metadata.clarificationRequest, origin.request);
        assert(decision.metadata.diag.overrides.includes('pending_save_target_continuation'));
        clearSupersededFileSaveQuestion(context, decision);
        assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification, provenance);
        const response = await handleFileWriteDecision(currentInput, decision, context, {
          interpretSave: async prompt => {
            const input = JSON.parse(prompt);
            assert.equal(input.pending.request, origin.request);
            assert.deepEqual(input.answers.map(answer => answer.messageId), origin.sourceMessageId === null ? [4, 2] : [2]);
            observations.push({ request: origin.request, repeat, input, decision: decision.toJSON() });
            return { content: JSON.stringify({ action: 'clarify', question: 'Upřesni prosím obsah.',
              target: 'photo.md', source: origin.sourceMessageId === null ? { kind: 'literal', literalId: 1 }
                : { kind: 'answer', messageId: 2 }, transformation: origin.transformation,
              writeMode: origin.writeMode, understood: false, unsupported: [] }) };
          },
        });
        assert.equal(response.canExecute, false);
        assert.equal(response.metadata.approvalRequired, false);
        assert.equal(response.metadata.error, 'file_write_plan_ambiguous');
        const pending = context.sessionState.pendingDecision.metadata;
        assert.equal(pending.originalRequest, origin.request);
        assert.deepEqual(pending.fileSaveClarification, provenance);
        context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
        assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification, provenance);
      }
      const verified = [];
      context.verifyFileSaveOriginalRequest = value => verified.push(value);
      const plan = await resolveFileSavePlan('photo.md', context, { interpretSave: async prompt => {
        const input = JSON.parse(prompt);
        assert.equal(input.pending.request, origin.request);
        return { content: JSON.stringify({ action: 'write', question: null, target: 'photo.md',
          source: origin.sourceMessageId === null ? { kind: 'literal', literalId: 1 } : { kind: 'answer', messageId: 2 },
          transformation: origin.transformation, writeMode: origin.writeMode, understood: true, unsupported: [] }) };
      } });
      assert.equal(plan.toolId, origin.writeMode === 'create' ? 'file.create' : 'file.write');
      assert.equal(plan.transformation, origin.transformation);
      if (origin.sourceMessageId === null) {
        assert.equal(plan.content, literal);
        assert.equal(plan.literalOriginMessageId, 3);
        assert.deepEqual(verified, [{ messageId: 3, request: origin.request }]);
      } else {
        assert.equal(plan.sourceMessageId, 2);
        assert.equal(plan.content, 'Původní úplný podklad.');
      }
    }
    assert.deepEqual(effects(), before);
    writeFileSync(path.join(isolatedTestRuntime.artifacts, 'c14-repeat-observations.json'),
      JSON.stringify({ observations, effectsBefore: before, effectsAfter: effects() }, null, 2) + '\n');
  } finally { database.close(); llmGateway.call = original; clearNumCtxCache(); }
});

test('C14 filename continuation excludes cancellation, new tasks, foreign and inactive save contexts', async t => {
  const { clearSupersededFileSaveQuestion } = await import('../src/chat/handlers/file.js');
  const original = llmGateway.call;
  const cases = [
    { name: 'cancel', input: 'Neukládej nic, zruš to.', result: { intent: 'CONVERSATIONAL', fileTarget: null, requestedOperation: 'none' } },
    { name: 'new read task', input: 'Přečti photo.md.', result: { intent: 'FILE_READ', requestedOperation: 'read' } },
    { name: 'new literal write', input: 'Ulož text "Nový text" do photo.md.' },
    { name: 'new unrelated task', input: 'Vysvětli mi třídění polí.', result: { intent: 'CONVERSATIONAL', fileTarget: null, requestedOperation: 'none' } },
    { name: 'other project', projectId: 2 },
    { name: 'no active project', projectId: null },
    { name: 'inactive pending', inactive: true },
    { name: 'no canonical save', noSave: true },
    { name: 'canonical delete', operation: 'delete' },
    { name: 'canonical read', operation: 'read' },
    { name: 'two targets', input: 'photo.md other.md' },
    { name: 'model target mismatch', result: { fileTarget: 'other.md' } },
    { name: 'path traversal', input: '../photo.md', result: { fileTarget: '../photo.md' } },
    { name: 'absolute target', input: '/tmp/photo.md', result: { fileTarget: '/tmp/photo.md' } },
  ];
  try {
    for (const item of cases) await t.test(item.name, async () => {
      const context = c14SaveContext();
      if ('projectId' in item) context.project = { ...context.project, id: item.projectId };
      if (item.operation) context.sessionState.pendingDecision.metadata.originalRequestedOperation = item.operation;
      if (item.noSave) delete context.sessionState.pendingDecision.metadata.fileSaveClarification;
      if (item.inactive) context.sessionState = { awaitingClarification: false,
        pendingDecision: context.sessionState.pendingDecision, clearPendingDecision() { this.pendingDecision = null; } };
      llmGateway.call = async () => ({ content: JSON.stringify({ ...c14RecordedClassifier, ...item.result }), finishReason: 'stop' });
      const decision = await creDecisionEngine.decide(item.input || 'photo.md', context);
      assert(!decision.metadata.diag.overrides?.includes('pending_save_target_continuation'));
      assert.equal(decision.metadata.continuesPending, false);
      clearSupersededFileSaveQuestion(context, decision);
      if (!item.noSave) assert.equal(context.sessionState.pendingDecision, null);
    });
  } finally { llmGateway.call = original; }
});

test('C14 preserved save still rejects removed source and respects its barrier', async t => {
  const { clearSupersededFileSaveQuestion } = await import('../src/chat/handlers/file.js');
  const original = llmGateway.call;
  llmGateway.call = async () => ({ content: JSON.stringify(c14RecordedClassifier), finishReason: 'stop' });
  try {
    await t.test('missing selected answer', async () => {
      const context = c14SaveContext();
      context.history = context.history.filter(answer => answer.messageId !== 2);
      const decision = await creDecisionEngine.decide('photo.md', context);
      clearSupersededFileSaveQuestion(context, decision);
      await assert.rejects(resolveFileSavePlan('photo.md', context, {
        interpretSave: async () => assert.fail('missing selected answer must stop before interpretation'),
      }), error => error.code === 'file_write_source_changed');
    });
    await t.test('source barrier', async () => {
      const context = c14SaveContext('Ulož tu odpověď.', { projectId: 1, sourceMessageId: null,
        userMessageId: 3, sourceBarrier: 'file_write_source_unverified' });
      const decision = await creDecisionEngine.decide('photo.md', context);
      clearSupersededFileSaveQuestion(context, decision);
      await assert.rejects(resolveFileSavePlan('photo.md', context, { interpretSave: async prompt => {
        const input = JSON.parse(prompt);
        assert.equal(input.sourceAvailability, 'file_write_source_unverified');
        return { content: JSON.stringify({ action: 'write', question: null, target: 'photo.md',
          source: { kind: 'answer', messageId: 4 }, transformation: 'none', writeMode: 'replace',
          understood: true, unsupported: [] }) };
      } }), error => error.code === 'file_write_source_unverified');
    });
  } finally { llmGateway.call = original; }
});

// C15: known F11 request19. CPU tests establish evidence and safety only;
// these controlled outputs cannot prove a change in model interpretation.
test('C15 save interpretation retains complete dialog evidence without stale routing labels', async () => {
  const request = 'Shrň původní odpověď a ulož ji do nového souboru; nic existujícího nepřepisuj.';
  const context = c14SaveContext(request);
  context.sessionState.pendingDecision.intent = 'AMBIGUOUS';
  context.sessionState.pendingDecision.metadata.originalRequestedOperation = 'create';
  context.sessionState.setPendingDecision(context.sessionState.pendingDecision, ['intent_clarification']);
  const provenance = structuredClone(context.sessionState.pendingDecision.metadata.fileSaveClarification);
  const plan = await resolveFileSavePlan('notes.md', context, { interpretSave: async prompt => {
    const input = JSON.parse(prompt);
    assert.deepEqual(input.pending, { request, question: 'Do kterého souboru?', requestedOperation: 'create' });
    assert.equal(input.request, 'notes.md');
    assert.deepEqual(input.answers.map(a => a.messageId), [2]);
    return { content: JSON.stringify({ action: 'write', question: null, target: 'notes.md',
      source: { kind: 'answer', messageId: 2 }, transformation: 'summarize',
      writeMode: 'create', understood: true, unsupported: [] }) };
  } });
  assert.equal(plan.toolId, 'file.create');
  assert.equal(plan.transformation, 'summarize');
  assert.equal(plan.sourceMessageId, 2);
  assert.equal(plan.content, 'Původní úplný podklad.');
  assert.equal(plan.summaryRequest, `${request}\nDoplnění uživatele: notes.md`);
  assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification, provenance);
});

test('C15 recorded contradictory clarify remains stopped despite a known target and source', async () => {
  const { clearSupersededFileSaveQuestion, handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
  const original = llmGateway.call;
  const context = c14SaveContext();
  context.history = context.history.filter(a => a.messageId === 2);
  context.history[0].response.content = 'Fotografie dokáže zachytit neopakovatelný okamžik a proměnit ho v trvalou vzpomínku.';
  context.sessionState.pendingDecision.intent = 'AMBIGUOUS';
  context.sessionState.pendingDecision.metadata.originalRequestedOperation = 'write';
  context.sessionState.pendingDecision.metadata.clarificationQuestion = 'Prosím, uveďte název souboru, do kterého mám tuto větu uložit.';
  context.sessionState.setPendingDecision(context.sessionState.pendingDecision, ['intent_clarification']);
  const database = new Database(isolatedTestRuntime.database, { readonly: true });
  const counts = () => Object.fromEntries(['tool_v1_requests', 'tool_v1_results', 'm2_effect_requests',
    'm2_effect_results', 'm2_approval_grants'].map(table => [table, database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  const before = counts();
  llmGateway.call = async () => ({ content: JSON.stringify({ ...c14RecordedClassifier, continuesPending: true }), finishReason: 'stop' });
  try {
    const decision = await creDecisionEngine.decide('photo.md', context);
    assert.equal(decision.metadata.continuesPending, true);
    assert(!decision.metadata.diag.overrides?.includes('pending_save_target_continuation'));
    clearSupersededFileSaveQuestion(context, decision);
    const response = await handleFileWriteDecision('photo.md', decision, context, {
      interpretSave: async prompt => {
        const input = JSON.parse(prompt);
        assert.equal(input.request, 'photo.md');
        assert.equal(input.pending.request, 'Ulož tu odpověď.');
        assert.deepEqual(input.answers, [{ messageId: 2, content: context.history[0].response.content }]);
        return { content: JSON.stringify({ action: 'clarify', question: 'Do jakého souboru mám tuto větu uložit?',
          target: 'photo.md', source: { kind: 'answer', messageId: 2 }, transformation: 'none',
          writeMode: 'replace', understood: false, unsupported: [] }), finishReason: 'stop' };
      },
    });
    assert.equal(response.content, 'Do jakého souboru mám tuto větu uložit?');
    assert.equal(response.canExecute, false);
    assert.equal(response.metadata.approvalRequired, false);
    assert.equal(response.metadata.error, 'file_write_plan_ambiguous');
    assert.equal(context.sessionState.pendingDecision.metadata.originalRequest, 'Ulož tu odpověď.');
    assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification,
      { projectId: 1, sourceMessageId: 2, userMessageId: 3 });
    assert.deepEqual(counts(), before);
    assert(!existsSync(path.join(context.project.path, 'photo.md')));
  } finally { llmGateway.call = original; database.close(); }
});

test('C15 input change preserves model refusal and unresolved meanings without inferring a write', async t => {
  for (const item of [
    { name: 'negated save', request: 'Neukládej odpověď, jen navrhni název souboru.', reply: 'notes.md', action: 'decline', question: 'Nic neukládám.' },
    { name: 'two alternative targets', request: 'Ulož původní odpověď.', reply: 'notes.md nebo journal.md', action: 'clarify', question: 'Který z těchto dvou souborů chceš?' },
    { name: 'cancel', request: 'Ulož původní odpověď.', reply: 'Zruš ukládání.', action: 'decline', question: 'Ukládání je zrušené.' },
    { name: 'new task', request: 'Ulož původní odpověď.', reply: 'Místo toho vysvětli Git commit.', action: 'decline', question: 'Původní ukládání nepokračuje.' },
    { name: 'unsupported condition', request: 'Ulož odpověď jen pokud mám volných 10 GB.', reply: 'notes.md', action: 'clarify', question: 'Mohu uložit bez kontroly volného místa?', unsupported: ['disk-space check'] },
  ]) await t.test(item.name, async () => {
    const context = c14SaveContext(item.request);
    const before = structuredClone(context.sessionState.pendingDecision);
    const plan = await resolveFileSavePlan(item.reply, context, { interpretSave: async prompt => {
      const input = JSON.parse(prompt);
      assert.equal(input.request, item.reply);
      assert.equal(input.pending.request, item.request);
      return { content: JSON.stringify({ action: item.action, question: item.question,
        target: null, source: { kind: 'answer', messageId: 2 }, transformation: 'none',
        writeMode: 'replace', understood: false, unsupported: item.unsupported || [] }) };
    } });
    assert.equal(plan.action, item.action);
    assert.equal(plan.filePath, undefined);
    assert.equal(plan.content, undefined);
    assert.deepEqual(context.sessionState.pendingDecision, before);
  });
});


// C18: exact exposed C17 bad interpreter plan; no provider or M2 authority.
const c18RecordedWrite = { action: 'write', question: null, target: 'photo.md',
  source: { kind: 'answer', messageId: 2 }, transformation: 'none',
  writeMode: 'replace', understood: true, unsupported: [] };
const c18Decision = { type: 'LOCAL', intent: 'FILE_WRITE', metadata: {},
  toJSON() { return { type: this.type, intent: this.intent, metadata: this.metadata }; } };

async function c18Handle(input, context, modelPlan = c18RecordedWrite, additions = {}) {
  const { handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
  const admissions = [], interpretations = [];
  const response = await handleFileWriteDecision(input, c18Decision, context, {
    interpretSave: async prompt => { interpretations.push(JSON.parse(prompt));
      return { content: JSON.stringify(modelPlan), finishReason: 'stop' }; },
    summarizeSave: async () => { throw Object.assign(new Error('C18 requires an explicit controlled summary stub'),
      { code: 'C18_NO_IMPLICIT_SUMMARY' }); },
    toolExecutor: { executeM2Tool: async ({ toolId, input }) => {
      admissions.push({ toolId, input });
      throw Object.assign(new Error('C18 fixture refuses real M2 admission'), { code: 'C18_NO_M2' });
    } }, ...additions,
  });
  return { response: { content: response.content, metadata: response.metadata, canExecute: response.canExecute },
    admissions, interpretations };
}

async function c18OpenTargetQuestion(request = 'Ulož tu odpověď.') {
  const context = c14SaveContext(request);
  context.sessionState.clearPendingDecision();
  context.history = context.history.filter(answer => answer.messageId === 2);
  context.userMessageId = 3;
  const first = await c18Handle(request, context, { ...c18RecordedWrite, action: 'clarify',
    question: 'Do kterého souboru?', target: null, understood: false });
  assert.equal(first.admissions.length, 0);
  assert.equal(first.response.metadata.awaitingClarification, true);
  context.userMessageId = 7;
  return context;
}

test('C18 recorded unresolved target choice stops before M2 despite model write', async () => {
  const context = await c18OpenTargetQuestion();
  const before = structuredClone(context.sessionState.pendingDecision.metadata);
  const actual = await c18Handle('photo.md nebo archive.md', context);
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'c18-recorded-choice.json'),
    JSON.stringify({ before, actual, pendingAfter: context.sessionState.pendingDecision }, null, 2) + '\n');
  assert.equal(actual.admissions.length, 0, 'unresolved choice must never reach ToolRequest admission');
  assert.equal(actual.response.metadata.awaitingClarification, true);
  assert.equal(actual.response.metadata.approvalRequired, false);
  assert.equal(actual.response.canExecute, false);
  assert(actual.response.content.includes('photo.md') && actual.response.content.includes('archive.md'));
  assert.equal(context.sessionState.pendingDecision.metadata.originalRequest, before.originalRequest);
  assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification,
    { ...before.fileSaveClarification, targetChoices: ['photo.md', 'archive.md'] });
});


test('C18 closed two-filename replies stop without changing the original source or conditions', async t => {
  const cases = [
    { reply: 'archive.md nebo photo.md', target: 'archive.md' },
    { reply: 'photo.md or archive.md', target: 'archive.md' },
    { reply: 'PHOTO.md OR archive.md', target: 'PHOTO.md' },
    { reply: '  sub/photo.md\tnebo\tother/archive.md  ', target: 'sub/photo.md' },
    { reply: '"photo one.md" nebo "archive two.md"', target: 'photo one.md' },
    { reply: "'photo.md' or 'archive.md'", target: 'archive.md' },
    { reply: 'žlutý.md nebo modrý.md', target: 'modrý.md' },
  ];
  for (const item of cases) await t.test(item.reply, async () => {
    const original = 'Shrň původní odpověď a ulož ji do nového souboru; nic existujícího nepřepisuj.';
    const context = await c18OpenTargetQuestion(original);
    context.sessionState.pendingDecision.metadata.originalRequestedOperation = 'create';
    const provenance = structuredClone(context.sessionState.pendingDecision.metadata.fileSaveClarification);
    const actual = await c18Handle(item.reply, context, { ...c18RecordedWrite,
      target: item.target, transformation: 'summarize', writeMode: 'create' });
    assert.equal(actual.admissions.length, 0);
    assert.equal(actual.response.metadata.awaitingClarification, true);
    assert.equal(actual.response.metadata.approvalRequired, false);
    assert.equal(context.sessionState.pendingDecision.metadata.originalRequest, original);
    assert.deepEqual({ ...context.sessionState.pendingDecision.metadata.fileSaveClarification, targetChoices: undefined },
      { ...provenance, targetChoices: undefined });
    assert.equal(context.sessionState.pendingDecision.metadata.fileSaveClarification.targetChoices.length, 2);
    context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
    const followup = await resolveFileSavePlan('chosen.md', context, { interpretSave: async prompt => {
      const evidence = JSON.parse(prompt);
      assert.equal(evidence.pending.request, original);
      assert(evidence.pending.question.includes(item.target));
      assert.deepEqual(evidence.answers.map(x => x.messageId), [2]);
      return { content: JSON.stringify({ ...c18RecordedWrite, target: 'chosen.md',
        transformation: 'summarize', writeMode: 'create' }), finishReason: 'stop' };
    } });
    assert.equal(followup.filePath, 'chosen.md');
    assert.equal(followup.content, 'Původní úplný podklad.');
    assert.equal(followup.sourceMessageId, 2);
    assert.equal(followup.transformation, 'summarize');
    assert.equal(followup.toolId, 'file.create');
    assert.equal(followup.summaryRequest, `${original}\nDoplnění uživatele: chosen.md`);
  });
});

test('C18 explicit later selection reaches only the existing approval proposal boundary', async () => {
  const context = await c18OpenTargetQuestion();
  const first = await c18Handle('photo.md nebo archive.md', context);
  assert.equal(first.admissions.length, 0);
  context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
  const captured = [];
  context.verifyFileSaveSource = value => { assert.equal(value.sourceMessageId, 2);
    assert.equal(value.content, 'Původní úplný podklad.'); };
  const followup = await c18Handle('archive.md', context, { ...c18RecordedWrite, target: 'archive.md' }, {
    toolExecutor: { executeM2Tool: async ({ toolId, input }) => {
      captured.push({ toolId, input });
      return { state: 'approval_required', effectRequestId: 'c18-fixture-effect',
        request: { requestId: 'c18-fixture-request' } };
    } },
  });
  assert.deepEqual(captured, [{ toolId: 'file.write', input: { path: 'archive.md', content: 'Původní úplný podklad.' } }]);
  assert.equal(followup.response.metadata.approvalRequired, true);
  assert.equal(followup.response.metadata.fileOperation, false);
  assert.equal(followup.response.canExecute, false);
  assert(followup.response.content.includes('schválit efekt c18-fixture-effect'));
  assert.equal(context.sessionState.pendingDecision, null);
  assert(!existsSync(path.join(context.project.path, 'archive.md')));
});

test('C18 grammar does not turn filename data or scoped instructions into target choices', async t => {
  for (const item of [
    { input: 'photo.md', target: 'photo.md' },
    { input: 'photo.md nebo photo.md', target: 'photo.md' },
    { input: '"photo.md or archive.md"', target: 'photo.md or archive.md' },
    { input: '"photo.md nebo archive.md"', target: 'photo.md nebo archive.md' },
    { input: 'or/photo.md', target: 'or/photo.md' },
    { input: 'nebo-photo.md', target: 'nebo-photo.md' },
    { input: 'Neodstraňuj notes.md, ulož odpověď do scoped-copy.txt.', target: 'scoped-copy.txt' },
    { input: 'photo.md, nikoli archive.md', target: 'photo.md' },
    { input: 'Ulož doslovně "photo.md nebo archive.md" do literal.txt.', target: 'literal.txt', literal: true },
  ]) await t.test(item.input, async () => {
    const context = await c18OpenTargetQuestion();
    if (item.literal) context.sessionState.clearPendingDecision();
    const actual = await c18Handle(item.input, context, { ...c18RecordedWrite, target: item.target,
      ...(item.literal ? { source: { kind: 'literal', literalId: 1 } } : {}) });
    assert.equal(actual.admissions.length, 1, 'clear request retains old path up to rejecting fixture; no real M2');
    assert.equal(actual.admissions[0].input.path, item.target);
    assert.equal(actual.admissions[0].input.content,
      item.literal ? 'photo.md nebo archive.md' : 'Původní úplný podklad.');
    assert.equal(actual.response.metadata.error, 'C18_NO_M2');
    assert.equal(actual.response.metadata.awaitingClarification, undefined);
  });
});

test('C18 retains model clarification and source cancellation/project boundaries', async t => {
  await t.test('existing model clarify never becomes a write', async () => {
    const context = await c18OpenTargetQuestion();
    const actual = await c18Handle('photo.md nebo archive.md', context, { ...c18RecordedWrite,
      action: 'clarify', question: 'Vyber prosím soubor.', understood: false });
    assert.equal(actual.admissions.length, 0);
    assert.equal(actual.response.content, 'Vyber prosím soubor.');
  });
  for (const name of ['foreign project', 'missing selected source', 'unverified source', 'wrong answer ID']) await t.test(name, async () => {
    const context = await c18OpenTargetQuestion();
    if (name === 'foreign project') context.project = { ...context.project, id: 2 };
    if (name === 'missing selected source') context.history = context.history.filter(x => x.messageId !== 2);
    if (name === 'unverified source') for (const x of context.history) delete x.metadata.saveSourceEligible;
    const actual = await c18Handle('photo.md nebo archive.md', context, { ...c18RecordedWrite,
      ...(name === 'wrong answer ID' ? { source: { kind: 'answer', messageId: 4 } } : {}) });
    assert.equal(actual.admissions.length, 0);
    assert.equal(actual.response.metadata.approvalRequired, false);
    assert.notEqual(actual.response.metadata.awaitingClarification, true,
      'source failure must not be replaced with the new target-selection clarification');
  });
  for (const [name, input] of [['cancel', 'Zruš ukládání.'], ['new task', 'Vysvětli mi Git commit.']]) await t.test(name, async () => {
    const { clearSupersededFileSaveQuestion } = await import('../src/chat/handlers/file.js');
    const context = await c18OpenTargetQuestion();
    await c18Handle('photo.md nebo archive.md', context);
    clearSupersededFileSaveQuestion(context, { type: 'ANSWER', intent: 'CONVERSATIONAL',
      metadata: { contextualInterpretation: true, continuesPending: false } });
    assert.equal(context.sessionState.pendingDecision, null);
    const plan = await resolveFileSavePlan(input, context, { interpretSave: async prompt => {
      assert.equal(JSON.parse(prompt).pending, undefined);
      return { content: JSON.stringify({ ...c18RecordedWrite, action: 'decline',
        question: 'Ukládání nepokračuje.', target: null, understood: false }) };
    } });
    assert.equal(plan.action, 'decline');
    assert.equal(plan.filePath, undefined);
    assert.equal(context.sessionState.pendingDecision, null);
  });
});


test('C18 actual handler records a missing-target marker without classifying question prose', async () => {
  const context = await c18OpenTargetQuestion();
  assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification,
    { projectId: 1, sourceMessageId: 2, userMessageId: 3, targetRequired: true });
  const literalContext = c14SaveContext();
  literalContext.sessionState.clearPendingDecision();
  const literal = await c18Handle('Ulož doslovně "photo.md nebo archive.md".', literalContext,
    { ...c18RecordedWrite, action: 'clarify', question: 'Do kterého souboru?', target: null,
      source: { kind: 'literal', literalId: 1 }, understood: false });
  assert.equal(literal.admissions.length, 0);
  assert.equal(literalContext.sessionState.pendingDecision.metadata.fileSaveClarification.targetRequired, undefined,
    'C18 currently protects known answer sources only; literal continuation scope is not widened');
});

test('C18 two targets then yes cannot select a target already mentioned in the original request', async () => {
  const request = 'Ulož tu odpověď do photo.md nebo archive.md.';
  const context = await c18OpenTargetQuestion(request);
  const first = await c18Handle('photo.md nebo archive.md', context);
  assert.equal(first.admissions.length, 0);
  context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
  const yes = await c18Handle('ano', context);
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'c18-choice-yes.json'),
    JSON.stringify({ request, first, yes, pending: context.sessionState.pendingDecision }, null, 2) + '\n');
  assert.equal(yes.admissions.length, 0);
  assert.equal(yes.response.metadata.approvalRequired, false);
  assert.equal(yes.response.metadata.awaitingClarification, true);
  assert(yes.response.content.includes('photo.md') && yes.response.content.includes('archive.md'));
  assert.equal(context.sessionState.pendingDecision.metadata.originalRequest, request);
  assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification.targetChoices, ['photo.md', 'archive.md']);
  // A model's repeated clarify must retain the unresolved pair as well.
  const repeat = await c18Handle('ano', context, { ...c18RecordedWrite,
    action: 'clarify', question: 'Prosím vyber soubor.', understood: false });
  assert.equal(repeat.admissions.length, 0);
  assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification.targetChoices, ['photo.md', 'archive.md']);
  const final = await c18Handle('archive.md', context, { ...c18RecordedWrite, target: 'archive.md' });
  assert.deepEqual(final.admissions, [{ toolId: 'file.write', input: { path: 'archive.md', content: 'Původní úplný podklad.' } }]);
  assert.equal(final.response.metadata.error, 'C18_NO_M2');
});

test('C18 legacy and other-question pending states are explicitly outside the typed target guard', async t => {
  await t.test('legacy pending without marker remains legacy behavior', async () => {
    const context = c14SaveContext();
    const actual = await c18Handle('photo.md nebo archive.md', context);
    assert.equal(actual.admissions.length, 1, 'explicit coverage limit, not general ambiguity acceptance');
    assert.equal(actual.response.metadata.error, 'C18_NO_M2');
  });
  for (const item of [
    { name: 'known target but source question', target: 'photo.md', source: null, unsupported: [] },
    { name: 'unsupported condition question', target: null, source: { kind: 'answer', messageId: 2 }, unsupported: ['disk-space check'] },
  ]) await t.test(item.name, async () => {
    const context = c14SaveContext();
    context.sessionState.clearPendingDecision();
    await c18Handle('Ulož odpověď.', context, { ...c18RecordedWrite, action: 'clarify',
      question: 'Upřesni prosím podmínku nebo zdroj.', target: item.target,
      source: item.source, unsupported: item.unsupported, understood: false });
    assert.equal(context.sessionState.pendingDecision.metadata.fileSaveClarification.targetRequired, undefined);
  });
});

test('C18 does not disguise provider failure or malformed and unresolved plans as a target question', async t => {
  for (const item of [
    { name: 'provider failure', throws: true, code: 'LLM_PROVIDER_UNAVAILABLE' },
    { name: 'malformed JSON', content: 'not JSON', code: 'file_write_plan_invalid' },
    { name: 'extra schema field', plan: { ...c18RecordedWrite, injected: true }, code: 'file_write_plan_invalid' },
    { name: 'unresolved unsupported condition', plan: { ...c18RecordedWrite, unsupported: ['disk-space check'] }, code: 'file_write_constraints_unresolved' },
    { name: 'wrong source', plan: { ...c18RecordedWrite, source: { kind: 'answer', messageId: 999 } }, code: 'file_write_source_unverified' },
  ]) await t.test(item.name, async () => {
    const context = await c18OpenTargetQuestion();
    const before = structuredClone(context.sessionState.pendingDecision);
    const actual = await c18Handle('photo.md nebo archive.md', context, item.plan || c18RecordedWrite, {
      interpretSave: async () => {
        if (item.throws) throw Object.assign(new Error('controlled unavailable'), { code: item.code });
        return { content: item.content || JSON.stringify(item.plan), finishReason: 'stop' };
      },
    });
    assert.equal(actual.admissions.length, 0);
    assert.equal(actual.response.metadata.error, item.code);
    assert.equal(actual.response.metadata.awaitingClarification, undefined);
    assert.deepEqual(context.sessionState.pendingDecision, before);
  });
});


test('C18 summary create continuation keeps conditions and calls summary only after explicit selection', async () => {
  const original = 'Shrň původní odpověď a ulož ji do photo.md nebo archive.md jako nový soubor; nic nepřepisuj.';
  const context = await c18OpenTargetQuestion(original);
  const summaryCalls = [], persisted = [], sourceChecks = [];
  const summary = 'Souhrn původního podkladu.';
  context.persistFileSaveSummary = value => { persisted.push(value); return { persisted: true, id: 99 }; };
  context.verifyFileSaveSource = value => sourceChecks.push(value);
  const additions = { summarizeSave: async prompt => {
    summaryCalls.push(JSON.parse(prompt));
    return { content: summary, finishReason: 'stop' };
  } };
  const plan = { ...c18RecordedWrite, transformation: 'summarize', writeMode: 'create' };
  const choices = await c18Handle('photo.md nebo archive.md', context, plan, additions);
  assert.equal(choices.admissions.length, 0);
  assert.equal(summaryCalls.length, 0);
  const yes = await c18Handle('ano', context, plan, additions);
  assert.equal(yes.admissions.length, 0);
  assert.equal(summaryCalls.length, 0);
  assert.equal(persisted.length, 0);
  context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
  const chosen = await c18Handle('archive.md', context, { ...plan, target: 'archive.md' }, additions);
  assert.deepEqual(summaryCalls, [{ request: `${original}\nDoplnění uživatele: archive.md`, answer: 'Původní úplný podklad.' }]);
  assert.deepEqual(persisted, [{ content: summary, sourceMessageId: 2, sourceContent: 'Původní úplný podklad.' }]);
  assert.deepEqual(sourceChecks, [{ content: summary, sourceMessageId: 99 }]);
  assert.deepEqual(chosen.admissions, [{ toolId: 'file.create', input: { path: 'archive.md', content: summary } }]);
  assert.equal(chosen.response.metadata.error, 'C18_NO_M2');
  assert(!existsSync(path.join(context.project.path, 'archive.md')));
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'c18-summary-continuation.json'),
    JSON.stringify({ choices, yes, chosen, summaryCalls, persisted, sourceChecks }, null, 2) + '\n');
});


test('C18 explicit new target rejects the model stale target even when original text contains it', async () => {
  const context = await c18OpenTargetQuestion('Ulož odpověď do photo.md nebo archive.md.');
  const first = await c18Handle('photo.md nebo archive.md', context);
  assert.equal(first.admissions.length, 0);
  const mismatch = await c18Handle('archive.md', context, c18RecordedWrite);
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'c18-explicit-target-mismatch.json'),
    JSON.stringify({ first, mismatch, pendingAfterMismatch: context.sessionState.pendingDecision }, null, 2) + '\n');
  assert.equal(mismatch.admissions.length, 0, 'a new exact choice cannot authorize the model old target');
  assert.equal(mismatch.response.metadata.approvalRequired, false);
  assert.equal(mismatch.response.metadata.awaitingClarification, true);
  assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification.targetChoices, ['photo.md', 'archive.md']);
  assert(mismatch.response.content.includes('photo.md') && mismatch.response.content.includes('archive.md'));
  const matching = await c18Handle('archive.md', context, { ...c18RecordedWrite, target: 'archive.md' });
  assert.deepEqual(matching.admissions, [{ toolId: 'file.write', input: { path: 'archive.md', content: 'Původní úplný podklad.' } }]);
  assert.equal(matching.response.metadata.error, 'C18_NO_M2');
});


test('C18 review model clarification also keeps unresolved choices on subsequent yes', async () => {
  const context = await c18OpenTargetQuestion('Ulož odpověď do photo.md nebo archive.md.');
  const first = await c18Handle('photo.md nebo archive.md', context, { ...c18RecordedWrite,
    action: 'clarify', question: 'Vyber prosím jeden soubor.', target: null, understood: false });
  const beforeYes = structuredClone(context.sessionState.pendingDecision);
  context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
  const yes = await c18Handle('ano', context);
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'review-model-clarify-gap.json'),
    JSON.stringify({ first, beforeYes, yes, afterYes: context.sessionState.pendingDecision }, null, 2) + '\n');
  assert.equal(first.response.content, 'Vyber prosím jeden soubor.');
  assert.equal(first.admissions.length, 0);
  assert.equal(yes.admissions.length, 0, 'a model clarify must not discard an unresolved target pair before yes');
  assert.equal(beforeYes.metadata.fileSaveClarification.sourceMessageId, 2);
  assert.equal(beforeYes.metadata.fileSaveClarification.targetRequired, true);
  assert.deepEqual(beforeYes.metadata.fileSaveClarification.targetChoices, ['photo.md', 'archive.md']);
  assert.equal(beforeYes.metadata.originalRequest, 'Ulož odpověď do photo.md nebo archive.md.');
  assert.equal(beforeYes.metadata.fileSaveClarification.userMessageId, 3);
  assert.equal(beforeYes.metadata.fileSaveClarification.projectId, context.project.id);
  const matching = await c18Handle('archive.md', context, { ...c18RecordedWrite, target: 'archive.md' });
  assert.deepEqual(matching.admissions, [{ toolId: 'file.write', input: { path: 'archive.md', content: 'Původní úplný podklad.' } }]);
  assert.equal(matching.response.metadata.error, 'C18_NO_M2');
  assert(!existsSync(path.join(context.project.path, 'archive.md')));

});


test('C18 review repeated clarify with unknown source retains unresolved target authority', async () => {
  const context = await c18OpenTargetQuestion('Ulož odpověď do photo.md nebo archive.md.');
  const first = await c18Handle('photo.md nebo archive.md', context);
  const repeat = await c18Handle('ano', context, { ...c18RecordedWrite, action: 'clarify',
    question: 'Vyber prosím jeden soubor.', source: null, target: null, understood: false });
  const beforeYes = structuredClone(context.sessionState.pendingDecision);
  context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
  const yes = await c18Handle('ano', context);
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'review-clarify-source-gap.json'),
    JSON.stringify({ first, repeat, beforeYes, yes, afterYes: context.sessionState.pendingDecision }, null, 2) + '\n');
  assert.equal(first.admissions.length, 0);
  assert.equal(repeat.admissions.length, 0);
  assert.equal(yes.admissions.length, 0, 'an unknown-source clarify must not clear unresolved target choice authority');
  assert.equal(repeat.response.content, 'Vyber prosím jeden soubor.');
  assert.equal(beforeYes.metadata.fileSaveClarification.sourceMessageId, 2);
  assert.equal(beforeYes.metadata.fileSaveClarification.targetRequired, true);
  assert.deepEqual(beforeYes.metadata.fileSaveClarification.targetChoices, ['photo.md', 'archive.md']);
  assert.equal(beforeYes.metadata.originalRequest, 'Ulož odpověď do photo.md nebo archive.md.');
  assert.equal(beforeYes.metadata.fileSaveClarification.userMessageId, 3);
  assert.equal(beforeYes.metadata.fileSaveClarification.projectId, context.project.id);
  const matching = await c18Handle('archive.md', context, { ...c18RecordedWrite, target: 'archive.md' });
  assert.deepEqual(matching.admissions, [{ toolId: 'file.write', input: { path: 'archive.md', content: 'Původní úplný podklad.' } }]);
  assert.equal(matching.response.metadata.error, 'C18_NO_M2');
  assert(!existsSync(path.join(context.project.path, 'archive.md')));

});

// C18: real M1 HTTP and durable restart, with controlled provider responses.
// No approval command is sent. The final valid choice may only propose an effect.
test('C18 HTTP restart retains unresolved target choices for write clarify and classifier ASK_USER replies', async t => {
  for (const pairAction of ['write', 'clarify', 'ask-user']) await t.test(pairAction, async () => {
    const owned = createOwnedJourneyRuntime(isolatedTestRuntime);
    const model = 'fixture:1b', digest = 'a'.repeat(64);
    const answer = 'Fotografie dokáže zachytit neopakovatelný okamžik a proměnit ho v trvalou vzpomínku.';
    const initial = pairAction === 'write' ? 'Ulož tu odpověď.' : 'Ulož tu odpověď do photo.md nebo archive.md.';
    const question = 'Kam mám tuto odpověď uložit? (Prosím, uveďte název souboru.)';
    const pair = 'photo.md nebo archive.md';
    const calls = [], responses = [], turns = [], observations = [], stops = [];
    const audit = (name, data) => writeFileSync(path.join(owned.artifacts, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    let stage = 'answer';
    const provider = http.createServer(async (req, res) => {
      try {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = body ? JSON.parse(body) : {};
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/tags') { res.end(JSON.stringify({ models: [{ name: model, digest }] })); return; }
        if (req.url === '/api/show') { res.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } })); return; }
        if (req.url !== '/api/chat') { res.writeHead(503).end(); return; }
        calls.push({ stage, payload }); audit('provider-requests.json', calls);
        const raw = payload.messages.at(-1)?.content || '';
        const system = payload.messages[0]?.content || '';
        let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
        let content;
        if (payload.format?.properties?.action) {
          const clarify = stage === 'initial' || (stage === 'pair' && pairAction === 'clarify');
          content = JSON.stringify({ action: clarify ? 'clarify' : 'write',
            question: clarify ? stage === 'initial' ? question : 'Do photo.md, nebo archive.md?' : null,
            target: clarify ? null : stage === 'selected' ? 'archive.md' : 'photo.md',
            source: { kind: 'answer', messageId: parsed.answers[0]?.messageId },
            transformation: 'none', writeMode: 'replace', understood: !clarify, unsupported: [] });
        } else if (system.includes('Klasifikuj')) {
          const ambiguous = stage === 'ambiguous-yes' || (pairAction === 'ask-user' && stage === 'pair');
          content = JSON.stringify({ intent: ambiguous ? 'AMBIGUOUS' : stage === 'answer' ? 'CONVERSATIONAL' : 'FILE_WRITE',
            confidence: ambiguous ? 0.5 : 0.95,
            fileTarget: ['stale-selection', 'selected'].includes(stage) ? 'archive.md' : null,
            question: ambiguous ? stage === 'pair' ? 'Do photo.md, nebo archive.md?' : parsed.pending.question : null,
            continuesPending: ['stale-selection', 'selected'].includes(stage) ? false : Boolean(parsed.pending),
            requestedOperation: stage === 'answer' ? 'none' : 'write', responseScope: 'conversation' });
        } else if (parsed?.input || parsed?.userInput || system.includes('"reply"')) content = JSON.stringify({ reply: answer, plan: null });
        else content = answer;
        responses.push({ stage, sequence: calls.length, content }); audit('provider-responses.json', responses);
        res.end(JSON.stringify({ model, digest, done: true, done_reason: 'stop',
          message: { role: 'assistant', content }, prompt_eval_count: 10, eval_count: 30 }));
      } catch (error) { audit('provider-error.json', { message: error.message, stack: error.stack }); res.writeHead(500).end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
    let product, database, conversationId, project;
    const stop = async () => {
      if (!product) return;
      const current = product; await stopProduct(current);
      stops.push({ pid: current.child.pid, code: current.code, signal: current.signal, output: current.output });
      product = null; audit('stops.json', stops);
    };
    const restart = async () => { await stop(); product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model); };
    try {
      product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
      project = (await expectJson(product, 'POST', '/api/projects', { name: `c18-${pairAction}`, description: 'Owned CPU target-choice persistence regression' }, 201)).project;
      conversationId = (await expectJson(product, 'POST', '/api/conversations', { title: `c18-${pairAction}`, project_id: project.id, mode: 'chat' }, 201)).conversation.id;
      database = new Database(owned.database, { readonly: true });
      const pending = () => JSON.parse(database.prepare('SELECT state_json FROM session_state WHERE session_id = ?').get(conversationId)?.state_json || '{}').pendingDecision;
      const counts = () => Object.fromEntries(['tool_v1_requests', 'tool_v1_results', 'm2_effect_requests', 'm2_effect_results', 'm2_approval_grants'].map(table => [table, database.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
      const observe = label => {
        const value = { label, pending: pending(), counts: counts(), project,
          targetExists: Object.fromEntries(['photo.md', 'archive.md'].map(file => [file, existsSync(path.join(project.path, file))])),
          messages: database.prepare('SELECT id, role, content, metadata FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId) };
        observations.push(value); audit('observations.json', observations); return value;
      };
      const send = async (label, input) => {
        stage = label;
        const command = { contract: 'ConversationCommand', version: 1, requestId: randomBytes(16).toString('hex'), turnId: randomBytes(16).toString('hex'), conversationId, action: 'send', input };
        const result = await requestJson(product, 'POST', '/api/chat', command);
        turns.push({ stage, command, result }); audit('http-turns.json', turns); observe(label);
        assert.equal(result.status, 200, JSON.stringify(result)); return result.data;
      };
      const noAdmission = value => {
        assert.deepEqual(value.counts, { tool_v1_requests: 0, tool_v1_results: 0, m2_effect_requests: 0, m2_effect_results: 0, m2_approval_grants: 0 });
        assert.deepEqual(value.targetExists, { 'photo.md': false, 'archive.md': false });
      };
      const choices = value => {
        assert.equal(value.pending.metadata.fileSaveClarification.targetRequired, true);
        assert.deepEqual(value.pending.metadata.fileSaveClarification.targetChoices, ['photo.md', 'archive.md']);
      };
      const answered = await send('answer', 'Napiš jednu větu o fotografii.');
      assert.equal(answered.response.content, answer);
      await send('initial', initial);
      const first = observe('initial-state'); noAdmission(first);
      const provenance = first.pending.metadata.fileSaveClarification;
      assert.equal(provenance.projectId, project.id);
      assert.equal(provenance.targetRequired, true);
      const source = first.messages.find(row => row.id === provenance.sourceMessageId);
      assert.equal(source.content, answer); assert.equal(source.role, 'assistant');
      assert.equal(first.messages.find(row => row.id === provenance.userMessageId).content, initial);
      await send('pair', pair);
      const paired = observe('paired-before-restart'); noAdmission(paired);
      // Preserve the actual RED history even when marker persistence is wrong.
      await restart();
      const restored = observe('paired-after-restart'); assert.deepEqual(restored, { ...paired, label: restored.label });
      await send('ambiguous-yes', 'ano');
      const yes = observe('ambiguous-yes-before-restart'); noAdmission(yes);
      await restart();
      const yesRestored = observe('ambiguous-yes-after-restart'); assert.deepEqual(yesRestored, { ...yes, label: yesRestored.label });
      await send('write-yes', 'ano');
      const badYes = observe('write-yes-after-restart'); noAdmission(badYes); choices(badYes);
      choices(paired); choices(yesRestored);
      assert.equal(badYes.pending.metadata.originalRequest, initial);
      for (const value of [paired, restored, yes, yesRestored, badYes]) {
        const meta = value.pending.metadata.fileSaveClarification;
        for (const key of ['projectId', 'sourceMessageId', 'userMessageId']) assert.equal(meta[key], provenance[key]);
      }
      await send('stale-selection', 'archive.md');
      const stale = observe('stale-model-target'); noAdmission(stale);
      const proposal = await send('selected', 'archive.md');
      const selected = observe('selected-before-approval');
      assert.equal(proposal.response.metadata.approvalRequired, true, JSON.stringify(proposal));
      const request = JSON.parse(database.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?').get(proposal.response.metadata.toolRequestId).request_json);
      audit('final-proposal.json', { proposal, request });
      assert.equal(request.toolId, 'file.write'); assert.deepEqual(request.input, { path: 'archive.md', content: answer });
      assert.equal(selected.counts.tool_v1_requests, 1);
      assert.equal(selected.counts.m2_effect_results, 0); assert.equal(selected.counts.m2_approval_grants, 0);
      assert.deepEqual(selected.targetExists, { 'photo.md': false, 'archive.md': false });
      await restart();
      const final = observe('proposal-after-restart'); assert.deepEqual(final.counts, selected.counts);
      assert.deepEqual(final.targetExists, selected.targetExists);
      const lastSave = calls.filter(row => row.payload.format?.properties?.action).at(-1);
      const evidence = JSON.parse(lastSave.payload.messages.at(-1).content);
      assert.equal(evidence.pending.request, initial);
      assert.deepEqual(evidence.answers.map(row => row.messageId), [provenance.sourceMessageId]);
    } finally {
      if (database) database.close();
      await stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
      const copy = path.join(owned.artifacts, 'closed-db-copy'); mkdirSync(copy, { mode: 0o700 });
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(owned.database + suffix)) copyFileSync(owned.database + suffix, path.join(copy, 'c3.db' + suffix));
      audit('cleanup.json', { stops, providerClosed: !provider.listening, databaseCopy: copy, ownedRoot: owned.root, originalDatabase: owned.database, liveInference: 0, approvalsSent: 0 });
    }
  });
});


// C19: a classifier question cannot forget an unresolved target pair.
function c19AskPair(input, context, metadata = {}) {
  const decision = creDecisionEngine.overrideDecision({ type: DecisionType.ASK_USER,
    intent: IntentType.AMBIGUOUS, confidence: 0.5, slots: ['intent_clarification'],
    source: 'controlled-c19-continuation', reason: 'Filename choice is unresolved',
    metadata: { contextualInterpretation: true, continuesPending: true,
      requestedOperation: 'write', clarificationQuestion: 'Vyber prosím jeden soubor.', ...metadata } });
  return handleAskUserDecision(input, decision, context);
}

test('C19 ASK_USER fresh pair stays unresolved after restore and exact choice keeps original conditions', async () => {
  const original = 'Ulož původní odpověď do photo.md nebo archive.md; nic nepřepisuj.';
  const context = await c18OpenTargetQuestion(original);
  const before = structuredClone(context.sessionState.pendingDecision.metadata);
  const response = c19AskPair('photo.md nebo archive.md', context);
  const afterAsk = structuredClone(context.sessionState.pendingDecision.metadata);
  context.sessionState = SessionState.fromJSON(JSON.parse(JSON.stringify(context.sessionState.toJSON())));
  const yes = await c18Handle('ano', context, { ...c18RecordedWrite, writeMode: 'create' });
  writeFileSync(path.join(isolatedTestRuntime.artifacts, 'c19-ask-pair.json'),
    JSON.stringify({ before, afterAsk, response: { content: response.content, canExecute: response.canExecute }, yes }, null, 2) + '\n');
  assert.equal(yes.admissions.length, 0, 'classifier ASK_USER must keep the new unresolved pair before a later yes');
  assert.equal(response.content, 'Vyber prosím jeden soubor.');
  assert.equal(response.canExecute, false);
  assert.deepEqual(afterAsk.fileSaveClarification, { ...before.fileSaveClarification,
    targetChoices: ['photo.md', 'archive.md'] });
  assert.equal(afterAsk.originalRequest, original);
  const mismatch = await c18Handle('archive.md', context, { ...c18RecordedWrite, writeMode: 'create' });
  assert.equal(mismatch.admissions.length, 0);
  const matching = await c18Handle('archive.md', context, { ...c18RecordedWrite,
    target: 'archive.md', writeMode: 'create' });
  assert.deepEqual(matching.admissions, [{ toolId: 'file.create', input: { path: 'archive.md', content: 'Původní úplný podklad.' } }]);
  assert.equal(matching.response.metadata.error, 'C18_NO_M2');
  assert(!existsSync(path.join(context.project.path, 'archive.md')));
});

test('C19 ASK_USER pair retention has no authority outside its canonical continuation', async t => {
  for (const label of ['new task', 'cancel', 'other project', 'legacy without marker', 'unknown source', 'read operation', 'forged provenance']) await t.test(label, async () => {
    const context = await c18OpenTargetQuestion('Ulož odpověď do photo.md nebo archive.md.');
    const metadata = {};
    if (label === 'new task') metadata.continuesPending = false;
    if (label === 'cancel') {
      const { clearSupersededFileSaveQuestion } = await import('../src/chat/handlers/file.js');
      clearSupersededFileSaveQuestion(context, { type: 'ANSWER', intent: 'CONVERSATIONAL',
        metadata: { contextualInterpretation: true, continuesPending: false } });
      assert.equal(context.sessionState.pendingDecision, null);
    }
    if (label === 'other project') context.project = { ...context.project, id: 2 };
    if (label === 'legacy without marker') delete context.sessionState.pendingDecision.metadata.fileSaveClarification.targetRequired;
    if (label === 'unknown source') context.sessionState.pendingDecision.metadata.fileSaveClarification.sourceMessageId = null;
    if (label === 'read operation') context.sessionState.pendingDecision.metadata.originalRequestedOperation = 'read';
    if (label === 'forged provenance') {
      metadata.fileSaveClarification = structuredClone(context.sessionState.pendingDecision.metadata.fileSaveClarification);
      delete context.sessionState.pendingDecision.metadata.fileSaveClarification;
    }
    const response = c19AskPair('photo.md nebo archive.md', context, metadata);
    assert.equal(response.content, 'Vyber prosím jeden soubor.');
    assert.equal(response.canExecute, false);
    assert.equal(context.sessionState.pendingDecision.metadata.fileSaveClarification?.targetChoices, undefined);
    if (['new task', 'cancel', 'other project', 'forged provenance'].includes(label)) {
      assert.equal(context.sessionState.pendingDecision.metadata.fileSaveClarification, undefined);
    }
  });
});

test('C19 ASK_USER retains only negative choices and later resolver still rejects a changed source', async () => {
  const context = await c18OpenTargetQuestion('Ulož odpověď do photo.md nebo archive.md.');
  context.history = [];
  c19AskPair('photo.md nebo archive.md', context);
  assert.equal(context.sessionState.pendingDecision.metadata.fileSaveClarification.sourceMessageId, 2);
  const result = await c18Handle('archive.md', context, { ...c18RecordedWrite, target: 'archive.md' });
  assert.equal(result.admissions.length, 0);
  assert.equal(result.response.metadata.error, 'file_write_source_changed');
});

test('C19 ASK_USER does not interpret quoted filename data or prose as a new pair', async t => {
  for (const input of ['"photo.md nebo archive.md"', 'Ulož do photo.md, ale archive.md nemaž.']) await t.test(input, async () => {
    const context = await c18OpenTargetQuestion();
    const before = structuredClone(context.sessionState.pendingDecision.metadata.fileSaveClarification);
    c19AskPair(input, context);
    assert.deepEqual(context.sessionState.pendingDecision.metadata.fileSaveClarification, before);
  });
});
