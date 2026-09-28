# C3 Agent — Pre-Release Audit Report (v123)

**Date:** 2026-03-12
**Scope:** Full codebase analysis — CRE, lifecycle, error handling, model upgrade, code-intel, FE/BE integration
**Method:** 6 parallel deep-dive agents

---

## Executive Summary

The C3 system is **production-ready for normal use cases** but has **~50 issues** across 6 subsystems. The most impactful cluster is in the **lifecycle pipeline** (deadlock risk, context drift, session loss) and **CRE guard interactions** (ordering conflicts, pattern gaps). The model upgrade pipeline has concurrency bugs. Error handling is solid at the framework level but has gaps in specific subsystems.

### Severity Distribution
| Severity | Count | Category |
|----------|-------|----------|
| CRITICAL | 6 | Lifecycle deadlock, context drift, guard ordering, SPEC loop |
| HIGH | 14 | Concurrency races, session loss, data loss, pattern gaps |
| MEDIUM | 18 | Missing timeouts, HTML fragility, memory leaks, edge cases |
| LOW | 8 | Documentation, assertions, code smell |

---

## P0 — CRITICAL (Fix Before Packaging)

### 1. Lifecycle: Milestone BLOCKED → No Timeout Recovery
**File:** `src/planner/lifecycle-build.js:1136`
**Impact:** Lifecycle stuck indefinitely if user doesn't respond to BLOCKED milestone

When ALL checkpoint retries fail, the system waits for user input (retry/skip/modify). No timeout. If user closes IDE mid-decision → zombie BLOCKED state forever.

**Fix:** 15-minute idle timeout on BLOCKED milestones → auto-escalate to force-skip.

---

### 2. Lifecycle: Context Drift Between SPEC and BUILD (>8 Milestones)
**File:** `src/planner/lifecycle-build.js:1369` + `lifecycle-planning.js:120`
**Impact:** Late milestones get code context that contradicts original SPEC → checkpoint failures

SPEC is frozen in DB. By milestone 8+, `buildCodeContextForMilestone()` sees evolved code that ms-1 didn't anticipate. D1 generates plans conflicting with earlier goals.

**Fix:** Periodic spec re-validation (every 4 milestones). Emit drift warnings if >3 architecture assumptions violated.

---

### 3. CRE: GUARD 6 vs GUARD 11 Ordering Conflict
**File:** `src/chat/cre-decision.js:3073, 3621`
**Impact:** In creative expertise + active project: BUILD escalation fires when it shouldn't

GUARD 6 (creativeLock → override SEARCH to CREATIVE) and GUARD 11 (project+DESIGN → BUILD) don't account for each other. "chci vytvořit app" in creative+project context → BUILD (wrong — should stay DESIGN/CREATIVE).

**Fix:** Add `!context.expertise?.creativeLock` check to GUARD 11.

---

### 4. CRE: DESIGN_BUILD_ESCALATION `.{0,20}` Too Narrow
**File:** `src/chat/cre-decision.js:1148`
**Impact:** "chci vytvořit nativní mobilní aplikaci pro Android a iOS" (26 chars between verb and keyword) → GUARD 11 doesn't fire

The `.{0,20}` gap between verb and app type is too restrictive for real Czech sentence structures.

**Fix:** Expand to `.{0,40}`.

---

### 5. CRE: GUARD 5 Missing DESIGN Exclusion Check
**File:** `src/chat/cre-decision.js:2399`
**Impact:** "navrhni jídelníček" (non-architecture DESIGN) bypasses exclusion check in GUARD 5

GUARD 5 validates LLM's DESIGN classification against DESIGN_PATTERNS but does NOT check DESIGN_EXCLUSION_PATTERNS. Creative "navrhni" requests incorrectly stay DESIGN.

**Fix:** Add `&& !DESIGN_EXCLUSION_PATTERNS.some(...)` to GUARD 5 check.

---

### 6. Lifecycle: SPEC Revision Loop Unguarded
**File:** `src/chat/handlers/lifecycle-router.js:382`
**Impact:** User can loop SPEC → SPEC_REVIEW → SPEC indefinitely

No limit on spec revisions. User can keep revising forever without advancing to BUILD.

**Fix:** Track revision_count. After 3 revisions → enforce approval or escalate.

---

## P1 — HIGH (Fix Within Sprint)

### 7. Lifecycle: DB Write-Through Silent Failure
**File:** `src/chat/handlers/lifecycle-state.js:75-88`
**Impact:** RAM and DB state diverge after DB write failure → restart shows wrong phase

