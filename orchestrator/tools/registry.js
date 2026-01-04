/**
 * Tool Registry
 * 
 * Centrální registr všech nástrojů dostupných agentovi.
 * Každý nástroj má:
 * - name: unikátní identifikátor
 * - description: pro LLM context
 * - parameters: JSON schema
 * - execute: async funkce
 * - risk: low/medium/high (pro approval)
 */

import { emit } from "../runtime/event-bus.js";

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.categories = new Map();
  }

  /**
   * Registrace nástroje
   */
  register(tool) {
    if (!tool.name || !tool.execute) {
      throw new Error("Tool must have name and execute function");
    }

    const fullTool = {
      name: tool.name,
      category: tool.category || "general",
      description: tool.description || "",
      parameters: tool.parameters || {},
      risk: tool.risk || "low",
      requiresApproval: tool.requiresApproval ?? (tool.risk === "high"),
      execute: tool.execute,
      validate: tool.validate || (() => true),
    };

    this.tools.set(tool.name, fullTool);

    // Index by category
    if (!this.categories.has(fullTool.category)) {
      this.categories.set(fullTool.category, []);
    }
    this.categories.get(fullTool.category).push(tool.name);

    return this;
  }

  /**
   * Získání nástroje
   */
  get(name) {
    return this.tools.get(name);
  }

  /**
   * Existuje nástroj?
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * Seznam všech nástrojů
   */
  list() {
    return [...this.tools.values()];
  }

  /**
   * Seznam nástrojů v kategorii
   */
  listByCategory(category) {
    const names = this.categories.get(category) || [];
    return names.map(name => this.tools.get(name));
  }

  /**
   * Získání všech kategorií
   */
  getCategories() {
    return [...this.categories.keys()];
  }

  /**
   * Spuštění nástroje
   */
  async execute(name, params, context = {}) {
    const tool = this.tools.get(name);
    
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    // Validate parameters
    if (!tool.validate(params)) {
      throw new Error(`Invalid parameters for tool: ${name}`);
    }

    emit({
      type: "tool_start",
      tool: name,
      params,
      risk: tool.risk
    });

    const startTime = Date.now();

    try {
      const result = await tool.execute(params, context);

      emit({
        type: "tool_done",
        tool: name,
        duration: Date.now() - startTime,
        success: true
      });

      return {
        success: true,
        tool: name,
        result,
        duration: Date.now() - startTime
      };

    } catch (error) {
      emit({
        type: "tool_error",
        tool: name,
        error: error.message,
        duration: Date.now() - startTime
      });

      return {
        success: false,
        tool: name,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Generování tool descriptions pro LLM
   */
  getToolDescriptions(categories = null) {
    let tools = this.list();
    
    if (categories) {
      tools = tools.filter(t => categories.includes(t.category));
    }

    return tools.map(tool => ({
      name: tool.name,
      category: tool.category,
      description: tool.description,
      parameters: tool.parameters,
      risk: tool.risk
    }));
  }

  /**
   * Generování system prompt pro tools
   */
  getToolsSystemPrompt(categories = null) {
    const descriptions = this.getToolDescriptions(categories);
    
    let prompt = "## Available Tools\n\n";
    
    const byCategory = {};
    for (const tool of descriptions) {
      if (!byCategory[tool.category]) {
        byCategory[tool.category] = [];
      }
      byCategory[tool.category].push(tool);
    }

    for (const [category, tools] of Object.entries(byCategory)) {
      prompt += `### ${category}\n\n`;
      for (const tool of tools) {
        prompt += `**${tool.name}** [${tool.risk}]\n`;
        prompt += `${tool.description}\n`;
        if (Object.keys(tool.parameters).length > 0) {
          prompt += `Parameters: ${JSON.stringify(tool.parameters)}\n`;
        }
        prompt += "\n";
      }
    }

    return prompt;
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();

// Helper pro registraci
export function registerTool(tool) {
  return toolRegistry.register(tool);
}

// Helper pro spuštění
export async function executeTool(name, params, context) {
  return toolRegistry.execute(name, params, context);
}

export default toolRegistry;
