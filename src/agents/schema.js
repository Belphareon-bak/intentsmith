// C.3 v33 Agent Schema Validator
// ══════════════════════════════════════════════════════════════════════════════
// Validuje agent definitions podle DSL schema
// Builder smí generovat POUZE validní struktury

// ════════════════════════════════════════════════════════════════════════════
// POVOLENÉ HODNOTY (whitelist)
// ════════════════════════════════════════════════════════════════════════════

export const ALLOWED = {
  schedule_types: ['cron', 'interval', 'manual'],
  intervals: ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '7d'],
  
  source_types: ['http', 'scraper', 'rss', 'database'],
  http_methods: ['GET', 'POST'],
  database_tables: ['user_inventory', 'agent_data'],
  
  condition_types: ['compare', 'date_diff', 'contains', 'exists', 'in_range', 'changed', 'new_items'],
  operators: ['<', '>', '<=', '>=', '==', '!='],
  date_units: ['days', 'hours', 'minutes'],
  array_modes: ['any', 'all', 'none', 'count', 'min', 'max', 'avg', 'sum'],
  
  trigger_edges: ['rising', 'falling', 'any'],
  
  action_types: ['notify', 'store', 'webhook', 'mark_seen'],
  priorities: ['low', 'normal', 'high'],
  
  param_types: ['string', 'number', 'boolean', 'date', 'location', 'select', 'multiselect']
};

export const LIMITS = {
  max_sources: 5,
  max_conditions: 10,
  max_triggers: 10,
  max_actions: 10,
  max_params: 20,
  
  min_cooldown: 60,
  max_cooldown: 604800,
  default_cooldown: 300,
  
  min_timeout: 5000,
  max_timeout: 60000,
  default_timeout: 30000,
  
  max_fires_per_day: 100,
  default_max_fires: 10
};

