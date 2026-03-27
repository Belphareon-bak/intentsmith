// v135: Governor Routes — health monitoring and improvement proposals
// ══════════════════════════════════════════════════════════════════════════════

import { systemGovernor } from '../system/governor/system-governor.js';

/**
 * @param {{ sendJSON: Function, parseBody: Function }} deps
 */
export function createGovernorRoutes({ sendJSON, parseBody }) {
  return {
    // ── Status (lightweight) ────────────────────────────────────────────────
    'GET /api/system/governor/status': (req, res) => {
      try {
        const status = systemGovernor.getStatus();
        sendJSON(res, status.enabled ? 200 : 503, status);
      } catch (e) {
        sendJSON(res, 503, { error: 'Governor not initialized' });
      }
    },

    // ── Latest Report ───────────────────────────────────────────────────────
    'GET /api/system/governor/report': (req, res) => {
      try {
        const report = systemGovernor.getLatestReport();
        if (!report) return sendJSON(res, 404, { error: 'No reports yet' });
        sendJSON(res, 200, report);
      } catch (e) {
        sendJSON(res, 503, { error: 'Governor not initialized' });
      }
    },

    // ── Trigger Check ───────────────────────────────────────────────────────
    'POST /api/system/governor/check': async (req, res) => {
      try {
        const report = systemGovernor.runCheck();
        sendJSON(res, 200, report);
      } catch (e) {
        if (e.code === 'RATE_LIMITED') return sendJSON(res, 429, { error: 'Rate limited. Wait 30s.' });
        sendJSON(res, 500, { error: e.message });
      }
    },

    // ── Pending Proposals ───────────────────────────────────────────────────
    'GET /api/system/governor/proposals': (req, res) => {
      try {
        const proposals = systemGovernor.getProposals('pending');
        sendJSON(res, 200, { proposals });
      } catch (e) {
        sendJSON(res, 503, { error: 'Governor not initialized' });
      }
    },

    // ── Approve Proposal ────────────────────────────────────────────────────
    'POST /api/system/governor/proposals/:id/approve': async (req, res) => {
      try {
        const id = parseInt(req.params?.id ?? req.url.split('/').at(-2), 10);
        if (isNaN(id)) return sendJSON(res, 400, { error: 'Invalid ID' });
        const result = systemGovernor.approveProposal(id);
        if (!result.success) return sendJSON(res, 404, { error: result.error });
        sendJSON(res, 200, result);
      } catch (e) {
        sendJSON(res, 503, { error: e.message });
      }
    },

    // ── Dismiss Proposal ────────────────────────────────────────────────────
    'POST /api/system/governor/proposals/:id/dismiss': async (req, res) => {
      try {
        const id = parseInt(req.params?.id ?? req.url.split('/').at(-2), 10);
        if (isNaN(id)) return sendJSON(res, 400, { error: 'Invalid ID' });
        const result = systemGovernor.dismissProposal(id);
        if (!result.success) return sendJSON(res, 404, { error: result.error });
        sendJSON(res, 200, result);
      } catch (e) {
        sendJSON(res, 503, { error: e.message });
      }
    },
  };
}
