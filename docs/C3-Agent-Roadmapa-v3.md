# C3-Agent — Aktualizovaná Roadmapa v3

## Od aktuálního stavu k tvé vizi

**Datum:** 2026-02-12
**Verze kódu:** v62 (po Phase C lifecycle engine + Phase A audit + Q fix + modularizace B/C/D + C1/C4/D-int5)
**Testy:** 1700+ ověřených (1193 non-DB + 512 lifecycle = 1705 posledních regresí)

---

## Tvá vize — 4+2 pilíře

### Pilíř 1: CHAT — náhrada ChatGPT
Kvalitní konverzační AI s generováním dokumentů a expertní specializací.
Umí odpovídat přesně, v kontextu, ve správném jazyce, s podklady.

### Pilíř 2: PROJEKTY — stavění věcí
Lifecycle engine: SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED.
Milníkový build s drift detection, scope enforcement, health scores.

### Pilíř 3: WORKERI — autonomní hlídací psi
Běží na pozadí 24/7. Sledují web, počasí, nabídky, zprávy.
Posílají notifikace (email, Telegram, SMS) když se něco stane.

### Pilíř 4: SPECIALISTÉ — komplexní on-demand agenti
Účetní, správce domácnosti, AI researcher. Kombinují expertní znalosti,
nástroje, rutiny a paměť. Nejsou jen chat persona — umí generovat
faktury, kontrolovat zákony, navrhovat jídelníčky.

### Pilíř 5: IDE — vlastní vývojové prostředí
Eclipse Theia s custom panely: Chat, Agent Log, Diff Viewer, Terminal.
Nahrazuje webUI. Čistá separace konverzace / agent activity / terminál.

### Pilíř 6: PRODUKT — balíčkování a ochrana
Instalovatelná aplikace (ne `npm start`). Ochrana zdrojového kódu.
Licenční systém. Setup wizard.

---

## Kde je každý pilíř dnes (v60)

### Pilíř 1: CHAT — 95% ✅

| Co funguje | Co zbývá |
|------------|----------|
| ✅ CRE routing (11 intentů, 401 testů) | ⚠️ Expert domain prompty — neověřená kvalita |
| ✅ Safety engine (4 domény) | |
| ✅ Quality pipeline K5.1–K5.5 | |
| ✅ Output gate D6 (zombie, density, intent) + 45+22 testů | |
| ✅ Export MD/HTML/TXT/PDF/DOCX/XLSX | |
| ✅ Language detection (7 jazyků) | |
| ✅ Language enforcement (post-response gate) | |
| ✅ Response sanitization (JSON leak removal) | |
| ✅ Confidence styling (hedging phrases) | |
| ✅ fetchPage quality (paywall, boilerplate, smart truncation) | |
| ✅ Auto-retry search (4 reformulační strategie) | |
| ✅ Local handler i18n (datum/čas v jazyce uživatele) | |
| ✅ Conversation store (DB) | |
| ✅ Context budget per intent | |
| ✅ Query canonicalizer | |
| ✅ Expert routing + enforcement + memory | |
| ✅ HTTP hardening (CORS, secrets auth, shell sandbox) | |
| ✅ WS event streaming | |
| ✅ PDF export (Python reportlab, česká diakritika) | |
| ✅ DOCX export (npm docx, Calibri, multi-language) | |
| ✅ XLSX export (exceljs) | |

**Zbývá:** Pouze A7 kvalitativní ověření expert promptů (ne kódová práce).
**Status: PHASE A = DONE.**

### Pilíř 2: PROJEKTY — 95% ✅

| Co funguje | Co chybí |
|------------|----------|
| ✅ Lifecycle engine: SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED | ⚠️ Reálný test s LLM (ne fakeLLM) |
| ✅ Per-milestone execution s DI (callLLM + executor) | |
| ✅ Scope enforcement (file-level validation) | |
| ✅ Health scores (scope, tests, complexity, debt) | |
| ✅ Drift detection (4 check types) | |
| ✅ Change management (propose/approve/reject) | |
| ✅ Roadmap versioning (v1→v2 na schválenou změnu) | |
| ✅ Git auto-commit per milestone | |
| ✅ Milestone retry (scope violation → fix → retry) | |
| ✅ Project review (configurable frequency) | |
| ✅ 512 lifecycle testů, 55 E2E konverzačních | |
| ✅ formatSpec/formatRoadmap/formatReview bez bugů | |
| ✅ BUILD → COMPLETED state transition | |
| ✅ Crash recovery — DB write-through + preload (C1) | |
| ✅ 13 API endpoints v server.js (C2) | |
| ✅ Multi-session projekty — auto-detect + bind (C4) | |

