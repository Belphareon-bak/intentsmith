# Inventura #10 — Project lifecycle

**Pořadí 15** · **2026-08-02** · `17a8b9a8` · 36 souborů, **16 611 řádků**
**Druhá největší schopnost.**

| Soubor | Ř. |
|---|---:|
| `lifecycle-build.js` | 2 138 |
| `workflow.js` | 1 082 |
| `execution-loop.js` | 968 *(patří #11)* |
| `quality-score.js` | 762 |
| `lifecycle-planning.js` | 758 |
| `lifecycle-prompts.js` | 682 |
| `architecture-guardian.js` | 658 *(patří #13)* |
| `quality-gate.js` | 624 |
| `error-normalizer.js` | 483 *(patří #11)* |
| ostatní (27) | 8 456 |

**Testy:** **47 sad** — nejvíc ze všech schopností. `database` 19, `model` 19, `offline` 7, `server` 2. `lastGreen: 0`.

## Dobré, použije se
- **Stavový automat SPEC → BUILD → REVIEW → CHANGE → COMPLETED** — lifecycle je explicitní stav v DB, ne implicitní stav v paměti.
- **Checkpoint módy** `STRUCTURAL` / `FUNCTIONAL` / `SECURITY` — různé milníky se ověřují různě.
- **Crash recovery + milestone mutex (RAM+DB)** — přežije pád, nespustí tentýž milník dvakrát.
- **Spec drift guard** — hlídá, že se stavěné nerozchází se zadaným.
- **Executor timeout** — milník nemůže běžet donekonečna.
- **19 `database` sad** — velká část je ověřitelná bez modelu, jen proti SQLite.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **L-1** | **`lifecycle-build.js` má 2 138 řádků** — nejdelší soubor projektu po `registry.js` a `cre-decision.js`. | Rozdělit? |
| **L-2** | **2 109 řádků v `src/planner/` patří jiným schopnostem** (`execution-loop`, `architecture-guardian`, `error-normalizer`). | Viz `X-1`. Adresář `planner/` je dnes společný domov tří schopností. |
| **L-3** | **Dvě „quality" v jednom adresáři** — `quality-score.js` (762 ř.) a `quality-gate.js` (624 ř.) v planneru, plus celá schopnost #5 v `src/chat/quality/` (2 890 ř.). | Tři různé věci jménem quality. Jaký je mezi nimi vztah? |
| **L-4** | **19 sad je `model`** — velká část lifecycle jde ověřit jen s Ollamou a GPU. | Stejná otázka jako `C-2`: co z toho jde odtrhnout od modelu? |
