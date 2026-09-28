# Phase C: Collaborative Milestone Execution System

## Context

Phase C currently has C1 (multi-session) and C2 (progress tracking) done, but C3/C4 are missing. The existing `WorkflowOrchestrator` runs autonomously after plan approval — no milestone checkpoints, no periodic reviews, no change management. The user wants a full project lifecycle where C3 is a **strong technical partner**, not an autonomous builder. Every direction change requires approval, but execution within an approved milestone is autonomous.

**Existing architecture to reuse (not replace):**
- `WorkflowOrchestrator` (13 states, D1/CODE/R2/D2/R1) — becomes per-milestone executor
- `ProjectContextManager` — project memory, facts, decisions, blockers, timeline
- `build-handoff.js` — chat integration pattern (PROPOSED → CLARIFYING → PLAN_REVIEW → EXECUTING)
- `progress-tracker.js` — progress formatting
- `workflow_sessions`, `project_memory` DB tables
- CRE BUILD intent routing

---

## Design Decisions

1. **Context budget per milestone** — Kazdy milestone ma estimated_loc + estimated_files. System odmitne spustit prilis velky a navrhne split.

2. **Spec format** — Strukturovany JSON s **povinnou validaci**: min 3 goals, min 5 requirements, povinny tech_stack, povinny risks (aspon 1). Renderuje se jako MD pro uzivatele. Bez toho drift detector nema co kontrolovat.

3. **Roadmap versioning** — Immutable. Zmena = nova verze s diff + duvod. `rewriteRoadmap()` musi: zachovat completed milestones, prepocitat sequence, prepocitat dependencies, zachovat commit historii.

4. **Milestone dependencies** — `depends_on: [ms-2, ms-3]`. System vynuti poradi. Skip milestonu validuje ze zadny dalsi na nem nezavisi.

5. **Git auto-init** — Pokud repo neexistuje → automaticky `git init` (lokalni, bez remote). Git je vzdy pritomen.

6. **Git strategie** — Commit: `feat(ms-N): <title>`. Tag: `ms-<id>`. Auto-commit na PASS. Rollback = git revert.

7. **Drift detection** — Spec alignment + scope creep + architecture consistency + tech debt. Pri kazdem PROJECT_REVIEW.

8. **Review frekvence** — Konfigurovatelna (default 3). Pro slozite projekty po kazdem milestonu.

9. **Error recovery** — max_retries (default 3). BLOCKED != FAILED. Retry/skip/modify.

10. **Quick build zachovan** — `isProjectScopeBuild()` heuristika. Simple = stara cesta, project-scope = lifecycle.

11. **Milestone scope enforcement** — Behem execution je zakazano: menit soubory mimo local_plan scope, menit roadmapu, sahat na jine milestony.

12. **Milestone Health Score** — Po kazdem milestonu:
    ```
    health_score: { scope_adherence, test_coverage, complexity_delta, tech_debt_delta }
    ```
    Dlouhodoba metrika kvality projektu.

13. **lifecycle.js split** — Rozdelit na 5 sub-modulu (ne 1 soubor 1000+ lines):
    - `lifecycle-spec.js` — SPEC phase
    - `lifecycle-planning.js` — PLANNING phase
    - `lifecycle-build.js` — BUILD phase (milestones)
    - `lifecycle-review.js` — REVIEW phase + drift
    - `lifecycle-change.js` — CHANGE MANAGEMENT phase
    - `lifecycle.js` — orchestrator (deleguje na sub-moduly, state machine, persistence)

---

## Architektura

```
CRE → BUILD intent
  ├─ isProjectScopeBuild() = false → build-handoff.js (existing quick build)
  └─ isProjectScopeBuild() = true  → lifecycle-handoff.js (NEW)
                                         ↓
                                    ProjectLifecycle
                                    ┌──────────────────────────────────────┐
                                    │ SPEC → SPEC_REVIEW → PLANNING       │
                                    │ → PLAN_REVIEW → BUILD               │
                                    │   ├─ per milestone:                  │
                                    │   │  plan → approve → execute → test │
                                    │   │  → checkpoint → auto-commit      │
                                    │   │  (execute = WorkflowOrchestrator)│
                                    │   ├─ every N milestones:             │
                                    │   │  → PROJECT_REVIEW                │
                                    │   └─ on change request:              │
                                    │      → CHANGE_MANAGEMENT             │
                                    │ → COMPLETED                          │
                                    └──────────────────────────────────────┘
```

---

## State Machines

### ProjectPhase

```
SPEC ←→ SPEC_REVIEW → PLANNING ←→ PLAN_REVIEW → BUILD
                                                   ├→ PROJECT_REVIEW → BUILD | CHANGE_MANAGEMENT
                                                   ├→ CHANGE_MANAGEMENT → BUILD
                                                   ├→ PAUSED → BUILD | CHANGE_MANAGEMENT
                                                   └→ COMPLETED
any → FAILED
```

