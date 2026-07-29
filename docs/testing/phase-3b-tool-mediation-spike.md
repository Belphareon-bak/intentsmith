# Phase 3B Contract Spike: Tool Capability Mediation

Date: 2026-07-28

Decision gate run before implementing any tool mediation. Executed against the
pinned real `opencode-ai@1.18.8` binary, a local Ollama `0.17.7` serving
`qwen3:14b`, and a disposable Git fixture. The spike gateway executes nothing:
it only translates the model protocol.

## Verdict: **PASS**, conditional on an IntentSmith-generated permission config

Every decisive criterion was met, but only because IntentSmith writes the
permission policy itself. Under OpenCode's own defaults the same run is unsafe.

## Protocol translation

| Question | Result |
|---|---|
| Does OpenCode send `tools`/`tool_choice`? | Yes: 10 tools, `tool_choice: auto` |
| Can the gateway translate to Ollama `/api/chat`? | Yes |
| Does Ollama return a tool call? | Yes |
| Can the gateway return the OpenAI shape? | Yes |
| Does OpenCode return the tool result for the next turn? | Yes (`roles: system, user, assistant, tool`) |

Two shape differences matter and are handled explicitly:

- Ollama returns `arguments` as an **object**; OpenAI requires a **JSON
  string**. Translated in both directions.
- OpenCode requests `stream: true`. A non-streamed body is *silently unusable*
  to the AI SDK client: the first spike attempt returned valid JSON, and
  OpenCode simply ended the turn with no tool execution and no error. Tool-call
  deltas must be streamed as SSE.

## Permission mediation

### With OpenCode's defaults — unsafe

```
permission requests : 0
side effect         : file written
bash                : executed `echo hello > /tmp/...` OUTSIDE the workspace
```

No `session/request_permission` was emitted at all, and a shell command wrote
outside the disposable workspace. **Mediation does not exist by default.**

### With `permission: { edit, write, bash, webfetch: "ask" }` — safe

Ordering, measured on a clean fixture by sampling the filesystem at each event:

```
prompt_start             file exists: false
update:tool_call         file exists: false
update:tool_call_update  file exists: false
permission_request       file exists: false   <- asked before any effect
permission_answer        file exists: false   <- still nothing written
update:tool_call_update  file exists: true    <- effect only after approval
prompt_end               file exists: true
```

Denial was tested separately on a clean fixture:

- `edit`/`write` denied -> file never created;
- `bash` denied -> no file outside the workspace.

An earlier measurement of this ordering was discarded: the fixture had not been
reset between runs, so the target file already existed at `prompt_start` and the
evidence proved nothing.

## Permission payload structure

`edit` / `write`:

```json
{ "toolCall": { "toolCallId": "...", "kind": "edit", "status": "pending",
  "locations": [{ "path": "<absolute path>" }],
  "rawInput": { "filepath": "<absolute path>", "diff": "<unified diff>" } } }
```

`bash`:

```json
{ "toolCall": { "kind": "execute",
  "title": "echo hello > /tmp/...",
  "rawInput": { "command": "echo hello > /tmp/..." },
  "locations": [] } }
```

Offered options: `allow_once`, `allow_always`, `reject_once`.

Sufficient for policy: yes for filesystem actions, which carry an absolute path
and a diff. For `bash` the structured `rawInput.command` is present, but
`locations` is empty, so any path policy for a shell command must be derived
from the command string itself. That is precisely why the approved plan denies
`bash` in the first vertical slice: a command string is not a resource
identifier, and approving from a title would be approving from prose.

## Hard invariant this establishes

**IntentSmith must always generate `permission: { edit, write, bash, webfetch:
"ask" }` and must never select the `allow_always` option.** Mediation is a
property of the configuration IntentSmith writes, not of OpenCode. If that
config is ever absent, incorrect, or overridden, the worker acts unmediated and
can reach outside the workspace.

## Not yet proven

- cancel / timeout / process failure while a permission is outstanding;
- parallel tool calls;
- `skill`, `task`, `todowrite`, `webfetch` payload shapes and side effects;
- behaviour when the model emits a tool the policy denies mid-turn.
