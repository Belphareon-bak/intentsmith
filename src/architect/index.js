// C.3 Architect Mode
// ══════════════════════════════════════════════════════════════════════════════
// 
// Iterative, interactive development mode for complex projects.
// 
// ARCHITECTURE:
// - Orchestrator = DETERMINISTICKÝ router + decision maker
// - ArchitectLLM = ADVISOR (radí, nikdy nerozhoduje)
// - CoderLLM = Izolovaný generátor kódu
// - ReviewerLLM = Izolovaný reviewer
// 
// PRINCIPLE: LLM radí, Orchestrator rozhoduje
// 
// ══════════════════════════════════════════════════════════════════════════════

export { StateManager } from './state.js';
export { RoadmapManager } from './roadmap.js';
export { ContextLoader } from './context.js';
export { ConversationOrchestrator, Intent, GateResult, CONFIDENCE_THRESHOLD } from './orchestrator.js';
export { ActionExecutor, ActionType } from './actions.js';
export { GitManager } from './git.js';
export { HistoryManager } from './history.js';

// LLM modules - separate responsibilities
export { ArchitectLLM } from './llm.js';
export { CoderLLM } from './coder.js';
export { EditorLLM } from './editor.js';
export { ReviewerLLM, Verdict, Severity } from './reviewer.js';

export { PROMPTS } from './prompts.js';

// Default export: the main orchestrator
import { ConversationOrchestrator } from './orchestrator.js';
export default ConversationOrchestrator;

// ══════════════════════════════════════════════════════════════════════════════
// Quick start helper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create and initialize Architect Mode for a project
 * 
 * @param {string} projectRoot - Path to project directory
 * @param {string} projectName - Name of the project
 * @returns {Promise<ConversationOrchestrator>} Initialized orchestrator
 * 
 * @example
 * const architect = await createArchitect('/path/to/project', 'my-app');
 * const response = await architect.process('Začni s UI');
 */
export async function createArchitect(projectRoot, projectName) {
  const orchestrator = new ConversationOrchestrator(projectRoot);
  await orchestrator.init(projectName);
  return orchestrator;
}
