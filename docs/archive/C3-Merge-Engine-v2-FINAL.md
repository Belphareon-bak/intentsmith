# C3-Agent — Merge Engine: Final Spec v2

**Datum:** 2026-02-13 (spec), aktualizovano 2026-03-01
**Navazuje na:** C3-Merge-Engine-Architecture.md + review feedback
**Status:** IMPLEMENTOVANO (v67-v79). Viz `src/expertises/merge-engine.js`, `merge-types.js`, `merge-compatibility.js`

Viz take: [EXPERTISES.md](EXPERTISES.md) | [SPECIALISTS.md](SPECIALISTS.md) | [SPECIALIST-LIFECYCLE.md](SPECIALIST-LIFECYCLE.md)

---

## Zapracované změny

| # | Feedback | Řešení |
|---|----------|--------|
| 🔴1 | Token budget trimming ořezává expertízy, ne sekce | → Ořezávání po sekcích s priority pořadím |
| 🔴2 | Merge engine musí být side-effect free | → Pure function contract, Object.freeze, no DB/cache |
| 🔴3 | Compatibility příliš hrubý (OK/BLOCKED) | → 4 severity levels: HARD_BLOCK / SOFT_BLOCK / WARNING / OK |
| 🔴4 | Weighted temperature = mdlý střed | → Dominance rule: if highest weight > 0.6 → use its temp |
| 🔴5 | Dědičnost: override vs extend nejasné | → Explicitní inheritanceMode per module (extend/replace) |
| 🟡1 | Capability model příliš hrubý (jen category) | → 5D capability vector (reasoning, creativity, determinism, risk, verbosity) |
| 🟡2 | Chybí prompt audit log | → MergeAuditLog s každým merge výstupem |
| 🟡3 | Chybí merge preview v UI | → Preview endpoint + UI specifikace |
| 🟢 | Hard limit expertíz | → MAX_ACTIVE_EXPERTISES = 3 |

---

## 1. Modules Format (beze změny)

```javascript
ExpertiseModules {
  domain_rules: string[]      // Pravidla domény
  emphasis: string[]           // Co zdůraznit
  constraints: string[]        // Omezení (NIKDY se neořezávají)
  vocabulary: string[]         // Preferované termíny
  antipatterns: string[]       // Co NEDĚLAT (NIKDY se neořezávají)
  disclaimer: string | null    // Povinný disclaimer (NIKDY se neořezává)
}
```

---

## 2. Hard Limits

```javascript
const MERGE_LIMITS = Object.freeze({
  // Expertízy
  MAX_ACTIVE_EXPERTISES: 3,       // hard limit — víc = prompt chaos

  // Per-section limits (po merge, před trim)
  MAX_DOMAIN_RULES: 15,
  MAX_EMPHASIS: 10,
  MAX_CONSTRAINTS: 15,            // nikdy se neořezává, jen varuje
  MAX_VOCABULARY: 30,
  MAX_ANTIPATTERNS: 10,           // nikdy se neořezává, jen varuje
  MAX_DISCLAIMERS: 3,             // nikdy se neořezává

  // Token budget
  MAX_TOTAL_TOKENS: 2000,         // celý merged prompt

  // Weight
  MIN_WEIGHT: 0.1,
  MAX_WEIGHT: 1.0,
  DOMINANCE_THRESHOLD: 0.6,      // nad tímto = dominantní expertíza
});
```

---

## 3. Token Budget Trimming Strategy

### Problém (v1)

V1 ořezávala celé expertízy od nejnižší weight. To mohlo zanechat disclaimer bez pravidel, nebo emphasis bez domain_rules.

### Řešení: Ořezávání po sekcích s prioritou

