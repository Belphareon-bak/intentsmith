# C.3 — Working Progress

## Current Phase
READY FOR REAL WORLD TEST 🚀

## Status (2026-01-04)

### ✅ Fáze 1 COMPLETE - Stabilizace
- Terminal state guards v execution-controller.js
- Idempotent resumeExecution()
- Flow Registry (config/flows.js)
- Rule-based flow selector (config/flow-selector.js)
- Planner integration s flow selection
- Unit testy: 17 passed

### ✅ Fáze 2 COMPLETE - Dual Deliberation
- prepare-dual.js: D1 + D2 nezávislé návrhy s kontextem
- review-cross.js: Skutečný cross-review (R1→D2, R2→D1)
- decision-maker.js: Schema validace, proposed_steps extraction
- step-executor.js: Context flow mezi kroky
- event-bus.js: subscribe() funkce pro testy
- Unit testy: 8 passed

### ✅ Fáze 3 COMPLETE - Execution & Resume
- execution-controller.js: Kompletní přepis s persistentním stavem
- state-store-exec.js: Context persistence (saveContext/loadContext)
- run-server.js: Approval endpoints (/approve, /reject, /execution/{id})
- Resume logic: Správný start od dalšího kroku (ne replay)
- Unit testy: 11 passed

## Total Unit Tests: 36 passed

```bash
node orchestrator/test/test-flow-selector.js      # 17
node orchestrator/test/test-context-flow.js       # 8
node orchestrator/test/test-execution-controller.js  # 11
```

## API Endpoints

```
POST /build/request           # Create build request
POST /plan/from-build         # Generate plan
POST /execute/plan            # Start execution
POST /execution/resume        # Resume execution
POST /execution/approve       # Approve checkpoint
POST /execution/reject        # Reject and cancel
GET  /execution/{id}          # Get status
GET  /execution/current       # Get active execution
GET  /run/stream              # SSE events
```

## Next Step: REAL WORLD TEST

**Task:** Design C.3 UI using C.3 itself

```bash
# 1. Start server
node orchestrator/runtime/main.js

# 2. Create project and build request (UI)

# 3. Execute dual-deliberation flow
#    - D1 + D2 create UI designs
#    - R1 + R2 cross-review
#    - Decision maker selects best approach
#    - Approval checkpoint
```

Toto bude první skutečný test celého systému.



## 2026-01-03 — A.4.x Deliberation & Output Contract Clarified


### Zlomové rozhodnutí

- Backend **neobsahuje doménovou znalost** (UI, infra, text…)

- Backend **čte zadání syntakticky**, ne sémanticky

- Kvalita výstupu ≠ odpovědnost backendu

- Hodnocení kvality = **další LLM / člověk**


### Deliberation policy

- Rozhodnutí single / dual **NIKDY není automatické**

- Vždy explicitně zadáno v:

  - build requestu

  - session

  - nebo konkrétním kroku

- Backend pouze **vykonává zvolenou politiku**


### Směr dalšího vývoje

- Zavést deliberation_policy (single / dual_consensus)

- Připravit dual-designer + dual-reviewer flow

- Dual režim iteruje, dokud R1 + R2 nedají konsenzus

- Max počet kol zatím ručně (experimentálně)


### Identifikovaný problém

- design step selhává na prázdném výstupu:

  "## Decision (TODO)"

- nutno analyzovat příčinu, nikoli maskovat pravidly



## 2026-01-04 – FLOW ORCHESTRATION (BOD ZLOMU C.3)

### Schválená architektura
Zavádíme **dynamicky volitelné execution flows** řízené policy, nikoli hard-coded logikou.

Základní princip:
request → classify → select flow → execute flow

### Flow selection
- Primární: **rule-based selector** (deterministický, bezpečný)
- Volitelný: **AI-assisted selector** (advisory only)
- AI NIKDY není autorita – pouze doporučení
- Při nízké confidence nebo chybě → tichý fallback na rules

### Flow registry
Flows jsou **deklarativní konfigurace**, ne kód.
Každý flow definuje:
- kroky
- executory
- role → model binding
- waitForApproval
- output schema

### Podporované flow typy (initial)
- single-pass (rychlé, nízké riziko)
- dual-deliberation (high-risk, architektura, refactor)
- research-mode (bez exekuce)

### Dual deliberation – finální podoba
- D1 + D2: nezávislé návrhy
- R1 + R2: cross-review (žádné self-review)
- DECISION: syntéza + výběr, striktně schema-driven
- Decision step ≠ designer, ale soudce

### Kritická pravidla
- Decision output MUSÍ validovat proti JSON schema
- Execution se NESMÍ zacyklit (plan_done je terminální stav)
- LLM nikdy nerozhoduje o stavu execution
- Backend je jediný zdroj pravdy

### Stav
Architektura schválena.
Implementace pokračuje přes rule-based flow selector → poté AI selector.

