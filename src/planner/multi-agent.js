// Multi-Agent Build Loop v100 — Specialized Roles for BUILD Pipeline
// ══════════════════════════════════════════════════════════════════════════════
//
// Roles: planner → builder → architect → critic → debugger
//
// Flow:
//   0. Feasibility Gate (pre-build validation)
//   1. PLANNER: detailed implementation plan from milestone spec
//   2. BUILDER: implement plan (CODE model, temp 0.1)
//   3. ARCHITECT: review architecture compliance (skip if guardian PASS + <500 LOC)
//   4. CRITIC: review correctness + quality (R1 model)
//   5. DEBUGGER: fix issues if critic rejected (max 2 iterations)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Agent Roles ────────────────────────────────────────────────────────────

export const AgentRole = Object.freeze({
  PLANNER: 'planner',
  BUILDER: 'builder',
  ARCHITECT: 'architect',
  CRITIC: 'critic',
  DEBUGGER: 'debugger',
});

export const AGENT_CONFIG = Object.freeze({
  planner:   { model: 'D1',   temperature: 0.3, focus: 'decomposition + planning' },
  builder:   { model: 'CODE', temperature: 0.1, focus: 'implementation' },
  architect: { model: 'D1',   temperature: 0.2, focus: 'architecture compliance' },
  critic:    { model: 'R1',   temperature: 0.1, focus: 'correctness + quality' },
  debugger:  { model: 'D2',   temperature: 0.3, focus: 'diagnosis + repair' },
});

const MAX_CRITIC_ITERATIONS = 2;

// ─── Feasibility Gate ───────────────────────────────────────────────────────

/**
 * Pre-build validation. Checks if milestone is feasible before building.
 *
 * @param {Object} milestone - { id, title, scope_files, estimated_loc }
 * @param {Object} [snapshot] - Project snapshot
 * @param {Object} [policy] - Architecture policy
 * @returns {Promise<{feasible: boolean, issues: string[], recommendations: string[]}>}
 */
export async function feasibilityGate(milestone, snapshot = null, policy = null) {
  const issues = [];
  const recommendations = [];

  if (!milestone) {
    return { feasible: false, issues: ['No milestone provided'], recommendations: [] };
  }

  const scopeFiles = _parseScopeFiles(milestone.scope_files);

  // 1. Check dependencies exist
  if (snapshot?.moduleMap && scopeFiles.length > 0) {
    const knownFiles = new Set();
    for (const files of Object.values(snapshot.moduleMap)) {
      for (const f of files) knownFiles.add(f);
    }

    // Files that will be created (new) vs existing
    const newFiles = scopeFiles.filter(f => !knownFiles.has(f));
    const existingFiles = scopeFiles.filter(f => knownFiles.has(f));

    if (newFiles.length > 0 && existingFiles.length === 0) {
      // All new files — check if directories make sense
      const dirs = new Set(newFiles.map(f => f.split('/').slice(0, -1).join('/')));
      const knownDirs = new Set();
      for (const f of knownFiles) {
        knownDirs.add(f.split('/').slice(0, -1).join('/'));
      }
      for (const dir of dirs) {
        if (dir && !knownDirs.has(dir) && !dir.startsWith('src/') && !dir.startsWith('lib/')) {
          recommendations.push(`New directory \`${dir}/\` — ensure it follows project conventions`);
        }
      }
    }
  }

  // 2. Architecture feasibility
  if (policy && scopeFiles.length > 0) {
    const layers = new Set();
    for (const file of scopeFiles) {
      const parts = file.split('/');
      for (const part of parts) {
        if (policy.layers?.includes(part.toLowerCase())) {
          layers.add(part.toLowerCase());
        }
      }
    }
    if (layers.size > 3) {
      recommendations.push(`Milestone spans ${layers.size} layers — consider splitting`);
    }
  }

  // 3. Size check
  const estimatedLoc = milestone.estimated_loc || 0;
  if (estimatedLoc > 3000) {
    issues.push(`Estimated ${estimatedLoc} LOC exceeds recommended maximum of 3000`);
    recommendations.push('Consider decomposing this milestone');
  }

  // 4. Scope file count
  if (scopeFiles.length > 15) {
    recommendations.push(`${scopeFiles.length} files in scope — large scope increases risk`);
  }

  const feasible = issues.length === 0;

  logger.info('MultiAgent', `Feasibility gate: ${feasible ? 'PASS' : 'FAIL'}`, {
    milestoneId: milestone.id,
    issues: issues.length,
    recommendations: recommendations.length,
  });

  return { feasible, issues, recommendations };
}

// ─── Multi-Agent Build ──────────────────────────────────────────────────────

