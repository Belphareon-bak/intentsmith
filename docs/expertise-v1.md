# Expertise System v63+

## Overview

The Expertise System provides **domain-specific dialog modes** that influence HOW the LLM responds — style, depth, vocabulary, caution level — without changing WHAT decision the CRE makes. Expertises are NOT agents; they are personas applied to synthesis.

**Key principle:** Expertise influences synthesis style, NOT intent/tools/decisions. CRE remains authoritative.

**What it does:**
- 15 built-in expertises across 5 categories + unlimited custom expertises
- Multi-expertise merge (max 3 simultaneously) with 5D compatibility checking
- Enforcement pipeline: forbidden phrases, min length, retry with temperature decay
- Auto-selection based on vocabulary matching (no LLM, <1ms)
- Specialist runtime for tool-augmented experts (D1)
- Versioned knowledge base for domain facts (D2)
- Multi-step scenario engine for guided workflows (D3)
- Inheritance system for custom expertises extending built-ins

**What it does NOT do:**
- Change CRE intent classification (SEARCH stays SEARCH)
- Force tool usage (web.search stays web.search)
- Suppress LOCAL/CREATIVE decisions
- Act as background agents

---

## Architecture

```
User Input
  │
  ▼
Auto-Select (auto-select.js)
  │  Tier 1: vocabulary overlap (modules.vocabulary[])
  │  Tier 2: boost patterns (built-in only)
  │  Anti-flip-flop: hysteresis for stability
  │  Manual selection always has priority
  │
  ▼
Expertise Handler (expertise.js)
  │
  ├─ Single expertise active
  │    │
  │    ├─ CRE Decision (intent unchanged)
  │    ├─ systemPrompt + getSynthesisHints() → LLM
  │    ├─ ExpertiseEnforcer (forbidden phrases, min length)
  │    ├─ enforceCapabilities() (5D drift detection)
  │    └─ logLlmExecution() (audit trail)
  │
  └─ Multiple expertises active (max 3)
       │
       ├─ STEP 1: checkCompatibility() — 5D pairwise conflict detection
       ├─ STEP 2: resolveInheritance() — parent chain (max depth 4)
       ├─ STEP 3: mergeExpertisePrompt() — 15-step pure function
       │    validate → sort → inherit → merge modules → specialist
       │    → tone → temperature → trim tokens → build prompt → enforce
       ├─ STEP 4: LLM generation (merged prompt + weighted temperature)
       ├─ STEP 5: ExpertiseEnforcer — forbidden phrases, retry with decay
       ├─ STEP 6: enforceCapabilities() — 5D drift detection
       └─ STEP 7: logLlmExecution() — model, latency, prompt hash
```

---

## Built-in Expertises

15 expertises organized into 5 categories:

### A) Tvurci & Narativni (Creative & Narrative)

| ID | Name | Icon | Domain | Temp | Output Bias | creativeLock |
|----|------|------|--------|------|-------------|-------------|
| `writer` | Spisovatel | ✍️ | creative_writing | 0.8 | creative | yes |
| `dnd_master` | DnD Master | 🐉 | tabletop_rpg | 0.85 | creative | yes |
| `songwriter` | Textar | 🎵 | music_lyrics | 0.9 | creative | yes |

### B) Analyticko-rozhodovaci (Analytical & Decision)

| ID | Name | Icon | Domain | Temp | Output Bias |
|----|------|------|--------|------|-------------|
| `analyst` | Analytik | 📊 | analysis | 0.3 | analytical |
| `trader` | Prekupnik | 💰 | trading | 0.4 | conservative |
| `accountant` | Ucetni | 🧮 | finance | 0.2 | conservative |

The `accountant` is a **specialist** — it has registered tools (`tax_calculator`, `vat_calculator`, `deadline_checker`, `salary_calculator`) and `strictToolEnforcement: true`.

### C) Normativni & Odpovednostni (Normative & Responsible)

| ID | Name | Icon | Domain | Temp | Output Bias | Disclaimer |
|----|------|------|--------|------|-------------|-----------|
| `lawyer` | Pravnik | ⚖️ | legal | 0.3 | conservative | mandatory |
| `doctor` | Lekar | 🩺 | medical_education | 0.3 | conservative | mandatory |
| `psychologist` | Psycholog | 🧠 | psychology | 0.6 | creative | crisis info |

