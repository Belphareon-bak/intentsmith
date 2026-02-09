# C3 IDE — Theia-based IDE pro C3 Agent

## Obsah

```
ide/
├── c3-ide-roadmap-v3.md          ← Roadmap + architektonicke kontrakty
├── CHANGELOG.md                   ← Co bylo opraveno
├── REVIEW.md                      ← Revize roadmap vs. implementace
│
└── sprints/
    ├── sprint0/                   ← Theia Shell + Scaffold (prerekvizita)
    ├── sprint0.5/                 ← LSP Validation (prerekvizita)
    ├── sprint1/                   ← Chat + Agent Log + WS Backend
    ├── sprint2/                   ← ShellTool + Project Store + Status
    ├── sprint3/                   ← Design Viewer + Command Palette + Keybindings
    ├── sprint4/                   ← Diff Viewer + Code Review + Git
    ├── sprint5/                   ← Error Recovery + Onboarding + Settings + Export
    ├── sprint6/                   ← Multi-project + Chat Search + Token Dashboard
    └── sprint7/                   ← Process Isolation + Shell/WS Security
```

## Jak IDE spustit

### Krok 1: Theia scaffold (Sprint 0)

IDE je postavene na Eclipse Theia. Sprint 0 vytvari spustitelnou Electron app "C3 Studio":

```bash
# 1. Vytvorit Theia monorepo
mkdir c3-ide && cd c3-ide
# package.json s yarn workspaces

# 2. Nainstalovat Theia core packages (viz sprint0/README.md)
#    NECHAT: @theia/core, @theia/editor, @theia/filesystem, @theia/terminal,
#            @theia/workspace, @theia/monaco, @theia/navigator, @theia/plugin-ext
#    VYHODIT: @theia/git, @theia/debug, @theia/scm, @theia/vsx-registry

# 3. Pridat Electron wrapper (applications/electron/)

# 4. Build + spustit
yarn && yarn build
yarn electron start
```

### Krok 2: C3 Backend (ws-server)

Backend WS server se pridava k existujicimu Express serveru:

```javascript
// V server.js:
import { createC3WebSocketServer } from './ide/sprints/sprint1/packages/c3-backend/ws-server.cjs';

// Pridat WS server na existujici HTTP server
const wss = createC3WebSocketServer(httpServer, conversationHandler, logger);
// → ws://localhost:3001/c3/ws
```

Minimal varianta (wrapper pro existujici handler):
```javascript
import { wrapConversationHandler } from './ide/sprints/sprint1/packages/c3-backend/integration-guide.cjs';

const wrapped = wrapConversationHandler(existingHandler);
createC3WebSocketServer(httpServer, wrapped, logger);
```

### Krok 3: Theia extensions (Sprinty 1-7)

Kazdy sprint je sada Theia extensions v `packages/` formatu:

```
extensions/
├── @c3/protocol           ← Sprint 1: shared types
├── @c3/backend-bridge     ← Sprint 1: WS connection
├── @c3/chat-panel         ← Sprint 1: Chat UI
├── @c3/agent-panel        ← Sprint 1: Agent event log
├── @c3/shell-bridge       ← Sprint 2: ShellTool integration
├── @c3/project-store      ← Sprint 2: Persistent projects
├── @c3/status-widget      ← Sprint 2: Status bar
├── @c3/design-viewer      ← Sprint 3: Design document viewer
├── @c3/command-palette    ← Sprint 3: C3 commands
├── @c3/keybindings        ← Sprint 3: Keyboard shortcuts
├── @c3/notifications      ← Sprint 3: Notification service
├── @c3/diff-viewer        ← Sprint 4: Diff/merge viewer
├── @c3/review-panel       ← Sprint 4: Code review panel
├── @c3/git-integration    ← Sprint 4: Git operations
├── @c3/error-recovery     ← Sprint 5: Reconnection + crash recovery
├── @c3/onboarding         ← Sprint 5: Onboarding wizard
├── @c3/settings           ← Sprint 5: Settings panel
├── @c3/project-export     ← Sprint 5: Project export/import
├── @c3/multi-project      ← Sprint 6: Project switcher
├── @c3/chat-search        ← Sprint 6: Chat history search
├── @c3/token-dashboard    ← Sprint 6: Token usage dashboard
├── @c3/shell-security     ← Sprint 7: Shell command security
├── @c3/ws-security        ← Sprint 7: WebSocket security
├── @c3/process-isolation  ← Sprint 7: Bubblewrap sandboxing
└── @c3/security-audit     ← Sprint 7: Security audit protocol
```

## WS Protokol

```
IDE → Backend: { channel: "handshake", data: { type: "hello", protocol_version: 1 } }
Backend → IDE: { channel: "handshake", data: { type: "hello_ack", protocol_version: 1 } }

IDE → Backend: { channel: "chat", data: { type: "chat_message", content: "..." } }
Backend → IDE: { channel: "agent", data: { type: "turn_start", turnId: "t-001", ... } }
Backend → IDE: { channel: "agent", data: { type: "cre_decision", turnId: "t-001", ... } }
Backend → IDE: { channel: "chat", data: { type: "assistant", content: "...", ... } }
Backend → IDE: { channel: "agent", data: { type: "turn_end", turnId: "t-001", ... } }
```

## Milniky

| Sprint | Stav |
|--------|------|
| Sprint 0.5 | IDE shell se spousti, LSP funguje |
| Sprint 2 | **Funkcni MVP** — chat, agent log, ShellTool, persistent projekty |
| Sprint 4 | **Code review workflow** — diff, accept/reject, auto-commit |
| Sprint 5 | **Production-ready** single-user |
| Sprint 7 | **Security-hardened** — pripraveny na distribuci |

## Kontrakty

Vsechny architektonicke kontrakty z roadmapu jsou implementovany:
protocol versioning, turn lifecycle, event ordering, agent concurrency,
chat!=commands, design!=conversation, design immutability, git dirty tree,
crash consistency, argv spawn, capability matrix, bubblewrap, WS security.

## Testy

```bash
node ide/sprints/sprint1/packages/c3-backend/ws-server.test.cjs   # 29 testu
node ide/sprints/sprint4/tests/sprint4.test.cjs                    # 30 testu
node ide/sprints/sprint5/tests/sprint5.test.cjs                    # 29 testu
node ide/sprints/sprint6/tests/sprint6.test.cjs                    # 37 testu
node ide/sprints/sprint7/tests/sprint7.test.cjs                    # 90 testu
# Celkem: ~215 testu
```

| Sprint | Testu | Status |
|--------|-------|--------|
| Sprint 1 | 29 | pass |
| Sprint 2 | 25 (TypeScript) | - |
| Sprint 4 | 30 | pass |
| Sprint 5 | 29 | pass |
| Sprint 6 | 37 | pass |
| Sprint 7 | 90 | pass |
| **Celkem** | **~215** | **pass** |
