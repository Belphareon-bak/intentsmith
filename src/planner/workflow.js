// Planner Workflow — D1/CODE/BUILD_VERIFY/R2/D2/R1 Pipeline (v90)
// ══════════════════════════════════════════════════════════════════════════════
//
// WORKFLOW:
//   User Request
//        ↓
//   D1 (deepseek-r1) → Analyze → CLARIFY? → questions back to user
//        ↓ READY
//   D1 → Create Plan → User confirms
//        ↓ OK
//   CODE (qwen3.5:27b) → Implement
//        ↓
//   BUILD_VERIFY → Run build command (deterministic, no LLM)
//        ↓ FAIL (max 3)            ↓ PASS (or no build script → skip)
//   D2 → Diagnose errors           R2 (qwen3.5:27b) → Quick Review
//   CODE → Fix                     ↓ FAIL                    ↓ PASS
//        → BUILD_VERIFY (loop)     D2 → Fix plan     R1 (deepseek-r1) → Final
//                                  CODE → Apply Fix          ↓ FAIL (redesign)
//                                       → R2 (loop)         D1 → Redesign
//                                                             ↓
//                                                            ✅ DONE
//
// PERSISTENCE (v57.1 — Phase C):
//   - Sessions persisted to workflow_sessions DB table after every state change
//   - RAM Map serves as hot cache, DB as durable store
//   - Resume: interactive states (CLARIFYING, AWAITING_APPROVAL) survive restart
//   - Progress: computed from history + plan steps, exposed via getProgress()
//
// RULES:
//   - D1 NEVER executes code
//   - CODE NEVER decides what to build
//   - R2 NEVER fixes (only verdicts)
//   - Each step has one model, one job
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { callWithAuth, callWithPolicy } from '../llm/gateway.js';
import {
  LLMCallerRole,
  LLMCapability,
  LLMOperation,
  OperationTokenLimits,
  createAuthToken,
  createSpecDocumentAuthToken,
} from '../llm/auth-types.js';
import { getProjectContextManager } from './project-context.js';

// ─── Workflow States ────────────────────────────────────────────────────────

export const WorkflowState = Object.freeze({
  IDLE: 'IDLE',
  ANALYZING: 'ANALYZING',           // D1 analyzing request
  CLARIFYING: 'CLARIFYING',         // Waiting for user clarification
  PLANNING: 'PLANNING',             // D1 creating plan
  AWAITING_APPROVAL: 'AWAITING_APPROVAL', // User must approve plan
  IMPLEMENTING: 'IMPLEMENTING',     // CODE implementing
  BUILD_VERIFYING: 'BUILD_VERIFYING', // v90: deterministic build verification
  QUICK_REVIEWING: 'QUICK_REVIEWING', // R2 reviewing
  FIX_DELIBERATING: 'FIX_DELIBERATING', // D2 deliberating fix
  APPLYING_FIX: 'APPLYING_FIX',     // CODE applying fix
  FINAL_REVIEWING: 'FINAL_REVIEWING', // R1 final review
  REDESIGNING: 'REDESIGNING',       // D1 redesigning after R1 fail
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

export const ReviewVerdict = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  REDESIGN: 'REDESIGN',
});

// ─── Workflow Step Result ───────────────────────────────────────────────────

class StepResult {
  constructor({ step, model, output, verdict = null, duration = 0, error = null }) {
    this.step = step;
    this.model = model;
    this.output = output;
    this.verdict = verdict;
    this.duration = duration;
    this.error = error;
    this.timestamp = new Date().toISOString();
  }
}

// ─── Workflow Session ───────────────────────────────────────────────────────

export class WorkflowSession {
  constructor(id, request) {
    this.id = id;
    this.request = request;          // Original user request
    this.state = WorkflowState.IDLE;
    this.plan = null;                // D1's plan
    this.implementation = null;       // CODE's output
    this.history = [];               // All step results
    this.fixAttempts = 0;
    this.redesignAttempts = 0;
    this.clarificationQuestions = null;
    this.projectId = null;           // Phase C: linked project
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    this._onUpdate = null;           // Persistence callback (set by orchestrator)
  }

  transition(newState) {
    const oldState = this.state;
    this.state = newState;
    this.updatedAt = new Date().toISOString();
    // Phase C: timeline events
    if (this.projectId) {
      const projectCtx = getProjectContextManager();
      projectCtx?.addTimelineEvent(this.projectId, `State: ${oldState} → ${newState}`);
    }
    this._onUpdate?.(this);
  }

  addStep(result) {
    this.history.push(result);
    this.updatedAt = new Date().toISOString();
    this._onUpdate?.(this);
  }

  get lastStep() {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }
}

// ─── LLM Call Helper ────────────────────────────────────────────────────────

