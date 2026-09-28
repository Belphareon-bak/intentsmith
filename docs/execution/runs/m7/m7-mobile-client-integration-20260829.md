# M7 mobile client and Android integration — 2026-08-29

**State:** `CLIENT_IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PRODUCTION_TRANSPORT_BLOCKED / PRODUCTION_SIGNING_NOT_AUTHORIZED`

## Binding

- integration base: `99005858bed7737c7d3caac0f2542293f6c8fcc5`;
- source mobile candidate: `7cf1c8b77e04697115a456adf356ee56db4ce9e7`;
- product import: `ac1ee5ac6d29326cc91f3188b9858377da669390`;
- exact product candidate: `6a5094edbacdac0fd0f5eeaa09218ffb23254193`;
- candidate tree: `a86f0717b11bd4e5cf8bf4405275170ff2d5b3e6`;
- branch: `codex/m7-mobile-contract-integration-20260829`, without upstream.

The source branch was not merged wholesale. Ninety-one mobile-owned source
files were compared by Git blob identity and match `7cf1c8b7` byte-for-byte.
The current M7 connector files from candidate `54a10fd0` were retained. The
source branch's legacy gateway, server-side `src/mobile/**`, DB, migrations and
backend tests were not imported.

## Executed evidence

| Boundary | Result |
|---|---|
| registry | 485 runnable; 391 ACTIVE / 79 BLOCKED / 15 HISTORICAL; fingerprint `67e9dd3739e59a3587720cf618bca33b633efe0b68111ea2c0d1e49381dd20e6` |
| mobile gate | `20/20 PASS`, including browser a11y and six M7 contract/session/simulator programs |
| Android source/release boundary | `11/11 PASS` |
| module ratchet | `13/13 PASS`; 1 212 edges, 3 cycles, 28 files in cycles; exact accepted edge `src/mobile/client/app.js -> src/mobile/client/remote-core-v1.js` |
| artifact boundary | `158/158 PASS` |
| M6 locked-plan compatibility | `16/16 PASS` |
| nightly orchestrator self-test | PASS with 325 offline+database programs |
| full offline+database gate | `325 PASS / 0 FAIL / 0 BLOCKED / 0 TIMEOUT / 0 SKIPPED` |

The passing gate ran from `2026-08-29T01:20:32.918Z` through
`2026-08-29T01:24:22.681Z`, with serial execution and exact source revision
`6a5094ed`. Its report SHA-256 is
`74bb3526703e28ea692c56fe7fca61a5b6df74bd7eace2eea4dec89df5d6c9cb`;
inventory SHA-256 is
`ac796619dba5d3aa7f6c4126081229ca7a857bb34f16add78f4967fa3c0e5a22`.
The raw files remain under
`.intentsmith-artifacts/m7-mobile-client-offline-database-rerun-20260829/2026-08-29T01-20-32-886Z/`.

The preceding diagnostic run is retained rather than hidden. It returned
`323 PASS / 2 BLOCKED` because the caller supplied a relative PDF interpreter
path, which the runner correctly rejected as
`toolchain:python-pdf-runtime:invalid-executable-authority`. Report SHA-256:
`91f3ad8b5153a29acc10496d24528815e3230d4df1d749c288b24d2363da1985`.
The successful rerun supplied the same absolute private interpreter path in
both supported environment variables; both PDF programs then executed and
passed.

## Android host evidence

`npm ci --offline --prefix mobile-app` installed 98 lockfile-backed packages
and reported zero vulnerabilities. Capacitor synchronized the single reviewed
client into the Android shell. A JDK 21 / Android SDK offline Gradle run with
`--rerun-tasks` executed all 129 tasks and passed unit, lint and debug assemble.
The unit report contains one test, zero failures/errors/skips. The transient
debug APK SHA-256 is
`f3d962fe9bc2b0afd995d1e827254ddd0cc4d852f740b1c7b84f783912574f8f`;
lint HTML SHA-256 is
`1f1f0296cea30a6f7a71a99bbd7899af1f77cbce2e67858ba70f1c2d527e2c69`.

This is host/debug evidence only. It is not a production-signed artifact,
device/TalkBack result, transport test or distribution receipt. No production
private key was generated, imported or read.

## Preserved boundary and remaining work

- `remote-core-v1` remains a consumer pin and fails closed with
  `remote_core_transport_not_implemented`; it never falls back to `/m1`.
- `legacy-m1-dev` is explicit development mode, not the production M7 route.
- No server route, listener, DB schema, M2/M5 authority, provider or public
  network surface changed in this block.
- No Ollama, live LLM, physical GPU, production signing, device run, push, tag,
  publish, rotation or history rewrite occurred.
- M7 still needs a reviewed in-process provider/read model, operation journal,
  session/pairing/revocation authority, transport isolation, physical device
  matrix and a separately authorized signing/distribution ceremony.

The independent review verdict is still pending. Focused/full green evidence
does not mean `REVIEW_PASSED`, M7 acceptance or production readiness.
