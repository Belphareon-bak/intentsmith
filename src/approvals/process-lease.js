// Kdo zrovna žije — aby úklid nerušil běžící proces
// ==============================================================================
//
// Úklid při startu potřebuje odpovědět na jednu otázku: **je ten druhý proces
// mrtvý, nebo jen jiný?**  Do migrace `065` se to nerozlišovalo a `064` uzavíral
// všechno s cizím `boot_id`, takže dva backendy nad jednou databází by si
// navzájem rušily živé approvaly a zámky.
//
// Každý proces, který drží zámky nebo čeká na approvaly, si zapíše lease
// a **tepe** do něj.  Kdo nedýchá déle než `LEASE_TTL_MS`, je prohlášený za
// mrtvého a jeho pozůstatky se smí uklidit.
//
// ── Co z toho plyne pro `boot_id IS NULL` ──────────────────────────────────
//
// Zámek bez `boot_id` pochází z doby před migrací `064`.  Nemůže patřit živému
// procesu, protože **každý živý proces má dnes lease** — a kdo lease nemá,
// netepe.  Uklidit ho je proto prokazatelně bezpečné, ne jen pravděpodobně.
//
// ── Proč se tep nespoléhá na PID ───────────────────────────────────────────
//
// PID se recykluje a přes hranici kontejneru nic neznamená.  `pid` je tu jen
// pro člověka, který se na tabulku podívá; rozhoduje **čas posledního tepu**.
//
// ==============================================================================

/** Jak dlouho po posledním tepu je proces ještě považovaný za živý. */
export const LEASE_TTL_MS = 90_000;

/** Jak často se tepe.  Třikrát za TTL — jeden zmeškaný tep nic neznamená. */
export const LEASE_HEARTBEAT_MS = 30_000;

function sqlTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Zapiš lease tohohle procesu.  Idempotentní — restart se stejným `bootId`
 * (což se nestává, `bootId` je náhodný) by jen obnovil čas.
 */
export function beginLease(rawDb, { bootId, role = 'core', pid = process.pid, now = Date.now() } = {}) {
  if (!rawDb) return false;
  if (!bootId) throw new Error('beginLease: bootId required');
  const stamp = sqlTime(now);
  rawDb.prepare(`
    INSERT INTO process_leases (boot_id, role, pid, started_at, last_seen)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(boot_id) DO UPDATE SET last_seen = excluded.last_seen
  `).run(bootId, role, pid, stamp, stamp);
  return true;
}

/** Tep.  Vrací `false`, když řádek zmizel — to je poruchový stav, ne rutina. */
export function heartbeatLease(rawDb, { bootId, now = Date.now() } = {}) {
  if (!rawDb || !bootId) return false;
  return rawDb.prepare(
    'UPDATE process_leases SET last_seen = ? WHERE boot_id = ?',
  ).run(sqlTime(now), bootId).changes > 0;
}

/** Konec při řádném vypnutí.  Bez něj by proces „žil" ještě `LEASE_TTL_MS`. */
export function endLease(rawDb, { bootId } = {}) {
  if (!rawDb || !bootId) return false;
  try {
    return rawDb.prepare('DELETE FROM process_leases WHERE boot_id = ?').run(bootId).changes > 0;
  } catch {
    return false;
  }
}

/**
 * Hranice živosti pro SQL — čas, po kterém je lease mrtvý.
 *
 * Vrací se řetězec, protože se porovnává s `last_seen`, který je textový
 * `DATETIME`.  Volající ho vkládá do dotazu jako parametr, ne do `IN` seznamu:
 * množina živých se může měnit mezi čtením a zápisem a jeden dotaz je jediné
 * místo, kde to nevadí.
 */
export function livenessCutoff({ now = Date.now(), ttlMs = LEASE_TTL_MS } = {}) {
  return sqlTime(now - ttlMs);
}

/** Kdo je právě naživu — pro diagnostiku a pro testy. */
export function liveBoots(rawDb, { now = Date.now(), ttlMs = LEASE_TTL_MS } = {}) {
  if (!rawDb) return new Set();
  try {
    return new Set(rawDb.prepare(
      'SELECT boot_id FROM process_leases WHERE last_seen > ?',
    ).all(livenessCutoff({ now, ttlMs })).map(r => r.boot_id));
  } catch {
    // Tabulka nemusí existovat (starší databáze).  Prázdná množina znamená
    // „o nikom nevíme, že žije" — a úklid se pak chová jako před `065`.
    return new Set();
  }
}

export default {
  beginLease, heartbeatLease, endLease, liveBoots, livenessCutoff,
  LEASE_TTL_MS, LEASE_HEARTBEAT_MS,
};
