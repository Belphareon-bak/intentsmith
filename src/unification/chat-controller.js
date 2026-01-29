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

    // Expert mode is sticky when expert is active
    if (context.hasActiveExpert && context.expert?.id) {
      return ChatMode.EXPERT;
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
  #sessionId;
  #project;      // Active project { id, name, path, scope }
  #expert;       // Active expert { id, name, domain }
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

  // v44.3 - Expert lock (CRE cannot override when locked)
  #expertLocked;         // When true, CRE cannot auto-change expert

  constructor(sessionId) {
    this.#sessionId = sessionId;
    this.#project = null;
    this.#expert = null;
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

    // v44.3 - Expert is not locked by default
    this.#expertLocked = false;
  }

  get sessionId() { return this.#sessionId; }
  get project() { return this.#project; }
  get expert() { return this.#expert; }
  get preferences() { return { ...this.#preferences }; }
  get hasActiveProject() { return this.#project !== null && this.#project.id !== null; }
  get hasActiveExpert() { return this.#expert !== null && this.#expert.id !== null; }
  // v44.3 - Expert lock state
  get expertLocked() { return this.#expertLocked; }

  // v44.2 - Conversation state getters
  get lastIntent() { return this.#lastIntent; }
  get lastDecision() { return this.#lastDecision; }
  get pendingDecision() { return this.#pendingDecision; }
  get awaitingClarification() { return this.#awaitingClarification; }
  get awaitingSlots() { return [...this.#awaitingSlots]; }
  get lastUserInput() { return this.#lastUserInput; }

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
   * Set active expert
   * v44.3 - Now supports locking (CRE cannot override when locked)
   *
   * @param {Object|null} expert - { id, name, domain? }
   * @param {Object} options - { locked?: boolean, force?: boolean }
   */
  setExpert(expert, options = {}) {
    const { locked = true, force = false } = options;

    // v44.3 - Check if expert is locked and this isn't a forced change
    if (this.#expertLocked && !force && expert?.id !== this.#expert?.id) {
      // Expert is locked, cannot change without force
      return this;
    }

    if (expert && !expert.id) {
      throw new Error('Expert must have an id');
    }
    this.#expert = expert ? { ...expert } : null;

    // v44.3 - Lock expert when explicitly set by user (default)
    // Unlock when expert is cleared
    this.#expertLocked = expert ? locked : false;

    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v44.3 - Lock the current expert (prevent CRE from changing)
   */
  lockExpert() {
    if (this.#expert) {
      this.#expertLocked = true;
      this.#updatedAt = Date.now();
    }
    return this;
  }

  /**
   * v44.3 - Unlock the expert (allow CRE to change)
   */
  unlockExpert() {
    this.#expertLocked = false;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * v44.3 - Check if expert can be changed (for CRE)
   * Returns true if expert is not set or not locked
   */
  canChangeExpert() {
    return !this.#expert || !this.#expertLocked;
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
   * Clear expert
   * v44.3 - Also clears the lock
   */
  clearExpert() {
    this.#expert = null;
    this.#expertLocked = false;
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
   * Set current project goal
   * @param {string|null} goal - Current task/objective
   */
  setProjectGoal(goal) {
    this.#projectWorkingMemory.goal = goal;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Set active file being worked on
   * @param {string|null} filePath - File path relative to project root
   */
  setActiveFile(filePath) {
    this.#projectWorkingMemory.activeFile = filePath;
    this.#updatedAt = Date.now();
    return this;
  }

  /**
   * Set last generated artifact
   * @param {string|null} artifactId - Artifact ID
   */
  setLastArtifact(artifactId) {
    this.#projectWorkingMemory.lastArtifactId = artifactId;
    this.#updatedAt = Date.now();
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
      expert: this.#expert,
      expertLocked: this.#expertLocked, // v44.3
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
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // v44.3 - Persistence Methods (localStorage support)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Save session state to localStorage
   * Call this after any state change that should persist
   */
  saveToStorage() {
    if (typeof localStorage === 'undefined') {
      return false; // Not in browser environment
    }
    try {
      const key = `cre_session_${this.#sessionId}`;
      localStorage.setItem(key, JSON.stringify(this.toJSON()));
      return true;
    } catch (err) {
      console.warn('SessionState.saveToStorage failed:', err.message);
      return false;
    }
  }

  /**
   * Load session state from localStorage
   * @param {string} sessionId
   * @returns {SessionState|null}
   */
  static loadFromStorage(sessionId) {
    if (typeof localStorage === 'undefined') {
      return null; // Not in browser environment
    }
    try {
      const key = `cre_session_${sessionId}`;
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      const json = JSON.parse(stored);
      return SessionState.fromJSON(json);
    } catch (err) {
      console.warn('SessionState.loadFromStorage failed:', err.message);
      return null;
    }
  }

  /**
   * Clear session state from localStorage
   */
  clearFromStorage() {
    if (typeof localStorage === 'undefined') {
      return false;
    }
    try {
      const key = `cre_session_${this.#sessionId}`;
      localStorage.removeItem(key);
      return true;
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
    // v44.3 - Restore expert with locked state
    if (json.expert) {
      state.setExpert(json.expert, { locked: json.expertLocked ?? true, force: true });
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
    return state;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Manager (Singleton)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global session manager for ChatController instances
 * v44.1 - Now includes persistent SessionState
 * v44.3 - Now supports localStorage persistence
 */
class ChatSessionManager {
  #sessions = new Map();       // sessionId → ChatController
  #states = new Map();         // sessionId → SessionState
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
   * Get or create a session controller
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
   * Get or create session state
   * v44.3 - Now tries to restore from localStorage first
   * This is THE persistent state for project/expert context
   */
  getState(sessionId) {
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
   * Set expert for a session
   * v44.3 - Now auto-saves to localStorage
   */
  setExpert(sessionId, expert, options = {}) {
    const state = this.getState(sessionId);
    state.setExpert(expert, options);
    // v44.3 - Auto-save to localStorage
    state.saveToStorage();
    return state;
  }

  /**
   * Remove a session
   */
  removeSession(sessionId) {
    this.#sessions.delete(sessionId);
    this.#states.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    return Array.from(this.#sessions.keys());
  }

  /**
   * Get session state for debugging/API
   */
  getSessionInfo(sessionId) {
    const controller = this.#sessions.get(sessionId);
    const state = this.#states.get(sessionId);
    return {
      exists: !!controller,
      mode: controller?.currentMode || null,
      state: state?.toJSON() || null,
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
 * @param {Object} [request.expert] - Expert to set/use { id, name, ... }
 * @param {Object} [request.context] - Additional context
 * @returns {Promise<{response: string, mode: string, confidence: number, metadata: Object}>}
 */
ChatController.handle = async function(request) {
  const { message, sessionId, userId, project, expert, context = {} } = request;

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

  // If expert provided in request, update state
  if (expert !== undefined) {
    if (expert === null) {
      state.clearExpert();
    } else if (expert.id) {
      state.setExpert(expert);
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
    expert: state.expert,
    // v44.3 - Expert lock info for CRE
    expertLocked: state.expertLocked,
    canChangeExpert: state.canChangeExpert(),
    // Convenience flags for handlers
    hasActiveProject: state.hasActiveProject,
    hasActiveExpert: state.hasActiveExpert,
    // v44.2 - Pass actual SessionState instance (not JSON) so handlers can call methods
    sessionState: state,
    // JSON version for debugging only
    sessionStateJSON: state.toJSON(),
    // v44.2+ - Project working memory for context
    projectWorkingMemory: state.projectWorkingMemory,
    projectGoal: state.projectGoal,
    activeFile: state.activeFile,
    lastArtifactId: state.lastArtifactId,
  };

  // Process the message with full context
  const result = await controller.process(message, fullContext);

  // v44.3 - Save state after processing (auto-persist)
  state.saveToStorage();

  // Return structured response with state info
  return {
    response: result.content,
    mode: result.mode,
    confidence: result.confidence,
    canExecute: result.canExecute,
    metadata: result.tag.metadata,
    // Include current state in response so UI can stay in sync
    state: {
      project: state.project,
      expert: state.expert,
      expertLocked: state.expertLocked, // v44.3
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
 * Set expert for a session (v44.1)
 * v44.3 - Now supports locked option
 * @param {string} sessionId
 * @param {Object|null} expert - { id, name, domain? }
 * @param {Object} [options] - { locked?: boolean, force?: boolean }
 */
ChatController.setExpert = function(sessionId, expert, options = {}) {
  return sessionManager.setExpert(sessionId, expert, options);
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