/**
 * Execute multi-agent build loop for a milestone.
 *
 * @param {Object} milestone - Current milestone
 * @param {Object} opts
 * @param {Function} opts.callLLM - async (model, prompt) => { content }
 * @param {Object} [opts.snapshot] - Project snapshot
 * @param {Object} [opts.policy] - Architecture policy
 * @param {Object} [opts.guardianAudit] - Pre-milestone guardian audit
 * @param {Object} [opts.codeContext] - Incremental code context
 * @returns {Promise<Object>} MultiAgentResult
 */
export async function multiAgentBuild(milestone, opts = {}) {
  const { callLLM } = opts;
  if (!callLLM) {
    return _failResult('No callLLM function provided');
  }

  const agentLog = [];
  const start = Date.now();

  try {
    // 0. FEASIBILITY GATE
    const gate = await feasibilityGate(milestone, opts.snapshot, opts.policy);
    agentLog.push({ phase: 'feasibility', result: gate });

    if (!gate.feasible) {
      return {
        phases: agentLog,
        finalApproved: false,
        iterations: 0,
        agentLog,
        reason: `Feasibility gate failed: ${gate.issues.join('; ')}`,
        buildTime: Date.now() - start,
      };
    }

    // 1. PLANNER — detailed implementation plan
    const planPrompt = buildAgentPrompt(AgentRole.PLANNER, {
      milestone,
      snapshot: opts.snapshot,
      policy: opts.policy,
    });
    const planResult = await callLLM(AGENT_CONFIG.planner.model, planPrompt);
    agentLog.push({ phase: 'planner', content: planResult.content?.substring(0, 500) });

    // 2. BUILDER — implement plan
    const buildPrompt = buildAgentPrompt(AgentRole.BUILDER, {
      milestone,
      plan: planResult.content,
      codeContext: opts.codeContext,
    });
    const buildResult = await callLLM(AGENT_CONFIG.builder.model, buildPrompt);
    agentLog.push({ phase: 'builder', content: buildResult.content?.substring(0, 500) });

    // 3. ARCHITECT — review (skip if guardian PASS + small milestone)
    let architectApproved = true;
    const skipArchitect = _shouldSkipArchitect(milestone, opts.guardianAudit);

    if (!skipArchitect) {
      const archPrompt = buildAgentPrompt(AgentRole.ARCHITECT, {
        milestone,
        buildOutput: buildResult.content,
        policy: opts.policy,
      });
      const archResult = await callLLM(AGENT_CONFIG.architect.model, archPrompt);
      architectApproved = !archResult.content?.toLowerCase().includes('violation');
      agentLog.push({ phase: 'architect', approved: architectApproved, content: archResult.content?.substring(0, 300) });

      if (!architectApproved) {
        // Re-build with architect feedback
        const rebuildPrompt = buildAgentPrompt(AgentRole.BUILDER, {
          milestone,
          plan: planResult.content,
          codeContext: opts.codeContext,
          architectFeedback: archResult.content,
        });
        const rebuildResult = await callLLM(AGENT_CONFIG.builder.model, rebuildPrompt);
        agentLog.push({ phase: 'builder-retry', content: rebuildResult.content?.substring(0, 500) });
        // Use rebuilt result for critic
        buildResult.content = rebuildResult.content;
      }
    } else {
      agentLog.push({ phase: 'architect', skipped: true, reason: 'guardian PASS + small milestone' });
    }

    // 4. CRITIC — review correctness
    let criticApproved = false;
    let debugIterations = 0;
    let lastBuildContent = buildResult.content;

    for (let i = 0; i <= MAX_CRITIC_ITERATIONS; i++) {
      const criticPrompt = buildAgentPrompt(AgentRole.CRITIC, {
        milestone,
        buildOutput: lastBuildContent,
      });
      const criticResult = await callLLM(AGENT_CONFIG.critic.model, criticPrompt);
      criticApproved = criticResult.content?.toLowerCase().includes('approved') ||
                       criticResult.content?.toLowerCase().includes('pass');
      agentLog.push({ phase: `critic-${i}`, approved: criticApproved, content: criticResult.content?.substring(0, 300) });

      if (criticApproved) break;

      if (i < MAX_CRITIC_ITERATIONS) {
        // 5. DEBUGGER — fix issues
        const debugPrompt = buildAgentPrompt(AgentRole.DEBUGGER, {
          milestone,
          criticFeedback: criticResult.content,
          buildOutput: lastBuildContent,
        });
        const debugResult = await callLLM(AGENT_CONFIG.debugger.model, debugPrompt);
        lastBuildContent = debugResult.content;
        agentLog.push({ phase: `debugger-${i}`, content: debugResult.content?.substring(0, 500) });
        debugIterations++;
      }
    }

    const totalTime = Date.now() - start;

    logger.info('MultiAgent', `Build complete: ${criticApproved ? 'APPROVED' : 'REJECTED'}`, {
      milestoneId: milestone.id,
      iterations: debugIterations,
      buildTime: totalTime,
      architectSkipped: skipArchitect,
    });

    return {
      phases: agentLog,
      finalApproved: criticApproved,
      iterations: debugIterations,
      agentLog,
      buildTime: totalTime,
    };
  } catch (err) {
    logger.warn('MultiAgent', `Build failed: ${err.message}`);
    return _failResult(err.message, agentLog, Date.now() - start);
  }
}

