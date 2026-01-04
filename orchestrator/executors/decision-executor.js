import fs from "fs";
import path from "path";
import Ajv from "ajv";

import { emit } from "../runtime/event-bus.js";
import { audit } from "../runtime/audit.js";

import decisionSchema from "../config/decision-output.schema.json" assert { type: "json" };

const ajv = new Ajv({ allErrors: true, strict: true });
const validateDecision = ajv.compile(decisionSchema);

/**
 * Render DECISION.md from validated decision JSON
 */
function renderMarkdown(decision) {
  return `# ${decision.title}

## Summary
${decision.summary}

## Accepted Design
${decision.accepted_design}

## Rejected Alternatives
${decision.rejected_alternatives.map(a => `- ${a}`).join("\n") || "_None_"}

## Assumptions
${decision.assumptions.map(a => `- ${a}`).join("\n")}

## Next Steps
${decision.next_steps.map(s => `- ${s}`).join("\n")}
`;
}

/**
 * Decision Executor
 * -----------------
 * - Validates JSON output against schema
 * - Writes DECISION.md only on success
 */
export async function runDecisionExecutor({ decisionOutput, project }) {
  if (!project) {
    throw new Error("Decision executor requires project");
  }

  let decision;
  try {
    decision = typeof decisionOutput === "string"
      ? JSON.parse(decisionOutput)
      : decisionOutput;
  } catch (err) {
    throw new Error("Decision output must be valid JSON");
  }

  const ok = validateDecision(decision);
  if (!ok) {
    throw new Error(
      "Decision output schema validation failed:\n" +
      JSON.stringify(validateDecision.errors, null, 2)
    );
  }

  const projectDir = path.join(
    process.cwd(),
    "sandbox/projects",
    project
  );
  fs.mkdirSync(projectDir, { recursive: true });

  const artifactPath = path.join(projectDir, "DECISION.md");
  const markdown = renderMarkdown(decision);

  audit({
    phase: "decision_write",
    project,
    artifact: artifactPath
  });

  fs.writeFileSync(artifactPath, markdown, "utf-8");

  emit({
    type: "decision_done",
    project,
    artifact: "DECISION.md",
    path: artifactPath
  });

  return {
    artifact: "DECISION.md",
    path: artifactPath
  };
}
