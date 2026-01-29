// CRE v44.1 — Agent Form Model
// ══════════════════════════════════════════════════════════════════════════════
//
// Separates agent form data model from view representation.
// Provides structured editing of agent definitions.
//
// Usage:
//   const model = new AgentFormModel(agent.definition);
//   model.setInterval(4, 'hours');
//   const json = model.toDefinition();
//
// ══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Interval Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse interval string (e.g., "4h", "30m", "1d") to { value, unit }
 */
export function parseInterval(intervalStr) {
  if (!intervalStr || typeof intervalStr !== 'string') {
    return { value: 1, unit: 'hours' };
  }

  const match = intervalStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    return { value: 1, unit: 'hours' };
  }

  const value = parseInt(match[1], 10);
  const unitMap = {
    's': 'seconds',
    'm': 'minutes',
    'h': 'hours',
    'd': 'days',
  };

  return {
    value,
    unit: unitMap[match[2]] || 'hours',
  };
}

/**
 * Serialize { value, unit } to interval string (e.g., "4h")
 */
export function serializeInterval(value, unit) {
  const unitMap = {
    'seconds': 's',
    'minutes': 'm',
    'hours': 'h',
    'days': 'd',
  };

  const suffix = unitMap[unit] || 'h';
  return `${value}${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Form Model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent Form Model - structured representation of agent definition
 *
 * This is the SOURCE OF TRUTH for the form.
 * JSON is just serialization, not the model.
 */
export class AgentFormModel {
  constructor(definition = {}) {
    // Basic info
    this.id = definition.id || '';
    this.name = definition.name || '';
    this.description = definition.description || '';
    this.icon = definition.icon || '🤖';

    // Schedule
    this.schedule = {
      type: definition.schedule?.type || 'interval',
      ...parseInterval(definition.schedule?.interval),
      cron: definition.schedule?.cron || '',
    };

    // Sources
    this.sources = (definition.sources || []).map(s => ({
      id: s.id || this.generateId('source'),
      type: s.type || 'http',
      config: { ...s.config } || {},
    }));

    // Conditions
    this.conditions = (definition.conditions || []).map(c => ({
      id: c.id || this.generateId('condition'),
      type: c.type || 'compare',
      field: c.field || '',
      operator: c.operator || '==',
      value: c.value ?? '',
      ...c,
    }));

    // Triggers
    this.triggers = (definition.triggers || []).map(t => ({
      id: t.id || this.generateId('trigger'),
      type: t.type || 'on_true',
      condition_id: t.condition_id || '',
      edge: t.edge || 'rising',
    }));

    // Actions
    this.actions = (definition.actions || []).map(a => ({
      type: a.type || 'notify',
      trigger_id: a.trigger_id || '',
      config: { ...a.config } || {},
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Schedule Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Set interval schedule
   * @param {number} value - Interval value
   * @param {string} unit - 'seconds' | 'minutes' | 'hours' | 'days'
   */
  setInterval(value, unit) {
    this.schedule.type = 'interval';
    this.schedule.value = value;
    this.schedule.unit = unit;
    return this;
  }

  /**
   * Get interval as display string (e.g., "4 hours")
   */
  getIntervalDisplay() {
    const { value, unit } = this.schedule;
    const unitDisplayMap = {
      'seconds': value === 1 ? 'sekunda' : 'sekund',
      'minutes': value === 1 ? 'minuta' : 'minut',
      'hours': value === 1 ? 'hodina' : 'hodin',
      'days': value === 1 ? 'den' : 'dnů',
    };
    return `${value} ${unitDisplayMap[unit] || unit}`;
  }

  /**
   * Get interval as string for API (e.g., "4h")
   */
  getIntervalString() {
    return serializeInterval(this.schedule.value, this.schedule.unit);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Source Methods
  // ─────────────────────────────────────────────────────────────────────────────

  addSource(type = 'http', config = {}) {
    const source = {
      id: this.generateId('source'),
      type,
      config,
    };
    this.sources.push(source);
    return source;
  }

  removeSource(id) {
    const index = this.sources.findIndex(s => s.id === id);
    if (index !== -1) {
      this.sources.splice(index, 1);
    }
    return this;
  }

  updateSource(id, updates) {
    const source = this.sources.find(s => s.id === id);
    if (source) {
      Object.assign(source, updates);
    }
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Condition Methods
  // ─────────────────────────────────────────────────────────────────────────────

  addCondition(type = 'compare', config = {}) {
    const condition = {
      id: this.generateId('condition'),
      type,
      field: config.field || '',
      operator: config.operator || '==',
      value: config.value ?? '',
      ...config,
    };
    this.conditions.push(condition);
    return condition;
  }

  removeCondition(id) {
    const index = this.conditions.findIndex(c => c.id === id);
    if (index !== -1) {
      this.conditions.splice(index, 1);
      // Also remove triggers referencing this condition
      this.triggers = this.triggers.filter(t => t.condition_id !== id);
    }
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Trigger Methods
  // ─────────────────────────────────────────────────────────────────────────────

  addTrigger(conditionId, type = 'on_true') {
    const trigger = {
      id: this.generateId('trigger'),
      type,
      condition_id: conditionId,
      edge: 'rising',
    };
    this.triggers.push(trigger);
    return trigger;
  }

  removeTrigger(id) {
    const index = this.triggers.findIndex(t => t.id === id);
    if (index !== -1) {
      this.triggers.splice(index, 1);
      // Also remove actions referencing this trigger
      this.actions = this.actions.filter(a => a.trigger_id !== id);
    }
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Action Methods
  // ─────────────────────────────────────────────────────────────────────────────

  addAction(triggerId, type = 'notify', config = {}) {
    const action = {
      type,
      trigger_id: triggerId,
      config,
    };
    this.actions.push(action);
    return action;
  }

  removeAction(index) {
    this.actions.splice(index, 1);
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Serialization
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Convert model to JSON definition for API
   */
  toDefinition() {
    const definition = {
      id: this.id,
      name: this.name,
      description: this.description,
      icon: this.icon,
      schedule: {
        type: this.schedule.type,
      },
      sources: this.sources.map(s => ({
        id: s.id,
        type: s.type,
        config: { ...s.config },
      })),
      conditions: this.conditions.map(c => {
        const { id, type, ...rest } = c;
        return { id, type, ...rest };
      }),
      triggers: this.triggers.map(t => ({
        id: t.id,
        type: t.type,
        condition_id: t.condition_id,
        edge: t.edge,
      })),
      actions: this.actions.map(a => ({
        type: a.type,
        trigger_id: a.trigger_id,
        config: { ...a.config },
      })),
    };

    // Add schedule-specific fields
    if (this.schedule.type === 'interval') {
      definition.schedule.interval = this.getIntervalString();
    } else if (this.schedule.type === 'cron') {
      definition.schedule.cron = this.schedule.cron;
    }

    return definition;
  }

  /**
   * Convert to JSON string (for preview/debugging)
   */
  toJSON() {
    return JSON.stringify(this.toDefinition(), null, 2);
  }

  /**
   * Create model from JSON string
   */
  static fromJSON(jsonString) {
    try {
      const definition = JSON.parse(jsonString);
      return new AgentFormModel(definition);
    } catch (err) {
      console.error('Invalid JSON:', err);
      return new AgentFormModel({});
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Validate the model
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];

    if (!this.name.trim()) {
      errors.push('Název je povinný');
    }

    if (this.sources.length === 0) {
      errors.push('Je vyžadován alespoň jeden zdroj');
    }

    for (const source of this.sources) {
      if (!source.type) {
        errors.push(`Zdroj ${source.id} nemá typ`);
      }
      if (source.type === 'http' && !source.config?.url) {
        errors.push(`Zdroj ${source.id} nemá URL`);
      }
    }

    if (this.schedule.type === 'interval' && this.schedule.value <= 0) {
      errors.push('Interval musí být větší než 0');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  AgentFormModel,
  parseInterval,
  serializeInterval,
};
