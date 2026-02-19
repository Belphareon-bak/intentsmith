# C3-Agent — Roadmapa v9

## Od aktuálního stavu k vizi

**Datum:** 2026-02-19
**Verze kódu:** v65.7 (F1-F3 integration: Setup Wizard, Auto-updater, License system wired into server.js)
**Testy:** ~1400+ verified (628 lifecycle, 401 CRE, 278 invariant, 100+ quality)
**IDE:** C3 Studio (Theia 1.65.2), 33 custom extensions, Phase 1-5 (~73%)

---

## Vize — 4+2 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertní specializací.

### Pilíř 2: PROJEKTY — stavění věcí
Lifecycle engine: SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED.

### Pilíř 3: WORKERI — autonomní hlídací psi
24/7 monitoring s notifikacemi (email, Telegram, push).

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Tools + rutiny + paměť.

### Pilíř 5: IDE — vlastní vývojové prostředí
Eclipse Theia s custom panely (chat, center views, detail panel, expertise wizard, agent builder).

### Pilíř 6: PRODUKT — balíčkování a ochrana
Installer, licence, auto-update, setup wizard.

---

## Kde je každý pilíř dnes (v65.6)

### Pilíř 1: CHAT — 100% ✅
**Status: PHASE A = DONE. Vše hotovo včetně A7 (v65.7).**
- CRE single-authority enforcement — `overrideDecision()` + `logIntercept()`
- 35 bypass pointů opraveno (conversation.js, clarification.js, followup.js)
- `cre_override_log` tabulka s audit trail
- v65.4: Project context injection — CRE hint `[[PROJECT_CONTEXT:...]]`, sanitized system prompt
- v65.6: CZ pádové tvary v classifyIntent — lokativ, dativ, instrumentál ("o čem je projekt")
- v65.7: A7 Expert A/B test ✅ — 5 domén (writer, analyst, lawyer, developer, accountant), expert win/tie 5/5

### Pilíř 2: PROJEKTY — 100% ✅
**Status: PHASE C = DONE. Vše hotovo včetně C3 (v65.7).**
- v65.2: BUILD hardening — real test exec, checkpoint FAIL default, hard milestone size limits
- v65.3: Conversation restore on project open — lifecycle bind, stale guard, scroll
- v65.4: Project context sync IDE→BE→LLM (`projectId` through full pipeline)
- v65.6: Lifecycle session routing fix — RAM lookup by `projectId`, `bindSessionToLifecycle()`
- 628/628 deterministických lifecycle testů PASS
- v65.7: C3 Real LLM lifecycle test ✅ — E2E s Ollama (project create, lifecycle start, SPEC, state check)

### Pilíř 3: WORKERI — 95% ✅ (upgrade z 85%)
**Status: B0-B9 DONE. B8 template workeři kompletní.**
- B0-B6: Agent platform infrastruktura — DONE
- B8: **3 template workeři plně implementovány:**
  - `weatherMonitor()` → Telegram/ntfy (OpenMeteo API, frost alert trigger)
  - `newsAggregator()` → Telegram/ntfy (RSS multi-source, LLM summarizace, digest mode)
  - `realEstateHunter()` → email (Sreality API, multi-source, digest)
- B9: **Agent Builder Wizard** — FE wizard (simple 3-step + advanced 5-section), BE schema endpoint
- Notifikační pipeline: Email, Telegram, ntfy/push, rate limiting, digest, trust tracker
- Zbývá: RSS digest worker — default channel je Telegram/ntfy, ne email (triviální fix)

### Pilíř 4: SPECIALISTÉ — 65% ✅ (upgrade z 40%)
Expert layer (15 experts) + accountant pilot + 5D capability system + merge engine v2 + expertise wizard UI.
- v65.8: **D1 Specialist Runtime** — ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime ✅
- v65.8: **D2 Knowledge Base** — DB migration (3 tables), KnowledgeBase class, tax rates seed (96 facts) ✅
- v65.8: **D3 Scenario Engine** — ScenarioRegistry, ScenarioRunner, accountant tax optimization scenario ✅
- Zbývá: D4-D9 (specialist memory, multi-specialist routing, advanced scenarios)

