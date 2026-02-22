// handlers/index.js — Barrel export for all handler modules
// ══════════════════════════════════════════════════════════════════════════════
// Re-exports for backwards compatibility with existing imports.
// New code should import directly from submodules.
//
// v60.2: Optional modules (expert, agent) loaded with try-catch.
//        Core (conversation, project, decisions) always loaded.
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../../config.js';
import { logger } from '../../core/logger.js';

// ─── Core Handlers (always available) ──────────────────────────────────────
export { conversationHandler } from './conversation.js';
export { projectHandler } from './project.js';

// ─── Decision Sub-Handlers ──────────────────────────────────────────────────
export {
  handleToolCallDecision,
  buildFailureFallback,
  handleAskUserDecision,
  formatClarificationRequest,
  handleAnswerDecision,
  createForbiddenResponseError,
  handleRefuseDecision,
} from './decisions.js';

// ─── Clarification & Goal Alignment ─────────────────────────────────────────
export {
  tryResolveClarification,
  buildResolvedDecision,
  assessGoalAlignment,
} from './clarification.js';

// ─── Report Pipeline ────────────────────────────────────────────────────────
export { buildReportFallback, synthesizeReport } from './report.js';

// ─── Local Computation ──────────────────────────────────────────────────────
export {
  handleLocalDecision,
  computeCalendar,
  computeMath,
  computeDate,
  formatLocalResponse,
} from './local.js';

// ─── Utility Modules ────────────────────────────────────────────────────────
export * from './utils/index.js';

// ─── Optional Module Re-exports (lazy, may not exist) ───────────────────────
// These are re-exported only if the modules are available.
// Consumer code should handle missing exports gracefully.

let _expertiseHandler = null;
let _generateExpertiseResponse = null;
let _wrapWithExpertisePersona = null;
let _buildExpertiseSystemPrompt = null;
let _agentHandler = null;
let _wizardExports = {};

// Lazy-load optional modules at import time (top-level await)
if (config.features.expertises !== false) {
  try {
    const mod = await import('./expertise.js');
    _expertiseHandler = mod.expertiseHandler;
    _generateExpertiseResponse = mod.generateExpertiseResponse;
    _wrapWithExpertisePersona = mod.wrapWithExpertisePersona;
    _buildExpertiseSystemPrompt = mod.buildExpertiseSystemPrompt;
  } catch (err) {
    logger.warn('handlers/index', `Expert handler not available: ${err.message}`);
  }
}

if (config.features.agents !== false) {
  try {
    const mod = await import('./agent.js');
    _agentHandler = mod.agentHandler;
  } catch (err) {
    logger.warn('handlers/index', `Agent handler not available: ${err.message}`);
  }
  try {
    const mod = await import('./agent-wizard.js');
    _wizardExports = mod;
  } catch (err) {
    logger.warn('handlers/index', `Agent wizard not available: ${err.message}`);
  }
}

export const expertiseHandler = _expertiseHandler;
export const generateExpertiseResponse = _generateExpertiseResponse;
export const wrapWithExpertisePersona = _wrapWithExpertisePersona;
export const buildExpertiseSystemPrompt = _buildExpertiseSystemPrompt;
export const agentHandler = _agentHandler;

// Wizard exports — may be null if agents disabled
export const getActiveWizard = _wizardExports.getActiveWizard || null;
export const cancelWizard = _wizardExports.cancelWizard || null;
export const handleWizardInput = _wizardExports.handleWizardInput || null;
export const handleAgentWizardDetected = _wizardExports.handleAgentWizardDetected || null;
export const isWizardTrigger = _wizardExports.isWizardTrigger || null;
export const WIZARD_PATTERNS = _wizardExports.WIZARD_PATTERNS || null;

// ─── Feedback & Preferences API (v45.0) ─────────────────────────────────────
import { preferenceEngine } from '../../memory/preferences.js';
import { ChatMode } from '../controller.js';
import { conversationHandler } from './conversation.js';
import { projectHandler } from './project.js';
import { FollowUpType } from './utils/followup.js';

export function recordFeedback(type, context = {}) {
  if (type === 'positive') {
    preferenceEngine.recordPositiveFeedback(context);
  } else if (type === 'negative') {
    preferenceEngine.recordNegativeFeedback(context);
  }
}

export function getUserPreferences() {
  return preferenceEngine.getStats();
}

export function getDefaultHandlers() {
  const handlers = {
    [ChatMode.CONVERSATION]: conversationHandler,
    [ChatMode.PROJECT]: projectHandler,
  };
  if (_expertiseHandler) handlers[ChatMode.EXPERTISE] = _expertiseHandler;
  if (_agentHandler) handlers[ChatMode.AGENT] = _agentHandler;
  return handlers;
}

// ─── Default Export ─────────────────────────────────────────────────────────
export default {
  conversationHandler,
  projectHandler,
  expertiseHandler: _expertiseHandler,
  agentHandler: _agentHandler,
  getDefaultHandlers,
  recordFeedback,
  getUserPreferences,
  FollowUpType,
};
