# CLAUDE.md - C.3 Agent Development Context

**Verze:** v58.3
**Datum:** 2026-02-09
**Projekt:** ~/Projects/c3-agent-wip

---

## Aktualni stav

C.3 Agent je plne funkcni conversational AI s CRE (Conversational Reasoning Engine) jako single-authority decision enginem, DESIGN pipeline pro strukturovane navrhy, expert systemem, a IDE (Theia) frontend.

### Branch: `master`

### Testovaci pokryti

| Sada | Pocet | Stav |
|------|-------|------|
| CRE Comprehensive | 401 | pass |
| Notifications | 67 | pass |
| Workflow | 42 | pass |
| Trust Feedback | 34 | pass |
| v583 Tier1 | 94 | pass |
| E2E (framework) | 60 | pass |
| IDE Sprint 1 (WS) | 29 | pass |
| IDE Sprint 4 (Diff/Review) | 30 | pass |
| IDE Sprint 5 (Export/Settings) | 29 | pass |
| IDE Sprint 6 (Multi-project) | 37 | pass |
| IDE Sprint 7 (Security) | 90 | pass |
| **Celkem** | **~913** | **pass** |

---

## Architektura

```
User Input
  |
  v
ChatController.handle()
  |
  v
ConversationHandler
  |-- CRE classifyIntent() --> LOCAL | CONVERSATIONAL | SEARCH | DESIGN | CREATIVE | BUILD | CODE
  |-- DESIGN session intercept (DESIGN_CONTINUE_PATTERNS, DESIGN_CLOSE, BUILD_TRANSITION)
  |-- Tool execution (TOOL_CALL)
  |-- LLM synthesis + Output Gate (D6)
  |
  v
Response (text + metadata)
```

### CRE Intent Routing

| Intent | Handler | Popis |
|--------|---------|-------|
| LOCAL | Deterministic | Cas, datum, kalkulacka, konverze |
| CONVERSATIONAL | LLM synthesis | Bezna konverzace |
| SEARCH | WebSearch + synthesis | Fresh data dotazy |
| DESIGN | Design pipeline | Strukturovane navrhy (SessionState lifecycle) |
| CREATIVE | LLM synthesis | Pribehy, basne, kreativni obsah |
| BUILD | Planner pipeline | Stavba projektu |
| CODE | LLM synthesis | Inline kod (bez projektu) |

---

## Klicove soubory

### CRE Decision Engine
```
src/chat/cre-decision.js          # ~2400 radku — klasifikace intentu, patterns, typo normalizace
src/chat/cre-decision-types.js    # CREDecision ADT, DecisionType, IntentType
```

### Chat Pipeline
```
src/chat/controller.js             # ChatController — vstupni bod pro chat
src/chat/handlers/conversation.js  # ConversationHandler — routing, DESIGN session, tool calls
src/chat/handlers/design.js        # DESIGN pipeline (SessionState, metrics, quality gates)
src/chat/handlers/utils/synthesis.js  # LLM synteza + Output Gate (D6)
src/chat/handlers/utils/quality.js    # Quality evaluators (fluff, hedging, sections)
src/chat/conversation-store.js     # Session persistence (SQLite)
```

### LLM + Tools
```
src/llm/gateway.js                # LLM Gateway s auth tokeny
src/llm/client.js                 # Ollama klient
src/llm/web-search.js             # Web search tool
src/executor/tool-executor.js     # Tool executor
src/tools/registry.js             # Tool registry
```

### Expert System
```
src/experts/expert-layer.js       # Expert routing (ucetni, pravnik, atd.)
src/experts/expert-store.js       # Expert config persistence
```

### IDE (Theia)
```
ide/                               # C3-IDE — Theia-based IDE (novy, nahrazuje UI)
ide/c3-ide-roadmap-v3.md          # Roadmap s architektonickymi kontrakty
ide/sprints/sprint0/              # Theia scaffold (prerekvizita)
ide/sprints/sprint1/              # Chat panel, Agent log, WS bridge
ide/sprints/sprint2/              # ShellTool, Project Store, Status
ide/sprints/sprint3/              # Design Viewer, Command Palette, Keybindings
ide/sprints/sprint4/              # Diff Viewer, Code Review, Git integration
ide/sprints/sprint5/              # Error Recovery, Onboarding, Settings, Export
ide/sprints/sprint6/              # Multi-project, Chat Search, Token Dashboard
ide/sprints/sprint7/              # Process Isolation, Shell Security, WS Security
```

