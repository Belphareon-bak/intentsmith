# C.3 Agent Platform — Architecture v65.2

**Version:** v65.2 (Lifecycle BUILD hardening, SK→CZ v63.0, Expert Wizard v64.1)
**Status:** Production-ready, ~90% complete
**Date:** February 2026

---

## Executive Summary

C.3 is a conversational AI platform combining:

1. **CRE (Conversational Reasoning Engine)** — Authoritative dialog management, intent classification, epistemic correctness
2. **Agent Platform** — Deterministic worker agents with source fetching, conditions, triggers, notifications
3. **Project Lifecycle** — Milestone-based project management with crash recovery
4. **Expert System** — 15 domain specialists with 5D capability profiles, multi-expertise merge engine, enforcement pipeline
5. **Notification Pipeline** — Multi-channel delivery (email, Telegram, ntfy.sh push)

All decisions flow through CRE — LLM is the text generator, never the authority.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          User Interface                              │
│                    (Web UI / CLI / IDE / API)                        │
├──────────────────────────────────────────────────────────────────────┤
│                        Channel Adapters                              │
│              (CLI, Web, Slack, Discord, API)                         │
│              C3InputEvent → normalize → C3OutputEvent                │
├──────────────┬───────────────────────────────────┬───────────────────┤
│              │                                   │                   │
│   ┌──────────▼──────────┐           ┌────────────▼────────────┐     │
│   │   Chat Pipeline     │           │   Agent Platform        │     │
│   │                     │           │                         │     │
│   │  CRE → Intent       │           │  Scheduler → Runner     │     │
│   │  → Handler          │           │  → Sources → Conditions │     │
│   │  → LLM → Gate       │           │  → Triggers → Actions   │     │
│   │  → Response         │           │  → mark_seen (HUNTER)   │     │
│   └──────────┬──────────┘           └────────────┬────────────┘     │
│              │                                   │                   │
│   ┌──────────▼──────────┐           ┌────────────▼────────────┐     │
│   │  Expert System      │           │  Notification Pipeline  │     │
│   │  (v63 Merge Engine) │           │                         │     │
│   │  15 experts, 5D cap │           │  Policy → Router        │     │
│   │  Merge + Enforce    │           │  → Channel → Delivery   │     │
│   └─────────────────────┘           │                         │     │
│                                     │  → Trust Feedback       │     │
│              ┌──────────────────────┘────────────────────────┐      │
│              │         Project Lifecycle (Phase C)            │      │
│              │  SPEC → BUILD → REVIEW → milestones           │      │
│              │  Crash recovery, multi-session                 │      │
│              └───────────────────────────────────────────────┘      │
├──────────────────────────────────────────────────────────────────────┤
│                        Database (SQLite)                              │
│                    23 tables, prepared statements                     │
├──────────────────────────────────────────────────────────────────────┤
│                     LLM Gateway (Ollama)                             │
│              deepseek-r1:32b, qwen2.5-coder:32b, etc.               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/
├── server.js                    # Express HTTP server (port 3335), ~2500 lines
├── config.js                    # Feature flags, model bindings, timeouts
├── agents/                      # Phase B: Agent platform
│   ├── runner.js                #   Execution engine (1339 lines)
│   ├── scheduler.js             #   Cron/interval scheduling (282 lines)
│   ├── repository.js            #   SQLite CRUD (662 lines)
│   ├── conditions.js            #   Deterministic evaluator (551 lines)
│   ├── triggers.js              #   Edge detection (172 lines)
│   ├── multi-source.js          #   Cross-source dedup, health tracking
│   ├── worker-configs.js        #   Weather, realty, news templates
│   ├── schema.js                #   Validation whitelist
│   ├── sources/
│   │   └── rss.js               #   RSS/Atom source adapter
│   └── examples/                #   6 pre-built agent definitions
│       ├── morning-briefing.json    # RSS + 2x HTTP (B6)
│       ├── rate-monitor.json        # 6x HTTP tax monitoring
│       ├── realty-multi-source.json # 2x HTTP realty
│       ├── news-rss-digest.json     # 2x RSS news
│       └── weather-monitor.json     # 1x HTTP weather
├── chat/                        # Core: Conversational AI pipeline
│   ├── controller.js            #   ChatController entry point
│   ├── cre-decision.js          #   CRE intent classification (~2400 lines)
│   ├── conversation-store.js    #   Session persistence
│   ├── handlers/                #   19 intent-specific processors
│   │   ├── conversation.js      #     Main router, DESIGN sessions
│   │   ├── decisions.js         #     TOOL_CALL, ANSWER, REFUSE, LOCAL
│   │   ├── lifecycle-router.js  #     Phase C lifecycle intercept
│   │   ├── lifecycle-state.js   #     Handoff state (DB write-through)
│   │   ├── agent-wizard.js      #     Agent creation wizard (B9)
│   │   └── utils/
│   │       ├── synthesis.js     #       LLM synthesis + Output Gate
│   │       ├── output-gate.js   #       D6 response validation
│   │       └── language.js      #       CZ/EN detection & switching
│   └── quality/                 #   Quality gates
├── channels/                    # Channel adapters
│   ├── types.js                 #   ChannelType, C3InputEvent, C3OutputEvent
│   └── cli-adapter.js           #   CLI integration
├── notifications/               # Notification pipeline
│   ├── pipeline.js              #   Policy → Router → Channel
│   ├── service.js               #   NotificationRouter
│   ├── policy.js                #   Muting, priority, escalation
│   ├── digest.js                #   Hourly/daily batching
│   ├── trust.js                 #   TrustTracker (auto-degrade/mute)
│   └── channels/
│       ├── email.js             #     SMTP via nodemailer
│       ├── telegram.js          #     Telegram Bot API
│       ├── push.js              #     ntfy.sh (JSON body, UTF-8)
│       └── ntfy.js              #     ntfy.sh alternate
├── planner/                     # Phase C: Project lifecycle
│   ├── workflow.js              #   Workflow orchestration
│   ├── lifecycle.js             #   State machine (SPEC→BUILD→REVIEW)
│   ├── lifecycle-build.js       #   BUILD phase implementation
│   ├── progress-tracker.js      #   Milestone tracking
│   └── project-context.js       #   Project metadata
├── experts/                     # Phase D: Expert System (v63)
│   ├── expert-layer.js          #   15 built-in experts, ExpertAgent class, resolveInheritance
│   ├── expert-store.js          #   Expert config persistence + validation
│   ├── expert-enforcement.js    #   ExpertEnforcer: forbidden phrases, retry with decay, strict mode
│   ├── merge-engine.js          #   mergeExpertisePrompt() — 15.5-step pure function
│   ├── merge-types.js           #   MERGE_LIMITS, MODULE_SECTIONS, CompatibilityBlockError
│   ├── merge-compatibility.js   #   checkCompatibility() — 5D pairwise conflict detection
│   ├── capability-enforcer.js   #   Post-response 5D capability drift validation
│   └── capability-mapping.js    #   Capability vector → prompt/temperature/enforcement modifiers
├── llm/                         # LLM subsystem
│   ├── gateway.js               #   Token-based routing, timeouts
│   ├── client.js                #   Ollama HTTP client
│   └── web-search.js            #   Brave Search integration
├── executor/                    # Tool execution
│   ├── tool-executor.js         #   Main execution engine
│   ├── circuit-breaker.js       #   Failure isolation
│   └── shell-security.js        #   Shell sandboxing
├── db/
│   └── database.js              #   SQLite schema (28+ tables)
├── core/
│   ├── error-handler.js         #   Global error handlers
│   └── logger.js                #   Structured logging
├── memory/                      # Memory subsystem
│   ├── long-term.js             #   Semantic search
│   └── preferences.js           #   User preference tracking
└── ws-bridge/                   # IDE WebSocket bridge
```

---

## Core Components

### 1. CRE (Conversational Reasoning Engine)

Single authority for all dialog decisions. v64.0 adds **CRE Gatekeeper** — all decision creation outside `decide()` now routes through `overrideDecision()` (with audit trail) or `logIntercept()` (for pre-CRE stateful routes). Every override persisted to `cre_override_log` table.

Classifies user intent into 19 types:

| Intent | Handler | Example |
|--------|---------|---------|
| LOCAL | Deterministic | "kolik je 2+2", "dnesni datum" |
| CONVERSATIONAL | LLM synthesis | "ahoj", "co si myslis o..." |
| SEARCH | WebSearch + synthesis | "aktualni cena zlata" |
| DESIGN | SessionState lifecycle | "navrhni architekturu" |
| BUILD | Planner handoff | "postav mi web" |
| CODE | Inline generation | "napsat funkci pro..." |
| FACTUAL | Evidence-based | "hlavni mesto Francie" |
| CREATIVE | Ideation | "vymysli pribeh" |

**Key principle:** CRE decides WHEN and WHAT, LLM generates HOW.

```
User Input → CRE.classifyIntent() → IntentType
  → ConversationHandler routes to specific handler
  → Handler builds LLM prompt with constraints
  → LLM generates response
  → OutputGate (D6) validates form
  → Response to user