**Zbývá:** Pouze C3 reálný LLM test (ne kódová práce).
**Status: PHASE C = téměř DONE.**

### Pilíř 3: WORKERI — 50%

| Co funguje | Co chybí |
|------------|----------|
| ✅ Agent runner + scheduler | ❌ RSS/Atom source adapter |
| ✅ Auto-start z DB | ❌ Multi-source agent |
| ✅ Edge detection | ❌ Agent builder wizard (konverzační tvorba) |
| ✅ Conditions (compare, contains, new_items) | ❓ E2E doručení (email reálně odejde?) |
| ✅ URL source + schema extraction | ❓ E2E doručení (Telegram reálně dojde?) |
| ✅ Webhook action | |
| ✅ LLM-generated notifikace | |
| ✅ Notification channels kód (email, Telegram) | |
| ✅ Notification pipeline + policy + digest | |
| ✅ Trust tracking + feedback (34 testů) | |
| ✅ Agent secrets (API klíče) | |

**Klíčový otazník:** Notification kód existuje a má testy, ale nebylo
ověřeno E2E (reálný email na inbox, reálná Telegram zpráva na telefon).

### Pilíř 4: SPECIALISTÉ — 30%

| Co funguje | Co chybí |
|------------|----------|
| ✅ Expert personas + store + DB | ❌ Specialist Contract (nová entita ≠ expert) |
| ✅ Expert handler + routing | ❌ Specialist Runtime |
| ✅ Expert memory (cross-session) | ❌ Document generator (PDF faktury) |
| ✅ Tool enforcement guard (41 testů) | ❌ Knowledge base per specialista |
| ✅ ACCOUNTANT-PILOT-SPEC.md | ❌ Routine engine (sub-workery) |
| ✅ tax-rates.js, tax-calc.js, vat-calc.js | ❌ Specialist builder |
| ✅ salary-calc.js, deadline-checker.js | ⚠️ Tool registration + dispatch |
| ✅ rate-verifier.js (monitoring agent) | ⚠️ Enhanced accountant systemPrompt |
| ✅ 81 accountant testů | |
| ✅ INTEGRATION-GUIDE.md (6 kroků) | |

### Pilíř 5: IDE — 0% runtime, 100% příprava

| Co je hotovo | Co zbývá |
|--------------|----------|
| ✅ IDE Roadmap v3 (1754 řádků, 8 sprintů) | ❌ Sprint 0–7 implementace |
| ✅ Sprint 0–7 kód existuje (ZIPy, review done) | ❌ Theia runtime build + deployment |
| ✅ Architektonické kontrakty definovány | |
| ✅ WS bridge backend ready (41 testů) | |
| ✅ Backend security hardened (61 testů) | |

### Pilíř 6: PRODUKT — 5%

| Co je hotovo | Co chybí |
|--------------|----------|
| ✅ Shell injection fix | ❌ Installer (Electron/Docker/pkg) |
| ✅ Command whitelist + sandbox | ❌ Auto-updater |
| ✅ Secrets API auth | ❌ Source code obfuskace |
| ✅ LLM Gateway auth tokens | ❌ License key / activation system |
| | ❌ Setup wizard |
| | ❌ API rate limiting |

---

## Co se změnilo od v2 (2026-02-09 → 2026-02-12)

### Phase C: Lifecycle Engine — IMPLEMENTED
Kompletní lifecycle engine s 9 novými moduly:
- `src/planner/lifecycle.js` — ProjectLifecycle class, state machine, DI
- `src/planner/lifecycle-spec.js` — Interactive spec generation
- `src/planner/lifecycle-planning.js` — Roadmap generation + versioning
- `src/planner/lifecycle-build.js` — Per-milestone execution, scope enforcement, health
- `src/planner/lifecycle-review.js` — 4-type drift detection
- `src/planner/lifecycle-change.js` — Change management pipeline
- `src/chat/handlers/lifecycle-router.js` — Phase routing state machine
- `src/chat/handlers/lifecycle-state.js` — Handoff state CRUD
- `src/chat/handlers/lifecycle-formatters.js` — User-facing formatters

5 DB tabulek: lifecycle, milestones, change_requests, roadmap_versions, drift_checks

**Testy:** 512 lifecycle + 55 E2E konverzačních = 567 nových testů

