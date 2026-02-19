# C3 Changelog

---

## v65.8 — D1-D3 Specialist Platform: Runtime + Knowledge Base + Scenarios (2026-02-19)

**Testy:** 401 CRE + 43 GK + 52 pipeline + 81 accountant + 41 enforcement + 23 specialist + 35 knowledge + 42 scenario + 125 quality + 100 design = 943+ PASS

Phase D specialist platform: three new modules building the foundation for tool-augmented expert domains.

### D1: Specialist Runtime

- **ToolRegistry** — specialist → tools mapping with lazy module loading, module cache
- **IntentDetector** — pattern-based routing: user input → tool match (priority-sorted)
- **ToolExecutor** — deterministic tool execution, adapter support, knowledge base injection point
- **SpecialistRuntime** — orchestrator: `tryToolExecution(expertId, input)` → detect → execute → result
- **Accountant registered** — 5 tools (compare, VAT, salary, deadline, tax) with inline extractors
- **expert.js integration** — replaced hardcoded `executeAccountantTool()` with generic `executeSpecialistTool()`

### D2: Knowledge Base

- **DB migration 007** — 3 new tables: `knowledge_facts`, `knowledge_sources`, `knowledge_verification_log`
- **KnowledgeBase class** — `getFact()`, `getCategory()`, `getRatesForYear()`, `checkFreshness()`, `setFact()`, `bulkSetFacts()`
- **Verification sources** — `setSource()`, `listSources()`, `logVerification()`
- **seedTaxRates()** — imports 96 facts from static RATES constant (2024 + 2025)
- **Freshness check** — detects stale/provisional facts with configurable tolerance

### D3: Scenario Engine

- **ScenarioRegistry** — stores scenario definitions, trigger detection per specialist
- **ScenarioRunner** — state machine: INTRO → COLLECTING → COMPUTING → PRESENTING → RECOMMENDING → COMPLETED
- **Phase handlers** — data collection with extraction/validation/skip/default, adjustment loop, cancel
- **Accountant Tax Optimization** — 5-step guided workflow (income, entity, expenses, year, children)
- **Tool integration** — `compute()` calls `calculateTax()` + `compareTaxEntities()`, `present()` formats markdown

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/experts/specialist-runtime.js` | NEW — ToolRegistry, IntentDetector, ToolExecutor, SpecialistRuntime |
| `src/experts/knowledge-base.js` | NEW — KnowledgeBase class, seedTaxRates, getKnowledgeBase singleton |
| `src/experts/scenario-engine.js` | NEW — ScenarioRegistry, ScenarioRunner, accountant tax optimization |
| `src/db/migrations/007_knowledge_base.js` | NEW — knowledge_facts, knowledge_sources, knowledge_verification_log |
| `src/chat/handlers/expert.js` | Replaced hardcoded accountant routing with SpecialistRuntime |
| `tests/specialist-runtime.test.js` | NEW — 23 tests (registry, intent, execution, custom) |
| `tests/knowledge-base.test.js` | NEW — 35 tests (CRUD, seed, freshness, sources, bulk) |
| `tests/scenario-engine.test.js` | NEW — 42 tests (registry, triggers, phases, E2E accountant) |
| `docs/ROADMAP.md` | v10: D1-D3 DONE, Specialists 40%→65%, progres 97% |

---

## v65.7 — F1-F3 Integration + A7 Expert A/B + C3 Lifecycle LLM Test (2026-02-19)

**Testy:** 401 CRE + 43 GK + 52 pipeline + 58 fixes + 100 design + 45 quality + 21 sprint-D = 720 PASS, 0 failures

Napojení tří Phase F modulů (dříve dead code) do server.js. Všechny 3 moduly nyní aktivní.

### F1: Setup Wizard Integration

- **First-run detection** — `SetupWizard.isComplete()` na startup, log pokud setup není dokončen
- **API routes** — `/api/setup/status`, `/api/setup/ollama`, `/api/setup/language`, `/api/setup/notifications`, `/api/setup/license`, `/api/setup/complete`
- **Route handler fix** — `createSetupRoutes(wizard, deps)` nyní přijímá `deps` s `sendJSON`/`parseBody` (oprava signature mismatch)
- **Health check** — `setupComplete` field v `GET /` response

### F2: Auto-updater Integration

- **Background checker** — `startUpdateChecker()` volán v `server.listen()` (jen pokud `C3_UPDATE_REPO` nastaveno)
- **Update notification** — log nové verze s release URL
- **Graceful shutdown** — `stopUpdateChecker()` v shutdown handleru
- **Dynamic version** — `getCurrentVersion()` z package.json místo hardcoded stringu

### F3: License System Integration

- **LicenseManager singleton** — inicializace na startup, tier + valid log
- **API endpoint** — `GET /api/license/status` — tier, features, expiry, owner
- **Feature gates** — FREE tier blokuje agent/worker/scheduler routes (403 s upgrade hint)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/server.js` | F1 import+init+routes, F2 import+startChecker+stopChecker, F3 import+init+gates+API |
| `src/setup/wizard.js` | `createSetupRoutes(wizard, deps)` — server.js compatible handlers |
| `docs/ROADMAP.md` | v9: F1-F3 + A7 + C3 DONE, Chat 100%, Projekty 100%, progres 96% |
| `docs/CHANGELOG.md` | v65.7 entry |
| `tests/expert-ab-quality.test.js` | A7: Expert A/B quality test — 5 domén, Ollama E2E |
| `tests/lifecycle-real-llm.test.js` | C3: Real LLM lifecycle E2E — 10/10 PASS |

