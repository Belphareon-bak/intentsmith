# MM4-B review — stored information read projection

Status: `IMPLEMENTED AND TESTED`
Checkpoint commit: `2c33fd9b`

This checkpoint replaces the memory placeholder under Settings with a real,
scope-gated, read-only projection of the two user-facing stores that exist in
the current core: long-term memory and project-scoped task memory.

## Delivered

- core-owned `storedInformation.read` provider behind `RemoteCorePort`;
- `GET /m1/memory` with exact `kind`, `limit` and opaque-cursor query schema;
- pairable and default `read:memory` scope plus provider-aware discovery;
- combined `ltm` / `task` ordering by last use, with null timestamps last;
- server-computed confidence decay and TTL filtering;
- loading, failure, confirmed-empty, locked, live and stale-cache UI states;
- one-hour fresh, seven-day hard cache policy for the displayed window only;
- cache deletion at expiry and full invalidation when the scope is withdrawn;
- service-worker shell bump for installed clients;
- production initialization of the task-memory singleton at its lifecycle
  composition seam, fixing the prior silent no-op for execution-loop reads and
  writes.

## Source-of-truth and privacy boundary

The current stores do not persist the proposed `conversation | run | manual`
origin vocabulary. The projection therefore preserves fields the database can
actually prove (`kind`, category, key, value, source, project/milestone IDs,
timestamps and confidence) instead of manufacturing provenance.

`agent_internal`, expired LTM, another user's LTM and malformed LTM JSON all
fail closed or remain outside the response. The client escapes every displayed
key and value and exposes no memory write, edit or delete control.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-stored-information.test.js` | PASS — 7/7 |
| `node tests/mobile-stored-information-ui.test.js` | PASS — 8/8 |
| `node tests/lifecycle-build.test.js` | PASS — 70/70 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `npm run test:mobile` | PASS — 45/45 active; 1 Chromium suite withheld |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,102 edges; 3 existing cycles |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |

## Compatibility boundary

The route uses the current `m1.2026-07-30` envelope and its existing offset
cursor. It is not claimed as conformance to the unfinished
`CONTRACT-V2-PROPOSAL.md`, whose stable snapshot pagination and provenance DTO
still require an accepted core authority.

## Remaining MM4 work

- revision-checked settings writes with operation recovery;
- manual memory append with operation recovery; no edit/delete;
- authoritative agents/specialists projection;
- paired-device management and remaining provider migrations.
