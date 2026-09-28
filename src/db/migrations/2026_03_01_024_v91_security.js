// Migration v91: API Tokens for Security
// ==============================================================================
//
// API token management with SHA-256 hashed storage.
// Raw tokens are NEVER stored — only hashes.
//
// ==============================================================================

export const version = '2026_03_01_024';
export const description = 'API tokens table (SHA-256 hashed)';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      scopes TEXT DEFAULT '[]',
      last_used_at DATETIME,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash)`);
}

export function down(db) {
  db.exec('DROP TABLE IF EXISTS api_tokens');
}
