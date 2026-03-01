# C.3 Agent Platform — Architecture v90.1

**Version:** v90.1.0 (IDE Boot Fix, Right Panel Recovery, Executor Capabilities, Smart Relay Management, Typing Indicator, Project Welcome, CRE GUARD 6, Memory System, Skills System)
**Status:** Production-ready, ~98% complete
**Date:** 2026-03-01

---

## Executive Summary

C.3 is a conversational AI platform combining:

1. **CRE (Conversational Reasoning Engine)** — Authoritative dialog management, intent classification, epistemic correctness
2. **Agent Platform** — Deterministic worker agents with source fetching, conditions, triggers, notifications
3. **Project Lifecycle** — Milestone-based project management with crash recovery
4. **Expertise System** — 15 domain expertises with 5D capability profiles, multi-expertise merge engine, enforcement pipeline
5. **Notification Pipeline** — Multi-channel delivery (email, Telegram, ntfy.sh push)
6. **Skills System** (v85) — Deterministic macro-recipes for repeating procedures (LLM, template, write, shell steps)
7. **Guarded Autonomy** (v83) — Self-tuning CRE parameters via telemetry-driven drift detection
8. **Memory System** (v86) — LTM persistence, injection ranking, feedback detection, pattern tracking
9. **IDE Settings UI** (v87) — 10-section settings with backend sync, GPU detection, model selector
10. **Smart Relay Management** (v90) — Auto-routing, label persistence, relay picker, thinking indicator

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
│   │  Expertise System   │           │  Notification Pipeline  │     │
│   │  (v63 Merge Engine) │           │                         │     │
│   │  15 expertises,5D   │           │  Policy → Router        │     │
│   │  Merge + Enforce    │           │  → Channel → Delivery   │     │
│   └──────────┬──────────┘           │                         │     │
│              │                      │  → Trust Feedback       │     │
│   ┌──────────▼──────────┐           └─────────────────────────┘     │
│   │  Skills System (v85)│                                           │
│   │  Registry → Resolver│           ┌───────────────────────────┐   │
│   │  → Runner → Steps   │           │  Guarded Autonomy (v83)   │   │
│   │  (LLM,tmpl,write,sh)│           │  Aggregator → Drift Det. │   │
│   └─────────────────────┘           │  → Controller → Threshold │   │
│                                     └───────────────────────────┘   │
│              ┌──────────────────────────────────────────────┐       │
│              │         Project Lifecycle (Phase C)           │       │
│              │  SPEC → BUILD → REVIEW → milestones          │       │
│              │  Crash recovery, multi-session                │       │
│              └──────────────────────────────────────────────┘       │
├──────────────────────────────────────────────────────────────────────┤
│                        Database (SQLite)                              │
│                    55 tables, prepared statements                     │
├──────────────────────────────────────────────────────────────────────┤
│                     LLM Gateway (Ollama)                             │
│              qwen2.5:32b (CHAT), deepseek-r1:32b (D1/R1)            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/                             # 73,706 lines / 188 files / 20 directories
├── server.js                    # Express HTTP server (port 3335), 855 lines
├── config.js                    # Feature flags, model bindings, timeouts
├── routes/                      # HTTP route handlers (split from server.js)
│   ├── agents.js                #   Agent CRUD + schema + dry-run
│   ├── projects.js              #   Projects + lifecycle/start
│   ├── expertises.js            #   Expertise CRUD + merge-preview
│   ├── notifications.js         #   Notification endpoints
│   ├── memory.js                #   Memory/preferences
│   ├── chat.js                  #   Chat REST endpoints
│   └── system.js                #   Health, config, version
├── agents/                      # Phase B: Agent platform
│   ├── runner.js                #   Execution engine (1339 lines)
│   ├── scheduler.js             #   Cron/interval scheduling (282 lines)
│   ├── repository.js            #   SQLite CRUD (662 lines)
│   ├── conditions.js            #   Deterministic evaluator (551 lines)
│   ├── triggers.js              #   Edge detection (172 lines)
│   ├── multi-source.js          #   Cross-source dedup, health tracking
│   ├── worker-configs.js        #   Weather, realty, news templates
│   ├── schema.js                #   Validation whitelist + normalizeAgentDefinition()
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
│   ├── cre-decision.js          #   CRE intent classification (2897 lines)
│   ├── conversation-store.js    #   Session persistence
│   ├── handlers/                #   19 intent-specific processors
│   │   ├── conversation.js      #     Main router, DESIGN sessions (778 lines)
│   │   ├── decisions.js         #     TOOL_CALL, ANSWER, REFUSE, LOCAL
│   │   ├── lifecycle-router.js  #     Phase C lifecycle intercept
│   │   ├── lifecycle-state.js   #     Handoff state (DB write-through, 172 lines)
│   │   ├── agent-wizard.js      #     Agent creation wizard (B9)
│   │   └── utils/
│   │       ├── synthesis.js     #       LLM synthesis + Output Gate
│   │       ├── output-gate.js   #       D6 response validation
│   │       ├── language.js      #       CZ/EN detection & switching
│   │       ├── language-enforcement.js #  SK→CZ transliterator (~160 rules)
│   │       ├── project-state-reader.js # v89: Deterministic README+ROADMAP→state parser
│   │       ├── welcome-generator.js    # v89: Template-based project welcome messages
│   │       └── readme-generator.js     #  README/ROADMAP scaffold + detectStack()
│   └── quality/                 #   Quality gates (QGv2)
│       ├── quality-gate-v2.js   #     4-layer deterministic pipeline
│       └── quality-pipeline.js  #     Pipeline orchestration
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
│   ├── workflow.js              #   Workflow orchestration (BUILD_VERIFYING v90)
│   ├── lifecycle.js             #   State machine (SPEC→BUILD→REVIEW)
│   ├── lifecycle-build.js       #   BUILD phase implementation
│   ├── progress-tracker.js      #   Milestone tracking
│   └── project-context.js       #   Project metadata
├── domains/                     # Phase 5: Domain capabilities (v90)
│   ├── index.js                 #   DomainRegistry — 8 scaffolds, tag matching
│   ├── recipes/                 #   Infra/ops recipes (docker, k8s, CI/CD)
│   └── scaffolds/               #   8 app templates
│       ├── express-api.js       #     Express REST API
│       ├── react-app.js         #     React SPA
│       ├── fullstack.js         #     Express + React
│       ├── next-app.js          #     Next.js App Router (v90)
│       ├── vue-app.js           #     Vue 3 + Vite (v90)
│       ├── python-fastapi.js    #     FastAPI REST API (v90)
│       ├── cli-tool.js          #     Node.js CLI (v90)
│       └── flutter-app.js       #     Flutter mobile (v90)
├── expertises/                  # Phase D: Expertise System (v63+)
│   ├── expertise-layer.js       #   15 built-in expertises, ExpertiseAgent class, ExpertiseRegistry, resolveInheritance
│   ├── expertise-store.js       #   Expertise config persistence + validation (60+ rules)
│   ├── expertise-enforcement.js #   ExpertiseEnforcer: forbidden phrases, retry with decay, strict mode
│   ├── auto-select.js           #   Deterministic vocabulary-based expertise auto-selection (<1ms)
│   ├── merge-engine.js          #   mergeExpertisePrompt() — 15-step pure function
│   ├── merge-types.js           #   MERGE_LIMITS, MODULE_SECTIONS, CompatibilityBlockError
│   ├── merge-compatibility.js   #   checkCompatibility() — 5D pairwise conflict detection
│   ├── capability-enforcer.js   #   Post-response 5D capability drift validation
│   ├── capability-mapping.js    #   Capability vector → prompt/temperature/enforcement modifiers
│   ├── specialist-runtime.js    #   D1: Tool-augmented expert framework (ToolRegistry, IntentDetector)
│   ├── knowledge-base.js        #   D2: Versioned fact store (domain/category/key/year)
│   └── scenario-engine.js       #   D3: Multi-step guided workflows (ScenarioRegistry, ScenarioRunner)
├── llm/                         # LLM subsystem
│   ├── gateway.js               #   Token-based routing, timeouts
│   ├── client.js                #   Ollama HTTP client
│   └── web-search.js            #   Brave Search integration
├── tools/                       # Tool Registry (153 tools)
│   ├── registry.js              #   Central catalog: 153 tools, metadata, risk API (~4500 lines)
│   └── http-client.js           #   HTTP client wrapper
├── executor/                    # Tool execution
│   ├── tool-executor.js         #   Main execution engine
│   ├── circuit-breaker.js       #   Failure isolation
│   └── shell-security.js        #   Shell sandboxing
├── db/
│   ├── database.js              #   SQLite schema (53 tables, 1328 lines)
│   └── migrations/              #   5 migration files (timestamp-ordered)
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

