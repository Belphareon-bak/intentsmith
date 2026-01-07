# C.3 - AI Agent System

<p align="center">
  <img src="https://img.shields.io/badge/version-0.22-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License">
  <img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Status">
</p>

**C.3** je lokální AI copilot pro vývoj software. Využívá hierarchický multi-model workflow pro generování kvalitního kódu s automatickým review a iterativními opravami.

---

## 🎯 Vize

Vytvořit AI asistenta, který:

1. **Generuje kvalitní kód** - Přes multi-model workflow s dvojitým review
2. **Učí se z projektů** - Memory Bank pro persistentní znalosti
3. **Běží lokálně** - Žádné API klíče, plná kontrola nad daty
4. **Rozšiřitelný** - Online agenti, notifikace, mobilní app (roadmap)

---

## 🏗️ Architektura

### Workflow Engine

C.3 používá hierarchický systém s 5 specializovanými modely:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER REQUEST                                  │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  D1 - Chief Architect (deepseek-r1-32b)                             │
│  • Analyzuje požadavek                                               │
│  • Ptá se na upřesnění u vágních zadání                             │
│  • Vytváří detailní implementační plán                              │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                          User confirms
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CODE - Implementation Expert (qwen2.5-coder-32b)                   │
│  • Implementuje podle plánu D1                                       │
│  • Vytváří všechny potřebné soubory                                 │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  R2 - Junior Reviewer (qwen2.5:32b)                                 │
│  • Rychlá kontrola: syntax, importy, dependencies                   │
│  • FAIL → D2 opraví, PASS → R1 finální review                       │
└─────────────────────────────────────────────────────────────────────┘
                    │                               │
                   FAIL                            PASS
                    │                               │
                    ▼                               ▼
┌───────────────────────────┐     ┌───────────────────────────────────┐
│  D2 - Fix Designer        │     │  R1 - Senior Reviewer             │
│  (qwen3-30b)              │     │  (deepseek-r1-32b)                │
│  • Navrhuje opravy        │     │  • Architektura, bezpečnost       │
│  • CODE aplikuje          │     │  • Best practices                 │
│  • Zpět na R2             │     │  • APPROVED → DONE ✅              │
└───────────────────────────┘     │  • REDESIGN → zpět na D1          │
                                  │  • MINOR_ISSUES → D2 fix loop     │
                                  └───────────────────────────────────┘
```

### Model Role Assignments

| Role | Model | GPU VRAM | Účel |
|------|-------|----------|------|
| D1 | deepseek-r1-32b | ~20GB | Plánování, analýza, finální architektura |
| D2 | qwen3-30b-a3b | ~18GB | Návrhy oprav |
| R1 | deepseek-r1-32b | ~20GB | Senior review, finální gate |
| R2 | qwen2.5:32b | ~18GB | Junior review, rychlé iterace |
| CODE | qwen2.5-coder-32b | ~18GB | Implementace |

> **Poznámka:** Modely běží přes [Ollama](https://ollama.ai). Potřebujete GPU s minimálně 24GB VRAM pro plynulý běh.

---

## 📦 Instalace

### Prerekvizity

- **Node.js** >= 18.0.0
- **Ollama** nainstalovaný a běžící
- **GPU** s dostatečnou VRAM (viz tabulka výše)

### Krok 1: Nainstalujte Ollama modely

```bash
# Hlavní modely
ollama pull deepseek-r1:32b
ollama pull qwen2.5-coder:32b
ollama pull qwen2.5:32b
ollama pull qwen3:30b-a3b

# Ověřte že Ollama běží
ollama list
```

### Krok 2: Naklonujte repozitář

```bash
git clone https://github.com/your-username/c3-agent.git
cd c3-agent
```

### Krok 3: Spusťte server

```bash
node orchestrator/server.js
```

Server naběhne na `http://127.0.0.1:3335`

---

## 🚀 Použití

### Web UI

Otevřete `http://127.0.0.1:3335` v prohlížeči.

### CLI / cURL

```bash
# Inicializace projektu
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "message": "/init",
    "sessionId": "my-project",
    "workdir": "/path/to/project"
  }'

# Zadání úkolu
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Vytvoř REST API pro správu uživatelů v Node.js s Express",
    "sessionId": "my-project",
    "workdir": "/path/to/project"
  }'

# Potvrzení plánu
curl -X POST http://127.0.0.1:3335/workflow \
  -H "Content-Type: application/json" \
  -d '{
    "message": "OK",
    "sessionId": "my-project"
  }'
```

