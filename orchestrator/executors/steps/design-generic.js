import fs from "node:fs";
import path from "node:path";
import fetch from "node-fetch";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const MODEL = "qwen25-coder-32b:latest";

export async function designGeneric({ goal, analysis }) {
  const outDir = path.resolve("./sandbox/design");
  fs.mkdirSync(outDir, { recursive: true });

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You are a senior software architect. Produce design artefacts only. No execution steps."
        },
        {
          role: "user",
          content: `
GOAL:
${goal}

ANALYSIS:
${JSON.stringify(analysis, null, 2)}

OUTPUT:
- architecture overview (markdown)
- key components
- optional deployment layout if relevant
`
        }
      ]
    })
  });

  const json = await res.json();
  const content = json.message?.content || "";

  const file = path.join(outDir, "architecture.md");
  fs.writeFileSync(file, content);

  return {
    read_only: true,
    artifacts: [ "sandbox/design/architecture.md" ]
  };
}
