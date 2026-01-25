// CRE v38.3 LLM Reflector
// ══════════════════════════════════════════════════════════════════════════════
//
// OPTIONAL LLM-based reflection for complex failures.
// Used AFTER DeterministicReflector when:
//   1. LLM reflection is enabled (via LLMGate)
//   2. Deterministic reflection returned FAIL
//   3. Error seems analyzable
//
// Key principles:
//   ❌ LLM NEVER changes plan directly
//   ✅ LLM returns ADVISORY ONLY
//   ✅ LLM is a TOOL, not an authority
//   ✅ All LLM calls are AUDITED
//   ✅ LLM is GLOBALLY DISABLEABLE
//
// Flow:
//   Step fails → DeterministicReflector → FAIL
//   → LLMReflector.analyze(step, plan, context)
//   → { recommendation, confidence, reasoning }
//   → Upstream decides whether to apply
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { llmGate, LLMAuthLevel } from '../gates/llm-gate.js';
import { llmGateway } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole, LLMCapability } from '../llm/auth-types.js';
import { ReflectionAction } from './reflection.js';
import { StepStatus } from './types.js';

// ════════════════════════════════════════════════════════════════════════════
// RECOMMENDATION TYPES
// ════════════════════════════════════════════════════════════════════════════

export const RecommendationType = {
  RETRY_WITH_CHANGES: 'RETRY_WITH_CHANGES',   // Retry with modified params
  SKIP_AND_CONTINUE: 'SKIP_AND_CONTINUE',     // Skip this step, continue plan
  ADD_PREREQUISITE: 'ADD_PREREQUISITE',       // Add a step before this one
  REPLACE_TOOL: 'REPLACE_TOOL',               // Use different tool
  ASK_USER_SPECIFIC: 'ASK_USER_SPECIFIC',     // Ask user specific question
  ABORT_PLAN: 'ABORT_PLAN',                   // Recommend aborting plan
  NO_RECOMMENDATION: 'NO_RECOMMENDATION',     // No useful recommendation
};

// ════════════════════════════════════════════════════════════════════════════
// LLM RECOMMENDATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} LLMRecommendation
 * @property {string} type - RecommendationType
 * @property {number} confidence - 0.0 to 1.0
 * @property {string} reasoning - Why this recommendation
 * @property {Object} [details] - Type-specific details
 * @property {boolean} advisory - Always true (LLM is advisory only)
 */

// ════════════════════════════════════════════════════════════════════════════
// LLM REFLECTOR
// ════════════════════════════════════════════════════════════════════════════

export class LLMReflector {
  constructor(options = {}) {
    this.gate = options.gate || llmGate;
    this.gateway = options.gateway || llmGateway;
    this.sessionId = options.sessionId || `session_${Date.now()}`;

    // Minimum confidence to return recommendation
    this.minConfidence = options.minConfidence || 0.6;

    // Stats
    this.stats = {
      calls: 0,
      blocked: 0,
      recommendations: 0,
      noRecommendation: 0,
    };
  }

