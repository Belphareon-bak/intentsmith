# C3-Agent — Roadmapa v12

## Od aktuálního stavu k vizi

**Datum:** 2026-02-24
**Verze kódu:** v80.0.0 (Quality Score + Telemetry + Specialist Memory)
**Testy:** ~2100+ verified (683 lifecycle+quality, 401 CRE, 350 conversation, 218 ledger, 270 specialist, 200+ quality)
**IDE:** C3 Studio (Theia 1.65.2), 33 custom extensions, Phase 1-5 (~73%)

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

## Kde je každý pilíř dnes (v80)

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

### Pilíř 2: PROJEKTY — 100% ✅
**Status: PHASE C = DONE. Quality Scoring layer přidán v80.**
- v65.6: Lifecycle session routing fix — RAM lookup by `projectId`, `bindSessionToLifecycle()`
- 683 deterministických lifecycle + quality testů PASS
- v65.7: C3 Real LLM lifecycle test ✅ — E2E s Ollama
- v80: **Quality Score** — deterministický scoring (spec, roadmap, change, lifecycle aggregate)
- v80: **Quality Telemetry** — automatické logování skóre do DB, query API

### Pilíř 3: WORKERI — 95% ✅
**Status: B0-B9 DONE. B8 template workeři kompletní.**
- B0-B6: Agent platform infrastruktura — DONE
- B8: 3 template workeři (weatherMonitor, newsAggregator, realEstateHunter)
- B9: Agent Builder Wizard — FE wizard (simple + advanced), BE schema endpoint
- Notifikační pipeline: Email, Telegram, ntfy/push, rate limiting, digest, trust tracker

### Pilíř 4: SPECIALISTÉ — 90% ✅ (upgrade z 80%)
Expertise layer (15 expertises) + accountant specialist + 5D capability system + merge engine v2 + ledger.
- v65.8: D1-D3 Specialist Runtime, Knowledge Base, Scenario Engine ✅
- v69: Expert→Expertise rename (soft DB migration, backward compat) ✅
- v69-v74: **Ledger system** — české daně, DPH, pojištění, compliance (218 testů) ✅
- v74: **Specialist Platform** — SpecialistLoader, specialist-runtime, tool-adapter ✅
- v79: **D4+D6+D7+D8** — REST API, dependencies, scenario branching, specialist memory ✅
- Zbývá: D5 (multi-specialist routing), D9 (marketplace)

### Pilíř 5: IDE — 73% ✅
Theia 1.65.2, 33 custom extensions, fungující build (lib/ + src-gen/).
- Hotovo: Chat panel, WS bridge, agent wizard, center views, expertise wizard, audit trail, diff viewer, keybindings, git integrace
- v65.5: Agent Builder Wizard UI (centerAgentWizard, simple + advanced mode)
- Zbývá (~10 items): Specialist CRUD wizard, Stage/Unstage, Cumulative "Approve All", Plugin systém

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
Fáze A: CHAT       ██████████████████████████████████████████  100% → DONE (v72 conv hardening)
Fáze C: PROJEKTY   ██████████████████████████████████████████  100% → DONE (v80 quality score)
Fáze D-int: ÚČETNÍ ██████████████████████████████████████████  100% → DONE (ledger v69-v74)
Fáze B: WORKERI    ██████████████████████████████████████░░░░   95% (B0-B9 done)
Fáze H: HARDENING  ██████████████████████████████████████████  100% (9/9 DONE)
Fáze D: SPECIALISTÉ██████████████████████████████████████░░░░   90% (D1-D8, ledger, specialist platform)
Fáze E: IDE        ██████████████████████████████░░░░░░░░░░░░   73% (Phase 1-5, 33 extensions)
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
**Nové od v11:** v79 specialist advanced (D4-D8), v80 quality score + telemetry (70 testů).

```
Celkem zbývajících úkolů:  6
  🔴 Critical:              0
  🟡 Important:             1  (QS3 Quality Report — in progress)
  ⚪ Future (D5,D9,E,F):     5  (~2 měsíce)
```

---

*Tento dokument nahrazuje Roadmapa v11. Aktualizováno na v80.0.0 (2026-02-24).*
