# Execution Lifecycle – Canonical Spec (FÁZE A)

This document defines the **authoritative execution lifecycle contract**
for LocalAI Hybrid Copilot (C.3).

No implementation may violate this contract.

---

## 1. Execution Identity

Each execution has a globally unique identifier:

- `execution_id` (UUID v4)

Execution identity is immutable.

---

## 2. Disk Layout (per execution)

runtime/state/executions/<execution_id>/

- meta.json
- plan.json
- progress.json
- events.log
- lock.pid (optional)

---

## 3. Execution Status Enum

meta.status ∈

- created
- running
- paused
- cancelled
- done
- failed

Only valid transitions are allowed.

---

## 4. Files

### meta.json
{
  "execution_id": "...",
  "created_at": "...",
  "status": "created | running | paused | cancelled | done | failed",
  "sandbox_root": "...",
  "last_update": "ISO-8601"
}

### plan.json
- Canonical execution plan
- EXACT planner output
- Immutable after creation

### progress.json
{
  "current_step": 0,
  "completed_steps": []
}

### events.log
- Append-only
- Human-readable
- No truncation allowed

---

## 5. Atomicity Rules

- progress.json MUST be written atomically:
  write temp → fsync → rename
- events.log MAY be appended directly
- meta.json MUST be updated atomically

---

## 6. Locking Rules

- lock.pid MAY exist
- Contains PID of owner process
- If PID is not alive → lock is stale

---

## 7. Startup Recovery Rules

On backend startup:

For each execution:
- status == running AND lock.pid stale
  → transition to paused
  → append event: AUTO_PAUSED_ON_BOOT

No automatic resume unless explicitly enabled.

---

## 8. Resume Rules

Resume is allowed only if:
- status == paused OR running
- plan.json exists
- progress.json exists

Resume MUST start at progress.current_step.

---

## 9. Non-Goals

- No rollback
- No partial step replay
- No speculative recovery

---

This spec is LOCKED once execution persistence is live.
