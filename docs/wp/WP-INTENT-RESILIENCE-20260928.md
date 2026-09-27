# Intent resilience in chat

Authority: operator approval on 2026-09-28 of four observable behaviours: an unambiguous typo does not block work; a materially ambiguous quantity, value, or negation stops the affected effect and asks a targeted question; a first message may ask that question; no action follows a silently changed meaning.

Status: IMPLEMENTED / REVIEW_PENDING / NOT_DEPLOYED. Input revision: `2572fe0504f53385628ea043d37f8cb207af4e74`. The corresponding chat decision, conversation handler, and effect broker files have the same SHA-256 bytes as the running `72247a49` release. Baseline probe in an isolated database: a controlled `ASK_USER` for `sniž gpu napětí na polovinu` became `ANSWER` and invoked a model once.

User result: Chat preserves the original request. An explicit GPU control request with voltage, power, or a percentage is not silently converted into another quantity. The user sees one concrete clarification or a truthful unsupported-capability response before any effect. Ordinary text and unambiguous typo classification remain usable. A clarification response cannot itself authorize or execute a hardware change.

Owned paths and connector: `src/chat/controller.js`, `src/chat/cre-decision.js`, `src/chat/handlers/conversation.js`, `src/chat/handlers/ask-user.js`, a small pure chat intent preflight, focused tests under `tests/`, new entries in `tests/registry.json`, and the matching generated `docs/convergence/TEST-REGISTRY.md`. The two test census assertions, M6 candidate-plan census, current README/`SYSTEM-MAP.md` counts, exact module-boundary baseline, and matching current `ROADMAP.md` count are included because the new production module and test programs change their measured inputs. The connector is the existing `ChatController.process()` to CRE decision and `TaggedResponse` path. No public M1/M2 connector shape changes.

Forbidden paths: other worktrees; GPU controls; model scoring and bindings; `src/effects/`, `src/tools/`, `contracts/`, Studio UI, release state, and existing registry entries. Do not touch shared Ollama or GPU processes.

Demo and checks: exercise a real `ChatController.process()` path with controlled model callbacks and a tool spy, then an isolated actual chat HTTP turn. Positive cases include ordinary typo and explicit informational GPU question. Negative cases cover first-turn voltage/power ambiguity, unit/number/negation changes, unsupported GPU control, clarification follow-up, and no model/tool effect for blocked input. Run focused tests, `npm run test:deterministic`, `npm run test:registry`, and `git diff --check`; classify any non-PASS baseline separately. New registry bytes cannot inherit the reviewed Gate 0 seal: leave that gate red pending independent review.

Stop condition: if implementation requires a public connector, changes another owner's path, or cannot demonstrate the no-effect claim at the real chat boundary, stop and report that dependency instead of widening scope or claiming acceptance.

## Verification

Implementation revision: `b39c79fb6f78ffcb6bffbc405d342db93314304d`, Node `24.21.0`, npm `10.9.4`. The final deterministic audit ran on this clean commit. This work package's evidence update is documentation only and does not rebind that audit to a later commit.

- `chat-intent-clarity.test.js`: PASS. Original user bytes are persisted; ambiguous or unsupported hardware input never reaches a handler; informational requests and ordinary typos retain their original input. Negative percentages ask for a value. A first-turn `ASK_USER` remains a question with zero model calls.
- `chat-intent-clarity-http.test.js`: PASS through an actual owned loopback HTTP server and M1 `ConversationCommand`. The sequence ambiguous request -> generic `ano` -> explicit `příkon` has zero handler/model calls and preserves all three user turns.
- Existing M1 chat contract: 33/33 PASS. Database isolation meta-test: PASS, all 141 database-reachable root tests protected, removed-anchor mutation rejected. Artifact validation: 160/160 PASS. M6 plan: 22/22 PASS. Module boundary: 13/13 PASS; three exact additions, unchanged 3 cycles / 28 cyclic files.
- Registry: 565 programs, SHA-256 `508b5333c57dd59a96af282efc3ea46aec7f3635201ca943a7f22bbd08aff0a1`. `git diff --check`: PASS.

Full deterministic result: **373 PASS / 12 FAIL / 13 BLOCKED / 0 TIMEOUT**, exit 1. Run `2026-09-27T22-46-26-883Z`; local report `.intentsmith-artifacts/test-runs/2026-09-27T22-46-26-883Z/report.json`, SHA-256 `6efc3fab9cf5036861fffc7d4cc85b93cf9628b3c73ded2f605e13c04f1ac9ac`. The full gate is FAIL, not acceptance.

### Remaining non-PASS

Eleven suites fail before their assertions because this worktree has no IDE dependency installation: `m1-studio-client`, `m2-lifecycle-studio-surface` (`@theia/core/shared/markdown-it`); `studio2-view` (`react`); `studio2-conversation-view`, `studio2-expertise-selection`, `studio2-live-model`, `studio2-m2`, `studio2-media-input`, `studio2-session-store`, `studio2-transport`, `studio2-workspace-files` (`@intentsmith/chat-panel/lib/browser/work-activity`). These are environment failures, not proven product passes.

`nightly-orchestrator-self-test` fails because registry bytes differ from the reviewed Gate 0 policy. No policy hash or release attestation was changed.

The runner blocks these exact toolchain prerequisites; this does not assert the programs are absent from the host:

| Suite | Blocker |
| --- | --- |
| accountant-workflow-integration | accountant-ocr-runtime, python-pdf-runtime |
| chat-export-budget, export-pdf-docx | python-pdf-runtime |
| desktop-hunt | systemd-analyze |
| development-installation | bwrap, prlimit, python3, tar |
| m2-execution-git-preservation, scm-studio, workspace-budget, workspace-tree-project-id | git |
| m2-execution-process-supervision | bwrap |
| m2-execution-project-change, m2-lifecycle-application-service | bwrap, git |
| m5-process-hardening | bubblewrap, prlimit |

## Limits and next gate

The new deterministic preflight covers recognized direct GPU control requests. It is not a universal semantic verifier for arbitrary commands or misspellings. When it pauses a compound request, it pauses the whole turn and says so; no independent task resumes automatically. GPU control is currently unsupported, so even a clarified answer does not execute it. No real model inference, GPU setting, shared database, production restart, merge or deployment was performed.

Independent review, the required fresh-clone/IDE validation, Gate 0 reconciliation and operator acceptance remain open. A broader guarantee requires typed proposed effects bound to the original request and a regression corpus for each supported effect family; a prompt-only instruction cannot establish that guarantee.
