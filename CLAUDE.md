# CLAUDE.md - C.3 Agent Development Context

**Verze:** v124.0.0
**Datum:** 2026-03-12
**Projekt:** ~/Projects/c3-agent-wip

---

## Aktuální stav

C.3 Agent je plně funkční lokální AI platforma s:
- **CRE** (Conversational Reasoning Engine) — single-authority klasifikátor, 19 intent typů, 11 guard pravidel, Gatekeeper audit trail
- **Expertise System** (v63+) — 15 vestavěných expertýz, 5D capability profily, merge engine (max 3), auto-select (<1ms), enforcement pipeline
- **Specialist Platform** (v121+) — self-contained pluginové balíčky v `specialists/`. ctx.registries API (6 registrů), manifest v2, CapabilityRegistry (N:M), deterministic boot (Kahn's algo)
- **Quality Gate v2** — 4-vrstvý deterministický post-processing: structural fix, SK→CZ transliterátor (~160 regexů), LinkGuard, content enforcement
- **Agent Platform** — worker agenti se zdroji, podmínkami, triggery, notifikacemi. Cron/interval scheduling, 6 kanálů
- **Project Lifecycle** — SPEC → BUILD → REVIEW → CHANGE → COMPLETED. Checkpoint modes (STRUCTURAL/FUNCTIONAL/SECURITY), adaptive retry, crash recovery, auto-commit, milestone mutex (RAM+DB), spec drift guard, executor timeout (v124)
- **Code Intelligence** (v95-v102) — 33 modulů: symbol index, knowledge graph (9 typů hran, 50K/100K limity), AST analýza, architecture detection, graph expansion, context building
- **Execution Engine** (v104-v119) — patch engine (3-tier anchor), error normalizer (14 kódů), iterativní fix loop (max 8 iterací), self-critique, scope limiter, fix strategy selection
- **Prompt Pipeline** (v119) — strukturovaný prompt builder (12 sekcí), KG-based import map, signature cache, scope limiter
- **Architecture Governance** (v98-v100) — guardian, API contracts, critic/repair, regression prediction, multi-agent pipeline (5 rolí)
- **Skills System** (v85+) — deterministické workflow (JSON): 9 step typů. Meta-skills: create-skill, create-expertise, create-specialist
- **Memory System** (v86+) — LTM (poločas 69d), task memory (poločas 139d), cross-project learning
- **Model Upgrade** (v103-v124) — catalog (55 modelů), pairwise eval, empirical scoring (Phase 3, linear blend interpolation), L4 online discovery, validation suites (5 sad), chat-based approval, atomic dedup, auto-cleanup
- **Marketplace** (v124) — remote package catalog, transactional install, dependency resolver, SHA-256 ověření
- **C3 Studio IDE** — Theia 1.65.2 + Electron 37, 33 rozšíření, chat panel, agent log, settings, focus mode

### Zdrojový kód

| Adresář | Soubory | Řádky | Popis |
|---------|---------|-------|-------|
| src/chat/ | 72 | 30,981 | Konverzační pipeline (CRE, handlery, quality, syntéza) |
| src/planner/ | 34 | 15,150 | Lifecycle + execution engine + architecture governance |
| src/code-intel/ | 33 | 11,500 | Code Intelligence (symbol index, KG, AST, graph, context) |
| src/expertises/ | 23 | 9,464 | Expertise system + specialist runtime + merge engine |
| src/upgrade/ | 14 | 6,451 | Model upgrade (catalog, pairwise, empirical, L4, validation) |
| src/routes/ | 15 | 6,223 | HTTP API routes (14 route modulů) |
| src/agents/ | 14 | 6,510 | Agent platform (runner, scheduler, conditions, triggers) |
| src/tools/ | 2 | 5,456 | Tool registry (153 nástrojů) |
| src/ui/ | 2 | 4,552 | Web UI (architect.js) |
| src/architect/ | 13 | 4,007 | Architecture Intelligence (policy, refactor, predictor) |
| src/db/ | 40 | 4,408 | SQLite schema, 37 migrací |
| src/executor/ | 8 | 3,474 | Tool executor, circuit breaker, sandbox |
| src/notifications/ | 19 | 3,335 | 6 kanálů (email, TG, ntfy, webhook, desktop, push) |
| src/memory/ | 9 | 3,130 | LTM, task memory, cross-project, feedback |
| src/llm/ | 6 | 2,596 | LLM gateway, Ollama klient, web search |
| src/domains/ | 12 | 1,816 | Domain scaffoldy (React, Vue, FastAPI, Flutter, ...) |
| src/skills/ | 13 | 1,768 | Skills: registry, resolver, runner, 9 step executors |
| src/patch/ | 5 | 1,505 | Patch engine: parser, validator, applier, scope limiter |
| src/specialists/ | 2 | 1,379 | Specialist loader + capability registry |
| src/ws-bridge/ | 5 | 1,075 | WebSocket bridge (IDE ↔ backend) |
| src/channels/ | 3 | 841 | Channel adaptery (CLI, Web, API) |
| src/marketplace/ | 2 | 797 | Marketplace client + package installer |
| src/context/ | 3 | 742 | Prompt builder, import map, context delta |
| ostatní | 17 | 3,577 | core, autonomy, system, telemetry, licensing, setup, config, server |
| **Celkem** | **366** | **132,337** | |

### Databáze

80+ tabulek (SQLite, WAL, better-sqlite3), 37 migrací, prepared statements.

### Testovací pokrytí

| Sada | Počet | Oblast |
|------|-------|--------|
| CRE Comprehensive | 401 | Intent klasifikace (19 typů) |
| Conversation | 350 | CZ 150 + EN 150 + ND 50 |
| Code Intelligence | 339 | Symbol index, KG, graph, architektura, context |
| Architecture (governance + intelligence) | 218 | Guardian, contracts, critic, policy, predictor |
| Large Project Scaling | 107 | Graph storage, BFS, streaming, concept registry |
| Execution Engine F1-F8 | 355 | Patch, errors, loop, strategy, critique, patterns |
| Long-term FΔ+F9-F14 | 242 | Context delta, build strategy, deps, cross-project |
| Prompt Pipeline | 83 | Prompt builder, import map, scope limiter, sig cache |
| Model Upgrade (Phase 1-3 + L4) | 221 | Discovery, catalog, pairwise, proposals, empirical |
| Validation Suites | 73 | 5 sad, scoring, TTL, model ranker |
| Specialist System | 333 | Runtime, KB, scénáře, ledger, self-contained, wizard |
| Marketplace | 44 | Catalog, install, deps, security |
| Lifecycle | 186 | State machine, crash recovery, multi-session |
| Quality + Telemetry | 200+ | QGv2, scoring, drift, resilience, soak |
| Project E2E | 56 | 4 typy projektů, milníky |
| Skills | 44 | Registry, resolver, runner, step types |
| Memory | 50+ | LTM, injection-ranker, feedback, patterns |
| **Deterministické celkem** | **~3,500+** | **pass** |

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
│  │  Intel   │ │(LTM+task+  │ │ (discovery+eval+      │ │
│  │(33 mod.) │ │ cross-proj)│ │  validation)          │ │
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

### CRE Intent Routing

| Intent | Handler | Popis |
|--------|---------|-------|
| LOCAL | Deterministic | Čas, datum, kalkulačka, konverze |
| CONVERSATIONAL | LLM syntéza | Běžná konverzace |
| SEARCH | WebSearch + syntéza | Fresh data dotazy |
| FACTUAL | Evidence-based | Fakta s podklady |
| DESIGN | Design pipeline | Strukturované návrhy |
| CREATIVE | LLM syntéza | Příběhy, básně, kreativní obsah |
| BUILD | Planner pipeline | Stavba projektu |
| CODE | LLM syntéza | Inline kód (bez projektu) |
| PLAN | Build planning | Plánování milníků |
| ANALYZE | Analysis handler | Analytické úlohy |
| REPORT | Report handler | Strukturované reporty |
| FILE_EXPLAIN | Attachment handler | Vysvětlení přiloženého souboru |
| TOOL_CALL | Tool execution | Spuštění nástroje |
| ANSWER | Direct answer | Přímá odpověď bez vyhledávání |
| REFUSE | Refusal handler | Odmítnutí nevhodného obsahu |
| ASK_USER | Clarification | Upřesnění od uživatele |
| AMBIGUOUS | Fallback | Nejasný záměr → safe default |
| AGENT_WIZARD | Wizard handler | Průvodce tvorbou agenta |
| ATTACHMENT_EXPLAIN | Attachment | Pre-CRE deterministic override |

### Quality Gate v2 Pipeline (deterministický, bez LLM)

```
LLM Output → Layer 1: Structural Fix → Layer 2: Language Fix (SK→CZ)
  → Layer 3: Intent Guarantees (LinkGuard, FACTUAL, REPORT)
  → Layer 4: Content Enforcement → Score (0-100)
```

---

## Klíčové soubory

### CRE Decision Engine
```
src/chat/cre-decision.js          # ~2,900+ ř. — klasifikace intentů, 10 guards
src/chat/cre-decision-types.js    # CREDecision ADT, DecisionType, IntentType
src/chat/cre-routing-patches.js   # CRE routing patches
```

### Chat Pipeline
```
src/chat/controller.js             # ChatController — vstupní bod
src/chat/handlers/conversation.js  # ConversationHandler — routing, lifecycle, scenarios
src/chat/handlers/pre-handler.js   # Pre-handler intercepts (upgrade notification, approval)
src/chat/handlers/expertise.js     # Expertise handler — single + merge, enforcement
src/chat/handlers/decisions.js     # Decision sub-handlers
src/chat/handlers/lifecycle-router.js  # Lifecycle router (SPEC/BUILD/REVIEW)
src/chat/handlers/utils/synthesis.js   # LLM syntéza + Output Gate (D6)
src/chat/handlers/utils/language-enforcement.js  # SK→CZ transliterátor (~160 pravidel)
src/chat/conversation-store.js     # Session persistence (SQLite)
```

### Quality Pipeline
```
src/chat/quality/quality-gate-v2.js    # QGv2 — 4-layer deterministický pipeline
src/chat/quality/quality-pipeline.js   # Orchestrátor
src/chat/quality/drift-guard.js        # Language drift detection
```

### Expertise System
```
src/expertises/expertise-layer.js        # 15 vestavěných expertýz, ExpertiseRegistry
src/expertises/merge-engine.js           # mergeExpertisePrompt() — 15-step pure function
src/expertises/merge-compatibility.js    # 5D pairwise kompatibilita
src/expertises/capability-enforcer.js    # Post-response 5D drift detection
src/expertises/specialist-runtime.js     # Tool-augmented expert framework
src/expertises/knowledge-base.js         # Verzovaný fact store
src/expertises/scenario-engine.js        # Multi-step guided workflows
```

### Specialist System
```
src/specialists/specialist-loader.js     # Boot: scan → sort (Kahn) → load → register
src/specialists/capability-registry.js   # N:M priority-based routing
specialists/accountant-cz/               # Účetní (DPH, daně, pojistné, compliance)
specialists/translator/                  # Překladatel (překlad, detekce jazyka)
specialists/dummy-logger/                # Testovací utilita
```

### Code Intelligence
```
src/code-intel/code-search.js            # Multi-engine search (ripgrep → grep → Node.js)
src/code-intel/symbol-index.js           # O(1) symbol lookup
src/code-intel/knowledge-graph.js        # 9 edge typů, dependency graph
src/code-intel/graph-retrieval.js        # BFS expansion, hub penalty, namespace boost
src/code-intel/architecture-detector.js  # 18 frameworků, 10 vrstev, 8 vzorů
src/code-intel/context-builder.js        # Smart truncation + token budget
src/code-intel/context-engine.js         # Symbol-aware komprese (~70% úspora)
src/code-intel/impact-analyzer.js        # BFS impact traversal + risk scoring
src/code-intel/drift-detector.js         # Layer violations, circular deps
```

### Execution Engine
```
src/patch/parser.js                      # Patch ADT: file, regions, anchors
src/patch/validator.js                   # Structural + semantic validace
src/patch/applier.js                     # Bottom-up splice, atomic write
src/patch/engine.js                      # applyPatchSet s full rollback
src/patch/scope-limiter.js               # Pre-apply scope validace (KG-based)
src/planner/execution-loop.js            # Iterativní fix cyklus (max 8 iterací)
src/planner/error-normalizer.js          # 14 error kódů, root cause analýza
src/planner/fix-strategy.js              # DETERMINISTIC / HEURISTIC / LLM_FULL / SKIP
src/planner/self-critique.js             # LLM root-cause + patch plan + KG validace
```

### Prompt Pipeline
```
src/context/prompt-builder.js            # 12 sekcí, priority-weighted, adaptive budgets
src/context/import-map.js                # KG-based import resolution hints
src/context/context-delta.js             # Incremental context diffing
```

### Model Upgrade
```
src/upgrade/model-profiles.js            # Capabilities + family definice
src/upgrade/model-discovery.js           # L1 local + L2 catalog + L3 hints + L4 online
src/upgrade/model-catalog.js             # 55 curovaných modelů s benchmarky
src/upgrade/model-ranker.js              # Pairwise evaluation, per-role scoring
src/upgrade/upgrade-manager.js           # Full pipeline: discover → rank → propose → apply
src/upgrade/empirical-scorer.js          # Real execution metrik → blended scoring
src/upgrade/metrics-collector.js         # Batch event collection, outlier filtering
src/upgrade/validation-suites.js         # 5 testovacích sad pro model validaci
src/upgrade/proposal-store.js            # DB-backed proposals, cooldown, anti-thrashing
src/upgrade/preference-tracker.js        # Implicit preferences z user akcí
src/upgrade/online-discovery.js          # L4: HTML parsing, provisional entries
src/upgrade/benchmark-estimator.js       # Log-space interpolace, VRAM odhad
```

### Marketplace
```
src/marketplace/marketplace-client.js    # Catalog fetch, cache, download, hash, archive validace
src/marketplace/package-installer.js     # Transactional install, rollback, mutex, dependency resolver
```

### Memory System
```
src/memory/long-term.js                  # LTM persistence, decay, reinforcement
src/memory/task-memory.js                # Cross-milestone learning
src/memory/cross-project-learner.js      # Cross-project pattern sharing
src/memory/injection-ranker.js           # Score = effConf × relevance
src/memory/feedback-detector.js          # 6 signal typů
src/memory/pattern-tracker.js            # Cross-conversation learning
```

### Skills
```
src/skills/registry.js                   # Skill registry (JSON definice)
src/skills/resolver.js                   # LLM intent match
src/skills/runner.js                     # State machine executor
src/skills/steps/                        # 9 step executorů (llm, template, write, shell, ask, review, validate, substitute, transform)
```

### Architecture Governance
```
src/planner/architecture-guardian.js     # PRE/POST milestone drift audit
src/planner/api-contract-registry.js     # Export tracking, breaking changes
src/planner/critic-agent.js              # 6 failure typů, targeted repair
src/architect/architecture-policy.js     # Unified policy (.c3 > ACF > auto)
src/architect/regression-predictor.js    # Composite risk formula
src/architect/multi-agent.js             # 5-role pipeline (planner→builder→architect→critic→debugger)
```

### Databáze
```
src/db/database.js                # SQLite schema, 80+ tabulek
src/db/migrate.js                 # Migration runner
src/db/migrations/                # 37 migrací (timestamp-based, v63 → v124)
```

### Server
```
src/server.js                     # HTTP server (~1,242 ř.), port 3335
src/config.js                     # Konfigurace (~199 ř.) — modely, feature flags, timeouty
```

### IDE
```
c3-ide/extensions/c3-chat-panel/  # Chat panel + WS client (4,000+ ř.)
c3-ide/extensions/c3-center-views/ # Center views + Expertise Wizard
c3-ide/extensions/c3-detail-panel/ # Detail panel s capability bars
```

---

## Spuštění

### Backend
```bash
cd ~/Projects/c3-agent-wip
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
node src/server.js            # Produkční
node --watch src/server.js    # Vývojový (auto-restart)
# Server na http://127.0.0.1:3335
```

### Prerekvizity
- Node.js 22+ (povinné — `nvm use 22`, systémový node nestačí)
- Ollama s modely qwen3.5:27b + deepseek-r1:32b
- SQLite (better-sqlite3)

### Testy
```bash
# Všechny deterministické (~3,500+ testů)
npm test

# Konkrétní subsystémy
node tests/cre-comprehensive.test.js     # 401 — CRE
node tests/code-intel-v95.test.js        # 276 — Code Intelligence
node tests/execution-loop.test.js        # 56  — Execution Loop
node tests/upgrade-phase2.test.js        # 88  — Model Upgrade
node tests/specialist-system.test.js     # 115 — Specialist System
node tests/marketplace.test.js           # 44  — Marketplace

# E2E (vyžaduje Ollama + GPU)
node tests/lifecycle-klicenka-e2e.test.js
node tests/project-conversation-e2e.test.js  # 56 — 4 typy projektů
```

---

## API Endpoints — přehled

> Kompletní reference: [docs/API-REFERENCE.md](docs/API-REFERENCE.md)

| Prefix | Modul | Popis |
|--------|-------|-------|
| `/api/chat` | Chat | Konverzace, zprávy, sessions, specialist |
| `/api/conversations` | Conversations | CRUD, export, archiv, drafty |
| `/api/projects` | Projects | CRUD, lifecycle start/bind |
| `/api/expertises` | Expertises | CRUD, merge preview, schema, wizard |
| `/api/agents` | Agents | CRUD, dry-run, scheduling, builder |
| `/api/skills` | Skills | CRUD, reload, execution, resume |
| `/api/specialists` | Specialists | Enable/disable, discovery, telemetry |
| `/api/marketplace` | Marketplace | Catalog, install, uninstall, update |
| `/api/notifications` | Notifications | Kanály, test, config, log |
| `/api/system` | System | Health, GPU, modely, storage, validation |
| `/api/quality` | Quality | Summary, distribution, report, volatility |
| `/api/autonomy` | Autonomy | Status, approve, reject, alerts |
| `/api/security` | Security | Audit, tokeny (vyžaduje X-Admin-Token) |
| `/api/settings` | Settings | Uživatelská nastavení, feature flags |
| `/api/setup` | Setup | Setup wizard (first-run) |
| `/planner/*` | Planner | Sessions, progress, approve/reject |
| `ws://...` | WebSocket | IDE WS bridge — chat, control, terminal |

---

## Klíčové kontrakty

### 1. CRE je jediná autorita
Všechny chat zprávy procházejí CRE klasifikací. Žádný bypass — `overrideDecision()` pro audit trail, `logIntercept()` pro pre-CRE routes.

### 2. mergeExpertisePrompt() je čistá funkce
15-krokový algoritmus, frozen výstupy, žádné side effects.

### 3. ExpertiseEnforcer retry kontrakt
Max 2 retries s temperature decay (-0.1/pokus), top_p decay (-0.05/pokus). Strict mode: `hardFail=true`.

### 4. 5D Capability Vector
`{reasoning, creativity, determinism, riskTolerance, verbosity}` (0-100). Merge engine: weighted average.

### 5. QGv2 — deterministický, idempotentní, 4 vrstvy
Žádné LLM volání, žádný retry, žádné nové věty.

### 6. Patch Engine — 3-tier anchor, atomic write
Exact → normalized → AST anchor resolution. Bottom-up splice. Atomic tmp+rename. Full rollback on failure.

### 7. Execution Loop — max 8 iterací
Strategy selection (DETERMINISTIC → HEURISTIC → LLM_FULL → SKIP). Self-critique od iterace ≥ 2. Scope limiter: target + 1-hop KG deps.

### 8. Model Upgrade — nikdy auto-upgrade
Discovery nikdy nemění config. Komunikace jen přes proposals v DB. Chat-based approval.

### 9. Specialist self-contained
Žádný `import ../../src/` z plugin balíčků. Vše přes `ctx.registries`. Fail-safe unregister (try/catch per step).

### 10. ESM projekt
`package.json` má `"type": "module"`. IDE soubory jsou .cjs (CommonJS v Theia kontextu). Node.js 22+.

---

## Známé problémy a omezení

### LLM Variance (qwen3.5:27b)
- Občasné EN místo CZ odpovědi (sdílený corpus)
- Depth issues u některých technických témat
- Řešeno 3 vrstvami: system prompt → synthesis retry → QGv2 transliterátor

### SK Kontaminace
- qwen3.5:27b generuje slovensky místo česky
- 3-vrstvá oprava: system prompt, synthesis retry, QGv2 mechanical transliterátor
- Unconditional strip l/o + kritických SK slov pro edge cases pod threshold

### `\b` word boundary
- Nefunguje s non-ASCII znaky (č, ř, ž, ...)
- Workaround: `(?:\s|$|[?!.,;])` místo `\b` v CRE regexech

### better-sqlite3 segfaults
- Při vysoké zátěži (paralelní LLM testy) může native modul spadnout
- Fix: `npm rebuild better-sqlite3`

---

## Poznámky pro pokračování

1. **Nejdřív testy** — před jakoukoli změnou spusť existující testy
2. **ESM** — `import/export`, IDE soubory `.cjs` (CommonJS)
3. **Node.js 22+** — `export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"`
4. **Česká diakritika** — `\b` nefunguje; použij `(?:\s|$|[?!.,;])`
5. **Merge engine nedotýkej** — `merge-engine.js` je čistá funkce, změny jen v handleru
6. **`127.0.0.1` ne `localhost`** — v test fetch callech (Node.js resolvuje localhost na IPv6 `::1`)
7. **KG API** — `addEdge(type, from, to)` NE `(from, to, type)`. `getEdges(nodeId, edgeType)`, `getDependencies(fileId)`
8. **inversify `decorate()` vrací void** — NIKDY nepřiřazuj class z výsledku decorate()
9. **FE webpack rebuild** — úpravy `chat-panel-module.js` vyžadují: `cd c3-ide/applications/electron && npx webpack --config gen-webpack.config.js --mode development`
10. **NIKDY `tsc -b`** na c3-chat-panel — TS source (23 řádků) by přepsal hand-written JS (4000+ řádků)
11. **Backend auto-restart** — `node --watch src/server.js` (Node 22)
12. **E2E testy** — LLM-dependent, očekávej 89-97% pass rate (ne 100%)

---

*Poslední aktualizace: v124.0.0 (2026-03-12)*
