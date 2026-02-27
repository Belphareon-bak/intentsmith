// Skill Handler — resolve, confirm, execute, resume, propose skill workflows (v85)
// ══════════════════════════════════════════════════════════════════════════════
//
// handleSkillDecision:     CRE → SKILL → resolver → prepare → confirmation prompt
// handleSkillConfirmation: user "ano"/"ne" → execute, cancel, resume, or handle proposal
//
// Priority order in handleSkillConfirmation:
//   1. AWAITING_INPUT (interactive checkpoint)
//   2. Skill proposal response (detector proposed → user responds)
//   3. Pending skill proposal (detector detected → show to user)
//   4. CONFIRMING (initial confirmation)
//
// Interactive flow:
//   CONFIRMING → user "ano" → EXECUTING → AWAITING_INPUT → user responds →
//   EXECUTING → ... → DONE
//
// Detector flow:
//   pattern detected → show proposal → user "ano" → create-skill meta-skill
//
// ══════════════════════════════════════════════════════════════════════════════

import { resolveSkill } from '../../skills/resolver.js';
import { skillRegistry } from '../../skills/registry.js';
import { prepare, confirmAndExecute, resume, cancel } from '../../skills/runner.js';
import { skillExecutions } from '../../db/database.js';
import { logger } from '../../core/logger.js';
import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';

let checkForProposal, declineProposal;
try {
  const det = await import('../../skills/detector.js');
  checkForProposal = det.checkForProposal;
  declineProposal = det.declineProposal;
} catch (_) {}

const CONFIDENCE_THRESHOLD = 0.6;

// Confirmation patterns (Czech + English)
const CONFIRM_YES = /^(ano|yes|jo|jasn[eě]|ok|potvrdit|spust|spusť|sure|yeah|yep)\s*[!.]?$/i;
const CONFIRM_NO = /^(ne|no|nechci|zru[sš]|cancel|stop|nene)\s*[!.]?$/i;

function skillResponse(content, metadata = {}) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 1.0,
    canExecute: false,
    metadata: { ...metadata, skillSystem: true },
  });
  return new TaggedResponse({ content, tag });
}

/**
 * Handle SKILL decision from CRE.
 * Calls resolver to identify skillId + params, then prepares execution and prompts for confirmation.
 *
 * @param {string} input - User message
 * @param {Object} decision - CRE decision
 * @param {Object} context - { sessionId, sessionState, ... }
 * @returns {TaggedResponse}
 */
export async function handleSkillDecision(input, decision, context) {
  const { sessionId } = context;

  const summaries = skillRegistry.list();
  if (summaries.length === 0) {
    logger.info('SkillHandler', 'No skills registered, falling back to ANSWER');
    return null; // null = caller falls through to handleAnswerDecision
  }

  // Resolve skill via LLM
  const resolved = await resolveSkill(input, summaries, logger);

  if (!resolved || !resolved.skillId) {
    logger.info('SkillHandler', 'Resolver returned no match', { input: input.substring(0, 80) });
    return null; // fall through
  }

  // Low confidence — explicit message
  if (resolved.confidence < CONFIDENCE_THRESHOLD) {
    const skill = skillRegistry.get(resolved.skillId);
    const skillName = skill?.description || resolved.skillId;
    return skillResponse(
      `Nejsem si jistý, jestli mám spustit skill **${skillName}**. ` +
      `Důvěra: ${Math.round(resolved.confidence * 100)}%. ` +
      `Chceš to potvrdit? (ano/ne)`,
      { skillResolve: resolved, lowConfidence: true }
    );
  }

  // Prepare execution (CONFIRMING state)
  const prepared = prepare({
    skillId: resolved.skillId,
    skillParams: resolved.params,
    input,
    confidence: resolved.confidence,
    sessionId,
    conversationId: context.conversationId,
  });

  if (!prepared) {
    logger.error('SkillHandler', 'prepare() returned null');
    return null; // fall through
  }

  const { executionId, skill } = prepared;

  // Store executionId in session for confirmation intercept
  if (context.sessionState) {
    context.sessionState._pendingSkillExecution = executionId;
  }

  // Build confirmation prompt
  const paramSummary = Object.keys(resolved.params).length > 0
    ? '\nParametry: ' + Object.entries(resolved.params).map(([k, v]) => `**${k}**: ${v}`).join(', ')
    : '';
  const stepSummary = skill.steps.map((s, i) => `  ${i + 1}. ${s.type}: ${s.id}`).join('\n');

  return skillResponse(
    `Chystám se spustit skill **${skill.description}** (${skill.id} v${skill.version}).${paramSummary}\n\n` +
    `Kroky:\n${stepSummary}\n\n` +
    `Potvrdit spuštění? (ano/ne)`,
    { skillExecution: executionId, skillId: skill.id, confirming: true }
  );
}