```javascript
/**
 * Sekce seřazené od NEJVYŠŠÍ po NEJNIŽŠÍ prioritu.
 * Ořezávání začíná OD KONCE seznamu (nejnižší priorita první).
 * Sekce s prioritou 1-3 se NIKDY neořezávají.
 */
const SECTION_TRIM_PRIORITY = Object.freeze([
  // === NIKDY NEOŘEZÁVAT (safety-critical) ===
  { section: 'disclaimers',   priority: 1, trimmable: false },
  { section: 'constraints',   priority: 2, trimmable: false },
  { section: 'antipatterns',  priority: 3, trimmable: false },

  // === OŘEZÁVAT KDYŽ NUTNÉ (od konce) ===
  { section: 'domain_rules',  priority: 4, trimmable: true },
  { section: 'emphasis',      priority: 5, trimmable: true },
  { section: 'vocabulary',    priority: 6, trimmable: true },
]);
```

### Trim algoritmus

```javascript
function trimToTokenBudget(mergedSections, budget) {
  let currentTokens = estimateTokens(mergedSections);

  if (currentTokens <= budget) return mergedSections; // nic k trimování

  // Ořezávej od nejnižší priority
  const trimmable = SECTION_TRIM_PRIORITY
    .filter(s => s.trimmable)
    .reverse(); // vocabulary → emphasis → domain_rules

  for (const { section } of trimmable) {
    if (currentTokens <= budget) break;

    const items = mergedSections[section];
    // Ořezávej od konce (= od nejnižší weight expertízy)
    while (items.length > 0 && currentTokens > budget) {
      const removed = items.pop();
      currentTokens = estimateTokens(mergedSections);
    }
  }

  // Pokud stále přesahuje (nemělo by se stát s 3 expertízami)
  if (currentTokens > budget) {
    mergedSections._trimWarning =
      `Prompt exceeds ${budget} tokens even after trimming. ` +
      `Current: ${currentTokens}. Consider reducing active expertises.`;
  }

  return mergedSections;
}
```

**Garantuje:** Constraints, antipatterns a disclaimers NIKDY nezmizí. Ořezávají se vocabulary → emphasis → domain_rules, vždy od položek s nejnižší weight.

---

## 4. Pure Function Contract

### Merge Engine = čistá funkce

```javascript
/**
 * CONTRACT:
 *   - Vstup: readonly pole expertíz + optional specialist + optional user context
 *   - Výstup: NOVÝ objekt (nikdy nemutuje vstup)
 *   - Side effects: ŽÁDNÉ (no DB, no cache, no registry mutation)
 *   - Determinismus: stejný vstup → vždy stejný výstup
 *   - Thread safety: bezpečné volat paralelně
 *
 * ZAKÁZÁNO:
 *   - Měnit weight v registry
 *   - Ukládat merged výsledek do cache
 *   - Volat DB
 *   - Mutovat vstupní objekty
 *   - Přistupovat ke globálnímu stavu
 */
function mergeExpertisePrompt(expertises, specialistOverride, userContext) {
  // Defensive: freeze inputs (dev mode)
  if (process.env.NODE_ENV === 'development') {
    Object.freeze(expertises);
    if (specialistOverride) Object.freeze(specialistOverride);
  }

  // ... merge logic ...

  // Výstup: nový objekt
  return Object.freeze({
    prompt: finalPrompt,
    metadata: mergeMetadata,
    audit: auditLog,
  });
}
```

### Testovatelnost

```javascript
// Testy mohou volat merge engine přímo, bez DB, bez LLM, bez side effects
test('merge 2 technical expertises produces valid prompt', () => {
  const result = mergeExpertisePrompt(
    [javaDevExpertise, cleanCodeExpertise],
    null,  // no specialist
    null   // no user context
  );
  expect(result.prompt).toContain('OOP');
  expect(result.prompt).toContain('single responsibility');
  expect(result.metadata.tokenCount).toBeLessThan(2000);
});
```

---

## 5. Compatibility: 4 Severity Levels

### Severity definice

```javascript
const CompatibilitySeverity = Object.freeze({
  OK:         'ok',          // plně kompatibilní
  WARNING:    'warning',     // kompatibilní, jen info v UI
  SOFT_BLOCK: 'soft_block',  // dovolí aktivaci s explicitním potvrzením
  HARD_BLOCK: 'hard_block',  // nedovolí aktivaci
});
```

### 5D Capability Vector

