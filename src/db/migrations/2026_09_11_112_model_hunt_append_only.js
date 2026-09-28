// SQLite REPLACE skips delete triggers when recursive_triggers is disabled.
export const version = '2026_09_11_112_model_hunt_append_only';
export const description = 'Reject hunt journal identity replacement before conflict handling';
export function up(db) {
  for (const [table, key] of [
    ['model_hunt_catalog', 'candidate_key'],
    ['model_hunt_attempts', 'attempt_id'],
    ['model_hunt_bootstrap', 'singleton'],
  ]) {
    db.exec(`
      CREATE TRIGGER trg_${table}_no_replace
      BEFORE INSERT ON ${table}
      WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${key} = NEW.${key})
      BEGIN SELECT RAISE(ABORT, 'hunt evidence identity is append-only'); END;
    `);
  }
}
