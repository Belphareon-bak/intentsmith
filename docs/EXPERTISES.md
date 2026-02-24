# C.3 Expertise System

**Verze:** v78.0.0 (2026-02-24)

Viz take: [SPECIALISTS.md](SPECIALISTS.md) | [WORKERS.md](WORKERS.md) | [README.md](README.md)

---

## Obsah

1. [Expertise Layer](#expertise-layer) — 15 vestavenych expertyz, routing, sila, presety
2. [Merge Engine v2](#merge-engine-v2) — multi-expertise kompozice (max 3)
3. [5D Capability System](#5d-capability-system) — vektory, kompatibilita, runtime efekty
4. [Enforcement Pipeline](#enforcement-pipeline) — forbidden phrases, retry, tool enforcement
5. [Expertise Wizard UI](#expertise-wizard-ui) — IDE formular pro tvorbu expertyz
6. [API Endpointy](#api-endpointy)
7. [Database Schema](#database-schema)
8. [Testy](#testy)

---

# Expertise Layer

## Co to je

Expertise Layer je jadro celeho specialistickeho systemu. Definuje **15 vestavenych expertyz** organizovanych do 5 kategorii, spravuje jejich registraci, routing (ktera expertyza se ma pouzit), silu vlivu na odpovedi a propojeni s konverzacemi.

**Klicovy princip:** Expertyza ovlivnuje STYL odpovedi (ton, hloubka, slovnik, opatrnost), NIKOLIV rozhodnuti CRE. CRE zustava autoritou pro intent klasifikaci — expertyza je "persona", ne "mozek".

## Architektura

```
Uzivatelsky vstup
    |
    v
CRE.classifyIntent()  --- rozhodnuti o intentu (ANSWER, SEARCH, CODE, ...)
    |
    v
ConversationHandler.route()
    |
    +--  Expertyza je aktivni?
    |       |
    |       +-- ANO --> expertiseHandler(input, context)
    |       |               |
    |       |               +-- CASE 0: activeExpertises > 1?
    |       |               |       +-- mergeExpertisePrompt() -- 15-krokovy algoritmus
    |       |               |       +-- LLM s merged prompt + temperature
    |       |               |       +-- ExpertiseEnforcer (synteticky config)
    |       |               |       +-- Disclaimery z obou expertyz
    |       |               |
    |       |               +-- CASE 1: single expertise
    |       |               |       +-- routeToExpertise() -- pattern matching
    |       |               |       +-- buildExpertiseSystemPrompt() -- pamet + styl
    |       |               |       +-- LLM generovani s expertise.temperature
    |       |               |       +-- ExpertiseEnforcer validace
    |       |               |       +-- TaggedResponse s expertise metadaty
    |       |               |
    |       |               +-- CASE 2: no expertise -- ASK_USER
    |       |
    |       +-- NE --> normalni handler (decisions.js)
    |
    v
Synthesis s expertiseHints (styl, hloubka, slovnik, opatrnost)
```

## Vestavene expertyzy (15)

### A) Tvurci & Narativni

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| Spisovatel | `writer` | creative_writing | 0.8 | 40,90,10,70,90 |
| DnD Master | `dnd_master` | tabletop_rpg | 0.85 | 40,95,5,80,85 |
| Textar | `songwriter` | music_lyrics | 0.8 | 35,85,10,75,60 |

### B) Analyticko-rozhodovaci

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| Analytik | `analyst` | analysis | 0.4 | 90,20,80,20,60 |
| Prekupnik | `trader` | trading | 0.4 | 70,20,60,50,40 |
| Ucetni | `accountant` | finance | 0.2 | 75,5,95,5,50 |

### C) Normativni & Odpovednostni

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) | Disclaimer |
|-----------|-----|--------|---------|--------------------------|-----------|
| Pravnik | `lawyer` | legal | 0.3 | 80,10,90,5,70 | Konzultujte advokata |
| Lekar | `doctor` | medical_education | 0.3 | 70,10,85,5,60 | Edukacni info, nikoli lekarska rada |
| Psycholog | `psychologist` | psychology | 0.5 | 60,50,30,40,70 | Linka bezpeci 116 111 |

### D) Technicko-odborni

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| AI Expertyza | `ai_expert` | artificial_intelligence | 0.4 | 85,35,65,30,55 |
| Vyvojar | `developer` | software_development | 0.3 | 80,40,70,30,30 |
| Technik | `technician` | technical_support | 0.3 | 65,15,80,15,50 |

### E) Domenovi znalci

| Expertyza | ID | Domena | Teplota | Capabilities (R,C,D,Ri,V) |
|-----------|-----|--------|---------|--------------------------|
| Autickar | `car_enthusiast` | automobiles | 0.5 | 55,20,50,40,50 |
| Motorkar | `biker` | motorcycles | 0.5 | 50,20,45,35,50 |
| Politolog | `political_analyst` | politics | 0.3 | 85,25,60,25,65 |

## Expertise Strength System

Kvantizovana sila — 5 pevnych urovni:

| Uroven | Hodnota | Vliv na styl |
|--------|---------|-------------|
| OFF | 0 | 0% |
| LIGHT | 25 | 30% |
| MEDIUM | 50 | 60% |
| STRONG | 75 | 75% |
| FULL | 100 | 100% |

## Expertise-Konverzace Vazby

Expertyza muze byt prirazena ke konverzaci. Lifecycle: INACTIVE → LOADED → LOCKED → APPLIED → ENFORCED.

## Expertise Cross-Session Pamet

Expertyza si pamatuje fakta napruc konverzacemi (`expertise_memory` tabulka). Max 50 polozek na expertyzu, max 2000 znaku na hodnotu.

---

# Merge Engine v2

Multi-expertise system — az 3 expertyzy soucasne v jedne konverzaci.

**v63.1:** Capability vektory realne ovlivnuji runtime chovani (teplota, instrukce, minResponseLength).

### 15.5-krokovy algoritmus

```
mergeExpertisePrompt() -- CISTY algoritmus (no side effects)
    |
    +-- 1. Validate count (max 3)
    +-- 2. checkCompatibility() -- 5D vektory, HARD_BLOCK/SOFT_BLOCK/WARNING/OK
    +-- 3. Sort by weight desc (position jako tie-breaker)
    +-- 4. resolveInheritance() -- parent chain (max depth 4)
    +-- 5. mergeModulesTagged() -- tagged items {text, expertiseId, weight}, dedup
    +-- 6. applySpecialistOverride() -- prida, nikdy neodstrani
    +-- 7. deriveTone() -- nejvyssi vaha vyhrava
    +-- 8. deriveTemperature() -- dominance (>0.6 ratio) nebo weighted avg
    +-- 9. User context budget (max 300 tokenu)
    +-- 10. trimToTokenBudget() -- budget 1800 tokenu, vocabulary>emphasis>domain_rules
    +-- 11. buildStructuredPrompt() -- sekce: Pravidla, Duraz, Omezeni, Slovnik, Antipatterns
    +-- 12. Append user context
    +-- 13. mergeEnforcement() -- forbiddenPhrases=UNION, minResponseLength=MAX
    +-- 13.5. computeCapabilityModifiers() + applyCapabilityModifiers()
    +-- 14. buildAuditLog()
    +-- 15. Object.freeze(result)
    |
    v
Frozen { prompt, metadata, enforcement, audit }
```

### Precedence Rules

| Konflikt | Resoluce |
|----------|----------|
| specialist_override vs capability_bias | specialist_override WINS |
| weight tie (A=0.5, B=0.5) | position je tie-breaker |
| inheritance extend vs replace | per-section, child rozhoduje |
| enforcement forbiddenPhrases | UNION |
| enforcement minResponseLength | MAX + capability modifier |
| disclaimers | UNION + dedup (case-insensitive) |
| tone conflict | highest weight wins |
| temperature conflict | dominance (>0.6) nebo weighted avg |

### Modules Format

Kazda z 15 built-in expertyz ma rucne kuratovane moduly (ne parsovane ze systemPrompt):

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

### Token Budget

- **MAX_TOTAL_TOKENS:** 2000 (externi API limit)
- **EFFECTIVE_TOKEN_BUDGET:** 1800 (interni s 10% rezervou)
- **MAX_USER_CONTEXT_TOKENS:** 300
- **Trim order:** vocabulary → emphasis → domain_rules (lowest weight first)
- **NIKDY se netrimi:** constraints, antipatterns, disclaimers

---

# 5D Capability System

Kazda expertyza ma 5-dimenzionalni vektor (0-100). Od v63.1 vektor aktivne ovlivnuje runtime chovani.

| Dimenze | Popis | Runtime efekt |
|---------|-------|-----------------------|
| reasoning | Analyticky vs intuitivni | HIGH (>70): instrukce pro hlubsi analyzu |
| creativity | Kreativni vs konzervativni | HIGH: temp bias +0.1, instrukce pro originalitu |
| determinism | Deterministicky vs volny | HIGH: temp bias -0.2, instrukce pro presnost |
| riskTolerance | Rizikovost | LOW (<30): minResponseLength +50, detailni instrukce |
| verbosity | Usecny vs upovidany | HIGH: instrukce pro detailni odpovedi |

**Thresholds:** LOW = 0-30, MEDIUM = 31-70, HIGH = 71-100

### Compatibility Severity

| Severity | Pravidlo | Vysledek |
|----------|---------|---------|
| HARD_BLOCK | maxGap >80 | Nelze zkombinovat |
| SOFT_BLOCK | maxGap >60 | Vyzaduje potvrzeni |
| WARNING | maxGap >50 | Varovani |
| OK | else | Bez problemu |

Priklad: `writer` (creativity=90) + `accountant` (determinism=95) → gap=85 → **HARD_BLOCK**

### Capability Normalization

Soft warnings (neblokuji, jen informuji):
- **Sum > 350:** Expertyza bude prilis specializovana
- **Kontradikce:** creativity > 70 && determinism > 70

---

# Enforcement Pipeline

Post-synthesis validace s moznosti retry. Pokud odpoved porusuje pravidla, regeneruje se s kontextem o poruseni (max 2 pokusy).

## ExpertiseEnforcer

```
LLM generuje odpoved s expertise promptem
    |
    v
ExpertiseEnforcer.enforce(response, expertise)
    |
    +-- 1. checkForbiddenPhrases(response, expertise.styleRules.forbiddenPhrases)
    |       +-- Default: "nevim", "to zalezi", "jako jazykovy model", "nemohu pomoci"
    |       +-- Ucetni: "odhaduji", "priblizne", "muze byt kolem", "tipuji"
    |       +-- Analytik: "mozna", "asi", "nevim presne"
    |       +-- Vyvojar: "TODO.*later", "this is just an example"
    |
    +-- 2. checkResponseLength(response, expertise.styleRules.minResponseLength)
    |       +-- Default: 50, Spisovatel: 200, DnD Master: 150, Ucetni: 100
    |
    +-- PORUSENI?
    |       +-- ANO (pokus 1) -> Regenerace s kontextem poruseni
    |       +-- ANO (pokus 2) -> Posledni pokus s explicitnim upozornenim
    |       +-- ANO (pokus 3) -> Ponechat s varovanim
    |       +-- NE -> Pokracovat na capability enforcement
    |
    +-- 3. enforceCapabilities() -- 5D drift detection (deterministicke, bez LLM)
    |       +-- evaluateDeterminism, evaluateRiskTolerance, evaluateVerbosity, evaluateStructure
    |       +-- computeCapabilityDrift() -- per-dimension delta, DRIFT_VIOLATION_THRESHOLD=40
    |
    +-- 4. Tool Enforcement (pouze kdyz toolEnforcement === true)
            +-- extractNumericClaims(response)
            +-- verifyNumericClaims() -- fuzzy tolerance ±1% pro cisla > 100
            +-- Nepodlozena cisla → varovani
```

## Retry Parameters

- **Temperature decay:** 0.1/attempt
- **Top_p decay:** 0.05/attempt
- **Temperature floor:** 0.1
- **Strict mode:** `hardFail=true` → response = null po vycerpani retries

## ExecutionTrace (v63.3)

- Jeden `executionTraceId` (UUID) per user turn
- Propojuje: `llm_execution_log` → `retryAudit` → `capability_drift_log` → `merge_audit_log`
- Prompt SHA-256 hash pro determinism analyzu
- `token_source: 'provider' | 'estimated'`
- `performance.now()` pro sub-ms latency

---

# Expertise Wizard UI

Formular pro vytvareni/editaci expertyz v IDE (center-views extension).

```
center-views: "+" button → wizard mode
    |
    +-- Zakladni udaje (name, domain, icon, desc, systemPrompt, tone, temperature)
    +-- Capabilities (5D) — 5 slideru s LOW/MEDIUM/HIGH gradient hinty
    +-- Modules — 6 section editors (add/remove items) + inheritance badges
    +-- Preview & Test — live compatibility, token count, prompt preview, LLM test
    |
    v
Save → POST /api/expertises → expertyza se objevi v registru
```

**Anti-drift:** Wizard si nacte konstanty z `GET /api/expertise-schema` — zadne hardcoded hodnoty ve frontendu.

**5 modularnich komponent:** wizard-helpers.js, wizard-basic.js, wizard-capabilities.js, wizard-modules.js, wizard-preview.js

---

# API Endpointy

| Endpoint | Metoda | Ucel |
|----------|--------|------|
| `/api/expertises` | GET | Seznam vsech expertyz |
| `/api/expertises/:id` | GET | Detail |
| `/api/expertises` | POST | Vytvoreni custom expertyzy |
| `/api/expertises/:id` | PUT | Uprava |
| `/api/expertises/:id` | DELETE | Smazani (pouze custom) |
| `/api/merge-preview` | GET | Preview merge s existujicimi expertyzami |
| `/api/merge-preview` | POST | Preview s inline config (wizard) |
| `/api/expertise-schema` | GET | Schema pro wizard (anti-drift) |
| `/api/expertise-wizard/test-prompt` | POST | LLM test s inline config |

---

# Database Schema

```sql
-- Definice expertyz (custom)
CREATE TABLE expertises (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    domain TEXT,
    system_prompt TEXT,
    temperature REAL,
    config TEXT,
    is_builtin BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vazba expertise-konverzace (single expertise, legacy)
CREATE TABLE expertise_bindings (
    conversation_id TEXT PRIMARY KEY,
    expertise_id TEXT NOT NULL,
    locked BOOLEAN DEFAULT 0,
    strength INTEGER DEFAULT 50,
    locked_at TIMESTAMP
);

-- Multi-expertise vazby (v63.0, max 3)
CREATE TABLE conversation_expertises (
    conversation_id TEXT NOT NULL,
    expertise_id TEXT NOT NULL,
    weight REAL DEFAULT 0.5 CHECK(weight >= 0.1 AND weight <= 1.0),
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(conversation_id, expertise_id)
);

-- Pamet expertyzy (cross-session)
CREATE TABLE expertise_memory (
    expertise_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    previous_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (expertise_id, key)
);

-- Merge audit log
CREATE TABLE merge_audit_log (
    conversation_id TEXT,
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL
);

-- Capability drift log
CREATE TABLE capability_drift_log (
    execution_trace_id TEXT,
    execution_step TEXT,
    ...
);

-- LLM execution log (v63.3)
CREATE TABLE llm_execution_log (
    model TEXT, temperature REAL,
    prompt_hash TEXT, prompt_tokens INTEGER,
    completion_tokens INTEGER, latency_ms REAL,
    token_source TEXT
);
```

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
| **Celkem** | **~217** | |

---

## Soubory

| Soubor | Radku | Ucel |
|--------|-------|------|
| `src/expertises/expertise-layer.js` | 1760 | Definice expertyz, registry, routing, modules, capabilities |
| `src/expertises/expertise-store.js` | 917 | DB persistence, CRUD, validace |
| `src/expertises/expertise-enforcement.js` | 341 | Forbidden phrases, delka, retry |
| `src/expertises/merge-engine.js` | 568 | mergeExpertisePrompt() |
| `src/expertises/merge-types.js` | 195 | Konstanty, CompatibilityBlockError |
| `src/expertises/merge-compatibility.js` | 189 | 5D pairwise conflict detection |
| `src/expertises/capability-enforcer.js` | — | Post-response 5D drift validation |
| `src/expertises/capability-mapping.js` | 267 | 5D → runtime modifikatory |
| `src/expertises/expertise-sandbox.js` | 299 | Offline simulace + baseline drift |
| `src/expertises/guards/tool-enforcement.js` | 365 | Overeni ciselnych tvrzeni |
| `src/chat/handlers/expertise.js` | 655 | Expertise handler |

---

*Puvodni dokument: "EXPERTS, SPECIALISTS & WORKERS.md" (Subsystem 1 + 3)*
*Viz take: [SPECIALISTS.md](SPECIALISTS.md) (Accountant) | [WORKERS.md](WORKERS.md) (Agent Runner, Notifikace)*
