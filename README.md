# C3 Agent

Lokální AI platforma pro konverzační asistenci, správu projektů a autonomní agenty. Běží kompletně offline na vlastním hardware — žádný cloud, žádné API klíče, žádné sdílení dat.

**Verze:** 119.0.0 | **352 modulů** | **208 testovacích sad** | **128,300+ řádků kódu**

---

## Co je C3

C3 je AI backend + IDE postavený pro vývojáře a knowledge workers, kteří chtějí lokální AI nástroj bez závislosti na cloudových službách.

### Konverzace a rozhodování
- **CRE (Conversational Reasoning Engine)** — single-authority klasifikátor: každý vstup → 1 z 19 typů záměrů → specializovaný handler. 10 guard pravidel, auditní trail, Gatekeeper pattern.
- **15 doménových expertýz** — 5D capability vektory (reasoning, kreativita, determinismus, risk, verbosity). Merge engine kombinuje až 3 expertýzy v jednom kontextu.
- **Quality Gate v2** — 4-vrstvý deterministický post-processing (structural → language → intent → content). Bez LLM.

### Projekty a build
- **Životní cyklus projektů** — SPEC → PLANNING → BUILD → REVIEW → CHANGE. Checkpointy (STRUCTURAL / FUNCTIONAL / SECURITY), automatický git commit, crash recovery.
- **Execution Engine** — iterativní fix cyklus: generuj → testuj → diagnostikuj → patchuj → testuj → konverguj. Patch engine s 3-tier anchoring, error normalizer (14 kódů, root cause analýza), fix strategy selection (DETERMINISTIC / HEURISTIC / LLM_FULL / SKIP).
- **Code Intelligence** — 33 modulů pro analýzu kódu: symbol index, knowledge graph (9 typů uzlů, 8 typů hran), AST analýza, architecture detection, drift detection, impact analysis, performance anti-pattern detection.

### Agenti a automatizace
- **Worker agenti** — RSS/HTTP/DB zdroje, deterministické podmínky, cron scheduling, 6 notifikačních kanálů.
- **Skills** — deterministické workflow (JSON): 8 typů kroků (llm, template, write, shell, ask, review, validate, substitute).
- **Specialisté** — pluginové balíčky s nástroji, znalostní bází a scénáři. Příklad: `accountant-cz` (české účetnictví).

### Paměť a učení
- **Dlouhodobá paměť (LTM)** — confidence decay (poločas 69 dní), reinforcement, feedback detekce, cross-session pattern learning.
- **Task Memory** — persistentní cross-milestone učení: co fungovalo, co selhalo, architektonická rozhodnutí.
- **Cross-Project Learning** — sdílení vzorců mezi projekty (stack similarity scoring, pattern generality).

### Infrastruktura
- **Model Upgrade System** — auto-discovery nových modelů, chat-based approval, streaming pull, rollback.
- **C3 Studio IDE** — Theia + Electron, 33 rozšíření, chat panel, agent log, settings (12 sekcí), specialist focus mode.
- **153 nástrojů** ve 35 kategoriích. Sandboxed execution, circuit breaker, risk assessment.

Vše běží lokálně přes Ollama (LLM inference) + SQLite (persistence) na jednom stroji.

---

## Architektura

```
                    ┌──────────────────┐
                    │   C3 Studio IDE  │
                    │  (Electron/Theia)│
                    └────────┬─────────┘
                             │ WebSocket + REST
                             ▼
┌─────────────────────────────────────────────────────────┐
│                     C3 Backend                          │
│                                                         │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐ │
│  │   CRE    │→ │ Handlers  │→ │     LLM Gateway      │ │
│  │ Decision │  │(19 types) │  │ (Ollama, 7 rolí)     │ │
│  └──────────┘  └───────────┘  └──────────────────────┘ │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────────┐ │
│  │Expertises│ │ Specialists│ │   Lifecycle Engine     │ │
│  │ (15 + N) │ │ (plugins)  │ │ (SPEC→BUILD→REVIEW)   │ │
│  └──────────┘ └────────────┘ └───────────────────────┘ │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────────┐ │
│  │  Skills  │ │   Agents   │ │  Execution Engine     │ │
│  │(workflow)│ │  (workers) │ │ (patch+loop+strategy) │ │
│  └──────────┘ └────────────┘ └───────────────────────┘ │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────────┐ │
│  │  Code    │ │   Memory   │ │   Model Upgrade       │ │
│  │  Intel   │ │(LTM+task+  │ │ (discovery+approval)  │ │
│  │(33 mod.) │ │ cross-proj)│ │                       │ │
│  └──────────┘ └────────────┘ └───────────────────────┘ │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────────┐ │
│  │ Quality  │ │   Tools    │ │    Notifications      │ │
│  │ Gate v2  │ │(153,sandb.)│ │ (email,TG,ntfy,WH)   │ │
│  └──────────┘ └────────────┘ └───────────────────────┘ │
│                                                         │
│                SQLite (WAL, 68 tabulek)                  │
└─────────────────────────────────────────────────────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │      Ollama      │
                    │  (lokální LLM)   │
                    └──────────────────┘
```

