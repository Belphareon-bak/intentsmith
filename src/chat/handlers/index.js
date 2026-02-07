// handlers/index.js — Barrel export for all handler modules
// ══════════════════════════════════════════════════════════════════════════════
// Re-exports for backwards compatibility with existing imports.
// New code should import directly from submodules.
// ══════════════════════════════════════════════════════════════════════════════

// ─── Mode Handlers ───────────────────────────────────────────────────────────
export { conversationHandler } from './conversation.js';
export { projectHandler } from './project.js';
export { expertHandler, generateExpertResponse, wrapWithExpertPersona, buildExpertSystemPrompt } from './expert.js';
export { agentHandler } from './agent.js';

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

// ─── Clarification & Goal Alignment ────────────────────────────────────────
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

// ─── Feedback & Preferences API (v45.0) ─────────────────────────────────────
import { preferenceEngine } from '../../memory/preferences.js';
import { ChatMode } from '../controller.js';

import { conversationHandler } from './conversation.js';
import { projectHandler } from './project.js';
import { expertHandler } from './expert.js';
import { agentHandler } from './agent.js';
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
  return {
    [ChatMode.CONVERSATION]: conversationHandler,
    [ChatMode.PROJECT]: projectHandler,
    [ChatMode.EXPERT]: expertHandler,
    [ChatMode.AGENT]: agentHandler,
  };
}

// ─── Default Export ─────────────────────────────────────────────────────────
export default {
  conversationHandler,
  projectHandler,
  expertHandler,
  agentHandler,
  getDefaultHandlers,
  recordFeedback,
  getUserPreferences,
  FollowUpType,
};
