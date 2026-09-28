#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';

import {
  validateConversationCommand,
  validateConversationResult,
} from '../contracts/m1/index.js';
import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import {
  validateMobileRemotePayload,
} from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import {
  MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
} from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import {
  up as installM7OperationJournal,
} from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installM7OperationAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import {
  createM7ConversationCoreAdapters,
} from '../src/remote/m7-conversation-core-adapters.js';
import {
  createM7InProcessCapabilityProvider,
} from '../src/remote/m7-in-process-capability-provider.js';
import {
  createM7OperationJournal,
  M7_OPERATION_JOURNAL_ERROR,
} from '../src/remote/m7-operation-journal.js';
import { suite, summary, test, testAsync } from './harness.js';

const CURSOR_KEY = Buffer.alloc(32, 0x6b);
const externalValidators = Object.freeze({
  'ConversationCommand@1': validateConversationCommand,
  'ConversationResult@1': validateConversationResult,
});

function trusted(overrides = {}) {
  return {
    deviceId: 'device:conversation:001',
    subjectId: 'user:conversation:001',
    grantedScopes: ['read:chat', 'write:chat'],
    ...overrides,
  };
}

function listRequest(overrides = {}) {
  return {
    contract: 'ConversationListQuery',
    version: 1,
    requestId: 'request:conversation:list:001',
    limit: 1,
    ...overrides,
  };
}

function historyRequest(overrides = {}) {
  const request = {
    contract: 'ConversationHistoryQuery',
    version: 1,
    requestId: 'request:conversation:history:001',
    conversationId: 'conversation:alpha',
    limit: 2,
    anchor: 'latest',
    ...overrides,
  };
  if (request.anchor === undefined) delete request.anchor;
  return request;
}

function commandRequest(overrides = {}) {
  return {
    contract: 'ConversationCommand',
    version: 1,
    requestId: 'request:conversation:execute:001',
    conversationId: 'conversation:alpha',
    turnId: 'turn:conversation:execute:001',
    action: 'send',
    input: 'Create one durable response.',
    ...overrides,
  };
}

function okCommandResult(request) {
  return {
    contract: 'ConversationResult',
    version: 1,
    requestId: request.requestId,
    conversationId: request.conversationId,
    turnId: request.turnId,
    status: 'ok',
    response: { content: 'One durable response.' },
  };
}

