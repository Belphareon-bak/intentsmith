import { emit } from "../runtime/event-bus.js";
import { audit } from "../runtime/audit.js";
import { analyzeEnvironment } from "./steps/analyze-environment.js";
import { writeFileSandboxed } from "./fs-executor.js";
import { runShell } from "./shell-executor.js";

/**
 * Jediný zdroj pravdy:
 * které kroky VYŽADUJÍ LLM (a tedy role + model)
 */
const LLM_STEPS = new Set([
  "design",
  "prepare",
  "review",
  "decision"
]);

function resolveRole(step) {
  if (step.role) return step.role;
  if (step.roles && step.roles.length) return step.roles[0];

  switch (step.type) {
    case "design":
    case "prepare":
      return "D1";
    case "review":
      return "R1";
    case "decision":
      return "D1"; // Decision uses capable model
    default:
      return null;
  }
}

/**
 * Execute a single step
 * 
 * @param {Object} step - Step definition
 * @param {Object} context - Shared execution context (mutable)
 * @returns {Object} Step result
 */
export async function executeStep(step, context = {}) {
  const role = resolveRole(step);

  // ✅ SPRÁVNÁ LOGIKA: pouze LLM kroky vyžadují roli
  if (LLM_STEPS.has(step.type) && !role) {
    throw new Error(`LLM role is required for step type: ${step.type}`);
  }

  emit({ type: "step_start", name: step.type, step, role });
  audit({ phase: "start", step, role });

  let result;

  // Merge step input into context
  if (step.input) {
    context.goal = step.input.goal || context.goal;
    context.constraints = step.input.constraints || context.constraints;
    context.workingProgress = step.input.workingProgress || context.workingProgress;
    context.input = { ...context.input, ...step.input };
  }

  switch (step.type) {
    case "analyze":
      result = await analyzeEnvironment();
      context.analysis = result;
      break;

    case "design":
      result = await (await import("./design-executor.js"))
        .runDesign(step, context, role);
      context.design = result;
      break;

    case "prepare":
      result = await (await import("./steps/prepare-dual.js"))
        .prepareStep(context);
      // Store prepare results in context for review step
      context.prepare = result;
      break;

    case "review":
      result = await (await import("./steps/review-cross.js"))
        .reviewStep(context);
      // Store review results in context for decision step
      context.review = result;
      break;

    case "decision":
      result = await (await import("./steps/decision-maker.js"))
        .decisionStep(context);
      context.decision = result;
      
      // If decision has proposed_steps, signal for approval
      if (result.proposed_steps?.length > 0) {
        result.awaitingApproval = true;
      }
      break;

    case "approval_required":
      emit({ type: "approval_request", reason: "plan_checkpoint" });
      result = { awaitingApproval: true };
      break;

    case "fs":
      writeFileSandboxed(step.details, process.cwd() + "/sandbox");
      result = { ok: true };
      break;

    case "shell":
      await runShell(step.details, process.cwd() + "/sandbox");
      result = { ok: true };
      break;

    default:
      result = { status: "skipped", step: step.type };
  }

  audit({ phase: "done", step, role, result });
  emit({ type: "step_done", name: step.type, step, role, result });
  return result;
}
