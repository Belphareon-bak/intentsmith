# C3-Agent — Aktuální Roadmapa
## Od v57.0 k produkční kvalitě

**Verze dokumentu:** 2026-02-07  
**Aktuální stav kódu:** v57.0 (expert-store, expert-enforcement, agent runner)  
**Poslední sprint:** v56.2 (13 fixů + i18n + hotfixy)  
**Kódová báze:** ~47 650 řádků, 79+ souborů

---

## Co je HOTOVO — reálný stav v kódu

### Jádro systému ✅
| Modul | Soubor(y) | Stav |
|-------|-----------|------|
| CRE Decision Engine | `chat/cre-decision.js` (1786 ř.) | ✅ 11 intent typů, 6 hard invariantů |
| ChatController | `chat/controller.js` (1766 ř.) | ✅ Mode routing, session management |
| Safety Engine | `chat/safety/` (4 policies) | ✅ Health, finance, law, general |
| Quality Pipeline | `chat/quality/` (K5.1–K5.5) | ✅ Relevance, trust, confidence, drift, depth |
| Output Gate (D6) | `chat/handlers/utils/output-gate.js` | ✅ Zombie, density, format enforcement |
| Conversation Store | `chat/conversation-store.js` | ✅ DB-backed, přežije restart |
| Context Budget | `chat/context-budget.js` | ✅ Token alokace per intent |
| Export Pipeline | `chat/export-pipeline.js` | ✅ MD, HTML, TXT (bez PDF) |
| Chat UI | `chat/chat.html` | ✅ Základní, funkční |
| LTM Context | `chat/ltm-context.js` | ✅ Read-only do syntézy |
| Language Detection | `chat/handlers/utils/language.js` | ✅ CZ/SK/DE/PL/FR/ES/EN |

### Handlery ✅
| Handler | Soubor | Stav |
|---------|--------|------|
| Conversation | `chat/handlers/conversation.js` | ✅ |
| Project | `chat/handlers/project.js` | ✅ + PROJECT_SELF_PATTERNS |
| Expert | `chat/handlers/expert.js` | ✅ Základní lifecycle + enforcement |
| Agent | `chat/handlers/agent.js` | ✅ |
| Build handoff | `chat/handlers/build-handoff.js` | ✅ State machine + cancel |
| Decisions | `chat/handlers/decisions.js` (1229 ř.) | ✅ 6+ sub-handlerů |
| Clarification | `chat/handlers/clarification.js` | ✅ |
| Local | `chat/handlers/local.js` | ✅ Math, date, calendar |
| Report | `chat/handlers/report.js` | ✅ |

### Search & Executor ✅
| Modul | Soubor | Stav |
|-------|--------|------|
| Tool Executor | `executor/tool-executor.js` (1339 ř.) | ✅ + circuit breaker per-session |
| C3 Tool Executor | `executor/c3-tool-executor.js` (682 ř.) | ✅ Single-shot contract |
| Query Canonicalizer | `executor/query-canonicalizer.js` | ✅ (byl "chybějící článek" z v55) |
| Health Monitor | `executor/health-monitor.js` | ✅ |
| Web Search | `llm/web-search.js` (709 ř.) | ✅ DDG + SearX, parallel Promise.any |
| Search Metrics | `chat/handlers/utils/search-metrics.js` | ✅ Logování per provider |
| Sanitize + Enrich | decisions.js + tool-executor.js | ✅ v56.2 Sprint B+C1 |

### Workflow Pipeline ✅
| Modul | Soubor | Stav |
|-------|--------|------|
| Planner Orchestrator | `planner/workflow.js` (600 ř.) | ✅ D1→CODE→R2→D2→R1 |
| Legacy Engine | `workflow/engine.js` (720 ř.) | ❄️ FROZEN, deprecated v55 |

### Expert Layer ✅ (v57)
| Modul | Soubor | Stav |
|-------|--------|------|
| Expert Layer | `experts/expert-layer.js` (1228 ř.) | ✅ Definice, routing |
| Expert Store | `experts/expert-store.js` | ✅ v57 DB persistence |
| Expert Enforcement | `experts/expert-enforcement.js` | ✅ v57 Post-synthesis validation |

