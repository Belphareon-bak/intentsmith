# Disposition of disputed `final` commit

Status: classification and current-tree resolution are machine-validated; Gate 0
verification is in progress.

Compared refs:

- parent: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`
- disputed input: `ffd21cf119865259ea1847af989acb24916bebe3`
- command: `git diff --name-status a7b90e3..ffd21cf`
- records classified: `225`

## Vocabulary

- `KEEP / REPLAY`: preserve the intended change; any subsequent hardening is
  recorded as a separate repair and must retain functional parity.
- `REBUILD / REPAIR`: preserve the product or test intent, but do not accept the
  exact patch until isolation, truthful exits, and focused verification are
  restored.
- `EXCLUDE / MOVE_OUTSIDE_PRODUCTION`: evidence or generated output stays outside the production tree; only sanitized metadata may be committed.
- `EXCLUDE / REMOVE_FOLLOWUP`: the path must not exist in the clean candidate. Because this branch starts at the parent, removal is implemented non-destructively by never replaying it.
- `UNRESOLVED / USER_DECISION`: requires an operator choice before activation. There are no diff paths in this state after the initial classification; remote incident-response choices remain separately recorded in `DECISIONS.md`.

## Summary

| Disposition / action | Records |
|---|---:|
| `EXCLUDE/MOVE_OUTSIDE_PRODUCTION` | 78 |
| `EXCLUDE/REMOVE_FOLLOWUP` | 13 |
| `KEEP/REPLAY` | 42 |
| `REBUILD/REPAIR` | 92 |
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
| `A` | `tests/e2e/200-s1-minic3-p1.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/201-s1-minic3-p2.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/202-s1-minic3-p3.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/203-s1-minic3-p4.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/204-s1-minic3-p5.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/205-s1-minic3-p6.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/206-s2-shopflow-p1.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/207-s2-shopflow-p2.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/208-s2-shopflow-p3.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/209-s2-shopflow-p4.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/21-model-upgrade.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/210-s2-shopflow-p5.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/211-s2-shopflow-p6.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/22-autonomy.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/220-e2e-suite-runner.js` | `REBUILD` | `REPAIR` | Keep suite orchestration intent, but redirect raw transcripts/state to ignored evidence storage and preserve truthful exits. |
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
| `A` | `tests/e2e/70-cre-intent-semantic.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/71-language-enforcement.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/72-followup-coherence.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/73-quality-gate-content.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/74-session-isolation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/75-expertise-behavioral.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/76-specialist-domain.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/77-project-context-injection.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/78-guard-rules.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/79-response-semantics.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/80-ws-semantic-events.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/81-conversation-lifecycle.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/82-cre-conflict-resolution.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/85-long-session-degradation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/86-code-semantic-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/87-security-injection.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/88-concurrent-load.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/89-response-usefulness.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/90-large-project-generation.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/91-multi-turn-project-build.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/92-code-analysis-depth.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/93-chat-response-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/94-long-conversation-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/95-code-generation-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/96-project-workflow-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/97-project-build-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/98-analysis-quality.e2e.js` | `REBUILD` | `REPAIR` | Preserve the intended E2E scenario, but rebuild its isolation, orchestration, registry metadata, and known false-green checks before activation. |
| `A` | `tests/e2e/QUALITY-REPORT.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated quality report; replace with bounded evidence metadata when rerun. |
| `A` | `tests/e2e/_e2e-state.js` | `REBUILD` | `REPAIR` | Preserve multi-phase state intent, but confine state to a private runner-owned root with safe IDs, atomic writes, and explicit cleanup. |
| `A` | `tests/e2e/_helpers.js` | `REBUILD` | `REPAIR` | Preserve shared E2E behavior, but rebuild endpoint ownership, request timeouts, resource cleanup, and private transcript storage. |
| `A` | `tests/e2e/_quality-evaluator.js` | `REBUILD` | `REPAIR` | Preserve deterministic quality scoring, but replace shell execution and loose temporary files with argv execution and owned cleanup. |
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

## Incident-response decisions outside this diff

The target GitHub repository was read-only verified as public on 2026-07-30. Visibility change, credential rotation, and history remediation are operator decisions (`P-001` through `P-003`); no remote setting or history was changed by this classification.
