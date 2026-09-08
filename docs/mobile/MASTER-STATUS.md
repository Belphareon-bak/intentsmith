# IntentSmith Mobile Master Status

Updated: 2026-09-08
Branch: `mobile/master-prod-ready`
Current milestones: `MM3`–`MM6` in parallel (`MM2` freeze dependency and MM3
run authority remain open)
Release verdict: `NOT READY`

## Milestone ledger

| Milestone | Status | Review commit/range | Notes |
|---|---|---|---|
| `MM0` provenance and branch | `COMPLETE` | `550856e5` | core base selected; prototype integration follows |
| `MM1` prototype integration | `COMPLETE` | `550856e5..fec916b8` | merge `c1994d9b`; mobile gate 37/37 active |
| `MM2` RemoteCorePort | `IN PROGRESS` | candidate `f4861bca` | 10 production provider registrations; freeze remains open |
| `MM3` primary mobile surfaces | `IN PROGRESS` | projects `1a7be999`; conversations `ddb90e7e`; project drill-down `701308d8`; conversation paging `34bc19de`; project paging `075f5eb7`; detail integrity `a08d0dd0`; project cache `1d449b78`; conversation cache `6dd452f7`; thread integrity `7a6b379e` | project/list/detail/thread caches follow their documented lifecycles; complete paging, exact route-bound thread integrity, HTTP-cache isolation and live project drill-down are implemented; search/runs, wire freeze and device evidence remain open |
| `MM4` governed surfaces | `IN PROGRESS` | settings read `87a51930`; memory read `2c33fd9b`; workers/specialists `49dd991d`; devices `13fa98c6`; settings write `4bb9011d`; memory create `3341ea11`; worker state `7ac9e303`; worker history `fd8ad498`; specialist detail `241b8934`; list integrity `acff7939`; settings integrity `99cdfdde`; memory integrity `d1f0a98a`; device integrity `af33f984`; notification integrity `656941d4` | read projections, paired-device revocation, revisioned UX-setting writes, create-only manual memory, guarded worker enable/disable, terminal worker-run history, inspectable specialist expertise bindings and fail-closed configured-list/settings/memory/device/notification consumers are implemented; specialist actions and production notification delivery/push policy stay open |
| `MM5` transport and hardening | `IN PROGRESS` | transport `a5d5bab4`; credential vault `14be72b8..71746be5`; encrypted app-state `3817cc00`; active browser accessibility `4dd33b49`; mirror usability `da6abe27` | packaged native transport, direct AndroidKeyStore credential vault, encrypted app state and mandatory browser gate implemented; MM5-E repairs contrast/touch/reflow across 18 populated surfaces/states; remote TLS/identity, push/offline policy, physical accessibility/device evidence and external security review remain open |
| `MM6` Android release | `IN PROGRESS` | platform `d4607100`; CLI `d8bbea33`; artifacts `8e98924d` | API 36, cross-platform workflow, versioned APK/AAB manifest and SBOM implemented; binary build, production signing and device evidence open |

## Known external blockers

- The future local mobile implementation and its security work are unavailable;
  no equivalence or superiority claim is made against it.
- Production signing keys and distribution accounts are intentionally absent.
- Physical Android hardware is not attached to the current build host.
- JDK 21 and the Android SDK are absent on this host; no APK/AAB build is
  claimed, and the Android SDK licence was not accepted on the operator's behalf.
## Latest verification

- Mobile gate: `PASS` — 55/55 active suites, zero withheld. The required
  browser accessibility program ran inside the gate and passed 24/24.
- Browser accessibility: `PASS` in headless Chrome — 18 populated surfaces
  and states now include projects, agents/history, specialists/expertises,
  device revocation, settings and memory. MM5-E fixes the old colour-mix
  measurement blind spot and real contrast/touch/reflow defects. The ten added
  mirror states fit 320/390 CSS pixels at 100%/200% browser fonts. Navbar,
  trust-bar and chat-scroll checks remain green. See
  [MM5-E review](reviews/MM5E-MIRROR-BROWSER-USABILITY.md). TalkBack, native-only
  PIN flows and the physical AT/OS matrix remain unverified by this sweep.