### A7: Expert A/B Quality Test

- **5 domén** testovaných: writer, analyst, lawyer, developer, accountant
- **Expert vs General** — each prompt sent to Ollama twice (expert system prompt vs generic)
- **Scoring**: word count, domain keywords, Czech language, zombie/deflection, disclaimer presence
- **Výsledek**: Expert win/tie **5/5** domén — expert nikdy neškodí, pomáhá u lawyer (disclaimer)

### C3: Real LLM Lifecycle Test

- **E2E proti běžícímu serveru** s reálnými Ollama voláními
- **Testovaný flow**: project create → lifecycle start (SPEC) → provide requirements → state check → progress inquiry
- **Výsledek**: 10/10 PASS — celý pipeline funkční s qwen2.5:32b

---

## v65.6 — Lifecycle Session Routing Fix + Conversation Hardening (2026-02-19)

**Testy:** 789+ verified deterministic (23+58+52+43+45+94+125+92+103+83+71), 0 failures

Oprava kritického bugu: lifecycle SPEC fáze nebyla routována správně kvůli sessionId mismatch mezi IDE lifecycle/start (`session-0`) a WS chat zprávami (`ws-<random>`). Doplněna robustní conversation handler hardening (Tier 1/2/3 fixes).

### Lifecycle SessionId Mismatch Fix

- **RAM lookup by projectId** — `getLcStateByProject(projectId)` najde lifecycle stav v RAM pod jakýmkoli sessionId a migruje ho na aktuální WS session
- **Proper lifecycle ID generace** — lifecycle/start nyní generuje `lc-<timestamp>-<random>` místo NULL
- **`bindSessionToLifecycle()`** — voláno při startu, správná vazba session→lifecycle
- **DB fallback zachován** — když RAM nemá match, fallback na `project_lifecycles` tabulku

### Conversation Handler Hardening (Tier 1/2/3)

- **Tier 1:** 14 oprav v conversation.js — null safety, context propagation, error handling
- **Tier 2:** Lifecycle intercept robustnost — auto-detect přes RAM + DB dual path
- **Tier 3:** Edge case handling pro stale sessions a concurrent access

### Dokumentace

