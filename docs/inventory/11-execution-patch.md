# Inventura #11 — Execution engine a patch

**Pořadí 14** · **2026-08-02** · `17a8b9a8` · **~6 900 řádků ve třech adresářích**

| Soubor | Ř. | Adresář |
|---|---:|---|
| `tool-executor.js` | 1 536 | `src/executor/` |
| `c3-tool-executor.js` | 699 | `src/executor/` |
| `circuit-breaker.js` | 345 | `src/executor/` |
| `health-monitor.js` | 342 | `src/executor/` |
| `query-canonicalizer.js` | 242 | `src/executor/` |
| `patch-parser.js` | 351 | `src/patch/` |
| `patch-validator.js` | 338 | `src/patch/` |
| `patch-engine.js` | 298 | `src/patch/` |
| `patch-applier.js` | 291 | `src/patch/` |
| **`execution-loop.js`** | **968** | **`src/planner/`** |
| **`error-normalizer.js`** | **483** | **`src/planner/`** |

**Testy:** 10 sad — `offline` 8, `model` 1, `server` 1. `lastGreen: 0`.

## Dobré, použije se
- **Patch engine: 3-tier anchor** (exact → normalized → AST), bottom-up splice, atomický `tmp+rename`, plný rollback (invariant L0-6). Rozdělený do 4 souborů po ~300 řádcích — parser, validator, applier, engine. **Nejčistěji rozdělená část projektu.**
- **`circuit-breaker.js`** — nástroj, který opakovaně selhává, se odpojí. Ne každý systém tohle má.
- **`error-normalizer.js`** — 14 kódů chyb, root cause analýza. Chyba je datový typ, ne string.
- **Execution loop max 8 iterací** (invariant L0-7) se strategiemi `DETERMINISTIC → HEURISTIC → LLM_FULL → SKIP`. Strop je v invariantu, ne v naději.
- **`scope-limiter`** — patch smí sáhnout jen na cíl + 1-hop KG závislosti.
- **8 z 10 sad `offline`**.

## Zbytečné
Nic prokazatelného.

## Nejasné
| # | Zjištění | Otázka |
|---|---|---|
| **X-1** | **Schopnost je rozprostřená přes tři adresáře** — `executor/`, `patch/` a část `planner/`. `execution-loop.js` (968 ř.) a `error-normalizer.js` (483 ř.) jsou fyzicky v planneru (#10). | Sjednotit adresáře podle schopností, nebo přijmout, že hranice schopností a adresářů se neshodují? **Týká se i #13.** |
| **X-2** | **Dva executory** — `tool-executor.js` (1 536 ř.) a `c3-tool-executor.js` (699 ř.). | Jaký je mezi nimi vztah? Vypadá to na starou a novou cestu vedle sebe. |
| **X-3** | **`tool-executor.js` importuje `web-search.js`** z `src/llm/` (viz `G-1`). | Potvrzuje, že web search patří spíš sem nebo k nástrojům než k LLM gateway. |
