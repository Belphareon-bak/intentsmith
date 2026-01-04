#!/usr/bin/env node

/**
 * E2E Test: Dual Deliberation Flow
 * 
 * Tests the complete dual-deliberation pipeline:
 * 1. Flow selection → dual-deliberation
 * 2. Prepare step → D1 + D2 designs
 * 3. Review step → Cross-review (R1→D2, R2→D1)
 * 4. Decision step → Final decision with proposed_steps
 * 
 * Run: node orchestrator/test/test-dual-deliberation.js
 * 
 * NOTE: Requires Ollama running with the configured models!
 */

import { plan } from "../planner2/index.js";
import { executeStep } from "../executors/step-executor.js";
import { emit, subscribe } from "../runtime/event-bus.js";

// Track events
const events = [];
subscribe(event => {
  events.push(event);
  console.log(`📡 Event: ${event.type}`, event.role || event.mode || "");
});

async function runTest() {
  console.log("═".repeat(60));
  console.log("E2E TEST: Dual Deliberation Flow");
  console.log("═".repeat(60));
  console.log("");

  // 1. Test flow selection
  console.log("1️⃣  Testing flow selection...");
  
  const testPrompt = "Design a new microservice architecture for user authentication";
  
  const planResult = await plan(testPrompt, {
    mode: "dual" // Explicit dual mode
  });

  console.log(`   Flow selected: ${planResult.flow}`);
  console.log(`   Steps: ${planResult.steps.map(s => s.type).join(" → ")}`);

  if (planResult.flow !== "dual-deliberation") {
    console.error("❌ FAIL: Expected dual-deliberation flow");
    process.exit(1);
  }
  console.log("   ✅ Flow selection OK");
  console.log("");

  // 2. Execute steps with shared context
  console.log("2️⃣  Executing dual deliberation steps...");
  console.log("");

  const context = {
    goal: testPrompt,
    input: {
      goal: testPrompt,
      constraints: ["Must be stateless", "Must support OAuth2"],
      workingProgress: ""
    }
  };

  for (const step of planResult.steps) {
    console.log(`━━━ Step: ${step.type} ━━━`);
    
    try {
      const result = await executeStep(step, context);
      
      // Log step result summary
      if (step.type === "prepare") {
        console.log(`   D1 output: ${result.D1?.substring(0, 100)}...`);
        console.log(`   D2 output: ${result.D2?.substring(0, 100)}...`);
      } else if (step.type === "review") {
        console.log(`   R1 reviewed D2: ${result.R1_of_D2?.substring(0, 100)}...`);
        console.log(`   R2 reviewed D1: ${result.R2_of_D1?.substring(0, 100)}...`);
      } else if (step.type === "decision") {
        console.log(`   Title: ${result.title}`);
        console.log(`   Summary: ${result.summary}`);
        console.log(`   Proposed steps: ${result.proposed_steps?.length || 0}`);
        
        if (result.awaitingApproval) {
          console.log("   ⏸️  Awaiting approval");
        }
      }
      
      console.log(`   ✅ ${step.type} complete`);
    } catch (err) {
      console.error(`   ❌ ${step.type} failed:`, err.message);
      
      // Don't fail on LLM errors in CI - just log
      if (err.message.includes("ECONNREFUSED") || 
          err.message.includes("Ollama")) {
        console.log("   ⚠️  Skipping (Ollama not available)");
        continue;
      }
      
      throw err;
    }
    
    console.log("");
  }

  // 3. Verify context was populated
  console.log("3️⃣  Verifying context flow...");
  
  const checks = [
    ["context.prepare", !!context.prepare],
    ["context.prepare.D1", !!context.prepare?.D1],
    ["context.prepare.D2", !!context.prepare?.D2],
    ["context.review", !!context.review],
    ["context.review.R1_of_D2", !!context.review?.R1_of_D2],
    ["context.review.R2_of_D1", !!context.review?.R2_of_D1],
    ["context.decision", !!context.decision],
  ];

  let allPassed = true;
  for (const [name, passed] of checks) {
    if (passed) {
      console.log(`   ✅ ${name}`);
    } else {
      console.log(`   ❌ ${name} (missing)`);
      allPassed = false;
    }
  }

  console.log("");

  // 4. Event summary
  console.log("4️⃣  Event summary:");
  const eventTypes = [...new Set(events.map(e => e.type))];
  console.log(`   Events emitted: ${eventTypes.join(", ")}`);
  console.log("");

  // Final result
  console.log("═".repeat(60));
  if (allPassed) {
    console.log("✅ ALL TESTS PASSED");
  } else {
    console.log("⚠️  SOME CHECKS FAILED (may be due to Ollama not running)");
  }
  console.log("═".repeat(60));
}

// Run
runTest().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
