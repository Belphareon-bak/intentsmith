#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installInformation } from '../src/db/migrations/2026_08_29_102_m7_manual_information.js';
import { up as installAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import { up as installSessions } from '../src/db/migrations/2026_08_29_105_m7_remote_session_authority.js';
import { up as installRateLimits } from '../src/db/migrations/2026_08_30_108_m7_durable_rate_limits.js';
import { createM7DisconnectedRequestPipeline } from '../src/remote/m7-disconnected-request-pipeline.js';
import { createM7DurableRateLimiter } from '../src/remote/m7-durable-rate-limiter.js';
import { createM7SessionAuthority } from '../src/remote/m7-session-authority.js';
import { createM7TransportAdmissionPolicy } from '../src/remote/m7-transport-admission-policy.js';
import {
  M7_VPN_TLS_LISTENER_ERROR,
  _testInternals,
  createM7VpnRequestHandler,
} from '../src/remote/m7-vpn-tls-listener.js';
import { suite, summary, test, testAsync } from './harness.js';

const ORIGIN = 'https://intentsmith.tailnet.example:7443';
const PIN = `sha256:${'a'.repeat(64)}`;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function setup() {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL,
      status TEXT NOT NULL, last_active TEXT NOT NULL
    );
    CREATE TABLE project_lifecycles (
      id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, phase TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY, project_id INTEGER, title TEXT,
      message_count INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      archived_at TEXT, deleted_at TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY, data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  installJournal(database);
  installInformation(database);
  installAbandonments(database);
  installSessions(database);
  installRateLimits(database);
  const authority = createM7SessionAuthority(database, {
    adapterManifestDigest: MOBILE_REMOTE_CANDIDATE_ADAPTER_MANIFEST_DIGEST_V1,
    authorizeOperator: () => ({ actorId: 'operator:test', actorType: 'user', decision: 'allow' }),
    clock: () => NOW,
    pairingEnabled: false,
    serverIdentityPin: PIN,
    serverOrigin: ORIGIN,
  });
  const policy = createM7TransportAdmissionPolicy({
    listener: {
      bindAddress: '100.100.20.30',
      port: 7443,
      serverIdentityPin: PIN,
      serverOrigin: ORIGIN,
      tlsMaximumVersion: 'TLSv1.3',
      tlsMinimumVersion: 'TLSv1.3',
      trustProxy: false,
    },
    peerIdentityKey: Buffer.alloc(32, 0x71),
  });
  const limiter = createM7DurableRateLimiter(database, { clock: () => NOW });
  const pipeline = createM7DisconnectedRequestPipeline({
    admissionPolicy: policy,
    rateLimiter: limiter,
    sessionAuthority: authority,
    coreConfig: {
      authorizeConversation: async () => false,
      authorizeProject: async () => false,
      clock: () => NOW,
      coreVersion: '136.1.0-test',
      cursorKey: Buffer.alloc(32, 0x72),
      database,
      executeConversation: async () => {
        throw new Error('not-called');
      },
      healthComponents: [
        { componentId: 'core', observe: async () => ({ code: 'READY', status: 'ok' }) },
      ],
      mediateMutation: async () => {
        throw new Error('not-called');
      },
    },
  });
  return { database, pipeline };
}

class ResponseProbe {
  constructor() {
    this.body = null;
    this.destroyed = false;
    this.headers = null;
    this.headersSent = false;
    this.statusCode = null;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
  }

  end(bytes) {
    this.body = Buffer.from(bytes);
  }
}

function request(overrides = {}) {
  const value = new EventEmitter();
  Object.assign(value, {
    httpVersion: '1.1',
    method: 'GET',
    rawHeaders: [
      'Host', 'intentsmith.tailnet.example:7443',
      'X-IntentSmith-Request-Id', 'request:listener:health',
    ],
    socket: {
      encrypted: true,
      getProtocol: () => 'TLSv1.3',
      remoteAddress: '100.100.20.31',
    },
    url: '/remote/v1/health',
  }, overrides);
  return value;
}

async function invoke(handler, incoming) {
  const response = new ResponseProbe();
  const pending = handler(incoming, response);
  queueMicrotask(() => incoming.emit('end'));
  await pending;
  return response;
}

suite('M7 VPN TLS listener framing and response boundary');

await testAsync('a genuine pipeline receives exact TLS transport metadata and emits canonical no-store JSON', async () => {
  const fixture = setup();
  try {
    const handler = createM7VpnRequestHandler(fixture.pipeline);
    const response = await invoke(handler, request());
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['Content-Length'], String(response.body.length));
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    const text = response.body.toString('utf8');
    const body = JSON.parse(text);
    assert.equal(body.contract, 'RemoteHealthSnapshot');
    assert.equal(body.requestId, 'request:listener:health');
    assert.equal(text, JSON.stringify(body));
  } finally {
    fixture.database.close();
  }
});

