import fs from "fs";
import fetch from "node-fetch";
import { ChatSession } from "./chat-session.js";

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const CHAT_MODEL = "qwen25-coder-32b:latest";

const systemPrompt = fs.readFileSync(
  new URL("./system-prompt.txt", import.meta.url),
  "utf-8"
);

const sessions = new Map();

async function callChatLLM(messages) {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: false,
      messages
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama chat error ${res.status}: ${t}`);
  }

  const json = await res.json();
  return json.message?.content || "";
}

export async function handleChatRequest(req, res) {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", async () => {
    try {
      const { sessionId, message } = JSON.parse(body);

      if (!sessionId || !message) {
        res.writeHead(400);
        return res.end("sessionId and message required");
      }

      let session = sessions.get(sessionId);
      if (!session) {
        session = new ChatSession(systemPrompt);
        sessions.set(sessionId, session);
      }

      session.addUserMessage(message);
      const reply = await callChatLLM(session.getContext());
      session.addAssistantMessage(reply);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      res.writeHead(500);
      res.end(String(err.message || err));
    }
  });
}
