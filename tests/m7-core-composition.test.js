#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  AgentRepository,
  createM3AgentNotificationReadPort,
  initAgentTables,
} from '../src/agents/repository.js';
import { up as installEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as installEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as installEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as installEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as installExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as installLifecycleAuthority } from '../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installInformation } from '../src/db/migrations/2026_08_29_102_m7_manual_information.js';
import { up as installAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import { up as installNotificationReceipts } from '../src/db/migrations/2026_08_29_107_m7_notification_ack_receipts.js';
import {
  createDefaultM2LifecycleApplicationService,
  createM2LifecycleApprovalPort,
} from '../src/lifecycle/m2-lifecycle-application-service.js';
import {
  createM7CoreComposition,
  M7_CORE_COMPOSITION_STAGE,
} from '../src/remote/m7-core-composition.js';
import { createM7RunEventCoreAdapter } from '../src/remote/m7-run-event-core-adapter.js';
import { suite, summary, test, testAsync } from './harness.js';

const CURSOR_KEY = Buffer.alloc(32, 0x63);

function setup({ approvalCapability = false, remainingCapabilities = false, ...overrides } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'intentsmith-m7-composition-'));
  const projectRoot = path.join(root, 'project');
  mkdirSync(projectRoot);
  writeFileSync(path.join(projectRoot, 'authority.js'), 'export const authority = true;\n', 'utf8');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
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
    CREATE TRIGGER messages_count_ai AFTER INSERT ON messages BEGIN
      UPDATE conversations SET message_count = message_count + 1
      WHERE id = new.conversation_id;
    END;
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY, data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(`
    INSERT INTO projects (id, name, path, status, last_active)
    VALUES (1, 'Composition project', ?, 'active', '2026-08-29 05:00:00')
  `).run(projectRoot);
  db.prepare(`
    INSERT INTO conversations (
      id, project_id, title, state, created_at, updated_at, archived_at, deleted_at
    ) VALUES (
      'conversation:composition', 1, 'Composition conversation', 'active',
      '2026-08-29T05:00:00.000Z', '2026-08-29T05:00:00.000Z', NULL, NULL
    )
  `).run();
  db.prepare(`
    INSERT INTO messages (conversation_id, role, content, metadata, created_at)
    VALUES ('conversation:composition', 'user', 'Compose safely.', '{}',
      '2026-08-29T05:00:00.000Z')
  `).run();
  installJournal(db);
  installAbandonments(db);
  installInformation(db);
  installNotificationReceipts(db);
  if (approvalCapability) {
    for (const migration of [
      installEffectAuthority,
      installEffectHardening,
      installEffectClaims,
      installEffectClaimTruth,
      installExecutionAuthority,
      installLifecycleAuthority,
    ]) migration(db);
  }
  let now = Date.parse('2026-08-29T05:00:01.000Z');
  let runEventAdapter;
  let notificationPort;
  let m2ApprovalPort;
  let agentNotificationId = null;
  if (remainingCapabilities) {
    initAgentTables(db);
    const agentRepository = new AgentRepository(db);
    agentRepository.createAgent({
      id: 'composition-agent', name: 'Composition Agent', definition: { type: 'MONITOR' },
    });
    const agentRunId = agentRepository.createRun('composition-agent');
    agentNotificationId = Number(agentRepository.createNotification(
      'composition-agent',
      agentRunId,
      { title: 'Composition notification', priority: 'normal', data: { projectId: 1 } },
    ));
    notificationPort = createM3AgentNotificationReadPort(agentRepository);
    runEventAdapter = createM7RunEventCoreAdapter({ now: () => ++now });
    runEventAdapter.observeCoreEvent({
      subjectId: 'user:composition:001', projectId: 1,
      event: {
        contract: 'CoreEvent', version: 1,
        requestId: 'run:composition:001', conversationId: 'conversation:composition',
        turnId: 'turn:composition:001', sequence: 1, phase: 'progress',
        eventType: 'tool.progress', payload: { progressPercent: 50 },
      },
    });
  }
  if (approvalCapability) {
    const service = createDefaultM2LifecycleApplicationService({
      database: db,
      projects: Object.freeze({
        findById: Object.freeze({
          get(projectId) {
            return projectId === 1 ? { id: 1, path: projectRoot, status: 'active' } : null;
          },
        }),
      }),
      clock: () => ++now,
    });
    m2ApprovalPort = createM2LifecycleApprovalPort(service);
  }
  let composition;
  try {
    composition = createM7CoreComposition({
      authorityResolver: async input => ({
        decision: 'allow',
        deviceId: 'device:composition:001',
        subjectId: 'user:composition:001',
        grantedScopes: [...input.requiredScopes],
      }),
      authorizeConversation: async ({ projectId, exists }) => exists && projectId === 1,
      authorizeNotification: async ({ projectId }) => projectId === 1,
      authorizeProject: async ({ projectId }) => projectId === 1,
      clock: () => ++now,
      coreVersion: '136.1.0',
      cursorKey: CURSOR_KEY,
      database: db,
      executeConversation: async request => ({
        contract: 'ConversationResult', version: 1,
        requestId: request.requestId, conversationId: request.conversationId,
        turnId: request.turnId, status: 'ok', response: { content: 'Composed.' },
      }),
      healthComponents: [
        { componentId: 'core-composition', observe: async () => ({ status: 'ok', code: 'READY' }) },
      ],
      mediateMutation: async intent => ({ state: 'executed', result: await intent.perform() }),
      ...(approvalCapability ? { m2ApprovalPort } : {}),
      ...(remainingCapabilities ? { notificationPort, runEventAdapter } : {}),
      ...overrides,
    });
  } catch (error) {
    db.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    composition,
    db,
    agentNotificationId,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function invoke(provider, capabilityId, capabilityVersion, operationId, request) {
  return provider.invoke({ capabilityId, capabilityVersion, operationId, request });
}

suite('M7 transport-free core composition');

test('composition rejects unknown config and has no built-in authority defaults', () => {
  assert.throws(
    () => createM7CoreComposition({ unknown: true }),
    /m7-core-composition:config-invalid/u,
  );
  assert.throws(
    () => createM7CoreComposition({}),
    error => /database|journal/u.test(error.message),
  );
});

test('composition refuses a structurally forged M2 approval port', () => {
  assert.throws(
    () => setup({
      m2ApprovalPort: Object.freeze({
        contract: 'M2LifecycleApprovalPort', version: 1,
        listOwned() { return []; },
      }),
    }),
    /genuine-m2-port-required/u,
  );
});

test('composition source imports no server, route, session, listener or network authority', () => {
  const source = readFileSync(new URL('../src/remote/m7-core-composition.js', import.meta.url), 'utf8');
  const imports = (source.match(/^import[\s\S]*? from ['"][^'"]+['"];$/gmu) ?? []).join('\n');
  for (const forbidden of ['server.js', 'routes/', 'ws-bridge', 'session', 'listener', 'fetch(', 'node:http', 'node:net']) {
    assert.equal(imports.includes(forbidden), false, forbidden);
  }
});

await testAsync('only four complete capabilities advertise and the provider remains inactive', async () => {
  const fixture = setup();
  try {
    assert.equal(fixture.composition.stage, M7_CORE_COMPOSITION_STAGE);
    assert.deepEqual(fixture.composition.provider.describe(), {
      contract: 'M7InProcessCapabilityProvider', version: 1,
      stage: 'IMPLEMENTED_NOT_ACTIVE', activation: 'not_active',
      listener: 'absent', transport: 'absent',
    });
    const advertisement = fixture.composition.provider.advertise();
    assert.deepEqual(
      advertisement.filter(item => item.status === 'available').map(item => item.capabilityId),
      ['conversations', 'projects', 'settings', 'stored_information'],
    );
    assert.deepEqual(
      advertisement.filter(item => item.status === 'unavailable').map(item => item.capabilityId),
      ['approvals', 'events', 'notifications'],
    );
  } finally {
    fixture.close();
  }
});

await testAsync('real project, conversation and settings reads cross the composed provider', async () => {
  const fixture = setup();
  try {
    const provider = fixture.composition.provider;
    const projects = await invoke(provider, 'projects', 2, 'project.list', {
      contract: 'ProjectListQuery', version: 1,
      requestId: 'request:composition:projects', limit: 10,
    });
    assert.equal(projects.status, 'ok');
    assert.deepEqual(projects.items.map(item => item.projectId), [1]);

    const conversations = await invoke(provider, 'conversations', 2, 'conversation.list', {
      contract: 'ConversationListQuery', version: 1,
      requestId: 'request:composition:conversations', limit: 10,
    });
    assert.equal(conversations.status, 'ok');
    assert.deepEqual(conversations.items.map(item => item.conversationId), ['conversation:composition']);

    const settings = await invoke(provider, 'settings', 1, 'settings.read', {
      contract: 'MobileSettingsQuery', version: 1,
      requestId: 'request:composition:settings',
    });
    assert.equal(settings.status, 'ok');
    assert.equal(settings.items.length, 5);
  } finally {
    fixture.close();
  }
});

await testAsync('real CoreEvent and M3 notification ports complete two more capabilities', async () => {
  const fixture = setup({ remainingCapabilities: true });
  try {
    const provider = fixture.composition.provider;
    assert.deepEqual(
      provider.advertise().filter(item => item.status === 'available').map(item => item.capabilityId),
      ['conversations', 'events', 'notifications', 'projects', 'settings', 'stored_information'],
    );
    const events = await invoke(provider, 'events', 1, 'run-event.list', {
      contract: 'RunEventQuery', version: 1,
      requestId: 'request:composition:events', runId: 'run:composition:001',
      limit: 25, afterSeq: 0, waitMs: 0,
    });
    assert.equal(events.status, 'ok');
    assert.deepEqual(events.events.map(event => event.sequence), [1]);

    const notifications = await invoke(provider, 'notifications', 1, 'notification.list', {
      contract: 'NotificationListQuery', version: 1,
      requestId: 'request:composition:notifications', limit: 25, afterSeq: 0,
    });
    assert.equal(notifications.status, 'ok');
    assert.deepEqual(
      notifications.items.map(item => item.notificationId),
      [`notification:m3:${fixture.agentNotificationId}`],
    );
    const ack = await invoke(provider, 'notifications', 1, 'notification.ack', {
      contract: 'NotificationAckCommand', version: 1,
      requestId: 'request:composition:notification-ack',
      operationId: 'operation:composition:notification-ack',
      notificationIds: [`notification:m3:${fixture.agentNotificationId}`],
      observedThroughSeq: fixture.agentNotificationId,
    });
    assert.equal(ack.outcome, 'CONFIRMED');
    assert.equal(ack.replayed, false);
  } finally {
    fixture.close();
  }
});

await testAsync('all seven genuine capability ports compose without activating a provider', async () => {
  const fixture = setup({ approvalCapability: true, remainingCapabilities: true });
  try {
    assert.deepEqual(
      fixture.composition.provider.advertise()
        .filter(item => item.status === 'available')
        .map(item => item.capabilityId),
      ['approvals', 'conversations', 'events', 'notifications', 'projects', 'settings', 'stored_information'],
    );
    assert.deepEqual(fixture.composition.provider.describe(), {
      contract: 'M7InProcessCapabilityProvider', version: 1,
      stage: 'IMPLEMENTED_NOT_ACTIVE', activation: 'not_active',
      listener: 'absent', transport: 'absent',
    });
  } finally {
    fixture.close();
  }
});

await testAsync('mutation, journal replay, recovery control and health share one composition', async () => {
  const fixture = setup();
  try {
    const provider = fixture.composition.provider;
    const read = await invoke(provider, 'settings', 1, 'settings.read', {
      contract: 'MobileSettingsQuery', version: 1,
      requestId: 'request:composition:settings-before',
    });
    const command = {
      contract: 'MobileSettingUpdateCommand', version: 1,
      requestId: 'request:composition:update', operationId: 'operation:composition:update',
      key: 'appearance.theme', value: 'light', expectedRevision: read.revision,
    };
    const first = await invoke(provider, 'settings', 1, 'settings.update', command);
    const replay = await invoke(provider, 'settings', 1, 'settings.update', command);
    assert.equal(first.outcome, 'CONFIRMED');
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);

    const operation = await invoke(
      provider, 'm7-control-plane-prerequisite', 1, 'operation.get',
      { contract: 'OperationLookupQuery', version: 1,
        requestId: 'request:composition:operation', operationId: command.operationId },
    );
    assert.equal(operation.status, 'ok');
    assert.equal(operation.operation.state, 'confirmed');

    const health = await invoke(
      provider, 'm7-control-plane-prerequisite', 1, 'remote-health.read',
      { contract: 'RemoteHealthQuery', version: 1, requestId: 'request:composition:health' },
    );
    assert.equal(health.status, 'ok');
    assert.equal(validateMobileRemotePayload('RemoteHealthSnapshot@1', health).valid, true);
  } finally {
    fixture.close();
  }
});

summary();
