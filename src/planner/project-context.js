// Project Context Manager — Multi-Session Project Context (Phase C1/C2)
// ══════════════════════════════════════════════════════════════════════════════
//
// PROBLEM: Workflow sessions have project_id but don't actively use project
//          memory. Users say "pokračuj kde jsme skončili" but lose context
//          across sessions.
//
// SOLUTION:
//   1. Link workflow sessions to projects (auto or explicit)
//   2. Store/recall project-scoped facts (decisions, preferences, blockers)
//   3. Inject project context into D1/CODE/R2/R1 prompts
//   4. Track project timeline (what happened when)
//
// DEPENDS: db/database.js (projects, project_memory, workflow_sessions)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Project Context Store ──────────────────────────────────────────────────

/**
 * Project context manager — thin wrapper around project_memory DB.
 */
export class ProjectContextManager {
  constructor(db) {
    this.db = db; // { projects, projectMemory, workflowSessions }
  }

  // ─── Project Resolution ─────────────────────────────────────────────────

  /**
   * Find or create a project for a workflow session.
   * If user is already in a project context (from chat), use that.
   * Otherwise, infer from request content.
   */
  resolveProject(request, contextProjectId = null) {
    // Explicit project from chat context
    if (contextProjectId) {
      const project = this.db.projects.findById.get(contextProjectId);
      if (project) return project;
    }

    // Try to match from request keywords
    const allProjects = this.db.projects.list?.all() || [];
    for (const p of allProjects) {
      if (request.toLowerCase().includes(p.name.toLowerCase())) {
        return p;
      }
    }

    return null; // No project match — session runs without project scope
  }

  /**
   * Link a workflow session to a project.
   */
  linkSessionToProject(sessionId, projectId) {
    try {
      this.db.workflowSessions.updateState.run('', sessionId); // no-op state change
      // Direct SQL to set project_id (no prepared statement exists)
      this.db.db?.prepare?.(
        'UPDATE workflow_sessions SET project_id = ? WHERE session_id = ?'
      )?.run(projectId, sessionId);
      
      logger.info('ProjectContext', `Linked session ${sessionId} to project ${projectId}`);
    } catch (err) {
      logger.debug('ProjectContext', `Link failed: ${err.message}`);
    }
  }

  // ─── Project Memory ─────────────────────────────────────────────────────

