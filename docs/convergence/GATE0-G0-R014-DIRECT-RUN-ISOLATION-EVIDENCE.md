# Gate 0 G0-R014 direct-run isolation evidence

## Result

- Evidence state: **PARTIAL**
- Risk state: **OPEN**
- Branch: `codex/g0-r014-direct-run-isolation`
- Base SHA: `2c2fd256526a6ae7a5b9f84e2636f4ba0f9a49b5`
- Code and test SHA: `d2a351898c32da303182122c664571e2d16406b8`
- Integrated code SHA: `6027e3b918d46455e98d869cd8067b166b50a68f`
- First fixed-writer batch SHA: `96b8e9439e0d1492678ae404511a391ab7d58afc`
- Database completion SHA: `e78290776cd2b30bd46465adbe9f8abcb0a4ad60`
- Custom-writer completion SHA: `6a330a8b9b06e7d8acdc1bdf2ac87a4d1f7291cb`
- Attachment ownership fix SHA: `c1aeb17c67a4f912c5d1e4161c0c1796f9e79f35`
- Server-capability follow-up SHA: `ab0b9e5601cf8256684304832cedb326f1015ef2`
- Final capability test-trust follow-up SHA:
  `fab974eda32bcdb62941f91d697600af1bdbedcb`
- Scope: common bootstrap, all database-reachable root programs, and all
  previously identified fixed/non-atomic writers

This change does not claim to close `G0-R014`. It establishes a fail-closed
direct-run bootstrap, connects the two shared root-test harnesses, protects all
92 root programs that can reach the database, covers every current root test
which calls `mkdtemp` or `mkdtempSync`, and carries the same contract through
the nightly audit runner and the large E2E runner. Follow-ups convert every
hard-coded shared writer to an atomic owned root, bind the remaining
`os.tmpdir()` consumers to the invocation-private `TMPDIR`, and require a
private PID-bound server attestation before the attachment suite can send a
request.

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
discovery on the integrated tree finds 49 programs with an actual
`mkdtemp(...)` or `mkdtempSync(...)` call. All 49 have a static bootstrap path through the
helper, `harness.js`, or `e2e-harness.js`; the registered
`harness-exit-code.test.js` meta-test enforces this on every run.

The 49 programs are:

