// C.3 v28 Database Layer
// ══════════════════════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { config } from '../config.js';
import { logger } from '../core/logger.js';
import fs from 'fs';
import path from 'path';

// Ensure data directory exists
const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(config.db.path);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA
// ════════════════════════════════════════════════════════════════════════════

const SCHEMA = `
-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    path TEXT NOT NULL,
    description TEXT,
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
logger.info('DB', 'Database initialized', { path: config.db.path });

// ════════════════════════════════════════════════════════════════════════════
// REPOSITORIES
// ════════════════════════════════════════════════════════════════════════════

// Projects
export const projects = {
  create: db.prepare(`
    INSERT INTO projects (name, path, description) VALUES (?, ?, ?)
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
      project = { id: result.lastInsertRowid, name, path: projectPath, description };
    } else {
      this.updateLastActive.run(project.id);
    }
    return project;
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
    SELECT * FROM workflow_sessions WHERE state NOT IN ('DONE', 'ERROR', 'CANCELLED')
    ORDER BY updated_at DESC
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
  transaction,
  close,
};
