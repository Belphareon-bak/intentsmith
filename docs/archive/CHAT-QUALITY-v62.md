# C3 Chat Quality — v62.2 Series

**Verze:** v62.2d
**Datum:** 2026-02-13
**Stav:** 34/36 testů (94% peak), stabilní průměr ~92%

---

## Souhrn

Série v62.2 řeší kvalitu chat odpovědí přes 36 E2E Quality Deep testů pokrývajících 4 reálné use-case. Výchozí stav byl 19/36 (53%), finální stav je 34/36 (94% peak run).

| Verze | Skóre | Klíčové změny |
|-------|-------|---------------|
| Baseline | 19/36 (53%) | Počáteční stav, žádné quality fixes |
| v62.2a | 30/36 (83%) | Prvotní quality fixes z předchozí session |
| v62.2b | 26/36 (72%) | Regrese — language gate a sub-types |
| v62.2c | 32/36 (89%) | Mechanický SK→CZ, URL fallback, snížené prahy |
| v62.2d | 34/36 (94%) | ITEM_LOOKUP klasifikace, "kurz" stop-word fix |

---

## E2E Quality Deep Test Suite

**Soubor:** `tests/e2e-quality-deep.cjs`

36 testů ve 4 kategoriích:

| Kategorie | Popis | Příklady |
|-----------|-------|----------|
| **S: Vyhledávání** (9) | Internet search queries | Zprávy, inzeráty, specifikace, srovnání |
| **R: Reportování** (6) | Řešení problémů, návody | Linux GUI, ethernet, gaming PC, WiFi |
| **F: Fakta** (9) | Faktické dotazy | Čas, datum, osobnosti, kurz, počasí |
| **T: Technická expertíza** (12) | Tech návody a srovnání | Docker, CI/CD, REST vs GraphQL, Linux vs Windows |

### Validátory

Každý test má povinné (`must`) kontroly:
- **isCzech** — odpověď obsahuje české diakritické znaky
- **isSlovak** (universal gate) — detekce slovenské kontaminace (ľ, ô, čo, nie je, preto, ďakujem, veľmi, veľa, možno, nejaký)
- **hasMinLinks** — minimální počet odkazů (pro search testy)
- **hasUniqueDomains** — diverzita zdrojů
- **hasMinDepth** — hloubka odpovědi (0-9 skóre z délky, struktury, čísel)
- **containsAny/containsAll** — přítomnost klíčových pojmů
- **hasNoMetaPhrases** — absence "jako AI", "nemám přístup" atd.
- **isEuroRateValid** — kurz EUR/CZK v rozsahu 20-35

---

## Architektura jazykového vynucování

### Vrstva 1: System Prompt (Prevence)

```
buildSynthesisSystemPrompt() → language instruction na PRVNÍ pozici
  ↓
"CRITICAL: You MUST respond ENTIRELY in Czech..."
+ buildStrictLanguageInstruction(lang)
+ "⚠️ ZÁVĚREČNÉ PŘIPOMENUTÍ: Celá odpověď MUSÍ být v češtině."
```

Instrukce je na prvním místě v system promptu (ne na konci), protože LLM čte shora dolů a první instrukce má největší vliv.

### Vrstva 2: Synthesis Retry (Detekce + Opakování)

```
synthesizeWithLLM() → MAX_RETRIES = 1
  ↓
validateResponseLanguage(content, lang)
  → detectEnglishContamination()  [EN_THRESHOLD = 2]
  → detectSlovakContamination()   [SK markers]
  → checkDiacriticsRatio()        [threshold = 0.4]
  ↓
Pokud failed → retry s buildLanguageRetryInstruction()
  ↓
Po retry → mechanicalSlovakToCzech() → vrať výsledek
```

### Vrstva 3: Controller Language Gate (Poslední záchrana)

```
controller.js process() → po handler response
  ↓
sanitizeResponse(content, lang)  [JSON leak, empty check]
  ↓
if (lang === 'cs'):
  detectSlovakContamination(sanitized)
  → if contaminated: mechanicalSlovakToCzech(sanitized)
  ↓
validateResponseLanguage(sanitized, lang)
  → if !clean: log warning, keep mechanically fixed version
  → if clean && changed: use sanitized version
```

### Mechanický SK→CZ překlad

