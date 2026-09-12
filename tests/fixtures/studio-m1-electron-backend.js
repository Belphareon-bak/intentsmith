#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import process from 'node:process';

import db from '../../src/db/database.js';
import {
  TurnRole,
  getConversationStore,
} from '../../src/chat/conversation-store.js';
import { LLMProviderUnavailableError } from '../../src/core/chat-turn-error.js';
import {
  buildServerPortPayload,
  writePrivatePortFile,
} from '../../src/server-port-file.js';
import {
  LEGACY_LOCAL_CAPABILITY_HEADER,
  createLegacyLocalCapability,
  evaluateLegacyLocalAccess,
} from '../../src/security/legacy-local-access-policy.js';
import { attachWebSocketServer } from '../../src/ws-bridge/ws-server.js';

const portFile = process.env.C3_PORT_FILE;
if (typeof portFile !== 'string' || !portFile.startsWith('/')) {
  throw new Error('C3_PORT_FILE must be an absolute path');
}

const capability = createLegacyLocalCapability();
const store = getConversationStore(db);
const logger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});

let shuttingDown = false;
let restarting = false;
let listenPort = null;
let wss = null;

function corsHeaders(request) {
  const origin = request.headers.origin;
  return {
    'Access-Control-Allow-Headers': 'Content-Type, X-IntentSmith-Local-Capability',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': origin === 'null' || String(origin || '').startsWith('file:')
      ? 'null'
      : (origin || 'null'),
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin, Access-Control-Request-Headers, Sec-Fetch-Site',
  };
}

function sendJson(request, response, status, body) {
  response.writeHead(status, corsHeaders(request));
  response.end(JSON.stringify(body));
}

function authorize(request) {
  const address = server.address();
  return evaluateLegacyLocalAccess({
    host: request.headers.host,
    expectedPort: address && typeof address === 'object' ? address.port : listenPort,
    remoteAddress: request.socket.remoteAddress,
    origin: request.headers.origin,
    allowedOrigins: [],
    expectedCapability: capability,
    presentedCapability:
      request.headers[LEGACY_LOCAL_CAPABILITY_HEADER.toLowerCase()],
    fetchSite: request.headers['sec-fetch-site'],
    preflight: request.method === 'OPTIONS',
    requestedHeaders: request.headers['access-control-request-headers'],
  });
}

function messagesFor(conversationId) {
  return store.getRecentTurns(conversationId, 100).map(turn => ({
    id: turn.id,
    role: turn.role,
    content: turn.content,
    metadata: turn.metadata,
    created_at: turn.created_at,
  }));
}

function terminateClients() {
  for (const client of wss?.clients || []) {
    try { client.terminate(); } catch {}
  }
}

function restartListener() {
  if (restarting || shuttingDown || !Number.isInteger(listenPort)) return;
  restarting = true;
  terminateClients();
  server.close(error => {
    if (error || shuttingDown) {
      restarting = false;
      return;
    }
    setTimeout(() => {
      if (shuttingDown) return;
      server.listen(listenPort, '127.0.0.1', () => {
        restarting = false;
      });
    }, 250);
  });
}

