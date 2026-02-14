// Lifecycle BUILD Phase — Milestone Execution Engine
// ══════════════════════════════════════════════════════════════════════════════
// BUILD phase drives milestones through:
//   PENDING → PLANNING → AWAITING_PLAN → EXECUTING → TESTING → REVIEW → PASSED
//
// Each milestone:
//   1. Generate local plan (D1) → user approves
//   2. Execute via WorkflowOrchestrator (D1→CODE→R2→D2/R1)
//   3. Scope enforcement: verify only allowed files changed (git diff)
//   4. Checkpoint: compare output vs goals (detailed, not just OK/NOT OK)
//   5. Health score: scope_adherence, test_coverage, complexity_delta, tech_debt_delta
//   6. Auto-commit + tag on PASS
//
// On failure: retry (up to max_retries) → BLOCKED → user decides (retry/skip/modify)
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callLLM, parseJSON } from './workflow.js';
import {
  lifecycles as lifecycleRepo,
  milestones as msRepo,
  driftChecks,
} from '../db/database.js';
import {
  milestonePlan as milestonePlanPrompt,
  milestoneCheckpoint as checkpointPrompt,
  healthScore as healthScorePrompt,
} from './lifecycle-prompts.js';
import { checkDependencies } from './lifecycle-planning.js';
import { MilestoneStatus } from './lifecycle.js';
import { C3ToolExecutor } from '../executor/c3-tool-executor.js';
import { validateMilestoneSize } from './milestone-size.js';

// ─── Start Next Milestone ────────────────────────────────────────────────────

/**
 * Find and start the next PENDING milestone.
 * Generates a local plan (D1) for user approval.
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @returns {Promise<{ milestoneId: string, localPlan: Object, status: string }|null>}
 *   null if no more milestones
 */
export async function startNextMilestone(lifecycle) {
  // Find next PENDING milestone
  const next = msRepo.findNext.get(lifecycle.id);
  if (!next) {
    logger.info('LifecycleBuild', 'No more pending milestones', { lifecycleId: lifecycle.id });
    return null;
  }

  const milestone = msRepo.getMilestone(next.id);

  // Check dependencies
  const depCheck = checkDependencies(milestone.id, lifecycle.id);
  if (!depCheck.ready) {
    logger.warn('LifecycleBuild', 'Milestone blocked by dependencies', {
      milestoneId: milestone.id,
      blockedBy: depCheck.blockedBy,
    });
    return {
      milestoneId: milestone.id,
      status: 'BLOCKED_BY_DEPS',
      blockedBy: depCheck.blockedBy,
    };
  }

  // Transition to PLANNING
  msRepo.updateStatus.run(MilestoneStatus.PLANNING, milestone.id);
  msRepo.markStarted.run(milestone.id);

  // Get spec and completed milestones for context
  const spec = lifecycleRepo.getSpec(lifecycle.id);
  const completed = msRepo.getCompleted(lifecycle.id);

  // Generate local plan via D1
  logger.info('LifecycleBuild', 'Generating local plan for milestone', {
    milestoneId: milestone.id,
    title: milestone.title,
  });

  const prompt = milestonePlanPrompt(milestone, spec, completed);
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('D1', prompt);
  const localPlan = parseJSON(result.content);

  if (!localPlan) {
    msRepo.updateStatus.run(MilestoneStatus.PENDING, milestone.id);
    throw new Error(`D1 failed to generate local plan for ${milestone.id}`);
  }

  // Store local plan and scope files
  const scopeFiles = localPlan.scope_files || localPlan.files?.map(f => f.path) || [];
  msRepo.updateLocalPlan.run(
    JSON.stringify(localPlan),
    JSON.stringify(scopeFiles),
    milestone.id
  );

  // Transition to AWAITING_PLAN
  msRepo.updateStatus.run(MilestoneStatus.AWAITING_PLAN, milestone.id);

  return {
    milestoneId: milestone.id,
    title: milestone.title,
    localPlan,
    scopeFiles,
    status: MilestoneStatus.AWAITING_PLAN,
  };
}

// ─── Approve Milestone Plan ──────────────────────────────────────────────────

/**
 * User approves the local plan → start execution.
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {string} milestoneId
 * @returns {Promise<Object>} Execution result
 */
