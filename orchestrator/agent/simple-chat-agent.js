/**
 * Simple Chat Agent
 * 
 * Jednoduchý konverzační agent - odpovídá přirozeně,
 * ptá se na detaily, vysvětluje co dělá.
 */

import { toolRegistry } from "../tools/index.js";
import { callLLM } from "../llm/llm-client.js";
import { agentLog } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are C.3, a helpful AI coding assistant. You communicate naturally in the user's language.

CRITICAL RULES:
1. ALWAYS respond in the same language as the user's message
2. If request is vague, ASK clarifying questions before acting
3. When using tools, explain what you're doing
4. Show actual results - file contents, command output, etc.
5. Be concise but helpful
6. **NEVER invent or hallucinate URLs, links, or data!** Only use ACTUAL results from tools.
7. If a search returns no results, say "Nenašel jsem žádné výsledky" - DO NOT make up fake results!
8. When showing search results, use ONLY the URLs returned by the tool, never generate your own.

TOOLS AVAILABLE:
{{TOOLS}}

TO USE A TOOL:
<tool name="tool_name">
{"param1": "value1", "param2": "value2"}
</tool>

IMPORTANT: 
- Include ALL required parameters when calling tools!
- After tool execution, you will see the results. Use ONLY those real results in your response.
- If web:search returns empty results, tell the user honestly and suggest different search terms.

EXAMPLE - Web Search:

User: najdi auta na sauto.cz
Assistant: Vyhledám auta na sauto.cz...

<tool name="web:search">
{"query": "auta site:sauto.cz", "maxResults": 5}
</tool>

[After tool returns results like: "• [Title](https://real-url.com)"]

