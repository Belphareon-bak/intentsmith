# v135: System Governor — Implementation Plan (Level 1)

> **Type:** Implementation plan for Level 1 (analyze + propose only)
> **Context:** `docs/archive/C3-ROADMAP-RFC.md` is historical design RFC; this is the actionable implementation spec
> **Status:** IMPLEMENTED — matches this specification (verified 2026-08-02)
> **Date:** 2026-03-27 (planned) / 2026-08-02 (status corrected)
>
> Verification: file structure and sizes track the estimates below
> (`health-analyzer.js` 316 / ~400, `improvement-planner.js` 324 / ~300,
> `safety-guard.js` 73 / ~130, `system-governor.js` 301 / ~350). The Level 1
> boundary holds in code: there is no APPLY path, no `exec`, no `spawn` and no
> file write; the pipeline writes only to `governor_reports` and
> `governor_proposals` and touches no other table. It never runs itself —
> `server.js` supplies a database handle and a broadcast function, and a run
> starts only from `POST /api/system/governor/check`.
> Recorded in `docs/inventory/01-server-routing-db.md` §5b as `N-4`.

---

## Overview

Autonomous system health monitor inside C3 — reads existing telemetry tables via SQL aggregations, identifies weaknesses with root causes, proposes prioritized improvements with structured action payloads.

**Pipeline**: GENERATE → VALIDATE → APPROVE (Level 1: no APPLY)
**Autonomy**: Level 1 — analyze + propose only. `approved` = acknowledged by user, no automatic executor in Phase 1. Approved proposals are candidates for future automation (Level 2+).
**Standalone**: System runs without it, can add/remove anytime. Zero impact on existing functionality.

---

## Architecture

```
src/system/governor/
  health-analyzer.js     — 6-dimension aggregator with SQL aggregations + trend (~400 LOC)
  improvement-planner.js — 8-rule engine + root cause + confidence + priority (~300 LOC)
  safety-guard.js        — Structural validation + dedup + cooldown (~130 LOC)
  system-governor.js     — Pipeline orchestrator (~350 LOC)
```

Pipeline flow:
```
runCheck()
  → rate limit check (30s)
  → idempotency check (delta < 0.02 → skip)
  → healthAnalyzer.analyze()          [SQL aggregations from raw tables + trend]
  → improvementPlanner.evaluate()     [8 rules + root cause + confidence]
  → safetyGuard.filterSafe()          [dedup + cooldown + validation]
  → persist to governor_reports (snapshot) + governor_proposals (live state)
  → WS broadcast on control channel: action: 'governor_report'
  → return report
```

---

## Key Design Decisions

### D1: Metrics are COMPUTED from raw events, not read directly

No tables store pre-computed "success_rate" or "CRE accuracy". The health analyzer runs SQL `COUNT`/`AVG`/`SUM` aggregations against raw event tables and gracefully degrades when tables are empty or missing.

### D2: WS uses existing `control` channel protocol

All server→client broadcasts go through `broadcast('control', { action: '...', ... })`. The governor follows this convention: `action: 'governor_report'`. Frontend handles it via `C3Bus.on('governor:report', ...)` after ws-client.js dispatch.

### D3: Dual persistence — snapshot + live state

- `governor_reports.proposals_json` = **immutable snapshot** of proposals at generation time. Never mutated after INSERT. Used for historical comparison and trend analysis.
- `governor_proposals` = **live mutable state**. `approve`/`dismiss` mutate this table only.

### D4: Approval semantics in Phase 1

`approveProposal(id)` sets `status = 'approved'` + `resolved_at`. This means: **user acknowledges the issue and agrees it should be addressed.** There is no automatic executor — the user acts on it manually (run validation suite, switch model, review architecture, etc.). The `action_payload` field provides structured hints for future Level 2 automation.

---

## Files to Create

### 1. `src/db/migrations/2026_03_27_040_v135_governor.js`

Two tables:

