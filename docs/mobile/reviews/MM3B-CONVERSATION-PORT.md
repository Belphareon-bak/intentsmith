# MM3-B review — conversation read boundary

Status: `IMPLEMENTED AND TESTED`
Checkpoint commit: `ddb90e7e`

This checkpoint moves the already shipped conversation list, detail and
message-history projection behind `RemoteCorePort` without changing its
`m1.2026-07-30` HTTP shape. The mobile handler owns cursor and envelope rules;
the core-owned provider owns repository queries and DTO projection.

## Delivered

- production `conversations.read` provider;
- conversation list and detail handlers fail closed when that provider is
  missing or forbidden;
- forward and backward history paging retain the existing opaque-cursor rules;
- legacy capability discovery now requires both scope and an available
  provider;
- deleted conversations are absent from both list and detail;
- no conversation create/update/archive provider is advertised.

The preliminary existence read in the detail handler deliberately preserves
the shipped repair order: a missing conversation returns `404` even if the
supplied cursor is also bad. A client cannot repair a cursor for a stream that
does not exist.

## Evidence

| Check | Result |
|---|---|
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-contract-cursor-rejection.test.js` | PASS — 10/10 |
| `node tests/mobile-contract-pagination-end.test.js` | PASS — 21/21 |
| `npm run test:mobile` | PASS — 41/41 active; 1 Chromium suite withheld |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,098 edges; 3 existing cycles |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |

## Compatibility boundary

This is a provider-boundary refactor of existing `/m1/conversations` routes,
not a wire-v2 claim. `ConversationCommand` and `ConversationResult` remain
`PROVISIONAL_V1`, so `RemoteCorePort` remains `CANDIDATE_V1`.

## Remaining MM3 work

- server-backed cross-domain search;
- an authoritative run list/detail/event provider and cancellation semantics;
- frozen wire-contract prerequisites;
- real Chromium and physical-device UI evidence.

> Historical checkpoint note: MM3-C later extended the existing list
> operation with the separately reviewed project filter in `701308d8`. The
> 41/41 and 1,098-edge counts above remain evidence for MM3-B, not current HEAD.
> See [MM3-C review](MM3C-PROJECT-CONVERSATIONS.md).
