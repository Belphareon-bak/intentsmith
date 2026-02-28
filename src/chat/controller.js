// CRE v44.0 — FÁZE A: Chat Controller
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 9 — SYSTEM UNIFICATION
//
// ChatController: Single entry point for all user interactions
// - Accepts user input
// - Decides which mode to activate (conversation, project, expert, agent)
// - Passes control to appropriate handler
// - Tags all responses with speaker, mode, confidence, can_execute
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import { logger } from '../core/logger.js';
import { SafetyEngine } from './safety/engine.js';
import { getConversationStore, TurnRole } from './conversation-store.js';
import { getLTMContextForSynthesis } from './ltm-context.js';
import { maybeCompact } from './context-compact.js';
import { maybeInitContext } from './context-init.js';
import { getMemoryBank } from '../memory/memory-bank.js';
import { longTermMemory } from '../memory/long-term.js';
import { buildBudgetedContext } from './context-budget.js';
import db from '../db/database.js';

// ─────────────────────────────────────────────────────────────────────────────
// Chat Mode Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Available chat modes
 * @readonly
 * @enum {string}
 */
export const ChatMode = Object.freeze({
  /** Simple Q&A, casual conversation */
  CONVERSATION: 'conversation',
  /** Project-scoped work with focus locking */
  PROJECT: 'project',
  /** Domain expertise consultation */
  EXPERTISE: 'expert',
  /** Autonomous agent execution */
  AGENT: 'agent',
});

/**
 * Response speaker types
 * @readonly
 * @enum {string}
 */
export const ResponseSpeaker = Object.freeze({
  /** Main CRE system */
  SYSTEM: 'system',
  /** Domain expertise */
  EXPERTISE: 'expert',
  /** Autonomous agent */
  AGENT: 'agent',
  /** User (for echo/confirmation) */
  USER: 'user',
});

// ─────────────────────────────────────────────────────────────────────────────
// Response Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response metadata tag - attached to every response
 */
export class ResponseTag {
  #speaker;
  #mode;
  #confidence;
  #canExecute;
  #timestamp;
  #metadata;

