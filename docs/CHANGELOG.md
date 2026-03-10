# C3 Changelog

> **Versioning policy**
> - **Major version** (v82 → v83 → ...): Architectural subsystem changes or new capability domains
> - **Minor version** (v88.0 → v88.1 → v88.2): Feature extensions within existing subsystems
> - **Patch** (v97.0 → v97.1): Fixes, reliability improvements, bugfix batches
> - Version numbers are sequential but not necessarily contiguous (e.g. v94 was skipped)

---

## v119 — Unified Prompt Pipeline + Patch Scope Limiter (2026-03-10)

Structured prompt assembly, KG-based import hints, and pre-apply scope validation.

### Prompt Builder (`src/context/prompt-builder.js`, ~210 LOC)
- **`buildStructuredPrompt()`**: Unified prompt assembly with 12 named sections, priority-weighted allocation, token budget management. Replaces ad-hoc prompt construction in execution-loop.js, lifecycle-build.js, and self-critique.js.
- **`buildSectionBudget()`**: Adaptive per-section budgets. Error-type multipliers shift budget toward most relevant sections (e.g. IMPORT_NOT_FOUND → ×2.0 IMPORT_MAP, ×1.5 SIGNATURES; SYNTAX_ERROR → ×2.0 SOURCE). Strategy-aware scaling (DETERMINISTIC ×0.6).
- **`estimateTokens()`**: ~4 chars/token rough estimator (consistent with context-delta.js).
- **Audit trail**: Returns `{ prompt, metadata }` with per-section token usage, truncation flags, included/excluded reasons.

