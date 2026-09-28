/**
 * Architect routes.
 *
 * @param {object} deps
 * @returns {object} route map keyed by "METHOD /path"
 */
export function createArchitectRoutes(deps) {
  const {
    parseBody,
    sendJSON,
    sendHTML,
    sendStaticFile,
    safeError,
    logger,
    getArchitectSession,
    setArchitectSession,
    getArchitectUIHTML,
  } = deps;

  return {
    'POST /architect/init': async (req, res) => {
      const body = await parseBody(req);
      const { projectRoot, projectName } = body;

      if (!projectRoot || !projectName) {
        return sendJSON(res, 400, { error: 'projectRoot and projectName are required' });
      }

      try {
        const { createArchitect } = await import('../architect/index.js');
        const orchestrator = await createArchitect(projectRoot, projectName);

        setArchitectSession(projectRoot, orchestrator);

        sendJSON(res, 200, {
          success: true,
          project: projectName,
          state: orchestrator.getSessionInfo(),
        });
      } catch (err) {
        logger.error('Server', `Architect init error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /architect/message': async (req, res) => {
      const body = await parseBody(req);
      const { projectRoot, message, attachments } = body;

      if (!projectRoot || !message) {
        return sendJSON(res, 400, { error: 'projectRoot and message are required' });
      }

      try {
        let orchestrator = getArchitectSession(projectRoot);

        if (!orchestrator) {
          const { ConversationOrchestrator } = await import('../architect/index.js');
          orchestrator = new ConversationOrchestrator(projectRoot);
          await orchestrator.init('unknown');
          setArchitectSession(projectRoot, orchestrator);
        }

        const result = await orchestrator.process(message, attachments || []);

        sendJSON(res, 200, {
          ...result,
          state: orchestrator.getSessionInfo(),
        });
      } catch (err) {
        logger.error('Server', `Architect message error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /architect/status/:projectRoot': async (req, res, params) => {
      const projectRoot = decodeURIComponent(params.projectRoot);

      try {
        const orchestrator = getArchitectSession(projectRoot);

        if (!orchestrator) {
          return sendJSON(res, 404, { error: 'Project not loaded' });
        }

        sendJSON(res, 200, orchestrator.getSessionInfo());
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /architect/action': async (req, res) => {
      const body = await parseBody(req);
      const { projectRoot, action } = body;

      if (!projectRoot || !action) {
        return sendJSON(res, 400, { error: 'projectRoot and action are required' });
      }

      try {
        const orchestrator = getArchitectSession(projectRoot);

        if (!orchestrator) {
          return sendJSON(res, 404, { error: 'Project not loaded' });
        }

        const result = await orchestrator.actions.execute(action);

        sendJSON(res, 200, {
          ...result,
          state: orchestrator.getSessionInfo(),
        });
      } catch (err) {
        logger.error('Server', `Architect action error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // UI
    'GET /architect': async (req, res) => {
      sendHTML(res, await getArchitectUIHTML());
    },

    'GET /architect/architect.css': async (req, res) => {
      await sendStaticFile(res, 'src/ui/architect/architect.css', 'text/css');
    },

    'GET /architect/architect.js': async (req, res) => {
      await sendStaticFile(res, 'src/ui/architect/architect.js', 'application/javascript');
    },
  };
}
