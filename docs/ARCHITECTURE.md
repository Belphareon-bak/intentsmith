# C.3 Agent Platform — Architecture v121

**Version:** v121.0.0
**Status:** Production-ready
**Date:** 2026-03-11

---

## Executive Summary

C.3 is a conversational AI platform combining:

1. **CRE (Conversational Reasoning Engine)** — Authoritative dialog management, intent classification (19 types), epistemic correctness
2. **Agent Platform** — Deterministic worker agents with source fetching, conditions, triggers, notifications
3. **Project Lifecycle** — Milestone-based project management with crash recovery, checkpoint modes, adaptive retry
4. **Specialist System** — Self-contained plugin packages with ctx.registries API, CapabilityRegistry (N:M), manifest v2, deterministic boot, fail-safe lifecycle
5. **Notification Pipeline** — Multi-channel delivery (email, Telegram, ntfy.sh push), trust feedback, digest batching
6. **Skills System** — Deterministic macro-recipes (LLM, template, write, shell steps), meta-skill for creation
7. **Guarded Autonomy** — Self-tuning CRE parameters via telemetry-driven drift detection
8. **Memory System** — LTM persistence, injection ranking, feedback detection, pattern tracking
9. **Code Intelligence** — 33-module pipeline: symbol index, knowledge graph, architecture detection, graph expansion, context building
10. **Execution Engine** — Patch engine (3-tier anchor), error normalizer (14 codes), iterative fix loop, strategy selection, self-critique, scope limiter
11. **Prompt Pipeline** — Unified structured prompt builder (12 sections, adaptive weighting), KG-based import map, signature cache
12. **Architecture Governance** — Cross-milestone drift enforcement, API contract tracking, critic/repair agent, regression prediction
13. **Model Upgrade System** — Curated catalog (55 models), pairwise evaluation, feasibility gate, proposal store, chat-based approval, empirical scoring (Phase 3)
14. **Task Memory** — Persistent cross-milestone learning, cross-project pattern sharing, decay-based relevance

All decisions flow through CRE — LLM is the text generator, never the authority.

---