**Build Verification Loop (v90):**
- `BUILD_VERIFYING` state inserted between CODE implementation and R2 LLM review
- Auto-detects build command from implementation output (package.json `scripts.build`, Cargo.toml, go.mod, Makefile, pubspec.yaml, pyproject.toml)
- Runs build via `C3ToolExecutor.executeShell()` (180s timeout)
- On failure: parses compiler errors → D2 diagnoses → CODE fixes → retry (max 3 attempts)
- Falls through to R2 review on success or max retries (non-blocking)

**CODE→BUILD Escalation (v90):**
- CRE `decide()` detects multi-file project scope in CODE intent (via `isProjectScopeBuild()`)
- Escalates to PLAN/BUILD pipeline instead of single-file TOOL_CALL
- Triggers on 3+ component indicators or explicit project-scope patterns

**Multi-session (C4):** New session auto-detects active lifecycle for same project. **v65.6 fix:** IDE lifecycle/start uses `session-0` but WS chat uses `ws-<random>` — resolved by RAM lookup via `getLcStateByProject(projectId)` which finds state under any sessionId and migrates it to the current WS session. DB fallback preserved as backup. Lifecycle/start now generates proper IDs (`lc-<timestamp>-<random>`) and stores them in RAM state.

**PROJECT mode intercepts (v88):** Sticky mode routes all project-scoped messages to `projectHandler`. Prior to v88, lifecycle/build intercepts existed only in `conversationHandler`, making the lifecycle engine unreachable in PROJECT mode. v88 mirrors 3 intercept blocks from conversation.js into project.js: (1) build handoff (PROPOSED/CONFIRMING/CLARIFYING/PLAN_REVIEW/EXECUTING), (2) C4 lifecycle auto-detect (RAM + DB fallback), (3) lifecycle handoff. Frontend fixes ensure correct session ID binding in wizard and open-folder flows.

