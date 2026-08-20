# IntentSmith v136.0.0 — dokumentační reference

> **⚠️ Historický, neautoritativní dokument.** Zachovává dobovou instalační a
> produktovou dokumentaci C3/IntentSmith v136. Aktivní produkt, pořadí práce a
> změřený stav určují [`../PRODUCT.md`](../PRODUCT.md),
> [`../ROADMAP.md`](../ROADMAP.md) a [`../SYSTEM-MAP.md`](../SYSTEM-MAP.md).
> Release evidence v `convergence/` zůstává historickým důkazem, nikoliv
> instrukcí pro běžný vývoj.

Dokumentace projektu IntentSmith, C3-derived offline-first AI platformy s CRE
decision enginem, domain expertízami, specialist plugin systémem, lifecycle
project managementem, skills workflow enginem, autonomními agenty, LTM pamětí
a zachovaným C3 Studio IDE.

> **Stav: Gate 0 — kandidát důvěryhodné baseline.** Autoritativní verdikt je
> pouze v generovaném [convergence/STATUS.md](convergence/STATUS.md).
> Dokumentace popisuje *zamýšlené* chování zděděné z C3, ne ověřené. Žádná
> z 30 schopností nemá aktuální akceptační důkaz. Autorita pro verdikty:
> [convergence/GATE-CRITERIA.md](convergence/GATE-CRITERIA.md). Aktuální stav:
> [convergence/STATUS.md](convergence/STATUS.md). Směr: [ROADMAP.md](ROADMAP.md).
>
---

## Spuštění

```bash
# 1. Kanonicka instalace backendu i C3 Studio
./scripts/install.sh --minimal

# 2. Kanonicke mapovani portu a modelu
cp .env.example .env
# Uprav .env podle potreby (modely, porty, notifikace...)

# 3. Modelovy artefakt (--minimal modely nestahuje)
ollama pull qwen3.5:27b

# 4. Spusteni backendu a C3 Studio
./scripts/run.sh
```

Kanonický installer zahrnuje frozen závislosti, hash-locked PDF runtime,
Electron ABI rebuild, Theia build a smoke test nativních artefaktů. Ruční
`npm ci` nebo `yarn build` není ekvivalent plné instalace. Ollama tagy jsou
proměnlivé; auditní evidence musí zaznamenat skutečný modelový digest.

### Prerekvizity

- Node.js 22.x (povinné)
- npm 10.9.4 (uzamčená backend instalace)
- Ollama s modelem `qwen3.5:27b` na `http://127.0.0.1:11434`
- CPython 3.12 + `venv`, glibc 2.27+ a DejaVu fonty (PDF export)
- build-essential (kompilace native Node modulů)
- Yarn 1.22.22 (pouze C3 Studio)
- GPU s 12+ GB VRAM (doporučeno pro 32B modely)
- Kompletní instalační příručka: [INSTALL.md](INSTALL.md)

### Konfigurace (.env)

Všechny proměnné se načítají z `.env` souboru přes `dotenv`. Viz
`.env.example` pro kanonickou referenci.

Produkční entrypoint nastaví výchozí projektovou databázi explicitně po načtení
`.env`. Přímý import `src/db/database.js` bez `C3_DB_PATH` záměrně selže dříve,
než může vytvořit nebo otevřít operátorovu databázi; testovací runner každé sadě
předává vlastní izolovanou cestu.

| Skupina | Proměnné | Popis |
|---------|----------|-------|
| Server | `C3_PORT`, `C3_HOST`, `C3_CORS_ORIGINS` | HTTP server |
| Modely | `C3_MODEL_D1`, `C3_MODEL_D2`, `C3_MODEL_CODE`, `C3_MODEL_R1`, `C3_MODEL_R2`, `C3_MODEL_CHAT`, `C3_MODEL_VISION` | Ollama modely pro 7 rolí |
| Ollama | `OLLAMA_URL` | Adresa Ollama serveru |
| Features | `C3_ENABLE_AGENTS`, `C3_ENABLE_LIFECYCLE`, `C3_ENABLE_EXPERTISES`, `C3_ENABLE_TELEMETRY`, `C3_ENABLE_SKILLS` | Zapnutí/vypnutí modulů |
| Databáze | `C3_DB_PATH` | Cesta k SQLite souboru |
| Model Universe | `C3_MODEL_UNIVERSE_ENABLED`, `C3_MODEL_RUNTIME_GUARD_ENABLED`, `C3_MODEL_RUNTIME_GUARD_DISABLE_ERROR_RATE`, `C3_MODEL_RUNTIME_GUARD_RECOVER_ERROR_RATE`, `C3_MODEL_RUNTIME_GUARD_COOLDOWN_MS` | Universe ingest + runtime safety guard |
| Lifecycle | `C3_LIFECYCLE_REVIEW_FREQ`, `C3_MAX_MILESTONE_LOC`, `C3_MAX_MILESTONE_FILES` | Nastavení projektu |
| Notifikace | `C3_SMTP_*`, `C3_TELEGRAM_*`, `C3_NTFY_*` | Email, Telegram, push kanály |
| Security | `C3_ADMIN_TOKEN`, `C3_LICENSE_KEY` | Autentizace a licence |
| Debug | `C3_LOG_LEVEL`, `C3_TRACE` | Logování a trasování |

