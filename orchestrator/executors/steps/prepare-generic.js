import { emit } from "../../runtime/event-bus.js";
import { callLLM } from "../../llm/llm-client.js";

const PROMPT = `
You are a planning agent.

Based on the project context and design decisions,
propose next executable steps.

Respond in FREE TEXT.
Do NOT format as JSON.
`.trim();

export async function prepareStep(context) {
  emit({ type: "prepare_start" });

  const [outD1, outD2] = await Promise.all([
    callLLM({ role: "D1", prompt: PROMPT }),
    callLLM({ role: "D2", prompt: PROMPT })
  ]);

  emit({ type: "prepare_done" });

  return {
    D1: outD1,
    D2: outD2
  };
}
