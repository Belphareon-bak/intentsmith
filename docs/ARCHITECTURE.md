# C.3 Agent Platform — Architecture v131

**Version:** v131.0.0
**Status:** Production-ready
**Date:** 2026-03-22

---

## Executive Summary

C.3 is a conversational AI platform combining:

1. **CRE (Conversational Reasoning Engine)** — Authoritative dialog management, intent classification (19 types), epistemic correctness
2. **Agent Platform** — Deterministic worker agents with source fetching, conditions, triggers, notifications
3. **Project Lifecycle** — Milestone-based project management with crash recovery, checkpoint modes, adaptive retry
4. **Specialist System** — Self-contained plugin packages with ctx.registries API, CapabilityRegistry (N:M), manifest v2, deterministic boot, fail-safe lifecycle
5. **Notification Pipeline** — Multi-channel delivery (email, Telegram, ntfy.sh push), trust feedback, digest batching
6. **Skills System** — Deterministic macro-recipes (9 step types incl. transform), meta-skills for expertise + specialist creation, post-completion hooks (auto-reload registries)
7. **Guarded Autonomy** — Self-tuning CRE parameters via telemetry-driven drift detection
8. **Memory System** — LTM persistence, injection ranking, feedback detection, pattern tracking
9. **Code Intelligence** — 33-module pipeline: symbol index, knowledge graph, architecture detection, graph expansion, context building
10. **Execution Engine** — Patch engine (3-tier anchor), error normalizer (14 codes), iterative fix loop, strategy selection, self-critique, scope limiter
11. **Prompt Pipeline** — Unified structured prompt builder (12 sections, adaptive weighting), KG-based import map, signature cache
12. **Architecture Governance** — Cross-milestone drift enforcement, API contract tracking, critic/repair agent, regression prediction
13. **Model Upgrade System** — Curated catalog (55 models), pairwise evaluation, feasibility gate, proposal store, chat-based approval, empirical scoring (Phase 3), L4 online discovery, L5 external benchmarks (whatllm.org)
14. **Task Memory** — Persistent cross-milestone learning, cross-project pattern sharing, decay-based relevance
15. **Marketplace** — Remote package catalog (skills, expertises, specialists), transactional install/update/uninstall, dependency resolver, mandatory SHA-256 verification, archive security
16. **Validation Suites** — 5 role-specific test suites (reasoning, code, chat, vision, review), deterministic + partial scoring, direct Ollama calls, 14d TTL, model ranker integration
17. **Upgrade UX** — Tiered rate limiting (3 tiers), async background model verification, auto-pull on approval, auto-validation prompt, fire-and-forget upgrade routes
18. **Security Hardening** — Path traversal guards (workspace, projects, attachments), input sanitization (conversationId, package IDs), mandatory SHA-256 for remote packages

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
│                    80+ tables, 36 migrations, prepared statements           │
├────────────────────────────────────────────────────────────────────────────┤
│                      LLM Gateway (Ollama)                                  │
│  qwen3.5:27b (CHAT/CODE), deepseek-r1:32b (D1/R1), 7 roles, semaphore   │
│  Concurrency: 1 slot default (single GPU), prepared for multi-GPU         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/                              # ~128,000 lines / 350+ files / 29 directories
├── server.js                     # HTTP server (dynamic port, tiered rate limiting, port file ~/.c3/port)
├── config.js                     # Feature flags, model bindings, timeouts, port, sessions, providers
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
├── upgrade/                      # 15 files, ~6,780 LOC — Model Upgrade System (Phase 2 + 3 + L4 + L5 + Validation)
│   ├── model-profiles.js         #   Model capabilities + family definitions
│   ├── model-discovery.js        #   L1 local + L2 catalog + L3 hints + L4 online + L5 external
│   ├── model-catalog.js          #   55-model curated catalog with benchmarks
│   ├── model-ranker.js           #   Pairwise evaluation, per-role scoring, confidence attenuation
│   ├── proposal-store.js         #   DB-backed proposals (cooldown, dismiss, anti-thrashing)
│   ├── preference-tracker.js     #   Implicit preferences from user actions
│   ├── registry-client.js        #   Online verification + library page fetch
│   ├── online-discovery.js       #   L4: HTML tag parsing, provisional entry builder
│   ├── benchmark-estimator.js    #   Log-space interpolation, VRAM estimation
│   ├── whatllm-client.js         #   L5: External benchmark enrichment from whatllm.org
│   ├── validation-suites.js      #   5 role-specific test suites, grading, TTL
│   └── upgrade-manager.js        #   Full pipeline: feasibility → pairwise → L4 → L5 → store
├── architect/                    # 13 files, 4,007 LOC — Architecture Intelligence
│   ├── architecture-policy.js    #   Unified policy, load priority
│   ├── refactor-agent.js         #   Smell detection → risk-gated plan
│   ├── regression-predictor.js   #   Composite risk formula
│   ├── runtime-feedback.js       #   Parse test/build output
│   ├── project-knowledge-base.js #   Incremental snapshot
│   ├── milestone-decomposer.js   #   Auto-split >1500 LOC
│   └── multi-agent.js            #   5-role pipeline
├── marketplace/                  # 2 files — Remote package marketplace (v124)
│   ├── marketplace-client.js    #   Catalog fetch, cache, download, hash, archive validation
│   └── package-installer.js     #   Transactional install, rollback, mutex, dependency resolver
├── notifications/                # 19 files — email, telegram, ntfy, push
├── skills/                       # 12 files — Registry → Resolver → Runner
├── domains/                      # 12 files — Scaffolds (8 templates) + recipes
├── llm/                          # 6 files — Gateway, client, web-search
├── tools/                        # 2 files — Tool registry (153 tools)
├── executor/                     # 8 files — Tool executor, circuit breaker
├── autonomy/                     # 3 files — Guarded autonomy, drift detection
├── channels/                     # 3 files — Channel adapters
├── db/                           # 40 files — Schema (80+ tables) + 37 migrations
├── core/                         # 5 files — Logger, error handler
├── telemetry/                    # 2 files — Metrics, alerts
├── system/                       # 2 files — GPU detection, system info
├── context/                      # 3 files — Prompt builder, import map, context delta
├── specialists/                  # 2 files — Specialist loader + capability registry
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

