// C.3 v33 Agent Conditions - Deterministic Evaluator
// ══════════════════════════════════════════════════════════════════════════════
// ŽÁDNÉ LLM - čistě algoritmické vyhodnocení podmínek

import { ALLOWED, DEFAULTS } from './schema.js';

/**
 * Condition Evaluator - deterministic condition evaluation
 */
export class ConditionEvaluator {
  
  /**
   * Evaluate all conditions
   * @param {Array} conditions - Condition definitions
   * @param {object} context - { sources, state, params, now }
   * @returns {object} { results, details }
   */
  evaluateAll(conditions, context) {
    const results = {};
    const details = [];
    
    for (const condition of conditions) {
      try {
        const result = this.evaluate(condition, context);
        results[condition.id] = result.passed;
        details.push({
          id: condition.id,
          type: condition.type,
          passed: result.passed,
          actual: result.actual,
          expected: result.expected,
          reason: result.reason
        });
      } catch (err) {
        results[condition.id] = false;
        details.push({
          id: condition.id,
          type: condition.type,
          passed: false,
          error: err.message
        });
      }
    }
    
    return { results, details };
  }
  
  /**
   * Evaluate single condition
   * @param {object} condition
   * @param {object} context
   * @returns {{passed: boolean, actual: any, expected: any, reason: string}}
   */
  evaluate(condition, context) {
    switch (condition.type) {
      case 'compare':
        return this.evalCompare(condition, context);
      case 'date_diff':
        return this.evalDateDiff(condition, context);
      case 'contains':
        return this.evalContains(condition, context);
      case 'exists':
        return this.evalExists(condition, context);
      case 'in_range':
        return this.evalInRange(condition, context);
      case 'changed':
        return this.evalChanged(condition, context);
      case 'new_items':
        return this.evalNewItems(condition, context);
      default:
        throw new Error(`Unknown condition type: ${condition.type}`);
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // COMPARE
  // ════════════════════════════════════════════════════════════════════════════
  
  evalCompare(condition, context) {
    const { field, operator, value, array_mode } = condition;
    
    // Get field with status
    const fieldResult = this.getFieldWithStatus(field, context);
    
    // Field doesn't exist or is broken
    if (fieldResult.status !== 'ok') {
      return {
        passed: false,
        status: 'invalid',
        fieldStatus: fieldResult.status,
        reason: `Field ${field}: ${fieldResult.status} - ${fieldResult.error || 'field not found'}`
      };
    }
    
    const rawValue = fieldResult.value;
    const expected = this.resolveValue(value, context);
    
    // Handle arrays - MUST have explicit quantifier
    if (Array.isArray(rawValue)) {
      if (!array_mode) {
        return {
          passed: false,
          status: 'invalid',
          reason: `Field ${field} is array (${rawValue.length} items) but no quantifier specified. Add array_mode: any|all|min|max|avg`
        };
      }
      return this.evalArrayCompare(rawValue, operator, expected, array_mode, field);
    }
    
    const passed = this.compare(rawValue, operator, expected);
    
    return {
      passed,
      status: 'valid',
      actual: rawValue,
      expected: `${operator} ${expected}`,
      reason: `${field}: ${rawValue} ${operator} ${expected} = ${passed}`
    };
  }
  
  evalArrayCompare(arr, operator, expected, mode, field) {
    let actual, passed;
    
    switch (mode) {
      case 'any':
        passed = arr.some(v => this.compare(v, operator, expected));
        actual = `${arr.length} items (any match: ${passed})`;
        break;
      case 'all':
        passed = arr.every(v => this.compare(v, operator, expected));
        actual = `${arr.length} items (all match: ${passed})`;
        break;
      case 'none':
        passed = !arr.some(v => this.compare(v, operator, expected));
        actual = `${arr.length} items (none match: ${passed})`;
        break;
      case 'count':
        const count = arr.filter(v => this.compare(v, operator, expected)).length;
        passed = count > 0; // count mode returns if any match for now
        actual = `${count}/${arr.length} match`;
        break;
      case 'min':
        const min = Math.min(...arr.filter(v => typeof v === 'number'));
        passed = this.compare(min, operator, expected);
        actual = `min: ${min}`;
        break;
      case 'max':
        const max = Math.max(...arr.filter(v => typeof v === 'number'));
        passed = this.compare(max, operator, expected);
        actual = `max: ${max}`;
        break;
      case 'avg':
        const nums = arr.filter(v => typeof v === 'number');
        const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
        passed = this.compare(avg, operator, expected);
        actual = `avg: ${avg.toFixed(2)}`;
        break;
      case 'sum':
        const sum = arr.filter(v => typeof v === 'number').reduce((a, b) => a + b, 0);
        passed = this.compare(sum, operator, expected);
        actual = `sum: ${sum}`;
        break;
      default:
        passed = arr.some(v => this.compare(v, operator, expected));
        actual = `${arr.length} items`;
    }
    
    return {
      passed,
      actual,
      expected: `${operator} ${expected} (mode: ${mode})`,
      reason: `${field} [${mode}]: ${actual} ${operator} ${expected}`
    };
  }
  
  compare(a, op, b) {
    switch (op) {
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      case '==': return a == b;
      case '!=': return a != b;
      default: return false;
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // DATE_DIFF
  // ════════════════════════════════════════════════════════════════════════════
  
  evalDateDiff(condition, context) {
    const { field, operator, value, unit = 'days', array_mode = 'any' } = condition;
    const rawValue = this.getField(field, context);
    const now = context.now || new Date();
    
    // Handle arrays
    if (Array.isArray(rawValue)) {
      const results = rawValue.map(v => this.calcDateDiff(v, now, unit));
      return this.evalArrayCompare(results, operator, value, array_mode, field);
    }
    
    const diff = this.calcDateDiff(rawValue, now, unit);
    const passed = this.compare(diff, operator, value);
    
    return {
      passed,
      actual: `${diff.toFixed(1)} ${unit}`,
      expected: `${operator} ${value} ${unit}`,
      reason: `Date diff: ${diff.toFixed(1)} ${unit} ${operator} ${value} ${unit}`
    };
  }
  
  calcDateDiff(dateValue, now, unit) {
    const target = new Date(dateValue);
    const diffMs = target - now;
    
    switch (unit) {
      case 'minutes': return diffMs / 60000;
      case 'hours': return diffMs / 3600000;
      case 'days': return diffMs / 86400000;
      default: return diffMs / 86400000;
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // CONTAINS
  // ════════════════════════════════════════════════════════════════════════════
  
  evalContains(condition, context) {
    const { field, value, case_sensitive = false } = condition;
    let fieldValue = this.getField(field, context);
    let searchValue = value;
    
    if (typeof fieldValue !== 'string') {
      fieldValue = JSON.stringify(fieldValue);
    }
    
    if (!case_sensitive) {
      fieldValue = fieldValue.toLowerCase();
      searchValue = searchValue.toLowerCase();
    }
    
    const passed = fieldValue.includes(searchValue);
    
    return {
      passed,
      actual: fieldValue.substring(0, 100) + (fieldValue.length > 100 ? '...' : ''),
      expected: `contains "${value}"`,
      reason: passed ? `Found "${value}" in field` : `"${value}" not found`
    };
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // EXISTS
  // ════════════════════════════════════════════════════════════════════════════
  
  evalExists(condition, context) {
    const { field, min_count = 1 } = condition;
    const value = this.getField(field, context);
    
    let count = 0;
    if (Array.isArray(value)) {
      count = value.length;
    } else if (value !== null && value !== undefined) {
      count = 1;
    }
    
    const passed = count >= min_count;
    
    return {
      passed,
      actual: count,
      expected: `>= ${min_count}`,
      reason: `${field}: ${count} items (need >= ${min_count})`
    };
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // IN_RANGE
  // ════════════════════════════════════════════════════════════════════════════
  
  evalInRange(condition, context) {
    const { field, min, max, array_mode = 'any' } = condition;
    const rawValue = this.getField(field, context);
    
    const checkInRange = (v) => {
      if (min !== undefined && v < min) return false;
      if (max !== undefined && v > max) return false;
      return true;
    };
    
    // Handle arrays
    if (Array.isArray(rawValue)) {
      let passed;
      switch (array_mode) {
        case 'all':
          passed = rawValue.every(checkInRange);
          break;
        case 'none':
          passed = !rawValue.some(checkInRange);
          break;
        case 'any':
        default:
          passed = rawValue.some(checkInRange);
      }
      
      return {
        passed,
        actual: `${rawValue.length} items (${array_mode}: ${passed})`,
        expected: `${min ?? '-∞'} to ${max ?? '∞'}`,
        reason: `${field} [${array_mode}]: in range [${min ?? '-∞'}, ${max ?? '∞'}]`
      };
    }
    
    const passed = checkInRange(rawValue);
    
    return {
      passed,
      actual: rawValue,
      expected: `${min ?? '-∞'} to ${max ?? '∞'}`,
      reason: `${field}: ${rawValue} in [${min ?? '-∞'}, ${max ?? '∞'}] = ${passed}`
    };
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════════
  
  /**
   * Get field value from context using dot notation
   * Supports: sources.id.data.field, state.key, params.name
   * Supports array wildcard: results[*].price
   */
  /**
   * Get field value with explicit status
   * Returns { status: 'ok'|'missing'|'type_mismatch'|'ambiguous', value, error }
   */
  getFieldWithStatus(path, context) {
    try {
      const value = this.getField(path, context);
      
      if (value === undefined) {
        return {
          status: 'missing',
          value: undefined,
          error: `Field '${path}' not found in data`
        };
      }
      
      if (value === null) {
        return {
          status: 'missing',
          value: null,
          error: `Field '${path}' is null`
        };
      }
      
      // Check for ambiguous array results (auto-detected from items)
      if (Array.isArray(value) && !path.includes('[*]') && !path.endsWith('.items')) {
        return {
          status: 'ambiguous',
          value,
          error: `Field '${path}' resolved to array (${value.length} items) - use explicit [*] notation or add array_mode`
        };
      }
      
      return {
        status: 'ok',
        value
      };
    } catch (err) {
      return {
        status: 'error',
        value: undefined,
        error: err.message
      };
    }
  }

  getField(path, context) {
    // Handle wildcard [*]
    if (path.includes('[*]')) {
      return this.getFieldWithWildcard(path, context);
    }
    
    const parts = path.split('.');
    let value = context;
    let lastValidValue = context;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (value === null || value === undefined) {
        // Auto-detect: if we're in sources.X and looking for .price/.area etc
        // but value is undefined, try looking in .items array
        if (i >= 2 && parts[0] === 'sources' && lastValidValue && lastValidValue.items) {
          const remainingPath = parts.slice(i).join('.');
          const items = lastValidValue.items;
          if (Array.isArray(items) && items.length > 0 && items[0][remainingPath] !== undefined) {
            // Return array of values from all items
            return items.map(item => item[remainingPath]).filter(v => v !== undefined);
          }
          // Try just the current part
          if (Array.isArray(items) && items.length > 0 && items[0][part] !== undefined) {
            return items.map(item => item[part]).filter(v => v !== undefined);
          }
        }
        return undefined;
      }
      
      lastValidValue = value;
      
      // Handle array index [0]
      const indexMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (indexMatch) {
        value = value[indexMatch[1]]?.[parseInt(indexMatch[2])];
      } else {
        value = value[part];
      }
    }
    
    return value;
  }
  
  /**
   * Handle wildcard paths like sources.listings.data.items[*].price
   */
  getFieldWithWildcard(path, context) {
    const [beforeWildcard, afterWildcard] = path.split('[*]');
    const array = this.getField(beforeWildcard, context);
    
    if (!Array.isArray(array)) return [];
    
    if (!afterWildcard || afterWildcard === '') {
      return array;
    }
    
    // afterWildcard starts with "." - remove it
    const subPath = afterWildcard.startsWith('.') ? afterWildcard.slice(1) : afterWildcard;
    
    return array.map(item => {
      if (!subPath) return item;
      return this.getField(subPath, { item }).item ?? this.getField(subPath, item);
    }).filter(v => v !== undefined);
  }
  
  /**
   * Resolve value - could be literal or {{param}} reference
   */
  resolveValue(value, context) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const path = value.slice(2, -2).trim();
      return this.getField(path, context);
    }
    return value;
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // CHANGED - detects if value changed from previous run
  // ════════════════════════════════════════════════════════════════════════════
  
  evalChanged(condition, context) {
    const { field, compare_field } = condition;
    const currentValue = this.getField(field, context);
    
    // Get previous value from state
    const stateKey = compare_field || `_prev_${field.replace(/\./g, '_')}`;
    const previousValue = context.state?.[stateKey];
    
    // First run - no previous value
    if (previousValue === undefined) {
      return {
        passed: false,
        actual: currentValue,
        expected: 'previous value',
        reason: 'First run, no previous value to compare'
      };
    }
    
    // Compare values
    const currentStr = JSON.stringify(currentValue);
    const previousStr = JSON.stringify(previousValue);
    const changed = currentStr !== previousStr;
    
    return {
      passed: changed,
      actual: currentValue,
      expected: previousValue,
      reason: changed 
        ? `Value changed from ${previousStr.substring(0, 50)} to ${currentStr.substring(0, 50)}`
        : 'Value unchanged'
    };
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // NEW_ITEMS - detects new items in array compared to previous run
  // ════════════════════════════════════════════════════════════════════════════
  
  evalNewItems(condition, context) {
    const { field, id_field = 'id', min_new = 1 } = condition;
    const currentItems = this.getField(field, context);
    
    if (!Array.isArray(currentItems)) {
      return {
        passed: false,
        actual: currentItems,
        expected: 'array',
        reason: 'Field is not an array'
      };
    }
    
    // Get seen IDs from state
    const stateKey = `_seen_ids_${field.replace(/\./g, '_')}`;
    const seenIds = new Set(context.state?.[stateKey] || []);
    
    // Extract current IDs
    const currentIds = currentItems.map(item => {
      if (typeof item === 'object' && item !== null) {
        return item[id_field];
      }
      return item;
    }).filter(id => id !== undefined);
    
    // Find new IDs
    const newIds = currentIds.filter(id => !seenIds.has(id));
    const newCount = newIds.length;
    
    // Store new items in context for actions to use
    if (!context._computed) context._computed = {};
    context._computed.new_items = currentItems.filter(item => {
      const itemId = typeof item === 'object' ? item[id_field] : item;
      return newIds.includes(itemId);
    });
    context._computed.new_count = newCount;
    
    const passed = newCount >= min_new;
    
    return {
      passed,
      actual: newCount,
      expected: `>= ${min_new} new items`,
      reason: passed 
        ? `Found ${newCount} new item(s): ${newIds.slice(0, 3).join(', ')}${newIds.length > 3 ? '...' : ''}`
        : seenIds.size === 0 
          ? 'First run, recording initial items'
          : `No new items (${currentIds.length} total, ${seenIds.size} seen)`
    };
  }
}

export default ConditionEvaluator;
