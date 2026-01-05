/**
 * Conversational Agent
 * 
 * Agent který komunikuje přirozeně, ptá se na detaily,
 * a poskytuje skutečné odpovědi - ne jen logy.
 */

import { emit } from "../runtime/event-bus.js";
import { toolRegistry } from "../tools/index.js";
import { callLLM } from "../llm/llm-client.js";
import { agentLog } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are C.3, a helpful AI assistant that can use tools to accomplish tasks.

IMPORTANT RULES:
1. ALWAYS ask for clarification if the request is vague (e.g., "where should I save the file?", "what size PVC do you need?")
2. When you use a tool, explain what you're doing and show the results
3. Communicate naturally like a human assistant, not like a log system
4. When showing file contents or search results, include the ACTUAL DATA, not just "completed"
5. If something fails, explain WHY and suggest alternatives

AVAILABLE TOOLS:
{{TOOLS}}

TO USE A TOOL, write:
<tool name="tool_name">
{"param": "value"}
</tool>

After using a tool, explain the results in plain language.

EXAMPLES:

User: create a yaml for k8s pvc
You: I'd be happy to create a Kubernetes PVC manifest for you. A few questions first:
- What name should the PVC have?
- How much storage do you need? (e.g., 10Gi)
- What storage class? (or should I use the default?)
- Where should I save the file?

User: 10Gi, default storage class, save to ./pvc.yaml
You: I'll create the PVC manifest now.
<tool name="fs:write">
{"path": "./pvc.yaml", "content": "apiVersion: v1\\nkind: PersistentVolumeClaim..."}
</tool>

Done! I've created \`pvc.yaml\` with the following content:
\`\`\`yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
\`\`\`

The file is saved at ./pvc.yaml. Would you like me to modify anything?`;

class ConversationalAgent {
  constructor(config = {}) {
    this.config = {
      model: config.model || "CHAT",  // Use CHAT role for conversational
      workdir: config.workdir || process.cwd(),
      maxToolCalls: config.maxToolCalls || 10,
      ...config
    };
    
    this.conversationHistory = [];
    this.toolCallCount = 0;
    agentLog.info("ConversationalAgent initialized", { workdir: this.config.workdir });
  }

