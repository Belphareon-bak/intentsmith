# Disposition of disputed `final` commit

Status: all source-diff facts are recorded in a committed sanitized manifest
and validate offline. Sixteen records are evidence-backed `REPAIRED`, and 16
truthful model suites are `DEFERRED` behind concrete runtime prerequisites. The
validator deliberately remains red while 60 legacy `REBUILD/REPAIR` rows await
terminal closure under `D-018`.

Compared refs:

- parent: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`
- disputed input: `ffd21cf119865259ea1847af989acb24916bebe3`
- command: `git diff --name-status a7b90e3..ffd21cf`
- records classified: `225`

## Reproducible source manifest

`FINAL-COMMIT-DIFF-MANIFEST.json` is the committed source of truth for the
disputed Git range. It contains only repository identity, full source commit
IDs, change status, paths, blob IDs and file modes. It contains no file content,
runtime data, secrets or private values.

- schema: `intentsmith.c3-final-diff` version 1;
- base: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`;
- head: `ffd21cf119865259ea1847af989acb24916bebe3`;
- exact-renames diff: 185 additions, 0 deletions, 24 modifications, 16 renames;
- records digest:
  `aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e`.

The normal command is offline and does not need either C3 commit object:

```bash
node scripts/validate-final-disposition.js
```

An optional no-fetch corroboration against an available C3 checkout is:

```bash
node scripts/validate-final-disposition.js \
  --source-repo=/path/to/C3-agent
```

## Vocabulary

- `KEEP / REPLAY`: preserve the intended change; any subsequent hardening is
  recorded as a separate repair and must retain functional parity.
- `REBUILD / REPAIR`: preserve the product or test intent, but do not accept the
  exact patch until isolation, truthful exits, and focused verification are
  restored.

  `REBUILD` is a condition on acceptance, not an instruction to rewrite a file.
  It has three terminal states, and a record is not closed until it reaches one
  of them. Collapsing them loses the distinction between a suite whose
  assertions are provably wrong (costs work) and one that merely cannot run here
  (costs hardware), which makes the remaining effort unplannable:

  | Terminal state | Meaning |
  |---|---|
  | `REBUILD/ACCEPTED` | isolation restored, exits truthful, executed at a named commit with artifacts |
  | `REBUILD/DEFERRED(<prerequisite>)` | isolation restored and exits truthful, but execution is blocked on a specific named prerequisite (GPU, Ollama, owned server, operator fixture). Closed, not pending. |
  | `REBUILD/REPAIRED` | the assertions themselves were defective and were corrected; requires its own before/after evidence |

  `REBUILD/DEFERRED` MUST name the missing capability. A record still carrying
  bare `REBUILD/REPAIR` is one nobody has finished classifying, and is
  indistinguishable in a ledger from one nobody has looked at.
- `EXCLUDE / MOVE_OUTSIDE_PRODUCTION`: evidence or generated output stays outside the production tree; only sanitized metadata may be committed.
- `EXCLUDE / REMOVE_FOLLOWUP`: the path must not exist in the clean candidate. Because this branch starts at the parent, removal is implemented non-destructively by never replaying it.
- `UNRESOLVED / USER_DECISION`: requires an operator choice before activation. There are no diff paths in this state after the initial classification; remote incident-response choices remain separately recorded in `DECISIONS.md`.

## Summary

| Disposition / action | Records |
|---|---:|
| `EXCLUDE/MOVE_OUTSIDE_PRODUCTION` | 78 |
| `EXCLUDE/REMOVE_FOLLOWUP` | 13 |
| `KEEP/REPLAY` | 42 |
| `REBUILD/REPAIR` | 90 |
| `REBUILD/REPAIRED` | 2 |
| `UNRESOLVED / USER_DECISION` | 0 |

## Path-by-path classification

