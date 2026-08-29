# M7 composition and mobile binding remediation — 2026-08-29

**State:** `REMEDIATION_IMPLEMENTED / FULL_OFFLINE_DATABASE_GATE_GREEN /
INDEPENDENT_RE_REVIEW_REQUIRED / M7_NOT_ACCEPTED / PROVIDER_NOT_ACTIVE /
TRANSPORT_ABSENT`

This report supersedes the implementation claims in
`m7-core-composition-mobile-release-binding-20260829.md` for the findings raised
against candidate `d43e7ada`. It does not replace that document as historical
evidence and does not turn its `CHANGES_REQUIRED` verdict into a pass.

## Exact binding

- rejected product candidate:
  `d43e7ada01d6e5de38a06d79021bde8909d2eba3`;
- remediation implementation:
  `c27a62da1079ba238547eb0b3f454eb1232f0173`;
- M6 migration-authority test correction:
  `b243c7d13b858c2ab65b5489b532ce6a8ae854d8`;
- exact re-review product candidate:
  `57ac2a4d3154df8016aea907ead5c68c4606d237`;
- product tree:
  `b7131f405ffa74e0fa06297e608cf3ec397b5fdc`;
- remediation range:
  `d43e7ada01d6e5de38a06d79021bde8909d2eba3..57ac2a4d3154df8016aea907ead5c68c4606d237`;
- cumulative composition/mobile range:
  `1d04bd42bbaa79e9da1fe2b6b59b6589ce8efad5..57ac2a4d3154df8016aea907ead5c68c4606d237`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream;
- registry: 493 runnable, 399 ACTIVE, 79 BLOCKED, 15 HISTORICAL;
- ACTIVE+required programs: 394;
- registry fingerprint:
  `a316db7caa97b966c557d2f6f4c2934048b0b7351eb1eac22c144e5479f96479`.

## Finding closure

### M7-R1 — invalid review range and split documentation

The correct cumulative base is
`1d04bd42bbaa79e9da1fe2b6b59b6589ce8efad5`. The prior packet and ledger were
corrected without rewriting the rejected verdict. ROADMAP and SYSTEM-MAP now
both retain `CHANGES_REQUIRED / REMEDIATION_IMPLEMENTED / RE_REVIEW_REQUIRED`.
The missing historical `318/15` report remains recorded as red, recoverable in
the user's Trash and absent from its original path; Trash was not modified.

### M7-R2 — unbounded operation list

`operation.list` no longer reads an entire subject partition and then performs
per-operation lookups. The repository now executes one joined query with:

- SQL-side device, subject, capability and terminal-state filtering;
- a bounded page size of 1–100 plus one look-ahead row;
- keyset ordering over the snapshot sequence and operation identity;
- a snapshot upper bound carried in the HMAC-authenticated cursor;
- indexes introduced by migration 104 for the partition and terminal joins.

The 240-operation adversarial test checks stable continuation, exclusion of a
post-snapshot insert and the query plan. The cursor cannot be replayed under a
different device, subject, filter or workspace revision.

### M7-R3/R4 — incomplete AAB and plugin binding

Both archives now contain the same canonical source manifest derived from the
exact Git candidate. APK and AAB are independently observed and compared for:

- application ID, version code/name, min SDK and target SDK;
- embedded source revision;
- signer SHA-256, with separate expected APK and AAB signer inputs;
- network-security resource and decoded resource tree;
- exact client assets, Capacitor config, runtime config, CSP and RemoteCore
  contract digests;
- a canonical Capacitor plugin registry derived from the pinned package graph.

The AAB path uses digest-pinned bundletool 1.18.1
(`a73341a7…2ceac`) to inspect its manifest and to derive a universal APK for the
native network-security observation. Equality of two archives alone is not an
authority: both must match the source-derived manifest and plugin expectation.

### M6-R01/R02 — stale candidate plan and Gate 0 registry pin

The locked plan once covered 369 programs while the registry had grown to 371;
the missing required suites were exactly `signed-authority-bundle` and
`signed-authority-receipt`. The candidate-plan contract now:

- derives the exact current ACTIVE+required set (394 programs);
- names both signed-authority suites as mandatory sentinels;
- contains a negative regression proving either omission fails closed.

`nightly-orchestrator-self-test` passes with the current fingerprint. The
offline/database gate below selects 333 programs because it is a profile slice;
it is not represented as the complete 394-program M6 release plan.

## Focused verification

