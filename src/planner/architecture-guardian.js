// Architecture Guardian v98 — Cross-Milestone Architecture Governance
// ══════════════════════════════════════════════════════════════════════════════
//
// Orchestrator that runs BEFORE and AFTER each milestone to maintain
// architectural consistency across the entire lifecycle.
//
// PRE-milestone: build architecture brief (patterns, rules, known violations)
// POST-milestone: audit changes, detect regressions, track API surface
//
// Key principle: incremental analysis — only changed files + dependency closure,
// NOT full project scan at every milestone.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  architectureState,
  apiContracts,
  milestones as msRepo,
  driftChecks,
} from '../db/database.js';

// ─── Lazy-loaded code-intel modules ─────────────────────────────────────────

let _loaded = false;
let _DriftDetector, _validateArchitecture, _detectArchitecture, _formatArchitectureForPrompt;
let _analyzeCodeStructure;
let _ConceptRegistry;

async function ensureModules() {
  if (_loaded) return true;
  try {
    const [drift, acf, arch, analyzer, concept] = await Promise.all([
      import('../code-intel/drift-detector.js'),
      import('./architecture-check.js'),
      import('../code-intel/architecture-detector.js'),
      import('../code-intel/code-analyzer.js'),
      import('../code-intel/concept-registry.js'),
    ]);
    _DriftDetector = drift.DriftDetector;
    _validateArchitecture = acf.validateArchitecture;
    _detectArchitecture = arch.detectArchitecture;
    _formatArchitectureForPrompt = arch.formatArchitectureForPrompt;
    _analyzeCodeStructure = analyzer.analyzeCodeStructure;
    _ConceptRegistry = concept.ConceptRegistry;
    _loaded = true;
    return true;
  } catch (err) {
    logger.warn('ArchGuardian', `Code-intel modules not available: ${err.message}`);
    return false;
  }
}

// ─── PRE-Milestone: Architecture Brief ─────────────────────────────────────

/**
 * Build architecture brief to inject into milestone request.
 * Gives the LLM awareness of existing patterns, rules, and known issues.
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {Object} milestone - Current milestone
 * @returns {Promise<string>} Architecture brief text (empty string if unavailable)
 */
export async function buildArchitectureBrief(lifecycle, milestone) {
  if (!await ensureModules()) return '';

  const projectPath = lifecycle.projectPath;
  if (!projectPath) return '';

  const start = Date.now();

  try {
    const parts = [];

    // 1. Existing architecture detection
    const archResult = await _detectProjectArchitecture(projectPath);
    if (archResult) {
      const formatted = _formatArchitectureForPrompt(archResult);
      if (formatted) parts.push(formatted);
    }

    // 2. Known violations from previous milestones
    const prevState = _getLatestArchState(lifecycle.id);
    if (prevState && (prevState.layer_violations > 0 || prevState.circular_deps > 0)) {
      parts.push(_formatKnownIssues(prevState));
    }

    // 3. Active API contracts (what already exists)
    const activeApis = apiContracts.getActive(lifecycle.id);
    if (activeApis.length > 0) {
      parts.push(_formatApiSurface(activeApis));
    }

    // 4. Completed milestone patterns (what was already built)
    const completed = msRepo.getCompleted(lifecycle.id);
    if (completed.length > 0) {
      parts.push(_formatCompletedContext(completed));
    }

    // 5. ACF contract rules (if ARCHITECTURE.json exists)
    const acfResult = await _validateArchitecture(projectPath);
    if (acfResult && !acfResult.skipped && acfResult.violations.length > 0) {
      parts.push(_formatAcfViolations(acfResult));
    }

    // 6. Concept fragmentation (v102b)
    const conceptFragmentation = await _detectConceptFragmentation(projectPath);
    if (conceptFragmentation) {
      parts.push(conceptFragmentation);
    }

    if (parts.length === 0) return '';

    // Record pre-milestone state
    const driftResult = await _runIncrementalDrift(projectPath);
    architectureState.record(lifecycle.id, milestone.id, 'pre', {
      layerViolations: driftResult?.violations?.length || 0,
      circularDeps: driftResult?.circularDependencies?.length || 0,
      namingIssues: driftResult?.namingIssues?.length || 0,
      apiSurfaceCount: activeApis.length,
      driftScore: _computeDriftScore(driftResult),
      acfScore: acfResult?.score ?? 1.0,
    });

    const brief = '\n\n## Architecture Context (Cross-Milestone)\n\n' +
      parts.join('\n\n') +
      '\n\n**IMPORTANT**: Maintain consistency with the existing architecture. ' +
      'Do NOT introduce duplicate implementations of existing functionality. ' +
      'Follow established patterns and naming conventions.\n';

    logger.info('ArchGuardian', `Brief built (${Date.now() - start}ms)`, {
      milestoneId: milestone.id,
      sections: parts.length,
      apiCount: activeApis.length,
      completedMs: completed.length,
    });

    return brief;
  } catch (err) {
    logger.warn('ArchGuardian', `Brief generation failed (non-blocking): ${err.message}`);
    return '';
  }
}

