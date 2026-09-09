# M7 VPN listener / Android release — review result

## Verdicts

```text
M7_DISCONNECTED_REQUEST_PIPELINE = REVIEW_PASSED
M7_VPN_LISTENER_AND_CUSTODY      = REVIEW_PASSED
M7_LOCAL_PAIRING_AUTHORITY       = REVIEW_PASSED
M7_SIGNED_INVOCATION_PATH        = REVIEW_PASSED
M7_CORE_COMMAND_INTEGRATION      = REVIEW_PASSED
M7_ANDROID_REMOTE_COMPANION      = REVIEW_PASSED (source scope — see limits)
M7_RELEASE_RUNTIME_EVIDENCE      = REVIEW_PASSED
M6_CURRENT_REGISTRY_AND_GATE     = REVIEW_PASSED

M7_OVERALL                       = NOT_ACCEPTED
```

`M7_OVERALL` is unchanged and correctly so: no physical VPN, firewall, device or
release-signing evidence exists.

## The conditional session verdict is discharged

The 2026-08-29 `M7_SESSION_AUTHORITY` verdict was bound to one condition — the
authority must not reach any listener until per-invocation signing landed and was
reviewed. That condition is now met, and the verdict stands **unconditionally**.

`authorizeInvocation()` calls
`verifyProof('RemoteInvocationEnvelope@1', input, current.publicKey)`, and the
ordering is right: verification happens after session state and identity binding
(needed to obtain the key) but **before** scope resolution, before the counter
comparison and before the nonce/counter insert. An invalid signature therefore
never burns a counter or a nonce.

The proof bytes are constructed correctly rather than merely present:

```text
exact key set enforced (exactKeys) — no added or omitted fields
deviceSignature excluded from the signed bytes
prefix "IntentSmith/M7/<schemaId>/Ed25519DeviceProof/v1\n"
canonicalized body
```

Because the schema id is inside the domain prefix, a signature minted for
`RemoteSessionRefreshRequest@1` cannot be replayed as an invocation. The envelope
binds `capabilityId`, `capabilityVersion`, `clientCounter`, `deviceId`, `nonce`,
`operationId`, `payload`, `payloadDigest`, `requestId`, `sentAt`, `sessionId`,
`sessionRevision`, `subjectId` and `version` — payload substitution is bound, not
just transport metadata. O-02 is present as a signed
`RemoteSessionChallengeRequest@1`.

## Identity and evidence

```text
productCandidate = 07b582d171eb590d4c4c55ea7a8837bfdf9315e1
productTree      = 78fb2adc88ba9a9d2604f8a837bf3d0cd68503a6
evidenceHead     = f812259d787671358f78d5e789373b39dbfbcd57
```

Every figure was recomputed here and matches: tree hash, registry 510 suites /
416 ACTIVE / 411 `ACTIVE + required`, fingerprint
`73782eec4854f94af66b1f6bf27ea70cee90ed4d173d3da3888eb76f603d5fd9`, module graph
1273 edges / 3 cycles / 28 files. The green report hashes to
`72f8c9e79fcac8ea598206040e50e07e0e80c557e17fa41f80be41f67f62cc96`, binds
`sourceRevision = 07b582d1`, and carries 350 rows with no FAIL, BLOCKED or
TIMEOUT. The fail-closed run is preserved at 342 PASS / 8 BLOCKED, exit 2.

The previous review's observation about handoff commits is fixed. Running the
production validator over `07b582d1..f812259d` returns
`valid: true, evidenceOnly: true, errors: []`.

Focused re-runs on a cleared runtime: artifact validation 158/158, M6 evidence
boundary 13/13, signed bundle 12/12, session authority 11/11, durable limiter
11/11, disconnected pipeline 7/7, transport admission 9/9, core composition 9/9,
mutation mediator 5/5, local pairing route 4/4.

## Pipeline, listener and custody

Execution order is `admit → consume → session → provider`: the admission policy
runs first, the durable limiter second, and only then does anything touch the
session tables. Unauthenticated flood traffic is bounded before it can reach
session state, which is the correct order. The pipeline refuses construction
unless the admission policy and session authority agree on both `serverOrigin`
and `serverIdentityPin`, and both collaborators are checked against their
closure-private genuineness sets.

Activation is gated strictly. `INTENTSMITH_M7_REMOTE_ENABLED` must be exactly
`'true'` or `'false'`; any other value throws at startup rather than being
coerced. The runtime is constructed only under `'true'`, and
`createM7VpnRuntimeConfiguration()` additionally requires an exact systemd
credential directory. A default local start is therefore unaffected. HMAC key
material is zeroed in a `finally` (`key.fill(0)`) and credential material is
scoped rather than retained.

## Release runtime evidence

`MOBILE_M7_RUNTIME_CHECK_IDS` contains exactly the thirteen named checks. The
verifier is written adversarially: exact key sets at every level, path-segment
rejection of `.` and `..`, a re-stat size comparison against the read length to
catch size races, a whitelist for the VPN interface name, and artifact count and
byte ceilings.

## Android — what this verdict does and does not cover

Verified from source: the JavaScript client never holds the device private key —
it delegates to `nativePlugin.sign({schemaId, request})` — and `KeystoreStorage`
generates its key **non-exportably** in `AndroidKeyStore`. `FLAG_SECURE` is set
with a documented debug-only exception. The stage constant is honest at
`IMPLEMENTED_NOT_DEVICE_VERIFIED`.

Not covered: no APK/AAB was built or installed for this candidate, and no device
ran. This verdict is a source review of the companion, not device verification.

## Observations — neither blocking

1. `M7CanonicalJson.java` must produce byte-identical canonicalization to
   `canonicalizeM7SessionValue()` in JavaScript, or every signature fails. The
   failure mode is closed rather than open, so it is not a security risk, but a
   divergence in some edge case — number formatting, non-ASCII escaping, key
   ordering under Unicode — would make the companion unusable in exactly the
   situations nobody tests first. This is the single highest-value thing for the
   physical device run to exercise early, ideally with a shared vector fixture
   asserted on both sides rather than discovered on a phone.
2. A failed VPN activation calls `gracefulShutdown('M7_ACTIVATION_FAILURE', 1)`,
   taking down the entire server including the local UI. Refusing to run degraded
   is the right instinct for a security surface, but the consequence is that a
   mistyped VPN interface costs the operator local access as well. Worth stating
   explicitly in the runbook, with the recovery step being to unset
   `INTENTSMITH_M7_REMOTE_ENABLED`.

## Boundary

No M6 or M7 acceptance, no physical VPN or firewall activation, no production
TLS or HMAC credentials, no device journey, no release signing, no rotation, no
history disposition, no promotion, tag, publish or push. Live LLM and GPU work
remains deferred. Any product commit after `07b582d1` invalidates these verdicts.
