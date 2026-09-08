# MM5-E Backend Mirror Browser Usability

Status: `IMPLEMENTED AND BROWSER TESTED; NOT INDEPENDENTLY REVIEWED`

Branch: `mobile/master-prod-ready`
Base: `024f0e45496b559d88b416ba1ee7bd07a904b489`
Implementation checkpoint: `da6abe27`

## Work package

Extend the required browser accessibility suite to the implemented project,
worker/history, specialist/expertise, device/revocation, settings and memory
surfaces. Exercise populated screens with the appropriate live write grants,
not permission-denied placeholders. Fix measured UI defects without changing
backend contracts, scopes, credentials or mutation authority.

Owned implementation paths: `src/mobile/client/app.css`,
`tests/mobile-browser-a11y.test.js`, and mobile status/review documentation.
Verification: focused browser suite, affected mobile source suites, full mobile
gate and `git diff --check`. Stop short of claiming physical-device, native
WebView or independent accessibility acceptance.

## Initial findings

- Light-mode primary action labels measured 3.90:1 against their fill.
- Dark-mode danger action labels measured 2.80:1.
- The old RGB-only contrast parser ignored Chromium's `color(srgb ...)`
  serialization of `color-mix()` backgrounds. With those layers measured,
  selected dark navbar labels measured 4.28:1, not a passing result.
- Several pagination buttons were only 45 CSS pixels high.

The previous MM5-D result describes its then-current eight-surface measurement,
not complete product accessibility. This checkpoint corrects its colour oracle
and adds a compositing regression test. The full-device release verdict remains
`NOT READY`.

## Delivered changes

- Extend the contrast/touch sweep from eight to eighteen populated surfaces
  and states, including enabled worker/device actions and their confirmation
  states. Assert the expected populated surface exists before measuring it.
- Parse both RGB/RGBA and Chromium's sRGB colour serialization; reject an
  unmeasured format instead of silently skipping it. A separate test verifies
  translucent sRGB-over-opaque compositing with known channel values.
- Use the text-safe primary fill, a brighter dark navbar accent, and a
  theme-specific foreground on danger buttons.
- Give all normal buttons the same 48 CSS-pixel minimum as small buttons at
  the default font size. Checkbox hit areas include their wrapping label;
  ordinary inputs and buttons must still meet the floor themselves.
- Reflow key/value rows, resource headings, status badges, setting editors,
  memory headings and device action groups. Previously, 200% text clipped
  project details, specialist metadata, setting paths and recovery actions.
- Check all ten added mirror states at 320 and 390 CSS pixels with both
  100% and 200% browser font preferences. No measured descendant may extend
  horizontally beyond the scrolling viewport.
- Measure navbar height before resetting the enlarged font, so the existing
  dynamic-type test now proves actual growth rather than a default-size box.

## Observed verification — 2026-09-08

Environment: Windows, Node 22.16.0, Puppeteer 24.37.3, Chrome 145.0.7632.67.

| Check | Result |
|---|---|
| Initial expanded browser run, before CSS repair | 18 passed / 4 failed: light contrast, dark contrast, touch targets, navbar labels |
| Added small-viewport / large-text check before reflow repair | FAIL: clipped details, badges and settings controls |
| Final `npm run test:mobile` | PASS — 55/55 active, zero withheld; includes the expanded 24-scenario browser program |
| `git diff --check` | PASS before implementation commit |
| Additional visual inspection of fixture screenshots | Agents at 390/100%; project and settings at 320/200% |

All gate participants, including settings, projects, workers/specialists,
devices, approvals, thread history, navbar, credential storage and Android
source-invariant suites passed. Screenshot fixtures used no real backend,
account, credential or private project data; they are local temporary evidence,
not a production-device acceptance record.

## Remaining limits

This is usability hardening of implemented surfaces, not new backend feature
authority. Server-backed global search, authoritative run progress/cancel,
specialist mutations and production notification delivery remain open as listed
in the master roadmap. PIN setup/removal, pairing and all native-only states
are not added to the eighteen-surface sweep by this checkpoint.

The browser colour calculation still approximates backdrop-filter rendering;
it is not pixel-level contrast sampling. Headless browser font preferences are
not Android OS dynamic-type acceptance. APK/AAB compilation, production
signing, physical-device accessibility/security evidence and the unavailable
local implementation comparison remain separate requirements. No Android SDK
licence was accepted and no signing keys were created by this checkpoint.
