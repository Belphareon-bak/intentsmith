# Accounting Engine — Roadmap
## OSVČ Cash-Based Daňová Evidence

> Phase 1–4 implementovány (v69–v72). Tento dokument pokrývá celý plán od ledger core po compliance engine.

---

## Architektura (cílový stav)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Specialist Layer                           │
│  (specialist-runtime.js → accountant tool routing)              │
├─────────────────────────────────────────────────────────────────┤
│                      Report Engine              (Phase 6)       │
│  Přehledy, Přiznání, Přehled ČSSZ/VZP, Souhrnné výkazy        │
├─────────────────────────────────────────────────────────────────┤
│                      Compliance Layer           (Phase 5)       │
│  Deadline agent, platební kontrola, validace povinností         │
├─────────────────────────────────────────────────────────────────┤
│                      VAT Engine                 (Phase 4) ✅    │
│  Registrace, kontrolní hlášení, rolling 12M, reverse charge    │
├─────────────────────────────────────────────────────────────────┤
│                      Social + Health Engine     (Phase 3) ✅    │
│  Přehledy pojistného, zálohy, minimální odvody                 │
├─────────────────────────────────────────────────────────────────┤
│                      Annual Tax Engine          (Phase 2) ✅    │
│  computeAnnualSummary(), uzavření roku, daňové přiznání        │
├─────────────────────────────────────────────────────────────────┤
│                      Ledger Core                (Phase 1) ✅    │
│  entity_profiles + financial_entries + audit + calc runs        │
├─────────────────────────────────────────────────────────────────┤
│                      DB Layer (SQLite/better-sqlite3)           │
│  Tenant model: entity_id, soft delete, entry_history            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Klíčové principy

1. **Repository / Engine separace** — SQL nikdy v engine, business logika nikdy v repository
2. **Peníze v haléřích** — `amount_cents INTEGER`, žádný REAL pro finance
3. **Soft delete + audit** — `deleted_at`, `version`, `entry_history` snapshots
4. **Pure compute** — `computeAnnualSummary()` je čistá funkce bez side effects
5. **Cross-check** — engine výsledky se musí shodovat s existující `tax-calc.js`
6. **Tenant model (B)** — centrální DB s `entity_id`, `DEFAULT 'default'` pro single-user

---

## Phase 1: Ledger Core ✅ (v69)

**Stav: HOTOVO — 54/54 testů**

### DB tabulky
- `entity_profiles` — OSVČ/s.r.o./zaměstnanec profil s tax_regime, flat_expense_category, děti, manžel/ka
- `financial_entries` — příjmy, výdaje, daňové platby, pojistné platby (haléře)
- `entry_history` — audit trail (JSON snapshots starých stavů)
- `calculation_runs` — reproducibilita výpočtů (rates_version + vstup/výstup)

### Repository API
```
createEntity(data) → { id }
getEntity(id) → entity | null
updateEntity(id, patch)
deleteEntity(id) — CASCADE
addEntry(entityId, data) → { id }
getEntry(id) → entry | null
updateEntry(id, patch) — snapshots + version++
softDeleteEntry(id) — snapshots + deleted_at
getEntriesByYear(entityId, year)
getEntriesByDateRange(entityId, from, to)
getEntriesByType(entityId, year, type)
countEntries(entityId, year)
getEntryHistory(entryId) — audit trail
saveCalculationRun(data) — reproducibilita
getLatestRun(entityId, year)
addEntries(entityId, entries) — bulk transaction
```

### Engine API
```
toCents(czk) / toCZK(cents)
aggregateEntries(entries) → totals + byCategory
computeTaxBase(entity, agg, rates) → taxBase + expenses + method
computeIncomeTax(taxBaseCents, entity, rates) → tax + credits + bonus
computeSocial(taxBaseCents, entity, rates) → insurance + base + min/cap
computeHealth(taxBaseCents, rates) → insurance + base + min
computeAnnualSummary({ entity, entries, rates, year }) → full breakdown
```

