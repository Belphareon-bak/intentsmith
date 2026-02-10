// ══════════════════════════════════════════════════════════════════════════════
// INTEGRATION PATCH: server.js — Enhanced Planner API (Phase C2)
// ══════════════════════════════════════════════════════════════════════════════
//
// ADD/REPLACE these routes in the `routes` object in server.js
// ══════════════════════════════════════════════════════════════════════════════

  // Enhanced progress with time estimates and detailed breakdown
  'GET /planner/progress': async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('id');
    const detailed = url.searchParams.get('detailed') === 'true';

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const { buildProgressApiResponse, formatDetailedProgress } = await import('./planner/progress-tracker.js');

      if (sessionId) {
        const progress = workflowOrchestrator.getProgress(sessionId);
        if (!progress) {
          return sendJSON(res, 404, { error: 'Session not found' });
        }
        const data = detailed
          ? formatDetailedProgress(progress)
          : progress;
        sendJSON(res, 200, data);
      } else {
        // All sessions with progress
        const result = buildProgressApiResponse(
          (id) => workflowOrchestrator.getProgress(id),
          (opts) => workflowOrchestrator.listSessions(opts),
        );
        sendJSON(res, result.status, result.data);
      }
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

  // Dashboard: all sessions with compact progress summaries
  'GET /planner/dashboard': async (req, res) => {
    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const { formatDetailedProgress, estimateRemainingTime } = await import('./planner/progress-tracker.js');

      const sessions = workflowOrchestrator.listSessions({ activeOnly: false });
      const dashboard = sessions.slice(0, 20).map(s => {
        const progress = workflowOrchestrator.getProgress(s.sessionId);
        return {
          sessionId: s.sessionId,
          state: s.state,
          planTitle: s.planTitle || null,
          request: s.request,
          complexity: s.complexity,
          percentage: progress?.percentage ?? 0,
          estimatedRemaining: progress ? estimateRemainingTime(progress) : null,
          blockerCount: progress?.blockers?.length || 0,
          fixAttempts: progress?.fixAttempts || 0,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });

      sendJSON(res, 200, {
        total: sessions.length,
        active: sessions.filter(s => s.state !== 'COMPLETED' && s.state !== 'FAILED').length,
        sessions: dashboard,
      });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

  // Project-scoped sessions: list sessions for a specific project
  'GET /planner/project/:projectId/sessions': async (req, res, params) => {
    try {
      const projectId = parseInt(params.projectId);
      if (isNaN(projectId)) {
        return sendJSON(res, 400, { error: 'Invalid projectId' });
      }

      const { workflowOrchestrator } = await import('./planner/index.js');

      // Get all sessions and filter by project
      const allSessions = workflowOrchestrator.listSessions({ activeOnly: false });
      // DB rows have project_id — filter at DB level would be better,
      // but for now we filter in memory
      const projectSessions = allSessions.filter(s => {
        // Need to check DB row for project_id
        const session = workflowOrchestrator.getSession(s.sessionId);
        return session && session.projectId === projectId;
      });

      sendJSON(res, 200, { projectId, sessions: projectSessions });
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },

// ══════════════════════════════════════════════════════════════════════════════
// ALSO ADD to server startup (after agent scheduler start, before listen):
//
//   // Phase C1: Preload active workflow sessions into RAM cache
//   try {
//     const { preloadActiveSessions } = await import('./chat/handlers/session-resume.js');
//     const count = preloadActiveSessions();
//     if (count > 0) logger.info('Server', `Preloaded ${count} active workflow sessions`);
//   } catch (err) {
//     logger.debug('Server', `Session preload skipped: ${err.message}`);
//   }
//
// ══════════════════════════════════════════════════════════════════════════════
