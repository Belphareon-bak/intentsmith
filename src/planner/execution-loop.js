// Execution Loop v104 (F3) — Iterative Fix Cycle
// ══════════════════════════════════════════════════════════════════════════════
//
// Pipeline: generate → test → diagnose (F2) → patch (F1) → test → converge/stop
//
// Guards:
//   - Compile-first priority (compile errors before test errors)
//   - Error frontier filtering (root causes + max 5 dependents)
//   - Patch scope limit (max 5 files per iteration)
//   - File loop protection (max 3 patches per file)
//   - Patch oscillation detection (hash-based repeat detection)
//   - Preview before apply (previewPatch validation)
//   - Divergence rollback (×2 threshold)
//   - Prompt size limits (last 2 patches, 4000 char git diff)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { config } from '../config.js';
import { applyPatchSet, parseLLMOutput, rollbackPatch, previewPatch } from '../patch/patch-engine.js';
import { clearBackups, formatPatch } from '../patch/patch-applier.js';
import {
  normalizeErrors, deduplicateErrors, classifyRecoverability,
  findRootCause, formatErrorsForLLM,
} from './error-normalizer.js';

// v111: Fix Strategy Selection — lazy-loaded
let _strategyLoaded = false;
let _selectFixStrategy, _buildDeterministicPatch, _validateDeterministicPatch;
let _buildHeuristicHint, _formatStrategyReport;

async function ensureFixStrategy() {
  if (_strategyLoaded) return true;
  try {
    const mod = await import('./fix-strategy.js');
    _selectFixStrategy = mod.selectFixStrategy;
    _buildDeterministicPatch = mod.buildDeterministicPatch;
    _validateDeterministicPatch = mod.validateDeterministicPatch;
    _buildHeuristicHint = mod.buildHeuristicHint;
    _formatStrategyReport = mod.formatStrategyReport;
    _strategyLoaded = true;
    return true;
  } catch (err) {
    logger.warn('ExecutionLoop', `Fix strategy not available: ${err.message}`);
    return false;
  }
}

// v110: Context Delta Engine — lazy-loaded
let _deltaLoaded = false;
let _createContextSnapshot, _computeContextDelta, _formatDeltaForPrompt;

async function ensureContextDelta() {
  if (_deltaLoaded) return true;
  try {
    const mod = await import('../context/context-delta.js');
    _createContextSnapshot = mod.createContextSnapshot;
    _computeContextDelta = mod.computeContextDelta;
    _formatDeltaForPrompt = mod.formatDeltaForPrompt;
    _deltaLoaded = true;
    return true;
  } catch (err) {
    logger.warn('ExecutionLoop', `Context delta not available: ${err.message}`);
    return false;
  }
}

// v119: Prompt Builder — lazy-loaded
let _promptBuilderLoaded = false;
let _buildStructuredPrompt;

async function ensurePromptBuilder() {
  if (_promptBuilderLoaded) return true;
  try {
    const mod = await import('../context/prompt-builder.js');
    _buildStructuredPrompt = mod.buildStructuredPrompt;
    _promptBuilderLoaded = true;
    return true;
  } catch (err) {
    logger.warn('ExecutionLoop', `Prompt builder not available: ${err.message}`);
    return false;
  }
}

// v119: Import Map — lazy-loaded
let _importMapLoaded = false;
let _buildImportMap, _detectSymbolConflicts, _formatImportMap;

async function ensureImportMap() {
  if (_importMapLoaded) return true;
  try {
    const mod = await import('../context/import-map.js');
    _buildImportMap = mod.buildImportMap;
    _detectSymbolConflicts = mod.detectSymbolConflicts;
    _formatImportMap = mod.formatImportMap;
    _importMapLoaded = true;
    return true;
  } catch (err) {
    logger.warn('ExecutionLoop', `Import map not available: ${err.message}`);
    return false;
  }
}

// v119: Scope Limiter — lazy-loaded
let _scopeLimiterLoaded = false;
let _computePatchScope, _validatePatchScope, _formatScopeHint, _ScopeViolationTracker;

