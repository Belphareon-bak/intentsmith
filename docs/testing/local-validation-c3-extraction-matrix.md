# C3 Nightly Runner Extraction Matrix

Source inspected read-only from the current GitHub `Belphareon-bak/C3-agent`
repository at exact commit
`a7b90e36aa80310305703f54f2332e1c0e7f9e8f`. No archive or historical local
C3 tree was used.

The inspected C3 surface was:

- `scripts/nightly-orchestrator.js`
- `scripts/nightly-audit.js`
- `scripts/audit-summary.js`
- `scripts/install-nightly-audit-systemd.js`
- `tests/nightly-orchestrator-self-test.js`
- `tests/nightly-audit-runner-self-test.js`
- `tests/audit-summary-self-test.js`
- `docs/nightly-audit.md`
- the service and timer templates used by the installer

## Matrix

| Class | C3 principle | IntentSmith decision |
| --- | --- | --- |
| REUSE | Resolve and record an immutable remote commit | Require an exact 40-character commit in every checkpoint, attempt and artifact. |
| REUSE | Detached disposable worktree with an ownership marker | Create below one managed run root and require the live session marker before cleanup. |
| REUSE | Separate artifact/worktree roots, run-directory refusal and lock ownership | Preserve completed run directories as immutable history and use an exclusive runner lock. |
| REUSE | Atomic JSON checkpoint after each scenario | Write a mode-0600 temporary file, sync it, and atomically rename after every completed or BLOCKED attempt. |
| REUSE | Exact run-ID validation | Retain the narrow lowercase alphanumeric, underscore and hyphen grammar; reject traversal, absolute paths and unsafe characters. |
| REUSE | Process group with TERM/KILL and stream completion | Own only groups spawned by the live session, bound termination and wait for both output streams before finalization. |
| REUSE | Visible preflight failures and non-zero exits | Preserve structured reasons and a failing deterministic verdict. |
| REUSE | Clustered summaries and baseline failure identity | Cluster by structured reason and compare scenario/version/verdict structure. |
| REUSE | Timer defaults and `Persistent=false` | Render a non-installing user unit/timer with Prague 00:30 defaults, absolute paths and `flock`. |
| ADAPT | Checkpoint fingerprint | Expand C3 source/inventory/options matching to source commit, runner version, explicit scenario manifest, model profile and options. |
| ADAPT | Resume completion rules | Retry only BLOCKED or internal scheduler-SKIPPED work; never erase or silently replace an earlier FAIL. |
| ADAPT | Process cleanup evidence | Add owned listener/socket/temp/HOME/XDG, file-descriptor, disk, approval, grant, token and credential evidence. |
| ADAPT | Baseline comparison | Treat structural difference as evidence, not automatically a regression; deterministic invariants decide PASS/FAIL. |
| ADAPT | Dry-run | Make it a pure emitted plan: no directory creation, worktree, external tool, database or scenario. |
| ADAPT | Systemd installation | Keep generation pure. Installation, enabling and starting require a separate explicit action. |
| REWRITE | Test-file discovery by filename/content | Use a versioned scenario manifest with explicit preconditions, commands and upper bounds. |
| REWRITE | C3 result states | Final verdicts are only PASS/FAIL/BLOCKED. TIMEOUT is structured FAIL; SKIPPED is internal only. |
| REWRITE | Blocker scanning and heuristic overrides | Probe explicit pinned prerequisites. Missing prerequisites alone are BLOCKED; failures cannot be overridden. |
| REWRITE | Inherited execution environment | Start from the repository's allowlisted environment builder and redirect HOME plus every XDG directory per session. |
| REWRITE | C3-specific npm/test orchestration | Invoke the pinned IntentSmith real-binary scenario manifest one at a time in disposable Git worktrees. |
| DISCARD | `--allow-dirty`, `--no-block` and blocker overrides | Dirty input and unavailable required evidence fail closed. |
| DISCARD | Candidate mode and automatic changes | The validation runner reports evidence and never repairs or mutates production code. |
| DISCARD | Heuristic “safe destructive” execution | Only explicit versioned scenarios run; no discovered destructive test is inferred safe. |
| DISCARD | Final TIMEOUT/SKIPPED result categories | They cannot appear as an IntentSmith final scenario verdict. |
| DISCARD | Generic historical PID cleanup | A recovered PID/process group is never killed because PID reuse cannot be excluded. |

## IntentSmith contracts retained

The implementation reuses the Phase 3 isolated-environment and redaction
boundaries, the process-group ownership model, and the existing product-level
real-binary harness. It does not change Core, approval, authentication,
inference, worker or server behaviour.

Deterministic scenario results and model behaviour observations are separate
fields. The profile remains opt-in, pinned and single-concurrency. It neither
installs nor downloads prerequisites, never unloads a model or kills an
unrelated process, and preserves the Phase 3 statement that strict offline is
**NOT PROVEN**.
