# ADR 0020: Remote Operator Access Over a Private VPN

Status: accepted for Phase 3, run 2D

Date: 2026-07-29

Supersedes nothing. Extends the local-only posture of ADR 0012 and the
loopback-only worker gateway of ADR 0015 without relaxing either.

## Context

Through Phase 2 and Phase 3B the trust boundary was the machine: the main API
bound `127.0.0.1`, and anything that could reach the socket was the operator.
That is a real boundary and it was enough while the only client was a CLI on the
same host.

Phase 3 made the product something a person waits on. A run driven by the real
OpenCode binary against a local 14B model takes minutes and stops on a pending
approval that only a human can answer (`artifacts/phase-3-2c-real-binary.json`:
`approved-edit`, `deny-while-pending`, `cancel-while-pending`,
`timeout-while-pending`). An approval nobody can reach is an approval that
expires, and the run fails for a reason that has nothing to do with the work.
The operator therefore needs to answer from a phone or a laptop that is not the
workstation.

That is the only requirement. It is not multi-user, not a hosted service, and
not a public endpoint, and building for any of those would add credential
administration, session handling and role evaluation with nothing behind them
in an alpha that has exactly one human.

This ADR records the decisions implemented in run 2D
(`15aa0234`, `apps/server/src/remote-access.ts`,
`docs/security/remote-vpn-access.md`). It documents what was built; it does not
redesign it.

## Decision

### The default does not change

With no configuration the main API binds `127.0.0.1`, requires no credential,
and treats local access as the trust boundary exactly as before. Everything
below is inert until an operator asks for something else, and every caller and
test that existed before 2D is unchanged.

The default is loopback rather than "loopback unless a config file says
otherwise" because the failure mode of a mistaken default is a listener nobody
knows about. Remote access has to be typed.

### Remote access is an explicit, named opt-in

`INTENTSMITH_REMOTE_ACCESS=vpn` is the only accepted value, and the value names
the transport it assumes rather than being a boolean. `=true` would say the
operator wanted remote access; `=vpn` says they accepted that the confidentiality
of the credential and the traffic is the VPN's job. An unrecognized value is a
startup error, not a fallback to off: a typo in the opt-in must not silently
produce the configuration the operator was trying to change.

### One runtime-supplied operator credential

One operator, one bearer token, supplied at runtime through
`INTENTSMITH_OPERATOR_TOKEN` and never persisted, logged, audited, returned or
written to any file.

IntentSmith never generates, stores or substitutes one. A product that mints a
credential has to store it, and then has to decide where — a config file, the
database, a keyring — and each of those is a place it can be read from. Not
having one is the cheapest way to not leak one. If the operator did not supply
a credential, the process does not start.

A floor is enforced: at least 32 characters, at least 8 distinct, no whitespace
or control characters. This rejects the failures that actually happen — a
placeholder, a single word, a repeated character, a truncated paste — without
pretending to measure entropy IntentSmith cannot see. Validation messages name
the rule that was broken and never quote the value that broke it, so a startup
failure cannot put the credential into a terminal, a log file, a CI record or a
bug report.

### Authentication is central, and decided before route dispatch

One `onRequest` hook, registered before any route. It therefore runs before body
parsing, before schema validation and before every handler, and a route added in
a later phase cannot forget to ask.

The alternative — a per-route guard — is a rule that has to be remembered on
every future change, and the cost of forgetting it once is an unauthenticated
endpoint. Deciding authority in exactly one place makes that impossible rather
than unlikely.

In remote mode **nothing is public**, including `/health` and `/version`. A
liveness probe on a private VPN can carry a header, and leaving a version string
answerable by anything that can reach the port buys nothing worth the exception.

Missing, malformed and incorrect credentials produce one identical `401`
`OPERATOR_AUTH_REQUIRED` answer that depends on nothing in the request but the
credential itself, so a `401` never reveals whether the project, task, run or
approval id named in the URL exists. Comparison is constant-time over SHA-256
digests, so neither the comparison nor the buffer lengths reveal how much of a
guess was right.

### The bind target is an exact IP literal, and never a wildcard

Under the opt-in, `INTENTSMITH_HOST` must be a loopback target or an IP literal.

