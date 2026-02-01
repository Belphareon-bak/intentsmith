// Decision Layer v48.2
// ══════════════════════════════════════════════════════════════════════════════
//
// The cognitive core of chat: DECIDE before you respond.
//
// Every user input goes through decision analysis BEFORE generating a response.
// This is the missing layer that causes most chat failures.
//
// Decision Flow:
//   user input → DecisionAnalyzer → Decision → ResponseStrategy → response
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { auditTrail, AuditAction } from '../audit/trail.js';

// ════════════════════════════════════════════════════════════════════════════
// DECISION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const DecisionType = {
  ANSWER: 'answer',       // Provide direct answer
  ASK: 'ask',             // Ask for clarification
  REFUSE: 'refuse',       // Refuse the request (dangerous, impossible, unethical)
  CHALLENGE: 'challenge', // Challenge a false premise
  DELEGATE: 'delegate',   // Delegate to expert/specialist
};

// ════════════════════════════════════════════════════════════════════════════
// DECISION SCHEMA
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Decision
 * @property {string} type - One of DecisionType
 * @property {string} reason - Why this decision was made
 * @property {number} confidence - 0-1 confidence in decision
 * @property {string[]} risks - Identified risks
 * @property {string[]} missing_info - Information needed (for ASK)
 * @property {string} false_premise - The incorrect assumption (for CHALLENGE)
 * @property {string} refusal_reason - Why refusing (for REFUSE)
 * @property {string} delegate_to - Expert type (for DELEGATE)
 */

// ════════════════════════════════════════════════════════════════════════════
// DECISION ANALYZER
// ════════════════════════════════════════════════════════════════════════════

