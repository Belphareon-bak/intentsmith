// v130: Media generation history and output tracking
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_03_22_037_v130_media_generations';
export const description = 'Media generation history (ComfyUI multimedia module)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_generations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('txt2img','img2img','txt2vid')),
      prompt TEXT NOT NULL,
      negative_prompt TEXT DEFAULT '',
      params TEXT NOT NULL,
      workflow_template TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
      comfyui_prompt_id TEXT,
      outputs TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER,
      favorite INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_mg_status ON media_generations(status);
    CREATE INDEX IF NOT EXISTS idx_mg_created ON media_generations(created_at);
    CREATE INDEX IF NOT EXISTS idx_mg_favorite ON media_generations(favorite);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS media_generations;`);
}
