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
import { substitute } from './steps/substitute.js';
import { logger } from '../core/logger.js';

const MAX_RETRIES = 2;

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
export function prepare({ skillId, skillParams, input, confidence, sessionId, conversationId }) {
  try {
    const skill = skillRegistry.get(skillId);
    if (!skill) {
      logger.info('SkillRunner', `Skill "${skillId}" not found in registry`);
      return null;
    }

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`;

    skillExecutions.add.run(
      executionId,
      skillId,
      skill.version,
      'CONFIRMING',
      input,
      JSON.stringify(skillParams),
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
export async function confirmAndExecute(executionId) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (!exec) {
      return { status: 'error', output: null, error: `Execution "${executionId}" not found` };
    }

    if (exec.state !== 'CONFIRMING') {
      return { status: 'error', output: null, error: `Execution "${executionId}" is in state ${exec.state}, expected CONFIRMING` };
    }

    // Transition to EXECUTING
    skillExecutions.confirm.run(executionId);

    const skill = skillRegistry.get(exec.skill_id);
    if (!skill) {
      _failExecution(executionId, `Skill "${exec.skill_id}" no longer in registry`);
      return { status: 'error', output: null, error: `Skill "${exec.skill_id}" not found` };
    }

    const params = JSON.parse(exec.params || '{}');
    return _executeSteps(executionId, skill, params, {}, 0, exec.input);
  } catch (err) {
    logger.error('SkillRunner', `confirmAndExecute() failed: ${err.message}`);
    _failExecution(executionId, err.message);
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
export async function resume(executionId, userInput) {
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

    const params = JSON.parse(exec.params || '{}');
    const stepsOutput = JSON.parse(exec.steps_output || '{}');

    // Find the step that was awaiting input
    const awaitingIdx = skill.steps.findIndex(s => s.id === exec.current_step_id);
    if (awaitingIdx === -1) {
      _failExecution(executionId, `Awaiting step "${exec.current_step_id}" not found in skill definition`);
      return { status: 'error', output: stepsOutput, error: `Step "${exec.current_step_id}" not found` };
    }

    const awaitingStep = skill.steps[awaitingIdx];

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
    return _executeSteps(executionId, skill, params, stepsOutput, awaitingIdx + 1, exec.input);
  } catch (err) {
    logger.error('SkillRunner', `resume() failed: ${err.message}`);
    _failExecution(executionId, err.message);
    return { status: 'error', output: null, error: err.message };
  }
}

/**
 * Cancel a pending or awaiting execution.
 *
 * @param {string} executionId
 * @returns {boolean}
 */
export function cancel(executionId) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (!exec || (exec.state !== 'CONFIRMING' && exec.state !== 'AWAITING_INPUT')) return false;

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
    return {
      ...exec,
      params: JSON.parse(exec.params || '{}'),
      stepsOutput: JSON.parse(exec.steps_output || '{}'),
      steps,
    };
  } catch (err) {
    logger.error('SkillRunner', `getStatus() failed: ${err.message}`);
    return null;
  }
}

// ── Step execution loop (shared by confirmAndExecute + resume) ───────────────

async function _executeSteps(executionId, skill, params, stepsOutput, startIdx, originalInput) {
  // Make original user input available as {{input}} in all step templates
  const effectiveParams = originalInput ? { ...params, input: originalInput } : params;

  const context = {
    executionId,
    skillId: skill.id,
    params: effectiveParams,
    stepsOutput,
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
    const outputStr = result.output != null ? String(result.output) : null;
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
};
