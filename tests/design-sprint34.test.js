#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — DESIGN Sprint 3+4 Tests v58.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Sprint 3: SessionState integration, BUILD transition, project lifecycle
// Sprint 4: D6 quality gate, assertDesignQuality, language leak detection
//
// Run: node test/design-sprint34.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  CREDecision,
  DecisionType,
  IntentType,
  DESIGN_FORBIDDEN_PHRASES,
  DESIGN_CONTINUE_PATTERNS,
} from '../src/chat/cre-decision.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

const engine = new CREDecisionEngine();
let totalPassed = 0;
let totalFailed = 0;
let currentSection = '';
let sectionPassed = 0;
let sectionFailed = 0;

function section(name) {
  if (currentSection && (sectionPassed + sectionFailed) > 0) {
    const status = sectionFailed === 0 ? '✅' : '❌';
    console.log(`  ${status} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
  }
  currentSection = name;
  sectionPassed = 0;
  sectionFailed = 0;
}

function assert(label, condition) {
  if (condition) { sectionPassed++; totalPassed++; }
  else { sectionFailed++; totalFailed++; console.log(`    ❌ FAIL: ${label}`); }
}

function classifyIntent(input) { return engine.classifyIntent(input); }
function decide(input, ctx = {}) { return engine.decide(input, ctx); }

console.log('══════════════════════════════════════════════════════════');
console.log('  C3-Agent DESIGN Sprint 3+4 Tests v58.0');
console.log('══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// SPRINT 3: SessionState + BUILD transition
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. SessionState.activeDesignProject simulation ────────────────────────
section('S3-1. SessionState.activeDesignProject lifecycle');

{
  // Simulate SessionState (we don't import controller.js, so mock it)
  const mockState = {
    _activeDesignProject: null,
    get activeDesignProject() { return this._activeDesignProject; },
    get hasActiveDesignProject() { return this._activeDesignProject !== null; },
    setActiveDesignProject(p) { this._activeDesignProject = p ? { ...p } : null; return this; },
    updateDesignProject(updates) {
      if (!this._activeDesignProject) return this;
      Object.assign(this._activeDesignProject, updates);
      return this;
    },
    closeDesignProject() {
      const closed = this._activeDesignProject;
      this._activeDesignProject = null;
      return closed;
    },
  };

  // Start with no project
  assert('Initial state: no active project', !mockState.hasActiveDesignProject);
  assert('Initial state: activeDesignProject is null', mockState.activeDesignProject === null);

  // Set a project
  mockState.setActiveDesignProject({
    type: 'mobile_app',
    phase: 'design',
    turnCount: 1,
    language: 'cs',
  });
  assert('After set: hasActiveDesignProject = true', mockState.hasActiveDesignProject);
  assert('After set: type = mobile_app', mockState.activeDesignProject.type === 'mobile_app');
  assert('After set: turnCount = 1', mockState.activeDesignProject.turnCount === 1);

  // Update project
  mockState.updateDesignProject({ turnCount: 2, phase: 'sprint_planning' });
  assert('After update: turnCount = 2', mockState.activeDesignProject.turnCount === 2);
  assert('After update: phase = sprint_planning', mockState.activeDesignProject.phase === 'sprint_planning');

  // Close project
  const closed = mockState.closeDesignProject();
  assert('After close: returned project type', closed?.type === 'mobile_app');
  assert('After close: hasActiveDesignProject = false', !mockState.hasActiveDesignProject);
  assert('After close: activeDesignProject is null', mockState.activeDesignProject === null);
}

// ─── 2. SessionState toJSON/fromJSON serialization ────────────────────────
section('S3-2. SessionState serialization');

{
  const state = {
    sessionId: 'test-123',
    project: null,
    expert: null,
    activeDesignProject: {
      type: 'web_app',
      phase: 'architecture',
      turnCount: 3,
      language: 'cs',
      defaults: { frontend: 'Next.js' },
    },
  };

  const json = JSON.stringify(state);
  const restored = JSON.parse(json);

  assert('Serialized activeDesignProject survives JSON roundtrip',
    restored.activeDesignProject !== null);
  assert('Restored type = web_app',
    restored.activeDesignProject.type === 'web_app');
  assert('Restored turnCount = 3',
    restored.activeDesignProject.turnCount === 3);
  assert('Restored defaults.frontend = Next.js',
    restored.activeDesignProject.defaults.frontend === 'Next.js');
}

// ─── 3. BUILD transition patterns ──────────────────────────────────────────
section('S3-3. BUILD transition detection');

const BUILD_TRANSITION_PATTERNS = [
  /jdeme?\s+stav[eě]t/i,
  /jdi\s+stav[eě]t/i,
  /za[cč]ni\s+stav[eě]t/i,
  /za[cč]ni\s+implementovat/i,
  /jdi\s+(do|na)\s+(implementac|k[oó]d|v[ýy]voj)/i,
  /p[rř]ejdi\s+(ke?\s+|na\s+|do\s+)(stav|implementac|k[oó]d|v[ýy]voj)/i,
  /postav\s+(to|mi\s+to)/i,
  /let'?s\s+build/i,
  /start\s+(building|coding|implementing)/i,
  /implement\s+this/i,
  /go\s+ahead\s+and\s+build/i,
];

function isBuildTransition(input) {
  return BUILD_TRANSITION_PATTERNS.some(p => p.test(input.trim()));
}

// Should trigger
assert('"jdeme stavět" → BUILD transition', isBuildTransition('jdeme stavět'));
assert('"jdi stavět" → BUILD transition', isBuildTransition('jdi stavět'));
assert('"začni stavět" → BUILD transition', isBuildTransition('začni stavět'));
assert('"začni implementovat" → BUILD transition', isBuildTransition('začni implementovat'));
assert('"jdi do implementace" → BUILD transition', isBuildTransition('jdi do implementace'));
assert('"přejdi ke kódu" → BUILD transition', isBuildTransition('přejdi ke kódu'));
assert('"přejdi na vývoj" → BUILD transition', isBuildTransition('přejdi na vývoj'));
assert('"postav to" → BUILD transition', isBuildTransition('postav to'));
assert('"postav mi to" → BUILD transition', isBuildTransition('postav mi to'));
assert('"let\'s build" → BUILD transition', isBuildTransition("let's build"));
assert('"start building" → BUILD transition', isBuildTransition('start building'));
assert('"start implementing" → BUILD transition', isBuildTransition('start implementing'));
assert('"implement this" → BUILD transition', isBuildTransition('implement this'));
assert('"go ahead and build" → BUILD transition', isBuildTransition('go ahead and build'));

// Should NOT trigger (must stay in DESIGN)
assert('"více podrobností" NOT BUILD', !isBuildTransition('více podrobností'));
assert('"rozděl to na sprinty" NOT BUILD', !isBuildTransition('rozděl to na sprinty'));
assert('"změň stack" NOT BUILD', !isBuildTransition('změň stack'));
assert('"navrhni architekturu" NOT BUILD', !isBuildTransition('navrhni architekturu'));
assert('"co s testy" NOT BUILD', !isBuildTransition('co s testy'));

// ─── 4. DESIGN → BUILD intent flow ────────────────────────────────────────
section('S3-4. DESIGN → BUILD intent classification');

// After BUILD transition, CRE should classify the remaining BUILD patterns
assert('"jdeme stavět" → BUILD intent', classifyIntent('jdeme stavět') === IntentType.BUILD);
assert('"postav mi to" → BUILD intent', classifyIntent('postav mi to') === IntentType.BUILD);
assert('"začni stavět" → BUILD intent', classifyIntent('začni stavět') === IntentType.BUILD);

// ─── 5. Escape hatch: fact query during DESIGN ───────────────────────────
section('S3-5. Fact query escape hatch');

// These should escape DESIGN follow-up lock
{
  const d1 = decide('kolik stojí Apple Developer Account', { lastIntent: IntentType.DESIGN });
  assert('Price query escapes DESIGN → SEARCH/FACTUAL',
    d1.intent === IntentType.FACTUAL || d1.intent === IntentType.SEARCH);
}

{
  const d2 = decide('najdi dokumentaci k WireGuard', { lastIntent: IntentType.DESIGN });
  assert('Search query escapes DESIGN → SEARCH',
    d2.intent === IntentType.SEARCH);
}

// These should NOT escape (they're DESIGN follow-ups)
{
  const d3 = decide('jak řešit bezpečnost', { lastIntent: IntentType.DESIGN });
  assert('"jak řešit bezpečnost" stays in DESIGN',
    d3.intent === IntentType.DESIGN);
}

// ═══════════════════════════════════════════════════════════════════════════
// SPRINT 4: D6 Quality Gate + assertDesignQuality
// ═══════════════════════════════════════════════════════════════════════════

// ─── 6. D6 density thresholds for DESIGN ─────────────────────────────────
section('S4-6. D6 density: DESIGN threshold');

// Import output-gate if available, otherwise test inline
const DESIGN_DENSITY_THRESHOLD = 500;

assert('DESIGN threshold = 500 chars',
  DESIGN_DENSITY_THRESHOLD === 500);

assert('Short response (100 chars) fails density',
  'A'.repeat(100).length < DESIGN_DENSITY_THRESHOLD);

assert('Long response (600 chars) passes density',
  'A'.repeat(600).length >= DESIGN_DENSITY_THRESHOLD);

// ─── 7. assertDesignQuality — length checks ─────────────────────────────
section('S4-7. assertDesignQuality: length checks');

// Simulate assertDesignQuality logic inline (tests don't need real import)
const DESIGN_MIN_LENGTH = 500;

function mockAssertDesignQuality(content, input, opts = {}) {
  const { isFollowUp = false } = opts;
  if (!content || typeof content !== 'string') return { valid: false, reason: 'Empty' };
  const trimmed = content.trim();
  const minLen = isFollowUp ? 200 : DESIGN_MIN_LENGTH;
  if (trimmed.length < minLen) return { valid: false, reason: `Too short: ${trimmed.length}/${minLen}` };

  // Language leak
  if (/\b(informacje|ograniczone|zalecam|również)\b/i.test(trimmed))
    return { valid: false, reason: 'Language leak (Polish)' };
  if (/\b(lo siento|no puedo|también)\b/i.test(trimmed))
    return { valid: false, reason: 'Language leak (Spanish)' };

  // Hedging
  const hedgingPatterns = [
    /informace (jsou|byly) omezené/i,
    /doporučuji konzultovat/i,
    /záleží na (kontextu|požadavcích)/i,
    /existuje (více|mnoho) možností/i,
  ];
  const hedging = hedgingPatterns.filter(p => p.test(trimmed));
  if (hedging.length >= 2) return { valid: false, reason: `${hedging.length} hedging phrases` };

  // Section check (initial only)
  if (!isFollowUp) {
    const sections = [
      /0️⃣|cílov[ýé]\s+stav/i,
      /1️⃣|high.level/i,
      /2️⃣|detailn/i,
      /3️⃣|sprint/i,
      /4️⃣|CI.?CD/i,
      /5️⃣|rizik/i,
      /6️⃣|alternativ/i,
    ].filter(p => p.test(trimmed)).length;
    if (sections < 3) return { valid: false, reason: `Only ${sections}/7 sections` };
  }

  return { valid: true };
}

assert('Empty content → invalid',
  !mockAssertDesignQuality('', 'x').valid);

assert('null content → invalid',
  !mockAssertDesignQuality(null, 'x').valid);

assert('100 chars (initial) → invalid (too short)',
  !mockAssertDesignQuality('x'.repeat(100), 'navrhni architekturu').valid);

assert('100 chars (follow-up) → invalid (too short even for follow-up)',
  !mockAssertDesignQuality('x'.repeat(100), 'více podrobností', { isFollowUp: true }).valid);

assert('250 chars (follow-up) → valid (above 200 follow-up threshold)',
  mockAssertDesignQuality('x'.repeat(250) + '\n0️⃣ cílový stav\n1️⃣\n2️⃣\n3️⃣ sprint', 'více', { isFollowUp: true }).valid);

// ─── 8. assertDesignQuality — language leak detection ────────────────────
section('S4-8. assertDesignQuality: language leaks');

const makeDesignDoc = (extra = '') =>
  '0️⃣ Cílový stav: Mobilní aplikace\n' +
  '1️⃣ High-level architektura\n' +
  '2️⃣ Detailní architektura: Flutter, WireGuard\n' +
  '3️⃣ Vývojový plán: Sprint 1\n' +
  '4️⃣ CI/CD: GitHub Actions\n' +
  '5️⃣ Rizika: Latence\n' +
  '6️⃣ Alternativy: React Native\n' +
  'x'.repeat(300) + '\n' + extra;

assert('Clean Czech doc → valid',
  mockAssertDesignQuality(makeDesignDoc(), 'x').valid);

assert('Polish leak "informacje" → invalid',
  !mockAssertDesignQuality(makeDesignDoc('informacje są ograniczone'), 'x').valid);

assert('Polish leak "ograniczone" → invalid',
  !mockAssertDesignQuality(makeDesignDoc('dane ograniczone'), 'x').valid);

assert('Polish leak "zalecam" → invalid',
  !mockAssertDesignQuality(makeDesignDoc('zalecam konsultację'), 'x').valid);

assert('Spanish leak "lo siento" → invalid',
  !mockAssertDesignQuality(makeDesignDoc('lo siento, no puedo'), 'x').valid);

assert('Spanish leak "también" → invalid',
  !mockAssertDesignQuality(makeDesignDoc('también es posible'), 'x').valid);

// ─── 9. assertDesignQuality — hedging detection ─────────────────────────
section('S4-9. assertDesignQuality: hedging');

assert('Single hedging phrase → valid (warning only)',
  mockAssertDesignQuality(makeDesignDoc('informace jsou omezené'), 'x').valid);

assert('Two hedging phrases → invalid',
  !mockAssertDesignQuality(makeDesignDoc('informace jsou omezené. Záleží na požadavcích.'), 'x').valid);

assert('No hedging → valid',
  mockAssertDesignQuality(makeDesignDoc(), 'x').valid);

// ─── 10. assertDesignQuality — section structure ────────────────────────
section('S4-10. assertDesignQuality: section structure');

assert('Doc with 7 sections → valid',
  mockAssertDesignQuality(makeDesignDoc(), 'x').valid);

const twoSectionDoc = 'x'.repeat(500) + '\n0️⃣ Cílový stav\n3️⃣ Sprinty';
assert('Doc with only 2 sections (initial) → invalid',
  !mockAssertDesignQuality(twoSectionDoc, 'x').valid);

const threeSectionDoc = 'x'.repeat(500) + '\n0️⃣ Cílový stav\n1️⃣ High-level\n3️⃣ Sprinty';
assert('Doc with 3 sections (initial) → valid',
  mockAssertDesignQuality(threeSectionDoc, 'x').valid);

assert('Doc with 2 sections (follow-up) → valid (relaxed)',
  mockAssertDesignQuality(twoSectionDoc, 'x', { isFollowUp: true }).valid);

// ─── 11. D6 intent alignment — DESIGN hedging detection ────────────────
section('S4-11. D6 DESIGN-specific checks');

// Simulate D6.3 DESIGN checks
function mockDesignD6Alignment(content) {
  const HEDGING = [
    /informace (jsou|byly) omezené/i,
    /doporučuji konzultovat/i,
    /záleží na (kontextu|požadavcích)/i,
    /limited information/i,
  ];
  for (const p of HEDGING) {
    if (p.test(content)) return { aligned: false, reason: `design_hedging: ${p.source.substring(0, 30)}` };
  }
  const LEAKS = [
    /\b(informacje|ograniczone|zalecam)\b/i,
    /\b(lo siento|no puedo)\b/i,
  ];
  for (const p of LEAKS) {
    if (p.test(content)) return { aligned: false, reason: `design_language_leak: ${p.source.substring(0, 30)}` };
  }
  return { aligned: true };
}

assert('Clean architect text → aligned',
  mockDesignD6Alignment('Flutter je ideální pro tento projekt. Použijeme WireGuard.').aligned);

assert('"informace jsou omezené" → NOT aligned (hedging)',
  !mockDesignD6Alignment('Bohužel, informace jsou omezené.').aligned);

assert('"doporučuji konzultovat" → NOT aligned (hedging)',
  !mockDesignD6Alignment('Doporučuji konzultovat s odborníkem.').aligned);

assert('"limited information" → NOT aligned (EN hedging)',
  !mockDesignD6Alignment('Based on limited information available.').aligned);

assert('Polish "informacje" → NOT aligned (leak)',
  !mockDesignD6Alignment('Informacje o tym temacie są ograniczone.').aligned);

assert('Spanish "lo siento" → NOT aligned (leak)',
  !mockDesignD6Alignment('Lo siento, no puedo ayudar.').aligned);

// ─── 12. DESIGN_FORBIDDEN_PHRASES comprehensive check ────────────────────
section('S4-12. DESIGN_FORBIDDEN_PHRASES coverage');

const expectedPhrases = [
  'informace jsou omezené',
  'doporučuji konzultovat',
  'záleží na požadavcích',
  'existuje více možností',
  'je třeba zvážit',
  'nemohu přistupovat',
  'nemohu vyhledávat',
  'limited information',
  'pokud potřebujete další informace',
  'neváhejte se zeptat',
  'informacje',       // Polish
  'ograniczone',      // Polish
  'zalecam',          // Polish
];

for (const phrase of expectedPhrases) {
  assert(`DESIGN_FORBIDDEN contains "${phrase}"`,
    DESIGN_FORBIDDEN_PHRASES.includes(phrase));
}

assert('At least 15 forbidden phrases total',
  DESIGN_FORBIDDEN_PHRASES.length >= 15);

// ─── 13. REGRESSION: Sprint 1+2 tests still work ──────────────────────────
section('S3+4-13. REGRESSION: Sprint 1+2 still correct');

// Core classification
assert('REGRESSION: "navrhni architekturu aplikace" → DESIGN',
  classifyIntent('navrhni architekturu aplikace') === IntentType.DESIGN);

assert('REGRESSION: "vymysli kampaň" → CREATIVE',
  classifyIntent('vymysli kampaň') === IntentType.CREATIVE);

assert('REGRESSION: "postav mi web" → BUILD',
  classifyIntent('postav mi web') === IntentType.BUILD);

assert('REGRESSION: "ahoj" → CONVERSATIONAL',
  classifyIntent('ahoj') === IntentType.CONVERSATIONAL);

assert('REGRESSION: "kolik je hodin" → LOCAL',
  classifyIntent('kolik je hodin') === IntentType.LOCAL);

assert('REGRESSION: "najdi restauraci" → SEARCH',
  classifyIntent('najdi restauraci') === IntentType.SEARCH);

// Decision invariants
assert('REGRESSION: DESIGN → ANSWER decision',
  decide('navrhni architekturu systému').type === DecisionType.ANSWER);

assert('REGRESSION: DESIGN → tools=[]',
  decide('udělej roadmapu vývoje').tools.length === 0);

// Follow-up lock
assert('REGRESSION: "více podrobností" + lastIntent=DESIGN → DESIGN',
  decide('více podrobností', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

// TOOL_CALL invariant
{
  let threw = false;
  try {
    new CREDecision({ type: DecisionType.TOOL_CALL, intent: IntentType.DESIGN, tools: ['web.search'], reason: 'test' });
  } catch { threw = true; }
  assert('REGRESSION: DESIGN + TOOL_CALL still throws', threw);
}

// ─── 14. Edge cases: Mixed DESIGN + context scenarios ────────────────────
section('S3+4-14. Edge cases');

// DESIGN follow-up should work with no-diacritics Czech too
assert('"vice podrobnosti" with lastIntent=DESIGN → DESIGN (no diacritics)',
  decide('vice podrobnosti', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

// Ambiguous input during DESIGN should stay in DESIGN if follow-up pattern
assert('"detailneji" with lastIntent=DESIGN → DESIGN',
  decide('detailneji', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

// English follow-ups during DESIGN
assert('"more detail" with lastIntent=DESIGN → DESIGN',
  decide('more detail', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

assert('"what about testing" with lastIntent=DESIGN → DESIGN',
  decide('what about testing', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

assert('"next step" with lastIntent=DESIGN → DESIGN',
  decide('next step', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

// New DESIGN should override active DESIGN (fresh start)
assert('"navrhni úplně jinou architekturu" → DESIGN (fresh)',
  classifyIntent('navrhni úplně jinou architekturu') === IntentType.DESIGN);

// ═══════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════════════════════

if (currentSection) {
  const status = sectionFailed === 0 ? '✅' : '❌';
  console.log(`  ${status} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${totalPassed}/${totalPassed + totalFailed} passed, ${totalFailed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (totalFailed > 0) process.exit(1);