async function callLLM(role, prompt, systemPrompt = '', options = {}) {
  const modelKey = role; // D1, D2, CODE, R1, R2
  const model = config.models?.[modelKey] || config.models?.CHAT;
  const timeout = config.timeouts?.[modelKey] || 60000;

  // Map workflow roles to auth caller roles
  const callerRoleMap = {
    D1: LLMCallerRole.WORKFLOW_PLANNER,
    D2: LLMCallerRole.WORKFLOW_ANALYZER,
    CODE: LLMCallerRole.WORKFLOW_CODER,
    R1: LLMCallerRole.WORKFLOW_REVIEWER,
    R2: LLMCallerRole.WORKFLOW_REVIEWER,
  };

  const callerRole = callerRoleMap[role] || LLMCallerRole.WORKFLOW_THINKER;
  const token = createAuthToken({
    role: callerRole,
    decisionId: `workflow-${role}-${Date.now()}`,
    auditContext: { sessionId: `workflow-${Date.now()}` },
  });

  const startTime = Date.now();
  try {
    const result = await callWithAuth(token, prompt, {
      systemPrompt,
      model,
      timeout,
      ...options,
    });
    return {
      content: typeof result === 'string' ? result : (result.content || ''),
      model,
      duration: Date.now() - startTime,
      promptEvalCount: result?.promptEvalCount ?? 0,
      evalCount: result?.evalCount ?? 0,
      finishReason: result?.finishReason ?? null,
    };
  } catch (err) {
    logger.error('Workflow', `LLM call failed for ${role}`, { model, error: err.message });
    throw err;
  }
}

/**
 * Decision 043: the operation-bound output exception for a complete SPEC JSON
 * document. Generic callLLM options cannot select this process-local token.
 */
async function callSpecDocumentLLM(role, prompt, systemPrompt = '', options = {}) {
  if (role !== 'D1' || systemPrompt !== '') {
    throw new Error('SPEC_DOCUMENT_OPERATION_INVALID: complete SPEC requires D1 and its fixed system prompt');
  }
  if (
    !options
    || typeof options !== 'object'
    || Array.isArray(options)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  ) {
    throw new Error('SPEC_DOCUMENT_OPERATION_INVALID: options must be a plain object');
  }
  const optionsSnapshot = { ...options };
  const keys = Object.keys(optionsSnapshot);
  if (keys.some(key => !['format', 'maxTokens'].includes(key)) || (optionsSnapshot.format ?? 'json') !== 'json') {
    throw new Error('SPEC_DOCUMENT_OPERATION_INVALID: complete SPEC options are fixed');
  }
  const ceiling = OperationTokenLimits[LLMOperation.WORKFLOW_SPEC_DOCUMENT_JSON_V1];
  const requestedMaxTokens = optionsSnapshot.maxTokens ?? ceiling;
  if (!Number.isSafeInteger(requestedMaxTokens) || requestedMaxTokens < 1 || requestedMaxTokens > ceiling) {
    throw new Error('SPEC_DOCUMENT_TOKEN_LIMIT_INVALID: complete SPEC output must be between 1 and 6000 tokens');
  }

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  const requestId = `workflow-spec-document-${nonce}`;
  const conversationId = `workflow-spec-${nonce}`;
  const turnId = `spec-document-${nonce}`;
  const token = createSpecDocumentAuthToken({
    decisionId: requestId,
    auditContext: { sessionId: conversationId, stepId: turnId },
  });
  const model = config.models?.D1;
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('SPEC_DOCUMENT_MODEL_UNBOUND: D1 has no configured model');
  }
  const timeout = config.timeouts?.D1 || 60000;
  const startTime = Date.now();
  const result = await callWithPolicy(token, prompt, {
    systemPrompt: '',
    model,
    timeout,
    format: 'json',
    maxTokens: requestedMaxTokens,
    capability: LLMCapability.REASONING,
    requestType: 'm1:answer',
    correlation: {
      requestId,
      conversationId,
      turnId,
      callerRole: LLMCallerRole.WORKFLOW_PLANNER,
      modelRole: 'D1',
      purpose: 'answer',
    },
  });
  return {
    content: typeof result === 'string' ? result : (result.content || ''),
    model,
    duration: Date.now() - startTime,
    promptEvalCount: result?.promptEvalCount ?? 0,
    evalCount: result?.evalCount ?? 0,
    finishReason: result?.finishReason ?? null,
  };
}

// ─── Prompt Templates ───────────────────────────────────────────────────────

