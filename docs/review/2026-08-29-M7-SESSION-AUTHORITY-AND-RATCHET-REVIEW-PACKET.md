# M7 session authority and current ratchet — review packet

## Requested verdicts

```text
M7_SESSION_AUTHORITY      = REVIEW_PENDING
M7_REVIEW_FOLLOWUPS       = REVIEW_PENDING
M6_CURRENT_REGISTRY_RATCHET = REVIEW_PENDING
M7_OVERALL                = NOT_ACCEPTED
M7_PROVIDER               = NOT_ACTIVE
M7_TRANSPORT              = ABSENT
```

This packet freezes the transport-free security candidate and the exact
review-followup changes that sit on top of the previously reviewed M7
composition/mobile candidate. It does not request approval for a listener,
network transport, provider activation, production signing, device pairing,
distribution, tag, publish or push.

## Identity and review range

```text
baseEvidenceHead = e75cd2e161928524543b67213f945ae14390c468
productCandidate = 12e1adfc13c8544e40d244308ca6c1b0dd7ed412
productTree      = 283032f3538527543eaf179422459945513eb076
branch           = codex/m7-mobile-contract-integration-20260829
upstream         = absent
push             = not performed
```

Review the complete linear range `e75cd2e1..12e1adfc`. The commits are:

```text
fe14a9fd feat(m7): add durable remote session authority
593edfed fix(m7): audit denied remote authority attempts
00f3805b test(m7): accept session authority module edges
10dbf61a fix(m7): close composition review followups
12e1adfc fix(m7): rebind derived mobile descriptors
```

The earlier verdict at `caaa14ca` remains historical evidence. It does not
automatically cover these product commits.

## Milestone A — durable pairing and session authority

`M7SessionAuthority@1` is a transport-free, dependency-injected repository
boundary. Migration 105 adds six tables for:

- one-time pairing claims containing only a hash of the 128-bit-or-stronger
  claim code;
- exact 32-byte Ed25519 device public keys and pairing generations;
- purpose-bound, single-use server challenges with a maximum 60 second life;
- maximum 900 second sessions with explicit generations and revocation;
- monotonic invocation counters plus single-use nonce digests;
- append-only allowed and denied authority audit records.

The migration fingerprint is
`0669d7418c6a57943503f109037e4cd1e96305cf149efc104f90be1275d16a60`.
All mutation and deletion of authority/audit history is rejected by SQL
triggers. A second repository instance uses the same SQLite truth rather than
process memory, so restart and race cases exercise the actual durable boundary.

### Authority flow to trace

```text
opaque authenticated user authority
  -> issuePairingClaim()
  -> hash only, BEGIN IMMEDIATE, append audit

device claim code + exact Ed25519 public key
  -> claimPairing()
  -> one winner, new pairing generation, append audit

paired device
  -> issueChallenge(OPEN|REFRESH)
  -> signed canonical control request
  -> openSession() / refreshSession()
  -> short-lived generation-bound session

RemoteInvocationEnvelope
  -> authorizeInvocation()
  -> exact device/subject/session/scope/time binding
  -> BEGIN IMMEDIATE counter + nonce consume
  -> trusted immutable authority result
  -> only then may a future listener call the provider
```

The public authority remains `IMPLEMENTED_NOT_ACTIVE`. It imports neither the
server nor a route/listener, opens no socket, has no production key and cannot
activate the in-process provider.

### Denied-attempt evidence

Every public pairing/session/challenge/invocation operation catches a typed
denial and writes a `DENIED` audit before returning the error. Denial evidence
contains safe identities, the exact error code and a digest; it never stores a
raw claim code, server nonce, client nonce, signature, public-key secret
material or request payload. Audit failure is fail-closed as `STORAGE_FAILURE`.

The digest includes the next audit revision, so two byte-identical same-time
denials remain distinct append-only records. Tests exercise a tampered device
proof, repeated fail-closed operator denial and direct SQL tamper.

### Required adversarial questions