### Soubory
- `src/db/migrations/2026_02_19_008_v69_ledger_core.js`
- `src/expertises/ledger/ledger-repository.js`
- `src/expertises/ledger/ledger-engine.js`
- `tests/ledger-core.test.js`

---

## Phase 2: Annual Tax Engine ✅ (v70)

**Stav: HOTOVO — 44/44 testů**

### DB tabulky
- `period_locks` — zamčená období (`entity_id + year`, UNIQUE, FK na `calculation_runs`)
- `tax_losses` — evidence daňových ztrát §34 ZDP (`entity_id + origin_year`, expires_year = +5)

### Repository API (rozšíření)
```
lockPeriod(entityId, year, opts)
unlockPeriod(entityId, year)
isPeriodLocked(entityId, year) → boolean
getPeriodLock(entityId, year) → lock | null
getLockedYears(entityId) → locks[]
recordTaxLoss(entityId, originYear, amountCents)
getActiveLosses(entityId, currentYear) → losses[]
getTaxLoss(entityId, originYear) → loss | null
updateLossRemaining(entityId, originYear, newRemainingCents)
```

### Guards
- `addEntry()` — throws if period_year is locked
- `updateEntry()` — throws if entry's period_year is locked
- `softDeleteEntry()` — throws if entry's period_year is locked

### Engine API (ledger-annual.js)
```
applyTaxLosses(taxBaseCents, activeLosses, currentYear) → adjusted base + applied detail
detectTaxLoss(entries, entity, rates) → { hasLoss, lossAmountCents }
generateTaxReturnData({ entity, entries, rates, year, activeLosses }) → DPFO form data
computeYearCloseSummary({ entity, entries, rates, year, activeLosses }) → full close package
```

### Soubory
- `src/db/migrations/2026_02_20_009_v70_period_locks.js`
- `src/expertises/ledger/ledger-annual.js`
- `src/expertises/ledger/ledger-repository.js` (rozšířeno)
- `tests/ledger-annual.test.js`

### Zbývá (nepřidáno zatím)
- [ ] Scenario: guided flow "Roční uzávěrka" (ScenarioEngine)
- [ ] Napojení na specialist-runtime jako `accountant.annual_close` tool

---

## Phase 3: Social + Health Insurance Engine ✅ (v71)

**Stav: HOTOVO — 27/27 testů**

### Engine API (ledger-insurance.js)
```
computeSocialOverview({ entity, entries, rates, year, paidAdvances }) → ČSSZ overview
computeHealthOverview({ entity, entries, rates, year, paidAdvances }) → VZP overview
computeInsuranceOverviews({ entity, entries, rates, year }) → { social, health, combined }
generateAdvanceSchedule({ socialMonthly, healthMonthly, year }) → 12 months with due dates
reconcilePayments({ schedule, payments }) → { matched, unmatched, missedMonths }
```

### Funkce
- [x] `computeSocialOverview()` — Přehled OSVČ pro ČSSZ (vyměřovací základ, roční povinnost, doplatek/přeplatek)
- [x] `computeHealthOverview()` — Přehled OSVČ pro VZP/ZPMV/OZP
- [x] `computeInsuranceOverviews()` — kombinovaný přehled, separace `insurance_payment` entries
- [x] `generateAdvanceSchedule()` — měsíční zálohy s datem splatnosti (ČSSZ 20., VZP 8.)
- [x] `reconcilePayments()` — porovnání zaplacených záloh vs. rozvrhu (matching ±45 dní)
- [x] Nedoplatky/přeplatky za rok (social i health)
- [x] Vedlejší činnost: `below_threshold` detekce podle `osvc_side_threshold`
- [x] Nová záloha na další rok: `next_year_monthly_cents` (minimum-clamped)
- [x] 27 testů: přehledy, zálohy, nedoplatky, vedlejší činnost, reconciliation, edge cases

### Poznámky
- Čistě pure engine — žádná nová DB tabulka (nepotřeba, schedule se generuje on-the-fly)
- `insurance_advance_schedule` tabulka přesunuta do Phase 5 (persistence optional)
- Sazby z RATES (Phase 1), výpočty z `computeSocial()`/`computeHealth()` (Phase 1)