**11 CRE Guards** enforce context-sensitive overrides:
- GUARD 5 (Design Exclusion): DESIGN_EXCLUSION_PATTERNS block false-positive DESIGN on questions ("jak navrhnout...")
- GUARD 6 (Creative Lock): creativeLock/outputBias → SEARCH/AMBIGUOUS overridden to CREATIVE
- GUARD 7 (BUILD Confidence): Reduces confidence for deferred build intent
- GUARD 10 (BUILD Deferral): Czech morphology stem-based deferral detection
- GUARD 11 (BUILD Escalation): `.{0,60}` pattern gap for long Czech sentences, creativeLock protection

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

**Multi-session (C4):** New session auto-detects active lifecycle for same project. RAM lookup via `getLcStateByProject(projectId)` + DB fallback. Session recovery via projectId rebind (v124).

**Stability (v124):** DB write-first (attempt DB before RAM, `_dbConsistent` flag). Concurrent milestone mutex (RAM `_buildInProgress` + DB `build_locked` column). BLOCKED timeout 15 min → auto-skip with user notification. SPEC revision counter (warn@3, auto-approve@4). Cascade skip atomicity. Spec drift guard (every 4th milestone). Executor timeout (5-min AbortController). Lazy-module cleanup on shutdown.

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

### 7. Semantic Quality Layer (v128+)

Post-QGv2 semantic scoring + self-improvement loops. Complements QGv2's structural fixes with content-level quality assessment.

