# C.3 Specialists

**Verze:** v64.0 (2026-02-14)

Viz take: [EXPERTISES.md](EXPERTISES.md) | [WORKERS.md](WORKERS.md) | [README.md](README.md)

---

## Obsah

1. [Accountant Specialist](#accountant-specialist) — deterministicke danove nastroje
2. [Budouci specialiste](#budouci-specialiste) — planovane rozsireni

---

# Accountant Specialist

## Co to je

Accountant Specialist je **prvni plne implementovany domenovy specialista** v C.3. Na rozdil od ostatnich expertyz, ktere jen upravuji styl LLM odpovedi, ucetni ma vlastni **deterministicke nastroje** pro ceske danove vypocty. LLM v roli ucetniho NIKDY nepocita — pouze formatuje vysledky nastroju do citelne formy.

**Klicovy princip:** Cisla pochazi z deterministickych vypoctu, ne z LLM. Tool enforcement kontroluje, ze kazde cislo v odpovedi je podlozene vysledkem nastroje.

## Stav implementace

| Komponenta | Stav | Verze |
|-----------|------|-------|
| Tax Calculator (OSVC + s.r.o.) | HOTOVO | v57 |
| Salary Calculator | HOTOVO | v57 |
| VAT Calculator | HOTOVO | v57 |
| Deadline Checker | HOTOVO | v57 |
| Tax Rates Registry | HOTOVO | v57 |
| Tax Rates Freshness | HOTOVO | v57.3 |
| Accountant Detector (NLP) | HOTOVO | D-int1 |
| Expertise Tool Interception | HOTOVO | D-int2 |
| Change-Aware Memory | HOTOVO | D-int4 |
| Tool Enforcement Guard | HOTOVO | D-int5 |
| **Realtime sazby (worker)** | **CHYBI** | — |
| **Interaktivni scenare** | **CHYBI** | — |

## Architektura

```
Uzivatel: "Kolik zaplatim z 850k jako OSVC za rok 2024?"
    |
    v
CRE.classifyIntent() → ANSWER
    |
    v
expertiseHandler() — expertise 'accountant' je aktivni
    |
    v
detectAccountantTool(input) — D-int1
    |
    +-- Detekce typu: accountant.tax_calculator
    +-- Extrakce parametru:
    |     gross_income: 850000
    |     entity_type: 'osvc'
    |     year: 2024
    |
    v
calculateTax(params) — deterministicky vypocet
    |
    v
wrapWithExpertisePersona() — LLM formatuje vysledek
    |
    v
Tool Enforcement Guard — overeni cisel
    |
    +-- Kazde cislo v odpovedi matchnuto proti tool data
    +-- Fuzzy tolerance ±1% pro cisla > 100
    +-- Nepodlozena cisla → varovani
    |
    v
TaggedResponse s metadaty { expertise, enforcement, toolResults }
```

## Nastroje

### 1. Tax Calculator (`tax-calc.js`, 449 radku)

Vypocet dane z prijmu pro OSVC (§7 ZDP) a s.r.o. (§21 ZDP).

**Vstup:** gross_income, expense_type (flat_60/80/40/30/actual), entity_type (osvc/sro), year, children, spouse_credit, student, disability

**Vystup:** tax_base, income_tax, social_insurance, health_insurance, total_tax_burden, net_income, effective_rate, assumptions[], warnings[], breakdown

**s.r.o.:** DPPO 21% + srazkova dan z dividend 15% = kombinovana efektivni sazba 32.85%

### 2. Salary Calculator (`salary-calc.js`, 327 radku)

Mesicni/rocni rozpis mzdy zamestnance (§6 ZDP).

**Vstup:** gross_salary, year, children, spouse_credit, student, mode (monthly/annual)

**Vystup:** social_employee, health_employee, tax_advance, net_salary, net_to_gross_ratio, social_employer, health_employer, total_employer_cost

**Bonus:** `compareSalaries([30000, 40000, 50000])` — marginalni danova sazba

### 3. VAT Calculator (`vat-calc.js`, 125 radku)

DPH: zakladni 21%, snizena 12% (od 2024), nulova 0% (export).

### 4. Tax Rates Registry (`tax-rates.js`, 352 radku)

Centralni registr vsech ceskych danovych sazeb (2024, 2025). Dan z prijmu, socialni, zdravotni, DPPO, slevy, pausalni vydaje.

### 5. Tax Rates Freshness (`tax-rates-freshness.js`, 229 radku)

Varuje kdyz jsou sazby starsi nez 6 mesicu nebo rok neni v registru.

### 6. Deadline Checker (`deadline-checker.js`, 277 radku)

Ceske danove lhuty — OSVC, s.r.o., DPH, kontrolni hlaseni.

### 7. Accountant Detector (`accountant-detector.js`, 282 radku)

NLP detekce ucetnich dotazu: TAX, SALARY, VAT, COMPARE, DEADLINE. Extrakce castek z prirozeneho jazyka ("850k" → 850000, "2M" → 2000000).

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/expertises/tools/tax-calc.js` | 449 | OSVC + s.r.o. danovy kalkulator |
| `src/expertises/tools/salary-calc.js` | 327 | Mzdovy kalkulator |
| `src/expertises/tools/vat-calc.js` | 125 | DPH kalkulator |
| `src/expertises/tools/tax-rates.js` | 352 | Registry sazeb (2024/2025) |
| `src/expertises/tools/tax-rates-freshness.js` | 229 | Overeni aktualnosti |
| `src/expertises/tools/accountant-detector.js` | 282 | NLP detekce dotazu |
| `src/expertises/tools/deadline-checker.js` | 277 | Danove lhuty |

**Celkem ucetni kod: ~3 146 radku (tools + testy)**

---

# Budouci specialiste

Specialist Runtime je planovany subsystem pro komplexni on-demand agenty s nasledujicimi vlastnostmi:

| Vlastnost | Popis |
|-----------|-------|
| Dlouhodobe behy | Specialista bezi kontinualne (ne jednorazove) |
| Rutiny | Periodicke ukoly specificke pro domenu |
| Knowledge Base | Propojeni s domenovymi databazemi |
| Interaktivni scenare | "Co kdyby..." optimalizace |
| On-demand aktivace | Uzivatel aktivuje specialistu dle potreby |

### Planovani specialiste

| Specialista | Priorita | Popis |
|-------------|----------|-------|
| Spravce domacnosti | P2 | Energie, pojisteni, rozpocet |
| AI researcher | P3 | Monitoring AI paperu, benchmarku |
| Investicni poradce | P3 | Portfolio tracking, analyza trhu |

**Status:** Specialist Runtime je ve fazi navrhu. Zavisí na dokonceni stabilizacniho sprintu a Phase H (Hardening).

---

*Puvodni dokument: "EXPERTS, SPECIALISTS & WORKERS.md" (Subsystem 2)*
*Viz take: [EXPERTISES.md](EXPERTISES.md) (Expertise Layer, Merge Engine) | [WORKERS.md](WORKERS.md) (Agent Runner, Notifikace)*
