# M3 plánovaný worker v produktovém procesu

**Stav:** review na `43cb7760` přijalo produktovou a bezpečnostní část;
celkové `CHANGES_REQUIRED` se týkalo zastaralého censu v `SYSTEM-MAP.md`.
Dokumentační oprava čeká na opakované review. Žádný release PASS.

## Co scénář ověřuje

Registrovaná sada `IS-T3-TESTS-M3-AGENT-SCHEDULED-PRODUCT-JOURNEY-TEST`
spouští skutečný produktový HTTP server a SQLite v soukromém runtime s
`NODE_ENV=test`. Dočasné důvěryhodné M3 rozšíření je kopií nativního
Project Health manifestu s vlastním ID a plánem
`{ "type": "interval", "value": "5m" }`.
Nativní manifest se nemění. Testovací adresář lze použít jen při
`NODE_ENV=test`, `CI=1`, platném testovacím nonce a privátních právech,
vlastnictví i umístění uvnitř `INTENTSMITH_TEST_ARTIFACT_DIR`. Negativní
start serveru potvrzuje, že `NODE_ENV=production` odmítne i jinak platný
soukromý testovací adresář.

Test instaluje důvěryhodnou instanci vypnutou, zapne ji a po restartu
produktu čeká na **automatický** baseline běh. Poté v izolované SQLite
přes `AgentRepository.updateAgentState()` nastaví poslední běh do minulosti,
změní skutečný projektový soubor a po dalším restartu ověří automatické
dohnání plánu: nový durable run, přesný ProjectContext digest a jednu
in-app notifikaci se stejným `run_id` a revizí. Vedle toho vloží splatný
řádek bez důvěryhodné M3 vazby; skutečný scheduler jej nesmí vykonat.
Třetí restart ověřuje, že nevznikl duplicitní běh ani notifikace.
Lokální provider odmítá modelové odpovědi; jejich počet musí zůstat nula.

Produkční autentizaci a ruční spuštění dodávaného, nezměněného manifestu
ověřuje **samostatná** registrovaná sada
`IS-T3-TESTS-M3-AGENT-PRODUCT-HTTP-JOURNEY-TEST` s `NODE_ENV=production`.
Naplánovaný běh a produkční autentizace jsou tedy dvě samostatné evidence,
nikoli jeden společný produkční end-to-end scénář.

## Důkazní hranice

Regresní test před opravou na `fbab22818f66f3006a1d94c4d02384d005b875f5`
selhal na `Missing expected rejection`: produkční server přijímal
testovací extension root. Po opravě na zdrojovém commitu
`d4be0ac1987bf3a433f7c63b22581f43df94100c` prošly 3/3 registrované
sady (`IS-T1-TESTS-SCHEDULER-TEST` a obě výše uvedené M3 sady).
Stejný výsledek má čistý HEAD `43cb776016cef19951f782affad8666b4efef390`:
[lokální report](../../.intentsmith-artifacts/run-suites/2026-09-30T22-56-14-308Z/report.json)
se `sourceRevision=43cb776016cef19951f782affad8666b4efef390`.
Report je testovací artefakt mimo git. V jeho souboru
`artifacts/m3-agent-scheduled-product-journey.json` jsou
`baselineRunId=1`, `changedRunId=2`, `notificationId=1`, `untrustedRunCount=0`,
`providerModelCalls=0` a `productionOverrideRejected=true`. Jde o běhový
report mimo Gate 0; registr ani `lastGreen` se tím nemění. Původní review
`fbab228` skončilo `CHANGES_REQUIRED`; review `43cb7760` schválilo produktovou
a bezpečnostní část, ale vyžádalo tuto dokumentační opravu.

Pět minut je řízeně simulováno **jen v testovací DB** posunem uloženého
`_last_run` při zastaveném produktu. Test neměří skutečné pětiminutové
čekání, přerušení právě probíhajícího běhu, chování při velkém počtu
naplánovaných instancí ani fyzické Studio UI. Dotaz na splatnost používá
`julianday(s.next_run)`; funkce nad sloupcem omezuje využití prostého indexu,
proto výkon velkého plánu vyžaduje samostatnou škálovací bránu. Nativní
Project Health zůstává ruční a instalovaný backend se nemění.