---

## Dokumentace

### Architektura & Design

| Dokument | Popis |
|----------|-------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kompletní architektura platformy |
| [AUTHORITY.md](AUTHORITY.md) | Authority chain: User > HumanGate > CRE > Planner > Executor > Tool |
| [OPERABILITY.md](OPERABILITY.md) | Operační kontrakty: immutabilita, determinismus, replay |
| [STORAGE-ARCHITECTURE.md](STORAGE-ARCHITECTURE.md) | SQLite schema, drain pipeline, WAL, backup, retention |

### Moduly & Subsystemy

| Dokument | Popis |
|----------|-------|
| [EXPERTISES.md](EXPERTISES.md) | Expertise Layer — 15 expertýz, 5D capability profily, Merge Engine v2, enforcement pipeline |
| [SPECIALISTS.md](SPECIALISTS.md) | Specialist system — runtime, knowledge base, scenario engine, memory |
| [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md) | Specialist plugin lifecycle (registrace, activace, teardown) |
| [WORKERS.md](WORKERS.md) | Worker agenty — Runner, Scheduler, zdroje, podmínky, triggery, notifikace |
| [skills-v1.md](skills-v1.md) | Skills system — 8 step types, state machine, sandboxed execution, meta-skill |
| [MEMORY.md](MEMORY.md) | Paměťový systém — LTM decay, injection ranker, pattern tracker, task memory |
| [NOTIFICATIONS.md](NOTIFICATIONS.md) | Notifikační systém — 6 kanálů, trust scoring, digest |
| [PROJECT-SYSTEM.md](PROJECT-SYSTEM.md) | Projektový lifecycle — SPEC→BUILD→REVIEW→CHANGE |
| [marketplace.md](marketplace.md) | Marketplace — specialist balíčky, distribuce, instalace |

### Nástroje & Bezpečnost

| Dokument | Popis |
|----------|-------|
| [tools/EXECUTOR_CONTRACT.md](tools/EXECUTOR_CONTRACT.md) | Tool executor kontrakt (circuit breaker, retry, partial failure) |
| [tools/REGISTRY.md](tools/REGISTRY.md) | Tool Registry — 153 nástrojů, capability metadata, risk classification, API reference |

### Plánování & Vývoj

| Dokument | Popis |
|----------|-------|
| [ROADMAP.md](ROADMAP.md) | **Roadmapa 1.0** — gate ladder, evidenční stav pilířů, směr IntentSmithu |
| [CHANGELOG.md](CHANGELOG.md) | Changelog (v56–v136) |
| [MODEL-PLATFORM-HANDOFF.md](MODEL-PLATFORM-HANDOFF.md) | **Souhrn stavu** scoringu a hledání modelů, otevřené body |
| [MODEL-SCORING-ACTIVATION.md](MODEL-SCORING-ACTIVATION.md) | Scoring modelů: zdroje dat, jejich meze, aktivace |
| [MODEL-UPGRADE-HUNT.md](MODEL-UPGRADE-HUNT.md) | Hledání lepších modelů: trychtýř, měření VRAM, párový souboj |
| [dev-checklist.md](dev-checklist.md) | Development checklist |
| [archive/ROADMAP-v17-C3.md](archive/ROADMAP-v17-C3.md) | archiv — původní C3 roadmapa v17 (tvrzení o hotovosti neplatná) |

### Konvergence & Gate 0