| Git status | Path | Disposition | Action | Evidence-based rationale |
|---|---|---|---|---|
| `A` | `.c3-backend.log.old` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime log; no production source value and may contain operational data. |
| `M` | `CLAUDE.md` | `REBUILD` | `REPAIR` | Product documentation was overwritten or made inconsistent; reconstruct from valid history plus verified newer facts. |
| `M` | `README.md` | `REBUILD` | `REPAIR` | Product documentation was overwritten or made inconsistent; reconstruct from valid history plus verified newer facts. |
| `A` | `data/c3-recovered.sql` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime database, recovery, or backup artifact; potentially private and never replayed. |
| `A` | `data/c3.db.bak-1775936499219` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime database, recovery, or backup artifact; potentially private and never replayed. |
| `A` | `data/c3.db.corrupt-backup-20260325-132735` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime database, recovery, or backup artifact; potentially private and never replayed. |
| `A` | `data/c3.db.corrupt-backup-20260412` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime database, recovery, or backup artifact; potentially private and never replayed. |
| `A` | `data/c3.db.malformed` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime database, recovery, or backup artifact; potentially private and never replayed. |
| `A` | `data/c3.db.pre-recover` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime database, recovery, or backup artifact; potentially private and never replayed. |
| `A` | `e2e-review/P1-Alchymista/ARCHITECTURE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/KONVERZACE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/README.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/ROADMAP.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/app.py` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/database.db` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/models.py` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/models/potion.py` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/requirements.txt` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P1-Alchymista/tests/test_potions.py` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/ARCHITECTURE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/KONVERZACE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/README.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/ROADMAP.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/cli/game.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/cli/views/menu.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/cli_interface.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/cmd/trivia/game.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/cmd/trivia/main.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/db/bolt_init.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/db/leaderboard.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/internal/game/game_test.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/main.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/models/player.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/models/question.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/models/session.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/question_loader.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/session_manager.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P2-QuizMaster/utils/filter.go` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/ARCHITECTURE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/KONVERZACE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/README.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/ROADMAP.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/api/upload-photo.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/components/DrawingCanvas.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/components/EmojiPicker.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/components/PINInput.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/components/PhotoUpload.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/database/db.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/routes/__layout.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/routes/api/auth/+page.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/routes/api/data/+page.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/routes/login/+page.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/routes/main/+page.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/routes/write/+page.svelte` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/src/utils/image-resizer.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P3-DetskyDenik/test/end-to-end/entry.test.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/ARCHITECTURE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/KONVERZACE.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/README.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/ROADMAP.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/config/database.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/db/schema.sql` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/docs/apiDocumentation.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/package.json` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/app.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/controllers/state.controller.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/database/db.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/db.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/models/pdfModel.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/models/state.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/routes/index.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/routes/pdfRoutes.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/routes/resumeRoutes.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/routes/resumes.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/routes/upload.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/server.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/services/pdf.service.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/services/pdfService.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/src/services/state.service.ts` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/test/e2e/end-to-end.test.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/test/integration/pdfRoutes.test.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/P4-ResumeBot/test/unit/pdfService.test.js` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/README.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `e2e-review/RUN3-full-log.txt` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated E2E project/evidence; retained only in disputed history, not production tree. |
| `A` | `login.html` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Generated project output leaked into repository root; not C3 product source. |
| `M` | `package-lock.json` | `REBUILD` | `REPAIR` | Preserve useful scripts/dependency intent, but repair product metadata, incomplete registries, and tree-sitter peer conflict. |
| `M` | `package.json` | `REBUILD` | `REPAIR` | Preserve useful scripts/dependency intent, but repair product metadata, incomplete registries, and tree-sitter peer conflict. |
| `M` | `src/chat/context-compact.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/chat/cre-decision.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/chat/handlers/decisions.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/config.js` | `REBUILD` | `REPAIR` | Preserve long-running model/runtime intent, but replace unbounded timeout behavior with explicit bounded policy and tests. |
| `M` | `src/db/database.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/llm/gateway.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `A` | `src/llm/model-ctx.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/media/vram-manager.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/architecture-check.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/execution-loop.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/lifecycle-planning.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/milestone-decomposer.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/quality-gate.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/server.js` | `REBUILD` | `REPAIR` | Preserve long-running model/runtime intent, but replace unbounded timeout behavior with explicit bounded policy and tests. |
| `M` | `src/upgrade/online-discovery.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/upgrade/registry-client.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `A` | `templates/admin/dashboard.html` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Generated project output leaked into repository root; not C3 product source. |
| `A` | `templates/products/detail.html` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Generated project output leaked into repository root; not C3 product source. |
| `A` | `test-reports/cycle-0001-1774616641097.json` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated run output; only sanitized summaries belong in Gate evidence. |
| `A` | `tests/TEST-INVENTORY.md` | `REBUILD` | `REPAIR` | Inventory/status is stale or incomplete; regenerate from filesystem and recorded command evidence. |
| `A` | `tests/TEST-REGISTRY.md` | `REBUILD` | `REPAIR` | Inventory/status is stale or incomplete; regenerate from filesystem and recorded command evidence. |
| `R100` | `tests/LIFECYCLE_E2E_REPORT.txt -> tests/_legacy/LIFECYCLE_E2E_REPORT.txt` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/PROJECT-LIFECYCLE-E2E-PLAN.md -> tests/_legacy/PROJECT-LIFECYCLE-E2E-PLAN.md` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `A` | `tests/_legacy/README.md` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/benchmark.cjs -> tests/_legacy/benchmark.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/e2e-llm-validation.cjs -> tests/_legacy/e2e-llm-validation.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `A` | `tests/_legacy/e2e-loop.js` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/e2e-quality-deep.cjs -> tests/_legacy/e2e-quality-deep.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/p5-scoring-simulation.js -> tests/_legacy/p5-scoring-simulation.js` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/packages/c3-backend -> tests/_legacy/packages/c3-backend` | `REBUILD` | `REPAIR` | Preserve the historical WS-backend reference, but replace the machine-local absolute symlink with portable `tests/_legacy/packages/c3-backend.md`. |
| `R100` | `tests/phase-c.test.cjs -> tests/_legacy/phase-c.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/phase-f.test.cjs -> tests/_legacy/phase-f.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/run-all-expertise-e2e.sh -> tests/_legacy/run-all-expertise-e2e.sh` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/scenarios.cjs -> tests/_legacy/scenarios.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/search-stress.cjs -> tests/_legacy/search-stress.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint4.test.cjs -> tests/_legacy/sprints/sprint4.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint5.test.cjs -> tests/_legacy/sprints/sprint5.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint6.test.cjs -> tests/_legacy/sprints/sprint6.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint7.test.cjs -> tests/_legacy/sprints/sprint7.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `A` | `tests/artifact-validation.test.js` | `REBUILD` | `REPAIR` | Assertions are useful, but copied validator logic can false-green; test production implementation instead. |
| `A` | `tests/e2e-transcript-all-2026-04-13.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated transcript with potential conversation-derived content; never replayed. |
| `A` | `tests/e2e/01-health-smoke.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/02-chat-api.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/03-conversations.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/04-projects.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/05-attachments.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/06-expertises.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/07-specialists.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/08-agents.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/09-skills.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/10-marketplace.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/11-memory.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/12-notifications.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/13-security.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/14-system.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/15-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/16-setup-wizard.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/17-export.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/18-websocket.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/19-rate-limit.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/20-security-hardening.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/200-s1-minic3-p1.e2e.js` | `REBUILD` | `REPAIRED` | S1 P1 now evaluates all original terminal thresholds before persisting completion. The registered helper self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` verifies assertion → completion → save ordering, exit 0. |
| `A` | `tests/e2e/201-s1-minic3-p2.e2e.js` | `REBUILD` | `REPAIRED` | S1 P2 now evaluates pass-count and code-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/202-s1-minic3-p3.e2e.js` | `REBUILD` | `REPAIRED` | S1 P3 now evaluates pass-count and code-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/203-s1-minic3-p4.e2e.js` | `REBUILD` | `REPAIRED` | S1 P4 now evaluates pass-count and code-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/204-s1-minic3-p5.e2e.js` | `REBUILD` | `REPAIRED` | S1 P5 now evaluates pass-count and test-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/205-s1-minic3-p6.e2e.js` | `REBUILD` | `REPAIRED` | S1 P6 asserts before completion, performs both cleanups in `finally`, and saves only after successful assertion and cleanup. The registered self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/206-s2-shopflow-p1.e2e.js` | `REBUILD` | `REPAIRED` | S2 P1 now evaluates pass-count, plan-score and web-search thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/207-s2-shopflow-p2.e2e.js` | `REBUILD` | `REPAIRED` | S2 P2 now evaluates pass-count and code-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/208-s2-shopflow-p3.e2e.js` | `REBUILD` | `REPAIRED` | S2 P3 now evaluates pass-count and code-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/209-s2-shopflow-p4.e2e.js` | `REBUILD` | `REPAIRED` | S2 P4 now evaluates pass-count and template-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/21-model-upgrade.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/210-s2-shopflow-p5.e2e.js` | `REBUILD` | `REPAIRED` | S2 P5 now evaluates pass-count and test-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/211-s2-shopflow-p6.e2e.js` | `REBUILD` | `REPAIRED` | S2 P6 asserts before completion, performs both cleanups in `finally`, and saves only after successful assertion and cleanup. The registered self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/22-autonomy.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/220-e2e-suite-runner.js` | `REBUILD` | `REPAIRED` | The runner uses private run-owned storage, defaults to clean state, derives the exact Git HEAD, records it in schema-v2 evidence and forwards it to phases; full execution rejects a dirty tree. Its self-check at `343c19f9354c87a0154baf695f9351221c7722c8` reported `SELF_CHECK_PASS`, exit 0. |
| `A` | `tests/e2e/23-feedback.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/24-drafts.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/25-features.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/50-chat-conversation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/51-cre-classification.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/52-chat-quality-gate.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/53-long-conversation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/54-chat-with-expertise.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/55-chat-with-specialist.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/56-chat-with-project.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/57-lifecycle-full.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/58-code-generation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/59-cross-feature.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/60-ws-chat.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/61-autocomplete.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/62-validation-suites.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/63-agent-execution.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/70-cre-intent-semantic.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Source is fail-closed through the strict positive chat helper (including exact 200); execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/71-language-enforcement.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Language assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/72-followup-coherence.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Follow-up assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/73-quality-gate-content.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Quality-gate assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/74-session-isolation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Session-isolation assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/75-expertise-behavioral.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/76-specialist-domain.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/77-project-context-injection.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/78-guard-rules.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/79-response-semantics.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Response-semantic assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/80-ws-semantic-events.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/81-conversation-lifecycle.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/82-cre-conflict-resolution.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | CRE conflict assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/85-long-session-degradation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Long-session assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/86-code-semantic-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/87-security-injection.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Injection assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/88-concurrent-load.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/89-response-usefulness.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Usefulness assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/90-large-project-generation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/91-multi-turn-project-build.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/92-code-analysis-depth.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Code-analysis assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/93-chat-response-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Response-quality assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/94-long-conversation-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/95-code-generation-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Code-generation assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/96-project-workflow-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Project-workflow assertions are fail-closed through the strict positive chat helper and owned temp cleanup; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/97-project-build-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Project-build assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/98-analysis-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Analysis-quality assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/QUALITY-REPORT.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated quality report; replace with bounded evidence metadata when rerun. |
| `A` | `tests/e2e/_e2e-state.js` | `REBUILD` | `REPAIRED` | State is private and atomic, schema-versioned and bound to suite plus exact source SHA; corrupt, mismatched and non-contiguous state is rejected. The focused helper self-check at `343c19f9354c87a0154baf695f9351221c7722c8` exited 0. |
| `A` | `tests/e2e/_helpers.js` | `REBUILD` | `REPAIRED` | Endpoint ownership, bounded requests and private cleanup are rebuilt. At `c0471924d7a445c4be0d9256c06154bd970f53f8`, both conversation creators reject HTTP 500 and missing IDs, while positive chat helpers reject non-200 and empty responses; focused self-check exit 0. |
| `A` | `tests/e2e/_quality-evaluator.js` | `REBUILD` | `REPAIRED` | Syntax checks use argv execution and a `makeOwnedTempDir()` fixture with owned cleanup rather than shared `/tmp`. The focused helper self-check at `7ad7145360d927d164eb85d2e732cdfa20c6fd81` proves valid/invalid syntax discrimination and no surviving fixture, exit 0. |
| `A` | `tests/e2e/_test-fixtures.js` | `KEEP` | `REPLAY` | Legitimate E2E test/fixture; register by prerequisites and do not count as deterministic release proof until run. |
| `A` | `tests/intent-classifier.test.js` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Confirmed generated/save-response contamination, not executable C3 test source. |
| `M` | `tests/lifecycle-conversation-e2e.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `M` | `tests/online-discovery.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `A` | `tests/p5-only.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `A` | `tests/project-conversation-e2e-v2.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `M` | `tests/project-e2e-v131.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `A` | `tests/project-lifecycle-entry.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `M` | `tests/project-lifecycle-happy-path.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `M` | `tests/project-lifecycle-interrupts.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `A` | `tests/proposal-stale-cleanup.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `A` | `tests/smoke.test.js` | `KEEP` | `REPLAY` | Legitimate test intent/change; replay and verify without weakening assertions. |
| `A` | `tests/test_auth.py` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Confirmed generated/save-response contamination, not executable C3 test source. |
| `A` | `tests/test_models.py` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Confirmed generated/save-response contamination, not executable C3 test source. |

## D-018 terminal evidence

| Candidate | Records | Command | Exit | Result |
|---|---|---|---:|---|
| `7ad7145360d927d164eb85d2e732cdfa20c6fd81` | `tests/e2e/_helpers.js`, `tests/e2e/_quality-evaluator.js` | `node tests/e2e/_helpers.self-check.js` | 0 | missing ID and HTTP 500 rejected; nested ID accepted; syntax fixture owned and removed |
| `343c19f9354c87a0154baf695f9351221c7722c8` | `tests/e2e/_e2e-state.js` | `node tests/e2e/_helpers.self-check.js` | 0 | missing, stale, corrupt, schema-mismatched and non-contiguous state rejected; exact source SHA preserved |
| `343c19f9354c87a0154baf695f9351221c7722c8` | `tests/e2e/220-e2e-suite-runner.js` | `INTENTSMITH_TEST_ARTIFACT_DIR=$REPO/.intentsmith-artifacts/220-self-check node tests/e2e/220-e2e-suite-runner.js --self-check` | 0 | schema 2 report recorded the candidate SHA, clean-state default and zero cleanup errors; final status `SELF_CHECK_PASS` |
| `452b1f7688e7624d30b81daabcb0be3b18a64cd0` | `tests/e2e/200-s1-minic3-p1.e2e.js` … `tests/e2e/211-s2-shopflow-p6.e2e.js` | `node tests/e2e/_helpers.self-check.js` | 0 | all 12 source contracts preserve terminal thresholds before completion/save; both P6 cleanup paths are protected by `finally` |
| `c0471924d7a445c4be0d9256c06154bd970f53f8` | `tests/e2e/_helpers.js` | `node tests/e2e/_helpers.self-check.js` | 0 | negative fixtures rejected HTTP 202/500, absent IDs and empty responses; positive exact-200 and valid-ID fixtures passed |
| `c0471924d7a445c4be0d9256c06154bd970f53f8` | model suites `70–74`, `79`, `82`, `85`, `87`, `89`, `92`, `93`, `95–98` | `node --check <each of the 16 listed files>` | 0 | syntax valid; static inspection found no bare early-return, accepted 5xx or assertion bypass, so execution alone is deferred to the named model fixture |

## Incident-response decisions outside this diff

The target GitHub repository was read-only verified as public on 2026-07-30. Visibility change, credential rotation, and history remediation are operator decisions (`P-001` through `P-003`); no remote setting or history was changed by this classification.