**Working memory persistence (v88):** `SessionState` working memory (goal, activeFile, lastArtifactId) now writes through to `project_memory` DB (category: `working_memory`). Restored on project sync in `ChatController.handle()`. Survives server restarts.

**README + ROADMAP guarantee (v88):** Both `POST /api/projects` (new) and `POST /api/projects/open-folder` ensure README.md and ROADMAP.md exist. `ensureRoadmap()` creates a scaffold with phase table; lifecycle engine's `writeRoadmapFile()` replaces it after planning. Neither overwrites user-created files.

**Proactive Project Welcome (v89):** When a project is created or opened, the backend generates a context-aware welcome message and returns it in the API response. The frontend displays it as the first chat message and persists it via `POST /api/conversations` (with `welcomeMessage` parameter → stored as first assistant turn via ConversationStore).

The welcome system consists of three layers:
1. **`project-state-reader.js`** — Deterministic parser: README + ROADMAP + `.c3/project.json` → structured state (`stateType`: FULL/HYBRID/FOREIGN/EMPTY, `phaseStatus`: IN_PROGRESS/PENDING/COMPLETED/UNKNOWN, stack detection, summary extraction). Tolerant regex, BOM strip, 50k size guard. No LLM calls.
2. **`welcome-generator.js`** — Template-based welcome messages per stateType variant (5+ templates). Max ~600 chars. Action suggestions (→ bullets) based on project state.
3. **`projects.js` routes** — `POST /api/projects` calls `generateNewProjectWelcome()`, `POST /api/projects/open-folder` calls `readProjectState()` + `generateExistingProjectWelcome()`.

**v90+ direction:** `.c3/state.json` will become the machine-readable source of truth. `readProjectState()` will read it directly for C3-owned projects; ROADMAP parsing will only be needed for onboarding foreign projects.

### 5. Expertise System (v63+ — Merge Engine + Specialists)

15 built-in domain expertises with 5D capability profiles, multi-expertise merge, auto-selection, enforcement pipeline, specialist tools, knowledge base, and scenario engine. Custom expertises via `create-expertise` skill.

Full documentation: **[docs/expertise-v1.md](expertise-v1.md)**