```sql
CREATE TABLE IF NOT EXISTS governor_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  overall_health TEXT NOT NULL,        -- HEALTHY | DEGRADED | CRITICAL
  overall_score REAL NOT NULL,
  dimensions TEXT NOT NULL,            -- JSON: per-dimension scores, trends, data
  proposals_json TEXT NOT NULL,        -- IMMUTABLE snapshot of proposals at generation
  summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_gov_reports_created ON governor_reports(created_at);

CREATE TABLE IF NOT EXISTS governor_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES governor_reports(id),
  rule_id TEXT NOT NULL,
  type TEXT NOT NULL,                  -- MODEL_SWITCH | DRIFT_SCAN | QUALITY_REVIEW | ...
  severity TEXT NOT NULL,              -- LOW | MEDIUM | HIGH
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggested_action TEXT,
  action_payload TEXT,                 -- JSON: structured hint for Level 2
  confidence REAL NOT NULL,
  priority REAL NOT NULL,
  root_cause TEXT,
  hash TEXT NOT NULL,                  -- sha1(rule_id + type + keyDetails) for dedup
  cooldown_until DATETIME,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | dismissed
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_gov_proposals_status ON governor_proposals(status);
CREATE INDEX idx_gov_proposals_hash ON governor_proposals(hash, status);
CREATE INDEX idx_gov_proposals_rule ON governor_proposals(rule_id, status);
```

### 2. `src/system/governor/health-analyzer.js`

6 dimensions, all computed from raw tables via SQL aggregations. Each dimension wrapped in try/catch — returns `{ score: 0.5, dataCompleteness: 0, error: msg }` on failure.

| Dimension | Source Tables | SQL Aggregation | Score Formula | Weight |
|-----------|-------------|-----------------|---------------|--------|
| **models** | `model_performance` | `SELECT role, AVG(success) as sr, COUNT(*) as n FROM model_performance WHERE created_at >= datetime('now','-30 days') GROUP BY role` | `AVG(sr)` across roles; `dataCompleteness = min(1, total_n / 50)` | 0.25 |
| **cre** | `telemetry_snapshots`, `cre_override_log` | `SELECT COUNT(*) as total, SUM(CASE WHEN execution_status='success' AND partial_failure=0 THEN 1 ELSE 0 END) as ok FROM telemetry_snapshots WHERE created_at >= datetime('now','-7 days')` + `SELECT COUNT(*) FROM cre_override_log WHERE created_at >= datetime('now','-7 days')` | `success_pct = ok/total`; `override_rate = overrides/total`; `score = success_pct * 0.7 + (1 - override_rate) * 0.3`; `dataCompleteness = min(1, total / 100)` | 0.15 |
| **architecture** | `architecture_state` | `SELECT drift_score, layer_violations, circular_deps FROM architecture_state ORDER BY created_at DESC LIMIT 1` | `score = 1 - drift_score`; fallback 0.5 if no rows; `dataCompleteness = rows > 0 ? 1.0 : 0.0` | 0.15 |
| **builds** | `quality_scores`, `model_performance` | `SELECT AVG(score) as avg_q FROM quality_scores WHERE created_at >= datetime('now','-30 days')` + `SELECT AVG(success) as cp_rate FROM model_performance WHERE task_type = 'checkpoint' AND created_at >= datetime('now','-30 days')` | `score = avg_q * 0.6 + cp_rate * 0.4`; fallback 0.5 if either empty; `dataCompleteness = min(1, q_count / 20)` | 0.25 |
| **specialists** | `specialist_telemetry` | `SELECT event_type, COUNT(*) as n FROM specialist_telemetry WHERE created_at >= datetime('now','-7 days') GROUP BY event_type` | Count events where `event_type` contains 'success' or 'complete' vs total; `score = success_events / total_events`; `dataCompleteness = min(1, total / 30)` | 0.10 |
| **upgrades** | `upgrade_proposals`, `validation_suite_scores`, `discovered_models` | `SELECT COUNT(*) FROM upgrade_proposals WHERE status = 'pending'` + `SELECT MIN(validated_at) FROM validation_suite_scores` + `SELECT COUNT(*) FROM discovered_models` | `pending_penalty = min(pending * 0.1, 0.3)`; `stale_penalty = any model not validated > 14d ? 0.2 : 0`; `score = 1.0 - pending_penalty - stale_penalty`; `dataCompleteness = 1.0` (always computable) | 0.10 |

