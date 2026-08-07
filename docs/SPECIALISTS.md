# C.3 Specialists

**Verze:** v122 (2026-03-11)

Viz take: [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md) | [EXPERTISES.md](EXPERTISES.md) | [WORKERS.md](WORKERS.md)

---

## Obsah

1. [Terminologie](#terminologie) — 4 runtime entity + 1 generativni
2. [Architektura](#architektura) — self-contained specialist system
3. [Accountant Specialist](#accountant-specialist) — deterministicke danove nastroje
4. [Dummy Logger Specialist](#dummy-logger-specialist) — utility pro platform testing
5. [Platform komponenty](#platform-komponenty) — runtime, loader, registries
6. [REST API](#rest-api) — 8 endpointu
7. [Plugin Contract](#plugin-contract) — co specialist smi a nesmi
8. [Manifest v2](#manifest-v2) — specialist.json format
9. [Stav implementace](#stav-implementace)
10. [Budouci specialiste](#budouci-specialiste)

---

## Terminologie

| Entita | Role | Runtime | Vlastnictvi |
|--------|------|---------|-------------|
| **Expertise** | routing knowledge | read-only | globalni |
| **Capability** | schopnost systemu | N:M routing | globalni |
| **Specialist** | execution plugin | self-contained | package dir |
| **Tool** | deterministicka funkce | ToolAdapter | soucast specialist |
| **Skill** | generativni workflow | NENI runtime | nezavisle |

### Klicove vztahy
- Specialist **uses** expertise (ne owns). Funguje i bez.
- Capability resi N:M: `expertise → capability → specialist[]`
- Tool ma vlastni lifecycle (match/execute/validate/fail)
- Skill nikdy neni runtime komponenta

---

## Architektura

Specialist je self-contained balik v `specialists/` adresari. **Nulove hardcoded zavislosti v core** — vsechny domenove data registrovane dynamicky pres `ctx.registries`.

> **Zmereno 2026-08-07 na `1fc8f03e`:** smer core → specialisté je cisty, zadny
> staticky import z `src/**` do `specialists/**` neexistuje. Opacny smer cisty
> **neni** — `specialists/accountant-cz/adapters.js:12` importuje `ToolAdapter`
> z `../../src/expertises/tool-adapter.js`. Je to jedina vykonavana hrana
> a jediny symbol; `ToolAdapter` v `ctx` chybi, takze pravidlo z
> [Plugin boundary](#plugin-boundary) pro nej dnes nelze dodrzet. Detail, oba
> prototypy reseni a mereni:
> [`docs/review/2026-08-07-L0-8-BOUNDARY.md`](review/2026-08-07-L0-8-BOUNDARY.md).

```
specialists/
  accountant-cz/          ← domain specialist (finance)
    index.js              ← register(ctx) / unregister(ctx)
    specialist.json       ← manifest v2
    adapters.js           ← ToolAdapter subclasses
    tools/                ← deterministic functions
    knowledge/seed.js     ← knowledge base seeding
    scenarios/            ← guided multi-step scenarios
    ledger/               ← 7 ledger modules (2,842 LOC)
  dummy-logger/           ← utility specialist (testing)
```

### Registration Context (ctx)

```javascript
ctx = {
  runtime,              // SpecialistRuntime
  db,                   // SQLite
  manifest,             // specialist.json
  specialistDir,        // absolute path
  logger,
  knowledgeBase,        // KnowledgeBase instance
  registries: {
    autoSelect,         // { registerBoostPatterns, unregisterBoostPatterns }
    scenario,           // ScenarioRegistry (register, unregisterBySpecialist)
    cre,                // { registerToolType, unregisterToolType, isKnownTool }
    toolExecutor,       // ToolExecutor singleton (register/unregister handlers)
    capability,         // CapabilityRegistry (register, resolve, unregisterBySpecialist)
    expertise,          // ExpertiseRegistry (addCustom, removeCustom, get)
  },
};
```

### Pipeline

```
Uzivatel: "Kolik zaplatim z 850k jako OSVC za rok 2024?"
    │
    v
CRE.classifyIntent() → ANSWER
    │
    v
expertiseHandler() — expertise 'accountant' je aktivni
    │
    v
specialistRuntime.tryToolExecution('accountant', input, { sessionId, conversationId })
    │
    ├── IntentDetector: pattern matching (5 tools, by priority)
    │     └── match: accountant.tax_calculator
    │
    ├── SessionParamCache: merge s predchozimi params (TTL 30min)
    │
    ├── ToolAdapter: validate → normalize → execute → validateResult
    │     └── deterministicky vypocet → structured result
    │
    ├── SpecialistMemory: processWrites() pokud result.memoryWrites
    │
    ├── SpecialistTelemetry: record(tool.success, { toolId, durationMs })
    │
    v
wrapWithExpertisePersona() → LLM formatuje vysledek
    │
    v
TaggedResponse s metadaty { expertise, toolResults }
```

### Klicovy princip

**Cisla pochazi z deterministickych vypoctu, ne z LLM.** LLM v roli specialisty NIKDY nepocita — pouze formatuje vysledky nastroju do citelne formy.

---

## Plugin Contract

### Specialist SMI:
- `ctx.runtime` — registerSpecialist, unregisterSpecialist
- `ctx.registries.*` — boost patterns, scenarios, tool types, capabilities, expertise
- `ctx.knowledgeBase` — bulkSetFacts
- `ctx.db`, `ctx.logger`

### Specialist NESMI:
- `import ... from '../../src/...'` — warn v121, hard reject v budouci verzi
  > **Pozor: ta kontrola dnes nic nechyti.** `specialist-loader.js:521-531` cte
  > pouze `manifest.entry` (tedy `index.js`) a hleda vzor `from '../../src/`.
  > Skutecne poruseni je v `adapters.js`, ktery entry point neni, a typove
  > odkazy maji tvar `import('../../src/...')`, ktery vzor nematchuje. Aplikace
  > teze kontroly na vsech 5 balicku dava **0 varovani**. Zadny test toto
  > pravidlo nevynucuje.
- Upravovat globalni stav mimo ctx.registries

### Fail-safe unregister:
- Kazdy cleanup krok v try/catch
- Loader provadi defensivni cleanup VSECH registru po unregister()

---

## Manifest v2

```json
{
  "id": "accountant-cz",
  "version": "2.0.0",
  "manifestVersion": 2,
  "name": "Ucetni specialista (CZ)",
  "domain": "finance",
  "type": "domain",
  "engine": ">=121.0.0",
  "entry": "./index.js",
  "tools": [...],
  "capabilities": ["tax.calculate", "vat.compute", "salary.compute"],
  "expertises": ["accountant"],
  "defaultExpertise": "./expertise.json",
  "enabledByDefault": true
}
```

- `manifestVersion`: 1 (backwards compat) nebo 2
- `capabilities`: dotted notation `/^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/`
- `defaultExpertise`: auto-load pokud expertise neexistuje v registru
- Boot order: topological sort (dependencies) + alphabetical (deterministic)

---

# Accountant Specialist

## Co to je

Accountant Specialist (`accountant-cz`) je **prvni plne implementovany domenovy specialista** v C.3. Ma 5 deterministickych nastroju pro ceske danove vypocty + 5 ToolAdapteru (v75).

## Nastroje

### 1. Tax Calculator (`tools/tax-calc.js`)

Vypocet dane z prijmu pro OSVC (§7 ZDP) a s.r.o. (§21 ZDP).

**Vstup:** gross_income, expense_type (flat_60/80/40/30/actual), entity_type (osvc/sro), year, children, spouse_credit, student, disability

**Vystup:** tax_base, income_tax, social_insurance, health_insurance, total_tax_burden, net_income, effective_rate, assumptions[], warnings[], breakdown

**s.r.o.:** DPPO 21% + srazkova dan z dividend 15% = kombinovana efektivni sazba 32.85%

**Adapter:** `TaxCalculatorAdapter` — validates net+tax=gross, effective_rate <80%, net_income>0 for income≥300k

### 2. VAT Calculator (`tools/vat-calc.js`)

DPH: zakladni 21%, snizena 12% (od 2024), nulova 0% (export).

**Smery:** add (castka je zaklad) nebo remove (castka je s DPH).

**Adapter:** `VATCalculatorAdapter` — validates base+vat=total, vat≥0

### 3. Salary Calculator (`tools/salary-calc.js`)

Mesicni/rocni rozpis mzdy zamestnance (§6 ZDP).

**Vstup:** gross_salary, year, children, spouse_credit, student, mode (monthly/annual)

**Vystup:** social_employee, health_employee, tax_advance, net_salary, social_employer, health_employer, total_employer_cost

**Bonus:** `compareSalaries([30000, 40000, 50000])` — marginalni danova sazba

**Adapter:** `SalaryCalculatorAdapter` — validates net<gross, net_to_gross_ratio 50-95%

### 4. Deadline Checker (`tools/deadline-checker.js`)

Ceske danove lhuty — OSVC, s.r.o., DPH, kontrolni hlaseni.

**Typy:** DPFO/DPPO filing, OSSZ/VZP reporty, pojistne platby, zalohove platby, DPH kontrolni hlaseni

**Parametry:** entity_type, year, has_advisor, is_vat_payer, vat_period

**Adapter:** `DeadlineCheckerAdapter` — validates deadlines array not empty

### 5. Compare Tax Entities (`tools/tax-calc.js:compareTaxEntities`)

Side-by-side porovnani OSVC vs s.r.o. pro dany prijem.

**Adapter:** `CompareAdapter` — validates osvc/sro results present, winner valid

### 6. Tax Rates Registry (`tools/tax-rates.js`)

Centralni registr vsech ceskych danovych sazeb (2024, 2025). Dan z prijmu, socialni, zdravotni, DPPO, slevy, pausalni vydaje. Podpora pro `getStalenessWarnings()`.

## ToolAdapter Contract (v75)

Vsech 5 nastroju pouziva `ToolAdapter` pattern (`adapters.js`):

```
validate(params)       → check required params → clarify pokud chybi
normalize(params)      → apply defaults, year fallback, sanity checks
execute(params)        → call actual tool function
validateResult(result) → post-execution sanity checks
```

**Navratove statusy:**
- `{ status: 'ok', data }` — uspech
- `{ status: 'ok', data, meta: { warnings } }` — uspech s warningy
- `{ status: 'clarify', missingParams: [...] }` — chybi vstupy → zeptej se uzivatele
- `{ status: 'error', error: 'AMOUNT_UNREALISTIC' }` — neopravitelna chyba

## Intent patterns (priority order)

| Tool | Priority | Trigger patterns |
|------|----------|-----------------|
| compare_tax_entities | 10 | porovn, srovn, rozdil, lepe, vyhodn |
| vat_calculator | 8 | DPH + computation verbs |
| salary_calculator | 6 | mzda/plat + cista/hruba/netto/brutto |
| deadline_checker | 4 | kdy/termin/lhuta + dan/priznani/prehled |
| tax_calculator | 2 | kolik/jaka + dan/odvod/zaplatim |

**Inline extractors:** `extractAmountInline()` (850k → 850000, 2M → 2000000), `extractYearInline()` (za rok 2024)

## Soubory

| Soubor | Ucel |
|--------|------|
| `specialists/accountant-cz/specialist.json` | Manifest |
| `specialists/accountant-cz/index.js` | Entry point (register/unregister, patterns, extractors) |
| `specialists/accountant-cz/adapters.js` | 5 ToolAdapter implementaci |
| `specialists/accountant-cz/tools/tax-calc.js` | OSVC + s.r.o. danovy kalkulator |
| `specialists/accountant-cz/tools/salary-calc.js` | Mzdovy kalkulator |
| `specialists/accountant-cz/tools/vat-calc.js` | DPH kalkulator |
| `specialists/accountant-cz/tools/tax-rates.js` | Registry sazeb (2024/2025) |
| `specialists/accountant-cz/tools/deadline-checker.js` | Danove lhuty |
| `specialists/accountant-cz/knowledge/tax-rates.js` | Knowledge pack (seed do KB) |

---

# Dummy Logger Specialist

## Co to je

Minimalni utility specialista pro **platformni integracni testovani**. Ukazuje ze specialist system funguje s vice nez jednim specialistou. Ma 1 nastroj a 1 migraci.

## Nastroje

### 1. Format Log Entry (`tools/format-entry.js`)

Formatuje strukturovany log entry s timestampem, levelem, source.

**Vstup:** message, level (debug/info/warn/error), source

**Vystup:** formatted string, level, source, message, timestamp, prefix

## Soubory

| Soubor | Ucel |
|--------|------|
| `specialists/dummy-logger/specialist.json` | Manifest |
| `specialists/dummy-logger/index.js` | Entry point (register/unregister) |
| `specialists/dummy-logger/tools/format-entry.js` | Log formatter |
| `specialists/dummy-logger/migrations/001_create_event_log.js` | event_log tabulka |

---

# Platform komponenty

## Specialist Runtime (`src/expertises/specialist-runtime.js`)

Orchestrace detect → execute → wrap. 4 tridy:

| Trida | Ucel |
|-------|------|
| `ToolRegistry` | Map specialist→tools, lazy-load modules, ESM cache bust |
| `IntentDetector` | Pattern matching: user input → tool match |
| `ToolExecutor` | Run deterministic tool, inject KB, return structured result |
| `SessionParamCache` | Volatile param cache per session (TTL 30min) |
| `SpecialistRuntime` | Orchestrator — detect → cache merge → execute → memory → telemetry |

### SpecialistRuntime API

```javascript
registerSpecialist(config)                           // registruj tools
unregisterSpecialist(specialistId)                   // odregistruj
isSpecialist(expertiseId)                            // → boolean
getSpecialistIds()                                   // → string[]
getSpecialistConfig(expertiseId)                     // → config pro UI/API
clearModuleCache(specialistId)                       // ESM cache bust
isSpecialistBusy(expertiseId)                        // → boolean (execution counter)
setKnowledgeBase(kb)                                 // inject D2 KnowledgeBase
setMemory(memory)                                    // inject D4 SpecialistMemory
setTelemetry(telemetry)                              // inject v82 SpecialistTelemetry
tryToolExecution(expertiseId, input, { sessionId, conversationId })
  // → { toolType, result, params, duration }
  // → { status: 'clarify', missingParams, toolType }
  // → null (no match → fallback to LLM)
```

## Specialist Loader (`src/specialists/specialist-loader.js`)

Boot-time discovery, install, enable s integrity checking. Viz [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md).

## Specialist Memory — D4 (`src/expertises/specialist-memory.js`)

DB-backed key-value store: `(specialist_id, conversation_id, key)` → value.

- Tools write via **explicit opt-in**: `result.memoryWrites = [{ key, value, type }]`
- Value types: string, number, boolean, json (auto-parsed)
- `getContext()` → formatted string pro prompt injection
- Telemetry: memory.hit, memory.miss, memory.write (count only, never keys/values — PII)

## Specialist Telemetry — v82 (`src/telemetry/specialist-telemetry.js`)

**Contract:** NEVER throws, NEVER blocks, NEVER changes control flow.

- Events: tool.match, tool.success, tool.fail, tool.clarify, memory.hit/miss/write, lifecycle.boot/enable/disable, api.request
- In-memory queue (max 500) → periodic flush (30s) → SQLite `specialist_telemetry` table
- Retention: 30d (centralized `telemetry-retention.js`)
- `getSummary({ specialistId, since })` → stats + success rate

## Knowledge Base — D2 (`src/expertises/knowledge-base.js`)

Versioned fact store: `(domain, category, key, year)` → value + provenance (source, confidence, verification).

- `getFact()`, `getCategory()`, `upsertFact()`, `seed()`, `listDomains()`
- ToolExecutor injects KB handle into tool context
- accountant-cz seedi tax-rates pres `knowledge/tax-rates.js`

## Scenario Engine — D3 (`src/expertises/scenario-engine.js`)

Multi-step guided workflows: INTRO → COLLECTING → COMPUTING → PRESENTING → RECOMMENDING → ADJUSTING → COMPLETED.

- `ScenarioRegistry` — definice + trigger detection
- `ScenarioRunner` — state machine per session
- `branchIf` — conditional steps (pure, no side-effects)
- Integration: `conversation.js` checks `scenarioRunner.isActive(sessionId)`
- Framework ready, no scenarios registered for accountant-cz yet

## Dependency System (v79)

Manifest support: `"dependencies": { "other-specialist-id": ">=1.0.0" }`

- **Enable check:** `_checkDependencies()` — all deps must be installed + enabled + version satisfied
- **Disable check:** `getDependents()` — refuses to disable if others depend on this one
- **Boot order:** `_topologicalSort()` (Kahn's algorithm)
- Current state: accountant-cz a dummy-logger nemaji zadne dependency

---

# REST API

8 endpointu v `src/routes/specialists.js`:

| Endpoint | Popis |
|----------|-------|
| `GET /api/specialists` | Seznam vsech instalovanych (vcetne tools summary) |
| `GET /api/specialists/:id` | Detail (manifest + status + runtime state) |
| `POST /api/specialists/:id/enable` | Zapni specialistu (mutex lock) |
| `POST /api/specialists/:id/disable` | Vypni (check dependents) |
| `POST /api/specialists/:id/update` | Update (re-discover → busy guard → disable → migrate → re-enable → commit) |
| `POST /api/specialists/discover` | Re-scan disk pro nove specialisty |
| `GET /api/specialists/:id/integrity` | Runtime/DB consistency check |
| `GET /api/specialists/telemetry?specialist=X&since=Y` | Telemetry summary |

Vsechny wrappovane `withApiTelemetry()` pro pasivni latency observability.

---

# Stav implementace

## Platform (specialist system)

| Komponenta | Stav | Verze | Testy |
|-----------|------|-------|-------|
| Specialist Loader (discover, install, enable) | HOTOVO | v74 | 1-10 |
| Specialist Runtime (registry, detection, execution) | HOTOVO | v74 | 11-16 |
| Multi-specialist isolation | HOTOVO | v74 | 17-26 |
| Update flow (cold update, ESM cache bust) | HOTOVO | v74 | 27-35 |
| Rollback-ready update (DB commit after re-enable) | HOTOVO | v74 | 36-41 |
| Integrity check (post-boot, on-demand) | HOTOVO | v74 | 13 |
| isSpecialistBusy guard | HOTOVO | v74 | 35 |
| Stress test (200 cycles) | HOTOVO | v74 | 16 |
| Cross-contamination stress (50 alternating cycles) | HOTOVO | v74 | 25 |
| ToolAdapter contract (validate → normalize → execute → validate) | HOTOVO | v75 | — |
| Dependency system (topo sort, enable/disable guard) | HOTOVO | v79 | — |
| Specialist Memory — D4 (persistent context, memoryWrites) | HOTOVO | v79 | — |
| Scenario Engine — D3 (branchIf, multi-step workflows) | HOTOVO | v79 | — |
| Knowledge Base — D2 (versioned fact store) | HOTOVO | v79 | — |
| REST API (8 endpoints) | HOTOVO | v82 | — |
| Specialist Telemetry (passive observability, batch flush) | HOTOVO | v82 | — |
| **D5 — Specialist ↔ Expertise discovery + chaining** | **HOTOVO** | v91 | — |
| **Uninstall (purge)** | **CHYBI** | — | — |
| **Remote registry** | **CHYBI** | — | — |

## Accountant-cz

| Komponenta | Stav | Pozn. |
|-----------|------|-------|
| Tax Calculator (OSVC + s.r.o.) | HOTOVO | 5 tools, deterministicke |
| VAT Calculator | HOTOVO | 21%, 12%, 0% |
| Salary Calculator | HOTOVO | mesicni/rocni, children, disability |
| Deadline Checker | HOTOVO | OSVC/s.r.o., DPH, advisor |
| Tax Rates Registry (2024/2025) | HOTOVO | staleness warnings |
| ToolAdapters (5x) | HOTOVO | v75, validate+sanitize |
| Pattern Detection (NLP, CZ/EN) | HOTOVO | regex, priority-based |
| Knowledge Pack (tax-rates) | HOTOVO | seed do KB |
| DB migrace | NENI POTREBA | tools jsou pure functions |
| **Interaktivni scenare** | **CHYBI** | "co kdyby..." optimalizace |
| **Realtime sazby (worker)** | **CHYBI** | automaticka aktualizace |

## DB tabulky

| Tabulka | Migrace | Popis |
|---------|---------|-------|
| `specialists` | v74 (012) | Specialist registry (id, version, status, manifest) |
| `specialist_migrations` | v74 (012) | Migration tracking per specialist |
| `specialist_memory` | v79 (015) | Persistent context per specialist + conversation |
| `specialist_telemetry` | v82 (018) | Event log (type, specialist, tool, duration) |

## Celkovy stav testu

```
Specialist Loader: 270 passed, 0 failed
41 test blocks, pokryvajici: discovery, install, enable/disable, runtime isolation,
multi-specialist, update, rollback, stress tests
```

---

# Budouci specialiste

### D5 — Specialist Expertise Discovery + Chaining ✅ (v91)

**Implementovano v91.** Specialist vlastni kolekci expertiz a automaticky vybira
relevantni pri kazdem dotazu.

**Pipeline (4 faze):**
1. **Tool dispatch** — deterministicke nastroje (kalkulacky, lookup) maji prioritu
2. **Expertise discovery** — scoped vocabulary matching pres `specialist_expertises`
   - Single match → `generateExpertiseResponse()` (plna expertni odpoved)
   - Multi-match (2-3) → `handleMergedExpertises()` (slozite dotazy)
   - Label boost (+2) pro oznacene expertizy, priority jako tie-breaker
3. **Gap detection** — zadna expertiza neodpovida → 2 moznosti:
   - Vytvorit novou (trigger `create-expertise` skill → auto-bind)
   - Fallback: odpovedet bez ni (CRE → ANSWER/SEARCH)
4. **Fallback** — specialist persona bez specificke expertizy (LLM chat)

**Architektura:**
- `src/expertises/expertise-discovery.js` — pure function, <1ms, reuse z `auto-select.js`
- `src/chat/handlers/specialist.js` — D5 handler (tool → discovery → gap → fallback)
- `src/chat/controller.js` — `ChatMode.SPECIALIST`, sticky mode, context building
- `src/db/migrations/025_v91_specialist_expertises.js` — binding tabulka
- `src/specialists/specialist-loader.js` — `_seedExpertiseBindings()` pri boot

**REST API:**
| Endpoint | Popis |
|----------|-------|
| `GET /api/specialists/:id/expertises` | Seznam expertiz specialisty |
| `POST /api/specialists/:id/expertises` | Pridej expertizu |
| `DELETE /api/specialists/:id/expertises/:eid` | Odeber expertizu |
| `PATCH /api/specialists/:id/expertises/:eid` | Uprav label/prioritu |
| `POST /api/chat/specialist` | Aktivuj specialistu pro session |
| `DELETE /api/chat/specialist` | Deaktivuj specialistu |

**FE:**
- Specialist indikator v chat headeru (zluta tecka + jmeno + ✕ pro deaktivaci)
- Gap choice inline tlacitka ("Vytvorit expertizu" / "Odpovedet bez ni")
- Detail panel: Aktivovat/Deaktivovat akce
- Session persistence: specialist data v localStorage

**Testy:**
- `tests/expertise-discovery.test.js` — 23 testu (vocabulary, label, multi, gap, stem)
- `tests/specialist-handler.test.js` — 20 testu (DB ops, seeding, gap patterns, ordering)

### Dalsi planovane smery

| Smer | Priorita | Popis |
|------|----------|-------|
| Remote registry (D9) | P2 | Git-based distribution, marketplace |
| Uninstall (purge) | P2 | Full cleanup vcetne DB tables |
| Specialist CRUD wizard (E1) | P2 | IDE wizard pro spravce specialistu |

### Planovani specialiste

| Specialista | Priorita | Popis |
|-------------|----------|-------|
| Spravce domacnosti | P2 | Energie, pojisteni, rozpocet |
| AI researcher | P3 | Monitoring AI paperu, benchmarku |
| Investicni poradce | P3 | Portfolio tracking, analyza trhu |

---

## Vytvoření nového specialisty

> Sloučeno z `SPECIALIST-CREATION-GUIDE.md` (v122.2)

### Dva způsoby vytvoření

**A. Chat (doporučeno pro specialisty)**

Napište do chatu:
- **CZ**: „Vytvoř specialistu na překlady" / „Chci nového specialistu pro daně"
- **EN**: „Create specialist for translations" / „Add specialist for tax"

C3 aktivuje skill `create-specialist` (10 kroků):

1. **clarify** — dotazník na doménu, nástroje, schopnosti
2. **draft** — LLM vygeneruje `specialist.json` manifest
3. **review** — uživatel schválí nebo navrhne změny
4. **refine** — LLM zapracuje připomínky
5. **validate** — JSON schema kontrola (id, tools, capabilities)
6. **sanitize** — normalizace kapabilit (aliasy, dedup, řazení)
7. **save_manifest** — zápis `specialists/<name>/specialist.json`
8. **generate_code** — LLM vygeneruje `index.js` (register/unregister)
9. **save_entry** — zápis `specialists/<name>/index.js`
10. **done** — souhrn + automatický reload

Po dokončení se specialista ihned objeví v IDE (automatický refresh).

**B. IDE wizard (rychlé vytvoření)**

1. Otevřete panel **Specialisté** (navigace vlevo)
2. Klikněte **+** (Nový specialista)
3. Vyplňte formulář (jméno, doména, popis, system prompt, moduly, kapability)
4. Klikněte **Vytvořit** → POST na `/api/expertises` s `is_specialist: true`
5. Specialista se ihned zobrazí v seznamu

Stejný wizard funguje i pro **Expertyzy** — jen bez příznaku `is_specialist`.

### Manifest formát (specialist.json)

```json
{
  "manifestVersion": 2,
  "id": "translator",
  "version": "1.0.0",
  "name": "Překladatel",
  "description": "Překlad textů a lokalizace",
  "domain": "language",
  "type": "domain",
  "engine": ">=122.0.0",
  "entry": "./index.js",
  "tools": [
    { "id": "translator.translate", "name": "Překlad", "module": "./index.js", "function": "translate" }
  ],
  "capabilities": ["translation.translate", "translation.detect"],
  "expertises": ["translator"],
  "enabledByDefault": true
}
```

**Pravidla:**
- `id` — slug format: `/^[a-z][a-z0-9\-]*$/`
- `tools[].id` — prefix musí odpovídat `id` specialisty: `translator.translate`
- `capabilities` — dotted notation: `domain.action`
- `engine` — minimální verze C3 enginu

### Implementace nástrojů (index.js)

```javascript
export async function register(ctx) {
  const { runtime, manifest } = ctx;

  // 1. Nástroje
  runtime.registerSpecialist({
    id: manifest.id,
    domain: manifest.domain,
    tools: buildToolDefinitions(),
  });

  // 2. Expertyza (volitelné — inline definice)
  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(MY_EXPERTISE);
  }

  // 3. Boost patterns (auto-select)
  if (ctx.registries?.autoSelect?.registerBoostPatterns) {
    ctx.registries.autoSelect.registerBoostPatterns(manifest.id, PATTERNS);
  }

  // 4. CRE tool types
  if (ctx.registries?.cre?.registerToolType) {
    for (const tool of manifest.tools || []) {
      ctx.registries.cre.registerToolType(tool.id);
    }
  }

  // 5. Tool handlers
  if (ctx.registries?.toolExecutor?.register) {
    ctx.registries.toolExecutor.register('myspec.mytool', handler);
  }

  // 6. Capabilities
  if (ctx.registries?.capability?.register) {
    for (const cap of manifest.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
    }
  }
}

export function unregister(ctx) {
  // Každý krok v try/catch — fail-safe
  try { ctx.runtime?.unregisterSpecialist?.(ctx.manifest.id); } catch {}
  try { ctx.registries?.autoSelect?.unregisterBoostPatterns(ctx.manifest.id); } catch {}
  // ... atd.
}
```

### Plugin boundary

**Pravidlo**: NIKDY neimportujte z `../../src/`. Vše přichází přes `ctx`.

> **Stav k 2026-08-07:** pravidlo plati pro vsechno, co `ctx` nabizi — `runtime`,
> `db`, `manifest`, `specialistDir`, `logger`, `knowledgeBase` a `registries`
> (`autoSelect`, `scenario`, `cre`, `toolExecutor`, `capability`, `expertise`),
> viz `src/specialists/specialist-loader.js:540-559`.
>
> **`ToolAdapter` mezi nimi neni**, takze pro nej pravidlo dnes nema jak byt
> dodrzeno a dodavany balicek `accountant-cz` ho porusuje. Rozhodnuti mezi
> strict injection (doplnit do `ctx`) a verejnym extension SDK je otevrene —
> `ROADMAP.md §14`, evidence v
> [`docs/review/2026-08-07-L0-8-BOUNDARY.md`](review/2026-08-07-L0-8-BOUNDARY.md).
> Do rozhodnuti pravidlo **neuvadejte jako vynucovane**.

### Správa v IDE

- **Editace**: klikněte na kartu → **Editovat** → wizard s předvyplněnými daty → PUT `/api/expertises/:id`
- **Mazání**: klikněte **Smazat** → automatická deaktivace + smazání
- **Hromadné operace**: **Označit** → zaškrtněte karty → **Smazat (N)**

### Příklady hotových specialistů

| Specialista | Doména | Nástroje | Cesta |
|-------------|--------|----------|-------|
| Účetní (accountant-cz) | finance | 12 nástrojů (DPH, fakturace, mzdy) | `specialists/accountant-cz/` |
| Překladatel (translator) | language | 2 nástroje (překlad, detekce jazyka) | `specialists/translator/` |

### Troubleshooting

| Problém | Řešení |
|---------|--------|
| Specialista se nezobrazí po vytvoření | Zkontrolujte `engine` v manifestu (musí být `<=` aktuální verze) |
| Chyba při registraci | Zkontrolujte `ctx.registries` — všechny jsou volitelné (`?.`) |
| Tool handler nefunguje | Ujistěte se, že ID v `toolExecutor.register()` odpovídá manifestu |
| Expertise se nezobrazí | Ověřte, že `setExpertiseRegistry()` je zavoláno v server.js před `boot()` |

---

*Aktualizováno: 2026-03-27*
*Engine: c3-agent v135.0.0*
