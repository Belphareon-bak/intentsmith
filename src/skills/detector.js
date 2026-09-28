// Skill Detector — detects repeating workflow patterns and proposes skills
// ══════════════════════════════════════════════════════════════════════════════
//
// Tracks the sequence of decision types across turns in a session.
// When the same sequence appears >= PROPOSAL_THRESHOLD times, proposes
// creating a skill via the meta-skill "create-skill".
//
// Rules:
//   - Minimum 2 different decision types in sequence
//   - Minimum sequence length 2
//   - Within 7 days (last_seen)
//   - No proposal for patterns already proposed
//   - After proposing, reset count (don't nag)
//
// Integration:
//   - conversation handler calls recordDecision() after each turn
//   - conversation handler calls checkForProposal() before each turn
//   - detector returns null or { pattern, proposal message }
//
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { workflowPatterns } from '../db/database.js';
import { logger } from '../core/logger.js';

const PROPOSAL_THRESHOLD = 3;
const MAX_SEQUENCE_LENGTH = 6; // don't track overly long sequences
const MIN_SEQUENCE_LENGTH = 2;

// Decision types that count as "productive" (not just answering)
const PRODUCTIVE_TYPES = new Set([
  'SEARCH', 'CODE', 'CREATIVE', 'BUILD', 'SKILL',
  'FILE_EXPLAIN', 'PLAN',
]);

// Decision types to exclude from sequence tracking
const EXCLUDED_TYPES = new Set([
  'ANSWER', 'CONVERSATIONAL', 'GREETING', 'CLARIFICATION',
]);

/**
 * Record a decision type for the current session's workflow sequence.
 * Called after each conversation turn.
 *
 * @param {Object} sessionState - session state object (mutable)
 * @param {string} decisionType - the CRE decision type (e.g., 'SEARCH', 'CREATIVE')
 * @param {string} sessionId
 */
export function recordDecision(sessionState, decisionType, sessionId) {
  if (!sessionState || !decisionType) return;

  // Only semantic workflow intents are eligible. This is deliberately an
  // allowlist: transport decision types such as TOOL_CALL and LOCAL are common
  // plumbing transitions, not reusable user workflows.
  if (EXCLUDED_TYPES.has(decisionType) || !PRODUCTIVE_TYPES.has(decisionType)) return;

  // Initialize sequence array
  if (!sessionState._workflowSequence) {
    sessionState._workflowSequence = [];
  }

  sessionState._workflowSequence.push(decisionType);

  // Cap length
  if (sessionState._workflowSequence.length > MAX_SEQUENCE_LENGTH) {
    sessionState._workflowSequence = sessionState._workflowSequence.slice(-MAX_SEQUENCE_LENGTH);
  }

  // Store the sequence if it's long enough and has variety
  const seq = sessionState._workflowSequence;
  if (seq.length >= MIN_SEQUENCE_LENGTH) {
    const uniqueTypes = new Set(seq);
    if (uniqueTypes.size >= 2) {
      _storePattern(seq, sessionId);
    }
  }
}

/**
 * Check if any workflow pattern should be proposed as a skill.
 * Called before each conversation turn.
 *
 * @param {Object} sessionState - session state object
 * @returns {{ patternHash: string, toolSequence: string, count: number, message: string } | null}
 */
export function checkForProposal(sessionState) {
  if (!sessionState) return null;

  // Don't propose if already proposed in this session
  if (sessionState._skillProposalShown) return null;

  try {
    const row = workflowPatterns.findProposable.get(PROPOSAL_THRESHOLD);
    if (!row) return null;

    // Check last_seen within 7 days
    const lastSeen = new Date(row.last_seen);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (lastSeen < sevenDaysAgo) return null;

    // Mark as proposed (won't show again)
    workflowPatterns.markProposed.run(row.pattern_hash);
    sessionState._skillProposalShown = true;

    const steps = row.tool_sequence.split('→').map(s => s.trim());
    const stepsDesc = steps.join(' → ');

    logger.info('SkillDetector', `Proposing skill for pattern "${stepsDesc}" (${row.count}× detected)`);

    return {
      patternHash: row.pattern_hash,
      toolSequence: row.tool_sequence,
      count: row.count,
      message: `Všiml jsem si, že opakovaně používáš postup: **${stepsDesc}**\n` +
        `(${row.count}× za posledních 7 dní)\n\n` +
        `Mám z toho vytvořit skill? (ano/ne)`,
    };
  } catch (err) {
    logger.error('SkillDetector', `checkForProposal failed: ${err.message}`);
    return null;
  }
}

/**
 * Reset a pattern's count after the user declines skill creation.
 * Prevents nagging.
 *
 * @param {string} patternHash
 */
export function declineProposal(patternHash) {
  try {
    workflowPatterns.resetCount.run(patternHash);
  } catch (err) {
    logger.error('SkillDetector', `declineProposal failed: ${err.message}`);
  }
}

/**
 * Clear the current session's workflow sequence (e.g., on new conversation topic).
 *
 * @param {Object} sessionState
 */
export function clearSequence(sessionState) {
  if (sessionState) {
    sessionState._workflowSequence = [];
  }
}

// ── Internal ─────────────────────────────────────────────────────────────────

function _storePattern(sequence, sessionId) {
  try {
    const seqStr = sequence.join(' → ');
    const hash = crypto.createHash('sha256').update(seqStr).digest('hex').substring(0, 16);
    const now = new Date().toISOString();

    // Build session_ids list (for reference, not used for logic)
    const existing = workflowPatterns.findByHash.get(hash);
    let sessionIds = sessionId;
    if (existing && existing.session_ids) {
      const ids = existing.session_ids.split(',');
      if (!ids.includes(sessionId)) {
        ids.push(sessionId);
        // Keep last 10 session IDs
        sessionIds = ids.slice(-10).join(',');
      } else {
        sessionIds = existing.session_ids;
      }
    }

    workflowPatterns.upsert.run(hash, seqStr, now, sessionIds);
  } catch (err) {
    logger.error('SkillDetector', `_storePattern failed: ${err.message}`);
  }
}

export default {
  recordDecision,
  checkForProposal,
  declineProposal,
  clearSequence,
};
