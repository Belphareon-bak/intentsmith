#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import Database from 'better-sqlite3';

import {
  MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
  validateMobileRemoteOperationPair,
} from '../docs/mobile/contracts/remote-capability-manifests-v1.js';
import { validateMobileRemotePayload } from '../docs/mobile/contracts/remote-capability-payloads-v1.js';
import { MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 } from '../docs/mobile/contracts/remote-capability-requirements-v1.js';
import { up as installJournal } from '../src/db/migrations/2026_08_29_101_m7_remote_operation_journal.js';
import { up as installOperationAbandonments } from '../src/db/migrations/2026_08_29_103_m7_operation_abandonments.js';
import {
  EXPECTED_M7_MANUAL_INFORMATION_FINGERPRINT_V102,
  computeM7ManualInformationFingerprintV102,
  up as installInformation,
} from '../src/db/migrations/2026_08_29_102_m7_manual_information.js';
import { createM7InProcessCapabilityProvider } from '../src/remote/m7-in-process-capability-provider.js';
import { createM7OperationJournal } from '../src/remote/m7-operation-journal.js';
import { createM7SettingsInformationCoreAdapters } from '../src/remote/m7-settings-information-core-adapters.js';
import { suite, summary, test, testAsync } from './harness.js';

const CURSOR_KEY = Buffer.alloc(32, 0x4d);

function trusted(overrides = {}) {
  return {
    deviceId: 'device:settings:001',
    subjectId: 'user:settings:001',
    ...overrides,
  };
}

function settingRead(overrides = {}) {
  return {
    contract: 'MobileSettingsQuery', version: 1,
    requestId: 'request:settings:read:001',
    ...overrides,
  };
}

function settingUpdate(revision, overrides = {}) {
  return {
    contract: 'MobileSettingUpdateCommand', version: 1,
    requestId: 'request:settings:update:001',
    operationId: 'operation:settings:update:001',
    key: 'appearance.theme', value: 'light', expectedRevision: revision,
    ...overrides,
  };
}

function informationList(overrides = {}) {
  return {
    contract: 'StoredInformationListQuery', version: 1,
    requestId: 'request:information:list:001', limit: 1,
    kinds: ['manual_note'], projectId: 7,
    ...overrides,
  };
}

function informationAppend(overrides = {}) {
  return {
    contract: 'StoredInformationAppendCommand', version: 1,
    requestId: 'request:information:append:001',
    operationId: 'operation:information:append:001',
    content: 'A manually approved project note.', projectId: 7, tags: ['mobile'],
    ...overrides,
  };
}

