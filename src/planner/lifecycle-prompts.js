// Lifecycle LLM Prompt Templates
// ══════════════════════════════════════════════════════════════════════════════
// All prompts used by the lifecycle sub-modules.
// Each prompt has a clear input contract and expected output format.

// ─── SPEC Phase ──────────────────────────────────────────────────────────────

/**
 * Analyze user request → generate clarifying questions + initial assessment.
 * Used in: lifecycle-spec.js → startSpec()
 */
export function specAnalyze(request, projectContext = '') {
  return `You are a senior software architect and engineering partner. Your job is NOT to blindly accept the request — it is to deeply analyze it, challenge assumptions, and present the user with informed choices.

IMPORTANT: All text content in your JSON output (descriptions, questions, analysis) MUST be in the SAME LANGUAGE as the user's request below. If the user writes in Czech, respond in Czech. If in English, respond in English. Technical terms (e.g. "AES-256", "SQLAlchemy") stay in their original form.

## User Request
${request}

${projectContext ? `## Existing Project Context\n${projectContext}\n` : ''}
## Task

### 1. Core Goal Analysis
Identify what the user wants built. State the core goal in one sentence. Then identify 2-3 implicit assumptions the user may not have stated.

### 2. Technical Decision Points
Identify 3-5 key technical decisions that MUST be made before starting. For EACH decision:
- Present at least 2 concrete alternatives (specific technologies, patterns, or approaches)
- Explain the trade-offs of each (performance, complexity, security, maintainability)
- Give your recommendation with a clear justification

Example decision format:
  "Encryption algorithm: AES-256-GCM vs ChaCha20-Poly1305 — AES has hardware acceleration (faster on modern CPUs), ChaCha is faster on mobile/embedded without AES-NI. Recommendation: AES-256-GCM for server-side, ChaCha for cross-platform CLI."

### 3. Clarifying Questions
List 5-8 specific, targeted questions. AVOID generic questions like "What tech do you prefer?" — instead ask:
- "Should the CLI support piped input (e.g. echo 'secret' | keychain store) or only interactive mode?"
- "What's the expected data volume — tens of entries or thousands?"
- "Does this need to work offline, or can it depend on a network service?"

### 4. Risk & Constraint Analysis
Identify:
- Technical risks with severity and likelihood
- Security risks (if applicable)
- Scope risks (features that seem simple but hide complexity)
- Constraints the user may not have considered (platform limits, license issues, performance ceilings)

## Output (JSON only)
\`\`\`json
{
  "core_goal": "string — one sentence",
  "implicit_assumptions": ["string — assumption 1", "string — assumption 2"],
  "technical_decisions": [
    {
      "decision": "string — what needs to be decided",
      "alternatives": [
        { "option": "string", "pros": ["string"], "cons": ["string"] }
      ],
      "recommendation": "string — which option and why"
    }
  ],
  "clarifying_questions": ["q1", "q2", ...],
  "initial_assessment": {
    "estimated_complexity": "LOW|MEDIUM|HIGH",
    "key_risks": [
      { "risk": "string", "severity": "LOW|MEDIUM|HIGH", "likelihood": "LOW|MEDIUM|HIGH", "mitigation": "string" }
    ],
    "suggested_tech_stack": ["tech1", "tech2"],
    "tech_stack_rationale": "string — why these specific choices"
  }
}
\`\`\``;
}

/**
 * Generate structured spec from request + answers.
 * VALIDATION: min 3 goals, min 5 requirements, required tech_stack + risks.
 * Used in: lifecycle-spec.js → generateSpec()
 */
