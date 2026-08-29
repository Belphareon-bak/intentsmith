# M7 settings and stored-information core adapters — 2026-08-29

**State:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
NOT_ACTIVE`

## Binding

- base conversation-core evidence HEAD:
  `35a82422daeab645e503e285436cc4068de4b97c`;
- exact product candidate:
  `1b0654f01784a9ae41c2cfbb1e5345c74b6f3c6e`;
- product tree: `ea40b1bc3559302d425afe4b0cb2278e79cc57a6`;
- implementation commit: `31f46cac`;
- module-boundary commit: `5e0373d1`;
- documentation pin: `9296338c`;
- M6 migration-evidence rebinds: `cbdb0300`, `1b0654f0`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream;
- registry: 490 runnable, 396 ACTIVE / 79 BLOCKED / 15 HISTORICAL;
- registry fingerprint:
  `f322661b468ed5dc202ba6c37743a7002d8b9c251cedbb539b4a5b553f72a53a`.

## Implemented boundary

`settings.read` exposes a fixed five-key projection over production
`user_settings`: density, font size, theme, save-context and save-history.
Unrelated, secret, administrative, provider and model-activation bytes never
enter the projection. Missing values use established UI defaults; malformed
storage fails closed. Every item and complete snapshot is content-addressed.

`settings.update` requires a fresh expected revision, a typed value, trusted
device/subject context, the durable M7 operation journal and an injected
mediator that explicitly names `ApprovalGrant@1`, `EffectRequest@1` and
`EffectResult@1`. Pending or rejected mediation cannot call the supplied write
closure. The exact returned transaction document determines the new revision,
so a post-write reread race cannot relabel another writer's bytes.

Migration 102 adds append-only, subject/project-partitioned manual notes.
`stored-information.append` authorizes project scope before mediation and
again immediately before insert. `stored-information.list` checks authority
before protected content, rechecks before release and uses an HMAC cursor bound
to device, subject, filters and the complete snapshot. Legacy task and
long-term memory have no mobile subject authority and therefore return typed
unavailable results instead of false empty pages.

The adapters import neither transport nor route/server/session authority. The
production mutation mediator is deliberately absent, so no write capability is
advertised or active.

## Executed evidence

| Boundary | Result |
|---|---|
| settings/information adapters | `10/10 PASS` |
| provider + durable journal | `11/11 + 12/12 PASS` |
| mobile contract/provider | `11/11 + 14/14 PASS` |
| mobile gate | `25/25 PASS` |
| schema migrations | `55/55 PASS`; 89 migrations |
| M1 exact schema oracle | `20/20 PASS` |
| M6 runtime/technical/release evidence | `8/8 + 8/8 + 13/13 PASS` |
| module ratchet | `13/13 PASS`; 1,219 edges / 3 cycles / 28 files |
| artifact boundary | `158/158 PASS` |
| registry | valid; 490 runnable; exact fingerprint above |
| complete offline+database gate | `330/330 PASS`; no non-PASS result |

The green run started `2026-08-29T03:45:01.568Z`, ended
`2026-08-29T03:48:45.139Z`, returned exit 0 and stayed bound to exact source
`1b0654f01784a9ae41c2cfbb1e5345c74b6f3c6e`.

Raw artifacts:

- report:
  `.intentsmith-artifacts/m7-settings-information-offline-database-final-20260829/2026-08-29T03-45-01-525Z/report.json`;
- report SHA-256:
  `cd8b180e7f6785ab92b0588f0cbc5dd34a096678b5ea58c3fb3767a84d24c11d`;
- inventory SHA-256:
  `c4338a92c49fbed2f2d073c5e13945e9bda8bffe31b37dc3994d1047ee5693f2`;
- inventory fingerprint:
  `74d6c43bb77e2acc8f74a244bcbdd04b024c524905249100593a55f0a528f7b5`;
- options fingerprint:
  `533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20`.

The run used the existing isolated PDF runtime and declared local toolchain
allowlists. It used no model, Ollama, GPU, network listener or mobile device.

## Red intermediate evidence

The first complete run, on source `9296338c`, returned `328 PASS / 2 FAIL`,
verdict `FAIL`, exit 1. The failures were not product adapter failures: they
were exact migration/registry drifts in `m6-runtime-evidence.test.js` and
`nightly-orchestrator-self-test.js` after migration 102 made the count 89 and
the registry 490. Report SHA-256:
`6f3f299358e00ffb1a476eb550ffcc144299733ec0d9c3567b3f3dff6beb92e9`.

After those fixes, source `cbdb0300` returned `329 PASS / 1 FAIL`, verdict
`FAIL`, exit 1. `m6-technical-evidence.test.js` still constructed an upgrade
receipt with 88 migrations. Report SHA-256:
`3109c60dc400a97e3bb9b5aa37446219d5edb68f2b07c91ae960575df1fd251b`.

Both failures are retained because they demonstrate that the M6 evidence
contracts remained fail-closed under M7 schema growth. The final one-line
fixture rebind is part of the product candidate, not hidden in later evidence.

## Limits and review boundary

The new manual-note table is ordinary user-data storage, not a signed authority
ledger. Mutations are not production-composed until a reviewed mediator can
bind the remote operation to the existing approval/effect authority. A missing
setting maps to a documented UI default, while malformed bytes fail. A list
without a project can include only global notes and notes from projects the
trusted authorizer allows.

No live LLM/chat-quality, Ollama, physical GPU, pairing, device, listener,
signature, rotation, history rewrite, push, tag or publish action ran. The
separate M6 24-hour soak continued unchanged over its older exact candidate;
because the schema has since changed, it is diagnostic historical evidence,
not transferable release evidence.

Independent review is required. This report is not M7 acceptance or runtime
activation.
