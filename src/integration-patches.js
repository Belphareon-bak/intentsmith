// Phase C — Integration Patches
// ══════════════════════════════════════════════════════════════════════════════
//
// These patches wire session-resume.js and progress-tracker.js into
// the existing codebase. Apply with copy-paste or automated patching.
//
// ══════════════════════════════════════════════════════════════════════════════

// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PATCH 1: chat/handlers/conversation.js                                 │
// │ Add resume/progress detection BEFORE build handoff intercept           │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Add to imports at the top of conversation.js:
//
//   import {
//     detectResumeIntent,
//     handleResumeRequest,
//     handleProgressRequest,
//   } from './session-resume.js';
//   import { setHandoffState } from './build-handoff.js';
//
// Then insert this block BEFORE the existing "BUILD HANDOFF INTERCEPT" section:
//
// === START INSERT (before line: "const activeHandoff = getActiveBuildHandoff(sessionId);") ===

export const CONVERSATION_PATCH_RESUME = `
  // ════════════════════════════════════════════════════════════════════════════
  // PHASE C1: SESSION RESUME / PROGRESS INTERCEPT
  // ════════════════════════════════════════════════════════════════════════════
  const resumeIntent = detectResumeIntent(input);
  if (resumeIntent === 'resume') {
    const result = await handleResumeRequest(input, context, setHandoffState);
    if (result.handled) {
      return {
        content: result.content,
        tag: 'RESPONSE',
        speaker: 'SYSTEM',
        mode: context.mode || 'conversation',
        confidence: 1.0,
        metadata: {
          resumeResult: true,
          pendingChoice: result.pendingChoice || null,
        },
      };
    }
  }

  if (resumeIntent === 'progress') {
    const result = handleProgressRequest();
    if (result.handled) {
      return {
        content: result.content,
        tag: 'RESPONSE',
        speaker: 'SYSTEM',
        mode: context.mode || 'conversation',
        confidence: 1.0,
        metadata: { progressReport: true },
      };
    }
  }
  // ════════════════════════════════════════════════════════════════════════════
`;

// === END INSERT ===


// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PATCH 2: server.js — Enhanced progress endpoint with time estimates    │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Replace the existing 'GET /planner/progress' route with:

export const SERVER_PATCH_PROGRESS = `
  'GET /planner/progress': async (req, res) => {
    const url = new URL(req.url, \`http://\${req.headers.host}\`);
    const sessionId = url.searchParams.get('id');
    const format = url.searchParams.get('format') || 'detailed'; // 'detailed' | 'summary' | 'raw'

    try {
      const { workflowOrchestrator } = await import('./planner/index.js');
      const { formatDetailedProgress, buildProgressApiResponse } = await import('./planner/progress-tracker.js');

      // Single session or all sessions
      if (sessionId) {
        const progress = workflowOrchestrator.getProgress(sessionId);
        if (!progress) {
          return sendJSON(res, 404, { error: 'Session not found' });
        }

        if (format === 'raw') {
          sendJSON(res, 200, progress);
        } else {
          sendJSON(res, 200, formatDetailedProgress(progress));
        }
      } else {
        // All sessions with progress
        const response = buildProgressApiResponse(
          (id) => workflowOrchestrator.getProgress(id),
          (opts) => workflowOrchestrator.listSessions(opts),
        );
        sendJSON(res, response.status, response.data);
      }
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  },
`;


// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PATCH 3: server.js — Enhanced resume with handoff state restoration    │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Replace existing 'POST /planner/resume' with:

export const SERVER_PATCH_RESUME = `
  'POST /planner/resume': async (req, res) => {
    const body = await parseBody(req);
    const { sessionId, chatSessionId } = body;

    if (!sessionId) {
      return sendJSON(res, 400, { error: 'sessionId is required' });
    }

    try {
      const { restoreSession } = await import('./chat/handlers/session-resume.js');

      // If chatSessionId provided, also restore handoff state in RAM
      const setHandoff = chatSessionId
        ? (await import('./chat/handlers/build-handoff.js')).setHandoffState
        : () => {};

      const result = await restoreSession(
        chatSessionId || 'api-session',
        sessionId,
        setHandoff,
      );

      sendJSON(res, result.success ? 200 : 404, result);
    } catch (err) {
      logger.error('Server', \`Planner resume error: \${err.message}\`);
      sendJSON(res, 500, { error: err.message });
    }
  },
`;


// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PATCH 4: server.js — Startup preload of active workflow sessions       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Add near the end of server.js where startup initialization happens:

export const SERVER_PATCH_STARTUP = `
  // Phase C1: Preload active workflow sessions into RAM cache on startup
  try {
    const { preloadActiveSessions } = await import('./chat/handlers/session-resume.js');
    const preloaded = preloadActiveSessions();
    if (preloaded > 0) {
      logger.info('Server', \`Preloaded \${preloaded} active workflow sessions\`);
    }
  } catch (err) {
    logger.debug('Server', \`Workflow preload skipped: \${err.message}\`);
  }
`;


// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PATCH 5: planner/index.js — re-export progress-tracker                │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Add to planner/index.js:

export const PLANNER_INDEX_PATCH = `
// Phase C2: Progress tracker with time estimates and formatting
export {
  formatProgress,
  formatSessionSummary,
  formatDetailedProgress,
  estimateRemainingTime,
  buildProgressApiResponse,
} from './progress-tracker.js';
`;


// ┌─────────────────────────────────────────────────────────────────────────┐
// │ PATCH 6: chat/handlers/build-handoff.js — export setHandoffState      │
// └─────────────────────────────────────────────────────────────────────────┘
//
// The existing build-handoff.js has setHandoffState as a local function.
// Add it to the exports block at the bottom:
//
// Before:
//   export { getActiveBuildHandoff, cancelBuildHandoff, ... };
//
// After:
//   export { getActiveBuildHandoff, cancelBuildHandoff, setHandoffState, ... };

export const BUILD_HANDOFF_EXPORT_PATCH = `
// Add setHandoffState to exports for session resume restoration
export { setHandoffState };
`;
