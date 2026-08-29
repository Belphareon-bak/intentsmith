# Remote Companion capability contract v1 — candidate

**Status:** `CANDIDATE_NOT_ACCEPTED / NO_BACKEND_AUTHORITY /
NO_TRANSPORT_AUTHORITY / REVIEW_PENDING`

**Current release boundary:** M5 `8/9`; M6 `ACCEPTANCE_BLOCKED`.

This package is the executable consumer requirement for the future M7 Remote
Companion. It is integrated on top of the current M6 core only as a contract,
fixture and in-process conformance boundary. It does not open a listener, mint
credentials, authorize pairing, persist sessions or make any capability
available in production.

## Immutable identity

- requirements digest:
  `sha256:e076d2f17484772474bb9c4c806d156c369645fd4af395bfb19a58beee4a0654`;
- accepted M2 `RemoteCorePort@1` descriptor:
  `sha256:245abe3a13d7d60ac537c7672522872df20f855d990bee0f02b2826379b56c52`;
- reviewed M5 in-process adapter manifest:
  `sha256:34f3c20c94e1c4316ad76e8c92c1ce8b7dab0868b7685c3d5a637a6f6aa98e52`.

The candidate covers seven capability identities and fourteen mobile
operations. `conversations@2` adds list/history while preserving the accepted
v1 execute operation. `projects@2` is rootless on the wire: the client never
supplies `canonicalRoot`; server-side project authority resolves it.

Pagination binds cursor, subject, query, filters, operation, snapshot and
limit. Event retention loss is an explicit `REMOTE_EVENT_WINDOW_GONE`, never
an empty page. Mutations require a stable operation ID and expose typed replay,
conflict and unknown-outcome states.

The four operation-journal/health methods remain a separate M7 control-plane
prerequisite. They are not smuggled into capability digests and do not become
available by importing this package.

## Forbidden shortcuts

- Legacy `/api/*`, `/m1/*` a `/c3/ws` are not M7 transport adapters.
- A phone cannot assert actor, subject, scope, grant, token, device identity,
  endpoint, `canonicalRoot` or an absolute host path.
- A provider cannot import a listener or route and cannot bypass the M1/M2
  authority validators.
- A valid simulator result is not evidence that a production provider,
  transport or mobile release exists.

Acceptance requires an independent review of this exact package, provider
conformance against the accepted core validators, an authenticated M7 session
boundary and negative reachability evidence. Until then the product must keep
the full remote capability set unavailable.
