# M7 mobile UI surfaces — independent review result

Review result: `CHANGES_REQUIRED`.

Reviewed candidate:
`427cc13e58df4d4394700aaec85132fa2eb9354c`.

Reviewed range:

```text
8a811381519eb1e409b8953eb61ee1cc57c7858f..427cc13e58df4d4394700aaec85132fa2eb9354c
```

The review accepted the adapter DTO fidelity, settings scope/connection/fresh
revision gates, durable stored-information recovery, post-await scope checks
and the separation between host evidence and device/release acceptance.

One low-severity finding prevented acceptance. `updateSetting` used only
`state.settingsSaving`, which is set after the encrypted journal flush. Two UI
activations while that flush was pending could therefore create and dispatch
two operations with the same `expectedRevision`. The server protected data
integrity by rejecting the second operation, but the client could show a false
concurrency warning and retain a rejected operation for one user action.

Independent reproduction on the reviewed candidate passed mobile 47/47,
artifact validation 158/158, the specialist boundary ratchet with zero
violations and Gradle `test lint`. Those results did not cover the reported
double-activation window.

Remediation commit `429b779f26b2f66a1c378e529c082d6b436609ca` adds the
durable journal guard and a deterministic held-flush regression. It requires a
new review; this result does not accept it implicitly.
