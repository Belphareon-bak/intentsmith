# Ollama

Verified: 2026-07-28

## Upstream

- Repository: https://github.com/ollama/ollama
- API documentation: https://github.com/ollama/ollama/blob/main/docs/api.md
- Model library: https://ollama.com/library

## Version

- Observed locally installed version: `0.17.7`
- Behaviour in this record was pinned against that version.

Ollama does not publish a strictly versioned HTTP API. The adapter therefore
validates required fields, preserves unknown fields internally without
exposing them, and is not coupled to this version number.

## License

MIT (Ollama itself). Individual models carry their own licenses, which
`/api/show` reports in a `license` field.

## Use Mode

Local HTTP daemon on loopback. IntentSmith never installs, upgrades, signs in
to, or downloads models through Ollama. There is no API key and no call to
ollama.com.

## Observed Endpoint Behaviour (0.17.7)

### GET /api/version

```json
{ "version": "0.17.7" }
```

### GET /api/tags

```json
{ "models": [
  { "name": "qwen3:14b", "model": "qwen3:14b",
    "modified_at": "2026-03-25T22:04:04.262605238+01:00",
    "size": 5545682182, "digest": "44c161b1...",
    "details": { "parent_model": "", "format": "gguf", "family": "llama",
                 "families": ["llama","clip"], "parameter_size": "8B",
                 "quantization_level": "Q4_K_M" } }
] }
```

`parameter_size` is a display string such as `8B` or `14.8B`, not a number.

### POST /api/show

Request `{ "model": "<id>" }`. Response keys observed:
`capabilities`, `details`, `license`, `model_info`, `modelfile`, `parameters`,
`template`, `tensors`.

- `capabilities` is a string array, e.g. `["completion","tools","thinking"]`.
- `model_info` is a flat map with family-prefixed keys. Context length appears
  as `<family>.context_length`, e.g. `qwen3.context_length: 40960`.

### GET /api/ps

```json
{ "models": [] }
```

Lists currently loaded models. Empty when nothing is resident.

### POST /api/generate

Streaming responses are NDJSON: one JSON object per line. Token records:

```json
{ "model": "qwen3:14b", "created_at": "...", "response": "OK", "done": false }
```

The terminal record has `done: true` and adds `done_reason`, `total_duration`,
`load_duration`, `prompt_eval_count`, `prompt_eval_duration`, `eval_count`,
`eval_duration`, and the deprecated `context`.

**All durations are nanoseconds.** IntentSmith normalizes them to milliseconds
for display while keeping the raw integer as evidence.

`context` is deprecated upstream conversational state and is deliberately not
used as IntentSmith memory.

### Error framing

Errors are `{"error":"model 'x' not found"}` with an HTTP status such as 404.
An unknown route returns plain text `404 page not found`, not JSON, so the
adapter must not assume a JSON error body.

## Cloud-Backed Models

The Ollama library serves cloud-hosted models (observed 2026-07-28: Gemini 3
Flash Preview, GLM-5.1, Minimax M-series, Kimi K-series, Nemotron-3-Super,
DeepSeek-V4 Pro/Flash), tagged `cloud`. A signed-in Ollama installation can
expose these through the same loopback API as local models.

**A request to `127.0.0.1:11434` is therefore not automatically local
inference.**

The public API documentation does not specify the metadata fields that mark a
remote-backed model. IntentSmith treats a non-empty `remote_model` or
`remote_host` in any `/api/tags`, `/api/show`, or `/api/generate` payload as
proof the model is remote-backed, and rejects it. The `-cloud` name suffix is
used only as an additional warning signal, never as the enforcement mechanism.

This local install has no cloud models available, so remote rejection is proven
against fixtures rather than a live signed-in daemon.

## Minimum Platform Assumptions

- Loopback HTTP reachable at `127.0.0.1:11434` by default.
- No authentication on the local daemon.
- Ollama manages its own model storage; IntentSmith never writes to it.

Missing Ollama is a supported reported state, never a crash and never a
silently passing test.
