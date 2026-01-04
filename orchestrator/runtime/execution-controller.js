import { emit } from "./event-bus.js";
import { executeStep } from "../executors/step-executor.js";
import {
  createExecution,
  loadExecution,
  updateMeta,
  saveProgress,
  appendEvent,
  saveContext,
  loadContext,
  listExecutions
} from "./state/state-store-exec.js";
import {
  isPaused,
  isCancelled,
  markFailed,
  resetControlFlags
} from "./execution-control.js";

const AUTO_APPROVE_LIMIT = Number(process.env.COPILOT_AUTO_APPROVE_STEPS || 5);

// In-memory tracking of current execution
let currentExecutionId = null;

/**
 * Start new execution with steps
 * 
 * @param {Array} steps - Execution steps
 * @param {Object} context - Initial context
 * @param {string} sandboxRoot - Sandbox directory
 * @returns {string} executionId
 */
export async function executeWithAutoApproval(steps, context = {}, sandboxRoot = process.cwd() + "/sandbox") {
  resetControlFlags();
  
  // Create persistent execution
  const executionId = createExecution({
    sandboxRoot,
    plan: { steps }
  });
  
  currentExecutionId = executionId;
  
  // Save initial context
  saveContext(executionId, context);
  
  updateMeta(executionId, { status: "running" });
  appendEvent(executionId, "EXECUTION_STARTED");
  
  emit({ type: "execution_start", executionId });
  
  // Start execution
  await runExecution(executionId);
  
  return executionId;
}

/**
 * Resume existing execution
 * 
 * @param {string} executionId - Execution to resume (optional, uses current if not provided)
 */
export async function resumeExecution(executionId = null) {
  const execId = executionId || currentExecutionId;
  
  if (!execId) {
    console.warn("⚠️ No execution to resume");
    return;
  }
  
  let execution;
  try {
    execution = loadExecution(execId);
  } catch (err) {
    console.error("❌ Cannot load execution:", err.message);
    emit({ type: "execution_error", error: "Execution not found" });
    return;
  }
  
  const { meta, progress } = execution;
  
  // Terminal state guards
  if (meta.status === "done") {
    emit({ type: "execution_done", executionId: execId });
    return;
  }
  
  if (meta.status === "failed") {
    emit({ type: "execution_failed", executionId: execId, reason: "previous_failure" });
    return;
  }
  
  if (meta.status === "cancelled") {
    emit({ type: "execution_cancelled", executionId: execId });
    return;
  }
  
  // Check if waiting for approval
  if (meta.status === "waiting_approval") {
    emit({ 
      type: "execution_paused", 
      executionId: execId,
      reason: "waiting_for_approval",
      approvalType: meta.approval_type,
      stepIndex: meta.approval_step
    });
    return;
  }
  
  // Update status and continue
  updateMeta(execId, { status: "running" });
  appendEvent(execId, "EXECUTION_RESUMED");
  emit({ type: "execution_resumed", executionId: execId });
  
  currentExecutionId = execId;
  await runExecution(execId);
}

/**
 * Approve and continue execution
 * 
 * @param {string} executionId
 * @param {Object} approvalData - Optional data from approval (e.g., answers to questions)
 */
export async function approveExecution(executionId, approvalData = {}) {
  let execution;
  try {
    execution = loadExecution(executionId);
  } catch (err) {
    emit({ type: "execution_error", error: "Execution not found" });
    return;
  }
  
  if (execution.meta.status !== "waiting_approval") {
    emit({ type: "execution_error", error: "Execution not waiting for approval" });
    return;
  }
  
  // Store approval data in context
  const context = loadContext(executionId);
  context.lastApproval = approvalData;
  saveContext(executionId, context);
  
  updateMeta(executionId, { 
    status: "running",
    approval_type: null,
    approval_step: null
  });
  
  appendEvent(executionId, `APPROVAL_GRANTED ${JSON.stringify(approvalData)}`);
  emit({ type: "approval_granted", executionId });
  
  currentExecutionId = executionId;
  await runExecution(executionId);
}

/**
 * Reject and cancel execution
 * 
 * @param {string} executionId
 * @param {string} reason
 */
