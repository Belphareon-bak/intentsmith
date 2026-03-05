// tests/multi-agent.test.js — Multi-Agent Build Loop v100 tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  AgentRole,
  AGENT_CONFIG,
  feasibilityGate,
  multiAgentBuild,
  buildAgentPrompt,
} from '../src/planner/multi-agent.js';

// ─── AgentRole + Config ─────────────────────────────────────────────────────

suite('Multi-Agent — Roles & Config');

test('has all 5 roles', () => {
  assertEqual(AgentRole.PLANNER, 'planner');
  assertEqual(AgentRole.BUILDER, 'builder');
  assertEqual(AgentRole.ARCHITECT, 'architect');
  assertEqual(AgentRole.CRITIC, 'critic');
  assertEqual(AgentRole.DEBUGGER, 'debugger');
});

test('AgentRole is frozen', () => {
  assert(Object.isFrozen(AgentRole), 'AgentRole should be frozen');
});

test('each role has model + temperature', () => {
  for (const role of Object.values(AgentRole)) {
    const cfg = AGENT_CONFIG[role];
    assert(cfg, `${role} should have config`);
    assert(cfg.model, `${role} should have model`);
    assert(typeof cfg.temperature === 'number', `${role} should have temperature`);
    assert(cfg.focus, `${role} should have focus`);
  }
});

test('builder uses CODE model with low temp', () => {
  assertEqual(AGENT_CONFIG.builder.model, 'CODE');
  assertEqual(AGENT_CONFIG.builder.temperature, 0.1);
});

test('critic uses R1 model', () => {
  assertEqual(AGENT_CONFIG.critic.model, 'R1');
});

// ─── Feasibility Gate ───────────────────────────────────────────────────────

suite('Multi-Agent — Feasibility Gate');

await testAsync('passes for small valid milestone', async () => {
  const result = await feasibilityGate({
    id: 'ms-1',
    title: 'Add login',
    scope_files: JSON.stringify(['src/auth/login.js']),
    estimated_loc: 200,
  });
  assert(result.feasible, 'should be feasible');
  assertEqual(result.issues.length, 0);
});

await testAsync('fails for null milestone', async () => {
  const result = await feasibilityGate(null);
  assert(!result.feasible, 'null should not be feasible');
  assert(result.issues.length > 0, 'should have issues');
});

await testAsync('fails for too large milestone (>3000 LOC)', async () => {
  const result = await feasibilityGate({
    id: 'ms-1',
    title: 'Huge refactor',
    estimated_loc: 5000,
  });
  assert(!result.feasible, 'should not be feasible');
  assert(result.issues.some(i => i.includes('3000')), 'should mention max LOC');
});

await testAsync('warns about large scope file count', async () => {
  const files = Array.from({ length: 20 }, (_, i) => `src/f${i}.js`);
  const result = await feasibilityGate({
    id: 'ms-1',
    title: 'Wide change',
    scope_files: JSON.stringify(files),
    estimated_loc: 1000,
  });
  assert(result.feasible, 'should still be feasible');
  assert(result.recommendations.length > 0, 'should have recommendations');
  assert(result.recommendations.some(r => r.includes('20 files')), 'should warn about file count');
});

await testAsync('warns about many layers', async () => {
  const policy = {
    layers: ['controller', 'service', 'model', 'util', 'middleware'],
  };
  const files = [
    'src/controller/a.js', 'src/service/b.js',
    'src/model/c.js', 'src/util/d.js',
  ];
  const result = await feasibilityGate(
    { id: 'ms-1', title: 'X', scope_files: JSON.stringify(files), estimated_loc: 200 },
    null,
    policy
  );
  assert(result.feasible, 'should be feasible');
  assert(result.recommendations.some(r => r.includes('layers')), 'should warn about layer span');
});

await testAsync('warns about new directories outside standard paths', async () => {
  const snapshot = {
    moduleMap: { 'src/api': ['src/api/users.js'] },
  };
  const result = await feasibilityGate(
    {
      id: 'ms-1',
      title: 'New module',
      scope_files: JSON.stringify(['custom/new-dir/file.js']),
      estimated_loc: 100,
    },
    snapshot,
  );
  assert(result.feasible, 'should be feasible');
  assert(result.recommendations.some(r => r.includes('custom/new-dir')), 'should mention new dir');
});