### Soubory
- `src/expertises/ledger/ledger-insurance.js`
- `tests/ledger-insurance.test.js`

### Zbývá (nepřidáno zatím)
- [ ] Napojení na specialist-runtime jako `accountant.insurance_overview` tool

---

## Phase 4: VAT Engine ✅ (v72)

**Stav: HOTOVO — 46/46 testů**

### DB změny
- `financial_entries` rozšířeno o: `supply_date`, `partner_dic`, `partner_name`, `document_number`, `vat_type`
- `vat_periods` — uzavřená DPH období (monthly/quarterly, open → submitted → closed)

### Repository API (rozšíření)
```
addEntry() — rozšířeno o supply_date, partner_dic, partner_name, document_number, vat_type
updateEntry() — rozšířeno o nové VAT sloupce
createVATPeriod(entityId, data) → { id }
getVATPeriod(entityId, periodStart) → period | null
closeVATPeriod(entityId, periodStart, data)
getOpenVATPeriods(entityId) → periods[]
getVATPeriodsByYear(entityId, year) → periods[]
```

### Engine API (ledger-vat.js)
```
computeVATReturn({ entries, rates, period }) → rows + summary (vlastní daň / nadměrný odpočet)
computeControlReport({ entries, period }) → { a4, a5, b2, b3, totals }
checkRegistrationObligation({ entries, asOfDate, rates }) → { obligated, exceeded_date }
validateVATEntry(entry, rates) → { valid, warnings, errors }
getVATPeriodBounds(year, periodNumber, periodType) → { start, end }
computeVATPeriodSummary({ entries, rates, year, periodNumber, periodType }) → combined
```

### Funkce
- [x] VAT return: řádky r1/r2 (output 21%/12%), r40/r41 (input deduction), r3/r4 (EU acquisition)
- [x] Reverse charge §92a: appears on both output (r10/r11) and input (r40/r41) — net zero
- [x] EU supply (r26), exempt (r25), export
- [x] Kontrolní hlášení: A.4/A.5 (output > / ≤ 10K), B.2/B.3 (input > / ≤ 10K)
- [x] Rolling 12M: `checkRegistrationObligation()` — detekce překročení 2M Kč, `exceeded_date`
- [x] Validace: DIČ formát (CZ + 8-10 digits), supply_date, rate consistency, KH completeness
- [x] Period bounds: monthly/quarterly helper
- [x] 46 testů: schema, repo storage, VAT return (standard + RC + EU), KH, 12M, validation, edge cases

### Poznámky
- `vat_type` values: `standard`, `reverse_charge`, `exempt`, `eu_acquisition`, `eu_supply`, `export`, `import`
- KH threshold: 10,000 CZK (including VAT) — items above go to A.4/B.2, below to A.5/B.3
- `supply_date` (DUZP) preferred over `entry_date` for period filtering

### Soubory
- `src/db/migrations/2026_02_22_010_v72_vat_engine.js`
- `src/expertises/ledger/ledger-vat.js`
- `src/expertises/ledger/ledger-repository.js` (rozšířeno)
- `tests/ledger-vat.test.js`

### Zbývá (nepřidáno zatím)
- [ ] Napojení na specialist-runtime jako `accountant.vat_return` tool

---

## Phase 5: Compliance Layer

**Cíl: Termíny, upomínky, validace povinností**

### Úkoly
- [ ] `compliance_rules` tabulka — definice povinností per entity_type
- [ ] `compliance_checks` — výsledky kontroly (OK/WARNING/VIOLATION)
- [ ] Integrace s deadline-checker.js — automatická kontrola blížících se termínů
- [ ] Kontrola: podáno přiznání? Zaplaceno pojistné? Odeslán přehled?
- [ ] Warning systém: upozornění N dní před deadlinem
- [ ] `runComplianceCheck(entityId, year)` — souhrnná kontrola
- [ ] Napojení na notification systém (agent_notifications)
- [ ] 15+ testů: pravidla, kontroly, deadliny, warnings

