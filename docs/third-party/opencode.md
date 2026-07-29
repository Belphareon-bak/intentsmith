# OpenCode

Verified: 2026-07-28

## Upstream

- Documentation: https://opencode.ai/docs/
- ACP mode: https://opencode.ai/docs/acp/
- Provider config: https://opencode.ai/docs/providers/
- npm package: https://www.npmjs.com/package/opencode-ai

## Version

- npm `opencode-ai` latest observed: **1.18.8**
- Locally installed: **none**

`opencode` is **not** a valid npm package name (registry returns 404). The
package is `opencode-ai`, whose `bin.opencode` points at a compiled platform
binary (`bin/opencode.exe`), not a JavaScript entry point.

## License

MIT (`opencode-ai` package metadata).

## Distribution Channels

Documented: npm (`npm install -g opencode-ai`), an install script
(`curl -fsSL https://opencode.ai/install | bash`), Homebrew
(`anomalyco/tap/opencode`), Arch (pacman/AUR), and on Windows Chocolatey,
Scoop, Mise and Docker.

IntentSmith pins **npm `opencode-ai`** as the single reproducible channel: it
is versioned, checksummed by the registry, and installable without piping a
script to a shell.

**IntentSmith never installs or upgrades OpenCode.** A missing binary is a
reported state with installation guidance, never an automatic install.

## ACP Mode

- Command: `opencode acp`
- Transport: **JSON-RPC over stdio** (documented explicitly)
- Protocol version: **not stated in the documentation**, so it must be
  discovered by negotiation at `initialize` and never assumed.
- Documented limitation: some built-in slash commands such as `/undo` and
  `/redo` are unsupported in ACP mode.

## Provider Configuration

Config file: `opencode.json` in the project directory, or
`~/.config/opencode/opencode.json` globally. The global path is under
`XDG_CONFIG_HOME`, which is what lets IntentSmith isolate the runtime.

For an OpenAI-compatible endpoint:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "<id>": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "<display name>",
      "options": {
        "baseURL": "http://127.0.0.1:<port>/v1",
        "apiKey": "{env:SOME_VAR}"
      },
      "models": { "<model-id>": { "name": "<display>" } }
    }
  }
}
```

`{env:VAR}` indirection is the documented way to supply a secret. IntentSmith
uses it so the per-run gateway token travels in the isolated child environment
and never appears in a command line, in persistence, in audit, or in a log.

## Probe Status

**Not probed.** OpenCode is not installed on this machine, and Phase 3 does not
install it.

Everything above is derived from official documentation and the npm registry,
not from running the binary. The following therefore remain **unverified
against a pinned build** and must be confirmed by the opt-in real-OpenCode
suite before any claim is made about them:

- the ACP protocol version OpenCode advertises at `initialize`;
- the session methods and capabilities it actually implements;
- whether permissions, cancellation and session updates behave as documented;
- the exact config keys accepted by version 1.18.8;
- process shutdown behaviour on SIGTERM.

Deterministic tests run against a fake ACP process. The real suite reports
**BLOCKED**, never PASS, when OpenCode is absent.
