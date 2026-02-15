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
        const { normalizeAgentDefinition } = await import('../agents/schema.js');
        const normalized = normalizeAgentDefinition(body.definition);
        if (normalized.errors.length > 0) {
          sendJSON(res, 200, { valid: false, errors: normalized.errors, warnings: normalized.warnings, definition: normalized.definition });
          return;
        }
        const result = await agentRunner.dryRun(normalized.definition);
        result.warnings = [...(result.warnings || []), ...normalized.warnings];
        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/agents/schema': async (req, res) => {
      const { ALLOWED, LIMITS } = await import('../agents/schema.js');
      sendJSON(res, 200, {
        types: ['MONITOR', 'HUNTER', 'TRACKER', 'DIGEST', 'SCOUT'],
        typeDescriptions: {
          MONITOR: 'Sleduje podminku a notifikuje pri splneni (pocasi, ceny, dostupnost)',
          HUNTER: 'Hleda nove polozky matching kriteria (inzeraty, nabidky)',
          TRACKER: 'Sleduje vlastni polozky v case (zaruky, platnosti, terminy)',
          DIGEST: 'Pravidelne sbira a sumarizuje informace (zpravy, updaty)',
          SCOUT: 'Prozkoumava a navrhuje (AI novinky, vylepseni)'
        },
        allowed: {
          schedule_types: ALLOWED.schedule_types,
          intervals: ALLOWED.intervals,
          source_types: ALLOWED.source_types,
          condition_types: ALLOWED.condition_types,
          operators: ALLOWED.operators,
          trigger_edges: ALLOWED.trigger_edges,
          action_types: ALLOWED.action_types,
          priorities: ALLOWED.priorities
        },
        limits: {
          max_sources: LIMITS.max_sources,
          max_conditions: LIMITS.max_conditions,
          max_triggers: LIMITS.max_triggers,
          max_actions: LIMITS.max_actions,
          max_params: LIMITS.max_params,
          min_cooldown: LIMITS.min_cooldown,
          max_cooldown: LIMITS.max_cooldown
        },
        presets: {
          MONITOR: {
            label: 'Monitor', icon: '\u{1F514}',
            schedule: { type: 'cron', value: '0 7,12,18 * * *' },
            sources: [{ id: 'src-1', type: 'http', config: { url: '' } }],
            conditions: [{ id: 'cond-1', type: 'compare', field: 'sources.src-1.data', operator: '>', value: '' }],
            triggers: [{ id: 'trig-1', condition_id: 'cond-1', edge: 'rising', cooldown: 300, max_fires_per_day: 10 }],
            actions: [{ type: 'notify', trigger_id: 'trig-1', config: { channel: 'push', title: '', message: '', priority: 'normal' } }]
          },
          HUNTER: {
            label: 'Hunter', icon: '\u{1F50D}',
            schedule: { type: 'interval', value: '4h' },
            sources: [{ id: 'src-1', type: 'scraper', config: { url: '' } }],
            conditions: [{ id: 'cond-1', type: 'new_items', field: 'sources.src-1.items' }],
            triggers: [{ id: 'trig-1', condition_id: 'cond-1', edge: 'rising', cooldown: 300, max_fires_per_day: 10 }],
            actions: [
              { type: 'mark_seen', trigger_id: 'trig-1', config: { source_id: 'src-1', id_field: 'id' } },
              { type: 'notify', trigger_id: 'trig-1', config: { channel: 'push', title: 'Nova nabidka', message: '', priority: 'normal' } }
            ]
          },
          TRACKER: {
            label: 'Tracker', icon: '\u{1F4C5}',
            schedule: { type: 'cron', value: '0 8 * * *' },
            sources: [{ id: 'src-1', type: 'database', config: { table: 'user_inventory' } }],
            conditions: [{ id: 'cond-1', type: 'date_diff', field: 'sources.src-1.data', operator: '<', value: 30, unit: 'days' }],
            triggers: [{ id: 'trig-1', condition_id: 'cond-1', edge: 'rising', cooldown: 86400, max_fires_per_day: 3 }],
            actions: [{ type: 'notify', trigger_id: 'trig-1', config: { channel: 'push', title: 'Blizi se termin', message: '', priority: 'high' } }]
          },
          DIGEST: {
            label: 'Digest', icon: '\u{1F4F0}',
            schedule: { type: 'cron', value: '0 8 * * *' },
            sources: [{ id: 'src-1', type: 'rss', config: { url: '', limit: 20 } }],
            conditions: [{ id: 'cond-1', type: 'new_items', field: 'sources.src-1.items' }],
            triggers: [{ id: 'trig-1', condition_id: 'cond-1', edge: 'rising', cooldown: 3600, max_fires_per_day: 3 }],
            actions: [
              { type: 'store', trigger_id: 'trig-1', config: { key: 'digest_items' } },
              { type: 'notify', trigger_id: 'trig-1', config: { channel: 'push', title: 'Denni prehled', message: '', priority: 'normal' } }
            ]
          },
          SCOUT: {
            label: 'Scout', icon: '\u{1F52D}',
            schedule: { type: 'cron', value: '0 9 * * 1' },
            sources: [{ id: 'src-1', type: 'scraper', config: { url: '' } }],
            conditions: [{ id: 'cond-1', type: 'exists', field: 'sources.src-1.data' }],
            triggers: [{ id: 'trig-1', condition_id: 'cond-1', edge: 'rising', cooldown: 86400, max_fires_per_day: 2 }],
            actions: [{ type: 'notify', trigger_id: 'trig-1', config: { channel: 'push', title: 'Scout report', message: '', priority: 'normal', use_llm: true } }]
          }
        }
      });
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
