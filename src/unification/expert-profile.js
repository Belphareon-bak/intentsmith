// CRE v44.10 — FÁZE C: Expert Profile & Arbitration
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 9 — SYSTEM UNIFICATION
//
// ExpertProfile: Expert identity with reputation tracking
// - Confidence history tracking
// - Correction tracking (user corrections)
// - Accepted rate calculation
// - Multi-expert arbitration with conflict resolution
//
// v44.10 - Added assertExpertStyle() for response quality enforcement
//
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseSpeaker, ChatMode, ResponseTag, TaggedResponse } from './chat-controller.js';

// ─────────────────────────────────────────────────────────────────────────────
// Expert Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expert domain categories
 * @readonly
 * @enum {string}
 */
export const ExpertDomain = Object.freeze({
  ARCHITECTURE: 'architecture',
  SECURITY: 'security',
  PERFORMANCE: 'performance',
  TESTING: 'testing',
  DEVOPS: 'devops',
  DATABASE: 'database',
  FRONTEND: 'frontend',
  BACKEND: 'backend',
  AI_ML: 'ai_ml',
  GENERAL: 'general',
});

/**
 * Expert response confidence levels
 * @readonly
 * @enum {string}
 */
export const ConfidenceLevel = Object.freeze({
  /** High confidence - strong evidence */
  HIGH: 'high',
  /** Medium confidence - reasonable evidence */
  MEDIUM: 'medium',
  /** Low confidence - limited evidence */
  LOW: 'low',
  /** Unknown - new or uncertain */
  UNKNOWN: 'unknown',
});

/**
 * Arbitration strategies
 * @readonly
 * @enum {string}
 */
export const ArbitrationStrategy = Object.freeze({
  /** Prefer expert with highest reputation */
  REPUTATION: 'reputation',
  /** Prefer expert with highest confidence for this query */
  CONFIDENCE: 'confidence',
  /** Prefer domain specialist */
  DOMAIN_MATCH: 'domain_match',
  /** Combine all expert opinions (weighted) */
  CONSENSUS: 'consensus',
  /** User selects preferred expert */
  USER_CHOICE: 'user_choice',
});

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single confidence measurement
 */
export class ConfidenceRecord {
  #value;
  #domain;
  #query;
  #timestamp;
  #accepted;
  #corrected;
  #correctionNote;

  constructor({ value, domain, query = '', accepted = null, corrected = false, correctionNote = '' }) {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new Error(`Confidence value must be 0-1, got: ${value}`);
    }