- **CLAUDE.md** — kompletní přepis: 73,706 lines / 188 files statistiky, API endpoint reference, contract #10
- **ARCHITECTURE.md** — aktualizace: 53 DB tables, routes/ directory, lifecycle C4 session routing, test counts
- **CHANGELOG.md** — v65.6 entry

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/chat/handlers/conversation.js` | RAM lookup by projectId + state migration (lines 288-314) |
| `src/routes/projects.js` | lifecycle/start: generovat lifecycle ID, uložit do RAM stavu (lines 301-321) |
| `CLAUDE.md` | Kompletní přepis na v65.6 |
| `docs/ARCHITECTURE.md` | Aktualizace na v65.6 |
| `docs/CHANGELOG.md` | v65.6 entry |

---

## v65.5 — Agent Builder Wizard (B9) (2026-02-15)

**Testy:** ~1300 passing (805 ověřeno, žádné regrese)

Agent Builder Wizard — kompletní UI pro tvorbu a editaci worker agentů v IDE. Backend single source of truth pro presety a validaci.

- **`GET /api/agents/schema`** — nový endpoint vracející typy (MONITOR/HUNTER/TRACKER/DIGEST/SCOUT), typeDescriptions, allowed values, limits, a **presety** z backendu (ne hardcoded v FE)
- **`normalizeAgentDefinition()`** — backend helper (~75 řádků): regeneruje unikátní ID (src→cond→trig), remapuje cross-reference (triggers→conditions→sources), validuje referenční integritu, clampuje cooldown/max_fires do limitů
- **Dry-run normalizace** — `POST /api/agents/dry-run` nyní volá `normalizeAgentDefinition()` před `agentRunner.dryRun()`
- **FE: `_agentWizard` state** — kompletní lifecycle: `_awOpen/Close/Save/DryRun/TestRun`, `_awApplyPreset(typeId)`
- **FE: `centerAgentWizard()`** — dual-mode UI:
  - **Simple mode** (3 kroky): Základ → Rozvrh & Zdroje → Podmínky & Akce
  - **Advanced mode** (5 collapsible sekcí): Basic, Schedule, Conditions/Triggers, Actions, Preview/Test
- **Auto dry-run před save** — `_awSave()` vždy volá dry-run; při `valid:false` zobrazí chyby a neuloží
- **ID collision handling** — backend vrací 409 na duplicitní ID; FE připojí timestamp suffix a opakuje
- **Integrace**: `_addNew('workers')` → wizard, Editovat handler pro workers → fetch + `_awOpen('edit',...)`

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/routes/agents.js` | +`GET /api/agents/schema`, normalize v dry-run (~90 řádků) |
| `src/agents/schema.js` | +`normalizeAgentDefinition()` (~75 řádků) |
| `c3-ide/.../chat-panel-module.js` | +agent wizard state, funkce, rendering (~350 řádků) |

---

## v65.4 — Project Context Injection (2026-02-15)

- **CRE hint `[[PROJECT_CONTEXT:...]]`** — projekt metadata injected do LLM pipeline
- **`buildProjectContext()`** — sanitized system prompt s project info
- **IDE→WS→BE→CRE→LLM pipeline** — `projectId` přenášen celým řetězcem

---

## v65.3 — Project Conversation Restore (2026-02-15)

- **Lifecycle bind** při otevření projektu — automatická vazba konverzace na projekt
- **Stale guard** — ochrana proti obnově zastaralých konverzací
- **Scroll position** — zachování pozice scrollu při restore
- **INSTALL.md** — kompletní instalační příručka (BE + IDE + Docker)

---

## v65.2 — QGv2 LinkGuard + Unconditional SK Strip (2026-02-15)

**E2E Quality Deep:** 34-36/36 (94-100%), stabilní

Deterministický post-processing pipeline (QGv2) s LinkGuard garanty a bezpodmínečným odstraněním slovenských artefaktů.

