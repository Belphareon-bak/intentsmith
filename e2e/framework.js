#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent E2E Test Framework v58.3
// ══════════════════════════════════════════════════════════════════════════════
//
// Provides:
//   - E2ETestRunner: test execution with pass/warn/fail/skip tracking
//   - ConversationSimulator: multi-turn conversation state management
//   - computeDesignVarianceScore(): quality depth metric (0.0–1.0)
//   - Soft assertion helpers (language, forbidden, patterns, overlap, drift)
//   - MockBridge: controlled LLM mock for retry/gate testing
//   - RetryReason enum for retry classification
//
// Import: import { ... } from './framework.js';
// ══════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'fs';
import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
  FORBIDDEN_PHRASES,
  DESIGN_CONTINUE_PATTERNS,
  normalizeForClassification,
} from '../src/chat/cre-decision.js';
import { assertDesignQuality } from '../src/chat/handlers/utils/quality.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

export const RetryReason = Object.freeze({
  LANGUAGE: 'LANGUAGE',
  FORBIDDEN: 'FORBIDDEN',
  HEDGING: 'HEDGING',
  STRUCTURE: 'STRUCTURE',
});

export const E2EMode = Object.freeze({
  CI: 'ci',
  NIGHTLY: 'nightly',
  WEEKLY: 'weekly',
});

// Delegate to canonical normalizer from cre-decision.js
export function normalizeTypos(text) {
  return normalizeForClassification(text);
}

export { IntentType, DecisionType, FORBIDDEN_PHRASES, DESIGN_CONTINUE_PATTERNS };

const engine = new CREDecisionEngine();
export { engine };

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN VARIANCE SCORE (0.0 – 1.0)
// ═══════════════════════════════════════════════════════════════════════════════

const SECTION_MARKERS = [
  /0️⃣|verdikt|shrnut|overview/i,
  /1️⃣|architektur|architecture/i,
  /2️⃣|stack|technolog/i,
  /3️⃣|dato[vw]|data\s*model/i,
  /4️⃣|sprint|roadmap|milník|milestone/i,
  /5️⃣|rizik|risk/i,
  /6️⃣|okam[žz]it|quick.?start|mvp/i,
];

