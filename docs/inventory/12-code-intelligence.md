# Inventura #12 — Code Intelligence

**Pořadí 13** · **2026-08-02** · `17a8b9a8` · 33 souborů, **11 634 řádků**

| Soubor | Ř. |
|---|---:|
| `knowledge-graph.js` | 751 |
| `context-builder.js` | 599 |
| `debug-agent.js` | 508 |
| `concept-registry.js` | 479 |
| `dependency-manager.js` | 444 |
| `perf-analyzer.js` | 438 |
| `code-search.js` | 420 |
| ostatní (26) | 7 995 |

**Testy:** 17 sad — **`offline` 13**, `model` 4. `lastGreen: 0`.
Nejlepší deterministické pokrytí ze všech velkých schopností.

## Dobré, použije se
- **Knowledge graph s 9 typy hran** a limity 50K/100K — graf má strop, neroste donekonečna.
- **Multi-engine search s degradací** — ripgrep → grep → Node.js. Funguje i tam, kde `rg` není.
- **`context-engine`** — symbol-aware komprese, deklarovaná úspora ~70 %.
- **BFS expanze s hub penalty a namespace boostem** — graf se prochází s heuristikou proti uzlům, na které vede všechno.
- **13 z 17 sad `offline`** — schopnost je z velké části ověřitelná bez modelu i bez GPU.
- **`impact-analyzer` + `drift-detector`** — dopad změny a porušení vrstev jako spočítaná věc.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **CI-1** | **`debug-agent.js` (508 ř.)** je agent uvnitř code intelligence, zatímco agenti (#14) jsou mimo základ a execution loop je #11. | Kam patří? Popáté týž vzor. |
| **CI-2** | **`perf-analyzer.js` (438 ř.)** — analýza výkonu analyzovaného kódu, nebo výkonu C3 samotného? Z názvu to nepoznám. | Zjistit a zařadit. |
| **CI-3** | **33 souborů, 11 634 řádků, žádný dominantní soubor** — nejrovnoměrněji rozložená schopnost projektu. | Není otázka, je to pozorování: tenhle modul vypadá architektonicky nejzdravěji. Stojí za to podívat se, proč — může to být vzor pro rozdělení ostatních. |
