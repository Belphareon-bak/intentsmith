# C.3 Agent System — Design Document v57

## Status: DRAFT — Needs Review

---

## 1. Co agent DNES je (realita)

Současná implementace v `src/agents/`:

```
Agent = {
  definition (DSL config),
  state (persisted JSON),
  params (user-provided),
  schedule (cron/interval),
  sources → conditions → triggers → actions
}
```

### Co skutečně dělá:

1. **Runner** (`runner.js`) — deterministický execution engine:
   - Fetch sources (HTTP, RSS, scraper, DB)
   - Evaluate conditions
   - Detect trigger edges
   - Execute actions (notify, webhook, store)

2. **Scheduler** (`scheduler.js`) — periodic execution:
   - Cron parsing
   - Interval handling
   - Prevents concurrent runs

3. **Builder** (`builder.js`) — LLM-assisted creation:
   - Natural language → DSL conversion
   - Post-processing defaults

### Problémy současného stavu:

| Problém | Dopad |
|---------|-------|
| `mark_seen` action neimplementovaná | HUNTER pattern nefunguje |
| Dual path resolution | Inconsistence v interpolaci |
| Chybějící API metody | Endpoints crashnou |
| Žádné testy | Regrese nelze detekovat |
| LLM v builderu ≠ LLM v runneru | Confusing separation |

---

## 2. Co agent MĚLA být (design intent)

Z dokumentace a schema:

- **Trigger-based** background worker
- **Deterministický** (LLM only in actions, not decisions)
- **Schedulovaný** (cron, interval, manual)
- **Pattern-based** (SCOUT, HUNTER, TRACKER, etc.)

---

## 3. NÁVRH: Rozdělení na dva typy

### A) Worker (current "agent")

**Definice:** Rezidentní, trigger-based, background, nemluví s userem přímo.

```
Worker = {
  // Identity
  id: string
  name: string

  // Lifecycle
  enabled: boolean
  status: 'idle' | 'running' | 'error' | 'disabled'

  // Schedule
  schedule: { type: 'cron' | 'interval' | 'manual', ... }

  // Execution
  sources: Source[]
  conditions: Condition[]
  triggers: Trigger[]
  actions: Action[]

  // State
  state: {
    lastRun: Date,
    seenItems: Set<string>,
    triggerHistory: {...}
  }
}
```

**Charakteristiky:**
- Běží na pozadí podle schedule
- Nemá konverzaci — jen generuje notifikace
- State přežívá restart
- LLM jen pro formatting notifikací

**Životní cyklus:**
```
CREATED → IDLE → SCHEDULED → RUNNING → (SUCCESS|ERROR) → IDLE
                    ↑___________________________|
```

### B) TaskAgent (future)

**Definice:** On-demand, má cíl, komunikuje s CRE + experty, končí po splnění.

```
TaskAgent = {
  // Identity
  id: string
  goal: string

  // Lifecycle
  status: 'planning' | 'executing' | 'waiting' | 'completed' | 'failed'

  // Execution
  steps: Step[]
  currentStep: number

  // Communication
  conversationId: string  // links to CRE
  expertId?: string       // optional expert

  // State
  progress: number        // 0-100
  outputs: any[]
}
```

**Charakteristiky:**
- Vzniká na požadavek usera
- Má konverzaci — komunikuje přes CRE
- Může mít subagenty
- Končí po dokončení (není rezidentní)

**Životní cyklus:**
```
CREATED → PLANNING → EXECUTING ↔ WAITING → COMPLETED
                         ↓
                      FAILED
```

---

## 4. Co se stane při restartu?

### Worker:
1. Scheduler se restartuje
2. Načte všechny enabled workers z DB
3. Přepočítá next_run podle posledního stavu
4. Pokračuje v běhu

**Invariant:** Worker MUSÍ pokračovat tam, kde skončil.

### TaskAgent:
1. Načte running TaskAgents z DB
2. Pro každý:
   - Pokud `waiting` → čeká na user input
   - Pokud `executing` → pokusí se pokračovat nebo nabídne restart

**Invariant:** TaskAgent MUSÍ buď pokračovat, nebo informovat usera.

---

## 5. Persistence Model

### Workers (tabulka: `workers_v57`)
```sql
CREATE TABLE workers_v57 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,  -- DSL JSON
  state TEXT DEFAULT '{}',   -- runtime state
  params TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'idle',
  last_run DATETIME,
  next_run DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### TaskAgents (tabulka: `task_agents_v57`)
```sql
CREATE TABLE task_agents_v57 (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  conversation_id TEXT,
  expert_id TEXT,
  steps TEXT DEFAULT '[]',   -- JSON array
  current_step INTEGER DEFAULT 0,
  status TEXT DEFAULT 'planning',
  progress INTEGER DEFAULT 0,
  outputs TEXT DEFAULT '[]',
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Akční plán pro v57

### Fáze 1: Stabilizace Worker (current agents)

1. **Opravit kritické bugy:**
   - [ ] Implementovat `mark_seen` action
   - [ ] Opravit chybějící repository metody
   - [ ] Sjednotit path resolution

2. **Přidat testy:**
   - [ ] Unit testy pro conditions, triggers
   - [ ] Integration testy pro runner
   - [ ] E2E test pro kompletní worker cyklus

3. **Dokumentace:**
   - [ ] Worker lifecycle diagram
   - [ ] DSL reference

### Fáze 2: Přejmenování (optional but clarifying)

- `AgentRunner` → `WorkerRunner`
- `AgentScheduler` → `WorkerScheduler`
- `agents_v33` → `workers_v57`

### Fáze 3: TaskAgent (future)

- Design task execution engine
- Integrate with CRE
- Add conversation support

---

## 7. Decision: Co děláme TEĎ?

**Doporučení:** Fáze 1 — stabilizace stávajícího systému.

Proč:
- Nechceme zavádět nové koncepty dokud staré nefungují
- HUNTER pattern je broken — to je konkrétní bug, ne design issue
- Testy jsou nutné před jakoukoliv další prací

**Konkrétní kroky:**

1. Implementovat `mark_seen` v `runner.js`
2. Přidat chybějící repository metody
3. Napsat testy
4. Až pak případně refaktorovat

---

## Appendix: Mentální model

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                          │
│  ┌─────────────┐              ┌─────────────────────────┐   │
│  │    CRE      │◄────────────►│      TaskAgent          │   │
│  │  (rozhoduje)│              │  (má cíl, komunikuje)   │   │
│  └─────────────┘              └─────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                            │
│  │   Expert    │                                            │
│  │ (Quality)   │                                            │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  BACKGROUND EXECUTION                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                     Worker                               ││
│  │  schedule → sources → conditions → triggers → actions    ││
│  │                                                          ││
│  │  • Nemluví s userem (jen notifikace)                    ││
│  │  • Deterministický (LLM jen pro text)                   ││
│  │  • Rezidentní (běží stále)                              ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

*Document version: v57.0*
*Last updated: 2026-02-06*
