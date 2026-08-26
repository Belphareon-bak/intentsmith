# WP-M5-PERF — evidence-bound production budgets

**Typ:** M5 production hardening · **Stav:** `IMPLEMENTATION_GREEN / REVIEW_PENDING`

**Product revision:** `fbca096e82e8b749f213062810c95ea949d41572`

## Uživatelský výsledek

Release už neposuzuje výkon z jednotlivého rychlého běhu nebo z průměru, který
schová pomalý konec distribuce. `M5PerformanceEvidence@1` odděluje raw vzorky,
přesné přijaté baselines a disposition fyzického GPU běhu. Rozhoduje
nearest-rank p95, nulový error budget, minimální počet vzorků, skutečné trvání
soaku a RSS start/peak/end.

Připnuté candidate budgety jsou:

| Plocha | Budget |
|---|---:|
| deterministic HTTP chat | min. 20 vzorků, p95 nejvýše 100 ms, 0 chyb |
| ProjectContext nad 128 soubory | min. 20 vzorků, p95 nejvýše 250 ms, 0 chyb |
| core soak | min. 300 000 ms a 1 000 vzorků, p95 nejvýše 100 ms, 0 chyb |
| server RSS v soaku | peak nejvýše 512 MiB, koncový růst nejvýše 64 MiB |
| modelový chat | cold nejvýše 70 s, warm p95 nejvýše 60 s, 0 chyb |
| Studio | deterministic nejvýše 100 ms, soak min. 65 s, build nejvýše 90 s |
| governed lifecycle | journey nejvýše 60 s, 0 chyb |
| VRAM | 100% residency, min. 1 024 MiB free headroom |

Hodnoty nejsou automaticky přepisované pomalejším kandidátem. Přijetí tohoto
WP reviewem zároveň přijímá nebo mění právě tuto tabulku.

## Autorita a negativní hranice

- chybějící plocha, krátký soak nebo méně vzorků znamená `FAIL`;
- jeden error poruší budget, i kdyby latence zůstala nízká;
- p95 je nearest-rank bez interpolace;
- source revision, cesta a metriky každé M1/M2 baseline se ověřují, pouhá
  existence objektu nestačí;
- nový fyzický GPU běh se smí vydat za měření jen v prázdném sériovém okně;
  při cizí aktivitě zůstává `not_run_foreign_activity` a používá se explicitně
  připnutý přijatý pilot;
- runner vytváří jednorázovou production admin authority pouze v paměti a
  její hodnotu neukládá do evidence ani logu;
- vlastněný server musí skončit graceful shutdownem a temp root se odstraní.

Focused důkaz je v
[`m5-perf-20260826.md`](../execution/runs/m5-perf-20260826.md).
Tento dokument není nezávislé review ani M5 acceptance.
