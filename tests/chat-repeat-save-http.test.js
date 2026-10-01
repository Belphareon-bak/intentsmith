#!/usr/bin/env node

// A second save must retain the source answer across a real M1 approval turn.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as testRuntime } from './helpers/isolated-test-db.js';
import { suite, testAsync, summary } from './harness.js';

suite('M1 repeated save of the original answer');

await testAsync('save the same answer twice after the first effect approval', async () => {
  const owned = createOwnedJourneyRuntime(testRuntime);
  const model = 'fixture:1b';
  const digest = 'a'.repeat(64);
  const sourceAnswer = 'Původní odpověď: Git commit uchovává snímek změn.';
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain owned fixture request. */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: model, digest }] }));
    } else if (request.method === 'POST' && request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.method === 'POST' && ['/api/chat', '/api/generate'].includes(request.url)) {
      response.end(JSON.stringify({ model, digest, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify({ reply: sourceAnswer, plan: null }) },
        response: sourceAnswer, prompt_eval_count: 10, eval_count: 10 }));
    } else {
      response.writeHead(503).end(JSON.stringify({ error: 'Unexpected fixture endpoint' }));
    }
  });
  await new Promise((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', resolve);
  });
  let product = null;
  let privateDb = null;
  try {
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const project = (await expectJson(product, 'POST', '/api/projects', {
      name: `repeat-save-${randomBytes(5).toString('hex')}`,
      description: 'Owned repeat-save fixture',
    }, 201)).project;
    const conversationId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'repeat-save', project_id: project.id, mode: 'chat',
    }, 201)).conversation.id;
    const send = input => expectJson(product, 'POST', '/api/chat', {
      contract: 'ConversationCommand', version: 1,
      requestId: `repeat-save-${randomBytes(8).toString('hex')}`,
      conversationId, turnId: `repeat-turn-${randomBytes(8).toString('hex')}`,
      action: 'send', input,
    }, 200);
    const answer = await send('Vysvětli stručně, co je Git commit.');
    assert.equal(answer.response.content, sourceAnswer);

    privateDb = new Database(owned.database, { readonly: true, fileMustExist: true });
    const proposed = await send('Ulož odpověď do copy.md.');
    assert.equal(proposed.response.metadata?.handler, 'file.write');
    assert.equal(proposed.response.metadata?.approvalRequired, true);
    const firstRequest = JSON.parse(privateDb.prepare(
      'SELECT request_json FROM tool_v1_requests WHERE request_id = ?',
    ).get(proposed.response.metadata.toolRequestId).request_json);
    assert.deepEqual(firstRequest.input, { path: 'copy.md', content: sourceAnswer });
    const approved = await send(`schválit efekt ${proposed.response.metadata.effectId}`);
    assert.equal(approved.response.metadata?.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(project.path, 'copy.md'), 'utf8'), sourceAnswer);
    const turns = privateDb.prepare(
      "SELECT content, metadata FROM messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY id",
    ).all(conversationId).map(row => ({ content: row.content, metadata: JSON.parse(row.metadata) }));
    assert.equal(turns.find(turn => turn.content === sourceAnswer)?.metadata.saveSourceEligible, true);
    assert.equal(turns.at(-2).metadata.saveSourceEligible, false, 'write preview is not a source answer');
    assert.equal(turns.at(-1).metadata.saveSourceEligible, false, 'approval receipt is not a source answer');

    await stopProduct(product);
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);

    const proposedAgain = await send('Ulož ji i do copy-backup.md.');
    assert.equal(proposedAgain.response.metadata?.handler, 'file.write');
    assert.equal(proposedAgain.response.metadata?.approvalRequired, true);
    const secondRequest = JSON.parse(privateDb.prepare(
      'SELECT request_json FROM tool_v1_requests WHERE request_id = ?',
    ).get(proposedAgain.response.metadata.toolRequestId).request_json);
    assert.deepEqual(secondRequest.input, { path: 'copy-backup.md', content: sourceAnswer },
      'the backup must not contain the first write proposal or approval message');
    const approvedAgain = await send(`schválit efekt ${proposedAgain.response.metadata.effectId}`);
    assert.equal(approvedAgain.response.metadata?.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(project.path, 'copy-backup.md'), 'utf8'), sourceAnswer);
  } finally {
    privateDb?.close();
    if (product) await stopProduct(product);
    provider.closeAllConnections();
    await new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
}, 180_000);

summary();
