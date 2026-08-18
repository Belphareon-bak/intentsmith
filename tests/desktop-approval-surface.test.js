// Druhá rozhodovací plocha — P0-6
// ==============================================================================
//
// > „telefon nesmí být jedinou možností k approvalům… bez spárovaného telefonu
// > neexistuje jakákoli remote možnost, rozhoduje IDE z PC"
//
// Přidat druhou plochu je snadné.  Těžké je, aby **nebyla mírnější** — a to je
// jediné, co tahle sada měří:
//
//   1. co odmítne mobil, musí odmítnout i desktop (otisk, vazba, expirace);
//   2. rozhodnutí z jedné plochy je vidět na druhé a **první vítězí**;
//   3. nerozhodnutelný řádek se ani tady neschovává (`SS-02`);
//   4. běh čekající na odpověď dostane odpověď z desktopu úplně stejně jako
//      z telefonu — to je celý smysl P0-6.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/mobile/protocol.js';
import { createMobileApproval } from '../src/mobile/approval-authority.js';
import { createApprovalRoutes } from '../src/routes/approvals.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { handleApprovals, handleApprovalDecide } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';

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

console.log('\n=== Desktopová rozhodovací plocha (P0-6) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-desktop-appr-'));
const db = new Database(path.join(runtimeDir, 'desktop.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);
const phone = {
  deviceId: 'device-telefon',
  scopes: ['read:approvals', 'write:approvals'],
};

/** Minimální náhrada serverového transportu — jen tolik, co routy potřebují. */
function callRoute(route, { params = {}, body = null } = {}) {
  return new Promise(resolve => {
    const res = {};
    const routes = createApprovalRoutes({
      db,
      sendJSON: (_res, status, payload) => resolve({ status, body: payload }),
      parseBody: async () => body,
    });
    const handler = routes[route];
    if (!handler) throw new Error(`routa ${route} neexistuje`);
    Promise.resolve(handler({}, res, params)).catch(error => resolve({ status: 500, body: { error: error.message } }));
  });
}

const PAYLOAD = { path: '/x/config.js', content: 'nový obsah' };

function mint(overrides = {}) {
  return createMobileApproval(db, {
    origin: 'local',
    runId: 'run-desktop-1',
    operationRef: 'fs.write:/x/config.js',
    subjectType: 'effect.write',
    subjectId: '/x/config.js',
    title: 'Zapsat soubor',
    payload: PAYLOAD,
    ...overrides,
  });
}

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations;');
}

// ── 1. Desktop není mírnější ───────────────────────────────────────────────

await test('P0-6 desktop vidí tutéž frontu jako telefon', async () => {
  clear();
  const minted = mint();
  const desktop = await callRoute('GET /api/approvals');
  const mobile = await handleApprovals({ rawDb: db, principal: phone });

  assert.equal(desktop.status, 200);
  assert.deepEqual(
    desktop.body.approvals.map(a => a.id),
    mobile.body.data.map(a => a.id),
    'plochy ukazují jinou frontu',
  );
  assert.equal(desktop.body.approvals[0].id, minted.id);
});

await test('P0-6 rozhodnutí bez otisku odmítne i desktop', async () => {
  clear();
  const minted = mint();
  const answer = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id }, body: { decision: 'approve' },
  });
  assert.equal(answer.status, 400);
  assert.equal(db.prepare('SELECT decided_at FROM mobile_approvals WHERE id = ?').get(minted.id).decided_at, null);
});

await test('P0-6 otisk, který nesedí, odmítne i desktop', async () => {
  clear();
  const minted = mint();
  const answer = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id },
    body: { decision: 'approve', payloadFingerprint: fingerprint({ path: '/x/config.js', content: 'něco jiného' }) },
  });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.reason, 'approval_superseded');
});

await test('P0-6 nevázaný approval nejde rozhodnout ani z desktopu', async () => {
  clear();
  db.prepare(`
    INSERT INTO mobile_approvals (id, subject_type, subject_id, title, payload_fingerprint, expires_at)
    VALUES ('ap-nevazany', 'task', 'x', 'Bez vazby', ?, '2099-01-01 00:00:00')
  `).run(fingerprint(PAYLOAD));

  const answer = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: 'ap-nevazany' },
    body: { decision: 'approve', payloadFingerprint: fingerprint(PAYLOAD) },
  });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.reason, 'unbound_approval');
});