## System Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           User Interface                                  │
│                     (Web UI / CLI / IDE / API)                            │
├───────────────────────────────────────────────────────────────────────────┤
│                         Channel Adapters                                  │
│               (CLI, Web, Slack, Discord, API)                             │
│               C3InputEvent → normalize → C3OutputEvent                    │
├──────────────┬──────────────────────────────────┬─────────────────────────┤
│              │                                  │                         │
│  ┌───────────▼───────────┐          ┌───────────▼──────────────┐         │
│  │    Chat Pipeline       │          │   Agent Platform          │         │
│  │                        │          │                           │         │
│  │  CRE → Intent          │          │  Scheduler → Runner       │         │
│  │  → Handler → LLM       │          │  → Sources → Conditions   │         │
│  │  → Gate → Response     │          │  → Triggers → Actions     │         │
│  └───────────┬────────────┘          └───────────┬───────────────┘         │
│              │                                   │                         │
│  ┌───────────▼────────────┐          ┌───────────▼───────────────┐        │
│  │  Expertise System       │          │  Notification Pipeline    │        │
│  │  15 expertises, 5D      │          │  Policy → Router          │        │
│  │  Merge + Enforce        │          │  → Channel → Delivery     │        │
│  └───────────┬─────────────┘          └──────────────────────────┘        │
│              │                                                             │
│  ┌───────────▼────────────┐          ┌────────────────────────────┐       │
│  │  Skills System          │          │  Guarded Autonomy          │       │
│  │  Registry → Resolver    │          │  Aggregator → Drift Det.   │       │
│  │  → Runner → Steps       │          │  → Controller → Threshold  │       │
│  └─────────────────────────┘          └────────────────────────────┘       │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │              Project Lifecycle (Phase C)                              │  │
│  │   SPEC → BUILD → REVIEW → milestones (crash recovery, multi-session) │  │
│  │                        │                                              │  │
│  │   ┌────────────────────▼──────────────────────────────────────┐      │  │
│  │   │           Execution Engine (F-series)                      │      │  │
│  │   │  normalizeErrors → selectStrategy → LLM → parsePatch      │      │  │
│  │   │  → applyPatch → test → selfCritique → taskMemory          │      │  │
│  │   └───────────────────────────────────────────────────────────┘      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌────────────────────────────┐     ┌──────────────────────────────────┐  │
│  │  Code Intelligence          │     │  Memory System                   │  │
│  │  33 modules, 11,463 LOC     │     │  LTM + Task Memory + Cross-Proj  │  │
│  │  Symbol Index + KG + BFS    │     │  Decay + Reinforcement + Ranking  │  │
│  │  Context → LLM → Answer     │     └──────────────────────────────────┘  │
│  └────────────────────────────┘                                            │
│                                     ┌──────────────────────────────────┐  │
│  ┌────────────────────────────┐     │  Model Upgrade System            │  │
│  │  Architecture Governance    │     │  Discover → Rank → Propose       │  │
│  │  Guardian + Contracts       │     │  → Approve → Pull → Apply        │  │
│  │  + Critic/Repair            │     └──────────────────────────────────┘  │
│  └────────────────────────────┘                                            │
├────────────────────────────────────────────────────────────────────────────┤
│                         Database (SQLite)                                   │
│                    80+ tables, 34 migrations, prepared statements           │
├────────────────────────────────────────────────────────────────────────────┤
│                      LLM Gateway (Ollama)                                  │
│           qwen3.5:27b (CHAT/CODE), deepseek-r1:32b (D1/R1), 7 roles      │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/                              # 126,566 lines / 349 files / 29 directories
├── server.js                     # Express HTTP server (port 3335)
├── config.js                     # Feature flags, model bindings, timeouts
├── routes/                       # 14 files — HTTP route handlers
│   ├── agents.js                 #   Agent CRUD + schema + dry-run
│   ├── projects.js               #   Projects + lifecycle/start
│   ├── expertises.js             #   Expertise CRUD + merge-preview
│   ├── notifications.js          #   Notification endpoints
│   ├── memory.js                 #   Memory/preferences
│   ├── chat.js                   #   Chat REST endpoints
│   └── system.js                 #   Health, config, version
├── agents/                       # 14 files, 6,510 LOC — Agent platform
│   ├── runner.js                 #   Execution engine
│   ├── scheduler.js              #   Cron/interval scheduling
│   ├── repository.js             #   SQLite CRUD
│   ├── conditions.js             #   Deterministic evaluator (7 types)
│   ├── triggers.js               #   Edge detection (rising/falling/any)
│   ├── multi-source.js           #   Cross-source dedup, health tracking
│   ├── schema.js                 #   Validation whitelist + normalize
│   └── sources/                  #   Source adapters (RSS, HTTP)
├── chat/                         # 72 files, 30,737 LOC — Chat pipeline
│   ├── controller.js             #   ChatController entry point
│   ├── cre-decision.js           #   CRE intent classification
│   ├── handlers/                 #   19 intent-specific processors
│   │   ├── conversation.js       #     Main router
│   │   ├── decisions.js          #     TOOL_CALL, ANSWER, REFUSE
│   │   ├── pre-handler.js        #     Shared intercept registry
│   │   ├── lifecycle-router.js   #     Phase C lifecycle intercept
│   │   └── utils/                #     Synthesis, language, quality
│   └── quality/                  #   Quality gates (QGv2)
├── code-intel/                   # 33 files, 11,463 LOC — Code Intelligence
│   ├── code-search.js            #   Ripgrep/grep/Node.js fallback
│   ├── symbol-index.js           #   O(1) symbol lookup
│   ├── knowledge-graph.js        #   9 edge types, dependency graph
│   ├── graph-retrieval.js        #   BFS expansion with edge weights
│   ├── graph-query.js            #   Impact radius, cycle detection
│   ├── architecture-detector.js  #   Framework/layer/pattern detection
│   ├── context-builder.js        #   Smart truncation + token budget
│   ├── context-engine.js         #   Symbol-aware compression
│   ├── context-optimizer.js      #   Signature map, budget allocation
│   ├── impact-analyzer.js        #   BFS impact traversal + risk
│   ├── drift-detector.js         #   Layer violations, circular deps
│   ├── risk-analyzer.js          #   3-signal composite risk scoring
│   ├── pattern-miner.js          #   4 pattern types, decay-based
│   ├── concept-registry.js       #   12 concept signatures, fragmentation
│   ├── perf-analyzer.js          #   Import-aware anti-pattern detection
│   ├── dependency-manager.js     #   Multi-PM, semver, cache
│   └── ...                       #   + 17 more (AST, chunker, evolution, etc.)
├── context/                      # 3 files — Prompt Pipeline (v119)
│   ├── prompt-builder.js         #   12 sections, priority-weighted, adaptive budgets
│   ├── import-map.js             #   KG-based import resolution hints
│   └── context-delta.js          #   Incremental context diffing (FΔ)
├── patch/                        # 5 files, ~1,470 LOC — Patch Engine + Scope
│   ├── parser.js                 #   Patch ADT: file, regions, anchors
│   ├── validator.js              #   Structural + semantic validation
│   ├── applier.js                #   Bottom-up splice, atomic write
│   ├── engine.js                 #   applyPatchSet with full rollback
│   └── scope-limiter.js          #   Pre-apply scope validation (v119)
├── planner/                      # 34 files, 14,919 LOC — Lifecycle + Governance
│   ├── lifecycle.js              #   State machine (SPEC→BUILD→REVIEW)
│   ├── lifecycle-build.js        #   BUILD phase implementation
│   ├── execution-loop.js         #   Iterative fix cycle (max 8 iters)
│   ├── error-normalizer.js       #   14 error codes, root cause analysis
│   ├── fix-strategy.js           #   DETERMINISTIC/HEURISTIC/LLM_FULL/SKIP
│   ├── self-critique.js          #   LLM root-cause + patch plan + KG validate
│   ├── architecture-guardian.js  #   PRE/POST milestone drift audit
│   ├── api-contract-registry.js  #   Export tracking, breaking changes
│   ├── critic-agent.js           #   6 failure types, targeted repair
│   ├── build-strategy.js         #   Multi-signal adaptive selection
│   ├── continuous-improvement.js #   Advisory post-build quality
│   └── ...                       #   + workflow, progress, context
├── expertises/                   # 30 files, 12,520 LOC — Expertise System
│   ├── expertise-layer.js        #   15 built-in expertises, registry
│   ├── merge-engine.js           #   15-step pure function merge
│   ├── merge-compatibility.js    #   5D pairwise conflict detection
│   ├── capability-enforcer.js    #   Post-response drift validation
│   ├── specialist-runtime.js     #   D1: Tool-augmented expert framework
│   └── ...                       #   + knowledge-base, scenario-engine
├── memory/                       # 9 files, 3,130 LOC — Memory subsystem
│   ├── long-term.js              #   LTM persistence, decay, reinforcement
│   ├── task-memory.js            #   Cross-milestone learning (F5)
│   ├── cross-project-learner.js  #   Cross-project pattern sharing (F14)
│   ├── injection-ranker.js       #   Score = effConf × relevance
│   ├── feedback-detector.js      #   6 signal types
│   ├── pattern-tracker.js        #   Cross-conversation learning
│   └── preferences.js            #   User preference tracking
├── upgrade/                      # 11 files, ~3,800 LOC — Model Upgrade System (Phase 2 + 3)
│   ├── model-profiles.js         #   Model capabilities + family definitions
│   ├── model-discovery.js        #   L1 local + L2 catalog + L3 hints
│   ├── model-catalog.js          #   55-model curated catalog with benchmarks
│   ├── model-ranker.js           #   Pairwise evaluation, per-role scoring
│   ├── proposal-store.js         #   DB-backed proposals (cooldown, dismiss, anti-thrashing)
│   ├── preference-tracker.js     #   Implicit preferences from user actions
│   ├── registry-client.js        #   Online verification (ollama.com HEAD check)
│   └── upgrade-manager.js        #   Phase 2 pipeline: feasibility → pairwise → store
├── architect/                    # 13 files, 4,007 LOC — Architecture Intelligence
│   ├── architecture-policy.js    #   Unified policy, load priority
│   ├── refactor-agent.js         #   Smell detection → risk-gated plan
│   ├── regression-predictor.js   #   Composite risk formula
│   ├── runtime-feedback.js       #   Parse test/build output
│   ├── project-knowledge-base.js #   Incremental snapshot
│   ├── milestone-decomposer.js   #   Auto-split >1500 LOC
│   └── multi-agent.js            #   5-role pipeline
├── notifications/                # 19 files — email, telegram, ntfy, push
├── skills/                       # 12 files — Registry → Resolver → Runner
├── domains/                      # 12 files — Scaffolds (8 templates) + recipes
├── llm/                          # 6 files — Gateway, client, web-search
├── tools/                        # 2 files — Tool registry (153 tools)
├── executor/                     # 8 files — Tool executor, circuit breaker
├── autonomy/                     # 3 files — Guarded autonomy, drift detection
├── channels/                     # 3 files — Channel adapters
├── db/                           # 36 files — Schema (80+ tables) + 34 migrations
├── core/                         # 5 files — Logger, error handler
├── telemetry/                    # 2 files — Metrics, alerts
├── system/                       # 2 files — GPU detection, system info
├── context/                      # 1 file — Context management
├── specialists/                  # 1 file — Specialist runtime
├── licensing/                    # 1 file — License system
├── setup/                        # 1 file — Setup wizard
├── packaging/                    # 1 file — Electron builder
├── ui/                           # 2 files — UI components
└── ws-bridge/                    # 5 files — IDE WebSocket bridge
```

---

## Core Components

### 1. CRE (Conversational Reasoning Engine)

Single authority for all dialog decisions. **CRE Gatekeeper** ensures all decision creation outside `decide()` routes through `overrideDecision()` (with audit trail) or `logIntercept()` (for pre-CRE stateful routes).

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

**10 CRE Guards** enforce context-sensitive overrides:
- GUARD 6 (Creative Lock): creativeLock/outputBias → SEARCH/AMBIGUOUS overridden to CREATIVE
- GUARD 7 (BUILD Confidence): Reduces confidence for deferred build intent
- GUARD 10 (BUILD Deferral): Czech morphology stem-based deferral detection

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

### 3. Notification Pipeline

```
Agent action (notify) or API call
  │
  ▼
