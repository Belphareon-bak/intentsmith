#!/usr/bin/env node
// Real M1/SQLite boundary with an explicitly controlled semantic provider.
// This proves grounding and composition; it does not prove live language quality.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as testRuntime } from './helpers/isolated-test-db.js';
import { suite, testAsync, summary } from './harness.js';

suite('M1 semantic file save with durable sources');
await testAsync('polite/literal/summary saves bind exact bytes and IDs; invalid concrete values create no effect', async () => {
  const owned = createOwnedJourneyRuntime(testRuntime);
  const model = 'fixture:1b', digest = 'a'.repeat(64);
  const original = 'Podklady: příjem 12000 Kč; výdaje 3000 Kč. Rozdíl 9000 Kč.';
  const summarized = 'Rozdíl příjmů a výdajů je 9000 Kč.';
  const literal = 'nepřepisuj: -12,5 Kč\nŽluťoučký kůň.';
  const plans = new Map([
    ['Prosím ulož to do polite.md, díky.', { target: 'polite.md' }],
    ['Ulož tu odpověď do response.md.', { target: 'response.md' }],
    ['Ulož ji i do copy.md.', { target: 'copy.md' }],
    ['Shrň předchozí odpověď a ulož ji do summary.md.', { target: 'summary.md', transformation: 'summarize' }],
    ['Ulož ji i do summary-copy.md.', { target: 'summary-copy.md' }],
    [`Ulož text "${literal}" do literal.md, díky.`, { target: 'literal.md', literal }],
    ['Ulož to do guessed.md.', { target: 'invented.md' }],
    ['Ulož to do changed-source.md.', { target: 'changed-source.md', sourceId: 999999999 }],
    ['Ulož text "Správně" do fabricated.md.', { target: 'fabricated.md', literal: 'Podvrženě' }],
    ['Ulož to do constraints.md a nastav veřejná práva.', { target: 'constraints.md', unsupported: ['chmod'] }],
    ['Ulož to do maybe.md, pokud je dost místa.', { target: 'maybe.md', understood: false }],
    ['Ulož to do smallname.md.', { target: 'name.md' }],
    ['Ulož to do plan-length.md.', { target: 'plan-length.md', truncatePlan: true }],
    ['Ulož text "ghost.md" a text "ghost.md".', { target: 'ghost.md', literal: 'ghost.md' }],
    ['Ulož text „ghost.md“ a text "ghost.md".', { target: 'ghost.md', literal: 'ghost.md' }],
    ['Ulož text notes"PAYLOAD".md.', { target: 'notes.md', literal: 'PAYLOAD' }],
    ['Ulož text "notes.md" do duplicate-ok.md; text "notes.md" je přesný obsah.', { target: 'duplicate-ok.md', literal: 'notes.md' }],
    ['Shrň předchozí odpověď a ulož ji do truncated.md.', { target: 'truncated.md', transformation: 'summarize' }],
  ]);
  let truncate = false;
  let summaryCalls = 0;
  const provider = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') return response.end(JSON.stringify({ models: [{ name: model, digest }] }));
    if (request.url === '/api/show') return response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    if (!['/api/chat', '/api/generate'].includes(request.url)) return response.writeHead(503).end('{}');
    const prompt = body.messages?.at(-1)?.content || body.prompt;
    const system = body.messages?.find(message => message.role === 'system')?.content || body.system || '';
    let content = JSON.stringify({ reply: original, plan: null });
    let doneReason = 'stop';
    if (body.format?.properties?.action) {
      const parsed = JSON.parse(prompt);
      const spec = plans.get(parsed.request);
      assert(spec, `unexpected semantic fixture input: ${parsed.request}`);
      content = JSON.stringify({ action: 'write', question: null, target: spec.target,
        source: Object.hasOwn(spec, 'literal') ? { kind: 'literal', literalId: parsed.literals.find(value => value.content === spec.literal)?.literalId ?? 999999999 }
          : { kind: 'answer', messageId: spec.sourceId || parsed.answers[0]?.messageId },
        transformation: spec.transformation || 'none', writeMode: 'replace',
        understood: spec.understood ?? true, unsupported: spec.unsupported || [] });
      if (spec.truncatePlan) doneReason = 'length';
    } else if (system.includes('Summarize only the supplied answer')) {
      summaryCalls += 1; content = summarized; doneReason = truncate ? 'length' : 'stop';
    } else if (body.format === 'json' && system.includes('Klasifikuj záměr')) {
      const spec = plans.get(prompt) || [...plans].find(([input]) => prompt.startsWith(input + '\n'))?.[1];
      if (spec) content = JSON.stringify({ intent: 'FILE_WRITE', confidence: 0.99, fileTarget: spec.target });
    }
    response.end(JSON.stringify({ model, digest, done: true, done_reason: doneReason,
      message: { role: 'assistant', content }, response: content, prompt_eval_count: 10, eval_count: 10 }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  let product, privateDb;
  const send = (conversationId, input) => expectJson(product, 'POST', '/api/chat', {
    contract: 'ConversationCommand', version: 1, action: 'send', input, conversationId,
    requestId: `semantic-${randomBytes(8).toString('hex')}`, turnId: `semantic-turn-${randomBytes(8).toString('hex')}`,
  }, 200);
  try {
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const project = (await expectJson(product, 'POST', '/api/projects', { name: `semantic-${randomBytes(5).toString('hex')}` }, 201)).project;
    const conversationId = (await expectJson(product, 'POST', '/api/conversations', { title: 'semantic-save', project_id: project.id, mode: 'chat' }, 201)).conversation.id;
    assert.equal((await send(conversationId, 'Vysvětli stručně, co je Git commit.')).response.content, original);
    privateDb = new Database(owned.database, { readonly: true, fileMustExist: true });
    const answerId = privateDb.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(conversationId).id;
    const exactSave = async (input, target, content, expectedSource) => {
      const proposal = await send(conversationId, input);
      assert.equal(proposal.response.metadata?.approvalRequired, true, input + JSON.stringify(proposal));
      assert.equal(proposal.response.metadata.fileSaveSource.messageId, expectedSource);
      const request = JSON.parse(privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?').get(proposal.response.metadata.toolRequestId).request_json);
      assert.deepEqual(request.input, { path: target, content });
      assert.equal(proposal.response.metadata.fileSaveSource.digest, `sha256:${createHash('sha256').update(content).digest('hex')}`);
      assert.equal(existsSync(path.join(project.path, target)), false);
      const approved = await send(conversationId, `schválit efekt ${proposal.response.metadata.effectId}`);
      assert.equal(approved.response.metadata.effectResult, 'succeeded');
      assert.deepEqual(readFileSync(path.join(project.path, target)), Buffer.from(content));
      return proposal;
    };
    await exactSave('Prosím ulož to do polite.md, díky.', 'polite.md', original, answerId);
    await exactSave('Ulož tu odpověď do response.md.', 'response.md', original, answerId);
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    await exactSave('Ulož ji i do copy.md.', 'copy.md', original, answerId);
    const literalInput = `Ulož text "${literal}" do literal.md, díky.`;
    const literalProposal = await send(conversationId, literalInput);
    assert.equal(literalProposal.response.metadata.approvalRequired, true);
    const literalRequest = JSON.parse(privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?').get(literalProposal.response.metadata.toolRequestId).request_json);
    assert.deepEqual(literalRequest.input, { path: 'literal.md', content: literal });
    const literalUser = privateDb.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' AND content = ?").get(conversationId, literalInput);
    assert.equal(literalProposal.response.metadata.fileSaveSource.messageId, literalUser.id);
    assert.equal(literalProposal.response.metadata.fileSaveSource.kind, 'user_literal');
    assert.equal((await send(conversationId, `schválit efekt ${literalProposal.response.metadata.effectId}`)).response.metadata.effectResult, 'succeeded');
    assert.deepEqual(readFileSync(path.join(project.path, 'literal.md')), Buffer.from(literal));
    const duplicateInput = 'Ulož text "notes.md" do duplicate-ok.md; text "notes.md" je přesný obsah.';
    const duplicateProposal = await send(conversationId, duplicateInput);
    assert.equal(duplicateProposal.response.metadata.approvalRequired, true);
    const duplicateRequest = JSON.parse(privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?').get(duplicateProposal.response.metadata.toolRequestId).request_json);
    assert.deepEqual(duplicateRequest.input, { path: 'duplicate-ok.md', content: 'notes.md' });
    assert.equal(duplicateProposal.response.metadata.fileSaveSource.messageId,
      privateDb.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' AND content = ?").get(conversationId, duplicateInput).id);
    assert.equal((await send(conversationId, `schválit efekt ${duplicateProposal.response.metadata.effectId}`)).response.metadata.effectResult, 'succeeded');
    assert.deepEqual(readFileSync(path.join(project.path, 'duplicate-ok.md')), Buffer.from('notes.md'));
    // Refresh an answer after several protocol turns: newest content, not receipt.
    assert.equal((await send(conversationId, 'Vysvětli stručně, co je Git commit.')).response.content, original);
    const originId = privateDb.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(conversationId).id;
    const beforeSummary = summaryCalls;
    const proposal = await send(conversationId, 'Shrň předchozí odpověď a ulož ji do summary.md.');
    assert.equal(proposal.response.metadata.approvalRequired, true, JSON.stringify(proposal));
    assert.equal(summaryCalls, beforeSummary + 1);
    const summaryId = proposal.response.metadata.fileSaveSource.messageId;
    assert.notEqual(summaryId, originId);
    assert.equal(proposal.response.metadata.fileSaveSource.originMessageId, originId);
    const summaryRow = privateDb.prepare('SELECT content, metadata FROM messages WHERE id = ?').get(summaryId);
    assert.equal(summaryRow.content, summarized);
    assert.equal(JSON.parse(summaryRow.metadata).summarizedMessageId, originId);
    assert.equal(JSON.parse(summaryRow.metadata).messageKind, 'answer');
    assert.equal(JSON.parse(summaryRow.metadata).m7, undefined, 'an intermediate source is not an M1 terminal success');
    const summaryRequest = JSON.parse(privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?').get(proposal.response.metadata.toolRequestId).request_json);
    assert.deepEqual(summaryRequest.input, { path: 'summary.md', content: summarized });
    assert.equal((await send(conversationId, `schválit efekt ${proposal.response.metadata.effectId}`)).response.metadata.effectResult, 'succeeded');
    assert.deepEqual(readFileSync(path.join(project.path, 'summary.md')), Buffer.from(summarized));
    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    await exactSave('Ulož ji i do summary-copy.md.', 'summary-copy.md', summarized, summaryId);
    for (const [input, error, overridePlan] of [
      ['Ulož to do guessed.md.', 'file_write_target_unverified'],
      ['Ulož to do changed-source.md.', 'file_write_source_unverified'],
      ['Ulož text "Správně" do fabricated.md.', 'file_write_literal_unverified'],
      ['Ulož to do constraints.md a nastav veřejná práva.', 'file_write_constraints_unresolved'],
      ['Ulož to do maybe.md, pokud je dost místa.', 'file_write_constraints_unresolved'],
      ['Ulož to do smallname.md.', 'file_write_target_unverified'],
      ['Ulož to do plan-length.md.', 'file_write_plan_truncated'],
      ['Ulož text "ghost.md" a text "ghost.md".', 'file_write_target_unverified'],
      ['Ulož text „ghost.md“ a text "ghost.md".', 'file_write_target_unverified'],
      ['Ulož text notes"PAYLOAD".md.', 'file_write_target_unverified'],
      ['Ulož text notes"PAYLOAD".md.', 'file_write_target_unverified',
        { target: 'notes' + ' '.repeat(9) + '.md', literal: 'PAYLOAD' }],
    ]) {
      if (overridePlan) plans.set(input, overridePlan);
      const count = privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
      const rejected = await send(conversationId, input);
      assert.equal(rejected.response.metadata.approvalRequired, false, input);
      assert.equal(rejected.response.metadata.error, error, input);
      assert.equal(privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, count, input);
    }
    await send(conversationId, 'Vysvětli stručně, co je Git commit.');
    truncate = true;
    const beforeTruncation = privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    const truncated = await send(conversationId, 'Shrň předchozí odpověď a ulož ji do truncated.md.');
    assert.notEqual(truncated.response.metadata.approvalRequired, true);
    assert.equal(privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, beforeTruncation);
    assert.equal(existsSync(path.join(project.path, 'truncated.md')), false);
  } finally {
    privateDb?.close(); await stopProduct(product);
    await new Promise(resolve => provider.close(resolve));
  }
}, 180_000);
summary();
