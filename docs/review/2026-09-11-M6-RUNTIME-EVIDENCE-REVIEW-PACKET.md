# M6 runtime evidence — independent review packet

Review status: `REVIEW_REQUIRED`.

Evidence status: `EVIDENCE_COLLECTED / NOT_ACCEPTED`.

Review the receipts and claims summarized in
[`m6-runtime-evidence-20260911.md`](../execution/runs/m6/m6-runtime-evidence-20260911.md).
The relevant product sources are exact and intentionally distinct:

- owned-server 24-hour soak and throughput:
  `193e2351f4a967679ee237a99c673ceff216ddc1`;
- FILE_EXPLAIN approval/restart/replay:
  `3bda6ddb259a7f2096cf96a5da98e73899b263cd`.

## Review questions

1. Does the decoded long-soak receipt satisfy every Decision 038 duration,
   request, latency, RSS, diagnostics, namespace and shutdown invariant?
2. Is the distinction correct between the long-soak program `PASS` and the
   outer two-program audit `FAIL` caused by `SKIPPED total_deadline` after host
   suspend?
3. Does the separately registered throughput program provide a complete
   non-development receipt, including the full ramp, 210-second sustained
   interval, ceiling observation and all resource/diagnostic budgets?
4. Does the FILE_EXPLAIN result demonstrate one approved exact-file inference,
   durable restart replay without a second chat, exact artifact accounting and
   no live binding or production DB mutation?
5. Are the four pre-inference private-runner failures classified correctly and
   retained with enough evidence to avoid inflating the final PASS?
6. Which of these exact-source receipts may be inherited by a final frozen
   candidate, and which must be re-run after candidate assembly?

Please return `REVIEW_PASSED` or `CHANGES_REQUIRED`, separately for
`M6_OWNED_RUNTIME_EVIDENCE` and `M2_FILE_EXPLAIN_REAL_MODEL_EVIDENCE`. Neither
verdict should imply M5, M2 or M6 acceptance.
