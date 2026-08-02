# IntentSmith

Lokální AI platforma odvozená z C3 pro konverzační asistenci, správu
projektů a autonomní agenty. Offline-first architektura běží na vlastním
hardware. Volitelné síťové funkce (marketplace a model discovery) vyžadují
explicitní zapnutí.

**Verze:** 135.0.0 | **351 registrovaných testovacích programů**
(`257 ACTIVE`, `79 BLOCKED`, `0 KNOWN_DEFECTIVE`, `15 HISTORICAL`)

> **Stav: Gate 0 — kandidát důvěryhodné baseline.** Autoritativní verdikt je
> pouze v generovaném [docs/convergence/STATUS.md](docs/convergence/STATUS.md).
> Registrace ≠ ověření. Žádná z 30 schopností zatím nemá aktuální akceptační
> důkaz. Podrobnosti: [docs/ROADMAP.md](docs/ROADMAP.md),
> [docs/convergence/STATUS.md](docs/convergence/STATUS.md).

---

## Co je IntentSmith

IntentSmith zachovává funkční backend a C3 Studio IDE z C3 a postupně je
zpevňuje auditovatelnými instalačními, testovacími a bezpečnostními kontrakty.
Je určený vývojářům a knowledge workers, kteří chtějí lokální AI nástroj bez
povinné závislosti na cloudových službách.

### Konverzace a rozhodování
- **CRE (Conversational Reasoning Engine)** — single-authority klasifikátor: každý vstup → 1 z 19 typů záměrů → specializovaný handler. 10 guard pravidel, auditní trail, Gatekeeper pattern.
- **15 doménových expertýz** + custom specialist expertízy — 5D capability vektory (reasoning, kreativita, determinismus, risk, verbosity). Merge engine kombinuje až 3 expertýzy v jednom kontextu.
- **Quality Gate v2** — 4-vrstvý deterministický post-processing (structural → language → intent → content). Bez LLM.

### Projekty a build
- **Životní cyklus projektů** — SPEC → PLANNING → BUILD → REVIEW → CHANGE. Checkpointy (STRUCTURAL / FUNCTIONAL / SECURITY), automatický git commit, crash recovery.
- **Execution Engine** — iterativní fix cyklus: generuj → testuj → diagnostikuj → patchuj → testuj → konverguj. Patch engine s 3-tier anchoring, error normalizer (14 kódů, root cause analýza), fix strategy selection (DETERMINISTIC / HEURISTIC / LLM_FULL / SKIP).
- **Code Intelligence** — 33 modulů pro analýzu kódu: symbol index, knowledge graph (9 typů uzlů, 9 typů hran), AST analýza, architecture detection, drift detection, impact analysis, performance anti-pattern detection.

### Agenti a automatizace
- **Worker agenti** — RSS/HTTP/DB zdroje, deterministické podmínky, cron scheduling, 6 notifikačních kanálů.
- **Skills** — deterministické workflow (JSON): 9 typů kroků (llm, template, write, shell, ask, review, validate, substitute, transform). 13 skills včetně meta-skills pro auto-generaci expertíz a specialistů. `create-specialist` skill generuje kompletní pluginový balíček konverzačně.
- **Specialisté** — self-contained pluginové balíčky s nástroji, expertízou, znalostní bází a scénáři. `ctx.registries` API, manifest v2, capability routing. Auto-generace přes `create-specialist` skill.

### Paměť a učení
- **Dlouhodobá paměť (LTM)** — confidence decay (poločas 69 dní), reinforcement, feedback detekce, cross-session pattern learning.
- **Task Memory** — persistentní cross-milestone učení: co fungovalo, co selhalo, architektonická rozhodnutí.
- **Cross-Project Learning** — sdílení vzorců mezi projekty (stack similarity scoring, pattern generality).

### Infrastruktura
- **Model Upgrade System** — curated catalog (55 modelů), 16 modulů (~7,700 řádků), pairwise evaluation, empirical scoring (Phase 3), L4 online discovery, validation suites (5 sad), chat-based approval, streaming pull, rollback.
- **Marketplace** — remote package catalog pro skills, expertízy a specialisty. Transactional install/update/uninstall, dependency resolver, SHA-256 ověření, archive security.
- **C3 Studio IDE** — Theia + Electron, 32 rozšíření, chat panel, agent log, settings (12 sekcí), specialist focus mode, multimedia view.
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
│                 IntentSmith Backend                    │
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
│  ┌──────────┐ ┌────────────┐                           │
│  │Architect.│ │Marketplace │                           │
│  │Governance│ │(remote pkg)│                           │
│  └──────────┘ └────────────┘                           │
│                                                         │
│                SQLite (WAL, 80+ tabulek)                 │
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
# 1. Klonování
git clone --branch codex/intentsmith-1.0 --single-branch \
  https://github.com/Belphareon-bak/intentsmith.git
