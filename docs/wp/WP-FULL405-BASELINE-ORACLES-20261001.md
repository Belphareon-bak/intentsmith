# WP — oprava tří regresních testovacích předpokladů

## Výsledek a autorita

Operátor požaduje pokračovat v dokončení a doložit aktuální kandidát celým
profilem. Profil `offline,database` na čistém `4cbb4b55` skončil **FAIL:
402 PASS / 3 FAIL / 0 BLOCKED**; tento výsledek se nepřepisuje. Výstupem
tohoto omezeného WP je znovu spustitelný důkaz již přijatých hranic M2,
neměnného finálního obsahu odpovědi a úplnosti kandidátního plánu M6.

## Vstup, connector a vlastnictví

- Vstup: `4cbb4b55ee8ef5fa0e1c6ec3401d3e9802c2af32` ze společné větve
  `work/real-chat-journeys-20260930`, připnutý rodičem tohoto WP.
- Connector se nemění: stávající M2, finalizér a M6 plán se pouze používají.
- Vlastněné cesty: tento WP a `tests/m2-tool-production-consumer.test.js`,
  `tests/m6-candidate-plan.test.js`, `tests/ws-bridge.test.js`.
- Zakázané cesty: produktový source, kontrakty, registr/projekce testů,
  produkční DB, instalace, služby a cizí checkouty. GPU se nepoužívá.
- Závislost: přijatý opakovaný zápis nese trvalé `saveSourceEligible` a
  `saveSourceProjectId`; modelově interpretovaný zápis připravuje jiný WP.

## Příčina původních FAIL

1. M2 consumer: čtyři pozitivní scénáře podávaly starou uměle vytvořenou
   odpověď bez informace o původu. Přijatý handler ji správně zastavil před
   návrhem efektu. Fixture nyní označí odpověď i přesné registrované ID
   projektu; schválení, trvalý request/link/result, reconnect, workspace
   drift a zákaz vytvoření rodičovského adresáře zůstávají kontrolovány.
2. M6 plán: po registraci literal/repeat HTTP průchodů má příslušná fáze
   62 členů (44 modelových a 18 serverových), zatímco test stále čekal 60.
   Přesná nová ID jsou doložena rozdílem registru proti `bf7dc31f`.
3. WS: finalizér do ukládaných metadat přidal `saveSourceEligible: true`.
   Původní obsah se nezměnil a žádný následný model se nevolal; přesný
   metadata oracle toto přijaté pole dosud neobsahoval.

Registrované testy zůstávají aktivní, žádný oracle se nevynechá. Klasifikace
fixture drift vychází z trace skutečného source a původního red běhu; změna
vyžaduje nezávislé review před integrací (`agent-protocol §6`).

## Demonstrace, ověření a stop condition

V odděleném checkoutu se spustí stejné tři registrované testy s privátní
SQLite a owned runtime. Pozitivní scénáře musí zachovat původní přesné
bajty a původní bezpečnostní/approval tvrzení. Negativní kontrola vynechání
každého nově povinného HTTP programu musí zneplatnit M6 plán.

```sh
PATH=/home/belphareon/.nvm/versions/node/v24.21.0/bin:$PATH \
node scripts/nightly-audit.js \
  --suite=IS-T1-TESTS-M2-TOOL-PRODUCTION-CONSUMER-TEST,IS-T1-TESTS-M6-CANDIDATE-PLAN-TEST,IS-T1-TESTS-WS-BRIDGE-TEST
git diff --check
```

Stop: tři focused programy PASS, review kandidátu připravené, předání rodiči.
Nový celý profil i modelová/fyzická přejímka zůstávají samostatnými branami.

## Dosavadní evidence

- Původní celý profil na `4cbb4b55`: report
  `.intentsmith-artifacts/test-runs/2026-10-01T05-46-38-895Z/report.json`
  v integračním checkoutu, **402 PASS / 3 FAIL**.
- Nezávisle zopakovaný focused red baseline v tomto checkoutu na stejném
  čistém SHA: `.intentsmith-artifacts/test-runs/2026-10-01T06-00-20-572Z/report.json`,
  **0 PASS / 3 FAIL**; stejné konkrétní oracly.
- Po omezené opravě fixture a očekávání: přímé běhy M2 **22/22 PASS**,
  M6 **21/21 PASS** a WS **92/92 PASS**, všechny s návratovým kódem 0.
  M6 zároveň zamítl oba plány s vynechaným novým HTTP programem.
- Stav před nezávislým review: **IMPLEMENTATION_VERIFIED / REVIEW_PENDING**.
  Tento focused výsledek nedokládá nový celý profil ani přijetí přirozeného
  chatu; jeho změnu připravuje navazující produktový WP.

## Nezávislé přijetí a integrace

Reviewer `gate0_proposal_review` přijal přesný čistý `e6e9aa05` jako
**REVIEW_PASS pouze pro tři testy a jejich WP**. Vlastní registrovaný report
`2026-10-01T06-04-07-945Z/report.json` má **3/3 PASS**. Přímé negativní
experimenty s neoznačeným nebo cizím zdrojem vytvořily 0 ToolRequest; správně
označený zdroj vyžádal schválení přesných bajtů. Oba nové M6 programy jsou
přesně rozdílem 60→62; jejich vynechání odmítá pokrytí. WS nadále ověřuje
nezměněné bajty a nulové následné modelové volání. Integrované jako `742d3dac`.
Původní celý 4cbb profil zůstává FAIL; toto není nová celková přejímka.

## Doplnění přesného člena po integraci VAT

Přijatý VAT source přidal jediný nový required ACTIVE server program
`IS-T3-TESTS-CHAT-VAT-SEMANTIC-HTTP-TEST` (bez vlastního runner-owned
serveru). Na čistém `0ceca5da` původní M6 test opět skutečně selhal
20/21, očekával 62 místo 63 (`m6-vat-registry-red.log`). Přesný registry
diff je 44 modelových + 19 serverových členů dané fáze. Test nyní kromě
tohoto počtu ověřuje konkrétní VAT ID a zamítnutí plánu při jeho vynechání.
Source plánu, kontrakty ani registr se tímto doplněním nemění.
Tato testová změna čeká na samostatné review; nový úplný profil čeká také.
