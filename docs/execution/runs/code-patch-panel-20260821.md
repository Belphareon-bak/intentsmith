# Doklad: co sada `code_patch` měří — 2026-08-21

**Příkaz:** `node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest qwen2.5:32b qwen3.5:27b qwen3:14b --json …`
**Rozsah:** 5 modelů × 3 opakování × 7 úloh = 105 běhů · **doba:** 47,1 min
**Prostředí:** RTX 3090 24 GB, Ollama 0.32.14

Vyhodnocení a výhrady: [`EVAL-CODE-SUITE.md`](../../EVAL-CODE-SUITE.md), oddíl 7.

> Nahrazuje měření z 2026-08-20, které běželo s binárním hodnocením celého
> souboru a s vadou v mlčícím režimu (částečný pád běhu dostával plné skóre).
> Tehdejší čísla neplatí.

## Surový výstup

```
═══ PŘÍNOS PROTI NEČINNOSTI — sada code_patch ═══

úloha             qwen2.5-code…qwen3-coder:…  qwen2.5:32b  qwen3.5:27b    qwen3:14b      šum  zařazení
─────────────────────────────────────────────────────────────────────────────────────────────────────────
patch_d8a2aa05             0.00         0.00         0.00         0.00         0.00     0.00  podlaha
patch_cfcb63dd             0.00         0.00         0.00         0.00         0.00     0.00  podlaha
patch_da03e8bd             1.00         0.00         0.00         1.00         0.00     0.00  rozlišuje
patch_723d5726             0.00         0.00         0.00         0.00         0.00     0.00  podlaha
patch_a33cc20a             0.33         0.33         0.33         0.00         0.00     0.00  rozlišuje
patch_286a9117             0.00         0.00         0.00         0.00         0.00     0.00  podlaha
patch_06d49847             0.00         0.00         0.00         0.00         0.00     0.00  podlaha
─────────────────────────────────────────────────────────────────────────────────────────────────────────
průměr                     0.19         0.05         0.05         0.14         0.00

═══ POŘADÍ ═══
  0.190  qwen2.5-coder:32b
  0.143  qwen3.5:27b
  0.048  qwen3-coder:latest
  0.048  qwen2.5:32b
  0.000  qwen3:14b

═══ CO SADA MĚŘÍ ═══
  rozlišuje: 2/7 · podlaha: 5
  rozptyl mezi modely: 0.190 · šum metriky: 0.000

VERDIKT: sada ✅ ROZLIŠUJE, informaci nese 2 z 7 úloh

── dvojice ──
  qwen2.5-coder:32b vs qwen3-coder:latest: 1/7 úloh, marže 1
  qwen2.5-coder:32b vs qwen2.5:32b: 1/7 úloh, marže 1
  qwen2.5-coder:32b vs qwen3.5:27b: 1/7 úloh, marže 0.3333
  qwen2.5-coder:32b vs qwen3:14b: 2/7 úloh, marže 0.6667
  qwen3-coder:latest vs qwen2.5:32b: 0/7 úloh, marže 0  (nerozhodně)
  qwen3-coder:latest vs qwen3.5:27b: 2/7 úloh, marže -0.3333
  qwen3-coder:latest vs qwen3:14b: 1/7 úloh, marže 0.3333
  qwen2.5:32b vs qwen3.5:27b: 2/7 úloh, marže -0.3333
  qwen2.5:32b vs qwen3:14b: 1/7 úloh, marže 0.3333
  qwen3.5:27b vs qwen3:14b: 1/7 úloh, marže 1


celkem 47.1 min
```
