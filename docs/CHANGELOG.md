# C3 Changelog

---

## v62.2d — E2E Quality Deep Final Fixes (2026-02-13)

**Skóre:** 34/36 (94% peak), ~33/36 (92% avg)

- CRE: `/hledám/i` přidáno do SEARCH_PATTERNS
- CRE: ITEM_LOOKUP pattern pro "hledám + typ nemovitosti/zboží" (bez čísla)
- Search sanitizer: odstraněn "kurz" z německých stop words (CZ "kurz" = směnný kurz)
- FACTUAL_NUMERIC: instrukce pro přibližné odhady z tréninkových dat
- SK→CZ: +20 nových párů (pre→pro, čo→co, aspoň→alespoň, uistite→ujistěte, ...)
- Test: opraveny isSlovak false positives (takže, každý → validní CZ)
- Test: rozšířeny validátory (počasí, motorky, developer koncepty, EUR/CZK)

## v62.2c — Language Enforcement Hardening (2026-02-13)

**Skóre:** 32/36 (89%), z 26/36 (72%)

- Hard language gate: mechanický SK→CZ překlad (50+ regex párů, 0ms)
- EN detekce: EN_THRESHOLD 3→2, diacritics ratio 0.6→0.4
- Language instrukce na PRVNÍ pozici v synthesis system promptu
- Source URL extraction: fallback na všechny toolResults
- ITEM_LOOKUP: přidán chybějící searchSubType='CLASSIFIED'
- Synthesis MAX_RETRIES 2→1 (úspora ~30s/request)
- Test timeout 90s→150s pro local LLM

## v63.0 — Merge Engine v2 (2026-02-13)

- Multi-expertise prompt composition
- Merge→enforcement integration test

## v62.2 — IDE V4 + SEARCH Sub-types (2026-02-12)

- IDE: sidebar collapse, split bottom panel, live backend data, card actions
- SEARCH sub-type system: NEWS/SPEC/COMPARISON/FACTUAL_NUMERIC/PERSON/CLASSIFIED
- Syntax-only output gates (check structure, not semantics)

---

# C3 v56.2 — Sprint A + B + C1 + C2 + D + Hotfix (COMPLETE)
## All 13 Issues Fixed + 2 Runtime Bugs + Multilingual i18n

### Verze: 56.2.1
### Datum: 2026-02-07

---

## Souhrn

8 souborů, **13/13 fixů + 2 hotfixy**, 228 testů, 0 failures.

| Sprint | Soubory | Fixes | Testy |
|--------|---------|-------|-------|
| A | cre-decision.js | #3, #4, #5 | 52+18 |
| B | tool-executor.js, web-search.js, search-metrics.js | #1, #6, #7, #10 | 23+15 |
| C1 | controller.js, decisions.js | #2A/C, #12 | 29 |
| C2 | synthesis.js, decisions.js, tool-executor.js | #2B, #11, #9 | 13 |
| D | project.js | #8 | 17 |
| Hotfix | tool-executor.js, cre-decision.js | BUG1, BUG2 | 11 |
| i18n | all pattern files | SK,DE,PL,FR,ES | 76 |

---

## Sprint A — CRE Routing Fixes

**Soubor:** `src/chat/cre-decision.js` (+137 lines)

- **#3** KNOWLEDGE_PATTERNS: "Řekni mi o X" → SEARCH (was AMBIGUOUS)
- **#4** SELF_REFERENCE_PATTERNS: "Jak se jmenuju?" → CONVERSATIONAL (was SEARCH)
- **#5** STATEMENT_PATTERNS: "Moje jméno je X" → CONVERSATIONAL (was AMBIGUOUS)
- **#4b** Two-tier catch-all: "Proč?" → AMBIGUOUS (was SEARCH)
- Czech diacritics: `\b` → `(?:^|\s)..(?:\s|[?!.,;]|$)`

## Sprint B — Search Quality

**`src/executor/tool-executor.js`** (+116 lines)
- **#1** `sanitizeSearchQuery()` — strips instructions, dedupes, truncates
- **#6** Per-session circuit breaker: `toolType:sessionId`
- **#9** SandboxPath isolation: `clearProjectContext()` when no project *(moved from C2)*

**`src/llm/web-search.js`** (+27 lines)
- **#7** FAIL_COOLDOWN 5min→60s, SearX parallel `Promise.any()`, DDG-first

**`src/chat/handlers/utils/search-metrics.js`** (+4 lines)
- **#10** Snippet threshold 80→50, +17 Czech instructional STOP_WORDS

## Sprint C1 — Context Pipeline (Routing)

**`src/chat/controller.js`** (+62 lines)
- **#12** `#addToHistory` stores `{userInput, response}` pairs
- `#extractTurnTopic()` extracts topic, `lastTurnTopic` passed to handlers

**`src/chat/handlers/decisions.js`** (+153 lines)
- **#2A/C** `enrichSearchQuery()` — follow-up queries get topic prepended
- `hasOwnSubject()` — skip enrichment when input has proper noun
- All `toolExecutor.execute()` search calls use `effectiveQuery`

## Sprint C2 — Context Pipeline (Quality)

**`src/chat/handlers/utils/synthesis.js`** (+16 lines)
- **#11** `buildSynthesisPrompt` accepts `conversationContext` parameter
- `synthesizeWithLLM` passes context to prompt builder
- LLM sees last 3 turns (user+assistant) for pronoun resolution

