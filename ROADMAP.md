# 📊 C.3 Agent - Roadmap Status

**Verze:** v36.9.0
**Datum:** 2026-01-24
**Projekt:** ~/Projects/c3-agent-wip

---

## 🎯 Vize projektu

C.3 Agent je lokální AI asistent a workflow automatizační platforma, která kombinuje:
- **Architect Mode** - konverzační AI copilot pro vývoj
- **Agent Platform** - autonomní agenti pro monitoring a notifikace
- **Expert Layer** - specializovaní "mistři v oboru" pro specifické úlohy
- **Orchestrator** - řízená integrace agentů a expertů (v36)
- **CRE** - Conversational Reasoning Engine jako single authority (v36.6+)

---

## 🚀 AKTUÁLNÍ FOCUS: CRE Architecture Consolidation

### Problém (identifikován v36.6)

CRE bylo bypass-able:
```
BROKEN:
User → Intent Router → Artifact/Search/PDF → LLM (direct)
                    └→ CRE (sometimes)

REQUIRED:
User → CRE.process() → Decision → Tools → Response
```

### Řešení: 5-Commit Plan (v36.7 → v36.9)

| Commit | Verze | Název | Stav |
|--------|-------|-------|------|
| **1** | v36.7 | LLM Gateway Lockdown | ✅ DONE |
| **2** | v36.8 | Tool-First CREDecision Contract | ✅ DONE |
| **3** | v36.9 | ResponseRenderer + Single LLM Call | ✅ DONE |
| **4** | v36.9.1 | Real Capability Wiring (Safe Tools) | 🔄 NEXT |
| **5** | v36.9.2 | Memory Policy + Human Gate | ⏳ TODO |

---

## ✅ HOTOVO

### CRE Architecture (v36.6-v36.9) — NEW

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

## 🔄 ROZPRACOVÁNO

### COMMIT 4 — Real Capability Wiring (NEXT)

```
feat(tools): safe http client + real capability execution
```

**Nové soubory:**
- `src/tools/http-client.js` - SafeHttpClient
- `src/tools/registry.js` - Tool implementations
- `src/tools/executor.js` - Tool executor

**Features:**
- Rate limiting per domain
- Retry with exponential backoff
- User-agent rotation
- Real HTTP requests (Sauto, Bazoš, etc.)

### COMMIT 5 — Memory Policy + Human Gate

```
feat(safety): memory policy layer + human-in-the-loop gate
```

**Nové soubory:**
- `src/memory/policy.js` - MemoryPolicyLayer
- `src/safety/human-gate.js` - HumanGate

**Features:**
- Memory read/write through policy
- Approval levels: none, notify, confirm, require
- Audit logging

---

## 🗺️ ROADMAP v37.x → v39.x

### VRSTVA 2: MEMORY & CONTEXT (v37.x)

| Verze | Feature | Popis |
|-------|---------|-------|
| v37.0 | SessionMemory | Turn history, slots, goals, decisions |
| v37.1 | Long-Term Memory | SQLite: preferences, interactions, patterns |
| v37.2 | Preference-Aware Reasoning | CRE uses learned preferences |

### VRSTVA 3: MULTI-STEP REASONING (v38.x)

| Verze | Feature | Popis |
|-------|---------|-------|
| v38.0 | Planner/Executor Split | PLANNER (LLM) → Plan → EXECUTOR (deterministic) |
| v38.1 | Action Graph | Parallel execution, conditional branching |
| v38.2 | Tool-Reflection Loop | Validate and retry (LLM off by default) |
| v38.3 | Error Recovery | Retry strategies, fallbacks |

### VRSTVA 4: AUTONOMOUS MODE (v39.x)

| Verze | Feature | Popis |
|-------|---------|-------|
| v39.0 | Goal Persistence | Long-running background goals |
| v39.1 | Safe Autonomy | Sandbox, limits, audit |
| v39.2 | Self-Correction | Learn from failures |
| v39.3 | Local Copilot Mode | IDE-like inline assistance |

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

## 📁 Struktura projektu (v36.9)

```
c3-agent-wip/
├── package.json
├── CLAUDE.md               ← Context pro CLI/IDE
├── ROADMAP.md              ← Tento soubor
└── src/
    ├── server.js
    ├── config.js
    │
    ├── llm/                # LLM Gateway (v36.7)
    │   ├── auth-types.js   # LLMAuthToken, capabilities
    │   ├── gateway.js      # Centrální gateway singleton
    │   ├── client.js       # Legacy wrapper
    │   └── web-search.js
    │
    ├── chat/               # CRE (v36.6-v36.8)
    │   ├── cre-v2.js       # Main CRE engine
    │   ├── cre-decision-types.js  # CREDecision ADT
    │   ├── response-renderer.js   # Decision → Text
    │   ├── dialog-state-v2.js
    │   ├── decision-matrix.js
    │   ├── capability-registry.js
    │   ├── answer-quality-gate.js
    │   └── execution-contracts.js
    │
    ├── tools/              # Tools (v36.9+) — TODO
    │   ├── http-client.js
    │   ├── registry.js
    │   └── executor.js
    │
    ├── memory/             # Memory (v37+) — TODO
    │   └── policy.js
    │
    ├── safety/             # Safety (v36.9+) — TODO
    │   └── human-gate.js
    │
    ├── agents/             # Agent Platform (v33)
    ├── experts/            # Expert Layer (v35)
    ├── orchestrator/       # Orchestrator (v36.0)
    ├── data/               # Data Layer (v34.4)
    ├── db/                 # SQLite database
    ├── ui/                 # Frontend
    ├── workflow/           # Workflow engine
    │
    └── tests/
        ├── llm-gateway.test.js        # 50 tests
        ├── cre-decision-types.test.js # 46 tests
        ├── cre-v2.test.js             # 142 tests
        ├── capability-truth.test.js   # 28 tests
        ├── llm-enforcement.test.js    # 29 tests (v36.9)
        ├── correction-enforcer.test.js # 27 tests
        ├── cre-v36-e2e.test.js        # 20 tests
        └── ...
```

---

## 📊 Progres

```
████████████████████████░░  90% Core done
████████████████░░░░░░░░░░  65% CRE consolidation
████░░░░░░░░░░░░░░░░░░░░░░  15% Memory/Autonomy
```

### Milníky

| Verze | Milestone | Datum |
|-------|-----------|-------|
| v31 | Architect UI základ | 2026-01-11 |
| v33 | Agent Platform | 2026-01-18 |
| v34 | Artifact Pipeline + Layers | 2026-01-18/19 |
| v35 | Expert Layer | 2026-01-19 |
| v36.0 | Orchestrator | 2026-01-21 |
| v36.6 | Capability Truth Layer | 2026-01-24 |
| v36.7 | **LLM Gateway Lockdown** | 2026-01-24 |
| v36.8 | **Tool-First CREDecision** | 2026-01-24 |
| v36.9 | **ResponseRenderer + Single LLM Call** | 2026-01-24 |
| v37.x | Memory & Context (planned) | - |
| v38.x | Multi-step Reasoning (planned) | - |
| v39.x | Autonomous Mode (planned) | - |

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
| **v36.9.0** | **ResponseRenderer + Single LLM Call** - CRE→Decision→Renderer, hard LLM guard |
| **v36.8.0** | **Tool-First CREDecision Contract** - CRE returns structure, not text |
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

*Poslední aktualizace: 2026-01-24*
