// Jeden zapisovatel na soubor — rozhodnutí 027
// ==============================================================================
//
// Zámek se dá „mít" a přitom nechránit.  Tahle sada proto neměří, že se dá
// zamknout, ale čtyři vlastnosti, bez kterých je to jen tabulka:
//
//   1. **Druhý běh se odmítne hned a dozví se kdo drží.**  Ne fronta, ne
//      timeout — obojí vyrábí běhy, které stojí a nikdo neví proč.
//   2. **Klíč je repozitář + větev + cesta.**  Dva worktree nad jedním
//      repozitářem si musí překážet, dva klony ne.
//   3. **Expirace pustí zámek po spadlém běhu — a je to poznat.**  „Vzdal se
//      sám" a „umřel" jsou pro člověka dvě různé zprávy.
//   4. **Závod dvou zapisovatelů řeší databáze, ne `if`.**  Poslední test
//      obchází kód a píše přímo, aby ověřil, že to drží schéma.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import {
  acquireFileLock, refreshFileLock, releaseFileLock, releaseRunLocks,
  listHeldLocks, describeWorkspace, describeHolder, FileLockError, LOCK_TTL_MS,
} from '../src/executor/file-lock.js';

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

console.log('\n=== Zámek na soubor (027) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-lock-'));
const db = new Database(path.join(runtimeDir, 'lock.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

/** Dva různé stromy nad jedním repozitářem — přesně to, co má kolidovat. */
const worktreeA = { repoId: '/repo/.git', branch: 'main', root: '/repo', git: true };
const worktreeB = { repoId: '/repo/.git', branch: 'main', root: '/repo-wt', git: true };
const otherClone = { repoId: '/jiny-klon/.git', branch: 'main', root: '/jiny-klon', git: true };
const otherBranch = { repoId: '/repo/.git', branch: 'feature', root: '/repo', git: true };

function clear() {
  db.prepare('DELETE FROM file_write_locks').run();
}

// ── 1. Odmítnutí místo fronty ──────────────────────────────────────────────

await test('027 druhý běh je odmítnut okamžitě a dozví se, kdo soubor drží', () => {
  clear();
  const first = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/config.js', runId: 'run-A', ownerLabel: 'agent Alfa',
  });
  assert.equal(first.ok, true);

  const second = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/config.js', runId: 'run-B',
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'held');
  assert.equal(second.holder.runId, 'run-A');
  assert.equal(second.holder.ownerLabel, 'agent Alfa');

  // Věta pro člověka nese kdo a odkdy — a žádný obsah souboru.
  const sentence = describeHolder(second.holder);
  assert.match(sentence, /run-A/);
  assert.ok(!sentence.includes('config.js'), 'hlášení o zámku nese cestu k souboru');
});

await test('027 týž běh nedostane držený zámek podruhé — to je souběh, ne opakování', () => {
  clear();
  acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/config.js', runId: 'run-A', now: 1_000_000,
  });
  // Dřív se tohle považovalo za neškodné opakování a zámek se jen obnovil.
  // Jenže držený zámek znamená, že první operace **ještě běží** — review
  // reprodukovalo, že dva zápisy jedné relace obě vrátily `written: true`
  // a na disku zůstal jeden obsah.
  const again = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/config.js', runId: 'run-A', now: 1_060_000,
  });
  assert.equal(again.ok, false, 'druhá souběžná operace téhož běhu dostala zámek');
  assert.equal(again.reason, 'held_by_self');
  assert.equal(again.holder.self, true,
    'vlastní souběh se tváří jako cizí agent — to je pro uživatele jiná zpráva');
});

await test('027 sekvenční opakování téhož běhu projde — zámek se mezitím pustil', () => {
  clear();
  const first = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/config.js', runId: 'run-A', now: 1_000_000,
  });
  releaseFileLock(db, { lockId: first.lock.id, runId: 'run-A' });

  const again = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/config.js', runId: 'run-A', now: 1_060_000,
  });
  assert.equal(again.ok, true, 'po řádném puštění se týž běh k souboru nedostal');
  assert.notEqual(again.lock.id, first.lock.id, 'vrátil se starý řádek místo nové rezervace');
});

// ── 2. Co je stejná větev ──────────────────────────────────────────────────

await test('027 dva worktree nad jedním repozitářem si překážejí', () => {
  clear();
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' }).ok, true);
  const other = acquireFileLock(db, { workspace: worktreeB, filePath: 'src/a.js', runId: 'run-B' });
  assert.equal(other.ok, false, 'druhý worktree téhož repozitáře dostal zámek na týž soubor');
});

await test('027 dva klony si nepřekážejí — jsou to dva různé stromy', () => {
  clear();
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' }).ok, true);
  assert.equal(acquireFileLock(db, { workspace: otherClone, filePath: 'src/a.js', runId: 'run-B' }).ok, true);
});

await test('027 jiná větev je jiný klíč', () => {
  clear();
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' }).ok, true);
  assert.equal(acquireFileLock(db, { workspace: otherBranch, filePath: 'src/a.js', runId: 'run-B' }).ok, true);
});

await test('027 jiný soubor v téže větvi je jiný klíč — zámek neserializuje celý repozitář', () => {
  clear();
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' }).ok, true);
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/b.js', runId: 'run-B' }).ok, true);
});

await test('027 relativní a absolutní cesta k témuž souboru je týž klíč', () => {
  clear();
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' }).ok, true);
  const absolute = acquireFileLock(db, { workspace: worktreeA, filePath: '/repo/src/a.js', runId: 'run-B' });
  assert.equal(absolute.ok, false, 'táž cesta zapsaná jinak obešla zámek');
});