NotificationPipeline.process(ctx)
  ├─ NotificationPolicy → muted? priority threshold? digest mode?
  ├─ NotificationRouter → dispatch to channel
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

Milestone-based project management with crash recovery and checkpoint architecture.

```
SPEC → BUILD → REVIEW → next milestone or COMPLETED
  │                         │
  └── Crash recovery ───────┘
      (lifecycle_handoff_state table, DB write-through)
```

**BUILD phase:** Real test execution via `C3ToolExecutor` (shell sandbox, timeout 120s). Pre-execution hard limit on milestone size. Post-execution git diff scope check.

**Build Verification Loop:** `BUILD_VERIFYING` state between CODE and R2 review. Auto-detects build command from project config (package.json, Cargo.toml, go.mod, Makefile, etc.). On failure: parse errors → diagnose → fix → retry (max 3).

**Checkpoint Architecture (v92):** Three modes — STRUCTURAL (files exist, syntax OK), FUNCTIONAL (logic correct, defer tests), SECURITY (full audit). Mode assignment: explicit from roadmap LLM > positional heuristic (first=STRUCTURAL, last=SECURITY, rest=FUNCTIONAL). Adaptive retry with `fix_instructions[]` feedback.

**Multi-session (C4):** New session auto-detects active lifecycle for same project. RAM lookup via `getLcStateByProject(projectId)` + DB fallback.