function setup({
  authorizeProject = async ({ projectId }) => projectId === 7,
  mediateMutation,
} = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE user_settings (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  installJournal(db);
  installOperationAbandonments(db);
  installInformation(db);
  let clock = Date.parse('2026-08-29T04:00:00.000Z');
  let mediationCalls = 0;
  const mediator = mediateMutation ?? (async intent => {
    mediationCalls += 1;
    assert.deepEqual(intent.authorityContracts, [
      'ApprovalGrant@1', 'EffectRequest@1', 'EffectResult@1',
    ]);
    return { state: 'executed', result: await intent.perform() };
  });
  const adapters = createM7SettingsInformationCoreAdapters({
    authorizeProject,
    cursorKey: CURSOR_KEY,
    database: db,
    mediateMutation: mediator,
    now: () => ++clock,
  });
  const journal = createM7OperationJournal(db, { clock: () => ++clock });
  const provider = createM7InProcessCapabilityProvider({
    authorityResolver: async input => ({
      decision: 'allow',
      deviceId: trusted().deviceId,
      subjectId: trusted().subjectId,
      grantedScopes: [...input.requiredScopes],
    }),
    handlers: adapters.handlers,
    manifests: MOBILE_REMOTE_CAPABILITY_MANIFESTS_V1,
    mutationJournal: journal,
    requirements: MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1,
    validateOperationPair: validateMobileRemoteOperationPair,
    validatePayload: validateMobileRemotePayload,
  });
  return { adapters, db, provider, mediationCalls: () => mediationCalls };
}

function invoke(provider, capabilityId, operationId, request) {
  return provider.invoke({ capabilityId, capabilityVersion: 1, operationId, request });
}

suite('M7 settings and stored-information core adapters');

await testAsync('settings expose only the fixed safe manifest and preserve unrelated bytes', async () => {
  const fixture = setup();
  try {
    fixture.db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run(JSON.stringify({
      appearance: { theme: 'dark', accentColor: '#secret-ish' },
      notifications: { smtpPassword: 'must-not-leak' },
      models: { autoFailoverEnabled: false },
    }));
    const snapshot = await invoke(fixture.provider, 'settings', 'settings.read', settingRead());
    assert.equal(snapshot.status, 'ok');
    assert.deepEqual(snapshot.items.map(item => item.key), [
      'appearance.density', 'appearance.fontSize', 'appearance.theme',
      'memory.saveContext', 'memory.saveHistory',
    ]);
    assert.equal(JSON.stringify(snapshot).includes('must-not-leak'), false);
    assert.equal(JSON.stringify(snapshot).includes('accentColor'), false);
    assert.equal(validateMobileRemotePayload('MobileSettingsSnapshot@1', snapshot).valid, true);

    const updated = await invoke(
      fixture.provider,
      'settings',
      'settings.update',
      settingUpdate(snapshot.revision),
    );
    assert.equal(updated.outcome, 'CONFIRMED');
    assert.equal(updated.value, 'light');
    assert.equal(fixture.mediationCalls(), 1);
    const persisted = JSON.parse(fixture.db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
    assert.equal(persisted.appearance.theme, 'light');
    assert.equal(persisted.appearance.accentColor, '#secret-ish');
    assert.equal(persisted.notifications.smtpPassword, 'must-not-leak');
    assert.equal(persisted.models.autoFailoverEnabled, false);
  } finally {
    fixture.db.close();
  }
});

await testAsync('setting filter, malformed storage, stale revision and invalid values fail closed', async () => {
  const fixture = setup();
  try {
    const filtered = await invoke(fixture.provider, 'settings', 'settings.read', settingRead({
      keys: ['appearance.theme'],
    }));
    assert.deepEqual(filtered.items.map(item => item.key), ['appearance.theme']);

    const unknown = await invoke(fixture.provider, 'settings', 'settings.read', settingRead({
      requestId: 'request:settings:unknown:001', keys: ['system.ollamaUrl'],
    }));
    assert.equal(unknown.status, 'error');
    assert.equal(unknown.error.code, 'REMOTE_SETTING_UNKNOWN');

    const stale = await invoke(fixture.provider, 'settings', 'settings.update', settingUpdate(
      'rev:settings:stale',
      { requestId: 'request:settings:stale:001', operationId: 'operation:settings:stale:001' },
    ));
    assert.equal(stale.outcome, 'REJECTED');
    assert.equal(stale.error.code, 'REMOTE_SETTING_STALE_REVISION');
    assert.equal(fixture.mediationCalls(), 0);

    const current = await invoke(fixture.provider, 'settings', 'settings.read', settingRead({
      requestId: 'request:settings:current:001',
    }));
    const invalid = await invoke(fixture.provider, 'settings', 'settings.update', settingUpdate(
      current.revision,
      { requestId: 'request:settings:invalid:001', operationId: 'operation:settings:invalid:001', value: 'neon' },
    ));
    assert.equal(invalid.outcome, 'REJECTED');
    assert.equal(invalid.error.code, 'REMOTE_SETTING_VALUE_INVALID');
    assert.equal(fixture.mediationCalls(), 0);

    fixture.db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)').run('{broken');
    const malformed = await invoke(fixture.provider, 'settings', 'settings.read', settingRead({
      requestId: 'request:settings:malformed:001',
    }));
    assert.equal(malformed.status, 'error');
    assert.equal(malformed.error.code, 'REMOTE_SETTINGS_READ_FAILED');
  } finally {
    fixture.db.close();
  }
});

await testAsync('pending or rejected mediation cannot write settings', async () => {
  for (const mediation of [
    async () => ({ state: 'pending', pendingApprovalId: 'approval:settings:001' }),
    async () => ({
      state: 'rejected',
      error: { code: 'APPROVAL_DENIED', message: 'The operator denied this change.', retryable: false },
    }),
  ]) {
    const fixture = setup({ mediateMutation: mediation });
    try {
      const before = await invoke(fixture.provider, 'settings', 'settings.read', settingRead());
      const result = await invoke(fixture.provider, 'settings', 'settings.update', settingUpdate(before.revision));
      assert(['PENDING', 'REJECTED'].includes(result.outcome));
      if (result.outcome === 'REJECTED') assert.equal(result.error.code, 'REMOTE_APPROVAL_DENIED');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM user_settings').get().count, 0);
    } finally {
      fixture.db.close();
    }
  }
});

await testAsync('manual append is mediated, subject/project scoped, durable and exactly replayed', async () => {
  const fixture = setup();
  try {
    const first = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.append',
      informationAppend(),
    );
    assert.equal(first.outcome, 'CONFIRMED');
    assert.equal(first.replayed, false);
    const replay = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.append',
      informationAppend(),
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.informationId, first.informationId);
    assert.equal(fixture.mediationCalls(), 1);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM m7_manual_information').get().count, 1);

    const page = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.list',
      informationList(),
    );
    assert.equal(page.status, 'ok');
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].informationId, first.informationId);
    assert.equal(page.items[0].projectId, 7);
    assert.equal(page.items[0].kind, 'manual_note');
    assert.equal(page.items[0].content, informationAppend().content);
    assert.equal(validateMobileRemotePayload('StoredInformationPage@1', page).valid, true);

    const crossSubjectAdapters = createM7SettingsInformationCoreAdapters({
      authorizeProject: async () => true,
      cursorKey: CURSOR_KEY,
      database: fixture.db,
      mediateMutation: async intent => ({ state: 'executed', result: await intent.perform() }),
    });
    const crossSubject = await crossSubjectAdapters.listInformation(
      informationList(), trusted({ subjectId: 'user:settings:other' }),
    );
    assert.equal(crossSubject.status, 'ok');
    assert.equal(crossSubject.items.length, 0);
  } finally {
    fixture.db.close();
  }
});

