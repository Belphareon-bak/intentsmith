#!/usr/bin/env node
//
// Decision 020/E — model automation policy has its own storage.
//
// The point of the separate table is that the five live writers over the shared
// settings blob cannot enable, disable or lose the policy. These are the
// mandatory negative proofs of the decision.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// Byte-identical accepted migration: 905a3422fa0a01f3f1c4656f914ee26a696549a8.
import { up as installPolicy061 } from './fixtures/model-policy-061.js';
import { up as installPolicy066 } from '../src/db/migrations/2026_08_22_066_model_automation_policy.js';
import { up as repairPolicy081 } from '../src/db/migrations/2026_08_24_081_model_policy_trigger_compatibility.js';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  DEFAULT_MODEL_AUTOMATION_POLICY,
  ModelPolicyStatus,
  POLICY_SOURCE,
  readModelAutomationPolicy,
  resetModelAutomationPolicy,
  stripReservedAutomationKeys,
  updateModelAutomationPolicy,
} from '../src/db/model-policy.js';

async function withDb(callback, { legacySettings = null } = {}) {
  const db = new Database(':memory:');
  try {
    if (legacySettings) {
      // The legacy row must exist before the migration runs, exactly like an
      // upgrade on a machine that already had the old opt-in written.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
          id INTEGER PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.prepare('INSERT INTO user_settings (id, data) VALUES (1, ?)')
        .run(JSON.stringify(legacySettings));
    }
    await runMigrations(db);
    return await callback(db);
  } finally {
    db.close();
  }
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('expected callback to throw');
}

function eventCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM model_automation_policy_events').get().n;
}

async function miscRoutes(db, { onFeatureSettings } = {}) {
  const { createMiscRoutes } = await import('../src/routes/misc.js');
  const responses = [];
  let requestBody = {};
  const routes = createMiscRoutes({
    db: { db },
    parseBody: async () => requestBody,
    sendJSON: (_res, status, body) => { responses.push({ status, body }); },
    safeError: error => ({ error: error.message }),
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    callWithAuth: async () => ({}),
    createAuthToken: () => '',
    LLMCallerRole: {},
  });
  const { featureManager } = await import('../src/core/feature-manager.js');
  const originalApply = featureManager.applySettings.bind(featureManager);
  featureManager.applySettings = (settings) => {
    onFeatureSettings?.(settings);
    return 0;
  };
  return {
    routes,
    responses,
    setBody: value => { requestBody = value; },
    restore: () => { featureManager.applySettings = originalApply; },
  };
}

suite('M1 model automation policy — decision 020/E separate storage');

await testAsync('the migration starts default-off and never promotes a legacy opt-in', async () => {
  await withDb(async (db) => {
    const state = readModelAutomationPolicy(db);
    assertEqual(state.status, ModelPolicyStatus.VALID);
    assertEqual(state.policy.autoFailoverEnabled, false, 'a legacy true is not an opt-in');
    assertEqual(state.revision, 1);

    // The old value is kept as evidence, not as authority.
    const genesis = db.prepare(
      'SELECT quarantined_legacy, source FROM model_automation_policy_events WHERE revision = 1',
    ).get();
    assertEqual(genesis.source, 'GENESIS');
    assert(
      genesis.quarantined_legacy.includes('"autoFailoverEnabled":true'),
      'the quarantined legacy value stays visible to the operator',
    );
  }, { legacySettings: { models: { autoFailoverEnabled: true, autoCleanupDays: 30 } } });
});

await testAsync('a generic settings POST cannot enable the policy', async () => {
  await withDb(async (db) => {
    const seen = [];
    const harness = await miscRoutes(db, { onFeatureSettings: s => seen.push(s) });
    try {
      harness.setBody({ models: { autoFailoverEnabled: true, foreignKey: 'keep-me' }, theme: 'dark' });
      await harness.routes['POST /api/settings']({}, {});

      const response = harness.responses.at(-1);
      assertEqual(response.status, 200, 'the save still succeeds — drop, not reject');
      assertEqual(
        JSON.stringify(response.body.ignoredReservedKeys),
        JSON.stringify(['autoFailoverEnabled']),
        'the drop is never silent',
      );
      assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, false);
      assertEqual(eventCount(db), 1, 'no policy event was written');

      const stored = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
      assertEqual(stored.models.foreignKey, 'keep-me', 'foreign keys inside models survive');
      assertEqual('autoFailoverEnabled' in stored.models, false, 'the owned key was not stored');
      assertEqual(stored.theme, 'dark');

      // The runtime must not see it either.
      assertEqual('autoFailoverEnabled' in (seen.at(-1).models || {}), false,
        'featureManager never receives the unsanitized body');
    } finally {
      harness.restore();
    }
  });
});