---

## Quick Start

```bash
# 1. Klonování a závislosti
git clone <repo-url> c3-agent && cd c3-agent
npm install

# 2. Konfigurace (výchozí hodnoty fungují bez úprav)
cp .env.example .env

# 3. Ollama modely (vyžaduje ~20 GB VRAM pro 32B modely)
ollama pull qwen3.5:27b          # hlavní chat + kód
ollama pull deepseek-r1-32b      # hluboká analýza + review

# 4. Start
node src/server.js
# → http://127.0.0.1:3335

# 5. IDE (volitelné)
cd c3-ide && yarn && yarn build && yarn start
```

Backend se automaticky restartuje při změnách (`node --watch src/server.js`).

---

## Prerekvizity

| Požadavek | Verze | Účel |
|-----------|-------|------|
| Node.js | 22+ | Backend runtime (ESM, `node:crypto`, `fetch()`) |
| Ollama | latest | Lokální LLM inference |
| Python 3 | 3.x | Kompilace native modulů (better-sqlite3, tree-sitter) |
| build-essential | - | C++ kompilátor pro native moduly |
| Git | 2.x+ | Lifecycle (auto-commit, diff, tagging) |
| yarn | 1.22+ | Pouze pro build IDE (volitelné) |
| GPU | 12+ GB VRAM | Doporučeno pro 32B modely (8B modely běží na 8 GB) |

Detailní pokyny: [docs/INSTALL.md](docs/INSTALL.md)

---

## Hlavní moduly

### CRE — Conversational Reasoning Engine
Centrální klasifikátor záměrů. Každý vstup projde přes `CRE.decide()`, který určí typ (CODE, SEARCH, CREATIVE, CONVERSATIONAL, PLAN, BUILD, FACTUAL, ...) a routuje na příslušný handler. Gatekeeper pattern — žádný kód nemůže CRE obejít.

- 10 guard pravidel (follow-up, attachment, creative override, skill detection, build deferral, ...)
- Auditní trail každého rozhodnutí v DB
- [docs/AUTHORITY.md](docs/AUTHORITY.md) — Gatekeeper architektura

### Expertýzy
15 vestavěných doménových profilů (programování, právo, finance, marketing, kreativní psaní, ...). Každá expertýza má 5D capability vektor ovlivňující tón, hloubku a styl odpovědí. Merge engine umožňuje kombinovat více expertýz.

- [docs/EXPERTISES.md](docs/EXPERTISES.md) — reference všech 15 expertýz
- [docs/C3-Merge-Engine-v2-FINAL.md](docs/C3-Merge-Engine-v2-FINAL.md) — merge algoritmus

### Specialisté
Pluginové balíčky rozšiřující expertýzy o nástroje, znalostní bázi a scénáře. Příklad: `accountant-cz` přidává kalkulačky DPH, daní, pojistného a české legislativní znalosti.

- [docs/SPECIALISTS.md](docs/SPECIALISTS.md) — architektura a API

### Životní cyklus projektů
Strukturovaný přístup k větším projektům. Fáze: specifikace → roadmapa → build (po milnících) → review → change management. Každý milník má checkpoint (STRUCTURAL / FUNCTIONAL / SECURITY), automatický git commit a tag.

- [docs/C3-Phase-C-Lifecycle-Plan.md](docs/C3-Phase-C-Lifecycle-Plan.md) — design
- [docs/STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) — persistence

### Code Intelligence
33 modulů v `src/code-intel/` (11,400+ řádků). Multi-engine code search (ripgrep → grep → Node.js fallback), symbol index, knowledge graph (9 typů uzlů, 8 typů hran), AST analýza (JS, Python, Go, Java), architecture detection (18 frameworků), drift detection, dead code detection, performance anti-pattern detection, dependency management.

