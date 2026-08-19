// Jeden zapisovatel na soubor — rozhodnutí 027
// ==============================================================================
//
// Dva agenti, kteří sáhnou na týž soubor ve stejné větvi, se přepíší a ani
// jeden se to nedozví.  Tenhle modul tomu brání a je **první polovina** dvojice:
//
//   * **zámek zabrání** tomu, aby druhý běh do souboru vůbec sáhl;
//   * **předpoklad v approvalu** (rozhodnutí 025) pozná, že se cíl změnil, když
//     zabránit nešlo — protože soubor umí změnit i člověk v editoru, `git
//     checkout` nebo jiný nástroj, a ti o zámku nevědí.
//
// Kdyby existoval jen zámek, stačilo by jedno místo mimo něj a tichý přepis je
// zpátky.  Proto se to nedá zaměnit ani zjednodušit na jedno z toho.
//
// ── Tři vlastnosti, které dělají zámek zámkem ──────────────────────────────
//
//   1. **Odmítá se hned, nečeká se.**  Fronta by vyrobila běh, který stojí a
//      nikdo neví proč; odmítnutí pojmenuje držitele a je vidět okamžitě
//      (`027`).
//   2. **Vlastníkem je běh, ne agent.**  Jeden agent může mít víc běhů a
//      konflikt vzniká mezi zápisy, ne mezi identitami.
//   3. **Expirace je pojistka, ne úklid.**  Živý běh si zámek obnovuje; spadlý
//      ho po expiraci pustí a **je vidět, že ho pustil takhle**, ne že se ho
//      vzdal.  To jsou pro člověka dvě různé zprávy.
//
// ── Co je „stejná větev" ───────────────────────────────────────────────────
//
// Klíč je `repozitář + větev + cesta`, kde repozitář je **společný `.git`**, ne
// pracovní adresář.  Dva worktree nad jedním repozitářem sdílejí soubory
// historie, takže je zamykat zvlášť by dovolilo dvě současné změny téhož
// souboru v téže větvi.  Dva klony jsou naopak dva různé stromy a zamykají se
// nezávisle — proto klon, ne cesta k pracovnímu adresáři.
//
// ==============================================================================

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { BOOT_ID } from '../approvals/boot-id.js';
import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Výchozí životnost zámku. Živý běh si ji obnovuje; spadlý ji nechá vypršet. */
export const LOCK_TTL_MS = 15 * 60_000;

