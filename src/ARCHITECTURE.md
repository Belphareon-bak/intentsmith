# C3-Agent — Copilot-like AI Architecture

## Architektura: 3 agenti

```
┌─────────────────────────────────────────────────────────────────┐
│                        server.js                                │
│                     (HTTP Orchestrátor)                          │
│          UI je pouze orchestrátor přechodů stavů                │
└──────────┬──────────────────┬───────────────────┬───────────────┘
           │                  │                   │
           ▼                  ▼                   ▼
   ┌──────────────┐  ┌──────────────┐    ┌──────────────┐
   │  CHAT AGENT  │  │   PLANNER    │    │   EXECUTOR   │
   │   (LLM-A)    │  │   (LLM-B)    │    │ (determin.)  │
   │              │  │              │    │              │
   │ ✅ diskutovat │  │ ✅ plánovat   │    │ ✅ provádět   │
   │ ✅ ptát se    │  │ ✅ kroky      │    │ ✅ shell/fs   │
   │ ✅ vyjasnit   │  │ ✅ závislosti │    │ ✅ sandbox    │
   │ ✅ navrhovat  │  │ ✅ checkpointy│    │ ✅ audit      │
   │ ❌ executor   │  │ ❌ executor   │    │ ❌ interpretovat│
   │ ❌ FS/shell   │  │ ❌ FS/shell   │    │ ❌ měnit plán │
   └──────┬───────┘  └──────┬───────┘    └──────┬───────┘
          │                  │                   │
          ▼                  ▼                   ▼
   ┌──────────────────────────────────────────────────────────┐
   │                    Sdílená infrastruktura                  │
   │  llm/  memory/  experts/  tools/  db/  core/  planner/    │
   └──────────────────────────────────────────────────────────┘
```

---

## Adresářová struktura

