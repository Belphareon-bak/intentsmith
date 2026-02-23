# Specialist Lifecycle Contract v2

**Verze:** v2.0 (2026-02-22)
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
8. [DB schema](#db-schema)
9. [Migration namespacing](#migration-namespacing)
10. [ESM cache busting](#esm-cache-busting)
11. [Integration points](#integration-points)
12. [Verze a kompatibilita](#verze-a-kompatibilita)
13. [Testy](#testy)
14. [IDE integrace](#ide-integrace)
15. [Budouci: Distribution](#budouci-distribution)

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

1. Nacti `index.js` pres `import()` (s cache bust pokud po update)
2. `index.js` exportuje `register(ctx)` funkci
3. Zavolej `register(ctx)` — `ctx = { runtime, db, manifest, specialistDir, logger }`
4. Specialist registruje tools, patterns, extractors do runtime
5. Update DB: `status = 'enabled'`, `enabled_at = now()`

**Idempotence:** Pokud uz enabled → noop.
**Zero-restart:** ANO. Dynamicky `import()` + registrace do pamatovych registru.

### disable(specialistId)

1. Zavolej `mod.unregister(ctx)` (pokud existuje)
2. Defensivni cleanup — `runtime.unregisterSpecialist(expertiseId)`
3. Odregistruj scenare ze ScenarioRegistry
4. Smaz modul z cache (`_modules.delete(id)`)
5. Update DB: `status = 'disabled'`, `disabled_at = now()`
6. **DATA ZUSTAVAJI** — tabulky, knowledge facts, vsechno

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

### ESM cache busting

Viz sekce [ESM cache busting](#esm-cache-busting).

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
       │     ├─ _executePendingMigrations()  ← async, ESM import
       │     │
       │     └─ pro kazdy enabled:
       │           ├─ _enableOne(id, { manifest, dir })
       │           │     ├─ import(index.js) (s cache bust pokud po update)
       │           │     └─ mod.register(ctx)
       │           └─ count++
       │
       └─ checkIntegrity()                   ← post-boot verifikace
             ├─ DB enabled == runtime registered?
             └─ zadne ghost registrace?
```

### API

```javascript
class SpecialistLoader {
  constructor(db, runtime, options = {})

  // ─── Discovery
  discoverAll()                         // → SpecialistManifest[]

  // ─── Lifecycle
  async enable(specialistId)            // → void
  disable(specialistId)                 // → void (sync)
  async update(specialistId)            // → { oldVersion, newVersion, wasEnabled, reversible } | null

  // ─── Boot
  installPending()                      // install new, skip existing (sync)
  async enableAll()                     // enable all with status='enabled'
  async boot()                          // discoverAll + installPending + enableAll + checkIntegrity

  // ─── Query
  getInstalled()                        // → SpecialistRow[]
  getEnabled()                          // → SpecialistRow[]
  getManifest(specialistId)             // → SpecialistManifest | null
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
  ├─ ToolExecutor        lazy-load module, call function
  └─ _executingCount     busy guard per specialist
```

### API

```javascript
class SpecialistRuntime {
  registerSpecialist(config)            // registruj tools do registry
  unregisterSpecialist(specialistId)    // odregistruj
  isSpecialist(expertiseId)             // → boolean
  getSpecialistIds()                    // → string[]
  clearModuleCache(specialistId)        // smaz tool cache + bump import version
  isSpecialistBusy(expertiseId)         // → boolean (execution counter > 0)
  async tryToolExecution(expertiseId, input)  // → { toolType, result, params, duration } | null
  getSpecialistConfig(expertiseId)      // → { id, domain, tools[] } | null
}
```

### Tool execution pipeline

```
tryToolExecution(expertiseId, input)
  │
  ├─ registry.getSpecialist(expertiseId)
  ├─ detector.detect(input, specialist)   ← pattern matching
  │     └─ pro kazdy tool (by priority):
  │           └─ patterns.some(p => p.test(input))
  │                 └─ match → extractParams(input) → { tool, params }
  │
  ├─ _executingCount++ (busy guard)
  │
  ├─ executor.execute(tool, params)
  │     ├─ registry.loadToolFunction(tool)  ← lazy import (s cache bust)
  │     ├─ adapter ? adapter(params) : params
  │     └─ fn(args) → result
  │
  ├─ _executingCount-- (finally)
  │
  └─ return { toolType, result, params, duration }
```

---

## DB schema

### specialists tabulka

```sql
CREATE TABLE IF NOT EXISTS specialists (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'domain',
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

### specialist_migrations tabulka

```sql
CREATE TABLE IF NOT EXISTS specialist_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now')),
  UNIQUE(specialist_id, migration_name)
);
```

Tato tabulka je ODDELENA od `schema_migrations` (core). Kazdy specialista ma vlastni namespace.

---

## Migration namespacing

### Reseni

1. Specialist migrace se sleduji v `specialist_migrations` tabulce
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

### 1. Server boot (`src/server.js:126-135`)

```javascript
import { getSpecialistLoader } from './specialists/specialist-loader.js';
import { specialistRuntime } from './expertises/specialist-runtime.js';

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
  const toolResult = await specialistRuntime.tryToolExecution(expertise.id, input);
  // toolResult → { toolType, result, params, duration }
}
```

### 4. Integrity check

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

### Phase 1: Seznam + toggle (API ready)

```
GET    /api/specialists              → seznam vsech
GET    /api/specialists/:id          → detail (manifest + status)
POST   /api/specialists/:id/enable   → enable
POST   /api/specialists/:id/disable  → disable
POST   /api/specialists/:id/update   → update (re-discover + apply)
```

### Phase 2: Specialist dashboard widgets

Zatim nerealizovat. Kazdy specialista by mohl registrovat vlastni widget do IDE dashboardu.

---

## Budouci: Distribution

### Phase 1 (ted): Lokalni baliky

Specialiste jsou soubory na disku v `specialists/`. Instalace = zkopiruj adresar.

### Phase 2: Git-based distribution

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

| Specialist | Verze | Domain | Typ | Tools | Migrace | Status |
|-----------|-------|--------|-----|-------|---------|--------|
| accountant-cz | 1.0.0 | finance | domain | 5 | 0 | enabled |
| dummy-logger | 1.0.0 | utility | utility | 1 | 1 | enabled |

---

*Aktualizovano: 2026-02-22*
*Engine: c3-agent v65.5.0*