export class DecisionAnalyzer {
  constructor(options = {}) {
    this.llm = options.llm || null;
    this.auditEnabled = options.audit ?? true;

    // Detection patterns
    this.patterns = {
      // Patterns that indicate we should ASK
      needsClarification: [
        /^(how|what|why|when|where|which)\s+do\s+i/i,  // Generic how-to
        /fix\s+(it|this|that)/i,                       // Fix something unspecified
        /getting\s+(an?\s+)?error/i,                   // Unspecified error
        /connect\s+to\s+(the\s+)?database/i,           // No context
        /make\s+it\s+(faster|better|work)/i,           // Vague improvement
        /delete.*files.*pattern/i,                     // Destructive needs clarification first
        /write.*script.*delete/i,                      // Destructive script needs context
      ],

      // Patterns that indicate FALSE PREMISE
      falsePremises: [
        { pattern: /javascript.*doesn't\s+have\s+classes/i, correction: 'JavaScript has classes since ES6' },
        { pattern: /python.*statically\s+typed/i, correction: 'Python is dynamically typed' },
        { pattern: /rest\s+(requires?|needs?)\s+xml/i, correction: 'REST is format-agnostic' },
        { pattern: /nosql.*can't.*join/i, correction: 'Many NoSQL databases support joins' },
        { pattern: /microservices.*always\s+better/i, correction: 'Architecture depends on context' },
      ],

      // Patterns that indicate REFUSE (truly dangerous/impossible)
      shouldRefuse: [
        /password.*plain\s*text/i,
        /store.*credentials.*database/i,
        /rm\s+-rf.*production/i,
        /disable.*security/i,
        /bypass.*authentication/i,
        /sql\s+injection/i,
        /eval\s*\(/i,
        /halting\s+problem/i,                          // Mathematically impossible
        /solve.*undecidable/i,
        /polling.*every\s+\d+\s*ms/i,                  // Anti-pattern, pushback
      ],

      // Patterns that indicate DELEGATE (professional expertise needed)
      shouldDelegate: [
        { pattern: /can\s+i\s+sue|lawsuit|legal\s+action/i, delegate: 'legal' },
        { pattern: /chest\s+pain|heart|symptoms.*days/i, delegate: 'medical' },
        { pattern: /invest.*savings|retirement.*crypto/i, delegate: 'financial' },
        { pattern: /tax.*advice|deduction/i, delegate: 'tax' },
        { pattern: /trillion\s+parameter|cutting\s+edge.*training/i, delegate: 'research' },
        { pattern: /what's\s+the\s+best\s+approach.*training.*model/i, delegate: 'research' },
      ],

      // Patterns indicating CONFLICTING requirements
      conflicting: [
        /maximally?\s+(fast|secure|simple).*and.*maximally?\s+(fast|secure|simple)/i,
        /both.*at\s+the\s+same\s+time/i,
        /\$\d+.*and.*deadline.*week/i,
        /all\s+information.*no\s+scrolling.*mobile/i,  // UI conflicts
        /\d+\s+columns.*mobile/i,                       // Too many columns for mobile
        /minimal.*whitespace.*all.*information/i,
      ],

      // Patterns indicating HIDDEN ASSUMPTIONS
      hiddenAssumptions: [
        { pattern: /counter.*increment/i, assumptions: ['single vs distributed', 'persistence', 'concurrency'] },
        { pattern: /^how\s+should\s+i\s+handle\s+authentication/i, assumptions: ['user type', 'security level', 'session management'] },
        { pattern: /should\s+i\s+use\s+typescript/i, assumptions: ['new vs existing project', 'team experience', 'project lifespan'] },
        { pattern: /best\s+(way|approach|practice)/i, assumptions: ['context', 'constraints', 'scale'] },
      ],

      // Clear technical questions that can be answered directly
      clearQuestions: [
        /implement.*binary\s+search\s+tree/i,
        /what\s+is\s+\d+\s*[\+\-\*\/]\s*\d+/i,         // Math
        /how.*hash\s+passwords.*bcrypt/i,              // Specific technique
        /python\s+list.*duplicates/i,                  // Clear algorithm question
      ],
    };
  }

  /**
   * Analyze user input and decide how to respond
   *
   * @param {string} input - User input
   * @param {Object} context - Conversation context
   * @returns {Decision}
   */
  async analyze(input, context = {}) {
    const startTime = Date.now();

    // Run all detectors
    const falsePremise = this.detectFalsePremise(input);
    const shouldRefuse = this.detectShouldRefuse(input);
    const shouldDelegate = this.detectShouldDelegate(input);
    const needsClarification = this.detectNeedsClarification(input, context);
    const conflicting = this.detectConflicting(input);
    const hiddenAssumptions = this.detectHiddenAssumptions(input);
    const isClearQuestion = this.detectClearQuestion(input);

    // Determine decision (priority order)
    let decision;

    // Clear technical questions bypass other checks
    if (isClearQuestion && !shouldRefuse && !falsePremise) {
      decision = {
        type: DecisionType.ANSWER,
        reason: 'Clear technical question with specific scope',
        confidence: 0.9,
        risks: [],
      };
    } else if (shouldRefuse) {
      decision = {
        type: DecisionType.REFUSE,
        reason: 'Request involves dangerous, insecure, or unethical action',
        confidence: 0.9,
        risks: [shouldRefuse],
        refusal_reason: shouldRefuse,
      };
    } else if (falsePremise) {
      decision = {
        type: DecisionType.CHALLENGE,
        reason: 'User input contains a false premise that should be corrected',
        confidence: 0.85,
        risks: ['User may be building on incorrect assumption'],
        false_premise: falsePremise.pattern,
        correction: falsePremise.correction,
      };
    } else if (conflicting) {
      decision = {
        type: DecisionType.ASK,
        reason: 'Request contains conflicting or impossible requirements',
        confidence: 0.9,
        risks: ['Cannot satisfy all requirements simultaneously'],
        missing_info: ['Which requirement has priority?'],
        conflict_detected: conflicting,
      };
    } else if (shouldDelegate) {
      decision = {
        type: DecisionType.DELEGATE,
        reason: 'Request requires professional expertise',
        confidence: 0.85,
        risks: ['Providing advice outside expertise could be harmful'],
        delegate_to: shouldDelegate,
      };
    } else if (needsClarification.needed) {
      decision = {
        type: DecisionType.ASK,
        reason: needsClarification.reason,
        confidence: 0.8,
        risks: ['May make incorrect assumptions without clarification'],
        missing_info: needsClarification.questions,
      };
    } else if (hiddenAssumptions.length > 0) {
      decision = {
        type: DecisionType.ASK,
        reason: 'Request has hidden assumptions that should be surfaced',
        confidence: 0.7,
        risks: ['Implicit assumptions may lead to wrong solution'],
        missing_info: hiddenAssumptions,
        assumptions_to_surface: hiddenAssumptions,
      };
    } else {
      decision = {
        type: DecisionType.ANSWER,
        reason: 'Request is clear and can be answered directly',
        confidence: 0.8,
        risks: [],
      };
    }

    // Add metadata
    decision.input = input;
    decision.timestamp = Date.now();
    decision.duration_ms = Date.now() - startTime;

    // Audit log
    if (this.auditEnabled) {
      this.logDecision(decision, context);
    }

    logger.debug('DecisionAnalyzer', `Decision: ${decision.type}`, {
      reason: decision.reason,
      confidence: decision.confidence,
    });

    return decision;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DETECTORS
  // ──────────────────────────────────────────────────────────────────────────

  detectFalsePremise(input) {
    for (const { pattern, correction } of this.patterns.falsePremises) {
      if (pattern.test(input)) {
        return { pattern: pattern.toString(), correction };
      }
    }
    return null;
  }

  detectShouldRefuse(input) {
    for (const pattern of this.patterns.shouldRefuse) {
      if (pattern.test(input)) {
        return input.match(pattern)[0];
      }
    }
    return null;
  }

  detectShouldDelegate(input) {
    for (const { pattern, delegate } of this.patterns.shouldDelegate) {
      if (pattern.test(input)) {
        return delegate;
      }
    }
    return null;
  }

  detectNeedsClarification(input, context) {
    const missing = [];
    let reason = '';

    // Check for vague patterns
    for (const pattern of this.patterns.needsClarification) {
      if (pattern.test(input)) {
        // Determine what's missing based on pattern
        if (/database/i.test(input)) {
          missing.push('programming language', 'database type', 'framework');
          reason = 'Database connection requires language and DB type context';
        } else if (/error/i.test(input)) {
          missing.push('error message', 'what you were doing', 'relevant code');
          reason = 'Cannot diagnose error without details';
        } else if (/fix\s+(it|this|that)/i.test(input)) {
          missing.push('what specifically needs fixing', 'current behavior', 'expected behavior');
          reason = 'Fix request needs specific context';
        } else if (/make\s+it.*faster/i.test(input)) {
          missing.push('what "it" refers to', 'current performance', 'target performance');
          reason = 'Performance improvement needs specifics';
        } else {
          missing.push('more specific details');
          reason = 'Request is too vague to answer accurately';
        }
        break;
      }
    }

    // Check if input is very short and lacks context
    if (input.split(/\s+/).length < 5 && !context.history?.length) {
      if (missing.length === 0) {
        missing.push('more context');
        reason = 'Very short input without conversation context';
      }
    }

    return {
      needed: missing.length > 0,
      questions: missing,
      reason,
    };
  }

  detectConflicting(input) {
    for (const pattern of this.patterns.conflicting) {
      if (pattern.test(input)) {
        return input.match(pattern)[0];
      }
    }
    return null;
  }

  detectHiddenAssumptions(input) {
    const assumptions = [];

    for (const { pattern, assumptions: assumptionList } of this.patterns.hiddenAssumptions) {
      if (pattern.test(input)) {
        assumptions.push(...assumptionList);
      }
    }

    return assumptions;
  }

  detectClearQuestion(input) {
    if (!this.patterns.clearQuestions) return false;

    for (const pattern of this.patterns.clearQuestions) {
      if (pattern.test(input)) {
        return true;
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AUDIT
  // ──────────────────────────────────────────────────────────────────────────

  logDecision(decision, context) {
    try {
      auditTrail.log({
        plan_id: context.plan_id || null,
        actor: 'DecisionAnalyzer',
        action: 'DECISION_MADE',
        payload: {
          type: decision.type,
          reason: decision.reason,
          confidence: decision.confidence,
          risks: decision.risks,
          input_preview: decision.input?.substring(0, 100),
        },
      });
    } catch (err) {
      // Audit should not break the flow
      logger.warn('DecisionAnalyzer', `Audit failed: ${err.message}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE STRATEGY
// ════════════════════════════════════════════════════════════════════════════

export class ResponseStrategy {
  /**
   * Generate response strategy based on decision
   *
   * @param {Decision} decision
   * @returns {Object} Strategy for response generation
   */
  static fromDecision(decision) {
    switch (decision.type) {
      case DecisionType.ANSWER:
        return {
          action: 'generate_answer',
          prompt_modifier: null,
          required_elements: [],
        };

      case DecisionType.ASK:
        return {
          action: 'ask_clarification',
          prompt_modifier: 'Before answering, ask for clarification.',
          required_elements: decision.missing_info || [],
          template: `I need some clarification before I can help:\n${
            (decision.missing_info || []).map(q => `- ${q}`).join('\n')
          }`,
        };

      case DecisionType.REFUSE:
        return {
          action: 'refuse_with_alternative',
          prompt_modifier: 'Explain why this is not recommended and suggest a safer alternative.',
          required_elements: ['refusal_reason', 'alternative'],
          template: `I cannot help with that because ${decision.refusal_reason}. Instead, consider...`,
        };

      case DecisionType.CHALLENGE:
        return {
          action: 'challenge_premise',
          prompt_modifier: 'First correct the false assumption, then provide accurate information.',
          required_elements: ['correction', 'accurate_info'],
          template: `Actually, ${decision.correction}. Let me explain...`,
        };

      case DecisionType.DELEGATE:
        return {
          action: 'delegate_to_expert',
          prompt_modifier: 'Acknowledge limits and recommend professional consultation.',
          required_elements: ['disclaimer', 'recommendation'],
          template: `This requires ${decision.delegate_to} expertise. I recommend consulting a professional...`,
        };

      default:
        return {
          action: 'generate_answer',
          prompt_modifier: null,
          required_elements: [],
        };
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DECISION-FIRST PROMPT BUILDER
// ════════════════════════════════════════════════════════════════════════════

export class DecisionPromptBuilder {
  /**
   * Build a decision-first prompt
   */
  static build(userInput, decision, strategy) {
    const parts = [];

    // Decision context
    parts.push(`[DECISION: ${decision.type.toUpperCase()}]`);
    parts.push(`Reason: ${decision.reason}`);

    if (decision.risks.length > 0) {
      parts.push(`Risks: ${decision.risks.join(', ')}`);
    }

    // Strategy instruction
    if (strategy.prompt_modifier) {
      parts.push(`\nInstruction: ${strategy.prompt_modifier}`);
    }

    // Required elements
    if (strategy.required_elements.length > 0) {
      parts.push(`\nMust include: ${strategy.required_elements.join(', ')}`);
    }

    // User input
    parts.push(`\n[USER INPUT]\n${userInput}`);

    return parts.join('\n');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DECISION VALIDATOR
// ════════════════════════════════════════════════════════════════════════════

export class DecisionValidator {
  /**
   * Validate that a response matches its decision
   */
  static validate(response, decision, strategy) {
    const content = typeof response === 'string' ? response : response.content || '';
    const issues = [];

    switch (decision.type) {
      case DecisionType.ASK:
        // Must contain questions
        if (!content.includes('?')) {
          issues.push('ASK decision but no questions in response');
        }
        // Should mention missing info
        for (const info of decision.missing_info || []) {
          const keywords = info.toLowerCase().split(/\s+/).filter(w => w.length > 3);
          const found = keywords.some(kw => content.toLowerCase().includes(kw));
          if (!found) {
            issues.push(`Missing question about: ${info}`);
          }
        }
        break;

      case DecisionType.REFUSE:
        // Must explain why
        if (!/cannot|shouldn't|won't|not recommended|dangerous|unsafe/i.test(content)) {
          issues.push('REFUSE decision but no refusal language');
        }
        // Should offer alternative
        if (!/instead|alternative|consider|recommend/i.test(content)) {
          issues.push('REFUSE decision but no alternative offered');
        }
        break;

      case DecisionType.CHALLENGE:
        // Must contain correction
        if (!/actually|however|in fact|contrary|not (quite |entirely )?(correct|accurate|true)/i.test(content)) {
          issues.push('CHALLENGE decision but no challenge language');
        }
        break;

      case DecisionType.DELEGATE:
        // Must contain disclaimer
        if (!/not (legal|medical|financial|tax) advice|consult|professional/i.test(content)) {
          issues.push('DELEGATE decision but no disclaimer');
        }
        break;
    }

    return {
      valid: issues.length === 0,
      issues,
      decision_type: decision.type,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

// Singleton analyzer
export const decisionAnalyzer = new DecisionAnalyzer();

export default {
  DecisionType,
  DecisionAnalyzer,
  ResponseStrategy,
  DecisionPromptBuilder,
  DecisionValidator,
  decisionAnalyzer,
};