- **QGv2 (Quality Gate v2)** — 4-vrstvý deterministický pipeline: structural → language → intent → content
- **LinkGuard (Layer 3)** — SEARCH odpovědi musí mít ≥2 zdrojové linky; deterministická injekce z `sourceUrls`
- **Unconditional SK strip (Layer 2b)** — ľ→l, ô→ů, čo→co, nie je→není, preto→proto (vždy, bez threshold)
- **SK→CZ Transliterator (Layer 2a)** — rozšířen na ~160 regex pravidel + 6 agresivních suffix patterns
- **Language validation (Layer 2c)** — CZ povinná pro `lang=cs` odpovědi
- **E2E Quality Deep** — `tests/e2e-quality-deep.cjs`, 36 LLM testů ve 4 kategoriích (S/R/F/T)
- **CLAUDE.md** — kompletní přepis na v65.2 (QGv2, E2E status, known problems, Node 22+)

### Soubory

| Soubor | Změna |
|--------|-------|
| `src/chat/quality/quality-gate-v2.js` | QGv2 4-layer pipeline, LinkGuard, unconditional SK strip |
| `src/chat/handlers/utils/language-enforcement.js` | ~160 SK→CZ regex rules, 49 SK_MARKERS |
| `tests/e2e-quality-deep.cjs` | 36 LLM quality tests |
| `CLAUDE.md` | Kompletní update na v65.2 |

---

## v64.0 — CRE Gatekeeper + Single Authority Enforcement (2026-02-14)

**Testy:** 924 passing (43 novych gatekeeper + 26 schema-migrations)

CRE Gatekeeper — vsechna rozhodnuti mimo `CRE.decide()` nyni prochazi `overrideDecision()` (s audit trail) nebo `logIntercept()` (pro stavove pre-CRE trasy). Eliminace 25+ raw decision object bypassu.

- **`overrideDecision()`** — vytvari proper `CREDecision` s override metadaty (source, reason, originalDecision)
- **`logIntercept()`** — loguje pre-CRE intercepts (session resume, lifecycle, wizard) bez vytvareni rozhodnuti
- **`bindAuditDb()`** — volitelna DB persistence pro override/intercept audit trail
- **`getAuditStats()`** — real-time statistiky overrides a intercepts
- **Migration 005:** `cre_override_log` tabulka s 4 indexy (trace, conversation, source, type)
- **conversation.js:** 9 bypass bodu presmerovano (first_turn, reformulation, design_continue, date_correction, session_resume, progress_inquiry, build_handoff, lifecycle_handoff)
- **clarification.js:** 16 raw decision objektu presmerovano (max_attempts, local_request, source_url, drift_confirmed, atd.)
- **followup.js:** 10 raw decision objektu presmerovano (buildResolvedDecision, tryResolveClarification)
- **Fix:** FACTUAL+ANSWER invariant violation → CONVERSATIONAL+ANSWER (spravna kombinace)
- **Test:** `cre-gatekeeper.test.js` (43 testu — overrideDecision, invarianty, logIntercept, auditStats, DB persist, source coverage, migration, toJSON)
- **Test:** `schema-migrations.test.js` aktualizovano na 5 migraci

### Stabilizacni sprint — Schema Migration Versioning (v64.0 Day 1)

- **`src/db/migrate.js`** — Migration runner: `runMigrations(db)`, `getCurrentVersion(db)`, `listMigrations()`
- **5 migracnich souboru** v `src/db/migrations/` (timestamp-based ordering)
- **Test:** `schema-migrations.test.js` (26 testu — runner, idempotence, ordering, getCurrentVersion)

---

## v62.2d — E2E Quality Deep Final Fixes (2026-02-13)

**Skóre:** 34/36 (94% peak), ~33/36 (92% avg)

- CRE: `/hledám/i` přidáno do SEARCH_PATTERNS
- CRE: ITEM_LOOKUP pattern pro "hledám + typ nemovitosti/zboží" (bez čísla)
- Search sanitizer: odstraněn "kurz" z německých stop words (CZ "kurz" = směnný kurz)
- FACTUAL_NUMERIC: instrukce pro přibližné odhady z tréninkových dat
- SK→CZ: +20 nových párů (pre→pro, čo→co, aspoň→alespoň, uistite→ujistěte, ...)
- Test: opraveny isSlovak false positives (takže, každý → validní CZ)
- Test: rozšířeny validátory (počasí, motorky, developer koncepty, EUR/CZK)

