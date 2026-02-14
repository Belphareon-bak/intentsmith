#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — CRE Gatekeeper Tests v64.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests CRE Gatekeeper single-authority enforcement:
//   - overrideDecision() creates valid CREDecision with audit metadata
//   - logIntercept() records intercepts with audit trail
//   - getAuditStats() returns correct counters
//   - bindAuditDb() enables DB persistence
//   - Invariant enforcement: overrideDecision() respects CREDecision invariants
//   - Migration 005 creates cre_override_log table
//
// Run: node tests/cre-gatekeeper.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  CREDecision,
  IntentType,
  DecisionType,
} from '../src/chat/cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner (same pattern as cre-comprehensive.test.js)
// ─────────────────────────────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];
const sectionStats = {};
let currentSection = '';

function section(name) {
  currentSection = name;
  sectionStats[name] = { total: 0, passed: 0, failed: 0 };
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

function t(name, fn) {
  total++;
  sectionStats[currentSection].total++;
  try {
    fn();
    passed++;
    sectionStats[currentSection].passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    sectionStats[currentSection].failed++;
    const msg = `❌ ${name}: ${err.message}`;
    console.log(`  ${msg}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} — expected "${expected}", got "${actual}"`);
  }
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: overrideDecision() — basic functionality
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK1: overrideDecision() — basic');

t('Returns CREDecision instance', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test',
    reason: 'test override',
  });
  ok(d instanceof CREDecision, 'should be CREDecision instance');
  eq(d.type, DecisionType.ANSWER);
  eq(d.intent, IntentType.CONVERSATIONAL);
});

t('Sets override metadata', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CREATIVE,
    source: 'reformulation',
    reason: 'Replay CREATIVE',
    metadata: { reformulation: true },
  });
  eq(d.metadata.override, true);
  eq(d.metadata.overrideSource, 'reformulation');
  eq(d.metadata.overrideReason, 'Replay CREATIVE');
  eq(d.metadata.reformulation, true);
});

t('Carries original decision in metadata', () => {
  const engine = new CREDecisionEngine();
  const original = new CREDecision({
    type: DecisionType.TOOL_CALL,
    intent: IntentType.SEARCH,
    tools: ['web.search'],
    reason: 'original',
  });
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'first_turn_override',
    reason: 'Vague input',
    originalDecision: original,
  });
  ok(d.metadata.originalDecision, 'should have originalDecision in metadata');
  eq(d.metadata.originalDecision.intent, IntentType.SEARCH);
  eq(d.metadata.originalDecision.type, DecisionType.TOOL_CALL);
});

t('Uses default confidence 0.85', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test',
    reason: 'test',
  });
  eq(d.confidence, 0.85);
});

t('Custom confidence is preserved', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test',
    reason: 'test',
    confidence: 0.5,
  });
  eq(d.confidence, 0.5);
});

t('TOOL_CALL override with tools', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.TOOL_CALL,
    intent: IntentType.SEARCH,
    tools: ['web.search'],
    source: 'clarification_resolved',
    reason: 'test',
  });
  eq(d.type, DecisionType.TOOL_CALL);
  eq(d.tools.length, 1);
  eq(d.tools[0], 'web.search');
});

t('LOCAL override', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.LOCAL,
    intent: IntentType.LOCAL,
    source: 'clarification_local_request',
    reason: 'User requested local response',
  });
  eq(d.type, DecisionType.LOCAL);
  eq(d.intent, IntentType.LOCAL);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: overrideDecision() — invariant enforcement
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK2: overrideDecision() — invariants');

t('Throws for ANSWER + SEARCH (invariant violation)', () => {
  const engine = new CREDecisionEngine();
  let threw = false;
  try {
    engine.overrideDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.SEARCH,
      source: 'test',
      reason: 'should fail',
    });
  } catch (e) {
    threw = true;
    ok(e.message.includes('ANSWER_NOT_ALLOWED'), `Expected ANSWER_NOT_ALLOWED, got: ${e.message}`);
  }
  ok(threw, 'should throw for ANSWER + SEARCH');
});

t('Throws for TOOL_CALL + CREATIVE (invariant violation)', () => {
  const engine = new CREDecisionEngine();
  let threw = false;
  try {
    engine.overrideDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.CREATIVE,
      tools: ['web.search'],
      source: 'test',
      reason: 'should fail',
    });
  } catch (e) {
    threw = true;
    ok(e.message.includes('CREATIVE'), `Expected CREATIVE violation, got: ${e.message}`);
  }
  ok(threw, 'should throw for TOOL_CALL + CREATIVE');
});

