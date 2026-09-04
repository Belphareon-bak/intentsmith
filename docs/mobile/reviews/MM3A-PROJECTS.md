# MM3-A review — read-only projects

Status: `IMPLEMENTED AND TESTED`
Checkpoint commit: `1a7be999`

This checkpoint replaces the former locked Projects placeholder with a real,
scope-gated mobile projection. It is intentionally read-only: project and
workspace mutations are not implied by the existence of a screen.

## Delivered

- `projects.read` production provider behind `RemoteCorePort`;
- `GET /m1/projects` with active/archive filters and opaque pagination;
- `GET /m1/projects/:id` for non-deleted project detail;
- explicit capability discovery for the provider;
- Projects navigation item, overview tile, list and detail screens;
- active/archive selector, offline cache and trust-bar stale state;
- scope, loading, empty, failure and not-found states;
- HTML escaping and no project mutation controls;
- generated route inventory and registry entries.

The projection maps the integer core id to a string, `last_active` to the
wire's `updatedAt`, and counts non-deleted linked conversations. A deleted
project is never returned by either route. Neither response contains project
paths, file contents, shell access or desktop administrative data.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-projects.test.js` | PASS — 7/7 |
| `node tests/mobile-projects-ui.test.js` | PASS — 9/9 |
| `node tests/remote-core-port-contract.test.js` | PASS — 11/11 |
| `node tests/mobile-navbar.test.js` | PASS — 22/22 |
| `node tests/mobile-overview.test.js` | PASS — 18/18 |
| `npm run test:mobile` | PASS — 41/41 active; 1 Chromium suite withheld |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,097 edges; 3 existing cycles |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |

## Compatibility boundary

These routes use the currently shipped `m1.2026-07-30` envelope and `c1`
cursor. They are not presented as conformance to the unfinished
`CONTRACT-V2-PROPOSAL.md`, whose own header still says `NÁVRH` and whose
prerequisite freeze is open. Promotion or migration to a frozen wire v2 must be
a separate reviewable change.

## Remaining MM3 work

- server-backed cross-domain search;
- an authoritative run list/detail/event provider and cancellation semantics;
- frozen wire-contract prerequisites;
- real Chromium and physical-device UI evidence.
