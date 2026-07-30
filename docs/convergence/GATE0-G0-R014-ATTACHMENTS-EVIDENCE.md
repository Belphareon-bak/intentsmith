# Gate 0 evidence: G0-R014 attachments and projects boundary

Scope:

- branch: `codex/g0-r014-attachments`;
- source commit:
  `bae8106d0c137437162c05b03d441d7824a888b1`;
- isolation prerequisite source commit:
  `d2a351898c32da303182122c664571e2d16406b8` (locally replayed as
  `fa609d7bc69cdf002583063bd1ca83f2c3acdfba`);
- tested `tests/attachments-projects.test.js` blob:
  `219d1d08c30bcd2187d954600e991093272bf634`;
- execution date: 2026-07-30 Europe/Prague;
- registered program: `IS-T3-TESTS-ATTACHMENTS-PROJECTS-TEST`.

This batch changes only the registered attachment/project program and this
evidence document. It reuses `isolatedTestRuntime.projects` and
`isolatedTestRuntime.temp`; ownership, mode, canonical-path and direct-run
bootstrap policy remain centralized in `tests/helpers/isolated-test-db.js`.
The registry, nightly runner, generated status, risk ledger and databases are
outside this commit.

## Repaired boundary

- `C3_URL` is mandatory and has no fallback.
- Only a literal HTTP IPv4 `127/8` or IPv6 `::1` origin with an explicit
  nonzero port is accepted. Credentials, path, query, fragment, whitespace,
  invalid octets, integer IPv4 and hexadecimal IPv4 forms are rejected.
- The URL guard runs before this suite creates a fixture or reaches `fetch`.
  The common harness may first bootstrap its standardized isolated runtime;
  failed direct runs preserve that empty runtime as evidence.
- Project fixtures use the canonical `INTENTSMITH_TEST_PROJECTS_DIR` /
  `C3_PROJECTS_DIR` root supplied by `isolatedTestRuntime`.
- Attachment fixtures and the nonexistent-project path use its private
  `TMPDIR`.
- Recursive cleanup accepts only directories atomically created and tracked by
  this process below those roots; the focused contract rejects the root itself,
  an unowned child and an owned directory replaced by a symlink.
- The two synchronous attachment fixtures that previously cleaned up after
  assertions now clean up in `finally`.

The `--boundary-self-check` mode runs only the deterministic boundary contract.
It never calls the application server.

## Exact deterministic evidence

### Syntax

```bash
node --check tests/attachments-projects.test.js
```

Result: exit `0`.

### Missing endpoint fails before suite fixtures or network

```bash
env -u C3_URL \
  -u C3_AUDIT_RUN \
  -u INTENTSMITH_TEST_PROJECTS_DIR \
  -u C3_PROJECTS_DIR \
  -u TMPDIR \
  node \
    --import 'data:text/javascript,globalThis.fetch%20%3D%20()%20%3D%3E%20%7B%20throw%20new%20Error(%22FETCH_CALLED%22)%3B%20%7D%3B' \
    tests/attachments-projects.test.js
```

The command used the same throwing `globalThis.fetch` preload shown below.
Result: exit `1`, with
`C3_URL is required and must identify the runner-owned loopback server`.
The helper preserved one direct-run runtime because the process failed. It
contained zero files; that exact generated directory was inspected and removed.

### Non-loopback endpoint fails closed

```bash
env -u C3_AUDIT_RUN \
  -u INTENTSMITH_TEST_PROJECTS_DIR \
  -u C3_PROJECTS_DIR \
  -u TMPDIR \
  C3_URL=http://example.com:3335 \
  node \
    --import 'data:text/javascript,globalThis.fetch%20%3D%20()%20%3D%3E%20%7B%20throw%20new%20Error(%22FETCH_CALLED%22)%3B%20%7D%3B' \
    tests/attachments-projects.test.js
```

The command also used the throwing fetch preload. Result: exit `1`, with
`C3_URL must be an explicit http://127.x.x.x:<port> or http://[::1]:<port> origin`.
Its preserved direct-run runtime also contained zero files and was removed.
Neither command reached the `FETCH_CALLED` trap.

### Boundary contract, bootstrap and cleanup

```bash
env -u C3_AUDIT_RUN \
  -u INTENTSMITH_TEST_PROJECTS_DIR \
  -u C3_PROJECTS_DIR \
  -u TMPDIR \
  C3_URL=http://127.0.0.1:1 \
  node tests/attachments-projects.test.js --boundary-self-check
```

Result: `4 passed, 0 failed, 0 skipped`, exit `0`. The helper bootstrapped the
private direct-run runtime, both fixture types round-tripped below its canonical
roots, and the remaining direct-runtime count was `0`. Port `1` is only a
syntactically valid explicit origin; boundary-only mode performs no request.

The command was repeated with this Node preload:

```bash
node \
  --import 'data:text/javascript,globalThis.fetch%20%3D%20()%20%3D%3E%20%7B%20throw%20new%20Error(%22FETCH_CALLED%22)%3B%20%7D%3B' \
  tests/attachments-projects.test.js --boundary-self-check
```

