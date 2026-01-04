/**
 * Agent Module Index
 */

export { 
  AgentRuntime, 
  AgentState, 
  createAgent, 
  agent 
} from "./agent-runtime.js";

export { 
  agentHandlers, 
  handleAgentRequest 
} from "./agent-api.js";

import agent from "./agent-runtime.js";
export default agent;

console.log("🤖 Agent module loaded");