**`src/chat/handlers/decisions.js`** (included in C1 count)
- **#11** `buildConversationContext()` transforms history for synthesis
- All 4 `synthesizeWithLLM()` calls pass `conversationContext`

**`src/executor/tool-executor.js`** (included in B count)
- **#9** `clearProjectContext()` when no project in context

---

## Instalace

Nahradit 8 souborů v `~/Projects/c3-agent-wip/`:
```
src/chat/cre-decision.js                      # Sprint A
src/chat/controller.js                         # Sprint C1
src/chat/handlers/decisions.js                 # Sprint C1+C2
src/chat/handlers/project.js                   # Sprint D
src/chat/handlers/utils/synthesis.js           # Sprint C2
src/chat/handlers/utils/search-metrics.js      # Sprint B
src/executor/tool-executor.js                  # Sprint B+C2
src/llm/web-search.js                          # Sprint B
```

Spustit: `node src/test/chat-integration.js`

---

## Sprint D — Project Mode (#8)

**Soubor:** `src/chat/handlers/project.js` (+130 lines)

- **#8** `PROJECT_SELF_PATTERNS` — detects "Jaký je stav projektu?" etc.
- `isProjectSelfQuery()` — checked BEFORE CRE routing
- `buildProjectStatusResponse()` — assembles response from working memory
- No web search, no LLM call — pure data assembly
- "Najdi článek o X" v project mode → NOT intercepted → CRE → web search ✓

---

## Hotfix — Runtime Bugs from Integration Tests

**BUG 1 (critical):** `sanitizeSearchQuery` result was overridden by `...context` spread.
- `handler({ query: effectiveQuery, ...context })` → `context.query` overwrites sanitized query
- **Fix:** `handler({ ...context, query: effectiveQuery })` — sanitized MUST be LAST
- Also: double-pass instruction removal for consecutive words

**BUG 2 (pre-existing):** "Jaká je populace Prahy?" → ASK_USER instead of SEARCH.
- `\b` doesn't work with Czech inflected forms (`jaká` ≠ `jak` + boundary)
- **Fix:** Added `jak[áéý] je/jsou` to Tier 1 with `(?:^|\s)` boundaries

---

## i18n — Multilingual Pattern Expansion (CZ + SK + DE + PL + FR + ES + EN)

**Root cause:** All patterns used CZ+EN only. JS `\b` fails with Unicode chars (č, ľ, ó, ñ, é, ł).

**8 pattern areas expanded:**
1. **Tier 1 compound** — "Čo je?" (SK), "Was ist?" (DE), "Co to jest?" (PL), "Qu'est-ce que?" (FR), "Qué es?" (ES)
2. **Tier 2 question words** — jak/čo/was/co/que/qué/how + inflections
3. **SELF_REFERENCE_PATTERNS** — "Ako sa volám?" (SK), "Wie heiße ich?" (DE), etc.
4. **STATEMENT_PATTERNS** — "Volám sa Bob" (SK), "Ich heiße Alice" (DE), etc.
5. **KNOWLEDGE_PATTERNS** — "Povedz mi o..." (SK), "Erzähl mir von..." (DE), etc.
6. **FOLLOW_UP_INDICATORS** — "A čo?" (SK), "Und was?" (DE), "Et que?" (FR), etc.
7. **sanitizeSearchQuery INSTRUCTION_WORDS** — "antworte/kurz/bitte" (DE), "proszę" (PL), etc.
8. **STOP_WORDS in search-metrics** — full multilingual stop word set

**Critical fix:** All non-ASCII patterns use `(?:^|\s)...\s` instead of `\b`.

---

## Kompletní test suite

```
tests/test-sprint-a.js       52 pattern + 18 ordering = 70 testů
tests/test-sprint-b.js       23 testů (sanitize, breaker, metrics)
tests/test-sprint-c1.js      29 testů (enrich, topic, integration)
tests/test-sprint-c2.js      13 testů (context, prompt, sandbox)
tests/test-sprint-d.js       17 testů (intercept, response)
tests/test-multilingual.js   76 testů (CZ,SK,DE,PL,FR,ES,EN × 6 areas)
                              ─────────
                              228 testů, 0 failures
```

---

## Celkový dopad na pipeline

### PŘED v56.2:
```
User: "Řekni mi o Pythagorovi"     → AMBIGUOUS → first-turn override → no search
User: "A co jeho teorém?"           → SEARCH "A co jeho teorém?" → irrelevant results
User: "Jak se jmenuju?"             → SEARCH → web search for name
User: "Kdo byl Pythagoras? Stručně" → DDG receives "Kdo byl Pythagoras? Odpověz stručně."
Long input → circuit breaker OPEN → ALL sessions blocked 60s
SearX cascade → 5min cooldown → only DDG
```

### PO v56.2:
```
User: "Řekni mi o Pythagorovi"     → SEARCH (KNOWLEDGE_PATTERNS) → web search
User: "A co jeho teorém?"           → SEARCH "Pythagorovi co teorém?" → relevant results
      → synthesis LLM sees: "Previous: User asked about Pythagoras"
User: "Jak se jmenuju?"             → CONVERSATIONAL (SELF_REFERENCE) → no search
User: "Kdo byl Pythagoras? Stručně" → DDG receives "Kdo byl Pythagoras?"
Long input → circuit breaker OPEN → ONLY that session blocked 30s
SearX cascade → 60s cooldown + parallel → faster recovery
```
