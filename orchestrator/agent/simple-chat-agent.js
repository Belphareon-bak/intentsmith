/**
 * Simple Chat Agent
 * 
 * Jednoduchý konverzační agent - odpovídá přirozeně,
 * ptá se na detaily, vysvětluje co dělá.
 */

import { toolRegistry } from "../tools/index.js";
import { callLLM } from "../llm/llm-client.js";
import { agentLog } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are C.3, a helpful AI assistant. You communicate naturally in the user's language.

CRITICAL RULES:
1. ALWAYS respond in the same language as the user's message
2. If request is vague, ASK clarifying questions before acting
3. **NEVER invent URLs, links, prices, or any factual data!**
4. If you don't have real data, say "Nemám k dispozici" - DO NOT make up fake information
5. When search returns no results, suggest using web:fetch on specific known URLs

TOOLS AVAILABLE:
{{TOOLS}}

HOW TO USE TOOLS:
<tool name="tool_name">
{"param1": "value1"}
</tool>

IMPORTANT TOOL GUIDELINES:

**web:search** - Often blocked by search engines. If returns empty:
- DON'T make up fake results
- Suggest specific URLs to fetch instead
- Example: "Vyhledávání nenašlo výsledky. Mohu přímo načíst stránku pokud mi dáte konkrétní URL."

**web:fetch** - Use for specific URLs. More reliable than search.
- Example: Fetch https://www.sauto.cz to get content

**fs:write** - Create files. ALWAYS include path AND content parameters.
**fs:read** - Read file contents.
**shell:exec** - Run shell commands.

EXAMPLE - Creating a file:

User: vytvoř soubor test.txt s textem ahoj
Assistant: Vytvořím soubor test.txt.

<tool name="fs:write">
{"path": "test.txt", "content": "ahoj"}
</tool>

Soubor test.txt vytvořen.

EXAMPLE - When search fails:

User: najdi auta na sauto.cz
Assistant: Zkusím vyhledat...

<tool name="web:search">
{"query": "auta sauto.cz"}
</tool>

[If returns empty]
Vyhledávání nevrátilo výsledky. Mohu přímo načíst konkrétní URL - jakou stránku chcete zobrazit?

---
Remember: NEVER fabricate data. Be honest when you don't have information.`;

class SimpleChatAgent {
  constructor(config = {}) {
    this.config = {
      model: config.model || "CHAT",
      workdir: config.workdir || process.cwd(),
      maxToolCalls: config.maxToolCalls || 15,
      dynamicModel: config.dynamicModel !== false, // Enable by default
      ...config
    };
    
    this.history = [];
    this.toolCallCount = 0;
    
    agentLog.info("SimpleChatAgent initialized", { 
      model: this.config.model,
      workdir: this.config.workdir,
      dynamicModel: this.config.dynamicModel
    });
  }

  /**
   * Detect task type and select appropriate model
   */
  detectTaskType(message) {
    const msg = message.toLowerCase();
    
    // Code generation patterns - more flexible matching
    const codePatterns = [
      // Czech - flexible word order
      /vytvo[řr]/i,  // Simplified - any "vytvoř/vytvor"
      /napi[šs]\s+\w*\s*(kód|kod|script|funkci|program|soubor)/i,
      /implementuj/i,
      /vygeneruj/i,
      // English
      /create\s+\w*\s*(file|code|script|app|server|api|function|project)/i,
      /write\s+\w*\s*(code|script|function)/i,
      /generate\s+\w*\s*(code|script)/i,
      /build\s+\w*\s*(app|api|server|project)/i,
      // File indicators
      /\.js\b|\.ts\b|\.py\b|\.java\b|\.cpp\b|\.go\b|\.rs\b/i,
      /do\s+\/\w+/i,  // "do /tmp/..." path indicator
      /soubor[yu]?\s*:/i,  // "Soubory:"
      /struktura\s*:/i,  // "Struktura:"
    ];
    
    // Review/analysis patterns
    const reviewPatterns = [
      /zkontroluj/i,
      /zanalyzuj/i,
      /review/i,
      /check\s+(the\s+)?code/i,
      /vylep[sš]i/i,
      /oprav\s*(chyby|bugy|kód|kod)/i,
      /najdi\s*(chyby|bugy|problemy)/i,
      /code\s*review/i,
      /navrhni\s*vylep[sš]en/i,
    ];
    
    // Planning/architecture patterns
    const planPatterns = [
      /navrhni\s*(architekturu|strukturu|plan)/i,
      /jak\s*(bych|by)\s*(m[eě]l|mohl)/i,
      /design\s+(the\s+)?(architecture|system)/i,
      /architect/i,
      /plan\s+(how|what)/i,
    ];
    
    // Check patterns - order matters! Check CODE first for messages with file paths
    // Check for file paths first - strong indicator of CODE task
    if (/\/tmp\/|\/home\/|soubor|\.js|\.py|\.ts/.test(msg)) {
      for (const pattern of codePatterns) {
        if (pattern.test(msg)) {
          return { type: "CODE", model: "CODE", reason: "Code generation with file path detected" };
        }
      }
    }
    
    for (const pattern of reviewPatterns) {
      if (pattern.test(msg)) {
        return { type: "REVIEW", model: "D1", reason: "Code review detected" };
      }
    }
    
    for (const pattern of codePatterns) {
      if (pattern.test(msg)) {
        return { type: "CODE", model: "CODE", reason: "Code generation detected" };
      }
    }
    
    for (const pattern of planPatterns) {
      if (pattern.test(msg)) {
        return { type: "PLAN", model: "D1", reason: "Planning/design detected" };
      }
    }
    
    // Default to chat
    return { type: "CHAT", model: "CHAT", reason: "General conversation" };
  }

