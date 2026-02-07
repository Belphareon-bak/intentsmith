#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent v57.2 — Trust Feedback Loop Tests (Self-contained, mock DB)
// ═══════════════════════════════════════════════════════════════════════════════
// Run: node tests/trust-feedback.test.js

let passed = 0, failed = 0;
const failures = [];
function ok(n) { passed++; console.log(`  ✅ ${n}`); }
function fail(n, e) { failed++; failures.push({n, m: e?.message||String(e)}); console.log(`  ❌ ${n}: ${e?.message||e}`); }
async function test(n, fn) { try { await fn(); ok(n); } catch(e) { fail(n, e); } }
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }

// ─── Config ──────────────────────────────────────────────────────────────────
const TRUST_CONFIG = { windowDays: 30, minFeedbackCount: 5, degradeToDigestThreshold: 0.3, autoMuteThreshold: 0.1 };

// ─── Mock DB (in-memory tables) ──────────────────────────────────────────────
function createDB() {
  const logs = [];       // notification_log_v57
  const states = [];     // notification_state_v57
  const actions = [];    // notification_trust_actions_v57
  let autoId = 0;
  return {
    insertLog(agentId, title = 'Test') {
      const id = ++autoId;
      logs.push({ id, agent_id: agentId, title, delivered: 1, created_at: new Date().toISOString(), useful: null, feedback_at: null });
      return id;
    },
    setFeedback(id, useful) {
      const r = logs.find(l => l.id === id);
      if (r) { r.useful = useful ? 1 : 0; r.feedback_at = new Date().toISOString(); return true; }
      return false;
    },
    getLog(id) { return logs.find(l => l.id === id); },
    getAgentLogs(agentId) {
      const cutoff = new Date(Date.now() - TRUST_CONFIG.windowDays * 86400000).toISOString();
      return logs.filter(l => l.agent_id === agentId && l.delivered === 1 && l.created_at >= cutoff);
    },
    setState(agentId, mutedUntil, reason) {
      const existing = states.find(s => s.agent_id === agentId);
      if (existing) { existing.muted_until = mutedUntil; existing.auto_mute_reason = reason; }
      else states.push({ agent_id: agentId, muted_until: mutedUntil, auto_mute_reason: reason });
    },
    getState(agentId) { return states.find(s => s.agent_id === agentId); },
    clearMute(agentId) {
      const s = states.find(s => s.agent_id === agentId);
      if (s) { s.muted_until = null; s.auto_mute_reason = null; }
    },
    logAction(agentId, action) { actions.push({ agent_id: agentId, action, created_at: new Date().toISOString() }); },
    getLastAction(agentId) { return [...actions].reverse().find(a => a.agent_id === agentId); },
    clearFeedback(agentId) { for (const l of logs) { if (l.agent_id === agentId) { l.useful = null; l.feedback_at = null; } } },
    allAgentIds() { return [...new Set(logs.filter(l => l.delivered === 1).map(l => l.agent_id))]; },
    _logs: logs, _states: states, _actions: actions,
  };
}

// ─── TrustTracker (logic extracted, uses mock DB API) ────────────────────────
class TrustTracker {
  constructor(db) { this.db = db; }

  getMetrics(agentId) {
    const logs = this.db.getAgentLogs(agentId);
    const withFb = logs.filter(l => l.useful !== null);
    const useful = withFb.filter(l => l.useful === 1).length;
    const notUseful = withFb.filter(l => l.useful === 0).length;
    const ratio = withFb.length > 0 ? useful / withFb.length : NaN;
    const lastSent = logs.length > 0 ? logs[logs.length - 1].created_at : null;
    const silenceDays = lastSent ? Math.floor((Date.now() - new Date(lastSent).getTime()) / 86400000) : 0;

    let trustLevel, shouldDegrade = false, shouldMute = false;
    if (withFb.length < TRUST_CONFIG.minFeedbackCount) {
      trustLevel = 'insufficient_data';
    } else if (ratio >= TRUST_CONFIG.degradeToDigestThreshold) {
      trustLevel = 'healthy';
    } else if (ratio >= TRUST_CONFIG.autoMuteThreshold) {
      trustLevel = 'degraded'; shouldDegrade = true;
    } else {
      trustLevel = 'critical'; shouldMute = true;
    }

    return { agentId, totalSent: logs.length, totalFeedback: withFb.length, useful, notUseful,
             noFeedback: logs.length - withFb.length, usefulRatio: ratio, trustLevel,
             lastSentAt: lastSent, silenceDays, shouldDegrade, shouldMute };
  }

  recordFeedback(notifId, isUseful) {
    if (!this.db.setFeedback(notifId, isUseful)) return { success: false };
    const log = this.db.getLog(notifId);
    if (!log) return { success: false };
    const metrics = this.getMetrics(log.agent_id);
    const action = this.#evaluateAuto(log.agent_id, metrics);
    return { success: true, metrics, action };
  }