### MilestoneStatus

```
PENDING → PLANNING → AWAITING_PLAN → EXECUTING → TESTING → REVIEW → PASSED
                                        ↓ fail      ↓ fail
                                     retry (max 3) → BLOCKED → retry | skip | modify
```

---

## DB Schema (5 novych tabulek)

### project_lifecycles
```sql
id TEXT PK, project_id INT FK→projects, phase TEXT, spec TEXT (JSON),
config TEXT (JSON: review_frequency, max_milestone_loc, max_milestone_files),
created_at, updated_at
```

### roadmap_versions
```sql
id INT PK, lifecycle_id TEXT FK, version INT, roadmap TEXT (JSON),
change_reason TEXT, diff_summary TEXT, created_at
UNIQUE(lifecycle_id, version)
```

### milestones
```sql
id TEXT PK, lifecycle_id TEXT FK, roadmap_version INT, sequence INT,
title TEXT, description TEXT, status TEXT, dependencies TEXT (JSON),
estimated_loc INT, estimated_files INT, estimated_complexity TEXT,
test_strategy TEXT (JSON), local_plan TEXT (JSON),
scope_files TEXT (JSON),               -- allowed files for scope enforcement
workflow_session_id TEXT FK→workflow_sessions, commit_hash TEXT, git_tag TEXT,
health_score TEXT (JSON),              -- {scope_adherence, test_coverage, complexity_delta, tech_debt_delta}
started_at, completed_at, retry_count INT, max_retries INT,
UNIQUE(lifecycle_id, sequence)
```

### change_requests
```sql
id TEXT PK, lifecycle_id TEXT FK, status TEXT, description TEXT,
affected_milestones TEXT (JSON), impact_analysis TEXT (JSON),
proposed_roadmap_diff TEXT (JSON), old_roadmap_version INT,
new_roadmap_version INT, created_at, resolved_at
```

### drift_checks
```sql
id INT PK, lifecycle_id TEXT FK, milestone_id TEXT FK,
check_type TEXT, result TEXT, details TEXT (JSON), created_at
```

---

## Nove soubory (9 novych + 4 testy)

### 1. `src/planner/lifecycle.js` (~200 lines) — ORCHESTRATOR

State machine + delegace na sub-moduly. Drzi ProjectPhase enum, persistence, session continuity.

```
ProjectPhase enum (SPEC, SPEC_REVIEW, PLANNING, PLAN_REVIEW, BUILD,
                   PROJECT_REVIEW, CHANGE_MANAGEMENT, PAUSED, COMPLETED, FAILED)
MilestoneStatus enum (PENDING, PLANNING, AWAITING_PLAN, EXECUTING, TESTING,
                      REVIEW, PASSED, FAILED, BLOCKED, SKIPPED)
ChangeRequestStatus enum (PROPOSED, ANALYZED, APPROVED, APPLIED, REJECTED)

class ProjectLifecycle {
  constructor({db, workflowOrchestrator, config})
  // Deleguje na sub-moduly podle aktualni phase
  // State machine: validuje prechody, persisti do DB
  // Session continuity: resumeLifecycle(), getLifecycleStatus()
  // Git auto-init: pokud repo neexistuje → git init
}
```

### 2. `src/planner/lifecycle-spec.js` (~200 lines) — SPEC phase

```
startSpec(lifecycle, request, context) → {questions}
answerSpecQuestion(lifecycle, answers) → {questions?|spec?}
approveSpec(lifecycle) → transition to PLANNING
reviseSpec(lifecycle, feedback) → back to SPEC
validateSpec(spec) → {valid, errors} — min 3 goals, min 5 reqs, povinny tech_stack + risks
```

### 3. `src/planner/lifecycle-planning.js` (~200 lines) — PLANNING phase

```
generateRoadmap(lifecycle) → {roadmap, milestones}
approveRoadmap(lifecycle) → transition to BUILD
reviseRoadmap(lifecycle, feedback) → new roadmap
rewriteRoadmap(lifecycle, changeRequest) → new version (preserves completed ms, recalcs deps)
```

### 4. `src/planner/lifecycle-build.js` (~300 lines) — BUILD phase (milestones)

```
startNextMilestone(lifecycle) → {milestoneId, localPlan, status: AWAITING_PLAN}
approveMilestonePlan(lifecycle, milestoneId) → {status: EXECUTING}
_executeMilestone(lifecycle, milestone) — delegates to WorkflowOrchestrator
_runTests(lifecycle, milestone) — test strategy execution
_milestoneCheckpoint(lifecycle, milestone) — compare output vs roadmap goals
_autoCommitMilestone(lifecycle, milestone) — git commit + tag
_computeHealthScore(lifecycle, milestone) → {scope_adherence, test_coverage, complexity_delta, tech_debt_delta}
handleMilestoneBlocked(lifecycle, milestone, decision) — retry|skip|modify
_enforceMilestoneScope(milestone, changedFiles) — zakaz zmeny mimo plan
```

