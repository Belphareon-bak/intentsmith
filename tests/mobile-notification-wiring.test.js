#!/usr/bin/env node
// The mobile inbox is fail-closed — F-111 / DR-013.
// ==============================================================================
//
// **Two mistakes are recorded here, because the second was made while fixing
// the first.**
//
// `F-111` was that nothing registered `MobileChannel`, so
// `router.send({ channel: 'mobile' })` answered *"Channel 'mobile' not
// registered"* and no row could ever be written.  Registering it in
// `createNotificationRouter` closed that — and opened something worse.
//
// The production router is handed to the HTTP routes and to `AgentRunner`.
// `POST /api/notifications/send` and `/api/notifications/test` take `channel`
// **straight from the request body**, and the agent schema does not whitelist
// channels at all.  So registration did not merely make the inbox reachable by
// an authorised producer; it made it reachable by **any caller who can name a
// channel**, with a free-form `body` and `data`, broadcast to every paired
// device.  `DATA-MODEL` §`MD-11` says a mobile notification is an **S1
// indicator without content**; an approval description is **S2**.
//
// The first version of this suite did not catch that, and its "ratchet" made it
// worse: it grepped for the literal `channel: 'mobile'`, which a dynamic
// `body.channel` never matches.  A test that cannot fail for the real case is
// not assurance, it is a false certificate.
//
// The boundary is therefore a `Symbol` capability: `JSON.parse` cannot produce
// a symbol-keyed property, so no HTTP body and no agent config can carry it,
// whatever string they put in `channel`.  The negative tests below go through
// the **real route handlers**, not through the router directly, because the
// route is where the untrusted input actually enters.
//
// **What is still open.**  This is the fail-closed half.  *Which* notifications
// may reach a phone, and in what fixed S1 shape, is `DR-013 A` and is not
// decided here — so until that projector exists, the inbox admits nothing.
//
// ==============================================================================

import './helpers/isolated-test-db.js';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { createNotificationRouter } from '../src/notifications/index.js';
import {
  MOBILE_NOTIFICATION_CHANNEL, MOBILE_PROJECTOR_CAPABILITY,
} from '../src/notifications/channels/mobile.js';
import { createNotificationRoutes } from '../src/routes/notifications.js';
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
await runMigrations(db);

const inboxCount = () => db.prepare('SELECT COUNT(*) AS n FROM mobile_notifications').get().n;

/** The production wiring, assembled the way `server.js` assembles it. */
function productionRoutes() {
  const notificationRouter = createNotificationRouter({ db });
  const answers = [];
  const routes = createNotificationRoutes({
    notificationRouter,
    notificationEmitter: null,
    db,
    sendJSON: (res, status, payload) => { answers.push({ status, payload }); },
    parseBody: async req => req.body,
  });
  return { routes, answers, notificationRouter };
}

console.log('\n=== Mobile inbox fail-closed (F-111, DR-013) ===');

// ── The half that was genuinely missing ─────────────────────────────────────

await test('the production router registers the mobile channel', () => {
  const { notificationRouter } = productionRoutes();
  assert.ok(
    notificationRouter.channels.has(MOBILE_NOTIFICATION_CHANNEL),
    `absent; available: ${notificationRouter.getAvailableChannels().join(', ')}`,
  );
});

await test('an authorised projector may write to the inbox', async () => {
  const { notificationRouter } = productionRoutes();
  const before = inboxCount();
  const result = await notificationRouter.send({
    channel: MOBILE_NOTIFICATION_CHANNEL,
    // S1 shape on purpose: an indicator, no description of the subject.
    title: 'Čeká nové schválení',
    body: '',
    priority: 'high',
    agentId: 'projector',
    [MOBILE_PROJECTOR_CAPABILITY]: true,
  });
  assert.equal(result.delivered, true, result.error || 'not delivered');
  assert.equal(inboxCount(), before + 1, 'no row was written');
});

// ── The hole that registration opened ───────────────────────────────────────

await test('POST /api/notifications/send cannot reach the inbox', async () => {
  const { routes, answers } = productionRoutes();
  const before = inboxCount();
  await routes['POST /api/notifications/send'](
    { body: { channel: 'mobile', title: 'Zapsat soubor', body: 'popis příkazu (S2)', priority: 'high' } },
    {},
  );
  assert.equal(inboxCount(), before, 'an HTTP caller wrote S2 content into the phone inbox');
  assert.equal(answers.at(-1).status, 400, 'the refusal must be visible, not silent');
});