### Agent Platform ✅
| Modul | Soubor | Stav |
|-------|--------|------|
| Agent Runner | `agents/runner.js` (1292 ř.) | ✅ v57 retry, HUNTER pattern |
| Agent Repository | `agents/repository.js` | ✅ Persistence + secrets |
| Agent Scheduler | `agents/scheduler.js` | ✅ v57 deterministic scheduling |
| Agent API | `agents/api.js` | ✅ REST CRUD |
| Agent DSL | `agents/schema.js` + conditions.js + triggers.js | ✅ |

### Infrastruktura ✅
| Modul | Soubor | Stav |
|-------|--------|------|
| LLM Gateway | `llm/gateway.js` | ✅ Capability-based auth |
| LLM Client | `llm/client.js` | ✅ (deprecated, přes gateway) |
| Database | `db/database.js` (1043 ř.) | ✅ SQLite WAL, prepared statements |
| Error Handler | `core/error-handler.js` | ✅ AppError + codes |
| Logger | `core/logger.js` | ✅ Structured |
| Channel Adapter | `channels/` | ✅ CLI adapter + typy |
| Domains | `domains/` | ✅ 11 recipes + 3 scaffolds |
| Config | `config.js` | ✅ Models, timeouts, DB |

### Testy
| Suite | Soubor | Zaměření |
|-------|--------|----------|
| Chat Integration | `test/chat-integration.js` (1042 ř.) | Full pipeline s LLM |
| Chat Quality | `test/chat-quality.test.js` (590 ř.) | CRE patterns, quality gates |
| Smoke Test | `test/smoke-test.js` (520 ř.) | Module loading, basic contracts |
| Sprint testy | (v56.2) | 228 testů, 0 failures |

---

## Co NEEXISTUJE — staré koncepty z roadmapy v43

Tyto moduly byly navrženy v roadmapě v31–v43, ale **nikdy nebyly implementovány** nebo byly **nahrazeny jednodušším řešením** v aktuální architektuře:

| Plánovaný modul | Verze | Co ho nahradilo |
|-----------------|-------|-----------------|
| `autonomous/` (GoalStore, Sandbox, FailureAnalyzer) | v37–39 | ChatController sessions + Safety Engine |
| `observability/` (ExecutionTrace, LatencyTracker, Replay) | v40 | Structured logger + SearchMetrics |
| `skills/` (SkillRegistry, SkillExecutor) | v41 | `domains/` (recipes + scaffolds) |
| `copilot/` (IntentTracker, ProactiveSuggestions) | v42 | CRE intent classification + follow-up enrichment |
| `ecosystem/` (PluginSDK, RemoteAgents, Federation) | v43 | Agent Platform (lokální) |
| `orchestrator/` (Agent-Expert integration) | v36 | ChatController expert/agent handler routing |
| `data/` (Data Layer, Representation Layer) | v34.4 | DB layer + tool executor |

**Tyto moduly NEPATŘÍ do roadmapy.** Aktuální architektura (třívrstvá Chat/Planner/Executor) je lepší než původní návrh s 8 subsystémy.

---

## Co ZBÝVÁ — prioritizované úkoly

### Priorita 🔴 KRITICKÁ — Operační bezpečnost

Tyto úkoly jsou nutné pro jakékoli nasazení mimo localhost.

#### O1: HTTP Hardening
**Stav:** `server.js` nemá žádnou ochranu vstupu.

```
[ ] Body size limit v parseBody() — max 1MB, jinak reject
[ ] decodeURIComponent try/catch v matchRoute() — malformovaná URL = 400
[ ] Rate limiting na API úrovni — alespoň basic per-IP counter
[ ] CORS whitelist místo wildcard '*' — config.server.allowedOrigins
[ ] Auth na /api/secrets — endpoint je otevřený bez autentikace
```

**Odhad:** 1 den

#### O2: Odstranění legacy workflow engine
**Stav:** `workflow/engine.js` je FROZEN od v55, jediný import v `server.js:14`.

```
[ ] Ověřit v logu 0 hitů na POST /workflow (nebo prostě odebrat)
[ ] Smazat workflow/engine.js (720 řádků)
[ ] Smazat 3 legacy endpointy (POST /workflow, GET /workflow/:id, GET /sessions)
[ ] Smazat import legacyWorkflowEngine ze server.js
[ ] Smazat inline UI v getUIHTML() (400+ řádků HTML)
```

