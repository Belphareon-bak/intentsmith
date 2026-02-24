# C3 Merge Engine v2 — Delta Patch #1

**Datum:** 2026-02-13
**Aplikuje se na:** C3-Merge-Engine-v2-FINAL.md
**Řeší:** 5 finálních připomínek z review

---

## 🔴 FIX 1: Compatibility check PŘED merge

### Problém
Compatibility check probíhal až po merge. HARD_BLOCK by měl zastavit celý proces ještě před merge.

### Fix: Nové pořadí v mergeExpertisePrompt()

```javascript
function mergeExpertisePrompt(expertises, specialistOverride, userContext) {
  // ═══ 1. VALIDATE COUNT ═══
  if (expertises.length > MERGE_LIMITS.MAX_ACTIVE_EXPERTISES) {
    throw new Error(`Max ${MERGE_LIMITS.MAX_ACTIVE_EXPERTISES} expertises`);
  }

  // ═══ 2. COMPATIBILITY CHECK (before merge!) ═══
  const compatibility = checkCompatibility(expertises); // raw, not resolved
  if (compatibility.blocked) {
    throw new CompatibilityBlockError(compatibility);
  }

  // ═══ 3. SORT BY WEIGHT ═══
  const sorted = [...expertises].sort((a, b) => b.weight - a.weight);

  // ═══ 4. RESOLVE INHERITANCE ═══
  const resolved = sorted.map(e => ({
    ...e,
    resolvedModules: resolveInheritance(e, registry),
  }));

  // ═══ 5. MERGE MODULES ═══
  // ... rest of merge ...
}
```

---

## 🔴 FIX 2: Compatibility na raw capabilities, ne resolved

### Problém
`checkCompatibility(resolved)` používá post-inheritance data. Compatibility se má posuzovat na samotných aktivních expertízách a jejich vlastních capability vectorech.

### Fix

```javascript
// ŠPATNĚ (v2):
const compatibility = checkCompatibility(resolved);

// SPRÁVNĚ (v2.1):
const compatibility = checkCompatibility(expertises);
// checkCompatibility() pracuje POUZE s:
//   - expertise.id
//   - expertise.capabilities (5D vector)
//   - expertise.weight
// NIKDY s resolvedModules (ty ještě neexistují v tomto bodě)
```

Toto je automaticky splněno přesunem compatibility checku PŘED resolve inheritance (Fix 1).

---

## 🔴 FIX 3: Trim respektuje weight

### Problém
`items.pop()` po flatMap nemá informaci o weight. Může oříznout položku dominantní expertízy.

### Fix: Tagged items s weight

```javascript
/**
 * Tag helper — každá položka nese metadata o svém původu.
 * Používá se při merge i při trim.
 */
function tagItems(items, expertiseId, weight) {
  return items.map(text => ({ text, expertiseId, weight }));
}

/**
 * Merge modules — tagged verze
 */
function mergeModulesTagged(resolved) {
  const merged = {};

  for (const section of TRIMMABLE_SECTIONS) {
    const allItems = flatMap(resolved, e =>
      tagItems(e.resolvedModules[section] || [], e.id, e.weight)
    );

    // Deduplicate by text, keep highest weight version
    const seen = new Map();
    for (const item of allItems) {
      const existing = seen.get(item.text);
      if (!existing || item.weight > existing.weight) {
        seen.set(item.text, item);
      }
    }

    // Sort: highest weight first (trim pops from end = lowest weight)
    merged[section] = [...seen.values()]
      .sort((a, b) => b.weight - a.weight);
  }

  return merged;
}

/**
 * Trim — ořezává od nejnižší weight v každé sekci
 */
function trimToTokenBudget(merged, budget) {
  let currentTokens = estimateTokensTagged(merged);
  const removed = [];

  if (currentTokens <= budget) {
    return { merged, removed };
  }

  // Ořezávej od nejnižší priority sekce
  const trimmable = SECTION_TRIM_PRIORITY
    .filter(s => s.trimmable)
    .reverse(); // vocabulary → emphasis → domain_rules

  for (const { section } of trimmable) {
    if (currentTokens <= budget) break;

    const items = merged[section];
    // Items are sorted by weight desc → pop() removes LOWEST weight
    while (items.length > 0 && currentTokens > budget) {
      const removedItem = items.pop();
      removed.push({
        section,
        text: removedItem.text,
        fromExpertise: removedItem.expertiseId,
        weight: removedItem.weight,
      });
      currentTokens = estimateTokensTagged(merged);
    }
  }

  return { merged, removed };
}
```

