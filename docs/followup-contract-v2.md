# Follow-up Contract v2 — Context-oriented redesign

## Princip

Follow-up odpovídá na otázku:

> Odkazuje aktuální vstup na poslední výstup systému?

NE na:

> Sdílí aktuální vstup slova s předchozím vstupem?

## Signatura

```
detectFollowUpType(currentInput, lastDecision) → FollowUpResult
```

- `lastInput` se NEPOUŽÍVÁ jako primární signál
- `lastDecision` = {intent, type, hasOutput} — co systém udělal
- `hasOutput` definice: `true` pokud systém v předchozím turnu vyprodukoval jakýkoli obsah
  - ANSWER s textem → true
  - TOOL_CALL s výsledkem → true
  - Attachment turn kde systém odpověděl ("Soubor přijat" / analýza) → true
  - ASK_USER (systém položil otázku) → true (systém vyprodukoval output)
  - Pouze pokud turn selhal / nebyl dokončen → false
  - **Prakticky: hasOutput = true pro všechny dokončené turny** — zjednodušuje logiku

## 4 pravidla

### R1: Anaforická kontinuace

```
IF   lastDecision.hasOutput === true
AND  input contains anaphoric reference (to/it/this/them/tenhle/tohle/ten/nich)
AND  input.length < 40
THEN → CONTINUATION (confidence: 0.85, reusePreviousData: true)
```

Důvod: Krátký vstup s ukazovacím zájmenem po existujícím výstupu = odkaz na výstup.

Neblokuje se na lastDecision.intent — funguje po CONVERSATIONAL, REPORT, PROJECT, všem.

### R2: Imperativní zpracování po výstupu

```
IF   lastDecision.hasOutput === true
AND  input matches processing request (shrn/summarize/explain/prehled/overview/popis/describe)
AND  input.length < 50
THEN → FORMAT_CHANGE (confidence: 0.9, reusePreviousData: true)
```

Důvod: Uživatel žádá o transformaci existujícího výstupu, ne nová data.

Toto je dnes pokryto FORMAT_CHANGE_PATTERNS — ty zůstávají, jen se odstraní závislost na lexikálním overlapu jako prerekvizitě.

### R3: Explicitní nový cíl

```
IF   input contains explicit topic shift ("teď", "nyní", "změň", "přepni", "něco jiného")
OR   input contains URL pattern (http(s)://)
OR   input contains filename pattern (*.ext)
OR   input.length > 80 AND no anaphoric reference
THEN → NEW_QUERY (confidence: 0.8, reusePreviousData: false)
```

Důvod: Dlouhý vstup bez zájmen + bez odkazu na předchozí kontext = nový dotaz.

Poznámka: Proper noun diff (porovnání s lastOutput) záměrně VYNECHÁNO v první verzi.
Je fuzzy, náchylné na false positives. Přidá se až po datech z produkce.

### R4: Fallback — preferuj kontinuaci

```
IF   lastDecision.hasOutput === true
AND  input.length < 30
AND  none of R1-R3 matched
THEN → CONTINUATION (confidence: 0.5, reusePreviousData: false)

ELSE → NEW_QUERY (confidence: 0.5, reusePreviousData: false)
```

Důvod: Krátký vstup po existujícím výstupu má vyšší apriorní pravděpodobnost kontinuace než nového dotazu. Nízká confidence = decide() má prostor pro override.

## Co se ODSTRANÍ

1. **Lexikální overlap** (lines 120-133 v followup.js) — celý blok `lastWords`/`currentWords`/`sharedWords`
2. **lastIntent !== CONVERSATIONAL** guard (line 112) — blokoval validní continuation po attachment turnech
3. **INTENT_BREAK na "chci"** (cre-decision.js line 2820) — "chci" samotné není topic shift. Pouze "chci + nový cíl" (R3) je break.

## Co ZŮSTANE

1. **FORMAT_CHANGE_PATTERNS** — shrn/zkrať/podrobněji/tabulka — beze změny
2. **REFINEMENT_PATTERNS** — jen/pouze/bez/konkrétně — beze změny
3. **STICKY_INTENTS + overrides v decide()** — L3 logika nezávislá na L2

## Bezpečnostní záruky

1. R3 chrání proti false-positive continuation (uživatel opravdu mění téma)
2. R4 fallback má confidence 0.5 — decide() sticky/break logika ho může override
3. Instrumentace (v73 CRE_DIAG) zůstává — každý decide() call loguje followUp result
4. 25 dialog scénářů slouží jako regresní test

## Očekávaný dopad na test výsledky

| Scénář | Dnes | Po v2 |
|--------|------|-------|
| A1: "co to dela" po 📎 | NEW_QUERY ❌ | R1: CONTINUATION ✅ |
| A2: "shrn to" po 📎 | NEW_QUERY ❌ | R2: FORMAT_CHANGE ✅ |
| A3: "chci vytah" po 📎 | NEW_QUERY ❌ | R4: CONTINUATION ✅ |
| D1: "a co jeste" po REPORT | NEW_QUERY ❌ | R1: CONTINUATION ✅ |
| D3: "vice detailu" po SEARCH | NEW_QUERY ❌ | R2: FORMAT_CHANGE ✅ |
| E1: "kolik je hodin" (topic change) | NEW_QUERY ✅ | R3: NEW_QUERY ✅ |
| E3: "now find restaurants" | NEW_QUERY ✅ | R3: NEW_QUERY ✅ |
| F1: "chci vytah" po REPORT | INTENT_BREAK ❌ | R4: CONTINUATION ✅ |

## Rozsah změn

| Soubor | Změna |
|--------|-------|
| `src/chat/handlers/utils/followup.js` | Přepis detectFollowUpType() — nová signatura + 4 pravidla |
| `src/chat/handlers/decisions.js:228` | Aktualizace volání — předat lastDecision místo sessionState |
| `src/chat/cre-decision.js` ~line 2820 | Odebrat "chci" z INTENT_BREAK_PATTERNS |
| `tests/cre-dialog-scenarios.test.js` | Aktualizace mocků pro novou signaturu |