export function specDocument(request, answers, assessment) {
  return `You are a senior software architect creating a thorough project specification. This spec is the engineering contract — it must be precise enough that an independent team could build from it.

IMPORTANT: All text content in your JSON output (descriptions, rationale, criteria) MUST be in the SAME LANGUAGE as the original request below. If the user writes in Czech, all descriptions must be in Czech. If in English, respond in English. Technical terms and identifiers stay in their original form.

## Original Request
${request}

## Clarification Answers
${typeof answers === 'string' ? answers : JSON.stringify(answers, null, 2)}

## Initial Assessment (including technical decisions)
${typeof assessment === 'string' ? assessment : JSON.stringify(assessment, null, 2)}

## Task
Create a complete, structured project specification. Every section must be substantive, not templated.

## MANDATORY Requirements:
- goals: minimum 3 distinct goals with clear success criteria
- functional requirements: minimum 5, each testable and specific
- non-functional requirements: minimum 3 (performance, security, usability, etc.)
- tech_stack: specific versions/libraries, not just "Node.js" but "Node.js 22 + better-sqlite3"
- architecture: component diagram with data flow, not just a pattern name
- key design decisions: each with rationale explaining WHY + at least 2 alternatives_considered (MANDATORY — list what was NOT chosen)
- risks: minimum 3 with concrete mitigation strategies
- acceptance criteria: how do we know the project is DONE?

## Output (JSON only)
\`\`\`json
{
  "title": "string",
  "goals": [
    { "id": "G1", "description": "string", "priority": "MUST|SHOULD|COULD", "success_criteria": "string — measurable condition" }
  ],
  "requirements": {
    "functional": [
      { "id": "R1", "description": "string — specific and testable", "goal_id": "G1", "acceptance_test": "string — how to verify" }
    ],
    "non_functional": [
      { "id": "NF1", "category": "performance|security|usability|reliability|portability", "description": "string", "metric": "string — measurable target" }
    ]
  },
  "tech_stack": {
    "languages": ["string — with version"],
    "frameworks": ["string — with version"],
    "tools": ["string"],
    "rationale": "string — why these specific choices over alternatives"
  },
  "architecture": {
    "pattern": "string — e.g. layered CLI with plugin architecture",
    "components": [
      { "name": "string", "responsibility": "string", "interfaces": ["string — what it exposes"] }
    ],
    "data_flow": "string — how data moves through the system",
    "data_model": "string — schema/structure description"
  },
  "design_decisions": [
    { "id": "DD1", "decision": "string", "chosen": "string", "alternatives_considered": ["alternative A", "alternative B"], "rationale": "string — why this over alternatives" }
  ],
  "security_model": {
    "threat_model": "string — key threats",
    "mitigations": ["string"],
    "sensitive_data": ["string — what data needs protection"]
  },
  "risks": [
    { "id": "RISK1", "description": "string", "severity": "LOW|MEDIUM|HIGH", "likelihood": "LOW|MEDIUM|HIGH", "mitigation": "string", "contingency": "string — fallback if mitigation fails" }
  ],
  "constraints": ["string"],
  "out_of_scope": ["string"],
  "acceptance_criteria": ["string — project-level done conditions"]
}
\`\`\``;
}

// ─── PLANNING Phase ──────────────────────────────────────────────────────────

/**
 * Generate roadmap with milestones from approved spec.
 * Each milestone has size estimates, dependencies, test strategy.
 * Used in: lifecycle-planning.js → generateRoadmap()
 */
