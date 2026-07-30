// C.3 v64.0 Database Layer
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { runMigrations } from './migrate.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// ─── Auto-repair: load better-sqlite3 with native binding recovery ──────────
//
// When Node.js or system libraries get updated, the native .node binary
// compiled for the old ABI stops working. Instead of crashing silently,
// we detect the failure, run `npm rebuild`, and restart the process.
// Under `node --watch` (standard dev setup), exit(0) triggers auto-restart.
//
let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch (loadErr) {
  const isBindingError = /bindings|\.node|NAPI|MODULE_NOT_FOUND/i.test(loadErr.message);
  if (!isBindingError) throw loadErr;

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.error('');
  console.error('╔═══════════════════════════════════════════════════════════╗');
  console.error('║  better-sqlite3 native binding is missing/broken.       ║');
  console.error('║  This happens after Node.js or system library updates.  ║');
  console.error('║  Attempting auto-repair: npm rebuild ...                ║');
  console.error('╚═══════════════════════════════════════════════════════════╝');
  console.error('');

  try {
    execSync('npm rebuild better-sqlite3 --build-from-source', {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      env: { ...process.env, npm_config_loglevel: 'error' },
    });
    console.error('[C3:DB] ✓ Rebuild succeeded. Restarting process...');
    // ESM module cache is immutable — rebuilt .node file won't load
    // until a fresh process starts. Exit and let node --watch restart.
    process.exit(0);
  } catch (rebuildErr) {
    console.error('[C3:DB] ✗ Auto-repair FAILED:', rebuildErr.stderr?.toString().trim() || rebuildErr.message);
    console.error('');
    console.error('  Fix manually:');
    console.error(`    cd ${projectRoot}`);
    console.error('    npm rebuild better-sqlite3 --build-from-source');
    console.error('');
    process.exit(1);
  }
}

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find project root (directory containing package.json)
function findProjectRoot() {
  let dir = __dirname;
  
  // Walk up until we find package.json
  for (let i = 0; i < 10; i++) {
    const packagePath = path.join(dir, 'package.json');
    if (fs.existsSync(packagePath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;  // Reached filesystem root
    dir = parent;
  }
  
  // Fallback to cwd
  return process.cwd();
}

// Resolve database path
function resolveDbPath() {
  const configPath = config.db.path;  // Usually './data/c3.db'
  
  // If absolute path, use as-is
  if (path.isAbsolute(configPath)) {
    return configPath;
  }
  
  const projectRoot = findProjectRoot();
  const rootDbPath = path.join(projectRoot, configPath);
  
  // Always prefer project root location
  if (fs.existsSync(rootDbPath)) {
    logger.info('DB', `Using database at project root: ${rootDbPath}`);
    return rootDbPath;
  }
  
  // Fallback: check cwd
  const cwdDbPath = path.join(process.cwd(), configPath);
  if (fs.existsSync(cwdDbPath)) {
    logger.info('DB', `Using database at cwd: ${cwdDbPath}`);
    return cwdDbPath;
  }
  
  // No existing DB - create at project root
  logger.info('DB', `Creating new database at: ${rootDbPath}`);
  return rootDbPath;
}

const dbPath = resolveDbPath();

// Ensure data directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

logger.info('DB', 'Database initialized', { path: dbPath });

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA MIGRATIONS (v64.0)
// ════════════════════════════════════════════════════════════════════════════
// All schema changes go through src/db/migrations/*.js
// No more inline CREATE TABLE or ALTER TABLE in this file.

await runMigrations(db);

// ════════════════════════════════════════════════════════════════════════════
// REPOSITORIES
// ════════════════════════════════════════════════════════════════════════════

// Projects
export const projects = {
  create: db.prepare(`
    INSERT INTO projects (name, path, description) VALUES (?, ?, ?)
  `),

  // v59: Create external project (from "Open Folder")
  createExternal: db.prepare(`
    INSERT INTO projects (name, path, description, is_external) VALUES (?, ?, ?, 1)
  `),

  findByName: db.prepare(`
    SELECT * FROM projects WHERE name = ?
  `),

  findById: db.prepare(`
    SELECT * FROM projects WHERE id = ?
  `),

  findByPath: db.prepare(`
    SELECT * FROM projects WHERE path = ?
  `),

  updateLastActive: db.prepare(`
    UPDATE projects SET last_active = CURRENT_TIMESTAMP WHERE id = ?
  `),

  updateDescription: db.prepare(`
    UPDATE projects SET description = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?
  `),

  updateNameDesc: db.prepare(`
    UPDATE projects SET name = ?, description = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?
  `),

  list: db.prepare(`
    SELECT * FROM projects ORDER BY last_active DESC LIMIT ?
  `),

  listAll: db.prepare(`
    SELECT * FROM projects ORDER BY last_active DESC
  `),

  listRecent: db.prepare(`
    SELECT * FROM projects ORDER BY last_active DESC LIMIT ?
  `),

  delete: db.prepare(`DELETE FROM projects WHERE id = ?`),

  // Archive / Restore / Soft-delete
  // v88.1: Archive/delete add timestamp suffix to name; restore strips it
  _archiveRaw: db.prepare(`
    UPDATE projects SET status = 'archived', name = ?, archived_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  _restoreRaw: db.prepare(`
    UPDATE projects SET status = 'active', name = ?, archived_at = NULL, deleted_at = NULL WHERE id = ?
  `),
  _softDeleteRaw: db.prepare(`
    UPDATE projects SET status = 'deleted', name = ?, deleted_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  _updateName: db.prepare(`UPDATE projects SET name = ? WHERE id = ?`),

  _findActiveByName: db.prepare(`
    SELECT * FROM projects WHERE name = ? AND status NOT IN ('archived', 'deleted')
  `),

  archive: {
    run(id) {
      const proj = projects.findById.get(id);
      if (!proj) return;
      const suffix = `[archived-${Date.now()}]`;
      const newName = `${proj.name} ${suffix}`;
      projects._archiveRaw.run(newName, id);
    }
  },

  restore: {
    run(id) {
      const proj = projects.findById.get(id);
      if (!proj) return { conflict: false };
      // Strip suffix: "MyApp [archived-1709...]" → "MyApp"
      const originalName = proj.name.replace(/ \[(archived|deleted)-\d+\]$/, '');
      // Check if the original name is now taken by an active project
      const conflict = projects._findActiveByName.get(originalName);
      if (conflict) {
        // Keep a safe name — cannot restore to conflicting name
        projects._restoreRaw.run(proj.name, id);
        return { conflict: true, conflictWith: conflict.id, restoredName: proj.name, originalName };
      }
      projects._restoreRaw.run(originalName, id);
      return { conflict: false, restoredName: originalName };
    }
  },

  softDelete: {
    run(id) {
      const proj = projects.findById.get(id);
      if (!proj) return;
      const suffix = `[deleted-${Date.now()}]`;
      const newName = `${proj.name} ${suffix}`;
      projects._softDeleteRaw.run(newName, id);
    }
  },

  // Filtered listing (default = active only)
  listActive: db.prepare(`
    SELECT * FROM projects WHERE status = 'active' ORDER BY last_active DESC LIMIT ?
  `),

  listArchived: db.prepare(`
    SELECT * FROM projects WHERE status = 'archived' ORDER BY archived_at DESC LIMIT ?
  `),

  listNotDeleted: db.prepare(`
    SELECT * FROM projects WHERE status != 'deleted' ORDER BY last_active DESC LIMIT ?
  `),

  listDeleted: db.prepare(`
    SELECT * FROM projects WHERE status = 'deleted' ORDER BY deleted_at DESC LIMIT ?
  `),

  getOrCreate(name, projectPath, description = '') {
    let project = this.findByPath.get(projectPath);
    if (!project) {
      // v88.1: Check if name collides with an existing active project
      const nameConflict = this._findActiveByName.get(name);
      if (nameConflict) {
        // Name taken — caller gets the conflict info
        return { ...nameConflict, _nameConflict: true, _requestedName: name };
      }
      const result = this.create.run(name, projectPath, description);
      project = { id: result.lastInsertRowid, name, path: projectPath, description, is_external: 0 };
    } else if (project.status === 'archived' || project.status === 'deleted') {
      // v88.1: Path exists but project was archived/deleted — reactivate it
      const originalName = project.name.replace(/ \[(archived|deleted)-\d+\]$/, '');
      // Use the new name if provided, otherwise restore original
      const finalName = name || originalName;
      // Check the final name doesn't conflict
      const nameConflict = this._findActiveByName.get(finalName);
      if (nameConflict && nameConflict.id !== project.id) {
        return { ...nameConflict, _nameConflict: true, _requestedName: finalName };
      }
      this._restoreRaw.run(finalName, project.id);
      if (description) this.updateDescription.run(description, project.id);
      project.name = finalName;
      project.status = 'active';
      project.description = description || project.description;
    } else {
      // Update name/description if existing record has auto-generated name and caller provides a better one
      const needsNameUpdate = name && project.name !== name && /^lc-\d+$/.test(project.name);
      const needsDescUpdate = description && (!project.description || project.description === project.name);
      if (needsNameUpdate || needsDescUpdate) {
        const newName = needsNameUpdate ? name : project.name;
        const newDesc = needsDescUpdate ? description : project.description;
        this.updateNameDesc.run(newName, newDesc, project.id);
        project.name = newName;
        project.description = newDesc;
      } else {
        this.updateLastActive.run(project.id);
      }
    }
    return project;
  },

  /**
   * v59: Register external folder as project
   * Used by "Open Folder" feature - marks project as is_external=1
   */
  registerExternal(name, projectPath, description = '') {
    // Check if already registered
    let project = this.findByPath.get(projectPath);
    if (project) {
      if (project.status === 'archived' || project.status === 'deleted') {
        // v88.1: Reactivate archived/deleted project at same path
        const originalName = project.name.replace(/ \[(archived|deleted)-\d+\]$/, '');
        const finalName = name || originalName;
        const nameConflict = this._findActiveByName.get(finalName);
        const safeName = nameConflict && nameConflict.id !== project.id
          ? `${finalName} (${Date.now()})` : finalName;
        this._restoreRaw.run(safeName, project.id);
        if (description) this.updateDescription.run(description, project.id);
        project.name = safeName;
        project.status = 'active';
        return { project, wasExisting: true, reactivated: true };
      }
      this.updateLastActive.run(project.id);
      return { project, wasExisting: true };
    }

    // v88.1: Check name uniqueness only against active projects
    let finalName = name;
    let counter = 1;
    while (this._findActiveByName.get(finalName)) {
      finalName = `${name} (${counter++})`;
    }

    const result = this.createExternal.run(finalName, projectPath, description);
    project = {
      id: result.lastInsertRowid,
      name: finalName,
      path: projectPath,
      description,
      is_external: 1
    };
    return { project, wasExisting: false };
  },

  touch(id) {
    this.updateLastActive.run(id);
  }
};

// Global Memory
export const globalMemory = {
  get: db.prepare(`SELECT * FROM global_memory WHERE key = ?`),
  
  set: db.prepare(`
    INSERT INTO global_memory (key, value, category) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `),
  
  delete: db.prepare(`DELETE FROM global_memory WHERE key = ?`),
  
  listByCategory: db.prepare(`SELECT * FROM global_memory WHERE category = ?`),
  
  listAll: db.prepare(`SELECT * FROM global_memory ORDER BY category, key`),
  
  getValue(key, defaultValue = null) {
    const row = this.get.get(key);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },
  
  setValue(key, value, category = 'general') {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.set.run(key, strValue, category);
  }
};

// Project Memory
export const projectMemory = {
  get: db.prepare(`SELECT * FROM project_memory WHERE project_id = ? AND key = ?`),
  
  set: db.prepare(`
    INSERT INTO project_memory (project_id, key, value, category) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `),
  
  delete: db.prepare(`DELETE FROM project_memory WHERE project_id = ? AND key = ?`),
  
  listByProject: db.prepare(`SELECT * FROM project_memory WHERE project_id = ? ORDER BY category, key`),
  
  listByCategory: db.prepare(`SELECT * FROM project_memory WHERE project_id = ? AND category = ?`),
  
  getValue(projectId, key, defaultValue = null) {
    const row = this.get.get(projectId, key);
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  },
  
  setValue(projectId, key, value, category = 'general') {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.set.run(projectId, key, strValue, category);
  }
};

// Chat Sessions
export const chatSessions = {
  create: db.prepare(`
    INSERT INTO chat_sessions (session_id, project_id, title, metadata)
    VALUES (?, ?, ?, ?)
  `),
  
  findById: db.prepare(`SELECT * FROM chat_sessions WHERE session_id = ?`),
  
  updateState: db.prepare(`
    UPDATE chat_sessions SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?
  `),
  
  listRecent: db.prepare(`
    SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ?
  `),
  
  getOrCreate(sessionId, projectId = null, title = null) {
    let session = this.findById.get(sessionId);
    if (!session) {
      const result = this.create.run(sessionId, projectId, title, '{}');
      session = { id: result.lastInsertRowid, session_id: sessionId, project_id: projectId };
    }
    return session;
  }
};

// Chat Messages
export const chatMessages = {
  add: db.prepare(`
    INSERT INTO chat_messages (session_id, role, content, metadata)
    VALUES (?, ?, ?, ?)
  `),
  
  listBySession: db.prepare(`
    SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC
  `),
  
  search: db.prepare(`
    SELECT m.*, s.session_id as chat_session_id
    FROM chat_messages m
    JOIN chat_sessions s ON m.session_id = s.id
    WHERE m.id IN (SELECT rowid FROM chat_fts WHERE chat_fts MATCH ?)
    ORDER BY m.created_at DESC
    LIMIT ?
  `),
  
  addMessage(sessionDbId, role, content, metadata = {}) {
    const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
    return this.add.run(sessionDbId, role, content, metaStr);
  }
};

// Learned Patterns
export const learnedPatterns = {
  find: db.prepare(`SELECT * FROM learned_patterns WHERE pattern_hash = ?`),
  
  create: db.prepare(`
    INSERT INTO learned_patterns (pattern_hash, pattern_type, trigger_text, response_text, project_id)
    VALUES (?, ?, ?, ?, ?)
  `),
  
  incrementConfirm: db.prepare(`
    UPDATE learned_patterns 
    SET confirm_count = confirm_count + 1, 
        auto_apply = CASE WHEN confirm_count >= ? THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE pattern_hash = ?
  `),
  
  listAutoApply: db.prepare(`
    SELECT * FROM learned_patterns WHERE auto_apply = 1
  `),
  
  listByProject: db.prepare(`
    SELECT * FROM learned_patterns WHERE project_id = ? OR project_id IS NULL
  `),
  
  recordConfirmation(hash, trigger, response, projectId = null, threshold = 3) {
    const existing = this.find.get(hash);
    if (existing) {
      this.incrementConfirm.run(threshold, hash);
      return existing.confirm_count + 1;
    } else {
      this.create.run(hash, 'question', trigger, response, projectId);
      return 1;
    }
  }
};

// Workflow Sessions
export const workflowSessions = {
  create: db.prepare(`
    INSERT INTO workflow_sessions (session_id, project_id, state, complexity, request)
    VALUES (?, ?, ?, ?, ?)
  `),
  
  findById: db.prepare(`SELECT * FROM workflow_sessions WHERE session_id = ?`),
  
  update: db.prepare(`
    UPDATE workflow_sessions 
    SET state = ?, plan = ?, implementation = ?, timing = ?, updated_at = CURRENT_TIMESTAMP
    WHERE session_id = ?
  `),
  
  updateState: db.prepare(`
    UPDATE workflow_sessions SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?
  `),
  
  listActive: db.prepare(`
    SELECT * FROM workflow_sessions WHERE state NOT IN ('COMPLETED', 'FAILED')
    ORDER BY updated_at DESC
  `),

  listAll: db.prepare(`
    SELECT * FROM workflow_sessions ORDER BY updated_at DESC LIMIT 50
  `),

  getOrCreate(sessionId, projectId, request, complexity = 'SIMPLE') {
    let session = this.findById.get(sessionId);
    if (!session) {
      const result = this.create.run(sessionId, projectId, 'INIT', complexity, request);
      session = { 
        id: result.lastInsertRowid, 
        session_id: sessionId, 
        state: 'INIT',
        complexity,
        request
      };
    }
    return session;
  },
  
  save(sessionId, state, plan, implementation, timing) {
    const planStr = typeof plan === 'string' ? plan : JSON.stringify(plan);
    const implStr = typeof implementation === 'string' ? implementation : JSON.stringify(implementation);
    const timingStr = typeof timing === 'string' ? timing : JSON.stringify(timing);
    this.update.run(state, planStr, implStr, timingStr, sessionId);
  }
};

// Agents
export const agents = {
  create: db.prepare(`
    INSERT INTO agents (name, type, config, schedule) VALUES (?, ?, ?, ?)
  `),
  
  findByName: db.prepare(`SELECT * FROM agents WHERE name = ?`),
  
  updateStatus: db.prepare(`
    UPDATE agents SET status = ?, last_run = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `),
  
  updateNextRun: db.prepare(`
    UPDATE agents SET next_run = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?
  `),
  
  list: db.prepare(`SELECT * FROM agents ORDER BY name`),
  
  listScheduled: db.prepare(`
    SELECT * FROM agents WHERE type = 'scheduled' AND status != 'disabled'
  `),
};

// Agent Logs
export const agentLogs = {
  add: db.prepare(`
    INSERT INTO agent_logs (agent_id, run_id, level, message, data)
    VALUES (?, ?, ?, ?, ?)
  `),
  
  listByAgent: db.prepare(`
    SELECT * FROM agent_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  
  listByRun: db.prepare(`
    SELECT * FROM agent_logs WHERE run_id = ? ORDER BY created_at ASC
  `),
};

// ════════════════════════════════════════════════════════════════════════════
// NEW REPOSITORIES (v30 UI)
// ════════════════════════════════════════════════════════════════════════════

// Conversations
export const conversations = {
  create: db.prepare(`
    INSERT INTO conversations (id, project_id, title, summary)
    VALUES (?, ?, ?, ?)
  `),
  
  findById: db.prepare(`SELECT * FROM conversations WHERE id = ?`),
  
  findByProject: db.prepare(`
    SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC
  `),
  
  listRecent: db.prepare(`
    SELECT c.*, p.name as project_name 
    FROM conversations c 
    LEFT JOIN projects p ON c.project_id = p.id 
    ORDER BY c.updated_at DESC LIMIT ?
  `),
  
  listRecentGlobal: db.prepare(`
    SELECT * FROM conversations WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT ?
  `),
  
  listRecentByProject: db.prepare(`
    SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?
  `),
  
  updateTitle: db.prepare(`
    UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  
  updateSummary: db.prepare(`
    UPDATE conversations SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  
  assignToProject: db.prepare(`
    UPDATE conversations SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),
  
  delete: db.prepare(`DELETE FROM conversations WHERE id = ?`),

  // Archive / Restore / Soft-delete
  archive: db.prepare(`
    UPDATE conversations SET state = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  restore: db.prepare(`
    UPDATE conversations SET state = 'active', archived_at = NULL, deleted_at = NULL WHERE id = ?
  `),

  softDelete: db.prepare(`
    UPDATE conversations SET state = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  // Filtered listing (default = active only, excluding project conversations)
  listActive: db.prepare(`
    SELECT c.*, p.name as project_name
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.state = 'active' AND c.project_id IS NULL
    ORDER BY c.updated_at DESC LIMIT ?
  `),

  listArchived: db.prepare(`
    SELECT c.*, p.name as project_name
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.state = 'archived' AND c.project_id IS NULL
    ORDER BY c.archived_at DESC LIMIT ?
  `),

  listNotDeleted: db.prepare(`
    SELECT c.*, p.name as project_name
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.state != 'deleted' AND c.project_id IS NULL
    ORDER BY c.updated_at DESC LIMIT ?
  `),

  listDeleted: db.prepare(`
    SELECT c.*, p.name as project_name
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE c.state = 'deleted' AND c.project_id IS NULL
    ORDER BY c.deleted_at DESC LIMIT ?
  `),

  listActiveByProject: db.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND state = 'active' ORDER BY updated_at DESC LIMIT ?
  `),

  search: db.prepare(`
    SELECT DISTINCT c.*, p.name as project_name
    FROM conversations c
    LEFT JOIN projects p ON c.project_id = p.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
    ORDER BY c.updated_at DESC
    LIMIT ?
  `),
  
  getOrCreate(id, projectId = null, title = null) {
    let conv = this.findById.get(id);
    if (!conv) {
      this.create.run(id, projectId, title, null);
      conv = { id, project_id: projectId, title, message_count: 0 };
    }
    return conv;
  }
};

// Messages (new system)
export const messages = {
  add: db.prepare(`
    INSERT INTO messages (conversation_id, role, content, tokens, metadata)
    VALUES (?, ?, ?, ?, ?)
  `),
  
  listByConversation: db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `),
  
  listRecentByConversation: db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
  `),
  
  getLastN: db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC
  `),
  
  delete: db.prepare(`DELETE FROM messages WHERE id = ?`),
  
  search: db.prepare(`
    SELECT m.*, c.title as conversation_title, p.name as project_name
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    LEFT JOIN projects p ON c.project_id = p.id
    WHERE m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)
    ORDER BY m.created_at DESC
    LIMIT ?
  `),
  
  addMessage(conversationId, role, content, tokens = null, metadata = {}) {
    const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
    return this.add.run(conversationId, role, content, tokens, metaStr);
  }
};

// Attachments
export const attachments = {
  add: db.prepare(`
    INSERT INTO attachments (conversation_id, project_id, filename, original_name, mime_type, size, hash, path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  
  findByHash: db.prepare(`SELECT * FROM attachments WHERE hash = ?`),
  
  findById: db.prepare(`SELECT * FROM attachments WHERE id = ?`),
  
  listByConversation: db.prepare(`
    SELECT * FROM attachments WHERE conversation_id = ? ORDER BY created_at DESC
  `),
  
  listByProject: db.prepare(`
    SELECT * FROM attachments WHERE project_id = ? ORDER BY created_at DESC
  `),
  
  getTotalSize: db.prepare(`SELECT SUM(size) as total FROM attachments`),
  
  getTotalSizeByProject: db.prepare(`SELECT SUM(size) as total FROM attachments WHERE project_id = ?`),
  
  delete: db.prepare(`DELETE FROM attachments WHERE id = ?`),
  
  create(conversationId, projectId, filename, originalName, mimeType, size, hash, filePath) {
    const result = this.add.run(conversationId, projectId, filename, originalName, mimeType, size, hash, filePath);
    return result.lastInsertRowid;
  }
};

// Drafts
export const drafts = {
  getByConversation: db.prepare(`SELECT * FROM drafts WHERE conversation_id = ?`),
  
  getByProject: db.prepare(`SELECT * FROM drafts WHERE project_id = ? AND conversation_id IS NULL`),
  
  getGlobal: db.prepare(`SELECT * FROM drafts WHERE conversation_id IS NULL AND project_id IS NULL`),
  
  upsertByConversation: db.prepare(`
    INSERT INTO drafts (conversation_id, content) VALUES (?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `),
  
  upsertByProject: db.prepare(`
    INSERT INTO drafts (project_id, content) VALUES (?, ?)
    ON CONFLICT(project_id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP
  `),
  
  deleteByConversation: db.prepare(`DELETE FROM drafts WHERE conversation_id = ?`),
  
  deleteByProject: db.prepare(`DELETE FROM drafts WHERE project_id = ?`),
  
  save(content, conversationId = null, projectId = null) {
    if (conversationId) {
      this.upsertByConversation.run(conversationId, content);
    } else if (projectId) {
      this.upsertByProject.run(projectId, content);
    }
  },
  
  get(conversationId = null, projectId = null) {
    if (conversationId) {
      return this.getByConversation.get(conversationId);
    } else if (projectId) {
      return this.getByProject.get(projectId);
    }
    return this.getGlobal.get();
  },
  
  clear(conversationId = null, projectId = null) {
    if (conversationId) {
      this.deleteByConversation.run(conversationId);
    } else if (projectId) {
      this.deleteByProject.run(projectId);
    }
  }
};

// ════════════════════════════════════════════════════════════════════════════
// v57: EXPERT REPOSITORIES
// ════════════════════════════════════════════════════════════════════════════

// Expertises (renamed from experts in v69)
export const expertises = {
  create: db.prepare(`
    INSERT INTO expertises (id, name, description, domain, system_prompt, temperature, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`SELECT * FROM expertises WHERE id = ?`),

  findByDomain: db.prepare(`SELECT * FROM expertises WHERE domain = ?`),

  listAll: db.prepare(`SELECT * FROM expertises ORDER BY name`),

  listCustom: db.prepare(`SELECT * FROM expertises WHERE is_builtin = 0 ORDER BY name`),

  update: db.prepare(`
    UPDATE expertises
    SET name = ?, description = ?, domain = ?, system_prompt = ?, temperature = ?, config = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  delete: db.prepare(`DELETE FROM expertises WHERE id = ? AND is_builtin = 0`),

  /**
   * Create or update an expert
   */
  upsert(id, name, description, domain, systemPrompt, temperature, config) {
    const configStr = typeof config === 'string' ? config : JSON.stringify(config);
    const existing = this.findById.get(id);
    if (existing) {
      this.update.run(name, description, domain, systemPrompt, temperature, configStr, id);
    } else {
      this.create.run(id, name, description, domain, systemPrompt, temperature, configStr);
    }
  },

  /**
   * Get expert config as parsed object
   */
  getConfig(id) {
    const row = this.findById.get(id);
    if (!row) return null;
    try {
      return { ...row, config: JSON.parse(row.config) };
    } catch {
      return row;
    }
  }
};

// Expertise Bindings (renamed from conversation_experts in v69)
export const expertiseBindings = {
  get: db.prepare(`SELECT * FROM expertise_bindings WHERE conversation_id = ?`),

  create: db.prepare(`
    INSERT INTO expertise_bindings (conversation_id, expertise_id, locked, strength, locked_at)
    VALUES (?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE expertise_bindings
    SET expertise_id = ?, locked = ?, strength = ?, locked_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
  `),

  delete: db.prepare(`DELETE FROM expertise_bindings WHERE conversation_id = ?`),

  lock: db.prepare(`
    UPDATE expertise_bindings
    SET locked = 1, locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
  `),

  unlock: db.prepare(`
    UPDATE expertise_bindings
    SET locked = 0, locked_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
  `),

  /**
   * Set expert for conversation (creates or updates)
   */
  setExpertise(conversationId, expertiseId, options = {}) {
    const locked = options.locked ? 1 : 0;
    const strength = options.strength ?? 50;
    const lockedAt = locked ? new Date().toISOString() : null;

    const existing = this.get.get(conversationId);
    if (existing) {
      this.update.run(expertiseId, locked, strength, lockedAt, conversationId);
    } else {
      this.create.run(conversationId, expertiseId, locked, strength, lockedAt);
    }
  },

  /**
   * Get expert binding for conversation
   */
  getBinding(conversationId) {
    return this.get.get(conversationId) || null;
  },

  /**
   * Clear expert for conversation
   */
  clearExpertise(conversationId) {
    this.delete.run(conversationId);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// v63: MULTI-EXPERTISE REPOSITORIES (Merge Engine v2)
// ════════════════════════════════════════════════════════════════════════════

// Conversation Expertises (multi-expertise N:M, max 3)
export const conversationExpertises = {
  add: db.prepare(`
    INSERT INTO conversation_expertises (conversation_id, expertise_id, weight, position)
    VALUES (?, ?, ?, ?)
  `),

  findByConversation: db.prepare(`
    SELECT * FROM conversation_expertises
    WHERE conversation_id = ? ORDER BY position ASC
  `),

  deleteOne: db.prepare(`
    DELETE FROM conversation_expertises
    WHERE conversation_id = ? AND expertise_id = ?
  `),

  deleteAll: db.prepare(`
    DELETE FROM conversation_expertises WHERE conversation_id = ?
  `),

  updateWeight: db.prepare(`
    UPDATE conversation_expertises SET weight = ?
    WHERE conversation_id = ? AND expertise_id = ?
  `),

  count: db.prepare(`
    SELECT COUNT(*) as cnt FROM conversation_expertises WHERE conversation_id = ?
  `),

  /**
   * Replace all expertises for a conversation.
   * @param {string} conversationId
   * @param {Array<{id: string, weight: number, position?: number}>} expertises
   */
  setExpertises(conversationId, expertises) {
    const tx = db.transaction(() => {
      this.deleteAll.run(conversationId);
      for (const e of expertises) {
        const eid = e.expertiseId || e.id;
        this.add.run(conversationId, eid, e.weight, e.position ?? 0);
      }
    });
    tx();
  },

  /**
   * @param {string} conversationId
   * @returns {Array<{expertise_id: string, weight: number, position: number}>}
   */
  getExpertises(conversationId) {
    return this.findByConversation.all(conversationId);
  },
};

// Merge Audit Log
export const mergeAuditLog = {
  add: db.prepare(`
    INSERT INTO merge_audit_log (conversation_id, execution_trace_id, timestamp, data)
    VALUES (?, ?, ?, ?)
  `),

  findByConversation: db.prepare(`
    SELECT * FROM merge_audit_log
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10
  `),

  findByTraceId: db.prepare(`
    SELECT * FROM merge_audit_log
    WHERE execution_trace_id = ? ORDER BY created_at ASC
  `),

  /**
   * @param {string} conversationId
   * @param {Object} auditData
   * @param {string} [executionTraceId]
   */
  log(conversationId, auditData, executionTraceId = null) {
    const timestamp = new Date().toISOString();
    const dataStr = typeof auditData === 'string'
      ? auditData : JSON.stringify(auditData);
    this.add.run(conversationId, executionTraceId, timestamp, dataStr);
  },
};

// Capability Drift Log (v63.2 — per-response drift tracking)
// v63.3: execution_trace_id + execution_step for cross-layer tracing
export const capabilityDriftLog = {
  add: db.prepare(`
    INSERT INTO capability_drift_log (conversation_id, execution_trace_id, expertise_id, merged_prompt_hash, expected_profile, observed_scores, drift_score, violations, execution_step)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByConversation: db.prepare(`
    SELECT * FROM capability_drift_log
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20
  `),

  findByExpertise: db.prepare(`
    SELECT * FROM capability_drift_log
    WHERE expertise_id = ? ORDER BY created_at DESC LIMIT 50
  `),

  findByTraceId: db.prepare(`
    SELECT * FROM capability_drift_log
    WHERE execution_trace_id = ? ORDER BY created_at ASC
  `),

  avgDriftByExpertise: db.prepare(`
    SELECT expertise_id, AVG(drift_score) as avg_drift, COUNT(*) as sample_count
    FROM capability_drift_log
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY expertise_id
    ORDER BY avg_drift DESC
  `),

  /**
   * @param {Object} entry
   */
  log(entry) {
    this.add.run(
      entry.conversationId || null,
      entry.executionTraceId || null,
      entry.expertiseId,
      entry.mergedPromptHash || null,
      JSON.stringify(entry.expectedProfile),
      JSON.stringify(entry.observedScores),
      entry.driftScore,
      entry.violations ? JSON.stringify(entry.violations) : null,
      entry.executionStep || null,
    );
  },
};

// LLM Execution Log (v63.3 — per-call audit with execution trace)
export const llmExecutionLog = {
  add: db.prepare(`
    INSERT INTO llm_execution_log (execution_trace_id, conversation_id, execution_step, expertise_id, model, temperature, prompt_hash, prompt_tokens, completion_tokens, latency_ms, token_source, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByTraceId: db.prepare(`
    SELECT * FROM llm_execution_log
    WHERE execution_trace_id = ? ORDER BY created_at ASC
  `),

  findByConversation: db.prepare(`
    SELECT * FROM llm_execution_log
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20
  `),

  findByPromptHash: db.prepare(`
    SELECT * FROM llm_execution_log
    WHERE prompt_hash = ? ORDER BY created_at DESC LIMIT 10
  `),

  /**
   * @param {Object} entry
   */
  log(entry) {
    this.add.run(
      entry.executionTraceId || null,
      entry.conversationId || null,
      entry.executionStep || 'LLM',
      entry.expertiseId || null,
      entry.model || null,
      entry.temperature ?? null,
      entry.promptHash || null,
      entry.promptTokens ?? null,
      entry.completionTokens ?? null,
      entry.latencyMs ?? null,
      entry.tokenSource || 'estimated',
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    );
  },
};

// ════════════════════════════════════════════════════════════════════════════
// v61: LIFECYCLE REPOSITORIES (Phase C — Collaborative Milestone Execution)
// ════════════════════════════════════════════════════════════════════════════

// Project Lifecycles
export const lifecycles = {
  create: db.prepare(`
    INSERT INTO project_lifecycles (id, project_id, phase, spec, config)
    VALUES (?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`SELECT * FROM project_lifecycles WHERE id = ?`),

  findByProject: db.prepare(`
    SELECT * FROM project_lifecycles WHERE project_id = ? ORDER BY updated_at DESC
  `),

  findActiveByProject: db.prepare(`
    SELECT * FROM project_lifecycles
    WHERE project_id = ? AND phase NOT IN ('COMPLETED', 'FAILED')
    ORDER BY updated_at DESC LIMIT 1
  `),

  updatePhase: db.prepare(`
    UPDATE project_lifecycles SET phase = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  updateSpec: db.prepare(`
    UPDATE project_lifecycles SET spec = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  updateConfig: db.prepare(`
    UPDATE project_lifecycles SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  // v62: C4 multi-session — track which session owns the lifecycle
  updateActiveSession: db.prepare(`
    UPDATE project_lifecycles SET active_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  save(id, projectId, phase, spec = null, lifecycleConfig = {}) {
    const specStr = spec ? (typeof spec === 'string' ? spec : JSON.stringify(spec)) : null;
    const configStr = typeof lifecycleConfig === 'string' ? lifecycleConfig : JSON.stringify(lifecycleConfig);
    const existing = this.findById.get(id);
    if (existing) {
      this.updatePhase.run(phase, id);
      if (spec) this.updateSpec.run(specStr, id);
    } else {
      this.create.run(id, projectId, phase, specStr, configStr);
    }
  },

  getSpec(id) {
    const row = this.findById.get(id);
    if (!row || !row.spec) return null;
    try { return JSON.parse(row.spec); } catch { return row.spec; }
  },

  getConfig(id) {
    const row = this.findById.get(id);
    if (!row) return {};
    try { return JSON.parse(row.config); } catch { return {}; }
  },
};

// Roadmap Versions (immutable)
export const roadmapVersions = {
  create: db.prepare(`
    INSERT INTO roadmap_versions (lifecycle_id, version, roadmap, change_reason, diff_summary)
    VALUES (?, ?, ?, ?, ?)
  `),

  findByLifecycle: db.prepare(`
    SELECT * FROM roadmap_versions WHERE lifecycle_id = ? ORDER BY version DESC
  `),

  findLatest: db.prepare(`
    SELECT * FROM roadmap_versions WHERE lifecycle_id = ? ORDER BY version DESC LIMIT 1
  `),

  findByVersion: db.prepare(`
    SELECT * FROM roadmap_versions WHERE lifecycle_id = ? AND version = ?
  `),

  addVersion(lifecycleId, version, roadmap, changeReason = null, diffSummary = null) {
    const roadmapStr = typeof roadmap === 'string' ? roadmap : JSON.stringify(roadmap);
    this.create.run(lifecycleId, version, roadmapStr, changeReason, diffSummary);
  },

  getLatestRoadmap(lifecycleId) {
    const row = this.findLatest.get(lifecycleId);
    if (!row) return null;
    try { return { ...row, roadmap: JSON.parse(row.roadmap) }; } catch { return row; }
  },

  getLatestVersion(lifecycleId) {
    const row = this.findLatest.get(lifecycleId);
    return row ? row.version : 0;
  },
};

// Milestones
export const milestones = {
  create: db.prepare(`
    INSERT INTO milestones (id, lifecycle_id, roadmap_version, sequence, title, description,
      status, dependencies, estimated_loc, estimated_files, estimated_complexity,
      test_strategy, local_plan, scope_files, max_retries, checkpoint_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`SELECT * FROM milestones WHERE id = ?`),

  findByLifecycle: db.prepare(`
    SELECT * FROM milestones WHERE lifecycle_id = ? ORDER BY sequence ASC
  `),

  findByStatus: db.prepare(`
    SELECT * FROM milestones WHERE lifecycle_id = ? AND status = ? ORDER BY sequence ASC
  `),

  findNext: db.prepare(`
    SELECT * FROM milestones WHERE lifecycle_id = ? AND status = 'PENDING'
    ORDER BY sequence ASC LIMIT 1
  `),

  updateStatus: db.prepare(`
    UPDATE milestones SET status = ? WHERE id = ?
  `),

  updateLocalPlan: db.prepare(`
    UPDATE milestones SET local_plan = ?, scope_files = ? WHERE id = ?
  `),

  updateWorkflowSession: db.prepare(`
    UPDATE milestones SET workflow_session_id = ? WHERE id = ?
  `),

  updateCompletion: db.prepare(`
    UPDATE milestones SET status = 'PASSED', commit_hash = ?, git_tag = ?,
      health_score = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  updateRetry: db.prepare(`
    UPDATE milestones SET retry_count = retry_count + 1 WHERE id = ?
  `),

  markStarted: db.prepare(`
    UPDATE milestones SET started_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  countByStatus: db.prepare(`
    SELECT status, COUNT(*) as count FROM milestones WHERE lifecycle_id = ? GROUP BY status
  `),

  addMilestone(data) {
    const deps = typeof data.dependencies === 'string' ? data.dependencies : JSON.stringify(data.dependencies || []);
    const testStr = data.test_strategy ? (typeof data.test_strategy === 'string' ? data.test_strategy : JSON.stringify(data.test_strategy)) : null;
    const planStr = data.local_plan ? (typeof data.local_plan === 'string' ? data.local_plan : JSON.stringify(data.local_plan)) : null;
    const scopeStr = data.scope_files ? (typeof data.scope_files === 'string' ? data.scope_files : JSON.stringify(data.scope_files)) : null;

    this.create.run(
      data.id, data.lifecycle_id, data.roadmap_version, data.sequence,
      data.title, data.description || null,
      data.status || 'PENDING', deps,
      data.estimated_loc || 0, data.estimated_files || 0,
      data.estimated_complexity || 'MEDIUM',
      testStr, planStr, scopeStr,
      data.max_retries || 3,
      data.checkpoint_mode || 'FUNCTIONAL'
    );
  },

  getMilestone(id) {
    const row = this.findById.get(id);
    if (!row) return null;
    return parseMilestoneJSON(row);
  },

  listByLifecycle(lifecycleId) {
    return this.findByLifecycle.all(lifecycleId).map(parseMilestoneJSON);
  },

  getCompleted(lifecycleId) {
    return this.findByStatus.all(lifecycleId, 'PASSED').map(parseMilestoneJSON);
  },
};

function parseMilestoneJSON(row) {
  const parsed = { ...row };
  for (const field of ['dependencies', 'test_strategy', 'local_plan', 'scope_files', 'health_score']) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try { parsed[field] = JSON.parse(parsed[field]); } catch { /* keep string */ }
    }
  }
  return parsed;
}

// Change Requests
export const changeRequests = {
  create: db.prepare(`
    INSERT INTO change_requests (id, lifecycle_id, status, description,
      affected_milestones, impact_analysis, proposed_roadmap_diff, old_roadmap_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`SELECT * FROM change_requests WHERE id = ?`),

  findByLifecycle: db.prepare(`
    SELECT * FROM change_requests WHERE lifecycle_id = ? ORDER BY created_at DESC
  `),

  findPending: db.prepare(`
    SELECT * FROM change_requests WHERE lifecycle_id = ? AND status IN ('PROPOSED', 'ANALYZED')
    ORDER BY created_at ASC
  `),

  updateStatus: db.prepare(`
    UPDATE change_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  updateAnalysis: db.prepare(`
    UPDATE change_requests SET status = 'ANALYZED', impact_analysis = ?,
      affected_milestones = ?, proposed_roadmap_diff = ? WHERE id = ?
  `),

  updateApplied: db.prepare(`
    UPDATE change_requests SET status = 'APPLIED', new_roadmap_version = ?,
      resolved_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  addRequest(data) {
    const affectedStr = typeof data.affected_milestones === 'string'
      ? data.affected_milestones : JSON.stringify(data.affected_milestones || []);
    const impactStr = data.impact_analysis
      ? (typeof data.impact_analysis === 'string' ? data.impact_analysis : JSON.stringify(data.impact_analysis))
      : null;
    const diffStr = data.proposed_roadmap_diff
      ? (typeof data.proposed_roadmap_diff === 'string' ? data.proposed_roadmap_diff : JSON.stringify(data.proposed_roadmap_diff))
      : null;

    this.create.run(
      data.id, data.lifecycle_id, data.status || 'PROPOSED', data.description,
      affectedStr, impactStr, diffStr, data.old_roadmap_version || null
    );
  },

  getRequest(id) {
    const row = this.findById.get(id);
    if (!row) return null;
    return parseChangeRequestJSON(row);
  },
};

function parseChangeRequestJSON(row) {
  const parsed = { ...row };
  for (const field of ['affected_milestones', 'impact_analysis', 'proposed_roadmap_diff']) {
    if (parsed[field] && typeof parsed[field] === 'string') {
      try { parsed[field] = JSON.parse(parsed[field]); } catch { /* keep string */ }
    }
  }
  return parsed;
}

// Drift Checks
export const driftChecks = {
  create: db.prepare(`
    INSERT INTO drift_checks (lifecycle_id, milestone_id, check_type, result, details)
    VALUES (?, ?, ?, ?, ?)
  `),

  findByLifecycle: db.prepare(`
    SELECT * FROM drift_checks WHERE lifecycle_id = ? ORDER BY created_at DESC, id DESC
  `),

  findByMilestone: db.prepare(`
    SELECT * FROM drift_checks WHERE milestone_id = ? ORDER BY created_at DESC, id DESC
  `),

  findByType: db.prepare(`
    SELECT * FROM drift_checks WHERE lifecycle_id = ? AND check_type = ? ORDER BY created_at DESC
  `),

  findLatestByType: db.prepare(`
    SELECT * FROM drift_checks WHERE lifecycle_id = ? AND check_type = ?
    ORDER BY created_at DESC LIMIT 1
  `),

  addCheck(lifecycleId, milestoneId, checkType, result, details = null) {
    const detailsStr = details
      ? (typeof details === 'string' ? details : JSON.stringify(details))
      : null;
    this.create.run(lifecycleId, milestoneId, checkType, result, detailsStr);
  },

  getChecks(lifecycleId) {
    return this.findByLifecycle.all(lifecycleId).map(parseDriftCheckJSON);
  },

  getChecksByMilestone(milestoneId) {
    return this.findByMilestone.all(milestoneId).map(parseDriftCheckJSON);
  },

  getByType(lifecycleId, checkType) {
    return this.findByType.all(lifecycleId, checkType).map(parseDriftCheckJSON);
  },

  getLatestByType(lifecycleId, checkType) {
    const row = this.findLatestByType.get(lifecycleId, checkType);
    return row ? parseDriftCheckJSON(row) : null;
  },
};

function parseDriftCheckJSON(row) {
  const parsed = { ...row };
  if (parsed.details && typeof parsed.details === 'string') {
    try { parsed.details = JSON.parse(parsed.details); } catch { /* keep string */ }
  }
  return parsed;
}

// ════════════════════════════════════════════════════════════════════════════
// v62: LIFECYCLE HANDOFF STATE (crash recovery — RAM+DB dual-write)
// ════════════════════════════════════════════════════════════════════════════

export const lifecycleHandoffState = {
  upsert: db.prepare(`
    INSERT INTO lifecycle_handoff_state
      (session_id, phase, lifecycle_id, current_milestone_id, original_request, project_id, project_path, change_request_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id) DO UPDATE SET
      phase=excluded.phase, lifecycle_id=excluded.lifecycle_id,
      current_milestone_id=excluded.current_milestone_id,
      original_request=excluded.original_request, project_id=excluded.project_id,
      project_path=excluded.project_path, change_request_id=excluded.change_request_id,
      updated_at=CURRENT_TIMESTAMP
  `),

  findBySession: db.prepare(`SELECT * FROM lifecycle_handoff_state WHERE session_id = ?`),

  findAllActive: db.prepare(`
    SELECT lhs.*, pl.phase as lc_phase FROM lifecycle_handoff_state lhs
    LEFT JOIN project_lifecycles pl ON lhs.lifecycle_id = pl.id
    WHERE pl.phase NOT IN ('COMPLETED', 'FAILED') OR pl.phase IS NULL
  `),

  delete: db.prepare(`DELETE FROM lifecycle_handoff_state WHERE session_id = ?`),

  deleteByLifecycle: db.prepare(`DELETE FROM lifecycle_handoff_state WHERE lifecycle_id = ?`),
};

// v64.0: CRE Override Audit Log
export const creOverrideLog = {
  insert: db.prepare(`
    INSERT INTO cre_override_log
      (event_type, source, reason, decision_type, decision_intent,
       original_type, original_intent, confidence, metadata,
       execution_trace_id, conversation_id, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByTraceId: db.prepare(`
    SELECT * FROM cre_override_log
    WHERE execution_trace_id = ? ORDER BY created_at ASC
  `),

  findByConversation: db.prepare(`
    SELECT * FROM cre_override_log
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50
  `),

  findBySource: db.prepare(`
    SELECT * FROM cre_override_log
    WHERE source = ? ORDER BY created_at DESC LIMIT 50
  `),

  countByEventType: db.prepare(`
    SELECT event_type, COUNT(*) as count FROM cre_override_log
    GROUP BY event_type
  `),
};

// ════════════════════════════════════════════════════════════════════════════
// v80 QUALITY SCORES TELEMETRY
// ════════════════════════════════════════════════════════════════════════════

export const qualityScores = {
  insert: db.prepare(`
    INSERT INTO quality_scores (lifecycle_id, artifact_type, artifact_version, score, label, breakdown)
    VALUES (?, ?, ?, ?, ?, ?)
  `),

  findByLifecycle: db.prepare(`
    SELECT * FROM quality_scores WHERE lifecycle_id = ? ORDER BY created_at DESC
  `),

  findByType: db.prepare(`
    SELECT * FROM quality_scores WHERE lifecycle_id = ? AND artifact_type = ? ORDER BY created_at DESC
  `),

  findLatest: db.prepare(`
    SELECT * FROM quality_scores WHERE lifecycle_id = ? AND artifact_type = ? ORDER BY created_at DESC LIMIT 1
  `),

  log(lifecycleId, artifactType, version, score, label, breakdown) {
    const breakdownStr = typeof breakdown === 'string' ? breakdown : JSON.stringify(breakdown);
    this.insert.run(lifecycleId, artifactType, version, score, label, breakdownStr);
  },

  getHistory(lifecycleId) {
    return this.findByLifecycle.all(lifecycleId).map(parseQualityScoreJSON);
  },

  getByType(lifecycleId, artifactType) {
    return this.findByType.all(lifecycleId, artifactType).map(parseQualityScoreJSON);
  },

  getLatest(lifecycleId, artifactType) {
    const row = this.findLatest.get(lifecycleId, artifactType);
    if (!row) return null;
    return parseQualityScoreJSON(row);
  },
};

function parseQualityScoreJSON(row) {
  const parsed = { ...row };
  if (parsed.breakdown && typeof parsed.breakdown === 'string') {
    try { parsed.breakdown = JSON.parse(parsed.breakdown); } catch { /* keep string */ }
  }
  return parsed;
}

// ════════════════════════════════════════════════════════════════════════════
// v81: TELEMETRY SNAPSHOTS (per-turn resilience observability)
// ════════════════════════════════════════════════════════════════════════════

const VALID_EXECUTION_STATUS = new Set(['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED', null]);

export const telemetrySnapshots = {
  add: db.prepare(`
    INSERT INTO telemetry_snapshots (
      turn_id, session_id, conversation_id,
      intent, classified_by, execution_status,
      total_turn_time_ms, classification_time_ms, execution_time_ms,
      retry_count, partial_failure, was_cancelled, circuit_opened,
      snapshot_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  log(snapshot) {
    const status = snapshot.execution?.status ?? null;
    this.add.run(
      snapshot.turnId,
      snapshot.sessionId,
      snapshot.conversationId,
      snapshot.classification?.intent ?? null,
      snapshot.classification?.classifiedBy ?? null,
      VALID_EXECUTION_STATUS.has(status) ? status : null,
      snapshot.timing?.totalTurnTimeMs ?? null,
      snapshot.timing?.classificationTimeMs ?? null,
      snapshot.timing?.executionTimeMs ?? null,
      snapshot.execution?.retryCount ?? 0,
      snapshot.execution?.partialFailure ? 1 : 0,
      snapshot.execution?.wasCancelled ? 1 : 0,
      snapshot.circuit?.anyOpened ? 1 : 0,
      JSON.stringify(snapshot),
    );
  },
};

// ════════════════════════════════════════════════════════════════════════════
// v83: AUTONOMY (guarded self-tuning)
// ════════════════════════════════════════════════════════════════════════════

export const telemetryMetrics = {
  add: db.prepare(`
    INSERT INTO telemetry_metrics (
      window_start, window_end, total_turns, ambiguous_count,
      ask_user_count, break_count, override_count,
      avg_confidence, override_threshold_at_time, rule_distribution,
      aggregation_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  latest: db.prepare(`SELECT * FROM telemetry_metrics ORDER BY window_end DESC LIMIT 1`),

  since: db.prepare(`SELECT * FROM telemetry_metrics WHERE window_start >= ? ORDER BY window_start ASC`),

  // Baseline: AVG over last N windows (excludes low-volume)
  baseline: db.prepare(`
    SELECT AVG(ask_user_rate) as avg_ask_user_rate, AVG(break_rate) as avg_break_rate FROM (
      SELECT (ask_user_count * 1.0 / total_turns) AS ask_user_rate,
             (break_count * 1.0 / total_turns) AS break_rate
      FROM telemetry_metrics
      WHERE aggregation_version = ? AND total_turns >= ? AND window_end < ?
      ORDER BY window_end DESC LIMIT ?
    )
  `),
};

export const telemetryAlerts = {
  add: db.prepare(`
    INSERT INTO telemetry_alerts (
      alert_type, severity, metric_value, baseline_value,
      threshold_at_time, message
    ) VALUES (?, ?, ?, ?, ?, ?)
  `),

  unacknowledged: db.prepare(`SELECT * FROM telemetry_alerts WHERE acknowledged = 0 ORDER BY created_at DESC`),

  acknowledge: db.prepare(`UPDATE telemetry_alerts SET acknowledged = 1 WHERE id = ?`),

  recentByType: db.prepare(`
    SELECT * FROM telemetry_alerts
    WHERE alert_type = ? ORDER BY created_at DESC LIMIT ?
  `),
};

export const telemetryImprovements = {
  add: db.prepare(`
    INSERT INTO telemetry_improvements (
      parameter, old_value, new_value, reason,
      status, trust_level, auto_applied
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  pending: db.prepare(`SELECT * FROM telemetry_improvements WHERE status = 'proposed' ORDER BY created_at DESC`),

  findById: db.prepare(`SELECT * FROM telemetry_improvements WHERE id = ?`),

  updateStatus: db.prepare(`
    UPDATE telemetry_improvements
    SET status = ?, applied_at = CASE WHEN ? = 'applied' THEN CURRENT_TIMESTAMP ELSE applied_at END
    WHERE id = ?
  `),

  // Count consecutive applied improvements (for trust calculation)
  consecutiveApplied: db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT status FROM telemetry_improvements
      WHERE parameter = ? AND status IN ('applied', 'rejected', 'rolled_back')
      ORDER BY created_at DESC LIMIT ?
    ) WHERE status = 'applied'
  `),

  latestByParam: db.prepare(`
    SELECT * FROM telemetry_improvements WHERE parameter = ? ORDER BY created_at DESC LIMIT 1
  `),

  latestApplied: db.prepare(`
    SELECT * FROM telemetry_improvements WHERE parameter = ? AND status = 'applied' ORDER BY applied_at DESC LIMIT 1
  `),
};

// ════════════════════════════════════════════════════════════════════════════
// v85: SKILLS (deterministic macro-recipes)
// ════════════════════════════════════════════════════════════════════════════

export const skillExecutions = {
  add: db.prepare(`
    INSERT INTO skill_executions (id, skill_id, skill_version, state, input, params, confidence, session_id, conversation_id, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`SELECT * FROM skill_executions WHERE id = ?`),

  updateState: db.prepare(`
    UPDATE skill_executions SET state = ?, current_step_id = ?, steps_output = ? WHERE id = ?
  `),

  confirm: db.prepare(`
    UPDATE skill_executions SET state = 'EXECUTING', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  complete: db.prepare(`
    UPDATE skill_executions SET state = ?, completed_at = CURRENT_TIMESTAMP, error_message = ? WHERE id = ?
  `),

  findPending: db.prepare(`
    SELECT * FROM skill_executions WHERE state = 'CONFIRMING' AND session_id = ? ORDER BY created_at DESC LIMIT 1
  `),

  findAwaitingInput: db.prepare(`
    SELECT * FROM skill_executions WHERE state = 'AWAITING_INPUT' AND session_id = ? ORDER BY created_at DESC LIMIT 1
  `),
};

export const skillSteps = {
  add: db.prepare(`
    INSERT INTO skill_steps (execution_id, step_id, step_type, status, error_type, output, output_hash, retryable, retry_count, duration_ms, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByExecution: db.prepare(`
    SELECT * FROM skill_steps WHERE execution_id = ? ORDER BY created_at ASC
  `),
};

// ════════════════════════════════════════════════════════════════════════════
// v85.1: WORKFLOW PATTERN DETECTION
// ════════════════════════════════════════════════════════════════════════════

export const workflowPatterns = {
  upsert: db.prepare(`
    INSERT INTO workflow_patterns (pattern_hash, tool_sequence, count, last_seen, session_ids)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(pattern_hash) DO UPDATE SET
      count = count + 1,
      last_seen = excluded.last_seen,
      session_ids = excluded.session_ids
  `),

  findByHash: db.prepare(`SELECT * FROM workflow_patterns WHERE pattern_hash = ?`),

  findProposable: db.prepare(`
    SELECT * FROM workflow_patterns WHERE count >= ? AND proposed = 0 ORDER BY count DESC LIMIT 1
  `),

  markProposed: db.prepare(`UPDATE workflow_patterns SET proposed = 1 WHERE pattern_hash = ?`),

  resetCount: db.prepare(`UPDATE workflow_patterns SET count = 0, proposed = 0 WHERE pattern_hash = ?`),
};

// ════════════════════════════════════════════════════════════════════════════
// v98: ARCHITECTURE GOVERNANCE
// ════════════════════════════════════════════════════════════════════════════

export const architectureState = {
  insert: db.prepare(`
    INSERT INTO architecture_state
      (lifecycle_id, milestone_id, phase, layer_violations, circular_deps,
       naming_issues, api_surface_count, drift_score, acf_score, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByLifecycle: db.prepare(`
    SELECT * FROM architecture_state WHERE lifecycle_id = ? ORDER BY created_at DESC
  `),

  findByMilestone: db.prepare(`
    SELECT * FROM architecture_state WHERE milestone_id = ? ORDER BY created_at DESC
  `),

  findPrePost: db.prepare(`
    SELECT * FROM architecture_state
    WHERE lifecycle_id = ? AND milestone_id = ? AND phase = ?
    ORDER BY created_at DESC LIMIT 1
  `),

  record(lifecycleId, milestoneId, phase, state) {
    const detailsStr = state.details
      ? (typeof state.details === 'string' ? state.details : JSON.stringify(state.details))
      : null;
    this.insert.run(
      lifecycleId, milestoneId, phase,
      state.layerViolations || 0, state.circularDeps || 0,
      state.namingIssues || 0, state.apiSurfaceCount || 0,
      state.driftScore ?? 1.0, state.acfScore ?? 1.0,
      detailsStr
    );
  },

  getHistory(lifecycleId) {
    return this.findByLifecycle.all(lifecycleId).map(parseArchStateJSON);
  },

  getPrePost(lifecycleId, milestoneId, phase) {
    const row = this.findPrePost.get(lifecycleId, milestoneId, phase);
    return row ? parseArchStateJSON(row) : null;
  },
};

function parseArchStateJSON(row) {
  const parsed = { ...row };
  if (parsed.details && typeof parsed.details === 'string') {
    try { parsed.details = JSON.parse(parsed.details); } catch { /* keep string */ }
  }
  return parsed;
}

export const apiContracts = {
  insert: db.prepare(`
    INSERT INTO api_contracts
      (lifecycle_id, milestone_id, file_path, export_name, signature, kind, consumer_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  findByLifecycle: db.prepare(`
    SELECT * FROM api_contracts WHERE lifecycle_id = ? AND removed_at IS NULL ORDER BY file_path, export_name
  `),

  findByFile: db.prepare(`
    SELECT * FROM api_contracts WHERE lifecycle_id = ? AND file_path = ? AND removed_at IS NULL
  `),

  findByExport: db.prepare(`
    SELECT * FROM api_contracts WHERE lifecycle_id = ? AND export_name = ? AND removed_at IS NULL
  `),

  markRemoved: db.prepare(`
    UPDATE api_contracts SET removed_at = CURRENT_TIMESTAMP
    WHERE lifecycle_id = ? AND file_path = ? AND export_name = ? AND removed_at IS NULL
  `),

  updateConsumerCount: db.prepare(`
    UPDATE api_contracts SET consumer_count = ?
    WHERE lifecycle_id = ? AND file_path = ? AND export_name = ? AND removed_at IS NULL
  `),

  addContract(lifecycleId, milestoneId, contract) {
    this.insert.run(
      lifecycleId, milestoneId,
      contract.filePath, contract.exportName,
      contract.signature || null,
      contract.kind || 'function',
      contract.consumerCount || 0
    );
  },

  getActive(lifecycleId) {
    return this.findByLifecycle.all(lifecycleId);
  },

  getByFile(lifecycleId, filePath) {
    return this.findByFile.all(lifecycleId, filePath);
  },

  removeContract(lifecycleId, filePath, exportName) {
    this.markRemoved.run(lifecycleId, filePath, exportName);
  },
};

// ════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════

export function transaction(fn) {
  return db.transaction(fn)();
}

export function close() {
  db.close();
  logger.info('DB', 'Database connection closed');
}

// Export db for advanced queries
export { db };

export default {
  db,
  projects,
  globalMemory,
  projectMemory,
  chatSessions,
  chatMessages,
  learnedPatterns,
  workflowSessions,
  agents,
  agentLogs,
  // v30 UI
  conversations,
  messages,
  attachments,
  drafts,
  // v57 Expertises
  expertises,
  expertiseBindings,
  // v63 Merge Engine
  conversationExpertises,
  mergeAuditLog,
  // v63.3 Observability
  capabilityDriftLog,
  llmExecutionLog,
  // v61 Lifecycle
  lifecycles,
  roadmapVersions,
  milestones,
  changeRequests,
  driftChecks,
  // v64.0 CRE Gatekeeper
  creOverrideLog,
  lifecycleHandoffState,
  // v80 Quality Scores
  qualityScores,
  // v81 Telemetry
  telemetrySnapshots,
  // v83 Autonomy
  telemetryMetrics,
  telemetryAlerts,
  telemetryImprovements,
  // v85 Skills
  skillExecutions,
  skillSteps,
  // v98 Architecture Governance
  architectureState,
  apiContracts,
  transaction,
  close,
};