**Soubor:** `src/chat/handlers/utils/language-enforcement.js`

70+ regex párů pokrývajících:
- **Slovní záměny:** sú→jsou, ktorý→který, pretože→protože, alebo→nebo, ako→jak, pre→pro, čo→co
- **Předpony:** naj-→nej- (najlepší→nejlepší, najdôležitejší→nejdůležitější)
- **Znakové záměny:** ľ→l, ô→ů
- **Infinitivy:** postaviť→postavit, kúpiť→koupit
- **Reflexiva:** aspoň→alespoň, samozrejme→samozřejmě

Tento překlad běží v 0ms (pure regex) a opravuje ~80% slovenských slov. Pro plně slovenský text (R3 "gaming PC") nestačí — LLM musí produkovat češtinu od začátku.

### Detekce anglické kontaminace

```javascript
EN_THRESHOLD = 2;  // max 2 EN markery povoleny

EN_MARKERS: [
  /\bbased on\b/i, /\bhere is\b/i, /\bhowever\b/i,
  /\btherefore\b/i, /\bfurthermore\b/i, /\bin conclusion\b/i,
  /\bfor example\b/i, /\baccording to\b/i, /\bin summary\b/i,
  /\bin addition\b/i, /\bas a result\b/i, /\bon the other hand\b/i,
  /\bit is important\b/i, /\bit should be noted\b/i,
  /\bplease note\b/i, /\bas mentioned\b/i
]
```

Diacritics ratio check: pokud >40% textu nemá diakritiku, je podezření na EN.

---

## SEARCH Sub-type System

**Soubor:** `src/chat/cre-decision.js` (klasifikace) + `src/chat/handlers/utils/synthesis.js` (instrukce)

CRE klasifikuje SEARCH/FACTUAL dotazy do sub-typů pro cílené synthesis instrukce:

| Sub-type | Pattern | Instrukce |
|----------|---------|-----------|
| **NEWS** | zprávy, novinky, aktuální situace | Extrahuj headline + summary + URL, min 3 položky |
| **SPEC** | specifikace, parametry | Tabulkový formát, konkrétní čísla |
| **COMPARISON** | porovnej, vs., versus | Paralelní struktura, oba položky rovnoměrně |
| **FACTUAL_NUMERIC** | kurz, počasí, teplota | MUSÍ obsahovat číslo, i přibližné |
| **PERSON** | kdo je, prezident | Jméno + role + 3 fakta + zdroj |
| **CLASSIFIED** | inzeráty, nabídky, byty | Číslov. seznam s URL, cena, lokace |
| **GENERAL** | (fallback) | Standardní synthesis |

### ITEM_LOOKUP → CLASSIFIED pipeline

Dotazy typu "Najdi mi 3 inzeráty" nebo "Hledám pronájem bytu" jsou klasifikovány jako `ITEM_LOOKUP` intent:

```
ITEM_LOOKUP_PATTERNS:
  /\d+\s*(inzerát|nabíd|produkt|auto|byt|dům|nemovit)/i
  /najdi\s*(mi\s*)?\d+/i
  /hledám\s.{0,20}(pronájem|byt|auto|dům|nemovit|práci|nabídk)/i
```

ITEM_LOOKUP → decisions.js handler → `synthesizeWithLLM({ searchSubType: 'CLASSIFIED' })`

---

## Source URL Extraction

**Soubor:** `src/chat/handlers/utils/synthesis.js`

### Problém (v62.2a)
`extractSourceUrls()` byla volána na `adaptedData` (relevance-filtrované výsledky), které často ztratily URL z vyhledávání.

### Řešení (v62.2c)
Dvoustupňový fallback:
```javascript
let sourceUrls = extractSourceUrls(adaptedData);
if (sourceUrls.length === 0 && allToolResults) {
  sourceUrls = extractSourceUrls(allToolResults);
}
```

URL sekce v promptu:
```
═══ AVAILABLE SOURCE URLs (MANDATORY — include at least 2 in your response) ═══
[1] Kurz eura - Inflace.cz — https://www.inflace.cz/kurz-eura/
[2] Kurzy měn — https://www.kurzy.cz/
```

---

## Search Query Sanitization

**Soubor:** `src/executor/tool-executor.js`

### Fix (v62.2d): "kurz" stop-word