export async function approveMilestonePlan(lifecycle, milestoneId) {
  const milestone = msRepo.getMilestone(milestoneId);
  if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);
  if (milestone.status !== MilestoneStatus.AWAITING_PLAN) {
    throw new Error(`Milestone ${milestoneId} is ${milestone.status}, not AWAITING_PLAN`);
  }

  return executeMilestone(lifecycle, milestone);
}

// ─── Execute Milestone ───────────────────────────────────────────────────────

/**
 * Execute a milestone via WorkflowOrchestrator.
 * Flow: EXECUTING → (WorkflowOrchestrator D1→CODE→R2→D2/R1) → TESTING → REVIEW
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {Object} milestone - Milestone data from DB
 * @returns {Promise<Object>} Result with status, health score, etc.
 */
async function executeMilestone(lifecycle, milestone) {
  // ─── Pre-execution: hard limit on milestone size ───────────────────────
  const sizeCheck = validateMilestoneSize(milestone, {
    maxLOC: lifecycle.config.maxMilestoneLOC,
    maxFiles: lifecycle.config.maxMilestoneFiles,
  });

  if (!sizeCheck.fits) {
    logger.error('LifecycleBuild', 'Milestone exceeds size limits — BLOCKED', {
      milestoneId: milestone.id,
      issues: sizeCheck.issues,
    });
    msRepo.updateStatus.run(MilestoneStatus.BLOCKED, milestone.id);
    return {
      milestoneId: milestone.id,
      status: MilestoneStatus.BLOCKED,
      reason: `Size limit exceeded: ${sizeCheck.issues.join('; ')}`,
      sizeCheck,
      options: ['retry', 'skip', 'modify'],
    };
  }

  if (sizeCheck.warnings.length > 0) {
    logger.warn('LifecycleBuild', 'Milestone size warnings', {
      milestoneId: milestone.id,
      warnings: sizeCheck.warnings,
    });
  }

  // ─── Pre-execution: scope file validation ──────────────────────────────
  const scopeFiles = milestone.scope_files || [];
  if (scopeFiles.length === 0) {
    logger.warn('LifecycleBuild', 'No scope_files defined — scope enforcement will be skipped', {
      milestoneId: milestone.id,
    });
  }

  msRepo.updateStatus.run(MilestoneStatus.EXECUTING, milestone.id);

  logger.info('LifecycleBuild', 'Executing milestone', {
    milestoneId: milestone.id,
    title: milestone.title,
    scopeFiles: scopeFiles.length,
    estimatedLOC: milestone.estimated_loc || 'unknown',
  });

  try {
    // Delegate to executor (DI) or default WorkflowOrchestrator
    const executor = lifecycle.executor || (await import('./index.js')).workflowOrchestrator;

    // Build request from local plan
    const localPlan = milestone.local_plan || {};
    const request = buildMilestoneRequest(milestone, localPlan);

    const wfResult = await executor.start(request, {
      milestoneId: milestone.id,
      lifecycleId: lifecycle.id,
      projectId: lifecycle.projectId,
    });

    // Link workflow session to milestone
    if (wfResult.sessionId) {
      msRepo.updateWorkflowSession.run(wfResult.sessionId, milestone.id);
    }

    // If workflow needs clarification, pass through
    if (wfResult.state === 'CLARIFYING') {
      return {
        milestoneId: milestone.id,
        status: 'WORKFLOW_CLARIFYING',
        workflowSessionId: wfResult.sessionId,
        questions: wfResult.questions,
      };
    }

    // If workflow needs plan approval, auto-approve (we already have a local plan)
    if (wfResult.state === 'AWAITING_APPROVAL') {
      const execResult = await executor.approve(wfResult.sessionId);
      return await postExecution(lifecycle, milestone, execResult);
    }

    // Workflow completed immediately or failed
    return await postExecution(lifecycle, milestone, wfResult);

  } catch (err) {
    logger.error('LifecycleBuild', 'Milestone execution failed', {
      milestoneId: milestone.id,
      error: err.message,
    });

    return handleMilestoneFailure(lifecycle, milestone, err.message);
  }
}

// ─── Post-Execution: Test → Checkpoint → Health → Commit ─────────────────────