/**
 * Check for pending skill interactions before CRE classify.
 * Returns a TaggedResponse if the input is handled, null otherwise.
 *
 * Priority: AWAITING_INPUT > proposal response > pending proposal > CONFIRMING
 *
 * @param {string} input - User message
 * @param {Object} context - { sessionId, sessionState, ... }
 * @returns {TaggedResponse|null}
 */
export async function handleSkillConfirmation(input, context) {
  const { sessionId, sessionState } = context;

  // 1. Check for AWAITING_INPUT execution (interactive checkpoint)
  const awaitingId = sessionState?._awaitingSkillExecution;
  if (awaitingId) {
    return _handleResumeInput(input, awaitingId, context);
  }

  // Also check DB for AWAITING_INPUT (session might have been restored)
  const dbAwaiting = skillExecutions.findAwaitingInput?.get(sessionId);
  if (dbAwaiting) {
    if (sessionState) sessionState._awaitingSkillExecution = dbAwaiting.id;
    return _handleResumeInput(input, dbAwaiting.id, context);
  }

  // 2. Check for awaiting skill proposal response (user saw proposal, now responding)
  const awaitingProposal = sessionState?._awaitingSkillProposal;
  if (awaitingProposal) {
    return _handleProposalResponse(input, awaitingProposal, context);
  }

  // 3. Check for pending skill proposal (detected but not yet shown)
  const pendingProposal = sessionState?._pendingSkillProposal;
  if (pendingProposal) {
    sessionState._pendingSkillProposal = null;
    sessionState._awaitingSkillProposal = pendingProposal;
    logger.info('SkillHandler', `Showing skill proposal for pattern "${pendingProposal.toolSequence}"`);
    return skillResponse(pendingProposal.message, { proposalShown: true, patternHash: pendingProposal.patternHash });
  }

  // 4. Check for CONFIRMING execution (confirmation prompt)
  const pendingId = sessionState?._pendingSkillExecution;
  if (pendingId) {
    return _handleConfirmInput(input, pendingId, context);
  }

  // Also check DB for CONFIRMING
  const dbPending = skillExecutions.findPending.get(sessionId);
  if (dbPending) {
    if (sessionState) sessionState._pendingSkillExecution = dbPending.id;
    return _handleConfirmInput(input, dbPending.id, context);
  }

  // 5. Proactively check for new proposals (if detector available)
  if (checkForProposal && sessionState) {
    const proposal = checkForProposal(sessionState);
    if (proposal) {
      sessionState._awaitingSkillProposal = proposal;
      logger.info('SkillHandler', `Showing skill proposal for pattern "${proposal.toolSequence}"`);
      return skillResponse(proposal.message, { proposalShown: true, patternHash: proposal.patternHash });
    }
  }

  return null;
}

// ── Confirmation handling (CONFIRMING state) ─────────────────────────────────

async function _handleConfirmInput(input, executionId, context) {
  const trimmed = input.trim();

  if (CONFIRM_YES.test(trimmed)) {
    // Clear pending
    if (context.sessionState) {
      context.sessionState._pendingSkillExecution = null;
    }

    logger.info('SkillHandler', `User confirmed skill execution ${executionId}`);
    const result = await confirmAndExecute(executionId);

    return _handleExecutionResult(result, executionId, context);
  }

  if (CONFIRM_NO.test(trimmed)) {
    // Clear pending
    if (context.sessionState) {
      context.sessionState._pendingSkillExecution = null;
    }

    cancel(executionId);
    return skillResponse(
      'Skill zrušen.',
      { skillExecution: executionId, cancelled: true }
    );
  }

  // Not a confirmation response — return null to let normal CRE processing handle it
  // But clear the pending skill since user moved on
  if (context.sessionState) {
    context.sessionState._pendingSkillExecution = null;
  }
  cancel(executionId);
  return null;
}

// ── Resume handling (AWAITING_INPUT state) ───────────────────────────────────

