# C3-Agent v124.0.0 — Dokumentacni reference

Kompletni dokumentace projektu C3 Agent — lokalni AI platforma s CRE decision enginem, 15 domain expertyzami, specialist plugin systemem, lifecycle project managementem, skills workflow enginem, autonomnimi agenty, LTM pametovym systemem a C3 Studio IDE (Theia 1.65.2 + Electron 37).

---

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
- Ollama s modelem `qwen3.5:27b` na `http://127.0.0.1:11434`
- Python 3 + build-essential (kompilace better-sqlite3)
- GPU s 12+ GB VRAM (doporuceno pro 32B modely)
- Kompletni instalacni prirucka: [INSTALL.md](INSTALL.md)

### Konfigurace (.env)

Vsechny promenne se nacitaji z `.env` souboru pres `dotenv`. Viz `.env.example` pro kompletni referenci (113 promennych).

| Skupina | Promenne | Popis |
|---------|----------|-------|
| Server | `C3_PORT`, `C3_HOST`, `C3_CORS_ORIGINS` | HTTP server |
| Modely | `C3_MODEL_D1`, `C3_MODEL_D2`, `C3_MODEL_CODE`, `C3_MODEL_R1`, `C3_MODEL_R2`, `C3_MODEL_CHAT`, `C3_MODEL_VISION` | Ollama modely pro 6 roli |
| Ollama | `OLLAMA_URL` | Adresa Ollama serveru |
| Features | `C3_ENABLE_AGENTS`, `C3_ENABLE_LIFECYCLE`, `C3_ENABLE_EXPERTISES`, `C3_ENABLE_TELEMETRY`, `C3_ENABLE_SKILLS` | Zapnuti/vypnuti modulu |
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
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kompletni architektura platformy (781 radku) |
| [AUTHORITY.md](AUTHORITY.md) | Authority chain: User > HumanGate > CRE > Planner > Executor > Tool |
| [OPERABILITY.md](OPERABILITY.md) | Operacni kontrakty: immutabilita, determinismus, replay |
| [STORAGE-ARCHITECTURE.md](STORAGE-ARCHITECTURE.md) | SQLite schema (58 tabulek), drain pipeline, WAL, backup, retention |

### Moduly & Subsystemy

| Dokument | Popis |
|----------|-------|
| [EXPERTISES.md](EXPERTISES.md) | Expertise Layer — 15 expertyz, 5D capability profily, Merge Engine v2, enforcement pipeline |
| [SPECIALISTS.md](SPECIALISTS.md) | Specialist system — runtime, knowledge base, scenario engine, memory |
| [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md) | Specialist plugin lifecycle (registrace, activace, teardown) |
| [WORKERS.md](WORKERS.md) | Worker agenty — Runner, Scheduler, zdroje, podminky, triggery, notifikace |
| [skills-v1.md](skills-v1.md) | Skills system — 8 step types, state machine, sandboxed execution, meta-skill |
| [autonomy-v1.md](autonomy-v1.md) | Autonomni vrstva — drift detection, confidence aggregator, self-tuning |
| [TELEMETRY.md](TELEMETRY.md) | Turn telemetrie, specialist telemetrie, 30d retention |

### Nastroje & Bezpecnost

| Dokument | Popis |
|----------|-------|
| [tools/EXECUTOR_CONTRACT.md](tools/EXECUTOR_CONTRACT.md) | Tool executor kontrakt (circuit breaker, retry, partial failure) |
| [tools/REGISTRY.md](tools/REGISTRY.md) | Tool Registry — 153 nastroju, capability metadata, risk classification, API reference |

### Planovani & Vyvoj

| Dokument | Popis |
|----------|-------|
| [ROADMAP.md](ROADMAP.md) | Aktualni roadmapa v17 (stav k v124) |
| [CHANGELOG.md](CHANGELOG.md) | Changelog (v56–v124) |
| [dev-checklist.md](dev-checklist.md) | Development checklist |

