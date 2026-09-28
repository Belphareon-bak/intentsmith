// Migration 036 — Add verified column to model_overrides (v125)
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_12_036_v125_model_verified';
export const description = 'Add verified column to model_overrides for async background verification';

export function up(db) {
  // Check if column already exists (idempotent)
  const cols = db.prepare("PRAGMA table_info('model_overrides')").all();
  if (!cols.some(c => c.name === 'verified')) {
    db.exec('ALTER TABLE model_overrides ADD COLUMN verified INTEGER DEFAULT 1');
  }
}
