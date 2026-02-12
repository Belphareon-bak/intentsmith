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
  return `You are a senior software architect analyzing a project request.

## User Request
${request}

${projectContext ? `## Existing Project Context\n${projectContext}\n` : ''}
## Task
1. Identify what the user wants built (core goal).
2. List 5-10 clarifying questions to fully understand the scope.
   Focus on: target users, tech preferences, must-have vs nice-to-have, deployment, constraints.
3. Identify potential risks and complexity.

## Output (JSON only)
\`\`\`json
{
  "core_goal": "string — one sentence summary",
  "clarifying_questions": ["q1", "q2", ...],
  "initial_assessment": {
    "estimated_complexity": "LOW|MEDIUM|HIGH",
    "key_risks": ["risk1", "risk2"],
    "suggested_tech_stack": ["tech1", "tech2"]
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
  return `You are a senior software architect creating a project specification.

## Original Request
${request}

## Clarification Answers
${typeof answers === 'string' ? answers : JSON.stringify(answers, null, 2)}

## Initial Assessment
${typeof assessment === 'string' ? assessment : JSON.stringify(assessment, null, 2)}

## Task
Create a complete, structured project specification.

## MANDATORY Requirements for the spec:
- goals: minimum 3 distinct goals
- requirements: minimum 5 functional requirements
- tech_stack: MUST be specified (languages, frameworks, tools)
- risks: minimum 1 identified risk with mitigation

## Output (JSON only)
\`\`\`json
{
  "title": "string",
  "goals": [
    { "id": "G1", "description": "string", "priority": "MUST|SHOULD|COULD" }
  ],
  "requirements": [
    { "id": "R1", "description": "string", "type": "functional|non-functional", "goal_id": "G1" }
  ],
  "tech_stack": {
    "languages": ["string"],
    "frameworks": ["string"],
    "tools": ["string"],
    "rationale": "string — why these choices"
  },
  "architecture": {
    "pattern": "string — e.g. MVC, microservices, monolith",
    "components": ["string — high-level component names"],
    "data_model": "string — brief description"
  },
  "risks": [
    { "id": "RISK1", "description": "string", "severity": "LOW|MEDIUM|HIGH", "mitigation": "string" }
  ],
  "constraints": ["string"],
  "out_of_scope": ["string"]
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

  return `You are a senior software architect creating a project roadmap.

## Approved Specification
${specStr}

## Task
Break the project into milestones. Each milestone is a self-contained unit of work.

## Rules:
- Each milestone: max 2000 LOC, max 10 files
- Dependencies: a milestone can depend on others (they must be completed first)
- Test strategy: each milestone must define how it will be tested
- Order: from foundational to integration to polish
- IDs: use "ms-1", "ms-2", etc.

## Output (JSON only)
\`\`\`json
{
  "milestones": [
    {
      "id": "ms-1",
      "title": "string",
      "description": "string — what this milestone delivers",
      "dependencies": [],
      "estimated_loc": 500,
      "estimated_files": 4,
      "estimated_complexity": "LOW|MEDIUM|HIGH",
      "goals_addressed": ["G1", "G2"],
      "requirements_addressed": ["R1", "R2"],
      "test_strategy": {
        "type": "unit|integration|e2e|manual",
        "description": "string",
        "expected_test_count": 10
      },
      "deliverables": ["string — concrete output files/features"]
    }
  ],
  "total_estimated_loc": 2000,
  "total_milestones": 4,
  "critical_path": ["ms-1", "ms-2", "ms-4"]
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

## Project Spec (for context — do NOT implement everything, just this milestone)
${specStr}

## Completed Milestones
${completedStr}

## Current Milestone
${msStr}

## Task
Create a detailed implementation plan for THIS milestone only.

## Rules:
- List every file that will be created or modified
- Stay within the milestone scope — do NOT touch files outside this milestone
- Include test plan with specific test cases
- Include rollback strategy if implementation fails

## Output (JSON only)
\`\`\`json
{
  "milestone_id": "ms-N",
  "files": [
    { "path": "string", "action": "create|modify", "purpose": "string" }
  ],
  "implementation_steps": [
    { "step": 1, "action": "string", "file": "string" }
  ],
  "test_plan": [
    { "name": "string", "type": "unit|integration", "description": "string" }
  ],
  "scope_files": ["string — all files this milestone is allowed to touch"],
  "rollback_strategy": "string"
}
\`\`\``;
}

/**
 * Milestone checkpoint — detailed comparison of output vs goals.
 * NOT just OK/NOT OK — uses concrete diff, file list, goals, test results.
 * Used in: lifecycle-build.js → _milestoneCheckpoint()
 */
export function milestoneCheckpoint(milestone, gitDiff, changedFiles, testResults) {
  const msStr = typeof milestone === 'string' ? milestone : JSON.stringify(milestone, null, 2);

  return `You are reviewing a completed milestone against its defined goals.

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

## Task
Compare the actual output against the milestone goals. Be specific.

## Check:
1. Were all deliverables produced?
2. Were all listed files created/modified as planned?
3. Were any files changed OUTSIDE the milestone scope?
4. Did tests pass? What coverage?
5. Any quality concerns?

## Output (JSON only)
\`\`\`json
{
  "passed": true,
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
  "quality_notes": ["string"],
  "overall_assessment": "string — 1-2 sentence summary"
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
