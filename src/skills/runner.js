// Skill Runner — state machine for executing skill step sequences
// ══════════════════════════════════════════════════════════════════════════════
//
// State machine: IDLE → CONFIRMING → EXECUTING → DONE / FAILED
//                                  ↕ AWAITING_INPUT (interactive checkpoint)
//
// - All methods async (no background workers)
// - Step I/O contract: { status, output, retryable, errorType }
// - Interactive steps return { status: 'awaiting_input', prompt }
// - Retry only if retryable === true AND errorType === 'transient'
// - Never retries 'validation' or 'security' errors
// - Records output_hash (SHA-256) to skill_steps for telemetry
// - Never throws — all errors → FAILED state
//
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { skillExecutions, skillSteps } from '../db/database.js';
import { skillRegistry } from './registry.js';
import { executeLLM } from './steps/llm.js';
import { executeTemplate } from './steps/template.js';
import { executeWrite } from './steps/write.js';
import { executeShell } from './steps/shell.js';
import { executeAsk } from './steps/ask.js';
import { executeReview } from './steps/review.js';
import { executeValidate } from './steps/validate.js';
import { executeTransform } from './steps/transform.js';
import { substitute } from './steps/substitute.js';
import { logger } from '../core/logger.js';

const MAX_RETRIES = 2;
const AUTHORITY_PARAM = '__m3AuthorityV1';
const EFFECT_STEP_TYPES = new Set(['write', 'shell']);
let installedEffectAuthority = null;

export function setSkillEffectAuthority(authority) {
  const methods = ['prepareWrite', 'approveWrite', 'cancelWrite'];
  if (!authority || methods.some(method => typeof authority[method] !== 'function')) {
    throw new TypeError('Skill M2 effect authority must implement prepareWrite, approveWrite and cancelWrite');
  }
  installedEffectAuthority = authority;
}

// Approval patterns for review step resume
const REVIEW_APPROVE = /^(ano|yes|ok|schválit|approve|good|dobr[eéě]|souhlasím|v\s*pořádku)\s*[!.]?$/i;

// Step executor dispatch
const STEP_EXECUTORS = {
  llm: executeLLM,
  template: executeTemplate,
  write: executeWrite,
  shell: executeShell,
  ask: executeAsk,
  review: executeReview,
  validate: executeValidate,
  transform: executeTransform,
};

/**
 * Prepare a skill execution — creates DB record in CONFIRMING state.
 *
 * @param {Object} params
 * @param {string} params.skillId
 * @param {Object} params.skillParams - Resolved parameters
 * @param {string} params.input - Original user input
 * @param {number} params.confidence - Resolver confidence
 * @param {string} params.sessionId
 * @param {string} [params.conversationId]
 * @returns {{ executionId: string, skill: Object } | null}
 */
export function prepare({
  skillId,
  skillParams,
  input,
  confidence,
  sessionId,
  conversationId,
  authorityContext = null,
}) {
  try {
    const skill = skillRegistry.get(skillId);
    if (!skill) {
      logger.info('SkillRunner', `Skill "${skillId}" not found in registry`);
      return null;
    }

    const normalizedParams = _normalizeParams(skill, skillParams);
    const hasEffects = skill.steps.some(step => EFFECT_STEP_TYPES.has(step.type));
    const authorityBinding = hasEffects
      ? _bindAuthority({ sessionId, conversationId, authorityContext })
      : null;
    const storedParams = authorityBinding
      ? { ...normalizedParams, [AUTHORITY_PARAM]: authorityBinding }
      : normalizedParams;
    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

    skillExecutions.add.run(
      executionId,
      skillId,
      skill.version,
      'CONFIRMING',
      input,
      JSON.stringify(storedParams),
      confidence,
      sessionId,
      conversationId || null,
      new Date().toISOString(),
    );

    logger.debug('SkillRunner', `Prepared execution ${executionId} for skill "${skillId}"`, {
      paramCount: Object.keys(skillParams).length,
      stepCount: skill.steps.length,
      confidence,
    });

    return { executionId, skill };
  } catch (err) {
    logger.error('SkillRunner', `prepare() failed: ${err.message}`);
    return null;
  }
}

/**
 * Confirm and execute a pending skill.
 *
 * @param {string} executionId
 * @returns {{ status: string, output: Object, error?: string, prompt?: string, content?: string, stepId?: string, stepType?: string, executionId?: string }}
 */
