# 📊 C.3 Agent - Roadmap Status

**Verze:** v43.2
**Datum:** 2026-01-25
**Projekt:** ~/Projects/c3-agent-wip
**Fáze:** 🎉 COMPLETE — FULL PLATFORM

---

## 🎯 Vize projektu

C.3 Agent je lokální AI asistent a workflow automatizační platforma, která kombinuje:
- **Architect Mode** - konverzační AI copilot pro vývoj
- **Agent Platform** - autonomní agenti pro monitoring a notifikace
- **Expert Layer** - specializovaní "mistři v oboru" pro specifické úlohy
- **Orchestrator** - řízená integrace agentů a expertů (v36)
- **CRE** - Conversational Reasoning Engine jako single authority (v36.6+)

---

## 🎉 ALL PHASES COMPLETE

### Pozice v Roadmapě

```
✅ FÁZE 1-3: CRE Core (v36.6-v36.9)
✅ FÁZE 4: Autonomous Mode (v37.0-v39.3.1)
✅ FÁZE 5: Hardening & Operability (v40.x)
✅ FÁZE 6: Knowledge & Skill Composition (v41.x)
✅ FÁZE 7: True Copilot Experience (v42.x)
✅ FÁZE 8: Ecosystem & Leverage (v43.x)
```

### FÁZE 5 — COMPLETE ✅

| Verze | Název | Status |
|-------|-------|--------|
| v40.0 | Observability Layer | ✅ DONE |
| v40.1 | Determinism & Replay | ✅ DONE |
| v40.2 | Versioned Behavior | ✅ DONE |

### FÁZE 6 — COMPLETE ✅

| Verze | Název | Status |
|-------|-------|--------|
| v41.0 | Skill System | ✅ DONE |
| v41.1 | Project Memory | ✅ DONE |

### FÁZE 7 — COMPLETE ✅

| Verze | Název | Status |
|-------|-------|--------|
| v42.0 | Intent Continuity | ✅ DONE |
| v42.1 | Proactive Mode | ✅ DONE |

### FÁZE 8 — COMPLETE ✅

| Verze | Název | Status |
|-------|-------|--------|
| v43.0 | Plugin SDK | ✅ DONE |
| v43.1 | Remote Agents | ✅ DONE |
| v43.2 | Federation | ✅ DONE |

---

## ✅ HOTOVO

### Hardening & Operability (v40.x) — COMPLETE ✅

| Verze | Feature | Popis | Testy |
|-------|---------|-------|-------|
| **v40.0** | Observability Layer | ExecutionTrace, LatencyTracker, FailureHeatmap | - |
| **v40.1** | Determinism & Replay | SeededRandom, ExecutionRecorder, ExecutionReplayer, ReplayStore | - |
| **v40.2** | Versioned Behavior | BehaviorProfile, BehaviorRegistry, BehaviorContext | - |

### Knowledge & Skill Composition (v41.x) — COMPLETE ✅

| Verze | Feature | Popis | Testy |
|-------|---------|-------|-------|
| **v41.0** | Skill System | Skill, SkillRegistry, SkillExecutor (Skill ≠ Tool) | - |
| **v41.1** | Project Memory | ProjectContext, ProjectMemory, Convention, StackItem | - |

### Autonomous Mode (v37.0-v39.3.1) — COMPLETE ✅

| Verze | Feature | Popis | Testy |
|-------|---------|-------|-------|
| **v37.0** | SessionMemory | Turn history, slots, goals, decisions | - |
| **v37.1** | Long-Term Memory | SQLite: preferences, interactions, patterns | - |
| **v37.2** | Preference-Aware Reasoning | CRE uses learned preferences | - |
| **v38.0** | Planner/Executor Split | PLANNER → Plan → EXECUTOR (deterministic) | - |
| **v38.1** | ActionGraph | Parallel execution, conditional branching | - |
| **v38.2** | Tool-Reflection Loop | Validate and retry | - |
| **v38.3** | Error Recovery | Retry strategies, fallbacks | - |
| **v39.0** | Goal Persistence | GoalStore, GoalScheduler, GoalRunner | 49 |
| **v39.1** | Safe Autonomy | SafetyLimits, Sandbox, AuditLog | - |
| **v39.2** | Self-Correction | FailureAnalyzer, CorrectionStrategy | - |
| **v39.3** | Local Copilot | CopilotContext, SuggestionEngine | - |

