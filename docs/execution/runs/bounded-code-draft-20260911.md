# Bounded CODE draft — production-readiness follow-up

Status: **IMPLEMENTED_CANDIDATE / DETERMINISTIC_PASS / PHYSICAL_SINGLE_FILE_PASS /
CURRENT_MODEL_RECHECK_BLOCKED / REVIEW_REQUIRED**. This is not M6 acceptance or a production release.

Authority: the operator's request to continue toward production readiness,
PRODUCT §3, and the [bounded assignment](../../wp/WP-BOUNDED-CODE-DRAFT-20260911.md).
Input `a1f59d4fa2315b10bdf357df6c8bb973e9295978`; final implementation and
inventory source `5424f867d24d0d2bded20541e57b7ccdc657f9bc`.
One writer in `work/audit-remediation-20260911`, the existing audit checkout.

## User-visible result

In Studio, `/m2-draft src/app.js :: describe the small change` creates a model
proposal for one explicit file. Studio displays the entire before/after content,
the focused test and existing exact approval binding. `/m2-approve` invokes the
accepted M2 lifecycle; `/m2-cancel` also interrupts an active draft request.
An incomplete preview cannot become a pending approval.

The model supplies only `afterContent`. The caller owns the target path and
optional focused test; the model cannot select another path, test, Git identity
or approval. Preparation uses the existing strict proposal compiler, governance,
ProjectChange runtime and durable terminal. The old WorkflowOrchestrator and
legacy lifecycle mutation routes remain outside this execution path.

The adapter requires an active registered Git project with an existing valid M2
governance policy. Initial scope is `.js`, `.mjs` and `.cjs`; existing target
content is at most 1600 bytes, the instruction at most 512 bytes, and the total
serialized prompt plus system text at most 2200 bytes. One CODE request uses
1536 output tokens and a 120-second deadline within the unchanged 4096 production
profile. Only a complete `stop` result with exact JSON keys is accepted.
Cancellation, root/revision drift, excluded paths, hardlinks, malformed output,
unchanged output and extra model keys do not create a plan.

The default focused test compiles JavaScript without evaluating or linking it.
It uses the running Node binary and the existing argv-only M2 process sandbox.
Node 22 automatic module detection proved insufficient for `--check`: malformed
code could return exit zero. The fixed parser rejects that case and handles CJS
hashbangs. Studio explicitly labels the default as **syntax only**. Functional
correctness requires an explicit focused behaviour test; the model demonstration
below supplies one independently of the generated code.

## Verification

| Evidence | Exact source | Result |
|---|---|---|
| Full offline/database audit | `5424f867` | **353 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**, 18:46:07–18:51:56 UTC |
| Production lifecycle service, SQLite, temp Git and process sandbox | `9e0bb04a` | 20 cases PASS, including successful change, syntax failure with rollback, no model/code execution before its authority, stale/cancel/schema rejection |
| Route tests / executable Studio consumer tests | Included in full `5424f867` audit | 13 / 11 cases PASS; includes HTTP-disconnect cancellation and visible content before exact approval |
| Actual isolated backend HTTP lifecycle program | `9e0bb04a` | PASS; includes the new draft endpoint rejecting traversal before inference, plus the existing prepare/approve/test/Git journey |
| Studio production webpack build | Product bytes at `9e0bb04a` | PASS, generated M1 consumer verification PASS |
| Actual Electron boundary / M1 journey | `5424f867` | **2/2 PASS**; production-backend boundary and controlled M1 fixture remain separate claims; private Xvfb stopped, source clean |
| Actual CODE generation and M2 execution | `782ed681`, prior dependency installation | **PASS**, described below |
| Repeat with current dependency installation | `5424f867` | **BLOCKED before inference** by changed shared model inventory; foreign GPU workload then observed |

The physical run used exact `qwen3.5:27b`, provider
`0.32.14-intentsmith.1`, response digest
`7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e`.
Raw `/api/chat` bytes show **num_ctx 4096, num_predict 1536, 138 input tokens,
68 output tokens, done_reason stop**. There was one inference, no retry.

It repaired `isLeapYear` in `src/calendar.mjs`. Before explicit approval the
original file was byte-identical. After approval the real M2 sandbox executed
six Gregorian-year assertions: 1900, 2000, 2024, 2023, 2100 and 2400. All passed;
the durable lifecycle result was `succeeded`. Reconstructing the application
service returned the same terminal digest without another inference or write.
The project registry and operator subject are isolated fixtures; this is a
production-service/model/execution proof, not a combined Studio-to-model journey
or full process-restart test. The later product delta only fixes the default CJS
syntax-check program; this physical case supplied its own behaviour test.
A subsequent package-version check also found older `ws`, `nodemailer` and
`puppeteer` plus missing `ipaddr.js` in that diagnostic clone. The prior physical
PASS therefore is not proof of the final dependency installation. The existing
clone was synchronized with the updated installation: 170 installed package
versions match the current lockfile, with zero mismatches. The final-source
repeat at 18:57:29 UTC was rejected by the launcher's exact installed-manifest
guard before a provider request. A foreign `devstral-small-2:latest` workload
was then observed occupying the shared GPU. No guard was loosened and no foreign
process, model or binding was changed; this repeat remains **BLOCKED**.

Containment reused the exact reviewed v5 launcher. A small local wrapper selects
the new registered program; **that selection wrapper has not had independent
review**. Filesystem/relay/resource/inventory/cleanup code remains byte-identical.
The run had private DB/projects, read-only source, host-only raw capture, an
exact provider/model guard, and a bounded user cgroup. Its scope stopped and
source remained clean. No production bindings or database were changed.

## Preserved failures and scope limits

- Initial full audit on `782ed681`: **349 PASS / 3 FAIL / 1 TIMEOUT**. The three
  failures were the DB-bootstrap census (127→128), M6 model program census
  (44→45) and static desktop-route inventory. All were synchronized without
  weakening their safety checks. The tool-broker timeout did not reproduce in
  its unchanged 34-case direct rerun or the final full audit; its cause remains
  unproven and its original report is retained.
- First physical launcher attempt made **zero provider requests**: Git borrowed
  objects were outside the namespace. The existing diagnostic clone was made
  self-contained and connectivity checked; its prior diagnostic commits and
  evidence remain retained. The second attempt passed on the same source SHA.
- The model-generated multi-file cookbook, general large-file editing and the
  complete project builder remain open. This adapter does not claim whole-project
  comprehension or semantic correctness from a syntax-only check.
- Independent review/integration, the remaining M6 matrix and M5 operational
  evidence are still required before release. No acceptance status was promoted.

## Evidence handoff

The local [evidence manifest](../../../.intentsmith-artifacts/bounded-code-draft-evidence.json)
binds 18 reports/logs/raw bodies to paths, byte lengths and SHA-256 values.
Manifest SHA-256:
`b0624c7dfc8ec18b3c2e4601bc055992c9b48162dcceaf8ee56457db14c5c30f`.
Final deterministic report SHA-256:
`f902c5211ad97dae794d6299ae1ada6cff160bc9aecf0b28a3b2ace258a5d396`.
The [local handoff](../../../.intentsmith-artifacts/bounded-code-draft-handoff.json)
records the final documentation commit and verified cumulative Git bundle.

Next implementation step: extend this same M2 proposal boundary to bounded
dependent changes across files, with explicit behaviour tests and revision-bound
context; do not restore the retired direct-write executor or treat LLM review
text as a successful build.