  getTrustOverride(agentId) {
    const m = this.getMetrics(agentId);
    if (m.shouldMute) return { override: 'drop', reason: `ratio=${m.usefulRatio.toFixed(2)}` };
    if (m.shouldDegrade) return { override: 'digest', reason: `ratio=${m.usefulRatio.toFixed(2)}` };
    return { override: null, reason: null };
  }

  getAllMetrics() { return this.db.allAgentIds().map(id => this.getMetrics(id)); }
  unmute(agentId) { this.db.clearMute(agentId); this.db.logAction(agentId, 'manual_unmute'); }
  resetFeedback(agentId) { this.db.clearFeedback(agentId); }

  #evaluateAuto(agentId, metrics) {
    if (metrics.trustLevel === 'insufficient_data') return null;
    const last = this.db.getLastAction(agentId);
    if (metrics.shouldMute) {
      if (last?.action === 'auto_muted') return null;
      this.db.logAction(agentId, 'auto_muted');
      this.db.setState(agentId, new Date(Date.now() + 7 * 86400000).toISOString(), 'low_trust_ratio');
      return 'auto_muted';
    }
    if (metrics.shouldDegrade) {
      if (last?.action === 'degraded_to_digest') return null;
      this.db.logAction(agentId, 'degraded_to_digest');
      return 'degraded_to_digest';
    }
    if (metrics.trustLevel === 'healthy' && last?.action) {
      this.db.logAction(agentId, 'recovered');
      return 'recovered';
    }
    return null;
  }
}

// ─── Feedback parsing (standalone) ──────────────────────────────────────────
function parseFeedbackCallback(data) {
  if (!data || typeof data !== 'string') return { valid: false };
  const p = data.split(':');
  if (p.length !== 3 || p[0] !== 'feedback') return { valid: false };
  const id = parseInt(p[1], 10);
  if (isNaN(id)) return { valid: false };
  if (p[2] !== 'useful' && p[2] !== 'not_useful') return { valid: false };
  return { valid: true, notificationId: id, isUseful: p[2] === 'useful' };
}

function buildFeedbackKeyboard(id) {
  return { inline_keyboard: [[ { text: '👍', callback_data: `feedback:${id}:useful` }, { text: '👎', callback_data: `feedback:${id}:not_useful` } ]] };
}

function isFeedbackCallback(u) { return !!(u?.callback_query?.data?.startsWith('feedback:')); }

function buildAutoMuteNotification(name, m) {
  return { title: `⏸ ${name} — automaticky utlumen`, body: `"${name}" utlumen. ${m.notUseful}/${m.totalFeedback} neužitečných (${(m.usefulRatio*100).toFixed(0)}%).` };
}
function buildDegradeNotification(name, m) {
  return { title: `📉 ${name} — souhrn`, body: `${(m.usefulRatio*100).toFixed(0)}% užitečnost.` };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📋 1. Callback Parsing (11 tests)');

await test('parse valid useful', () => { const r = parseFeedbackCallback('feedback:42:useful'); assert(r.valid && r.notificationId === 42 && r.isUseful); });
await test('parse valid not_useful', () => { const r = parseFeedbackCallback('feedback:99:not_useful'); assert(r.valid && r.notificationId === 99 && !r.isUseful); });
await test('parse invalid prefix', () => assert(!parseFeedbackCallback('vote:42:useful').valid));
await test('parse missing parts', () => assert(!parseFeedbackCallback('feedback:42').valid));
await test('parse non-numeric id', () => assert(!parseFeedbackCallback('feedback:abc:useful').valid));
await test('parse null', () => assert(!parseFeedbackCallback(null).valid));
await test('parse empty string', () => assert(!parseFeedbackCallback('').valid));
await test('parse unknown action', () => assert(!parseFeedbackCallback('feedback:42:maybe').valid));
await test('keyboard structure', () => {
  const kb = buildFeedbackKeyboard(123);
  assert(kb.inline_keyboard[0][0].callback_data === 'feedback:123:useful');
  assert(kb.inline_keyboard[0][1].callback_data === 'feedback:123:not_useful');
});
await test('isFeedbackCallback true', () => assert(isFeedbackCallback({ callback_query: { data: 'feedback:1:useful' } })));
await test('isFeedbackCallback false', () => {
  assert(!isFeedbackCallback({ message: {} }));
  assert(!isFeedbackCallback({ callback_query: { data: 'other:1' } }));
});

console.log('\n📊 2. Trust Metrics (9 tests)');

await test('no data → insufficient', () => {
  const t = new TrustTracker(createDB());
  const m = t.getMetrics('a'); assert(m.trustLevel === 'insufficient_data' && m.totalSent === 0);
});
await test('10 sent, 0 feedback → insufficient', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) db.insertLog('a');
  const m = t.getMetrics('a'); assert(m.trustLevel === 'insufficient_data' && m.noFeedback === 10);
});
await test('100% useful → healthy', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, true); }
  const m = t.getMetrics('a'); assert(m.trustLevel === 'healthy' && Math.abs(m.usefulRatio - 1.0) < 0.01);
});
await test('20% useful → degraded', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, i < 2); }
  const m = t.getMetrics('a'); assert(m.trustLevel === 'degraded' && m.shouldDegrade && !m.shouldMute);
});
await test('0% useful → critical', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, false); }
  const m = t.getMetrics('a'); assert(m.trustLevel === 'critical' && m.shouldMute);
});
await test('30% boundary → healthy', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, i < 3); }
  assert(t.getMetrics('a').trustLevel === 'healthy');
});
await test('10% boundary → degraded (not critical)', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, i < 1); }
  const m = t.getMetrics('a'); assert(m.trustLevel === 'degraded' && m.shouldDegrade && !m.shouldMute);
});
await test('4 feedbacks → insufficient (below min)', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); if (i < 4) db.setFeedback(id, false); }
  assert(t.getMetrics('a').trustLevel === 'insufficient_data');
});
await test('per-agent isolation', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 6; i++) { const id = db.insertLog('good'); db.setFeedback(id, true); }
  for (let i = 0; i < 6; i++) { const id = db.insertLog('bad'); db.setFeedback(id, false); }
  assert(t.getMetrics('good').trustLevel === 'healthy');
  assert(t.getMetrics('bad').trustLevel === 'critical');
});