```text
tests/architecture-check.test.js
tests/architecture-policy.test.js
tests/archive-lifecycle.test.js
tests/artifact-validation.test.js
tests/attachments-projects.test.js
tests/chat-export-budget.test.js
tests/code-evolution.test.js
tests/code-search.test.js
tests/context-builder.test.js
tests/dead-code-detector.test.js
tests/debug-agent.test.js
tests/dependency-manager.test.js
tests/drift-detector.test.js
tests/e2e-harness-isolation.test.js
tests/export-pdf-docx.test.js
tests/execution-graph.test.js
tests/execution-loop.test.js
tests/exploration-agent.test.js
tests/graph-sync.test.js
tests/harness-exit-code.test.js
tests/impact-analyzer.test.js
tests/intent-context.test.js
tests/knowledge-graph.test.js
tests/large-project-scaling.test.js
tests/lifecycle-conversation-e2e.test.js
tests/lifecycle-e2e.test.js
tests/lifecycle-human-friction.test.js
tests/lifecycle-llm-realistic.test.js
tests/lifecycle-stress-advanced.test.js
tests/marketplace.test.js
tests/project-kb-decomposer.test.js
tests/project-lifecycle-change-mgmt.test.js
tests/project-lifecycle-expertise.test.js
tests/project-lifecycle-happy-path.test.js
tests/project-lifecycle-intercept.test.js
tests/project-lifecycle-interrupts.test.js
tests/project-lifecycle-klicenka.test.js
tests/quality-gate.test.js
tests/semantic-index.test.js
tests/signature-cache.test.js
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

The count increased from the original 40 because nine fixed or timestamp-only
writers were deliberately converted to atomic `mkdtemp` allocation. It is not
the stale historical risk-register wording of 43.

## Database reachability

A static root-program import-graph inventory identified 92 programs which can
reach `src/db/database.js`. At the original common-bootstrap SHA, 40 were
protected:

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

Integrated commit `e78290776cd2b30bd46465adbe9f8abcb0a4ad60` adds an
isolation import before any database-reachable product dependency in the
remaining 52 programs:

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

The registered meta-test derives this graph from literal static imports,
re-exports, dynamic imports, and CommonJS `require` calls. It follows static
evaluation order and rejects a root whose first database/isolation boundary is
the database module. Removing only the direct anchor from
`tests/adversarial-cre.test.js` leaves the inventory at 92 but exposes exactly
that program as unprotected; the mutation exits 1.

## Fixed or non-atomic writer progress

The initial inventory found fourteen root programs using a fixed or
timestamp-only writable path.
Importing the bootstrap contains the six `os.tmpdir()`-sensitive cases, but
does not make their leaf allocation atomic. Eight hard-coded `/tmp` cases
ignore `TMPDIR` entirely.

At integrated SHA `96b8e9439e0d1492678ae404511a391ab7d58afc`,
`architecture-policy`, `execution-loop`, `marketplace`,
`project-kb-decomposer`, and `signature-cache` allocate atomically below
`isolatedTestRuntime.projects`. In particular, the project knowledge-base
fixture can no longer write `/tmp/.c3/snapshot.json`.

The integrated disposition is:

| Former residual category | Integrated disposition |
| --- | --- |
| `chat-export-budget`, `export-pdf-docx` | Atomic directories below `isolatedTestRuntime.artifacts` at `6a330a8b9b06e7d8acdc1bdf2ac87a4d1f7291cb` |
| `lifecycle-e2e`, `lifecycle-human-friction` | Atomic Git project roots below `isolatedTestRuntime.projects` at the same SHA; DB cleanup is exact and fail-closed |
| `attachments-projects` | Atomic project/attachment roots, device+inode cleanup identity, and pre-fetch server attestation at `c1aeb17c67a4f912c5d1e4161c0c1796f9e79f35` plus the current nonce follow-up |
| `multimedia`, `project-welcome`, `tool-registry-e2e`, `upgrade-ux-v125` | Accepted as invocation-bounded: `os.tmpdir()` resolves only after the harness binds it to the atomically unique private runtime; no shared `/tmp` literal is permitted |

The registered meta-test pins the last four programs to `os.tmpdir()`, requires
their harness before product dependencies, and rejects a future hard-coded
`/tmp` bypass. Timestamp or fixed leaf names cannot collide with another test
invocation or operator data because their parent is already unique and mode
`0700`.

The attachment suite's raw full mode is deliberately unavailable: it rejects
before `fetch`. A future server-profile runner must launch the product server
with a private 32–128 character capability, pass the child PID to the suite,
and use the server-written private port file. The server writes that capability
only after `listen()` has produced the actual port. No current runner produces
this full contract, so the registered T3 server suite remains honestly
`BLOCKED`; the server-free boundary self-check is not a full-suite green claim.

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

The common-bootstrap block was independently repeated after integration at
exact SHA `6027e3b918d46455e98d869cd8067b166b50a68f`:

| Command | Result | Exit |
| --- | --- | ---: |
| `node tests/harness-exit-code.test.js` inside the restricted process sandbox | expected environment limitation: child `spawnSync` rejected with `EPERM`; no green claim | 1 |
| same command with approved local child-process permission | `Temp bootstrap coverage: 40 root tests covered`; meta-test passed | 0 |
| `node tests/e2e-harness-isolation.test.js` with approved local child-process permission | 3 passed, 0 failed | 0 |
| `node tests/e2e/220-e2e-suite-runner.js --self-check` without `INTENTSMITH_TEST_ARTIFACT_DIR` | fail-closed: artifact root required | 1 |
| same 220 self-check with a fresh private artifact root | `SELF_CHECK_PASS` | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; registry SHA-256 `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5` | 0 |
| `node tests/artifact-validation.test.js` | 64 passed, 0 failed | 0 |

The first integrated fixed-writer batch was then re-run from exact commit
`96b8e9439e0d1492678ae404511a391ab7d58afc`:

| Command | Result | Exit |
| --- | --- | ---: |
| `node tests/architecture-policy.test.js` | 31 passed, 0 failed | 0 |
| `node tests/execution-loop.test.js` | 58 passed, 0 failed | 0 |
| `node tests/marketplace.test.js` | 44 passed, 0 failed | 0 |
| `node tests/project-kb-decomposer.test.js` | 28 passed, 0 failed | 0 |
| `node tests/signature-cache.test.js` | 7 passed, 0 failed | 0 |

Each successful raw run allocated below
`.intentsmith-artifacts/direct-tests/<program>-*` and removed its invocation
root on exit 0. No network, model, GPU, application database, or generated
source-tree fixture was used.

### Integrated completion preparation

The current integration combines all bounded branches. Focused commands on
exact server-capability SHA
`ab0b9e5601cf8256684304832cedb326f1015ef2` produced:

| Command | Result | Exit |
| --- | --- | ---: |
| `node tests/harness-exit-code.test.js` outside the child-process-restricted sandbox | 49 temp creators protected; 92/92 DB-reachable programs protected; removed DB anchor rejected; raw attachment run rejected before `fetch` | 0 |
| `node tests/upgrade-ux-v125.test.js` | 52 passed, including private port-file and optional server-capability producer contracts | 0 |
| attachment boundary self-check with throwing `fetch` | 5 passed, no request | 0 |
| raw full attachment program with only a numeric loopback `C3_URL` | exact server-boundary rejection before `fetch` | 1 |
| `node tests/lifecycle-e2e.test.js` | 138 passed, 0 failed | 0 |
| `node tests/lifecycle-human-friction.test.js` | 23 passed, 0 failed | 0 |
| both export programs without an injected PDF runtime | truthful missing-fixture failures | 1 |
| `chat-export-budget` with both PDF overrides bound to the pinned candidate runtime | 67 passed, 0 failed | 0 |
| `export-pdf-docx` with the same pinned runtime | 28 passed, 0 failed | 0 |

The PDF green runs reused an existing hash-pinned Gate 0 fixture and therefore
are focused evidence only. The unprovisioned red runs are the truthful
self-contained direct result. The final clean-clone audit must provision the
lockfile-pinned PDF runtime inside its owned install root and inject both equal
absolute overrides; no assertion is skipped or weakened.

## Mutation and negative coverage

The existing registered meta-test covers:

- removal of the `tests/harness.js` bootstrap anchor;
- removal of one database-reachable program's direct bootstrap anchor;
- exact 92-program graph and static evaluation order;
- all four invocation-bounded `os.tmpdir()` consumers;
- raw attachment execution with an exact pre-fetch error oracle;
- incomplete audit environments;
- symlinked audit directories;
- npm cache outside the suite artifact directory;
- an existing permissive direct artifact root;
- successful cleanup;
- non-zero preservation; and
- cleanup target replacement by a symlink.

Removing an isolation anchor or changing an owned writer root produces a named
exit-1 assertion. The raw attachment oracle requires both the exact guard error
and absence of `FETCH_CALLED`; a later throwing fetch cannot masquerade as the
expected boundary failure.

## Remaining decision

`G0-R014` remains **OPEN** until these combined contracts pass from a committed
integration SHA and the full 199-suite deterministic registry is replayed from
the final clean candidate. No remaining direct-run database or shared-writer
consumer is currently undispositioned. This work does not edit `STATUS.md`,
registry schema/version data, or `data/c3.db`.