  /**
   * @param {Object} options
   * @param {string} options.speaker - Who is speaking (ResponseSpeaker)
   * @param {string} options.mode - Current chat mode (ChatMode)
   * @param {number} options.confidence - Confidence level 0-1
   * @param {boolean} options.canExecute - Whether response includes executable actions
   * @param {Object} [options.metadata] - Additional metadata
   */
  constructor({ speaker, mode, confidence, canExecute = false, metadata = {} }) {
    if (!Object.values(ResponseSpeaker).includes(speaker)) {
      throw new Error(`Invalid speaker: ${speaker}`);
    }
    if (!Object.values(ChatMode).includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      throw new Error(`Confidence must be a number between 0 and 1, got: ${confidence}`);
    }

    this.#speaker = speaker;
    this.#mode = mode;
    this.#confidence = confidence;
    this.#canExecute = canExecute;
    this.#timestamp = Date.now();
    this.#metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }

  get speaker() { return this.#speaker; }
  get mode() { return this.#mode; }
  get confidence() { return this.#confidence; }
  get canExecute() { return this.#canExecute; }
  get timestamp() { return this.#timestamp; }
  get metadata() { return this.#metadata; }

  /**
   * Serialize to plain object
   */
  toJSON() {
    return {
      speaker: this.#speaker,
      mode: this.#mode,
      confidence: this.#confidence,
      can_execute: this.#canExecute,
      timestamp: this.#timestamp,
      metadata: this.#metadata,
    };
  }

  /**
   * Create from plain object
   */
  // ──── Static factory getters ────────────────────────────────────────────
  static get RESPONSE() {
    return new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
    });
  }

  static get REFUSE() {
    return new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      canExecute: false,
      metadata: { refused: true },
    });
  }

  static get SYSTEM() {
    return new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      canExecute: false,
    });
  }

  static fromJSON(json) {
    return new ResponseTag({
      speaker: json.speaker,
      mode: json.mode,
      confidence: json.confidence,
      canExecute: json.can_execute,
      metadata: json.metadata || {},
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tagged Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response with metadata tag
 */
export class TaggedResponse {
  #content;
  #tag;
  #actions;

  /**
   * @param {Object} options
   * @param {string} options.content - Response content
   * @param {ResponseTag} options.tag - Response metadata
   * @param {Array} [options.actions] - Executable actions (if canExecute)
   */
  constructor({ content, tag, actions = [] }) {
    if (!(tag instanceof ResponseTag)) {
      throw new Error('Tag must be a ResponseTag instance');
    }
    if (tag.canExecute && (!Array.isArray(actions) || actions.length === 0)) {
      throw new Error('canExecute is true but no actions provided');
    }

    this.#content = content;
    this.#tag = tag;
    this.#actions = Object.freeze([...actions]);
    Object.freeze(this);
  }

  get content() { return this.#content; }
  get tag() { return this.#tag; }
  get actions() { return this.#actions; }

  /** Shorthand accessors */
  get speaker() { return this.#tag.speaker; }
  get mode() { return this.#tag.mode; }
  get confidence() { return this.#tag.confidence; }
  get canExecute() { return this.#tag.canExecute; }
  get metadata() { return this.#tag.metadata; }

  toJSON() {
    return {
      content: this.#content,
      tag: this.#tag.toJSON(),
      actions: this.#actions,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modes that require explicit user confirmation before switching
 * CRITICAL: Agent mode must NEVER auto-switch without confirmation
 */
export const MODES_REQUIRING_CONFIRMATION = Object.freeze([
  ChatMode.AGENT,
]);

/**
 * Mode detection result
 */
export class ModeDetection {
  #mode;
  #confidence;
  #signals;
  #reason;
  #requiresConfirmation;

  constructor({ mode, confidence, signals = [], reason = '', requiresConfirmation = null }) {
    this.#mode = mode;
    this.#confidence = confidence;
    this.#signals = Object.freeze([...signals]);
    this.#reason = reason;
    // Auto-determine confirmation requirement if not explicitly set
    this.#requiresConfirmation = requiresConfirmation !== null
      ? requiresConfirmation
      : MODES_REQUIRING_CONFIRMATION.includes(mode);
    Object.freeze(this);
  }

  get mode() { return this.#mode; }
  get confidence() { return this.#confidence; }
  get signals() { return this.#signals; }
  get reason() { return this.#reason; }
  /** Whether this mode switch requires explicit user confirmation */
  get requiresConfirmation() { return this.#requiresConfirmation; }
}

/**
 * Mode detector - analyzes input to determine appropriate mode
 */
export class ModeDetector {
  #patterns;
  #projectContext;
  #expertiseRegistry;

  constructor({ projectContext = null, expertiseRegistry = null } = {}) {
    this.#projectContext = projectContext;
    this.#expertiseRegistry = expertiseRegistry;
    this.#patterns = this.#initPatterns();
  }

  #initPatterns() {
    return {
      agent: [
        /\b(run|execute|deploy|build|test|install|create|generate)\b/i,
        /\b(make|do|perform|process)\s+\w+/i,
        /\b(autonomous|background|async)\b/i,
      ],
      expert: [
        // v56.2.1 Sprint E: Narrowed — generic question words (explain, what is, why)
        // were hijacking normal queries to ExpertHandler. Only explicit expert requests.
        /\b(as an? (expert|specialist|architect|consultant|advisor))\b/i,
        /\b(expert (mode|opinion|analysis|review|consultation))\b/i,
        /\b(switch to expert|use expert|ask.{0,10}expert)\b/i,
      ],
      project: [
        /\b(in this (project|codebase|repo))\b/i,
        /\b(file|module|component|function|class)\s+\w+/i,
        /\b(refactor|modify|change|update|fix)\b/i,
      ],
      conversation: [
        /\b(hello|hi|hey|thanks|bye)\b/i,
        /\b(what's up|how are you)\b/i,
        /^[^a-z]*$/i, // No words
      ],
    };
  }

  /**
   * Detect the appropriate mode for user input
   * @param {string} input - User input
   * @param {Object} [context] - Additional context
   * @returns {ModeDetection}
   */
  detect(input, context = {}) {
    const signals = [];
    const scores = {
      [ChatMode.CONVERSATION]: 0,
      [ChatMode.PROJECT]: 0,
      [ChatMode.EXPERTISE]: 0,
      [ChatMode.AGENT]: 0,
    };

    // Check pattern matches
    for (const [mode, patterns] of Object.entries(this.#patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          scores[mode] += 1;
          signals.push({ type: 'pattern', mode, pattern: pattern.source });
        }
      }
    }

    // Context signals
    if (context.hasActiveProject || this.#projectContext?.isActive()) {
      scores[ChatMode.PROJECT] += 2;
      signals.push({ type: 'context', mode: ChatMode.PROJECT, reason: 'active_project' });
    }

    if (context.requestedExpertise) {
      scores[ChatMode.EXPERTISE] += 3;
      signals.push({ type: 'explicit', mode: ChatMode.EXPERTISE, expert: context.requestedExpertise });
    }

    if (context.requestedAgent) {
      scores[ChatMode.AGENT] += 3;
      signals.push({ type: 'explicit', mode: ChatMode.AGENT, agent: context.requestedAgent });
    }

    // Find highest scoring mode
    const maxScore = Math.max(...Object.values(scores));
    const detectedMode = Object.entries(scores)
      .find(([, score]) => score === maxScore)[0];

    // Calculate confidence
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    const confidence = totalScore > 0 ? maxScore / totalScore : 0.5;

    // Default to conversation if no signals
    let finalMode = totalScore === 0 ? ChatMode.CONVERSATION : detectedMode;
    const finalConfidence = totalScore === 0 ? 0.8 : Math.min(confidence + 0.2, 1);

    // v72: PROJECT mode requires active project context — pattern-only match is not enough.
    // Words like "function", "change" match project patterns but appear in general conversation.
    if (finalMode === ChatMode.PROJECT && !context.hasActiveProject) {
      finalMode = ChatMode.CONVERSATION;
    }

    return new ModeDetection({
      mode: finalMode,
      confidence: finalConfidence,
      signals,
      reason: `Detected ${signals.length} signals, highest score: ${detectedMode}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chat Controller - Single entry point for all user interactions
 *
 * Responsibilities:
 * - Accept user input
 * - Detect appropriate mode
 * - Route to correct handler
 * - Tag all responses
 */
export class ChatController {
  #sessionId;
  #currentMode;
  #modeDetector;
  #handlers;
  #responseHistory;
  #modeTransitions;
  #config;

  /**
   * @param {Object} options
   * @param {string} options.sessionId - Session identifier
   * @param {Object} [options.handlers] - Mode handlers
   * @param {Object} [options.config] - Configuration
   */
  constructor({ sessionId, handlers = {}, config = {} }) {
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    this.#sessionId = sessionId;
    this.#currentMode = ChatMode.CONVERSATION;
    this.#modeDetector = new ModeDetector(config);
    this.#handlers = new Map();
    this.#responseHistory = [];
    this.#modeTransitions = [];
    this.#config = {
      autoModeDetection: true,
      modeConfidenceThreshold: 0.6,
      maxHistorySize: 100,
      ...config,
    };

    // Register provided handlers
    for (const [mode, handler] of Object.entries(handlers)) {
      this.registerHandler(mode, handler);
    }

    // Register default conversation handler
    if (!this.#handlers.has(ChatMode.CONVERSATION)) {
      this.registerHandler(ChatMode.CONVERSATION, this.#defaultConversationHandler.bind(this));
    }
  }

  get sessionId() { return this.#sessionId; }
  get currentMode() { return this.#currentMode; }
  get responseHistory() { return [...this.#responseHistory]; }
  get modeTransitions() { return [...this.#modeTransitions]; }

  /**
   * Register a handler for a specific mode
   * @param {string} mode - ChatMode
   * @param {Function} handler - Handler function (input, context) => TaggedResponse
   */
  registerHandler(mode, handler) {
    if (!Object.values(ChatMode).includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.#handlers.set(mode, handler);
  }

  /**
   * Process user input
   * @param {string} input - User input
   * @param {Object} [context] - Additional context
   * @returns {Promise<TaggedResponse>}
   */
  async process(input, context = {}) {
    // ═══ Safety Pre-Check ═══════════════════════════════════════════════════
    try {
      const safetyVerdict = SafetyEngine.check(input, context);
      if (safetyVerdict && safetyVerdict.action === 'block') {
        logger.warn('Safety', 'Input blocked by safety engine', {
          domain: safetyVerdict.domain,
          reason: safetyVerdict.reason,
        });
        return new TaggedResponse({
          content: safetyVerdict.userMessage || 'Tuto otázku nemohu bezpečně zodpovědět.',
          tag: ResponseTag.REFUSE,
          speaker: ResponseSpeaker.SYSTEM,
          mode: this.#currentMode,
          confidence: 1.0,
        });
      }
    } catch (e) {
      // Safety check failure should not block processing
      logger.error('Safety', 'Safety pre-check failed', { error: e.message });
    }
    // ════════════════════════════════════════════════════════════════════════

    // Detect mode
    let targetMode = this.#currentMode;
    let detection = null;
    let pendingConfirmation = null;

    // ════════════════════════════════════════════════════════════════════════════
    // v44.2 - STICKY MODES: Project/Expert mode stays until explicit exit
    // ════════════════════════════════════════════════════════════════════════════

    const stickyMode = this.#getStickyMode(context);
    if (stickyMode) {
      // Sticky mode active - don't auto-detect, stay in current mode
      targetMode = stickyMode;
      detection = new ModeDetection({
        mode: stickyMode,
        confidence: 1.0,
        signals: [{ type: 'sticky', mode: stickyMode }],
        reason: `Sticky mode: ${stickyMode} (active project/expert)`,
        requiresConfirmation: false,
      });
    } else if (this.#config.autoModeDetection) {
      detection = this.#modeDetector.detect(input, context);

      if (detection.confidence >= this.#config.modeConfidenceThreshold) {
        // CRITICAL: Check if mode requires confirmation before auto-switching
        if (detection.requiresConfirmation && !context.confirmed) {
          // Don't auto-switch - store as pending and stay in current mode
          pendingConfirmation = {
            suggestedMode: detection.mode,
            confidence: detection.confidence,
            reason: detection.reason,
          };
          // Keep current mode
        } else {
          targetMode = detection.mode;
        }
      }
    }

    // Handle explicit mode switch (user confirmed) - overrides sticky
    if (context.forceMode && Object.values(ChatMode).includes(context.forceMode)) {
      targetMode = context.forceMode;
      pendingConfirmation = null; // Clear any pending
      detection = new ModeDetection({
        mode: targetMode,
        confidence: 1.0,
        signals: [{ type: 'forced', mode: targetMode }],
        reason: 'Forced mode switch',
        requiresConfirmation: false, // Explicit = already confirmed
      });
    }

    // ════════════════════════════════════════════════════════════════════════════
    // v56.2.1 Sprint E: EXPERT mode guard
    // If auto-detected EXPERT but no expert is actually selected, fall back to
    // CONVERSATION. Prevents ExpertHandler from hijacking generic queries.
    // ════════════════════════════════════════════════════════════════════════════
    if (targetMode === ChatMode.EXPERTISE && !context.expertise?.id && !context.requestedExpertise) {
      logger.info('ModeGuard', 'EXPERTISE mode without active expertise — falling back to CONVERSATION', {
        input: input.substring(0, 60),
        detectedConfidence: detection?.confidence,
      });
      targetMode = ChatMode.CONVERSATION;
      detection = new ModeDetection({
        mode: ChatMode.CONVERSATION,
        confidence: 0.8,
        signals: [{ type: 'fallback', mode: ChatMode.CONVERSATION, reason: 'no_active_expertise' }],
        reason: 'Expertise mode detected but no expertise selected - falling back',
      });
    }

    // Transition mode if needed
    if (targetMode !== this.#currentMode) {
      this.#transitionMode(targetMode, detection?.reason || 'auto');
    }

    // ════════════════════════════════════════════════════════════════════════════
    // v59.0 IDE Bridge: Emit CRE decision via hook (if provided by WS bridge)
    // ════════════════════════════════════════════════════════════════════════════
    if (detection && typeof context.onCREDecision === 'function') {
      try {
        context.onCREDecision({
          intent: detection.mode,
          confidence: detection.confidence,
          signals: detection.signals,
          reason: detection.reason,
        });
      } catch (e) {
        logger.warn('ChatController', `onCREDecision hook error: ${e.message}`);
      }
    }

    // System step: handler selected
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('handler_selected', targetMode); } catch (_) {}
    }

    // Get handler
    const handler = this.#handlers.get(targetMode);
    if (!handler) {
      return this.#createErrorResponse(
        `No handler registered for mode: ${targetMode}`,
        targetMode
      );
    }

    // Execute handler
    try {
      const response = await handler(input, {
        ...context,
        sessionId: this.#sessionId,
        mode: targetMode,
        detection,
        pendingConfirmation, // Mode switch waiting for user confirmation
        // v56.0 Sprint 3: Prefer DB-backed history over RAM
        history: context.dbHistory || this.#responseHistory.slice(-10),
      });

      // Ensure response is properly tagged
      let taggedResponse = this.#ensureTagged(response, targetMode, pendingConfirmation);

      // QGv2 runs inside synthesizeWithLLM() (synthesis.js) where it has
      // full context (intent, searchSubType, sourceUrls). Running it again
      // here would be redundant — synthesis.js is the single canonical call site.

      // Add to history
      this.#addToHistory(taggedResponse);

      return taggedResponse;
    } catch (error) {
      return this.#createErrorResponse(
        `Handler error: ${error.message}`,
        targetMode
      );
    }
  }

  /**
   * Explicitly switch mode
   * @param {string} mode - Target mode
   * @param {string} [reason] - Reason for switch
   */
  switchMode(mode, reason = 'explicit') {
    if (!Object.values(ChatMode).includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    this.#transitionMode(mode, reason);
  }

  /**
   * Get current mode info
   */
  getModeInfo() {
    return {
      current: this.#currentMode,
      transitions: this.#modeTransitions.length,
      lastTransition: this.#modeTransitions[this.#modeTransitions.length - 1] || null,
    };
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  /**
   * v44.2 - Get sticky mode based on context
   * Project/Expert modes are sticky until explicitly exited
   *
   * @param {Object} context - Request context
   * @returns {string|null} - Sticky mode or null
   */
  #getStickyMode(context) {
    // Project mode is sticky when project is active
    if (context.hasActiveProject && context.project?.id) {
      return ChatMode.PROJECT;
    }

    // Expertise mode is sticky when expertise is active
    // v87: Auto-selected expertise is NOT sticky — re-evaluate each turn
    if (context.hasActiveExpertise && context.expertise?.id) {
      if (context.expertise._source === 'auto') return null;
      return ChatMode.EXPERTISE;
    }

    // No sticky mode
    return null;
  }

  #transitionMode(newMode, reason) {
    const transition = {
      from: this.#currentMode,
      to: newMode,
      reason,
      timestamp: Date.now(),
    };
    this.#modeTransitions.push(transition);
    if (this.#modeTransitions.length > 100) {
      this.#modeTransitions = this.#modeTransitions.slice(-100);
    }
    this.#currentMode = newMode;
  }

  #ensureTagged(response, mode, pendingConfirmation = null) {
    if (response instanceof TaggedResponse) {
      // If already tagged but has pending confirmation, add to metadata
      if (pendingConfirmation) {
        // Note: TaggedResponse is frozen, so we return as-is
        // Handler should include pendingConfirmation in its response if needed
      }
      return response;
    }

    // Wrap plain response
    const metadata = pendingConfirmation
      ? { pendingModeSwitch: pendingConfirmation }
      : {};

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode,
      confidence: 0.8,
      canExecute: false,
      metadata,
    });

    return new TaggedResponse({
      content: typeof response === 'string' ? response : JSON.stringify(response),
      tag,
    });
  }

  #addToHistory(response) {
    this.#responseHistory.push({
      response: response.toJSON(),
      timestamp: Date.now(),
    });

    // Trim history
    if (this.#responseHistory.length > this.#config.maxHistorySize) {
      this.#responseHistory = this.#responseHistory.slice(-this.#config.maxHistorySize);
    }
  }

  #createErrorResponse(message, mode) {
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode,
      confidence: 1.0,
      canExecute: false,
      metadata: { error: true },
    });

    return new TaggedResponse({
      content: `Error: ${message}`,
      tag,
    });
  }

  #defaultConversationHandler(input, context) {
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
    });

    return new TaggedResponse({
      content: `[Default conversation handler] Received: ${input}`,
      tag,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session State (v44.1 - Persistent Context)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persistent session state for project, expert, user preferences,
 * and conversation continuity (v44.2).
 *
 * This state survives across requests and page reloads.
 *
 * CONVERSATION STATE (v44.2):
 * - lastIntent: Last classified intent
 * - lastDecision: Last CRE decision made
 * - pendingDecision: Decision waiting for user clarification
 * - awaitingClarification: Whether we're waiting for user input
 * - awaitingSlots: What information we need from user
 */
export class SessionState {
  // v88: Static DB reference for working memory persistence
  static _projectMemoryDb = null;

  /**
   * v88: Initialize DB reference for working memory write-through.
   * Called once from server.js after DB is ready.
   * @param {Object} projectMemoryDb — db.projectMemory prepared statements
   */
  static initProjectMemoryDb(projectMemoryDb) {
    SessionState._projectMemoryDb = projectMemoryDb;
  }

  #sessionId;
  #project;      // Active project { id, name, path, scope }
  #expertise;    // Active expertise { id, name, domain }
  #preferences;  // User preferences
  #updatedAt;

  // v44.2 - Conversation state for intent continuity
  #lastIntent;           // Last classified intent (SEARCH, REPORT, CODE, etc.)
  #lastDecision;         // Last CRE decision { type, intent, tools, ... }
  #pendingDecision;      // Decision waiting for clarification
  #awaitingClarification; // Whether waiting for user clarification
  #awaitingSlots;        // What slots need to be filled ['intent', 'source', 'project']
  #lastUserInput;        // Last user input (for context)

  // v44.2+ - Project working memory (contextual state)
  #projectWorkingMemory; // { goal, activeFile, lastArtifactId }

  // v44.3 - Expertise lock (CRE cannot override when locked)
  #expertiseLocked;      // When true, CRE cannot auto-change expertise

  // v58.0 - Active design project (DESIGN intent state)
  #activeDesignProject;  // { type, defaults, startedAt, phase, turnCount, language }

  constructor(sessionId) {
    this.#sessionId = sessionId;
    this.#project = null;
    this.#expertise = null;
    this.#preferences = {};
    this.#updatedAt = Date.now();

    // v44.2 - Initialize conversation state
    this.#lastIntent = null;
    this.#lastDecision = null;
    this.#pendingDecision = null;
    this.#awaitingClarification = false;
    this.#awaitingSlots = [];
    this.#lastUserInput = null;

    // v44.2+ - Initialize project working memory
    this.#projectWorkingMemory = {
      goal: null,           // Current task/goal: "implementovat login formulář"
      activeFile: null,     // Last edited/viewed file: "src/components/Login.tsx"
      lastArtifactId: null, // Last generated artifact ID
      driftCount: 0,        // v44.5 - Count of goal drift warnings (2nd+ = block)
    };

    // v44.3 - Expertise is not locked by default
    this.#expertiseLocked = false;

    // v58.0 - No active design project by default
    this.#activeDesignProject = null;
  }

  get sessionId() { return this.#sessionId; }
  get project() { return this.#project; }
  get expertise() { return this.#expertise; }
  get preferences() { return { ...this.#preferences }; }
  get hasActiveProject() { return this.#project !== null && this.#project.id !== null; }
  get hasActiveExpertise() { return this.#expertise !== null && this.#expertise.id !== null; }
  // v44.3 - Expertise lock state
  get expertiseLocked() { return this.#expertiseLocked; }

  // v44.2 - Conversation state getters
  get lastIntent() { return this.#lastIntent; }
  get lastDecision() { return this.#lastDecision; }
  get pendingDecision() { return this.#pendingDecision; }
  get awaitingClarification() { return this.#awaitingClarification; }
  get awaitingSlots() { return [...this.#awaitingSlots]; }
  get lastUserInput() { return this.#lastUserInput; }

  // v58.0 - DESIGN project getters
  get activeDesignProject() { return this.#activeDesignProject ? { ...this.#activeDesignProject } : null; }
  get hasActiveDesignProject() { return this.#activeDesignProject !== null; }

  /**
   * v58.0 - Set active design project
   * @param {Object|null} project - { type, defaults, startedAt, phase, turnCount, language }
   */
  setActiveDesignProject(project) {
    this.#activeDesignProject = project ? { ...project } : null;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v58.0 - Update design project phase/turn
   * @param {Object} updates - Partial updates to merge
   */
  updateDesignProject(updates) {
    if (!this.#activeDesignProject) return this;
    Object.assign(this.#activeDesignProject, updates, { updatedAt: new Date().toISOString() });
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v58.0 - Close design project (e.g. on BUILD transition or explicit break)
   * @param {string} [reason] - Close reason (graceful_close, build_transition, explicit_break)
   * @returns {Object|null} The closed project (for logging/handoff)
   */
  closeDesignProject(reason) {
    const closed = this.#activeDesignProject;
    this.#activeDesignProject = null;
    this.#updatedAt = Date.now();
    if (closed) {
      closed.closeReason = reason || 'unknown';
      closed.closedAt = Date.now();
      logger.info('SessionState', 'Design project closed', {
        type: closed.type,
        reason: closed.closeReason,
        turnCount: closed.turnCount,
      });
    }
    return closed;
  }

  // v44.2+ - Project working memory getters
  get projectWorkingMemory() { return { ...this.#projectWorkingMemory }; }
  get projectGoal() { return this.#projectWorkingMemory.goal; }
  get activeFile() { return this.#projectWorkingMemory.activeFile; }
  get lastArtifactId() { return this.#projectWorkingMemory.lastArtifactId; }
  // v44.5 - Drift count getter
  get driftCount() { return this.#projectWorkingMemory.driftCount || 0; }

  /**
   * Set active project
   * v44.2+ - Now clears working memory when project changes
   * @param {Object|null} project - { id, name, path?, scope? }
   */
  setProject(project) {
    if (project && !project.id) {
      throw new Error('Project must have an id');
    }
    // Clear working memory if project changed
    const projectChanged = !this.#project || !project ||
                          this.#project.id !== project?.id;
    if (projectChanged) {
      this.clearProjectWorkingMemory();
    }
    this.#project = project ? { ...project } : null;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Set active expertise
   * v44.3 - Now supports locking (CRE cannot override when locked)
   *
   * @param {Object|null} expertise - { id, name, domain? }
   * @param {Object} options - { locked?: boolean, force?: boolean }
   */
  setExpertise(expertise, options = {}) {
    const { locked = true, force = false } = options;

    // v44.3 - Check if expertise is locked and this isn't a forced change
    if (this.#expertiseLocked && !force && expertise?.id !== this.#expertise?.id) {
      // Expertise is locked, cannot change without force
      return this;
    }

    if (expertise && !expertise.id) {
      throw new Error('Expertise must have an id');
    }
    this.#expertise = expertise ? { ...expertise } : null;

    // v44.3 - Lock expertise when explicitly set by user (default)
    // Unlock when expertise is cleared
    this.#expertiseLocked = expertise ? locked : false;

    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v44.3 - Lock the current expertise (prevent CRE from changing)
   */
  lockExpertise() {
    if (this.#expertise) {
      this.#expertiseLocked = true;
      this.#updatedAt = Date.now();
    }
    return this;
  }

  /**
   * v44.3 - Unlock the expertise (allow CRE to change)
   */
  unlockExpertise() {
    this.#expertiseLocked = false;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v44.3 - Check if expertise can be changed (for CRE)
   * Returns true if expertise is not set or not locked
   */
  canChangeExpertise() {
    return !this.#expertise || !this.#expertiseLocked;
  }

  /**
   * Clear project
   */
  clearProject() {
    this.#project = null;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Clear expertise
   * v44.3 - Also clears the lock
   */
  clearExpertise() {
    this.#expertise = null;
    this.#expertiseLocked = false;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Set a preference
   */
  setPreference(key, value) {
    this.#preferences[key] = value;
    this.#updatedAt = Date.now();
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v44.2+ - Project Working Memory Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * v88: Write-through working memory field to DB (non-fatal).
   * @param {string} field
   * @param {*} value
   */
  _persistWorkingMemory(field, value) {
    const db = SessionState._projectMemoryDb;
    const pid = this.#project?.id;
    if (!db || !pid) return;
    try {
      const key = `wm:${field}`;
      if (value == null) {
        db.delete.run(pid, key);
      } else {
        db.set.run(pid, key, String(value), 'working_memory');
      }
    } catch { /* non-fatal */ }
  }

  /**
   * Set current project goal
   * @param {string|null} goal - Current task/objective
   */
  setProjectGoal(goal) {
    this.#projectWorkingMemory.goal = goal;
    this.#updatedAt = Date.now();
    this._persistWorkingMemory('goal', goal);
    return this;
  }

  /**
   * Set active file being worked on
   * @param {string|null} filePath - File path relative to project root
   */
  setActiveFile(filePath) {
    this.#projectWorkingMemory.activeFile = filePath;
    this.#updatedAt = Date.now();
    this._persistWorkingMemory('activeFile', filePath);
    return this;
  }

  /**
   * Set last generated artifact
   * @param {string|null} artifactId - Artifact ID
   */
  setLastArtifact(artifactId) {
    this.#projectWorkingMemory.lastArtifactId = artifactId;
    this.#updatedAt = Date.now();
    this._persistWorkingMemory('lastArtifactId', artifactId);
    return this;
  }

  /**
   * Clear project working memory (called when project changes)
   */
  clearProjectWorkingMemory() {
    this.#projectWorkingMemory = {
      goal: null,
      activeFile: null,
      lastArtifactId: null,
      driftCount: 0, // v44.5
    };
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v44.5 - Increment drift count (called when user drifts from goal)
   * @returns {number} New drift count
   */
  incrementDriftCount() {
    this.#projectWorkingMemory.driftCount = (this.#projectWorkingMemory.driftCount || 0) + 1;
    this.#updatedAt = Date.now();
    return this.#projectWorkingMemory.driftCount;
  }

  /**
   * v44.5 - Reset drift count (called when user returns to goal or confirms drift)
   */
  resetDriftCount() {
    this.#projectWorkingMemory.driftCount = 0;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v44.5 - Check if drift should be blocked (2nd+ drift)
   */
  shouldBlockDrift() {
    return (this.#projectWorkingMemory.driftCount || 0) >= 1;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v44.2 - Conversation State Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Record a decision and update conversation state
   * Called after CRE makes a decision
   */
  recordDecision(decision, userInput) {
    this.#lastIntent = decision.intent;
    this.#lastDecision = decision.toJSON ? decision.toJSON() : decision;
    this.#lastUserInput = userInput;
    this.#updatedAt = Date.now();

    // If ASK_USER, mark as awaiting clarification
    if (decision.type === 'ASK_USER') {
      this.#pendingDecision = this.#lastDecision;
      this.#awaitingClarification = true;
      this.#awaitingSlots = decision.slots || [];
    } else {
      // Clear pending state on non-ASK_USER decisions
      this.#pendingDecision = null;
      this.#awaitingClarification = false;
      this.#awaitingSlots = [];
    }

    return this;
  }

  /**
   * Set pending decision (for ASK_USER flow)
   */
  setPendingDecision(decision, slots = []) {
    this.#pendingDecision = decision.toJSON ? decision.toJSON() : decision;
    this.#awaitingClarification = true;
    this.#awaitingSlots = slots;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Clear pending decision (after clarification received)
   */
  clearPendingDecision() {
    this.#pendingDecision = null;
    this.#awaitingClarification = false;
    this.#awaitingSlots = [];
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Check if we're waiting for a specific type of clarification
   */
  isAwaitingSlot(slotName) {
    return this.#awaitingSlots.includes(slotName);
  }

  /**
   * Get the original intent that triggered ASK_USER
   * Used for resuming after clarification
   */
  getPendingIntent() {
    return this.#pendingDecision?.intent || this.#lastIntent;
  }

  /**
   * Serialize to JSON for storage
   */
  toJSON() {
    return {
      sessionId: this.#sessionId,
      project: this.#project,
      expertise: this.#expertise,
      expertiseLocked: this.#expertiseLocked, // v44.3
      preferences: this.#preferences,
      updatedAt: this.#updatedAt,
      // v44.2 - Conversation state
      lastIntent: this.#lastIntent,
      lastDecision: this.#lastDecision,
      pendingDecision: this.#pendingDecision,
      awaitingClarification: this.#awaitingClarification,
      awaitingSlots: this.#awaitingSlots,
      lastUserInput: this.#lastUserInput,
      // v44.2+ - Project working memory
      projectWorkingMemory: this.#projectWorkingMemory,
      // v58.0 - DESIGN project state
      activeDesignProject: this.#activeDesignProject,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v59.0 - Persistence Methods (DB via ConversationStore — replaces localStorage)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save session state to persistent storage (DB via ConversationStore).
   * v59.0: Replaced localStorage (browser-only) with DB persistence.
   */
  saveToStorage() {
    try {
      const store = getConversationStore();
      return store.saveSessionState(this.#sessionId, JSON.stringify(this.toJSON()));
    } catch (err) {
      logger.debug('SessionState', `saveToStorage failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Load session state from persistent storage.
   * v59.0: DB-backed, survives server restart.
   * @param {string} sessionId
   * @returns {SessionState|null}
   */
  static loadFromStorage(sessionId) {
    try {
      const store = getConversationStore();
      const json = store.loadSessionState(sessionId);
      if (!json) return null;
      return SessionState.fromJSON(JSON.parse(json));
    } catch (err) {
      logger.debug('SessionState', `loadFromStorage failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Clear session state from persistent storage.
   */
  clearFromStorage() {
    try {
      const store = getConversationStore();
      return store.deleteSessionState(this.#sessionId);
    } catch (err) {
      return false;
    }
  }

  /**
   * Create from JSON
   * v44.2+ - Now restores project working memory
   * v44.3 - Now restores expertLocked
   */
  static fromJSON(json) {
    const state = new SessionState(json.sessionId);
    if (json.project) state.setProject(json.project);
    // v44.3 - Restore expertise with locked state (backward compat: fallback to old keys)
    // v87: Auto-selected expertise is NOT restored — will be re-evaluated from input
    const expertiseData = json.expertise ?? json.expert ?? null;
    if (expertiseData && expertiseData._source !== 'auto') {
      state.setExpertise(expertiseData, { locked: json.expertiseLocked ?? json.expertLocked ?? true, force: true });
    }
    if (json.preferences) {
      for (const [key, value] of Object.entries(json.preferences)) {
        state.setPreference(key, value);
      }
    }
    // v44.2 - Restore conversation state
    if (json.pendingDecision) {
      state.setPendingDecision(json.pendingDecision, json.awaitingSlots || []);
    }
    // v44.2+ - Restore project working memory (AFTER project is set)
    if (json.projectWorkingMemory) {
      if (json.projectWorkingMemory.goal) {
        state.setProjectGoal(json.projectWorkingMemory.goal);
      }
      if (json.projectWorkingMemory.activeFile) {
        state.setActiveFile(json.projectWorkingMemory.activeFile);
      }
      if (json.projectWorkingMemory.lastArtifactId) {
        state.setLastArtifact(json.projectWorkingMemory.lastArtifactId);
      }
    }
    // v58.0 - Restore active design project
    if (json.activeDesignProject) {
      state.setActiveDesignProject(json.activeDesignProject);
    }
    return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Manager (Singleton)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session lifecycle configuration
 * v55.1 - Added session lifecycle management
 */
const SESSION_CONFIG = {
  maxAge: 24 * 60 * 60 * 1000,      // 24 hours - max session lifetime
  idleTimeout: 30 * 60 * 1000,      // 30 minutes - expire after inactivity
  maxSessions: 1000,                 // Maximum concurrent sessions
  maxTurnsPerSession: 100,           // Maximum conversation turns per session
  cleanupInterval: 5 * 60 * 1000,    // 5 minutes - cleanup check interval
};

/**
 * Global session manager for ChatController instances
 * v44.1 - Now includes persistent SessionState
 * v44.3 - Now supports localStorage persistence
 * v55.1 - Added session lifecycle management (expiration, limits, cleanup)
 */
class ChatSessionManager {
  #sessions = new Map();       // sessionId → ChatController
  #states = new Map();         // sessionId → SessionState
  #lastActivity = new Map();   // sessionId → timestamp (v55.1)
  #createdAt = new Map();      // sessionId → timestamp (v55.1)
  #config = {};
  #handlers = {};
  #cleanupTimer = null;        // v55.1

  constructor() {
    // v55.1 - Start cleanup timer
    this.#startCleanupTimer();
  }

  /**
   * Configure global handlers for all sessions
   */
  configure({ handlers = {}, config = {} }) {
    this.#handlers = handlers;
    this.#config = { ...SESSION_CONFIG, ...config };
  }

  /**
   * v55.1 - Start periodic cleanup of expired sessions
   */
  #startCleanupTimer() {
    if (this.#cleanupTimer) return;
    
    this.#cleanupTimer = setInterval(() => {
      this.#cleanupExpiredSessions();
    }, this.#config.cleanupInterval);

    // Don't prevent process exit
    if (this.#cleanupTimer.unref) {
      this.#cleanupTimer.unref();
    }

    logger.debug('SessionManager', 'Cleanup timer started', {
      interval: this.#config.cleanupInterval
    });
  }

  /**
   * v55.1 - Stop cleanup timer (for graceful shutdown)
   */
  stopCleanup() {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
      logger.debug('SessionManager', 'Cleanup timer stopped');
    }
  }

  /**
   * v55.1 - Clean up expired sessions
   */
  #cleanupExpiredSessions() {
    const now = Date.now();
    let expiredCount = 0;
    let idleCount = 0;
    let ageCount = 0;

    for (const [sessionId, lastActive] of this.#lastActivity) {
      const createdAt = this.#createdAt.get(sessionId) || lastActive;
      const idleTime = now - lastActive;
      const age = now - createdAt;

      // Check idle timeout
      if (idleTime > this.#config.idleTimeout) {
        logger.debug('SessionManager', `Expiring idle session: ${sessionId}`, {
          idleMinutes: Math.round(idleTime / 60000)
        });
        this.removeSession(sessionId);
        expiredCount++;
        idleCount++;
        continue;
      }

      // Check max age
      if (age > this.#config.maxAge) {
        logger.debug('SessionManager', `Expiring old session: ${sessionId}`, {
          ageHours: Math.round(age / 3600000)
        });
        this.removeSession(sessionId);
        expiredCount++;
        ageCount++;
      }
    }

    // v55.1 - LRU eviction if still over limit
    if (this.#sessions.size > this.#config.maxSessions) {
      const toEvict = this.#sessions.size - this.#config.maxSessions;
      const sorted = [...this.#lastActivity.entries()]
        .sort((a, b) => a[1] - b[1]); // Oldest first
      
      for (let i = 0; i < toEvict && i < sorted.length; i++) {
        const [sessionId] = sorted[i];
        logger.debug('SessionManager', `LRU evicting session: ${sessionId}`);
        this.removeSession(sessionId);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.info('SessionManager', `Cleanup completed`, {
        expired: expiredCount,
        idle: idleCount,
        aged: ageCount,
        remaining: this.#sessions.size
      });
    }
  }

  /**
   * v55.1 - Touch session (update last activity)
   */
  #touchSession(sessionId) {
    this.#lastActivity.set(sessionId, Date.now());
  }

  /**
   * Get or create a session controller
   * v55.1 - Now tracks activity and enforces limits
   */
  getSession(sessionId) {
    // Touch existing session
    if (this.#sessions.has(sessionId)) {
      this.#touchSession(sessionId);
      return this.#sessions.get(sessionId);
    }

    // v55.1 - Check session limit before creating new
    if (this.#sessions.size >= this.#config.maxSessions) {
      logger.warn('SessionManager', 'Session limit reached, triggering cleanup');
      this.#cleanupExpiredSessions();

      // If still at limit, evict oldest
      if (this.#sessions.size >= this.#config.maxSessions) {
        const oldest = [...this.#lastActivity.entries()]
          .sort((a, b) => a[1] - b[1])[0];
        if (oldest) {
          logger.warn('SessionManager', `Force evicting oldest session: ${oldest[0]}`);
          this.removeSession(oldest[0]);
        }
      }
    }

    // Create new session
    const controller = new ChatController({
      sessionId,
      handlers: this.#handlers,
      config: this.#config,
    });
    
    const now = Date.now();
    this.#sessions.set(sessionId, controller);
    this.#lastActivity.set(sessionId, now);
    this.#createdAt.set(sessionId, now);
    
    logger.debug('SessionManager', `Created session: ${sessionId}`, {
      totalSessions: this.#sessions.size
    });
    
    return controller;
  }

  /**
   * Get or create session state
   * v44.3 - Now tries to restore from localStorage first
   * v55.1 - Now touches session activity
   * This is THE persistent state for project/expert context
   */
  getState(sessionId) {
    this.#touchSession(sessionId);
    
    if (!this.#states.has(sessionId)) {
      // v44.3 - Try to restore from localStorage first
      const restored = SessionState.loadFromStorage(sessionId);
      if (restored) {
        this.#states.set(sessionId, restored);
      } else {
        this.#states.set(sessionId, new SessionState(sessionId));
      }
    }
    return this.#states.get(sessionId);
  }

  /**
   * v44.3 - Save session state to localStorage
   */
  saveState(sessionId) {
    const state = this.#states.get(sessionId);
    if (state) {
      state.saveToStorage();
    }
  }

  /**
   * Set project for a session
   * v44.3 - Now auto-saves to localStorage
   */
  setProject(sessionId, project) {
    const state = this.getState(sessionId);
    state.setProject(project);
    // v44.3 - Auto-save to localStorage
    state.saveToStorage();
    return state;
  }

  /**
   * Set expertise for a session
   * v44.3 - Now auto-saves to localStorage
   */
  setExpertise(sessionId, expertise, options = {}) {
    const state = this.getState(sessionId);
    state.setExpertise(expertise, options);
    // v44.3 - Auto-save to localStorage
    state.saveToStorage();
    return state;
  }

  /**
   * Remove a session
   * v55.1 - Now cleans up all tracking maps
   */
  removeSession(sessionId) {
    // Clean up localStorage if state exists
    const state = this.#states.get(sessionId);
    if (state) {
      state.clearFromStorage();
    }
    
    this.#sessions.delete(sessionId);
    this.#states.delete(sessionId);
    this.#lastActivity.delete(sessionId);
    this.#createdAt.delete(sessionId);
    
    logger.debug('SessionManager', `Removed session: ${sessionId}`, {
      remainingSessions: this.#sessions.size
    });
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.#sessions.keys());
  }

  /**
   * Get session state for debugging/API
   * v55.1 - Now includes lifecycle info
   */
  getSessionInfo(sessionId) {
    const controller = this.#sessions.get(sessionId);
    const state = this.#states.get(sessionId);
    const lastActivity = this.#lastActivity.get(sessionId);
    const createdAt = this.#createdAt.get(sessionId);
    const now = Date.now();
    
    return {
      exists: !!controller,
      mode: controller?.currentMode || null,
      state: state?.toJSON() || null,
      // v55.1 - Lifecycle info
      lifecycle: controller ? {
        createdAt: createdAt ? new Date(createdAt).toISOString() : null,
        lastActivity: lastActivity ? new Date(lastActivity).toISOString() : null,
        idleMs: lastActivity ? now - lastActivity : null,
        ageMs: createdAt ? now - createdAt : null,
        expiresIn: lastActivity ? Math.max(0, this.#config.idleTimeout - (now - lastActivity)) : null,
      } : null,
    };
  }

  /**
   * v55.1 - Get session manager statistics
   */
  getStats() {
    const now = Date.now();
    let oldestActivity = Infinity;
    let newestActivity = 0;
    
    for (const [, timestamp] of this.#lastActivity) {
      if (timestamp < oldestActivity) oldestActivity = timestamp;
      if (timestamp > newestActivity) newestActivity = timestamp;
    }
    
    return {
      totalSessions: this.#sessions.size,
      maxSessions: this.#config.maxSessions,
      idleTimeoutMs: this.#config.idleTimeout,
      maxAgeMs: this.#config.maxAge,
      oldestActivityAge: oldestActivity !== Infinity ? now - oldestActivity : null,
      newestActivityAge: newestActivity !== 0 ? now - newestActivity : null,
    };
  }
}

// Global session manager instance
const sessionManager = new ChatSessionManager();

/**
 * Static entry point for HTTP requests
 *
 * This is THE ONLY way external code should interact with ChatController.
 * All intent detection, mode routing, and response generation happens here.
 *
 * v44.1 - Now uses persistent SessionState for project/expert context
 *
 * @param {Object} request
 * @param {string} request.message - User message
 * @param {string} request.sessionId - Session ID
 * @param {string} [request.userId] - User ID
 * @param {Object} [request.project] - Project to set/use { id, name, ... }
 * @param {Object} [request.expertise] - Expertise to set/use { id, name, ... }
 * @param {Object} [request.context] - Additional context
 * @returns {Promise<{response: string, mode: string, confidence: number, metadata: Object}>}
 */
ChatController.handle = async function(request) {
  let { message, sessionId, userId, project, expertise, signal, context = {} } = request;

  // v82: Enrich message with file attachment content from IDE
  // Supports both inline content (FileReader) and path-based reading (Electron contextIsolation)
  if (request.attachments && request.attachments.length > 0) {
    logger.info('ChatController', `Processing ${request.attachments.length} attachment(s)`, {
      attachments: request.attachments.map(a => ({ name: a.name, size: a.size, hasContent: !!a.content, hasPath: !!a.path, path: a.path || null }))
    });
    for (const a of request.attachments) {
      if (!a.content && a.path) {
        try {
          a.content = fs.readFileSync(a.path, 'utf-8');
          logger.info('ChatController', `Read attachment from path: ${a.path} (${a.content.length} chars)`);
        } catch (e) {
          logger.warn('ChatController', `Failed to read attachment: ${a.path}`, { error: e.message });
          a.content = `[Soubor nelze přečíst: ${e.message}]`;
        }
      }
    }
    const attachmentBlocks = request.attachments
      .filter(a => a.content)
      .map(a => `\n--- Příloha: ${a.name} (${a.size}) ---\n${a.content}\n---`);
    if (attachmentBlocks.length > 0) {
      message = message + attachmentBlocks.join('');
      logger.info('ChatController', `Appended ${attachmentBlocks.length} attachment block(s) to message`);
    } else {
      logger.warn('ChatController', 'No attachment content available after processing');
    }
  }

  if (!message) {
    return {
      response: 'No message provided',
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      metadata: { error: true },
    };
  }

  if (!sessionId) {
    return {
      response: 'No session ID provided',
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      metadata: { error: true },
    };
  }

  // Get controller and state for this session
  const controller = sessionManager.getSession(sessionId);
  const state = sessionManager.getState(sessionId);

  // ════════════════════════════════════════════════════════════════════════════
  // v56.0 Sprint 3: CONVERSATION STORE — DB is the single source of truth
  // v66.0: Use IDE's stable conversationId for DB key (not ephemeral WS sessionId)
  // ════════════════════════════════════════════════════════════════════════════
  const store = getConversationStore();
  const dbConversationId = request.conversationId || sessionId;
  store.ensureConversation(dbConversationId, {
    projectId: context.projectId || null,
  });

  // INVARIANT: Persist user turn BEFORE processing
  store.appendTurn(dbConversationId, TurnRole.USER, message, {
    timestamp: Date.now(),
  });

  // Load history from DB (NOT from RAM)
  const dbHistory = store.buildHandlerHistory(dbConversationId, 10);

  // v86: Build LTM context from persistent singleton (read-only, never affects routing)
  let ltmContext = '';
  try {
    if (longTermMemory.initialized) {
      ltmContext = getLTMContextForSynthesis(longTermMemory);
    }
  } catch (err) {
    logger.warn('ChatController', `LTM context extraction failed: ${err.message}`);
  }

  // v67.0: Build Memory Bank context (project-scoped persistent memory)
  let memoryBankContext = '';
  try {
    const projectId = context.projectId || state.project?.id;
    if (projectId) {
      const bank = getMemoryBank(db);
      if (bank) {
        memoryBankContext = bank.buildContext(projectId);
      }
    }
  } catch (err) {
    logger.warn('ChatController', `Memory Bank context failed: ${err.message}`);
  }

  // v67.0: Context Init — hierarchical scan on first project turn
  let contextInitBlock = '';
  try {
    const projectId = context.projectId || state.project?.id;
    if (projectId && state.project?.path) {
      const bank = getMemoryBank();
      contextInitBlock = maybeInitContext(dbConversationId, state.project, bank);
    }
  } catch (err) {
    logger.warn('ChatController', `Context Init failed: ${err.message}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // UPDATE SESSION STATE (v44.1 - persistent project/expert)
  // ════════════════════════════════════════════════════════════════════════════

  // If project provided in request, update state
  if (project !== undefined) {
    if (project === null) {
      state.clearProject();
    } else if (project.id) {
      state.setProject(project);
    }
  }

  // v65.4: Sync project from IDE — always update when projectId changes
  const incomingProjectId = request.projectId || context.projectId;
  if (incomingProjectId) {
    const pid = Number(incomingProjectId);
    if (state.project?.id !== pid) {
      try {
        const proj = db.projects.findById.get(pid);
        if (proj) {
          state.setProject({ id: proj.id, name: proj.name, path: proj.path, description: proj.description || '' });
        }
      } catch (err) {
        logger.warn('ChatController', `Project lookup failed: ${err.message}`);
      }
    }
  }

  // v88: Restore working memory from DB if project is active and WM is empty
  if (state.hasActiveProject && !state.projectGoal) {
    try {
      const wmRows = db.projectMemory.listByCategory.all(state.project.id, 'working_memory');
      if (wmRows && wmRows.length > 0) {
        for (const row of wmRows) {
          const field = row.key.replace('wm:', '');
          if (field === 'goal' && row.value) state.setProjectGoal(row.value);
          else if (field === 'activeFile' && row.value) state.setActiveFile(row.value);
          else if (field === 'lastArtifactId' && row.value) state.setLastArtifact(row.value);
        }
      }
    } catch { /* non-fatal */ }
  }

  // v87: Clear auto-selected expertise for re-evaluation each turn.
  // Auto-selection is per-turn, not sticky — recalculated from current input.
  if (state.expertise?._source === 'auto') {
    state.clearExpertise();
  }

  // If expertise provided in request, update state
  if (expertise !== undefined) {
    if (expertise === null) {
      state.clearExpertise();
    } else if (expertise.id) {
      state.setExpertise(expertise);
    }
  }

  // v87: Auto-select expertise when none is manually active.
  // Deterministic vocabulary matching — no LLM call, <1ms.
  if (!state.hasActiveExpertise) {
    try {
      const { autoSelectExpertise } = await import('../expertises/auto-select.js');
      const autoResult = autoSelectExpertise(message, {
        previousAutoExpertiseId: state.preferences._lastAutoExpertiseId || null,
      });
      if (autoResult.expertiseId) {
        const { BUILTIN_EXPERTISES: _EXPERTISES } = await import('../expertises/expertise-layer.js');
        const exp = _EXPERTISES[autoResult.expertiseId];
        if (exp) {
          state.setExpertise(
            { id: exp.id, name: exp.name, domain: exp.domain, _source: 'auto', _confidence: autoResult.confidence },
            { locked: false },
          );
          state.setPreference('_lastAutoExpertiseId', exp.id);
          logger.info('AutoExpertise', `Auto-selected: ${exp.name} (${autoResult.confidence.toFixed(2)})`, {
            input: message.substring(0, 60),
            reason: autoResult.reason,
          });
        }
      } else {
        state.setPreference('_lastAutoExpertiseId', null);
      }

      // Metrics logging (never throws)
      try {
        db.db.prepare(`
          INSERT INTO auto_expertise_log (session_id, input_preview, selected_id, confidence, scores_json, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          sessionId,
          message.substring(0, 100),
          autoResult.expertiseId || null,
          autoResult.confidence,
          JSON.stringify(autoResult.scores),
          autoResult.reason,
          Date.now(),
        );
      } catch (_) { /* metrics never throw */ }
    } catch (err) {
      logger.warn('AutoExpertise', `Auto-select failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BUILD CONTEXT WITH PERSISTENT STATE
  // ════════════════════════════════════════════════════════════════════════════

  const fullContext = {
    ...context,
    userId,
    // Persistent state from session (survives across requests)
    project: state.project,
    expertise: state.expertise,
    // v44.3 - Expertise lock info for CRE
    expertiseLocked: state.expertiseLocked,
    canChangeExpertise: state.canChangeExpertise(),
    // Convenience flags for handlers
    hasActiveProject: state.hasActiveProject,
    hasActiveExpertise: state.hasActiveExpertise,
    // v44.2 - Pass actual SessionState instance (not JSON) so handlers can call methods
    sessionState: state,
    // JSON version for debugging only
    sessionStateJSON: state.toJSON(),
    // v44.2+ - Project working memory for context
    projectWorkingMemory: state.projectWorkingMemory,
    projectGoal: state.projectGoal,
    activeFile: state.activeFile,
    lastArtifactId: state.lastArtifactId,
    // v61.2: Pass lastTurnTopic for continuation query enrichment
    // When user sends a meta follow-up ("dej mi ten report"), enrichSearchQuery
    // needs the previous query to avoid searching for the raw follow-up text.
    lastTurnTopic: state.lastUserInput || null,
    // v56.0 Sprint 3 — DB-backed history replaces RAM
    dbHistory,
    // v86 — LTM context for synthesis (now populated from persistent singleton)
    ltmContext,
    // v86 — LTM singleton reference for reinforcement + writes
    ltm: longTermMemory.initialized ? longTermMemory : null,
    // v86 — Budget-aware context builder (call after CRE decides intent)
    buildBudgetedContext: (intent) => buildBudgetedContext(dbConversationId, intent, {
      store,
      ltmContext,
      summarizer: null, // TODO: wire LLM summarizer for on-demand summary
    }),
    // v67.0 — Memory Bank context for synthesis
    memoryBankContext,
    // v67.0 — Context Init block (first turn only)
    contextInitBlock,
    // v56.0 Sprint 3 — ConversationStore reference
    conversationStore: store,
    // v63.0: AbortSignal for cancel propagation (from server req.on('close'))
    signal: signal || null,
    // v82.1: Inline attachments for FILE handlers (avoids disk read for attached content)
    attachments: request.attachments || [],
  };

  // v63.0: Check if client already disconnected before processing
  if (signal?.aborted) {
    logger.info('ChatController', 'Client disconnected before processing started');
    return {
      response: '',
      mode: ChatMode.CONVERSATION,
      confidence: 0,
      metadata: { cancelled: true },
    };
  }

  // Process the message with full context
  const result = await controller.process(message, fullContext);

  // ════════════════════════════════════════════════════════════════════════════
  // v56.0 Sprint 3: PERSIST assistant turn to DB (after processing)
  // INVARIANT: Turn is persisted before response is returned to caller
  // ════════════════════════════════════════════════════════════════════════════
  try {
    store.appendTurn(dbConversationId, TurnRole.ASSISTANT, result.content, {
      mode: result.mode,
      confidence: result.confidence,
      model: result.tag?.metadata?.model,
      intent: result.tag?.metadata?.decision?.intent,
    });
  } catch (err) {
    logger.error('ChatController', `Failed to persist assistant turn: ${err.message}`);
    // Continue — response is still valid even if persistence fails
  }

  // v67.0: Auto-Compact — fire background context compression if threshold exceeded
  try {
    maybeCompact(dbConversationId, store, sessionId);
  } catch (err) {
    logger.warn('ChatController', `Auto-compact trigger failed: ${err.message}`);
  }

  // Auto-title conversation from first user message
  try {
    const conv = store.getConversation(dbConversationId);
    if (conv && !conv.title && store.getTurnCount(dbConversationId) <= 3) {
      store.setTitle(dbConversationId, message.substring(0, 60));
    }
  } catch {
    // Non-critical — ignore
  }

  // v44.3 - Save session state after processing (auto-persist)
  state.saveToStorage();

  // Return structured response with state info
  return {
    response: result.content,
    mode: result.mode,
    confidence: result.confidence,
    canExecute: result.canExecute,
    metadata: result.tag.metadata,
    // v66.0: Return the DB conversation ID so WS bridge can echo it to IDE
    conversationId: dbConversationId,
    // Include current state in response so UI can stay in sync
    state: {
      project: state.project,
      expertise: state.expertise,
      expertiseLocked: state.expertiseLocked, // v44.3
      expertiseSource: state.expertise?._source || (state.expertise ? 'manual' : null), // v87
      // v44.2+ - Include working memory
      workingMemory: state.projectWorkingMemory,
    },
  };
};

/**
 * Configure global ChatController settings
 * Call this at server startup to register handlers
 */
ChatController.configure = function(options) {
  sessionManager.configure(options);
};

/**
 * Get session manager (for advanced use)
 */
ChatController.getSessionManager = function() {
  return sessionManager;
};

/**
 * Set project for a session (v44.1)
 * @param {string} sessionId
 * @param {Object|null} project - { id, name, path?, scope? }
 */
ChatController.setProject = function(sessionId, project) {
  return sessionManager.setProject(sessionId, project);
};

/**
 * Set expertise for a session (v44.1)
 * v44.3 - Now supports locked option
 * @param {string} sessionId
 * @param {Object|null} expertise - { id, name, domain? }
 * @param {Object} [options] - { locked?: boolean, force?: boolean }
 */
ChatController.setExpertise = function(sessionId, expertise, options = {}) {
  return sessionManager.setExpertise(sessionId, expertise, options);
};

/**
 * Get session state (v44.1)
 * @param {string} sessionId
 * @returns {SessionState}
 */
ChatController.getState = function(sessionId) {
  return sessionManager.getState(sessionId);
};

/**
 * Get session info for debugging (v44.1)
 * @param {string} sessionId
 */
ChatController.getSessionInfo = function(sessionId) {
  return sessionManager.getSessionInfo(sessionId);
};

/**
 * v55.1 - Get all active session IDs
 * @returns {string[]}
 */
ChatController.getActiveSessions = function() {
  return sessionManager.getActiveSessions();
};

/**
 * v55.1 - Get session manager statistics
 * @returns {Object}
 */
ChatController.getStats = function() {
  return sessionManager.getStats();
};

/**
 * v55.1 - Remove a session
 * @param {string} sessionId
 */
ChatController.removeSession = function(sessionId) {
  return sessionManager.removeSession(sessionId);
};

/**
 * v55.1 - Stop session cleanup (for graceful shutdown)
 */
ChatController.stopCleanup = function() {
  return sessionManager.stopCleanup();
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a ChatController instance
 */
export function createChatController(sessionId, options = {}) {
  return new ChatController({ sessionId, ...options });
}

/**
 * Create a ResponseTag
 */
export function createResponseTag(options) {
  return new ResponseTag(options);
}

/**
 * Create a TaggedResponse
 */
export function createTaggedResponse(content, tagOptions, actions = []) {
  const tag = new ResponseTag(tagOptions);
  return new TaggedResponse({ content, tag, actions });
}
