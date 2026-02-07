// Planner Workflow — D1/CODE/R2/D2/R1 Pipeline
// ══════════════════════════════════════════════════════════════════════════════
//
// WORKFLOW:
//   User Request
//        ↓
//   D1 (deepseek-r1) → Analyze → CLARIFY? → questions back to user
//        ↓ READY
//   D1 → Create Plan → User confirms
//        ↓ OK
//   CODE (qwen2.5-coder) → Implement
//        ↓
//   R2 (qwen2.5:32b) → Quick Review
//        ↓ FAIL                    ↓ PASS
//   D2 (qwen3-30b) → Fix plan     R1 (deepseek-r1) → Final Review
//        ↓                              ↓ FAIL (redesign)
//   CODE → Apply Fix                   D1 → Redesign
//        ↓                              ↓
//        → R2 (loop)                   CODE → Re-implement → R2 (loop)
//                                       ↓
//                                  ↓ APPROVED
//                                  ✅ DONE
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
import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';

// ─── Workflow States ────────────────────────────────────────────────────────

export const WorkflowState = Object.freeze({
  IDLE: 'IDLE',
  ANALYZING: 'ANALYZING',           // D1 analyzing request
  CLARIFYING: 'CLARIFYING',         // Waiting for user clarification
  PLANNING: 'PLANNING',             // D1 creating plan
  AWAITING_APPROVAL: 'AWAITING_APPROVAL', // User must approve plan
  IMPLEMENTING: 'IMPLEMENTING',     // CODE implementing
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
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }

  addStep(result) {
    this.history.push(result);
    this.updatedAt = new Date().toISOString();
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
  const token = createAuthToken(callerRole, `workflow-${role}`);

  const startTime = Date.now();
  try {
    const result = await callWithAuth(token, prompt, {
      systemPrompt,
      model,
      timeout,
      ...options,
    });
    return {
      content: result.content || result,
      model,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    logger.error('Workflow', `LLM call failed for ${role}`, { model, error: err.message });
    throw err;
  }
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
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try extracting from markdown code block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  // Try finding first { ... } block
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch {}
  }
  return null;
}

// ─── Workflow Orchestrator ──────────────────────────────────────────────────

export class WorkflowOrchestrator {
  constructor(options = {}) {
    this.maxFixAttempts = options.maxFixAttempts ?? config.workflow?.maxIterations ?? 3;
    this.maxRedesignAttempts = options.maxRedesignAttempts ?? config.workflow?.maxDesignRetries ?? 1;
    this.sessions = new Map();
  }

  // ═══ PUBLIC API ═══════════════════════════════════════════════════════════

  /**
   * Start a new workflow from user request.
   * Returns either CLARIFYING (needs more info) or AWAITING_APPROVAL (plan ready).
   */
  async start(request, context = {}) {
    const sessionId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = new WorkflowSession(sessionId, request);
    this.sessions.set(sessionId, session);

    logger.info('Workflow', 'Starting workflow', { sessionId, request: request.slice(0, 100) });

    // ─── D1: Analyze ────────────────────────────────────────────────────
    session.state = WorkflowState.ANALYZING;
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
      session.state = WorkflowState.CLARIFYING;
      session.clarificationQuestions = analysis.questions;
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const enrichedRequest = feedback
      ? `${session.request}\n\nUser feedback on rejected plan: ${feedback}`
      : session.request;

    return this._createPlan(session, enrichedRequest, 'Plan rejected by user', {});
  }

  /**
   * Get session status.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  // ═══ INTERNAL PIPELINE ════════════════════════════════════════════════════

  async _createPlan(session, request, analysis, context) {
    // ─── D1: Plan ─────────────────────────────────────────────────────
    session.state = WorkflowState.PLANNING;
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
      session.state = WorkflowState.FAILED;
      return { sessionId: session.id, state: WorkflowState.FAILED, error: 'D1 failed to produce structured plan' };
    }

    session.plan = plan;
    session.state = WorkflowState.AWAITING_APPROVAL;

    return {
      sessionId: session.id,
      state: WorkflowState.AWAITING_APPROVAL,
      plan,
    };
  }

  async _executeWorkflow(session) {
    const plan = session.plan;
    if (!plan || !plan.steps || plan.steps.length === 0) {
      session.state = WorkflowState.FAILED;
      return { sessionId: session.id, state: WorkflowState.FAILED, error: 'No plan steps to execute' };
    }

    // ─── CODE: Implement all steps ──────────────────────────────────────
    session.state = WorkflowState.IMPLEMENTING;
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

    // ─── Enter review loop ──────────────────────────────────────────────
    return this._reviewLoop(session);
  }

  async _reviewLoop(session) {
    // ─── R2: Quick Review ────────────────────────────────────────────────
    session.state = WorkflowState.QUICK_REVIEWING;
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
        session.state = WorkflowState.FAILED;
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
    session.state = WorkflowState.FIX_DELIBERATING;
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
    session.state = WorkflowState.APPLYING_FIX;
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
    session.state = WorkflowState.FINAL_REVIEWING;
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
      // ─── ✅ DONE ──────────────────────────────────────────────────────
      session.state = WorkflowState.COMPLETED;
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
        session.state = WorkflowState.FAILED;
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
      session.state = WorkflowState.FAILED;
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
    session.state = WorkflowState.REDESIGNING;
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
      session.state = WorkflowState.FAILED;
      return { sessionId: session.id, state: WorkflowState.FAILED, error: 'D1 redesign failed to produce plan' };
    }

    session.plan = newPlan;
    session.fixAttempts = 0; // Reset fix counter for new plan

    // ─── CODE: Re-implement with new plan → R2 loop ─────────────────────
    return this._executeWorkflow(session);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const workflowOrchestrator = new WorkflowOrchestrator();
export default WorkflowOrchestrator;
