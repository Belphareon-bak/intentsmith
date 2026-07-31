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

## Open browser-origin boundary

Loopback alone is not an authorization boundary. A remote web page can target
local HTTP and WebSocket endpoints. Until the shared HTTP/WS Host, Origin, and
local-client capability checks are implemented and pass negative tests, S-1
remains incomplete and `G0-R018` remains a Gate 0 blocker.

## Explicitly outside this boundary

This change does not implement a remote listener, `/m1`, pairing, mobile
authentication, or a mobile client. Any future remote listener must be
physically separate and must prove through network-level negative tests that a
remote peer cannot reach legacy `/api/*` routes or `/c3/ws`.

## Verification

With committed dependencies installed:

```bash
node tests/routes-smoke.test.js
node scripts/validate-test-registry.js
node scripts/validate-final-disposition.js
```

Because this is a source and test change, it invalidates the prior Gate 0
candidate. A new clean candidate run and generated evidence are required before
any Gate 0 verdict can describe this boundary.
