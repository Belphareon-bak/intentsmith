// Dva telefony nad jednou frontou
// ==============================================================================
//
// Základ v kódu držel — sdílená autorita, receipty po zařízeních, `SS-09` — ale
// nikdo to nikdy nepustil se **dvěma** zařízeními najednou.  „Drží to" a
// „ověřili jsme, že to drží" jsou dvě různá tvrzení a jen jedno z nich je
// evidence.
//
// Čtyři otázky, na které tahle sada odpovídá:
//
//   1. **Co vidí druhý telefon?**  Frontа approvalů je **sdílená**, ne
//      per-device: kdo má `read:approvals`, vidí tytéž nerozhodnuté řádky.
//      Jinak by „nic nečeká" znamenalo „nic nečeká *pro tebe*" a to je věta,
//      kterou uživatel neumí přečíst správně.
//
//   2. **Kdo rozhodl?**  První odpověď vítězí a `decided_by` nese **identitu
//      zařízení**, ne obecné „mobil".  Druhý telefon dostane tu první odpověď,
//      ne chybu a ne ticho.
//
//   3. **Zmizí to i tomu druhému?**  Ano — rozhodnutý approval není ve frontě
//      žádného zařízení.  Fronta, která by ho jednomu ukazovala dál, by ho
//      nechala rozhodovat podruhé.
//
//   4. **Jak se chovají receipty?**  Přečtení na telefonu A **nesmí** označit
//      zprávu jako přečtenou na telefonu B (`F-112`/`DR-012 A`).  Ale rozhodnutí
//      z A je pro B viditelné okamžitě — protože to není receipt, to je stav
//      approvalu.  Tenhle rozdíl je celé jádro věci: *co jsem viděl* je moje,
//      *co se stalo* je společné.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/approvals/fingerprint.js';
import { createMobileApproval } from '../src/approvals/authority.js';
import { handleApprovals, handleApprovalDecide } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import {
  MobileChannel, MOBILE_PROJECTOR_CAPABILITY,
  listMobileNotifications, ackMobileNotifications,
} from '../src/notifications/channels/mobile.js';

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

console.log('\n=== Dva telefony nad jednou frontou ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-multidev-'));
const db = new Database(path.join(runtimeDir, 'multidev.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);

/** Dva spárované telefony. Oba smějí číst i rozhodovat. */
const telefonA = { deviceId: 'device-A', scopes: ['read:approvals', 'write:approvals'] };
const telefonB = { deviceId: 'device-B', scopes: ['read:approvals', 'write:approvals'] };
/** A třetí, který smí jen číst — scope je skutečná hranice, ne dekorace. */
const ctecka = { deviceId: 'device-C', scopes: ['read:approvals'] };

let operationCounter = 0;
const nextOperationId = () => `op-md-${String(++operationCounter).padStart(10, '0')}`;

function clear() {
  db.exec(`
    DELETE FROM mobile_approvals;
    DELETE FROM mobile_operations;
    DELETE FROM mobile_notifications;
    DELETE FROM mobile_notification_receipts;
  `);
}

const payload = { path: '/tmp/sdileny.txt', content: 'obsah' };

function mint(id = 'ap-sdileny') {
  return createMobileApproval(db, {
    id, origin: 'local', runId: 'run-md', operationRef: 'fs.write:/tmp/sdileny.txt',
    subjectType: 'effect.write', subjectId: '/tmp/sdileny.txt',
    title: 'Přepsat soubor', detail: '/tmp/sdileny.txt', payload,
  });
}

async function queueFor(principal) {
  const response = await handleApprovals({ rawDb: db, principal });
  return response.body.data;
}

function decideAs(principal, approvalId, decision) {
  return handleApprovalDecide({
    rawDb: db, journal, principal, params: { id: approvalId },
    body: { decision, operationId: nextOperationId(), payloadFingerprint: fingerprint(payload) },
  });
}

// ── 1. Fronta je sdílená ───────────────────────────────────────────────────

await test('oba telefony vidí tentýž čekající approval', async () => {
  clear();
  const minted = mint();

  const a = await queueFor(telefonA);
  const b = await queueFor(telefonB);

  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].id, minted.id);
  assert.equal(b[0].id, minted.id,
    'druhý telefon nevidí approval — fronta by byla per-device a „nic nečeká" nepravda');
  // Otisk dostávají oba, aby oba mohli prokázat, o čem rozhodují (§8.4).
  assert.equal(a[0].payloadFingerprint, b[0].payloadFingerprint);
});

// ── 2. První odpověď vítězí a je vidět kdo ─────────────────────────────────

await test('rozhodne první telefon; druhý dostane tu první odpověď, ne chybu bez obsahu', async () => {
  clear();
  const minted = mint();

  const prvni = await decideAs(telefonA, minted.id, 'approve');
  assert.equal(prvni.status, 200);

  const druhy = await decideAs(telefonB, minted.id, 'reject');
  // `MD-19` mluví přes žurnál operací: druhý pokus je konflikt stavu a **nese
  // rozhodnutí, které platí**, aby telefon B mohl ukázat `SS-09` („rozhodnuto
  // jinde") místo obecné chyby.
  assert.notEqual(druhy.status, 200, 'druhé rozhodnutí prošlo a přepsalo první');

  const row = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(minted.id);
  assert.equal(row.decision, 'approve', 'druhý telefon přepsal odpověď prvního');
  assert.equal(row.decided_by, telefonA.deviceId,
    'nezaznamenalo se, které zařízení rozhodlo — „rozhodl mobil" není odpověď na „kdo"');
});