### Shell Aliasy (doporučeno)

Přidejte do `~/.bashrc` nebo `~/.zshrc`:

```bash
export C3_API="http://127.0.0.1:3335"

c3() {
  curl -s -X POST "$C3_API/workflow" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg m "$1" --arg s "${2:-default}" --arg w "${3:-$PWD}" \
      '{message: $m, sessionId: $s, workdir: $w}')" | jq -r '.response // .'
}

c3-state() {
  curl -s "$C3_API/workflow/${1:-default}" | jq '.'
}

# Použití:
# c3 "/init" my-project ~/Projects/app
# c3 "Vytvoř login endpoint" my-project
# c3 "OK" my-project
```

---

## 📚 Příkazy

C.3 podporuje speciální příkazy začínající `/`:

| Příkaz | Popis |
|--------|-------|
| `/init` | Inicializace kontextu - načte Memory Bank a TODO |
| `/todo <text>` | Přidá nový úkol do TODO.md |
| `/done [id]` | Označí úkol jako dokončený |
| `/memory` | Zobrazí obsah Memory Bank |
| `/updateMemory <cat> <name> <content>` | Přidá znalost do Memory Bank |
| `/plan` | Zobrazí aktuální implementační plán |
| `/status` | Stav projektu (memory, todo, plán) |
| `/help` | Nápověda |

### Příklad workflow

```bash
# 1. Inicializuj projekt
c3 "/init" api-project ~/Projects/my-api

# 2. Přidej úkoly
c3 "/todo Implementovat autentizaci"
c3 "/todo Vytvořit CRUD pro uživatele"
c3 "/todo Napsat testy"

# 3. Zadej úkol (D1 vytvoří plán)
c3 "Vytvoř Express.js REST API s JWT autentizací a CRUD pro uživatele"

# 4. Zkontroluj plán a potvrď
c3 "OK"

# 5. Počkej na dokončení, pak označ hotovo
c3 "/done 1"
c3 "/done 2"

# 6. Ulož naučené do Memory Bank
c3 "/updateMemory workflows jwt-auth Pro JWT autentizaci používat middleware s verify funkcí"
```

---

## 🧠 Memory Bank

Memory Bank je persistentní úložiště znalostí pro projekt:

```
project/
└── memories/
    ├── workflows/      # Naučené postupy
    │   └── api-design.md
    ├── constraints/    # Pravidla a omezení
    │   └── no-secrets.md
    ├── tools/          # Nástroje a jejich použití
    │   └── testing.md
    └── metadata/       # Kontext projektu
        └── tech-stack.md
```

### Co ukládat

✅ **Ano:**
- Meta-znalosti a vzory ("REST endpointy v kebab-case")
- Pravidla a konvence ("Žádné hardcoded secrets")
- Reusable postupy ("JWT refresh token flow")

❌ **Ne:**
- Implementační detaily konkrétního projektu
- Logy a statistiky
- Dočasné informace

**Test:** "Použil bych to v jiném projektu?" → Pokud ano, ulož.

---

## 🔌 API Reference

### Endpoints

| Method | Path | Popis |
|--------|------|-------|
| `POST` | `/workflow` | Start nebo pokračování workflow |
| `GET` | `/workflow/:sessionId` | Stav workflow session |
| `DELETE` | `/workflow/:sessionId` | Smazání session |
| `GET` | `/tools` | Seznam dostupných nástrojů |
| `POST` | `/tools/execute` | Spuštění nástroje |
| `GET` | `/memory` | Statistiky paměti |
| `GET` | `/projects` | Seznam projektů |
| `GET` | `/stream` | SSE real-time události |
| `GET` | `/health` | Health check |
| `GET` | `/status` | Systémový status |

### POST /workflow

**Request:**
```json
{
  "message": "Vytvoř TODO app",
  "sessionId": "my-session",
  "workdir": "/path/to/project",
  "projectName": "todo-app"
}
```

**Response:**
```json
{
  "sessionId": "my-session",
  "state": "PLAN_REVIEW",
  "response": "## Plán implementace\n...",
  "needsInput": true,
  "plan": "...",
  "iterations": 0
}
```

