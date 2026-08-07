# Test toolchain boundary

Registry `requirements.toolchain` names a prerequisite that is not supplied by
`npm ci`. Names are canonical lower-case tokens and duplicates are invalid.
Both the audit runner and the release orchestrator derive the same exact
blocker form `toolchain:<name>`.

Toolchain blockers differ from ordinary soft local prerequisites:

- `--no-block` never bypasses them;
- only an exact `--allow-blocker=toolchain:<name>` permits execution;
- a partial allow leaves every other named prerequisite blocked;
- the release orchestrator supplies no blocker override automatically.

For `x11-display`, the audit runner performs an additional pre-spawn check. It
accepts only a local display identifier and an absolute, current-user-owned,
non-symlinked Xauthority regular file without group/other permissions. Missing
or invalid values produce `BLOCKED`, never a product `FAIL`.

The suite child receives only scoped names
`INTENTSMITH_STUDIO_DISPLAY` and `INTENTSMITH_STUDIO_XAUTHORITY`. Ambient
`DISPLAY`, `XAUTHORITY` and `XDG_RUNTIME_DIR` are not inherited. Evidence records
only which scoped keys were forwarded, not their values or the Xauthority path.

The Studio runner remains responsible for mapping those scoped values into its
owned Electron child and for checking the other explicitly allowed tools. This
boundary does not by itself mark the Studio journey `ACTIVE` or prove C3 Studio
runtime acceptance.