```
User Input → Auto-Select (vocabulary-based, <1ms, no LLM)
  │              ↓
  │         Best match → set context (never overrides manual selection)
  │
  ▼
Expertise Handler
  │
  ├─ Single expertise → systemPrompt + LLM + enforce
  │
  └─ Multiple expertises (max 3)
       │
       ├─ STEP 1: checkCompatibility() — 5D pairwise conflict detection
       ├─ STEP 2: resolveInheritance() — parent chain (max depth 4)
       ├─ STEP 3: mergeExpertisePrompt() — 15-step pure function
       │    └─ validate → sort → inherit → merge modules → specialist
       │       → tone → temperature → trim tokens → build prompt → enforce
       ├─ STEP 4: LLM generation (with merged prompt + temperature)
       ├─ STEP 5: ExpertiseEnforcer — forbidden phrases, min length, retry with decay
       ├─ STEP 6: enforceCapabilities() — 5D drift detection (deterministic, no LLM)
       └─ STEP 7: logLlmExecution() — model, latency, prompt hash, token source
```

**15 Built-in Expertises** (5 categories):

| Category | Expertises |
|----------|-----------|
| Tvurci & Narativni | Spisovatel, DnD Master, Textar |
| Analyticko-rozhodovaci | Analytik, Prekupnik, Ucetni |
| Normativni & Odpovednostni | Pravnik, Lekar, Psycholog |
| Technicko-odborni | AI Expert, Vyvojar, Technik |
| Domenovi znalci | Autickar, Motorkar, Politicky analytik |
| Vlastni experti | Created via `create-expertise` skill |

**Key Concepts:**
- **5D Capability Vector** (0-100): reasoning, creativity, determinism, riskTolerance, verbosity
- **Strength Presets**: LIGHT (0-30%), BALANCED (31-60%), DEEP (61-100%) — controls style/depth influence
- **Auto-Select**: Tier 1 vocabulary overlap + Tier 2 boost patterns + hysteresis (no LLM, <1ms)
- **Modules**: 6 sections (domain_rules, emphasis, constraints, vocabulary, antipatterns, disclaimer)
- **Specialist Runtime** (D1): Tool-augmented experts (e.g. accountant with tax/VAT calculators)
- **Knowledge Base** (D2): Versioned fact store (domain/category/key/year with provenance)
- **Scenario Engine** (D3): Multi-step guided workflows (e.g. tax calculation wizard)

**Enforcement Pipeline:**
- `ExpertiseEnforcer` — forbidden phrase check, retry with temperature decay (0.1/attempt), strict mode
- `enforceCapabilities()` — hedging ratio, caveat density, verbosity, structure scoring
- `computeCapabilityDrift()` — per-dimension delta vs expected profile, violation threshold 40

**ExecutionTrace (v63.3):**
- One `executionTraceId` (UUID) per user turn
- Connects: `llm_execution_log` → `ExpertiseEnforcer.retryAudit` → `capability_drift_log` → `merge_audit_log`

### 6. Quality Gate v2 (QGv2) — Deterministic Post-Processing

4-layer pipeline that runs after every LLM response. Pure functions, no LLM calls, deterministic.

```
LLM Response → QGv2 Pipeline
  │
  ├─ Layer 1: Structural
  │    └─ Min length, max length, format validation
  │
  ├─ Layer 2: Language
  │    ├─ 2a. SK→CZ transliterator (≥2 markers → ~160 regex rules)
  │    ├─ 2b. Unconditional SK strip (ľ→l, ô→ů, čo→co, nie je→není, ...)
  │    └─ 2c. Language validation (CZ required for lang=cs)
  │
  ├─ Layer 3: Intent Guarantees
  │    └─ LinkGuard: SEARCH responses must have ≥2 source links
  │       If linkCount < 2 && sourceUrls available → inject **Zdroje:** section
  │
  └─ Layer 4: Content
       └─ Topic drift, completeness checks
```

**Key files:**
- `quality-gate-v2.js` — Main pipeline (~200 lines)
- `quality-pipeline.js` — Orchestration
- `language-enforcement.js` — SK→CZ transliterator (~160 regex rules, 49 SK_MARKERS)

### 7. Tool Registry (153 tools)

Central catalog of all executable tools (`src/tools/registry.js`). Each tool is a pure async function with typed parameters, capability metadata, and structured return values.

**153 tools** across 35 categories:

| Category | Count | Examples |
|----------|-------|---------|
| **fs** | 20 | read, write, list, glob, mkdir, readJson, writeJson, patch, find |
| **git** | 18 | status, commit, diff, push, pull, clone, branch, merge, rebase, blame |
| **code** | 7 | analyze, format, lint, imports, deadcode, rename, duplicates |
| **npm** | 7 | install, run, list, outdated, audit, init, scripts |
| **docker** | 6 | run, build, ps, images, logs, compose |
| **crypto** | 5 | randomBytes, generatePassword, encrypt, decrypt, uuid |
| **deps** | 4 | tree, licenses, size, vuln |
| **guard** | 4 | disk, memory, fd, watchdog |
| **profile** | 4 | cpu, heap, eventloop, benchmark |
| **api** | 4 | request, latency, validate, loadtest |
| **date/url/validate** | 4+4+4 | now, parse, diff, format / parse, build, encode, decode |
| ... | 62 | math, regex, yaml, diff, test, python, ssh, web, workspace, ... |

**Capability metadata** on every tool:

```javascript
meta: {
  sideEffects: boolean,       // Modifies external state?
  idempotent: boolean,        // Safe to retry?
  destructive: boolean,       // Can cause data loss?
  requiresConfirmation: bool, // Needs user approval?
  costLevel: 'free'|'low'|'medium'|'high',
  category: 'pure'|'read'|'write'|'exec'|'net'
}
```

**Risk classification API:**
- `safeForAutoExec()` → 91 tools safe for autonomous use
- `requiresConfirmation()` → 37 tools needing user approval
- `destructive()` → 7 tools that can cause data loss
- `riskAssessment(name)` → `{ risk: 'safe'|'low'|'medium'|'high'|'critical', reasons, meta }`

**Invariants:**
1. `destructive: true` → `requiresConfirmation: true`
2. `category: 'pure'` → `sideEffects: false`
3. `category: 'read'` → `sideEffects: false`

Full reference: [docs/tools/REGISTRY.md](tools/REGISTRY.md)

### 8. Channel Adapters

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

### 9. Memory System (v86)

Three-layer memory: LTM persistence, smart context injection, and implicit feedback learning.

```
User Input → Feedback Detector (6 signal types)
  │
  ├─ PreferenceEngine — records corrections, adjustments
  ├─ LongTermMemory — confidence decay (half-life 69d), reinforcement
  └─ PatternTracker — cross-conversation intent sequences, topic affinity

Context Assembly:
  extractLTMContext() → InjectionRanker.rankForContext()
    score = effectiveConfidence × relevance
    relevance = 0.4×keyword + 0.45×intentAffinity + 0.15×recency
  → buildBudgetedContext(intent) → token-limited prompt injection
```

**Key files:** `src/memory/` (long-term.js, injection-ranker.js, feedback-detector.js, pattern-tracker.js, preferences.js), `src/db/data-retention.js`

### 10. IDE Settings UI (v87)

10-section settings with dual storage: localStorage (appearance/UI) + backend REST (config).

```
Settings UI (chat-panel-module.js)
  │
  ├─ _settingsVals — localStorage (fontSize, theme, density, uiScale)
  ├─ _bCfg — backend sync (GET/POST /api/settings, debounced 500ms)
  │
  ├─ Sections: Account, LLM, Memory, Notifications, Output,
  │             Appearance, System, Storage, Backup, About
  │
  ├─ GPU Detection — GET /api/system/gpu → profile.gpus[]
  ├─ Model Selector — GET /api/system/models (Ollama proxy)
  ├─ Notification Channels — GET /api/notifications/channels
  └─ Storage — GET /api/system/info (DB size, migrations, tables)
```

**Theia integration:** 60+ preference keys in `c3-settings` extension (`settings-protocol.ts`). WS sync for `c3.features.*`, `c3.llm.*`, `c3.memory.*` prefixes via `settings-module.ts`.

### 11. Smart Relay Management + Typing Indicator (v90)

**Relay routing:** Center-to-relay routing replaced `targetSession` (legacy manual picker) with `_smartRouteToRelay()` — automatic free-relay detection, expansion (up to 3), and picker dialog fallback.

```
_smartRouteToRelay(callback)
  │
  ├─ _findFreeRelay() → switch to empty relay
  ├─ _sessionCount < 3 → expand + new relay
  └─ All occupied → _relayPickDialog overlay → user picks

"+" button (_newChatInProject):
  1. Current pane empty → reset in-place
  2. Has project → in-project/free choice dialog
  3. Other relay empty → switch there
  4. Can expand → add relay
  5. All full → relay picker dialog
```

**Label persistence:** `_label` field on each session — snapshot at open time, persisted to localStorage, restored on crash recovery. Rendering prefers `_label`, falls back to `PROJECTS`/`CONVERSATIONS` lookup.

