/**
 * Planner routes — extracted from server.js
 *
 * @param {object} deps
 * @returns {object} route map
 */
export function createPlannerRoutes(deps) {
  const { parseBody, sendJSON, safeError, safeParseInt, logger } = deps;

  return {
    'POST /planner/start': async (req, res) => {
      const body = await parseBody(req);
      const { request, context } = body;

      if (!request) {
        return sendJSON(res, 400, { error: 'request is required' });
      }

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const result = await workflowOrchestrator.start(request, context || {});
        sendJSON(res, 200, result);
      } catch (err) {
        logger.error('Server', `Planner start error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /planner/clarify': async (req, res) => {
      const body = await parseBody(req);
      const { sessionId, answers } = body;

      if (!sessionId || !answers) {
        return sendJSON(res, 400, { error: 'sessionId and answers are required' });
      }

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const result = await workflowOrchestrator.clarify(sessionId, answers);
        sendJSON(res, 200, result);
      } catch (err) {
        logger.error('Server', `Planner clarify error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /planner/approve': async (req, res) => {
      const body = await parseBody(req);
      const { sessionId } = body;

      if (!sessionId) {
        return sendJSON(res, 400, { error: 'sessionId is required' });
      }

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const result = await workflowOrchestrator.approve(sessionId);
        sendJSON(res, 200, result);
      } catch (err) {
        logger.error('Server', `Planner approve error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /planner/reject': async (req, res) => {
      const body = await parseBody(req);
      const { sessionId, feedback } = body;

      if (!sessionId) {
        return sendJSON(res, 400, { error: 'sessionId is required' });
      }

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const result = await workflowOrchestrator.reject(sessionId, feedback || '');
        sendJSON(res, 200, result);
      } catch (err) {
        logger.error('Server', `Planner reject error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /planner/session': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('id');

      if (!sessionId) {
        return sendJSON(res, 400, { error: 'id query param is required' });
      }

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const session = workflowOrchestrator.getSession(sessionId);
        if (!session) {
          return sendJSON(res, 404, { error: 'Session not found' });
        }
        sendJSON(res, 200, {
          id: session.id,
          state: session.state,
          plan: session.plan,
          fixAttempts: session.fixAttempts,
          redesignAttempts: session.redesignAttempts,
          historyLength: session.history.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /planner/sessions': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const activeOnly = url.searchParams.get('all') !== 'true';

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const sessions = workflowOrchestrator.listSessions({ activeOnly });
        sendJSON(res, 200, { sessions });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Phase C2: Enhanced progress with time estimates and detailed breakdown
    'GET /planner/progress': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('id');
      const detailed = url.searchParams.get('detailed') === 'true';

      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const { buildProgressApiResponse, formatDetailedProgress } = await import('../planner/progress-tracker.js');

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
        sendJSON(res, 500, safeError(err));
      }
    },

    // Phase C2: Dashboard — all sessions with compact progress summaries
    'GET /planner/dashboard': async (req, res) => {
      try {
        const { workflowOrchestrator } = await import('../planner/index.js');
        const { formatDetailedProgress, estimateRemainingTime } = await import('../planner/progress-tracker.js');

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
        sendJSON(res, 500, safeError(err));
      }
    },

    // Phase C: Project-scoped sessions
    'GET /planner/project/:projectId/sessions': async (req, res, params) => {
      try {
        const projectId = safeParseInt(params.projectId, 'projectId');
        if (isNaN(projectId)) {
          return sendJSON(res, 400, { error: 'Invalid projectId' });
        }

        const { workflowOrchestrator } = await import('../planner/index.js');
        const allSessions = workflowOrchestrator.listSessions({ activeOnly: false });
        const projectSessions = allSessions.filter(s => {
          const session = workflowOrchestrator.getSession(s.sessionId);
          return session && session.projectId === projectId;
        });

        sendJSON(res, 200, { projectId, sessions: projectSessions });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Phase C1: Enhanced resume with handoff state restoration
    'POST /planner/resume': async (req, res) => {
      const body = await parseBody(req);
      const { sessionId, chatSessionId } = body;

      if (!sessionId) {
        return sendJSON(res, 400, { error: 'sessionId is required' });
      }

      try {
        const { restoreSession } = await import('../chat/handlers/session-resume.js');
        const setHandoff = chatSessionId
          ? (await import('../chat/handlers/build-handoff.js')).setHandoffState
          : () => {};

        const result = await restoreSession(
          chatSessionId || 'api-session',
          sessionId,
          setHandoff,
        );

        sendJSON(res, result.success ? 200 : 404, result);
      } catch (err) {
        logger.error('Server', `Planner resume error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