export function generateRoadmap(spec) {
  const specStr = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 2);

  return `You are a senior software architect creating a project roadmap. This roadmap must be realistic, risk-aware, and defensible.

IMPORTANT: All text content (titles, descriptions, criteria) MUST be in the SAME LANGUAGE as the specification below. If the spec is in Czech, write in Czech. If in English, write in English. Technical terms stay in their original form.

## Approved Specification
${specStr}

## Task
Break the project into milestones. Each milestone is a self-contained, deliverable unit of work.

## MANDATORY Rules:
- MINIMUM 3 milestones for any project. MINIMUM 4 milestones if spec has ≥5 functional requirements.
- LAST milestone MUST be "Integration, Testing & Documentation" — it covers final integration, end-to-end testing, and documentation finalization.
- Each milestone: max 2000 LOC, max 10 files
- Each milestone MUST have ALL of: title, description, deliverables, acceptance_criteria
- Dependencies: explain WHY a milestone depends on another (not just list IDs)
- Test strategy: each milestone must define specific test cases, not just "unit tests"
- Risk: each milestone must identify its biggest risk and how to mitigate it
- Acceptance criteria: each milestone must define concrete, verifiable done conditions
- checkpoint_mode: STRUCTURAL for early scaffolding, FUNCTIONAL for core implementation, SECURITY for the final integration/testing/security milestone
- Order: from foundational to integration to polish
- IDs: use "ms-1", "ms-2", etc.
- requirements_coverage MUST map EVERY functional requirement ID to at least one milestone. No orphan requirements.

## Quality checks before outputting:
1. Does every spec requirement (functional AND non-functional) appear in at least one milestone?
2. Are there any circular dependencies?
3. Is the critical path realistic — can it actually be built in this order?
4. Does each milestone produce something testable and demonstrable?

## Output (JSON only)
\`\`\`json
{
  "milestones": [
    {
      "id": "ms-1",
      "title": "string",
      "description": "string — what this milestone delivers and WHY it's needed first",
      "dependencies": [],
      "dependency_rationale": "string — why these dependencies exist (empty for ms-1)",
      "estimated_loc": 500,
      "estimated_files": 4,
      "estimated_complexity": "LOW|MEDIUM|HIGH",
      "goals_addressed": ["G1", "G2"],
      "requirements_addressed": ["R1", "R2"],
      "risk": {
        "description": "string — biggest risk for this milestone",
        "mitigation": "string — how to handle it",
        "fallback": "string — what to do if mitigation fails"
      },
      "test_strategy": {
        "type": "unit|integration|e2e|manual",
        "description": "string",
        "specific_tests": ["string — concrete test case descriptions"],
        "expected_test_count": 10
      },
      "checkpoint_mode": "STRUCTURAL|FUNCTIONAL|SECURITY",
      "acceptance_criteria": ["string — specific, verifiable done conditions"],
      "deliverables": ["string — concrete output files/features"]
    }
  ],
  "total_estimated_loc": 2000,
  "total_milestones": 4,
  "critical_path": ["ms-1", "ms-2", "ms-4"],
  "requirements_coverage": {
    "covered": ["R1", "R2", "R3"],
    "uncovered": [],
    "rationale_for_uncovered": "string — why these are not covered (should be empty)"
  }
}
\`\`\``;
}

// ─── BUILD Phase (per milestone) ─────────────────────────────────────────────

/**
 * Create local plan for one milestone (scope-bounded).
 * Used in: lifecycle-build.js → startNextMilestone()
 */
export function milestonePlan(milestone, spec, completedMilestones = []) {
  const msStr = typeof milestone === 'string' ? milestone : JSON.stringify(milestone, null, 2);
  const specStr = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 2);
  const completedStr = completedMilestones.length > 0
    ? completedMilestones.map(m => `- ${m.id}: ${m.title} (${m.status})`).join('\n')
    : 'None yet';

  return `You are implementing a specific milestone of a larger project.

IMPORTANT: All text content (step descriptions, file purposes) MUST be in the SAME LANGUAGE as the spec below.

## Project Spec (for context — do NOT implement everything, just this milestone)
${specStr}

## Completed Milestones
${completedStr}

## Current Milestone
${msStr}

## Task
Create a detailed implementation plan for THIS milestone only. Be specific enough that the plan could be followed mechanically.

## Rules:
- List every file that will be created or modified, with specific purpose
- Stay within the milestone scope — do NOT touch files outside this milestone
- For each implementation step, explain WHAT and WHY (not just "create file X")
- Include specific test cases with expected inputs and outputs
- Include error handling strategy: what can go wrong and how to handle it
- Include rollback strategy if implementation fails

## Output (JSON only)
\`\`\`json
{
  "milestone_id": "ms-N",
  "technical_approach": "string — 2-3 sentences explaining the implementation strategy and key design choices",
  "files": [
    { "path": "string", "action": "create|modify", "purpose": "string — what this file does and why" }
  ],
  "implementation_steps": [
    { "step": 1, "action": "string — specific action with rationale", "file": "string", "validation": "string — how to verify this step succeeded" }
  ],
  "test_plan": [
    { "name": "string", "type": "unit|integration|e2e", "description": "string", "input": "string", "expected_output": "string" }
  ],
  "error_handling": [
    { "scenario": "string — what can go wrong", "handling": "string — how the code handles it" }
  ],
  "scope_files": ["string — all files this milestone is allowed to touch"],
  "rollback_strategy": "string"
}
\`\`\``;
}

