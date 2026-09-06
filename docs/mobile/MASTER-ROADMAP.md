# IntentSmith Mobile Master Roadmap

Status: active
Branch: `mobile/master-prod-ready`
Owner boundary: Android-first Remote Companion; iOS follows after the remote
contract and Android release are accepted.

This branch is the canonical review branch for the independently developed
mobile implementation.  It deliberately remains separate from any unavailable
local implementation so that both lines can later be compared capability by
capability instead of being merged blindly.

## Non-negotiable product target

The mobile application is a faithful, capability-negotiated projection of the
supported IntentSmith backend.  It must cover:

- projects and project detail;
- conversations, paginated history and message submission;
- run status, event history, cancellation and explicitly represented unknown
  outcomes;
- approvals with exact operation/content binding and first-response-wins;
- agents and specialists, including their inspectable configuration and safe
  actions exposed by the backend;
- notifications, settings, stored information and paired-device management;
- offline/degraded/read-only states without inventing server truth.

The client never gains authority merely because a screen exists.  Every route
and action is gated by a server-advertised capability and a device scope.

## Reviewable milestones

| Milestone | Deliverable | Exit evidence |
|---|---|---|
| `MM0` | Canonical branch, provenance and comparison contract | branch and documents exist; ancestry recorded |
| `MM1` | Existing Android prototype integrated onto the current core baseline | merge conflicts resolved; mobile gate has a documented baseline |
| `MM2` | Versioned `RemoteCorePort` and complete backend capability inventory | contract tests; unsupported capability rejection; no legacy bypass |
| `MM3` | Projects, conversations, search and run experience | UI, API and negative-state tests for every exposed action |
| `MM4` | Approvals, agents, specialists, notifications, settings, stored information and devices | authority tests plus multi-device and lifecycle evidence |
| `MM5` | Production remote transport and mobile hardening | TLS/identity boundary, secure storage, offline/push policy, security review |
| `MM6` | Reproducible Android release | clean-clone build, API target compliance, signed-artifact procedure, device matrix |

Each milestone ends in its own commit or short, contiguous commit series.  Its
review package records scope, observed tests, remaining risks and exact commit
range.  Later work must not rewrite an accepted milestone.

Current MM4 sub-checkpoints: settings read (`87a51930`), stored-information
read (`2c33fd9b`), worker/specialist read (`49dd991d`), paired-device lifecycle
(`13fa98c6`) and revisioned UX-settings write (`4bb9011d`). MM4 remains open for
safe stored-information mutation and governed worker/specialist actions.

## Current lineage

- canonical core base: `integration/m1-consolidated-20260810`
  (`765d1efee166d9f50f42bcee50c3d1709d3ad46d`);
- prototype input: `wp/mobile-prototype-20260817`
  (`60a087959bba8bcb385160db80e0e3b22e7872df`);
- their common ancestor:
  `b863190acde451b3987c5bb434fafb8bfaa71644`;
- public `main` is not an integration base: it has no merge base with the
  C3-derived mobile/core history.

## Release boundary

The repository may contain release configuration and verification scripts, but
never private signing material, pairing secrets, production credentials or
recoverable hashes derived from weak secrets.  A production release remains
blocked until an operator supplies external signing material and accepts the
physical-device and security evidence.