// ─── Agent Prompts ──────────────────────────────────────────────────────────

/**
 * Build role-specific prompt for an agent.
 *
 * @param {string} role - AgentRole
 * @param {Object} context
 * @returns {string} Prompt
 */
export function buildAgentPrompt(role, context) {
  const ms = context.milestone || {};

  switch (role) {
    case AgentRole.PLANNER:
      return `You are a SOFTWARE PLANNER. Create a detailed implementation plan.

## Milestone: ${ms.title || 'Unknown'}
${ms.description || ''}

## Scope Files
${_parseScopeFiles(ms.scope_files).map(f => `- ${f}`).join('\n') || 'Not specified'}

${context.snapshot ? '## Project Context\n' + JSON.stringify(context.snapshot.moduleMap || {}, null, 2).substring(0, 1000) : ''}

Create a step-by-step plan. For each step specify: file, what to implement, expected behavior.`;

    case AgentRole.BUILDER:
      return `You are a CODE BUILDER. Implement the plan precisely.

## Milestone: ${ms.title || 'Unknown'}

## Plan
${context.plan || 'No plan provided'}

${context.codeContext ? '## Existing Code Context\n' + context.codeContext.substring(0, 3000) : ''}

${context.architectFeedback ? '## Architect Feedback (fix these issues)\n' + context.architectFeedback : ''}

Output ONLY code. No markdown fences. No explanations.`;

    case AgentRole.ARCHITECT:
      return `You are an ARCHITECTURE REVIEWER. Check the code for architecture compliance.

## Milestone: ${ms.title || 'Unknown'}

## Code to Review
${context.buildOutput?.substring(0, 5000) || 'No code'}

${context.policy ? '## Architecture Rules\nLayers: ' + (context.policy.layers || []).join(', ') : ''}

Check for:
1. Layer violations (imports crossing boundaries)
2. Circular dependencies
3. Naming convention violations
4. Pattern consistency

If all checks pass, write "APPROVED". If there are violations, list them.`;

    case AgentRole.CRITIC:
      return `You are a CODE CRITIC. Review for correctness and quality.

## Milestone: ${ms.title || 'Unknown'}

## Code to Review
${context.buildOutput?.substring(0, 5000) || 'No code'}

Check:
1. Does the code implement all deliverables?
2. Are there logic errors?
3. Error handling present?
4. Edge cases covered?

If all checks pass, write "APPROVED — code is correct". Otherwise, list specific issues.`;

    case AgentRole.DEBUGGER:
      return `You are a DEBUGGER. Fix the issues identified by the critic.

## Milestone: ${ms.title || 'Unknown'}

## Critic Feedback
${context.criticFeedback || 'No feedback'}

## Current Code
${context.buildOutput?.substring(0, 5000) || 'No code'}

Fix ONLY the identified issues. Do NOT rewrite working code. Output the corrected code.`;

    default:
      return `Unknown role: ${role}`;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _shouldSkipArchitect(milestone, guardianAudit) {
  // Skip if guardian PRE-audit passed AND milestone is small (<500 LOC)
  if (!guardianAudit) return false;

  const estimatedLoc = milestone.estimated_loc || 0;
  const preViolations = guardianAudit.driftViolations?.length || 0;

  return preViolations === 0 && estimatedLoc < 500;
}

function _parseScopeFiles(scopeFiles) {
  if (!scopeFiles) return [];
  if (Array.isArray(scopeFiles)) return scopeFiles;
  if (typeof scopeFiles === 'string') {
    try { return JSON.parse(scopeFiles); } catch { return []; }
  }
  return [];
}

function _failResult(reason, agentLog = [], buildTime = 0) {
  return {
    phases: agentLog,
    finalApproved: false,
    iterations: 0,
    agentLog,
    reason,
    buildTime,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  AgentRole,
  AGENT_CONFIG,
  feasibilityGate,
  multiAgentBuild,
  buildAgentPrompt,
};
