# Phase 2 Threat Model: Local Inference

Date: 2026-07-28

Scope: the Ollama provider, the Hardware Director, the inference scheduler and
the worker gateway. The trust boundary is the local Ollama daemon, which is
treated as **untrusted input** even though it runs on this machine.

| # | Threat | Control | Tested |
|---|---|---|---|
| 1 | Malicious or malformed local Ollama response | Every DTO validated at runtime; only fields IntentSmith relies on are required, unknown ones tolerated but never re-exported | adapter suite: malformed tags/version/records |
| 2 | Local daemon redirects the request elsewhere | Redirects disabled (`redirect: 'error'`); a 3xx status and a final URL outside the configured origin are both protocol errors | `rejects an unexpected redirect`, `rejects a response that came from another origin` |
| 3 | Cloud-backed model served through the local daemon | Metadata-driven `remote_model`/`remote_host` detection at discovery, preflight and every stream record; name suffix advisory only | `remote inference rejection` block, gateway tests |
| 4 | Prompt leakage into logs, audit or evidence | No prompt is logged, audited or written to any artifact; the real-Ollama suite records `promptRecorded: false` and `responseRecorded: false` | gateway `does not leak the prompt`, artifact inspection |
| 5 | Unbounded NDJSON exhausting memory | Per-record, total-stream and record-count caps; an unterminated record cannot grow past the record cap | `rejects an oversized record` |
| 6 | Stalled stream holding resources forever | Explicit connect, first-byte, idle and overall timeouts on an injected timer | `times out an idle stream`, `times out a stalled connection` |
| 7 | Client disconnect leaving the daemon generating | `request.raw.on('close')` aborts the upstream controller | route and gateway generation paths |
| 8 | Transport that ignores `AbortSignal` hanging the process | Requests raced against the signal; the NDJSON loop re-checks it between records, so cancellation does not depend on transport cooperation | `cancels mid-stream`, `cancels before the first token` |
| 9 | Command injection through the hardware probe | `execFile` with no shell, fixed executable name, frozen argument list, no user input, bounded time and output; a configured path must match a strict absolute-path pattern | `never uses a shell and always passes the frozen argument list`, `rejects a configured executable path…` |
| 10 | Queue resource exhaustion | Bounded queue depth, queue timeout, FIFO, no permit leak, idempotent release | scheduler suite |
| 11 | Duplicate or late terminal events | Exactly one terminal record accepted; a second one or anything after it is `STREAM_INVALID` | `rejects a second terminal record`, `rejects a record after the terminal record` |
| 12 | Model metadata lying or missing | Absent metadata becomes `unknown`, never zero and never an assumption of compatibility; `insufficient_data` blocks under `gpu_required` | model-fit suite |
| 13 | Credentials forwarded to the daemon | Header allowlist; `Authorization`, cookies and any API-key header throw rather than being dropped silently | endpoint-policy tests |
| 14 | Another local process using the worker gateway | Per-run bearer token required on every route even on loopback, constant-time comparison, expiry and revocation | gateway authentication tests |
| 15 | Stack traces or host paths reaching users | `sanitize()` strips stack frames and path-like runs and caps length; unknown errors normalize to a fixed message | `surfaces an inline upstream error, sanitized` |
| 16 | GPU serial identifiers in committed evidence | `redactHardwareProfile()` strips device UUIDs before anything is written | `redacts GPU UUIDs before evidence is written` |

## Residual risks

- The remote-marker field names are not specified in Ollama's public API
  documentation. Detection is defensive and proven against fixtures rather than
  a live signed-in daemon, because this installation has no cloud models
  available.
- IntentSmith does not and cannot verify at the OS level that the daemon is not
  itself proxying to a remote host. The metadata check is the strongest signal
  available without OS-level network isolation, which is out of Phase 2 scope.
- Concurrency is enforced in-process. A second IntentSmith process would have its
  own scheduler.

## Dependencies

Phase 2 added **no new runtime dependencies**. The adapter uses the Node
runtime's own `fetch` behind an injectable transport seam. An Ollama client SDK
was rejected deliberately: it would introduce cloud defaults, authentication
behaviour and hidden retries, none of which this adapter may have. No lockfile
entry was added in Phase 2.
