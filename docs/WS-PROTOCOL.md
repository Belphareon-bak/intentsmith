# WebSocket Protocol

> **Protocol v1** | 5 channels | ~1,028 lines (backend) + ~1,200 lines (client)

## Connection

**Endpoint:** `ws://host:3335/c3/ws`

### Handshake

```
IDE → Backend:   { type: 'hello', protocolVersion: 1, ideVersion: '...', features: [...] }
Backend → IDE:   { type: 'hello_ack', protocolVersion: 1, backendVersion: '...', features: [...] }
  OR
Backend → IDE:   { type: 'hello_reject', reason: '...', requiredProtocol: 1 }
```

**Negotiated features:** `workspace`, `terminal`, `merge-preview`, `edit-ask`, `audit`

**Reconnect:** Exponential backoff, `delay = min(1000 * 2^retry, 30000)`, max 12 retries.

## Authentication

Handshake má dvě sériové vrstvy. Nejdřív společná loopback/origin boundary,
potom M5 global auth. Production přijme private per-process Studio capability,
admin credential nebo scoped API token; native loopback klient bez credentialu
končí 401. Dev loopback bypass je explicitně omezený na non-production.

Úspěšný upgrade vloží immutable `authenticatedSubject` do serverového requestu.
Session adapter dostane právě tuto identitu; `chat`, `control` ani `terminal`
payload ji nemůže vyrobit nebo přepsat. To je per-message authorization
boundary: všechny následné efekty jsou svázané s jednou ověřenou session.

| Handshake | Production výsledek |
|---|---|
| `Origin: https://evil.example` | **403** před auth |
| Native loopback bez credentialu | **401** |
| Studio capability pro jiný proces | **401** |
| Přesná Studio capability | spojeno jako `local-operator` |
| Admin/API bearer subprotocol | spojeno podle scope/identity |

Tři nejvýznamnější efektové zprávy zůstávají navíc omezené svými existujícími
capability/effect kontrakty:

| Message | Effect | Additional guard |
|---|---|---|
| `chat` | full chat pipeline — LLM, CRE, tool calls | transport subject + M2 effect authority |
| `control` → `edit_approve` | **writes a file**, after `currentHash === baseHash` | hash guard only |
| `terminal` → `exec` | **runs a shell command**, 120 s timeout | `validateCommand()` — binary whitelist, arg blacklist, path sandbox (`src/executor/shell-security.js:12,56,107`) |

Bearer pro WS se přenáší jednou jako base64url subprotocol s prefixem
`intentsmith-auth-v1.`; raw hodnota se neloguje. Studio tuto cestu nepotřebuje,
protože používá per-process capability z privátního port-file kontraktu.

## Channels

All post-handshake messages use channel-based envelope: `{ channel: string, data: object }`

### chat

User input and assistant responses.

**IDE → Backend:**
```javascript
{
  channel: 'chat',
  data: {
    content: string,           // user message
    conversationId: string,    // target conversation
    editMode: 'auto'|'ask'|'direct',
    agentId: string | null,
    projectId: string | null,
    attachments: [{name, path, type}]
  }
}
```

**Backend → IDE:**
```javascript
{
  channel: 'chat',
  data: {
    id: 'msg-...',
    type: 'assistant' | 'system',
    content: string,
    conversationId: string,
    timestamp: ISO8601,
    metadata: {
      mode: 'SEARCH'|'CODE'|'CONVERSATIONAL'|'DESIGN'|'CREATIVE'|'BUILD'|'LOCAL',
      confidence: 0-1,
      turnId: string,
      conversationId: string
    }
  }
}
```

### agent

One-way event stream (Backend → IDE). Powers the agent log panel.

```javascript
{
  channel: 'agent',
  data: {
    id: 'evt-...',
    seq: number,           // monotonic per-connection
    turnId: string,        // 't-001', 't-002', ...
    type: AgentEventType,
    timestamp: ISO8601,
    payload: { ... }
  }
}
```

**Event types:**