These have `CAUTION_HIGH` and mandatory disclaimers.

### D) Technicko-odborni (Technical & Expert)

| ID | Name | Icon | Domain | Temp | Output Bias |
|----|------|------|--------|------|-------------|
| `ai_expert` | AI Expert | 🤖 | artificial_intelligence | 0.4 | analytical |
| `developer` | Vyvojar | 💻 | software_development | 0.3 | analytical |
| `technician` | Technik | 🔧 | technical_support | 0.3 | conservative |

### E) Domenovi znalci (Domain Experts)

| ID | Name | Icon | Domain | Temp | Output Bias |
|----|------|------|--------|------|-------------|
| `car_enthusiast` | Autickar | 🚗 | automobiles | 0.5 | analytical |
| `biker` | Motorkar | 🏍️ | motorcycles | 0.5 | conservative |
| `political_analyst` | Politicky analytik | 🏛️ | politics | 0.4 | analytical |

---

## ExpertiseAgent Class

Every expertise (built-in or custom) is an `ExpertiseAgent` instance with the following properties:

```javascript
{
  // Identity
  id: string,                    // snake_case unique ID
  name: string,                  // Display name (Czech)
  icon: string,                  // Single emoji
  domain: string,                // Domain identifier (snake_case)
  description: string,           // Short description

  // Behavioral Configuration
  primaryProblemTypes: string[],  // 'procedural', 'price_range', 'specification', 'consensus', 'availability'
  allowedRepresentations: string[], // 'narrative', 'structured', 'report', 'tabular'
  planningDepth: 'none' | 'light' | 'deep',
  reviewPolicy: 'none' | 'self' | 'iterative',
  dataUsagePolicy: 'forbidden' | 'evidence' | 'controlled',
  outputBias: 'creative' | 'analytical' | 'conservative',
  creativeLock: boolean,         // If true, GUARD 6 overrides SEARCH→CREATIVE
  temperature: number,           // 0.0-1.0

  // Synthesis Influence (v45.0)
  strength: 0 | 25 | 50 | 75 | 100,  // Quantized levels: OFF/LIGHT/MEDIUM/STRONG/FULL
  weights: {
    style: 'formal' | 'casual' | 'creative' | 'technical',
    depth: 'shallow' | 'balanced' | 'deep',
    vocabulary: 'simple' | 'technical' | 'domain',
    caution: 'low' | 'medium' | 'high',
  },

  // Merge Engine (v63.0)
  capabilities: {                // 5D vector, 0-100 each
    reasoning: number,
    creativity: number,
    determinism: number,
    riskTolerance: number,
    verbosity: number,
  },
  modules: {
    domain_rules: string[],      // Domain-specific behavioral rules
    emphasis: string[],          // Priority focuses
    constraints: string[],      // What NOT to do (never trimmed in merge)
    vocabulary: string[],       // Domain terms (used by auto-select)
    antipatterns: string[],     // Common mistakes to avoid (never trimmed)
    disclaimer: string | null,  // Mandatory disclaimer text (never trimmed)
  },
  tone: string,                  // 'professional', 'creative', 'friendly', 'concise'

  // Inheritance
  parent: string | null,         // Parent expertise ID
  inheritance: {                 // Per-section mode
    [section]: 'extend' | 'replace',
  },

  // Enforcement (v44.10)
  styleRules: {
    tone: string,
    minResponseLength: number,
    forbiddenPhrases: (RegExp | string)[],
    requiredElements: RegExp[],
    toolEnforcement: boolean,          // Expert requires tool usage
    strictToolEnforcement: boolean,    // Hard fail after retries
  },

  // LLM
  systemPrompt: string,          // Expert persona prompt (max 8000 chars)
  preferredModels: string[],     // Model preference order
  isCustom: boolean,             // Built-in vs user-created
}
```

### Key Methods

- `getSynthesisHints(overrideStrength?)` — Returns hints for LLM synthesis (style, depth, vocabulary, caution). Strength maps to preset (light/balanced/deep) which modulates all dimensions.
- `getLLMSettings()` — Returns `{ model, temperature, top_p }`.
- `toJSON()` — Serialization for API and persistence.

---

## 5D Capability Vector

