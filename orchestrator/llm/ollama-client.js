import fetch from "node-fetch";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

// Role-specific max tokens configuration
const ROLE_MAX_TOKENS = {
  THINKER: 4096,       // Deep reasoning about request
  ANALYZER: 1024,      // Short structured output
  CODE: 8192,          // Needs more for large implementations
  D1: 6144,            // Planning can be verbose
  DESIGN_AUDIT: 4096,  // Audit findings
  D2: 4096,            // Fix proposals
  R2A: 2048,           // Intent review - shorter
  R2B: 3072,           // Adversarial - needs to explain edge cases
  CHAT: 4096,          // General chat
  default: 4096
};

// Role-specific timeouts (ms)
const ROLE_TIMEOUTS = {
  THINKER: 60000,      // 1 min - qwen2.5 is fast
  ANALYZER: 60000,     // 1 min - qwen2.5
  CODE: 180000,        // 3 min - coder model, implementation
  D1: 90000,           // 90s - planning (qwen2.5)
  DESIGN_AUDIT: 90000, // 90s - audit (qwen2.5)
  D2: 120000,          // 2 min - fixes, needs to include full file content
  R2A: 60000,          // 1 min - qwen2.5
  R2B: 180000,         // 3 min - adversarial (deepseek-r1, slow)
  CHAT: 60000,         // 1 min
  default: 90000
};

/**
 * Ollama client with timeout, abort controller, and role-specific config
 */
export async function callOllama({
  model,
  prompt,
  system,
  role = 'default',
  temperature = 0.2,
  max_tokens = null,
  timeout = null
}) {
  // Get role-specific config
  const maxTokens = max_tokens || ROLE_MAX_TOKENS[role] || ROLE_MAX_TOKENS.default;
  const timeoutMs = timeout || ROLE_TIMEOUTS[role] || ROLE_TIMEOUTS.default;
  
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        system,
        options: {
          temperature,
          num_predict: maxTokens
        },
        stream: false
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const json = await res.json();
    return json.response;
    
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama timeout after ${timeoutMs}ms (role: ${role}, model: ${model})`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
