# Archived C3 Studio v7 overwrite payload

This payload is historical and inert. Its former executable copied much older
JavaScript snapshots over the committed extension runtimes and then instructed
the operator to clean and rebuild. In particular, it could replace the current
chat-panel runtime with a much smaller v7 file.

The active `c3-ide/fixes/apply-fixes.sh` path is now a fail-fast tombstone. Do
not re-enable this payload. Any useful individual change must be recovered by
diff, applied to the authoritative source explicitly, and demonstrated through
the current Electron journey.

The archived stylesheet's executable remote-font import was sanitized on
2026-08-07 so that inspecting or opening the inert payload cannot initiate
network access. Its exact historical bytes remain recoverable from Git commit
`7cc0453a694bcd8f863f42740211a4ef839bd147`; the font-family declarations and
their local/system fallbacks remain in this archive.
