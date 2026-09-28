// Critic/Repair Agent v98 — Targeted Fix After Checkpoint Failure
// ══════════════════════════════════════════════════════════════════════════════
//
// When milestone checkpoint returns FAIL, the critic analyzes the failure type
// and generates a TARGETED repair request instead of re-running the entire
// milestone. This dramatically improves fix success rate.
//
// Pipeline:
//   1. Checkpoint FAIL + findings[]
//   2. Classify failure type (compile, architecture, logic, security)
//   3. Cross-reference with guardian audit + quality gate
//   4. Generate focused repair instructions
//   5. Return repair request for executor
//
// Max repair attempts: 2 (total with original: 3)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Failure Classification ──────────────────────────────────────────────────

export const FailureType = Object.freeze({
  COMPILE:      'COMPILE',
  ARCHITECTURE: 'ARCHITECTURE',
  LOGIC:        'LOGIC',
  SECURITY:     'SECURITY',
  SCOPE:        'SCOPE',
  TEST:         'TEST',
  UNKNOWN:      'UNKNOWN',
});

/**
 * Classify checkpoint failure into actionable category.
 *
 * @param {Object} checkpointResult - From milestoneCheckpoint()
 * @param {Object} [auditResult] - From architecture guardian postMilestoneAudit()
 * @param {Object} [qualityGateResult] - From quality gate
 * @returns {string} FailureType
 */
export function classifyFailure(checkpointResult, auditResult = null, qualityGateResult = null) {
  // Compile errors take priority — nothing else matters if code doesn't compile
  if (qualityGateResult && !qualityGateResult.passed) {
    return FailureType.COMPILE;
  }

  // Check checkpoint findings for classification signals
  const findings = checkpointResult || {};

  // Security findings
  if (findings.security_findings?.length > 0) {
    const critical = findings.security_findings.some(f =>
      /hardcoded|injection|xss|password|secret|credential/i.test(f)
    );
    if (critical) return FailureType.SECURITY;
  }

  // Architecture regressions
  if (auditResult?.regressions?.hasRegressions) {
    return FailureType.ARCHITECTURE;
  }

  // Scope violations
  if (findings.scope_violations?.length > 0) {
    return FailureType.SCOPE;
  }

  // Test failures
  if (findings.test_summary?.failed > 0) {
    return FailureType.TEST;
  }

  // Missing deliverables → logic issue
  const missing = findings.deliverables_check?.filter(d =>
    d.status === 'MISSING' || d.status === 'PARTIAL'
  );
  if (missing?.length > 0) {
    return FailureType.LOGIC;
  }

  // Check fix_instructions for clues
  if (findings.fix_instructions?.length > 0) {
    const instructions = findings.fix_instructions.join(' ').toLowerCase();
    if (/compil|syntax|parse|import/.test(instructions)) return FailureType.COMPILE;
    if (/secur|inject|xss|password/.test(instructions)) return FailureType.SECURITY;
    if (/architect|layer|circular|depend/.test(instructions)) return FailureType.ARCHITECTURE;
    if (/test|assert|expect/.test(instructions)) return FailureType.TEST;
  }

  return FailureType.LOGIC; // Default: assume logic issue
}

// ─── Failure Analysis ────────────────────────────────────────────────────────

/**
 * Analyze checkpoint failure and produce a structured fix plan.
 *
 * @param {Object} checkpointResult - Checkpoint output
 * @param {Object} [auditResult] - Architecture guardian audit
 * @param {Object} milestone - Current milestone
 * @returns {Object} Fix plan with type, instructions, affected files
 */