/**
 * Milestone checkpoint — mode-aware quality review.
 * Checkpoint mode determines strictness level:
 *   STRUCTURAL: file structure, syntax, imports — early scaffolding milestones
 *   FUNCTIONAL: structural + logic correctness, API contracts — mid milestones
 *   SECURITY:   full audit incl. security hardening — final/security milestones
 *
 * Used in: lifecycle-build.js → milestoneCheckpoint()
 *
 * @param {Object} milestone
 * @param {string} gitDiff
 * @param {string[]} changedFiles
 * @param {Object} testResults
 * @param {Object} [opts]
 * @param {string} [opts.checkpointMode='FUNCTIONAL'] - STRUCTURAL|FUNCTIONAL|SECURITY
 * @param {Object} [opts.previousFindings] - Findings from prior failed attempt (adaptive retry)
 */
export function milestoneCheckpoint(milestone, gitDiff, changedFiles, testResults, opts = {}) {
  const msStr = typeof milestone === 'string' ? milestone : JSON.stringify(milestone, null, 2);
  const mode = opts.checkpointMode || 'FUNCTIONAL';

  // Mode-specific instructions
  const modeInstructions = {
    STRUCTURAL: `## Checkpoint Mode: STRUCTURAL (scaffolding milestone)
You are checking STRUCTURAL quality only. This is an early milestone — code is being scaffolded.

PASS if:
- All planned files were created/modified
- Code is syntactically correct (no obvious parse errors)
- Imports and exports are consistent
- Basic module structure follows the plan

DO NOT fail for:
- Missing tests (tests come in later milestones)
- Security concerns (security hardening is a separate milestone)
- Missing error handling (will be added incrementally)
- Missing input validation (will be added later)
- Code style or best-practice preferences

Security findings should be listed as WARNINGS, not blockers.`,

    FUNCTIONAL: `## Checkpoint Mode: FUNCTIONAL (implementation milestone)
You are checking FUNCTIONAL quality. Code should work correctly for the planned use cases.

PASS if:
- All deliverables are produced (complete or reasonable partial)
- Core logic is correct for the described functionality
- APIs/interfaces match the plan
- No obvious runtime errors in the happy path

DO NOT fail for:
- Missing tests IF test_strategy is null/deferred (noted in test results)
- Enterprise-grade security (that's for SECURITY mode)
- Edge-case error handling beyond what the milestone explicitly requires
- Missing input validation unless the milestone explicitly requires it

Security findings should be listed as WARNINGS unless they are critical (hardcoded secrets, SQL injection with user input).`,

    SECURITY: `## Checkpoint Mode: SECURITY (hardening/final milestone)
You are performing a FULL quality audit. This milestone is specifically about quality and security.

FAIL if:
- Any hardcoded secrets, API keys, or passwords
- SQL injection, command injection, or XSS vulnerabilities with user input
- Missing input validation on public APIs
- Unhandled error paths that could crash the application
- Missing tests for security-critical paths

Security findings ARE blockers in this mode.`,
  };

  const previousFindingsSection = opts.previousFindings
    ? `\n## Previous Attempt Findings (MUST be addressed)
The code was already revised to fix these issues. Verify they are resolved:
${JSON.stringify(opts.previousFindings, null, 2)}\n`
    : '';

  const compileStatusSection = opts.qualityGateResult
    ? `\n## Compile Status\n${opts.qualityGateResult.passed ? `All files passed syntax/compile checks: ${opts.qualityGateResult.summary}` : `COMPILE ERRORS detected:\n${opts.qualityGateResult.summary}`}\n`
    : '';

  return `You are reviewing a completed milestone against its defined goals.

${modeInstructions[mode] || modeInstructions.FUNCTIONAL}

## Milestone Definition
${msStr}

## Actual Git Diff (abbreviated)
\`\`\`diff
${typeof gitDiff === 'string' ? gitDiff.substring(0, 8000) : 'No diff available'}
\`\`\`

## Changed Files
${Array.isArray(changedFiles) ? changedFiles.map(f => `- ${f}`).join('\n') : 'Unknown'}

## Test Results
${typeof testResults === 'string' ? testResults : JSON.stringify(testResults, null, 2)}
${compileStatusSection}${previousFindingsSection}
## Task
Compare the actual output against the milestone goals using the checkpoint mode rules above.

## Check:
1. Were all deliverables produced? For each, is it complete or partial?
2. Were all listed files created/modified as planned?
3. Were any files changed OUTSIDE the milestone scope?
4. Did tests pass? (Only relevant if test results are available)
5. Security review (severity depends on checkpoint mode)
6. Error handling (severity depends on checkpoint mode)

## Output (JSON only)
\`\`\`json
{
  "passed": true,
  "checkpoint_mode": "${mode}",
  "deliverables_check": [
    { "deliverable": "string", "status": "DONE|PARTIAL|MISSING", "note": "string" }
  ],
  "scope_violations": ["string — files changed outside scope"],
  "test_summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "coverage_estimate": "string"
  },
  "security_findings": ["string — findings (WARNINGS in STRUCTURAL/FUNCTIONAL mode)"],
  "error_handling_gaps": ["string — unhandled failure modes"],
  "discovered_requirements": ["string — new requirements that emerged during build"],
  "quality_notes": ["string"],
  "overall_assessment": "string — 1-2 sentence summary",
  "fix_instructions": ["string — specific fixes needed if passed=false"]
}
\`\`\``;
}