### 5. Expertise System (v63+)

15 built-in domain expertises with 5D capability profiles, multi-expertise merge, auto-selection, enforcement pipeline.

Full documentation: **[EXPERTISES.md](EXPERTISES.md)**

```
User Input → Auto-Select (vocabulary-based, <1ms, no LLM)
  │
  ▼
Expertise Handler
  │
  ├─ Single expertise → systemPrompt + LLM + enforce
  │
  └─ Multiple expertises (max 3)
       ├─ checkCompatibility() — 5D pairwise conflict detection
       ├─ resolveInheritance() — parent chain (max depth 4)
       ├─ mergeExpertisePrompt() — 15-step pure function
       ├─ LLM generation (with merged prompt + temperature)
       ├─ ExpertiseEnforcer — forbidden phrases, min length, retry
       ├─ enforceCapabilities() — 5D drift detection (deterministic)
       └─ logLlmExecution() — model, latency, prompt hash
```

**15 Built-in Expertises** (5 categories):

| Category | Expertises |
|----------|-----------|
| Tvurci & Narativni | Spisovatel, DnD Master, Textar |
| Analyticko-rozhodovaci | Analytik, Prekupnik, Ucetni |
| Normativni & Odpovednostni | Pravnik, Lekar, Psycholog |
| Technicko-odborni | AI Expert, Vyvojar, Technik |
| Domenovi znalci | Autickar, Motorkar, Politicky analytik |

**Key Concepts:**
- **5D Capability Vector** (0-100): reasoning, creativity, determinism, riskTolerance, verbosity
- **Auto-Select**: Tier 1 vocabulary overlap + Tier 2 boost patterns + hysteresis (no LLM, <1ms)
- **Specialist Runtime** (D1): Tool-augmented experts (e.g. accountant with tax/VAT calculators)
- **Knowledge Base** (D2): Versioned fact store (domain/category/key/year with provenance)
- **Scenario Engine** (D3): Multi-step guided workflows

### 6. Quality Gate v2 (QGv2)

4-layer deterministic pipeline after every LLM response. Pure functions, no LLM calls.

```
LLM Response → QGv2 Pipeline
  ├─ Layer 1: Structural — min/max length, format validation
  ├─ Layer 2: Language — SK→CZ transliterator (160 rules), language validation
  ├─ Layer 3: Intent Guarantees — LinkGuard (≥2 source links for SEARCH)
  └─ Layer 4: Content — topic drift, completeness checks
```