### Pilíř 5: IDE — 73% ✅ (korekce z 80%)
Theia 1.65.2, 33 custom extensions, fungující build (lib/ + src-gen/).
- Sprint 1-7 → ve skutečnosti Phase 1-5 dle IDE roadmapy
- Hotovo: Chat panel, WS bridge, agent wizard, center views, expert wizard, audit trail, diff viewer, keybindings, git integrace
- v65.3: Project opener s conversation restore + lifecycle bind
- v65.4: Project context pipeline (IDE→WS→BE→CRE→LLM)
- v65.5: Agent Builder Wizard UI (centerAgentWizard, simple + advanced mode)
- Zbývá (~10 items): Specialist CRUD wizard, Stage/Unstage v working tree, Cumulative "Approve All", Delegace mezi agenty v logu, Plugin systém pro sidebar

### Pilíř 6: PRODUKT — 25% ✅ (upgrade z 8%)
**Status: F1-F3 DONE (v65.7). 3 moduly napojeny do server.js.**
- **Setup wizard** (399 ř.) — first-run detection, /api/setup/* routes ✅ (v65.7)
- **Auto-updater** (341 ř.) — startUpdateChecker() v server.listen(), graceful stop ✅ (v65.7)
- **License system** (348 ř.) — LicenseManager singleton, /api/license/status, FREE tier feature gates ✅ (v65.7)
- **INSTALL.md** — manuální 7-sekční příručka
- Shell sandbox + secrets auth
- Chybí: installer, Electron builder dist

---

## Co přibylo od v4 roadmapy

| Verze | Změna |
|-------|-------|
| v63.0 | Merge Engine v2 — multi-expertise composition (max 3) |
| v63.0 | 5D Capability System — per-expert vektory, kompatibilita |
| v63.0 | conversation_expertises tabulka (N:M, max 3) |
| v63.1 | Capability modifiers — runtime vliv 5D vektoru |
| v63.1 | Expertise Wizard UI — IDE formulář pro tvorbu expertiz |
| v63.3 | ExecutionTrace — UUID per turn, LLM log, prompt hash |
| v63.3 | Expert Sandbox — offline simulace |
| v64.0 | **CRE Gatekeeper** — single-authority enforcement |
| v64.0 | Schema migrations (5 souborů, timestamp-based) |
| v64.0 | cre_override_log tabulka |
| v65.2 | **Lifecycle BUILD hardening** — real test exec, FAIL default, hard size limits |
| v65.3 | **Project conversation restore** — lifecycle bind, stale guard |
| v65.4 | **Project context injection** — CRE hint, sanitized prompt, IDE→LLM pipeline |
| v65.4 | **Instalační příručka** — INSTALL.md (BE + IDE + Docker) |
| v65.5 | **Agent Builder Wizard (B9)** — FE wizard UI + BE schema endpoint + normalizeAgentDefinition |
| v65.6 | **Lifecycle session routing fix** — RAM lookup by projectId, Tier 1/2/3 hardening |
| v65.6 | **CZ locative/dative/instrumental** — project-self query patterns + CRE classifier |
| v65.7 | **F1: Setup Wizard wired** — first-run detection, /api/setup/* routes, createSetupRoutes(wizard, deps) |
| v65.7 | **F2: Auto-updater wired** — startUpdateChecker() v server.listen(), stopUpdateChecker() v shutdown |
| v65.7 | **F3: License system wired** — LicenseManager singleton, /api/license/status, FREE tier feature gates |
| v65.8 | **D1: Specialist Runtime** — ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime, accountant registered |
| v65.8 | **D2: Knowledge Base** — 3 DB tables (knowledge_facts, knowledge_sources, knowledge_verification_log), KnowledgeBase class, seedTaxRates (96 facts) |
| v65.8 | **D3: Scenario Engine** — ScenarioRegistry, ScenarioRunner, accountant tax optimization scenario (5 steps) |

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
Fáze A: CHAT       ██████████████████████████████████████████  100% → DONE (A7 ✅ v65.7)
Fáze C: PROJEKTY   ██████████████████████████████████████████  100% → DONE (C3 ✅ v65.7)
Fáze D-int: ÚČETNÍ ██████████████████████████████████████████  100% → DONE
Fáze B: WORKERI    ██████████████████████████████████████░░░░   95% (B0-B9 done, B8 template ✅)
Fáze H: HARDENING  ██████████████████████████████████████████  100% (9/9 DONE)
Fáze D: SPECIALISTÉ██████████████████████████░░░░░░░░░░░░░░░░   65% (D1-D3 done, v65.8)
Fáze E: IDE        ██████████████████████████████░░░░░░░░░░░░   73% (Phase 1-5, 33 extensions)
Fáze F: BALÍČKOVÁNÍ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   25% (F1-F3 wired, v65.7)
```

---

## Doporučené pořadí práce

### Sprint 1 — Integrace F modulů ✅ (DONE v65.7)

```
✅→ F1. Napojit Setup Wizard — first-run detection + /api/setup/* routes
✅→ F2. Napojit Auto-updater — startUpdateChecker() v server.listen()
✅→ F3. Napojit License system — feature gates na PRO/ENTERPRISE funkce
✅→ A7. Expert A/B test — 5 domén, expert win/tie 5/5 (v65.7)
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

### Sprint 4+ — Remaining Specialists, IDE, Packaging

- Fáze D: D4-D9 specialist memory, multi-specialist routing, advanced scenarios (~3 týdny)
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
| 7 | A | A7. Expert A/B kvalitativní test | 1d | 🟡 P1 | ✅ DONE (v65.7) |
| 8 | C | C3. Reálný LLM test lifecycle | průběžně | 🟡 P1 | ✅ DONE (v65.7) |
| 9 | E | E1. IDE: Specialist CRUD wizard | 2-3d | ⚪ P2 | ❌ |
| 10 | E | E2-E10. IDE: zbývající items (~10) | ~2 týd. | ⚪ P2 | ❌ |
| 11 | D | D1. Specialist Runtime | 1d | ⚪ P2 | ✅ DONE (v65.8) |
| 12 | D | D2. Knowledge Base | 1d | ⚪ P2 | ✅ DONE (v65.8) |
| 13 | D | D3. Scenario Engine | 1d | ⚪ P2 | ✅ DONE (v65.8) |
| 14 | D | D4–D9 Specialist advanced | ~3 týd. | ⚪ P2 | ❌ |
| 15 | F | F4–F6 Electron builder + installer | ~2 týd. | ⚪ P2 | ❌ |

---

## Celkový progres

**Hotovo:** ~97% celkové vize (upgrade z 96%)
**Nové od v9:** v65.8 — D1 Specialist Runtime, D2 Knowledge Base, D3 Scenario Engine

```
Celkem zbývajících úkolů:  4
  🔴 Critical:              0
  🟡 Important:             0  (všechny P1 hotové!)
  ⚪ Future (D4-D9,E,F):     4  (~2 měsíce)
```

---

*Tento dokument nahrazuje Roadmapa v9 (v65.7).
Nové ve v10: D1 Specialist Runtime (ToolRegistry + IntentDetector + ToolExecutor, 23 tests),
D2 Knowledge Base (3 DB tables, KnowledgeBase class, 96 seeded tax facts, 35 tests),
D3 Scenario Engine (ScenarioRegistry + ScenarioRunner, accountant tax optimization, 42 tests).
Specialist 40%→65%. Celkový progres 97%.*
