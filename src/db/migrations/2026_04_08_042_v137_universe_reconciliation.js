// Migration 042 — Model Universe reconciliation metadata (v137)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_04_08_042_v137_universe_reconciliation';
export const description = 'Add reconciliation/audit fields and derived lineage columns';

function hasColumn(db, table, column) {
  try {
    const cols = db.prepare(`PRAGMA table_info('${table}')`).all();
    return cols.some(c => c.name === column);
  } catch {
    return false;
  }
}

export function up(db) {
  // Derived lineage + compute metadata
  if (!hasColumn(db, 'model_universe_derived', 'based_on_version')) {
    db.exec('ALTER TABLE model_universe_derived ADD COLUMN based_on_version TEXT');
  }
  if (!hasColumn(db, 'model_universe_derived', 'last_computed_at')) {
    db.exec('ALTER TABLE model_universe_derived ADD COLUMN last_computed_at DATETIME');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_ud_based_on_version ON model_universe_derived(based_on_version)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ud_last_computed ON model_universe_derived(last_computed_at)');

  // Reconciliation audit context
  if (!hasColumn(db, 'model_reconciliation_log', 'reason_code')) {
    db.exec('ALTER TABLE model_reconciliation_log ADD COLUMN reason_code TEXT');
  }
  if (!hasColumn(db, 'model_reconciliation_log', 'effective_priority')) {
    db.exec('ALTER TABLE model_reconciliation_log ADD COLUMN effective_priority REAL');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_recon_reason ON model_reconciliation_log(reason_code)');
}