cd intentsmith

# 2. Kanonická instalace backendu i C3 Studio
./scripts/install.sh --minimal

# 3. Kanonické mapování portu a modelů
cp .env.example .env

# 4. Modely jsou externí artefakty; --minimal je nestahuje
ollama pull qwen3.5:27b          # hlavní chat + kód
ollama pull deepseek-r1:32b      # volitelná hluboká analýza + review

# 5. Start backendu a C3 Studio
./scripts/run.sh
```

`install.sh` provádí frozen instalace, hash-locked PDF runtime, Electron ABI
rebuild, Theia build a smoke test nativních artefaktů. Ruční `npm ci` nebo
`yarn build` je pouze dílčí vývojový krok. Tagy Ollama modelů jsou proměnlivé;
pro auditní běh vždy evidujte skutečný digest. Pro samostatný backend ve
vývojovém režimu použijte `npm run dev`.

---

## Prerekvizity

| Požadavek | Verze | Účel |
|-----------|-------|------|
| Node.js | 22.x | Backend runtime (ESM, `node:crypto`, `fetch()`) |
| npm | 10.9.4 | Frozen backend instalace z `package-lock.json` |
| Ollama | latest | Lokální LLM inference |
| CPython | 3.12 + `venv` | Hash-locked PDF runtime; také node-gyp |
| DejaVu fonts | `fonts-dejavu-core` | PDF export s českou/slovenskou diakritikou |
| build-essential | - | C++ kompilátor pro native moduly |
| Git | 2.x+ | Lifecycle (auto-commit, diff, tagging) |
| Yarn | 1.22.22 | Povinná frozen instalace C3 Studio |
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

- [docs/EXPERTISES.md](docs/EXPERTISES.md) — reference všech 15 expertýz, merge engine

### Specialisté
Self-contained pluginové balíčky s nástroji, expertízou, znalostní bází a scénáři. Každý specialista je izolovaný package v `specialists/` — žádné importy z core. 5 specialistů: `accountant-cz` (DPH, daně, pojistné), `translator` (překlad, detekce jazyka), `code-reviewer` (code review automatizace), `sazeni` (doménový specialista), `dummy-logger` (testovací utilita). Nové specialisty lze vytvořit konverzačně přes `create-specialist` skill nebo přes IDE wizard.

- [docs/SPECIALISTS.md](docs/SPECIALISTS.md) — architektura, API, průvodce vytvářením

### Životní cyklus projektů
Strukturovaný přístup k větším projektům. Fáze: specifikace → roadmapa → build (po milnících) → review → change management. Každý milník má checkpoint (STRUCTURAL / FUNCTIONAL / SECURITY), automatický git commit a tag.

- [docs/PROJECT-SYSTEM.md](docs/PROJECT-SYSTEM.md) — lifecycle, checkpointy, recovery
- [docs/STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) — persistence

### Code Intelligence
33 modulů v `src/code-intel/` (11,561 řádků). Multi-engine code search (ripgrep → grep → Node.js fallback), symbol index, knowledge graph (9 typů uzlů, 8 typů hran), AST analýza (JS, Python, Go, Java), architecture detection (18 frameworků), drift detection, dead code detection, performance anti-pattern detection, dependency management.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architektura, code-intel moduly

### Execution Engine
Iterativní fix cyklus pro milníky: generuj → testuj → diagnostikuj → patchuj → testuj → opakuj do konvergence (max 8 iterací). Patch engine s 3-tier anchor matching, error normalizer (14 error kódů, root cause analýza), fix strategy selection, self-critique (LLM + knowledge graph validace), task memory.

- `src/patch/` — parser, validator, applier, engine, scope limiter (1,505 řádků)
- `src/planner/execution-loop.js` — hlavní fix loop

### Skills
Deterministické workflow definované v JSON. 9 typů kroků: `llm`, `template`, `write`, `shell`, `ask`, `review`, `validate`, `substitute`, `transform`. 13 skills včetně meta-skills. `create-skill` umožňuje vytvářet nové skills konverzačně.

- [docs/skills-v1.md](docs/skills-v1.md) — kompletní specifikace

### Autonomní agenti
Worker agenti monitorující datové zdroje (RSS, HTTP, DB), vyhodnocující podmínky a spouštějící akce. Cron/interval scheduling, notifikace přes 6 kanálů.

- [docs/WORKERS.md](docs/WORKERS.md) — architektura a konfigurace

### Paměťový systém
Tři vrstvy: LTM s confidence decay (λ=0.01, poločas 69 dní), task memory (cross-milestone, λ=0.005, poločas 139 dní), cross-project learning (stack similarity, pattern sharing). Feedback detektor, injection ranker, pattern tracker.

- [docs/MEMORY.md](docs/MEMORY.md) — architektura paměťového systému

### Model Upgrade System
4-vrstvý discovery (local, catalog, hints, online), pairwise evaluation, empirical scoring z reálných metrik, validation suites (5 testovacích sad na model), chat-based approval (nikdy auto-upgrade), streaming pull, rollback.

- `src/upgrade/` — 16 modulů, ~7,682 řádků

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
| Databáze | SQLite | better-sqlite3, WAL mód, verzované migrace |
| LLM | Ollama | Lokální inference, 7 modelových rolí (D1, D2, CODE, R1, R2, CHAT, VISION) |
| IDE | C3 Studio | Theia 1.65.2 + Electron 37, 32 vlastních rozšíření |
| Frontend | React (lite) | Webpack bundle v chat-panel-module.js |
| AST | tree-sitter | JS, Python, Go, Java — symbol extraction, structural analysis |
| Závislosti | 13 produkčních | better-sqlite3, ws, dotenv, nodemailer, puppeteer, tree-sitter, chokidar, ... |

---

## Struktura projektu

```
intentsmith/
├── src/                          # Backend
│   ├── chat/                     #   CRE engine, handlery, quality pipeline
│   │   ├── cre-decision.js       #     Klasifikátor záměrů
│   │   ├── handlers/             #     19 intent handlerů + lifecycle router
│   │   └── quality/              #     Quality Gate v2 (4 vrstvy)
│   ├── code-intel/               #   Code Intelligence (33 modulů, 11,561 ř.)
│   ├── planner/                  #   Lifecycle + execution engine (34 modulů, 15,350 ř.)
│   ├── patch/                    #   Patch Engine (5 modulů, 1,505 ř.)
│   ├── memory/                   #   LTM, task memory, cross-project (9 modulů)
│   ├── upgrade/                  #   Model upgrade system (14 modulů, 6,450 ř.)
│   ├── expertises/               #   15 expertýz, merge engine, ledger
│   ├── agents/                   #   Worker agenti, scheduler, conditions
│   ├── skills/                   #   Registry, resolver, runner, 9 step types
│   ├── executor/                 #   Tool executor, circuit breaker, sandbox
│   ├── llm/                      #   Ollama gateway, web search, auth
│   ├── notifications/            #   6 kanálů (email, TG, ntfy, webhook, ...)
│   ├── routes/                   #   REST API (14 route modulů)
│   ├── ws-bridge/                #   WebSocket bridge (IDE ↔ backend)
│   ├── marketplace/              #   Remote package marketplace (2 moduly)
│   ├── db/                       #   SQLite schema a verzované migrace
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
│   ├── extensions/               #   32 vlastních rozšíření
│   │   └── c3-chat-panel/        #     Hlavní chat widget (4,000+ ř.)
│   └── applications/electron/    #   Electron wrapper + webpack
│
├── specialists/                  # Specialist balíčky (self-contained pluginy)
│   ├── accountant-cz/            #   České účetnictví (DPH, daně, pojistné)
│   ├── translator/               #   Překlad textů, detekce jazyka
│   ├── code-reviewer/            #   Code review automatizace
│   ├── sazeni/                   #   Doménový specialista
│   └── dummy-logger/             #   Testovací utilita
│
├── skills/                       # Skill definice (13 JSON souborů)
│   ├── create-skill.json         #   Meta-skill pro tvorbu nových skills
│   ├── create-expertise.json     #   Meta-skill pro tvorbu expertýz
│   ├── create-specialist.json    #   Meta-skill pro tvorbu specialistů
│   ├── brainstorm.json           #   Brainstorming workflow
│   ├── changelog-gen.json        #   Generování changelogu
│   ├── code-refactor.json        #   Refaktoring kódu
│   ├── email-composer.json       #   Psaní emailů
│   ├── interview-prep.json       #   Příprava na pohovor
│   ├── meeting-notes.json        #   Zápisy z meetingů
│   ├── presentation.json         #   Tvorba prezentací
│   ├── project-bootstrap.json    #   Bootstrap nového projektu
│   ├── report-gen.json           #   Generování reportů
│   └── summarizer.json           #   Sumarizace textu
│
├── tests/                        # Kanonický registr 263 testovacích programů
│   ├── harness.js                #   Custom ESM test harness
│   ├── cre-*.test.js             #   CRE testy (401+)
│   ├── lifecycle-*.test.js       #   Lifecycle testy (103+)
│   ├── code-intel-*.test.js      #   Code Intelligence testy (339+)
│   ├── execution-loop.test.js    #   Execution Engine testy (597+)
│   ├── upgrade-*.test.js         #   Model Upgrade testy
│   └── registry.json             #   Kanonický registr 263 programů
│
├── docs/                         # Aktivní dokumentace + archiv
│   ├── ARCHITECTURE.md           #   Kompletní architektura
│   ├── CHANGELOG.md              #   Historie verzí (v56–v135)
│   ├── ROADMAP.md                #   Roadmapa a stav fází
│   ├── INSTALL.md                #   Instalační příručka
│   ├── archive/                  #   Historické design dokumenty
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