### 7. Tool Registry (153 tools)

Central catalog of all executable tools across 35 categories. Each tool has typed parameters, capability metadata (`sideEffects`, `idempotent`, `destructive`, `costLevel`, `category`), and structured return values.

**Risk classification API:**
- `safeForAutoExec()` → 91 tools safe for autonomous use
- `requiresConfirmation()` → 37 tools needing user approval
- `destructive()` → 7 tools that can cause data loss

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

Supported: CLI, Web, Slack, Discord, API.

### 9. Memory System

Three-layer memory architecture: LTM persistence, smart context injection, and implicit feedback learning.

```
User Input → Feedback Detector (6 signal types)
  ├─ PreferenceEngine — records corrections, adjustments
  ├─ LongTermMemory — confidence decay (half-life 69d), reinforcement
  └─ PatternTracker — cross-conversation intent sequences, topic affinity

Context Assembly:
  extractLTMContext() → InjectionRanker.rankForContext()
    score = effectiveConfidence × relevance
    relevance = 0.4×keyword + 0.45×intentAffinity + 0.15×recency
  → buildBudgetedContext(intent) → token-limited prompt injection
```

### 10. Code Intelligence (v95-v102)

33-module pipeline for codebase understanding, search, and analysis.

```
Query → expandQuery() → symbolIndex → searchCode()
  → rankFiles() → graphExpansion → buildCodeContext() → LLM → answer
```

**Module groups:**

| Group | Modules | Purpose |
|-------|---------|---------|
| Search | code-search, query-expander, file-discovery | Multi-engine code search |
| Index | symbol-index, index-builder, streaming-indexer | O(1) symbol lookup, reactive updates |
| Analysis | code-analyzer, ast-analyzer, architecture-detector | Structure extraction, framework detection |
| Graph | knowledge-graph, graph-retrieval, graph-query, impact-analyzer | 9 edge types, BFS expansion, impact traversal |
| Context | context-builder, context-engine, context-optimizer, chunker | Symbol-aware compression, token budgets |
| Detection | drift-detector, dead-code-detector, risk-analyzer | Layer violations, unreachable code, 3-signal risk |
| Advanced | exploration-agent, execution-graph, test-coverage-explorer, code-evolution, pattern-miner, perf-analyzer, dependency-manager, concept-registry, refactor-agent, regression-predictor | Autonomous exploration, anti-patterns, dependency upgrades |

**Knowledge Graph:** 9 edge types (IMPORTS, EXPORTS, CALLS, INHERITS, IMPLEMENTS, USES, TESTED_BY, DEPENDS_ON, CONTAINS). Map-based storage, hub penalty scoring, namespace boost, priority BFS with edge weights.

**BUILD Context Enrichment:** `buildCodeContextForMilestone()` in lifecycle-build.js — lazy-loaded via `ensureCodeIntel()`, graceful degradation. 5 files / 5K tokens budget.

### 11. Execution Engine (v104-v119)

Iterative code fix pipeline — patches code, runs tests, learns from failures.

```
Milestone code → test → errors?
  │
  ▼
Execution Loop (max 8 iterations)
  ├─ normalizeErrors (14 error codes, root cause analysis)
  ├─ selectStrategy (DETERMINISTIC / HEURISTIC / LLM_FULL / SKIP)
  ├─ computePatchScope (v119: KG-based target + 1-hop deps/dependents)
  ├─ buildImportMap (v119: KG IMPORTS→DEFINES symbol resolution)
  ├─ buildFixPrompt (scope hint + import map + task memory + cross-project)
  ├─ LLM generates fix
  ├─ validatePatchScope (v119: pre-apply scope check)
  ├─ parsePatch (Patch ADT: file, regions, anchors)
  ├─ validatePatch (structural + semantic)
  ├─ applyPatch (bottom-up splice, atomic write, rollback on failure)
  ├─ run tests → converged? → done
  ├─ selfCritique (iteration ≥ 2: LLM root-cause + patch plan + KG validation)
  └─ taskMemory.recordFix() → persist for future iterations
```

**Patch Engine (F1):** 3-tier anchor resolution (exact → normalized → AST). Ambiguity guard rejects if matches > 1 without contextBefore. Bottom-up splice preserves line offsets. Atomic write (tmp+rename). Full rollback on patchset failure.

**Error Normalizer (F2):** 14 error codes, 32-entry error map (most-specific-first). Dual-mode: raw string or pre-parsed array. `findRootCause()` traces IMPORT_NOT_FOUND → downstream. `formatErrorsForLLM()` with separate root/other budgets.

