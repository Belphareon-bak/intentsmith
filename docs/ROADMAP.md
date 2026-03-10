# C3-Agent — Roadmapa v16

## Od aktuálního stavu k vizi

**Datum:** 2026-03-10
**Verze kódu:** v116.0.0 (Code Intelligence + F-series Agent Evolution + Model Upgrade + Architecture Governance)
**Testy:** ~3,000+ verified (597 F-series, 339 code-intel, 276 architecture, 401 CRE, 350 conversation, 218 ledger, 270 specialist, 115 upgrade, 56 project-E2E, 44 agent-log, + další)
**IDE:** C3 Studio (Theia 1.65.2), 33 custom extensions, Phase 1-5 (~85%)

---

## Vize — 4+2 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertise specializací.

### Pilíř 2: PROJEKTY — stavění věcí
Lifecycle engine: SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED.
Quality Score + Telemetry: deterministické měření kvality artefaktů.

### Pilíř 3: WORKERI — autonomní hlídací psi
24/7 monitoring s notifikacemi (email, Telegram, push).

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Tools + rutiny + paměť.

### Pilíř 5: IDE — vlastní vývojové prostředí
Eclipse Theia s custom panely (chat, center views, detail panel, expertise wizard, agent builder).

### Pilíř 6: PRODUKT — balíčkování a ochrana
Installer, licence, auto-update, setup wizard.

---

## Kde je každý pilíř dnes (v116)

### Pilíř 1: CHAT — 100% ✅
**Status: PHASE A = DONE.**
- CRE single-authority enforcement — `overrideDecision()` + `logIntercept()`
- 35 bypass pointů opraveno (conversation.js, clarification.js, followup.js)
- `cre_override_log` tabulka s audit trail
- v65.4: Project context injection — CRE hint `[[PROJECT_CONTEXT:...]]`, sanitized system prompt
- v65.6: CZ pádové tvary v classifyIntent — lokativ, dativ, instrumentál
- v65.7: A7 Expertise A/B test ✅ — 5 domén, expertise win/tie 5/5
- v72: Conversation hardening — EN local date fix, Christmas template, CRE drift guard
- v72: 350/350 conversation tests (CZ 150, EN 150, ND 50)
- v83: **Guarded Autonomy** — self-tuning override threshold (telemetry → drift detection → auto-adjust)
- v85: **Skills System** — deterministic macro-recipes (registry, resolver, runner, 4 step types)
- v85: **Runtime FeatureManager** — hot-toggle features z IDE Settings bez restartu serveru
- v87: **CRE GUARD 6** — creative override (creativeLock → SEARCH/AMBIGUOUS → CREATIVE)
- v87: **Attachment guard** — pre-CRE deterministic FILE_EXPLAIN override
- v87: **LLM timeout hardening** — no retry on AbortError, CHAT 90s

### Pilíř 2: PROJEKTY — 100% ✅
**Status: PHASE C = DONE. Quality Scoring + Checkpoint Architecture + Execution Engine.**
- Lifecycle session routing, crash recovery, multi-session
- 683 deterministických lifecycle + quality testů PASS
- v80: **Quality Score + Telemetry** — deterministický scoring, DB logging
- v92: **Checkpoint Architecture** — STRUCTURAL/FUNCTIONAL/SECURITY modes, adaptive retry
- v95-v102: **Code Intelligence** — 33 modulů, 11,463 LOC, BUILD context enrichment
- v98-v100: **Architecture Governance** — guardian, API contracts, critic/repair, regression prediction
- v104-v109: **Execution Engine (F1-F8)** — patch engine, error normalizer, iterative fix loop, self-critique (355 testů)
- v110-v116: **Agent Evolution (FΔ+F9-F14)** — adaptive strategy, task memory, cross-project learning (242 testů)

### Pilíř 3: WORKERI — 95% ✅
**Status: B0-B9 DONE. B8 template workeři kompletní.**
- B0-B6: Agent platform infrastruktura — DONE
- B8: 3 template workeři (weatherMonitor, newsAggregator, realEstateHunter)
- B9: Agent Builder Wizard — FE wizard (simple + advanced), BE schema endpoint
- Notifikační pipeline: Email, Telegram, ntfy/push, rate limiting, digest, trust tracker

### Pilíř 4: SPECIALISTÉ — 92% ✅ (upgrade z 90%)
Expertise layer (15 expertises) + accountant specialist + 5D capability system + merge engine v2 + ledger.
- v65.8: D1-D3 Specialist Runtime, Knowledge Base, Scenario Engine ✅
- v69: Expert→Expertise rename (soft DB migration, backward compat) ✅
- v69-v74: **Ledger system** — české daně, DPH, pojištění, compliance (218 testů) ✅
- v74: **Specialist Platform** — SpecialistLoader, specialist-runtime, tool-adapter ✅
- v79: **D4+D6+D7+D8** — REST API, dependencies, scenario branching, specialist memory ✅
- v82: **Specialist Telemetry** — pasivní observability (tool/memory/lifecycle/API events, batch flush, NOOP sentinel) ✅
- Zbývá: D5 (multi-specialist routing), D9 (marketplace)