await testAsync('project denial and revocation happen before protected bytes are returned or written', async () => {
  let calls = 0;
  const denied = setup({ authorizeProject: async () => false });
  try {
    const append = await invoke(
      denied.provider, 'stored_information', 'stored-information.append', informationAppend(),
    );
    assert.equal(append.outcome, 'REJECTED');
    assert.equal(append.error.code, 'REMOTE_STORED_INFORMATION_ACCESS_DENIED');
    assert.equal(denied.mediationCalls(), 0);
    assert.equal(denied.db.prepare('SELECT COUNT(*) AS count FROM m7_manual_information').get().count, 0);
    const page = await invoke(
      denied.provider, 'stored_information', 'stored-information.list', informationList(),
    );
    assert.equal(page.status, 'error');
    assert.equal(page.error.code, 'REMOTE_STORED_INFORMATION_ACCESS_DENIED');
  } finally {
    denied.db.close();
  }

  const revoked = setup({ authorizeProject: async () => ++calls === 1 });
  try {
    await assert.rejects(
      () => invoke(revoked.provider, 'stored_information', 'stored-information.append', informationAppend()),
      error => error.code === 'M7_OPERATION_OUTCOME_UNKNOWN',
    );
    assert.equal(revoked.db.prepare('SELECT COUNT(*) AS count FROM m7_manual_information').get().count, 0);
  } finally {
    revoked.db.close();
  }
});