| Type | Payload | Description |
|------|---------|-------------|
| `turn_start` | `{input}` | Turn begins |
| `turn_end` | `{status, durationMs, telemetry?}` | Turn ends (`ok`/`cancelled_by_user`/`timeout`/`error`) |
| `cre_decision` | `{intent, confidence, actionType, tools}` | CRE classification |
| `tool_call` | `{tool, args}` | Tool invocation |
| `tool_result` | `{tool, success, durationMs, summary}` | Tool completion |
| `llm_start` | `{model, tokensIn}` | LLM generation starts |
| `llm_token` | `{token}` | Streaming token |
| `llm_done` | `{tokensOut, durationMs}` | LLM generation ends |
| `gate_verdict` | `{ok, passed, dimension?, reason?, score?}` | Quality gate result |
| `system_step` | `{step, detail}` | Named system step (agent log) |
| `error` | `{code, message, recoverable}` | Error event |
| `edit_request` | `{reqId, file, oldContent, newContent, baseHash}` | Ask-mode edit request |
| `edit_timeout` | `{reqId, file}` | Edit approval timed out (30s) |
| `edit_conflict` | `{reqId, file, message}` | File changed since read |

#### Terminal provider failure

A provider outage is not an assistant response. The backend emits:

1. `turn_end` with `status: "error"` and the stable public error message;
2. `error` with
   `{code: "LLM_PROVIDER_UNAVAILABLE", message: "Model provider is temporarily unavailable.", recoverable: true}`;
3. a `chat` system message with the same public message.

No `chat` message with `type: "assistant"` is emitted, and no assistant turn is
persisted. The already accepted user turn remains in the conversation.

### control

Bidirectional control messages.

**IDE → Backend:**

| Action | Data | Description |
|--------|------|-------------|
| `cancel` | `{conversationId?}` | Abort active turn(s) |
| `ping` | — | Keep-alive |
| `rehydrate` | `{rehydrateRequestId, conversationIds: [...]}` | Validate a complete bounded ID set after reconnect |
| `edit_approve` | `{requestId}` | Approve pending file edit |
| `edit_reject` | `{requestId}` | Reject pending file edit |
| `sync_settings` | `{settings: {...}}` | Push feature flags + notification config |

**Backend → IDE:**

| Action | Data | Description |
|--------|------|-------------|
| `pong` | — | Keep-alive response |
| `rehydrate_ack` | `{rehydrateRequestId, complete: true, validIds: [...], invalidIds: [...]}` | Complete request-bound durable partition |
| `rehydrate_reject` | `{rehydrateRequestId, reason}` | Request-bound malformed/over-limit set rejection |
| `sync_settings` | `{changed: number}` | Settings applied count |
| `session_invalid` | `{sessionId?}` | Legacy non-authoritative warning; never clears or assigns client identity |

`rehydrate_ack` is authoritative only when the request ID matches and the two
unique disjoint arrays cover the complete requested set. Only explicit
`invalidIds` may clear an unchanged exact Studio session. Missing, partial,
foreign, duplicate or overlapping ACK data preserves local state and degrades
the restore. A matching typed reject ends the current restore without history
fetch or cleanup; a foreign/malformed reject cannot end it. The server emits an
ACK only from an explicitly ready file-backed SQLite store; unavailable store
state closes that socket without identity authority.

### terminal

Bidirectional terminal command execution.

**IDE → Backend:**
```javascript
{ channel: 'terminal', data: { type: 'exec', command: string, cwd?: string, reqId?: string } }
```

**Backend → IDE:**

| Type | Data | Description |
|------|------|-------------|
| `exec_start` | `{reqId, command}` | Command started |
| `exec_result` | `{reqId, status, stdout, stderr, exitCode, durationMs}` | Command completed |
| `stream` | `{reqId, data}` | Streaming output |
| `error` | `{reqId, message}` | Execution error |

### status

Backend → IDE status updates.

```javascript
{ channel: 'status', data: { agentStatus: 'idle' | 'executing' } }
{ channel: 'status', data: { fileWritten: { path, hash } } }
```

### workspace

Backend → IDE file watcher events.

```javascript
{ channel: 'workspace', data: { type: 'file_batch', events: [{event, path}, ...] } }
```