**Thinking indicator:** Per-session `_thinking` state (`{text, ts}`) — set on send, cleared on `chat:message`, updated from `agent:log` events. Three animated dots (CSS `c3-thinking-dot` keyframes) + live status text showing what C3 is currently doing.

**Key helpers:** `_isSessionEmpty(s)`, `_findFreeRelay(excludeIdx)`, `_smartRouteToRelay(callback)`, `_resetSessionToClean(s)`

### 12. Domain Capabilities + Executor Expansion (v90)

**Domain Registry:** Tag-based matching of user requests to pre-built scaffolds and infra recipes. D1 planner receives matched domains in system prompt for informed plan generation.

```
DomainRegistry
  ├─ 8 scaffolds (express-api, react-app, fullstack, next-app, vue-app,
  │                python-fastapi, cli-tool, flutter-app)
  ├─ Recipes (docker, k8s, nginx, CI/CD, monitoring)
  └─ matchRequest(text) → { recipes[], scaffolds[] }
      └─ extractTags() → keyword→tag mapping (26 tags)
```

**Skills shell whitelist (v90):** Expanded from 11 to 35+ commands. Covers package managers (npm, yarn, pnpm, pip), runtimes (python, deno, bun), build tools (tsc, eslint, cargo, go, flutter), git, docker, and filesystem ops. Timeout increased 30s → 120s.

**Workflow pipeline (v90):**
```
D1 plan → CODE implement → BUILD_VERIFYING → R2 review → D2/R1 loop
                              │
                              ├─ detect build command (pkg.json, Cargo, go, Make)
                              ├─ execute build (180s timeout)
                              ├─ PASS → R2 review
                              └─ FAIL → parse errors → D2 diagnose → CODE fix (max 3)
```

### 13. IDE Boot Fix + Right Panel Recovery (v90.1)

**Status widget circular dependency:** `toDynamicValue` resolving `StatusBar` during binding created a circular deadlock (StatusBar -> FrontendApplicationContribution -> C3StatusBarContribution -> StatusBar). Fixed with `toConstantValue(_statusInstance)` and lazy `StatusBar` resolution in `onStart()` via `window.theia.container`.

**`decorate()` void return bug:** `C3StatusBarContribution = inversify_1.decorate(...)` set class to `undefined` (decorate returns void). Masked by the deadlock. Fixed by calling `decorate()` without reassignment.

**Right panel snap-collapse race:** After cache clear, Theia's default right panel width < 300px threshold. ResizeObserver immediately snap-hid the chat panel. Fixed with `_c3SnapLock=true` during startup + `a.shell.resize(420,'right')` in `onStart` with 500ms delay.

**Center view null default:** v90 changed `_centerState.view` from `'expertises'` to `null`, showing blank welcome screen after cache clear. Fixed with fallback: `lastView || 'expertises'`.

**Key files:** `c3-ide/extensions/c3-status-widget/lib/browser/status-widget-module.js`, `c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js`

---

## Database Schema

55+ tables in SQLite (better-sqlite3), 21 migrations:

| Group | Tables |
|-------|--------|
| Chat | conversations, messages, attachments, chat_sessions |
| Agents | agents_v33, agent_runs_v33, agent_notifications_v33, agent_data_v33, agent_seen_items_v57, agent_schedule_v33 |
| Projects | projects, project_lifecycles, milestones, change_requests, drift_checks |
| Lifecycle | lifecycle_handoff_state (crash recovery) |
| Expertises | expertises, expertise_bindings, expertise_memory, conversation_expertises (v63 N:M max 3) |
| Expertise Audit | merge_audit_log, capability_drift_log, llm_execution_log (v63.3) |
| CRE Audit | **cre_override_log** (v64.0 — Gatekeeper override/intercept audit trail) |
| Memory | global_memory, user_memory, project_memory, memory (LTM v86) |
| Skills | skill_executions, skill_steps, workflow_patterns (v85) |
| Quality | quality_scores (v80) |
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
  expertises: process.env.C3_ENABLE_EXPERTISES !== 'false', // Phase D
  skills:    process.env.C3_ENABLE_SKILLS !== 'false',     // v85: Skills
}
// Runtime hot-toggle via FeatureManager singleton (v85)
// IDE sync: c3.features.* → WS sync_settings → featureManager.setEnabled()

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

