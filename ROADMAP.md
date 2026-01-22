# 📊 C.3 Agent - Roadmap Status

**Verze:** v36.0.0  
**Datum:** 2026-01-21  
**Projekt:** ~/Projects/c3-agent-wip

---

## 🎯 Vize projektu

C.3 Agent je lokální AI asistent a workflow automatizační platforma, která kombinuje:
- **Architect Mode** - konverzační AI copilot pro vývoj
- **Agent Platform** - autonomní agenti pro monitoring a notifikace
- **Expert Layer** - specializovaní "mistři v oboru" pro specifické úlohy
- **Orchestrator** - řízená integrace agentů a expertů (v36)

---

## ✅ HOTOVO

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

### Data Layer

| Feature | Verze | Popis |
|---------|-------|-------|
| **DataSource Base** | v34.4.0 | Abstraktní třída pro doménové zdroje |
| **GPU Source** | v34.4.0 | RTX 30xx/40xx/50xx referenční data |
| **Cars Source** | v34.4.0 | Škoda modely |
| **Sanity Checks** | v34.4.0 | Automatická validace vs. reference |

### Decision Layer

| Feature | Verze | Popis |
|---------|-------|-------|
| **Problem Classifier** | v34.4.1 | price_range, specification, availability, consensus, procedural, hybrid |
| **Decision Matrix** | v34.4.1 | Per-type pravidla a constraints |
| **Hybrid Handler** | v34.4.1 | Subtask decomposition |
| **Dynamic Prompting** | v34.4.1 | Prompt podle typu problému |

### Representation Layer

| Feature | Verze | Popis |
|---------|-------|-------|
| **Content Types** | v34.4.2 | narrative, structured, tabular, report |
| **Narrative Detection** | v34.4.2 | isNarrativeRequest() pattern matching |
| **Narrative HTML** | v34.4.2 | Prose layout, serif font, drop cap |
| **Structured HTML** | v34.4.2 | Sekce s nadpisy, sans font |

### Expert Layer

| Feature | Verze | Popis |
|---------|-------|-------|
| **ExpertAgent Class** | v35.0 | planningDepth, reviewPolicy, dataUsagePolicy, outputBias |
| **15 Built-in Experts** | v35.0 | Writer, Analyst, Developer, Lawyer, Doctor... |
| **Expert Registry** | v35.0 | getAll(), get(), addCustom(), removeCustom() |
| **Expert Router** | v35.0 | routeToExpert() - automatický routing |
| **Expert UI** | v35.0 | /experts - správa, CRUD, kategorie |
| **Custom Experts** | v35.0 | Persistence v SQLite |
| **Expert Categories** | v35.0 | Creative, Analytical, Normative, Technical, Domain |

### Orchestrator (Agent-Expert Integration)