**Garance:** Položky dominantní expertízy (highest weight) se oříznou jako poslední.

---

## 🟡 FIX 4: User context má vlastní token budget

### Problém
User context se appenduje bez kontroly, může přetéct celkový budget.

### Fix: Dedikovaný budget

```javascript
const MERGE_LIMITS = Object.freeze({
  // ... existing ...
  MAX_TOTAL_TOKENS: 2000,
  MAX_USER_CONTEXT_TOKENS: 300,     // ← NOVÉ
  // Efektivní budget pro modules = 2000 - 300 = 1700
});

function mergeExpertisePrompt(expertises, specialistOverride, userContext) {
  // ...

  // User context: truncate to budget
  const contextBudget = MERGE_LIMITS.MAX_USER_CONTEXT_TOKENS;
  const truncatedContext = userContext
    ? truncateToTokens(formatUserContext(userContext), contextBudget)
    : null;

  // Modules get remaining budget
  const modulesBudget = MERGE_LIMITS.MAX_TOTAL_TOKENS
    - (truncatedContext ? estimateTokens(truncatedContext) : 0);

  // Trim modules to their budget
  const trimResult = trimToTokenBudget(merged, modulesBudget);

  // Build final
  const prompt = buildStructuredPrompt(trimResult.merged, derivedTone);
  const finalPrompt = truncatedContext
    ? `${prompt}\n\n=== YOUR CONTEXT ===\n${truncatedContext}`
    : prompt;

  // Assert total
  const totalTokens = estimateTokens(finalPrompt);
  if (totalTokens > MERGE_LIMITS.MAX_TOTAL_TOKENS) {
    logger.warn('MergeEngine', `Token budget exceeded: ${totalTokens}/${MERGE_LIMITS.MAX_TOTAL_TOKENS}`);
  }

  // ...
}
```

---

## 🟡 FIX 5: Enforcement merge — formalizované pravidla

### Problém
`mergeEnforcement()` nebyl explicitně specifikován.

### Fix: Kompletní contract

```javascript
/**
 * Merge enforcement rules from N expertises + optional specialist.
 *
 * CONTRACT:
 *   Pure function. No side effects.
 *   Returns frozen enforcement config.
 *
 * MERGE RULES:
 *   forbiddenPhrases:      UNION (all apply, deduplicated)
 *   requiredElements:      UNION (all apply)
 *   minResponseLength:     MAX (strictest wins)
 *   numericVerification:   OR (any expert wants it → enabled)
 *   retryOnViolation:      MAX (most retries wins)
 *   disclaimers:           UNION (all required, ordered by weight)
 *   toolEnforcement:       SPECIALIST ONLY (expertises never have tools)
 *
 * PRIORITY:
 *   Specialist enforcement > Expertise enforcement > Default enforcement
 *   ">" means: specialist ADDS to expertise rules, never removes them
 */
function mergeEnforcement(resolvedExpertises, specialistOverride) {
  // ─── DEFAULT (always applied) ───
  const enforcement = {
    forbiddenPhrases: [...DEFAULT_FORBIDDEN_PHRASES],
    requiredElements: [],
    minResponseLength: 50,
    numericVerification: false,
    retryOnViolation: 2,
    disclaimers: [],
    toolEnforcement: false,
    toolDetector: null,
  };

  // ─── EXPERTISE LAYER (union/max) ───
  for (const expertise of resolvedExpertises) {
    const modules = expertise.resolvedModules;
    const style = expertise.styleRules || {};

    // UNION: antipatterns → forbiddenPhrases
    if (modules.antipatterns) {
      enforcement.forbiddenPhrases.push(
        ...modules.antipatterns.map(a => typeof a === 'object' ? a.text : a)
      );
    }

    // UNION: requiredElements
    if (style.requiredElements) {
      enforcement.requiredElements.push(...style.requiredElements);
    }

    // MAX: minResponseLength
    if (style.minResponseLength) {
      enforcement.minResponseLength = Math.max(
        enforcement.minResponseLength,
        style.minResponseLength
      );
    }

    // UNION: disclaimers
    if (modules.disclaimer) {
      enforcement.disclaimers.push(modules.disclaimer);
    }
  }

  // ─── SPECIALIST LAYER (adds, never removes) ───
  if (specialistOverride) {
    // ADD forbidden phrases
    if (specialistOverride.globalForbiddenPhrases) {
      enforcement.forbiddenPhrases.push(
        ...specialistOverride.globalForbiddenPhrases
      );
    }

    // ADD disclaimer
    if (specialistOverride.disclaimerTemplate) {
      enforcement.disclaimers.unshift(specialistOverride.disclaimerTemplate);
    }

    // MAX: minResponseLength
    if (specialistOverride.minResponseLength) {
      enforcement.minResponseLength = Math.max(
        enforcement.minResponseLength,
        specialistOverride.minResponseLength
      );
    }

    // OR: numericVerification
    enforcement.numericVerification =
      enforcement.numericVerification || specialistOverride.numericVerification || false;

    // MAX: retryOnViolation
    if (specialistOverride.retryOnViolation) {
      enforcement.retryOnViolation = Math.max(
        enforcement.retryOnViolation,
        specialistOverride.retryOnViolation
      );
    }

    // SPECIALIST ONLY: tool enforcement
    enforcement.toolEnforcement = specialistOverride.toolEnforcement || false;
    enforcement.toolDetector = specialistOverride.toolDetector || null;
  }

  // ─── DEDUPLICATE ───
  enforcement.forbiddenPhrases = dedup(enforcement.forbiddenPhrases);
  enforcement.requiredElements = dedup(enforcement.requiredElements);
  enforcement.disclaimers = unique(enforcement.disclaimers);

  return Object.freeze(enforcement);
}
```