const PROMPTS = {
  analyze: (request, context) => ({
    system: `You are D1 — a senior technical architect. Your job is to ANALYZE a user's request and determine if you have enough information to create a plan.

RULES:
- If the request is CLEAR enough to plan → respond with JSON: {"status": "READY", "summary": "...", "scope": "...", "complexity": "SIMPLE|MEDIUM|HIGH"}
- If you need more info → respond with JSON: {"status": "CLARIFY", "questions": ["...", "..."]}
- Maximum 3 clarification questions
- Be practical, not academic

Context: ${context ? JSON.stringify(context) : 'none'}`,
    prompt: `Analyze this request:\n\n${request}\n\nRespond ONLY with JSON.`,
  }),

  plan: (request, analysis, context) => ({
    system: `You are D1 — a senior technical architect creating an implementation plan.

RULES:
- Create a CONCRETE, step-by-step plan
- Each step must be independently verifiable
- Include file paths, commands, or code snippets where relevant
- Mark steps that need user approval with "approval: true"
- Output JSON format

Context: ${context ? JSON.stringify(context) : 'none'}
Analysis: ${analysis}`,
    prompt: `Create an implementation plan for:\n\n${request}\n\nRespond with JSON: {"title": "...", "steps": [{"id": 1, "action": "...", "detail": "...", "type": "shell|file|code|config", "approval": false}], "estimatedComplexity": "SIMPLE|MEDIUM|HIGH", "risks": ["..."]}`,
  }),

  implement: (plan, step, context) => ({
    system: `You are CODE — a code implementation specialist. You implement EXACTLY what the plan says.

RULES:
- Follow the plan step EXACTLY
- Do NOT add features not in the plan
- Do NOT skip steps
- Output the actual code/commands/config
- If a step is unclear, output what you CAN do and flag what's unclear
- Output ONLY raw source code. NO markdown fences. NO \`\`\` markers. NO explanations. The output will be written directly to a file.

Plan context: ${JSON.stringify(plan)}`,
    prompt: `Implement this step:\n\n${JSON.stringify(step)}\n\n${context ? `Additional context: ${JSON.stringify(context)}` : ''}`,
  }),

  quickReview: (implementation, plan) => ({
    system: `You are R2 — a quick code reviewer. Your job is to check implementation quality.

REVIEW CRITERIA:
1. Does the implementation match the plan step?
2. Are there obvious bugs or logic errors?
3. Are there security issues?
4. Is the code clean and maintainable?

RULES:
- Be CONCISE — this is a quick review
- If everything looks good → {"verdict": "PASS", "notes": "..."}
- If there are issues → {"verdict": "FAIL", "issues": [{"severity": "critical|warning", "description": "...", "location": "..."}]}
- Only FAIL on real problems, not style preferences`,
    prompt: `Review this implementation against the plan:\n\nPlan: ${JSON.stringify(plan)}\n\nImplementation:\n${typeof implementation === 'string' ? implementation : JSON.stringify(implementation)}\n\nRespond ONLY with JSON.`,
  }),

  fixDeliberation: (implementation, issues) => ({
    system: `You are D2 — a fix deliberation specialist. Given implementation issues found by review, you create a FIX PLAN.

RULES:
- Address ONLY the issues listed
- Do NOT redesign the whole thing
- Be specific about what to change and where
- Output a fix plan, NOT the fix itself`,
    prompt: `The review found these issues:\n\n${JSON.stringify(issues)}\n\nIn this implementation:\n${typeof implementation === 'string' ? implementation : JSON.stringify(implementation)}\n\nCreate a fix plan. Respond with JSON: {"fixes": [{"issue": "...", "solution": "...", "location": "..."}]}`,
  }),

  applyFix: (implementation, fixPlan) => ({
    system: `You are CODE — applying fixes to existing implementation.

RULES:
- Apply ONLY the fixes in the fix plan
- Do NOT change anything else
- Output the COMPLETE fixed implementation`,
    prompt: `Apply these fixes:\n\n${JSON.stringify(fixPlan)}\n\nTo this implementation:\n${typeof implementation === 'string' ? implementation : JSON.stringify(implementation)}\n\nOutput the complete fixed implementation.`,
  }),

  finalReview: (implementation, plan) => ({
    system: `You are R1 — a senior deep reviewer. This is the FINAL review before delivery.

REVIEW CRITERIA (thorough):
1. Correctness — does it do what the plan says?
2. Security — any vulnerabilities?
3. Performance — obvious bottlenecks?
4. Completeness — anything missing?
5. Architecture — is the structure sound?

VERDICTS:
- PASS → ready to deliver: {"verdict": "PASS", "quality": "...", "notes": "..."}
- FAIL → needs minor fixes (back to D2→CODE→R2 loop): {"verdict": "FAIL", "issues": [...]}
- REDESIGN → fundamental problems, needs D1 replanning: {"verdict": "REDESIGN", "reason": "...", "suggestions": "..."}`,
    prompt: `Final review of implementation against plan:\n\nPlan: ${JSON.stringify(plan)}\n\nImplementation:\n${typeof implementation === 'string' ? implementation : JSON.stringify(implementation)}\n\nRespond ONLY with JSON.`,
  }),

  // v90: Build error analysis — D2 diagnoses compiler/build errors
  buildFix: (implementation, buildErrors) => ({
    system: `You are D2 — a build error analyst. Given compiler/build output, identify:
1. Root cause (missing dependency, syntax error, type error, config issue)
2. Which files need fixing
3. Minimal fix strategy — change as little as possible

RULES:
- Focus on the FIRST error (cascade errors are often caused by the first)
- Be specific about file paths and line numbers
- Output a fix plan, NOT the fix itself`,
    prompt: `Build failed with these errors:\n\n${buildErrors}\n\nImplementation:\n${typeof implementation === 'string' ? implementation : JSON.stringify(implementation)}\n\nCreate a fix plan. Respond with JSON: {"fixes": [{"issue": "...", "solution": "...", "location": "..."}]}`,
  }),

  redesign: (request, plan, reviewFeedback) => ({
    system: `You are D1 — redesigning a plan after the final reviewer found fundamental issues.

RULES:
- Consider the reviewer's feedback carefully
- Create a NEW plan that addresses the problems
- Keep what worked, fix what didn't
- Output same JSON format as original plan`,
    prompt: `Original request: ${request}\n\nOriginal plan: ${JSON.stringify(plan)}\n\nReviewer feedback: ${JSON.stringify(reviewFeedback)}\n\nCreate an improved plan. Respond with JSON.`,
  }),
};

// ─── JSON Parser (tolerant) ─────────────────────────────────────────────────

