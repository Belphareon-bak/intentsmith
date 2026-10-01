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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { ConversationStore, TurnRole } from '../src/chat/conversation-store.js';
import { maybeCompact, awaitPendingCompaction } from '../src/chat/context-compact.js';
import { buildInterpretationContext } from '../src/chat/conversation-context.js';
import { config } from '../src/config.js';
import { setNumCtx, clearNumCtxCache } from '../src/llm/model-ctx.js';
import { resolveFileSavePlan, generateSaveContent } from '../src/chat/file-save-plan.js';
import { formatClarificationRequest } from '../src/chat/handlers/ask-user.js';
import { enforceOutputContract } from '../src/chat/handlers/utils/output-gate.js';
import { getLanguageContext } from '../src/chat/handlers/utils/language.js';
import { assertCreativeQuality } from '../src/chat/handlers/utils/quality.js';

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
  llmGateway.call = async (prompt, options) => {
    calls.push({ prompt, options });
    return { content: 'Commit je uložený snímek změn v Gitu.', model: 'controlled', finishReason: 'stop' };
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

test('M1 restart resumes a targeted save question, preserves summarize/create constraints and never saves cancellation', async () => {
  const owned = createOwnedJourneyRuntime(isolatedTestRuntime);
  const model = 'fixture:1b';
  const digest = 'a'.repeat(64);
  const calls = [];
  const question = 'Do kterého souboru chceš uložit shrnutí?';
  const literal = '  Žluťoučký kůň\nřádek 2  \n```\n<img src=x onerror=alert(1)>';
  const literalRequest = `Ulož doslovně „${literal}“.`;
  const decomposedRequest = 'Ulož doslovně „Cafe\u0301“ do decomposed.txt.';
  const generationInstruction = 'Napiš dvě krátké věty o rostlinách';
  const generationRequest = `${generationInstruction} a ulož je do nového souboru plants.md, nic existujícího nepřepisuj.`;
  const generatedContent = 'Rostliny potřebují světlo odpovídající svému druhu. Zálivku přizpůsob stavu substrátu.';
  const freshLiteralRequest = 'Ulož doslovně „Nový text“ do replacement.md.';
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
      } else if (parsed.request === 'Ulož tu odpověď do stale.md.') {
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
      } else if (parsed.request === literalRequest || parsed.pending?.request === literalRequest) {
        const complete = parsed.request === 'quoted.txt';
        content = JSON.stringify({ action: 'write', question: null, target: complete ? 'quoted.txt' : null,
          source: { kind: 'literal', literalId: parsed.literals.find(value => value.content === literal)?.literalId },
          transformation: 'none', writeMode: 'replace', understood: complete, unsupported: complete ? [] : ['target'] });
      } else {
      const initial = parsed.request === 'Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.';
      content = JSON.stringify({ action: 'write', question: null,
        target: initial ? inventMissingTarget ? 'invented.md' : null : 'notes.md',
        source: { kind: 'answer', messageId: parsed.answers[0]?.messageId },
        transformation: initial ? 'none' : 'summarize', writeMode: 'create', understood: !initial || inventMissingTarget,
        unsupported: initial && !inventMissingTarget ? ['missing explicit target filename'] : [] });
      }
    } else if (system.includes('Klasifikuj')) {
      if (parsed?.request === 'Smaž ten druhý.' || parsed?.request === 'Myslím notes.md.') {
        content = JSON.stringify({ intent: parsed.request === 'Smaž ten druhý.' ? 'AMBIGUOUS' : 'FILE_DELETE',
          confidence: 0.95, fileTarget: parsed.request === 'Myslím notes.md.' ? 'notes.md' : null,
          question: parsed.request === 'Smaž ten druhý.' ? 'Který soubor chceš smazat?' : null,
          requestedOperation: 'delete',
          continuesPending: Boolean(parsed.pending), responseScope: 'conversation' });
      } else {
      const ambiguous = parsed?.request === 'Pomoz mi s výběrem.';
      const write = parsed?.pending?.intent === 'FILE_WRITE' || /ulož/i.test(parsed?.request || raw);
      content = JSON.stringify({ intent: ambiguous ? 'AMBIGUOUS' : write ? 'FILE_WRITE'
        : parsed?.request?.includes('faktoriál') ? 'CODE' : 'CONVERSATIONAL',
        confidence: 0.95, fileTarget: null, question: ambiguous ? 'Mezi čím se rozhoduješ?'
          : parsed?.request === 'Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.' ? question : null,
        continuesPending: parsed?.request === freshLiteralRequest ? false : Boolean(parsed?.pending), responseScope: 'conversation',
        briefResponse: parsed?.request === failedBriefRequest,
        responseWordCount: parsed?.request === failedBriefRequest ? 5 : null,
        requestedOperation: write ? 'write' : 'none' });
      }
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
    res.end(JSON.stringify({ model, digest, done: true, done_reason: 'stop',
      message: { role: 'assistant', content }, prompt_eval_count: 10, eval_count: 30 }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  let product;
  let database;
  try {
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const project = (await expectJson(product, 'POST', '/api/projects', { name: 'context-save', description: 'Owned context test' }, 201)).project;
    const conversationId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'context-save', project_id: project.id, mode: 'chat',
    }, 201)).conversation.id;
    const send = (input, expectedStatus = 200) => expectJson(product, 'POST', '/api/chat', { contract: 'ConversationCommand', version: 1,
      requestId: randomBytes(16).toString('hex'), turnId: randomBytes(16).toString('hex'), conversationId,
      action: 'send', input }, expectedStatus);
    const genericQuestion = await send('Pomoz mi s výběrem.');
    assert.equal(genericQuestion.response.content, 'Mezi čím se rozhoduješ?');
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
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
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const proposal = await send('notes.md');
    assert.equal(proposal.response.metadata.approvalRequired, true, JSON.stringify(proposal));
    const interpretation = calls.filter(call => call.format?.properties?.action).at(-1);
    assert.equal(JSON.parse(interpretation.messages.at(-1).content).pending.question, question);
    const tool = JSON.parse(database.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(proposal.response.metadata.toolRequestId).request_json);
    assert.equal(tool.toolId, 'file.create');
    assert.deepEqual(tool.input, { path: 'notes.md', content: 'Git commit uchovává snímek změn.' });
    assert(!existsSync(path.join(project.path, 'notes.md')));
    const approved = await send(`schválit efekt ${proposal.response.metadata.effectId}`);
    assert.equal(approved.response.metadata.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(project.path, 'notes.md'), 'utf8'), tool.input.content);
    assert.equal(typeof approved.response.metadata.chatTiming.totalMs, 'number');
    const beforeLiteral = database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    await send(literalRequest);
    await send('ano');
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, beforeLiteral);
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const literalProposal = await send('quoted.txt');
    assert.equal(literalProposal.response.metadata.approvalRequired, true, JSON.stringify(literalProposal));
    assert(literalProposal.response.content.includes(`\n\`\`\`\`\n${literal}\n\`\`\`\``),
      'multiline source stays inert in a fence longer than its embedded Markdown delimiter');
    const literalSource = database.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' AND content = ?")
      .get(conversationId, literalRequest);
    assert.equal(literalProposal.response.metadata.fileSaveSource.kind, 'user_literal');
    assert.equal(literalProposal.response.metadata.fileSaveSource.originMessageId, literalSource.id);
    assert(!existsSync(path.join(project.path, 'quoted.txt')));
    await send(`schválit efekt ${literalProposal.response.metadata.effectId}`);
    assert.equal(readFileSync(path.join(project.path, 'quoted.txt'), 'utf8'), literal);
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
    const before = database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    await send('Neukládej nic, jen vysvětli Git commit.');
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
    const deleteQuestion = await send('Smaž ten druhý.');
    assert.equal(deleteQuestion.response.content, 'Který soubor chceš smazat?');
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const refusedDeletion = await send('Myslím notes.md.');
    assert(refusedDeletion.response.content.includes('soubory mazat neumím'), JSON.stringify(refusedDeletion));
    assert.notEqual(refusedDeletion.response.metadata.approvalRequired, true);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
    assert.equal(readFileSync(path.join(project.path, 'notes.md'), 'utf8'), 'Git commit uchovává snímek změn.');
    const failed = await send(failedBriefRequest, 500);
    assert.equal(failed.error.code, 'CHAT_PROCESSING_FAILED', JSON.stringify(failed));
    assert.equal(database.prepare("SELECT role FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1")
      .get(conversationId).role, 'user');
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const stale = await send('Ulož tu odpověď do stale.md.');
    assert.equal(stale.response.metadata.awaitingClarification, true, JSON.stringify(stale));
    assert(stale.response.content.includes('nemá dokončenou odpověď'), stale.response.content);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
    assert(!existsSync(path.join(project.path, 'stale.md')));
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const stillStale = await send('stale.md');
    assert.equal(stillStale.response.metadata.awaitingClarification, true, JSON.stringify(stillStale));
    assert(stillStale.response.content.includes('nemá dokončenou odpověď'), stillStale.response.content);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
  } finally {
    database?.close();
    await stopProduct(product);
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
  }
});