#### v39.x.1 Hotfixes (2026-01-25)

| Hotfix | Feature | Popis |
|--------|---------|-------|
| **v39.0.1** | Static vs Dynamic Context | staticContext (immutable) + dynamicContext (reloaded) |
| **v39.1.1** | Per-Goal Sandbox | SandboxManager for goal-scoped isolation |
| **v39.2.1** | FailureHistory | Global failure tracking, correction loop prevention |
| **v39.3.1** | Goal-Aware Suggestions | SuggestionEngine connected to GoalStore + FailureHistory |

### CRE Architecture (v36.6-v36.9)

| Feature | Verze | Popis | Testy |
|---------|-------|-------|-------|
| **Capability Truth Layer** | v36.6 | Forbidden meta-claims sanitization | 28 |
| **Deterministic Fallbacks** | v36.6 | reason → specific response | - |
| **System Slots** | v36.6 | now, timezone - never ask user for date | - |
| **LLM Gateway** | v36.7 | Capability-based auth tokens | 50 |
| **LLMAuthToken** | v36.7 | role, decisionId, capabilities, audit | - |
| **CREDecision Types** | v36.8 | TOOL_CALL, ASK_USER, REFUSE, ANSWER, MULTI_STEP | 46 |
| **Response Templates** | v36.8 | Enum-based, no free text | - |
| **Decision Validation** | v36.8 | ANSWER with content string = REJECTED | - |
| **ResponseRenderer** | v36.9 | Full impl: static + synthesize + QualityGate | 29 |
| **Hard LLM Guard** | v36.9 | Strict mode default, ALLOW_LEGACY_LLM env flag | - |
| **Single LLM Call** | v36.9 | Max 1 LLM call per render(), SYNTHESIZER token | - |
| **decisionId Propagation** | v36.9 | Unique ID per CRE request, audit trail | - |
| **CRE Text Removal** | v36.9 | CRE returns ONLY CREDecision, no text | - |

**Celkem nových testů:** 342 passing (50 + 46 + 142 + 28 + 29 + 27 + 20)

### Core Infrastructure

| Feature | Verze | Popis |
|---------|-------|-------|
| **Workflow Engine** | v26+ | Multi-model pipeline: THINKER → ANALYZER → D1 → DESIGN_AUDIT → CODE → R2 |
| **Model Binding** | v26+ | qwen2.5:32b (většina), qwen2.5-coder:32b (CODE), deepseek-r1-32b (adversarial R2B) |
| **Hybrid Q&A** | v32+ | TRIVIAL auto-answer, CRITICAL vyžaduje uživatele, learning po 3x potvrzení |
| **SQLite Database** | v31+ | FTS5 fulltext search, projects, conversations, messages, attachments, drafts |

### Architect UI

| Feature | Verze | Popis |
|---------|-------|-------|
| **Projekty** | v31 | CRUD, přiřazení chatů k projektům |
| **Konverzace** | v31 | Historie, persistence, draft saving |
| **Levý Sidebar** | v31 | New Chat, New Project, Projects, History, Experts (v35), Agents |
| **Pravý Sidebar** | v34 | Settings, Memory, Notifications (základní) |
| **Attachments** | v31 | Upload souborů, hash deduplication |
| **Web Search** | v32.7 | HARD/SOFT intent separation, keyword detection |
| **Storage Info** | v31 | Zobrazení využití úložiště |

### Agent Platform

| Feature | Verze | Popis |
|---------|-------|-------|
| **Agent Builder** | v33 | LLM převádí popis → agent definition |
| **DSL Conditions** | v33 | compare, new_items, changed, exists, contains |
| **Scheduler** | v33 | Cron-based spouštění agentů |
| **Runner** | v33 | Executor s edge detection, cooldown |
| **Agent UI** | v33 | Seznam agentů, detail, create/edit/delete |
| **Source Introspection** | v33.3 | URL → schema discovery |
| **Triggers** | v33 | Edge detection, rate limiting |
| **Actions** | v33 | notify, webhook, store |

### Artifact Pipeline

