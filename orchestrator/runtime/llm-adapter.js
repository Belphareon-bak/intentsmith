import fetch from "node-fetch";

/*
  LLM Adapter — C.3
  - multi-backend (ollama, lmstudio)
  - role-aware
  - model-aware
  - sequential (NO parallel inference)
*/

/* =========================
   CONFIG
========================= */

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const LMSTUDIO_API_URL =
  process.env.LMSTUDIO_API_URL || "http://127.0.0.1:1234/v1/chat/completions";
const LMSTUDIO_API_KEY = process.env.LMSTUDIO_API_KEY || "local";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min (velké modely)

/* =========================
   ROLE → BACKEND / MODEL
========================= */

export const ROLE_MODEL_MAP = {
  D1: {
    backend: "ollama",
    model: "qwen25-coder-32b"
  },
  D2: {
    backend: "ollama",
    model: "qwen3-30b-a3b"
  },
  R1: {
    backend: "ollama",
    model: "deepseek-r1-32b"
  },
  R2: {
    backend: "ollama",
    model: "qwen3-30b-a3b"
  },
  Decision: {
    backend: "ollama",
    model: "qwen3-30b-a3b"
  },
  Chat: {
    backend: "lmstudio",
    model: "qwen3-14b-instruct"
  }
};

/* =========================
   PUBLIC API
========================= */

export async function llmCall({
  role,
  systemPrompt = "",
  userPrompt,
  temperature,
  maxTokens
}) {
  const roleCfg = ROLE_MODEL_MAP[role];
  if (!roleCfg) {
    throw new Error(`Unknown LLM role: ${role}`);
  }

  const { backend, model } = roleCfg;

  if (backend === "ollama") {
    return callOllama({
      model,
      systemPrompt,
      userPrompt,
      temperature
    });
  }

  if (backend === "lmstudio") {
    return callLMStudio({
      model,
      systemPrompt,
      userPrompt,
      temperature,
      maxTokens
    });
  }

  throw new Error(`Unsupported backend: ${backend}`);
}

/* =========================
   OLLAMA BACKEND
========================= */

async function callOllama({
  model,
  systemPrompt,
  userPrompt,
  temperature
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: buildPrompt(systemPrompt, userPrompt),
        stream: false,
        options: {
          temperature: temperature ?? 0.7
        }
      })
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Ollama error: ${res.status} ${t}`);
    }

    const data = await res.json();
    return data.response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Ollama timeout for model ${model}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================
   LM STUDIO BACKEND
========================= */

async function callLMStudio({
  model,
  systemPrompt,
  userPrompt,
  temperature,
  maxTokens
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(LMSTUDIO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LMSTUDIO_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt
            ? [{ role: "system", content: systemPrompt }]
            : []),
          { role: "user", content: userPrompt }
        ],
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 2048,
        stream: false
      })
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`LM Studio error: ${res.status} ${t}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`LM Studio timeout for model ${model}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/* =========================
   HELPERS
========================= */

function buildPrompt(systemPrompt, userPrompt) {
  if (!systemPrompt) return userPrompt;
  return `${systemPrompt}\n\n${userPrompt}`;
}