`setLcState()` writes RAM first (always succeeds), then DB with try-catch (may silently fail). On restart, DB state is stale.

**Fix:** Write DB first, only update RAM on success. Return error to user on DB failure.

### 8. Lifecycle: No Mutex on Concurrent Milestone Execution
**File:** `src/planner/lifecycle-build.js:266`
**Impact:** Double-click or dual-tab → same milestone executed twice

No lock preventing two concurrent calls to `startNextMilestone()` for same lifecycle.

**Fix:** Add `_buildInProgress` flag with try-finally guard.

### 9. Lifecycle: IDE Disconnect → Session Lost
**File:** `src/chat/handlers/lifecycle-state.js:38`
**Impact:** Browser crash → new session → "No active lifecycle"

Session is bound by sessionId in RAM. Browser crash = new sessionId = lost lifecycle. `getLcStateByProject()` exists but isn't used in reconnection path.

**Fix:** Fallback to project-based lookup: `getLcState(sessionId) || getLcStateByProject(projectId)`.

### 10. Lifecycle: Ollama Crash Mid-Build → Partial Code Left
**File:** `src/planner/lifecycle-build.js:476`
**Impact:** Partial files from CODE executor left in project on Ollama crash

No git rollback when Ollama fails mid-execution. Next build is confused by stale partial code.

**Fix:** Git checkout of scope_files in catch block.

### 11. Model Upgrade: Metrics Flush Discards Buffer on Error
**File:** `src/upgrade/metrics-collector.js:75-109`
**Impact:** Lost performance metrics on DB lock

`splice(0)` removes batch BEFORE `tx()` executes. If tx throws → batch is already gone.

**Fix:** Copy with `[...this._buffer]`, splice only after successful tx.

### 12. Model Upgrade: Proposal Store Race Condition
**File:** `src/upgrade/proposal-store.js:50-70`
**Impact:** Duplicate proposals under concurrency

Check-then-insert without transaction. Two concurrent cycles can insert same proposal.

**Fix:** Wrap dedup + insert in single `db.transaction()`.

### 13. Model Upgrade: Rollback Failure → Unverified Model Active
**File:** `src/upgrade/upgrade-manager.js:490-530`
**Impact:** DB DELETE is unconditional; if verify fails + force=true → unverified model stays

**Fix:** Only delete DB row after successful verification.

### 14. Model Upgrade: Score Boundaries Non-Deterministic
**File:** `src/upgrade/model-ranker.js:176-221`
**Impact:** Model with 10 samples may score lower than 9 samples (step function at blend boundary)

**Fix:** Linear interpolation for blend weights between 10-50 samples instead of step function.

### 15. WS Bridge: Stale Session → Permanent "Agent Busy"
**File:** `src/ws-bridge/session-adapter.js:62`
**Impact:** Network drop during LLM call → stale activeTurns entry → blocks all future messages

**Fix:** 5-minute stale turn cleanup interval.

### 16. LLM Gateway: No Ollama OOM Detection
**File:** `src/llm/gateway.js:439`
**Impact:** HTTP 503 from Ollama OOM retried 3× (wasting time, model still OOM)

**Fix:** Don't retry on HTTP 503. Escalate immediately with "Ollama OOM" error.

### 17. CRE: _testCREInternals Leaks Mutable State
**File:** `src/chat/cre-decision.js:183`
**Impact:** Test code can mutate live DESIGN_BUILD_ESCALATION array

**Fix:** Return `Object.freeze()` copies from getters.

### 18. KG: addEdge with Non-Existent Nodes → Orphaned Edges
**File:** `src/code-intel/knowledge-graph.js:96`
**Impact:** Graph queries return null nodes; BFS can visit phantom edges

**Fix:** Validate `this._nodes.has(from) && this._nodes.has(to)` before insert.

### 19. KG: clear() Timing in _doBuild → _projectPath = null
**File:** `src/code-intel/knowledge-graph.js:419`
**Impact:** _projectPath is null between clear() and re-assignment; concurrent queries fail

**Fix:** Set `_projectPath` AFTER `clear()` but BEFORE async file collection.

### 20. Database: Missing BUSY Timeout
**File:** `src/db/database.js:120`
**Impact:** "database is locked" crashes under high concurrency (parallel turns)

**Fix:** Add `db.pragma('busy_timeout = 5000')`.

---

## P2 — MEDIUM (Next Release)

