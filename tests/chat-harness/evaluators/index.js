// Chat Quality Evaluators v48.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Evaluators for conversational quality metrics:
// - Semantic similarity (coherence)
// - Factuality (retrieval cross-check)
// - Tool-call correctness
// - Instruction following
//
// ══════════════════════════════════════════════════════════════════════════════

import { MetricType } from '../runner.js';

// ════════════════════════════════════════════════════════════════════════════
// BASE EVALUATOR
// ════════════════════════════════════════════════════════════════════════════

class BaseEvaluator {
  constructor(name) {
    this.name = name;
  }

  async evaluate(turn, response, messages, turnIndex) {
    throw new Error('evaluate() must be implemented');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SEMANTIC SIMILARITY EVALUATOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Measures coherence between expected and actual response
 * Uses simple word overlap as baseline (can be upgraded to embeddings)
 */
export class SemanticSimilarityEvaluator extends BaseEvaluator {
  constructor(options = {}) {
    super('semantic_similarity');
    this.threshold = options.threshold || 0.5;
  }

  async evaluate(turn, response, messages, turnIndex) {
    if (!turn.expected) {
      return { evaluator: this.name, skipped: true, reason: 'No expected response' };
    }

    const actual = typeof response === 'string' ? response : response.content || '';
    const expected = turn.expected;

    const score = this.calculateSimilarity(actual, expected);
    const passed = score >= this.threshold;

    return {
      evaluator: this.name,
      metric: MetricType.COHERENCE,
      score,
      threshold: this.threshold,
      passed,
      details: {
        actual_preview: actual.substring(0, 100),
        expected_preview: expected.substring(0, 100),
      },
    };
  }

  /**
   * Calculate similarity score (0-1)
   * Simple word overlap - in production use embeddings
   */
  calculateSimilarity(actual, expected) {
    const actualWords = new Set(this.tokenize(actual));
    const expectedWords = new Set(this.tokenize(expected));

    if (expectedWords.size === 0) return 1;

    let overlap = 0;
    for (const word of expectedWords) {
      if (actualWords.has(word)) overlap++;
    }

    return overlap / expectedWords.size;
  }

  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// FACTUALITY EVALUATOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Checks factuality of responses
 * Verifies claims against provided facts/sources
 */
export class FactualityEvaluator extends BaseEvaluator {
  constructor(options = {}) {
    super('factuality');
    this.factsDB = options.factsDB || new Map();
  }

  async evaluate(turn, response, messages, turnIndex) {
    if (!turn.required_facts) {
      return { evaluator: this.name, skipped: true, reason: 'No required facts' };
    }

    const actual = typeof response === 'string' ? response : response.content || '';
    const requiredFacts = turn.required_facts;

    let correctFacts = 0;
    const factResults = [];

    for (const fact of requiredFacts) {
      const present = this.checkFactPresent(actual, fact);
      if (present) correctFacts++;

      factResults.push({
        fact,
        present,
      });
    }

    const score = requiredFacts.length > 0 ? correctFacts / requiredFacts.length : 1;
    const passed = score >= 0.9; // 90% factuality threshold

    return {
      evaluator: this.name,
      metric: MetricType.FACTUALITY,
      score,
      passed,
      details: {
        facts_checked: requiredFacts.length,
        facts_present: correctFacts,
        results: factResults,
      },
    };
  }

  checkFactPresent(text, fact) {
    // Simple substring check - in production use NLI/entailment
    const normalizedText = text.toLowerCase();
    const normalizedFact = fact.toLowerCase();

    // Check for key terms
    const keyTerms = normalizedFact.split(/\s+/).filter(w => w.length > 3);
    const matchedTerms = keyTerms.filter(term => normalizedText.includes(term));

    return matchedTerms.length >= keyTerms.length * 0.6;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TOOL-CALL EVALUATOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Verifies correct tool usage
 * Checks if expected tools were called with correct parameters
 */
export class ToolCallEvaluator extends BaseEvaluator {
  constructor(options = {}) {
    super('tool_call');
  }

  async evaluate(turn, response, messages, turnIndex) {
    if (!turn.expected_tool) {
      return { evaluator: this.name, skipped: true, reason: 'No expected tool' };
    }

    const toolCalls = response.tool_calls || [];
    const expectedTool = turn.expected_tool;

    // Check if expected tool was called
    const toolCalled = toolCalls.some(tc => tc.name === expectedTool.name);

    // Check parameters if specified
    let paramsCorrect = true;
    if (expectedTool.params && toolCalled) {
      const actualCall = toolCalls.find(tc => tc.name === expectedTool.name);
      paramsCorrect = this.checkParams(actualCall?.arguments || {}, expectedTool.params);
    }

    const passed = toolCalled && paramsCorrect;
    const score = passed ? 1 : 0;

    return {
      evaluator: this.name,
      metric: MetricType.TOOL_USE,
      score,
      passed,
      details: {
        expected_tool: expectedTool.name,
        tool_called: toolCalled,
        params_correct: paramsCorrect,
        actual_calls: toolCalls.map(tc => tc.name),
      },
    };
  }

  checkParams(actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) {
        return false;
      }
    }
    return true;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// INSTRUCTION FOLLOWING EVALUATOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Checks if explicit instructions were followed
 * E.g., "list 5 items", "respond in bullet points"
 */
export class InstructionFollowingEvaluator extends BaseEvaluator {
  constructor(options = {}) {
    super('instruction_following');
  }

  async evaluate(turn, response, messages, turnIndex) {
    if (!turn.instructions) {
      return { evaluator: this.name, skipped: true, reason: 'No instructions' };
    }

    const actual = typeof response === 'string' ? response : response.content || '';
    const instructions = turn.instructions;

    let followedCount = 0;
    const instructionResults = [];

    for (const instruction of instructions) {
      const followed = this.checkInstruction(actual, instruction);
      if (followed) followedCount++;

      instructionResults.push({
        instruction: instruction.type,
        followed,
      });
    }

    const score = instructions.length > 0 ? followedCount / instructions.length : 1;
    const passed = score >= 1; // Must follow all instructions

    return {
      evaluator: this.name,
      metric: MetricType.INSTRUCTION_FOLLOWING,
      score,
      passed,
      details: {
        instructions_total: instructions.length,
        instructions_followed: followedCount,
        results: instructionResults,
      },
    };
  }

  checkInstruction(text, instruction) {
    switch (instruction.type) {
      case 'list_count':
        return this.checkListCount(text, instruction.count);

      case 'contains':
        return text.toLowerCase().includes(instruction.value.toLowerCase());

      case 'format':
        return this.checkFormat(text, instruction.format);

      case 'length_max':
        return text.length <= instruction.value;

      case 'length_min':
        return text.length >= instruction.value;

      default:
        return true;
    }
  }

  checkListCount(text, expectedCount) {
    // Count bullet points or numbered items
    const bulletMatches = text.match(/^[\-\*•]\s/gm) || [];
    const numberedMatches = text.match(/^\d+[\.\)]\s/gm) || [];
    const totalItems = bulletMatches.length + numberedMatches.length;

    return totalItems >= expectedCount;
  }

  checkFormat(text, format) {
    switch (format) {
      case 'bullet_points':
        return /^[\-\*•]\s/m.test(text);
      case 'numbered':
        return /^\d+[\.\)]\s/m.test(text);
      case 'json':
        try {
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      default:
        return true;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONTRADICTION DETECTOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detects contradictions within a conversation
 */
export class ContradictionDetector extends BaseEvaluator {
  constructor(options = {}) {
    super('contradiction_detector');
  }

  async evaluate(turn, response, messages, turnIndex) {
    const actual = typeof response === 'string' ? response : response.content || '';

    // Get previous assistant messages
    const previousAssistant = messages
      .filter(m => m.role === 'assistant')
      .map(m => m.content);

    // Check for contradictions
    const contradictions = this.findContradictions(actual, previousAssistant);
    const hasContradiction = contradictions.length > 0;

    return {
      evaluator: this.name,
      metric: MetricType.COHERENCE,
      score: hasContradiction ? 0 : 1,
      passed: !hasContradiction,
      details: {
        contradictions_found: contradictions.length,
        contradictions,
      },
    };
  }

  findContradictions(current, previous) {
    // Simple negation detection - in production use NLI
    const contradictions = [];

    const currentStatements = this.extractStatements(current);

    for (const prev of previous) {
      const prevStatements = this.extractStatements(prev);

      for (const curr of currentStatements) {
        for (const prevS of prevStatements) {
          if (this.areContradictory(curr, prevS)) {
            contradictions.push({ current: curr, previous: prevS });
          }
        }
      }
    }

    return contradictions;
  }

  extractStatements(text) {
    return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  }

  areContradictory(a, b) {
    // Simple heuristic: check for negation patterns
    const aNorm = a.toLowerCase();
    const bNorm = b.toLowerCase();

    // Check if one is negation of the other
    const negationPatterns = [
      [/is not/, /is/],
      [/cannot/, /can/],
      [/won't/, /will/],
      [/don't/, /do/],
    ];

    for (const [neg, pos] of negationPatterns) {
      if ((neg.test(aNorm) && pos.test(bNorm)) ||
          (pos.test(aNorm) && neg.test(bNorm))) {
        // Check if talking about the same subject
        const aWords = new Set(aNorm.split(/\s+/));
        const bWords = new Set(bNorm.split(/\s+/));
        const overlap = [...aWords].filter(w => bWords.has(w) && w.length > 3);

        if (overlap.length >= 2) {
          return true;
        }
      }
    }

    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT ALL EVALUATORS
// ════════════════════════════════════════════════════════════════════════════

export const defaultEvaluators = [
  new SemanticSimilarityEvaluator(),
  new FactualityEvaluator(),
  new ToolCallEvaluator(),
  new InstructionFollowingEvaluator(),
  new ContradictionDetector(),
];

export default defaultEvaluators;
