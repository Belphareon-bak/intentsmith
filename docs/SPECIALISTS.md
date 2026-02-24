# C.3 Specialists

**Verze:** v79.0 (2026-02-24)

Viz take: [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md) | [EXPERTISES.md](EXPERTISES.md) | [WORKERS.md](WORKERS.md)

---

## Obsah

1. [Architektura](#architektura) — jak specialist system funguje
2. [Accountant Specialist](#accountant-specialist) — deterministicke danove nastroje
3. [Dummy Logger Specialist](#dummy-logger-specialist) — utility pro platform testing
4. [Stav implementace](#stav-implementace) — co je hotovo, co chybi
5. [Budouci specialiste](#budouci-specialiste)

---

## Architektura

Specialist je self-contained balik v `specialists/` adresari. Pri bootu serveru se automaticky objevi, nainstaluje a aktivuje pres **Specialist Loader**.

```
specialists/
  accountant-cz/          ← domain specialist (finance)
  dummy-logger/           ← utility specialist (testing)
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
specialistRuntime.tryToolExecution('accountant', input)
    │
    ├── IntentDetector: pattern matching (5 tools, by priority)
    │     └── match: accountant.tax_calculator
    │
    ├── extractParams(input)
    │     └── { gross_income: 850000, entity_type: 'osvc', year: 2024 }
    │
    ├── ToolExecutor: lazy-load + call calculateTax(params)
    │     └── deterministicky vypocet → structured result
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

# Accountant Specialist

## Co to je

Accountant Specialist (`accountant-cz`) je **prvni plne implementovany domenovy specialista** v C.3. Ma 5 deterministickych nastroju pro ceske danove vypocty.

## Nastroje

### 1. Tax Calculator (`tools/tax-calc.js`)

Vypocet dane z prijmu pro OSVC (§7 ZDP) a s.r.o. (§21 ZDP).

**Vstup:** gross_income, expense_type (flat_60/80/40/30/actual), entity_type (osvc/sro), year, children, spouse_credit, student, disability

**Vystup:** tax_base, income_tax, social_insurance, health_insurance, total_tax_burden, net_income, effective_rate, assumptions[], warnings[], breakdown

**s.r.o.:** DPPO 21% + srazkova dan z dividend 15% = kombinovana efektivni sazba 32.85%

### 2. VAT Calculator (`tools/vat-calc.js`)

DPH: zakladni 21%, snizena 12% (od 2024), nulova 0% (export).

**Smery:** add (castka je zaklad) nebo remove (castka je s DPH).

### 3. Salary Calculator (`tools/salary-calc.js`)

Mesicni/rocni rozpis mzdy zamestnance (§6 ZDP).

**Vstup:** gross_salary, year, children, spouse_credit, student, mode (monthly/annual)

**Vystup:** social_employee, health_employee, tax_advance, net_salary, social_employer, health_employer, total_employer_cost

**Bonus:** `compareSalaries([30000, 40000, 50000])` — marginalni danova sazba

### 4. Deadline Checker (`tools/deadline-checker.js`)

Ceske danove lhuty — OSVC, s.r.o., DPH, kontrolni hlaseni.

**Typy:** DPFO/DPPO filing, OSSZ/VZP reporty, pojistne platby, zalohove platby, DPH kontrolni hlaseni

**Parametry:** entity_type, year, has_advisor, is_vat_payer, vat_period

### 5. Compare Tax Entities (`tools/tax-calc.js:compareTaxEntities`)

Side-by-side porovnani OSVC vs s.r.o. pro dany prijem.

### 6. Tax Rates Registry (`tools/tax-rates.js`)

Centralni registr vsech ceskych danovych sazeb (2024, 2025). Dan z prijmu, socialni, zdravotni, DPPO, slevy, pausalni vydaje. Podpora pro `getStalenessWarnings()`.

## Soubory

| Soubor | Ucel |
|--------|------|
| `specialists/accountant-cz/specialist.json` | Manifest |
| `specialists/accountant-cz/index.js` | Entry point (register/unregister, patterns, extractors) |
| `specialists/accountant-cz/tools/tax-calc.js` | OSVC + s.r.o. danovy kalkulator |
| `specialists/accountant-cz/tools/salary-calc.js` | Mzdovy kalkulator |
| `specialists/accountant-cz/tools/vat-calc.js` | DPH kalkulator |
| `specialists/accountant-cz/tools/tax-rates.js` | Registry sazeb (2024/2025) |
| `specialists/accountant-cz/tools/deadline-checker.js` | Danove lhuty |
| `specialists/accountant-cz/knowledge/tax-rates.js` | Knowledge pack (seed do KB) |

---

# Dummy Logger Specialist

## Co to je

Minimalni utility specialista pro **platformni intergracni testovani**. Ukazuje ze specialist system funguje s vice nez jednim specialistou. Ma 1 nastroj a 1 migraci.

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
| REST API (7 endpoints) | HOTOVO | v79 | — |
| Dependency system (minimal: topo sort, enable/disable guard) | HOTOVO | v79 | — |
| Specialist Memory (persistent context, memoryWrites) | HOTOVO | v79 | — |
| Scenario Branching (branchIf) | HOTOVO | v79 | — |
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
| Pattern Detection (NLP, CZ/EN) | HOTOVO | regex, priority-based |
| Knowledge Pack (tax-rates) | HOTOVO | seed do KB |
| DB migrace | NENI POTREBA | tools jsou pure functions |
| **Interaktivni scenare** | **CHYBI** | "co kdyby..." optimalizace |
| **Realtime sazby (worker)** | **CHYBI** | automaticka aktualizace |

## Celkovy stav testu

```
Specialist Loader: 270 passed, 0 failed
41 test blocks, pokryvajici: discovery, install, enable/disable, runtime isolation,
multi-specialist, update, rollback, stress tests
```

---

# Budouci specialiste

### Strategicka krizavatka (po v79)

| Smer | Priorita | Popis |
|------|----------|-------|
| Multi-specialist routing (D5) | P1 | Scoring, priority, conflict resolution |
| Remote registry (D9) | P2 | Git-based distribution, marketplace |
| Uninstall (purge) | P2 | Full cleanup vcetne DB tables |
| Novi specialiste | P2 | Viz nize |

### Planovani specialiste

| Specialista | Priorita | Popis |
|-------------|----------|-------|
| Spravce domacnosti | P2 | Energie, pojisteni, rozpocet |
| AI researcher | P3 | Monitoring AI paperu, benchmarku |
| Investicni poradce | P3 | Portfolio tracking, analyza trhu |

---

*Aktualizovano: 2026-02-24*
*Engine: c3-agent v79.0.0*
