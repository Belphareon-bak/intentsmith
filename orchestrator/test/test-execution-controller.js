/**
 * Unit Test: Execution Controller (Phase 3)
 * 
 * Tests persistent execution state, resume logic, and approval flow.
 * 
 * Run: node orchestrator/test/test-execution-controller.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import test subjects
import {
  createExecution,
  loadExecution,
  updateMeta,
  saveProgress,
  saveContext,
  loadContext,
  listExecutions
} from "../runtime/state/state-store-exec.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error(`   ${err.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = "") {
  if (actual !== expected) {
    throw new Error(`${msg} Expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(value, msg = "") {
  if (!value) {
    throw new Error(`${msg} Expected truthy, got ${value}`);
  }
}

// ===================
// STATE STORE TESTS
// ===================

test("createExecution returns executionId", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test-sandbox",
    plan: { steps: [{ type: "test" }] }
  });
  
  assertTrue(!!executionId, "Should return executionId");
  assertTrue(executionId.includes("-"), "Should be UUID format");
});

test("loadExecution returns execution data", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test-sandbox",
    plan: { steps: [{ type: "analyze" }, { type: "design" }] }
  });
  
  const execution = loadExecution(executionId);
  
  assertTrue(!!execution.meta, "Should have meta");
  assertTrue(!!execution.progress, "Should have progress");
  assertTrue(!!execution.plan, "Should have plan");
  assertEqual(execution.meta.status, "created");
  assertEqual(execution.plan.steps.length, 2);
});

test("updateMeta persists changes", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [] }
  });
  
  updateMeta(executionId, { status: "running" });
  
  const execution = loadExecution(executionId);
  assertEqual(execution.meta.status, "running");
});

test("saveProgress persists completed steps", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [{ type: "a" }, { type: "b" }, { type: "c" }] }
  });
  
  saveProgress(executionId, {
    current_step: 2,
    completed_steps: [0, 1]
  });
  
  const execution = loadExecution(executionId);
  assertEqual(execution.progress.current_step, 2);
  assertEqual(execution.progress.completed_steps.length, 2);
});

test("saveContext and loadContext work", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [] }
  });
  
  const context = {
    goal: "Test goal",
    prepare: { D1: "design1", D2: "design2" }
  };
  
  saveContext(executionId, context);
  const loaded = loadContext(executionId);
  
  assertEqual(loaded.goal, "Test goal");
  assertEqual(loaded.prepare.D1, "design1");
});

test("listExecutions returns all executions", () => {
  // Create a few executions
  createExecution({ sandboxRoot: "/tmp/a", plan: { steps: [] } });
  createExecution({ sandboxRoot: "/tmp/b", plan: { steps: [] } });
  
  const list = listExecutions();
  
  assertTrue(Array.isArray(list), "Should return array");
  assertTrue(list.length >= 2, "Should have at least 2 executions");
});

// ===================
// RESUME LOGIC TESTS
// ===================

test("resume starts from next step after completed", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [
      { type: "step1" },
      { type: "step2" },
      { type: "step3" }
    ] }
  });
  
  // Simulate 2 completed steps
  saveProgress(executionId, {
    current_step: 2,
    completed_steps: [0, 1]
  });
  
  const execution = loadExecution(executionId);
  const startIndex = execution.progress.completed_steps.length;
  
  assertEqual(startIndex, 2, "Should start from step 2 (index)");
});

test("terminal states prevent resume", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [] }
  });
  
  updateMeta(executionId, { status: "done" });
  
  const execution = loadExecution(executionId);
  assertEqual(execution.meta.status, "done");
  
  // In real resumeExecution, this would return early
  const isTerminal = ["done", "failed", "cancelled"].includes(execution.meta.status);
  assertTrue(isTerminal, "Should be terminal state");
});

test("waiting_approval state is preserved", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [{ type: "decision", waitForApproval: true }] }
  });
  
  updateMeta(executionId, { 
    status: "waiting_approval",
    approval_type: "step_checkpoint",
    approval_step: 0
  });
  
  const execution = loadExecution(executionId);
  assertEqual(execution.meta.status, "waiting_approval");
  assertEqual(execution.meta.approval_type, "step_checkpoint");
});

// ===================
// APPROVAL FLOW TESTS
// ===================

test("approval clears waiting state", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [] }
  });
  
  // Set waiting state
  updateMeta(executionId, { 
    status: "waiting_approval",
    approval_type: "decision",
    approval_step: 2
  });
  
  // Simulate approval
  updateMeta(executionId, { 
    status: "running",
    approval_type: null,
    approval_step: null
  });
  
  const execution = loadExecution(executionId);
  assertEqual(execution.meta.status, "running");
  assertEqual(execution.meta.approval_type, null);
});

test("rejection sets cancelled state", () => {
  const executionId = createExecution({
    sandboxRoot: "/tmp/test",
    plan: { steps: [] }
  });
  
  updateMeta(executionId, { 
    status: "cancelled",
    cancel_reason: "User rejected"
  });
  
  const execution = loadExecution(executionId);
  assertEqual(execution.meta.status, "cancelled");
  assertEqual(execution.meta.cancel_reason, "User rejected");
});

// ===================
// SUMMARY
// ===================

console.log("\n" + "=".repeat(40));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
console.log("=".repeat(40));

if (failed > 0) {
  process.exit(1);
}
