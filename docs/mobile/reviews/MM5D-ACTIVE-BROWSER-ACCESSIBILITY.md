# MM5-D Active Browser Accessibility Gate Review

Status: `IMPLEMENTED AND SOURCE TESTED; PHYSICAL AT/DEVICE NOT RUN`

Implementation checkpoint: `4dd33b49`

Branch: `mobile/master-prod-ready`

## Scope

MM5-D turns the existing headless-Chrome accessibility program from optional
evidence into a required mobile-gate participant. The checkpoint:

- adds `npm run mobile:a11y:setup` as the explicit Chromium provisioning path;
- changes `tests/mobile-browser-a11y.test.js` from `BLOCKED` to `ACTIVE` in the
  canonical test registry and regenerates its rendered ledger;
- keeps missing Puppeteer, a missing executable and browser launch failure
  fail-closed;
- aligns the scroll-paging browser fixture with the exact MM3-I public
  conversation and message DTOs;
- measures contrast only after the 120 ms foreground transition has settled;
- removes the navbar-label exclusion from the complete contrast sweep; and
- replaces the old passing "open contrast defect" characterisation with a
  positive 4.5:1 regression assertion.

No production route, capability, scope, persistence owner or mobile mutation
authority changes in this checkpoint.

## First browser run and diagnosis

Provisioning Chrome exposed a real test failure: the automatic older-message
scroll scenario made one request but retained 50 messages instead of prepending
the returned 50. The production client was behaving as designed. MM3-I had
subsequently made `validThreadResponse` reject shorthand records, while this
older browser fixture still returned incomplete conversation and message
objects. The response therefore failed closed before publication.

The fixture now provides the exact public record fields and continues to assert
the user-visible contract: a real capture-phase scroll event at the older edge
follows the server-issued cursor, makes one request and prepends the page.

The same run also revisited an older test explicitly named `OPEN`. It sampled
navbar foreground colour immediately after changing the background to dark
mode. Because the foreground has a 120 ms CSS transition, the measurement
combined the previous light-theme foreground with the new dark background and
reported a synthetic 2.2:1 result. The main sweep then excluded navbar labels,
and a separate test passed only while at least one result remained below 4.5:1.

MM5-D waits 160 ms after each surface/theme transition, includes navbar labels
in the main sweep and requires every visible label to meet 4.5:1. This changes
the test oracle, not the product palette: the settled frames were already
compliant.

## Registry and gate contract

The browser row remains required and continues to declare:

- profile `offline` with a self-owned loopback fixture;
- toolchain requirement `chromium-runtime`;
- a five-minute timeout; and
- fail-closed process exit semantics.

Its state is now `ACTIVE`. Consequently `npm run test:mobile` executes the
browser program and fails on a fresh host until the runtime is provisioned. The
setup step downloads the browser resolved by the installed Puppeteer package;
it does not add an executable to the repository or alter global browser policy.

## Observed evidence

All observations were made on Windows with Node 22.16.0 at implementation
checkpoint `4dd33b49` or its immediately preceding clean diff:

| Command | Observed result |
|---|---|
| `npm run mobile:a11y:setup` | PASS — Chrome 145.0.7632.67 resolved in the Puppeteer cache |
| `npm run test:mobile:browser` | PASS — 22/22 browser scenarios |
| `node tests/mobile-ms07-history.test.js` | PASS — 22/22 history scenarios |
| `node tests/mobile-gate-self-test.js` | PASS — 5/5 gate-selection scenarios |
| `npm run test:registry` | PASS — 437 programs, digest `bc0f50334497555c729a1bc0cd304337d1df08476d0546aaad9b1f0ceb42dd74` |
| `npm run test:mobile` | PASS — 55/55 active, zero withheld |
| `git diff --check` | PASS before the implementation commit |

The browser program covers resolved light/dark contrast, active touch-target
geometry, approval-action spacing, trust-bar geometry and accessible name,
thread scroll anchoring and automatic paging, navbar focus/order/ring
behaviour, selection without colour alone, and 200% browser font scaling.

## Explicit non-claims

This checkpoint does not prove:

- TalkBack, VoiceOver or switch-control output on physical hardware;
- Android WebView behaviour under a real OS font-size setting;
- rotation, soft-keyboard, small-device or supported-OS matrix acceptance;
- iOS Safari parity;
- an APK/AAB build, signing ceremony or distribution path; or
- remote TLS identity, production push/offline policy, external security review
  or the still-provisional backend wire contract.

The mobile release verdict therefore remains `NOT READY`. MM5-D closes the
source-level browser-gate gap only; physical accessibility and device evidence
remain MM5/MM6 release blockers.

## Review focus

Reviewers should verify that:

1. the registry projection contains the browser row exactly once as `ACTIVE`;
2. missing Chromium still produces a non-zero exit rather than a skip;
3. the complete mobile gate actually invokes the browser program;
4. the MM3-I fixture change cannot relax production response validation;
5. contrast is measured after transitions and navbar labels are no longer
   excluded; and
6. no browser result is represented as physical-device or release evidence.
