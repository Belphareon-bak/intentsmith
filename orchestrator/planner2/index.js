import { normalizeContext } from "./context-schema.js";
import { selectFlowRuleBased, getFlow } from "../config/flow-selector.js";

/**
 * Planner entrypoint.
 * Receives:
 *  - prompt (string)
 *  - contextRaw (object)
 *    - project (persistent project state)
 */
export async function plan(prompt, contextRaw = {}) {
  const ctx = normalizeContext(contextRaw);
  const project = ctx.project || null;

  const p = (prompt || "").trim().toLowerCase();

  // ---- EXPLAIN (legacy / editor scoped) ----
  if (p.startsWith("explain")) {
    if (!ctx.selection) return { steps: [] };

    return {
      steps: [
        {
          type: "explain",
          languageId: ctx.languageId || "unknown",
          selection: ctx.selection,
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          filePath: ctx.filePath
        }
      ]
    };
  }

  // ---- FLOW-BASED PLANNING (Phase 1) ----
  const request = {
    prompt,
    goal: project?.project?.goal || prompt,
    mode: ctx.mode || null,
    flow: ctx.flow || null
  };

  const flowSelection = selectFlowRuleBased(request, {
    riskLevel: ctx.riskLevel || null,
    requiresReview: ctx.requiresReview || false
  });

  console.log(`🎯 Flow selected: ${flowSelection.selectedFlow}`);
  console.log(`   Reasoning: ${flowSelection.reasoning}`);

  const flowConfig = getFlow(flowSelection.selectedFlow);

  if (!flowConfig) {
    console.warn(`⚠️ Flow "${flowSelection.selectedFlow}" not found, using legacy planning`);
    return legacyPlan(prompt, ctx, project);
  }

  // Convert flow steps to execution steps
  const steps = flowConfig.steps.map(step => ({
    type: step.name,
    executor: step.executor,
    description: `${step.name} step (${flowSelection.selectedFlow} flow)`,
    waitForApproval: step.waitForApproval || false,
    input: {
      goal: project?.project?.goal || prompt,
      constraints: project?.project?.constraints || [],
      workingProgress: project?.workingProgress || "",
      decisions: project?.decisions || ""
    }
  }));

  return {
    flow: flowSelection.selectedFlow,
    flowReasoning: flowSelection.reasoning,
    steps
  };
}

/**
 * Legacy planning (fallback)
 */
function legacyPlan(prompt, ctx, project) {
  const steps = [];

  // 1) Analyze environment & project state
  steps.push({
    type: "analyze",
    description: "Analyze target environment and existing project context",
    input: {
      goal: project?.project?.goal || null,
      constraints: project?.project?.constraints || [],
      workingProgress: project?.workingProgress || "",
      decisions: project?.decisions || ""
    }
  });

  // 2) Design only if not already decided
  if (!project?.decisions || project.decisions.trim() === "" ||
      project.decisions.includes("No decisions recorded")) {
    steps.push({
      type: "design",
      description: "Design target architecture and component layout"
    });
  }

  // 3) Prepare execution plan
  steps.push({
    type: "prepare",
    description: "Prepare execution plan and required resources"
  });

  // 4) Explicit approval checkpoint
  steps.push({
    type: "approval_required",
    description: "Approve execution of the planned steps"
  });

  return { steps, flow: "legacy" };
}
