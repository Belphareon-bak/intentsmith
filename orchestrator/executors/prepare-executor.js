import { emit } from "../runtime/event-bus.js";
import { callLLM } from "../llm/llm-client.js";

export async function runPrepare(step, context, role) {
  emit({ type: "prepare_start", role });

  const prompt = `
You are a planning agent.

Based on the design decisions and project context,
propose next executable steps.

Respond in FREE TEXT.
Do NOT format as JSON.
`.trim();

  const output = await callLLM({
    role,
    prompt
  });

  emit({ type: "prepare_done", role });

  return {
    proposal: output
  };
}
