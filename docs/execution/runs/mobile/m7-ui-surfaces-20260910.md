# M7 mobile UI surfaces — 2026-09-10

Status: `REMEDIATION_IMPLEMENTED / HOST_GATE_GREEN / RE_REVIEW_REQUIRED /
DEVICE_NOT_RUN / NOT_ACCEPTED`.

Authority and exact scope:
[`WP-M7-MOBILE-UI-SURFACES-20260910`](../../../wp/WP-M7-MOBILE-UI-SURFACES-20260910.md).
Independent review:
[`original packet`](../../../review/2026-09-10-M7-MOBILE-UI-SURFACES-REVIEW-PACKET.md),
[`CHANGES_REQUIRED` result](../../../review/2026-09-10-M7-MOBILE-UI-SURFACES-REVIEW-RESULT.md)
and [`narrow re-review packet`](../../../review/2026-09-10-M7-MOBILE-UI-SURFACES-REREVIEW-PACKET.md).
Working branch: `work/mobile-completion-20260908`; no push, tag, merge, signing,
device install or production activation was performed.

## Immutable product candidate

- base: `8a811381519eb1e409b8953eb61ee1cc57c7858f`;
- adapter commit: `9d12cef04c3400699901eba3c3e62861ea324bf2`;
- screen/runtime commit and product candidate:
  `427cc13e58df4d4394700aaec85132fa2eb9354c`;
- remediation commit and current product candidate:
  `429b779f26b2f66a1c378e529c082d6b436609ca`;
- full candidate range: `8a811381519eb1e409b8953eb61ee1cc57c7858f..429b779f26b2f66a1c378e529c082d6b436609ca`;
- narrow re-review range: `427cc13e58df4d4394700aaec85132fa2eb9354c..429b779f26b2f66a1c378e529c082d6b436609ca`;
- changed paths: `src/mobile/client/app.js`, `app.css`,
  `m7-ui-api-adapter.js` and their two existing M7 tests.

The adapter now terminates `project.list`, `settings.read`, `settings.update`,
`stored-information.list` and `stored-information.append` in native-client UI
responses. The screens preserve the core restrictions: project roots are absent,
settings use the five-key allowlist and exact snapshot revision, and stored data
is limited to append-only manual notes.

Both mutation surfaces write their recovery journal before dispatch. Settings
remain server-valued until confirmation. An ambiguous note append becomes
`UNKNOWN`, retains its encrypted operation draft and blocks a second blind
submission. The review-found settings race is closed by treating the durable
open journal entry as the write lock even before `settingsSaving` is set.
Offline and stale-setting attempts dispatch nothing; loss of scope purges the
protected dataset and rejects an in-flight late response.

## Measured verification

All checks below ran after the product commit with Android assets resynchronized
from `src/mobile/client`.

| Check | Result |
|---|---|
| `npm run test:mobile` | 47/47 PASS; includes browser accessibility and M7 runtime |
| `tests/m7-mobile-app-runtime.test.js` | 7/7 PASS through native `/remote/v1/invoke`; includes held-flush race; browser fetch count 0 |
| `tests/m7-mobile-ui-api-adapter.test.js` | 8/8 PASS |
| Android source/package comparison | `app.js`, `app.css` and M7 adapter byte-identical |
| Gradle `test lint`, JDK 21 / Android SDK | `BUILD SUCCESSFUL`; 172 tasks, 0 command failure |
| Specialist boundary ratchet | PASS; 5 packages / 33 files / 0 violations |
| Artifact/documentation validation | 158/158 PASS |
| Physical device, VPN, TalkBack | NOT RUN |
| Production signing/build/distribution | NOT DONE |
| Independent review / M7 acceptance | original `CHANGES_REQUIRED`; remediation `RE_REVIEW_REQUIRED` / NOT ACCEPTED |

Retained local logs are under
`.intentsmith-artifacts/m7-ui-surfaces-20260910/`:

| File | SHA-256 |
|---|---|
| `mobile-gate.log` | `915efd2e26e8a7401c8f3fdcd881a89b141c66f6d9a1f614154f40e5e78eff37` |
| `android-test-lint.log` | `6e3a674576bd26965fdc3427800846504edb33c91420f0b11505bfb937d238e6` |
| `boundary-ratchet.log` | `71f92e6bd232e0be09e73dbc23da68bd4b89742982eaf4d907cd000da2937e8a` |
| `artifact-validation.log` | `c0a807e407aa0d3a378c7083f25a8877ebfaf34eb5023edb118853dc46744669` |

The initial root-level `npx cap sync android` attempt failed before mutation
because the root package has no Capacitor binary. The correct package-owned
`mobile-app/npm run sync` then passed. The earlier system-Java-8 Gradle failure
is likewise retained as an environment invocation error; the prescribed JDK 21
run above passed. Neither failed invocation is counted as a product PASS.

## Review focus

Review the exact range above, especially:

1. response mapping and pagination in `m7-ui-api-adapter.js`;
2. fresh-revision and pre-dispatch guards in `updateSetting`;
3. encrypted draft, journal ordering and no-resubmit behavior in `addMemory`;
4. scope-loss cleanup and post-response scope checks;
5. the boundary between host evidence and the still-missing physical release
   matrix.

Older mobile design and convergence documents remain historical records of the
then-missing mappings. This handoff and the current ROADMAP/SYSTEM-MAP describe
the new candidate; they do not rewrite older review evidence retroactively.
