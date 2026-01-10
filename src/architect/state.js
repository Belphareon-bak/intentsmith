// C.3 Architect Mode - State Management
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

const ARCHITECT_DIR = '.c3-architect';
const STATE_FILE = 'state.json';

/**
 * Default state structure
 */
function createDefaultState(projectName) {
  return {
    project: projectName,
    created: new Date().toISOString(),
    mode: 'architect',
    definitionConfidence: 0.0,
    current: {
      path: null,
      status: 'initializing',
      started: new Date().toISOString(),
    },
    scopeLock: {
      active: false,
      path: null,
    },
    // blocker is only present when there's a problem
    stats: {
      total: 0,
      done: 0,
      wip: 0,
      blocked: 0,
    },
    lastActivity: new Date().toISOString(),
  };
}

/**
 * State Manager class
 */
export class StateManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.architectDir = path.join(projectRoot, ARCHITECT_DIR);
    this.statePath = path.join(this.architectDir, STATE_FILE);
    this.state = null;
  }

  /**
   * Initialize architect directory and state
   */
  async init(projectName) {
    // Create .c3-architect directory
    await fs.mkdir(this.architectDir, { recursive: true });
    await fs.mkdir(path.join(this.architectDir, 'roadmap'), { recursive: true });
    await fs.mkdir(path.join(this.architectDir, 'history'), { recursive: true });

    // Check if state exists
    try {
      await fs.access(this.statePath);
      this.state = await this.load();
      logger.info('Architect', 'Loaded existing state', { project: this.state.project });
    } catch {
      // Create new state
      this.state = createDefaultState(projectName);
      await this.save();
      logger.info('Architect', 'Created new state', { project: projectName });
    }

    return this.state;
  }

  /**
   * Load state from file
   */
  async load() {
    const content = await fs.readFile(this.statePath, 'utf-8');
    this.state = JSON.parse(content);
    return this.state;
  }

  /**
   * Save state to file
   */
  async save() {
    this.state.lastActivity = new Date().toISOString();
    await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
    return this.state;
  }

  /**
   * Update current position
   */
  async setCurrent(blockPath, status = 'defining') {
    this.state.current = {
      path: blockPath,
      status,
      started: new Date().toISOString(),
    };
    
    // Auto-enable scope lock
    this.state.scopeLock = {
      active: true,
      path: blockPath.split('/')[0], // Lock to top-level block
    };
    
    await this.save();
    logger.info('Architect', 'Set current block', { path: blockPath, status });
    return this.state;
  }

  /**
   * Update mode
   */
  async setMode(mode) {
    if (!['architect', 'coder', 'review'].includes(mode)) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    this.state.mode = mode;
    await this.save();
    logger.info('Architect', 'Mode changed', { mode });
    return this.state;
  }

  /**
   * Update definition confidence
   */
  async setConfidence(confidence) {
    this.state.definitionConfidence = Math.max(0, Math.min(1, confidence));
    await this.save();
    return this.state;
  }

  /**
   * Check if can proceed to code
   */
  canProceedToCode() {
    return this.state.definitionConfidence >= 0.7;
  }

  /**
   * Set blocker
   */
  async setBlocker(type, description, attempts = [], nextStep = null) {
    this.state.blocker = {
      type, // technical | decision | external
      description,
      attempts,
      nextStep,
    };
    this.state.current.status = 'blocked';
    this.state.stats.blocked++;
    await this.save();
    logger.warn('Architect', 'Blocker set', { type, description });
    return this.state;
  }

  /**
   * Clear blocker
   */
  async clearBlocker() {
    delete this.state.blocker;
    this.state.stats.blocked = Math.max(0, this.state.stats.blocked - 1);
    await this.save();
    logger.info('Architect', 'Blocker cleared');
    return this.state;
  }

  /**
   * Add attempt to current blocker
   */
  async addBlockerAttempt(attempt) {
    if (this.state.blocker) {
      this.state.blocker.attempts.push(attempt);
      await this.save();
    }
    return this.state;
  }

  /**
   * Update stats
   */
  async updateStats(stats) {
    this.state.stats = { ...this.state.stats, ...stats };
    await this.save();
    return this.state;
  }

  /**
   * Mark block as complete
   */
  async completeBlock() {
    this.state.current.status = 'done';
    this.state.stats.done++;
    this.state.stats.wip = Math.max(0, this.state.stats.wip - 1);
    await this.save();
    logger.info('Architect', 'Block completed', { path: this.state.current.path });
    return this.state;
  }

  /**
   * Unlock scope (explicit action required)
   */
  async unlockScope() {
    this.state.scopeLock.active = false;
    await this.save();
    logger.info('Architect', 'Scope unlocked');
    return this.state;
  }

  /**
   * Check if path is within current scope
   */
  isInScope(blockPath) {
    if (!this.state.scopeLock.active) return true;
    return blockPath.startsWith(this.state.scopeLock.path);
  }

  /**
   * Get state summary for context
   */
  getSummary() {
    return {
      project: this.state.project,
      mode: this.state.mode,
      confidence: this.state.definitionConfidence,
      current: this.state.current,
      stats: this.state.stats,
      hasBlocker: !!this.state.blocker,
      blocker: this.state.blocker || null,
    };
  }
}

export default StateManager;
