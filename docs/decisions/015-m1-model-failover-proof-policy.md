# 015 — D+ potřebuje schválenou role-suite proof policy

- **typ:** BLOCK pouze pro vydání PASS proofu a terminal activation
- **stav rozhodnutí:** ČEKÁ NA OPERÁTORA; měřicí část smí pokračovat fail-closed
- **WP:** WP-M1-MODEL / B3-FAILOVER
- **rail:** R1, R3, R5, R6
- **vzniklo při:** call-graph auditu authority pro rozhodnutí 006/D+

## Co je v repozitáři autoritativní

`MODEL_PROFILES` v `src/upgrade/model-profiles.js` je autorita mapy role→suite:
D1, D2 a R1 používají `reasoning`, CODE `code`, R2 `review`, CHAT `chat` a
VISION `vision`. `SUITES` v `src/upgrade/validation-suites.js` je autorita
seřazených testů: reasoning/code/chat mají po 8 testech, review/vision po 6.
Runner má verzi `v123.1`, provádí testy sekvenčně a vrací score a počet
úspěšných testů.

To ještě není acceptance policy. Repozitář nemá schválený suite-level PASS
práh, producenta `role_contract_sha256` ani immutable run artifact svázaný s
digestem modelu. Hodnoty `0.8` a `5/6` v schema testu jsou pouze fixture.
`BLACKLIST_THRESHOLD=0.2` rozhoduje o blacklistu, ne o kvalifikaci pro
automatický failover. Legacy `validation_suite_scores` navíc neukládá roli,
digest, policy, run ID, contract hash ani inventory snapshot a persistence
chybu pouze loguje.

## Neměnná bezpečnostní hranice

Bez ohledu na zvolený práh musí nový proof runner:

1. odvodit roli, suite, prahy, verze a contract hash z jednoho policy modulu;
2. odmítnout callerem dodaný práh, čas, TTL, suite, policy, hash nebo proof ID;
3. použít strict lokální inventory a přesný digest před i po běhu;
4. spustit právě jednu kompletní seřazenou suite v izolovaném runneru bez
   legacy persistence;
5. odmítnout partial, cancelled, malformed nebo podprahový výsledek;
6. nezměnit binding, config, `model_overrides`, `upgrade_history`, broadcaster
   ani externí síť;
7. zapsat PASS proof atomicky, nebo nezapsat nic.

Contract hash bude používat versioned, sorted-key canonical JSON bez nové
závislosti a byte SHA-256 autoritativních `model-profiles.js` a
`validation-suites.js`. Změna serializace nebo některého source pinu vytvoří
novou verzi kontraktu a staré proofy přestanou být způsobilé; storage schema se
měnit nemusí.

## Varianty acceptance policy

| Varianta | Chování | Přínos | Riziko / cena přepnutí |
|---|---|---|---|
| A — absolutní bootstrap | `requiredScore=1` a všechny testy musí projít | Jediný práh odvoditelný bez false activation | Může být příliš křehký pro modelové gradery; mění se policy modul a jeho negativní testy |
| B — role-specific kalibrace | Každá role dostane schválený score/count práh z opakovaných běhů reference a kandidátů | Praktická kvalifikační hranice založená na datech | Nejdřív je nutný kalibrační artifact; bez něj by čísla byla odhad |
| C — measurement-only | Policy obsahuje mapu, source pins a runner parametry, ale `issuanceEnabled=false` a prahy `null` | Lze implementovat a testovat celý inertní řetězec bez falešného PASS | Terminal activation zůstane BLOCKED do volby A nebo B |

## Dočasný vratný default

Do společného review je zvolen **C — measurement-only**. Šev je jediný budoucí
modul `src/upgrade/model-failover-proof-policy.js`; přepnutí na A nebo B změní
jeho acceptance sekci a focused test `tests/m1-model-failover-proof-policy.test.js`.
Runner a repository se kvůli přepnutí nepřepisují. Všechny dříve naměřené
artefakty zůstávají diagnostikou, ale nevydávají PASS proof zpětně.

Spolu s prahem musí operátor schválit proof TTL. Existující 14denní hodnota je
legacy cache age, nikoli schválená D+ autorita. Dokud TTL není rozhodnuté,
measurement artifact může nést časy běhu, ale proof issuance zůstává vypnuté.

Toto rozhodnutí nezastavuje claim recovery, policy serializaci, strict
inventory adaptér ani negativní testy runneru. Zastavuje pouze vytvoření
způsobilého PASS proofu a runtime activation. Gate 1 proto zůstává `BLOCKED`.
