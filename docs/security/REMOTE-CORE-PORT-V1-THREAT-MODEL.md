# RemoteCorePort v1 threat model

## Security claim

`RemoteCorePort` v1 is an in-process compatibility and capability-negotiation
contract. It is not a listener, authentication protocol, pairing flow, device
credential, approval or effect authority. Importing the contract or its
unavailable provider performs no I/O and creates no route, socket, database
connection or background process.

The M2 provider is intentionally unavailable. A compatible hello receives one
typed unavailable result for every requested capability and an overall
`REMOTE_CORE_NO_CAPABILITY_AVAILABLE` error. A client that offers no shared
port version receives `REMOTE_CORE_PORT_VERSION_INCOMPATIBLE`. Neither outcome
is success and neither grants access to core state.

## Protected assets and authority

The protected assets are registered project identity and content,
conversations, settings, stored information, approval intents and grants,
notifications, event streams, credentials and all effectful runtime actions.
The connector descriptor lists the minimum existing authority contracts for
each capability, but negotiation does not instantiate or satisfy any of them.

`RemoteCoreHello.clientId`, `clientBuild`, requested versions and capability
names are untrusted compatibility metadata. They are never an authenticated
actor, project scope, device identity, grant subject or audit principal.

## Trust boundaries

1. M2 freezes the in-process descriptor, hello and negotiation result.
2. M5 may implement an in-process core adapter, but must preserve exact
   capability contracts and the existing effect/approval/lifecycle authority.
3. M7 must add a physically separate listener, authentication, pairing, device
   scope, expiry, revocation and per-operation audit before any network client
   can reach the M5 adapter.
4. The legacy HTTP API and `/c3/ws` remain trusted-local, numeric
   `127.0.0.1`-only surfaces. They are not a transport implementation for this
   connector and may not be rebound or proxied as one.

## Threats and required controls

| Threat | M2 control | Later owner |
|---|---|---|
| Unknown-field or version smuggling | exact keys, sorted unique explicit versions, no implicit downgrade | frozen here |
| Empty or partial false success | negotiated requires at least one available capability; every request has one result | frozen here |
| Client identity treated as authority | hello schema contains no actor, token, grant, payload or endpoint | M7 authenticates separately |
| Capability overclaim | available requires client-offered version plus contract and operations digests | M5 provider evidence |
| Legacy listener remote bypass | remote modules are not imported by server; legacy bind stays exact loopback | M5/M7 negative gate |
| Import-time effect or hidden provider | unavailable provider exposes only `describe` and `negotiate` and imports only the contract | frozen here |
| Pairing/token leakage | those fields and functions do not exist in M2 scope | M7 |
| Approval replay or payload substitution | negotiation is non-authoritative; actual approval remains subject/payload-bound M2 lifecycle/effect authority | M5 adapter |

## Explicit non-claims

- No remote transport, confidentiality, peer authentication or availability is
  provided.
- No capability payload schema or provider is claimed available by M2.
- No mobile application or device can connect through this work package.
- Loopback protects the legacy listener from network bind exposure, not from a
  malicious same-user native process; that accepted local boundary is unchanged.
