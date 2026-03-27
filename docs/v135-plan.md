# C3 Agent — Revizní plán v135

**Datum:** 2026-03-27
**Aktuální verze:** v133.0.0
**Cíl:** v135.0.0
**Přístup:** Happy mosseying — stabilizace, polish, dotažení nedokončených pilířů

---

## Kontext

Po intenzivním sprint období v104–v133 (execution engine, model upgrade, marketplace, security hardening) je C3 feature-complete ve 4 z 6 pilířů. Zbývající dva pilíře (IDE 78%, Produkt 25%) a technický dluh vyžadují pozornost před další feature expanzí.

v135 je **konsolidační release** — žádné nové velké subsystémy, ale dotažení rozpracovaného, vyčištění a příprava na wider adoption.

---

## v134: Kódová hygiena + Developer Experience

### 134.1 — ESLint + Prettier setup
- [ ] `.eslintrc.json` — flat config, ESM, Node 22 globals
- [ ] `.prettierrc` — single-quote, trailing comma, 120 line width
- [ ] `npm run lint` + `npm run format` v package.json
- [ ] Ignorovat `c3-ide/` (vlastní build systém)
- [ ] Postupný lint fix — začít s `src/core/`, `src/config.js`, `src/server.js`
- **Odhad**: ~2h setup + iterativní čištění

### 134.2 — Version consistency automation
- [ ] `scripts/bump-version.js` — updatne package.json + CLAUDE.md + README.md header najednou
- [ ] `scripts/doc-stats.js` — generuje aktuální čísla (soubory, řádky, testy, migrace, specialisté, skills)
- [ ] Volitelně: git pre-tag hook volající bump skript
- **Odhad**: ~1h

### 134.3 — Vyřešit kritické TODOs
- [ ] `src/executor/tool-executor.js:1252` — sandbox integrace (nebo explicitně zdokumentovat proč ne)
- [ ] `src/executor/tool-executor.js:1271` — database service integrace
- [ ] `src/notifications/feedback.js:243` — resolve agent name z repository
- [ ] `src/expertises/tools/tax-rates.js` — ověřit sazby 2025 (MPSV, pojistné)
- [ ] `src/chat/controller.js:1967` — wire summarizer nebo odstranit TODO
- **Odhad**: ~3h

### 134.4 — server.js refactor
- [ ] Extrahovat bootstrap sekvenci do `src/bootstrap.js`
- [ ] Každý subsystém: `{ name, init(), shutdown(), healthCheck() }` interface
- [ ] Structured startup log (tabulka subsystém → status → čas)
- [ ] Cíl: server.js pod 400 řádků
- **Odhad**: ~4h

---

## v135: Pilíř 5 (IDE) + Pilíř 6 (Produkt) push

### 135.1 — IDE: Specialist CRUD wizard
- [ ] Nový Theia extension `c3-specialist-wizard`
- [ ] Create / Edit / Delete specialist z IDE
- [ ] Propojení s `create-specialist` skill
- [ ] Live preview manifest.json
- **Odhad**: ~6h

### 135.2 — IDE: Stage/Unstage + Approve All
- [ ] Git stage/unstage akce v diff vieweru
- [ ] Cumulative "Approve All" pro milestone checkpointy
- [ ] Keyboard shortcuts
- **Odhad**: ~4h

### 135.3 — Produkt: Electron builder + distribuce
- [ ] Ověřit existující Docker setup (Dockerfile + compose) — funguje?
- [ ] Electron builder config pro Linux AppImage
- [ ] Volitelně: macOS DMG, Windows NSIS (pokud je cross-compile reálný)
- [ ] Aktualizovat INSTALL.md s binary distribucí
- **Odhad**: ~8h

### 135.4 — Produkt: Installer flow
- [ ] First-run wizard vylepšení — auto-detect Ollama, navrhnout modely podle VRAM
- [ ] One-click model pull z setup wizardu
- [ ] Progress bar pro stahování modelů (WS bridge)
- **Odhad**: ~4h

### 135.5 — Workers: dotažení na 100%
- [ ] Audit zbývajících 5% — identifikovat co chybí (pravděpodobně edge cases v B7/B9)
- [ ] Doplnit chybějící testy
- [ ] Aktualizovat ROADMAP.md na 100%
- **Odhad**: ~2h

---

## Průřezové úkoly (v134–v135)

### CI/CD
- [ ] `.github/workflows/test.yml` — `npm test` na push + PR
- [ ] `.github/workflows/lint.yml` — ESLint check
- [ ] Badge do README.md (test status, verze)
- **Odhad**: ~2h

### Mega-soubory (postupně, ne najednou)
Soubory k postupnému rozložení přes v134–v135:

| Soubor | Řádky | Strategie |
|--------|-------|-----------|
| `registry.js` | 5,132 | Rozdělit na category-based registry moduly |
| `cre-decision.js` | 4,104 | Extrahovat guards → `cre-guards.js`, patterns → `cre-patterns.js` |
| `architect.js` | 3,757 | Rozdělit UI komponenty |
| `controller.js` | 2,170 | Extrahovat middleware chain |
| `database.js` | 1,908 | Schema per doména |

Priorita: `cre-decision.js` a `registry.js` (nejvíc editované, nejvíc merge conflicty).
- **Odhad**: ~8h celkem (2 soubory v v134, 3 v v135)

### Testovací infrastruktura
- [ ] Zvážit migraci na Vitest (nativní ESM, watch mode, coverage)
- [ ] Pokud ne Vitest: přidat coverage reporting do harness.js
- [ ] JUnit XML output pro CI
- **Odhad**: ~4h (evaluace + rozhodnutí + implementace)

### Dokumentace
- [ ] Aktualizovat ROADMAP.md na v133+ stav
- [ ] CHANGELOG.md — doplnit v128–v133 záznamy pokud chybí
- [ ] Aktualizovat ARCHITECTURE.md s novými moduly (recommendations, registry-client, whatllm)
- **Odhad**: ~2h

---

## Mimo scope v135

Tyto věci záměrně odkládáme:
- **TypeScript migrace** — příliš velký scope, zvážit post-v140
- **Multi-model routing** — architektonicky zajímavé, ale nepotřebné teď
- **API versioning** (`/api/v1/`)— breaking change, zvážit až při external API consumers
- **Prometheus metriky** — nice-to-have, ale žádný monitoring stack v produkci zatím
- **Puppeteer replacement** — funguje, neopravovat co není rozbité
- **better-sqlite3 alternativa** — segfaulty jsou vzácné, rebuild řeší

---

## Shrnutí

| Verze | Téma | Položek | Odhad |
|-------|------|---------|-------|
| v134 | Kódová hygiena + DX | 4 bloky | ~10h |
| v135 | IDE + Produkt + Workers | 5 bloků | ~24h |
| Průřez | CI/CD, mega-files, testy, docs | 4 bloky | ~16h |
| **Celkem** | | **13 bloků** | **~50h** |

### Cílový stav po v135

| Pilíř | Před | Po |
|-------|------|-----|
| Chat | 100% | 100% |
| Projekty | 100% | 100% |
| Workers | 95% | 100% |
| Specialisté | 100% | 100% |
| IDE | 78% | ~90% |
| Produkt | 25% | ~45% |
| **Kódová kvalita** | žádný lint | ESLint + Prettier + CI |
| **DX** | manuální verze | automatizované skripty |