// ─── POST-Milestone: Architecture Audit ─────────────────────────────────────

/**
 * Audit architecture after milestone execution.
 * Compares pre vs post state to detect regressions.
 *
 * @param {Object} lifecycle - ProjectLifecycle instance
 * @param {Object} milestone - Completed milestone
 * @returns {Promise<Object>} Audit results
 */
export async function postMilestoneAudit(lifecycle, milestone) {
  if (!await ensureModules()) {
    return { success: false, reason: 'modules unavailable' };
  }

  const projectPath = lifecycle.projectPath;
  if (!projectPath) return { success: false, reason: 'no project path' };

  const start = Date.now();

  try {
    // Run drift detection
    const driftResult = await _runIncrementalDrift(projectPath);
    const acfResult = await _validateArchitecture(projectPath);

    // Get pre-milestone state for comparison
    const preState = architectureState.getPrePost(lifecycle.id, milestone.id, 'pre');

    const postState = {
      layerViolations: driftResult?.violations?.length || 0,
      circularDeps: driftResult?.circularDependencies?.length || 0,
      namingIssues: driftResult?.namingIssues?.length || 0,
      apiSurfaceCount: apiContracts.getActive(lifecycle.id).length,
      driftScore: _computeDriftScore(driftResult),
      acfScore: acfResult?.score ?? 1.0,
    };

    // Record post-milestone state
    architectureState.record(lifecycle.id, milestone.id, 'post', postState);

    // Compute regressions (diff pre vs post)
    const regressions = _computeRegressions(preState, postState);

    // Detect duplicate logic across milestones
    const duplicates = await _detectDuplicateLogic(lifecycle, milestone, projectPath);

    // Detect concept drift (v102b)
    const conceptDrifts = await _detectConceptDrift(lifecycle, milestone, projectPath);

    // Store audit as drift check
    driftChecks.addCheck(lifecycle.id, milestone.id, 'ARCHITECTURE_AUDIT',
      regressions.hasRegressions ? 'WARN' : 'PASS',
      { regressions, postState, duplicates, conceptDrifts }
    );

    const auditResult = {
      success: true,
      regressions,
      postState,
      duplicates,
      conceptDrifts,
      acfScore: acfResult?.score ?? 1.0,
      acfViolations: acfResult?.violations || [],
      driftViolations: driftResult?.violations || [],
      circularDeps: driftResult?.circularDependencies || [],
      buildTime: Date.now() - start,
    };

    logger.info('ArchGuardian', 'Post-milestone audit complete', {
      milestoneId: milestone.id,
      hasRegressions: regressions.hasRegressions,
      duplicateCount: duplicates.length,
      acfScore: postState.acfScore,
      buildTime: auditResult.buildTime,
    });

    return auditResult;
  } catch (err) {
    logger.warn('ArchGuardian', `Post-audit failed (non-blocking): ${err.message}`);
    return { success: false, reason: err.message };
  }
}

/**
 * Format audit results for checkpoint prompt enrichment.
 * @param {Object} auditResult - From postMilestoneAudit()
 * @returns {string} Formatted text for checkpoint prompt
 */