## v62.2c — Language Enforcement Hardening (2026-02-13)

**Skóre:** 32/36 (89%), z 26/36 (72%)

- Hard language gate: mechanický SK→CZ překlad (50+ regex párů, 0ms)
- EN detekce: EN_THRESHOLD 3→2, diacritics ratio 0.6→0.4
- Language instrukce na PRVNÍ pozici v synthesis system promptu
- Source URL extraction: fallback na všechny toolResults
- ITEM_LOOKUP: přidán chybějící searchSubType='CLASSIFIED'
- Synthesis MAX_RETRIES 2→1 (úspora ~30s/request)
- Test timeout 90s→150s pro local LLM

## C3 Studio IDE — Modular Transport Layer (2026-02-14)

- **event-bus.js:** centralizovaný `C3Bus` (on/off/emit) — decoupling transport od UI
- **ws-client.js:** WS handshake s feature negotiation, exponential backoff reconnect, session routing via `conversationId`, rehydration, edit ACK
- **agent-client.js:** formátuje `AgentEventType` do čitelných log entries
- **terminal-client.js:** terminal handler s execution lock proti spamu

## C3 Studio IDE — Linked Sessions + Autocomplete (2026-02-13)

- **Shared session architektura:** chat + bottom panel propojené (1-3 sessions)
- **Bottom panel:** 4 modes (Split/Mix/Terminal/Log) per session
- **Chat panel:** nezávislé panes s vlastním feed, expert, attachments
- **Autocomplete:** Tab → `POST /api/autocomplete`, ghost text, accept
- **Edit mode toggle:** Auto/Ask posíláno s chat payloadem
- **Context meter:** polls `/api/context` + reaguje na WS `context_update`
- **Working tree:** collapse/expand, git status badges, toolbar
- **Center view:** session picker, "+ Nový" pro všechny sekce, list zoom
- **Dokumentace:** C3-STUDIO-IDE.md + C3-STUDIO-ROADMAP.md

## v63.3 — ExecutionTrace ID + LLM Step Logging (2026-02-14)

**Testy:** 217 passing / 8 suites

Execution observability — jeden UUID per user turn propojuje všechny audit vrstvy.

- **ExecutionTrace ID:** `randomUUID()` per user turn, propaguje se přes LLM → ENFORCER → CAPABILITY → MERGE
- **DB:** `execution_trace_id` column na `merge_audit_log`, `capability_drift_log`
- **DB:** `execution_step` column na `capability_drift_log`
- **DB:** nová tabulka `llm_execution_log` (model, temperature, prompt_hash, prompt_tokens, completion_tokens, latency_ms, token_source)
- **Prompt SHA-256 hash:** `crypto.createHash('sha256')` pro determinism analýzu — top-level DB column
- **Token source classification:** `'provider'` | `'estimated'` — rozlišuje skutečné vs odhadnuté token counts
- **`performance.now()`** pro sub-ms latency přesnost (místo `Date.now()`)
- **traceId v ResponseTag metadata** gated za `context.debug` flag (není v produkčním API)
- **Stress test:** 3-expert merge + strict + capability drift + retry + inheritance chain + trace reconstruction + prompt hash determinism

## v63.2 — Capability Enforcer Runtime + Strict Mode (2026-02-14)

**Testy:** 38 capability-enforcer tests

Post-response validation na bázi 5D capability profilu — deterministické, bez LLM, bez side effects.