// ── 3. Expirace je poznat ──────────────────────────────────────────────────

await test('027 spadlý běh pustí zámek expirací — a je vidět, že to bylo takhle', () => {
  clear();
  acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/a.js', runId: 'run-mrtvy', now: 1_000_000,
  });

  const later = 1_000_000 + LOCK_TTL_MS + 1_000;
  const taken = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/a.js', runId: 'run-zivy', now: later,
  });
  assert.equal(taken.ok, true, 'expirovaný zámek pořád blokoval');

  const dead = db.prepare(`SELECT release_reason FROM file_write_locks WHERE run_id = 'run-mrtvy'`).get();
  assert.equal(dead.release_reason, 'expired',
    'uvolnění po pádu se nedá odlišit od uvolnění, které někdo udělal vědomě');
});

await test('027 živý běh si zámek udrží, i když čeká dlouho na rozhodnutí', () => {
  clear();
  const held = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/a.js', runId: 'run-ceka', now: 1_000_000,
  });
  // Přesně to, co dělá approval bez časového limitu (025): drží zámek, dokud
  // člověk neodpoví, a udržuje ho naživu.
  refreshFileLock(db, { lockId: held.lock.id, runId: 'run-ceka', now: 1_000_000 + LOCK_TTL_MS - 1 });
  const rival = acquireFileLock(db, {
    workspace: worktreeA, filePath: 'src/a.js', runId: 'run-B', now: 1_000_000 + LOCK_TTL_MS + 1,
  });
  assert.equal(rival.ok, false, 'obnovený zámek propadl');
});

await test('027 cizí běh nesmí prodloužit cizí zámek', () => {
  clear();
  const held = acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' });
  assert.throws(
    () => refreshFileLock(db, { lockId: held.lock.id, runId: 'run-B' }),
    error => error instanceof FileLockError && error.reason === 'not_holder',
  );
});

await test('027 konec běhu pustí všechno, co držel', () => {
  clear();
  acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' });
  acquireFileLock(db, { workspace: worktreeA, filePath: 'src/b.js', runId: 'run-A' });
  acquireFileLock(db, { workspace: worktreeA, filePath: 'src/c.js', runId: 'run-B' });

  assert.equal(releaseRunLocks(db, 'run-A'), 2);
  assert.equal(listHeldLocks(db).length, 1, 'úklid pustil i cizí zámek');
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-C' }).ok, true);
});

await test('027 uvolnění zámku, který už nikdo nedrží, není chyba', () => {
  clear();
  const held = acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' });
  assert.equal(releaseFileLock(db, { lockId: held.lock.id, runId: 'run-A' }), true);
  assert.equal(releaseFileLock(db, { lockId: held.lock.id, runId: 'run-A' }), false);
});

// ── 4. Pravidlo drží schéma, ne kód ────────────────────────────────────────

await test('027 dva držené zámky na jeden klíč odmítne databáze, i když se kód obejde', () => {
  clear();
  acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' });
  // Přímý zápis mimo modul: přesně to, co udělá příští cesta, která o zámku
  // neví.  Musí selhat na indexu, ne na dobré vůli volajícího.
  assert.throws(() => {
    db.prepare(`
      INSERT INTO file_write_locks (id, repo_id, branch, path, run_id, expires_at)
      VALUES ('podvod', ?, ?, 'src/a.js', 'run-B', '2099-01-01 00:00:00')
    `).run(worktreeA.repoId, worktreeA.branch);
  }, /UNIQUE|constraint/i);
});

await test('027 uvolněný zámek uvolní klíč pro dalšího', () => {
  clear();
  const held = acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-A' });
  releaseFileLock(db, { lockId: held.lock.id, runId: 'run-A' });
  assert.equal(acquireFileLock(db, { workspace: worktreeA, filePath: 'src/a.js', runId: 'run-B' }).ok, true);
  // Historie zůstává: dva řádky na týž klíč, jeden držený.
  const rows = db.prepare('SELECT COUNT(*) AS n FROM file_write_locks').get().n;
  assert.equal(rows, 2, 'uvolněný zámek se smazal, takže po něm nezbyla stopa');
});

// ── 5. Popis pracovního prostoru ───────────────────────────────────────────

await test('027 když git neodpoví, větev se nevymýšlí', () => {
  // Deterministicky, ne přes filesystem: izolovaný běh testů má TMPDIR uvnitř
  // repozitáře, takže „adresář v /tmp" je pořád v gitu a nic by to nedokázalo.
  // Vlastnost, o kterou jde, je „když se git nezeptáme úspěšně, nepředstíráme
  // větev" — a ta se ukáže na cestě, kde git skončí chybou.
  const nowhere = path.join(runtimeDir, 'tenhle-adresar-neexistuje');
  const workspace = describeWorkspace(nowhere);
  assert.equal(workspace.git, false);
  assert.equal(workspace.branch, '-', 'bez gitu se vymyslela větev');
  assert.equal(workspace.repoId, path.resolve(nowhere));
});

await test('027 uvnitř repozitáře je klíčem společný .git, ne pracovní adresář', () => {
  const workspace = describeWorkspace(process.cwd());
  assert.equal(workspace.git, true);
  assert.match(workspace.repoId, /\.git/);
  assert.ok(workspace.branch && workspace.branch !== 'HEAD');
});

db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nZámek na soubor: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
