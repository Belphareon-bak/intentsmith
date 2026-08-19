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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/mobile/protocol.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { guardedWrite } from '../src/executor/guarded-write.js';
import { acquireFileLock, releaseFileLock, listHeldLocks } from '../src/executor/file-lock.js';
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

// ── 6. Nálezy z review — sondy převedené na regresní testy ─────────────────
//
// Tyhle tři případy prošly, když jsem si myslel, že je to hotové.  Každý z nich
// končil `written` a přepsaným cizím obsahem, takže tady nestačí testovat
// návratovou hodnotu — testuje se, **co je na disku**.

await test('review 1: změna cíle po ověření souhlasu už zápis nepustí', async () => {
  clear();
  const content = 'MŮJ ZÁPIS';
  writeFileSync(target(), 'ORIG', 'utf8');

  // Přesně to okno, kterým sonda z review prošla: souhlas je zapsaný,
  // `awaitDecision` předpoklad ověřil — a **teprve pak** soubor někdo změní.
  // Dřív se v tu chvíli už jen zapisovalo; proto se cizí obsah přepsal.
  let mutated = false;
  const io = {
    readFile: async (file, enc) => {
      const value = readFileSync(file, enc);
      const decided = db.prepare(
        'SELECT decided_at FROM mobile_approvals ORDER BY created_at DESC LIMIT 1').get();
      if (decided?.decided_at && !mutated) {
        mutated = true;
        writeFileSync(file, 'CIZÍ ZMĚNA PO OVĚŘENÍ', 'utf8');
      }
      return value;
    },
    writeFile: async (file, data, enc) => writeFileSync(file, data, enc),
    mkdir: async () => {},
  };

  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-review-1',
    filePath: target(), content, workspace, timeoutMs: 20_000, fs: io,
  });
  await answerPending('approve', { payload: { path: target(), content } });
  const result = await write;

  assert.equal(mutated, true, 'sonda nestihla soubor změnit, test by nic neměřil');
  assert.equal(result.written, false,
    'zápis prošel, přestože se cíl po ověření souhlasu změnil');
  assert.equal(result.state, 'precondition_changed');
  assert.equal(readFileSync(target(), 'utf8'), 'CIZÍ ZMĚNA PO OVĚŘENÍ',
    'cizí obsah byl přepsán souhlasem, který platil pro jiný stav');
});

await test('review 2: po ztrátě zámku se nezapisuje, i když souhlas platí', async () => {
  clear();
  const content = 'OLD-WRITER';
  writeFileSync(target(), 'ORIG', 'utf8');

  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-stary',
    filePath: target(), content, workspace, timeoutMs: 20_000,
  });

  // Lease starého běhu vyprší a soubor si vezme jiný běh — přesně jak to
  // udělala sonda z review.
  const row = await (async () => {
    for (let i = 0; i < 300; i++) {
      const found = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
      if (found) return found;
      await yieldTick();
    }
    throw new Error('approval nevznikl');
  })();
  db.prepare("UPDATE file_write_locks SET expires_at = '2000-01-01 00:00:00' WHERE run_id = 'run-stary'").run();
  const rival = acquireFileLock(db, { workspace, filePath: target(), runId: 'run-rival' });
  assert.equal(rival.ok, true, 'sonda nepřevzala zámek, test by nic neměřil');

  await answerPending('approve', { payload: { path: target(), content } });
  const result = await write;

  assert.equal(result.state, 'lock_lost', `zápis po ztrátě zámku skončil jako ${result.state}`);
  assert.equal(readFileSync(target(), 'utf8'), 'ORIG',
    'starý běh přepsal soubor, který mezitím patřil jinému běhu (porušení 027)');
});

await test('review 3: nečitelný cíl není „neexistuje" — a nic se nepřepíše', async () => {
  clear();
  const content = 'ZÁPIS PŘES NEČITELNÝ SOUBOR';
  writeFileSync(target(), 'TAJNÝ OBSAH', 'utf8');

  // Soubor existuje, ale číst ho nejde (EACCES).  Dřív z toho vyšel předpoklad
  // `absent`, tedy „vytváříme nový soubor" — a existující obsah se přepsal.
  const io = {
    readFile: async () => {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    },
    writeFile: async (file, data, enc) => writeFileSync(file, data, enc),
    mkdir: async () => {},
  };

  const result = await guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-review-3',
    filePath: target(), content, workspace, timeoutMs: 20_000, fs: io,
  });

  assert.equal(result.state, 'precondition_unverifiable');
  assert.equal(result.written, false);
  assert.equal(readFileSync(target(), 'utf8'), 'TAJNÝ OBSAH',
    'nečitelný soubor byl přepsán, protože se tvářil jako neexistující');
  // A hlavně: nikoho jsme se ani nezeptali.  Otázka, jejíž předpoklad neumíme
  // ověřit, je souhlas naslepo.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n, 0);
});