await testAsync('no warning for new files in src/', async () => {
  const snapshot = {
    moduleMap: { 'src/api': ['src/api/users.js'] },
  };
  const result = await feasibilityGate(
    {
      id: 'ms-1',
      title: 'Standard',
      scope_files: JSON.stringify(['src/services/auth.js']),
      estimated_loc: 100,
    },
    snapshot,
  );
  assertEqual(result.recommendations.length, 0);
});

// ─── Agent Prompts ──────────────────────────────────────────────────────────

suite('Multi-Agent — Agent Prompts');

test('PLANNER prompt includes milestone title and scope', () => {
  const prompt = buildAgentPrompt(AgentRole.PLANNER, {
    milestone: {
      title: 'Build Auth API',
      scope_files: JSON.stringify(['src/auth/login.js', 'src/auth/register.js']),
    },
  });
  assert(prompt.includes('Build Auth API'), 'should include title');
  assert(prompt.includes('src/auth/login.js'), 'should include scope files');
  assert(prompt.includes('PLANNER'), 'should mention role');
});

test('BUILDER prompt includes plan and code context', () => {
  const prompt = buildAgentPrompt(AgentRole.BUILDER, {
    milestone: { title: 'Feature X' },
    plan: 'Step 1: Create file\nStep 2: Implement logic',
    codeContext: 'function existingFn() { return 42; }',
  });
  assert(prompt.includes('Step 1'), 'should include plan');
  assert(prompt.includes('existingFn'), 'should include code context');
  assert(prompt.includes('ONLY code'), 'should instruct code-only output');
});

test('BUILDER prompt includes architect feedback on retry', () => {
  const prompt = buildAgentPrompt(AgentRole.BUILDER, {
    milestone: { title: 'Feature X' },
    plan: 'plan',
    architectFeedback: 'Layer violation: controller imports model directly',
  });
  assert(prompt.includes('Layer violation'), 'should include architect feedback');
  assert(prompt.includes('Architect Feedback'), 'should have feedback section');
});

test('ARCHITECT prompt includes policy rules', () => {
  const prompt = buildAgentPrompt(AgentRole.ARCHITECT, {
    milestone: { title: 'Feature X' },
    buildOutput: 'import model from "../model"',
    policy: { layers: ['controller', 'service', 'model'] },
  });
  assert(prompt.includes('ARCHITECTURE REVIEWER'), 'should mention role');
  assert(prompt.includes('controller'), 'should include layers');
  assert(prompt.includes('import model'), 'should include build output');
});

test('CRITIC prompt checks for correctness', () => {
  const prompt = buildAgentPrompt(AgentRole.CRITIC, {
    milestone: { title: 'Auth System' },
    buildOutput: 'function login() { return true; }',
  });
  assert(prompt.includes('CRITIC'), 'should mention role');
  assert(prompt.includes('login'), 'should include build output');
  assert(prompt.includes('APPROVED'), 'should mention approval');
});

test('DEBUGGER prompt includes critic feedback', () => {
  const prompt = buildAgentPrompt(AgentRole.DEBUGGER, {
    milestone: { title: 'Auth System' },
    criticFeedback: 'Missing input validation',
    buildOutput: 'function login() { return true; }',
  });
  assert(prompt.includes('DEBUGGER'), 'should mention role');
  assert(prompt.includes('Missing input validation'), 'should include critic feedback');
});

test('unknown role returns fallback', () => {
  const prompt = buildAgentPrompt('unknown_role', { milestone: {} });
  assert(prompt.includes('Unknown role'), 'should indicate unknown');
});

// ─── multiAgentBuild ────────────────────────────────────────────────────────

suite('Multi-Agent — Build Loop');

await testAsync('happy path: all phases approve', async () => {
  const log = [];
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Test Feature', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        log.push(model);
        if (prompt.includes('CRITIC')) return { content: 'APPROVED — code is correct' };
        if (prompt.includes('ARCHITECT')) return { content: 'APPROVED — no violations' };
        return { content: 'Generated code here...' };
      },
    }
  );
  assert(result.finalApproved, 'should be approved');
  assert(result.buildTime >= 0, 'should have build time');
  assert(result.agentLog.length >= 3, 'should have multiple phases');
});

await testAsync('architect rejection → builder retry', async () => {
  let builderCalls = 0;
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Test', estimated_loc: 600, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('BUILDER')) {
          builderCalls++;
          return { content: 'code...' };
        }
        if (prompt.includes('ARCHITECT')) {
          return { content: 'VIOLATION: controller imports model directly' };
        }
        if (prompt.includes('CRITIC')) return { content: 'APPROVED' };
        return { content: 'plan...' };
      },
    }
  );
  assertEqual(builderCalls, 2); // original + retry after architect rejection
  assert(result.finalApproved, 'should be approved after retry');
});

