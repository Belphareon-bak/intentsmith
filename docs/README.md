# C3-Agent v81.0.0

Conversational AI platforma s CRE decision enginem, CRE Gatekeeper audit trail, 15 domain expertyzami s 5D capability profily, multi-expertise merge enginem, enforcement pipeline, resilience layer (circuit breaker, auto-retry, telemetry), quality score engine, Project Lifecycle a C3 Studio IDE (Theia 1.65.2).

## Spusteni

```bash
# 1. Instalace zavislosti
npm install

# 2. Konfigurace (volitelne — defaulty funguji out-of-the-box)
cp .env.example .env
# Uprav .env podle potreby (modely, porty, notifikace...)

# 3. Spusteni backendu
node src/server.js
# → http://127.0.0.1:3335
# → Chat UI: http://127.0.0.1:3335/architect

# 4. Spusteni IDE (volitelne)
cd c3-ide && yarn && yarn build && yarn start
```

### Prerekvizity

- Node.js 22+ (doporuceno) / 18+ (minimum)
- Ollama s modelem `qwen2.5:32b` na `http://127.0.0.1:11434`
- Python 3 + build-essential (kompilace better-sqlite3)
- Kompletni instalacni prirucka: [INSTALL.md](INSTALL.md)

### Konfigurace (.env)

Vsechny promenne se nacitaji z `.env` souboru pres `dotenv`. Viz `.env.example` pro kompletni referenci.

| Skupina | Promenne | Popis |
|---------|----------|-------|
| Server | `C3_PORT`, `C3_HOST`, `C3_CORS_ORIGINS` | HTTP server |
| Modely | `C3_MODEL_D1`, `C3_MODEL_D2`, `C3_MODEL_CODE`, `C3_MODEL_R1`, `C3_MODEL_R2`, `C3_MODEL_CHAT`, `C3_MODEL_VISION` | Ollama modely pro jednotlive role |
| Ollama | `OLLAMA_URL` | Adresa Ollama serveru |
| Features | `C3_ENABLE_AGENTS`, `C3_ENABLE_LIFECYCLE`, `C3_ENABLE_EXPERTISES`, `C3_ENABLE_TELEMETRY` | Zapnuti/vypnuti modulu |
| Databaze | `C3_DB_PATH` | Cesta k SQLite souboru |
| Lifecycle | `C3_LIFECYCLE_REVIEW_FREQ`, `C3_MAX_MILESTONE_LOC`, `C3_MAX_MILESTONE_FILES` | Nastaveni projektu |
| Notifikace | `C3_SMTP_*`, `C3_TELEGRAM_*`, `C3_NTFY_*` | Email, Telegram, push kanaly |
| Security | `C3_ADMIN_TOKEN`, `C3_LICENSE_KEY` | Autentizace a licence |
| Debug | `C3_LOG_LEVEL`, `C3_TRACE` | Logovani a trasovani |

---

## Dokumentace

### Architektura & Design

| Dokument | Popis |
|----------|-------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kompletni architektura platformy |
| [AUTHORITY.md](AUTHORITY.md) | Authority chain: User > HumanGate > CRE > Planner > Executor > Tool |
| [OPERABILITY.md](OPERABILITY.md) | Operacni kontrakty: immutabilita, determinismus, replay |

### Subsystemy

| Dokument | Popis |
|----------|-------|
| [EXPERTISES.md](EXPERTISES.md) | Expertise Layer — 15 expertyz, 5D capability profily, Merge Engine v2, enforcement pipeline |
| [SPECIALISTS.md](SPECIALISTS.md) | Specialist system — runtime, knowledge base, scenario engine |
| [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md) | Specialist plugin lifecycle |
| [WORKERS.md](WORKERS.md) | Worker agenty — Runner, Scheduler, zdroje, podminky, triggery, notifikace |
| [EXECUTOR_CONTRACT.md](tools/EXECUTOR_CONTRACT.md) | Tool executor kontrakt (circuit breaker, retry, partial failure) |

### Planovani & Vyvoj

| Dokument | Popis |
|----------|-------|
| [ROADMAP.md](ROADMAP.md) | Aktualni roadmapa v12 (stav k v81) |
| [CHANGELOG.md](CHANGELOG.md) | Changelog |
| [dev-checklist.md](dev-checklist.md) | Development checklist |

### Specifikace & Reference

