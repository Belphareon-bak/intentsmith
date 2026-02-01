// Contracts Module — Public API
// ══════════════════════════════════════════════════════════════════════════════
//
// Runtime contract validation for agent data structures.
//
// Available contracts:
//   - planner-output: Output from Planner component
//   - tool-call: Tool call request format
//   - execution-result: Output from Executor component
//
// Usage:
//   import { validate, validateOrThrow, ValidationError } from './contracts/index.js';
//
//   const result = validate('planner-output', data);
//   if (!result.valid) console.error(result.errors);
//
//   validateOrThrow('tool-call', toolCall); // throws on invalid
//
// ══════════════════════════════════════════════════════════════════════════════

export { validate, validateOrThrow, ValidationError } from './validate.js';

// Contract identifiers
export const Contracts = {
  PLANNER_OUTPUT: 'planner-output',
  TOOL_CALL: 'tool-call',
  EXECUTION_RESULT: 'execution-result',
};