```javascript
ExpertiseCapabilities {
  reasoning: number      // 0-100: analytické myšlení, logika
  creativity: number     // 0-100: kreativita, originalita
  determinism: number    // 0-100: přesnost, opakovatelnost (finance = 100)
  riskTolerance: number  // 0-100: ochota riskovat (legal = 0, creative = 80)
  verbosity: number      // 0-100: délka odpovědí (developer = 30, writer = 90)
}
```

### Příklady capability vectorů

```javascript
const CAPABILITY_EXAMPLES = {
  'developer':     { reasoning: 80, creativity: 40, determinism: 70, riskTolerance: 30, verbosity: 30 },
  'writer':        { reasoning: 40, creativity: 90, determinism: 10, riskTolerance: 70, verbosity: 90 },
  'analyst':       { reasoning: 90, creativity: 20, determinism: 80, riskTolerance: 20, verbosity: 60 },
  'lawyer':        { reasoning: 80, creativity: 10, determinism: 90, riskTolerance: 5,  verbosity: 70 },
  'doctor':        { reasoning: 70, creativity: 10, determinism: 85, riskTolerance: 5,  verbosity: 60 },
  'psychologist':  { reasoning: 60, creativity: 50, determinism: 30, riskTolerance: 40, verbosity: 70 },
  'dnd_master':    { reasoning: 40, creativity: 95, determinism: 5,  riskTolerance: 80, verbosity: 85 },
  'trader':        { reasoning: 70, creativity: 20, determinism: 60, riskTolerance: 50, verbosity: 40 },
};
```

### Conflict Detection algoritmus

```javascript
function checkCompatibility(expertises) {
  if (expertises.length > MERGE_LIMITS.MAX_ACTIVE_EXPERTISES) {
    return {
      severity: CompatibilitySeverity.HARD_BLOCK,
      reason: `Maximum ${MERGE_LIMITS.MAX_ACTIVE_EXPERTISES} active expertises allowed`,
    };
  }

  const results = [];

  // Pairwise check all combinations
  for (let i = 0; i < expertises.length; i++) {
    for (let j = i + 1; j < expertises.length; j++) {
      const a = expertises[i].capabilities;
      const b = expertises[j].capabilities;

      // Dimension conflicts
      const conflicts = [];

      // creativity vs determinism
      const creativityGap = Math.abs(a.creativity - b.creativity);
      const determinismGap = Math.abs(a.determinism - b.determinism);

      if (a.creativity > 70 && b.determinism > 70) {
        conflicts.push({
          dimension: 'creativity↔determinism',
          gap: a.creativity + b.determinism - 100,
          detail: `${expertises[i].name} is creative (${a.creativity}), ` +
                  `${expertises[j].name} is deterministic (${b.determinism})`,
        });
      }

      // riskTolerance conflict
      const riskGap = Math.abs(a.riskTolerance - b.riskTolerance);
      if (riskGap > 60) {
        conflicts.push({
          dimension: 'riskTolerance',
          gap: riskGap,
          detail: `Risk tolerance gap: ${riskGap} points`,
        });
      }

      // verbosity conflict (less critical)
      const verbosityGap = Math.abs(a.verbosity - b.verbosity);
      if (verbosityGap > 50) {
        conflicts.push({
          dimension: 'verbosity',
          gap: verbosityGap,
          detail: `Verbosity gap: ${verbosityGap} points`,
        });
      }

      // Determine severity from conflicts
      if (conflicts.length > 0) {
        const maxGap = Math.max(...conflicts.map(c => c.gap));
        let severity;

        if (maxGap > 80) {
          severity = CompatibilitySeverity.HARD_BLOCK;
        } else if (maxGap > 60) {
          severity = CompatibilitySeverity.SOFT_BLOCK;
        } else {
          severity = CompatibilitySeverity.WARNING;
        }

        results.push({
          severity,
          expertise1: expertises[i].id,
          expertise2: expertises[j].id,
          conflicts,
        });
      }
    }
  }

  // Overall severity = worst case
  const worstSeverity = results.length > 0
    ? results.reduce((worst, r) => {
        const order = ['ok', 'warning', 'soft_block', 'hard_block'];
        return order.indexOf(r.severity) > order.indexOf(worst) ? r.severity : worst;
      }, 'ok')
    : CompatibilitySeverity.OK;

  return {
    severity: worstSeverity,
    conflicts: results,
    ok: worstSeverity === 'ok' || worstSeverity === 'warning',
    requiresConfirmation: worstSeverity === 'soft_block',
    blocked: worstSeverity === 'hard_block',
  };
}
```

