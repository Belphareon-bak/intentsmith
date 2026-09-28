// CRE v45.0 KOLO 5.4 — Creative Depth Scaling
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Separate style (expert) from task depth
// - CreativeDepth: light | narrative | worldbuilding
// - Follow-up "alternative version" → automatically increases depth
//
// PURPOSE:
// CREATIVE intent needs depth scaling independent of expert style.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Creative Depth Levels
// ─────────────────────────────────────────────────────────────────────────────

export const CreativeDepth = {
  LIGHT: 'light',             // Quick, simple creative output
  NARRATIVE: 'narrative',     // Developed story/poem with arc
  WORLDBUILDING: 'worldbuilding', // Deep, elaborated creative universe
};

// ─────────────────────────────────────────────────────────────────────────────
// Depth Escalation Patterns
// ─────────────────────────────────────────────────────────────────────────────

// Patterns that suggest depth increase
const DEPTH_ESCALATION_PATTERNS = [
  // Alternative/variant requests
  /alternativ[nuíě]/i,
  /jin(ou|á|ý|é)?\s+verz[ie]/i,
  /jinak/i,
  /different\s+version/i,
  /alternative/i,

  // Continuation requests
  /pokračuj/i,
  /pokračování/i,
  /dál/i,
  /víc/i,
  /continue/i,
  /more/i,

  // Elaboration requests
  /rozviň/i,
  /rozveď/i,
  /podrobněji/i,
  /elaborate/i,
  /expand/i,

  // Deepening requests
  /hlouběji/i,
  /do hloubky/i,
  /detailněji/i,
  /deeper/i,
  /in depth/i,
];