```
QGv2 Output → Semantic Scoring
  ├─ response-scorer.js — 5 dimensions (0–100 composite)
  │   ├─ Relevance (0.30) — keyword overlap with query
  │   ├─ Completeness (0.20) — length vs intent expectations
  │   ├─ Coherence (0.15) — structure markers, paragraphs
  │   ├─ Intent Alignment (0.20) — code blocks for CODE, URLs for SEARCH
  │   └─ Language Quality (0.15) — diacritics, SK contamination
  │
  └─ improvement-loops.js — 2 improvement loops
      ├─ Loop 1: Fast Retry (score < 60) — prompt enhancement, 0 extra LLM calls
      └─ Loop 2: Self-Refine (score < 75) — LLM critique + rewrite, 1 extra call
          ├─ Drift Guard: Jaccard similarity ≥ 0.35
          ├─ Length Guard: refined ≤ 2.5× original
          └─ Intent Lock: CODE must preserve ``` blocks
```

**Latency budget:** synthesis scores ≥ 75 bypass controller selfRefine entirely. Max path: LLM → fastRetry → selfRefine = 3 calls (typical: 1–2).

**Telemetry:** `QualityTelemetry` logger emits per-response score with dimensions, intent, and refinement status. Score included in API response as `qualityScore`.

### 8. Tool Registry (153 tools)

Central catalog of all executable tools across 35 categories. Each tool has typed parameters, capability metadata (`sideEffects`, `idempotent`, `destructive`, `costLevel`, `category`), and structured return values.

**Risk classification API:**
- `safeForAutoExec()` → 91 tools safe for autonomous use
- `requiresConfirmation()` → 37 tools needing user approval
- `destructive()` → 7 tools that can cause data loss

Full reference: [docs/tools/REGISTRY.md](tools/REGISTRY.md)

### 9. Channel Adapters

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

### 10. Memory System

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

### 11. Code Intelligence (v95-v102)

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

**Knowledge Graph:** 9 edge types (IMPORTS, EXPORTS, CALLS, INHERITS, IMPLEMENTS, USES, TESTED_BY, DEPENDS_ON, CONTAINS). Map-based storage, hub penalty scoring, namespace boost, priority BFS with edge weights. Memory ceiling: 50K nodes, 100K edges (v124). Node validation on addEdge (v124).

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

### 14. Model Upgrade System (v103 + v118 Phase 2 + v120 Phase 3 + v121.1 L4 + v131 L5)

Five-layer discovery with curated catalog, pairwise evaluation, empirical scoring, online discovery, and external benchmarks.

```
Phase 1 (v103): discover → filter → rank → propose → chat approval → pull → apply
Phase 2 (v118): catalog → discover(L1+L2+L3) → feasibility gate → pairwise evaluation
  → preference adjust → proposal store (DB) → chat approval → pull → apply
Phase 3 (v120): + empirical scoring from real execution metrics → blended benchmark+empirical
L4 (v121.1): + online discovery from ollama.com/library pages → estimated benchmarks → provisional entries
L5 (v131): + external benchmark enrichment from whatllm.org → real quality scores for L4 provisionals

Discovery:
  L1: Local (Ollama /api/tags) — always
  L2: Catalog (55 curated models with benchmarks) — fullCycle (24h ±90min)
  L3: Family upgrade hints — always
  L4: Online (ollama.com/library/{family} HTML) — fullCycle, max 3 families/cycle
  L5: External (whatllm.org qualityIndex) — fullCycle, enriches L4 provisionals

Pairwise Evaluation (v120.2 calibration):
  scoreModel(benchmark×B + empirical×E + hwFit×0.20 + maturity×0.15 + gen×0.10 + cat×0.13 + speed×0.07 + sizePenalty)
  B+E = 0.35, blend ratio shifts with sample count (v124: linear interpolation):
    <10 samples:  B=0.35, E=0.00 (Phase 2 behavior)
    10-50:        linear interpolation B: 0.25→0.15, E: 0.10→0.20
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