export async function confirmAndExecute(executionId, executionContext = {}) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (!exec) {
      return { status: 'error', output: null, error: `Execution "${executionId}" not found` };
    }

    if (exec.state !== 'CONFIRMING') {
      return { status: 'error', output: null, error: `Execution "${executionId}" is in state ${exec.state}, expected CONFIRMING` };
    }

    const skill = skillRegistry.get(exec.skill_id);
    if (!skill) {
      _failExecution(executionId, `Skill "${exec.skill_id}" no longer in registry`);
      return { status: 'error', output: null, error: `Skill "${exec.skill_id}" not found` };
    }

    const storedParams = JSON.parse(exec.params || '{}');
    const { params, authorityBinding } = _executionInputs(storedParams, executionContext);

    // Caller authority is checked before the state transition so an unrelated
    // authenticated user cannot burn another user's pending execution.
    skillExecutions.confirm.run(executionId);
    return _executeSteps(
      executionId, skill, params, {}, 0, exec.input,
      { authorityBinding, signal: executionContext.signal || null },
    );
  } catch (err) {
    logger.error('SkillRunner', `confirmAndExecute() failed: ${err.message}`);
    if (err?.code !== 'M3_SKILL_AUTHORITY_CALLER_MISMATCH') {
      _failExecution(executionId, err.message);
    }
    return { status: 'error', output: null, error: err.message };
  }
}

/**
 * Resume a skill execution that is awaiting user input.
 *
 * @param {string} executionId
 * @param {string} userInput - User response to the interactive step
 * @returns {{ status: string, output: Object, error?: string, prompt?: string, content?: string, stepId?: string, stepType?: string, executionId?: string }}
 */
export async function resume(executionId, userInput, executionContext = {}) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (!exec) {
      return { status: 'error', output: null, error: `Execution "${executionId}" not found` };
    }

    if (exec.state !== 'AWAITING_INPUT') {
      return { status: 'error', output: null, error: `Execution "${executionId}" is in state ${exec.state}, expected AWAITING_INPUT` };
    }

    const skill = skillRegistry.get(exec.skill_id);
    if (!skill) {
      _failExecution(executionId, `Skill "${exec.skill_id}" no longer in registry`);
      return { status: 'error', output: null, error: `Skill "${exec.skill_id}" not found` };
    }

    const storedParams = JSON.parse(exec.params || '{}');
    const { params, authorityBinding } = _executionInputs(storedParams, executionContext);
    const stepsOutput = JSON.parse(exec.steps_output || '{}');

    // Find the step that was awaiting input
    const awaitingIdx = skill.steps.findIndex(s => s.id === exec.current_step_id);
    if (awaitingIdx === -1) {
      _failExecution(executionId, `Awaiting step "${exec.current_step_id}" not found in skill definition`);
      return { status: 'error', output: stepsOutput, error: `Step "${exec.current_step_id}" not found` };
    }

    const awaitingStep = skill.steps[awaitingIdx];

    if (awaitingStep.type === 'write') {
      const pending = stepsOutput[awaitingStep.id];
      const approvedEffectId = _parseExactEffectApproval(userInput);
      if (!pending?.effectId || approvedEffectId !== pending.effectId) {
        return {
          status: 'awaiting_input',
          prompt: `Efekt zůstává neprovedený. Napiš přesně: schválit efekt ${pending?.effectId || '<effect-id>'}`,
          content: null,
          executionId,
          stepId: awaitingStep.id,
          stepType: awaitingStep.type,
          output: stepsOutput,
          errorCode: 'M3_SKILL_EXACT_EFFECT_APPROVAL_REQUIRED',
        };
      }
      const context = {
        executionId,
        skillId: skill.id,
        params: exec.input ? { ...params, input: exec.input } : params,
        stepsOutput,
        authorityBinding,
        effectAuthority: installedEffectAuthority,
        approvalEffectId: approvedEffectId,
        signal: executionContext.signal || null,
      };
      const result = await _executeStepWithRetry(executeWrite, awaitingStep, context);
      _recordStep(executionId, awaitingStep, result);
      if (result.status !== 'success') {
        const errMsg = result.errorMessage || `Step "${awaitingStep.id}" failed`;
        _failExecution(executionId, errMsg);
        return { status: 'error', output: stepsOutput, error: errMsg };
      }
      stepsOutput[awaitingStep.id] = result.output;
      skillExecutions.updateState.run('EXECUTING', null, JSON.stringify(stepsOutput), executionId);
      return _executeSteps(
        executionId, skill, params, stepsOutput, awaitingIdx + 1, exec.input,
        { authorityBinding, signal: executionContext.signal || null },
      );
    }

    // Process user input into step output
    const stepOutput = _processResumeInput(awaitingStep, userInput, params, stepsOutput);
    stepsOutput[awaitingStep.id] = stepOutput;

    // Record the resolved interactive step
    _recordStep(executionId, awaitingStep, {
      status: 'success',
      output: stepOutput,
      retryable: false,
      errorType: null,
      duration_ms: 0,
    });

    logger.debug('SkillRunner', `Resumed execution ${executionId} from step "${awaitingStep.id}"`, {
      stepType: awaitingStep.type,
      userInputLength: userInput.length,
    });

    // Transition back to EXECUTING and continue from next step
    skillExecutions.updateState.run('EXECUTING', null, JSON.stringify(stepsOutput), executionId);
    return _executeSteps(
      executionId, skill, params, stepsOutput, awaitingIdx + 1, exec.input,
      { authorityBinding, signal: executionContext.signal || null },
    );
  } catch (err) {
    logger.error('SkillRunner', `resume() failed: ${err.message}`);
    if (err?.code !== 'M3_SKILL_AUTHORITY_CALLER_MISMATCH') {
      _failExecution(executionId, err.message);
    }
    return { status: 'error', output: null, error: err.message };
  }
}

