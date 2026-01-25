# 🤖 C.3 Agent

**Lokální AI asistent a workflow automatizační platforma**

```
Verze: v44.1.0 (stable)
Stack: Node.js + SQLite + Ollama
```

---

## 🎯 Co je C.3 Agent?

C.3 Agent je inteligentní copilot pro software development a project management, který kombinuje:

| Modul | Popis |
|-------|-------|
| **Architect Mode** | Konverzační AI pro vývoj - projekty, chaty, artefakty |
| **Agent Platform** | Autonomní agenti pro monitoring a notifikace |
| **Expert Layer** | 15 specializovaných "mistrů v oboru" |
| **CRE Decision Engine** | Tool-first rozhodování - TOOL_CALL před ANSWER |
| **ToolExecutor** | Exekuce nástrojů z CRE rozhodnutí |
| **Data Layer** | Doménové zdroje (GPU, Cars...) |

---

## 🚀 Quick Start

```bash
# 1. Klonuj/rozbal projekt
cd ~/Projects/c3-agent-wip

# 2. Instalace závislostí
npm install

# 3. Ujisti se, že běží Ollama
ollama serve

# 4. Spusť server
node src/server.js

# 5. Otevři v prohlížeči
open http://localhost:3335/architect
```

### Požadavky

- Node.js 18+
- Ollama s modely:
  - `qwen2.5:32b` (hlavní reasoning)
  - `qwen2.5-coder:32b` (code generation)
  - `deepseek-r1:32b` (adversarial review)

---

## 📡 Endpoints

| URL | Popis |
|-----|-------|
| http://localhost:3335/ | Health check, API info |
| http://localhost:3335/architect | **Hlavní UI** - chat, projekty |
| http://localhost:3335/experts | Expert Layer management |
| http://localhost:3335/agents | Agent Platform UI |

### API Routes

```
GET  /api/projects          - Seznam projektů
POST /api/projects          - Vytvoř projekt
GET  /api/conversations     - Seznam chatů
POST /api/chat              - Pošli zprávu
GET  /api/experts           - Seznam expertů
POST /api/experts           - Vytvoř custom experta
GET  /api/agents            - Seznam agentů
POST /api/agents/build      - Vytvoř agenta z popisu
```

---

## 🏗️ Architektura

```
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    ARCHITECT UI                             │
│  Projects │ Conversations │ Attachments │ Settings          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    EXPERT LAYER                             │
│  15 built-in expertů │ Custom experts │ Router              │
│  Writer │ Analyst │ Developer │ Lawyer │ Doctor │ ...       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                      C3 CORE                                │
│  Decision Layer │ Representation Layer │ Artifact Pipeline  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    DATA LAYER                               │
│  GPU Source │ Cars Source │ Evidence │ Sanity Checks        │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   AGENT PLATFORM                            │
│  Scheduler │ Runner │ Triggers │ Actions │ Notifications    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎓 Expert Layer

15 vestavěných expertů v 5 kategoriích:

| Kategorie | Experti |
|-----------|---------|
| **Tvůrčí** | Writer, DnD Master, Songwriter |
| **Analytičtí** | Analyst, Trader, Accountant |
| **Normativní** | Lawyer ⚖️, Doctor 🏥, Psychologist 💭 |
| **Techničtí** | AI Expert, Developer, Technician |
| **Doménoví** | Car Enthusiast, Biker, Political Analyst |

### Expert parametry

```javascript
{
  planningDepth: 'none' | 'light' | 'deep',
  reviewPolicy: 'none' | 'self' | 'iterative',
  dataUsagePolicy: 'forbidden' | 'evidence' | 'controlled',
  outputBias: 'creative' | 'analytical' | 'conservative',
  temperature: 0.0 - 1.0
}
```

### Custom expert

```bash
curl -X POST http://localhost:3335/api/experts \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my_expert",
    "name": "Můj Expert",
    "domain": "custom",
    "category": "domain",
    "systemPrompt": "Jsi expert na...",
    "temperature": 0.5
  }'
```

---

## 🤖 Agent Platform

Agenti běží na pozadí a monitorují zdroje dat.

### Agent definice (DSL)

```javascript
{
  "id": "price-monitor",
  "name": "Hlídač cen GPU",
  "schedule": { "type": "interval", "value": "1h" },
  
  "sources": [{
    "id": "alza",
    "type": "scraper",
    "url": "https://..."
  }],
  
  "conditions": [{
    "id": "price_drop",
    "type": "compare",
    "field": "price",
    "operator": "<",
    "value": 15000
  }],
  
  "triggers": [{
    "id": "alert",
    "condition_id": "price_drop",
    "edge": "rising"
  }],
  
  "actions": [{
    "type": "notify",
    "trigger_id": "alert",
    "config": { "message": "Cena klesla!" }
  }]
}
```

### Podmínky (conditions)

| Typ | Popis |
|-----|-------|
| `compare` | Porovnání hodnoty (< > <= >= == !=) |
| `new_items` | Detekce nových položek |
| `changed` | Detekce změny hodnoty |
| `exists` | Existence pole |
| `contains` | Obsahuje text |
| `in_range` | Hodnota v rozsahu |
| `date_diff` | Rozdíl datumů |

---

## 📁 Struktura projektu

```
c3-agent-wip/
├── package.json
├── README.md
├── ROADMAP.md
├── CHANGELOG.md
│
└── src/
    ├── server.js              # Hlavní server
    ├── config.js              # Konfigurace
    │
    ├── core/
    │   └── logger.js
    │
    ├── db/
    │   └── database.js        # SQLite + FTS5
    │
    ├── experts/               # Expert Layer (v35)
    │   ├── expert-layer.js
    │   └── experts.html
    │
    ├── agents/                # Agent Platform (v33)
    │   ├── repository.js
    │   ├── scheduler.js
    │   ├── runner.js
    │   ├── conditions.js
    │   ├── triggers.js
    │   ├── schema.js
    │   ├── api.js
    │   └── agents.html
    │
    ├── data/                  # Data Layer (v34.4)
    │   ├── data-layer.js
    │   ├── gpu-source.js
    │   └── cars-source.js
    │
    ├── workflow/
    │   └── engine.js          # Multi-model pipeline
    │
    ├── llm/
    │   ├── client.js
    │   ├── cre-bridge.js       # LLM bridge for CRE
    │   └── web-search.js
    │
    ├── unification/            # CRE v44 - Unified Decision Engine
    │   ├── cre-decision.js     # Decision types, intent classification
    │   ├── tool-executor.js    # Tool execution layer
    │   ├── handlers.js         # Mode handlers (conversation, project, expert, agent)
    │   └── chat-controller.js  # Session & mode management
    │
    ├── ui/
    │   └── architect/
    │       ├── architect.html
    │       ├── architect.css
    │       └── architect.js
    │
    └── artifact-pipeline.js   # PDF/DOCX generation
