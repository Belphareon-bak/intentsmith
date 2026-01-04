import fetch from "node-fetch";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

/**
 * Simple Ollama client (non-streaming)
 */
export async function callOllama({
  model,
  prompt,
  system,
  temperature = 0.2,
  max_tokens = 4096
}) {
  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      system,
      options: {
        temperature,
        num_predict: max_tokens
      },
      stream: false
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.response;
}