### Specifikace & Reference

| Dokument | Popis |
|----------|-------|
| [C3-Merge-Engine-v2-FINAL.md](C3-Merge-Engine-v2-FINAL.md) | Merge Engine specifikace (853 radku, 15.5-step algoritmus) |
| [C3-Phase-C-Lifecycle-Plan.md](C3-Phase-C-Lifecycle-Plan.md) | Project Lifecycle design (SPEC→BUILD→REVIEW→CHANGE) |
| [followup-contract-v2.md](followup-contract-v2.md) | Follow-up klasifikace, R1-R4 pravidla |
| [accounting-engine-roadmap.md](accounting-engine-roadmap.md) | Ucetni engine roadmapa (ledger, DPH, dane, compliance) |
| [OAUTH-DEVICE-PLAN.md](OAUTH-DEVICE-PLAN.md) | OAuth (Google/GitHub) + mobilni device pairing plan (v94) |

### IDE

| Dokument | Popis |
|----------|-------|
| [C3-STUDIO-IDE.md](../c3-ide/docs/C3-STUDIO-IDE.md) | C3 Studio IDE dokumentace |
| [C3-STUDIO-ROADMAP.md](../c3-ide/docs/C3-STUDIO-ROADMAP.md) | IDE integration roadmap |

### Dalsi

| Dokument | Popis |
|----------|-------|
| [CLAUDE.md](../CLAUDE.md) | Development context pro AI asistenty |
| [Phase-F-README.md](Phase-F-README.md) | Packaging & ochrana (Docker, licence, auto-update) |
| [chat-quality-definition.md](chat-quality-definition.md) | Chat quality definice a metriky |
| [channels/CHANNEL_ADAPTER_CONTRACT.md](channels/CHANNEL_ADAPTER_CONTRACT.md) | CLI/channel adapter kontrakt |

---

## Struktura projektu