- **Capability enforcer pipeline:** `evaluateDeterminism`, `evaluateRiskTolerance`, `evaluateVerbosity`, `evaluateStructure`, `computeCapabilityDrift`
- **Drift detection:** per-dimension delta, `DRIFT_VIOLATION_THRESHOLD=40`, `DRIFT_WARNING_THRESHOLD=25`
- **Wired into runtime:** `enforceCapabilities()` volaná po každém LLM response v expert handleru
- **Capability-driven modifiers:** `capability-mapping.js` — temperature bias, minResponseLength modifier, prompt instructions
- **ExpertEnforcer retry decay:** `retryTemperatureDecay=0.1`, `retryTopPDecay=0.05` per attempt
- **Strict enforcement mode:** `hardFail=true` — response suppressed po vyčerpání retries
- **Single-expert regenerateFn:** akceptuje `retryOptions` (temperatureDecay, topPDecay, attempt, seed)
- **Temperature floor 0.1** v obou pathech (single + merge)

## v63.1 — Expertise Wizard UI + Capability Sandbox (2026-02-13)

- **Wizard UI:** center-views s 5 moduly (wizard-basic, wizard-capabilities, wizard-modules, wizard-preview, wizard-helpers)
- **`GET /api/expertise-schema`** endpoint — anti-drift (žádné hardcoded konstanty ve frontendu)
- **`POST /api/merge-preview`** s inline config — live preview pro create mode
- **`POST /api/expertise-wizard/test-prompt`** — LLM test s rate limitem (1/5s)
- **Detail panel:** capability bars (5D), modules summary, tone + temperature
- **`validateExpertConfig()`** rozšířen o modules, capabilities, inheritance validaci
- **Capability sandbox:** `checkCapabilityNormalization()` — extreme profile warnings

## v63.0 — Merge Engine v2 (2026-02-13)

**Testy:** 111 passing / 4 suites (merge-engine 30, merge-compatibility 16, merge-enforcement-integration 15, expert-system 40 + expert-integration 10)

Kompletní multi-expertise prompt composition engine — čistá funkce, frozen výstupy, deterministické.

- **`mergeExpertisePrompt()`** — 15.5-kroková čistá funkce (validate → compatibility → sort → inherit → merge → trim → build → enforce → freeze)
- **`checkCompatibility()`** — 5D pairwise conflict detection (creativity↔determinism, risk gap, verbosity gap)
- **`resolveInheritance()`** — rekurzivní parent chain (max depth 4), per-module extend/replace
- **15 built-in expertů** s `modules` (6 sekcí) + `capabilities` (5D vector)
- **Token budget:** `estimateTokens()` (chars / 3.5), `EFFECTIVE_TOKEN_BUDGET=1800` (10% rezerva)
- **Enforcement merge:** forbiddenPhrases=UNION, minResponseLength=MAX, disclaimers=UNION (dedup)
- **DB:** `conversation_expertises` tabulka (N:M, max 3), `merge_audit_log`
- **`/api/merge-preview`** endpoint
- **ExpertStore:** `setExpertisesForConversation()`, `getExpertises()`, `clearExpertises()`

## v62.2 — IDE V4 + SEARCH Sub-types (2026-02-12)

- IDE: sidebar collapse, split bottom panel, live backend data, card actions
- SEARCH sub-type system: NEWS/SPEC/COMPARISON/FACTUAL_NUMERIC/PERSON/CLASSIFIED
- Syntax-only output gates (check structure, not semantics)

---

# C3 v56.2 — Sprint A + B + C1 + C2 + D + Hotfix (COMPLETE)
## All 13 Issues Fixed + 2 Runtime Bugs + Multilingual i18n

### Verze: 56.2.1
### Datum: 2026-02-07

---

## Souhrn

8 souborů, **13/13 fixů + 2 hotfixy**, 228 testů, 0 failures.

| Sprint | Soubory | Fixes | Testy |
|--------|---------|-------|-------|
| A | cre-decision.js | #3, #4, #5 | 52+18 |
| B | tool-executor.js, web-search.js, search-metrics.js | #1, #6, #7, #10 | 23+15 |
| C1 | controller.js, decisions.js | #2A/C, #12 | 29 |
| C2 | synthesis.js, decisions.js, tool-executor.js | #2B, #11, #9 | 13 |
| D | project.js | #8 | 17 |
| Hotfix | tool-executor.js, cre-decision.js | BUG1, BUG2 | 11 |
| i18n | all pattern files | SK,DE,PL,FR,ES | 76 |

