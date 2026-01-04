/**
 * Memory System Index
 * 
 * Exportuje všechny paměťové komponenty.
 */

export { 
  agentMemory,
  ShortTermMemory,
  LongTermMemory,
  EpisodicMemory,
  ProceduralMemory,
  AgentMemory
} from "./memory-store.js";

export {
  userProfile,
  secureVault,
  UserProfile,
  SecureVault
} from "./user-profile.js";

import agentMemory from "./memory-store.js";
import userProfile from "./user-profile.js";

// Combined context builder for LLM
export function buildFullContext(options = {}) {
  const userContext = userProfile.buildContextPrompt();
  const memoryContext = agentMemory.buildContext(options);
  
  return userContext + "\n" + memoryContext;
}

console.log("🧠 Memory system loaded");

export default {
  memory: agentMemory,
  profile: userProfile
};