  /**
   * Get role-specific system prompt additions
   */
  getRolePromptAddition(role) {
    if (role === "CODE") {
      return `

IMPORTANT FOR CODE GENERATION:
When asked to create a file, you MUST use the fs:write tool. DO NOT just show code in markdown blocks.

CORRECT way to create a file:
<tool name="fs:write">
{"path": "/path/to/file.js", "content": "const x = 1;"}
</tool>

WRONG way (do NOT do this):
\`\`\`javascript
const x = 1;
\`\`\`

Always use <tool name="fs:write"> to actually create files!`;
    }
    return "";
  }

  /**
   * Extract code from markdown and create files if LLM didn't use tools
   * Supports multiple files with format:
   * ### 📁 `/path/to/file.js`
   * ```javascript
   * code here
   * ```
   */
  async extractAndSaveCode(response, workdir) {
    const toolCallRegex = /<tool\s+name=/;
    
    if (toolCallRegex.test(response)) {
      // LLM used tools correctly, no need to extract
      return response;
    }
    
    // Pattern to find file headers followed by code blocks
    // Matches: ### 📁 `/path/file.js` or ### `/path/file.js` or `/path/file.js`
    // Followed by ```language\ncode\n```
    const fileBlockPattern = /(?:#{1,4}\s*)?(?:📁\s*)?[`'"]?(\/[\w\/.+-]+\.(js|ts|py|java|cpp|go|rs|sh|json|yaml|yml|html|css|md))[`'"]?\s*\n```(\w*)\n([\s\S]*?)```/gi;
    
    const matches = [...response.matchAll(fileBlockPattern)];
    
    if (matches.length === 0) {
      // Fallback: try simple extraction for single file
      const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
      const codeMatches = [...response.matchAll(codeBlockRegex)];
      
      if (codeMatches.length === 0) {
        return response;
      }
      
      // Try to find filename from request context
      const filePatterns = [
        /do\s+(\/[\w\/.+-]+\.\w+)/i,
        /soubor[yu]?:?\s*(\/[\w\/.+-]+\.\w+)/i,
        /(\/tmp\/[\w\/.+-]+\.\w+)/i,
        /(\/home\/[\w\/.+-]+\.\w+)/i,
      ];
      
      let detectedFile = null;
      for (const pattern of filePatterns) {
        const match = response.match(pattern) || this.history[this.history.length - 1]?.content?.match(pattern);
        if (match) {
          detectedFile = match[1];
          break;
        }
      }
      
      if (detectedFile && codeMatches.length > 0) {
        agentLog.info(`Found ${codeMatches.length} code blocks, saving first to: ${detectedFile}`);
        
        try {
          const tool = toolRegistry.get("fs:write");
          if (tool) {
            const result = await tool.execute({ 
              path: detectedFile, 
              content: codeMatches[0][2],
              createDirs: true 
            }, { workdir });
            
            if (result.success) {
              response += `\n\n✅ Soubor automaticky uložen: ${detectedFile}`;
            }
          }
        } catch (e) {
          agentLog.error(`Failed to auto-save: ${e.message}`);
        }
      }
      
      return response;
    }
    
    // Multi-file extraction
    agentLog.info(`Found ${matches.length} file blocks to extract`);
    
    const savedFiles = [];
    const tool = toolRegistry.get("fs:write");
    
    for (const match of matches) {
      const filePath = match[1];
      const lang = match[3] || "text";
      const content = match[4];
      
      agentLog.info(`Auto-saving: ${filePath} (${lang}, ${content.length} chars)`);
      
      try {
        if (tool) {
          const result = await tool.execute({ 
            path: filePath, 
            content: content,
            createDirs: true 
          }, { workdir });
          
          if (result.success) {
            savedFiles.push(filePath);
          }
        }
      } catch (e) {
        agentLog.error(`Failed to save ${filePath}: ${e.message}`);
      }
    }
    
    if (savedFiles.length > 0) {
      response += `\n\n✅ Soubory automaticky uloženy:\n${savedFiles.map(f => `  - ${f}`).join('\n')}`;
    }
    
    return response;
  }

  async chat(userMessage) {
    agentLog.info(`User message: ${userMessage.substring(0, 100)}`);
    
    // Detect task type and select model
    let selectedModel = this.config.model;
    let taskInfo = { type: "CHAT", model: "CHAT", reason: "default" };
    
    if (this.config.dynamicModel) {
      taskInfo = this.detectTaskType(userMessage);
      selectedModel = taskInfo.model;
      agentLog.info(`Task detected: ${taskInfo.type} -> Model: ${selectedModel} (${taskInfo.reason})`);
    }
    
    this.history.push({ role: "user", content: userMessage });

    // Build system prompt with tools
    const toolsDesc = toolRegistry.list()
      .slice(0, 30)  // Limit to most important tools
      .map(t => `- ${t.name}: ${t.description} | params: ${JSON.stringify(t.parameters || {})}`)
      .join("\n");

    let systemPrompt = SYSTEM_PROMPT.replace("{{TOOLS}}", toolsDesc);
    
    // Add role-specific instructions
    systemPrompt += this.getRolePromptAddition(selectedModel);

    // Build conversation
    const conversation = this.history
      .slice(-10)  // Last 10 messages for context
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    agentLog.debug(`Calling LLM with ${this.history.length} messages in history`);

    try {
      let response = await callLLM({
        role: selectedModel,  // Use detected model
        prompt: conversation,
        systemPrompt
      });

      agentLog.info(`LLM response length: ${response?.length}`);

      // Process tool calls
      response = await this.processTools(response);
      
      // If CODE model didn't use tools, try to extract and save code
      if (taskInfo.type === "CODE") {
        response = await this.extractAndSaveCode(response, this.config.workdir);
      }

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
