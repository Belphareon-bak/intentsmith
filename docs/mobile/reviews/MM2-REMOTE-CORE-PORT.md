# MM2 review — RemoteCorePort candidate checkpoint

Status: `CANDIDATE DELIVERED; FREEZE OPEN`

Implementation checkpoint: `f4861bca`

This checkpoint delivers the testable MM2 shape without claiming that its
still-provisional upstream dependencies are frozen.

## In scope

- a versioned seven-domain, nineteen-feature `RemoteCorePort` contract;
- exact version negotiation and named failure modes;
- per-feature availability and scope truth;
- a closed provider result algebra with JSON-safe values;
- production chat submission routed through the narrow connector;
- a generated inventory of all statically declared `/api` and `/m1` routes;
- registry-backed contract and inventory tests.

## Evidence

| Check | Result |
|---|---|
| `node tests/remote-core-port-contract.test.js` | PASS — 10/10 |
| `node scripts/mobile-capability-inventory.mjs` | PASS — 237 routes |
| `node tests/mobile-capability-inventory.test.js` | PASS |
| `node scripts/validate-test-registry.js --write-doc` | PASS — 422 runnable programs |
| `npm run test:mobile` | PASS — 39/39 active; 1 Chromium suite withheld |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,096 edges; 3 existing cycles |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |

The withheld browser accessibility suite is recorded as `BLOCKED`, not counted
as a pass, because this host has no Chromium runtime.

## Security properties reviewed

- unknown feature/provider identifiers are rejected;
- no generic request, fetch or base-URL property is exposed by the port;
- scope validation precedes provider execution;
- unavailable, forbidden and available are distinct states;
- malformed provider results fail closed;
- chat's decided-versus-ambiguous outcome survives the adapter;
- the gateway retains its exact `/m1` route allow-list.

## Open items

- Eighteen declared providers remain intentionally unavailable pending MM3/MM4.
- Dynamic/WebSocket capabilities are not yet part of the generated inventory.
- Contract promotion to `FROZEN_V1` depends on the repository's provisional M1
  contracts becoming pinned.
- Physical browser/device evidence belongs to MM5/MM6 and is not claimed here.

## Review verdict

The candidate is suitable as an implementation boundary for subsequent mobile
surfaces. MM2 remains `IN PROGRESS` until prerequisite freeze and the remaining
provider coverage are reviewed; this checkpoint is independently reviewable
and must not be rewritten after acceptance.
