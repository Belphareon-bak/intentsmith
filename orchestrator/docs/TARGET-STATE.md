# C.3 LocalAI Hybrid Copilot — Cílový Stav

## Vize

Plně lokální, deterministický AI copilot pro **stavbu celých projektů** (ne snippetů).
Kombinuje:
- Lokální LLM backendy (Ollama / LM Studio)
- Dual-deliberation architekturu (D1+D2 → R1+R2 → DECISION)
- Explicitní approval checkpointy
- Sandbox execution s audit trailem

---

## Architektura

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI LAYER                                │
│  (VS Code Extension / Desktop App / Web UI)                     │
│  - Renders backend events                                       │
│  - NEVER computes state                                         │
│  - Approval buttons, progress display                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP + SSE
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RUN SERVER                                 │
│  orchestrator/runtime/run-server.js                             │
│  - HTTP endpoints                                               │
│  - SSE streaming                                                │
│  - Session management                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PLANNER                                    │
│  orchestrator/planner2/index.js                                 │
│  - Flow selection (rule-based)                                  │
│  - Step generation from flow config                             │
│  - Context normalization                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 EXECUTION CONTROLLER                            │
│  orchestrator/runtime/execution-controller.js                   │
│  - Step-by-step execution                                       │
│  - Approval checkpoints                                         │
│  - State persistence                                            │
│  - Resume capability                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STEP EXECUTORS                               │
│  orchestrator/executors/                                        │
│  - prepare-dual.js (D1 + D2 návrhy)                             │
│  - review-cross.js (R1 + R2 cross-review)                       │
│  - decision-maker.js (finální rozhodnutí)                       │
│  - fs-executor.js (file operations)                             │
│  - shell-executor.js (shell commands)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LLM LAYER                                  │
│  orchestrator/llm/                                              │
│  - llm-client.js (unified interface)                            │
│  - ollama-client.js (Ollama backend)                            │
│  - Role → Model binding                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flow Registry

### Podporované flows

```javascript
FLOWS = {
  "single-pass": {
    // Rychlý mode pro jednoduché úkoly
    steps: [
      { name: "analyze", executor: "analyze-generic" },
      { name: "design", executor: "design-generic" },
      { name: "decision", executor: "decision-simple", waitForApproval: true }
    ]
  },

  "dual-deliberation": {
    // Komplexní úkoly vyžadující více perspektiv
    steps: [
      { name: "prepare", executor: "prepare-dual" },      // D1 + D2
      { name: "review", executor: "review-cross" },       // R1 reviews D2, R2 reviews D1
      { name: "decision", executor: "decision-maker", waitForApproval: true }
    ]
  },

  "research-mode": {
    // Pouze analýza, žádná exekuce
    steps: [
      { name: "analyze", executor: "analyze-deep" },
      { name: "report", executor: "report-generator" }
    ]
  }
}
```

### Flow Selection Rules

```javascript
// Rule-based (deterministický)
1. Explicit flow/mode parameter → use it
2. Keywords: "architect", "design", "refactor", "security" → dual-deliberation
3. Keywords: "fix bug", "rename", "format" → single-pass
4. Context: riskLevel=high → dual-deliberation
5. Default: single-pass
```

---

## Dual Deliberation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    PREPARE STEP                                 │
│                                                                 │
│   ┌─────────────┐              ┌─────────────┐                  │
│   │     D1      │              │     D2      │                  │
│   │ (deepseek)  │              │  (qwen3)    │                  │
│   │             │              │             │                  │
│   │  Design A   │              │  Design B   │                  │
│   └─────────────┘              └─────────────┘                  │
│                                                                 │
│   Output: { D1: designA, D2: designB }                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    REVIEW STEP                                  │
│                                                                 │
│   ┌─────────────┐              ┌─────────────┐                  │
│   │     R1      │              │     R2      │                  │
│   │ (deepseek)  │              │  (qwen3)    │                  │
│   │             │              │             │                  │
│   │ Reviews D2  │              │ Reviews D1  │  ← CROSS-REVIEW  │
│   └─────────────┘              └─────────────┘                  │
│                                                                 │
│   Output: { R1: reviewOfD2, R2: reviewOfD1 }                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DECISION STEP                                 │
│                                                                 │
│   Input: { designs: [D1, D2], reviews: [R1, R2] }               │
│                                                                 │
│   ┌─────────────────────────────────────────┐                   │
│   │            DECISION MAKER               │                   │
│   │                                         │                   │
│   │  - Syntetizuje D1, D2, R1, R2           │                   │
│   │  - Vybere lepší design                  │                   │
│   │  - Vytvoří DECISION artifact            │                   │
│   │  - Navrhne execution plan               │                   │
│   └─────────────────────────────────────────┘                   │
│                                                                 │
│   Output: DecisionOutput (JSON schema validated)                │
│                                                                 │
│   → waitForApproval: true                                       │
│   → emit: plan_approved { proposed_steps }                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ (po approval)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  EXECUTION PHASE                                │
│                                                                 │
│   approved_steps.forEach(step => {                              │
│     if (step.type === "fs") → fsExecutor                        │
│     if (step.type === "shell") → shellExecutor                  │
│   })                                                            │
│                                                                 │
│   → Sandbox isolation                                           │
│   → Audit trail                                                 │
│   → Rollback capability                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Decision Output Schema

