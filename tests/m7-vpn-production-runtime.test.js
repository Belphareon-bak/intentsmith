#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { AgentRepository, createM3AgentNotificationReadPort, initAgentTables } from '../src/agents/repository.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  createDefaultM2LifecycleApplicationService,
  createM2LifecycleApprovalPort,
} from '../src/lifecycle/m2-lifecycle-application-service.js';
import {
  M7_SESSION_AUTHORITY_ERROR,
  M7SessionAuthorityError,
} from '../src/remote/m7-session-authority.js';
import { createM7RunEventCoreAdapter } from '../src/remote/m7-run-event-core-adapter.js';
import { createM7VpnRuntimeConfiguration } from '../src/remote/m7-vpn-runtime-config.js';
import {
  _testInternals,
  createM7VpnRuntimeComposition,
  M7_VPN_PRODUCTION_RUNTIME_STAGE,
} from '../src/remote/m7-vpn-production-runtime.js';
import { suite, summary, test, testAsync } from './harness.js';

const PIN = `sha256:${'a'.repeat(64)}`;

function runtimeConfig() {
  return createM7VpnRuntimeConfiguration({
    effectiveUid: 1000,
    env: {
      INTENTSMITH_M7_REMOTE_ENABLED: 'true',
      INTENTSMITH_M7_VPN_INTERFACE: 'tailscale0',
      INTENTSMITH_M7_BIND_ADDRESS: '100.64.10.20',
      INTENTSMITH_M7_SERVER_ORIGIN: 'https://100.64.10.20:7443',
      INTENTSMITH_M7_SERVER_SPKI_SHA256: PIN,
      CREDENTIALS_DIRECTORY: '/run/user/1000/credentials/intentsmith-m7.service',
    },
    networkInterfaces: () => ({
      tailscale0: [{ address: '100.64.10.20', family: 'IPv4', internal: false }],
    }),
  });
}

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-m7-production-runtime-'));
  const database = new Database(path.join(root, 'runtime.db'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  await runMigrations(database);
  initAgentTables(database);
  const projects = {
    findById: database.prepare('SELECT * FROM projects WHERE id = ?'),
  };
  const m2Service = createDefaultM2LifecycleApplicationService({ database, projects });
  const agentRepository = new AgentRepository(database);
  return {
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
    database,
    dependencies: {
      authorizeConversation: async () => true,
      authorizeNotification: async () => true,
      authorizeOperator: () => ({
        decision: 'allow', actorType: 'user', actorId: 'local-operator',
      }),
      authorizeProject: async () => true,
      coreVersion: '136.1.0-test',
      database,
      executeConversation: async request => ({
        contract: 'ConversationResult', version: 1,
        requestId: request.requestId, conversationId: request.conversationId,
        turnId: request.turnId, status: 'ok', response: { content: 'fixture' },
      }),
      healthComponents: [
        { componentId: 'database', observe: async () => ({ status: 'ok', code: 'READY' }) },
      ],
      m2ApprovalPort: createM2LifecycleApprovalPort(m2Service),
      notificationPort: createM3AgentNotificationReadPort(agentRepository),
    },
  };
}

suite('M7 VPN production runtime composition');

await testAsync('one inactive composition requires and binds all seven genuine core capabilities', async () => {
  const test = await fixture();
  try {
    const composition = createM7VpnRuntimeComposition({
      dependencies: test.dependencies,
      peerIdentityKey: Buffer.alloc(32, 0x71),
      runtimeConfig: runtimeConfig(),
    });
    assert.deepEqual(composition.describe(), {
      active: false,
      capabilities: [
        'approvals', 'conversations', 'events', 'notifications',
        'projects', 'settings', 'stored_information',
      ],
      contract: 'M7VpnRuntimeComposition',
      serverIdentityPin: PIN,
      serverOrigin: 'https://100.64.10.20:7443',
      stage: M7_VPN_PRODUCTION_RUNTIME_STAGE,
      version: 1,
    });
    assert.equal(composition.pipeline.describe().transport, 'disconnected');
    assert.throws(
      () => composition.sessionAuthority.issuePairingClaim({
        authenticatedSubject: {}, credentialType: 'local-capability',
        subjectId: 'local-operator', scopes: ['read:chat'],
      }),
      error => error instanceof M7SessionAuthorityError
        && error.code === M7_SESSION_AUTHORITY_ERROR.PAIRING_DISABLED,
    );
  } finally {
    test.close();
  }
});

await testAsync('missing genuine notification or M2 port fails before any listener exists', async () => {
  const test = await fixture();
  try {
    for (const field of ['notificationPort', 'm2ApprovalPort']) {
      const dependencies = { ...test.dependencies };
      delete dependencies[field];
      assert.throws(
        () => createM7VpnRuntimeComposition({
          dependencies,
          peerIdentityKey: Buffer.alloc(32, 0x72),
          runtimeConfig: runtimeConfig(),
        }),
        /dependencies-incomplete/u,
      );
    }
  } finally {
    test.close();
  }
});

await testAsync('the server-owned event adapter is shared with the exact runtime composition', async () => {
  const test = await fixture();
  try {
    const runEventAdapter = createM7RunEventCoreAdapter();
    const composition = createM7VpnRuntimeComposition({
      dependencies: { ...test.dependencies, runEventAdapter },
      peerIdentityKey: Buffer.alloc(32, 0x74),
      runtimeConfig: runtimeConfig(),
    });
    assert.equal(composition.runEventAdapter, runEventAdapter);
  } finally {
    test.close();
  }
});

test('server activation publishes pairing only after bind and withdraws it before drain', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const activation = source.slice(
    source.indexOf('listenOnLegacyLoopback(server, config.server'),
    source.indexOf('// Only exact M3 extension instances'),
  );
  const shutdown = source.slice(
    source.indexOf('async function gracefulShutdown'),
    source.indexOf("process.on('SIGINT'"),
  );
  assert.match(source, /m7RemoteFlag !== undefined[\s\S]*m7RemoteFlag !== 'true'[\s\S]*m7RemoteFlag !== 'false'/u);
  assert.ok(activation.indexOf('await m7VpnRuntime.start()') >= 0);
  assert.ok(
    activation.indexOf('await m7VpnRuntime.start()')
      < activation.indexOf('m7SessionAuthority = m7VpnRuntime.sessionAuthority'),
  );
  assert.ok(shutdown.indexOf('m7SessionAuthority = null') >= 0);
  assert.ok(
    shutdown.indexOf('m7SessionAuthority = null')
      < shutdown.indexOf('await m7VpnRuntime.stop'),
  );
  assert.ok(
    shutdown.indexOf('await m7VpnRuntime.stop') < shutdown.indexOf('db.close()'),
  );
  assert.match(source, /observeCoreEvent: m7RunEventAdapter\?\.observeCoreEvent \?\? null/u);
});

test('operation scopes and cursor key are exact and domain-separated', () => {
  assert.deepEqual(_testInternals.resolveInvocationScopes({
    capabilityId: 'settings', capabilityVersion: 1, operationId: 'settings.update',
  }), ['write:settings']);
  assert.throws(() => _testInternals.resolveInvocationScopes({
    capabilityId: 'settings', capabilityVersion: 2, operationId: 'settings.update',
  }), /operation-identity-invalid/u);
  const peer = Buffer.alloc(32, 0x73);
  assert.equal(_testInternals.cursorKey(peer).length, 32);
  assert.equal(_testInternals.cursorKey(peer).equals(peer), false);
});

summary();
