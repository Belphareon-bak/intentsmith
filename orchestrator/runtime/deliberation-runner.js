import fs from "fs";
import path from "path";
import Ajv from "ajv";

import roleBindings from "../config/role-model-binding.json" assert { type: "json" };
import policySchema from "../config/deliberation-policy.schema.json" assert { type: "json" };

const ajv = new Ajv({ allErrors: true });
const validatePolicy = ajv.compile(policySchema);

/**
 * Resolve deliberation policy from step/build defaults
 */
export function resolvePolicy(stepPolicy, buildPolicy) {
  return stepPolicy || buildPolicy || { mode: "single" };
}

/**
 * Validate deliberation policy
 */
export function assertValidPolicy(policy) {
  const ok = validatePolicy(policy);
  if (!ok) {
    throw new Error(
      "Invalid deliberation policy: " +
      JSON.stringify(validatePolicy.errors, null, 2)
    );
  }
}

/**
 * Resolve model for role (policy override > global binding)
 */
export function resolveModelForRole(role, policy) {
  if (policy?.bindings?.[role]) {
    return policy.bindings[role];
  }
  return roleBindings.roles[role];
}

/**
 * Run designers (D1/D2)
 */
export async function runDesigners({ prompt, policy, llmCall }) {
  const outputs = [];

  const designers = policy.designers || 1;
  const roles = designers === 1 ? ["D1"] : ["D1", "D2"];

  for (const role of roles) {
    const model = resolveModelForRole(role, policy);
    const systemPrompt = roleBindings.prompts[role];

    const output = await llmCall({
      role,
      model,
      systemPrompt,
      userPrompt: prompt
    });

    outputs.push({ role, model, output });
  }

  return outputs;
}

/**
 * Run reviewers (R1/R2) on given design
 */
export async function runReviewers({ design, policy, llmCall }) {
  const verdicts = [];

  const reviewers = policy.reviewers || 1;
  const roles = reviewers === 1 ? ["R1"] : ["R1", "R2"];

  for (const role of roles) {
    const model = resolveModelForRole(role, policy);
    const systemPrompt = roleBindings.prompts[role];

    const verdict = await llmCall({
      role,
      model,
      systemPrompt,
      userPrompt: design.output
    });

    verdicts.push({ role, model, verdict });
  }

  return verdicts;
}

/**
 * Check consensus
 */
export function consensusReached(verdicts, rule = "both_pass") {
  const passes = verdicts.filter(v => v.verdict?.verdict === "pass").length;

  if (rule === "both_pass") return passes === verdicts.length;
  if (rule === "majority") return passes >= Math.ceil(verdicts.length / 2);
  if (rule === "any_pass") return passes >= 1;

  return false;
}

/**
 * Decision step – consolidate final artifact
 */
export async function runDecision({ designs, reviews, policy, llmCall }) {
  const role = "Decision";
  const model = resolveModelForRole(role, policy);
  const systemPrompt = roleBindings.prompts[role];

  const payload = {
    designs,
    reviews
  };

  return await llmCall({
    role,
    model,
    systemPrompt,
    userPrompt: JSON.stringify(payload, null, 2)
  });
}
