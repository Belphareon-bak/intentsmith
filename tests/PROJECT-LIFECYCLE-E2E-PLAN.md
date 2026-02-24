# PROJECT LIFECYCLE E2E — MASTER PLAN

## Cil

Overit, ze C3 Lifecycle Engine:
1. Korektne vytvari a spravuje novy projekt
2. Korektne pokracuje v existujicim projektu
3. Konzistentne vytvari a aktualizuje dokumentaci (README, ROADMAP)
4. Automaticky verzi projekt pomoci Git
5. Spravne uklada a obnovuje konverzaci
6. Zvlada pause / resume / cancel / crash recovery
7. Zvlada change management behem BUILD
8. Je schopen vytvorit realny produkt (klicenka)
9. Je schopen vytvorit expertyzu a nasledne ji pouzit

---

## I. ENGINE PREREKVIZITY (MUST FIX BEFORE E2E)

Musi fungovat automaticky behem procesu vytvareni a zacatku kazdeho projektu,
stejne tak behem otevreni existujiciho. Automaticke kroky agent napise do chatu
a musi byt v logu agenta.

### P1 — ROADMAP.md jako fyzicky soubor

Po:
- `generateRoadmap()`
- kazdem milestone PASSED
- change request approve

Musi vzniknout / aktualizovat se: `{projectRoot}/ROADMAP.md`

Obsah:
- aktualni faze
- verze roadmapy
- seznam milniku
- status (PENDING / PASSED / SKIPPED)
- commit hash
- historie zmen

Bez toho E2E nema smysl.

### P2 — README.md auto-update

Po kazdem milestone PASSED:
- `ensureReadme()`
- aktualizovat: project summary, current progress, usage (pokud relevantni)

README je zdroj pravdy pro cloveka.

### P3 — Analyza existujiciho projektu

Pri otevreni projektu musi engine nacist:
- README.md
- ROADMAP.md
- .c3/project.json
- git log
- package.json
- strukturu zdrojoveho kodu
- existujici konverzaci z DB

A pouzit to jako kontext pro SPEC fazi.

### P4 — Uvodni info pri novem projektu

V PROPOSED fazi musi response obsahovat:
- vysvetleni lifecycle procesu
- co se automaticky vytvori
- jak probiha schvalovani
- ze se pouziva Git a verzovani

### P5 — Jedna konverzace per lifecycle

- Konverzace je linknuta k projektu
- Auto-compact funguje
- Cely lifecycle probiha v jednom threadu

---

## II. TEST 1 — HAPPY PATH (DETERMINISTICKY)

**Soubor:** `tests/project-lifecycle-e2e-happypath.test.js`
**Typ:** In-memory SQLite, Mock callLLM, Temp projektova slozka

**Testuje:**
PROPOSED -> SPEC -> SPEC_REVIEW -> PLANNING -> PLAN_REVIEW -> BUILD -> COMPLETED

**Overuje:**
- README vytvoren
- ROADMAP vytvoren
- Git init
- Commit + tag po kazdem milniku
- Milestones v DB
- lcState korektne spravovan
- Finalni COMPLETED

**Assertions:** ~30

---

## III. TEST 2 — INTERRUPTS

**Soubor:** `tests/project-lifecycle-e2e-interrupts.test.js`

**Testuje:**
- pauza -> resume
- zrusit
- quick build
- crash recovery (DB -> RAM)
- neplatne prikazy ve spatne fazi

**Assertions:** ~25

---

## IV. TEST 3 — CHANGE MANAGEMENT

**Soubor:** `tests/project-lifecycle-e2e-changes.test.js`

**Testuje:**
- zmena -> CHANGE -> approve
- zmena -> reject
- roadmap version increment
- ROADMAP.md update
- milestone skip
- status check behem BUILD

**Assertions:** ~22

---

## V. TEST 4 — KLICENKA (REAL PRODUCT E2E)

**Soubor:** `tests/project-lifecycle-e2e-klicenka.test.js`
**Typ:** Real DB, Real soubory, Mock LLM, Real Git
**Projekt:** Secure Keychain

**Cil:**
Sifrovane uloziste citlivych udaju pro C3.

**Pozadovany produkt:**
- AES-256-GCM encryption
- PBKDF2 / scrypt key derivation
- File-based encrypted store
- CLI (add/get/list/remove/export/import)
- Integrace do C3 configu
- Unit testy

**Milniky:**
- MS-1: Encryption engine
- MS-2: Credential store
- MS-3: CLI
- MS-4: C3 integration

**Overuje:**
- Existujici projekt je analyzovan
- SPEC generovan z kontextu
- ROADMAP vytvorena
- Vsechny milniky PASSED
- Git: 4+ commitu + 4 tagy
- README aktualizovan
- ROADMAP aktualizovan
- lifecycle COMPLETED
- lcState cleared
- Jedna konverzace pro cely lifecycle

**Assertions:** ~35

---

## VI. TEST 5 — EXPERTIZA (META TEST)

**Soubor:** `tests/project-lifecycle-e2e-expertise.test.js`

**Faze 1:** Vytvorit specialist plugin:
- `specialists/mobile-dev/`
- manifest.json, index.js, tools/, adapters.js, testy

**Milniky:**
- MS-1: Manifest + config
- MS-2: Tool adaptery
- MS-3: Routing testy

**Faze 2:** Nacist expertyzu a overit:
- SpecialistLoader.boot()
- Routing accuracy >= 80%
- Tool execution match

**Assertions:** ~30

---

## VII. PORADI IMPLEMENTACE

```
1. P1, P2, P4
2. Test 1 -> fixovat mezery
3. Test 2 + 3
4. P3
5. Test 4 (klicenka)
6. Test 5 (expertiza)
```

---

## VIII. DONE KRITERIA

Vsechny testy projdou.

Po behu Test 4 existuje:
- README.md
- ROADMAP.md
- src/
- tests/
- Git historie
- COMPLETED lifecycle

Po behu Test 5 existuje:
- Funkcni mobile-dev expertyza
- Routing funguje
- Specialist aktivni

---

## IX. DULEZITA POZNAMKA

Testy nejsou jen validace. Jsou to:
- specifikace chovani
- ochrana architektury
- ochrana proti regresi
- ochrana proti "LLM drift"

---

## Jak spustit

```bash
NODE=~/.nvm/versions/node/v22.21.1/bin/node

# Dummy testy (deterministicke, mock LLM)
$NODE tests/project-lifecycle-e2e-happypath.test.js
$NODE tests/project-lifecycle-e2e-interrupts.test.js
$NODE tests/project-lifecycle-e2e-changes.test.js

# Integracni testy (realne soubory, realna DB)
$NODE tests/project-lifecycle-e2e-klicenka.test.js
$NODE tests/project-lifecycle-e2e-expertise.test.js
```