t('Throws for TOOL_CALL + LOCAL (invariant violation)', () => {
  const engine = new CREDecisionEngine();
  let threw = false;
  try {
    engine.overrideDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.LOCAL,
      tools: ['web.search'],
      source: 'test',
      reason: 'should fail',
    });
  } catch (e) {
    threw = true;
    ok(e.message.includes('LOCAL'), `Expected LOCAL violation, got: ${e.message}`);
  }
  ok(threw, 'should throw for TOOL_CALL + LOCAL');
});

t('Throws for PLAN + non-BUILD (invariant violation)', () => {
  const engine = new CREDecisionEngine();
  let threw = false;
  try {
    engine.overrideDecision({
      type: DecisionType.PLAN,
      intent: IntentType.SEARCH,
      source: 'test',
      reason: 'should fail',
    });
  } catch (e) {
    threw = true;
    ok(e.message.includes('BUILD'), `Expected BUILD violation, got: ${e.message}`);
  }
  ok(threw, 'should throw for PLAN + non-BUILD');
});

t('Allows ANSWER + DESIGN (valid combination)', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.DESIGN,
    source: 'design_continue',
    reason: 'test',
  });
  eq(d.type, DecisionType.ANSWER);
  eq(d.intent, IntentType.DESIGN);
});

t('Allows ANSWER + CODE (valid combination)', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CODE,
    source: 'test',
    reason: 'test',
  });
  eq(d.type, DecisionType.ANSWER);
  eq(d.intent, IntentType.CODE);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: logIntercept()
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK3: logIntercept()');

t('Increments intercept counter', () => {
  const engine = new CREDecisionEngine();
  eq(engine._interceptCount, 0);
  engine.logIntercept('session_resume', 'test', {});
  eq(engine._interceptCount, 1);
  engine.logIntercept('agent_wizard', 'test', {});
  eq(engine._interceptCount, 2);
});

t('Records intercept in log', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('lifecycle_handoff', 'Active lifecycle', { sessionId: 's1' });
  eq(engine._interceptLog.length, 1);
  eq(engine._interceptLog[0].source, 'lifecycle_handoff');
  eq(engine._interceptLog[0].reason, 'Active lifecycle');
  ok(engine._interceptLog[0].timestamp > 0, 'should have timestamp');
});

t('Respects max log entries', () => {
  const engine = new CREDecisionEngine();
  engine._maxLogEntries = 3;
  for (let i = 0; i < 5; i++) {
    engine.logIntercept(`source_${i}`, `reason_${i}`, {});
  }
  eq(engine._interceptLog.length, 3);
  eq(engine._interceptLog[0].source, 'source_2');
  eq(engine._interceptLog[2].source, 'source_4');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: getAuditStats()
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK4: getAuditStats()');

t('Returns correct counts', () => {
  const engine = new CREDecisionEngine();
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'a', reason: 'r',
  });
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CREATIVE,
    source: 'b', reason: 'r',
  });
  engine.logIntercept('c', 'r');
  const stats = engine.getAuditStats();
  eq(stats.overrideCount, 2);
  eq(stats.interceptCount, 1);
  eq(stats.recentOverrides.length, 2);
  eq(stats.recentIntercepts.length, 1);
});

t('Returns copies (not mutable references)', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('test', 'test');
  const stats = engine.getAuditStats();
  stats.recentIntercepts.push({ fake: true });
  eq(engine._interceptLog.length, 1, 'internal log should not be affected');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Override audit trail — _logOverride
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK5: Override audit trail');

t('Increments override counter', () => {
  const engine = new CREDecisionEngine();
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test', reason: 'test',
  });
  eq(engine._overrideCount, 1);
});

t('Records override details', () => {
  const engine = new CREDecisionEngine();
  const original = new CREDecision({
    type: DecisionType.TOOL_CALL,
    intent: IntentType.SEARCH,
    tools: ['web.search'],
    reason: 'original',
  });
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'first_turn_vague_input',
    reason: 'Vague first turn',
    originalDecision: original,
  });
  eq(engine._overrideLog.length, 1);
  const entry = engine._overrideLog[0];
  eq(entry.source, 'first_turn_vague_input');
  eq(entry.reason, 'Vague first turn');
  eq(entry.type, DecisionType.ANSWER);
  eq(entry.intent, IntentType.CONVERSATIONAL);
  eq(entry.originalType, DecisionType.TOOL_CALL);
  eq(entry.originalIntent, IntentType.SEARCH);
});