- [docs/C3-ROADMAP.md](docs/C3-ROADMAP.md) — technický plán a specifikace

### Execution Engine
Iterativní fix cyklus pro milníky: generuj → testuj → diagnostikuj → patchuj → testuj → opakuj do konvergence (max 8 iterací). Patch engine s 3-tier anchor matching, error normalizer (14 error kódů, root cause analýza), fix strategy selection, self-critique (LLM + knowledge graph validace), task memory.

- `src/patch/` — parser, validator, applier, engine (1,278 řádků)
- `src/planner/execution-loop.js` — hlavní fix loop

### Skills
Deterministické workflow definované v JSON. 8 typů kroků: `llm`, `template`, `write`, `shell`, `ask`, `review`, `validate`, `substitute`. Meta-skill `create-skill` umožňuje vytvářet nové skills konverzačně.

- [docs/skills-v1.md](docs/skills-v1.md) — kompletní specifikace

### Autonomní agenti
Worker agenti monitorující datové zdroje (RSS, HTTP, DB), vyhodnocující podmínky a spouštějící akce. Cron/interval scheduling, notifikace přes 6 kanálů.

- [docs/WORKERS.md](docs/WORKERS.md) — architektura a konfigurace

### Paměťový systém
Tři vrstvy: LTM s confidence decay (λ=0.01, poločas 69 dní), task memory (cross-milestone, λ=0.005, poločas 139 dní), cross-project learning (stack similarity, pattern sharing). Feedback detektor, injection ranker, pattern tracker.

- [docs/MEMORY.md](docs/MEMORY.md) — architektura paměťového systému

### Model Upgrade System
Auto-discovery nových Ollama modelů, benchmarking, chat-based approval (nikdy auto-upgrade), streaming pull s progress, aplikace/rollback, čištění nepoužívaných modelů.

- `src/upgrade/` — model-profiles, model-discovery, upgrade-manager (1,334 řádků)

### Quality Gate v2
4-vrstvý deterministický pipeline (structural → language → intent → content). Bez LLM — čistě pravidlová validace výstupů. SK→CZ transliterace (~160 pravidel), language drift detection.

### Notifikace
6 kanálů: email (SMTP), Telegram, ntfy, webhook, desktop, push. Rate limiting, batching, digest mód, trust feedback (auto-degrade/mute).

### Nástroje
153 registrovaných nástrojů ve 35 kategoriích. Sandboxed execution s circuit breakerem (5 selhání / 30s → quarantine), auto-retry, health monitoring.

- [docs/tools/REGISTRY.md](docs/tools/REGISTRY.md) — reference všech nástrojů
- [docs/tools/EXECUTOR_CONTRACT.md](docs/tools/EXECUTOR_CONTRACT.md) — execution contract

---

## Tech Stack

| Vrstva | Technologie | Detail |
|--------|-------------|--------|
| Runtime | Node.js 22 (ESM) | Žádný framework — raw `http` modul |
| Databáze | SQLite | better-sqlite3, WAL mód, 68 tabulek, 32 migrací |
| LLM | Ollama | Lokální inference, 7 modelových rolí (D1, D2, CODE, R1, R2, CHAT, VISION) |
| IDE | C3 Studio | Theia 1.65.2 + Electron 37, 33 vlastních rozšíření |
| Frontend | React (lite) | Webpack bundle v chat-panel-module.js |
| AST | tree-sitter | JS, Python, Go, Java — symbol extraction, structural analysis |
| Závislosti | 13 produkčních | better-sqlite3, ws, dotenv, nodemailer, puppeteer, tree-sitter, chokidar, ... |

---

## Struktura projektu