  /**
   * Analyze a failed step and return advisory recommendation
   *
   * @param {Step} step - The failed step
   * @param {Plan} plan - The plan context
   * @param {Object} context - Additional context
   * @returns {Promise<{ ok: boolean, recommendation?: LLMRecommendation, error?: string, needsApproval?: boolean, question?: Object }>}
   */
  async analyze(step, plan, context = {}) {
    // 1. Check LLM Gate authorization
    const gateCheck = this.gate.check({
      planId: plan.id,
      stepId: step.id,
      reason: `Analyzing failure: ${step.error}`,
    });

    if (!gateCheck.authorized) {
      if (gateCheck.needsApproval) {
        // Return approval question to upstream
        return {
          ok: false,
          needsApproval: true,
          question: gateCheck.question,
        };
      }
      // Blocked (disabled or rate limited)
      this.stats.blocked++;
      logger.debug('LLMReflector', `Blocked: ${gateCheck.reason}`);
      return { ok: false, error: gateCheck.reason };
    }

    // 2. Record the call
    this.gate.recordCall(plan.id);
    this.stats.calls++;

    // 3. Build analysis prompt
    const prompt = this.buildAnalysisPrompt(step, plan, context);

    // 4. Call LLM via gateway with proper auth
    const token = createAuthToken({
      role: LLMCallerRole.REFLECTOR,
      decisionId: `reflect_${step.id}_${Date.now()}`,
      auditContext: {
        sessionId: this.sessionId,
        goalId: plan.id,
        stepId: step.id,
      },
    });

    try {
      this.gateway.authorize(token);

      const result = await this.gateway.call(prompt, {
        systemPrompt: this.getSystemPrompt(),
        temperature: 0.3,
        maxTokens: 1500,
        capability: LLMCapability.REASONING,
        format: 'json',
      });

      this.gateway.revoke();

      // 5. Parse recommendation
      const recommendation = this.parseRecommendation(result.content, step);

      if (!recommendation || recommendation.type === RecommendationType.NO_RECOMMENDATION) {
        this.stats.noRecommendation++;
        return {
          ok: true,
          recommendation: {
            type: RecommendationType.NO_RECOMMENDATION,
            confidence: 0,
            reasoning: 'LLM could not provide useful recommendation',
            advisory: true,
          },
        };
      }

      // Check confidence threshold
      if (recommendation.confidence < this.minConfidence) {
        this.stats.noRecommendation++;
        return {
          ok: true,
          recommendation: {
            ...recommendation,
            type: RecommendationType.NO_RECOMMENDATION,
            reasoning: `Low confidence (${recommendation.confidence}): ${recommendation.reasoning}`,
            advisory: true,
          },
        };
      }

      this.stats.recommendations++;
      return { ok: true, recommendation };

    } catch (err) {
      this.gateway.revoke();
      logger.error('LLMReflector', `LLM call failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Get system prompt for reflection
   */
  getSystemPrompt() {
    return `Jsi analytik selhání kroků v plánu. Tvůj úkol je analyzovat, proč krok selhal, a navrhnout řešení.

DŮLEŽITÉ:
- Vrať JSON s doporučením
- Buď konkrétní a praktický
- Uveď confidence (0.0-1.0) podle jistoty
- Nikdy nedoporučuj něco, co by mohlo způsobit ztrátu dat

Formát odpovědi:
{
  "type": "RETRY_WITH_CHANGES|SKIP_AND_CONTINUE|ADD_PREREQUISITE|REPLACE_TOOL|ASK_USER_SPECIFIC|ABORT_PLAN|NO_RECOMMENDATION",
  "confidence": 0.0-1.0,
  "reasoning": "Proč toto doporučuješ",
  "details": {
    // Specifické detaily podle typu
    // Pro RETRY_WITH_CHANGES: { "paramChanges": { ... } }
    // Pro ADD_PREREQUISITE: { "newStep": { "tool": "...", "params": {...} } }
    // Pro REPLACE_TOOL: { "alternativeTool": "...", "params": {...} }
    // Pro ASK_USER_SPECIFIC: { "question": "..." }
  }
}`;
  }

  /**
   * Build analysis prompt from step and plan context
   */
  buildAnalysisPrompt(step, plan, context) {
    // Get recent completed steps for context
    const recentSteps = plan.steps
      .filter(s => s.status === StepStatus.COMPLETED)
      .slice(-3)
      .map(s => ({
        id: s.id,
        tool: s.tool,
        success: true,
      }));

    // Get failed step's dependencies
    const depResults = step.dependsOn.map(depId => ({
      id: depId,
      result: plan.results[depId] ? 'success' : 'unknown',
    }));

    return `Analyzuj selhání tohoto kroku:

KROK:
- ID: ${step.id}
- Nástroj: ${step.tool}
- Parametry: ${JSON.stringify(step.params, null, 2)}
- Chyba: ${step.error}
- Kód chyby: ${step.errorCode || 'UNKNOWN'}
- Počet pokusů: ${step.attempts}

CÍL PLÁNU: ${plan.goal}

ZÁVISLOSTI:
${depResults.length > 0 ? JSON.stringify(depResults, null, 2) : 'Žádné'}

NEDÁVNÉ ÚSPĚŠNÉ KROKY:
${recentSteps.length > 0 ? JSON.stringify(recentSteps, null, 2) : 'Žádné'}

${context.additionalContext ? `DALŠÍ KONTEXT: ${context.additionalContext}` : ''}

Analyzuj příčinu selhání a navrhni řešení.`;
  }

  /**
   * Parse LLM response into recommendation
   */
  parseRecommendation(content, step) {
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('LLMReflector', 'No JSON found in LLM response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate type
      if (!parsed.type || !Object.values(RecommendationType).includes(parsed.type)) {
        parsed.type = RecommendationType.NO_RECOMMENDATION;
      }

      // Ensure confidence is valid
      const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

      return {
        type: parsed.type,
        confidence,
        reasoning: parsed.reasoning || 'No reasoning provided',
        details: parsed.details || {},
        advisory: true, // ALWAYS advisory
        stepId: step.id,
        timestamp: Date.now(),
      };

    } catch (err) {
      logger.warn('LLMReflector', `Failed to parse LLM response: ${err.message}`);
      return null;
    }
  }

  /**
   * Convert LLM recommendation to reflection action (for runner integration)
   * This is a SUGGESTION only — runner decides whether to apply
   */
  toReflectionAction(recommendation) {
    if (!recommendation || recommendation.type === RecommendationType.NO_RECOMMENDATION) {
      return null; // Let deterministic reflector decide
    }

    switch (recommendation.type) {
      case RecommendationType.RETRY_WITH_CHANGES:
        return {
          action: ReflectionAction.RETRY,
          reason: `LLM advisory: ${recommendation.reasoning}`,
          paramChanges: recommendation.details?.paramChanges,
          confidence: recommendation.confidence,
          source: 'llm_advisory',
        };

      case RecommendationType.SKIP_AND_CONTINUE:
        return {
          action: ReflectionAction.SKIP,
          reason: `LLM advisory: ${recommendation.reasoning}`,
          confidence: recommendation.confidence,
          source: 'llm_advisory',
        };

      case RecommendationType.ASK_USER_SPECIFIC:
        return {
          action: ReflectionAction.ASK_USER,
          reason: `LLM advisory: ${recommendation.reasoning}`,
          question: {
            type: 'LLM_SUGGESTED',
            message: recommendation.details?.question || recommendation.reasoning,
            stepId: recommendation.stepId,
          },
          confidence: recommendation.confidence,
          source: 'llm_advisory',
        };

      case RecommendationType.ABORT_PLAN:
        return {
          action: ReflectionAction.FAIL,
          reason: `LLM advisory (abort): ${recommendation.reasoning}`,
          confidence: recommendation.confidence,
          source: 'llm_advisory',
        };

      default:
        return null;
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      gate: this.gate.getStats(),
    };
  }

  /**
   * Reset stats
   */
  reset() {
    this.stats = {
      calls: 0,
      blocked: 0,
      recommendations: 0,
      noRecommendation: 0,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLETON
// ════════════════════════════════════════════════════════════════════════════

export const llmReflector = new LLMReflector();

export default LLMReflector;