With the same environment it again returned `4 passed, 0 failed, 0 skipped`,
exit `0`. The preload would throw `FETCH_CALLED` on any request.

The focused mode was also replayed with `C3_AUDIT_RUN=1` and the complete
runner contract (`HOME`, XDG roots, `TMPDIR`/`TMP`/`TEMP`, npm cache, DB parent,
project roots, artifact root and port-file parent) below one mode-`0700`
`.intentsmith-artifacts/g0-r014-attachments/audit` root:

```bash
env C3_AUDIT_RUN=1 C3_URL=http://127.0.0.1:1 \
  HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/home \
  XDG_CONFIG_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/xdg-config \
  XDG_CACHE_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/xdg-cache \
  XDG_DATA_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/xdg-data \
  XDG_STATE_HOME=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/xdg-state \
  TMPDIR=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/tmp \
  TMP=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/tmp \
  TEMP=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/tmp \
  npm_config_cache=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/artifacts/npm-cache \
  C3_DB_PATH=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/runtime/test.sqlite \
  C3_PROJECTS_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/projects \
  INTENTSMITH_TEST_PROJECTS_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/projects \
  INTENTSMITH_TEST_ARTIFACT_DIR=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/artifacts \
  C3_PORT_FILE=/home/belphareon/Projects/coworker/intentsmith-g0-r014-attachments/.intentsmith-artifacts/g0-r014-attachments/audit/runtime/server.port \
  node tests/attachments-projects.test.js --boundary-self-check
```

Result: `4 passed, 0 failed, 0 skipped`, exit `0`; zero files and zero
project/temp fixture entries remained. The empty generated audit root was then
removed.

### Unexpected async-runner rejection is not false-green

```bash
env -u C3_AUDIT_RUN \
  -u INTENTSMITH_TEST_PROJECTS_DIR \
  -u C3_PROJECTS_DIR \
  -u TMPDIR \
  C3_URL=http://127.0.0.1:1 \
  node \
    --import 'data:text/javascript,globalThis.fetch%20%3D%20()%20%3D%3E%20%7B%20throw%20new%20Error(%22FETCH_CALLED%22)%3B%20%7D%3B' \
    tests/attachments-projects.test.js --async-rejection-self-check
```

Result: the deterministic non-server assertions printed
`31 passed, 0 failed, 0 skipped`, but the forced promise rejection printed
`Async test runner error: forced async runner rejection` and the process
correctly exited `1`. The fetch trap did not fire. The preserved failure
runtime contained zero files and zero project/temp entries and was removed.

### Mutation proof

The assignment

```js
const BASE = requireLoopbackBaseUrl(process.env.C3_URL);
```

was temporarily changed to the former fixed
`http://127.0.0.1:3335`. The boundary command returned
`3 passed, 1 failed, 0 skipped`, exit `1`, because the exact-origin test
expected the supplied `C3_URL=http://127.0.0.1:1`. After restoring the
production line, the same command returned `4 passed, 0 failed, 0 skipped`,
exit `0`.

The failed mutation intentionally preserved its isolated direct-run runtime.
It contained directories only and zero files. That exact generated directory
was inspected, removed, and is not recoverable; the final remaining-runtime
count is `0`.

### Registry and disposition regressions

The shared bootstrap regression was qualified outside the process-restricted
sandbox. The worktree temporarily linked the integration checkout's
`node_modules`; both checkouts had package-lock SHA-256
`496a21b7266c3a84a28384cd5b562414796e9e6ec8e884f402bd7ffc235a7d38`.

```bash
ln -s /home/belphareon/Projects/intentsmith-gate0-repro/node_modules node_modules
node tests/harness-exit-code.test.js
unlink node_modules
```

Result: `Temp bootstrap coverage: 40 root tests covered`,
`Harness exit-code meta-test passed`, exit `0`. The dependency symlink was
removed. A prior sandboxed run reached the static coverage check but failed
when nested `spawnSync` returned `EPERM`, exit `1`; the first unsandboxed run
then exposed the absent worktree dependencies (`ERR_MODULE_NOT_FOUND:
better-sqlite3`), exit `1`. These were environment blockers, not qualifying
passes. Their generated runtimes contained zero files and were removed.

```bash
node scripts/validate-test-registry.js
```

Result: `350 runnable programs`, registry SHA-256
`f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5`,
exit `0`.

```bash
node scripts/validate-final-disposition.js
```

Result: `225 records`, manifest SHA-256
`aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e`,
exit `0`.

An earlier command typo placed GNU `env -u` after an assignment. `env` treated
`-u` as a command and returned exit `127`; Node did not start. The corrected
negative command and qualifying result are above.

## Honest suite status

The full registered T3 program was not run because this worktree did not own an
isolated IntentSmith server. Its server-dependent result for this batch is
`BLOCKED(owned-loopback-server+isolated-database)`, not `PASS` and not a
product failure. No server, model, GPU, or full-suite green claim is made.