export class FileLockError extends Error {
  constructor(reason, detail = {}) {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function sqlTimeToMs(text) {
  if (!text) return 0;
  const ms = Date.parse(`${String(text).replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Čím je pracovní adresář pro účely zamykání.
 *
 * Mimo git repozitář se nevymýšlí náhrada: klíčem je pak absolutní cesta a
 * větev `-`.  Je to poctivější než předstírat větev, kterou nikdo nemá — a
 * pořád to chrání před dvěma běhy nad týmž adresářem.
 */
export function describeWorkspace(cwd = process.cwd()) {
  const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!commonDir) {
    return { repoId: path.resolve(cwd), branch: '-', root: path.resolve(cwd), git: false };
  }
  const root = git(['rev-parse', '--show-toplevel'], cwd) || path.resolve(cwd);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'HEAD';
  const head = branch === 'HEAD' ? git(['rev-parse', 'HEAD'], cwd) : null;
  return {
    repoId: path.resolve(commonDir),
    // Odpojená hlava není větev a nesmí splynout s žádnou jinou: dva běhy na
    // dvou různých commitech by jinak sdílely klíč.
    branch: head ? `detached:${head.slice(0, 12)}` : branch,
    root,
    git: true,
  };
}

/**
 * **Kanonický cíl** — jeden objekt, který se používá pro zámek, předpoklad
 * i zápis.
 *
 * Bez tohohle je identita souboru jen lexikální: `a/b.js`, `./a/b.js` a symlink
 * `link.js` mířící na `a/b.js` jsou tři různé řetězce a **týž inode**.  Dva
 * běhy by na ně dostaly dva zámky a přepsaly by se navzájem přesně tak, jak
 * `027` zakazuje.
 *
 * `realpath` se dělá na **nejbližšího existujícího předka**, ne jen na soubor
 * nebo jeho adresář.  Cíl často ještě neexistuje (vytváříme ho) a u hluboké
 * cesty neexistuje ani jeho adresář — `mkdir -p` teprve přijde.  Zastavit se na
 * prvním neúspěchu znamenalo spadnout do čistě lexikální podoby, ve které
 * symlink zůstal nerozmotaný: `strom/link/a/b/c.js` a `strom/skutecny/a/b/c.js`
 * pak byly dva klíče nad jedním budoucím inode a `027` mezi nimi nechránilo.
 *
 * Neexistující zbytek cesty se připojí tak, jak byl zadán.  Nic se o něm
 * netvrdí — symlink, který teprve vznikne, rozmotat nejde a předstírat to by
 * bylo horší než to přiznat.
 */
export function canonicalTarget(workspace, filePath) {
  const absolute = path.resolve(workspace.root, filePath);
  const real = resolveThroughNearestAncestor(absolute);

  let root = workspace.root;
  try { root = realpathSync(workspace.root); } catch { /* strom nemusí existovat (testy) */ }

  const relative = path.relative(root, real);
  return {
    repoId: workspace.repoId,
    branch: workspace.branch,
    // Soubor mimo strom (`../`) se klíčuje absolutní cestou — do relativní by
    // se schoval a dva různé soubory by mohly dostat týž klíč.
    path: relative.startsWith('..') ? real : relative,
    absolute,
    real,
  };
}

/**
 * Rozmotej cestu tak daleko, kam až skutečně vede.
 *
 * Jde se nahoru po předcích, dokud nějaký neexistuje; ten se rozmotá přes
 * `realpath` a zbytek cesty se na něj připojí zpátky.  Tím je symlink kdekoli v
 * existující části cesty rozmotaný, i když cíl ani jeho adresář zatím nejsou.
 */
function resolveThroughNearestAncestor(absolute) {
  const missing = [];
  let candidate = absolute;

  for (;;) {
    try {
      return path.join(realpathSync(candidate), ...missing);
    } catch { /* tenhle předek ještě neexistuje — o patro výš */ }

    const parent = path.dirname(candidate);
    // Kořen se nerozmotal: nezbývá než lexikální podoba.  Nastane jen tehdy,
    // když neexistuje ani `/`, což je stav, ve kterém stejně nic nezapíšeme.
    if (parent === candidate) return absolute;
    missing.unshift(path.basename(candidate));
    candidate = parent;
  }
}

function keyFor(workspace, filePath) {
  return canonicalTarget(workspace, filePath);
}

/**
 * Vezmi zámek, nebo řekni kdo ho drží.  **Nikdy nečeká.**
 *
 * @returns {{ok: true, lock: Object} | {ok: false, reason: 'held', holder: Object}}
 */
export function acquireFileLock(rawDb, {
  workspace, filePath, runId, ownerLabel = null,
  ttlMs = LOCK_TTL_MS, now = Date.now(),
} = {}) {
  if (!rawDb) throw new FileLockError('db_required');
  if (typeof runId !== 'string' || runId.trim() === '') throw new FileLockError('run_required');
  if (typeof filePath !== 'string' || filePath.trim() === '') throw new FileLockError('path_required');

  const key = keyFor(workspace || describeWorkspace(), filePath);

  // Expirovaný zámek se uvolní **s důvodem**, ne smazáním: kdo se na to podívá
  // po hodině, musí poznat, že tenhle běh nedoběhl, a ne že skončil.
  rawDb.prepare(`
    UPDATE file_write_locks
       SET released_at = ?, release_reason = 'expired'
     WHERE repo_id = ? AND branch = ? AND path = ?
       AND released_at IS NULL AND expires_at <= ?
  `).run(sqlTime(now), key.repoId, key.branch, key.path, sqlTime(now));

  const holder = readHeldLock(rawDb, key);
  if (holder) {
    // **Ani týž běh nedostane zámek dvakrát.**
    //
    // Dřív se to považovalo za neškodné opakování a zámek se jen obnovil.
    // Jenže „týž běh" a „týž běh, který ten zámek zrovna drží" jsou dvě různé
    // věci: držený zámek znamená, že první operace **ještě běží**.  Pustit
    // druhou vedle ní je přesně ten souběh, kterému má `027` bránit — a review
    // to reprodukovalo: dva zápisy jedné relace obě vrátily `written: true`
    // a na disku zůstal jeden obsah.
    //
    // Sekvenční opakování tím netrpí: první operace zámek v `finally` pustí,
    // takže druhá už žádný držený řádek nenajde.  Odmítne se jen skutečný
    // souběh, a ten se pojmenuje zvlášť, aby se nepletl s cizím agentem.
    const self = holder.run_id === runId;
    return {
      ok: false,
      reason: self ? 'held_by_self' : 'held',
      holder: {
        runId: holder.run_id,
        ownerLabel: holder.owner_label,
        since: holder.acquired_at,
        expiresAt: holder.expires_at,
        self,
      },
      key,
    };
  }

  const id = randomUUID();
  try {
    rawDb.prepare(`
      INSERT INTO file_write_locks
        (id, repo_id, branch, path, run_id, owner_label, acquired_at, expires_at, boot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, key.repoId, key.branch, key.path, runId, ownerLabel,
      sqlTime(now), sqlTime(now + ttlMs), BOOT_ID);
  } catch (error) {
    // Unikátní index promluvil dřív než my: mezi čtením a zápisem stihl zámek
    // vzít někdo jiný.  To není chyba volajícího, je to ten závod, kvůli
    // kterému index existuje — odpověď je stejná jako když jsme držitele viděli.
    const raced = readHeldLock(rawDb, key);
    if (raced) {
      return {
        ok: false,
        reason: 'held',
        holder: {
          runId: raced.run_id,
          ownerLabel: raced.owner_label,
          since: raced.acquired_at,
          expiresAt: raced.expires_at,
        },
        key,
      };
    }
    throw error;
  }

  return { ok: true, lock: readLock(rawDb, id), reentrant: false };
}

/**
 * Držím ten zámek **pořád**?
 *
 * Tohle je fencing: mezi vzetím zámku a efektem může uplynout hodina čekání na
 * člověka.  Když mezitím lease vyprší a zámek si vezme jiný běh, **můj zápis
 * už nesmí proběhnout** — jinak je `027` pravidlo, které platí jen když se nic
 * nestane.  Token není potřeba vymýšlet: id zámku je token, protože rival
 * dostane nový řádek s novým id.
 *
 * @returns {{ok: true} | {ok: false, reason: 'lost'|'expired', holder?: Object}}
 */
export function assertStillHeld(rawDb, { lockId, runId, now = Date.now() } = {}) {
  const row = rawDb.prepare(`
    SELECT id, run_id, repo_id, branch, path, expires_at, released_at, release_reason
      FROM file_write_locks WHERE id = ?
  `).get(lockId);

  if (!row || row.run_id !== runId) return { ok: false, reason: 'lost' };
  if (row.released_at) return { ok: false, reason: 'lost', releaseReason: row.release_reason };
  if (sqlTimeToMs(row.expires_at) <= now) {
    // Vypršel, i když ho zatím nikdo nepřevzal.  Zapisovat na základě propadlé
    // rezervace je totéž jako zapisovat bez ní — jen o to hůř, že si to
    // zapisovatel neuvědomuje.
    return { ok: false, reason: 'expired', expiresAt: row.expires_at };
  }

  // A ještě: je můj řádek opravdu ten držený pro tenhle klíč?  Kdyby moje
  // expirace prošla a někdo si zámek vzal a zase pustil, můj řádek by mohl
  // vypadat živě, ale mezitím do souboru sáhl někdo jiný.
  const held = rawDb.prepare(`
    SELECT id FROM file_write_locks
     WHERE repo_id = ? AND branch = ? AND path = ? AND released_at IS NULL
  `).get(row.repo_id, row.branch, row.path);
  if (!held || held.id !== lockId) return { ok: false, reason: 'lost' };

  return { ok: true };
}

/** Obnov expiraci. Jen vlastník — cizí běh nesmí prodloužit cizí zámek. */
export function refreshFileLock(rawDb, { lockId, runId, ttlMs = LOCK_TTL_MS, now = Date.now() } = {}) {
  const changed = rawDb.prepare(`
    UPDATE file_write_locks SET expires_at = ?
     WHERE id = ? AND run_id = ? AND released_at IS NULL
  `).run(sqlTime(now + ttlMs), lockId, runId).changes;
  if (changed === 0) throw new FileLockError('not_holder', { lockId, runId });
  return readLock(rawDb, lockId);
}

/** Uvolni zámek. Vrací `false`, když už držený nebyl — to není chyba. */
export function releaseFileLock(rawDb, { lockId, runId, reason = 'released', now = Date.now() } = {}) {
  return rawDb.prepare(`
    UPDATE file_write_locks
       SET released_at = ?, release_reason = ?
     WHERE id = ? AND run_id = ? AND released_at IS NULL
  `).run(sqlTime(now), reason, lockId, runId).changes > 0;
}

/**
 * Uvolni všechno, co drží běh.  Volá se, když běh skončí — jakkoli.
 * Bez tohohle by po každém pádu zůstal soubor zamčený až do expirace.
 */
export function releaseRunLocks(rawDb, runId, { reason = 'run_finished', now = Date.now() } = {}) {
  return rawDb.prepare(`
    UPDATE file_write_locks
       SET released_at = ?, release_reason = ?
     WHERE run_id = ? AND released_at IS NULL
  `).run(sqlTime(now), reason, runId).changes;
}

/**
 * Pusť zámky, které drží běh z **jiného spuštění procesu**.
 *
 * Zámek expiruje po `LOCK_TTL_MS`, což je pojistka proti spadlému běhu — ne
 * úklid po restartu.  Po restartu je jistota, ne domněnka: běh, který ten zámek
 * držel, neexistuje, a čekat na jeho expiraci znamená patnáct minut blokovat
 * soubor, o kterém víme, že ho nikdo nedrží.
 *
 * `release_reason` to říká nahlas — `boot_cleanup`, ne `expired`.  Kdo se na to
 * podívá později, má poznat, že tenhle běh nedoběhl kvůli restartu, a ne že mu
 * vypršel čas.
 */
export function releaseStaleLocks(rawDb, { bootId, now = Date.now() } = {}) {
  if (!bootId) throw new FileLockError('boot_id_required');
  return rawDb.prepare(`
    UPDATE file_write_locks
       SET released_at = ?, release_reason = 'boot_cleanup'
     WHERE released_at IS NULL
       AND (boot_id IS NULL OR boot_id <> ?)
  `).run(sqlTime(now), bootId).changes;
}

/** Co je právě zamčené — pro diagnostiku a pro obrazovku, která to ukáže. */
export function listHeldLocks(rawDb, { now = Date.now() } = {}) {
  return rawDb.prepare(`
    SELECT id, repo_id, branch, path, run_id, owner_label, acquired_at, expires_at
      FROM file_write_locks
     WHERE released_at IS NULL AND expires_at > ?
     ORDER BY acquired_at ASC
  `).all(sqlTime(now));
}

function readHeldLock(rawDb, key) {
  return rawDb.prepare(`
    SELECT * FROM file_write_locks
     WHERE repo_id = ? AND branch = ? AND path = ? AND released_at IS NULL
  `).get(key.repoId, key.branch, key.path) || null;
}

function readLock(rawDb, id) {
  return rawDb.prepare('SELECT * FROM file_write_locks WHERE id = ?').get(id) || null;
}

/** Věta pro člověka. Nesmí nést obsah souboru — jen kdo a odkdy. */
export function describeHolder(holder) {
  const who = holder.ownerLabel ? `${holder.ownerLabel} (${holder.runId})` : holder.runId;
  // Vlastní souběh je jiná zpráva než cizí agent: uživatel s tím může udělat
  // něco jiného, a „drží to jiný běh" by u vlastního běhu bylo matoucí.
  if (holder.self) {
    return `Na souboru už pracuje jiná operace téhož běhu (${who}, od ${holder.since}).`;
  }
  return `Soubor drží jiný běh: ${who}, od ${holder.since}.`;
}

export default {
  acquireFileLock, refreshFileLock, releaseFileLock, releaseRunLocks,
  listHeldLocks, describeWorkspace, describeHolder, canonicalTarget,
  assertStillHeld, releaseStaleLocks, LOCK_TTL_MS,
};