### 5. `src/planner/lifecycle-review.js` (~200 lines) — REVIEW + DRIFT

```
triggerProjectReview(lifecycle) → {findings, overallHealth}
acknowledgeReview(lifecycle, action) — continue|change
checkSpecAlignment(lifecycle, spec, completed) → {aligned, unaddressed}
checkScopeCreep(lifecycle, spec, roadmap) → {inScope, outOfScope}
checkArchitectureConsistency(lifecycle, spec) → {consistent, violations}
checkTechDebt(lifecycle) → {debtItems, severity}
```

### 6. `src/planner/lifecycle-change.js` (~150 lines) — CHANGE MANAGEMENT

```
proposeChange(lifecycle, description) → {changeRequestId, affectedMs, impact}
approveChange(lifecycle, crId) → new roadmap version, back to BUILD
rejectChange(lifecycle, crId) → back to BUILD
```

### 7. `src/planner/lifecycle-prompts.js` (~300 lines)

LLM prompt templates:
- `specAnalyze` — clarifying questions, alternatives, risks
- `specDocument` — structured spec JSON (povinne sekce)
- `generateRoadmap` — milestones with size estimates, deps, test strategy
- `milestonePlan` — local plan for one milestone (scope-bounded)
- `milestoneCheckpoint` — compare output vs goals (ne jen OK/NOT OK — detailni porovnani)
- `projectReview` — 4 drift checks
- `analyzeChange` — impact analysis + affected milestones
- `rewriteRoadmap` — new version incorporating change (preserve completed ms)
- `healthScore` — scope/test/complexity/debt metrics

### 8. `src/planner/milestone-size.js` (~120 lines)

Context budget:
- `validateMilestoneSize(ms)` → {fits, warnings, issues}
- `suggestMilestoneSplit(ms)` → sub-milestone suggestions
- `estimateContextTokens(ms)` → estimated tokens
- Defaults: max 2000 LOC, max 10 files

### 9. `src/planner/lifecycle-progress.js` (~200 lines)

Progress:
- `computeLifecycleProgress(lc, milestones)` → overall %
- `formatLifecycleProgress(lc, milestones, lang)` → multi-level display
- `formatMilestoneTable(milestones)` → table with status, LOC, commit, health score
- `formatHealthScoreHistory(milestones)` → trend graph

### 10. `src/chat/handlers/lifecycle-handoff.js` (~400 lines)

Chat integration:
- `isProjectScopeBuild(input, decision)` — heuristic detection
- `handleLifecycleBuildDetected` — proposes lifecycle
- Phase routers: handleSpecInput, handlePlanInput, handleBuildInput, handleReviewInput, handleChangeInput
- Formatting: spec, roadmap, milestones, review, changes, health scores

---

## Modifikovane soubory

### `src/chat/handlers/build-handoff.js`
- Top of `handleBuildDetected`: if `isProjectScopeBuild()` → delegate to `lifecycle-handoff.js`
- Existing quick-build flow unchanged

### `src/chat/handlers/conversation.js`
- Add lifecycle handoff intercept AFTER build handoff intercept (~line 172)
- Route by lifecycle phase: SPEC → handleSpecInput, PLANNING → handlePlanInput, etc.
- Support cancel ("zrusit") and pause ("pauza")

### `src/planner/workflow.js`
- Export `callLLM` and `parseJSON` for lifecycle reuse
- Add optional `milestoneContext` param to `start()` for metadata injection

### `src/planner/index.js`
- Export ProjectLifecycle, ProjectPhase, MilestoneStatus, ChangeRequestStatus
- Export lifecycle-progress functions
- Create DB-backed lifecycle singleton

### `src/db/database.js`
- Add 5 new CREATE TABLE statements
- Add 5 new repository objects (following existing pattern)

### `src/config.js`
- Add `lifecycle` config section: reviewFrequency, maxMilestoneLOC, maxMilestoneFiles, maxMilestoneRetries, autoCommit

### `src/architect/git.js`
- Add `ensureRepo(projectPath)` — pokud repo neexistuje → `git init` (lokalni, bez remote)
- Add `commitMilestone(milestoneId, title)` — `feat(ms-N): <title>`
- Add `tagMilestone(milestoneId, title)` — `ms-<id>`

### `src/server.js`
- Add lifecycle API endpoints: /lifecycle/start, /spec/answer, /spec/approve, /roadmap/approve, /milestone/approve, /review/acknowledge, /change/propose, /change/approve, /resume, /status

