/**
 * Flow Selector Unit Tests
 * 
 * Run: node orchestrator/test/test-flow-selector.js
 */

import { 
  selectFlowRuleBased, 
  getFlow, 
  getAvailableFlows,
  flowExists 
} from "../config/flow-selector.js";

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
    throw new Error(`${msg} Expected truthy value, got ${value}`);
  }
}

// ===================
// FLOW REGISTRY TESTS
// ===================

test("getAvailableFlows returns array", () => {
  const flows = getAvailableFlows();
  assertTrue(Array.isArray(flows), "Should be array");
  assertTrue(flows.length >= 2, "Should have at least 2 flows");
});

test("flowExists returns true for known flows", () => {
  assertTrue(flowExists("single-pass"), "single-pass should exist");
  assertTrue(flowExists("dual-deliberation"), "dual-deliberation should exist");
});

test("flowExists returns false for unknown flows", () => {
  assertTrue(!flowExists("unknown-flow"), "unknown-flow should not exist");
});

test("getFlow returns flow config", () => {
  const flow = getFlow("single-pass");
  assertTrue(flow !== null, "Should return flow");
  assertTrue(Array.isArray(flow.steps), "Flow should have steps");
});

test("getFlow returns null for unknown flow", () => {
  const flow = getFlow("nonexistent");
  assertTrue(flow === null, "Should return null");
});

// ===================
// FLOW SELECTION TESTS
// ===================

test("explicit flow=dual-deliberation is respected", () => {
  const result = selectFlowRuleBased({ flow: "dual-deliberation" });
  assertEqual(result.selectedFlow, "dual-deliberation");
  assertEqual(result.confidence, 1.0);
});

test("explicit flow=single-pass is respected", () => {
  const result = selectFlowRuleBased({ flow: "single-pass" });
  assertEqual(result.selectedFlow, "single-pass");
});

test("mode=dual selects dual-deliberation", () => {
  const result = selectFlowRuleBased({ mode: "dual" });
  assertEqual(result.selectedFlow, "dual-deliberation");
});

test("complex keywords trigger dual-deliberation", () => {
  const complexGoals = [
    "architect a new microservice",
    "design the API layer",
    "refactor authentication system",
    "migrate to PostgreSQL",
    "security audit implementation",
    "optimize database queries",
    "scale the infrastructure"
  ];

  for (const goal of complexGoals) {
    const result = selectFlowRuleBased({ goal });
    assertEqual(
      result.selectedFlow, 
      "dual-deliberation", 
      `Goal "${goal}" should trigger dual`
    );
  }
});

test("simple keywords trigger single-pass", () => {
  const simpleGoals = [
    "fix bug in login",
    "add comment to function",
    "rename variable",
    "format code",
    "update readme file",
    "bump version to 1.2.3"
  ];

  for (const goal of simpleGoals) {
    const result = selectFlowRuleBased({ goal });
    assertEqual(
      result.selectedFlow, 
      "single-pass", 
      `Goal "${goal}" should trigger single-pass`
    );
  }
});

test("high riskLevel context triggers dual", () => {
  const result = selectFlowRuleBased(
    { goal: "something generic" },
    { riskLevel: "high" }
  );
  assertEqual(result.selectedFlow, "dual-deliberation");
});

test("requiresReview context triggers dual", () => {
  const result = selectFlowRuleBased(
    { goal: "something generic" },
    { requiresReview: true }
  );
  assertEqual(result.selectedFlow, "dual-deliberation");
});

test("default fallback is single-pass", () => {
  const result = selectFlowRuleBased({ goal: "do something" });
  assertEqual(result.selectedFlow, "single-pass");
  assertEqual(result.ruleMatched, null);
  assertTrue(result.confidence < 1.0, "Fallback should have lower confidence");
});

test("prompt field is also checked", () => {
  const result = selectFlowRuleBased({ prompt: "architect new system" });
  assertEqual(result.selectedFlow, "dual-deliberation");
});

// ===================
// EDGE CASES
// ===================

test("empty request uses fallback", () => {
  const result = selectFlowRuleBased({});
  assertEqual(result.selectedFlow, "single-pass");
});

test("null values don't crash", () => {
  const result = selectFlowRuleBased({ goal: null, prompt: null });
  assertTrue(result.selectedFlow !== undefined);
});

test("undefined context is handled", () => {
  const result = selectFlowRuleBased({ goal: "test" });
  assertTrue(result.selectedFlow !== undefined);
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
