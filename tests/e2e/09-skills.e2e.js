// tests/e2e/09-skills.e2e.js — Skills system API
// ══════════════════════════════════════════════════════════════════════════════
import { suite, testAsync, assert, assertEqual, summary, api, waitForServer } from './_helpers.js';

await waitForServer();

// ── List Skills ──────────────────────────────────────────────────────────
suite('GET /api/skills — list');

let skills = [];

await testAsync('returns skills array', async () => {
  const { status, data } = await api('GET', '/api/skills');
  assertEqual(status, 200);
  assert(Array.isArray(data.skills), 'skills must be array');
  skills = data.skills;
});

await testAsync('has at least 1 skill', async () => {
  assert(skills.length >= 1, `expected ≥1 skills, got ${skills.length}`);
});

await testAsync('each skill has required fields', async () => {
  if (skills.length === 0) return;
  const s = skills[0];
  assert(s.id, 'id required');
  assert(typeof s.description === 'string', 'description required');
});

// ── Get Single ────────────────────────────────────────────────────────────
suite('GET /api/skills/:id');

await testAsync('returns skill detail', async () => {
  if (skills.length === 0) return;
  const { status, data } = await api('GET', `/api/skills/${skills[0].id}`);
  assertEqual(status, 200);
  assert(data.id || data.skill, 'skill data required');
});

await testAsync('returns 404 for nonexistent', async () => {
  const { status } = await api('GET', '/api/skills/nonexistent-skill-xyz');
  assertEqual(status, 404);
});

// ── Reload ────────────────────────────────────────────────────────────────
suite('POST /api/skills/reload');

await testAsync('hot-reload returns success', async () => {
  const { status, data } = await api('POST', '/api/skills/reload');
  assertEqual(status, 200);
});

// ── Execution State Machine ──────────────────────────────────────────────
suite('Skill Execution Validation');

await testAsync('GET execution with invalid ID returns 404', async () => {
  const { status } = await api('GET', '/api/skills/executions/nonexistent-xyz');
  assertEqual(status, 404);
});

await testAsync('confirm with invalid execution returns 404', async () => {
  const { status } = await api('POST', '/api/skills/executions/nonexistent-xyz/confirm');
  assert(status === 404 || status === 409, `expected 404/409, got ${status}`);
});

await testAsync('cancel with invalid execution returns 404', async () => {
  const { status } = await api('POST', '/api/skills/executions/nonexistent-xyz/cancel');
  assert(status === 404 || status === 409, `expected 404/409, got ${status}`);
});

await testAsync('resume without input returns 400 or 404', async () => {
  const { status } = await api('POST', '/api/skills/executions/nonexistent-xyz/resume', {});
  assert(status === 400 || status === 404, `expected 400/404, got ${status}`);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
