# Gate 0 evidence: repaired E2E 79

Candidate:

- branch: `codex/intentsmith-1.0`;
- integration commit:
  `64a49d419e80d8a49cda5018a663b3baa9d13290`;
- reviewed code-only source commit:
  `3168de7d55968057aae6856460f4f284c5e1607b`;
- candidate blob:
  `73d725a9db9f5c11dcff9a4c63a16327259c2208`;
- execution date: 2026-07-30 Europe/Prague.

## Repair

All ten chats use the bounded fail-closed helper. Deterministic math requires
the exact `15*17 = 255` result and `LOCAL/local.math` metadata. The date request
captures the local date on both sides of the request and accepts only a
complete matching day, month and year in supported numeric or named-month
formats; a year alone cannot pass.

The remaining oracles require the named response semantics: bubble-sort
structure and adjacent swap, substantive DNS resolution, an explicit
Linux/Windows comparison, a multi-line spring poem, three numbered actionable
installation steps with version verification, a safe explicit refusal, a
greeting and a gratitude acknowledgement. No `assert(true)`, accepted 5xx
branch or dependent early return remains.

## Exact post-commit checks

```bash
git rev-parse HEAD
git rev-parse HEAD:tests/e2e/79-response-semantics.e2e.js
node --check tests/e2e/79-response-semantics.e2e.js
node --input-type=module -e 'import { readFileSync } from "node:fs"; const s=readFileSync("tests/e2e/79-response-semantics.e2e.js","utf8"); const tests=(s.match(/await testAsync\(/g)||[]).length; const bounded=(s.match(/\}, TEST_TIMEOUT\);/g)||[]).length; if(tests!==10||bounded!==10||/\bassert\s*\(\s*true\b/.test(s)) process.exit(1); console.log(`E2E79_STATIC_PASS tests=${tests} bounded=${bounded}`);'
node scripts/validate-test-registry.js
node scripts/reconcile-ffd-e2e-registry.js
node scripts/validate-final-disposition.js
env HOME=.intentsmith-artifacts/g0-e2e-79/post-64a49d4/home \
  TMPDIR=.intentsmith-artifacts/g0-e2e-79/post-64a49d4/tmp \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-79/post-64a49d4/runtime/test.sqlite \
  node tests/artifact-validation.test.js
```

| Check | Result | Exit |
|---|---:|---:|
| candidate HEAD | `64a49d419e80d8a49cda5018a663b3baa9d13290` | 0 |
| E2E 79 blob | `73d725a9db9f5c11dcff9a4c63a16327259c2208` | 0 |
| syntax | no diagnostics | 0 |
| static boundary check | `E2E79_STATIC_PASS tests=10 bounded=10` | 0 |
| test registry | 350 programs; SHA-256 `0a652994c7d9dc5252b15e9eb8647e8dbc59967b508c2bf80cd6d516ecf15735` | 0 |
| E2E reconciler | 78 suites; 77 `BLOCKED`, 1 `KNOWN_DEFECTIVE` | 0 |
| disposition validator | only E2E 80 and 81 remain bare | 1, expected red |
| artifact/manifest regressions | 31 passed, 0 failed | 0 |

An independent source review classified the repaired oracle as acceptable. A
live model-backed run is not claimed: runner-owned server and database,
available Ollama, pinned model, GPU and sufficient free VRAM were not all
established as one reproducible fixture. The D-018 terminal state is therefore
`DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)`.
