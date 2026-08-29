# WP-M7-PROJECT-CORE-ADAPTERS

**Type:** write-enabled M7 core capability block

**Base revision:** `6e4fc2cf` (persistent-journal evidence HEAD)

**Current state:** `IMPLEMENTATION_GREEN / FOCUSED_GREEN / FULL_GATE_PENDING /
REVIEW_PENDING / NOT_ACTIVE`

## 1. User outcome

Implement the first complete production-backed M7 capability without exposing
a listener: `project.list` and rootless `project-context.query`. The phone
supplies only a numeric `projectId`; canonical host roots remain core-private.

## 2. Owned and forbidden paths

Owned:

- a reusable authenticated opaque-cursor codec;
- the project read-model and rootless M2 context adapter;
- focused provider-composition, cursor, foreign-subject, stale-snapshot and
  no-host-path tests;
- registry/module/artifact pins and evidence documentation.

Forbidden:

- HTTP, WebSocket, TLS or other listener/transport code;
- trusting a path, root, subject, scope or cursor key from a request payload;
- returning a registered host path in any result or error;
- weakening the accepted M2 `ProjectContextQuery/Snapshot@1` validator;
- composing the provider into the production server;
- implementing other M7 capabilities inside this block.

## 3. Authority contract

The adapter receives the authenticated subject and device only through the
provider context. Every project must pass an injected project-access authority
before its metadata or context is observed. Denial and absence share one
non-oracular error.

`project.list` recomputes the complete authorized project snapshot (bounded by
an explicit scan limit), including exact workspace revisions, before serving a
page. A continuation cursor is HMAC-SHA-256-bound to capability/version,
operation, subject, normalized filters, snapshot revision and offset. The key
is injected from a later session authority and is never accepted from the
request. Any mutation of catalog/workspace/authority state makes the cursor
stale or invalid on the next snapshot reconstruction rather than silently
mixing pages. Within one reconstruction, workspace and catalog observations
are repeated and a granted project is re-authorized before it can be emitted.

`project-context.query` resolves `projectId → canonicalRoot` only after access
approval, transforms the rootless request to the accepted M2 query internally
and invokes the existing manifest/retrieval provider. It returns the accepted
snapshot unchanged and never serializes the root.

This block deliberately accepts the cost of rebuilding at most 200 active
projects per page request. It does not claim an atomic cross-resource snapshot:
SQLite, filesystem and the later session authority have no shared transaction.
Repeated observation and final authorization are the fail-closed boundary;
session-generation binding and revocation belong to the dedicated M7 session
block before activation.

## 4. Demonstration and stop conditions

Required before review:

- a real temporary project and SQLite catalog produce a valid project page and
  M2 context snapshot through the M7 provider;
- cursor tamper, cross-subject reuse, filter drift and project/workspace drift
  fail closed;
- a foreign project cannot trigger filesystem observation;
- all emitted values pass exact candidate/external validators and contain no
  host path;
- module imports cannot reach routes, server or network code;
- full offline+database gate remains green.

Stop before session-key generation, production composition, listener work or
any non-project capability.