await testAsync('a generic GET never emits the owned keys', async () => {
  await withDb(async (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY, data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)
    `);
    db.prepare('INSERT OR REPLACE INTO user_settings (id, data) VALUES (1, ?)')
      .run(JSON.stringify({ models: { autoFailoverEnabled: true, keep: 1 } }));
    const harness = await miscRoutes(db);
    try {
      await harness.routes['GET /api/settings']({}, {});
      const body = harness.responses.at(-1).body;
      assertEqual('autoFailoverEnabled' in body.models, false,
        'the client has nothing to post back');
      assertEqual(body.models.keep, 1);
    } finally {
      harness.restore();
    }
  });
});

await testAsync('an empty generic POST does not reset the policy', async () => {
  await withDb(async (db) => {
    updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true },
      expectedRevision: 1,
      actor: 'user:test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const harness = await miscRoutes(db);
    try {
      // This is the live "Obnovit výchozí" payload.
      harness.setBody({});
      await harness.routes['POST /api/settings']({}, {});
      assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, true,
        'a stale or empty snapshot cannot turn the policy off');
      assertEqual(eventCount(db), 2);
    } finally {
      harness.restore();
    }
  });
});

await testAsync('invalid values fail without mutating anything', async () => {
  await withDb(async (db) => {
    const before = readModelAutomationPolicy(db);
    const rejected = [
      { autoFailoverEnabled: 'true' },
      { autoFailoverEnabled: 1 },
      { autoCleanupDays: 0 },
      { autoCleanupDays: 3651 },
      { autoCleanupDays: 1.5 },
      { unknownKey: true },
    ];
    for (const values of rejected) {
      const error = captureError(() => updateModelAutomationPolicy(db, {
        values,
        expectedRevision: 1,
        actor: 'user:test',
        source: POLICY_SOURCE.TYPED_ROUTE,
      }));
      assertEqual(error.code, 'MODEL_POLICY_INPUT_INVALID', JSON.stringify(values));
      assertEqual(error.httpStatus, 400);
    }
    assertEqual(eventCount(db), 1, 'no event was appended');
    assertEqual(JSON.stringify(readModelAutomationPolicy(db)), JSON.stringify(before));
  });
});

await testAsync('a stale revision loses and only one concurrent writer wins', async () => {
  await withDb(async (db) => {
    const first = updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true },
      expectedRevision: 1,
      actor: 'user:first',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    assertEqual(first.revision, 2);

    const conflict = captureError(() => updateModelAutomationPolicy(db, {
      values: { autoCleanupEnabled: true },
      expectedRevision: 1,
      actor: 'user:second',
      source: POLICY_SOURCE.TYPED_ROUTE,
    }));
    assertEqual(conflict.code, 'MODEL_POLICY_REVISION_CONFLICT');
    assertEqual(conflict.httpStatus, 409);
    assertEqual(readModelAutomationPolicy(db).policy.autoCleanupEnabled, false);
    assertEqual(eventCount(db), 2, 'the loser wrote nothing');
  });
});

await testAsync('a projection that does not match its event is not trusted', async () => {
  await withDb(async (db) => {
    updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true },
      expectedRevision: 1,
      actor: 'user:test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, true);

    // Simulate tampering or corruption of the projection only. The trigger
    // guards inserts and updates through SQL, so the row is rewritten with the
    // guard temporarily out of the way — the reader must still refuse it.
    db.exec('DROP TRIGGER trg_model_automation_policy_projection_event_update');
    db.prepare('UPDATE model_automation_policy SET revision = revision + 1 WHERE id = 1').run();

    const state = readModelAutomationPolicy(db);
    assertEqual(state.status, ModelPolicyStatus.EVENT_MISMATCH);
    assertEqual(state.valid, false);
    assertEqual(state.policy.autoFailoverEnabled, false, 'unreadable storage means off');
  });
});

await testAsync('policy events are append-only', async () => {
  await withDb(async (db) => {
    const update = captureError(() => db.prepare(
      'UPDATE model_automation_policy_events SET actor = ? WHERE revision = 1',
    ).run('user:forged'));
    assert(/append-only/.test(update.message), update.message);

    const remove = captureError(() => db.prepare(
      'DELETE FROM model_automation_policy_events WHERE revision = 1',
    ).run());
    assert(/append-only/.test(remove.message), remove.message);
  });
});

await testAsync('an explicit reset writes exactly one audited transition to off', async () => {
  await withDb(async (db) => {
    updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true, autoCleanupEnabled: true },
      expectedRevision: 1,
      actor: 'user:test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const harness = await miscRoutes(db);
    try {
      await harness.routes['POST /api/reset']({}, {});
      assertEqual(harness.responses.at(-1).status, 200);
    } finally {
      harness.restore();
    }

    const state = readModelAutomationPolicy(db);
    assertEqual(state.policy.autoFailoverEnabled, false);
    assertEqual(state.policy.autoCleanupEnabled, false);
    assertEqual(state.revision, 3);
    assertEqual(eventCount(db), 3, 'exactly one transition, not a deletion');
    const last = db.prepare(
      'SELECT source, actor FROM model_automation_policy_events WHERE revision = 3',
    ).get();
    assertEqual(last.source, 'EXPLICIT_RESET');
    assertEqual(last.actor, 'user:explicit-reset');
  });
});

await testAsync('a failed explicit import rolls back settings and policy together', async () => {
  await withDb(async (db) => {
    const harness = await miscRoutes(db);
    try {
      const before = JSON.stringify(readModelAutomationPolicy(db));
      harness.setBody({
        version: 1,
        settings: { theme: 'dark' },
        policy: { autoCleanupDays: 0 },  // invalid — the whole import must fail
      });
      await harness.routes['POST /api/settings/import']({}, {});

      const response = harness.responses.at(-1);
      assertEqual(response.status, 400, 'a failed import is an error, not a silent success');
      assertEqual(JSON.stringify(readModelAutomationPolicy(db)), before);
      const row = db.prepare('SELECT data FROM user_settings WHERE id = 1').get();
      assertEqual(row, undefined, 'the general settings half was rolled back too');
    } finally {
      harness.restore();
    }
  });
});

await testAsync('an explicit import applies both halves atomically', async () => {
  await withDb(async (db) => {
    const harness = await miscRoutes(db);
    try {
      harness.setBody({
        version: 1,
        settings: { theme: 'dark', models: { autoFailoverEnabled: true, keep: 2 } },
        policy: { autoFailoverEnabled: true, autoCleanupDays: 30 },
      });
      await harness.routes['POST /api/settings/import']({}, {});

      assertEqual(harness.responses.at(-1).status, 200);
      const state = readModelAutomationPolicy(db);
      assertEqual(state.policy.autoFailoverEnabled, true, 'the explicit adapter may carry policy');
      assertEqual(state.policy.autoCleanupDays, 30);

      const stored = JSON.parse(db.prepare('SELECT data FROM user_settings WHERE id = 1').get().data);
      assertEqual('autoFailoverEnabled' in stored.models, false,
        'even here the blob never stores the owned key');
      assertEqual(stored.models.keep, 2);
      const event = db.prepare(
        'SELECT source FROM model_automation_policy_events WHERE revision = 2',
      ).get();
      assertEqual(event.source, 'EXPLICIT_IMPORT');
    } finally {
      harness.restore();
    }
  });
});

await testAsync('policy, revision and lineage survive a restart', async () => {
  const file = new URL('./fixtures/policy-restart.sqlite', import.meta.url).pathname;
  const fs = await import('node:fs');
  fs.rmSync(file, { force: true });
  try {
    const first = new Database(file);
    await runMigrations(first);
    updateModelAutomationPolicy(first, {
      values: { autoFailoverEnabled: true, autoCleanupDays: 21 },
      expectedRevision: 1,
      actor: 'user:test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const before = readModelAutomationPolicy(first);
    first.close();

    const second = new Database(file);
    const after = readModelAutomationPolicy(second);
    assertEqual(after.revision, before.revision);
    assertEqual(after.lastEventId, before.lastEventId);
    assertEqual(after.policy.autoFailoverEnabled, true);
    assertEqual(after.policy.autoCleanupDays, 21);
    assertEqual(eventCount(second), 2, 'the event lineage is intact');
    second.close();
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('the reserved key filter preserves everything it does not own', () => {
  const result = stripReservedAutomationKeys({
    models: { autoFailoverEnabled: true, autoCleanupEnabled: false, futureKey: 'x' },
    other: { untouched: true },
  });
  assertEqual(
    JSON.stringify(result.ignoredReservedKeys),
    JSON.stringify(['autoFailoverEnabled', 'autoCleanupEnabled']),
  );
  assertEqual(JSON.stringify(result.settings.models), JSON.stringify({ futureKey: 'x' }));
  assertEqual(result.settings.other.untouched, true);

  // A document without `models` is returned untouched.
  const untouched = stripReservedAutomationKeys({ theme: 'dark' });
  assertEqual(JSON.stringify(untouched.settings), JSON.stringify({ theme: 'dark' }));
  assertEqual(untouched.ignoredReservedKeys.length, 0);
});

test('the default policy is off', () => {
  assertEqual(DEFAULT_MODEL_AUTOMATION_POLICY.autoFailoverEnabled, false);
  assertEqual(DEFAULT_MODEL_AUTOMATION_POLICY.autoCleanupEnabled, false);
});

await testAsync('the failover coordinator reads only this authority', async () => {
  await withDb(async (db) => {
    // A legacy true inside the settings blob must not enable the coordinator.
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY, data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)
    `);
    db.prepare('INSERT OR REPLACE INTO user_settings (id, data) VALUES (1, ?)')
      .run(JSON.stringify({ models: { autoFailoverEnabled: true } }));

    const { createModelFailoverRepository } = await import('../src/upgrade/model-failover.js');
    const repository = createModelFailoverRepository(db, {});
    const error = captureError(() => repository.recordDetection({
      role: 'CHAT',
      expectedDesiredRevision: 1,
      requireAutoFailoverEnabled: true,
    }));
    assertEqual(error.code, 'MODEL_FAILOVER_AUTO_FAILOVER_DISABLED');

    // And with the real authority on, the same call gets past the policy gate.
    updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true },
      expectedRevision: 1,
      actor: 'user:test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const next = captureError(() => repository.recordDetection({
      role: 'CHAT',
      expectedDesiredRevision: 1,
      requireAutoFailoverEnabled: true,
    }));
    assert(
      next.code !== 'MODEL_FAILOVER_AUTO_FAILOVER_DISABLED',
      `policy gate still blocked: ${next.code}`,
    );
  });
});