await test('POST /api/notifications/test cannot reach the inbox', async () => {
  const { routes, answers } = productionRoutes();
  const before = inboxCount();
  await routes['POST /api/notifications/test']({ body: { channel: 'mobile', recipient: 'x' } }, {});
  assert.equal(inboxCount(), before, 'the test endpoint wrote into the phone inbox');
  assert.ok(answers.length > 0, 'the endpoint answered nothing at all');
});

await test('a dynamically chosen channel name cannot reach the inbox either', async () => {
  // The literal `channel: 'mobile'` is the easy case.  This is the one the
  // first version of this suite could not see.
  const { notificationRouter } = productionRoutes();
  const before = inboxCount();
  const chosen = ['mo', 'bile'].join('');
  const result = await notificationRouter.send({
    channel: chosen, title: 'x', body: 'S2 content', agentId: 'agent-1',
  });
  assert.equal(result.delivered, false, 'a computed channel name got through');
  assert.equal(inboxCount(), before, 'a computed channel name wrote into the inbox');
});

await test('a capability-shaped value carried in JSON is not a capability', async () => {
  const { notificationRouter } = productionRoutes();
  const before = inboxCount();
  // Everything a request body could plausibly contain, including the obvious
  // string and `Symbol.for` guesses.
  const forged = JSON.parse('{"channel":"mobile","title":"t","body":"b","agentId":"a",'
    + '"MOBILE_PROJECTOR_CAPABILITY":true,"mobile.projector":true}');
  forged[Symbol.for('mobile.projector')] = true;
  const result = await notificationRouter.send(forged);
  assert.equal(result.delivered, false, result.error);
  assert.match(String(result.error), /capability/i, 'the refusal must name the reason');
  assert.equal(inboxCount(), before, 'a forged capability wrote into the inbox');
});

// ── The boundary itself, ratcheted ──────────────────────────────────────────

await test('nothing in src/ holds the capability yet — DR-013 is still open', () => {
  // A real boundary check, not a grep for one spelling of a string.  The
  // capability cannot be obtained without importing it, so the import list *is*
  // the set of authorised producers.  When the DR-013 projector lands it will
  // appear here and this test will fail on purpose — whoever adds it must
  // retire the open half of F-111 rather than leave the record stale.
  const srcRoot = new URL('../src/', import.meta.url).pathname;
  const walk = dir => readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const holders = walk(srcRoot)
    .filter(file => file.endsWith('.js'))
    .filter(file => !file.endsWith(path.join('channels', 'mobile.js')))
    .filter(file => /MOBILE_PROJECTOR_CAPABILITY/.test(readFileSync(file, 'utf8')))
    .map(file => path.relative(srcRoot, file));

  assert.deepEqual(
    holders, [],
    'something now holds the mobile capability — DR-013 A is no longer open and the '
    + `record must say so: ${holders.join(', ')}`,
  );
});

await test('a router built without a database still refuses rather than throwing', async () => {
  const notificationRouter = createNotificationRouter({});
  assert.ok(notificationRouter.channels.has(MOBILE_NOTIFICATION_CHANNEL));
  const result = await notificationRouter.send({
    channel: MOBILE_NOTIFICATION_CHANNEL, title: 't', body: 'b', agentId: 'a',
    [MOBILE_PROJECTOR_CAPABILITY]: true,
  });
  assert.equal(result.delivered, false);
  assert.match(String(result.error), /database/i);
});

await test('registration is additive — the other channels still dispatch as before', async () => {
  const { notificationRouter } = productionRoutes();
  for (const name of ['email', 'telegram', 'push']) {
    assert.ok(notificationRouter.channels.has(name), `${name} disappeared`);
  }
  const before = inboxCount();
  const result = await notificationRouter.send({ channel: 'in_app', title: 'x', body: 'y', agentId: 'a' });
  assert.equal(result.delivered, true);
  assert.equal(result.channel, 'in_app');
  assert.equal(inboxCount(), before, 'an in_app notification leaked into the mobile inbox');
});

db.close();
rmSync(root, { recursive: true, force: true });

console.log(`\nMobile inbox fail-closed: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
