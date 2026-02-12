# C.3 Agent Platform — Architecture v62

**Version:** v62 (B6 Multi-source)
**Status:** Production-ready, ~82% complete
**Date:** February 2026

---

## Executive Summary

C.3 is a conversational AI platform combining:

1. **CRE (Conversational Reasoning Engine)** — Authoritative dialog management, intent classification, epistemic correctness
2. **Agent Platform** — Deterministic worker agents with source fetching, conditions, triggers, notifications
3. **Project Lifecycle** — Milestone-based project management with crash recovery
4. **Expert System** — Domain-specialist routing (accountant, lawyer, architect)
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
│   │  (Phase D)          │           │                         │     │
│   │  Domain specialists │           │  Policy → Router        │     │
│   └─────────────────────┘           │  → Channel → Delivery   │     │
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
├── experts/                     # Phase D: Specialist system
│   ├── expert-layer.js          #   Expert routing & dispatch
│   └── expert-store.js          #   Expert config persistence
├── llm/                         # LLM subsystem
│   ├── gateway.js               #   Token-based routing, timeouts
│   ├── client.js                #   Ollama HTTP client
│   └── web-search.js            #   Brave Search integration
├── executor/                    # Tool execution
│   ├── tool-executor.js         #   Main execution engine
│   ├── circuit-breaker.js       #   Failure isolation
│   └── shell-security.js        #   Shell sandboxing
├── db/
│   └── database.js              #   SQLite schema (23 tables)
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

Single authority for all dialog decisions. Classifies user intent into 19 types:

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

Milestone-based project management with crash recovery.

```
SPEC → BUILD → REVIEW → next milestone or COMPLETED
  │                         │
  └── Crash recovery ───────┘
      (lifecycle_handoff_state table,
       DB write-through, preload on restart)
```

**Multi-session (C4):** New session auto-detects active lifecycle for same project via `active_session_id`.

### 5. Channel Adapters

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

23 tables in SQLite (better-sqlite3):

| Group | Tables |
|-------|--------|
| Chat | conversations, messages, attachments, chat_sessions |
| Agents | agents_v33, agent_runs_v33, agent_notifications_v33, agent_data_v33, agent_seen_items_v57, agent_schedule_v33 |
| Projects | projects, project_lifecycles, milestones, change_requests, drift_checks |
| Lifecycle | lifecycle_handoff_state (crash recovery) |
| Experts | experts, conversation_experts, expert_memory |
| Memory | global_memory, user_memory, project_memory |
| Workflows | workflow_sessions |
| Config | user_settings, learned_patterns, logs, drafts |

---

## Configuration

### Feature Flags

```javascript
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

221+ agent/notification tests, 913+ total:

| Suite | Tests | Focus |
|-------|-------|-------|
| CRE comprehensive | 401 | Intent classification |
| v583 tier1 | 94 | Core CRE regression |
| Phase B workers | 73 | B0/B4/B6/B8/B9 |
| Notifications | 67 | Channels, routing, policy |
| Lifecycle E2E | 60 | Phase C lifecycle |
| RSS sources | 47 | RSS/Atom parsing |
| Workflow | 42 | Planner workflow |
| Trust feedback | 34 | Auto-degrade/mute |
| Agent runner | 20 | HUNTER, mark_seen |
| **Multi-source integration** | **14** | **RSS+HTTP, _merged, partial failure** |
| + 60 more suites | ~61 | Various subsystems |

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
| C (Lifecycle) | 95% | Milestones, crash recovery, multi-session |
| D-int (Integration) | 100% | Rate monitor auto-registration |
| D (Experts) | Planned | Expert layer, specialist routing |
| E (IDE) | Planned | Theia runtime, WS bridge |
| F (Packaging) | Planned | Docker, licensing, auto-updater |

**Overall: ~82% complete**

---

*This document reflects C.3 Agent Platform v62 architecture (2026-02-12).*
