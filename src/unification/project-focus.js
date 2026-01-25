// CRE v44.1 — FÁZE B: Project Focus Manager
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 9 — SYSTEM UNIFICATION
//
// ProjectFocusManager: Manages project-scoped work with focus locking
// - Explicit focus locking on project/file/module
// - Mode transitions: CHAT ↔ PROJECT ↔ AGENT
// - Prevents context drift during focused work
//
// ══════════════════════════════════════════════════════════════════════════════

import { ChatMode } from './chat-controller.js';

// ─────────────────────────────────────────────────────────────────────────────
// Focus Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Focus scope levels
 * @readonly
 * @enum {string}
 */
export const FocusScope = Object.freeze({
  /** Global - no specific focus */
  GLOBAL: 'global',
  /** Project-level focus */
  PROJECT: 'project',
  /** Directory/module focus */
  MODULE: 'module',
  /** Single file focus */
  FILE: 'file',
  /** Function/class focus */
  SYMBOL: 'symbol',
});

/**
 * Focus lock states
 *
 * IMPORTANT: Lock behavior for external systems:
 * - SOFT: Warns but allows focus change; proactive suggestions OK
 * - HARD: BLOCKS the following until explicitly unlocked:
 *   1. Proactive suggestions (from SuggestionEngine)
 *   2. Unsolicited expert advice
 *   3. Auto mode transitions
 *   4. Focus changes outside current scope
 *
 * @readonly
 * @enum {string}
 */
export const LockState = Object.freeze({
  /** No lock - can freely change focus */
  UNLOCKED: 'unlocked',
  /** Soft lock - warn on focus change, allow proactive suggestions */
  SOFT: 'soft',
  /** Hard lock - block all unsolicited interactions, require explicit unlock */
  HARD: 'hard',
});

/**
 * Mode transition types
 * @readonly
 * @enum {string}
 */