export function analyzeFailure(checkpointResult, auditResult, milestone) {
  const failureType = classifyFailure(checkpointResult, auditResult);
  const findings = checkpointResult || {};

  const plan = {
    failureType,
    instructions: [],
    affectedFiles: [],
    priority: 'HIGH',
    estimatedComplexity: 'LOW',
  };

  switch (failureType) {
    case FailureType.COMPILE:
      plan.instructions = _compileFixInstructions(findings, milestone);
      plan.estimatedComplexity = 'LOW';
      break;

    case FailureType.ARCHITECTURE:
      plan.instructions = _architectureFixInstructions(findings, auditResult, milestone);
      plan.estimatedComplexity = 'MEDIUM';
      break;

    case FailureType.SECURITY:
      plan.instructions = _securityFixInstructions(findings, milestone);
      plan.estimatedComplexity = 'MEDIUM';
      break;

    case FailureType.SCOPE:
      plan.instructions = _scopeFixInstructions(findings, milestone);
      plan.estimatedComplexity = 'LOW';
      break;

    case FailureType.TEST:
      plan.instructions = _testFixInstructions(findings, milestone);
      plan.estimatedComplexity = 'MEDIUM';
      break;

    case FailureType.LOGIC:
    default:
      plan.instructions = _logicFixInstructions(findings, milestone);
      plan.estimatedComplexity = 'HIGH';
      break;
  }

  // Extract affected files from findings
  plan.affectedFiles = _extractAffectedFiles(findings, auditResult, milestone);

  // Append checkpoint's own fix_instructions
  if (findings.fix_instructions?.length > 0) {
    plan.instructions.push('', '--- Checkpoint fix instructions ---');
    plan.instructions.push(...findings.fix_instructions);
  }

  logger.info('CriticAgent', `Failure analyzed: ${failureType}`, {
    milestoneId: milestone.id,
    instructionCount: plan.instructions.length,
    affectedFiles: plan.affectedFiles.length,
  });

  return plan;
}

// ─── Repair Request Generation ──────────────────────────────────────────────

/**
 * Generate a focused repair request from the fix plan.
 * This replaces the full milestone request in the retry path.
 *
 * @param {Object} fixPlan - From analyzeFailure()
 * @param {Object} milestone - Current milestone
 * @param {string} originalRequest - Original milestone request (for context)
 * @returns {string} Repair request for the executor
 */
export function generateRepairRequest(fixPlan, milestone, originalRequest) {
  const parts = [];

  parts.push(`# REPAIR: Fix ${fixPlan.failureType} issues in milestone "${milestone.title}"`);
  parts.push('');
  parts.push('This is a TARGETED REPAIR, not a full re-implementation.');
  parts.push('Focus ONLY on fixing the issues listed below. Do NOT rewrite working code.');
  parts.push('');

  // Scope constraint
  parts.push('## Scope');
  if (fixPlan.affectedFiles.length > 0) {
    parts.push('Fix ONLY these files:');
    for (const f of fixPlan.affectedFiles) {
      parts.push(`- \`${f}\``);
    }
  } else {
    parts.push('Fix issues within the milestone scope files.');
  }
  parts.push('');

  // Instructions
  parts.push('## Fix Instructions');
  for (const inst of fixPlan.instructions) {
    parts.push(inst.startsWith('-') || inst.startsWith('#') ? inst : `- ${inst}`);
  }
  parts.push('');

  // Type-specific guidance
  parts.push('## Guidance');
  switch (fixPlan.failureType) {
    case FailureType.COMPILE:
      parts.push('- Fix ALL syntax/compile errors');
      parts.push('- Verify imports resolve correctly');
      parts.push('- Do NOT change logic, only fix compilation');
      break;
    case FailureType.ARCHITECTURE:
      parts.push('- Fix layer violations (move imports to correct layer)');
      parts.push('- Resolve circular dependencies');
      parts.push('- Follow existing architecture patterns');
      break;
    case FailureType.SECURITY:
      parts.push('- Remove hardcoded secrets (use environment variables)');
      parts.push('- Add input validation on public APIs');
      parts.push('- Fix injection vulnerabilities (parameterize queries)');
      break;
    case FailureType.SCOPE:
      parts.push('- Revert changes to files outside milestone scope');
      parts.push('- Keep only changes to planned scope files');
      break;
    case FailureType.TEST:
      parts.push('- Fix failing tests (do NOT delete them)');
      parts.push('- Add missing tests if required by milestone');
      break;
    case FailureType.LOGIC:
      parts.push('- Complete missing deliverables');
      parts.push('- Fix logic errors identified in checkpoint');
      parts.push('- Ensure APIs match the plan');
      break;
  }
  parts.push('');

  // Include abbreviated original request for context
  if (originalRequest) {
    const truncated = originalRequest.length > 2000
      ? originalRequest.substring(0, 2000) + '\n... [truncated]'
      : originalRequest;
    parts.push('## Original Milestone Context (reference only)');
    parts.push(truncated);
  }

  return parts.join('\n');
}

// ─── Fix Instruction Generators ─────────────────────────────────────────────

