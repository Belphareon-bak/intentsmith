# C.3 Agent v28

Lokální AI copilot s adaptivním workflow a SQLite persistencí.

## 🚀 Co je nového ve v28

### Klíčové změny oproti v27:

| Feature | v27 | v28 |
|---------|-----|-----|
| **Workflow** | Fixní (vždy DESIGN_AUDIT) | Adaptivní podle složitosti |
| **DESIGN_AUDIT** | Vždy, max 2 retry | Jen MEDIUM/HIGH, max 1 retry |
| **Persistence** | Soubory (.json, .md) | SQLite databáze |
| **Timeouty** | Dlouhé (60-180s) | Kratší (45-120s) |
| **JSON parsing** | Základní | Robustní s fallbacky |

### Adaptivní workflow:

```
SIMPLE (CLI, scripty):
  THINKER → ANALYZER → PLANNER → CODER → REVIEWER → DONE
  
MEDIUM (API, fullstack):
  + DESIGN_AUDIT (1 retry max)
  
HIGH (architektura, security):
  + ADVERSARIAL review (deepseek-r1)
```

## 📦 Instalace

```bash
# 1. Naklonuj/rozbal
cd ~/Projects
tar xzvf c3-v28.tar.gz
cd c3-v28

# 2. Nainstaluj závislosti
npm install

# 3. Inicializuj databázi
npm run db:init

# 4. Spusť server
npm start
```

### Požadavky:

- Node.js 20+
- Ollama s modely:
  - `qwen2.5:32b` (hlavní)
  - `qwen2.5-coder:32b` (kód)
  - `deepseek-r1:32b` (volitelné, pro HIGH)

```bash
# Stáhni modely
ollama pull qwen2.5:32b
ollama pull qwen2.5-coder:32b
ollama pull deepseek-r1:32b  # volitelné
```

## 🖥️ Použití

### Web UI

```
http://127.0.0.1:3335/ui
```

### API

```bash
# Start workflow
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "workdir": "/tmp/my-project",
    "message": "Vytvoř TODO CLI app v Node.js"
  }'

# Continue workflow (confirm)
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "message": "OK"
  }'

# Get status
curl http://127.0.0.1:3335/workflow/my-session
```

### Quick Test

```bash
npm run test:quick
```

## 📁 Struktura projektu

```
c3-v28/
├── src/
│   ├── server.js           # HTTP server + UI
│   ├── config.js           # Konfigurace
│   ├── core/
│   │   └── logger.js       # Logging
│   ├── db/
│   │   └── database.js     # SQLite + repositories
│   ├── llm/
│   │   ├── client.js       # Ollama client + JSON extraction
│   │   └── prompts.js      # System prompty pro role
│   └── workflow/
│       └── engine.js       # Workflow engine
├── data/
│   └── c3.db               # SQLite databáze
├── test/
│   └── quick-test.js       # Test script
└── package.json
```

## 🗃️ Databázové schéma

```sql
-- Projekty
projects (id, name, path, description, created_at, last_active)

-- Globální paměť
global_memory (id, key, value, category, created_at, updated_at)

-- Projektová paměť
project_memory (id, project_id, key, value, category, ...)

-- Chat sessions
chat_sessions (id, session_id, project_id, title, state, ...)

-- Chat messages
chat_messages (id, session_id, role, content, metadata, ...)

-- Learned patterns (pro auto-answer)
learned_patterns (id, pattern_hash, trigger_text, response_text, confirm_count, auto_apply, ...)

-- Workflow sessions
workflow_sessions (id, session_id, state, complexity, request, plan, implementation, timing, ...)

-- Agents (pro budoucí online agents)
agents (id, name, type, config, status, schedule, ...)
```

## ⚙️ Konfigurace

Environment variables:

```bash
C3_PORT=3335              # Server port
C3_HOST=127.0.0.1         # Server host
C3_DB_PATH=./data/c3.db   # SQLite path
C3_LOG_LEVEL=info         # debug, info, warn, error
OLLAMA_URL=http://localhost:11434
```

## 🔧 API Endpoints

| Method | Endpoint | Popis |
|--------|----------|-------|
| GET | `/` | Health check |
| POST | `/workflow` | Start/continue workflow |
| GET | `/workflow/:sessionId` | Get workflow status |
| GET | `/sessions` | List active sessions |
| POST | `/chat` | Simple chat (stateless) |
| GET | `/memory` | List global memory |
| POST | `/memory` | Set memory value |
| GET | `/projects` | List projects |
| POST | `/projects` | Create project |
| GET | `/ui` | Web interface |

## 🎯 Workflow States

| State | Popis | User Action |
|-------|-------|-------------|
| INIT | Počáteční stav | - |
| CLASSIFYING | Klasifikace složitosti | - |
| ANALYZING | Generování otázek | - |
| AUTO_ANSWER | Triviální otázky auto-answered | "OK" nebo upravit |
| ASK_USER | Kritické otázky | Odpovědět |
| PLANNING | Vytváření plánu | - |
| DESIGN_AUDIT | Audit designu (MEDIUM/HIGH) | - |
| PLAN_REVIEW | Plán k revizi | "OK" nebo feedback |
| IMPLEMENTING | Generování kódu | - |
| REVIEWING | Code review | - |
| FIXING | Opravy po review | - |
| ADVERSARIAL | Bezpečnostní review (HIGH) | - |
| DONE | Hotovo | - |
| ERROR | Chyba | - |

## 📝 Příklad workflow

```
1. User: "Vytvoř TODO CLI app"

2. C.3 klasifikuje: SIMPLE

3. THINKER generuje otázky:
   - Jaký formát dat? (TRIVIAL) → JSON
   - Kam uložit? (TRIVIAL) → tasks.json

4. ANALYZER: AUTO_ANSWER (všechny jsou TRIVIAL)

5. User: "OK"

6. PLANNER vytvoří plán

7. User: "OK" (potvrdí plán)

8. CODER implementuje

9. REVIEWER: PASS

10. DONE - soubory vytvořeny
```

## 🐛 Troubleshooting

### Timeout errors

Zkontroluj, že Ollama běží a modely jsou stažené:
```bash
ollama list
ollama run qwen2.5:32b "test"
```

### JSON parsing errors

v28 má robustní JSON extraction, ale pokud stále selhává:
- Zkontroluj logy (`C3_LOG_LEVEL=debug`)
- Model může vracet markdown místo JSON

### Database locked

```bash
# Reset databáze
npm run db:reset
```

## 🔮 Roadmap

- [ ] v29: Online agents (scheduler, notifications)
- [ ] v30: Mobile app (React Native)
- [ ] v31: Vector search pro memory
- [ ] v32: Multi-project workspace

---

<p align="center">
  <b>C.3</b> - Your Local AI Copilot 🤖
</p>