```json
{
  "title": "...",
  "summary": "...",
  "accepted_design": "... (markdown) ...",
  "ui_contract": {
    "reads_from_backend": ["execution_state", "events", "artifacts"],
    "renders": ["progress", "logs", "diffs"],
    "never_computes": ["state", "decisions", "execution_order"]
  },
  "forbidden_actions": ["...", "..."],
  "assumptions": ["...", "..."],
  "next_steps": ["...", "..."],
  
  // OPTIONAL: proposed execution steps
  "proposed_steps": [
    { "type": "fs", "action": "write_file", "path": "...", "content": "..." },
    { "type": "shell", "command": "npm install", "cwd": "sandbox" }
  ]
}
```

---

## Execution Lifecycle

```
                    ┌──────────────┐
                    │   CREATED    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
          ┌────────│   RUNNING    │────────┐
          │        └──────┬───────┘        │
          │               │                │
          ▼               ▼                ▼
   ┌────────────┐  ┌────────────┐   ┌────────────┐
   │  WAITING   │  │   FAILED   │   │    DONE    │
   │ (approval) │  └────────────┘   └────────────┘
   └──────┬─────┘
          │
          │ (approve/reject)
          │
          ▼
   ┌──────────────┐
   │   RUNNING    │ (resume)
   └──────────────┘
```

### State Persistence

```
orchestrator/runtime/state/executions/{executionId}/
├── meta.json       # status, timestamps
├── plan.json       # original plan
├── progress.json   # current_step, completed_steps
└── events.log      # audit trail
```

---

## API Endpoints

```
POST /build              # Create new build request
POST /plan/from-build    # Generate plan from build request
POST /execute/plan       # Execute plan
POST /execute/resume     # Resume paused execution
POST /execute/approve    # Approve waiting step
POST /execute/reject     # Reject and cancel

GET  /execution/{id}     # Get execution state
GET  /events             # SSE stream
GET  /projects           # List projects
GET  /project/{id}       # Get project state
```

---

## Kritická Pravidla

1. **Backend je jediný zdroj pravdy** - UI NIKDY nerozhoduje
2. **LLM nikdy neřídí execution** - pouze generuje návrhy
3. **Decision output MUSÍ validovat** - JSON schema je povinné
4. **Terminal states jsou finální** - `done`/`failed` = konec
5. **Approval je explicitní** - žádné auto-approve pro risky operace
6. **Sandbox isolation** - vše běží v sandbox directory
7. **Audit everything** - každá akce je logována

---

## Implementační Fáze

### ✅ Fáze 1: Stabilizace (DONE)
- [x] Terminal state guards
- [x] Idempotent resumeExecution
- [x] Flow Registry
- [x] Rule-based flow selector
- [x] Planner integration

### 🔄 Fáze 2: Dual Deliberation Executors (CURRENT)
- [ ] Opravit prepare-dual.js (context passing)
- [ ] Opravit review-cross.js (cross-review logic)
- [ ] Integrovat decision-maker.js
- [ ] Context flow mezi kroky
- [ ] Proposed steps extraction

### ⏳ Fáze 3: Execution
- [ ] fs-executor sandbox enforcement
- [ ] shell-executor sandbox enforcement
- [ ] Rollback mechanism
- [ ] Diff preview before apply

### ⏳ Fáze 4: Persistence & Resume
- [ ] Fix resumeExecution cursor logic
- [ ] Execution state recovery
- [ ] SSE resume events

### ⏳ Fáze 5: UI Integration
- [ ] Approval UI
- [ ] Progress display
- [ ] Artifact viewer
- [ ] Project management
