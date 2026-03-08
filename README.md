# C3 Agent

Lokální AI platforma pro konverzační asistenci, správu projektů a autonomní agenty. Běží kompletně offline na vlastním hardware — žádný cloud, žádné API klíče, žádné sdílení dat.

**Verze:** 93.0.0 | **282 modulů** | **149 testovacích sad** | **8 produkčních závislostí**

---

## Co je C3

C3 je AI backend + IDE postavený pro vývojáře a knowledge workers, kteří chtějí lokální AI nástroj bez závislosti na cloudových službách. Systém kombinuje:

- **Konverzační engine (CRE)** — klasifikuje každý uživatelský vstup do 7 typů záměrů (CODE, SEARCH, CREATIVE, FILE_EXPLAIN, ...) a routuje na specializované handlery. Jeden autorita model — žádné obcházení.
- **15 doménových expertýz** — 5D vektory (reasoning, kreativita, determinismus, risk, verbosity) s merge engine pro kombinaci více expertýz v jednom kontextu.
- **Systém specialistů** — pluginové balíčky s vlastními nástroji, znalostní bází a scénáři. Příklad: `accountant-cz` (české účetnictví, DPH, daně).
- **Životní cyklus projektů** — SPEC → PLANNING → BUILD → REVIEW → CHANGE. Milníky, checkpointy, automatický git commit, crash recovery.
- **Skills** — deterministické workflow s kroky (LLM, šablona, zápis, shell, validace). Uživatel definuje JSON, systém provádí.
- **Autonomní agenti** — worker agenti s RSS/HTTP/DB zdroji, podmínkami a akcemi. Cron scheduling, notifikace přes email/Telegram/webhook.
- **Paměťový systém** — dlouhodobá paměť s confidence decay (poločas 69 dní), feedback detekce, cross-session pattern learning.
- **C3 Studio IDE** — Theia + Electron s 33 rozšířeními. Chat panel, agent log, terminál, file explorer, settings.

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
┌─────────────────────────────────────────────────────┐
│                   C3 Backend                        │
│                                                     │
│  ┌─────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │   CRE   │→ │ Handlers  │→ │    LLM Gateway   │  │
│  │ Decision │  │ (7 types) │  │ (Ollama, 6 roles)│  │
│  └─────────┘  └───────────┘  └──────────────────┘  │
│                                                     │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │Expertises│ │ Specialists│ │    Lifecycle      │  │
│  │ (15 + N) │ │ (plugins)  │ │ (SPEC→BUILD→REV) │  │
│  └──────────┘ └────────────┘ └──────────────────┘  │
│                                                     │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │  Skills  │ │   Agents   │ │     Memory       │  │
│  │(workflow)│ │  (workers) │ │ (LTM + patterns) │  │
│  └──────────┘ └────────────┘ └──────────────────┘  │
│                                                     │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ Quality  │ │   Tools    │ │  Notifications   │  │
│  │ Gate v2  │ │(153, sandb)│ │(email,TG,webhook)│  │
│  └──────────┘ └────────────┘ └──────────────────┘  │
│                                                     │
│               SQLite (WAL, 58 tabulek)              │
└─────────────────────────────────────────────────────┘
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
ollama pull qwen3.5:27b          # hlavní chat
ollama pull qwen3.5:27b    # generování kódu
ollama pull deepseek-r1-32b      # hluboká analýza

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
| Python 3 | 3.x | Kompilace native modulů (better-sqlite3) |
| build-essential | - | C++ kompilátor pro native moduly |
| Git | 2.x+ | Lifecycle (auto-commit, diff, tagging) |
| yarn | 1.22+ | Pouze pro build IDE (volitelné) |
| GPU | 12+ GB VRAM | Doporučeno pro 32B modely (8B modely běží na 8 GB) |

Detailní pokyny: [docs/INSTALL.md](docs/INSTALL.md)

---

## Hlavní moduly

### CRE — Conversational Reasoning Engine
Centrální klasifikátor záměrů. Každý vstup projde přes `CRE.decide()`, který určí typ (CODE, SEARCH, CREATIVE, CONVERSATIONAL, PLAN, TOOL_CALL, AMBIGUOUS) a routuje na příslušný handler. Gatekeeper pattern — žádný kód nemůže CRE obejít.

- 9 guard pravidel (follow-up, attachment, creative override, skill detection, ...)
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

### Skills
Deterministické workflow definované v JSON. 8 typů kroků: `llm`, `template`, `write`, `shell`, `ask`, `review`, `validate`, `substitute`. Meta-skill `create-skill` umožňuje vytvářet nové skills konverzačně.

