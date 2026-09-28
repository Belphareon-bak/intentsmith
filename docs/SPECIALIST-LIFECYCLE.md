# Specialist Lifecycle Contract v2

**Verze:** v2.1 (2026-03-01)
**Status:** Implementovano + testovano (270 assertions)

Viz take: [SPECIALISTS.md](SPECIALISTS.md) | [EXPERTISES.md](EXPERTISES.md) | [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Obsah

1. [Principy](#principy)
2. [Package format](#package-format)
3. [Manifest — specialist.json](#manifest--specialistjson)
4. [Lifecycle operace](#lifecycle-operace)
5. [Update flow (rollback-ready)](#update-flow-rollback-ready)
6. [Specialist Loader](#specialist-loader)
7. [Specialist Runtime](#specialist-runtime)
8. [ToolAdapter Contract (v75)](#tooladapter-contract-v75)
9. [Specialist Memory — D4 (v79)](#specialist-memory--d4-v79)
10. [Specialist Telemetry (v82)](#specialist-telemetry-v82)
11. [Dependency System (v79)](#dependency-system-v79)
12. [DB schema](#db-schema)
13. [Migration namespacing](#migration-namespacing)
14. [ESM cache busting](#esm-cache-busting)
15. [Integration points](#integration-points)
16. [Verze a kompatibilita](#verze-a-kompatibilita)
17. [Testy](#testy)
18. [IDE integrace](#ide-integrace)
19. [Budouci: Distribution](#budouci-distribution)

---

## Principy

1. **Modularni monolit** — specialista je jeden self-contained balik. Uvnitr separovany soubory, ven jeden package. Zadny orchestrator, zadne capability registry.
2. **Manifest-driven** — vsechno co specialist-loader potrebuje je v `specialist.json`. Zadna magie, zadny convention-over-configuration.
3. **Idempotentni lifecycle** — `install()` spustit 2x = bezpecne. `enable()` na enabled = noop. Zadna operace nemuze rozbit DB.
4. **Data survive disable** — `disable()` zachova data. Pouze `uninstall({ purge: true })` maze data.
5. **Zero-restart enable/disable/update** — zapnuti/vypnuti/aktualizace specialisty nevyzaduje restart serveru. ESM cache busting zajistuje nacteni noveho kodu.
6. **Rollback-ready update** — DB verze se commituje AZ po uspesnem re-enable. Migrace s `down()` se rollbackuji pri selhani.
7. **Future-proof manifest** — `specialist.json` obsahuje pole `future` pro budouci capability extraction. Ted se nepouzivaji, ale neblokuji refaktoring.

---

## Package format

```
specialists/
  accountant-cz/                     <- domenovy specialista (finance)
    specialist.json                  <- manifest (povinny)
    index.js                         <- entry point: register(ctx) / unregister(ctx)
    adapters.js                      <- ToolAdapter implementace (v75)
    tools/                           <- deterministicke tool funkce
      tax-calc.js
      vat-calc.js
      salary-calc.js
      deadline-checker.js
      tax-rates.js
    knowledge/                       <- knowledge pack data
      tax-rates.js
    migrations/                      <- DB schema per specialist (v1 prazdne)
    tests/                           <- testy (nespousti se pri install)

  dummy-logger/                      <- utility specialista (testing)
    specialist.json
    index.js
    tools/
      format-entry.js
    migrations/
      001_create_event_log.js
```

### Pravidla

- Adresar v `specialists/` = jeden specialista
- Nazev adresare = `specialist.json → id`
- `specialist.json` a `index.js` jsou jedine povinne soubory
- Vsechny importy v `index.js` jsou relativni k baliku (zadne `../` ven z baliku)
- Specialista NESMI importovat moduly jineho specialisty primo
- Migrace MUSI mit `down()` funkci pro rollback-ready update

---

## Manifest — specialist.json

### Priklad: accountant-cz

```json
{
  "id": "accountant-cz",
  "version": "1.0.0",
  "name": "Ucetni specialista (CZ)",
  "description": "OSVC danova evidence, DPH, pojistne, compliance, reporty",
  "author": "c3-core",
  "domain": "finance",
  "type": "domain",
  "engine": ">=65.0.0",
  "entry": "./index.js",
  "tools": [
    { "id": "accountant.tax_calculator", "name": "Danova kalkulacka", "module": "./tools/tax-calc.js", "function": "calculateTax" },
    { "id": "accountant.vat_calculator", "name": "Kalkulacka DPH", "module": "./tools/vat-calc.js", "function": "calculateVAT" },
    { "id": "accountant.salary_calculator", "name": "Mzdova kalkulacka", "module": "./tools/salary-calc.js", "function": "calculateSalary" },
    { "id": "accountant.deadline_checker", "name": "Danove terminy", "module": "./tools/deadline-checker.js", "function": "checkDeadlines" },
    { "id": "accountant.compare_tax_entities", "name": "Porovnani OSVC vs s.r.o.", "module": "./tools/tax-calc.js", "function": "compareTaxEntities" }
  ],
  "expertises": ["accountant"],
  "knowledge_packs": ["tax-rates"],
  "migrations": [],
  "dependencies": {},
  "settings": { "default_entity_type": "osvc", "default_tax_regime": "actual" },
  "enabledByDefault": true,
  "future": {
    "capabilities": ["tax.calculate", "tax.compare", "vat.compute", "salary.compute", "deadline.check"],
    "notes": "Reserved for capability extraction in Phase 3"
  }
}
```

### Priklad: dummy-logger

```json
{
  "id": "dummy-logger",
  "version": "1.0.0",
  "name": "Dummy Logger",
  "domain": "utility",
  "type": "utility",
  "engine": ">=65.0.0",
  "entry": "./index.js",
  "tools": [{ "id": "logger.format_entry", "name": "Format Log Entry", "module": "./tools/format-entry.js", "function": "formatLogEntry" }],
  "expertises": ["logger"],
  "migrations": ["001_create_event_log"],
  "enabledByDefault": true
}
```

### Validacni pravidla

| Pole | Typ | Povinne | Validace |
|------|-----|---------|----------|
| `id` | string | ano | `^[a-z0-9-]+$`, max 64 znaku, unikatni |
| `version` | string | ano | semver format (X.Y.Z) |
| `name` | string | ano | max 128 znaku |
| `domain` | string | ano | `^[a-z0-9_]+$` |
| `type` | enum | ne | `domain` \| `utility` \| `integration` |
| `engine` | string | ano | semver range (e.g. `>=65.0.0`) |
| `entry` | string | ano | relativni cesta k index.js |
| `tools` | array | ne | viz Tool schema nize |
| `expertises` | array | ne | ID pro registraci v runtime |
| `migrations` | array | ne | nazvy migracnich souboru (bez cesty) |
| `dependencies` | object | ne | `{ "specialist-id": ">=semver" }` |
| `enabledByDefault` | bool | ne | default `false` |

### Tool schema (v manifestu)

```json
{
  "id": "string (required, unique across all specialists)",
  "name": "string (required)",
  "module": "string (required, relative path)",
  "function": "string (required, exported function name)"
}
```

Intent patterns a param extractory nejsou v manifestu — jsou v `index.js` (kod, ne konfigurace).

---

## Lifecycle operace

### Stavy

```
  ┌───────────┐
  │  ABSENT   │ ← balik neexistuje na disku
  └─────┬─────┘
        │ discoverAll() + installPending()
        v
  ┌───────────┐
  │ INSTALLED │ ← v DB, migrace spusteny, ale NE registrovany v runtime
  └─────┬─────┘
        │ enable()
        v
  ┌───────────┐
  │  ENABLED  │ ← tools registrovany v ToolRegistry, aktivni
  └─────┬─────┘
        │ disable()                           │ update()
        v                                     v
  ┌───────────┐                         ┌───────────┐
  │ DISABLED  │ ← tools odregistrovany  │ UPDATING  │ ← disable → migrate → cache bust → re-enable
  └───────────┘                         └───────────┘
```

### enable(specialistId)

1. `_checkDependencies()` — vsechny dependencies musi byt installed + enabled + version satisfied
2. Nacti `index.js` pres `import()` (s cache bust pokud po update)
3. `index.js` exportuje `register(ctx)` funkci
4. Zavolej `register(ctx)` — `ctx = { runtime, db, manifest, specialistDir, logger }`
5. Specialist registruje tools, patterns, extractors do runtime
6. Seed knowledge packs do KnowledgeBase
7. Update DB: `status = 'enabled'`, `enabled_at = now()`
8. Telemetry: `record('lifecycle.enable', { specialistId })`

**Idempotence:** Pokud uz enabled → noop.
**Zero-restart:** ANO. Dynamicky `import()` + registrace do pamatovych registru.

### disable(specialistId)

1. `getDependents()` — odmitne pokud jini specialiste zavisi na tomto
2. Zavolej `mod.unregister(ctx)` (pokud existuje)
3. Defensivni cleanup — `runtime.unregisterSpecialist(expertiseId)`
4. Odregistruj scenare ze ScenarioRegistry
5. Smaz modul z cache (`_modules.delete(id)`)
6. Update DB: `status = 'disabled'`, `disabled_at = now()`
7. Telemetry: `record('lifecycle.disable', { specialistId })`
8. **DATA ZUSTAVAJI** — tabulky, knowledge facts, specialist_memory — vsechno

**Zero-restart:** ANO. Ciste odebrani z pameti.

---

## Update flow (rollback-ready)

### Sekvence

```
update(specialistId)
  │
  ├─ 1. Validace: nova verze > stara (semver), engine kompatibilita
  │
  ├─ 2. Kontrola reversibility: maji nove migrace down()?
  │     └─ result.reversible = true/false
  │
  ├─ 3. Snapshot pre-update stavu
  │     └─ { oldVersion, oldManifest, oldStatus }
  │
  ├─ 4. Safety guard: isSpecialistBusy() — neupdate pokud bezi tools
  │
  ├─ 5. Clear tool module caches (runtime._moduleCache + _importVersions)
  │
  ├─ 6. Disable (pokud byl enabled)
  │     └─ unregister tools, cleanup, _modules.delete
  │
  ├─ 7. Mark for cache bust (_needsCacheBust.add)
  │
  ├─ 8. Run new migrations (track applied for rollback)
  │     └─ migrationsApplied = ['001_add_table', ...]
  │
  ├─ 9. Re-enable (pokud byl enabled) — PRED DB commit
  │     │
  │     ├─ SUCCESS → pokracuj na krok 10
  │     │
  │     └─ FAILURE →
  │           ├─ reversible? → _rollbackMigrations(migrationsApplied)
  │           │                 down() v obráceném poradi, smaz z tracking
  │           ├─ irreversible? → log warning, migrace zustavaji
  │           ├─ status = 'disabled'
  │           └─ throw Error s detaily
  │
  └─ 10. DB version commit — POUZE po uspesnem re-enable
        └─ updateVersion(newVersion, manifest, id)
```

### Klicovy princip

**DB verze se commituje AZ po uspesnem re-enable.** Pokud re-enable selze:
- Reversibilni migrace se rollbackuji pres `down()`
- Specialist zustane disabled s puvodní verzi v DB
- Operator muze obnovit stary kod a znovu enable

### _checkMigrationsReversible()

Pred update skenuje nove migrace (ty co jeste nejsou v DB). Pro kazdou importuje modul a zkontroluje `typeof mod.down === 'function'`. Pokud nektera nema `down()` → `reversible = false`.

### _rollbackMigrations()

Spousti `down()` v obráceném poradi v transakci. Kazda rollbacknuta migrace se smaze z `specialist_migrations` tabulky.

---

## Specialist Loader

`src/specialists/specialist-loader.js` — startuje pri bootu serveru.

### Boot sekvence

```
Server start (src/server.js)
  │
  ├─ getSpecialistLoader(db, specialistRuntime)
  │
  └─ loader.boot()
       │
       ├─ discoverAll()                      ← scan specialists/
       │     │
       │     └─ pro kazdy adresar:
       │           ├─ nacti specialist.json
       │           ├─ validateManifest()
       │           ├─ checkEngineCompat()
       │           └─ over ze entry point existuje
       │
       ├─ installPending()                   ← nove nalezene → DB
       │     │
       │     └─ pro kazdy novy:
       │           ├─ _runMigrations() (collect pending)
       │           └─ insert do specialists tabulky
       │
       ├─ enableAll()                        ← enabled v DB
       │     │
       │     ├─ _topologicalSort()           ← Kahn's algorithm (dependency order)
       │     │
       │     ├─ _executePendingMigrations()  ← async, ESM import
       │     │
       │     └─ pro kazdy enabled (v topo order):
       │           ├─ _checkDependencies()
       │           ├─ _enableOne(id, { manifest, dir })
       │           │     ├─ import(index.js) (s cache bust pokud po update)
       │           │     ├─ mod.register(ctx)
       │           │     └─ seed knowledge packs
       │           └─ count++
       │
       ├─ checkIntegrity()                   ← post-boot verifikace
       │     ├─ DB enabled == runtime registered?
       │     └─ zadne ghost registrace?
       │
       └─ telemetry.record('lifecycle.boot', { count })
```

### API

```javascript
class SpecialistLoader {
  constructor(db, runtime, options = {})

  // ─── Discovery
  discoverAll()                         // → SpecialistManifest[]

  // ─── Lifecycle
  async enable(specialistId)            // → void (checks dependencies first)
  disable(specialistId)                 // → void (checks dependents first, sync)
  async update(specialistId)            // → { oldVersion, newVersion, wasEnabled, reversible } | null

  // ─── Boot
  installPending()                      // install new, skip existing (sync)
  async enableAll()                     // topo sort → enable all with status='enabled'
  async boot()                          // discoverAll + installPending + enableAll + checkIntegrity

  // ─── Query
  getInstalled()                        // → SpecialistRow[]
  getEnabled()                          // → SpecialistRow[]
  getManifest(specialistId)             // → SpecialistManifest | null
  getDependents(specialistId)           // → string[] (IDs that depend on this)
  checkIntegrity()                      // → { ok: boolean, issues: string[] }
}
```

---

## Specialist Runtime

`src/expertises/specialist-runtime.js` — orchestrace detect → execute → wrap.

### Architektura

```
SpecialistRuntime
  ├─ ToolRegistry        tools Map, moduleCache, importVersions
  ├─ IntentDetector      pattern matching: input → tool
  ├─ ToolExecutor        lazy-load module, call function, inject KB
  ├─ SessionParamCache   volatile param cache per session (TTL 30min)
  ├─ _memory             SpecialistMemory (D4, injected)
  ├─ _telemetry          SpecialistTelemetry (v82, injected)
  └─ _executingCount     busy guard per specialist
```

### API

```javascript
class SpecialistRuntime {
  registerSpecialist(config)            // registruj tools do registry
  unregisterSpecialist(specialistId)    // odregistruj
  isSpecialist(expertiseId)             // → boolean
  getSpecialistIds()                    // → string[]
  getSpecialistConfig(expertiseId)      // → { id, domain, tools[] } | null
  clearModuleCache(specialistId)        // smaz tool cache + bump import version
  isSpecialistBusy(expertiseId)         // → boolean (execution counter > 0)
  setKnowledgeBase(kb)                  // inject D2 KnowledgeBase
  setMemory(memory)                     // inject D4 SpecialistMemory
  setTelemetry(telemetry)              // inject v82 SpecialistTelemetry
  async tryToolExecution(expertiseId, input, { sessionId, conversationId })
    // → { toolType, result, params, duration }
    // → { status: 'clarify', missingParams, toolType, params }
    // → null (no match → fallback to LLM)
}
```

### Tool execution pipeline

```
tryToolExecution(expertiseId, input, { sessionId, conversationId })
  │
  ├─ registry.getSpecialist(expertiseId)
  │
  ├─ detector.detect(input, specialist)   ← pattern matching
  │     └─ pro kazdy tool (by priority):
  │           └─ patterns.some(p => p.test(input))
  │                 └─ match → extractParams(input) → { tool, params }
  │
  ├─ SessionParamCache: merge with previous params (TTL 30min)
  │     └─ pokud no match ale cached params → contextual re-execution
  │
  ├─ _executingCount++ (busy guard)
  │
  ├─ ToolAdapter path (v75):
  │     ├─ adapter.validate(params)      → clarify pokud chybi required
  │     ├─ adapter.normalize(params)     → defaults, year fallback, sanity
  │     ├─ adapter.execute(params)       → fn(args) → result
  │     └─ adapter.validateResult(result) → post-execution sanity
  │
  ├─ Legacy path (no adapter):
  │     ├─ registry.loadToolFunction(tool) ← lazy import (s cache bust)
  │     ├─ adapter ? adapter(params) : params
  │     └─ fn(args) → result
  │
  ├─ _memory.processWrites() ← pokud result.memoryWrites present
  │
  ├─ _telemetry.record('tool.success', { toolId, durationMs })
  │
  ├─ _executingCount-- (finally)
  │
  └─ return { toolType, result, params, duration }
```

---

## ToolAdapter Contract (v75)

`specialists/accountant-cz/adapters.js` — base class pro tool validation + normalization.

### Pipeline

```
validate(params)       → check required params → { status: 'clarify' } pokud chybi
normalize(params)      → apply defaults, year fallback, sanity cap (maxAmount)
execute(params)        → call actual tool function (override in subclass)
validateResult(result) → post-execution sanity checks (override per tool)
run(params)            → full pipeline (called by ToolExecutor)
```

### Config

```javascript
{
  required: ['gross_income'],         // MUST be present → clarify if missing
  defaults: { entity_type: 'osvc' },  // fallback values
  supportedYears: [2024, 2025],       // year fallback to latest
  maxAmount: 1_000_000_000            // sanity cap (anti-extraction bug)
}
```

### Return statuses

- `{ status: 'ok', data }` — uspech
- `{ status: 'ok', data, meta: { warnings } }` — uspech s non-critical warningy
- `{ status: 'clarify', missingParams: ['entity_type'] }` — chybi vstupy → zeptej se uzivatele
- `{ status: 'error', error: 'AMOUNT_UNREALISTIC', message: '...' }` — neopravitelna chyba

### Accountant-cz adaptery

| Adapter | Validace vysledku |
|---------|-------------------|
| TaxCalculatorAdapter | net + tax = gross, effective_rate < 80%, net_income > 0 for income ≥ 300k |
| VATCalculatorAdapter | base + vat = total, vat ≥ 0 |
| SalaryCalculatorAdapter | net < gross, net_to_gross_ratio 50-95% |
| DeadlineCheckerAdapter | deadlines array not empty |
| CompareAdapter | osvc/sro results present, winner valid |

---

## Specialist Memory — D4 (v79)

`src/expertises/specialist-memory.js` — DB-backed persistent context per specialist + conversation.

### Kontrakt

Tools pisi do memory **explicitnim opt-in**: `result.memoryWrites = [{ key, value, type }]`. ToolExecutor po uspesnem vykonani zavola `_memory.processWrites()`.

### API

```javascript
class SpecialistMemory {
  get(specialistId, conversationId, key)           // → parsed value | null
  getAll(specialistId, conversationId)             // → { key: value }
  getContext(specialistId, conversationId)          // → formatted string pro prompt injection | null
  set(specialistId, conversationId, key, value, valueType='string')
  processWrites(specialistId, conversationId, writes[])  // bulk write from tool result
  delete(specialistId, conversationId, key)
  clear(specialistId, conversationId)
  count(specialistId, conversationId)
  setTelemetry(telemetry)                          // inject passive telemetry (v82)
}
```

### Value types

string, number, boolean, json (auto-parsed pri cteni)

### Telemetry

memory.hit, memory.miss, memory.write — count only, NEVER keys/values (PII protection)

---

## Specialist Telemetry (v82)

`src/telemetry/specialist-telemetry.js` — pasivni observability.

### Contract

**NEVER throws, NEVER blocks, NEVER changes control flow.** Best-effort.

### Event types

| Event | Kdy |
|-------|-----|
| tool.match | Pattern match nalezeny |
| tool.success | Tool uspesne vykonan |
| tool.fail | Tool selhal |
| tool.clarify | Tool vyzaduje dalsi vstupy |
| memory.hit | Memory key nalezeny |
| memory.miss | Memory key nenalezeny |
| memory.write | Memory key zapsan |
| lifecycle.boot | Specialist system booted |
| lifecycle.enable | Specialist enabled |
| lifecycle.disable | Specialist disabled |
| api.request | REST API request |

### Storage

In-memory queue (max 500, hard limit 2000) → periodic flush (30s) → SQLite `specialist_telemetry` table.

### API

```javascript
const telemetry = getSpecialistTelemetry(db);  // singleton (or NOOP sentinel if db=null)

telemetry.record(eventType, { specialistId, toolId, durationMs, metadata })
telemetry.getSummary({ specialistId, since })   // → { events, byType, bySpecialist, toolSuccessRate, memoryHitRate }
telemetry.flush()                                // manual flush
telemetry.shutdown()                             // stop timer, flush remaining
```

### Metadata pravidla

- Never keys or values (PII protection)
- Only op type, counts, durations
- Max 1KB per entry, truncated if exceeded

### Retention

30d startup pruning via centralized `telemetry-retention.js`.

---

## Dependency System (v79)

### Manifest deklarace

```json
{
  "dependencies": {
    "other-specialist-id": ">=1.0.0"
  }
}
```

### Enforcement

| Operace | Check |
|---------|-------|
| `enable()` | `_checkDependencies()` — all deps must be installed + enabled + version satisfied |
| `disable()` | `getDependents()` — refuses if other specialists depend on this one |
| `boot()` | `_topologicalSort()` (Kahn's algorithm) — guarantees load order |

### Aktualni stav

accountant-cz a dummy-logger nemaji zadne dependency. System je pripraven pro budouci multi-specialist chains.

---

## DB schema

### specialists tabulka (v74)

```sql
CREATE TABLE IF NOT EXISTS specialists (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'domain'
    CHECK (type IN ('domain', 'utility', 'integration')),
  status TEXT NOT NULL DEFAULT 'installed'
    CHECK (status IN ('installed', 'enabled', 'disabled')),
  manifest_json TEXT NOT NULL,
  installed_at TEXT DEFAULT (datetime('now')),
  enabled_at TEXT,
  disabled_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_specialists_status ON specialists(status);
CREATE INDEX IF NOT EXISTS idx_specialists_domain ON specialists(domain);
```

### specialist_migrations tabulka (v74)

```sql
CREATE TABLE IF NOT EXISTS specialist_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now')),
  UNIQUE(specialist_id, migration_name)
);
```

### specialist_memory tabulka (v79)

```sql
CREATE TABLE IF NOT EXISTS specialist_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  specialist_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now')),
  UNIQUE(specialist_id, conversation_id, key)
);
```

### specialist_telemetry tabulka (v82)

```sql
CREATE TABLE IF NOT EXISTS specialist_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  specialist_id TEXT,
  tool_id TEXT,
  duration_ms INTEGER,
  metadata TEXT,
  created_at DATETIME DEFAULT (datetime('now'))
);
```

### Prehled migraci

| Migrace | Verze | Tabulky |
|---------|-------|---------|
| `012_v74_specialists.js` | v74 | specialists, specialist_migrations |
| `015_v79_specialist_memory.js` | v79 | specialist_memory |
| `018_v82_specialist_telemetry.js` | v82 | specialist_telemetry |

---

## Migration namespacing

### Reseni

1. Specialist migrace se sleduji v `specialist_migrations` tabulce (ODDELENA od core `schema_migrations`)
2. Nazev migrace je relativni k specialistovi
3. Pri instalaci se spousti v poradi z manifestu
4. Pri rollback se spousti `down()` v obráceném poradi

### Priklad

```
specialists/dummy-logger/migrations/
  001_create_event_log.js    ← tracked as specialist_id='dummy-logger', name='001_create_event_log'
```

### Format migrace

```javascript
export function up(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_log (...)`);
}

export function down(db) {      // POVINNE pro rollback-ready update
  db.exec(`DROP TABLE IF EXISTS event_log`);
}
```

### Proc `down()` je dulezite

Migrace BEZ `down()` = ireversibilni update. Pokud re-enable po update selze, migrace NELZE rollbackovat. Update() vraci `reversible: false` flag a error message explicitne uvadi "Migrations NOT rolled back (irreversible)."

---

## ESM cache busting

### Problem

Node.js ESM `import()` cachuje moduly po URL. Po aktualizaci souboru na disku vrati `import(path)` stary kod.

### Reseni: Dual-layer cache

1. **ToolRegistry._moduleCache** — interni cache (path:fn → function)
   - Maze se pres `clearModuleCache(specialistId)`
   - Nastavuje `_importVersions[modulePath]++`

2. **Node ESM cache** — bypass pres query param
   ```javascript
   const url = pathToFileURL(tool.modulePath);
   url.searchParams.set('v', String(bustVersion));
   mod = await import(url.href);
   // → file:///path/to/echo.js?v=3
   ```
   Node.js vidi `?v=3` jako jiny modul nez `?v=2`.

3. **Entry point cache bust** — specialist-loader pouziva `_needsCacheBust` Set
   ```javascript
   // _enableOne():
   if (needsBust) {
     const url = pathToFileURL(entryPath);
     url.searchParams.set('v', Date.now());
     mod = await import(url.href);
   }
   ```

### Overeno testy

Test 27 (cache bust): v1 vraci `v1-output` → update → v2 vraci `v2-output` bez restartu.

---

## Integration points

### 1. Server boot (`src/server.js`)

```javascript
import { getSpecialistLoader } from './specialists/specialist-loader.js';
import { specialistRuntime } from './expertises/specialist-runtime.js';
import { getSpecialistTelemetry } from './telemetry/specialist-telemetry.js';
import { SpecialistMemory } from './expertises/specialist-memory.js';

const specialistTelemetry = getSpecialistTelemetry(db.db);
const specialistMemory = new SpecialistMemory(db.db);
specialistMemory.setTelemetry(specialistTelemetry);
specialistRuntime.setMemory(specialistMemory);
specialistRuntime.setTelemetry(specialistTelemetry);
specialistRuntime.setKnowledgeBase(knowledgeBase);

const specialistLoader = getSpecialistLoader(db.db, specialistRuntime);
await specialistLoader.boot();
```

### 2. ToolRegistry (specialist-runtime.js)

Specialista pri `enable()` zaregistruje tools pres `index.js`:

```javascript
// specialists/accountant-cz/index.js
export function register(ctx) {
  ctx.runtime.registerSpecialist({
    id: 'accountant',
    domain: 'finance',
    tools: [{
      id: 'accountant.tax_calculator',
      modulePath: path.join(__dirname, 'tools', 'tax-calc.js'),
      functionName: 'calculateTax',
      adapter: new TaxCalculatorAdapter(),
      patterns: [{ priority: 2, patterns: [/dan[ěe]\s+.{0,20}osv[čc]/i, ...] }],
      extractParams: (input) => ({ ... }),
    }],
  });
}

export function unregister(ctx) {
  ctx.runtime.unregisterSpecialist('accountant');
}
```

### 3. ExpertiseHandler (src/chat/handlers/expertise.js)

```javascript
if (specialistRuntime.isSpecialist(expertise.id)) {
  const toolResult = await specialistRuntime.tryToolExecution(expertise.id, input, {
    sessionId: context.sessionId,
    conversationId: context.conversationId,
  });

  if (toolResult) {
    if (toolResult.status === 'clarify') {
      // inject into LLM prompt → ask user for missing params
      context.toolClarification = { tool: toolResult.toolType, missingParams: ... };
    } else {
      // wrap with expert persona → human-readable formatting
      return generateExpertiseResponse(..., { toolResult });
    }
  }
  // toolResult === null → no tool match → fall through to LLM synthesis
}
```

### 4. ScenarioEngine (src/expertises/scenario-engine.js)

```javascript
// conversation.js — before CRE
if (scenarioRunner.isActive(sessionId)) {
  return scenarioRunner.handleInput(sessionId, input);
}

// expertise.js — after tool execution fallback
const trigger = scenarioRegistry.detectTrigger(expertiseId, input);
if (trigger) {
  return scenarioRunner.start(sessionId, trigger, conversationId);
}
```

### 5. Integrity check

Post-boot a on-demand verifikace:
- Kazdy enabled specialist musi byt registrovany v runtime
- Kazdy registrovany v runtime musi byt enabled v DB
- Zadne ghost registrace

---

## Verze a kompatibilita

### Engine version check

Lightweight inline parser (ne semver lib). Podporuje `>=X.Y.Z` format.

### Specialist version update

| Zmena | Version bump | Migrace |
|-------|-------------|---------|
| Bug fix v tool logice | PATCH (1.0.1) | zadna |
| Novy tool pridany | MINOR (1.1.0) | volitelna |
| Nova DB tabulka | MINOR (1.1.0) | nova migrace s down() |
| Breaking zmena | MAJOR (2.0.0) | migrace + manual review |

### Update pravidla

- Nova verze MUSI byt vetsi nez stara (strict semver compare)
- Downgrade je zakazany (vraci null)
- Busy specialist nelze update (isSpecialistBusy guard)
- DB verze se commituje AZ po uspesnem re-enable
- Dependencies musi byt satisfied pred enable

---

## Testy

`tests/specialist-loader.test.js` — 270 assertions, 41 test blocks.

### Pokryti

| Blok | Testy | Popis |
|------|-------|-------|
| 1-4 | Discovery | Manifest validace, engine compat, installPending |
| 5-10 | Enable/Disable | Full boot, disable, re-enable, manifest, tool paths |
| 11-16 | Runtime isolation | Real SpecialistRuntime, tool execution, VAT cycle, integrity, idempotence, 200-cycle stress |
| 17-26 | Multi-specialist | Oba specialiste (accountant + logger), cross-isolation, selective re-enable, migration idempotency, 50-cycle alternating stress |
| 27-35 | Update flow | Cache bust, migration update, disabled update, cross-isolation, noop, downgrade reject, major version, persistence, busy guard |
| 36-41 | Rollback-ready | Reversibility check, irreversible detection, migration rollback on failure, irreversible stays, DB commit order, recovery |

---

## IDE integrace

### REST API (8 endpoints, v82)

```
GET    /api/specialists              → seznam vsech (vcetne tools summary)
GET    /api/specialists/:id          → detail (manifest + status + runtime)
POST   /api/specialists/:id/enable   → enable (mutex lock)
POST   /api/specialists/:id/disable  → disable (check dependents)
POST   /api/specialists/:id/update   → update (rollback-ready)
POST   /api/specialists/discover     → re-scan disk
GET    /api/specialists/:id/integrity → runtime/DB consistency check
GET    /api/specialists/telemetry    → telemetry summary (?specialist=X&since=Y)
```

Vsechny wrappovane `withApiTelemetry()` pro pasivni latency observability.

### Phase 2: Specialist dashboard widgets (future)

Kazdy specialista by mohl registrovat vlastni widget do IDE dashboardu. CRUD wizard (E1) v planu.

---

## Budouci: Distribution

### Phase 1 (ted): Lokalni baliky

Specialiste jsou soubory na disku v `specialists/`. Instalace = zkopiruj adresar.

### Phase 2: Git-based distribution (D9)

```bash
c3 specialist install https://github.com/c3-specialists/accountant-cz.git
```

### Phase 3: Registry (marketplace)

```bash
c3 specialist search accountant
c3 specialist install accountant-cz
c3 specialist update accountant-cz
```

---

## Aktivni specialiste

| Specialist | Verze | Domain | Typ | Tools | Migrace | Dependencies | Status |
|-----------|-------|--------|-----|-------|---------|-------------|--------|
| accountant-cz | 1.0.0 | finance | domain | 5 (+5 adapters) | 0 | none | enabled |
| dummy-logger | 1.0.0 | utility | utility | 1 | 1 | none | enabled |

---

*Aktualizovano: 2026-03-01*
*Engine: c3-agent v90.0.0*