```
src/
├── server.js                    # HTTP API, route dispatch, orchestrátor
├── config.js                    # Globální konfigurace
│
├── chat/                        # ═══ CHAT AGENT (LLM-A) ═══
│   ├── controller.js            # Vstupní bod: input → mode detection → handler
│   ├── controller.d.ts          # TypeScript deklarace
│   ├── cre-decision.js          # CRE v45.0 — Decision Engine
│   ├── export-pipeline.js       # Export: MD/HTML/TXT/PDF/DOCX (v57.2)
│   ├── context-budget.js        # Intent-aware context budget management
│   ├── conversation-store.js    # Conversation persistence (SQLite)
│   ├── handlers/                # Mode-specific handlery
│   │   ├── index.js             # Barrel export + getDefaultHandlers()
│   │   ├── conversation.js      # CONVERSATION mode
│   │   ├── project.js           # PROJECT mode (+ project focus)
│   │   ├── expert.js            # EXPERT mode (+ persona)
│   │   ├── agent.js             # AGENT mode (+ confirmation flow)
│   │   ├── decisions.js         # Shared decision sub-handlers (993 ř.)
│   │   ├── clarification.js     # Clarification resolution
│   │   ├── local.js             # Local computation (math, date, calendar)
│   │   ├── report.js            # Report synthesis pipeline
│   │   └── utils/               # Utility modules
│   │       ├── index.js
│   │       ├── intent.js        # Intent detection
│   │       ├── quality.js       # Quality gates (fluff, atomic answer)
│   │       ├── synthesis.js     # LLM synthesis (+ quality pipeline integration)
│   │       ├── followup.js      # Follow-up detection
│   │       └── types.d.ts       # TypeScript types
│   ├── quality/                 # ═══ Quality & Trust Contracts (K5) ═══
│   │   ├── index.js             # Barrel export
│   │   ├── confidence.js        # K5.3: Answer confidence scaling
│   │   ├── source-trust.js      # K5.2: Source trust weighting
│   │   ├── relevance.js         # K5.1: Relevance filter
│   │   ├── drift-guard.js       # K5.5: Long-form drift guard
│   │   └── creative-depth.js    # K5.4: Creative depth scaling
│   └── safety/                  # ═══ Safety Engine ═══
│       ├── index.js             # Safety module entry
│       ├── engine.js            # SafetyEngine — domain-aware safety checks
│       ├── integration.js       # Controller integration helpers
│       └── policies/            # Domain policies
│           ├── health.js        # Health/medical safety
│           ├── finance.js       # Financial advice safety
│           ├── law.js           # Legal advice safety
│           └── general.js       # General safety rules
│
├── executor/                    # ═══ EXECUTOR (deterministický) ═══
│   ├── index.js                 # Barrel export
│   ├── tool-executor.js         # Tool execution engine (+ circuit breaker)
│   ├── circuit-breaker.js       # Circuit breaker per tool type
│   └── health-monitor.js        # Tool health monitoring
│
├── planner/                     # ═══ PLANNER (LLM-B) — Phase 2-3 ═══
│   ├── index.js                 # Barrel export
│   └── workflow.js              # D1→CODE→R2→D2/R1 pipeline orchestrator
│
├── llm/                         # Sdílené: LLM služby
│   ├── client.js                # LLM API client
│   ├── gateway.js               # Auth gateway + rate limiting
│   ├── auth-types.js            # Auth tokens, caller roles
│   ├── prompts.js               # System prompts
│   ├── cre-bridge.js            # CRE ↔ LLM bridge
│   └── web-search.js            # Web search + scraping
│
├── memory/                      # Sdílené: Paměť
│   ├── preferences.js           # User preferences engine
│   ├── long-term.js             # Long-term memory store
│   └── policy.js                # Memory retention policies
│
├── experts/                     # Sdílené: Expert personas
│   ├── expert-layer.js          # Expert personality layer
│   └── guards/                  # Post-synthesis guards
│       └── tool-enforcement.js  # Tool-only numeric enforcement (v57.2)
│
├── tools/                       # Sdílené: Tool registry
│   ├── registry.js              # Tool registration & discovery
│   └── http-client.js           # HTTP client for tools
│
├── agents/                      # Agent DSL system
│   ├── api.js                   # Agent REST API
│   ├── runner.js                # Agent execution runner
│   ├── repository.js            # Agent persistence
│   ├── scheduler.js             # Cron-like scheduling
│   ├── schema.js                # Agent DSL schema
│   ├── builder.js               # Agent builder
│   ├── llm-services.js          # LLM services for agents
│   ├── conditions.js            # Conditional execution
│   ├── triggers.js              # Event triggers
│   └── sources/                 # Data source adapters
│       ├── inspector.js
│       └── schema.js
│
├── architect/                   # Code architect (specialized planner+executor)
│   ├── orchestrator.js          # Architect orchestration
│   ├── editor.js                # File editing
│   ├── coder.js                 # Code generation
│   ├── reviewer.js              # Code review
│   ├── actions.js               # Available actions
│   ├── context.js               # Project context
│   ├── git.js                   # Git operations
│   ├── history.js               # Conversation history
│   ├── llm.js                   # Architect LLM calls
│   ├── prompts.js               # Architect prompts
│   ├── roadmap.js               # Project roadmap
│   ├── state.js                 # Session state
│   └── index.js                 # Barrel export
│
├── notifications/               # Notification delivery system (v57.0+)
│   ├── index.js                 # Barrel export + factory functions
│   ├── service.js               # NotificationRouter — channel dispatch
│   ├── pipeline.js              # NotificationPipeline — policy + digest + routing
│   ├── policy.js                # NotificationPolicy — rate limiting, trust override
│   ├── digest.js                # DigestAggregator — batch notifications
│   ├── trust.js                 # TrustTracker — feedback-based trust scoring
│   ├── feedback.js              # FeedbackHandler — user feedback processing
│   ├── trust-api.js             # Trust REST API routes
│   ├── db.js                    # Notification DB tables
│   └── channels/                # Delivery channels
│       ├── base.js              # NotificationChannel interface
│       ├── email.js             # EmailChannel (nodemailer)
│       └── telegram.js          # TelegramChannel (Bot API)
│
├── core/                        # Infrastruktura
│   ├── logger.js                # Structured logging
│   ├── error-handler.js         # Global error handling
│   ├── error-handler.d.ts
│   ├── logger.d.ts
│   ├── tracer-hooks.mjs         # Runtime instrumentation hooks
│   └── tracer-register.mjs      # Module load tracer
│
└── db/                          # Persistence
    └── database.js              # SQLite database layer
```

---

## Integrační body

### D1→CODE→R2→D2/R1 Workflow Pipeline

```
User Request
     ↓
D1 (deepseek-r1) → Analyze → CLARIFY? → questions back to user
     ↓ READY
D1 → Create Plan → User confirms
     ↓ OK
CODE (qwen2.5-coder) → Implement
     ↓
R2 (qwen2.5:32b) → Quick Review
     ↓ FAIL                    ↓ PASS
D2 (qwen3-30b) → Fix plan     R1 (deepseek-r1) → Final Review
     ↓                              ↓ FAIL (redesign)
CODE → Apply Fix                   D1 → Redesign
     ↓                              ↓
     → R2 (loop, max 3)            CODE → Re-implement → R2 (loop)
                                     ↓
                                ↓ APPROVED
                                ✅ DONE
```

**Model Roles:**