- [docs/skills-v1.md](docs/skills-v1.md) — kompletní specifikace

### Autonomní agenti
Worker agenti monitorující datové zdroje (RSS, HTTP, DB), vyhodnocující podmínky a spouštějící akce. Cron/interval scheduling, notifikace přes 6 kanálů.

- [docs/WORKERS.md](docs/WORKERS.md) — architektura a konfigurace

### Paměťový systém
Dlouhodobá paměť (LTM) s confidence decay (λ=0.01, poločas 69 dní), reinforcement při opakovaném přístupu. Feedback detektor rozpoznává 6 typů signálů. Pattern tracker sleduje intent sekvence across sessions.

### Quality Gate v2
4-vrstvý deterministický pipeline (structural → language → intent → content). Bez LLM — čistě pravidlová validace výstupů. Detekce language drift, fluff, hedging.

### Notifikace
6 kanálů: email (SMTP), Telegram, ntfy, webhook, desktop, push. Rate limiting, batching, digest mód.

### Nástroje
153 registrovaných nástrojů ve 35 kategoriích. Sandboxed execution s circuit breakerem (5 selhání / 30s → quarantine), auto-retry, health monitoring.

- [docs/tools/REGISTRY.md](docs/tools/REGISTRY.md) — reference všech nástrojů
- [docs/tools/EXECUTOR_CONTRACT.md](docs/tools/EXECUTOR_CONTRACT.md) — execution contract

---

## Tech Stack

| Vrstva | Technologie | Detail |
|--------|-------------|--------|
| Runtime | Node.js 22 (ESM) | Žádný framework — raw `http` modul |
| Databáze | SQLite | better-sqlite3, WAL mód, 58 tabulek, 28 migrací |
| LLM | Ollama | Lokální inference, 6 modelových rolí (D1, D2, CODE, R1, R2, CHAT) |
| IDE | C3 Studio | Theia 1.65.2 + Electron 37, 33 vlastních rozšíření |
| Frontend | React (lite) | Webpack bundle v chat-panel-module.js |
| Závislosti | 8 produkčních | better-sqlite3, ws, dotenv, nodemailer, puppeteer, ... |

---

## Struktura projektu

```
c3-agent-wip/
├── src/                          # Backend (282 souborů, 73,700+ řádků)
│   ├── chat/                     #   CRE engine, handlery, quality pipeline
│   │   ├── cre-decision.js       #     Klasifikátor záměrů (2,900 ř.)
│   │   ├── handlers/             #     7 intent handlerů + lifecycle router
│   │   └── quality/              #     Quality Gate v2 (4 vrstvy)
│   ├── expertises/               #   15 expertýz, merge engine, ledger
│   ├── planner/                  #   Lifecycle engine (SPEC→BUILD→REVIEW)
│   ├── agents/                   #   Worker agenti, scheduler, conditions
│   ├── skills/                   #   Registry, resolver, runner, 8 step types
│   ├── memory/                   #   LTM, feedback, patterns, injection ranker
│   ├── executor/                 #   Tool executor, circuit breaker, sandbox
│   ├── llm/                      #   Ollama gateway, web search, auth
│   ├── notifications/            #   6 kanálů (email, TG, ntfy, webhook, ...)
│   ├── routes/                   #   REST API (14 route modulů)
│   ├── ws-bridge/                #   WebSocket bridge (IDE ↔ backend)
│   ├── db/                       #   SQLite schema, 28 migrací
│   ├── core/                     #   Logger, error handler, feature manager
│   ├── domains/                  #   Scaffoldy (React, Vue, FastAPI, Flutter, ...)
│   ├── specialists/              #   Specialist loader + plugin system
│   ├── licensing/                #   HW fingerprint, 3 licence tiery
│   ├── autonomy/                 #   Self-tuning (drift detection, thresholds)
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
├── tests/                        # Testovací sady (149 souborů)
│   ├── harness.js                #   Custom ESM test harness
│   ├── cre-*.test.js             #   CRE testy (401+)
│   ├── lifecycle-*.test.js       #   Lifecycle testy (103+)
│   ├── expertise-*.test.js       #   Expertise testy (40+)
│   └── ...                       #   Celkem 2,400+ testů
│
├── docs/                         # Dokumentace (10,000+ řádků)
│   ├── ARCHITECTURE.md           #   Kompletní architektura (781 ř.)
│   ├── CHANGELOG.md              #   Historie verzí (1,108 ř.)
│   ├── INSTALL.md                #   Instalační příručka
│   ├── ROADMAP.md                #   Roadmapa a stav fází
│   ├── EXPERTISES.md             #   Reference 15 expertýz
│   ├── SPECIALISTS.md            #   Specialist plugin system
│   ├── WORKERS.md                #   Autonomní agenti
│   ├── skills-v1.md              #   Skills specifikace
│   └── ...                       #   20+ dalších dokumentů
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

Kompletní reference: [.env.example](.env.example) (113 proměnných)

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
| `/api/system` | System | Health, storage, GPU, backup |
| `/api/security` | Security | Audit, tokeny, sessions |
| `/api/settings` | Settings | Uživatelská nastavení |

WebSocket na stejném portu — IDE ↔ backend real-time komunikace (chat, agent log, terminál, file watch).

---

## Testy

```bash
# Deterministické unit testy (~2,400+)
npm test