export const TransitionType = Object.freeze({
  /** Explicit user request */
  EXPLICIT: 'explicit',
  /** System-detected transition */
  DETECTED: 'detected',
  /** Timeout-based transition */
  TIMEOUT: 'timeout',
  /** Error recovery transition */
  RECOVERY: 'recovery',
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Focus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a focus target
 */
export class ProjectFocus {
  #scope;
  #path;
  #symbol;
  #metadata;
  #createdAt;

  /**
   * @param {Object} options
   * @param {string} options.scope - FocusScope
   * @param {string} [options.path] - File or directory path
   * @param {string} [options.symbol] - Symbol name (function, class, etc.)
   * @param {Object} [options.metadata] - Additional metadata
   */
  constructor({ scope, path = null, symbol = null, metadata = {} }) {
    if (!Object.values(FocusScope).includes(scope)) {
      throw new Error(`Invalid scope: ${scope}`);
    }

    // Validate required fields based on scope
    if (scope !== FocusScope.GLOBAL && !path) {
      throw new Error(`Path required for scope: ${scope}`);
    }
    if (scope === FocusScope.SYMBOL && !symbol) {
      throw new Error('Symbol name required for SYMBOL scope');
    }

    this.#scope = scope;
    this.#path = path;
    this.#symbol = symbol;
    this.#metadata = Object.freeze({ ...metadata });
    this.#createdAt = Date.now();
    Object.freeze(this);
  }

  get scope() { return this.#scope; }
  get path() { return this.#path; }
  get symbol() { return this.#symbol; }
  get metadata() { return this.#metadata; }
  get createdAt() { return this.#createdAt; }

  /**
   * Check if this focus contains another
   */
  contains(other) {
    if (!(other instanceof ProjectFocus)) return false;
    if (this.#scope === FocusScope.GLOBAL) return true;
    if (!this.#path || !other.path) return false;

    // Check path containment
    const thisPath = this.#path.replace(/\/$/, '');
    const otherPath = other.path.replace(/\/$/, '');

    return otherPath.startsWith(thisPath);
  }

  /**
   * Check if this focus is related to a file path
   */
  isRelatedTo(filePath) {
    if (this.#scope === FocusScope.GLOBAL) return true;
    if (!this.#path) return false;

    const normalizedPath = this.#path.replace(/\/$/, '');
    const normalizedFile = filePath.replace(/\/$/, '');

    switch (this.#scope) {
      case FocusScope.PROJECT:
      case FocusScope.MODULE:
        return normalizedFile.startsWith(normalizedPath);
      case FocusScope.FILE:
      case FocusScope.SYMBOL:
        return normalizedFile === normalizedPath;
      default:
        return false;
    }
  }

  toJSON() {
    return {
      scope: this.#scope,
      path: this.#path,
      symbol: this.#symbol,
      metadata: this.#metadata,
      created_at: this.#createdAt,
    };
  }

  static fromJSON(json) {
    return new ProjectFocus({
      scope: json.scope,
      path: json.path,
      symbol: json.symbol,
      metadata: json.metadata || {},
    });
  }

  /**
   * Create a global (no focus) instance
   */
  static global() {
    return new ProjectFocus({ scope: FocusScope.GLOBAL });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus Lock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Focus lock - prevents unintended focus changes
 */
export class FocusLock {
  #state;
  #focus;
  #reason;
  #lockedAt;
  #expiresAt;

  constructor({ state, focus, reason = '', expiresAt = null }) {
    if (!Object.values(LockState).includes(state)) {
      throw new Error(`Invalid lock state: ${state}`);
    }
    if (state !== LockState.UNLOCKED && !(focus instanceof ProjectFocus)) {
      throw new Error('Focus required for locked state');
    }

    this.#state = state;
    this.#focus = focus;
    this.#reason = reason;
    this.#lockedAt = Date.now();
    this.#expiresAt = expiresAt;
  }

  get state() { return this.#state; }
  get focus() { return this.#focus; }
  get reason() { return this.#reason; }
  get lockedAt() { return this.#lockedAt; }
  get expiresAt() { return this.#expiresAt; }

  get isLocked() {
    return this.#state !== LockState.UNLOCKED;
  }

  get isExpired() {
    return this.#expiresAt !== null && Date.now() > this.#expiresAt;
  }

  get isHardLocked() {
    return this.#state === LockState.HARD && !this.isExpired;
  }

  /**
   * Check if proactive/unsolicited interactions are blocked
   * HARD lock blocks: proactive suggestions, unsolicited expert advice, auto transitions
   * @returns {boolean}
   */
  blocksProactiveInteractions() {
    return this.isHardLocked;
  }

  /**
   * Check if a specific interaction type is allowed
   * @param {'proactive_suggestion' | 'expert_advice' | 'auto_transition' | 'focus_change'} interactionType
   * @returns {{ allowed: boolean, reason?: string }}
   */
  allowsInteraction(interactionType) {
    if (!this.isLocked || this.isExpired) {
      return { allowed: true };
    }

    // Hard lock blocks all proactive/unsolicited interactions
    if (this.isHardLocked) {
      const blocked = ['proactive_suggestion', 'expert_advice', 'auto_transition'];
      if (blocked.includes(interactionType)) {
        return {
          allowed: false,
          reason: `Hard lock active (${this.#reason}). ${interactionType} blocked until unlock.`,
        };
      }
    }

    // Soft lock warns but allows
    return { allowed: true };
  }

  /**
   * Check if focus change is allowed
   */
  allowsFocusChange(newFocus) {
    if (!this.isLocked || this.isExpired) return { allowed: true };
    if (this.#focus.contains(newFocus)) return { allowed: true, reason: 'within_scope' };

    if (this.#state === LockState.SOFT) {
      return {
        allowed: true,
        warning: `Focus change from ${this.#focus.path} to ${newFocus.path}. Reason: ${this.#reason}`,
      };
    }

    return {
      allowed: false,
      reason: `Hard lock active: ${this.#reason}. Unlock required to change focus.`,
    };
  }

  toJSON() {
    return {
      state: this.#state,
      focus: this.#focus?.toJSON() || null,
      reason: this.#reason,
      locked_at: this.#lockedAt,
      expires_at: this.#expiresAt,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode Transition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a mode transition
 */
export class ModeTransition {
  #from;
  #to;
  #type;
  #reason;
  #timestamp;
  #metadata;

  constructor({ from, to, type, reason = '', metadata = {} }) {
    if (!Object.values(ChatMode).includes(from)) {
      throw new Error(`Invalid from mode: ${from}`);
    }
    if (!Object.values(ChatMode).includes(to)) {
      throw new Error(`Invalid to mode: ${to}`);
    }
    if (!Object.values(TransitionType).includes(type)) {
      throw new Error(`Invalid transition type: ${type}`);
    }

    this.#from = from;
    this.#to = to;
    this.#type = type;
    this.#reason = reason;
    this.#timestamp = Date.now();
    this.#metadata = Object.freeze({ ...metadata });
    Object.freeze(this);
  }

  get from() { return this.#from; }
  get to() { return this.#to; }
  get type() { return this.#type; }
  get reason() { return this.#reason; }
  get timestamp() { return this.#timestamp; }
  get metadata() { return this.#metadata; }

  toJSON() {
    return {
      from: this.#from,
      to: this.#to,
      type: this.#type,
      reason: this.#reason,
      timestamp: this.#timestamp,
      metadata: this.#metadata,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transition Rules
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid mode transitions and their requirements
 */
export const TRANSITION_RULES = Object.freeze({
  [ChatMode.CONVERSATION]: {
    [ChatMode.PROJECT]: { allowed: true, requiresFocus: true },
    [ChatMode.EXPERT]: { allowed: true },
    [ChatMode.AGENT]: { allowed: true, requiresConfirmation: true },
  },
  [ChatMode.PROJECT]: {
    [ChatMode.CONVERSATION]: { allowed: true },
    [ChatMode.EXPERT]: { allowed: true },
    [ChatMode.AGENT]: { allowed: true, preservesFocus: true },
  },
  [ChatMode.EXPERT]: {
    [ChatMode.CONVERSATION]: { allowed: true },
    [ChatMode.PROJECT]: { allowed: true },
    [ChatMode.AGENT]: { allowed: true },
  },
  [ChatMode.AGENT]: {
    [ChatMode.CONVERSATION]: { allowed: true },
    [ChatMode.PROJECT]: { allowed: true, preservesFocus: true },
    [ChatMode.EXPERT]: { allowed: true },
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Focus Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ProjectFocusManager - Manages project focus and mode transitions
 */
export class ProjectFocusManager {
  #sessionId;
  #currentFocus;
  #focusLock;
  #currentMode;
  #transitionHistory;
  #focusHistory;
  #config;

  /**
   * @param {Object} options
   * @param {string} options.sessionId - Session identifier
   * @param {Object} [options.config] - Configuration
   */
  constructor({ sessionId, config = {} }) {
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    this.#sessionId = sessionId;
    this.#currentFocus = ProjectFocus.global();
    this.#focusLock = new FocusLock({ state: LockState.UNLOCKED, focus: null });
    this.#currentMode = ChatMode.CONVERSATION;
    this.#transitionHistory = [];
    this.#focusHistory = [];
    this.#config = {
      maxHistorySize: 50,
      defaultLockDuration: 30 * 60 * 1000, // 30 minutes
      autoUnlockOnModeChange: false,
      ...config,
    };
  }

  get sessionId() { return this.#sessionId; }
  get currentFocus() { return this.#currentFocus; }
  get currentMode() { return this.#currentMode; }
  get isLocked() { return this.#focusLock.isLocked && !this.#focusLock.isExpired; }
  get lockState() { return this.#focusLock.state; }

  /**
   * Check if manager is active (has non-global focus)
   */
  isActive() {
    return this.#currentFocus.scope !== FocusScope.GLOBAL;
  }

  /**
   * Set focus
   * @param {ProjectFocus} focus - New focus
   * @returns {{ success: boolean, warning?: string, error?: string }}
   */
  setFocus(focus) {
    if (!(focus instanceof ProjectFocus)) {
      throw new Error('Focus must be a ProjectFocus instance');
    }

    // Check lock
    const lockCheck = this.#focusLock.allowsFocusChange(focus);
    if (!lockCheck.allowed) {
      return { success: false, error: lockCheck.reason };
    }

    // Record history
    this.#addFocusHistory(this.#currentFocus, focus);

    this.#currentFocus = focus;

    return {
      success: true,
      warning: lockCheck.warning,
    };
  }

  /**
   * Lock focus
   * @param {string} state - LockState
   * @param {string} [reason] - Lock reason
   * @param {number} [duration] - Lock duration in ms
   */
  lock(state = LockState.SOFT, reason = '', duration = null) {
    if (!Object.values(LockState).includes(state)) {
      throw new Error(`Invalid lock state: ${state}`);
    }

    const expiresAt = duration
      ? Date.now() + duration
      : (state !== LockState.UNLOCKED ? Date.now() + this.#config.defaultLockDuration : null);

    this.#focusLock = new FocusLock({
      state,
      focus: this.#currentFocus,
      reason,
      expiresAt,
    });

    return this.#focusLock;
  }

  /**
   * Unlock focus
   */
  unlock() {
    this.#focusLock = new FocusLock({ state: LockState.UNLOCKED, focus: null });
  }

  /**
   * Transition to new mode
   * @param {string} targetMode - Target ChatMode
   * @param {Object} [options] - Transition options
   * @returns {{ success: boolean, transition?: ModeTransition, error?: string, requiresConfirmation?: boolean }}
   */
  transitionTo(targetMode, options = {}) {
    if (!Object.values(ChatMode).includes(targetMode)) {
      throw new Error(`Invalid mode: ${targetMode}`);
    }

    // Same mode - no transition needed
    if (targetMode === this.#currentMode) {
      return { success: true, transition: null };
    }

    // Check transition rules
    const rules = TRANSITION_RULES[this.#currentMode]?.[targetMode];
    if (!rules?.allowed) {
      return {
        success: false,
        error: `Transition from ${this.#currentMode} to ${targetMode} not allowed`,
      };
    }

    // Check requirements
    if (rules.requiresFocus && this.#currentFocus.scope === FocusScope.GLOBAL) {
      return {
        success: false,
        error: 'Focus required for PROJECT mode. Use setFocus() first.',
      };
    }

    if (rules.requiresConfirmation && !options.confirmed) {
      return {
        success: false,
        requiresConfirmation: true,
        error: 'Transition to AGENT mode requires explicit confirmation',
      };
    }

    // Auto-unlock if configured
    if (this.#config.autoUnlockOnModeChange && this.isLocked) {
      this.unlock();
    }

    // Create transition
    const transition = new ModeTransition({
      from: this.#currentMode,
      to: targetMode,
      type: options.type || TransitionType.EXPLICIT,
      reason: options.reason || '',
      metadata: options.metadata || {},
    });

    // Record and apply
    this.#transitionHistory.push(transition);
    this.#currentMode = targetMode;

    // Trim history
    if (this.#transitionHistory.length > this.#config.maxHistorySize) {
      this.#transitionHistory = this.#transitionHistory.slice(-this.#config.maxHistorySize);
    }

    return { success: true, transition };
  }

  /**
   * Convenience: transition to PROJECT mode with focus
   */
  enterProject(focus, lockState = LockState.SOFT, reason = '') {
    const focusResult = this.setFocus(focus);
    if (!focusResult.success) {
      return { success: false, error: focusResult.error };
    }

    const transitionResult = this.transitionTo(ChatMode.PROJECT, {
      type: TransitionType.EXPLICIT,
      reason: reason || `Entering project: ${focus.path}`,
    });

    if (!transitionResult.success) {
      return transitionResult;
    }

    // Lock focus
    this.lock(lockState, reason || `Working on: ${focus.path}`);

    return {
      success: true,
      focus: this.#currentFocus,
      lock: this.#focusLock,
      transition: transitionResult.transition,
    };
  }

  /**
   * Convenience: exit PROJECT mode
   */
  exitProject(unlockFocus = true) {
    if (unlockFocus) {
      this.unlock();
    }

    return this.transitionTo(ChatMode.CONVERSATION, {
      type: TransitionType.EXPLICIT,
      reason: 'Exiting project mode',
    });
  }

  /**
   * Check if a file is within current focus
   */
  isInFocus(filePath) {
    return this.#currentFocus.isRelatedTo(filePath);
  }

  /**
   * Get focus history
   */
  getFocusHistory() {
    return [...this.#focusHistory];
  }

  /**
   * Get transition history
   */
  getTransitionHistory() {
    return [...this.#transitionHistory];
  }

  /**
   * Get current state
   */
  getState() {
    return {
      sessionId: this.#sessionId,
      mode: this.#currentMode,
      focus: this.#currentFocus.toJSON(),
      lock: this.#focusLock.toJSON(),
      isActive: this.isActive(),
      transitionCount: this.#transitionHistory.length,
    };
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  #addFocusHistory(from, to) {
    this.#focusHistory.push({
      from: from.toJSON(),
      to: to.toJSON(),
      timestamp: Date.now(),
    });

    if (this.#focusHistory.length > this.#config.maxHistorySize) {
      this.#focusHistory = this.#focusHistory.slice(-this.#config.maxHistorySize);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a ProjectFocusManager instance
 */
export function createProjectFocusManager(sessionId, config = {}) {
  return new ProjectFocusManager({ sessionId, config });
}

/**
 * Create a ProjectFocus instance
 */
export function createProjectFocus(options) {
  return new ProjectFocus(options);
}

/**
 * Create a file-level focus
 */
export function createFileFocus(path, metadata = {}) {
  return new ProjectFocus({
    scope: FocusScope.FILE,
    path,
    metadata,
  });
}

/**
 * Create a module-level focus
 */
export function createModuleFocus(path, metadata = {}) {
  return new ProjectFocus({
    scope: FocusScope.MODULE,
    path,
    metadata,
  });
}

/**
 * Create a project-level focus
 */
export function createProjectLevelFocus(path, metadata = {}) {
  return new ProjectFocus({
    scope: FocusScope.PROJECT,
    path,
    metadata,
  });
}