  /**
   * Process user message and generate response
   */
  async chat(userMessage) {
    agentLog.info(`=== New message ===`, { message: userMessage.substring(0, 100) });
    
    this.conversationHistory.push({
      role: "user",
      content: userMessage
    });

    emit({ type: "agent_thinking" });

    // Build tools description
    const toolsDesc = toolRegistry.list()
      .map(t => `- ${t.name}: ${t.description}`)
      .join("\n");

    const systemPrompt = SYSTEM_PROMPT.replace("{{TOOLS}}", toolsDesc);

    // Build conversation for LLM
    const messages = this.conversationHistory.map(m => 
      `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
    ).join("\n\n");

    const prompt = messages;
    
    agentLog.debug(`Conversation history length: ${this.conversationHistory.length}`);
    agentLog.debug(`Prompt length: ${prompt.length}`);

    try {
      // Get LLM response
      agentLog.info(`Calling LLM with role: ${this.config.model}`);
      let response = await callLLM({
        role: this.config.model,
        prompt,
        systemPrompt
      });
      
      agentLog.info(`LLM response received`, { length: response?.length });
      agentLog.debug(`Response preview: ${response?.substring(0, 200)}`);

      // Process any tool calls in the response
      response = await this.processToolCalls(response);

      // Add to history
      this.conversationHistory.push({
        role: "assistant", 
        content: response
      });

      emit({ type: "agent_response", content: response });

      return response;

    } catch (error) {
      agentLog.error(`Chat error`, { error: error.message });
      const errorMsg = `I encountered an error: ${error.message}. Let me try a different approach or please provide more details.`;
      emit({ type: "agent_error", error: error.message });
      return errorMsg;
    }
  }

  /**
   * Process tool calls in LLM response
   */
  async processToolCalls(response) {
    const toolPattern = /<tool name="([^"]+)">\s*([\s\S]*?)\s*<\/tool>/g;
    let match;
    let processedResponse = response;
    let toolsFound = 0;

    while ((match = toolPattern.exec(response)) !== null) {
      toolsFound++;
      
      if (this.toolCallCount >= this.config.maxToolCalls) {
        agentLog.warn(`Tool limit reached (${this.config.maxToolCalls})`);
        processedResponse = processedResponse.replace(
          match[0],
          "\n[Tool limit reached - cannot execute more tools]\n"
        );
        continue;
      }

      const toolName = match[1];
      const paramsStr = match[2];

      agentLog.info(`Tool call found`, { tool: toolName, params: paramsStr.substring(0, 100) });
      emit({ type: "tool_start", tool: toolName });

      try {
        const params = JSON.parse(paramsStr);
        agentLog.debug(`Executing tool`, { tool: toolName, params });
        
        const result = await this.executeTool(toolName, params);
        
        this.toolCallCount++;
        agentLog.info(`Tool executed`, { tool: toolName, success: result.success, error: result.error });

        // Replace tool tag with result indicator
        const resultSummary = this.formatToolResult(toolName, result);
        processedResponse = processedResponse.replace(
          match[0],
          `\n[Executed ${toolName}]\n${resultSummary}\n`
        );

        emit({ type: "tool_done", tool: toolName, success: result.success });

      } catch (error) {
        agentLog.error(`Tool execution failed`, { tool: toolName, error: error.message });
        processedResponse = processedResponse.replace(
          match[0],
          `\n[Tool ${toolName} failed: ${error.message}]\n`
        );
        emit({ type: "tool_error", tool: toolName, error: error.message });
      }
    }
    
    if (toolsFound === 0) {
      agentLog.debug("No tool calls found in response");
    }

    return processedResponse;
  }

  /**
   * Execute a tool
   */
  async executeTool(name, params) {
    const tool = toolRegistry.get(name);
    
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return await toolRegistry.execute(name, params, {
      workdir: this.config.workdir
    });
  }

  /**
   * Format tool result for display
   */
  formatToolResult(toolName, result) {
    if (!result.success) {
      return `Error: ${result.error}`;
    }

    const data = result.result;

    // Format based on tool type
    if (toolName === "fs:read") {
      return `File contents:\n\`\`\`\n${data.content?.substring(0, 1000) || ""}\n\`\`\``;
    }
    
    if (toolName === "fs:list") {
      const items = data.entries?.slice(0, 20).map(e => 
        `  ${e.type === "directory" ? "📁" : "📄"} ${e.name}`
      ).join("\n") || "";
      return `Directory listing (${data.count} items):\n${items}`;
    }
    
    if (toolName === "fs:write") {
      return `File written: ${data.path} (${data.size} bytes)`;
    }

    if (toolName === "shell:exec") {
      let output = "";
      if (data.stdout) output += `Output:\n\`\`\`\n${data.stdout.substring(0, 1000)}\n\`\`\`\n`;
      if (data.stderr) output += `Errors:\n\`\`\`\n${data.stderr.substring(0, 500)}\n\`\`\`\n`;
      return output || "Command completed (no output)";
    }

    if (toolName === "web:search") {
      const results = data.results?.slice(0, 5).map(r =>
        `- [${r.title}](${r.url})\n  ${r.snippet?.substring(0, 100) || ""}`
      ).join("\n") || "";
      return `Search results:\n${results}`;
    }

    if (toolName === "web:extract" || toolName === "web:fetch") {
      return `Fetched: ${data.title || data.url}\n${data.content?.substring(0, 500) || data.description || ""}...`;
    }

    // Default: show raw result
    return JSON.stringify(data, null, 2).substring(0, 500);
  }

  /**
   * Reset conversation
   */
  reset() {
    this.conversationHistory = [];
    this.toolCallCount = 0;
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return [...this.conversationHistory];
  }
}

// Factory
export function createConversationalAgent(config = {}) {
  return new ConversationalAgent(config);
}

// Singleton
export const conversationalAgent = new ConversationalAgent();

export default ConversationalAgent;