function setup({
  authorizeConversation = async input => input.conversationId !== 'conversation:secret',
  executeConversation = async request => okCommandResult(request),
  maxConversationScan = 2_000,
  maxMessageScan = 10_000,
} = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      project_id INTEGER,
      title TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE TRIGGER messages_count_ai AFTER INSERT ON messages BEGIN
      UPDATE conversations SET message_count = message_count + 1
      WHERE id = new.conversation_id;
    END;
  `);
  const insertConversation = db.prepare(`
    INSERT INTO conversations (
      id, project_id, title, state, created_at, updated_at, archived_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertConversation.run(
    'conversation:alpha', 1, 'Alpha conversation', 'active',
    '2026-08-29T01:00:00.000Z', '2026-08-29T04:00:00.000Z', null, null,
  );
  insertConversation.run(
    'conversation:beta', null, '', 'archived',
    '2026-08-29T01:00:00.000Z', '2026-08-29T03:00:00.000Z',
    '2026-08-29T03:00:00.000Z', null,
  );
  insertConversation.run(
    'conversation:secret', 2, 'Secret conversation', 'active',
    '2026-08-29T01:00:00.000Z', '2026-08-29T02:00:00.000Z', null, null,
  );
  insertConversation.run(
    'conversation:deleted', 3, 'Deleted conversation', 'deleted',
    '2026-08-29T01:00:00.000Z', '2026-08-29T05:00:00.000Z',
    null, '2026-08-29T05:00:00.000Z',
  );
  const insertMessage = db.prepare(`
    INSERT INTO messages (conversation_id, role, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const messages = [
    ['user', 'First question.', { m7: { turnId: 'turn:alpha:001', status: 'ok' } }],
    ['assistant', 'First answer.', { m7: { turnId: 'turn:alpha:001', status: 'ok' } }],
    ['user', 'Legacy question.', { timestamp: 1_000 }],
    ['assistant', 'Failed answer marker.', { m7: { turnId: 'turn:alpha:003', status: 'error' } }],
    ['system', 'Newest system note.', { m7: { turnId: 'turn:alpha:004', status: 'ok' } }],
  ];
  messages.forEach(([role, content, metadata], index) => insertMessage.run(
    'conversation:alpha',
    role,
    content,
    JSON.stringify(metadata),
    `2026-08-29T01:00:0${index + 1}.000Z`,
  ));
  insertMessage.run(
    'conversation:beta', 'user', 'Archived question.', '{}', '2026-08-29T01:01:00.000Z',
  );
  insertMessage.run(
    'conversation:secret', 'user', 'Never release this.', '{}', '2026-08-29T01:02:00.000Z',
  );
  db.prepare(`
    UPDATE conversations SET updated_at = CASE id
      WHEN 'conversation:alpha' THEN '2026-08-29T04:00:00.000Z'
      WHEN 'conversation:beta' THEN '2026-08-29T03:00:00.000Z'
      WHEN 'conversation:secret' THEN '2026-08-29T02:00:00.000Z'
      ELSE updated_at END
  `).run();
  installM7OperationJournal(db);
  installM7OperationAbandonments(db);
  let now = 10_000;
  const journal = createM7OperationJournal(db, { clock: () => now++ });
  const adapters = createM7ConversationCoreAdapters({
    authorizeConversation,
    cursorKey: CURSOR_KEY,
    database: db,
    executeConversation,
    maxConversationScan,
    maxMessageScan,
  });
  return { adapters, db, journal };
}

function providerFor(fixture, identity = trusted()) {
  return createM7InProcessCapabilityProvider({
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    validatePayload: validateMobileRemotePayload,
    validateOperationPair: validateMobileRemoteOperationPair,
    externalValidators,
    handlers: fixture.adapters.handlers,
    authorityResolver: async input => ({
      decision: 'allow',
      deviceId: identity.deviceId,
      subjectId: identity.subjectId,
      grantedScopes: [...input.requiredScopes],
    }),
    mutationJournal: fixture.journal,
  });
}

function invoke(provider, operationId, request) {
  return provider.invoke({
    capabilityId: 'conversations',
    capabilityVersion: 2,
    operationId,
    request,
  });
}

suite('M7 conversation core adapters');

await testAsync('real SQLite list and newest-first history pages pass exact provider contracts', async () => {
  const fixture = setup();
  try {
    const provider = providerFor(fixture);
    assert.equal(
      provider.advertise().find(item => item.capabilityId === 'conversations').status,
      'available',
    );
    const firstList = await invoke(provider, 'conversation.list', listRequest());
    assert.equal(firstList.status, 'ok');
    assert.deepEqual(firstList.items.map(item => item.conversationId), ['conversation:alpha']);
    assert.equal(firstList.items[0].messageCount, 5);
    assert.equal(firstList.items[0].projectId, 1);
    assert.equal(firstList.end, false);
    const secondList = await invoke(provider, 'conversation.list', listRequest({
      requestId: 'request:conversation:list:002',
      cursor: firstList.nextCursor,
    }));
    assert.deepEqual(secondList.items.map(item => item.conversationId), ['conversation:beta']);
    assert.equal(secondList.items[0].title, 'Untitled conversation');
    assert.equal(secondList.end, true);

    const latest = await invoke(provider, 'conversation.history', historyRequest());
    assert.equal(latest.status, 'ok');
    assert.deepEqual(latest.messages.map(message => message.messageId), ['message:4', 'message:5']);
    assert.deepEqual(latest.messages.map(message => message.status), ['error', 'ok']);
    assert.equal(latest.end, false);
    const older = await invoke(provider, 'conversation.history', historyRequest({
      requestId: 'request:conversation:history:002',
      cursor: latest.nextCursor,
      anchor: undefined,
    }));
    assert.deepEqual(older.messages.map(message => message.messageId), ['message:2', 'message:3']);
    assert.equal(older.messages[1].turnId, 'turn:message:3');
    const oldest = await invoke(provider, 'conversation.history', historyRequest({
      requestId: 'request:conversation:history:003',
      cursor: older.nextCursor,
      anchor: undefined,
    }));
    assert.deepEqual(oldest.messages.map(message => message.messageId), ['message:1']);
    assert.equal(oldest.end, true);
    assert.equal(Object.isFrozen(oldest.messages), true);
  } finally {
    fixture.db.close();
  }
});

await testAsync('denied and deleted conversations expose neither identity nor content', async () => {
  const fixture = setup();
  try {
    const provider = providerFor(fixture);
    const list = await invoke(provider, 'conversation.list', listRequest({ limit: 10 }));
    const encoded = JSON.stringify(list);
    assert.doesNotMatch(encoded, /secret|deleted|Never release/u);
    for (const conversationId of ['conversation:secret', 'conversation:deleted', 'conversation:absent']) {
      const result = await invoke(provider, 'conversation.history', historyRequest({
        requestId: `request:history:${conversationId.split(':').at(-1)}`,
        conversationId,
      }));
      assert.equal(result.status, 'error');
      assert.equal(result.error.code, 'REMOTE_CONVERSATION_NOT_AVAILABLE');
      assert.doesNotMatch(JSON.stringify(result), /Never release|Secret conversation/u);
    }
  } finally {
    fixture.db.close();
  }
});

await testAsync('cursor tamper, cross-subject replay and snapshot drift fail closed', async () => {
  const fixture = setup();
  try {
    const provider = providerFor(fixture);
    const page = await invoke(provider, 'conversation.history', historyRequest());
    const tampered = `${page.nextCursor.slice(0, -1)}${page.nextCursor.endsWith('0') ? '1' : '0'}`;
    const tamperResult = await invoke(provider, 'conversation.history', historyRequest({
      requestId: 'request:history:tamper', cursor: tampered, anchor: undefined,
    }));
    assert.equal(tamperResult.error.code, 'REMOTE_CONVERSATION_CURSOR_INVALID');

    const foreign = providerFor(fixture, trusted({ subjectId: 'user:conversation:foreign' }));
    const foreignResult = await invoke(foreign, 'conversation.history', historyRequest({
      requestId: 'request:history:foreign', cursor: page.nextCursor, anchor: undefined,
    }));
    assert.equal(foreignResult.error.code, 'REMOTE_CONVERSATION_CURSOR_INVALID');

    fixture.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, metadata, created_at)
      VALUES ('conversation:alpha', 'user', 'Snapshot drift.', '{}', '2026-08-29T01:00:06.000Z')
    `).run();
    const stale = await invoke(provider, 'conversation.history', historyRequest({
      requestId: 'request:history:stale', cursor: page.nextCursor, anchor: undefined,
    }));
    assert.equal(stale.error.code, 'REMOTE_CONVERSATION_CURSOR_STALE');
  } finally {
    fixture.db.close();
  }
});