**States:**
- `INIT` - Čeká na požadavek
- `CLARIFYING` - D1 se ptá na upřesnění
- `PLANNING` - D1 vytváří plán
- `PLAN_REVIEW` - Čeká na potvrzení plánu
- `IMPLEMENTING` - CODE implementuje
- `REVIEWING_R2` - R2 kontroluje
- `FIXING_D2` - D2 navrhuje opravy
- `REVIEWING_R1` - R1 finální review
- `DONE` - Dokončeno
- `ERROR` - Chyba

---

## 🛠️ Nástroje (Tools)

C.3 má 53 vestavěných nástrojů v 8 kategoriích:

| Kategorie | Nástroje | Příklady |
|-----------|----------|----------|
| `filesystem` | 10 | read, write, list, search, copy, move |
| `shell` | 5 | exec, spawn, kill |
| `web` | 4 | fetch, search |
| `code` | 8 | parse, lint, format |
| `git` | 6 | status, commit, diff, log |
| `system` | 5 | resources, env, processes |
| `project` | 8 | init, analyze, dependencies |
| `packages` | 7 | npm install, list |

---

## 📁 Struktura projektu

```
c3-agent/
├── orchestrator/
│   ├── agent/
│   │   ├── workflow-agent.js    # Hlavní workflow engine
│   │   ├── workflow-api.js      # HTTP API
│   │   └── commands.js          # /init, /todo, /memory...
│   ├── memory/
│   │   ├── memory-bank.js       # Memory Bank manager
│   │   └── todo-manager.js      # TODO tracking
│   ├── llm/
│   │   ├── llm-client.js        # LLM caller
│   │   └── ollama-client.js     # Ollama backend
│   ├── tools/
│   │   ├── registry.js          # Tool registry
│   │   ├── fs-tools.js          # Filesystem tools
│   │   ├── shell-tools.js       # Shell tools
│   │   └── ...
│   ├── config/
│   │   └── role-model-binding.json
│   └── server.js                # Unified HTTP server
├── ui/
│   └── index.html               # Web UI
├── test-workflow-auto.sh        # Automatický test
├── test-commands.sh             # Test příkazů
└── README.md
```

---

## 🧪 Testování

```bash
# Automatický test workflow (vytvoří TODO CLI app)
./test-workflow-auto.sh

# Test příkazů (/init, /todo, /memory...)
./test-commands.sh

# Manuální test
curl http://127.0.0.1:3335/health
```

---

## 🗺️ Roadmap

### ✅ Implementováno (v0.22)

- [x] Multi-model workflow (D1, D2, R1, R2, CODE)
- [x] Memory Bank
- [x] TODO tracking
- [x] Commands (/init, /todo, /done, /memory, /plan)
- [x] 53 vestavěných nástrojů
- [x] Web UI
- [x] HTTP API

### 🚧 V plánu

**v0.23-0.26: Online Agents**
- [ ] Scheduler system (node-cron)
- [ ] Notification hub (ntfy.sh + email)
- [ ] Weather monitor agent
- [ ] News digest agent

**v0.27-0.30: Advanced Agents**
- [ ] Property hunter (multi-portal scraper)
- [ ] Device manager + warranty tracking
- [ ] Compatibility engine

**v0.31+: Mobile**
- [ ] React Native app
- [ ] Push notifications
- [ ] Voice commands

---

## ⚠️ Známé limitace

1. **GPU požadavky** - Modely vyžadují výkonnou GPU (min 24GB VRAM pro plynulý běh)
2. **Rychlost** - Kompletní workflow může trvat 3-5 minut
3. **Čeština** - Modely rozumí česky, ale kvalita je lepší v angličtině
4. **Alpha stav** - Systém je ve vývoji, očekávejte bugy

---

## 🤝 Přispívání

1. Fork repozitáře
2. Vytvořte feature branch (`git checkout -b feature/amazing-feature`)
3. Commit změny (`git commit -m 'Add amazing feature'`)
4. Push do branch (`git push origin feature/amazing-feature`)
5. Otevřete Pull Request

---

## 📄 Licence

MIT License - viz [LICENSE](LICENSE)

---

## 🙏 Poděkování

- [Ollama](https://ollama.ai) - Lokální běh LLM modelů
- [DeepSeek](https://deepseek.com) - deepseek-r1 model
- [Qwen](https://qwenlm.github.io) - qwen2.5-coder a qwen3 modely

---

## 📞 Kontakt

- **GitHub Issues** - Pro bug reporty a feature requesty
- **Discussions** - Pro obecné dotazy

---

<p align="center">
  <b>C.3</b> - Your Local AI Copilot 🤖
</p>
