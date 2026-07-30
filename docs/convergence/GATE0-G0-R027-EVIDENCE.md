# G0-R027 npm audit truthfulness

## Defect

Two public tool aliases implemented the same audit with different false-green
paths:

- `deps.vuln` executed a shell command ending in `|| true`, so the process exit
  status was irretrievably lost. An npm error envelope without a
  `vulnerabilities` field was then treated as an empty, clean report.
- `npm.audit` caught every nonzero process exit and returned any JSON from
  `err.stdout` as a successful tool value, without distinguishing a valid
  vulnerability report from an npm/network error.

Both aliases also expose `fix`, which can modify the lockfile and installed
dependencies, while their capability metadata claimed read-only,
side-effect-free, auto-executable behavior.

## Repair

- `src/tools/npm-audit.js` owns one shell-free `spawnSync` contract.
- Exit `0` is accepted only with a valid report containing zero
  vulnerabilities.
- Exit `1` is accepted only with a valid report containing at least one
  vulnerability; this preserves npm's documented vulnerability outcome
  without hiding it as a process failure.
- Npm error JSON, malformed JSON, invalid or inconsistent report fields,
  unexpected nonzero status, timeout, signal, missing status and spawn failure
  are terminal structured errors.
- Neither stderr nor raw error output is copied into the returned error object.
- `npm.audit` and `deps.vuln` are conservatively classified as mutating,
  confirmation-required `exec` capabilities because their existing optional
  `fix` parameter is part of the public contract.

## Offline regression contract

The already registered
`IS-T1-TESTS-TOOL-REGISTRY-E2E-TEST` remains T1/offline and now:

1. shadows `npm` with a private executable below the suite's atomic temporary
   root;
2. supplies a schema-valid report with the sentinel
   `INTENTSMITH_SENTINEL_VULNERABILITY` and exit `1`;
3. asserts the exact normalized summary and command arguments;
4. rejects npm error JSON, malformed output, inconsistent status, unexpected
   status, timeout, signal and spawn failure;
5. places `npm_config_cache` below the same owned root and has the fake process
   report the path actually observed;
6. exercises `audit fix --json` only against the fake executable. No real
   dependency mutation or network call is made.

The test program and its registry row remain in the same commit; no new
external-network suite is added because there is no additional deterministic
contract that would justify one. A real npm registry observation belongs to a
later explicitly external profile and is not required to prove the local
process/parser semantics.

## Initial focused proof

| Command | Result | Exit |
|---|---|---:|
| `node --check src/tools/npm-audit.js && node --check src/tools/registry.js && node --check tests/tool-registry-e2e.test.js` | all three sources parse | 0 |
| sandboxed `node tests/tool-registry-e2e.test.js` | 74 passed, 8 failed; unrelated shell children and the fake executable were denied with `EPERM`/empty child output | 1 |
| same command outside the restrictive child-process sandbox | 82 passed, 0 failed, 0 skipped | 0 |

The sandboxed failure is retained as environment evidence rather than reported
as a product failure.

## Mutation proof

Both temporary source mutations were restored before commit.

| Temporary mutation and command | Result | Exit |
|---|---|---:|
| replace the npm error-envelope guard with `false`; run `node tests/tool-registry-e2e.test.js` outside the restrictive child-process sandbox | named `both audit aliases reject npm error JSON` failure; 81 passed, 1 failed | 1 |
| replace the unexpected-status guard with `false`; run the same command | named `deps.vuln rejects malformed output and unexpected nonzero status` failure; 81 passed, 1 failed | 1 |

## Committed implementation proof

Tested implementation commit:
`d8356507a595e1061a5876543768a450803d866f`.

| Command | Result | Exit |
|---|---|---:|
| `git status --porcelain` | empty before and after the committed runs | 0 |
| `node tests/tool-registry-e2e.test.js` outside the restrictive child-process sandbox | 82 passed, 0 failed, 0 skipped; every audit invocation used the fake npm fixture | 0 |
| `node tests/artifact-validation.test.js` | 64 passed, 0 failed, 0 skipped; 27 risk rows and 27 policy rows agree | 0 |
| `node scripts/validate-test-registry.js` | 350 runnable programs; SHA-256 `f6edc6ccff693284ee01ed159e90faea20e94662892d7b84b2f61efdf35e03b5` | 0 |
| `node scripts/validate-final-disposition.js` | 225 records; manifest `aa95bbc0918daa3f188283297e03562e3a4b8a8d0b178bec126b60a27cd8677e` | 0 |
| `git diff --check d835650^ d835650` plus `node --check` for the new module, registry and test | clean diff; all three sources parse | 0 |

This evidence closes only `G0-R027`. It does not claim a complete deterministic
Gate 0 run, installation result, external npm availability, or a Gate 0
verdict.
