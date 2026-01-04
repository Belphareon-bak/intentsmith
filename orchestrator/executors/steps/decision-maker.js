import fs from "fs";
import path from "path";
import Ajv from "ajv";
import { emit } from "../../runtime/event-bus.js";
import { callLLM } from "../../llm/llm-client.js";

const SCHEMA_PATH = path.resolve(
  process.cwd(),
  "orchestrator/config/decision-output.schema.json"
);

/**
 * Decision Step - Final Arbiter
 * 
 * Receives all designs and reviews, synthesizes them,
 * and produces a final DECISION artifact.
 * 
 * This step is NOT a designer - it's a judge that:
 * 1. Analyzes all inputs
 * 2. Selects the better approach
 * 3. Produces schema-validated output
 * 4. Optionally proposes execution steps
 * 
 * @param {Object} context - Full execution context
 * @returns {Object} DecisionOutput (schema-validated)
 */
export async function decisionStep(context) {
  emit({ type: "decision_start" });

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv();
  const validate = ajv.compile(schema);

  // Extract designs and reviews
  const designs = context.prepare || {};
  const reviews = context.review || {};

  const prompt = `
You are the FINAL DECISION MAKER in a dual-deliberation system.

## YOUR INPUTS

### Design D1
${designs.D1 || "Not available"}

### Design D2
${designs.D2 || "Not available"}

### Review of D2 (by R1)
${reviews.R1_of_D2 || "Not available"}

### Review of D1 (by R2)
${reviews.R2_of_D1 || "Not available"}

## YOUR TASK

Analyze all inputs and produce a FINAL DECISION.

You must:
1. Compare both designs objectively
2. Consider the reviews and their critiques
3. Select the better approach (or synthesize from both)
4. Produce a decision that can guide implementation

## OUTPUT FORMAT

You MUST return ONLY valid JSON matching this exact schema:

{
  "title": "Short descriptive title",
  "summary": "2-3 sentence summary of the decision",
  "accepted_design": "The full accepted design in markdown (can be D1, D2, or synthesis)",
  "ui_contract": {
    "reads_from_backend": ["list of data UI reads from backend"],
    "renders": ["list of things UI renders"],
    "never_computes": ["list of things UI must never compute"]
  },
  "forbidden_actions": ["action 1", "action 2"],
  "assumptions": ["assumption 1", "assumption 2"],
  "next_steps": ["step 1", "step 2"],
  "proposed_steps": [
    {"type": "fs", "action": "write_file", "path": "...", "content": "..."},
    {"type": "shell", "command": "...", "cwd": "sandbox"}
  ]
}

CRITICAL RULES:
- Return ONLY valid JSON
- No markdown code blocks
- No explanations outside the JSON
- All required fields must be present
- proposed_steps is optional but recommended
`.trim();

  console.log("⚖️ Running Decision Maker...");
  
  const raw = await callLLM({
    role: "D1", // Using D1 model for decision (most capable)
    prompt
  });

  // Try to extract JSON from response
  let parsed;
  try {
    // Try direct parse first
    parsed = JSON.parse(raw);
  } catch (err) {
    // Try to extract JSON from markdown code block
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[1]);
      } catch (e) {
        throw new Error("Decision output contains invalid JSON in code block");
      }
    } else {
      // Try to find JSON object in response
      const objectMatch = raw.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          parsed = JSON.parse(objectMatch[0]);
        } catch (e) {
          throw new Error("Decision output is not valid JSON");
        }
      } else {
        throw new Error("Decision output does not contain JSON");
      }
    }
  }

  // Validate against schema
  const ok = validate(parsed);
  if (!ok) {
    console.error("Schema validation errors:", validate.errors);
    throw new Error(
      "Decision JSON does not match schema:\n" +
      JSON.stringify(validate.errors, null, 2)
    );
  }

  console.log("✅ Decision validated against schema");

  emit({ 
    type: "decision_done", 
    title: parsed.title,
    hasProposedSteps: !!parsed.proposed_steps?.length
  });

  return {
    ...parsed,
    approved: true, // Decision maker approved the design
    proposed_steps: parsed.proposed_steps || []
  };
}
