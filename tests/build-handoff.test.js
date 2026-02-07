// Build Handoff State Machine Tests
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import {
  handleBuildDetected,
  handleBuildConfirmed,
  getActiveBuildHandoff,
  cancelBuildHandoff,
} from '../src/chat/handlers/build-handoff.js';
import { DecisionType, IntentType, CREDecision } from '../src/chat/cre-decision.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
async function testAsync(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

const mkDecision = () => new CREDecision({
  type: DecisionType.PLAN, intent: IntentType.BUILD,
  tools: [], reason: 'test', confidence: 0.9,
});

console.log('\n═══ Build Handoff State Machine Tests ═══\n');

// ── PROPOSED phase ──────────────────────────────────────────────────────────

console.log('── Phase: PROPOSED ──');

test('handleBuildDetected creates PROPOSED state', () => {
  const sid = 'bh-1';
  const r = handleBuildDetected('postav mi REST API', mkDecision(), { sessionId: sid });
  assert.ok(r.content.includes('Build intent detekován'));
  assert.ok(r.content.includes('Chceš jít stavět'));
  const s = getActiveBuildHandoff(sid);
  assert.equal(s.phase, 'PROPOSED');
  assert.equal(s.originalRequest, 'postav mi REST API');
  assert.equal(s.workflowSessionId, null);
  cancelBuildHandoff(sid);
});

test('Metadata has awaitingConfirmation', () => {
  const sid = 'bh-2';
  const r = handleBuildDetected('build me API', mkDecision(), { sessionId: sid });
  assert.equal(r.metadata.buildHandoff, true);
  assert.equal(r.metadata.phase, 'PROPOSED');
  assert.equal(r.metadata.awaitingConfirmation, true);
  cancelBuildHandoff(sid);
});

test('Extracts build summary from input', () => {
  const sid = 'bh-3';
  const r = handleBuildDetected('build me a React dashboard', mkDecision(), { sessionId: sid });
  assert.ok(r.content.includes('React dashboard'));
  cancelBuildHandoff(sid);
});

test('Proposal shows pipeline steps', () => {
  const sid = 'bh-4';
  const r = handleBuildDetected('postav mi API', mkDecision(), { sessionId: sid });
  assert.ok(r.content.includes('D1'));
  assert.ok(r.content.includes('CODE'));
  assert.ok(r.content.includes('R2'));
  assert.ok(r.content.includes('R1'));
  cancelBuildHandoff(sid);
});

// ── Cancel ──────────────────────────────────────────────────────────────────

console.log('\n── Cancel ──');

test('cancelBuildHandoff clears state', () => {
  const sid = 'bh-cancel';
  handleBuildDetected('build API', mkDecision(), { sessionId: sid });
  assert.ok(getActiveBuildHandoff(sid));
  cancelBuildHandoff(sid);
  assert.equal(getActiveBuildHandoff(sid), null);
});

test('getActiveBuildHandoff returns null for unknown session', () => {
  assert.equal(getActiveBuildHandoff('nonexistent-xyz'), null);
});

// ── Multi-session isolation ─────────────────────────────────────────────────

console.log('\n── Multi-session isolation ──');

test('Multiple sessions independent', () => {
  handleBuildDetected('build API', mkDecision(), { sessionId: 'A' });
  handleBuildDetected('build frontend', mkDecision(), { sessionId: 'B' });
  assert.equal(getActiveBuildHandoff('A').originalRequest, 'build API');
  assert.equal(getActiveBuildHandoff('B').originalRequest, 'build frontend');
  cancelBuildHandoff('A');
  assert.equal(getActiveBuildHandoff('A'), null);
  assert.ok(getActiveBuildHandoff('B'));
  cancelBuildHandoff('B');
});

// ── Confirmation returns null without state ─────────────────────────────────

console.log('\n── Confirmation guards ──');

await testAsync('handleBuildConfirmed returns null without state', async () => {
  const r = await handleBuildConfirmed('ano', { sessionId: 'no-state' });
  assert.equal(r, null);
});

// ── Plan verdict regex ──────────────────────────────────────────────────────

console.log('\n── Plan verdict regex ──');

const approvals = ['ano', 'jo', 'ok', 'yes', 'schvaluji', 'approve', 'jdi', 'spusť', 'start', '👍', 'vypadá to dobře', 'looks good', 'lgtm'];
const rejections = ['ne', 'no', 'nechci', 'cancel', 'zrušit', 'odmít', 'reject'];

for (const p of approvals) {
  test(`Approval: "${p}"`, () => {
    const ok = /^(ano|jo|ok|yes|schvaluji?|approve|jdi|spusť|start|👍)\s*[!.]?$/i.test(p.trim())
      || /^(vypadá to dobře|looks good|lgtm)/i.test(p.trim());
    assert.ok(ok, `"${p}" should be approval`);
  });
}

for (const p of rejections) {
  test(`Rejection: "${p}"`, () => {
    const ok = /^(ne|no|nechci|cancel|zrušit?|odmít|reject)/i.test(p.trim());
    assert.ok(ok, `"${p}" should be rejection`);
  });
}

test('Feedback is neither approval nor rejection', () => {
  const input = 'přidej ještě autentizaci';
  const isA = /^(ano|jo|ok|yes|schvaluji?|approve|jdi|spusť|start|👍)\s*[!.]?$/i.test(input)
    || /^(vypadá to dobře|looks good|lgtm)/i.test(input);
  const isR = /^(ne|no|nechci|cancel|zrušit?|odmít|reject)/i.test(input);
  assert.ok(!isA && !isR);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);
