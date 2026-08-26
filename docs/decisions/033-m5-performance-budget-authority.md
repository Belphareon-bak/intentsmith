# Decision 033 — M5 performance budget authority

**Stav:** `IMPLEMENTED / RE_REVIEW_REQUIRED` · **Datum:** 2026-08-26

## Rozhodnutí

M5 používá verzovaný envelope `M5PerformanceEvidence@2` a samostatný
content-addressed raw artefakt. Raw bajty uchovají latency vzorky, error count,
trvání, počet operací a RSS start/peak/end; envelope je váže SHA-256, byte
countem, exact candidate commitem a tree.
Release verdict se odvozuje nearest-rank percentilem a explicitními budgety;
rychlejší průměr nesmí zakrýt pomalý p95 a nový pomalý kandidát nesmí sám
automaticky uvolnit svůj limit.

Přijaté M1/M2 modelové, Studio, lifecycle a VRAM měření se nereplikují při cizí
GPU aktivitě. Jsou platná jen s přesnou source revision, cestou, Git blob OID a
SHA-256. Evaluátor čte příslušný Git objekt a odvozuje hodnoty exact parserem;
caller v envelope žádné baseline metriky dodat nemůže.

Review odhalil, že původní Studio `65 800 ms` a install+build `54 000 ms`
neměly v deklarovaném Git zdroji oporu. Tyto dvě hodnoty nejsou přeneseny do
nového kontraktu. Funkční a časový final-candidate install/build důkaz patří
PACKAGE fresh-clone gate; nejde jej nahradit nepodloženou historickou hodnotou.

## Důsledky

- smoke kratší než pět minut není dlouhý core soak;
- jedna chyba poruší nulový error budget;
- chybějící raw nebo pinned plocha je terminální `FAIL`;
- chybějící Git objekt, změněný blob/SHA-256, nejednoznačný parser nebo
  candidate mismatch je terminální `FAIL` ještě před budget comparison;
- raw ani envelope nelze přepsat na existující cestě;
- fyzický GPU stav je samostatná disposition a `NOT RUN` se nesmí přepsat na
  aktuální PASS;
- přijetí WP reviewem je zároveň schválením tabulky budgetů; případná změna
  budgetu vyžaduje nový product commit a nové evidence.
