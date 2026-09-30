# M3 plánovaný worker v produktovém procesu

**Stav:** kandidát k nezávislému review. Nenahrazuje release přejímku.

## Co scénář ověřuje

Registrovaná sada `IS-T3-TESTS-M3-AGENT-SCHEDULED-PRODUCT-JOURNEY-TEST`
spouští skutečný produktový server v odděleném soukromém runtime a s
produkční autentizací. Její dočasné M3 rozšíření je kopií nativního
Project Health manifestu s vlastním ID a plánem
`{ "type": "interval", "value": "5m" }`.
Nativní manifest se nemění. Dočasný adresář se smí použít jen z
`INTENTSMITH_TEST_ARTIFACT_DIR` s testovacím nonce, `CI=1`, privátními
oprávněními a vlastnictvím procesu; cesta mimo tento runtime je odmítnuta.

Test instaluje důvěryhodnou instanci vypnutou, zapne ji a po restartu
produktu čeká na **automatický** baseline běh. Poté v izolované SQLite
přes `AgentRepository.updateAgentState()` nastaví poslední běh do minulosti,
změní skutečný projektový soubor a po dalším restartu ověří automatické
dohnání plánu: nový durable run, přesný ProjectContext digest a jednu
in-app notifikaci se stejným `run_id` a revizí. Vedle toho vloží splatný
řádek bez důvěryhodné M3 vazby; skutečný scheduler jej nesmí vykonat.
Třetí restart ověřuje, že nevznikl duplicitní běh ani notifikace.
Lokální provider odmítá modelové odpovědi; jejich počet musí zůstat nula.

## Důkazní hranice

Před testovacím override server dočasné rozšíření neobjevil a nový scénář
selhal. Po zapojení omezené testovací cesty scénář prošel při přímém
spuštění. Registrovaný běh na čistém kandidátním SHA a nezávislé review
musí být doplněny v handoffu.

Čas pěti minut je zde řízeně simulován **jen v test-owned DB** posunem
uloženého `_last_run` při zastaveném produktu. Test neměří skutečné
pětiminutové čekání, přerušení právě probíhajícího běhu ani fyzické Studio UI.
Nativní Project Health zůstává ruční a instalovaný backend se nemění.
