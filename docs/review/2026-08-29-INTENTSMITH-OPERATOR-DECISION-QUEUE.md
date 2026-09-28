# IntentSmith operator decision queue — 2026-08-29

## Current truth

```text
M1-M4 = ACCEPTED

M5 = 8/9 REVIEW_PASSED
     PRIVACY_CHANGES_REQUIRED
     KEY_CUSTODY_CHANGES_REQUIRED
     ACCEPTANCE_BLOCKED

M6 = CURRENT_REGISTRY_RATCHET_REVIEW_PENDING
     KEY_CUSTODY_CHANGES_REQUIRED
     TECHNICAL_REVIEW_CHANGES_REQUESTED
     ACCEPTANCE_BLOCKED

M7 = SESSION_AUTHORITY_IMPLEMENTATION_GREEN
     CURRENT_REVIEW_PENDING
     NOT_ACCEPTED
     PROVIDER_NOT_ACTIVE
     TRANSPORT_ABSENT
```

The deterministic M7 candidate is green at `334/334`; this is implementation
evidence, not acceptance. Live model/chat checks remain intentionally deferred
until the exact optimized model set is frozen.

## Decisions needed before the next networked product milestone

### O-01 — invocation proof

**Question:** must every `RemoteInvocationEnvelope@1` carry an Ed25519 device
signature, or is the short-lived session ID a bearer credential?

**Recommended:** Ed25519 signature on domain-separated canonical bytes of the
complete invocation except the signature. Verify before nonce/counter consume
and before provider authority. Bearer-only is rejected because theft permits a
higher counter and substituted payload. A symmetric session MAC would require
a new key-agreement and rotation authority.

**Operator answer requested:** approve the Ed25519 option or specify a different
reviewable proof protocol.

### O-02 — wire challenge exchange

**Question:** how does a paired device obtain the single-use server nonce that
open and refresh already require?

**Recommended:** exact `RemoteSessionChallengeRequest@1/Result@1` at
`POST /remote/v1/session/challenge`, bound to device, pairing generation,
purpose, applicable session revision, server identity and a maximum 60 second
expiry. It grants no session authority by itself.

**Operator answer requested:** approve this route/message pair or provide the
alternative exchange.

### O-03 — initial remote topology and abuse identity

**Question:** direct LAN/VPN listener or reverse-proxy/public exposure, and
which non-forgeable identity drives the five-attempt/ten-minute pairing limit?

**Recommended:** first release is a dedicated direct TLS 1.3 listener reachable
only on a trusted LAN/VPN; rate-limit on socket-observed remote address plus
claim digest, with a separate global safety bucket. Ignore forwarded headers.
A future proxy requires its own pinned-proxy contract.

**Operator answer requested:** approve direct LAN/VPN-only topology, or specify
the proxy/public trust boundary and its authenticated source-address contract.

### O-04 — approvals capability source

**Question:** which approval authority is visible remotely?

**Recommended:** only accepted M2 approval/effect authority with exact expiry,
revision and terminal projection. Keep all legacy/standalone approval sources
unavailable. Combining sources without a shared expiry model creates false
pending/decidable states.

**Operator answer requested:** approve M2-only or explicitly define the larger
normalization contract.

## Decisions/actions required before M5/M6 release acceptance

### O-05 — genuine private-key custody

Current metadata was rechecked without reading private values:

```text
vault       = /home/belphareon/INTENTSMITH_KEYS
vault mode  = 0700
private mode= 0600
filesystem  = the same permanently mounted /home Btrfs volume
principal   = the same belphareon account used by application/workers
```

This satisfies Unix permissions, but not the approved offline or independent
reviewer custody rule. Existing key identities can be retained if their private
files are moved to encrypted removable/offline signing environments and the
reviewer key is placed in custody separate from implementation/release keys.

**Operator input required:** provide the two offline destinations/custodians:
one for `m6-independent-reviewer`, another for the three operator/release roles.
After recovery is proven in a network-isolated signer, removal of the online
copies is a material destructive action and requires explicit confirmation.

### O-06 — compromised Git history disposition

All 13 known incident objects remain reachable. Credential rotation does not
remove history and history rewriting does not revoke credentials.

**Recommended:** `rewrite_and_rotate` — preserve a sanitized lineage while
removing the known reachable objects, then rotate all affected authorities and
repeat ref/reachability, privacy and release verification on the new SHA.

Alternatives are `new_root_and_rotate` (cleanest lineage, greatest provenance
loss) or `retain_and_rotate` (keeps all incident objects deliberately). No
history mutation is authorized until the operator chooses one explicitly.

### O-07 — eight real provider rotations

This is operator execution rather than an architectural choice. The eight
required categories are:

```text
administrative-api
ephemeral-authority
fixture-password-reuse
license-agent
license-signing-validation
model-provider
notification-credentials
project-external
```

Each provider/action must complete outside the application; only evidence
digests, never a secret value/hash/prefix/suffix, enter the signed privacy
receipt chain.

### O-08 — model/GPU evidence resumption

The operator already deferred real chat/LLM evidence while model optimization
may change the selected artifacts. No decision is needed today. Once exact
role bindings and artifact digests are frozen, the operator must authorize the
serial live model/GPU window; it must start with empty Ollama/GPU residency and
must not reuse the older running soak as candidate evidence.

### O-09 — final receipt and release actions

After O-05 through O-08 and successful re-reviews, the remaining actions are
ordered and role-separated:

```text
8 privacy rotation receipts
-> history disposition receipt
-> M5 acceptance receipt
-> M6 independent-review receipt
-> real operator-demo observation and approval receipt
-> Gate 0 receipt
-> standalone bundle verifier
-> explicit merge/tag/publish approval
```

The implementation cannot create these production signatures. Reviewer,
acceptance and release keys remain separate by Decision 041.

## Decisions/actions for the mobile release after transport review

### O-10 — production identities and distribution channel

The contract already chooses TLS 1.3 with a SHA-256 SPKI server pin. The
operator must later supply the certificate/private-key ceremony and decide the
first Android distribution channel (recommended: closed/internal testing
before public store release). Android release signing and server TLS private
keys must never be generated or persisted by a normal build/test run.

No production signing, pairing, listener activation, history rewrite, secret
rotation, promotion, tag, publish or push is authorized by this queue.