| Feature | Verze | Popis |
|---------|-------|-------|
| **Orchestrator Class** | v36.0 | Jediný bod delegace Agent → Expert |
| **4 Guardy** | v36.0 | Anti-cycle, expert existence, task competence, rate limit |
| **requestExpert()** | v36.0 | Hlavní API pro delegaci |
| **shouldUseExpert()** | v36.0 | Pre-flight check - kdy použít experta |
| **Audit Log** | v36.0 | Kompletní logging všech requestů |
| **Expert Integration** | v36.0 | Helper pro agenty |
| **API Endpoints** | v36.0 | /api/orchestrator/* (request, check, log, stats) |
| **Schema Extension** | v36.0 | expertDelegation v agent definition |
| **Runner Integration** | v36.0 | STEP 4.5, {expert_output} template |
| **Anonymizace** | v36.0 | Expert neví kdo ho volá |

**Architektura:**
```
Agent → Orchestrator → Expert → C3 Core → Output → Agent

✅ Orchestrator je jediný bod moci
✅ Agent je hloupý vykonavatel  
✅ Expert je anonymní nástroj
✅ C3 Core zůstává autorita
```

---

## 🟡 ROZPRACOVÁNO / ČÁSTEČNĚ

| Feature | Stav | Poznámka |
|---------|------|----------|
| **Labels** | ❌ Nezačato | Projekty: new, in progress, done, custom labels |
| **Pravý Sidebar - Memory** | 🟡 Částečně | Základní UI, chybí plná správa |
| **Agent Templates** | 🟡 Částečně | Architektura hotová, chybí předpřipravené šablony |

---

## ❌ TODO

### ⚠️ DŮLEŽITÉ: v36 je experimental

**v36 (Orchestrator) je připravená, ale NENÍ v produkci.**

Důvod: Bez P0 pojistek by rozšíření zvyšovalo riziko tiché regrese.

```
Branch: experimental/v36
Tag: v36.0.0-pre-freeze
Status: Čeká na dokončení P0
```

### 🔴 P0 - Kritické (PŘED v36!)

| Feature | Popis | Effort | Proč |
|---------|-------|--------|------|
| **E2E Scénářové testy** | 5-7 invariantních testů | M | Chrání architekturu |
| **Expert constraints badge** | Viditelné v UI + logu | S | Auditovatelnost |
| **Disclaimer slots** | Hard-coded pro Právník/Lékař/Psycholog | S | Bezpečnost |

**E2E Scénáře (konkrétní):**
1. Chat → Writer → kniha → DOCX
2. Chat → Analyst → data → PDF report
3. Agent → trigger → notify (bez experta)
4. Evidence stale → warning v UI
5. Price sanity violation → graceful degradation

### 🟡 P1 - Důležité

| Feature | Popis | Effort |
|---------|-------|--------|
| **Labels** | Štítky pro projekty a konverzace | M |
| **Memory UI** | Plná správa paměti v pravém sidebaru | M |
| **Prompt Skeleton** | Společná kostra pro všechny experty | M |

### 🟠 P1.5 - Error Taxonomy

| Feature | Popis | Effort |
|---------|-------|--------|
| **Error kódy** | DATA_MISSING, EVIDENCE_STALE, CONSTRAINT_VIOLATION... | S |
| **Error handling** | Graceful degradation pro všechny error typy | M |

### 🟢 P2 - Nice to have

| Feature | Popis | Effort |
|---------|-------|--------|
| **"Why" metadata** | Strojově čitelný blok u každé odpovědi | M |
| **Import** | Konverzace z Claude/GPT | M |
| **SSE Streaming** | Real-time UI updates | L |
| **Agent Templates** | Weather, Property Hunter, Price Monitor... | M |

---

## 🔮 FUTURE ROADMAP

### Fáze 1: Stabilizace v35 (AKTUÁLNÍ)
- [ ] E2E testy (5-7 scénářů)
- [ ] Expert constraints badge
- [ ] Disclaimer slots
- [ ] Tag: `v35.1.0-stable`

### Fáze 2: Release v36 (po P0)
- [ ] Merge experimental/v36
- [ ] E2E testy pro Orchestrator flow
- [ ] Auth pro API
- [ ] Tag: `v36.0.0-stable`

### Fáze 3: Advanced Features (v37+)
- [ ] SSE streaming pro real-time updates
- [ ] Definition editor v browseru
- [ ] Multi-file rollback (atomic operace)
- [ ] Agent chaining (řízené přes Orchestrator)
- [ ] Expert může NAVRHNOUT akci, Orchestrator rozhodne (ne spouštět přímo!)

### Fáze 4: Mobile & Distribution (v38+)
- [ ] React Native mobile app
- [ ] Push notifications
- [ ] Agent marketplace
- [ ] Public sharing

---

## ⚠️ Rizika a prevence

| Riziko | Prevence |
|--------|----------|
| **Expert zoo** | Žádní další built-in experti, pouze custom |
| **Prompt drift** | Prompt Skeleton (P1) - společná kostra |
| **Feature creep v UI** | UI = ovladač, ne logika |
| **Tichá regrese** | E2E testy před každým release |

---

## 🔧 Error Taxonomy (P1.5)

Standardizované error kódy pro debug, UX a automatizaci:

| Kód | Popis | Vrstva |
|-----|-------|--------|
| `DATA_MISSING` | Chybí požadovaná data | Data Layer |
| `DATA_STALE` | Data jsou zastaralá | Data Layer |
| `EVIDENCE_STALE` | Evidence starší než threshold | Evidence Layer |
| `EXPERT_UNAVAILABLE` | Expert není dostupný | Expert Layer |
| `EXPERT_INCOMPETENT` | Task mimo kompetenci experta | Orchestrator |
| `CONSTRAINT_VIOLATION` | Porušení C3 Core pravidel | Core |
| `CYCLE_DETECTED` | Detekován cyklus v delegaci | Orchestrator |
| `RATE_LIMITED` | Překročen rate limit | Orchestrator |

---

## 📊 "Why" Metadata (P2)

Každá odpověď by měla obsahovat strojově čitelný blok:

```json
{
  "usedExpert": "analyst",
  "usedDataLayer": true,
  "dataSource": "gpu_source",
  "confidence": "medium",
  "constraintsApplied": ["price_sanity", "locale_cz"],
  "warnings": []
}
```

Užitečné pro:
- Debug
- UX (zobrazení "proč tak odpověděl")
- Budoucí automatizaci

---

## 🔗 Agent-Expert Integration (IMPLEMENTOVÁNO v36)

### Architektura

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT                                  │
│  Trigger: new property listing detected                     │
└──────────────────────────┬──────────────────────────────────┘
                           │ delegate
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR (v36)                        │
│  ├─ Guard: anti-cycle                                       │
│  ├─ Guard: expert exists                                    │
│  ├─ Guard: task competence                                  │
│  ├─ Guard: rate limit                                       │
│  └─ Log: audit entry                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ approved
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      EXPERT                                 │
│  Analyst: evaluate property vs. user criteria               │
│  (Expert neví kdo ho volá - anonymizace)                    │
│  Output: recommendation + reasoning                         │
└──────────────────────────┬──────────────────────────────────┘
                           │ return
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      AGENT                                  │
│  Action: notify user with {expert_output}                   │
└─────────────────────────────────────────────────────────────┘
```
└─────────────────────────────────────────────────────────────┘
```

### Use Cases

| Agent | Expert | Flow |
|-------|--------|------|
| Property Hunter | Analyst | Najde inzerát → Analytik vyhodnotí → Notifikace s doporučením |
| News Digest | Writer | Sesbírá články → Spisovatel shrne → Daily email |
| Price Monitor | Překupník | Detekuje změnu → Překupník vyhodnotí timing → Alert |
| Warranty Tracker | Technik | Blíží se konec záruky → Technik doporučí náhradu → Notifikace |
| AI Updates | AI Expert | Najde novinku → AI Expert vyhodnotí relevanci → Návrh updatu |

### Technická implementace (návrh)

```javascript
// Agent definition with expert delegation
{
  id: 'property-hunter',
  sources: [{ type: 'scraper', url: '...' }],
  conditions: [{ type: 'new_items' }],
  
  // NEW: Expert delegation
  expertDelegation: {
    expertId: 'analyst',
    task: 'Vyhodnoť nemovitost podle mých kritérií: {user_criteria}',
    includeData: true  // Pass source data to expert
  },
  
  actions: [{
    type: 'notify',
    template: '{expert_output}'  // Use expert's response
  }]
}
```

---

## 📈 Progres

```
████████████████████░░░░  80% Hotovo
████░░░░░░░░░░░░░░░░░░░░  15% WIP
█░░░░░░░░░░░░░░░░░░░░░░░   5% TODO
```

### Milníky

| Verze | Milestone | Datum |
|-------|-----------|-------|
| v31 | Architect UI základ | 2026-01-11 |
| v33 | Agent Platform | 2026-01-18 |
| v34 | Artifact Pipeline + Layers | 2026-01-18/19 |
| v35 | Expert Layer | 2026-01-19 |
| v36 | **Agent-Expert Integration (Orchestrator)** | 2026-01-21 |

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

## 📁 Struktura projektu

```
c3-agent-wip/
├── package.json
├── README.md
├── ROADMAP.md              ← tento soubor
└── src/
    ├── server.js           # Hlavní server (v35.0.1)
    ├── config.js
    ├── decision-layer.js   # Problem classification
    ├── artifact-pipeline.js
    │
    ├── experts/            # Expert Layer (v35)
    │   ├── expert-layer.js
    │   └── experts.html
    │
    ├── agents/             # Agent Platform (v33)
    │   ├── agents.html
    │   ├── repository.js
    │   ├── runner.js
    │   ├── scheduler.js
    │   ├── builder.js
    │   └── ...
    │
    ├── data/               # Data Layer (v34.4)
    │   ├── data-layer.js
    │   ├── gpu-source.js
    │   └── cars-source.js
    │
    ├── db/
    │   └── database.js
    │
    ├── llm/
    │   ├── client.js
    │   └── web-search.js
    │
    ├── ui/
    │   └── architect/
    │
    └── workflow/
        └── engine.js
```

---

## 📝 Changelog Summary

| Verze | Hlavní změny |
|-------|--------------|
| v36.0.0 | **Orchestrator** - Agent-Expert Integration, guardy, audit log |
| v35.0.1 | Expert Layer path fixes, version sync |
| v35.0.0 | **Expert Layer** - 15 expertů, UI, custom experts |
| v34.4.2 | Representation Layer (narrative vs report) |
| v34.4.1 | Decision Layer (problem classification) |
| v34.4.0 | Data Layer (GPU, Cars sources) |
| v34.3.3 | Price Sanity Guard, stable schema |
| v34.3.0 | Intent classifier, confidence degradation |
| v34.2.0 | Artifact Pipeline, PDF generation |
| v34.0.0 | Pravý sidebar |
| v33.3.x | Agent Platform polish |
| v33.0.0 | **Agent Platform** - DSL, scheduler, runner |
| v32.7 | Web search HARD/SOFT separation |
| v31.0 | **Architect UI** - SQLite, projects, conversations |

---

## 🔗 Odkazy

- **Hlavní UI:** http://localhost:3335/architect
- **Experts:** http://localhost:3335/experts
- **Agents:** http://localhost:3335/agents
- **Orchestrator API:** http://localhost:3335/api/orchestrator/stats
- **Health:** http://localhost:3335/

---

*Poslední aktualizace: 2026-01-21*
