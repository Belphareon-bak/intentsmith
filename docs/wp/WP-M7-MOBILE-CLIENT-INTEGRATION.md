# WP-M7-MOBILE-CLIENT-INTEGRATION

**Type:** write-enabled M7 client and Android integration

**Base revision:** `99005858` (M7 contract candidate evidence HEAD)

**Source candidates:** client baseline
`7cf1c8b77e04697115a456adf356ee56db4ce9e7`; reviewed release-binding
remediation `aa8e8440` + `b46062f9` from evidence head `ab1940aa`

**Exact remediated product candidate:**
`d43e7ada01d6e5de38a06d79021bde8909d2eba3`

**Status:** `RELEASE_BINDING_REMEDIATION_IMPLEMENTED / FULL_GATE_GREEN /
REVIEW_PENDING / PRODUCTION_TRANSPORT_BLOCKED /
PRODUCTION_SIGNING_NOT_AUTHORIZED`

## 1. User outcome

Move the already prepared mobile client, secure Android shell and release
verification boundary onto the current IntentSmith lineage without merging the
source branch's obsolete backend, migrations, registry or release status.
After this block the application can be built and exercised against the
explicit legacy development gateway while the production `remote-core-v1`
transport remains fail-closed until its provider and session authority exist.

## 2. Owned and forbidden paths

Owned:

- `mobile-app/**`;
- `src/mobile/client/**`;
- Android/build `scripts/mobile-*` and offline mobile-focused tests;
- exact package scripts, registry entries, module baseline and documentation
  needed to make those paths reproducible in the current lineage.

Forbidden:

- `src/server.js`, `src/mobile-gateway.js`, server-side `src/mobile/**`, current
  core routes, DB schema/repositories and M1/M2 effect or approval authority;
- enabling `remote-core-v1`, a non-loopback/public listener or fallback from
  that mode to legacy `/m1`;
- generating or importing a production Android signing key;
- claiming device, TalkBack, remote transport or distribution evidence from a
  host-only build.

## 3. Connector and provenance

The source branch is intentionally not merged wholesale: its merge base and
backend are older than the current M6/M7 lineage. The reviewed client baseline
came from exact commit `7cf1c8b7`. A later audit proved that this commit was
an ancestor, not the final reviewed mobile head: the APK/AAB source-binding
guard in `aa8e8440` and signing-independent lint correction in `b46062f9`
were missing.

The central lineage therefore imports only the exact product/test files from
those two commits. Their resulting blobs are checked against the source
commits. It intentionally does not import the obsolete server prototype,
historical mobile migrations, source-branch release status or older contract
copies. Existing M7 contract files from candidate `54a10fd0` remain
authoritative.

The bounded remediation contract is
[`WP-M7-MOBILE-RELEASE-ARTIFACT-BINDING`](WP-M7-MOBILE-RELEASE-ARTIFACT-BINDING.md).

## 4. Demonstration and stop conditions

Required before review:

- every active mobile unit/contract test passes from the current lineage;
- the Android boundary passes unit, lint and unsigned/debug throwaway build
  checks without a production key;
- `remote-core-v1` remains blocked and cannot silently use the legacy gateway;
- registry, module ratchet, artifact validation and full offline/database gate
  are green on a clean exact candidate.

Stop and ask for an operator/security decision before production signing,
distribution, public exposure, a transport outside the accepted VPN pilot or
activation of the M7 remote session contract.