await test('SS-02 nerozhodnutelný řádek se ani na desktopu neschovává', async () => {
  const queue = await callRoute('GET /api/approvals');
  const item = queue.body.approvals.find(a => a.id === 'ap-nevazany');
  assert.ok(item, 'čekající požadavek zmizel z fronty');
  assert.equal(item.decidable, false, 'fronta neřekla, že rozhodnout nejde');
});

await test('P0-6 propadlý approval odmítne i desktop', async () => {
  clear();
  const minted = mint({ now: Date.now() - 60 * 60_000 });
  const answer = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id },
    body: { decision: 'approve', payloadFingerprint: fingerprint(PAYLOAD) },
  });
  assert.equal(answer.status, 409);
  assert.equal(answer.body.reason, 'approval_expired');
});

// ── 2. Dvě plochy, jedna pravda ────────────────────────────────────────────

await test('P0-6 rozhodnutí z desktopu telefon uvidí — a je jasné, kdo rozhodl', async () => {
  clear();
  const minted = mint();
  const answer = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id },
    body: { decision: 'approve', payloadFingerprint: fingerprint(PAYLOAD) },
  });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.decidedBy, 'desktop');

  // Telefon: fronta je prázdná, protože rozhodnuto je rozhodnuto — a jeho
  // obrazovka `SS-09` („rozhodnuto jinde") je právě pro tenhle případ.
  const mobile = await handleApprovals({ rawDb: db, principal: phone });
  assert.equal(mobile.body.data.length, 0);
});

await test('P0-6 první odpověď vítězí — druhá plocha dostane tu první, ne chybu', async () => {
  clear();
  const minted = mint();
  await handleApprovalDecide({
    rawDb: db, journal, principal: phone, params: { id: minted.id },
    body: { decision: 'reject', operationId: 'op-desktop-000001', payloadFingerprint: fingerprint(PAYLOAD) },
  });

  const late = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id },
    body: { decision: 'approve', payloadFingerprint: fingerprint(PAYLOAD) },
  });
  assert.equal(late.status, 200, 'druhá plocha dostala chybu místo odpovědi');
  assert.equal(late.body.replay, true);
  assert.equal(late.body.decision, 'reject', 'pozdější „ano" přepsalo dřívější „ne"');
});

// ── 3. To, kvůli čemu to celé je ───────────────────────────────────────────

await test('P0-6 běh čekající na odpověď ji dostane i bez telefonu', async () => {
  clear();
  const core = createCompanionProducer({
    rawDb: db, sleep: () => new Promise(resolve => setImmediate(resolve)),
  });
  const minted = await core.requestApproval({
    origin: 'local', runId: 'run-bez-telefonu', operationRef: 'fs.write:/x/config.js',
    subjectType: 'effect.write', subjectId: '/x/config.js', title: 'Zapsat',
    payload: PAYLOAD,
  });

  const waiting = core.awaitDecision(minted.id, { timeoutMs: 10_000, pollMs: 1 });
  await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id },
    body: { decision: 'approve', payloadFingerprint: fingerprint(PAYLOAD) },
  });

  const answer = await waiting;
  assert.equal(answer.state, 'approve');
  assert.equal(answer.decidedBy, 'desktop',
    'běh se nedozvěděl, že rozhodl desktop — a to je jediná informace, která ho odlišuje od telefonu');
});

await test('P0-6 desktop rozhodne i approval vázaný na cíl', async () => {
  clear();
  const minted = mint({
    precondition: { kind: 'file-digest', ref: '/x/config.js', content: 'původní' },
  });
  const queue = await callRoute('GET /api/approvals');
  const item = queue.body.approvals[0];
  assert.equal(item.validity, 'precondition');
  assert.equal(item.preconditionRef, '/x/config.js',
    'desktop nevidí, na čem approval závisí — přitom sedí u toho souboru');

  const answer = await callRoute('POST /api/approvals/:id/decide', {
    params: { id: minted.id },
    body: { decision: 'approve', payloadFingerprint: item.payloadFingerprint },
  });
  assert.equal(answer.status, 200);
});

db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nDesktopová plocha: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