| Dokument | Popis |
|----------|-------|
| [C3-Merge-Engine-v2-FINAL.md](C3-Merge-Engine-v2-FINAL.md) | Merge Engine specifikace (853 radku) |
| [C3-Phase-C-Lifecycle-Plan.md](C3-Phase-C-Lifecycle-Plan.md) | Project Lifecycle plan |
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
│   ├── server.js                  # HTTP server (port 3335)
│   ├── config.js                  # Konfigurace + feature flags
│   ├── chat/
│   │   ├── controller.js          # ChatController — vstupni bod
│   │   ├── cre-decision.js        # CRE klasifikace + Gatekeeper (v64.0)
│   │   ├── conversation-store.js  # Session persistence (SQLite)
│   │   └── handlers/
│   │       ├── conversation.js    # ConversationHandler — routing
│   │       ├── clarification.js   # Clarification resolution
│   │       ├── expertise.js       # Expertise handler — single + merge path
│   │       ├── decisions.js       # Decision sub-handlers
│   │       └── utils/
│   │           ├── synthesis.js   # LLM synteza + Output Gate
│   │           ├── followup.js    # Follow-up detection
│   │           ├── quality.js     # Quality evaluators
│   │           └── language-enforcement.js  # SK→CZ, EN detekce
│   ├── expertises/                # Expertise System (v63)
│   │   ├── expertise-layer.js     # 15 built-in expertises, resolveInheritance()
│   │   ├── merge-engine.js        # mergeExpertisePrompt() — 15.5-step pure function
│   │   ├── merge-compatibility.js # checkCompatibility() — 5D conflict detection
│   │   ├── capability-enforcer.js # Post-response 5D capability drift validation
│   │   └── specialist-*.js        # Specialist platform integration
│   ├── executor/                  # Tool execution (v72)
│   │   ├── tool-executor.js       # ToolExecutor — circuit breaker, auto-retry, partial failure
│   │   └── circuit-breaker.js     # Per-session circuit breaker state machine
│   ├── telemetry/                 # Observability (v81)
│   │   └── turn-telemetry.js      # TurnTelemetry — per-turn resilience data collector
│   ├── planner/                   # BUILD pipeline (D1→CODE→R2→D2/R1)
│   │   └── quality-score.js       # Deterministicky quality scoring engine (v80)
│   ├── specialists/               # Specialist plugin loader (v74)
│   ├── agents/                    # Agent platform (worker agenty)
│   ├── llm/                       # LLM gateway, Ollama client, web search
│   ├── notifications/             # Trust feedback loop (email, telegram, ntfy)
│   ├── memory/                    # Session + LTM memory
│   ├── db/
│   │   ├── database.js            # SQLite schema (58+ tables, prepared statements)
│   │   ├── migrate.js             # Migration runner
│   │   ├── telemetry-retention.js # Startup pruning (30d retention, 4 tables)
│   │   └── migrations/            # 18 migracnich souboru (v63 → v81)
│   ├── ws-bridge/                 # IDE WebSocket bridge
│   └── core/                      # Logger, error handling
│
├── c3-ide/                        # C3 Studio IDE — Theia 1.65.2
│   ├── extensions/c3-chat-panel/  # Chat panel + transport layer
│   ├── extensions/c3-center-views/ # Center views + Expertise Wizard
│   ├── extensions/c3-detail-panel/ # Detail panel s capability bars
│   └── docs/                      # IDE dokumentace
│
├── tests/                         # 87+ testovych souboru (~2100+ testu)
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
| SHELL | Prikaz v terminalu | "spust npm test", "git status" |
| FILE_READ | Cteni souboru | "precti package.json" |
| FILE_EXPLAIN | Vysvetleni souboru | "vysvetli co dela server.js" |
| ITEM_LOOKUP | Vyhledani entity | "najdi expertyzu na React" |

## Testy

```bash
# CRE + Gatekeeper (444 testu)
node tests/cre-comprehensive.test.js      # 401
node tests/cre-gatekeeper.test.js          # 43

# Expertise system + merge engine (217 testu)
node tests/merge-engine.test.js            # 40
node tests/merge-compatibility.test.js     # 16
node tests/merge-enforcement-integration.test.js  # 15
node tests/capability-enforcer.test.js     # 38
node tests/execution-trace-stress.test.js  # 20
node tests/expertise-wizard.test.js        # 38
node tests/expertise-system.test.js        # 40
node tests/expertise-integration.test.js   # 10

# Resilience + Telemetry (75 testu)
node tests/e2e-resilience.test.js          # 31
node tests/telemetry.test.js               # 31
C3_LOG_LEVEL=error node tests/telemetry-soak.test.js  # 13 (1000 turns)

# Quality Score (70 testu)
node tests/quality-score.test.js           # 36
node tests/quality-telemetry.test.js       # 34

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

*Posledni aktualizace: v81.0.0 (2026-02-25)*