function parseJSON(text) {
  // Strip <think>...</think> reasoning blocks (deepseek-r1)
  // Handle both closed and unclosed <think> blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // If unclosed <think> remains, strip from <think> to end
  if (cleaned.includes('<think>')) {
    cleaned = cleaned.replace(/<think>[\s\S]*/g, '').trim();
  }
  // Strip orphaned </think> tags (no matching <think>)
  cleaned = cleaned.replace(/<\/think>/g, '').trim();

  // Helper: fix trailing commas in JSON (common LLM output issue)
  function fixTrailingCommas(s) {
    return s.replace(/,\s*([\]}])/g, '$1');
  }

  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}
  try { return JSON.parse(fixTrailingCommas(cleaned)); } catch {}
  // Try extracting from markdown code block
  const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
    try { return JSON.parse(fixTrailingCommas(match[1].trim())); } catch {}
  }
  // Greedy fallback: first { to last }
  const greedyMatch = cleaned.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try { return JSON.parse(greedyMatch[0]); } catch {}
    try { return JSON.parse(fixTrailingCommas(greedyMatch[0])); } catch {}
  }
  // Final fallback: try on original text
  const origMatch = text.match(/\{[\s\S]*\}/);
  if (origMatch) {
    try { return JSON.parse(origMatch[0]); } catch {}
    try { return JSON.parse(fixTrailingCommas(origMatch[0])); } catch {}
  }
  return null;
}

// ─── Workflow Orchestrator ──────────────────────────────────────────────────

export class WorkflowOrchestrator {
  constructor(options = {}) {
    this.maxFixAttempts = options.maxFixAttempts ?? config.workflow?.maxIterations ?? 3;
    this.maxRedesignAttempts = options.maxRedesignAttempts ?? config.workflow?.maxDesignRetries ?? 1;
    this.sessions = new Map();
    this.db = options.db || null;  // workflowSessions repository from database.js
  }

  // ═══ PUBLIC API ═══════════════════════════════════════════════════════════

  /**
   * Start a new workflow from user request.
   * Returns either CLARIFYING (needs more info) or AWAITING_APPROVAL (plan ready).
   */
  async start(request, context = {}) {
    const sessionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = new WorkflowSession(sessionId, request);
    session._onUpdate = (s) => this._persist(s);
    this.sessions.set(sessionId, session);
    this._createDbRow(session);

    // Phase C: link to project
    const projectCtx = getProjectContextManager();
    if (projectCtx) {
      const project = projectCtx.resolveProject(request, context?.projectId);
      if (project) {
        session.projectId = project.id;
        projectCtx.linkSessionToProject(session.id, project.id);
        projectCtx.addTimelineEvent(project.id, 'Workflow started', request.slice(0, 100));
      }
    }

    logger.info('Workflow', 'Starting workflow', { sessionId, request: request.slice(0, 100) });

    // ─── D1: Analyze ────────────────────────────────────────────────────
    session.transition(WorkflowState.ANALYZING);
    const analysisPrompt = PROMPTS.analyze(request, context);

    const analysisResult = await callLLM('D1', analysisPrompt.prompt, analysisPrompt.system);
    const analysis = parseJSON(analysisResult.content);

    session.addStep(new StepResult({
      step: 'D1_ANALYZE',
      model: analysisResult.model,
      output: analysis || analysisResult.content,
      duration: analysisResult.duration,
    }));

    if (!analysis) {
      logger.warn('Workflow', 'D1 returned non-JSON analysis', { sessionId });
      // Treat as ready with raw analysis
      return this._createPlan(session, request, analysisResult.content, context);
    }

    if (analysis.status === 'CLARIFY') {
      session.clarificationQuestions = analysis.questions;
      session.transition(WorkflowState.CLARIFYING);
      return {
        sessionId,
        state: WorkflowState.CLARIFYING,
        questions: analysis.questions,
      };
    }

    // READY — proceed to planning
    return this._createPlan(session, request, JSON.stringify(analysis), context);
  }