/**
 * After WorkflowOrchestrator completes, run testing + checkpoint + health score.
 */
async function postExecution(lifecycle, milestone, wfResult) {
  if (wfResult.state === 'FAILED') {
    return handleMilestoneFailure(lifecycle, milestone, wfResult.error || 'Workflow failed');
  }

  // ─── TESTING phase ──────────────────────────────────────────────────────
  msRepo.updateStatus.run(MilestoneStatus.TESTING, milestone.id);

  const testResults = await runTests(lifecycle, milestone);

  // ─── REVIEW phase — Milestone Checkpoint ────────────────────────────────
  msRepo.updateStatus.run(MilestoneStatus.REVIEW, milestone.id);

  const checkpointResult = await milestoneCheckpoint(lifecycle, milestone, wfResult, testResults);

  // ─── Scope enforcement ──────────────────────────────────────────────────
  const scopeResult = await enforceMilestoneScope(lifecycle, milestone);

  // ─── Health Score ───────────────────────────────────────────────────────
  const health = await computeHealthScore(lifecycle, milestone, wfResult, testResults);

  // ─── Decide: PASS or FAIL ──────────────────────────────────────────────
  const passed = checkpointResult.passed
    && scopeResult.violations.length === 0
    && testResults.allPassed !== false;

  if (!passed) {
    const reason = [
      !checkpointResult.passed && 'checkpoint failed',
      scopeResult.violations.length > 0 && `scope violations: ${scopeResult.violations.join(', ')}`,
      testResults.allPassed === false && 'tests failed',
    ].filter(Boolean).join('; ');

    return handleMilestoneFailure(lifecycle, milestone, reason);
  }

  // ─── PASSED — Auto-commit + tag ────────────────────────────────────────
  let commitHash = null;
  let gitTag = null;

  if (lifecycle.config.autoCommit) {
    const commitResult = await autoCommitMilestone(lifecycle, milestone);
    commitHash = commitResult.commitHash;
    gitTag = commitResult.tag;
  }

  // Update milestone as PASSED
  msRepo.updateCompletion.run(
    commitHash,
    gitTag,
    JSON.stringify(health),
    milestone.id
  );

  lifecycle.incrementCompleted();

  logger.info('LifecycleBuild', 'Milestone PASSED', {
    milestoneId: milestone.id,
    commitHash,
    gitTag,
    health,
  });

  return {
    milestoneId: milestone.id,
    status: MilestoneStatus.PASSED,
    commitHash,
    gitTag,
    healthScore: health,
    checkpoint: checkpointResult,
    testResults,
    scopeCheck: scopeResult,
    reviewDue: lifecycle.isReviewDue(),
  };
}

// ─── Test Execution ──────────────────────────────────────────────────────────

/**
 * Run tests as defined in milestone's test_strategy.
 * Uses git-based approach: check if test files exist, run them.
 */
async function runTests(lifecycle, milestone) {
  const testStrategy = milestone.test_strategy;
  if (!testStrategy) {
    return { allPassed: null, summary: 'No test strategy defined', results: [] };
  }

  // Determine test command from strategy or default to npm test
  const testCommand = testStrategy.command || testStrategy.run || 'npm test';

  logger.info('LifecycleBuild', 'Running tests', {
    milestoneId: milestone.id,
    command: testCommand,
  });

  try {
    const executor = new C3ToolExecutor();
    const result = await executor.execute({
      correlationId: `test-${milestone.id}-${Date.now()}`,
      tool: 'shell',
      args: {
        command: testCommand,
        cwd: lifecycle.projectPath,
      },
      timeoutMs: 120000, // 2 min for tests
    });

    if (result.status === 'timeout') {
      return {
        allPassed: false,
        exitCode: -1,
        summary: `Tests timed out after 120s (${testCommand})`,
        command: testCommand,
        strategy: testStrategy,
      };
    }

    if (result.status === 'cancelled') {
      return {
        allPassed: null,
        exitCode: -1,
        summary: 'Test execution cancelled',
        command: testCommand,
        strategy: testStrategy,
      };
    }

    const stdout = result.output?.stdout || '';
    const stderr = result.output?.stderr || '';
    const exitCode = result.output?.exitCode ?? (result.status === 'ok' ? 0 : 1);

    logger.info('LifecycleBuild', `Tests ${exitCode === 0 ? 'PASSED' : 'FAILED'}`, {
      milestoneId: milestone.id,
      exitCode,
      stdoutLen: stdout.length,
      stderrLen: stderr.length,
    });

    return {
      allPassed: exitCode === 0,
      exitCode,
      summary: exitCode === 0
        ? `Tests passed (${testCommand})`
        : `Tests failed with exit code ${exitCode}`,
      stdout: stdout.slice(-2000), // last 2000 chars to keep context manageable
      stderr: stderr.slice(-1000),
      command: testCommand,
      strategy: testStrategy,
    };
  } catch (err) {
    logger.error('LifecycleBuild', 'Test execution error', {
      milestoneId: milestone.id,
      error: err.message,
    });

    return {
      allPassed: false,
      exitCode: -1,
      summary: `Test execution error: ${err.message}`,
      command: testCommand,
      strategy: testStrategy,
    };
  }
}