console.log('\n🔄 3. Feedback Recording & Auto-degradation (6 tests)');

await test('recordFeedback updates log', () => {
  const db = createDB(); const t = new TrustTracker(db);
  const id = db.insertLog('a');
  const r = t.recordFeedback(id, true);
  assert(r.success); assert(db.getLog(id).useful === 1);
});
await test('recordFeedback nonexistent → fails', () => {
  const t = new TrustTracker(createDB());
  assert(!t.recordFeedback(99999, true).success);
});
await test('triggers auto-mute on 6th bad', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 5; i++) { const id = db.insertLog('a'); db.setFeedback(id, false); }
  const id6 = db.insertLog('a');
  const r = t.recordFeedback(id6, false);
  assert(r.action === 'auto_muted', `got ${r.action}`);
  assert(db.getState('a')?.muted_until !== null);
});
await test('triggers degrade (1 good + 4 bad)', () => {
  const db = createDB(); const t = new TrustTracker(db);
  const id1 = db.insertLog('a'); db.setFeedback(id1, true);
  for (let i = 0; i < 3; i++) { const id = db.insertLog('a'); db.setFeedback(id, false); }
  const id5 = db.insertLog('a');
  assert(t.recordFeedback(id5, false).action === 'degraded_to_digest');
});
await test('no action when insufficient', () => {
  const db = createDB(); const t = new TrustTracker(db);
  const id = db.insertLog('a');
  assert(t.recordFeedback(id, false).action == null);
});
await test('no duplicate mute within session', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 5; i++) { const id = db.insertLog('a'); db.setFeedback(id, false); }
  const id6 = db.insertLog('a'); t.recordFeedback(id6, false); // first mute
  const id7 = db.insertLog('a'); const r = t.recordFeedback(id7, false);
  assert(r.action === null, `expected null, got ${r.action}`);
});

console.log('\n🛡️ 4. Trust Override for Policy (3 tests)');

await test('healthy → null override', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, true); }
  assert(t.getTrustOverride('a').override === null);
});
await test('degraded → digest', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, i < 2); }
  assert(t.getTrustOverride('a').override === 'digest');
});
await test('critical → drop', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 10; i++) { const id = db.insertLog('a'); db.setFeedback(id, false); }
  assert(t.getTrustOverride('a').override === 'drop');
});

console.log('\n🎛️ 5. Manual Controls (2 tests)');

await test('unmute clears state', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 6; i++) { const id = db.insertLog('a'); db.setFeedback(id, false); }
  t.recordFeedback(db.insertLog('a'), false); // triggers auto_muted (7th with 6 already bad)
  assert(db.getState('a')?.muted_until !== null);
  t.unmute('a');
  assert(db.getState('a')?.muted_until === null);
});
await test('resetFeedback clears all', () => {
  const db = createDB(); const t = new TrustTracker(db);
  for (let i = 0; i < 5; i++) { const id = db.insertLog('a'); db.setFeedback(id, true); }
  t.resetFeedback('a');
  assert(db._logs.filter(l => l.agent_id === 'a' && l.useful !== null).length === 0);
});

console.log('\n💬 6. Notification Builders (2 tests)');

await test('autoMute message', () => {
  const n = buildAutoMuteNotification('Počasí', { usefulRatio: 0.08, notUseful: 9, totalFeedback: 10 });
  assert(n.title.includes('Počasí') && n.title.includes('utlumen'));
});
await test('degrade message', () => {
  const n = buildDegradeNotification('Reality', { usefulRatio: 0.25 });
  assert(n.title.includes('souhrn') && n.body.includes('25%'));
});

console.log('\n📈 7. getAllMetrics (1 test)');

await test('returns all agents', () => {
  const db = createDB(); const t = new TrustTracker(db);
  db.insertLog('a'); db.insertLog('b'); db.insertLog('c');
  assert(t.getAllMetrics().length === 3);
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Trust Feedback: ${passed} passed, ${failed} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  ❌ ${f.n}: ${f.m}`); }
console.log('═'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