| Feature | Verze | Popis |
|---------|-------|-------|
| **Hard Validation** | v34.2 | JSON schema enforcement |
| **Locale Enforcement** | v34.2 | CZ locale pro čísla, měnu |
| **PDF Generation** | v34.2 | Puppeteer renderer |
| **DOCX Generation** | v34.2 | Word dokumenty |
| **Intent Classifier** | v34.3 | Confidence degradation |
| **Price Sanity Guard** | v34.3.3 | Reference data pro CZ trh (RTX 30/40/50xx) |
| **Stable Schema** | v34.3.3 | cena_min, cena_max jako čísla, colored badges |

### Expert Layer

| Feature | Verze | Popis |
|---------|-------|-------|
| **ExpertAgent Class** | v35.0 | planningDepth, reviewPolicy, dataUsagePolicy, outputBias |
| **15 Built-in Experts** | v35.0 | Writer, Analyst, Developer, Lawyer, Doctor... |
| **Expert Registry** | v35.0 | getAll(), get(), addCustom(), removeCustom() |
| **Expert Router** | v35.0 | routeToExpert() - automatický routing |
| **Expert UI** | v35.0 | /experts - správa, CRUD, kategorie |
| **Custom Experts** | v35.0 | Persistence v SQLite |

### Orchestrator (Agent-Expert Integration)

| Feature | Verze | Popis |
|---------|-------|-------|
| **Orchestrator Class** | v36.0 | Jediný bod delegace Agent → Expert |
| **4 Guardy** | v36.0 | Anti-cycle, expert existence, task competence, rate limit |
| **requestExpert()** | v36.0 | Hlavní API pro delegaci |
| **shouldUseExpert()** | v36.0 | Pre-flight check - kdy použít experta |
| **Audit Log** | v36.0 | Kompletní logging všech requestů |

---

## ✅ HOTOVO — FÁZE 7 & 8

### True Copilot Experience (v42.x) — COMPLETE ✅

| Verze | Feature | Popis | Testy |
|-------|---------|-------|-------|
| **v42.0** | Intent Continuity | SessionGoal, IntentTracker, implicit goal tracking | 47 |
| **v42.1** | Proactive Mode | ProactiveSuggestion, SuggestionEngine (opt-in, no auto-exec) | ✅ |

### Ecosystem & Leverage (v43.x) — COMPLETE ✅

| Verze | Feature | Popis | Testy |
|-------|---------|-------|-------|
| **v43.0** | Plugin SDK | Plugin, PluginManifest, PluginRegistry, PluginValidator | 52 |
| **v43.1** | Remote Agents | RemoteAgentClient, RemoteAgentRegistry, RemoteTask | ✅ |
| **v43.2** | Federation | FederationManager, NodeIdentity, FederationPeer | ✅ |

---

## 🗺️ ROADMAP v40.x → v43+

### FÁZE 5: HARDENING & OPERABILITY (v40.x)

Cíl: Systém dlouhodobě běží, jde debugovat, řídit a nepřekvapuje.

| Verze | Feature | Popis | Stop-condition |
|-------|---------|-------|----------------|
| **v40.0** | Observability Layer | ExecutionTrace, latency per layer, failure heatmap | „Proč trval 18s?" |
| **v40.1** | Determinism & Replay | Seedovaný planner, frozen inputs, replayExecution(id) | Bug z produkce → lokální replay |
| **v40.2** | Versioned Behavior | Behavior profiles, plannerRules, safetyLimits per version | Starý projekt běží beze změny |

#### v40.1 — Determinism & Replay (Detail)

**Problém:** Nemáš 100% reprodukovatelnost chování.

```javascript
// Každý request = replayable execution
ReplayableExecution {
  executionId,
  seed: 'deterministic-seed',
  inputs: { tools: [...], memorySnapshot, context },
  plan: { ... },
  steps: [ ... ]
}

// Replay API
replayExecution(executionId) → same plan, same steps
```

#### v40.2 — Versioned Behavior (Detail)

**Problém:** Změna CRE může rozbít staré projekty/agenty.

```javascript
BehaviorProfile {
  behaviorVersion: 'v39.1',
  plannerRules: '...',
  safetyLimits: '...',
  preferencesSchema: 'v2'
}
```

---

### FÁZE 6: KNOWLEDGE & SKILL COMPOSITION (v41.x)

Cíl: Systém se učí **strukturovaně**, ne náhodně.