t('Respects max override log entries', () => {
  const engine = new CREDecisionEngine();
  engine._maxLogEntries = 2;
  for (let i = 0; i < 4; i++) {
    engine.overrideDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      source: `s_${i}`, reason: `r_${i}`,
    });
  }
  eq(engine._overrideLog.length, 2);
  eq(engine._overrideLog[0].source, 's_2');
  eq(engine._overrideLog[1].source, 's_3');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: bindAuditDb() — DB persistence
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK6: bindAuditDb()');

t('DB insert called on override', () => {
  const engine = new CREDecisionEngine();
  let insertCalled = false;
  let insertArgs = null;
  engine.bindAuditDb({
    insert: {
      run(...args) {
        insertCalled = true;
        insertArgs = args;
      },
    },
  });
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test_source',
    reason: 'test_reason',
    confidence: 0.7,
  });
  ok(insertCalled, 'insert.run should be called');
  eq(insertArgs[0], 'override');      // event_type
  eq(insertArgs[1], 'test_source');   // source
  eq(insertArgs[2], 'test_reason');   // reason
  eq(insertArgs[3], 'ANSWER');        // decision_type
  eq(insertArgs[4], 'CONVERSATIONAL'); // decision_intent
});

t('DB insert called on intercept', () => {
  const engine = new CREDecisionEngine();
  let insertCalled = false;
  let insertArgs = null;
  engine.bindAuditDb({
    insert: {
      run(...args) {
        insertCalled = true;
        insertArgs = args;
      },
    },
  });
  engine.logIntercept('lifecycle_handoff', 'Active lifecycle', { sessionId: 'sess1' });
  ok(insertCalled, 'insert.run should be called');
  eq(insertArgs[0], 'intercept');          // event_type
  eq(insertArgs[1], 'lifecycle_handoff');   // source
  eq(insertArgs[2], 'Active lifecycle');    // reason
  eq(insertArgs[3], null);                 // decision_type (none for intercept)
  eq(insertArgs[4], null);                 // decision_intent (none for intercept)
});

t('DB errors do not throw', () => {
  const engine = new CREDecisionEngine();
  engine.bindAuditDb({
    insert: {
      run() { throw new Error('DB failure'); },
    },
  });
  // Should not throw
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test', reason: 'test',
  });
  engine.logIntercept('test', 'test');
  eq(engine._overrideCount, 1);
  eq(engine._interceptCount, 1);
});

t('No DB bound — works without errors', () => {
  const engine = new CREDecisionEngine();
  // No bindAuditDb called
  engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test', reason: 'test',
  });
  engine.logIntercept('test', 'test');
  eq(engine._overrideCount, 1);
  eq(engine._interceptCount, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Override source coverage
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK7: Override source coverage');

t('first_turn_vague_input override', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'first_turn_vague_input',
    reason: 'First turn vague input',
    confidence: 0.6,
  });
  eq(d.metadata.overrideSource, 'first_turn_vague_input');
});

t('first_turn_ask_user override', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CREATIVE,
    source: 'first_turn_ask_user',
    reason: 'First turn ideation',
  });
  eq(d.metadata.overrideSource, 'first_turn_ask_user');
  eq(d.intent, IntentType.CREATIVE);
});

t('reformulation override', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.TOOL_CALL,
    intent: IntentType.SEARCH,
    tools: ['web.search'],
    source: 'reformulation',
    reason: 'Replay SEARCH',
  });
  eq(d.metadata.overrideSource, 'reformulation');
  eq(d.type, DecisionType.TOOL_CALL);
});

t('design_continue override', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.DESIGN,
    source: 'design_continue',
    reason: 'Active design follow-up',
  });
  eq(d.metadata.overrideSource, 'design_continue');
  eq(d.intent, IntentType.DESIGN);
});

t('clarification_resolved override', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.TOOL_CALL,
    intent: IntentType.REPORT,
    tools: ['web.search', 'web.scrape'],
    source: 'clarification_resolved',
    reason: 'Clarified intent: REPORT',
  });
  eq(d.metadata.overrideSource, 'clarification_resolved');
  eq(d.intent, IntentType.REPORT);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Intercept source coverage
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK8: Intercept source coverage');

t('session_resume intercept', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('session_resume', 'User requesting session resume');
  const stats = engine.getAuditStats();
  eq(stats.recentIntercepts[0].source, 'session_resume');
});

