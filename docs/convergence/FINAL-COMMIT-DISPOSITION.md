# Disposition of disputed `final` commit

Status: all source-diff facts are recorded in a committed sanitized manifest
and validate offline. All 92 `REBUILD` records have a terminal D-018 state:
60 are evidence-backed `REPAIRED`, and 32 truthful model suites are `DEFERRED`
behind concrete runtime prerequisites.

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

The prose ledger does not make mutable content-identity assertions about an
older candidate. `FINAL-COMMIT-DISPOSITION-SUBJECTS.json` binds every one of
the 60 `REBUILD/REPAIRED` rows to its current candidate path, Git blob, file
mode, source-manifest sequence and exact rationale digest.
`validate-final-disposition.js` recomputes those values from the worktree,
requires the document, sidecar and every repaired subject to match tracked
`HEAD`, and refuses missing, duplicate, stale, reordered or structurally
unknown subject records before Gate 0 can be green.

- schema: `intentsmith.c3-final-diff` version 1;
- base: `a7b90e36aa80310305703f54f2332e1c0e7f9e8f`;
- head: `ffd21cf119865259ea1847af989acb24916bebe3`;
- exact-renames diff: 185 additions, 0 deletions, 24 modifications, 16 renames;
- records digest:
  `aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e`.
- repaired-subject schema: `REBUILD/REPAIRED` version 1, exactly 60 sanitized
  records; its canonical tuple digest is recomputed independently from both
  the committed sidecar and the structured validator paths.

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
| `REBUILD/REPAIR` | 0 |
| `REBUILD/REPAIRED` | 60 |
| `REBUILD/DEFERRED(<prerequisite>)` | 32 |
| `UNRESOLVED / USER_DECISION` | 0 |

## Path-by-path classification

