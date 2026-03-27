# C.3 Expertise System

**Verze:** v124 (2026-03-12)

Viz take: [ARCHITECTURE.md](ARCHITECTURE.md) | [skills-v1.md](skills-v1.md) | [WORKERS.md](WORKERS.md)

---

## Obsah

1. [Prehled](#prehled) — co to je, co to neni
2. [Architektura](#architektura) — flow od vstupu po odpoved
3. [Vestavene expertyzy (15)](#vestavene-expertyzy-15) — 5 kategorii
4. [ExpertiseAgent trida](#expertiseagent-trida) — vlastnosti, metody
5. [Auto-Select](#auto-select) — vocabulary-based, <1ms, bez LLM
6. [Merge Engine v2](#merge-engine-v2) — multi-expertise kompozice (max 3)
7. [5D Capability System](#5d-capability-system) — vektory, kompatibilita, runtime efekty
8. [Sila a presety (Strength)](#sila-a-presety) — kvantizovane urovne
9. [Dedicnost (Inheritance)](#dedicnost) — custom expertyzy rozsirujici built-in
10. [Enforcement Pipeline](#enforcement-pipeline) — forbidden phrases, retry, capability drift
11. [Specialist Runtime (D1)](#specialist-runtime-d1) — tool-augmented framework
12. [Knowledge Base (D2)](#knowledge-base-d2) — verzovany fact store
13. [Scenario Engine (D3)](#scenario-engine-d3) — multi-step guided workflows
14. [Self-Contained Specialists (v121+)](#self-contained-specialists-v121) — plugin architektura
15. [Tvorba custom expertyz](#tvorba-custom-expertyz) — create-expertise skill + wizard UI
16. [CRE Integrace](#cre-integrace) — GUARD 6, handler routing
17. [API Endpointy](#api-endpointy)
18. [Database Schema](#database-schema)
19. [Konfigurace](#konfigurace)
20. [Testy](#testy)
21. [Soubory](#soubory)

---

# Prehled

Expertise System poskytuje **domenove dialogove rezimy** ovlivnujici JAK LLM odpovida — styl, hloubka, slovnik, opatrnost — bez zmeny rozhodnuti CRE o tom CO se dela.

**Klicovy princip:** Expertyza ovlivnuje syntezi (ton, hloubka, slovnik, opatrnost), NIKOLIV intent/nastroje/rozhodnuti. CRE zustava autoritou.

**Co to dela:**
- 15 vestavenych expertyz v 5 kategoriich + neomezene custom expertyzy
- Multi-expertise merge (max 3 soucasne) s 5D kompatibilitou
- Auto-select na zaklade slovniku (bez LLM, <1ms)
- Enforcement pipeline: forbidden phrases, min delka, retry s temperature decay
- Specialist Runtime (D1): tool-augmented experti (napr. ucetni s danovymi kalkulackami)
- Knowledge Base (D2): verzovany fact store (domena/kategorie/klic/rok)
- Scenario Engine (D3): multi-step guided workflows (napr. danovy pruvodce)
- Dedicnost pro custom expertyzy rozsirujici built-in

**Co to NEDELA:**
- Nemeni CRE intent klasifikaci (SEARCH zustane SEARCH)
- Nenutí pouziti nastroju
- Nepotlacuje LOCAL/CREATIVE rozhodnuti
- Neni background agent

**Terminologie (D5 v91, v121+ self-contained refactor):**
- **Specialista** = persona/agent (ucetni, pravnik) — "kdo". Ma styl, nastroje, znalosti. Od v121 self-contained plugin v `specialists/`.
- **Expertyza** = lehky knowledge modul na tema (kontrolni hlaseni, DPH, hypoteky) — "co umi".
- **Capability** = schopnost (N:M routing, priority-based) — registrovano pres `CapabilityRegistry`.
- **Tool** = deterministicky nastroj specialisty (kalkulacka, checker).
- Vztah: Specialista **vlastni kolekci** expertyz, capabilities a toolu. Muze jich mit N.
- **D5 flow:** Uzivatel vybere specialistu → `specialistHandler` → expertise discovery →
  scoped vocabulary matching (`expertise-discovery.js`) → single/multi/gap → fallback.
- **Plugin model (v121+):** Zadne `import ../../src/` — vse pres `ctx.registries` API.
- Viz `docs/SPECIALISTS.md` pro detailni popis.

---

# Architektura

```
Uzivatelsky vstup
  |
  v
Auto-Select (auto-select.js, <1ms, bez LLM)
  |  Tier 1: vocabulary overlap (modules.vocabulary[])
  |  Tier 2: boost patterns (built-in only)
  |  Anti-flip-flop: hysteresis pro stabilitu
  |  Manualni vyber ma vzdy prioritu
  |
  v
Expertise Handler (expertise.js)
  |
  +-- Single expertise aktivni
  |     |
  |     +-- CRE Decision (intent se nemeni)
  |     +-- systemPrompt + getSynthesisHints() → LLM
  |     +-- ExpertiseEnforcer (forbidden phrases, min delka)
  |     +-- enforceCapabilities() (5D drift detection)
  |     +-- logLlmExecution() (audit trail)
  |
  +-- Multiple expertises aktivni (max 3)
        |
        +-- STEP 1: checkCompatibility() — 5D pairwise conflict detection
        +-- STEP 2: resolveInheritance() — parent chain (max depth 4)
        +-- STEP 3: mergeExpertisePrompt() — 15-krokovy pure function
        |     validate → sort → inherit → merge modules → specialist
        |     → tone → temperature → trim tokens → build prompt → enforce
        +-- STEP 4: LLM generovani (merged prompt + weighted temperature)
        +-- STEP 5: ExpertiseEnforcer — forbidden phrases, retry s decay
        +-- STEP 6: enforceCapabilities() — 5D drift detection
        +-- STEP 7: logLlmExecution() — model, latency, prompt hash
```

---

# Vestavene expertyzy (15)

## A) Tvurci & Narativni

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) | creativeLock |
|-----------|-----|--------|---------|--------------------------|-------------|
| Spisovatel | `writer` | creative_writing | 0.8 | 40,90,10,70,90 | ano |
| DnD Master | `dnd_master` | tabletop_rpg | 0.85 | 40,95,5,80,85 | ano |
| Textar | `songwriter` | music_lyrics | 0.9 | 35,85,10,75,60 | ano |

## B) Analyticko-rozhodovaci

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| Analytik | `analyst` | analysis | 0.3 | 90,20,80,20,60 |
| Prekupnik | `trader` | trading | 0.4 | 70,20,60,50,40 |
| Ucetni | `accountant` | finance | 0.2 | 75,5,95,5,50 |

`accountant` je **specialist** — ma registrovane nastroje (`tax_calculator`, `vat_calculator`, `deadline_checker`, `salary_calculator`) a `strictToolEnforcement: true`.

## C) Normativni & Odpovednostni

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) | Disclaimer |
|-----------|-----|--------|---------|--------------------------|-----------|
| Pravnik | `lawyer` | legal | 0.3 | 80,10,90,5,70 | Konzultujte advokata |
| Lekar | `doctor` | medical_education | 0.3 | 70,10,85,5,60 | Nikoli lekarska rada |
| Psycholog | `psychologist` | psychology | 0.6 | 60,50,30,40,70 | Linka bezpeci 116 111 |

Tyto maji `CAUTION_HIGH` a povinne disclaimery.

## D) Technicko-odborni

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| AI Expert | `ai_expert` | artificial_intelligence | 0.4 | 85,35,65,30,55 |
| Vyvojar | `developer` | software_development | 0.3 | 80,40,70,30,30 |
| Technik | `technician` | technical_support | 0.3 | 65,15,80,15,50 |

## E) Domenovi znalci

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| Autickar | `car_enthusiast` | automobiles | 0.5 | 55,20,50,40,50 |
| Motorkar | `biker` | motorcycles | 0.5 | 50,20,45,35,50 |
| Politicky analytik | `political_analyst` | politics | 0.4 | 85,25,60,25,65 |

## F) Vlastni experti

Vytvari se pres `create-expertise` skill nebo IDE wizard. Viz [Tvorba custom expertyz](#tvorba-custom-expertyz).

---

# ExpertiseAgent trida

Kazda expertyza (built-in i custom) je instance `ExpertiseAgent`:

```javascript
{
  // Identita
  id: string,                    // snake_case, unikatni
  name: string,                  // Zobrazovany nazev (cesky)
  icon: string,                  // Emoji
  domain: string,                // Domena (snake_case)
  description: string,           // Kratky popis

  // Chovani
  primaryProblemTypes: string[],  // 'procedural', 'price_range', 'specification', 'consensus', 'availability'
  allowedRepresentations: string[], // 'narrative', 'structured', 'report', 'tabular'
  planningDepth: 'none' | 'light' | 'deep',
  reviewPolicy: 'none' | 'self' | 'iterative',
  dataUsagePolicy: 'forbidden' | 'evidence' | 'controlled',
  outputBias: 'creative' | 'analytical' | 'conservative',
  creativeLock: boolean,         // true → GUARD 6 overriduje SEARCH→CREATIVE
  temperature: number,           // 0.0-1.0

  // Sila vlivu (v45.0)
  strength: 0|25|50|75|100,      // OFF/LIGHT/MEDIUM/STRONG/FULL
  weights: { style, depth, vocabulary, caution },

  // Merge Engine (v63.0)
  capabilities: { reasoning, creativity, determinism, riskTolerance, verbosity }, // 0-100
  modules: {
    domain_rules: string[],      // Pravidla domeny
    emphasis: string[],          // Duraz
    constraints: string[],       // Co NEDELAT (nikdy se netrimi)
    vocabulary: string[],        // Domenovy slovnik (auto-select)
    antipatterns: string[],      // Typicke chyby (nikdy se netrimi)
    disclaimer: string | null,   // Povinny disclaimer (nikdy se netrimi)
  },
  tone: string,                  // 'professional', 'creative', 'friendly', 'concise'

  // Dedicnost
  parent: string | null,         // ID rodicovske expertyzy
  inheritance: { [section]: 'extend' | 'replace' },

  // Enforcement (v44.10)
  styleRules: {
    tone: string,
    minResponseLength: number,
    forbiddenPhrases: (RegExp | string)[],
    requiredElements: RegExp[],
    toolEnforcement: boolean,        // Expert vyzaduje pouziti nastroju
    strictToolEnforcement: boolean,  // Hard fail po vycerpani retries
  },

  // LLM
  systemPrompt: string,          // Persona prompt (max 8000 znaku)
  preferredModels: string[],
  isCustom: boolean,
}
```

**Klicove metody:**
- `getSynthesisHints(overrideStrength?)` — Hinty pro LLM syntezi (styl, hloubka, slovnik, opatrnost)
- `getLLMSettings()` — `{ model, temperature, top_p }`
- `toJSON()` — Serializace pro API/DB

---

# Auto-Select

Deterministicky vocabulary-based vyber expertyzy. Bezi pred CRE, <1ms na volani. Soubor: `auto-select.js`.

## Algoritmus

1. **Tier 1: Vocabulary overlap** — Match vstupu proti `modules.vocabulary[]` s ceskou stemizaci (inflexe: `kapitola`→`kapitolu`, `helma`→`helmu`).
   - Single-word match: +1 bod
   - Multi-word match: +2 body
   - Sdilene termy (ve 2+ expertyzach): ×0.5 penalizace

2. **Tier 2: Boost patterns** — Pouze built-in. High-confidence indikatory domeny.
   - Priklad: `/\b(?:NPC|D&?D|DnD|dungeon)\b/i` → `dnd_master` (+3 body)
   - Custom expertyzy pouzivaji jen Tier 1

3. **Anti-flip-flop** — Hystereze: predchozi auto-select preferovan pokud >= 80% skore viteze.

4. **Threshold** — Minimum 2.0 pro aktivaci. Remiza → null (ambiguous).

**Pravidla:**
- Manualni vyber ma VZDY prioritu
- Nastavuje jen kontext, nikdy neoverriduje CRE intent
- `recomputeSharedTerms()` po pridani custom expertyz

---

# Merge Engine v2

Pure function `mergeExpertisePrompt()` — slucuje N expertyz (max 3) do jednoho strukturovaneho promptu.

## Kontrakt

- **Pure function**: zadne side effects, zadne DB, zadne I/O
- **Deterministicky**: stejny vstup → stejny vystup
- **Komutativni**: merge(A,B) == merge(B,A) kdyz se vaha lisi
- **Frozen output**: `Object.freeze(result)`
- **Input se nemutuje**

## 15-krokovy algoritmus

```
mergeExpertisePrompt()
  |
  +-- 1. Validate count (max 3)
  +-- 2. checkCompatibility() — 5D vektory, HARD_BLOCK/SOFT_BLOCK/WARNING/OK
  +-- 3. Sort by weight desc (position jako tie-breaker)
  +-- 4. resolveInheritance() — parent chain (max depth 4)
  +-- 5. mergeModulesTagged() — tagged items {text, expertiseId, weight}, dedup
  +-- 6. applySpecialistOverride() — prida, nikdy neodstrani
  +-- 7. deriveTone() — nejvyssi vaha vyhrava
  +-- 8. deriveTemperature() — dominance (>0.6 ratio) nebo weighted avg
  +-- 9. User context budget (max 300 tokenu)
  +-- 10. trimToTokenBudget() — budget 1800 tokenu, vocabulary>emphasis>domain_rules
  +-- 11. buildStructuredPrompt() — sekce: Pravidla, Duraz, Omezeni, Slovnik, Antipatterns
  +-- 12. Append user context
  +-- 13. mergeEnforcement() — forbiddenPhrases=UNION, minResponseLength=MAX
  +-- 13.5. computeCapabilityModifiers() + applyCapabilityModifiers()
  +-- 14. buildAuditLog()
  +-- 15. Object.freeze(result)
  |
  v
Frozen { prompt, metadata, enforcement, audit }
```

## Precedence Rules

| Konflikt | Resoluce |
|----------|----------|
| Ton | Nejvyssi vaha vyhrava |
| Teplota | Dominance (>0.6) vyhrava; jinak weighted avg |
| Moduly | Per-section: 'extend' = dedup merge, 'replace' = child only |
| Disclaimery | UNION (vsechny unikatni, nikdy se netrimi) |
| Capabilities | Pro compatibility check, ne pro merge |
| Constraints | UNION (nikdy se netrimi) |
| Antipatterns | UNION (nikdy se netrimi) |
| Forbidden phrases | UNION vsech (regex + string) |
| Min delka odpovedi | MAX napruc expertyzami |
| Remiza vah | `position` field = tie-breaker |

## Token Budget

| Limit | Hodnota |
|-------|---------|
| Max total tokens | 2000 |
| Effective budget | 1800 (10% rezerva) |
| Max user context tokens | 300 |

## Trim priorita

| Priorita | Sekce | Trimmable |
|----------|-------|-----------|
| 1 | disclaimers | NIKDY |
| 2 | constraints | NIKDY |
| 3 | antipatterns | NIKDY |
| 4 | domain_rules | Ano |
| 5 | emphasis | Ano |
| 6 | vocabulary | Ano |

---

# 5D Capability System

Kazda expertyza definuje 5-dimenzionalni vektor (0-100):

| Dimenze | LOW (0-30) | MEDIUM (31-70) | HIGH (71-100) | Runtime efekt |
|---------|-----------|-----------------|---------------|---------------|
| reasoning | Jednoduche odpovedi | Vyvazena analyza | Hluboka analyza | HIGH: instrukce pro hlubsi rozbor |
| creativity | Fakticke, bez prikras | Trochu tvurci | Plne generativni | HIGH: temp bias +0.1, originalita |
| determinism | Variabilni | Prevazne konzistentni | Vysoce reprodukovatelne | HIGH: temp bias -0.2, presnost |
| riskTolerance | Hodne vyhrady/disclaimery | Vyvazene | Primo, malo disclaimeru | LOW: minResponseLength +50 |
| verbosity | Strucne | Stredni delka | Detailni, komplexni | HIGH: instrukce pro detaily |

## Compatibility Severity

| Severity | Pravidlo | Vysledek |
|----------|---------|---------|
| HARD_BLOCK | maxGap >80 | Nelze zkombinovat, CompatibilityBlockError |
| SOFT_BLOCK | maxGap >60 | Vyzaduje potvrzeni |
| WARNING | maxGap >50 | Varovani |
| OK | else | Bez problemu |

Priklad: `writer` (creativity=90) + `accountant` (determinism=95) → gap=85 → **HARD_BLOCK**

## Capability Normalization

Soft warnings (neblokuji):
- **Sum > 350:** Prilis specializovana
- **Kontradikce:** creativity > 70 && determinism > 70

---

# Sila a presety

Kvantizovana sila — 5 urovni, mapovanych na presety:

| Sila | Uroven | Preset | Style Multiplier | Depth |
|------|--------|--------|------------------|-------|
| 0 | OFF | — | 0% | — |
| 1-30 | LIGHT | light | 30% | shallow |
| 31-60 | MEDIUM | balanced | 60% | expert default |
| 61-75 | STRONG | deep | 75% | deep (forced) |
| 76-100 | FULL | deep | 100% | deep (forced) |

Presety ovlivnuji `_getSystemAddition()` — pridavne prompt instrukce dle urovne.

---

# Dedicnost

Custom expertyzy mohou rozsirovat built-in pres `parent` field.

## Pravidla resoluce

- **Max hloubka**: 4 urovne
- **Moduly**: per-section `extend` (dedup concat, default) nebo `replace` (jen child)
- **Capabilities**: child explicitni hodnota overriduje; child undefined → zdedi rodice
- **Enforcement (styleRules)**: UNION — child NEMUZE oslabit rodice (pokud `overrideParentEnforcement !== true`)
  - `forbiddenPhrases`: deduplikovana unie
  - `minResponseLength`: MAX(rodic, child)
  - Boolean flagy (`toolEnforcement` atd.): OR (rodic true → zustane true)

---

# Enforcement Pipeline

## 1. ExpertiseEnforcer

Post-synthesis validace:

```
LLM Response
  |
  +-- checkForbiddenPhrases(response, expert.styleRules.forbiddenPhrases)
  |     Default: "nevim", "to zalezi", "jako jazykovy model", "nemohu pomoci"
  |     Ucetni: "odhaduji", "priblizne", "muze byt kolem", "tipuji"
  |     Analytik: "mozna", "asi", "nevim presne"
  |
  +-- checkResponseLength(response, expert.styleRules.minResponseLength)
  |
  +-- PORUSENI?
  |     +-- ANO → Retry s:
  |     |     - Kontext poruseni v promptu
  |     |     - Temperature decay: -0.1/pokus
  |     |     - Top_p decay: -0.05/pokus
  |     |     - Max 2 retries
  |     |
  |     +-- Stale poruseni po retries?
  |           +-- strictToolEnforcement: true → hard fail
  |           +-- Normal mode → ponechat s varovanim
  |
  +-- enforceCapabilities() — 5D drift detection (deterministicke, bez LLM)
        evaluateDeterminism, evaluateRiskTolerance, evaluateVerbosity, evaluateStructure
        computeCapabilityDrift() — per-dimension delta, DRIFT_VIOLATION_THRESHOLD=40
```

## 2. Tool Enforcement (specialiste)

Pouze kdyz `toolEnforcement === true`:
- `extractNumericClaims(response)`
- `verifyNumericClaims()` — fuzzy tolerance ±1% pro cisla > 100
- Nepodlozena cisla → varovani

## 3. ExecutionTrace (v63.3)

Jeden `executionTraceId` (UUID) per user turn. Propojuje:

```
llm_execution_log → ExpertiseEnforcer.retryAudit → capability_drift_log → merge_audit_log
```

- Prompt SHA-256 hash pro determinism analyzu (nikdy se neuklada samotny prompt)
- `token_source: 'provider' | 'estimated'`
- `performance.now()` pro sub-ms latency

---

# Specialist Runtime (D1)

Tool-augmented expert framework. Zobecnuje ucetni pattern (detector → tool → enforce → persona wrap) do znovupouzitelneho frameworku. Soubor: `specialist-runtime.js`.

## Architektura

```
ToolRegistry → IntentDetector → ToolExecutor → SpecialistRuntime
```

1. **ToolRegistry** — Mapuje specialistu → nastroje (lazy-loaded moduly)
2. **IntentDetector** — Pattern-based routing: vstup → tool match
3. **ToolExecutor** — Spousti deterministicky nastroj, vraci structured result
4. **SpecialistRuntime** — Orchestruje detect → execute → wrap pipeline

## Pipeline

```
Uzivatel: "Kolik zaplatim z 850k jako OSVC za rok 2024?"
    |
    v
expertiseHandler() — 'accountant' aktivni
    |
    v
specialistRuntime.tryToolExecution('accountant', input)
    |
    +-- IntentDetector: pattern matching → match: accountant.tax_calculator
    +-- extractParams(input) → { gross_income: 850000, entity_type: 'osvc', year: 2024 }
    +-- ToolExecutor: lazy-load + calculateTax(params) → structured result
    +-- Persona wrap: vysledek obalen ucetni personou
    +-- ExpertiseEnforcer: overeni odpovedi
```

## Registrovani specialiste

Aktualne: `accountant-cz` (4 nastroje), `translator` (jazykove nastroje), `dummy-logger` (testovaci).

Od v121 jsou specialiste self-contained pluginy v `specialists/` — viz [Self-Contained Specialists](#self-contained-specialists-v121).

## Registrace noveho specialisty (v121+ plugin model)

```javascript
// specialists/my-specialist/index.js
export async function register(ctx) {
  const { runtime, manifest } = ctx;
  runtime.registerSpecialist({
    id: manifest.id,
    domain: manifest.domain,
    tools: buildToolDefinitions(),
  });
  if (ctx.registries?.expertise) ctx.registries.expertise.addCustom(MY_EXPERTISE);
  if (ctx.registries?.capability?.register) ctx.registries.capability.register(CAPS);
  if (ctx.registries?.toolExecutor?.register) ctx.registries.toolExecutor.register(TOOLS);
}

export async function unregister(ctx) { /* cleanup */ }
```

> **Legacy pattern** (pre-v121): `toolRegistry.registerSpecialist()` primo ze `src/` — stale funguje pro vestavenou registraci, ale nove specialisty piste jako self-contained pluginy.

---

# Knowledge Base (D2)

Verzovany fact store nahrazujici hardcoded konstanty. DB-backed s provenance metadaty. Soubor: `knowledge-base.js`.

## Struktura faktu

```javascript
kb.getFact('tax', 'income_tax', 'base_rate', 2025)
// → { value: '15', value_type: 'percentage', source: 'Zakon 586/1992 Sb.', confidence: 0.95 }
```

**Scoping:** `domain` / `category` / `key` / `year` — rok muze byt null pro casove nezavisle fakty.

**Provenance:** source, source_url, confidence (0-1), is_provisional, verified_at, verified_by, notes.

**Integrace:** ToolExecutor injektuje KnowledgeBase handle do tool contextu — nastroje dotazuji fakty dynamicky misto importu statickych konstant.

---

# Scenario Engine (D3)

Multi-step guided workflows pro specialisty. Interaktivni sber dat → spusteni nastroje → prezentace. Soubor: `scenario-engine.js`.

## Faze

```
INTRO → COLLECTING → COMPUTING → PRESENTING → RECOMMENDING → ADJUSTING → COMPLETED
                                                                          +→ CANCELLED
```

## Definice scenare

```javascript
{
  id: 'income_tax_calc',
  specialistId: 'accountant',
  name: 'Vypocet dane z prijmu',
  triggers: [/vypocitej.*dan/i, /dan z prijmu/i],
  steps: [
    { id: 'income', question: 'Jaky je tvuj rocni prijem?', extract: (input) => parseNumber(input) },
    { id: 'type', question: 'OSVC nebo zamestnanec?', extract: (input) => ... },
  ],
  compute: async (collected) => taxCalculator.calculate(collected),
  present: (results, collected) => formatTaxReport(results),
}
```

## Integrace

- `conversation.js` kontroluje `scenarioRunner.isActive(sessionId)` — aktivni → routuje na scenar
- Neaktivni → expert handler kontroluje `scenarioRegistry.detectTrigger()` pro start
- Kazda session muze mit jeden aktivni scenar

---

# Self-Contained Specialists (v121+)

Od v121 jsou specialiste **self-contained pluginy** v adresari `specialists/`. Zadne importy z `src/` — veskera integrace pres `ctx.registries` API.

## Architektura

```
specialists/
  accountant-cz/        ← 7 modulu (tools, expertise, knowledge, scenarios)
    specialist.json      ← manifest v2
    index.js             ← register(ctx) / unregister(ctx)
    ledger/              ← 5 tool modulu + knowledge data
  translator/            ← jazykove nastroje
  dummy-logger/          ← testovaci plugin
```

## ctx.registries API

Plugin dostane pri registraci `ctx` objekt s nasledujicimi registry:

| Registry | Ucel | Metoda |
|----------|------|--------|
| `ctx.registries.expertise` | Registrace custom expertyz | `addCustom(config)` / `removeCustom(id)` |
| `ctx.registries.autoSelect` | Boost patterns pro auto-select | `registerBoostPatterns(id, patterns)` |
| `ctx.registries.scenario` | Multi-step scenare | `register(scenario)` / `unregister(id)` |
| `ctx.registries.toolExecutor` | Deterministicke nastroje | `register(tools)` / `unregister(ids)` |
| `ctx.registries.capability` | N:M capability routing | `register(capabilities)` |
| `ctx.registries.cre` | CRE tool-type patterns | `registerToolTypes(types)` |

## Capability Registry

N:M priority-based routing — vice specialistu muze obsluhovat stejnou capability:

```javascript
capabilityRegistry.register([
  { id: 'finance.tax', provider: 'accountant-cz', priority: 100 },
  { id: 'finance.vat', provider: 'accountant-cz', priority: 100 },
]);
// Dotaz: capabilityRegistry.resolve('finance.tax') → nejlepsi provider
```

## Manifest v2

```json
{
  "id": "accountant-cz",
  "manifestVersion": 2,
  "version": "1.0.0",
  "name": "Český účetní",
  "domain": "finance",
  "capabilities": ["finance.tax", "finance.vat", "finance.salary"],
  "defaultExpertise": "accountant",
  "entryPoint": "index.js"
}
```

## Plugin contract

- **Zadne `import ../../src/`** — vse pres `ctx` (warn-only v121, budouci hard reject)
- **Deterministicky boot**: Kahnuv algoritmus + abecedni secondary sort
- **Fail-safe unregister**: Kazdy cleanup krok v try/catch, loader provadi defenzivni cleanup
- **create-specialist skill** (v122): 10-krokovy guided workflow pro tvorbu novych specialistu
- **Marketplace (v124)**: Instalace vzdalenych balicku pres `POST /api/marketplace/install/:type/:id`

Viz `docs/SPECIALISTS.md` pro kompletni dokumentaci.

---

# Tvorba custom expertyz

## create-expertise skill

Skill (v3, privileged) s 7-krokovym guided workflow:

```
ask(clarify) → llm(draft JSON) → review(checkpoint) → llm(refine) → validate(schema) → template(format) → write(save)
```

**Parametry:** `topic` (povinny) — tema nebo domena.

**Vystup:** JSON config ulozeny do `expertises/custom-{topic}.json`.

## Wizard UI v IDE

```
center-views: "+" button → wizard mode
  |
  +-- Zakladni udaje (name, domain, icon, desc, systemPrompt, tone, temperature)
  +-- Capabilities (5D) — 5 slideru s LOW/MEDIUM/HIGH gradient hinty
  +-- Modules — 6 section editoru (add/remove) + inheritance badges
  +-- Preview & Test — live kompatibilita, token count, prompt preview, LLM test
  |
  v
Save → POST /api/expertises → expertyza v registru
```

**Anti-drift:** Wizard nacte konstanty z `GET /api/expertise-schema` — zadne hardcoded hodnoty ve FE.

## Validacni pravidla

| Pole | Pravidla |
|------|---------|
| `name` | Povinne, 2-64 znaku |
| `description` | Max 500 znaku |
| `domain` | Max 64 znaku, pattern: `[a-z0-9_]+` |
| `systemPrompt` | Max 8000 znaku, forbidden: injection patterns |
| `temperature` | 0.0-1.0 |
| `forbiddenPhrases` | Max 50, max 200 znaku kazdy |
| `modules` | Validni sekce, per-section limity |
| `capabilities` | 5D dimenze, 0-100 |
| `inheritance` | Validni mody: 'extend' / 'replace' |

## Persistence

- Custom expertyzy v `custom_expertises` tabulce (id, config JSON)
- Nactene pri startu, hot-reload po skill create
- `ExpertiseRegistry`: `expertises` (built-in) + `customExpertises` (user)
- Custom lookup ma prioritu: `customExpertises.get(id) || expertises.get(id)`

---

# CRE Integrace

## GUARD 6 — Creative Override (v87)

Kdyz expertyza s `creativeLock: true` nebo `outputBias === 'creative'` je aktivni:
- SEARCH/AMBIGUOUS intent → overriden na CREATIVE
- **Bypass patterns**: explicitni search requesty (vyhledej, googl, ve skutecnosti, v realnem svete, ve wikipedii, faktick, historicka fakta)
- Guard je v `decide()`, NE v `_llmClassifyIntent()` — regex fallback by LLM guardy preskocil

## Handler Routing

| Decision | Akce |
|----------|------|
| ANSWER | `generateExpertiseResponse()` — expert persona LLM call |
| CREATIVE | `generateExpertiseResponse()` |
| CODE | `generateExpertiseResponse()` (code-aware prompt) |
| SEARCH | Web search + expert-domain synthesis |
| TOOL_CALL | `handleToolCallDecision()` |
| ASK_USER | `handleAskUserDecision()` |
| PLAN | `generateExpertiseResponse()` (build planning) |
| REFUSE | `handleRefuseDecision()` |

---

# API Endpointy

| Metoda | Path | Ucel |
|--------|------|------|
| GET | `/api/expertises` | Seznam vsech expertyz |
| GET | `/api/expertises/:id` | Detail expertyzy |
| POST | `/api/expertises` | Vytvoreni custom |
| PUT | `/api/expertises/:id` | Uprava custom |
| DELETE | `/api/expertises/:id` | Smazani (pouze custom) |
| GET | `/api/merge-preview?expertises=a,b` | Preview merge result |
| POST | `/api/merge-preview` | Preview s inline config (wizard) |
| GET | `/api/expertise-schema` | Schema pro wizard (anti-drift) |
| POST | `/api/expertise-wizard/test-prompt` | LLM test s inline config |

---

# Database Schema

```sql
-- Definice expertyz (custom)
CREATE TABLE expertises (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
    domain TEXT, system_prompt TEXT, temperature REAL,
    config TEXT, is_builtin BOOLEAN DEFAULT 0,
    created_at TIMESTAMP, updated_at TIMESTAMP
);

-- Custom expertyzy (zjednodusene uloziste)
CREATE TABLE custom_expertises (
    id TEXT PRIMARY KEY, config TEXT
);

-- Vazba expertise-konverzace (single, legacy)
CREATE TABLE expertise_bindings (
    conversation_id TEXT PRIMARY KEY, expertise_id TEXT NOT NULL,
    locked BOOLEAN DEFAULT 0, strength INTEGER DEFAULT 50, locked_at TIMESTAMP
);

-- Multi-expertise vazby (v63.0, max 3)
CREATE TABLE conversation_expertises (
    conversation_id TEXT NOT NULL, expertise_id TEXT NOT NULL,
    weight REAL DEFAULT 0.5 CHECK(weight >= 0.1 AND weight <= 1.0),
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(conversation_id, expertise_id)
);

-- Pamet expertyzy (cross-session)
CREATE TABLE expertise_memory (
    expertise_id TEXT NOT NULL, key TEXT NOT NULL,
    value TEXT, previous_value TEXT, updated_at TIMESTAMP,
    PRIMARY KEY (expertise_id, key)
);

-- Knowledge Base (D2)
CREATE TABLE knowledge_facts (
    domain TEXT, specialist_id TEXT, category TEXT, key TEXT,
    value TEXT, value_type TEXT, valid_from TEXT, valid_to TEXT,
    year INTEGER, source TEXT, source_url TEXT, confidence REAL,
    is_provisional BOOLEAN, verified_at TEXT, verified_by TEXT, notes TEXT,
    UNIQUE(domain, category, key, year)
);

-- Audit tabulky
CREATE TABLE merge_audit_log (conversation_id TEXT, execution_trace_id TEXT, timestamp TEXT, data TEXT);
CREATE TABLE capability_drift_log (conversation_id TEXT, execution_trace_id TEXT, expertise_id TEXT, ...);
CREATE TABLE llm_execution_log (model TEXT, temperature REAL, prompt_hash TEXT, ...);
```

---

# Konfigurace

| Nastaveni | Default | Popis |
|-----------|---------|-------|
| `C3_ENABLE_EXPERTISES` env | `true` | Zapnout/vypnout system |
| `c3.features.expertises` IDE | `true` | IDE Settings toggle |
| Max aktivnich expertyz | 3 | Hard limit |
| Max inheritance depth | 4 | Prevence nekonecne rekurze |
| Max token budget | 2000 | Limit merged promptu |
| Enforcement max retries | 2 | Temperature decay retries |
| Temperature decay | 0.1/pokus | Snizeni nahodnosti pri retry |
| Capability drift threshold | 40 | Nad = violation |

---

# Testy

| Soubor | Pocet | Pokryva |
|--------|-------|---------|
| `merge-engine.test.js` | 40 | Merge, pure function, temperature, tone, trim, inheritance |
| `merge-compatibility.test.js` | 16 | 5D kompatibilita, edge cases |
| `merge-enforcement-integration.test.js` | 15 | Merge→enforcement pipeline |
| `capability-enforcer.test.js` | 38 | 5D evaluators, drift, strict, retry, trace |
| `execution-trace-stress.test.js` | 20 | 3-expertise merge + full trace |
| `expertise-wizard.test.js` | 38 | Validace modules, capabilities, inheritance |
| `expertise-system.test.js` | 40 | CRUD, validace, vazby, enforcement |
| `expertise-integration.test.js` | 10 | Expertise + DB + handler pipeline |
| `expertise-routing-correctness.test.js` | 43 | GUARD 6 creative override |
| `expertise-comparison-e2e.test.js` | 78 turns | E2E: expertise vs non-expertise |
| `specialist-system.test.js` | 115 | v121: self-contained, ctx.registries, capability registry, boot order |
| `specialist-create.test.js` | 48 | v122: create-specialist skill, manifest v2 |
| `marketplace.test.js` | 44 | v124: catalog, install, deps, security |
| **Celkem** | **~545** | |

---

# Soubory

| Soubor | Ucel |
|--------|------|
| `src/expertises/expertise-layer.js` | 15 built-in, ExpertiseAgent, ExpertiseRegistry, resolveInheritance() |
| `src/expertises/expertise-store.js` | Persistence, validace (60+ pravidel), lifecycle states |
| `src/expertises/expertise-enforcement.js` | Post-synthesis forbidden phrase check, retry s decay |
| `src/expertises/auto-select.js` | Vocabulary-based auto-select (<1ms, bez LLM) |
| `src/expertises/merge-engine.js` | `mergeExpertisePrompt()` — 15-krokovy pure function |
| `src/expertises/merge-types.js` | MERGE_LIMITS, MODULE_SECTIONS, CompatibilityBlockError |
| `src/expertises/merge-compatibility.js` | 5D pairwise kompatibilita |
| `src/expertises/capability-enforcer.js` | Post-response 5D drift detection |
| `src/expertises/capability-mapping.js` | 5D → prompt/temperature modifikatory |
| `src/expertises/specialist-runtime.js` | D1: Tool-augmented framework |
| `src/expertises/knowledge-base.js` | D2: Verzovany fact store |
| `src/expertises/scenario-engine.js` | D3: Multi-step guided workflows |
| `src/specialists/specialist-loader.js` | v121: Plugin loader, Kahnuv boot, ctx.registries |
| `src/specialists/capability-registry.js` | v121: N:M priority-based capability routing |
| `src/chat/handlers/expertise.js` | Handler: CRE routing, merge delegace, enforcement |
| `src/routes/expertises.js` | REST API: CRUD, merge-preview, schema |
| `src/marketplace/marketplace.js` | v124: Remote catalog, install, deps, security |
| `skills/create-expertise.json` | Skill: 7-step guided tvorba expertyz |
| `skills/create-specialist.json` | v122: 10-step tvorba novych specialistu |
| `specialists/accountant-cz/` | Self-contained ucetni (7 modulu, 4 nastroje) |
| `specialists/translator/` | Self-contained prekladac |
| `specialists/dummy-logger/` | Testovaci plugin |
