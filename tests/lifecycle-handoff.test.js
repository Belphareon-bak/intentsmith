import './helpers/isolated-test-db.js';

// Lifecycle Handoff Tests
// ══════════════════════════════════════════════════════════════════════════════
// Tests: isProjectScopeBuild, lifecycle handoff state management,
//        phase routing, cancel/pause, quick build fallback
//
// Run: node tests/lifecycle-handoff.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { isProjectScopeBuild } from '../src/chat/handlers/build-handoff.js';
import {
  handleLifecycleBuildDetected,
  handleLifecycleInput,
  getActiveLifecycleHandoff,
  cancelLifecycleHandoff,
} from '../src/chat/handlers/lifecycle-handoff.js';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. isProjectScopeBuild — heuristic detection
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── isProjectScopeBuild: project-scope → true ──');

{
  // Czech project-scope patterns
  assert(isProjectScopeBuild('Chci postavit celý systém pro správu objednávek'), 'celý systém → true');
  assert(isProjectScopeBuild('Postav mi kompletní e-shop'), 'kompletní e-shop → true');
  assert(isProjectScopeBuild('Chci kompletní aplikaci s frontendem a backendem'), 'kompletní aplikaci → true');
  assert(isProjectScopeBuild('Projekt od specifikace po deployment'), 'od specifikace → true');
  assert(isProjectScopeBuild('Chci to udělat ve vícero fázích'), 'vícero fází → true');
  assert(isProjectScopeBuild('Postav celou aplikaci'), 'celou aplikaci → true');
  assert(isProjectScopeBuild('Chci vybudovat monitoring systém'), 'vybudovat → true');
  assert(isProjectScopeBuild('Chci postavit kompletní CRM'), 'postavit kompletní → true');
  assert(isProjectScopeBuild('Celý stack od nuly'), 'celý stack → true');

  // English project-scope patterns
  assert(isProjectScopeBuild('Build a full system with auth, API and frontend'), 'full system → true');
  assert(isProjectScopeBuild('I want a full project from spec to deployment'), 'full project → true');
  assert(isProjectScopeBuild('Create an end-to-end solution'), 'end-to-end → true');
  assert(isProjectScopeBuild('Build me a multi-phase project'), 'multi-phase → true');
  assert(isProjectScopeBuild('Set up a project with lifecycle management'), 'lifecycle → true');
  assert(isProjectScopeBuild('Build with milestones'), 'milestone → true');
  assert(isProjectScopeBuild('from specification to production'), 'from spec → true');

  // Multi-component heuristic (3+ components → project-scope)
  assert(isProjectScopeBuild('Postav mi app s React frontendem, Express backendem a PostgreSQL databází'), '3 components → true');
  assert(isProjectScopeBuild('Need frontend with React, backend API, database, and auth system'), '4 components → true');
  assert(isProjectScopeBuild('Build app with Vue UI, Node server, MongoDB, CI/CD pipeline'), '4 components pipeline → true');
}

console.log('\n── isProjectScopeBuild: quick build → false ──');

{
  // Simple builds — should NOT trigger lifecycle
  assert(!isProjectScopeBuild('Postav mi API endpoint pro uživatele'), 'API endpoint → false');
  assert(!isProjectScopeBuild('Scaffoldni Express server'), 'scaffold server → false');
  assert(!isProjectScopeBuild('Deploy this to production'), 'deploy → false');
  assert(!isProjectScopeBuild('Build a REST API'), 'REST API → false');
  assert(!isProjectScopeBuild('Create a React component'), 'component → false');
  assert(!isProjectScopeBuild('Set up a Docker container'), 'docker → false');
  assert(!isProjectScopeBuild('Postav mi jednoduchý web'), 'jednoduchý web → false');
  assert(!isProjectScopeBuild('Build me a login form'), 'login form → false');
  assert(!isProjectScopeBuild('Nastav mi CI/CD pipeline'), 'pipeline only → false');

  // Only 1-2 components — not enough
  assert(!isProjectScopeBuild('Build app with React and Express'), '2 components → false');
  assert(!isProjectScopeBuild('Postav backend s databází'), '2 components CZ → false');
}

// ════════════════════════════════════════════════════════════════════════════════
// 2. handleLifecycleBuildDetected — initial proposal
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleLifecycleBuildDetected ──');

{
  const sessionId = `test-lc-${Date.now()}`;
  const input = 'Chci postavit kompletní e-shop';
  const decision = { type: 'PLAN', intent: 'BUILD' };
  const context = { sessionId };

  const response = handleLifecycleBuildDetected(input, decision, context);

  assert(response !== null, 'returns response');
  assert(typeof response.content === 'string', 'response has content');
  assert(response.content.includes('lifecycle'), 'mentions lifecycle');
  assert(response.content.includes('SPEC'), 'mentions SPEC phase');
  assert(response.content.includes('BUILD'), 'mentions BUILD phase');
  assert(response.content.includes('ano/ne'), 'asks for confirmation');

  // State should be set
  const state = getActiveLifecycleHandoff(sessionId);
  assert(state !== null, 'handoff state created');
  assert(state.phase === 'PROPOSED', 'phase = PROPOSED');
  assert(state.originalRequest === input, 'originalRequest stored');

  // Cleanup
  cancelLifecycleHandoff(sessionId);
  assert(getActiveLifecycleHandoff(sessionId) === null, 'cleanup: state cleared');
}

