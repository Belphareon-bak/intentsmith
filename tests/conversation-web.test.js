import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { db, conversations, messages } from '../src/db/database.js';
import { createConversationWebHandler } from '../src/chat/handlers/conversation-web.js';
import { ConversationWebRepository } from '../src/network/conversation-web-repository.js';
import { createConversationWebTransport, isPublicWebAddress } from '../src/network/conversation-web-transport.js';
import { canonicalWebUrl, parseWebApproval, CONVERSATION_WEB } from '../contracts/m2/conversation-web-v1.js';
import { suite, test, testAsync, summary } from './harness.js';

let sequence = 0;
function fixture(options = {}) {
  const conversationId = `web-test-${++sequence}`;
  conversations.create.run(conversationId, null, 'Web test', null);
  const context = input => ({ conversationId, sessionId: conversationId, turnId: `turn-${sequence}`,
    userMessageId: Number(messages.add.run(conversationId, 'user', input, null, '{}').lastInsertRowid),
    authenticatedSubject: { actorType: 'user', actorId: 'local-operator' } });
  let calls = 0;
  const body = Buffer.from('Example content ``` </script><img src=x onerror=alert(1)>');
  const transport = options.transport || (async () => { calls++; return { bytes: body, status: 200, contentType: 'text/plain', address: '93.184.215.14' }; });
  const handler = createConversationWebHandler({ database: db, transport, ...options });
  const initial = context('načti web https://example.com/');
  const proposed = handler.propose('https://example.com/', initial);
  const id = proposed.metadata.webRequestId;
  return { handler, context, initial, proposed, id, body, conversationId, calls: () => calls,
    approve: () => context(`schválit web ${id}`), repo: new ConversationWebRepository(db, options) };
}