### Phase A: AUDIT — Většina už byla implementována
Audit kódu odhalil, že Phase A items A1–A9 a Phase Q items Q1/Q4/Q5
už byly implementovány a napojeny do pipeline:
- fetch-quality.js (A1) ← web-search.js
- search-retry.js (A2) ← web-search.js
- confidence-styling.js (A3) ← synthesis.js via quality/
- pdf-exporter.js+.py (A5) ← export-pipeline.js
- docx-exporter.js (A6) ← export-pipeline.js
- language-enforcement.js (Q1) ← controller.js + synthesis.js
- local-i18n.js (Q4) ← handlers/local.js
- response-sanitizer.js (Q5) ← controller.js

**Žádný z těchto modulů není mrtvý kód — všechny jsou aktivně wired in.**

### Modularizace B/C/D — v60.2 (2026-02-12)

Phase B (Workers), Phase C (Projects/Lifecycle), Phase D (Specialists) jsou nyní
**odpojitelné moduly**. Core chat funguje bez nich. Řízeno feature flags:

```
C3_ENABLE_AGENTS=false    → Phase B (Workers) disabled
C3_ENABLE_LIFECYCLE=false → Phase C (Projects) disabled
C3_ENABLE_EXPERTS=false   → Phase D (Specialists) disabled
```

**Změněné soubory (6):**

| Soubor | Změna |
|--------|-------|
| `src/config.js` | Feature flags (`config.features.agents/lifecycle/experts`) |
| `src/chat/handlers/index.js` | Expert/agent handlers → conditional try-catch loading |
| `src/chat/handlers/conversation.js` | 4 hard importy → lazy loading + null guards |
| `src/chat/handlers/build-handoff.js` | `WorkflowState` → lazy loading |
| `src/server.js` | Agent platform init → `if (AgentRepository)`, agent routes → 501 when disabled, scheduler → guarded |
| `src/executor/tool-executor.js` | Expert tools (tax, vat, salary, deadline) → lazy loading |

**Architektura:**
- Všechny B/C/D moduly se načítají přes `await import()` uvnitř try-catch bloků
- Pokud modul chybí nebo je feature disabled → graceful fallback (null handler, 501 response)
- Core (CRE, conversation, project, quality pipeline, exports) funguje nezávisle
- 0 nových regresi — všechny existující testy prošly beze změn

### C1: Crash Recovery — IMPLEMENTED (v62)

DB-backed lifecycle handoff state pro přežití restartu serveru:
- Nová tabulka `lifecycle_handoff_state` (session_id, phase, lifecycle_id, ...)
- `setLcState()` / `clearLcState()` → RAM + DB write-through
- `preloadActiveLifecycles()` na startupu — restore RAM z DB
- `projectPath` propagace v lifecycle-router.js

**Soubory:** database.js, lifecycle-state.js, lifecycle-router.js, server.js

### C4: Multi-session projekty — IMPLEMENTED (v62)

Nový chat session automaticky detekuje existující aktivní lifecycle:
- ALTER TABLE `project_lifecycles` + `active_session_id`
- Auto-detect intercept v conversation.js (před lifecycle handoff)
- `bindSessionToLifecycle()` — váže session k lifecycle v DB
- Restore handoff state z předchozí session

**Soubory:** database.js, lifecycle-state.js, conversation.js, lifecycle-router.js

### D-int5: Rate Monitor Auto-registrace — IMPLEMENTED (v62)

Example agenti se automaticky registrují na startupu serveru:
- Čte `src/agents/examples/*.json` definice
- Idempotentní — přeskakuje existující agenty (`getAgent(id)` check)
- Plánuje cron agenty přes `agentScheduler.scheduleAgent()`

**Soubor:** server.js (~20 řádků)

### Opravené bugy
- BUILD → COMPLETED state transition (lifecycle zůstával v BUILD po dokončení)
- formatSpec() `[object Object]` → `renderItem()` helper
- formatRoadmap() `?.` → parsování sequence z index+1
- formatReview() `?` drift checks → `assessResult()` v checks array

---

## Roadmapa — co zbývá

### ~~Fáze Q: QUALITY FIXES~~ — 100% HOTOVO ✅

```
✅ Q1. Language enforcement — language-enforcement.js wired in controller + synthesis
✅ Q2. CRE routing: EN "thanks" → CONVERSATIONAL — isGratitudeOrFarewell(), 39 testů
✅ Q3. CRE routing: code request → CODE — isCodeRequest(), 22 testů
✅ Q4. Local handler i18n — local-i18n.js wired in handlers/local.js
✅ Q5. Response sanitization — response-sanitizer.js wired in controller.js
✅ Q6. Nodiacritics tolerance — 3 úrovně (patterns, normalizeForClassification, language instruction)
✅ Broken test soubory opraveny (output-gate 45/45, synthesis-hardening 22/22)
```