function _compileFixInstructions(findings, milestone) {
  const instructions = [];
  instructions.push('Fix all compilation/syntax errors');

  if (milestone._lastCompileErrors?.length > 0) {
    instructions.push('', 'Specific compile errors:');
    for (const err of milestone._lastCompileErrors.slice(0, 10)) {
      instructions.push(`- ${err}`);
    }
  }

  if (findings.error_handling_gaps?.length > 0) {
    instructions.push('', 'Error handling gaps:');
    for (const gap of findings.error_handling_gaps.slice(0, 5)) {
      instructions.push(`- ${gap}`);
    }
  }

  return instructions;
}

function _architectureFixInstructions(findings, auditResult, milestone) {
  const instructions = [];
  instructions.push('Fix architecture violations introduced by this milestone');

  if (auditResult?.regressions?.items) {
    for (const r of auditResult.regressions.items) {
      instructions.push(`- ${r.message}`);
    }
  }

  if (auditResult?.acfViolations?.length > 0) {
    instructions.push('', 'ACF violations to fix:');
    for (const v of auditResult.acfViolations.slice(0, 5)) {
      instructions.push(`- ${v.file}: ${v.fromLayer} cannot import ${v.toLayer}`);
    }
  }

  if (auditResult?.duplicates?.length > 0) {
    instructions.push('', 'Duplicate logic to resolve:');
    for (const d of auditResult.duplicates.slice(0, 3)) {
      instructions.push(`- "${d.exportName}" exists in: ${d.files.join(', ')}`);
    }
  }

  return instructions;
}

function _securityFixInstructions(findings, milestone) {
  const instructions = ['Fix ALL security findings'];

  if (findings.security_findings?.length > 0) {
    for (const f of findings.security_findings) {
      instructions.push(`- ${f}`);
    }
  }

  return instructions;
}

function _scopeFixInstructions(findings, milestone) {
  const instructions = ['Revert changes outside milestone scope'];

  if (findings.scope_violations?.length > 0) {
    instructions.push('', 'Files changed outside scope:');
    for (const v of findings.scope_violations) {
      instructions.push(`- ${v}`);
    }
  }

  const scopeFiles = milestone.scope_files || [];
  if (scopeFiles.length > 0) {
    const files = typeof scopeFiles === 'string' ? JSON.parse(scopeFiles) : scopeFiles;
    instructions.push('', 'Allowed scope files:');
    for (const f of files) {
      instructions.push(`- ${f}`);
    }
  }

  return instructions;
}

function _testFixInstructions(findings, milestone) {
  const instructions = ['Fix failing tests'];

  if (findings.test_summary) {
    instructions.push(`Tests: ${findings.test_summary.passed}/${findings.test_summary.total} passed, ${findings.test_summary.failed} failed`);
  }

  return instructions;
}

function _logicFixInstructions(findings, milestone) {
  const instructions = ['Complete missing deliverables and fix logic errors'];

  if (findings.deliverables_check) {
    for (const d of findings.deliverables_check) {
      if (d.status === 'MISSING') {
        instructions.push(`- MISSING: ${d.deliverable}${d.note ? ` — ${d.note}` : ''}`);
      } else if (d.status === 'PARTIAL') {
        instructions.push(`- PARTIAL: ${d.deliverable}${d.note ? ` — ${d.note}` : ''}`);
      }
    }
  }

  if (findings.overall_assessment) {
    instructions.push('', `Assessment: ${findings.overall_assessment}`);
  }

  return instructions;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _extractAffectedFiles(findings, auditResult, milestone) {
  const files = new Set();

  // From scope violations
  if (findings.scope_violations) {
    for (const v of findings.scope_violations) files.add(v);
  }

  // From audit violations
  if (auditResult?.acfViolations) {
    for (const v of auditResult.acfViolations) files.add(v.file);
  }
  if (auditResult?.driftViolations) {
    for (const v of auditResult.driftViolations) files.add(v.file);
  }

  // From compile errors
  if (milestone._lastCompileErrors) {
    for (const err of milestone._lastCompileErrors) {
      const match = err.match(/^([^:]+):/);
      if (match) files.add(match[1]);
    }
  }

  // Fallback: milestone scope files
  if (files.size === 0 && milestone.scope_files) {
    const scopeFiles = typeof milestone.scope_files === 'string'
      ? JSON.parse(milestone.scope_files)
      : milestone.scope_files;
    for (const f of scopeFiles) files.add(f);
  }

  return [...files].slice(0, 20);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default {
  FailureType,
  classifyFailure,
  analyzeFailure,
  generateRepairRequest,
};
