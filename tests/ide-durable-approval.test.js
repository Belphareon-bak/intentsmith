// Editační approval, na který může odpovědět i někdo jiný než IDE — P0-2
// ==============================================================================
//
// Editační approval byl v paměti relace: mapa, promise, třicetivteřinový timer.
// Odpovědět mohl **jen ten, kdo seděl u IDE** — telefon žije v jiném procesu a
// k té promise se nedostane.  Po třiceti vteřinách otázka zmizela, i když byla
// pořád aktuální, a restart backendu ji zahodil.
//
// Tahle sada měří, že se to změnilo, a hlavně že se to **nezměnilo tam, kde
// nemělo**:
//
//   1. bez vložených závislostí zůstává původní chování (`024` — producent se
//      nespouští sám);
//   2. se závislostmi vznikne řádek, který vidí telefon i desktop;
//   3. odpověď z telefonu spustí zápis, aniž by IDE cokoli udělalo;
//   4. odpověď z IDE zapisuje do **téhož** řádku;
//   5. první odpověď vítězí, ať přišla odkudkoli.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/mobile/protocol.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { createSessionAdapter, setApprovalDeps } from '../src/ws-bridge/session-adapter.js';
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

console.log('\n=== Editační approval mimo IDE (P0-2) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-ide-appr-'));
const workdir = path.join(runtimeDir, 'strom');
mkdirSync(workdir, { recursive: true });
const db = new Database(path.join(runtimeDir, 'ide.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);
const phone = { deviceId: 'device-telefon', scopes: ['read:approvals', 'write:approvals'] };
const mockLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const yieldTick = () => new Promise(resolve => setImmediate(resolve));

let operations = 0;
const nextOperationId = () => `op-ide-${String(++operations).padStart(11, '0')}`;

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
}

/**
 * Relace, která se pokusí zapsat soubor v režimu `ask` — tedy přesně ta cesta,
 * kde se agent ptá.  Vrací, co uvidělo IDE, a příslib, který skončí, až se
 * rozhodne.
 */
let frameCounter = 0;

/** Rám příkazu, jak ho posílá Studio — stejný tvar jako v `ws-bridge.test.js`. */
function m1Frame() {
  const suffix = `durable-${++frameCounter}`;
  return {
    command: {
      contract: 'ConversationCommand',
      version: 1,
      requestId: `m1-request-${suffix}`,
      conversationId: `m1-conversation-${suffix}`,
      turnId: `m1-turn-${suffix}`,
      action: 'send',
      input: 'zapiš to',
    },
    // Kontext musí být úplný, jinak rám neprojde validací a `handleRequest` se
    // nikdy nezavolá — což vypadá jako „producent nic nevyrobil".
    context: { editMode: 'ask', agentId: null, projectId: null, attachments: [] },
  };
}

function sessionWriting(filePath, content) {
  const sent = [];
  let seenRequest;
  const editRequest = new Promise(resolve => { seenRequest = resolve; });

  const adapter = createSessionAdapter({
    send: encoded => {
      const message = JSON.parse(encoded);
      sent.push(message);
      const payload = message.data?.payload;
      if (payload?.reqId) seenRequest(payload);
    },
    handleRequest: async request => {
      await request.context.onToolCall('fs.write', { path: filePath, content });
      return { response: 'ok' };
    },
    logger: mockLogger,
  });

  const finished = adapter.processM1Command(m1Frame()).catch(error => ({ error }));
  return { adapter, sent, editRequest, finished };
}

async function pendingApproval() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const row = db.prepare('SELECT * FROM mobile_approvals WHERE decided_at IS NULL').get();
    if (row) return row;
    await yieldTick();
  }
  return null;
}

const target = () => path.join(workdir, 'config.js');

// ── 1. Bez závislostí se nic nemění ────────────────────────────────────────

await test('024 bez vložených závislostí trvalý approval nevzniká', async () => {
  clear();
  setApprovalDeps({ db: null, producer: null });

  const session = sessionWriting(target(), 'obsah');
  await Promise.race([session.editRequest, yieldTick().then(() => null)]);
  for (let i = 0; i < 20; i++) await yieldTick();

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n, 0,
    'producent se rozběhl sám, přestože ho nikdo nezapnul');
  session.adapter.cleanup();
  await session.finished;
});

// ── 2. Se závislostmi je otázka vidět odjinud ──────────────────────────────

