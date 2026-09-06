# MM4-C review — worker and specialist read projections

Status: `IMPLEMENTED AND TESTED`
Checkpoint commit: `49dd991d`

This checkpoint replaces the mobile “coming soon” placeholders for agents and
specialists with two real, scope-gated, read-only sections. It reports only
state the current backend can prove from its persisted authorities.

## Delivered

- `workers.read` and `specialists.read` additions to the still-candidate
  `RemoteCorePort` v1 contract;
- production providers backed by `agents_v33` / `agent_runs_v33` /
  `agent_schedule_v33` and by `specialists` / `specialist_expertises`;
- conditional worker provider registration, so an older database without the
  non-migrated v33 subsystem tables reports the capability unavailable;
- exact `GET /m1/workers` and `GET /m1/specialists` allow-list entries;
- pairable `read:workers` and `read:specialists` scopes and provider-aware
  capability discovery;
- opaque-cursor pagination with strict, duplicate-aware query validation;
- real Agenti and Specialisté navigation sections plus matching overview
  tiles, replacing their former locked placeholders;
- loading, error, confirmed-empty, scope-locked, stale-cache and paginated UI
  states;
- five-minute worker and one-hour specialist freshness windows, both with a
  seven-day hard limit, expiry deletion and scope-withdrawal invalidation;
- service-worker shell revision `is-shell-v5`;
- generated backend inventory and canonical test-registry updates.

## Authority and privacy boundary

The old `agents` table is not used. The current server routes and runner use
the v33 tables, so those are the worker read authority. Full definitions,
mutable state, parameters, trigger details, explain payloads, logs and errors
never cross the mobile projection. Malformed definitions fail the entire read
closed without echoing stored bytes.

Specialists are projected from the migration-owned package and expertise
binding tables. Raw manifests, tool configuration and runtime module references
remain private. The standalone gateway cannot observe the server process's
in-memory specialist registry, so it does not manufacture an `isRegistered`
field.

## Runtime and mutation boundary

A v33 run row marked `running` has no lease or boot identity. It may survive a
crash and therefore is not trustworthy live state. The mobile worker list
shows only the latest finished terminal run (`success`, `partial`, or `error`)
and explicitly says live runtime is unavailable.

`workers.toggle`, `workers.dryRun` and `specialists.toggle` are declared for
capability negotiation but have no provider and report `unavailable`. The
existing desktop `/api/agents/dry-run` accepts a caller-supplied definition;
it is not an isolated dry-run of the stored server version and was not exposed.

## Evidence

| Check | Result |
|---|---|
| `node tests/mobile-workers-specialists.test.js` | PASS — 8/8 |
| `node tests/mobile-workers-specialists-ui.test.js` | PASS — 7/7 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-capability-inventory.test.js` | PASS |
| `npm run test:mobile` | PASS — 47/47 active; 1 Chromium suite withheld |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 existing cycles |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |

One intermediate full-gate rerun hit a host timeout in the unrelated
`approval-lifecycle` suite. That suite then passed standalone (16/16), and the
subsequent complete gate passed 47/47. The timeout is not counted as evidence.

## Compatibility boundary

The routes use the current `m1.2026-07-30` envelope and offset cursor. This is
not claimed as conformance to the unfinished `CONTRACT-V2-PROPOSAL.md`.
`RemoteCorePort` remains `CANDIDATE_V1`; these two domains extend the candidate
before freeze rather than silently changing a frozen contract.

## Remaining MM4 work

- a crash-safe worker runtime and general run/event authority;
- isolated stored-version worker dry-run and governed toggle mutations;
- governed specialist toggles and inspectable detail where a safe DTO exists;
- revision-checked settings writes and manual memory append;
- paired-device management and remaining provider migrations.