### UI chování

```
HARD_BLOCK:   ❌ "Tyto expertízy nelze kombinovat" → tlačítko disabled
SOFT_BLOCK:   ⚠️ "Tyto expertízy mohou produkovat nekonzistentní odpovědi.
                   Opravdu chcete pokračovat?" → [Ano, chci] [Zrušit]
WARNING:      ℹ️ "Poznámka: verbosity gap 55 bodů" → jen info, žádná akce
OK:           ✅ žádné hlášení
```

---

## 6. Temperature Dominance Rule

### Problém (v1)

Weighted average produkuje "šedý střed" — není ani kreativní, ani analytický.

### Řešení: Dominance threshold

```javascript
function deriveTemperature(expertises) {
  // Sort by weight descending
  const sorted = [...expertises].sort((a, b) => b.weight - a.weight);
  const dominant = sorted[0];

  // Pokud dominantní expertíza má weight > 0.6 → použij její temperature
  if (dominant.weight > MERGE_LIMITS.DOMINANCE_THRESHOLD) {
    return dominant.temperature;
  }

  // Jinak weighted average (žádná nedominuje)
  const totalWeight = sorted.reduce((sum, e) => sum + e.weight, 0);
  return sorted.reduce(
    (temp, e) => temp + (e.temperature * e.weight / totalWeight),
    0
  );
}

function deriveTone(expertises) {
  // Tone = VŽDY dominantní expertíza (highest weight wins)
  const sorted = [...expertises].sort((a, b) => b.weight - a.weight);
  return sorted[0].tone;
}
```

### Příklady

```
Případ 1: Jasná dominance
  Java Dev (weight: 0.7, temp: 0.3) + Clean Code (weight: 0.3, temp: 0.2)
  → 0.7 > 0.6 → temperature = 0.3 (Java Dev dominuje)

Případ 2: Bez dominance
  Analytik (weight: 0.5, temp: 0.3) + Spisovatel (weight: 0.5, temp: 0.8)
  → 0.5 ≤ 0.6 → weighted average = 0.55
  → Ale tenhle případ by měl být SOFT_BLOCK (creativity↔determinism conflict)

Případ 3: Specialist override
  Jakákoliv situace + Specialist.temperatureOverride = 0.2
  → temperature = 0.2 (specialist VŽDY přepisuje)
```

---

## 7. Explicit Inheritance Mode

### Problém (v1)

Není jasné jestli child expertíza ROZŠIŘUJE nebo NAHRAZUJE parent moduly.

### Řešení: Per-module inheritanceMode

```javascript
ExpertiseDefinition {
  id: 'java-spring-dev',
  parent: 'java-dev',

  // Explicitní strategie pro každou sekci
  inheritance: {
    domain_rules: 'extend',     // přidej k parent pravidlům
    emphasis:     'extend',     // přidej k parent
    constraints:  'extend',     // přidej k parent (constraints se vždy hromadí)
    vocabulary:   'extend',     // přidej k parent
    antipatterns: 'extend',     // přidej k parent
    disclaimer:   'replace',    // nahraď parent disclaimer (pokud je)
  },

  modules: {
    domain_rules: [
      // TYTO se přidají k parent java-dev domain_rules
      'Use Spring Boot auto-configuration where possible',
      'Prefer application.yml over application.properties',
    ],
    // ...
  }
}
```

### Default = extend

