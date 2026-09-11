# Web review scope and malformed peer regression

Authority: operator review of candidate `4166056e`, identifying omitted web
review scope and asking for a bad-peer check; Decision 044 and the accepted
M2 lifecycle own the existing intended behaviour. No new product scope.

Root writes only in the existing audit snapshot. Own the dedicated web review
packet, scoped operator review response, existing lifecycle service test,
canonical census/status and the superseded projectless-web brief header.
Two read-only agents trace web security and evidence/commit scope. No new
checkout, production DB, inference, external HTTP request, foreign mutation,
model binding change, release acceptance or publishing. A reproduced defect
in existing authorised web behaviour may be repaired with a focused regression;
any boundary expansion remains outside this assignment.

Reproduced repairs within Decision 044: distinguish the real local HTTP/WS
transport subject from M7's same-valued remote actor; complete the terminal
audit for an already claimed request after revoke/scope deletion. Own the
existing global-auth policy's opaque provenance predicate, web repository and
handler, and their existing M5/M7 tests. The one new module edge is
`src/network/conversation-web-repository.js -> src/security/global-auth-policy.js`.
This enforces the existing local-only scope; it grants no new remote authority.
Audit failure remains unavailable and a lost process-local claim is not crash
recovery. Source implementation and exact edge baseline will be separately pinned.

Deliver a separately pinned packet covering web introduction and all subsequent
changes, dependencies and final emitted consumer contract, with evidence hashes,
positive/negative coverage and explicitly missing runtime claims. The operator's
scoped review is recorded as supplied, not promoted to full candidate or Opus
acceptance. Preserve prior reports and packets as historical evidence.

Add both malformed-syntax and syntactically valid but functionally wrong first
peer cases: later generated files consume proposed peer bytes, no write before
approval, one actual focused process fails, all writes roll back, and durable
status cannot become succeeded after reconstruction. Use existing SQLite/Git/
bwrap fixtures with synthetic model output; no claim of model quality.

Checks: `node tests/m2-lifecycle-application-service.test.js`, relevant registered
web suites, `npm run test:registry`, artifact validation, full deterministic
profile with declared local toolchain prerequisites, and `git diff --check`.
Stop new dependent implementation if an unresolved authority decision appears.
Evidence and findings go into the dedicated packet and one unique run record;
ROADMAP/SYSTEM-MAP keep web `REVIEW_REQUIRED` until explicit scoped acceptance.


Handoff: implementation/test `dbe6630a`, full deterministic 353/353 PASS;
web 20/20, lifecycle 36/36, server auth/web 2 programs (13 + 2 cases).
The actual M7 regression lives in the existing web database suite; the M7
executor suite retains its original offline fixtures. The initial failed run
and its two timeouts remain preserved. Deliverables:
[packet](../review/2026-09-11-CONVERSATION-WEB-REVIEW-PACKET.md),
[review response](../review/2026-09-11-PRODUCTION-FOLLOWUP-REVIEW-RESPONSE.md),
[run record](../execution/runs/conversation-web-review-20260911.md).
Authoring/verification complete; independent web review remains required.