L4 Online Discovery (v121.1):
  Fetch ollama.com/library/{family} HTML → parse tags (href links, regex fallback)
  → estimate benchmarks (log-space interpolation from known family members)
  → provisional entry (benchmarkConfidence 0.30-0.85, source='L4')
  → persist to discovered_models DB → merge into discovery as lowest priority
  VRAM estimation: 620 * params + 420 (Q4_K_M fit)
  Family normalization: strip hyphens/underscores, lowercase, strip trailing version
  Family scaling guard: <2 catalog entries → skip interpolation, confidence=0.20
  Provisional penalty: -0.02 (catalog preferred). Ghost decay: +7d no empirical → extra -0.01
  Params jump guard: >3× param increase rejected. Capability inheritance guard.
  Ranking candidate limit: top 8 per role after scoring
  30-day pruning, 24h cache TTL, rate limit 3 families/cycle

L5 External Benchmark Enrichment (v131):
  Fetch whatllm.org HTML → parse models (multi-strategy: __NEXT_DATA__, raw JSON, __next_f.push RSC)
  → strict match to Ollama candidates (exact family + params within 10%)
  → normalize qualityIndex (0-100 composite from GPQA+AIME+LiveCodeBench+SWE-Bench+MMLU)
  → apply quantization penalty (Q4_K_M=0.92, Q5_K_M=0.96, Q8_0=0.99, FP16=1.0)
  → sets all 6 benchmark keys to same adjusted score, benchmarkConfidence → 0.85
  Only enriches candidates with benchmarkConfidence < 0.85 (preserves catalog data)
  24h cache + 1h error cooldown. MIN_MODELS=20 sanity guard. Cloud-only models rejected (require params).
  File: src/upgrade/whatllm-client.js (~330 LOC)

Guards:
  Drift detection: recent 20 samples < historical × 0.8 → reset to Phase 2 weights
  Blacklist: patchSuccess < 0.2 after 20+ samples → exclude candidate
  Confidence: score × min(1, samples/50)

Proposal Lifecycle:
  pending → approved | rejected (30d cooldown) | dismissed (permanent) | expired (7d)
  Anti-thrashing: 14d minimum between upgrades per role
  Invalidation: catalog hash + evaluation version change → re-evaluate
  Atomic dedup: storeProposal() wrapped in db.transaction() (v124)
  Auto-cleanup: expireStale(7) at start of each evaluation cycle (v124)
```

**Safety:** Never auto-upgrades. Discovery never changes config. Runtime never touches internet. Communication only through proposals in DB.

**Validation Suites (v123):**
```
5 suites: reasoning (D1/D2/R1), code (CODE), chat (CHAT), vision (VISION), review (R2)
Deterministic grading: JSON.parse, regex, keyword matching, diacritics check + partial scoring
Direct Ollama calls (bypass gateway): temperature 0.1, top_p 0.9, num_predict 512, timeout 30s
DB: validation_results + validation_suite_scores (migration 034), INSERT OR REPLACE
TTL 14d, blacklist score < 0.2, vision guard (skip if no vision capability)
Model ranker: validationScore × 0.05 bonus in scoreModel(), role-specific suite mapping
API: POST /api/system/models/validate, GET /api/system/models/validation-scores
```

**Upgrade UX (v125):**
```
Tiered Rate Limiting:
  Tier 0 — Exempt (no limit): OPTIONS, /api/health, WebSocket upgrades
  Tier 1 — Read (600 req/min): all GET endpoints
  Tier 2 — Write (120 req/min): all POST/PUT/DELETE endpoints
  Localhost disabled: rate limiting OFF when binding to 127.0.0.1
  Proxy support: C3_TRUST_PROXY=true → reads X-Forwarded-For / X-Real-IP

Async Background Verify:
  applyUpgrade() → instant HTTP 200 → _backgroundVerify(3 attempts × 30s delay)
  Never auto-rollbacks — sets verified=0 in DB + WS warning
  DB: model_overrides.verified column (migration 036)

Auto-Pull on Approval:
  Non-installed model → auto-pull via pullModel() with streaming WS progress
  Fire-and-forget route: POST /api/system/upgrades/apply → HTTP 200 immediately
  WS events: upgrade_progress, model_changed, upgrade_error, model_pull_progress

Auto-Validation Prompt:
  After model_changed → emit model_validation_prompt with suite info
  FE shows consent notification → user clicks "Spustit" → existing validation pipeline

