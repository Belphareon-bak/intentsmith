# OpenCode Configuration as a Security Boundary

Date: 2026-07-28

## Why this file matters more than it looks

The Phase 3B contract spike ran the pinned real `opencode-ai@1.18.8` binary
under its own defaults and recorded:

```
permission requests : 0
side effect         : file written
bash                : executed `echo hello > /tmp/...` OUTSIDE the workspace
```

OpenCode is not intrinsically mediated. Every guarantee IntentSmith makes about
permission-before-side-effect exists because IntentSmith generates a
configuration that makes OpenCode ask. If that configuration is absent,
weakened, or not the file the process actually reads, the worker runs
unmediated — and nothing else in the system would notice.

## The required policy

```json
{ "permission": { "edit": "ask", "write": "ask", "bash": "ask", "webfetch": "ask" } }
```

It has exactly one source: `REQUIRED_PERMISSION_POLICY` in
`packages/adapter-opencode/src/runtime-config.ts`. The config is generated from
that constant, so the policy cannot drift between what is documented and what is
written.

## Fail-closed checks

| When | Check |
|---|---|
| At generation | The written file is read back and validated before the runtime is returned. |
| Immediately before spawn | The file is re-read, re-validated, and hashed. |
| Immediately before spawn | `XDG_CONFIG_HOME` is proven to resolve to the validated file. |

A failure at any of these refuses the run. Nothing is repaired, defaulted or
merged.

Rejected specifically:

- a missing configuration file;
- a missing `permission` block — the exact shape that ran unmediated;
- any required key missing;
- any value other than `ask`, including `allow`, `deny` and an empty string;
- a value that is not a string;
- an unrecognized permission key, because an unclassified capability is not
  something to leave enabled just because this code does not recognize its name;
- a configuration that reaches Ollama or a cloud host directly;
- an environment whose `XDG_CONFIG_HOME` points anywhere other than the file
  that was validated.

The SHA-256 of the exact bytes is emitted as a run artifact
(`intentsmith://opencode-config/<sha256>`), so a run's evidence records which
configuration it was actually started against.

## What this does not protect against

**A same-user process can rewrite the file after validation.** The config is
written `0600`, which stops *another* user reading it. It does not stop this
user's own processes — including the agent itself — from modifying it, and the
window between the pre-spawn check and OpenCode reading the file is real.

No claim is made that `chmod` closes this. A post-run hash comparison would
detect *some* tampering after the fact, which is not the same as preventing it,
and is not treated here as a control.

Under a strong sandbox the configuration should be exposed read-only to the
child, which does close the window. Where the sandbox is degraded, this remains
**residual risk**, and it is one of the reasons degraded-sandbox execution stays
disposable-fixture-only. A disposable fixture that tampers with its own config
can reach outside a workspace nobody cares about; a real project is a different
proposition entirely.

## Residual risk summary

| Risk | Status |
|---|---|
| Config tampering by a same-user process under a degraded sandbox | Accepted, disposable-fixture-only |
| Config tampering under a strong sandbox | Mitigated where read-only exposure is available |
| Config drift between documentation and code | Prevented; one typed source |
| Wrong config file being read | Prevented; `XDG_CONFIG_HOME` verified against the validated path |