| Git status | Path | Disposition | Action | Evidence-based rationale |
|---|---|---|---|---|
| `A` | `.c3-backend.log.old` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Runtime log; no production source value and may contain operational data. |
| `M` | `CLAUDE.md` | `REBUILD` | `REPAIRED` | Overwritten product guidance was reconstructed in `b860ae96d8f333acfa61724ba8065740059995d6` and aligned to the complete registry in `af539dccbb420ac32aed5e095eb6d69bc4ffcc37`; `1a0b77946de0af7f195040d512c2a350e259a541` later synchronized the documented tool inventory with the fail-closed npm-audit repair. The current inventory is exactly 3 JavaScript files and 5,694 lines, and the document is protected by the registered artifact-validation suite. |
| `M` | `README.md` | `REBUILD` | `REPAIRED` | Product status and test claims were reconstructed in `b860ae96d8f333acfa61724ba8065740059995d6` and aligned in `af539dccbb420ac32aed5e095eb6d69bc4ffcc37`; `bae8106d0c137437162c05b03d441d7824a888b1` later refreshed the exact registry state to 350 programs: 256 `ACTIVE`, 79 `BLOCKED`, 0 `KNOWN_DEFECTIVE` and 15 `HISTORICAL`. The current document is protected by the registered artifact-validation suite. |
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
| `M` | `package-lock.json` | `REBUILD` | `REPAIRED` | The lockfile peer conflict is repaired. Candidate `82dbc3b30ad0c7329182dbe399705d874b004f2e` completed two consecutive isolated minimal installs, both exit 0; the generated baseline records their commands and log hashes. Current blob and mode resolution comes from the disposition validator report. |
| `M` | `package.json` | `REBUILD` | `REPAIRED` | Product metadata and dependency intent are repaired. Candidate `82dbc3b30ad0c7329182dbe399705d874b004f2e` completed two consecutive isolated minimal installs, both exit 0; the generated baseline records their commands and log hashes. Current blob and mode resolution comes from the disposition validator report. |
| `M` | `src/chat/context-compact.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/chat/cre-decision.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/chat/handlers/decisions.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/config.js` | `REBUILD` | `REPAIRED` | Unbounded runtime timeouts were replaced by the explicit bounded policy in `de3eaf6c3e2004b8f69d63affe65e79b63b6aaab`; `968d6d366d5c5d0e8dfd1e3214448907d0f89348` later removed the implicit operator-database fallback. `GATE0-G0-R012-EVIDENCE.md` records positive, negative and mutation coverage for the explicit database contract, and the complete deterministic run covers the current repair. |
| `M` | `src/db/database.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/llm/gateway.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `A` | `src/llm/model-ctx.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/media/vram-manager.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/architecture-check.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/execution-loop.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/lifecycle-planning.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/milestone-decomposer.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/planner/quality-gate.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/server.js` | `REBUILD` | `REPAIRED` | Bounded timeout policy and centralized mutable model lifecycle were wired by `de3eaf6c3e2004b8f69d63affe65e79b63b6aaab` and `7d3e465033e37ad147f7fad806b09d523bac3eda`; later repairs drain oversized bodies before the exact 413 response (`e8ddb7cade47f1c895fda1b14137081d452b9d2a`), write private symlink-safe port files (`8e6cd4147dd154d28212a5c8e9be271d4b8b367c`), establish the explicit runtime database bootstrap (`968d6d366d5c5d0e8dfd1e3214448907d0f89348`) and bind the attachment capability nonce (`ab0b9e5601cf8256684304832cedb326f1015ef2`). `fab974eda32bcdb62941f91d697600af1bdbedcb` pins the nonce wiring by positive and mutation tests. Live E2E 18–20 remain honestly T3/`BLOCKED`; they are not claimed green. |
| `M` | `src/upgrade/online-discovery.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `M` | `src/upgrade/registry-client.js` | `KEEP` | `REPLAY` | Coherent intended product change; replay exactly first, then require focused and regression verification. |
| `A` | `templates/admin/dashboard.html` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Generated project output leaked into repository root; not C3 product source. |
| `A` | `templates/products/detail.html` | `EXCLUDE` | `REMOVE_FOLLOWUP` | Generated project output leaked into repository root; not C3 product source. |
| `A` | `test-reports/cycle-0001-1774616641097.json` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated run output; only sanitized summaries belong in Gate evidence. |
| `A` | `tests/TEST-INVENTORY.md` | `REBUILD` | `REPAIRED` | The stale prose inventory is replaced by mapped `tests/registry.json`; current validation discovers and validates 350 runnable programs with registry SHA-256 `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`, exit 0. |
| `A` | `tests/TEST-REGISTRY.md` | `REBUILD` | `REPAIRED` | The stale location is replaced by generated `docs/convergence/TEST-REGISTRY.md`; `node scripts/validate-test-registry.js` validates its mapping to all 350 runnable programs, exit 0. |
| `R100` | `tests/LIFECYCLE_E2E_REPORT.txt -> tests/_legacy/LIFECYCLE_E2E_REPORT.txt` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/PROJECT-LIFECYCLE-E2E-PLAN.md -> tests/_legacy/PROJECT-LIFECYCLE-E2E-PLAN.md` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `A` | `tests/_legacy/README.md` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/benchmark.cjs -> tests/_legacy/benchmark.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/e2e-llm-validation.cjs -> tests/_legacy/e2e-llm-validation.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `A` | `tests/_legacy/e2e-loop.js` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/e2e-quality-deep.cjs -> tests/_legacy/e2e-quality-deep.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/p5-scoring-simulation.js -> tests/_legacy/p5-scoring-simulation.js` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/packages/c3-backend -> tests/_legacy/packages/c3-backend` | `REBUILD` | `REPAIRED` | The machine-local absolute symlink is absent and mapped to portable explanatory `tests/_legacy/packages/c3-backend.md`; the disposition resolver reports `MAPPED_REPAIR`, and tracked-symlink validation finds no unsafe replacement. |
| `R100` | `tests/phase-c.test.cjs -> tests/_legacy/phase-c.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/phase-f.test.cjs -> tests/_legacy/phase-f.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/run-all-expertise-e2e.sh -> tests/_legacy/run-all-expertise-e2e.sh` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/scenarios.cjs -> tests/_legacy/scenarios.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/search-stress.cjs -> tests/_legacy/search-stress.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint4.test.cjs -> tests/_legacy/sprints/sprint4.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint5.test.cjs -> tests/_legacy/sprints/sprint5.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint6.test.cjs -> tests/_legacy/sprints/sprint6.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `R100` | `tests/sprints/sprint7.test.cjs -> tests/_legacy/sprints/sprint7.test.cjs` | `KEEP` | `REPLAY` | Intentional legacy-test relocation/reference; preserves historical assets outside active registry. |
| `A` | `tests/artifact-validation.test.js` | `REBUILD` | `REPAIRED` | Snapshot prose was replaced by executable artifact, manifest, D-018, risk-policy, verdict and evidence-portability assertions against production validators. The registered suite also derives root `README.md` state counts from `tests/registry.json`, derives the root `CLAUDE.md` tool inventory from current JavaScript sources, and rejects count drift. Its current exact exit and output hash are captured by the generated Gate 0 evidence. |
| `A` | `tests/e2e-transcript-all-2026-04-13.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated transcript with potential conversation-derived content; never replayed. |
| `A` | `tests/e2e/01-health-smoke.e2e.js` | `REBUILD` | `REPAIRED` | Every health, system and license request now asserts exact HTTP 200 before inspecting content; current syntax and the 53-assertion route regression passed at `ec19fa4f603859cd7785bd508ab2c258b4b395b9`. |
| `A` | `tests/e2e/02-chat-api.e2e.js` | `REBUILD` | `REPAIRED` | Ambiguous 200/204 and 400/404 branches were replaced with current exact route contracts; current syntax and the 53-assertion route regression passed at `ec19fa4f603859cd7785bd508ab2c258b4b395b9`. |
| `A` | `tests/e2e/03-conversations.e2e.js` | `REBUILD` | `REPAIRED` | CRUD now asserts each exact status, including the documented empty-message-list response, without conditional assertion paths; syntax passed at `06d49847988ae3fb65711fe6bf737c08c0e3ac0c`. |
| `A` | `tests/e2e/04-projects.e2e.js` | `REBUILD` | `REPAIRED` | Project creation, CRUD state transitions and open-folder registration now require exact route contracts; nonexistent-project checks use a numeric route-compatible fixture and all writes remain runner-owned. |
| `A` | `tests/e2e/05-attachments.e2e.js` | `REBUILD` | `REPAIRED` | Every validation request now requires HTTP 400. Non-string messages are rejected before controller dispatch, proven by the current 53/53 deterministic route assertions at `ec19fa4f603859cd7785bd508ab2c258b4b395b9`. |
| `A` | `tests/e2e/06-expertises.e2e.js` | `REBUILD` | `REPAIRED` | Expertise CRUD and merge preview now assert exact current status and payload contracts, including the required `expertises` query parameter; conditional 200/204/400 acceptance was removed. |
| `A` | `tests/e2e/07-specialists.e2e.js` | `REBUILD` | `REPAIRED` | Lifecycle checks use the committed `dummy-logger` fixture, verify persisted disable/enable state and exact discovery, integrity, binding and telemetry payloads; disable now awaits loader completion before responding. |
| `A` | `tests/e2e/08-agents.e2e.js` | `REBUILD` | `REPAIRED` | Agent CRUD and dry-run use a schema-valid disabled fixture, require exact route contracts and perform no source fetch; the registry therefore records loopback rather than external-network access. |
| `A` | `tests/e2e/09-skills.e2e.js` | `REBUILD` | `REPAIRED` | Skill inventory, detail, reload and missing-execution state transitions now require exact current payloads and statuses without setup-dependent early returns. |
| `A` | `tests/e2e/10-marketplace.e2e.js` | `REBUILD` | `REPAIRED` | Catalog, refresh, installed-package and error-path checks now require exact route contracts without rate-limit or alternate-status bypasses; execution remains registry-blocked on its declared external catalog prerequisite. |
| `A` | `tests/e2e/11-memory.e2e.js` | `REBUILD` | `REPAIRED` | Memory and settings writes now require exact success responses and prove deterministic GET round-trips, including the persisted language setting. |
| `A` | `tests/e2e/12-notifications.e2e.js` | `REBUILD` | `REPAIRED` | Channel, configuration, validation, log and in-app notification checks now assert exact payloads; read-all forwards the optional agent query and the repository now performs filtered or global bulk-read updates, covered directly against SQLite. |
| `A` | `tests/e2e/13-security.e2e.js` | `REBUILD` | `REPAIRED` | Token setup is now mandatory for list/delete coverage, removing conditional success paths while preserving exact audit, webhook and session contracts. |
| `A` | `tests/e2e/14-system.e2e.js` | `REBUILD` | `REPAIRED` | GPU, system, storage, model, upgrade and validation routes now require exact payload contracts; invalid apply/rollback roles return 400 and dismissing a missing numeric proposal returns 404. The registry declares the loopback Ollama dependency without requiring a GPU. |
| `A` | `tests/e2e/15-quality.e2e.js` | `REBUILD` | `REPAIRED` | Summary, distribution, empty-project, volatility and text-report checks now assert their concrete schemas and statuses instead of accepting alternate empty responses. |
| `A` | `tests/e2e/16-setup-wizard.e2e.js` | `REBUILD` | `REPAIRED` | Setup now proves a reachable Ollama with all configured models, exact language/notification/license writes and a status round-trip; the registry records Ollama but no GPU prerequisite. |
| `A` | `tests/e2e/17-export.e2e.js` | `REBUILD` | `REPAIRED` | Export setup is mandatory and message-backed; missing, empty and unsupported requests now have exact 404/409/400 contracts, successful Markdown is downloaded and checked, and export/download share an artifact directory derived from the isolated database path. |
| `A` | `tests/e2e/18-websocket.e2e.js` | `REBUILD` | `REPAIRED` | Handshake rejection, pre-hello handling, ping/pong, concurrent clients and malformed text/binary frames now require exact observable protocol outcomes; timeout/error and unconditional-pass branches were removed. |
| `A` | `tests/e2e/19-rate-limit.e2e.js` | `REBUILD` | `REPAIRED` | Loopback transport checks now require exact security/referrer/CORS/content-type headers and exact 200/413 body-size behavior; request parsing drains oversized input and returns a response instead of destroying the socket. Network-bound rate limiting remains outside this loopback suite. |
| `A` | `tests/e2e/20-security-hardening.e2e.js` | `REBUILD` | `REPAIRED` | Traversal, inert shell/XSS/SQL payload round-trips, disclosure-safe errors and client header validation now assert exact statuses and stored values with owned cleanup, without accepted 5xx or unconditional success paths. |
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
| `A` | `tests/e2e/21-model-upgrade.e2e.js` | `REBUILD` | `REPAIRED` | Bindings, missing fields, invalid roles, absent rollback state, bound-model deletion and empty validation results now require exact synchronous contracts; unverifiable fire-and-forget upgrade/check calls were removed, so this control-plane suite no longer claims external/model prerequisites. |
| `A` | `tests/e2e/210-s2-shopflow-p5.e2e.js` | `REBUILD` | `REPAIRED` | S2 P5 now evaluates pass-count and test-score thresholds before persisting completion; the ordering self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/211-s2-shopflow-p6.e2e.js` | `REBUILD` | `REPAIRED` | S2 P6 asserts before completion, performs both cleanups in `finally`, and saves only after successful assertion and cleanup. The registered self-check at `452b1f7688e7624d30b81daabcb0be3b18a64cd0` exited 0. |
| `A` | `tests/e2e/22-autonomy.e2e.js` | `REBUILD` | `REPAIRED` | An autonomy-enabled owned server must return the full status shape and exact 404 responses for absent numeric improvement/alert IDs; acknowledging an absent alert now checks the update result instead of reporting false success. |
| `A` | `tests/e2e/220-e2e-suite-runner.js` | `REBUILD` | `REPAIRED` | The runner uses private run-owned storage, defaults to clean state, derives the exact Git HEAD, records it in schema-v2 evidence and forwards it to phases; full execution rejects a dirty tree. Its current self-check at `ec19fa4f603859cd7785bd508ab2c258b4b395b9` reported `SELF_CHECK_PASS`, exit 0, after the direct-run isolation bootstrap was added. |
| `A` | `tests/e2e/23-feedback.e2e.js` | `REBUILD` | `REPAIRED` | The suite now requires an exact 201 insert with a persisted category/message, an immediate exact 429 second submission, exact 404 attachment lookup and exact audit/list schemas; accepted 5xx and rate-limit early exits are gone. |
| `A` | `tests/e2e/24-drafts.e2e.js` | `REBUILD` | `REPAIRED` | Conversation creation is mandatory; save/load assert the exact draft content, DELETE sends the route's JSON body contract, and both unknown and deleted drafts must return null before owned cleanup. |
| `A` | `tests/e2e/25-features.e2e.js` | `REBUILD` | `REPAIRED` | A known feature is toggled and read back, reset to its captured default, and an unknown feature must return 400; short autocomplete and context estimation now use canonical payloads with exact model-free outputs, removing false Ollama/GPU prerequisites. |
| `A` | `tests/e2e/50-chat-conversation.e2e.js` | `REBUILD` | `REPAIRED` | Three bounded model turns now require exact 200 responses, topic/language semantics and exact persisted user/assistant pairs; missing conversations and failed prerequisite turns cannot pass later checks. The isolated post-commit run at `ab14c0ec7b891a8cbbdcccf1ab7bf018214a4293` reported 6 passed, 0 failed, exit 0. |
| `A` | `tests/e2e/51-cre-classification.e2e.js` | `REBUILD` | `DEFERRED(external-network+owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | All ten requests use supported canonical intents and exact 200/intent contracts; FACTUAL and SEARCH require a successful external tool result and REPORT requires search-backed synthesis. The source has no accepted 500 or dependent return, but its three live-data cases require the named external fixture. |
| `A` | `tests/e2e/52-chat-quality-gate.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Six independent owned conversations use bounded fail-closed chat calls and require non-empty, language-appropriate, topic-specific output without metadata, prompt or zombie-phrase leakage. Conditional response checks are gone; execution remains behind the named model fixture. |
| `A` | `tests/e2e/53-long-conversation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Ten bounded turns are mandatory before context, duration and exact twenty-message persistence checks. Failed turns no longer become skipped aggregate assertions; execution remains behind the named long-conversation model fixture. |
| `A` | `tests/e2e/54-chat-with-expertise.e2e.js` | `REBUILD` | `REPAIRED` | The legacy `/chat` route receives the complete server-provided expertise object, uses explicit owned session IDs and requires exact response, session expertise and lock state. The isolated post-commit run at `ab14c0ec7b891a8cbbdcccf1ab7bf018214a4293` reported 3 passed, 0 failed, exit 0. |
| `A` | `tests/e2e/55-chat-with-specialist.e2e.js` | `REBUILD` | `REPAIRED` | Selection, assignment, bounded interaction, session-state proof and clear all use the same explicit session ID; missing fixtures and alternate statuses cannot pass. The isolated post-commit run at `ab14c0ec7b891a8cbbdcccf1ab7bf018214a4293` reported 4 passed, 0 failed, exit 0. |
| `A` | `tests/e2e/56-chat-with-project.e2e.js` | `REBUILD` | `REPAIRED` | A runner-owned project and exact canary prove deterministic `FILE_READ` context, persisted project binding and isolation from an unbound `LOCAL` conversation. No model prose is accepted as proof. The isolated post-commit local-server run at `ab14c0ec7b891a8cbbdcccf1ab7bf018214a4293` reported 4 passed, 0 failed, exit 0. |
| `A` | `tests/e2e/57-lifecycle-full.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Project and conversation setup are mandatory and runner-owned; lifecycle handoff, phase and confirmation are exact, dependent returns are gone, and cleanup is unconditional. An isolated pre-commit diagnostic reached both model-free assertions but the lifecycle request timed out at 90 seconds (2 passed, 1 failed, 0 skipped), so no green model claim is made. |
| `A` | `tests/e2e/58-code-generation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Each request uses a mandatory owned conversation and fail-closed transport; Python, JavaScript and explanation outputs have substantive fenced-code/semantic assertions and unconditional cleanup. An isolated pre-commit diagnostic timed out all three model requests at 60 seconds (0 passed, 3 failed, 0 skipped), so execution remains behind the named model fixture. |
| `A` | `tests/e2e/59-cross-feature.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Expertise IDs resolve only through the server-owned canonical registry; the suite requires exact expertise session state, draft round-trip/delete and memory persistence with snapshot restoration. Its isolated pre-commit diagnostic proved the draft contract but timed out both model-backed checks (1 passed, 2 failed, 0 skipped), so no green model claim is made. |
| `A` | `tests/e2e/60-ws-chat.e2e.js` | `REBUILD` | `REPAIRED` | Tautological event and cancel checks were replaced with exact correlated WS envelopes, strictly increasing event sequence, explicit cancel acknowledgement, a cancelled terminal event, idle transition and proof that no assistant response escapes or persists after cancellation. Cancellation is canonicalized and propagates through the WS adapter, CRE classifier, LLM gateway and chat controller; negative regressions cover ordinary provider errors and the pre-persistence race. An isolated run with Ollama deliberately unreachable reported 3 passed, 0 failed, exit 0, proving the owned local-server prerequisite. |
| `A` | `tests/e2e/61-autocomplete.e2e.js` | `REBUILD` | `REPAIRED` | Alternate 400/502 responses and conditional suggestion assertions were removed. Short input must return exact 200/null, while both model-backed prefixes require exact 200 and non-empty strings within bounded time; an isolated candidate run reported all three assertions green. |
| `A` | `tests/e2e/62-validation-suites.e2e.js` | `REBUILD` | `REPAIRED` | The suite now binds only the exact CHAT model, requires a successful start, correlated starting/running/complete/done WS evidence, a non-zero score and all eight persisted validation results. Missing models, 500 responses, 404 results and absent progress can no longer pass; an isolated candidate run reported all four assertions green. |
| `A` | `tests/e2e/63-agent-execution.e2e.js` | `REBUILD` | `REPAIRED` | The former external URL/model payload was replaced by a schema-valid deterministic database-source dry-run fixture. Agent inventory, preview, missing-agent/execution errors and trust summary now have exact local-server contracts; an isolated run with Ollama deliberately unreachable reported 5 passed, 0 failed, exit 0, so the registry no longer declares external network, Ollama or GPU. |
| `A` | `tests/e2e/70-cre-intent-semantic.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Source is fail-closed through the strict positive chat helper (including exact 200); execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/71-language-enforcement.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Language assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/72-followup-coherence.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Follow-up assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/73-quality-gate-content.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Quality-gate assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/74-session-isolation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Session-isolation assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/75-expertise-behavioral.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | The suite requires the canonical `experts` response and writer/developer/analyst fixtures, uses bounded fail-closed chats, verifies exact expert mode and persisted server-owned expertise, and asserts GUARD 6 as `CREATIVE`; all optional fixture skips and the arbitrary legacy `/chat` expertise object check are gone. Execution remains behind the named model fixture. |
| `A` | `tests/e2e/76-specialist-domain.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Accountant and translator are mandatory installed fixtures; each specialist is set, queried, used and cleared on the exact conversation session, with exact 200/state/mode contracts and bounded model calls. Missing fixtures and alternate success/404 statuses no longer pass. |
| `A` | `tests/e2e/77-project-context-injection.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Project creation and canary files are confined to the verified runner-owned project root; bound and unbound conversations are mandatory, the server-derived session project is exact, canary isolation is asserted, and a project build request must expose exact `BUILD` intent. All dependent returns and tautological cleanup assertions are gone. |
| `A` | `tests/e2e/78-guard-rules.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | GUARD inputs use mandatory owned conversations/project fixtures and bounded chats; intent metadata is required, with exact `CREATIVE`, `CONVERSATIONAL`, `CONVERSATIONAL` and `BUILD` outcomes for GUARD 6/9/10/11. The incorrect explicit-search oracle, custom project path, fixture skips and conditional assertions are removed. |
| `A` | `tests/e2e/79-response-semantics.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | All ten requests are bounded and fail closed. Math and date require exact deterministic `LOCAL` handlers and result metadata; the date oracle accepts only a complete current day/month/year across the request boundary. Code, explanation, comparison, poem, numbered-installation, refusal, greeting and gratitude checks now require their named semantics rather than generic non-empty prose. Static and oracle review passed; live execution remains behind the named isolated model fixture, so no model-green claim is made. |
| `A` | `tests/e2e/80-ws-semantic-events.e2e.js` | `REBUILD` | `REPAIRED` | HTTP orchestration and unconditional success were replaced with actual per-session WebSocket traffic. The suite requires exact LOCAL turn envelopes, correlation, contiguous sequence and ordering; cancel acknowledgement plus `cancelled_by_user` with no assistant; cross-session isolation after causal barriers on both sockets; and recovery after malformed raw JSON. Cleanup closes sockets with `Promise.allSettled` and always hard-deletes the owned conversation. A fresh isolated server with Ollama deliberately unreachable reported 4 passed, 0 failed, proving the model-free server contract. |
| `A` | `tests/e2e/81-conversation-lifecycle.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Create, active retrieval, three bounded model turns, exact six-message persistence, title update, archive, immutable archived history, restore, soft delete and hard delete all have mandatory exact contracts with unconditional cleanup. Context is proven by an exact canary present only in the first user prompt; the follow-up also requires a real fenced recursive function with `return` and a self-call. The reviewed source ran green on an isolated server, but one recovered CUDA OOM and use of the shared system Ollama daemon prevent that diagnostic from satisfying the named reproducible model fixture. |
| `A` | `tests/e2e/82-cre-conflict-resolution.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | CRE conflict assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/85-long-session-degradation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Long-session assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/86-code-semantic-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Every response is bounded and must contain fenced, non-placeholder code. Python imports are parsed individually and checked against an explicit allowlist; Express route/listen and requested implementation semantics are mandatory. Transient errors and empty implementations no longer pass, and cleanup is unconditional. Execution remains behind the named isolated model fixture. |
| `A` | `tests/e2e/87-security-injection.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Injection assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/88-concurrent-load.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+three-request-gpu-headroom)` | Three parallel model requests and four alternating turns are bounded, topic-specific and fail closed. The paired invalid request must return the exact 400 validation schema instead of being converted into a synthetic 500. No model-green claim is made until the fixture provides explicit headroom for three concurrent requests. |
| `A` | `tests/e2e/89-response-usefulness.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Usefulness assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/90-large-project-generation.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | The suite now evaluates a mandatory seven-file project manifest extracted from fenced responses, recognizes Markdown filename headings and requires the exact named files plus substantive code, imports, routes, validation and error handling. The former synthetic disk writer and its path-traversal exposure are removed; every turn is bounded and cleanup is unconditional. |
| `A` | `tests/e2e/91-multi-turn-project-build.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Six dependent model turns now require non-empty exact-200 responses and assert the requested evolving Flask/SQLAlchemy/API/test semantics. Early returns that previously converted a failed prerequisite into later green checks are gone, and cleanup is unconditional. |
| `A` | `tests/e2e/92-code-analysis-depth.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Code-analysis assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/93-chat-response-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Response-quality assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/94-long-conversation-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Ten bounded turns must each return substantive content and preserve exact named facts, corrections, exclusions and final synthesis. Dependent early returns and weak aggregate-only checks are removed; the suite fails closed and always cleans up. Execution remains behind the named long-context model fixture. |
| `A` | `tests/e2e/95-code-generation-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Code-generation assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/96-project-workflow-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Project-workflow assertions are fail-closed through the strict positive chat helper and owned temp cleanup; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/97-project-build-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Project-build assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/98-analysis-quality.e2e.js` | `REBUILD` | `DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)` | Analysis-quality assertions are fail-closed through the strict positive chat helper; execution requires the named isolated local model fixture. |
| `A` | `tests/e2e/QUALITY-REPORT.md` | `EXCLUDE` | `MOVE_OUTSIDE_PRODUCTION` | Generated quality report; replace with bounded evidence metadata when rerun. |
| `A` | `tests/e2e/_e2e-state.js` | `REBUILD` | `REPAIRED` | State is private and atomic, schema-versioned and bound to suite plus exact source SHA; corrupt, mismatched and non-contiguous state is rejected. The current focused helper self-check at `ec19fa4f603859cd7785bd508ab2c258b4b395b9` exited 0. |
| `A` | `tests/e2e/_helpers.js` | `REBUILD` | `REPAIRED` | Endpoint ownership, bounded requests and private cleanup are rebuilt. Both conversation creators reject HTTP 500 and missing IDs, while positive chat helpers reject non-200 and empty responses. The bounded helper forwards server-validated options without allowing callers to replace the conversation ID or message; its current focused self-check at `ec19fa4f603859cd7785bd508ab2c258b4b395b9` exits 0 after the direct-run isolation changes. |
| `A` | `tests/e2e/_quality-evaluator.js` | `REBUILD` | `REPAIRED` | Syntax checks use argv execution and a `makeOwnedTempDir()` fixture with owned cleanup rather than shared `/tmp`. The current focused helper self-check at `ec19fa4f603859cd7785bd508ab2c258b4b395b9` proves valid/invalid syntax discrimination and no surviving fixture, exit 0. |
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
| `ec19fa4f603859cd7785bd508ab2c258b4b395b9` | `tests/e2e/_helpers.js`, `tests/e2e/_e2e-state.js`, `tests/e2e/_quality-evaluator.js`, phase source contracts | `node tests/e2e/_helpers.self-check.js` | 0 | current ownership, response, state, syntax and terminal-order contracts passed after all direct-run isolation changes |
| `ec19fa4f603859cd7785bd508ab2c258b4b395b9` | `tests/e2e/220-e2e-suite-runner.js` | `INTENTSMITH_TEST_ARTIFACT_DIR=$REPO/.intentsmith-artifacts/gate0/disposition-ec19/220 node tests/e2e/220-e2e-suite-runner.js --self-check` | 0 | schema 2 report recorded the current source SHA, clean-state default and zero cleanup errors; final status `SELF_CHECK_PASS` |
| `ec19fa4f603859cd7785bd508ab2c258b4b395b9` | model suites `70–74`, `79`, `82`, `85`, `87`, `89`, `92`, `93`, `95–98` | `node --check <each of the 16 listed files>` | 0 | all current sources are syntactically valid; live execution remains deferred to the named model fixture |
| `82dbc3b30ad0c7329182dbe399705d874b004f2e` | `package.json`, `package-lock.json`, `src/config.js`, `src/server.js` | commands and output hashes in attestation `f11026f062e5d2e75fe6802a3e4e2ad38a6c9dab` | 0 | two isolated minimal installs and the complete 199-program deterministic registry passed with the later database, port-file, body-limit and capability hardening included |
| `82dbc3b30ad0c7329182dbe399705d874b004f2e` | `CLAUDE.md`, `README.md`, legacy backend reference | `node tests/artifact-validation.test.js`; disposition resolution | 0 | registered documentation checks preserve reconstructed product guidance and current registry facts; the unsafe legacy symlink is absent and its portable target resolves as `MAPPED_REPAIR` |
| `ec19fa4f603859cd7785bd508ab2c258b4b395b9` | server suites `01–03`, `05` and current `src/routes/chat.js` | `node --check <each changed source>`; `node tests/routes-smoke.test.js` | 0 / 0 | no early-return or accepted 5xx pattern remains in the closed records; current route regression reported 53 passed and proves invalid messages never reach the controller |

## Incident-response decisions outside this diff

The target GitHub repository was read-only verified as public on 2026-07-30. Visibility change, credential rotation, and history remediation are operator decisions (`P-001` through `P-003`); no remote setting or history was changed by this classification.