---

## Sprint A — CRE Routing Fixes

**Soubor:** `src/chat/cre-decision.js` (+137 lines)

- **#3** KNOWLEDGE_PATTERNS: "Řekni mi o X" → SEARCH (was AMBIGUOUS)
- **#4** SELF_REFERENCE_PATTERNS: "Jak se jmenuju?" → CONVERSATIONAL (was SEARCH)
- **#5** STATEMENT_PATTERNS: "Moje jméno je X" → CONVERSATIONAL (was AMBIGUOUS)
- **#4b** Two-tier catch-all: "Proč?" → AMBIGUOUS (was SEARCH)
- Czech diacritics: `\b` → `(?:^|\s)..(?:\s|[?!.,;]|$)`

## Sprint B — Search Quality

**`src/executor/tool-executor.js`** (+116 lines)
- **#1** `sanitizeSearchQuery()` — strips instructions, dedupes, truncates
- **#6** Per-session circuit breaker: `toolType:sessionId`
- **#9** SandboxPath isolation: `clearProjectContext()` when no project *(moved from C2)*

**`src/llm/web-search.js`** (+27 lines)
- **#7** FAIL_COOLDOWN 5min→60s, SearX parallel `Promise.any()`, DDG-first

**`src/chat/handlers/utils/search-metrics.js`** (+4 lines)
- **#10** Snippet threshold 80→50, +17 Czech instructional STOP_WORDS

## Sprint C1 — Context Pipeline (Routing)

**`src/chat/controller.js`** (+62 lines)
- **#12** `#addToHistory` stores `{userInput, response}` pairs
- `#extractTurnTopic()` extracts topic, `lastTurnTopic` passed to handlers

**`src/chat/handlers/decisions.js`** (+153 lines)
- **#2A/C** `enrichSearchQuery()` — follow-up queries get topic prepended
- `hasOwnSubject()` — skip enrichment when input has proper noun
- All `toolExecutor.execute()` search calls use `effectiveQuery`

## Sprint C2 — Context Pipeline (Quality)

**`src/chat/handlers/utils/synthesis.js`** (+16 lines)
- **#11** `buildSynthesisPrompt` accepts `conversationContext` parameter
- `synthesizeWithLLM` passes context to prompt builder
- LLM sees last 3 turns (user+assistant) for pronoun resolution

**`src/chat/handlers/decisions.js`** (included in C1 count)
- **#11** `buildConversationContext()` transforms history for synthesis
- All 4 `synthesizeWithLLM()` calls pass `conversationContext`

**`src/executor/tool-executor.js`** (included in B count)
- **#9** `clearProjectContext()` when no project in context

---

## Instalace

Nahradit 8 souborů v `~/Projects/c3-agent-wip/`:
```
src/chat/cre-decision.js                      # Sprint A
src/chat/controller.js                         # Sprint C1
src/chat/handlers/decisions.js                 # Sprint C1+C2
src/chat/handlers/project.js                   # Sprint D
src/chat/handlers/utils/synthesis.js           # Sprint C2
src/chat/handlers/utils/search-metrics.js      # Sprint B
src/executor/tool-executor.js                  # Sprint B+C2
src/llm/web-search.js                          # Sprint B
```

Spustit: `node src/test/chat-integration.js`

---

## Sprint D — Project Mode (#8)

**Soubor:** `src/chat/handlers/project.js` (+130 lines)

- **#8** `PROJECT_SELF_PATTERNS` — detects "Jaký je stav projektu?" etc.
- `isProjectSelfQuery()` — checked BEFORE CRE routing
- `buildProjectStatusResponse()` — assembles response from working memory
- No web search, no LLM call — pure data assembly
- "Najdi článek o X" v project mode → NOT intercepted → CRE → web search ✓

---

## Hotfix — Runtime Bugs from Integration Tests