  /**
   * Provide clarification answers and continue.
   */
  async clarify(sessionId, answers) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.state !== WorkflowState.CLARIFYING) {
      throw new Error(`Session is in ${session.state}, not CLARIFYING`);
    }

    // Enrich request with answers
    const enrichedRequest = `${session.request}\n\nClarification:\n${answers}`;
    session.request = enrichedRequest;

    return this._createPlan(session, enrichedRequest, 'User provided clarification', {});
  }

  /**
   * User approves the plan — start implementation.
   */
  async approve(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (session.state !== WorkflowState.AWAITING_APPROVAL) {
      throw new Error(`Session is in ${session.state}, not AWAITING_APPROVAL`);
    }

    return this._executeWorkflow(session);
  }

  /**
   * User rejects the plan — back to D1.
   */
  async reject(sessionId, feedback = '') {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const enrichedRequest = feedback
      ? `${session.request}\n\nUser feedback on rejected plan: ${feedback}`
      : session.request;

    return this._createPlan(session, enrichedRequest, 'Plan rejected by user', {});
  }

  /**
   * Get session status (RAM cache first, then DB fallback).
   */
  getSession(sessionId) {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    // DB fallback — hydrate from persistent storage
    if (this.db) {
      const row = this.db.findById.get(sessionId);
      if (row) {
        const session = this._hydrateSession(row);
        this.sessions.set(sessionId, session);
        return session;
      }
    }

    return null;
  }

  /**
   * Resume a session from DB (interactive states survive server restart).
   */
  async resume(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Resumable interactive states
    if (session.state === WorkflowState.AWAITING_APPROVAL) {
      return {
        sessionId: session.id,
        state: session.state,
        plan: session.plan,
        message: 'Session resumed — awaiting plan approval',
      };
    }

    if (session.state === WorkflowState.CLARIFYING) {
      return {
        sessionId: session.id,
        state: session.state,
        questions: session.clarificationQuestions,
        message: 'Session resumed — awaiting clarification',
      };
    }

    // Terminal states
    if (session.state === WorkflowState.COMPLETED || session.state === WorkflowState.FAILED) {
      return {
        sessionId: session.id,
        state: session.state,
        plan: session.plan,
        implementation: session.implementation,
        message: `Session already ${session.state.toLowerCase()}`,
      };
    }

    // Mid-pipeline states — interrupted, cannot resume
    return {
      sessionId: session.id,
      state: session.state,
      message: `Session was interrupted during ${session.state} — cannot resume mid-pipeline`,
      canRetry: true,
    };
  }

  /**
   * List sessions (active or all).
   */
  listSessions({ activeOnly = true } = {}) {
    if (!this.db) {
      // RAM-only fallback
      const all = [...this.sessions.values()];
      const filtered = activeOnly
        ? all.filter(s => s.state !== WorkflowState.COMPLETED && s.state !== WorkflowState.FAILED)
        : all;
      return filtered.map(s => ({
        sessionId: s.id,
        state: s.state,
        request: s.request?.slice(0, 200),
        planTitle: s.plan?.title || null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
    }

    const rows = activeOnly ? this.db.listActive.all() : this.db.listAll.all();
    return rows.map(row => ({
      sessionId: row.session_id,
      state: row.state,
      complexity: row.complexity,
      request: row.request?.slice(0, 200),
      planTitle: row.plan ? (JSON.parse(row.plan)?.title || null) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get progress info for a session (C2).
   * Computes: % complete, current stage, blocker list, step history summary.
   */
  getProgress(sessionId) {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const plan = session.plan;
    const totalSteps = plan?.steps?.length || 0;

    // Count completed implementation steps
    const implementedSteps = session.history
      .filter(h => h.step.startsWith('CODE_IMPLEMENT_'))
      .length;

    // Percentage based on pipeline stage + implementation progress
    const implProgress = totalSteps > 0 ? (implementedSteps / totalSteps) * 30 : 0;
    const stageWeights = {
      IDLE: 0,
      ANALYZING: 5,
      CLARIFYING: 10,
      PLANNING: 15,
      AWAITING_APPROVAL: 20,
      IMPLEMENTING: 30 + implProgress,
      BUILD_VERIFYING: 62,  // v90: between IMPLEMENTING and R2
      QUICK_REVIEWING: 65,
      FIX_DELIBERATING: 50,
      APPLYING_FIX: 55,
      FINAL_REVIEWING: 80,
      REDESIGNING: 25,
      COMPLETED: 100,
      FAILED: 0,
    };

    const percentage = Math.round(Math.max(0, Math.min(100, stageWeights[session.state] ?? 0)));

    // Aggregate blockers from R2/R1 review failures
    const blockers = [];
    for (const step of session.history) {
      if ((step.step === 'R2_QUICK_REVIEW' || step.step === 'R1_FINAL_REVIEW')
          && step.verdict === 'FAIL'
          && step.output?.issues) {
        for (const issue of step.output.issues) {
          blockers.push({
            source: step.step,
            severity: issue.severity || 'warning',
            description: issue.description,
            location: issue.location || null,
            fixAttempt: session.fixAttempts,
            timestamp: step.timestamp,
          });
        }
      }
    }

    return {
      sessionId: session.id,
      state: session.state,
      percentage,
      currentStage: this._currentStage(session.state),
      totalSteps,
      implementedSteps,
      fixAttempts: session.fixAttempts,
      maxFixAttempts: this.maxFixAttempts,
      redesignAttempts: session.redesignAttempts,
      maxRedesignAttempts: this.maxRedesignAttempts,
      blockers,
      stepsCompleted: session.history.map(h => ({
        step: h.step,
        duration: h.duration,
        verdict: h.verdict,
        timestamp: h.timestamp,
      })),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  // ═══ INTERNAL PIPELINE ════════════════════════════════════════════════════

  async _createPlan(session, request, analysis, context) {
    // ─── D1: Plan ─────────────────────────────────────────────────────
    session.transition(WorkflowState.PLANNING);
    const planPrompt = PROMPTS.plan(request, analysis, context);

    const planResult = await callLLM('D1', planPrompt.prompt, planPrompt.system);
    const plan = parseJSON(planResult.content);

    session.addStep(new StepResult({
      step: 'D1_PLAN',
      model: planResult.model,
      output: plan || planResult.content,
      duration: planResult.duration,
    }));

    if (!plan) {
      session.transition(WorkflowState.FAILED);
      return { sessionId: session.id, state: WorkflowState.FAILED, error: 'D1 failed to produce structured plan' };
    }

    session.plan = plan;
    session.transition(WorkflowState.AWAITING_APPROVAL);

    return {
      sessionId: session.id,
      state: WorkflowState.AWAITING_APPROVAL,
      plan,
    };
  }

  async _executeWorkflow(session) {
    const plan = session.plan;
    if (!plan || !plan.steps || plan.steps.length === 0) {
      session.transition(WorkflowState.FAILED);
      return { sessionId: session.id, state: WorkflowState.FAILED, error: 'No plan steps to execute' };
    }

    // ─── CODE: Implement all steps ──────────────────────────────────────
    session.transition(WorkflowState.IMPLEMENTING);
    const implementations = [];

    for (const step of plan.steps) {
      const implPrompt = PROMPTS.implement(plan, step, {});
      const implResult = await callLLM('CODE', implPrompt.prompt, implPrompt.system);

      implementations.push({
        stepId: step.id,
        action: step.action,
        output: implResult.content,
      });

      session.addStep(new StepResult({
        step: `CODE_IMPLEMENT_${step.id}`,
        model: implResult.model,
        output: implResult.content,
        duration: implResult.duration,
      }));
    }

    session.implementation = implementations;
    this._persist(session); // persist implementation blob

    // ─── v90: Build verification before review ──────────────────────────
    return this._buildVerify(session);
  }

  // ─── v90: Build Verification Loop ───────────────────────────────────────
  //
  // Deterministic build verification: detect build command from implementation,
  // execute it, parse errors. If no build script is detected → skip to R2.
  // On failure: D2 diagnoses → CODE fixes → retry (max 3 build fix attempts).
  //
  async _buildVerify(session) {
    const buildCmd = this._detectBuildCommand(session.implementation);

    if (!buildCmd) {
      logger.info('Workflow', 'No build command detected — skipping build verification', { sessionId: session.id });
      return this._reviewLoop(session);
    }

    session.transition(WorkflowState.BUILD_VERIFYING);
    session.buildFixAttempts = session.buildFixAttempts || 0;

    logger.info('Workflow', 'Build verification', { sessionId: session.id, command: buildCmd, attempt: session.buildFixAttempts });

    try {
      // Lazy-load C3ToolExecutor to avoid circular dependency
      const { C3ToolExecutor } = await import('../executor/c3-tool-executor.js');
      const executor = new C3ToolExecutor();

      const result = await executor.execute({
        correlationId: `build-verify-${session.id}-${session.buildFixAttempts}`,
        tool: 'shell',
        args: { command: buildCmd, cwd: session.projectPath || process.cwd() },
        timeoutMs: 180_000, // 3 minutes for builds
      });

      const exitCode = result.output?.exitCode ?? (result.status === 'ok' ? 0 : 1);
      const stderr = result.output?.stderr || '';
      const stdout = result.output?.stdout || '';

      session.addStep(new StepResult({
        step: `BUILD_VERIFY_${session.buildFixAttempts}`,
        model: 'shell',
        output: { command: buildCmd, exitCode, stderr: stderr.slice(0, 2000), stdout: stdout.slice(0, 500) },
        verdict: exitCode === 0 ? 'PASS' : 'FAIL',
        duration: result.executionTimeMs || 0,
      }));

      if (exitCode === 0) {
        logger.info('Workflow', 'Build verification PASSED', { sessionId: session.id });
        return this._reviewLoop(session);
      }

      // Build failed — parse errors and attempt fix
      const buildErrors = this._parseBuildErrors(stderr || stdout);
      logger.warn('Workflow', 'Build verification FAILED', { sessionId: session.id, errorCount: buildErrors.length, attempt: session.buildFixAttempts });

      if (session.buildFixAttempts >= 3) {
        logger.warn('Workflow', 'Max build fix attempts reached', { sessionId: session.id });
        // Fall through to R2 review — let LLM reviewers catch it
        return this._reviewLoop(session);
      }

      session.buildFixAttempts++;

      // D2 diagnoses build errors
      const d2Prompt = PROMPTS.buildFix(session.implementation, buildErrors.join('\n'));
      const d2Result = await callLLM('D2', d2Prompt.prompt, d2Prompt.system);
      const fixPlan = parseJSON(d2Result.content);

      session.addStep(new StepResult({
        step: `D2_BUILD_FIX_${session.buildFixAttempts}`,
        model: d2Result.model,
        output: fixPlan || d2Result.content,
        duration: d2Result.duration,
      }));

      // CODE applies build fixes
      const fixPrompt = PROMPTS.applyFix(session.implementation, fixPlan || d2Result.content);
      const fixResult = await callLLM('CODE', fixPrompt.prompt, fixPrompt.system);
      session.implementation = fixResult.content;

      session.addStep(new StepResult({
        step: `CODE_BUILD_FIX_${session.buildFixAttempts}`,
        model: fixResult.model,
        output: fixResult.content,
        duration: fixResult.duration,
      }));

      this._persist(session);

      // Retry build verification
      return this._buildVerify(session);
    } catch (err) {
      logger.error('Workflow', `Build verification error: ${err.message}`, { sessionId: session.id });
      // Non-fatal — fall through to LLM review
      session.addStep(new StepResult({
        step: `BUILD_VERIFY_ERROR`,
        model: 'shell',
        output: err.message,
        verdict: 'ERROR',
      }));
      return this._reviewLoop(session);
    }
  }

  /**
   * Detect build command from implementation output.
   * Searches for package.json "build" script, Makefile, Cargo.toml, go.mod.
   * @returns {string|null} Build command or null if none detected.
   */
  _detectBuildCommand(implementation) {
    // Collect all text from implementation (handles array of {output} or raw string)
    let implText;
    if (typeof implementation === 'string') {
      implText = implementation;
    } else if (Array.isArray(implementation)) {
      implText = implementation.map(s => s.output || '').join('\n');
    } else {
      implText = JSON.stringify(implementation);
    }

    // Node.js: package.json with "build" script
    if (/"build"\s*:\s*"/.test(implText)) return 'npm run build';
    // Rust
    if (/Cargo\.toml/.test(implText)) return 'cargo build';
    // Go
    if (/go\.mod/.test(implText)) return 'go build ./...';
    // Make
    if (/Makefile/.test(implText) && !/CMakeLists/.test(implText)) return 'make';
    // CMake
    if (/CMakeLists\.txt/.test(implText)) return 'cmake --build .';
    // Flutter
    if (/pubspec\.yaml/.test(implText)) return 'flutter build';
    // Python: setup.py or pyproject.toml
    if (/pyproject\.toml/.test(implText)) return 'pip install -e .';

    return null;
  }

  /**
   * Parse build errors from stderr/stdout output.
   * Extracts lines containing error/Error/ERROR with meaningful content.
   * @returns {string[]} Array of error lines (max 20).
   */
  _parseBuildErrors(output) {
    if (!output) return ['(no output)'];
    const errors = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length > 10 && /error|Error|ERROR|failed|FAILED|fatal|FATAL/.test(trimmed)) {
        errors.push(trimmed);
      }
    }
    return errors.length > 0 ? errors.slice(0, 20) : [output.slice(0, 2000)];
  }

  async _reviewLoop(session) {
    // ─── R2: Quick Review ────────────────────────────────────────────────
    session.transition(WorkflowState.QUICK_REVIEWING);
    const r2Prompt = PROMPTS.quickReview(session.implementation, session.plan);
    const r2Result = await callLLM('R2', r2Prompt.prompt, r2Prompt.system);
    const r2Verdict = parseJSON(r2Result.content);

    session.addStep(new StepResult({
      step: 'R2_QUICK_REVIEW',
      model: r2Result.model,
      output: r2Verdict || r2Result.content,
      verdict: r2Verdict?.verdict || 'UNKNOWN',
      duration: r2Result.duration,
    }));

    if (!r2Verdict || r2Verdict.verdict === 'FAIL') {
      // ─── R2 FAIL → D2 + CODE fix loop ─────────────────────────────────
      if (session.fixAttempts >= this.maxFixAttempts) {
        logger.warn('Workflow', 'Max fix attempts reached', { sessionId: session.id, attempts: session.fixAttempts });
        session.transition(WorkflowState.FAILED);
        return {
          sessionId: session.id,
          state: WorkflowState.FAILED,
          error: `Failed after ${session.fixAttempts} fix attempts`,
          lastIssues: r2Verdict?.issues || r2Result.content,
        };
      }

      session.fixAttempts++;
      return this._fixLoop(session, r2Verdict?.issues || [{ description: r2Result.content }]);
    }

    // ─── R2 PASS → R1: Final Review ──────────────────────────────────────
    return this._finalReview(session);
  }

  async _fixLoop(session, issues) {
    // ─── D2: Fix Deliberation ────────────────────────────────────────────
    session.transition(WorkflowState.FIX_DELIBERATING);
    const d2Prompt = PROMPTS.fixDeliberation(session.implementation, issues);
    const d2Result = await callLLM('D2', d2Prompt.prompt, d2Prompt.system);
    const fixPlan = parseJSON(d2Result.content);

    session.addStep(new StepResult({
      step: `D2_FIX_${session.fixAttempts}`,
      model: d2Result.model,
      output: fixPlan || d2Result.content,
      duration: d2Result.duration,
    }));

    // ─── CODE: Apply Fix ─────────────────────────────────────────────────
    session.transition(WorkflowState.APPLYING_FIX);
    const fixPrompt = PROMPTS.applyFix(session.implementation, fixPlan || d2Result.content);
    const fixResult = await callLLM('CODE', fixPrompt.prompt, fixPrompt.system);

    session.implementation = fixResult.content;

    session.addStep(new StepResult({
      step: `CODE_FIX_${session.fixAttempts}`,
      model: fixResult.model,
      output: fixResult.content,
      duration: fixResult.duration,
    }));

    // ─── Back to R2 ──────────────────────────────────────────────────────
    return this._reviewLoop(session);
  }

  async _finalReview(session) {
    // ─── R1: Final Deep Review ───────────────────────────────────────────
    session.transition(WorkflowState.FINAL_REVIEWING);
    const r1Prompt = PROMPTS.finalReview(session.implementation, session.plan);
    const r1Result = await callLLM('R1', r1Prompt.prompt, r1Prompt.system);
    const r1Verdict = parseJSON(r1Result.content);

    session.addStep(new StepResult({
      step: 'R1_FINAL_REVIEW',
      model: r1Result.model,
      output: r1Verdict || r1Result.content,
      verdict: r1Verdict?.verdict || 'UNKNOWN',
      duration: r1Result.duration,
    }));

    if (!r1Verdict || r1Verdict.verdict === 'PASS') {
      // ─── DONE ──────────────────────────────────────────────────────
      session.transition(WorkflowState.COMPLETED);
      return {
        sessionId: session.id,
        state: WorkflowState.COMPLETED,
        plan: session.plan,
        implementation: session.implementation,
        quality: r1Verdict?.quality || 'approved',
        history: session.history,
      };
    }

    if (r1Verdict.verdict === 'REDESIGN') {
      // ─── R1 REDESIGN → D1 redesign → CODE re-implement → R2 loop ──────
      if (session.redesignAttempts >= this.maxRedesignAttempts) {
        session.transition(WorkflowState.FAILED);
        return {
          sessionId: session.id,
          state: WorkflowState.FAILED,
          error: `Redesign limit reached (${session.redesignAttempts})`,
          reviewFeedback: r1Verdict,
        };
      }

      session.redesignAttempts++;
      return this._redesign(session, r1Verdict);
    }

    // R1 FAIL → back to D2→CODE→R2 fix loop
    if (session.fixAttempts >= this.maxFixAttempts) {
      session.transition(WorkflowState.FAILED);
      return {
        sessionId: session.id,
        state: WorkflowState.FAILED,
        error: `Max fix attempts reached after R1 fail`,
        reviewFeedback: r1Verdict,
      };
    }
    session.fixAttempts++;
    return this._fixLoop(session, r1Verdict.issues || []);
  }

  async _redesign(session, reviewFeedback) {
    // ─── D1: Redesign ────────────────────────────────────────────────────
    session.transition(WorkflowState.REDESIGNING);
    const redesignPrompt = PROMPTS.redesign(session.request, session.plan, reviewFeedback);
    const redesignResult = await callLLM('D1', redesignPrompt.prompt, redesignPrompt.system);
    const newPlan = parseJSON(redesignResult.content);

    session.addStep(new StepResult({
      step: `D1_REDESIGN_${session.redesignAttempts}`,
      model: redesignResult.model,
      output: newPlan || redesignResult.content,
      duration: redesignResult.duration,
    }));

    if (!newPlan) {
      session.transition(WorkflowState.FAILED);
      return { sessionId: session.id, state: WorkflowState.FAILED, error: 'D1 redesign failed to produce plan' };
    }

    session.plan = newPlan;
    session.fixAttempts = 0; // Reset fix counter for new plan
    this._persist(session); // persist new plan

    // ─── CODE: Re-implement with new plan → R2 loop ─────────────────────
    return this._executeWorkflow(session);
  }

  // ═══ PERSISTENCE ════════════════════════════════════════════════════════

  _persist(session) {
    if (!this.db) return;
    try {
      const timing = {
        history: session.history,
        fixAttempts: session.fixAttempts,
        redesignAttempts: session.redesignAttempts,
        clarificationQuestions: session.clarificationQuestions,
        createdAt: session.createdAt,
      };
      this.db.save(session.id, session.state, session.plan, session.implementation, timing);
    } catch (err) {
      logger.debug('Workflow', `DB persist failed: ${err.message}`);
    }
  }

  _createDbRow(session) {
    if (!this.db) return;
    try {
      this.db.getOrCreate(session.id, null, session.request);
    } catch (err) {
      logger.debug('Workflow', `DB create failed: ${err.message}`);
    }
  }

  _hydrateSession(row) {
    const session = new WorkflowSession(row.session_id, row.request);
    session.state = row.state;
    try { session.plan = row.plan ? JSON.parse(row.plan) : null; } catch { session.plan = row.plan; }
    try { session.implementation = row.implementation ? JSON.parse(row.implementation) : null; } catch { session.implementation = row.implementation; }

    let timing = {};
    try { timing = row.timing ? JSON.parse(row.timing) : {}; } catch {}

    session.history = (timing.history || []).map(h => Object.assign(new StepResult({
      step: h.step, model: h.model, output: h.output,
      verdict: h.verdict, duration: h.duration, error: h.error,
    }), { timestamp: h.timestamp }));
    session.fixAttempts = timing.fixAttempts || 0;
    session.redesignAttempts = timing.redesignAttempts || 0;
    session.clarificationQuestions = timing.clarificationQuestions || null;
    session.projectId = row.project_id || null;  // Phase C
    session.createdAt = timing.createdAt || row.created_at;
    session.updatedAt = row.updated_at;

    // Wire persistence callback
    session._onUpdate = (s) => this._persist(s);

    return session;
  }

  _currentStage(state) {
    const stageMap = {
      IDLE: 'init',
      ANALYZING: 'D1',
      CLARIFYING: 'D1',
      PLANNING: 'D1',
      AWAITING_APPROVAL: 'approval',
      IMPLEMENTING: 'CODE',
      BUILD_VERIFYING: 'BUILD',  // v90
      QUICK_REVIEWING: 'R2',
      FIX_DELIBERATING: 'D2',
      APPLYING_FIX: 'CODE',
      FINAL_REVIEWING: 'R1',
      REDESIGNING: 'D1',
      COMPLETED: 'done',
      FAILED: 'failed',
    };
    return stageMap[state] || 'unknown';
  }
}

// ─── Exported utilities (v61: used by lifecycle sub-modules) ─────────────────

export { callLLM, callSpecDocumentLLM, parseJSON };

// ─── Singleton (no-DB default — index.js creates the DB-backed instance) ────

export const workflowOrchestrator = new WorkflowOrchestrator();
export default WorkflowOrchestrator;