```javascript
const DEFAULT_INHERITANCE_MODE = 'extend';

function resolveInheritance(expertise, registry) {
  if (!expertise.parent) return expertise.modules;

  const parent = registry.get(expertise.parent);
  if (!parent) {
    // Parent neexistuje → warning, use child-only
    return expertise.modules;
  }

  // Rekurzivně resolve parent chain
  const parentModules = resolveInheritance(parent, registry);

  // Merge per-module
  const resolved = {};
  for (const section of MODULE_SECTIONS) {
    const mode = expertise.inheritance?.[section] || DEFAULT_INHERITANCE_MODE;
    const parentItems = parentModules[section] || [];
    const childItems = expertise.modules[section] || [];

    switch (mode) {
      case 'extend':
        // Parent first, then child additions (deduplicated)
        resolved[section] = dedup([...parentItems, ...childItems]);
        break;
      case 'replace':
        // Child completely replaces parent
        resolved[section] = childItems;
        break;
      default:
        resolved[section] = dedup([...parentItems, ...childItems]);
    }
  }

  return resolved;
}
```

### Příklad inheritance chain

```
developer (builtin)
  domain_rules: ['Write clean, readable code', 'Use design patterns', 'Handle errors']
  constraints: ['No lazy TODOs', 'No unhandled exceptions']

  └── java-dev (extends developer)
        domain_rules: ['Prefer JVM ecosystem', 'Emphasize OOP and SOLID']
        constraints: ['Do not use raw types', 'Prefer immutable objects']

        └── java-spring-dev (extends java-dev)
              domain_rules: ['Use Spring Boot auto-configuration', 'Prefer constructor injection']
              constraints: ['No deprecated XML config', 'Use Spring Boot 3.x+']

Resolved java-spring-dev:
  domain_rules: [
    'Write clean, readable code',           // from developer
    'Use design patterns',                   // from developer
    'Handle errors',                         // from developer
    'Prefer JVM ecosystem',                  // from java-dev
    'Emphasize OOP and SOLID',               // from java-dev
    'Use Spring Boot auto-configuration',    // from java-spring-dev
    'Prefer constructor injection',          // from java-spring-dev
  ]
  constraints: [
    'No lazy TODOs',                         // from developer
    'No unhandled exceptions',               // from developer
    'Do not use raw types',                  // from java-dev
    'Prefer immutable objects',              // from java-dev
    'No deprecated XML config',              // from java-spring-dev
    'Use Spring Boot 3.x+',                 // from java-spring-dev
  ]
```

### Max inheritance depth

```javascript
const MAX_INHERITANCE_DEPTH = 4;
// developer → java-dev → java-spring-dev → java-spring-boot-3-dev
// Hlouběji = pravděpodobně špatný design
```

---

## 8. Merge Audit Log

### Účel

Bez audit logu je merge engine black box. Nelze debugovat proč odpověď zní tak, jak zní.

### Formát

```javascript
MergeAuditLog {
  timestamp: string,              // ISO datetime
  conversationId: string,

  // Vstup
  input: {
    expertises: [{
      id: string,
      name: string,
      weight: number,
      parentChain: string[],      // ['developer', 'java-dev', 'java-spring-dev']
    }],
    specialist: {
      id: string,
      name: string,
      overrides: string[],        // jaké sekce specialist overridoval
    } | null,
    userContextKeys: string[],    // jaké memory klíče byly injektovány
  },

  // Merge výsledek
  output: {
    totalTokens: number,
    sectionCounts: {
      domain_rules: number,
      emphasis: number,
      constraints: number,
      vocabulary: number,
      antipatterns: number,
      disclaimers: number,
    },
    derivedTone: string,
    derivedTemperature: number,
    temperatureMethod: 'dominant' | 'weighted_average' | 'specialist_override',
    dominantExpertise: string | null,
  },

  // Konflikty
  compatibility: {
    severity: string,             // 'ok' | 'warning' | 'soft_block'
    conflicts: [{
      dimension: string,
      expertise1: string,
      expertise2: string,
      gap: number,
    }],
  },

  // Trimming
  trimming: {
    applied: boolean,
    removedItems: [{
      section: string,
      item: string,
      fromExpertise: string,
    }],
    tokensBefore: number,
    tokensAfter: number,
  },
}
```