**Self-Critique (F6):** Activates at iteration ≥ 2. LLM analyzes root cause → generates patch plan (ADD/MODIFY/DELETE/MOVE, max 10 steps) → validates against knowledge graph.

**Scope Limiter (v119):** Pre-apply scope validation. Target files + 1-hop KG deps/dependents, capped at maxFiles. ScopeViolationTracker auto-widens (3 violations → +1 hop, 5 → disable). Graceful degradation without graph.

### 12. Prompt Pipeline (v119)

Unified structured prompt assembly replacing ad-hoc prompt construction.

```
buildStructuredPrompt({sections, maxTokens, errorType, strategy})
  ├─ 12 named sections: ROLE, ERRORS, SCOPE, SIGNATURES, IMPORT_MAP,
  │   SOURCE, TASK_MEMORY, CALL_GRAPH, CROSS_PROJECT, TASK, RULES, OUTPUT_FORMAT
  ├─ Priority-weighted allocation (highest priority filled first)
  ├─ Adaptive error-type multipliers:
  │   IMPORT_NOT_FOUND → ×2.0 IMPORT_MAP, ×1.5 SIGNATURES
  │   SYNTAX_ERROR     → ×2.0 SOURCE, ×0.3 everything else
  │   TEST_FAILED      → ×1.5 SOURCE, ×1.3 TASK_MEMORY
  ├─ Smart truncation (keep complete lines, not arbitrary cut)
  └─ Audit trail: per-section token usage, truncation flags, strategy
```

**Import Map:** KG-based import resolution — traces IMPORTS edges to dependency files, then DEFINES edges to symbols. Prevents wrong import paths. Symbol conflict detection warns about same-name definitions in different files.

**Signature Cache:** FNV-1a content hash → in-memory Map. Skips AST re-parse when file content unchanged between iterations. `clearSignatureCache()` on project switch.

### 13. Architecture Governance (v98-v100)

Cross-milestone architecture enforcement and quality assurance.

```
PRE-milestone: Architecture Guardian audits
  → drift detection, pattern compliance
  → archContext injected into checkpoint

POST-milestone: Critic Agent analyzes failures
  → 6 failure types → targeted repair (not full re-exec)
  → API Contract Registry tracks breaking changes

Architecture Intelligence (v100):
  ├─ architecture-policy.js — unified policy (.c3 > ACF > auto)
  ├─ regression-predictor.js — composite (risk+coverage+centrality+churn+coupling)
  ├─ runtime-feedback.js — parse test/build output, cross-milestone patterns
  ├─ milestone-decomposer.js — auto-split >1500 LOC milestones
  └─ multi-agent.js — 5-role pipeline (planner→builder→architect→critic→debugger)
```

### 14. Model Upgrade System (v103 + v118 Phase 2 + v120 Phase 3)

Three-phase model upgrade with curated catalog, pairwise evaluation, and empirical scoring.

```
Phase 1 (v103): discover → filter → rank → propose → chat approval → pull → apply
Phase 2 (v118): catalog → discover(L1+L2+L3) → feasibility gate → pairwise evaluation
  → preference adjust → proposal store (DB) → chat approval → pull → apply
Phase 3 (v120): + empirical scoring from real execution metrics → blended benchmark+empirical

Discovery:
  L1: Local (Ollama /api/tags) — always
  L2: Catalog (55 curated models with benchmarks) — fullCycle (24h ±90min)
  L3: Family upgrade hints — always

Pairwise Evaluation (v120.2 calibration):
  scoreModel(benchmark×B + empirical×E + hwFit×0.20 + maturity×0.15 + gen×0.10 + cat×0.13 + speed×0.07 + sizePenalty)
  B+E = 0.35, blend ratio shifts with sample count:
    <10 samples:  B=0.35, E=0.00 (Phase 2 behavior)
    10-50:        B=0.25, E=0.10
    >50:          B=0.15, E=0.20
  CODE benchmark weights: swebench 0.15, livecodebench 0.40, humaneval 0.30, arena 0.15
  Category bonus: code+CODE 0.10 (was 0.05). Size floor: CODE params<20B → -0.05.
  Dominance gate bypassed when empirical delta >0.15 (Phase 3 data overrides heuristic)
  empiricalScore = patchSuccess×0.45 + checkpointPass×0.35 + efficiency×0.20
  Hard cap: empirical contribution ≤ 0.25

Metrics Collection (fire-and-forget):
  execution-loop → recordEvent(patch success, iterations, tokens, duration)
  lifecycle-build → recordEvent(checkpoint verdict, build completion)
  Batch buffer (10 events / 5s), outlier filter, recency decay (exp(-days/60)),
  Bayesian smoothing (prior=0.5, k=5), difficulty normalization, telemetry guard

Guards:
  Drift detection: recent 20 samples < historical × 0.8 → reset to Phase 2 weights
  Blacklist: patchSuccess < 0.2 after 20+ samples → exclude candidate
  Confidence: score × min(1, samples/50)

Proposal Lifecycle:
  pending → approved | rejected (30d cooldown) | dismissed (permanent) | expired (7d)
  Anti-thrashing: 14d minimum between upgrades per role
  Invalidation: catalog hash + evaluation version change → re-evaluate
```