### `src/chat/cre-decision.js`
- Add `PROJECT_BUILD_INDICATORS` patterns: "cely projekt", "od specifikace", "vicero fazi", "kompletni system"

---

## Implementation Order

### Day 1-2: Foundation (DB + enums + size + git)
1. `src/db/database.js` — 5 new tables + repositories
2. `src/planner/lifecycle.js` — enums + orchestrator skeleton + git auto-init
3. `src/planner/lifecycle-prompts.js` — all prompt templates
4. `src/planner/milestone-size.js` — context budget validation
5. `src/architect/git.js` — commitMilestone, tagMilestone, ensureRepo (auto-init)
6. `src/config.js` — lifecycle config section
7. `tests/lifecycle-db.test.js` — schema verification
8. `tests/milestone-size.test.js` — size heuristics

### Day 3-4: SPEC + PLANNING phases
1. `src/planner/lifecycle-spec.js` — full SPEC phase + spec validation
2. `src/planner/lifecycle-planning.js` — full PLANNING phase + roadmap versioning
3. `src/planner/workflow.js` — export callLLM, parseJSON
4. `src/planner/index.js` — lifecycle exports + singleton
5. `tests/lifecycle.test.js` — SPEC + PLANNING suites (spec validation, roadmap generation)

### Day 5-7: BUILD phase (milestones)
1. `src/planner/lifecycle-build.js` — full BUILD phase
   - startNextMilestone (dependency check)
   - _executeMilestone (delegate to WorkflowOrchestrator)
   - _enforceMilestoneScope (scope guard)
   - _runTests + _milestoneCheckpoint (detailed, not just OK/NOT OK)
   - _computeHealthScore (4 metrics)
   - _autoCommitMilestone (commit + tag)
   - handleMilestoneBlocked (retry/skip/modify)
2. `tests/lifecycle.test.js` — BUILD suite (execution, scope enforcement, health scores, blocking)

### Day 8-9: REVIEW + CHANGE MANAGEMENT
1. `src/planner/lifecycle-review.js` — REVIEW phase + all 4 drift checks
2. `src/planner/lifecycle-change.js` — CHANGE phase + roadmap rewrite (preserve completed ms)
3. `tests/lifecycle.test.js` — REVIEW + CHANGE suites

### Day 10-12: Chat Integration
1. `src/chat/handlers/lifecycle-handoff.js` — full implementation
2. `src/chat/handlers/build-handoff.js` — project-scope routing gate
3. `src/chat/handlers/conversation.js` — lifecycle intercept + cancel/pause
4. `src/chat/cre-decision.js` — PROJECT_BUILD_INDICATORS
5. `src/planner/lifecycle-progress.js` — progress + health score display
6. `tests/lifecycle-handoff.test.js`

### Day 13-14: API + session continuity + polish
1. `src/server.js` — lifecycle API endpoints
2. `src/planner/lifecycle.js` — resumeLifecycle, getLifecycleStatus
3. Full regression run (all 1700+ existing tests)
4. Manual E2E: "Chci postavit kompletni e-shop" → full lifecycle flow

---

## Test Plan

### `tests/lifecycle.test.js` (~300 lines)
- Enum completeness (ProjectPhase, MilestoneStatus, ChangeRequestStatus)
- SPEC: startSpec → questions → answers → spec document → approve/revise
- PLANNING: generateRoadmap → size validation → approve/revise → versioning
- BUILD: startNextMilestone → dependencies → approve → execute → checkpoint → commit
- BUILD: fail → retry → blocked → user decision (retry/skip/modify)
- REVIEW: trigger after N milestones → drift checks → acknowledge
- CHANGE: propose → impact analysis → approve → new roadmap version
- SESSION: resume → correct phase + milestone state

### `tests/lifecycle-handoff.test.js` (~150 lines)
- isProjectScopeBuild: "kompletni system" → true, "postav API" → false
- Handoff state machine: PROPOSED → SPEC → PLANNING → BUILD → DONE
- Cancel/pause handling
- Quick build regression

### `tests/milestone-size.test.js` (~80 lines)
- Size validation: within/exceeds limits
- Split suggestions
- Context token estimation

### `tests/drift-detector.test.js` (~100 lines)
- Spec alignment: addressed vs unaddressed goals
- Scope creep detection
- Architecture consistency
- Full check → stored drift_checks

---

## Verification

1. `node tests/lifecycle.test.js` — all lifecycle phases work
2. `node tests/lifecycle-handoff.test.js` — chat routing correct
3. `node tests/milestone-size.test.js` — context budget works
4. `node tests/drift-detector.test.js` — drift detection works
5. Existing tests regression: notifications 67, agent-sources 47, wizard 65, accountant 138+81, all others
6. Manual: "Chci postavit kompletni e-shop" → lifecycle proposes SPEC mode → questions → roadmap → milestones → reviews