| Verze | Feature | Popis | Stop-condition |
|-------|---------|-------|----------------|
| **v41.0** | Skill System | Ověřené sekvence kroků (≠ Tools) | CRE preferuje skill > generovaný plán |
| **v41.1** | Project Memory | Projektová paměť (conventions, stack, style) | Stejný dotaz → jiný plán podle projektu |

#### v41.0 — Skill System (Detail)

**Rozdíl oproti Tools:**
- **Tool** = atomická akce
- **Skill** = ověřená sekvence kroků

```javascript
Skill {
  id: 'compare-and-report',
  trigger: { intent: 'comparison', domain: 'cars' },
  planTemplate: [
    { step: 'search', tool: 'web_search', params: {...} },
    { step: 'compare', tool: 'analyze', params: {...} },
    { step: 'report', tool: 'generate_artifact', params: {...} },
  ],
  successCriteria: { hasArtifact: true, userSatisfied: 0.8 },
  safetyProfile: 'standard'
}

// Příklady skills:
// - „Najdi auto + porovnej + udělej report"
// - „Refactor backend + napiš testy"
// - „Deploy + verify + rollback on failure"
```

#### v41.1 — Project Memory (Detail)

**Problém:** Paměť je zatím uživatelská, ne projektová.

```javascript
ProjectContext {
  projectId: 'c3-agent-wip',
  conventions: {
    codeStyle: 'no-semicolons',
    testFramework: 'custom',
    errorHandling: 'explicit',
  },
  stack: ['node', 'sqlite', 'vanilla-js'],
  codingStyle: 'functional-first',
  riskProfile: 'medium',
}

// API
ProjectMemory.resolve(decision, projectId) → adjusted decision
```

---

### FÁZE 7: TRUE COPILOT EXPERIENCE (v42.x)

Cíl: Konkuruje Copilotu / Devinovi.

| Verze | Feature | Popis | Stop-condition |
|-------|---------|-------|----------------|
| **v42.0** | Intent Continuity | Implicitní cíl napříč seancí | „ok pokračuj" → systém ví v čem |
| **v42.1** | Proactive Mode | Návrhy dalších kroků (opt-in, no auto-exec) | Copilot navrhuje, uživatel rozhoduje |

#### v42.0 — Intent Continuity (Detail)

**Problém:** Uživatel myslí v cílech, ne v zprávách.

```javascript
SessionGoal {
  implicit: true,
  description: 'Implementace dark mode',
  progress: [
    { done: 'toggle component', at: '10:15' },
    { done: 'state management', at: '10:42' },
    { next: 'CSS variables for theme' },
  ]
}

// CRE ví:
// - na čem pracujeme
// - co už bylo hotovo
// - co je další logický krok
```

#### v42.1 — Proactive Mode (Detail)

Systém **smí**:
- ✅ navrhnout další krok
- ✅ upozornit na riziko
- ✅ doporučit refactor / cleanup

Systém **nesmí**:
- ❌ auto-execution bez schválení
- ❌ změny bez confidence > 0.8

---

### FÁZE 8: ECOSYSTEM & LEVERAGE (v43+)

Cíl: Máš **platformu**, ne aplikaci.

| Feature | Popis |
|---------|-------|
| **Plugin SDK** | Tools, Skills, Experts jako pluginy |
| **Marketplace** | Interní / OSS distribuce |
| **Remote Agents** | Agenti běží jinde, řízeny CRE |
| **Federation** | Více CRE instancí spolupracuje |

---

## 📐 Architektura po v36.9