Every expertise defines a 5-dimensional capability profile (0-100 per dimension):

| Dimension | Low (0-30) | Medium (40-60) | High (70-100) |
|-----------|-----------|-----------------|----------------|
| `reasoning` | Simple answers | Balanced analysis | Deep analytical reasoning |
| `creativity` | Factual, no embellishment | Some creative freedom | Fully generative, expressive |
| `determinism` | Variable answers | Mostly consistent | Highly reproducible responses |
| `riskTolerance` | Many caveats/disclaimers | Balanced | Direct, few disclaimers |
| `verbosity` | Concise | Moderate length | Detailed, comprehensive |

Used for:
1. **Compatibility checking** — Pairwise 5D distance between expertises when merging
2. **Capability drift detection** — Post-response validation against expected profile
3. **Merge conflict resolution** — Dominant expertise's profile wins when conflict detected

---

## Strength & Presets (v45.0)

Expertise influence is controlled by **quantized strength levels** (0/25/50/75/100), mapped to presets:

| Strength Range | Preset | Style Multiplier | Depth | Vocabulary |
|----------------|--------|-------------------|-------|-----------|
| 0-30% | LIGHT | 0.3 (subtle) | shallow | 0.4 |
| 31-60% | BALANCED | 0.6 (normal) | expert default | 0.7 |
| 61-100% | DEEP | 1.0 (full) | deep (forced) | 1.0 |

Presets affect `_getSystemAddition()` — additional prompt instructions scaled by preset level.

---

## Auto-Select (auto-select.js)

Deterministic vocabulary-based expertise selection. Runs before CRE, <1ms per call.

### Algorithm

1. **Tier 1: Vocabulary overlap** — Match user input against `modules.vocabulary[]` with Czech stem matching (handles inflection: `kapitola`→`kapitolu`, `helma`→`helmu`).
   - Single-word match: +1 point
   - Multi-word match: +2 points
   - Shared terms (in 2+ expertises): ×0.5 penalty

2. **Tier 2: Boost patterns** — Built-in only. High-confidence domain indicators.
   - Example: `/\b(?:NPC|D&?D|DnD|dungeon)\b/i` → `dnd_master` (+3 points)
   - Custom expertises only use Tier 1 (no boost patterns)

3. **Anti-flip-flop** — Hysteresis: previous auto-selected expertise preferred if within 80% of winner's score.

4. **Threshold** — Minimum 2.0 score to activate. Tie → null (ambiguous). Max plausible score 10.

### Rules

- Manual selection ALWAYS has priority (auto never activates when locked)
- Only sets expertise context, never overrides CRE intent
- Custom expertises participate in Tier 1 only
- `recomputeSharedTerms()` recalculated after adding custom expertises

---

## Merge Engine (merge-engine.js)

Pure function `mergeExpertisePrompt()` — merges N expertises (max 3) into a single structured prompt.

### Contract

- **Pure function**: no side effects, no DB, no I/O
- **Deterministic**: same input → same output
- **Commutative**: merge(A,B) == merge(B,A) when weights differ
- **Frozen output**: `Object.freeze(result)`
- **Input not mutated**

### Precedence Rules

| Conflict | Resolution |
|----------|-----------|
| Tone clash | Highest weight wins (sorted[0]) |
| Temperature clash | Dominant (>0.6) wins; else weighted average |
| Module conflict | Per-section: 'extend' = dedup merge, 'replace' = child only |
| Disclaimer conflict | UNION (all unique, never trimmed) |
| Capability conflict | Used for compatibility check, not merged |
| Constraints conflict | UNION (never trimmed) |
| Antipatterns conflict | UNION (never trimmed) |
| Forbidden phrases | UNION of all (regex + string) |
| Min response length | MAX across all expertises |
| Equal weight tie | `position` field is tie-breaker (lower = higher priority) |

### Token Budget

| Limit | Value |
|-------|-------|
| Max total tokens | 2000 |
| Effective budget | 1800 (10% safety margin) |
| Max user context tokens | 300 |

### Trim Priority

Sections ordered by priority (high to low). Trimming starts from lowest priority:

