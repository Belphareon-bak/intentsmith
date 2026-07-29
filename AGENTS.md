# IntentSmith Convergence Instructions

These instructions govern the C3-derived IntentSmith integration workspace.

## Product and scope

- The final product is **IntentSmith**.
- C3 is the product trunk; the existing IntentSmith repository is a donor.
- Preserve C3 Studio/Theia, chat, CRE, project lifecycle, workflow roles, expertises, Skills, specialists, agents, memory, Code Intelligence, APIs, WebSocket behavior, data compatibility, and tests.
- Do not start a greenfield rewrite or a new IDE.
- The hardened C3 executor and C3 Code Intelligence are the IntentSmith 1.0 incumbents.
- OpenCode and Serena evaluation belongs to 1.1.

## Required documents

Read these completely before implementation:

1. `INTENTSMITH-1.0-START-HERE.md`
2. `INTENTSMITH-CONVERGENCE-PLAN.md`
3. `INTENTSMITH-1.0-CAPABILITY-BASELINE.md`
4. `INTENTSMITH-1.0-TEST-AND-RELEASE-SYSTEM.md`
5. `INTENTSMITH-1.0-IMPLEMENTATION-BRIEF.md`

When they conflict, follow: current explicit user decision, safety/privacy/data integrity, convergence plan, capability baseline, test system, implementation brief, repository documentation, historical plans.

## Baseline

- C3 input: `ffd21cf119865259ea1847af989acb24916bebe3`.
- Pre-`final` comparison: `a7b90e3`.
- IntentSmith donor: `6676902c5f6fe7a5d66aba0d79cb502e0f3a60e4`.
- `ffd21cf` is disputed input, not an accepted release baseline.
- Classify each material `a7b90e3..ffd21cf` change as `KEEP`, `REBUILD`, `EXCLUDE`, or `UNRESOLVED`.
- Do not accept or revert the whole commit.
- `Archive.zip` is not a baseline.

## Development rules

- GPT-5.6-sol in Codex is the sole branch writer.
- Use small, reversible commits with declared scope.
- Preserve unrelated user changes.
- Maintain status, capability, test, risk, decision, and evidence ledgers before each handoff.
- Make at most two evidence-based repair attempts for one defect before recording a blocker.
- Run RTX 3090 model roles sequentially.
- Do not merge, tag, push, publish, force-push, rewrite history, delete user data, or rotate credentials without explicit user approval.

## Security boundary

- Every user-triggered effect is `MEDIATED`, `READ_ONLY`, `TRUSTED_INTERNAL`, `DISABLED`, or `UNRESOLVED`.
- No `UNRESOLVED` effect may be active.
- Bind approvals to the exact normalized request, path/payload, run, expiry, and single use.
- Default-deny network and out-of-workspace access.
- Deterministic gates always outrank model or reviewer opinions.
- Cancellation, timeout, kill, and restart must revoke authority and leave no orphan process.

## Testing and release

- Selected passing tests never establish a release pass.
- Do not delete, weaken, skip, or quarantine a failing mandatory test to obtain green status.
- Each real-worker/model run uses a disposable Git repository and emits the required evidence bundle.
- The target 1.0 requires full mandatory parity.
- A disabled non-core capability is allowed only in a user-approved minimum-release contingency and is never counted as parity-green.
- Release requires five consecutive deterministic runs, seven consecutive completed nightly runs, green security/data/offline/process/Studio gates, and explicit user approval.

## First action

Execute Gate 0 from `INTENTSMITH-1.0-START-HERE.md`. Do not begin architecture or worker replacement before the baseline report is complete.