let scoringReads = 0;
const server = http.createServer((request, response) => {
  const access = authorize(request);
  if (!access.allowed) {
    request.resume();
    sendJson(request, response, 403, { error: 'local-access-rejected' });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  const target = new URL(request.url || '/', 'http://127.0.0.1');
  const historyMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(
    target.pathname,
  );
  if (request.method === 'GET' && historyMatch) {
    const conversationId = decodeURIComponent(historyMatch[1]);
    if (!store.exists(conversationId)) {
      sendJson(request, response, 404, { error: 'conversation-not-found' });
      return;
    }
    sendJson(request, response, 200, {
      messages: messagesFor(conversationId),
    });
    return;
  }
  if (request.method === 'POST' && target.pathname === '/api/test/m1/restart') {
    sendJson(request, response, 202, { accepted: true });
    setTimeout(restartListener, 25);
    return;
  }
  if (request.method === 'GET' && ['/health', '/api/health'].includes(target.pathname)) {
    sendJson(request, response, 200, {
      status: 'ok',
      version: 'm1-electron-fixture',
      limits: {
        maxTextAttachment: 1024 * 1024,
        maxImageAttachment: 5 * 1024 * 1024,
      },
    });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/projects') {
    sendJson(request, response, 200, { projects: [] });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/conversations') {
    sendJson(request, response, 200, { conversations: [] });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/expertises') {
    sendJson(request, response, 200, { expertises: [] });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/agents') {
    sendJson(request, response, 200, { agents: [] });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/media/history') {
    sendJson(request, response, 200, { generations: [] });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/system/models/evaluations') {
    scoringReads++;
    sendJson(request, response, 200, {
      schemaVersion: 2, generatedAt: new Date(1700000000000 + scoringReads * 1000).toISOString(),
      providerVersion: 'fixture-ollama-1', bindingAuthority: { status: 'UNVERIFIED_RUNTIME' },
      coverage: { applicableTotal: 2, applicableStatusCounts: { COMPLETE: 1, BLOCKED: 1, MISSING: 0 }, notApplicable: 0 },
      roles: { R2: {
        role: 'R2', suiteName: 'review_fixture', suiteVersion: '1', suiteContractSha256: 'c'.repeat(64),
        binding: null, decisions: [], artifacts: [
          { model: 'scoring-fixture-' + scoringReads, digestSha256: 'a'.repeat(64), status: 'COMPLETE', score: 0.875,
            providerVersion: 'fixture-ollama-1', testedAt: '2026-09-12T10:00:00Z', intervalIntegrity: 'VERIFIED' },
          { model: 'unmeasured-fixture', digestSha256: 'b'.repeat(64), status: 'BLOCKED', score: null, providerVersion: null },
        ],
      } },
    });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/system/models') {
    sendJson(request, response, 200, { models: [] });
    return;
  }
  if (request.method === 'GET' && target.pathname === '/api/system/info') {
    sendJson(request, response, 200, { platform: process.platform });
    return;
  }
  if (target.pathname === '/api/settings') {
    request.resume();
    sendJson(request, response, 200, {});
    return;
  }

  request.resume();
  sendJson(request, response, 404, { error: 'fixture-route-not-found' });
});

server.keepAliveTimeout = 1_000;
server.headersTimeout = 3_000;
server.requestTimeout = 5_000;
server.on('clientError', (_error, socket) => socket.destroy());

wss = attachWebSocketServer(
  server,
  {
    async handle(request) {
      store.ensureConversation(request.conversationId);
      if (request.message === 'M1_CANCEL_PENDING') {
        store.appendTurn(request.conversationId, TurnRole.USER, request.message);
        request.context.onSystemStep('pending', 'cancel target entered', 1);
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(request.signal.reason),
            { once: true },
          );
        });
      }
      if (request.message === 'M1_PROVIDER_ERROR') {
        store.appendTurn(request.conversationId, TurnRole.USER, request.message);
        throw new LLMProviderUnavailableError('LLM_CALL_FAILED');
      }
      if (request.message === 'M1_SUCCESS') {
        const response = 'Built Electron M1 response';
        store.appendTurn(request.conversationId, TurnRole.USER, request.message);
        store.appendTurn(request.conversationId, TurnRole.ASSISTANT, response, {
          mode: 'conversation',
        });
        request.context.onSystemStep('success', 'built renderer received progress', 1);
        return {
          response,
          mode: 'conversation',
          confidence: 1,
          state: { source: 'studio-m1-electron-fixture' },
        };
      }
      throw new Error('Unexpected M1 fixture message');
    },
  },
  logger,
  {
    allowedOrigins: [],
    localCapability: capability,
    m1WireSupported: true,
  },
);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateClients();
  await new Promise(resolve => {
    try {
      wss.close(() => resolve());
    } catch {
      resolve();
    }
  });
  await new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  try { db.close(); } catch {}
  try { fs.unlinkSync(portFile); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown()
      .then(() => { process.exitCode = 0; })
      .catch(() => { process.exitCode = 1; });
  });
}

server.listen(0, '127.0.0.1', () => {
  listenPort = server.address().port;
  writePrivatePortFile(
    portFile,
    buildServerPortPayload({
      port: listenPort,
      host: '127.0.0.1',
      pid: process.pid,
      started: new Date().toISOString(),
    }, undefined, capability),
  );
  process.stdout.write(`C3_READY:${listenPort}\n`);
});