// ─── Milestone Checkpoint ────────────────────────────────────────────────────

/**
 * Detailed comparison of output vs goals.
 * Uses concrete git diff, file list, goals, test results.
 */
async function milestoneCheckpoint(lifecycle, milestone, wfResult, testResults) {
  // Get actual git diff
  const gitDiff = await getGitDiff(lifecycle);
  const changedFiles = await getChangedFiles(lifecycle);

  const prompt = checkpointPrompt(milestone, gitDiff, changedFiles, testResults);
  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('R1', prompt);
  const checkpoint = parseJSON(result.content);

  if (!checkpoint) {
    logger.warn('LifecycleBuild', 'Checkpoint parse failed — treating as FAIL (safe default)', {
      milestoneId: milestone.id,
    });
    return { passed: false, raw: result.content, reason: 'Checkpoint response was not valid JSON' };
  }

  // Store checkpoint as drift check
  driftChecks.addCheck(
    lifecycle.id,
    milestone.id,
    'MILESTONE_CHECKPOINT',
    checkpoint.passed ? 'PASS' : 'FAIL',
    checkpoint
  );

  return checkpoint;
}

// ─── Scope Enforcement ───────────────────────────────────────────────────────

/**
 * Enforce milestone scope: compare git diff --name-only against scope_files.
 * IMPORTANT: Works on REAL git diff, not orchestrator assumptions.
 */
async function enforceMilestoneScope(lifecycle, milestone) {
  const scopeFiles = milestone.scope_files || [];
  if (scopeFiles.length === 0) {
    // No scope defined → no enforcement
    return { enforced: false, violations: [], reason: 'no scope_files defined' };
  }

  const changedFiles = await getChangedFiles(lifecycle);
  if (changedFiles.length === 0) {
    return { enforced: true, violations: [] };
  }

  const violations = [];
  for (const file of changedFiles) {
    // Check if file matches any scope pattern
    const inScope = scopeFiles.some(pattern => {
      // Exact match
      if (file === pattern) return true;
      // Directory match (scope_files: "src/auth/" → matches "src/auth/login.js")
      if (pattern.endsWith('/') && file.startsWith(pattern)) return true;
      // Glob-like: "src/*.js" → matches "src/index.js"
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]*') + '$');
        return regex.test(file);
      }
      return false;
    });

    if (!inScope) {
      violations.push(file);
    }
  }

  if (violations.length > 0) {
    logger.warn('LifecycleBuild', 'Scope violations detected', {
      milestoneId: milestone.id,
      violations,
    });

    driftChecks.addCheck(
      lifecycle.id,
      milestone.id,
      'SCOPE_VIOLATION',
      'FAIL',
      { violations, scopeFiles, changedFiles }
    );
  }

  return { enforced: true, violations, scopeFiles, changedFiles };
}

// ─── Health Score ────────────────────────────────────────────────────────────

/**
 * Compute health score for a completed milestone.
 * 4 metrics: scope_adherence, test_coverage, complexity_delta, tech_debt_delta
 */