const TECH_PATTERNS = [
  /\b(react|vue|angular|svelte|next\.?js|nuxt|remix|astro|gatsby)\b/i,
  /\b(express|fastify|nest\.?js|koa|hono|django|flask|fastapi|spring|rails)\b/i,
  /\b(flutter|react\s*native|swift|kotlin|xamarin)\b/i,
  /\b(postgre|mysql|maria|sqlite|mongo|redis|elastic|dynamo|cassandra|cockroach|supabase|neon)\b/i,
  /\b(docker|kubernetes|k8s|nginx|caddy|traefik|terraform|pulumi|ansible)\b/i,
  /\b(aws|gcp|azure|vercel|cloudflare|fly\.io|railway|render)\b/i,
  /\b(oauth|jwt|keycloak|auth0|clerk)\b/i,
  /\b(rabbitmq|kafka|nats|bullmq|celery)\b/i,
  /\b(graphql|grpc|trpc|rest\s+api|websocket|sse)\b/i,
  /\b(typescript|python|rust|go(?:lang)?|java\b|c\#|ruby|php|elixir)\b/i,
  /\b(jest|vitest|pytest|cypress|playwright|github\s*actions|gitlab\s*ci)\b/i,
];

const DECISION_PATTERNS = [
  /vybr[áa]l\w*\s.{3,40}\s(proto[žz]e|kv[ůu]li|z\s*d[ůu]vod)/i,
  /pou[žz]ij\w*\s.{3,40}\s(proto[žz]e|kv[ůu]li|d[ůu]vod)/i,
  /doporu[čc]uji?\s.{3,40}\s(proto[žz]e|kv[ůu]li)/i,
  /volím\s/i, /volba\s+padla/i,
  /\bchoos\w*\s.{3,40}\s(because|due to|since|as it)/i,
  /\busing\s.{3,40}\s(because|for its|due to)/i,
  /\brecommend\w*\s.{3,40}\s(because|since|as)/i,
  /\bover\s.{3,40}\s(because|due|since)/i,
  /→|=>/,
];

const CONCRETE_PATTERNS = [
  /`[^`]{3,50}`/,
  /```[\s\S]{10,}```/,
  /\/api\/\w+/i,
  /\w+\.(ts|js|py|rs|go|java|rb|yml|yaml|json|toml|sql)/i,
  /npm\s+(install|i|run)|pip\s+install|cargo\s+add|go\s+get/i,
  /CREATE\s+TABLE|SELECT|INSERT/i,
  /\b\d+\s*(MB|GB|ms|s|req\/s|RPS|QPS|TPS)\b/i,
  /port\s+\d{2,5}/i,
];

export function computeDesignVarianceScore(content) {
  const sectionsPresent = SECTION_MARKERS.filter(p => p.test(content)).length;
  const techCount = TECH_PATTERNS.filter(p => p.test(content)).length;
  const decisionCount = DECISION_PATTERNS.filter(p => p.test(content)).length;
  const concreteCount = CONCRETE_PATTERNS.filter(p => p.test(content)).length;

  const scores = {
    sections: sectionsPresent / 7,
    techSpecificity: Math.min(techCount / 8, 1.0),
    decisions: Math.min(decisionCount / 4, 1.0),
    concreteness: Math.min(concreteCount / 4, 1.0),
  };

  const weights = { sections: 0.25, techSpecificity: 0.30, decisions: 0.30, concreteness: 0.15 };
  const total = Object.entries(weights).reduce(
    (sum, [key, w]) => sum + (scores[key] || 0) * w, 0
  );

  return {
    score: Math.round(total * 100) / 100,
    breakdown: scores,
    techCount,
    decisionCount,
    concreteCount,
    sectionsPresent,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOFT ASSERTIONS
// ═══════════════════════════════════════════════════════════════════════════════

const CZ_MARKERS = /\b(je|jsou|byl[aoy]?|není|nebo|ale|který|které|proto|může|jako|jeho|také|při|mezi|bude|bylo|jsem|máme|toto|velmi|pouze|které)\b/ig;
const EN_MARKERS = /\b(the|is|are|was|not|or|but|which|also|can|with|for|from|between|this|that|will|have|been|would|should)\b/ig;
const PL_MARKERS = /\b(jest|są|był|nie|lub|ale|który|które|dlatego|może|jako|jego|także|przy|między|będzie|bardzo|tylko|informacje|również|proszę|dziękuję|niestety)\b/ig;
const ES_MARKERS = /\b(también|puede|aquí|gracias|pero|está|este|como|para|tiene|porque|cuando|sobre|desde|lo siento|no puedo)\b/ig;

export function assertLanguage(text, expected) {
  if (expected === 'cs') {
    const cz = (text.match(CZ_MARKERS) || []).length;
    const en = (text.match(EN_MARKERS) || []).length;
    const pl = (text.match(PL_MARKERS) || []).length;
    const es = (text.match(ES_MARKERS) || []).length;
    if (cz < en && text.length > 100) throw new Error(`Expected Czech, mostly English (cz:${cz} en:${en})`);
    if (pl > cz * 0.3 && pl > 2) throw new Error(`Polish leak (pl:${pl} cz:${cz})`);
    if (es > 2) throw new Error(`Spanish leak (es:${es})`);
  } else if (expected === 'en') {
    const cz = (text.match(CZ_MARKERS) || []).length;
    const en = (text.match(EN_MARKERS) || []).length;
    if (en < cz && text.length > 100) throw new Error(`Expected English, mostly Czech (en:${en} cz:${cz})`);
  }
}

export function assertNoForbidden(text, phrases) {
  const lower = text.toLowerCase();
  for (const p of (phrases || FORBIDDEN_PHRASES)) {
    if (lower.includes(p.toLowerCase())) throw new Error(`Forbidden phrase: "${p}"`);
  }
}

export function assertMinLength(text, min) {
  if (text.length < min) throw new Error(`Too short: ${text.length} < ${min} chars`);
}

export function assertMaxLength(text, max) {
  if (text.length > max) throw new Error(`Too long: ${text.length} > ${max} chars`);
}

export function assertPatterns(text, patterns, minimum = 1) {
  const matches = patterns.filter(p => p.test(text));
  if (matches.length < minimum) {
    throw new Error(`Only ${matches.length}/${minimum} required patterns matched`);
  }
  return matches.length;
}

export function assertNoPatterns(text, patterns) {
  for (const p of patterns) {
    if (p.test(text)) throw new Error(`Forbidden pattern matched: ${p.source.substring(0, 50)}`);
  }
}

export function assertNoOverlap(text1, text2, maxOverlap = 0.3) {
  const ngrams = (s) => {
    const set = new Set();
    const lower = s.toLowerCase().replace(/\s+/g, ' ');
    for (let i = 0; i < lower.length - 2; i++) set.add(lower.substring(i, i + 3));
    return set;
  };
  const a = ngrams(text1);
  const b = ngrams(text2);
  if (a.size === 0 || b.size === 0) return;
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  const sim = inter / union;
  if (sim > maxOverlap) {
    throw new Error(`Overlap ${(sim * 100).toFixed(1)}% > ${maxOverlap * 100}% max`);
  }
}

const CHATBOT_DRIFT_PATTERNS = [
  /rád[ay]?\s+(vám|ti)\s+pomohu/i,
  /neváhejte\s+se\s+zeptat/i,
  /rádo?\s+se\s+stalo/i,
  /jsem\s+tu\s+pro\s+(vás|tebe)/i,
  /pokud\s+máte\s+další\s+dotazy/i,
  /i'?m\s+happy\s+to\s+help/i,
  /feel\s+free\s+to\s+ask/i,
  /let\s+me\s+know\s+if/i,
  /glad\s+i\s+could\s+help/i,
  /hope\s+this\s+helps/i,
  /if\s+you\s+have\s+any\s+(more\s+)?questions/i,
];
export { CHATBOT_DRIFT_PATTERNS };

export function assertNoChatbotDrift(text) {
  for (const p of CHATBOT_DRIFT_PATTERNS) {
    if (p.test(text)) throw new Error(`Chatbot drift: ${p.source.substring(0, 50)}`);
  }
}

export function assertIntent(input, expected, context) {
  const intent = engine.classifyIntent(input);
  if (Array.isArray(expected)) {
    if (!expected.includes(intent)) {
      throw new Error(`Intent "${intent}" not in [${expected.join(', ')}] for "${input.substring(0, 50)}"`);
    }
  } else {
    if (intent !== expected) {
      throw new Error(`Intent "${intent}" !== "${expected}" for "${input.substring(0, 50)}"`);
    }
  }
  return intent;
}

export async function assertDecisionType(input, expectedType, context) {
  const decision = await engine.decide(input, context || {});
  if (decision.type !== expectedType) {
    throw new Error(`Decision type "${decision.type}" !== "${expectedType}" for "${input.substring(0, 50)}"`);
  }
  return decision;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVERSATION SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════════
// Simulates multi-turn conversations using CRE classification + SessionState.
// The decision path uses the configured LLM intent classifier; response bodies
// remain synthetic so the harness can focus on routing and session lifecycle.
// ═══════════════════════════════════════════════════════════════════════════════

class SimpleSessionState {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this._lastIntent = null;
    this._lastDecision = null;
    this._pendingDecision = null;
    this._awaitingClarification = false;
    this._awaitingSlots = [];
    this._lastUserInput = null;
    this._project = null;
    this._expert = null;
    this._expertLocked = false;
    this._activeDesignProject = null;
    this._projectWorkingMemory = {
      goal: null, activeFile: null, lastArtifactId: null, driftCount: 0,
    };
  }

  // Getters
  get lastIntent() { return this._lastIntent; }
  get lastDecision() { return this._lastDecision; }
  get pendingDecision() { return this._pendingDecision; }
  get awaitingClarification() { return this._awaitingClarification; }
  get awaitingSlots() { return [...this._awaitingSlots]; }
  get lastUserInput() { return this._lastUserInput; }
  get project() { return this._project; }
  get hasActiveProject() { return this._project !== null; }
  get expert() { return this._expert; }
  get hasActiveExpert() { return this._expert !== null; }
  get expertLocked() { return this._expertLocked; }
  get activeDesignProject() { return this._activeDesignProject; }
  get hasActiveDesignProject() { return this._activeDesignProject !== null; }
  get projectWorkingMemory() { return { ...this._projectWorkingMemory }; }
  get projectGoal() { return this._projectWorkingMemory.goal; }
  get driftCount() { return this._projectWorkingMemory.driftCount || 0; }

  // Setters
  setProject(p) { this._project = p; return this; }
  clearProject() { this._project = null; return this; }
  setExpert(e, opts = {}) { this._expert = e; this._expertLocked = opts.locked !== false; return this; }
  lockExpert() { this._expertLocked = true; return this; }
  unlockExpert() { this._expertLocked = false; return this; }
  canChangeExpert() { return !this._expert || !this._expertLocked; }

  // v58.0 DESIGN
  setActiveDesignProject(project) { this._activeDesignProject = project; return this; }
  updateDesignProject(updates) {
    if (this._activeDesignProject) Object.assign(this._activeDesignProject, updates);
    return this;
  }
  closeDesignProject(reason) {
    const closed = this._activeDesignProject;
    this._activeDesignProject = null;
    return closed;
  }

  // Decision tracking
  recordDecision(decision, userInput) {
    this._lastIntent = decision.intent;
    this._lastDecision = decision;
    this._lastUserInput = userInput;
  }
  setPendingDecision(decision, slots = []) {
    this._pendingDecision = decision;
    this._awaitingClarification = true;
    this._awaitingSlots = slots;
  }
  clearPendingDecision() {
    this._pendingDecision = null;
    this._awaitingClarification = false;
    this._awaitingSlots = [];
  }
  getPendingIntent() { return this._pendingDecision?.intent; }

  // Storage (no-op in tests)
  saveToStorage() {}
}

export class ConversationSimulator {
  constructor(sessionId = 'e2e-test') {
    this.sessionId = sessionId;
    this.sessionState = new SimpleSessionState(sessionId);
    this.history = [];
    this.metrics = {
      retries: [],
      varianceScores: [],
      responseTimes: [],
      lengths: [],
      intents: [],
      decisionTypes: [],
    };
  }

  /**
   * Classify intent + make decision for input. The decision step may call the
   * configured LLM intent classifier; response generation is simulated.
   */
  async send(input) {
    const text = input.trim();
    const ss = this.sessionState;
    const decisionContext = {
      hasActiveProject: ss.hasActiveProject,
      project: ss.project,
      hasActiveExpert: ss.hasActiveExpert,
      expert: ss.expert,
      expertLocked: ss.expertLocked,
      lastIntent: ss.lastIntent,
      lastDecision: ss.lastDecision,
    };

    // ── DESIGN session intercepts (mirrors conversation.js logic) ─────
    if (ss.hasActiveDesignProject) {
      // Graceful close
      const CLOSE_PATTERNS = [
        /^hotovo[\s!.]*$/i, /^to\s+(je\s+)?v[šs]e[\s!.]*$/i,
        /^d[ií]ky,?\s+(to\s+)?sta[čc][ií][\s!.]*$/i, /^sta[čc][ií][\s!.]*$/i,
        /^uzav[rř]i\s+(projekt|session|design)/i, /^ukon[čc]i\s+(design|n[áa]vrh)/i,
        /^that'?s\s+(all|enough|it)[\s!.]*$/i, /^done[\s!.]*$/i,
        /^we'?re\s+done/i, /^close\s+(project|design|session)/i,
      ];
      if (CLOSE_PATTERNS.some(p => p.test(text))) {
        const closed = ss.closeDesignProject('graceful_close');
        this._recordTurn(input, {
          intent: 'DESIGN_CLOSE', type: 'CLOSE', content: 'Projekt uzavřen.',
          metadata: { designClosed: true, closedProject: closed },
        });
        return this.lastResult;
      }

      // Explicit break
      const isExplicitBreak = /^(teď|ted|nyní|nyni|změň|zmen|přepni|prepni|něco|neco|dost|stačí|staci|konec)\s/i.test(text);

      // DESIGN_CONTINUE intercept — checked BEFORE BUILD (matches conversation.js order)
      const isDesignFollowUp = DESIGN_CONTINUE_PATTERNS.some(p => p.test(text)) ||
                                DESIGN_CONTINUE_PATTERNS.some(p => p.test(normalizeTypos(text)));
      const isFactQuery = /kolik\s+je\s+\d|jak[ée]\s+je\s+(dnes\s+)?datum|\d+\s*[+\-*/]\s*\d+/i.test(text);

      if (isDesignFollowUp && !isExplicitBreak && !isFactQuery) {
        ss.updateDesignProject({
          turnCount: (ss.activeDesignProject.turnCount || 1) + 1,
        });
        ss.recordDecision({ intent: IntentType.DESIGN, type: DecisionType.ANSWER }, input);
        this._recordTurn(input, {
          intent: IntentType.DESIGN, type: DecisionType.ANSWER,
          content: '[DESIGN_CONTINUE — LLM would respond here]',
          metadata: { designContinue: true, turnCount: ss.activeDesignProject.turnCount },
        });
        return this.lastResult;
      }

      // BUILD transition — only if NOT caught by DESIGN_CONTINUE
      const BUILD_PATTERNS = [
        /jdeme?\s+stav[eě]t/i, /za[cč]ni\s+stav[eě]t/i,
        /postav\s+(to|mi\s+to)/i, /let'?s\s+build/i,
        /start\s+(building|coding|implementing)/i, /implement\s+this/i,
      ];
      if (BUILD_PATTERNS.some(p => p.test(text))) {
        const closed = ss.closeDesignProject('build_transition');
        this._recordTurn(input, {
          intent: IntentType.BUILD, type: DecisionType.PLAN,
          content: '[BUILD transition]',
          metadata: { buildTransition: true, designContext: closed },
        });
        return this.lastResult;
      }

      if (isExplicitBreak) {
        ss.closeDesignProject('explicit_break');
        // Fall through to normal classification
      }
      // Fact query: fall through (project stays active)
    }

    // ── Normal CRE classification ────────────────────────────────────
    const intent = engine.classifyIntent(input);
    const decision = await engine.decide(input, decisionContext);

    // ── v58.3-fix: DESIGN SESSION INVARIANT ──────────────────────────
    // During active DESIGN, non-escape intents = DESIGN_CONTINUE
    // Catch ALL non-DESIGN intents (FRESH_DATA_SIGNALS may reclassify follow-ups as CONVERSATIONAL etc.)
    const isFactQ = /kolik\s+je\s+\d|jak[ée]\s+je\s+(dnes\s+)?datum|\d+\s*[+\-*/]\s*\d+/i.test(text);
    if (ss.hasActiveDesignProject && !isFactQ && intent !== IntentType.DESIGN) {
      ss.updateDesignProject({
        turnCount: (ss.activeDesignProject.turnCount || 1) + 1,
      });
      ss.recordDecision({ intent: IntentType.DESIGN, type: DecisionType.ANSWER }, input);
      this._recordTurn(input, {
        intent: IntentType.DESIGN, type: DecisionType.ANSWER,
        content: `[DESIGN invariant — ${intent} downgraded to CONTINUE]`,
        metadata: { designContinue: true, downgradedFrom: intent, turnCount: ss.activeDesignProject.turnCount },
      });
      return this.lastResult;
    }

    // ── DESIGN initial: set up session ───────────────────────────────
    if (intent === IntentType.DESIGN) {
      if (ss.hasActiveDesignProject) {
        // Already in DESIGN session — treat re-DESIGN as CONTINUE
        ss.updateDesignProject({
          turnCount: (ss.activeDesignProject.turnCount || 1) + 1,
        });
        ss.recordDecision({ intent: IntentType.DESIGN, type: DecisionType.ANSWER }, input);
        this._recordTurn(input, {
          intent: IntentType.DESIGN, type: DecisionType.ANSWER,
          content: '[DESIGN re-entry → CONTINUE]',
          metadata: { designContinue: true, turnCount: ss.activeDesignProject.turnCount },
        });
        return this.lastResult;
      }
      // New DESIGN session
      ss.setActiveDesignProject({
        type: 'detected',
        defaults: {},
        startedAt: new Date().toISOString(),
        phase: 'design',
        turnCount: 1,
        language: /[a-z]{2,}/i.test(input) && !/[čřžšďťňůúýáéí]/i.test(input) ? 'en' : 'cs',
      });
    }

    ss.recordDecision(decision, input);
    this._recordTurn(input, {
      intent,
      type: decision.type,
      content: `[${intent} → ${decision.type} — LLM would respond here]`,
      metadata: { decision: decision.toJSON?.() || decision },
    });
    return this.lastResult;
  }

  _recordTurn(input, result) {
    this.history.push({ userInput: input, response: result });
    this.metrics.intents.push(result.intent);
    this.metrics.decisionTypes.push(result.type);
    this.metrics.lengths.push(result.content?.length || 0);
  }

  get turnCount() { return this.history.length; }
  get lastResult() { return this.history.at(-1)?.response; }
  resultAt(turn) { return this.history[turn - 1]?.response; }
  inputAt(turn) { return this.history[turn - 1]?.userInput; }
}

export { SimpleSessionState };

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK BRIDGE (for controlled forbidden/retry testing)
// ═══════════════════════════════════════════════════════════════════════════════

export class MockBridge {
  constructor(responses) {
    this.responses = responses;  // Array of response strings (per call)
    this.callIndex = 0;
    this.calls = [];             // Log of all calls made
  }

  async generateChatResponse(prompt, systemPrompt, opts) {
    const content = this.responses[Math.min(this.callIndex, this.responses.length - 1)];
    this.calls.push({ prompt, systemPrompt, opts, callIndex: this.callIndex });
    this.callIndex++;
    return { content, model: 'mock', duration: 0 };
  }

  get callCount() { return this.callIndex; }
  reset() { this.callIndex = 0; this.calls = []; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

export class E2ETestRunner {
  constructor(opts = {}) {
    this.mode = opts.mode || process.env.E2E_MODE || E2EMode.CI;
    this.timeout = opts.timeout || 30000;
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
    this.skipped = 0;
    this._currentSection = '';
    this._sectionPassed = 0;
    this._sectionFailed = 0;
    this._sectionWarned = 0;
  }

  section(name) {
    this._flushSection();
    this._currentSection = name;
    this._sectionPassed = 0;
    this._sectionFailed = 0;
    this._sectionWarned = 0;
  }

  _flushSection() {
    if (!this._currentSection) return;
    const total = this._sectionPassed + this._sectionFailed + this._sectionWarned;
    if (total === 0) return;
    const icon = this._sectionFailed > 0 ? '❌' : this._sectionWarned > 0 ? '⚠️' : '✅';
    const parts = [`${this._sectionPassed} pass`];
    if (this._sectionWarned > 0) parts.push(`${this._sectionWarned} warn`);
    if (this._sectionFailed > 0) parts.push(`${this._sectionFailed} fail`);
    console.log(`  ${icon} ${this._currentSection}: ${parts.join(', ')} / ${total}`);
  }

  /**
   * Run a single test.
   * @param {string} name
   * @param {Function} fn - async function, may return { varianceScore }
   * @param {Object} opts - { nightly, weekly, varianceThreshold }
   */
  async test(name, fn, opts = {}) {
    const { nightly = false, weekly = false, varianceThreshold } = opts;

    // Schedule filtering
    if (nightly && this.mode === E2EMode.CI) { this._skip(name, 'nightly-only'); return; }
    if (weekly && this.mode !== E2EMode.WEEKLY) { this._skip(name, 'weekly-only'); return; }

    const start = Date.now();
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), this.timeout)),
      ]);

      // Variance warning check
      const vs = result?.varianceScore;
      if (vs !== undefined && varianceThreshold && vs < varianceThreshold) {
        this.warnings++;
        this._sectionWarned++;
        this.results.push({
          name, status: 'WARN', varianceScore: vs,
          duration: Date.now() - start, ...result,
        });
        console.log(`    ⚠️ WARN: ${name} — variance ${vs} < ${varianceThreshold}`);
      } else {
        this.passed++;
        this._sectionPassed++;
        this.results.push({
          name, status: 'PASS', duration: Date.now() - start,
          ...(result || {}),
        });
      }
    } catch (err) {
      this.failed++;
      this._sectionFailed++;
      this.results.push({ name, status: 'FAIL', error: err.message, duration: Date.now() - start });
      console.log(`    ❌ FAIL: ${name} — ${err.message}`);
    }
  }

  /**
   * Quick synchronous assertion test (no async, no timeout).
   */
  assert(name, condition) {
    if (condition) {
      this.passed++;
      this._sectionPassed++;
      this.results.push({ name, status: 'PASS', duration: 0 });
    } else {
      this.failed++;
      this._sectionFailed++;
      this.results.push({ name, status: 'FAIL', error: 'Assertion false', duration: 0 });
      console.log(`    ❌ FAIL: ${name}`);
    }
  }

  _skip(name, reason) {
    this.skipped++;
    this.results.push({ name, status: 'SKIP', reason });
  }

  report() {
    this._flushSection();

    const totalRetries = this.results.flatMap(r => r.retries || []);
    const retryByReason = {};
    for (const r of totalRetries) {
      retryByReason[r.reason] = (retryByReason[r.reason] || 0) + 1;
    }

    const varianceScores = this.results
      .filter(r => r.varianceScore !== undefined)
      .map(r => r.varianceScore);
    const avgVariance = varianceScores.length > 0
      ? Math.round((varianceScores.reduce((a, b) => a + b, 0) / varianceScores.length) * 100) / 100
      : null;

    const durations = this.results.filter(r => r.duration > 0).map(r => r.duration);
    const avgTime = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    const report = {
      timestamp: new Date().toISOString(),
      model: process.env.LLM_MODEL || 'classification-only',
      mode: this.mode,
      total: this.passed + this.warnings + this.failed,
      passed: this.passed,
      warnings: this.warnings,
      failed: this.failed,
      skipped: this.skipped,
      retryBreakdown: retryByReason,
      avgVarianceScore: avgVariance,
      avgResponseTime: avgTime,
      tests: this.results,
    };

    try {
      writeFileSync('e2e-report.json', JSON.stringify(report, null, 2));
    } catch { /* ignore in restricted FS */ }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  E2E: ${this.passed} pass, ${this.warnings} warn, ${this.failed} fail, ${this.skipped} skip`);
    if (avgVariance !== null) console.log(`  Avg variance: ${avgVariance}`);
    if (Object.keys(retryByReason).length > 0) {
      console.log(`  Retries: ${JSON.stringify(retryByReason)}`);
    }
    console.log(`  Duration: ${avgTime}ms avg`);
    console.log(`${'═'.repeat(60)}\n`);

    return report;
  }
}
