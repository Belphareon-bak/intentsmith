#!/usr/bin/env node
// The mobile inbox is reachable from the production router — F-111.
// ==============================================================================
//
// `F-111` is the gap between "the mobile inbox exists" and "anything can put
// something in it".  Every part was built: `mobile_notifications` (migration
// 055), per-device receipts (058), `MobileChannel`, and the read/ack routes —
// and `createNotificationRouter()` registered email, telegram and push, so
// `router.send({ channel: 'mobile', … })` returned
// *"Channel 'mobile' not registered"*.
//
// That is worse than a channel that does nothing, because the read side works
// perfectly: `GET /m1/notifications` answers `200` with an empty list, and an
// empty inbox is indistinguishable from a quiet one.  The phone would have
// shown "nic nečeká" forever.
//
// **What this suite does not claim.**  Registration makes the channel
// *reachable*; it does not make anything *route* there.  Nothing in the
// codebase emits `channel: 'mobile'`, so ordinary emission still writes no row
// — that second half is the policy-controlled companion mirror (`DR-013 A`),
// which decides *which* notifications may reach a phone and at what
// sensitivity.  The last test here pins that gap open so it cannot be mistaken
// for finished work.
//
// ==============================================================================

import './helpers/isolated-test-db.js';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { createNotificationRouter } from '../src/notifications/index.js';
import { MOBILE_NOTIFICATION_CHANNEL } from '../src/notifications/channels/mobile.js';
import { runMigrations } from '../src/db/migrate.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

const root = mkdtempSync(path.join(tmpdir(), 'mobile-wiring-'));
const db = new Database(path.join(root, 'test.db'));
db.pragma('journal_mode = WAL');
await runMigrations(db);          // async — awaiting it is what creates the tables

console.log('\n=== Mobile inbox wiring (F-111) ===');

await test('the production router registers the mobile channel', () => {
  const router = createNotificationRouter({ db });
  assert.ok(
    router.channels.has(MOBILE_NOTIFICATION_CHANNEL),
    `the mobile channel is absent; available: ${router.getAvailableChannels().join(', ')}`,
  );
});

await test('a mobile notification reaches the inbox instead of an error', async () => {
  const router = createNotificationRouter({ db });
  const before = db.prepare('SELECT COUNT(*) AS n FROM mobile_notifications').get().n;

  const result = await router.send({
    channel: MOBILE_NOTIFICATION_CHANNEL,
    title: 'Approval čeká',
    body: 'Zapsat soubor do repozitáře',
    priority: 'high',
    agentId: 'agent-1',
  });

  assert.equal(result.delivered, true, result.error || 'not delivered');
  const after = db.prepare('SELECT COUNT(*) AS n FROM mobile_notifications').get().n;
  assert.equal(after, before + 1, 'no row was written to the inbox');
});

await test('registration is additive — the other channels still dispatch as before', async () => {
  const router = createNotificationRouter({ db });
  for (const name of ['email', 'telegram', 'push']) {
    assert.ok(router.channels.has(name), `${name} disappeared from the router`);
  }
  // `in_app` never reaches a channel at all; it must stay that way.
  const before = db.prepare('SELECT COUNT(*) AS n FROM mobile_notifications').get().n;
  const result = await router.send({ channel: 'in_app', title: 'x', body: 'y', agentId: 'a' });
  assert.equal(result.delivered, true);
  assert.equal(result.channel, 'in_app');
  const after = db.prepare('SELECT COUNT(*) AS n FROM mobile_notifications').get().n;
  assert.equal(after, before, 'an in_app notification leaked into the mobile inbox');
});

await test('a router built without a database reports it instead of throwing', async () => {
  const router = createNotificationRouter({});
  assert.ok(router.channels.has(MOBILE_NOTIFICATION_CHANNEL), 'the channel must still be registered');
  const result = await router.send({
    channel: MOBILE_NOTIFICATION_CHANNEL, title: 't', body: 'b', agentId: 'a',
  });
  assert.equal(result.delivered, false);
  assert.match(String(result.error), /database/i, 'the reason must name the missing database');
});

await test('F-111 second half is still open: nothing routes to the inbox on its own', async () => {
  // A real assertion, not a note.  Registration made the channel *reachable*;
  // it did not make anything route there.  `DR-013 A` — the policy-controlled
  // companion mirror — is what decides which notifications may reach a phone
  // and at what sensitivity, and it does not exist yet.
  //
  // This scans the source for an emitter.  When one appears, this test fails
  // on purpose: whoever adds routing must also retire the open half of F-111
  // rather than leave the record saying it is still open.
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const srcRoot = new URL('../src/', import.meta.url).pathname;
  const walk = (dir) => readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const emitters = walk(srcRoot)
    .filter(file => file.endsWith('.js') && !file.endsWith('channels/mobile.js'))
    .filter(file => /channel\s*:\s*['"]mobile['"]|MOBILE_NOTIFICATION_CHANNEL\s*[,}]/
      .test(readFileSync(file, 'utf8')))
    .map(file => path.relative(srcRoot, file));

  assert.deepEqual(
    emitters, [],
    'something now routes to the mobile inbox — F-111 second half (DR-013 A) is no longer '
    + `open and the record must say so: ${emitters.join(', ')}`,
  );
});

db.close();
rmSync(root, { recursive: true, force: true });

console.log(`\nMobile inbox wiring: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
