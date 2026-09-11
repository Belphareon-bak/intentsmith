# Independent source review — complete SPEC output authority

2026-09-11. Verdict: REVIEW_PASSED for original product delta
5279da5c381586bdd4d437fd87213a7e855743e7..3291b5d49af5832ca8528c9c9395a18e9906fbdf.
Reviewer: Codex audit/remediation run, separate from author of the reviewed delta.
The review excludes this run's later analysis helper and all other remediation edits.

Read all five changed production files and all three changed test diffs. Traced
answerSpecQuestions -> callSpecDocumentLLM -> callWithPolicy -> llmGateway.call,
and executeM1ModelRequest -> validateM1Authority -> the same policy boundary.
Source search confirms answerSpecQuestions is the only production consumer of
the complete-document helper. Initial/revision analysis use ordinary callLLM.

The frozen token's operation is held in a process-local WeakMap. Copies lose
issuance; ordinary planner tokens above 4000 fail policy. Operation correlation,
D1/configured model, answer purpose, reasoning capability, JSON, empty system
prompt and the bounded integer output limit are checked before provider I/O.
A lower positive integer survives. callWithPolicy forces retries:1 after its
option spread. The default production composition uses the dedicated helper.
Length-terminal output is rejected before JSON parsing/validation and before
advancing the saved draft; clarification answers were already committed.
No binding, runtime context, VRAM reserve, think policy, web authority or SPEC
acceptance criteria change in this delta. No blocking defect found in that scope.

Fresh inert checks against the audited functions (original bytes except an
unrelated new cre-bridge export): workflow 46/46, lifecycle 158/158, model-use
27/27, gateway signal 7/7, typed model contract 31/31. Their negative cases cover
ordinary/copy/rebound tokens, wrong model/role/purpose/capability/format/prompt,
invalid limits, lower limits and parseable truncated JSON. Logs are siblings
spec6000-review-*.log and model-contract-remediation.log.

This source verdict permits measuring the original cookbook. It is not evidence
that 6000 output tokens or a 4096 context suffice, and does not accept M5/M6 or
any new remediation code. Any private 16384 calibration must remain a separately
identified diagnostic commit and must not activate a production profile.
