# M7 VPN listener, Android companion and release evidence — review packet

## Requested verdicts

```text
M7_DISCONNECTED_REQUEST_PIPELINE = REVIEW_PENDING
M7_VPN_LISTENER_AND_CUSTODY      = REVIEW_PENDING
M7_LOCAL_PAIRING_AUTHORITY       = REVIEW_PENDING
M7_SIGNED_INVOCATION_PATH        = REVIEW_PENDING
M7_CORE_COMMAND_INTEGRATION      = REVIEW_PENDING
M7_ANDROID_REMOTE_COMPANION      = REVIEW_PENDING
M7_RELEASE_RUNTIME_EVIDENCE      = REVIEW_PENDING
M6_CURRENT_REGISTRY_AND_GATE     = REVIEW_PENDING
M7_OVERALL                       = NOT_ACCEPTED
```

This packet requests independent adversarial review. Focused and deterministic
green results are implementation evidence, not review acceptance. Physical VPN,
device and release-signing evidence is explicitly absent.

## Exact identity

```text
reviewedBase     = b23f63d6b4b7f503a25f2bdaf3f364048432be21
productCandidate = 07b582d171eb590d4c4c55ea7a8837bfdf9315e1
candidateTree    = 78fb2adc88ba9a9d2604f8a837bf3d0cd68503a6
reviewRange      = b23f63d6..07b582d1
branch           = codex/m7-mobile-contract-integration-20260829
upstream         = absent
push             = not performed
```

`b23f63d6` is the candidate on which the durable limiter and then-current M6
ratchet received `REVIEW_PASSED`. Do not extend that verdict to later bytes.
Any product/test commit after `07b582d1` invalidates this packet. Later changes
limited to the M6 evidence-only paths must be classified as evidence commits,
not silently treated as product changes.

## A. Disconnected request authority pipeline

Trace raw socket metadata/body bytes through admission, durable multi-bucket
rate limiting, fatal UTF-8 and canonical JSON, session authority and private
provider. Verify:

- no body reaches session/provider authority before admission and rate limit;
- malformed operation IDs cannot downgrade mutation rate limits to reads;
- signed capability/version/operation/payload/scopes bind exactly to the
  provider invocation;
- counter/nonce is consumed once even when the provider fails;
- one session revision cannot run two provider calls concurrently;
- every allowed provider response is bound back to the accepted request;
- structural clones cannot acquire any closure-genuine authority.

## B. VPN listener and credential custody

Trace startup from `src/server.js` through `M7VpnRuntimeConfiguration@1`,
credential loading, production composition and `M7VpnTlsListener@1`.
Adversarially test wildcard/LAN/public/wrong-interface binds, address change
between configuration and start, malformed systemd credential directory,
symlinks/non-regular/wrong-owner/permissive/replaced files, certificate/key/SPKI
mismatch, expiry, bind collision and shutdown during requests.

Confirm that the only allowed runtime is one recognized VPN interface, exact
private address, exact HTTPS origin, port 7443, TLS 1.3, HTTP/1.1 and no proxy.
The local pairing resolver must remain unavailable until listener start proves
the exact bind; startup failure must terminate rather than fall back.

## C. Local pairing authority

Prove that only the closure-authenticated local Studio capability can issue a
claim. Admin/API/bearer subjects, structural subject clones, body-asserted actor
identity and remote self-pairing must fail before minting. Verify five-minute
expiry, single-use CAS, previous-claim revocation, no-store response and that
SQLite contains only the claim digest, never the claim or pairing URI.

## D. Signed session and invocation path

Re-run the earlier conditional session review against the now-connected call
graph. Open, refresh, revoke and every invocation must verify domain-separated
Ed25519 canonical bytes against the paired device key. Test wrong key, changed
byte, wrong domain, stale session revision, counter reuse, nonce reuse, restart,
concurrency and revoked/expired pairing/session. A bearer-only invocation path
is a blocker now that the listener exists.

Trace remote mutations through `M7MutationMediator` and the accepted M2
approval/effect authority. No operation classified as mutation may bypass that
path or report success for unknown/orphaned effects.

## E. Core command integration

For all 17 advertised operations, trace the exact production adapter and its
authorization predicate. Pay special attention to conversation execution:
project binding must be derived from core state, not request claims; model
errors/cancellation must preserve typed outcome; run events must not fabricate
completion. Verify `requireCompleteCapabilities:true` genuinely rejects a
partially wired provider.

## F. Android remote companion