### Uložení

```javascript
// Audit log se ukládá do DB jen v dev/debug mode
// V produkci se loguje přes logger (structured JSON)
function logMergeAudit(audit) {
  logger.info('MergeEngine', 'Prompt merged', {
    expertises: audit.input.expertises.map(e => `${e.id}(${e.weight})`).join('+'),
    specialist: audit.input.specialist?.id || 'none',
    tokens: audit.output.totalTokens,
    tone: audit.output.derivedTone,
    temp: audit.output.derivedTemperature,
    tempMethod: audit.output.temperatureMethod,
    conflicts: audit.compatibility.conflicts.length,
    trimmed: audit.trimming.applied,
  });

  // V debug mode: persist to DB
  if (process.env.C3_DEBUG_MERGE) {
    db.prepare(`
      INSERT INTO merge_audit_log (conversation_id, timestamp, data)
      VALUES (?, ?, ?)
    `).run(audit.conversationId, audit.timestamp, JSON.stringify(audit));
  }
}
```

---

## 9. Merge Preview UI Spec

### Endpoint

```
GET /api/merge-preview?expertises=java-spring-dev,clean-code&specialist=null
```

### Response

```json
{
  "preview": {
    "activeExpertises": [
      { "id": "java-spring-dev", "name": "Java Spring Developer", "weight": 0.7, "parentChain": ["developer", "java-dev"] },
      { "id": "clean-code", "name": "Clean Code", "weight": 0.3, "parentChain": ["developer"] }
    ],
    "derivedTone": "concise",
    "derivedTemperature": 0.3,
    "temperatureMethod": "dominant",
    "dominantExpertise": "java-spring-dev",
    "sectionCounts": {
      "domain_rules": 9,
      "emphasis": 5,
      "constraints": 8,
      "vocabulary": 15,
      "antipatterns": 4,
      "disclaimers": 0
    },
    "totalTokens": 847,
    "tokenBudget": 2000,
    "compatibility": {
      "severity": "ok",
      "conflicts": []
    }
  },
  "mergedPrompt": "=== DOMAIN ===\n..."
}
```

### UI zobrazení

```
┌─────────────────────────────────────────────────────────┐
│  MERGE PREVIEW                                           │
│                                                          │
│  Active:                                                 │
│    ☕ Java Spring Developer  ████████████░░  weight: 70  │
│    📐 Clean Code             ████░░░░░░░░░  weight: 30  │
│                                                          │
│  Derived:                                                │
│    Tone:        concise (dominant: Java Spring)          │
│    Temperature: 0.30 (dominant)                          │
│    Tokens:      847 / 2000                               │
│                                                          │
│  Sections:                                               │
│    Domain rules:  9 items                                │
│    Emphasis:      5 items                                │
│    Constraints:   8 items                                │
│    Vocabulary:    15 terms                               │
│    Antipatterns:  4 items                                │
│    Disclaimers:   none                                   │
│                                                          │
│  Compatibility:  ✅ OK                                   │
│                                                          │
│  [▼ Show full merged prompt]                             │
│  [Test with sample question]                             │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Final Merge Engine — Complete Algorithm

```javascript
/**
 * C3 Prompt Merge Engine v2
 *
 * CONTRACT:
 *   Pure function — no side effects, no DB, no cache mutation.
 *   Same input → always same output.
 *   Returns frozen object.
 *
 * @param {ExpertiseDefinition[]} expertises - Max 3, each with weight
 * @param {SpecialistOverride|null} specialistOverride
 * @param {Object|null} userContext - key-value pairs from expertise_memory
 * @returns {Frozen<{ prompt, metadata, audit }>}
 */