// ════════════════════════════════════════════════════════════════════════════════
// 3. handleLifecycleInput — cancel
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleLifecycleInput: cancel ──');

{
  const sessionId = `test-cancel-${Date.now()}`;
  const context = { sessionId };

  // Set up PROPOSED state
  handleLifecycleBuildDetected('Celý systém', { type: 'PLAN', intent: 'BUILD' }, context);
  assert(getActiveLifecycleHandoff(sessionId) !== null, 'state exists before cancel');

  const response = await handleLifecycleInput('zrušit', context);
  assert(response !== null, 'cancel returns response');
  assert(response.content.includes('zrušen'), 'says cancelled');
  assert(getActiveLifecycleHandoff(sessionId) === null, 'state cleared after cancel');
}

{
  // English cancel
  const sessionId = `test-cancel-en-${Date.now()}`;
  const context = { sessionId };
  handleLifecycleBuildDetected('Full system', { type: 'PLAN', intent: 'BUILD' }, context);

  const response = await handleLifecycleInput('cancel', context);
  assert(response.content.includes('zrušen'), 'EN cancel works');
  assert(getActiveLifecycleHandoff(sessionId) === null, 'EN cancel clears state');
}

// ════════════════════════════════════════════════════════════════════════════════
// 4. handleLifecycleInput — pause
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleLifecycleInput: pause ──');

{
  const sessionId = `test-pause-${Date.now()}`;
  const context = { sessionId };
  handleLifecycleBuildDetected('Celý projekt', { type: 'PLAN', intent: 'BUILD' }, context);

  const response = await handleLifecycleInput('pauza', context);
  assert(response !== null, 'pause returns response');
  assert(response.content.includes('pozastaven'), 'says paused');

  const state = getActiveLifecycleHandoff(sessionId);
  assert(state !== null, 'state still exists after pause');
  assert(state.phase === 'PAUSED', 'phase = PAUSED');

  // Cleanup
  cancelLifecycleHandoff(sessionId);
}

// ════════════════════════════════════════════════════════════════════════════════
// 5. handleLifecycleInput — PROPOSED phase: yes/no
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── handleLifecycleInput: PROPOSED responses ──');

{
  // "ne" → cancel
  const sessionId = `test-proposed-no-${Date.now()}`;
  const context = { sessionId };
  handleLifecycleBuildDetected('Celý systém', { type: 'PLAN', intent: 'BUILD' }, context);

  const response = await handleLifecycleInput('ne', context);
  assert(response !== null, 'no returns response');
  assert(getActiveLifecycleHandoff(sessionId) === null, 'no clears state');
}

{
  // Ambiguous response
  const sessionId = `test-proposed-ambig-${Date.now()}`;
  const context = { sessionId };
  handleLifecycleBuildDetected('Celý systém', { type: 'PLAN', intent: 'BUILD' }, context);

  const response = await handleLifecycleInput('hmm nevím', context);
  assert(response !== null, 'ambiguous returns response');
  assert(response.content.includes('ano/ne'), 'asks again');

  cancelLifecycleHandoff(sessionId);
}

{
  // "quick build" escape hatch
  const sessionId = `test-proposed-quick-${Date.now()}`;
  const context = { sessionId };
  handleLifecycleBuildDetected('Celý systém', { type: 'PLAN', intent: 'BUILD' }, context);

  const response = await handleLifecycleInput('quick build', context);
  assert(response !== null, 'quick build returns response');
  assert(getActiveLifecycleHandoff(sessionId) === null, 'lifecycle state cleared for quick build');
}

// ════════════════════════════════════════════════════════════════════════════════
// 6. State management
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── State management ──');

{
  const sid1 = `test-state-1-${Date.now()}`;
  const sid2 = `test-state-2-${Date.now()}`;

  // Two sessions → independent states
  handleLifecycleBuildDetected('Celý systém', { type: 'PLAN', intent: 'BUILD' }, { sessionId: sid1 });
  handleLifecycleBuildDetected('Full project', { type: 'PLAN', intent: 'BUILD' }, { sessionId: sid2 });

  assert(getActiveLifecycleHandoff(sid1) !== null, 'session 1 has state');
  assert(getActiveLifecycleHandoff(sid2) !== null, 'session 2 has state');

  cancelLifecycleHandoff(sid1);
  assert(getActiveLifecycleHandoff(sid1) === null, 'session 1 cleared');
  assert(getActiveLifecycleHandoff(sid2) !== null, 'session 2 still exists');

  cancelLifecycleHandoff(sid2);
}