```

### 2. Agent Platform (Phase B)

Deterministic execution engine — no LLM in core loop.

```
AgentScheduler (cron/interval)
  │
  ▼
AgentRunner.execute(agentId)
  │
  ├─ STEP 1: Fetch sources (parallel, Promise.all)
  │    ├─ fetchHttp(config)   → JSON or text
  │    ├─ fetchRss(config)    → items[] via RSSSource
  │    └─ fetchDatabase()     → (placeholder)
  │
  ├─ STEP 1b: Build _merged view
  │    └─ Combine all sources, add _source field
  │
  ├─ STEP 2: Filter seen items (HUNTER pattern)
  │    └─ Per-source deduplication via agent_seen_items_v57
  │
  ├─ STEP 3: Evaluate conditions (deterministic)
  │    └─ 7 types: compare, date_diff, contains, exists,
  │       in_range, changed, new_items
  │
  ├─ STEP 4: Detect trigger edges
  │    └─ rising/falling/any + cooldown + max_fires_per_day
  │
  ├─ STEP 5a: mark_seen (transactional, BEFORE business actions)
  │
  ├─ STEP 5b: Execute business actions (with retry/backoff)
  │    ├─ notify → NotificationPipeline
  │    ├─ webhook → HTTP POST
  │    └─ update_state → persist
  │
  └─ STEP 6: Return RUN_STATE
       SUCCESS_TRIGGERED | SUCCESS_NO_NEW | ERROR_SOURCE | etc.