Events: `add`, `change`, `unlink`. Batched with 100ms debounce. Ignores `node_modules/`, `.git/`, `.c3/`.

## Session Management

**Per-connection state:**
- `sessionId` — auto-generated `ws-<timestamp>-<random>`
- `activeTurns` — `Map<conversationId, {turnId, abortController, startTime}>`
- `editPending` — `Map<reqId, {resolve, reject, timer}>` (30s timeout)
- `seq` — monotonic message sequence counter

**Routing (multi-session):**
1. Terminal `reqId` → session index (most reliable)
2. `conversationId` → match `_sessions[i]._convId`
3. Last sender index (fallback)

**Concurrency:**
- Different conversations execute in parallel
- Same conversation is serialized (second request gets "Počkejte prosím")

## Edit Request Flow (Ask Mode)

1. Tool = `fs.write` + editMode = `ask` → intercept
2. Compute `baseHash = SHA-256(oldContent).substring(0, 16)` (null for new files)
3. Send `edit_request` with reqId, file, oldContent, newContent, baseHash
4. Wait for `edit_approve` or `edit_reject` (30s timeout)
5. On approve: verify `currentHash === baseHash` → write file → broadcast `fileWritten`
6. On timeout: send `edit_timeout` → reject promise → turn error

## Backend Files

| File | Lines | Responsibility |
|------|-------|----------------|
| `index.js` | 24 | Public API exports |
| `protocol.js` | 132 | Constants + message builders |
| `ws-server.js` | 205 | Server attachment + connection lifecycle |
| `session-adapter.js` | 591 | Per-connection state + chat/terminal/control routing |
| `file-watcher.js` | 76 | chokidar wrapper with batching |

## Client Files

| File | Lines | Responsibility |
|------|-------|----------------|
| `ws-client.js` | 364 | WS transport, handshake, reconnect, send functions |
| `agent-client.js` | 280 | Agent event formatting, execution tracking |
| `terminal-client.js` | 212 | Command routing, output parsing, execution lock |
| `event-bus.js` | ~50 | Central Pub/Sub dispatcher (`C3Bus`) |
| `agent-log-renderer.js` | 366 | Turn grouping, event pairing, React rendering |

## Client Send Functions

```javascript
wsSendChat(content, session, sessionIdx)    // Chat message
wsSendTerminal(command, session, sessionIdx) // Terminal command
wsSendCancel(conversationId?)               // Abort turn(s)
wsSendEditApprove(reqId)                    // Edit approval
wsSendEditReject(reqId)                     // Edit rejection
wsSendSyncSettings(settings)               // Feature flags sync
wsIsReady()                                // Connection status
wsHasFeature(name)                         // Feature check
```

## Client Events (C3Bus)

| Event | Source | Description |
|-------|--------|-------------|
| `ws:ready` | ws-client | Connection established |
| `ws:disconnected` | ws-client | Connection lost |
| `ws:reconnected` | ws-client | Reconnected after disconnect |
| `chat:message` | ws-client | Assistant message received |
| `chat:system` | ws-client | System message received |
| `agent:event` | ws-client | Raw agent event |
| `agent:log` | agent-client | Formatted agent log entry |
| `terminal:output` | ws-client | Terminal output received |
| `terminal:line` | terminal-client | Parsed terminal line |
| `status:update` | ws-client | Status change |
| `workspace:change` | ws-client | File change detected |
| `session:changed` | internal | Session switch |
| `session:invalidated` | ws-client | Complete ACK cleared one exact unchanged session |
| `session:quarantined` | ws-client | Malformed local identity preserved read-only |
| `session:identity_warning` | ws-client | Legacy uncorrelated warning; no mutation authority |
| `edit:request` | agent-client | Edit approval needed |
| `edit:resolved` | ws-client | Edit approved/rejected |

## Invariants

1. **Handshake mandatory** — no post-handshake messages until `hello_ack` received
2. **Per-conversation mutex** — same conversation serialized, different conversations parallel
3. **Edit timeout (30s)** — pending edits auto-rejected after timeout
4. **Safe send** — check `readyState === OPEN` before sending
5. **Graceful cleanup** — on disconnect, abort all turns + reject all pending edits