| Priority | Section | Trimmable |
|----------|---------|-----------|
| 1 | disclaimers | NEVER |
| 2 | constraints | NEVER |
| 3 | antipatterns | NEVER |
| 4 | domain_rules | Yes |
| 5 | emphasis | Yes |
| 6 | vocabulary | Yes |

---

## Compatibility Check (merge-compatibility.js)

5D pairwise conflict detection when merging multiple expertises.

### Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| `OK` | Compatible | Merge proceeds |
| `WARNING` | Minor conflict | Merge proceeds with warning to user |
| `SOFT_BLOCK` | Significant conflict | Merge allowed but may produce poor results |
| `HARD_BLOCK` | Incompatible | `CompatibilityBlockError` thrown, merge refused |

---

## Inheritance (v63.2)

Custom expertises can extend built-ins via `parent` field.

### Resolution Rules

- **Max depth**: 4 levels
- **Modules**: per-section `extend` (dedup concat, default) or `replace` (child only)
- **Capabilities**: child explicit value overrides; child undefined → inherit parent
- **Enforcement (styleRules)**: UNION — child CANNOT weaken parent unless `overrideParentEnforcement: true`
  - `forbiddenPhrases`: deduplicated union
  - `minResponseLength`: MAX(parent, child)
  - Boolean flags (`toolEnforcement`, etc.): OR (parent true → stays true)

---

## Enforcement Pipeline

### 1. ExpertiseEnforcer (expertise-enforcement.js)

Post-synthesis validation:

```
LLM Response
  │
  ├─ Check forbidden phrases (default + expert-specific)
  ├─ Check min response length
  │
  ├─ Violation? → Retry with:
  │    - Violation context in prompt
  │    - Temperature decay: -0.1 per attempt
  │    - Top-p decay: -0.05 per attempt
  │    - Max 2 retries
  │
  └─ Still violated after retries?
       ├─ strictToolEnforcement: true → hard fail
       └─ Normal mode → return with warning
```

**Default forbidden phrases** (all experts):
- `^(nevim|netusim)\.?$` — just "I don't know"
- `^to zalezi\.?$` — just "it depends"
- `jako (velky )?jazykovy model` — "as a language model"
- `nemohu (vam )?pomoci s` — "I cannot help with"

### 2. Capability Drift Detection (capability-enforcer.js)

Post-response 5D validation:
- Hedging ratio, caveat density, verbosity, structure scoring
- `computeCapabilityDrift()` — per-dimension delta vs expected profile
- Violation threshold: 40 (drift score above this = violation)
- Logged to `capability_drift_log` (always logged, not just on failure)

### 3. ExecutionTrace (v63.3)

One `executionTraceId` (UUID) per user turn, shared across all audit layers:

```
llm_execution_log → ExpertiseEnforcer.retryAudit → capability_drift_log → merge_audit_log
```

- Prompt SHA-256 hash for determinism analysis (never store the prompt itself)
- `token_source: 'provider' | 'estimated'`
- `performance.now()` for sub-ms latency

---

## Specialist Runtime — D1 (specialist-runtime.js)

Tool-augmented expert framework. Generalizes the accountant pattern (detector → tool → enforce → persona wrap) into a reusable framework.

### Architecture

```
ToolRegistry → IntentDetector → ToolExecutor → SpecialistRuntime
```

1. **ToolRegistry** — Maps specialist → tools (lazy-loaded modules)
2. **IntentDetector** — Pattern-based routing: user input → tool match
3. **ToolExecutor** — Runs deterministic tool, returns structured result
4. **SpecialistRuntime** — Orchestrates detect → execute → wrap pipeline

### Registration

```javascript
toolRegistry.registerSpecialist({
  id: 'accountant',
  domain: 'finance',
  tools: [
    {
      id: 'accountant.tax_calculator',
      name: 'Tax Calculator',
      modulePath: './tools/tax-calculator.js',
      functionName: 'calculate',
      patterns: [{ patterns: [/dan z prijmu/i, /vypocitej dan/i], priority: 10 }],
      extractParams: (input) => { /* extract income, year, etc. */ },
    },
  ],
});
```

### Registered Specialists

Currently registered: `accountant` with 4 tools (tax_calculator, vat_calculator, deadline_checker, salary_calculator).

---

## Knowledge Base — D2 (knowledge-base.js)

Versioned fact store replacing hardcoded constants. DB-backed with provenance metadata.

