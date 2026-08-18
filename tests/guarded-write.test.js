// Zápis, který se ptá — P0-2 (kde se potkává 025 a 027)
// ==============================================================================
//
// Tahle sada je o jediné větě, kterou celý companion slibuje:
//
//   **Efekt nastane až po souhlasu, a jen když pořád platí to, na co člověk
//   odpovídal.**
//
// Testuje se to na skutečném souborovém systému (v izolovaném adresáři), ne
// přes atrapu — protože ta zajímavá selhání jsou právě ta, kde se soubor pod
// rukama změní.  Každý test proto končí otázkou „co je na disku", ne „co
// vrátila funkce".
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/mobile/protocol.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { guardedWrite } from '../src/executor/guarded-write.js';
import { acquireFileLock, listHeldLocks } from '../src/executor/file-lock.js';
import { handleApprovalDecide } from '../src/mobile/handlers.js';
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

console.log('\n=== Zápis, který se ptá (P0-2) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-guarded-'));
const workdir = path.join(runtimeDir, 'strom');
const db = new Database(path.join(runtimeDir, 'guarded.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);
const phone = { deviceId: 'device-telefon', scopes: ['read:approvals', 'write:approvals'] };
const workspace = { repoId: '/fake/.git', branch: 'main', root: workdir, git: true };
const yieldTick = () => new Promise(resolve => setImmediate(resolve));

let operationCounter = 0;
function nextOperationId() {
  return `op-guarded-${String(++operationCounter).padStart(10, '0')}`;
}

function producer() {
  return createCompanionProducer({ rawDb: db, sleep: yieldTick });
}

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  rmSync(workdir, { recursive: true, force: true });
  // Strom existuje, soubor ne: testy potřebují do adresáře zapisovat i mimo
  // `guardedWrite`, aby uměly zahrát toho druhého, kdo mění cíl.
  mkdirSync(workdir, { recursive: true });
}

/** Odpověz na jediný čekající approval tak, jak by to udělal telefon. */
async function answerPending(decision, { payload }) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
    if (row) {
      return handleApprovalDecide({
        rawDb: db, journal, principal: phone, params: { id: row.id },
        body: { decision, operationId: nextOperationId(), payloadFingerprint: fingerprint(payload) },
      });
    }
    await yieldTick();
  }
  throw new Error('žádný approval nevznikl');
}

const target = () => path.join(workdir, 'config.js');

// ── 1. Souhlas ─────────────────────────────────────────────────────────────

await test('P0-2 po souhlasu soubor vznikne — a ne dřív', async () => {
  clear();
  const content = 'export const A = 1;\n';
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-1',
    filePath: target(), content, workspace, timeoutMs: 20_000,
  });

  // Než někdo odpoví, na disku nesmí být nic.
  await yieldTick();
  assert.equal(existsSync(target()), false, 'zapsalo se dřív, než kdokoli souhlasil');

  await answerPending('approve', { payload: { path: target(), content } });
  const result = await write;

  assert.equal(result.state, 'written');
  assert.equal(readFileSync(target(), 'utf8'), content);
  assert.equal(result.decidedBy, phone.deviceId);
});

await test('P0-2 zámek se po dokončení pustí', async () => {
  assert.equal(listHeldLocks(db).length, 0, 'zámek přežil svůj běh a blokuje ostatní');
});

// ── 2. Zamítnutí ───────────────────────────────────────────────────────────

await test('P0-2 zamítnutí soubor nevytvoří', async () => {
  clear();
  const content = 'tohle se nemá zapsat';
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-2',
    filePath: target(), content, workspace, timeoutMs: 20_000,
  });
  await answerPending('reject', { payload: { path: target(), content } });
  const result = await write;

  assert.equal(result.state, 'reject');
  assert.equal(result.written, false);
  assert.equal(existsSync(target()), false, 'zamítnutý zápis se přesto provedl');
});

// ── 3. Svět se změnil pod tím ──────────────────────────────────────────────

