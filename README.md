# IntentSmith

Local-first AI pracovní prostředí pro technického power usera: konverzace,
porozumění projektům a řízené provádění práce na vlastním hardwaru. Cílem je
žádný tichý outbound; operátorsky ponechané default-on model discovery prochází
přesný origin/scope gate a append-only audit, zatímco všechny ostatní externí
fetch cesty bez deklarované autority selžou před spojením. Současný
autoritativní C3 Studio runtime už neobsahuje implicitní Google Fonts egress.
Spouštěné Studio UI je stále přechodný runtime, nikoli finální vzhled IntentSmithu.

**Verze:** 136.1.0, vývojový kandidát 1.0. Aktuální počty testovacích programů
jsou v [generovaném registru](docs/convergence/TEST-REGISTRY.md):
**515 registrovaných testovacích programů**
(`421 ACTIVE`, `79 BLOCKED`, `0 KNOWN_DEFECTIVE`, `15 HISTORICAL`).

Přijaté milníky M0–M4 nejsou přijetím celého releasu. M5 ještě vyžaduje
podepsané privacy podklady a správu operátorských klíčů; M6 úplný skutečný
uživatelský scénář a review důkazů. Nové opravy z auditu jsou samostatný
candidate a čekají na nezávislé review. Aktuální autorita:
[PRODUCT](PRODUCT.md), [ROADMAP](ROADMAP.md), [SYSTEM-MAP](SYSTEM-MAP.md).

[Kontrakty rozšíření po 1.0](docs/post-release/README.md) popisují skutečné
zlepšování modelu, porozumění rozsáhlému projektu, úplné agenty a odložené
notifikace, marketplace, média a aktualizace. Jsou návrhem k review.

---

## Co je IntentSmith

IntentSmith zachovává funkční backend a C3 Studio IDE z C3 a evolučně je
zpevňuje. Produktový kontrakt, cílový uživatel a hranice 1.0 jsou v
[PRODUCT.md](PRODUCT.md).

### Konverzace a rozhodování
- **CRE (Conversational Reasoning Engine)** — single-authority klasifikátor: každý vstup → 1 z 18 typů záměrů → specializovaný handler. 12 guard pravidel, auditní trail, Gatekeeper pattern.
- **18 expertíz v současném runtime** — 14 vestavěných plus expertizy přidané specialisty. 5D capability vektory (reasoning, kreativita, determinismus, risk, verbosity); merge engine kombinuje až 3 expertizy.
- **Quality Gate v2** — 4-vrstvý deterministický post-processing (structural → language → intent → content). Bez LLM.

### Projekty a build
- **Životní cyklus projektů** — SPEC → PLANNING → BUILD → REVIEW → CHANGE. Checkpointy (STRUCTURAL / FUNCTIONAL / SECURITY), automatický git commit, crash recovery.
- **Execution Engine** — iterativní fix cyklus: generuj → testuj → diagnostikuj → patchuj → testuj → konverguj. Patch engine s 3-tier anchoring, error normalizer (14 kódů, root cause analýza), fix strategy selection (DETERMINISTIC / HEURISTIC / LLM_FULL / SKIP).
- **Code Intelligence** — současný chat používá projektově omezený snapshot, manifest a lexikální výběr souborů s kontrolou revize. AST/index/graph moduly v repozitáři existují, ale úplné porozumění rozsáhlému projektu z nich nelze odvozovat; integraci a měření stanoví [nový kontrakt](docs/post-release/project-intelligence.md).

### Agenti a automatizace
- **Worker agenti** — existuje scheduler, podmínky a dílčí runtime. Úplný nativní cyklus zdroj → práce → výsledek → pause/resume/restart není přijatý. Externí RSS/HTTP/DB komunikaci neaktivuje samotné vytvoření agenta. Externí notifikace jsou v 1.0 `unsupported`; lokální desktop/in-app cesta zůstává.
- **Skills** — deterministické workflow (JSON): 8 vykonávaných typů kroků (`llm`, `template`, `write`, `shell`, `ask`, `review`, `validate`, `transform`) a samostatná substitution helper vrstva. 14 skills včetně meta-skills a governed M3 project-note workflow.
- **Specialisté** — rozšiřující balíčky s nástroji, expertízou, znalostní bází a scénáři. M3 candidate používá rozhodnutou strict-injection hranici, verzovaný manifest/context a rekurzivní fail-closed package scanner.

