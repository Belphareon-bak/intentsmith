# Exact IDE CODE probe source snapshot

This directory preserves all 12 original packet members, byte for byte, plus
its original `MANIFEST.json`. It is an archival source/config/CPU-evidence
snapshot for review of one packaged IDE Ledger qualification. It is not a
portable product runner, a new release, or a new acceptance run.

Original packet manifest SHA-256:
`49a8173cbcd3045a8bb70f4582b27210087abd8ee6d52817c58bf7de67bc4fab`.
Independent source/CPU review: `REVIEW_PASS`, 2026-10-01 12:00 UTC;
review SHA-256
`e839c54aad8c08979ba953cf7cc36193582bb3fadb95e2a1f865049df5577501`,
reviewer hash inventory SHA-256
`629e8e263cb2dd7779a0bcf4b302690ff92b8abed497c99417ca603cfaf12df7`.

The original HANDOFF and MANIFEST retain their historical `REVIEW_PENDING`
labels unchanged. The saved PREFLIGHT is historical `LIVE_NOT_RUN`; SELFTEST
and RELAY-CONTROLS are existing CPU results copied unchanged, not newly run.
Source/CPU review is distinct from a physical IDE/model journey. A later
physical run reported PASS and was awaiting its independent review when this
export was prepared; its raw runtime artifacts are not included here.

## Included material

- `host.mjs`, `probe.mjs`: the original explicitly pinned physical probe;
- `relay-owned.mjs`, `package-members.mjs`: original ownership/package checks;
- `selftest.mjs`, `relay-integration.mjs`: original CPU fixture sources;
- `inputs/project-app-acceptance.js`: exact frozen public input snapshot;
- CONFIG, HANDOFF, saved PREFLIGHT/SELFTEST/RELAY-CONTROLS, original MANIFEST.

Eleven of the original twelve member blobs were absent from the published
IntentSmith tree at export. The frozen input is already identical to public
`scripts/project-app-acceptance.js`; its duplicate is retained because the
unchanged source and CONFIG bind this exact local path/hash. This does not
create a new oracle, test root, registry suite or alternative implementation.
`EXPORT-MANIFEST.json` records all original member hashes and publication state.

## Machine-specific configuration and reproduction limits

CONFIG remains exact, including its nonsecret absolute locations:

- `/home/belphareon/Projects/intentsmith-ide2-staging-20261001`;
- `/home/belphareon/Projects/intentsmith-real-chat-journeys-20260930`;
- the stage's `.intentsmith-artifacts/ide2-build-45caf5b5/package`.

The packet pins stage `483fb2d957ed20d48dbf508c82837b7d1824176f`,
package source `45caf5b54b78def257221ac2ab33a64031800813`, and source-equivalent
GUI/backend revision `cf67e83f2e7cf654bc8900f7b4dde434411cc0b2`.
The saved preflight checks 1,178 source blobs per copy and 16,313 package
members, plus exact AppImage, packaged Node/native SQLite and frozen input.
The original package binaries, dependencies and private package directory are
not shipped in this source bundle. A fresh clone alone cannot reproduce those
machine-specific checks. Adapting CONFIG or locations creates a new source
candidate and requires fresh identity/preflight/review evidence.

The public location uses two path components below the repository root, so
unchanged `../../src` imports keep their original depth. This does not certify
execution from a relocated bundle against newer repository source. The
original HANDOFF documents commands for the preserved original stage layout;
they have not been executed from this snapshot.

The host reads X11 authority from the operator's environment only for an
explicit live run. No authority file, cookie value, environment credential,
private DB, request/response capture, runtime identifier, screenshot or live
model output is bundled. References to environment variable names and
synthetic CPU fixture identifiers are source, not captured secret/live values.
Live use remains an explicitly pinned, serialized physical qualification and
must freshly satisfy its own source/package/provider/GPU/X11 checks.

The historical failed predecessor packets remain outside this export and
unchanged. No test, application, browser, provider or model was executed for
this publication inspection. Product source, original packet and private
runtime evidence were not changed.