```
┌─────────────────────────────────────────────────────────────────┐
│                          USER                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CRE.process()                                 │
│  ├─ Detect (intent, domain, volatility)                         │
│  ├─ DialogState (authoritative)                                 │
│  ├─ Decision Matrix                                             │
│  ├─ Capability Truth                                            │
│  └─ Return CREDecision (NEVER text)                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  TOOL_CALL   │  │  ASK_USER    │  │   ANSWER     │
│  ─────────   │  │  ─────────   │  │   ──────     │
│  tool: ...   │  │  slots: ...  │  │  template    │
│  params: ... │  │  template    │  │  dataRef     │
│  then: ...   │  │              │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ToolExecutor                                  │
│  ├─ Validate params                                             │
│  ├─ Check permissions (HumanGate)                               │
│  ├─ Execute with timeout                                        │
│  └─ Return results                                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ResponseRenderer                                │
│  ├─ Static templates (no LLM)                                   │
│  ├─ Synthesize templates (single LLM call)                      │
│  ├─ QualityGate                                                 │
│  └─ Return text                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                          USER                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Klíčové principy

1. **LLM je TOOL, ne AUTHOR**
   - ❌ LLM decides what to do
   - ✅ CRE decides, LLM executes specific task

2. **SINGLE SOURCE OF TRUTH**
   - ❌ Multiple places decide intent/capability
   - ✅ CRE is sole authority

3. **TOOLS ARE PURE**
   - ❌ Tool calls LLM for "decisions"
   - ✅ Tool receives instructions, returns data

4. **RESPONSE IS ASSEMBLED**
   - ❌ LLM generates entire response
   - ✅ Response is template + data + (optional) LLM synthesis

5. **PLANS, NOT TEXT**
   - ❌ CRE returns: "Mohu ti pomoci s..."
   - ✅ CRE returns: { type: 'TOOL_CALL', tool: '...', params: {...} }

---

## 📁 Struktura projektu (v39.3.1)

```
c3-agent-wip/
├── package.json
├── CLAUDE.md               ← Context pro CLI/IDE
├── ROADMAP.md              ← Tento soubor
└── src/
    ├── server.js
    ├── config.js
    │
    ├── core/               # Core utilities
    │   └── logger.js
    │
    ├── llm/                # LLM Gateway (v36.7)
    │   ├── auth-types.js
    │   ├── gateway.js
    │   ├── client.js
    │   └── web-search.js
    │
    ├── chat/               # CRE (v36.6-v36.9)
    │   ├── cre-v2.js
    │   ├── cre-decision-types.js
    │   ├── response-renderer.js
    │   ├── dialog-state-v2.js
    │   ├── decision-matrix.js
    │   ├── capability-registry.js
    │   ├── answer-quality-gate.js
    │   └── execution-contracts.js
    │
    ├── memory/             # Memory Layer (v37.x)
    │   ├── session-memory.js
    │   ├── long-term-memory.js
    │   ├── preference-engine.js
    │   └── policy.js
    │
    ├── planning/           # Multi-step Reasoning (v38.x)
    │   ├── planner.js
    │   ├── executor.js
    │   ├── action-graph.js
    │   ├── reflection-loop.js
    │   └── error-recovery.js
    │
    ├── autonomous/         # Autonomous Mode (v39.x) ← NEW
    │   ├── index.js            # Exports all modules
    │   ├── goal-store.js       # v39.0 + v39.0.1 (static/dynamic context)
    │   ├── goal-scheduler.js   # v39.0
    │   ├── goal-runner.js      # v39.0
    │   ├── safety-limits.js    # v39.1
    │   ├── sandbox.js          # v39.1 + v39.1.1 (SandboxManager)
    │   ├── audit.js            # v39.1
    │   ├── failure-analyzer.js # v39.2
    │   ├── correction-strategy.js  # v39.2 + v39.2.1 (FailureHistory)
    │   ├── copilot-context.js  # v39.3
    │   └── suggestions.js      # v39.3 + v39.3.1 (goal-aware)
    │
    ├── observability/      # Observability (v40.x) ✅
    │   ├── index.js
    │   ├── execution-trace.js    # v40.0: ExecutionTrace, PhaseTrace, ToolTrace
    │   ├── latency-tracker.js    # v40.0: LatencyTracker, LayerStats
    │   ├── failure-heatmap.js    # v40.0: FailureHeatmap, HeatmapCell
    │   ├── replay.js             # v40.1: SeededRandom, ExecutionRecorder, Replayer
    │   └── behavior-profile.js   # v40.2: BehaviorProfile, BehaviorRegistry
    │
    ├── skills/             # Skill System (v41.x) ✅
    │   ├── index.js
    │   ├── skill-registry.js     # v41.0: Skill, SkillRegistry, SkillStep
    │   ├── skill-executor.js     # v41.0: SkillExecutor, SkillExecutionContext
    │   └── project-memory.js     # v41.1: ProjectContext, ProjectMemory
    │
    ├── copilot/            # True Copilot Experience (v42.x) ✅
    │   ├── index.js
    │   ├── session-goal.js       # v42.0: SessionGoal, ProgressItem
    │   ├── intent-tracker.js     # v42.0: IntentTracker, implicit goals
    │   └── proactive-suggestions.js  # v42.1: ProactiveSuggestion, SuggestionEngine
    │
    ├── ecosystem/          # Ecosystem & Leverage (v43.x) ✅
    │   ├── index.js
    │   ├── plugin-sdk.js         # v43.0: Plugin, PluginRegistry, PluginValidator
    │   ├── remote-agents.js      # v43.1: RemoteAgentClient, RemoteAgentRegistry
    │   └── federation.js         # v43.2: FederationManager, NodeIdentity
    │
    ├── tools/              # Tools
    │   ├── http-client.js
    │   ├── registry.js
    │   └── executor.js
    │
    ├── agents/             # Agent Platform (v33)
    ├── experts/            # Expert Layer (v35)
    ├── orchestrator/       # Orchestrator (v36.0)
    ├── data/               # Data Layer (v34.4)
    ├── db/                 # SQLite database
    ├── ui/                 # Frontend
    └── workflow/           # Workflow engine

