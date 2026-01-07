/**
 * C.3 Workflow API
 * 
 * HTTP API pro workflow agent s hierarchickým dual review systémem.
 * 
 * Endpoints:
 * - POST /workflow - Start new workflow or continue existing
 * - GET /workflow/:sessionId - Get workflow state
 * - DELETE /workflow/:sessionId - Clear workflow session
 */

import { WorkflowAgent, getWorkflowSession, clearWorkflowSession, State } from "./workflow-agent.js";
import { isCommand, handleCommand } from "./commands.js";
import { getMemoryBank } from "../memory/memory-bank.js";

const log = {
  info: (msg, data) => console.log(`[${new Date().toISOString()}] [INFO] [C3:WorkflowAPI] ${msg}`, data ? JSON.stringify(data) : ""),
  error: (msg, data) => console.log(`[${new Date().toISOString()}] [ERROR] [C3:WorkflowAPI] ${msg}`, data ? JSON.stringify(data) : ""),
};

/**
 * Handle workflow HTTP requests
 */
export async function handleWorkflowRequest(method, pathname, body, query) {
  try {
    // POST /workflow - Start or continue workflow
    if (method === "POST" && pathname === "/workflow") {
      const { message, sessionId = "default", workdir, projectName } = body;
      
      if (!message) {
        return { error: "Message is required" };
      }
      
      log.info("Workflow request", { sessionId, messageLength: message.length });
      
      const effectiveWorkdir = workdir || process.cwd();
      
      // Check if this is a command
      if (isCommand(message)) {
        const cmdResult = await handleCommand(message, { 
          workdir: effectiveWorkdir,
          sessionId,
        });
        
        if (cmdResult.handled) {
          return {
            sessionId,
            state: "COMMAND",
            response: cmdResult.response,
            needsInput: false,
            context: cmdResult.context,
          };
        }
      }
      
      // Get or create workflow session
      const workflow = getWorkflowSession(sessionId, {
        workdir: effectiveWorkdir,
        projectName: projectName || sessionId,
      });
      
      let result;
      
      // Check if this is a new workflow or continuation
      if (workflow.state === State.INIT) {
        // New workflow - start execution
        result = await workflow.execute(message);
      } else if (workflow.state === State.DONE || workflow.state === State.ERROR) {
        // Previous workflow finished - start fresh
        clearWorkflowSession(sessionId);
        const newWorkflow = getWorkflowSession(sessionId, {
          workdir: effectiveWorkdir,
          projectName: projectName || sessionId,
        });
        result = await newWorkflow.execute(message);
      } else {
        // Workflow in progress - continue with user input
        result = await workflow.continue(message);
      }
      
      return {
        sessionId,
        ...result,
      };
    }
    
    // GET /workflow/:sessionId - Get workflow state
    if (method === "GET" && pathname.startsWith("/workflow/")) {
      const sessionId = pathname.replace("/workflow/", "");
      
      if (!sessionId) {
        return { error: "Session ID required" };
      }
      
      const workflow = getWorkflowSession(sessionId);
      return {
        sessionId,
        ...workflow.getState(),
      };
    }
    
    // DELETE /workflow/:sessionId - Clear session
    if (method === "DELETE" && pathname.startsWith("/workflow/")) {
      const sessionId = pathname.replace("/workflow/", "");
      
      if (!sessionId) {
        return { error: "Session ID required" };
      }
      
      clearWorkflowSession(sessionId);
      log.info("Session cleared", { sessionId });
      
      return {
        sessionId,
        cleared: true,
      };
    }
    
    // GET /workflow - List all sessions info
    if (method === "GET" && pathname === "/workflow") {
      return {
        info: "C.3 Workflow API",
        version: "1.0.0",
        endpoints: [
          "POST /workflow - Start or continue workflow",
          "GET /workflow/:sessionId - Get workflow state",
          "DELETE /workflow/:sessionId - Clear session",
        ],
        commands: [
          "/init - Initialize context",
          "/todo <text> - Add task",
          "/done [id] - Complete task",
          "/memory - Show memory",
          "/plan - Show current plan",
          "/status - Project status",
          "/help - Show help",
        ],
        states: Object.values(State),
      };
    }
    
    return { error: "Unknown workflow endpoint" };
    
  } catch (error) {
    log.error("Workflow error", { error: error.message, stack: error.stack });
    return { 
      error: error.message,
      state: State.ERROR,
    };
  }
}

export default handleWorkflowRequest;