await testAsync('revocation or catalog drift during reads suppresses the whole result', async () => {
  let calls = 0;
  let db;
  const fixture = setup({
    authorizeConversation: async input => {
      calls += 1;
      if (input.operationId === 'conversation.history' && calls === 2) return false;
      if (input.operationId === 'conversation.list' && calls === 2) {
        db.prepare(`UPDATE conversations SET title = 'Changed during read' WHERE id = ?`)
          .run(input.conversationId);
      }
      return input.conversationId !== 'conversation:secret';
    },
  });
  db = fixture.db;
  try {
    const history = await fixture.adapters.readConversationHistory(historyRequest(), trusted());
    assert.equal(history.error.code, 'REMOTE_CONVERSATION_NOT_AVAILABLE');
    calls = 0;
    const list = await fixture.adapters.listConversations(listRequest({ limit: 10 }), trusted());
    assert.equal(list.error.code, 'REMOTE_CONVERSATION_READ_FAILED');
    assert.doesNotMatch(JSON.stringify(list), /Changed during read/u);
  } finally {
    fixture.db.close();
  }
});

await testAsync('conversation commands are durably at-most-once with exact M1 identity', async () => {
  let calls = 0;
  const fixture = setup({
    executeConversation: async request => {
      calls += 1;
      return okCommandResult(request);
    },
  });
  try {
    const provider = providerFor(fixture);
    const request = commandRequest();
    const first = await invoke(provider, 'conversation.execute', request);
    const replay = await invoke(provider, 'conversation.execute', structuredClone(request));
    assert.deepEqual(first, okCommandResult(request));
    assert.deepEqual(replay, first);
    assert.equal(calls, 1);
    assert.equal(fixture.journal.getSettlement({
      deviceId: trusted().deviceId,
      subjectId: trusted().subjectId,
      operationId: request.requestId,
    }).state, 'CONFIRMED');
  } finally {
    fixture.db.close();
  }
});

