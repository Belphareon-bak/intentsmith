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

// v93: Notification emitter reference (set by server.js via setNotificationEmitter)
let _notificationEmitter = null;
export function setNotificationEmitter(emitter) { _notificationEmitter = emitter; }
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
import { checkDependencies, writeRoadmapFile } from './lifecycle-planning.js';
import { MilestoneStatus, CheckpointMode } from './lifecycle.js';
import { ensureReadme, ensureArchitectureDoc, appendReadmeChangelog } from '../chat/handlers/utils/readme-generator.js';
import { C3ToolExecutor } from '../executor/c3-tool-executor.js';
import { validateMilestoneSize } from './milestone-size.js';
import { runQualityGate } from './quality-gate.js';

// v95: Code intelligence — lazy-loaded for BUILD context enrichment
let _codeIntelLoaded = false;
let _searchCode, _rankFiles, _buildCodeContext, _expandQuery, _detectArchitecture, _formatArchitectureForPrompt;

async function ensureCodeIntel() {
  if (_codeIntelLoaded) return true;
  try {
    const [search, discovery, context, expander, arch] = await Promise.all([
      import('../code-intel/code-search.js'),
      import('../code-intel/file-discovery.js'),
      import('../code-intel/context-builder.js'),
      import('../code-intel/query-expander.js'),
      import('../code-intel/architecture-detector.js'),
    ]);
    _searchCode = search.searchCode;
    _rankFiles = discovery.rankFiles;
    _buildCodeContext = context.buildCodeContext;
    _expandQuery = expander.expandQuery;
    _detectArchitecture = arch.detectArchitecture;
    _formatArchitectureForPrompt = arch.formatArchitectureForPrompt;
    _codeIntelLoaded = true;
    return true;
  } catch (err) {
    logger.warn('LifecycleBuild', `Code-intel modules not available: ${err.message}`);
    return false;
  }
}

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
  // Find ALL pending milestones (not just first) to skip dependency-blocked ones
  const allPending = msRepo.findByStatus.all(lifecycle.id, 'PENDING').map(r => msRepo.getMilestone(r.id));
  if (allPending.length === 0) {
    logger.info('LifecycleBuild', 'No more pending milestones', { lifecycleId: lifecycle.id });

    // v93: Email notification on lifecycle complete
    if (_notificationEmitter) {
      _notificationEmitter.emitLifecycleEvent({
        type: 'lifecycle_complete',
        projectName: lifecycle.id,
        details: `Všechny milníky dokončeny.`,
      }).catch(() => {});
    }

    return null;
  }

  // Try each pending milestone in sequence order — find first with satisfied deps
  const blockedMilestones = [];
  let milestone = null;

  for (const candidate of allPending) {
    const depCheck = checkDependencies(candidate.id, lifecycle.id);
    if (!depCheck.ready) {
      blockedMilestones.push({
        milestoneId: candidate.id,
        title: candidate.title,
        blockedBy: depCheck.blockedBy,
      });
      continue;
    }
    milestone = candidate;
    break;
  }

  if (!milestone) {
    // ALL pending milestones are dependency-blocked
    logger.warn('LifecycleBuild', 'All pending milestones are dependency-blocked', {
      lifecycleId: lifecycle.id,
      blocked: blockedMilestones,
    });

    // v93: Email notification on ALL_BLOCKED
    if (_notificationEmitter) {
      _notificationEmitter.emitLifecycleEvent({
        type: 'milestone_blocked',
        projectName: lifecycle.id,
        milestoneTitle: blockedMilestones.map(b => b.title).join(', '),
        details: `Všechny pending milníky jsou dependency-blocked.`,
      }).catch(() => {});
    }

    return {
      milestoneId: null,
      status: 'ALL_BLOCKED',
      blockedMilestones,
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

  // Validate milestone plan quality
  const planCheck = validateMilestonePlan(localPlan);
  if (!planCheck.valid) {
    logger.warn('LifecycleBuild', 'Milestone plan validation failed, retrying D1', {
      milestoneId: milestone.id,
      errors: planCheck.errors,
    });
    // Retry once with explicit instruction
    const retryPrompt = prompt + '\n\nIMPORTANT: Be more specific. Each implementation step MUST be actionable (use verbs like create, implement, add, configure). Minimum 3 concrete steps. Include target files.';
    const retryResult = await llm('D1', retryPrompt);
    const retryPlan = parseJSON(retryResult.content);
    if (retryPlan) {
      const retryCheck = validateMilestonePlan(retryPlan);
      if (retryCheck.valid) {
        Object.assign(localPlan, retryPlan);
      }
      // If still invalid, proceed with best effort — don't block
    }
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
    let request = buildMilestoneRequest(milestone, localPlan);

    // v95: Enrich with existing code context + architecture detection
    const codeContext = await buildCodeContextForMilestone(lifecycle.projectPath, milestone, localPlan);
    if (codeContext) {
      request += codeContext;
    }

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

  // ─── QUALITY GATE — Compile/Syntax Check ──────────────────────────────
  const changedFiles = await getChangedFiles(lifecycle);
  const spec = lifecycleRepo.getSpec(lifecycle.id);

  let qualityGateResult = await runQualityGate(
    lifecycle.projectPath, spec?.tech_stack || {}, changedFiles
  );

  // Fallback: if changedFiles check failed, try full project scan
  if (!qualityGateResult.passed) {
    const fullScan = await runQualityGate(
      lifecycle.projectPath, spec?.tech_stack || {}, null, { mode: 'full-project' }
    );
    qualityGateResult = fullScan;
  }

  driftChecks.addCheck(lifecycle.id, milestone.id, 'QUALITY_GATE',
    qualityGateResult.status, qualityGateResult);

  // Short-circuit: skip R1 checkpoint if compile failed (saves 60+s LLM call)
  if (!qualityGateResult.passed) {
    milestone._lastCompileErrors = qualityGateResult.results
      .filter(r => !r.passed)
      .map(r => `${r.file}:${r.line || '?'} ${r.message || r.error}`);
    return handleMilestoneFailure(lifecycle, milestone,
      `compile errors: ${milestone._lastCompileErrors.join('; ')}`);
  }

  // ─── REVIEW phase — Milestone Checkpoint ────────────────────────────────
  msRepo.updateStatus.run(MilestoneStatus.REVIEW, milestone.id);

  // When test_strategy is null/deferred, tell R1 explicitly so it doesn't penalize
  const testResultsForCheckpoint = testResults.allPassed === null
    ? { ...testResults, note: 'Test execution deferred — no test_strategy defined for this milestone. Do NOT fail the checkpoint for missing tests.' }
    : testResults;

  // Adaptive retry: pass previous findings from failed attempts
  const previousFindings = milestone._lastCheckpointFindings || null;
  const checkpointResult = await milestoneCheckpoint(lifecycle, milestone, wfResult, testResultsForCheckpoint, previousFindings, qualityGateResult);

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

    // Adaptive retry: store checkpoint findings so next attempt can address them
    if (!checkpointResult.passed && checkpointResult.fix_instructions?.length > 0) {
      milestone._lastCheckpointFindings = {
        fix_instructions: checkpointResult.fix_instructions,
        security_findings: checkpointResult.security_findings || [],
        error_handling_gaps: checkpointResult.error_handling_gaps || [],
        overall_assessment: checkpointResult.overall_assessment,
      };
    }

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

  // Update ROADMAP.md with new milestone status
  await writeRoadmapFile(lifecycle.projectPath, lifecycle.id);

  // spec already fetched above (quality gate section)
  const completedMs = msRepo.getCompleted(lifecycle.id);
  const completedCount = completedMs.length; // already includes this milestone (status just set to PASSED)

  // First milestone PASS: generate full README + ARCHITECTURE.md from spec
  if (completedCount === 1 && spec) {
    ensureReadme(lifecycle.projectPath, { spec });
    ensureArchitectureDoc(lifecycle.projectPath, spec);
  } else {
    // Subsequent milestones: just update stack/scripts + append changelog
    ensureReadme(lifecycle.projectPath, { spec });
    appendReadmeChangelog(lifecycle.projectPath, milestone, {
      filesChanged: (await getChangedFiles(lifecycle)).length,
      newFiles: (await getChangedFiles(lifecycle)).filter(f => !f.startsWith('.')),
    });
  }

  logger.info('LifecycleBuild', 'Milestone PASSED', {
    milestoneId: milestone.id,
    commitHash,
    gitTag,
    health,
  });

  // v93: Email notification on milestone PASS
  if (_notificationEmitter) {
    _notificationEmitter.emitLifecycleEvent({
      type: 'milestone_pass',
      projectName: spec?.name || lifecycle.id,
      milestoneTitle: milestone.title,
      details: `Commit: ${commitHash || 'N/A'}, Health: ${JSON.stringify(health)}`,
    }).catch(() => {});
  }

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
/**
 * Determine checkpoint mode for a milestone.
 * Priority: explicit checkpoint_mode on milestone > positional heuristic.
 */
function resolveCheckpointMode(milestone, lifecycle) {
  // 1. Explicit mode set by roadmap generator
  if (milestone.checkpoint_mode && CheckpointMode[milestone.checkpoint_mode]) {
    return milestone.checkpoint_mode;
  }

  // 2. Heuristic: first ms = STRUCTURAL, last ms = SECURITY, rest = FUNCTIONAL
  const allMs = msRepo.listByLifecycle(lifecycle.id);
  const totalMs = allMs.length;
  const seq = milestone.sequence || 1;

  if (seq === 1) return CheckpointMode.STRUCTURAL;
  if (seq >= totalMs) return CheckpointMode.SECURITY;
  return CheckpointMode.FUNCTIONAL;
}

async function milestoneCheckpoint(lifecycle, milestone, wfResult, testResults, previousFindings = null, qualityGateResult = null) {
  // Get actual git diff
  const gitDiff = await getGitDiff(lifecycle);
  const changedFiles = await getChangedFiles(lifecycle);

  const checkpointMode = resolveCheckpointMode(milestone, lifecycle);

  const prompt = checkpointPrompt(milestone, gitDiff, changedFiles, testResults, {
    checkpointMode,
    previousFindings,
    qualityGateResult,
  });

  logger.info('LifecycleBuild', `Checkpoint mode: ${checkpointMode}`, {
    milestoneId: milestone.id,
    explicit: !!milestone.checkpoint_mode,
  });

  const llm = lifecycle.callLLM || callLLM;
  const result = await llm('R1', prompt);
  const checkpoint = parseJSON(result.content);

  if (!checkpoint) {
    // Log first 500 chars of raw response for diagnosis
    const raw = result.content || '';
    logger.warn('LifecycleBuild', 'Checkpoint parse failed — treating as FAIL (safe default)', {
      milestoneId: milestone.id,
      rawPreview: raw.substring(0, 500),
    });
    return { passed: false, raw, reason: 'Checkpoint response was not valid JSON', checkpointMode };
  }

  // Store checkpoint mode on result
  checkpoint.checkpointMode = checkpointMode;

  // Log checkpoint verdict for diagnostics
  logger.info('LifecycleBuild', `Checkpoint verdict: ${checkpoint.passed ? 'PASS' : 'FAIL'} (${checkpointMode})`, {
    milestoneId: milestone.id,
    assessment: checkpoint.overall_assessment?.substring(0, 200),
    securityFindings: checkpoint.security_findings?.length || 0,
    errorGaps: checkpoint.error_handling_gaps?.length || 0,
  });

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
// Engine-managed files — always allowed, never scope violations
const ENGINE_MANAGED_FILES = new Set(['ROADMAP.md', 'README.md', 'ARCHITECTURE.md', '.gitignore']);

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
    // Skip engine-managed files (ROADMAP.md, README.md)
    if (ENGINE_MANAGED_FILES.has(file)) continue;

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

  // v93: Email notification on milestone BLOCKED (retries exhausted)
  if (_notificationEmitter) {
    _notificationEmitter.emitLifecycleEvent({
      type: 'milestone_fail',
      projectName: lifecycle.id,
      milestoneTitle: milestone.title,
      details: `Důvod: ${reason}`,
      retryCount: currentRetry,
    }).catch(() => {});
  }

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

// ─── Code Context for BUILD ──────────────────────────────────────────────────

const DOCS_ONLY_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc', '.doc']);

/**
 * Build code context to inject into milestone request.
 * Searches existing codebase for patterns relevant to the milestone scope.
 *
 * @param {string} projectPath - Absolute project path
 * @param {Object} milestone - Milestone data
 * @param {Object} localPlan - Local plan with files/steps
 * @returns {Promise<string>} Context string to append to request (empty if N/A)
 */
async function buildCodeContextForMilestone(projectPath, milestone, localPlan) {
  if (!await ensureCodeIntel()) return '';

  // Guard: skip for docs-only milestones
  const scopeFiles = milestone.scope_files || localPlan.files?.map(f => f.path) || [];
  if (scopeFiles.length > 0 && scopeFiles.every(f => DOCS_ONLY_EXTENSIONS.has(f.substring(f.lastIndexOf('.'))))) {
    logger.info('LifecycleBuild', 'Docs-only milestone — skipping code context', { milestoneId: milestone.id });
    return '';
  }

  try {
    // Extract search terms from milestone title + description + scope files
    const searchText = [
      milestone.title || '',
      milestone.description || '',
      ...scopeFiles.map(f => f.replace(/\.[^.]+$/, '').replace(/[/\\]/g, ' ')),
    ].join(' ');

    const expanded = _expandQuery(searchText);
    const queryTerms = [...expanded.primary, ...expanded.secondary].slice(0, 8);

    if (queryTerms.length === 0) return '';

    // Search with top 3 queries, max 20 results each
    let allResults = [];
    for (const term of queryTerms.slice(0, 3)) {
      const sr = await _searchCode(projectPath, term, { maxResults: 20, contextLines: 2 });
      allResults.push(...sr.results);
    }

    // Dedup
    const seen = new Set();
    allResults = allResults.filter(r => {
      const key = `${r.file}:${r.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (allResults.length === 0) return '';

    // Rank files
    const rankedFiles = await _rankFiles(allResults, queryTerms, { projectPath });

    // Build compact code context (smaller budget than full CODE_ANALYSIS)
    const codeCtx = await _buildCodeContext(projectPath, rankedFiles, {
      maxFiles: 5,
      maxTokens: 5000,
      maxLinesPerFile: 100,
      queryTerms,
    });

    // Architecture detection
    const arch = _detectArchitecture(codeCtx.files.map(f => ({
      file: f.path,
      content: '', // files don't have content in fileInfos — detection uses path patterns
    })));

    // Also detect from ranked results (which have content hints)
    const archFromResults = _detectArchitecture(allResults.slice(0, 30).map(r => ({
      file: r.file,
      content: r.content || '',
    })));

    // Merge frameworks and patterns
    const mergedFrameworks = [...new Set([...arch.framework, ...archFromResults.framework])];
    const mergedPatterns = [...new Set([...arch.patterns, ...archFromResults.patterns])];
    const mergedArch = { ...archFromResults, framework: mergedFrameworks, patterns: mergedPatterns };

    // Build prompt sections
    const parts = [];

    if (codeCtx.context) {
      parts.push(`\n\n## Existing Code Context\nRelevant existing code from the project (${codeCtx.files.length} files, ${codeCtx.totalTokens} tokens):\n\n${codeCtx.context}`);
    }

    const archSection = _formatArchitectureForPrompt(mergedArch);
    if (archSection) {
      parts.push(`\n\n${archSection}`);
    }

    logger.info('LifecycleBuild', 'Code context enrichment complete', {
      milestoneId: milestone.id,
      files: codeCtx.files.length,
      tokens: codeCtx.totalTokens,
      frameworks: mergedFrameworks,
      patterns: mergedPatterns,
    });

    return parts.join('');
  } catch (err) {
    logger.warn('LifecycleBuild', `Code context enrichment failed: ${err.message}`, { stack: err.stack });
    return ''; // graceful degradation
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMilestoneRequest(milestone, localPlan) {
  const steps = localPlan.implementation_steps || [];
  const stepsStr = steps.map(s => `${s.step}. ${s.action}`).join('\n');

  let request = `Implement milestone "${milestone.title}":

${milestone.description || ''}

Implementation steps:
${stepsStr || 'Follow the local plan.'}

Files to create/modify:
${(localPlan.files || []).map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join('\n') || 'As defined in plan.'}

Documentation:
- Add JSDoc/docstrings to all public API functions
- If adding API endpoints: include request/response examples in code comments
- Include inline usage examples for key functions`;

  // Adaptive retry: include checkpoint feedback from previous failed attempt
  if (milestone._lastCheckpointFindings) {
    const findings = milestone._lastCheckpointFindings;
    request += `\n\nCRITICAL — Previous attempt FAILED checkpoint. You MUST fix these issues:`;
    if (findings.fix_instructions?.length > 0) {
      request += '\n' + findings.fix_instructions.map(f => `- ${f}`).join('\n');
    }
    if (findings.security_findings?.length > 0) {
      request += '\nSecurity issues to fix:\n' + findings.security_findings.map(f => `- ${f}`).join('\n');
    }
    if (findings.error_handling_gaps?.length > 0) {
      request += '\nError handling to add:\n' + findings.error_handling_gaps.map(f => `- ${f}`).join('\n');
    }
  }

  // Quality Gate: compile errors from previous attempt
  if (milestone._lastCompileErrors?.length) {
    request += '\n\n⚠️ COMPILE ERRORS from previous attempt (MUST FIX):\n';
    for (const err of milestone._lastCompileErrors) {
      request += `- ${err}\n`;
    }
    request += '\nFix ALL compile errors. Each error shows file:line and the error message.\n';
  }

  return request;
}

/**
 * Validate milestone plan quality — deterministický check.
 * Ověří: min 3 kroky, akční slovesa, target soubory.
 */
function validateMilestonePlan(plan) {
  const errors = [];
  const steps = plan.implementation_steps || plan.steps || [];

  if (steps.length < 3) {
    errors.push(`Need ≥3 implementation steps, got ${steps.length}`);
  }

  const actionVerbs = /create|implement|add|write|configure|set\s*up|install|define|build|test|update|modify|extend|integrate|initialize|register|connect|validate|handle|parse|render|import|export|setup/i;
  for (const step of steps) {
    const text = step.action || step.description || (typeof step === 'string' ? step : '');
    if (typeof text === 'string' && text.length > 5 && !actionVerbs.test(text)) {
      errors.push(`Step "${text.substring(0, 50)}" lacks action verb`);
    }
  }

  if (!plan.files?.length && !plan.scope_files?.length) {
    errors.push('Plan has no target files');
  }

  return { valid: errors.length === 0, errors };
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
