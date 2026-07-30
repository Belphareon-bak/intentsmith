# Gate 0 evidence: repaired E2E 81

Candidate:

- branch: `codex/intentsmith-1.0`;
- integration commit:
  `fab2c5179c04e26d3908933ac6cbf0e68871b931`;
- reviewed code-only source commit:
  `34335be9e5ce92aba2fd44522248fa7b18070195`;
- integrated candidate blob:
  `feccaacd52f0850f303f9ab2e27d1b23ef8b2362`;
- execution date: 2026-07-30 Europe/Prague.

## Repair

The suite has no setup-dependent return. It requires exact create, retrieval,
update, archive, restore, soft-delete and hard-delete contracts. Two initial
turns must produce exactly four persisted messages, archive must preserve the
same IDs, roles and contents, and a resumed turn must produce exactly six
messages. The context canary appears only in the first user prompt and must be
recovered after both a follow-up and archive/restore.

Independent review found one remaining weak content check in the code-only
source commit: the named recursion code example accepted one keyword. The
integrated candidate strengthens it to require a fenced function definition,
`return`, and a call by that function to itself.

## Exact post-commit checks

```bash
git rev-parse HEAD
git rev-parse HEAD:tests/e2e/81-conversation-lifecycle.e2e.js
node --check tests/e2e/81-conversation-lifecycle.e2e.js
node --input-type=module -e 'import { readFileSync } from "node:fs"; const s=readFileSync("tests/e2e/81-conversation-lifecycle.e2e.js","utf8"); const tests=(s.match(/await testAsync\(/g)||[]).length; const bounded=(s.match(/\}, MODEL_TIMEOUT\);/g)||[]).length; if(tests!==18||bounded!==3||/\bassert\s*\(\s*true\b/.test(s)||/\breturn\s*;/.test(s)) process.exit(1); console.log(`E2E81_STATIC_PASS tests=${tests} boundedModelTurns=${bounded}`);'
node scripts/validate-test-registry.js
node scripts/reconcile-ffd-e2e-registry.js
node scripts/validate-final-disposition.js
env HOME=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/home \
  TMPDIR=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/tmp \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/runtime/persistence.sqlite \
  node tests/chat-persistence.test.js
env HOME=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/home \
  TMPDIR=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/tmp \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/runtime/archive.sqlite \
  node tests/archive-lifecycle.test.js
env HOME=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/home \
  TMPDIR=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/tmp \
  C3_DB_PATH=.intentsmith-artifacts/g0-e2e-81/post-fab2c51/runtime/routes.sqlite \
  node tests/routes-smoke.test.js
curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:11434/api/tags
```

| Check | Result | Exit |
|---|---:|---:|
| candidate HEAD | `fab2c5179c04e26d3908933ac6cbf0e68871b931` | 0 |
| E2E 81 blob | `feccaacd52f0850f303f9ab2e27d1b23ef8b2362` | 0 |
| syntax | no diagnostics | 0 |
| static boundary check | `E2E81_STATIC_PASS tests=18 boundedModelTurns=3` | 0 |
| test registry | 350 programs; SHA-256 `0a652994c7d9dc5252b15e9eb8647e8dbc59967b508c2bf80cd6d516ecf15735` | 0 |
| E2E reconciler | 78 suites; 77 `BLOCKED`, 1 `KNOWN_DEFECTIVE` | 0 |
| disposition validator | only E2E 80 remains bare | 1, expected red |
| chat persistence | 35 passed, 0 failed | 0 |
| archive lifecycle | 47 passed, 0 failed | 0 |
| route smoke | 49 passed, 0 failed | 0 |
| local Ollama probe | connection refused | 7 |

The original code-only source blob ran on an isolated server and reported
18 passed, 0 failed, exit 0, but its log contained a recovered CUDA OOM and it
used the shared system Ollama daemon. The strengthened integrated blob could not
be rerun because the local daemon was unavailable. Neither execution qualifies
as a complete runner-owned model fixture, so the D-018 terminal state is
`DEFERRED(owned-server+isolated-database+ollama+pinned-model+gpu+sufficient-gpu-vram)`.