```

**Run states:** SUCCESS_TRIGGERED, SUCCESS_NO_TRIGGER, SUCCESS_NO_NEW, INIT_BASELINE, ERROR_SOURCE, ERROR_EXECUTION, SKIP_DISABLED, SKIP_COOLDOWN, SCHEMA_DEGRADED, SCHEMA_BROKEN

**Multi-source (B6):** Agents can combine RSS + HTTP + other types. `_merged` synthetic source enables cross-source conditions. Per-source mark_seen, partial failure isolation.

### 3. Notification Pipeline

```
Agent action (notify) or API call
  │
  ▼
NotificationPipeline.process(ctx)
  ├─ NotificationPolicy
  │    └─ Check: muted? priority threshold? digest mode?
  │    └─ Decision: immediate | digest | drop
  ├─ NotificationRouter
  │    └─ Dispatch to channel by ctx.channel
  └─ Channel.send(notification)
       ├─ EmailChannel (SMTP/nodemailer)
       ├─ TelegramChannel (Bot API, MarkdownV2)
       ├─ PushChannel (ntfy.sh JSON body)
       └─ NtfyChannel (ntfy.sh)

Trust Feedback Loop:
  User rates notification → TrustTracker
    → <30% useful → auto-degrade priority
    → <10% useful → auto-mute channel
```

### 4. Project Lifecycle (Phase C)

Milestone-based project management with crash recovery and hardened BUILD phase.

```
SPEC → BUILD → REVIEW → next milestone or COMPLETED
  │                         │
  └── Crash recovery ───────┘
      (lifecycle_handoff_state table,
       DB write-through, preload on restart)