Dynamic Port Allocation:
  Default port 0 (OS-assigned). Port file ~/.c3/port (JSON: port, host, pid, started).
  Stdout signal: C3_READY:<port> for parent process detection.
  IDE discovery: window.electronC3.getBackendUrl() via contextBridge preload.
  FE fallback: 127.0.0.1:3335 if electronC3 unavailable.

Multi-Session Infrastructure (prepared, not activated):
  config.sessions.maxConcurrentLLM=1 (default), LLM gateway concurrency semaphore
  computeSessionCapacity() counts dedicated GPUs (≥6GB VRAM each = 1 slot)
  config.providers.active='ollama' — stub for future OpenAI-compatible API
```

### Security Hardening (v126)

```
Path Traversal Guards:
  C1: customPath on project creation → bounded to os.homedir()
  C2: conversationId in attachment paths → reject /, \, .., null bytes
  C3: Workspace file/directory endpoints → always validate traversal
      (removed falsy data.root guard that skipped check)

Input Sanitization:
  conversationId: /[\/\\]|\.\.|\0/.test() → reject 400
  Package ID: /[\/\\]|\.\.|\0/.test() + length > 128 → reject
  All path.join() with user input: post-join startsWith() validation

Package Integrity (mandatory SHA-256):
  Remote downloads MUST include sha256 field — omission = rejection
  Streaming hash verification during download (no separate pass)
  File cleanup on mismatch or missing hash before throwing
```

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

80+ tables in SQLite (better-sqlite3), 37 migrations:

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
| Model Upgrade | model_overrides, upgrade_history, upgrade_proposals, model_catalog_cache, model_performance, discovered_models, validation_results, validation_suite_scores |
| Marketplace | marketplace_packages, marketplace_catalog_cache |
| Quality | quality_scores |
| Security | api_tokens (SHA-256 hashed) |
| Notifications | notification_channels_v57, notification_log_v57, notification_state_v57, notification_digest_buffer_v57, notification_trust_actions_v57 |
| Telemetry | telemetry_metrics, telemetry_snapshots, telemetry_alerts, telemetry_improvements |
| Specialists | specialists, specialist_expertises, specialist_memory, specialist_telemetry |
| Config | user_settings, learned_patterns, logs, session_state |

---

## Configuration

### Model Bindings (Ollama)

| Role | Default Model | Timeout | Usage |
|------|---------------|---------|-------|
| D1 (deliberation) | deepseek-r1:32b | 120s | Planning, analysis, roadmap generation |
| D2 (fix) | qwen3-30b-a3b | 60s | Fix deliberation, error analysis |
| CODE | qwen3.5:27b | 90s | Code generation, implementation |
| R1 (review) | deepseek-r1:32b | 120s | Final milestone review, security audit |
| R2 (quick review) | qwen3.5:27b | 45s | Quick code review, checkpoint validation |
| CHAT | qwen3.5:27b | 60s | User conversation, synthesis, all non-workflow LLM calls |
| VISION | llava:13b | 60s | Image understanding, screenshot analysis |

### LLM Gateway & Model Selection

Model selection is **purely static** — there is no adaptive layer that chooses models based on task complexity, token count, or runtime heuristics.

**Resolution pipeline:**

```
config.models[role]          ← base binding (config.js / env var)
  ↑ mutated by
upgradeManager.applyUpgrade()  ← user-approved upgrade (persisted to model_overrides DB)
  ↑ loaded at startup by
upgradeManager.loadPersistedOverrides()  ← restores overrides from DB into config
```

**Every LLM call** reads `config.models[role]` at call time:

```
User Query
  → CRE classifies intent
  → Handler calls synthesizeWithLLM() or callLLM(role)
  → creBridge.generateChatResponse(prompt, { model: config.models.CHAT })
  → llmGateway.call(prompt, { model })
  → Ollama /api/chat
