# Remote Access Over a Private VPN

Status: single-operator alpha, Phase 3 run 2D.

This describes the only supported way to reach the IntentSmith main API from
another device. Read the limits before the instructions: they are the reason the
instructions are this short.

## The default has not changed

With no configuration, the main API binds to `127.0.0.1`, requires no
credential, and treats local access as the trust boundary. Nothing below is
needed for local use, and nothing below happens unless you ask for it.

## What this supports

One operator, one bearer token, across an already-encrypted private VPN
(WireGuard, Tailscale, or equivalent). That is the whole model.

**Direct exposure to the public internet is not supported.** There is no TLS
here and no public listener. The token travels in a plaintext `Authorization`
header, so the transport underneath it must already be encrypted and already be
private. A port forward, a router rule or a DMZ host is not a supported
deployment however strong the token is.

## Enabling it

Three environment variables, all supplied at runtime:

| Variable | Meaning |
| --- | --- |
| `INTENTSMITH_HOST` | The VPN interface address to bind, e.g. `10.8.0.4`. Must be an IP literal. Defaults to `127.0.0.1`. |
| `INTENTSMITH_REMOTE_ACCESS` | The explicit opt-in. The only accepted value is `vpn`. |
| `INTENTSMITH_OPERATOR_TOKEN` | The operator credential. At least 32 characters, at least 8 distinct ones, no whitespace or control characters. |

```sh
INTENTSMITH_HOST=10.8.0.4 \
INTENTSMITH_REMOTE_ACCESS=vpn \
INTENTSMITH_OPERATOR_TOKEN="$(openssl rand -base64 48 | tr -d '\n=+/' )" \
  node apps/server/dist/index.js
```

Generate the token yourself and pass it through your own secret handling.
IntentSmith never generates, stores, substitutes, logs, audits, returns or
persists it. If you lose it, restart the server with a new one.

Clients send it on every request:

```sh
curl -H "Authorization: Bearer $INTENTSMITH_OPERATOR_TOKEN" http://10.8.0.4:47831/health
```

## What refuses to start

Configuration is read before a database is opened or a socket exists, and any of
these stops the process instead of producing a listener:

- a non-loopback `INTENTSMITH_HOST` without `INTENTSMITH_REMOTE_ACCESS=vpn`;
- `INTENTSMITH_REMOTE_ACCESS=vpn` with no token, or a token below the floor
  above;
- a token without the opt-in, which nothing would enforce;
- any `INTENTSMITH_REMOTE_ACCESS` value other than `vpn`;
- a wildcard bind (`0.0.0.0`, `::`), which would include interfaces you did not
  name, or a hostname, which something outside IntentSmith resolves.

Setting the opt-in and the token while leaving the default loopback bind is
allowed: it is the default plus a credential, which is strictly stronger.

## What is protected

In remote mode **every route on the main API requires the token**, including
`/health` and `/version`. Nothing is public. A liveness probe on a private VPN
can carry a header, and leaving even a version string answerable by anything
that can reach the port buys nothing worth the exception.

That covers project and task creation, reads, actions, results and audit; task
start, pause, resume and cancel; approval listing and approve/deny; provider,
model, hardware and recovery information; and `POST /inference/generate`
including every streamed byte.

The check is one `onRequest` hook registered before any route, so it runs before
body parsing, before schema validation and before any handler. Missing,
malformed and incorrect credentials all produce the same `401`
`OPERATOR_AUTH_REQUIRED` answer, which depends on nothing in the request but the
credential: a `401` never reveals whether the project, task, run or approval id
you named exists.

## Approvals

Approval decisions are reachable from the VPN once authenticated, and are
reachable no other way. The old peer-address guard is composed with the
credential rather than removed: with no credential configured it behaves exactly
as it did, and an authenticated operator satisfies it because the credential is
the stronger claim. An unauthenticated client never reaches ApprovalDesk.

The decision contract is unchanged. Both decision routes still take no body, so
a remote caller cannot name a tool, a path, a command, a duration or a scope; a
decision still authorizes one recorded request once.

## The worker gateway is not part of this

The OpenCode worker inference gateway stays loopback-only. It takes no host from
configuration, is not exposed remotely, and keeps its own per-run bearer tokens,
which live in memory only and are revoked on every terminal path. The operator
credential is not a gateway token and is rejected there.

## Known limits

- Transport security is entirely the VPN's. IntentSmith terminates no TLS.
- One credential, one operator. There are no accounts, roles, sessions,
  rotation, revocation or per-device identity: rotating means restarting with a
  different token.
- The `intentsmith` CLI does not send the credential, so it is a local-only
  client in this alpha.
- Nothing here rate-limits or locks out a guessing client; the VPN is the
  perimeter that makes that acceptable.
