# Model workspace: recovery after a managed backend restart

Status: **INSTALLED_RECOVERY_VERIFIED / REVIEW_PENDING**. Product source and
installed snapshot: `9f9ed33916a1062d4d28f4e2d2bd47aefd8e74b6`.
The operator's five screenshots reopen the previous workspace claim: the
already-open Studio could not load model data after the backend was updated.
The earlier scoring run proved inference, not this subsequent restart journey.

## Cause and change

The model panel captured its HTTP origin once at renderer startup. The managed
backend uses an ephemeral port and a new capability on each process start.
The separately bundled WS client rediscovered that address and reported a
successful reconnect; the panel's HTTP reads continued targeting the old port.
Source inspection, the running old Studio/new backend combination, and the
controlled restart reproduction support this cause. We did not capture private
network traffic from the operator's original window.

Every panel HTTP caller now resolves the current private endpoint. The existing
capability bootstrap and server authorization remain unchanged. A missing
private endpoint goes through the existing guarded relative transport, never a
guessed Electron port. Read generations discard late results from the disconnected
backend; successful reconnect refreshes model data without replaying mutations.

All seven model tabs distinguish an unavailable response from an empty result.
Roles no longer remain indefinitely loading after failure. Governor does not
convert a failed read into six UNKNOWN dimensions or empty recommendations.
Hunt/history do not infer zero actions from unavailable data. Each failed read
has an explicit retry. Existing successful UNKNOWN measurements remain UNKNOWN.

Physical negative testing also exposed a second defect in LLM settings: an HTTP
error object was accepted as a model array, and `.map` crashed the center pane.
Inventory now validates HTTP status and shape, and the model-management entry
remains available before inventory or bindings load.

## Scope and provenance

The latest installed project-flow source `5e46fca7` was imported and merged as
`ec906fe8` before editing. Product fixes are `9fde0de4` and `9f9ed339`.
`git diff 5e46fca7..9f9ed339 -- src` is empty. The only product file changed
relative to that installed baseline is the canonical Studio chat-panel JS.
Existing tests were extended or their VM endpoint fixtures updated; no new
connector, provider policy, model scorer, migration or binding writer was added.
The desktop snapshot retains project-flow changes and the PDF runtime setting.

## Verification

- Canonical desktop/hunt tests: **29/29 PASS**, including endpoint rotation,
  stale read suppression, HTTP-error recovery and invalid inventory rejection.
- M1 Studio client, M2 Studio surface, project collaboration, upgrade UX and
  model evaluation read-model/consolidation focused runs passed. Initial VM
  fixture failures after the endpoint helper changed are retained in evidence.
- Full offline/database run on `9f9ed339`: **357 PASS / 2 FAIL / 0 BLOCKED /
  0 TIMEOUT**. One FAIL was the documentation LOC census after adding tests;
  the source-derived count was corrected and artifact validation reran
  **160/160 PASS**. Combined coverage is **358 PASS / 1 inherited FAIL**, not a
  claim that the original full run was green. The remaining
  `IS-T1-TESTS-NIGHTLY-ORCHESTRATOR-SELF-TEST` reports registry hash drift from
  the reviewed Gate 0 policy; no seal or gate was weakened.
- Production Studio build passed in the checkout and in the clean detached
  installation. Both emitted bundle SHA-256
  `07581d673a09b9b8001710e6fc65d1414f5a47c5494715ba320d41c361bf685f`.
- Controlled real Electron: all **7 tabs** first received HTTP 503 and showed an
  error/retry rather than fabricated empty data; explicit Roles retry recovered.
  Each tab then remained open across its own backend process restart. All
  **7/7** recovered automatically with a different port and capability. Old
  capability requests with browser opaque-origin metadata were rejected **403**.
  No renderer reload was used. A second run against the detached installation
  also passed. These use a controlled backend fixture, private profile,
  `NODE_ENV=test`, current display and diagnostic `--no-sandbox`; they do not
  claim GPU inference or a fresh complete outbound census.
- **Installed production backend and real DB:** opened all 7 tabs, expanded CODE
  task details, cancelled the native New test confirmation with zero evaluation
  POSTs, then stopped/started the managed backend with the same Electron window
  open. PID `1035549 -> 1036930`, port `46299 -> 46135`, capability rotated;
  all **7/7 tabs** recovered. `NODE_ENV=production`; a private GUI profile and
  local CDP were used and closed at completion. Screenshots contain only the
  model workspace, not the operator's conversation.

Preserved non-PASS attempts: dirty-checkout audit refusal; an interrupted partial
audit after the additional settings crash was found; the first physical harness
failed to locate an index URL with a fragment; the next exposed the actual
settings crash; a later test asserted browser credential rejection without
browser origin metadata and was corrected to the actual opaque-origin boundary.
Initial detached build lacked nested workspace dependencies; supplying the
existing locked nested dependency trees produced a clean successful build.
None of these earlier attempts is relabelled PASS.

## Live preservation and remaining operator step

Checkpoint 2026-09-18 12:44:58 CEST: backend active, hunt timer enabled/active,
next tick 2026-09-19 03:03:38 CEST. Hashes of complete rows were unchanged for
**516 evaluations, 234 decisions, 7 desired bindings, 14 binding operations**.
SQLite quick_check is `ok`, foreign-key violations zero. No model inference,
pull, removal, binding change or recommendation approval was performed during
this transport repair. Foreign soak PID 15110 was left running.

The operator's original Studio process still has the old frontend loaded and
was preserved with its project and possible unsaved inputs. **Close that old
window after saving work, then reopen IntentSmith from the application icon.**
The icon points to the corrected clean installation; reloading the old window's
old release entrypoint would not load the new application. The new production
journey above used a separate window and is not claimed as a hot update of the
operator's original renderer.

Independent review is pending. The global release-seal failure is still open.
Evidence root: `/home/belphareon/Projects/coworker/intentsmith-model-reconnect-20260918`.

Evidence archive (private, mode 0600), 509 verified members including the
product source bundle, failed attempts, final receipts and cropped screenshots:
`/home/belphareon/Projects/coworker/intentsmith-model-reconnect-sha256-67e07ef601a880741d4d54963f6182cde791ce2b3d0f6427759ab43003c39fc0.tar.gz`.
SHA-256: `67e07ef601a880741d4d54963f6182cde791ce2b3d0f6427759ab43003c39fc0`.
The diagnostic scripts reuse the retained previous CDP harness from the
2026-09-18 model-workspace evidence root; these are current-host repeatable
journeys, not a new independently registered portable release harness.
The archive's review copy predates this checksum footer. The committed
[machine receipt](../execution/runs/model-workspace-reconnect-20260918.json)
binds the final archive and source.
