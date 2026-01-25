// CRE v41.0: Skill Executor
// ══════════════════════════════════════════════════════════════════════════════
//
// Executes skills with proper context, error handling, and observability.
//
// ══════════════════════════════════════════════════════════════════════════════

import { skillRegistry, StepType, SkillStatus } from './skill-registry.js';

/**
 * Execution status
 */
export const ExecutionStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  PAUSED: 'paused',
};

/**
 * Execution context for a skill run
 */
export class SkillExecutionContext {
  constructor(skill, inputs, options = {}) {
    this.skill = skill;
    this.executionId = options.executionId || `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.parentContext = options.parentContext || null;
    this.depth = options.depth || 0;

    // Input/output
    this.input = { ...inputs };
    this.output = {};

    // Step results
    this.steps = {};
    this.currentStep = null;
    this.stepStack = [];

    // Status tracking
    this.status = ExecutionStatus.PENDING;
    this.startTime = null;
    this.endTime = null;
    this.error = null;

    // Execution options
    this.dryRun = options.dryRun || false;
    this.sandbox = options.sandbox || null;
    this.timeout = options.timeout || 300000; // 5 minutes default
    this.maxDepth = options.maxDepth || 10;

    // Observability hooks
    this.trace = options.trace || null;
    this.onStepStart = options.onStepStart;
    this.onStepComplete = options.onStepComplete;
    this.onStepError = options.onStepError;

    // Cancellation
    this.cancelled = false;
    this.pauseRequested = false;
    this.resumePromise = null;
  }

  /**
   * Get a value from context by path
   */
  get(path) {
    const parts = path.split('.');
    let value = this;

    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }

    return value;
  }

  /**
   * Set a step result
   */
  setStepResult(stepId, result) {
    this.steps[stepId] = result;
  }

  /**
   * Get full context for variable resolution
   */
  getResolutionContext() {
    return {
      input: this.input,
      steps: this.steps,
      output: this.output,
      env: process.env,
      execution: {
        id: this.executionId,
        depth: this.depth,
        dryRun: this.dryRun,
      },
    };
  }

  /**
   * Request cancellation
   */
  cancel() {
    this.cancelled = true;
  }

  /**
   * Request pause
   */
  pause() {
    if (this.status === ExecutionStatus.RUNNING) {
      this.pauseRequested = true;
      return new Promise(resolve => {
        this.resumePromise = resolve;
      });
    }
  }

  /**
   * Resume after pause
   */
  resume() {
    if (this.pauseRequested && this.resumePromise) {
      this.pauseRequested = false;
      this.status = ExecutionStatus.RUNNING;
      this.resumePromise();
      this.resumePromise = null;
    }
  }

  /**
   * Create child context for nested skill execution
   */
  createChildContext(skill, inputs) {
    return new SkillExecutionContext(skill, inputs, {
      parentContext: this,
      depth: this.depth + 1,
      dryRun: this.dryRun,
      sandbox: this.sandbox,
      timeout: this.timeout,
      maxDepth: this.maxDepth,
      trace: this.trace,
      onStepStart: this.onStepStart,
      onStepComplete: this.onStepComplete,
      onStepError: this.onStepError,
    });
  }
}

/**
 * Skill executor
 */
export class SkillExecutor {
  constructor(options = {}) {
    this.registry = options.registry || skillRegistry;
    this.toolExecutor = options.toolExecutor || null;
    this.activeExecutions = new Map();
    this.executionHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;

    // Default tool executor (mock for now)
    if (!this.toolExecutor) {
      this.toolExecutor = {
        execute: async (toolId, params) => {
          console.log(`[MOCK] Executing tool ${toolId} with params:`, params);
          return { success: true, result: `Mock result for ${toolId}` };
        },
      };
    }
  }

  /**
   * Execute a skill
   */
  async execute(skillIdOrSkill, inputs = {}, options = {}) {
    // Resolve skill
    const skill = typeof skillIdOrSkill === 'string'
      ? this.registry.get(skillIdOrSkill)
      : skillIdOrSkill;

    if (!skill) {
      throw new Error(`Skill not found: ${skillIdOrSkill}`);
    }

    // Warn if not verified
    if (skill.status !== SkillStatus.VERIFIED && !options.allowUnverified) {
      console.warn(`Warning: Executing unverified skill ${skill.id} (status: ${skill.status})`);
    }

    // Validate inputs
    const inputValidation = skill.validateInputs(inputs);
    if (!inputValidation.valid) {
      throw new Error(`Invalid inputs: ${inputValidation.errors.join(', ')}`);
    }

    // Apply defaults
    const resolvedInputs = { ...inputs };
    for (const spec of skill.inputs) {
      if (resolvedInputs[spec.name] === undefined && spec.default !== undefined) {
        resolvedInputs[spec.name] = spec.default;
      }
    }

    // Create execution context
    const context = new SkillExecutionContext(skill, resolvedInputs, options);

    // Check depth limit
    if (context.depth > context.maxDepth) {
      throw new Error(`Maximum skill nesting depth exceeded (${context.maxDepth})`);
    }

    // Track execution
    this.activeExecutions.set(context.executionId, context);

    try {
      // Start execution
      context.status = ExecutionStatus.RUNNING;
      context.startTime = Date.now();

      // Check preconditions
      await this._checkPreconditions(skill, context);

      // Execute steps
      await this._executeSteps(skill.steps, context);

      // Check postconditions
      await this._checkPostconditions(skill, context);

      // Build output
      for (const outputSpec of skill.outputs) {
        const value = context.get(`steps.${outputSpec.name}`) ||
                      context.get(`output.${outputSpec.name}`);
        if (value !== undefined) {
          context.output[outputSpec.name] = value;
        }
      }

      context.status = ExecutionStatus.COMPLETED;
      context.endTime = Date.now();

      return {
        success: true,
        executionId: context.executionId,
        output: context.output,
        duration: context.endTime - context.startTime,
        stepsExecuted: Object.keys(context.steps).length,
      };

    } catch (error) {
      context.status = ExecutionStatus.FAILED;
      context.error = error;
      context.endTime = Date.now();

      return {
        success: false,
        executionId: context.executionId,
        error: error.message,
        failedStep: context.currentStep?.id,
        duration: context.endTime - context.startTime,
        stepsExecuted: Object.keys(context.steps).length,
      };

    } finally {
      this.activeExecutions.delete(context.executionId);
      this._addToHistory(context);
    }
  }

  /**
   * Execute steps
   */
  async _executeSteps(steps, context) {
    for (const step of steps) {
      // Check cancellation
      if (context.cancelled) {
        context.status = ExecutionStatus.CANCELLED;
        throw new Error('Execution cancelled');
      }

      // Handle pause
      if (context.pauseRequested) {
        context.status = ExecutionStatus.PAUSED;
        await new Promise(resolve => {
          context.resumePromise = resolve;
        });
      }

      // Execute step
      context.currentStep = step;
      context.stepStack.push(step.id);

      try {
        // Notify step start
        if (context.onStepStart) {
          await context.onStepStart(step, context);
        }

        // Execute based on step type
        let result;
        switch (step.type) {
          case StepType.TOOL:
            result = await this._executeToolStep(step, context);
            break;
          case StepType.SKILL:
            result = await this._executeSkillStep(step, context);
            break;
          case StepType.CONDITION:
            result = await this._executeConditionStep(step, context);
            break;
          case StepType.LOOP:
            result = await this._executeLoopStep(step, context);
            break;
          case StepType.TRANSFORM:
            result = await this._executeTransformStep(step, context);
            break;
          case StepType.VALIDATE:
            result = await this._executeValidateStep(step, context);
            break;
          default:
            throw new Error(`Unknown step type: ${step.type}`);
        }

        context.setStepResult(step.id, result);

        // Notify step complete
        if (context.onStepComplete) {
          await context.onStepComplete(step, result, context);
        }

      } catch (error) {
        // Notify step error
        if (context.onStepError) {
          await context.onStepError(step, error, context);
        }

        // Handle error based on step configuration
        if (step.optional) {
          console.warn(`Optional step ${step.id} failed:`, error.message);
          context.setStepResult(step.id, { error: error.message, skipped: true });
        } else if (step.onError === 'skip') {
          console.warn(`Skipping step ${step.id} after error:`, error.message);
          context.setStepResult(step.id, { error: error.message, skipped: true });
        } else if (step.onError === 'retry' && step.retries > 0) {
          // Retry logic
          let lastError = error;
          for (let i = 0; i < step.retries; i++) {
            try {
              const retryResult = await this._executeSteps([step], context);
              context.setStepResult(step.id, retryResult);
              lastError = null;
              break;
            } catch (retryError) {
              lastError = retryError;
            }
          }
          if (lastError) throw lastError;
        } else {
          throw error;
        }
      } finally {
        context.stepStack.pop();
      }
    }
  }

  /**
   * Execute a tool step
   */
  async _executeToolStep(step, context) {
    const params = step.resolveParams(context.getResolutionContext());

    if (context.dryRun) {
      return { dryRun: true, toolId: step.toolId, params };
    }

    const result = await this._withTimeout(
      this.toolExecutor.execute(step.toolId, params, { sandbox: context.sandbox }),
      step.timeout || context.timeout
    );

    return result;
  }

  /**
   * Execute a nested skill step
   */
  async _executeSkillStep(step, context) {
    const nestedSkill = this.registry.get(step.skillId);
    if (!nestedSkill) {
      throw new Error(`Nested skill not found: ${step.skillId}`);
    }

    const params = step.resolveParams(context.getResolutionContext());
    const childContext = context.createChildContext(nestedSkill, params);

    const result = await this.execute(nestedSkill, params, {
      ...childContext,
      parentContext: context,
    });

    if (!result.success) {
      throw new Error(`Nested skill ${step.skillId} failed: ${result.error}`);
    }

    return result.output;
  }

  /**
   * Execute a condition step
   */
  async _executeConditionStep(step, context) {
    const resolutionContext = context.getResolutionContext();
    let conditionResult;

    if (typeof step.condition === 'function') {
      conditionResult = await step.condition(resolutionContext);
    } else if (typeof step.condition === 'string') {
      // Simple expression evaluation (careful with security!)
      conditionResult = this._evaluateExpression(step.condition, resolutionContext);
    } else {
      conditionResult = !!step.condition;
    }

    const stepsToExecute = conditionResult ? step.thenSteps : step.elseSteps;
    if (stepsToExecute.length > 0) {
      await this._executeSteps(stepsToExecute, context);
    }

    return { condition: conditionResult, branch: conditionResult ? 'then' : 'else' };
  }

  /**
   * Execute a loop step
   */
  async _executeLoopStep(step, context) {
    const resolutionContext = context.getResolutionContext();
    let items;

    if (typeof step.loopOver === 'function') {
      items = await step.loopOver(resolutionContext);
    } else if (typeof step.loopOver === 'string') {
      items = this._resolvePath(step.loopOver, resolutionContext);
    } else {
      items = step.loopOver;
    }

    if (!Array.isArray(items)) {
      items = [items];
    }

    const results = [];
    const maxIter = Math.min(items.length, step.maxIterations);

    for (let i = 0; i < maxIter; i++) {
      const item = items[i];

      // Add loop variables to context
      context.steps[`${step.id}_item`] = item;
      context.steps[`${step.id}_index`] = i;

      await this._executeSteps(step.loopSteps, context);

      results.push({
        index: i,
        item,
        stepResults: { ...context.steps },
      });
    }

    return { iterations: results.length, results };
  }

  /**
   * Execute a transform step
   */
  async _executeTransformStep(step, context) {
    const resolutionContext = context.getResolutionContext();

    if (typeof step.transform === 'function') {
      return await step.transform(resolutionContext);
    }

    throw new Error('Transform step requires a function');
  }

  /**
   * Execute a validate step
   */
  async _executeValidateStep(step, context) {
    const resolutionContext = context.getResolutionContext();
    let valid;

    if (typeof step.validator === 'function') {
      valid = await step.validator(resolutionContext);
    } else if (typeof step.validator === 'string') {
      // Built-in validators
      valid = await this._runBuiltInValidator(step.validator, resolutionContext);
    } else {
      valid = true;
    }

    if (!valid) {
      throw new Error(step.errorMessage || `Validation failed at step ${step.id}`);
    }

    return { valid: true };
  }

  /**
   * Check preconditions
   */
  async _checkPreconditions(skill, context) {
    for (const precondition of skill.preconditions) {
      if (typeof precondition === 'function') {
        const result = await precondition(context.getResolutionContext());
        if (!result) {
          throw new Error('Precondition failed');
        }
      }
    }
  }

  /**
   * Check postconditions
   */
  async _checkPostconditions(skill, context) {
    for (const postcondition of skill.postconditions) {
      if (typeof postcondition === 'function') {
        const result = await postcondition(context.getResolutionContext());
        if (!result) {
          throw new Error('Postcondition failed');
        }
      }
    }
  }

  /**
   * Run built-in validator
   */
  async _runBuiltInValidator(validatorName, context) {
    const validators = {
      syntax_check: () => true, // Placeholder
      file_exists: () => true,  // Placeholder
      not_empty: (ctx) => !!ctx.steps && Object.keys(ctx.steps).length > 0,
    };

    const validator = validators[validatorName];
    if (!validator) {
      throw new Error(`Unknown validator: ${validatorName}`);
    }

    return validator(context);
  }

  /**
   * Evaluate simple expression (limited for safety)
   */
  _evaluateExpression(expr, context) {
    // Only allow simple comparisons and boolean logic
    // This is a simplified implementation - in production, use a proper expression parser
    const cleanExpr = expr.replace(/\$([a-zA-Z_.]+)/g, (_, path) => {
      const value = this._resolvePath(path, context);
      return JSON.stringify(value);
    });

    // Very limited evaluation
    if (cleanExpr === 'true') return true;
    if (cleanExpr === 'false') return false;

    // Simple equality check
    const eqMatch = cleanExpr.match(/^(.+)\s*===?\s*(.+)$/);
    if (eqMatch) {
      try {
        const left = JSON.parse(eqMatch[1]);
        const right = JSON.parse(eqMatch[2]);
        return left === right;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Resolve a path in context
   */
  _resolvePath(path, context) {
    const cleanPath = path.startsWith('$') ? path.slice(1) : path;
    const parts = cleanPath.split('.');
    let value = context;

    for (const part of parts) {
      if (value === undefined || value === null) return undefined;
      value = value[part];
    }

    return value;
  }

  /**
   * Execute with timeout
   */
  async _withTimeout(promise, timeout) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Execution timeout')), timeout);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Add execution to history
   */
  _addToHistory(context) {
    this.executionHistory.push({
      executionId: context.executionId,
      skillId: context.skill.id,
      status: context.status,
      startTime: context.startTime,
      endTime: context.endTime,
      duration: context.endTime - context.startTime,
      error: context.error?.message,
    });

    // Trim history
    while (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  /**
   * Get active executions
   */
  getActiveExecutions() {
    return Array.from(this.activeExecutions.values()).map(ctx => ({
      executionId: ctx.executionId,
      skillId: ctx.skill.id,
      status: ctx.status,
      startTime: ctx.startTime,
      currentStep: ctx.currentStep?.id,
    }));
  }

  /**
   * Get execution history
   */
  getHistory(options = {}) {
    let history = [...this.executionHistory];

    if (options.skillId) {
      history = history.filter(h => h.skillId === options.skillId);
    }

    if (options.status) {
      history = history.filter(h => h.status === options.status);
    }

    if (options.limit) {
      history = history.slice(-options.limit);
    }

    return history;
  }

  /**
   * Cancel an active execution
   */
  cancel(executionId) {
    const context = this.activeExecutions.get(executionId);
    if (context) {
      context.cancel();
      return true;
    }
    return false;
  }

  /**
   * Pause an active execution
   */
  pause(executionId) {
    const context = this.activeExecutions.get(executionId);
    if (context) {
      return context.pause();
    }
    return null;
  }

  /**
   * Resume a paused execution
   */
  resume(executionId) {
    const context = this.activeExecutions.get(executionId);
    if (context) {
      context.resume();
      return true;
    }
    return false;
  }
}

// Singleton instance
export const skillExecutor = new SkillExecutor();

/**
 * Convenience function to execute a skill
 */
export async function executeSkill(skillId, inputs = {}, options = {}) {
  return skillExecutor.execute(skillId, inputs, options);
}