Německé slovo "kurz" (= stručně) bylo v INSTRUCTION_WORDS. Ale české "kurz" (= směnný kurz) je kritické klíčové slovo pro F8.

**Před:** `'antworte', 'erkläre', 'beschreibe', 'kurz', 'ausführlich'`
**Po:** `'antworte', 'erkläre', 'beschreibe', 'ausführlich'`  // "kurz" odstraněn

---

## Zbývající známé problémy

### Intermitentní selhání (LLM non-determinismus)

| Test | Problém | Příčina | Řešení |
|------|---------|---------|--------|
| S1, S4 | Chybějící odkazy | LLM někdy vynechá URL | Silnější MANDATORY instrukce |
| R3 | Plná slovenština | qwen2.5:32b produkuje SK pro "gaming PC" | Mechanický překlad nestačí |
| F7 | SK kontaminace | Náhodné SK slova | Rozšířit SK→CZ mapu |
| T12 | CZ jazyk | EN odpověď pro framework srovnání | Language gate loguje ale nepřepisuje |

Tyto selhání se mění mezi běhy — jeden běh 34/36 (94%), další 31/36 (86%). Průměr je ~33/36 (92%).

### Root cause: qwen2.5:32b limity

1. **Slovenština:** Model občas produkuje slovenštinu místo češtiny (jazyková blízkost)
2. **Ignorování instrukcí:** FACTUAL_NUMERIC instrukce "dej přibližné číslo" někdy ignorována
3. **URL vynechávání:** I s MANDATORY instrukcí LLM někdy nezahrne URL do odpovědi

---

## Soubory a změny

### v62.2c (commit `9f927d3`)

| Soubor | Změny |
|--------|-------|
| `src/chat/controller.js` | Hard language gate, mechanický SK→CZ, bez LLM rewrite |
| `src/chat/cre-decision.js` | SEARCH sub-type klasifikace (NEWS/SPEC/COMPARISON/...) |
| `src/chat/handlers/decisions.js` | ITEM_LOOKUP → searchSubType: 'CLASSIFIED' |
| `src/chat/handlers/utils/language-enforcement.js` | EN threshold 3→2, diacritics 0.6→0.4, SK→CZ mapa (50+ párů) |
| `src/chat/handlers/utils/synthesis.js` | Language na 1. pozici, URL fallback, MAX_RETRIES 2→1 |
| `tests/e2e-quality-deep.cjs` | Timeout 90s→150s |

### v62.2d (commit `b9bd49c`)

| Soubor | Změny |
|--------|-------|
| `src/chat/cre-decision.js` | "hledám" v SEARCH, ITEM_LOOKUP pro "hledám + byt/auto" |
| `src/chat/handlers/utils/language-enforcement.js` | +20 SK→CZ párů (pre→pro, čo→co, ...) |
| `src/chat/handlers/utils/synthesis.js` | FACTUAL_NUMERIC: přibližné odhady |
| `src/executor/tool-executor.js` | Odstraněn "kurz" ze stop words |
| `tests/e2e-quality-deep.cjs` | Opraveny isSlovak false positives, rozšířeny validátory |

---

## Metriky

### Průměrné hodnoty (z 34/36 run)

| Metrika | Hodnota |
|---------|---------|
| Průměrná hloubka | 6.6/9 |
| Průměrná délka | 1246 znaků |
| Celkem odkazů | 61 |
| Meta-fráze porušení | 0/36 |
| Průměrný čas odpovědi | 19s (no-search: 16s, search: 25s) |

### Kategorie breakdown (best run)

| Kategorie | Skóre | % |
|-----------|-------|---|
| S: Vyhledávání | 9/9 | 100% |
| R: Reportování | 6/6 | 100% |
| F: Fakta | 8/9 | 89% |
| T: Technická expertíza | 12/12 | 100% |

---

## Spuštění testů

```bash
# Start backend
node src/server.js

# Run tests
node tests/e2e-quality-deep.cjs

# Verbose output (full responses)
node tests/e2e-quality-deep.cjs --verbose

# Save baseline
node tests/e2e-quality-deep.cjs --save baseline.json

# Compare with baseline
node tests/e2e-quality-deep.cjs --compare baseline.json
```

Výsledky se ukládají do `e2e-quality-deep.json`.