**Status: PHASE Q = DONE.**

---

### ~~Fáze A: CHAT dokončení~~ — 95% HOTOVO ✅

```
✅ A1. fetchPage quality — fetch-quality.js (paywall, boilerplate, smart truncation)
     47 testů passing (search-quality-a123.test.js)
✅ A2. Auto-retry search — search-retry.js (4 reformulační strategie)
     Integrováno do web-search.js, 13 testů
✅ A3. Confidence styling — confidence-styling.js
     Integrováno přes quality/index.js → synthesis.js, 11 testů
✅ A4. HTTP hardening — DEV A security branch (merged)
✅ A5. PDF export — pdf-exporter.js + pdf-exporter.py (reportlab, české fonty)
     22 testů passing (export-pdf-docx.test.js)
✅ A6. DOCX generování — docx-exporter.js (npm docx, Calibri, multi-language)
     22 testů passing
✅ A7. Expert domain prompty — expert.js + enforcement + synthesis hints
     Wired in, kvalita neověřena A/B testem
✅ A8. Expert paměť — expert_memory tabulka v DB, cross-session kontext
✅ A9. Legacy cleanup — done
```

**Status: PHASE A = DONE.** Zbývá pouze A7 kvalitativní ověření (ne kódová práce).

---

### ~~Fáze D-int: ÚČETNÍ INTEGRACE~~ — 100% HOTOVO ✅

```
✅ D-int1. Tool registration — expert-layer.js, 6 tools v src/experts/tools/
✅ D-int2. Tool dispatch — expert.js detector→tool→expert wrap pipeline
✅ D-int3. Enhanced accountant systemPrompt — memory injection + tool enforcement
✅ D-int4. Memory change awareness — previous value tracking + history
✅ D-int5. Rate monitor agent — auto-registrace z src/agents/examples/ na startupu
✅ D-int6. E2E test — accountant-e2e (388 řádků) + accountant-tools (719 řádků)
```

**Status: PHASE D-int = DONE.**

---

### Fáze B: WORKERI — notifikace a zdroje (2–3 týdny)
**Cíl:** Aspoň 3 agenti běží 24/7 a reálně posílají notifikace.

```
Týden 1:
  ❌ B0. E2E verifikace existujícího kódu                           [1 den]
  ❌ B4. Push channel (ntfy.sh nebo Pushover)                        [1 den]
  ❌ B5. RSS/Atom source adapter                                     [2 dny]

Týden 2:
  ❌ B6. Multi-source agent                                          [2 dny]
  ❌ B9. Agent builder wizard                                        [3 dny]

Týden 3:
  ❌ B8. Testování 3 reálných workerů                                [1 týden]
```

**Co je HOTOVO z původní Fáze B:**
- ~~B1. Notification Service~~ ✅
- ~~B2. Email channel~~ ✅ (E2E neověřeno)
- ~~B3. Telegram channel~~ ✅ (E2E neověřeno)
- ~~B7. Agent health dashboard~~ ✅

**Beze změny od v2.**

---

### ~~Fáze C: PROJEKTY~~ — 95% HOTOVO ✅

```
✅ Lifecycle engine — SPEC→PLANNING→BUILD→REVIEW→CHANGE→COMPLETED
✅ Per-milestone execution s DI, scope enforcement, health scores
✅ Drift detection (4 check types), change management, roadmap versioning
✅ 567 testů (512 unit + 55 E2E konverzační)
✅ BUILD → COMPLETED state transition
✅ C1. Crash recovery — DB write-through + preload na startupu (lifecycle_handoff_state tabulka)
✅ C2. Server.js API endpoints pro lifecycle — 13 endpointů (již existovaly)
✅ C4. Multi-session projekty — auto-detect active lifecycle + session binding

❌ C3. Reálný test s LLM (ne fakeLLM)                               [průběžně]
```

**C1 implementace:** Nová tabulka `lifecycle_handoff_state`, write-through v setLcState/clearLcState,
preloadActiveLifecycles() na startupu. Soubory: database.js, lifecycle-state.js, server.js.

**C4 implementace:** ALTER TABLE `project_lifecycles` + `active_session_id`, auto-detect intercept
v conversation.js, bindSessionToLifecycle(). Nový session → detekuje aktivní lifecycle → obnoví handoff stav.

**Milestone:** E2E test pokrývá celý flow: detekce projektu → spec → planning → 3 milníky
s scope violation + retry → change management (reject) → review → COMPLETED.

---

### Fáze E: IDE — Eclipse Theia deployment (8 sprintů, ~2 měsíce)
**Beze změny od v2.**

