# M7 conversation core adapters — 2026-08-29

**State:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
NOT_ACTIVE`

## Binding

- base project-core evidence HEAD: `0f6d212cae337175caaf5f6311d7f732e8497f2b`;
- exact product candidate: `91f022a9a2948f7f2ad87d3f88610d798bbdb1f3`;
- candidate tree: `ba1182e839decb90aea0911890943f8cfbc9cec9`;
- implementation commit: `6da1e94ddd70ca2412c08bd86955dc004248ebe6`;
- module-baseline commit: `4ee0a1d9868f481178e1947feafb48cea29912b5`;
- candidate documentation pin: `91f022a9`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream;
- registry: 489 runnable, 395 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `9a98ae69b064498816933764d1694646b3d24ce25357aedf09f7f88a3add594b`.

## Implemented boundary

`conversation.list` reads active and archived non-deleted conversations from
SQLite, verifies the trigger-maintained message count against an actual count,
authorizes each row before and after projection, rereads the catalog and emits
only a complete authorized snapshot. Deleted, denied and absent identities do
not appear. Null/empty legacy titles map to a fixed non-sensitive label.

`conversation.history` reads metadata first, authorizes before message bytes,
then captures the conversation and at most 10,000 messages in one synchronous
SQLite transaction. It checks the stored count, maps exact protected rows,
re-authorizes and rereads the snapshot. Pages start with the newest messages,
stay chronological within each page and continue toward older messages. The
shared cursor is canonical HMAC-SHA-256 bound to capability/version,
operation, device, subject, query, complete snapshot and offset. Tamper,
cross-subject replay and drift return typed error pages without partial data.

`conversation.execute` accepts only an injected M1 command port. The adapter
authorizes an active conversation before execution, validates exact M1 result
identity and checks conversation state/authority again before release. A
pre-effect denial becomes an exact terminal M1 error. A throw, invalid result
or post-effect revocation throws into the journal and is durably `UNKNOWN`;
the adapter never relabels a possibly applied effect as rejected.

The generic provider now requires its journal for every non-read operation.
Candidate mutations keep `operationId`; accepted M1 conversation commands use
their request-bound `requestId`. The v101 append-only event validator accepts
only a validator-clean exact `ConversationResult@1` for
`conversation.execute`. Restart replay returns those exact bytes without a
second handler call; mutation replay keeps its existing `replayed: true` form.

New ChatController user and assistant rows persist the same requested M1
`turnId`. Non-M1 local callers receive a generated identifier. Legacy rows
without M7 metadata use `turn:message:<id>` on read. Message status is a row
status; cancellation/timeout terminals not historically persisted are not
invented.

No module in this block imports a route, server, session, listener or network
authority. The provider is not composed into production.

## Executed evidence

| Boundary | Result |
|---|---|
| conversation adapters | `8/8 PASS` |
| provider + durable journal | `11/11 + 12/12 PASS` |
| M1 finalizer correlation | `7/7 PASS` |
| project adapters | `8/8 PASS` |
| mobile gate | `24/24 PASS` |
| schema migrations | `55/55 PASS`; 88 migrations |
| M1 exact schema oracle | `20/20 PASS` |
| DB bootstrap meta-test | PASS; 120 database-reachable roots protected |
| nightly orchestrator self-test | PASS; 329 = 267 offline + 62 database |
| module ratchet | `13/13 PASS`; 1 217 edges / 3 cycles / 28 files |
| artifact boundary | `158/158 PASS` |
| registry | valid; 489 runnable; exact fingerprint above |
| full offline+database gate | `329 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED` |

The green full gate started `2026-08-29T03:10:57.094Z`, ended
`2026-08-29T03:14:46.431Z`, returned exit 0 and stayed bound to exact source
`91f022a9a2948f7f2ad87d3f88610d798bbdb1f3`.

Raw report:
`.intentsmith-artifacts/m7-conversation-core-offline-database-green-20260829/m7-conversation-core-91f022a9-green/report.json`.

- report SHA-256:
  `42047c9f2f09d9f6126148c43078fe613d9d2c56801b27dcbb94a7127f64e398`;
- inventory SHA-256:
  `27d4d07a6d3ced0768a0c749b29f89eb4e984edf3fb5a83cb2e6cb4a4af6d123`;
- inventory fingerprint:
  `5dec6528b9a40fab73cd3a05307d0ce9bc48ebc796bceafff2114b357df4cdfd`;
- options fingerprint:
  `533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20`.

The PDF interpreter was the existing isolated runtime at
`.intentsmith-artifacts/m7-gate-runtime/pdf-runtime/bin/python`, verified with
ReportLab 5.0.0, Pillow 12.3.0 and charset-normalizer 3.4.4. Git, prlimit,
bwrap/bubblewrap and that PDF runtime were the exact declared local
toolchains. The run used no model, Ollama, GPU, external network or public
server.

## Red and blocked intermediate evidence

The module ratchet first returned `12/13` and named only
`src/remote/m7-conversation-core-adapters.js -> src/remote/m7-core-cursor.js`.
The exact writer accepted it against implementation `6da1e94d`; no cycle or
cyclic membership grew.

The first full gate on `4ee0a1d9` truthfully returned
`320 PASS / 1 FAIL / 8 BLOCKED`, verdict `FAIL`, exit 1. The sole FAIL was the
artifact oracle detecting ROADMAP's stale 1,216-edge census. The eight BLOCKED
rows came from omitting all local toolchain allowlists. Report SHA-256:
`ea3a1bceded8b37083baa23b3638a3cf4403193c8a431c786328646e02743882`.

The second run on corrected candidate `91f022a9` returned
`327 PASS / 0 FAIL / 2 BLOCKED`, verdict `BLOCKED`, exit 2. Both rows named
`toolchain:python-pdf-runtime:invalid-executable-authority`: the allowlist was
present but the absolute interpreter environment was not. Report SHA-256:
`d49b62192d77cd0b6c79d74691878da4bb06b705111625522ba2582120357be7`.

Neither intermediate run is presented as green. The third run changed no
product bytes and supplied the existing exact runtime authority.

## Accepted implementation limits

The adapter intentionally fails the complete conversation projection when a
legacy title/content/metadata row cannot satisfy the candidate payload instead
of truncating protected data. List scans at most 2,000 rows and history at most
10,000 messages. The list authorization loop is not one SQLite transaction;
the adapter uses row re-authorization plus a complete catalog reread. History
uses a synchronous SQLite snapshot plus final authorization and reread. A
later session generation must still bind both operations before activation.

Legacy message rows do not contain original M1 turn/status evidence. The
fallback identity is explicit and deterministic; cancellation or timeout is
not reconstructed. Archived conversations are readable but not executable.

No live LLM/chat quality, Ollama, physical GPU, device, pairing, signature,
rotation, history rewrite, push, tag or publish action ran. The separately
owned M6 24-hour soak remained alive and untouched.

Independent review is required. This report is not M7 acceptance or runtime
activation.
