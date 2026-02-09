# C3-Agent v58.3

Conversational AI agent s CRE decision enginem, DESIGN pipeline, expert systemem a Theia IDE frontendem.

## Spusteni

```bash
# Backend (Express + Ollama)
node src/server.js
# → http://127.0.0.1:3335
# → Chat UI: http://127.0.0.1:3335/architect
```

### Prerekvizity

- Node.js 18+
- Ollama s modelem `qwen2.5:32b` na `http://127.0.0.1:11434`
- SQLite (better-sqlite3 — `npm install`)

## Struktura projektu

```
c3-agent-wip/
├── src/
│   ├── server.js                  # Express HTTP server
│   ├── config.js                  # Konfigurace
│   ├── chat/
│   │   ├── controller.js          # ChatController — vstupni bod
│   │   ├── cre-decision.js        # CRE klasifikace intentu (~2400 radku)
│   │   ├── cre-decision-types.js  # DecisionType, IntentType
│   │   ├── conversation-store.js  # Session persistence (SQLite)
│   │   └── handlers/
│   │       ├── conversation.js    # ConversationHandler — routing
│   │       ├── design.js          # DESIGN pipeline
│   │       └── utils/
│   │           ├── synthesis.js   # LLM synteza + Output Gate (D6)
│   │           └── quality.js     # Quality evaluators
│   ├── llm/
│   │   ├── gateway.js             # LLM Gateway + auth
│   │   ├── client.js              # Ollama klient
│   │   └── web-search.js          # Web search tool
│   ├── experts/
│   │   ├── expert-layer.js        # Expert routing (ucetni, pravnik, ...)
│   │   └── expert-store.js        # Expert config persistence
│   ├── executor/
│   │   └── tool-executor.js       # Tool executor
│   ├── tools/
│   │   └── registry.js            # Tool registry
│   ├── agents/                    # Agent platform
│   ├── planner/                   # BUILD pipeline
│   ├── notifications/             # Trust feedback loop
│   ├── memory/                    # Session + LTM memory
│   ├── db/                        # SQLite database
│   └── core/                      # Logger, error handling
│
├── ide/                           # C3-IDE (Theia) — 7 sprintu
│   ├── c3-ide-roadmap-v3.md       # Roadmap + architektonicke kontrakty
│   └── sprints/
│       ├── sprint0/               # Theia scaffold
│       ├── sprint1/               # Chat + Agent Log + WS bridge
│       ├── sprint2/               # ShellTool + Project Store
│       ├── sprint3/               # Design Viewer + Commands
│       ├── sprint4/               # Diff Viewer + Code Review
│       ├── sprint5/               # Error Recovery + Settings
│       ├── sprint6/               # Multi-project + Search
│       └── sprint7/               # Security hardening
│
├── tests/                         # 35 testovych souboru (~700 testu)
├── e2e/                           # E2E framework + runner (60 testu)
└── docs/                          # Dokumentace
```

## CRE Intent Routing

| Intent | Popis | Priklad |
|--------|-------|---------|
| LOCAL | Cas, datum, kalkulacka | "kolik je hodin", "5+3" |
| CONVERSATIONAL | Bezna konverzace | "jak se mas", "vysvetli mi X" |
| SEARCH | Dotazy na cerstve udaje | "pocasi v Praze", "cena bitcoinu" |
| DESIGN | Strukturovane navrhy | "navrhni architekturu pro X" |
| CREATIVE | Kreativni obsah | "napis basnicku", "vymysli pribeh" |
| BUILD | Stavba projektu | "postav mi webovou aplikaci" |
| CODE | Inline kod | "napis funkci na X" |

## DESIGN Session Lifecycle

```
"navrhni X" → DESIGN intent → SessionState created
    ↓
Follow-upy → DESIGN_CONTINUE intercept (60+ patterns)
    ↓
"hotovo" / "diky, to staci" → DESIGN_CLOSE → graceful close
    nebo
"jdeme stavet" → BUILD_TRANSITION → zavre DESIGN, preda kontext
```

## IDE (Theia)

C3-IDE je Theia-based IDE s custom panely:

| Sprint | Obsah | Testu |
|--------|-------|-------|
| 0 | Theia scaffold, Electron wrapper | - |
| 1 | Chat panel, Agent log, WS bridge | 29 |
| 2 | ShellTool, Project Store, Status | 25 |
| 3 | Design Viewer, Command Palette, Keybindings | - |
| 4 | Diff Viewer, Code Review, Git | 30 |
| 5 | Error Recovery, Onboarding, Settings, Export | 29 |
| 6 | Multi-project, Chat Search, Token Dashboard | 37 |
| 7 | Process Isolation, Shell Security, WS Security | 90 |

### IDE spusteni

IDE vyzaduje Theia scaffold (Sprint 0) jako zaklad. Sprinty 1-7 jsou extensions.

Pro spusteni plneho IDE:
1. Naklonovat Theia monorepo
2. Pridat Sprint 0 scaffold (Electron wrapper, C3 theme, stripped moduly)
3. Nainstalovat sprint extensions do `extensions/`
4. `yarn && yarn build`
5. `yarn electron start`

Backend (ws-server) se spousti jako soucast C3 backendu:
```javascript
import { createC3WebSocketServer } from './ide/sprints/sprint1/packages/c3-backend/ws-server.cjs';
createC3WebSocketServer(httpServer, conversationHandler, logger);
// → ws://localhost:3001/c3/ws
```

## Testy

```bash
# Hlavni sady
node tests/cre-comprehensive.test.js    # 401 — CRE klasifikace
node tests/notifications.test.js        # 67
node tests/workflow.test.js             # 42
node tests/trust-feedback.test.js       # 34
node tests/v583-tier1.test.js           # 94
node e2e/run-e2e.js                     # 60 — E2E

# IDE sprint testy
node ide/sprints/sprint1/packages/c3-backend/ws-server.test.cjs  # 29
node ide/sprints/sprint4/tests/sprint4.test.cjs                   # 30
node ide/sprints/sprint5/tests/sprint5.test.cjs                   # 29
node ide/sprints/sprint6/tests/sprint6.test.cjs                   # 37
node ide/sprints/sprint7/tests/sprint7.test.cjs                   # 90

# Konverzacni testy (vyzaduje Ollama + GPU)
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

## Dalsi dokumentace

- [CLAUDE.md](../CLAUDE.md) — development context pro AI asistenty
- [ide/c3-ide-roadmap-v3.md](../ide/c3-ide-roadmap-v3.md) — IDE roadmap + architektonicke kontrakty
- [ide/REVIEW.md](../ide/REVIEW.md) — revize roadmap vs. implementace
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — starsi architektura
- [docs/CHANGELOG.md](CHANGELOG.md) — historicky changelog