```
c3-agent-wip/
├── src/                              # Backend (282 souboru)
│   ├── server.js                     # Entry point — HTTP server (port 3335)
│   ├── config.js                     # Konfigurace + feature flags
│   │
│   ├── chat/                         # CRE engine + handlery
│   │   ├── controller.js             # ChatController — vstupni bod
│   │   ├── cre-decision.js           # CRE klasifikace + Gatekeeper (2,900 ř.)
│   │   ├── cre-routing-patches.js    # CRE routing patches
│   │   ├── conversation-store.js     # Session persistence (SQLite)
│   │   ├── context-budget.js         # Context token budget management
│   │   ├── context-compact.js        # Context compaction
│   │   ├── ltm-context.js            # LTM injection do kontextu
│   │   ├── export-pipeline.js        # Export konverzaci (md, html, pdf, docx)
│   │   ├── handlers/                 # Intent handlery
│   │   │   ├── conversation.js       # ConversationHandler — hlavni routing
│   │   │   ├── clarification.js      # Clarification resolution
│   │   │   ├── expertise.js          # Expertise handler — single + merge path
│   │   │   ├── decisions.js          # Decision sub-handlers (5,700 ř.)
│   │   │   ├── project.js            # Project handler (sticky mode)
│   │   │   ├── specialist.js         # Specialist handler
│   │   │   ├── skill.js              # Skill execution handler
│   │   │   ├── lifecycle-router.js   # Lifecycle routing (3,500 ř.)
│   │   │   ├── lifecycle-state.js    # Lifecycle state (RAM Map + DB write-through)
│   │   │   ├── lifecycle-handoff.js  # Lifecycle handoff
│   │   │   ├── lifecycle-formatters.js # Lifecycle UI formatting
│   │   │   ├── build-handoff.js      # BUILD handoff
│   │   │   ├── agent.js              # Agent handler
│   │   │   ├── agent-wizard.js       # Agent creation wizard
│   │   │   ├── file.js               # File handling
│   │   │   ├── design.js             # Design handler
│   │   │   ├── local.js              # LOCAL intent handler
│   │   │   └── utils/                # Handler utilities
│   │   │       ├── synthesis.js      # LLM synteza + Output Gate
│   │   │       ├── followup.js       # Follow-up detection (Contract v2)
│   │   │       ├── quality.js        # Quality evaluators
│   │   │       ├── language-enforcement.js  # SK→CZ, EN detekce
│   │   │       ├── output-gate.js    # Output quality gate
│   │   │       ├── search-retry.js   # Search retry s extraction
│   │   │       ├── search-metrics.js # Search quality metrics
│   │   │       └── ...               # 15+ utility modulu
│   │   ├── quality/                  # Quality Gate v2
│   │   │   ├── quality-pipeline.js   # 4-vrstvý pipeline
│   │   │   ├── quality-gate-v2.js    # Pravidlova validace
│   │   │   ├── relevance-filter.js   # Relevance scoring
│   │   │   ├── drift-guard.js        # Language drift detekce
│   │   │   └── ...                   # 8 quality modulu
│   │   ├── safety/                   # Safety engine
│   │   │   ├── engine.js             # Safety rule engine
│   │   │   └── policies/             # Domainove politiky (finance, health, law)
│   │   └── export/                   # Export formaty (PDF, DOCX)
│   │
│   ├── expertises/                   # Expertise System
│   │   ├── expertise-layer.js        # 15 built-in expertyz, resolveInheritance()
│   │   ├── merge-engine.js           # mergeExpertisePrompt() — 15.5-step pure function
│   │   ├── merge-compatibility.js    # checkCompatibility() — 5D conflict detection
│   │   ├── capability-enforcer.js    # Post-response 5D capability drift validation
│   │   ├── knowledge-base.js         # Knowledge base engine
│   │   ├── scenario-engine.js        # Scenario-based expertise
│   │   ├── specialist-runtime.js     # Specialist execution runtime
│   │   ├── specialist-memory.js      # Specialist per-session memory
│   │   ├── tool-adapter.js           # Tool adaptation layer
│   │   ├── guards/                   # Enforcement guards
│   │   └── ledger/                   # Financial ledger (DPH, dane, pojistne)
│   │       ├── ledger-engine.js      # Core ledger
│   │       ├── ledger-vat.js         # DPH engine
│   │       ├── ledger-compliance.js  # Compliance checks
│   │       └── ...                   # 7 ledger modulu
│   │
│   ├── planner/                      # Lifecycle + BUILD pipeline
│   │   ├── lifecycle.js              # ProjectLifecycle state machine (9,800 ř.)
│   │   ├── lifecycle-planning.js     # SPEC→PLANNING faze (25K ř.)
│   │   ├── lifecycle-build.js        # BUILD execution (35K ř.)
│   │   ├── lifecycle-prompts.js      # LLM prompty pro lifecycle (26K ř.)
│   │   ├── lifecycle-analyzer.js     # Project analysis (12K ř.)
│   │   ├── lifecycle-review.js       # REVIEW faze
│   │   ├── lifecycle-change.js       # CHANGE management
│   │   ├── milestone-size.js         # Milestone sizing heuristiky
│   │   ├── quality-score.js          # Deterministicky quality scoring (24K ř.)
│   │   ├── quality-report.js         # Quality reporting (14K ř.)
│   │   ├── workflow.js               # Build workflow engine
│   │   └── progress-tracker.js       # Progress tracking
│   │
│   ├── skills/                       # Skills System
│   │   ├── registry.js               # Skill registry (JSON files → runtime)
│   │   ├── resolver.js               # LLM-based skill resolver
│   │   ├── runner.js                 # Skill execution state machine (15K ř.)
│   │   ├── detector.js               # Workflow pattern detector
│   │   └── steps/                    # 8 step executors
│   │       ├── llm.js                # LLM generation step
│   │       ├── template.js           # Template interpolation
│   │       ├── write.js              # Sandboxed file write
│   │       ├── shell.js              # Whitelisted shell commands
│   │       ├── ask.js                # User input step
│   │       ├── review.js             # User review step
│   │       ├── validate.js           # LLM content validation
│   │       └── substitute.js         # Variable substitution
│   │
│   ├── memory/                       # Pametovy system (M1+M2+M3)
│   │   ├── long-term.js              # LTM — confidence decay, reinforcement
│   │   ├── preferences.js            # User preferences (adjustment persistence)
│   │   ├── injection-ranker.js       # M2: relevance ranking pro kontext
│   │   ├── feedback-detector.js      # M3: semantic feedback detection (6 signalu)
│   │   ├── pattern-tracker.js        # M2: cross-session pattern learning
│   │   ├── memory-bank.js            # Memory bank storage
│   │   └── policy.js                 # Memory retention policies
│   │
│   ├── agents/                       # Worker agenty
│   │   ├── runner.js                 # Agent execution runtime
│   │   ├── scheduler.js              # Cron/interval scheduling
│   │   ├── builder.js                # Agent builder (wizard output)
│   │   ├── conditions.js             # Trigger conditions
│   │   ├── triggers.js               # Trigger definitions
│   │   ├── multi-source.js           # Multi-source data aggregation
│   │   └── sources/                  # Datove zdroje (RSS, HTTP, DB)
│   │
│   ├── executor/                     # Tool execution
│   │   ├── tool-executor.js          # ToolExecutor — circuit breaker, auto-retry
│   │   ├── circuit-breaker.js        # Per-session circuit breaker state machine
│   │   ├── shell-security.js         # Shell command security validation
│   │   └── health-monitor.js         # Tool health monitoring
│   │
│   ├── llm/                          # LLM gateway
│   │   ├── gateway.js                # LLM request/response routing
│   │   ├── client.js                 # Ollama client
│   │   ├── cre-bridge.js             # CRE → LLM bridge
│   │   ├── prompts.js                # System prompts
│   │   └── web-search.js             # Web search integration
│   │
│   ├── notifications/                # Notifikacni system
│   │   ├── service.js                # Notification service (orchestrator)
│   │   ├── pipeline.js               # Notification pipeline
│   │   ├── trust.js                  # Trust scoring
│   │   ├── digest.js                 # Digest aggregation
│   │   ├── feedback.js               # User feedback loop
│   │   └── channels/                 # 7 kanalu
│   │       ├── email.js, telegram.js, ntfy.js, webhook.js
│   │       ├── desktop.js, push.js, base.js
│   │
│   ├── autonomy/                     # Autonomni vrstva
│   │   ├── controller.js             # Autonomy controller
│   │   ├── drift-detector.js         # Model/data drift detection
│   │   └── aggregator.js             # Confidence aggregation
│   │
│   ├── routes/                       # REST API (14 modulu)
│   │   ├── chat.js, projects.js, expertises.js, agents.js
│   │   ├── skills.js, specialists.js, notifications.js
│   │   ├── system.js, security.js, quality.js
│   │   ├── autonomy.js, planner.js, architect.js, misc.js
│   │
│   ├── specialists/                  # Specialist loader
│   │   └── specialist-loader.js      # Plugin loader + runtime
│   │
│   ├── db/                           # Databazova vrstva
│   │   ├── database.js               # SQLite schema (58+ tabulek, prepared statements)
│   │   ├── migrate.js                # Migration runner
│   │   ├── data-retention.js         # Tiered pruning (30d/60d/90d/180d)
│   │   └── migrations/               # 28 migracnich souboru (v59 → v92)
│   │
│   ├── ws-bridge/                    # WebSocket bridge (IDE ↔ backend)
│   │   ├── ws-server.js              # WS server
│   │   ├── session-adapter.js        # Session adapter
│   │   ├── protocol.js               # WS protocol definitions
│   │   └── file-watcher.js           # File system watcher (chokidar)
│   │
│   ├── core/                         # Core utilities
│   │   ├── logger.js                 # Structured logger
│   │   ├── error-handler.js          # Global error handler
│   │   └── feature-manager.js        # Runtime feature flags (hot-toggle)
│   │
│   ├── domains/                      # Project scaffolds
│   │   └── scaffolds/                # 8 templates (React, Vue, FastAPI, Flutter, ...)
│   │
│   ├── ui/                           # Architect web UI
│   │   └── architect/                # SPA pro browser pristup
│   │
│   ├── licensing/                    # Licence system (HW fingerprint, 3 tiery)
│   ├── packaging/                    # Auto-updater
│   ├── channels/                     # Channel adapters (CLI)
│   ├── setup/                        # Setup wizard
│   ├── system/                       # GPU detection, model compatibility
│   └── tools/                        # Tool registry + HTTP client
│
├── c3-ide/                           # C3 Studio IDE — Theia 1.65.2 + Electron 37
│   ├── extensions/                   # 33 vlastnich rozsireni
│   │   ├── c3-chat-panel/            # Chat panel + transport layer (4,000+ ř.)
│   │   ├── c3-center-views/          # Center views + Expertise Wizard
│   │   └── c3-detail-panel/          # Detail panel s capability bars
│   ├── applications/electron/        # Electron wrapper + webpack
│   └── docs/                         # IDE dokumentace
│
├── specialists/                      # Specialist balicky (pluginy)
│   └── accountant-cz/                # Ceske ucetnictvi (DPH, dane, pojistne)
│
├── skills/                           # Skill definice (JSON)
│   ├── create-skill.json             # Meta-skill pro tvorbu novych skills
│   └── create-expertise.json         # Meta-skill pro tvorbu expertyz
│
├── tests/                            # 149 testovych souboru (~2,600+ testu)
│   ├── harness.js                    # Custom ESM test harness
│   └── ...                           # Viz sekce Testy nize
│
├── docs/                             # Dokumentace (10,000+ radku, 20+ souboru)
├── data/                             # Runtime data (gitignored)
└── .env.example                      # Vzorova konfigurace (113 promennych)
```