async function _handleResumeInput(input, executionId, context) {
  const trimmed = input.trim();

  // Cancel on explicit cancel
  if (CONFIRM_NO.test(trimmed)) {
    if (context.sessionState) {
      context.sessionState._awaitingSkillExecution = null;
    }

    cancel(executionId);
    return skillResponse(
      'Skill zrušen.',
      { skillExecution: executionId, cancelled: true }
    );
  }

  // Clear awaiting state (will be re-set if execution hits another interactive step)
  if (context.sessionState) {
    context.sessionState._awaitingSkillExecution = null;
  }

  logger.info('SkillHandler', `Resuming skill execution ${executionId} with user input`);
  const result = await resume(executionId, input);

  return _handleExecutionResult(result, executionId, context);
}

// ── Proposal response handling ───────────────────────────────────────────────

async function _handleProposalResponse(input, proposal, context) {
  const { sessionId, sessionState } = context;
  const trimmed = input.trim();

  // Clear awaiting proposal state
  if (sessionState) {
    sessionState._awaitingSkillProposal = null;
  }

  if (CONFIRM_YES.test(trimmed)) {
    logger.info('SkillHandler', `User accepted skill proposal for "${proposal.toolSequence}"`);

    // Derive a slug from the tool sequence
    const slug = proposal.toolSequence
      .replace(/\s*→\s*/g, '-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 40);

    // Launch create-skill meta-skill
    const prepared = prepare({
      skillId: 'create-skill',
      skillParams: { name: slug },
      input: `Vytvořit skill z opakujícího se vzoru: ${proposal.toolSequence}`,
      confidence: 1.0,
      sessionId,
      conversationId: context.conversationId,
    });

    if (!prepared) {
      return skillResponse(
        'Meta-skill "create-skill" není dostupný. Zkontroluj `skills/create-skill.json`.',
        { proposalFailed: true }
      );
    }

    // Auto-confirm since user already approved the proposal
    const result = await confirmAndExecute(prepared.executionId);
    return _handleExecutionResult(result, prepared.executionId, context);
  }

  if (CONFIRM_NO.test(trimmed)) {
    logger.info('SkillHandler', `User declined skill proposal for "${proposal.toolSequence}"`);
    if (declineProposal) {
      declineProposal(proposal.patternHash);
    }
    return skillResponse(
      'Rozumím, nebudu to navrhovat.',
      { proposalDeclined: true, patternHash: proposal.patternHash }
    );
  }

  // Neither yes nor no — clear and let normal processing continue
  logger.debug('SkillHandler', `Proposal response not recognized, clearing proposal`);
  return null;
}

// ── Shared result handling ───────────────────────────────────────────────────

function _handleExecutionResult(result, executionId, context) {
  if (result.status === 'success') {
    // Auto-reload registry if create-skill completed
    _maybeReloadRegistry(executionId);

    // Find the final output (last step)
    const outputs = result.output || {};
    const keys = Object.keys(outputs);
    const lastOutput = keys.length > 0 ? outputs[keys[keys.length - 1]] : '';

    return skillResponse(
      `Skill dokončen.\n\n${lastOutput}`,
      { skillExecution: executionId, completed: true }
    );
  }

  if (result.status === 'awaiting_input') {
    // Execution paused at interactive checkpoint — store for resume
    if (context.sessionState) {
      context.sessionState._awaitingSkillExecution = result.executionId;
    }

    // Build prompt for user
    let prompt = '';
    if (result.content) {
      prompt += `---\n${result.content}\n---\n\n`;
    }
    prompt += result.prompt;

    return skillResponse(
      prompt,
      {
        skillExecution: result.executionId,
        awaitingInput: true,
        stepId: result.stepId,
        stepType: result.stepType,
      }
    );
  }

  // Error
  return skillResponse(
    `Skill selhal: ${result.error}`,
    { skillExecution: executionId, failed: true }
  );
}

// ── Auto-reload after create-skill ───────────────────────────────────────────

function _maybeReloadRegistry(executionId) {
  try {
    const exec = skillExecutions.findById.get(executionId);
    if (exec && exec.skill_id === 'create-skill') {
      const result = skillRegistry.reload();
      logger.info('SkillHandler', `Auto-reloaded registry after create-skill: ${result.loaded} skills`);
    }
  } catch (err) {
    logger.error('SkillHandler', `Auto-reload failed: ${err.message}`);
  }
}