Review both WebView/JS and native Java paths. Verify build-pinned HTTPS origin
and SPKI, TLS 1.3, `Proxy.NO_PROXY`, no redirects, canonical request/response
bytes, exact BuildConfig binding and strict bridge method surface. Test native
identity durability, wipe/re-pair, counter persistence, signature domains and
key wrapping. Do not accept a claim of hardware-backed Ed25519: the candidate
only claims a software seed wrapped at rest by a non-exportable AndroidKeyStore
AES-GCM key.

Review offline/reconnect semantics specifically: an OS `online` event must not
show connected; only successful resume followed by a real health probe may do
so. Transport outages may retain only a validated native snapshot and must keep
mutations blocked. Proof/structure failures must require an explicit wipe and
re-pair instead of looping in an impossible state.

## G. Release and physical-runtime evidence

Trace `MobileM7RuntimeEvidence@1` and both release scripts from raw filesystem
bytes to the final policy. Attempt invalid UTF-8, noncanonical JSON, reordered
or duplicate checks, unknown keys, symlinks, size races, changed inode/mtime,
path traversal, forged caller metrics, stale candidate/tree, wrong APK/AAB
digest or signer, wrong manifest/adapter/origin/SPKI/device and artifact
clobbering.

The release must remain denied unless all 13 exact checks are content-addressed
and green:

```text
candidate-installed
logout-identity-wiped
mutation-approval-roundtrip
offline-reconnect
pairing-single-use
read-invocation-signed
server-restart-replay-fenced
session-open-signed
session-refresh-signed
session-revoke-enforced
tls13-spki-accepted
vpn-only-reachability
wrong-spki-rejected
```

Confirm that debug signing, absent AAB verification, volatile build outputs or
a structurally valid red physical run cannot produce `releaseTransportReady`.

## H. Registry, module and deterministic gate

Recompute rather than copy:

```text
registry total       = 510
ACTIVE               = 416
BLOCKED              = 79
HISTORICAL           = 15
ACTIVE + required    = 411
offline required     = 277
database required    = 73
deterministic total  = 350
registry fingerprint = 73782eec4854f94af66b1f6bf27ea70cee90ed4d173d3da3888eb76f603d5fd9
module graph         = 1273 edges / 3 cycles / 28 files in cycles
migrations           = 95
```

Remove each of the ten listener/Android programs named by the M6 omission
sentinel from a cloned plan and require `plan:required-program-uncovered`.
Confirm nightly policy uses the same registry fingerprint and exact profile
counts.

Two reports are intentionally retained:

```text
2026-09-08T22-34-02-636Z  BLOCKED / exit 2 / 342 PASS / 8 BLOCKED
sha256 e23201c9de5d89926e0959e92496031d486ac7a03e7f834c3a7e92be328e2f80

2026-09-08T22-41-31-787Z  PASS / exit 0 / 350 PASS / 0 non-PASS
sha256 72f8c9e79fcac8ea598206040e50e07e0e80c557e17fa41f80be41f67f62cc96
```

The second run may pass only because the candidate plan explicitly permits the
five exact local toolchain authorities. Verify `noBlock:false`, concurrency 1,
profiles `offline,database`, exact source revision and that no blocker outside
that five-item set was opened.

## Commands

```bash
npm run test:mobile
node tests/m7-disconnected-request-pipeline.test.js
node tests/m7-vpn-runtime-config.test.js
node tests/m7-vpn-tls-listener.test.js
node tests/m7-vpn-production-runtime.test.js
node tests/m7-local-pairing-route.test.js
node tests/m7-local-pairing-studio.test.js
node tests/m7-mutation-mediator.test.js
node tests/m7-conversation-command-executor.test.js
node tests/m7-session-authority.test.js
node tests/m7-native-remote-client.test.js
node tests/m7-mobile-app-runtime.test.js
node tests/m7-mobile-ui-api-adapter.test.js
node tests/mobile-android-release.test.js
node tests/mobile-browser-a11y.test.js
node tests/m6-candidate-plan.test.js
node tests/nightly-orchestrator-self-test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

## Explicit exclusions and required review output

This packet does not claim physical VPN/firewall, production credential
ceremony, real device/TalkBack, release APK/AAB signing or distribution, live
LLM/chat, Ollama/GPU, M5 receipts/rotations/history disposition, M6 full
multi-phase candidate gate, demo, Gate 0, promotion, tag, publish or push.

Return all eight requested verdicts independently, every surviving finding by
severity, exact candidate/tree/range, focused totals, both deterministic report
outcomes and whether any later product/test commit appeared. Even if all eight
are `REVIEW_PASSED`, M7 remains `REAL_VPN_DEVICE_EVIDENCE_BLOCKED /
NOT_ACCEPTED` until the excluded physical/release evidence exists.
