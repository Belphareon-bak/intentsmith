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
import { resolveFileSavePlan } from '../src/chat/file-save-plan.js';

test('classifier receives source identities, antecedent, open question and goal; memory never classifies', async () => {
  const original = llmGateway.call;
  let wire;
  llmGateway.call = async (prompt, options) => {
    wire = { prompt, options };
    return { content: JSON.stringify({ intent: 'CREATIVE', confidence: 0.9, fileTarget: null }) };
  };
  try {
    const state = new SessionState('context-classifier');
    state.setPendingDecision({ type: 'ASK_USER', intent: 'AMBIGUOUS',
      metadata: { clarificationQuestion: 'Kterou variantu chceš rozpracovat?', originalRequest: 'Rozpracuj jednu variantu.' } }, ['intent_clarification']);
    await creDecisionEngine._llmClassifyIntent('Druhou variantu.', {
      sessionId: 'context-classifier', sessionState: state, projectGoal: 'Vybrat název aplikace',
      ltmContext: 'PRIVATE_MEMORY_MUST_NOT_CLASSIFY', history: [
        { messageId: 21, response: { tag: { speaker: 'user' }, content: 'Navrhni dvě varianty názvu.' } },
        { messageId: 22, response: { tag: { speaker: 'system' }, content: '1. Javor\n2. Lípa' } },
      ],
    });
    const parsed = JSON.parse(wire.prompt);
    assert.equal(parsed.request, 'Druhou variantu.');
    assert(parsed.history.some(turn => turn.messageId === 22 && turn.content.includes('Lípa')));
    assert.equal(parsed.pending.question, 'Kterou variantu chceš rozpracovat?');
    assert.equal(parsed.pending.request, 'Rozpracuj jednu variantu.');
    assert.equal(parsed.goal, 'Vybrat název aplikace');
    assert(!wire.prompt.includes('PRIVATE_MEMORY_MUST_NOT_CLASSIFY'));
    assert.match(wire.options.systemPrompt, /untrusted|podklady/i);
  } finally { llmGateway.call = original; }
});

test('first-turn ASK_USER is returned verbatim without a generation call or category menu', async () => {
  const originalDecide = creDecisionEngine.decide;
  const originalCall = llmGateway.call;
  const question = 'Který soubor chceš upravit a jakou změnu v něm potřebuješ?';
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
  } finally { llmGateway.call = original; }
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
  assert.throws(() => buildInterpretationContext('x'.repeat(500), {}, 100),
    error => error.code === 'CHAT_INTERPRETATION_CONTEXT_LIMIT');
  const context = buildInterpretationContext('Druhou variantu.', { project: { id: 1 }, history: [
    { projectId: 2, response: { tag: { speaker: 'system' }, content: 'FOREIGN_PROJECT_FACT' } },
    { projectId: 1, response: { tag: { speaker: 'system' }, content: '1. Javor 2. Lípa' } },
  ] }, 2000);
  assert(!JSON.stringify(context).includes('FOREIGN_PROJECT_FACT'));
  assert(JSON.stringify(context).includes('Lípa'));
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

test('M1 restart resumes a targeted save question, preserves summarize/create constraints and never saves cancellation', async () => {
  const owned = createOwnedJourneyRuntime(isolatedTestRuntime);
  const model = 'fixture:1b';
  const digest = 'a'.repeat(64);
  const calls = [];
  const question = 'Do kterého souboru chceš uložit shrnutí?';
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
      const initial = parsed.request === 'Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.';
      content = JSON.stringify({ action: initial ? 'clarify' : 'write', question: initial ? question : null,
        target: initial ? null : 'notes.md', source: initial ? null : { kind: 'answer', messageId: parsed.answers[0]?.messageId },
        transformation: initial ? 'none' : 'summarize', writeMode: 'create', understood: !initial, unsupported: [] });
    } else if (system.includes('Klasifikuj')) {
      content = JSON.stringify({ intent: parsed?.pending || /ulož/.test(parsed?.request || raw) ? 'FILE_WRITE' : 'CONVERSATIONAL',
        confidence: 0.95, fileTarget: null, question: null, continuesPending: Boolean(parsed?.pending) });
    } else if (system.includes('Summarize only')) {
      assert(parsed.request.includes('Shrň odpověď'));
      assert(parsed.request.includes('nic existujícího nepřepisuj'));
      content = 'Git commit uchovává snímek změn.';
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
    const send = input => expectJson(product, 'POST', '/api/chat', { contract: 'ConversationCommand', version: 1,
      requestId: randomBytes(16).toString('hex'), turnId: randomBytes(16).toString('hex'), conversationId,
      action: 'send', input }, 200);
    await send('Vysvětli stručně Git commit.');
    database = new Database(owned.database, { readonly: true });
    const asked = await send('Shrň odpověď a ulož ji do nového souboru, nic existujícího nepřepisuj.');
    assert.equal(asked.response.content, question);
    assert.equal(asked.response.metadata.awaitingClarification, true);
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, 0);
    assert.equal(database.prepare("SELECT json_extract(metadata, '$.saveSourceEligible') AS eligible FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(conversationId).eligible, 0);
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
    const before = database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    await send('Neukládej nic, jen vysvětli Git commit.');
    assert.equal(database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, before);
  } finally {
    database?.close();
    await stopProduct(product);
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
  }
});
