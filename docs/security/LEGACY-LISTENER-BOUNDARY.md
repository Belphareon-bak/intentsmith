# Legacy listener security boundary

The existing IntentSmith HTTP API and `/c3/ws` terminal are trusted-local
surfaces. They do not provide the complete authentication, device binding, and
per-operation scope enforcement required for remote exposure.

## Enforced bind contract

- The legacy listener binds only to the exact numeric address `127.0.0.1`.
- Host input is canonicalized before use, and the exact canonical value that
  passes validation is passed to `server.listen()`.
- For the production `src/server.js` entrypoint, its first import validates the
  host through `runtime-environment.js` before the database or other runtime
  state can initialize. Other module entrypoints do not inherit that
  pre-initialization guarantee and must import the bootstrap explicitly; the
  listener bind and per-request policies still revalidate fail closed.
- For that production server entrypoint, wildcard, symbolic, IPv6, LAN, VPN,
  public, explicitly blank, and malformed host values fail before runtime state
  or `server.listen()` with `C3_LEGACY_LISTENER_LOOPBACK_REQUIRED`.
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

## Electron HTTP client and media boundary

The tracked Electron renderer now installs one main-world fetch bootstrap
before Theia extensions load. It obtains the backend URL and capability from
one private-port-file snapshot, resolves the legacy renderer's relative
`/api/*` calls, and adds `X-IntentSmith-Local-Capability` only when the request
origin exactly matches that backend URL. Different schemes, host aliases,
ports, and foreign origins never receive the capability; a caller-supplied
copy is removed before a foreign request. Local redirects fail closed.

The three media element and navigation consumers load through the
capability-bearing wrapper, create
object URLs in per-consumer cache instances capped at 24 completed entries each,
and revoke obsolete URLs. Each cache keeps at most 256 failed targets in an
absolute 60-second cooldown, so repeated renders cannot continuously refetch a
broken output. It records only an active owner's non-abort failure; expiry,
explicit invalidation, pruning, clearing, or a generation-complete event allows
an immediate retry. Invalidating or pruning aborts owned pending loads, the
center widget also clears its cache on disposal, and an eventual late response
cannot reinsert a stale URL or poison its replacement. No capability is placed
in a media URL or query string. Render-phase health polling and LRU-touch side
effects remain separately visible as `G0-R030`; this boundary does not claim
their lifecycle repair.

## HTTP browser-origin boundary

Every legacy HTTP request is evaluated before URL parsing, rate limiting,
route dispatch, or body processing. The guard rejects a non-loopback peer, a
host authority that does not identify the assigned local port, a foreign or
malformed origin, an originless cross-site browser request, and an opaque
`null`/`file:` origin without the exact per-process capability. Supplying that
capability never authorizes a foreign origin. Originless native loopback
clients, the exact backend origin, and explicitly configured local origins
retain their existing contracts.

Authorized CORS responses name the exact accepted origin and vary on `Origin`,
`Access-Control-Request-Headers`, `X-IntentSmith-Local-Capability`, and
`Sec-Fetch-Site`; there is no wildcard fallback and a cache cannot reuse an
authorized opaque response across capability or fetch-site decisions. The
headers are installed before routing so routes that call `writeHead()`
directly preserve the same boundary. Opaque Electron preflight is limited to
the explicit capability header and local methods. Rejections return the stable
403 code `C3_LEGACY_LOCAL_ACCESS_REQUIRED` and log only bounded non-secret
metadata: reason code, method, and peer address. The capability is never
logged.

The registered `C3-023` route-smoke suite starts an owned server with private
HOME/XDG/temp/database/project/artifact/port-file paths. Its live matrix proves
that foreign origins, hostile Host headers, copied or wrong capabilities and
cross-site originless requests are rejected before a workspace sentinel can
be created. It also proves exact-target, configured-local and correctly
capability-bearing opaque requests still work, including preflight and a
direct-`writeHead()` response. Shutdown and private port-file removal are
verified before the authenticated fixture is removed.

S-1 local containment is complete. `G0-R018` nevertheless remains open under
accepted decision D-024 as a later-gate remote-boundary risk: the legacy
listener must remain strictly loopback-only until a physically separate
authenticated remote listener and bypass-negative tests exist. This checkpoint
does not change the generated Gate 0 verdict.

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