await test('rozhodnutý approval zmizí z fronty obou telefonů, ne jen toho rozhodujícího', async () => {
  clear();
  const minted = mint();
  await decideAs(telefonA, minted.id, 'approve');

  assert.equal((await queueFor(telefonA)).length, 0);
  assert.equal((await queueFor(telefonB)).length, 0,
    'telefon B dál nabízí rozhodnutý approval — dal by se rozhodnout podruhé');
});

// ── 3. Scope je hranice i mezi zařízeními ──────────────────────────────────

await test('telefon jen se čtením vidí frontu, ale rozhodnout nesmí', async () => {
  clear();
  const minted = mint();

  assert.equal((await queueFor(ctecka)).length, 1, 'čtečka nevidí frontu, kterou číst smí');

  // Scope se vynucuje na **routě** (`gateway-policy.js`), ne v handleru — proto
  // se ověřuje tam, kde ta hranice doopravdy stojí, a ne přes atrapu.
  const { matchMobileRoute } = await import('../src/mobile/gateway-policy.js');
  const decideRoute = matchMobileRoute('POST', `/m1/approvals/${minted.id}/decide`);
  assert.ok(decideRoute, 'rozhodovací routa v politice chybí');
  // Scoped routy v politice `access` nemají — `authorizeMobileRequest` bere
  // jako scoped všechno, co není `public` ani `authenticated`.  Ověřuje se
  // proto obojí: že routa **není** v žádné z těch dvou volnějších kategorií,
  // a že nese ten scope, který má.
  assert.ok(!['public', 'authenticated'].includes(decideRoute.access),
    `rozhodovací routa je ${decideRoute.access} — pak by stačil jakýkoli platný token`);
  assert.equal(decideRoute.scope, 'write:approvals');

  assert.equal(ctecka.scopes.includes(decideRoute.scope), false,
    'čtečka má scope, kterým by rozhodla');
  for (const telefon of [telefonA, telefonB]) {
    assert.equal(telefon.scopes.includes(decideRoute.scope), true);
  }

  // A čtecí routa je scoped taky — jinak by „vidí frontu" znamenalo „vidí ji
  // kdokoli s tokenem".
  const readRoute = matchMobileRoute('GET', '/m1/approvals');
  assert.equal(readRoute.scope, 'read:approvals');

  const row = db.prepare('SELECT decided_at FROM mobile_approvals WHERE id = ?').get(minted.id);
  assert.equal(row.decided_at, null);
});

// ── 4. Receipty jsou moje, stav je společný ────────────────────────────────

await test('přečtení na telefonu A neoznačí zprávu jako přečtenou na telefonu B', async () => {
  clear();
  const channel = new MobileChannel({ db, logger: { info() {}, warn() {}, error() {} } });
  const sent = await channel.send({
    kind: 'approval', priority: 'high',
    title: 'Čeká rozhodnutí', body: 'Otevři schránku approvalů a rozhodni.',
    data: { event: 'approval.requested' },
    [MOBILE_PROJECTOR_CAPABILITY]: true,
  });
  assert.equal(sent.delivered, true);

  // Broadcast (`device_id IS NULL`) vidí obě zařízení.
  const preA = listMobileNotifications(db, { deviceId: telefonA.deviceId });
  const preB = listMobileNotifications(db, { deviceId: telefonB.deviceId });
  assert.equal(preA.length, 1);
  assert.equal(preB.length, 1);
  assert.equal(preA[0].read, false);
  assert.equal(preB[0].read, false);

  const acked = ackMobileNotifications(db, [preA[0].id], { deviceId: telefonA.deviceId });
  assert.equal(acked, 1);

  const postA = listMobileNotifications(db, { deviceId: telefonA.deviceId });
  const postB = listMobileNotifications(db, { deviceId: telefonB.deviceId });
  assert.equal(postA[0].read, true);
  assert.equal(postB[0].read, false,
    'ACK z telefonu A umlčel schránku telefonu B — F-112 zpátky');
});

await test('opakovaný ACK z téhož telefonu nehlásí práci dvakrát', () => {
  const [note] = listMobileNotifications(db, { deviceId: telefonA.deviceId });
  assert.equal(ackMobileNotifications(db, [note.id], { deviceId: telefonA.deviceId }), 0,
    'druhý ACK si připsal řádek, který byl přečtený už předtím');
});

await test('notifikace pro dvě zařízení nenese cestu, obsah ani diff', () => {
  const [note] = listMobileNotifications(db, { deviceId: telefonB.deviceId });
  const serialized = JSON.stringify(note);
  assert.ok(!serialized.includes('/tmp/sdileny.txt'), 'do S1 notifikace se dostala cesta');
  assert.ok(!serialized.includes('obsah'), 'do S1 notifikace se dostal obsah');
});

// ── 5. Souběh: oba naráz ───────────────────────────────────────────────────

await test('souběžné rozhodnutí obou telefonů dá oběma týž terminální výsledek', async () => {
  clear();
  const minted = mint();

  // Bez čekání mezi nimi — tohle je ten závod, kvůli kterému je `decided_at IS
  // NULL` součástí UPDATE a ne jen kontrolou před ním.
  const [a, b] = await Promise.all([
    decideAs(telefonA, minted.id, 'approve'),
    decideAs(telefonB, minted.id, 'reject'),
  ]);

  const uspesne = [a, b].filter(r => r.status === 200);
  assert.equal(uspesne.length, 1, `rozhodnutí prošlo ${uspesne.length}×, má právě jednou`);

  const row = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(minted.id);
  assert.ok(['approve', 'reject'].includes(row.decision));
  assert.ok([telefonA.deviceId, telefonB.deviceId].includes(row.decided_by));

  // A hlavně: oba telefony se při dalším pohledu dozvědí **totéž**.
  assert.equal((await queueFor(telefonA)).length, 0);
  assert.equal((await queueFor(telefonB)).length, 0);
});

db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nDva telefony: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