test('the Studio backup surface no longer treats a failure as success', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(
    new URL('../c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js', import.meta.url),
    'utf8',
  );
  const start = source.indexOf("'Zálohujte svá nastavení");
  const end = source.indexOf('/* v91: Feature Flags panel */', start);
  assert(start >= 0 && end > start, 'the backup panel is present');
  const panel = source.slice(start, end);

  // Import goes through the explicit versioned adapter and checks the status.
  assert(/\/api\/settings\/import/.test(panel), 'import uses the explicit adapter');
  assert(/version:1,settings:data/.test(panel), 'import declares its version');
  // Reset goes through the audited path.
  assert(/\/api\/reset/.test(panel), 'reset uses the audited path');
  assertEqual(
    (panel.match(/if\(!r\.ok\)throw new Error/g) || []).length,
    2,
    'both import and reset check response.ok',
  );
});


suite('M1 model automation policy — preserved 061 upgrade authority');

async function withPolicy061(callback) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    db.exec('CREATE TABLE user_settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT)');
    db.prepare('INSERT INTO user_settings VALUES (1, ?, NULL)').run(JSON.stringify({
      models: { autoFailoverEnabled: true, futureKey: 'preserve' }, theme: 'dark',
    }));
    db.transaction(() => installPolicy061(db))();
    const events = JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all());
    // Reproduce the real 066 collision and its supported 081 repair, including
    // the original 061 constraints and trigger SQL rather than a schema mock.
    installPolicy066(db);
    repairPolicy081(db);
    assertEqual(JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all()), events);
    await runMigrations(db);
    assertEqual(JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all()), events);
    return await callback(db);
  } finally {
    db.close();
  }
}

