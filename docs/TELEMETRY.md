# Telemetry Architecture

> Unified conventions for all observability tables in C3.

---

## Core Contract

1. **Telemetry is best-effort.** Data loss under load is acceptable.
2. **Telemetry must never affect runtime behavior.** No throws, no blocking, no control flow changes.
3. **Telemetry must never store sensitive data.** No PII, no memory values/keys, no conversation content, no query params.

---

## Domains & Tables

C3 uses **five separate telemetry tables**, each with different granularity, frequency, and purpose. They are intentionally not centralized into a single table.

| Table | Domain | Granularity | Introduced |
|---|---|---|---|
| `telemetry_snapshots` | Turn resilience | Per LLM turn | v81 |
| `llm_execution_log` | LLM requests | Per Ollama call | baseline |
| `quality_scores` | Project lifecycle | Per milestone/review | v80 |
| `capability_drift_log` | Expertise drift | Per capability check | baseline |
| `specialist_telemetry` | Specialist execution | Per tool/memory/API event | v82 |

---

## Retention

Centralized in `src/db/telemetry-retention.js`. Runs once at process start.

- **Max age:** 30 days (configurable via `maxAgeDays`)
- **Row count warning:** 200K+ rows triggers a log warning
- **All tables** are listed in the `TELEMETRY_TABLES` array — add new tables there
- **Individual classes must NOT implement their own retention** — the central pruner handles everything

---

## Naming Convention

### Specialist telemetry (`specialist_telemetry`)

Event types use `domain.action` format:

```
tool.match      — tool pattern matched user input
tool.success    — tool executed successfully
tool.fail       — tool execution failed
tool.clarify    — tool requested clarification (missing params)
memory.hit      — memory lookup returned data
memory.miss     — memory lookup returned nothing
memory.write    — memory entries written
lifecycle.boot  — specialist system booted
lifecycle.enable  — specialist enabled
lifecycle.disable — specialist disabled
api.request     — REST API request completed
```

New event types must be added to `VALID_EVENT_TYPES` in `specialist-telemetry.js`. Unknown types are silently ignored.

### Other tables

Use structured columns (not event_type). See individual migration files for schema.

---

## Error Handling

- All `record()` calls are wrapped in `try/catch` — errors are swallowed
- Call sites use optional chaining: `this._telemetry?.record(...)`
- The NOOP sentinel (`Object.freeze({ record(){}, ... })`) eliminates if-guards when telemetry is disabled
- `flush()` failure drops events — this is acceptable per the core contract

---

## Metadata JSON

The `metadata` column in `specialist_telemetry` stores optional JSON:

- **Flat keys only** — no nested objects
- **Max 1KB** — truncated at 1000 chars by `record()`
- **No sensitive values** — no memory keys/values, no PII, no conversation IDs
- **Strip query params** from API paths (`req.url.split('?')[0]`)

Examples:
```json
{"method": "GET", "path": "/api/specialists", "status": "ok"}
{"op": "getContext", "keyCount": 3}
{"contextual": true}
{"error": "Module not found: accountant-cz"}
```

---

## Duration

- Always **integer milliseconds** — `Math.round(durationMs)`
- Never float, never seconds
- Stored in `duration_ms INTEGER` column
- `null` when not applicable (e.g., memory events)

---

## Backpressure

`specialist_telemetry` uses an in-memory queue with batch flush:

- **Queue size:** 500 (flush threshold)
- **Hard limit:** 2000 (drop oldest above this)
- **Flush interval:** 30s (`setInterval().unref()`)
- **Flush method:** single SQLite transaction for the entire batch

---

## Index Rules

- Max 3-4 indexes per table
- Always index `created_at` (retention pruning depends on it)
- Index high-cardinality filter columns (`event_type`, `specialist_id`)
- No composite indexes unless query patterns demand them

---

## Schema Evolution

- **New event types:** add to `VALID_EVENT_TYPES` set — no migration needed
- **New columns:** requires a new migration — never ALTER existing columns
- **New tables:** add migration + add to `TELEMETRY_TABLES` in `telemetry-retention.js`
- **Existing schema:** never modify — append only
