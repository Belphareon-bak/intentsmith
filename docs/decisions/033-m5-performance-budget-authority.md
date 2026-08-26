# Decision 033 — M5 performance budget authority

**Stav:** `IMPLEMENTED / REVIEW_PENDING` · **Datum:** 2026-08-26

## Rozhodnutí

M5 používá jediný verzovaný performance evidence kontrakt. Nová měření uchovají
raw latency vzorky, error count, trvání, počet operací a RSS start/peak/end.
Release verdict se odvozuje nearest-rank percentilem a explicitními budgety;
rychlejší průměr nesmí zakrýt pomalý p95 a nový pomalý kandidát nesmí sám
automaticky uvolnit svůj limit.

Přijaté M1/M2 modelové, Studio, lifecycle a VRAM měření se nereplikují při cizí
GPU aktivitě. Jsou ale platná jen s přesnou source revision, dokumentem a
metrikami; evidence je nemůže nahradit jiným stejně pojmenovaným objektem.

## Důsledky

- smoke kratší než pět minut není dlouhý core soak;
- jedna chyba poruší nulový error budget;
- chybějící raw nebo pinned plocha je terminální `FAIL`;
- fyzický GPU stav je samostatná disposition a `NOT RUN` se nesmí přepsat na
  aktuální PASS;
- přijetí WP reviewem je zároveň schválením tabulky budgetů; případná změna
  budgetu vyžaduje nový product commit a nové evidence.