### Fact Structure

```javascript
kb.getFact('tax', 'income_tax', 'base_rate', 2025)
// → { value: '15', value_type: 'percentage', source: 'Zakon 586/1992 Sb.', confidence: 0.95 }
```

**Scoping:** `domain` / `category` / `key` / `year` — year can be null for timeless facts.

**Provenance:** source, source_url, confidence (0-1), is_provisional, verified_at, verified_by, notes.

**Integration:** ToolExecutor injects KnowledgeBase handle into tool context so tools query facts dynamically.

---

## Scenario Engine — D3 (scenario-engine.js)

Multi-step guided workflows for specialists. Interactive data collection → tool execution → presentation.

### Phases

```
INTRO → COLLECTING → COMPUTING → PRESENTING → RECOMMENDING → ADJUSTING → COMPLETED
                                                                          └→ CANCELLED
```

### Scenario Definition

```javascript
{
  id: 'income_tax_calc',
  specialistId: 'accountant',
  name: 'Vypocet dane z prijmu',
  triggers: [/vypocitej.*dan/i, /dan z prijmu/i],
  steps: [
    { id: 'income', question: 'Jaky je tvuj rocni prijem?', extract: (input) => parseNumber(input) },
    { id: 'type', question: 'OSVC nebo zamestnanec?', extract: (input) => ... },
    // ...
  ],
  compute: async (collected) => taxCalculator.calculate(collected),
  present: (results, collected) => formatTaxReport(results),
}
```

### Integration

- `conversation.js` checks `scenarioRunner.isActive(sessionId)` — if active, routes input to scenario
- If not active, expert handler checks `scenarioRegistry.detectTrigger()` to start new scenario
- Each session can have one active scenario at a time

---

## Custom Expertises

### Creating via Skill

The `create-expertise` skill (v3, privileged) provides a guided 7-step workflow:

```
ask(clarify) → llm(draft JSON) → review(checkpoint) → llm(refine) → validate(schema) → template(format) → write(save)
```

**Parameters:** `topic` (required) — theme or domain of the new expertise.

**Output:** JSON config file saved to `expertises/custom-{topic}.json`.

### Validation Rules

Custom expertise configs are validated against 60+ rules (`expertise-store.js`):

| Field | Rules |
|-------|-------|
| `name` | Required, 2-64 chars |
| `description` | Max 500 chars |
| `domain` | Max 64 chars, pattern: `[a-z0-9_]+` |
| `systemPrompt` | Max 8000 chars, forbidden: injection patterns ("ignore all instructions", "jailbreak", etc.) |
| `temperature` | 0.0-1.0 |
| `forbiddenPhrases` | Max 50 items, max 200 chars each |
| `modules` | Valid sections only, per-section item limits |
| `capabilities` | Valid 5D dimensions, 0-100 each |
| `inheritance` | Valid modes: 'extend' or 'replace' |

### Persistence

- Custom expertises stored in `custom_expertises` table (id, config JSON)
- Loaded on startup, hot-reloaded after skill creates new expertise
- `ExpertiseRegistry` maintains `expertises` (built-in) + `customExpertises` (user) maps
- Custom lookup has priority: `customExpertises.get(id) || expertises.get(id)`

---

## CRE Integration

### GUARD 6 — Creative Override (v87)

When expertise with `creativeLock: true` or `outputBias === 'creative'` is active:
- SEARCH/AMBIGUOUS intent → overridden to CREATIVE
- **Bypass patterns**: explicit search requests (vyhledej, googl, ve skutecnosti, v realnem svete, ve wikipedii, faktick, historicka fakta)

### Expertise Handler Routing

The expertise handler processes CRE decisions:

| Decision | Action |
|----------|--------|
| ANSWER | `generateExpertiseResponse()` — expert persona LLM call |
| CREATIVE | `generateExpertiseResponse()` |
| CODE | `generateExpertiseResponse()` (code-aware prompt) |
| SEARCH | Web search + expert-domain synthesis |
| TOOL_CALL | `handleToolCallDecision()` |
| ASK_USER | `handleAskUserDecision()` |
| PLAN | `generateExpertiseResponse()` (build planning) |
| REFUSE | `handleRefuseDecision()` |

---

## Database Schema

