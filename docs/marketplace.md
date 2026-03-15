# Marketplace — Dokumentace (v124)

> Vzdálený katalog balíčků pro skills, expertises a specialists.
> Browse → Install → Update → Uninstall s dependency managementem.

---

## Obsah

1. [Přehled](#přehled)
2. [Entity v Marketplace](#entity-v-marketplace)
3. [Architektura](#architektura)
4. [Katalog](#katalog)
5. [Instalační pipeline](#instalační-pipeline)
6. [Dependency Management](#dependency-management)
7. [Security Model](#security-model)
8. [REST API](#rest-api)
9. [Frontend (IDE)](#frontend-ide)
10. [Konfigurace](#konfigurace)
11. [Databáze](#databáze)
12. [Structured Logging](#structured-logging)
13. [Budoucí rozšíření](#budoucí-rozšíření)

---

## Přehled

Marketplace umožňuje uživatelům procházet, instalovat, aktualizovat a odinstalovat balíčky ze vzdáleného katalogu. Podporuje tři typy balíčků:

- **Skills** — JSON definiční soubory (pravidla, workflow patterns)
- **Expertises** — JS objekty s konfigurací chování (doména, capabilities, tone)
- **Specialists** — kompletní balíčky (tar.gz) s manifestem, kódem, nástroji a znalostmi

Každý typ má vlastní instalační pipeline přizpůsobenou jeho runtime modelu.

---

## Entity v Marketplace

### Skill (JSON)

Nejjednodušší entita. Jedná se o JSON soubor s definicí dovednosti.

```json
{
  "id": "code-review",
  "name": "Revize kódu",
  "description": "Automatická revize kódu s best practices",
  "version": "1.0.0",
  "steps": [...]
}
```

**Instalace**: Download → uložení do `skills/<id>.json` → `skillRegistry.reload()`.

**Odinstalace**: Smazání souboru → `skillRegistry.reload()`.

### Expertise (JS objekt)

Konfigurace chování AI — doména, capabilities, tone, modifiers, system prompt.

```json
{
  "id": "security-audit",
  "name": "Bezpečnostní audit",
  "domain": "security",
  "description": "Expertíza zaměřená na bezpečnostní analýzu",
  "capabilities": { "reasoning": 90, "creativity": 20, "determinism": 95 },
  "tone": "professional",
  "temperature": 0.2,
  "systemPrompt": "Jsi bezpečnostní expert..."
}
```

**Instalace**: Download → parse JSON → `expertiseRegistry.addCustom(config)` → DB záznam.

**Odinstalace**: `expertiseRegistry.removeCustom(id)` → DB smazání.

### Specialist (tar.gz)

Nejkomplexnější entita. Kompletní balíček s manifestem, kódem, nástroji, znalostmi a expertízou.

```
specialist-package.tar.gz
├── specialist.json          # Manifest (povinný)
├── index.js                 # Hlavní kód
├── tools/                   # Vlastní nástroje
├── knowledge/               # Znalostní báze
└── ledger/                  # Specifické moduly (volitelné)
```

**Manifest (specialist.json)**:
```json
{
  "id": "translator",
  "name": "Překladatel",
  "version": "1.0.0",
  "manifestVersion": 2,
  "engine": ">=121.0.0",
  "capabilities": ["translation.text", "translation.document"],
  "defaultExpertise": { "domain": "translation", "tone": "professional" },
  "dependencies": ["skill:glossary>=1.0.0"],
  "permissions": ["tool:web-search"]
}
```

**Instalace (transactional)**:
1. Download → streaming SHA-256 verify → size check (50 MB limit)
2. Extract do `specialists/.installing/<id>/` (dočasný adresář)
3. Validace manifestu (engine kompatibilita, permissions, required APIs)
4. Atomic rename `.installing/<id>/` → `specialists/<id>/`
5. `specialistLoader.discoverAll()` → `installPending()` → `enable()`
6. DB záznam (pouze po úspěšném enable)

**Rollback** při selhání: cleanup temp dir → disable → remove DB → cleanup soubory.

---

## Architektura

```
catalog.json (GitHub / CDN)
        │
        ▼
MarketplaceClient ──── ETag cache (4h TTL) ──── SQLite
  │  fetch mutex (_fetchPromise)                 marketplace_catalog_cache
  │  offline fallback
  │
  ▼
PackageInstaller ──── per-package mutex ──── SQLite
  │  transactional install/rollback              marketplace_packages
  │  dependency resolver (DFS)
  │
  ├── _installSkill()      → skills/<id>.json → skillRegistry.reload()
  ├── _installExpertise()  → expertiseRegistry.addCustom()
  └── _installSpecialist() → .installing/ → atomic rename → loader.enable()
```

### Soubory

| Soubor | LOC | Popis |
|--------|-----|-------|
| `src/marketplace/marketplace-client.js` | ~250 | Fetch, cache, download, hash, archive validation |
| `src/marketplace/package-installer.js` | ~350 | Transactional install, rollback, mutex, dependency resolver |
| `src/routes/marketplace.js` | ~180 | REST API, enrichment, pagination |
| `src/db/migrations/2026_03_12_035_v124_marketplace.js` | ~30 | DB migrace |

---

## Katalog

### Schema

Katalog je JSON soubor s pevnou strukturou:

```json
{
  "schema": 1,
  "version": 1,
  "updated": "2026-03-12T00:00:00Z",
  "packages": {
    "skills": [
      {
        "id": "code-review",
        "name": "Revize kódu",
        "description": "Automatická revize kódu s best practices",
        "version": "1.0.0",
        "author": "c3-community",
        "tags": ["code", "review"],
        "downloadUrl": "https://cdn.example.com/skills/code-review-1.0.0.json",
        "sha256": "abc123...",
        "size": 2048,
        "engine": ">=120.0.0",
        "dependencies": [],
        "conflicts": [],
        "publishedAt": "2026-03-12T00:00:00Z"
      }
    ],
    "expertises": [...],
    "specialists": [...]
  }
}
```

### Validace

Při každém fetchi se validuje:
- `schema` — musí být číslo
- `packages` — musí existovat
- `packages.skills`, `packages.expertises`, `packages.specialists` — musí být pole
- Každá položka musí mít `id` (string)
- **`sha256` je povinné** pro vzdálené balíčky (od v126) — bez hash se download odmítne

### Cache

- **TTL**: 4 hodiny (konfigurabilní)
- **ETag**: If-None-Match header pro conditional fetch
- **Offline fallback**: Při výpadku sítě se vrátí stará cache. Pokud cache neexistuje, vrátí se prázdný katalog s `_offline: true`.
- **Fetch mutex**: Souběžné requesty na catalog sdílejí jeden fetch (`_fetchPromise` pattern).

### Enrichment

API vrací katalog obohacený o instalační stav:

```json
{
  "id": "code-review",
  "type": "skill",
  "installed": true,
  "installedVersion": "1.0.0",
  "updateAvailable": false,
  ...
}
```

- `installed` — je balíček nainstalovaný?
- `installedVersion` — která verze je nainstalovaná
- `updateAvailable` — je v katalogu novější verze? (semver porovnání, ne string)

---

## Instalační pipeline

### Skill

```
downloadPackage(entry, skillsDir)
  → uloží do skills/<id>.pkg
  → fs.rename → skills/<id>.json
  → skillRegistry.reload()
  → _recordInstall(entry, 'skill')
```

### Expertise

```
downloadPackage(entry, .tmp/marketplace/)
  → parse JSON
  → config.id = entry.id, config.isCustom = true
  → expertiseRegistry.addCustom(config)
  → _recordInstall(entry, 'expertise')
  → cleanup temp dir
```

### Specialist (transactional)

```
1. downloadPackage(entry, .tmp/marketplace/)
   → streaming SHA-256 verify
   → size check (50 MB max)

2. extractArchive(archive, specialists/.installing/<id>/)
   → tar -tzf: validate paths (traversal, symlinks, hardlinks, devices)
   → tar xzf to target

3. Validate manifest
   → specialist.json must exist
   → engine compatibility check

4. Atomic rename
   → .installing/<id>/ → specialists/<id>/

5. Enable
   → specialistLoader.discoverAll()
   → installPending()
   → enable()

6. DB write (after successful enable)
   → _recordInstall(entry, 'specialist')

ROLLBACK (on any failure):
   → rm -rf .installing/<id>/
   → specialistLoader.disable(id).catch(() => {})
   → DB cleanup
   → rm -rf specialists/<id>/
```

### Idempotent install

Pokud je již nainstalovaná stejná verze, vrátí se `{ ok: true, alreadyInstalled: true }` bez downloadu.

### Mutex

Každý install/uninstall/update je chráněn per-package mutexem (`Map<string, Promise>` klíčovaný `${type}:${id}`). Souběžné operace na stejném balíčku jsou serializovány.

---

## Dependency Management

### Specifikace závislostí

Formát: `type:id>=version` (semver range).

```json
{
  "dependencies": [
    "skill:code-review>=1.0.0",
    "expertise:security>=1.0.0"
  ],
  "conflicts": [
    "specialist:legacy-review"
  ]
}
```

### Resolver

`resolveDependencies(entry, catalog)`:

1. Parse dependency specs
2. Kontrola nainstalovaných (isInstalled + version satisfies)
3. Rekurzivní resolve chybějících závislostí
4. Detekce cyklických závislostí (DFS s `inStack` setem)
5. Detekce konfliktů (conflicts pole)
6. Vrací topologicky seřazený seznam k instalaci

### Install s dependencemi

`installWithDependencies(entry)`:

1. `resolveDependencies()` → topologický seznam
2. Instalace chybějících deps v pořadí (expertise → skill → specialist)
3. Instalace cílového balíčku

### Uninstall protection

`checkDependents(type, id)`:

- Prohledá DB nainstalovaných balíčků, které odkazují na `type:id` ve svých dependencích
- Pokud jsou nalezeni dependenti, uninstall je blokován s chybou:
  `{ error: 'Cannot uninstall: used by specialist:my-specialist' }`

---

## Security Model

### Archive protection (specialists)

- **Path traversal**: Všechny cesty v tar archivu jsou validovány — `resolved.startsWith(base + path.sep)`
- **Symlinks/hardlinks/device nodes**: Rejektovány — povoleny pouze `file` a `directory`
- **Validace před extrakcí**: `tar -tzf` na listing, validace, teprve pak `tar xzf`

### Streaming SHA-256 (povinné od v126)

Hash se počítá během downloadu přes `crypto.createHash('sha256')` napojený na write stream. Žádný separátní read pass. Po downloadu se porovná s `entry.sha256`.

**Od v126 je SHA-256 povinný** pro všechny vzdálené balíčky. Katalogové záznamy bez `sha256` pole budou odmítnuty s chybou `"refusing unverified remote package"`. Stažený soubor je smazán před vyhozením výjimky.

Dále: Package ID je validováno proti null bytes (`\0`) a délkovému limitu (max 128 znaků) — viz `package-installer.js:168`.

### Size limit

50 MB max. Stream se abortuje při překročení:

```javascript
let size = 0;
response.body.on('data', chunk => {
  size += chunk.length;
  if (size > MAX_SIZE) { controller.abort(); throw new Error('Package too large'); }
});
```

### Manifest validace

Specialist manifest musí projít validací před enable — kontrola engine kompatibility, permissions, required APIs.

### Catalog schema validace

Strukturální kontrola před použitím — `schema`, `packages`, required fields per entry.

---

## REST API

### Endpointy

| Endpoint | Metoda | Popis |
|----------|--------|-------|
| `/api/marketplace/catalog` | GET | Enrichovaný katalog s paginací |
| `/api/marketplace/catalog/refresh` | POST | Force re-fetch katalogu |
| `/api/marketplace/installed` | GET | Seznam nainstalovaných balíčků |
| `/api/marketplace/install/:type/:id` | POST | Instalace s dependency resolution |
| `/api/marketplace/installed/:type/:id` | DELETE | Odinstalace (s dependency check) |
| `/api/marketplace/update/:type/:id` | POST | Update na nejnovější verzi |
| `/api/marketplace/export/:type/:id` | POST | Export lokální entity jako marketplace balíček |

### Pagination

```
GET /api/marketplace/catalog?page=1&limit=50&type=skills
```

Response:
```json
{
  "items": [...],
  "page": 1,
  "totalPages": 3,
  "total": 142
}
```

### Error responses

```json
{ "error": "Not installed: skill/code-review" }
{ "error": "Cannot uninstall: used by specialist:translator" }
{ "error": "Marketplace not initialized" }
```

### Export / Publish

`POST /api/marketplace/export/:type/:id` — exportuje lokální expertízu nebo specialistu jako marketplace-kompatibilní balíček.

**Expertise export**: Vrátí JSON s konfigurací + vygenerovaný `catalogEntry` pro zařazení do katalogu.

**Specialist export**: Vytvoří `tar.gz` archiv ze `specialists/<id>/` adresáře, spočítá SHA-256 hash, vrátí metadata + `catalogEntry`.

Response:
```json
{
  "ok": true,
  "type": "specialist",
  "id": "translator",
  "name": "Překladatel",
  "version": "1.0.0",
  "sha256": "abc123...",
  "size": 45678,
  "files": 12,
  "catalogEntry": {
    "id": "translator",
    "name": "Překladatel",
    "description": "...",
    "version": "1.0.0",
    "author": "local",
    "tags": ["translation.text"],
    "sha256": "abc123...",
    "size": 45678,
    "engine": ">=121.0.0",
    "dependencies": [],
    "conflicts": []
  }
}
```

V IDE: Tlačítko **"Publikovat"** v detail panelu expertízy/specialisty. Po kliknutí se katalogový záznam zkopíruje do schránky — uživatel ho pak může vložit do PR do marketplace katalogu.

---

## Frontend (IDE)

### Navigace

- **Sidebar**: Nová položka "Obchod" s ikonou store
- **Každá sekce** (Expertízy, Specialisté, Workeri): Tlačítko "Marketplace" vedle "Nový" → přesměruje do marketplace s předvybraným tabem

### Marketplace view

1. **Header**: "Marketplace" + offline badge + "Obnovit" tlačítko
2. **Sub-taby**: `Dovednosti (N)` | `Expertízy (N)` | `Specialisté (N)` s počty
3. **Vyhledávání**: Client-side filter přes name/description/tags
4. **Card grid**: Kartičky s:
   - Název, popis, tagy, verze, autor
   - Badge "NOVÉ" (< 7 dní od publishedAt)
   - Badge "NAINSTALOVÁNO" / "AKTUALIZACE"
   - Tlačítko "Nainstalovat" / "Aktualizovat" přímo na kartičce
5. **Detail panel**: Po kliknutí na kartičku — ID, typ, verze, autor, popis, engine, velikost, závislosti, stav
6. **Akce v detail panelu**: Nainstalovat / Odinstalovat / Aktualizovat
7. **Progress**: Stavové labely při instalaci (Stahuji/Ověřuji/Extrahuji/Aktivuji)
8. **Toast**: Zelený (úspěch) / červený (chyba) feedback
9. **Pagination**: Předchozí/Další pokud >50 položek

### Potvrzení instalace

Před instalací se zobrazí confirm dialog s informacemi o balíčku a jeho závislostech.

---

## Konfigurace

```javascript
// src/config.js
config.marketplace = {
  catalogUrl: process.env.C3_MARKETPLACE_URL
    || 'https://raw.githubusercontent.com/c3-community/marketplace/main/catalog.json',
};
```

| Proměnná | Default | Popis |
|----------|---------|-------|
| `C3_MARKETPLACE_URL` | GitHub raw URL | URL vzdáleného katalogu |

---

## Databáze

### marketplace_packages

```sql
CREATE TABLE marketplace_packages (
  id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('skill', 'expertise', 'specialist')),
  name TEXT,
  version TEXT,
  author TEXT,
  description TEXT,
  tags TEXT,           -- JSON array
  dependencies TEXT,   -- JSON array of "type:id>=ver"
  download_url TEXT,
  sha256 TEXT,
  catalog_data TEXT,   -- full entry JSON for offline
  installed_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (id, type)
);
```

### marketplace_catalog_cache

```sql
CREATE TABLE marketplace_catalog_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
  catalog_json TEXT NOT NULL,
  fetched_at TEXT DEFAULT (datetime('now')),
  etag TEXT
);
```

---

## Structured Logging

| Event | Úroveň | Popis |
|-------|--------|-------|
| `marketplace.catalog.fetch` | INFO | Fetch katalogu (success/fail/cached) |
| `marketplace.install.start` | INFO | Instalace zahájena |
| `marketplace.install.success` | INFO | Instalace dokončena |
| `marketplace.install.fail` | ERROR | Instalace selhala + důvod |
| `marketplace.install.rollback` | ERROR | Rollback spuštěn |
| `marketplace.hash.mismatch` | WARN | SHA-256 verifikace selhala |
| `marketplace.update` | INFO | Balíček aktualizován |
| `marketplace.uninstall` | INFO | Balíček odinstalován |
| `marketplace.dependency.resolve` | INFO | Výsledek dependency resolution |
| `marketplace.dependency.blocked` | WARN | Uninstall blokován dependenty |

---

## Budoucí rozšíření

Následující funkce jsou **architektonicky připraveny**, ale out of scope pro v124:

- **Catalog signing**: ed25519 podepisování (`catalog.json` + `catalog.sig`)
- **Central CDN**: relativní URL v katalogu, CDN cache
- **Registry optimalizace**: `registry.add()`/`.remove()` místo `.reload()`
- **Targeted discovery**: `loader.discoverOne(id)` místo full scan
- **Observability**: install success rate, download errors, catalog latency metrics
- **Rating/reviews**: Hodnocení a recenze balíčků v katalogu
- **Auto-update**: Automatická aktualizace při dostupnosti nové verze
