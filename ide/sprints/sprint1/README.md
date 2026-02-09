# C3 IDE — Sprint 1: Chat + Agent Log + Backend Connection

## Přehled

Sprint 1 implementuje komunikační vrstvu mezi C3 IDE (Theia) a C3 backendem
přes WebSocket, plus dva hlavní UI panely: Chat a Agent Log.

## Architektura

```
┌─────────────────────────────────────────────────────────┐
│ C3 IDE (Theia)                                          │
│                                                         │
│  ┌──────────────┐   ┌──────────────┐                    │
│  │ Chat Panel   │   │ Agent Panel  │    (React widgets) │
│  │ (dialog)     │   │ (event log)  │                    │
│  └──────┬───────┘   └──────┬───────┘                    │
│         │                  │                            │
│  ┌──────┴──────────────────┴───────┐                    │
│  │  C3BackendBridgeProxy           │    (frontend)      │
│  │  - subscribes to events         │                    │
│  │  - proxies methods via JSON-RPC │                    │
│  └──────────────┬──────────────────┘                    │
│                 │ JSON-RPC                              │
│  ┌──────────────┴──────────────────┐                    │
│  │  C3BackendBridgeService         │    (Theia backend) │
│  │  - manages WebSocket connection │                    │
│  │  - protocol handshake           │                    │
│  │  - reconnection logic           │                    │
│  └──────────────┬──────────────────┘                    │
└─────────────────┼───────────────────────────────────────┘
                  │ WebSocket (ws://localhost:3001/c3/ws)
┌─────────────────┼───────────────────────────────────────┐
│ C3 Backend      │                                       │
│  ┌──────────────┴──────────────────┐                    │
│  │  ws-server.js                   │                    │
│  │  - protocol handshake           │                    │
│  │  - turn lifecycle management    │                    │
│  │  - agent event emission         │                    │
│  │  - cancel support               │                    │
│  └──────────────┬──────────────────┘                    │
│                 │                                       │
│  ┌──────────────┴──────────────────┐                    │
│  │  conversationHandler (existing) │                    │
│  │  + event hooks (new)            │                    │
│  └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

## Kontrakty dodržené v této implementaci

| Kontrakt | Kde |
|---|---|
| Protocol versioning | `ws-server.js` — hello/hello_ack/hello_reject handshake |
| Turn lifecycle | `ws-server.js` — turn_start/turn_end s status (ok/cancelled/timeout/error) |
| Event ordering (seq) | `ws-server.js` — monotonic `++seq` counter per connection |
| Agent concurrency | `ws-server.js` — max 1 turn, odmítne druhý vstup |
| Chat ≠ Agent log | Chat panel jen dialog, Agent panel jen eventy, žádný overlap |

## Soubory

```
packages/
├── protocol/                           @c3/protocol (shared types)
│   └── src/
│       ├── index.ts                    Re-exports
│       ├── messages.ts                 C3Message, C3AgentEvent, payloads
│       ├── channels.ts                 WS envelope, handshake types
│       └── constants.ts               PROTOCOL_VERSION, icons, colors
│
├── backend-bridge/                     @c3/backend-bridge (WS connection)
│   └── src/
│       ├── common/
│       │   └── backend-bridge-protocol.ts   Service interface + events
│       ├── node/
│       │   ├── backend-bridge-service.ts    WS client, reconnect, handshake
│       │   └── backend-bridge-module.ts     Theia backend DI
│       └── browser/
│           ├── backend-bridge-proxy.ts      Frontend event proxy
│           └── backend-bridge-module.ts     Theia frontend DI
│
├── chat-panel/                         @c3/chat-panel (Chat UI)
│   └── src/browser/
│       ├── chat-panel-widget.tsx        Main ReactWidget
│       ├── chat-panel-contribution.ts   Theia registration
│       ├── chat-panel-module.ts         DI module
│       ├── components/
│       │   ├── ChatMessage.tsx          Single message bubble
│       │   ├── ChatInput.tsx            Input with history, Enter/Shift+Enter
│       │   ├── MarkdownRenderer.tsx     Safe markdown → React
│       │   └── StreamingIndicator.tsx   Typing dots
│       └── styles/
│           └── chat-panel.css           Dark theme styles
│
├── agent-panel/                        @c3/agent-panel (Agent Log UI)
│   └── src/browser/
│       ├── agent-panel-widget.tsx       Main ReactWidget
│       ├── agent-panel-contribution.ts  Theia registration
│       ├── agent-panel-module.ts        DI module
│       ├── components/
│       │   ├── AgentEventRow.tsx        Single event row renderer
│       │   ├── EventFilter.tsx          Toggle filter buttons
│       │   └── StatusBadge.tsx          Agent status indicator
│       └── styles/
│           └── agent-panel.css          Dark theme styles
│
└── c3-backend/                         Backend integration
    ├── ws-server.js                    WS server (add to Express)
    ├── ws-server.test.js              Integration testy (6 test suites)
    └── integration-guide.js            How to wire into existing handler
```

## Integrace s existujícím C3 backendem

### Minimální varianta (wrapper)

Pokud nechcete měnit conversation handler, použijte wrapper
z `integration-guide.js`:

```javascript
const { createC3WebSocketServer } = require('./ws-server');
const { wrapConversationHandler } = require('./integration-guide');

const wrappedHandler = wrapConversationHandler(existingHandler);
createC3WebSocketServer(httpServer, wrappedHandler, logger);
```

Tím dostanete: chat funguje, ale agent log bude mít jen basic eventy
(CRE decision + LLM done). Bez streaming tokenů.

### Plná varianta (event hooks)

Upravte conversation handler aby přijímal options objekt s hooks:
`onCREDecision`, `onToolCall`, `onToolResult`, `onLLMStart`, `onLLMToken`,
`onLLMDone`, `onGateVerdict`.

Viz `integration-guide.js` pro kompletní příklad.

## Co NENÍ v tomto sprintu

- Terminal/ShellTool integrace (Sprint 2)
- Persistent project store (Sprint 2)
- Design viewer (Sprint 3)
- Diff viewer (Sprint 4)
- Keybindings beyond defaults (Sprint 3)

## Prerekvizity

- Sprint 0 hotový (Theia scaffold se spouští)
- Node.js 18+
- Existující C3 backend běží na :3001
