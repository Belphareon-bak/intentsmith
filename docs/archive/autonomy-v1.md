# Guarded Autonomy MVP v1

## System Overview

The Guarded Autonomy system is a self-tuning background process for the CRE (Conversational Reasoning Engine). It continuously monitors CRE telemetry data and adjusts the **override threshold** parameter to optimize classification accuracy.

**What it controls:** A single numerical parameter — the confidence threshold used by the Weak-Ambiguous Override (L3 layer). This threshold determines when a strong L2 follow-up signal (R1 anaphoric or R2 processing request) can override an AMBIGUOUS classification and preserve conversational continuity.

**Why it exists:** The override threshold was initially hardcoded at `0.85`. This value was chosen heuristically. In production, the optimal threshold depends on actual usage patterns — language mix, input length distribution, follow-up frequency — which vary per deployment. The autonomy system empirically calibrates this threshold based on real telemetry data.

**What it does NOT do:**
- Does not modify CRE logic, follow-up rules, or break patterns
- Does not change LLM prompts or model selection
- Does not alter any code — only adjusts one numerical parameter
- Does not make irreversible changes — all adjustments are bounded and rollback-capable

---

## Architecture

```
┌──────────────────────┐  15min  ┌─────────────┐
│ telemetry_snapshots  │ ──────> │ Aggregator   │ ──> telemetry_metrics
│ (existing, v2 diag)  │        └──────┬──────┘
└──────────────────────┘               │
                                       ▼
                                ┌─────────────┐
                                │ Drift Det.   │ ──> telemetry_alerts
                                └──────┬──────┘
                                       │ drift?
                                       ▼
                                ┌─────────────┐
                                │ Controller   │ ──> telemetry_improvements
                                └──────┬──────┘
                                       │
                              ┌────────┴────────┐
                              │                 │
                         trust >= 10        trust < 10
                              │                 │
                         auto-apply         log proposal
                              │            (operator reviews)
                              ▼
                     CREDecisionEngine
                     .setOverrideThreshold()
```

### Data Flow

1. **Telemetry Snapshots** — Every CRE `decide()` call records a diagnostic snapshot with classification details (initialIntent, finalIntent, followUp rule/confidence, isIntentBreak, overrides applied). These are persisted to `telemetry_snapshots` via TurnTelemetry v2.

2. **Aggregator** (`src/autonomy/aggregator.js`) — Every 15 minutes, reads raw snapshots from the last window and computes aggregated metrics: total turns, AMBIGUOUS count, ASK_USER count, break count, override count, average confidence, rule distribution. Records the current threshold value at measurement time. Inserts into `telemetry_metrics`.

3. **Drift Detector** (`src/autonomy/drift-detector.js`) — Compares current window metrics against a rolling baseline (last 6 qualifying windows). Detects spikes in ASK_USER rate (+8%) or break rate (+5%). Uses hysteresis (2 consecutive windows) to filter single-spike noise. Inserts alerts into `telemetry_alerts`.

4. **Controller** (`src/autonomy/controller.js`) — Central orchestrator. Runs the aggregate → detect → propose → apply cycle. Handles cooldown (anti-oscillation), rollback (one-shot, on persistent drift), trust-gated auto-apply, and startup restoration.

5. **Operator API** (`src/routes/autonomy.js`) — HTTP endpoints for viewing status, approving/rejecting proposals, and acknowledging alerts.

---

## Parameter Reference

### `overrideThreshold`

| Property | Value |
|----------|-------|
| **Purpose** | Minimum L2 follow-up confidence for Weak-Ambiguous Override |
| **Location** | `CREDecisionEngine._overrideThreshold` (`src/chat/cre-decision.js`) |
| **Default** | `0.85` |
| **Guard band** | `[0.75, 0.90]` |
| **Max step** | `0.03` per cycle |
| **Effect of lowering** | More AMBIGUOUS inputs get overridden → fewer ASK_USER → more continuity, but higher risk of misclassification |
| **Effect of raising** | Fewer overrides → more ASK_USER → more precision, but potential user friction |

---

## Metric Definitions

All metrics are computed per 15-minute window from `telemetry_snapshots` with v2 diag data.