**Table existence guard**: Before each dimension query, run `SELECT name FROM sqlite_master WHERE type='table' AND name=?`. If table doesn't exist, return `{ score: 0.5, dataCompleteness: 0.0, status: 'UNKNOWN', note: 'table not found' }`.

**Trend analysis** (prevents snapshot bias):
- Load last 10 reports from `governor_reports`
- Per-dimension: `trend = currentScore - avg(historicalScores)`
- `finalScore = currentScore * 0.7 + trendScore * 0.3`
- `trendScore = 0.5 + clamp(trend / 0.4, -0.5, 0.5)`
- `trendDirection`: improving (>0.05), declining (<-0.05), stable

**Status classification**: ≥0.7 HEALTHY, ≥0.4 DEGRADED, <0.4 CRITICAL

### 3. `src/system/governor/improvement-planner.js`

8 deterministic rules (no LLM). Each rule receives the health analysis result and fires if its condition is met.

| # | Rule ID | Condition (from health analysis) | Type | Severity |
|---|---------|----------------------------------|------|----------|
| R1 | `model-low-success` | Any role's `AVG(success)` < 0.75 | MODEL_SWITCH | HIGH |
| R2 | `arch-drift-high` | `drift_score > 0.3` (from latest architecture_state row) | DRIFT_SCAN | MEDIUM |
| R3 | `build-quality-low` | `AVG(quality_scores.score)` < 0.85 in 30d | QUALITY_REVIEW | MEDIUM |
| R4 | `cre-accuracy-low` | CRE computed score < 0.80 | PATTERN_REVIEW | MEDIUM |
| R5 | `pending-proposals-stale` | `COUNT(upgrade_proposals WHERE status='pending')` > 3 | PROPOSAL_REVIEW | LOW |
| R6 | `model-unvalidated` | Any active model without validation_suite_scores row in 14d | MODEL_VALIDATION | LOW |
| R7 | `specialist-failing` | Specialist computed score < 0.70 | SPECIALIST_CHECK | MEDIUM |
| R8 | `model-drift` | Performance decline: `AVG(success)` of last 20 samples < `AVG(success)` of previous 20 by >0.15 | MODEL_SWITCH | HIGH |

**Confidence** (computed, NOT hardcoded):
```
confidence = severityWeight × 0.5 + dataCompleteness × 0.3 + trendStrength × 0.2
  severityWeight: HIGH=0.9, MEDIUM=0.6, LOW=0.3
  dataCompleteness: from health dimension that triggered the rule
  trendStrength: abs(trend) / 0.4, clamped 0-1
```

**Priority** (for UI sorting):
```
priority = severityWeight × 0.6 + confidence × 0.3 + recencyBoost × 0.1
  severityWeight: HIGH=1.0, MEDIUM=0.6, LOW=0.3
  recencyBoost: 1.0 if first time (no previous proposal with same hash), 0.5 if repeat
```

**Root cause heuristics** (per rule, no LLM):
- R1: `AVG(iterations)` > 5 → "model struggles with complexity" / `AVG(errors_remaining)` > 2 → "persistent codegen failures"
- R2: `layer_violations` > `circular_deps` → "boundary crossing" / else → "circular dependency growth"
- R3: `AVG(quality_scores.score)` < checkpoint pass rate → "checkpoint too strict" / else → "codegen quality regression"
- R4: `override_rate` > 0.3 → "pattern mismatch (override_rate=X%)" / `AVG(total_turn_time_ms)` > 5000 → "model overload"
- R5: "User review backlog — N pending proposals"
- R6: "Models M1, M2 not tested in N days — quality unknown"
- R7: "Specialist S has X% failure rate — tool matching/execution issue"
- R8: "Performance decline in last 20 samples (was X%, now Y%)"

