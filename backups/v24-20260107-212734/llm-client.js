import fs from "fs";
import path from "path";
import crypto from "crypto";
import { callOllama } from "./ollama-client.js";
import { llmLog } from "../utils/logger.js";

/* -------- role → model binding -------- */

const ROLE_MODEL_PATH = path.resolve(
  process.cwd(),
  "orchestrator/config/role-model-binding.json"
);

function loadRoleModels() {
  if (!fs.existsSync(ROLE_MODEL_PATH)) {
    throw new Error("role-model-binding.json not found");
  }
  return JSON.parse(fs.readFileSync(ROLE_MODEL_PATH, "utf-8"));
}

/* -------- debug -------- */

const DEBUG_DIR = path.resolve(
  process.cwd(),
  "orchestrator/runtime/state/debug/llm"
);

fs.mkdirSync(DEBUG_DIR, { recursive: true });

/* -------- main -------- */

export async function callLLM({ role, prompt, systemPrompt }) {
  if (!role) {
    throw new Error("LLM role is required");
  }

  const roleModels = loadRoleModels();
  const model = roleModels[role];

  if (!model) {
    throw new Error(`LLM model not resolved (role=${role})`);
  }

  const id = crypto.randomUUID().slice(0, 8);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  llmLog.info(`Calling LLM`, { role, model, promptLength: prompt?.length });
  llmLog.debug(`Prompt preview: ${prompt?.substring(0, 200)}...`);

  const startTime = Date.now();

  try {
    const output = await callOllama({ 
      model, 
      prompt,
      system: systemPrompt 
    });

    const duration = Date.now() - startTime;
    llmLog.info(`LLM response received`, { role, model, duration: `${duration}ms`, outputLength: output?.length });
    llmLog.debug(`Response preview: ${output?.substring(0, 200)}...`);

    // Save debug file
    const debugContent = `
=== LLM CALL ===
Role: ${role}
Model: ${model}
Time: ${new Date().toISOString()}
Duration: ${duration}ms

=== SYSTEM PROMPT ===
${systemPrompt || "(none)"}

=== USER PROMPT ===
${prompt}

=== OUTPUT ===
${output}
`;
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ts}-${role}-${id}.txt`),
      debugContent
    );

    return output;
  } catch (err) {
    llmLog.error(`LLM call failed`, { role, model, error: err.message });
    
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ts}-${role}-${id}.error.txt`),
      `Error: ${err.message}\n\nPrompt:\n${prompt}`
    );
    throw err;
  }
}
