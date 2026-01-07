/**
 * LLM Router
 * 
 * Re-export z llm-client.js pro kompatibilitu.
 * Přidává další utility funkce.
 */

export { callLLM } from "./llm-client.js";

// Re-export all
import { callLLM } from "./llm-client.js";
export default { callLLM };
