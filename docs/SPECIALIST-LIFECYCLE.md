# Specialist Lifecycle Contract v1

**Verze:** v1.0 (2026-02-22)
**Status:** Spec — implementace pending

Viz take: [SPECIALISTS.md](SPECIALISTS.md) | [EXPERTISES.md](EXPERTISES.md) | [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Obsah

1. [Principy](#principy)
2. [Package format](#package-format)
3. [Manifest — specialist.json](#manifest--specialistjson)
4. [Lifecycle operace](#lifecycle-operace)
5. [Specialist Loader](#specialist-loader)
6. [DB schema — specialists tabulka](#db-schema--specialists-tabulka)
7. [Migration namespacing](#migration-namespacing)
8. [Integration points](#integration-points)
9. [Verze a kompatibilita](#verze-a-kompatibilita)
10. [IDE integrace](#ide-integrace)
11. [Budouci: Distribution](#budouci-distribution)

---

## Principy

1. **Modularni monolit** — specialista je jeden self-contained balik. Uvnitr separovany soubory, ven jeden package. Zadny orchestrator, zadne capability registry.
2. **Manifest-driven** — vsechno co specialist-loader potrebuje je v `specialist.json`. Zadna magie, zadny convention-over-configuration.
3. **Idempotentni lifecycle** — `install()` spustit 2x = bezpecne. `enable()` na enabled = noop. Zadna operace nemuze rozbit DB.
4. **Data survive disable** — `disable()` zachova data. Pouze `uninstall({ purge: true })` maze data.
5. **Zero-restart enable/disable** — zapnuti/vypnuti specialisty nevyzaduje restart serveru. Instalace/odinstalace ANO (kvuli migraci).
6. **Future-proof manifest** — `specialist.json` obsahuje pole `future` pro budouci capability extraction. Ted se nepouzivaji, ale neblokuji refaktoring.

---

## Package format

```
specialists/
  accountant-cz/
    specialist.json          <- manifest (povinny)
    index.js                 <- entry point (povinny)
    tools/                   <- deterministicke tool funkce
      tax-calc.js
      vat-calc.js
      salary-calc.js
      deadline-checker.js
    knowledge/               <- knowledge pack data
      tax-rates.js
    enforcement/             <- tool enforcement pravidla
      tool-enforcement.js
    migrations/              <- DB schema per specialist
      001_ledger_core.js
      002_period_locks.js
      003_vat_engine.js
      004_compliance.js
    scenarios/               <- guided workflow definice
      annual-filing.js
    tests/                   <- testy (nespousti se pri install)
      tax-calc.test.js
```

### Pravidla

- Adresar v `specialists/` = jeden specialista
- Nazev adresare = `specialist.json → id`
- `specialist.json` a `index.js` jsou jedine povinne soubory
- Vsechny importy v `index.js` jsou relativni k baliku (zadne `../` ven z baliku)
- Specialista NESMI importovat moduly jineho specialisty primo

---

## Manifest — specialist.json

```json
{
  "id": "accountant-cz",
  "version": "1.0.0",
  "name": "Ucetni specialista (CZ)",
  "description": "OSVC danova evidence, DPH, pojistne, compliance, reporty",
  "author": "c3-core",
  "domain": "finance",
  "type": "domain",
  "license": "proprietary",

  "engine": ">=65.0.0",

  "entry": "./index.js",

  "tools": [
    {
      "id": "accountant.tax_calculator",
      "name": "Danova kalkulacka",
      "module": "./tools/tax-calc.js",
      "function": "calculateTax"
    },
    {
      "id": "accountant.vat_calculator",
      "name": "Kalkulacka DPH",
      "module": "./tools/vat-calc.js",
      "function": "calculateVAT"
    },
    {
      "id": "accountant.salary_calculator",
      "name": "Mzdova kalkulacka",
      "module": "./tools/salary-calc.js",
      "function": "calculateSalary"
    },
    {
      "id": "accountant.deadline_checker",
      "name": "Danove terminy",
      "module": "./tools/deadline-checker.js",
      "function": "checkDeadlines"
    },
    {
      "id": "accountant.compare_tax_entities",
      "name": "Porovnani OSVC vs s.r.o.",
      "module": "./tools/tax-calc.js",
      "function": "compareTaxEntities"
    }
  ],

  "expertises": ["accountant"],

  "knowledge_packs": ["tax-rates"],

  "scenarios": ["annual-filing"],

  "migrations": [
    "001_ledger_core",
    "002_period_locks",
    "003_vat_engine",
    "004_compliance"
  ],

  "settings": {
    "default_entity_type": "osvc",
    "default_tax_regime": "actual"
  },

  "enabledByDefault": true,

  "future": {
    "capabilities": [
      "tax.calculate",
      "tax.compare",
      "vat.compute",
      "salary.compute",
      "deadline.check",
      "ledger.record",
      "ledger.report",
      "compliance.check"
    ],
    "notes": "Reserved for capability extraction in Phase 3 (multi-specialist reuse)"
  }
}
```

### Validacni pravidla

| Pole | Typ | Povinne | Validace |
|------|-----|---------|----------|
| `id` | string | ano | `^[a-z0-9-]+$`, max 64 znaku, unikatni |
| `version` | string | ano | semver format (X.Y.Z) |
| `name` | string | ano | max 128 znaku |
| `description` | string | ne | max 500 znaku |
| `author` | string | ne | max 64 znaku |
| `domain` | string | ano | `^[a-z0-9_]+$` |
| `type` | enum | ano | `domain` \| `utility` \| `integration` |
| `engine` | string | ano | semver range (e.g. `>=65.0.0`) |
| `entry` | string | ano | relativni cesta k index.js |
| `tools` | array | ne | viz Tool schema nize |
| `expertises` | array | ne | ID existujicich expertise definic |
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
        │ install()
        v
  ┌───────────┐
  │ INSTALLED │ ← balik na disku, migrace spusteny, ale NE registrovany
  └─────┬─────┘
        │ enable()
        v
  ┌───────────┐
  │  ENABLED  │ ← tools registrovany v ToolRegistry, aktivni
  └─────┬─────┘
        │ disable()
        v
  ┌───────────┐
  │ DISABLED  │ ← tools odregistrovany, data zachovana
  └─────┬─────┘
        │ uninstall()
        v
  ┌───────────┐
  │  ABSENT   │
  └───────────┘
```

### install(specialistPath)

1. Nacti `specialist.json`, validuj schema
2. Over kompatibilitu engine verze
3. Spust migrace z `migrations/` (namespaced — viz sekce Migration namespacing)
4. Vloz zaznam do `specialists` tabulky (status = `installed`)
5. Pokud `enabledByDefault: true`, automaticky zavolej `enable()`

**Idempotence:** Pokud uz nainstalovany se stejnou verzi → noop. Pokud nova verze → `update()`.

**Chyba pri migraci:** Rollback transakce, zaznam nevytvoren, throw error.

### enable(specialistId)

1. Nacti `index.js` pres `import()`
2. `index.js` exportuje `register(runtime)` funkci
3. Zavolej `register(specialistRuntime)` — registruje tools, patterns, extractors
4. Pokud ma knowledge packs → seeduj do KnowledgeBase
5. Pokud ma scenarios → registruj do ScenarioRegistry
6. Update DB: `status = 'enabled'`, `enabled_at = now()`

**Idempotence:** Pokud uz enabled → noop (nereregistruj).

**Zero-restart:** ANO. Dynamicky `import()` + registrace do pamatovych registru.

### disable(specialistId)

1. Odregistruj tools z ToolRegistry (`unregisterSpecialist(id)`)
2. Odregistruj scenare ze ScenarioRegistry
3. Update DB: `status = 'disabled'`, `disabled_at = now()`
4. **DATA ZUSTAVAJI** — tabulky, knowledge facts, compliance checks, vsechno

**Zero-restart:** ANO. Ciste odebrani z pameti.

### uninstall(specialistId, { purge = false })

1. Pokud `enabled` → nejdriv `disable()`
2. Pokud `purge: false` (default):
   - Smaz zaznam ze `specialists` tabulky
   - **DATA ZUSTAVAJI** v DB (entity_profiles, entries, compliance_checks...)
   - Log: "Specialist removed, data preserved"
3. Pokud `purge: true`:
   - Spust `down()` migrace v OBRÁCENÉM poradi
   - Smaz vsechna data vcetne tabulek
   - Smaz knowledge facts s `specialist_id = X`
   - Log: "Specialist purged — all data deleted"
4. Smaz soubory z `specialists/` adresare

**Potvrzeni:** `purge: true` VYZADUJE explicitni potvrzeni od uzivatele.

### update(specialistId, newPath)

1. Over `specialist.json` nove verze
2. Over ze nova verze > stara (semver compare)
3. Disable starého specialistu
4. Spust NOVE migrace (ty co nejsou v `specialist_migrations` tabulce)
5. Nahrad soubory na disku
6. Enable nového specialistu
7. Update DB: `version`, `updated_at`

**Bez down-migrace** pri update. Nove migrace jsou additivni (ALTER TABLE ADD COLUMN, CREATE TABLE IF NOT EXISTS). Destruktivni zmeny vyžaduji major version bump + manualni migraci.

---

## Specialist Loader

`src/specialists/specialist-loader.js` — startuje pri bootu serveru.

### Boot sekvence

```
Server start
  │
  ├─ runMigrations(db)                    ← core schema
  │
  ├─ specialistLoader.discoverAll()       ← scan specialists/
  │     │
  │     ├─ pro kazdy adresar:
  │     │     ├─ nacti specialist.json
  │     │     ├─ validuj manifest
  │     │     └─ over engine kompatibilitu
  │     │
  │     └─ return validSpecialists[]
  │
  ├─ specialistLoader.installPending()    ← nove nalezene
  │     │
  │     └─ pro kazdy novy:
  │           ├─ spust migrace
  │           └─ insert do specialists tabulky
  │
  ├─ specialistLoader.enableAll()         ← enabled v DB
  │     │
  │     └─ pro kazdy enabled:
  │           ├─ import(index.js)
  │           ├─ register(runtime)
  │           ├─ seed knowledge
  │           └─ register scenarios
  │
  └─ Server ready
```

### API

```javascript
class SpecialistLoader {
  constructor(db, runtime, options = {}) {
    this.db = db;
    this.runtime = runtime;              // SpecialistRuntime instance
    this.baseDir = options.baseDir || path.join(ROOT, 'specialists');
  }

  // ─── Discovery ─────────────────────────────────
  async discoverAll()                    // → SpecialistManifest[]
  async validateManifest(manifest)       // → { valid: boolean, errors: string[] }

  // ─── Lifecycle ─────────────────────────────────
  async install(specialistPath)          // → { id, version, status }
  async enable(specialistId)             // → void
  async disable(specialistId)            // → void
  async uninstall(id, { purge })         // → void
  async update(id, newPath)              // → { oldVersion, newVersion }

  // ─── Boot ──────────────────────────────────────
  async installPending()                 // install new, skip existing
  async enableAll()                      // enable all with status='installed'|'enabled'

  // ─── Query ─────────────────────────────────────
  getInstalled()                         // → SpecialistRow[]
  getEnabled()                           // → SpecialistRow[]
  getManifest(specialistId)              // → SpecialistManifest | null
}
```

---

## DB schema — specialists tabulka

```sql
CREATE TABLE IF NOT EXISTS specialists (
  id TEXT PRIMARY KEY,                              -- manifest id
  version TEXT NOT NULL,                            -- semver
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'domain',
  status TEXT NOT NULL DEFAULT 'installed'
    CHECK (status IN ('installed', 'enabled', 'disabled')),
  manifest_json TEXT NOT NULL,                      -- full specialist.json
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
  migration_name TEXT NOT NULL,                     -- e.g. '001_ledger_core'
  applied_at TEXT DEFAULT (datetime('now')),
  UNIQUE(specialist_id, migration_name)
);
```

Tato tabulka je ODDELENA od `schema_migrations` (core). Kazdy specialista ma vlastni namespace.

---

## Migration namespacing

### Problem

Core migrace jsou v `src/db/migrations/` a sledovane v `schema_migrations`.
Specialist migrace jsou v `specialists/{id}/migrations/` a muzou kolidovat.

### Reseni

1. Specialist migrace se sledují v **separatni tabulce** `specialist_migrations`
2. Nazev migrace je relativni k specialistovi (ne globalni timestamp)
3. Pri instalaci se spousti v poradi souboru (lexicographic sort)
4. Pri uninstall + purge se spousti `down()` v obráceném poradi

### Priklad

```
specialists/accountant-cz/migrations/
  001_ledger_core.js          ← tracked as specialist_id='accountant-cz', name='001_ledger_core'
  002_period_locks.js
  003_vat_engine.js
  004_compliance.js
```

### Format migrace (stejny jako core)

```javascript
export const version = '001';
export const description = 'Ledger core tables';

export function up(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ...`);
}

export function down(db) {      // POVINNE pro specialist migrace (core je optional)
  db.exec(`DROP TABLE IF EXISTS ...`);
}
```

### Proc `down()` je povinne

Core migrace nemaji `down()` protoze core se neodinstaluje. Specialist migrace MUSI mit `down()` protoze `uninstall({ purge: true })` musi umet smazat vsechna data.

---

## Integration points

### 1. ToolRegistry (specialist-runtime.js)

Specialista pri `enable()` zaregistruje tools pres `index.js`:

```javascript
// specialists/accountant-cz/index.js
export function register(runtime) {
  runtime.registerSpecialist({
    id: 'accountant',
    domain: 'finance',
    tools: [
      {
        id: 'accountant.tax_calculator',
        name: 'Danova kalkulacka',
        modulePath: new URL('./tools/tax-calc.js', import.meta.url).pathname,
        functionName: 'calculateTax',
        patterns: [/* ... */],
        extractParams: (input) => { /* ... */ },
      },
      // ... dalsi tools
    ],
  });
}

export function unregister(runtime) {
  runtime.unregisterSpecialist('accountant');
}
```

**Zmena v SpecialistRuntime:** pridat `unregisterSpecialist(id)` metodu.

### 2. ExpertiseRegistry (expertise-layer.js)

Specialista muze deklarovat ze "vlastni" jednu nebo vice existujicich builtin expertises. Nebo muze registrovat vlastni expertise definici.

Ted: expertise 'accountant' je builtin v `expertise-layer.js`.
Budoucne: presune se do baliku specialisty.

**Phase 1:** specialist jen deklaruje `expertises: ['accountant']` — nic se nedeje, jen metadata.
**Phase 2:** specialist registruje vlastni ExpertiseAgent pri enable().

### 3. KnowledgeBase (knowledge-base.js)

Pri `enable()` se seeduji knowledge packs:

```javascript
// V specialist-loader.js enable() implementaci:
if (manifest.knowledge_packs?.length) {
  const knowledgeModule = await import(
    path.join(specialistDir, 'knowledge', 'tax-rates.js')
  );
  knowledgeModule.seed(knowledgeBase);
}
```

Pri `disable()` knowledge facts ZUSTAVAJI (jsou uzitecne i bez aktivniho specialisty).
Pri `uninstall({ purge: true })` se mazou facts s `specialist_id = X`.

### 4. ScenarioRegistry (scenario-engine.js)

```javascript
// V index.js:
export function registerScenarios(scenarioRegistry) {
  scenarioRegistry.register({
    id: 'annual-filing',
    specialistId: 'accountant',
    // ...
  });
}
```

### 5. Enforcement (tool-enforcement.js)

Tool enforcement pravidla se registruji spolu s tools. Zustava soucasti `index.js → register()`.

---

## Verze a kompatibilita

### Engine version check

```javascript
// specialist-loader.js
const semver = await import('semver'); // nebo lightweight inline parser

function checkEngineCompat(manifest) {
  const engineVersion = getC3Version(); // z package.json
  if (!semver.satisfies(engineVersion, manifest.engine)) {
    throw new Error(
      `Specialist ${manifest.id} requires engine ${manifest.engine}, ` +
      `but running ${engineVersion}`
    );
  }
}
```

### Specialist version update

| Zmena | Version bump | Migrace |
|-------|-------------|---------|
| Bug fix v tool logice | PATCH (1.0.1) | zadna |
| Novy tool pridany | MINOR (1.1.0) | volitelna |
| Nova DB tabulka | MINOR (1.1.0) | nova migrace |
| Breaking zmena API | MAJOR (2.0.0) | migrace + manual review |
| Smazana DB tabulka | MAJOR (2.0.0) | migrace s data preservation |

### Backward compatibility

- PATCH a MINOR updaty jsou vzdy bezpecne (`update()` spusti nove migrace)
- MAJOR updaty vyzaduji explicitni potvrzeni
- Nikdy se nespousti `down()` pri update — pouze `up()` novych migraci

---

## IDE integrace

### Phase 1: Seznam + toggle

IDE zobrazi v settings/sidebar:

```
Specialiste
  ┌─────────────────────────────────────┐
  │ ✅ Ucetni (CZ)         v1.0.0      │
  │    finance · 5 tools · enabled      │
  │    [Disable] [Uninstall]            │
  ├─────────────────────────────────────┤
  │ ⬚ Pravni poradce (CZ)  v0.1.0      │
  │    legal · 3 tools · disabled       │
  │    [Enable] [Uninstall]             │
  └─────────────────────────────────────┘
```

### API endpoints

```
GET    /api/specialists              → seznam vsech
GET    /api/specialists/:id          → detail (manifest + status)
POST   /api/specialists/:id/enable   → enable
POST   /api/specialists/:id/disable  → disable
DELETE /api/specialists/:id          → uninstall (query: ?purge=true)
POST   /api/specialists/install      → install (body: { path } nebo upload)
```

### Phase 2: Specialist dashboard widgets

ZATIM NEREALIZOVAT. Kazdy specialista by mohl registrovat vlastni widget do IDE dashboardu (napr. danovy prehled, compliance status). Ale to vyzaduje widget framework v IDE, ktery zatim neexistuje.

---

## Budouci: Distribution

### Phase 1 (ted): Lokalni baliky

Specialiste jsou soubory na disku v `specialists/`. Instalace = zkopiruj adresar.

### Phase 2: Git-based distribution

```bash
c3 specialist install https://github.com/c3-specialists/accountant-cz.git
```

Specialist loader clonuje repo do `specialists/`, spusti install().

### Phase 3: Registry (marketplace)

```json
// https://registry.c3agent.dev/index.json
{
  "specialists": [
    {
      "id": "accountant-cz",
      "name": "Ucetni specialista (CZ)",
      "version": "1.2.0",
      "download_url": "https://registry.c3agent.dev/packages/accountant-cz-1.2.0.tar.gz",
      "checksum": "sha256:..."
    }
  ]
}
```

```bash
c3 specialist search accountant
c3 specialist install accountant-cz
c3 specialist update accountant-cz
c3 specialist list
```

---

## Prehled souboru k implementaci

| Soubor | Popis | Priorita |
|--------|-------|----------|
| `src/specialists/specialist-loader.js` | Loader + lifecycle manager | P0 |
| `src/db/migrations/012_specialists.js` | DB tabulky specialists + specialist_migrations | P0 |
| `specialists/accountant-cz/specialist.json` | Manifest pro ucetniho | P0 |
| `specialists/accountant-cz/index.js` | Entry point (register/unregister) | P0 |
| `src/routes/specialists.js` | REST API endpoints | P1 |
| `specialist-runtime.js` (edit) | Pridat `unregisterSpecialist()` | P1 |

### Migrace existujiciho kodu

Presun z hardcoded → manifest-driven:

1. Presun accountant registrace ze `specialist-runtime.js` ř.313–455 do `specialists/accountant-cz/index.js`
2. Presun accountant tools ze `src/expertises/tools/` do `specialists/accountant-cz/tools/`
3. Presun accountant migraci ze `src/db/migrations/008-011` do `specialists/accountant-cz/migrations/`
4. Presun `tax-rates.js` do `specialists/accountant-cz/knowledge/`
5. Aktualizuj importy v testech

**Toto je refaktoring, ne rewrite.** Zadna zmena logiky, jen presun souboru + aktualizace cest.

---

*Generovano: 2026-02-22*
*Engine: c3-agent v65.5.0*