Konfigurace používá environment proměnné. Quick Start kopíruje `.env.example`,
který nastaví dokumentované porty a skutečné Ollama tagy. Bez `.env` se použijí
vestavěné fallbacky z `src/config.js`.

| Sekce | Klíčové proměnné | Vestavěný fallback |
|-------|------------------|---------|
| Server | `C3_PORT`, `C3_HOST` | `0` (dynamický), `127.0.0.1` |
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
# Kanonický registry integrity check
npm run test:registry

# Povinné deterministické profily offline + database
npm test

# Kompatibilní historický agregátor; není release důkaz
npm run test:all

# Lokální real-model subset; celý model profil má další hard blockers
node scripts/nightly-audit.js \
  --suite=IS-T3-TESTS-LLM-INTEGRATION-TEST,IS-T3-TESTS-LLM-INTEGRATION-2-TEST,IS-T3-TESTS-EXPERTISE-AB-QUALITY-TEST \
  --allow-blocker=ollama,gpu
```

Kanonický seznam, profily, timeouty a prerequisites jsou v
[`docs/convergence/TEST-REGISTRY.md`](docs/convergence/TEST-REGISTRY.md).
Procesní návratový kód je součást testovacího kontraktu.

---

## Dokumentace

### Hlavní dokumenty

| Dokument | Obsah |
|----------|-------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Kompletní architektura systému, diagramy, design decisions |
| [CHANGELOG.md](docs/CHANGELOG.md) | Historie všech verzí (v56–v135) |
| [ROADMAP.md](docs/ROADMAP.md) | Stav fází, plánované features |
| [INSTALL.md](docs/INSTALL.md) | Reprodukovatelná instalace a známé platformní hranice |

### Moduly a systémy

| Dokument | Obsah |
|----------|-------|
| [EXPERTISES.md](docs/EXPERTISES.md) | 15 doménových expertýz, 5D vektory, merge engine |
| [SPECIALISTS.md](docs/SPECIALISTS.md) | Specialist plugin architektura, runtime, KB, scénáře |
| [WORKERS.md](docs/WORKERS.md) | Autonomní agenti, scheduler, triggers, notifikace |
| [skills-v1.md](docs/skills-v1.md) | Skills systém, 8 step types, state machine, bezpečnost |
| [MEMORY.md](docs/MEMORY.md) | 3-vrstvý paměťový systém (LTM, task memory, cross-project) |
| [marketplace.md](docs/marketplace.md) | Marketplace architektura, catalog, install pipeline, security |
| [followup-contract-v2.md](docs/followup-contract-v2.md) | Follow-up klasifikace, R1-R4 pravidla |
| [STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) | SQLite schema, drain, backup, retention |
| [tools/REGISTRY.md](docs/tools/REGISTRY.md) | 153 nástrojů, kategorie, risk assessment |
| [PROJECT-SYSTEM.md](docs/PROJECT-SYSTEM.md) | Project management systém |

### Kontrakty a protokoly

| Dokument | Obsah |
|----------|-------|
| [AUTHORITY.md](docs/AUTHORITY.md) | CRE Gatekeeper, single authority pattern |
| [WS-PROTOCOL.md](docs/WS-PROTOCOL.md) | WebSocket protokol |
| [OPERABILITY.md](docs/OPERABILITY.md) | Operační kontrakty (immutabilita, determinismus) |
| [tools/EXECUTOR_CONTRACT.md](docs/tools/EXECUTOR_CONTRACT.md) | Tool execution contract, retry policy |

Historické design dokumenty (implementované RFC) → `docs/archive/`

---

## Licence

Systém licencí vázaný na hardware fingerprint (3 tiery: FREE / PRO / ENTERPRISE). Offline validace — žádný license server.

| Tier | Projekty | Agenti | Specialisté | Export |
|------|----------|--------|-------------|--------|
| FREE | 1 | - | - | md, txt |
| PRO | neomezeně | ano | ano | md, txt, html, pdf, docx |
| ENTERPRISE | neomezeně | ano | ano | vše + multi-user |