**Odhad:** 2 hodiny

---

### Priorita 🟡 VYSOKÁ — Kvalita odpovědí

Systém správně rozhoduje KAM dotaz směřovat. Tyto úkoly řeší CO se vrátí.

#### Q1: fetchPage Quality
**Stav:** Základní HTML stripping, žádná detekce kvality obsahu.
**Proč:** Garbage in → garbage out. Pokud fetchPage vrátí navigační menu, LLM syntetizuje nesmysly.

```
[ ] Content quality score po scrape — keyword overlap s query
[ ] Block detection — login wall, cookie popup, paywall, "enable JavaScript"
[ ] Smart truncation — relevantní odstavce místo substring(0, 5000)
[ ] Konfigurovatelný maxLength — REPORT: 10K, SEARCH: 5K
```

**Odhad:** 2 dny

#### Q2: Automatický search retry
**Stav:** Manuální reformulace nabídnuta uživateli, žádný automatický retry.
**Proč:** "Nenašel jsem nic" je špatný UX. Jeden retry s reformulací vyřeší 60%+ případů.

```
[ ] Pokud search vrátí < 3 výsledků → LLM reformuluje query → retry (max 1)
[ ] Multi-query pro REPORT — LLM vygeneruje 2–3 doplňkové queries
[ ] Result deduplication přes queries
```

**Odhad:** 2 dny

#### Q3: Confidence-based response styling
**Stav:** Confidence se počítá ale neovlivňuje styl odpovědi.
**Proč:** Uživatel neví, jestli je odpověď podložená 5 zdroji nebo 0.

```
[ ] confidence < 0.3 → "Nenašel jsem spolehlivé informace, ale..."
[ ] confidence 0.3–0.6 → "Na základě dostupných zdrojů..."
[ ] confidence > 0.6 → přímá odpověď bez hedgingu
```

**Odhad:** 1 den

---

### Priorita 🟢 STŘEDNÍ — Dotažení features

#### F1: PDF Export
**Stav:** Export pipeline podporuje MD/HTML/TXT, PDF chybí.

```
[ ] Přidat PDF formát do ExportFormat enum
[ ] HTML→PDF konverze (puppeteer nebo jsPDF)
[ ] Stylový template pro PDF export
```

**Odhad:** 1–2 dny

#### F2: Expert Layer finalizace
**Stav:** Expert routing ✅, enforcement ✅, ale chybí domain-specific prompty a cross-session paměť.

```
[ ] Expert-specific synthesis prompts per doména (ne generic overlay)
[ ] Domain quality gates — health expert nesmí dávat diagnózy (rozšíření SafetyEngine)
[ ] Expert confidence calibration — expert ≠ vyšší confidence automaticky
[ ] Expert memory — cross-session kontext v expert-store (DB)
```

**Odhad:** 3–4 dny

#### F3: User Expectation Alignment
**Stav:** Systém správně dělá ASK_USER, RESTRICT, DEGRADE, ale uživatel to vnímá jako vyhýbání.

```
[ ] Sjednocený messaging modul — konzistentní formulace pro:
    - "Nemám dost kontextu" (ASK_USER)
    - "Toto nemohu zodpovědět" (REFUSE) 
    - "Hledání nevrátilo výsledky" (DEGRADE)
[ ] Vždy nabídnout alternativu — ne slepá ulička
```

**Odhad:** 2 dny

---

### Priorita 🔵 NÍZKÁ — Údržba & cleanup

#### M1: server.js rozklad
**Stav:** 2 624 řádků, porušuje vlastní invariant.

```
[ ] Extrahovat inline HTML (getUIHTML, getArchitectUIHTML) do souborů
[ ] Extrahovat matchRoute do core/router.js
[ ] Extrahovat inicializační sekvenci do bootstrap.js
[ ] Cíl: server.js < 500 řádků
```

**Odhad:** 1 den

#### M2: Rozklad velkých souborů
```
[ ] cre-decision.js — extrahovat pattern matchers do patterns/
[ ] decisions.js — rozdělit na per-decision-type soubory
[ ] tool-executor.js — extrahovat service wiring
```

