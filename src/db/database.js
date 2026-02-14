// C.3 v28 Database Layer
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../core/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

logger.info('DB', 'Database initialized', { path: dbPath });

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ════════════════════════════════════════════════════════════════════════════

const SCHEMA = `
-- Projects
-- v59: Added is_external flag + UNIQUE(path) for "Open Folder" feature
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    is_external INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Global memory (shared across all projects)
CREATE TABLE IF NOT EXISTS global_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User memory for settings sidebar (JSON array)
CREATE TABLE IF NOT EXISTS user_memory (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '[]',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Project-specific memory
CREATE TABLE IF NOT EXISTS project_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, key)
);

-- Agents configuration
CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'manual',
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT DEFAULT 'idle',
    schedule TEXT,
    last_run DATETIME,
    next_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Agent execution logs
CREATE TABLE IF NOT EXISTS agent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT,
    state TEXT DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Learned patterns (for auto-answer system)
CREATE TABLE IF NOT EXISTS learned_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_hash TEXT UNIQUE NOT NULL,
    pattern_type TEXT NOT NULL DEFAULT 'question',
    trigger_text TEXT NOT NULL,
    response_text TEXT NOT NULL,
    confirm_count INTEGER DEFAULT 1,
    auto_apply INTEGER DEFAULT 0,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Workflow sessions (for tracking multi-step workflows)
CREATE TABLE IF NOT EXISTS workflow_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'INIT',
    complexity TEXT DEFAULT 'SIMPLE',
    request TEXT NOT NULL,
    plan TEXT,
    implementation TEXT,
    timing TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Conversations (nový systém - nahrazuje chat_sessions)
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT,
    summary TEXT,
    message_count INTEGER DEFAULT 0,
    state TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Messages (rozšířené)
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Attachments
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Draft persistence (rozpracovaný prompt)
CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id),
    UNIQUE(project_id)
);

-- v34: User settings persistence
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v34: System logs for diagnostics
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'info',
    message TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v57: Custom experts (definice vlastních expertů)
CREATE TABLE IF NOT EXISTS experts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    domain TEXT,
    system_prompt TEXT,
    temperature REAL DEFAULT 0.5 CHECK(temperature >= 0 AND temperature <= 1),
    config TEXT NOT NULL DEFAULT '{}',
    is_builtin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v57: Conversation-expert binding (expert lock state per conversation)
CREATE TABLE IF NOT EXISTS conversation_experts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    expert_id TEXT NOT NULL,
    locked INTEGER DEFAULT 0,
    strength INTEGER DEFAULT 50 CHECK(strength >= 0 AND strength <= 100),
    locked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id)
);

-- v57.1 A8: Expert cross-session memory (facts remembered across conversations)
CREATE TABLE IF NOT EXISTS expert_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expert_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    previous_value TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(expert_id, key)
);

-- v63: Multi-expertise support (Merge Engine v2)
-- Allows N:M binding of expertises to conversations (max 3 per conversation)
CREATE TABLE IF NOT EXISTS conversation_expertises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    expertise_id TEXT NOT NULL,
    weight REAL DEFAULT 0.5 CHECK(weight >= 0.1 AND weight <= 1.0),
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id, expertise_id)
);

-- v63: Merge audit log (structured JSON, populated in debug mode only)
-- v63.3: execution_trace_id — one UUID per user turn, links all audit layers
CREATE TABLE IF NOT EXISTS merge_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    execution_trace_id TEXT,
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v63.2: Capability drift log (per-response drift tracking)
-- v63.3: execution_trace_id — one UUID per user turn, links all audit layers
CREATE TABLE IF NOT EXISTS capability_drift_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    execution_trace_id TEXT,
    expert_id TEXT NOT NULL,
    merged_prompt_hash TEXT,
    expected_profile TEXT NOT NULL,
    observed_scores TEXT NOT NULL,
    drift_score REAL NOT NULL DEFAULT 0,
    violations TEXT,
    execution_step TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v63.3: LLM execution log (per-call audit — model, temperature, latency, tokens)
CREATE TABLE IF NOT EXISTS llm_execution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_trace_id TEXT,
    conversation_id TEXT,
    execution_step TEXT NOT NULL DEFAULT 'LLM',
    expert_id TEXT,
    model TEXT,
    temperature REAL,
    prompt_hash TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    latency_ms INTEGER,
    token_source TEXT DEFAULT 'estimated',
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v61: Project Lifecycles (Phase C — Collaborative Milestone Execution)
CREATE TABLE IF NOT EXISTS project_lifecycles (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'SPEC',
    spec TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v61: Roadmap Versions (immutable — change = new version)
CREATE TABLE IF NOT EXISTS roadmap_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    roadmap TEXT NOT NULL,
    change_reason TEXT,
    diff_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lifecycle_id, version)
);

-- v61: Milestones (unit of work within a lifecycle)
CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    roadmap_version INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    dependencies TEXT DEFAULT '[]',
    estimated_loc INTEGER DEFAULT 0,
    estimated_files INTEGER DEFAULT 0,
    estimated_complexity TEXT DEFAULT 'MEDIUM',
    test_strategy TEXT,
    local_plan TEXT,
    scope_files TEXT,
    workflow_session_id TEXT,
    commit_hash TEXT,
    git_tag TEXT,
    health_score TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    UNIQUE(lifecycle_id, sequence)
);

-- v61: Change Requests (direction changes during BUILD)
CREATE TABLE IF NOT EXISTS change_requests (
    id TEXT PRIMARY KEY,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    description TEXT NOT NULL,
    affected_milestones TEXT DEFAULT '[]',
    impact_analysis TEXT,
    proposed_roadmap_diff TEXT,
    old_roadmap_version INTEGER,
    new_roadmap_version INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME
);

-- v61: Drift Checks (spec alignment, scope creep, architecture, tech debt)
CREATE TABLE IF NOT EXISTS drift_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    check_type TEXT NOT NULL,
    result TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_memory_project ON project_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_learned_patterns_hash ON learned_patterns(pattern_hash);
CREATE INDEX IF NOT EXISTS idx_workflow_sessions_state ON workflow_sessions(state);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation ON attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_conversation_experts_conv ON conversation_experts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_experts_domain ON experts(domain);
CREATE INDEX IF NOT EXISTS idx_expert_memory_expert ON expert_memory(expert_id);

-- v63: Merge Engine indexes
CREATE INDEX IF NOT EXISTS idx_conv_expertises_conv ON conversation_expertises(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_expertises_expertise ON conversation_expertises(expertise_id);
CREATE INDEX IF NOT EXISTS idx_merge_audit_conv ON merge_audit_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_merge_audit_trace ON merge_audit_log(execution_trace_id);
CREATE INDEX IF NOT EXISTS idx_cap_drift_conv ON capability_drift_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cap_drift_expert ON capability_drift_log(expert_id);
CREATE INDEX IF NOT EXISTS idx_cap_drift_trace ON capability_drift_log(execution_trace_id);
CREATE INDEX IF NOT EXISTS idx_llm_exec_trace ON llm_execution_log(execution_trace_id);
CREATE INDEX IF NOT EXISTS idx_llm_exec_conv ON llm_execution_log(conversation_id);

-- v61: Lifecycle indexes
CREATE INDEX IF NOT EXISTS idx_lifecycles_project ON project_lifecycles(project_id);
CREATE INDEX IF NOT EXISTS idx_lifecycles_phase ON project_lifecycles(phase);
CREATE INDEX IF NOT EXISTS idx_roadmap_versions_lifecycle ON roadmap_versions(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_milestones_lifecycle ON milestones(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_change_requests_lifecycle ON change_requests(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_drift_checks_lifecycle ON drift_checks(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_drift_checks_milestone ON drift_checks(milestone_id);

-- v62: Lifecycle Handoff State (crash recovery — RAM+DB dual-write)
CREATE TABLE IF NOT EXISTS lifecycle_handoff_state (
    session_id TEXT PRIMARY KEY,
    phase TEXT NOT NULL,
    lifecycle_id TEXT REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    current_milestone_id TEXT,
    original_request TEXT,
    project_id INTEGER,
    project_path TEXT,
    change_request_id TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lhs_lifecycle ON lifecycle_handoff_state(lifecycle_id);

-- Full-text search for chat
CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(
    content,
    content='chat_messages',
    content_rowid='id'
);

-- Full-text search for new messages
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id'
);

-- Triggers for FTS sync (old chat_messages)
CREATE TRIGGER IF NOT EXISTS chat_ai AFTER INSERT ON chat_messages BEGIN
    INSERT INTO chat_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chat_ad AFTER DELETE ON chat_messages BEGIN
    INSERT INTO chat_fts(chat_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

-- Triggers for FTS sync (new messages)
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

-- Trigger to update conversation message count
CREATE TRIGGER IF NOT EXISTS messages_count_ai AFTER INSERT ON messages BEGIN
    UPDATE conversations SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP 
    WHERE id = new.conversation_id;
END;

CREATE TRIGGER IF NOT EXISTS messages_count_ad AFTER DELETE ON messages BEGIN
    UPDATE conversations SET message_count = message_count - 1, updated_at = CURRENT_TIMESTAMP 
    WHERE id = old.conversation_id;
END;
`;