await testAsync('command denial is terminal before core while post-effect revocation is UNKNOWN', async () => {
  let deniedCalls = 0;
  const denied = setup({
    authorizeConversation: async () => false,
    executeConversation: async request => {
      deniedCalls += 1;
      return okCommandResult(request);
    },
  });
  try {
    const result = await invoke(providerFor(denied), 'conversation.execute', commandRequest());
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'M7_CONVERSATION_ACCESS_DENIED');
    assert.equal(deniedCalls, 0);
  } finally {
    denied.db.close();
  }

  let authorityCalls = 0;
  let effectCalls = 0;
  const revoked = setup({
    authorizeConversation: async () => {
      authorityCalls += 1;
      return authorityCalls === 1;
    },
    executeConversation: async request => {
      effectCalls += 1;
      return okCommandResult(request);
    },
  });
  try {
    await assert.rejects(
      invoke(providerFor(revoked), 'conversation.execute', commandRequest()),
      error => error.code === M7_OPERATION_JOURNAL_ERROR.OUTCOME_UNKNOWN,
    );
    assert.equal(effectCalls, 1);
    assert.equal(revoked.journal.getSettlement({
      deviceId: trusted().deviceId,
      subjectId: trusted().subjectId,
      operationId: commandRequest().requestId,
    }).state, 'UNKNOWN');
  } finally {
    revoked.db.close();
  }
});

await testAsync('invalid protected rows and explicit scan limits return no partial data', async () => {
  const fixture = setup({ maxMessageScan: 5 });
  try {
    fixture.db.prepare(`UPDATE messages SET content = char(0) WHERE id = 1`).run();
    const invalid = await fixture.adapters.readConversationHistory(historyRequest(), trusted());
    assert.equal(invalid.error.code, 'REMOTE_CONVERSATION_READ_FAILED');
    assert.equal(Object.hasOwn(invalid, 'messages'), false);
  } finally {
    fixture.db.close();
  }

  const bounded = setup({ maxConversationScan: 2 });
  try {
    const result = await bounded.adapters.listConversations(listRequest({ limit: 10 }), trusted());
    assert.equal(result.error.code, 'REMOTE_CONVERSATION_SCAN_LIMIT');
    assert.equal(Object.hasOwn(result, 'items'), false);
  } finally {
    bounded.db.close();
  }
});

test('adapter and turn-correlation sources do not acquire transport or session authority', () => {
  const adapter = readFileSync(
    new URL('../src/remote/m7-conversation-core-adapters.js', import.meta.url),
    'utf8',
  );
  const controller = readFileSync(new URL('../src/chat/controller.js', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /(?:src\/(?:routes|server|network)|node:(?:http|https|net|tls))/u);
  assert.doesNotMatch(adapter, /CANDIDATE_NOT_ACCEPTED|remote-session-contract/u);
  assert.match(controller, /m7: \{ turnId: durableTurnId, status: 'ok' \}/u);
  assert.match(controller, /turnId: durableTurnId,[\s\S]{0,180}signal,/u);
});

summary();
