# M7 mobile UI surfaces — narrow independent re-review result

Review result: `REVIEW_PASSED`.

Accepted candidate:
`429b779f26b2f66a1c378e529c082d6b436609ca`.

Reviewed range:

```text
427cc13e58df4d4394700aaec85132fa2eb9354c..429b779f26b2f66a1c378e529c082d6b436609ca
```

The reviewer accepted the remediation as exactly symmetric with the durable
stored-information guard. `journal.add()` records the settings operation
synchronously before the first awaited encrypted flush, and
`openSettingAttempt()` treats `PENDING` and `UNKNOWN` as a lock. A second UI or
programmatic activation therefore cannot dispatch while the first operation is
open. The rendered controls use the same journal state and explain the lock.

The held-flush regression proves the durability boundary: while the first
encrypted domain write is held, a second activation observes one open journal
entry and zero dispatched requests; after release, exactly one request leaves.
The reviewer also ran this new test against an isolated copy of the old
`427cc13e` product bytes. It failed there as a hang with exit 13 because the
second flush queued behind the held write. That diagnostic is less direct than
an assertion message, but it independently proves that the regression
distinguishes the remediated behavior.

Independent verification on documentation HEAD
`3bda6ddb259a7f2096cf96a5da98e73899b263cd` reported:

| Check | Result |
|---|---|
| `tests/m7-mobile-app-runtime.test.js` | 7/7 PASS |
| `tests/m7-mobile-ui-api-adapter.test.js` | 8/8 PASS |
| `npm run test:mobile` | 47/47 PASS |
| `tests/artifact-validation.test.js` | 158/158 PASS |
| Specialist boundary ratchet | 5 packages / 33 files / 0 violations |
| Gradle `test lint` with pinned JDK 21/SDK | `BUILD SUCCESSFUL`; 172 tasks |
| M5 restore compatibility | 20/20 PASS |

This result accepts the exact host-side product candidate and closes the only
finding from the original UI-surface review. It does not establish M7 release
acceptance. Physical Android/VPN/pairing/revocation/TalkBack journeys,
production configuration and credentials, release signing/build and
distribution remain `NOT RUN / NOT DONE`; M7 remains `NOT_ACCEPTED`.
