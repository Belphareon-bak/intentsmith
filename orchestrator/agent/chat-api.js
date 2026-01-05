/**
 * Chat API
 * 
 * Jednodušší API - jen chat endpoint.
 */

import { createSimpleChatAgent } from "./simple-chat-agent.js";
import { agentLog } from "../utils/logger.js";

// Sessions
const sessions = new Map();

function getSession(sessionId = "default", workdir) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSimpleChatAgent({
      workdir: workdir || process.cwd()
    }));
  }
  
  const agent = sessions.get(sessionId);
  
  // Update workdir if changed
  if (workdir && agent.config.workdir !== workdir) {
    agent.config.workdir = workdir;
    agentLog.info(`Workdir updated to: ${workdir}`);
  }
  
  return agent;
}

export const chatHandlers = {
  /**
   * POST /chat
   * Send message and get response
   */
  async chat(body) {
    const { message, sessionId = "default", workdir } = body;
    
    if (!message) {
      return { error: "Message is required" };
    }

    agentLog.info(`Chat request`, { sessionId, workdir, messageLength: message.length });

    const agent = getSession(sessionId, workdir);

    try {
      const response = await agent.chat(message);
      
      return {
        response,
        sessionId,
        historyLength: agent.getHistory().length
      };
    } catch (error) {
      agentLog.error(`Chat handler error: ${error.message}`);
      return {
        error: error.message,
        sessionId
      };
    }
  },

  /**
   * POST /chat/reset
   * Reset conversation
   */
  async reset(body) {
    const { sessionId = "default" } = body;
    const agent = sessions.get(sessionId);
    
    if (agent) {
      agent.reset();
    }
    
    return { state: "reset", sessionId };
  },

  /**
   * GET /chat/history
   * Get conversation history
   */
  async history(query) {
    const { sessionId = "default" } = query;
    const agent = sessions.get(sessionId);
    
    if (!agent) {
      return { history: [], sessionId };
    }
    
    return {
      history: agent.getHistory(),
      sessionId
    };
  }
};

/**
 * Handle chat requests
 */
export async function handleChatRequest(method, path, body = {}, query = {}) {
  const route = path.replace("/chat/", "").replace("/chat", "");
  
  try {
    switch (`${method} ${route}`) {
      case "POST ":
      case "POST chat":
        return await chatHandlers.chat(body);
      case "POST reset":
        return await chatHandlers.reset(body);
      case "GET history":
        return await chatHandlers.history(query);
      default:
        return { error: "Not found" };
    }
  } catch (error) {
    return { error: error.message };
  }
}

export default chatHandlers;