**Structured action payload** (Level 2 ready, informational in Level 1):
```json
{
  "type": "validate | scan | review | switch",
  "target": "role:D1",
  "hint": "run validation suite for reasoning role",
  "apiEndpoint": "/api/system/models/validate",
  "params": { "model": "qwen3.5:27b", "suite": "reasoning" }
}
```

### 4. `src/system/governor/safety-guard.js`

**Structural validation**:
- Required fields: `type`, `severity`, `title`, `description`
- Valid severity enum: `LOW`, `MEDIUM`, `HIGH`
- Confidence ≥ 0.3 (reject noise)
- Valid proposal type enum: `MODEL_SWITCH`, `DRIFT_SCAN`, `QUALITY_REVIEW`, `PATTERN_REVIEW`, `PROPOSAL_REVIEW`, `MODEL_VALIDATION`, `SPECIALIST_CHECK`

**Dedup by hash**:
- `hash = sha1(rule_id + type + JSON.stringify(keyDetails))`
- If active proposal with same hash exists (status = 'pending') → BLOCKED

**Cooldown** (severity-based, after dismiss):
- HIGH: 3h, MEDIUM: 12h, LOW: 24h
- Check: `WHERE hash = ? AND status = 'dismissed' AND cooldown_until > datetime('now')`

### 5. `src/system/governor/system-governor.js`

**Singleton `systemGovernor`** with methods:
- `setDb(db)` — init prepared statements, load last report
- `runCheck()` — full pipeline (rate limited, idempotent)
- `getStatus()` → `{ enabled, lastCheckTime, overallHealth, overallScore, proposalCount }`
- `getLatestReport()` → full report with parsed JSON dimensions
- `getProposals(status?)` → proposals sorted by priority DESC
- `approveProposal(id)` → set `status = 'approved'`, `resolved_at = now`. **No executor** — user acts manually.
- `dismissProposal(id)` → set `status = 'dismissed'`, `resolved_at = now`, `cooldown_until` per severity

**Rate limit**: 30s min between checks, return 429 error

**Idempotent check**:
- Skip if: score delta < 0.02 AND no new rules fire AND last check < 60s
- Return last cached report instead

**WS broadcast** (via existing `control` channel):
```javascript
// In system-governor.js after persist:
broadcast('control', {
  action: 'governor_report',
  overallHealth: report.overallHealth,
  overallScore: report.overallScore,
  diff: {
    newProposals: newProps.map(p => ({ id: p.id, title: p.title, severity: p.severity })),
    resolvedCount: resolvedCount,
    healthChanged: prevHealth !== report.overallHealth,
    scoreChange: report.overallScore - prevScore
  }
});
```

Frontend receives this via existing ws-client.js dispatch chain:
```javascript
// ws-client.js — add to control channel switch:
} else if (d.action === 'governor_report') {
  C3Bus.emit('governor:report', d);
}
```

**Phase 2 hook** (placeholder): `_advancedAnalysis(report)` — reserved for LLM anomaly detection

### 6. `src/routes/governor.js`

Factory: `createGovernorRoutes({ sendJSON, parseBody, safeParseInt })`

| Endpoint | Method | Status Codes |
|----------|--------|-------------|
| `/api/system/governor/status` | GET | 200, 503 |
| `/api/system/governor/report` | GET | 200, 404, 503 |
| `/api/system/governor/check` | POST | 200, 429, 500, 503 |
| `/api/system/governor/proposals` | GET | 200, 503 |
| `/api/system/governor/proposals/:id/approve` | POST | 200, 404, 503 |
| `/api/system/governor/proposals/:id/dismiss` | POST | 200, 404, 503 |

