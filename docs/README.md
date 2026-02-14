# C3-Agent v64.0

Conversational AI platforma s CRE decision enginem, CRE Gatekeeper audit trail, 15 domain experty s 5D capability profily, multi-expertise merge enginem, enforcement pipeline, execution trace observability a C3 Studio IDE (Theia 1.65.2).

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

---

## Dokumentace

### Architektura & Design

| Dokument | Popis |
|----------|-------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kompletni architektura platformy (v64.0) |
| [AUTHORITY.md](AUTHORITY.md) | Authority chain: User > HumanGate > CRE > Planner > Executor > Tool |
| [OPERABILITY.md](OPERABILITY.md) | Operacni kontrakty: immutabilita, determinismus, replay |

### Subsystemy

| Dokument | Popis |
|----------|-------|
| [EXPERTS.md](EXPERTS.md) | Expert Layer — 15 expertu, 5D capability profily, Merge Engine v2, enforcement pipeline |
| [SPECIALISTS.md](SPECIALISTS.md) | Specialist system — Accountant (deterministicke nastroje), budouci specialiste |
| [WORKERS.md](WORKERS.md) | Worker agenty — Runner, Scheduler, zdroje, podminky, triggery, notifikace |

### Planovani & Vyvoj

| Dokument | Popis |
|----------|-------|
| [ROADMAP.md](ROADMAP.md) | Aktualni roadmapa v5 (stav k v64.0) |
| [CHANGELOG.md](CHANGELOG.md) | Changelog (v56.2 → v64.0) |
| [dev-checklist.md](dev-checklist.md) | Development checklist |

### Specifikace & Reference

| Dokument | Popis |
|----------|-------|
| [C3-Merge-Engine-v2-FINAL.md](C3-Merge-Engine-v2-FINAL.md) | Merge Engine specifikace (853 radku) |
| [C3-Merge-Engine-v2-deltapatch.md](C3-Merge-Engine-v2-deltapatch.md) | Delta patch (5 fixu z review) |
| [C3-Phase-C-Lifecycle-Plan.md](C3-Phase-C-Lifecycle-Plan.md) | Project Lifecycle plan |
| [CHAT-QUALITY-v62.md](CHAT-QUALITY-v62.md) | E2E quality testy (36 scenaru) |
| [openapi.yaml](openapi.yaml) | OpenAPI specifikace |

### IDE

| Dokument | Popis |
|----------|-------|
| [C3-STUDIO-IDE.md](../c3-ide/docs/C3-STUDIO-IDE.md) | C3 Studio IDE dokumentace |
| [C3-STUDIO-ROADMAP.md](../c3-ide/docs/C3-STUDIO-ROADMAP.md) | IDE integration roadmap |

### Dalsi

| Dokument | Popis |
|----------|-------|
| [CLAUDE.md](../CLAUDE.md) | Development context pro AI asistenty |
| [golden-path.md](golden-path.md) | Golden path dokumentace |
| [Phase-F-README.md](Phase-F-README.md) | Packaging & ochrana (Docker, licence, auto-update) |

---

## Struktura projektu

```
c3-agent-wip/
├── src/
│   ├── server.js                  # Express HTTP server (port 3335)
│   ├── config.js                  # Konfigurace
│   ├── chat/
│   │   ├── controller.js          # ChatController — vstupni bod
│   │   ├── cre-decision.js        # CRE klasifikace + Gatekeeper (v64.0)
│   │   ├── conversation-store.js  # Session persistence (SQLite)
│   │   └── handlers/
│   │       ├── conversation.js    # ConversationHandler — routing
│   │       ├── clarification.js   # Clarification resolution (v64.0)
│   │       ├── expert.js          # Expert handler — single + merge path
│   │       ├── decisions.js       # Decision sub-handlers
│   │       └── utils/
│   │           ├── synthesis.js   # LLM synteza + Output Gate (D6)
│   │           ├── followup.js    # Follow-up detection (v64.0)
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
│   ├── agents/                    # Agent platform (worker agenty)
│   │   ├── runner.js              # Execution engine
│   │   ├── scheduler.js           # Cron/interval scheduling
│   │   ├── conditions.js          # Deterministic evaluator
│   │   ├── triggers.js            # Edge detection
│   │   └── sources/               # Data sources (RSS, HTTP)
│   ├── llm/
│   │   ├── gateway.js             # LLM Gateway + auth
│   │   ├── client.js              # Ollama klient
│   │   ├── cre-bridge.js          # CRE ↔ LLM bridge
│   │   └── web-search.js          # Web search tool
│   ├── planner/                   # BUILD pipeline (D1→CODE→R2→D2/R1)
│   ├── notifications/             # Trust feedback loop
│   ├── executor/                  # Tool execution + circuit breaker
│   ├── memory/                    # Session + LTM memory
│   ├── db/
│   │   ├── database.js            # SQLite schema (28+ tables)
│   │   └── migrations/            # 5 migracnich souboru (v64.0)
│   ├── ws-bridge/                 # IDE WebSocket bridge
│   └── core/                      # Logger, error handling
│
├── c3-ide/                        # C3 Studio IDE — Theia 1.65.2
│   ├── extensions/c3-chat-panel/  # Chat panel + transport layer
│   ├── extensions/c3-center-views/ # Center views + Expertise Wizard
│   ├── extensions/c3-detail-panel/ # Detail panel s capability bars
│   └── docs/                      # IDE dokumentace
│
├── tests/                         # ~50 testovych souboru (~1160 testu)
├── e2e/                           # E2E framework + runner
└── docs/                          # Dokumentace (tento adresar)
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
# CRE + Gatekeeper (444 testu)
node tests/cre-comprehensive.test.js      # 401
node tests/cre-gatekeeper.test.js          # 43

# Expert system + merge engine (217 testu)
node tests/merge-engine.test.js            # 40
node tests/merge-compatibility.test.js     # 16
node tests/merge-enforcement-integration.test.js  # 15
node tests/capability-enforcer.test.js     # 38
node tests/execution-trace-stress.test.js  # 20
node tests/expertise-wizard.test.js        # 38
node tests/expert-system.test.js           # 40
node tests/expert-integration.test.js      # 10

# Schema migrations
node tests/schema-migrations.test.js       # 26

# Core
node tests/notifications.test.js           # 67
node tests/workflow.test.js                # 42
node tests/trust-feedback.test.js          # 34
node tests/v583-tier1.test.js              # 94

# Konverzacni testy (vyzaduje Ollama + GPU)
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

---

*Posledni aktualizace: v64.0 (2026-02-14)*