```

---

## 🔧 Konfigurace

```javascript
// src/config.js
export const config = {
  port: 3335,
  
  llm: {
    baseUrl: 'http://localhost:11434',
    models: {
      thinker: 'qwen2.5:32b',
      coder: 'qwen2.5-coder:32b',
      reviewer: 'deepseek-r1:32b'
    }
  },
  
  db: {
    path: './data/c3.db'
  }
};
```

---

## 🐛 Troubleshooting

### GPU není detekována

```bash
# Reload nvidia_uvm modulu
sudo rmmod nvidia_uvm && sudo modprobe nvidia_uvm

# Ověř
nvidia-smi
```

### Ollama neodpovídá

```bash
# Zkontroluj, že běží
curl http://localhost:11434/api/tags

# Restart
systemctl restart ollama
# nebo
ollama serve
```

### Server nenastartuje

```bash
# Zkontroluj port
lsof -i :3335

# Zkontroluj syntaxi
node --check src/server.js
```

### Expert layer se nenačte

Zkontroluj strukturu:
```
src/
└── experts/
    ├── expert-layer.js  ← musí existovat
    └── experts.html
```

---

## 📊 Verze a status

| Verze | Status | Popis |
|-------|--------|-------|
| v44.1.0 | ✅ **Stable** | Unified Decision Engine, ToolExecutor, Handlers |
| v43.x | ✅ Stable | Ecosystem Layer |
| v42.x | ✅ Stable | Copilot Layer |
| v41.x | ✅ Stable | Skills Layer |
| v40.x | ✅ Stable | Observability Layer |
| v39.x | ✅ Stable | Autonomous Mode |

### Milníky

| Verze | Milestone | Datum |
|-------|-----------|-------|
| v31 | Architect UI | 2026-01-11 |
| v33 | Agent Platform | 2026-01-18 |
| v34 | Layers (Data, Decision, Representation) | 2026-01-18/19 |
| v35 | Expert Layer | 2026-01-19 |
| v39 | Autonomous Mode | 2026-01-22 |
| v40 | Observability | 2026-01-23 |
| v41 | Skills | 2026-01-23 |
| v42 | Copilot | 2026-01-24 |
| v43 | Ecosystem | 2026-01-24 |
| v44 | Unification (CRE v44) | 2026-01-25 |

---

## 🗺️ Roadmap

Viz [ROADMAP.md](./ROADMAP.md) pro detailní plán.

### Aktuální verze (v44.1)

**CRE Unification** - sjednocený rozhodovací engine:

1. ✅ **CRE Decision Engine** - Tool-first decision logic
2. ✅ **ToolExecutor** - Actual tool execution (not description)
3. ✅ **Handlers** - Project, Expert, Agent mode handlers
4. ✅ **AgentRunner.dryRun** - Config validation without execution
5. ✅ **UI Autoscroll** - Chat scrolls to new messages

### Klíčové invarianty v44

- **SEARCH/FACTUAL/REPORT** → vždy TOOL_CALL (nikdy ANSWER)
- **ANSWER** pouze pro CONVERSATIONAL intent
- **Forbidden phrases** detekce ("nemám přístup k internetu...")
- **Project mode** → CRE s `hasActiveProject=true`
- **Expert mode** → locked expert until user changes

---

## 🏛️ Architektonické principy

### Rozdělení odpovědnosti

| Vrstva | Odpovědnost |
|--------|-------------|
| Agent Platform | Detekce, spouštění, notifikace |
| Expert Layer | Myšlení a styl |
| C3 Core | Pravidla reality |
| UI | Kontrola a přehled |

### Pravidla

- ✅ Expert neví kdo ho volá (anonymizace)
- ✅ Agent je hloupý vykonavatel
- ✅ Orchestrator je jediný bod delegace
- ❌ Expert NESMÍ spouštět akce (pouze navrhnout)
- ❌ Agent NESMÍ volat agenta
- ❌ Expert NESMÍ volat experta

---

## 📜 Licence

Interní projekt. Všechna práva vyhrazena.

---

## 🤝 Kontakt

**Projekt:** C.3 Agent  
**Maintainer:** Belfik  
**Stack:** Node.js, SQLite, Ollama, Vanilla JS