export function formatAuditForCheckpoint(auditResult) {
  if (!auditResult?.success) return '';

  const parts = [];

  // Regressions
  if (auditResult.regressions?.hasRegressions) {
    parts.push('### Architecture Regressions Detected');
    for (const r of auditResult.regressions.items) {
      parts.push(`- **${r.type}**: ${r.message}`);
    }
  }

  // ACF violations
  if (auditResult.acfViolations.length > 0) {
    parts.push('### Architecture Contract Violations');
    for (const v of auditResult.acfViolations.slice(0, 10)) {
      parts.push(`- \`${v.file}\`: ${v.fromLayer} → ${v.toLayer} (${v.rule})`);
    }
  }

  // Duplicates
  if (auditResult.duplicates.length > 0) {
    parts.push('### Duplicate Logic Detected');
    for (const d of auditResult.duplicates.slice(0, 5)) {
      parts.push(`- **${d.exportName}**: found in ${d.files.join(', ')}`);
    }
  }

  // Concept drift (v102b)
  if (auditResult.conceptDrifts?.length > 0) {
    parts.push(_formatConceptDrifts(auditResult.conceptDrifts));
  }

  if (parts.length === 0) return '';

  return '\n\n## Cross-Milestone Architecture State\n\n' +
    parts.join('\n') +
    '\n\nConsider these findings when evaluating the milestone.\n';
}

// ─── Incremental Drift Detection ──────────────────────────────────────────

async function _runIncrementalDrift(projectPath) {
  try {
    // v100: Load architecture policy → policy-aware drift detection
    let detector;
    try {
      const { loadPolicy } = await import('./architecture-policy.js');
      const policy = await loadPolicy(projectPath, {
        detectArchitecture: _detectArchitecture,
      });
      if (policy) {
        detector = _DriftDetector.fromPolicy(policy);
      }
    } catch {
      // Policy module not available — fallback to defaults
    }

    if (!detector) {
      detector = new _DriftDetector();
    }

    return await detector.analyze(projectPath, { maxFiles: 3000 });
  } catch (err) {
    logger.warn('ArchGuardian', `Drift detection failed: ${err.message}`);
    return null;
  }
}

// ─── Project Architecture Detection ────────────────────────────────────────

async function _detectProjectArchitecture(projectPath) {
  try {
    const { readdir, readFile } = await import('fs/promises');
    const path = await import('path');

    const files = [];
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor', '.venv', '.c3']);
    const CODE_EXTS = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.rs', '.svelte', '.vue']);

    async function walk(dir, depth = 0) {
      if (depth > 6 || files.length > 500) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const full = path.default.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, depth + 1);
        } else if (CODE_EXTS.has(path.default.extname(e.name))) {
          const rel = path.default.relative(projectPath, full);
          let content = '';
          try {
            content = await readFile(full, 'utf8');
            if (content.length > 100_000) content = content.substring(0, 100_000);
          } catch { /* skip */ }
          files.push({ file: rel, content });
        }
      }
    }

    await walk(projectPath);
    if (files.length === 0) return null;

    return _detectArchitecture(files);
  } catch {
    return null;
  }
}

// ─── Duplicate Logic Detection ──────────────────────────────────────────────

async function _detectDuplicateLogic(lifecycle, milestone, projectPath) {
  const duplicates = [];

  try {
    // Get all active API contracts
    const activeApis = apiContracts.getActive(lifecycle.id);
    if (activeApis.length < 2) return duplicates;

    // Group by export name
    const byName = new Map();
    for (const api of activeApis) {
      const key = api.export_name.toLowerCase();
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(api);
    }

    // Flag exports that appear in multiple files
    for (const [name, contracts] of byName) {
      if (contracts.length < 2) continue;
      const uniqueFiles = [...new Set(contracts.map(c => c.file_path))];
      if (uniqueFiles.length >= 2) {
        duplicates.push({
          exportName: contracts[0].export_name,
          files: uniqueFiles,
          kind: contracts[0].kind,
          milestones: [...new Set(contracts.map(c => c.milestone_id))],
          message: `"${contracts[0].export_name}" exported from ${uniqueFiles.length} files`,
        });
      }
    }
  } catch (err) {
    logger.warn('ArchGuardian', `Duplicate detection failed: ${err.message}`);
  }

  return duplicates;
}

// ─── Regression Detection ──────────────────────────────────────────────────