```

**Key principles:**
- **No routing by complexity** — a simple "ahoj" and a complex synthesis both use the same CHAT model
- **No fallback chains** — if a model fails (OOM, timeout), the call fails; no automatic switch to a smaller model
- **Role = model** — each role maps to exactly one model at any time
- **Override is user-controlled** — the Model Upgrade System proposes candidates, but only a user-approved upgrade changes the binding (see Upgrade Pipeline below)
- **Hot-swap** — `applyUpgrade()` mutates `config.models` in-place; all subsequent LLM calls immediately use the new model (no restart needed)
- **Concurrency** — single-slot semaphore by default (`C3_MAX_CONCURRENT_LLM=1`), serializes all LLM calls across roles to prevent GPU contention

**MODEL_PROFILES** (defined in `src/upgrade/model-profiles.js`) are metadata used **exclusively** by the upgrade system for discovery, filtering, and ranking. They are never consulted at request time.

### Model Upgrade Pipeline

The upgrade system discovers, evaluates, and proposes model changes — but **never auto-upgrades**.

```
  ┌─────────────────────────────────────────────────────────────┐
  │ L1: Local Ollama (/api/tags)       — every poll cycle       │
  │ L2: Curated Catalog (55 models)    — every full cycle (24h) │
  │ L4: Online Discovery (ollama.com)  — every full cycle       │
  │ L5: External Benchmarks (whatllm.org) — enriches L4         │
  └──────────┬──────────────────────────────────────────────────┘
             ↓
  Filter: requirements (minParams, capabilities, json_mode)
             ↓
  Feasibility: VRAM (90%), RAM (70%), disk (80%), CPU cap 14B
             ↓
  L5 Enrichment: whatllm qualityIndex → replace L4 estimates
             ↓
  Pairwise Eval: score(candidate) − score(current) ≥ threshold
    Score = benchmark×0.35 + hwFit×0.20 + maturity×0.15
          + generation×0.10 + category×0.13 + speed×0.07
    Thresholds: D1=0.06, CODE=0.05, CHAT=0.04, R2=0.05
    Dominance gate: reject if context window >20% worse
             ↓
  Empirical Blend (Phase 3): blend real metrics when >10 samples
             ↓
  Proposal Store → User Notification (WS + chat)
             ↓
  User Approval ("schvaluji" / "approve" / "ano")
             ↓
  Pull (if not installed) → Verify (3×30s) → Apply → Persist
```

**Anti-thrashing:** 14-day cooldown per role. Rejected models get 30-day cooldown. Dismissed = permanent block.

### Feature Flags

All variables loaded from `.env` (`dotenv`). Features independently toggleable via `FeatureManager` singleton. IDE sync: `c3.features.*` → WS `sync_settings` → `featureManager.setEnabled()`.

### Environment Variables

```bash
# Server
C3_PORT=0                          # Default: 0 (OS-assigned dynamic port). Set to pin a specific port.
C3_HOST=127.0.0.1                  # Bind address
C3_PORT_FILE=~/.c3/port            # Port file (JSON: port, host, pid, started) for IDE discovery
C3_TRUST_PROXY=false               # Trust X-Forwarded-For / X-Real-IP headers (for reverse proxy)

# Database & Ollama
C3_DB_PATH=./data/c3.db
OLLAMA_URL=http://127.0.0.1:11434

# Multi-session (v125, prepared)
C3_MAX_CONCURRENT_LLM=1            # Max concurrent LLM calls (1 = single GPU default)
C3_LLM_QUEUE_TIMEOUT=300000        # 5 min timeout for queued LLM requests
C3_GPU_AUTO_SCALE=false             # Auto-detect GPU count and scale maxConcurrentLLM

# Provider (v125, prepared)
C3_LLM_PROVIDER=ollama              # 'ollama' only for now; stub for future OpenAI-compatible API

