/**
 * Unit Test: Context Flow Between Steps
 * 
 * Tests that context is properly passed and accumulated
 * between execution steps WITHOUT calling LLM.
 * 
 * Run: node orchestrator/test/test-context-flow.js
 */

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
// CONTEXT FLOW TESTS
// ===================

test("context accumulates prepare results", () => {
  const context = {};
  
  // Simulate prepare step result
  const prepareResult = { D1: "design1", D2: "design2" };
  context.prepare = prepareResult;
  
  assertTrue(context.prepare.D1 === "design1");
  assertTrue(context.prepare.D2 === "design2");
});

test("context accumulates review results", () => {
  const context = {
    prepare: { D1: "design1", D2: "design2" }
  };
  
  // Simulate review step result
  const reviewResult = { R1_of_D2: "review1", R2_of_D1: "review2" };
  context.review = reviewResult;
  
  assertTrue(context.review.R1_of_D2 === "review1");
  assertTrue(context.review.R2_of_D1 === "review2");
  
  // Prepare still accessible
  assertTrue(context.prepare.D1 === "design1");
});

test("context accumulates decision results", () => {
  const context = {
    prepare: { D1: "design1", D2: "design2" },
    review: { R1_of_D2: "review1", R2_of_D1: "review2" }
  };
  
  // Simulate decision step result
  const decisionResult = {
    title: "Final Decision",
    summary: "Summary",
    proposed_steps: [{ type: "fs", action: "write" }]
  };
  context.decision = decisionResult;
  
  assertTrue(context.decision.title === "Final Decision");
  assertTrue(context.decision.proposed_steps.length === 1);
  
  // All previous steps still accessible
  assertTrue(context.prepare.D1 === "design1");
  assertTrue(context.review.R1_of_D2 === "review1");
});

test("step input merges into context", () => {
  const context = { existingData: "preserved" };
  
  const stepInput = {
    goal: "new goal",
    constraints: ["c1", "c2"]
  };
  
  // Simulate input merge (as done in step-executor)
  context.goal = stepInput.goal;
  context.constraints = stepInput.constraints;
  context.input = { ...context.input, ...stepInput };
  
  assertEqual(context.goal, "new goal");
  assertEqual(context.constraints.length, 2);
  assertEqual(context.existingData, "preserved");
});

test("cross-review accesses correct designs", () => {
  const context = {
    prepare: {
      D1: "Designer 1 proposal",
      D2: "Designer 2 proposal"
    }
  };
  
  // R1 should review D2
  const r1Input = context.prepare.D2;
  assertEqual(r1Input, "Designer 2 proposal");
  
  // R2 should review D1
  const r2Input = context.prepare.D1;
  assertEqual(r2Input, "Designer 1 proposal");
});

test("decision has access to all inputs", () => {
  const context = {
    goal: "Build auth service",
    prepare: {
      D1: "Design A",
      D2: "Design B"
    },
    review: {
      R1_of_D2: "Review of Design B",
      R2_of_D1: "Review of Design A"
    }
  };
  
  // Decision should see everything
  assertTrue(!!context.goal);
  assertTrue(!!context.prepare.D1);
  assertTrue(!!context.prepare.D2);
  assertTrue(!!context.review.R1_of_D2);
  assertTrue(!!context.review.R2_of_D1);
});

// ===================
// FLOW CONFIG TESTS
// ===================

import { FLOWS } from "../config/flows.js";

test("dual-deliberation flow has correct steps", () => {
  const flow = FLOWS["dual-deliberation"];
  assertTrue(!!flow, "Flow should exist");
  
  const stepNames = flow.steps.map(s => s.name);
  assertTrue(stepNames.includes("prepare"));
  assertTrue(stepNames.includes("review"));
  assertTrue(stepNames.includes("decision"));
});

test("decision step requires approval", () => {
  const flow = FLOWS["dual-deliberation"];
  const decisionStep = flow.steps.find(s => s.name === "decision");
  assertTrue(decisionStep.waitForApproval === true);
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
