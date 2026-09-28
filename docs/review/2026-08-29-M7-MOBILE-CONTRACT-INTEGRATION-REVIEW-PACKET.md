# M7 mobile contract integration — review packet

**Requested verdict:** `REVIEW_PASSED` or `CHANGES_REQUIRED`

**Product range:**
`0f9e2c645a9e26578521916d2f783068e9d5202d..54a10fd0bb6134c9437c99a103dcb23e7ed639f8`

**Product tree:** `3a7758900f3444e640c0a5eaf77014bfe5106c68`

## Review questions

1. Are the consumer pins and candidate manifest identities byte-compatible
   with the actual current M2/M5 exports, with no copied accepted validator?
2. Do all seven capability and fourteen operation schemas fail closed on
   unknown fields, identity substitution, cursor drift and mutation replay?
3. Is the session candidate explicit about pairing, counter, nonce, expiry,
   revocation and response binding without claiming transport authority?
4. Is the simulator structurally test-only (`network=none`, `database=none`,
   `authority=NONE`) and unreachable from production server/mobile imports?
5. Do the M6 plan and nightly registry ratchet cover all six new required
   programs without a stale count or silent omission?
6. Are status claims limited to contract implementation, with provider,
   listener, Android runtime, device evidence and release still absent?

## Required reproduction

Run the focused commands in
[`WP-M7-MOBILE-CONTRACT-INTEGRATION`](../wp/WP-M7-MOBILE-CONTRACT-INTEGRATION.md)
and inspect the continuous gate report documented in
[`m7-mobile-contract-integration-20260829.md`](../execution/runs/m7/m7-mobile-contract-integration-20260829.md).

Expected current implementation evidence:

```text
focused M7                         63/63 PASS
M2/M5 RemoteCore compatibility    39/39 PASS
M6 plan                            16/16 PASS
artifact                          158/158 PASS
module ratchet                     13/13 PASS
nightly orchestrator self-test       1/1 PASS
offline+database gate            311/311 PASS
registry programs                      471
registry fingerprint              e0fb9ec59e860128fbb9b16664604b349fbfe9f515ada52b0b2ed22fe5047a63
```

The red missing-dependency attempt is retained and must remain classified as
invalid environment evidence, not silently omitted and not counted as a product
regression. No LLM, Ollama inference, physical GPU, production listener,
Android build, signing, push, tag or publish is part of this review.