Autoritativní stav obnovy baseline. Tyto dokumenty přebíjejí popisná tvrzení
ve zbytku dokumentace.

| Dokument | Popis |
|----------|-------|
| [convergence/GATE-CRITERIA.md](convergence/GATE-CRITERIA.md) | **normativní definice verdiktů** — co znamená PASS / CONDITIONAL PASS / FAIL |
| [convergence/STATUS.md](convergence/STATUS.md) | který verdikt platí a ke kterému commitu (generovaný) |
| [convergence/CAPABILITY-MATRIX.md](convergence/CAPABILITY-MATRIX.md) | evidenční stav 30 schopností |
| [convergence/RISK-REGISTER.md](convergence/RISK-REGISTER.md) | otevřená rizika a jejich mitigace |
| [convergence/GATE0-REVIEW-FINDINGS-FOLLOWUP.md](convergence/GATE0-REVIEW-FINDINGS-FOLLOWUP.md) | dispozice pěti nálezů nezávislého review a hranice jejich platnosti |
| [convergence/DECISIONS.md](convergence/DECISIONS.md) | uzamčená rozhodnutí + čekající operátorská |
| [convergence/FINAL-COMMIT-DISPOSITION.md](convergence/FINAL-COMMIT-DISPOSITION.md) | dispozice 225 záznamů `a7b90e3..ffd21cf` |
| [convergence/TEST-REGISTRY.md](convergence/TEST-REGISTRY.md) | generovaný ledger 350 testovacích programů a 8 explicitních support výjimek |
| [convergence/PRIVACY-INCIDENT.json](convergence/PRIVACY-INCIDENT.json) | evidence potvrzené privacy kompromitace |

### Kontrakty & Protokoly

| Dokument | Popis |
|----------|-------|
| [followup-contract-v2.md](followup-contract-v2.md) | Follow-up klasifikace, R1-R4 pravidla (aktivní kontrakt v kódu) |
| [API-REFERENCE.md](API-REFERENCE.md) | REST API reference (~200 endpointů) |
| [WS-PROTOCOL.md](WS-PROTOCOL.md) | WebSocket protokol — streaming, agent log, file watch |
| [security/LEGACY-LISTENER-BOUNDARY.md](security/LEGACY-LISTENER-BOUNDARY.md) | fail-closed loopback hranice legacy API a `/c3/ws` |

### IDE

| Dokument | Popis |
|----------|-------|
| [C3-STUDIO-IDE.md](../c3-ide/docs/C3-STUDIO-IDE.md) | C3 Studio IDE dokumentace |
| [C3-STUDIO-ROADMAP.md](../c3-ide/docs/C3-STUDIO-ROADMAP.md) | IDE integration roadmap |

### Další

| Dokument | Popis |
|----------|-------|
| [INSTALL.md](INSTALL.md) | Kompletní instalační příručka |
| [CLAUDE.md](../CLAUDE.md) | Development context pro AI asistenty |
| [channels/CHANNEL_ADAPTER_CONTRACT.md](channels/CHANNEL_ADAPTER_CONTRACT.md) | CLI/channel adapter kontrakt |

### Archiv

Historické design dokumenty, implementované RFC a point-in-time audity jsou v
[`archive/`](archive/).

---

## Struktura projektu

```
intentsmith/
├── src/                              # Backend
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
│   │   └── migrations/               # 46 migracnich souboru (v63 → v138)
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
│   ├── extensions/                   # 32 vlastnich rozsireni
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
├── tests/                            # Kanonicky registr 263 testovacich programu
│   ├── harness.js                    # Custom ESM test harness
│   └── ...                           # Viz sekce Testy nize
│
├── docs/                             # Aktivni dokumentace + archiv
├── data/                             # Runtime data (gitignored)
└── .env.example                      # Vzorova konfigurace
```

---

## CRE Intent Routing

CRE (Conversational Reasoning Engine) klasifikuje každý uživatelský vstup a routuje na správný handler. Gatekeeper pattern — žádný kód nemůže CRE obejít.

