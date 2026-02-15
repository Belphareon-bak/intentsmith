// Project Context Prompt Builder (v65.4)
// ══════════════════════════════════════════════════════════════════════════════
// Sanitized, length-limited project context for LLM system prompt injection.
// Used by decisions.js (CONVERSATIONAL path) and synthesis.js (TOOL_CALL path).
// CRE hint (buildProjectHint) enriches CRE input for better intent classification.
// ══════════════════════════════════════════════════════════════════════════════

const MAX_NAME = 100;
const MAX_DESC = 500;
const MAX_GOAL = 300;

/**
 * Strip prompt injection patterns from user-editable text.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function sanitize(text, maxLen) {
  if (!text) return '';
  return text
    .replace(/[`]/g, "'")
    .replace(/#{3,}/g, '')
    .replace(/\b(IGNORE|SYSTEM:|BEGIN|END|INSTRUCTION)\b/gi, '')
    .slice(0, maxLen)
    .trim();
}

/**
 * Build project context string for system prompt injection.
 * Returns empty string if no active project.
 * @param {Object} context - fullContext from ChatController
 * @returns {string}
 */
export function buildProjectContext(context) {
  if (!context.hasActiveProject || !context.project) return '';

  const p = context.project;
  let ctx = '\n\nAKTIVNÍ PROJEKT:';
  ctx += '\n- Název: ' + sanitize(p.name, MAX_NAME);

  const desc = sanitize(p.description, MAX_DESC);
  if (desc) ctx += '\n- Popis: ' + desc;

  const goal = sanitize(context.projectGoal, MAX_GOAL);
  if (goal) ctx += '\n- Cíl: ' + goal;

  ctx += '\n\nTento projekt je aktuální kontext uživatele.';
  return ctx;
}

/**
 * Build short project hint for CRE input enrichment.
 * Double-bracket format to avoid CRE regex collisions.
 * @param {Object} context
 * @returns {string}
 */
export function buildProjectHint(context) {
  if (!context.hasActiveProject || !context.project) return '';
  return '\n[[PROJECT_CONTEXT:' + sanitize(context.project.name, MAX_NAME) + ']]';
}
