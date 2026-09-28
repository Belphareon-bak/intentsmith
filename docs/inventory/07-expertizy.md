# Inventura #7 — Expertizy a 5D merge

**Pořadí 9** · **2026-08-02** · `17a8b9a8` · 23 souborů, **9 464 řádků**

| Soubor | Ř. |
|---|---:|
| `expertise-layer.js` | 1 682 |
| `expertise-store.js` | 917 |
| `merge-engine.js` | 573 |
| `specialist-runtime.js` | 572 |
| `scenario-engine.js` | 511 |
| `knowledge-base.js` | 433 |
| `expertise-enforcement.js` | 420 |
| ostatní (16) | 4 356 |

**Testy:** 24 sad — `offline` 12, `model` 9, `database` 1, `server` 1, `manual` 1. `lastGreen: 0`.
**Ověřeno za běhu:** `/api/expertises` vrací **18 expertíz** (dokumentace tvrdí 15).

## Dobré, použije se
- **`merge-engine.js` je čistá funkce** (invariant L0-2) — 15 kroků, frozen výstup, žádné side effects. Půjde otestovat kompletně deterministicky.
- **5D capability vektor** `{reasoning, creativity, determinism, riskTolerance, verbosity}` — kvantifikované chování expertizy, ne prózou.
- **`expertise-enforcement.js` (420 ř.)** — post-response kontrola driftu proti 5D profilu. Vynucuje se, nejen deklaruje.
- **Kompozice max 3** s pairwise kompatibilitou — omezení, ne libovolné skládání.
- **12 `offline` sad** — polovina schopnosti je ověřitelná bez modelu.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **E-1** | **`specialist-runtime.js` (572 ř.), `scenario-engine.js` (511 ř.) a `knowledge-base.js` (433 ř.) leží v `src/expertises/`, ale patří ke specialistům (#8).** 1 516 řádků, 16 % schopnosti. | Specialist platforma + jeden E2E je v 1.0 M3. Hranici řešit extension contractem; samotný přesun souborů nemusí oddělit sdílenou logiku. |
| **E-2** | **`expertise-layer.js` má 1 682 řádků** a drží registry, 18 vestavěných expertíz, auto-select i enforcement pipeline. | Rozdělit? |
| **E-3** | **18 expertíz v běhu vs. 15 v dokumentaci.** Tři přibyly (`sazeni`, `translator`, `code_reviewer` odpovídají specialistům). | Jsou to expertizy, nebo expertizy generované specialisty? Souvisí s `E-1`. |
