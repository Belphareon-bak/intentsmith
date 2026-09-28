# Gate 0 independent-review findings follow-up

## Reviewed lineage

The independent read-only review completed at
`2026-07-31T14:05:10.808Z` approved candidate
`2f11e801707a93a547795b5e96ff30c7f620ba5b` and pending attestation
`01e3829545895c96720dde2bb1077ba5d01738c1`. Its packet digest was
`a89499ea947b4c599f15ddc30e7f5179d52e1d2f9ed7ce83a09643f15a70a311`.
The review result validated against the schema before it was committed as
`ca46340c63bec9c96df1bf3eaa4f29b3822dac7d`.

The promotion attempt then exposed `G0-R031`. Repairing that blocker changed
the candidate, so D-026 does not allow the earlier approval to promote a newer
descendant. The findings below remain accepted engineering input, but a new
candidate must produce its own `C → E → R → A` chain.

## Disposition

| Finding | Disposition | Follow-up |
|---|---|---|
| G0-REV-001 | ACCEPTED | The reviewer explicitly accepted the `LATER_GATE` classification of `G0-R030`. That acceptance was human review, not a validator claim. The risk remains open and must be reviewed again for the new candidate. |
| G0-REV-002 | ACCEPTED | The narrower production-entrypoint statement in `LEGACY-LISTENER-BOUNDARY.md` is the truthful contract. It should have been separated from the media-fix commit, but history is not rewritten; this record makes the mixed commit scope explicit. |
| G0-REV-003 | ACCEPTED_KNOWN | Negative-cache recovery is event-driven. TTL expiry permits the next `load()` call; it does not schedule a retry or a render. The boundary document now says this explicitly. |
| G0-REV-004 | ACCEPTED_KNOWN | An eviction exception can make the initiating `load()` return `null` after the new URL is stored. The cache still owns and later returns that URL; the focused test pins the behavior and the boundary document records it. |
| G0-REV-005 | DEFERRED(Gate-2-built-IDE-artifact) | Source regexes prove repository wiring, not the assembled Theia/Electron runtime. `C3-001` requires a built-artifact digest and runtime evidence before acceptance. |

The earlier media-cache mutation report is corrected to the reproducible
result: replacing only `recordFailure(key)` with `void key` in
`legacy-local-object-url-cache.js` yields `68 passed, 5 failed, 0 skipped`,
exit `1`. No incorrect `67/4` count was committed.

Two previously reported low-impact listener residuals are also acknowledged:
the allowed CORS origin is echoed from the validated raw header rather than a
canonical parsed serialization, and pre-routing 403 rejections are outside the
application rate limiter. Both remain fail-closed and loopback-bounded; neither
is claimed as remote-boundary hardening.