### Fáze D: SPECIALISTÉ — architektura + pilot (6–8 týdnů)
**Beze změny od v2.**

### Fáze F: BALÍČKOVÁNÍ + OCHRANA (2–3 týdny)
**Beze změny od v2.**

---

## Aktualizovaný timeline

```
Fáze Q: QUALITY    ██████████████████████████████████████  100% → DONE
Fáze A: CHAT       ██████████████████████████████████████  95% → DONE
Fáze C: PROJEKTY   ████████████████████████████████████░░  95% → téměř DONE
Fáze D-int: ÚČETNÍ ██████████████████████████████████████  100% → DONE
Fáze B: WORKERI    ██████████████████░░░░░░░░░░░░░░░░░░░░  50%
Fáze D: SPECIALISTÉ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  30%
Fáze E: IDE        ████████████████████░░░░░░░░░░░░░░░░░░  50% (kód existuje, runtime ne)
Fáze F: BALÍČKOVÁNÍ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5%
```

**Hotovo dnes (2026-02-12):**
1. ✅ Broken test soubory opraveny (output-gate 45/45, synthesis-hardening 22/22)
2. ✅ Q2/Q3/Q6 ověřeny v CRE — vše implementováno a otestováno
3. ✅ quality.js: přidán empty structure detector
4. ✅ output-gate.js: přidány zombie patterns (process narration, hollow filler, capability denial)
5. ✅ Regrese: 1193 non-DB testů, 0 failures
6. ✅ **Modularizace B/C/D** — feature flags, lazy loading, null guards (6 souborů)
7. ✅ Smoke test: core bez B/C/D funguje (conversation + project only)
8. ✅ Regrese po modularizaci: 0 nových failures
9. ✅ **D-int5: Rate monitor auto-registrace** — server.js čte src/agents/examples/*.json, idempotentní
10. ✅ **C1: Crash recovery** — lifecycle_handoff_state tabulka, DB write-through, preload na startupu
11. ✅ **C4: Multi-session projekty** — active_session_id, auto-detect intercept v conversation.js
12. ✅ Regrese po C1/C4/D-int5: 0 nových failures (1193+ non-DB testů)

**Další logický krok:**
- Fáze B (worker E2E verification) — 1 den pro realitu check
- nebo C3 reálný LLM test — průběžně
- nebo Fáze E (IDE Theia runtime)

---

## Aktualizovaný task list (zbývající úkoly)

| # | Fáze | Úkol | Effort | Status |
|---|------|------|--------|--------|
| 1 | C | C3 Reálný LLM test | průběžně | ❌ |
| 2 | B | B0 E2E notification verification | 1d | ❌ |
| 3 | B | B4 Push channel (ntfy.sh) | 1d | ❌ |
| 4 | B | B5 RSS/Atom source adapter | 2d | ❌ |
| 5 | B | B6 Multi-source agent | 2d | ❌ |
| 6 | B | B9 Agent builder wizard | 3d | ❌ |
| 7 | B | B8 Worker: počasí → Telegram | 2d | ❌ |
| 8 | B | B8 Worker: reality → email | 2d | ❌ |
| 9 | B | B8 Worker: zprávy RSS → digest | 2d | ❌ |
| 10 | E | Sprint 0–7 Theia runtime | ~2 měsíce | ❌ |
| 11 | D | D1–D9 Specialist platform | ~8 týdnů | ❌ |
| 12 | F | F1–F6 Balíčkování | ~3 týdny | ❌ |

**Celkem hotovo:** ~78% celkové vize (v2 bylo ~55%, v3.0 bylo ~65%, v3.1 bylo ~68%, v3.2 bylo ~73%, v3.3 bylo ~75%)
**Klíčový posun:** Phase C 85%→95% (C1+C2+C4), Phase D-int 95%→100%, Modularizace B/C/D 100%

---

*Tento dokument nahrazuje C3-Agent-Roadmapa-v2.md (v59.0, 2026-02-09).
Aktualizováno o: Phase C lifecycle engine (567 testů), Phase A audit (vše implementováno),
opravy formátovacích bugů, BUILD→COMPLETED fix.
v3.1 (2026-02-12): Phase Q 100% done, broken testy opraveny, regrese 1705 testů.
v3.2 (2026-02-12): Modularizace B/C/D — feature flags, lazy loading, 6 souborů změněno, 0 regresi.
v3.3 (2026-02-12): C1 crash recovery (DB write-through), C4 multi-session (auto-detect+bind),
D-int5 rate monitor auto-registrace. Phase C→95%, Phase D-int→100%. 0 nových regresi.*
