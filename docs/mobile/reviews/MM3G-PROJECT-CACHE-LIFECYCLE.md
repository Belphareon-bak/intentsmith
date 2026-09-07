# MM3-G review — project cache lifecycle alignment

Status: `IMPLEMENTED AND SOURCE TESTED; DEVICE EXECUTION NOT RUN`
Checkpoint commit: `1d449b78`

This checkpoint aligns the implemented project-list and project-detail caches
with the lifecycle already specified by `DATA-MODEL.md` `MD-02`: 15 minutes
fresh, readable as stale until seven days, expired at seven days. Before this
change both domains silently inherited the generic one-minute/fifteen-minute
window.

## Delivered surface

- one explicit project cache policy shared by `projects.active`,
  `projects.archived` and every `project.<id>` key;
- `FRESH` for entries younger than 15 minutes;
- `STALE` from 15 minutes until seven days, preserving the existing read-only,
  age-labelled offline behavior;
- `EXPIRED` at seven days, preserving the existing delete-before-publication
  behavior;
- focused boundary evidence for active list, archived list and detail keys;
- regression evidence that an unrelated cache domain does not inherit the
  project policy;
- updated stale and expiry integration scenarios using the documented window.

No server route, DTO, cursor, scope, provider, mutation, storage shape or cache
content changed. Project-conversation membership remains a separate live-only,
memory-only surface with `no-store` and receives no durable cache.

## Lifecycle

```text
successful exact project list/detail read
  -> existing validated cache payload
  -> age < 15 minutes: FRESH
  -> 15 minutes <= age < 7 days: STALE, labelled and read-only
  -> age >= 7 days: EXPIRED, deleted before publication

project conversation membership
  -> live-only ST-MEM
  -> never enters this lifecycle
```

The lifecycle changes only how long an already validated project snapshot may
remain visible. It does not make a cached row server truth, grant a mutation or
extend any live authority. Scope withdrawal, logout and authenticated
revocation continue to remove the caches independently of age.

## Verification

Observed on 2026-09-07 from checkpoint `1d449b78` under repository-required
Node `v22.16.0`:

| Command | Result |
|---|---|
| `node tests/mobile-projects-ui.test.js` | PASS — 31/31 |
| `node tests/mobile-projects.test.js` | PASS — 11/11 |
| `npm run test:mobile` | PASS — 54/54 active; 1 Chromium prerequisite withheld |
| `npm run test:registry` | PASS — 437 registered programs |
| `node tests/module-boundary-ratchet.test.js` | PASS — 13/13 |
| `node scripts/module-boundary-ratchet.mjs` | PASS — 1,106 edges; 3 pre-existing cycles; no delta |
| `npm run mobile:inventory` | PASS — 250 routes |

The generated backend inventory remains 250 static routes, 26 exact mobile-v1
routes, 224 broader desktop/core routes and 86 candidate-port mappings. Its
digest remains
`c47a580b144d78619ca71b60c6862bf353ffa1868bf120a807c09fcb17093277`.
The registry remains 437 runnable programs with digest
`ba13e78b08c7b8e4e505668a1fe867ca5a526dc36317734c308d212d237df031`.

No new test program was created. The existing registered project UI suite was
extended from 30 to 31 scenarios.

## Explicit non-claims

- MM3-G does not change project data validation; MM3-E/MM3-F remain the
  authorities for exact list/page/detail integrity.
- It does not claim that a stale cached project still exists or has the same
  lifecycle state on the server. UI must continue to label age and failure.
- It does not add offline project mutations or allow cached data to authorize
  create, assign, edit, archive or delete actions.
- It does not persist project-conversation membership.
- Extending retention to the documented seven-day limit increases the period
  for which S1 project names/statuses may remain readable on a lost unlocked
  phone; logout/revocation handling and native device protection remain
  independent controls.
- It does not align the separate conversation-list or thread cache policies;
  those are different datasets with different sensitivity and require their
  own review checkpoint.
- Source tests are not Android device evidence.
- Chromium, JDK 21, Android SDK 36 and a physical Android target are absent on
  this host; no current APK/AAB build, WebView journey or device result is
  claimed.
- Remote TLS/peer identity, production signing/distribution and independent
  release/security acceptance remain open.
- The unavailable local security implementation has not been compared; no
  equivalence or superiority claim is made.

## Review focus

Review the cache-key matcher, the exact 15-minute/seven-day boundaries, the
existing stale labelling and expiry deletion paths, and the explicit privacy
tradeoff of retaining validated S1 project metadata longer. Confirm that
project-conversation membership and unrelated cache domains remain outside the
new policy.