### Paměť a učení
- **Dlouhodobá paměť (LTM)** — confidence decay (poločas 69 dní), reinforcement, feedback detekce, cross-session pattern learning.
- **Task Memory** — persistentní cross-milestone učení: co fungovalo, co selhalo, architektonická rozhodnutí.
- **Cross-Project Learning** — modul pro podobnost a generalizaci existuje, ale produkční učící smyčka není prokázaná. Přechod mezi projekty musí být default off a pouze na explicitní opt-in.

### Infrastruktura
- **Modelová platforma** — factual discovery, versioned role-specific evaluace exact artefaktů, append-only run/decision historie a jediná ruční durable binding cesta.
- **Marketplace** — legacy implementace katalogu a instalace existuje; veřejný katalog a externí instalace nejsou podporovaným 1.0 journey. [Dokončení po releasu](docs/post-release/marketplace.md).
- **C3 Studio IDE** — Theia + Electron, 32 rozšíření, chat panel, agent log, settings (12 sekcí), specialist focus mode, multimedia view.
- **153 nástrojů** ve 35 kategoriích. Sandboxed execution, circuit breaker, risk assessment.

Modelová inference používá lokální ověřený provider a persistence SQLite. Web bez projektu nabízí jeden viditelný HTTPS GET s přesným souhlasem: `načti web https://example.com/`, potom zobrazený příkaz `schválit web web:<digest>`. Schválení se nepřenáší na další adresu ani autonomního agenta. [Rozsah a limity](docs/decisions/044-conversation-web-approval.md). [Samostatné bezpečnostní review čeká](docs/review/2026-09-11-CONVERSATION-WEB-REVIEW-PACKET.md).

---

## Architektura

Diagram ukazuje moduly repozitáře, včetně odložených oblastí. Podpora v 1.0
se řídí popisem výše a SYSTEM-MAP, nikoli přítomností boxu v diagramu.

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
│  │ Decision │  │(18 types) │  │ (Ollama, 7 rolí)     │ │
│  └──────────┘  └───────────┘  └──────────────────────┘ │
│                                                         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────────────┐ │
│  │Expertises│ │ Specialists│ │   Lifecycle Engine     │ │
│  │ (14 + N) │ │ (plugins)  │ │ (SPEC→BUILD→REVIEW)   │ │
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
ollama pull qwen3.5:27b          # D1 + CODE + CHAT
ollama pull qwen3.8:latest       # D2 + R1
ollama pull qwen3:14b            # R2
ollama pull llava-llama3:8b      # VISION

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
| bubblewrap | system package | Linux namespace/seccomp sandbox pro governed focused test |
| util-linux `prlimit` | system package | CPU, address-space, file-size, FD a core-dump limity procesu |
| GPU | 12+ GB VRAM | Doporučeno pro 32B modely (8B modely běží na 8 GB) |

Detailní pokyny: [docs/INSTALL.md](docs/INSTALL.md)

---

## Hlavní moduly

### CRE — Conversational Reasoning Engine
Centrální klasifikátor záměrů. Každý vstup projde přes `CRE.decide()`, který určí typ (CODE, SEARCH, CREATIVE, CONVERSATIONAL, PLAN, BUILD, FACTUAL, ...) a routuje na příslušný handler. Gatekeeper pattern — žádný kód nemůže CRE obejít.

- 12 guard pravidel (follow-up, attachment, creative override, skill detection, build deferral, ...)
- Auditní trail každého rozhodnutí v DB
- [docs/AUTHORITY.md](docs/AUTHORITY.md) — Gatekeeper architektura

### Expertýzy
14 vestavěných doménových profilů; současný runtime registruje 18 po zapojení
specialistických expertíz. Každá expertíza má 5D capability vektor ovlivňující
tón, hloubku a styl odpovědí. Merge engine umožňuje kombinovat více expertíz.

- [docs/EXPERTISES.md](docs/EXPERTISES.md) — legacy reference expertíz a merge engine; aktuální počty jsou výše

### Specialisté
Rozšiřující balíčky s nástroji, expertízou, znalostní bází a scénáři. Pět
současných balíčků: `accountant-cz`, `translator`, `code-reviewer`, `sazeni` a
`dummy-logger`. M3 candidate používá verzovaný `ExtensionManifest/Context`,
strict capability injection a rekurzivní fail-closed package boundary; přímé
importy do interního `src/**` už nejsou povolené. Nové specialisty lze vytvořit
přes `create-specialist` skill nebo IDE.