function _computeRegressions(preState, postState) {
  const items = [];

  if (!preState) {
    return { hasRegressions: false, items };
  }

  // New layer violations
  const newViolations = (postState.layerViolations || 0) - (preState.layer_violations || 0);
  if (newViolations > 0) {
    items.push({
      type: 'LAYER_VIOLATION_INCREASE',
      message: `${newViolations} new layer violation(s) introduced`,
      before: preState.layer_violations,
      after: postState.layerViolations,
    });
  }

  // New circular deps
  const newCircular = (postState.circularDeps || 0) - (preState.circular_deps || 0);
  if (newCircular > 0) {
    items.push({
      type: 'CIRCULAR_DEP_INCREASE',
      message: `${newCircular} new circular dependency(ies) introduced`,
      before: preState.circular_deps,
      after: postState.circularDeps,
    });
  }

  // ACF score degradation
  const acfDelta = (postState.acfScore || 1.0) - (preState.acf_score || 1.0);
  if (acfDelta < -0.1) {
    items.push({
      type: 'ACF_SCORE_DROP',
      message: `Architecture contract score dropped: ${preState.acf_score?.toFixed(2)} → ${postState.acfScore?.toFixed(2)}`,
      before: preState.acf_score,
      after: postState.acfScore,
    });
  }

  // Drift score degradation
  const driftDelta = (postState.driftScore || 1.0) - (preState.drift_score || 1.0);
  if (driftDelta < -0.1) {
    items.push({
      type: 'DRIFT_SCORE_DROP',
      message: `Drift score dropped: ${preState.drift_score?.toFixed(2)} → ${postState.driftScore?.toFixed(2)}`,
      before: preState.drift_score,
      after: postState.driftScore,
    });
  }

  return { hasRegressions: items.length > 0, items };
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function _getLatestArchState(lifecycleId) {
  const history = architectureState.getHistory(lifecycleId);
  return history.length > 0 ? history[0] : null;
}

function _formatKnownIssues(state) {
  const parts = ['### Known Architecture Issues'];
  if (state.layer_violations > 0) {
    parts.push(`- ${state.layer_violations} layer violation(s) in current codebase`);
  }
  if (state.circular_deps > 0) {
    parts.push(`- ${state.circular_deps} circular dependency(ies) detected`);
  }
  if (state.naming_issues > 0) {
    parts.push(`- ${state.naming_issues} naming convention issue(s)`);
  }
  parts.push('', 'Do NOT introduce new violations. Fix existing ones if scope allows.');
  return parts.join('\n');
}

function _formatApiSurface(apis) {
  if (apis.length === 0) return '';
  const parts = ['### Existing API Surface'];
  const grouped = new Map();
  for (const api of apis) {
    if (!grouped.has(api.file_path)) grouped.set(api.file_path, []);
    grouped.get(api.file_path).push(api);
  }
  for (const [file, fileApis] of [...grouped].slice(0, 15)) {
    const exports = fileApis.map(a => {
      const sig = a.signature ? `(${a.signature})` : '';
      return `${a.export_name}${sig}`;
    }).join(', ');
    parts.push(`- \`${file}\`: ${exports}`);
  }
  if (grouped.size > 15) {
    parts.push(`- ... and ${grouped.size - 15} more files`);
  }
  parts.push('', 'Reuse existing APIs where possible. Do NOT create duplicate implementations.');
  return parts.join('\n');
}

function _formatCompletedContext(completed) {
  if (completed.length === 0) return '';
  const parts = ['### Completed Milestones'];
  for (const ms of completed.slice(-10)) {
    const files = ms.scope_files ? (typeof ms.scope_files === 'string' ? JSON.parse(ms.scope_files) : ms.scope_files) : [];
    parts.push(`- **${ms.title}**: ${files.slice(0, 5).join(', ')}${files.length > 5 ? ` (+${files.length - 5})` : ''}`);
  }
  return parts.join('\n');
}

function _formatAcfViolations(acfResult) {
  const parts = ['### Architecture Contract Violations (Current)'];
  for (const v of acfResult.violations.slice(0, 10)) {
    parts.push(`- \`${v.file}\`: ${v.fromLayer} → ${v.toLayer}`);
  }
  if (acfResult.violations.length > 10) {
    parts.push(`- ... and ${acfResult.violations.length - 10} more`);
  }
  parts.push(``, `ACF score: ${acfResult.score.toFixed(2)}. Fix violations if they fall within this milestone's scope.`);
  return parts.join('\n');
}

// ─── Concept Registry Integration (v102b) ─────────────────────────────────

async function _detectConceptFragmentation(projectPath) {
  if (!_ConceptRegistry) return null;
  try {
    const { readdir, readFile } = await import('fs/promises');
    const pathMod = await import('path');
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor', '.venv', '.c3']);
    const CODE_EXTS = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.rs']);

    const files = [];
    async function walk(dir, depth = 0) {
      if (depth > 5 || files.length > 300) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const full = pathMod.default.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, depth + 1);
        } else if (CODE_EXTS.has(pathMod.default.extname(e.name))) {
          const rel = pathMod.default.relative(projectPath, full);
          let content = '';
          try {
            content = await readFile(full, 'utf8');
            if (content.length > 50_000) content = content.substring(0, 50_000);
          } catch { /* skip */ }
          files.push({ file: rel, content });
        }
      }
    }

    await walk(projectPath);
    if (files.length === 0) return null;

    const registry = new _ConceptRegistry();
    registry.scan(files);
    return registry.formatForPrompt(0.5) || null;
  } catch (err) {
    logger.warn('ArchGuardian', `Concept fragmentation detection failed: ${err.message}`);
    return null;
  }
}