- Notification inbox integrity: `PASS` — 36/36 combined overview/client
  scenarios, 10/10 per-device ACK, 6/6 sequence uniqueness, 9/9 fail-closed
  wiring, 24/24 closed-S1 producer and 5/5 owned-process HTTP E2E. The client
  validates exact producer vocabulary and sequence boundaries, persists only
  validated `{ items, page }`, never authorizes ACK from cache and does not
  auto-retry an ambiguous ACK. Production push/delivery policy remains open.
- RemoteCorePort candidate: 12/12 contract checks.
- Backend inventory: 250 unique static routes, including 26 exact `/m1`
  routes; digest
  `c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.
- Android platform invariant suite: `PASS` — 8/8; Capacitor 8.4.3, API 36,
  Java 21 and fail-closed signing configuration.
- Mobile-app dependency audit: `PASS` — 0 known vulnerabilities in the full
  and production-only dependency trees.
- Packaged transport: `PASS` — 8/8 checks; no production `server.url`, no
  remote cleartext endpoint, no CORS widening and all client API calls retain
  the `/m1` boundary.
- Android release CLI: `PASS` — 11/11 checks on Windows; `doctor` runs without
  Bash and accurately reports the absent JDK, SDK, signing material and device.
- Direct AndroidKeyStore and app-state boundary: `PASS` — 15/15 source
  invariants and 25/25 client credential/storage/lifecycle scenarios. Native
  cache, drafts, journal, scopes and preferences are a separate bounded AES-GCM
  record; migration is commit-before-delete, lock drops decrypted WebView state,
  mutations await durable writes and logout rotates to preferences only. Four
  device-side instrumented tests are implemented but not run without an Android
  toolchain and target.
- Paired-device lifecycle: `PASS` — 8/8 gateway/database scenarios and 15/15
  client scenarios after MM4-M list-integrity coverage. The client requires an
  exact 11-field public snapshot, unique ids and one current row bound to its
  credential; corrupt cache is removed and valid cache remains read-only.
  Only a current live read can unlock the journalled revoke flow, and lock,
  offline, reconnect, scope loss or failed revalidation withdraw that grant.
  Self-revocation clears the local credential; remote wipe is not claimed.
- Revisioned settings write: `PASS` — 13/13 gateway/core scenarios and 13/13
  client scenarios. Only 11 `UX_PREFERENCES_V1` paths are writable;
  `write:settings` is pairable but non-default, and ambiguous results are never
  auto-retried.
- Public-settings read integrity: `PASS` — the gateway/core suite remains
  13/13 and the expanded client suite is 17/17. Only the exact versioned DTO
  and all 46 core-owned public paths are accepted; the test compares the
  browser mirror directly with the core export. Unknown/private/nested fields,
  non-finite JSON, malformed status/envelope and stale response generations
  cannot publish or unlock the separate 11-path revisioned editor.
- Create-only stored information: `PASS` — 12/12 gateway/core scenarios and
  21/21 client scenarios after MM4-L list-integrity coverage. Exact LTM/task
  DTOs, opaque-cursor pagination, `{ items, page }` cache validation,
  duplicate/overlap rejection and live-authority relocking now guard the read.
  `write:memory` is pairable but non-default; only a
  new explicit LTM value may be inserted, while replacement, deletion, task
  memory and internal categories remain unavailable. Ambiguous effects become
  `UNKNOWN` and are never auto-retried.
- Guarded worker state: `PASS` — 12/12 gateway/core scenarios and 12/12
  client scenarios. `write:workers` is pairable but non-default; enable/disable
  is accepted only over a successful live read and matching expected state,
  is delegated to the existing worker repository/scheduler owner, and an
  ambiguous result is never auto-retried. Specialist mutations remain
  unavailable pending a safe live `SpecialistLoader` authority port.
- Worker detail and terminal run history: `PASS` — 15/15 gateway/core
  scenarios and 15/15 client scenarios. `GET /m1/workers/:id/runs` walks
  newest-first metadata with a worker-bound opaque cursor and excludes running
  rows, logs, errors, explanations, trigger identities and all run commands.
  The detail is live-only and is not persisted as an offline history cache.
- Specialist package and expertise detail: `PASS` — 18/18 gateway/core
  scenarios and 18/18 client scenarios across the combined worker/specialist
  suites. `GET /m1/specialists/:id` returns only persisted public package
  metadata and ordered expertise bindings; manifest, prompts, tools, runtime
  state, execution data and every specialist mutation remain excluded. The
  detail is live-only, `no-store` and does not claim runtime registration.
- Configured-list integrity: `PASS` — the combined backend suite remains
  18/18 and the client suite is 24/24. Worker and specialist pages now require
  exact public DTOs and coherent opaque-cursor boundaries, reject duplicate or
  overlapping ids without changing the confirmed window/cache, discard
  corrupt cache snapshots and keep only the newest response per domain. A
  malformed worker page also withdraws the live proof required by toggle.
- Project conversation drill-down: `PASS` — 11/11 gateway/core scenarios and
  17/17 client scenarios. The existing conversation-list route accepts a
  closed `projectId` filter only with both `read:chat` and `read:projects`,
  isolates opaque cursors per project, excludes deleted/other-project rows and
  keeps the result live-only with transport/browser `no-store` and no durable
  client cache. Project/conversation mutations, search and run progress remain
  outside this checkpoint.
- Complete global conversation list: `PASS` — 25/25 client scenarios. The
  phone now renders the backend-confirmed partial boundary, appends only with
  its opaque cursor, rejects malformed/overlapping pages, keeps the newest
  concurrent response and stores a validated S1 `{ items, page }` snapshot.
  Legacy array caches remain readable without a fabricated continuation;
  losing `read:chat` withdraws the list, cursor and durable cache together.
- Conversation cache and thread integrity: `PASS` — the combined overview
  suite is 37/37, `mobile-ms07-history` is 22/22 and server pagination/cache
  boundary is 23/23. `MD-03` metadata is fresh for
  15 minutes and expires at 30 days; `MD-04` S2 threads are fresh for 15
  minutes and expire at seven days. Expired thread content is deleted before
  publication. Live/current/legacy snapshots are exact and route-bound;
  duplicate/overlap, corrupt cache, stale generations and scope withdrawal
  fail closed. Client and gateway exclude list/thread success, handler errors
  and authorization errors from browser HTTP caches.
- Complete project filters: `PASS` — 11/11 gateway/core and 23/23 client
  scenarios. Active and archived lists now walk their existing state-bound
  opaque cursors, validate exact rows/response state, reject overlaps and late
  cross-filter responses, and persist separate validated `{ items, page }`
  snapshots. No project mutation or new route was introduced.
- Project-detail and cache lifecycle: `PASS` — the gateway/core suite remains
  11/11 and the expanded project client suite is 31/31. Live and cached detail now
  require the exact versioned public DTO and requested id; corrupt/expired
  cache, definitive not-found, scope loss and late route generations cannot
  republish stale authority. Ambiguous offline/server/protocol failures retain
  only a valid non-expired copy with explicit cache and recovery labelling.
  List and detail now share the `MD-02` 15-minute fresh / seven-day expiry
  policy. Project-conversation membership remains live-only and uncached.
- Release artifacts: `PASS` — 10/10 checks; Gradle consumes the tracked
  `0.1.0`/`1000` metadata and the workflow requires signed APK+AAB, CycloneDX
  SBOM and a source/endpoint/signer manifest.
- Test registry: 437 runnable programs; digest
  `bc0f50334497555c729a1bc0cd304337d1df08476d0546aaad9b1f0ceb42dd74`.
- Module boundary: `PASS` — 1,106 edges, 3 pre-existing cycles; reviewed
  provider additions are pinned to their MM3/MM4 checkpoint commits.

## Truth rules

- `IMPLEMENTED` means code exists and is reachable.
- `TESTED` additionally names an executable test and its result.
- `DEVICE VERIFIED` requires captured evidence from a physical device.
- `RELEASE READY` requires a clean-clone build, current target API, dependency
  review, signed-artifact procedure and accepted device/security reviews.