| Boundary | Result |
|---|---:|
| M7 operation control | `7/7 PASS` |
| Android release boundary | `15/15 PASS` |
| complete mobile gate | `28/28 PASS` |
| M7 core composition | `5/5 PASS` |
| M6 locked candidate plan | `17/17 PASS` |
| M6 technical evidence | `8/8 PASS` |
| M6 runtime evidence | `8/8 PASS` |
| schema migrations | `55/55 PASS` over 91 migrations |
| M1 migration oracle | `20/20 PASS` |
| module boundary ratchet | `13/13 PASS`; 1,230 edges / 3 cycles / 28 files |
| artifact boundary | `158/158 PASS` |
| registry validation | PASS; exact fingerprint above |
| nightly orchestrator self-test | PASS |

## Exact full offline/database gate

The final run used a clean detached checkout at the exact product candidate,
one runner and an artifact root outside that checkout. It started at
`2026-08-29T06:05:33.917Z` and ended at `2026-08-29T06:09:19.872Z`:

```text
333 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict = PASS
exitCode = 0
```

- report:
  `.intentsmith-artifacts/m7-remediation-offline-database-20260829/57ac2a4d-final/m7-remediation-57ac2a4d-final/report.json`;
- report SHA-256:
  `923070a9982654f83d5bad9074ddc347f67882a0bb6e4c370e73126fb65e5fcc`;
- inventory SHA-256:
  `f1d9a9245d3e53cbf483c35a52b29fefdc62e8d687e8aad17911521dfb19f6e6`;
- checkpoint SHA-256:
  `2646e3ed8a7e8ac0d6d3028a0d12e3434cfe2ba763e372c8edd98ddc7faf7106`;
- inventory fingerprint:
  `840682a9949883150ae224138aa92d13f64de38ee22614a0ff4078cf902c9305`;
- options fingerprint:
  `9b0f5493445525ad6af6160e8903e9fb9a7cc39d9424cab67ddba788405ae59b`.

All M6 ratchet sentinels, both signed-authority suites, M7 operation control and
the Android release suite are PASS entries in this exact report.

### Preserved red diagnostics

No failed run was recolored:

| Candidate/run | Counts | Exact cause | Report SHA-256 |
|---|---:|---|---|
| `c27a62da-final` | `87 PASS / 51 FAIL / 195 SKIPPED` | isolated checkout installed with `--ignore-scripts`; native `better-sqlite3` binding absent | `36083e1f906d9505361e88090af9be2ff88bd90f2ceffdde57cf5289a2ea7a30` |
| `c27a62da-retry-01` | `332 PASS / 1 FAIL` | M6 technical fixture still pinned migration count 90 instead of 91 | `cd50b8261cce5f768cf4e4501edf93b63702faba03ec29118efac74ee6bd24e7` |
| `b243c7d1-final` | `332 PASS / 1 FAIL` | artifact census expected one fewer test line | `60076fb66e53de88cb7feefb49c7aea9e913c96c447144e4e2c57e35e59fb18a` |

The environment error was corrected by a normal offline install. The two real
oracles were corrected in product commits and then exercised by the final
green run.

## Physical Android proof

The clean detached candidate produced a fresh APK and AAB. This is deliberately
classified `THROWAWAY_DEBUG_SIGNED`, not as release-ready:

- evidence directory:
  `.intentsmith-artifacts/mobile-release/57ac2a4d3154/`;
- evidence manifest SHA-256:
  `1ca7ceeaba081cdfd2f21dc539fc9d9e328723e6cfb52dec23327e822edb6acc`;
- APK SHA-256:
  `195c80b3ffbddc90aec74c3ca13e096053f4dcdae8a0fc424a43089f9c4c09c1`;
- AAB SHA-256:
  `2094c2947ea9731bf1721cb4a54a7056b562dc210ac6a52e9578995f825db9d6`;
- APK and AAB signer SHA-256:
  `4be471bc1064e2732735c18358ed1a118449c79a0f1ba3ff55d0b36bacb8951c`;
- source manifest SHA-256:
  `cd573d29a191d84e7679bf6caeaf240855aa7b307d2296c6a29f1f13a88b92fe`;
- decoded network-policy tree SHA-256 for each archive:
  `30d476e0e9c5af330541794a506690ce996ec81301808f2bedde19cb75891aa2`;
- mobile runtime audit: 0 vulnerabilities.

The manifest truthfully records `releaseTransportReady: false` and two release
blockers: the absent M7 listener/auth/pairing/wire transport and the Capacitor
global-fetch patch that must be replaced or disabled before production.

## Non-transferable and deferred evidence

- The already-running M6 24-hour soak targets an older candidate and cannot be
  transferred to `57ac2a4d`; it was not stopped or modified.
- Live LLM/chat-quality, Ollama and GPU tests remain postponed by operator
  instruction while model optimization is in progress.
- No device/TalkBack matrix, production signer, distribution, listener,
  pairing, revocation, wire transport, M5/M6 receipt, rotation, history rewrite,
  promotion, tag, publish or push was performed.

Therefore the implementation is ready for independent re-review, but neither
M6 nor M7 is accepted by this report.