- [docs/SPECIALISTS.md](docs/SPECIALISTS.md) — architektura, API, průvodce vytvářením

### Životní cyklus projektů
Strukturovaný přístup k větším projektům. Fáze: specifikace → roadmapa → build (po milnících) → review → change management. Každý milník má checkpoint (STRUCTURAL / FUNCTIONAL / SECURITY), automatický git commit a tag.

- [docs/PROJECT-SYSTEM.md](docs/PROJECT-SYSTEM.md) — lifecycle, checkpointy, recovery
- [docs/STORAGE-ARCHITECTURE.md](docs/STORAGE-ARCHITECTURE.md) — persistence

### Code Intelligence
Produkční analýza používá verzovaný ProjectContext a lexikální výběr souborů. V `src/code-intel/` existují také search, symbol index, graph, AST a další analyzátory; jejich přítomnost není důkazem propojeného porozumění celému projektu. Rozsah integrace a kvalitativní oracle stanoví [Project Intelligence po 1.0](docs/post-release/project-intelligence.md).

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architektura, code-intel moduly

### Execution Engine
Iterativní fix cyklus pro milníky: generuj → testuj → diagnostikuj → patchuj → testuj → opakuj do konvergence (max 8 iterací). Patch engine s 3-tier anchor matching, error normalizer (14 error kódů, root cause analýza), fix strategy selection, self-critique (LLM + knowledge graph validace), task memory.

- `src/patch/` — parser, validator, applier, engine, scope limiter (1,505 řádků)
- `src/executor/execution-loop.js` — hlavní fix loop

### Skills
Deterministické workflow definované v JSON. 8 vykonávaných typů kroků: `llm`,
`template`, `write`, `shell`, `ask`, `review`, `validate`, `transform`; substitute
je sdílená helper vrstva. 14 skills včetně meta-skills. `create-skill` umožňuje
vytvářet nové skills konverzačně.

- [docs/skills-v1.md](docs/skills-v1.md) — kompletní specifikace

### Autonomní agenti
Native M3 runtime a scheduler pokrývají přijaté dílčí scénáře. Úplné RSS/HTTP/DB workflow, řízení po restartu a externí výstupní kanály zatím nejsou přijaté; jejich dokončení určuje [kontrakt agentů](docs/post-release/agents.md). Starší WORKERS dokument popisuje také legacy možnosti.

- [docs/WORKERS.md](docs/WORKERS.md) — architektura a konfigurace

### Paměťový systém
Tři vrstvy: LTM s confidence decay (λ=0.01, poločas 69 dní), task memory (cross-milestone, λ=0.005, poločas 139 dní), cross-project learning (stack similarity, pattern sharing) pouze s explicitním opt-in. Tyto paměťové mechanismy samy netrénují váhy modelu. Feedback detektor, injection ranker, pattern tracker.

- [docs/MEMORY.md](docs/MEMORY.md) — architektura paměťového systému

### Model Upgrade System
Factual discovery (local, catalog, hints, online), role-specific versioned evaluace s exact digestem a timestampem, fail-closed důkazní minima a samostatný manual binding. Discovery ani chatové „ano“ nejsou doporučení nebo aktivační autorita.

- `src/upgrade/` — 30 modulů, 17 209 řádků

### Quality Gate v2
4-vrstvý deterministický pipeline (structural → language → intent → content). Bez LLM — čistě pravidlová validace výstupů. SK→CZ transliterace (~160 pravidel), language drift detection.