async function computeHealthScore(lifecycle, milestone, wfResult, testResults) {
  const gitDiff = await getGitDiff(lifecycle);

  // Get previous health scores for trend analysis
  const completed = msRepo.getCompleted(lifecycle.id);
  const previousScores = completed
    .filter(m => m.health_score)
    .map(m => m.health_score);

  const prompt = healthScorePrompt(milestone, gitDiff, testResults, previousScores);

  try {
    const llm = lifecycle.callLLM || callLLM;
    const result = await llm('R2', prompt);
    const score = parseJSON(result.content);

    if (score && typeof score.scope_adherence === 'number') {
      return {
        scope_adherence: clamp(score.scope_adherence, 0, 1),
        test_coverage: clamp(score.test_coverage, 0, 1),
        complexity_delta: clamp(score.complexity_delta, 0, 1),
        tech_debt_delta: clamp(score.tech_debt_delta, 0, 1),
      };
    }
  } catch (err) {
    logger.warn('LifecycleBuild', 'Health score computation failed', {
      milestoneId: milestone.id,
      error: err.message,
    });
  }

  // Fallback: neutral score
  return {
    scope_adherence: 0.8,
    test_coverage: 0.5,
    complexity_delta: 0.2,
    tech_debt_delta: 0.1,
  };
}

// ─── Auto-Commit ─────────────────────────────────────────────────────────────

/**
 * Commit milestone output + create tag.
 * Format: feat(ms-N): <title>, Tag: ms-N
 */
async function autoCommitMilestone(lifecycle, milestone) {
  let commitHash = null;
  let tag = null;

  try {
    const commitResult = await lifecycle.git.commitMilestone(milestone.id, milestone.title);
    commitHash = commitResult.commitHash;

    if (commitHash) {
      const tagResult = await lifecycle.git.tagMilestone(milestone.id, milestone.title);
      tag = tagResult.tag;
    }
  } catch (err) {
    logger.warn('LifecycleBuild', 'Auto-commit failed (non-fatal)', {
      milestoneId: milestone.id,
      error: err.message,
    });
  }

  return { commitHash, tag };
}

// ─── Failure Handling ────────────────────────────────────────────────────────

/**
 * Handle milestone failure: retry or BLOCKED.
 */
function handleMilestoneFailure(lifecycle, milestone, reason) {
  const maxRetries = milestone.max_retries || lifecycle.config.maxMilestoneRetries;
  const currentRetry = milestone.retry_count || 0;

  if (currentRetry < maxRetries) {
    // Retry
    msRepo.updateRetry.run(milestone.id);
    msRepo.updateStatus.run(MilestoneStatus.PENDING, milestone.id);

    logger.warn('LifecycleBuild', `Milestone failed, will retry (${currentRetry + 1}/${maxRetries})`, {
      milestoneId: milestone.id,
      reason,
    });

    return {
      milestoneId: milestone.id,
      status: 'RETRY',
      retryCount: currentRetry + 1,
      maxRetries,
      reason,
    };
  }

  // BLOCKED — needs user decision
  msRepo.updateStatus.run(MilestoneStatus.BLOCKED, milestone.id);

  logger.error('LifecycleBuild', 'Milestone BLOCKED', {
    milestoneId: milestone.id,
    retries: currentRetry,
    reason,
  });

  return {
    milestoneId: milestone.id,
    status: MilestoneStatus.BLOCKED,
    retryCount: currentRetry,
    maxRetries,
    reason,
    options: ['retry', 'skip', 'modify'],
  };
}

/**
 * Handle user decision for a BLOCKED milestone.
 * @param {Object} lifecycle
 * @param {string} milestoneId
 * @param {'retry'|'skip'|'modify'} decision
 * @param {string} [feedback] - For 'modify' — what to change
 * @returns {Promise<Object>}
 */