Lazy-loads systemGovernor — returns 503 `{ error: 'Governor not initialized' }` if `setDb()` hasn't been called.

---

## Files to Modify

### 7. `src/server.js`

- **Import** (line ~113): `import { createGovernorRoutes } from './routes/governor.js';`
- **Init** (after L4 block, line ~251): `try { const { systemGovernor } = await import('./system/governor/system-governor.js'); systemGovernor.setDb(db.db); } catch (e) { logger.warn('Governor', 'Init failed: ' + e.message); }`
- **Routes** (line ~757): `...createGovernorRoutes(routeDeps),`

### 8. `c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js`

Add to control channel dispatch (after existing `vram_state` handler):
```javascript
} else if (d.action === 'governor_report') {
  C3Bus.emit('governor:report', d);
}
```

### 9. `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`

- **State vars** (~line 2427): `var _governorData = null, _governorLoading = false;`
- **Tab** in Modely LLM page: "Správce" tab button
- **Tab body**: `_renderGovernorTab()` function
- **C3Bus handler**: `C3Bus.on('governor:report', function(ev) { _governorData = null; /* invalidate */ renderCenter(); });`
- **Actions**: `_runGovernorCheck()`, `_approveGovernorProposal(id)`, `_dismissGovernorProposal(id)`

**Tab rendering**:
- Overall health card: status icon (green/amber/red) + label (HEALTHY/DEGRADED/CRITICAL) + score% + timestamp + summary
- 6 dimension cards (2×3 grid): icon + label + status badge + score% + trend arrow (↑↗→↘↓)
- Proposals sorted by priority: severity badge + title + root_cause + suggested_action + Schválit/Zamítnout buttons

---

## Tests: `tests/governor.test.js` (~70 tests)

| Suite | Count | Key Cases |
|-------|-------|-----------|
| HealthAnalyzer | 22 | 6 dimensions with real SQL, trend analysis, data completeness thresholds, CRITICAL propagation, empty DB graceful degradation, missing table guard, table-not-found fallback |
| ImprovementPlanner | 18 | 8 rules fire/don't fire, confidence formula, priority ordering, root cause strings, action payload structure, rule isolation (one fires ≠ others fire) |
| SafetyGuard | 12 | Required fields validation, dedup by hash, cooldown enforcement, severity-based cooldown duration, filterSafe preserves order |
| SystemGovernor | 18 | Full pipeline end-to-end, DB persist (reports + proposals), idempotent skip on delta < 0.02, rate limit 30s, approve/dismiss state transitions, WS diff payload format, trend history accumulation |

Tests use in-memory SQLite with real migrations (same as other test suites). No LLM dependency.

---

## Build & Verify

```bash
node tests/governor.test.js                           # ~70 tests
node tests/model-upgrade-phase2.test.js               # 108 regression
cd c3-ide/applications/electron && npx webpack --config gen-webpack.config.js --mode development
```

Manual: IDE → Modely LLM → "Správce" tab → "Zkontrolovat" → verify health cards with trends + prioritized proposals with root causes

---

## TODO Checklist

- [x] Migration 040 (governor tables)
- [x] health-analyzer.js (6 dimensions with SQL aggregations + trend + completeness + table guard)
- [x] improvement-planner.js (8 rules + confidence + priority + root cause + action payload)
- [x] safety-guard.js (validation + dedup + cooldown)
- [x] system-governor.js (orchestrator + rate limit + idempotent + WS via control channel)
- [x] routes/governor.js (6 endpoints)
- [x] server.js wiring (import + init + route spread)
- [x] ws-client.js (add governor_report → C3Bus dispatch)
- [x] tests/governor.test.js (72 tests, all pass)
- [x] chat-panel-module.js FE (Správce tab + C3Bus listener)
- [x] webpack rebuild
- [x] package.json → 135.0.0
- [ ] Manual verification