| Metric | Definition | Source |
|--------|------------|--------|
| `total_turns` | Number of telemetry snapshots in window | Count of rows |
| `ambiguous_count` | Turns where `diag.initialIntent === 'AMBIGUOUS'` | L1 weakness indicator |
| `ask_user_count` | Turns where `diag.finalIntent === 'AMBIGUOUS'` AND `diag.overrides` is null or empty | True unresolved AMBIGUOUS — the user would need to clarify. Excludes benign transient AMBIGUOUS that was resolved by an override. |
| `break_count` | Turns where `diag.isIntentBreak === true` | Topic change rate |
| `override_count` | Turns where `diag.overrides` is non-null and non-empty | Override activity |
| `avg_confidence` | Mean of `diag.followUp.confidence` across turns with follow-up data | Signal strength |
| `override_threshold_at_time` | Value of `creEngine.getOverrideThreshold()` during this window | For historical analysis — ensures metrics are interpretable in context of the threshold that produced them |
| `rule_distribution` | JSON object counting occurrences of each follow-up rule (R1_anaphoric, R2_processing_request, etc.) | Rule activity breakdown |

### Derived Rates (computed for drift detection)

| Rate | Formula |
|------|---------|
| `ask_user_rate` | `ask_user_count / total_turns` |
| `break_rate` | `break_count / total_turns` |

---

## Safety Mechanisms

### 1. Feature Flag (Opt-In)

```bash
C3_ENABLE_AUTONOMY=true  # must be explicitly enabled
```

Default is **OFF**. The system does nothing unless explicitly activated.

### 2. Guard Band

The threshold can only be adjusted within `[0.75, 0.90]`. Values outside this range would either override too aggressively (< 0.75) or block all overrides (> 0.90).

### 3. Maximum Step Size

Each cycle can adjust the threshold by at most `0.03`. This prevents sudden jumps. At maximum speed, moving from 0.85 to 0.75 would take 4 cycles (1 hour).

### 4. Cooldown (Anti-Oscillation)

After any applied change (including rollbacks), the system skips tuning for `cooldownWindows` cycles (default: 2 windows = 30 minutes). This prevents rapid oscillation (e.g., 0.85 → 0.82 → 0.85 → 0.82).

### 5. Hysteresis

Drift must be detected in **2 consecutive windows** before it triggers a rollback. A single spike (one window with unusual data) generates a warning alert but does not trigger corrective action. Only persistent drift (critical severity) triggers rollback.

### 6. Rollback Guards

| Trigger | Threshold | Action |
|---------|-----------|--------|
| ASK_USER spike | Current rate > baseline + 8 percentage points | Rollback to previous threshold |
| Break spike | Current rate > baseline + 5 percentage points | Rollback to previous threshold |

Rollback is **one-shot**: it only reverts `applied` improvements. If the latest improvement is already `rolled_back`, no further rollback occurs.

### 7. Trust-Gated Auto-Apply

| Trust Level | Behavior |
|-------------|----------|
| 0–9 consecutive approvals | Proposals are logged as `proposed` — operator must approve via API |
| 10+ consecutive approvals | Proposals are auto-applied immediately, logged as `auto_applied=1` |

Trust resets to 0 on:
- Any rollback
- Any rejection

### 8. Minimum Volume

If a window has fewer than `minTurnsPerWindow` (default: 10) turns, metrics are still recorded but tuning is skipped. A `low_volume` warning alert is generated to prevent the system from appearing healthy when it has no data.

### 9. Stateless Cycles

Each 15-minute cycle is independent. There is no accumulated in-memory state between cycles. On restart, the last applied threshold is restored from the database.

### 10. Never Throws

All autonomy code is wrapped in try/catch blocks. Errors are logged at debug level but never propagate to the caller. A failing autonomy system must never affect CRE classification.

---

## Operator Guide

### Enabling the System

```bash
# Start with autonomy enabled
C3_ENABLE_AUTONOMY=true node src/server.js
```

On startup, you'll see:
```
[INFO] Autonomy: Restored overrideThreshold=0.85 from improvement #N
[INFO] Server: Autonomy loop started (900s interval)
```

### Checking Status

```bash
curl http://127.0.0.1:3335/api/autonomy/status
```

