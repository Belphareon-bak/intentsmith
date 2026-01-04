import { emit } from "../../runtime/event-bus.js";
import { callLLM } from "../../llm/llm-client.js";

/**
 * Review Step - Cross Review
 * 
 * Each reviewer reviews the OTHER designer's work:
 * - R1 reviews D2's design
 * - R2 reviews D1's design
 * 
 * This ensures independent, unbiased review.
 * 
 * @param {Object} context - Execution context with prepare results
 * @param {Object} context.prepare - Output from prepare step
 * @param {string} context.prepare.D1 - Designer 1's proposal
 * @param {string} context.prepare.D2 - Designer 2's proposal
 * @returns {{ R1_of_D2: string, R2_of_D1: string }}
 */
export async function reviewStep(context) {
  emit({ type: "review_start", mode: "cross" });

  const designs = context.prepare;
  
  if (!designs?.D1 || !designs?.D2) {
    throw new Error("Review step requires D1 and D2 designs from prepare step");
  }

  const reviewPromptTemplate = (designerRole, design) => `
You are a REVIEWER agent in a dual-deliberation system.
Your task is to critically review a design proposal from ${designerRole}.

## DESIGN TO REVIEW
${design}

## YOUR REVIEW MUST INCLUDE

### 1. Strengths
What are the strong points of this design?

### 2. Weaknesses
What are the potential issues, gaps, or risks?

### 3. Missing Considerations
What did the designer overlook?

### 4. Suggested Improvements
Specific, actionable improvements.

### 5. Verdict
One of: APPROVE, APPROVE_WITH_CHANGES, REQUEST_REVISION, REJECT

### 6. Confidence
Your confidence in this verdict (1-10)

Be thorough but fair. Focus on design quality, not style.
`.trim();

  // R1 reviews D2 (cross-review)
  console.log("🔍 Running R1 (reviewing D2's design)...");
  emit({ type: "reviewer_start", role: "R1", reviewing: "D2" });
  
  const r1 = await callLLM({
    role: "R1",
    prompt: reviewPromptTemplate("D2", designs.D2)
  });
  
  emit({ type: "reviewer_done", role: "R1", reviewing: "D2" });
  console.log("✅ R1 review complete");

  // R2 reviews D1 (cross-review)
  console.log("🔍 Running R2 (reviewing D1's design)...");
  emit({ type: "reviewer_start", role: "R2", reviewing: "D1" });
  
  const r2 = await callLLM({
    role: "R2",
    prompt: reviewPromptTemplate("D1", designs.D1)
  });
  
  emit({ type: "reviewer_done", role: "R2", reviewing: "D1" });
  console.log("✅ R2 review complete");

  emit({ type: "review_done", mode: "cross" });

  return {
    R1_of_D2: r1,
    R2_of_D1: r2
  };
}