2400+ verified deterministic tests across 100+ test files:

| Suite | Tests | Focus |
|-------|-------|-------|
| CRE comprehensive | 401 | Intent classification |
| v583 tier1 | 94 | Core CRE regression |
| Lifecycle unit | 103 | State machine, persistence, deps |
| Lifecycle E2E | 83 | Phase C lifecycle, crash recovery |
| Phase B workers | 73 | B0/B4/B6/B8/B9 |
| Lifecycle advanced | 71 | Multi-session, disk I/O, git |
| Notifications | 67 | Channels, routing, policy |
| RSS sources | 47 | RSS/Atom parsing |
| Workflow | 42 | Planner workflow |
| Milestone size | 40 | Size validation, split suggestions |
| Merge engine | 40 | Multi-expertise composition, token budget, inheritance |
| Expertise system | 40 | Single expertise flow, built-in expertises |
| Expertise wizard | 38 | Validation, modules, capabilities |
| Capability enforcer | 38 | 5D evaluators, drift, strict, retry, trace |
| Trust feedback | 34 | Auto-degrade/mute |
| Execution trace stress | 20 | 3-expertise merge + strict + drift + trace reconstruction |
| Agent runner | 20 | HUNTER, mark_seen |
| Merge compatibility | 16 | 5D pairwise conflict detection |
| Merge-enforcement integration | 15 | Merge → ExpertiseEnforcer pipeline |
| Multi-source integration | 14 | RSS+HTTP, _merged, partial failure |
| Expertise integration | 10 | Expertise + DB + handler pipeline |
| **E2E Quality Deep** | **36** | **LLM output quality: S/R/F/T categories (89% — 32/36)** |
| Skills system | 44 | Registry, resolver, runner, 7 step types |
| Agent log UX | 44 | E2E: SYSTEM_STEP protocol, 15 hooks |
| Expertise routing | 43 | GUARD 6 creative override correctness |
| Expertise comparison | 78 turns | E2E: expertise vs non-expertise quality |
| Memory system | ~50 | LTM, injection-ranker, feedback, patterns |
| Project welcome | 41 | State reader, welcome generator, edge cases |
| **Executor capabilities** | **85** | **Shell whitelist, BUILD_VERIFYING, scaffolds, CODE→BUILD** |
| + additional suites | ~100 | Various subsystems |

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

Agents, lifecycle, and expertises are independently toggleable. Disabled features are never loaded (lazy import).

### 6. UTF-8 First

All notification channels use JSON body (not HTTP headers) to support Czech diacritics.

### 7. Agent Builder Wizard (v65.5)

Backend is single source of truth — `GET /api/agents/schema` returns types, presets, allowed values. FE never hardcodes agent schema.

```
User clicks "+ Worker" → _awOpen('create')
  → FE fetches /api/agents/schema (presets from BE)
  → User fills wizard (simple 3-step or advanced 5-section)
  → _awSave() → auto dry-run (normalizeAgentDefinition + agentRunner.dryRun)
    → valid:false? Show errors, DON'T save
    → valid:true? POST /api/agents (with normalized definition)
      → 409 collision? Append timestamp suffix, retry
```

`normalizeAgentDefinition()` in `schema.js`: deep clone → regenerate IDs (src-1, cond-1, trig-1) → remap cross-references → validate integrity → clamp defaults → return `{definition, errors[], warnings[]}`.

---

## Phase Status

| Phase | Completion | Key Components |
|-------|-----------|----------------|
| A (CRE) | 100% | Intent classification (19 types), decision matrix, QGv2, GUARD 6, attachment guard |
| B (Workers) | 95% | Runner, scheduler, sources, notifications, multi-source |
| C (Lifecycle) | **100%** | Milestones, crash recovery, multi-session, quality scoring |
| D-int (Integration) | 100% | Rate monitor auto-registration |
| D (Expertises) | **92%** | 15 built-in expertises, merge engine, 5D capabilities, enforcement, wizard UI |
| D-obs (Observability) | **100%** | ExecutionTrace ID, LLM execution log, capability drift log, specialist telemetry |
| E (IDE) | **78%** | C3 Studio (Theia 1.65.2), 33 extensions, Settings UI (10 sekcí), agent log UX |
| F (Packaging) | **25%** | Setup wizard, auto-updater, license system |

**Overall: ~98% complete**

---

*This document reflects C.3 Agent Platform v90.0.0 architecture (2026-02-28).*
