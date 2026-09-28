// v70.0 — Period Locks: year closing + tax loss carryforward
export const version = '2026_02_20_009';
export const description = 'Period locks and tax loss carryforward for annual engine (Phase 2)';

export function up(db) {
  // 1. Period locks — prevents modification of closed fiscal years
  db.exec(`
    CREATE TABLE IF NOT EXISTS period_locks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      locked_at TEXT NOT NULL DEFAULT (datetime('now')),
      locked_by TEXT DEFAULT 'system',
      calculation_run_id TEXT REFERENCES calculation_runs(id),
      notes TEXT,
      UNIQUE(entity_id, year)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_pl_entity ON period_locks(entity_id)`);

  // 2. Tax losses — §34 ZDP: ztrátu lze uplatnit v následujících 5 letech
  db.exec(`
    CREATE TABLE IF NOT EXISTS tax_losses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      origin_year INTEGER NOT NULL,
      original_amount_cents INTEGER NOT NULL,
      remaining_cents INTEGER NOT NULL,
      expires_year INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_id, origin_year)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_tl_entity ON tax_losses(entity_id)`);
}
