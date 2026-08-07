# Archived C3 Studio v7 overwrite payload

This payload is historical and inert. Its former executable copied much older
JavaScript snapshots over the committed extension runtimes and then instructed
the operator to clean and rebuild. In particular, it could replace the current
chat-panel runtime with a much smaller v7 file.

The active `c3-ide/fixes/apply-fixes.sh` path is now a fail-fast tombstone. Do
not re-enable this payload. Any useful individual change must be recovered by
diff, applied to the authoritative source explicitly, and demonstrated through
the current Electron journey.
