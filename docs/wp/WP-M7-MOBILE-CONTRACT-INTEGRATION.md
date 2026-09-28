# WP-M7-MOBILE-CONTRACT-INTEGRATION

**Type:** write-enabled M7 contract integration

**Base revision:** `0f9e2c645a9e26578521916d2f783068e9d5202d`

**Source candidate:** `ab1940aac6694b6a6ac616b833967fe47ba9ed26`

**Status:** `IMPLEMENTATION_GREEN / FULL_GATE_GREEN / REVIEW_PENDING /
PROVIDER_ABSENT / TRANSPORT_ABSENT`

## 1. User outcome

The current M6 core and the prepared Android companion now share one
executable, content-addressed candidate language for seven capabilities,
fourteen mobile operations and four M7 control-plane prerequisites. A core
provider can be implemented and reviewed without guessing payload, cursor,
replay, recovery or session identity shapes.

This WP deliberately does not make the mobile application remotely usable.
It creates no listener, credential, pairing authority, database migration,
runtime import or production release artifact.

## 2. Owned and forbidden paths

Owned:

- `src/mobile/client/remote-core-v1.js` as the transport-free consumer pin;
- `docs/mobile/contracts/**` and the candidate status document;
- the six registered M7/mobile offline contract tests;
- the exact registry/documentation census changes required by those tests.

Forbidden in this block:

- `src/server.js`, routes, WebSocket, network listeners and legacy gateways;
- DB repositories or migrations;
- pairing, token issuance, TLS identity, revocation and rate limiting;
- Android runtime/application code, signing keys and distribution;
- any claim that simulator success is provider, transport or device E2E proof.

## 3. Exact connector and inputs

The candidate is pinned to the accepted current core identities:

- M2 `RemoteCorePort@1` descriptor
  `sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52`;
- M5 in-process adapter manifest
  `sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52`;
- mobile requirements
  `sha256:e076d2f17484772474bb9c4c806d156c369645fd4af395bfb19a58beee4a0654`.

`m7-mobile-core-pin-integration.test.js` imports the authoritative M2/M5
exports and invokes the real current M5 adapter negotiation. The consumer
accepts its exact result but returns `REMOTE_CAPABILITY_SET_INCOMPLETE`, because
only conversations/project-context v1 are actually implemented.

## 4. Demonstration

The test-only simulator owns no network, database, credential or backend
authority. Through an injected transport it executes all fourteen capability
operations and four control-plane cases with exact session/counter/nonce,
cursor and mutation recovery binding. The candidate client rejects local
payload drift, substituted results, nonce reuse and implicit mutation retry.

## 5. Stop conditions

Stop and request an operator/security decision before:

- accepting or changing the public capability/session contract;
- exposing any non-loopback listener or choosing TLS/pairing identity;
- importing the candidate from production server or Android runtime;
- defining push/pull product policy, signing identity or distribution;
- treating `CANDIDATE_NOT_ACCEPTED` as availability.

## 6. Verification

Focused suites:

```bash
node tests/mobile-remote-core-v1.test.js
node tests/mobile-remote-capability-contract.test.js
node tests/mobile-remote-capability-provider-contract.test.js
node tests/mobile-remote-session-contract.test.js
node tests/mobile-remote-core-simulator.test.js
node tests/m7-mobile-core-pin-integration.test.js
node tests/m2-remote-core-port-contract-v1.test.js
node tests/m2-remote-core-port-boundary.test.js
node tests/m5-remote-core-adapter.test.js
node tests/artifact-validation.test.js
node tests/module-boundary-ratchet.test.js
node scripts/validate-test-registry.js --json
git diff --check
```

Before a review packet, freeze a clean product commit and run the complete
offline+database registry gate. A green gate is implementation evidence, not
contract acceptance or permission to implement the listener.

Completed candidate evidence:

- product candidate `54a10fd0bb6134c9437c99a103dcb23e7ed639f8`;
- product tree `3a7758900f3444e640c0a5eaf77014bfe5106c68`;
- focused mobile candidate boundary `63/63 PASS`;
- continuous offline+database registry gate `311/311 PASS`;
- registry fingerprint
  `e0fb9ec59e860128fbb9b16664604b349fbfe9f515ada52b0b2ed22fe5047a63`;
- no live LLM, Ollama inference, physical GPU, listener or Android build was
  invoked by this block.

The implementation report is
[`m7-mobile-contract-integration-20260829.md`](../execution/runs/m7/m7-mobile-contract-integration-20260829.md).