await testAsync('information cursor binds subject, filter and complete snapshot', async () => {
  const fixture = setup();
  try {
    await invoke(fixture.provider, 'stored_information', 'stored-information.append', informationAppend());
    await invoke(fixture.provider, 'stored_information', 'stored-information.append', informationAppend({
      requestId: 'request:information:append:002',
      operationId: 'operation:information:append:002',
      content: 'A second note.',
    }));
    const first = await invoke(
      fixture.provider, 'stored_information', 'stored-information.list', informationList(),
    );
    assert.equal(first.end, false);
    assert.equal(typeof first.nextCursor, 'string');
    const second = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.list',
      informationList({ requestId: 'request:information:list:002', cursor: first.nextCursor }),
    );
    assert.equal(second.items.length, 1);
    assert.equal(second.end, true);

    const wrongFilter = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.list',
      informationList({ requestId: 'request:information:list:003', cursor: first.nextCursor, limit: 2 }),
    );
    assert.equal(wrongFilter.status, 'error');
    assert.equal(wrongFilter.error.code, 'REMOTE_STORED_INFORMATION_CURSOR_INVALID');

    await invoke(fixture.provider, 'stored_information', 'stored-information.append', informationAppend({
      requestId: 'request:information:append:003',
      operationId: 'operation:information:append:003',
      content: 'A snapshot-changing note.',
    }));
    const stale = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.list',
      informationList({ requestId: 'request:information:list:004', cursor: first.nextCursor }),
    );
    assert.equal(stale.status, 'error');
    assert.equal(stale.error.code, 'REMOTE_STORED_INFORMATION_CURSOR_STALE');
  } finally {
    fixture.db.close();
  }
});

await testAsync('legacy memory kinds are explicitly unavailable instead of false-empty', async () => {
  const fixture = setup();
  try {
    const result = await invoke(
      fixture.provider,
      'stored_information',
      'stored-information.list',
      informationList({ kinds: ['long_term_memory'] }),
    );
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'REMOTE_INFORMATION_KIND_UNAVAILABLE');
  } finally {
    fixture.db.close();
  }
});

await testAsync('structurally forged protected bytes become a typed read failure', async () => {
  const fixture = setup();
  try {
    fixture.db.prepare(`
      INSERT INTO m7_manual_information (
        information_id, subject_id, project_id, operation_id,
        content, summary, tags_json, created_at_ms
      ) VALUES (?, ?, 7, ?, ?, ?, '[]', ?)
    `).run(
      'information:forged', trusted().subjectId, 'operation:forged',
      'hidden\u0001control', 'forged', Date.parse('2026-08-29T04:00:00.000Z'),
    );
    const result = await invoke(
      fixture.provider, 'stored_information', 'stored-information.list', informationList(),
    );
    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'REMOTE_STORED_INFORMATION_READ_FAILED');
  } finally {
    fixture.db.close();
  }
});

test('schema is fingerprinted and manual information is append-only', () => {
  const db = new Database(':memory:');
  try {
    installInformation(db);
    assert.equal(
      computeM7ManualInformationFingerprintV102(db),
      EXPECTED_M7_MANUAL_INFORMATION_FINGERPRINT_V102,
    );
    db.prepare(`
      INSERT INTO m7_manual_information (
        information_id, subject_id, project_id, operation_id,
        content, summary, tags_json, created_at_ms
      ) VALUES ('information:001', 'user:001', 7, 'operation:001', 'note', 'note', '[]', 1)
    `).run();
    assert.throws(
      () => db.prepare("UPDATE m7_manual_information SET content = 'changed'").run(),
      /append-only/u,
    );
    assert.throws(
      () => db.prepare('DELETE FROM m7_manual_information').run(),
      /append-only/u,
    );
  } finally {
    db.close();
  }
});

test('adapter imports no route, server, DB singleton, transport or legacy memory writer', () => {
  const source = readFileSync(
    new URL('../src/remote/m7-settings-information-core-adapters.js', import.meta.url),
    'utf8',
  );
  for (const token of [
    '/routes/', '/server', '/db/database', 'better-sqlite3',
    'node:http', 'node:https', 'node:net', 'node:tls', 'listen(', 'fetch(',
    '/memory/long-term', '/memory/task-memory',
  ]) assert.equal(source.includes(token), false, token);
});

summary();
