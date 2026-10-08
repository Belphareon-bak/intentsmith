# HTTP Items — verified qualification snapshot

**FROZEN_PRIMARY70_SUPPLEMENT17_REVIEW_PASS_NOT_RELEASE_ACCEPTED.**

Four exact generated modules, **26,354 bytes**, from app commit
`0ae3bd8c90ae7886ecc8470713413f7508ed2547`. The source bytes were copied without edits or formatting.
The original frozen `API.md` is unchanged; `MANIFEST.json` records every file's
SHA-256 and original Git blob. This separate qualification snapshot is not added
to the parent list of 24 accepted modules.

## Provenance and measured result

IntentSmith source `44e4d96ceadde57eb67e81c6f67142b1143956f3`, actual run
2026-10-08 09:35:16–09:36:30 UTC. Qwen3.8 exact digest
`22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643`, provider `0.34.0-intentsmith.1`, context 32,768.
One final router-only CODE call completed at 496 output tokens, within cap 4,096.
The cumulative budget is **14/14**, closed; D1 and CLI calls were zero.

The original primary oracle passed all **70 HTTP requests**. The unchanged
supplemental oracle passed all **17 requests** in a separate invocation.
Exact M2 approval, rejected wrong digest, pending restart, generated commit,
durable backend restart/replay and owned model cleanup passed independent review.
Review SHA-256: `9de6508091c71b69f0b5af4058bcbebb3a0f56f0a65fe6311951834714188053`.
[Exact evidence references](../../../docs/review/evidence/product-continuation-20261008/http14-actual.json).

## Limits and preserved history

This is a PASS for those frozen tests, not exhaustive API/prompt conformance,
natural Studio → D1 qualification or release acceptance. The router still accepts
`charset=utf8` through its `utf-?8` expression. The input instruction says only
`utf-8`, while the original API says optional UTF8 charset; the two frozen
oracles do not probe this alias. No new request or repair was added for it.

The primary test reopened the same private SQLite file across two server
processes within one sandbox invocation. The supplemental invocation used a
separate fresh private database; persistence across sandbox invocations is not
claimed. M2 state and source/Git durability were independently verified across
backend restarts.

The previous exported snapshot remains in Git commit `2d145220`, with app commit
`1856920fea6c31b8fc0f6618e1499967cdccd362` and its rejected source/API findings.
The first additional attempt, cumulative13, passed the primary test but failed
on `application/json; charset= utf-8`; that failure remains in the evidence.
The final attempt passed that same unchanged supplemental test. No historical
FAIL is rewritten by this export.

This source-only export includes no database, credentials, runtime IDs, prompts,
responses, dependencies or private Git objects. Copying it executes no application
or model. See [WORK-PROGRESS](../../../docs/WORK-PROGRESS.md) for remaining work.