**BUG 1 (critical):** `sanitizeSearchQuery` result was overridden by `...context` spread.
- `handler({ query: effectiveQuery, ...context })` → `context.query` overwrites sanitized query
- **Fix:** `handler({ ...context, query: effectiveQuery })` — sanitized MUST be LAST
- Also: double-pass instruction removal for consecutive words

**BUG 2 (pre-existing):** "Jaká je populace Prahy?" → ASK_USER instead of SEARCH.
- `\b` doesn't work with Czech inflected forms (`jaká` ≠ `jak` + boundary)
- **Fix:** Added `jak[áéý] je/jsou` to Tier 1 with `(?:^|\s)` boundaries

---

## i18n — Multilingual Pattern Expansion (CZ + SK + DE + PL + FR + ES + EN)

**Root cause:** All patterns used CZ+EN only. JS `\b` fails with Unicode chars (č, ľ, ó, ñ, é, ł).

**8 pattern areas expanded:**
1. **Tier 1 compound** — "Čo je?" (SK), "Was ist?" (DE), "Co to jest?" (PL), "Qu'est-ce que?" (FR), "Qué es?" (ES)
2. **Tier 2 question words** — jak/čo/was/co/que/qué/how + inflections
3. **SELF_REFERENCE_PATTERNS** — "Ako sa volám?" (SK), "Wie heiße ich?" (DE), etc.
4. **STATEMENT_PATTERNS** — "Volám sa Bob" (SK), "Ich heiße Alice" (DE), etc.
5. **KNOWLEDGE_PATTERNS** — "Povedz mi o..." (SK), "Erzähl mir von..." (DE), etc.
6. **FOLLOW_UP_INDICATORS** — "A čo?" (SK), "Und was?" (DE), "Et que?" (FR), etc.
7. **sanitizeSearchQuery INSTRUCTION_WORDS** — "antworte/kurz/bitte" (DE), "proszę" (PL), etc.
8. **STOP_WORDS in search-metrics** — full multilingual stop word set

**Critical fix:** All non-ASCII patterns use `(?:^|\s)...\s` instead of `\b`.

---

## Kompletní test suite

```
tests/test-sprint-a.js       52 pattern + 18 ordering = 70 testů
tests/test-sprint-b.js       23 testů (sanitize, breaker, metrics)
tests/test-sprint-c1.js      29 testů (enrich, topic, integration)
tests/test-sprint-c2.js      13 testů (context, prompt, sandbox)
tests/test-sprint-d.js       17 testů (intercept, response)
tests/test-multilingual.js   76 testů (CZ,SK,DE,PL,FR,ES,EN × 6 areas)
                              ─────────
                              228 testů, 0 failures
```

---

## Celkový dopad na pipeline

### PŘED v56.2:
```
User: "Řekni mi o Pythagorovi"     → AMBIGUOUS → first-turn override → no search
User: "A co jeho teorém?"           → SEARCH "A co jeho teorém?" → irrelevant results
User: "Jak se jmenuju?"             → SEARCH → web search for name
User: "Kdo byl Pythagoras? Stručně" → DDG receives "Kdo byl Pythagoras? Odpověz stručně."
Long input → circuit breaker OPEN → ALL sessions blocked 60s
SearX cascade → 5min cooldown → only DDG
```

### PO v56.2:
```
User: "Řekni mi o Pythagorovi"     → SEARCH (KNOWLEDGE_PATTERNS) → web search
User: "A co jeho teorém?"           → SEARCH "Pythagorovi co teorém?" → relevant results
      → synthesis LLM sees: "Previous: User asked about Pythagoras"
User: "Jak se jmenuju?"             → CONVERSATIONAL (SELF_REFERENCE) → no search
User: "Kdo byl Pythagoras? Stručně" → DDG receives "Kdo byl Pythagoras?"
Long input → circuit breaker OPEN → ONLY that session blocked 30s
SearX cascade → 60s cooldown + parallel → faster recovery
```