**Safety:** Never auto-upgrades. Discovery never changes config. Runtime never touches internet. Communication only through proposals in DB.

### 15. Task Memory & Cross-Project Learning (v107-v116)

Persistent cross-milestone learning for the execution loop.

```
Execution Loop → recordFix(errorCode, file, strategy, success)
  → UPSERT with confidence update (failure→success overwrites, same→reinforce)
  → queryRelevant(errors, files) → decay-weighted results

Cross-Project (F14):
  queryCrossProject(db, {currentProjectId, errors, currentStack})
    → stack similarity (Jaccard on language/frameworks/tools)
    → relevance = errorMatch + archDecision + stackBoost + generality
    → mergeResults(local, cross) — local priority, dedup by key
```

**Decay:** λ=0.005 (half-life ~139 days). Reinforcement: +0.05 on reuse (cap 0.95). Prune: remove entries below threshold after maxAge.

---

## Skills System

Deterministic macro-recipes for repeating procedures.

```
Registry → Resolver (LLM intent match) → Runner (state machine) → Step executors
```

**Step types:** `llm`, `template`, `write` (sandboxed), `shell` (whitelisted), `ask`, `review`, `validate`

**Interactive steps:** `ask`/`review` return `{ status: 'awaiting_input' }` → AWAITING_INPUT state → `resume()`.

**Meta-skill:** `create-skill` — creates new skill definitions (ask→llm→review→validate→write). Auto-reloads registry after creation.

**Constraints:** No branching, no nested skills, shell whitelist (not blacklist), `fs.realpath()` for write paths.

---

## Database Schema

80+ tables in SQLite (better-sqlite3), 34 migrations:

| Group | Tables |
|-------|--------|
| Chat | conversations, messages, attachments, chat_sessions, chat_fts |
| Agents | agents_v33, agent_runs_v33, agent_notifications_v33, agent_data_v33, agent_seen_items_v57, agent_schedule_v33 |
| Projects | projects, project_lifecycles, milestones, change_requests, drift_checks, roadmap_versions |
| Lifecycle | lifecycle_handoff_state (crash recovery) |
| Expertises | expertises, expertise_bindings, expertise_memory, conversation_expertises, custom_expertises |
| Expertise Audit | merge_audit_log, capability_drift_log, llm_execution_log |
| CRE | cre_override_log (Gatekeeper audit trail) |
| Memory | global_memory, user_memory, project_memory, memory (LTM), task_memory |
| Skills | skill_executions, skill_steps, workflow_patterns |
| Architecture | architecture_state, api_contracts |
| Model Upgrade | model_overrides, upgrade_history, upgrade_proposals, model_catalog_cache, model_performance |
| Quality | quality_scores |
| Security | api_tokens (SHA-256 hashed) |
| Notifications | notification_channels_v57, notification_log_v57, notification_state_v57, notification_digest_buffer_v57, notification_trust_actions_v57 |
| Telemetry | telemetry_metrics, telemetry_snapshots, telemetry_alerts, telemetry_improvements |
| Specialists | specialists, specialist_expertises, specialist_memory, specialist_telemetry |
| Config | user_settings, learned_patterns, logs, session_state |

---

## Configuration

### Model Bindings (Ollama)

| Role | Model | Timeout |
|------|-------|---------|
| D1 (deliberation) | deepseek-r1:32b | 120s |
| D2 (fix) | qwen3-30b-a3b | 60s |
| CODE | qwen3.5:27b | 90s |
| R1 (review) | deepseek-r1:32b | 120s |
| R2 (quick review) | qwen3.5:27b | 45s |
| CHAT | qwen3.5:27b | 60s |
| VISION | llava:13b | 60s |

### Feature Flags

All variables loaded from `.env` (`dotenv`). Features independently toggleable via `FeatureManager` singleton. IDE sync: `c3.features.*` → WS `sync_settings` → `featureManager.setEnabled()`.

### Environment Variables

