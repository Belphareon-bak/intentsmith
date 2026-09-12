# GPU hunt: ověření VISION a úzké automatické mazání

**IMPLEMENTATION_GREEN / RETENTION_ENABLED / RETENTION_COMPLETE / BASELINE_COMPLETE / QUALITY_DISCRIMINATION_OPEN / REVIEW_PENDING.**
Aktualizováno dokončovacím checkpointem níže; původní provozní údaje z 12:57 jsou historické.
Navazuje na [validační packet](2026-09-12-GPU-HUNT-VALIDATION-REVIEW.md).
Autoritou pro změnu je explicitní zadání operátora z 12. 9. 2026: zapnout
automatické mazání modelů, které se jednoznačně nehodí pro žádnou roli.
Nezahrnuje přepínání rolí ani rušení rollback slotů. Předchozí dočasné OFF
je tímto zadáním nahrazeno; historické reporty se nepřepisují.

Implementační rozsah: `3f3a22203b51905a6bf834cb39f5e7f76b2306f2..d2e8c538e5fc6dd2ab5354e4aef6185628535ad6`.
Čtyři nové commity jsou pushnuté na `work/mobile-completion-20260908`.

## Qwen a obrázky

Rodina Qwen zahrnuje textové i multimodální modely. Lokální `/api/show`
potvrzuje `vision` u `qwen3.8:latest` a `qwen3.5:27b`; `qwen3:14b` ji
nedeklaruje. [Oficiální katalog Qwen3.8](https://ollama.com/library/qwen3.8)
popisuje podporu obrázků a videa. Rozhoduje konkrétní artefakt a schopnosti,
nikoli samotné slovo Qwen. Přesné digesty jsou v `qwen-capabilities.json`.

Regrese přes skutečný RoleQualityEvaluationRunner ověřuje čtyři požadavky
s PNG v `messages[].images` a jeden kontrolní bez obrázku. HTTP provider
je v této regresi simulovaný. Skutečný VISION pilot z dneška má response-bound
COMPLETE: Qwen3.8 0.933333 proti Llava8 0.533333, tři opakování, run
`eval_1243bf33-ce95-4824-958e-7ea6f24134a2`. Během následného baseline uspěl
ve VISION také Qwen3.5. Tato zjištění sama neaktivují nový binding.

## Rozhodování o odstranění

Nový `model-hunt-retention.js` zvažuje všech sedm rolí, i když byl hunt
spuštěn pouze pro CODE. Existují dvě povolené větve:

1. Ve všech technicky použitelných rolích existuje COMPLETE pro kandidáta
   i současný incumbent, plný digest, response-bound důkaz, aktuální Ollama,
   GPU, kontext a kontrakt sady. Vyžadují se alespoň tři opakování, úplné
   úlohy a připravená sada. Kandidát musí jasně prohrát podle existujícího
   párového rozhodování: stabilní většina úloh, záporná marže alespoň o práh
   role a také celkové skóre horší alespoň o tento práh.
2. Přesný artefakt má ověřený `CANDIDATE_VRAM_FIT_FAILED` při současném
   provideru, GPU a produkčním kontextu. Umístění musí dokazovat kladnou,
   aritmeticky konzistentní část na CPU. Současné COMPLETE nesmí tomuto
   hardwarovému závěru odporovat. Timeout ani obecné BLOCKED nestačí.

Jediná neúplná, neprůkazná či vyhraná role zachová model. Aktivní, desired
i rollback modely chrání binding application. Samotný tlak na disk důkaz
nenahrazuje. Jde o vhodnost pro aktuální produkční nastavení, včetně
`think:false`, nikoli tvrzení o nejlepším možném výkonu modelu v jiném režimu.

Mazání používá existující ModelRegistry pod mutation ownerem a durable
exclusive artifact claimem. Bezprostředně před efektem znovu kontroluje
plný digest, bindings, provider a důkazy. `/api/ps` obou providerů a NVIDIA
compute seznam musí být úspěšně načtené a prázdné. Neznámá residency není idle.
DELETE jde přes systémový provider 11434, který vlastní zapisovatelný store;
sidecar 11435 zůstává evaluační.

Append-only hunt journal zapisuje APPROVED před efektem a DELETED nebo
DELETE_FAILED po něm. Historie scoringu zůstává. Klíč odmítnutí zahrnuje
artefakt, aktuální incumbenty, provider, hardware, kontext, kontrakty, prahy
a použitelnost rolí. Shodný odmítnutý kandidát se za stejných podmínek znovu
nestahuje; změna podmínek umožní nové posouzení. Krátký katalogový fingerprint
slouží pouze plánování, změněný plný lokální digest se musí shodovat přesně.
Neúspěšný či nepotvrzený pokus po schválení vrací DELETE_FAILED také v reportu;
zejména transportní chyba DELETE nesmí tvrdit potvrzené ponechání artefaktu.
Durable registry intent/outcome zachovává případný ORPHANED efekt.

Při kontrole celého plánovacího řetězce se ukázalo, že samotné uvolnění
retention klíče nestačí: starý COMPLETE duel by kandidáta dál vyřadil.
`1cbcd8ad` proto uvolňuje také tento starý záznam. Následující pokus uvolnění
spotřebuje a znovu platí COMPLETE/BLOCKED nebo 24h odstup pro RETRYABLE.
Append pořadí journalu řeší i shodný timestamp. Regrese ověřuje skutečnou
SQLite cestu plánování, odmítnutí, změny podmínek a následného pokusu.

CLI `--prune-rejected` provádí úklid před discovery a po dokončení dávky;
`--prune-only` provede pouze údržbu. Legacy `--allow-removal` je nyní alias
této úzké politiky a nezapíná staré inline mazání kandidáta. Samostatný
serverový úklid podle stáří zůstává OFF.

## Validace a provoz

Focused: model-upgrade **97 PASS**, registry **20 PASS**, binding application
**109 PASS**, candidate **36 PASS**, pairwise **37 PASS**, artifact **158 PASS**.
Regrese zahrnují odmítnutí mazání při neúplných datech, odlišných podmínkách,
remíze, vítězství ve VISION, driftu bindingu/digestu, rollback ochraně i
pořadí journal → efekt → receipt. Pozitivní registry test ověřuje právě jeden
DELETE přes 11434 pod autoritou; negativní scénáře mají nula efektů.

První celý gate na čistém `1b6f7e08` při souběhu s GPU baseline:
**349 PASS / 3 TIMEOUT / 0 FAIL / 0 BLOCKED / 0 SKIPPED**, verdict FAIL.
Timeouty: `M2-EFFECT-AUTHORITY-REPOSITORY`, `M2-EFFECT-BROKER-V1`,
`M2-LIFECYCLE-APPLICATION-SERVICE`. Všechny log hashe, čisté source stromy
a 352 jedinečných ID ověřeny. Původní neúspěšný report zůstává zachován.
Report SHA-256: `2dd806aa3c7bb5bbd0855f5457da15e1061cd74dac0fe4ef30b571328fd0c342`.
Časový souběh s GPU zátěží není sám o sobě důkazem příčiny timeoutů.

Opakování stejného `1b6f7e08` skončilo **351 PASS / 1 TIMEOUT**,
`IS-T1-TESTS-M2-TOOL-BROKER-V1-TEST` (30 231 ms), verdict FAIL. Tři původní
timeouty tentokrát prošly. Na hostu souběžně běžel cizí integration audit
a UI testy, bez našeho zásahu. I tento report je zachován a všech 352 log
hashů ověřeno. SHA-256:
`c6277cdc22f1fce37e6a81e40a59cb8e53a6bdc9d5e8aa90e610cadf5c5b3d7b`.

Po ukončení cizí integrační kontroly celý gate na čistém `1cbcd8ad`:
**352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED / 0 SKIPPED**. Všechny log hashe,
čisté stromy a jedinečné ID ověřeny. SHA-256:
`242f84029d88568255aa65b6ac3f41b0dbcc2af2d653f939755da5667200cc07`.
Poslední `d2e8c538` mění hlášení nepotvrzeného smazání a přidává jeho regresi;
před provozní aktivací se ověřuje i tento přesný commit. Jeho první celý gate
na NVMe skončil **351 PASS / 1 TIMEOUT**, znovu
`IS-T1-TESTS-M2-EFFECT-BROKER-V1-TEST` (30 046 ms). SHA-256:
`7ed251346dbf7aac7134a48432136cef29c8dbcd39c96e8b8fda84abad74c58b`.
Následující opakování používá podporovaný `--out-dir` na tmpfs v
`/run/user/1000/.intentsmith-artifacts/hunt-retention`. Zdroj zůstává stejný čistý checkout,
všechny testy a timeouty zůstávají stejné; izolované DB fixtures a logy mají
jiné úložiště. Důkazy se archivují na NVMe. Toto neprokazuje příčinu časových
výpadků původních diskových běhů ani odolnost DB proti výpadku napájení.

První pokus o tmpfs měl chybnou operátorsky zvolenou cestu bez požadovaného
komponentu `.intentsmith-artifacts`: **75 PASS / 277 FAIL**. Všech 277 chyb
obsahuje odmítnutí privátní cesty testovacím helperem. Jde o chybu spuštění,
ne o zelený validační důkaz. Report i logy jsou archivovány, SHA-256:
`4150c32ded39cd62c348d4b5c61ad4ee707182e82d56d72ab69f26467bce13c2`.

Fixtures mimo Git checkout následně daly **350 PASS / 2 FAIL**
(`CODE-PATCH-RUNNER`, `CODE-SEARCH`), SHA-256
`0b84450dd811ebd65d529e4e4642ae2ce08c1b941fa00502ed8b6093d50a4c33`.
Oba testy beze změny prošly po umístění do kompletního checkoutu v RAM.
První RAM checkout však sám ležel pod `.intentsmith-artifacts`, což kolidovalo
s negativním testem veřejné cesty v E2E harness: **351 PASS / 1 FAIL**,
`IS-T2-TESTS-E2E-HARNESS-ISOLATION-TEST`, SHA-256
`15e18c87c953d30f74874e0244db0fc893678421ef1c9c1ba08bf899f4c50ce0`.
Checkout byl přesunut do `/run/user/1000/is-retention-src`; jeho vlastní
`.intentsmith-artifacts` zůstává uvnitř repozitáře. Izolovaný E2E harness
poté prošel. Jde o opravy zvoleného testovacího prostředí, nikoli změny
implementace nebo testů. RAM checkout má stejný commit `d2e8c538` a kopii
stejných závislostí z ověřovacího checkoutu na disku. Všechny reporty a logy
jsou zachovány, včetně těchto neúspěchů.

Finální čistý checkout `d2e8c538`, se stejnými závislostmi a standardním
uspořádáním repozitáře na tmpfs: **352 PASS / 0 FAIL / 0 TIMEOUT / 0 BLOCKED
/ 0 SKIPPED**. Běh `retention-d2e8c538-final`, 12:51:06–12:54:26 CEST.
Všech 352 jedinečných ID, čisté source stromy a SHA-256 logů byly ověřeny;
po archivaci na NVMe byly hashe logů ověřeny znovu. Report SHA-256:
`cfe8bdb71dadea2ed894cf6a3fc805f4f8894471583501c83a4599e5675a4c25`.
Předchozí neúspěchy se nezapočítávají jako PASS. Souhrn všech pokusů,
checkpointů a cest je ve [strojovém manifestu](../execution/runs/gpu-hunt-retention-20260912.json).

Živý pokus `--prune-only --scheduled` během baseline správně skončil
SCHEDULED_SKIPPED kvůli obsazenému GPU locku, bez sweepů a efektů.
Předběžné posouzení našlo jasné prohry Llava13b ve všech pěti použitelných
rolích. Skutečný rollback slot VISION jej však chrání:
`op_194d92a3-7ac9-4e97-be03-2eb47803dac0`. Nesmí být odstraněn automaticky.
North má neprůkazné role, Devstral vyhrává R2 a VISION; oba mají zůstat.
Finální read-only preview na `d2e8c538` po doměření panelu potvrdilo stejné
rozhodnutí: **0 způsobilých nechráněných artefaktů**. Jediná kvalitativně
způsobilá Llava13b je rollback chráněná. Preview nepoužilo inference ani DELETE.

Read-only checkpoint v 12:17 CEST po doměření původního panelu:
**12 instalovaných artefaktů / 73 applicable COMPLETE / 0 applicable MISSING
/ 0 FAILED / 0 BLOCKED / 11 N/A**, filtrovaný aktuálním kontraktem a providerem
`0.34.0-intentsmith.1`. Plná DB obsahuje 454 historických běhů. Běžící dávka
pak stahuje Gemma4:31b. Checkpoint není finálním výsledkem celé dávky.
Binding read model nadále hlásí UNVERIFIED_RUNTIME, protože runtime produktové
session nebyl pozorován; response-bound scoring tím nezaměňujeme za aktivaci.

Po zeleném gate byla instalována šablona pravidelné služby s
`--run --limit=2 --keep-inconclusive --prune-rejected --scheduled` a načtena
přes daemon-reload. Timer je enabled/active, další tick 13. 9. kolem 03:00 CEST.
Disková rezerva zůstává 40 GiB. Záloha původní služby je v evidence rootu.

První údržba je skutečně zařazena za běžící baseline:
`intentsmith-hunt-retention-after-baseline-20260912.service`, job **17229 / start
waiting** proti baseline jobu **9806 / start running**. Explicitní After
směřuje na baseline; MainPID úklidu je zatím 0. Poběží `--prune-only` přes
sidecar wrapper z čistého `/home/belphareon/is-hunt11` na přesném `d2e8c538`.
Tento diskový checkout musí zůstat dostupný, dokud čekající služba nedoběhne.
Výsledek vznikne v `cleanup-after-baseline.json`; zatím není vytvořen.

Provozní checkpoint 12:57:09 CEST: **0 smazaných modelů**, 0 retention journal
řádků, stále 12 instalovaných artefaktů a 454 historických scoring běhů.
Desired bindings se přesně shodují se stavem před aktivací. Volných
57 704 833 024 B (asi 53.7 GiB). Baseline dál stahuje Gemma4:31b na původním
removal OFF; nebyl přerušen. Stav zapnuté služby tedy není tvrzením, že už
proběhl skutečný DELETE nebo skončila celá dávka.

Nezávislé review ani acceptance M6 tento packet neuzavírá.

Evidence root: `/home/belphareon/Projects/coworker/intentsmith-hunt-retention-20260912`.

## Dokončovací checkpoint 2026-09-12 odpoledne

Živá read-only kontrola na `ee4472d5`: baseline report z 13:09:35 CEST má
13 kandidátů, z nich 12 dokončilo kvalitativní evaluaci bez roleErrors.
Třináctý, `gemma4:31b`, skončil na hardwarovém gate. Následná údržba
skončila `RETENTION_COMPLETE` a první skutečné automatické odstranění
Gemmy bylo potvrzeno ve 13:09:47. Důvod `RETENTION_PRODUCTION_GPU_UNFIT`:
3 266 729 797 B na CPU při kontextu 32768, tedy přibližně 3.04 GiB.
Receipt uvádí odstraněný artefakt o velikosti přibližně 18.5 GiB;
nejde o samostatné měření změny volného místa filesystemu. Ostatní modely
zůstaly včetně bound modelů a rollbackově chráněného `llava:13b`.

Aktuálně instalováno 12 modelů. Autoritativní projekce pro současný provider
vrací 73 použitelných model-role buněk COMPLETE, 0 FAILED/BLOCKED/MISSING
a 11 N/A. Historická DB má 220 COMPLETE / 209 BLOCKED / 32 FAILED přes
24 jmen modelů. Tyto historické řádky nejsou počtem aktuálně testovaných
modelů ani aktuálním coverage.

### Neúspěšný bootstrap a již dodaná oprava

`intentsmith-model-hunt-bootstrap-20260911.service` skončil 09:24:22 CEST
s `Result=exit-code`, `ExecMainStatus=1`; spotřeboval 1 h 32 min CPU.
Není to úspěšný baseline ani selhání offline testovacího prostředí.
[Validační packet](2026-09-12-GPU-HUNT-VALIDATION-REVIEW.md#nálezy-z-první-dávky)
již popisoval operátorské zastavení, suspend a chybné přiřazování chyb;
chyběl v něm přesný název jednotky a následující soupis. Samotný terminální
systemd status nedokazuje, že poslední vypsaná chyba byla příčinou ukončení.

Všech 32 historických FAILED patří předchozí implementaci:
Devstral 7, Qwen3.6 7, Qwen3-coder 6, Qwen3-30b-a3b 6, Phi4 6.
Poslední vznikly v 09:21:31 CEST. Původní CLI chybu incumbenta chybně
rozmnožilo do rolí kandidáta. Tyto řádky se nepřepisují ani nepoužívají
jako důkaz jeho nízké kvality. Oprava `ed3d57ff` z 09:35 zachycuje
skutečnou identitu selhané inference a pokračuje další rolí; výchozí cold-load
budget je 120 s a účastní se kontraktu. Opakovaná regrese candidate-trial
na `ee4472d5`: 36 PASS, včetně chyby incumbenta mezi úspěšnými rolemi.
Následný živý baseline má 0 roleErrors. To nedokazuje nemožnost budoucího
timeoutu; nedokončený duel zůstává RETRYABLE s 24h odstupem.

### Co odděluje providery

Oba dnes používají `0.34.0-intentsmith.1`. Systémová služba 11434 běží jako
uživatel `ollama` z `/opt/intentsmith/ollama/0.34.0-intentsmith.1` a vlastní
zápis do skladu. Sidecar 11435 běží jako `belphareon`, jen po dobu dávky,
s připnutým hashem binárky/native payloadu, vypnutým cloudem, vlastním
procesním stromem a jeho úplným ukončením. Uživatelský účet nemá zápis
do systémového skladu (ověřeno oprávněními a `test -w`). Wrapper není
filesystem ani HTTP sandbox. Sdílí GPU a sklad; oddělený port sám neřeší
kontenci, tu musí pokrývat serializace a drain. Nepřítomnost 11435 mezi
běhy je očekávaná. Rozdíl není „patchnutý versus nepatchnutý provider“.

### Otevřená kvalita a IDE

Historicky 76/178 rozhodnutí INCONCLUSIVE (42.7 %); současná read-model
projekce má 28/77 (36.4 %). Jsou to řádky rozhodnutí, nikoli deduplikované
páry. Historická procenta nejsou kontrolovaný benchmark proti srpnu.
Reasoning role stále potřebují rozlišující úlohy odvozené z reálných
repo vad. Rozšíření sad není součástí této dokumentační opravy a není
hotové. Prahy se nesnižují a neúplný důkaz nepovoluje mazání ani aktivaci.

Produktový Studio zdroj má Modely LLM → Evaluace: role, model, digest,
stav, score, čas a rozhodnutí přes GET `/api/system/models/evaluations`.
Hunt v této dávce běžel přes CLI/systemd; ovládání jeho dávky a průběhu
v IDE tím nebylo prokázáno. Ani tento checkpoint netvrdí nový živý Electron
journey. Verze providera je v DB/read modelu, ale tabulka ji zatím neukazuje.

SHA-bound zdroje, read-only coverage, dokončený baseline, deletion receipt,
terminální journal a regresní log jsou v `completionFollowup` strojového
manifestu. Původní checkpointy a neúspěšné evidence zůstávají zachované.