Response:
```json
{
  "currentThreshold": 0.85,
  "trustLevel": 3,
  "autoApplyEnabled": false,
  "latestMetrics": {
    "total_turns": 42,
    "ambiguous_count": 8,
    "ask_user_count": 3,
    "break_count": 5,
    "override_count": 12,
    "avg_confidence": 0.87,
    "override_threshold_at_time": 0.85
  },
  "latestImprovement": { ... },
  "pendingProposals": [ ... ],
  "unacknowledgedAlerts": [ ... ]
}
```

### Approving a Proposal

```bash
curl -X POST http://127.0.0.1:3335/api/autonomy/approve/42
```

### Rejecting a Proposal

```bash
curl -X POST http://127.0.0.1:3335/api/autonomy/reject/42
```

### Acknowledging an Alert

```bash
curl -X POST http://127.0.0.1:3335/api/autonomy/alerts/7/acknowledge
```

### Disabling the System

Remove `C3_ENABLE_AUTONOMY=true` from environment and restart. The last applied threshold remains in effect (persisted to CRE engine default on startup).

---

## Configuration Reference

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `C3_ENABLE_AUTONOMY` | `false` | Enable autonomy system (must be `'true'` to activate) |
| `C3_AUTONOMY_INTERVAL` | `900000` | Cycle interval in milliseconds (default: 15 minutes) |
| `C3_AUTONOMY_MIN_TURNS` | `10` | Minimum turns per window for tuning (below = low_volume skip) |

### Hardcoded Constants (in `config.js`)

| Parameter | Value | Description |
|-----------|-------|-------------|
| `trustThreshold` | `10` | Consecutive approvals before auto-apply |
| `overrideThreshold.min` | `0.75` | Minimum allowed threshold |
| `overrideThreshold.max` | `0.90` | Maximum allowed threshold |
| `overrideThreshold.maxStep` | `0.03` | Maximum change per cycle |
| `askUserSpikePercent` | `8.0` | ASK_USER rate spike trigger (percentage points) |
| `breakSpikePercent` | `5.0` | Break rate spike trigger (percentage points) |
| `baselineWindows` | `6` | Number of windows for rolling baseline |
| `cooldownWindows` | `2` | Windows to skip after applying a change |

---

## Failure Modes

### Database Error

If any DB operation fails (read or write), the current cycle is skipped. An error is logged at debug level. The next cycle will retry normally. No data corruption is possible — all writes are individual INSERT/UPDATE statements.

### Low Volume

If fewer than `minTurnsPerWindow` turns are recorded in a window:
- Metrics are still written (for historical record)
- A `low_volume` warning alert is generated
- Tuning is skipped (no proposals generated)
- The system resumes tuning when volume returns

### Oscillation

Prevented by cooldown windows. After any applied change, tuning is suspended for 2 cycles (30 minutes by default). Even in worst case, the threshold can only change 0.03 every 45 minutes.

### Repeated Rollbacks

If the system repeatedly proposes and rolls back the same change:
- Each rollback resets trust counter
- Cooldown prevents immediate re-proposal
- After a rollback, the old threshold is restored
- The system will eventually converge or stop proposing

In practice, repeated rollbacks indicate that the current threshold is near-optimal and the system should not be changing it.

### Server Restart

On restart:
1. The latest `applied` improvement is loaded from `telemetry_improvements`
2. `creEngine.setOverrideThreshold()` is called with the restored value
3. The background loop restarts from a fresh cycle
4. No data is lost — all state is in SQLite

### Autonomy Module Fails to Load

If the autonomy module fails to import (e.g., missing dependency):
- The background loop is not started
- A debug-level message is logged
- CRE continues with its default threshold
- The server operates normally

---

## Expected Behavior Timeline

### Week 1: Baseline Collection

- System collects metrics without proposing changes
- Baseline accumulates over ~6 qualifying windows
- `low_volume` alerts may appear during low-traffic periods
- Status shows `trustLevel: 0`, no pending proposals

### Week 2: First Proposals

- If ASK_USER rate is consistently > 10%, the system proposes lowering the threshold
- Proposals appear as `status: 'proposed'` in the API
- Operator reviews and approves/rejects each proposal
- Trust counter begins incrementing on approvals

### After 10 Consecutive Approvals

