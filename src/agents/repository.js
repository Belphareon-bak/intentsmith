// C.3 v33 Agent Repository
// ══════════════════════════════════════════════════════════════════════════════
// Database operations for agents

/**
 * Initialize agent tables
 * @param {import('better-sqlite3').Database} db
 */
export function initAgentTables(db) {
  // Agents table (extended from v28)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents_v33 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '🤖',
      definition TEXT NOT NULL,
      state TEXT DEFAULT '{}',
      params TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Agent runs
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      status TEXT DEFAULT 'running',
      triggers_fired TEXT DEFAULT '[]',
      actions_executed INTEGER DEFAULT 0,
      explain TEXT,
      log TEXT,
      error TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    )
  `);
  
  // Agent notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_notifications_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      run_id INTEGER,
      title TEXT NOT NULL,
      body TEXT,
      priority TEXT DEFAULT 'normal',
      data TEXT,
      read_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES agent_runs_v33(id) ON DELETE SET NULL
    )
  `);
  
  // Agent data store (key-value per agent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_data_v33 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, key),
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    )
  `);
  
  // Agent schedule
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_schedule_v33 (
      agent_id TEXT PRIMARY KEY,
      next_run DATETIME,
      last_run DATETIME,
      interval_ms INTEGER,
      cron_expression TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents_v33(id) ON DELETE CASCADE
    )
  `);
  
  // Drafts (for builder confirm flow)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_drafts_v33 (
      id TEXT PRIMARY KEY,
      definition TEXT NOT NULL,
      params TEXT DEFAULT '{}',
      explanation TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )
  `);
  
  // User inventory (for TRACKER agents)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      brand TEXT,
      model TEXT,
      purchase_date DATE,
      warranty_months INTEGER,
      warranty_end DATE,
      notes TEXT,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs_v33(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs_v33(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_notif_agent ON agent_notifications_v33(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_notif_read ON agent_notifications_v33(read_at);
    CREATE INDEX IF NOT EXISTS idx_agent_schedule_next ON agent_schedule_v33(next_run);
  `);
  
  console.log('[Agents v33] Database tables initialized');
}

/**
 * Agent Repository
 */