function policyRows(db) {
  return JSON.stringify({
    policy: db.prepare('SELECT * FROM model_automation_policy ORDER BY id').all(),
    events: db.prepare('SELECT * FROM model_automation_policy_events ORDER BY seq').all(),
  });
}

await testAsync('the accepted 061 schema remains readable after the complete current upgrade', async () => {
  const historical = readFileSync(new URL('./fixtures/model-policy-061.js', import.meta.url));
  assertEqual(createHash('sha256').update(historical).digest('hex'), 'c6438611c6f78549991cd18221b71e285139345016f4ad40b94b971bed4ee612');
  await withPolicy061(async db => {
    const state = readModelAutomationPolicy(db);
    assertEqual(state.status, ModelPolicyStatus.VALID);
    assertEqual(state.revision, 1);
    assertEqual(state.policy.autoFailoverEnabled, false);
    assertEqual(state.lastEventId, 'policy-event-migration-061');
    const genesis = db.prepare('SELECT * FROM model_automation_policy_events').get();
    assertEqual(genesis.source, 'MIGRATION');
    assert(genesis.legacy_quarantine_json.includes('"autoFailoverEnabled":true'));
    const settings = JSON.parse(db.prepare('SELECT data FROM user_settings').get().data);
    assertEqual(settings.models.futureKey, 'preserve');
    assertEqual(Object.hasOwn(settings.models, 'autoFailoverEnabled'), false);
  });
});