A wildcard (`0.0.0.0`, `::`) is refused because it binds interfaces the operator
did not name — a laptop that is on a VPN is usually also on a café network, and
"every interface" includes that one. A hostname is refused because it is
resolved by something IntentSmith does not control, so the interface it lands on
is not necessarily the one the operator meant.

### Fail closed, before anything is opened

Configuration is read before a database is opened or a socket exists, and every
path that could produce a listener reachable from off-machine without a
credential is a startup error rather than a warning:

- a non-loopback bind without the opt-in;
- the opt-in with no credential, or one below the floor;
- a credential without the opt-in, which nothing would enforce — partial
  configuration is a mistake with a security consequence, because the operator
  believes a credential is being applied and it is not;
- an unsupported opt-in value;
- a wildcard bind or a hostname.

A warning is not sufficient here. A warning produces a running listener that
somebody has to notice, and the whole point is that nobody has to notice.

The opt-in and a credential with the default loopback bind is allowed: it is the
default plus a credential, which is strictly stronger.

### The worker gateway is not part of this

The OpenCode worker inference gateway (ADR 0015) stays loopback-only. It takes
no host from configuration, is never exposed remotely, and keeps its own
per-run bearer tokens, which live in memory only and are revoked on every
terminal path. The operator credential is not a gateway token and is rejected
there.

Two credentials with different lifetimes and different blast radii are simpler
than one credential with two meanings. The operator credential authorizes a
human for the life of the process; a gateway token authorizes one worker for the
life of one run. Merging them would give a leaked worker token the operator's
authority.

### Approvals compose the peer guard with the credential

The pre-existing loopback peer-address guard on approval decisions is composed
with the credential rather than removed: with no credential configured it
behaves exactly as it did, and an authenticated operator satisfies it because
the credential is the stronger claim. An unauthenticated client never reaches
ApprovalDesk.

The decision contract is unchanged. Both decision routes still take no body, so
a remote caller cannot name a tool, a path, a command, a duration or a scope. A
decision still authorizes one already-recorded request once (ADR 0017).

### Transport confidentiality belongs to the VPN

IntentSmith terminates no TLS. The token travels in a plaintext `Authorization`
header, so the transport underneath it must already be encrypted and already be
private. A WireGuard or Tailscale interface address is the supported deployment.

**Direct exposure to the public internet is not supported**, whatever the
strength of the token — a port forward, a router rule or a DMZ host is out of
scope, not merely discouraged. Terminating TLS here would mean certificate
issuance, renewal, storage and trust decisions, all inside an alpha, and would
turn an unsupported deployment into a half-supported one.

## Accepted limitations

These are consequences of the decisions above, accepted deliberately for the
single-operator alpha and recorded so that no later phase mistakes them for
oversights:

- **Rotation is a restart.** There is no rotation or revocation mechanism;
  changing the credential means restarting the process with a different one.
  Acceptable because the process is operator-run and restarting it costs a run
  at most.
- **No accounts.** There is one credential and one operator. There is no
  registry, no per-device identity and no way to tell two clients apart.
- **No roles.** An authenticated operator can do everything the API exposes.
  There is nothing to separate: the one human already owns the machine, the
  workspace and the database.
- **No rate limiting or lockout.** Nothing here slows or blocks a guessing
  client. The VPN is the perimeter that makes that acceptable, together with the
  credential floor and constant-time comparison.
- **The CLI does not send the credential**, so `intentsmith` is a local-only
  client in this alpha.

Each of these is only acceptable *because* the transport is a private VPN and
the operator count is one. If either premise changes, this ADR must be revisited
before the deployment is.

## Consequences

- Remote operation has exactly one supported shape, which is the one documented
  in `docs/security/remote-vpn-access.md`. There is no partially-configured
  state, because every partial configuration is a startup error.
- The refusals are proven at two levels: in-process against the configuration
  contract and the route surface (`apps/server/src/remote-access.test.ts`), and
  at process level against the real entry point spawned as a child, where an
  unsafe configuration exits non-zero, opens no listener, and names the violated
  rule without echoing the credential
  (`apps/server/src/startup-refusal.process.test.ts`).
- Adding a second operator, a role, a rotation path or a public listener is a new
  decision and a new ADR, not a configuration change to this one.