await testAsync('transport denials preserve typed codes without messages, stacks or request echo', async () => {
  const fixture = setup();
  try {
    const response = await invoke(createM7VpnRequestHandler(fixture.pipeline), request({
      rawHeaders: [
        'Host', 'evil.example:7443',
        'X-IntentSmith-Request-Id', 'request:listener:secret',
      ],
    }));
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers.Connection, 'close');
    assert.deepEqual(JSON.parse(response.body), {
      code: 'M7_TRANSPORT_HEADER_INVALID',
      contract: 'RemoteTransportError',
      retryAfterSeconds: null,
      version: 1,
    });
    assert.equal(response.body.includes(Buffer.from('evil.example')), false);
    assert.equal(response.body.includes(Buffer.from('stack')), false);
  } finally {
    fixture.database.close();
  }
});

await testAsync('draining rejects before reading and declared oversized bodies get 413', async () => {
  const fixture = setup();
  try {
    const drainingRequest = request();
    const drainingResponse = new ResponseProbe();
    await createM7VpnRequestHandler(fixture.pipeline, { isClosing: () => true })(
      drainingRequest, drainingResponse,
    );
    assert.equal(drainingResponse.statusCode, 503);
    assert.equal(JSON.parse(drainingResponse.body).code, 'REMOTE_LISTENER_DRAINING');

    const oversized = request({
      method: 'POST',
      rawHeaders: [
        'Host', 'intentsmith.tailnet.example:7443',
        'Content-Type', 'application/json',
        'Content-Length', '1048577',
      ],
      url: '/remote/v1/invoke',
    });
    const oversizedResponse = new ResponseProbe();
    await createM7VpnRequestHandler(fixture.pipeline)(oversized, oversizedResponse);
    assert.equal(oversizedResponse.statusCode, 413);
    assert.equal(JSON.parse(oversizedResponse.body).code, M7_VPN_TLS_LISTENER_ERROR.REQUEST_TOO_LARGE);
  } finally {
    fixture.database.close();
  }
});

test('TLS options are fixed and neither alternate protocol nor client certificate is enabled', () => {
  const certificate = Buffer.from('test-certificate');
  const privateKey = Buffer.from('test-private-key');
  assert.deepEqual(_testInternals.tlsOptions({ certificate, privateKey }), {
    cert: certificate,
    key: privateKey,
    maxHeaderSize: 8_192,
    maxVersion: 'TLSv1.3',
    minVersion: 'TLSv1.3',
    requestCert: false,
  });
  assert.equal(Object.hasOwn(_testInternals, 'createFromMaterial'), false);
});

test('only genuine pipeline objects can become request handlers', () => {
  assert.throws(
    () => createM7VpnRequestHandler({ dispatch() {} }),
    error => error?.code === M7_VPN_TLS_LISTENER_ERROR.CONFIG_INVALID,
  );
});

summary();