await test('P0-2 se závislostmi vznikne approval, který vidí telefon', async () => {
  clear();
  setApprovalDeps({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

  const session = sessionWriting(target(), 'z telefonu schválený obsah');
  const row = await pendingApproval();
  assert.ok(row, 'nevznikl žádný approval');

  const queue = await handleApprovals({ rawDb: db, principal: phone });
  assert.ok(queue.body.data.some(item => item.id === row.id),
    'approval z IDE cesty se na telefon nedostal');
  assert.equal(row.validity, 'precondition', 'editační approval nemá vazbu na stav cíle');

  // A IDE dostalo svůj diff jako dřív.
  const request = await session.editRequest;
  assert.equal(request.reqId, row.id, 'IDE dostalo jiné id, než je id approvalu');
  assert.equal(request.durable, true);

  session.adapter.cleanup();
  await session.finished;
});

// ── 3. Odpověď z telefonu ──────────────────────────────────────────────────

await test('P0-2 schválení z telefonu zapíše soubor, aniž by IDE cokoli udělalo', async () => {
  clear();
  setApprovalDeps({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

  const content = 'schváleno z telefonu';
  const session = sessionWriting(target(), content);
  const row = await pendingApproval();

  assert.equal(existsSync(target()), false, 'zapsalo se dřív, než kdokoli odpověděl');

  await handleApprovalDecide({
    rawDb: db, journal, principal: phone, params: { id: row.id },
    body: {
      decision: 'approve',
      operationId: nextOperationId(),
      payloadFingerprint: fingerprint({ path: target(), content }),
    },
  });

  await session.finished;
  assert.equal(readFileSync(target(), 'utf8'), content);
  session.adapter.cleanup();
});

await test('P0-2 zamítnutí z telefonu soubor nevytvoří', async () => {
  clear();
  setApprovalDeps({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

  const content = 'tohle se nemá zapsat';
  const session = sessionWriting(target(), content);
  const row = await pendingApproval();

  await handleApprovalDecide({
    rawDb: db, journal, principal: phone, params: { id: row.id },
    body: {
      decision: 'reject',
      operationId: nextOperationId(),
      payloadFingerprint: fingerprint({ path: target(), content }),
    },
  });

  await session.finished;
  assert.equal(existsSync(target()), false, 'zamítnutý zápis se přesto provedl');
  session.adapter.cleanup();
});

// ── 4. Odpověď z IDE jde do téhož řádku ────────────────────────────────────

await test('P0-2 schválení z IDE zapisuje do téhož approvalu, ne vedle něj', async () => {
  clear();
  setApprovalDeps({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

  const content = 'schváleno z IDE';
  const session = sessionWriting(target(), content);
  const row = await pendingApproval();

  session.adapter.handleControl({ action: 'edit_approve', requestId: row.id });
  await session.finished;

  const decided = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(row.id);
  assert.equal(decided.decision, 'approve');
  assert.equal(decided.decided_by, 'ide', 'není poznat, která plocha rozhodla');
  assert.equal(readFileSync(target(), 'utf8'), content);
  session.adapter.cleanup();
});

// ── 5. První odpověď vítězí ────────────────────────────────────────────────

await test('P0-2 pozdní „ano" z IDE nepřepíše „ne", které přišlo z telefonu', async () => {
  clear();
  setApprovalDeps({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

  const content = 'sporný obsah';
  const session = sessionWriting(target(), content);
  const row = await pendingApproval();

  await handleApprovalDecide({
    rawDb: db, journal, principal: phone, params: { id: row.id },
    body: {
      decision: 'reject',
      operationId: nextOperationId(),
      payloadFingerprint: fingerprint({ path: target(), content }),
    },
  });
  session.adapter.handleControl({ action: 'edit_approve', requestId: row.id });

  await session.finished;
  const decided = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(row.id);
  assert.equal(decided.decision, 'reject', 'pozdější „ano" přepsalo dřívější „ne"');
  assert.equal(decided.decided_by, phone.deviceId);
  assert.equal(existsSync(target()), false);
  session.adapter.cleanup();
});

// ── 6. Konec relace stahuje otázku ─────────────────────────────────────────

await test('P0-2 konec relace stáhne otázku, kterou už nemá kdo provést', async () => {
  clear();
  setApprovalDeps({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

  const session = sessionWriting(target(), 'nedokončený zápis');
  const row = await pendingApproval();
  assert.ok(row, 'nevznikl approval');

  // Zavřený editor, spadlé spojení, restart — pro tuhle relaci totéž.
  session.adapter.cleanup();
  await session.finished;

  const after = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(row.id);
  assert.equal(after.decision, 'cancelled',
    'otázka zůstala na telefonu viset, i když ji nemá kdo provést');
  assert.equal(after.decided_by, 'session_gone');

  // A hlavně: souhlas, po kterém by se nic nestalo, už nejde dát.
  const queue = await handleApprovals({ rawDb: db, principal: phone });
  assert.equal(queue.body.data.some(item => item.id === row.id), false);

  // Zámek se pustil, takže na souboru může pracovat někdo další.
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM file_write_locks WHERE released_at IS NULL`).get().n, 0,
    'po konci relace zůstal soubor zamčený');
  assert.equal(existsSync(target()), false);
});

setApprovalDeps({ db: null, producer: null });
db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nEditační approval mimo IDE: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