/**
 * Cancel a pending or awaiting execution.
 *
 * @param {string} executionId
 * @returns {Promise<boolean>}
 */
export async function cancel(executionId, executionContext = {}) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (!exec || (exec.state !== 'CONFIRMING' && exec.state !== 'AWAITING_INPUT')) return false;
    const storedParams = JSON.parse(exec.params || '{}');
    const { authorityBinding } = _executionInputs(storedParams, executionContext);
    const stepsOutput = JSON.parse(exec.steps_output || '{}');
    const pendingEffectId = Object.values(stepsOutput)
      .find(value => value?.state === 'approval_required' && typeof value.effectId === 'string')
      ?.effectId;
    if (pendingEffectId) {
      if (!installedEffectAuthority) throw new Error('Skill M2 effect authority is not installed');
      await installedEffectAuthority.cancelWrite({ binding: authorityBinding, effectId: pendingEffectId });
    }

    skillExecutions.complete.run('CANCELLED', 'User cancelled', executionId);
    logger.info('SkillRunner', `Execution ${executionId} cancelled (was ${exec.state})`);
    return true;
  } catch (err) {
    logger.error('SkillRunner', `cancel() failed: ${err.message}`);
    return false;
  }
}

/**
 * Get execution status with step details.
 *
 * @param {string} executionId
 * @returns {Object|null}
 */
export function getStatus(executionId) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (!exec) return null;

    const steps = skillSteps.findByExecution.all(executionId);
    const params = JSON.parse(exec.params || '{}');
    delete params[AUTHORITY_PARAM];
    return {
      ...exec,
      // The durable binding is an internal authority fact, not skill output.
      // Public status keeps the user parameters but never serializes it.
      params,
      stepsOutput: JSON.parse(exec.steps_output || '{}'),
      steps,
    };
  } catch (err) {
    logger.error('SkillRunner', `getStatus() failed: ${err.message}`);
    return null;
  }
}

// ── Step execution loop (shared by confirmAndExecute + resume) ───────────────

