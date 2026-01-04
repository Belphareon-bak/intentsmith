/**
 * Agent API
 * 
 * HTTP API pro interakci s agentem.
 */

import { createAgent } from "./agent-runtime.js";
import { toolRegistry } from "../tools/index.js";
import { agentMemory } from "../memory/memory-store.js";
import { userProfile } from "../memory/user-profile.js";
import { emit, addClient } from "../runtime/event-bus.js";

// Active agents by session
const agents = new Map();

/**
 * Get or create agent for session
 */
function getAgent(sessionId) {
  if (!agents.has(sessionId)) {
    agents.set(sessionId, createAgent({
      workdir: process.cwd()
    }));
  }
  return agents.get(sessionId);
}

/**
 * Agent API handlers
 */
export const agentHandlers = {
  /**
   * POST /agent/run
   * Start agent with a task
   */
  async run(body) {
    const { task, sessionId = "default", context = {} } = body;
    
    if (!task) {
      return { error: "Task is required", status: 400 };
    }

    const agent = getAgent(sessionId);
    
    // Run async, don't wait
    agent.run(task, context).catch(err => {
      emit({ type: "agent_error", error: err.message, sessionId });
    });

    return {
      state: "started",
      sessionId,
      task
    };
  },

  /**
   * POST /agent/stop
   * Stop running agent
   */
  async stop(body) {
    const { sessionId = "default" } = body;
    const agent = agents.get(sessionId);
    
    if (!agent) {
      return { error: "No agent for session", status: 404 };
    }

    agent.stop();
    return { state: "stopped", sessionId };
  },

  /**
   * POST /agent/pause
   */
  async pause(body) {
    const { sessionId = "default" } = body;
    const agent = agents.get(sessionId);
    
    if (!agent) {
      return { error: "No agent for session", status: 404 };
    }

    agent.pause();
    return { state: "paused", sessionId };
  },

  /**
   * POST /agent/resume
   */
  async resume(body) {
    const { sessionId = "default" } = body;
    const agent = agents.get(sessionId);
    
    if (!agent) {
      return { error: "No agent for session", status: 404 };
    }

    agent.resume();
    return { state: "resumed", sessionId };
  },

  /**
   * POST /agent/approve
   */
  async approve(body) {
    const { sessionId = "default", actionId } = body;
    const agent = agents.get(sessionId);
    
    if (!agent) {
      return { error: "No agent for session", status: 404 };
    }

    agent.approve(actionId);
    return { state: "approved", sessionId, actionId };
  },

  /**
   * POST /agent/reject
   */
  async reject(body) {
    const { sessionId = "default", actionId, reason } = body;
    const agent = agents.get(sessionId);
    
    if (!agent) {
      return { error: "No agent for session", status: 404 };
    }

    agent.reject(actionId, reason);
    return { state: "rejected", sessionId, actionId };
  },

  /**
   * GET /agent/status
   */
  async status(query) {
    const { sessionId = "default" } = query;
    const agent = agents.get(sessionId);
    
    if (!agent) {
      return { status: "no_agent", sessionId };
    }

    return {
      sessionId,
      ...agent.getState()
    };
  },

  /**
   * GET /agent/tools
   */
  async tools() {
    return {
      tools: toolRegistry.getToolDescriptions(),
      categories: toolRegistry.getCategories()
    };
  },

  /**
   * POST /agent/tool
   * Execute single tool
   */
  async executeTool(body) {
    const { tool, params = {}, workdir } = body;
    
    if (!tool) {
      return { error: "Tool name is required", status: 400 };
    }

    if (!toolRegistry.has(tool)) {
      return { error: `Tool not found: ${tool}`, status: 404 };
    }

    const result = await toolRegistry.execute(tool, params, {
      workdir: workdir || process.cwd()
    });

    return result;
  },

  /**
   * GET /agent/memory
   */
  async memory(query) {
    const { search, type } = query;
    
    if (search) {
      return agentMemory.search(search);
    }

    return agentMemory.getStats();
  },

  /**
   * POST /agent/memory
   */
  async remember(body) {
    const { key, value, persistent = false, tags = [] } = body;
    
    if (!key || value === undefined) {
      return { error: "Key and value are required", status: 400 };
    }

    const id = agentMemory.remember(key, value, { persistent, tags });
    return { id, key, persistent };
  },

  /**
   * GET /agent/profile
   */
  async getProfile() {
    return userProfile.getAll();
  },

  /**
   * POST /agent/profile
   */
  async updateProfile(body) {
    userProfile.update(body);
    return userProfile.getAll();
  },

  /**
   * GET /agent/sessions
   */
  async sessions() {
    const sessions = [];
    
    for (const [id, agent] of agents) {
      sessions.push({
        id,
        ...agent.getState()
      });
    }

    return { sessions };
  }
};

/**
 * Route agent requests
 */
export async function handleAgentRequest(method, path, body = {}, query = {}) {
  const route = path.replace("/agent/", "").replace("/agent", "");
  
  try {
    switch (`${method} ${route}`) {
      case "POST run":
        return await agentHandlers.run(body);
      case "POST stop":
        return await agentHandlers.stop(body);
      case "POST pause":
        return await agentHandlers.pause(body);
      case "POST resume":
        return await agentHandlers.resume(body);
      case "POST approve":
        return await agentHandlers.approve(body);
      case "POST reject":
        return await agentHandlers.reject(body);
      case "GET status":
        return await agentHandlers.status(query);
      case "GET tools":
        return await agentHandlers.tools();
      case "POST tool":
        return await agentHandlers.executeTool(body);
      case "GET memory":
        return await agentHandlers.memory(query);
      case "POST memory":
        return await agentHandlers.remember(body);
      case "GET profile":
        return await agentHandlers.getProfile();
      case "POST profile":
        return await agentHandlers.updateProfile(body);
      case "GET sessions":
        return await agentHandlers.sessions();
      default:
        return { error: "Not found", status: 404 };
    }
  } catch (error) {
    return { error: error.message, status: 500 };
  }
}

export default agentHandlers;