1. Can a raw claim code, nonce or signature be recovered from any table or
   audit row?
2. Can two repository instances claim one code, consume one challenge, reuse
   one nonce or accept the same counter twice?
3. Can a structural clone create user authority, or can the default authority
   mint/revoke anything?
4. Does a bad Ed25519 proof leave the challenge unconsumed while still
   producing denial evidence?
5. Does restart preserve counter, nonce, generation, expiry and revocation
   truth?
6. Can SQL update/delete or a connection without the required UDF rewrite the
   history?
7. Does audit-storage failure prevent the denied action from being silently
   returned without evidence?

## Milestone B — review followups

Three prior non-blocking observations were closed rather than carried forward:

1. `scripts/mobile-release-evidence.mjs` now retains its own APK and AAB bytes,
   hashes those retained copies, records both volatile `path` and stable
   `retainedPath`, and derives the qualifier from the exact release
   classification. A later Gradle rebuild can no longer make the manifest
   appear to point at different bytes.
2. The operation-list query-plan test extracts and explains the production CTE
   with both `LEFT JOIN`s. It requires the main keyset index and the two exact
   unique lookup indexes, rather than proving a simplified one-table query.
3. `m7-session-authority.test.js` uses the same direct-test isolation bootstrap
   as the current branch, removing branch-dependent harness behavior.

The final gate found one additional real ratchet failure: changing the session
contract digest changed the simulator and candidate-client descriptor bytes,
but their derived pins were stale. The first gate failed exactly there. Commit
`12e1adfc` updates both canonical pins; the simulator then passes all 15 checks.

## Milestone C — M6 current registry ratchet

The registry now contains:

```text
total programs          494
ACTIVE                  400
HISTORICAL               15
BLOCKED                  79
ACTIVE + required       395
offline required        268
database required        66
profile gate total      334
registry fingerprint    bf26d0a5585fb202120bf49175129e090c8de393aa4a74e85ca7cb0d344effb5
```

The locked M6 plan contains an explicit M7 session-authority sentinel and an
omission negative regression. The nightly Gate 0 policy pin is the exact
compact registry JSON hash above and its profile counts are `268 + 66 = 334`.
Review must establish that deleting the required M7 program makes the plan
invalid rather than merely changing a documented count.

## Evidence

### Focused and structural

```text
m7-session-authority                  9/9 PASS
mobile-remote-session-contract       12/12 PASS
mobile-remote-core-simulator         15/15 PASS
m7-operation-control-adapters         7/7 PASS
mobile-android-release               15/15 PASS
m6-candidate-plan                    18/18 PASS
artifact-validation                158/158 PASS
module-boundary-ratchet              13/13 PASS
schema-migrations                    55/55 PASS
m1-model-failover-schema             20/20 PASS
nightly-orchestrator-self-test       PASS / exit 0
registry validation                  valid / 494 / bf26d0a5...effb5
git diff --check                     PASS
```

The accepted module graph is `1 232` edges, `3` cycles and `28` files in
cycles. The session authority adds exactly two reviewed edges.

### Full offline + database gate

The first clean run is deliberately retained because it proves that the
derived-descriptor ratchet was effective:

```text
sourceRevision = 10dbf61a90e824cb57a688054f9a8c22be9a3c73
runId          = 2026-08-29T18-18-03-652Z
result         = 325 PASS / 1 FAIL / 8 BLOCKED
verdict        = FAIL / exit 1
failure        = mobile-remote-core-simulator (stale derived digest)
blocked        = exact unmaterialized PDF/Git/bwrap/prlimit toolchains
reportSha256   = 6ba3d0e4067860542af3a3794f997e7d4c53e7b90de0cab693ea17eed78b0e6e
```

After the two derived pins were corrected, an isolated hash-locked PDF runtime
was installed below the ignored artifact root and every named toolchain was
opened explicitly. The clean candidate result is:

