# Authoritative status reconciliation — 2026-09-11

Status: `DOCUMENTATION_CORRECTED / NO_ACCEPTANCE_CHANGE`.

Several current-summary rows had regressed to pre-acceptance wording even though
their authoritative decision and review records were already present in the
same Git history. This change corrects only those projections.

## Decision 020/E

The former SYSTEM-MAP and ROADMAP wording still described the original
`CHANGES_REQUIRED` finding against a shared `user_settings` blob. The actual
sequence is:

1. operator acceptance of 020/E and its legacy drop semantics in `b863190a`;
2. dedicated `model_automation_policy` storage, audit and typed route in
   `b9731302` and the completed M1 sequence;
3. supported 061/066 upgrade compatibility fix in `a71e5b98`, independently
   accepted in
   [`2026-09-09-PROVIDER-AND-POLICY-COMPATIBILITY-REVIEW.md`](../../review/2026-09-09-PROVIDER-AND-POLICY-COMPATIBILITY-REVIEW.md).

The corrected status is `020/E ACCEPTED / IMPLEMENTED /
COMPATIBILITY_REVIEW_PASSED`. Automatic failover remains default-off until its
separate proof and activation authorities are satisfied; this correction does
not activate it.

## M5 DATA and PERF

The authoritative operator result
[`2026-08-27-M5-M6-OPERATOR-REVIEW-RESULT.md`](../../review/2026-08-27-M5-M6-OPERATOR-REVIEW-RESULT.md)
states at lines 38–40 that M5 DATA, AUTH and PERF passed re-review. The DATA and
PERF WP headers and index still said `RE_REVIEW_REQUIRED`. They now reflect
`REVIEW_PASSED`; DATA additionally points to the later accepted backup
compatibility follow-up.

The M5 performance row continues to describe exact candidate `816a2a4c` and
its five-minute evidence. The 2026-09-11 Decision 038 24-hour soak and maximum
throughput receipts are separate M6 evidence and remain `REVIEW_REQUIRED`.
PRIVACY remains the ninth open M5 section, so M5 stays `8/9 REVIEW_PASSED /
ACCEPTANCE_BLOCKED`.

No source, test, registry, runtime, credential, service, acceptance, push or
release state changes in this reconciliation.
