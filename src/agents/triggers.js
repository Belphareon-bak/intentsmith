// C.3 v33 Agent Triggers - Edge Detection
// ══════════════════════════════════════════════════════════════════════════════
// Triggers = změna stavu condition, NE pouhá pravdivost
// Tohle je klíčové pro zamezení spamu notifikací

/**
 * Trigger Evaluator - edge detection
 */
export class TriggerEvaluator {
  
  /**
   * Evaluate all triggers based on condition results and previous state
   * @param {Array} triggers - Trigger definitions
   * @param {object} conditionResults - { condition_id: boolean }
   * @param {object} state - Previous agent state (contains _condition_states, _trigger_fires)
   * @param {Date} now - Current time
   * @returns {object} { fired: string[], details: Array, newState: object }
   */
  evaluateAll(triggers, conditionResults, state, now = new Date()) {
    const fired = [];
    const details = [];
    const newState = { ...state };
    
    // Initialize state objects if missing
    if (!newState._condition_states) {
      newState._condition_states = {};
    }
    if (!newState._trigger_fires) {
      newState._trigger_fires = {};
    }
    if (!newState._trigger_daily_counts) {
      newState._trigger_daily_counts = {};
    }
    
    // Reset daily counts if new day
    const today = now.toISOString().split('T')[0];
    if (newState._last_day !== today) {
      newState._trigger_daily_counts = {};
      newState._last_day = today;
    }
    
    for (const trigger of triggers) {
      const result = this.evaluate(trigger, conditionResults, newState, now);
      details.push(result);
      
      if (result.fired) {
        fired.push(trigger.id);
        
        // Update fire tracking
        newState._trigger_fires[trigger.id] = now.toISOString();
        newState._trigger_daily_counts[trigger.id] = 
          (newState._trigger_daily_counts[trigger.id] || 0) + 1;
      }
      
      // Always update condition state
      newState._condition_states[trigger.condition_id] = conditionResults[trigger.condition_id];
    }
    
    return { fired, details, newState };
  }
  
  /**
   * Evaluate single trigger
   * @param {object} trigger
   * @param {object} conditionResults
   * @param {object} state
   * @param {Date} now
   * @returns {object}
   */
  evaluate(trigger, conditionResults, state, now) {
    const { id, condition_id, edge = 'rising', cooldown = 300, max_fires_per_day = 10 } = trigger;
    
    const currentValue = conditionResults[condition_id];
    const previousValue = state._condition_states?.[condition_id];
    const lastFire = state._trigger_fires?.[id];
    const dailyCount = state._trigger_daily_counts?.[id] || 0;
    
    // Check cooldown
    if (lastFire) {
      const lastFireDate = new Date(lastFire);
      const secondsSinceLastFire = (now - lastFireDate) / 1000;
      if (secondsSinceLastFire < cooldown) {
        return {
          id,
          condition_id,
          fired: false,
          reason: `Cooldown: ${Math.ceil(cooldown - secondsSinceLastFire)}s remaining`,
          current: currentValue,
          previous: previousValue,
          edge
        };
      }
    }
    
    // Check daily limit
    if (dailyCount >= max_fires_per_day) {
      return {
        id,
        condition_id,
        fired: false,
        reason: `Daily limit reached: ${dailyCount}/${max_fires_per_day}`,
        current: currentValue,
        previous: previousValue,
        edge
      };
    }
    
    // First run - no previous state
    if (previousValue === undefined || previousValue === null) {
      // On first run, only fire if current is true and edge is 'rising' or 'any'
      const fired = currentValue === true && (edge === 'rising' || edge === 'any');
      return {
        id,
        condition_id,
        fired,
        reason: fired ? 'First run with condition true' : 'First run, waiting for edge',
        current: currentValue,
        previous: null,
        edge
      };
    }
    
    // Edge detection
    let fired = false;
    let reason = '';
    
    switch (edge) {
      case 'rising':
        // false → true
        fired = previousValue === false && currentValue === true;
        reason = fired 
          ? 'Rising edge: false → true' 
          : currentValue 
            ? 'Already true (no edge)' 
            : 'Condition false';
        break;
        
      case 'falling':
        // true → false
        fired = previousValue === true && currentValue === false;
        reason = fired 
          ? 'Falling edge: true → false' 
          : currentValue === false 
            ? 'Already false (no edge)' 
            : 'Condition true';
        break;
        
      case 'any':
        // any change
        fired = previousValue !== currentValue;
        reason = fired 
          ? `Change detected: ${previousValue} → ${currentValue}` 
          : 'No change';
        break;
        
      default:
        reason = `Unknown edge type: ${edge}`;
    }
    
    return {
      id,
      condition_id,
      fired,
      reason,
      current: currentValue,
      previous: previousValue,
      edge
    };
  }
}

export default TriggerEvaluator;
