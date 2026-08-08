# 015 — D+ potřebuje schválenou role-suite proof policy

- **typ:** BLOCK pouze pro vydání PASS proofu a terminal activation
- **stav rozhodnutí:** C IMPLEMENTOVÁNO JAKO VRATNÝ DEFAULT; A/B A TTL ČEKAJÍ NA OPERÁTORA
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

To samo ještě není acceptance policy. Nový policy modul už produkuje
role-bound `measurementContractSha256`, ale vědomě jej nevydává za
`role_contract_sha256` způsobilého PASS proofu. Repozitář nemá schválený
suite-level PASS práh ani immutable run artifact svázaný s digestem modelu.
Hodnoty `0.8` a `5/6` v schema testu jsou pouze fixture.
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
7. uložit immutable run artifact se skutečnými prompty, options, výsledky a
   digestem a zapsat jej s PASS proofem atomicky, nebo nezapsat nic;
8. před terminálním zápisem znovu ověřit aktuální policy, validation version a
   role contract hash; samotný SQL trigger tuto živou autoritu nezná.

Contract hash bude používat versioned, sorted-key canonical JSON bez nové
závislosti a byte SHA-256 autoritativních `model-profiles.js` a
`validation-suites.js`. Změna serializace nebo některého source pinu vytvoří
novou verzi kontraktu a staré proofy přestanou být způsobilé. Samotná změna
contract version nevyžaduje novou tabulku, ale vazba na immutable run artifact
bude před issuance vyžadovat aditivní storage checkpoint; dnešní volný
`validation_run_id` není dostačující důkaz.

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

## Implementační stav measurement policy — 2026-08-08

`src/upgrade/model-failover-proof-policy.js` je jediný fail-closed snapshot
role-suite autority pro izolovaný measurement runner. Pinuje raw bytes i délku
obou zdrojů:

- `model-profiles.js`: 9 967 B, `16941d6a…264a`;
- `validation-suites.js`: 39 108 B, `49520a41…b0ef`.

Nad nimi znovu odvozuje přesných 7 rolí, 5 suit a 36 definic testů ve
schváleném pořadí. ID je unikátní uvnitř každé sady; `instruction_follow` je
vědomě v reasoning i chat sadě. Kanonický formát má vlastní verzi
`sorted-key-json-utf8-v1`, řadí pouze object keys, zachovává pořadí polí a
odmítá sparse arrays, `-0`, non-finite čísla, accessors, skryté/symbolické
vlastnosti, neprosté objekty i cykly. Každý role measurement contract tak nese
deterministický hash, ale žádný `proofId`, proof hash ani PASS výsledek.

Acceptance shape je připravený pro obě otevřené varianty: globální proof TTL a
samostatný `requiredScore`/`requiredPassedCount` pro každou roli. Pod defaultem
C jsou všechny tyto hodnoty `null` a `issuanceEnabled=false`. Guard by ani po
chybné změně jediného booleovského flagu nepovolil issuance bez konečného
skóre v `(0,1]`, kladného počtu nepřesahujícího velikost role suite a kladného
integer TTL; blocking reason musí být současně explicitně vyčištěný na `null`.

Policy není proof runner. Implementovaný
`scripts/run-model-failover-measurement.js` proto vytváří čerstvý izolovaný
child, kontroluje source piny i inventory před/po a ukládá skutečné prompty,
options a úplnou ordered result sadu. Reasoning `Math.random()` se
nedeterministicky neopakuje: skutečně použitý prompt a `_expected` grading
context jsou zachycené a znovu svázané. I synteticky perfektní výsledek zůstává
`NOT_ISSUED` a nevytvoří PASS proof ani DB zápis.

Samotný child runner považuje `sourceRevisionClaim`, callerem zvolený loopback
provider a očekávaný digest pouze za parent piny. Navazující parent acceptance
níže už tuto autoritu odvozuje z čistého Git kandidáta, configu a strict
inventory. Před proof issuance proto zbývají schválené prahy a TTL, aditivní
vazba immutable artefaktu na proof a terminální recheck živé policy,
validation verze a role contract hashe.

Navazující parent acceptance už první část uzavřel bez domýšlení autority:
caller dodá pouze roli a požadované jméno, provider pochází z configu, exact
model a digest ze strict inventory a source revision z čistého Git kandidáta.
Child i policy běží z privátního exportu přesných HEAD blobů. Parent ověří
process outcome, inventory před/po, artifact bytes/mode/path a úplnou pětici
pinů a vydá immutable `NOT_ISSUED` receipt. Tím se measurement stává
reprodukovatelnou kandidátní evidencí, nikoli PASS proofem: prahy, TTL,
atomická proof persistence a terminal activation zůstávají blokované.

Focused sady `IS-T1-TESTS-M1-MODEL-FAILOVER-PROOF-POLICY-TEST` a
`IS-T1-TESTS-M1-MODEL-FAILOVER-MEASUREMENT-TEST` i
`IS-T1-TESTS-M1-MODEL-FAILOVER-PARENT-ACCEPTANCE-TEST` běží offline, bez DB,
produktového serveru, Ollamy a GPU; poslední dvě používají pouze test-owned
loopback fake provider. Registrace measurement contractu nemění historický
Gate 0 fingerprint; ten je release evidence, nikoli vývojová autorita.
