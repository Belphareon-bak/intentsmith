// Autonomy API routes — operator interface for Guarded Autonomy MVP v1

export function createAutonomyRoutes(deps) {
  // Statements come from deps like every other route module, so importing this
  // file does not require C3_DB_PATH to be set.
  const { telemetryMetrics, telemetryAlerts, telemetryImprovements } = deps.db;
  const { sendJSON, safeError, logger, creEngine } = deps;

  return {
    // GET /api/autonomy/status — current state overview
    'GET /api/autonomy/status': async (req, res) => {
      try {
        const currentThreshold = creEngine.getOverrideThreshold();
        const latestMetrics = telemetryMetrics.latest.get();
        const pendingProposals = telemetryImprovements.pending.all();
        const unacknowledgedAlerts = telemetryAlerts.unacknowledged.all();
        const latestImprovement = telemetryImprovements.latestByParam.get('overrideThreshold');

        // Trust level
        const trustResult = telemetryImprovements.consecutiveApplied.get('overrideThreshold', 10);
        const trustLevel = trustResult?.count ?? 0;

        sendJSON(res, 200, {
          currentThreshold,
          trustLevel,
          autoApplyEnabled: trustLevel >= 10,
          latestMetrics: latestMetrics || null,
          latestImprovement: latestImprovement || null,
          pendingProposals,
          unacknowledgedAlerts,
        });
      } catch (err) {
        logger.error('Autonomy', `Status error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/autonomy/approve/:id — approve a pending proposal
    'POST /api/autonomy/approve/:id': async (req, res, params) => {
      try {
        const id = parseInt(params.id);
        if (!id || id <= 0) {
          sendJSON(res, 400, { error: 'Invalid improvement ID' });
          return;
        }

        const improvement = telemetryImprovements.findById.get(id);
        if (!improvement) {
          sendJSON(res, 404, { error: `Improvement #${id} not found` });
          return;
        }

        if (improvement.status !== 'proposed') {
          sendJSON(res, 409, { error: `Improvement #${id} is ${improvement.status}, not proposed` });
          return;
        }

        // Apply the change
        creEngine.setOverrideThreshold(improvement.new_value);
        telemetryImprovements.updateStatus.run('applied', 'applied', id);

        logger.info('Autonomy', `APPROVED: improvement #${id}, overrideThreshold ${improvement.old_value} → ${improvement.new_value}`);

        sendJSON(res, 200, {
          success: true,
          improvement: { ...improvement, status: 'applied' },
          currentThreshold: creEngine.getOverrideThreshold(),
        });
      } catch (err) {
        logger.error('Autonomy', `Approve error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/autonomy/reject/:id — reject a pending proposal
    'POST /api/autonomy/reject/:id': async (req, res, params) => {
      try {
        const id = parseInt(params.id);
        if (!id || id <= 0) {
          sendJSON(res, 400, { error: 'Invalid improvement ID' });
          return;
        }

        const improvement = telemetryImprovements.findById.get(id);
        if (!improvement) {
          sendJSON(res, 404, { error: `Improvement #${id} not found` });
          return;
        }

        if (improvement.status !== 'proposed') {
          sendJSON(res, 409, { error: `Improvement #${id} is ${improvement.status}, not proposed` });
          return;
        }

        telemetryImprovements.updateStatus.run('rejected', 'rejected', id);

        logger.info('Autonomy', `REJECTED: improvement #${id}`);

        sendJSON(res, 200, {
          success: true,
          improvement: { ...improvement, status: 'rejected' },
        });
      } catch (err) {
        logger.error('Autonomy', `Reject error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/autonomy/alerts/:id/acknowledge — acknowledge an alert
    'POST /api/autonomy/alerts/:id/acknowledge': async (req, res, params) => {
      try {
        const id = parseInt(params.id);
        if (!id || id <= 0) {
          sendJSON(res, 400, { error: 'Invalid alert ID' });
          return;
        }

        const result = telemetryAlerts.acknowledge.run(id);
        if (result.changes === 0) {
          sendJSON(res, 404, { error: `Alert #${id} not found` });
          return;
        }
        sendJSON(res, 200, { success: true });
      } catch (err) {
        logger.error('Autonomy', `Acknowledge error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
