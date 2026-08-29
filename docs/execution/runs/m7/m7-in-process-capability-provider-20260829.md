# M7 transport-free capability provider — 2026-08-29

**State:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PROVIDER_NOT_ACTIVE / TRANSPORT_ABSENT`

## Binding

- base evidence HEAD: `403ece7f75b3a9aa0336177112c5e5eee882c55b`;
- exact product candidate: `c5b50589d927b57550ca912ce84623555cc68750`;
- candidate tree: `c147f7ff0f6dbec825360feb607f44871c5ce516`;
- registry: 486 runnable, 392 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `a47d511f71c1528caa42d60fb010abd8211d0130738c67b48cfad3d45b95e943`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream.

## Implemented boundary

`src/remote/m7-in-process-capability-provider.js` is generic over the pinned
candidate requirements, manifests and validators. It imports no contract,
server, route, DB, session or network module and exposes no listener. A
capability is available only when all of its operation handlers exist and each
mutation capability also has a journal.

For each invocation the provider validates the exact four-field envelope and
request contract before calling authority, requires every exact operation
scope, attenuates handler context to those scopes, freezes cloned inputs,
routes mutations through an at-most-once journal callback, validates the
request/result pair and returns a frozen clone. Unknown operations, versions,
handlers, incomplete capabilities, malformed authority decisions and foreign
results fail with typed M7 provider errors.

The provider stage is `IMPLEMENTED_NOT_ACTIVE`. The handlers and journal in
the focused test are fixtures, not claims that production core operations or a
persistent journal exist.

## Executed evidence

| Boundary | Result |
|---|---|
| provider focused | `9/9 PASS`; all seven capabilities and 14 operations |
| mobile gate | `21/21 PASS` |
| module ratchet | `13/13 PASS`; graph unchanged at 1 212 edges / 3 cycles / 28 files |
| artifact boundary | `158/158 PASS` |
| M6 locked-plan compatibility | `16/16 PASS` |
| nightly self-test | PASS with exact 326-program offline+database plan |
| full offline+database gate | `326 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED` |

The passing run started `2026-08-29T01:40:24.504Z`, ended
`2026-08-29T01:44:05.848Z` and is bound to exact source `c5b50589`. Raw report:
`.intentsmith-artifacts/m7-provider-offline-database-final-20260829/m7-provider-c5b50589-final/report.json`.

- report SHA-256:
  `6187642159ca0f812e32a80e8ffc0d24d1c8690ddabd6c0eb28ebea3ed5a8f4d`;
- inventory SHA-256:
  `37207437c86681df6512e0c40f8204bb60640ee17f4486f73cf244381b7c83e9`;
- inventory fingerprint:
  `b2992a6e3393f1271cf482c06c6acb981c9c35a09458f6edc49874a89bba9196`;
- options fingerprint:
  `533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20`.

Two interrupted diagnostic runs are retained. Each has `115 PASS / 1 FAIL /
2 BLOCKED / 208 SKIPPED`, `SIGINT`, verdict `FAIL` and exit 1. The first used
the system Python instead of the private PDF runtime; the second supplied the
private runtime but omitted the exact CLI toolchain allowlist. Their report
hashes are respectively `dfcb9565…d6a27` and `4123dec7…2a1a`. They are caller
setup failures, not PASS evidence and not hidden product results.

## Remaining boundary

No production operation adapter, persistent journal, listener, pairing,
session, revocation, remote wire, physical device/TalkBack, production signing
or distribution is claimed. No Ollama, LLM or physical GPU work ran. No push,
tag, publish, receipt, rotation or history rewrite occurred. Independent review
is required before this block can become `REVIEW_PASSED`.