{
  // No state → null
  assert(getActiveLifecycleHandoff('nonexistent-session') === null, 'nonexistent session → null');
}

{
  // handleLifecycleInput with no state → null
  const response = await handleLifecycleInput('anything', { sessionId: 'no-state-session' });
  assert(response === null, 'no state → null response');
}

// ════════════════════════════════════════════════════════════════════════════════
// 7. Response format
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Response format ──');

{
  const sessionId = `test-format-${Date.now()}`;
  const response = handleLifecycleBuildDetected(
    'Kompletní e-shop',
    { type: 'PLAN', intent: 'BUILD' },
    { sessionId }
  );

  // TaggedResponse format
  assert(response.content && typeof response.content === 'string', 'has string content');
  assert(response.tag !== undefined, 'has tag');

  // Metadata
  const meta = response.tag?.metadata || response.metadata;
  assert(meta?.lifecycleHandoff === true, 'metadata.lifecycleHandoff = true');
  assert(meta?.phase === 'PROPOSED', 'metadata.phase = PROPOSED');
  assert(meta?.awaitingConfirmation === true, 'metadata.awaitingConfirmation = true');

  cancelLifecycleHandoff(sessionId);
}

// ════════════════════════════════════════════════════════════════════════════════
// 8. Edge cases
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Edge cases ──');

{
  // isProjectScopeBuild with empty/short strings
  assert(!isProjectScopeBuild(''), 'empty string → false');
  assert(!isProjectScopeBuild('ahoj'), 'greeting → false');
  assert(!isProjectScopeBuild('build'), 'just "build" → false');
}

{
  // Czech diacritics variants
  assert(isProjectScopeBuild('Chci celý systém'), 'celý s diakritikou → true');
  assert(isProjectScopeBuild('kompletni projekt'), 'kompletni bez diakritiky → true');
}

{
  // Case insensitivity
  assert(isProjectScopeBuild('CELÝ PROJEKT OD SPECIFIKACE'), 'uppercase → true');
  assert(isProjectScopeBuild('Full System With Auth'), 'titlecase → true');
}

{
  // Multiple cancel command variants
  const cmds = ['zrušit', 'cancel', 'stop', 'zrusit'];
  for (const cmd of cmds) {
    const sid = `test-cancel-var-${cmd}-${Date.now()}`;
    handleLifecycleBuildDetected('Celý systém', { type: 'PLAN', intent: 'BUILD' }, { sessionId: sid });
    const resp = await handleLifecycleInput(cmd, { sessionId: sid });
    assert(getActiveLifecycleHandoff(sid) === null, `cancel variant "${cmd}" clears state`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// 9. Build handoff integration — handleBuildDetected routes correctly
// ════════════════════════════════════════════════════════════════════════════════

console.log('\n── Build handoff integration ──');

{
  const { handleBuildDetected } = await import('../src/chat/handlers/build-handoff.js');

  // Project-scope → returns promise (lifecycle handoff uses dynamic import)
  const sessionId = `test-integration-${Date.now()}`;
  const result = handleBuildDetected(
    'Chci postavit kompletní e-shop s frontendem, backendem a databází',
    { type: 'PLAN', intent: 'BUILD' },
    { sessionId }
  );

  // handleBuildDetected returns a Promise when routing to lifecycle
  assert(result instanceof Promise || (result && typeof result.content === 'string'),
    'project-scope build returns promise or response');

  // Wait for it if promise
  if (result instanceof Promise) {
    const response = await result;
    assert(response.content.includes('lifecycle') || response.content.includes('Detekován'),
      'project-scope routes to lifecycle');
    cancelLifecycleHandoff(sessionId);
  }
}

{
  const { handleBuildDetected, getActiveBuildHandoff } = await import('../src/chat/handlers/build-handoff.js');

  // Simple build → stays in quick build (returns TaggedResponse synchronously)
  const sessionId = `test-integration-quick-${Date.now()}`;
  const result = handleBuildDetected(
    'Postav mi API endpoint',
    { type: 'PLAN', intent: 'BUILD' },
    { sessionId }
  );

  // Quick build is synchronous and returns TaggedResponse directly
  if (result instanceof Promise) {
    const response = await result;
    // Should NOT be lifecycle
    assert(!response.content.includes('lifecycle'), 'simple build does NOT route to lifecycle');
  } else {
    assert(result.content.includes('Build intent'), 'simple build stays in quick build');
    const buildState = getActiveBuildHandoff(sessionId);
    assert(buildState !== null, 'quick build state set');
    assert(buildState.phase === 'PROPOSED', 'quick build phase = PROPOSED');
  }

  // Cleanup
  const { cancelBuildHandoff } = await import('../src/chat/handlers/build-handoff.js');
  cancelBuildHandoff(sessionId);
}

// ════════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Lifecycle Handoff Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}\n`);

if (failures.length > 0) {
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    - ${f.name}: ${f.msg}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
