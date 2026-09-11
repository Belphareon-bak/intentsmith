// Lifecycle SPEC Phase — Specification Creation & Validation
// ══════════════════════════════════════════════════════════════════════════════
// SPEC → SPEC_REVIEW flow:
//   1. User describes project → D1 generates clarifying questions
//   2. User answers → D1 generates structured spec
//   3. Spec validation (mandatory: 3 goals, 5 reqs, tech_stack, risks)
//   4. User reviews → approve or revise
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callLLM, callSpecDocumentLLM, parseJSON } from './workflow.js';
import { lifecycles as lifecycleRepo } from '../db/database.js';
import { specAnalyze, specDocument } from './lifecycle-prompts.js';
import { ProjectPhase } from './lifecycle.js';
import { logSpecScore } from './quality-telemetry.js';
import { formatProjectLearningContextForPlanner } from '../code-intel/project-learning-context.js';

const LEARNED_PATTERN_STATUSES = new Set(['conformed', 'conflict_explicit']);

// Bound only the newly accumulated prior-answer prefix; the original single
// answer and first-call prompt remain unchanged. This is a UTF-8 growth limit,
// not an estimate of model tokens or permission to exceed its context profile.
const MAX_PRIOR_CLARIFICATION_BYTES = 8 * 1024;
const MAX_PRIOR_REVIEW_FEEDBACK_BYTES = 8 * 1024;
const SPEC_INTERNAL_FIELDS = new Set([
  '_phase', '_request', '_assessment', '_questions', '_technicalDecisions',
  '_implicitAssumptions', '_learnedPatternConformance', '_clarificationAnswers',
  '_validation', '_previousSpec', '_reviewFeedback',
]);

function publicSpec(spec) {
  return Object.fromEntries(Object.entries(spec).filter(([key]) => !SPEC_INTERNAL_FIELDS.has(key)));
}

function reviewFeedbackContext(spec, feedback) {
  const previous = spec._reviewFeedback ?? [];
  if (!Array.isArray(previous) || previous.some(value => typeof value !== 'string')) {
    throw specDraftError('SPEC_REVIEW_HISTORY_INVALID', 'Stored specification review feedback is invalid.');
  }
  const current = typeof feedback === 'string' ? feedback : String(JSON.stringify(feedback, null, 2));
  const history = previous.at(-1) === current ? [...previous] : [...previous, current];
  const prior = history.slice(0, -1).map(value => value + '\n\n').join('');
  if (Buffer.byteLength(prior, 'utf8') > MAX_PRIOR_REVIEW_FEEDBACK_BYTES) {
    throw specDraftError(
      'SPEC_REVIEW_FEEDBACK_BUDGET_EXCEEDED',
      'Specification review history exceeds its retained-context budget; no feedback was discarded or submitted.',
    );
  }
  return { history, text: prior + current };
}

function revisionRequest(request, feedback, previousSpec) {
  return `${request}\n\nUser feedback on spec: ${feedback}\n\nPrevious spec: ${JSON.stringify(previousSpec)}`;
}

function requestForSpecDraft(draft) {
  if (draft._reviewFeedback === undefined) return draft._request;
  if (!Array.isArray(draft._reviewFeedback) || draft._reviewFeedback.length === 0
      || !draft._previousSpec || typeof draft._previousSpec !== 'object' || Array.isArray(draft._previousSpec)) {
    throw specDraftError('SPEC_REVIEW_HISTORY_INVALID', 'Stored specification review context is invalid.');
  }
  const feedback = reviewFeedbackContext(draft, draft._reviewFeedback.at(-1));
  return revisionRequest(draft._request, feedback.text, publicSpec(draft._previousSpec));
}

function specDraftError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clarificationContext(draft, answers) {
  const previous = draft._clarificationAnswers ?? [];
  if (!Array.isArray(previous) || previous.some(answer => typeof answer !== 'string')) {
    throw specDraftError('SPEC_CLARIFICATION_HISTORY_INVALID', 'Stored specification answers are invalid.');
  }
  const current = typeof answers === 'string' ? answers : String(JSON.stringify(answers, null, 2));
  const history = previous.at(-1) === current ? [...previous] : [...previous, current];
  const prior = history.slice(0, -1).map(answer => answer + '\n\n').join('');
  if (Buffer.byteLength(prior, 'utf8') > MAX_PRIOR_CLARIFICATION_BYTES) {
    throw specDraftError(
      'SPEC_CLARIFICATION_BUDGET_EXCEEDED',
      'Specification answer history exceeds its retained-context budget; no answer was discarded or submitted.',
    );
  }
  return { history, text: prior + current };
}

