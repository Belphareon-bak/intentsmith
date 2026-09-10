# WP-M5-PERF — evidence-bound production budgets

**Typ:** M5 production hardening · **Stav:** `REVIEW_PASSED / M5_ACCEPTANCE_BLOCKED`

**Product revision:** `816a2a4c8a95b49d46f06b94b56feb64c8a40c90`

## Uživatelský výsledek

Release už neposuzuje výkon z jednotlivého rychlého běhu nebo z průměru, který
schová pomalý konec distribuce. `M5PerformanceEvidence@3` odděluje content-
addressed raw v2 vzorky, přesné Git baseline sources a raw GPU measurement či
census receipt. Rozhoduje
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
| Studio | deterministic nejvýše 100 ms, modelový turn nejvýše 70 s |
| governed lifecycle | journey nejvýše 60 s, 0 chyb |
| VRAM | 100% residency, min. 1 024 MiB free headroom |

Hodnoty nejsou automaticky přepisované pomalejším kandidátem. Přijetí tohoto
WP reviewem zároveň přijímá nebo mění právě tuto tabulku.

## Autorita a negativní hranice

- chybějící plocha, krátký soak nebo méně vzorků znamená `FAIL`;
- jeden error poruší budget, i kdyby latence zůstala nízká;
- p95 je nearest-rank bez interpolace;
- source revision, cesta, Git blob OID a SHA-256 každé M1/M2 baseline se
  ověřují; metriky pak odvozuje jediný exact parser přímo z těchto bajtů;
- raw měření je samostatný `M5PerformanceRawArtifact@1`; envelope nese jeho
  relativní cestu, byte count a SHA-256 a při chybějícím či změněném souboru
  selže před budget checks;
- kandidát je vázaný na exact commit i tree; runner před i po měření vyžaduje
  stejný čistý HEAD;
- raw i envelope publication používá private mód, `O_EXCL`/`wx` a fsync;
  existující cesta se nikdy nepřepíše;
- nový fyzický GPU běh se smí vydat za měření jen v prázdném sériovém okně;
  při cizí aktivitě zůstává `not_run_foreign_activity` a používá se explicitně
  připnutý přijatý pilot;
- runner vytváří jednorázovou production admin authority pouze v paměti a
  její hodnotu neukládá do evidence ani logu;
- vlastněný server musí skončit graceful shutdownem a temp root se odstraní.

Focused důkaz je v
[`m5-perf-remediation-20260826.md`](../execution/runs/m5-perf-remediation-20260826.md).
Exact-candidate pětiminutový důkaz a jeho content adresy jsou v
[`m5-second-review-remediation-closeout-20260827.md`](../execution/runs/m5-second-review-remediation-closeout-20260827.md).
Nezávislý operátorský výsledek 2026-08-27 označil M5 PERF `REVIEW_PASSED` na
exact candidate `816a2a4c`; viz
[`2026-08-27-M5-M6-OPERATOR-REVIEW-RESULT`](../review/2026-08-27-M5-M6-OPERATOR-REVIEW-RESULT.md).
Tento dílčí verdikt není M5 acceptance. Nové 24h soak/throughput receipts patří
do samostatné M6 Decision 038 evidence.
