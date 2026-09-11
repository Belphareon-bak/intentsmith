# Bounded code draft through the accepted M2 lifecycle

Authority: the operator's instruction to continue toward production readiness;
PRODUCT §3 project change proposal → visible scope → approval → atomic change
and rollback. Input revision: `a1f59d4fa2315b10bdf357df6c8bb973e9295978`.
The real cookbook produced truncated, mixed-file code; source tracing confirms
that Studio currently requires a manually authored strict JSON proposal.

One writer in the existing audit checkout/branch. Owned paths: a bounded draft
adapter in `src/lifecycle/`, the existing lifecycle service/routes, its Studio
consumer, directly corresponding tests, module baseline and required census/docs.
No new execution authority: generated content passes the existing strict
proposal compiler, governance, exact approval, ProjectChange and rollback.

Deliver a natural-language request for one explicit small JavaScript file,
with a visible complete before/after proposal and fixed syntax check (or an
explicit caller-supplied focused test). The model cannot select paths, process,
Git identity, approval or execution. One bounded CODE call; reject incomplete
output, oversized context, cancellation and workspace drift before preparing.
Keep the 4096 production context and current model binding. This is a vertical
slice, not acceptance of the full multi-file project builder.

Verification: existing lifecycle service, route and Studio suites with positive
draft → approve → actual file/test evidence and failed syntax → rollback;
negative schema, truncation, extra-file, cancellation and stale revision cases;
`npm run test:registry`, `npm run test:deterministic`, `git diff --check`.
Use a serial contained exact-model probe only when GPU is idle; preserve raw
results and never promote synthetic inference to a physical model PASS.
Stop dependent work for foreign GPU activity or unavailable prerequisites;
no production DB, credentials, model rebinding, publishing or legacy executor.
State belongs in ROADMAP/SYSTEM-MAP, with independent review still required.