async function _detectConceptDrift(lifecycle, milestone, projectPath) {
  if (!_ConceptRegistry) return [];
  try {
    const { readdir, readFile } = await import('fs/promises');
    const pathMod = await import('path');
    const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor', '.venv', '.c3']);
    const CODE_EXTS = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.java', '.rs']);

    const files = [];
    async function walk(dir, depth = 0) {
      if (depth > 5 || files.length > 300) return;
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
        const full = pathMod.default.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, depth + 1);
        } else if (CODE_EXTS.has(pathMod.default.extname(e.name))) {
          const rel = pathMod.default.relative(projectPath, full);
          let content = '';
          try {
            content = await readFile(full, 'utf8');
            if (content.length > 50_000) content = content.substring(0, 50_000);
          } catch { /* skip */ }
          files.push({ file: rel, content });
        }
      }
    }

    await walk(projectPath);
    if (files.length === 0) return [];

    const current = new _ConceptRegistry();
    current.scan(files, { milestoneId: milestone.id });

    // Load previous snapshot from drift checks (if available)
    const prevChecks = driftChecks.getByType(lifecycle.id, 'CONCEPT_SNAPSHOT');
    let previous = null;
    if (prevChecks.length > 0) {
      try {
        const prevData = typeof prevChecks[0].details === 'string'
          ? JSON.parse(prevChecks[0].details) : prevChecks[0].details;
        if (prevData?.concepts) {
          previous = new _ConceptRegistry();
          // Reconstruct from serialized data
          for (const [name, entry] of Object.entries(prevData.concepts)) {
            previous._concepts.set(name, {
              name,
              files: new Set(entry.files || []),
              symbols: new Set(entry.symbols || []),
              milestoneIds: new Set(entry.milestoneIds || []),
            });
            for (const f of (entry.files || [])) {
              let fset = previous._fileMap.get(f);
              if (!fset) { fset = new Set(); previous._fileMap.set(f, fset); }
              fset.add(name);
            }
          }
        }
      } catch { /* ignore corrupt data */ }
    }

    // Save current snapshot for next milestone
    const snapshot = {};
    for (const [name, entry] of current._concepts) {
      snapshot[name] = {
        files: [...entry.files],
        symbols: [...entry.symbols],
        milestoneIds: [...entry.milestoneIds],
      };
    }
    driftChecks.addCheck(lifecycle.id, milestone.id, 'CONCEPT_SNAPSHOT', 'INFO',
      { concepts: snapshot }
    );

    // Detect drift
    if (!previous) return [];
    return current.detectDrift(previous);
  } catch (err) {
    logger.warn('ArchGuardian', `Concept drift detection failed: ${err.message}`);
    return [];
  }
}

function _formatConceptDrifts(drifts) {
  if (!drifts || drifts.length === 0) return '';
  const parts = ['### Concept Drift Detected'];
  for (const d of drifts.slice(0, 10)) {
    parts.push(`- **${d.type}**: ${d.message}`);
  }
  return parts.join('\n');
}

function _computeDriftScore(driftResult) {
  if (!driftResult) return 1.0;
  const total = (driftResult.violations?.length || 0) +
    (driftResult.circularDependencies?.length || 0) +
    (driftResult.namingIssues?.length || 0);
  const files = driftResult.filesAnalyzed || 1;
  return Math.max(0, 1 - (total / files));
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  buildArchitectureBrief,
  postMilestoneAudit,
  formatAuditForCheckpoint,
};