suite('Conversation web exact approval and durable output');
await testAsync('proposal sends nothing; exact persisted approval executes once and replay survives a new runtime', async () => {
  const f = fixture();
  assert.equal(f.calls(), 0); assert.match(f.proposed.content, /https:\/\/example.com\//);
  assert.equal(f.proposed.metadata.approvalRequired, true);
  const approval = f.approve();
  const first = await f.handler.intercept(`schválit web ${f.id}`, approval);
  assert.equal(first.response.metadata.webStatus, 'succeeded'); assert.equal(f.calls(), 1);
  assert.deepEqual(f.repo.read(f.id, approval).output, f.body);
  assert.match(first.response.content, /````text/);
  const reopened = createConversationWebHandler({ database: db, transport: async () => { throw new Error('replay contacted network'); } });
  const replay = await reopened.intercept(`schválit web ${f.id}`, f.approve());
  assert.equal(replay.response.content, first.response.content);
  const audits = db.prepare("SELECT phase FROM m5_outbound_audit_events WHERE surface = 'conversation-web' AND request_id = ? ORDER BY occurred_at_ms").all(f.repo.audit.createRequestId(f.id));
  assert.deepEqual(audits.map(row => row.phase).sort(), ['decision', 'terminal']);
  // Read and claim through an independently opened connection in a fresh
  // process: consumption and exact output must outlive the in-memory runtime.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import Database from 'better-sqlite3';
    import { ConversationWebRepository } from './src/network/conversation-web-repository.js';
    const input = JSON.parse(process.argv[1]);
    const database = new Database(input.filename);
    const repository = new ConversationWebRepository(database);
    const replay = repository.claim(input.id, input.approval);
    assert.equal(replay.claimed, false);
    assert.equal(replay.row.status, 'succeeded');
    assert.equal(replay.row.output.toString('base64'), input.output);
    database.close();
  `, JSON.stringify({ filename: db.name, id: f.id, approval, output: f.body.toString('base64') })],
  { encoding: 'utf8', timeout: 10000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

await testAsync('completed web bytes are removed when their conversation or approval loses scope', async () => {
  for (const mutate of [
    item => conversations.softDelete.run(item.conversationId),
    item => conversations.archive.run(item.conversationId),
    (item, approval) => db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('changed', approval.userMessageId),
  ]) {
    const f = fixture(); const approval = f.approve();
    await f.handler.intercept(`schválit web ${f.id}`, approval);
    assert.equal(f.repo.read(f.id, approval).status, 'succeeded');
    mutate(f, approval);
    const row = db.prepare('SELECT status, output, output_digest FROM conversation_web_requests WHERE request_id = ?').get(f.id);
    assert.equal(row.status, 'revoked'); assert.equal(row.output, null); assert.equal(row.output_digest, null);
    const replay = await f.handler.intercept(`schválit web ${f.id}`, approval);
    assert.notEqual(replay.response.metadata.webStatus, 'succeeded'); assert.equal(f.calls(), 1);
  }
});

await testAsync('generic assent, model text and forged or foreign identity never approve', async () => {
  const f = fixture();
  assert.equal((await f.handler.intercept('ano', f.context('ano'))).handled, false);
  const fake = await f.handler.intercept(`schválit web ${f.id}`, f.context('ano'));
  assert.equal(fake.response.metadata.errorCode, 'WEB_EXACT_APPROVAL_REQUIRED');
  const foreign = fixture();
  assert.throws(() => f.repo.claim(f.id, foreign.context(`schválit web ${f.id}`)), /WEB_REQUEST_NOT_FOUND/);
  assert.throws(() => f.repo.claim(f.id, { ...f.approve(), authenticatedSubject: { actorType: 'user', actorId: 'someone' } }), /WEB_IDENTITY_REQUIRED/);
  assert.throws(() => f.repo.claim(f.id, { ...f.approve(), userMessageId: 999999 }), /WEB_CONVERSATION_UNAVAILABLE/);
  assert.equal(f.calls(), 0);
});

await testAsync('expiry, revoke, original-message edits, deletion and archival invalidate pending requests', async () => {
  let now = Date.now(); const f = fixture({ clock: () => now }); now += CONVERSATION_WEB.approvalTtlMs;
  assert.throws(() => f.repo.claim(f.id, f.approve()), /WEB_APPROVAL_EXPIRED/);
  for (const mutate of [
    item => item.repo.revoke(item.id, item.initial),
    item => db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('changed', item.initial.userMessageId),
    item => conversations.softDelete.run(item.conversationId),
    item => conversations.archive.run(item.conversationId),
  ]) {
    const item = fixture(); const approval = item.approve(); mutate(item);
    const response = await item.handler.intercept(`schválit web ${item.id}`, approval);
    assert.notEqual(response.response.metadata.webStatus, 'succeeded'); assert.equal(item.calls(), 0);
  }
});

await testAsync('concurrent approval cannot repeat an in-flight request; late cancellation does not commit success', async () => {
  let finish; let calls = 0;
  const f = fixture({ transport: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const controller = new AbortController();
  const pending = f.handler.intercept(`schválit web ${f.id}`, { ...f.approve(), signal: controller.signal });
  const parallel = await f.handler.intercept(`schválit web ${f.id}`, f.approve());
  assert.equal(parallel.response.metadata.webStatus, 'executing'); assert.equal(calls, 1);
  controller.abort(); finish({ bytes: Buffer.from('late'), status: 200, contentType: 'text/plain', address: '93.184.215.14' });
  await assert.rejects(pending);
  assert.equal(f.repo.read(f.id, f.initial).status, 'failed');
  assert.equal(f.repo.read(f.id, f.initial).output, null);
});

await testAsync('provider failure has no fallback and failed output commits cannot be replayed as new I/O', async () => {
  let calls = 0;
  const f = fixture({ transport: async () => { calls++; throw new Error('offline'); } });
  const first = await f.handler.intercept(`schválit web ${f.id}`, f.approve());
  assert.equal(first.response.metadata.webStatus, 'failed');
  await f.handler.intercept(`schválit web ${f.id}`, f.approve()); assert.equal(calls, 1);
  const g = fixture();
  db.exec("CREATE TRIGGER web_test_reject_output BEFORE UPDATE ON conversation_web_requests WHEN NEW.status = 'succeeded' BEGIN SELECT RAISE(ABORT,'fixture storage outage'); END");
  try {
    const failed = await g.handler.intercept(`schválit web ${g.id}`, g.approve());
    assert.equal(failed.response.metadata.webStatus, 'unavailable');
    assert.equal(g.repo.read(g.id, g.initial).status, 'executing');
    await g.handler.intercept(`schválit web ${g.id}`, g.approve()); assert.equal(g.calls(), 1);
  } finally { db.exec('DROP TRIGGER web_test_reject_output'); }
});

test('direct SQL cannot grant, mutate the exact URL or invent successful output', () => {
  const f = fixture();
  assert.throws(() => db.prepare("UPDATE conversation_web_requests SET status = 'executing', approval_message_id = ?, consumed_at_ms = ? WHERE request_id = ?").run(f.approve().userMessageId, Date.now(), f.id), /WEB_TYPED_WRITER_REQUIRED/);
  assert.throws(() => db.prepare('UPDATE conversation_web_requests SET url = ? WHERE request_id = ?').run('https://attacker.example/', f.id));
  assert.equal(f.repo.read(f.id, f.initial).status, 'pending');
});

test('canonical URL and public-address policy deny private, mapped, reserved, credential and non-HTTPS targets', () => {
  for (const value of ['http://example.com/','https://user:pass@example.com/','https://example.com:444/','https://example.com/#hidden','https://example.com/\n']) assert.throws(() => canonicalWebUrl(value));
  for (const value of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','192.0.2.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::','64:ff9b::7f00:1']) assert.equal(isPublicWebAddress(value), false, value);
  assert.equal(isPublicWebAddress('1.1.1.1'), true); assert.equal(isPublicWebAddress('2606:4700:4700::1111'), true);
  assert.equal(parseWebApproval('ano'), null);
});

function fakeTransport({ answers = [{ address: '93.184.215.14', family: 4 }], status = 200,
  type = 'text/plain', body = Buffer.from('hello'), encoding } = {}) {
  let created = 0; let ended = 0; let observed;
  const transport = createConversationWebTransport({ resolve: async () => answers,
    request(url, options, callback) {
      created++; observed = { url, options }; const req = new EventEmitter();
      req.destroy = error => queueMicrotask(() => req.emit('error', error));
      req.end = () => {
        ended++;
        options.lookup(url.hostname, {}, (error, address, family) => {
          if (error) { req.emit('error', error); return; }
          assert.equal(address, answers[0].address); assert.equal(family, 4);
          const response = Readable.from([body]); response.statusCode = status;
          response.headers = { 'content-type': type, ...(encoding ? { 'content-encoding': encoding } : {}) }; callback(response);
        });
      };
      return req;
    } });
  return { transport, counts: () => ({ created, ended }), observed: () => observed };
}

await testAsync('transport pins public DNS and enforces TLS/no credential/body/proxy inheritance', async () => {
  const f = fakeTransport(); const result = await f.transport('https://example.com/');
  assert.equal(result.bytes.toString(), 'hello');
  const { options } = f.observed(); assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
  assert.equal(options.method, 'GET'); assert.equal(options.autoSelectFamily, false);
  assert.deepEqual(Object.keys(options.headers).sort(), ['Accept','Accept-Encoding']);
  assert.equal(options.body, undefined); assert.deepEqual(f.counts(), { created: 1, ended: 1 });
});

await testAsync('transport rejects private literals before socket creation and mixed DNS before connection', async () => {
  const literal = fakeTransport(); await assert.rejects(literal.transport('https://127.0.0.1/'), /WEB_ADDRESS_DENIED/);
  assert.equal(literal.counts().created, 0);
  const mixed = fakeTransport({ answers: [{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }] });
  await assert.rejects(mixed.transport('https://example.com/'), /WEB_ADDRESS_DENIED/);
});

await testAsync('redirects, compressed/binary responses and oversized bodies never trigger another request', async () => {
  for (const options of [{ status: 302 }, { encoding: 'gzip' }, { type: 'application/octet-stream' }, { body: Buffer.alloc(CONVERSATION_WEB.maxResponseBytes + 1) }]) {
    const f = fakeTransport(options); await assert.rejects(f.transport('https://example.com/'));
    assert.deepEqual(f.counts(), { created: 1, ended: 1 });
  }
});

summary();
