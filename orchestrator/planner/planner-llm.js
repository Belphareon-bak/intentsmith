import http from "http";

const OLLAMA_HOST = "127.0.0.1";
const OLLAMA_PORT = 11434;
const MODEL = "qwen25-coder-32b:latest";

export async function runPlanner(prompt, cfg = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a planning agent." },
        { role: "user", content: prompt }
      ]
    });

    const req = http.request(
      {
        host: OLLAMA_HOST,
        port: OLLAMA_PORT,
        path: "/api/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.message?.content || "");
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