export function rejectExecution(executionId, reason = "User rejected") {
  updateMeta(executionId, { status: "cancelled", cancel_reason: reason });
  appendEvent(executionId, `APPROVAL_REJECTED ${reason}`);
  emit({ type: "execution_cancelled", executionId, reason });
  
  if (currentExecutionId === executionId) {
    currentExecutionId = null;
  }
}

/**
 * Get current execution ID
 */
export function getCurrentExecutionId() {
  return currentExecutionId;
}

/**
 * Internal: Run execution loop
 */
async function runExecution(executionId) {
  const execution = loadExecution(executionId);
  const steps = execution.plan.steps;
  let progress = execution.progress;
  let context = loadContext(executionId);
  let autoApproved = 0;
  
  // ✅ FIX: Start from NEXT step after completed ones
  const startIndex = progress.completed_steps.length;
  
  appendEvent(executionId, `RESUME_FROM_STEP ${startIndex}`);
  
  for (let i = startIndex; i < steps.length; i++) {
    // Check control flags
    if (isCancelled()) {
      updateMeta(executionId, { status: "cancelled" });
      appendEvent(executionId, "EXECUTION_CANCELLED");
      emit({ type: "execution_cancelled", executionId });
      return;
    }
    
    if (isPaused()) {
      updateMeta(executionId, { status: "paused" });
      appendEvent(executionId, "EXECUTION_PAUSED");
      emit({ type: "execution_paused", executionId });
      return;
    }
    
    const step = steps[i];
    progress.current_step = i;
    saveProgress(executionId, progress);
    
    appendEvent(executionId, `STEP_START ${i} ${step.type}`);
    emit({ type: "step_start", executionId, stepIndex: i, step });
    
    try {
      const result = await executeStep(step, context);
      
      // Update context with step results
      saveContext(executionId, context);
      
      autoApproved++;
      
      // Check for approval conditions
      if (step.waitForApproval || result?.awaitingApproval) {
        updateMeta(executionId, { 
          status: "waiting_approval",
          approval_type: "step_checkpoint",
          approval_step: i
        });
        
        // Mark step as completed before waiting
        progress.completed_steps.push(i);
        saveProgress(executionId, progress);
        
        appendEvent(executionId, `WAITING_APPROVAL step=${i}`);
        emit({ 
          type: "approval_request", 
          executionId,
          name: "step_checkpoint",
          stepIndex: i,
          result: result?.decision || result
        });
        return;
      }
      
      if (autoApproved >= AUTO_APPROVE_LIMIT) {
        updateMeta(executionId, { 
          status: "waiting_approval",
          approval_type: "batch_checkpoint",
          approval_step: i
        });
        
        progress.completed_steps.push(i);
        saveProgress(executionId, progress);
        
        appendEvent(executionId, `WAITING_APPROVAL batch=${autoApproved}`);
        emit({ 
          type: "approval_request",
          executionId, 
          name: "batch_checkpoint",
          progress: i
        });
        return;
      }
      
      if (result?.questions?.length) {
        updateMeta(executionId, { 
          status: "waiting_approval",
          approval_type: "questions",
          approval_step: i
        });
        
        appendEvent(executionId, `WAITING_QUESTIONS count=${result.questions.length}`);
        emit({ 
          type: "approval_request",
          executionId, 
          name: "questions_checkpoint",
          questions: result.questions,
          progress: i
        });
        return;
      }
      
      // Step completed
      progress.completed_steps.push(i);
      saveProgress(executionId, progress);
      
      appendEvent(executionId, `STEP_DONE ${i}`);
      emit({ type: "step_done", executionId, stepIndex: i, result });
      
    } catch (err) {
      updateMeta(executionId, { status: "failed", error: String(err) });
      markFailed(i);
      appendEvent(executionId, `STEP_FAILED ${i} ${err.message}`);
      emit({ type: "step_failed", executionId, stepIndex: i, error: String(err) });
      return;
    }
  }
  
  // All steps completed
  updateMeta(executionId, { status: "done", completed_at: new Date().toISOString() });
  appendEvent(executionId, "EXECUTION_DONE");
  emit({ type: "execution_done", executionId });
  
  currentExecutionId = null;
}
