#!/usr/bin/env node

// A second save must retain the source answer across a real M1 approval turn.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, requestJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as testRuntime } from './helpers/isolated-test-db.js';
import { suite, testAsync, summary } from './harness.js';

suite('M1 repeated save of the original answer');

await testAsync('save the same answer twice after the first effect approval', async () => {
  const owned = createOwnedJourneyRuntime(testRuntime);
  const model = 'fixture:1b';
  const digest = 'a'.repeat(64);
  const sourceAnswer = 'Původní odpověď: Git commit uchovává snímek změn.';
  let providerAnswer = sourceAnswer;
  let delayedModel = null;
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain owned fixture request. */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: model, digest }] }));
    } else if (request.method === 'POST' && request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.method === 'POST' && ['/api/chat', '/api/generate'].includes(request.url)) {
      if (delayedModel) {
        const held = delayedModel;
        delayedModel = null;
        held.enter();
        await held.release;
      }
      response.end(JSON.stringify({ model, digest, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify({ reply: providerAnswer, plan: null }) },
        response: providerAnswer, prompt_eval_count: 10, eval_count: 10 }));
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
    const command = (input, currentConversationId = conversationId) => ({
      contract: 'ConversationCommand', version: 1,
      requestId: `repeat-save-${randomBytes(8).toString('hex')}`,
      conversationId: currentConversationId, turnId: `repeat-turn-${randomBytes(8).toString('hex')}`,
      action: 'send', input,
    });
    const send = (input, currentConversationId = conversationId) =>
      expectJson(product, 'POST', '/api/chat', command(input, currentConversationId), 200);
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
    assert.equal(turns.find(turn => turn.content === sourceAnswer)?.metadata.saveSourceProjectId,
      project.id);
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

    const projectB = (await expectJson(product, 'POST', '/api/projects', {
      name: `repeat-save-b-${randomBytes(5).toString('hex')}`,
      description: 'Second private project for provenance check',
    }, 201)).project;
    const reboundId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'source-project-a', project_id: project.id, mode: 'chat',
    }, 201)).conversation.id;
    assert.equal((await send('Vysvětli stručně, co je Git commit.', reboundId)).response.content,
      sourceAnswer);
    await expectJson(product, 'PUT', `/api/conversations/${encodeURIComponent(reboundId)}`,
      { project_id: projectB.id }, 200);
    const beforeForeign = privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    const foreign = await send('Ulož ji do cross-project.md.', reboundId);
    assert.notEqual(foreign.response.metadata?.approvalRequired, true);
    assert.equal(privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n,
      beforeForeign, 'a source from project A must never prepare a write in B');
    assert.equal(existsSync(path.join(projectB.path, 'cross-project.md')), false);

    providerAnswer = 'Odpověď B: pouze soukromý projekt B.';
    assert.equal((await send('Vysvětli stručně, co je Git commit.', reboundId)).response.content,
      providerAnswer);
    await expectJson(product, 'PUT', `/api/conversations/${encodeURIComponent(reboundId)}`,
      { project_id: project.id }, 200);
    providerAnswer = 'Novější odpověď A: pouze soukromý projekt A.';
    assert.equal((await send('Vysvětli stručně, co je Git commit.', reboundId)).response.content,
      providerAnswer);
    await expectJson(product, 'PUT', `/api/conversations/${encodeURIComponent(reboundId)}`,
      { project_id: projectB.id }, 200);
    const beforeCycle = privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    const stale = await send('Ulož ji do stale-project.md.', reboundId);
    assert.notEqual(stale.response.metadata?.approvalRequired, true,
      'the newest A answer is a barrier to an older B answer');
    assert.equal(privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n,
      beforeCycle);
    assert.equal(existsSync(path.join(projectB.path, 'stale-project.md')), false);

    const racingId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'in-flight-project-a', project_id: project.id, mode: 'chat',
    }, 201)).conversation.id;
    providerAnswer = 'INFLIGHT_A_PRIVATE_752';
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let release;
    const released = new Promise(resolve => { release = resolve; });
    delayedModel = { enter: entered, release: released };
    const inFlight = requestJson(product, 'POST', '/api/chat',
      command('Vysvětli stručně, co je Git commit.', racingId));
    let timer;
    try {
      await Promise.race([started, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Provider was not reached')), 15_000);
        timer.unref();
      })]);
    } finally { clearTimeout(timer); }
    await expectJson(product, 'PUT', `/api/conversations/${encodeURIComponent(racingId)}`,
      { project_id: projectB.id }, 200);
    release();
    const raced = await inFlight;
    assert(raced.status >= 400, 'an answer generated from A must not be persisted as a B answer');
    assert.doesNotMatch(JSON.stringify(raced.data), /INFLIGHT_A_PRIVATE_752/u);
    const racedRows = privateDb.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id',
    ).all(racingId);
    assert.equal(racedRows.filter(row => row.role === 'assistant').length, 0);

    const legacyId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'untagged-prior-turn', project_id: projectB.id,
      welcomeMessage: 'Nedůvěryhodný starší tah bez původu.',
    }, 201)).conversation.id;
    const beforeLegacy = privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n;
    const legacySave = await send('Ulož ji do legacy-source.md.', legacyId);
    assert.equal(legacySave.response.metadata?.error, 'file_write_source_unverified');
    assert.equal(privateDb.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n,
      beforeLegacy);
    assert.equal(existsSync(path.join(projectB.path, 'legacy-source.md')), false);

    // SQLite timestamps have second precision. Exercise the actual M1 save
    // after fourteen persisted HTTP turns share one timestamp, rather than
    // accepting a green ordering query without checking the emitted effect.
    const tiedId = (await expectJson(product, 'POST', '/api/conversations', {
      title: 'same-second-source', project_id: project.id, mode: 'chat',
    }, 201)).conversation.id;
    for (let index = 0; index < 7; index += 1) {
      providerAnswer = `Odpověď ${index}: zdroj snímku Git ${index}.`;
      assert.equal((await send('Vysvětli stručně, co je Git commit.', tiedId))
        .response.content, providerAnswer);
    }
    const newestAnswer = providerAnswer;
    await stopProduct(product);
    // Only this stopped, owned test database is modified to make the timing
    // collision deterministic. All content and provenance came through M1.
    assert(owned.database.includes('/.intentsmith-artifacts/'));
    const timestampFixture = new Database(owned.database, { fileMustExist: true });
    try {
      assert.equal(timestampFixture.prepare(
        'UPDATE messages SET created_at = ? WHERE conversation_id = ?',
      ).run(new Date(Date.now() - 1000).toISOString().replace('T', ' ').slice(0, 19),
        tiedId).changes, 14);
    } finally { timestampFixture.close(); }
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const tiedSave = await send('Ulož odpověď do timestamp-source.md.', tiedId);
    assert.equal(tiedSave.response.metadata?.approvalRequired, true);
    const tiedRequest = JSON.parse(privateDb.prepare(
      'SELECT request_json FROM tool_v1_requests WHERE request_id = ?',
    ).get(tiedSave.response.metadata.toolRequestId).request_json);
    assert.deepEqual(tiedRequest.input, { path: 'timestamp-source.md', content: newestAnswer },
      'same-second history must not select an older source answer');
    assert.equal((await send(`schválit efekt ${tiedSave.response.metadata.effectId}`, tiedId))
      .response.metadata?.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(project.path, 'timestamp-source.md'), 'utf8'), newestAnswer);
  } finally {
    privateDb?.close();
    if (product) await stopProduct(product);
    provider.closeAllConnections();
    await new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
}, 180_000);

summary();