await testAsync('061 typed writes preserve history and append exact source, revision and before/after lineage', async () => {
  await withPolicy061(async db => {
    const genesis = JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events').get());
    for (const [source, eventKind, storedSource, values] of [
      [POLICY_SOURCE.TYPED_ROUTE, 'USER_UPDATE', 'TYPED_API', { autoFailoverEnabled: true }],
      [POLICY_SOURCE.EXPLICIT_IMPORT, 'BACKUP_IMPORT', 'SETTINGS_IMPORT', { autoCleanupDays: 30 }],
      [POLICY_SOURCE.EXPLICIT_RESET, 'GLOBAL_RESET', 'GLOBAL_RESET', { ...DEFAULT_MODEL_AUTOMATION_POLICY }],
    ]) {
      const before = readModelAutomationPolicy(db);
      const result = updateModelAutomationPolicy(db, { values, expectedRevision: before.revision, actor: 'user:upgrade-test', source });
      const after = readModelAutomationPolicy(db);
      const event = db.prepare('SELECT * FROM model_automation_policy_events WHERE event_id = ?').get(result.eventId);
      const projection = db.prepare('SELECT * FROM model_automation_policy').get();
      assertEqual(after.status, ModelPolicyStatus.VALID);
      assertEqual(after.revision, before.revision + 1);
      assertEqual(event.previous_revision, before.revision);
      assertEqual(event.committed_revision, after.revision);
      assertEqual(event.event_kind, eventKind);
      assertEqual(event.source, storedSource);
      assertEqual(event.actor, 'user:upgrade-test');
      assertEqual(event.schema_version, 1);
      assertEqual(event.legacy_quarantine_json, null);
      assertEqual(event.created_at_ms, projection.updated_at_ms);
      assertEqual(event.before_auto_failover_enabled, before.policy.autoFailoverEnabled ? 1 : 0);
      assertEqual(event.before_auto_cleanup_days, before.policy.autoCleanupDays);
      assertEqual(event.after_auto_cleanup_days, after.policy.autoCleanupDays);
      assertEqual(event.after_auto_failover_enabled, after.policy.autoFailoverEnabled ? 1 : 0);
    }
    assertEqual(eventCount(db), 4);
    assertEqual(JSON.stringify(db.prepare('SELECT * FROM model_automation_policy_events WHERE committed_revision = 1').get()), genesis);
    assertEqual(db.prepare('SELECT COUNT(DISTINCT request_id) AS n FROM model_automation_policy_events').get().n, 4);
    assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, false);
  });
});

await testAsync('061 rejects stale revisions and authority overrides before changing history', async () => {
  await withPolicy061(async db => {
    const input = { values: { autoFailoverEnabled: true }, expectedRevision: 1, actor: 'user:first', source: POLICY_SOURCE.TYPED_ROUTE };
    updateModelAutomationPolicy(db, input);
    const before = policyRows(db);
    assertEqual(captureError(() => updateModelAutomationPolicy(db, input)).code, 'MODEL_POLICY_REVISION_CONFLICT');
    for (const changed of [
      { actor: 'system:forged' }, { actor: 'user:bad actor' }, { source: 'MIGRATION' },
      { eventKind: 'MIGRATION_DEFAULT_OFF' }, { requestId: 'caller-owned-request' },
    ]) {
      const error = captureError(() => updateModelAutomationPolicy(db, { ...input, expectedRevision: 2, ...changed }));
      assertEqual(error.code, 'MODEL_POLICY_INPUT_INVALID');
    }
    assertEqual(policyRows(db), before);
  });
});

