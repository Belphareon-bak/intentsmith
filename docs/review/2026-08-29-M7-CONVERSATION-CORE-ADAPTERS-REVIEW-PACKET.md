# M7 conversation core adapters — independent review packet

**Requested verdict:** `REVIEW_PASSED` or `CHANGES_REQUIRED`

**Product candidate:** `91f022a9a2948f7f2ad87d3f88610d798bbdb1f3`

**Product tree:** `ba1182e839decb90aea0911890943f8cfbc9cec9`

**Review range:**
`0f6d212cae337175caaf5f6311d7f732e8497f2b..91f022a9a2948f7f2ad87d3f88610d798bbdb1f3`

## Review questions

Trace production handlers, journal serialization and ChatController
persistence, not only candidate fixtures:

1. Can request bytes assert device, subject, scopes, conversation access or
   cursor key, or do those values enter only from trusted composition?
2. Are deleted, denied and absent conversations observationally equivalent at
   list/history/execute boundaries, and are message bytes read only after the
   first conversation authorization?
3. Does list compare actual versus trigger-maintained counts, re-authorize each
   emitted row and reject whole-catalog drift without leaking partial items?
4. Is history one bounded SQLite snapshot, newest-to-oldest across pages but
   ascending within each page, followed by re-authorization and exact reread?
5. Is the HMAC cursor canonical and bound to capability/version, operation,
   device, subject, normalized query, complete snapshot and offset? Do tamper,
   cross-subject and snapshot drift fail closed?
6. Can malformed/oversized legacy content, title, metadata, timestamp, role or
   status be truncated or normalized into a false success, or does the whole
   protected read fail without partial bytes?
7. Does every `command` and `mutation` require the durable journal? Is M1's
   request identity digest-bound so requestId reuse with another
   conversation/turn/input conflicts instead of executing?
8. Does the SQL UDF accept only exact validator-clean M1 terminal results for
   `conversation.execute`, preserve exact replay bytes and keep mutation replay
   semantics unchanged?
9. After a handler may have acted, do throw, invalid identity and final
   revocation become durable `UNKNOWN`, never a false `REJECTED` or retry?
10. Do new user and assistant rows share the M1 `turnId`; are legacy fallback
    and missing historical cancel/timeout evidence stated without invention?
11. Does the one accepted module edge grow a cycle or reach route, server,
    session, listener or network authority?
12. Are both non-green full runs preserved with exact causes, and is the green
    `329/329` report bound to the clean product candidate rather than the later
    evidence commit?

## Reproduction minimum

```bash
git diff --check 0f6d212c..91f022a9
node tests/m7-conversation-core-adapters.test.js
node tests/m7-in-process-capability-provider.test.js
node tests/m7-operation-journal.test.js
node tests/m7-project-core-adapters.test.js
node tests/m1-quality-contract.test.js
node scripts/mobile-gate.js
node tests/schema-migrations.test.js
node tests/m1-model-failover-schema.test.js
node tests/harness-exit-code.test.js
node tests/nightly-orchestrator-self-test.js
node tests/module-boundary-ratchet.test.js
node tests/artifact-validation.test.js
node scripts/validate-test-registry.js --json
```

The green report is at
`.intentsmith-artifacts/m7-conversation-core-offline-database-green-20260829/m7-conversation-core-91f022a9-green/report.json`.
Verify SHA-256 `42047c9f2f09d9f6126148c43078fe613d9d2c56801b27dcbb94a7127f64e398`,
source `91f022a9a2948f7f2ad87d3f88610d798bbdb1f3`, registry
`9a98ae69b064498816933764d1694646b3d24ce25357aedf09f7f88a3add594b`,
verdict `PASS`, exit 0 and counts `329/0/0/0/0`.

Intermediate reports:

- `m7-conversation-core-offline-database-20260829/.../report.json`:
  SHA-256 `ea3a1bce…e02743882`, `320/1/0/8/0`, `FAIL`, exit 1;
- `m7-conversation-core-offline-database-rerun-20260829/.../report.json`:
  SHA-256 `d49b6219…120357be7`, `327/0/0/2/0`, `BLOCKED`, exit 2.

This packet requests a verdict only for the conversation core adapter block.
It does not request M7 acceptance or authorize production composition, a
session/cursor key, pairing, revocation, listener/transport activation, mobile
distribution, real LLM/GPU/device work or any M5/M6 operator action.