### `expertises`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Expertise ID |
| `name` | TEXT | Display name |
| `description` | TEXT | Short description |
| `domain` | TEXT | Domain identifier |
| `system_prompt` | TEXT | Expert persona prompt |
| `temperature` | REAL | LLM temperature |
| `config` | TEXT | Full JSON config |
| `is_builtin` | INTEGER | 1 for built-in, 0 for custom |

### `expertise_bindings`

| Column | Type | Description |
|--------|------|-------------|
| `conversation_id` | TEXT | Conversation FK |
| `expertise_id` | TEXT | Bound expertise |
| `locked` | INTEGER | Manual lock flag |
| `strength` | REAL | Strength override (0-100) |
| `locked_at` | DATETIME | When locked |

### `conversation_expertises` (v63 N:M, max 3)

| Column | Type | Description |
|--------|------|-------------|
| `conversation_id` | TEXT | Conversation FK |
| `expertise_id` | TEXT | Expertise FK |
| `weight` | REAL | Merge weight (0.1-1.0) |
| `position` | INTEGER | Priority tie-breaker |

### `expertise_memory`

Cross-session learning per expertise.

### `custom_expertises`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Custom expertise ID |
| `config` | TEXT | Full JSON config |

### Audit Tables

| Table | Purpose |
|-------|---------|
| `merge_audit_log` | Merge operation history (execution_trace_id, data JSON) |
| `capability_drift_log` | 5D drift scores per response (expected vs observed) |
| `llm_execution_log` | Model, latency, prompt hash, token count per LLM call |
| `knowledge_facts` | D2 versioned fact store (domain/category/key/year/value) |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/merge-preview?expertises=a,b` | Preview merge result without executing |
| `GET` | `/api/expertises` | List all expertises (built-in + custom) |
| `GET` | `/api/expertises/:id` | Get single expertise |
| `POST` | `/api/expertises` | Create custom expertise |
| `PUT` | `/api/expertises/:id` | Update custom expertise |
| `DELETE` | `/api/expertises/:id` | Delete custom expertise (custom only) |
| `GET` | `/api/expertise-schema` | JSON schema for expertise wizard |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `C3_ENABLE_EXPERTISES` env | `true` | Enable/disable expertise system |
| `c3.features.expertises` IDE pref | `true` | IDE Settings toggle |
| Max active expertises | 3 | Hard limit in MERGE_LIMITS |
| Max inheritance depth | 4 | Prevents infinite recursion |
| Max token budget | 2000 | Merged prompt token limit |
| Enforcement max retries | 2 | Temperature decay retries |
| Temperature decay | 0.1/attempt | Reduces randomness on retry |
| Capability drift threshold | 40 | Above = violation |

---

## Files

| File | Purpose |
|------|---------|
| `src/expertises/expertise-layer.js` | 15 built-in expertises, ExpertiseAgent class, ExpertiseRegistry, resolveInheritance() |
| `src/expertises/expertise-store.js` | Persistence, validation (60+ rules), lifecycle states |
| `src/expertises/expertise-enforcement.js` | Post-synthesis forbidden phrase check, retry with decay |
| `src/expertises/auto-select.js` | Vocabulary-based auto-selection (<1ms, no LLM) |
| `src/expertises/merge-engine.js` | `mergeExpertisePrompt()` — 15-step pure function |
| `src/expertises/merge-types.js` | MERGE_LIMITS, MODULE_SECTIONS, CompatibilityBlockError |
| `src/expertises/merge-compatibility.js` | 5D pairwise compatibility checking |
| `src/expertises/capability-enforcer.js` | Post-response 5D drift detection |
| `src/expertises/capability-mapping.js` | Capability vector → prompt/temperature modifiers |
| `src/expertises/specialist-runtime.js` | D1: Tool-augmented expert framework |
| `src/expertises/knowledge-base.js` | D2: Versioned fact store with provenance |
| `src/expertises/scenario-engine.js` | D3: Multi-step guided workflows |
| `src/chat/handlers/expertise.js` | Handler: CRE routing, merge delegation, enforcement |
| `src/routes/expertises.js` | REST API: CRUD, merge-preview, schema |
| `skills/create-expertise.json` | Skill: 7-step guided expertise creation |
| `docs/expertise-v1.md` | This documentation |