await testAsync('critic rejection → debugger → critic retry', async () => {
  let criticCalls = 0;
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Test', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('CRITIC')) {
          criticCalls++;
          if (criticCalls === 1) return { content: 'REJECTED: missing validation' };
          return { content: 'APPROVED' };
        }
        if (prompt.includes('DEBUGGER')) return { content: 'fixed code...' };
        return { content: 'plan/code...' };
      },
    }
  );
  assertEqual(criticCalls, 2);
  assert(result.finalApproved, 'should be approved after debug cycle');
  assertEqual(result.iterations, 1); // one debug iteration
});

await testAsync('max critic iterations respected', async () => {
  let criticCalls = 0;
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Test', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('CRITIC')) {
          criticCalls++;
          return { content: 'REJECTED: still broken' };
        }
        return { content: 'code...' };
      },
    }
  );
  assertEqual(criticCalls, 3); // initial + 2 retries
  assert(!result.finalApproved, 'should NOT be approved');
  assertEqual(result.iterations, 2);
});

await testAsync('feasibility gate blocks build', async () => {
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Too Big', estimated_loc: 5000 },
    {
      callLLM: async () => {
        throw new Error('Should not be called');
      },
    }
  );
  assert(!result.finalApproved, 'should not be approved');
  assert(result.reason.includes('Feasibility'), 'should mention feasibility');
  assertEqual(result.iterations, 0);
});

await testAsync('skip architect when guardian PASS + small milestone', async () => {
  const phases = [];
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Small Fix', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('CRITIC')) return { content: 'APPROVED' };
        return { content: 'output...' };
      },
      guardianAudit: { driftViolations: [] }, // no violations → skip architect
    }
  );
  assert(result.finalApproved, 'should be approved');
  const archPhase = result.agentLog.find(p => p.phase === 'architect');
  assert(archPhase.skipped, 'architect should be skipped');
});

await testAsync('does NOT skip architect when guardian has violations', async () => {
  let architectCalled = false;
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Fix', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('ARCHITECT')) {
          architectCalled = true;
          return { content: 'APPROVED — no new violations' };
        }
        if (prompt.includes('CRITIC')) return { content: 'APPROVED' };
        return { content: 'output...' };
      },
      guardianAudit: { driftViolations: [{ file: 'x.js' }] }, // has violations
    }
  );
  assert(architectCalled, 'architect should be called when violations exist');
});

await testAsync('does NOT skip architect for large milestone', async () => {
  let architectCalled = false;
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Big', estimated_loc: 800, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('ARCHITECT')) {
          architectCalled = true;
          return { content: 'APPROVED' };
        }
        if (prompt.includes('CRITIC')) return { content: 'APPROVED' };
        return { content: 'output...' };
      },
      guardianAudit: { driftViolations: [] }, // no violations BUT large milestone
    }
  );
  assert(architectCalled, 'architect should be called for large milestones');
});

await testAsync('returns error when no callLLM provided', async () => {
  const result = await multiAgentBuild({ id: 'ms-1', title: 'T' }, {});
  assert(!result.finalApproved, 'should not be approved');
  assert(result.reason.includes('callLLM'), 'should mention missing callLLM');
});

await testAsync('handles callLLM errors gracefully', async () => {
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'T', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async () => { throw new Error('LLM timeout'); },
    }
  );
  assert(!result.finalApproved, 'should not be approved');
  assert(result.reason.includes('LLM timeout'), 'should include error message');
});

await testAsync('agentLog captures all phases', async () => {
  const result = await multiAgentBuild(
    { id: 'ms-1', title: 'Full Pipeline', estimated_loc: 100, scope_files: '["src/a.js"]' },
    {
      callLLM: async (model, prompt) => {
        if (prompt.includes('CRITIC')) return { content: 'APPROVED' };
        return { content: 'output...' };
      },
    }
  );
  const phaseNames = result.agentLog.map(p => p.phase);
  assert(phaseNames.includes('feasibility'), 'should have feasibility phase');
  assert(phaseNames.includes('planner'), 'should have planner phase');
  assert(phaseNames.includes('builder'), 'should have builder phase');
  assert(phaseNames.some(p => p.startsWith('critic')), 'should have critic phase');
});

// ─── Summary ────────────────────────────────────────────────────────────────

summary();