function mergeExpertisePrompt(expertises, specialistOverride, userContext) {
  // ═══ VALIDATE ═══
  if (expertises.length > MERGE_LIMITS.MAX_ACTIVE_EXPERTISES) {
    throw new Error(`Max ${MERGE_LIMITS.MAX_ACTIVE_EXPERTISES} expertises`);
  }

  // ═══ SORT BY WEIGHT ═══
  const sorted = [...expertises].sort((a, b) => b.weight - a.weight);

  // ═══ RESOLVE INHERITANCE ═══
  const resolved = sorted.map(e => ({
    ...e,
    resolvedModules: resolveInheritance(e, registry),
  }));

  // ═══ MERGE MODULES ═══
  const merged = {
    domain_rules: dedup(flatMap(resolved, e => tag(e.resolvedModules.domain_rules, e.id))),
    emphasis:     dedup(flatMap(resolved, e => tag(e.resolvedModules.emphasis, e.id))),
    constraints:  dedup(flatMap(resolved, e => tag(e.resolvedModules.constraints, e.id))),
    vocabulary:   union(flatMap(resolved, e => e.resolvedModules.vocabulary)),
    antipatterns: dedup(flatMap(resolved, e => tag(e.resolvedModules.antipatterns, e.id))),
    disclaimers:  unique(resolved.map(e => e.resolvedModules.disclaimer).filter(Boolean)),
  };

  // ═══ SPECIALIST OVERRIDE ═══
  if (specialistOverride) {
    if (specialistOverride.additionalRules) {
      merged.domain_rules.unshift(
        ...tag(specialistOverride.additionalRules, '_specialist')
      );
    }
    if (specialistOverride.additionalConstraints) {
      merged.constraints.unshift(
        ...tag(specialistOverride.additionalConstraints, '_specialist')
      );
    }
    if (specialistOverride.disclaimerTemplate) {
      merged.disclaimers.unshift(specialistOverride.disclaimerTemplate);
    }
  }

  // ═══ DERIVE TONE + TEMPERATURE ═══
  const derivedTone = specialistOverride?.toneOverride
    || deriveTone(sorted);

  const { temperature: derivedTemp, method: tempMethod } =
    specialistOverride?.temperatureOverride != null
      ? { temperature: specialistOverride.temperatureOverride, method: 'specialist_override' }
      : deriveTemperatureWithDominance(sorted);

  // ═══ TRIM TO TOKEN BUDGET ═══
  const tokensBefore = estimateTokens(merged);
  const trimResult = trimToTokenBudget(merged, MERGE_LIMITS.MAX_TOTAL_TOKENS);
  const tokensAfter = estimateTokens(trimResult.merged);

  // ═══ BUILD STRUCTURED PROMPT ═══
  const prompt = buildStructuredPrompt(trimResult.merged, derivedTone);

  // ═══ APPEND USER CONTEXT ═══
  const finalPrompt = userContext
    ? `${prompt}\n\n=== YOUR CONTEXT ===\n${formatUserContext(userContext)}`
    : prompt;

  // ═══ COMPATIBILITY CHECK ═══
  const compatibility = checkCompatibility(resolved);

  // ═══ BUILD AUDIT LOG ═══
  const audit = buildAuditLog({
    expertises: sorted,
    specialistOverride,
    userContext,
    merged: trimResult.merged,
    derivedTone,
    derivedTemp,
    tempMethod,
    compatibility,
    trimming: {
      applied: tokensBefore !== tokensAfter,
      removedItems: trimResult.removed,
      tokensBefore,
      tokensAfter,
    },
  });

  // ═══ RETURN FROZEN RESULT ═══
  return Object.freeze({
    prompt: finalPrompt,
    metadata: Object.freeze({
      tone: derivedTone,
      temperature: derivedTemp,
      temperatureMethod: tempMethod,
      totalTokens: tokensAfter,
      compatibility,
      activeExpertises: sorted.map(e => ({ id: e.id, weight: e.weight })),
      dominantExpertise: sorted[0].weight > MERGE_LIMITS.DOMINANCE_THRESHOLD
        ? sorted[0].id : null,
    }),
    enforcement: Object.freeze(mergeEnforcement(resolved, specialistOverride)),
    audit: Object.freeze(audit),
  });
}
```

---

## 11. Implementation Status

```
FÁZE 1: Foundations — HOTOVO (v67)
  ✅ Modules format + JSDoc contract
  ✅ 5D Capability vector definition
  ✅ Migrovat 15 expertíz na modules formát + capabilities
  ✅ ExpertiseAgent class (expertise-layer.js)
  ✅ Inheritance: parentId, inheritanceMode, resolveInheritance()
  ✅ Expertise Registry v2 (categories, tags, parent, capabilities)
  ✅ DB schema: conversation_expertises (N:M, max 3)

