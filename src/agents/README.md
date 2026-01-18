# C.3 v33 - Agent Platform

## ⚠️ KRITICKÁ ZÁSADA - DSL HRANICE

**NIKDY** nepřidávat do DSL:
- ❌ Regex
- ❌ Custom expressions  
- ❌ Custom functions
- ❌ JS snippets
- ❌ Eval nebo podobné

**Důvod:** Jakmile to přidáš, zlomíš:
- Auditovatelnost (nemůžeš vysvětlit co agent dělá)
- Bezpečnost (injection attacks)
- Jednoduchost builderu (LLM to nezvládne)
- Testovatelnost

**DSL musí zůstat deklarativní, ne imperativní.**

---

## 🎯 Co je nového

**v33 přidává Agent Platform** - systém pro vytváření autonomních agentů z přirozeného jazyka.

### Klíčové principy

1. **Builder = překladač** (ne autor)
   - Generuje POUZE z povolených bloků (DSL)
   - Validuje proti schema
   - Při chybě = error, ne hádání

2. **Conditions = deterministické**
   - `temp < 0`, `date_diff <= 2d`, `price_changed > 5%`
   - Žádné LLM v rozhodování

3. **Triggers = edge detection**
   - `false → true` (rising)
   - Ne spam při každém běhu

4. **LLM = side-car pouze pro text**
   - Formátování notifikací
   - Shrnutí dat
   - Nikdy rozhodování

---

## 📁 Nové soubory

```
src/agents/
├── schema.js       # DSL definice + validátor
├── conditions.js   # Deterministický evaluátor
├── triggers.js     # Edge detection
├── runner.js       # Execution engine (bez LLM v toku)
├── builder.js      # LLM překladač popis → definice
├── llm-services.js # Side-car pro text
├── repository.js   # DB operace
├── scheduler.js    # Cron/interval
├── api.js          # REST API routes
└── index.js        # Entry point
```

---

## 🚀 API Endpoints

```
# Agents CRUD
GET    /api/agents              - seznam agentů
POST   /api/agents              - vytvořit agenta
GET    /api/agents/:id          - detail
PUT    /api/agents/:id          - upravit
DELETE /api/agents/:id          - smazat

# Execution
POST   /api/agents/:id/run      - spustit manuálně
POST   /api/agents/:id/enable   - zapnout
POST   /api/agents/:id/disable  - vypnout
GET    /api/agents/:id/runs     - historie běhů

# Builder (create from description)
POST   /api/agents/build        - popis → draft
POST   /api/agents/refine       - upravit draft
POST   /api/agents/confirm      - potvrdit a vytvořit
GET    /api/agents/draft/:id    - načíst draft

# Notifications
GET    /api/notifications       - seznam notifikací
POST   /api/notifications/:id/read - označit přečtené

# Scheduler
GET    /api/scheduler/status    - stav scheduleru
```

---

## 📋 User Flow

```
1. POST /api/agents/build
   { "description": "Hlídej mráz 2 dny dopředu v Praze" }
   
   → Vrátí:
   {
     "definition": { ... validní agent definition ... },
     "explanation": "Agent bude...",
     "draft_id": "abc123"
   }

2. (Volitelně) POST /api/agents/refine
   { "draft_id": "abc123", "feedback": "Změň to na 3 dny" }

3. POST /api/agents/confirm
   { "draft_id": "abc123", "params": { "location": {...} } }
   
   → Agent vytvořen a schedulován
```

---

## 🔧 Instalace

Soubory jsou již integrovány v `src/agents/`. Stačí spustit server:

```bash
cd c3-agent-wip
node src/server.js
```

Server automaticky:
1. Inicializuje DB tabulky pro agenty
2. Spustí scheduler (kontrola každých 30s)

---

## 📝 DSL Schema

Viz `docs/AGENT-DSL-SCHEMA.md` pro kompletní specifikaci:

- Povolené typy (sources, conditions, triggers, actions)
- Validation rules
- Canonical patterns (HUNTER, MONITOR, TRACKER, DIGEST)
- Příklady

---

## ⚠️ Známá omezení v33.0

1. **Builder vyžaduje LLM client** - zatím null, potřeba propojit s Ollama
2. **Email notifikace** - zatím není implementováno
3. **Agent chaining** - zatím není implementováno

---

## 🖥️ UI

**Agent UI** dostupné na `/agents`:

1. **List View** - přehled agentů se status, summary cards, quick actions
2. **Create Stepper** - 4 kroky (Základ → Návrh → Nastavení → Review)
3. **Agent Detail** - Health panel, Logy s explain record, Nastavení
4. **Navigace** - Breadcrumb, šipka zpět, potvrzení při opuštění

---

## 📊 Změny oproti v32.8

| Oblast | v32.8 | v33 |
|--------|-------|-----|
| Agents | Základní tabulka | Plná platforma |
| Builder | - | LLM překladač |
| Conditions | - | Deterministický evaluátor |
| Triggers | - | Edge detection |
| Scheduler | - | Cron + interval |
| API | - | Kompletní CRUD + Builder |
| UI | - | List + Create stepper + Detail |
