# Gate 0 G0-R014 direct-run isolation evidence

## Result

- Evidence state: **PARTIAL**
- Risk state: **OPEN**
- Branch: `codex/g0-r014-direct-run-isolation`
- Base SHA: `2c2fd256526a6ae7a5b9f84e2636f4ba0f9a49b5`
- Code and test SHA: `d2a351898c32da303182122c664571e2d16406b8`
- Scope: first common-bootstrap block only

This change does not claim to close `G0-R014`. It establishes a fail-closed
direct-run bootstrap, connects the two shared root-test harnesses, covers every
current root test which actually calls `mkdtemp` or `mkdtempSync`, and carries
the same contract through the nightly audit runner and the large E2E runner.
Residual database-reachable and fixed-path writers are listed below.

## Implemented contract

`tests/helpers/isolated-test-db.js` is an imported support module, not a new
runnable test.

For a raw `node tests/<program>.test.js` invocation it:

1. creates an atomic, current-user-owned `0700` invocation root below the
   ignored `.intentsmith-artifacts/direct-tests/` directory;
2. creates private `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
   `XDG_DATA_HOME`, `XDG_STATE_HOME`, `TMPDIR`, `TMP`, `TEMP`, runtime,
   projects, artifacts, and `artifacts/npm-cache` directories;
3. sets explicit `C3_DB_PATH`, project, artifact, port-file, test-mode, and
   autonomy-disabled variables;
4. replaces inherited writable paths, including `npm_config_cache`;
5. removes the owned root after exit code 0;
6. preserves it after a non-zero exit for diagnosis; and
7. returns a non-zero result if safe cleanup cannot be proven.

Existing roots with group/other access, wrong ownership, symlink traversal, or
an unsafe removal target are rejected. The helper never relaxes permissions on
an existing unsafe root.

With `C3_AUDIT_RUN=1`, the helper does not allocate or remove a second root. It
requires and validates the runner-owned HOME, all four XDG directories, three
temporary-directory aliases, npm cache, database parent, project roots,
artifact root, and port-file parent. The npm cache must be a strict child of
the suite artifact directory. Every directory must exist, be a canonical
non-symlink directory, be owned by the current user, and have no group/other
permissions.

`scripts/nightly-audit.js` now creates a distinct private
`artifacts/npm-cache` for each suite, injects it, and records its path as
environment evidence. `tests/e2e/220-e2e-suite-runner.js` carries
`C3_AUDIT_RUN=1` and its own private npm cache into phase children. No R020
model-fixture or preflight semantics were changed.

## Root temp-directory inventory

At the tested tree there are 246 root `tests/*.test.js` programs. Static
discovery finds 40 programs with an actual `mkdtemp(...)` or
`mkdtempSync(...)` call. All 40 now have a static bootstrap path through the
helper, `harness.js`, or `e2e-harness.js`; the registered
`harness-exit-code.test.js` meta-test enforces this on every run.

The 40 programs are:

```text
tests/architecture-check.test.js
tests/archive-lifecycle.test.js
tests/artifact-validation.test.js
tests/attachments-projects.test.js
tests/code-evolution.test.js
tests/code-search.test.js
tests/context-builder.test.js
tests/dead-code-detector.test.js
tests/debug-agent.test.js
tests/dependency-manager.test.js
tests/drift-detector.test.js
tests/e2e-harness-isolation.test.js
tests/execution-graph.test.js
tests/exploration-agent.test.js
tests/graph-sync.test.js
tests/harness-exit-code.test.js
tests/impact-analyzer.test.js
tests/intent-context.test.js
tests/knowledge-graph.test.js
tests/large-project-scaling.test.js
tests/lifecycle-conversation-e2e.test.js
tests/lifecycle-llm-realistic.test.js
tests/lifecycle-stress-advanced.test.js
tests/project-lifecycle-change-mgmt.test.js
tests/project-lifecycle-expertise.test.js
tests/project-lifecycle-happy-path.test.js
tests/project-lifecycle-intercept.test.js
tests/project-lifecycle-interrupts.test.js
tests/project-lifecycle-klicenka.test.js
tests/quality-gate.test.js
tests/semantic-index.test.js
tests/signature-map.test.js
tests/smoke.test.js
tests/specialist-loader.test.js
tests/storage-architecture.test.js
tests/symbol-index.test.js
tests/telemetry-aggregation-version.test.js
tests/test-coverage-explorer.test.js
tests/tool-registry-e2e.test.js
tests/upgrade-ux-v125.test.js
```

This current count is 40, not the historical risk-register wording of 43. The
risk register remains untouched in this isolated branch because current
generated risk/status documents changed independently on the integration
branch.

## Database reachability

A static root-program import-graph inventory identified 92 programs which can
reach `src/db/database.js`. The common bootstrap currently reaches 40 of them:

```text
tests/api-contract-registry.test.js
tests/archive-lifecycle.test.js
tests/build-deferral.test.js
tests/build-intent.test.js
tests/cre-build-arbitration.test.js
tests/cre-file-reference-guard.test.js
tests/create-specialist-skill.test.js
tests/e2e-pipeline.test.js
tests/file-write-extract.test.js
tests/lifecycle-blocked-milestone.test.js
tests/lifecycle-context-loss.test.js
tests/lifecycle-conversation-e2e.test.js
tests/lifecycle-invariants.test.js
tests/lifecycle-llm-realistic.test.js
tests/lifecycle-stress-advanced.test.js
tests/llm-gateway-runtime-signal.test.js
tests/llm-integration-2.test.js
tests/llm-integration.test.js
tests/local-math-nonfinite.test.js
tests/manifest-v2.test.js
tests/multimedia.test.js
tests/p5-only.test.js
tests/project-conversation-e2e-p5p7.test.js
tests/project-conversation-e2e-v2.test.js
tests/project-conversation-e2e.test.js
tests/project-e2e-v131.test.js
tests/project-lifecycle-change-mgmt.test.js
tests/project-lifecycle-entry.test.js
tests/project-lifecycle-expertise.test.js
tests/project-lifecycle-happy-path.test.js
tests/project-lifecycle-intercept.test.js
tests/project-lifecycle-interrupts.test.js
tests/project-lifecycle-klicenka.test.js
tests/quality-report.test.js
tests/quality-telemetry.test.js
tests/specialist-registries.test.js
tests/specialist-loader.test.js
tests/telemetry-aggregation-version.test.js
tests/ultimate-e2e.test.js
tests/vram-coordination.test.js
```

The exact 52 database-reachable programs still lacking a common bootstrap path
are:

```text
tests/adversarial-cre.test.js
tests/agent-wizard.test.js
tests/build-handoff.test.js
tests/build-patterns.test.js
tests/build-routing-project-mode.test.js
tests/chat-pipeline.test.js
tests/chat-search-quality.test.js
tests/chat-synthesis-hardening.test.js
tests/conv-czech-nodiacritics.test.js
tests/conv-czech.test.js
tests/conv-english.test.js
tests/cre-comprehensive.test.js
tests/cre-dialog-scenarios.test.js
tests/cre-followup-diagnostic.test.js
tests/cre-gatekeeper.test.js
tests/cre-guard-interactions.test.js
tests/cre-report-sticky-break.test.js
tests/design-sprint34.test.js
tests/design-tests.test.js
tests/e2e-resilience.test.js
tests/executor-capabilities.test.js
tests/expertise-ab-quality.test.js
tests/expertise-comparison-e2e-b.test.js
tests/expertise-comparison-e2e-c.test.js
tests/expertise-comparison-e2e-d.test.js
tests/expertise-comparison-e2e-e.test.js
tests/expertise-comparison-e2e.test.js
tests/expertise-routing-correctness.test.js
tests/fixes-v582.test.js
tests/lifecycle-analysis-e2e.test.js
tests/lifecycle-android-app-e2e.test.js
tests/lifecycle-build.test.js
tests/lifecycle-cookbook-e2e.test.js
tests/lifecycle-db.test.js
tests/lifecycle-e2e.test.js
tests/lifecycle-handoff.test.js
tests/lifecycle-human-friction.test.js
tests/lifecycle-imagegen-e2e.test.js
tests/lifecycle-klicenka-e2e.test.js
tests/lifecycle-review-change.test.js
tests/lifecycle.test.js
tests/pilot-c1c2c3.test.js
tests/quality-gates.test.js
tests/quality-score.test.js
tests/routing-accuracy.test.js
tests/session-context.test.js
tests/skill-meta-detection.test.js
tests/skill-routing-cre.test.js
tests/smoke.test.js
tests/telemetry-soak.test.js
tests/v583-tier1.test.js
tests/ws-bridge.test.js
```

`tests/smoke.test.js`, for example, imports the shared harness after a
database-reachable dependency and therefore is not counted as protected merely
because the harness appears somewhere in its source.

## Fixed or non-atomic writer residual

Fourteen root programs still use a fixed or timestamp-only writable path.
Importing the bootstrap contains the six `os.tmpdir()`-sensitive cases, but
does not make their leaf allocation atomic. Eight hard-coded `/tmp` cases
ignore `TMPDIR` entirely.

| Category | Programs |
| --- | --- |
| Hard-coded `/tmp` | `chat-export-budget`, `execution-loop`, `export-pdf-docx`, `lifecycle-e2e`, `lifecycle-human-friction`, `marketplace`, `project-kb-decomposer`, `signature-cache` |
| `os.tmpdir()` but non-atomic | `architecture-policy`, `attachments-projects`, `multimedia`, `project-welcome`, `tool-registry-e2e`, `upgrade-ux-v125` |

`project-kb-decomposer.test.js` is the highest-priority fixed-path case because
its `/tmp` fixture can cause production code to write `/tmp/.c3/snapshot.json`.
These conversions are intentionally delegated to small follow-up batches.

## Test evidence

All successful direct-run programs below emitted exit code 0 and cleaned their
owned invocation root. The expected non-zero and mutation runs preserved their
owned roots; those exact test-created roots were inspected and then removed.

The exact syntax-check command was:

```sh
node --check scripts/nightly-audit.js &&
node --check tests/archive-lifecycle.test.js &&
node --check tests/e2e-harness-isolation.test.js &&
node --check tests/e2e-harness.js &&
node --check tests/e2e/220-e2e-suite-runner.js &&
node --check tests/harness-exit-code.test.js &&
node --check tests/harness.js &&
node --check tests/helpers/isolated-test-db.js &&
node --check tests/nightly-audit-runner-self-test.js &&
node --check tests/specialist-loader.test.js &&
node --check tests/telemetry-aggregation-version.test.js
```

| Command | Result | Exit |
| --- | --- | ---: |
| `node --check tests/helpers/isolated-test-db.js` and checks for all changed JS files | no syntax errors | 0 |
| `node tests/harness-exit-code.test.js` | `Temp bootstrap coverage: 40 root tests covered`; meta-test passed | 0 |
| Same meta-test with only the first import in `tests/harness.js` temporarily removed | direct harness probe had no isolated environment; assertion failed | 1 |
| Meta-test after restoring the import | coverage 40; meta-test passed | 0 |
| `node tests/e2e-harness-isolation.test.js` | 3 passed, 0 failed | 0 |
| `node tests/nightly-audit-runner-self-test.js` | `nightly audit runner self-test: PASS` | 0 |
| `node tests/e2e/220-e2e-suite-runner.js --self-check` without an artifact root | fail-closed: `INTENTSMITH_TEST_ARTIFACT_DIR is required` | 1 |
| `INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r014/.intentsmith-artifacts/220-self-check-AyFYOr node tests/e2e/220-e2e-suite-runner.js --self-check` | `SELF_CHECK_PASS`; npm cache observed at mode `0700` | 0 |
| `node tests/archive-lifecycle.test.js` | 47 passed, 0 failed | 0 |
| `node tests/telemetry-aggregation-version.test.js` | 4 passed, 0 failed | 0 |
| `node tests/specialist-loader.test.js` | 268 passed, 0 failed | 0 |
| `node tests/lifecycle-blocked-milestone.test.js` | 24 passed, 0 failed | 0 |
| `node tests/quality-report.test.js` | 52 passed, 0 failed | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; registry SHA-256 `a7a5c6d4670159cd38a08edea8aabbf868eb3342a3baf1857b6a4849d1f4960a` | 0 |
| `git diff --check` | no whitespace errors | 0 |

The process sandbox initially rejected child spawning in the two meta-tests
with `EPERM`; the authoritative reruns used the approved local-process
permission and are the exit-0 results above. This is environment evidence, not
a changed assertion or skip.

Dependency preparation was `npm ci --offline --ignore-scripts` (exit 0). Since
that deliberately omitted the native `better-sqlite3` install hook, the
compatible native binary was provisioned from a sibling worktree with the same
package version and matching package metadata. These focused results are not a
clean-clone installation claim.

## Mutation and negative coverage

The existing registered meta-test covers:

- removal of the `tests/harness.js` bootstrap anchor;
- incomplete audit environments;
- symlinked audit directories;
- npm cache outside the suite artifact directory;
- an existing permissive direct artifact root;
- successful cleanup;
- non-zero preservation; and
- cleanup target replacement by a symlink.

Removing the harness bootstrap produced exit code 1 before any assertion was
weakened. Restoring only that import returned the same suite to exit code 0.

## Remaining decision

`G0-R014` must remain **OPEN** until the remaining 52 database-reachable
programs and the 14 fixed/non-atomic writers are converted or explicitly
dispositioned, followed by a full registered audit from the integrated SHA.
This branch does not edit `STATUS.md`, the generated risk documents, registry
schema/version data, or `data/c3.db`.
