import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { callOllama } from "./ollama-client.js";
import { llmLog } from "../utils/logger.js";

/* -------- role → model binding with cache -------- */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLE_MODEL_PATH = path.resolve(__dirname, "../config/role-model-binding.json");

// Cache for role-model binding
let roleModelsCache = null;
let roleModelsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

function loadRoleModels() {
  const now = Date.now();
  
  // Return cached if still valid
  if (roleModelsCache && (now - roleModelsCacheTime) < CACHE_TTL) {
    return roleModelsCache;
  }
  
  if (!fs.existsSync(ROLE_MODEL_PATH)) {
    throw new Error(`role-model-binding.json not found at ${ROLE_MODEL_PATH}`);
  }
  
  roleModelsCache = JSON.parse(fs.readFileSync(ROLE_MODEL_PATH, "utf-8"));
  roleModelsCacheTime = now;
  
  return roleModelsCache;
}

// Force cache invalidation (useful after config change)
export function invalidateRoleModelsCache() {
  roleModelsCache = null;
  roleModelsCacheTime = 0;
}

/* -------- debug -------- */

const DEBUG_DIR = path.resolve(__dirname, "../runtime/state/debug/llm");
fs.mkdirSync(DEBUG_DIR, { recursive: true });

/* -------- retry logic -------- */

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callWithRetry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      // Don't retry on certain errors
      if (err.message.includes('not found') || err.message.includes('invalid')) {
        throw err;
      }
      
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), 10000);
        llmLog.warn(`LLM call failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, {
          error: err.message
        });
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}

/* -------- main -------- */

export async function callLLM({ role, prompt, systemPrompt, retry = true }) {
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

  const doCall = async () => {
    return await callOllama({ 
      model, 
      prompt,
      system: systemPrompt,
      role: role  // Pass role for role-specific timeout/tokens
    });
  };

  try {
    const output = retry 
      ? await callWithRetry(doCall, 3, 2000)
      : await doCall();

    const duration = Date.now() - startTime;
    llmLog.info(`LLM response received`, { 
      role, 
      model, 
      duration: `${duration}ms`, 
      outputLength: output?.length || 0 
    });
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
${output || "(empty)"}
`;
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ts}-${role}-${id}.txt`),
      debugContent
    );

    return output || "";
    
  } catch (err) {
    const duration = Date.now() - startTime;
    llmLog.error(`LLM call failed`, { role, model, duration: `${duration}ms`, error: err.message });
    
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ts}-${role}-${id}.error.txt`),
      `Error: ${err.message}\nDuration: ${duration}ms\n\nSystem Prompt:\n${systemPrompt}\n\nPrompt:\n${prompt}`
    );
    throw err;
  }
}
