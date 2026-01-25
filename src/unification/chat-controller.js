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
  /** Domain expert consultation */
  EXPERT: 'expert',
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
  /** Domain expert */
  EXPERT: 'expert',
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
  #expertRegistry;

  constructor({ projectContext = null, expertRegistry = null } = {}) {
    this.#projectContext = projectContext;
    this.#expertRegistry = expertRegistry;
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
        /\b(explain|why|how does|what is|analyze|review)\b/i,
        /\b(best practice|recommend|suggest|opinion)\b/i,
        /\b(as an? (expert|specialist|architect))\b/i,
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
      [ChatMode.EXPERT]: 0,
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

    if (context.requestedExpert) {
      scores[ChatMode.EXPERT] += 3;
      signals.push({ type: 'explicit', mode: ChatMode.EXPERT, expert: context.requestedExpert });
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
    const finalMode = totalScore === 0 ? ChatMode.CONVERSATION : detectedMode;
    const finalConfidence = totalScore === 0 ? 0.8 : Math.min(confidence + 0.2, 1);

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
    // Detect mode
    let targetMode = this.#currentMode;
    let detection = null;
    let pendingConfirmation = null;

    if (this.#config.autoModeDetection) {
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

    // Handle explicit mode switch (user confirmed)
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

    // Transition mode if needed
    if (targetMode !== this.#currentMode) {
      this.#transitionMode(targetMode, detection?.reason || 'auto');
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
        history: this.#responseHistory.slice(-10),
      });

      // Ensure response is properly tagged
      const taggedResponse = this.#ensureTagged(response, targetMode, pendingConfirmation);

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

  #transitionMode(newMode, reason) {
    const transition = {
      from: this.#currentMode,
      to: newMode,
      reason,
      timestamp: Date.now(),
    };
    this.#modeTransitions.push(transition);
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
// Session Manager (Singleton)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global session manager for ChatController instances
 */
class ChatSessionManager {
  #sessions = new Map();
  #config = {};
  #handlers = {};

  /**
   * Configure global handlers for all sessions
   */
  configure({ handlers = {}, config = {} }) {
    this.#handlers = handlers;
    this.#config = config;
  }

  /**
   * Get or create a session
   */
  getSession(sessionId) {
    if (!this.#sessions.has(sessionId)) {
      const controller = new ChatController({
        sessionId,
        handlers: this.#handlers,
        config: this.#config,
      });
      this.#sessions.set(sessionId, controller);
    }
    return this.#sessions.get(sessionId);
  }

  /**
   * Remove a session
   */
  removeSession(sessionId) {
    this.#sessions.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.#sessions.keys());
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
 * @param {Object} request
 * @param {string} request.message - User message
 * @param {string} request.sessionId - Session ID
 * @param {string} [request.userId] - User ID
 * @param {Object} [request.context] - Additional context
 * @returns {Promise<{response: string, mode: string, confidence: number, metadata: Object}>}
 */
ChatController.handle = async function(request) {
  const { message, sessionId, userId, context = {} } = request;

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

  // Get controller for this session
  const controller = sessionManager.getSession(sessionId);

  // Process the message
  const result = await controller.process(message, {
    ...context,
    userId,
  });

  // Return structured response
  return {
    response: result.content,
    mode: result.mode,
    confidence: result.confidence,
    canExecute: result.canExecute,
    metadata: result.tag.metadata,
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
