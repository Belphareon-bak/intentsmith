import './helpers/isolated-test-db.js';
import { suite, testAsync, assert, assertEqual, summary, waitForServer,
  api, createConv, cleanupConversation } from './e2e/_helpers.js';
import strictAssert from 'node:assert/strict';
import https from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createConversationWebTransport } from '../src/network/conversation-web-transport.js';

function createEphemeralTlsIdentity() {
  const directory = mkdtempSync(path.join(tmpdir(), 'is-web-tls-'));
  try {
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'ec',
      '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '2',
      '-subj', '/CN=web.fixture.test', '-addext', 'subjectAltName=DNS:web.fixture.test',
      '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem')],
    { stdio: 'pipe', timeout: 10_000, env: { PATH: '/usr/bin:/bin', OPENSSL_CONF: '/dev/null' } });
    return { certificate: readFileSync(path.join(directory, 'cert.pem')),
      key: readFileSync(path.join(directory, 'key.pem')) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// These are real Node TLS/HTTP sockets, with two deliberately controlled seams:
// the resolver supplies a public fixture answer and the request adapter maps
// that answer to this test's loopback port. No public DNS or Internet is used.
// Production address validation and rejectUnauthorized:true remain unchanged.
async function withLoopbackTlsFixture({ trusted = true, onRequest, onResponse = () => {},
  beforeDnsAnswer = () => {} } = {}, run) {
  const { certificate, key } = createEphemeralTlsIdentity();
  const publicFixtureAddress = '93.184.215.14';
  const sockets = new Set();
  const counts = { requests: 0, connections: 0, lookups: 0, transports: 0 };
  const server = https.createServer({ cert: certificate, key }, (req, res) => {
    counts.requests++;
    onRequest(req, res);
  });
  server.on('connection', socket => {
    counts.connections++;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  // Certificate-negative cases intentionally fail the real TLS handshake.
  server.on('tlsClientError', () => {});
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const transport = createConversationWebTransport({
      async resolve(host, options) {
        strictAssert.match(host, /^(?:web|wrong)\.fixture\.test$/u);
        strictAssert.deepEqual(options, { all: true, verbatim: true });
        counts.lookups++;
        await beforeDnsAnswer();
        return [{ address: publicFixtureAddress, family: 4 }];
      },
      request(url, options, callback) {
        counts.transports++;
        strictAssert.equal(url.protocol, 'https:');
        strictAssert.equal(url.port, '');
        strictAssert.match(url.hostname, /^(?:web|wrong)\.fixture\.test$/u);
        strictAssert.equal(options.rejectUnauthorized, true);
        strictAssert.equal(options.agent, false);
        strictAssert.equal(options.autoSelectFamily, false);
        return https.request(url, {
          ...options,
          // Only the fixture socket endpoint and explicit fixture CA are
          // substituted. Hostname verification and TLS rejection still run.
          port: server.address().port,
          ...(trusted ? { ca: certificate } : {}),
          lookup(host, lookupOptions, callbackLookup) {
            options.lookup(host, lookupOptions, (error, address, family) => {
              if (error) { callbackLookup(error); return; }
              strictAssert.equal(address, publicFixtureAddress);
              strictAssert.equal(family, 4);
              callbackLookup(null, '127.0.0.1', 4);
            });
          },
        }, response => { onResponse(response); callback(response); });
      },
    });
    await run({ transport, counts, publicFixtureAddress });
  } finally {
    // Includes sockets whose TLS handshake failed; no listener or connection
    // from this owned fixture may outlive its test.
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

suite('Conversation web real loopback TLS with controlled DNS/socket mapping');
await testAsync('trusted fixture TLS returns exact bytes through the production transport', async () => {
  const body = Buffer.from('Controlled TLS response: příliš žluťoučký.');
  let requestHeaders; let requestPath; let requestMethod;
  await withLoopbackTlsFixture({ onRequest(req, res) {
    requestHeaders = req.headers; requestPath = req.url; requestMethod = req.method;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length });
    res.end(body);
  } }, async ({ transport, counts, publicFixtureAddress }) => {
    let scopeChecks = 0;
    const response = await transport('https://web.fixture.test/document?q=exact', {
      beforeConnect() { scopeChecks++; },
    });
    strictAssert.deepEqual(response.bytes, body);
    strictAssert.equal(response.status, 200);
    strictAssert.equal(response.contentType, 'text/plain');
    strictAssert.equal(response.address, publicFixtureAddress, 'logical fixture DNS address, not a public socket observation');
    strictAssert.deepEqual(counts, { requests: 1, connections: 1, lookups: 1, transports: 1 });
    strictAssert.equal(scopeChecks, 2);
    strictAssert.equal(requestMethod, 'GET');
    strictAssert.equal(requestPath, '/document?q=exact');
    strictAssert.equal(requestHeaders['accept-encoding'], 'identity');
    strictAssert.equal(requestHeaders.cookie, undefined);
    strictAssert.equal(requestHeaders.authorization, undefined);
  });
});

await testAsync('an untrusted real TLS certificate is rejected before any HTTP request', async () => {
  await withLoopbackTlsFixture({ trusted: false, onRequest(_req, res) { res.end('must not be reached'); } },
    async ({ transport, counts }) => {
      await strictAssert.rejects(transport('https://web.fixture.test/document'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
      strictAssert.deepEqual(counts, { requests: 0, connections: 1, lookups: 1, transports: 1 });
    });
});

await testAsync('a trusted fixture certificate for another hostname is rejected before HTTP', async () => {
  await withLoopbackTlsFixture({ onRequest(_req, res) { res.end('must not be reached'); } },
    async ({ transport, counts }) => {
      await strictAssert.rejects(transport('https://wrong.fixture.test/document'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
      strictAssert.deepEqual(counts, { requests: 0, connections: 1, lookups: 1, transports: 1 });
    });
});

await testAsync('an interrupted real HTTPS body is rejected after partial bytes with no retry', async () => {
  let serverSocket; let receivedBytes = 0;
  await withLoopbackTlsFixture({
    onRequest(_req, res) {
      serverSocket = res.socket;
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 1000 });
      res.write('partial');
    },
    onResponse(response) {
      // Close the server socket only once the client actually receives body
      // bytes. This cannot accidentally test only a pre-response disconnect.
      response.once('data', chunk => { receivedBytes += chunk.length; serverSocket.destroy(); });
    },
  }, async ({ transport, counts }) => {
    await strictAssert.rejects(transport('https://web.fixture.test/document'), { code: 'ECONNRESET' });
    strictAssert.equal(receivedBytes, Buffer.byteLength('partial'));
    strictAssert.deepEqual(counts, { requests: 1, connections: 1, lookups: 1, transports: 1 });
  });
});

await testAsync('scope invalidation while resolving fixture DNS prevents the real socket connection', async () => {
  let current = true; let scopeChecks = 0;
  await withLoopbackTlsFixture({
    beforeDnsAnswer() { current = false; },
    onRequest(_req, res) { res.end('must not be reached'); },
  }, async ({ transport, counts }) => {
    await strictAssert.rejects(transport('https://web.fixture.test/document', {
      beforeConnect() {
        scopeChecks++;
        if (!current) throw Object.assign(new Error('WEB_REQUEST_REVOKED'), { code: 'WEB_REQUEST_REVOKED' });
      },
    }), { code: 'WEB_REQUEST_REVOKED' });
    strictAssert.equal(scopeChecks, 2);
    strictAssert.deepEqual(counts, { requests: 0, connections: 0, lookups: 1, transports: 1 });
  });
});

await waitForServer();
suite('Conversation web through the authenticated HTTP controller');
await testAsync('natural web search without a project proposes one visible request and accepts cancellation', async () => {
  const conversationId = await createConv('Natural web search approval');
  try {
    const chat = message => api('POST', '/api/chat', { message, conversation_id: conversationId });
    const proposal = await chat('Vyhledej na webu dokumentaci SQLite.');
    assertEqual(proposal.status, 200);
    assert(proposal.data.response.includes('https://www.bing.com/search?format=rss&q='), 'search names its exact provider target');
    const id = proposal.data.response.match(/web:[a-f0-9]{64}/)?.[0];
    assert(id, 'natural search requires an explicit per-request approval');
    const cancelled = await chat(`zrušit web ${id}`);
    assertEqual(cancelled.status, 200);
    assert(cancelled.data.response.includes('WEB_USER_REVOKED'), 'proposal can be cancelled without external I/O');
  } finally { await cleanupConversation(conversationId); }
});
await testAsync('a projectless request needs exact approval and a private IP is denied before network I/O', async () => {
  const conversationId = await createConv('Web approval without a project');
  try {
    const chat = message => api('POST', '/api/chat', { message, conversation_id: conversationId });
    const proposal = await chat('načti web https://127.0.0.1/');
    assertEqual(proposal.status, 200);
    const id = proposal.data.response.match(/web:[a-f0-9]{64}/)?.[0];
    assert(id, 'pending response must contain the full request ID');
    assert(proposal.data.response.includes('https://127.0.0.1/'), 'exact target is visible');
    const approval = await chat(`schválit web ${id}`);
    assertEqual(approval.status, 200);
    assert(approval.data.response.includes('WEB_ADDRESS_DENIED'), 'SSRF must fail in the actual consumer');
    const replay = await chat(`schválit web ${id}`);
    assertEqual(replay.status, 200);
    assert(replay.data.response.includes('WEB_ADDRESS_DENIED'), 'replay retains the failed result');
    const history = await api('GET', `/api/conversations/${conversationId}/messages`);
    assertEqual(history.status, 200);
    assert(JSON.stringify(history.data).includes('WEB_ADDRESS_DENIED'), 'failure is represented honestly in durable history');
  } finally { await cleanupConversation(conversationId); }
});
summary();