---

## CRE Intent Routing

CRE (Conversational Reasoning Engine) klasifikuje kazdy uzivatelsky vstup a routuje na spravny handler. Gatekeeper pattern — zadny kod nemuze CRE obejit.

| Intent | Popis | Priklad |
|--------|-------|---------|
| LOCAL | Cas, datum, kalkulacka | "kolik je hodin", "5+3" |
| CONVERSATIONAL | Bezna konverzace | "jak se mas", "vysvetli mi X" |
| SEARCH | Dotazy na cerstve udaje | "pocasi v Praze", "cena bitcoinu" |
| DESIGN | Strukturovane navrhy | "navrhni architekturu pro X" |
| CREATIVE | Kreativni obsah | "napis basnicku", "vymysli pribeh" |
| BUILD / PLAN | Stavba projektu | "postav mi webovou aplikaci" |
| CODE | Inline kod | "napis funkci na X" |
| SHELL | Prikaz v terminalu | "spust npm test", "git status" |
| FILE_READ | Cteni souboru | "precti package.json" |
| FILE_EXPLAIN | Vysvetleni souboru | "vysvetli co dela server.js" |
| ITEM_LOOKUP | Vyhledani entity | "najdi expertyzu na React" |
| SKILL | Spusteni skill workflow | "vytvor fakturu" |
| TOOL_CALL | Volani nastroje | "spocitej DPH z 10000" |
| AMBIGUOUS | Nejednoznacny dotaz | "zajimalo by me..." |