```

**BUILD phase (v65.2):**
- Real test execution via `C3ToolExecutor` (shell sandbox, timeout 120s)
- Pre-execution hard limit on milestone size (`validateMilestoneSize` — BLOCKED if LOC/files exceed config)
- Checkpoint FAIL default on parse error (safe default, not PASS)
- Scope enforcement: pre-execution warning + post-execution git diff check

**Multi-session (C4):** New session auto-detects active lifecycle for same project via `active_session_id`.

### 5. Expert System (v63 — Merge Engine)

15 built-in domain experts with 5D capability profiles, multi-expertise merge, and enforcement pipeline.

```
User Input → Expert Handler
  │
  ├─ Single expert? → systemPrompt + LLM
  │
  └─ Multiple expertises (max 3)?
       │
       ├─ STEP 1: checkCompatibility() — 5D pairwise conflict detection
       ├─ STEP 2: resolveInheritance() — parent chain (max depth 4)
       ├─ STEP 3: mergeExpertisePrompt() — 15.5-step pure function
       │    └─ validate → sort → inherit → merge modules → specialist
       │       → tone → temperature → trim tokens → build prompt → enforce
       ├─ STEP 4: LLM generation (with merged prompt + temperature)
       ├─ STEP 5: ExpertEnforcer — forbidden phrases, min length, retry with decay
       ├─ STEP 6: enforceCapabilities() — 5D drift detection (deterministic, no LLM)
       └─ STEP 7: logLlmExecution() — model, latency, prompt hash, token source
```

**5D Capability Vector** (per expert, 0-100):
- `reasoning` — analytical depth
- `creativity` — generative freedom
- `determinism` — answer consistency
- `riskTolerance` — caveat/disclaimer density
- `verbosity` — response length

**Enforcement Pipeline:**
- `ExpertEnforcer` — forbidden phrase check, retry with temperature decay (0.1/attempt), strict mode (hardFail)
- `enforceCapabilities()` — hedging ratio, caveat density, verbosity, structure scoring
- `computeCapabilityDrift()` — per-dimension delta vs expected profile, violation threshold 40

**ExecutionTrace (v63.3):**
- One `executionTraceId` (UUID) per user turn
- Connects: `llm_execution_log` → `ExpertEnforcer.retryAudit` → `capability_drift_log` → `merge_audit_log`
- Prompt SHA-256 hash for determinism analysis
- `token_source: 'provider' | 'estimated'`
- `performance.now()` for sub-ms latency

### 6. Channel Adapters

Normalize input from any source into `C3InputEvent`:

```javascript
C3InputEvent {
  source: { channel, channelId, threadId, messageId },
  user: { externalId, displayName },
  content: { type, text, attachments },
  hints: { mentionedBot, isDM, isEdit, isReply },
  capabilities: ChannelCapabilities  // markdown, threading, embeds, etc.
}
```

Supported: CLI, Web, Slack, Discord, API. Each with capability presets (max message length, threading support, etc.)

---

## Database Schema

28+ tables in SQLite (better-sqlite3), 5 migrations:

| Group | Tables |
|-------|--------|
| Chat | conversations, messages, attachments, chat_sessions |
| Agents | agents_v33, agent_runs_v33, agent_notifications_v33, agent_data_v33, agent_seen_items_v57, agent_schedule_v33 |
| Projects | projects, project_lifecycles, milestones, change_requests, drift_checks |
| Lifecycle | lifecycle_handoff_state (crash recovery) |
| Experts | experts, conversation_experts, expert_memory, conversation_expertises (v63 N:M max 3) |
| Expert Audit | merge_audit_log, capability_drift_log, llm_execution_log (v63.3) |
| CRE Audit | **cre_override_log** (v64.0 — Gatekeeper override/intercept audit trail) |
| Memory | global_memory, user_memory, project_memory |
| Workflows | workflow_sessions |
| Config | user_settings, learned_patterns, logs, drafts |

---

## Configuration

### Feature Flags

Vsechny promenne se nacitaji z `.env` souboru (`dotenv`). Viz `.env.example` pro uplny seznam.

```javascript
// src/config.js — cte process.env s defaulty
features: {
  agents:    process.env.C3_ENABLE_AGENTS !== 'false',     // Phase B
  lifecycle: process.env.C3_ENABLE_LIFECYCLE !== 'false',  // Phase C
  experts:   process.env.C3_ENABLE_EXPERTS !== 'false',    // Phase D
}
```

### Model Bindings (Ollama)

| Role | Model | Timeout |
|------|-------|---------|
| D1 (deliberation) | deepseek-r1:32b | 120s |
| D2 (fix) | qwen3-30b-a3b | 60s |
| CODE | qwen2.5-coder:32b | 90s |
| R1 (review) | deepseek-r1:32b | 120s |
| R2 (quick review) | qwen2.5:32b | 45s |
| CHAT | qwen2.5:32b | 60s |
| VISION | llava:13b | 60s |

### Environment Variables

```bash
# Server
C3_PORT=3335
C3_DB_PATH=./data/c3.db
OLLAMA_URL=http://127.0.0.1:11434