### Notifikace
Pro 1.0 zůstává lokální in-app/desktop cesta. SMTP, Telegram, ntfy, webhook a další externí doručování jsou `unsupported`; existující moduly se zapojí až podle [kontraktu notifikací po releasu](docs/post-release/notifications.md).

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
| IDE | C3 Studio | Theia 1.74.1 + Electron 42.11.3, 32 vlastních rozšíření |
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
│   │   ├── handlers/             #     Intent handlery + lifecycle router
│   │   └── quality/              #     Quality Gate v2 (4 vrstvy)
│   ├── code-intel/               #   Code Intelligence (33 modulů, 11 634 ř.)
│   ├── planner/                  #   Lifecycle + sdílená governance (32 modulů, 14 382 ř.)
│   ├── patch/                    #   Patch Engine (5 modulů, 1,505 ř.)
│   ├── memory/                   #   LTM, task memory, cross-project (9 modulů)
│   ├── upgrade/                  #   Model platform (30 modulů, 17 209 ř.)
│   ├── expertises/               #   14 built-in expertíz, merge engine, ledger
│   ├── agents/                   #   Worker agenti, scheduler, conditions
│   ├── skills/                   #   Registry, resolver, runner, 8 step types + substitution helper
│   ├── executor/                 #   Execution loop, tool executor, circuit breaker, sandbox
│   ├── llm/                      #   Ollama gateway, web search, auth
│   ├── notifications/            #   lokální kanály; externí delivery conditional/unsupported
│   ├── routes/                   #   REST API (17 route modulů)
│   ├── ws-bridge/                #   WebSocket bridge (IDE ↔ backend)
│   ├── marketplace/              #   conditional modul, v M5 release unsupported/off
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
├── skills/                       # Skill definice (14 JSON souborů)
│   ├── create-skill.json         #   Meta-skill pro tvorbu nových skills
│   ├── create-expertise.json     #   Meta-skill pro tvorbu expertýz
│   ├── create-specialist.json    #   Meta-skill pro tvorbu specialistů
│   ├── brainstorm.json           #   Brainstorming workflow
│   ├── changelog-gen.json        #   Generování changelogu
│   ├── code-refactor.json        #   Refaktoring kódu
│   ├── email-composer.json       #   Psaní emailů
│   ├── interview-prep.json       #   Příprava na pohovor
│   ├── meeting-notes.json        #   Zápisy z meetingů
│   ├── m3-project-note.json      #   Governed M2-backed project note
│   ├── presentation.json         #   Tvorba prezentací
│   ├── project-bootstrap.json    #   Bootstrap nového projektu
│   ├── report-gen.json           #   Generování reportů
│   └── summarizer.json           #   Sumarizace textu
│
├── tests/                        # Testy a kanonický registr 511 programů
│   ├── harness.js                #   Custom ESM test harness
│   ├── cre-*.test.js             #   CRE testy (401+)
│   ├── lifecycle-*.test.js       #   Lifecycle testy (103+)
│   ├── code-intel-*.test.js      #   Code Intelligence testy (339+)
│   ├── execution-loop.test.js    #   Execution Engine testy (597+)
│   ├── upgrade-*.test.js         #   Model Upgrade testy
│   └── registry.json             #   Kanonický registr 515 programů
│
├── docs/                         # Aktivní dokumentace + archiv
│   ├── ARCHITECTURE.md           #   Kompletní architektura
│   ├── CHANGELOG.md              #   Historie verzí (v56–v136)
│   ├── ROADMAP.md                #   Legacy roadmapa; aktuální je v kořeni
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
| Modely | `C3_MODEL_CHAT`, `C3_MODEL_CODE`, `C3_MODEL_D1` | qwen3.5:27b pro všechny tři role |
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
| [CHANGELOG.md](docs/CHANGELOG.md) | Historie všech verzí (v56–v136) |
| [ROADMAP.md](ROADMAP.md) | Aktuální víceúrovňová roadmapa a dependency DAG |
| [INSTALL.md](docs/INSTALL.md) | Reprodukovatelná instalace a známé platformní hranice |

### Moduly a systémy

| Dokument | Obsah |
|----------|-------|
| [EXPERTISES.md](docs/EXPERTISES.md) | Legacy reference expertíz, 5D vektory a merge engine; aktuální počet je 14 built-in / 18 runtime |
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

Malou změnu jednoho souboru lze ve Studiu připravit příkazem
`/m2-draft src/app.js :: popis změny`. Vyžaduje připojený Git projekt s M2
governance policy a soubor `.js`, `.mjs` či `.cjs` do 1600 bajtů. Studio ukáže
celý původní i navržený obsah; `/m2-approve` schválí přesný plán, `/m2-cancel`
zruší návrh. Výchozí kontrola ověřuje syntaxi, nikoli funkční správnost.

Malou změnu více souborů lze zadat jako
`/m2-draft src/app.js, src/helper.js :: popis změny` (nejvýše tři JS soubory).
Model připraví každý soubor postupně, Studio ukáže celý návrh a `/m2-approve`
schválí jediný přesný plán. `/m2-cancel` funguje při přípravě i běžícím
provedení. Výchozí kontrola ověřuje syntaxi všech vybraných souborů; funkční
test lze explicitně dodat jako `draft.focusedTest` přes lifecycle API.
