// Project Handler — extracted from handlers.js
// Handles PROJECT mode - code-focused work
//
// v56.2 Sprint D: Project-self query interceptor
//   - "Jaký je stav projektu?" → working memory, NOT web search
//   - Detected BEFORE CRE routing to avoid DDG search for internal queries

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import {
  creDecisionEngine,
  DecisionType,
  assertDecision,
} from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import {
  handleToolCallDecision,
  handleAskUserDecision,
  handleAnswerDecision,
  handleRefuseDecision,
} from './decisions.js';

// ════════════════════════════════════════════════════════════════════════════════
// v56.2 Sprint D: PROJECT_SELF_PATTERNS (#8)
// ════════════════════════════════════════════════════════════════════════════════
// Queries about the project itself — status, goal, files, progress.
// These should be answered from working memory, NOT from web search.
// Must be checked BEFORE CRE routing.
//
// Examples:
//   "Jaký je stav projektu?" → working memory
//   "Co je cíl tohoto projektu?" → working memory
//   "Na čem pracujeme?" → working memory
//   "Najdi článek o X" → NOT intercepted, routes to CRE → web search
// ════════════════════════════════════════════════════════════════════════════════

const PROJECT_SELF_PATTERNS = [
  // Czech: project status/info queries
  /(?:jaký|jaká|jaké) je stav projektu/i,
  /stav projektu/i,
  /(?:co|jaký|jaká) je cíl (?:tohoto |)projektu/i,
  /cíl projektu/i,
  /na čem (?:pracujeme|děláme|pracuji)/i,
  /(?:co|jak) (?:děláme|dělám) (?:v |na |)(?:tomto |)projekt/i,
  /(?:shrň|shrnout|popiš) projekt/i,
  /(?:info|informace) o projektu/i,
  /co je (?:v |)(?:tomto |)projektu/i,
  /aktivní soubor/i,
  /na jakém souboru/i,
  /(?:jaké|které) soubory/i,
  // English: project status/info queries
  /(?:what is |what's )(?:the )?(?:project |)status/i,
  /(?:what is |what's )(?:the )?(?:project |)goal/i,
  /what are we (?:working on|doing)/i,
  /(?:project |)(?:summary|overview|info)/i,
  /(?:describe|summarize) (?:the |this |)project/i,
  /active file/i,
  /which files? (?:are|is)/i,
];

/**
 * Check if input is a project-self query (about the project itself).
 * @param {string} input
 * @returns {boolean}
 */
function isProjectSelfQuery(input) {
  return PROJECT_SELF_PATTERNS.some(p => p.test(input));
}

/**
 * Build a response from project working memory + project info.
 * No web search, no LLM call — pure data assembly.
 *
 * @param {string} input - User query
 * @param {Object} project - Project object { id, name, path, scope }
 * @param {Object} workingMemory - { goal, activeFile, lastArtifactId, driftCount }
 * @param {Object} context - Full context
 * @returns {TaggedResponse}
 */
function buildProjectStatusResponse(input, project, workingMemory, context) {
  const parts = [];

  parts.push(`📂 **${project.name}**`);
  if (project.path) parts.push(`Cesta: \`${project.path}\``);
  if (project.scope) parts.push(`Scope: ${project.scope}`);

  if (workingMemory?.goal) {
    parts.push(`\n🎯 **Cíl:** ${workingMemory.goal}`);
  } else {
    parts.push(`\n🎯 **Cíl:** Zatím nenastavený. Zadejte cíl pro lepší navigaci.`);
  }

  if (workingMemory?.activeFile) {
    parts.push(`📄 **Aktivní soubor:** \`${workingMemory.activeFile}\``);
  }

  if (workingMemory?.lastArtifactId) {
    parts.push(`🔧 **Poslední artefakt:** ${workingMemory.lastArtifactId}`);
  }

  if (workingMemory?.driftCount > 0) {
    parts.push(`⚠️ **Drift count:** ${workingMemory.driftCount} (odchylky od cíle)`);
  }

  // History summary if available
  const historyLen = context.history?.length || 0;
  if (historyLen > 0) {
    parts.push(`\n💬 **Konverzace:** ${historyLen} zpráv v této session`);
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ANSWER', reason: 'PROJECT_SELF_QUERY' },
      source: 'working_memory',
      intercepted: true,  // v56.2: marks that CRE was bypassed
    },
  });

  return new TaggedResponse({
    content: parts.join('\n'),
    tag,
  });
}

export async function projectHandler(input, context) {
  const { sessionId, project } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Project IS selected - route through CRE with CODE context
  // ════════════════════════════════════════════════════════════════════════════

  if (project && project.id) {
    logger.info('ProjectHandler', `Project active: ${project.name}`, {
      projectId: project.id,
      scope: project.scope || 'project',
    });

    // ════════════════════════════════════════════════════════════════════════
    // v56.2 Sprint D: PROJECT-SELF QUERY INTERCEPTOR (#8)
    // ════════════════════════════════════════════════════════════════════════
    // "Jaký je stav projektu?" → working memory response, NO web search.
    // Must run BEFORE CRE routing — otherwise CRE classifies as SEARCH
    // and DDG gets "Jaký je stav projektu?" (nonsense web query).
    // ════════════════════════════════════════════════════════════════════════
    if (isProjectSelfQuery(input)) {
      logger.info('ProjectHandler', 'Project-self query intercepted (bypassing CRE)', {
        input: input.substring(0, 60),
        projectId: project.id,
      });
      return buildProjectStatusResponse(
        input,
        project,
        context.projectWorkingMemory || {},
        context
      );
    }

    // Get CRE decision with project context
    const decision = creDecisionEngine.decide(input, {
      ...context,
      hasActiveProject: true,
      projectId: project.id,
      projectName: project.name,
      projectScope: project.scope || 'project',
    });

    assertDecision(decision);

    logger.info('ProjectHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
    });

    // Handle based on decision
    switch (decision.type) {
      case DecisionType.TOOL_CALL:
        // v44.2 - Ensure project context is fully propagated for sandbox
        return await handleToolCallDecision(input, decision, {
          ...context,
          hasActiveProject: true,
          project: project, // Explicit project for ToolExecutor sandbox
          projectPath: project.path, // Explicit path for backward compatibility
        });

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // In project mode, even CONVERSATIONAL gets project context
        return await handleAnswerDecision(input, decision, context);

      default:
        return handleRefuseDecision(input, decision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: No project selected - ASK_USER (no text description!)
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('ProjectHandler', 'No project selected - asking user');

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'PROJECT_REQUIRED' },
      slots: ['project'],
      awaitingSelection: true,
    },
  });

  // This is ASK_USER behavior, not "chatty" text
  return new TaggedResponse({
    content: `💻 **Vyber projekt**\n\nPro práci s kódem potřebuji znát kontext projektu.\n\n` +
             `**Váš požadavek:** "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"\n\n` +
             `Vyberte projekt z nabídky nebo vytvořte nový.`,
    tag,
  });
}