async function ensureScopeLimiter() {
  if (_scopeLimiterLoaded) return true;
  try {
    const mod = await import('../patch/scope-limiter.js');
    _computePatchScope = mod.computePatchScope;
    _validatePatchScope = mod.validatePatchScope;
    _formatScopeHint = mod.formatScopeHint;
    _ScopeViolationTracker = mod.ScopeViolationTracker;
    _scopeLimiterLoaded = true;
    return true;
  } catch (err) {
    logger.warn('ExecutionLoop', `Scope limiter not available: ${err.message}`);
    return false;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_PATCH_FILES = 5;
const MAX_FILE_PATCHES = 3;
const MAX_GIT_DIFF_CHARS = 4000;
const MAX_PROMPT_PATCHES = 2;
const MAX_FRONTIER_DEPENDENTS = 5;

// ─── Convergence Detection ──────────────────────────────────────────────────

/**
 * Decide whether the fix loop should continue.
 *
 * @param {Array} currentErrors - NormalizedError[] from latest iteration
 * @param {Array} previousErrors - NormalizedError[] from previous iteration
 * @param {number} iteration - Current iteration (1-based)
 * @param {number} maxIter - Maximum iterations allowed
 * @returns {{ continue: boolean, reason: string }}
 */
export function shouldContinue(currentErrors, previousErrors, iteration, maxIter) {
  if (iteration >= maxIter) return { continue: false, reason: 'budget_exhausted' };
  if (!currentErrors || currentErrors.length === 0) return { continue: false, reason: 'all_passed' };

  // Filter to errors only (skip warnings for convergence)
  const currErrs = currentErrors.filter(e => e.severity === 'error');
  const prevErrs = (previousErrors || []).filter(e => e.severity === 'error');

  if (currErrs.length === 0) return { continue: false, reason: 'all_passed' };

  // Same errors as last iteration → not converging
  if (prevErrs.length > 0) {
    const same = currErrs.length === prevErrs.length &&
      currErrs.every(e => prevErrs.some(p => p.code === e.code && p.file === e.file && p.line === e.line));
    if (same) return { continue: false, reason: 'not_converging' };
  }

  // Error count ×2 → diverging
  if (prevErrs.length > 0 && currErrs.length > prevErrs.length * 2) {
    return { continue: false, reason: 'diverging' };
  }

  // All remaining unrecoverable → stop
  const allUnrecoverable = currErrs.every(e => !e.recoverable);
  if (allUnrecoverable) return { continue: false, reason: 'unrecoverable' };

  return { continue: true, reason: 'errors_decreasing' };
}

// ─── Error Comparison ───────────────────────────────────────────────────────

/**
 * Compare two error sets. Returns added/removed/unchanged.
 *
 * @param {Array} current - NormalizedError[]
 * @param {Array} previous - NormalizedError[]
 * @returns {{ added: Array, removed: Array, unchanged: Array }}
 */
export function compareErrors(current, previous) {
  const key = e => `${e.code}|${e.file}|${e.line ?? '?'}`;
  const currKeys = new Set((current || []).map(key));
  const prevKeys = new Set((previous || []).map(key));

  const added = (current || []).filter(e => !prevKeys.has(key(e)));
  const removed = (previous || []).filter(e => !currKeys.has(key(e)));
  const unchanged = (current || []).filter(e => prevKeys.has(key(e)));

  return { added, removed, unchanged };
}

// ─── Error Frontier Filtering ───────────────────────────────────────────────

/**
 * Limit errors to root causes + first-order dependents.
 * Prevents error surface explosion on large projects.
 *
 * @param {Array} errors - NormalizedError[] (after findRootCause)
 * @returns {Array} Filtered NormalizedError[]
 */
export function limitErrors(errors) {
  if (!errors || errors.length === 0) return [];
  const roots = errors.filter(e => !e.derivedFrom);
  const dependents = errors.filter(e => e.derivedFrom);
  return [...roots, ...dependents.slice(0, MAX_FRONTIER_DEPENDENTS)];
}

// ─── Fix Prompt Construction ────────────────────────────────────────────────

/**
 * Build the LLM prompt for a fix iteration.
 *
 * @param {Object} milestone - Milestone data
 * @param {Array} errors - NormalizedError[] to fix
 * @param {Object} iterationMemory - Loop state
 * @param {string} gitDiff - Current git diff
 * @param {string} [taskContext] - Task memory context (from F5)
 * @param {string} [critiqueContext] - Self-critique analysis (from F6)
 * @param {string} [deltaContext] - Delta-compressed context (from FΔ, iteration 2+)
 * @param {string} [strategyHints] - Fix hints from strategy selection (from F10)
 * @param {string} [scopeHint] - Scope limiter hint (from v119)
 * @param {string} [importMapHint] - Import map hint (from v119)
 * @returns {string} Prompt for CODE LLM
 */
export function buildFixPrompt(milestone, errors, iterationMemory, gitDiff, taskContext, critiqueContext, deltaContext, strategyHints, scopeHint, importMapHint) {
  const maxIter = config.lifecycle?.maxLoopIterations || 8;
  const iter = iterationMemory.iteration;

  // Compile-first priority
  const compileErrors = errors.filter(e => e.category === 'compile');
  const activeErrors = compileErrors.length > 0 ? compileErrors : errors;

  // Apply frontier filter
  const limited = limitErrors(activeErrors);
  const rootCauses = limited.filter(e => !e.derivedFrom);

  const formattedErrors = formatErrorsForLLM(limited);

  // Previous patches (capped)
  const recentPatches = iterationMemory.patchesApplied.slice(-MAX_PROMPT_PATCHES);
  const patchSection = recentPatches.length > 0
    ? recentPatches.map(p => formatPatch(p)).join('\n\n')
    : 'None';

  // Git diff (capped)
  const diffSection = gitDiff
    ? gitDiff.slice(0, MAX_GIT_DIFF_CHARS)
    : 'No diff available';

  // FΔ: If delta context available (iteration 2+), use compressed format
  if (deltaContext) {
    return `You are fixing errors in milestone "${milestone.title || ''}".
This is iteration ${iter}/${maxIter}. Context below shows ONLY what changed since last iteration.

${deltaContext}

## Instructions
- Fix ONLY the listed errors — do not touch unrelated code
- Output patches in unified diff format with semantic anchors:
  --- path/to/file.js
  @@ function functionName
  - old line
  + new line
- Do NOT revert previous fixes unless they caused regressions
- Fix root cause errors first, dependent errors second
- Maximum ${MAX_PATCH_FILES} files per response

IMPORTANT: Output ONLY raw source patches. NO markdown fences. NO explanations.`;
  }

  // Task memory section (F5)
  const taskSection = taskContext
    ? `\n## Past Fix Experience\n${taskContext}\n`
    : '';

  // Self-critique section (F6)
  const critiqueSection = critiqueContext
    ? `\n## Self-Critique Analysis\n${critiqueContext}\n`
    : '';

  // v119: Scope and import map sections
  const scopeSection = scopeHint ? `\n${scopeHint}\n` : '';
  const importSection = importMapHint ? `\n${importMapHint}\n` : '';

  return `You are fixing errors in milestone "${milestone.title || ''}".

## Current Errors (iteration ${iter}/${maxIter})
${formattedErrors}

## Root Cause Analysis
${rootCauses.length} root cause(s) identified. Fix these FIRST — dependent errors will likely resolve automatically.
${scopeSection}${importSection}${taskSection}${critiqueSection}${strategyHints || ''}
## Previous Patches (last ${MAX_PROMPT_PATCHES})
${patchSection}

## Current Git Diff (truncated)
${diffSection}

## Instructions
- Fix ONLY the listed errors — do not touch unrelated code
- Output patches in unified diff format with semantic anchors:
  --- path/to/file.js
  @@ function functionName
  - old line
  + new line
- Do NOT revert previous fixes unless they caused regressions
- Fix root cause errors first, dependent errors second
- Maximum ${MAX_PATCH_FILES} files per response

IMPORTANT: Output ONLY raw source patches. NO markdown fences. NO explanations.`;
}

// ─── Error Extraction ───────────────────────────────────────────────────────

/**
 * Extract and normalize errors from test results and quality gate.
 *
 * @param {Object} testResults - From runTests()
 * @param {Object} qualityGateResult - From runQualityGate()
 * @returns {Array} NormalizedError[] (deduplicated, with root cause + recoverability)
 */
export function extractErrors(testResults, qualityGateResult) {
  let allErrors = [];

  // Compile errors first (pre-parsed objects)
  if (qualityGateResult && !qualityGateResult.passed && qualityGateResult.results) {
    const compileObjs = qualityGateResult.results
      .filter(r => !r.passed)
      .map(r => ({ file: r.file || '', line: r.line || null, message: r.message || r.error || '' }));
    if (compileObjs.length > 0) {
      allErrors.push(...normalizeErrors(compileObjs));
    }
  }

  // Test errors (raw string)
  if (testResults && testResults.allPassed === false) {
    const rawOutput = [testResults.stdout || '', testResults.stderr || ''].filter(Boolean).join('\n');
    if (rawOutput.trim()) {
      allErrors.push(...normalizeErrors(rawOutput));
    }
  }

  // Pipeline: deduplicate → findRootCause → classifyRecoverability
  allErrors = deduplicateErrors(allErrors);
  allErrors = findRootCause(allErrors);
  for (const err of allErrors) {
    err.recoverable = classifyRecoverability(err);
  }

  return allErrors;
}

// ─── Patch Oscillation Detection ────────────────────────────────────────────

function hashPatchRegion(patch, region) {
  return `${patch.file}|${region.anchor || ''}|${(region.new || []).join('\n')}`;
}

// ─── Build Iteration Report ─────────────────────────────────────────────────

function buildReport(iterationLog, filesModified, converged) {
  const totalPatches = iterationLog.reduce((sum, entry) => sum + entry.patchFiles.length, 0);
  const initialErrors = iterationLog.length > 0 ? iterationLog[0].errorCount : 0;
  const finalErrors = iterationLog.length > 0 ? iterationLog[iterationLog.length - 1].errorCount : 0;

  const summary = converged
    ? `Fixed all errors in ${iterationLog.length} iteration(s)`
    : `Fixed ${initialErrors - finalErrors}/${initialErrors} errors in ${iterationLog.length} iteration(s)`;

  return {
    summary,
    iterations: iterationLog,
    totalPatches,
    filesModified: [...filesModified],
  };
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

/**
 * Run the iterative fix cycle.
 *
 * @param {Object} options - See JSDoc above
 * @returns {Promise<Object>} LoopResult
 */
export async function runFixLoop(options) {
  const {
    lifecycle, milestone, testResults: initialTestResults,
    qualityGateResult: initialQualityGate,
    callLLM, runTests, runQualityGate, getGitDiff,
    taskMemory, selfCritique,
  } = options;

  const maxIter = config.lifecycle?.maxLoopIterations || 8;
  const projectRoot = lifecycle.projectPath;

  // Step 1: Parse initial errors
  const initialErrors = extractErrors(initialTestResults, initialQualityGate);

  // F5: Query task memory for past fix experience
  let taskContext = '';
  if (taskMemory) {
    try {
      const { queryRelevant, formatTaskMemory } = taskMemory;
      const modifiedFiles = initialErrors.map(e => e.file).filter(Boolean);
      const entries = await queryRelevant(initialErrors, modifiedFiles, {
        projectId: lifecycle.projectId || lifecycle.id,
        maxResults: 8,
      });
      if (entries && entries.length > 0) {
        taskContext = formatTaskMemory(entries);
      }
    } catch (err) {
      logger.warn('ExecutionLoop', `Task memory query failed: ${err.message}`);
    }
  }

  logger.info('ExecutionLoop', 'Starting fix loop', {
    milestoneId: milestone.id,
    initialErrors: initialErrors.length,
    maxIterations: maxIter,
    taskMemoryEntries: taskContext ? taskContext.split('\n').length : 0,
  });

  if (initialErrors.length === 0) {
    return {
      converged: true,
      stopReason: 'all_passed',
      iterations: 0,
      finalTestResults: initialTestResults,
      finalQualityGate: initialQualityGate,
      lastErrors: [],
      report: buildReport([], new Set(), true),
    };
  }

  // Step 2: Check unrecoverable
  const allUnrecoverable = initialErrors.every(e => !e.recoverable);
  if (allUnrecoverable) {
    logger.warn('ExecutionLoop', 'All errors unrecoverable, skipping loop', {
      milestoneId: milestone.id,
      errors: initialErrors.length,
    });
    return {
      converged: false,
      stopReason: 'unrecoverable',
      iterations: 0,
      finalTestResults: initialTestResults,
      finalQualityGate: initialQualityGate,
      lastErrors: initialErrors,
      report: buildReport([], new Set(), false),
    };
  }

  // Step 3: Initialize iteration memory
  const iterMem = {
    iteration: 0,
    patchesApplied: [],
    errorHistory: [initialErrors],
    filesModified: new Set(),
    filePatchCount: new Map(),
    patchHashes: new Set(),
  };

  const iterationLog = [];
  let currentErrors = initialErrors;
  let lastTestResults = initialTestResults;
  let lastQualityGate = initialQualityGate;
  let lastIterationFiles = [];

  // FΔ: Context delta state
  const useDelta = await ensureContextDelta();
  let prevSnapshot = null;

  // v119: Scope limiter + import map + prompt builder
  const useScope = await ensureScopeLimiter();
  const useImport = await ensureImportMap();
  const usePromptBuilder = await ensurePromptBuilder();

  let patchScope = null;
  let violationTracker = null;
  let importMapText = '';

  if (useScope && options.graph) {
    const targetFiles = milestone.scope_files || [];
    const hops = violationTracker?.widened ? 2 : 1;
    patchScope = _computePatchScope(options.graph, targetFiles, { hops });
    violationTracker = new _ScopeViolationTracker();
  }

  if (useImport && options.graph) {
    try {
      const targetFiles = milestone.scope_files || [];
      const entries = _buildImportMap(options.graph, targetFiles);
      const symbolNames = entries.map(e => e.symbol);
      const conflicts = _detectSymbolConflicts(options.graph, symbolNames);
      importMapText = _formatImportMap(entries, conflicts);
    } catch (err) {
      logger.warn('ExecutionLoop', `Import map build failed: ${err.message}`);
    }
  }

  try {
    // Step 4: Fix loop
    for (let iter = 1; iter <= maxIter; iter++) {
      iterMem.iteration = iter;

      logger.info('ExecutionLoop', `Iteration ${iter}/${maxIter}`, {
        milestoneId: milestone.id,
        errors: currentErrors.length,
      });

      // 4a. Self-critique (F6): on iteration >= 2, analyze cause + plan
      let critiqueContext = '';
      if (selfCritique && iter >= 2) {
        try {
          const { shouldActivate, analyzeCause, generatePatchPlan, validatePlan, formatCritiqueForPrompt } = selfCritique;
          if (shouldActivate(iter, currentErrors)) {
            const sigCtx = selfCritique.signatureContext || '';
            const cause = await analyzeCause(currentErrors, sigCtx, iterMem, callLLM);
            const plan = await generatePatchPlan(currentErrors, cause, sigCtx, callLLM);
            const validation = validatePlan(plan.steps, {
              symbolIndex: selfCritique.symbolIndex,
              graph: selfCritique.graph,
              fileNodeId: selfCritique.fileNodeId,
            });
            critiqueContext = formatCritiqueForPrompt(cause, plan, validation);
            logger.info('ExecutionLoop', `Self-critique completed`, {
              milestoneId: milestone.id,
              iteration: iter,
              rootCause: cause.rootCause ? 'yes' : 'no',
              planSteps: plan.steps.length,
              validationIssues: validation.issues.length,
            });
          }
        } catch (err) {
          logger.warn('ExecutionLoop', `Self-critique failed: ${err.message}`);
        }
      }

      // 4a2. Fix strategy selection (F10): classify errors, handle SKIP + DETERMINISTIC
      let strategyHints = '';
      const useStrategy = await ensureFixStrategy();
      if (useStrategy) {
        try {
          const archetypes = options.archetypes || [];
          const strategyMap = _selectFixStrategy(currentErrors, archetypes, iter, {
            errorHistory: iterMem.errorHistory,
          });

          const report = _formatStrategyReport(strategyMap);
          if (report) {
            logger.info('ExecutionLoop', `Strategy: ${report}`, { milestoneId: milestone.id, iteration: iter });
          }

          // Remove SKIP errors from the active list
          const skipped = [];
          const active = [];
          for (const err of currentErrors) {
            const s = strategyMap.get(err);
            if (s && s.type === 'skip') {
              skipped.push(err);
            } else {
              active.push(err);
            }
          }
          if (skipped.length > 0) {
            logger.info('ExecutionLoop', `Skipped ${skipped.length} unfixable error(s)`, { milestoneId: milestone.id });
          }
          currentErrors = active;

          // If all errors were skipped, stop
          if (currentErrors.length === 0) {
            iterationLog.push({ iteration: iter, errorCount: 0, patchFiles: [], action: 'skipped' });
            return _buildResult(false, 'unrecoverable', iter, lastTestResults, lastQualityGate, skipped, iterationLog, iterMem.filesModified);
          }

          // Build hints for HEURISTIC errors
          const hintParts = [];
          for (const err of currentErrors) {
            const s = strategyMap.get(err);
            if (s && s.type === 'heuristic' && s.hint) {
              hintParts.push(_buildHeuristicHint(err, s, s.archetype));
            }
          }
          if (hintParts.length > 0) {
            strategyHints = `\n## Fix Hints (from past patterns)\n${hintParts.join('\n\n')}\n`;
          }
        } catch (err) {
          logger.warn('ExecutionLoop', `Fix strategy failed: ${err.message}`);
        }
      }

      // 4b. Build fix prompt (with FΔ delta compression on iter 2+)
      const gitDiff = await getGitDiff();
      let deltaContext = '';
      if (useDelta) {
        try {
          const recentPatches = iterMem.patchesApplied.slice(-MAX_PROMPT_PATCHES);
          const patchText = recentPatches.length > 0
            ? recentPatches.map(p => formatPatch(p)).join('\n\n')
            : '';
          const currSnapshot = _createContextSnapshot({
            errors: formatErrorsForLLM(limitErrors(currentErrors)),
            patches: patchText,
            files: [...iterMem.filesModified].join(', '),
            taskMemory: taskContext,
            critique: critiqueContext,
            gitDiff: gitDiff ? gitDiff.slice(0, MAX_GIT_DIFF_CHARS) : '',
          });
          const delta = _computeContextDelta(prevSnapshot, currSnapshot);
          if (!delta.isFirstIteration) {
            deltaContext = _formatDeltaForPrompt(delta, currSnapshot);
          }
          prevSnapshot = currSnapshot;
        } catch (err) {
          logger.warn('ExecutionLoop', `Context delta failed: ${err.message}`);
        }
      }
      // v119: Build scope hint for this iteration
      const scopeHint = (patchScope && !violationTracker?.disabled) ? _formatScopeHint(patchScope) : '';
      const prompt = buildFixPrompt(milestone, currentErrors, iterMem, gitDiff, taskContext, critiqueContext, deltaContext, strategyHints, scopeHint, importMapText);

      // 4c. Call LLM
      const llmResult = await callLLM('CODE', prompt);
      const llmOutput = llmResult?.content || '';

      // 4c. Parse patches
      const patches = parseLLMOutput(llmOutput);

      if (!patches || patches.length === 0) {
        logger.warn('ExecutionLoop', 'No patches parsed from LLM output', {
          milestoneId: milestone.id,
          iteration: iter,
          outputLen: llmOutput.length,
        });
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles: [], action: 'skipped' });
        return _buildResult(false, 'patch_failed', iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }

      // 4d. GUARD: Patch scope limit
      const patchFiles = [...new Set(patches.map(p => p.file))];
      if (patchFiles.length > MAX_PATCH_FILES) {
        logger.warn('ExecutionLoop', `Patch scope exceeded: ${patchFiles.length} files (max ${MAX_PATCH_FILES})`, {
          milestoneId: milestone.id,
          iteration: iter,
        });
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles, action: 'skipped' });
        return _buildResult(false, 'scope_exceeded', iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }

      // 4e. GUARD: File loop protection
      let fileLoopDetected = false;
      for (const file of patchFiles) {
        const count = (iterMem.filePatchCount.get(file) || 0) + 1;
        iterMem.filePatchCount.set(file, count);
        if (count > MAX_FILE_PATCHES) {
          logger.warn('ExecutionLoop', `File loop detected: ${file} patched ${count} times (max ${MAX_FILE_PATCHES})`, {
            milestoneId: milestone.id,
            iteration: iter,
          });
          fileLoopDetected = true;
        }
      }
      if (fileLoopDetected) {
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles, action: 'skipped' });
        return _buildResult(false, 'file_loop', iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }

      // 4f. GUARD: Patch oscillation detection
      let oscillation = false;
      for (const patch of patches) {
        for (const region of patch.regions || []) {
          const hash = hashPatchRegion(patch, region);
          if (iterMem.patchHashes.has(hash)) {
            logger.warn('ExecutionLoop', 'Patch oscillation detected', {
              milestoneId: milestone.id,
              iteration: iter,
              file: patch.file,
              anchor: region.anchor,
            });
            oscillation = true;
            break;
          }
          iterMem.patchHashes.add(hash);
        }
        if (oscillation) break;
      }
      if (oscillation) {
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles, action: 'skipped' });
        return _buildResult(false, 'oscillation_detected', iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }

      // 4g0. GUARD: Scope limiter pre-validation (v119)
      if (patchScope && violationTracker && !violationTracker.disabled) {
        const scopeResult = _validatePatchScope(patches, patchScope);
        if (!scopeResult.valid) {
          const state = violationTracker.recordViolation();
          logger.warn('ExecutionLoop', `Scope violation (${state.count}): ${scopeResult.violations.map(v => v.file).join(', ')}`, {
            milestoneId: milestone.id, iteration: iter,
          });

          // Re-compute scope if widened
          if (state.action === 'widened' && options.graph) {
            const targetFiles = milestone.scope_files || [];
            patchScope = _computePatchScope(options.graph, targetFiles, { hops: 2 });
          }
        }
      }

      // 4g. GUARD: Preview before apply — filter out invalid patches
      const validPatches = [];
      for (const patch of patches) {
        const preview = await previewPatch(patch, projectRoot);
        if (preview.valid) {
          validPatches.push(patch);
        } else {
          logger.warn('ExecutionLoop', `Preview rejected patch for ${patch.file}`, {
            milestoneId: milestone.id,
            iteration: iter,
            errors: preview.errors,
          });
        }
      }

      if (validPatches.length === 0) {
        logger.warn('ExecutionLoop', 'All patches rejected by preview', {
          milestoneId: milestone.id,
          iteration: iter,
        });
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles, action: 'skipped' });
        return _buildResult(false, 'patch_failed', iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }

      // 4h. Apply patches
      const applyResult = await applyPatchSet(validPatches, projectRoot);

      if (!applyResult.success) {
        logger.warn('ExecutionLoop', 'Patch application failed', {
          milestoneId: milestone.id,
          iteration: iter,
          errors: applyResult.errors,
        });
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles: validPatches.map(p => p.file), action: 'skipped' });
        return _buildResult(false, 'patch_failed', iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }

      // Track applied patches and files
      iterMem.patchesApplied.push(...validPatches);
      lastIterationFiles = validPatches.map(p => p.file);
      for (const f of lastIterationFiles) iterMem.filesModified.add(f);

      // 4i. Run quality gate FIRST (compile check)
      lastQualityGate = await runQualityGate();

      // 4j. Run tests only if compile passes
      if (lastQualityGate.passed) {
        lastTestResults = await runTests();
      } else {
        // Compile failed → fake test failure, skip actual test run
        lastTestResults = { allPassed: false, summary: 'Skipped — compile errors', stdout: '', stderr: '' };
      }

      // 4k. Parse new errors
      const prevErrors = currentErrors;
      currentErrors = extractErrors(lastTestResults, lastQualityGate);
      iterMem.errorHistory.push(currentErrors);

      // 4l. Check convergence
      const decision = shouldContinue(currentErrors, prevErrors, iter, maxIter);

      logger.info('ExecutionLoop', `Iteration ${iter} result: ${decision.reason}`, {
        milestoneId: milestone.id,
        prevErrors: prevErrors.length,
        currErrors: currentErrors.length,
        patchFiles: lastIterationFiles,
      });

      if (decision.reason === 'diverging') {
        // Rollback last iteration's patches
        for (const file of lastIterationFiles) {
          const rb = rollbackPatch(file, projectRoot);
          if (!rb.success) {
            logger.error('ExecutionLoop', `Rollback failed: ${file}: ${rb.error}`);
          }
        }
        iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles: lastIterationFiles, action: 'rolled_back' });
        return _buildResult(false, 'diverging', iter, lastTestResults, lastQualityGate, prevErrors, iterationLog, iterMem.filesModified);
      }

      iterationLog.push({ iteration: iter, errorCount: currentErrors.length, patchFiles: lastIterationFiles, action: 'applied' });

      if (!decision.continue) {
        const converged = decision.reason === 'all_passed';
        return _buildResult(converged, decision.reason, iter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);
      }
    }

    // Budget exhausted (shouldn't reach here due to shouldContinue check, but safety)
    return _buildResult(false, 'budget_exhausted', maxIter, lastTestResults, lastQualityGate, currentErrors, iterationLog, iterMem.filesModified);

  } finally {
    // Always clean up backups
    clearBackups();

    // F5: Record fix attempts to task memory
    if (taskMemory) {
      try {
        const { recordFix } = taskMemory;
        const projectId = lifecycle.projectId || lifecycle.id;
        const converged = currentErrors.length === 0;
        for (const entry of iterMem.errorHistory[0] || []) {
          await recordFix({
            projectId,
            errorCode: entry.code,
            file: entry.file,
            symbol: entry.symbol,
            patchFile: iterMem.filesModified.values().next().value || '',
            success: converged,
            strategy: converged
              ? `Fixed in ${iterMem.iteration} iteration(s)`
              : `Failed after ${iterMem.iteration} iteration(s): ${currentErrors.length} errors remain`,
            milestoneId: milestone.id,
          });
        }
      } catch (err) {
        logger.warn('ExecutionLoop', `Task memory record failed: ${err.message}`);
      }
    }
  }
}

// ─── Result Builder ─────────────────────────────────────────────────────────

function _buildResult(converged, stopReason, iterations, testResults, qualityGate, errors, iterationLog, filesModified) {
  return {
    converged,
    stopReason,
    iterations,
    finalTestResults: testResults,
    finalQualityGate: qualityGate,
    lastErrors: errors,
    report: buildReport(iterationLog, filesModified, converged),
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  runFixLoop,
  shouldContinue,
  buildFixPrompt,
  compareErrors,
  limitErrors,
  extractErrors,
};