9 guard pravidel: follow-up contract, attachment guard, creative override, skill detection, expertise lock, project mode, lifecycle intercept, build handoff, C4 auto-detect.

---

## Testy

```bash
# Hlavni testovaci sady
npm test                               # Core + Chat + Expertises + Lifecycle
npm run test:all                       # + Specialists + Agents + E2E

# Jednotlive moduly
npm run test:core                      # CRE, Gatekeeper, Tier-1, modules
npm run test:chat                      # Chat pipeline, fixes, output quality, persistence
npm run test:chat:synthesis            # Synthesis hardening, search quality
npm run test:expertises                # Expertise system, integration, wizard, AB quality
npm run test:lifecycle                 # Lifecycle, DB, build, invariants, handoff
npm run test:lifecycle:e2e             # E2E lifecycle (vyzaduje Ollama)
npm run test:lifecycle:projects        # Project lifecycle (5 projects, vyzaduje Ollama)
npm run test:specialists               # Specialist runtime, loader, tools, routing
npm run test:agents                    # Agent runner, sources, wizard, multi-source
npm run test:workflow                  # Workflow, orchestrator, build patterns/intent
npm run test:merge                     # Merge engine, compatibility, enforcement
npm run test:capability                # Capability enforcer, sandbox
npm run test:ledger                    # Ledger core, VAT, annual, insurance, compliance, reports
npm run test:knowledge                 # Knowledge base, scenario engine
npm run test:design                    # Design tests
npm run test:quality                   # Quality sprint, idempotence, output gate
npm run test:notifications             # Notifications, push channel, trust feedback
npm run test:db                        # Schema migrations, execution trace, session context, archive
npm run test:e2e                       # E2E pipeline, complex, resilience, workers, notifications, specialists
npm run test:security                  # Security hardening
npm run test:ws                        # WebSocket bridge
npm run test:conv                      # Konverzacni testy CZ/EN/no-diacritics (vyzaduje Ollama)

# Jednotlive testy
node tests/cre-comprehensive.test.js   # CRE klasifikace (401 testu)
node tests/lifecycle.test.js           # Lifecycle state machine (103 testu)
node tests/specialist-runtime.test.js  # Specialist runtime
node tests/chat-pipeline.test.js       # Chat pipeline E2E
```