// ─── REVIEW Phase ────────────────────────────────────────────────────────────

/**
 * Project review — 4 drift checks.
 * Used in: lifecycle-review.js → triggerProjectReview()
 */
export function projectReview(spec, roadmap, completedMilestones, healthScores) {
  const specStr = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 2);
  const roadmapStr = typeof roadmap === 'string' ? roadmap : JSON.stringify(roadmap, null, 2);
  const completedStr = typeof completedMilestones === 'string'
    ? completedMilestones
    : JSON.stringify(completedMilestones, null, 2);
  const healthStr = typeof healthScores === 'string'
    ? healthScores
    : JSON.stringify(healthScores, null, 2);

  return `You are conducting a project review after completing several milestones.

## Project Spec
${specStr}

## Roadmap
${roadmapStr}

## Completed Milestones
${completedStr}

## Health Score History
${healthStr}

## Task — Run 4 drift checks:

### 1. Spec Alignment
Which spec goals are addressed? Which are still unaddressed?
Are any requirements being missed or neglected?

### 2. Scope Creep
Is anything being built that is NOT in the spec?
Are milestones delivering more or less than planned?

### 3. Architecture Consistency
Is the implemented architecture consistent with the spec?
Are there any structural deviations or anti-patterns?

### 4. Tech Debt Assessment
Based on health scores, is tech debt accumulating?
Are complexity deltas trending upward?

## Important
This is ADVISORY — not absolute truth. Flag observations with confidence levels.

## Output (JSON only)
\`\`\`json
{
  "spec_alignment": {
    "addressed_goals": ["G1", "G2"],
    "unaddressed_goals": ["G3"],
    "missed_requirements": ["R5"],
    "confidence": 0.8
  },
  "scope_creep": {
    "in_scope": ["feature1"],
    "out_of_scope": ["extra feature"],
    "severity": "NONE|LOW|MEDIUM|HIGH",
    "confidence": 0.7
  },
  "architecture_consistency": {
    "consistent": true,
    "violations": [],
    "confidence": 0.85
  },
  "tech_debt": {
    "items": [{ "area": "string", "severity": "LOW|MEDIUM|HIGH" }],
    "trend": "STABLE|INCREASING|DECREASING",
    "confidence": 0.6
  },
  "overall_health": "GREEN|YELLOW|RED",
  "recommendations": ["string"]
}
\`\`\``;
}

// ─── CHANGE MANAGEMENT ──────────────────────────────────────────────────────

/**
 * Analyze change request impact on existing roadmap.
 * Used in: lifecycle-change.js → proposeChange()
 */
export function analyzeChange(changeDescription, spec, roadmap, completedMilestones) {
  const specStr = typeof spec === 'string' ? spec : JSON.stringify(spec, null, 2);
  const roadmapStr = typeof roadmap === 'string' ? roadmap : JSON.stringify(roadmap, null, 2);
  const completedStr = completedMilestones.map(m => `${m.id}: ${m.title} (${m.status})`).join('\n');

  return `You are analyzing a change request for an active project.

## Change Request
${changeDescription}

## Current Spec
${specStr}

## Current Roadmap
${roadmapStr}

## Completed Milestones (cannot be changed)
${completedStr || 'None'}

## Task
Analyze the impact of this change on the existing roadmap.

## Rules:
- PASSED milestones cannot be removed or modified
- Consider dependency chains — removing a milestone may break dependents
- Estimate effort delta (more work? less work?)

## Output (JSON only)
\`\`\`json
{
  "affected_milestones": ["ms-3", "ms-5"],
  "impact": {
    "milestones_to_add": [{ "title": "string", "estimated_loc": 500 }],
    "milestones_to_remove": ["ms-5"],
    "milestones_to_modify": [{ "id": "ms-3", "changes": "string" }],
    "effort_delta": "+2 milestones, ~1500 LOC",
    "risk_level": "LOW|MEDIUM|HIGH"
  },
  "feasibility": "FEASIBLE|COMPLEX|RISKY",
  "recommendation": "string — should this change be approved?"
}
\`\`\``;
}

