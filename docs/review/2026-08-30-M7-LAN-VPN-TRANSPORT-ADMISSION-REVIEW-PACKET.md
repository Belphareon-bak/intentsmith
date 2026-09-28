# M7 LAN/VPN transport admission and current ratchet — review packet

## Requested verdicts

```text
M7_TRANSPORT_ADMISSION_POLICY = REVIEW_PENDING
M6_CURRENT_REGISTRY_RATCHET   = REVIEW_PENDING
M7_OVERALL                    = NOT_ACCEPTED
M7_PROVIDER                   = NOT_ACTIVE
M7_LISTENER                   = ABSENT
```

This packet requests adversarial review of a disconnected transport admission
policy and the registry ratchet it changes. It does not request creation or
activation of a listener, production certificate/key handling, durable rate
limiting, pairing issuance, device release, M6 Gate 0, receipts, tag, publish
or push.

## Identity and range

```text
baseEvidenceHead = 6d050aa846e1bb2f59754320c3a360f28bb1a5a2
productCandidate = bba4bbf3b9f1864863d53f6323caf455ecb5fc3f
candidateTree    = c4893246a88f98cf99d294b5e8af09b57d7ad6d7
reviewRange      = 6d050aa8..bba4bbf3
branch           = codex/m7-mobile-contract-integration-20260829
upstream         = absent
push             = not performed
```

The later documentation-only commit is outside this review range. It is not an
allowed M6 release-evidence commit and must not be mistaken for a new product
candidate. Any later product or test commit invalidates a verdict bound to
`bba4bbf3`.

## Area A — listener configuration and peer classification

Trace `createM7TransportAdmissionPolicy()` and answer:

1. Can wildcard, loopback, link-local or public bind become an accepted
   LAN/VPN listener configuration?
2. Are private IPv4, CGNAT and IPv6 ULA classifications exact at range edges?
3. Does IPv4-mapped IPv6 canonicalize to the same peer identity, and can a
   malformed, public, unspecified or unzoned link-local peer pass?
4. Is peer identity taken only from the direct socket input rather than Host,
   forwarded headers or request body?
5. Does the configuration require exact HTTPS origin/port, TLS 1.3 in both
   directions, `trustProxy:false` and a syntactically pinned SPKI digest?

## Area B — exact request surface

Compare `M7_TRANSPORT_ROUTES` byte-for-byte with the accepted mobile session
contract. Verify exact method/path behavior for all seven routes, HTTP/1.1,
TLS 1.3 and Host. Exercise query, fragment, method confusion, legacy
`/api/*`, `/m1/*`, `/c3/ws`, credentials, cookies, forwarded/proxy identity,
duplicate headers, transfer encoding, malformed Content-Length and header/body
limits. All must fail before any future session or provider call.

## Area C — opaque identity and rate-plan boundary

1. Can raw IP, peer canonical bytes, claim code/digest or HMAC key escape in
   either admission or rate plan?
2. Are peer identities domain-separated and key-dependent?
3. Does pairing require a post-parse claim digest and produce all three exact
   buckets? Does invocation require a trusted `read|mutation` classification?
4. Can a structural clone of policy or admission gain authority?
5. Most importantly: can any counter be consumed, a request be accepted into a
   session, or a listener be activated without a future genuine durable limiter
   authority? The expected answer for this candidate is no.

## Area D — disconnection and conditional session gate

Prove structurally that the policy has no HTTP/HTTPS/TLS/server/WS/session
authority import, no `createServer`, no `listen()`, no composition consumer and
no startup wiring. The earlier conditional session review remains binding: no
listener may consume session authority until O-01/O-02 and this transport slice
are reviewed. This candidate must remain `LISTENER_ABSENT`.

## Area E — current M6 ratchet

Recompute rather than copying the packet:

```text
total programs       = 498
ACTIVE               = 404
HISTORICAL           = 15
BLOCKED              = 79
ACTIVE + required    = 399
offline required     = 270
database required    = 68
profile gate total   = 338
registry fingerprint = 7188ed916b1b59a822cb9999848c27f885323780716e3b24f78f8f4db3fdafaf
```

The transport test must be ACTIVE, required, offline and in the deterministic
phase. Remove it from a cloned current plan and require
`plan:required-program-uncovered`. Confirm nightly policy and registry
fingerprint move together.

## Evidence to reproduce

```text
node tests/m7-transport-admission-policy.test.js  # 8/8
node tests/mobile-remote-session-contract.test.js # 13/13
node tests/m7-session-authority.test.js           # 11/11
node tests/m6-candidate-plan.test.js               # 19/19
node tests/m6-runtime-evidence.test.js             # 8/8
node tests/m6-technical-evidence.test.js           # 8/8
node tests/module-boundary-ratchet.test.js         # 13/13
node tests/artifact-validation.test.js             # 158/158
node tests/nightly-orchestrator-self-test.js        # PASS
node tests/harness-exit-code.test.js                # PASS
node scripts/validate-test-registry.js --json       # valid / 498
git diff --check                                    # PASS
```

### Full offline + database gate

```text
sourceRevision       = bba4bbf3b9f1864863d53f6323caf455ecb5fc3f
runId                = 2026-08-29T22-53-46-348Z
result               = 338 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED
verdict              = PASS / exit 0
registryHash         = 7188ed916b1b59a822cb9999848c27f885323780716e3b24f78f8f4db3fdafaf
inventoryFingerprint = ec690110fa9ebab24057bd44307f9cabfbbaf02571c16100c4aa65eaec267ee4
optionsFingerprint   = 533fb61b7113b560d7e9cdb0cbaea3bb96a1f4621554c41f3836b378a94f4c20
reportSha256         = df1fa20522afc04c55c06bd9fe95bee95e834b2c824c91f961c67b9f82801356
```

Raw report:

`.intentsmith-artifacts/m7-transport-admission-offline-database-20260830/2026-08-29T22-53-46-348Z/report.json`

No live LLM/chat-quality, Ollama, GPU, network listener or physical-device run
is claimed.

## Operator inputs deliberately left open

The implementation stops before four product/operations inputs:

- `M7-TLS-01`: exact origin, bind IP/port and production certificate/private
  key/SPKI custody;
- `M7-RATE-01`: durable rate-limit store, HMAC key custody and retention;
- `M7-NET-01`: exact LAN/VPN interface/firewall and proof of no public
  NAT/port-forward/reverse proxy;
- `M7-PAIR-01`: local authenticated one-time pairing-claim issuance UX.

These are not review findings to paper over. Until they are decided and the
next implementation receives its own review, activation remains forbidden.

## Requested review output

Return separate verdicts and list every surviving finding by severity:

```text
M7_TRANSPORT_ADMISSION_POLICY
M6_CURRENT_REGISTRY_RATCHET
```

Also state explicitly whether the route set equals the mobile contract,
whether the policy/session/listener disconnection is real, whether the full
gate is bound to exact `bba4bbf3`, and whether any later product/test commit
appeared.
