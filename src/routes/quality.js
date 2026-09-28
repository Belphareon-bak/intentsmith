// Quality Score API routes
export function createQualityRoutes(deps) {
  const { sendJSON, safeError, logger } = deps;

  return {
    // GET /api/quality/summary?since=30&type=spec
    'GET /api/quality/summary': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const sinceDays = parseInt(url.searchParams.get('since')) || 0;
        const artifactType = url.searchParams.get('type') || undefined;

        const { getSummary } = await import('../planner/quality-report.js');
        const summary = getSummary({ sinceDays, artifactType });
        sendJSON(res, 200, summary);
      } catch (err) {
        logger.error('Server', `Quality summary error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // GET /api/quality/distribution?since=30&type=spec
    'GET /api/quality/distribution': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const sinceDays = parseInt(url.searchParams.get('since')) || 0;
        const artifactType = url.searchParams.get('type') || undefined;

        const { getDistribution } = await import('../planner/quality-report.js');
        const dist = getDistribution({ sinceDays, artifactType });
        sendJSON(res, 200, dist);
      } catch (err) {
        logger.error('Server', `Quality distribution error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // GET /api/quality/project/:id
    'GET /api/quality/project/:id': async (req, res, params) => {
      try {
        const { getProjectReport } = await import('../planner/quality-report.js');
        const report = getProjectReport(params.id);
        sendJSON(res, 200, report);
      } catch (err) {
        logger.error('Server', `Quality project report error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // GET /api/quality/volatility/:id
    'GET /api/quality/volatility/:id': async (req, res, params) => {
      try {
        const { getVolatilityIndex } = await import('../planner/quality-report.js');
        const volatility = getVolatilityIndex(params.id);
        sendJSON(res, 200, { lifecycle_id: params.id, volatility });
      } catch (err) {
        logger.error('Server', `Quality volatility error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // GET /api/quality/report?since=30
    'GET /api/quality/report': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const sinceDays = parseInt(url.searchParams.get('since')) || 30;

        const { generateTextReport } = await import('../planner/quality-report.js');
        const text = generateTextReport({ sinceDays });

        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
      } catch (err) {
        logger.error('Server', `Quality report error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