Testy pouzivaji custom ESM harness (`tests/harness.js`): `suite()`, `test()`, `testAsync()`, `assert()`, `assertEqual()`.

### Konverzacni testy (vyzaduji Ollama + GPU)

```bash
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech.test.js
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-english.test.js
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

---

## REST API

Backend vystavi REST API na `http://127.0.0.1:3335`:

| Prefix | Modul | Popis |
|--------|-------|-------|
| `/api/chat` | Chat | Konverzace, zpravy, export (md, html, pdf, docx) |
| `/api/projects` | Projects | Projekty, lifecycle, roadmapa, milestones |
| `/api/expertises` | Expertises | CRUD, merge preview, schema, discovery |
| `/api/agents` | Agents | CRUD, dry-run, scheduling (PRO+) |
| `/api/skills` | Skills | CRUD, reload, execution, meta-skill |
| `/api/specialists` | Specialists | Enable/disable, discovery, memory |
| `/api/notifications` | Notifications | Kanaly, test, trust, digest |
| `/api/system` | System | Health, storage, GPU, backup, info |
| `/api/security` | Security | Audit, tokeny, sessions |
| `/api/settings` | Settings | Uzivatelska nastaveni, feature flags |
| `/api/quality` | Quality | Quality reports, telemetrie |
| `/api/planner` | Planner | Workflow, build status |
| `/api/autonomy` | Autonomy | Drift status, thresholds |

WebSocket na stejnem portu — IDE ↔ backend real-time komunikace (chat streaming, agent log, terminal, file watch, settings sync).

---

## Licence

System licenci vazany na hardware fingerprint (3 tiery: FREE / PRO / ENTERPRISE). Offline validace — zadny license server.

| Tier | Projekty | Agenti | Specialiste | Export |
|------|----------|--------|-------------|--------|
| FREE | 1 | - | - | md, txt |
| PRO | neomezene | ano | ano | md, txt, html, pdf, docx |
| ENTERPRISE | neomezene | ano | ano | vse + multi-user |

---

*Posledni aktualizace: v124.0.0 (2026-03-12)*
