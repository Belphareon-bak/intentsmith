// C.3 v57.0 Agent Runner - Execution Engine
// ══════════════════════════════════════════════════════════════════════════════
// Runner je čistě deterministický:
// 1. Fetch data
// 2. Evaluate conditions
// 3. Detect trigger edges
// 4. Execute mark_seen (transactional, before business actions)
// 5. Dispatch business actions (with retry/backoff)
//
// LLM je volán POUZE z akcí (notify s use_llm: true), nikdy z runneru

import { ConditionEvaluator } from './conditions.js';
import { TriggerEvaluator } from './triggers.js';
import { EXTENSION_HOST_CAPABILITY } from '../../contracts/m3/extension-v1.js';
import { fetchProjectHealthSource } from './sources/project-health.js';

// ═══════════════════════════════════════════════════════════════════════════════
// v57.0 - RETRY CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
const RETRY_CONFIG = {
  maxAttempts: 3,                    // Max retry attempts for business actions
  baseDelayMs: 500,                  // Initial delay: 500ms
  backoffMultiplier: 2,              // Exponential: 500ms, 1000ms, 2000ms
  retryableTypes: ['notify', 'webhook'],  // Only these action types are retried
  // mark_seen, update_state, log are NOT retried (either succeed or fail permanently)
};

/**
 * v57.0 - Sleep helper for retry backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RUN STATE ENUM - Backend is source of truth
 * UI only maps these states to display text, no interpretation
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const RUN_STATE = {
  // Final success states
  SUCCESS_TRIGGERED: 'SUCCESS_TRIGGERED',     // Run completed, triggers fired, actions executed
  SUCCESS_NO_TRIGGER: 'SUCCESS_NO_TRIGGER',   // Run completed, no triggers fired (conditions not met)
  SUCCESS_NO_NEW: 'SUCCESS_NO_NEW',           // Run completed, no new items (HUNTER pattern - waiting)
  
  // Skip states (run not executed)
  SKIP_DISABLED: 'SKIP_DISABLED',             // Agent is disabled
  SKIP_SCHEMA_BROKEN: 'SKIP_SCHEMA_BROKEN',   // Schema is broken
  SKIP_COOLDOWN: 'SKIP_COOLDOWN',             // Cooldown not elapsed (schedule)
  
  // Error states
  ERROR_SOURCE: 'ERROR_SOURCE',               // Source fetch failed
  ERROR_EXECUTION: 'ERROR_EXECUTION',         // Action execution failed
  ERROR_UNKNOWN: 'ERROR_UNKNOWN',             // Unexpected error
  
  // Special states
  INIT_BASELINE: 'INIT_BASELINE',             // First run - baseline established
  SCHEMA_DEGRADED: 'SCHEMA_DEGRADED',         // Some conditions invalid but running
  SCHEMA_BROKEN: 'SCHEMA_BROKEN'              // Too many conditions invalid - auto-disabled
};

/**
 * Human-readable descriptions for each state (for UI reference)
 * UI should use these, NOT interpret the state itself
 */
export const RUN_STATE_INFO = {
  [RUN_STATE.SUCCESS_TRIGGERED]: {
    icon: '🔔',
    label: 'Triggers fired',
    desc: 'Podmínky splněny, akce vykonány',
    type: 'success'
  },
  [RUN_STATE.SUCCESS_NO_TRIGGER]: {
    icon: '✓',
    label: 'No trigger',
    desc: 'Běh OK, podmínky nesplněny',
    type: 'success'
  },
  [RUN_STATE.SUCCESS_NO_NEW]: {
    icon: '📭',
    label: 'Waiting',
    desc: 'Čeká na nové položky',
    type: 'info'
  },
  [RUN_STATE.SKIP_DISABLED]: {
    icon: '⏸',
    label: 'Disabled',
    desc: 'Agent je pozastaven',
    type: 'muted'
  },
  [RUN_STATE.SKIP_SCHEMA_BROKEN]: {
    icon: '⛔',
    label: 'Schema broken',
    desc: 'Schema je rozbité',
    type: 'error'
  },
  [RUN_STATE.SKIP_COOLDOWN]: {
    icon: '⏱',
    label: 'Cooldown',
    desc: 'Čeká na další plánovaný běh',
    type: 'muted'
  },
  [RUN_STATE.ERROR_SOURCE]: {
    icon: '❌',
    label: 'Source error',
    desc: 'Chyba načítání zdroje',
    type: 'error'
  },
  [RUN_STATE.ERROR_EXECUTION]: {
    icon: '❌',
    label: 'Action error',
    desc: 'Chyba vykonání akce',
    type: 'error'
  },
  [RUN_STATE.ERROR_UNKNOWN]: {
    icon: '❌',
    label: 'Error',
    desc: 'Neznámá chyba',
    type: 'error'
  },
  [RUN_STATE.INIT_BASELINE]: {
    icon: '🏁',
    label: 'Baseline set',
    desc: 'První běh - baseline nastaven',
    type: 'info'
  },
  [RUN_STATE.SCHEMA_DEGRADED]: {
    icon: '⚠️',
    label: 'Degraded',
    desc: 'Některé podmínky jsou neplatné',
    type: 'warning'
  },
  [RUN_STATE.SCHEMA_BROKEN]: {
    icon: '⛔',
    label: 'Broken',
    desc: 'Schema je rozbité - agent deaktivován',
    type: 'error'
  }
};