| # | Issue | File | Fix |
|---|-------|------|-----|
| 21 | Checkpoint retry exhaustion → vague error to user | lifecycle-build.js:553 | Store detailed loop report in DB, show to user |
| 22 | Lazy-loaded modules never cleanup → memory leak | lifecycle-build.js:42-73 | Add cleanup() methods, call on shutdown |
| 23 | Orphaned handoff state >24h not pruned | lifecycle-state.js:166 | Add periodic stale cleanup (every 6h) |
| 24 | No timeout on milestone executor | lifecycle-build.js:434 | Promise.race with 5-min timeout |
| 25 | Cascade milestone skip not in transaction | lifecycle-build.js:1227 | Wrap in DB transaction |
| 26 | Online discovery HTML parsing fragility | online-discovery.js:40-73 | Add parsing guards, cap at 30 tags |
| 27 | Benchmark estimator interpolation edge cases | benchmark-estimator.js:52-67 | Guard log(0) and extreme extrapolation |
| 28 | Validation suites: timeout produces no flag | validation-suites.js:670 | Add `timedOut: true` flag to result |
| 29 | Expired proposals never cleaned up | proposal-store.js:170 | Call expireStale(7) in upgrade cycle |
| 30 | Ollama unreachable → no backoff cache | model-discovery.js:36-65 | 30s unreachable cache after ECONNREFUSED |
| 31 | Missing diacritics in EXPLICIT_SEARCH (GUARD 6) | cre-decision.js:3085 | Add no-diacritic variants |
| 32 | CONDITIONAL_BUILD regex backtracking risk | cre-decision.js:1184 | Pre-test input format before regex |
| 33 | normalizeForClassification `\b` with Unicode | cre-decision.js:1282 | Replace `\b` with `(?:^|\s)` |
| 34 | WS edit pending timer leak | session-adapter.js:200 | clearTimeout in resolve/reject wrapper |
| 35 | WS output backpressure missing | session-adapter.js:74 | Check bufferedAmount before send |
| 36 | Marketplace download: no temp file | marketplace-client.js:217 | Write to .tmp, rename on success |
| 37 | API contract false positives on type hints | api-contract-registry.js:192 | Compare only param names, not annotations |
| 38 | Prompt builder silently drops high-priority sections | prompt-builder.js:204 | Log warning when priority>=70 section dropped |

---

## P3 — LOW (Polish)

| # | Issue | File |
|---|-------|------|
| 39 | unhandledRejection doesn't exit on critical errors | server.js:1157 |
| 40 | database.js auto-repair exits without cleanup | database.js:45 |
| 41 | Preference tracker confidence too aggressive | preference-tracker.js:119 |
| 42 | Checkpoint mode escalation rule missing | lifecycle.js:54 |
| 43 | No spec revision audit trail | lifecycle-router.js:381 |
| 44 | RESPONSE_INTENT collision possible | cre-decision.js:248 |
| 45 | _diag state mutation visibility | cre-decision.js:2963 |
| 46 | Missing IntentType validation after guards | cre-decision.js:3350 |
| 47 | Migration files have no down() rollback | migrations/* |
| 48 | import-map.js uses private _nodes API | import-map.js:175 |

---

## Quick Win Matrix

These fixes are < 30 minutes each and high-impact:

| Fix | Effort | Impact | Files |
|-----|--------|--------|-------|
| `db.pragma('busy_timeout = 5000')` | 1 line | Prevents DB lock crashes | database.js |
| GUARD 11 creativeLock check | 1 line | Prevents wrong BUILD escalation | cre-decision.js |
| `.{0,20}` → `.{0,40}` in GUARD 11 | 1 line | Fixes Czech sentence patterns | cre-decision.js |
| Metrics flush: copy before splice | 1 line | Prevents metrics loss | metrics-collector.js |
| activeTurns stale cleanup interval | 5 lines | Prevents permanent "busy" block | session-adapter.js |
| addEdge node validation | 3 lines | Prevents orphaned graph edges | knowledge-graph.js |
| Proposal store transaction wrapper | ~10 lines | Prevents duplicate proposals | proposal-store.js |

---

## Architecture Notes for Packaging

1. **Context drift (issue #2)** is the hardest to fix architecturally — requires incremental spec refresh, which means D1 re-evaluation mid-lifecycle. This is a significant design decision.

2. **Session recovery (issue #9)** is the most user-visible issue — any browser crash = lost lifecycle. The fix is straightforward but needs testing with multi-session scenarios.

3. **All guard interactions (issues #3, #4, #5)** should be addressed together with a guard interaction test suite that validates all 11 guards don't conflict.

4. **Model upgrade concurrency (issues #11, #12, #13)** clusters around missing transactions. Consider a unified "upgrade session" lock.
