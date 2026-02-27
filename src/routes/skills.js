// Skill API routes — skill listing, execution status, confirm/cancel/resume, reload (v85)

import { skillRegistry } from '../skills/registry.js';
import { skillExecutions, skillSteps } from '../db/database.js';
import { confirmAndExecute, resume, cancel, getStatus } from '../skills/runner.js';

export function createSkillRoutes(deps) {
  const { sendJSON, safeError, logger } = deps;

  return {
    // GET /api/skills — list all registered skills
    'GET /api/skills': (req, res) => {
      try {
        sendJSON(res, 200, { skills: skillRegistry.list() });
      } catch (err) {
        logger.error('Skills', `List error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // GET /api/skills/:id — get full skill definition
    'GET /api/skills/:id': (req, res, params) => {
      try {
        const skill = skillRegistry.get(params.id);
        if (!skill) {
          sendJSON(res, 404, { error: `Skill "${params.id}" not found` });
          return;
        }
        sendJSON(res, 200, { skill });
      } catch (err) {
        logger.error('Skills', `Get error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/skills/reload — hot-reload skill definitions
    'POST /api/skills/reload': (req, res) => {
      try {
        const result = skillRegistry.reload();
        logger.info('Skills', `Reloaded: ${result.loaded} skills`);
        sendJSON(res, 200, result);
      } catch (err) {
        logger.error('Skills', `Reload error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // GET /api/skills/executions/:id — execution status + step details
    'GET /api/skills/executions/:id': (req, res, params) => {
      try {
        const status = getStatus(params.id);
        if (!status) {
          sendJSON(res, 404, { error: `Execution "${params.id}" not found` });
          return;
        }
        sendJSON(res, 200, { execution: status });
      } catch (err) {
        logger.error('Skills', `Status error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/skills/executions/:id/confirm — confirm & execute
    'POST /api/skills/executions/:id/confirm': async (req, res, params) => {
      try {
        const exec = skillExecutions.findById.get(params.id);
        if (!exec) {
          sendJSON(res, 404, { error: `Execution "${params.id}" not found` });
          return;
        }
        if (exec.state !== 'CONFIRMING') {
          sendJSON(res, 409, { error: `Execution is ${exec.state}, expected CONFIRMING` });
          return;
        }

        const result = await confirmAndExecute(params.id);
        sendJSON(res, 200, { result });
      } catch (err) {
        logger.error('Skills', `Confirm error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/skills/executions/:id/resume — resume AWAITING_INPUT execution
    'POST /api/skills/executions/:id/resume': async (req, res, params, body) => {
      try {
        const exec = skillExecutions.findById.get(params.id);
        if (!exec) {
          sendJSON(res, 404, { error: `Execution "${params.id}" not found` });
          return;
        }
        if (exec.state !== 'AWAITING_INPUT') {
          sendJSON(res, 409, { error: `Execution is ${exec.state}, expected AWAITING_INPUT` });
          return;
        }

        const userInput = body?.input || body?.content || '';
        if (!userInput) {
          sendJSON(res, 400, { error: 'Missing "input" field in request body' });
          return;
        }

        const result = await resume(params.id, userInput);
        sendJSON(res, 200, { result });
      } catch (err) {
        logger.error('Skills', `Resume error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // POST /api/skills/executions/:id/cancel — cancel pending or awaiting execution
    'POST /api/skills/executions/:id/cancel': (req, res, params) => {
      try {
        const success = cancel(params.id);
        if (!success) {
          sendJSON(res, 409, { error: `Cannot cancel execution "${params.id}" (not in CONFIRMING or AWAITING_INPUT state)` });
          return;
        }
        sendJSON(res, 200, { success: true });
      } catch (err) {
        logger.error('Skills', `Cancel error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