# Notifications
C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID
C3_NTFY_SERVER, C3_NTFY_TOPIC, C3_NTFY_TOKEN
```

---

## Test Suite

1100+ tests total:

| Suite | Tests | Focus |
|-------|-------|-------|
| CRE comprehensive | 401 | Intent classification |
| v583 tier1 | 94 | Core CRE regression |
| Phase B workers | 73 | B0/B4/B6/B8/B9 |
| Notifications | 67 | Channels, routing, policy |
| Lifecycle E2E | 138 | Phase C lifecycle (12 phases, disk I/O, git) |
| Lifecycle unit | 103 | State machine, persistence, deps |
| Milestone size | 40 | Size validation, split suggestions |
| RSS sources | 47 | RSS/Atom parsing |
| Workflow | 42 | Planner workflow |
| **Merge engine** | **40** | **Multi-expertise composition, token budget, inheritance** |
| Expert system | 40 | Single expert flow, built-in experts |
| **Expertise wizard** | **38** | **Validation, modules, capabilities** |
| **Capability enforcer** | **38** | **5D evaluators, drift, strict, retry, trace** |
| Trust feedback | 34 | Auto-degrade/mute |
| **Execution trace stress** | **20** | **3-expert merge + strict + drift + trace reconstruction** |
| Merge compatibility | 16 | 5D pairwise conflict detection |
| Merge-enforcement integration | 15 | Merge → ExpertEnforcer pipeline |
| Multi-source integration | 14 | RSS+HTTP, _merged, partial failure |
| Expert integration | 10 | Expert + DB + handler pipeline |
| Agent runner | 20 | HUNTER, mark_seen |
| + 50 more suites | ~50 | Various subsystems |

---

## Key Design Decisions

### 1. CRE is Authority, LLM is Generator

```
WRONG: LLM decides → CRE validates
RIGHT: CRE decides → LLM generates → Gate enforces
```

### 2. Agents are Deterministic

No LLM in the agent execution loop. Sources, conditions, triggers, and mark_seen are all algorithmic. LLM is only called from `notify` actions with `use_llm: true`.

### 3. HUNTER Pattern

`mark_seen` runs BEFORE business actions. Crash recovery doesn't cause duplicate processing. Per-source, per-agent tracking in `agent_seen_items_v57`.

### 4. Crash Recovery (C1)

`lifecycle_handoff_state` table persists handoff state. DB write-through in `setLcState()`. `preloadActiveLifecycles()` restores RAM on restart.

### 5. Feature Flags

Agents, lifecycle, and experts are independently toggleable. Disabled features are never loaded (lazy import).

### 6. UTF-8 First

All notification channels use JSON body (not HTTP headers) to support Czech diacritics.

---

## Phase Status

| Phase | Completion | Key Components |
|-------|-----------|----------------|
| A (CRE) | 100% | Intent classification, decision matrix, quality gate |
| B (Workers) | 80% | Runner, scheduler, sources, notifications, multi-source |
| C (Lifecycle) | **98%** | Milestones, crash recovery, multi-session, real test exec, hard size limits |
| D-int (Integration) | 100% | Rate monitor auto-registration |
| D (Experts) | **95%** | 15 built-in experts, merge engine, 5D capabilities, enforcement, wizard UI |
| D-obs (Observability) | **100%** | ExecutionTrace ID, LLM execution log, capability drift log |
| E (IDE) | **70%** | C3 Studio IDE (Theia 1.65.2), linked sessions, transport layer |
| F (Packaging) | Planned | Docker, licensing, auto-updater |

**Overall: ~90% complete**

---

*This document reflects C.3 Agent Platform v65.2 architecture (2026-02-14).*
