// C.3 v64.0 — Baseline Migration
// ══════════════════════════════════════════════════════════════════════════════
//
// Complete schema as of v63.3 (all tables, indexes, triggers, FTS).
// Uses CREATE TABLE IF NOT EXISTS — safe on both fresh and existing DBs.
//
// ══════════════════════════════════════════════════════════════════════════════

export const version = '2026_02_14_001_baseline';
export const description = 'Baseline schema — all tables, indexes, triggers, FTS (v63.3)';

export function up(db) {
  db.exec(`
-- ═══════════════════════════════════════════════════════════════════════════
-- TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Projects
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

-- Conversations (new system)
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

-- Messages (extended)
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

-- Draft persistence
CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id),
    UNIQUE(project_id)
);

-- User settings persistence
CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- System logs for diagnostics
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT DEFAULT 'info',
    message TEXT,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Custom experts
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

-- Conversation-expert binding (single expert lock state per conversation)
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

-- Expert cross-session memory
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

-- v63: Multi-expertise support (Merge Engine v2, N:M max 3)
CREATE TABLE IF NOT EXISTS conversation_expertises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    expertise_id TEXT NOT NULL,
    weight REAL DEFAULT 0.5 CHECK(weight >= 0.1 AND weight <= 1.0),
    position INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(conversation_id, expertise_id)
);

-- v63: Merge audit log
CREATE TABLE IF NOT EXISTS merge_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT,
    execution_trace_id TEXT,
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v63.2: Capability drift log
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

-- v63.3: LLM execution log (per-call audit)
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

-- v61: Project Lifecycles (Phase C)
CREATE TABLE IF NOT EXISTS project_lifecycles (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase TEXT NOT NULL DEFAULT 'SPEC',
    spec TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    active_session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v61: Roadmap Versions (immutable)
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

-- v61: Milestones
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

-- v61: Change Requests
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

-- v61: Drift Checks
CREATE TABLE IF NOT EXISTS drift_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lifecycle_id TEXT NOT NULL REFERENCES project_lifecycles(id) ON DELETE CASCADE,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    check_type TEXT NOT NULL,
    result TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v62: Lifecycle Handoff State (crash recovery)
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

-- ═══════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_conv_expertises_conv ON conversation_expertises(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_expertises_expertise ON conversation_expertises(expertise_id);
CREATE INDEX IF NOT EXISTS idx_merge_audit_conv ON merge_audit_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cap_drift_conv ON capability_drift_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cap_drift_expert ON capability_drift_log(expert_id);
CREATE INDEX IF NOT EXISTS idx_llm_exec_conv ON llm_execution_log(conversation_id);
-- NOTE: execution_trace_id indexes are in migration 004 (handles pre-existing DBs without those columns)
CREATE INDEX IF NOT EXISTS idx_lifecycles_project ON project_lifecycles(project_id);
CREATE INDEX IF NOT EXISTS idx_lifecycles_phase ON project_lifecycles(phase);
CREATE INDEX IF NOT EXISTS idx_roadmap_versions_lifecycle ON roadmap_versions(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_milestones_lifecycle ON milestones(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON milestones(status);
CREATE INDEX IF NOT EXISTS idx_change_requests_lifecycle ON change_requests(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_drift_checks_lifecycle ON drift_checks(lifecycle_id);
CREATE INDEX IF NOT EXISTS idx_drift_checks_milestone ON drift_checks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_lhs_lifecycle ON lifecycle_handoff_state(lifecycle_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- FULL-TEXT SEARCH
-- ═══════════════════════════════════════════════════════════════════════════

CREATE VIRTUAL TABLE IF NOT EXISTS chat_fts USING fts5(
    content,
    content='chat_messages',
    content_rowid='id'
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content='messages',
    content_rowid='id'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- FTS sync (old chat_messages)
CREATE TRIGGER IF NOT EXISTS chat_ai AFTER INSERT ON chat_messages BEGIN
    INSERT INTO chat_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chat_ad AFTER DELETE ON chat_messages BEGIN
    INSERT INTO chat_fts(chat_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

-- FTS sync (new messages)
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;

-- Conversation message count
CREATE TRIGGER IF NOT EXISTS messages_count_ai AFTER INSERT ON messages BEGIN
    UPDATE conversations SET message_count = message_count + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = new.conversation_id;
END;

CREATE TRIGGER IF NOT EXISTS messages_count_ad AFTER DELETE ON messages BEGIN
    UPDATE conversations SET message_count = message_count - 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = old.conversation_id;
END;
  `);
}
