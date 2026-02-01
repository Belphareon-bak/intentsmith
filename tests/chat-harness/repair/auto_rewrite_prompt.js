// Auto Prompt Rewriter v48.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Generates prompt variations to attempt test repair:
// - Clarify instructions
// - Add constraints
// - Rephrase for better comprehension
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// REWRITE STRATEGIES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Strategy: Add explicit formatting instructions
 */
export function addFormattingInstructions(scenario, failedResult) {
  const failedTurn = failedResult.turns.find(t => !t.passed);
  if (!failedTurn) return null;

  // Check if formatting was the issue
  const formatIssue = failedTurn.evaluation?.results?.find(
    r => r.evaluator === 'instruction_following' && !r.passed
  );

  if (!formatIssue) return null;

  return {
    type: 'add_formatting',
    original: failedTurn.user_input,
    rewritten: `${failedTurn.user_input}\n\nIMPORTANT: Follow the formatting exactly as specified.`,
    reason: 'Added explicit formatting reminder',
  };
}

/**
 * Strategy: Simplify complex prompts
 */
export function simplifyPrompt(scenario, failedResult) {
  const failedTurn = failedResult.turns.find(t => !t.passed);
  if (!failedTurn) return null;

  const input = failedTurn.user_input;

  // If prompt is too long/complex, simplify
  if (input.length > 200 || input.split('.').length > 3) {
    // Extract key instruction
    const sentences = input.split(/[.!?]+/).filter(s => s.trim());
    const simplified = sentences[0].trim() + '.';

    return {
      type: 'simplify',
      original: input,
      rewritten: simplified,
      reason: 'Simplified complex prompt to core instruction',
    };
  }

  return null;
}

/**
 * Strategy: Add context from previous turns
 */
export function addContextFromHistory(scenario, failedResult) {
  const failedTurnIndex = failedResult.turns.findIndex(t => !t.passed);
  if (failedTurnIndex <= 0) return null;

  const failedTurn = failedResult.turns[failedTurnIndex];
  const previousTurn = failedResult.turns[failedTurnIndex - 1];

  // Check if issue might be context-related
  const coherenceIssue = failedTurn.evaluation?.results?.find(
    r => r.metric === 'coherence' && r.score < 0.5
  );

  if (!coherenceIssue) return null;

  return {
    type: 'add_context',
    original: failedTurn.user_input,
    rewritten: `Based on your previous response about "${previousTurn?.assistant_response?.substring(0, 50)}...", ${failedTurn.user_input}`,
    reason: 'Added reference to previous context',
  };
}

/**
 * Strategy: Make tool call explicit
 */
export function explicitToolRequest(scenario, failedResult) {
  const failedTurn = failedResult.turns.find(t => !t.passed);
  if (!failedTurn) return null;

  const toolIssue = failedTurn.evaluation?.results?.find(
    r => r.evaluator === 'tool_call' && !r.passed
  );

  if (!toolIssue) return null;

  const expectedTool = scenario.turns.find(t => t.user === failedTurn.user_input)?.expected_tool;
  if (!expectedTool) return null;

  return {
    type: 'explicit_tool',
    original: failedTurn.user_input,
    rewritten: `${failedTurn.user_input}\n\nUse the ${expectedTool.name} tool to accomplish this.`,
    reason: `Added explicit instruction to use ${expectedTool.name}`,
  };
}

/**
 * Strategy: Add output example
 */
export function addOutputExample(scenario, failedResult) {
  const failedTurn = failedResult.turns.find(t => !t.passed);
  if (!failedTurn?.expected) return null;

  return {
    type: 'add_example',
    original: failedTurn.user_input,
    rewritten: `${failedTurn.user_input}\n\nExample of expected format: "${failedTurn.expected.substring(0, 100)}..."`,
    reason: 'Added output example for clarity',
  };
}

// ════════════════════════════════════════════════════════════════════════════
// REPAIR STRATEGY CLASS
// ════════════════════════════════════════════════════════════════════════════

export class PromptRewriteStrategy {
  constructor() {
    this.name = 'prompt_rewrite';
    this.strategies = [
      addFormattingInstructions,
      simplifyPrompt,
      addContextFromHistory,
      explicitToolRequest,
      addOutputExample,
    ];
  }

  /**
   * Propose a repair
   */
  async propose(scenario, failedResult) {
    for (const strategy of this.strategies) {
      const repair = strategy(scenario, failedResult);
      if (repair) {
        return repair;
      }
    }
    return null;
  }

  /**
   * Apply a repair to the scenario
   */
  apply(scenario, repair) {
    const repairedScenario = JSON.parse(JSON.stringify(scenario));

    // Find and replace the turn
    const turnIndex = repairedScenario.turns.findIndex(t => t.user === repair.original);
    if (turnIndex !== -1) {
      repairedScenario.turns[turnIndex].user = repair.rewritten;
      repairedScenario.turns[turnIndex]._repair = repair;
    }

    return repairedScenario;
  }
}

export default PromptRewriteStrategy;