tests/
├── autonomous-v39.test.js      # 49 tests (v39.x)
├── copilot-v42.test.js         # 47 tests (v42.x) ✅
├── ecosystem-v43.test.js       # 52 tests (v43.x) ✅
├── llm-gateway.test.js         # 50 tests
├── cre-decision-types.test.js  # 46 tests
├── cre-v2.test.js              # 142 tests
├── capability-truth.test.js    # 28 tests
└── ...
```

---

## 📊 Progres

```
████████████████████████████  100% Core done (v31-v36)
████████████████████████████  100% CRE Architecture (v36.6-v36.9)
████████████████████████████  100% Memory & Context (v37.x)
████████████████████████████  100% Multi-step Reasoning (v38.x)
████████████████████████████  100% Autonomous Mode (v39.x)
████████████████████████████  100% Hardening (v40.x)
████████████████████████████  100% Knowledge (v41.x)
████████████████████████████  100% True Copilot (v42.x)
████████████████████████████  100% Ecosystem (v43.x)
```

### Milníky

| Verze | Milestone | Datum |
|-------|-----------|-------|
| v31 | Architect UI základ | 2026-01-11 |
| v33 | Agent Platform | 2026-01-18 |
| v34 | Artifact Pipeline + Layers | 2026-01-18/19 |
| v35 | Expert Layer | 2026-01-19 |
| v36.0 | Orchestrator | 2026-01-21 |
| v36.9 | **CRE Architecture Complete** | 2026-01-24 |
| v37.x | **Memory & Context** | 2026-01-24 |
| v38.x | **Multi-step Reasoning** | 2026-01-24 |
| v39.0 | **Goal Persistence** | 2026-01-25 |
| v39.1 | **Safe Autonomy** | 2026-01-25 |
| v39.2 | **Self-Correction** | 2026-01-25 |
| v39.3 | **Local Copilot** | 2026-01-25 |
| v39.3.1 | **v39.x Hotfixes Complete** | 2026-01-25 |
| v40.0 | **Observability Layer** | 2026-01-25 |
| v40.1 | **Determinism & Replay** | 2026-01-25 |
| v40.2 | **Versioned Behavior** | 2026-01-25 |
| v41.0 | **Skill System** | 2026-01-25 |
| v41.1 | **Project Memory** | 2026-01-25 |
| v42.0 | **Intent Continuity** | 2026-01-25 |
| v42.1 | **Proactive Mode** | 2026-01-25 |
| v43.0 | **Plugin SDK** | 2026-01-25 |
| v43.1 | **Remote Agents** | 2026-01-25 |
| v43.2 | **Federation — FULL PLATFORM** | 2026-01-25 |

---

## 🛠️ Technický stack

| Komponenta | Technologie |
|------------|-------------|
| **Backend** | Node.js, native HTTP server |
| **Database** | SQLite + better-sqlite3, FTS5 |
| **LLM** | Ollama (local), qwen2.5, deepseek-r1 |
| **PDF** | Puppeteer |
| **Frontend** | Vanilla JS, CSS (no framework) |

---

## 🧪 Spuštění testů

```bash
cd ~/Projects/c3-agent-wip

