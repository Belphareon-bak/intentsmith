# C3 Project System — Complete Documentation

> Kompletni dokumentace jak C3 pracuje s projekty: od otevření projektu přes analýzu kódu, routing zpráv, lifecycle engine až po známé limity.

**Verze:** v94 (2026-03-04)

---

## Obsah

1. [Jak se projekt aktivuje](#1-jak-se-projekt-aktivuje)
2. [Analýza existujícího projektu](#2-analýza-existujícího-projektu)
3. [Routing zpráv v PROJECT módu](#3-routing-zpráv-v-project-módu)
4. [Práce se soubory](#4-práce-se-soubory)
5. [Kontextový systém](#5-kontextový-systém)
6. [Lifecycle Engine (SPEC → BUILD → REVIEW)](#6-lifecycle-engine)
7. [Tool Executor a vyhledávání](#7-tool-executor-a-vyhledávání)
8. [Paměťový systém](#8-paměťový-systém)
9. [Co C3 umí — silné stránky](#9-co-c3-umí)
10. [Co C3 neumí — slabiny a limity](#10-co-c3-neumí)
11. [Srovnání s IDE AI asistenty](#11-srovnání-s-ide-ai-asistenty)
12. [Klíčové soubory](#12-klíčové-soubory)
13. [Databázové schéma](#13-databázové-schéma)

---

## 1. Jak se projekt aktivuje

### Entry Points

Projekt se aktivuje třemi způsoby:

| Způsob | Kde | Co se stane |
|--------|-----|-------------|
| **Nový projekt** | FE wizard → `POST /api/projects` | Vytvoří DB záznam, `analyzeExistingProject()` |
| **Otevření složky** | FE "Open Folder" → `POST /api/projects` + `lifecycle/bind` | Scan adresáře, git analýza, DB záznam |
| **Sticky mode** | Automaticky | Předchozí session měl projekt → zůstane aktivní |

### Mode Detection (`controller.js:312-372`)

```
ModeDetector.detect(input, context):
  if context.hasActiveProject && projectContext.isActive() → PROJECT mode (+2 score)
  if input matches project patterns ("implementuj", "přidej funkci") → +1
  PROJECT mode aktivní POUZE pokud BOTH pattern AND context.hasActiveProject
```

### Sticky Mode (`controller.js:650-670`)

Když `context.hasActiveProject && context.project?.id` → PROJECT mode je **sticky**:
- Všechny následující zprávy jdou přes `projectHandler`
- Dokud uživatel explicitně nezavře projekt
- Podobné jako IDE — otevřeš projekt, zůstaneš v něm

### Session State (`controller.js:774+`)

```javascript
SessionState {
  #project: { id, name, path, scope }
  #projectWorkingMemory: { goal, activeFile, lastArtifactId, driftCount }
  // Persistuje přes turny v rámci session
}
```

---

## 2. Analýza existujícího projektu

### `analyzeExistingProject()` (`lifecycle-analyzer.js:190-340`)

**Voláno při:**
- Vytvoření nového projektu (`routes/projects.js:188`)
- Otevření existující složky (`routes/projects.js:546`)
- Zahájení lifecycle (`lifecycle-router.js:266`)

**Co čte (vše deterministické, žádný LLM):**

| Zdroj | Co extrahuje | Limit |
|-------|-------------|-------|
| `README.md` | Účel projektu, popis | 3000 znaků |
| `ROADMAP.md` | Fáze, milníky, status | 500 znaků |
| `.c3/project.json` | C3 metadata (typ, popis, fáze) | celé |
| `package.json` | name, version, deps, scripts | celé |
| Git | commity (20), tagy (10), branches, uncommitted | execSync |
| Adresářová struktura | soubory, adresáře, code files count | depth 2 |
| DB: conversations | 5 posledních konverzací o projektu | |
| DB: project_memory | key-value fakta z předchozí práce | |

**Ignorované adresáře:** `node_modules`, `.git`, `.c3`, `dist`, `build`, `__pycache__`, `venv`

### Tech Stack Detection (`readme-generator.js`)

Detekuje technologie podle marker souborů:

| Kategorie | Detekované |
|-----------|-----------|
| Frontend | React, Vue, Svelte, Angular, Next.js, Nuxt, Vite, Webpack |
| Backend | Node.js, Express, Django, Flask, FastAPI, Go, Rust, Spring |
| DB | PostgreSQL, MySQL, SQLite, MongoDB |
| Runtime | Python, Ruby, PHP, Java, Go, Rust, .NET |
| Build | Webpack, Vite, Rollup, TypeScript, Make |
| Testing | Jest, Pytest, Mocha, RSpec, JUnit |
| DevOps | Docker, GitHub Actions, GitLab CI, Terraform |
| ORM | SQLAlchemy, Sequelize, TypeORM, Prisma |

**Metoda:** Hledá `package.json`, `Cargo.toml`, `requirements.txt`, `pom.xml`, `Dockerfile` atd.

### Výstup analýzy

Plain text (max ~4000 znaků), uložený v DB (`projectMemory.set(projectId, 'last_analysis', ...)`).

**Příklad:**
```
### README.md
Flask microservice for user authentication...

### package.json
Name: backend-api, Version: 1.2.0
Dependencies: flask, sqlalchemy

### Git
Commits: 42, Tags: v1.0.0, v1.1.0, Branches: main, develop

### Source Structure
Dirs: src/, tests/, config/
Code Files: 15, Total Files: 23
```

---

## 3. Routing zpráv v PROJECT módu

### Hlavní handler: `projectHandler()` (`project.js:277-482`)

Zprávy prochází tímto pipeline:

```
Zpráva uživatele
  ↓
1. Pre-Handler (11 intercepts — všechny módy)
  ↓
2. Project-Self Query Check (deterministický)
  ↓
3. File Intent Heuristic (pre-CRE, deterministický)
  ↓
4. CRE Classification (LLM)
  ↓
5. Decision Type Routing
```

### 3.1 Pre-Handler (`pre-handler.js:142-410`)

11 interceptů v pořadí:
1. **Feedback Detection (M3)** — Detekuje zpětnou vazbu, ukládá do LTM
2. **Session Resume** — jen CONVERSATION
3. **TODO Workflow** — `/todo`, `/done`
4. **Build Handoff** — aktivní build pipeline
5. **C4 Lifecycle Auto-Detect** — migruje lifecycle z jiné session
6. **Post-Lifecycle Context** — dokončený lifecycle summary
7. **Lifecycle Handoff** — aktivní lifecycle fáze → router
8. **Skill Confirmation** — čekající skill potvrzení
9. **Agent Wizard** — aktivní wizard
10. **Reformulation** — "zkus to česky" pattern
11. **Attachment Guard** — pre-CRE deterministic FILE_EXPLAIN override

### 3.2 Project-Self Query (`project.js:58-97`)

Deterministický pattern match — **bez LLM:**
```
"Jaký je stav projektu?" → buildProjectStatusResponse()
"Co je cíl tohoto projektu?" → buildProjectStatusResponse()
"Na čem pracujeme?" → buildProjectStatusResponse()
```

Odpovídá z: metadata + working memory + cached analysis + conversation history.

### 3.3 File Intent Heuristic (`project.js:233-275`)

**Pre-CRE detekce** — porovnává tokeny ze vstupu proti REÁLNÝM souborům projektu:
```
"co je v readme?" → match "readme" → FILE_READ pro README.md
"ukaž mi server.js" → match "server.js" → FILE_READ
```
- 10s cache adresářového listingu
- Dynamické — funguje s jakoukoliv strukturou projektu

### 3.4 CRE Classification

CRE dostane obohacený vstup:
```
"implementuj login\n[[PROJECT_CONTEXT:MyApp]]"
```
`buildProjectHint()` (`project-context-prompt.js:67-70`) přidá název projektu.

### 3.5 Decision Type Routing

| Decision | Intent | Handler | Chování |
|----------|--------|---------|---------|
| LOCAL | FILE_READ, FILE_EXPLAIN | `handleFileDecision` | Čtení souboru, bez webu |
| LOCAL | FILE_WRITE | `handleFileWriteDecision` | Zápis do souboru |
| LOCAL | SHELL | `handleShellDecision` | Spuštění příkazu |
| PLAN | BUILD | `handleBuildDetected` | Lifecycle/Planner handoff |
| TOOL_CALL | CODE (bez filePath) | `handleAnswerDecision` | Inline code syntéza |
| TOOL_CALL | CODE (s filePath) | `handleToolCallDecision` | Zápis kódu do souboru |
| ANSWER | CONVERSATIONAL, CREATIVE | `handleAnswerDecision` | LLM syntéza s kontextem |
| REFUSE | — | `handleRefuseDecision` | Odmítnutí |

---

## 4. Práce se soubory

### File Handler (`file.js`, 600+ řádků)

**Security Guards:**
```
Zakázané cesty: /etc, /proc, /sys, /dev, /root, /boot, /var/log
Zakázané adresáře: .ssh, .gnupg (kdekoli v cestě)
Zakázané soubory: .env*, credentials.*, *.pem, *.key, id_rsa*, shadow, passwd
Sandbox: soubory musí být v rámci project path nebo /tmp
```

**Limity:**
- Max velikost souboru: 512 KB
- Max zobrazených řádků: 5000
- Pokud cesta je adresář → directory listing

**Syntax highlighting:** 40+ jazyků (JS, TS, Python, Go, Rust, Java, C/C++, Ruby, PHP, Shell, YAML, JSON, HTML, CSS, SQL, ...)

### Attachment Pipeline

```
FE: file.path (Electron File API) → POST /api/chat
BE: fs.readFileSync(attachment.path) → context.attachments[]
Pre-CRE guard: attachment + file-ref pattern → FILE_EXPLAIN override
```

---

## 5. Kontextový systém

### First-Turn Context Init (`context-init.js`)

Spustí se **jednou za konverzaci** (tracked in-memory):
1. Zajistí existenci README.md
2. Čte README.md (3000 znaků)
3. Čte `.c3/project.json`
4. Skenuje config soubory (`package.json`, `tsconfig.json`, `.env.example`) — 50 řádků
5. Memory Bank context
6. Cached analýza z DB (1500 znaků)
7. **Celkový limit: 4000 znaků (~1000 tokenů)**

### Context Budget (`context-budget.js`)

Token alokace podle intentu:

| Intent | History | Search | LTM |
|--------|---------|--------|-----|
| CONVERSATIONAL | 2000 | 0 | 500 |
| CREATIVE | 3000 | 0 | 300 |
| SEARCH | 500 | 3000 | 200 |
| CODE | 1500 | 0 | 500 |
| BUILD | 1000 | 0 | 500 |
| REPORT | 300 | 5000 | 200 |

### Project Context Injection (`project-context-prompt.js:34-59`)

Do systémového promptu pro LLM syntézu:
```
AKTIVNÍ PROJEKT:
- Název: MyApp
- Popis: E-commerce platform
- Cíl: MVP do konce měsíce
[Memory Bank context]
[First-turn scan context]
```

---

## 6. Lifecycle Engine

### Fáze a přechody

```
SPEC → SPEC_REVIEW → PLANNING → PLAN_REVIEW → BUILD → PROJECT_REVIEW → COMPLETED
  ↕         ↕           ↕           ↕         ↕  ↕
FAILED   (revize)    FAILED     (revize)   PAUSED CHANGE_MANAGEMENT
```

### 6.1 SPEC — Specifikace

**Flow:** Uživatel popíše projekt → D1 generuje otázky → uživatel odpoví → D1 generuje spec → validace → review

**Spec validace (deterministická):**
- 3+ cílů se `success_criteria`
- 5+ funkčních požadavků s `acceptance_test`
- 3+ nefunkčních požadavků s měřitelnými metrikami
- `tech_stack` s verzemi (ne generické)
- 1+ `design_decisions` s `rationale` + 2+ `alternatives_considered`
- 3+ rizik s `mitigation`

**Spec struktura:** goals[], requirements (functional + non_functional), tech_stack, architecture, design_decisions[], security_model, risks[], constraints[], out_of_scope[], acceptance_criteria[]

### 6.2 PLANNING — Roadmapa

**Flow:** D1 generuje milníky z spec → validace (velikost, závislosti) → verzování → review

**Milestone validace:**
- Min 3 milníky (4+ pokud ≥5 spec requirements)
- Poslední milestone = Integration/Testing/Docs
- Každý milestone: max 2000 LOC, max 10 souborů
- Všechny funkční požadavky pokryty
- Žádné cirkulární závislosti

**Verzování:** Každá revize = nový verze v `roadmap_versions`. Dokončené milníky se nikdy nemění.

**ID scoping:** `ms-1` (D1 generuje) → `ms-1@msh2` (DB, scoped). Prevence kolizí mezi lifecycle.

### 6.3 BUILD — Milestone Execution

```
startNextMilestone()
  ↓ D1 → local_plan (min 3 kroky, scope_files)
approveMilestonePlan()
  ↓
executeMilestone() → WorkflowOrchestrator (D1→CODE→R2→D2/R1)
  ↓
postExecution():
  1. runTests() — shell příkazy z test_strategy
  2. runQualityGate() — compile/syntax check (v94)
     - Python: python3 -m py_compile
     - JavaScript: node --check
     - Go: go build ./...
     - 2-pass: changedFiles → (fail?) → full project scan
     - FAIL → short-circuit (skip R1 checkpoint, save 60+s)
  3. milestoneCheckpoint() — R1 review
     - CheckpointMode: STRUCTURAL | FUNCTIONAL | SECURITY
     - Adaptive retry: _lastCheckpointFindings → next attempt
  4. enforceMilestoneScope() — git diff vs scope_files
  5. computeHealthScore() — scope_adherence, test_coverage, complexity, tech_debt
  ↓
PASSED → autoCommit + git tag
FAILED → retry (max 3) → BLOCKED → user decides (retry/skip/modify)
```

### 6.4 PROJECT_REVIEW — Drift Detection

**Trigger:** každých N dokončených milníků (`reviewFrequency = 3`)

**4 typy driftu:**
- SPEC_ALIGNMENT — pokrytí cílů z spec
- SCOPE_CREEP — práce mimo scope
- ARCHITECTURE_CONSISTENCY — odchylky od arch. patternu
- TECH_DEBT — trend technického dluhu

**Výstup:** ADVISORY (neblokující doporučení)

### 6.5 CHANGE_MANAGEMENT

Uživatel navrhne změnu → D1 impact analysis → approve/reject/split

### User Interaction — Approval Regex

```
Schválení: ^(ano|jo|ok|yes|schvaluji?|approve|pokračovat)\s*[!.]?$
Revize: cokoliv jiného = feedback pro revizi
```

**Strict by design:** "schvaluji s poznámkou" = revize, NE approval.

---

## 7. Tool Executor a vyhledávání

### Tool Executor (`tool-executor.js`, 1500+ řádků)

- Per-session circuit breaker (5 failures / 30s reset)
- Auto-retry jen na transient failures (ECONNRESET, ETIMEDOUT, ECONNREFUSED)
- Query sanitizace: strip instrukce (CZ/SK/EN), deduplicate, truncate 200 znaků

### Web Search (`web-search.js`, 900+ řádků)

Multi-provider fallback:
1. **DuckDuckGo** (primární)
2. **SearX** (5 instancí, parallel fetch)
3. **Brave Search** (pokud API klíč)

### C3 Tool Executor (`c3-tool-executor.js`, 699 řádků)

Shell/file operace v sandboxu:
- Parsování shell příkazů + security validace
- Blokované env proměnné: LD_PRELOAD, NODE_OPTIONS, BASH_ENV

### Script Discovery (`script-discovery.js`)

Čte `package.json` scripts, `Makefile` targets, `scripts/README.md` → navrhne relevantní příkazy.

---

## 8. Paměťový systém

### Long-Term Memory (`src/memory/long-term.js`)

- Confidence decay: `effective = base * e^(-0.01 * ageDays)`, half-life ~69 dní
- Reinforcement: +0.05 na reuse (cap 0.95)
- SQLite persistence (`memory` table)

### Injection Ranker (`src/memory/injection-ranker.js`)

Score = effectiveConfidence × relevance
- Relevance = 0.4×keyword + 0.45×intentAffinity + 0.15×recency

### Pattern Tracker (`src/memory/pattern-tracker.js`)

Cross-conversation learning:
- Intent sekvence (SEARCH→CODE)
- Tool success tracking
- Topic affinity

### Feedback Detector (`src/memory/feedback-detector.js`)

6 signálů: POSITIVE_EXPLICIT/IMPLICIT, NEGATIVE_EXPLICIT/IMPLICIT, CORRECTION, NEUTRAL

### Project Memory (`src/planner/project-context.js`)

Per-project key-value fakta:
- Decisions, preferences, blockers, timeline events
- Max 5 decisions + 5 timeline events v kontextu

---

## 9. Co C3 umí

| Schopnost | Popis | Soubor |
|-----------|-------|--------|
| Analýza projektu | README, git, struktura, tech stack | `lifecycle-analyzer.js` |
| Čtení souborů | Sandbox, syntax highlight, 40+ jazyků | `file.js` |
| Lifecycle engine | SPEC→BUILD→REVIEW, 9 milestone stavů | `src/planner/` |
| Quality Gate | Compile check (Python, JS, Go) | `quality-gate.js` |
| Checkpoint | Mode-aware review (STRUCTURAL/FUNCTIONAL/SECURITY) | `lifecycle-build.js` |
| Adaptive retry | Předchozí findings → next attempt | `lifecycle-build.js` |
| Roadmap verzování | Immutable verze, completed milestones preserved | `lifecycle-planning.js` |
| Drift detection | 4 typy, trendy, zdraví | `lifecycle-review.js` |
| Script discovery | package.json, Makefile | `script-discovery.js` |
| Web search | Multi-provider, circuit breaker | `web-search.js` |
| LTM | Confidence decay, reinforcement, patterns | `src/memory/` |
| Feedback detection | Automatická detekce zpětné vazby | `feedback-detector.js` |
| Auto-commit | Git commit + tag na PASS | `lifecycle-build.js` |
| Context budget | Intent-based token allocation | `context-budget.js` |
| Security sandbox | Path validation, forbidden files | `file.js`, `c3-tool-executor.js` |

---

## 10. Co C3 neumí

### 10.1 Žádná analýza kódu

**Problem:** Uživatel otevře projekt a řekne "najdi bug v tomto kódu". C3 nemá žádný nástroj na:

| Chybějící schopnost | Popis | Co by bylo potřeba |
|---------------------|-------|-------------------|
| **Code search** | Grep/regex přes celý projekt | `grep -r`, ripgrep integrace |
| **AST analýza** | Parsování do stromu, dependency graph | tree-sitter, babel parser |
| **Symbol table** | Go-to-definition, find usages | LSP integrace |
| **Cross-file tracking** | Import/export mapy, dependency chain | Vlastní analyzer |
| **Type inference** | TypeScript types, JSDoc, Python hints | TS compiler API |

**Důsledek:** Když uživatel pošle Java kód s bugem (viz Domino connector screenshot), C3 ho vůbec nečte. Místo toho jde do PROJECT módu a ukáže metadata.

### 10.2 Lifecycle-only projekty

C3 umí výborně **nový projekt od nuly** (lifecycle SPEC→BUILD→REVIEW). Ale pro **existující kódovou bázi** nemá:

| Scénář | Co C3 dělá | Co by měl dělat |
|--------|-----------|----------------|
| "Najdi bug v kódu" | PROJECT metadata | Přečíst relevantní soubory, analyzovat |
| "Vysvětli tento modul" | Nic / generic odpověď | Přečíst modul, pochopit závislosti |
| "Refaktoruj tuto třídu" | CODE bez kontextu | Přečíst třídu + related files |
| "Proč to padá?" | SEARCH (webové) | Čtení stack trace + zdrojového kódu |

### 10.3 Nedostatky v code analysis pipeline

```
EXISTUJÍCÍ STAV:
  Uživatel: "Analyzuj kód a navrhni řešení"
  ↓
  CRE: PROJECT mode
  ↓
  projectHandler: buildProjectStatusResponse() — metadata only
  ↓
  Výsledek: "Projekt má 9 souborů, 6 commitů..." (NEUŽITEČNÉ)

POŽADOVANÝ STAV:
  Uživatel: "Analyzuj kód a navrhni řešení"
  ↓
  CRE: CODE_ANALYSIS intent
  ↓
  codeAnalyzer:
    1. Identifikuj relevantní soubory (heuristic + user hints)
    2. Přečti je (fs.readFileSync)
    3. Pošli obsah LLM s instrukcí k analýze
    4. Vrať strukturovanou odpověď s návrhem opravy
  ↓
  Výsledek: "V DominoAccountAttribute.java je NOT_RETURNED_BY_DEFAULT flag..."
```

### 10.4 Missing Tools — Porovnání

| Funkce | IntelliJ AI | Cursor | C3 |
|--------|-------------|--------|-----|
| Čtení souboru | AST + full context | Full file + imports | Jen FILE_READ (manuální) |
| Code search | Symbol index | Codebase search | Nic |
| Dependency graph | LSP integrace | Semantic index | Nic |
| Bug analysis | Read code → analyze | Read code → analyze | Nečte kód |
| Refactoring | AST-aware | Multi-file edit | Nic |
| Multi-file context | Celý workspace | Až 100 souborů | 4000 znaků limit |

### 10.5 Specifické chybějící scénáře

1. **"Code files: 0"** — tech detection nezná všechny jazyky správně (Java? Kotlin?)
2. **Žádný multi-file context** — nemůže vidět jak soubory spolu souvisí
3. **Žádný diff analysis** — čte git commit list, ne actual diffs
4. **Žádná performance analýza** — nedetekuje O(n²), memory leaks
5. **Žádný test runner** — mimo lifecycle nemá test execution

---

## 11. Srovnání s IDE AI asistenty

### Scénář: "Tento konektor má bug s forwardingAddress atributem"

**IntelliJ AI Chat:**
1. Přečetl `DominoAccountAttribute.java` (sám ji našel)
2. Identifikoval `NOT_RETURNED_BY_DEFAULT` flag
3. Pochopil interakci s `ALLOW_PARTIAL_RESULTS=true`
4. Navrhl 2 řešení s kódem
5. Strukturovaná odpověď: Analysis → Root Cause → Solutions

**C3:**
1. Skočil do PROJECT módu
2. Ukázal metadata: "9 files, 0 code files, 6 commits"
3. Žádný kód nepřečetl
4. Žádná analýza, žádný návrh

### Proč ten rozdíl?

| Aspekt | IDE AI | C3 |
|--------|--------|-----|
| **Přístup ke kódu** | LSP/index — celý workspace | Jen explicitní FILE_READ |
| **Routing** | Vždy čte relevantní kód | CRE → PROJECT metadata |
| **Context window** | 100+ souborů simultánně | 4000 znaků total |
| **Code understanding** | AST, types, imports | Plain text |
| **Search** | Symbol search, regex | Žádný |

### Co je potřeba

Pro dosažení parity s IDE AI asistenty C3 potřebuje:

1. **Deep Code Reader** — automatické čtení relevantních souborů na základě uživatelského dotazu
2. **Code Search Tool** — grep/ripgrep integrace pro hledání v kódu
3. **Multi-File Context** — schopnost načíst a poslat LLM obsah 5-20 souborů najednou
4. **CODE_ANALYSIS intent** — nový CRE intent pro ad-hoc analýzu kódu (ne lifecycle, ne PROJECT metadata)
5. **Smart File Discovery** — z dotazu "forwardingAddress bug" → najdi soubory obsahující "forwardingAddress"

---

## 12. Klíčové soubory

### Project Entry & Routing
| Soubor | Účel |
|--------|------|
| `src/chat/controller.js` | Mode detection, sticky mode, SessionState |
| `src/chat/handlers/project.js` | Hlavní project handler (decision routing) |
| `src/chat/handlers/pre-handler.js` | 11 interceptů (build/lifecycle/skill handoff) |
| `src/chat/cre-decision.js` | CRE classification engine |
| `src/chat/handlers/utils/project-context-prompt.js` | buildProjectHint, buildProjectContext |

### Project Analysis
| Soubor | Účel |
|--------|------|
| `src/planner/lifecycle-analyzer.js` | analyzeExistingProject() |
| `src/chat/handlers/utils/readme-generator.js` | Tech stack detection |
| `src/chat/handlers/utils/project-state-reader.js` | README/ROADMAP parsing |
| `src/chat/handlers/utils/script-discovery.js` | Script discovery |
| `src/chat/context-init.js` | First-turn context scan |

### File Handling
| Soubor | Účel |
|--------|------|
| `src/chat/handlers/file.js` | FILE_READ/FILE_EXPLAIN handler |
| `src/executor/c3-tool-executor.js` | Shell/file sandbox |

### Lifecycle Engine
| Soubor | Účel |
|--------|------|
| `src/planner/lifecycle.js` | ProjectLifecycle class, phases, state machine |
| `src/planner/lifecycle-spec.js` | SPEC phase (questions, spec, validation) |
| `src/planner/lifecycle-planning.js` | Roadmap generation, versioning |
| `src/planner/lifecycle-build.js` | BUILD phase (milestones, checkpoint, health) |
| `src/planner/lifecycle-review.js` | PROJECT_REVIEW (drift checks) |
| `src/planner/lifecycle-prompts.js` | LLM prompt templates |
| `src/planner/quality-gate.js` | Compile/syntax check (v94) |
| `src/chat/handlers/lifecycle-router.js` | Lifecycle message routing |
| `src/chat/handlers/lifecycle-state.js` | Session ↔ lifecycle binding |

### Memory & Context
| Soubor | Účel |
|--------|------|
| `src/memory/long-term.js` | LTM (confidence decay, reinforcement) |
| `src/memory/injection-ranker.js` | LTM → context ranking |
| `src/memory/pattern-tracker.js` | Cross-conversation patterns |
| `src/memory/feedback-detector.js` | Semantic feedback detection |
| `src/planner/project-context.js` | Per-project facts/decisions |
| `src/chat/context-budget.js` | Token allocation by intent |

### Tools & Search
| Soubor | Účel |
|--------|------|
| `src/executor/tool-executor.js` | Tool dispatch, circuit breaker |
| `src/llm/web-search.js` | Multi-provider web search |
| `src/tools/registry.js` | Tool registry |

---

## 13. Databázové schéma

### Projekt & Lifecycle

```sql
projects (id, name, path, description, status, lifecycle_phase, ...)
project_lifecycles (id, project_id, phase, spec, config, active_session_id, ...)
roadmap_versions (lifecycle_id, version, roadmap, change_reason, diff_summary, ...)
milestones (id, lifecycle_id, sequence, title, status, dependencies, checkpoint_mode,
            local_plan, scope_files, commit_hash, git_tag, health_score, retry_count, ...)
change_requests (id, lifecycle_id, status, description, impact_analysis, ...)
drift_checks (lifecycle_id, milestone_id, check_type, result, details, ...)
lifecycle_handoff_state (session_id, phase, lifecycle_id, current_milestone_id, ...)
```

### Konverzace & Paměť

```sql
conversations (id, title, summary, project_id, ...)
messages (id, conversation_id, role, content, metadata, ...)
project_memory (project_id, category, key, value, ...)
memory (kind, key, value, base_confidence, access_count, last_accessed_at, ...)
execution_trace (correlationId, tool, args, result, latency, ...)
cre_override_log (decision_override, reason, prompt_hash, ...)
```

---

## Závěr

C3 je **silný v lifecycle-driven development** (SPEC→BUILD→REVIEW) a má robustní infrastrukturu (paměť, kontext, security). Největší slabina je **ad-hoc code analysis na existujícím projektu** — nemá nástroje pro čtení, hledání a pochopení kódu, které jsou standardem u IDE AI asistentů. Prioritou pro zlepšení je implementace code search + multi-file context + smart file discovery.