await test('nález 4: neúspěšný konec uzavře otázku, aby ve frontě neviselo strašidlo', async () => {
  clear();
  const content = 'nikdo neodpoví';
  const result = await guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-ghost',
    filePath: target(), content, workspace, timeoutMs: 5,
  });
  assert.equal(result.state, 'timeout');

  const row = db.prepare('SELECT decision, decision_reason, decided_by FROM mobile_approvals').get();
  assert.ok(row, 'approval zmizel — historie se nemaže');
  assert.equal(row.decision, 'cancelled', 'otázka zůstala nerozhodnutá a fronta ji dál nabízí');
  assert.equal(row.decided_by, 'system');
  assert.ok(row.decision_reason, 'není zapsané, proč otázka skončila');
});

await test('nález 7: symlink a přímá cesta jsou jeden cíl, ne dva', async () => {
  clear();
  const real = path.join(workdir, 'skutecny.js');
  const link = path.join(workdir, 'odkaz.js');
  writeFileSync(real, 'OBSAH', 'utf8');
  symlinkSync(real, link);

  const held = acquireFileLock(db, { workspace, filePath: real, runId: 'run-prvni' });
  assert.equal(held.ok, true);

  const result = await guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-druhy',
    filePath: link, content: 'přes odkaz', workspace, timeoutMs: 20_000,
  });
  assert.equal(result.state, 'locked',
    'symlink obešel zámek, takže dva běhy zapisovaly do jednoho souboru');
  assert.equal(readFileSync(real, 'utf8'), 'OBSAH');
});

// ── 8. Převzatý lease: starý zapisovatel efekt neprovede ───────────────────

await test('027 převzatý lease: starý běh po souhlasu nezapíše nic', async () => {
  clear();
  const content = 'zápis, který už nemá právo se stát';

  // Běh A si vezme zámek a čeká na člověka.
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-stary',
    filePath: target(), content, workspace, timeoutMs: 20_000,
  });

  const approval = await (async () => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
      if (row) return row;
      await yieldTick();
    }
    throw new Error('nevznikl approval');
  })();

  // Lease běhu A vyprší — spadlý proces, uspaný stroj, cokoli — a **rival si
  // zámek řádně vezme**.  Tohle je ten okamžik, po kterém běh A ztratil právo
  // na soubor, i když o tom ještě neví a jeho approval je pořád platný.
  db.prepare(`
    UPDATE file_write_locks
       SET released_at = datetime('now'), release_reason = 'expired'
     WHERE run_id = 'run-stary' AND released_at IS NULL
  `).run();
  const rival = acquireFileLock(db, {
    workspace, filePath: target(), runId: 'run-rival', ownerLabel: 'druhý agent',
  });
  assert.equal(rival.ok, true, 'rival si zámek nevzal, test by nic nedokazoval');

  // A teprve teď člověk odpoví „ano".  Souhlas platí; rezervace ne.
  await answerPending('approve', { payload: { path: target(), content } });
  const result = await write;

  assert.equal(result.written, false, 'starý běh zapsal přes práci rivala');
  assert.equal(result.state, 'lock_lost');
  assert.equal(existsSync(target()), false, 'na disku je efekt běhu, který o zámek přišel');

  // A otázka po něm nezůstala viset jako čekající.
  const row = db.prepare('SELECT decided_at, decision FROM mobile_approvals WHERE id = ?').get(approval.id);
  assert.equal(row.decision, 'approve', 'odpověď člověka se přepsala');

  releaseFileLock(db, { lockId: rival.lock.id, runId: 'run-rival' });
});

// ── 9. Hluboká neexistující cesta přes symlink ─────────────────────────────

await test('nález 7 rozšířen: symlink se rozmotá i u cesty, jejíž adresář ještě není', async () => {
  clear();
  const skutecny = path.join(workdir, 'skutecny');
  mkdirSync(skutecny, { recursive: true });
  symlinkSync(skutecny, path.join(workdir, 'odkaz'));

  // Ani `a`, ani `a/b` neexistují — `mkdir -p` je udělá teprve zápis.  Dřív se
  // v tomhle případě kanonizace vzdala a spadla do lexikální podoby, takže
  // `odkaz/a/b/c.js` a `skutecny/a/b/c.js` byly dva klíče nad jedním souborem.
  const pres = path.join(workdir, 'odkaz', 'a', 'b', 'c.js');
  const primo = path.join(skutecny, 'a', 'b', 'c.js');

  const drzi = acquireFileLock(db, { workspace, filePath: pres, runId: 'run-symlink-1' });
  assert.equal(drzi.ok, true);

  const druhy = acquireFileLock(db, { workspace, filePath: primo, runId: 'run-symlink-2' });
  assert.equal(druhy.ok, false,
    'symlink a přímá cesta k témuž budoucímu souboru dostaly dva zámky');
  assert.equal(druhy.holder.runId, 'run-symlink-1');

  releaseFileLock(db, { lockId: drzi.lock.id, runId: 'run-symlink-1' });
});


db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nZápis, který se ptá: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