```
c3-agent-wip/
├── src/                          # Backend (349 souborů, 126,500+ řádků)
│   ├── chat/                     #   CRE engine, handlery, quality pipeline
│   │   ├── cre-decision.js       #     Klasifikátor záměrů (2,900+ ř.)
│   │   ├── handlers/             #     19 intent handlerů + lifecycle router
│   │   └── quality/              #     Quality Gate v2 (4 vrstvy)
│   ├── code-intel/               #   Code Intelligence (33 modulů, 11,400+ ř.)
│   ├── planner/                  #   Lifecycle + execution engine (34 modulů, 14,900+ ř.)
│   ├── patch/                    #   Patch Engine (4 moduly, 1,278 ř.)
│   ├── memory/                   #   LTM, task memory, cross-project (9 modulů)
│   ├── upgrade/                  #   Model upgrade system (3 moduly, 1,334 ř.)
│   ├── expertises/               #   15 expertýz, merge engine, ledger
│   ├── agents/                   #   Worker agenti, scheduler, conditions
│   ├── skills/                   #   Registry, resolver, runner, 8 step types
│   ├── executor/                 #   Tool executor, circuit breaker, sandbox
│   ├── llm/                      #   Ollama gateway, web search, auth
│   ├── notifications/            #   6 kanálů (email, TG, ntfy, webhook, ...)
│   ├── routes/                   #   REST API (14 route modulů)
│   ├── ws-bridge/                #   WebSocket bridge (IDE ↔ backend)
│   ├── db/                       #   SQLite schema, 32 migrací
│   ├── core/                     #   Logger, error handler, feature manager
│   ├── domains/                  #   Scaffoldy (React, Vue, FastAPI, Flutter, ...)
│   ├── specialists/              #   Specialist loader + plugin system
│   ├── licensing/                #   HW fingerprint, 3 licence tiery
│   ├── autonomy/                 #   Self-tuning (drift detection, thresholds)
│   ├── telemetry/                #   Turn + specialist telemetrie
│   ├── channels/                 #   Channel adapters (CLI, Web, API)
│   ├── tools/                    #   Tool registry (153 nástrojů)
│   ├── context/                  #   Kontextové utility
│   ├── system/                   #   System info, health checks
│   ├── architect/                #   Roadmap parser
│   ├── setup/                    #   Setup wizard
│   ├── packaging/                #   Electron packaging
│   ├── ui/                       #   Architect web UI
│   └── server.js                 #   Entry point (startup, routing, shutdown)
│
├── c3-ide/                       # IDE (Theia + Electron)
│   ├── extensions/               #   33 vlastních rozšíření
│   │   └── c3-chat-panel/        #     Hlavní chat widget (4,000+ ř.)
│   └── applications/electron/    #   Electron wrapper + webpack
│
├── specialists/                  # Specialist balíčky
│   └── accountant-cz/            #   České účetnictví (DPH, daně, pojistné)
│
├── skills/                       # Skill definice (JSON)
│   ├── create-skill.json         #   Meta-skill pro tvorbu nových skills
│   └── create-expertise.json     #   Meta-skill pro tvorbu expertýz
│
├── tests/                        # Testovací sady (204 souborů)
│   ├── harness.js                #   Custom ESM test harness
│   ├── cre-*.test.js             #   CRE testy (401+)
│   ├── lifecycle-*.test.js       #   Lifecycle testy (103+)
│   ├── code-intel-*.test.js      #   Code Intelligence testy (339+)
│   ├── execution-loop.test.js    #   F-series testy (597+)
│   └── ...                       #   Celkem 3,000+ testů
│
├── docs/                         # Dokumentace (30+ dokumentů)
│   ├── ARCHITECTURE.md           #   Kompletní architektura
│   ├── CHANGELOG.md              #   Historie verzí (v56–v116)
│   ├── C3-ROADMAP.md             #   F-series technický plán
│   ├── ROADMAP.md                #   Roadmapa a stav fází
│   ├── INSTALL.md                #   Instalační příručka
│   └── ...                       #   25+ dalších dokumentů
│
├── data/                         # Runtime data (gitignored)
│   ├── c3.db                     #   SQLite databáze
│   ├── history/                  #   JSONL archiv konverzací
│   └── backups/                  #   Automatické zálohy
│
└── .env.example                  # Vzorová konfigurace
```

---

## Konfigurace

Veškerá konfigurace přes environment proměnné (`.env`). Výchozí hodnoty fungují bez úprav.

| Sekce | Klíčové proměnné | Default |
|-------|------------------|---------|
| Server | `C3_PORT`, `C3_HOST` | `3335`, `127.0.0.1` |
| Modely | `C3_MODEL_CHAT`, `C3_MODEL_CODE`, `C3_MODEL_D1` | qwen3.5:27b, qwen3.5:27b, deepseek-r1-32b |
| Databáze | `C3_DB_PATH` | `./data/c3.db` |
| Features | `C3_ENABLE_LIFECYCLE`, `C3_ENABLE_SKILLS`, ... | vše zapnuto |
| Bezpečnost | `C3_ADMIN_TOKEN` | - (localhost bypass v dev) |
| Notifikace | `C3_SMTP_*`, `C3_TELEGRAM_*`, `C3_NTFY_*` | - (volitelné) |