// Patterns that suggest staying at current or reducing depth
const DEPTH_REDUCTION_PATTERNS = [
  /kratší/i,
  /stručněji/i,
  /zkrať/i,
  /shorter/i,
  /simpler/i,
  /jednodušeji/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// Creative Task Type Detection
// ─────────────────────────────────────────────────────────────────────────────

export const CreativeTaskType = {
  POEM: 'poem',
  STORY: 'story',
  SONG: 'song',
  SCRIPT: 'script',
  JOKE: 'joke',
  IDEA: 'idea',
  NAME: 'name',
  OTHER: 'other',
};

const TASK_TYPE_PATTERNS = {
  [CreativeTaskType.POEM]: [/básn[ěi]/i, /poem/i, /verš/i, /rým/i],
  [CreativeTaskType.STORY]: [/příběh/i, /povídka/i, /story/i, /pohádka/i],
  [CreativeTaskType.SONG]: [/píseň/i, /písnička/i, /song/i, /text\s+písně/i],
  [CreativeTaskType.SCRIPT]: [/scénář/i, /script/i, /dialog/i],
  [CreativeTaskType.JOKE]: [/vtip/i, /joke/i, /humor/i, /anekdot/i],
  [CreativeTaskType.IDEA]: [/nápad/i, /idea/i, /návrh/i, /navrhni/i, /navrhn/i, /vymysli/i],
  [CreativeTaskType.NAME]: [/jméno/i, /název/i, /name/i, /pojmenuj/i],
};

/**
 * Detect creative task type from input
 * @param {string} input - User input
 * @returns {CreativeTaskType}
 */
export function detectCreativeTaskType(input) {
  for (const [type, patterns] of Object.entries(TASK_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(input)) {
        return type;
      }
    }
  }
  return CreativeTaskType.OTHER;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Depth by Task Type
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DEPTH_BY_TYPE = {
  [CreativeTaskType.POEM]: CreativeDepth.LIGHT,
  [CreativeTaskType.STORY]: CreativeDepth.NARRATIVE,
  [CreativeTaskType.SONG]: CreativeDepth.NARRATIVE,
  [CreativeTaskType.SCRIPT]: CreativeDepth.NARRATIVE,
  [CreativeTaskType.JOKE]: CreativeDepth.LIGHT,
  [CreativeTaskType.IDEA]: CreativeDepth.LIGHT,
  [CreativeTaskType.NAME]: CreativeDepth.LIGHT,
  [CreativeTaskType.OTHER]: CreativeDepth.LIGHT,
};

// ─────────────────────────────────────────────────────────────────────────────
// Creative Depth State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages creative depth state across conversation
 */
export class CreativeDepthTracker {
  constructor() {
    this.currentDepth = CreativeDepth.LIGHT;
    this.taskType = CreativeTaskType.OTHER;
    this.escalationCount = 0;
    this.history = [];
  }

  /**
   * Process input and update depth
   * @param {string} input - User input
   * @param {Object} context - Context with lastIntent, etc.
   * @returns {Object} { depth: CreativeDepth, changed: boolean, reason: string }
   */
  processInput(input, context = {}) {
    const previousDepth = this.currentDepth;
    let reason = 'no_change';

    // Detect task type
    const detectedType = detectCreativeTaskType(input);
    if (detectedType !== CreativeTaskType.OTHER) {
      this.taskType = detectedType;
    }

    // Check for depth reduction
    for (const pattern of DEPTH_REDUCTION_PATTERNS) {
      if (pattern.test(input)) {
        this.currentDepth = this._decreaseDepth();
        this.escalationCount = Math.max(0, this.escalationCount - 1);
        reason = 'reduction_requested';

        this.history.push({ input, depth: this.currentDepth, reason });
        return {
          depth: this.currentDepth,
          changed: previousDepth !== this.currentDepth,
          reason,
        };
      }
    }

    // Check for depth escalation
    for (const pattern of DEPTH_ESCALATION_PATTERNS) {
      if (pattern.test(input)) {
        this.currentDepth = this._increaseDepth();
        this.escalationCount++;
        reason = 'escalation_requested';

        this.history.push({ input, depth: this.currentDepth, reason });
        return {
          depth: this.currentDepth,
          changed: previousDepth !== this.currentDepth,
          reason,
        };
      }
    }

    // If this is a new creative task, reset to default for that type
    if (context.isNewCreativeTask) {
      this.currentDepth = DEFAULT_DEPTH_BY_TYPE[this.taskType];
      this.escalationCount = 0;
      reason = 'new_task_default';
    }

    this.history.push({ input, depth: this.currentDepth, reason });
    return {
      depth: this.currentDepth,
      changed: previousDepth !== this.currentDepth,
      reason,
    };
  }

  /**
   * Increase depth by one level
   * @returns {CreativeDepth}
   */
  _increaseDepth() {
    switch (this.currentDepth) {
      case CreativeDepth.LIGHT:
        return CreativeDepth.NARRATIVE;
      case CreativeDepth.NARRATIVE:
        return CreativeDepth.WORLDBUILDING;
      case CreativeDepth.WORLDBUILDING:
        return CreativeDepth.WORLDBUILDING; // Already max
      default:
        return CreativeDepth.NARRATIVE;
    }
  }

  /**
   * Decrease depth by one level
   * @returns {CreativeDepth}
   */
  _decreaseDepth() {
    switch (this.currentDepth) {
      case CreativeDepth.WORLDBUILDING:
        return CreativeDepth.NARRATIVE;
      case CreativeDepth.NARRATIVE:
        return CreativeDepth.LIGHT;
      case CreativeDepth.LIGHT:
        return CreativeDepth.LIGHT; // Already min
      default:
        return CreativeDepth.LIGHT;
    }
  }

  /**
   * Get synthesis hints for creative depth
   * @returns {Object}
   */
  getSynthesisHints() {
    return {
      creativeDepth: this.currentDepth,
      taskType: this.taskType,
      escalationCount: this.escalationCount,
    };
  }

  /**
   * Reset tracker state
   */
  reset() {
    this.currentDepth = CreativeDepth.LIGHT;
    this.taskType = CreativeTaskType.OTHER;
    this.escalationCount = 0;
    this.history = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Creative Depth Synthesis Instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get synthesis instructions based on creative depth
 * @param {CreativeDepth} depth - Current creative depth
 * @param {CreativeTaskType} taskType - Type of creative task
 * @returns {string} Instructions for synthesis
 */
export function getCreativeDepthInstructions(depth, taskType = CreativeTaskType.OTHER) {
  const instructions = [];

  // Task type specific guidance
  switch (taskType) {
    case CreativeTaskType.POEM:
      instructions.push('TYP: Báseň/poezie');
      break;
    case CreativeTaskType.STORY:
      instructions.push('TYP: Příběh/povídka');
      break;
    case CreativeTaskType.SONG:
      instructions.push('TYP: Text písně');
      break;
    case CreativeTaskType.SCRIPT:
      instructions.push('TYP: Scénář/dialog');
      break;
    case CreativeTaskType.JOKE:
      instructions.push('TYP: Humor/vtip');
      break;
  }

  // Depth specific guidance
  switch (depth) {
    case CreativeDepth.LIGHT:
      instructions.push('HLOUBKA: Lehká');
      instructions.push('- Krátký, jednoduchý výstup');
      instructions.push('- Bez rozsáhlého kontextu');
      instructions.push('- Rychlá, přímá kreativita');
      break;

    case CreativeDepth.NARRATIVE:
      instructions.push('HLOUBKA: Narativní');
      instructions.push('- Rozvinutý příběh/struktura');
      instructions.push('- Postavy mají motivace');
      instructions.push('- Jasný začátek, střed, konec');
      break;

    case CreativeDepth.WORLDBUILDING:
      instructions.push('HLOUBKA: Worldbuilding');
      instructions.push('- Detailní svět/prostředí');
      instructions.push('- Propracované pozadí');
      instructions.push('- Konzistentní logika světa');
      instructions.push('- Možnost dalšího rozvoje');
      break;
  }

  return instructions.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

export const creativeDepthTracker = new CreativeDepthTracker();

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  CreativeDepth,
  CreativeTaskType,
  detectCreativeTaskType,
  CreativeDepthTracker,
  creativeDepthTracker,
  getCreativeDepthInstructions,
};