  /**
   * Store a project-scoped fact (decision, preference, blocker).
   */
  storeProjectFact(projectId, key, value, category = 'general') {
    try {
      this.db.projectMemory.upsert.run(projectId, key, value, category);
      logger.debug('ProjectContext', `Stored: ${key} = ${value.slice(0, 100)}`);
      return true;
    } catch (err) {
      logger.debug('ProjectContext', `Store failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Recall a project-scoped fact.
   */
  recallProjectFact(projectId, key) {
    try {
      const row = this.db.projectMemory.get.get(projectId, key);
      return row ? row.value : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Get all project memory for context injection.
   */
  getProjectContext(projectId) {
    try {
      const rows = this.db.projectMemory.listByProject.all(projectId);
      const context = {};
      for (const row of rows) {
        if (!context[row.category]) context[row.category] = {};
        context[row.category][row.key] = row.value;
      }
      return context;
    } catch (err) {
      return {};
    }
  }

  /**
   * Store a decision made during workflow execution.
   * Keyed by session + step for traceability.
   */
  recordDecision(projectId, sessionId, step, decision) {
    const key = `decision:${sessionId}:${step}`;
    const value = JSON.stringify({
      decision,
      sessionId,
      step,
      timestamp: new Date().toISOString(),
    });
    return this.storeProjectFact(projectId, key, value, 'decisions');
  }

  /**
   * Store a blocker encountered during workflow.
   */
  recordBlocker(projectId, sessionId, description, severity = 'warning') {
    const key = `blocker:${sessionId}:${Date.now()}`;
    const value = JSON.stringify({
      description,
      severity,
      sessionId,
      resolved: false,
      timestamp: new Date().toISOString(),
    });
    return this.storeProjectFact(projectId, key, value, 'blockers');
  }

  /**
   * Mark a blocker as resolved.
   */
  resolveBlocker(projectId, blockerKey) {
    try {
      const existing = this.recallProjectFact(projectId, blockerKey);
      if (existing) {
        const data = JSON.parse(existing);
        data.resolved = true;
        data.resolvedAt = new Date().toISOString();
        this.storeProjectFact(projectId, blockerKey, JSON.stringify(data), 'blockers');
        return true;
      }
    } catch (err) { /* ignore */ }
    return false;
  }

  // ─── Project Timeline ───────────────────────────────────────────────────

  /**
   * Add a timeline event for the project.
   */
  addTimelineEvent(projectId, event, details = '') {
    const key = `timeline:${Date.now()}`;
    const value = JSON.stringify({
      event,
      details,
      timestamp: new Date().toISOString(),
    });
    return this.storeProjectFact(projectId, key, value, 'timeline');
  }

  /**
   * Get project timeline (most recent N events).
   */
  getTimeline(projectId, limit = 20) {
    try {
      const rows = this.db.projectMemory.listByCategory.all(projectId, 'timeline');
      const events = rows.map(r => {
        try { return JSON.parse(r.value); }
        catch { return { event: r.value, timestamp: r.created_at }; }
      });
      return events
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(0, limit);
    } catch (err) {
      return [];
    }
  }

  // ─── Context Injection ──────────────────────────────────────────────────

  /**
   * Build a context string for LLM prompt injection.
   * Used by D1/CODE/R2/R1 steps to maintain project awareness.
   */
  buildContextPrompt(projectId) {
    const ctx = this.getProjectContext(projectId);
    const parts = [];

    // General facts
    if (ctx.general && Object.keys(ctx.general).length > 0) {
      parts.push('## Project Facts');
      for (const [k, v] of Object.entries(ctx.general)) {
        if (!k.startsWith('decision:') && !k.startsWith('blocker:') && !k.startsWith('timeline:')) {
          parts.push(`- ${k}: ${v}`);
        }
      }
    }

    // Active blockers
    if (ctx.blockers) {
      const active = Object.values(ctx.blockers)
        .map(v => { try { return JSON.parse(v); } catch { return null; } })
        .filter(b => b && !b.resolved);

      if (active.length > 0) {
        parts.push('\n## Active Blockers');
        for (const b of active.slice(0, 5)) {
          const icon = b.severity === 'error' ? '🔴' : '🟡';
          parts.push(`${icon} ${b.description}`);
        }
      }
    }

    // Recent decisions (last 5)
    if (ctx.decisions) {
      const decisions = Object.values(ctx.decisions)
        .map(v => { try { return JSON.parse(v); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(0, 5);

      if (decisions.length > 0) {
        parts.push('\n## Recent Decisions');
        for (const d of decisions) {
          parts.push(`- ${d.step}: ${typeof d.decision === 'string' ? d.decision : JSON.stringify(d.decision).slice(0, 100)}`);
        }
      }
    }

    // Recent timeline
    const timeline = this.getTimeline(projectId, 5);
    if (timeline.length > 0) {
      parts.push('\n## Recent Activity');
      for (const t of timeline) {
        parts.push(`- [${t.timestamp?.slice(0, 16) || '?'}] ${t.event}`);
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  // ─── Session History for Project ────────────────────────────────────────

  /**
   * Get all workflow sessions for a project.
   */
  getProjectSessions(projectId) {
    try {
      const rows = this.db.db?.prepare?.(
        'SELECT * FROM workflow_sessions WHERE project_id = ? ORDER BY updated_at DESC'
      )?.all(projectId) || [];

      return rows.map(r => ({
        sessionId: r.session_id,
        state: r.state,
        complexity: r.complexity,
        request: r.request?.slice(0, 200),
        planTitle: r.plan ? (JSON.parse(r.plan)?.title || null) : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch (err) {
      return [];
    }
  }
}

// ─── Singleton Factory ──────────────────────────────────────────────────────

let _instance = null;

/**
 * Get or create the project context manager singleton.
 * @param {Object} db - database module default export
 */
export function getProjectContextManager(db) {
  if (!_instance && db) {
    _instance = new ProjectContextManager(db);
  }
  return _instance;
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default ProjectContextManager;