**Odhad:** 2 dny

#### M3: Test infrastruktura
```
[ ] Migrace na Vitest (nativní ESM, watch mode, coverage)
[ ] Unit testy s mockovaným LLM klientem — rychlý feedback loop
[ ] Testy pro server.js routing, graceful shutdown
```

**Odhad:** 2–3 dny

#### M4: Verze sjednocení
```
[ ] Aktualizovat config.js verzi (v28 → v57)
[ ] Smazat legacy model aliases (THINKER, ANALYZER, CLASSIFIER)
[ ] Aktualizovat server banner (v36.0.0 → v57.0)
[ ] Označit starý ROADMAP.md jako HISTORICAL
```

**Odhad:** 1 hodina

#### M5: Console.log cleanup
```
[ ] Nahradit 27 raw console.log/error/warn za logger
[ ] Opravit 2 prázdné catch {} v architect.js
[ ] ESLint no-console pravidlo
```

**Odhad:** 1 hodina

---

## Navrhované sprinty

### Sprint 7: Hardening (est. 2–3 dny)
```
O1  HTTP Hardening (body limit, CORS, rate limit, secrets auth)
O2  Odstranění legacy workflow engine
M4  Verze sjednocení
M5  Console.log cleanup
```
**Výstup:** Server je bezpečný, kód je čistý, verze jsou konzistentní.

### Sprint 8: Search & Response Quality (est. 4–5 dnů)
```
Q1  fetchPage quality (block detection, smart truncation)
Q2  Automatický search retry + multi-query REPORT
Q3  Confidence-based response styling
```
**Výstup:** Odpovědi jsou podložené kvalitními daty a uživatel ví, jak moc jim věřit.

### Sprint 9: Completeness (est. 4–5 dnů)
```
F1  PDF Export
F2  Expert Layer finalizace (domain prompts, memory)
F3  User Expectation Alignment
```
**Výstup:** Všechny features jsou dotažené do produkční kvality.

### Sprint 10: Cleanup & Tests (est. 3–4 dny)
```
M1  server.js rozklad
M2  Rozklad velkých souborů
M3  Test infrastruktura (Vitest, mocked LLM testy)
```
**Výstup:** Kód je udržovatelný, testy běží rychle bez Ollama.

---

## Celkový odhad

| Sprint | Dny | Kumulativně |
|--------|-----|-------------|
| Sprint 7 (Hardening) | 2–3 | 2–3 |
| Sprint 8 (Quality) | 4–5 | 6–8 |
| Sprint 9 (Completeness) | 4–5 | 10–13 |
| Sprint 10 (Cleanup) | 3–4 | 13–17 |

**~3 týdny** na dotažení projektu do produkční kvality.

---

## Co NEDĚLAT (přeneseno z CHAT-QUALITY-ROADMAP, stále platí)

1. **Nepřidávat nové intent types** — 11 pokrývá všechno
2. **Neměnit CRE invarianty** — jsou správné a otestované
3. **Neměnit safety engine** — je kompletní
4. **Neimplementovat ecosystem/ koncepty z ROADMAP v43** — autonomy, federation, plugins jsou overengineering pro lokální AI asistent
5. **Neoptimalizovat performance** — nejdřív kvalita, pak rychlost
6. **Nestavět frontend framework** — vanilla JS + chat.html stačí

---

## Metriky úspěchu

| Metrika | Cíl | Jak měřit |
|---------|-----|-----------|
| Search success rate | ≥ 80% | SearchMetrics logy |
| Zombie response rate | < 5% | D6.1 gate logy |
| Content density pass rate | ≥ 90% | D6.2 gate logy |
| Language consistency | ≥ 95% | Spot check |
| fetchPage útila content rate | ≥ 70% | Content quality score |
| Auto-retry success rate | ≥ 50% | Reformulation logy |
| Unit test coverage | 100% pass | Všechny suites |
| server.js řádků | < 500 | wc -l |
| Legacy code | 0 | Žádný workflow/engine.js |

---

*Tento dokument nahrazuje ROADMAP.md (v43.2) a CHAT-QUALITY-ROADMAP.md (v55.2).*
*ROADMAP.md by měl být přejmenován na ROADMAP-HISTORICAL.md.*
