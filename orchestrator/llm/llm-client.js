import fs from "fs";
import path from "path";
import crypto from "crypto";
import { callOllama } from "./ollama-client.js";

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

export async function callLLM({ role, prompt }) {
  if (!role) {
    throw new Error("LLM role is required");
  }

  const roleModels = loadRoleModels();
  const model = roleModels[role];

  if (!model) {
    throw new Error(`LLM model not resolved (role=${role})`);
  }

  const id = crypto.randomUUID();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  try {
    const output = await callOllama({ model, prompt });

    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ts}-${role}-${id}.raw.txt`),
      output
    );

    return output;
  } catch (err) {
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ts}-${role}-${id}.error.txt`),
      String(err)
    );
    throw err;
  }
}
