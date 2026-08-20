# Doklad rozlišení sady `code_patch` — 2026-08-20

**Příkaz:** `node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest qwen3:14b`
**Rozsah:** 3 modely × 3 opakování × 6 úloh = 54 běhů · **doba:** 27,8 min
**Prostředí:** RTX 3090 24 GB, Ollama 0.32.14

Vyhodnocení a výhrady: [`EVAL-CODE-SUITE.md`](../../EVAL-CODE-SUITE.md), oddíl 8.

## Závěr

| model | pass_rate |
|---|---|
| `qwen2.5-coder:32b` | **0,167** (1/6) |
| `qwen3-coder:latest` | 0,000 |
| `qwen3:14b` | 0,000 |

Rozptyl 0,167 > šum metriky 0,000 → sada **rozlišuje**. Nese to ale jediná
úloha (`patch_da03e8bd`); `qwen3-coder` a `qwen3:14b` sada neodliší.

## Surový výstup

```

── qwen2.5-coder:32b vs qwen3-coder:latest ──

── qwen2.5-coder:32b vs qwen3:14b ──

── qwen3-coder:latest vs qwen3:14b ──
   rozlišujících úloh: 0/6, marže 0

═══ SKÓRE SADY code_patch ═══
  0.167  qwen2.5-coder:32b
  0.000  qwen3-coder:latest
  0.000  qwen3:14b

rozptyl nejlepší−nejhorší : 0.167
šum metriky (max kolísání téže úlohy): 0.000 → na úrovni sady 0.000
průměrné kolísání: 0.000

VERDIKT: sada ✅ ROZLIŠUJE (rozptyl 0.167 > práh 0.050)

── dvojice ──
  qwen2.5-coder:32b vs qwen3-coder:latest: rozlišuje 1/6 úloh, marže 1
      patch_d8a2aa05  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_cfcb63dd  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_da03e8bd  1.00 vs 0.00  Δ1.00 šum 0.00  ← rozlišuje
      patch_723d5726  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_a33cc20a  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_286a9117  0.00 vs 0.00  Δ0.00 šum 0.00
  qwen2.5-coder:32b vs qwen3:14b: rozlišuje 1/6 úloh, marže 1
      patch_d8a2aa05  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_cfcb63dd  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_da03e8bd  1.00 vs 0.00  Δ1.00 šum 0.00  ← rozlišuje
      patch_723d5726  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_a33cc20a  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_286a9117  0.00 vs 0.00  Δ0.00 šum 0.00
  qwen3-coder:latest vs qwen3:14b: rozlišuje 0/6 úloh, marže 0  (nerozhodně)
      patch_d8a2aa05  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_cfcb63dd  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_da03e8bd  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_723d5726  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_a33cc20a  0.00 vs 0.00  Δ0.00 šum 0.00
      patch_286a9117  0.00 vs 0.00  Δ0.00 šum 0.00

celkem 27.8 min
```
