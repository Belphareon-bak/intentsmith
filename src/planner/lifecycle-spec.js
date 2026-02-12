// Lifecycle SPEC Phase — Specification Creation & Validation
// ══════════════════════════════════════════════════════════════════════════════
// SPEC → SPEC_REVIEW flow:
//   1. User describes project → D1 generates clarifying questions
//   2. User answers → D1 generates structured spec
//   3. Spec validation (mandatory: 3 goals, 5 reqs, tech_stack, risks)
//   4. User reviews → approve or revise
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callLLM, parseJSON } from './workflow.js';
import { lifecycles as lifecycleRepo } from '../db/database.js';
import { specAnalyze, specDocument } from './lifecycle-prompts.js';
import { ProjectPhase } from './lifecycle.js';

// ─── Spec Validation ─────────────────────────────────────────────────────────

/**
 * Validate a spec against mandatory requirements.
 * @param {Object} spec
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSpec(spec) {
  const errors = [];

  if (!spec) {
    return { valid: false, errors: ['Spec is null or undefined'] };
  }

  // Title
  if (!spec.title || typeof spec.title !== 'string' || spec.title.trim().length === 0) {
    errors.push('Missing or empty title');
  }

  // Goals: minimum 3
  if (!Array.isArray(spec.goals) || spec.goals.length < 3) {
    errors.push(`Goals: minimum 3 required, got ${spec.goals?.length || 0}`);
  } else {
    for (const goal of spec.goals) {
      if (!goal.id || !goal.description) {
        errors.push(`Goal missing id or description: ${JSON.stringify(goal)}`);
      }
    }
  }

  // Requirements: minimum 5
  if (!Array.isArray(spec.requirements) || spec.requirements.length < 5) {
    errors.push(`Requirements: minimum 5 required, got ${spec.requirements?.length || 0}`);
  } else {
    for (const req of spec.requirements) {
      if (!req.id || !req.description) {
        errors.push(`Requirement missing id or description: ${JSON.stringify(req)}`);
      }
    }
  }

  // Tech stack: mandatory
  if (!spec.tech_stack) {
    errors.push('Missing tech_stack section');
  } else {
    if (!spec.tech_stack.languages || spec.tech_stack.languages.length === 0) {
      errors.push('tech_stack.languages is empty');
    }
  }

  // Risks: minimum 1
  if (!Array.isArray(spec.risks) || spec.risks.length < 1) {
    errors.push(`Risks: minimum 1 required, got ${spec.risks?.length || 0}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── SPEC Phase Operations ───────────────────────────────────────────────────

/**
 * Start the SPEC phase — generate clarifying questions from user request.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} request - User's project description
 * @param {Object} [context] - Additional context (project memory, etc.)
 * @returns {Promise<{ questions: string[], assessment: Object }>}
 */
export async function startSpec(lifecycle, request, context = {}) {
  logger.info('LifecycleSpec', 'Starting SPEC phase', { lifecycleId: lifecycle.id });

  const projectContext = context.projectContext || '';
  const prompt = specAnalyze(request, projectContext);

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const parsed = parseJSON(result.content);

  if (!parsed) {
    throw new Error('D1 failed to produce structured spec analysis');
  }

  // Store initial assessment in lifecycle
  const specDraft = {
    _phase: 'ANALYZING',
    _request: request,
    _assessment: parsed.initial_assessment || {},
    _questions: parsed.clarifying_questions || [],
  };

  lifecycleRepo.updateSpec.run(JSON.stringify(specDraft), lifecycle.id);

  return {
    questions: parsed.clarifying_questions || [],
    assessment: parsed.initial_assessment || {},
    coreGoal: parsed.core_goal || request,
  };
}

/**
 * Process user's answers to clarifying questions → generate spec.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} answers - User's answers (free text)
 * @returns {Promise<{ spec?: Object, questions?: string[], needsMore: boolean }>}
 */
export async function answerSpecQuestions(lifecycle, answers) {
  logger.info('LifecycleSpec', 'Processing spec answers', { lifecycleId: lifecycle.id });

  // Retrieve stored draft
  const draft = lifecycleRepo.getSpec(lifecycle.id);
  if (!draft || !draft._request) {
    throw new Error('No spec draft found — call startSpec first');
  }

  // Generate structured spec from request + answers + assessment
  const prompt = specDocument(draft._request, answers, draft._assessment);
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const spec = parseJSON(result.content);

  if (!spec) {
    throw new Error('D1 failed to produce structured spec document');
  }

  // Validate
  const validation = validateSpec(spec);

  if (!validation.valid) {
    logger.warn('LifecycleSpec', 'Generated spec failed validation', {
      lifecycleId: lifecycle.id,
      errors: validation.errors,
    });

    // Store invalid spec for reference but report issues
    const enrichedSpec = {
      ...spec,
      _validation: validation,
      _phase: 'VALIDATION_FAILED',
    };
    lifecycleRepo.updateSpec.run(JSON.stringify(enrichedSpec), lifecycle.id);

    return {
      spec,
      needsMore: true,
      validationErrors: validation.errors,
    };
  }

  // Valid spec — store it
  lifecycleRepo.updateSpec.run(JSON.stringify(spec), lifecycle.id);

  return {
    spec,
    needsMore: false,
    validationErrors: [],
  };
}

/**
 * Approve the spec → transition to PLANNING.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @returns {Promise<void>}
 */
export async function approveSpec(lifecycle) {
  const spec = lifecycleRepo.getSpec(lifecycle.id);
  const validation = validateSpec(spec);

  if (!validation.valid) {
    throw new Error(`Cannot approve invalid spec: ${validation.errors.join(', ')}`);
  }

  await lifecycle.transitionTo(ProjectPhase.PLANNING);
  logger.info('LifecycleSpec', 'Spec approved, transitioning to PLANNING', {
    lifecycleId: lifecycle.id,
  });
}

/**
 * Revise spec — user provides feedback, spec phase restarts.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} feedback - User's revision feedback
 * @returns {Promise<{ questions: string[] }>}
 */
export async function reviseSpec(lifecycle, feedback) {
  logger.info('LifecycleSpec', 'Spec revision requested', { lifecycleId: lifecycle.id });

  const currentSpec = lifecycleRepo.getSpec(lifecycle.id);
  const request = currentSpec?._request || '';

  // Re-analyze with feedback incorporated
  const enrichedRequest = `${request}\n\nUser feedback on spec: ${feedback}\n\nPrevious spec: ${JSON.stringify(currentSpec)}`;
  const prompt = specAnalyze(enrichedRequest, '');
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const parsed = parseJSON(result.content);

  if (!parsed) {
    throw new Error('D1 failed to produce revised analysis');
  }

  // Update draft
  const specDraft = {
    _phase: 'REVISING',
    _request: enrichedRequest,
    _assessment: parsed.initial_assessment || {},
    _questions: parsed.clarifying_questions || [],
    _previousSpec: currentSpec,
  };
  lifecycleRepo.updateSpec.run(JSON.stringify(specDraft), lifecycle.id);

  // Ensure phase is SPEC (may have been in SPEC_REVIEW)
  if (lifecycle.phase === ProjectPhase.SPEC_REVIEW) {
    await lifecycle.transitionTo(ProjectPhase.SPEC);
  }

  return {
    questions: parsed.clarifying_questions || [],
    assessment: parsed.initial_assessment || {},
  };
}

export default {
  validateSpec,
  startSpec,
  answerSpecQuestions,
  approveSpec,
  reviseSpec,
};