t('build_handoff intercept', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('build_handoff', 'Active build handoff', { phase: 'PROPOSED' });
  const stats = engine.getAuditStats();
  eq(stats.recentIntercepts[0].source, 'build_handoff');
  eq(stats.recentIntercepts[0].phase, 'PROPOSED');
});

t('lifecycle_handoff intercept', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('lifecycle_handoff', 'Active lifecycle', { phase: 'BUILDING' });
  eq(engine._interceptLog[0].source, 'lifecycle_handoff');
});

t('agent_wizard intercept', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('agent_wizard', 'Active wizard');
  eq(engine._interceptLog[0].source, 'agent_wizard');
});

t('date_correction intercept', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('date_correction', 'User correcting date');
  eq(engine._interceptLog[0].source, 'date_correction');
});

t('progress_inquiry intercept', () => {
  const engine = new CREDecisionEngine();
  engine.logIntercept('progress_inquiry', 'User asking about progress');
  eq(engine._interceptLog[0].source, 'progress_inquiry');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Migration 005 — cre_override_log table
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK9: Migration 005');

t('Migration has correct version', async () => {
  const migration = await import('../src/db/migrations/2026_02_14_005_v64_cre_override_log.js');
  eq(migration.version, '2026_02_14_005_v64_cre_override_log');
});

t('Migration has up function', async () => {
  const migration = await import('../src/db/migrations/2026_02_14_005_v64_cre_override_log.js');
  eq(typeof migration.up, 'function');
});

t('Migration creates table on fresh DB', async () => {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(':memory:');
  const migration = await import('../src/db/migrations/2026_02_14_005_v64_cre_override_log.js');
  migration.up(db);

  // Table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cre_override_log'").all();
  eq(tables.length, 1, 'cre_override_log table should exist');

  // Insert works
  db.prepare(`
    INSERT INTO cre_override_log (event_type, source, reason, decision_type, decision_intent)
    VALUES ('override', 'test', 'test reason', 'ANSWER', 'CONVERSATIONAL')
  `).run();

  const rows = db.prepare('SELECT * FROM cre_override_log').all();
  eq(rows.length, 1);
  eq(rows[0].event_type, 'override');
  eq(rows[0].source, 'test');
  eq(rows[0].decision_type, 'ANSWER');

  db.close();
});

t('Migration is idempotent', async () => {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(':memory:');
  const migration = await import('../src/db/migrations/2026_02_14_005_v64_cre_override_log.js');
  migration.up(db);
  migration.up(db); // second run should not throw
  db.close();
});

t('Indexes are created', async () => {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(':memory:');
  const migration = await import('../src/db/migrations/2026_02_14_005_v64_cre_override_log.js');
  migration.up(db);

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cre_override_log'").all();
  const indexNames = indexes.map(i => i.name);
  ok(indexNames.includes('idx_cre_override_trace'), 'should have trace index');
  ok(indexNames.includes('idx_cre_override_conv'), 'should have conv index');
  ok(indexNames.includes('idx_cre_override_source'), 'should have source index');
  ok(indexNames.includes('idx_cre_override_type'), 'should have type index');

  db.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: toJSON() on override decisions
// ═══════════════════════════════════════════════════════════════════════════════

section('T-GK10: toJSON() compatibility');

t('Override decisions have toJSON()', () => {
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test',
    reason: 'test',
  });
  ok(typeof d.toJSON === 'function', 'should have toJSON');
  const json = d.toJSON();
  eq(json.type, DecisionType.ANSWER);
  eq(json.intent, IntentType.CONVERSATIONAL);
  ok(json.metadata.override === true, 'JSON should include override flag');
});

t('Override decisions pass assertDecision()', async () => {
  const { assertDecision } = await import('../src/chat/cre-decision.js');
  const engine = new CREDecisionEngine();
  const d = engine.overrideDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    source: 'test',
    reason: 'test',
  });
  ok(assertDecision(d), 'assertDecision should pass');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  CRE Gatekeeper Tests — Results`);
console.log(`${'═'.repeat(60)}`);
console.log();

for (const [name, stats] of Object.entries(sectionStats)) {
  const status = stats.failed === 0 ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m';
  console.log(`  ${status} ${name}: ${stats.passed}/${stats.total}`);
}

console.log();
console.log(`  Total: ${passed}/${total} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log(`\n\x1b[31m  FAILURES:\x1b[0m`);
  for (const f of failures) {
    console.log(`    [${f.section}] ${f.name}: ${f.error}`);
  }
}

console.log();
process.exit(failed > 0 ? 1 : 0);
