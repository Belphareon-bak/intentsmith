// C.3 v33 Agent Runner - Execution Engine
// ══════════════════════════════════════════════════════════════════════════════
// Runner je čistě deterministický:
// 1. Fetch data
// 2. Evaluate conditions
// 3. Detect trigger edges
// 4. Dispatch actions
//
// LLM je volán POUZE z akcí (notify s use_llm: true), nikdy z runneru

import { ConditionEvaluator } from './conditions.js';
import { TriggerEvaluator } from './triggers.js';

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
  constructor({ repository, llmServices = null, logger = console }) {
    this.repo = repository;
    this.llm = llmServices;
    this.logger = logger;
    this.conditions = new ConditionEvaluator();
    this.triggers = new TriggerEvaluator();
    
    // Source handlers
    this.sourceHandlers = {
      http: this.fetchHttp.bind(this),
      scraper: this.fetchScraper.bind(this),
      rss: this.fetchRss.bind(this),
      database: this.fetchDatabase.bind(this)
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
    const validTypes = ['notify', 'webhook', 'update_state', 'log'];
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
        _schemaValidation: { errors: [], warnings: [] }
      };
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 1: Fetch sources (parallel)
      // ══════════════════════════════════════════════════════════════════════
      log.push(`[${this.timestamp()}] Fetching ${def.sources.length} sources...`);
      
      let sourceFailed = false;
      const sourcePromises = def.sources.map(async (source) => {
        try {
          const handler = this.sourceHandlers[source.type];
          if (!handler) throw new Error(`Unknown source type: ${source.type}`);
          
          const config = this.interpolate(source.config, context);
          const data = await handler(config, context);
          
          // Filter seen items for HUNTER pattern
          const filteredData = this.filterSeenItems(data, source.id, context.state);
          
          context.sources[source.id] = { 
            status: 'ok', 
            data: filteredData,
            raw_count: Array.isArray(data) ? data.length : null,
            filtered_count: Array.isArray(filteredData) ? filteredData.length : null
          };
          log.push(`  ✓ ${source.id}: OK (${context.sources[source.id].filtered_count} items)`);
        } catch (err) {
          context.sources[source.id] = { status: 'error', error: err.message };
          log.push(`  ✗ ${source.id}: ${err.message}`);
          sourceFailed = true;
        }
      });
      await Promise.all(sourcePromises);
      
      // Check if all sources failed
      if (sourceFailed && Object.values(context.sources).every(s => s.status === 'error')) {
        log.push(`[${this.timestamp()}] ⛔ All sources failed`);
        this.repo.completeRun(runId, {
          run_state: RUN_STATE.ERROR_SOURCE,
          status: 'error',
          error: 'All sources failed',
          log: log.join('\n')
        });
        return {
          run_state: RUN_STATE.ERROR_SOURCE,
          status: 'error',
          runId,
          error: 'All sources failed',
          log
        };
      }
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 2: Check for HUNTER pattern - no new items
      // ══════════════════════════════════════════════════════════════════════
      const totalNewItems = Object.values(context.sources)
        .filter(s => s.status === 'ok')
        .reduce((sum, s) => sum + (s.filtered_count || 0), 0);
      
      if (totalNewItems === 0 && !isFirstRun) {
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
      
      // ══════════════════════════════════════════════════════════════════════
      // STEP 5: Execute actions
      // ══════════════════════════════════════════════════════════════════════
      const executedActions = [];
      let actionError = false;
      
      if (triggerResults.fired.length > 0 || def.actions?.some(a => a.trigger_id === null)) {
        log.push(`[${this.timestamp()}] Executing actions...`);
        
        for (const action of def.actions || []) {
          // Check if action should run
          if (action.trigger_id !== null && !triggerResults.fired.includes(action.trigger_id)) {
            continue;
          }
          
          try {
            await this.executeAction(action, context, agentId, runId, triggerResults);
            executedActions.push({ type: action.type, trigger: action.trigger_id, status: 'ok' });
            log.push(`  ✓ ${action.type}: OK`);
          } catch (err) {
            executedActions.push({ type: action.type, trigger: action.trigger_id, status: 'error', error: err.message });
            log.push(`  ✗ ${action.type}: ${err.message}`);
            actionError = true;
          }
        }
      } else {
        log.push(`[${this.timestamp()}] No triggers fired, skipping actions`);
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
        sources: Object.keys(context.sources).map(id => ({
          id,
          status: context.sources[id].status,
          count: context.sources[id].filtered_count
        })),
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
   * Filter out items that have already been seen (for HUNTER pattern)
   */
  filterSeenItems(data, sourceId, state) {
    if (!Array.isArray(data)) return data;
    
    const seenKey = `_seen_${sourceId}`;
    const seenIds = new Set(state[seenKey] || []);
    
    // Filter out seen items
    const newItems = data.filter(item => {
      const itemId = this.getItemId(item);
      return !seenIds.has(itemId);
    });
    
    // Update seen list (will be saved in state)
    const newSeenIds = data.map(item => this.getItemId(item));
    state[seenKey] = [...new Set([...seenIds, ...newSeenIds])].slice(-1000); // Keep last 1000
    
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
    const url = this.interpolate(config.url, context);
    const response = await fetch(url);
    const text = await response.text();
    // Basic RSS parsing - would use proper parser in production
    return this.parseRss(text);
  }
  
  async fetchDatabase(config, context) {
    // Placeholder for database queries
    this.logger.warn('Database source not implemented');
    return [];
  }
  
  parseRss(xml) {
    // Very basic RSS parsing
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      items.push({
        title: this.extractTag(itemXml, 'title'),
        link: this.extractTag(itemXml, 'link'),
        description: this.extractTag(itemXml, 'description'),
        pubDate: this.extractTag(itemXml, 'pubDate')
      });
    }
    
    return items;
  }
  
  extractTag(xml, tag) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return match ? match[1].trim() : null;
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
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
  
  async executeNotify(action, context, agentId, runId, triggerResults) {
    const config = action.config || {};
    
    // Build notification content
    let content;
    if (config.use_llm && this.llm) {
      // Use LLM to generate message
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
    
    // Store notification
    this.repo.createNotification(agentId, {
      run_id: runId,
      channel: config.channel || 'default',
      priority: config.priority || 'normal',
      title: this.interpolate(config.title || '', context),
      content,
      data: config.data
    });
    
    // Send through configured channels (in-app, email, telegram, etc.)
    // This would be handled by notification service
    this.logger.info(`Notification created: ${content.substring(0, 100)}...`);
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
      return value !== undefined ? String(value) : match;
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