# Notifications
C3_SMTP_HOST, C3_SMTP_PORT, C3_SMTP_USER, C3_SMTP_PASS, C3_SMTP_FROM
C3_TELEGRAM_BOT_TOKEN, C3_TELEGRAM_CHAT_ID
C3_NTFY_SERVER, C3_NTFY_TOPIC, C3_NTFY_TOKEN
```

---

## Test Suite

3,600+ verified tests across 244 test files:

| Suite | Tests | Focus |
|-------|-------|-------|
| CRE comprehensive | 401 | Intent classification (19 types) |
| Conversation | 350 | CZ 150 + EN 150 + ND 50 |
| Lifecycle unit + E2E | 186 | State machine, crash recovery, multi-session |
| Phase B workers | 73 | B0/B4/B6/B8/B9 agents |
| Notifications | 67 | Channels, routing, policy |
| Expertise system | 190+ | Merge, enforce, 5D capabilities, routing, wizard |
| Specialist system | 333 | Runtime, KB, scénáře, self-contained, wizard, ledger |
| Skills system | 44 | Registry, resolver, runner, 9 step types |
| Memory system | 50+ | LTM, injection-ranker, feedback, patterns |
| Quality + Telemetry | 200+ | QGv2, scoring, drift, resilience, soak |
| Executor capabilities | 85 | Shell whitelist, BUILD_VERIFYING, scaffolds |
| Agent log UX | 44 | SYSTEM_STEP protocol, 15 hooks |
| **Code Intelligence** | **339** | Symbol index, KG, graph, architecture, context |
| **Execution Engine (F1-F8)** | **355** | Patch, errors, loop, strategy, critique, patterns |
| **Long-term (FΔ+F9-F14)** | **242** | Context delta, build strategy, perf, deps, learning |
| **Prompt Pipeline (v119)** | **83** | Prompt builder, import map, scope limiter, sig cache |
| Architecture governance | 57 | Guardian, contracts, critic |
| Architecture intelligence | 161 | Policy, context, refactor, predictor, KB, multi-agent |
| Large project scaling | 107 | Graph storage, BFS, streaming, concept registry |
| Model upgrade (v103-v120) | 221 | Discovery, catalog, pairwise, proposals, approval, pull, empirical scoring |
| **Validation suites (v123)** | **73** | 5 role-specific suites, scoring, TTL, model ranker |
| **Marketplace (v124)** | **44** | Catalog, install, deps, security |
| **Guard interactions (v124)** | **25** | Guard combinations, creativeLock, ordering invariants |
| **Upgrade UX (v125)** | **49** | Rate limiting, async verify, auto-pull, dynamic port, multi-session |
| **Security hardening (v126)** | **47** | Path traversal, conversationId, customPath, package ID, SHA-256 |
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
| A (CRE) | 100% | Intent classification (19 types), 11 guards, QGv2, attachment guard |
| B (Workers) | 95% | Runner, scheduler, sources, notifications, multi-source |
| C (Lifecycle) | 100% | Milestones, crash recovery, checkpoint modes, adaptive retry |
| D (Expertises) | 100% | 15 built-in, merge engine, 5D capabilities, self-contained specialists (v121), marketplace (v124) |
| E (IDE) | 82% | C3 Studio (Theia), 33 extensions, settings UI, security, focus mode |
| F (Packaging) | 25% | Setup wizard, auto-updater, license system |
| G (Code Intel) | 100% | 33 modules, symbol index, KG, graph expansion, architecture detection |
| H (Agent Evolution) | 100% | F1-F8 core (355 tests), FΔ+F9-F14 extensions (242 tests) |
| I (Governance) | 100% | Guardian, contracts, critic, policy, regression prediction, multi-agent |
| J (Model Mgmt) | 100% | Phase 1-3 + validation suites + upgrade UX + L5 whatllm: discovery, catalog, pairwise, empirical, validation (452 tests) |
| K (Prompt Pipeline) | 100% | Prompt builder, import map, scope limiter, signature cache (83 tests) |
| L (Marketplace) | 100% | Remote catalog, transactional install, dependency resolver, mandatory SHA-256 (44 tests) |
| M (Security) | 100% | Path traversal guards, input sanitization, package integrity (47 tests) |

---

*This document reflects C.3 Agent Platform v126.0.0 architecture (2026-03-12).*