/**
 * Agent Runner - deterministic execution engine
 */
export class AgentRunner {
  constructor({
    repository,
    llmServices = null,
    notificationRouter = null,
    notificationPipeline = null,
    extensionService = null,
    projectContextBridge = null,
    logger = console,
  }) {
    this.repo = repository;
    this.llm = llmServices;
    this.notificationRouter = notificationRouter;
    this.notificationPipeline = notificationPipeline;
    this.extensionService = extensionService;
    this.projectContextBridge = projectContextBridge;
    this.logger = logger;
    this.conditions = new ConditionEvaluator();
    this.triggers = new TriggerEvaluator();
    
    // Source handlers
    this.sourceHandlers = {
      http: this.fetchHttp.bind(this),
      scraper: this.fetchScraper.bind(this),
      rss: this.fetchRss.bind(this),
      database: this.fetchDatabase.bind(this),
      project_context: this.fetchProjectContext.bind(this),
    };
  }
  
  /**
   * Dry run - validate agent config without executing
   * @param {object} config - Agent definition to validate
   * @returns {object} - Validation result with preview
   */
  async dryRun(config) {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
      preview: {
        sources: [],
        conditions: [],
        triggers: [],
        actions: []
      }
    };

    const def = config.definition || config;

    // ══════════════════════════════════════════════════════════════════════
    // VALIDATE SOURCES
    // ══════════════════════════════════════════════════════════════════════
    if (!def.sources || def.sources.length === 0) {
      validation.errors.push({
        field: 'sources',
        message: 'At least one source is required'
      });
      validation.valid = false;
    } else {
      for (const source of def.sources) {
        const sourceValidation = this.validateSource(source);
        if (!sourceValidation.valid) {
          validation.errors.push(...sourceValidation.errors.map(e => ({
            field: `sources.${source.id || 'unknown'}`,
            message: e
          })));
          validation.valid = false;
        }
        validation.preview.sources.push({
          id: source.id,
          type: source.type,
          valid: sourceValidation.valid,
          description: this.describeSource(source)
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDATE CONDITIONS
    // ══════════════════════════════════════════════════════════════════════
    for (const condition of def.conditions || []) {
      const conditionValidation = this.validateCondition(condition);
      if (!conditionValidation.valid) {
        validation.warnings.push({
          field: `conditions.${condition.id || 'unknown'}`,
          message: conditionValidation.error
        });
      }
      validation.preview.conditions.push({
        id: condition.id,
        type: condition.type,
        valid: conditionValidation.valid,
        description: this.describeCondition(condition)
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDATE TRIGGERS
    // ══════════════════════════════════════════════════════════════════════
    const conditionIds = new Set((def.conditions || []).map(c => c.id));

    for (const trigger of def.triggers || []) {
      const triggerValidation = this.validateTrigger(trigger, conditionIds);
      if (!triggerValidation.valid) {
        validation.errors.push({
          field: `triggers.${trigger.id || 'unknown'}`,
          message: triggerValidation.error
        });
        validation.valid = false;
      }
      validation.preview.triggers.push({
        id: trigger.id,
        type: trigger.type,
        valid: triggerValidation.valid,
        description: this.describeTrigger(trigger)
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDATE ACTIONS
    // ══════════════════════════════════════════════════════════════════════
    const triggerIds = new Set((def.triggers || []).map(t => t.id));

    for (const action of def.actions || []) {
      const actionValidation = this.validateAction(action, triggerIds);
      if (!actionValidation.valid) {
        validation.errors.push({
          field: `actions.${action.type || 'unknown'}`,
          message: actionValidation.error
        });
        validation.valid = false;
      }
      validation.preview.actions.push({
        type: action.type,
        trigger_id: action.trigger_id,
        valid: actionValidation.valid,
        description: this.describeAction(action)
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // VALIDATE SCHEDULE
    // ══════════════════════════════════════════════════════════════════════
    if (def.schedule) {
      const scheduleValidation = this.validateSchedule(def.schedule);
      if (!scheduleValidation.valid) {
        validation.errors.push({
          field: 'schedule',
          message: scheduleValidation.error
        });
        validation.valid = false;
      }
      validation.preview.schedule = {
        type: def.schedule.type,
        interval: def.schedule.interval,
        description: this.describeSchedule(def.schedule)
      };
    }

    return validation;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // VALIDATION HELPERS
  // ══════════════════════════════════════════════════════════════════════════════

  validateSource(source) {
    const errors = [];

    if (!source.id) errors.push('Source must have an id');
    if (!source.type) errors.push('Source must have a type');
    if (!this.sourceHandlers[source.type]) {
      errors.push(`Unknown source type: ${source.type}`);
    }
    if (!source.config) errors.push('Source must have config');

    return { valid: errors.length === 0, errors };
  }

  validateCondition(condition) {
    if (!condition.id) {
      return { valid: false, error: 'Condition must have an id' };
    }
    if (!condition.type) {
      return { valid: false, error: 'Condition must have a type' };
    }
    // Delegate to ConditionEvaluator for type-specific validation
    return this.conditions.validate ?
      this.conditions.validate(condition) :
      { valid: true };
  }

  validateTrigger(trigger, conditionIds) {
    if (!trigger.id) {
      return { valid: false, error: 'Trigger must have an id' };
    }
    if (!trigger.type) {
      return { valid: false, error: 'Trigger must have a type' };
    }
    // Check that referenced conditions exist
    if (trigger.condition_id && !conditionIds.has(trigger.condition_id)) {
      return { valid: false, error: `Referenced condition not found: ${trigger.condition_id}` };
    }
    return { valid: true };
  }

  validateAction(action, triggerIds) {
    if (!action.type) {
      return { valid: false, error: 'Action must have a type' };
    }
    // v57.0 - Added mark_seen as valid action type
    const validTypes = ['notify', 'webhook', 'update_state', 'log', 'mark_seen'];
    if (!validTypes.includes(action.type)) {
      return { valid: false, error: `Unknown action type: ${action.type}` };
    }
    // Check that referenced trigger exists (if specified)
    if (action.trigger_id !== null && action.trigger_id !== undefined && !triggerIds.has(action.trigger_id)) {
      return { valid: false, error: `Referenced trigger not found: ${action.trigger_id}` };
    }
    return { valid: true };
  }

  validateSchedule(schedule) {
    if (!schedule.type) {
      return { valid: false, error: 'Schedule must have a type' };
    }
    if (schedule.type === 'interval' && !schedule.interval) {
      return { valid: false, error: 'Interval schedule must have an interval' };
    }
    if (schedule.type === 'interval') {
      const match = schedule.interval.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        return { valid: false, error: `Invalid interval format: ${schedule.interval}. Use format like "5m", "1h", "1d"` };
      }
    }
    return { valid: true };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DESCRIPTION HELPERS (for preview)
  // ══════════════════════════════════════════════════════════════════════════════

  describeSource(source) {
    switch (source.type) {
      case 'http':
        return `HTTP request to ${source.config?.url || 'unknown URL'}`;
      case 'rss':
        return `RSS feed from ${source.config?.url || 'unknown URL'}`;
      case 'scraper':
        return `Web scrape of ${source.config?.url || 'unknown URL'}`;
      case 'database':
        return `Database query`;
      case 'project_context':
        return 'Governed M2 ProjectContext health snapshot';
      default:
        return `${source.type} source`;
    }
  }

  describeCondition(condition) {
    const c = condition;
    switch (c.type) {
      case 'compare':
        return `Compare ${c.field || 'field'} ${c.operator || '=='} ${c.value || 'value'}`;
      case 'threshold':
        return `${c.field || 'field'} ${c.direction || '>'} ${c.threshold || 'threshold'}`;
      case 'change':
        return `Detect change in ${c.field || 'field'}`;
      case 'contains':
        return `${c.field || 'field'} contains "${c.value || 'value'}"`;
      default:
        return `${c.type} condition`;
    }
  }

  describeTrigger(trigger) {
    switch (trigger.type) {
      case 'on_true':
        return `Fire when condition "${trigger.condition_id}" becomes true`;
      case 'on_false':
        return `Fire when condition "${trigger.condition_id}" becomes false`;
      case 'on_change':
        return `Fire when condition "${trigger.condition_id}" changes`;
      case 'always':
        return `Fire on every run`;
      default:
        return `${trigger.type} trigger`;
    }
  }

  describeAction(action) {
    const c = action.config || {};
    switch (action.type) {
      case 'notify':
        return c.use_llm ?
          `Send LLM-generated notification to ${c.channel || 'default'}` :
          `Send notification to ${c.channel || 'default'}`;
      case 'webhook':
        return `POST to ${c.url || 'unknown URL'}`;
      case 'update_state':
        return `Update agent state`;
      case 'log':
        return `Log message`;
      default:
        return `${action.type} action`;
    }
  }

  describeSchedule(schedule) {
    switch (schedule.type) {
      case 'interval':
        return `Run every ${schedule.interval}`;
      case 'cron':
        return `Cron: ${schedule.cron}`;
      case 'manual':
        return `Manual trigger only`;
      default:
        return `${schedule.type} schedule`;
    }
  }

  /**
   * Execute agent
   * @param {string} agentId
   * @param {object} options - { force: boolean, isManual: boolean }
   * @returns {object} - Always includes run_state for UI
   */
  async execute(agentId, options = {}) {
    const agent = this.repo.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    
    // ══════════════════════════════════════════════════════════════════════
    // PRE-CHECKS
    // ══════════════════════════════════════════════════════════════════════
    
    // Check if disabled
    if (!agent.enabled && !options.force) {
      return { 
        run_state: RUN_STATE.SKIP_DISABLED,
        status: 'skipped', 
        reason: 'disabled' 
      };
    }
    
    // Check schema status
    const prevSchemaStatus = agent.state?.schemaStatus || 'unknown';
    if (prevSchemaStatus === 'broken' && !options.force) {
      return { 
        run_state: RUN_STATE.SKIP_SCHEMA_BROKEN,
        status: 'skipped', 
        reason: 'schema_broken' 
      };
    }
    
    // Check cooldown (only for scheduled runs, not manual)
    if (!options.isManual && !options.force) {
      const cooldownOk = this.checkCooldown(agent);
      if (!cooldownOk) {
        return {
          run_state: RUN_STATE.SKIP_COOLDOWN,
          status: 'skipped',
          reason: 'cooldown',
          next_run: this.calculateNextRun(agent)
        };
      }
    }
    
    // ══════════════════════════════════════════════════════════════════════
    // START RUN
    // ══════════════════════════════════════════════════════════════════════
    const runId = this.repo.createRun(agentId);
    const now = new Date();
    const log = [];
    
    // Track if this is first run (for baseline detection)
    const isFirstRun = !agent.state?._last_run;
    
    try {
      log.push(`[${this.timestamp()}] Starting agent: ${agent.name}`);
      if (options.isManual) {
        log.push(`[${this.timestamp()}] 👆 Manual run (user initiated)`);
      }
      
      const def = agent.definition;
      const context = {
        params: agent.params || {},
        state: agent.state || {},
        now,
        sources: {},
        execution: { agentId, runId },
        _schemaValidation: { errors: [], warnings: [] }
      };

      if (def.sources.some(source => source.type === 'project_context')) {
        if (!this.extensionService || !this.projectContextBridge) {
          throw Object.assign(
            new Error('M3 agent extension authority is unavailable'),
            { code: 'M3_AGENT_EXTENSION_AUTHORITY_REQUIRED' },
          );
        }
        const extension = this.extensionService.resolveExecution(agent);
        context.execution.extensionId = extension.manifest.id;
        context.execution.extensionContext = extension.context;
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 1: Fetch sources (parallel)
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Fetching ${def.sources.length} sources...`);
      
      let sourceFailed = false;
      const sourcePromises = def.sources.map(async (source) => {
        try {
          const handler = this.sourceHandlers[source.type];
          if (!handler) throw new Error(`Unknown source type: ${source.type}`);
          
          const config = this.interpolateObject(source.config, context);
          const data = await handler(config, context);

          // v57.0 - Filter seen items for HUNTER pattern (uses DB, not in-memory state)
          const filteredData = this.filterSeenItems(data, source.id, agentId);
          
          context.sources[source.id] = { 
            status: 'ok', 
            data: filteredData,
            raw_count: Array.isArray(data) ? data.length : null,
            filtered_count: Array.isArray(filteredData) ? filteredData.length : null
          };
          log.push(`  ✓ ${source.id}: OK (${context.sources[source.id].filtered_count} items)`);
        } catch (err) {
          context.sources[source.id] = {
            status: 'error',
            error: err.message,
            ...(err.code ? { errorCode: err.code } : {}),
            ...(err.reason ? { errorReason: err.reason } : {}),
          };
          log.push(
            `  ✗ ${source.id}: ${err.message}`
            + (err.code ? ` [${err.code}${err.reason ? `:${err.reason}` : ''}]` : ''),
          );
          sourceFailed = true;
        }
      });
      await Promise.all(sourcePromises);
      
      // Check if all sources failed
      if (sourceFailed && Object.values(context.sources).every(s => s.status === 'error')) {
        const sourceErrors = Object.entries(context.sources).map(([id, source]) => ({
          id,
          error: source.error,
          ...(source.errorCode ? { errorCode: source.errorCode } : {}),
          ...(source.errorReason ? { errorReason: source.errorReason } : {}),
        }));
        log.push(`[${this.timestamp()}] ⛔ All sources failed`);
        this.repo.completeRun(runId, {
          run_state: RUN_STATE.ERROR_SOURCE,
          status: 'error',
          error: 'All sources failed',
          explain: { sources: sourceErrors },
          log: log.join('\n')
        });
        return {
          run_state: RUN_STATE.ERROR_SOURCE,
          status: 'error',
          runId,
          error: 'All sources failed',
          sourceErrors,
          log
        };
      }
      
      // v59.0 - Build merged view for multi-source conditions
      const allMergedItems = [];
      for (const [sid, s] of Object.entries(context.sources)) {
        if (s.status === 'ok' && Array.isArray(s.data)) {
          allMergedItems.push(...s.data.map(item => ({ ...item, _source: sid })));
        }
      }
      if (allMergedItems.length > 0) {
        context.sources._merged = {
          status: 'ok',
          data: allMergedItems,
          raw_count: allMergedItems.length,
          filtered_count: allMergedItems.length,
        };
      }

      // ══════════════════════════════════════════════════════════════════════
      // STEP 2: Check for HUNTER pattern - no new items
      // ══════════════════════════════════════════════════════════════════════
      const collectionSources = Object.entries(context.sources)
        .filter(([sid, source]) => sid !== '_merged' && source.status === 'ok' && Array.isArray(source.data));
      const totalNewItems = collectionSources
        .reduce((sum, [, s]) => sum + (s.filtered_count || 0), 0);
      
      if (collectionSources.length > 0 && totalNewItems === 0 && !isFirstRun) {
        log.push(`[${this.timestamp()}] 📭 No new items found - waiting for changes`);
        
        // Still update last_run
        const newState = { ...context.state, _last_run: now.toISOString() };
        this.repo.updateAgentState(agentId, newState);
        
        this.repo.completeRun(runId, {
          run_state: RUN_STATE.SUCCESS_NO_NEW,
          status: 'success',
          triggers_fired: [],
          actions_executed: 0,
          log: log.join('\n')
        });
        
        return {
          run_state: RUN_STATE.SUCCESS_NO_NEW,
          status: 'success',
          runId,
          duration: Date.now() - now.getTime(),
          triggered: [],
          actions: [],
          log
        };
      }
      
      // First run - establishing baseline
      if (isFirstRun) {
        log.push(`[${this.timestamp()}] 🏁 First run - establishing baseline with ${totalNewItems} items`);
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 3: Evaluate conditions (DETERMINISTIC)
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Evaluating ${def.conditions?.length || 0} conditions...`);
      
      const conditionResults = this.conditions.evaluateAll(
        def.conditions || [],
        context
      );
      
      // Track schema status
      let schemaStatus = 'valid';
      let schemaError = null;
      let runState = null; // Will be determined later
      
      // Check for invalid conditions (schema problems)
      let invalidCount = 0;
      for (const d of conditionResults.details) {
        if (d.status === 'invalid') {
          invalidCount++;
          log.push(`  ⛔ ${d.id}: INVALID - ${d.reason}`);
          context._schemaValidation.errors.push({
            condition: d.id,
            error: d.reason,
            fieldStatus: d.fieldStatus
          });
        } else {
          log.push(`  ${d.passed ? '✓' : '○'} ${d.id}: ${d.reason}`);
        }
      }
      
      // If too many conditions are invalid, mark schema as degraded
      const totalConditions = def.conditions?.length || 0;
      if (totalConditions > 0 && invalidCount > 0) {
        const invalidRatio = invalidCount / totalConditions;
        
        if (invalidRatio >= 0.5) {
          // 50%+ conditions invalid = BROKEN
          log.push(`[${this.timestamp()}] ⛔ Schema BROKEN: ${invalidCount}/${totalConditions} conditions invalid`);
          schemaStatus = 'broken';
          schemaError = `${invalidCount}/${totalConditions} conditions are invalid`;
          runState = RUN_STATE.SCHEMA_BROKEN;
          
          // Auto-disable agent
          this.repo.updateAgent(agentId, { enabled: false });
          log.push(`[${this.timestamp()}] ⛔ Agent automatically DISABLED due to broken schema`);
          
        } else if (invalidRatio > 0) {
          // Some conditions invalid = DEGRADED
          log.push(`[${this.timestamp()}] ⚠️ Schema DEGRADED: ${invalidCount}/${totalConditions} conditions invalid`);
          schemaStatus = 'degraded';
          schemaError = `${invalidCount}/${totalConditions} conditions are invalid`;
          runState = RUN_STATE.SCHEMA_DEGRADED;
        }
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 4: Detect trigger edges
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Evaluating ${def.triggers?.length || 0} triggers...`);
      
      const triggerResults = this.triggers.evaluateAll(
        def.triggers || [],
        conditionResults.results,
        context.state,
        now
      );
      
      for (const d of triggerResults.details) {
        log.push(`  ${d.fired ? '🔔' : '○'} ${d.id}: ${d.reason}`);
      }
      
      // Update state with trigger tracking AND schema status
      const newState = { 
        ...triggerResults.newState, 
        schemaStatus,
        ...(schemaError && { schemaError })
      };
      for (const condition of def.conditions || []) {
        if (condition.type !== 'changed') continue;
        const stateKey = condition.compare_field
          || `_prev_${condition.field.replace(/\./g, '_')}`;
        newState[stateKey] = structuredClone(this.conditions.getField(condition.field, context));
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // v57.0 STEP 5a: Execute mark_seen FIRST (before business actions)
      // This ensures crash recovery doesn't cause duplicate processing
      // ══════════════════════════════════════════════════════════════════════
      const executedActions = [];
      let actionError = false;

      // Separate mark_seen actions from business actions
      const markSeenActions = (def.actions || []).filter(a => a.type === 'mark_seen');
      const businessActions = (def.actions || []).filter(a => a.type !== 'mark_seen');

      // v57.0 - Auto-generate mark_seen if HUNTER pattern detected and no explicit mark_seen
      if (markSeenActions.length === 0 && totalNewItems > 0) {
        // Auto-mark all sources with new items
        for (const [sourceId, sourceData] of Object.entries(context.sources)) {
          if (sourceId === '_merged') continue;
          if (sourceData.status === 'ok' && sourceData.filtered_count > 0) {
            log.push(`[${this.timestamp()}] Auto mark_seen for source: ${sourceId}`);
            try {
              const result = await this.executeMarkSeen(
                { type: 'mark_seen', config: { source: sourceId } },
                context,
                agentId
              );
              executedActions.push({ type: 'mark_seen', source: sourceId, status: 'ok', ...result });
              log.push(`  ✓ mark_seen (${sourceId}): ${result.marked} marked`);
            } catch (err) {
              log.push(`  ✗ mark_seen (${sourceId}): ${err.message}`);
              // Don't set actionError for mark_seen - it's not a business action
            }
          }
        }
      } else {
        // Execute explicit mark_seen actions
        for (const action of markSeenActions) {
          try {
            const result = await this.executeMarkSeen(action, context, agentId);
            executedActions.push({ type: 'mark_seen', source: action.config?.source, status: 'ok', ...result });
            log.push(`  ✓ mark_seen: ${result.marked} marked`);
          } catch (err) {
            log.push(`  ✗ mark_seen: ${err.message}`);
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // v57.0 STEP 5b: Execute business actions (notify, webhook, etc.)
      // - State is persisted AFTER EACH ACTION for crash recovery
      // - Retryable actions (notify, webhook) get exponential backoff retry
      // - Non-retryable actions (update_state, log) fail immediately
      // ══════════════════════════════════════════════════════════════════════
      if (triggerResults.fired.length > 0 || businessActions.some(a => a.trigger_id === null)) {
        log.push(`[${this.timestamp()}] Executing ${businessActions.length} business actions...`);

        for (const action of businessActions) {
          // Check if action should run
          if (action.trigger_id !== null && !triggerResults.fired.includes(action.trigger_id)) {
            continue;
          }

          // v57.0 - Execute with retry for retryable action types
          const isRetryable = RETRY_CONFIG.retryableTypes.includes(action.type);
          const result = await this.executeActionWithRetry(
            action, context, agentId, runId, triggerResults, isRetryable, log
          );

          executedActions.push(result);

          if (result.status === 'ok') {
            log.push(`  ✓ ${action.type}: OK${result.attempts > 1 ? ` (after ${result.attempts} attempts)` : ''}`);
            newState._last_action = { type: action.type, at: new Date().toISOString() };
          } else {
            log.push(`  ✗ ${action.type}: ${result.error}${result.attempts > 1 ? ` (failed after ${result.attempts} attempts)` : ''}`);
            actionError = true;
            newState._last_action = { type: action.type, at: new Date().toISOString(), error: result.error };
          }

          // v57.0 - Persist state after each action (success or failure)
          this.repo.updateAgentState(agentId, newState);
        }
      } else {
        log.push(`[${this.timestamp()}] No triggers fired, skipping business actions`);
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 6: Determine final run_state
      // ══════════════════════════════════════════════════════════════════════
      if (!runState) {
        // If schema wasn't broken/degraded, determine based on run result
        if (isFirstRun) {
          runState = RUN_STATE.INIT_BASELINE;
        } else if (actionError) {
          runState = RUN_STATE.ERROR_EXECUTION;
        } else if (triggerResults.fired.length > 0) {
          runState = RUN_STATE.SUCCESS_TRIGGERED;
        } else {
          runState = RUN_STATE.SUCCESS_NO_TRIGGER;
        }
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 7: Update state and complete run
      // ══════════════════════════════════════════════════════════════════════
      newState._last_run = now.toISOString();
      this.repo.updateAgentState(agentId, newState);
      
      const duration = Date.now() - now.getTime();
      log.push(`[${this.timestamp()}] Completed in ${duration}ms (state: ${runState})`);
      
      // Create explain record
      const explainRecord = {
        run_id: runId,
        timestamp: now.toISOString(),
        run_state: runState,
        is_manual: options.isManual || false,
        is_first_run: isFirstRun,
        sources: Object.keys(context.sources).map(id => {
          const source = context.sources[id];
          return {
            id,
            status: source.status,
            count: source.filtered_count,
            ...(source.data?.snapshot_digest ? {
              evidence: {
                projectId: source.data.project_id,
                workspaceRevision: source.data.workspace_revision,
                snapshotDigest: source.data.snapshot_digest,
                issueCount: source.data.issue_count,
                filesObserved: source.data.files_observed,
                truncated: source.data.truncated,
                provenance: source.data.provenance,
              },
            } : {}),
          };
        }),
        conditions: conditionResults.details,
        triggers: triggerResults.details.filter(t => t.fired),
        actions: executedActions
      };
      
      this.repo.completeRun(runId, {
        run_state: runState,
        status: actionError ? 'partial' : 'success',
        triggers_fired: triggerResults.fired,
        actions_executed: executedActions.length,
        explain: explainRecord,
        log: log.join('\n')
      });
      
      return {
        run_state: runState,
        status: actionError ? 'partial' : 'success',
        runId,
        duration,
        triggered: triggerResults.fired,
        actions: executedActions,
        explain: explainRecord,
        log
      };
      
    } catch (err) {
      // Unexpected error
      log.push(`[${this.timestamp()}] ❌ Unexpected error: ${err.message}`);
      
      this.repo.completeRun(runId, {
        run_state: RUN_STATE.ERROR_UNKNOWN,
        status: 'error',
        error: err.message,
        log: log.join('\n')
      });
      
      return {
        run_state: RUN_STATE.ERROR_UNKNOWN,
        status: 'error',
        runId,
        error: err.message,
        log
      };
    }
  }
  
  /**
   * Check if cooldown period has elapsed
   */
  checkCooldown(agent) {
    const schedule = agent.definition?.schedule;
    if (!schedule) return true; // No schedule = always run
    
    const lastRun = agent.state?._last_run;
    if (!lastRun) return true; // Never run = run now
    
    const lastRunTime = new Date(lastRun).getTime();
    const now = Date.now();
    
    // Calculate minimum interval based on schedule type
    let minInterval;
    switch (schedule.type) {
      case 'interval':
        minInterval = this.parseInterval(schedule.interval);
        break;
      case 'cron':
        // For cron, defer to scheduler
        return true;
      default:
        return true;
    }
    
    return (now - lastRunTime) >= minInterval;
  }
  
  /**
   * Calculate next scheduled run time
   */
  calculateNextRun(agent) {
    const schedule = agent.definition?.schedule;
    if (!schedule) return null;
    
    const lastRun = agent.state?._last_run;
    if (!lastRun) return new Date().toISOString();
    
    const lastRunTime = new Date(lastRun).getTime();
    const interval = this.parseInterval(schedule.interval);
    
    return new Date(lastRunTime + interval).toISOString();
  }
  
  /**
   * Parse interval string to milliseconds
   */
  parseInterval(interval) {
    if (!interval) return 60000; // Default 1 minute
    
    const match = interval.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 60000;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60000;
    }
  }
  
  /**
   * v57.0 - Filter out items that have already been seen (for HUNTER pattern)
   * Uses repository for DB-backed seen tracking instead of in-memory state.
   *
   * NOTE: This only FILTERS - it does NOT mark items as seen.
   * Marking happens via explicit mark_seen action AFTER trigger detection.
   */
  filterSeenItems(data, sourceId, agentId) {
    if (!Array.isArray(data)) return data;

    // v57.0 - Use repository to get seen items from DB
    const seenIds = this.repo.getSeenItemIds(agentId, sourceId);

    // Filter out seen items
    const newItems = data.filter(item => {
      const itemId = this.getItemId(item);
      return !seenIds.has(itemId);
    });

    return newItems;
  }
  
  /**
   * Get unique ID for an item
   */
  getItemId(item) {
    // Try common ID fields
    return item.id || item._id || item.url || item.link || JSON.stringify(item);
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // SOURCE HANDLERS
  // ══════════════════════════════════════════════════════════════════════════════
  
  async fetchHttp(config, context) {
    const url = this.interpolate(config.url, context);
    const response = await fetch(url, {
      method: config.method || 'GET',
      headers: config.headers || {},
      ...(config.body && { body: JSON.stringify(config.body) })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }
  
  async fetchScraper(config, context) {
    // Placeholder - would use Puppeteer or similar
    const url = this.interpolate(config.url, context);
    this.logger.warn(`Scraper not implemented, falling back to HTTP for: ${url}`);
    return this.fetchHttp({ url }, context);
  }
  
  async fetchRss(config, context) {
    const { RSSSource } = await import('./sources/rss.js');
    const source = new RSSSource({
      url: this.interpolate(config.url, context),
      maxItems: config.maxItems || 20,
      filterKeywords: config.filterKeywords,
    });
    const { items } = await source.fetch();
    return items;
  }

  async fetchDatabase(config, context) {
    // Placeholder for database queries
    this.logger.warn('Database source not implemented');
    return [];
  }

  async fetchProjectContext(config, context) {
    const execution = context.execution || {};
    const capability = execution.extensionContext?.requireCapability(
      EXTENSION_HOST_CAPABILITY.PROJECT_CONTEXT,
    );
    const invocation = await this.projectContextBridge.host.openInvocation({
      extensionId: execution.extensionId,
      agentId: execution.agentId,
      runId: execution.runId,
      projectId: Number(config.project_id),
    });
    try {
      return await fetchProjectHealthSource({ config, invocation, capability });
    } finally {
      this.projectContextBridge.host.closeInvocation(invocation);
    }
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // ACTION HANDLERS
  // ══════════════════════════════════════════════════════════════════════════════
  
  async executeAction(action, context, agentId, runId, triggerResults) {
    switch (action.type) {
      case 'notify':
        return this.executeNotify(action, context, agentId, runId, triggerResults);
      case 'webhook':
        return this.executeWebhook(action, context);
      case 'update_state':
        return this.executeUpdateState(action, context, agentId);
      case 'log':
        return this.executeLog(action, context);
      case 'mark_seen':
        // v57.0 - Transactional mark_seen action
        return this.executeMarkSeen(action, context, agentId);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * v57.0 - Execute action with retry and exponential backoff
   *
   * CONTRACT:
   * - Only retries for retryable action types (notify, webhook)
   * - NEVER retries mark_seen (it's transactional, not a business action)
   * - NEVER restores triggers (retry is action-level only)
   * - Exponential backoff: 500ms, 1000ms, 2000ms
   * - Returns result object with status, attempts, and error info
   *
   * @param {Object} action - Action to execute
   * @param {Object} context - Execution context
   * @param {string} agentId
   * @param {number} runId
   * @param {Object} triggerResults
   * @param {boolean} isRetryable - Whether this action type supports retry
   * @param {string[]} log - Log array for recording attempts
   * @returns {Promise<{type: string, trigger: string, status: string, attempts: number, error?: string}>}
   */
  async executeActionWithRetry(action, context, agentId, runId, triggerResults, isRetryable, log) {
    const result = {
      type: action.type,
      trigger: action.trigger_id,
      status: 'ok',
      attempts: 0
    };

    const maxAttempts = isRetryable ? RETRY_CONFIG.maxAttempts : 1;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result.attempts = attempt;

      try {
        await this.executeAction(action, context, agentId, runId, triggerResults);
        result.status = 'ok';
        return result;

      } catch (err) {
        lastError = err;

        // If not retryable or last attempt, fail immediately
        if (!isRetryable || attempt >= maxAttempts) {
          result.status = 'error';
          result.error = err.message;
          return result;
        }

        // Calculate backoff delay
        const delayMs = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1);
        log.push(`  ⟳ ${action.type}: attempt ${attempt} failed (${err.message}), retrying in ${delayMs}ms...`);

        // Wait before retry
        await sleep(delayMs);
      }
    }

    // Should not reach here, but safety net
    result.status = 'error';
    result.error = lastError?.message || 'Unknown error';
    return result;
  }

  /**
   * v57.0 - Execute mark_seen action (transactional, idempotent)
   *
   * CONTRACT:
   * - Persists immediately to DB
   * - Idempotent (safe to call multiple times)
   * - Does NOT send notifications
   * - Runs BEFORE business actions
   *
   * DSL format:
   *   actions:
   *     - type: mark_seen
   *       config:
   *         source: source_id
   *         items: "{{ sources.source_id.data }}" or explicit array
   */
  async executeMarkSeen(action, context, agentId) {
    const config = action.config || {};
    const sourceId = config.source;

    if (!sourceId) {
      throw new Error('mark_seen requires source config');
    }

    // Get items to mark - either from config or from source data
    let items;
    if (config.items) {
      items = this.interpolate(config.items, context);
      if (typeof items === 'string') {
        // Try to parse as JSON array
        try {
          items = JSON.parse(items);
        } catch {
          items = [items]; // Single item
        }
      }
    } else {
      // Default: use all items from the source
      const sourceData = context.sources[sourceId];
      if (!sourceData || sourceData.status !== 'ok') {
        this.logger.warn(`mark_seen: source ${sourceId} not available`);
        return { marked: 0, skipped: 0 };
      }
      items = sourceData.data;
    }

    if (!Array.isArray(items)) {
      items = items ? [items] : [];
    }

    // Extract item IDs
    const itemsToMark = items.map(item => ({
      id: this.getItemId(item),
      hash: typeof item === 'object' ? this.hashItem(item) : null
    }));

    // Mark in DB (transactional)
    const result = this.repo.markItemsSeenBatch(agentId, sourceId, itemsToMark);

    this.logger.info(`mark_seen: ${result.newlyMarked.length} new, ${result.alreadySeen.length} already seen`);

    return {
      marked: result.newlyMarked.length,
      skipped: result.alreadySeen.length,
      newlyMarked: result.newlyMarked
    };
  }

  /**
   * v57.0 - Create a simple hash for item deduplication
   */
  hashItem(item) {
    if (!item || typeof item !== 'object') return null;
    try {
      // Simple hash: stringify and use first 32 chars
      const str = JSON.stringify(item);
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return hash.toString(16);
    } catch {
      return null;
    }
  }
  
  async executeNotify(action, context, agentId, runId, triggerResults) {
    const config = action.config || {};

    // Build notification content
    let content;
    if (config.use_llm && this.llm) {
      content = await this.llm.generate({
        prompt: this.interpolate(config.llm_prompt, context),
        context: {
          triggers: triggerResults.fired,
          sources: context.sources
        }
      });
    } else {
      content = this.interpolate(config.message || config.template, context);
    }

    const title = this.interpolate(config.title || '', context);
    const priority = config.priority || 'normal';
    const notificationData = config.data ? this.interpolateObject(config.data, context) : null;

    // Store notification in DB (always, regardless of channel)
    this.repo.createNotification(agentId, runId, {
      priority,
      title,
      body: content,
      data: notificationData,
    });

    // Build notification context (plain object, not a class)
    const notifCtx = {
      agent_id: agentId,
      channel: config.channel || 'in_app',
      recipient: config.recipient || '',
      title,
      body: content,
      priority,
      created_at: Date.now(),
      reason: {
        trigger: triggerResults.fired?.[0] || null,
        condition: null,
        source_id: Object.keys(context.sources || {})[0] || null,
        source_type: null,
      },
      data: notificationData,
    };

    // Deliver through pipeline (policy → escalation → immediate/digest/drop)
    if (this.notificationPipeline && config.channel && config.channel !== 'in_app') {
      // Get per-agent policy config from agent definition
      const agent = this.repo.getAgent(agentId);
      const policyConfig = agent?.definition?.notification_policy || null;

      const result = await this.notificationPipeline.process(notifCtx, policyConfig);
      this.logger.info('AgentRunner',
        `Event → pipeline: ${result.decision} (${result.reason})`, { agentId }
      );

    // Fallback: direct router send (if pipeline not available but router is)
    } else if (this.notificationRouter && config.channel && config.channel !== 'in_app') {
      const delivery = await this.notificationRouter.send({
        channel: config.channel,
        recipient: config.recipient,
        title,
        body: content,
        priority,
        agentId,
        data: notificationData,
      });
      if (!delivery.delivered) {
        this.logger.warn('AgentRunner', `Notification delivery failed: ${delivery.error}`, { agentId });
      }
    }

    this.logger.info('AgentRunner', `Notification processed: ${(content || '').substring(0, 100)}...`);
  }
  
  async executeWebhook(action, context) {
    const config = action.config || {};
    const url = this.interpolate(config.url, context);
    const body = this.interpolateObject(config.body || {}, context);
    
    const response = await fetch(url, {
      method: config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {})
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }
  }
  
  async executeUpdateState(action, context, agentId) {
    const updates = this.interpolateObject(action.config?.updates || {}, context);
    this.repo.updateAgentState(agentId, updates);
  }
  
  async executeLog(action, context) {
    const message = this.interpolate(action.config?.message || '', context);
    this.logger.info(`[Agent Log] ${message}`);
  }
  
  // ══════════════════════════════════════════════════════════════════════════════
  // INTERPOLATION
  // ══════════════════════════════════════════════════════════════════════════════
  
  interpolate(template, context) {
    if (typeof template !== 'string') return template;
    
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const value = this.getNestedValue(context, path.trim());
      if (value === undefined) return match;
      if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    });
  }
  
  interpolateObject(obj, context) {
    if (typeof obj === 'string') {
      return this.interpolate(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateObject(item, context));
    }
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateObject(value, context);
      }
      return result;
    }
    return obj;
  }
  
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }
  
  timestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
}
