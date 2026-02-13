# C.3 Agent Platform — Kompletni Overview Subsystemu

**Verze:** v63 (2026-02-13)
**Celkem souboru:** 61 (41 src + 20 testu)
**Celkem radku kodu:** ~24 500

---

## Obsah

**Experti & Specialiste (Faze D — 30%)**

1. [Subsystem 1: Expert Layer (registrace, routing, sila, presety)](#subsystem-1-expert-layer)
2. [Subsystem 2: Accountant Specialist (ucelni — deterministicke nastroje)](#subsystem-2-accountant-specialist)
3. [Subsystem 3: Expert Enforcement & Quality Pipeline](#subsystem-3-expert-enforcement--quality-pipeline)

**Workeri & Notifikace (Faze B — 80%)**

4. [Subsystem 4: Agent Runner & Scheduler (exekucni engine)](#subsystem-4-agent-runner--scheduler)
5. [Subsystem 5: Zdroje, Podminky & Triggery (data pipeline)](#subsystem-5-zdroje-podminky--triggery)
6. [Subsystem 6: Notifikacni Pipeline (dorucovani, policy, trust)](#subsystem-6-notifikacni-pipeline)

---

# Subsystem 1: Expert Layer

## Co to je

Expert Layer je jadro celeho specialistickeho systemu. Definuje **15 vestavenych expertu** organizovanych do 5 kategorii, spravuje jejich registraci, routing (ktery expert se ma pouzit), silu vlivu na odpovedi a propojeni s konverzacemi.

**Klicovy princip:** Expert ovlivnuje STYL odpovedi (ton, hloubka, slovnik, opatrnost), NIKOLIV rozhodnuti CRE. CRE zustava autoritou pro intent klasifikaci — expert je "persona", ne "mozek".

## Faze

| Komponenta | Stav | Poznamka |
|-----------|------|---------|
| Definice 15 vestavenych expertu | HOTOVO | v44.10+ |
| ExpertAgent trida | HOTOVO | Plne konfigurovatelna |
| ExpertRegistry singleton | HOTOVO | Built-in + custom |
| Expert routing (pattern matching) | HOTOVO | Jednoduchy keyword match |
| Expert strength (kvantizovana sila) | HOTOVO | v45.0 — 5 urovni |
| Expert presety (LIGHT/BALANCED/DEEP) | HOTOVO | v45.0 KOLO 4.3 |
| Expert-konverzace vazby (DB) | HOTOVO | Lock/unlock/strength |
| Expert cross-session pamet | HOTOVO | v57.1 A8 — max 50 polozek |
| Domain-specific synthesis prompty | HOTOVO | v57.1 A7 |
| Custom expert CRUD (API) | HOTOVO | 6 HTTP endpointu |
| Expert UI (HTML stranka) | HOTOVO | experts.html (889 radku) |
| **Specialist Runtime** | **CHYBI** | Dlouhodobe behy, rutiny |
| **Knowledge Base integrace** | **CHYBI** | Propojeni s domenovymi DB |
| **Merge Engine v2** | **HOTOVO** | v63.0 — az 3 expertisy soucasne, 5D kompatibilita, moduly |

## Architektura

```
Uzivatelsky vstup
    |
    v
CRE.classifyIntent()  ─── rozhodnuti o intentu (ANSWER, SEARCH, CODE, ...)
    |
    v
ConversationHandler.route()
    |
    +──  Expert je aktivni?
    |       |
    |       +── ANO ──> expertHandler(input, context)
    |       |               |
    |       |               +── CASE 0: activeExpertises > 1?
    |       |               |       +── mergeExpertisePrompt() ── 15-krokovy algoritmus
    |       |               |       +── LLM s merged prompt + temperature
    |       |               |       +── ExpertEnforcer (synteticky config)
    |       |               |       +── Disclaimery z obou expertiz
    |       |               |
    |       |               +── CASE 1: single expert
    |       |               |       +── routeToExpert() ── pattern matching
    |       |               |       +── buildExpertSystemPrompt() ── pamet + styl
    |       |               |       +── LLM generovani s expert.temperature
    |       |               |       +── ExpertEnforcer validace
    |       |               |       +── TaggedResponse s expert metadaty
    |       |               |
    |       |               +── CASE 2: no expert ── ASK_USER
    |       |
    |       +── NE ──> normalni handler (decisions.js)
    |
    v
Synthesis s expertHints (styl, hloubka, slovnik, opatrnost)
```

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/experts/expert-layer.js` | ~1 720 | Definice expertu + modules/capabilities, ExpertAgent, registry, routing, resolveInheritance |
| `src/experts/expert-store.js` | ~800 | DB persistence — CRUD, vazby, pamet, multi-expertise metody |
| `src/experts/merge-types.js` | ~175 | **v63.0** Konstanty, CompatibilityBlockError, token utility |
| `src/experts/merge-compatibility.js` | ~190 | **v63.0** 5D pairwise conflict detection |
| `src/experts/merge-engine.js` | ~420 | **v63.0** mergeExpertisePrompt() — 15-krokovy cisti funkce |
| `src/experts/experts.html` | 889 | Web UI pro spravu expertu |
| `src/chat/handlers/expert.js` | ~635 | Expert handler — routing, merge flow, tool intercepce, enforcement |
| `tests/expert-system.test.js` | 587 | Unit testy — CRUD, validace, vazby, enforcement |
| `tests/expert-integration.test.js` | 300 | Integracni testy — DB, lifecycle |
| `tests/merge-engine.test.js` | ~330 | **v63.0** 30 testu — merge, pure function, temperature, trimming |
| `tests/merge-compatibility.test.js` | ~250 | **v63.0** 16 testu — 5D kompatibilita, built-in assertions |

## Vestaven experti (15)

### A) Tvurci & Narativni

| Expert | ID | Ikona | Domena | Teplota | Vystupni bias |
|--------|-----|-------|--------|---------|---------------|
| Spisovatel | `writer` | ✍️ | creative_writing | 0.8 | CREATIVE |
| DnD Master | `dnd_master` | 🐉 | tabletop_rpg | 0.85 | CREATIVE |
| Textar | `songwriter` | 🎵 | music_lyrics | 0.8 | CREATIVE |

### B) Analyticko-rozhodovaci

| Expert | ID | Ikona | Domena | Teplota | Vystupni bias |
|--------|-----|-------|--------|---------|---------------|
| Analytik | `analyst` | 📊 | analysis | 0.4 | ANALYTICAL |
| Prekupnik | `trader` | 💰 | trading | 0.4 | CONSERVATIVE |
| Ucetni | `accountant` | 🧮 | finance | 0.2 | CONSERVATIVE |

### C) Normativni & Odpovednostni

| Expert | ID | Ikona | Domena | Teplota | Vystupni bias |
|--------|-----|-------|--------|---------|---------------|
| Pravnik | `lawyer` | ⚖️ | legal | 0.3 | CONSERVATIVE |
| Lekar | `doctor` | 🩺 | medical_education | 0.3 | CONSERVATIVE |
| Psycholog | `psychologist` | 🧠 | psychology | 0.5 | ANALYTICAL |

### D) Technicko-odborni

| Expert | ID | Ikona | Domena | Teplota | Vystupni bias |
|--------|-----|-------|--------|---------|---------------|
| AI Expert | `ai_expert` | 🤖 | artificial_intelligence | 0.4 | ANALYTICAL |
| Vyvojar | `developer` | 💻 | software_development | 0.3 | ANALYTICAL |
| Technik | `technician` | 🔧 | technical_support | 0.3 | ANALYTICAL |

### E) Domenovi znalci

| Expert | ID | Ikona | Domena | Teplota | Vystupni bias |
|--------|-----|-------|--------|---------|---------------|
| Autickar | `car_enthusiast` | 🚗 | automobiles | 0.5 | ANALYTICAL |
| Motorkar | `biker` | 🏍️ | motorcycles | 0.5 | ANALYTICAL |
| Politolog | `political_analyst` | 🏛️ | politics | 0.3 | ANALYTICAL |

## Expert Strength System (v45.0)

Kvantizovana sila — uzivatel nevi rozlisit 63% od 65%, proto 5 pevnych urovni:

| Uroven | Hodnota | Vliv na styl | Popis |
|--------|---------|-------------|-------|
| OFF | 0 | 0% | Expert vypnuty |
| LIGHT | 25 | 30% | Jemny vliv, minimalni hloubka |
| MEDIUM | 50 | 60% | Vychozi, vyvazeny |
| STRONG | 75 | 75% | Dominantni expertni styl |
| FULL | 100 | 100% | Maximalni expertni charakter |

### Presety (mapovani sily na konfiguraci)

| Preset | Rozsah | Style mult. | Hloubka | Opatrnost mult. | Slovnik mult. |
|--------|--------|-------------|---------|-----------------|---------------|
| LIGHT | 0-30% | 0.3 | shallow | 0.5 | 0.4 |
| BALANCED | 31-60% | 0.6 | default | 0.8 | 0.7 |
| DEEP | 61-100% | 1.0 | deep | 1.0 | 1.0 |

## Merge Engine v2 (v63.0)

Multi-expertise system — az 3 expertisy soucasne v jedne konverzaci s inteligentnim slucovanim promptu.

### Architektura

```
context.activeExpertises = [
  { id: 'developer', weight: 0.7, modules, capabilities, ... },
  { id: 'analyst', weight: 0.3, modules, capabilities, ... },
]
    |
    v
mergeExpertisePrompt() ── 15-krokovy CISTY algoritmus (no side effects)
    |
    +── 1. Validate count (max 3)
    +── 2. checkCompatibility() ── 5D vektory, HARD_BLOCK/SOFT_BLOCK/WARNING/OK
    +── 3. Sort by weight desc (position jako tie-breaker)
    +── 4. resolveInheritance() ── parent chain (max depth 4)
    +── 5. mergeModulesTagged() ── tagged items {text, expertiseId, weight}, dedup
    +── 6. applySpecialistOverride() ── prida, nikdy neodstrani
    +── 7. deriveTone() ── nejvyssi vaha vyhrava
    +── 8. deriveTemperature() ── dominance (>0.6 ratio) nebo weighted avg
    +── 9. User context budget (max 300 tokenu)
    +── 10. trimToTokenBudget() ── budget 1800 tokenu, vocabulary→emphasis→domain_rules
    +── 11. buildStructuredPrompt() ── sekce: Pravidla, Duraz, Omezeni, Slovnik, Antipatterns
    +── 12. Append user context
    +── 13. mergeEnforcement() ── forbiddenPhrases=UNION, minResponseLength=MAX
    +── 14. buildAuditLog()
    +── 15. Object.freeze(result)
    |
    v
Frozen { prompt, metadata, enforcement, audit }
```

### 5D Capability Vektory

Kazdy expert ma 5-dimenzionalni vektor pro detekci konfliktu:

| Dimenze | Popis | Priklad konfliktu |
|---------|-------|-------------------|
| reasoning | Analyticky vs intuitivni | — |
| creativity | Kreativni vs konzervativni | creativity >70 vs determinism >70 |
| determinism | Deterministicky vs volny | viz creativity |
| riskTolerance | Rizikovost | gap >60 = conflict |
| verbosity | Usecny vs upovidany | gap >50 = conflict |

| Severity | Pravidlo | Vysledek |
|----------|---------|---------|
| HARD_BLOCK | maxGap >80 | Nelze zkombinovat |
| SOFT_BLOCK | maxGap >60 | Vyzaduje potvrzeni |
| WARNING | maxGap >50 | Varovani |
| OK | else | Bez problemu |

Priklad: `writer` (creativity=90) + `accountant` (determinism=95) → gap=85 → **HARD_BLOCK**

### Modules Format

Kazdy z 15 built-in expertu ma rucne kuratovane moduly (ne parsovane ze systemPrompt):

```javascript
modules: {
  domain_rules: ['...'],     // Pravidla domeny
  emphasis: ['...'],         // Co zduraznit
  constraints: ['...'],      // Co NIKDY nedelat
  vocabulary: ['...'],       // Domenovy slovnik
  antipatterns: ['...'],     // Cemu se vyhnout
  disclaimer: '...' | null,  // Povinny disclaimer (nebo null)
}
```

Existujici `systemPrompt` zustava beze zmeny pro single-expert flow (dual-path architektura).

### Token Budget

- **MAX_TOTAL_TOKENS:** 2000 (externi API limit)
- **EFFECTIVE_TOKEN_BUDGET:** 1800 (interni s 10% rezervou — 🔴2)
- **MAX_USER_CONTEXT_TOKENS:** 300 (separatni budget)
- **Trim order:** vocabulary → emphasis → domain_rules (lowest weight first)
- **NIKDY se netrimi:** constraints, antipatterns, disclaimers

### Temperature Dominance

- Pokud dominantni expertiza ma >60% celkove vahy → pouzije se jeji teplota
- Jinak → vazeny prumer

### DB Tabulky (v63.0)

```
conversation_expertises:
  conversation_id TEXT    ── FK na conversations
  expertise_id TEXT       ── ID expertisy
  weight REAL             ── 0.1-1.0 (default 0.5)
  position INTEGER        ── tie-breaker + UI ordering
  UNIQUE(conversation_id, expertise_id)

merge_audit_log:
  conversation_id TEXT
  timestamp TEXT
  data TEXT               ── JSON audit log
```

**Legacy kompatibilita (🟡4):** Kdyz se nastavi `conversation_expertises`, automaticky se smaze zaznam z `conversation_experts`.

### API Endpoint

```
GET /api/merge-preview?expertises=developer,analyst&weight_developer=0.7&weight_analyst=0.3
    → 200: { activeExpertises, tone, temperature, tokenCount, compatibility, promptPreview, enforcement }
    → 400: neplatna vaha nebo neznamy expert (🟡6)
    → 409: HARD_BLOCK (nekompatibilni kombinace)
```

### Testy

| Soubor | Pocet testu | Pokryva |
|--------|-------------|---------|
| `merge-engine.test.js` | 30 | Merge, pure function, temperature, tone, trim, inheritance, enforcement, context, specialist, audit |
| `merge-compatibility.test.js` | 16 | Pairwise 5D, edge cases, built-in assertions (vsech 15 ma modules+capabilities) |

## Expert-Konverzace Vazby

Expert muze byt prirazen ke konverzaci s nasledujicimi vlastnostmi:

```
setExpertForConversation(convId, expertId, { locked: true, strength: 75 })
    |
    v
conversation_experts tabulka:
  conversation_id TEXT PRIMARY KEY
  expert_id TEXT NOT NULL
  locked BOOLEAN DEFAULT 0       ── zamknuty = nelze prepnout
  strength INTEGER DEFAULT 50    ── sila vlivu (0-100)
  locked_at TIMESTAMP
```

Lifecycle:
- **INACTIVE** — zadny expert prirazeny
- **LOADED** — expert nacten, ne zamknuty
- **LOCKED** — expert zamknuty ke konverzaci
- **APPLIED** — hinty aplikovany na synthesis
- **ENFORCED** — post-synthesis validace provedena

## Expert Cross-Session Pamet (v57.1 A8)

Expert si pamatuje fakta napruc konverzacemi. Priklad: ucetni si zapamatuje, ze uzivatel ma s.r.o.

```
expert_memory tabulka:
  expert_id TEXT          ── ktery expert
  key TEXT                ── nazev faktu ("company_type")
  value TEXT              ── aktualni hodnota ("s.r.o.")
  previous_value TEXT     ── predchozi hodnota ("OSVC") — D-int4 change tracking
  updated_at TIMESTAMP
  PRIMARY KEY (expert_id, key)
```

Omezeni: max 50 polozek na experta, max 2 000 znaku na hodnotu.

Pouziti v systemovem promptu: `{{ memory_context }}` se nahradi pameti pri kazdem volani.

## Routing

`routeToExpert(message, intent)` — jednoduchy keyword match:

```javascript
'ucetnictvi'  → accountant
'rozpocet'    → accountant
'pravne'      → lawyer
'zakon'       → lawyer
'zdravi'      → doctor
'psycholog'   → psychologist
'analyzuj'    → analyst
'kod'         → developer
'naprogramuj' → developer
'auto'        → car_enthusiast
'motorka'     → biker
// ... dalsi patterny
```

Intent-based fallback: `LONG_FORM_CREATION` → writer

## HTTP API

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/experts` | GET | HTML stranka pro spravu |
| `/api/experts` | GET | Seznam vsech expertu + kategorie |
| `/api/experts/:id` | GET | Detail jednoho experta |
| `/api/experts` | POST | Vytvoreni custom experta |
| `/api/experts/:id` | PUT | Uprava custom experta |
| `/api/experts/:id` | DELETE | Smazani (pouze custom) |

## Database Schema

```sql
-- Definice expertu (custom)
CREATE TABLE experts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    domain TEXT,
    system_prompt TEXT,
    temperature REAL,
    config TEXT,               -- JSON: icon, weights, styleRules
    is_builtin BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vazba expert-konverzace
CREATE TABLE conversation_experts (
    conversation_id TEXT PRIMARY KEY,
    expert_id TEXT NOT NULL,
    locked BOOLEAN DEFAULT 0,
    strength INTEGER DEFAULT 50,
    locked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pamet experta (cross-session)
CREATE TABLE expert_memory (
    expert_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    previous_value TEXT,       -- Change tracking (D-int4)
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (expert_id, key)
);
```

---

# Subsystem 2: Accountant Specialist

## Co to je

Accountant Specialist je **prvni plne implementovany domenovy specialista** v C.3. Na rozdil od ostatnich expertu, kteri jen upravuji styl LLM odpovedi, ucetni ma vlastni **deterministicke nastroje** pro ceske danove vypocty. LLM v uchozi ucetniho smere NIKDY nepocita — pouze formatuje vysledky nastroju do citelne formy.

**Klicovy princip:** Cisla pochazi z deterministickych vypoctu, ne z LLM. Tool enforcement kontroluje, ze kazde cislo v odpovedi je podlozene vysledkem nastroje.

## Faze

| Komponenta | Stav | Verze | Poznamka |
|-----------|------|-------|---------|
| Tax Calculator (OSVC + s.r.o.) | HOTOVO | v57 | §7 a §21 ZDP |
| Salary Calculator | HOTOVO | v57 | §6 ZDP, zamestnanec |
| VAT Calculator | HOTOVO | v57 | DPH 21%/12%/0% |
| Deadline Checker | HOTOVO | v57 | Lhuty pro OSVC/s.r.o./DPH |
| Tax Rates Registry | HOTOVO | v57 | 2024 + 2025 sazby |
| Tax Rates Freshness | HOTOVO | v57.3 | Overeni aktualnosti sazeb |
| Accountant Detector (NLP) | HOTOVO | D-int1 | Detekce dotazu z CJ |
| Expert Tool Interception | HOTOVO | D-int2 | ANSWER→TOOL_CALL konverze |
| Async System Prompt Builder | HOTOVO | D-int3 | Pamet + styl injekce |
| Change-Aware Memory | HOTOVO | D-int4 | Sledovani zmen (previous_value) |
| Tool Enforcement Guard | HOTOVO | D-int5 | Overeni ciselnych tvrzeni |
| **Realtime sazby (worker)** | **CHYBI** | — | Agent pro monitoring zmem sazeb |
| **Interaktivni scenare** | **CHYBI** | — | "Co kdyby..." optimalizace |

## Architektura

```
Uzivatel: "Kolik zaplatim z 850k jako OSVC za rok 2024?"
    |
    v
CRE.classifyIntent() → ANSWER
    |
    v
expertHandler() — expert 'accountant' je aktivni
    |
    v
detectAccountantTool(input) — D-int1
    |
    +── Detekce typu: accountant.tax_calculator
    +── Extrakce parametru:
    |     gross_income: 850000
    |     entity_type: 'osvc'
    |     year: 2024
    |     expense_type: null (→ default flat_60)
    |
    v
calculateTax(params) — deterministicky vypocet
    |
    +── Pausalni vydaje: 850000 × 60% = 510000 (max 1 200 000, OK)
    +── Zaklad dane: 850000 - 510000 = 340000
    +── Dan pred slevami: 340000 × 15% = 51000
    +── Sleva na poplatnika: 30840
    +── Dan: 51000 - 30840 = 20160
    +── Socialni: 170000 × 29.2% = 49680 × 2 = 99360/rok
    +── Zdravotni: 170000 × 13.5% = 22950 × 2 = 45900/rok
    +── Celkove odvody: 165420
    +── Cisty prijem: 684580
    +── Efektivni sazba: 19.45%
    |
    v
wrapWithExpertPersona() — LLM formatuje vysledek
    |
    +── Ucetni persona (profesionalni ton, tabulky)
    +── Predpoklady (assumptions z toolu)
    +── Disclaimer (povinny)
    |
    v
Tool Enforcement Guard — overeni cisel
    |
    +── Kazde cislo v odpovedi matchnuto proti tool data
    +── Fuzzy tolerance ±1% pro cisla > 100
    +── Nepodlozena cisla → varovani
    |
    v
TaggedResponse s metadaty { expert, enforcement, toolResults }
```

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/experts/tools/tax-calc.js` | 449 | OSVC + s.r.o. danovy kalkulator |
| `src/experts/tools/salary-calc.js` | 327 | Mzdovy kalkulator (zamestnanec) |
| `src/experts/tools/vat-calc.js` | 125 | DPH kalkulator |
| `src/experts/tools/tax-rates.js` | 352 | Registry danovych sazeb (2024/2025) |
| `src/experts/tools/tax-rates-freshness.js` | 229 | Overeni aktualnosti sazeb |
| `src/experts/tools/accountant-detector.js` | 282 | NLP detekce ucetnich dotazu |
| `src/experts/tools/deadline-checker.js` | 277 | Kalkulator danovych lhut |
| `tests/accountant-tools.test.js` | 718 | Unit testy nastroju (77+ testu) |
| `tests/accountant-e2e.test.js` | 387 | End-to-end testy ucetniho |

**Celkem ucetni kod: ~3 146 radku (tools + testy)**

## Nastroje v detailu

### 1. Tax Calculator (`tax-calc.js`, 449 radku)

Vypocet dane z prijmu pro OSVC (§7 ZDP) a s.r.o. (§21 ZDP).

**Vstup:**

| Parametr | Typ | Vychozi | Popis |
|----------|-----|---------|-------|
| `gross_income` | number | povinny | Rocni prijem v CZK |
| `expense_type` | string | `flat_60` | `actual`, `flat_80`, `flat_60`, `flat_40`, `flat_30` |
| `expenses` | number | 0 | Pro skutecne vydaje |
| `entity_type` | string | `osvc` | `osvc` nebo `sro` |
| `year` | number | aktualni | 2024, 2025 |
| `children` | number | 0 | Pocet deti |
| `spouse_credit` | boolean | false | Sleva na manzelku |
| `student` | boolean | false | Sleva na studenta |
| `disability` | boolean | false | Invalidita |
| `disability_level` | number | 0 | Stupen (1/2/3) |

**Vystup:**

```javascript
{
  entity_type: 'osvc',
  year: 2024,
  gross_income: 850000,
  expenses: 510000,               // Vypoctene pausalni vydaje
  expense_type: 'flat_60',
  tax_base: 340000,               // Zaklad dane
  income_tax_before_credits: 51000,
  credits: 30840,                 // Sleva na poplatnika
  child_benefit: 0,
  income_tax: 20160,              // Vysledna dan
  social_insurance: 99360,        // Socialni pojisteni/rok
  health_insurance: 45900,        // Zdravotni pojisteni/rok
  total_tax_burden: 165420,       // Celkove odvody
  net_income: 684580,             // Cisty prijem
  effective_rate: 19.45,          // Efektivni sazba v %

  assumptions: [                  // Co bylo predpokladano
    'Zadne dalsi prijmy (§6, §8, §9, §10 ZDP)',
    'Hlavni cinnost OSVC',
    'Zdanovaci obdobi: 2024',
  ],
  warnings: [],                   // Varovani (napr. prekroceni stropu)
  breakdown: {                    // Detailni rozpis pro ucetniho
    expense_description: 'Pausalni vydaje 60%: 510 000 Kc...',
    income_tax_computation: '340 000 x 15% = 51 000',
    social_computation: '170 000 (50% ZD) x 29.2% = 49 680/rok',
    health_computation: '170 000 (50% ZD) x 13.5% = 22 950/rok',
  }
}
```

**s.r.o. vypocet:**
- Dan z prijmu pravnickych osob (DPPO): 21%
- Srazkova dan z dividend: 15%
- Kombinovana efektivni sazba: 1 − (1−0.21)(1−0.15) = 32.85%

**Stropy pausalnich vydaju:**
- flat_60: max 1 200 000 Kc
- flat_80: max 1 600 000 Kc
- Prekroceni → varovani v `warnings[]`

### 2. Salary Calculator (`salary-calc.js`, 327 radku)

Mesicni/rocni rozpis mzdy zamestnance (§6 ZDP).

**Vstup:**

| Parametr | Typ | Vychozi | Popis |
|----------|-----|---------|-------|
| `gross_salary` | number | povinny | Mesicni hruba mzda v CZK |
| `year` | number | aktualni | 2024, 2025 |
| `children` | number | 0 | Pocet deti pro danove zvyhodneni |
| `spouse_credit` | boolean | false | Sleva na manzelku (1/12 rocne) |
| `student` | boolean | false | Sleva na studenta |
| `disability` | boolean | false | Invalidita |
| `ztpp` | boolean | false | Dite ZTP/P (zdvojuje zvyhodneni) |
| `signed_declaration` | boolean | true | Prohlaseni poplatnika (nutne pro slevy) |
| `mode` | string | `monthly` | `monthly` nebo `annual` |

**Vystup (mesicni):**

```javascript
{
  gross_salary: 50000,
  social_employee: 3400,          // 6.8%
  health_employee: 1450,          // 2.9% (min z 1/2 prumerne mzdy × 13.5%)
  total_employee_deductions: 4850,
  tax_base: 50000,
  tax_advance_before_credits: 7500,  // 15%
  credits: 2570,                  // Sleva na poplatnika (30840/12)
  child_benefit: 0,
  tax_advance: 4930,
  net_salary: 40220,
  net_to_gross_ratio: 80.44,      // Pomer cista/hruba v %

  // Naklady zamestnavatele
  social_employer: 11500,         // 23%
  health_employer: 3800,          // 7.6% (min z 1/2 prumerne mzdy × 13.5%)
  total_employer_cost: 65300,
  employer_overhead_pct: 30.6,    // Nadrazi v %
}
```

**Porovnani mezd:**

```javascript
compareSalaries([30000, 40000, 50000], { year: 2024 })
→ [{
    from_gross: 30000,
    to_gross: 40000,
    gross_increase: 10000,
    net_increase: 7980,
    marginal_tax_rate: 20.2,       // % z pridani jde na odvody
    note: 'Z 10 000 pridano hrubeho dostanes 7 980 cisteho navic'
  }, ...]
```

### 3. VAT Calculator (`vat-calc.js`, 125 radku)

Vypocet DPH pro ceske podnikatele.

**Sazby:**
- Zakladni: 21%
- Snizena: 12% (po reforme 2024, drive 15%/10%)
- Nulova: 0% (export)

**Funkce:**
- `calculateVAT({ amount, rate, direction })` — hlavni kalkulator
- `addVAT(amount, rate)` — pridat DPH k zakladu
- `removeVAT(amount, rate)` — odecist DPH z celkove castky

### 4. Tax Rates Registry (`tax-rates.js`, 352 radku)

Centralni registr vsech ceskych danovych sazeb, indexovany podle roku.

**Obsah:**

```javascript
RATES[2024] = {
  income_tax: {
    base_rate: 0.15,                    // 15%
    higher_rate: 0.23,                  // 23% nad prah
    higher_rate_threshold: 1_620_000,   // Rocni limit
  },
  social: {
    osvc_rate: 0.292,                   // OSVC: 29.2%
    osvc_min_monthly: 2926,             // Min. mesicni zaloha
    employee_rate: 0.068,              // Zamestnanec: 6.8%
    employer_rate: 0.23,               // Zamestnavatel: 23%
    max_base: 1_708_728,              // Strop vymerovaciho zakladu
  },
  health: {
    osvc_rate: 0.135,                  // OSVC: 13.5%
    employee_rate: 0.029,             // Zamestnanec: 2.9% (min z 1/2 prumerne mzdy × 13.5%)
    employer_rate: 0.076,             // Zamestnavatel: 7.6% (min z 1/2 prumerne mzdy × 13.5%)
  },
  corporate: {
    rate: 0.21,                        // DPPO: 21%
    dividend_rate: 0.15,              // Srazkova dan: 15%
  },
  credits: {
    taxpayer: 30840,                   // Zakladni sleva
    spouse: 30840,                     // Sleva na manzelku
    student: 4620,                     // Sleva studenta
    child_1: 15204,                    // 1. dite
    child_2: 22320,                    // 2. dite
    child_3: 29904,                    // 3.+ dite
    child_disabled_multiplier: 2,      // ZTP/P zdvojeni
  },
  flat_expense: {
    rate_80: { rate: 0.80, max: 1_600_000 },
    rate_60: { rate: 0.60, max: 1_200_000 },
    rate_40: { rate: 0.40, max: 800_000 },
    rate_30: { rate: 0.30, max: 600_000 },
  },
  salary: {
    min_wage_monthly: 18900,
  },
}
```

Podporovane roky: 2024, 2025.

### 5. Tax Rates Freshness (`tax-rates-freshness.js`, 229 radku)

Monitorovani aktualnosti embedovanych sazeb.

**Verifikacni zdroje:**
1. Financni sprava: https://www.financnisprava.cz/
2. CSSZ: https://www.cssz.cz/
3. MPSV: https://www.mpsv.cz/
4. MFCR: https://www.mfcr.cz/

**Varuje kdyz:**
- Sazby jsou starsi nez 6 mesicu
- Rok neni v registru (fallback na posledni znamy rok)
- Doporucuje overeni u Financni spravy

### 6. Deadline Checker (`deadline-checker.js`, 277 radku)

Ceske danove lhuty pro podani a platby.

**Pokryte lhuty:**
- OSVC: danove priznani (31.3., resp. 1.4. s poradcem), prehled CSSZ, prehled ZP
- s.r.o.: danove priznani DPPO, ucetni zaverka
- DPH: mesicni (25. nasledujiciho mesice), ctvrtletni (25. nasledujiciho mesice po ctvrtleti)
- Kontrolni hlaseni, souhrnne hlaseni

### 7. Accountant Detector (`accountant-detector.js`, 282 radku)

NLP detekce ucetnich dotazu z ceskeho prirozeneho jazyka.

**5 typu dotazu (v poradi priority):**

| Typ | Pattern priklady | Extrahuje |
|-----|------------------|-----------|
| COMPARE | "porovnej OSVC vs s.r.o." | castka, rok |
| VAT | "kolik DPH z 10000" | castka, smer, sazba |
| SALARY | "cista mzda z 50000" | hruba_mzda, deti, rok |
| DEADLINE | "kdy musim podat priznani" | typ_subjektu, rok |
| TAX | "kolik zaplatim z 850k" | castka, typ_subjektu, vydaje, rok |

**Extrakce castek z prirozeneho jazyka:**
- `"850k"` → 850 000
- `"2M"` → 2 000 000
- `"850 tisic"` → 850 000
- `"z 50000"` → 50 000

**Extrakce typu subjektu:**
- `"OSVC"`, `"zivnost"`, `"zivnostnik"` → `osvc`
- `"s.r.o."`, `"sro"`, `"spolecnost"` → `sro`

## Systemovy prompt ucetniho

```
Jsi danovy specialista pro Ceskou republiku.

## KONTEXT
{{ memory_context }}

## PRAVIDLA

### Jurisdikce a rok
- Vzdy specifikuj zdanovaci obdobi (rok) a jurisdikci (CR)
- Rozlisuj OSVC (§7 ZDP), s.r.o. (§21 ZDP), zamestnance (§6 ZDP)
- Pri dotazu na aktualni rok VZDY nejdriv over sazby pres vyhledavani

### Vypocty — POVINNE POUZITI NASTROJU
- Pro KAZDY vypocet MUSIS pouzit odpovidajici nastroj
- NIKDY nepocitej rucne. NIKDY neodhaduj cisla.
- Vysledky z nastroju cituj presne, neupravuj.

### Citace zakonu
Misto zkraceneho "§7 ZDP" uvadej plnou citaci:
"§7 zakona c. 586/1992 Sb., o danich z prijmu"

### Vystup
- Prehledy formatuj jako Markdown tabulky
- Mena: CZK (Kc), zaokrouhleni na cele koruny
- Vzdy uved sekci "Predpoklady"
- Vzdy uved sekci "Nezahrnuje"

### Disclaimer (POVINNY)
"Toto je informativni prehled, nikoli zavazna danova rada.
Pro konkretni danove rozhodnuti konzultujte danoveho poradce."
```

---

# Subsystem 3: Expert Enforcement & Quality Pipeline

## Co to je

Enforcement pipeline zajistuje, ze odpovedi od expertu splnuji kvalitativni standardy. Kontroluje zakazane fraze, minimalni delku, a u ucetniho navic overuje, ze kazde cislo v odpovedi pochazi z deterministickeho nastroje (ne z LLM halucinace).

**Klicovy princip:** Post-synthesis validace s moznosti retry. Pokud odpoved porusuje pravidla, regeneruje se s kontextem o poruseni (max 2 pokusy).

## Faze

| Komponenta | Stav | Verze | Poznamka |
|-----------|------|-------|---------|
| Forbidden phrases (default) | HOTOVO | v44.10 | 4 globalni patterny |
| Forbidden phrases (per-expert) | HOTOVO | v44.10 | Kazdy expert ma vlastni |
| Min. response length | HOTOVO | v44.10 | Konfigurovatelne per-expert |
| Retry logic (max 2) | HOTOVO | v57 | S kontextem poruseni |
| Tool enforcement (cisla) | HOTOVO | D-int5 | Ucetni — kazde cislo overeno |
| Fuzzy number matching | HOTOVO | D-int5 | ±1% tolerance pro cisla > 100 |
| Safe number exclusion | HOTOVO | D-int5 | Single digits, verze, roky |
| Domain synthesis prompty | HOTOVO | v57.1 A7 | Finance, pravo, medicina |

## Architektura

```
LLM generuje odpoved s expertnim promptem
    |
    v
ExpertEnforcer.enforce(response, expert)
    |
    +── 1. checkForbiddenPhrases(response, expert.styleRules.forbiddenPhrases)
    |       |
    |       +── Default: "nevim", "to zalezi", "jako jazykovy model", "nemohu pomoci"
    |       +── Ucetni: "odhaduji", "priblizne", "muze byt kolem", "tipuji"
    |       +── Spisovatel: "obecne plati", "muze byt ruzne"
    |       +── Analytik: "mozna", "asi", "nevim presne"
    |       +── Vyvojar: "TODO.*later", "this is just an example"
    |
    +── 2. checkResponseLength(response, expert.styleRules.minResponseLength)
    |       |
    |       +── Default: 50 znaku
    |       +── Spisovatel: 200 znaku
    |       +── DnD Master: 150 znaku
    |       +── Ucetni: 100 znaku
    |
    +── PORUSENI?
    |       |
    |       +── ANO (pokus 1) → Regenerace s kontextem:
    |       |     "Predchozi odpoved porusila: [seznam poruseni]. Prosim oprav."
    |       |
    |       +── ANO (pokus 2) → Posledni pokus s explicitnim upozornenim
    |       |
    |       +── ANO (pokus 3) → Ponechat s varovanim (configurable)
    |       |
    |       +── NE → Pokracovat na tool enforcement
    |
    +── 3. Tool Enforcement (pouze kdyz expert.styleRules.toolEnforcement === true)
    |       |
    |       +── extractNumericClaims(response)  ── vsechna cisla v odpovedi
    |       +── extractNumbersFromToolData(toolResults)  ── cisla z nastroju
    |       +── verifyNumericClaims()
    |       |     |
    |       |     +── Pro kazde cislo v odpovedi:
    |       |     |     isSafeNumber()? → SKIP (single digit, verze, rok, ...)
    |       |     |     fuzzyNumberMatch(claim, toolData)? → BACKED
    |       |     |     else → UNBACKED
    |       |     |
    |       |     +── Vysledek: { ok, unbacked[], backed[], safe[], reason }
    |       |
    |       +── Nepodlozena cisla → append varovani k odpovedi
    |
    v
EnforcementResult {
  passed: boolean,          ── vsechny kontroly prosly
  response: string,         ── (mozna regenerovana) odpoved
  attempts: number,         ── pocet pokusu (1-3)
  violations: string[],     ── seznam poruseni
  wasRetried: boolean,      ── byla regenerovana?
  warning?: string          ── varovani (pokud failed ale ponechano)
}
```

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/experts/expert-enforcement.js` | 341 | Forbidden phrases, delka, retry logika |
| `src/experts/guards/tool-enforcement.js` | 365 | Overeni ciselnych tvrzeni vs. tool data |
| `tests/tool-enforcement.test.js` | 339 | Unit testy tool enforcement |

## Forbidden Phrases — Prehled

### Globalni (vsichni experti)

| Pattern | Duvod |
|---------|-------|
| `/^(nevim\|netusim)\.?$/i` | Prazdne "nevim" bez vysvetleni |
| `/^to zalezi\.?$/i` | Prazdne "to zalezi" bez kontextu |
| `/jako (velky )?jazykovy model/i` | Self-referencni LLM filler |
| `/nemohu (vam )?pomoci s/i` | Odmitnuti bez vysvetleni |

### Ucetni (navic k globalnim)

| Pattern | Duvod |
|---------|-------|
| `'odhaduji'` | Cisla MUSI byt presna |
| `'priblizne'` | Zadne odhady |
| `'muze byt kolem'` | Zadne odhady |
| `'tipuji'` | Zadne odhady |

### Analytik (navic k globalnim)

| Pattern | Duvod |
|---------|-------|
| `'mozna'` | Hedging bez dukazu |
| `'asi'` | Hedging bez dukazu |
| `'nevim presne'` | Nerozhodnost |
| `'obecne plati'` | Prilis vagne |

### Vyvojar (navic k globalnim)

| Pattern | Duvod |
|---------|-------|
| `'TODO.*later'` | Nedokonceny kod |
| `'this is just an example'` | Cop-out |
| `'you might want to'` | Nerozhodnost |

## Tool Enforcement — Detail

### Extrakce cisel z odpovedi

7 patternu pro detekci:

| Typ | Priklad | Extrahovano |
|-----|---------|-------------|
| Mena | "15 499 Kc", "$299.99" | `15499`, `299.99` |
| Procenta | "21%", "3,5 %" | `21`, `3.5` |
| ISO datum | "2025-04-01" | `20250401` |
| Ceske datum | "1.4.2025" | `20250401` |
| Desetinna | "3.14", "1,5" | `3.14`, `1.5` |
| Velka cela | "150000", "15 000" | `150000` |
| Stredni cela | "250" (ne marker) | `250` |

### Bezpecna cisla (vyloucena z enforcement)

- Jednociferna (0-9)
- Listove markery: "1.", "2)", "3:"
- Poznamky: "[1]", "[2]"
- Verze: "v57", "v2.1"
- Samostatne roky: "2024" (pokud integer kategorie)
- Mala cisla <= 12 (bezna proza)

### Fuzzy matching

- Cisla > 100: tolerance ±1% (ucetni zaokrouhleni)
- Cisla <= 100: presna shoda

### Verdict

```javascript
{
  ok: true/false,         // Vsechna tvrzeni podlozena?
  unbacked: [],           // Cisla bez podkladu v tool data
  backed: [],             // Cisla potvrzena z toolu
  safe: [],               // Vyloucena (bezpecna)
  reason: 'string'        // Lidsky citelny duvod selhani
}
```

## Domain-Specific Synthesis Prompty (v57.1 A7)

Automaticky generovane pokyny pro LLM podle domeny experta:

| Domena | Pokyny |
|--------|--------|
| **Finance** | Presne terminy, dane s casem, sazby s cislem, lhuty s datem |
| **Legal** | Citace zakonu (§, cislo zakona), rozlisuj varianty, jurisdikce |
| **Medical** | Cervene vlajky, nikdy nedoporucuj leky, reference guidelines |
| **Technical** | Kompatibilita verzi, prakticke priklady, bezpecnost |

---

## Prehled Testu

| Test suite | Soubor | Pocet testu | Stav |
|-----------|--------|-------------|------|
| Expert CRUD | `tests/expert-system.test.js` | ~36 | PASS |
| Expert integrace | `tests/expert-integration.test.js` | ~20 | PASS |
| Ucetni nastroje | `tests/accountant-tools.test.js` | ~77 | PASS |
| Ucetni E2E | `tests/accountant-e2e.test.js` | ~30 | PASS |
| Tool enforcement | `tests/tool-enforcement.test.js` | ~25 | PASS |
| **Celkem** | | **~188** | **PASS** |

---

## Kompletni Inventory Souboru

```
src/experts/
├── expert-layer.js              1 317 radku  Expert definice, registry, routing, presety
├── expert-store.js                705 radku  DB persistence, CRUD, pamet, vazby
├── expert-enforcement.js          341 radku  Forbidden phrases, delka, retry
├── experts.html                   889 radku  Web UI pro spravu expertu
├── guards/
│   └── tool-enforcement.js        365 radku  Overeni ciselnych tvrzeni
└── tools/
    ├── tax-calc.js                449 radku  OSVC + s.r.o. danovy kalkulator
    ├── salary-calc.js             327 radku  Mzdovy kalkulator
    ├── vat-calc.js                125 radku  DPH kalkulator
    ├── tax-rates.js               352 radku  Registry sazeb (2024/2025)
    ├── tax-rates-freshness.js     229 radku  Overeni aktualnosti
    ├── accountant-detector.js     282 radku  NLP detekce dotazu
    └── deadline-checker.js        277 radku  Danove lhuty

src/chat/handlers/
└── expert.js                      484 radku  Expert handler (routing, tool intercepce)

tests/
├── expert-system.test.js          587 radku  Unit testy expert system
├── expert-integration.test.js     300 radku  Integracni testy
├── accountant-tools.test.js       718 radku  Testy ucetnich nastroju
├── accountant-e2e.test.js         387 radku  End-to-end ucetni
└── tool-enforcement.test.js       339 radku  Testy enforcement guardu
```

**Celkem src:** 5 142 radku
**Celkem testy:** 2 331 radku
**Celkem UI:** 889 radku
**Grand total:** 8 362 radku

---

## Co Chybi — Zbyvajici Prace pro Fazi D

| Polozka | Odhad | Priorita | Popis |
|---------|-------|----------|-------|
| Specialist Runtime | 6-8 tydnu | P2 | Dlouhodobe behy, rutiny, on-demand agenti |
| Knowledge Base | 3-5 dnu | P2 | Propojeni expertu s domenovymi DB |
| ~~Multi-expert spoluprace~~ | ~~2-3 dny~~ | ~~P3~~ | **HOTOVO v63.0** — Merge Engine v2 |
| Expert sablony | 1 den | P3 | UI pro vytvareni z sablon |
| Expert analytika | 1 den | P3 | Sledovani pouziti, kvalita |
| Realtime sazby (worker) | 1 den | P2 | Agent pro monitoring zmen sazeb |
| Interaktivni scenare | 2-3 dny | P3 | "Co kdyby..." optimalizace |

**Roadmapa v4 hodnoceni: 45% hotovo (Expert Layer + Accountant pilot + Merge Engine v2)**

---
---

# Subsystem 4: Agent Runner & Scheduler

## Co to je

Agent Runner je **deterministicky exekucni engine** pro autonomni monitoring a automatizaci. Workeri (agenti) periodicky stahuju data z externich zdroju (HTTP API, RSS feedy), vyhodnocuji podminky, detekuji hranove zmeny (triggery) a provaduji akce (notifikace, webhooky). Cely rozhodovaci proces je algoritmicky — **zadne LLM v jadru exekuce**. LLM se pouziva pouze pro volitelne formatovani notifikaci.

**Klicovy princip: HUNTER pattern** — `mark_seen` se provadi PRED business akcemi. Pokud server spadne po mark_seen ale pred notifikaci, pri restartu se polozky nepracuji znovu (crash-safe deduplikace).

## Faze

| Komponenta | Stav | Verze | Poznamka |
|-----------|------|-------|---------|
| AgentRunner (exekucni engine) | HOTOVO | v57 | 1 339 radku, 12 run stavu |
| AgentScheduler (cron + interval) | HOTOVO | v57 | Deterministicky restart |
| AgentRepository (SQLite CRUD) | HOTOVO | v57 | 8 tabulek, seen items |
| HUNTER pattern (mark_seen) | HOTOVO | v57 | Transakci pred akcemi |
| Multi-source (_merged view) | HOTOVO | v59/B6 | Deduplikace, health tracking |
| Schema validace (whitelist) | HOTOVO | v57 | Strict enum whitelist |
| Agent Builder (NL → definice) | HOTOVO | B9 | LLM konvertuje popis na JSON |
| Agent API (REST endpointy) | HOTOVO | v57 | 28 endpointu |
| LLM Services (formatovani) | HOTOVO | v57 | Summarize, explain, categorize |
| Source Inspector (introspekce) | HOTOVO | B7 | URL analýza + schema navrh |
| Agent UI (HTML stranky) | HOTOVO | v57 | agents.html + dashboard.html |
| **B8 Realni workeri** | **CHYBI** | — | E2E s realnym API |
| **Timezone podpora** | **CHYBI** | — | Cron "0 7 * * *" = 7:00 CET |

## Architektura

```
AgentScheduler (cron/interval, 30s check loop)
  |
  +── checkDue() → najde agenty kde next_run <= now
  |
  v
AgentRunner.execute(agentId)
  |
  +── STEP 1: Fetch Sources (paralelne, Promise.all)
  |     +── fetchHttp(config)     → JSON/text (GET/POST)
  |     +── fetchRss(config)      → items[] via RSSSource
  |     +── fetchScraper(config)  → fallback na HTTP (placeholder)
  |     +── fetchDatabase(config) → placeholder (vraci [])
  |
  +── STEP 2: Filter Seen Items (HUNTER pattern)
  |     +── repository.getSeenItemIds(agentId, sourceId)
  |     +── Filtruje uz zpracovane polozky
  |     +── Identifikace: id, _id, url, link, nebo JSON hash
  |
  +── STEP 3: Build _merged View (multi-source, v59+)
  |     +── sources._merged.data = vsechny polozky se _source tagem
  |     +── Cross-source deduplikace (URL exact nebo title Jaccard > 0.6)
  |
  +── STEP 4: Evaluate Conditions (deterministicky)
  |     +── 7 typu: compare, date_diff, contains, exists,
  |     |   in_range, changed, new_items
  |     +── Kazda vraci: { passed, actual, expected, reason }
  |     +── Schema degradace: >= 50% invalid → agent auto-disabled
  |
  +── STEP 5: Detect Trigger Edges (stavove)
  |     +── rising (false→true), falling (true→false), any (zmena)
  |     +── Cooldown (sekundy), max_fires_per_day
  |     +── Ulozeno v agent.state._condition_states, _trigger_fires
  |
  +── STEP 6a: mark_seen (transakcni, PRED business akcemi!)
  |     +── repository.markItemsSeenBatch() → idempotentni
  |
  +── STEP 6b: Execute Business Actions (s retry/backoff)
  |     +── notify   → NotificationPipeline [retry: 3x, exp. backoff]
  |     +── webhook  → HTTP POST            [retry: 3x, exp. backoff]
  |     +── update_state → persist           [no retry]
  |     +── log      → logger               [no retry]
  |
  +── STEP 7: Persist State + Complete Run
        +── run_state: SUCCESS_TRIGGERED | SUCCESS_NO_TRIGGER | ...
        +── updateAgentState(), completeRun()
```

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/agents/runner.js` | 1 339 | Exekucni engine — fetch, filter, conditions, triggers, actions |
| `src/agents/scheduler.js` | 282 | Cron + interval planovac, deterministicky restart |
| `src/agents/repository.js` | 662 | SQLite CRUD — agenti, behy, notifikace, seen items |
| `src/agents/schema.js` | 528 | Whitelist validace definic |
| `src/agents/api.js` | 857 | REST API — 28 endpointu (CRUD, run, inspect, build) |
| `src/agents/builder.js` | 255 | NL → agent definice (LLM-based) |
| `src/agents/llm-services.js` | 319 | LLM sluzby: summarize, explain, categorize |
| `src/agents/worker-configs.js` | 265 | Sablony: weather, realty, news |
| `src/agents/agents.html` | 2 852 | Web UI pro spravu agentu |
| `src/agents/dashboard.html` | 239 | Dashboard agentu |
| `src/agents/README.md` | 177 | Dokumentace |
| `src/agents/AGENT-DSL-SCHEMA.md` | 791 | DSL schema dokumentace |

## Run States (12 stavu)

| Stav | Typ | Popis |
|------|-----|-------|
| `SUCCESS_TRIGGERED` | Uspech | Podminky splneny, triggery vysly, akce provedeny |
| `SUCCESS_NO_TRIGGER` | Uspech | Beh dokoncen, zadny trigger nevysel (podminky false) |
| `SUCCESS_NO_NEW` | Uspech | HUNTER: zadne nove polozky (cekaci stav) |
| `INIT_BASELINE` | Specialni | Prvni beh (baseline stanoven) |
| `SKIP_DISABLED` | Preskoceni | Agent je vypnuty |
| `SKIP_SCHEMA_BROKEN` | Preskoceni | Schema validita < 50%, auto-disabled |
| `SKIP_COOLDOWN` | Preskoceni | Cooldown neuplynul |
| `ERROR_SOURCE` | Chyba | Fetch zdroje selhal |
| `ERROR_EXECUTION` | Chyba | Provadeni akce selhalo |
| `ERROR_UNKNOWN` | Chyba | Neocekavana chyba |
| `SCHEMA_DEGRADED` | Degradace | Nektere podminky invalidni (< 50%) |
| `SCHEMA_BROKEN` | Degradace | Prilis mnoho invalidnich (>= 50%), auto-disabled |

## Scheduler — Detail

### Typy planovani

| Typ | Format | Priklad | Popis |
|-----|--------|---------|-------|
| Interval | string | `"5m"`, `"1h"`, `"4h"`, `"1d"` | Pevny interval od posledniho behu |
| Cron | 5 casti | `"0 8 * * *"` | Min Hour Day Month Weekday |
| Manual | — | — | Pouze rucne spusteni pres API |

### Deterministicky restart

Problem: Server spadne v 10:20, posledni beh v 10:00, interval 30m. Kdy je dalsi beh?

Reseni: `next_run = last_run + interval_ms = 10:00 + 30m = 10:30`

Pokud `next_run < now` (10:30 < 10:20 je false, ale kdyby interval byl 15m → 10:15 < 10:20 → beh okamzite).

### Cron parser

Podpora: `*`, `*/N` (kazdych N), `1,2,3` (seznam), `1-5` (rozsah). Hledani dopredu az 1 rok.

## Repository — Database Schema

| Tabulka | Ucel |
|---------|------|
| `agents_v33` | Definice agentu (id, name, definition JSON, enabled, state JSON) |
| `agent_runs_v33` | Historie behu (agent_id, status, run_state, triggers_fired, log) |
| `agent_notifications_v33` | Notifikace z agentu |
| `agent_data_v33` | Key-value store per agent |
| `agent_schedule_v33` | Schedule stav (next_run, last_run) |
| `agent_drafts_v33` | Builder drafty (24h expirace) |
| `agent_seen_items_v57` | HUNTER tracking (agent_id, source_id, item_id, hash) |
| `user_inventory` | TRACKER agent data |

### Klicove metody repository

**CRUD:** `createAgent`, `getAgent`, `getAllAgents`, `updateAgent`, `deleteAgent`, `updateAgentState`

**Behy:** `createRun`, `completeRun`, `getRunHistory`, `getLastRun`

**Seen Items:** `isItemSeen`, `markItemSeen`, `markItemsSeenBatch` (transakcni), `getSeenItemIds`, `clearSeenItems`, `pruneSeenItems(keepCount=1000)`

## Schema Validace (Whitelist)

Pristup: Builder smi generovat POUZE validni struktury. Validator pouziva striktni whitelist.

### Povolene hodnoty

| Kategorie | Povolene |
|-----------|----------|
| Schedule | `cron`, `interval`, `manual` |
| Intervaly | `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `12h`, `1d`, `7d` |
| Zdroje | `http`, `scraper`, `rss`, `database` |
| HTTP metody | `GET`, `POST` |
| Podminky | `compare`, `date_diff`, `contains`, `exists`, `in_range`, `changed`, `new_items` |
| Operatory | `<`, `>`, `<=`, `>=`, `==`, `!=` |
| Array mody | `any`, `all`, `none`, `count`, `min`, `max`, `avg`, `sum` |
| Trigger hrany | `rising`, `falling`, `any` |
| Akce | `notify`, `store`, `webhook`, `mark_seen` |
| Priority | `low`, `normal`, `high` |

### Limity

```
max_sources: 5
max_conditions: 10
max_triggers: 10
max_actions: 10
max_params: 20
min_cooldown: 60s
max_cooldown: 604800s (1 tyden)
max_fires_per_day: 100
```

## Agent Builder (B9)

LLM konvertuje prirozeny jazyk na agent definici.

**Priklad:** "Sleduj Sreality a posli mi email kdyz se objevi byt v Praze pod 5M" →

```javascript
{
  id: "realty-hunter",
  schedule: { type: "interval", value: "30m" },
  sources: [{ id: "sreality", type: "http", config: { url: "..." } }],
  conditions: [{ id: "price-ok", type: "compare", field: "...", operator: "<", value: 5000000 }],
  triggers: [{ id: "new-listing", condition_id: "price-ok", edge: "rising" }],
  actions: [{ type: "notify", config: { channel: "email" } }, { type: "mark_seen" }]
}
```

**Typy agentu:**
- **MONITOR** — sleduje podminku, notifikuje pri prekroceni (pocasi, ceny)
- **HUNTER** — hleda nove polozky odpovidajici kriteriim (nemovitosti, prace)
- **TRACKER** — monitoruje vlastni polozky v case (zaruky, licence)
- **DIGEST** — sbira a shrnuje (zpravy, RSS)
- **SCOUT** — prozkoumava a doporucuje

## REST API (28 endpointu)

### Agent CRUD

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/agents` | GET | Seznam vsech agentu |
| `/api/agents/:id` | GET | Detail + behy + notifikace |
| `/api/agents` | POST | Vytvoreni (validuje definici) |
| `/api/agents/:id` | PUT | Aktualizace |
| `/api/agents/:id` | DELETE | Smazani |

### Exekuce

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/agents/:id/run` | POST | Rucni spusteni |
| `/api/agents/:id/enable` | POST | Povoleni |
| `/api/agents/:id/disable` | POST | Zakazani |
| `/api/agents/:id/runs` | GET | Historie behu |

### Builder

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/agents/from-description` | POST | NL → definice |
| `/api/agents/refine` | POST | Uprava definice |
| `/api/agents/confirm` | POST | Ulozeni agenta |

### Source Inspector (B7)

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/sources/inspect` | POST | Analyzovat URL, zjistit schema |
| `/api/sources/validate-field` | POST | Overit field path |
| `/api/sources/validate-condition` | POST | Otestovat podminku na samplu |

### Notifikace

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/notifications` | GET | Seznam (s filtry) |
| `/api/notifications/:id/read` | POST | Oznacit jako prectene |
| `/api/notifications/read-all` | POST | Oznacit vse |

## Prikladove Agenti (6 sablon)

### 1. Weather Monitor (`weather-monitor.json`)

- **Typ:** MONITOR
- **Schedule:** interval 1h
- **Zdroj:** Open-Meteo API (HTTP)
- **Podminka:** teplota < 0°C
- **Trigger:** rising (false→true) + cooldown 3600s
- **Akce:** notify telegram

### 2. Realty Watcher (`realty-watcher.json`)

- **Typ:** HUNTER
- **Schedule:** interval 30m
- **Zdroj:** Sreality API (HTTP)
- **Podminka:** new_items
- **Akce:** notify email + mark_seen

### 3. Realty Multi-Source (`realty-multi-source.json`)

- **Typ:** HUNTER (multi-source)
- **Zdroje:** Sreality + Bezrealitky (2x HTTP)
- **Podminka:** exists na `sources._merged.data`
- **Akce:** notify + mark_seen per zdroj

### 4. News RSS Digest (`news-rss-digest.json`)

- **Typ:** DIGEST
- **Schedule:** cron "0 8 * * *" (denne v 8:00)
- **Zdroje:** 2x RSS (Novinky, Technet)
- **Podminka:** new_items s filterKeywords ["AI"]
- **Akce:** notify telegram s `use_llm: true` (LLM shrne)

### 5. Rate Monitor (`rate-monitor.json`)

- **Typ:** TRACKER
- **Schedule:** cron "0 9 * * 1" (pondeli v 9:00)
- **Zdroje:** 6x HTTP (CSSZ, VZP, MPSV, MF, FS, kurzy)
- **Podminka:** changed (obsah se zmenil)
- **Akce:** notify (zmena danovych sazeb)

### 6. Morning Briefing (`morning-briefing.json`)

- **Typ:** DIGEST (multi-type)
- **Schedule:** cron "0 7 * * *"
- **Zdroje:** RSS (BBC) + HTTP (pocasi) + HTTP (kurzy) — 3 ruzne typy
- **Akce:** notify s prehledem dne

## Retry & Backoff

```
maxAttempts: 3
baseDelay: 500ms
backoffMultiplier: 2  →  500ms → 1000ms → 2000ms

Retriable: notify, webhook
Non-retriable: mark_seen, update_state, log
```

## Template Interpolace

Format: `{{ path.to.field }}`

Kontext:
```
sources.SOURCE_ID.data.field     — pristup k datum zdroje
sources.SOURCE_ID.filtered_count — pocet polozek po filtraci
sources._merged.data             — vsechny zdroje dohromady
state.field                      — stav agenta
params.field                     — parametry agenta
now                              — aktualni cas
```

---

# Subsystem 5: Zdroje, Podminky & Triggery

## Co to je

Datovy pipeline ktery transformuje surova data ze zdroju na rozhodnuti "ma se neco stat?". Tri komponenty:

1. **Zdroje** — stahnou data z externich API/feedu
2. **Podminky** — deterministicky vyhodnoti pravidla nad daty
3. **Triggery** — detekuji hranove zmeny (state-based edge detection)

**Klicovy princip:** Zadne LLM. Vsechno je algoritmicke — compare, exists, contains, changed. LLM se nikdy nevolá pri vyhodnocovani podminek.

## Faze

| Komponenta | Stav | Poznamka |
|-----------|------|---------|
| HTTP zdroj (GET/POST) | HOTOVO | JSON nebo text |
| RSS zdroj (RSS 2.0 + Atom 1.0) | HOTOVO | 211 radku, keyword filter |
| Source Inspector (B7) | HOTOVO | URL introspekce + schema navrh |
| Source Schema (vrstva 2) | HOTOVO | Field mapping + transforms |
| 7 typu podminek | HOTOVO | Vsechny deterministicke |
| Array mody (8 typu) | HOTOVO | any/all/none/count/min/max/avg/sum |
| 3 typy triggeru | HOTOVO | rising/falling/any + cooldown |
| Multi-source deduplikace | HOTOVO | URL exact + title Jaccard |
| Source Health Tracking | HOTOVO | Reliability monitoring |
| **Scraper zdroj** | **PLACEHOLDER** | Fallback na HTTP |
| **Database zdroj** | **PLACEHOLDER** | Vraci prazdne [] |

## Architektura

```
Externi svet
    |
    +── HTTP API (Open-Meteo, Sreality, kurzy, ...)
    +── RSS/Atom feedy (iROZHLAS, Lupa, BBC, ...)
    |
    v
SOURCE LAYER — paralelni fetch
    |
    +── fetchHttp()  → JSON/text
    +── fetchRss()   → RSSSource.fetch() → items[]
    |
    v
MULTI-SOURCE MERGE (v59+)
    |
    +── normalizeItems()    — standardizace z ruznych zdroju
    +── deduplicateItems()  — URL exact || title Jaccard > 0.6
    +── sources._merged     — synteticky zdroj vsech polozek
    +── SourceHealthTracker — sledovani spolehlivosti per zdroj
    |
    v
CONDITION EVALUATOR — 7 deterministickych typu
    |
    +── compare     — field </>/<=/>==/!= value
    +── date_diff   — stari polozky > N dnu/hodin
    +── contains    — string obsahuje text
    +── exists      — pole existuje, min_count
    +── in_range    — hodnota v [min, max]
    +── changed     — hodnota se zmenila od minule
    +── new_items   — nove polozky v poli (HUNTER)
    |
    v
TRIGGER EVALUATOR — hranova detekce
    |
    +── rising  — false→true (prah prekrocen)
    +── falling — true→false (zotaveni)
    +── any     — jakakoli zmena
    +── + cooldown (sekundy)
    +── + max_fires_per_day
```

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/agents/conditions.js` | 551 | 7 typu podminek, field path resoluce, array mody |
| `src/agents/triggers.js` | 172 | Hranova detekce, cooldown, denni limity |
| `src/agents/multi-source.js` | 376 | Deduplikace, health tracking, merged view |
| `src/agents/sources/rss.js` | 211 | RSS 2.0 + Atom 1.0 parser |
| `src/agents/sources/inspector.js` | 395 | URL introspekce, schema navrh |
| `src/agents/sources/schema.js` | 207 | Field mapping, transforms |

## 7 Typu Podminek — Detail

### 1. compare

Porovnani hodnoty pole s prahem.

```javascript
{
  id: "price_ok",
  type: "compare",
  field: "sources.listings.data[*].price",
  operator: "<",           // < > <= >= == !=
  value: 5000000,
  array_mode: "any"        // POVINNE pokud field ma [*]
}
```

### 2. date_diff

Stari datum od ted.

```javascript
{
  id: "old_item",
  type: "date_diff",
  field: "sources.news.data[*].published",
  operator: ">",
  value: 7,
  unit: "days"             // days | hours | minutes
}
```

### 3. contains

Hledani textu v retezci.

```javascript
{
  id: "is_python",
  type: "contains",
  field: "sources.jobs.data[*].description",
  value: "Python",
  case_sensitive: false
}
```

### 4. exists

Pole existuje a ma minimalni pocet polozek.

```javascript
{
  id: "has_listings",
  type: "exists",
  field: "sources.listings.data",
  min_count: 1
}
```

### 5. in_range

Hodnota v intervalu [min, max].

```javascript
{
  id: "price_range",
  type: "in_range",
  field: "sources.listings.data[*].price",
  min: 2000000,
  max: 8000000,
  array_mode: "any"
}
```

### 6. changed

Detekce zmeny oproti minulemu behu (stav ulozeny v agent.state).

```javascript
{
  id: "temp_changed",
  type: "changed",
  field: "sources.weather.data.temperature",
  compare_field: "_prev_temperature"  // klic v state
}
```

### 7. new_items

Detekce novych polozek v poli (HUNTER pattern).

```javascript
{
  id: "new_listings",
  type: "new_items",
  field: "sources.listings.data",
  id_field: "hash_id",
  min_new: 1
}
```

### Array Mody

Kdyz field obsahuje `[*]` (wildcard), je treba specifikovat jak se pole zpracuje:

| Mod | Popis | Priklad |
|-----|-------|---------|
| `any` | Alespon jeden splnuje | Jakakoliv cena < 5M |
| `all` | Vsechny splnuji | Vsechny ceny < 5M |
| `none` | Zadny nesplnuje | Zadna cena < 5M |
| `count` | Pocet polozek | Count > 3 |
| `min` | Minimalni hodnota | Min cena < 3M |
| `max` | Maximalni hodnota | Max cena > 10M |
| `avg` | Prumer | Prumerna cena < 5M |
| `sum` | Soucet | Celkova castka > 20M |

### Field Path Resoluce

Format: `sources.SOURCE_ID.data.path.to.field`

- `sources.weather.data.current.temperature_2m` — pristup k vnorenym polim
- `sources.listings.data[*].price` — wildcard → pole cen
- `sources._merged.data` — vsechny zdroje dohromady
- `state.field` — stav agenta
- `params.field` — parametry

## Triggery — Detail

### 3 Typy Hran

| Hrana | Podminky vyslani | Ucel |
|-------|-----------------|------|
| `rising` | predchozi=false, aktualni=true | Alert pri prekroceni prahu |
| `falling` | predchozi=true, aktualni=false | Alert pri zotaveni |
| `any` | predchozi != aktualni | Jakakoli zmena (pro digesty) |

### Ochrana proti spamu

1. **Cooldown** (sekundy) — minimalni cas mezi dvema vyslanimi stejneho triggeru
2. **max_fires_per_day** — denni limit (reset o pulnoci)
3. **Prvni beh** — trigger vyslse pouze pokud aktualni=true a hrana je rising nebo any

### State Tracking

Ulozeno v `agent.state`:
```
_condition_states     — predchozi hodnoty podminek (pro edge detection)
_trigger_fires        — timestamp posledniho vyslani per trigger
_trigger_daily_counts — pocet vyslani dnes per trigger
_last_day             — aktualni datum (pro denni reset)
```

## RSS Source — Detail

Parser pro RSS 2.0 a Atom 1.0.

**Vstup:** URL + maxItems + filterKeywords

**Vystup:**
```javascript
{
  id: "guid | link | rss-N",
  title: "Titulek clanku",
  link: "https://...",
  published: "2026-02-13T08:00:00Z",
  content: "Text bez HTML tagu",
  source: "https://feed.url"
}
```

**Funkce:**
- Auto-detekce formatu (RSS vs Atom)
- CDATA podpora pro description
- HTML entity unescape (`&lt;` → `<`, `&#123;` → `{`)
- Stripovani HTML tagu
- Keyword filtr (case-insensitive)

## Source Inspector (B7)

Analyzuje neznamou URL a navrhne schema.

**Vstup:** URL

**Vystup:**
```javascript
{
  url, contentType, size,
  dataType: 'json' | 'html' | 'xml' | 'rss',
  structure: { type, fields[], detectedItems[] },
  schema: {
    version, hash, confidence,  // 0.3-0.95
    fieldCount, itemCount,
    fields: [{ name, type, path, confidence }]
  }
}
```

**Confidence:**
- JSON: 0.95 (spolehlive)
- HTML: 0.3-0.85 (podle poctu detekovanych polozek)

## Multi-Source (B6)

### Problem
Sreality + Bezrealitky vraci stejny byt pod ruznym ID = duplicitni notifikace.

### Reseni

1. **Normalizace** — standardizace polozek z ruznych zdroju
2. **Deduplikace** — dvoustupnova:
   - Presna shoda URL
   - Titulek Jaccard index > 0.6
3. **Merged view** — `sources._merged.data` pro cross-source podminky
4. **Health tracking** — `SourceHealthTracker` monitoruje spolehlivost per zdroj

### Castecne selhani

Pokud jeden zdroj selze, ostatni pokracuji. `_merged` obsahuje data jen z uspesnych zdroju.

---

# Subsystem 6: Notifikacni Pipeline

## Co to je

Notifikacni pipeline je kompletni system pro dorucovani zprav uzivateli pres vice kanalu (email, Telegram, ntfy.sh push, in-app). Obsahuje policy engine (rozhodnuti co poslat, co potlacit, co batchy), trust feedback loop (automaticke ztlumeni agentu kteri posilaji neuzitecne notifikace) a digest batching (shrnuti vice udalosti do jedne zpravy).

**Klicovy princip:** Notifikace nejsou jen "posli zpravu". Kazda projde policy vyhodnocenim (mute? cooldown? escalace? digest?) a po doruceni muze uzivatel dat zpetnou vazbu (👍/👎) ktera ovlivni budouci chovani.

## Faze

| Komponenta | Stav | Poznamka |
|-----------|------|---------|
| NotificationPipeline (orchestrator) | HOTOVO | Policy → Router → Channel |
| NotificationRouter (dispatcher) | HOTOVO | Registrace kanalu, fallback |
| NotificationPolicy (rozhodnuti) | HOTOVO | Mute, cooldown, escalace, if_unchanged |
| DigestAggregator (batching) | HOTOVO | Hodinove/denni shrnuti, deduplikace |
| TrustTracker (zpetna vazba) | HOTOVO | Auto-degrade (< 30%), auto-mute (< 10%) |
| EmailChannel (SMTP) | HOTOVO | nodemailer, HTML + plain text |
| TelegramChannel (Bot API) | HOTOVO | MarkdownV2 + plain text fallback |
| PushChannel (ntfy.sh) | HOTOVO | JSON body, UTF-8, prioritni tagy |
| NtfyChannel (alternativa) | HOTOVO | Agent-specific tagy, click URL |
| FeedbackHandler | HOTOVO | Telegram inline keyboard, API |
| Trust API (REST) | HOTOVO | Metriky, unmute, reset |
| DB schema (5 tabulek) | HOTOVO | Log, state, buffer, channels, trust actions |
| E2E verifikace | HOTOVO | Test vsech kanalu |
| Sablony (templates) | HOTOVO | HTML, Markdown, plain text |
| **Digest scheduler** | **CASTECNE** | Cron flush existuje, automaticky trigger chybi |

## Architektura

```
Agent akce (notify) nebo API volani
  |
  v
NotificationPipeline.process(ctx, policyConfig)
  |
  +── 1. NotificationPolicy.evaluate(ctx, config)
  |       |
  |       +── Mute check — je agent ztlumeny? (critical bypassuje)
  |       +── Escalace — N notifikaci za X minut → zvyseni priority
  |       +── Suppress cooldown — min. cas od posledniho odeslani
  |       +── Suppress if_unchanged — body hash = stejne jako minule
  |       +── Trust override — auto-degrade/mute z feedbacku
  |       +── Mode — immediate | digest | drop
  |       |
  |       v
  |     PolicyDecision: { decision, effectivePriority, reason, escalated }
  |
  +── 2. Routing podle decision
  |       |
  |       +── immediate → NotificationRouter.send(notification)
  |       |                  +── EmailChannel.send()
  |       |                  +── TelegramChannel.send()
  |       |                  +── PushChannel.send()
  |       |                  +── (fallback: in_app)
  |       |
  |       +── digest → DigestAggregator.add(ctx)
  |       |              +── Ulozeni do notification_digest_buffer_v57
  |       |              +── Flush na digest_schedule cron
  |       |
  |       +── drop → log only (ztlumeny agent)
  |
  +── 3. Logging do notification_log_v57
  |
  v
Doruceno uzivateli
  |
  v
Uzivatel da zpetnou vazbu (👍/👎)
  |
  v
TrustTracker.recordFeedback(notificationId, isUseful)
  |
  +── usefulRatio >= 0.30 → healthy (zadna akce)
  +── usefulRatio < 0.30  → degraded → rezim digest
  +── usefulRatio < 0.10  → critical → auto-mute na 7 dni
  |
  +── Auto-mute NIKDY nebyva tichy — vzdy posle vysvetleni
```

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/notifications/pipeline.js` | 230 | Orchestrator: policy → routing → delivery |
| `src/notifications/service.js` | 144 | NotificationRouter: registrace kanalu, send |
| `src/notifications/policy.js` | 302 | Policy engine: mute, cooldown, escalace |
| `src/notifications/digest.js` | 240 | DigestAggregator: batching, deduplikace |
| `src/notifications/trust.js` | 551 | TrustTracker: zpetna vazba, auto-degrade/mute |
| `src/notifications/feedback.js` | 294 | FeedbackHandler: Telegram keyboard, API |
| `src/notifications/trust-api.js` | 152 | REST API pro trust metriky |
| `src/notifications/db.js` | 110 | DB schema: 5 tabulek + migrace |
| `src/notifications/index.js` | 64 | Factory funkce: createNotificationPipeline |
| `src/notifications/e2e-verify.js` | 273 | E2E verifikace vsech kanalu |
| `src/notifications/templates/default.js` | 63 | HTML, Markdown, plain text sablony |
| `src/notifications/channels/base.js` | 38 | Abstraktni base class |
| `src/notifications/channels/email.js` | 92 | SMTP pres nodemailer |
| `src/notifications/channels/telegram.js` | 97 | Telegram Bot API, MarkdownV2 |
| `src/notifications/channels/push.js` | 105 | ntfy.sh (JSON body, UTF-8) |
| `src/notifications/channels/ntfy.js` | 201 | ntfy.sh alternativni implementace |

**Celkem:** 2 956 radku

## Kanaly — Detail

### Channel Interface

Vsechny kanaly implementuji:

```javascript
class NotificationChannel {
  get name()         → string    // 'email', 'telegram', 'push'
  async send(notif)  → { delivered: bool, messageId?: string, error?: string }
  async verify()     → { ok: bool, error?: string }
}
```

### Email (`email.js`, 92 radku)

- **Transport:** SMTP pres nodemailer (lazy-loaded)
- **Env:** `C3_SMTP_HOST`, `C3_SMTP_PORT`, `C3_SMTP_USER`, `C3_SMTP_PASS`, `C3_SMTP_FROM`
- **Sablony:** HTML + plain text
- **Verify:** Test SMTP pripojeni

### Telegram (`telegram.js`, 97 radku)

- **API:** Telegram Bot API, endpoint `sendMessage`
- **Env:** `C3_TELEGRAM_BOT_TOKEN`, `C3_TELEGRAM_CHAT_ID`
- **Formatovani:** MarkdownV2 (s fallbackem na plain text pri parse chybe)
- **Verify:** Volani `getMe`
- **Ceske znaky:** Plna podpora

### Push / ntfy.sh (`push.js`, 105 radku)

- **Server:** ntfy.sh (default) nebo self-hosted
- **Env:** `C3_NTFY_SERVER`, `C3_NTFY_TOPIC`, `C3_NTFY_TOKEN`
- **Format:** JSON body (ne HTTP hlavicky — podpora UTF-8 diakritiky)
- **Verify:** Health endpoint `/v1/health`

### Prioritni mapovani (ntfy.sh)

| C3 priorita | ntfy cislo | ntfy tag (emoji) |
|-------------|-----------|------------------|
| low | 2 | information_source |
| normal | 3 | robot |
| high | 4 | warning |
| critical | 5 | rotating_light |

## Policy Engine — Detail

### Rozhodovaci proces

1. **Mute check** — je agent ztlumeny? (`muted_until > now`)
   - `critical` priorita mute BYPASSUJE
2. **Escalace** — pocet notifikaci za posledni `window_minutes`
   - Pokud >= `repeat_threshold` → zvyseni priority na `escalate_to`
   - Nelze snizit (high → normal se nestane)
3. **Suppress cooldown** — `cooldown_minutes` od posledniho odeslani
4. **Suppress if_unchanged** — body hash srovnani (stejna zprava = neposlat)
5. **Trust override** — TrustTracker rozhodne: digest nebo drop
6. **Mode** — `immediate`, `digest`, nebo `auto`
   - `auto`: low → digest, normal+ → immediate

### Policy konfigurace

```javascript
{
  mode: 'immediate' | 'digest' | 'auto',
  digest_schedule: '0 18 * * *',     // cron pro flush
  suppress: {
    if_unchanged: false,              // body hash check
    cooldown_minutes: 0               // min. cas mezi odeslani
  },
  escalation: {
    repeat_threshold: 3,              // pocet pro escalaci
    window_minutes: 60,               // casove okno
    escalate_to: 'high'               // cilova priorita
  }
}
```

## Trust Feedback Loop — Detail

### Princip

Uzivatel hodnosti notifikace jako uzitecne (👍) nebo neuzitecne (👎). Systém automaticky reaguje:

| usefulRatio | Trust Level | Akce |
|------------|-------------|------|
| >= 30% | healthy | Zadna (normalni provoz) |
| 10-30% | degraded | Auto-degrade na digest rezim |
| < 10% | critical | Auto-mute na 7 dni + vysvetleni |
| < 5 feedbacku | insufficient_data | Zadna (nedostatek dat) |

### Konfigurace

```javascript
TRUST_CONFIG = {
  windowDays: 30,                    // 30-denni klouzave okno
  minFeedbackCount: 5,               // minimum feedbacku pro akci
  degradeToDigestThreshold: 0.3,     // < 30% uzitecnych → digest
  autoMuteThreshold: 0.1,            // < 10% uzitecnych → mute
  silenceWarningDays: 14             // varovani pri 2+ tydnech ticha
}
```

### TrustMetrics

```javascript
{
  agentId: string,
  totalSent: number,
  totalFeedback: number,
  useful: number,                    // pocet 👍
  notUseful: number,                 // pocet 👎
  usefulRatio: number,               // useful / totalFeedback
  trustLevel: 'healthy' | 'degraded' | 'critical' | 'insufficient_data',
  shouldDegrade: boolean,
  shouldMute: boolean
}
```

### Auto-mute je vzdy viditelny

- NIKDY tichy — vzdy posle vysvetleni uzivateli
- Obsahuje: jmeno agenta, duvod, usefulRatio v %
- Logovano do `notification_trust_actions_v57`
- Prevence duplicit: 24h buffer

### Trust API

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/notifications/:id/feedback` | POST | Zaznamenat 👍/👎 |
| `/api/trust/metrics` | GET | Vsechny metriky (dashboard) |
| `/api/trust/metrics/:agentId` | GET | Metriky jednoho agenta |
| `/api/trust/:agentId/unmute` | POST | Rucni odtlumeni |
| `/api/trust/:agentId/reset` | POST | Reset feedbacku (dev) |

## Digest Batching

### Jak funguje

1. Policy rozhodne `decision: 'digest'`
2. Notifikace ulozena do `notification_digest_buffer_v57`
3. Na `digest_schedule` cron se zavola `pipeline.flushDigest()`
4. Skupiny: `agent_id::channel::recipient`
5. Deduplikace podle titulku (pocita opakovani)

### Format vystupu

```
Denni prehled (5 udalosti)

Dnes 5 udalosti:
- Novy pozemek (Brno)
- Pokles teploty pod -5 °C (2x)
- Zadne nove AI zpravy
```

## Database Schema (5 tabulek)

```sql
-- Log vsech notifikaci
notification_log_v57 (
    id, agent_id, channel, recipient, title, priority,
    delivered, policy_decision, error, context_json,
    useful INTEGER,           -- 👍 = 1, 👎 = 0, NULL = bez feedbacku
    feedback_at TEXT,          -- cas feedbacku
    created_at
)

-- Runtime stav per agent
notification_state_v57 (
    agent_id PRIMARY KEY,
    muted_until, last_sent_at, last_effective_priority,
    last_body_hash, escalation_counter, escalation_window_start,
    auto_mute_reason TEXT
)

-- Buffer pro digest
notification_digest_buffer_v57 (
    id, agent_id, channel, recipient, title, body,
    priority, context_json, created_at
)

-- Per-agent channel overrides
notification_channels_v57 (
    agent_id, channel UNIQUE(agent_id, channel)
)

-- Audit log trust akci
notification_trust_actions_v57 (
    id, agent_id, action, reason, metrics_snapshot, created_at
)
```

---

## Prehled Testu — Workeri & Notifikace

| Test suite | Soubor | Radku | Pocet testu | Stav |
|-----------|--------|-------|-------------|------|
| Workers Phase B | `workers-phase-b.test.js` | 790 | ~73 | PASS |
| Agent Runner | `agent-runner.test.js` | 621 | ~20 | PASS |
| Agent Sources | `agent-sources.test.js` | 305 | ~15 | PASS |
| Agent Wizard | `agent-wizard.test.js` | 403 | ~20 | PASS |
| RSS Integration | `rss-integration.test.js` | 477 | ~47 | PASS |
| Multi-Source | `multi-source-integration.test.js` | 702 | ~14 | PASS |
| Notifications | `notifications.test.js` | 451 | ~67 | PASS |
| Push Channel | `push-channel.test.js` | 374 | ~31 | PASS |
| Trust Feedback | `trust-feedback.test.js` | 325 | ~34 | PASS |
| E2E Notifications | `e2e-notifications.test.js` | 256 | ~10 | SKIP (bez env) |
| E2E Pipeline | `e2e-pipeline.test.js` | 241 | ~10 | SKIP (bez env) |
| E2E Workers | `e2e-workers.test.js` | 256 | ~10 | SKIP (bez env) |
| **Celkem** | | **5 201** | **~351** | |

---

## Kompletni Inventory — Workeri & Notifikace

```
src/agents/
├── runner.js                    1 339 radku  Exekucni engine
├── scheduler.js                   282 radku  Cron + interval planovac
├── repository.js                  662 radku  SQLite CRUD + seen items
├── conditions.js                  551 radku  7 typu podminek
├── triggers.js                    172 radku  Hranova detekce
├── multi-source.js                376 radku  Deduplikace, health tracking
├── schema.js                      528 radku  Whitelist validace
├── api.js                         857 radku  28 REST endpointu
├── builder.js                     255 radku  NL → definice (LLM)
├── llm-services.js                319 radku  Summarize, explain, categorize
├── worker-configs.js              265 radku  Sablony (weather, realty, news)
├── agents.html                  2 852 radku  Web UI
├── dashboard.html                 239 radku  Dashboard
├── README.md                      177 radku  Dokumentace
├── AGENT-DSL-SCHEMA.md            791 radku  DSL schema
├── sources/
│   ├── rss.js                     211 radku  RSS 2.0 + Atom 1.0
│   ├── inspector.js               395 radku  URL introspekce
│   └── schema.js                  207 radku  Field mapping
└── examples/
    ├── weather-monitor.json                  MONITOR — pocasi
    ├── realty-watcher.json                   HUNTER — nemovitosti
    ├── realty-multi-source.json              HUNTER — multi-source
    ├── news-rss-digest.json                  DIGEST — zpravy
    ├── rate-monitor.json                     TRACKER — dane sazby
    └── morning-briefing.json                 DIGEST — ranní prehled

src/notifications/
├── pipeline.js                    230 radku  Orchestrator
├── service.js                     144 radku  Router
├── policy.js                      302 radku  Policy engine
├── digest.js                      240 radku  Batching
├── trust.js                       551 radku  Trust feedback loop
├── feedback.js                    294 radku  Telegram keyboard, API
├── trust-api.js                   152 radku  REST metriky
├── db.js                          110 radku  DB schema
├── index.js                        64 radku  Factory
├── e2e-verify.js                  273 radku  E2E verifikace
├── templates/
│   └── default.js                  63 radku  Sablony
└── channels/
    ├── base.js                     38 radku  Abstraktni base
    ├── email.js                    92 radku  SMTP
    ├── telegram.js                 97 radku  Bot API
    ├── push.js                    105 radku  ntfy.sh (JSON body)
    └── ntfy.js                    201 radku  ntfy.sh (alternativa)
```

**Celkem agents src:** 9 478 radku
**Celkem notifications src:** 2 956 radku
**Celkem UI:** 3 091 radku
**Celkem docs:** 968 radku
**Celkem testy:** 5 201 radku
**Grand total workers + notifikace:** ~21 694 radku

---

## Co Chybi — Zbyvajici Prace pro Fazi B

| Polozka | Odhad | Priorita | Popis |
|---------|-------|----------|-------|
| B8 Realni workeri | 1d | P1 | E2E test s realnym API (pocasi, RSS) |
| Timezone podpora | 0.5d | P1 | Cron "0 7 * * *" = 7:00 CET, ne UTC |
| Scraper zdroj | 2-3d | P2 | HTML parsing (aktualne placeholder) |
| Database zdroj | 1d | P2 | Interni DB dotazy (aktualne vraci []) |
| Digest auto-flush | 0.5d | P2 | Scheduler automaticky vola flushDigest |
| B9 Agent wizard UI | 1-2d | P1 | Konverzacni wizard v chatu |

**Roadmapa v4 hodnoceni: 80% hotovo (B0-B6 done, chybi B8 + B9)**