async function _executeSteps(
  executionId,
  skill,
  params,
  stepsOutput,
  startIdx,
  originalInput,
  executionContext = {},
) {
  // Make original user input available as {{input}} in all step templates
  const effectiveParams = originalInput ? { ...params, input: originalInput } : params;

  const context = {
    executionId,
    skillId: skill.id,
    params: effectiveParams,
    stepsOutput,
    authorityBinding: executionContext.authorityBinding || null,
    effectAuthority: executionContext.authorityBinding ? installedEffectAuthority : null,
    signal: executionContext.signal || null,
  };

  for (let i = startIdx; i < skill.steps.length; i++) {
    const stepDef = skill.steps[i];
    const executor = STEP_EXECUTORS[stepDef.type];

    if (!executor) {
      _failExecution(executionId, `Unknown step type "${stepDef.type}" in step "${stepDef.id}"`);
      return { status: 'error', output: stepsOutput, error: `Unknown step type "${stepDef.type}"` };
    }

    // Update current step in DB
    skillExecutions.updateState.run('EXECUTING', stepDef.id, JSON.stringify(stepsOutput), executionId);

    const result = await _executeStepWithRetry(executor, stepDef, context);

    // Interactive step — checkpoint and return
    if (result.status === 'awaiting_input') {
      if (result.output != null) stepsOutput[stepDef.id] = result.output;
      _recordStep(executionId, stepDef, { ...result, status: 'awaiting_input' });
      skillExecutions.updateState.run('AWAITING_INPUT', stepDef.id, JSON.stringify(stepsOutput), executionId);

      logger.debug('SkillRunner', `Execution ${executionId} paused at step "${stepDef.id}" (${stepDef.type})`, {
        hasPrompt: !!result.prompt,
        hasContent: !!result.content,
      });

      return {
        status: 'awaiting_input',
        prompt: result.prompt || '',
        content: result.content || null,
        executionId,
        stepId: stepDef.id,
        stepType: stepDef.type,
        output: stepsOutput,
      };
    }

    // Record step result
    _recordStep(executionId, stepDef, result);

    if (result.status === 'error') {
      // ── Validate-fail retry: rewind to prior LLM step (1 attempt) ──────
      if (stepDef.type === 'validate' && result.errorType === 'validation' && !context._validateRetried) {
        const priorLLMIdx = _findPriorLLMStep(skill.steps, i);
        if (priorLLMIdx >= 0) {
          context._validateRetried = true;
          const priorStep = skill.steps[priorLLMIdx];
          const failReason = result.output || result.errorMessage || 'validation failed';

          logger.info('SkillRunner', `Validate failed — rewinding to step "${priorStep.id}" with fix context`, {
            failReason: failReason.substring(0, 100),
          });

          // Inject failure context into the prior step's stepsOutput so the LLM sees it
          stepsOutput._validateFailReason = failReason;

          // Rewind: re-run from the prior LLM step
          i = priorLLMIdx - 1; // -1 because the loop will i++
          continue;
        }
      }

      const errMsg = result.errorMessage || `Step "${stepDef.id}" failed`;
      _failExecution(executionId, errMsg);
      return { status: 'error', output: stepsOutput, error: errMsg };
    }

    // Accumulate output for next steps
    stepsOutput[stepDef.id] = result.output;
  }

  // All steps completed
  skillExecutions.updateState.run('DONE', null, JSON.stringify(stepsOutput), executionId);
  skillExecutions.complete.run('DONE', null, executionId);

  logger.info('SkillRunner', `Execution ${executionId} completed`, {
    skillId: skill.id,
    stepCount: skill.steps.length,
  });

  return { status: 'success', output: stepsOutput };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find the index of the nearest preceding LLM step before the given index.
 */
function _findPriorLLMStep(steps, validateIdx) {
  for (let j = validateIdx - 1; j >= 0; j--) {
    if (steps[j].type === 'llm') return j;
  }
  return -1;
}

/**
 * Process user input on resume — determines step output based on step type.
 */
function _processResumeInput(stepDef, userInput, params, stepsOutput) {
  if (stepDef.type === 'review') {
    // Approved → pass through the reviewed content
    if (REVIEW_APPROVE.test(userInput.trim())) {
      return substitute(stepDef.content || '', params, stepsOutput);
    }
    // Corrections/feedback → user input becomes the step output
    return userInput;
  }

  // ask (or any other interactive step) — user input is the output directly
  return userInput;
}

function _parseExactEffectApproval(input) {
  const match = String(input || '').trim().match(
    /^(?:schv[aá]lit\s+efekt|approve\s+effect)\s+(effect:[a-f0-9]{64})$/iu,
  );
  return match ? match[1] : null;
}

function _bindAuthority({ sessionId, conversationId, authorityContext }) {
  const subject = authorityContext?.authenticatedSubject;
  const projectId = Number(authorityContext?.project?.id ?? authorityContext?.projectId);
  const userMessageId = Number(authorityContext?.userMessageId);
  if (
    subject?.actorType !== 'user'
    || typeof subject.actorId !== 'string'
    || !Number.isSafeInteger(projectId)
    || projectId <= 0
    || !Number.isSafeInteger(userMessageId)
    || userMessageId <= 0
    || !sessionId
    || !conversationId
  ) throw Object.assign(
    new Error('Effectful skill requires an authenticated user, persisted message and active project'),
    { code: 'M3_SKILL_EFFECT_AUTHORITY_REQUIRED' },
  );
  return Object.freeze({
    actorType: 'user',
    actorId: subject.actorId,
    projectId,
    userMessageId,
    sessionId: String(sessionId),
    conversationId: String(conversationId),
  });
}

function _executionInputs(storedParams, executionContext) {
  const params = { ...(storedParams || {}) };
  const authorityBinding = params[AUTHORITY_PARAM] || null;
  delete params[AUTHORITY_PARAM];
  if (authorityBinding) {
    const subject = executionContext?.authenticatedSubject;
    if (subject?.actorType !== 'user' || subject.actorId !== authorityBinding.actorId) {
      throw Object.assign(new Error('Skill continuation caller does not own its effect authority'), {
        code: 'M3_SKILL_AUTHORITY_CALLER_MISMATCH',
      });
    }
  }
  return { params, authorityBinding };
}

function _normalizeParams(skill, provided) {
  if (!provided || typeof provided !== 'object' || Array.isArray(provided)) {
    throw new TypeError('Skill parameters must be an object');
  }
  if (Object.hasOwn(provided, AUTHORITY_PARAM)) {
    throw new TypeError(`Skill parameter ${AUTHORITY_PARAM} is reserved`);
  }
  const schema = skill.parameters || {};
  const normalized = {};
  for (const [name, definition] of Object.entries(schema)) {
    let value = provided[name];
    if ((value === undefined || value === null || value === '') && definition.default !== undefined) {
      value = definition.default;
    }
    if (value === undefined || value === null || value === '') {
      if (definition.required) throw new TypeError(`Missing required skill parameter "${name}"`);
      continue;
    }
    if (definition.type === 'string') {
      if (typeof value !== 'string') throw new TypeError(`Skill parameter "${name}" must be a string`);
      if (definition.maxLength && value.length > definition.maxLength) {
        throw new TypeError(`Skill parameter "${name}" exceeds maxLength`);
      }
      if (definition.pattern && !(new RegExp(definition.pattern, 'u')).test(value)) {
        throw new TypeError(`Skill parameter "${name}" does not match its pattern`);
      }
    } else if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new TypeError(`Skill parameter "${name}" must be a finite number`);
    } else if (definition.type === 'boolean' && typeof value !== 'boolean') {
      throw new TypeError(`Skill parameter "${name}" must be a boolean`);
    }
    normalized[name] = value;
  }
  for (const key of Object.keys(provided)) {
    if (!Object.hasOwn(schema, key)) throw new TypeError(`Unknown skill parameter "${key}"`);
  }
  return normalized;
}

