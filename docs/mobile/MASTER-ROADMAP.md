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

Current MM3 sub-checkpoints: project list/detail (`1a7be999`), conversation
provider boundary (`ddb90e7e`) and live project-to-conversation drill-down
(`701308d8`), followed by complete global conversation-list pagination
(`34bc19de`), complete state-filtered project-list pagination (`075f5eb7`) and
fail-closed project-detail integrity (`a08d0dd0`).
Project list and detail cache lifecycle alignment follows in `1d449b78`.
Conversation list/thread cache lifecycle enforcement follows in `6dd452f7`.
Conversation thread integrity and HTTP cache isolation follows in `7a6b379e`.
The drill-down reuses the exact conversation read route, requires
both project and chat read scopes, isolates cursors per project and adds no
mutation. The global list now consumes its existing opaque continuation,
validates exact pages and persists the confirmed S1 window plus boundary.
Active and archived projects now apply the same rule to their separate,
state-bound streams without adding mutation authority. Detail live/cache
snapshots now require the exact public DTO and requested id; expired/corrupt
snapshots, conclusive not-found results and late route generations cannot be
published. List and detail now share the `MD-02` 15-minute fresh / seven-day
expiry policy while project-conversation membership stays live-only. MM3
also now applies the distinct `MD-03` 15-minute/30-day metadata and `MD-04`
15-minute/seven-day S2 thread windows, deleting expired thread content before
publication. The exact route-bound thread/page/cache consumer now rejects
malformed, duplicate, overlapping and stale-generation data, clears on scope
loss, distinguishes server not-found from a never-sent local draft and keeps
both conversation read routes out of browser HTTP caches. MM3 remains open for
server-backed global search, authoritative live run
progress/cancel, frozen wire prerequisites and device evidence.

Current MM4 sub-checkpoints: settings read (`87a51930`), stored-information
read (`2c33fd9b`), worker/specialist read (`49dd991d`), paired-device lifecycle
(`13fa98c6`), revisioned UX-settings write (`4bb9011d`) and create-only manual
stored information (`3341ea11`), and guarded worker enable/disable
(`7ac9e303`), followed by worker detail and terminal run history
(`fd8ad498`), persisted specialist package/expertise detail (`241b8934`) and
fail-closed configured-list integrity (`acff7939`), followed by exact public-
settings read integrity (`99cdfdde`) and exact stored-information list
integrity (`d1f0a98a`), paired-device list integrity (`af33f984`) and
notification inbox integrity (`656941d4`). Worker
and specialist list
pages and cache snapshots now require exact public DTOs, coherent opaque-cursor
boundaries and no duplicate/overlapping ids; only an exact live worker page can
support its existing guarded toggle.
The live settings consumer now accepts only the exact versioned DTO and the 46
core-owned public paths; malformed or unowned data cannot render or unlock the
11-path revisioned editor.
The stored-information consumer now validates exact LTM/task records, walks the
existing opaque cursor to its confirmed end and persists only an exact
`{ items, page }` window. Invalid reads retain no mutation authority.
The device consumer now validates the exact public snapshot and current-device
binding before publication; its cache is read-only and only a current live read
can unlock the existing revoke flow.
The notification consumer now binds exact S1 records to a monotonic sequence
window, validates current/legacy cache, separates read/write scopes and grants
ACK only after a current live read. MM4 remains open for governed specialist
actions and accepted production notification delivery/push policy; live run
progress and broader worker lifecycle commands remain open. Memory replacement,
deletion and task-memory writes are explicitly outside current mobile authority.

Current MM5 sub-checkpoints: packaged native transport (`a5d5bab4`), direct
AndroidKeyStore credential vault (`14be72b8..71746be5`), encrypted native
app-state (`3817cc00`), mandatory browser accessibility (`4dd33b49`) and
backend-mirror browser usability (`da6abe27`). MM5-C stores cache, drafts, operation journal, scopes
and preferences in a separate bounded AES-GCM record, migrates plaintext only
after a confirmed encrypted write, clears decrypted state on lock and requires
durability before native mutations. MM5-D provisions the Puppeteer-resolved
Chrome explicitly, moves the fail-closed browser suite into the required mobile
gate, aligns its paging fixture with the exact MM3-I DTO and removes the navbar
contrast exclusion by measuring settled frames. MM5-E expands that sweep to
18 populated surfaces/states, correctly measures sRGB colour-mix layers, fixes
primary/danger/navbar contrast and checks mirror reflow at 320/390 CSS pixels
with 100%/200% browser fonts. See the
[MM5-E review package](reviews/MM5E-MIRROR-BROWSER-USABILITY.md).
MM5 remains open for remote
TLS/peer identity, production notification/offline policy, physical
accessibility/device evidence and independent security acceptance.

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