await testAsync('061 rolls back its projection when the append-only event cannot commit', async () => {
  await withPolicy061(async db => {
    const before = policyRows(db);
    db.exec(`CREATE TRIGGER fail_policy_test_append BEFORE INSERT ON model_automation_policy_events
      WHEN NEW.event_kind = 'USER_UPDATE' BEGIN SELECT RAISE(ABORT, 'TEST_EVENT_STORAGE_FAILURE'); END`);
    const error = captureError(() => updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true }, expectedRevision: 1, actor: 'user:test', source: POLICY_SOURCE.TYPED_ROUTE,
    }));
    assert(error.message.includes('TEST_EVENT_STORAGE_FAILURE'));
    assertEqual(policyRows(db), before);
    assertEqual(readModelAutomationPolicy(db).status, ModelPolicyStatus.VALID);
    assertEqual(db.pragma('foreign_key_check').length, 0);
  });
});

await testAsync('061 retains atomic explicit import and global reset through the existing routes', async () => {
  await withPolicy061(async db => {
    const harness = await miscRoutes(db);
    try {
      const before = policyRows(db);
      harness.setBody({ version: 1, settings: { theme: 'invalid-import' }, policy: { autoCleanupDays: 0 } });
      await harness.routes['POST /api/settings/import']({}, {});
      assertEqual(harness.responses.at(-1).status, 400);
      assertEqual(policyRows(db), before);
      assertEqual(JSON.parse(db.prepare('SELECT data FROM user_settings').get().data).theme, 'dark');
      harness.setBody({ version: 1, settings: { theme: 'light', models: { autoFailoverEnabled: true, keep: 2 } }, policy: { autoFailoverEnabled: true } });
      await harness.routes['POST /api/settings/import']({}, {});
      assertEqual(harness.responses.at(-1).status, 200);
      assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, true);
      assertEqual(db.prepare('SELECT source FROM model_automation_policy_events WHERE committed_revision = 2').get().source, 'SETTINGS_IMPORT');
      await harness.routes['POST /api/reset']({}, {});
      assertEqual(harness.responses.at(-1).status, 200);
      assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, false);
      assertEqual(readModelAutomationPolicy(db).revision, 3);
      assertEqual(db.prepare('SELECT source FROM model_automation_policy_events WHERE committed_revision = 3').get().source, 'GLOBAL_RESET');
    } finally { harness.restore(); }
  });
});

await testAsync('061 refuses a mismatched event timestamp and cannot write from that invalid state', async () => {
  await withPolicy061(async db => {
    // Simulate corrupted projection bytes after bypassing its update guard.
    db.exec('DROP TRIGGER trg_model_automation_projection_revision; DROP TRIGGER trg_model_automation_projection_new_event');
    db.prepare('UPDATE model_automation_policy SET updated_at_ms = updated_at_ms + 1').run();
    assertEqual(readModelAutomationPolicy(db).status, ModelPolicyStatus.EVENT_MISMATCH);
    assertEqual(readModelAutomationPolicy(db).policy.autoFailoverEnabled, false);
    const before = policyRows(db);
    const error = captureError(() => updateModelAutomationPolicy(db, { values: { autoFailoverEnabled: true }, actor: 'user:test', source: POLICY_SOURCE.TYPED_ROUTE }));
    assertEqual(error.code, 'MODEL_POLICY_STATE_INVALID');
    assertEqual(policyRows(db), before);
  });
});

await testAsync('unknown extensions of either policy schema fail closed without a compatibility write', async () => {
  for (const withSchema of [withDb, withPolicy061]) {
    await withSchema(async db => {
      db.exec('ALTER TABLE model_automation_policy_events ADD COLUMN unknown_authority TEXT');
      const before = policyRows(db);
      const state = readModelAutomationPolicy(db);
      assertEqual(state.status, ModelPolicyStatus.DB_ERROR);
      assertEqual(state.reason, 'MODEL_POLICY_SCHEMA_UNSUPPORTED');
      assertEqual(state.policy.autoFailoverEnabled, false);
      const error = captureError(() => updateModelAutomationPolicy(db, { values: { autoFailoverEnabled: true }, actor: 'user:test', source: POLICY_SOURCE.TYPED_ROUTE }));
      assertEqual(error.code, 'MODEL_POLICY_STATE_INVALID');
      assertEqual(policyRows(db), before);
    });
  }
});

summary();