```bash
C3_PORT=3335
C3_DB_PATH=./data/c3.db
OLLAMA_URL=http://127.0.0.1:11434
C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID
C3_NTFY_SERVER, C3_NTFY_TOPIC, C3_NTFY_TOKEN
```

---

## Test Suite

3,000+ verified tests across 200+ test files:

| Suite | Tests | Focus |
|-------|-------|-------|
| CRE comprehensive | 401 | Intent classification |
| Lifecycle unit + E2E | 186 | State machine, crash recovery, multi-session |
| Phase B workers | 73 | B0/B4/B6/B8/B9 agents |
| Notifications | 67 | Channels, routing, policy |
| Expertise system | 190+ | Merge, enforce, 5D capabilities, routing, wizard |
| Skills system | 44 | Registry, resolver, runner, 7 step types |
| Memory system | 50+ | LTM, injection-ranker, feedback, patterns |
| Quality gates | 36 | E2E quality: S/R/F/T categories |
| Executor capabilities | 85 | Shell whitelist, BUILD_VERIFYING, scaffolds |
| Agent log UX | 44 | SYSTEM_STEP protocol, 15 hooks |
| **Code Intelligence** | **339** | Symbol index, KG, graph, architecture, context |
| **Execution Engine (F1-F8)** | **355** | Patch, errors, loop, strategy, critique, patterns |
| **Long-term (FΔ+F9-F14)** | **242** | Context delta, build strategy, perf, deps, learning |
| **Prompt Pipeline (v119)** | **83** | Prompt builder, import map, scope limiter, sig cache |
| Architecture governance | 57 | Guardian, contracts, critic |
| Architecture intelligence | 161 | Policy, context, refactor, predictor, KB, multi-agent |
| Large project scaling | 107 | Graph storage, BFS, streaming, concept registry |
| Model upgrade (v103+v118+v120.2) | 221 | Discovery, catalog, pairwise, proposals, approval, pull, empirical scoring |
| Project E2E | 56 | 4 project types, lifecycle, milestones |

---

## Key Design Decisions

### 1. CRE is Authority, LLM is Generator

```
WRONG: LLM decides → CRE validates
RIGHT: CRE decides → LLM generates → Gate enforces
```

### 2. Agents are Deterministic

No LLM in the agent execution loop. Sources, conditions, triggers, and mark_seen are all algorithmic.

### 3. HUNTER Pattern

`mark_seen` runs BEFORE business actions. Crash recovery doesn't cause duplicate processing.

### 4. Crash Recovery (C1)

`lifecycle_handoff_state` table persists handoff state. DB write-through. `preloadActiveLifecycles()` restores RAM on restart.

### 5. Feature Flags

Agents, lifecycle, expertises, and skills are independently toggleable. Disabled features are never loaded (lazy import).

### 6. UTF-8 First

All notification channels use JSON body (not HTTP headers) to support Czech diacritics.

### 7. Execution Engine: Patch, Don't Regenerate

The F-series execution engine parses and applies surgical patches instead of regenerating entire files. 3-tier anchor resolution ensures accuracy; bottom-up splice preserves line offsets; atomic write with rollback ensures safety.

### 8. Memory Decay

All memory systems use exponential decay: LTM (λ=0.01, half-life ~69d), Task Memory (λ=0.005, half-life ~139d). Reinforcement on reuse prevents useful entries from decaying.

---

## Phase Status

| Phase | Completion | Key Components |
|-------|-----------|----------------|
| A (CRE) | 100% | Intent classification (19 types), 10 guards, QGv2, attachment guard |
| B (Workers) | 95% | Runner, scheduler, sources, notifications, multi-source |
| C (Lifecycle) | 100% | Milestones, crash recovery, checkpoint modes, adaptive retry |
| D (Expertises) | 92% | 15 built-in, merge engine, 5D capabilities, enforcement, wizard |
| E (IDE) | 82% | C3 Studio (Theia), 33 extensions, settings UI, security, focus mode |
| F (Packaging) | 25% | Setup wizard, auto-updater, license system |
| G (Code Intel) | 100% | 33 modules, symbol index, KG, graph expansion, architecture detection |
| H (Agent Evolution) | 100% | F1-F8 core (355 tests), FΔ+F9-F14 extensions (242 tests) |
| I (Governance) | 100% | Guardian, contracts, critic, policy, regression prediction, multi-agent |
| J (Model Mgmt) | 100% | Phase 1-3: discovery, catalog (55 models), pairwise eval, proposals, empirical scoring (221 tests) |
| K (Prompt Pipeline) | 100% | Prompt builder, import map, scope limiter, signature cache (83 tests) |

---

*This document reflects C.3 Agent Platform v120.2.0 architecture (2026-03-11).*
