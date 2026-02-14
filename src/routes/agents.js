/**
 * Agent platform routes — extracted from server.js
 *
 * @param {object} deps
 * @returns {object} route map keyed by "METHOD /path"
 */
export function createAgentPlatformRoutes(deps) {
  const {
    parseBody,
    sendJSON,
    safeError,
    sendStaticFile,
    createMockResponse,
    agentRoutes,
    agentRunner
  } = deps;

  return {
    'GET /agents': async (req, res) => {
      await sendStaticFile(res, 'src/agents/agents.html', 'text/html');
    },

    'GET /api/agents': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const mockReq = { query: { all: url.searchParams.get('all') } };
      const mockRes = createMockResponse(res);
      await agentRoutes.listAgents(mockReq, mockRes);
    },

    'GET /api/agents/:id': async (req, res, params) => {
      const mockReq = { params: { id: params.id } };
      const mockRes = createMockResponse(res);
      await agentRoutes.getAgent(mockReq, mockRes);
    },

    'POST /api/agents': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.createAgent(mockReq, mockRes);
    },

    'PUT /api/agents/:id': async (req, res, params) => {
      const body = await parseBody(req);
      const mockReq = { params: { id: params.id }, body };
      const mockRes = createMockResponse(res);
      await agentRoutes.updateAgent(mockReq, mockRes);
    },

    'DELETE /api/agents/:id': async (req, res, params) => {
      const mockReq = { params: { id: params.id } };
      const mockRes = createMockResponse(res);
      await agentRoutes.deleteAgent(mockReq, mockRes);
    },

    'POST /api/agents/:id/run': async (req, res, params) => {
      const mockReq = { params: { id: params.id } };
      const mockRes = createMockResponse(res);
      await agentRoutes.runAgent(mockReq, mockRes);
    },

    'POST /api/agents/:id/enable': async (req, res, params) => {
      const mockReq = { params: { id: params.id } };
      const mockRes = createMockResponse(res);
      await agentRoutes.enableAgent(mockReq, mockRes);
    },

    'POST /api/agents/:id/disable': async (req, res, params) => {
      const mockReq = { params: { id: params.id } };
      const mockRes = createMockResponse(res);
      await agentRoutes.disableAgent(mockReq, mockRes);
    },

    'GET /api/agents/:id/runs': async (req, res, params) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const mockReq = { 
        params: { id: params.id },
        query: { limit: url.searchParams.get('limit') }
      };
      const mockRes = createMockResponse(res);
      await agentRoutes.getAgentRuns(mockReq, mockRes);
    },

    'POST /api/agents/build': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.createFromDescription(mockReq, mockRes);
    },

    'POST /api/agents/refine': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.refineAgent(mockReq, mockRes);
    },

    'POST /api/agents/confirm': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.confirmAgent(mockReq, mockRes);
    },

    'POST /api/agents/dry-run': async (req, res) => {
      const body = await parseBody(req);
      try {
        const result = await agentRunner.dryRun(body.definition);
        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/sources/inspect': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.inspectSourceUrl(mockReq, mockRes);
    },

    'POST /api/sources/validate-field': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.validateField(mockReq, mockRes);
    },

    'POST /api/sources/validate-condition': async (req, res) => {
      const body = await parseBody(req);
      const mockReq = { body };
      const mockRes = createMockResponse(res);
      await agentRoutes.validateCondition(mockReq, mockRes);
    },

    'GET /api/notifications': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const mockReq = { 
        query: { 
          unread: url.searchParams.get('unread'),
          limit: url.searchParams.get('limit')
        }
      };
      const mockRes = createMockResponse(res);
      await agentRoutes.getNotifications(mockReq, mockRes);
    },

    'POST /api/notifications/:id/read': async (req, res, params) => {
      const mockReq = { params: { id: params.id } };
      const mockRes = createMockResponse(res);
      await agentRoutes.markNotificationRead(mockReq, mockRes);
    },

    'POST /api/notifications/read-all': async (req, res) => {
      const mockRes = createMockResponse(res);
      await agentRoutes.markAllNotificationsRead({}, mockRes);
    },

    'GET /api/scheduler/status': async (req, res) => {
      const mockRes = createMockResponse(res);
      await agentRoutes.getSchedulerStatus({}, mockRes);
    },
  };
}
