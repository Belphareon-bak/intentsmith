# Inventura #13 — Architecture governance

**Pořadí 16** · **2026-08-02** · `17a8b9a8` · **~4 700 řádků ve dvou adresářích**

| Soubor | Ř. | Adresář |
|---|---:|---|
| `orchestrator.js` | 921 | `src/architect/` |
| `editor.js` | 393 | `src/architect/` |
| `git.js` | 348 | `src/architect/` |
| `roadmap.js` | 325 | `src/architect/` |
| `history.js` | 303 | `src/architect/` |
| ostatní (8) | 1 717 | `src/architect/` |
| **`architecture-guardian.js`** | **658** | **`src/planner/`** |

**Testy:** 12 sad — **`offline` 11**, `model` 1. `lastGreen: 0`.

## Dobré, použije se
- **11 z 12 sad `offline`** — nejlepší poměr deterministického pokrytí v projektu.
- **Guardian jako PRE/POST milestone audit** — architektura se kontroluje před i po milníku, ne jen na konci.
- **`api-contract-registry`** — sledování exportů a detekce breaking changes.
- **`critic-agent`** — 6 typů selhání s cílenou opravou, ne obecné „zkus to znovu".
- **`regression-predictor`** — kompozitní riziková formule, číslo místo dojmu.
- **`git.js` (348 ř.)** — governance čte skutečný stav z gitu, ne z tvrzení.
- **Multi-agent pipeline 5 rolí** (planner → builder → architect → critic → debugger).

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **A-1** | **`architecture-guardian.js` (658 ř.) je v `src/planner/`**, ne v `src/architect/`. | Viz `X-1`, `L-2`. Třetí schopnost bydlící v planneru. |
| **A-2** | **`orchestrator.js` (921 ř.) vs. `multi-agent.js`** — obojí orchestruje. | Jeden orchestrátor, nebo dva různé? |
| **A-3** | **`roadmap.js` (325 ř.)** — C3 umí generovat roadmapu analyzovaného projektu. | Zajímavé, ale je to v rozsahu 1.0? |
| **A-4** | **`editor.js` (393 ř.) v governance** — governance má editovat? | Co edituje a proč to není v #11? |
