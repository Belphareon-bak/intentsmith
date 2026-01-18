// C.3 v33 Agents Module
// ══════════════════════════════════════════════════════════════════════════════

export { validateAgentDefinition, applyDefaults, ALLOWED, LIMITS, DEFAULTS } from './schema.js';
export { ConditionEvaluator } from './conditions.js';
export { TriggerEvaluator } from './triggers.js';
export { AgentRunner } from './runner.js';
export { AgentBuilder } from './builder.js';
export { LLMServices } from './llm-services.js';
export { initAgentTables, AgentRepository } from './repository.js';
export { AgentScheduler } from './scheduler.js';
export { createAgentRoutes } from './api.js';

/**
 * Initialize complete agent system
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {object} deps.llmClient
 * @param {object} deps.logger
 */
export function initAgentSystem({ db, llmClient, logger = console }) {
  const { initAgentTables, AgentRepository } = require('./repository.js');
  const { AgentRunner } = require('./runner.js');
  const { AgentBuilder } = require('./builder.js');
  const { LLMServices } = require('./llm-services.js');
  const { AgentScheduler } = require('./scheduler.js');
  
  // Initialize tables
  initAgentTables(db);
  
  // Create components
  const repository = new AgentRepository(db);
  const llmServices = llmClient ? new LLMServices({ llmClient }) : null;
  const builder = llmClient ? new AgentBuilder({ llmClient }) : null;
  const runner = new AgentRunner({ repository, llmServices, logger });
  const scheduler = new AgentScheduler({ repository, runner, logger });
  
  return {
    repository,
    runner,
    builder,
    scheduler,
    llmServices,
    
    start: (intervalMs) => scheduler.start(intervalMs),
    stop: () => scheduler.stop(),
    getStatus: () => scheduler.getStatus()
  };
}

export default {
  initAgentSystem
};
