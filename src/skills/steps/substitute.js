// Step Substitution — replaces {{paramName}} and {{steps.X.output}} placeholders
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Replace placeholders in a string:
 *   {{paramName}}        → params[paramName]
 *   {{steps.X.output}}   → stepsOutput[X]
 *
 * @param {string} text - Template string with placeholders
 * @param {Object} params - Skill parameters (from resolver)
 * @param {Object} stepsOutput - Accumulated step outputs { stepId: outputString }
 * @returns {string} Resolved string
 */
export function substitute(text, params = {}, stepsOutput = {}) {
  if (!text || typeof text !== 'string') return text || '';

  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();

    // {{steps.X.output}} → stepsOutput[X]
    const stepMatch = trimmed.match(/^steps\.([^.]+)\.output$/);
    if (stepMatch) {
      const stepId = stepMatch[1];
      return stepsOutput[stepId] !== undefined ? String(stepsOutput[stepId]) : match;
    }

    // {{paramName}} → params[paramName]
    if (params[trimmed] !== undefined) {
      return String(params[trimmed]);
    }

    // No match — leave placeholder as-is
    return match;
  });
}