export class AgentRepository {
  constructor(db) {
    this.db = db;
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // ALIAS METHODS (for API compatibility)
  // ════════════════════════════════════════════════════════════════════════════
  
  getById(id) { return this.getAgent(id); }
  getAll(includeDisabled = false) { return this.getAllAgents(includeDisabled); }
  create(agent) { return this.createAgent(agent); }
  update(id, updates) { return this.updateAgent(id, updates); }
  delete(id) { return this.deleteAgent(id); }
  
  // ════════════════════════════════════════════════════════════════════════════
  // AGENTS CRUD
  // ════════════════════════════════════════════════════════════════════════════
  
  createAgent(agent) {
    const stmt = this.db.prepare(`
      INSERT INTO agents_v33 (id, name, description, icon, definition, state, params, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      agent.id,
      agent.name,
      agent.description || null,
      agent.icon || '🤖',
      JSON.stringify(agent.definition),
      JSON.stringify(agent.state || {}),
      JSON.stringify(agent.params || {}),
      agent.enabled !== false ? 1 : 0
    );
    
    return this.getAgent(agent.id);
  }
  
  getAgent(id) {
    const row = this.db.prepare('SELECT * FROM agents_v33 WHERE id = ?').get(id);
    return row ? this._parseAgent(row) : null;
  }
  
  getAllAgents(includeDisabled = false) {
    const sql = includeDisabled
      ? 'SELECT * FROM agents_v33 ORDER BY name'
      : 'SELECT * FROM agents_v33 WHERE enabled = 1 ORDER BY name';
    return this.db.prepare(sql).all().map(r => this._parseAgent(r));
  }
  
  updateAgent(id, updates) {
    const fields = [];
    const values = [];
    
    const allowed = ['name', 'description', 'icon', 'definition', 'state', 'params', 'enabled'];
    
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        if (['definition', 'state', 'params'].includes(key)) {
          values.push(JSON.stringify(updates[key]));
        } else if (key === 'enabled') {
          values.push(updates[key] ? 1 : 0);
        } else {
          values.push(updates[key]);
        }
      }
    }
    
    if (fields.length === 0) return this.getAgent(id);
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    this.db.prepare(`UPDATE agents_v33 SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getAgent(id);
  }
  
  updateAgentState(id, state) {
    this.db.prepare('UPDATE agents_v33 SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(state), id);
  }
  
  deleteAgent(id) {
    this.db.prepare('DELETE FROM agents_v33 WHERE id = ?').run(id);
  }
  
  _parseAgent(row) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      definition: JSON.parse(row.definition),
      state: JSON.parse(row.state || '{}'),
      params: JSON.parse(row.params || '{}'),
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // RUNS
  // ════════════════════════════════════════════════════════════════════════════
  
  createRun(agentId) {
    const result = this.db.prepare(`
      INSERT INTO agent_runs_v33 (agent_id, status) VALUES (?, 'running')
    `).run(agentId);
    return result.lastInsertRowid;
  }
  
  completeRun(runId, data) {
    this.db.prepare(`
      UPDATE agent_runs_v33 SET
        finished_at = CURRENT_TIMESTAMP,
        status = ?,
        triggers_fired = ?,
        actions_executed = ?,
        explain = ?,
        log = ?,
        error = ?
      WHERE id = ?
    `).run(
      data.status,
      JSON.stringify(data.triggers_fired || []),
      data.actions_executed || 0,
      data.explain ? JSON.stringify(data.explain) : null,
      data.log || null,
      data.error || null,
      runId
    );
  }
  
  getRunHistory(agentId, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM agent_runs_v33 
      WHERE agent_id = ? 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(agentId, limit).map(r => ({
      ...r,
      triggers_fired: JSON.parse(r.triggers_fired || '[]'),
      explain: r.explain ? JSON.parse(r.explain) : null
    }));
  }
  
  getLastRun(agentId) {
    const row = this.db.prepare(`
      SELECT * FROM agent_runs_v33 
      WHERE agent_id = ? 
      ORDER BY started_at DESC 
      LIMIT 1
    `).get(agentId);
    
    if (!row) return null;
    
    return {
      ...row,
      triggers_fired: JSON.parse(row.triggers_fired || '[]'),
      explain: row.explain ? JSON.parse(row.explain) : null
    };
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ════════════════════════════════════════════════════════════════════════════
  
  createNotification(agentId, runId, data) {
    const result = this.db.prepare(`
      INSERT INTO agent_notifications_v33 (agent_id, run_id, title, body, priority, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      agentId,
      runId || null,
      data.title,
      data.body || null,
      data.priority || 'normal',
      data.data ? JSON.stringify(data.data) : null
    );
    return result.lastInsertRowid;
  }
  
  getNotifications(options = {}) {
    let sql = 'SELECT * FROM agent_notifications_v33 WHERE 1=1';
    const params = [];
    
    if (options.unreadOnly) {
      sql += ' AND read_at IS NULL';
    }
    if (options.agentId) {
      sql += ' AND agent_id = ?';
      params.push(options.agentId);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(options.limit || 50);
    
    return this.db.prepare(sql).all(...params).map(r => ({
      ...r,
      data: r.data ? JSON.parse(r.data) : null
    }));
  }
  
  markNotificationRead(id) {
    this.db.prepare('UPDATE agent_notifications_v33 SET read_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }
  
  getUnreadCount() {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM agent_notifications_v33 WHERE read_at IS NULL').get();
    return row?.count || 0;
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // AGENT DATA (key-value)
  // ════════════════════════════════════════════════════════════════════════════
  
  setAgentData(agentId, key, value) {
    this.db.prepare(`
      INSERT INTO agent_data_v33 (agent_id, key, value, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(agent_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(agentId, key, JSON.stringify(value));
  }
  
  getAgentData(agentId, key) {
    const row = this.db.prepare('SELECT value FROM agent_data_v33 WHERE agent_id = ? AND key = ?').get(agentId, key);
    return row ? JSON.parse(row.value) : null;
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // SCHEDULE
  // ════════════════════════════════════════════════════════════════════════════
  
  setSchedule(agentId, data) {
    this.db.prepare(`
      INSERT INTO agent_schedule_v33 (agent_id, next_run, interval_ms, cron_expression)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        next_run = excluded.next_run,
        interval_ms = excluded.interval_ms,
        cron_expression = excluded.cron_expression
    `).run(agentId, data.nextRun, data.intervalMs || null, data.cronExpression || null);
  }
  
  updateLastRun(agentId, nextRun) {
    this.db.prepare(`
      UPDATE agent_schedule_v33 SET last_run = CURRENT_TIMESTAMP, next_run = ? WHERE agent_id = ?
    `).run(nextRun, agentId);
  }
  
  getDueAgents() {
    return this.db.prepare(`
      SELECT s.*, a.enabled FROM agent_schedule_v33 s
      JOIN agents_v33 a ON s.agent_id = a.id
      WHERE a.enabled = 1 AND s.next_run <= CURRENT_TIMESTAMP
      ORDER BY s.next_run
    `).all();
  }
  
  getSchedule(agentId) {
    return this.db.prepare('SELECT * FROM agent_schedule_v33 WHERE agent_id = ?').get(agentId);
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // DRAFTS
  // ════════════════════════════════════════════════════════════════════════════
  
  saveDraft(id, data) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
    
    this.db.prepare(`
      INSERT INTO agent_drafts_v33 (id, definition, params, explanation, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        definition = excluded.definition,
        params = excluded.params,
        explanation = excluded.explanation,
        expires_at = excluded.expires_at
    `).run(
      id,
      JSON.stringify(data.definition),
      JSON.stringify(data.params || {}),
      data.explanation || null,
      expiresAt
    );
    
    return id;
  }
  
  getDraft(id) {
    const row = this.db.prepare(`
      SELECT * FROM agent_drafts_v33 
      WHERE id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    `).get(id);
    
    if (!row) return null;
    
    return {
      id: row.id,
      definition: JSON.parse(row.definition),
      params: JSON.parse(row.params || '{}'),
      explanation: row.explanation,
      created_at: row.created_at
    };
  }
  
  deleteDraft(id) {
    this.db.prepare('DELETE FROM agent_drafts_v33 WHERE id = ?').run(id);
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // USER INVENTORY
  // ════════════════════════════════════════════════════════════════════════════
  
  queryAgentData(table, where = {}) {
    if (table === 'user_inventory') {
      let sql = 'SELECT * FROM user_inventory WHERE 1=1';
      const params = [];
      
      for (const [key, value] of Object.entries(where)) {
        if (value && typeof value === 'object' && value.not_null) {
          sql += ` AND ${key} IS NOT NULL`;
        } else {
          sql += ` AND ${key} = ?`;
          params.push(value);
        }
      }
      
      return this.db.prepare(sql).all(...params);
    }
    
    if (table === 'agent_data') {
      // Query from agent_data_v33
      return [];
    }
    
    return [];
  }
}

export default AgentRepository;
