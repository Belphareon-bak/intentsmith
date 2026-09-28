# Inventura #5 — Quality Gate v2

**Pořadí 6** · **2026-08-02** · `17a8b9a8` · 10 souborů, **2 890 řádků**

| Soubor | Ř. |
|---|---:|
| `drift-guard.js` | 391 |
| `quality-gate-v2.js` | 368 |
| `response-scorer.js` | 359 |
| `source-trust.js` | 342 |
| `creative-depth.js` | 339 |
| ostatní (5) | 1 091 |

**Testy:** 24 sad — `offline` 9, `model` 11, `database` 2, `server` 1, `manual` 1. `lastGreen: 0`.

## Dobré, použije se
- **QGv2 je deterministický a bez LLM** (invariant L0-5) — 4 vrstvy, idempotentní. Testovatelné bez Ollamy, na rozdíl od CRE.
- **`drift-guard.js` (391 ř.)** — detekce jazykového driftu, Jaccard + délka + intent lock.
- **`source-trust.js`** — hodnocení důvěryhodnosti zdrojů odděleně od scoringu.
- **`response-scorer.js`** — 5D skóre jako číslo, hotový vstup pro L3.
- **`creative-depth.js`** — samostatná heuristika pro kreativní obsah, kde běžné metriky kvality nedávají smysl.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **Q-1** | 11 z 24 sad je profil `model`. QGv2 je přitom deterministický — proč potřebuje Ollamu? Pravděpodobně sady testují QGv2 nad reálnými výstupy modelu. | Oddělit deterministické testy QGv2 od testů „kvalita reálné odpovědi"? První patří do základu, druhé je jiná úloha. |
| **Q-2** | `source-trust.js` (342 ř.) hodnotí zdroje z web searche, který je v #3. | Patří k QGv2, nebo k web searchi (`G-1`)? |
