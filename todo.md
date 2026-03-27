# C3 Agent — Doporučení na zlepšení

> Generováno analýzou codebase v132.0.0 (2026-03-27)

---

## 🔴 Vysoká priorita

### 1. Rozdělit mega-soubory
Několik souborů překračuje rozumnou velikost a ztěžují údržbu:

| Soubor | Řádky | Doporučení |
|--------|-------|------------|
| `src/tools/registry.js` | 5,132 | Rozdělit po kategoriích (fs-tools, net-tools, db-tools, ...) |
| `src/chat/cre-decision.js` | 4,104 | Extrahovat guard pravidla, intent patterns a scoring do samostatných modulů |
| `src/ui/architect/architect.js` | 3,757 | Rozdělit na komponenty (router, renderer, state) |
| `src/chat/controller.js` | 2,170 | Extrahovat middleware chain do separátních souborů |
| `src/db/database.js` | 1,908 | Rozdělit schema definice po doménách |

### 2. Přidat ESLint + Prettier
Žádná konfigurace pro linting ani formátování. U 137K řádků kódu to je riziko:
- [ ] Nastavit `.eslintrc.json` (ESM, Node.js 22)
- [ ] Nastavit `.prettierrc`
- [ ] Přidat `npm run lint` a `npm run format` do `package.json`
- [ ] Postupně opravit existující problémy (per-directory)

### 3. Vyřešit existující TODOs v kódu (52 výskytů)
Kritické:
- `src/executor/tool-executor.js:1252` — "TODO: Integrate with code execution sandbox"
- `src/executor/tool-executor.js:1271` — "TODO: Integrate with database service"
- `src/notifications/feedback.js:243` — "TODO: resolve to human name via repository"
- `src/expertises/tools/tax-rates.js:153,184` — neověřené sazby pro 2025
- `src/chat/controller.js:1967` — "TODO: wire LLM summarizer"

---

## 🟡 Střední priorita

### 4. CI/CD pipeline
Žádná automatizace na GitHubu:
- [ ] GitHub Actions: `npm test` na push/PR
- [ ] Lint check v CI
- [ ] Automatická kontrola verze (package.json vs git tag)
- [ ] Automatický version bump skript

### 5. Verzovací konzistence
Aktuálně verze diverguje na 3+ místech:
- `package.json` (v132) vs git log (v133) vs `CLAUDE.md` vs `README.md`
- [ ] Zavést single source of truth — `package.json` verze = kanonická
- [ ] Skript `scripts/bump-version.js` který updatne všechna místa najednou
- [ ] Pre-commit hook nebo CI check pro konzistenci

### 6. Typová bezpečnost — JSDoc nebo postupná migrace na TypeScript
137K řádků čistého JS bez typů. Minimálně:
- [ ] Přidat JSDoc k veřejným API (`@param`, `@returns`, `@typedef`)
- [ ] Začít s `// @ts-check` v klíčových modulech (cre-decision, controller, server)
- [ ] `jsconfig.json` pro VS Code/IDE type inference
- Dlouhodobě zvážit postupnou migraci na TypeScript (per-module `.ts` → ESM build)

### 7. Testovací infrastruktura
Custom harness v `tests/harness.js` je minimální — chybí:
- [ ] Test coverage reporting
- [ ] Paralelní spouštění testů
- [ ] Watch mode pro vývoj
- [ ] Structured test output (TAP/JUnit pro CI)
- Zvážit migraci na **Vitest** (nativní ESM, rychlý, kompatibilní s Node 22)

### 8. Error handling v server.js
`server.js` má 1,409 řádků a inicializuje 18+ systémů v sekvenci:
- [ ] Extrahovat bootstrap do `src/bootstrap.js` s graceful failure per subsystém
- [ ] Zdravější shutdown — ověřit, že všechny subsystémy mají cleanup
- [ ] Structured startup log (tabulka: subsystém → status → čas)

---

## 🟢 Nízká priorita (nice-to-have)

### 9. API versioning
Všechny endpointy jsou `/api/...` bez verze:
- [ ] Zvážit `/api/v1/...` prefix pro budoucí breaking changes
- [ ] Nebo alespoň version header v responses

### 10. Dokumentační automatizace
Dokumentace zastarává (právě opraveno ručně):
- [ ] Skript `scripts/doc-stats.js` generující aktuální čísla (soubory, řádky, testy, migrace)
- [ ] Pre-commit hook nebo CI step porovnávající CLAUDE.md čísla vs realita

### 11. Docker vylepšení
Docker existuje (57ř Dockerfile, 91ř compose), ale:
- [ ] Ověřit, že Docker build funguje s aktuální verzí
- [ ] Přidat health check do compose
- [ ] Dokumentovat GPU passthrough pro Ollama v kontejneru
- [ ] Dev container pro VS Code / Codespaces

### 12. Puppeteer jako volitelná závislost
Puppeteer stahuje ~200MB Chromium. Pokud se používá jen pro PDF export:
- [ ] Přesunout do `optionalDependencies`
- [ ] Graceful degradace pokud není nainstalovaný
- [ ] Nebo nahradit lehčí alternativou (playwright-core, nebo jsPDF pro jednoduché PDF)

### 13. Monitoring a observabilita
- [ ] Prometheus-kompatibilní metriky endpoint (`/metrics`)
- [ ] Structured logging (JSON format volitelně) pro sběr logů
- [ ] Request ID tracing přes celý pipeline

### 14. Security hardening
- [ ] Rate limiting na API (zmíněno v docs ale ověřit implementaci)
- [ ] CORS konfigurace review
- [ ] Audit `C3_ADMIN_TOKEN` bypass v dev mode — ošetřit aby nešel zapnout v produkci
- [ ] Dependency audit (`npm audit`) v CI

### 15. better-sqlite3 stabilita
Známý problém se segfaulty při vysoké zátěži:
- [ ] Zvážit connection pooling / worker thread izolaci
- [ ] Nebo alternativu: `sql.js` (WASM, žádné native moduly) pro nekritické operace
- [ ] Přidat crash recovery test do CI

---

## 📊 Statistiky pro kontext

| Metrika | Hodnota |
|---------|---------|
| Zdrojové soubory | 380 |
| Řádky kódu | 137,282 |
| Testové soubory | 226 |
| Testů celkem | ~3,500+ |
| DB tabulky | 80+ |
| Migrace | 41 |
| TODO/FIXME v kódu | 52 |
| Soubory >1000 ř. | 14 |
| Soubory >2000 ř. | 4 |
| Největší soubor | registry.js (5,132 ř.) |
