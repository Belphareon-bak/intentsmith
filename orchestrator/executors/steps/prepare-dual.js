import { emit } from "../../runtime/event-bus.js";
import { callLLM } from "../../llm/llm-client.js";

/**
 * Prepare Step - Dual Deliberation
 * 
 * Generates two independent design proposals (D1 + D2).
 * Each designer sees the same task but works independently.
 * 
 * @param {Object} context - Execution context
 * @param {string} context.goal - Task goal/prompt
 * @param {Object} context.input - Additional input data
 * @returns {{ D1: string, D2: string }}
 */
export async function prepareStep(context) {
  emit({ type: "prepare_start", mode: "dual" });

  const goal = context.goal || context.input?.goal || "No goal specified";
  const constraints = context.input?.constraints || [];
  const workingProgress = context.input?.workingProgress || "";

  const basePrompt = `
You are a DESIGNER agent in a dual-deliberation system.
Your task is to create a detailed design proposal.

## TASK
${goal}

## CONSTRAINTS
${constraints.length > 0 ? constraints.map(c => `- ${c}`).join("\n") : "None specified"}

## EXISTING PROGRESS
${workingProgress || "Starting from scratch"}

## YOUR OUTPUT
Provide a comprehensive design proposal including:
1. Architecture overview
2. Key components and their responsibilities
3. Data flow
4. Potential risks and mitigations
5. Implementation steps (high-level)

Do NOT produce code. Focus on design decisions and rationale.
`.trim();

  console.log("🎨 Running D1 (Designer 1)...");
  emit({ type: "designer_start", role: "D1" });
  
  const d1 = await callLLM({
    role: "D1",
    prompt: basePrompt
  });
  
  emit({ type: "designer_done", role: "D1" });
  console.log("✅ D1 complete");

  console.log("🎨 Running D2 (Designer 2)...");
  emit({ type: "designer_start", role: "D2" });
  
  const d2 = await callLLM({
    role: "D2",
    prompt: basePrompt
  });
  
  emit({ type: "designer_done", role: "D2" });
  console.log("✅ D2 complete");

  emit({ type: "prepare_done", mode: "dual" });

  return {
    D1: d1,
    D2: d2
  };
}