export const DEFAULTS = {
  cooldown: 300,
  max_fires_per_day: 10,
  priority: 'normal',
  timeout: 30000,
  array_mode: 'any'
};

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate complete agent definition
 * @param {object} def - Agent definition
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateAgentDefinition(def) {
  const errors = [];
  const warnings = [];
  
  // Required top-level fields
  if (!def.id || typeof def.id !== 'string') {
    errors.push('Missing or invalid: id');
  } else if (!/^[a-z0-9_-]+$/.test(def.id) || def.id.length > 64) {
    errors.push('Invalid id format (must be lowercase alphanumeric with hyphens/underscores, max 64 chars)');
  }
  
  if (!def.name || typeof def.name !== 'string') {
    errors.push('Missing or invalid: name');
  } else if (def.name.length > 128) {
    errors.push('Name too long (max 128 chars)');
  }
  
  if (def.description && def.description.length > 500) {
    errors.push('Description too long (max 500 chars)');
  }
  
  // Schedule
  if (!def.schedule) {
    errors.push('Missing: schedule');
  } else {
    const schedErrs = validateSchedule(def.schedule);
    errors.push(...schedErrs);
  }
  
  // Sources
  if (!def.sources || !Array.isArray(def.sources) || def.sources.length === 0) {
    errors.push('Missing or empty: sources (at least 1 required)');
  } else if (def.sources.length > LIMITS.max_sources) {
    errors.push(`Too many sources (max ${LIMITS.max_sources})`);
  } else {
    const sourceIds = new Set();
    def.sources.forEach((src, i) => {
      if (sourceIds.has(src.id)) {
        errors.push(`Duplicate source id: ${src.id}`);
      }
      sourceIds.add(src.id);
      const srcErrs = validateSource(src, i);
      errors.push(...srcErrs);
    });
  }
  
  // Conditions (optional but validated if present)
  const conditionIds = new Set();
  if (def.conditions) {
    if (!Array.isArray(def.conditions)) {
      errors.push('conditions must be an array');
    } else if (def.conditions.length > LIMITS.max_conditions) {
      errors.push(`Too many conditions (max ${LIMITS.max_conditions})`);
    } else {
      def.conditions.forEach((cond, i) => {
        if (conditionIds.has(cond.id)) {
          errors.push(`Duplicate condition id: ${cond.id}`);
        }
        conditionIds.add(cond.id);
        const condErrs = validateCondition(cond, i);
        errors.push(...condErrs);
      });
    }
  }
  
  // Triggers
  const triggerIds = new Set();
  if (def.triggers) {
    if (!Array.isArray(def.triggers)) {
      errors.push('triggers must be an array');
    } else if (def.triggers.length > LIMITS.max_triggers) {
      errors.push(`Too many triggers (max ${LIMITS.max_triggers})`);
    } else {
      def.triggers.forEach((trig, i) => {
        if (triggerIds.has(trig.id)) {
          errors.push(`Duplicate trigger id: ${trig.id}`);
        }
        triggerIds.add(trig.id);
        const trigErrs = validateTrigger(trig, i, conditionIds);
        errors.push(...trigErrs);
      });
    }
  }
  
  // Actions
  if (def.actions) {
    if (!Array.isArray(def.actions)) {
      errors.push('actions must be an array');
    } else if (def.actions.length > LIMITS.max_actions) {
      errors.push(`Too many actions (max ${LIMITS.max_actions})`);
    } else {
      def.actions.forEach((act, i) => {
        const actErrs = validateAction(act, i, triggerIds);
        errors.push(...actErrs);
      });
    }
  }
  
  // Params
  if (def.params) {
    if (!Array.isArray(def.params)) {
      errors.push('params must be an array');
    } else if (def.params.length > LIMITS.max_params) {
      errors.push(`Too many params (max ${LIMITS.max_params})`);
    } else {
      const paramNames = new Set();
      def.params.forEach((param, i) => {
        if (paramNames.has(param.name)) {
          errors.push(`Duplicate param name: ${param.name}`);
        }
        paramNames.add(param.name);
        const paramErrs = validateParam(param, i);
        errors.push(...paramErrs);
      });
    }
  }
  
  // Warnings (non-blocking)
  if (!def.triggers || def.triggers.length === 0) {
    warnings.push('No triggers defined - agent will never fire actions');
  }
  if (!def.actions || def.actions.length === 0) {
    warnings.push('No actions defined - agent will not do anything when triggered');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validateSchedule(sched) {
  const errors = [];
  
  if (!sched.type || !ALLOWED.schedule_types.includes(sched.type)) {
    errors.push(`Invalid schedule type: ${sched.type} (allowed: ${ALLOWED.schedule_types.join(', ')})`);
    return errors;
  }
  
  if (sched.type === 'interval') {
    if (!sched.value || !ALLOWED.intervals.includes(sched.value)) {
      errors.push(`Invalid interval: ${sched.value} (allowed: ${ALLOWED.intervals.join(', ')})`);
    }
  }
  
  if (sched.type === 'cron') {
    if (!sched.value || typeof sched.value !== 'string') {
      errors.push('Cron schedule requires value');
    } else {
      const parts = sched.value.trim().split(/\s+/);
      if (parts.length !== 5) {
        errors.push('Invalid cron format (must be 5 parts: min hour day month weekday)');
      }
    }
  }
  
  return errors;
}

function validateSource(src, index) {
  const errors = [];
  const prefix = `sources[${index}]`;
  
  if (!src.id || typeof src.id !== 'string') {
    errors.push(`${prefix}: missing id`);
  }
  
  if (!src.type || !ALLOWED.source_types.includes(src.type)) {
    errors.push(`${prefix}: invalid type "${src.type}" (allowed: ${ALLOWED.source_types.join(', ')})`);
    return errors;
  }
  
  if (!src.config) {
    errors.push(`${prefix}: missing config`);
    return errors;
  }
  
  switch (src.type) {
    case 'http':
      if (!src.config.url) {
        errors.push(`${prefix}: http source requires url`);
      } else if (!src.config.url.startsWith('https://') && !src.config.url.includes('{{')) {
        errors.push(`${prefix}: http url must be HTTPS`);
      }
      if (src.config.method && !ALLOWED.http_methods.includes(src.config.method)) {
        errors.push(`${prefix}: invalid method "${src.config.method}"`);
      }
      break;
      
    case 'scraper':
      if (!src.config.url) {
        errors.push(`${prefix}: scraper source requires url`);
      }
      break;
      
    case 'rss':
      if (!src.config.url) {
        errors.push(`${prefix}: rss source requires url`);
      }
      if (src.config.limit && (src.config.limit < 1 || src.config.limit > 100)) {
        errors.push(`${prefix}: rss limit must be 1-100`);
      }
      break;
      
    case 'database':
      if (!src.config.table || !ALLOWED.database_tables.includes(src.config.table)) {
        errors.push(`${prefix}: invalid table "${src.config.table}" (allowed: ${ALLOWED.database_tables.join(', ')})`);
      }
      break;
  }
  
  return errors;
}

function validateCondition(cond, index) {
  const errors = [];
  const prefix = `conditions[${index}]`;
  
  if (!cond.id || typeof cond.id !== 'string') {
    errors.push(`${prefix}: missing id`);
  }
  
  if (!cond.type || !ALLOWED.condition_types.includes(cond.type)) {
    errors.push(`${prefix}: invalid type "${cond.type}" (allowed: ${ALLOWED.condition_types.join(', ')})`);
    return errors;
  }
  
  if (!cond.field || typeof cond.field !== 'string') {
    errors.push(`${prefix}: missing field`);
  } else if (!isValidFieldPath(cond.field)) {
    errors.push(`${prefix}: invalid field path "${cond.field}" (must start with sources., state., or params.)`);
  }
  
  switch (cond.type) {
    case 'compare':
    case 'in_range':
      if (cond.operator && !ALLOWED.operators.includes(cond.operator)) {
        errors.push(`${prefix}: invalid operator "${cond.operator}"`);
      }
      break;
      
    case 'date_diff':
      if (!cond.operator || !ALLOWED.operators.includes(cond.operator)) {
        errors.push(`${prefix}: date_diff requires operator`);
      }
      if (cond.unit && !ALLOWED.date_units.includes(cond.unit)) {
        errors.push(`${prefix}: invalid unit "${cond.unit}"`);
      }
      break;
      
    case 'contains':
      if (cond.value === undefined) {
        errors.push(`${prefix}: contains requires value`);
      }
      break;
      
    case 'exists':
      // field is enough
      break;
  }
  
  if (cond.array_mode && !ALLOWED.array_modes.includes(cond.array_mode)) {
    errors.push(`${prefix}: invalid array_mode "${cond.array_mode}"`);
  }
  
  return errors;
}

function validateTrigger(trig, index, conditionIds) {
  const errors = [];
  const prefix = `triggers[${index}]`;
  
  if (!trig.id || typeof trig.id !== 'string') {
    errors.push(`${prefix}: missing id`);
  }
  
  if (!trig.condition_id) {
    errors.push(`${prefix}: missing condition_id`);
  } else if (!conditionIds.has(trig.condition_id)) {
    errors.push(`${prefix}: references non-existent condition "${trig.condition_id}"`);
  }
  
  if (trig.edge && !ALLOWED.trigger_edges.includes(trig.edge)) {
    errors.push(`${prefix}: invalid edge "${trig.edge}" (allowed: ${ALLOWED.trigger_edges.join(', ')})`);
  }
  
  if (trig.cooldown !== undefined) {
    if (typeof trig.cooldown !== 'number' || trig.cooldown < LIMITS.min_cooldown) {
      errors.push(`${prefix}: cooldown must be >= ${LIMITS.min_cooldown} seconds`);
    }
    if (trig.cooldown > LIMITS.max_cooldown) {
      errors.push(`${prefix}: cooldown must be <= ${LIMITS.max_cooldown} seconds`);
    }
  }
  
  if (trig.max_fires_per_day !== undefined) {
    if (typeof trig.max_fires_per_day !== 'number' || trig.max_fires_per_day < 1) {
      errors.push(`${prefix}: max_fires_per_day must be >= 1`);
    }
    if (trig.max_fires_per_day > LIMITS.max_fires_per_day) {
      errors.push(`${prefix}: max_fires_per_day must be <= ${LIMITS.max_fires_per_day}`);
    }
  }
  
  return errors;
}

function validateAction(act, index, triggerIds) {
  const errors = [];
  const prefix = `actions[${index}]`;
  
  if (!act.type || !ALLOWED.action_types.includes(act.type)) {
    errors.push(`${prefix}: invalid type "${act.type}" (allowed: ${ALLOWED.action_types.join(', ')})`);
    return errors;
  }
  
  // trigger_id can be null/empty (always run) or reference existing trigger
  const trigId = act.trigger_id || act.trigger;
  if (trigId && trigId !== '' && !triggerIds.has(trigId)) {
    errors.push(`${prefix}: references non-existent trigger "${trigId}"`);
  }
  
  if (!act.config) {
    errors.push(`${prefix}: missing config`);
    return errors;
  }
  
  switch (act.type) {
    case 'notify':
      if (!act.config.title) {
        errors.push(`${prefix}: notify requires title`);
      }
      if (act.config.priority && !ALLOWED.priorities.includes(act.config.priority)) {
        errors.push(`${prefix}: invalid priority "${act.config.priority}"`);
      }
      break;
      
    case 'store':
      if (!act.config.key) {
        errors.push(`${prefix}: store requires key`);
      }
      break;
      
    case 'webhook':
      if (!act.config.url) {
        errors.push(`${prefix}: webhook requires url`);
      } else if (!act.config.url.startsWith('https://') && !act.config.url.includes('{{')) {
        errors.push(`${prefix}: webhook url must be HTTPS`);
      }
      break;
      
    case 'mark_seen':
      if (!act.config.source_id) {
        errors.push(`${prefix}: mark_seen requires source_id`);
      }
      if (!act.config.id_field) {
        errors.push(`${prefix}: mark_seen requires id_field`);
      }
      break;
  }
  
  return errors;
}

function validateParam(param, index) {
  const errors = [];
  const prefix = `params[${index}]`;
  
  if (!param.name || typeof param.name !== 'string') {
    errors.push(`${prefix}: missing name`);
  }
  
  if (!param.type || !ALLOWED.param_types.includes(param.type)) {
    errors.push(`${prefix}: invalid type "${param.type}" (allowed: ${ALLOWED.param_types.join(', ')})`);
  }
  
  if (!param.label || typeof param.label !== 'string') {
    errors.push(`${prefix}: missing label`);
  }
  
  if ((param.type === 'select' || param.type === 'multiselect') && !param.options) {
    errors.push(`${prefix}: ${param.type} requires options`);
  }
  
  return errors;
}

function isValidFieldPath(path) {
  return path.startsWith('sources.') || 
         path.startsWith('state.') || 
         path.startsWith('params.');
}

// ════════════════════════════════════════════════════════════════════════════
// APPLY DEFAULTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Apply default values to agent definition
 * @param {object} def - Agent definition
 * @returns {object} Definition with defaults applied
 */
export function applyDefaults(def) {
  const result = { ...def };
  
  // Triggers defaults
  if (result.triggers) {
    result.triggers = result.triggers.map(t => ({
      edge: 'rising',
      cooldown: DEFAULTS.cooldown,
      max_fires_per_day: DEFAULTS.max_fires_per_day,
      ...t
    }));
  }
  
  // Actions defaults
  if (result.actions) {
    result.actions = result.actions.map(a => {
      if (a.type === 'notify') {
        return {
          ...a,
          config: {
            priority: DEFAULTS.priority,
            use_llm: false,
            ...a.config
          }
        };
      }
      return a;
    });
  }
  
  // Sources defaults
  if (result.sources) {
    result.sources = result.sources.map(s => ({
      ...s,
      config: {
        timeout: DEFAULTS.timeout,
        ...s.config
      }
    }));
  }
  
  // Conditions defaults
  if (result.conditions) {
    result.conditions = result.conditions.map(c => ({
      array_mode: DEFAULTS.array_mode,
      ...c
    }));
  }
  
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZE DEFINITION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalize agent definition — regenerate unique IDs, validate references,
 * fill defaults, strip unknown keys. Idempotent.
 * @param {object} def - Raw definition
 * @returns {{ definition: object, errors: string[], warnings: string[] }}
 */
export function normalizeAgentDefinition(def) {
  const errors = [];
  const warnings = [];
  const d = JSON.parse(JSON.stringify(def));

  // 1. Regenerate source IDs (ensure uniqueness)
  const sourceIdMap = {};
  (d.sources || []).forEach((src, i) => {
    const newId = 'src-' + (i + 1);
    if (src.id && src.id !== newId) sourceIdMap[src.id] = newId;
    src.id = newId;
  });

  // 2. Regenerate condition IDs + update field paths with new source IDs
  const condIdMap = {};
  (d.conditions || []).forEach((cond, i) => {
    const newId = 'cond-' + (i + 1);
    if (cond.id && cond.id !== newId) condIdMap[cond.id] = newId;
    // Update field path: sources.OLD_ID.path → sources.NEW_ID.path
    if (cond.field) {
      for (const [oldId, newSrcId] of Object.entries(sourceIdMap)) {
        cond.field = cond.field.replace('sources.' + oldId + '.', 'sources.' + newSrcId + '.');
      }
    }
    cond.id = newId;
  });

  // 3. Regenerate trigger IDs + remap condition_id references
  const trigIdMap = {};
  const validCondIds = new Set((d.conditions || []).map(c => c.id));
  (d.triggers || []).forEach((trig, i) => {
    const newId = 'trig-' + (i + 1);
    if (trig.id && trig.id !== newId) trigIdMap[trig.id] = newId;
    // Remap condition_id if it was renamed
    if (trig.condition_id && condIdMap[trig.condition_id]) {
      trig.condition_id = condIdMap[trig.condition_id];
    }
    // Validate condition reference exists
    if (trig.condition_id && !validCondIds.has(trig.condition_id)) {
      errors.push('Trigger ' + (trig.id || newId) + ': condition_id "' + trig.condition_id + '" neexistuje');
    }
    trig.id = newId;
    // Apply defaults + clamp
    trig.cooldown = Math.max(LIMITS.min_cooldown, Math.min(LIMITS.max_cooldown, trig.cooldown || DEFAULTS.cooldown));
    trig.max_fires_per_day = Math.max(1, Math.min(LIMITS.max_fires_per_day, trig.max_fires_per_day || DEFAULTS.max_fires_per_day));
    if (!trig.edge) trig.edge = 'rising';
  });

  // 4. Update action trigger_id references
  const validTrigIds = new Set((d.triggers || []).map(t => t.id));
  (d.actions || []).forEach((act, i) => {
    // Remap trigger_id if it was renamed
    if (act.trigger_id && trigIdMap[act.trigger_id]) {
      act.trigger_id = trigIdMap[act.trigger_id];
    }
    // Validate trigger reference
    if (act.trigger_id && !validTrigIds.has(act.trigger_id)) {
      errors.push('actions[' + i + ']: trigger_id "' + act.trigger_id + '" neexistuje');
    }
    // mark_seen: validate + remap source_id
    if (act.type === 'mark_seen' && act.config) {
      if (act.config.source_id && sourceIdMap[act.config.source_id]) {
        act.config.source_id = sourceIdMap[act.config.source_id];
      }
      if (act.config.source_id) {
        const srcExists = (d.sources || []).some(s => s.id === act.config.source_id);
        if (!srcExists) {
          errors.push('actions[' + i + '] mark_seen: source_id "' + act.config.source_id + '" neexistuje');
        }
      }
    }
  });

  // 5. Fill defaults
  if (!d.schedule) d.schedule = { type: 'manual' };
  if (!d.params) d.params = [];

  return { definition: d, errors, warnings };
}

export default {
  ALLOWED,
  LIMITS,
  DEFAULTS,
  validateAgentDefinition,
  applyDefaults,
  normalizeAgentDefinition
};