### Import Map (`src/context/import-map.js`, ~170 LOC)
- **`buildImportMap()`**: KG-based import resolution — for each target file, traces IMPORTS edges to dependencies, then DEFINES edges to resolve symbol→file mappings. Prevents wrong import paths (the #1 LLM code gen error).
- **`detectSymbolConflicts()`**: Scans all symbol nodes to find same-name definitions in different files. Warns LLM about ambiguous names.
- **`formatImportMap()`**: Markdown prompt section with `symbol → file` entries + conflict warnings.

### Scope Limiter (`src/patch/scope-limiter.js`, ~190 LOC)
- **`computePatchScope()`**: KG-based scope — target files + 1-hop dependencies (getDependencies) + 1-hop dependents (getDependents), capped at maxFiles. Engine-managed files (package.json, etc.) always allowed. Graceful degradation when no graph available.
- **`validatePatchScope()`**: Pre-apply validation — rejects patches targeting files outside scope.
- **`formatScopeHint()`**: Markdown prompt section listing allowed files with reasons.
- **`ScopeViolationTracker`**: Tracks consecutive out-of-scope patches. Auto-widens scope after 3 violations (hops +1), disables limiter after 5 (graceful degradation).

### Signature Cache (`signature-map.js`, +30 LOC)
- In-memory `Map<file:contentHash, exports[]>` using FNV-1a hash from context-delta.js.
- Cache hit skips AST parse entirely. Invalidation: content change → different hash → miss.
- `clearSignatureCache()` / `getSignatureCacheSize()` for testing and project switches.

### Integration
- **execution-loop.js**: Lazy-loaded import map, scope limiter, prompt builder. Scope validation before patch apply (step 4g0). Import map + scope hint injected into fix prompts. Violation tracking with auto-widen/disable.
- **lifecycle-build.js**: Import map + scope hint injected into `buildCodeContextForMilestone()` via lazy KG import.

### Tests
- prompt-builder: **30/30** (estimateTokens, buildSectionBudget, buildStructuredPrompt — ordering, truncation, budget exhaustion, metadata, determinism, adaptive weighting)
- import-map: **19/19** (buildImportMap resolution, conflicts, formatImportMap, integration)
- scope-limiter: **27/27** (scope computation, limits, no-graph, validatePatchScope, formatScopeHint, ScopeViolationTracker)
- signature-cache: **7/7** (cache hit/miss, clear, independence, output correctness)
- **0 regressions** (execution-loop 56, signature-map 25, patch-engine 57, error-normalizer 48, context-delta 34, fix-strategy 38, knowledge-graph 17, graph-query 26, self-critique 32 — all pass)

---

## v116 — F14: Cross-Project Learning (2026-03-09)

Pattern sharing across projects within the same workspace.

### Cross-Project Learner (`cross-project-learner.js`, ~290 LOC)
- **`computeStackSimilarity()`**: Jaccard-based comparison of language, frameworks, tools. Case-insensitive, weighted (language strongest, tools weakest).
- **`queryCrossProject()`**: Queries task_memory for entries from OTHER projects. Scores by error code match (0.5), architecture decision relevance (0.3), stack similarity boost (0.3×), and generality boost (0.2× for language-agnostic error codes like IMPORT_NOT_FOUND, SYNTAX_ERROR, etc.). Time-decay applied.
- **`identifyShareablePatterns()`**: Selects high-confidence patterns suitable for cross-project transfer: general error codes, architecture decisions, battle-tested entries (≥3 uses).
- **`formatCrossProjectHints()`**: Token-budgeted prompt section for LLM injection. Shows outcome (WORKED/FAILED/ARCH/PATTERN), strategy, source project.
- **`mergeResults()`**: Deduplicates local (F5) and cross-project results by kind+key, local takes priority.
- **`getProjectsWithMemory()`** / **`getProjectSummaries()`**: Registry queries for projects with task memory entries.

### Tests
- cross-project-learner: **36/36** (6 suites: computeStackSimilarity, queryCrossProject, identifyShareablePatterns, formatCrossProjectHints, mergeResults, project registry)
- **0 regressions** (all 561 existing tests pass)

**FΔ+F9-F14 series complete** — 242 new tests (FΔ:34 + F10:38 + F9:34 + F12:36 + F11:25 + F13:39 + F14:36), 597 total tests, 0 regressions.

---

## v115 — F13: Continuous Improvement Mode (2026-03-09)

Post-build quality enhancement — advisory mode, opt-in via config.

### Continuous Improvement (`continuous-improvement.js`, ~350 LOC)
- **`ImprovementType`** enum: TEST_COVERAGE, CODE_QUALITY, DEAD_CODE, DOCUMENTATION.
- **`analyzeImprovementOpportunities()`**: Priority-ranked analysis from test coverage, code smells, dead symbols, undocumented files. Weighted: test_coverage(4) > code_quality(3) > dead_code(2) > documentation(1). Same-priority sorted by file name. `maxItems` cap (default 5).
- **`executeImprovement()`**: Dispatches to type-specific handlers:
  - TEST_COVERAGE: LLM generates test file → apply → verify tests pass → rollback on failure.
  - CODE_QUALITY: LLM refactors file → apply → verify no regression → rollback on failure.
  - DEAD_CODE: Conservative — returns "requires manual review" (too risky for auto-fix).
  - DOCUMENTATION: LLM adds JSDoc/docstrings → apply.
- **`runImprovementCycle()`**: Full orchestration with safeguards — `maxFiles` (default 10), `maxLines` (default 500). Filters by type, tracks completed/failed, stops early on limits.
- **`formatImprovementReport()`**: Human-readable report with completed/failed/stoppedEarly sections.

### Tests
- continuous-improvement: **39/39** (10 suites: ImprovementType, analyze, execute×4 types, edge cases, cycle, report)
- **0 regressions** (all 522 existing tests pass)

---

## v114 — F11: Autonomous Dependency Upgrades (2026-03-09)

Multi-package-manager dependency detection and safe upgrade orchestration.

### Dependency Manager (`dependency-manager.js`, ~320 LOC)
- **`PackageManager`** enum: NPM, YARN, PNPM, GO, PIP, CARGO.
- **`detectPackageManager()`**: Lock file detection with priority ordering (pnpm > yarn > npm).
- **`listOutdated()`**: Runs `npm outdated --json` etc., caches to `.c3/dependency-cache.json` (TTL 24h). Falls back to cache on network failure.
- **`upgradePackage()`**: Per-manager install commands with timeout.
- **`runUpgradeCycle()`**: Full orchestration — detect → list → sort (patch first) → upgrade → test → rollback on failure. NEVER auto-upgrades major versions. `maxPackagesPerRun` limit (default 5).
- **`loadCache()`/`saveCache()`**: JSON cache with TTL, creates `.c3/` directory.
- **`formatUpgradeReport()`**: Markdown report with upgraded/failed/skipped sections.

### Tests
- dependency-manager: **25/25** (6 suites: PackageManager, detectPackageManager, cache, formatUpgradeReport, runUpgradeCycle, edge cases)
- **0 regressions** (all 497 existing tests pass)

---

## v113 — F12: Performance Intelligence (2026-03-09)

Import-aware performance anti-pattern detection for LLM-generated code. Advisory only — does not block milestones.

### Performance Analyzer (`perf-analyzer.js`, ~300 LOC)
- **`AntiPatternType`** enum: N_PLUS_ONE, UNBOUNDED_LOOP, SYNC_IN_ASYNC, REDUNDANT_QUERY, LARGE_PAYLOAD.
- **`detectAntiPatterns(content, language)`**: Line-by-line detection with import-aware DB context:
  - **N+1 queries**: DB call inside loop body (requires DB package import evidence from 16 packages).
  - **Unbounded loops**: while(true)/for(;;)/loop{} without break/return within 30-line scan window.
  - **Sync-in-async**: 14 synchronous I/O calls (readFileSync, execSync, etc.) inside async functions.
  - **Redundant queries**: Same DB call (extracted call key, ignoring assignment) repeated within 50 lines.
  - **Large payloads**: SELECT * without LIMIT, findMany()/findAll() without pagination params.
- **`analyzeFilePerformance()`**: Convenience wrapper with file path population.
- **`formatPerfReport()`**: Severity-tagged markdown report with configurable maxEntries.
- **`severityScore()`**: 0–100 score (100=clean) with weighted deductions (warning=15, info=5, error=25).

### Tests
- perf-analyzer: **36/36** (10 suites: AntiPatternType, N+1, unbounded loop, sync-in-async, redundant query, large payload, analyzeFilePerformance, formatPerfReport, severityScore, edge cases)
- **0 regressions** (all 461 existing tests pass)

---

## v112 — F9: Adaptive Build Strategy (2026-03-09)

Multi-signal build strategy selection for optimal milestone ordering in roadmap generation.

### Build Strategy (`build-strategy.js`, ~220 LOC)
- **`BuildStrategy`** enum: SCHEMA_FIRST, COMPONENT_FIRST, COMMAND_FIRST, MODEL_FIRST, TEST_FIRST, DEFAULT.
- **`selectStrategy(architecture, patternHistory)`**: Weighted multi-signal selection:
  - Framework signal (0.4): 20+ frameworks mapped (Express→SCHEMA_FIRST, React→COMPONENT_FIRST, Django→MODEL_FIRST, etc.)
  - Layer signal (0.3): Dominant layer detection with file count weighting. NestJS resolved by layers.
  - Pattern history signal (0.3): Past strategy success/failure from task memory (requires ≥2 data points).
- **`formatStrategyForPrompt()`**: Confidence-gated: ≥0.7→Recommended, 0.4–0.7→Hint, <0.4→omitted.

### Integration
- **lifecycle-planning.js**: Lazy-loaded via `ensureBuildStrategy()`. Appends strategy section to D1 roadmap prompt.

### Tests
- build-strategy: **34/34** (8 suites)
- **0 regressions** (all 427 existing tests pass)

---

## v111 — F10: Failure Strategy Selection (2026-03-09)

Classifies errors into fix strategies to skip unnecessary LLM calls and accelerate the execution loop.

### Fix Strategy (`fix-strategy.js`, ~250 LOC)
- **`StrategyType`** enum: DETERMINISTIC, HEURISTIC, LLM_FULL, SKIP.
- **`selectFixStrategy()`**: Decision tree mapping error codes to strategies based on archetypes, heuristic hints, and iteration history.
  - DETERMINISTIC: UNUSED_IMPORT (always), SYNTAX_ERROR (trivial patterns), IMPORT_NOT_FOUND (with archetype).
  - HEURISTIC: NULL_REFERENCE, ASSERTION_FAILED, TYPE_MISMATCH, MISSING_PROPERTY, ARGUMENT_COUNT, UNDEFINED_VARIABLE, MISSING_TYPE — focused hints replace full prompts.
  - SKIP: PERMISSION_DENIED (always), stale errors persisting 3+ iterations.
  - LLM_FULL: everything else (current behavior).
- **`buildDeterministicPatch()`**: Template-based patch generation for simple fixes (remove unused import, add semicolon).
- **`validateDeterministicPatch()`**: Dry-run validation — bracket balance check, empty replacement guard.
- **`buildHeuristicHint()`**: Focused hint text per error, enriched with archetype data when available.
- **`formatStrategyReport()`**: Human-readable summary ("3 deterministic, 2 heuristic, 1 LLM, 0 skipped").

### Integration
- **execution-loop.js**: Lazy-loaded via `ensureFixStrategy()`. In each iteration:
  1. `selectFixStrategy()` classifies all current errors.
  2. SKIP errors removed from active list (stops loop if all skipped).
  3. HEURISTIC hints injected into `buildFixPrompt()` as `## Fix Hints` section.
  4. `buildFixPrompt` extended with 8th parameter `strategyHints`.

### Tests
- fix-strategy: **38/38** (7 suites: StrategyType, selectFixStrategy, buildDeterministicPatch, validateDeterministicPatch, buildHeuristicHint, formatStrategyReport, edge cases)
- **0 regressions** (execution-loop 56, context-delta 34, self-critique 32, task-memory 45, patch-engine 57, error-normalizer 48, graph-query 26, pattern-miner 26, context-optimizer 40, signature-map 25)

---

## v110 — FΔ: Context Delta Engine (2026-03-09)

Incremental context compression for the execution loop. On iteration 2+, only changed context sections are sent to the LLM — reducing prompt size by 50-80% and improving reasoning quality.

### Context Delta (`context-delta.js`, ~180 LOC)
- **`hashSection()`**: FNV-1a 32-bit fingerprint for fast content comparison.
- **`createContextSnapshot()`**: Captures 6 sections (errors, patches, files, taskMemory, critique, gitDiff) with hashes.
- **`computeContextDelta()`**: Compares two snapshots, identifies changed/unchanged sections, computes per-section deltas (error added/resolved/remaining).
- **`formatDeltaForPrompt()`**: On iteration 2+, emits only changed sections + "unchanged" summary. First iteration returns full context.
- **`estimateTokenSavings()`**: Token savings estimation (1 token ≈ 4 chars).

### Integration
- **execution-loop.js**: Lazy-loaded via `ensureContextDelta()`. Creates snapshot after each iteration, computes delta, injects compressed `deltaContext` into `buildFixPrompt()`. Falls back to full context if delta engine unavailable.
- **buildFixPrompt**: New 7th parameter `deltaContext` — when present, replaces all context sections with delta-compressed format.

### Expected Impact
| Metric | Before | After |
|--------|--------|-------|
| Prompt size (iter 2+) | 3000-6000 tokens | 300-900 tokens |
| LLM latency (iter 2+) | 30-90s | 10-30s |
| Token usage per loop | ~30K | ~10K |

### Tests
- context-delta: **34/34** (7 suites: hashSection, createContextSnapshot, computeContextDelta, formatFullContext, formatDeltaForPrompt, estimateTokenSavings, integration)
- **0 regressions** (execution-loop 56, self-critique 32, task-memory 45, patch-engine 57, error-normalizer 48, knowledge-graph 17, graph-retrieval 30, context-optimizer 40, signature-map 25, graph-query 26, pattern-miner 26)

---

## v109 — F7: Graph Debug + F8: Pattern Mining (2026-03-09)

Developer-facing graph inspection and cross-milestone pattern discovery — the final two features in the F-Series agent evolution roadmap.

### Graph Query (`graph-query.js`, ~200 LOC)
- **`getImpactRadius()`**: BFS neighborhood traversal (both directions), depth-annotated nodes, deduplicated edges. Capped at 500 nodes.
- **`detectCycles()`**: DFS with WHITE/GRAY/BLACK coloring on file nodes. Normalized cycles (start from smallest element), closed (first==last). Capped at 20 cycles.
- **`computeMetrics()`**: fanIn, fanOut, degree, hubPenalty (via `computeHubPenalty`), dependency/dependent counts.
- **`explainContext()`**: Traces relationship chains from seed files. Uses `graph.findPath()` for N-hop explanations, "No direct path" fallback for isolated files.
- **`exportMermaid()`**: Subgraph → Mermaid diagram. Sanitized node IDs, shape per type (file=rect, function=rounded, other=diamond), edge labels.

### Pattern Miner (`pattern-miner.js`, ~250 LOC)
- **4 pattern types**: ERROR_CASCADE, FIX_ARCHETYPE, FILE_COUPLING, COMPLEXITY_HOTSPOT.
- **`minePatterns()`**: Discovers all 4 types from task memory entries. Confidence threshold 0.7, decay λ=0.01 (LTM-aligned, half-life ~69d). Sorted by confidence DESC, capped at 50.
- **`findArchetypes()`**: Matches current errors to known fix strategies by error code.
- **`formatPatternsForPrompt()`**: `[type] description (confidence%)` format, capped at maxEntries.

### Tests
- graph-query: **26/26** (5 suites: getImpactRadius, detectCycles, computeMetrics, explainContext, exportMermaid)
- pattern-miner: **26/26** (9 suites: PatternType, fix archetypes, error cascades, file coupling, complexity hotspots, decay, findArchetypes, formatPatternsForPrompt, edge cases)
- **0 regressions** (execution-loop 56, self-critique 32, task-memory 45, patch-engine 57, error-normalizer 48, knowledge-graph 17, graph-retrieval 30, context-optimizer 40, signature-map 25)

---

## v108 — F6: Self-Critique + Signature-First Patching (2026-03-09)

LLM-driven root cause analysis and signature-level patch planning. On iteration >= 2 of the fix loop, the system reasons about WHY errors persist before generating the next fix attempt.

### Self-Critique (`self-critique.js`)
- **`shouldActivate()`**: Only activates on iteration >= 2 (first iteration uses fast deterministic path).
- **`analyzeCause()`**: Asks LLM to identify root cause of persistent errors. Includes error trend, signature context, and previous patches. Parses `ROOT_CAUSE:` + `REASONING:` response format.
- **`generatePatchPlan()`**: Produces signature-level fix plan — `ACTION FILE SYMBOL REASON` steps. Actions: ADD, MODIFY, DELETE, MOVE. Capped at 10 steps.
- **`validatePlan()`**: Checks plan steps against KG + symbol index — catches hallucinated symbols (MODIFY/DELETE checks `findSymbol`), missing files (checks `graph.getNode`). ADD skips file existence check. Issues are soft warnings (steps still included).
- **`formatCritiqueForPrompt()`**: Combines root cause, patch plan, and validation warnings into a prompt section.

### Integration
- **execution-loop.js**: `runFixLoop()` accepts optional `selfCritique` object. On iteration >= 2, runs full pipeline (analyzeCause → generatePatchPlan → validatePlan → formatCritiqueForPrompt) and injects "Self-Critique Analysis" section into `buildFixPrompt()`. Two extra LLM calls per critique-enabled iteration (~500+200 tokens, ~25s on local models).
- **lifecycle-build.js**: lazy-loaded via `ensureSelfCritique()`. Passes bound methods to execution loop alongside task memory.

### Tests
- self-critique: **32/32** (7 suites: shouldActivate, analyzeCause, generatePatchPlan, validatePlan, formatCritiqueForPrompt, parseCauseResponse edge cases, integration)
- **0 regressions** (execution-loop 56, task-memory 45, patch-engine 57, error-normalizer 48, knowledge-graph 17, graph-retrieval 30, context-optimizer 40, signature-map 25)

---

## v107 — F5: Task Memory (2026-03-09)

Cross-milestone persistent learning for the execution loop. Records fix attempts (successes and failures) and architecture decisions so the LLM avoids repeating failed strategies and leverages past successes.

### Task Memory (`task-memory.js`)
- **`recordFix()`**: UPSERT with smart conflict resolution — failure→success overwrites (confidence 0.8), success→failure reduces confidence (−0.1), same outcome reinforces (+0.05, cap 0.95).
- **`recordArchDecision()`**: Persistent architecture decisions with 0.9 initial confidence.
- **`queryRelevant()`**: Matches past experience by error code prefix and file path. Architecture decisions always included. Results sorted by effective confidence.
- **`reinforce()`**: Confidence boost on reuse (+0.05, cap 0.95).
- **`prune()`**: Removes entries older than `maxAge` days with decayed confidence below threshold. Architecture decisions exempt.
- **Decay**: `DECAY_LAMBDA=0.005` (half-life ~139 days), gentler than LTM's 0.01.
- **`formatTaskMemory()`**: `[WORKED]`/`[FAILED]` prefix with confidence percentage for LLM prompt injection.

### Integration
- **execution-loop.js**: `runFixLoop()` accepts optional `taskMemory` object. Queries relevant entries before first iteration, injects formatted context into `buildFixPrompt()` as "Past Fix Experience" section. Records all initial errors as fix attempts on loop completion.
- **lifecycle-build.js**: lazy-loaded via `ensureTaskMemory()` from singleton. Passes bound methods (`queryRelevant`, `formatTaskMemory`, `recordFix`) to execution loop.

### Migration
- `2026_03_08_030_v107_task_memory.js`: `task_memory` table with UNIQUE(project_id, kind, key), 4 indexes.

### Tests
- task-memory: **45/45** (10 suites: init, recordFix, recordArchDecision, queryRelevant, prune, reinforce, decay, format, integration, edge cases)
- **0 regressions** (execution-loop 56, patch-engine 57, error-normalizer 48, knowledge-graph 17, graph-retrieval 30, context-optimizer 40, signature-map 25)

---

## v106 — F4: Context Optimizer + Signature Map (2026-03-08)

Intelligent context budget allocation for LLM code generation. Replaces flat 5-file/5K-token budget with cost-benefit ranking and compact API signatures — LLM gets maximum API awareness per token.

### Context Optimizer (`context-optimizer.js`)
- **`rankFilesByValue()`**: Scores files by `relevance / tokenCost`. Seed files get max relevance (1.0). Non-seed scoring: symbol call overlap (0.5 weight, via KG getCallers/getCallees), graph distance (0.3 weight, BFS 1-3 hops), import proximity (0.2 weight). Keyword fallback when no graph available.
- **`allocateBudget()`**: Greedy allocation into 3 tiers — full source (seed budget), signature-only (30% ratio, max 20 files), skip. Reserves 500 tokens for architecture summary.
- **`detectRedundancy()`**: Finds re-export chains via KG IMPORTS edges + symbol overlap — if file A exports ⊇ B's exports and A imports B, skip B.

### Signature Map (`signature-map.js`)
- **`buildSignatureMap()`**: Two-tier extraction — AST (tree-sitter, precise params/export detection) → regex fallback (unsupported languages). Supports JS/TS, Python, Go.
- **`formatSignature()`**: Compact format: `export function processOrder(orderId, items)`, `export class OrderValidator`
- **`formatSignatureMap()`**: Markdown output with "DO NOT modify these files" header.

### Integration
- **lifecycle-build.js**: lazy-loaded via `ensureContextOptimizer()`, wraps existing `buildCodeContextForMilestone()`. Budget 6000 tokens (up from 5000), 30% signature ratio. Graceful fallback to original behavior if module unavailable.

### Tests
- context-optimizer: **40/40** (8 suites: ranking, graph distance, import proximity, keyword, allocation, overflow, breakdown, edge cases)
- signature-map: **25/25** (5 suites: formatSignature, formatSignatureMap, regex extraction, AST path, edge cases)
- **0 regressions** (execution-loop 56, patch-engine 57, error-normalizer 48, knowledge-graph 17, graph-retrieval 30)

---

## v104 — F3: Execution Loop (2026-03-08)

Iterative fix cycle — the linchpin capability that closes the generate→test→diagnose→patch→test loop. When milestone code generation produces errors, F3 replaces coarse retry with fine-grained convergence: parse errors (F2) → build fix prompt → call LLM → parse patches (F1) → validate → apply → test → repeat until convergence or budget exhaustion.

### Pipeline
- **`runFixLoop()`**: Main entry — receives callbacks (`callLLM`, `runTests`, `runQualityGate`, `getGitDiff`) from lifecycle-build.js
- **LoopResult ADT**: `{ converged, stopReason, iterations, finalTestResults, finalQualityGate, lastErrors, report }`
- **Stop reasons**: `all_passed` | `not_converging` | `diverging` | `budget_exhausted` | `unrecoverable` | `patch_failed` | `file_loop` | `scope_exceeded` | `oscillation_detected`

### 10 Guards
1. **Compile-first priority**: compile errors before test errors in prompt
2. **Error frontier filtering**: root causes + max 5 first-order dependents (prevents prompt explosion)
3. **Patch scope limit**: max 5 files per iteration → `scope_exceeded`
4. **File loop protection**: same file patched >3× → `file_loop`
5. **Patch oscillation detection**: hash-based repeat detection → `oscillation_detected`
6. **Preview before apply**: `previewPatch()` validates each patch before `applyPatchSet()`
7. **Divergence rollback**: error count ×2 → rollback last iteration's patches + stop
8. **Prompt size limits**: last 2 patches, 4000 char git diff cap
9. **Unrecoverable early stop**: all errors unrecoverable → skip loop entirely
10. **Budget exhaustion**: configurable max iterations (default 8, `C3_MAX_LOOP_ITERATIONS`)

### Integration
- **lifecycle-build.js**: lazy-loaded via `ensureExecutionLoop()`, activates in `postExecution()` after test/quality gate detect failure
- **Callback injection**: `runTests`, `runQualityGate`, `getGitDiff` passed as callbacks — no code duplication
- **Fallback**: if execution loop module not available, falls back to previous compile-error short-circuit

### Tests
- execution-loop: **56/56** (10 suites: shouldContinue, compareErrors, limitErrors, buildFixPrompt, extractErrors, convergence, guards, callbacks, report, rollback)
- **0 regressions** (patch-engine 57/57, error-normalizer 48/48, knowledge-graph 17/17)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/planner/execution-loop.js` | NEW — iterative fix cycle with 10 guards (~510 LOC) |
| `tests/execution-loop.test.js` | NEW — 56 tests across 10 suites (~930 LOC) |
| `src/planner/lifecycle-build.js` | MODIFY — lazy-loader + F3 integration in postExecution (~30 LOC delta) |
| `src/config.js` | MODIFY — `maxLoopIterations` in lifecycle block |

---

## v104 — F2: Error Normalizer (2026-03-07)

Structured error classification with root-cause cascade detection. Transforms raw build/test output into NormalizedError objects for the execution loop (F3). Standalone module — no integration with lifecycle-build yet.

### NormalizedError ADT
- **14 canonical error codes**: MISSING_PROPERTY, TYPE_MISMATCH, UNDEFINED_VARIABLE, IMPORT_NOT_FOUND, SYNTAX_ERROR, NULL_REFERENCE, ASSERTION_FAILED, TEST_FAILED, FILE_NOT_FOUND, PERMISSION_DENIED, UNUSED_IMPORT, ARGUMENT_COUNT, MISSING_TYPE, UNKNOWN
- **Severity field**: `'error'` | `'warning'` — lint → warning, all others → error (F3 uses this to skip warnings in patch loop)
- **Recoverability**: heuristic per error code, TEST_FAILED conditional on file presence

### `error-normalizer.js` — Main Module
- **`normalizeErrors()`**: Dual-mode — raw string (32-entry ERROR_MAP, most-specific-first) or pre-parsed object array
- **`deduplicateErrors()`**: Key by code+file+line, keep first
- **`classifyRecoverability()`**: Recoverable/unrecoverable/conditional per error code
- **`findRootCause()`**: IMPORT_NOT_FOUND → downstream UNDEFINED_VARIABLE/MISSING_PROPERTY (same-file or symbol-startsWith heuristic, no reverse containment)
- **`formatErrorsForLLM()`**: Root causes first (separate maxRoots budget), derived errors omitted with count
- **File:line extraction**: Window of 5 lines, covers tsc, Python traceback, JS stack trace formats
- **Symbol extraction**: Per-pattern regex capture groups (TS codes, Go, Java, Rust, Python)

### Tests
- error-normalizer: **48/48** (9 suites: constants, raw-string 14 patterns, pre-parsed, severity, file-location, dedup, recoverability, root-cause, LLM-format)
- **0 regressions** (patch-engine 57/57, knowledge-graph 17/17)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/planner/error-normalizer.js` | NEW — error classification + root-cause detection (~230 LOC) |
| `tests/error-normalizer.test.js` | NEW — 48 tests across 9 suites (~340 LOC) |

---

## v104 — F1: Patch Engine (2026-03-07)

Structured, composable, revertible patches as the foundation for execution loop (F3). Replaces text-based repair instructions with semantic anchor-based Patch ADT. F1 is standalone — no integration with lifecycle-build or critic-agent yet.

### Patch ADT
- **Semantic anchors** (not line numbers): `function login(`, `class UserService`, `import fs from` — survive edits across iterations
- **AnchorType enum**: `function`, `class`, `method`, `import`, `line`, `insert_after`
- **Region model**: `{ anchor, anchorType, contextBefore, old[], new[] }` — old=lines to remove, new=lines to add

### `patch-parser.js` — LLM Output → Patch ADT
- **`parsePatchFromDiff()`**: Extracts ` ```diff ` blocks, parses `--- a/path` + `@@ anchor` headers, infers anchorType from text patterns
- **`parsePatchFromFullFile()`**: Greedy two-pointer diff fallback, finds nearest declaration as anchor, size guards (300 lines, 20 regions)
- **`normalizeNewlines()`**: CRLF→LF before all parsing
- Fence regex `/```[^\n]*\n/` handles ` ```diff title="patch" ` variants

### `patch-validator.js` — Pre-Apply Checks + Anchor Resolution
- **3-tier anchor fallback**: exact match → normalized (whitespace collapse) → AST-assisted (tree-sitter, lazy)
- **Ambiguity guard**: `findAnchor()` returns `{ line, tier, matches }` — reject if matches>1 without contextBefore
- **`getRegionOffset(anchorType)`**: structural anchors (function/class/method) offset=1, positional (import/line) offset=0
- **Stale patch detection**: old lines compared against file content at correct offset
- **Overlap detection**: sorted by resolved line, adjacent region boundary check
- **`PATCH_LIMITS`**: MAX_LINES_CHANGED=300, MAX_FILES=5, MAX_REGIONS_PER_FILE=20, MAX_FILE_SIZE=50000
- **`validateSyntaxPostApply()`**: async AST parse, checks `rootNode.hasError`

### `patch-applier.js` — Apply/Revert/Compose
- **Bottom-up application**: resolve all anchors → sort descending → splice — preserves line offsets
- **Backup store**: module-level `Map<filePath, content>` for rollback
- **`composePatchSet()`**: merge same-file patches, detect anchor conflicts
- **`computeMetrics()`**: `anchorsResolved: { exact, normalized, ast }`, linesAdded/Removed/Modified
- **`formatPatch()`**: pretty-printer for logs/debug/UI
- **Trailing newline at EOF**: ensured after patching

### `patch-engine.js` — Main API (only module touching filesystem)
- **`applyPatch()`**: read → validate → backup → apply → syntax check → atomic write (tmp+rename)
- **`previewPatch()`**: dry-run, returns before/after/metrics/formatted diff
- **`rollbackPatch()`**: restore from backup
- **`applyPatchSet()`**: sequential apply with full rollback on any failure (reverse order)
- **`parseLLMOutput()`**: try diff parsing → fallback to full-file diff

### Tests
- patch-engine: **57/57** (11 suites: constants, parseDiff, parseFullFile, findAnchor, validatePatch, applyPatch, backup/revert, composePatchSet, formatPatch, computeMetrics, normalizeNewlines)
- **0 regressions** (knowledge-graph 17/17, concept-registry 42/42, large-project-scaling 35/35)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/patch/patch-parser.js` | NEW — LLM output → Patch ADT (~210 LOC) |
| `src/patch/patch-validator.js` | NEW — 3-tier anchor + validation (~250 LOC) |
| `src/patch/patch-applier.js` | NEW — apply/revert/compose (~220 LOC) |
| `src/patch/patch-engine.js` | NEW — filesystem orchestration (~230 LOC) |
| `tests/patch-engine.test.js` | NEW — 57 tests across 11 suites (~480 LOC) |

---

## v103.1 — Model Registry Startup Wiring (2026-03-07)

Zapojení upgrade pipeline do reálného provozu — non-blocking startup check, periodický recheck, notifikace uživatele.

### Startup Wiring (`src/server.js`)
- **`upgradeManager.startPeriodicCheck()`** v `server.listen()` callback — fire-and-forget, neblokuje start
- **`upgradeManager.stopPeriodicCheck()`** v `gracefulShutdown()` — čistý teardown
- **Non-blocking**: initial check + 24h recheck interval + 5min Ollama poll (all `.unref()`)

### Lifecycle (`src/upgrade/upgrade-manager.js`)
- **`startPeriodicCheck(opts)`**: initial check → 24h recheck → 5min Ollama model hash poll
- **`stopPeriodicCheck()`**: clears all intervals
- **`_pollModelChanges()`**: porovná hash nainstalovaných modelů → re-check při změně (`ollama pull`)
- **`getNotifiableProposals()`**: filtruje proposals s `score >= MIN_NOTIFY_SCORE (6)`
- **`_lastCheckTime`**: timestamp posledního checku

### API Endpoint (`src/routes/system.js`)
- **`GET /api/system/upgrades`**: vrací proposals, formatted text, discovery metadata, history
- **`POST /api/system/upgrades/check`**: force re-check (manuální trigger z FE)

### Session Notification (`src/chat/handlers/pre-handler.js`)
- **Intercept #0 `upgrade_notification`**: side-effect only, once per session
- **Trigger**: první chat zpráva po startu, pokud existují proposals se score ≥ 6
- **`onSystemStep('model_upgrade', ...)`**: emituje do agent logu
- **`_upgradeNotified` flag** na sessionState → max 1× za session

### Tests
- model-upgrade: **56/56** (+8 lifecycle tests: start/stop, idempotency, intervals, poll, notifiable, MIN_NOTIFY_SCORE, lastCheckTime)
- **0 regressions** (concept-registry 42/42, knowledge-graph 17/17)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/upgrade/upgrade-manager.js` | +lifecycle methods, MIN_NOTIFY_SCORE, getNotifiableProposals (~80 lines) |
| `src/server.js` | +import upgradeManager, +startPeriodicCheck in listen, +stopPeriodicCheck in shutdown |
| `src/routes/system.js` | +GET /api/system/upgrades, +POST /api/system/upgrades/check |
| `src/chat/handlers/pre-handler.js` | +intercept #0 upgrade_notification (lazy-loaded, once per session) |
| `tests/model-upgrade.test.js` | +8 lifecycle tests (suite 12) |

---

## v103 — Self-Evaluating Model Registry, Phase 1 (2026-03-05)

Model upgrade pipeline: discover → filter → rank → propose. Nikdy neupgraduje automaticky — vždy jen návrhy ke schválení.

### Model Profiles (`src/upgrade/model-profiles.js`)
- **MODEL_FAMILIES**: 17 rodin (deepseek-r1, qwen, llama, codestral, mistral, phi, gemma, starcoder, llava…)
- **parseModelName()**: Parsuje Ollama model names → `{family, category, version, params, quantization}`
- **MODEL_PROFILES**: 7 rolí (D1, D2, CODE, R1, R2, CHAT, VISION) s requirements, preferredFamilies, validationSuite
- **Helpers**: `isSameFamily()`, `isNewerVersion()`, `getCurrentBindings()`, `getProfile()`

### Model Discovery (`src/upgrade/model-discovery.js`)
- **L1 Local**: `fetchInstalledModels()` — Ollama `/api/tags` s timeout + error handling
- **L3 Family heuristics**: `UPGRADE_HINTS` — 10 kurátorovaných upgrade cest (qwen2.5→3/3.5, deepseek-r1→0528, llama→4…)
- **`buildCandidates()`**: Obohacení Ollama dat o parsovanou rodinu/verzi/parametry/kvantizaci
- **`discover()`**: Full pipeline: fetch → build candidates → enrich with hints

### Upgrade Manager (`src/upgrade/upgrade-manager.js`)
- **`filterCandidates()`**: Filtruje dle param bounds, rodiny/kategorie, vyloučí aktuální model
- **`rankCandidates()`**: Composite score = familyBonus(1-3) + versionBonus(0-2) + paramsBonus(0-2) + recencyBonus(0-2) + hintBonus(0-3)
- **`generateProposals()`**: UpgradeProposal s role, currentModel, candidateModel, score, reason, riskLevel
- **Risk assessment**: same family + newer = low, same family = medium, different family = high
- **UpgradeManager class**: `checkForUpgrades()`, `formatProposals()`, `recordUpgrade()`, `getHistory()`

### Tests
- model-upgrade: **48/48** (11 suites: parser, profiles, families, candidates, hints, filtering, ranking, proposals, manager, risk, MODEL_FAMILIES)
- **0 regressions** (concept-registry 42/42, knowledge-graph 17/17)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/upgrade/model-profiles.js` | NEW — Role profiles, model name parser, family registry (~210 lines) |
| `src/upgrade/model-discovery.js` | NEW — Ollama discovery, candidate building, upgrade hints (~200 lines) |
| `src/upgrade/upgrade-manager.js` | NEW — Filter, rank, propose pipeline + UpgradeManager class (~250 lines) |
| `tests/model-upgrade.test.js` | NEW — 48 tests across 11 suites |

---

## v102.1 — Concept Registry (2026-03-05)

Sémantická detekce konceptů (authentication, database, logging…) a fragmentation analysis — detekce rozptýlení konceptů přes moduly a drift mezi milníky.

### Concept Registry (`src/code-intel/concept-registry.js`)
- **12 concept signatures**: authentication, authorization, database, caching, logging, validation, routing, error-handling, configuration, testing, websocket, file-system
- **Multi-signal scoring**: path patterns (+2), symbol patterns (+2), content patterns (+1 each, cap 2), import patterns (+1 each, cap 2)
- **Threshold 2**: Vyžaduje alespoň jednu silnou shodu (path/symbol) nebo dvě střední (content+import)
- **`scan(files)`**: Detect concepts z pole `{file, content, symbols, imports}`
- **`scanFromGraph(graph)`**: Detect z KnowledgeGraph (file index + symbol data)
- **`getFragmentation()`**: Compute spread score per concept (0.0 = single module, 1.0 = max spread)
- **`detectDrift(previous)`**: Compare two registries → NEW_CONCEPT, CONCEPT_SPREAD, FILE_MIGRATED, CONCEPT_REMOVED
- **`formatForPrompt()`**: Markdown pro architecture brief injection

### Guardian Integration
- **PRE-milestone**: `buildArchitectureBrief()` section 6 — concept fragmentation warnings (> 0.5 threshold)
- **POST-milestone**: `postMilestoneAudit()` — concept drift detection, snapshot persistence via `CONCEPT_SNAPSHOT` drift check
- **Checkpoint enrichment**: `formatAuditForCheckpoint()` includes concept drift findings

### Tests
- concept-registry: **42/42** (11 suites: signatures, path/symbol/content/import detection, multi-signal, query API, fragmentation, drift, formatting, singleton)
- graph-retrieval: 30/30, knowledge-graph: 17/17, graph-sync: 24/24, large-project-scaling: 35/35
- **0 regressions**

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/code-intel/concept-registry.js` | NEW — ConceptRegistry class, 12 concept signatures (~300 lines) |
| `src/planner/architecture-guardian.js` | +concept fragmentation in brief, +concept drift in audit (~100 lines) |
| `tests/concept-registry.test.js` | NEW — 42 tests |

---

## v102.0 — Graph Relevance Stabilization (2026-03-05)

Hub penalty a namespace boost pro graph retrieval — zabraňuje high-degree utility nodes (logger, config, types) dominovat výsledkům a zvýhodňuje soubory ve stejném modulu jako query seeds.

### Hub Penalty
- **`computeHubPenalty(graph, nodeId)`**: `1 / log2(2 + degree)`, clamped to [0.1, 1.0]
- **Threshold 15**: Nodes s degree ≤ 15 dostávají penalty 1.0 (bez penalizace)
- **Efekt**: `utils/logger.js` (degree 300) → penalty ≈ 0.12, vypadne z top výsledků
- **Safety floor 0.1**: I extrémní hub (degree 2000+) zůstane dosažitelný

### Namespace Boost
- **`computeNamespaceBoost(seedModules, targetFile)`**: 1.5× pro soubory ve stejném modulu jako seed
- **Module = první 2 path segmenty** (`src/auth/login.js` → `src/auth`)
- **Seed modules**: Computed z top-N seed files → `Set<string>`
- **Efekt**: `src/auth/session.js` dostane 1.5× boost při query z `src/auth/login.js`

### Score Formula
- **Před**: `parentScore × edgeWeight × depthDecay`
- **Po**: `parentScore × edgeWeight × depthDecay × hubPenalty × namespaceBoost`
- **Backward compatible**: Nodes s degree ≤ 15 a v jiném modulu → oba faktory = 1.0 → beze změny

### Tests
- graph-retrieval: 30/30 (9 nových: 4 hub penalty + 5 namespace boost)
- knowledge-graph: 17/17, graph-sync: 24/24, large-project-scaling: 35/35
- **0 regressions** — existující testy nezměněny (degree < threshold, different modules)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/code-intel/graph-retrieval.js` | +`computeHubPenalty()`, +`computeNamespaceBoost()`, score formula update (+42 lines) |
| `tests/graph-retrieval.test.js` | 9 nových testů (hub penalty + namespace boost) |

---

## v101.0.0 — Large Project Scaling (2026-03-05)

### Graph Storage Refactor (K1)
- **`_edges: Array` → `_edges: Map<id, edge>`**: O(1) edge add/delete (was O(E) filter in `removeFile()`)
- **`_edgesByType: Map<type, Set<edgeId>>`**: Type index for fast edge filtering (CALLS, IMPORTS, etc.)
- **Lighter adjacency entries**: `{ edgeId, target }` instead of `{ edge, target }` — edge fetched from Map on demand
- **O(F) `removeFile()`**: Only processes edges touching the removed file's nodes (counterpart cleanup), not all edges
- **`addEdge()` returns numeric ID**: Monotonic `_edgeCounter` for stable edge references

### Multi-Level Graph (K2)
- **`_moduleIndex: Map<modulePath, Set<relPath>>`**: Module-level grouping (lazy-filled from `_fileIndex`)
- **`getModuleDependencies(modulePath)`**: Cross-module dep analysis with cached `_moduleDepCache`
- **`getModules()`, `getModuleFiles()`, `getFileDependencies()`, `getSymbolDependencies()`**: 3-level query API
- **Auto-maintained**: `addNode()` updates module index, `removeFile()` cleans + invalidates cache

### Priority BFS (K3)
- **`MaxHeap` class**: Binary heap priority queue replacing flat FIFO `queue.shift()`
- **Edge weights**: `CALLS=2.0, IMPORTS=1.0, REFERENCES=0.5, EXTENDS/IMPLEMENTS=1.5, TESTED_BY=0.3`
- **Score formula**: `parentScore × edgeWeight × depthDecay` (default depthDecay=0.7)
- **Dynamic cutoff**: Stops expansion when top-of-heap score < minScore threshold
- **`maxDepth=3` hard limit** (was 2): Deeper but quality-gated traversal

### Streaming Indexer (K4)
- **`streaming-indexer.js` (NEW)**: Reactive index updates via chokidar file watcher
- **Per-file lock** (`_fileLocks: Map<relPath, Promise>`): Prevents concurrent removeFile + reindexFile race
- **200ms debounce** on top of chokidar's 300ms `awaitWriteFinish` + 100ms batch
- **Cascading reindex**: `symbolIndex.reindexFile()` → `knowledgeGraph.reindexFile()` automatically
- **`file-watcher.js` multi-callback**: `watchers` Map stores `{ watcher, callbacks: Set }`, `removeCallback()` API

### Snapshot Persistence (K5)
- **`.c3/snapshot.json`**: Persists project snapshot to disk (survived server restarts)
- **`SNAPSHOT_SCHEMA_VERSION=1`**: Migration-safe — wrong version forces full rebuild
- **Policy-aware invalidation**: If `.c3/architecture-policy.json` mtime > snapshot timestamp → invalidate
- **`getOrCreateSnapshot()` 4-path**: in-memory cache → disk load → incremental update → full build

### Tests
- **35 new tests** in `large-project-scaling.test.js` (6 suites)
- **Stress test**: 1000 nodes + 5000 edges → removeFile < 50ms, expandWithGraph < 100ms
- **5 existing test lines updated** for Map-based `_edges` + new score formula
- **0 regressions**: All 122 existing affected tests pass

---

## v100.0.0 — Architecture Intelligence Platform (2026-03-05)

### Architecture Policy Engine (NEW)
- **`architecture-policy.js`**: Unified declarative policy — single source of truth for architecture rules
- **Load priority**: `.c3/architecture-policy.json` > `ARCHITECTURE.json` (ACF fallback) > auto-detect
- **`generatePolicy()`**: Auto-generates policy from `detectArchitecture()` result
- **`validatePolicy()`**: Schema validation, duplicate detection, circular rule check, boundary validation
- **Bidirectional converters**: `policyToLayers()`, `policyToACF()`, `acfToPolicy()`
- **`DriftDetector.fromPolicy()`**: Static factory replacing hardcoded `DEFAULT_LAYERS`/`ALLOWED_IMPORTS`
- **`architecture-guardian.js`** updated: `_runIncrementalDrift()` now loads policy → `fromPolicy()`
- **`lifecycle-planning.js`** updated: auto-generates `.c3/architecture-policy.json` alongside `ARCHITECTURE.json`

### Incremental Context Engine (NEW)
- **`context-engine.js`**: Symbol-aware context reduction (~70% token savings)
- **`extractRelevantSections()`**: Extracts only functions/classes matching query symbols + context lines
- **`compressContext()`**: Iterative removal of lowest-relevance sections until token budget met
- **`buildIncrementalContext()`**: Impact set + graph expansion + architecture neighbors → compressed context
- **`buildMilestoneContext()`**: Specialized for BUILD pipeline — extracts symbols from scope_files + title

### Autonomous Refactor Agent (NEW)
- **`refactor-agent.js`**: Detect smells → plan → risk gate → apply → verify
- **6 smell types**: dead_code, duplicate_logic, god_class, layer_violation, circular_dep, missing_error_handling
- **`detectSmells()`**: Aggregates from dead-code-detector + drift-detector + file analysis
- **`generateRefactorPlan()`**: Safety gates — risk < 30 (LOW only), coverage required (except dead code)
- **Deduplication by file+type**, severity-sorted (HIGH > MEDIUM > LOW)
- **`formatRefactorReport()`**: Markdown report of safe/skipped/applied/failed steps

### Regression Prediction (NEW)
- **`regression-predictor.js`**: Composite risk scoring for changed files
- **Formula**: `0.35×risk + 0.25×coverage + 0.20×centrality + 0.10×min(churn,30) + 0.10×coupling`
- **Risk levels**: LOW (0-25), MEDIUM (26-50), HIGH (51-75), CRITICAL (76-100)
- **`shouldBlock`**: true when CRITICAL — prevents checkpoint from passing without review
- **`formatRegressionReport()`**: Actionable recommendations per risk factor

### Runtime Feedback Loop (NEW)
- **`runtime-feedback.js`**: Parse build/test output → cross-milestone pattern detection
- **`parseTestOutput()`**: Jest, Mocha, pytest, go test, cargo test — extracts pass/fail/skip + failure details
- **`parseBuildOutput()`**: tsc, eslint, go build, cargo — extracts errors with file:line + warnings
- **`detectPatterns()`**: Recurring errors (2+ milestones), error-prone files → severity-sorted patterns
- **`generateFixSuggestions()`**: Deterministic suggestions (import/syntax/refactor) from patterns
- **`collectFeedback()`**: Aggregates test + build + checkpoint findings per milestone
- **`formatFeedbackForPrompt()`**: Token-budgeted injection into next milestone request

### Project Knowledge Base (NEW)
- **`project-knowledge-base.js`**: Unified project snapshot (architecture + modules + hotspots + conventions)
- **`getOrCreateSnapshot()`**: Main API — incremental by default, full build only on first call
- **`updateSnapshot()`**: Re-scans only changed files + dependencies
- **`formatSnapshotForPrompt()`**: Priority compression (architecture > hotspots > conventions)
- **`diffSnapshots()`**: New/removed/changed modules between snapshots
- In-memory cache with 5-minute TTL

### Milestone Decomposer (NEW)
- **`milestone-decomposer.js`**: Auto-splits large milestones into ordered subtasks
- **`shouldDecompose()`**: Triggers on >1500 LOC, >8 files, or HIGH complexity
- **`decomposeMilestone()`**: Groups scope_files by module, topologically sorts by layer dependency
- **`executeSubtasks()`**: Sequential execution with fail-fast (completed list + failed ID)
- Max 800 LOC per subtask, unique IDs (`ms-1-sub-0`)

### Multi-Agent Build Loop (NEW)
- **`multi-agent.js`**: 5-role pipeline (planner → builder → architect → critic → debugger)
- **Feasibility Gate**: Pre-build validation (dependency check, LOC limit, layer span, scope size)
- **Architect skip optimization**: Guardian PASS + <500 LOC → skip architect phase
- **Critic retry loop**: Max 2 iterations (critic → debugger → critic)
- **Role-specific models**: PLANNER (D1), BUILDER (CODE/0.1), ARCHITECT (D1), CRITIC (R1), DEBUGGER (D2)

### Tests
- architecture-policy: 31/31
- context-engine: 15/15
- regression-predictor: 11/11
- runtime-feedback: 27/27
- project-kb-decomposer: 25/25
- refactor-agent: 22/22
- multi-agent: 30/30
- **Total v100**: 161 new tests, 0 failures
- **Existing tests unaffected**: drift-detector 12/12, impact-analyzer 9/9, context-builder 16/16, knowledge-graph 17/17, architecture-governance 17/17

---

## v99.0.0 — Graph Extensions (2026-03-05)

Inkrementální synchronizace knowledge graph (file-level remove + reindex), BFS graph expansion pro obohacení search výsledků, a 3-signálový risk analyzér.

### Graph Sync — Knowledge Graph Extensions
- **`_fileIndex: Map<relPath, Set<nodeId>>`**: O(1) lookup file → all nodes (symbols, file node)
- **`_buildPromise` mutex**: `finally` reset — zabrání deadlocku při selhání buildu
- **`removeFile(relPath)`**: Robustní cross-ref cleanup — smaže nodes, edges, adjacency/reverse entries; iteruje jen nodes daného souboru (ne celý graf)
- **`reindexFile(relPath)`**: `removeFile()` → re-parse → re-add (atomický update)
- **`validateGraph()`**: Kontrola konzistence — orphan edges, missing nodes, duplicate edges
- **`clear()`**: Reset `_projectPath=null` — **musí se nastavit PO `clear()` v `_doBuild()`** (bug fix)

### Graph Retrieval (NEW)
- **`graph-retrieval.js`** (190 lines): BFS expansion z ranked search výsledků přes KG edges
- **`expandWithGraph(rankedFiles, graph)`**: Seed top-N → BFS přes IMPORTS/CALLS (outgoing) + reverse IMPORTS (incoming)
- **Visited guard + hard limit 500**: Zabrání cyklům a explozi u velkých grafů
- **`buildDependencyContext(relPath, graph)`**: Markdown kontext (imports, imported-by, defines) pro LLM prompt
- **`mergeAndResort(existing, graphFiles)`**: Sloučení keyword + graph výsledků, re-sort by score
- **TESTED_BY edges**: Outgoing z source souboru — `getEdges()`, ne `getIncoming()`

### Risk Analyzer (NEW)
- **`risk-analyzer.js`** (291 lines): Composite risk score z 3 signálů
- **Formula**: `0.4 × impact + 0.35 × coverage + 0.25 × centrality`
- **Impact** (impact-analyzer): Počet affected souborů v ripple effect BFS
- **Coverage** (test-coverage-explorer): Inverzní — nízké pokrytí = vyšší risk
- **Centrality** (knowledge-graph): In-degree + out-degree normalizované
- **Risk levels**: LOW (0-25), MEDIUM (26-50), HIGH (51-75), CRITICAL (76+)
- **`analyzeRisk(changedFiles)`**: Vrací per-file risk + agregovaný project risk

### Code Analysis Integration
- **`code-analysis.js`** (+27 lines): Step 3.5 — graph expansion wiring
- **Pipeline**: `searchCode() → rankFiles() → expandWithGraph() → buildCodeContext()`
- **Graceful fallback**: Pokud KG není populated, přeskočí graph expansion

### Tests
- graph-sync: 24/24
- graph-retrieval: 21/21
- risk-analyzer: 18/18
- **Total v99**: 63 tests, 0 failures
- **Existing unaffected**: knowledge-graph 17/17, code-analysis 41/41

### Soubory

| Nové (2) | Popis |
|----------|-------|
| `src/code-intel/graph-retrieval.js` | BFS expansion + dependency context + merge |
| `src/code-intel/risk-analyzer.js` | 3-signal composite risk scoring |

| Modifikované (2) | Změna |
|-------------------|-------|
| `src/code-intel/knowledge-graph.js` | _fileIndex, _buildPromise, removeFile, reindexFile, validateGraph (+127 lines) |
| `src/code-intel/code-analysis.js` | Step 3.5 graph expansion wiring (+27 lines) |

---

## v98.0.0 — Architecture Governance + Cross-Milestone Consistency (2026-03-05)

### Architecture Guardian (NEW)
- **`architecture-guardian.js`**: Cross-milestone architecture governance orchestrator
- **PRE-milestone**: `buildArchitectureBrief()` — injects architecture context (patterns, rules, API surface, known issues) into milestone request
- **POST-milestone**: `postMilestoneAudit()` — audits architecture state, detects regressions (layer violations, circular deps, ACF score drops)
- **Duplicate logic detection**: Flags same export name in multiple files across milestones
- **State tracking**: `architecture_state` table records pre/post state per milestone (migration 029)
- **`formatAuditForCheckpoint()`**: Enriches checkpoint prompt with cross-milestone architecture state

### API Contract Registry (NEW)
- **`api-contract-registry.js`**: Tracks API surface (exports) across milestones
- **Export extraction**: JS/TS (`export function/class/const`, `module.exports`), Python (`def/class`), Go (capitalized `func/type`)
- **`scanAndDiff()`**: Detects ADDED, MODIFIED, REMOVED exports; flags BREAKING CHANGES when consumers exist
- **`consumer_count`**: Tracks how many files import each export — risk estimation for signature changes
- **`updateConsumerCounts()`**: Periodic scan to refresh consumer usage data
- **`api_contracts` table** (migration 029): lifecycle_id, milestone_id, file_path, export_name, signature, kind, consumer_count

### Critic/Repair Agent (NEW)
- **`critic-agent.js`**: Targeted repair after checkpoint FAIL (not generic full re-execution)
- **6 failure types**: COMPILE, ARCHITECTURE, LOGIC, SECURITY, SCOPE, TEST
- **`classifyFailure()`**: Determines failure type from checkpoint result + audit + quality gate
- **`analyzeFailure()`**: Produces structured FixPlan with targeted instructions + affected files
- **`generateRepairRequest()`**: Builds focused repair prompt (much shorter than full milestone request)
- **Integration**: On retry, executor receives targeted repair request instead of full milestone rebuild

### Lifecycle Pipeline Integration
- **`executeMilestone()`**: Architecture brief injected between code context and executor.start()
- **`postExecution()`**: Guardian audit + API diff run before checkpoint; results enriched into checkpoint prompt
- **`milestoneCheckpoint()`**: New `archContext` parameter — R1 now sees cross-milestone state
- **Retry path**: Critic agent generates targeted FixPlan → `_lastFixPlan` stored on milestone → next execution uses repair request

### Code Intelligence Extensions
- **Pattern Mining** (`architecture-detector.js`): `minePatterns()` — detects recurring structural patterns (controller, error-handling, logging, middleware, auth, validation, DB query, test)
- **`formatPatternsForPrompt()`**: Includes pattern examples for BUILD guidance
- **Hierarchical Context** (`context-builder.js`): `buildHierarchicalContext()` — project→subsystem→module→file hierarchy for architecture-aware prompts
- **Risk Scoring** (`impact-analyzer.js`): `computeRiskScore()` — riskScore = dependencyFactor × (1 - coverageFactor), with testGaps and breakingChanges detection

### Tests
- api-contract-registry: 20/20
- critic-agent: 20/20
- architecture-governance (patterns + risk): 17/17
- architecture-detector: 35/35 (existing, still pass)
- modules: 23/23 (existing, still pass)

---

## v97.0.0 — Code Generation Reliability (2026-03-05)

3-tier AST-guided repair pipeline pro čištění LLM výstupů, Architecture Conformance Framework (ACF) pro automatickou validaci vrstev, a dead-end loop fix pro lifecycle BUILD.

### Code Cleaner (NEW)
- **`code-cleaner.js`** (342 lines): `stripCodeFences()`, `stripTypeAnnotations()`, 3-tier AST-guided repair
- **Tier 1 — Snippet repair**: ±10 lines kolem chyby, 2 pokusy, temp 0, length guard 2× (výstup nesmí být >2× delší než vstup)
- **Tier 2 — Full-file repair**: 1 pokus, temp 0, celý soubor
- **Tier 3 — Accept as-is**: Pokud repair selže, přijmout a pokračovat
- **`languagePromptSuffix(ext)`**: Per-language instrukce ("NO markdown fences, NO TypeScript annotations" pro .js/.py)
- **Wired into BUILD**: `actions.js` volá cleaner na každý vygenerovaný soubor před zápisem

### Architecture Conformance Framework (NEW)
- **`architecture-check.js`** (282 lines): `scanImports()`, `mapFileToLayer()`, `validateArchitecture()`
- **Auto-generate `ARCHITECTURE.json`**: V PLAN fázi (lifecycle-planning.js) se generuje z detekované architektury
- **Post-milestone validation**: Po každém milníku se kontrolují layer violations (controller→service OK, service→controller FAIL)
- **`formatViolationsForCheckpoint()`**: Injekce do checkpoint promptu — R1 vidí porušení vrstev
- **Supports**: JS/TS (import/require), Python (import/from), Go (import), Java (import)

### Dead-End Loop Fix
- **Problém**: BUILD mohl skončit v nekonečné smyčce retry, pokud milestone opakovaně FAIL na stejné chybě
- **Fix**: `lifecycle-build.js` — force-skip kaskáda po 3 retries se stejným failure type
- **`lifecycle-router.js`**: Detekce looping pattern + automatický skip s poznámkou do logu

### E2E Test Harness (NEW)
- **`e2e-harness.js`** (422 lines): Orchestration pro end-to-end lifecycle testy
- **Supports**: Sequential milestone execution, checkpoint verification, transcript capture

### v97.1 Bugfixes
- `__pycache__` scope: Excluded z code-cleaner (binární soubory)
- JSX detection: `.jsx`/`.tsx` soubory nefiltrovány jako TypeScript
- `package.json` errors: Cleaner přeskakuje JSON soubory
- `sessionId` undefined: Guard v lifecycle-router.js

### Soubory

| Nové (3) | Popis |
|----------|-------|
| `src/planner/code-cleaner.js` | 3-tier AST repair pipeline |
| `src/planner/architecture-check.js` | ACF — import scan + layer validation |
| `tests/e2e-harness.js` | E2E lifecycle test orchestration |

| Modifikované (5) | Změna |
|-------------------|-------|
| `src/planner/actions.js` | Code cleaner wiring na file write |
| `src/planner/lifecycle-build.js` | Dead-end loop detection + force-skip |
| `src/planner/lifecycle-planning.js` | Auto-generate ARCHITECTURE.json |
| `src/planner/workflow.js` | ACF validation po milestone |
| `src/planner/lifecycle-router.js` | Looping pattern detection, sessionId guard |

---

## v96.0.0 — Code Intelligence Extensions (2026-03-05)

8 nových analytických modulů rozšiřujících code-intel subsystém + intent-aware kontext strategie v context-builder.

### Dead Code Detector (NEW)
- **`dead-code-detector.js`** (304 lines): Detekce nepoužívaných exportů, unreachable kódu, unused importů
- **3 scan typy**: `detectUnusedExports()`, `detectUnreachableCode()`, `detectUnusedImports()`
- **Cross-reference**: Využívá symbolIndex pro kontrolu, zda export má konzumenty

### Knowledge Graph (NEW)
- **`knowledge-graph.js`** (427 lines): Grafová reprezentace codebase — nodes (file, symbol, module) + edges (IMPORTS, CALLS, EXTENDS, IMPLEMENTS, TESTED_BY, DEFINES, BELONGS_TO, REFERENCES)
- **`buildFromProject()`**: Indexace celého projektu z file systému
- **`getDependencies()`, `getDependents()`, `getCallers()`, `getCallees()`**: Graph traversal API
- **`getFileSymbols()`, `getStats()`, `validateGraph()`**: Introspekce + diagnostika
- **`_fileIndex: Map<relPath, Set<nodeId>>`**: Rychlý lookup file → nodes

### Impact Analyzer (NEW)
- **`impact-analyzer.js`** (247 lines): `analyzeImpact(changedFiles)` — ripple effect analýza
- **Impact set**: BFS přes IMPORTS/CALLS edges (max depth 3)
- **`computeRiskScore()`**: `dependencyFactor × (1 - coverageFactor)` s test gap detekcí

### Execution Graph (NEW)
- **`execution-graph.js`** (327 lines): Runtime call graph reconstruction z AST
- **`buildExecutionPaths()`**: Traces execution from entry points (main, handlers, exports)
- **`findDeadPaths()`**: Paths s 0 callers (unreachable code)

### Test Coverage Explorer (NEW)
- **`test-coverage-explorer.js`** (215 lines): Mapování test→source coverage bez runtime dat
- **`mapTestToSource()`**: Heuristika — test file name + import analysis
- **`findUncoveredFiles()`**: Soubory bez odpovídajícího testu

### Code Evolution (NEW)
- **`code-evolution.js`** (330 lines): Churn analýza a historické metriky (git-based)
- **`analyzeChurn()`**: Počet commitů, frekvence změn, hotspot detekce
- **`getFileHistory()`**: Timeline změn pro konkrétní soubor

### Drift Detector (NEW)
- **`drift-detector.js`** (316 lines): Detekce architektonických odchylek od definovaných pravidel
- **`detectDrift()`**: Layer violations, circular dependencies, naming convention breaks
- **`DEFAULT_LAYERS` + `ALLOWED_IMPORTS`**: Výchozí pravidla (controller→service→repository)

### Exploration Agent (NEW)
- **`exploration-agent.js`** (304 lines): Autonomní průzkum codebase s multi-step strategií
- **`explore(query)`**: Query → expand → search → rank → context build → answer
- **Intent-aware**: Přizpůsobuje hloubku a šířku průzkumu podle intent typu

### Context Builder Extensions
- **`context-builder.js`** (+169 lines): 6 `CONTEXT_STRATEGIES` — intent-aware výběr kontextu
- **Strategies**: CODE_ANALYSIS (15K tokens, deep), CONVERSATIONAL (5K, shallow), BUILD (10K, focused), SEARCH (3K, minimal), FILE_EXPLAIN (8K, single-file), CREATIVE (2K, minimal)

### Tests
- knowledge-graph: 17/17
- dead-code-detector: 12/12
- impact-analyzer: 9/9
- drift-detector: 12/12
- execution-graph: 11/11
- test-coverage-explorer: 8/8
- code-evolution: 9/9
- exploration-agent: 5/5
- context-builder: 16/16
- **Total v96**: 99 tests, 0 failures

### Soubory

| Nové (8) | Popis |
|----------|-------|
| `src/code-intel/dead-code-detector.js` | Unused exports/imports/unreachable code |
| `src/code-intel/knowledge-graph.js` | Graph nodes + edges + traversal API |
| `src/code-intel/impact-analyzer.js` | Change ripple effect + risk scoring |
| `src/code-intel/execution-graph.js` | Runtime call graph reconstruction |
| `src/code-intel/test-coverage-explorer.js` | Test→source coverage mapping |
| `src/code-intel/code-evolution.js` | Git-based churn + hotspot analysis |
| `src/code-intel/drift-detector.js` | Architecture rule violation detection |
| `src/code-intel/exploration-agent.js` | Autonomous multi-step codebase explorer |

| Modifikované (1) | Změna |
|-------------------|-------|
| `src/code-intel/context-builder.js` | 6 intent-aware CONTEXT_STRATEGIES (+169 lines) |

---

## v95.0.0 — Code Intelligence + BUILD Context + IDE File Picker (2026-03-05)

### Architecture Pattern Detector (NEW)
- **`architecture-detector.js`** (186 lines): Heuristic detection of framework, layers, patterns, conventions
- **24 framework signatures**: Express, Flask, Django, Spring, React, Svelte, NestJS, Angular, Gin, Axum, etc.
- **10 layer patterns**: controller, service, repository, model, middleware, config, test, migration, view, util
- **8 architecture patterns**: MVC, REST API, Repository, Middleware, Event-Driven, Pub-Sub, DI, ORM
- **Convention detection**: export style (ESM/CJS/mixed), async patterns, test framework
- `formatArchitectureForPrompt()` — BUILD-ready summary

### BUILD Context Enrichment
- **`lifecycle-build.js`**: `buildCodeContextForMilestone()` — enriches milestone requests with existing code context
- **Pipeline**: `expandQuery(milestone) → searchCode(3 queries, max 20) → rankFiles() → buildCodeContext(5 files, 5K tokens) → detectArchitecture()`
- Appends `## Existing Code Context` and `## Detected Architecture` sections to executor request
- **Guard**: skips docs-only milestones (all scope files are .md/.txt/.rst)
- **Lazy loading**: code-intel modules loaded on first BUILD call via `ensureCodeIntel()`
- **Graceful degradation**: any failure → empty string, BUILD proceeds without context

### IDE File Picker Improvements
- **Smart file picker**: Uses `electronTheiaFilesystem.showOpenDialog` with `defaultPath` set to project folder
- **Remember last directory**: `_lastAttachDir` persisted to session state (localStorage)
- **Drag & drop**: Files can be dropped onto the chat input area
- **Drop zone indicator**: Visual overlay with dashed border during drag
- **Fallback**: Standard `<input type='file'>` when Electron API unavailable

### Tests
- architecture-detector: 35/35
- tier1: 94/94, modules: 23/23, code-search: 14/14, code-analyzer: 41/41

---

## v93.1.0 — Handler Refactor: Pre-handler Registry + decisions.js Split (2026-03-05)

### Pre-handler Intercept Registry (P2)
- **`pre-handler.js`** (526 lines): centralized intercept chain shared by all 3 handlers
- **10 intercepts**: feedback detection, session resume, TODO, build handoff, C4 lifecycle, lifecycle handoff, agent wizard, skill confirmation, attachment guard, specialist routing
- **Mode filtering**: each intercept declares `modes: ['*']` or specific `['CONVERSATION', 'PROJECT']`
- **conversation.js**: 778 → 679 lines (10 inline intercept blocks → single `preHandle()` call)
- **project.js**: 614 → 485 lines (3 mirrored intercept blocks → single `preHandle()` call)
- **expertise.js**: wired with `preHandle(input, context, 'EXPERTISE')`

### decisions.js Split (P6)
- **decisions.js**: 1355 → 1054 lines (-301)
- **`ask-user.js`** (119 lines): `handleAskUserDecision`, `formatClarificationRequest`
- **`utils/search-enrichment.js`** (164 lines): `enrichSearchQuery`, `isMetaContinuation`, `buildConversationContext`
- Barrel re-export from decisions.js for backward compatibility (zero consumer changes)

### Documentation (P1 + P3)
- **`API-REFERENCE.md`**: ~180 REST endpoints across 13 route modules (auth, shapes, side-effects)
- **`MEMORY.md`**: 7 memory modules (~2,100 lines), three-tier memory system
- **`WS-PROTOCOL.md`**: Protocol v1, 5 channels, backend + client architecture
- **`NOTIFICATIONS.md`**: 6 channels, trust-aware delivery with auto-mute

### Tests
- tier1: 94/94, modules: 23/23, gatekeeper: 43/43

---

## v93.0.0 — Lifecycle E2E + Specialist Focus + IDE Polish (2026-03-04)

### Checkpoint Architecture (v92)
- **CheckpointMode**: STRUCTURAL / FUNCTIONAL / SECURITY — mode-specific validation
- **Mode assignment**: explicit from roadmap LLM > positional heuristic (first=STRUCTURAL, last=SECURITY, rest=FUNCTIONAL)
- **Adaptive retry**: checkpoint returns `fix_instructions[]` → fed back into next retry
- **DB**: `milestones.checkpoint_mode` column (migration 026)

### Specialist Focus Mode (v92)
- **Derived state**: `isFocusActive()` = `!!session.specialist` — no snapshot/restore
- **CSS-driven layout**: `body.c3-focus-mode` class, no Theia widget mutations
- **Center**: full-width chat via `_chatPaneUI(idx, {fullWidth:true})`
- **Right panel**: `FocusFilesApp()` — file list from attachments + backend metadata
- **Bottom panel**: render-time override `effectiveBottom`, session state untouched
- **File tracking**: `_focusFiles[]` — dedup, max 100, persisted to localStorage

### Project Workflow Fix (v88)
- **Lifecycle intercepts**: mirrored from conversation.js into project.js (build handoff, C4 auto-detect, lifecycle handoff)
- **FE wizard fix**: `lifecycle/start` moved inside conv POST `.then()` (no session-0 mismatch)
- **ensureRoadmap()**: scaffold ROADMAP.md, never overwrites existing
- **WM persistence**: write-through to DB, restored on project sync

### Lifecycle E2E Tests (v90–v93)
- **Milestone ID scoping**: `scopeId(lifecycleId, 'ms-1')` prevents cross-lifecycle collision
- **parseJSON hardening**: strip `<think>` blocks, fix trailing commas, greedy brace regex
- **Project conversation E2E**: 56/56 pass (4 projects: Flask, Go, Svelte, resume-existing)
- **Build loop improvements**: blocked-milestone skip detection, approval regex tuning

### CRE Improvements (v87–v93)
- **GUARD 6**: Creative override — SEARCH/AMBIGUOUS → CREATIVE when expertise is active
- **GUARD 8**: SKILL deterministic upgrade — `expert[iyíý][zs]` for all Czech spelling variants
- **GUARD 9**: Meta-skill detection + post-lifecycle context
- **BUILD dead-end fix**: `DecisionType.PLAN` case added to project.js + expertise.js

### Email Notifications (v93)
- **Pipeline wiring**: nodemailer integration, lifecycle milestone/review hooks
- **IDE settings**: notification channel configuration in Settings panel
- **Lifecycle hooks**: auto-notify on milestone completion, review request, build failure

### D5 — Specialist-Expertise Discovery (v91)
- **REST API**: `GET/POST/DELETE/PATCH /api/specialists/:id/expertises` — bind/unbind expertises to specialists
- **specialist-loader.js**: discovery + binding persistence
- **Migration 025**: `specialist_expertises` table

### IDE Polish (v93)
- **Agent wizard overhaul**: expanded fallback schema, Czech labels, auto-propose, source/condition/action config, cron presets, validation checklist
- **License gate removal**: FREE tier no longer blocks agent routes
- **Center panel toggle**: sidebar nav click toggles view on/off (shows editor)
- **Opaque background**: solid bg0 for active views on pro themes (no editor bleed-through)
- **Codicon fix**: tab close icon forced to codicon font on pro themes

---

## v91.0.0 — Settings Phase 3: Ecosystem Features (2026-03-01)

### Item 1: Feature Flags UI
- **FeatureManager**: `has()`, `resetToDefaults(configFeatures)`, SETTING_KEY_MAP pro 7 flagů
- **API**: `GET /api/features`, `POST /api/features/:name` (s has() validací), `POST /api/features/reset`
- **FE**: `settingsFeatureFlags()` — 7 toggleů, critical flag warning, reset button
- **Theia**: `c3.features.*` preference keys pro agents, lifecycle, expertises, telemetry, specialistTelemetry, autonomy
- `resetToDefaults()` volá `set()` jen pro flagy kde se hodnota liší → onChange listeners jen pro skutečné změny

### Item 2: Security Section
- **Auth guard**: `requireAuth()` — localhost bypass (dev only), `timingSafeEqual` pro `C3_ADMIN_TOKEN`
- **Production fail-fast**: `process.exit(1)` pokud `NODE_ENV=production` a `C3_ADMIN_TOKEN` chybí
- **API tokeny**: SHA-256 hash (includes `c3_` prefix), plaintext vrácen JEN JEDNOU, UNIQUE constraint
- **Token validation**: `validateApiToken()` — expiry check (UTC), `last_used_at` update jen při úspěchu
- **Audit**: unified view (CRE/merge/drift/LLM), server-side pagination (max 1000)
- **Webhook secret**: masked display (`c3_abcd...wxyz`), regenerate s potvrzením
- **FE**: `settingsSecurityPanel()` — 4 sekce (audit log s taby, API tokeny CRUD, webhook, sessions)
- **Migration 024**: `api_tokens` table s UNIQUE(token_hash)

### Item 3: Getting Started / Tutorial
- **Onboarding**: 4→5 kroků — nový krok "Klíčové funkce" (4 pilíře: Chat, Projekty, Workeri, Expertízy)
- **Flow**: Welcome → Connect → Features → Tour → Ready
- **About panel**: "Spustit průvodce prvním spuštěním" button (reset `c3.onboarding.completed`)

---

## v90.0.0 — Smart Relay Management + Typing Indicator (2026-03-01)

### Smart Relay Management
- **`_smartRouteToRelay()`**: auto free-relay detection, expand to 3, picker dialog fallback
- **`targetSession` removed**: all 8 usages replaced with smart routing
- **Label persistence**: `_label` snapshot field on sessions, persisted to localStorage
- **Label rendering**: prefer `_label`, fallback to PROJECTS/CONVERSATIONS lookup
- **"+" button rewrite**: empty pane→reset, free relay→switch, expand→new, full→picker dialog
- **Relay picker dialog**: overlay in ChatApp showing occupied relays + "Open in new relay"
- **`_isSessionEmpty()`**: centralized empty-relay definition (no convId, no projectId, msgs ≤ 1)
- **`_resetSessionToClean()`**: standardized session reset helper
- **`_closeDialogAction` fix**: `_label` reset on both conv and pane close

### Typing / Thinking Indicator
- **`_thinking` state**: per-session `{text, ts}` — set on send, cleared on response
- **Animated dots**: 3 CSS dots with `c3-thinking-dot` keyframes (staggered 0/0.15/0.3s delay)
- **Live status text**: updates from `agent:log` events (shows what C3 is currently doing)
- **Error safety**: thinking cleared on HTTP/WS error (no stuck indicator)
- **Edit-mode support**: thinking indicator also works for edit/resend flow

---

## v89.0.0 — Version Unification + Project Welcome (2026-02-28)

### Version Unification
- **Single source of truth**: `package.json` version → `getCurrentVersion()` → `/api/system/info`
- **Status widget**: dynamicky čte verzi z backendu (fetch `/api/system/info` při health check)
- **Snap-collapse**: odstraněn hardcoded version string
- **Bump**: 87.6.4 → 89.0.0

### Proactive Project Welcome (v89)
- **`project-state-reader.js`**: deterministický parser README + ROADMAP → structured state
  - `stateType`: FULL / HYBRID / FOREIGN / EMPTY
  - `phaseStatus`: IN_PROGRESS / PENDING / COMPLETED / UNKNOWN
  - Tolerantní regex, BOM strip, 50k size guard
- **`welcome-generator.js`**: template-based welcome (5 variant, ≤600 chars)
- **Backend**: `POST /api/projects` + `open-folder` vrací `welcomeMessage`
- **Persist**: `POST /api/conversations` ukládá welcome jako první assistant turn
- **Frontend**: zobrazení welcome v wizard i open-folder flow
- **41 testů**

---

## v88.2 — Project Analysis Consumption (2026-02-28)

Wire project analysis (`project_memory.last_analysis`) to 4 downstream consumers:
- **`controller.js`**: `projectAnalysis` v fullContext
- **`context-init.js`**: cached analysis v initial context block (s `db` parametrem)
- **`lifecycle-router.js`**: cached analysis z DB (fallback na fresh `analyzeExistingProject()`)
- **`project.js`**: `buildProjectStatusResponse()` obohacen o structure/git/pkg data

### Tests
- 4 nové testy v `project-lifecycle-intercept.test.js` (23 celkem)

---

## v88.1 — Project Name Collision Fix (2026-02-28)

- **Archive/delete**: přidává suffix `[archived-xxx]`/`[deleted-xxx]` k názvu → uvolní jméno
- **Restore**: stripne suffix pokud není kolize; při kolizi ponechá suffix
- **`getOrCreate()`**: `_nameConflict` flag pro duplicitní aktivní jména
- **7 testů** v `project-lifecycle-intercept.test.js`

---

## v88.0 — Project Workflow Fix: Lifecycle Intercepts + State Persistence (2026-02-28)

Oprava celého project creation/opening workflow. Lifecycle engine byl nedosažitelný z PROJECT mode — sticky routing obcházel intercepts v conversation handleru.

### Backend — Lifecycle Intercepts v project.js
- **Build handoff intercept** v `projectHandler` — mirror z conversation.js (PROPOSED/CONFIRMING/CLARIFYING/PLAN_REVIEW/EXECUTING)
- **C4 lifecycle auto-detect** — RAM lookup `getLcStateByProject()` + DB fallback pro migraci session
- **Lifecycle handoff intercept** — `getActiveLifecycleHandoff()` → `handleLifecycleInput()`
- **systemResponse() helper** — `ChatMode.PROJECT` pro intercept returns

### Frontend — Session ID Fix + Lifecycle Bind
- **Wizard session ID fix** — `lifecycle/start` přesunuto dovnitř `.then()` callbacku conversation POST (fix `session-0` mismatch)
- **Open-folder lifecycle bind** — `POST /api/projects/:id/lifecycle/bind` v `_doOpenExistingProject()` po conv POST
- **Webpack rebuild** provedena

### README + ROADMAP Guarantee
- **`ensureRoadmap()`** — nová funkce v `readme-generator.js`, scaffold ROADMAP.md s fázovací tabulkou
- **Nový projekt**: `ensureRoadmap()` voláno po `generateReadme()` v `POST /api/projects`
- **Open folder**: `ensureReadme()` + `ensureRoadmap()` v `POST /api/projects/open-folder`
- Nepřepisuje user-created ani lifecycle-generated soubory

### Project State Analysis
- **`analyzeExistingProject()`** voláno v obou project routes (new + open-folder)
- Výsledek perzistován do `project_memory` (key: `last_analysis`, category: `system`)
- Non-fatal — failure = log, ne crash

### Working Memory DB Persistence
- **`SessionState.initProjectMemoryDb()`** — statická init metoda pro DB referenci
- **Write-through** v `setProjectGoal()`, `setActiveFile()`, `setLastArtifact()` → `project_memory` (category: `working_memory`)
- **DB restore** po project sync v `ChatController.handle()` — načte `wm:*` entries z `project_memory`
- **Null delete** — `setProjectGoal(null)` smaže z DB
- Wired v `server.js`: `SessionState.initProjectMemoryDb(db.projectMemory)`

### Tests
- **13 nových testů** v `project-lifecycle-intercept.test.js`
  - `ensureRoadmap()` — create, no-overwrite, reject invalid paths
  - `SessionState` WM persistence — persist, delete, no-crash without DB/project
  - Structural check — `projectHandler` export

### Files Changed
| File | Changes |
|------|---------|
| `src/chat/handlers/project.js` | Lifecycle/build intercepts, systemResponse helper |
| `c3-ide/.../chat-panel-module.js` | Session ID fix, lifecycle bind in open-folder |
| `src/chat/handlers/utils/readme-generator.js` | `ensureRoadmap()` function |
| `src/routes/projects.js` | README/ROADMAP guarantee, project analysis |
| `src/chat/controller.js` | WM DB persistence (write-through + restore) |
| `src/server.js` | `SessionState.initProjectMemoryDb()` wiring |
| `tests/project-lifecycle-intercept.test.js` | 13 new tests |

---

## v87.0–87.6 — IDE Settings Redesign + CRE Guards + BUILD Fix (2026-02-28)

Kompletní přepis Settings UI v IDE (10 sekcí), CRE GUARD 6 (creative override), BUILD dead-end fix, LLM timeout hardening.

### v87.3 — Settings UI Redesign

- **10 nových sekcí**: Account, LLM, Memory, Notifications, Output, Appearance, System, Storage, Backup, About
- **Backend config sync** — `_bCfg` stav: `GET/POST /api/settings` s debounced save (500ms)
- **GPU detekce** — `GET /api/system/gpu` → karta s gpu_model, VRAM, driver, CUDA
- **Ollama model selector** — dropdown z `GET /api/system/models`
- **Notification channels** — 4 karty (email, telegram, webhook, ntfy) se statusem z backendu
- **Backup export/import** — JSON download/upload s feedback hláškami
- **Storage overview** — DB velikost, migrace, tabulky, vacuum + optimize

### v87.4 — Settings UX Polish

- **Info tooltipy** — `_iI(text)` + `_lI(text, info)` — ikony (i) s popisy u LLM a Memory polí
- **GPU fix** — správné mapování `gpu_model`/`vram_mb` z `profile.gpus[]`
- **Account zjednodušen** — odebrána měna a timezone (patří do System)
- **Notification channels** — 4 provider karty se statusem (configured/not configured)
- **Output** — jasné popisy, "1 token ≈ 4 znaky" u max response length
- **System** — přesunuta měna/timezone, KB/MB formátování, diagnostika (node, uptime, RAM)
- **Storage** — reálná DB data (size_mb, migrations, tables), "Optimalizovat databázi" s vysvětlením
- **Backup** — zelené/červené feedback hlášky s auto-dismiss (4s)
- **About** — verze z backendu (`getCurrentVersion()`)

### v87.5 — DB Fix + About Simplification

- **rawDb pattern** — `const rawDb = db.db || db;` v system.js — wrapper objekt vs raw better-sqlite3
- **Storage** — nyní zobrazuje reálná data (size, migrace, počty tabulek)
- **About** — zjednodušen na logo + verze + attribution (systémové info jen v System)

### v87.6 — CRE GUARD 6 + BUILD Dead-end Fix

- **GUARD 6 (Creative Override)** — `creativeLock`/`outputBias=creative` → SEARCH/AMBIGUOUS přesměrováno na CREATIVE
  - Bypass pro explicitní search patterny (vyhledej, googl, ve skutečnosti, historická fakta)
  - Řeší: DnD "Prokletý ostrov" → SEARCH → Shutter Island film
- **BUILD dead-end fix** — `DecisionType.PLAN` přidán do project.js + expertise.js switch
  - Řeší: 12× REFUSE při "začni s buildem" v PROJECT mode
- **LLM Gateway timeout** — CHAT 60s→90s, no retry on AbortError, E2E timeout 90s→120s
- **Synthesis numeric density** — SEARCH kontrakt "EXTRACT SPECIFIC DATA", regex gate pro čísla
- **Attachment guard** — pre-CRE deterministic override: attachment + file-ref → FILE_EXPLAIN

### Testy

- `expertise-routing-correctness.test.js` — 43 assertions (GUARD 6)
- `expertise-comparison-e2e.test.js` — 78 konverzačních turnů

### Soubory

| Nové/Modifikované | Popis |
|-------------------|-------|
| `chat-panel-module.js` | Kompletní přepis Settings UI (10 sekcí, ~800 řádků) |
| `src/routes/system.js` | rawDb fix, getCurrentVersion() |
| `src/chat/cre-decision.js` | GUARD 6 (creative override) |
| `src/chat/handlers/conversation.js` | Attachment guard |
| `src/planner/project.js` | PLAN case v switch |
| `src/expertises/expertise-layer.js` | PLAN case v switch |
| `src/llm/gateway.js` | Timeout + retry fix |

---

## v86.0 — Memory System (LTM + Smart Ranking + Feedback Learning) (2026-02-27)

Aktivace tří paměťových vrstev: LongTermMemory persistence, inteligentní context injection, a implicitní učení z uživatelského feedbacku.

### M1 — LTM Stabilization

- **LTM persistence** — `longTermMemory.db = db.db; .init()` v server.js; data přežijí restart
- **Confidence decay** — `effective = base × e^(-0.01 × ageDays)`, half-life ~69 dní
- **Reinforcement** — `reinforce(kind, key)` → +0.05 confidence (cap 0.95) + access_count++
- **Preferences persistence** — adjustmenty → LTM write, startup → `loadFromMemory()`
- **context-budget wiring** — `buildBudgetedContext(intent)` v `fullContext`, použit v `handleToolCallDecision`
- **LTM→synthesis fix** — `context.ltm` byl vždy null, nyní populated ze singletonu

### M2 — Intelligent Memory

- **injection-ranker.js** — `rankForContext(entries, input, intent)`: score = effConf × relevance
  - Relevance = 0.4×keywordOverlap + 0.45×intentAffinity + 0.15×recencyBonus
  - Intent-kind affinity matrix (CODE→correction=0.9, CONVERSATIONAL→style=0.9, etc.)
- **ltm-context.js** — ranked injection když je dostupný input+intent, fallback na confidence sort
- **pattern-tracker.js** — cross-conversation learning přes LTM (kind: 'pattern')
  - Intent sequences (SEARCH→CODE), topic affinity, tool success tracking

### M3 — Learning System

- **feedback-detector.js** — 6 signálů: POS/NEG × EXPLICIT/IMPLICIT + CORRECTION + NEUTRAL
- **Conversation wiring** — `detectFeedback()` na začátku tahu, záznam do PreferenceEngine
- **Correction capture** — CORRECTION signal → LTM write (kind: 'correction', source: 'corrected')
- **Tool success tracking** — `patternTracker.recordTurn()` v decisions.js po tool execution

### Data Retention

- **data-retention.js** — tiered pruning: 30d telemetry, 60d logs, 90d conv_memory
- **Archive-before-delete** — messages archived flag, soft-delete → hard-delete po 30d
- **DB size pressure** — WAL checkpoint + ANALYZE po větším prune
- **Migration 021** — indexy na created_at, messages.archived, memory.access_count/last_accessed_at
- **Periodic maintenance** — daily prune + weekly compact (oba `.unref()`)

### Soubory

| Nové (5) | Popis |
|----------|-------|
| `src/memory/injection-ranker.js` | Smart LTM ranking pro context injection |
| `src/memory/feedback-detector.js` | Sémantická detekce feedbacku (6 typů) |
| `src/memory/pattern-tracker.js` | Cross-conversation pattern learning |
| `src/db/data-retention.js` | Unified data retention (nahrazuje telemetry-retention) |
| `src/db/migrations/2026_02_27_021_v86_memory_retention.js` | DB migrace |

| Modifikované (7) | Změna |
|-------------------|-------|
| `src/memory/long-term.js` | Confidence decay, reinforcement, access tracking |
| `src/memory/preferences.js` | Persist adjustmenty do LTM |
| `src/chat/controller.js` | context.ltm fix, buildBudgetedContext wiring |
| `src/chat/ltm-context.js` | Ranked injection s input+intent |
| `src/chat/handlers/conversation.js` | Feedback detection, pattern tracking |
| `src/chat/handlers/decisions.js` | Tool success tracking |
| `src/server.js` | LTM init, PatternTracker wire, periodic maintenance |

---

## v85.0 — Skills System MVP + Runtime FeatureManager (2026-02-26)

Deterministický systém maker/receptů pro opakující se postupy. C3 automaticky rozpoznává, kdy uživatel chce spustit skill, a po potvrzení provede sekvenci kroků (LLM, template, write, shell).

### Skills System

- **Skill Registry** — Načítá definice z `skills/*.json`, validuje schéma, graceful empty load
- **Skill Resolver** — LLM identifikuje skillId + parametry + confidence; post-validace (4 body)
- **Skill Runner** — State machine (IDLE → CONFIRMING → EXECUTING → DONE/FAILED), retry pro transient chyby
- **4 step typy**: `llm` (LLM volání), `template` (substituce), `write` (soubor se sandbox ochranou), `shell` (whitelist příkazů)
- **CRE integrace** — SKILL intent + DecisionType + feature guard + handler dispatch
- **Confirmation flow** — Resolver → confirm prompt → user ano/ne → execute/cancel
- **REST API** — `GET /api/skills`, `GET /api/skills/:id`, execution status/confirm/cancel
- **DB persistence** — `skill_executions` + `skill_steps` tabulky s audit trail

### Runtime FeatureManager

- **FeatureManager singleton** (`src/core/feature-manager.js`) — runtime hot-toggle feature flagů
- **IDE Settings toggle** — `c3.features.skills` boolean v Theia Preferences
- **WebSocket sync** — `sync_settings` control action pro okamžitou propagaci z IDE do backendu
- **REST sync** — `POST /api/settings` automaticky aktualizuje FeatureManager
- **CRE guard** — `featureManager.isEnabled('skills')` místo statického `config.features.skills`

### Bezpečnost

- Write step: `path.resolve()` + `fs.realpath()` (symlink ochrana), reject `..` a absolutní cesty
- Shell step: whitelist povolených příkazů (`dot`, `plantuml`, `npx`, `node`, ...), 30s timeout
- Resolver: validace skillId v registru, kontrola required params, strip extra params
- Confidence < 0.6: explicitní zpráva "nejsem si jistý", ne tichý fallback

### Soubory

| Nové (13) | Popis |
|-----------|-------|
| `src/skills/registry.js` | Loader + validátor skill definic |
| `src/skills/resolver.js` | LLM resolver (skillId + params) |
| `src/skills/runner.js` | State machine + execution |
| `src/skills/steps/{substitute,template,llm,write,shell}.js` | Step executory |
| `src/chat/handlers/skill.js` | Handler (resolve, confirm, execute) |
| `src/routes/skills.js` | REST API |
| `src/core/feature-manager.js` | Runtime feature toggle |
| `src/db/migrations/2026_02_26_020_v85_skills.js` | DB migrace |
| `skills/create-expertise.json` | Ukázkový skill |
| `docs/skills-v1.md` | Dokumentace |

| Modifikované (9) | Změna |
|-------------------|-------|
| `src/chat/cre-decision.js` | SKILL intent/decision + guard + mapping |
| `src/chat/handlers/conversation.js` | Lazy import + confirm intercept + switch case |
| `src/llm/auth-types.js` | SKILL_EXECUTOR + SKILL_RESOLVER role |
| `src/db/database.js` | skillExecutions + skillSteps repos |
| `src/config.js` | `features.skills` flag |
| `src/server.js` | Registry init + routes + FeatureManager init |
| `src/ws-bridge/session-adapter.js` | sync_settings control |
| `src/routes/misc.js` | POST /api/settings → FeatureManager |
| `c3-ide/extensions/c3-settings/` | IDE preference toggle + sync listener |

---

## v84.0 — Project-Aware CRE Classification (2026-02-26)

LLM klasifikátor nyní zná kontext aktivního projektu. Dotazy typu "analyzuj X z projektu" nebo "udělej mi výtah z tohoto folderu" se správně klasifikují jako FILE_EXPLAIN/FILE_READ místo CONVERSATIONAL.

### Problém

Když uživatel napsal "Analyzuj a shrn mi parametry z projektu", CRE to klasifikovalo jako CONVERSATIONAL:
1. LLM classifier vrátil prázdnou odpověď (Ollama issue) → regex fallback
2. `REPORT_SOFT_KEYWORDS` zachytil "analyzuj" → ale `REPORT_FRESH_CONTEXT` nerozpoznal "z projektu" jako fresh-data kontext
3. Propadlo do `KNOWLEDGE_EXPLANATION_PATTERNS` → CONVERSATIONAL (LLM knowledge místo čtení souborů)

### Řešení (2 vrstvy)

**1. LLM prompt — project context hint**

Když `context.hasActiveProject` je true, systémový prompt pro LLM klasifikátor obsahuje:
> Uživatel má AKTIVNÍ PROJEKT. "z projektu"/"v projektu"/"z tohoto folderu"/"ze složky" = soubory projektu. Analyzuj/shrň/vysvětli obsah → FILE_EXPLAIN. Přečti/projdi/zobraz/výtah → FILE_READ. NIKDY CONVERSATIONAL pro dotazy o projektu.

Toto je primární fix — LLM rozhoduje kontextově, ne šablonou.

**2. REPORT_FRESH_CONTEXT — regex fallback safety net**

Přidány project-scope termy do `REPORT_FRESH_CONTEXT`:
`z projektu`, `v projektu`, `ze složky`, `z fold*`, `z adresáře`, `from project`, `from folder`

Když LLM selže (prázdná odpověď), regex fallback dá alespoň REPORT (tool use) místo CONVERSATIONAL.

### Výsledek

| Vstup | Před (v83) | Po (v84) |
|-------|-----------|----------|
| "analyzuj parametry z projektu" | CONVERSATIONAL | REPORT (regex) / FILE_EXPLAIN (LLM) |
| "analyzuj resource lnotes v projektu" | CONVERSATIONAL | REPORT (regex) / FILE_EXPLAIN (LLM) |
| "analyzuj soubory ze složky" | CONVERSATIONAL | FILE_EXPLAIN |
| "udělej mi výtah z projektu z tohoto folderu" | AMBIGUOUS | FILE_READ (LLM) |

### v84.1 — FILE_READ bez souboru → directory listing

Architektonický fix: místo přidávání hardcoded frází do `detectFileIntent`, file handler sám defaultuje na directory listing ('.' = project root) když:
- Intent je FILE_READ
- Uživatel má aktivní projekt
- Není specifikován konkrétní soubor

Funguje pro **jakoukoliv formulaci** — stačí, aby LLM klasifikátor rozpoznal záměr jako FILE_READ v project kontextu. `readFileSafe` + `formatFileReadResponse` už directory listing podporují (📁/📄 výpis).

Revertovány hardcoded pattern rozšíření z v84.1-draft (seznam, workspace, hasLocationRef, check 4) — nejsou potřeba.

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/chat/cre-decision.js` | Project hint v `_llmClassifyIntent()`, project-scope v `REPORT_FRESH_CONTEXT` |
| `src/chat/handlers/file.js` | FILE_READ bez filePath v project mode → default `'.'` (directory listing) |

---

## v83.0 — Guarded Autonomy (2026-02-26)

Self-tuning CRE override threshold via telemetry drift detection. Autonomní režim s trust-gated auto-apply — po 10 po sobě jdoucích approval se akce aplikují automaticky. Opt-in přes `C3_ENABLE_AUTONOMY=true`.

### Autonomy Controller (NEW)
- **`autonomy/controller.js`** (253 lines): Řídí override threshold + trust gate + safety layers
- **Self-tuning threshold**: `setOverrideThreshold()` v cre-decision.js — CRE přizpůsobuje práh na základě telemetrie
- **Guard band** `[0.75, 0.90]`: Threshold nikdy neklesne pod 0.75 ani nepřekročí 0.90
- **Max step 0.03**: Maximální změna prahu za jedno okno (zabraňuje náhlým skokům)
- **Cooldown**: 2 okna po drift detekci — threshold se nemění
- **Trust gate**: 10 po sobě jdoucích approvals → auto-apply (reset při jakémkoliv deny)
- **10 safety layers**: Žádný override na REFUSE, FILE_READ, SKILL; max 5 auto-applies za session; always-confirm pro destruktivní akce

### Telemetry Aggregator (NEW)
- **`autonomy/aggregator.js`** (141 lines): Periodická agregace telemetrie do sliding windows
- **Sliding window**: 15-minutové intervaly, exponenciální vyhlazení
- **Metriky**: override_accuracy, intent_stability, response_quality, user_satisfaction

### Drift Detector (NEW)
- **`autonomy/drift-detector.js`** (147 lines): Detekuje změny v override accuracy
- **Z-score**: Porovnává aktuální okno vs. historický průměr (σ > 2.0 = drift)
- **Alert**: Při driftu → cooldown aktivován, threshold rollback

### REST API + DB
- **`routes/autonomy.js`** (128 lines): `GET /api/autonomy/status`, `POST /api/autonomy/toggle`, `GET /api/autonomy/history`
- **Migration 019**: 3 tabulky — `telemetry_metrics`, `telemetry_alerts`, `telemetry_improvements`

### Soubory

| Nové (7) | Popis |
|----------|-------|
| `src/autonomy/controller.js` | Override threshold + trust gate + safety |
| `src/autonomy/aggregator.js` | Sliding window telemetry aggregation |
| `src/autonomy/drift-detector.js` | Z-score drift detection + cooldown |
| `src/routes/autonomy.js` | REST API pro autonomy management |
| `src/db/migrations/2026_02_26_019_v83_autonomy.js` | DB migrace (3 tabulky) |
| `docs/autonomy-v1.md` | Dokumentace autonomního režimu |

| Modifikované (3) | Změna |
|-------------------|-------|
| `src/config.js` | `C3_ENABLE_AUTONOMY` flag |
| `src/chat/cre-decision.js` | `setOverrideThreshold()` API |
| `src/server.js` | Controller + aggregator init, routes mount |

---

## v82.0 — Specialist Telemetry (2026-02-25)

Pasivní observability vrstva pro specialist execution subsystém. Sleduje tool match/success/fail, memory hit/miss, lifecycle eventy (boot/enable/disable) a API latenci. Best-effort — nikdy neblokuje, nikdy nethrowuje, nikdy nemění control flow.

### Architektura

- In-memory queue + periodic batch flush (30s interval, `setInterval().unref()`)
- NOOP sentinel (`Object.freeze({...})`) eliminuje if-guardy na call sites
- Event type whitelist (`VALID_EVENT_TYPES`) — neznámý typ = silent ignore
- Backpressure: hard limit 2000 events, drop oldest při přetečení
- Metadata: flat JSON, max 1KB, žádné citlivé hodnoty (klíče, PII, query params)
- Duration vždy integer ms (`Math.round()`)
- Retention: centralizovaný `telemetry-retention.js` (30d pruning, 200K warning)

### Event Types

```
tool.match, tool.success, tool.fail, tool.clarify
memory.hit, memory.miss, memory.write
lifecycle.boot, lifecycle.enable, lifecycle.disable
api.request
```

### Změny

- **Migration 018:** `specialist_telemetry` tabulka + 3 indexy
- **specialist-telemetry.js:** Nová třída (NOOP, whitelist, backpressure, batch flush, getSummary)
- **Config:** `specialistTelemetry` feature flag (`C3_SPECIALIST_TELEMETRY`)
- **Server wiring:** Init PŘED boot(), DI do loader/runtime/memory, graceful shutdown
- **Loader:** lifecycle.boot/enable/disable instrumentace (DI přes options.telemetry)
- **Runtime:** tool.match/success/fail/clarify instrumentace v tryToolExecution()
- **Memory:** memory.hit/miss/write instrumentace (nikdy klíče/hodnoty)
- **REST API:** `withApiTelemetry` wrapper (strip query params) + nový endpoint `GET /api/specialists/telemetry`
- **docs/TELEMETRY.md:** Sjednocená telemetry konvence pro všech 5 tabulek

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/db/migrations/2026_02_25_018_v82_specialist_telemetry.js` | NOVÝ — migration |
| `src/db/telemetry-retention.js` | Přidáno do TELEMETRY_TABLES |
| `src/telemetry/specialist-telemetry.js` | NOVÝ — core class |
| `src/config.js` | Feature flag |
| `src/server.js` | Init, routeDeps, shutdown |
| `src/specialists/specialist-loader.js` | DI + 3 record calls |
| `src/expertises/specialist-runtime.js` | Setter + 4 record calls |
| `src/expertises/specialist-memory.js` | Setter + 3 record calls |
| `src/routes/specialists.js` | Wrapper + telemetry endpoint |
| `docs/TELEMETRY.md` | NOVÝ — konvence |

---

## v78.0 — Project Cleanup + Legacy Removal (2026-02-24)

Celková hygiena projektu: odstranění mrtvého kódu, aktualizace dokumentace, sladění package.json s reálným stavem.

### Změny

- **package.json:** Verze 65.5.0 → 78.0.0, description aktualizován (Expertise Merge Engine + Specialist Platform + Ledger)
- **package.json test scripts:** Kompletní přepis ~37 skriptů — staré referencovaly 50+ neexistujících souborů, nové mapují na 115 reálných testů
- **.env.example:** `C3_ENABLE_EXPERTS` → `C3_ENABLE_EXPERTISES`
- **LLM legacy removal:** Odstraněny `callOllama()`, `callOllamaVision()` z client.js, `legacyCall()` z gateway.js, `ALLOW_LEGACY_LLM` guard — vše šlo přes LLMGateway od v36.9
- **client.js:** Zachovány aktivně používané utility: `extractJSON()`, `extractCodeBlocks()`, `extractModifiedFiles()`, `hashQuestion()`
- **PATCH-*.js:** Odstraněny 3 instrukční PATCH soubory z rootu + 3 kopie z docs/ (nikde importované)
- **chats/:** Označeno jako DEPRECATED (legacy pre-v36 standalone server)
- **Dokumentace:** INSTALL.md, ROADMAP.md, EXPERTISES.md, CHANGELOG.md aktualizovány na v78

### Soubory

| Soubor | Změna |
|--------|-------|
| `package.json` | Verze + description + test scripts |
| `.env.example` | Feature flag rename |
| `src/llm/client.js` | Odstraněny callOllama, callOllamaVision, sleep; cleanup header |
| `src/llm/gateway.js` | Odstraněn legacyCall, legacyRole path, ALLOW_LEGACY_LLM guard |
| `PATCH-*.js` (×6) | SMAZÁNY |
| `chats/DEPRECATED.md` | NOVÝ — deprecation notice |
| `docs/INSTALL.md` | Verze v65.4 → v78.0.0 |
| `docs/ROADMAP.md` | Verze v65.7 → v78, milníky v69-v78 |
| `docs/EXPERTISES.md` | Verze v64.0 → v78.0.0 |
| `docs/CHANGELOG.md` | v78.0 entry |

---

## v72.0 — Conversation Hardening (2026-02-23)

**Testy:** 350/350 conversation tests PASS (CZ 150, EN 150, ND 50)

14 oprav v konverzačním pipeline (v72 + v72.1):

- **EN LOCAL date language leak** — local handler vždy vracel česky i v EN konverzaci
- **Christmas template** — `formatChristmasResponse()` s i18n labels
- **CODE without project** — router guard pro CODE intent bez aktivního projektu
- **CRE drift into architect** — ANSWER intent se přepisoval na CODE/DESIGN v followup.js
- **local-i18n.js** — nový modul s `formatDate()`, `formatTime()`, `formatTodayResponse()` atd. pro cs/en/de/sk
- **QGv2 improvements** — response sanitization, SK→CZ transliteration hardening

---

## v74.0 — Specialist Platform (2026-02-22)

- **SpecialistLoader** — auto-discovery z `specialists/` adresáře, manifest validation, hot-reload
- **specialist-runtime.js** — rozšíření: `tryToolExecution()` s clarify status, pattern-based routing accuracy
- **tool-adapter.js** — universální adapter pro specialist tools
- **accountant-cz** — plně funkční specialist s 5 tools (tax, VAT, salary, deadline, compare)
- **DB migration 012 (v74)** — `specialists` + `specialist_migrations` tabulky

---

## v69.0-v74.0 — Ledger System (2026-02-20 – 2026-02-22)

- **Ledger core** — české daňové výpočty (DPFO, sociální, zdravotní pojištění)
- **VAT engine** — DPH kalkulátor s metadata (v72 migration)
- **Insurance module** — pojistné výpočty
- **Compliance** — validace proti českým předpisům (v73 migration)
- **Period locks** — uzamykání účetních období (v70 migration)
- **218 ledger testů** (core, VAT, annual, insurance, compliance, reports)

---

## v69.0 — Rename: expert → expertise (2026-02-22)

Sjednocení terminologie: "expert" → "expertise/expertyza". Expertyza = dovednostní profil/persona overlay na LLM odpovědi. Specialist = komplexní doménový agent s tools, knowledge base, rutinami. Přejmenování odstraňuje záměnu obou pojmů.

### Soubory a adresáře

- `src/experts/` → `src/expertises/` (celý adresář včetně tools/, guards/)
- `expert-layer.js` → `expertise-layer.js`, `expert-store.js` → `expertise-store.js`, `expert-enforcement.js` → `expertise-enforcement.js`, `expert-sandbox.js` → `expertise-sandbox.js`
- `src/chat/handlers/expert.js` → `expertise.js`, `src/routes/experts.js` → `expertises.js`
- `docs/EXPERTS.md` → `EXPERTISES.md`, `ExpertCardPro.tsx` → `ExpertiseCardPro.tsx`
- 3 testové soubory přejmenovány (`expert-system`, `expert-integration`, `expert-ab-quality`)

### Symboly (67 souborů, ~3200 řádků)

- Exportované symboly: `ExpertAgent→ExpertiseAgent`, `ExpertStore→ExpertiseStore`, `ExpertEnforcer→ExpertiseEnforcer`, `BUILTIN_EXPERTS→BUILTIN_EXPERTISES`, `expertRegistry→expertiseRegistry`, `routeToExpert→routeToExpertise`, atd.
- Enum klíče: `ChatMode.EXPERT→ChatMode.EXPERTISE` (string value `'expert'` zachována pro backward compat)
- SessionState: `#expert→#expertise`, `setExpert→setExpertise`, `hasActiveExpert→hasActiveExpertise`
- Config: `config.features.experts→config.features.expertises`
- API endpointy: `/api/experts→/api/expertises` (+ 307 redirect aliasy pro backward compat)

### DB migrace (soft — v69.0)

- Nové tabulky: `expertises`, `expertise_bindings`, `expertise_memory`, `custom_expertises`
- Nové sloupce: `capability_drift_log.expertise_id`, `llm_execution_log.expertise_id`
- Data zkopírována z `experts`, `conversation_experts`, `expert_memory`, `custom_experts`
- Staré tabulky ponechány jako fallback (drop v další major verzi)
- Migrace: `src/db/migrations/2026_02_20_008_v69_expert_to_expertise.js`

### Backward kompatibilita

- `ChatMode.EXPERTISE` value = `'expert'` (persisted sessions, JSON logs, executionTrace)
- `SessionState.fromJSON()`: `json.expertise ?? json.expert` fallback
- `C3_ENABLE_EXPERTS` env var: deprecated s log warning, funkční
- LLM prompt strings "Jsi expert na..." ponechány (přirozený jazyk)

### Frontend/IDE (13 souborů)

- chat-panel-module.js, center-views-module.js, sidebar-module.js, detail-panel-module.js
- wizard-helpers.js, wizard-basic.js, ConversationCardPro.tsx, ExpertiseCardPro.tsx
- architect.html/css/js, c3-visibility.css
- CSS třídy: `.c3-card-expert→.c3-card-expertise`, `.c3-expert-emo→.c3-expertise-emo`

### Testy (16 souborů)

- Všechny import paths `../src/experts/` → `../src/expertises/`
- Symboly aktualizovány: `ExpertStore→ExpertiseStore`, `ExpertEnforcer→ExpertiseEnforcer`, `BUILTIN_EXPERTS→BUILTIN_EXPERTISES`, `validateExpertConfig→validateExpertiseConfig`
- ws-bridge.test.js: `setExpert→setExpertise`, `restored.expert→restored.expertise`

---

## v65.8 — D1-D3 Specialist Platform: Runtime + Knowledge Base + Scenarios (2026-02-19)

**Testy:** 401 CRE + 43 GK + 52 pipeline + 81 accountant + 41 enforcement + 23 specialist + 35 knowledge + 42 scenario + 125 quality + 100 design = 943+ PASS

Phase D specialist platform: three new modules building the foundation for tool-augmented expert domains.

### D1: Specialist Runtime

- **ToolRegistry** — specialist → tools mapping with lazy module loading, module cache
- **IntentDetector** — pattern-based routing: user input → tool match (priority-sorted)
- **ToolExecutor** — deterministic tool execution, adapter support, knowledge base injection point
- **SpecialistRuntime** — orchestrator: `tryToolExecution(expertId, input)` → detect → execute → result
- **Accountant registered** — 5 tools (compare, VAT, salary, deadline, tax) with inline extractors
- **expert.js integration** — replaced hardcoded `executeAccountantTool()` with generic `executeSpecialistTool()`

### D2: Knowledge Base

- **DB migration 007** — 3 new tables: `knowledge_facts`, `knowledge_sources`, `knowledge_verification_log`
- **KnowledgeBase class** — `getFact()`, `getCategory()`, `getRatesForYear()`, `checkFreshness()`, `setFact()`, `bulkSetFacts()`
- **Verification sources** — `setSource()`, `listSources()`, `logVerification()`
- **seedTaxRates()** — imports 96 facts from static RATES constant (2024 + 2025)
- **Freshness check** — detects stale/provisional facts with configurable tolerance

### D3: Scenario Engine

- **ScenarioRegistry** — stores scenario definitions, trigger detection per specialist
- **ScenarioRunner** — state machine: INTRO → COLLECTING → COMPUTING → PRESENTING → RECOMMENDING → COMPLETED
- **Phase handlers** — data collection with extraction/validation/skip/default, adjustment loop, cancel
- **Accountant Tax Optimization** — 5-step guided workflow (income, entity, expenses, year, children)
- **Tool integration** — `compute()` calls `calculateTax()` + `compareTaxEntities()`, `present()` formats markdown

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/experts/specialist-runtime.js` | NEW — ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime |
| `src/experts/knowledge-base.js` | NEW — KnowledgeBase class, seedTaxRates, getKnowledgeBase singleton |
| `src/experts/scenario-engine.js` | NEW — ScenarioRegistry, ScenarioRunner, accountant tax optimization |
| `src/db/migrations/007_knowledge_base.js` | NEW — knowledge_facts, knowledge_sources, knowledge_verification_log |
| `src/chat/handlers/expert.js` | Replaced hardcoded accountant routing with SpecialistRuntime |
| `tests/specialist-runtime.test.js` | NEW — 23 tests (registry, intent, execution, custom) |
| `tests/knowledge-base.test.js` | NEW — 35 tests (CRUD, seed, freshness, sources, bulk) |
| `tests/scenario-engine.test.js` | NEW — 42 tests (registry, triggers, phases, E2E accountant) |
| `docs/ROADMAP.md` | v10: D1-D3 DONE, Specialists 40%→65%, progres 97% |

---

## v65.7 — F1-F3 Integration + A7 Expert A/B + C3 Lifecycle LLM Test (2026-02-19)

**Testy:** 401 CRE + 43 GK + 52 pipeline + 58 fixes + 100 design + 45 quality + 21 sprint-D = 720 PASS, 0 failures

Napojení tří Phase F modulů (dříve dead code) do server.js. Všechny 3 moduly nyní aktivní.

### F1: Setup Wizard Integration

- **First-run detection** — `SetupWizard.isComplete()` na startup, log pokud setup není dokončen
- **API routes** — `/api/setup/status`, `/api/setup/ollama`, `/api/setup/language`, `/api/setup/notifications`, `/api/setup/license`, `/api/setup/complete`
- **Route handler fix** — `createSetupRoutes(wizard, deps)` nyní přijímá `deps` s `sendJSON`/`parseBody` (oprava signature mismatch)
- **Health check** — `setupComplete` field v `GET /` response

### F2: Auto-updater Integration

- **Background checker** — `startUpdateChecker()` volán v `server.listen()` (jen pokud `C3_UPDATE_REPO` nastaveno)
- **Update notification** — log nové verze s release URL
- **Graceful shutdown** — `stopUpdateChecker()` v shutdown handleru
- **Dynamic version** — `getCurrentVersion()` z package.json místo hardcoded stringu

### F3: License System Integration

- **LicenseManager singleton** — inicializace na startup, tier + valid log
- **API endpoint** — `GET /api/license/status` — tier, features, expiry, owner
- **Feature gates** — FREE tier blokuje agent/worker/scheduler routes (403 s upgrade hint)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/server.js` | F1 import+init+routes, F2 import+startChecker+stopChecker, F3 import+init+gates+API |
| `src/setup/wizard.js` | `createSetupRoutes(wizard, deps)` — server.js compatible handlers |
| `docs/ROADMAP.md` | v9: F1-F3 + A7 + C3 DONE, Chat 100%, Projekty 100%, progres 96% |
| `docs/CHANGELOG.md` | v65.7 entry |
| `tests/expert-ab-quality.test.js` | A7: Expert A/B quality test — 5 domén, Ollama E2E |
| `tests/lifecycle-real-llm.test.js` | C3: Real LLM lifecycle E2E — 10/10 PASS |

### A7: Expert A/B Quality Test

- **5 domén** testovaných: writer, analyst, lawyer, developer, accountant
- **Expert vs General** — each prompt sent to Ollama twice (expert system prompt vs generic)
- **Scoring**: word count, domain keywords, Czech language, zombie/deflection, disclaimer presence
- **Výsledek**: Expert win/tie **5/5** domén — expert nikdy neškodí, pomáhá u lawyer (disclaimer)

### C3: Real LLM Lifecycle Test

- **E2E proti běžícímu serveru** s reálnými Ollama voláními
- **Testovaný flow**: project create → lifecycle start (SPEC) → provide requirements → state check → progress inquiry
- **Výsledek**: 10/10 PASS — celý pipeline funkční s qwen2.5:32b

---

## v65.6 — Lifecycle Session Routing Fix + Conversation Hardening (2026-02-19)

**Testy:** 789+ verified deterministic (23+58+52+43+45+94+125+92+103+83+71), 0 failures

Oprava kritického bugu: lifecycle SPEC fáze nebyla routována správně kvůli sessionId mismatch mezi IDE lifecycle/start (`session-0`) a WS chat zprávami (`ws-<random>`). Doplněna robustní conversation handler hardening (Tier 1/2/3 fixes).

### Lifecycle SessionId Mismatch Fix

- **RAM lookup by projectId** — `getLcStateByProject(projectId)` najde lifecycle stav v RAM pod jakýmkoli sessionId a migruje ho na aktuální WS session
- **Proper lifecycle ID generace** — lifecycle/start nyní generuje `lc-<timestamp>-<random>` místo NULL
- **`bindSessionToLifecycle()`** — voláno při startu, správná vazba session→lifecycle
- **DB fallback zachován** — když RAM nemá match, fallback na `project_lifecycles` tabulku

### Conversation Handler Hardening (Tier 1/2/3)

- **Tier 1:** 14 oprav v conversation.js — null safety, context propagation, error handling
- **Tier 2:** Lifecycle intercept robustnost — auto-detect přes RAM + DB dual path
- **Tier 3:** Edge case handling pro stale sessions a concurrent access

### Dokumentace

- **CLAUDE.md** — kompletní přepis: 73,706 lines / 188 files statistiky, API endpoint reference, contract #10
- **ARCHITECTURE.md** — aktualizace: 53 DB tables, routes/ directory, lifecycle C4 session routing, test counts
- **CHANGELOG.md** — v65.6 entry

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/chat/handlers/conversation.js` | RAM lookup by projectId + state migration (lines 288-314) |
| `src/routes/projects.js` | lifecycle/start: generovat lifecycle ID, uložit do RAM stavu (lines 301-321) |
| `CLAUDE.md` | Kompletní přepis na v65.6 |
| `docs/ARCHITECTURE.md` | Aktualizace na v65.6 |
| `docs/CHANGELOG.md` | v65.6 entry |

---

## v65.5 — Agent Builder Wizard (B9) (2026-02-15)

**Testy:** ~1300 passing (805 ověřeno, žádné regrese)

Agent Builder Wizard — kompletní UI pro tvorbu a editaci worker agentů v IDE. Backend single source of truth pro presety a validaci.

- **`GET /api/agents/schema`** — nový endpoint vracející typy (MONITOR/HUNTER/TRACKER/DIGEST/SCOUT), typeDescriptions, allowed values, limits, a **presety** z backendu (ne hardcoded v FE)
- **`normalizeAgentDefinition()`** — backend helper (~75 řádků): regeneruje unikátní ID (src→cond→trig), remapuje cross-reference (triggers→conditions→sources), validuje referenční integritu, clampuje cooldown/max_fires do limitů
- **Dry-run normalizace** — `POST /api/agents/dry-run` nyní volá `normalizeAgentDefinition()` před `agentRunner.dryRun()`
- **FE: `_agentWizard` state** — kompletní lifecycle: `_awOpen/Close/Save/DryRun/TestRun`, `_awApplyPreset(typeId)`
- **FE: `centerAgentWizard()`** — dual-mode UI:
  - **Simple mode** (3 kroky): Základ → Rozvrh & Zdroje → Podmínky & Akce
  - **Advanced mode** (5 collapsible sekcí): Basic, Schedule, Conditions/Triggers, Actions, Preview/Test
- **Auto dry-run před save** — `_awSave()` vždy volá dry-run; při `valid:false` zobrazí chyby a neuloží
- **ID collision handling** — backend vrací 409 na duplicitní ID; FE připojí timestamp suffix a opakuje
- **Integrace**: `_addNew('workers')` → wizard, Editovat handler pro workers → fetch + `_awOpen('edit',...)`

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/routes/agents.js` | +`GET /api/agents/schema`, normalize v dry-run (~90 řádků) |
| `src/agents/schema.js` | +`normalizeAgentDefinition()` (~75 řádků) |
| `c3-ide/.../chat-panel-module.js` | +agent wizard state, funkce, rendering (~350 řádků) |

---

## v65.4 — Project Context Injection (2026-02-15)

- **CRE hint `[[PROJECT_CONTEXT:...]]`** — projekt metadata injected do LLM pipeline
- **`buildProjectContext()`** — sanitized system prompt s project info
- **IDE→WS→BE→CRE→LLM pipeline** — `projectId` přenášen celým řetězcem

---

## v65.3 — Project Conversation Restore (2026-02-15)

- **Lifecycle bind** při otevření projektu — automatická vazba konverzace na projekt
- **Stale guard** — ochrana proti obnově zastaralých konverzací
- **Scroll position** — zachování pozice scrollu při restore
- **INSTALL.md** — kompletní instalační příručka (BE + IDE + Docker)

---

## v65.2 — QGv2 LinkGuard + Unconditional SK Strip (2026-02-15)

**E2E Quality Deep:** 34-36/36 (94-100%), stabilní

Deterministický post-processing pipeline (QGv2) s LinkGuard garanty a bezpodmínečným odstraněním slovenských artefaktů.

- **QGv2 (Quality Gate v2)** — 4-vrstvý deterministický pipeline: structural → language → intent → content
- **LinkGuard (Layer 3)** — SEARCH odpovědi musí mít ≥2 zdrojové linky; deterministická injekce z `sourceUrls`
- **Unconditional SK strip (Layer 2b)** — ľ→l, ô→ů, čo→co, nie je→není, preto→proto (vždy, bez threshold)
- **SK→CZ Transliterator (Layer 2a)** — rozšířen na ~160 regex pravidel + 6 agresivních suffix patterns
- **Language validation (Layer 2c)** — CZ povinná pro `lang=cs` odpovědi
- **E2E Quality Deep** — `tests/e2e-quality-deep.cjs`, 36 LLM testů ve 4 kategoriích (S/R/F/T)
- **CLAUDE.md** — kompletní přepis na v65.2 (QGv2, E2E status, known problems, Node 22+)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/chat/quality/quality-gate-v2.js` | QGv2 4-layer pipeline, LinkGuard, unconditional SK strip |
| `src/chat/handlers/utils/language-enforcement.js` | ~160 SK→CZ regex rules, 49 SK_MARKERS |
| `tests/e2e-quality-deep.cjs` | 36 LLM quality tests |
| `CLAUDE.md` | Kompletní update na v65.2 |

---

## v64.0 — CRE Gatekeeper + Single Authority Enforcement (2026-02-14)

**Testy:** 924 passing (43 novych gatekeeper + 26 schema-migrations)

CRE Gatekeeper — vsechna rozhodnuti mimo `CRE.decide()` nyni prochazi `overrideDecision()` (s audit trail) nebo `logIntercept()` (pro stavove pre-CRE trasy). Eliminace 25+ raw decision object bypassu.

- **`overrideDecision()`** — vytvari proper `CREDecision` s override metadaty (source, reason, originalDecision)
- **`logIntercept()`** — loguje pre-CRE intercepts (session resume, lifecycle, wizard) bez vytvareni rozhodnuti
- **`bindAuditDb()`** — volitelna DB persistence pro override/intercept audit trail
- **`getAuditStats()`** — real-time statistiky overrides a intercepts
- **Migration 005:** `cre_override_log` tabulka s 4 indexy (trace, conversation, source, type)
- **conversation.js:** 9 bypass bodu presmerovano (first_turn, reformulation, design_continue, date_correction, session_resume, progress_inquiry, build_handoff, lifecycle_handoff)
- **clarification.js:** 16 raw decision objektu presmerovano (max_attempts, local_request, source_url, drift_confirmed, atd.)
- **followup.js:** 10 raw decision objektu presmerovano (buildResolvedDecision, tryResolveClarification)
- **Fix:** FACTUAL+ANSWER invariant violation → CONVERSATIONAL+ANSWER (spravna kombinace)
- **Test:** `cre-gatekeeper.test.js` (43 testu — overrideDecision, invarianty, logIntercept, auditStats, DB persist, source coverage, migration, toJSON)
- **Test:** `schema-migrations.test.js` aktualizovano na 5 migraci

### Stabilizacni sprint — Schema Migration Versioning (v64.0 Day 1)

- **`src/db/migrate.js`** — Migration runner: `runMigrations(db)`, `getCurrentVersion(db)`, `listMigrations()`
- **5 migracnich souboru** v `src/db/migrations/` (timestamp-based ordering)
- **Test:** `schema-migrations.test.js` (26 testu — runner, idempotence, ordering, getCurrentVersion)

---

## v62.2d — E2E Quality Deep Final Fixes (2026-02-13)

**Skóre:** 34/36 (94% peak), ~33/36 (92% avg)

- CRE: `/hledám/i` přidáno do SEARCH_PATTERNS
- CRE: ITEM_LOOKUP pattern pro "hledám + typ nemovitosti/zboží" (bez čísla)
- Search sanitizer: odstraněn "kurz" z německých stop words (CZ "kurz" = směnný kurz)
- FACTUAL_NUMERIC: instrukce pro přibližné odhady z tréninkových dat
- SK→CZ: +20 nových párů (pre→pro, čo→co, aspoň→alespoň, uistite→ujistěte, ...)
- Test: opraveny isSlovak false positives (takže, každý → validní CZ)
- Test: rozšířeny validátory (počasí, motorky, developer koncepty, EUR/CZK)

## v62.2c — Language Enforcement Hardening (2026-02-13)

**Skóre:** 32/36 (89%), z 26/36 (72%)

- Hard language gate: mechanický SK→CZ překlad (50+ regex párů, 0ms)
- EN detekce: EN_THRESHOLD 3→2, diacritics ratio 0.6→0.4
- Language instrukce na PRVNÍ pozici v synthesis system promptu
- Source URL extraction: fallback na všechny toolResults
- ITEM_LOOKUP: přidán chybějící searchSubType='CLASSIFIED'
- Synthesis MAX_RETRIES 2→1 (úspora ~30s/request)
- Test timeout 90s→150s pro local LLM

## C3 Studio IDE — Modular Transport Layer (2026-02-14)

- **event-bus.js:** centralizovaný `C3Bus` (on/off/emit) — decoupling transport od UI
- **ws-client.js:** WS handshake s feature negotiation, exponential backoff reconnect, session routing via `conversationId`, rehydration, edit ACK
- **agent-client.js:** formátuje `AgentEventType` do čitelných log entries
- **terminal-client.js:** terminal handler s execution lock proti spamu

## C3 Studio IDE — Linked Sessions + Autocomplete (2026-02-13)

- **Shared session architektura:** chat + bottom panel propojené (1-3 sessions)
- **Bottom panel:** 4 modes (Split/Mix/Terminal/Log) per session
- **Chat panel:** nezávislé panes s vlastním feed, expert, attachments
- **Autocomplete:** Tab → `POST /api/autocomplete`, ghost text, accept
- **Edit mode toggle:** Auto/Ask posíláno s chat payloadem
- **Context meter:** polls `/api/context` + reaguje na WS `context_update`
- **Working tree:** collapse/expand, git status badges, toolbar
- **Center view:** session picker, "+ Nový" pro všechny sekce, list zoom
- **Dokumentace:** C3-STUDIO-IDE.md + C3-STUDIO-ROADMAP.md

## v63.3 — ExecutionTrace ID + LLM Step Logging (2026-02-14)

**Testy:** 217 passing / 8 suites

Execution observability — jeden UUID per user turn propojuje všechny audit vrstvy.

- **ExecutionTrace ID:** `randomUUID()` per user turn, propaguje se přes LLM → ENFORCER → CAPABILITY → MERGE
- **DB:** `execution_trace_id` column na `merge_audit_log`, `capability_drift_log`
- **DB:** `execution_step` column na `capability_drift_log`
- **DB:** nová tabulka `llm_execution_log` (model, temperature, prompt_hash, prompt_tokens, completion_tokens, latency_ms, token_source)
- **Prompt SHA-256 hash:** `crypto.createHash('sha256')` pro determinism analýzu — top-level DB column
- **Token source classification:** `'provider'` | `'estimated'` — rozlišuje skutečné vs odhadnuté token counts
- **`performance.now()`** pro sub-ms latency přesnost (místo `Date.now()`)
- **traceId v ResponseTag metadata** gated za `context.debug` flag (není v produkčním API)
- **Stress test:** 3-expert merge + strict + capability drift + retry + inheritance chain + trace reconstruction + prompt hash determinism

## v63.2 — Capability Enforcer Runtime + Strict Mode (2026-02-14)

**Testy:** 38 capability-enforcer tests

Post-response validation na bázi 5D capability profilu — deterministické, bez LLM, bez side effects.

- **Capability enforcer pipeline:** `evaluateDeterminism`, `evaluateRiskTolerance`, `evaluateVerbosity`, `evaluateStructure`, `computeCapabilityDrift`
- **Drift detection:** per-dimension delta, `DRIFT_VIOLATION_THRESHOLD=40`, `DRIFT_WARNING_THRESHOLD=25`
- **Wired into runtime:** `enforceCapabilities()` volaná po každém LLM response v expert handleru
- **Capability-driven modifiers:** `capability-mapping.js` — temperature bias, minResponseLength modifier, prompt instructions
- **ExpertEnforcer retry decay:** `retryTemperatureDecay=0.1`, `retryTopPDecay=0.05` per attempt
- **Strict enforcement mode:** `hardFail=true` — response suppressed po vyčerpání retries
- **Single-expert regenerateFn:** akceptuje `retryOptions` (temperatureDecay, topPDecay, attempt, seed)
- **Temperature floor 0.1** v obou pathech (single + merge)

## v63.1 — Expertise Wizard UI + Capability Sandbox (2026-02-13)

- **Wizard UI:** center-views s 5 moduly (wizard-basic, wizard-capabilities, wizard-modules, wizard-preview, wizard-helpers)
- **`GET /api/expertise-schema`** endpoint — anti-drift (žádné hardcoded konstanty ve frontendu)
- **`POST /api/merge-preview`** s inline config — live preview pro create mode
- **`POST /api/expertise-wizard/test-prompt`** — LLM test s rate limitem (1/5s)
- **Detail panel:** capability bars (5D), modules summary, tone + temperature
- **`validateExpertConfig()`** rozšířen o modules, capabilities, inheritance validaci
- **Capability sandbox:** `checkCapabilityNormalization()` — extreme profile warnings

## v63.0 — Merge Engine v2 (2026-02-13)

**Testy:** 111 passing / 4 suites (merge-engine 30, merge-compatibility 16, merge-enforcement-integration 15, expert-system 40 + expert-integration 10)

Kompletní multi-expertise prompt composition engine — čistá funkce, frozen výstupy, deterministické.

- **`mergeExpertisePrompt()`** — 15.5-kroková čistá funkce (validate → compatibility → sort → inherit → merge → trim → build → enforce → freeze)
- **`checkCompatibility()`** — 5D pairwise conflict detection (creativity↔determinism, risk gap, verbosity gap)
- **`resolveInheritance()`** — rekurzivní parent chain (max depth 4), per-module extend/replace
- **15 built-in expertů** s `modules` (6 sekcí) + `capabilities` (5D vector)
- **Token budget:** `estimateTokens()` (chars / 3.5), `EFFECTIVE_TOKEN_BUDGET=1800` (10% rezerva)
- **Enforcement merge:** forbiddenPhrases=UNION, minResponseLength=MAX, disclaimers=UNION (dedup)
- **DB:** `conversation_expertises` tabulka (N:M, max 3), `merge_audit_log`
- **`/api/merge-preview`** endpoint
- **ExpertStore:** `setExpertisesForConversation()`, `getExpertises()`, `clearExpertises()`

## v62.2 — IDE V4 + SEARCH Sub-types (2026-02-12)

- IDE: sidebar collapse, split bottom panel, live backend data, card actions
- SEARCH sub-type system: NEWS/SPEC/COMPARISON/FACTUAL_NUMERIC/PERSON/CLASSIFIED
- Syntax-only output gates (check structure, not semantics)

---

# C3 v56.2 — Sprint A + B + C1 + C2 + D + Hotfix (COMPLETE)
## All 13 Issues Fixed + 2 Runtime Bugs + Multilingual i18n

### Verze: 56.2.1
### Datum: 2026-02-07

---

## Souhrn

8 souborů, **13/13 fixů + 2 hotfixy**, 228 testů, 0 failures.

| Sprint | Soubory | Fixes | Testy |
|--------|---------|-------|-------|
| A | cre-decision.js | #3, #4, #5 | 52+18 |
| B | tool-executor.js, web-search.js, search-metrics.js | #1, #6, #7, #10 | 23+15 |
| C1 | controller.js, decisions.js | #2A/C, #12 | 29 |
| C2 | synthesis.js, decisions.js, tool-executor.js | #2B, #11, #9 | 13 |
| D | project.js | #8 | 17 |
| Hotfix | tool-executor.js, cre-decision.js | BUG1, BUG2 | 11 |
| i18n | all pattern files | SK,DE,PL,FR,ES | 76 |

---

## Sprint A — CRE Routing Fixes

**Soubor:** `src/chat/cre-decision.js` (+137 lines)

- **#3** KNOWLEDGE_PATTERNS: "Řekni mi o X" → SEARCH (was AMBIGUOUS)
- **#4** SELF_REFERENCE_PATTERNS: "Jak se jmenuju?" → CONVERSATIONAL (was SEARCH)
- **#5** STATEMENT_PATTERNS: "Moje jméno je X" → CONVERSATIONAL (was AMBIGUOUS)
- **#4b** Two-tier catch-all: "Proč?" → AMBIGUOUS (was SEARCH)
- Czech diacritics: `\b` → `(?:^|\s)..(?:\s|[?!.,;]|$)`

## Sprint B — Search Quality

**`src/executor/tool-executor.js`** (+116 lines)
- **#1** `sanitizeSearchQuery()` — strips instructions, dedupes, truncates
- **#6** Per-session circuit breaker: `toolType:sessionId`
- **#9** SandboxPath isolation: `clearProjectContext()` when no project *(moved from C2)*

**`src/llm/web-search.js`** (+27 lines)
- **#7** FAIL_COOLDOWN 5min→60s, SearX parallel `Promise.any()`, DDG-first

**`src/chat/handlers/utils/search-metrics.js`** (+4 lines)
- **#10** Snippet threshold 80→50, +17 Czech instructional STOP_WORDS

## Sprint C1 — Context Pipeline (Routing)

**`src/chat/controller.js`** (+62 lines)
- **#12** `#addToHistory` stores `{userInput, response}` pairs
- `#extractTurnTopic()` extracts topic, `lastTurnTopic` passed to handlers

**`src/chat/handlers/decisions.js`** (+153 lines)
- **#2A/C** `enrichSearchQuery()` — follow-up queries get topic prepended
- `hasOwnSubject()` — skip enrichment when input has proper noun
- All `toolExecutor.execute()` search calls use `effectiveQuery`

## Sprint C2 — Context Pipeline (Quality)

**`src/chat/handlers/utils/synthesis.js`** (+16 lines)
- **#11** `buildSynthesisPrompt` accepts `conversationContext` parameter
- `synthesizeWithLLM` passes context to prompt builder
- LLM sees last 3 turns (user+assistant) for pronoun resolution

**`src/chat/handlers/decisions.js`** (included in C1 count)
- **#11** `buildConversationContext()` transforms history for synthesis
- All 4 `synthesizeWithLLM()` calls pass `conversationContext`

**`src/executor/tool-executor.js`** (included in B count)
- **#9** `clearProjectContext()` when no project in context

---

## Instalace

Nahradit 8 souborů v `~/Projects/c3-agent-wip/`:
```
src/chat/cre-decision.js                      # Sprint A
src/chat/controller.js                         # Sprint C1
src/chat/handlers/decisions.js                 # Sprint C1+C2
src/chat/handlers/project.js                   # Sprint D
src/chat/handlers/utils/synthesis.js           # Sprint C2
src/chat/handlers/utils/search-metrics.js      # Sprint B
src/executor/tool-executor.js                  # Sprint B+C2
src/llm/web-search.js                          # Sprint B
```

Spustit: `node src/test/chat-integration.js`

---

## Sprint D — Project Mode (#8)

**Soubor:** `src/chat/handlers/project.js` (+130 lines)

- **#8** `PROJECT_SELF_PATTERNS` — detects "Jaký je stav projektu?" etc.
- `isProjectSelfQuery()` — checked BEFORE CRE routing
- `buildProjectStatusResponse()` — assembles response from working memory
- No web search, no LLM call — pure data assembly
- "Najdi článek o X" v project mode → NOT intercepted → CRE → web search ✓

---

## Hotfix — Runtime Bugs from Integration Tests

**BUG 1 (critical):** `sanitizeSearchQuery` result was overridden by `...context` spread.
- `handler({ query: effectiveQuery, ...context })` → `context.query` overwrites sanitized query
- **Fix:** `handler({ ...context, query: effectiveQuery })` — sanitized MUST be LAST
- Also: double-pass instruction removal for consecutive words

**BUG 2 (pre-existing):** "Jaká je populace Prahy?" → ASK_USER instead of SEARCH.
- `\b` doesn't work with Czech inflected forms (`jaká` ≠ `jak` + boundary)
- **Fix:** Added `jak[áéý] je/jsou` to Tier 1 with `(?:^|\s)` boundaries

---

## i18n — Multilingual Pattern Expansion (CZ + SK + DE + PL + FR + ES + EN)

**Root cause:** All patterns used CZ+EN only. JS `\b` fails with Unicode chars (č, ľ, ó, ñ, é, ł).

**8 pattern areas expanded:**
1. **Tier 1 compound** — "Čo je?" (SK), "Was ist?" (DE), "Co to jest?" (PL), "Qu'est-ce que?" (FR), "Qué es?" (ES)
2. **Tier 2 question words** — jak/čo/was/co/que/qué/how + inflections
3. **SELF_REFERENCE_PATTERNS** — "Ako sa volám?" (SK), "Wie heiße ich?" (DE), etc.
4. **STATEMENT_PATTERNS** — "Volám sa Bob" (SK), "Ich heiße Alice" (DE), etc.
5. **KNOWLEDGE_PATTERNS** — "Povedz mi o..." (SK), "Erzähl mir von..." (DE), etc.
6. **FOLLOW_UP_INDICATORS** — "A čo?" (SK), "Und was?" (DE), "Et que?" (FR), etc.
7. **sanitizeSearchQuery INSTRUCTION_WORDS** — "antworte/kurz/bitte" (DE), "proszę" (PL), etc.
8. **STOP_WORDS in search-metrics** — full multilingual stop word set

**Critical fix:** All non-ASCII patterns use `(?:^|\s)...\s` instead of `\b`.

---

## Kompletní test suite

```
tests/test-sprint-a.js       52 pattern + 18 ordering = 70 testů
tests/test-sprint-b.js       23 testů (sanitize, breaker, metrics)
tests/test-sprint-c1.js      29 testů (enrich, topic, integration)
tests/test-sprint-c2.js      13 testů (context, prompt, sandbox)
tests/test-sprint-d.js       17 testů (intercept, response)
tests/test-multilingual.js   76 testů (CZ,SK,DE,PL,FR,ES,EN × 6 areas)
                              ─────────
                              228 testů, 0 failures
```

---

## Celkový dopad na pipeline

### PŘED v56.2:
```
User: "Řekni mi o Pythagorovi"     → AMBIGUOUS → first-turn override → no search
User: "A co jeho teorém?"           → SEARCH "A co jeho teorém?" → irrelevant results
User: "Jak se jmenuju?"             → SEARCH → web search for name
User: "Kdo byl Pythagoras? Stručně" → DDG receives "Kdo byl Pythagoras? Odpověz stručně."
Long input → circuit breaker OPEN → ALL sessions blocked 60s
SearX cascade → 5min cooldown → only DDG
```

### PO v56.2:
```
User: "Řekni mi o Pythagorovi"     → SEARCH (KNOWLEDGE_PATTERNS) → web search
User: "A co jeho teorém?"           → SEARCH "Pythagorovi co teorém?" → relevant results
      → synthesis LLM sees: "Previous: User asked about Pythagoras"
User: "Jak se jmenuju?"             → CONVERSATIONAL (SELF_REFERENCE) → no search
User: "Kdo byl Pythagoras? Stručně" → DDG receives "Kdo byl Pythagoras?"
Long input → circuit breaker OPEN → ONLY that session blocked 30s
SearX cascade → 60s cooldown + parallel → faster recovery
```
