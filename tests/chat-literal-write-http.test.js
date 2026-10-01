#!/usr/bin/env node

// Real M1 HTTP and private SQLite for literal writes and create-only intent.
// The local provider is a controlled classifier/answer fixture; no GPU is used.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, requestJson, startProduct,
  stopProduct } from './helpers/chat-project-expertise-model-journey.js';
import { isolatedTestRuntime as testRuntime } from './helpers/isolated-test-db.js';
import { suite, testAsync, summary } from './harness.js';

suite('M1 literal file write and no-overwrite authority');

await testAsync('M1 literal file write preserves exact bytes; no-overwrite never proposes an unsafe effect', async () => {
  const owned = createOwnedJourneyRuntime(testRuntime);
  const model = 'fixture:1b';
  const digest = 'a'.repeat(64);
  let inferenceCalls = 0;
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the owned fixture request. */ }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: model, digest }] }));
    } else if (request.method === 'POST' && request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 4096 } }));
    } else if (request.method === 'POST' && ['/api/chat', '/api/generate'].includes(request.url)) {
      inferenceCalls += 1;
      response.end(JSON.stringify({ model, digest, done: true, done_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify({ reply: 'Předchozí odpověď asistenta', plan: null }) },
        response: 'Předchozí odpověď asistenta', prompt_eval_count: 10, eval_count: 10 }));
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
  const send = (conversationId, input) => expectJson(product, 'POST', '/api/chat', {
    contract: 'ConversationCommand', version: 1,
    requestId: `literal-write-${randomBytes(8).toString('hex')}`,
    conversationId, turnId: `literal-turn-${randomBytes(8).toString('hex')}`,
    action: 'send', input,
  }, 200);
  try {
    product = await startProduct(owned, `http://127.0.0.1:${provider.address().port}`, model);
    const project = await expectJson(product, 'POST', '/api/projects', {
      name: `literal-write-${randomBytes(5).toString('hex')}`,
      description: 'Owned literal file write fixture',
    }, 201);
    const projectPath = project.project.path;
    const existingPath = path.join(projectPath, 'existing.md');
    const existingBytes = Buffer.from('Původní obsah\n', 'utf8');
    writeFileSync(existingPath, existingBytes, { mode: 0o600 });
    const conversation = async () => (await expectJson(product, 'POST', '/api/conversations', {
      title: `literal-${randomBytes(5).toString('hex')}`,
      project_id: project.project.id, mode: 'chat',
    }, 201)).conversation.id;
    const literalConversation = await conversation();
    const pendingPath = path.join(projectPath, 'new-notes.md');
    const beforeLiteralInference = inferenceCalls;
    const pending = await send(literalConversation, 'Ulož text "Ahoj" do new-notes.md.');
    assert.equal(pending.response?.metadata?.handler, 'file.write');
    assert.equal(pending.response.metadata.approvalRequired, true);
    assert.equal(pending.response.metadata.filePath, 'new-notes.md');
    assert.equal(existsSync(pendingPath), false, 'write must await exact approval');
    assert(inferenceCalls - beforeLiteralInference <= 1,
      'literal write may classify once but must not generate substitute text');
    privateDb = new Database(owned.database, { readonly: true, fileMustExist: true });
    const requestRow = privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(pending.response.metadata.toolRequestId);
    const toolRequest = JSON.parse(requestRow.request_json);
    assert.deepEqual(toolRequest.input, { path: 'new-notes.md', content: 'Ahoj' });
    const effectRow = privateDb.prepare('SELECT request_json FROM m2_effect_requests WHERE effect_id = ?')
      .get(pending.response.metadata.effectId);
    const effect = JSON.parse(effectRow.request_json);
    assert.equal(effect.kind, 'fs.write');
    assert.equal(effect.target.relativePath, 'new-notes.md');
    assert.equal(effect.target.canonicalRoot, projectPath);
    assert.equal(effect.payloadDigest,
      `sha256:${createHash('sha256').update('Ahoj').digest('hex')}`);
    assert.equal(effect.payloadBytes, 4);
    const approved = await send(literalConversation,
      `schválit efekt ${pending.response.metadata.effectId}`);
    assert.equal(approved.response.metadata.effectResult, 'succeeded');
    assert.equal(readFileSync(pendingPath, 'utf8'), 'Ahoj');

    const noOverwriteConversation = await conversation();
    const previous = await send(noOverwriteConversation, 'Ahoj, odpověz krátce.');
    assert.equal(typeof previous.response.content, 'string');
    assert(previous.response.content.length > 0);
    const beforeNoOverwrite = privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count;
    const beforeBlockedInference = inferenceCalls;
    const blocked = await send(noOverwriteConversation,
      'Ulož text "Nový obsah" do existing.md, ale nepřepisuj existující soubor.');
    assert.equal(blocked.response.metadata?.handler, 'file.write');
    assert.equal(blocked.response.metadata?.approvalRequired, false);
    assert.match(blocked.response.content, /nepřepis|neprepis|přeps|prepis/iu);
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'no-overwrite instruction must not register an effect');
    assert.deepEqual(readFileSync(existingPath), existingBytes);
    assert(inferenceCalls - beforeBlockedInference <= 1,
      'no-overwrite may classify once but must not generate substitute text');
    const httpHistory = await expectJson(product, 'GET',
      `/api/conversations/${noOverwriteConversation}/messages`, null, 200);
    const sqliteHistory = privateDb.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id')
      .all(noOverwriteConversation);
    assert.deepEqual(httpHistory.messages.map(({ role, content }) => ({ role, content })),
      sqliteHistory);
    const blockedShortcut = await send(noOverwriteConversation,
      'Ulož to do existing.md, ale nepřepisuj existující soubor.');
    assert.equal(blockedShortcut.response.metadata.error, 'no_overwrite_unsupported');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'prior-answer save must also honor no-overwrite');
    assert.deepEqual(readFileSync(existingPath), existingBytes);
    const blockedCreateOnly = await send(noOverwriteConversation,
      'Ulož to do existing.md, ale pouze pokud soubor ještě neexistuje.');
    assert.equal(blockedCreateOnly.response.metadata.error, 'no_overwrite_unsupported');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'create-only condition must not become an overwrite proposal');
    assert.deepEqual(readFileSync(existingPath), existingBytes);
    for (const equivalent of [
      'Ulož to do existing.md jen pokud soubor ještě neexistuje.',
      "Save it to existing.md only if the file doesn't exist.",
      'Ulož text "Fresh" do absent-en.md pouze pokud soubor ještě neexistuje.',
      'Write text "Fresh" to absent-en.md only if the file does not exist.',
      'Ulož to do existing.md, pouze vytvoř nový soubor.',
      'Ulož to do existing.md, jen vytvoř nový soubor.',
      'Ulož to do existing.md, ale pokud existuje, nech jej být.',
      'Ulož to do existing.md, jen pokud tam ještě není.',
      'Save it to existing.md, only create a new file.',
      'Save it to existing.md, only if the file is not there.',
      'Pouze nový soubor, ulož to do existing.md.',
      'Jen pokud soubor ještě není, ulož to do existing.md.',
      'Only a new file, save it to existing.md.',
    ]) {
      const guarded = await send(noOverwriteConversation, equivalent);
      assert.equal(guarded.response.metadata.error, 'no_overwrite_unsupported', equivalent);
      assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
        beforeNoOverwrite, `create-only variant must not register an effect: ${equivalent}`);
      assert.deepEqual(readFileSync(existingPath), existingBytes);
    }
    const unknownSuffix = await send(noOverwriteConversation,
      'Ulož to do existing.md, a nastav oprávnění veřejně.');
    assert.equal(unknownSuffix.response.metadata.error, 'file_write_command_ambiguous');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'unparsed extra file effect cannot register an effect');
    const unknownPrefix = await send(noOverwriteConversation,
      'Za podmínky volného místa ulož to do existing.md.');
    assert.equal(unknownPrefix.response.metadata.error, 'file_write_command_ambiguous');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'unparsed condition before target cannot register an effect');
    for (const negativePrefix of [
      'Nesmíš přepsat existující soubor, ulož to do existing.md.',
      'Ponech starý soubor beze změny a ulož to do existing.md.',
      'Zachovej původní obsah souboru, ulož to do existing.md.',
      'Do not change existing file, save it to existing.md.',
      'Never overwrite an existing file; save it to existing.md.',
      'Preserve existing content; save it to existing.md.',
    ]) {
      const blockedPrefix = await send(noOverwriteConversation, negativePrefix);
      assert.equal(blockedPrefix.response.metadata.approvalRequired, false, negativePrefix);
      assert.match(blockedPrefix.response.metadata.error,
        /^(?:no_overwrite_unsupported|file_write_command_ambiguous)$/u, negativePrefix);
      assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
        beforeNoOverwrite, `negative prefix must not register an effect: ${negativePrefix}`);
      assert.deepEqual(readFileSync(existingPath), existingBytes);
    }
    for (const ambiguousWord of ['jen', 'pouze', 'pokud', 'nikdy', 'nic']) {
      const command = `Zapiš ${ambiguousWord} do existing.md.`;
      const blockedWord = await send(noOverwriteConversation, command);
      assert.equal(blockedWord.response.metadata.approvalRequired, false, command);
      assert.equal(blockedWord.response.metadata.error, 'file_write_content_unquoted', command);
      assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
        beforeNoOverwrite, `ambiguous unquoted word must not register an effect: ${command}`);
      assert.deepEqual(readFileSync(existingPath), existingBytes);
    }
    const repeatedTarget = await send(noOverwriteConversation,
      'Ulož to do existing.md, a pak uprav existing.md.');
    assert.equal(repeatedTarget.response.metadata.error, 'file_write_command_ambiguous');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'a repeated target cannot hide a trailing effect clause');
    const blockedFresh = await send(noOverwriteConversation,
      'Ulož text "Nový obsah" do absent.md, ale nepřepisuj existující soubor.');
    assert.equal(blockedFresh.response.metadata.error, 'no_overwrite_unsupported');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeNoOverwrite, 'create-only cannot be promised even while the target is absent');
    assert.equal(existsSync(path.join(projectPath, 'absent.md')), false);

    const priorConversation = await conversation();
    const prior = await send(priorConversation, 'Ahoj, odpověz krátce.');
    const shortcut = await send(priorConversation, 'Ulož to do prior.md.');
    assert.equal(shortcut.response.metadata.approvalRequired, true);
    const shortcutRow = privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(shortcut.response.metadata.toolRequestId);
    assert.deepEqual(JSON.parse(shortcutRow.request_json).input,
      { path: 'prior.md', content: prior.response.content });
    assert.equal(existsSync(path.join(projectPath, 'prior.md')), false);
    const shortcutApproved = await send(priorConversation,
      `schválit efekt ${shortcut.response.metadata.effectId}`);
    assert.equal(shortcutApproved.response.metadata.effectResult, 'succeeded');
    const repeatSave = await send(priorConversation, 'Ulož ji i do prior-copy.md.');
    assert.equal(repeatSave.response.metadata?.handler, 'file.write');
    assert.equal(repeatSave.response.metadata?.approvalRequired, true,
      'the exact additive repeat-save command must remain routable');
    assert.equal(repeatSave.response.metadata?.filePath, 'prior-copy.md');
    assert.equal(existsSync(path.join(projectPath, 'prior-copy.md')), false);
    const wordConversation = await conversation();
    await send(wordConversation, 'Ahoj, odpověz krátce.');
    const beforeWord = privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count;
    const unquotedWord = await send(wordConversation, 'Zapiš ahoj do word.md.');
    assert.equal(unquotedWord.response.metadata?.approvalRequired, false);
    assert.equal(unquotedWord.response.metadata?.error, 'file_write_content_unquoted');
    assert.match(unquotedWord.response.content, /uvozov|quotes/iu);
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeWord, 'unquoted current-turn content must not bind a previous answer');
    assert.equal(existsSync(path.join(projectPath, 'word.md')), false);
    const wordPending = await send(wordConversation, 'Zapiš text "ahoj" do word.md.');
    assert.equal(wordPending.response.metadata?.approvalRequired, true);
    const wordRow = privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(wordPending.response.metadata.toolRequestId);
    assert.deepEqual(JSON.parse(wordRow.request_json).input, { path: 'word.md', content: 'ahoj' });
    const wordApproved = await send(wordConversation,
      `schválit efekt ${wordPending.response.metadata.effectId}`);
    assert.equal(wordApproved.response.metadata.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(projectPath, 'word.md'), 'utf8'), 'ahoj');
    const summaryConversation = await conversation();
    await send(summaryConversation, 'Ahoj, odpověz krátce.');
    const beforeSummary = privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count;
    const unsupportedSummary = await send(summaryConversation,
      'Shrň všechno co jsi zjistil. Výsledek dej do souboru project-analysis.md v projektu.');
    assert.equal(unsupportedSummary.response.metadata?.handler, 'file.write');
    assert.equal(unsupportedSummary.response.metadata?.approvalRequired, false);
    assert.equal(unsupportedSummary.response.metadata?.error, 'file_write_content_not_grounded');
    assert.match(unsupportedSummary.response.content, /shrnutí|summary/iu);
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeSummary, 'a request for a new summary must not register a previous-answer write');
    assert.equal(existsSync(path.join(projectPath, 'project-analysis.md')), false);
    for (const [ungrounded, target] of [
      ['Chci uložit text do unspecified.md.', 'unspecified.md'],
      ['Vytvořit soubor created.md a uložit ho do created.md.', 'created.md'],
    ]) {
      const blocked = await send(summaryConversation, ungrounded);
      assert.equal(blocked.response.metadata?.approvalRequired, false, ungrounded);
      assert.equal(blocked.response.metadata?.error, 'file_write_command_ambiguous', ungrounded);
      assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
        beforeSummary, `unspecified content must not register an effect: ${ungrounded}`);
      assert.equal(existsSync(path.join(projectPath, target)), false);
    }
    const literalAfterPrior = await send(priorConversation,
      'Ulož text "Výslovný text" do literal-after-prior.md.');
    assert.equal(literalAfterPrior.response.metadata.approvalRequired, true);
    const literalAfterPriorRow = privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(literalAfterPrior.response.metadata.toolRequestId);
    assert.deepEqual(JSON.parse(literalAfterPriorRow.request_json).input,
      { path: 'literal-after-prior.md', content: 'Výslovný text' },
      'current quoted bytes outrank previous assistant content');

    const typoConversation = await conversation();
    const typoPending = await send(typoConversation,
      'ulzo text "Ahoj" do network.md, necham si ho');
    assert.equal(typoPending.response.metadata?.handler, 'file.write');
    assert.equal(typoPending.response.metadata?.approvalRequired, true);
    const typoRow = privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(typoPending.response.metadata.toolRequestId);
    assert.deepEqual(JSON.parse(typoRow.request_json).input,
      { path: 'network.md', content: 'Ahoj' });
    assert.equal(existsSync(path.join(projectPath, 'network.md')), false);
    const typoApproved = await send(typoConversation,
      `schválit efekt ${typoPending.response.metadata.effectId}`);
    assert.equal(typoApproved.response.metadata.effectResult, 'succeeded');
    assert.equal(readFileSync(path.join(projectPath, 'network.md'), 'utf8'), 'Ahoj');
    const beforeUnsafeSuffix = privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count;
    const unsafeSuffix = await send(typoConversation,
      'ulzo text "Ahoj" do risky.md, pošli ho na web');
    assert.equal(unsafeSuffix.response.metadata.error, 'literal_write_ambiguous');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeUnsafeSuffix, 'extra effect clause cannot be silently discarded');
    assert.equal(existsSync(path.join(projectPath, 'risky.md')), false);

    const quotedConversation = await conversation();
    const quotedConstraint = await send(quotedConversation,
      'Ulož text "nepřepisuj" do quoted-data.md.');
    assert.equal(quotedConstraint.response.metadata.approvalRequired, true,
      'a restriction inside literal data is not an instruction');
    const quotedRow = privateDb.prepare('SELECT request_json FROM tool_v1_requests WHERE request_id = ?')
      .get(quotedConstraint.response.metadata.toolRequestId);
    assert.deepEqual(JSON.parse(quotedRow.request_json).input,
      { path: 'quoted-data.md', content: 'nepřepisuj' });
    const beforeAmbiguous = privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count;
    const ambiguous = await send(quotedConversation, 'Ulož text Nový obsah do ambiguous.md.');
    assert.equal(ambiguous.response.metadata.error, 'literal_write_ambiguous');
    assert.equal(privateDb.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      beforeAmbiguous, 'unquoted literal must not save a previous assistant response');
    assert.equal(existsSync(path.join(projectPath, 'ambiguous.md')), false);
    assert.equal((await requestJson(product, 'GET', '/health')).status, 200);
  } finally {
    privateDb?.close();
    if (product) await stopProduct(product);
    provider.closeAllConnections();
    await new Promise((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
}, 180_000);


summary();