export async function handleMilestoneBlocked(lifecycle, milestoneId, decision, feedback = '') {
  const milestone = msRepo.getMilestone(milestoneId);
  if (!milestone) throw new Error(`Milestone ${milestoneId} not found`);
  if (milestone.status !== MilestoneStatus.BLOCKED) {
    throw new Error(`Milestone ${milestoneId} is ${milestone.status}, not BLOCKED`);
  }

  switch (decision) {
    case 'retry': {
      // Reset retry count and try again
      msRepo.updateStatus.run(MilestoneStatus.PENDING, milestoneId);
      // Re-run from startNextMilestone
      return { milestoneId, status: 'WILL_RETRY', message: 'Milestone reset to PENDING for retry' };
    }

    case 'skip': {
      // Validate: no other milestone depends on this one
      const allMs = msRepo.listByLifecycle(lifecycle.id);
      const dependents = allMs.filter(m =>
        m.dependencies && m.dependencies.includes(milestoneId) && m.status !== 'PASSED'
      );

      if (dependents.length > 0) {
        return {
          milestoneId,
          status: 'CANNOT_SKIP',
          reason: `Milestones depend on this: ${dependents.map(d => d.id).join(', ')}`,
        };
      }

      msRepo.updateStatus.run(MilestoneStatus.SKIPPED, milestoneId);
      logger.info('LifecycleBuild', 'Milestone skipped by user', { milestoneId });
      return { milestoneId, status: MilestoneStatus.SKIPPED };
    }

    case 'modify': {
      // User wants to modify the milestone — reset and re-plan with feedback
      msRepo.updateStatus.run(MilestoneStatus.PENDING, milestoneId);

      // Store feedback in local plan for next planning round
      const currentPlan = milestone.local_plan || {};
      const modifiedPlan = {
        ...currentPlan,
        _userFeedback: feedback,
        _modifiedAt: new Date().toISOString(),
      };
      msRepo.updateLocalPlan.run(JSON.stringify(modifiedPlan), null, milestoneId);

      return { milestoneId, status: 'WILL_MODIFY', feedback };
    }

    default:
      throw new Error(`Unknown decision: ${decision}. Use retry, skip, or modify.`);
  }
}

// ─── Build Progress ──────────────────────────────────────────────────────────

/**
 * Get overall BUILD phase progress.
 */
export function getBuildProgress(lifecycleId) {
  const allMs = msRepo.listByLifecycle(lifecycleId);
  const total = allMs.length;
  if (total === 0) return { percentage: 0, total: 0, completed: 0, pending: 0, blocked: 0 };

  const completed = allMs.filter(m => m.status === MilestoneStatus.PASSED).length;
  const skipped = allMs.filter(m => m.status === MilestoneStatus.SKIPPED).length;
  const blocked = allMs.filter(m => m.status === MilestoneStatus.BLOCKED).length;
  const executing = allMs.filter(m =>
    [MilestoneStatus.PLANNING, MilestoneStatus.AWAITING_PLAN, MilestoneStatus.EXECUTING,
     MilestoneStatus.TESTING, MilestoneStatus.REVIEW].includes(m.status)
  ).length;
  const pending = allMs.filter(m => m.status === MilestoneStatus.PENDING).length;

  return {
    percentage: Math.round(((completed + skipped) / total) * 100),
    total,
    completed,
    skipped,
    blocked,
    executing,
    pending,
    milestones: allMs.map(m => ({
      id: m.id,
      title: m.title,
      status: m.status,
      sequence: m.sequence,
      healthScore: m.health_score,
    })),
  };
}

// ─── Git Helpers ─────────────────────────────────────────────────────────────

async function getGitDiff(lifecycle) {
  try {
    const result = await lifecycle.git.git('diff', 'HEAD~1', '--stat');
    return result.success ? result.stdout : 'No diff available';
  } catch {
    return 'No diff available';
  }
}

async function getChangedFiles(lifecycle) {
  try {
    const result = await lifecycle.git.git('diff', '--name-only', 'HEAD~1');
    if (result.success && result.stdout) {
      return result.stdout.split('\n').filter(f => f.trim().length > 0);
    }
  } catch { /* ignore */ }
  return [];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMilestoneRequest(milestone, localPlan) {
  const steps = localPlan.implementation_steps || [];
  const stepsStr = steps.map(s => `${s.step}. ${s.action}`).join('\n');

  return `Implement milestone "${milestone.title}":

${milestone.description || ''}

Implementation steps:
${stepsStr || 'Follow the local plan.'}

Files to create/modify:
${(localPlan.files || []).map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join('\n') || 'As defined in plan.'}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default {
  startNextMilestone,
  approveMilestonePlan,
  handleMilestoneBlocked,
  getBuildProgress,
};