- Auto-apply mode activates
- Changes are applied immediately without operator intervention
- Changes are smaller (typically 0.01–0.02 adjustments)
- Threshold stabilizes, typically between 0.80–0.84

### Steady State

- Threshold rarely changes (maybe once a week)
- Most cycles produce no proposals
- Occasional rollbacks from traffic pattern changes
- ASK_USER rate is stable and lower than pre-autonomy baseline

---

## Database Schema

### `telemetry_metrics`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `window_start` | DATETIME | Start of measurement window |
| `window_end` | DATETIME | End of measurement window |
| `total_turns` | INTEGER | Total CRE turns in window |
| `ambiguous_count` | INTEGER | Initial AMBIGUOUS classifications |
| `ask_user_count` | INTEGER | Unresolved AMBIGUOUS (no override) |
| `break_count` | INTEGER | Intent breaks detected |
| `override_count` | INTEGER | Overrides applied |
| `avg_confidence` | REAL | Mean follow-up confidence |
| `override_threshold_at_time` | REAL | Threshold during this window |
| `rule_distribution` | TEXT | JSON rule counts |
| `created_at` | DATETIME | Row creation time |

### `telemetry_alerts`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `alert_type` | TEXT | `ask_user_spike`, `break_spike`, `low_volume`, `rollback` |
| `severity` | TEXT | `warning` (single spike) or `critical` (persistent) |
| `metric_value` | REAL | Current rate value |
| `baseline_value` | REAL | Baseline rate for comparison |
| `threshold_at_time` | REAL | Threshold when alert was generated |
| `message` | TEXT | Human-readable description |
| `acknowledged` | INTEGER | 0 = unacknowledged, 1 = acknowledged |
| `created_at` | DATETIME | Alert creation time |

### `telemetry_improvements`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `parameter` | TEXT | Always `'overrideThreshold'` in MVP |
| `old_value` | REAL | Previous threshold value |
| `new_value` | REAL | Proposed new threshold value |
| `reason` | TEXT | Why the change was proposed |
| `status` | TEXT | `proposed`, `applied`, `rejected`, `rolled_back` |
| `trust_level` | INTEGER | Trust counter at time of proposal |
| `auto_applied` | INTEGER | 1 if auto-applied (trust >= 10), 0 otherwise |
| `rollback_trigger` | TEXT | What caused rollback (null if not rolled back) |
| `created_at` | DATETIME | Proposal creation time |
| `applied_at` | DATETIME | When applied (null if not yet applied) |

---

## Criteria for Future Parameters

A parameter qualifies for autonomy if it meets ALL of these criteria:

1. **Numeric** — must be a single number (not a string, boolean, or complex object)
2. **Bounded** — must have clear min/max values that define safe operation
3. **Isolated** — changing the parameter must not have cascading effects on other parameters
4. **Measurable impact** — the effect of changing the parameter must be observable in telemetry metrics
5. **Reversible** — rolling back the parameter must restore previous behavior exactly
6. **Gradual** — the parameter must support small incremental changes (no cliff effects)

Potential future candidates:
- R4 short fallback confidence threshold
- LLM acceptance confidence threshold (currently 0.7)
- Follow-up length threshold for R3 (currently 40 chars)

Each new parameter requires:
- Adding to `config.autonomy.parameters` with its own guard band
- New tuning logic in `evaluateProposal()`
- Its own trust counter (already per-parameter)
- Verification that its metrics are captured in telemetry

---

## Files

| File | Purpose |
|------|---------|
| `src/db/migrations/2026_02_26_019_v83_autonomy_tables.js` | Schema: 3 tables |
| `src/db/database.js` | Repositories: telemetryMetrics, telemetryAlerts, telemetryImprovements |
| `src/config.js` | Feature flag + autonomy configuration |
| `src/chat/cre-decision.js` | `_overrideThreshold`, `setOverrideThreshold()`, `getOverrideThreshold()` |
| `src/autonomy/aggregator.js` | 15-min metric aggregation |
| `src/autonomy/drift-detector.js` | Baseline comparison + hysteresis |
| `src/autonomy/controller.js` | Orchestrator: aggregate → detect → propose → apply/rollback |
| `src/routes/autonomy.js` | Operator API endpoints |
| `src/server.js` | Background interval + route mount |
| `docs/autonomy-v1.md` | This documentation |