// Initialize schema
db.exec(SCHEMA);

// ════════════════════════════════════════════════════════════════════════════
// v59: MIGRATIONS - Add is_external column to existing projects table
// ════════════════════════════════════════════════════════════════════════════

try {
  // Check if is_external column exists
  const columns = db.prepare("PRAGMA table_info(projects)").all();
  const hasIsExternal = columns.some(col => col.name === 'is_external');

  if (!hasIsExternal) {
    logger.info('DB', 'Migrating projects table: adding is_external column');
    db.exec('ALTER TABLE projects ADD COLUMN is_external INTEGER DEFAULT 0');
  }

  // Note: UNIQUE constraint on path is already in CREATE TABLE for new DBs
  // For existing DBs, we can't easily add UNIQUE constraint without recreating table
  // So we rely on application-level check in findByPath before insert
} catch (err) {
  logger.warn('DB', `Migration check failed: ${err.message}`);
}

// v62: Add active_session_id to project_lifecycles (C4 multi-session)
try {
  db.exec('ALTER TABLE project_lifecycles ADD COLUMN active_session_id TEXT');
} catch {
  // Column already exists — expected on subsequent starts
}

// v63.3: Add execution_trace_id to merge_audit_log and capability_drift_log
try {
  db.exec('ALTER TABLE merge_audit_log ADD COLUMN execution_trace_id TEXT');
} catch {
  // Column already exists — expected on subsequent starts
}
try {
  db.exec('ALTER TABLE capability_drift_log ADD COLUMN execution_trace_id TEXT');
} catch {
  // Column already exists
}
try {
  db.exec('ALTER TABLE capability_drift_log ADD COLUMN execution_step TEXT');
} catch {
  // Column already exists
}

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

  getOrCreate(name, projectPath, description = '') {
    let project = this.findByPath.get(projectPath);
    if (!project) {
      const result = this.create.run(name, projectPath, description);
      project = { id: result.lastInsertRowid, name, path: projectPath, description, is_external: 0 };
    } else {
      this.updateLastActive.run(project.id);
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
      this.updateLastActive.run(project.id);
      return { project, wasExisting: true };
    }

    // Check name uniqueness and generate alternative if needed
    let finalName = name;
    let counter = 1;
    while (this.findByName.get(finalName)) {
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

// Custom Experts
export const experts = {
  create: db.prepare(`
    INSERT INTO experts (id, name, description, domain, system_prompt, temperature, config)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  findById: db.prepare(`SELECT * FROM experts WHERE id = ?`),

  findByDomain: db.prepare(`SELECT * FROM experts WHERE domain = ?`),

  listAll: db.prepare(`SELECT * FROM experts ORDER BY name`),

  listCustom: db.prepare(`SELECT * FROM experts WHERE is_builtin = 0 ORDER BY name`),

  update: db.prepare(`
    UPDATE experts
    SET name = ?, description = ?, domain = ?, system_prompt = ?, temperature = ?, config = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),

  delete: db.prepare(`DELETE FROM experts WHERE id = ? AND is_builtin = 0`),

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

// Conversation-Expert bindings (for lock state)
export const conversationExperts = {
  get: db.prepare(`SELECT * FROM conversation_experts WHERE conversation_id = ?`),

  create: db.prepare(`
    INSERT INTO conversation_experts (conversation_id, expert_id, locked, strength, locked_at)
    VALUES (?, ?, ?, ?, ?)
  `),

  update: db.prepare(`
    UPDATE conversation_experts
    SET expert_id = ?, locked = ?, strength = ?, locked_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
  `),

  delete: db.prepare(`DELETE FROM conversation_experts WHERE conversation_id = ?`),

  lock: db.prepare(`
    UPDATE conversation_experts
    SET locked = 1, locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
  `),

  unlock: db.prepare(`
    UPDATE conversation_experts
    SET locked = 0, locked_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ?
  `),

  /**
   * Set expert for conversation (creates or updates)
   */
  setExpert(conversationId, expertId, options = {}) {
    const locked = options.locked ? 1 : 0;
    const strength = options.strength ?? 50;
    const lockedAt = locked ? new Date().toISOString() : null;

    const existing = this.get.get(conversationId);
    if (existing) {
      this.update.run(expertId, locked, strength, lockedAt, conversationId);
    } else {
      this.create.run(conversationId, expertId, locked, strength, lockedAt);
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
  clearExpert(conversationId) {
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
    INSERT INTO capability_drift_log (conversation_id, execution_trace_id, expert_id, merged_prompt_hash, expected_profile, observed_scores, drift_score, violations, execution_step)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),

  findByConversation: db.prepare(`
    SELECT * FROM capability_drift_log
    WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20
  `),

  findByExpert: db.prepare(`
    SELECT * FROM capability_drift_log
    WHERE expert_id = ? ORDER BY created_at DESC LIMIT 50
  `),

  findByTraceId: db.prepare(`
    SELECT * FROM capability_drift_log
    WHERE execution_trace_id = ? ORDER BY created_at ASC
  `),

  avgDriftByExpert: db.prepare(`
    SELECT expert_id, AVG(drift_score) as avg_drift, COUNT(*) as sample_count
    FROM capability_drift_log
    WHERE created_at > datetime('now', '-30 days')
    GROUP BY expert_id
    ORDER BY avg_drift DESC
  `),

  /**
   * @param {Object} entry
   */
  log(entry) {
    this.add.run(
      entry.conversationId || null,
      entry.executionTraceId || null,
      entry.expertId,
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
    INSERT INTO llm_execution_log (execution_trace_id, conversation_id, execution_step, expert_id, model, temperature, prompt_hash, prompt_tokens, completion_tokens, latency_ms, token_source, metadata)
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
      entry.expertId || null,
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
      test_strategy, local_plan, scope_files, max_retries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      data.max_retries || 3
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
  // v57 Experts
  experts,
  conversationExperts,
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
  transaction,
  close,
};