Kompletní reference: [.env.example](.env.example)

---

## API

Backend vystavuje REST API na `http://127.0.0.1:3335`:

| Prefix | Modul | Popis |
|--------|-------|-------|
| `/api/chat` | Chat | Konverzace, zprávy, export |
| `/api/projects` | Projects | Projekty, lifecycle, roadmapa |
| `/api/expertises` | Expertises | CRUD, merge preview, schema |
| `/api/agents` | Agents | CRUD, dry-run, scheduling |
| `/api/skills` | Skills | CRUD, reload, execution |
| `/api/specialists` | Specialists | Enable/disable, discovery |
| `/api/notifications` | Notifications | Kanály, test, trust |
| `/api/system` | System | Health, storage, GPU, backup, modely |
| `/api/security` | Security | Audit, tokeny, sessions |
| `/api/settings` | Settings | Uživatelská nastavení |

WebSocket na stejném portu — IDE ↔ backend real-time komunikace (chat, agent log, terminál, model upgrade progress).

---

## Testy

```bash
# Deterministické unit testy (~3,000+)
npm test

# Konkrétní test soubor
node tests/cre-comprehensive.test.js

# E2E testy (vyžadují běžící Ollama)
node tests/lifecycle-klicenka-e2e.test.js
```

Testy používají custom ESM harness (`tests/harness.js`): `suite()`, `test()`, `testAsync()`, `assert()`, `assertEqual()`.

---

## Dokumentace

### Hlavní dokumenty

| Dokument | Obsah |
|----------|-------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kompletní architektura systému, diagramy, design decisions |
| [CHANGELOG.md](docs/CHANGELOG.md) | Historie všech verzí (v56–v116) |
| [C3-ROADMAP.md](docs/C3-ROADMAP.md) | F-series technický plán — Code Intelligence + Agent Evolution |
| [ROADMAP.md](docs/ROADMAP.md) | Stav fází, plánované features |
| [INSTALL.md](docs/INSTALL.md) | Instalace (Ubuntu, Fedora, Docker) |

### Moduly a systémy

| Dokument | Obsah |
|----------|-------|
| [EXPERTISES.md](docs/EXPERTISES.md) | 15 doménových expertýz, 5D vektory, merge engine |
| [SPECIALISTS.md](docs/SPECIALISTS.md) | Specialist plugin architektura, runtime, KB, scénáře |
| [WORKERS.md](docs/WORKERS.md) | Autonomní agenti, scheduler, triggers, notifikace |
| [skills-v1.md](docs/skills-v1.md) | Skills systém, 8 step types, state machine, bezpečnost |
| [MEMORY.md](docs/MEMORY.md) | 3-vrstvý paměťový systém (LTM, task memory, cross-project) |
| [STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) | SQLite schema, drain, backup, retention |
| [tools/REGISTRY.md](docs/tools/REGISTRY.md) | 153 nástrojů, kategorie, risk assessment |
| [PROJECT-SYSTEM.md](docs/PROJECT-SYSTEM.md) | Project management systém |

### Design dokumenty

| Dokument | Obsah |
|----------|-------|
| [AUTHORITY.md](docs/AUTHORITY.md) | CRE Gatekeeper, single authority pattern |
| [C3-Merge-Engine-v2-FINAL.md](docs/C3-Merge-Engine-v2-FINAL.md) | Merge algoritmus (15.5 kroků), token budgeting |
| [C3-Phase-C-Lifecycle-Plan.md](docs/C3-Phase-C-Lifecycle-Plan.md) | Lifecycle design, fáze, recovery |
| [WS-PROTOCOL.md](docs/WS-PROTOCOL.md) | WebSocket protokol |
| [tools/EXECUTOR_CONTRACT.md](docs/tools/EXECUTOR_CONTRACT.md) | Tool execution contract, retry policy |

Celkem **30+ dokumentů** dokumentace.

---

## Licence

Systém licencí vázaný na hardware fingerprint (3 tiery: FREE / PRO / ENTERPRISE). Offline validace — žádný license server.

| Tier | Projekty | Agenti | Specialisté | Export |
|------|----------|--------|-------------|--------|
| FREE | 1 | - | - | md, txt |
| PRO | neomezeně | ano | ano | md, txt, html, pdf, docx |
| ENTERPRISE | neomezeně | ano | ano | vše + multi-user |