### Poznámky
- Staví na existujícím `deadline-checker.js` (už v codebase)
- Compliance nevynucuje (soft warnings), neblokuje

---

## Phase 6: Report Engine

**Cíl: Výkazy, přehledy, exporty**

### Úkoly
- [ ] `generateDPFOData(entityId, year)` — kompletní data pro Přílohu 1
- [ ] `generateCSSZOverview(entityId, year)` — Přehled OSVČ pro ČSSZ
- [ ] `generateVZPOverview(entityId, year)` — Přehled pro zdravotní pojišťovnu
- [ ] `generateCashBook(entityId, year)` — Peněžní deník (daňová evidence)
- [ ] `generateIncomeSummary(entityId, year)` — Přehled příjmů a výdajů
- [ ] Markdown/JSON export (PDF generování = IDE extension scope)
- [ ] Přehled záloh: co bylo zaplaceno vs. co mělo být
- [ ] 10+ testů: formáty, kompletnost, edge cases

### Poznámky
- PDF rendering je mimo scope engine — engine generuje data, IDE extension renderuje
- Formuláře odpovídají oficiálním tiskopisům MFin (kódy 25 5405/P1)

---

## Závislosti mezi fázemi

```
Phase 1 ✅ ─→ Phase 2 ✅ ─→ Phase 3 ✅ ─→ Phase 5
                   │                      ↑
                   └──→ Phase 4 ✅ ───────┘
                                          │
                                     Phase 6
```

- Phase 2 závisí na Phase 1 (ledger + engine)
- Phase 3 závisí na Phase 2 (uzavřený rok)
- Phase 4 je nezávislá na Phase 3 (může běžet paralelně)
- Phase 5 závisí na Phase 3 + 4 (pojistné + DPH povinnosti)
- Phase 6 závisí na všech (reportuje ze všech dat)

---

## Testy — cílový stav

| Phase | Testy | Pokrytí |
|-------|-------|---------|
| 1 ✅  | 54    | Entity CRUD, Entry CRUD, audit, soft delete, engine, cross-check |
| 2 ✅  | 44    | Period locking, guards, tax return DPFO, loss carryforward, edge cases |
| 3 ✅  | 27    | Social/health přehledy, zálohy, nedoplatky, vedlejší činnost, reconciliation |
| 4 ✅  | 46    | DPH přiznání, KH (A.4/A.5/B.2/B.3), rolling 12M, reverse charge, EU, validace |
| 5     | ~15   | Compliance rules, deadline kontrola, warnings |
| 6     | ~10   | Report formáty, kompletnost |
| **Σ** | **~196** | |

---

## DB Schema — celkový přehled

### Existující (Phase 1 + 2 + 4)
- `entity_profiles` — tenant + profil
- `financial_entries` — cash-based ledger (haléře, soft delete, VAT metadata)
- `entry_history` — audit trail
- `calculation_runs` — reproducibilita
- `period_locks` — zamčená období
- `tax_losses` — evidence daňových ztrát §34 ZDP
- `vat_periods` — uzavřená DPH období (monthly/quarterly)

### Plánované
- `compliance_rules` — definice povinností (Phase 5)
- `compliance_checks` — výsledky kontrol (Phase 5)

---

## Integrace se specialist-runtime

Nové accountant tools (postupně):

| Phase | Tool ID | Popis |
|-------|---------|-------|
| 1 ✅  | — | Engine pouze, zatím bez tool registrace |
| 2 | `accountant.annual_close` | Guided roční uzávěrka |
| 2 | `accountant.tax_return` | Generování dat pro přiznání |
| 3 | `accountant.insurance_overview` | Přehledy pojistného |
| 4 | `accountant.vat_return` | DPH přiznání |
| 5 | `accountant.compliance_check` | Souhrnná kontrola |
| 6 | `accountant.generate_report` | Export výkazů |

---

*Dokument vytvořen: 2026-02-20, Phase 1 v69, Phase 2 v70, Phase 3 v71, Phase 4 v72 — 171/171 testů*
