// v69.0 — Ledger Core: entity profiles, financial entries, audit history, calculation runs
export const version = '2026_02_19_008';
export const description = 'Ledger core tables for cash-based accounting (Phase 1)';

export function up(db) {
  // 1. Entity profiles — tenant isolation via entity_id
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'osvc'
        CHECK (entity_type IN ('osvc', 'sro', 'za')),
      vat_registered INTEGER DEFAULT 0,
      tax_regime TEXT DEFAULT 'actual'
        CHECK (tax_regime IN ('actual', 'flat_expense', 'flat_tax')),
      flat_expense_category TEXT
        CHECK (flat_expense_category IS NULL OR
               flat_expense_category IN ('rate_80', 'rate_60', 'rate_40', 'rate_30')),
      main_or_secondary TEXT DEFAULT 'main'
        CHECK (main_or_secondary IN ('main', 'secondary')),
      children INTEGER DEFAULT 0,
      spouse_credit INTEGER DEFAULT 0,
      rates_version TEXT DEFAULT '2025_v1',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 2. Financial entries — cash-based ledger (daňová evidence)
  //    Amounts in haléře (cents) to avoid floating point
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL
        CHECK (entry_type IN ('income', 'expense', 'tax_payment', 'insurance_payment')),
      amount_cents INTEGER NOT NULL,
      vat_rate REAL,
      vat_amount_cents INTEGER,
      category TEXT NOT NULL,
      description TEXT,
      document_ref TEXT,
      is_tax_deductible INTEGER DEFAULT 1,
      entry_date TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      version INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_fe_entity_year ON financial_entries(entity_id, period_year)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fe_entity_date ON financial_entries(entity_id, entry_date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fe_active ON financial_entries(entity_id, deleted_at)`);

  // 3. Entry history — audit trail for edits
  db.exec(`
    CREATE TABLE IF NOT EXISTS entry_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      changed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_eh_entry ON entry_history(entry_id)`);

  // 4. Calculation runs — reproducibility log
  db.exec(`
    CREATE TABLE IF NOT EXISTS calculation_runs (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      rates_version TEXT NOT NULL,
      input_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_entity_year ON calculation_runs(entity_id, year)`);
}