### Server
```
src/server.js                     # Express HTTP server, port 3335
src/config.js                     # Konfigurace (server, ollama, modely)
```

### Testy
```
tests/                            # 35 testovych souboru
e2e/framework.js                  # E2E test framework (ConversationSimulator)
e2e/run-e2e.js                    # E2E test runner (60 testu)
ide/sprints/*/tests/              # IDE sprint testy (~215 testu)
```

---

## Spusteni

### Backend
```bash
cd ~/Projects/c3-agent-wip
node src/server.js
# Server na http://127.0.0.1:3335
# Chat UI: http://127.0.0.1:3335/architect
```

### Prerekvizity
- Node.js 18+
- Ollama s modelem qwen2.5:32b (http://127.0.0.1:11434)
- SQLite (better-sqlite3)

### IDE (zatim jen sprinty — Theia scaffold je prerekvizita)
```bash
# Sprint testy:
node ide/sprints/sprint1/packages/c3-backend/ws-server.test.cjs   # 29 testu
node ide/sprints/sprint4/tests/sprint4.test.cjs                    # 30 testu
node ide/sprints/sprint5/tests/sprint5.test.cjs                    # 29 testu
node ide/sprints/sprint6/tests/sprint6.test.cjs                    # 37 testu
node ide/sprints/sprint7/tests/sprint7.test.cjs                    # 90 testu
```

### Testy
```bash
# Hlavni testovaci sady
node tests/cre-comprehensive.test.js    # 401 testu — CRE klasifikace
node tests/notifications.test.js        # 67 testu
node tests/workflow.test.js             # 42 testu
node tests/trust-feedback.test.js       # 34 testu
node tests/v583-tier1.test.js           # 94 testu
node e2e/run-e2e.js                     # 60 E2E testu

# Konverzacni testy (vyzaduje Ollama + GPU)
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

---

## Klicove kontrakty

### 1. CRE je jedina autorita
Vsechny chat zpravy prochazi CRE klasifikaci. Zadny bypass.

### 2. DESIGN session lifecycle
- `navrhni X` → DESIGN intent → SessionState created
- Follow-upy zustavaji v DESIGN (60+ DESIGN_CONTINUE_PATTERNS)
- `hotovo` / `diky, to staci` → graceful close (DESIGN_CLOSE_PATTERNS)
- `jdeme stavet` → BUILD transition (zavre DESIGN, preda kontext)

### 3. Output Gate (D6)
Kazda LLM odpoved projde quality gatem: fluff check, hedging check, language leak check, section structure check (pro DESIGN).

### 4. Typo normalizace
`normalizeForClassification()` v cre-decision.js normalizuje caste ceske preklepy (navhni→navrhni, archtiekturu→architekturu) pred klasifikaci.

### 5. IDE kontrakty (Sprint 1-7)
- Protocol versioning (hello/hello_ack handshake)
- Turn lifecycle (turn_start/turn_end se statusy)
- Agent concurrency (max 1 turn)
- Chat != Command Palette
- Design immutability
- Git dirty tree invariant
- Atomic writes (crash consistency)
- Shell security (7 vrstev + bubblewrap)
- WS security (256-bit token, rate limiting, localhost only)

---

## Poznamky pro pokracovani

1. **Nejdriv testy** — pred jakoukoli zmenou spust existujici testy
2. **ESM projekt** — package.json ma `"type": "module"`, IDE soubory jsou .cjs (CommonJS)
3. **Ceska diakritika** — `\b` nefunguje s non-ASCII; pouzij `(?:\s|$|[?!.,;])` misto `\b`
4. **Ollama model** — `qwen2.5:32b` je vychozi model pro vsechny LLM volani

---

*Posledni aktualizace: 2026-02-09*