async function _executeStepWithRetry(executor, stepDef, context) {
  let lastResult;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startTime = Date.now();
    lastResult = await executor(stepDef, context);
    lastResult.duration_ms = Date.now() - startTime;

    // Interactive steps are never retried
    if (lastResult.status === 'awaiting_input') {
      return lastResult;
    }

    if (lastResult.status === 'success') {
      return lastResult;
    }

    // Only retry transient errors
    if (!lastResult.retryable || lastResult.errorType !== 'transient') {
      return lastResult;
    }

    if (attempt < MAX_RETRIES) {
      logger.debug('SkillRunner', `Step "${stepDef.id}" failed (transient), retrying (${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  return lastResult;
}

function _recordStep(executionId, stepDef, result) {
  try {
    const outputStr = result.output != null
      ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
      : null;
    const outputHash = outputStr
      ? crypto.createHash('sha256').update(outputStr).digest('hex').substring(0, 16)
      : null;

    skillSteps.add.run(
      executionId,
      stepDef.id,
      stepDef.type,
      result.status,
      result.errorType || null,
      outputStr,
      outputHash,
      result.retryable ? 1 : 0,
      0, // retry_count tracked internally, not exposed per-step
      result.duration_ms || 0,
      result.errorMessage || null,
    );
  } catch (err) {
    logger.error('SkillRunner', `Failed to record step "${stepDef.id}": ${err.message}`);
  }
}

function _failExecution(executionId, errorMsg) {
  try {
    skillExecutions.complete.run('FAILED', errorMsg, executionId);
  } catch (err) {
    logger.error('SkillRunner', `Failed to mark execution ${executionId} as FAILED: ${err.message}`);
  }
}

export default {
  prepare,
  confirmAndExecute,
  resume,
  cancel,
  getStatus,
  setSkillEffectAuthority,
};
