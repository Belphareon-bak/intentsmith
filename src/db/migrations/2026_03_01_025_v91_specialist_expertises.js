// Migration v91: Specialist ↔ Expertise Binding (D5)
// ==============================================================================
//
// Tracks which expertises belong to which specialist.
// Supports labels (user-defined quick-match tags) and priority (favorites).
//
// Seeded from specialist manifest `expertises[]` during boot.
// New expertises can be bound dynamically via API or auto-bind after
// create-expertise skill completion.
//
// ==============================================================================

export const version = '2026_03_01_025';
export const description = 'Specialist expertise binding (D5)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS specialist_expertises (
      specialist_id TEXT NOT NULL,
      expertise_id TEXT NOT NULL,
      label TEXT,
      priority INTEGER DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (specialist_id, expertise_id)
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_spec_exp_specialist ON specialist_expertises(specialist_id)`);

  // Seed from existing specialist manifests
  const specialists = db.prepare('SELECT id, manifest_json FROM specialists WHERE status != ?').all('disabled');
  for (const row of specialists) {
    try {
      const manifest = JSON.parse(row.manifest_json);
      const expertises = manifest.expertises || [];
      const insert = db.prepare(
        'INSERT OR IGNORE INTO specialist_expertises (specialist_id, expertise_id, priority) VALUES (?, ?, ?)'
      );
      for (const expId of expertises) {
        insert.run(row.id, expId, 1); // manifest entries get priority=1 (favorite)
      }
    } catch (_) { /* skip malformed */ }
  }
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS specialist_expertises');
}
