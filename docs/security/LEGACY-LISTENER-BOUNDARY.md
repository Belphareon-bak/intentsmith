# Legacy listener security boundary

The existing IntentSmith HTTP API and `/c3/ws` terminal are trusted-local
surfaces. They do not provide the complete authentication, device binding, and
per-operation scope enforcement required for remote exposure.

## Enforced bind contract

- The legacy listener binds only to the exact numeric address `127.0.0.1`.
- Host input is canonicalized before use, and the exact canonical value that
  passes validation is passed to `server.listen()`.
- The host is validated by `runtime-environment.js` before the database or
  other runtime state can initialize.
- Wildcard, symbolic, IPv6, LAN, VPN, public, explicitly blank, and malformed
  host values fail before any runtime state or `server.listen()` with
  `C3_LEGACY_LISTENER_LOOPBACK_REQUIRED`.
- An omitted `C3_HOST` keeps the safe `127.0.0.1` default.
- `C3_HOST` is not a remote-access switch. Setting it to a non-loopback value
  makes startup fail closed.

The contract is implemented in
`src/security/legacy-listener-policy.js` and used by `src/server.js`.
The registered deterministic `C3-023` suite
`tests/routes-smoke.test.js` covers accepted hosts, rejected hosts, rejection
before the bind call, canonical check/bind identity, and production wiring.

## WebSocket browser-origin boundary

Loopback alone is not an authorization boundary. A remote web page can target
local HTTP and WebSocket endpoints. `/c3/ws` now rejects non-loopback peers,
invalid target authorities, foreign origins, and opaque origins without the
per-process 256-bit capability stored in the private mode-0600 port file.
Same-origin local browsers and the originless Node backend bridge remain
compatible. The Electron preload exposes the capability only to the installed
renderer, which presents it as a secondary WebSocket subprotocol.

Originless loopback clients are intentionally inside the trusted-local threat
model. A same-user native process on the host can connect without the browser
capability; the capability is browser/Electron origin containment, not local
process authentication. Protecting against a malicious same-user process
requires a separate OS identity and IPC boundary and is not claimed here.

## Electron HTTP client staging

The tracked Electron renderer now installs one main-world fetch bootstrap
before Theia extensions load. It obtains the backend URL and capability from
one private-port-file snapshot, resolves the legacy renderer's relative
`/api/*` calls, and adds `X-IntentSmith-Local-Capability` only when the request
origin exactly matches that backend URL. Different schemes, host aliases,
ports, and foreign origins never receive the capability; a caller-supplied
copy is removed before a foreign request. Local redirects fail closed.

This is deliberately client-side staging. It does not authorize HTTP by
itself, and the server guard is not yet enabled. The three media element and
navigation consumers now load through the capability-bearing wrapper, create
object URLs in a shared cache capped at 24 completed entries per consumer, and
revoke obsolete URLs. Invalidating or pruning aborts owned pending loads, the
center widget also clears its cache on disposal, and an eventual late response
cannot reinsert a stale URL. No capability is placed in a media URL or query
string.

The HTTP mutation boundary still requires the corresponding request guard.
Until that guard and its live negative test are in place, S-1 remains
incomplete and `G0-R018` remains open. Under accepted decision D-024 it is a
later-gate risk only while the legacy listener remains strictly loopback-only;
this checkpoint does not change the generated Gate 0 verdict.

## Explicitly outside this boundary

This change does not implement a remote listener, `/m1`, pairing, mobile
authentication, or a mobile client. Any future remote listener must be
physically separate and must prove through network-level negative tests that a
remote peer cannot reach legacy `/api/*` routes or `/c3/ws`.

## Verification

With committed dependencies installed:

```bash
node tests/routes-smoke.test.js
node tests/ws-bridge.test.js
node tests/upgrade-ux-v125.test.js
node tests/repository-hygiene.test.js
node scripts/validate-test-registry.js
node scripts/validate-final-disposition.js
(cd c3-ide/applications/electron && ../../node_modules/.bin/theia build --mode production)
```

The T1 suites pin the tracked preload, exact-target fetch wrapper, no-leak
behavior, idempotence, request preservation, and client source wiring. The
separate production Theia build verifies that the generated, ignored Electron
bundle contains that wiring; generated build output is never committed as
evidence.

Because this is a source and test change, it invalidates the prior Gate 0
candidate. A new clean candidate run and generated evidence are required before
any Gate 0 verdict can describe this boundary.