/**
 * Rewrite roadmap incorporating approved change.
 * MUST preserve completed milestones, recalculate sequences and dependencies.
 * Used in: lifecycle-change.js → applyChange()
 */
export function rewriteRoadmap(currentRoadmap, changeRequest, completedMilestones) {
  const roadmapStr = typeof currentRoadmap === 'string'
    ? currentRoadmap
    : JSON.stringify(currentRoadmap, null, 2);
  const changeStr = typeof changeRequest === 'string'
    ? changeRequest
    : JSON.stringify(changeRequest, null, 2);
  const completedStr = typeof completedMilestones === 'string'
    ? completedMilestones
    : JSON.stringify(completedMilestones, null, 2);

  return `You are rewriting a project roadmap to incorporate an approved change.

## Current Roadmap
${roadmapStr}

## Approved Change
${changeStr}

## Completed Milestones (MUST be preserved exactly as-is)
${completedStr}

## Rules:
1. NEVER remove or modify PASSED milestones
2. Recalculate sequence numbers (no gaps)
3. Recalculate dependencies (ensure no broken references)
4. New milestones get new IDs (continuing from last used)
5. Preserve commit_hash and git_tag of completed milestones
6. Each milestone: max 2000 LOC, max 10 files

## Output (JSON only)
\`\`\`json
{
  "milestones": [
    {
      "id": "ms-1",
      "title": "string",
      "status": "PASSED|PENDING|...",
      "dependencies": [],
      "estimated_loc": 500,
      "estimated_files": 4,
      "estimated_complexity": "LOW|MEDIUM|HIGH",
      "goals_addressed": ["G1"],
      "requirements_addressed": ["R1"],
      "test_strategy": { "type": "unit", "description": "string" },
      "deliverables": ["string"],
      "preserved": true
    }
  ],
  "changes_summary": "string — what changed from previous version",
  "diff": {
    "added": ["ms-6"],
    "removed": ["ms-5"],
    "modified": ["ms-3"],
    "preserved": ["ms-1", "ms-2"]
  }
}
\`\`\``;
}

// ─── Health Score ────────────────────────────────────────────────────────────

/**
 * Compute health score for a completed milestone.
 * Used in: lifecycle-build.js → _computeHealthScore()
 */
export function healthScore(milestone, gitDiff, testResults, previousScores) {
  const msStr = typeof milestone === 'string' ? milestone : JSON.stringify(milestone, null, 2);
  const prevStr = previousScores.length > 0
    ? JSON.stringify(previousScores, null, 2)
    : 'No previous scores';

  return `You are computing health metrics for a completed milestone.

## Milestone
${msStr}

## Git Diff Stats
${typeof gitDiff === 'string' ? gitDiff.substring(0, 4000) : 'No diff'}

## Test Results
${typeof testResults === 'string' ? testResults : JSON.stringify(testResults, null, 2)}

## Previous Health Scores (for trend analysis)
${prevStr}

## Output (JSON only)
\`\`\`json
{
  "scope_adherence": 0.95,
  "test_coverage": 0.80,
  "complexity_delta": 0.1,
  "tech_debt_delta": 0.05
}
\`\`\`

Each metric is 0.0 to 1.0:
- scope_adherence: 1.0 = all changes within scope, 0.0 = massive scope violation
- test_coverage: 1.0 = fully tested, 0.0 = no tests
- complexity_delta: 0.0 = no added complexity, 1.0 = massive complexity increase (lower is better)
- tech_debt_delta: 0.0 = no new debt, 1.0 = heavy new debt (lower is better)`;
}

export default {
  specAnalyze,
  specDocument,
  generateRoadmap,
  milestonePlan,
  milestoneCheckpoint,
  projectReview,
  analyzeChange,
  rewriteRoadmap,
  healthScore,
};
