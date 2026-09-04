// Migrace 070 — které procesy zrovna žijí
// ==============================================================================
//
// Úklid při startu (`064`) uzavíral všechno s cizím `boot_id`.  „Cizí" ale není
// totéž co „mrtvý": dva backendy nad jednou databází by si tak navzájem rušily
// **živé** approvaly a zámky.  Komentáře v kódu přitom slibovaly opak — že se
// dva procesy navzájem neuklízejí — a to je horší než chyba samotná, protože
// čtenář se na ten slib spolehne.
//
//   process_leases   jeden řádek na běžící proces.  `last_seen` se obnovuje
//                    tepem; kdo nedýchá déle než `LEASE_TTL_MS`, je mrtvý.
//
// Díky tomu je úklid bezpečný **bez ohledu na to, kdo ho zavolá**.  Dnes ho volá
// jen `server.js`, ale kdyby ho někdy zavolala i gateway, živého coru se
// nedotkne — má platný lease.
//
// ── Proč lease a ne singleton ──────────────────────────────────────────────
//
// Vynutit „jeden backend na databázi" by vypadalo jednodušeji, jenže i singleton
// musí umět poznat, že předchozí držitel **umřel** — jinak by po pádu jeho
// značka blokovala start navždy.  Tím se singleton stejně zvrhne v lease plus
// odmítnutí startu, což je navíc tvrdší chování, než je potřeba.  Lease řeší
// tutéž věc a nikoho neodmítá.
//
// ==============================================================================

import { hasTable } from '../migrate.js';

export const version = '2026_08_21_070_process_leases';
export const description = 'Které procesy zrovna žijí — aby úklid nerušil živé (M1-b)';

export function up(db) {
  if (hasTable(db, 'process_leases')) return;
  db.exec(`
    CREATE TABLE process_leases (
      boot_id    TEXT PRIMARY KEY,
      role       TEXT NOT NULL,
      pid        INTEGER,
      started_at TEXT NOT NULL,
      last_seen  TEXT NOT NULL
    );
    CREATE INDEX idx_process_leases_seen ON process_leases (last_seen);
  `);
}

export function down(db) {
  if (hasTable(db, 'process_leases')) db.exec('DROP TABLE process_leases');
}