await test('025 souhlas propadne, když se cíl mezi odpovědí a zápisem změní', async () => {
  clear();
  const content = 'nová verze';
  // Soubor existuje a approval se váže na jeho současnou podobu.
  writeFileSync(target(), 'původní verze', 'utf8');

  const producerInstance = producer();
  const write = (async () => {
    // Ruční orchestrace: potřebujeme změnit soubor **po** odpovědi a **před**
    // zápisem, což je přesně to okno, kvůli kterému předpoklad existuje.
    const io = {
      readFile: async (file, enc) => readFileSync(file, enc),
      writeFile: async () => { throw new Error('sem se to nemá dostat'); },
      mkdir: async () => {},
    };
    return guardedWrite({
      rawDb: db, producer: producerInstance, runId: 'run-3',
      filePath: target(), content, workspace, timeoutMs: 20_000, fs: io,
    });
  })();

  await answerPending('approve', { payload: { path: target(), content } });
  // Někdo jiný (člověk v editoru, git checkout) soubor přepsal.
  writeFileSync(target(), 'někdo jiný to mezitím změnil', 'utf8');

  const result = await write;
  assert.equal(result.state, 'precondition_changed',
    'schválení prošlo, přestože se cíl pod ním změnil');
  assert.equal(result.written, false);
  assert.equal(readFileSync(target(), 'utf8'), 'někdo jiný to mezitím změnil',
    'cizí změna byla přepsána souhlasem, který platil pro jiný obsah');
});

await test('025 souhlas na vytvoření propadne, když soubor mezitím vznikne', async () => {
  clear();
  const content = 'můj nový soubor';
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-4',
    filePath: target(), content, workspace, timeoutMs: 20_000,
  });
  await answerPending('approve', { payload: { path: target(), content } });
  writeFileSync(target(), 'někdo byl rychlejší', 'utf8');

  const result = await write;
  assert.equal(result.state, 'precondition_changed');
  assert.equal(readFileSync(target(), 'utf8'), 'někdo byl rychlejší');
});

// ── 4. Dva agenti ──────────────────────────────────────────────────────────

await test('027 druhý běh na týž soubor je odmítnut hned, nečeká', async () => {
  clear();
  acquireFileLock(db, { workspace, filePath: target(), runId: 'run-drzitel', ownerLabel: 'agent Alfa' });

  const started = Date.now();
  const result = await guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-druhy',
    filePath: target(), content: 'x', workspace, timeoutMs: 20_000,
  });

  assert.equal(result.state, 'locked');
  assert.equal(result.written, false);
  assert.match(result.message, /run-drzitel/);
  assert.ok(Date.now() - started < 2_000, 'druhý běh čekal, místo aby dostal odpověď');
  // A hlavně: nevznikl žádný approval.  Ptát se člověka na něco, co stejně
  // nejde provést, je otázka navíc — a companion má šetřit pozornost.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n, 0);
});

await test('027 zámek drží po celou dobu čekání na člověka', async () => {
  clear();
  const content = 'dlouhé čekání';
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-cekajici',
    filePath: target(), content, workspace, timeoutMs: 20_000,
  });

  // Než kdokoli odpoví, jiný běh nesmí projít.
  for (let i = 0; i < 50; i++) await yieldTick();
  const rival = acquireFileLock(db, { workspace, filePath: target(), runId: 'run-rival' });
  assert.equal(rival.ok, false, 'během čekání na odpověď se soubor uvolnil pro jiný běh');

  await answerPending('approve', { payload: { path: target(), content } });
  await write;
});

// ── 5. Ticho ───────────────────────────────────────────────────────────────

await test('P0-2 když nikdo neodpoví, nic se nezapíše a stav se pojmenuje', async () => {
  clear();
  const result = await guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-ticho',
    filePath: target(), content: 'nikdo neodpověděl', workspace, timeoutMs: 5,
  });
  assert.equal(result.state, 'timeout');
  assert.equal(result.written, false);
  assert.equal(existsSync(target()), false);
  assert.equal(listHeldLocks(db).length, 0, 'nezodpovězený běh nechal soubor zamčený');
});

db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nZápis, který se ptá: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
