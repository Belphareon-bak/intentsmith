# Intent grounding: second review corrections

Authority: the operator's latest CHANGES_REQUIRED review in this session, findings 1–4. Input revision: `b4045668d571b6f6be8afb475de3f2e49e764366`; owned worktree and branch: `intentsmith-intent-resilience-20260928`, `work/intent-resilience-20260928`.

Deliverable: restrict prohibition checks to action interpretations and state-changing tools; preserve Czech negation anywhere in an action request; bind saved response content from the actual DB history and skip clarification/refusal responses; remove numeric/model-version file-lexer false positives. These corrections implement the operator's review, not new product requirements.

Owned paths: intent-clarity, CRE, response finalizer and ConversationStore history projection, existing grounding tests, census and review documentation. Existing M1/M2 contracts and approval authority apply. No model inference, foreign edits, deployment, push, or live settings change in this package.

Verification: pure boundary probes plus controlled ChatController.handle journeys using persisted conversation turns and the real file-write handler; read/search positive probes and effectful negative probes before the broker. Run the affected suites and registry/boundary/census checks. Run the offline,database audit from a clean source commit under bwrap --unshare-net, which isolates its child processes from the shared provider. Preserve all pre-existing FAIL/BLOCKED outcomes and report any regressions separately. Real classifier quality and latency remain NOT_RUN.

Handoff: reviewable commits and a new correction report with exact evidence identities. Successful tests do not constitute independent acceptance. The accepted memory audit remains a separate investigation; any operator-discretion settings decision must use the authoritative typed settings writer and receive its own evidence.