FÁZE 2: Merge Engine — HOTOVO (v67-v69)
  ✅ mergeExpertisePrompt() — pure function (merge-engine.js, 573 lines)
  ✅ Token budget trimming (section-priority based)
  ✅ Temperature dominance rule
  ✅ Tone derivation (highest weight wins)
  ✅ Enforcement merger (union/MAX) — expertise-enforcement.js
  ✅ Merge Audit Log (structured, loggable)
  ✅ Tests: determinism, trimming, inheritance, conflicts

FÁZE 3: Compatibility + Validation — HOTOVO (v69-v71)
  ✅ 5D conflict detection (pairwise) — merge-compatibility.js
  ✅ 4-level severity (HARD_BLOCK/SOFT_BLOCK/WARNING/OK)
  ✅ Merge Preview endpoint (GET /api/merge-preview)
  ⬜ Merge Preview UI component — NEREALIZOVANO (API ready, no FE)
  ✅ Tests: compatibility matrix, edge cases

FÁZE 4: Expertíza Wizard — CASTECNE (v85 skills)
  ⬜ Create/edit wizard UI — NEREALIZOVANO
  ⬜ Parent picker — NEREALIZOVANO
  ⬜ Capability vector editor — NEREALIZOVANO
  ⬜ Compatibility preview — NEREALIZOVANO
  ✅ Create expertise: via skill `create-expertise` (7-step LLM-guided flow)
  ✅ REST API: CRUD for custom expertises (expertise-store.js, 60+ validation rules)

FÁZE 5: Specialist Runtime — HOTOVO (v74-v82)
  ✅ SpecialistRuntime class (specialist-runtime.js, 4 sub-classes)
  ✅ ToolAdapter contract (v75) — validate → normalize → execute → validateResult
  ✅ Migrovat Účetního na Specialist entity (accountant-cz package)
  ✅ Specialist handler v chat pipeline (expertise.js)
  ✅ Specialist CRUD API (8 REST endpoints)
  ✅ Specialist Memory — D4 (v79, specialist-memory.js)
  ✅ Specialist Telemetry (v82, specialist-telemetry.js)
  ✅ Dependency system (v79, topo sort)
  ✅ Knowledge Base — D2 (v79, knowledge-base.js)
  ✅ Scenario Engine — D3 (v79, scenario-engine.js)
  ✅ 270 assertions, 41 test blocks

FÁZE 6+: Future
  ⬜ D5: Specialist ↔ Expertise discovery + chaining (P1)
  ⬜ D9: Remote specialist marketplace (P2)
  ⬜ E1: Specialist CRUD wizard in IDE (P2)
  ⬜ Worker Wizard (viz WORKERS.md)
```

### Implementacni soubory

| Spec sekce | Soubor | Radky |
|-----------|--------|-------|
| Modules format, limits | `src/expertises/merge-types.js` | ~196 |
| Pure function, trimming, audit | `src/expertises/merge-engine.js` | ~573 |
| 5D compatibility, severity | `src/expertises/merge-compatibility.js` | ~186 |
| Inheritance, registry | `src/expertises/expertise-layer.js` | ~1770 |
| Enforcement merger | `src/expertises/expertise-enforcement.js` | ~250 |
| Persistence, validation | `src/expertises/expertise-store.js` | ~917 |
| Auto-select (vocabulary) | `src/expertises/auto-select.js` | ~229 |
| Specialist runtime | `src/expertises/specialist-runtime.js` | ~661 |
| Knowledge base | `src/expertises/knowledge-base.js` | ~461 |
| Scenario engine | `src/expertises/scenario-engine.js` | ~672 |