    this.#value = value;
    this.#domain = domain;
    this.#query = query;
    this.#timestamp = Date.now();
    this.#accepted = accepted;
    this.#corrected = corrected;
    this.#correctionNote = correctionNote;
  }

  get value() { return this.#value; }
  get domain() { return this.#domain; }
  get query() { return this.#query; }
  get timestamp() { return this.#timestamp; }
  get accepted() { return this.#accepted; }
  get corrected() { return this.#corrected; }
  get correctionNote() { return this.#correctionNote; }

  /**
   * Mark as accepted by user
   */
  markAccepted() {
    this.#accepted = true;
  }

  /**
   * Mark as rejected/corrected by user
   */
  markCorrected(note = '') {
    this.#accepted = false;
    this.#corrected = true;
    this.#correctionNote = note;
  }

  toJSON() {
    return {
      value: this.#value,
      domain: this.#domain,
      query: this.#query,
      timestamp: this.#timestamp,
      accepted: this.#accepted,
      corrected: this.#corrected,
      correction_note: this.#correctionNote,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expert Profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExpertProfile - Expert identity with reputation tracking
 */
export class ExpertProfile {
  #id;
  #name;
  #domains;
  #confidenceHistory;
  #corrections;
  #totalResponses;
  #acceptedResponses;
  #metadata;
  #createdAt;
  #config;

  /**
   * @param {Object} options
   * @param {string} options.id - Expert identifier
   * @param {string} options.name - Display name
   * @param {string[]} options.domains - Expert domains
   * @param {Object} [options.config] - Configuration
   */
  constructor({ id, name, domains = [ExpertDomain.GENERAL], config = {} }) {
    if (!id) throw new Error('Expert id is required');
    if (!name) throw new Error('Expert name is required');

    this.#id = id;
    this.#name = name;
    this.#domains = Object.freeze([...domains]);
    this.#confidenceHistory = [];
    this.#corrections = [];
    this.#totalResponses = 0;
    this.#acceptedResponses = 0;
    this.#metadata = {};
    this.#createdAt = Date.now();
    this.#config = {
      maxHistorySize: 100,
      reputationDecayFactor: 0.95, // Older records weighted less
      minSamplesForReputation: 5,
      ...config,
    };
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get domains() { return this.#domains; }
  get totalResponses() { return this.#totalResponses; }
  get acceptedResponses() { return this.#acceptedResponses; }
  get createdAt() { return this.#createdAt; }

  /**
   * Calculate accepted rate
   */
  get acceptedRate() {
    if (this.#totalResponses === 0) return 0;
    return this.#acceptedResponses / this.#totalResponses;
  }

  /**
   * Calculate overall reputation score (0-1)
   *
   * IMPORTANT: Reputation is based ONLY on results, NOT on:
   * - Response length/verbosity
   * - Number of responses
   * - Writing style
   *
   * Factors that affect reputation:
   * - Initial confidence (record.value)
   * - User acceptance (+0.1 bonus)
   * - User correction (-0.2 penalty)
   * - Recency (recent records weighted more heavily)
   */
  get reputation() {
    if (this.#confidenceHistory.length < this.#config.minSamplesForReputation) {
      return 0.5; // Neutral for new experts
    }

    // Weight recent records more heavily
    let weightedSum = 0;
    let weightSum = 0;
    const records = [...this.#confidenceHistory].reverse();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const weight = Math.pow(this.#config.reputationDecayFactor, i);

      // Factor in RESULTS: confidence + acceptance/correction
      // NOT verbosity, style, or response count
      let score = record.value;
      if (record.accepted === true) score = Math.min(score + 0.1, 1);
      if (record.corrected) score = Math.max(score - 0.2, 0);

      weightedSum += score * weight;
      weightSum += weight;
    }

    return weightSum > 0 ? weightedSum / weightSum : 0.5;
  }

  /**
   * Get confidence level category
   */
  get confidenceLevel() {
    // Not enough data to determine confidence
    if (this.#confidenceHistory.length < this.#config.minSamplesForReputation) {
      return ConfidenceLevel.UNKNOWN;
    }

    const rep = this.reputation;
    if (rep >= 0.8) return ConfidenceLevel.HIGH;
    if (rep >= 0.6) return ConfidenceLevel.MEDIUM;
    if (rep >= 0.4) return ConfidenceLevel.LOW;
    return ConfidenceLevel.UNKNOWN;
  }

  /**
   * Check if expert has domain expertise
   */
  hasDomainExpertise(domain) {
    return this.#domains.includes(domain) || this.#domains.includes(ExpertDomain.GENERAL);
  }

  /**
   * Calculate domain-specific reputation
   */
  getDomainReputation(domain) {
    const domainRecords = this.#confidenceHistory.filter(r => r.domain === domain);

    if (domainRecords.length < 3) {
      return this.hasDomainExpertise(domain) ? this.reputation : 0.3;
    }

    let weightedSum = 0;
    let weightSum = 0;
    const records = [...domainRecords].reverse();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const weight = Math.pow(this.#config.reputationDecayFactor, i);

      let score = record.value;
      if (record.accepted === true) score = Math.min(score + 0.1, 1);
      if (record.corrected) score = Math.max(score - 0.2, 0);

      weightedSum += score * weight;
      weightSum += weight;
    }

    return weightSum > 0 ? weightedSum / weightSum : this.reputation;
  }

  /**
   * Record a response
   * @param {number} confidence - Confidence value 0-1
   * @param {string} domain - Domain of the query
   * @param {string} [query] - Original query text
   * @returns {ConfidenceRecord}
   */
  recordResponse(confidence, domain, query = '') {
    const record = new ConfidenceRecord({
      value: confidence,
      domain,
      query,
    });

    this.#confidenceHistory.push(record);
    this.#totalResponses++;

    // Trim history
    if (this.#confidenceHistory.length > this.#config.maxHistorySize) {
      this.#confidenceHistory = this.#confidenceHistory.slice(-this.#config.maxHistorySize);
    }

    return record;
  }

  /**
   * Record user acceptance of last response
   */
  recordAcceptance() {
    const lastRecord = this.#confidenceHistory[this.#confidenceHistory.length - 1];
    if (lastRecord && lastRecord.accepted === null) {
      lastRecord.markAccepted();
      this.#acceptedResponses++;
    }
  }

  /**
   * Record user correction
   */
  recordCorrection(note = '') {
    const lastRecord = this.#confidenceHistory[this.#confidenceHistory.length - 1];
    if (lastRecord) {
      lastRecord.markCorrected(note);
      this.#corrections.push({
        timestamp: Date.now(),
        record: lastRecord.toJSON(),
        note,
      });
    }
  }

  /**
   * Get confidence history
   */
  getConfidenceHistory(limit = 10) {
    return this.#confidenceHistory.slice(-limit).map(r => r.toJSON());
  }

  /**
   * Get corrections history
   */
  getCorrections(limit = 10) {
    return this.#corrections.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      id: this.#id,
      name: this.#name,
      domains: this.#domains,
      total_responses: this.#totalResponses,
      accepted_responses: this.#acceptedResponses,
      accepted_rate: this.acceptedRate,
      reputation: this.reputation,
      confidence_level: this.confidenceLevel,
      corrections_count: this.#corrections.length,
      history_size: this.#confidenceHistory.length,
    };
  }

  toJSON() {
    return {
      id: this.#id,
      name: this.#name,
      domains: this.#domains,
      stats: this.getStats(),
      created_at: this.#createdAt,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expert Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Response from an expert
 */
export class ExpertResponse {
  #expertId;
  #content;
  #confidence;
  #domain;
  #reasoning;
  #sources;
  #timestamp;

  constructor({ expertId, content, confidence, domain, reasoning = '', sources = [] }) {
    this.#expertId = expertId;
    this.#content = content;
    this.#confidence = confidence;
    this.#domain = domain;
    this.#reasoning = reasoning;
    this.#sources = Object.freeze([...sources]);
    this.#timestamp = Date.now();
    Object.freeze(this);
  }

  get expertId() { return this.#expertId; }
  get content() { return this.#content; }
  get confidence() { return this.#confidence; }
  get domain() { return this.#domain; }
  get reasoning() { return this.#reasoning; }
  get sources() { return this.#sources; }
  get timestamp() { return this.#timestamp; }

  toJSON() {
    return {
      expert_id: this.#expertId,
      content: this.#content,
      confidence: this.#confidence,
      domain: this.#domain,
      reasoning: this.#reasoning,
      sources: this.#sources,
      timestamp: this.#timestamp,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arbitration Result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of multi-expert arbitration
 */
export class ArbitrationResult {
  #selectedResponse;
  #allResponses;
  #strategy;
  #reasoning;
  #conflicts;
  #consensus;

  constructor({ selectedResponse, allResponses, strategy, reasoning = '', conflicts = [], consensus = null }) {
    this.#selectedResponse = selectedResponse;
    this.#allResponses = Object.freeze([...allResponses]);
    this.#strategy = strategy;
    this.#reasoning = reasoning;
    this.#conflicts = Object.freeze([...conflicts]);
    this.#consensus = consensus;
    Object.freeze(this);
  }

  get selectedResponse() { return this.#selectedResponse; }
  get allResponses() { return this.#allResponses; }
  get strategy() { return this.#strategy; }
  get reasoning() { return this.#reasoning; }
  get conflicts() { return this.#conflicts; }
  get consensus() { return this.#consensus; }
  get hasConflicts() { return this.#conflicts.length > 0; }

  toJSON() {
    return {
      selected: this.#selectedResponse?.toJSON(),
      all_responses: this.#allResponses.map(r => r.toJSON()),
      strategy: this.#strategy,
      reasoning: this.#reasoning,
      conflicts: this.#conflicts,
      consensus: this.#consensus,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expert Arbitrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ExpertArbitrator - Manages multi-expert conflict resolution
 */
export class ExpertArbitrator {
  #experts;
  #defaultStrategy;
  #config;

  /**
   * @param {Object} options
   * @param {Map<string, ExpertProfile>} [options.experts] - Expert profiles
   * @param {string} [options.defaultStrategy] - Default arbitration strategy
   */
  constructor({ experts = new Map(), defaultStrategy = ArbitrationStrategy.REPUTATION } = {}) {
    this.#experts = experts;
    this.#defaultStrategy = defaultStrategy;
    this.#config = {
      conflictThreshold: 0.3, // Confidence diff threshold for conflict detection
      consensusThreshold: 0.7, // Min agreement for consensus
    };
  }

  /**
   * Register an expert
   */
  registerExpert(profile) {
    if (!(profile instanceof ExpertProfile)) {
      throw new Error('Must provide ExpertProfile instance');
    }
    this.#experts.set(profile.id, profile);
  }

  /**
   * Get expert by ID
   */
  getExpert(id) {
    return this.#experts.get(id);
  }

  /**
   * Get all experts for a domain
   */
  getExpertsForDomain(domain) {
    return Array.from(this.#experts.values())
      .filter(e => e.hasDomainExpertise(domain));
  }

  /**
   * Arbitrate between multiple expert responses
   * @param {ExpertResponse[]} responses - Expert responses
   * @param {Object} [options] - Arbitration options
   * @returns {ArbitrationResult}
   */
  arbitrate(responses, options = {}) {
    if (!responses || responses.length === 0) {
      throw new Error('No responses to arbitrate');
    }

    if (responses.length === 1) {
      return new ArbitrationResult({
        selectedResponse: responses[0],
        allResponses: responses,
        strategy: 'single',
        reasoning: 'Only one response provided',
      });
    }

    const strategy = options.strategy || this.#defaultStrategy;
    const domain = options.domain || responses[0].domain;

    // Detect conflicts
    const conflicts = this.#detectConflicts(responses);

    // Apply strategy
    let selected;
    let reasoning;

    switch (strategy) {
      case ArbitrationStrategy.REPUTATION:
        ({ selected, reasoning } = this.#arbitrateByReputation(responses, domain));
        break;

      case ArbitrationStrategy.CONFIDENCE:
        ({ selected, reasoning } = this.#arbitrateByConfidence(responses));
        break;

      case ArbitrationStrategy.DOMAIN_MATCH:
        ({ selected, reasoning } = this.#arbitrateByDomain(responses, domain));
        break;

      case ArbitrationStrategy.CONSENSUS:
        ({ selected, reasoning } = this.#arbitrateByConsensus(responses));
        break;

      case ArbitrationStrategy.USER_CHOICE:
        // Return all, let user choose
        return new ArbitrationResult({
          selectedResponse: null,
          allResponses: responses,
          strategy,
          reasoning: 'Awaiting user selection',
          conflicts,
        });

      default:
        ({ selected, reasoning } = this.#arbitrateByReputation(responses, domain));
    }

    // Calculate consensus if applicable
    const consensus = this.#calculateConsensus(responses);

    return new ArbitrationResult({
      selectedResponse: selected,
      allResponses: responses,
      strategy,
      reasoning,
      conflicts,
      consensus,
    });
  }

  /**
   * Create a tagged response from arbitration result
   */
  toTaggedResponse(result, expertProfile = null) {
    const response = result.selectedResponse;
    if (!response) {
      throw new Error('No selected response in arbitration result');
    }

    const expert = expertProfile || this.#experts.get(response.expertId);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERT,
      mode: ChatMode.EXPERT,
      confidence: response.confidence,
      canExecute: false,
      metadata: {
        expert_id: response.expertId,
        expert_name: expert?.name,
        domain: response.domain,
        arbitration_strategy: result.strategy,
        has_conflicts: result.hasConflicts,
        total_experts: result.allResponses.length,
      },
    });

    return new TaggedResponse({
      content: response.content,
      tag,
    });
  }

  // ─── Private Methods ───────────────────────────────────────────────────────

  #detectConflicts(responses) {
    const conflicts = [];

    for (let i = 0; i < responses.length; i++) {
      for (let j = i + 1; j < responses.length; j++) {
        const diff = Math.abs(responses[i].confidence - responses[j].confidence);

        if (diff >= this.#config.conflictThreshold) {
          conflicts.push({
            expert1: responses[i].expertId,
            expert2: responses[j].expertId,
            confidence_diff: diff,
            type: 'confidence_disagreement',
          });
        }
      }
    }

    return conflicts;
  }

  #arbitrateByReputation(responses, domain) {
    let best = null;
    let bestScore = -1;

    for (const response of responses) {
      const expert = this.#experts.get(response.expertId);
      const reputation = expert
        ? expert.getDomainReputation(domain)
        : response.confidence;

      const score = reputation * 0.6 + response.confidence * 0.4;

      if (score > bestScore) {
        bestScore = score;
        best = response;
      }
    }

    return {
      selected: best,
      reasoning: `Selected by reputation (score: ${bestScore.toFixed(2)})`,
    };
  }

  #arbitrateByConfidence(responses) {
    const best = responses.reduce((a, b) =>
      a.confidence > b.confidence ? a : b
    );

    return {
      selected: best,
      reasoning: `Highest confidence: ${best.confidence}`,
    };
  }

  #arbitrateByDomain(responses, domain) {
    // Prefer domain specialists
    const specialists = responses.filter(r => {
      const expert = this.#experts.get(r.expertId);
      return expert?.hasDomainExpertise(domain);
    });

    if (specialists.length > 0) {
      // Among specialists, pick by confidence
      const best = specialists.reduce((a, b) =>
        a.confidence > b.confidence ? a : b
      );
      return {
        selected: best,
        reasoning: `Domain specialist with confidence: ${best.confidence}`,
      };
    }

    // Fallback to confidence
    return this.#arbitrateByConfidence(responses);
  }

  #arbitrateByConsensus(responses) {
    // Simple majority-weighted average
    const totalConfidence = responses.reduce((sum, r) => sum + r.confidence, 0);
    const avgConfidence = totalConfidence / responses.length;

    // Find response closest to average (most representative)
    let closest = null;
    let closestDiff = Infinity;

    for (const response of responses) {
      const diff = Math.abs(response.confidence - avgConfidence);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = response;
      }
    }

    return {
      selected: closest,
      reasoning: `Consensus selection (avg confidence: ${avgConfidence.toFixed(2)})`,
    };
  }

  #calculateConsensus(responses) {
    if (responses.length < 2) return null;

    const confidences = responses.map(r => r.confidence);
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const variance = confidences.reduce((sum, c) => sum + Math.pow(c - avg, 2), 0) / confidences.length;
    const stdDev = Math.sqrt(variance);

    // High agreement if low standard deviation
    const agreement = 1 - Math.min(stdDev * 2, 1);

    return {
      average_confidence: avg,
      std_deviation: stdDev,
      agreement_level: agreement,
      is_consensus: agreement >= this.#config.consensusThreshold,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an ExpertProfile
 */
export function createExpertProfile(id, name, domains = [ExpertDomain.GENERAL], config = {}) {
  return new ExpertProfile({ id, name, domains, config });
}

/**
 * Create an ExpertResponse
 */
export function createExpertResponse(options) {
  return new ExpertResponse(options);
}

/**
 * Create an ExpertArbitrator
 */
export function createExpertArbitrator(options = {}) {
  return new ExpertArbitrator(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// v44.10 - Expert Style Assertion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * StyleViolation - describes a style rule violation
 */
export class StyleViolation {
  constructor({ type, message, pattern = null, severity = 'warning' }) {
    this.type = type;
    this.message = message;
    this.pattern = pattern;
    this.severity = severity;  // 'warning' | 'error'
    Object.freeze(this);
  }

  toJSON() {
    return {
      type: this.type,
      message: this.message,
      pattern: this.pattern?.toString(),
      severity: this.severity,
    };
  }
}

/**
 * StyleValidationResult - result of style validation
 */
export class StyleValidationResult {
  constructor({ valid, violations = [], warnings = [] }) {
    this.valid = valid;
    this.violations = Object.freeze([...violations]);
    this.warnings = Object.freeze([...warnings]);
    Object.freeze(this);
  }

  get hasErrors() {
    return this.violations.some(v => v.severity === 'error');
  }

  get hasWarnings() {
    return this.violations.some(v => v.severity === 'warning') || this.warnings.length > 0;
  }

  toJSON() {
    return {
      valid: this.valid,
      violations: this.violations.map(v => v.toJSON()),
      warnings: this.warnings,
    };
  }
}

/**
 * assertExpertStyle - Validate response against expert's style rules
 *
 * v44.10 - Expert Style Contract enforcement
 *
 * @param {string} response - The response content to validate
 * @param {Object} styleRules - Expert's style rules
 * @param {Object} [options] - Validation options
 * @returns {StyleValidationResult}
 */
export function assertExpertStyle(response, styleRules, options = {}) {
  if (!response || typeof response !== 'string') {
    return new StyleValidationResult({
      valid: false,
      violations: [new StyleViolation({
        type: 'EMPTY_RESPONSE',
        message: 'Response is empty or invalid',
        severity: 'error',
      })],
    });
  }

  if (!styleRules) {
    // No rules = valid by default
    return new StyleValidationResult({ valid: true });
  }

  const violations = [];
  const warnings = [];

  // ════════════════════════════════════════════════════════════════════════════
  // CHECK 1: Minimum response length
  // ════════════════════════════════════════════════════════════════════════════
  if (styleRules.minResponseLength && response.length < styleRules.minResponseLength) {
    // For very short responses, this is a warning, not an error
    // (User might have asked a yes/no question)
    const severity = response.length < 20 ? 'error' : 'warning';
    violations.push(new StyleViolation({
      type: 'TOO_SHORT',
      message: `Response too short (${response.length} chars, min: ${styleRules.minResponseLength})`,
      severity,
    }));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CHECK 2: Forbidden phrases (AI filler, generic cop-outs)
  // ════════════════════════════════════════════════════════════════════════════
  if (styleRules.forbiddenPhrases && Array.isArray(styleRules.forbiddenPhrases)) {
    for (const pattern of styleRules.forbiddenPhrases) {
      if (pattern instanceof RegExp && pattern.test(response)) {
        violations.push(new StyleViolation({
          type: 'FORBIDDEN_PHRASE',
          message: `Response contains forbidden pattern: ${pattern.toString()}`,
          pattern,
          severity: 'warning',
        }));
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CHECK 3: Required elements (for analytical/structured content)
  // ════════════════════════════════════════════════════════════════════════════
  if (styleRules.requiredElements && Array.isArray(styleRules.requiredElements)) {
    for (const pattern of styleRules.requiredElements) {
      if (pattern instanceof RegExp && !pattern.test(response)) {
        // Required elements missing is a warning, not hard failure
        warnings.push(`Missing expected element: ${pattern.toString()}`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CHECK 4: Repetition detection (response repeats the question)
  // ════════════════════════════════════════════════════════════════════════════
  if (options.originalInput) {
    const inputLower = options.originalInput.toLowerCase().trim();
    const responseLower = response.toLowerCase().trim();

    // If response starts with the exact question, it's repeating
    if (responseLower.startsWith(inputLower) && inputLower.length > 10) {
      violations.push(new StyleViolation({
        type: 'REPEATS_QUESTION',
        message: 'Response starts by repeating the question',
        severity: 'warning',
      }));
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CHECK 5: Empty structure detection (has structure but no content)
  // ════════════════════════════════════════════════════════════════════════════
  // Detect responses like "# Title\n\n" with no actual content
  const contentWithoutMarkdown = response
    .replace(/^#+\s*.*/gm, '')      // Remove headings
    .replace(/^\s*[-*]\s*/gm, '')   // Remove list markers
    .replace(/\*\*/g, '')           // Remove bold
    .replace(/\n+/g, ' ')           // Normalize newlines
    .trim();

  if (contentWithoutMarkdown.length < 30 && response.length > 50) {
    violations.push(new StyleViolation({
      type: 'EMPTY_STRUCTURE',
      message: 'Response has formatting but lacks actual content',
      severity: 'warning',
    }));
  }

  // Determine validity
  const hasErrors = violations.some(v => v.severity === 'error');
  const valid = !hasErrors;

  return new StyleValidationResult({
    valid,
    violations,
    warnings,
  });
}