# Všechny CRE testy (342)
node src/tests/llm-gateway.test.js && \
node src/tests/cre-decision-types.test.js && \
node src/tests/cre-v2.test.js && \
node src/tests/capability-truth.test.js && \
node src/tests/llm-enforcement.test.js && \
node src/tests/correction-enforcer.test.js && \
node src/tests/cre-v36-e2e.test.js

# Quick status
for f in src/tests/*.test.js; do
  echo "=== $f ===" 
  node "$f" 2>&1 | grep -E "Passed:|Failed:"
done
```

---

## 🔗 Odkazy

- **Hlavní UI:** http://localhost:3335/architect
- **Experts:** http://localhost:3335/experts
- **Agents:** http://localhost:3335/agents
- **API:** http://localhost:3335/api/
- **Health:** http://localhost:3335/

---

## 📝 Changelog Summary

| Verze | Hlavní změny |
|-------|--------------|
| **v43.2** | **Federation** - FederationManager, NodeIdentity, FederationPeer, knowledge sharing |
| **v43.1** | **Remote Agents** - RemoteAgentClient, RemoteAgentRegistry, RemoteTask |
| **v43.0** | **Plugin SDK** - Plugin, PluginManifest, PluginRegistry, PluginValidator, lifecycle |
| **v42.1** | **Proactive Mode** - ProactiveSuggestion, SuggestionEngine, opt-in suggestions |
| **v42.0** | **Intent Continuity** - SessionGoal, IntentTracker, "ok pokračuj" support |
| **v41.1** | **Project Memory** - ProjectContext, ProjectMemory, conventions, stack detection |
| **v41.0** | **Skill System** - Skill ≠ Tool, SkillRegistry, SkillExecutor, verified sequences |
| **v40.2** | **Versioned Behavior** - BehaviorProfile, BehaviorRegistry, backwards compatibility |
| **v40.1** | **Determinism & Replay** - SeededRandom, ExecutionRecorder, ExecutionReplayer |
| **v40.0** | **Observability Layer** - ExecutionTrace, LatencyTracker, FailureHeatmap |
| **v39.3.1** | **Goal-Aware Suggestions** - SuggestionEngine connected to GoalStore + FailureHistory |
| **v39.2.1** | **FailureHistory** - Global failure tracking, correction loop prevention |
| **v39.1.1** | **SandboxManager** - Per-goal sandbox instances |
| **v39.0.1** | **Static vs Dynamic Context** - Context separation in GoalStore |
| **v39.3** | **Local Copilot** - CopilotContext, SuggestionEngine |
| **v39.2** | **Self-Correction** - FailureAnalyzer, CorrectionStrategy |
| **v39.1** | **Safe Autonomy** - SafetyLimits, Sandbox, AuditLog |
| **v39.0** | **Goal Persistence** - GoalStore, GoalScheduler, GoalRunner |
| **v38.3** | **Error Recovery** - Retry strategies, fallbacks |
| **v38.2** | **Tool-Reflection Loop** - Validate and retry |
| **v38.1** | **ActionGraph** - Parallel execution, conditional branching |
| **v38.0** | **Planner/Executor Split** - PLANNER → Plan → EXECUTOR |
| **v37.2** | **Preference-Aware Reasoning** - CRE uses learned preferences |
| **v37.1** | **Long-Term Memory** - SQLite: preferences, interactions, patterns |
| **v37.0** | **SessionMemory** - Turn history, slots, goals, decisions |
| **v36.9.0** | **ResponseRenderer** - CRE→Decision→Renderer, hard LLM guard |
| **v36.8.0** | **Tool-First CREDecision** - CRE returns structure, not text |
| **v36.7.0** | **LLM Gateway Lockdown** - capability-based auth tokens |
| **v36.6.0** | **Capability Truth** - forbidden meta-claims, deterministic fallbacks |
| v36.0.0 | Orchestrator - Agent-Expert Integration |
| v35.0.0 | Expert Layer - 15 expertů, UI, custom experts |
| v34.4.x | Data Layer, Decision Layer, Representation Layer |
| v34.2.0 | Artifact Pipeline, PDF generation |
| v33.0.0 | Agent Platform - DSL, scheduler, runner |
| v32.7 | Web search HARD/SOFT separation |
| v31.0 | Architect UI - SQLite, projects, conversations |

---

*Poslední aktualizace: 2026-01-25*