| Intent | Popis | Příklad |
|--------|-------|---------|
| LOCAL | Čas, datum, kalkulačka | "kolik je hodin", "5+3" |
| CONVERSATIONAL | Běžná konverzace | "jak se máš", "vysvětli mi X" |
| SEARCH | Dotazy na čerstvé údaje | "počasí v Praze", "cena bitcoinu" |
| DESIGN | Strukturované návrhy | "navrhni architekturu pro X" |
| CREATIVE | Kreativní obsah | "napiš básničku", "vymysli příběh" |
| BUILD / PLAN | Stavba projektu | "postav mi webovou aplikaci" |
| CODE | Inline kód | "napiš funkci na X" |
| SHELL | Příkaz v terminálu | "spusť npm test", "git status" |
| FILE_READ | Čtení souboru | "přečti package.json" |
| FILE_EXPLAIN | Vysvětlení souboru | "vysvětli co dělá server.js" |
| ITEM_LOOKUP | Vyhledání entity | "najdi expertýzu na React" |
| SKILL | Spuštění skill workflow | "vytvoř fakturu" |
| TOOL_CALL | Volání nástroje | "spočítej DPH z 10000" |
| AMBIGUOUS | Nejednoznačný dotaz | "zajímalo by mě..." |

9 guard pravidel: follow-up contract, attachment guard, creative override, skill detection, expertise lock, project mode, lifecycle intercept, build handoff, C4 auto-detect.

---

## Testy

```bash
# Kanonicky registr a povinne deterministicke profily
npm run test:registry                  # 263 registrovanych programu
npm test                               # profily offline + database

# Historicky kompatibilni agregator; neni release dukaz
npm run test:all

# Kuratorovane kompatibilni prikazy pro vyvoj
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

# Lokalni real-model subset; cely model profil ma dalsi hard blockers
node scripts/nightly-audit.js \
  --suite=IS-T3-TESTS-LLM-INTEGRATION-TEST,IS-T3-TESTS-LLM-INTEGRATION-2-TEST,IS-T3-TESTS-EXPERTISE-AB-QUALITY-TEST \
  --allow-blocker=ollama,gpu

# Jednotlive testy
node tests/cre-comprehensive.test.js   # CRE klasifikace
node tests/lifecycle.test.js           # Lifecycle state machine
node tests/specialist-runtime.test.js  # Specialist runtime
node tests/chat-pipeline.test.js       # Chat pipeline E2E
```

Kanonický ledger profilů, prerequisites a timeoutů je v
[`convergence/TEST-REGISTRY.md`](convergence/TEST-REGISTRY.md). Počet vypsaných
asercí sám o sobě není důkaz zeleného celku; rozhoduje validovaná evidence a
návratový kód procesu.

### Konverzační testy (vyžadují Ollama + GPU)

```bash
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech.test.js
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-english.test.js
OLLAMA_URL=http://127.0.0.1:11434 node tests/conv-czech-nodiacritics.test.js
```

---

## REST API

Backend vystaví REST API na `http://127.0.0.1:3335`:

| Prefix | Modul | Popis |
|--------|-------|-------|
| `/api/chat` | Chat | Konverzace, zprávy, export (md, html, pdf, docx) |
| `/api/projects` | Projects | Projekty, lifecycle, roadmapa, milestones |
| `/api/expertises` | Expertises | CRUD, merge preview, schema, discovery |
| `/api/agents` | Agents | CRUD, dry-run, scheduling (PRO+) |
| `/api/skills` | Skills | CRUD, reload, execution, meta-skill |
| `/api/specialists` | Specialists | Enable/disable, discovery, memory |
| `/api/notifications` | Notifications | Kanály, test, trust, digest |
| `/api/system` | System | Health, storage, GPU, backup, info |
| `/api/security` | Security | Audit, tokeny, sessions |
| `/api/settings` | Settings | Uživatelská nastavení, feature flags |
| `/api/quality` | Quality | Quality reports, telemetrie |
| `/api/planner` | Planner | Workflow, build status |
| `/api/autonomy` | Autonomy | Drift status, thresholds |

WebSocket na stejném portu — IDE ↔ backend real-time komunikace (chat streaming, agent log, terminal, file watch, settings sync).

---

## Licence

Systém licencí vázaný na hardware fingerprint (3 tiery: FREE / PRO / ENTERPRISE). Offline validace — žádný license server.

| Tier | Projekty | Agenti | Specialisté | Export |
|------|----------|--------|-------------|--------|
| FREE | 1 | - | - | md, txt |
| PRO | neomezeně | ano | ano | md, txt, html, pdf, docx |
| ENTERPRISE | neomezeně | ano | ano | vše + multi-user |

---

*Poslední aktualizace: v136.0.0 (2026-08-19)*