| Role | Model | Job | May NOT |
|------|-------|-----|---------|
| D1 | deepseek-r1:32b | Analyze, plan, redesign | Execute code |
| D2 | qwen3-30b-a3b | Deliberate fixes | Execute code |
| CODE | qwen2.5-coder:32b | Implement, apply fixes | Decide what to build |
| R1 | deepseek-r1:32b | Final deep review | Fix issues |
| R2 | qwen2.5:32b | Quick review | Fix issues |

**API Endpoints:**

```
POST /planner/start    — Start workflow (D1 analyzes → plan or clarify)
POST /planner/clarify  — Answer D1's clarification questions
POST /planner/approve  — Approve plan → CODE implements → review loop
POST /planner/reject   — Reject plan with feedback → D1 replans
GET  /planner/session  — Get workflow session status & history
```

### Quality Pipeline (automatický)

```
User query → Tool execution → [quality pipeline] → LLM synthesis
                                    │
                                    ├─ K5.1 Relevance Filter (odfiltruje off-topic)
                                    ├─ K5.2 Source Trust (váha podle důvěryhodnosti)
                                    └─ K5.3 Confidence Scaling (tón odpovědi = síla evidence)
```

Integrováno v: `chat/handlers/utils/synthesis.js → synthesizeWithLLM()`

### Safety Pre-Check (automatický)

```
User input → [SafetyEngine.check()] → block / warn / pass → Chat processing
```

Integrováno v: `chat/controller.js → process()`

### Circuit Breaker (automatický)

```
Tool call → [CircuitBreaker.check()] → OPEN: skip / CLOSED: execute
                                          ↓
                                   recordSuccess() / recordFailure()
                                          ↓
                                   3 failures → OPEN (60s cooldown)
```

Integrováno v: `executor/tool-executor.js → execute()`

---

## Workflow Pipeline

Jeden aktivní workflow engine:

| Soubor | Status | Pipeline | Endpoint |
|--------|--------|----------|----------|
| `planner/workflow.js` | **ACTIVE** ✅ | D1→CODE→R2→D2→R1 | `POST /planner/*` + Chat BUILD handoff |

> Legacy `workflow/engine.js` (THINKER→CODER→REVIEWER) byl odstraněn ve v57.2.

### Routing v server.js

```
POST /planner/start      → workflowOrchestrator
POST /planner/clarify    → workflowOrchestrator
POST /planner/approve    → workflowOrchestrator
POST /planner/reject     → workflowOrchestrator

POST /api/chat (BUILD)   → ChatController → CRE → build-handoff → workflowOrchestrator
```

**CRE invariant**: `BUILD` intent → `PLAN` decision → `planner/workflow.js` (tvrdě vynuceno v `cre-decision.js`)

---

## Fáze implementace

| Fáze | Status | Popis |
|------|--------|-------|
| **0 — Fixace směru** | ✅ DONE | Definice, odmítnutí inline-first |
| **1 — Chat Agent** | ✅ LIVE | controller.js + CRE + handlers + quality + safety |
| **2 — Handoff Chat→Planner** | ✅ LIVE | POST /planner/start, clarify, approve, reject |
| **3 — Planner workflow** | ✅ LIVE | D1→CODE→R2→D2/R1 pipeline (workflow.js, 600 ř.) |
| **4 — Execution Pipeline** | ✅ LIVE | tool-executor + circuit breaker |
| **5 — Doménové kapability** | ✅ LIVE | 11 recipes, 3 scaffolds, tag matching, D1 context |

---

## Metriky

| Metrika | Hodnota |
|---------|---------|
| Souborů celkem | 79 |
| Řádků kódu | ~32 400 |
| Broken importů | 0 |
| Chat Agent | ✅ 10 591 ř. |
| Planner (D1→CODE→R2→D2/R1) | ✅ 623 ř. |
| Executor | ✅ 1 887 ř. |
| Quality moduly | 5 (integrované) |
| Safety domény | 4 (health, finance, law, general) |
| Circuit breaker | ✅ per-tool |
| LLM modely | 4 (deepseek-r1, qwen3-30b, qwen2.5-coder, qwen2.5) |

---

## Architektonická pravidla (tvrdá)

1. **Chat ≠ Planner ≠ Executor** — každý má jiný model, prompt, oprávnění
2. **Chat nikdy nevolá executor** — jen vrací rozhodnutí (CRE decisions)
3. **Planner nikdy nemluví s UI přímo** — jen vytváří plány
4. **Executor nikdy nevidí LLM prompt** — jen provádí kanonické kroky
5. **UI je pouze orchestrátor přechodů stavů** — server.js
6. **Porušení = návrat chaosu**