Zde jsou výsledky z vyhledávání:
• [Skutečný titulek](https://skutecna-url.com) - popis
• [Další výsledek](https://dalsi-url.com) - popis

NEVER write results before the tool executes! Wait for actual data.

EXAMPLE - File Creation:

User: vytvoř mi webový server
Assistant: Rád vytvořím webový server! Potřebuji pár informací:
- V jakém jazyce? (Node.js, Python, ...)
- Kam ho mám uložit? (cesta k adresáři)
- Má to být jednoduchý server nebo REST API?

User: nodejs, do /home/user/projects/myserver, REST API
Assistant: Vytvořím Node.js REST API server.

<tool name="fs:mkdir">
{"path": "/home/user/projects/myserver"}
</tool>

<tool name="fs:write">
{"path": "/home/user/projects/myserver/server.js", "content": "import express from 'express';\\nconst app = express();\\napp.listen(3000);"}
</tool>

Hotovo! Vytvořil jsem REST API server v /home/user/projects/myserver.

---

Now respond to the user naturally.`;

class SimpleChatAgent {
  constructor(config = {}) {
    this.config = {
      model: config.model || "CHAT",
      workdir: config.workdir || process.cwd(),
      maxToolCalls: config.maxToolCalls || 15,
      ...config
    };
    
    this.history = [];
    this.toolCallCount = 0;
    
    agentLog.info("SimpleChatAgent initialized", { 
      model: this.config.model,
      workdir: this.config.workdir 
    });
  }

  async chat(userMessage) {
    agentLog.info(`User message: ${userMessage.substring(0, 100)}`);
    
    this.history.push({ role: "user", content: userMessage });

    // Build system prompt with tools
    const toolsDesc = toolRegistry.list()
      .slice(0, 30)  // Limit to most important tools
      .map(t => `- ${t.name}: ${t.description} | params: ${JSON.stringify(t.parameters || {})}`)
      .join("\n");

    const systemPrompt = SYSTEM_PROMPT.replace("{{TOOLS}}", toolsDesc);

    // Build conversation
    const conversation = this.history
      .slice(-10)  // Last 10 messages for context
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    agentLog.debug(`Calling LLM with ${this.history.length} messages in history`);

    try {
      let response = await callLLM({
        role: this.config.model,
        prompt: conversation,
        systemPrompt
      });

      agentLog.info(`LLM response length: ${response?.length}`);

      // Process tool calls
      response = await this.processTools(response);

      // Save to history
      this.history.push({ role: "assistant", content: response });

      return response;

    } catch (error) {
      agentLog.error(`Chat error: ${error.message}`);
      return `Omlouvám se, došlo k chybě: ${error.message}`;
    }
  }

  async processTools(response) {
    const toolRegex = /<tool name="([^"]+)">\s*([\s\S]*?)\s*<\/tool>/g;
    let processed = response;
    let match;
    
    // Reset regex
    toolRegex.lastIndex = 0;
    
    const matches = [...response.matchAll(/<tool name="([^"]+)">\s*([\s\S]*?)\s*<\/tool>/g)];
    
    agentLog.debug(`Found ${matches.length} tool calls in response`);

    for (const match of matches) {
      if (this.toolCallCount >= this.config.maxToolCalls) {
        agentLog.warn("Tool call limit reached");
        processed = processed.replace(match[0], "\n[Dosažen limit nástrojů]\n");
        continue;
      }

      const toolName = match[1];
      const paramsStr = match[2].trim();

      agentLog.info(`Executing tool: ${toolName}`);
      agentLog.debug(`Tool params: ${paramsStr}`);

      try {
        const params = JSON.parse(paramsStr);
        
        const result = await toolRegistry.execute(toolName, params, {
          workdir: this.config.workdir
        });

        this.toolCallCount++;

        const resultText = this.formatResult(toolName, result);
        processed = processed.replace(match[0], `\n${resultText}\n`);

        agentLog.info(`Tool ${toolName} completed`, { success: result.success });

      } catch (error) {
        agentLog.error(`Tool ${toolName} failed: ${error.message}`);
        processed = processed.replace(
          match[0], 
          `\n❌ Chyba při ${toolName}: ${error.message}\n`
        );
      }
    }

    return processed;
  }

  formatResult(tool, result) {
    if (!result.success) {
      return `❌ ${tool} selhal: ${result.error}`;
    }

    const data = result.result;

    switch (tool) {
      case "fs:read":
        const preview = data.content?.substring(0, 500) || "";
        return `📄 Obsah souboru:\n\`\`\`\n${preview}${data.content?.length > 500 ? "\n..." : ""}\n\`\`\``;

      case "fs:write":
        return `✅ Soubor uložen: ${data.path} (${data.size} bytes)`;

      case "fs:mkdir":
        return `✅ Adresář vytvořen: ${data.path}`;

      case "fs:list":
        const items = data.entries?.slice(0, 15).map(e => 
          `  ${e.type === "directory" ? "📁" : "📄"} ${e.name}`
        ).join("\n") || "";
        return `📂 Obsah adresáře (${data.count} položek):\n${items}`;

      case "shell:exec":
      case "shell:run":
        let output = `✅ Příkaz dokončen`;
        if (data.stdout) output += `\n\`\`\`\n${data.stdout.substring(0, 500)}\n\`\`\``;
        if (data.stderr) output += `\n⚠️ Stderr: ${data.stderr.substring(0, 200)}`;
        return output;

      case "web:search":
        const results = data.results?.slice(0, 5).map(r =>
          `• [${r.title}](${r.url})`
        ).join("\n") || "Žádné výsledky";
        return `🔍 Výsledky hledání:\n${results}`;

      case "web:fetch":
      case "web:extract":
        return `🌐 Staženo: ${data.title || data.url}\n${data.content?.substring(0, 300) || ""}...`;

      case "project:templates":
        const templates = data.templates?.map(t => `• ${t.id}: ${t.name}`).join("\n") || "";
        return `📋 Dostupné šablony:\n${templates}`;

      case "project:create":
        return `✅ Projekt vytvořen: ${data.name} v ${data.path}`;

      default:
        return `✅ ${tool} dokončen: ${JSON.stringify(data).substring(0, 200)}`;
    }
  }

  reset() {
    this.history = [];
    this.toolCallCount = 0;
    agentLog.info("Chat reset");
  }

  getHistory() {
    return [...this.history];
  }
}

// Factory
export function createSimpleChatAgent(config = {}) {
  return new SimpleChatAgent(config);
}

export default SimpleChatAgent;
