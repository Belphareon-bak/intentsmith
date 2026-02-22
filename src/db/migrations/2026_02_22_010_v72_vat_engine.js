// Migration 010 — VAT Engine (Phase 4)
// ══════════════════════════════════════════════════════════════════════════════
//
// Extends financial_entries with VAT metadata for:
//   - Kontrolní hlášení (partner DIČ, číslo dokladu, DUZP)
//   - VAT return classification (vat_type)
//
// Creates vat_periods table for closed VAT periods.
//
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_02_22_010';

export function up(db) {
  // ── Extend financial_entries with VAT metadata ──
  // These columns are nullable — non-VAT entries simply leave them NULL.

  db.exec(`ALTER TABLE financial_entries ADD COLUMN supply_date TEXT`);
  db.exec(`ALTER TABLE financial_entries ADD COLUMN partner_dic TEXT`);
  db.exec(`ALTER TABLE financial_entries ADD COLUMN partner_name TEXT`);
  db.exec(`ALTER TABLE financial_entries ADD COLUMN document_number TEXT`);
  db.exec(`ALTER TABLE financial_entries ADD COLUMN vat_type TEXT DEFAULT NULL`);

  // Note: SQLite ALTER TABLE ADD COLUMN doesn't support CHECK constraints.
  // vat_type values are enforced at application level:
  //   'standard', 'reverse_charge', 'exempt', 'eu_acquisition', 'eu_supply', 'export', 'import'

  // ── VAT Periods ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS vat_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL REFERENCES entity_profiles(id) ON DELETE CASCADE,
      period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'closed')),
      submitted_at TEXT,
      vat_return_json TEXT,
      control_report_json TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_id, period_start)
    )
  `);

  // ── Indexes ──
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vp_entity ON vat_periods(entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fe_supply_date ON financial_entries(entity_id, supply_date) WHERE supply_date IS NOT NULL`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS vat_periods`);
  db.exec(`DROP INDEX IF EXISTS idx_fe_supply_date`);
  // Note: SQLite does not support DROP COLUMN. Columns remain but are unused.
}