### Pilíř 5: IDE — 78% ✅
Theia 1.65.2, 33 custom extensions, fungující build (lib/ + src-gen/).
- Hotovo: Chat panel, WS bridge, agent wizard, center views, expertise wizard, audit trail, diff viewer, keybindings, git integrace
- v65.5: Agent Builder Wizard UI (centerAgentWizard, simple + advanced mode)
- v87: **Settings UI Redesign** — 10 sekcí (Account, LLM, Memory, Notifications, Output, Appearance, System, Storage, Backup, About)
- v87: GPU detekce karta, Ollama model selector, notification channel status, DB storage overview
- Zbývá (~7 items): Specialist CRUD wizard, Stage/Unstage, Cumulative "Approve All", Plugin systém

### Pilíř 6: PRODUKT — 25% ✅
**Status: F1-F3 DONE (v65.7). 3 moduly napojeny do server.js.**
- **Setup wizard** — first-run detection, /api/setup/* routes ✅
- **Auto-updater** — startUpdateChecker() v server.listen(), graceful stop ✅
- **License system** — LicenseManager singleton, /api/license/status, FREE tier feature gates ✅
- **INSTALL.md** — manuální 7-sekční příručka
- Shell sandbox + secrets auth
- Chybí: installer, Electron builder dist

---

## Quality Score System (v80)

### Architektura

**Score ≠ Gate.** Quality gate (PASS/FAIL) rozhoduje, jestli artefakt projde. Quality score (0.0–1.0) měří *jak dobrý* je. Test T4 dokazuje: spec může projít validací (PASS) a přitom mít score 0.36 (WEAK).

```
                    ┌─ Gate: PASS/FAIL (binary, blocking)
Artifact ──────────┤
                    └─ Score: 0.0–1.0 (continuous, diagnostic)
```

### Scoring

| Metrika | Váhy | Popis |
|---------|------|-------|
| **spec_score** | 0.25 decision_depth, 0.25 measurability, 0.20 coverage, 0.15 specificity, 0.15 risk | Kvalita specifikace |
| **roadmap_score** | 0.30 milestone_completeness, 0.20 dependency_coherence, 0.30 req_coverage, 0.20 sizing_realism | Kvalita roadmapy |
| **change_score** | 0.30 impact_clarity, 0.25 risk_articulation, 0.25 delta_complexity, 0.20 preservation | Kvalita change impact analýzy |
| **lifecycle_score** | 0.50 spec + 0.30 roadmap + 0.20 change (bez change: 0.60/0.40) | Agregát |

### Pásma

| Pásmo | Rozsah | Význam |
|-------|--------|--------|
| EXCELLENT | ≥ 0.85 | Vzorová kvalita |
| GOOD | 0.70–0.85 | Solidní, drobné mezery |
| ACCEPTABLE | 0.55–0.70 | Funkční, ale zlepšitelný |
| WEAK | < 0.55 | Potřebuje přepracování |

### Telemetry

Automatické logování při lifecycle operacích:
- `approveSpec()` → `logSpecScore()` → DB
- `generateRoadmap()` → `logRoadmapScore()` → DB
- `proposeChange()` → `logChangeScore()` → DB

Query funkce: `getScoreHistory()`, `getLatestScores()`, `getScoreTrend()`

### Soubory

| Soubor | Účel |
|--------|------|
| `src/planner/quality-score.js` | Deterministický scoring engine (4 funkce, 13 sub-metrik) |
| `src/planner/quality-telemetry.js` | Compute + log + query layer |
| `src/db/migrations/2026_02_24_016_v80_quality_scores.js` | DB tabulka `quality_scores` |
| `tests/quality-score.test.js` | 36 assertions (8 testových skupin) |
| `tests/quality-telemetry.test.js` | 34 assertions (9 testových skupin) |

### Kalibrace (plánováno)

**Stav: Synteticky validováno. Čeká na reálná data.**

Po pilotu (5–10 reálných projektů) se kalibrují:
- Váhy sub-metrik (pokud distribuce odhalí zkreslení)
- Pásma (pokud EXCELLENT je nedosažitelný nebo triviální)
- Adaptive strictness thresholds

### Quality Report & API (další krok)

CLI report + REST API pro agregovanou analytiku:

```
GET /api/quality/summary?since=30d   → mean, median, stddev, distribution
GET /api/quality/project/:id         → per-project scores + trend
GET /api/quality/distribution        → histogram buckets (EXCELLENT/GOOD/ACCEPTABLE/WEAK)
```

Volatility Index: průměrná absolutní změna lifecycle_score mezi checkpointy.
Korelační analýza (po pilotu): spec_score vs build_success, roadmap_score vs milestone_slip.

---

## Co přibylo od v4 roadmapy

| Verze | Změna |
|-------|-------|
| v63.0 | Merge Engine v2 — multi-expertise composition (max 3) |
| v63.0 | 5D Capability System — per-expertise vektory, kompatibilita |
| v63.1 | Capability modifiers + Expertise Wizard UI |
| v63.3 | ExecutionTrace — UUID per turn, LLM log, prompt hash |
| v64.0 | **CRE Gatekeeper** — single-authority enforcement, schema migrations |
| v65.2-v65.4 | Lifecycle BUILD hardening, project context injection, INSTALL.md |
| v65.5 | **Agent Builder Wizard (B9)** — FE wizard UI + BE schema endpoint |
| v65.6 | **Lifecycle session routing fix** — RAM lookup by projectId |
| v65.7 | **F1-F3: Setup Wizard, Auto-updater, License system** wired into server.js |
| v65.8 | **D1-D3: Specialist Runtime, Knowledge Base, Scenario Engine** |
| v69.0 | **Expert→Expertise rename** — soft DB migration, 67 souborů, backward compat |
| v69-v74 | **Ledger system** — české daně, DPH, pojištění, compliance (218 testů) |
| v72.0 | **Conversation hardening** — EN locale fix, CRE drift guard, 350 conv testů |
| v74.0 | **Specialist Platform** — SpecialistLoader, specialist discovery, tool adapter |
| v78.0 | **Project cleanup** — legacy code removal, doc updates, stale file cleanup |
| v79.0 | **D4-D8: Specialist Advanced** — REST API, dependencies, memory, scenario branching |
| v80.0 | **Quality Score + Telemetry** — deterministický scoring, DB logging, 70 testů |
| v82.0 | **Specialist Telemetry** — pasivní observability (tool/memory/lifecycle/API events, batch flush) |
| v85.0 | **Skills System MVP** — registry, resolver, runner, 7 step types (llm, template, write, shell, ask, review, validate) |
| v85.0 | **Runtime FeatureManager** — hot-toggle features z IDE Settings bez restartu |
| v85.0 | **Skill Detector** — automatická detekce opakujících se workflow vzorů |
| v86.0 | **Memory System** — LTM, injection-ranker, feedback-detector, pattern-tracker, context-budget |
| v86.0 | **Agent Log UX** — SYSTEM_STEP protocol, 15 hooks (5 key + 10 verbose), agent-log-renderer |
| v87.0–87.5 | **IDE Settings UI Redesign** — 10 sekcí, GPU detekce, model selector, notif channels, storage |
| v87.6 | **CRE GUARD 6** — creative override (creativeLock bypass), BUILD dead-end fix (PLAN case) |
| v87.6 | **LLM Gateway hardening** — timeout 90s, no retry on AbortError, numeric density gate |
| v87.6 | **Attachment guard** — pre-CRE deterministic FILE_EXPLAIN override |
| v88–89 | **Project Workflow** — lifecycle intercepts, project welcome, version unification |
| v90.0 | **Smart Relay Management** — _smartRouteToRelay(), typing indicator |
| v91.0 | **Settings Phase 3** — Feature Flags UI, Security (auth+tokens+audit), 5-step onboarding |
| v92.0 | **Checkpoint Architecture** — STRUCTURAL/FUNCTIONAL/SECURITY modes, adaptive retry |
| v92.0 | **Specialist Focus Mode** — CSS-driven layout transformation, per-session focus |
| v93.0 | **Project Conversation E2E** — 56/56 tests, 4 project types, lifecycle approval |
| v95–v99 | **Code Intelligence** — 33 modules (11,463 LOC): symbol index, KG, graph expansion, architecture detection |
| v98.0 | **Architecture Governance** — guardian, API contract registry, critic/repair agent (57 tests) |
| v100.0 | **Architecture Intelligence** — policy, context engine, refactor, regression predictor, multi-agent (161 tests) |
| v101–v102 | **Large Project Scaling** — map-based graph, priority BFS, streaming indexer, concept registry (107 tests) |
| v103.0 | **Self-Evaluating Model Registry** — discover→rank→propose→approve→pull, chat-based approval (115 tests) |
| v104.0 | **F1-F3: Patch Engine + Error Normalizer + Execution Loop** — core agent evolution (161 tests) |
| v106–v109 | **F4-F8: Context Optimizer, Task Memory, Self-Critique, Graph Debug, Pattern Mining** (194 tests) |
| v110–v116 | **FΔ+F9-F14: Context Delta, Build Strategy, Fix Strategy, Perf Intel, Deps, CI, Cross-Project** (242 tests) |

---

## FÁZE H — HARDENING (code review nálezy)

**Status:** 9/9 DONE. Všechny CRITICAL opraveny.

| # | Úkol | Effort | Priorita | Status |
|---|------|--------|----------|--------|
| H1 | Error message sanitization (`safeError()`) | 0.5d | 🔴 P0 | ✅ |
| H2 | Security headers (CSP, X-Frame, X-XSS) | 0.5d | 🔴 P0 | ✅ |
| H3 | Architect session TTL + LRU (max 20, 4h, 30min cleanup) | 0.5d | 🔴 P0 | ✅ |
| H4 | parseBody JSON error handling (reject, ne raw) | 0.25d | 🟡 P1 | ✅ |
| H5 | Path traversal guard v sendStaticFile() | 0.25d | 🟡 P1 | ✅ |
| H6 | Memory API konsolidace | 0.5d | 🟡 P1 | ✅ `/memory` odstraněn, `/api/global-memory` canonical |
| H7 | safeParseInt helper (12+ usage sites) | 0.25d | 🟡 P1 | ✅ |
| H8 | Smazat integration-patches.js | 5min | 🟡 P1 | ✅ |
| H9 | server.js route split | 1d | ⚪ P2 | ✅ 7 route modulů v src/routes/, server.js 854 řádků |

---

## Aktualizovaný timeline

```
Fáze Q: QUALITY    ██████████████████████████████████████████  100% → DONE
Fáze A: CHAT       ██████████████████████████████████████████  100% → DONE (v87 GUARD 6 + attachment guard)
Fáze C: PROJEKTY   ██████████████████████████████████████████  100% → DONE (v80 quality score + v92 checkpoint)
Fáze D-int: ÚČETNÍ ██████████████████████████████████████████  100% → DONE (ledger v69-v74)
Fáze B: WORKERI    ██████████████████████████████████████░░░░   95% (B0-B9 done)
Fáze H: HARDENING  ██████████████████████████████████████████  100% (9/9 DONE)
Fáze D: SPECIALISTÉ██████████████████████████████████████░░░░   92% (D1-D8, ledger, specialist platform, telemetry)
Fáze G: CODE INTEL ██████████████████████████████████████████  100% → DONE (v95-v102, 33 modulů, 339 testů)
Fáze I: GOVERNANCE ██████████████████████████████████████████  100% → DONE (v98-v100, guardian+contracts+critic)
Fáze J: F-SERIES   ██████████████████████████████████████████  100% → DONE (v104-v116, F1-F14, 597 testů)
Fáze K: MODEL MGMT ██████████████████████████████████████████  100% → DONE (v103, 115 testů)
Fáze E: IDE        █████████████████████████████████░░░░░░░░░   82% (Phase 1-5, 33 extensions, Settings Phase 3 v91)
Fáze F: BALÍČKOVÁNÍ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   25% (F1-F3 wired)
```

---

## Doporučené pořadí práce

### Sprint 1 — Integrace F modulů ✅ (DONE v65.7)

```
✅→ F1. Napojit Setup Wizard — first-run detection + /api/setup/* routes
✅→ F2. Napojit Auto-updater — startUpdateChecker() v server.listen()
✅→ F3. Napojit License system — feature gates na PRO/ENTERPRISE funkce
✅→ A7. Expertise A/B test — 5 domén, expertise win/tie 5/5 (v65.7)
```

### Sprint 2 — IDE + Quality (~1 týden)

```
❌→ E1. IDE: Specialist CRUD wizard (2-3d)
✅→ C3. Reálný LLM test lifecycle s Ollama — 10/10 PASS (v65.7)
❌→ E2. IDE: Stage/Unstage v working tree (1d)
```

### Sprint 3 — Specialist Platform D1-D3 ✅ (DONE v65.8)

```
✅→ D1. Specialist Runtime — ToolRegistry + IntentDetector + ToolExecutor (23 tests)
✅→ D2. Knowledge Base — DB migration + KnowledgeBase class + seed (35 tests)
✅→ D3. Scenario Engine — ScenarioRegistry + ScenarioRunner + accountant pilot (42 tests)
```

### Sprint 4 — Quality Score + Specialist Advanced ✅ (DONE v79-v80)

```
✅→ D4. Specialist Memory — persistent context, memoryWrites (v79)
✅→ D6. Scenario Branching — branchIf support (v79)
✅→ D7. Dependency System — topological sort, enable/disable guards (v79)
✅→ D8. REST API refactor — dependents check moved to loader (v79)
✅→ QS1. Quality Score — deterministický scoring engine, 36 testů (v80)
✅→ QS2. Quality Telemetry — DB logging, auto-fire, query API, 34 testů (v80)
```

### Sprint 5 — Quality Report + API (NEXT)

```
→ QS3. Quality Report — CLI report + REST API (summary, distribution, per-project)
→ QS4. Volatility Index — lifecycle_score drift měření
→ Pilot: 5–10 reálných projektů, sběr distribuce, kalibrace
```

### Sprint 6+ — Remaining Specialists, IDE, Packaging

- Fáze D: D5 (multi-specialist routing), D9 (marketplace)
- Fáze E: IDE — zbývající items (~2-3 sprinty)
- Fáze F: BALÍČKOVÁNÍ — Electron builder, installer (2–3 týdny)

---

## Kompletní task list (zbývající úkoly)

| # | Fáze | Úkol | Effort | Priorita | Status |
|---|------|------|--------|----------|--------|
| 1 | H | H1–H9 Hardening (9 úkolů) | — | — | ✅ DONE |
| 2 | B | B8. Template workeři (3 agenti) | — | — | ✅ DONE (v65.5) |
| 3 | B | B9. Agent builder wizard | — | — | ✅ DONE (v65.5) |
| 4 | F | F1. Napojit Setup Wizard do server.js | 2-4h | 🟡 P1 | ✅ DONE (v65.7) |
| 5 | F | F2. Napojit Auto-updater do server.js | 2-4h | 🟡 P1 | ✅ DONE (v65.7) |
| 6 | F | F3. Napojit License system (feature gates) | 1d | 🟡 P1 | ✅ DONE (v65.7) |
| 7 | A | A7. Expertise A/B kvalitativní test | 1d | 🟡 P1 | ✅ DONE (v65.7) |
| 8 | C | C3. Reálný LLM test lifecycle | průběžně | 🟡 P1 | ✅ DONE (v65.7) |
| 9 | D | D1-D3. Specialist Runtime + KB + Scenarios | 3d | ⚪ P2 | ✅ DONE (v65.8) |
| 10 | D | D4-D8. Specialist Advanced (memory, deps, API) | ~2 týd. | ⚪ P2 | ✅ DONE (v79) |
| 11 | C | QS1-QS2. Quality Score + Telemetry | 2d | 🟡 P1 | ✅ DONE (v80) |
| 12 | C | QS3. Quality Report + API | 1d | 🟡 P1 | ⏳ IN PROGRESS |
| 13 | C | QS4. Pilot — kalibrace na reálných datech | průběžně | ⚪ P2 | ❌ |
| 14 | D | D5. Multi-specialist routing | ~1 týd. | ⚪ P2 | ❌ |
| 15 | D | D9. Remote registry / marketplace | ~1 týd. | ⚪ P2 | ❌ |
| 16 | E | E1-E10. IDE: zbývající items (~10) | ~2 týd. | ⚪ P2 | ❌ |
| 17 | F | F4–F6 Electron builder + installer | ~2 týd. | ⚪ P2 | ❌ |

---

## Celkový progres

**Hotovo:** ~98% celkové vize
**Nové od v93:** Code Intelligence (33 modulů), Architecture Governance, Execution Engine (F1-F14), Model Upgrade System, Large Project Scaling — celkem 1,500+ nových testů.

```
Celkem zbývajících úkolů:  6 + IDE Settings Phase 3b-4
  🔴 Critical:              0
  🟡 Important:             1  (QS3 Quality Report)
  ⚪ Future (D5,D9,E,F):     5  (~2 měsíce)
  📐 IDE Settings Phase 3b:  Social login (OAuth), Online sync (GitHub Gist)
  📐 IDE Settings Phase 4:   GPU wizard, Model auto-download, First-run, Diagnostics bundle
```

---

## IDE Settings — Kompletní redesign (v86+ → v87 implementace)

### Aktuální stav (v87.6)

Settings UI kompletně přepsáno v87.3–87.5. 10 funkčních sekcí s backend sync (`GET/POST /api/settings`). GPU detekce, Ollama model selector, notification channel status, DB storage overview. Theia PreferenceSchema rozšířen na 60+ klíčů.

**Oddělení vrstev:**
- **Lokální desktop-only** (PHASE 1-2): vše běží offline, žádná cloud závislost
- **Cloud-ready** (PHASE 3+): OAuth, online sync, mobilní push
- **User profile vs Runtime profile**: Identity (kdo jsi) je oddělená od Runtime (jak se C3 chová)

### Známé bugy (P0)

| # | Bug | Status |
|---|-----|--------|
| S1 | Header overlap: záložka otevřeného souboru překrývá nadpis "Nastavení" | ✅ FIXED |
| S2 | Skills toggle není viditelný v IDE nastavení (jen v Theia Preferences) | ✅ FIXED |
| S3 | Detail card nelze zvětšit, výchozí šířka je příliš úzká | ✅ FIXED |
| S4 | Storage 0 MB / 0 Migrace — db wrapper vs rawDb | ✅ FIXED (v87.5) |
| S5 | GPU "Neznámé" — špatné mapování API fieldů | ✅ FIXED (v87.4) |
| S6 | About zobrazuje v86.0.0 — hardcoded verze | ✅ FIXED (v87.4) |

---

### Implementační fáze

```
PHASE 1 — Runtime stabilita (P0)                   STATUS
  a) Account redesign                               ✅ PARTIAL (identity done, auth/avatar Phase 3)
  e) LLM Settings                                   ✅ MOSTLY DONE (GPU, models, temp, ctx, timeouts)
  d) Memory & Context rozšíření                     ✅ MOSTLY DONE (LTM, budget, learning, patterns)
  g) Output formats stabilizace                     ✅ PARTIAL (toggles done, profiles NOT YET)

PHASE 2 — UX & Komfort (P1)
  b) Notifications multi-channel                    ✅ PARTIAL (4 channel cards + status)
  c) Appearance polish                              ✅ DONE (density, uiScale, existing rich impl)
  f) System lokalizace + diagnostika + runtime      ✅ PARTIAL (timezone, currency, log, diagnostika)
  j) Storage management                             ✅ PARTIAL (DB info, vacuum, table counts)
  Backup & Sync (lokální export/import)             ✅ PARTIAL (export/import done, versioning NOT YET)

PHASE 3 — Ecosystem (P2)                           🟡 PARTIAL (v91)
  a2) Social login (OAuth: Google, Apple, Microsoft)   ❌ NOT STARTED (deferred to Phase 3b)
  b2) Mobilní notifikace (push)                        ❌ NOT STARTED
  Online sync (GitHub Gist)                            ❌ NOT STARTED (deferred to Phase 3b)
  i) Security sekce (tokens, encryption, audit)        ✅ DONE (v91 — auth guard, API tokens, audit, webhook)
  k) Feature Flags UI (power users)                    ✅ DONE (v91 — 7 toggles, reset, Theia prefs)
  Getting Started / Tutorial                           ✅ DONE (v91 — 5-step onboarding, restart from About)

PHASE 4 — Installer Intelligence                   ❌ NOT STARTED
  GPU detection wizard (first-run)
  Model auto-download + kompatibilita
  First-run auto-config
  Diagnostics bundle export
```

---

### a) Account (User / Identity) — kompletní přepis

**Cíl:** Plnohodnotný účet s jasným oddělením Identity vs Authentication.

#### a1) Identity (lokální profil) — PHASE 1

- Jméno / oslovení (jak C3 oslovuje uživatele)
- Stručný popis (kdo jsi, co děláš — kontextový profil pro model)
- Avatar (upload nebo z propojeného účtu)
- Lokální profil ID
- Odstranit pole "role"

#### a2) Authentication — PHASE 1 (základ) + PHASE 3 (OAuth)

**PHASE 1 (desktop-only):**
- Guest mode s omezeními (max konverzací, žádný export)
- Local account (username + password hash, bcrypt)
- Session persistence (encrypted token v Electron secure storage)
- "Pamatuj si mě" checkbox

**PHASE 3 (cloud-ready):**
- OAuth providery (Google, Apple, Microsoft)
- Propojené účty pro notifikace (Discord, Telegram, Slack)
- Phone/email verification

> **Bezpečnostní model:** Social login dramaticky rozšiřuje security surface (token storage, refresh flow, PKCE, callback URL). V první verzi neimplementovat — začít local account + guest. OAuth až po Security sekci (i).

### b) Notifications — multi-kanálové notifikace

**Cíl:** Modulární provider architektura s centrální queue.

#### Kanálová architektura

```
notification_providers/
  email.js          — SMTP/API
  webhook.js        — POST s HMAC podpisem
  discord.js        — webhook URL
  telegram.js       — bot API
  desktop.js        — Electron Notification API
  mobile_push.js    — PHASE 3 (future)
```

Každý provider implementuje: `init()`, `validate()`, `send()`, `test()`

#### Webhook Security

- **HMAC signature** — `X-C3-Signature: sha256=<hmac>` header
- **Retry policy** — max 3 pokusy s exponential backoff (1s → 2s → 4s)
- **Dead-letter queue** — failed notifications uloženy pro manuální review
- **Trusted domains whitelist** — webhook URL musí odpovídat whitelist

#### Centrální queue

- Batch buffer s konfigurovatelným intervalem
- Deduplikace (hash obsahu)
- Provider-agnostický — queue neví o kanálech, jen routuje
- Dead-letter pro opakovaně selhávající delivery

#### Tichý režim

- `quietHours: { from, to }` — timezone aware
- Dny v týdnu (pondělí–neděle checkbox)
- `priorityOverride: true` — ERROR vždy projde i v tichém režimu

#### Periodizace

- Okamžitě / batch (5min / 15min / 1h) / denní digest
- Per-kanál konfigurace

#### UI

- Per-kanál enable/disable toggle
- Prioritní filtry: jen ERROR, WARNING+, ALL
- Test notifikace tlačítko per provider

### c) Appearance — polish

- **P0:** Opravit font (fallback na system font)
- **P0:** Light theme kontrast a barvy
- **P1:** Font size slider
- **P1:** Compact density toggle (comfortable / compact / minimal)
- **P1:** UI scale (1.0 / 1.1 / 1.25)
- **P2:** Accent color picker (nejen green)
- **P2:** Custom CSS injection (advanced toggle, skryto za "Advanced" expander)

### d) Memory & Context — 4 podsekce

**Cíl:** Granulární kontrola nad celým paměťovým systémem.

#### d1) Conversation Memory

- History retention (N dní, default 90)
- Max messages per conversation (default 5000)
- Auto-archive po N dnech neaktivity
- Auto-delete po N dnech (volitelné, default OFF)

#### d2) Long-Term Memory (LTM)

- Enable/disable LTM toggle
- Confidence threshold pro zobrazení v kontextu (slider 0.0–1.0, default 0.3)
- Max LTM entries (default 500)
- Eviction strategy výběr:
  - FIFO (nejstarší pryč)
  - LRU (nejméně přistupované)
  - Least referenced (nejméně reinforced)
  - Lowest confidence (nejnižší efektivní confidence)

#### d3) Context Budget

**Relativní limity (%):**
- FS inclusion % — kolik context budgetu věnovat souborům (slider 0–50%)
- Tool output inclusion % — výstup nástrojů (slider 0–30%)
- Memory inclusion % — LTM + preferences (slider 0–20%)
- Vizuální budget breakdown bar (stacked bar chart)

**Hard caps (absolutní limity — ochrana proti runaway contextu):**
- `hardMaxContextTokens` — absolutní max tokenů per request (default 8192)
- `hardMaxFSTokens` — max tokenů pro filesystem kontext (default 3000)
- `hardMaxToolTokens` — max tokenů pro tool output (default 2000)
- `hardMaxMemoryTokens` — max tokenů pro LTM + preferences (default 1500)

> Hard caps mají přednost před procentuálními limity. I když % dovoluje víc, hard cap nikdy nepřekročí.

#### d4) Learning & Adaptation

- **Skills toggle** — zapnout/vypnout skill systém (synced to backend)
- **Preference tracking** — automatické učení z korekcí
- **Pattern detection** — detekce opakujících se workflow vzorů
- **Skill auto-suggestion** — navrhovat skills z detekovaných vzorů
- **Autonomy tuning** — level autonomie (conservative / balanced / aggressive)

### e) LLM Settings — nejdůležitější sekce

**Cíl:** LM Studio-level nastavení s GPU-aware doporučeními.

#### e1) GPU Detekce (bez LLM)

```
Linux:   nvidia-smi, lspci, rocm-smi
Windows: wmic, nvidia-smi
Mac:     system_profiler SPDisplaysDataType
```

Uložit do `system_profile`: `{ gpu_model, vram_mb, driver, cuda_version, rocm_version }`

Auto-detect při startu + refresh tlačítko.

#### e2) Model Compatibility Engine

Hardcoded reference map (ne LLM výstup):

| VRAM | Max doporučený model |
|------|---------------------|
| 8 GB | 7B Q4_K_M |
| 12 GB | 13B Q4_K_M |
| 16 GB | 14B Q5_K_M |
| 24 GB | 32B Q4_K_M |
| 48 GB | 70B Q4_K_M |
| CPU-only | 3B Q4_K_M (fallback) |

Reálný odhad paměti: `model_size * 1.2` (kvůli KV cache overhead).

- Varování pokud vybraný model překračuje VRAM
- **CPU-only fallback** — pokud žádná dGPU detekována, nabídnout malé modely + upozornění na pomalost
- **iGPU varování** — sdílená VRAM (Intel UHD, AMD APU) = reálná kapacita je nižší než reportovaná
- Důležité pro instalátor (PHASE 4): auto-detect → doporučení → one-click install

#### e3) Model parametry — Basic / Advanced mód

**Basic** (viditelné vždy):
- Model selector (dropdown z Ollama API)
- Context Length (slider + číslo)
- Temperature (slider 0.0–2.0)
- Ollama/LM Studio endpoint URL

**Advanced** (za expanderem):
- Top-P, Top-K
- Repeat Penalty
- GPU Offload Layers
- Batch Size, Threads
- Rope Scaling
- KV Cache Quantization
- mmap toggle, NUMA toggle
- Flash Attention toggle

#### e4) Model Info Card

- Velikost na disku
- Kvantizace (Q4_K_M, Q5_K_M, ...)
- Maximální context window
- Popis modelu
- Estimated RAM usage
- Recommended context size
- Tokens/sec benchmark (pokud známý, z Ollama API)

### f) System — lokalizace + runtime

- **Jazyk:** výběr z podporovaných (nezobrazovat nepodporované)
- **Lokace:** auto-detekce z IP/systému (s možností přepsat)
- **Časová zóna** + formát data (DD.MM.YYYY vs MM/DD/YYYY vs ISO)
- **Měna** — pro komunikaci s modelem (Kč, EUR, USD, ...)
- **Worker threads count** — počet paralelních vláken
- **Max parallel tool calls** — limit souběžných tool volání
- **Autonomy interval** — interval kontroly (pokud autonomie zapnuta)
- **Log retention** — N dní (default 30)
- **DB vacuum** — tlačítko pro kompakci DB
- **Diagnostika** — verze serveru, DB verze, počet migrací, uptime

### g) Output & Formats — output profily

**Cíl:** Pojmenované profily místo jednotlivých přepínačů.

#### Output Profiles

| Profil | Markdown | Code blocks | Diagram format | File export |
|--------|----------|-------------|----------------|-------------|
| Developer | ON | ON | Mermaid | MD |
| Research | ON | OFF | PlantUML | PDF |
| Report | ON | OFF | DOT→PNG | DOCX |
| Minimal | OFF | OFF | — | TXT |

- Uživatel může vytvořit custom profil
- Default profil per expertise (developer expertise → Developer profil)
- Každý profil definuje: markdown on/off, code blocks on/off, diagram format, file export default

#### Formátové přepínače

- Výchozí formáty pro různé typy výstupu (dokumenty, kód, diagramy, data)
- Enable/disable per formát
- Zobrazení všech podporovaných rozšíření a nástrojů
- Export nastavení (kam se ukládá, jaký formát)

### h) About — info + zpětná vazba + diagnostika

- Ponechat aktuální design (logo + verze)
- **Diagnostics bundle export** — zip s logy + system info + config (anonymizované)
- **Open data folder** — tlačítko pro otevření datového adresáře
- **Changelog viewer** — embedded changelog s verzemi
- **Nahlásit chybu / Zpětná vazba** — formulář nebo link
- Systémové info: Electron verze, Node verze, OS, GPU
- Link na dokumentaci

> **Getting Started / Tutorial** — implementovat jako oddělenou sekci, ne součást About. PHASE 3.

---

### i) Security (NOVÁ SEKCE) — PHASE 3

**Cíl:** Centrální místo pro bezpečnostní nastavení. Nutné před OAuth.

- **API token management** — generování, rotace, revokace
- **Webhook secret** — HMAC klíč pro ověření webhook callbacků
- **Local encryption key rotation** — rotace šifrovacího klíče pro lokální data
- **DB encryption toggle** — šifrování SQLite at rest
- **Auto-lock** — zamknout po N minutách neaktivity (default OFF)
- **Audit log** — zobrazení posledních bezpečnostních událostí
- **Trusted domains** — whitelist URL pro webhook/API volání

### j) Storage (NOVÁ SEKCE) — PHASE 2

**Cíl:** Přehled a správa úložiště.

Zobrazit:
- **DB size** — aktuální velikost + trend
- **Snapshots size** — exporty, zálohy
- **Logs size** — log soubory
- **LLM models size** — modely stažené přes Ollama
- **LTM entries count** — počet položek v dlouhodobé paměti

Akce:
- **Cleanup** — smazat staré logy, archivované konverzace
- **Compress** — vacuum DB + gzip logy
- **Prune models** — odebrat nepoužívané modely

Vizuální breakdown (pie/bar chart)

### k) Feature Flags (NOVÁ SEKCE) — PHASE 3

**Cíl:** Centrální přehled všech runtime feature toggleů (pro power users).

| Flag | Popis | Default |
|------|-------|---------|
| `skills` | Systém skillů (macro-recipes) | ON |
| `autonomy` | Guarded autonomy mode | ON |
| `patternDetection` | Detekce opakujících se workflow vzorů | ON |
| `ltm` | Long-term memory | ON |
| `feedbackLearning` | Učení z korekcí | ON |
| `experimentalTools` | Experimentální nástroje | OFF |

- Toggle switch pro každý flag
- Sync to backend přes WebSocket (`c3.features.*`)
- Warning při vypnutí kritického flagu
- Reset to defaults tlačítko

---

### Backup & Sync Settings

#### Lokální záloha (PHASE 2)

- Export/import settings jako JSON
- Settings versioning (automatický changelog při změně)
- Tlačítko: "Exportovat nastavení" / "Importovat nastavení"

#### Online sync (PHASE 3)

- GitHub Gist sync
- Merge strategie: local wins / remote wins / manual
- Auto-sync interval (volitelné)

---

*Tento dokument nahrazuje Roadmapa v14. Aktualizováno na v116.0.0 (2026-03-10).*
