# C3-Agent v63.3

Conversational AI platforma s CRE decision enginem, 15 domain experty s 5D capability profily, multi-expertise merge enginem, enforcement pipeline, execution trace observability a C3 Studio IDE (Theia 1.65.2).

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
│   ├── server.js                  # Express HTTP server (port 3335)
│   ├── config.js                  # Konfigurace
│   ├── chat/
│   │   ├── controller.js          # ChatController — vstupni bod
│   │   ├── cre-decision.js        # CRE klasifikace intentu (~2400 radku)
│   │   ├── conversation-store.js  # Session persistence (SQLite)
│   │   └── handlers/
│   │       ├── conversation.js    # ConversationHandler — routing
│   │       ├── expert.js          # Expert handler — single + merge path
│   │       ├── decisions.js       # Decision sub-handlers
│   │       └── utils/
│   │           ├── synthesis.js   # LLM synteza + Output Gate (D6)
│   │           ├── quality.js     # Quality evaluators
│   │           └── language-enforcement.js  # SK→CZ, EN detekce
│   ├── experts/                   # Expert System (v63)
│   │   ├── expert-layer.js        # 15 built-in experts, ExpertAgent, resolveInheritance()
│   │   ├── expert-store.js        # Expert config persistence + validation
│   │   ├── expert-enforcement.js  # ExpertEnforcer: retry, strict mode, audit trail
│   │   ├── merge-engine.js        # mergeExpertisePrompt() — 15.5-step pure function
│   │   ├── merge-types.js         # MERGE_LIMITS, MODULE_SECTIONS, errors
│   │   ├── merge-compatibility.js # checkCompatibility() — 5D conflict detection
│   │   ├── capability-enforcer.js # Post-response 5D capability drift validation
│   │   └── capability-mapping.js  # Capability → prompt/temperature modifiers
│   ├── llm/
│   │   ├── gateway.js             # LLM Gateway + auth
│   │   ├── client.js              # Ollama klient
│   │   ├── cre-bridge.js          # CRE ↔ LLM bridge
│   │   └── web-search.js          # Web search tool
│   ├── executor/                  # Tool execution + circuit breaker
│   ├── agents/                    # Agent platform (worker agenty)
│   ├── planner/                   # BUILD pipeline (D1→CODE→R2→D2/R1)
│   ├── notifications/             # Trust feedback loop
│   ├── memory/                    # Session + LTM memory
│   ├── db/
│   │   └── database.js            # SQLite schema (28+ tables)
│   ├── ws-bridge/                 # IDE WebSocket bridge
│   └── core/                      # Logger, error handling
│
├── c3-ide/                        # C3 Studio IDE — Theia 1.65.2
│   ├── extensions/c3-chat-panel/  # Chat panel + transport layer
│   ├── extensions/c3-center-views/ # Center views + Expertise Wizard
│   ├── extensions/c3-detail-panel/ # Detail panel s capability bars
│   └── docs/                      # IDE dokumentace
│
├── tests/                         # ~50 testovych souboru (~1130 testu)
├── e2e/                           # E2E framework + runner
└── docs/                          # Dokumentace
```

## Expert System (v63)

15 built-in domain expertu s 5D capability profily:

| Expert | Capabilities (R,C,D,Ri,V) | Disclaimer |
|--------|--------------------------|-----------|
| analyst | 90,20,80,20,60 | - |
| accountant | 75,5,95,5,50 | Konzultujte danoveho poradce |
| lawyer | 80,10,90,5,70 | Konzultujte advokata |
| doctor | 70,10,85,5,60 | Edukacni info, nikoli lekarska rada |
| psychologist | 60,50,30,40,70 | Linka bezpeci 116 111 |
| writer | 40,90,10,70,90 | - |
| developer | 80,40,70,30,30 | - |
| ... | ... | ... |

### Multi-expertise merge

Max 3 expertises per konverzace. `mergeExpertisePrompt()` je cista funkce (frozen vystupy):

```
validate → compatibility check → sort by weight → resolve inheritance
→ merge modules (tagged, dedup) → specialist override → derive tone
→ derive temperature → trim to token budget → build prompt → enforce
```

### Enforcement pipeline

```
LLM response
  → ExpertEnforcer (forbidden phrases, min length, retry with temp decay)
  → enforceCapabilities() (5D drift: hedging, caveats, verbosity, structure)
  → logLlmExecution() (prompt hash, latency, tokens, traceId)
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

## Testy

```bash
# Expert system + merge engine (217 testu)
node tests/merge-engine.test.js           # 40
node tests/merge-compatibility.test.js    # 16
node tests/merge-enforcement-integration.test.js  # 15
node tests/capability-enforcer.test.js    # 38
node tests/execution-trace-stress.test.js # 20
node tests/expertise-wizard.test.js       # 38
node tests/expert-system.test.js          # 40
node tests/expert-integration.test.js     # 10

# CRE + core
node tests/cre-comprehensive.test.js      # 401
node tests/notifications.test.js          # 67
node tests/workflow.test.js               # 42
node tests/trust-feedback.test.js         # 34
node tests/v583-tier1.test.js             # 94

# Konverzacni testy (vyzaduje Ollama + GPU)
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

## Dalsi dokumentace

- [CLAUDE.md](../CLAUDE.md) — development context pro AI asistenty
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) — architektura v63.3
- [docs/CHANGELOG.md](CHANGELOG.md) — changelog (v56.2 → v63.3)
- [C3-STUDIO-IDE.md](../c3-ide/docs/C3-STUDIO-IDE.md) — IDE dokumentace
- [C3-Merge-Engine-v2-FINAL.md](C3-Merge-Engine-v2-FINAL.md) — merge engine specifikace