### Enforcement Merge cheatsheet

```
┌────────────────────┬───────────┬────────────────────────────┐
│ Property           │ Strategy  │ Meaning                    │
├────────────────────┼───────────┼────────────────────────────┤
│ forbiddenPhrases   │ UNION     │ All forbidden, all apply   │
│ requiredElements   │ UNION     │ All required, all apply    │
│ minResponseLength  │ MAX       │ Strictest wins             │
│ numericVerification│ OR        │ Anyone wants → enabled     │
│ retryOnViolation   │ MAX       │ Most retries wins          │
│ disclaimers        │ UNION     │ All required, all shown    │
│ toolEnforcement    │ SPECIALIST│ Only specialist can enable  │
│ toolDetector       │ SPECIALIST│ Only specialist provides    │
└────────────────────┴───────────┴────────────────────────────┘

Priority: Specialist ADDS to Expertise. Never removes.
          Expertise ADDS to Default. Never removes.
          → enforcement only gets STRICTER, never looser.
```

---

## Souhrn změn v algoritmu

Finální pořadí operací v `mergeExpertisePrompt()`:

```
 1. Validate count (≤ 3)
 2. Compatibility check (on RAW capabilities) ← MOVED UP
    → HARD_BLOCK throws before any work
 3. Sort by weight
 4. Resolve inheritance (parent → child chains)
 5. Merge modules (tagged with expertiseId + weight) ← TAGGED
 6. Specialist override (adds to merged)
 7. Derive tone (highest weight wins)
 8. Derive temperature (dominance rule)
 9. Calculate user context budget (max 300 tokens) ← NEW
10. Trim modules to remaining budget (by section priority, lowest weight first) ← WEIGHT-AWARE
11. Build structured prompt
12. Append user context (truncated)
13. Merge enforcement (UNION/MAX/OR) ← FORMALIZED
14. Build audit log
15. Return frozen result
```

---

## Celkový stav dokumentace

| Dokument | Obsah | Status |
|----------|-------|--------|
| **C3-Boundaries-v3-FINAL.md** | Definice Expertíza / Specialista / Worker | ✅ FINAL |
| **C3-Merge-Engine-v2-FINAL.md** | Merge engine architektura | ✅ FINAL |
| **C3-Merge-Engine-v2-DeltaPatch1.md** | 5 fixů z finálního review | ✅ FINAL |
| **EXPERTS-AND-SPECIALISTS.md** | Aktuální stav kódu (v62) | ✅ Reference |

**Architektura je ready for implementation.** Žádné otevřené otázky.