# Kompletní sada včetně specialistů
npm run test:all

# Konkrétní test soubor
node tests/cre-comprehensive.test.js

# E2E testy (vyžadují běžící Ollama)
node tests/lifecycle-klicenka-e2e.test.js
```

Testy používají custom ESM harness (`tests/harness.js`): `suite()`, `test()`, `testAsync()`, `assert()`, `assertEqual()`.

---

## Dokumentace

### Hlavní dokumenty

| Dokument | Obsah | Řádků |
|----------|-------|-------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kompletní architektura systému, diagramy, design decisions | 781 |
| [CHANGELOG.md](docs/CHANGELOG.md) | Historie všech verzí (v56–v93) | 1,108 |
| [ROADMAP.md](docs/ROADMAP.md) | Stav fází, plánované features | 800 |
| [INSTALL.md](docs/INSTALL.md) | Instalace (Ubuntu, Fedora, Docker) | 350 |
| [OPERABILITY.md](docs/OPERABILITY.md) | Deployment, monitoring, disaster recovery | 280 |

### Moduly a systémy

| Dokument | Obsah | Řádků |
|----------|-------|-------|
| [EXPERTISES.md](docs/EXPERTISES.md) | 15 doménových expertýz, 5D vektory, merge engine | 880 |
| [SPECIALISTS.md](docs/SPECIALISTS.md) | Specialist plugin architektura, runtime, KB, scénáře | 590 |
| [WORKERS.md](docs/WORKERS.md) | Autonomní agenti, scheduler, triggers, notifikace | 370 |
| [skills-v1.md](docs/skills-v1.md) | Skills systém, 8 step types, state machine, bezpečnost | 468 |
| [TELEMETRY.md](docs/TELEMETRY.md) | Turn telemetrie, specialist telemetrie, retention | 260 |
| [STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) | SQLite schema, drain, backup, retention | 800 |
| [tools/REGISTRY.md](docs/tools/REGISTRY.md) | 153 nástrojů, kategorie, risk assessment | 800 |

### Design dokumenty

| Dokument | Obsah | Řádků |
|----------|-------|-------|
| [AUTHORITY.md](docs/AUTHORITY.md) | CRE Gatekeeper, single authority pattern | 220 |
| [autonomy-v1.md](docs/autonomy-v1.md) | Self-tuning, drift detection, trust gates | 350 |
| [C3-Merge-Engine-v2-FINAL.md](docs/C3-Merge-Engine-v2-FINAL.md) | Merge algoritmus (15.5 kroků), token budgeting | 800 |
| [followup-contract-v2.md](docs/followup-contract-v2.md) | Follow-up klasifikace, R1-R4 pravidla | 180 |
| [C3-Phase-C-Lifecycle-Plan.md](docs/C3-Phase-C-Lifecycle-Plan.md) | Lifecycle design, fáze, recovery | 400 |
| [tools/EXECUTOR_CONTRACT.md](docs/tools/EXECUTOR_CONTRACT.md) | Tool execution contract, retry policy | 250 |

### Plánované

| Dokument | Obsah |
|----------|-------|
| [OAUTH-DEVICE-PLAN.md](docs/OAUTH-DEVICE-PLAN.md) | OAuth (Google/GitHub) + mobilní device pairing (v94) |
| [SPECIALIST-LIFECYCLE.md](docs/SPECIALIST-LIFECYCLE.md) | Specialist lifecycle integrace (v95+) |

Celkem **20+ dokumentů**, **10,000+ řádků** dokumentace.

---

## Licence

Systém licencí vázaný na hardware fingerprint (3 tiery: FREE / PRO / ENTERPRISE). Offline validace — žádný license server.

| Tier | Projekty | Agenti | Specialisté | Export |
|------|----------|--------|-------------|--------|
| FREE | 1 | - | - | md, txt |
| PRO | neomezeně | ano | ano | md, txt, html, pdf, docx |
| ENTERPRISE | neomezeně | ano | ano | vše + multi-user |