```text
sourceRevision = 12e1adfc13c8544e40d244308ca6c1b0dd7ed412
runId          = 2026-08-29T18-24-22-764Z
result         = 334 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict        = PASS / exit 0
reportSha256   = eb22db09079ce747a59aa8a2a8d5de599f96b47d2f744812a3f4fd0207389644
```

Local reproduction:

```bash
./scripts/install-pdf-runtime.sh \
  --venv "$PWD/.intentsmith-artifacts/pdf-runtime"
export INTENTSMITH_PDF_PYTHON="$PWD/.intentsmith-artifacts/pdf-runtime/bin/python"
export C3_PDF_PYTHON="$INTENTSMITH_PDF_PYTHON"

node scripts/nightly-audit.js \
  --profile=offline,database \
  --concurrency=1 \
  --deadline-hours=8 \
  --allow-blocker=toolchain:python-pdf-runtime,toolchain:bwrap,toolchain:git,toolchain:bubblewrap,toolchain:prlimit
```

The live-chat/model journeys remain intentionally deferred while the model
optimization and selection work changes exact model identities. No LLM result
is represented by this deterministic gate. A foreign long-running soak over an
older SHA remains untouched and is not evidence for this candidate.

## Deliberate stop conditions and operator decisions

The following are blockers for the *next* networked milestone, not defects
hidden by this candidate.

### OD-M7-01 — authentication of every invocation

The current `RemoteInvocationEnvelope@1` carries a session ID, counter and
nonce, but no device signature or channel binding. A stolen session envelope
could therefore be modified with a higher counter and different payload before
the transport-free authority sees it.

Recommended decision: add Ed25519 `deviceSignature` to every invocation over
domain-separated canonical bytes containing the complete envelope except the
signature. Verify it before counter/nonce consumption and before provider
authority. A bearer-only session is not recommended. A negotiated symmetric
session MAC is possible, but adds key-agreement, secure-storage and rotation
authority without reducing the existing Ed25519 requirement.

### OD-M7-02 — challenge acquisition on the wire

Open and refresh correctly require a single-use `serverNonce`, but the mobile
contract exposes no request/result message or allowed path that obtains it.

Recommended decision: add exact
`RemoteSessionChallengeRequest@1/Result@1` on
`POST /remote/v1/session/challenge`, bound to device, pairing generation,
purpose (`OPEN` or `REFRESH`), current session revision when applicable, server
identity and 60 second expiry. It must return no session authority and be
single-use at the subsequent signed control operation.

### OD-M7-03 — pairing abuse rate-limit identity

The contract requires at most five claim attempts per ten minutes, but before
authentication every client-provided device/client ID is forgeable. A safe
implementation therefore needs a transport-owned axis.

Recommended decision: on the dedicated direct listener, rate-limit by the
socket-observed remote address plus pairing-claim digest, with an independent
small global safety bucket. Ignore forwarded headers. Supporting a reverse
proxy later must require a separate pinned-proxy contract; it must not be
silently inferred from `X-Forwarded-For`.

### OD-M7-04 — approval capability authority

The remaining `approvals` capability cannot honestly merge the different
legacy approval sources because they do not share one authoritative expiry and
terminal model.

Recommended decision: expose only the accepted M2 approval/effect authority in
M7, with exact expiry and terminal projection, and leave all legacy approval
sources unavailable. Aggregating sources is a larger contract and should not
be guessed inside the listener milestone.

The TLS identity shape itself is already pinned by the candidate contract:
TLS 1.3 plus a SHA-256 SPKI pin. Supplying the production certificate/private
key and binding its public pin to pairing evidence is a later offline operator
ceremony, not something this implementation may auto-generate.

## Requested review output

Please return separate verdicts for:

```text
M7_SESSION_AUTHORITY
M7_REVIEW_FOLLOWUPS
M6_CURRENT_REGISTRY_RATCHET
```

For any `CHANGES_REQUIRED`, include the exact severity, file/line or schema
object, adversarial reproduction and acceptance condition. A pass applies only
to product candidate `12e1adfc`; later product commits require a new pin.

