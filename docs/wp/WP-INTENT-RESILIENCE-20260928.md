# Intent resilience in chat

Authority: operator approval on 2026-09-28 of four observable behaviours: an unambiguous typo does not block work; a materially ambiguous quantity, value, or negation stops the affected effect and asks a targeted question; a first message may ask that question; no action follows a silently changed meaning.

Status: IN_PROGRESS / REVIEW_PENDING. Input revision: `2572fe0504f53385628ea043d37f8cb207af4e74`. The corresponding chat decision, conversation handler, and effect broker files have the same SHA-256 bytes as the running `72247a49` release. Baseline probe in an isolated database: a controlled `ASK_USER` for `sniž gpu napětí na polovinu` became `ANSWER` and invoked a model once.

User result: Chat preserves the original request. An explicit GPU control request with voltage, power, or a percentage is not silently converted into another quantity. The user sees one concrete clarification or a truthful unsupported-capability response before any effect. Ordinary text and unambiguous typo classification remain usable. A clarification response cannot itself authorize or execute a hardware change.

Owned paths and connector: `src/chat/controller.js`, `src/chat/cre-decision.js`, `src/chat/handlers/conversation.js`, `src/chat/handlers/ask-user.js`, a small pure chat intent preflight, focused tests under `tests/`, new entries in `tests/registry.json`, and the matching generated `docs/convergence/TEST-REGISTRY.md`. The two test census assertions, M6 candidate-plan census, current README/`SYSTEM-MAP.md` counts, and exact module-boundary baseline are included because the new production module and test programs change their measured inputs. The connector is the existing `ChatController.process()` to CRE decision and `TaggedResponse` path. No public M1/M2 connector shape changes.

Forbidden paths: other worktrees; GPU controls; model scoring and bindings; `src/effects/`, `src/tools/`, `contracts/`, Studio UI, release state, and existing registry entries. Do not touch shared Ollama or GPU processes.

Demo and checks: exercise a real `ChatController.process()` path with controlled model callbacks and a tool spy, then an isolated actual chat HTTP turn. Positive cases include ordinary typo and explicit informational GPU question. Negative cases cover first-turn voltage/power ambiguity, unit/number/negation changes, unsupported GPU control, clarification follow-up, and no model/tool effect for blocked input. Run focused tests, `npm run test:deterministic`, `npm run test:registry`, and `git diff --check`; classify any non-PASS baseline separately. New registry bytes cannot inherit the reviewed Gate 0 seal: leave that gate red pending independent review.

Stop condition: if implementation requires a public connector, changes another owner's path, or cannot demonstrate the no-effect claim at the real chat boundary, stop and report that dependency instead of widening scope or claiming acceptance.
