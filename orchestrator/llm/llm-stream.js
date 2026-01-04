import fetch from "node-fetch";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "qwen25-coder-32b:latest";

// emit, když je:
// - nový řádek
// - nebo buffer delší než N znaků
const FLUSH_CHARS = 120;

export async function streamExplainCode(
  { languageId, selection, prefix, suffix },
  onChunk
) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are a senior software engineer. Explain the given code clearly and concisely."
        },
        {
          role: "user",
          content:
`Language: ${languageId}

[SELECTED CODE]
${selection}

[CONTEXT BEFORE]
${prefix}

[CONTEXT AFTER]
${suffix}`
        }
      ]
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama error ${res.status}: ${t}`);
  }

  return new Promise((resolve, reject) => {
    let buffer = "";
    let textBuffer = "";

    res.body.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const token = json.message?.content;
          if (!token) continue;

          textBuffer += token;

          if (
            token.includes("\n") ||
            textBuffer.length >= FLUSH_CHARS
          ) {
            onChunk(textBuffer);
            textBuffer = "";
          }
        } catch {
          // ignore partial JSON
        }
      }
    });

    res.body.on("end", () => {
      if (textBuffer) onChunk(textBuffer);
      resolve();
    });

    res.body.on("error", (err) => reject(err));
  });
}
