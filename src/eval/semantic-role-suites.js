import { readFileSync } from 'node:fs';
import { structuredTask } from './structured-answer.js';
import { semanticTask } from './semantic-evaluation-judge.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/role-semantic-tasks.json', import.meta.url), 'utf8'));
if (fixture.schemaVersion !== 1 || fixture.notAHoldout !== true || fixture.decisionReady !== false)
  throw new Error('SEMANTIC_ROLE_FIXTURE_CONTRACT_INVALID');

// Independent role assignments on pinned historical sources. These are openly
// authored development cases, not a retrospectively renamed operational holdout.
export const SEMANTIC_ROLE_SUITES = Object.freeze(Object.fromEntries(['D1','D2','R1','R2','CHAT'].map(role => {
  const tests = fixture.tasks.filter(task => task.role === role).map(task => task.evaluation?.tier === 'T2' ? structuredTask(task) : semanticTask(task));
  if (!tests.length || new Set(tests.map(t => t.name)).size !== tests.length) throw new Error(`SEMANTIC_ROLE_TASKS_INVALID:${role}`);
  return [role, Object.freeze({ name: `${role.toLowerCase()}_semantic_v1`, version: 'role-semantic.3',
    roles: [role], description: 'Role-specific open answers; per-task calibrated T4, exploratory until independent acceptance',
    tests: Object.freeze(tests), notAHoldout: true })];
})));

export function semanticSuiteForRole(role) { return SEMANTIC_ROLE_SUITES[role] || null; }