function replaceSpecDraft(lifecycleId, value, expectedSpec, phase = ProjectPhase.SPEC) {
  const serialized = JSON.stringify(value);
  const statement = phase === ProjectPhase.SPEC_REVIEW
    ? lifecycleRepo.updateReviewSpecIfCurrent
    : lifecycleRepo.updateSpecIfCurrent;
  const result = statement.run(serialized, lifecycleId, expectedSpec);
  if (result.changes !== 1) {
    throw specDraftError('SPEC_DRAFT_STALE', 'Specification draft changed while preparing its response.');
  }
  return serialized;
}

function validateLearnedPatternConformance(value, projectLearningContext) {
  const entries = value === undefined ? [] : value;
  if (!Array.isArray(entries)) {
    throw new TypeError('lifecycle-spec:learned-pattern-conformance-not-array');
  }
  const expectedItems = projectLearningContext?.items ?? [];
  if (expectedItems.length === 0) {
    if (entries.length !== 0) {
      throw new TypeError('lifecycle-spec:unexpected-learned-pattern-conformance');
    }
    return [];
  }
  if (entries.length !== expectedItems.length) {
    throw new TypeError('lifecycle-spec:incomplete-learned-pattern-conformance');
  }
  const expectedById = new Map(expectedItems.map(item => [item.itemId, item]));
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('lifecycle-spec:invalid-learned-pattern-conformance-entry');
    }
    const keys = Object.keys(entry).sort().join(',');
    if (keys !== 'explanation,item_id,item_version,key,status') {
      throw new TypeError('lifecycle-spec:invalid-learned-pattern-conformance-fields');
    }
    const expected = expectedById.get(entry.item_id);
    if (
      !expected
      || seen.has(entry.item_id)
      || entry.item_version !== expected.itemVersion
      || entry.key !== expected.key
    ) throw new TypeError('lifecycle-spec:learned-pattern-conformance-item-mismatch');
    if (!LEARNED_PATTERN_STATUSES.has(entry.status)) {
      throw new TypeError('lifecycle-spec:invalid-learned-pattern-conformance-status');
    }
    if (
      typeof entry.explanation !== 'string'
      || entry.explanation.trim() === ''
      || entry.explanation.length > 4096
    ) throw new TypeError('lifecycle-spec:invalid-learned-pattern-conformance-explanation');
    seen.add(entry.item_id);
  }
  return structuredClone(entries);
}

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

  // Goals: minimum 3, each with success_criteria
  if (!Array.isArray(spec.goals) || spec.goals.length < 3) {
    errors.push(`Goals: minimum 3 required, got ${spec.goals?.length || 0}`);
  } else {
    for (const goal of spec.goals) {
      if (!goal.id || !goal.description) {
        errors.push(`Goal missing id or description: ${JSON.stringify(goal)}`);
      }
      if (!goal.success_criteria || typeof goal.success_criteria !== 'string' || goal.success_criteria.trim().length === 0) {
        errors.push(`Goal ${goal.id || '?'} missing success_criteria`);
      }
    }
  }

  // Requirements: minimum 5 functional + minimum 3 non-functional
  // Supports both flat array (legacy) and structured object format
  const funcReqs = Array.isArray(spec.requirements)
    ? spec.requirements
    : (spec.requirements?.functional || []);
  const nfReqs = spec.requirements?.non_functional || [];

  if (funcReqs.length < 5) {
    errors.push(`Functional requirements: minimum 5 required, got ${funcReqs.length}`);
  } else {
    for (const req of funcReqs) {
      if (!req.id || !req.description) {
        errors.push(`Requirement missing id or description: ${JSON.stringify(req)}`);
      }
      if (!req.acceptance_test || typeof req.acceptance_test !== 'string' || req.acceptance_test.trim().length === 0) {
        errors.push(`Requirement ${req.id || '?'} missing acceptance_test`);
      }
    }
  }

  if (!Array.isArray(spec.requirements) && nfReqs.length < 1) {
    errors.push(`Non-functional requirements: minimum 1 required, got ${nfReqs.length}`);
  }

  // Non-functional requirements: each must have a measurable metric
  if (!Array.isArray(spec.requirements) && nfReqs.length > 0) {
    for (const nf of nfReqs) {
      if (!nf.metric || typeof nf.metric !== 'string' || nf.metric.trim().length === 0) {
        errors.push(`Non-functional requirement ${nf.id || '?'} missing measurable metric`);
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

  // Risks: minimum 3 (upgraded from 1)
  if (!Array.isArray(spec.risks) || spec.risks.length < 1) {
    errors.push(`Risks: minimum 1 required, got ${spec.risks?.length || 0}`);
  }

  // Design decisions: minimum 1 required, each with rationale + alternatives
  if (!Array.isArray(spec.design_decisions) || spec.design_decisions.length < 1) {
    errors.push(`Design decisions: minimum 1 required, got ${spec.design_decisions?.length || 0}`);
  } else {
    for (const dd of spec.design_decisions) {
      if (dd.decision && !dd.rationale) {
        errors.push(`Design decision "${dd.decision}" missing rationale`);
      }
      if (!Array.isArray(dd.alternatives_considered) || dd.alternatives_considered.length < 2) {
        errors.push(`Design decision "${dd.decision || dd.id || '?'}" missing alternatives_considered (minimum 2)`);
      }
    }
  }

  // Acceptance criteria: project-level done conditions
  if (!Array.isArray(spec.acceptance_criteria) || spec.acceptance_criteria.length < 1) {
    errors.push(`Acceptance criteria: minimum 1 required, got ${spec.acceptance_criteria?.length || 0}`);
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
  const learnedProjectContext = context.projectLearningContext
    ? formatProjectLearningContextForPlanner(context.projectLearningContext)
    : '';
  const prompt = specAnalyze(request, projectContext, learnedProjectContext);

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt, '', { format: 'json' });
  const parsed = parseJSON(result.content);

  if (!parsed) {
    throw new Error('D1 failed to produce structured spec analysis');
  }
  const learnedPatternConformance = validateLearnedPatternConformance(
    parsed.learned_pattern_conformance,
    context.projectLearningContext,
  );

  // Store initial assessment in lifecycle (including technical decisions)
  const specDraft = {
    _phase: 'ANALYZING',
    _request: request,
    _assessment: parsed.initial_assessment || {},
    _questions: parsed.clarifying_questions || [],
    _technicalDecisions: parsed.technical_decisions || [],
    _implicitAssumptions: parsed.implicit_assumptions || [],
    _learnedPatternConformance: learnedPatternConformance,
  };

  lifecycleRepo.updateSpec.run(JSON.stringify(specDraft), lifecycle.id);

  return {
    questions: parsed.clarifying_questions || [],
    assessment: parsed.initial_assessment || {},
    technicalDecisions: parsed.technical_decisions || [],
    implicitAssumptions: parsed.implicit_assumptions || [],
    coreGoal: parsed.core_goal || request,
    learnedPatternConformance,
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

  // Read one exact lifecycle-local draft. Persist this user answer before the
  // asynchronous model call so parse/transport failure cannot erase it.
  const row = lifecycleRepo.findById.get(lifecycle.id);
  let draft;
  try { draft = JSON.parse(row?.spec); } catch { draft = null; }
  if (!draft || typeof draft._request !== 'string'
      || (!draft._request && draft._reviewFeedback === undefined)) {
    throw new Error('No spec draft found — call startSpec first');
  }
  const clarification = clarificationContext(draft, answers);
  const pendingSpec = replaceSpecDraft(
    lifecycle.id,
    { ...draft, _clarificationAnswers: clarification.history },
    row.spec,
  );

  // Generate structured spec from request + answers + assessment (including technical decisions)
  const fullAssessment = {
    ...draft._assessment,
    technical_decisions: draft._technicalDecisions || [],
    implicit_assumptions: draft._implicitAssumptions || [],
  };
  const prompt = specDocument(requestForSpecDraft(draft), clarification.text, fullAssessment);
  const llm = lifecycle.callLLM || callSpecDocumentLLM;
  const result = await llm('D1', prompt, '', { format: 'json' });
  if (lifecycleRepo.findById.get(lifecycle.id)?.spec !== pendingSpec) {
    throw specDraftError('SPEC_DRAFT_STALE', 'Specification draft changed while waiting for its response.');
  }
  if (result.finishReason === 'length') {
    throw specDraftError('SPEC_DOCUMENT_TRUNCATED', 'D1 exhausted the complete specification output budget.');
  }
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
    // Preserve the original draft context; model output cannot replace these
    // fields when a validation failure requires another clarification turn.
    const enrichedSpec = {
      ...spec,
      _request: draft._request,
      _assessment: draft._assessment,
      _questions: draft._questions,
      _technicalDecisions: draft._technicalDecisions,
      _implicitAssumptions: draft._implicitAssumptions,
      _learnedPatternConformance: draft._learnedPatternConformance,
      _clarificationAnswers: clarification.history,
      _previousSpec: draft._previousSpec,
      _reviewFeedback: draft._reviewFeedback,
      _validation: validation,
      _phase: 'VALIDATION_FAILED',
    };
    replaceSpecDraft(lifecycle.id, enrichedSpec, pendingSpec);

    return {
      spec,
      needsMore: true,
      validationErrors: validation.errors,
    };
  }

  // Valid spec — replace only the draft used for this exact generation.
  replaceSpecDraft(lifecycle.id, {
    ...publicSpec(spec),
    _request: draft._request,
    _learnedPatternConformance: draft._learnedPatternConformance ?? [],
  }, pendingSpec);

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
  if (spec?._reviewFeedback !== undefined) {
    if (!Array.isArray(spec._reviewFeedback) || spec._reviewFeedback.length > 0) {
      throw specDraftError('SPEC_REVIEW_PENDING', 'Pending specification feedback must be resolved before approval.');
    }
  }
  const validation = validateSpec(spec);

  if (!validation.valid) {
    throw new Error(`Cannot approve invalid spec: ${validation.errors.join(', ')}`);
  }

  // Quality telemetry — observational, never blocks
  logSpecScore(lifecycle.id, spec);

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

  const row = lifecycleRepo.findById.get(lifecycle.id);
  let currentSpec;
  try { currentSpec = JSON.parse(row?.spec); } catch { currentSpec = null; }
  if (!currentSpec || typeof currentSpec !== 'object' || Array.isArray(currentSpec)) {
    throw specDraftError('SPEC_REVIEW_DRAFT_INVALID', 'No valid specification exists for review.');
  }
  const request = typeof currentSpec._request === 'string' ? currentSpec._request : '';
  const retained = reviewFeedbackContext(currentSpec, feedback);
  const previousSpec = publicSpec(currentSpec);
  const pendingSpec = replaceSpecDraft(lifecycle.id, {
    ...currentSpec,
    _request: request,
    _reviewFeedback: retained.history,
  }, row.spec, ProjectPhase.SPEC_REVIEW);

  // Retain feedback before the model call; render only the actual public spec.
  const enrichedRequest = revisionRequest(request, retained.text, previousSpec);
  const prompt = specAnalyze(enrichedRequest, '');
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt, '', { format: 'json' });
  const parsed = parseJSON(result.content);

  if (!parsed) {
    throw new Error('D1 failed to produce revised analysis');
  }

  // Update draft
  const specDraft = {
    _phase: 'REVISING',
    _request: request,
    _assessment: parsed.initial_assessment || {},
    _questions: parsed.clarifying_questions || [],
    _technicalDecisions: parsed.technical_decisions || [],
    _implicitAssumptions: parsed.implicit_assumptions || [],
    _learnedPatternConformance: currentSpec._learnedPatternConformance ?? [],
    _previousSpec: previousSpec,
    _reviewFeedback: retained.history,
  };
  replaceSpecDraft(lifecycle.id, specDraft, pendingSpec, ProjectPhase.SPEC_REVIEW);

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
