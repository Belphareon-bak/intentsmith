# MM4-I review — specialist package and expertise detail

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `241b8934`

This checkpoint makes the specialist section inspectable without pretending
that the standalone mobile gateway can see the live specialist runtime. A
paired device with `read:specialists` may open one installed package and read
its persisted public metadata and expertise bindings. No specialist mutation
or runtime claim was added.

## Delivered surface

- exact allow-list entry `GET /m1/specialists/:id` with
  `read:specialists`;
- exact `specialists.read` operation `{ operation: "detail", id }` behind
  `RemoteCorePort`;
- package id, name, version, domain, type, persisted lifecycle status and
  lifecycle timestamps;
- ordered expertise binding id, optional label, integer priority and added
  timestamp;
- a dedicated specialist detail screen linked from the specialist list;
- strict provider and client result validation, scope invalidation and
  `Cache-Control: no-store`.

The route accepts no query parameters. The specialist id is bounded to 128
non-control characters, is not trimmed or normalized, and a missing resource
is a named 404. An extra provider input field or extra client response field is
rejected rather than ignored.

## Data and truth boundary

The projection reads `specialists` and `specialist_expertises` in one SQLite
read transaction. It deliberately excludes:

- `manifest_json` and any manifest secrets;
- system prompts, expertise configuration and tools;
- live `SpecialistRuntime` registration or busy state;
- package filesystem paths, integrity results and migration records;
- specialist memory and execution telemetry;
- enable, disable, update, discover, bind, unbind or priority-edit commands.

The returned `status` is explicitly the persisted package status. It is not
renamed to `isRegistered` and the UI says that live registration is not
observable from this gateway process. Corrupt type, status, timestamp,
priority or binding data fails the whole detail closed without reflecting raw
database bytes.

The list remains eligible for the application's bounded S1 logical cache. The
detail is a live-only in-memory read, uses HTTP `no-store`, is never written to
the application cache and is cleared on scope/session invalidation. A cached
list item therefore cannot be silently promoted into a verified detail.

## Authority path

```text
GET /m1/specialists/:id
  -> exact route + read:specialists
  -> handleSpecialistDetail
  -> RemoteCorePort specialists.read { operation: detail, id }
  -> specialist mobile read model
  -> specialists + specialist_expertises
```

The same `specialists.read` provider used by the list owns this operation.
There is still no generic `/api/*` proxy, loader call, caller-selected SQL or
new provider registration.

## Verification

Observed on 2026-09-06 from checkpoint `241b8934`:

| Command | Result |
|---|---|
| `node tests/mobile-workers-specialists.test.js` | PASS — 18/18 |
| `node tests/mobile-workers-specialists-ui.test.js` | PASS — 18/18 |
| `node tests/mobile-gateway-boundary.test.js` | PASS — 38/38 |
| `node tests/mobile-data-model.test.js` | PASS — 41/41 |
| `node tests/remote-core-port-contract.test.js` | PASS — 12/12 |
| `node tests/mobile-packaged-transport.test.js` | PASS — 8/8 |
| `node tests/mobile-navbar.test.js` | PASS — 22/22 |
| `node tests/mobile-overview.test.js` | PASS — 18/18 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `node tests/mobile-capability-inventory.test.js` | PASS — 250 routes |

Generated backend inventory: 250 static routes, 26 exact mobile-v1 routes,
224 broader desktop/core routes and 86 routes mapped as candidate port
capabilities. Inventory digest:
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.

## Why specialist actions remain unavailable

Persisted rows are not the whole effect. `SpecialistLoader` coordinates
package code, runtime registration, capability/expertise registries,
migrations and cleanup. Its current enable path can register dependencies
before a later step fails and offers no expected-state plus durable recovery
contract. Direct DB updates or a thin wrapper would therefore create a false
atomicity claim. A future mobile mutation needs a live owner-level command,
precondition/revision, idempotent operation identity, recoverable outcome and
its own review checkpoint.

## Explicit non-claims

- Persisted package status is not proof of current runtime registration.
- This is not a manifest, prompt, tool, integrity, telemetry or memory viewer.
- This does not enable, disable, update, create or discover specialists and
  does not mutate expertise bindings.
- This does not freeze `RemoteCorePort`; v1 remains `CANDIDATE_V1`.
- Source and loopback tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, push policy, production signing and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the persisted-versus-live wording, read-transaction consistency,
closed input and response shapes, corruption fail closure, exclusion of
manifest/runtime/execution data, no-store detail, scope clearing, navigation
without mutation controls and the refusal to wrap a non-atomic loader. A green
source gate is not device or release evidence.
